// tests/agents/supervisor.test.js — src/agents/supervisor.js.
// Verifies: PLAN_TEMPLATES matches the contract verbatim, the plan is stored
// on caseObj.plan, and ANY llm suggestion is clamped to the category template
// (deduped, template-ordered, never fewer agents than the template).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSupervisor, PLAN_TEMPLATES } from '../../src/agents/supervisor.js';
import { HeuristicLlm } from '../../src/core/llm.js';
import { createCase } from '../../src/core/model.js';

function makeCtx(category, id = 'case-sup') {
  const caseObj = createCase({
    id,
    thread: {
      from: 'Test User <test@example.com>',
      subject: 'test',
      messages: [{ from: 'Test User <test@example.com>', date: '2026-01-01', body: 'body' }],
    },
    customer: { name: 'Test User', email: 'test@example.com' },
  });
  caseObj.triage = {
    category,
    provider: 'aws',
    platform: 'eks',
    castaiMode: 'full',
    questions: [],
    severity: 'low',
    missingInfo: [],
    entities: {},
    customerName: 'Test',
  };
  return { caseObj, repoRoot: '/Users/eramadan/castai', params: {} };
}

test('PLAN_TEMPLATES matches the contract verbatim', () => {
  assert.deepEqual(PLAN_TEMPLATES, {
    docs_question: ['researcher', 'verifier', 'writer'],
    node_downscale: ['sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge'],
    node_upscale: ['sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge'],
    iam_onboarding: ['sre', 'security', 'researcher', 'repro', 'verifier', 'writer', 'knowledge'],
    token_rotation: ['researcher', 'sre', 'architect', 'verifier', 'writer', 'knowledge'],
    workload_autoscaling: ['researcher', 'sre', 'product', 'verifier', 'writer', 'knowledge'],
    cost_reporting: ['researcher', 'product', 'qa', 'verifier', 'writer', 'knowledge'],
    spot: ['researcher', 'sre', 'verifier', 'writer', 'knowledge'],
    product_bug: ['sre', 'researcher', 'repro', 'qa', 'product', 'architect', 'security', 'verifier', 'writer', 'escalation', 'knowledge'],
    billing: ['researcher', 'verifier', 'writer'],
    unknown: ['researcher', 'verifier', 'writer'],
  });
});

test('supervisor with HeuristicLlm (suggests full roster) clamps to the template', async () => {
  const ctx = makeCtx('node_downscale');
  const agent = createSupervisor({ llm: new HeuristicLlm() });
  const result = await agent.run(ctx);

  assert.deepEqual(result.agents, PLAN_TEMPLATES.node_downscale);
  assert.deepEqual(ctx.caseObj.plan.agents, PLAN_TEMPLATES.node_downscale);
  assert.equal(typeof ctx.caseObj.plan.rationale, 'string');
  assert.match(ctx.caseObj.plan.rationale, /node_downscale/);

  const actions = ctx.caseObj.trace.map((entry) => entry.action);
  assert.deepEqual(actions, ['agent.start', 'plan.request', 'plan.created', 'agent.end']);
});

test('supervisor never returns fewer agents than the template (llm suggests a subset)', async () => {
  const ctx = makeCtx('iam_onboarding');
  const llm = { complete: async () => JSON.stringify({ agents: ['sre'] }) };
  const agent = createSupervisor({ llm });
  const result = await agent.run(ctx);

  assert.deepEqual(result.agents, PLAN_TEMPLATES.iam_onboarding);
  assert.ok(result.agents.length >= PLAN_TEMPLATES.iam_onboarding.length);
});

test('supervisor drops unknown llm ids — plan stays exactly the template', async () => {
  const ctx = makeCtx('docs_question');
  const llm = {
    complete: async () =>
      JSON.stringify({ agents: ['hallucinated-agent', 'writer', 42, null, 'writer', 'blackhat'] }),
  };
  const agent = createSupervisor({ llm });
  const result = await agent.run(ctx);

  assert.deepEqual(result.agents, PLAN_TEMPLATES.docs_question);
  for (const id of result.agents) {
    assert.ok(!['hallucinated-agent', 'blackhat', 42, null].includes(id));
  }
  // no duplicates
  assert.equal(new Set(result.agents).size, result.agents.length);
});

test('supervisor works without an llm (pure template plan)', async () => {
  const ctx = makeCtx('product_bug');
  const agent = createSupervisor({});
  const result = await agent.run(ctx);
  assert.deepEqual(result.agents, PLAN_TEMPLATES.product_bug);
  assert.equal(result.category, 'product_bug');
  // no plan.request trace entry when no llm is consulted
  assert.ok(!ctx.caseObj.trace.some((entry) => entry.action === 'plan.request'));
});

test('supervisor falls back to the unknown template without triage or with bad category', async () => {
  const ctx = makeCtx('unknown');
  ctx.caseObj.triage = null; // triage never ran
  const agent = createSupervisor({});
  const result = await agent.run(ctx);
  assert.deepEqual(result.agents, PLAN_TEMPLATES.unknown);
  assert.equal(result.category, 'unknown');

  const ctx2 = makeCtx('totally-made-up');
  const result2 = await agent.run(ctx2);
  assert.deepEqual(result2.agents, PLAN_TEMPLATES.unknown);
});

test('every category template contains verifier + writer (answer gate and reply)', () => {
  for (const [category, agents] of Object.entries(PLAN_TEMPLATES)) {
    assert.ok(agents.includes('verifier'), `${category} plan must include verifier`);
    assert.ok(agents.includes('writer'), `${category} plan must include writer`);
  }
});
