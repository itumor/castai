// VerifierAgent — adversarial verification pass (chunk 14b).
//
// Builds a Verdict (spec §3) by cross-checking every proposed claim against
// the ledger evidence. Classification is fully deterministic (no LLM in the
// decision path):
//   - any 'documentation' evidence  → DOCUMENTED            (highest priority)
//   - any 'code' evidence           → CODE-CONFIRMED
//   - any 'test' evidence with a passing toolRun or a passing ledger.tests
//     level                         → TEST-CONFIRMED
//   - any 'telemetry' evidence with a toolRun (ok !== false) that is tied to
//     the customer's environment → ENVIRONMENT-CONFIRMED. Tied means:
//     kubectl-sourced, or toolRun.args.clusterId equals the case clusterId
//     (ledger.triage.clusterId). When the case has no clusterId, only
//     kubectl-sourced telemetry qualifies — foreign-cluster telemetry must
//     never verify a claim. This mirrors the confidence scorer's rule.
//   - empty/absent evidenceIds      → INFERRED
//   - ids present but none resolve to a qualifying ledger entry → UNKNOWN
//
// pass === true iff every claim lands in the verified set AND has non-empty
// evidenceIds. The brain is used only to extract claims from
// ledger.solution.summary when the task omits proposedClaims.

import { BaseAgent } from './base-agent.js';
import { validateVerdict } from '../core/types.js';
import { isKubectlSourced } from '../core/confidence.js';

const VERIFIED_CLASSIFICATIONS = new Set([
  'DOCUMENTED',
  'CODE-CONFIRMED',
  'TEST-CONFIRMED',
  'ENVIRONMENT-CONFIRMED',
]);

/** True when any ledger.tests level is 'passed'. */
function anyTestPassed(ledger) {
  return Object.values(ledger?.tests ?? {}).includes('passed');
}

/** Normalize a claim entry (string or {claim, evidenceIds?}) to the Verdict shape. */
function normalizeClaim(entry) {
  if (typeof entry === 'string') {
    return { claim: entry, evidenceIds: [] };
  }
  if (entry === null || typeof entry !== 'object' || typeof entry.claim !== 'string' || entry.claim.length === 0) {
    throw new Error('verifier: each claim must be a non-empty string or {claim, evidenceIds}');
  }
  const evidenceIds = Array.isArray(entry.evidenceIds)
    ? entry.evidenceIds.filter((id) => typeof id === 'string')
    : [];
  return { claim: entry.claim, evidenceIds };
}

/**
 * Spec §4: telemetry counts as environment confirmation only when it targets
 * the case's cluster — kubectl-sourced evidence, or toolRun.args.clusterId
 * equal to the case clusterId (when the case has one). Telemetry collected
 * against a different cluster must NOT verify a claim.
 */
function isEnvironmentConfirmed(evidence, ledger) {
  if (evidence.type !== 'telemetry') return false;
  const run = evidence.toolRun;
  if (!run || run.ok === false) return false;
  if (isKubectlSourced(evidence)) return true;
  const caseClusterId = ledger?.triage?.clusterId ?? null;
  if (!caseClusterId) return false;
  return run.args?.clusterId === caseClusterId;
}

/**
 * Deterministic classification of one claim against the ledger evidence.
 * @returns {{claim: string, classification: string, evidenceIds: string[]}}
 */
function classifyClaim(claim, ledger) {
  const evidenceIds = claim.evidenceIds;
  const byId = new Map((ledger?.evidence ?? []).map((e) => [e.id, e]));
  const resolved = evidenceIds.map((id) => byId.get(id)).filter((e) => e !== undefined);

  let classification;
  if (resolved.length === 0) {
    // No ids at all → brain-asserted INFERRED; ids present but unresolvable → UNKNOWN.
    classification = evidenceIds.length === 0 ? 'INFERRED' : 'UNKNOWN';
  } else if (resolved.some((e) => e.type === 'documentation')) {
    classification = 'DOCUMENTED';
  } else if (resolved.some((e) => e.type === 'code')) {
    classification = 'CODE-CONFIRMED';
  } else if (resolved.some((e) => e.type === 'test' && (e.toolRun?.ok === true || anyTestPassed(ledger)))) {
    classification = 'TEST-CONFIRMED';
  } else if (resolved.some((e) => isEnvironmentConfirmed(e, ledger))) {
    classification = 'ENVIRONMENT-CONFIRMED';
  } else {
    classification = evidenceIds.length === 0 ? 'INFERRED' : 'UNKNOWN';
  }
  return { claim: claim.claim, classification, evidenceIds: [...evidenceIds] };
}

export class VerifierAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'verifier' });
    this.rolePrompt =
      'You are the verifier agent of the CAST AI support swarm. You adversarially check every ' +
      'proposed claim against ledger evidence. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {proposedClaims?: Array<string|{claim, evidenceIds?}>}
   * output: {verdict: {pass, claims, reason, openQuestions}}
   */
  async _run(task, ctx) {
    const ledger = ctx.ledger;
    const rawClaims = Array.isArray(task?.proposedClaims) && task.proposedClaims.length > 0
      ? task.proposedClaims
      : await this._deriveClaimsFromSummary(ledger, ctx);
    const claims = rawClaims.map((c) => classifyClaim(normalizeClaim(c), ledger));

    const failing = claims.filter(
      (c) => !VERIFIED_CLASSIFICATIONS.has(c.classification) || c.evidenceIds.length === 0
    );
    const pass = claims.length > 0 && failing.length === 0;

    const reason = pass
      ? `All ${claims.length} claim(s) are evidence-backed: ` +
        claims.map((c) => `${c.classification}`).join(', ')
      : `${failing.length} of ${claims.length} claim(s) lack verified evidence`;

    const openQuestions = pass
      ? null
      : failing.map(
          (c) =>
            `Claim "${c.claim}" is ${c.classification} — needs evidence-backed confirmation before customer delivery`
        );

    const verdict = { pass, claims, reason, openQuestions };
    const validation = validateVerdict(verdict);
    if (!validation.ok) {
      throw new Error(`verifier: invalid verdict produced: ${validation.errors.join('; ')}`);
    }
    ctx.audit('verdict_complete', `${pass ? 'PASS' : 'FAIL'}: ${reason}`);
    return { verdict };
  }

  /** When the task omits proposedClaims, extract them from ledger.solution.summary via the brain. */
  async _deriveClaimsFromSummary(ledger, ctx) {
    const summary = ledger?.solution?.summary;
    if (typeof summary !== 'string' || summary.length === 0) {
      throw new Error('verifier: no proposedClaims and ledger.solution.summary is empty');
    }
    const promptTask = {
      instruction:
        'Extract the atomic claims of the proposed solution. Respond ONLY with JSON: ' +
        '{claims: [{claim: string, evidenceIds: string[]}]} (evidenceIds may be empty).',
      summary,
    };
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true, tag: 'verifier:claims' });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`verifier: brain returned non-JSON claims: ${String(raw).slice(0, 200)}`);
    }
    if (!parsed || !Array.isArray(parsed.claims)) {
      throw new Error('verifier: brain claims JSON must be {claims: [...]}');
    }
    if (parsed.claims.length === 0) {
      throw new Error('verifier: brain extracted zero claims from the solution summary');
    }
    return parsed.claims;
  }
}
