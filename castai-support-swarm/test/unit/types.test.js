import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCase, validateTriageFacts, validateLedger, validateEvidence,
  validateHypothesis, validateVerdict, validateDraftPost,
} from '../../src/core/types.js';

const validTriage = {
  orgId: 'b58e6b73-9aa5-4c3f-8e2a-1a2b3c4d5e6f',
  clusterId: 'c2a1a36d-5c37-483f-9d92-3b7f6d7a5c6b',
  provider: 'eks',
  castaiMode: 'readonly',
  components: ['castai-agent', 'evictor'],
  issueCategory: 'rebalance',
  severity: 'P2',
  expected: 'Rebalancer consolidates nodes.',
  actual: 'Rebalancer is blocked by PDB.',
  missingInfo: ['PDB definition'],
};

const validEmail = {
  from: 'Jane Doe <jane@acme.com>',
  fromName: 'Jane Doe',
  fromFirstName: 'Jane',
  subject: 'Rebalance stuck',
  body: 'Nodes are not consolidating.',
  thread: [],
};

const validCase = {
  caseId: '9f8b5c3a-1f4e-4a8d-b4e9-2f1c6d8e7a0b',
  createdAt: '2026-01-01T00:00:00.000Z',
  source: 'email',
  email: validEmail,
  status: 'intake',
  triage: null,
  plan: null,
  loopsUsed: 0,
  maxLoops: 2,
};

const validHypothesis = {
  id: 'H1',
  statement: 'PDB blocks eviction.',
  status: 'open',
  evidenceIds: [],
};

const validEvidence = {
  id: 'E1',
  type: 'documentation',
  source: 'kb:brain/notes/notes.md',
  result: 'Evictor respects PDBs.',
  reference: 'brain/notes/notes.md:12',
  capturedAt: '2026-01-01T00:00:00.000Z',
  toolRun: null,
};

