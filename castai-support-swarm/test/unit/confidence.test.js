import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFromLedger, routeFromScore } from '../../src/core/confidence.js';
import {
  createLedger, addEvidence, addHypothesis, setHypothesisStatus, setTests,
} from '../../src/core/ledger.js';

function triageFacts(clusterId) {
  return {
    orgId: null,
    clusterId,
    provider: 'eks',
    castaiMode: 'unknown',
    components: [],
    issueCategory: 'node_upscale',
    severity: 'P2',
    expected: 'nodes join',
    actual: 'nodes NotReady',
    missingInfo: [],
  };
}

function baseLedger({ clusterId = null } = {}) {
  const ledger = createLedger('case-1', clusterId ? triageFacts(clusterId) : null);
  // The orchestrator attaches the case cluster context as ledger.triage;
  // createLedger only snapshots provider, so tests mirror that attachment.
  if (clusterId) ledger.triage = triageFacts(clusterId);
  return ledger;
}

// One confirmed hypothesis backed by exactly the given evidence specs.
function confirmedLedger(evidenceSpecs, { clusterId = null, tests = null } = {}) {
  const ledger = baseLedger({ clusterId });
  const hypothesis = addHypothesis(ledger, 'node not joining');
  const ids = evidenceSpecs.map((spec) => addEvidence(ledger, spec).id);
  setHypothesisStatus(ledger, hypothesis.id, 'confirmed', ids);
  if (tests) setTests(ledger, tests);
  return ledger;
}

