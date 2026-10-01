// Confidence gate — deterministic scorer (spec §4 "Confidence gate").
// Pure function over the EvidenceLedger: no LLM, no I/O, no ledger mutation.
// The same ledger always produces the same score (total-deterministic).
//
// Case-cluster linkage: the EvidenceLedger typedef records only `provider`
// from triage (not the whole TriageFacts object), so the case clusterId is
// not guaranteed to live on the ledger. The orchestrator attaches it as
// `ledger.triage.clusterId` (mirroring the Case typedef). Telemetry counts
// only when it is demonstrably tied to the customer's environment:
// kubectl-sourced evidence always counts; otherwise toolRun.args.clusterId
// must equal the case clusterId. When the case clusterId is absent, only
// kubectl-sourced telemetry counts — arbitrary mcp-sourced telemetry is
// never accepted. Both paths are deterministic: identical ledger in,
// identical score out.

const POINTS = {
  documentation: 20, // ≥1 documentation evidence (docs/KB source)
  code: 25, // ≥1 evidence with type === 'code'
  reproduction: 25, // ≥1 reproduction evidence with reproduced: true
  e2e: 20, // tests.e2e === 'passed'
  telemetry: 10, // ≥1 cluster-linked telemetry evidence
};

/**
 * @param {import('./types.js').EvidenceLedger} ledger
 * @returns {import('./types.js').Hypothesis|null} the confirmed hypothesis with
 *   the most evidence, or null when none is confirmed.
 */
function topConfirmedHypothesis(ledger) {
  const confirmed = (ledger.hypotheses ?? []).filter((h) => h.status === 'confirmed');
  if (confirmed.length === 0) return null;
  return confirmed.reduce((a, b) => (b.evidenceIds.length > a.evidenceIds.length ? b : a));
}

export function isKubectlSourced(evidence) {
  return /kubectl/i.test(evidence.source) || /kubectl/i.test(evidence.toolRun?.tool ?? '');
}

/**
 * A telemetry evidence counts only when it is tied to the customer's cluster:
 * kubectl-sourced evidence always counts, otherwise toolRun.args.clusterId
 * must equal the case clusterId. When the ledger has no case cluster context
 * (triage clusterId absent), non-kubectl telemetry never counts — there is no
 * permissive fallback.
 */
function telemetryLinked(evidence, caseClusterId) {
  const run = evidence.toolRun;
  if (!run) return false;
  if (isKubectlSourced(evidence)) return true;
  if (!caseClusterId) return false;
  return run.args?.clusterId === caseClusterId;
}

/**
 * @param {import('./types.js').EvidenceLedger} ledger
 * @returns {number} 0..100
 */
export function scoreFromLedger(ledger) {
  if (ledger === null || typeof ledger !== 'object') {
    throw new TypeError('scoreFromLedger: ledger must be an object');
  }
  // No confirmed hypothesis → 0. Open/rejected hypotheses contribute nothing.
  const top = topConfirmedHypothesis(ledger);
  if (!top) return 0;

  const byId = new Map((ledger.evidence ?? []).map((e) => [e.id, e]));
  // Only evidence referenced by the confirmed top hypothesis supports the score,
  // and evidence whose toolRun.ok === false contributes nothing.
  const supporting = top.evidenceIds
    .map((id) => byId.get(id))
    .filter((e) => e !== undefined && !(e.toolRun && e.toolRun.ok === false));

  const caseClusterId = ledger.triage?.clusterId ?? null;
  let score = 0;
  // Each category is counted at most once, no matter how many evidence match.
  if (supporting.some((e) => e.type === 'documentation')) score += POINTS.documentation;
  if (supporting.some((e) => e.type === 'code')) score += POINTS.code;
  if (supporting.some((e) => e.type === 'reproduction' && e.reproduced === true)) score += POINTS.reproduction;
  if (supporting.some((e) => e.type === 'telemetry' && telemetryLinked(e, caseClusterId))) score += POINTS.telemetry;
  // Ledger-level fact: not_run and failed test levels contribute nothing.
  if (ledger.tests?.e2e === 'passed') score += POINTS.e2e;
  return Math.min(score, 100);
}

/**
 * @param {number} score
 * @returns {'ask_or_escalate'|'answer_with_uncertainty'|'answer_with_evidence'|'fully_verified'}
 */
export function routeFromScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new TypeError('routeFromScore: score must be a finite number');
  }
  if (score < 60) return 'ask_or_escalate';
  if (score <= 80) return 'answer_with_uncertainty';
  if (score <= 95) return 'answer_with_evidence';
  return 'fully_verified';
}