const validLedger = {
  caseId: '9f8b5c3a-1f4e-4a8d-b4e9-2f1c6d8e7a0b',
  customerQuestion: ['Why is rebalancing stuck?'],
  provider: 'eks',
  hypotheses: [validHypothesis],
  evidence: [validEvidence],
  tests: { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' },
  solution: { status: 'unsolved', summary: null },
  confidence: null,
  auditLog: [{ at: '2026-01-01T00:00:00.000Z', agent: 'triage', action: 'created', detail: 'ledger created' }],
};

const validVerdict = {
  pass: true,
  claims: [{ claim: 'PDB blocks eviction.', classification: 'DOCUMENTED', evidenceIds: ['E1'] }],
  reason: 'All claims backed by evidence.',
  openQuestions: null,
};

const validDraft = {
  to: 'jane@acme.com',
  subject: 'Re: Rebalance stuck',
  body: 'Your PDB blocks eviction.',
  caseId: '9f8b5c3a-1f4e-4a8d-b4e9-2f1c6d8e7a0b',
  confidence: 80,
  route: 'answer_with_evidence',
  unresolvedClaims: [],
};

test('validateTriageFacts accepts a valid instance', () => {
  const r = validateTriageFacts(validTriage);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validateTriageFacts rejects bad issueCategory naming field and value', () => {
  const r = validateTriageFacts({ ...validTriage, issueCategory: 'weird' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('issueCategory') && e.includes('weird')), r.errors.join('; '));
});

test('validateTriageFacts rejects bad provider, castaiMode and severity', () => {
  for (const [field, bad] of [['provider', 'onprem'], ['castaiMode', 'hyperdrive'], ['severity', 'P9']]) {
    const r = validateTriageFacts({ ...validTriage, [field]: bad });
    assert.equal(r.ok, false, field);
    assert.ok(r.errors.some((e) => e.includes(field) && e.includes(bad)), `${field}: ${r.errors.join('; ')}`);
  }
});

test('validateTriageFacts rejects non-object', () => {
  assert.equal(validateTriageFacts(null).ok, false);
  assert.equal(validateTriageFacts('x').ok, false);
});

test('validateCase accepts a valid instance and rejects a bad status', () => {
  assert.equal(validateCase(validCase).ok, true);
  const r = validateCase({ ...validCase, status: 'flying' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('status') && e.includes('flying')), r.errors.join('; '));
});

test('validateCase rejects missing caseId and non-ISO createdAt', () => {
  const r = validateCase({ ...validCase, caseId: '', createdAt: 'not-a-date' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('caseId')));
  assert.ok(r.errors.some((e) => e.includes('createdAt')));
});

test('validateLedger accepts a valid instance and rejects bad tests and solution', () => {
  assert.equal(validateLedger(validLedger).ok, true, JSON.stringify(validateLedger(validLedger).errors));

  const badTests = validateLedger({
    ...validLedger, tests: { ...validLedger.tests, unit: 'skipped' },
  });
  assert.equal(badTests.ok, false);
  assert.ok(badTests.errors.some((e) => e.includes('tests.unit') && e.includes('skipped')), badTests.errors.join('; '));

  const badSolution = validateLedger({
    ...validLedger, solution: { status: 'meh', summary: null },
  });
  assert.equal(badSolution.ok, false);
  assert.ok(badSolution.errors.some((e) => e.includes('solution.status') && e.includes('meh')), badSolution.errors.join('; '));
});

test('validateLedger rejects invalid nested evidence', () => {
  const r = validateLedger({ ...validLedger, evidence: [{ ...validEvidence, type: 'gossip' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('type') && e.includes('gossip')), r.errors.join('; '));
});

test('validateEvidence accepts a valid instance and rejects bad type and id', () => {
  assert.equal(validateEvidence(validEvidence).ok, true);
  const badType = validateEvidence({ ...validEvidence, type: 'rumor' });
  assert.equal(badType.ok, false);
  assert.ok(badType.errors.some((e) => e.includes('type') && e.includes('rumor')), badType.errors.join('; '));
  const badId = validateEvidence({ ...validEvidence, id: 'X1' });
  assert.equal(badId.ok, false);
  assert.ok(badId.errors.some((e) => e.includes('id')));
});

test('validateEvidence allows reproduced flag only on reproduction type', () => {
  assert.equal(
    validateEvidence({ ...validEvidence, type: 'reproduction', reproduced: true }).ok,
    true,
  );
  const r = validateEvidence({ ...validEvidence, reproduced: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('reproduced')), r.errors.join('; '));
});

test('validateEvidence validates toolRun shape', () => {
  assert.equal(validateEvidence({ ...validEvidence, toolRun: { tool: 'get_cluster_nodes', args: { clusterId: 'abc' }, ok: true } }).ok, true);
  const r = validateEvidence({ ...validEvidence, toolRun: { tool: 3, args: null, ok: 'yes' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('toolRun')));
});

test('validateHypothesis accepts a valid instance and rejects bad status', () => {
  assert.equal(validateHypothesis(validHypothesis).ok, true);
  const r = validateHypothesis({ ...validHypothesis, status: 'maybe' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('status') && e.includes('maybe')), r.errors.join('; '));
});

test('validateVerdict accepts a valid instance and rejects bad classification', () => {
  assert.equal(validateVerdict(validVerdict).ok, true);
  const r = validateVerdict({
    ...validVerdict,
    claims: [{ claim: 'x', classification: 'GUARANTEED', evidenceIds: [] }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('classification') && e.includes('GUARANTEED')), r.errors.join('; '));
});

test('validateDraftPost accepts a valid instance and rejects bad route', () => {
  assert.equal(validateDraftPost(validDraft).ok, true);
  const r = validateDraftPost({ ...validDraft, route: 'wing_it' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('route') && e.includes('wing_it')), r.errors.join('; '));
});

test('validateDraftPost rejects out-of-range confidence', () => {
  const r = validateDraftPost({ ...validDraft, confidence: 101 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('confidence')));
});

test('all validators reject null and non-objects', () => {
  for (const v of [validateCase, validateTriageFacts, validateLedger, validateEvidence,
    validateHypothesis, validateVerdict, validateDraftPost]) {
    assert.equal(v(null).ok, false, v.name);
    assert.equal(v(undefined).ok, false, v.name);
    assert.equal(v(42).ok, false, v.name);
  }
});
