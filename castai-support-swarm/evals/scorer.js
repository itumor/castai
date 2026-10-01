// Deterministic eval scorer (chunk 18, spec §5/§7).
//
// Pure functions over a runResult ({ledger, verdict, draftPost, caseRecord})
// and the case's expected.json. No LLM, no I/O, no randomness: the same run
// always produces the same scores.
//
// Dimensions (0..100 each):
//   - evidence-grounding: fraction of expectedEvidenceTypes present in the
//     ledger evidence types, plus one extra expected item per expectedTests
//     entry (e.g. e2e) satisfied by ledger.tests. matches/expected * 100.
//   - claim-honesty: 100 if lintDraft(draft.body, ledger).ok AND every verdict
//     claim has non-empty evidenceIds; 60 if lint ok but some claims are
//     ungrounded; 30 when the draft is missing (escalated — evaluated on the
//     honesty of NOT drafting); 0 when the lint fails.
//   - style: start 100; -25 per forbiddenPhrase found in the draft body;
//     -25 when requiredDraftPhrases[0] (the customer first name) is missing;
//     floored at 0.
//   - routing-correctness: fraction of expectedAgents present in the executed
//     specialist set (ledger.auditLog 'execute' entries) * 50, + 50 when both
//     verifier and support-writer appear.
//
// total = round(mean of the 4 dimensions), then capped at 79 when a route or
// loops expectation fails:
//   - expectedRoute: draft.route must equal it exactly.
//   - expectedRouteRange: [min, max] over the fixed ordering
//     ask_or_escalate < answer_with_uncertainty < answer_with_evidence <
//     fully_verified.
//   - expectedLoops: caseRecord.loopsUsed must equal it.

import { lintDraft } from '../src/core/claim-linter.js';

export const ROUTE_ORDER = Object.freeze([
  'ask_or_escalate',
  'answer_with_uncertainty',
  'answer_with_evidence',
  'fully_verified',
]);

/**
 * Deterministic route check against an expectation.
 * @param {string|null|undefined} route the draft's route
 * @param {{expectedRoute?: string, expectedRouteRange?: [string, string]}} expected
 * @returns {boolean} true when the route satisfies every route expectation
 */
export function checkRoute(route, expected) {
  if (!expected) return true;
  if (expected.expectedRoute !== undefined && route !== expected.expectedRoute) return false;
  if (Array.isArray(expected.expectedRouteRange)) {
    const [min, max] = expected.expectedRouteRange;
    const idx = ROUTE_ORDER.indexOf(route);
    const lo = ROUTE_ORDER.indexOf(min);
    const hi = ROUTE_ORDER.indexOf(max);
    if (idx === -1 || lo === -1 || hi === -1) return false;
    if (idx < lo || idx > hi) return false;
  }
  return true;
}

/** @returns {number} 0..100 */
function evidenceGrounding(runResult, expected) {
  const ledger = runResult.ledger ?? {};
  const present = new Set((ledger.evidence ?? []).map((e) => e.type));
  const items = [...(expected.expectedEvidenceTypes ?? [])];
  const tests = expected.expectedTests ?? {};
  for (const [level, wanted] of Object.entries(tests)) {
    items.push((runResult.ledger?.tests ?? {})[level] === wanted ? `__ok__${level}` : `__fail__${level}`);
  }
  const matches = items.filter((item) =>
    item.startsWith('__ok__') || present.has(item)
  ).length;
  return items.length === 0 ? 100 : (matches / items.length) * 100;
}

/** @returns {number} 0..100 */
function claimHonesty(runResult, expected) {
  void expected;
  const ledger = runResult.ledger ?? {};
  const draft = runResult.draftPost;
  if (!draft || typeof draft.body !== 'string') return 30; // escalated, no draft
  const lint = lintDraft(draft.body, ledger);
  if (!lint.ok) return 0;
  const claims = runResult.verdict?.claims ?? [];
  const allGrounded = claims.every(
    (c) => Array.isArray(c.evidenceIds) && c.evidenceIds.length > 0
  );
  return allGrounded ? 100 : 60;
}

/** @returns {number} 0..100 */
function style(runResult, expected) {
  const body = String(runResult.draftPost?.body ?? '');
  let score = 100;
  for (const phrase of expected.forbiddenPhrases ?? []) {
    if (body.toLowerCase().includes(String(phrase).toLowerCase())) score -= 25;
  }
  const firstName = expected.requiredDraftPhrases?.[0];
  if (firstName !== undefined) {
    const re = new RegExp(`\\b${String(firstName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!re.test(body)) score -= 25;
  }
  return Math.max(score, 0);
}

/** @returns {number} 0..100 */
function routingCorrectness(runResult, expected) {
  const executed = new Set(
    (runResult.ledger?.auditLog ?? [])
      .filter((a) => a.action === 'execute')
      .map((a) => a.agent)
  );
  const expectedAgents = expected.expectedAgents ?? [];
  const present = expectedAgents.filter((a) => executed.has(a)).length;
  let score = expectedAgents.length === 0 ? 50 : (present / expectedAgents.length) * 50;
  if (executed.has('verifier') && executed.has('support-writer')) score += 50;
  return Math.min(score, 100);
}

/**
 * Score one eval run against its expectations.
 * @param {{ledger: object, verdict: object|null, draftPost: object|null,
 *          caseRecord?: object}} runResult
 * @param {object} expected parsed expected.json
 * @returns {{dimensions: {'evidence-grounding': number, 'claim-honesty': number,
 *           style: number, 'routing-correctness': number}, total: number,
 *           capped: boolean, routeOk: boolean, loopsOk: boolean}}
 */
export function scoreEval(runResult, expected) {
  const dimensions = {
    'evidence-grounding': Math.round(evidenceGrounding(runResult, expected)),
    'claim-honesty': Math.round(claimHonesty(runResult, expected)),
    'style': Math.round(style(runResult, expected)),
    'routing-correctness': Math.round(routingCorrectness(runResult, expected)),
  };
  const mean =
    (dimensions['evidence-grounding'] +
      dimensions['claim-honesty'] +
      dimensions.style +
      dimensions['routing-correctness']) / 4;
  let total = Math.round(mean);

  const routeOk = checkRoute(runResult.draftPost?.route ?? null, expected);
  const loopsOk =
    expected.expectedLoops === undefined ||
    runResult.caseRecord?.loopsUsed === expected.expectedLoops;
  const capped = !routeOk || !loopsOk;
  if (capped) total = Math.min(total, 79);

  return { dimensions, total, capped, routeOk, loopsOk };
}
