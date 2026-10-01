// src/agents/architect.js — section 7 of CONTRACTS.md.
// Consumes hypotheses + evidence and writes
//   caseObj.solution = { status:'proposed', summary, steps[] }
// incl. rollback / alternative steps where applicable. Returns { solution }.
//
// Deterministic, offline: fix steps are derived from confirmed hypotheses and
// the evidence ledger via a stable rule table, a generic step covers any
// confirmed root cause without a matching rule, and every plan ends with a
// rollback note because the proposed changes are manifest/CI-reversible.

import { record } from '../core/trace.js';

// Keyword-driven fix rules. Two scopes:
//  - CAUSE rules (default): fire on CONFIRMED hypotheses + evidence linked to
//    those hypotheses. Sweeping the whole evidence pool attaches wrong steps
//    (e.g. an upscale step landing in a scale-down answer because some cited
//    doc mentions "pending pods").
//  - CUSTOMER rules (scope: 'customer'): fire on the customer's own words
//    (subject, message bodies, triage questions) — category-level guidance the
//    answer should give even when no lab hypothesis was confirmed (e.g. token
//    rotation facts), still never sourced from unlinked KB noise.
const FIX_RULES = [
  {
    match: /\bpdb\b|poddisruptionbudget|disruption budget/i,
    steps: [
      'Relax the PodDisruptionBudget for the stuck workload (for example rewrite minAvailable: 2 as maxUnavailable: 1, or scale the deployment up so minAvailable no longer equals the replica count) so CAST AI can evict the remaining pods.',
      'Alternative: if the PDB must stay exactly as it is for availability, mark the node pool as not removable and accept that this node stays until the workload changes.',
    ],
  },
  {
    match: /local[- ]storage|emptydir|hostpath/i,
    steps: [
      'Move the pod off local storage (drop hostPath/emptyDir volumes or mount real persistent volumes) so CAST AI can reschedule it onto another node.',
    ],
  },
  {
    match: /do.?not.?evict|safe.?to.?evict/i,
    steps: [
      'Remove the do-not-evict annotation (or set the safe-to-evict opt-in) on the blocking pods so the drain can proceed.',
    ],
  },
  {
    match: /not managed|bare pod|no controller|orphan|without a controller/i,
    steps: [
      'Move the bare pod under a controller (Deployment or StatefulSet) so CAST AI can recreate it on another node during the drain.',
    ],
  },
  {
    match: /do.?not.?disrupt|do_not_disrupt/i,
    steps: [
      'Remove the do-not-disrupt setting for the blocking workload (node template or pod annotation) so CAST AI may consolidate the node.',
    ],
  },
  {
    scope: 'customer',
    match: /401|token|authoriz/i,
    steps: [
      'Rotate the CAST AI cluster token and update every secret that uses it, then restart every affected component (agents and controllers) so they reconnect; the previous cluster token stays usable until every component has picked up the new one, so partial updates fail only later.',
      'An organization API key is not a substitute for the cluster token; cluster components authenticate with the cluster token issued by POST /v1/kubernetes/external-clusters/{clusterId}/token.',
    ],
  },
  {
    match: /upscal|scale up|insufficient capacity|pending pods/i,
    steps: [
      'Loosen the node template constraints (instance types, zones, or spot/on-demand split) so CAST AI has room to provision capacity for the pending pods.',
    ],
  },
];

function rollbackStep() {
  return (
    'Rollback: keep the previous manifest/policy version in source control and ' +
    're-apply it through your normal CI path if the change misbehaves — nothing ' +
    'in this plan is one-way.'
  );
}

function buildSummary(caseObj, confirmedCount) {
  const category = caseObj.triage && caseObj.triage.category;
  if (category === 'node_downscale') {
    return 'Remove the eviction blockers so CAST AI can drain and remove the under-utilized node.';
  }
  if (category === 'node_upscale') {
    return 'Give CAST AI headroom to provision capacity so the pending pods can schedule.';
  }
  return (
    `Address the confirmed root cause${confirmedCount === 1 ? '' : 's'} and roll the ` +
    'change out to a canary workload before applying it everywhere.'
  );
}

/** Steps contributed by keyword rules over the given corpus and scope. */
function ruleSteps(corpus, scope) {
  const steps = [];
  for (const rule of FIX_RULES) {
    if ((rule.scope || 'cause') !== scope) continue;
    if (rule.match.test(corpus)) steps.push(...rule.steps);
  }
  return steps;
}

/** The customer's own words: subject + message bodies + triage questions. */
function customerCorpus(caseObj) {
  const thread = caseObj.thread || {};
  const bodies = (thread.messages || []).map((m) => (m && m.body) || '');
  const questions = (caseObj.triage && caseObj.triage.questions) || [];
  return [thread.subject || '', ...bodies, ...questions].join('\n');
}

/**
 * createArchitect({ llm, tools }) -> agent { id, name, async run(ctx) }.
 * Uses no tools (kb permission exists but the composition is deterministic).
 */
export function createArchitect({ llm, tools } = {}) {
  return {
    id: 'architect',
    name: 'Architect',

    async run(ctx) {
      const caseObj = ctx.caseObj;
      record(caseObj, 'architect', 'architect.start', {
        hypotheses: (caseObj.hypotheses || []).length,
        evidence: (caseObj.evidence || []).length,
      });

      const confirmed = (caseObj.hypotheses || []).filter((h) => h.status === 'confirmed');
      record(caseObj, 'architect', 'architect.hypotheses', {
        confirmed: confirmed.map((h) => h.id),
        rejected: (caseObj.hypotheses || []).filter((h) => h.status === 'rejected').map((h) => h.id),
      });

      // Cause-scoped rules fire off the CONFIRMED causes only: hypothesis
      // statements plus the evidence linked to those hypotheses. Sweeping the
      // whole evidence pool (research KB snippets, unrelated incident notes)
      // makes rules attach wrong steps — e.g. an upscale step landing in a
      // scale-down answer because some cited doc mentions "pending pods".
      const linkedEvidence = new Set(confirmed.flatMap((h) => h.evidenceIds || []));
      const corpus = [
        ...confirmed.map((h) => h.statement),
        ...(caseObj.evidence || [])
          .filter((e) => linkedEvidence.has(e.id))
          .map((e) => e.summary),
      ].join('\n');

      const steps = [...ruleSteps(corpus, 'cause'), ...ruleSteps(customerCorpus(caseObj), 'customer')];
      for (const hypothesis of confirmed) {
        if (!FIX_RULES.some((rule) => rule.match.test(hypothesis.statement))) {
          steps.push(`Resolve the confirmed root cause: ${hypothesis.statement}.`);
        }
      }
      if (steps.length === 0) {
        steps.push(
          'Reproduce the behavior in the lab to pin down the root cause, then apply the ' +
          'smallest manifest change it points to and watch one workload before rolling out.',
        );
      }
      steps.push(rollbackStep());

      caseObj.solution = {
        status: 'proposed',
        summary: buildSummary(caseObj, confirmed.length),
        steps,
      };

      record(caseObj, 'architect', 'solution.proposed', {
        steps: steps.length,
        summary: caseObj.solution.summary,
      });

      return { solution: caseObj.solution };
    },
  };
}
