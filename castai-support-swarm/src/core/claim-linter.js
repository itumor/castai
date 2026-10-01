// Claim-honesty rule — deterministic linter (spec §4 "Claim-honesty rule").
// Pure regex phrase table over the draft body, cross-checked against ledger
// content. No LLM. Violations are fatal: the orchestrator re-prompts the
// writer (max 2 lint retries, then escalate).

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// AI-cliché bans — unconditional violations, requiredEvidenceType: null.
const CLICHES = [
  'thank you for reaching out',
  'i hope this email finds you well',
  'as an ai',
  'delve',
  'certainly!',
  'i understand your frustration',
].map((phrase) => ({ phrase, regex: new RegExp(escapeRe(phrase), 'gi') }));

// Evidence-backed phrase table (verbatim per spec §4). `satisfied` decides
// whether the ledger actually contains what the phrase claims; a violation is
// emitted per phrase occurrence when it does not.
const PHRASE_RULES = [
  {
    phrase: 'i checked (your )?(cluster|nodes|pods|events|cluster status|autoscaler|autoscaler status|workload|workloads|config|configuration|logs|savings)',
    regex: /i checked (your )?(cluster|nodes|pods|events|cluster status|autoscaler|autoscaler status|workload|workloads|config|configuration|logs|savings)/gi,
    requiredEvidenceType: 'telemetry',
    satisfied: (ledger) => ledger.evidence.some((e) => e.type === 'telemetry' && e.toolRun?.ok === true),
    message: 'claims a checked cluster/nodes/pods/events/autoscaler/workload/config/logs/savings item but the ledger has no telemetry evidence with toolRun.ok === true',
  },
  {
    phrase: '(i|we) reproduced',
    regex: /(i|we) reproduced/gi,
    requiredEvidenceType: 'reproduction',
    satisfied: (ledger) => ledger.evidence.some((e) => e.type === 'reproduction' && e.reproduced === true),
    message: 'claims a reproduction but the ledger has no reproduction evidence with reproduced === true',
  },
  {
    phrase: '(we|i) (confirmed|verified)',
    regex: /(we|i) (confirmed|verified)/gi,
    // requirement is a confirmed hypothesis, not a single evidence type
    requiredEvidenceType: null,
    satisfied: (ledger) => {
      const known = new Set(ledger.evidence.map((e) => e.id));
      return ledger.hypotheses.some(
        (h) => h.status === 'confirmed' && h.evidenceIds.filter((id) => known.has(id)).length >= 2
      );
    },
    message: 'claims confirmation/verification but the ledger has no confirmed hypothesis backed by ≥2 evidence entries',
  },
  {
    phrase: 'our tests? (show|pass)',
    regex: /our tests? (show|pass)/gi,
    // requirement lives on ledger.tests, not on evidence
    requiredEvidenceType: null,
    satisfied: (ledger) =>
      ['unit', 'integration', 'e2e', 'regression'].some((level) => ledger.tests?.[level] === 'passed'),
    message: 'claims test results but no ledger.tests level is "passed"',
  },
  {
    phrase: '(the docs say|per (the )?documentation)',
    regex: /(the docs say|per (the )?documentation)/gi,
    requiredEvidenceType: 'documentation',
    satisfied: (ledger) => ledger.evidence.some((e) => e.type === 'documentation'),
    message: 'cites documentation but the ledger has no documentation evidence',
  },
];

/**
 * @param {string} draftBody
 * @param {import('./types.js').EvidenceLedger} ledger
 * @returns {{ok: boolean, violations: Array<{phrase: string, index: number,
 *   requiredEvidenceType: string|null, message: string}>}}
 */
export function lintDraft(draftBody, ledger) {
  if (typeof draftBody !== 'string') throw new TypeError('lintDraft: draftBody must be a string');
  if (ledger === null || typeof ledger !== 'object') {
    throw new TypeError('lintDraft: ledger must be an object');
  }
  const violations = [];

  for (const rule of PHRASE_RULES) {
    for (const match of draftBody.matchAll(rule.regex)) {
      if (!rule.satisfied(ledger)) {
        violations.push({
          phrase: rule.phrase,
          index: match.index,
          requiredEvidenceType: rule.requiredEvidenceType,
          message: rule.message,
        });
      }
    }
  }

  for (const cliche of CLICHES) {
    for (const match of draftBody.matchAll(cliche.regex)) {
      violations.push({
        phrase: cliche.phrase,
        index: match.index,
        requiredEvidenceType: null,
        message: `AI cliché banned: "${cliche.phrase}"`,
      });
    }
  }

  // customerFirstName is attached to the ledger by the orchestrator (it is not
  // part of the EvidenceLedger typedef); when absent this check is skipped.
  const firstName = typeof ledger.customerFirstName === 'string' ? ledger.customerFirstName.trim() : '';
  if (firstName.length > 0 && !new RegExp(`\\b${escapeRe(firstName)}\\b`, 'i').test(draftBody)) {
    violations.push({
      phrase: 'customer-first-name',
      index: -1,
      requiredEvidenceType: null,
      message: `draft never uses the customer first name "${firstName}"`,
    });
  }

  // "States at least one concrete checked item" — kept simple per spec: the
  // bare regex satisfies the check; the honesty of the specific phrases is
  // what the phrase table above enforces.
  if (!/checked|verified|confirmed|reproduced|tested/i.test(draftBody)) {
    violations.push({
      phrase: 'concrete-checked-item',
      index: -1,
      requiredEvidenceType: null,
      message: 'draft does not state any concrete checked/verified/confirmed/reproduced/tested item',
    });
  }

  return { ok: violations.length === 0, violations };
}
