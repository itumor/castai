import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SreInvestigatorAgent } from '../../../src/agents/sre-investigator.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { MockCastaiTools } from '../../../src/adapters/castai/mock-castai-tools.js';
import { MockK8sClient } from '../../../src/adapters/k8s/mock-k8s-client.js';
import { createLedger, addHypothesis } from '../../../src/core/ledger.js';

const CLUSTER_ID = '11111111-1111-1111-1111-111111111111';

const VOTES = {
  votes: [
    { id: 'H1', vote: 'confirmed', reason: 'node n-1 is NotReady', evidenceIds: ['E1'] },
    { id: 'H2', vote: 'rejected', reason: 'autoscaler reports healthy' },
    { id: 'H3', vote: 'inconclusive', reason: 'no billing data collected' },
  ],
};

function makeLedger() {
  const ledger = createLedger('case-sre', null);
  addHypothesis(ledger, 'A node is NotReady so pods stay pending');
  addHypothesis(ledger, 'The workload autoscaler is misconfigured');
  addHypothesis(ledger, 'A billing bug caused the cost anomaly');
  return ledger;
}

function makeAgent({ ledger, castai, k8s, brain } = {}) {
  const adapters = {};
  if (castai !== undefined) adapters.castai = castai;
  if (k8s !== undefined) adapters.k8s = k8s;
  return new SreInvestigatorAgent({
    brain: brain ?? new ScriptedBrain({ defaultResponse: JSON.stringify(VOTES) }),
    ledger: ledger ?? makeLedger(),
    adapters,
  });
}

