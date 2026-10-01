// tests/agents/base.test.js — src/agents/base.js (shared agent factory).
// Verifies: agent shape, start/end trace recording, and the permission guard
// that refuses tools not listed in AGENT_PERMISSIONS.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAgent } from '../../src/agents/base.js';
import { createCase } from '../../src/core/model.js';
import { AGENT_PERMISSIONS, PolicyError } from '../../src/core/policy.js';

function fakeCtx() {
  const caseObj = createCase({
    id: 'case-base',
    thread: {
      from: 'Test User <test@example.com>',
      subject: 'test subject',
      messages: [{ from: 'Test User <test@example.com>', date: '2026-01-01', body: 'hello' }],
    },
    customer: { name: 'Test User', email: 'test@example.com' },
  });
  return { caseObj, repoRoot: '/Users/eramadan/castai', params: {} };
}

test('createAgent returns { id, name, permissions, run }', () => {
  const agent = createAgent({
    id: 'triage',
    name: 'Triage Analyst',
    handler: async () => ({ ok: true }),
  });
  assert.equal(agent.id, 'triage');
  assert.equal(agent.name, 'Triage Analyst');
  // permissions default to the AGENT_PERMISSIONS mirror for the id
  assert.equal(agent.permissions, AGENT_PERMISSIONS.triage);
  assert.equal(typeof agent.run, 'function');
});

test('createAgent defaults name to id and validates inputs', () => {
  const agent = createAgent({ id: 'researcher', handler: async () => ({}) });
  assert.equal(agent.name, 'researcher');
  assert.throws(() => createAgent({}), /id is required/);
  assert.throws(() => createAgent({ id: 'x' }), /handler must be a function/);
});

test('run records agent.start and agent.end on the case trace', async () => {
  const ctx = fakeCtx();
  const agent = createAgent({
    id: 'researcher',
    name: 'KB Researcher',
    handler: async () => ({ claimsAdded: 2, evidenceAdded: 1 }),
  });
  const result = await agent.run(ctx);

  assert.deepEqual(result, { claimsAdded: 2, evidenceAdded: 1 });
  const actions = ctx.caseObj.trace.map((entry) => entry.action);
  assert.deepEqual(actions, ['agent.start', 'agent.end']);
  assert.equal(ctx.caseObj.trace[0].actor, 'researcher');
  assert.equal(ctx.caseObj.trace[0].detail.name, 'KB Researcher');
  assert.equal(ctx.caseObj.trace[1].actor, 'researcher');
  assert.equal(ctx.caseObj.trace[1].detail.ok, true);
  assert.deepEqual(ctx.caseObj.trace[1].detail.resultKeys, ['claimsAdded', 'evidenceAdded']);
});

test('run refuses tools not listed in AGENT_PERMISSIONS (PolicyError)', async () => {
  const ctx = fakeCtx();
  const agent = createAgent({
    id: 'repro', // permissions: tools: ['lab']
    handler: async (_ctx, { useTool }) => {
      useTool('lab'); // allowed — must not throw
      useTool('castai'); // NOT in AGENT_PERMISSIONS.repro — must throw
      return {};
    },
  });

  await assert.rejects(agent.run(ctx), (error) => {
    assert.ok(error instanceof PolicyError);
    assert.match(error.message, /repro/);
    assert.match(error.message, /castai/);
    return true;
  });

  // failure is still traced: start + end with ok:false
  const actions = ctx.caseObj.trace.map((entry) => entry.action);
  assert.deepEqual(actions, ['agent.start', 'agent.end']);
  assert.equal(ctx.caseObj.trace[1].detail.ok, false);
  assert.match(ctx.caseObj.trace[1].detail.error, /not allowed/i);
});

test('useTool accepts every tool listed for the agent', async () => {
  const ctx = fakeCtx();
  const agent = createAgent({
    id: 'researcher', // tools: ['kb', 'docsSearch']
    handler: async (_ctx, { useTool }) => {
      assert.equal(useTool('kb'), 'kb');
      assert.equal(useTool('docsSearch'), 'docsSearch');
      return { done: true };
    },
  });
  await agent.run(ctx);
});

test('run requires a case object at ctx.caseObj', async () => {
  const agent = createAgent({ id: 'triage', handler: async () => ({}) });
  await assert.rejects(agent.run({}), /ctx\.caseObj/);
  await assert.rejects(agent.run(), /ctx\.caseObj/);
});
