// tests/agents/architect.test.js — solution composition from confirmed
// hypotheses + evidence, always with a rollback note.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEvidence,
  addHypothesis,
  createCase,
  setHypothesisStatus,
} from '../../src/core/model.js';
import { createArchitect } from '../../src/agents/architect.js';

function freshCase(category = 'node_downscale') {
  const caseObj = createCase({
    id: 'A-1',
    thread: {
      from: 'Ann Example <ann@example.com>',
      subject: 'node not scaling down',
      messages: [{ from: 'ann@example.com', date: '2026-01-01', body: 'node stuck' }],
    },
    customer: { name: 'Ann Example', email: 'ann@example.com' },
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
    customerName: 'Ann',
  };
  return caseObj;
}

function ctxFor(caseObj, params = {}) {
  return { caseObj, repoRoot: '/nonexistent', params };
}

test('composes a proposed solution from confirmed hypotheses + evidence, with a rollback note', async () => {
  const caseObj = freshCase();
  const hypothesis = addHypothesis(caseObj, {
    statement: 'The payments PDB prevents pod eviction on the node',
  });
  const evidence = addEvidence(caseObj, {
    type: 'environment',
    source: 'kube',
    summary: 'Node payments-1 blocked by pdb-blocks-eviction.',
    agentId: 'sre',
  });
  setHypothesisStatus(caseObj, hypothesis.id, 'confirmed', [evidence.id]);
  const deadEnd = addHypothesis(caseObj, { statement: 'The node is not CAST AI managed' });
  setHypothesisStatus(caseObj, deadEnd.id, 'rejected');

  const architect = createArchitect({ llm: undefined, tools: undefined });
  const { solution } = await architect.run(ctxFor(caseObj));

  assert.equal(solution.status, 'proposed');
  assert.equal(caseObj.solution, solution);
  assert.ok(solution.summary.length > 0);
  assert.ok(Array.isArray(solution.steps));
  assert.ok(solution.steps.length >= 2, 'fix steps plus rollback');
  // PDB-specific fix and alternative, driven by the confirmed hypothesis + evidence.
  assert.ok(solution.steps.some((s) => /PodDisruptionBudget/i.test(s)));
  assert.ok(solution.steps.some((s) => /Alternative:/.test(s)));
  // Rollback note is always the final step.
  assert.match(solution.steps[solution.steps.length - 1], /^Rollback:/);
  // The rejected hypothesis contributes no step.
  assert.ok(!solution.steps.some((s) => /not CAST AI managed/.test(s)));
});

test('rejected hypotheses stay open-ended out of the plan; no duplicates per rule', async () => {
  const caseObj = freshCase();
  const h1 = addHypothesis(caseObj, { statement: 'PDB blocks eviction' });
  const h2 = addHypothesis(caseObj, { statement: 'PodDisruptionBudget is the blocker' });
  setHypothesisStatus(caseObj, h1.id, 'confirmed');
  setHypothesisStatus(caseObj, h2.id, 'confirmed');

  const { solution } = await createArchitect().run(ctxFor(caseObj));
  const pdbSteps = solution.steps.filter((s) => /PodDisruptionBudget/.test(s));
  assert.equal(pdbSteps.length, 1, 'rule contributes its steps once');
});

test('no confirmed hypotheses: still proposes a generic plan that ends with rollback', async () => {
  const caseObj = freshCase();
  addHypothesis(caseObj, { statement: 'maybe DNS, still open' });

  const { solution } = await createArchitect().run(ctxFor(caseObj));
  assert.equal(solution.status, 'proposed');
  assert.ok(solution.steps.length >= 2);
  assert.match(solution.steps[solution.steps.length - 1], /^Rollback:/);
});

test('records trace entries for start and solution.proposed', async () => {
  const caseObj = freshCase();
  const h = addHypothesis(caseObj, { statement: 'pods have local storage' });
  setHypothesisStatus(caseObj, h.id, 'confirmed');

  await createArchitect().run(ctxFor(caseObj));
  const actions = caseObj.trace.filter((t) => t.actor === 'architect').map((t) => t.action);
  assert.ok(actions.includes('architect.start'));
  assert.ok(actions.includes('solution.proposed'));
  const { solution } = caseObj;
  assert.ok(solution.steps.some((s) => /local storage/i.test(s)));
});

test('local-storage evidence linked through a confirmed hypothesis drives the local-storage step', async () => {
  const caseObj = freshCase('product_bug');
  const hypothesis = addHypothesis(caseObj, { statement: 'pod has local storage' });
  const ev = addEvidence(caseObj, {
    type: 'environment',
    source: 'kube',
    summary: 'pod-has-local-storage blocks the drain',
    agentId: 'sre',
  });
  setHypothesisStatus(caseObj, hypothesis.id, 'confirmed', [ev.id]);

  const { solution } = await createArchitect().run(ctxFor(caseObj));
  assert.ok(solution.steps.some((s) => /local storage/i.test(s)));
  assert.match(solution.steps[solution.steps.length - 1], /^Rollback:/);
});

test('unlinked KB evidence about upscale adds no node-template step to a downscale answer', async () => {
  const caseObj = freshCase();
  const hypothesis = addHypothesis(caseObj, {
    statement: 'The payments PDB prevents pod eviction on the node',
  });
  const env = addEvidence(caseObj, {
    type: 'environment',
    source: 'kube',
    summary: 'Node payments-1 blocked by pdb-blocks-eviction.',
    agentId: 'sre',
  });
  setHypothesisStatus(caseObj, hypothesis.id, 'confirmed', [env.id]);
  // Researcher KB noise mentioning upscale topics, NOT linked to the confirmed hypothesis.
  addEvidence(caseObj, {
    type: 'documentation',
    source: 'kb',
    ref: '.kimchi/docs/karpenter-castai-eks-analysis.md',
    summary: 'Comparison: CAST AI provisions capacity for pending pods on scale up faster than Karpenter.',
    agentId: 'researcher',
  });

  const { solution } = await createArchitect().run(ctxFor(caseObj));

  assert.ok(solution.steps.some((s) => /PodDisruptionBudget/i.test(s)), 'PDB step still present');
  assert.ok(
    !solution.steps.some((s) => /node template constraints|headroom to provision/i.test(s)),
    'no upscale step contributed by unlinked KB evidence',
  );
  assert.match(solution.steps[solution.steps.length - 1], /^Rollback:/);
});

test('token_rotation: customer-scoped rule fires on the customer words without any confirmed hypothesis', async () => {
  const caseObj = freshCase('token_rotation');
  caseObj.thread.subject = '401 Authorization Required after cluster token rotation';
  caseObj.thread.messages[0].body = 'We rotated the cluster token and now the controller logs 401.';
  caseObj.triage.questions = ['Old token validity — how long?', 'Org API key usable instead?'];

  const { solution } = await createArchitect().run(ctxFor(caseObj));

  assert.ok(solution.steps.some((s) => /update every secret/i.test(s)), 'rotation propagation step');
  assert.ok(solution.steps.some((s) => /organization API key is not a substitute/i.test(s)), 'org-key caveat');
  assert.match(solution.steps[solution.steps.length - 1], /^Rollback:/);
});