describe('SreInvestigatorAgent', () => {
  test('collects telemetry from castai + k8s and votes on hypotheses', async () => {
    const castai = new MockCastaiTools({
      get_cluster_nodes: (args) => ({ clusterId: args.clusterId, nodes: [{ name: 'n-1', status: 'NotReady' }] }),
      get_cluster_utilization: { cpu: 0.3, memory: 0.5 },
      get_workload_autoscaler_status: { mode: 'node-autoscaler', healthy: true },
      get_recent_optimization_actions: [],
    });
    const k8s = new MockK8sClient({
      get: (kind) => (kind === 'pods' ? { items: [{ name: 'p-1', phase: 'Pending' }] } : { items: [] }),
    });
    const ledger = makeLedger();
    const agent = makeAgent({ ledger, castai, k8s });

    const result = await agent.execute({
      clusterId: CLUSTER_ID,
      podFacts: true,
      hypotheses: [
        { id: 'H1', statement: 'A node is NotReady so pods stay pending' },
        { id: 'H2', statement: 'The workload autoscaler is misconfigured' },
        { id: 'H3', statement: 'A billing bug caused the cost anomaly' },
      ],
    });

    assert.equal(result.ok, true, result.error ?? '');
    // The fixed castai tool sequence ran with the case clusterId.
    assert.deepEqual(castai.calls.map((c) => c.toolName), [
      'get_cluster_nodes', 'get_cluster_utilization',
      'get_workload_autoscaler_status', 'get_recent_optimization_actions',
    ]);
    assert.ok(castai.calls.every((c) => c.args.clusterId === CLUSTER_ID));
    // Pod-level facts via k8s get('pods') + get('events').
    assert.deepEqual(k8s.calls.map((c) => c.args[0]), ['pods', 'events']);
    // Six telemetry evidence entries, one per successful call.
    assert.equal(ledger.evidence.length, 6);
    assert.deepEqual(ledger.evidence.map((e) => e.source), [
      'mcp:get_cluster_nodes', 'mcp:get_cluster_utilization',
      'mcp:get_workload_autoscaler_status', 'mcp:get_recent_optimization_actions',
      'kubectl:get', 'kubectl:get',
    ]);
    for (const ev of ledger.evidence) {
      assert.equal(ev.type, 'telemetry');
      assert.equal(ev.toolRun.ok, true);
      assert.ok(ev.result.length <= 400, 'result must be a ≤400 char summary');
    }
    // Reference carries the call signature; toolRun.args carries the clusterId linkage.
    assert.match(ledger.evidence[0].reference, /get_cluster_nodes/);
    assert.ok(ledger.evidence[0].reference.includes(CLUSTER_ID));
    assert.ok(ledger.evidence.slice(0, 4).every((e) => e.toolRun.args.clusterId === CLUSTER_ID));
    assert.match(ledger.evidence[0].result, /NotReady/);
    assert.match(ledger.evidence[4].reference, /"kind":"pods"/);
    assert.deepEqual(result.evidenceIds, ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
    // Hypothesis votes and status updates.
    assert.deepEqual(result.output.hypothesisVotes, [
      { id: 'H1', vote: 'confirmed', reason: 'node n-1 is NotReady' },
      { id: 'H2', vote: 'rejected', reason: 'autoscaler reports healthy' },
      { id: 'H3', vote: 'inconclusive', reason: 'no billing data collected' },
    ]);
    assert.equal(ledger.hypotheses[0].status, 'confirmed');
    assert.deepEqual(ledger.hypotheses[0].evidenceIds, ['E1']);
    assert.equal(ledger.hypotheses[1].status, 'rejected');
    assert.deepEqual(ledger.hypotheses[1].evidenceIds, ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
    assert.equal(ledger.hypotheses[2].status, 'open');
    assert.deepEqual(ledger.hypotheses[2].evidenceIds, []);
    // toolRuns mirror the successful calls.
    assert.equal(result.output.toolRuns.length, 6);
    assert.ok(result.output.toolRuns.every((t) => t.ok === true));
  });

  test('a failing tool call is recorded as ok:false toolRun without crashing', async () => {
    const castai = new MockCastaiTools({
      get_cluster_nodes: () => { throw new Error('tool missing from server'); },
      get_cluster_utilization: { cpu: 0.2 },
    });
    const ledger = makeLedger();
    const agent = makeAgent({ ledger, castai, k8s: new MockK8sClient({}) });

    const result = await agent.execute({ clusterId: CLUSTER_ID });

    assert.equal(result.ok, true, result.error ?? '');
    const failed = result.output.toolRuns.filter((t) => !t.ok);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].tool, 'get_cluster_nodes');
    assert.match(failed[0].error, /tool missing from server/);
    assert.ok(result.output.toolRuns.filter((t) => t.ok).length === 3);
    // Failures never land in the ledger; successes do (3 calls succeeded).
    assert.equal(ledger.evidence.length, 3);
    assert.ok(ledger.evidence.every((e) => e.toolRun.ok === true));
  });

  test('absent adapters degrade to ok:false toolRuns, no evidence, no crash', async () => {
    const ledger = makeLedger();
    const agent = makeAgent({ ledger }); // no castai, no k8s

    const result = await agent.execute({ clusterId: CLUSTER_ID, podFacts: true });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(ledger.evidence.length, 0);
    assert.equal(result.output.toolRuns.length, 6);
    assert.ok(result.output.toolRuns.every((t) => t.ok === false));
    // Hypotheses untouched: no telemetry evidence to support any vote.
    assert.ok(ledger.hypotheses.every((h) => h.status === 'open'));
  });

  test('no task.hypotheses → no brain call, empty votes', async () => {
    // A brain with no matching rule would throw if called.
    const brain = new ScriptedBrain({ steps: [] });
    const agent = makeAgent({
      brain,
      castai: new MockCastaiTools({ get_cluster_nodes: { nodes: [] } }),
      k8s: new MockK8sClient({}),
    });

    const result = await agent.execute({ clusterId: CLUSTER_ID });

    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(result.output.hypothesisVotes, []);
    assert.equal(result.evidenceIds.length, 4);
  });

  test('missing task.clusterId → ok:false', async () => {
    const agent = makeAgent({ castai: new MockCastaiTools({}), k8s: new MockK8sClient({}) });
    const result = await agent.execute({ podFacts: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /clusterId/);
  });
});
