// EvidenceLedger mutation helpers. The ledger is the single source of truth
// passed between agents. All functions mutate the ledger (except cloneLedger).

import { validateTriageFacts } from './types.js';

/**
 * @param {string} caseId
 * @param {import('./types.js').TriageFacts|null} triage
 * @returns {import('./types.js').EvidenceLedger}
 */
export function createLedger(caseId, triage) {
  if (typeof caseId !== 'string' || caseId.length === 0) {
    throw new TypeError('createLedger: caseId must be a non-empty string');
  }
  if (triage !== null && triage !== undefined) {
    const v = validateTriageFacts(triage);
    if (!v.ok) throw new TypeError(`createLedger: invalid triage: ${v.errors.join('; ')}`);
  }
  return {
    caseId,
    customerQuestion: [],
    provider: triage?.provider ?? null,
    hypotheses: [],
    evidence: [],
    tests: { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' },
    solution: { status: 'unsolved', summary: null },
    confidence: null,
    auditLog: [],
  };
}

/** @returns {string} next monotonic evidence id, e.g. "E1", "E2", ... */
function nextEvidenceId(ledger) {
  return `E${ledger.evidence.length + 1}`;
}

/** @returns {string} next monotonic hypothesis id, e.g. "H1", "H2", ... */
function nextHypothesisId(ledger) {
  return `H${ledger.hypotheses.length + 1}`;
}

/**
 * Append evidence to the ledger. Auto-ids E1, E2, ... monotonically.
 * `redactFn` (default identity) is applied to `result` before storing.
 *
 * @param {import('./types.js').EvidenceLedger} ledger
 * @param {{type: string, source: string, result: string, reference?: string,
 *          toolRun?: {tool: string, args: object, ok: boolean}|null,
 *          reproduced?: boolean}} evidence
 * @param {(s: string) => string} [redactFn]
 * @returns {import('./types.js').Evidence} the stored entry
 */
export function addEvidence(ledger, evidence, redactFn = (s) => s) {
  if (evidence === null || typeof evidence !== 'object') {
    throw new TypeError('addEvidence: evidence must be an object');
  }
  for (const key of ['type', 'source', 'result']) {
    if (typeof evidence[key] !== 'string') {
      throw new TypeError(`addEvidence: ${key} must be a string`);
    }
  }
  if (typeof redactFn !== 'function') {
    throw new TypeError('addEvidence: redactFn must be a function');
  }
  const entry = {
    id: nextEvidenceId(ledger),
    type: evidence.type,
    source: evidence.source,
    result: redactFn(evidence.result),
    reference: evidence.reference ?? '',
    capturedAt: new Date().toISOString(),
    toolRun: evidence.toolRun ?? null,
  };
  if (evidence.reproduced !== undefined) {
    entry.reproduced = evidence.reproduced;
  }
  ledger.evidence.push(entry);
  return entry;
}

/**
 * Append a hypothesis. Auto-ids H1, H2, ... monotonically.
 * @param {import('./types.js').EvidenceLedger} ledger
 * @param {string} statement
 * @returns {import('./types.js').Hypothesis}
 */
export function addHypothesis(ledger, statement) {
  if (typeof statement !== 'string' || statement.length === 0) {
    throw new TypeError('addHypothesis: statement must be a non-empty string');
  }
  const hypothesis = { id: nextHypothesisId(ledger), statement, status: 'open', evidenceIds: [] };
  ledger.hypotheses.push(hypothesis);
  return hypothesis;
}

/**
 * @param {import('./types.js').EvidenceLedger} ledger
 * @param {string} hypothesisId
 * @param {'open'|'confirmed'|'rejected'} status
 * @param {string[]} evidenceIds
 */
export function setHypothesisStatus(ledger, hypothesisId, status, evidenceIds) {
  const hypothesis = ledger.hypotheses.find((h) => h.id === hypothesisId);
  if (!hypothesis) {
    throw new Error(`setHypothesisStatus: unknown hypothesis id "${hypothesisId}"`);
  }
  if (!['open', 'confirmed', 'rejected'].includes(status)) {
    throw new TypeError(`setHypothesisStatus: invalid status "${status}"`);
  }
  hypothesis.status = status;
  hypothesis.evidenceIds = Array.isArray(evidenceIds) ? [...evidenceIds] : [];
}

/**
 * @param {import('./types.js').EvidenceLedger} ledger
 * @param {{unit: string, integration: string, e2e: string, regression: string}} tests
 */
export function setTests(ledger, tests) {
  if (tests === null || typeof tests !== 'object') {
    throw new TypeError('setTests: tests must be an object');
  }
  for (const key of ['unit', 'integration', 'e2e', 'regression']) {
    const level = tests[key];
    if (!['passed', 'failed', 'not_run'].includes(level)) {
      throw new TypeError(`setTests: tests.${key} must be one of passed|failed|not_run, got "${level}"`);
    }
  }
  ledger.tests = { unit: tests.unit, integration: tests.integration, e2e: tests.e2e, regression: tests.regression };
}

/**
 * @param {import('./types.js').EvidenceLedger} ledger
 * @param {'unsolved'|'proposed'|'verified'|'escalated'} status
 * @param {string|null} summary
 */
export function setSolution(ledger, status, summary) {
  if (!['unsolved', 'proposed', 'verified', 'escalated'].includes(status)) {
    throw new TypeError(`setSolution: invalid status "${status}"`);
  }
  if (summary !== null && summary !== undefined && typeof summary !== 'string') {
    throw new TypeError('setSolution: summary must be a string or null');
  }
  ledger.solution = { status, summary: summary ?? null };
}

/**
 * Append an audit entry. Append-only; entries are never modified or removed.
 * @param {import('./types.js').EvidenceLedger} ledger
 * @param {string} agent
 * @param {string} action
 * @param {string} detail
 */
export function audit(ledger, agent, action, detail) {
  if (typeof agent !== 'string' || typeof action !== 'string' || typeof detail !== 'string') {
    throw new TypeError('audit: agent, action and detail must be strings');
  }
  ledger.auditLog.push({ at: new Date().toISOString(), agent, action, detail });
}

/**
 * Structural deep copy. Mutating the clone leaves the original untouched.
 * @param {import('./types.js').EvidenceLedger} ledger
 * @returns {import('./types.js').EvidenceLedger}
 */
export function cloneLedger(ledger) {
  return structuredClone(ledger);
}
