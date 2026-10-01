import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintDraft } from '../../src/core/claim-linter.js';
import {
  createLedger, addEvidence, addHypothesis, setHypothesisStatus, setTests,
} from '../../src/core/ledger.js';

const DOCS = { type: 'documentation', source: 'docs.cast.ai', result: 'doc' };
const CODE = { type: 'code', source: 'github castai', result: 'code path' };
const REPRO = { type: 'reproduction', source: 'sandbox', result: 'reproduced NotReady', reproduced: true };
const TELEMETRY_OK = {
  type: 'telemetry', source: 'mcp castai', result: 'nodes observed',
  toolRun: { tool: 'castai_get_cluster', args: { clusterId: 'c1' }, ok: true },
};
const TELEMETRY_FAIL = {
  type: 'telemetry', source: 'mcp castai', result: 'tool error',
  toolRun: { tool: 'castai_get_cluster', args: { clusterId: 'c1' }, ok: false },
};
const NOT_RUN = { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' };
const E2E_PASSED = { ...NOT_RUN, e2e: 'passed' };
const E2E_FAILED = { ...NOT_RUN, e2e: 'failed' };

function ledgerWith(evidenceSpecs = [], { confirmedWith = null, tests = null, customerFirstName } = {}) {
  const ledger = createLedger('case-1', null);
  for (const spec of evidenceSpecs) addEvidence(ledger, spec);
  if (confirmedWith !== null) {
    const hypothesis = addHypothesis(ledger, 'hypothesis');
    setHypothesisStatus(ledger, hypothesis.id, 'confirmed', confirmedWith);
  }
  if (tests) setTests(ledger, tests);
  if (customerFirstName !== undefined) ledger.customerFirstName = customerFirstName;
  return ledger;
}

const violation = (res, phrase) => res.violations.find((v) => v.phrase === phrase);

// --- (3) "I reproduced it locally" acceptance pair ---

test('"I reproduced it locally" without reproduction evidence -> violation', () => {
  const res = lintDraft('I reproduced it locally on a sandbox cluster.', ledgerWith([]));
  assert.equal(res.ok, false);
  const v = violation(res, '(i|we) reproduced');
  assert.ok(v);
  assert.equal(v.requiredEvidenceType, 'reproduction');
  assert.equal(v.index, 0);
});

test('"I reproduced it locally" with reproduction evidence -> pass', () => {
  const res = lintDraft('I reproduced it locally on a sandbox cluster.', ledgerWith([REPRO]));
  assert.deepEqual(res, { ok: true, violations: [] });
});

test('"we reproduced" with reproduced:false evidence still violates', () => {
  const res = lintDraft('We reproduced it locally.', ledgerWith([{ ...REPRO, reproduced: false }]));
  assert.ok(violation(res, '(i|we) reproduced'));
});

// --- (4) cliché bans, regardless of ledger ---

const CLICHES = [
  'thank you for reaching out',
  'i hope this email finds you well',
  'as an ai',
  'delve',
  'certainly!',
  'i understand your frustration',
];

test('each banned cliché produces a requiredEvidenceType:null violation', () => {
  const rich = ledgerWith([DOCS, REPRO, TELEMETRY_OK], {
    confirmedWith: ['E1', 'E2', 'E3'],
    tests: E2E_PASSED,
    customerFirstName: 'Sarah',
  });
  for (const cliche of CLICHES) {
    const body = `Hi Sarah, ${cliche} — I checked your nodes and we confirmed it.`;
    const res = lintDraft(body, rich);
    const v = violation(res, cliche);
    assert.ok(v, `expected violation for "${cliche}"`);
    assert.equal(v.requiredEvidenceType, null, cliche);
  }
});

test('"Thank you for reaching out" violates even an otherwise-complete ledger', () => {
  const rich = ledgerWith([DOCS, REPRO, TELEMETRY_OK], { confirmedWith: ['E1', 'E2'], tests: E2E_PASSED });
  const res = lintDraft('Thank you for reaching out. I checked your cluster.', rich);
  assert.equal(res.ok, false);
  assert.equal(res.violations.length, 1);
  assert.equal(res.violations[0].phrase, 'thank you for reaching out');
  assert.equal(res.violations[0].requiredEvidenceType, null);
});

test('cliché violation index points at the match', () => {
  const body = 'Please do not delve deeper. Thank you for reaching out.';
  const res = lintDraft(body, ledgerWith([REPRO]));
  assert.equal(violation(res, 'delve').index, body.indexOf('delve'));
  assert.equal(violation(res, 'thank you for reaching out').index, body.indexOf('Thank you'));
});

// --- phrase table: positive and negative per phrase ---

const CHECKED_PHRASE = 'i checked (your )?(cluster|nodes|pods|events|cluster status|autoscaler|autoscaler status|workload|workloads|config|configuration|logs|savings)';

test('"i checked your cluster/nodes" needs telemetry with toolRun.ok true', () => {
  const body = 'I checked your cluster and your nodes.';
  const none = lintDraft(body, ledgerWith([]));
  assert.equal(none.ok, false);
  assert.equal(violation(none, CHECKED_PHRASE).requiredEvidenceType, 'telemetry');

  const failedRun = lintDraft(body, ledgerWith([TELEMETRY_FAIL]));
  assert.ok(violation(failedRun, CHECKED_PHRASE));

  assert.deepEqual(lintDraft('I checked pods this morning.', ledgerWith([TELEMETRY_OK])), { ok: true, violations: [] });
});

test('draft without any phrase produces no evidence-backed violations', () => {
  const res = lintDraft('I checked nodes today.', ledgerWith([]));
  assert.equal(res.violations.length, 1);
  assert.equal(res.violations[0].phrase, CHECKED_PHRASE);
});

test('"i/we reproduced" needs reproduction evidence with reproduced:true', () => {
  const body = 'We reproduced the failure.';
  const none = lintDraft(body, ledgerWith([]));
  assert.equal(violation(none, '(i|we) reproduced').requiredEvidenceType, 'reproduction');
  assert.deepEqual(lintDraft(body, ledgerWith([REPRO])), { ok: true, violations: [] });
});

test('"we/i confirmed|verified" needs a confirmed hypothesis with >=2 evidence', () => {
  const body = 'We confirmed the root cause.';
  const none = lintDraft(body, ledgerWith([]));
  assert.equal(violation(none, '(we|i) (confirmed|verified)').requiredEvidenceType, null);
  assert.equal(none.ok, false);

  const oneEvidence = lintDraft('I verified it.', ledgerWith([DOCS], { confirmedWith: ['E1'] }));
  assert.ok(violation(oneEvidence, '(we|i) (confirmed|verified)'));

  const twoEvidence = lintDraft(body, ledgerWith([DOCS, CODE], { confirmedWith: ['E1', 'E2'] }));
  assert.deepEqual(twoEvidence, { ok: true, violations: [] });
});

test('"our tests? (show|pass)" needs a passed ledger.tests level', () => {
  const body = 'Our tests pass in CI.';
  const notRun = lintDraft(body, ledgerWith([], { tests: NOT_RUN }));
  assert.equal(violation(notRun, 'our tests? (show|pass)').requiredEvidenceType, null);
  const failed = lintDraft(body, ledgerWith([], { tests: E2E_FAILED }));
  assert.ok(violation(failed, 'our tests? (show|pass)'));

  // These drafts satisfy the phrase rule but contain no concrete-checked-item
  // verb, so the spec-mandated 'concrete-checked-item' violation still fires;
  // assert only that the phrase under test is satisfied.
  assert.ok(!violation(lintDraft(body, ledgerWith([], { tests: E2E_PASSED })), 'our tests? (show|pass)'));
  assert.ok(!violation(lintDraft('Our test shows the fix works.', ledgerWith([], { tests: E2E_PASSED })), 'our tests? (show|pass)'));
});

test('"the docs say / per the documentation" needs documentation evidence', () => {
  const none = lintDraft('The docs say to raise scale-down-unneeded-time.', ledgerWith([]));
  assert.equal(violation(none, '(the docs say|per (the )?documentation)').requiredEvidenceType, 'documentation');

  const perDoc = lintDraft('Per the documentation, this is expected.', ledgerWith([]));
  assert.ok(violation(perDoc, '(the docs say|per (the )?documentation)'));

  assert.ok(!violation(lintDraft('Per documentation, this is expected.', ledgerWith([DOCS])), '(the docs say|per (the )?documentation)'));
});

// --- first-name and concrete-checked-item rules ---

test('first-name check applies only when ledger.customerFirstName is set', () => {
  // absent on ledger -> check skipped
  assert.deepEqual(lintDraft('Hello, I reproduced it locally.', ledgerWith([REPRO])), { ok: true, violations: [] });

  // present and used -> pass
  const used = lintDraft('Hi Sarah, I reproduced it locally.', ledgerWith([REPRO], { customerFirstName: 'Sarah' }));
  assert.deepEqual(used, { ok: true, violations: [] });

  // present and missing -> violation
  const missing = lintDraft('Hello, I reproduced it locally.', ledgerWith([REPRO], { customerFirstName: 'Sarah' }));
  assert.equal(missing.ok, false);
  const v = violation(missing, 'customer-first-name');
  assert.equal(v.index, -1);
  assert.equal(v.requiredEvidenceType, null);
  assert.match(v.message, /Sarah/);
});

test('draft with no concrete checked item violates', () => {
  const res = lintDraft('Here is my analysis. The eviction settings look wrong.', ledgerWith([DOCS]));
  assert.equal(res.ok, false);
  assert.equal(violation(res, 'concrete-checked-item').requiredEvidenceType, null);
  // bare regex satisfies: "tested" counts even with an empty ledger
  assert.deepEqual(lintDraft('I tested the fix in staging.', ledgerWith([])), { ok: true, violations: [] });
});

// --- combined behaviour ---

test('clean draft over a fully-supported ledger passes', () => {
  const ledger = ledgerWith([DOCS, CODE, REPRO, TELEMETRY_OK], {
    confirmedWith: ['E1', 'E2', 'E3', 'E4'],
    tests: E2E_PASSED,
    customerFirstName: 'Sarah',
  });
  const draft = 'Hi Sarah, I checked your nodes, we reproduced the issue, and we confirmed the root cause; '
    + 'our tests pass and per the documentation this setting is unsupported.';
  assert.deepEqual(lintDraft(draft, ledger), { ok: true, violations: [] });
});

test('same draft over an empty ledger collects one violation per unsatisfied phrase', () => {
  const draft = 'Hi Sarah, I checked your nodes, we reproduced the issue, and we confirmed the root cause; '
    + 'our tests pass and per the documentation this setting is unsupported.';
  const res = lintDraft(draft, ledgerWith([]));
  assert.equal(res.ok, false);
  assert.deepEqual(res.violations.map((v) => v.phrase), [
    'i checked (your )?(cluster|nodes|pods|events|cluster status|autoscaler|autoscaler status|workload|workloads|config|configuration|logs|savings)',
    '(i|we) reproduced',
    '(we|i) (confirmed|verified)',
    'our tests? (show|pass)',
    '(the docs say|per (the )?documentation)',
  ]);
});

test('lintDraft rejects non-string draft bodies', () => {
  assert.throws(() => lintDraft(null, ledgerWith([])), TypeError);
  assert.throws(() => lintDraft(42, ledgerWith([])), TypeError);
});

// --- broadened "i checked" table: cluster-adjacent subjects need telemetry ---

test('"I checked your autoscaler status" with no telemetry -> violation', () => {
  const res = lintDraft('I checked your autoscaler status and it looks fine.', ledgerWith([]));
  assert.equal(res.ok, false);
  const v = violation(res, 'i checked (your )?(cluster|nodes|pods|events|cluster status|autoscaler|autoscaler status|workload|workloads|config|configuration|logs|savings)');
  assert.ok(v, 'broadened i-checked rule must fire');
  assert.equal(v.requiredEvidenceType, 'telemetry');
});

test('"I checked your autoscaler status" with ok telemetry -> no violation', () => {
  const res = lintDraft('I checked your autoscaler status and it looks fine.', ledgerWith([TELEMETRY_OK]));
  assert.deepEqual(res.violations, []);
  assert.equal(res.ok, true);
});