const DOCS = { type: 'documentation', source: 'docs.cast.ai', result: 'scale-down doc' };
const CODE = { type: 'code', source: 'github castai', result: 'evictor code path' };
const REPRO = { type: 'reproduction', source: 'sandbox', result: 'reproduced NotReady', reproduced: true };
const REPRO_FAILED = { type: 'reproduction', source: 'sandbox', result: 'could not reproduce', reproduced: false };
const telemetry = (clusterId, ok = true) => ({
  type: 'telemetry',
  source: 'mcp castai',
  result: 'nodes observed',
  toolRun: { tool: 'castai_get_cluster', args: { clusterId }, ok },
});
const KUBECTL = {
  type: 'telemetry',
  source: 'kubectl get nodes',
  result: 'nodes NotReady',
  toolRun: { tool: 'kubectl', args: {}, ok: true },
};
const NOT_RUN = { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' };
const E2E_PASSED = { ...NOT_RUN, e2e: 'passed' };
const E2E_FAILED = { ...NOT_RUN, e2e: 'failed' };

test('scoreFromLedger: point sources alone and in combination', () => {
  const cases = [
    { name: 'empty ledger (no hypothesis)', build: () => baseLedger(), score: 0 },
    { name: 'confirmed hypothesis without evidence', build: () => confirmedLedger([]), score: 0 },
    { name: 'open hypothesis only', build: () => {
        const l = baseLedger();
        const h = addHypothesis(l, 'maybe');
        setHypothesisStatus(l, h.id, 'open', []);
        return l;
      }, score: 0 },
    { name: 'docs only', build: () => confirmedLedger([DOCS]), score: 20 },
    { name: 'code only', build: () => confirmedLedger([CODE]), score: 25 },
    { name: 'reproduction only', build: () => confirmedLedger([REPRO]), score: 25 },
    { name: 'e2e passed only', build: () => confirmedLedger([], { tests: E2E_PASSED }), score: 20 },
    { name: 'telemetry only (cluster-linked)', build: () => confirmedLedger([telemetry('c1')], { clusterId: 'c1' }), score: 10 },
    { name: 'docs + telemetry', build: () => confirmedLedger([DOCS, telemetry('c1')], { clusterId: 'c1' }), score: 30 },
    { name: 'code + repro', build: () => confirmedLedger([CODE, REPRO]), score: 50 },
    { name: 'all five', build: () => confirmedLedger([DOCS, CODE, REPRO, telemetry('c1')], { clusterId: 'c1', tests: E2E_PASSED }), score: 100 },
  ];
  for (const c of cases) {
    assert.equal(scoreFromLedger(c.build()), c.score, c.name);
  }
});

test('scoreFromLedger: each category counted at most once (cap 100)', () => {
  const ledger = confirmedLedger(
    [DOCS, { ...DOCS }, CODE, REPRO, telemetry('c1')],
    { clusterId: 'c1', tests: E2E_PASSED }
  );
  assert.equal(scoreFromLedger(ledger), 100);
});

test('scoreFromLedger: rejected hypotheses contribute nothing', () => {
  const ledger = baseLedger();
  const rejected = addHypothesis(ledger, 'wrong theory');
  const evidenceIds = [addEvidence(ledger, DOCS).id, addEvidence(ledger, CODE).id];
  setHypothesisStatus(ledger, rejected.id, 'rejected', evidenceIds);
  assert.equal(scoreFromLedger(ledger), 0);
});

test('scoreFromLedger: rejected evidence does not leak into confirmed hypothesis', () => {
  const ledger = baseLedger();
  const rejected = addHypothesis(ledger, 'wrong theory');
  setHypothesisStatus(ledger, rejected.id, 'rejected', [addEvidence(ledger, CODE).id]);
  const confirmed = addHypothesis(ledger, 'right theory');
  setHypothesisStatus(ledger, confirmed.id, 'confirmed', []);
  assert.equal(scoreFromLedger(ledger), 0);
});

test('scoreFromLedger: toolRun.ok === false telemetry contributes nothing', () => {
  const ledger = confirmedLedger([telemetry('c1', false)], { clusterId: 'c1' });
  assert.equal(scoreFromLedger(ledger), 0);
});

test('scoreFromLedger: reproduction without reproduced:true contributes nothing', () => {
  assert.equal(scoreFromLedger(confirmedLedger([REPRO_FAILED])), 0);
  const bare = { type: 'reproduction', source: 'sandbox', result: 'attempted' };
  assert.equal(scoreFromLedger(confirmedLedger([bare])), 0);
});

test('scoreFromLedger: not_run and failed e2e tests contribute nothing', () => {
  assert.equal(scoreFromLedger(confirmedLedger([], { tests: NOT_RUN })), 0);
  assert.equal(scoreFromLedger(confirmedLedger([], { tests: E2E_FAILED })), 0);
});

test('scoreFromLedger: telemetry clusterId must match case cluster context', () => {
  assert.equal(scoreFromLedger(confirmedLedger([telemetry('c2')], { clusterId: 'c1' })), 0);
  const noClusterInArgs = {
    type: 'telemetry', source: 'mcp castai', result: 'observed',
    toolRun: { tool: 'castai_get_nodes', args: {}, ok: true },
  };
  assert.equal(scoreFromLedger(confirmedLedger([noClusterInArgs], { clusterId: 'c1' })), 0);
});

test('scoreFromLedger: kubectl-sourced telemetry counts regardless of args.clusterId', () => {
  assert.equal(scoreFromLedger(confirmedLedger([KUBECTL], { clusterId: 'c1' })), 10);
});

test('scoreFromLedger: no fallback — non-kubectl telemetry without case cluster context contributes nothing', () => {
  // ledger has NO triage clusterId; arbitrary mcp-sourced telemetry must not count.
  assert.equal(scoreFromLedger(confirmedLedger([telemetry('anything')])), 0);
  // kubectl-sourced telemetry still counts without case cluster context.
  assert.equal(scoreFromLedger(confirmedLedger([KUBECTL])), 10);
  const noToolRun = { type: 'telemetry', source: 'dashboard', result: 'screenshot notes', toolRun: null };
  assert.equal(scoreFromLedger(confirmedLedger([noToolRun])), 0);
});

test('scoreFromLedger: multiple confirmed hypotheses — most evidence wins', () => {
  const ledger = baseLedger({ clusterId: 'c1' });
  const weak = addHypothesis(ledger, 'weak theory');
  setHypothesisStatus(ledger, weak.id, 'confirmed', [addEvidence(ledger, DOCS).id]);
  const strong = addHypothesis(ledger, 'strong theory');
  const ids = [
    addEvidence(ledger, CODE).id,
    addEvidence(ledger, REPRO).id,
    addEvidence(ledger, telemetry('c1')).id,
  ];
  setHypothesisStatus(ledger, strong.id, 'confirmed', ids);
  assert.equal(scoreFromLedger(ledger), 60);
});

test('routeFromScore: exact boundaries', () => {
  const cases = [
    [0, 'ask_or_escalate'],
    [59, 'ask_or_escalate'],
    [60, 'answer_with_uncertainty'],
    [80, 'answer_with_uncertainty'],
    [81, 'answer_with_evidence'],
    [95, 'answer_with_evidence'],
    [96, 'fully_verified'],
    [100, 'fully_verified'],
  ];
  for (const [score, route] of cases) {
    assert.equal(routeFromScore(score), route, `score ${score}`);
  }
});
