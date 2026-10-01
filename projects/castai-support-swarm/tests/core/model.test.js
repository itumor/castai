// tests/core/model.test.js — contract section 1 (src/core/model.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAIM_CLASSES,
  EVIDENCE_TYPES,
  createCase,
  addEvidence,
  addHypothesis,
  setHypothesisStatus,
  addClaim,
  linkEvidenceToClaim,
  claimClasses,
  computeConfidence,
  verifyClaims,
  confidenceGate,
} from '../../src/core/model.js';

function makeCase(id = 'case-1') {
  return createCase({
    id,
    thread: {
      from: 'Jane Doe <jane@example.com>',
      subject: 'node not scaling down',
      messages: [{ from: 'jane@example.com', date: '2026-01-01', body: 'help' }],
    },
    customer: { name: 'Jane Doe', email: 'jane@example.com', orgId: 'org-1', clusterId: 'clu-1' },
  });
}

test('CLAIM_CLASSES ladder matches the contract exactly', () => {
  assert.deepEqual(CLAIM_CLASSES, [
    'UNKNOWN',
    'INFERRED',
    'SUPPORTING',
    'DOCUMENTED',
    'ENV_CONFIRMED',
    'CODE_CONFIRMED',
    'TEST_CONFIRMED',
    'REPRODUCED',
    'VERIFIED',
  ]);
});

test('EVIDENCE_TYPES match the contract exactly', () => {
  assert.deepEqual(EVIDENCE_TYPES, {
    customer_statement: { cls: 'UNKNOWN', points: 0 },
    inference: { cls: 'INFERRED', points: 0 },
    prior_ticket: { cls: 'SUPPORTING', points: 5 },
    documentation: { cls: 'DOCUMENTED', points: 20 },
    api_spec: { cls: 'DOCUMENTED', points: 20 },
    environment: { cls: 'ENV_CONFIRMED', points: 10 },
    source_code: { cls: 'CODE_CONFIRMED', points: 25 },
    e2e_test: { cls: 'TEST_CONFIRMED', points: 20 },
    reproduction: { cls: 'REPRODUCED', points: 25 },
  });
});

