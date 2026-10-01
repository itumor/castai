import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BaseAgent, buildAgentResult } from '../../../src/agents/base-agent.js';
import { PermissionError } from '../../../src/permissions.js';
import { createLedger } from '../../../src/core/ledger.js';

class StubAgent extends BaseAgent {
  constructor(opts) {
    super(opts);
    this.rolePrompt = 'stub role prompt';
  }

  async _run(task, ctx) {
    this.lastCtx = ctx;
    // Exercise the brain on every run so brain failures surface in execute().
    await ctx.brain.complete([
      { role: 'system', content: 'stub' },
      { role: 'user', content: 'go' },
    ]);
    if (task?.addEvidence) {
      ctx.addEvidence({ type: 'documentation', source: 'kb:x.md', result: 'found it', reference: 'x.md' });
    }
    return { done: true, task: task ?? null };
  }
}

describe('BaseAgent constructor', () => {
  test('throws on unknown agent key (no PERMISSIONS entry)', () => {
    assert.throws(
      () => new StubAgent({ key: 'not-an-agent', ledger: createLedger('c1', null) }),
      /PERMISSIONS/
    );
  });
});

describe('permission-filtered adapter proxy', () => {
  test("support-writer accessing the k8s adapter throws PermissionError on property access", () => {
    const agent = new StubAgent({
      key: 'support-writer',
      ledger: createLedger('c1', null),
      adapters: { k8s: { get: async () => 'pods' }, draft: { save: async () => 'saved' } },
    });
    assert.throws(() => agent.adapters.k8s, PermissionError);
    // ...even for a property read short-circuit like `in` through get trap.
    assert.throws(() => `${agent.adapters.k8s}`, PermissionError);
  });

  test('allowed adapter (support-writer → draft) passes through and works', async () => {
    const agent = new StubAgent({
      key: 'support-writer',
      ledger: createLedger('c1', null),
      adapters: { draft: { save: async (x) => `saved:${x}` } },
    });
    assert.equal(await agent.adapters.draft.save('hello'), 'saved:hello');
  });

  test('allowed read adapter (sre-investigator → castai) passes through', async () => {
    const agent = new StubAgent({
      key: 'sre-investigator',
      ledger: createLedger('c1', null),
      adapters: { castai: { listClusters: async () => ['c1', 'c2'] } },
    });
    assert.deepEqual(await agent.adapters.castai.listClusters(), ['c1', 'c2']);
  });

  test('none-level adapter throws even when no adapter instance was supplied', () => {
    const agent = new StubAgent({ key: 'triage', ledger: createLedger('c1', null), adapters: {} });
    assert.throws(() => agent.adapters.sandbox, PermissionError);
  });
});

describe('execute()', () => {
  test('catches brain errors into ok:false AgentResult with redacted error', async () => {
    const brain = {
      complete: async () => { throw new Error('brain boom: api_key=supersecret123'); },
    };
    const agent = new StubAgent({ key: 'triage', brain, ledger: createLedger('c1', null) });
    const result = await agent.execute({ some: 'task' });
    assert.equal(result.ok, false);
    assert.equal(result.output, null);
    assert.deepEqual(result.evidenceIds, []);
    assert.match(result.error, /brain boom/);
    assert.match(result.error, /\[REDACTED\]/);
    assert.ok(!result.error.includes('supersecret123'));
    // Recorded in the audit log.
    const last = agent.ledger.auditLog.at(-1);
    assert.equal(last.agent, 'triage');
    assert.equal(last.action, 'execute');
  });

  test('successful run returns output and collects appended evidence ids', async () => {
    const brain = { complete: async () => 'ok' };
    const agent = new StubAgent({
      key: 'docs-researcher',
      brain,
      ledger: createLedger('c1', null),
    });
    const result = await agent.execute({ addEvidence: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.output, { done: true, task: { addEvidence: true } });
    assert.deepEqual(result.evidenceIds, ['E1']);
    assert.equal(agent.ledger.evidence[0].type, 'documentation');
    const last = agent.ledger.auditLog.at(-1);
    assert.equal(last.action, 'execute');
  });

  test('subclass without _run yields ok:false', async () => {
    class NoRun extends BaseAgent {}
    const agent = new NoRun({ key: 'supervisor', ledger: createLedger('c1', null), brain: { complete: async () => 'x' } });
    const result = await agent.execute({});
    assert.equal(result.ok, false);
    assert.match(result.error, /_run/);
  });
});

describe('buildPrompt()', () => {
  test('emits system role prompt and redacted ledger JSON in the user message', () => {
    const ledger = createLedger('c1', null);
    ledger.evidence.push({
      id: 'E1', type: 'telemetry', source: 'mcp:get_cluster_nodes',
      result: 'node down, Authorization: Bearer sk-secret123', reference: '',
      capturedAt: '2026-01-01T00:00:00Z', toolRun: null,
    });
    const agent = new StubAgent({ key: 'triage', ledger });
    const messages = agent.buildPrompt({ foo: 'bar' });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[0].content, 'stub role prompt');
    assert.equal(messages[1].role, 'user');
    const parsed = JSON.parse(messages[1].content);
    assert.deepEqual(parsed.task, { foo: 'bar' });
    assert.equal(parsed.ledger.caseId, 'c1');
    assert.ok(parsed.ledger.evidence[0].result.includes('[REDACTED]'));
    assert.ok(!messages[1].content.includes('sk-secret123'));
  });
});

describe('buildAgentResult()', () => {
  test('error results: output null, evidenceIds empty, error redacted', () => {
    const r = buildAgentResult('triage', false, { x: 1 }, ['E1'], 'Authorization: Token abc123');
    assert.deepEqual(r, {
      agent: 'triage', ok: false, output: null, evidenceIds: [],
      error: 'Authorization: Token [REDACTED]',
    });
  });

  test('success results pass output through', () => {
    const r = buildAgentResult('triage', true, { triageFacts: {} }, [], null);
    assert.equal(r.ok, true);
    assert.deepEqual(r.output, { triageFacts: {} });
    assert.equal(r.error, null);
  });
});
