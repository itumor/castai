import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger, addEvidence, addHypothesis, setHypothesisStatus,
  setTests, setSolution, audit, cloneLedger,
} from '../../src/core/ledger.js';
import { validateLedger } from '../../src/core/types.js';

const triage = {
  orgId: null,
  clusterId: 'c2a1a36d-5c37-483f-9d92-3b7f6d7a5c6b',
  provider: 'eks',
  castaiMode: 'readonly',
  components: [],
  issueCategory: 'rebalance',
  severity: 'P2',
  expected: 'x',
  actual: 'y',
  missingInfo: [],
};

test('createLedger returns a fresh valid ledger', () => {
  const ledger = createLedger('case-1', triage);
  assert.equal(ledger.caseId, 'case-1');
  assert.equal(ledger.provider, 'eks');
  assert.deepEqual(ledger.tests, { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' });
  assert.deepEqual(ledger.solution, { status: 'unsolved', summary: null });
  assert.deepEqual(ledger.evidence, []);
  assert.deepEqual(ledger.hypotheses, []);
  assert.deepEqual(ledger.auditLog, []);
  assert.equal(validateLedger(ledger).ok, true);
});

test('createLedger rejects empty caseId and invalid triage', () => {
  assert.throws(() => createLedger('', triage), TypeError);
  assert.throws(() => createLedger('case-1', { ...triage, issueCategory: 'weird' }), TypeError);
});

test('addEvidence auto-ids E1..E1000 monotonically with no gaps', () => {
  const ledger = createLedger('case-1', triage);
  for (let i = 1; i <= 1000; i++) {
    const e = addEvidence(ledger, {
      type: 'telemetry',
      source: 'mcp:get_cluster_nodes',
      result: `observation ${i}`,
      reference: `ref-${i}`,
    });
    assert.equal(e.id, `E${i}`);
  }
  assert.equal(ledger.evidence.length, 1000);
  assert.deepEqual(ledger.evidence.map((e) => e.id), Array.from({ length: 1000 }, (_, i) => `E${i + 1}`));
});

test('addEvidence applies redactFn to result', () => {
  const ledger = createLedger('case-1', triage);
  const redact = (s) => s.replace(/castai_v1_\S+/g, '[REDACTED]');
  const e = addEvidence(ledger, {
    type: 'customer_statement',
    source: 'email',
    result: 'my key is castai_v1_secretsecret',
  }, redact);
  assert.equal(e.result, 'my key is [REDACTED]');
  assert.equal(ledger.evidence[0].result, 'my key is [REDACTED]');
});

test('addEvidence default redactFn is identity', () => {
  const ledger = createLedger('case-1', triage);
  const e = addEvidence(ledger, { type: 'code', source: 'src/x.go', result: 'plain result' });
  assert.equal(e.result, 'plain result');
});

test('addEvidence keeps toolRun and reproduced, sets capturedAt', () => {
  const ledger = createLedger('case-1', triage);
  const e = addEvidence(ledger, {
    type: 'reproduction',
    source: 'sandbox:sim-scenario-2',
    result: 'reproduced locally',
    toolRun: { tool: 'sandbox', args: { scenario: 'sim-scenario-2' }, ok: true },
    reproduced: true,
  });
  assert.equal(e.toolRun.args.scenario, 'sim-scenario-2');
  assert.equal(e.reproduced, true);
  assert.ok(!Number.isNaN(Date.parse(e.capturedAt)));
});

test('addEvidence rejects missing required fields and bad redactFn', () => {
  const ledger = createLedger('case-1', triage);
  assert.throws(() => addEvidence(ledger, { source: 's', result: 'r' }), TypeError);
  assert.throws(() => addEvidence(ledger, { type: 't', result: 'r' }), TypeError);
  assert.throws(() => addEvidence(ledger, { type: 't', source: 's' }), TypeError);
  assert.throws(() => addEvidence(ledger, { type: 't', source: 's', result: 'r' }, 'not-a-fn'), TypeError);
});

test('addHypothesis auto-ids H1, H2, ...', () => {
  const ledger = createLedger('case-1', triage);
  const h1 = addHypothesis(ledger, 'PDB blocks eviction.');
  const h2 = addHypothesis(ledger, 'Spot rebalance churn.');
  assert.equal(h1.id, 'H1');
  assert.equal(h1.status, 'open');
  assert.deepEqual(h1.evidenceIds, []);
  assert.equal(h2.id, 'H2');
});

test('setHypothesisStatus updates status and evidence refs', () => {
  const ledger = createLedger('case-1', triage);
  const h = addHypothesis(ledger, 'PDB blocks eviction.');
  addEvidence(ledger, { type: 'code', source: 'src', result: 'evictor respects PDB' });
  setHypothesisStatus(ledger, h.id, 'confirmed', ['E1']);
  assert.equal(ledger.hypotheses[0].status, 'confirmed');
  assert.deepEqual(ledger.hypotheses[0].evidenceIds, ['E1']);
});

test('setHypothesisStatus throws on unknown id', () => {
  const ledger = createLedger('case-1', triage);
  addHypothesis(ledger, 'only one');
  assert.throws(() => setHypothesisStatus(ledger, 'H99', 'confirmed', []), /H99/);
});

test('setHypothesisStatus rejects invalid status values', () => {
  const ledger = createLedger('case-1', triage);
  const h = addHypothesis(ledger, 'x');
  assert.throws(() => setHypothesisStatus(ledger, h.id, 'maybe', []), TypeError);
});

test('setTests sets all four levels and rejects bad values', () => {
  const ledger = createLedger('case-1', triage);
  setTests(ledger, { unit: 'passed', integration: 'failed', e2e: 'not_run', regression: 'passed' });
  assert.deepEqual(ledger.tests, { unit: 'passed', integration: 'failed', e2e: 'not_run', regression: 'passed' });
  assert.throws(() => setTests(ledger, { unit: 'skipped', integration: 'passed', e2e: 'passed', regression: 'passed' }), TypeError);
  assert.throws(() => setTests(ledger, null), TypeError);
});

test('setSolution sets status and summary and rejects bad values', () => {
  const ledger = createLedger('case-1', triage);
  setSolution(ledger, 'proposed', 'Adjust the PDB.');
  assert.deepEqual(ledger.solution, { status: 'proposed', summary: 'Adjust the PDB.' });
  assert.throws(() => setSolution(ledger, 'magic', null), TypeError);
});

test('audit appends ISO-timestamped entries in order', () => {
  const ledger = createLedger('case-1', triage);
  audit(ledger, 'triage', 'created', 'ledger created');
  audit(ledger, 'sre-investigator', 'evidence-added', 'E1');
  assert.equal(ledger.auditLog.length, 2);
  assert.equal(ledger.auditLog[0].agent, 'triage');
  assert.equal(ledger.auditLog[1].detail, 'E1');
  assert.ok(!Number.isNaN(Date.parse(ledger.auditLog[0].at)));
});

test('cloneLedger deep-copies: mutating clone leaves original untouched', () => {
  const ledger = createLedger('case-1', triage);
  addHypothesis(ledger, 'original hypothesis');
  addEvidence(ledger, { type: 'documentation', source: 'kb', result: 'original result' });
  audit(ledger, 'triage', 'created', 'x');

  const clone = cloneLedger(ledger);
  clone.caseId = 'case-2';
  clone.provider = 'aks';
  clone.tests.unit = 'passed';
  clone.solution.status = 'verified';
  clone.solution.summary = 'clone summary';
  clone.confidence = 99;
  clone.hypotheses[0].statement = 'mutated';
  clone.hypotheses[0].evidenceIds.push('E1');
  clone.evidence[0].result = 'mutated';
  clone.evidence.push({ id: 'E999' });
  clone.auditLog[0].detail = 'mutated';
  clone.auditLog.push({ at: 'now', agent: 'x', action: 'y', detail: 'z' });
  clone.customerQuestion.push('mutated?');

  assert.equal(ledger.caseId, 'case-1');
  assert.equal(ledger.provider, 'eks');
  assert.equal(ledger.tests.unit, 'not_run');
  assert.equal(ledger.solution.status, 'unsolved');
  assert.equal(ledger.solution.summary, null);
  assert.equal(ledger.confidence, null);
  assert.equal(ledger.hypotheses[0].statement, 'original hypothesis');
  assert.deepEqual(ledger.hypotheses[0].evidenceIds, []);
  assert.equal(ledger.evidence[0].result, 'original result');
  assert.equal(ledger.evidence.length, 1);
  assert.equal(ledger.auditLog[0].detail, 'x');
  assert.equal(ledger.auditLog.length, 1);
  assert.deepEqual(ledger.customerQuestion, []);
});

test('mutating original after clone does not affect the clone either', () => {
  const ledger = createLedger('case-1', triage);
  addEvidence(ledger, { type: 'code', source: 's', result: 'r' });
  const clone = cloneLedger(ledger);
  addEvidence(ledger, { type: 'test', source: 's2', result: 'r2' });
  assert.equal(clone.evidence.length, 1);
  assert.equal(ledger.evidence.length, 2);
});

test('full ledger remains valid after a realistic mutation sequence', () => {
  const ledger = createLedger('case-1', triage);
  addHypothesis(ledger, 'PDB blocks eviction.');
  addEvidence(ledger, { type: 'telemetry', source: 'mcp:get_cluster_nodes', result: '3 nodes pending' });
  setHypothesisStatus(ledger, 'H1', 'confirmed', ['E1']);
  setTests(ledger, { unit: 'passed', integration: 'passed', e2e: 'not_run', regression: 'not_run' });
  setSolution(ledger, 'proposed', 'Adjust the PDB to allow eviction.');
  audit(ledger, 'sre-investigator', 'evidence-added', 'E1');
  const v = validateLedger(ledger);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