test('createCase returns the full contract shape with defaults', () => {
  const c = makeCase();
  assert.equal(c.id, 'case-1');
  assert.equal(typeof c.createdAt, 'string');
  assert.equal(c.thread.subject, 'node not scaling down');
  assert.deepEqual(c.customer, { name: 'Jane Doe', email: 'jane@example.com', orgId: 'org-1', clusterId: 'clu-1' });
  assert.equal(c.triage, null);
  assert.equal(c.plan, null);
  assert.deepEqual(c.hypotheses, []);
  assert.deepEqual(c.evidence, []);
  assert.deepEqual(c.claims, []);
  assert.deepEqual(c.tests, { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' });
  assert.deepEqual(c.solution, { status: 'none', summary: '', steps: [] });
  assert.equal(c.confidence, 0);
  assert.equal(c.verdict, null);
  assert.equal(c.reply, null);
  assert.equal(c.escalation, null);
  assert.deepEqual(c.kbNotes, []);
  assert.deepEqual(c.trace, []);
});

test('addEvidence assigns sequential ids, timestamp, and optional ref', () => {
  const c = makeCase();
  const e1 = addEvidence(c, { type: 'documentation', source: 'kb', summary: 'docs say X', agentId: 'researcher' });
  assert.equal(e1.id, 'E1');
  assert.equal(e1.type, 'documentation');
  assert.equal(e1.source, 'kb');
  assert.equal(e1.summary, 'docs say X');
  assert.equal(e1.agentId, 'researcher');
  assert.equal(typeof e1.at, 'string');
  assert.equal('ref' in e1, false);

  const e2 = addEvidence(c, { type: 'api_spec', source: 'docs', ref: '.kimchi/docs/api.md', summary: 'spec', agentId: 'researcher' });
  assert.equal(e2.id, 'E2');
  assert.equal(e2.ref, '.kimchi/docs/api.md');
  assert.equal(c.evidence.length, 2);
});

test('addHypothesis + setHypothesisStatus lifecycle', () => {
  const c = makeCase();
  const h1 = addHypothesis(c, { statement: 'PDB prevents eviction' });
  assert.equal(h1.id, 'H1');
  assert.equal(h1.status, 'open');
  assert.deepEqual(h1.evidenceIds, []);

  const ev = addEvidence(c, { type: 'environment', source: 'kube', summary: 'pdb found', agentId: 'sre' });
  const updated = setHypothesisStatus(c, 'H1', 'confirmed', [ev.id]);
  assert.equal(updated.status, 'confirmed');
  assert.deepEqual(updated.evidenceIds, [ev.id]);

  // adding the same evidence id again does not duplicate
  setHypothesisStatus(c, 'H1', 'confirmed', [ev.id, 'E2']);
  assert.deepEqual(c.hypotheses[0].evidenceIds, ['E1', 'E2']);

  assert.throws(() => setHypothesisStatus(c, 'H99', 'rejected'), /Unknown hypothesis/);
});

test('addClaim defaults needsVerification=true, status proposed', () => {
  const c = makeCase();
  const c1 = addClaim(c, { statement: 'PDB blocks scale-down' });
  assert.equal(c1.id, 'C1');
  assert.equal(c1.needsVerification, true);
  assert.equal(c1.status, 'proposed');
  assert.deepEqual(c1.evidenceIds, []);

  const c2 = addClaim(c, { statement: 'sky is blue', needsVerification: false });
  assert.equal(c2.id, 'C2');
  assert.equal(c2.needsVerification, false);
});

test('linkEvidenceToClaim links, dedupes, and validates ids', () => {
  const c = makeCase();
  const claim = addClaim(c, { statement: 'x' });
  const ev = addEvidence(c, { type: 'documentation', source: 'kb', summary: 's', agentId: 'researcher' });

  const linked = linkEvidenceToClaim(c, claim.id, ev.id);
  assert.deepEqual(linked.evidenceIds, [ev.id]);
  linkEvidenceToClaim(c, claim.id, ev.id);
  assert.deepEqual(linked.evidenceIds, [ev.id]);

  assert.throws(() => linkEvidenceToClaim(c, 'C99', ev.id), /Unknown claim/);
  assert.throws(() => linkEvidenceToClaim(c, claim.id, 'E99'), /Unknown evidence/);
});

test('claimClasses derives unique ladder classes from linked evidence', () => {
  const c = makeCase();
  const claim = addClaim(c, { statement: 'x' });
  const d1 = addEvidence(c, { type: 'documentation', source: 'kb', summary: 's', agentId: 'researcher' });
  const d2 = addEvidence(c, { type: 'api_spec', source: 'api', summary: 's', agentId: 'researcher' });
  const r1 = addEvidence(c, { type: 'reproduction', source: 'lab', summary: 's', agentId: 'repro' });
  linkEvidenceToClaim(c, claim.id, d1.id);
  linkEvidenceToClaim(c, claim.id, d2.id);
  linkEvidenceToClaim(c, claim.id, r1.id);

  // documentation + api_spec both map to DOCUMENTED -> unique
  assert.deepEqual(claimClasses(c, claim.id), ['DOCUMENTED', 'REPRODUCED']);
  assert.deepEqual(claimClasses(c, 'C-does-not-exist'), []);
});

test('computeConfidence sums DISTINCT evidence-type points', () => {
  const c = makeCase();
  const claim = addClaim(c, { statement: 'x' });
  const d1 = addEvidence(c, { type: 'documentation', source: 'kb', summary: 's', agentId: 'researcher' });
  const d2 = addEvidence(c, { type: 'documentation', source: 'kb2', summary: 's', agentId: 'researcher' });
  const r1 = addEvidence(c, { type: 'reproduction', source: 'lab', summary: 's', agentId: 'repro' });
  linkEvidenceToClaim(c, claim.id, d1.id);
  linkEvidenceToClaim(c, claim.id, d2.id);
  linkEvidenceToClaim(c, claim.id, r1.id);
  // documentation counted once (20) + reproduction (25)
  assert.equal(computeConfidence(c), 45);
});

test('computeConfidence caps at 100', () => {
  const c = makeCase();
  const claim = addClaim(c, { statement: 'x' });
  for (const type of ['prior_ticket', 'documentation', 'api_spec', 'environment', 'source_code', 'e2e_test', 'reproduction']) {
    const ev = addEvidence(c, { type, source: 't', summary: 's', agentId: 't' });
    linkEvidenceToClaim(c, claim.id, ev.id);
  }
  // 5 + 20 + 20 + 10 + 25 + 20 + 25 = 125 -> capped
  assert.equal(computeConfidence(c), 100);
});

test('computeConfidence ignores rejected claims and unlinked evidence', () => {
  const c = makeCase();
  const rejected = addClaim(c, { statement: 'wrong' });
  const repro = addEvidence(c, { type: 'reproduction', source: 'lab', summary: 's', agentId: 'repro' });
  linkEvidenceToClaim(c, rejected.id, repro.id);
  rejected.status = 'rejected';

  const ok = addClaim(c, { statement: 'right' });
  const doc = addEvidence(c, { type: 'documentation', source: 'kb', summary: 's', agentId: 'researcher' });
  linkEvidenceToClaim(c, ok.id, doc.id);

  // evidence never linked to any claim -> not counted
  addEvidence(c, { type: 'source_code', source: 'repo', summary: 's', agentId: 'product' });

  assert.equal(computeConfidence(c), 20);

  // zero-point types contribute nothing
  const c2 = makeCase('case-2');
  const claim2 = addClaim(c2, { statement: 'thin' });
  const e = addEvidence(c2, { type: 'customer_statement', source: 'thread', summary: 's', agentId: 'triage' });
  linkEvidenceToClaim(c2, claim2.id, e.id);
  assert.equal(computeConfidence(c2), 0);
});

test('verifyClaims flips claims with a class >= ENV_CONFIRMED to verified', () => {
  const c = makeCase();

  const docOnly = addClaim(c, { statement: 'docs only' });
  const doc = addEvidence(c, { type: 'documentation', source: 'kb', summary: 's', agentId: 'researcher' });
  linkEvidenceToClaim(c, docOnly.id, doc.id);

  const envBacked = addClaim(c, { statement: 'seen in env' });
  const env = addEvidence(c, { type: 'environment', source: 'kube', summary: 's', agentId: 'sre' });
  linkEvidenceToClaim(c, envBacked.id, env.id);

  const codeBacked = addClaim(c, { statement: 'seen in code' });
  const code = addEvidence(c, { type: 'source_code', source: 'repo', summary: 's', agentId: 'product' });
  linkEvidenceToClaim(c, codeBacked.id, code.id);

  const returned = verifyClaims(c);
  assert.equal(returned, c); // helper returns the same caseObj
  assert.equal(docOnly.status, 'proposed'); // DOCUMENTED is ladder index 3 (< 4)
  assert.equal(envBacked.status, 'verified'); // ENV_CONFIRMED index 4
  assert.equal(codeBacked.status, 'verified'); // CODE_CONFIRMED index 5
});

test('confidenceGate: non-finite and negative inputs can never escape the gate', () => {
  assert.equal(confidenceGate(NaN), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(undefined), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(null), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(Number.POSITIVE_INFINITY), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(Number.NEGATIVE_INFINITY), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(-1), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate('90'), 'NEEDS_MORE_EVIDENCE'); // string is not a score
});

test('confidenceGate boundaries: 59/60/79/80/94/95', () => {
  assert.equal(confidenceGate(0), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(59), 'NEEDS_MORE_EVIDENCE');
  assert.equal(confidenceGate(60), 'ANSWER_WITH_UNCERTAINTY');
  assert.equal(confidenceGate(79), 'ANSWER_WITH_UNCERTAINTY');
  assert.equal(confidenceGate(80), 'ANSWER_WITH_EVIDENCE');
  assert.equal(confidenceGate(94), 'ANSWER_WITH_EVIDENCE');
  assert.equal(confidenceGate(95), 'VERIFIED_ANSWER');
  assert.equal(confidenceGate(100), 'VERIFIED_ANSWER');
});
