// src/core/model.js — section 1 of CONTRACTS.md
// Data model: case ledger, evidence ledger, claims, confidence scoring.
//
// Core principle: the system never answers because it thinks it knows; it
// answers when it can show why the answer is correct.

/** Claim classes (evidence ladder, ascending strength). */
export const CLAIM_CLASSES = [
  'UNKNOWN',
  'INFERRED',
  'SUPPORTING',
  'DOCUMENTED',
  'ENV_CONFIRMED',
  'CODE_CONFIRMED',
  'TEST_CONFIRMED',
  'REPRODUCED',
  'VERIFIED',
];

/** Evidence types → base class + confidence points (deterministic scoring). */
export const EVIDENCE_TYPES = {
  customer_statement: { cls: 'UNKNOWN', points: 0 },
  inference: { cls: 'INFERRED', points: 0 },
  prior_ticket: { cls: 'SUPPORTING', points: 5 },
  documentation: { cls: 'DOCUMENTED', points: 20 },
  api_spec: { cls: 'DOCUMENTED', points: 20 },
  environment: { cls: 'ENV_CONFIRMED', points: 10 },
  source_code: { cls: 'CODE_CONFIRMED', points: 25 },
  e2e_test: { cls: 'TEST_CONFIRMED', points: 20 },
  reproduction: { cls: 'REPRODUCED', points: 25 },
};

/**
 * createCase({ id, thread, customer }) -> Case
 * thread:   { from, subject, messages: [{ from, date, body }] }
 * customer: { name, email, orgId?, clusterId? }
 */
export function createCase({ id, thread, customer }) {
  return {
    id,
    createdAt: new Date().toISOString(),
    thread,
    customer,
    triage: null,
    plan: null,
    hypotheses: [], // { id:'H1', statement, status:'open'|'confirmed'|'rejected', evidenceIds: [] }
    evidence: [], //   { id:'E1', type, source, ref?, summary, agentId, at }
    claims: [], //     { id:'C1', statement, needsVerification, status:'proposed'|'verified'|'rejected', evidenceIds: [] }
    tests: { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' },
    solution: { status: 'none', summary: '', steps: [] }, // status 'none'|'proposed'|'verified'
    confidence: 0,
    verdict: null,
    reply: null,
    escalation: null,
    kbNotes: [],
    trace: [],
  };
}

/** addEvidence(caseObj, { type, source, ref?, summary, agentId }) -> evidence object (assigns id, at). */
export function addEvidence(caseObj, { type, source, ref, summary, agentId }) {
  const entry = {
    id: `E${caseObj.evidence.length + 1}`,
    type,
    source,
    ...(ref !== undefined ? { ref } : {}),
    summary,
    agentId,
    at: new Date().toISOString(),
  };
  caseObj.evidence.push(entry);
  return entry;
}

/** addHypothesis(caseObj, { statement, evidenceIds? }) -> hypothesis object. */
export function addHypothesis(caseObj, { statement, evidenceIds } = {}) {
  const hypothesis = {
    id: `H${caseObj.hypotheses.length + 1}`,
    statement,
    status: 'open',
    evidenceIds: Array.isArray(evidenceIds) ? [...evidenceIds] : [],
  };
  caseObj.hypotheses.push(hypothesis);
  return hypothesis;
}

/** setHypothesisStatus(caseObj, id, status, evidenceIds?) -> hypothesis object. */
export function setHypothesisStatus(caseObj, id, status, evidenceIds) {
  const hypothesis = caseObj.hypotheses.find((h) => h.id === id);
  if (!hypothesis) throw new Error(`Unknown hypothesis: ${id}`);
  hypothesis.status = status;
  if (Array.isArray(evidenceIds)) {
    for (const evId of evidenceIds) {
      if (!hypothesis.evidenceIds.includes(evId)) hypothesis.evidenceIds.push(evId);
    }
  }
  return hypothesis;
}

/** addClaim(caseObj, { statement, needsVerification = true, evidenceIds? }) -> claim object. */
export function addClaim(caseObj, { statement, needsVerification = true, evidenceIds } = {}) {
  const claim = {
    id: `C${caseObj.claims.length + 1}`,
    statement,
    needsVerification,
    status: 'proposed',
    evidenceIds: Array.isArray(evidenceIds) ? [...evidenceIds] : [],
  };
  caseObj.claims.push(claim);
  return claim;
}

/** linkEvidenceToClaim(caseObj, claimId, evidenceId) -> claim object. */
export function linkEvidenceToClaim(caseObj, claimId, evidenceId) {
  const claim = caseObj.claims.find((c) => c.id === claimId);
  if (!claim) throw new Error(`Unknown claim: ${claimId}`);
  if (!caseObj.evidence.some((e) => e.id === evidenceId)) {
    throw new Error(`Unknown evidence: ${evidenceId}`);
  }
  if (!claim.evidenceIds.includes(evidenceId)) claim.evidenceIds.push(evidenceId);
  return claim;
}

/** claimClasses(caseObj, claimId) -> unique ladder classes derived from linked evidence. */
export function claimClasses(caseObj, claimId) {
  const claim = caseObj.claims.find((c) => c.id === claimId);
  if (!claim) return [];
  const classes = [];
  for (const evId of claim.evidenceIds) {
    const ev = caseObj.evidence.find((e) => e.id === evId);
    if (!ev) continue;
    const meta = EVIDENCE_TYPES[ev.type];
    if (meta && !classes.includes(meta.cls)) classes.push(meta.cls);
  }
  return classes;
}

/**
 * computeConfidence(caseObj) -> number 0..100
 * Consider all evidence linked to claims with status !== 'rejected'.
 * Sum points of the DISTINCT evidence types present; cap at 100.
 */
export function computeConfidence(caseObj) {
  const distinctTypes = new Set();
  for (const claim of caseObj.claims) {
    if (claim.status === 'rejected') continue;
    for (const evId of claim.evidenceIds) {
      const ev = caseObj.evidence.find((e) => e.id === evId);
      if (ev) distinctTypes.add(ev.type);
    }
  }
  let total = 0;
  for (const type of distinctTypes) {
    total += EVIDENCE_TYPES[type] ? EVIDENCE_TYPES[type].points : 0;
  }
  return Math.min(100, total);
}

/**
 * verifyClaims(caseObj) -> caseObj
 * For each claim: if its classes include a class >= 'ENV_CONFIRMED'
 * (ladder index >= 4) -> status 'verified'.
 */
export function verifyClaims(caseObj) {
  for (const claim of caseObj.claims) {
    const classes = claimClasses(caseObj, claim.id);
    if (classes.some((cls) => CLAIM_CLASSES.indexOf(cls) >= 4)) {
      claim.status = 'verified';
    }
  }
  return caseObj;
}

/**
 * confidenceGate(confidence) ->
 *   <60  'NEEDS_MORE_EVIDENCE'
 *   60-79 'ANSWER_WITH_UNCERTAINTY'
 *   80-94 'ANSWER_WITH_EVIDENCE'
 *   >=95 'VERIFIED_ANSWER'
 */
export function confidenceGate(confidence) {
  // Out-of-contract input (NaN, ±Infinity, negative) degrades safely: a
  // corrupt score can never unlock a stronger gate than NEEDS_MORE_EVIDENCE.
  if (!Number.isFinite(confidence) || confidence < 60) return 'NEEDS_MORE_EVIDENCE';
  if (confidence < 80) return 'ANSWER_WITH_UNCERTAINTY';
  if (confidence < 95) return 'ANSWER_WITH_EVIDENCE';
  return 'VERIFIED_ANSWER';
}
