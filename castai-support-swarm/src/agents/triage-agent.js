// TriageAgent — deterministic pre-parse + brain-assisted classification of an
// EmailInput into validated TriageFacts (chunk 13).
//
// Flow (spec §5 chunk 13):
//  1. parseEmailBasics(): pure regex extraction of org/cluster UUIDs, provider
//     keywords (eks|aks|gke), CAST AI mode keywords, component keywords, AWS
//     account id and cluster name.
//  2. brain.complete(..., {json:true}) fills the classify fields.
//  3. Merge (regex-found ids win over the brain for orgId/clusterId), then
//     validateTriageFacts. Invalid → ONE brain retry with the validation
//     errors appended → still invalid → ok:false AgentResult.

import { BaseAgent } from './base-agent.js';
import { validateTriageFacts } from '../core/types.js';

const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const UUID_RE = new RegExp(UUID_SRC, 'gi');

const PROVIDER_KEYWORDS = [
  ['eks', /\be[Kk][Ss]\b/],
  ['aks', /\bAKS\b/],
  ['gke', /\bGKE\b/],
];

// Mode keywords, most specific first. 'readonly'/'full' must be mode-stated
// (adjacent to the word "mode") so historical mentions like "read-only
// onboarding worked earlier" don't shadow the current "full mode" statement.
const MODE_PATTERNS = [
  ['workload-autoscaler', /workload[- ]?autoscaler/i],
  ['node-autoscaler', /node[- ]?autoscaler/i],
  ['readonly', /read[- ]?only[^\n]{0,30}\bmode\b|\bmode\b[^\n]{0,30}read[- ]?only/i],
  ['full', /\bfull\b[^\n]{0,20}\bmode\b|\bmode\b[^\n]{0,20}\bfull\b/i],
];

const COMPONENT_KEYWORDS = [
  'castai-agent', 'evictor', 'cluster-controller', 'spot-handler', 'kvisor',
  'workload-autoscaler',
];

const TRIAGE_INSTRUCTION =
  'Classify this support case. Respond ONLY with a JSON object of TriageFacts: ' +
  '{orgId, clusterId, provider ("eks"|"aks"|"gke"|"unknown"), ' +
  'castaiMode ("readonly"|"workload-autoscaler"|"node-autoscaler"|"full"|"unknown"), ' +
  'components (string[]), issueCategory, severity ("P1"|"P2"|"P3"|"P4"), ' +
  'expected (one sentence), actual (one sentence), missingInfo (string[])}.';

function findUuidAfter(labelPattern, text) {
  const m = text.match(new RegExp(`${labelPattern}\\s*(?:id)?\\s*[:=]?\\s*("?)(${UUID_SRC})\\1`, 'i'));
  return m ? m[2].toLowerCase() : null;
}

/**
 * Deterministic, brain-free pre-parse of an EmailInput. Pure function.
 * @param {import('../core/types.js').EmailInput} email
 */
export function parseEmailBasics(email) {
  const text = `${email?.subject ?? ''}\n${email?.body ?? ''}`;
  const lower = text.toLowerCase();

  // UUIDs: keyword-labelled first, positional fallback afterwards.
  const uuids = (text.match(UUID_RE) ?? []).map((u) => u.toLowerCase());
  const orgId = findUuidAfter('\\borg(?:anization)?\\b', text) ?? uuids[0] ?? null;
  const clusterId = findUuidAfter('\\bcluster\\b', text) ??
    (uuids.find((u) => u !== orgId) ?? null);

  let provider = 'unknown';
  for (const [name, re] of PROVIDER_KEYWORDS) {
    if (re.test(text)) { provider = name; break; }
  }

  let castaiMode = 'unknown';
  for (const [name, re] of MODE_PATTERNS) {
    if (re.test(text)) { castaiMode = name; break; }
  }

  const components = COMPONENT_KEYWORDS.filter((c) => lower.includes(c));

  const accountMatch = text.match(/\baccount[^\d\n]{0,30}(\d{12})\b/i);
  const accountId = accountMatch ? accountMatch[1] : null;

  // Cluster name: parenthesised token after "cluster", then bare token.
  const nameParen = text.match(/\bclusters?\s*\(([^),]+)/i);
  const nameBare = text.match(/\bcluster\s+([a-z0-9][a-z0-9._-]{2,})/i);
  const clusterName = (nameParen ? nameParen[1].trim() : (nameBare ? nameBare[1] : null));

  return { orgId, clusterId, provider, castaiMode, components, accountId, clusterName };
}

export class TriageAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'triage' });
    this.rolePrompt =
      'You are the triage agent of the CAST AI support swarm. Classify the incoming ' +
      'support email into TriageFacts. Respond ONLY with the JSON object — no prose.';
  }

  /**
   * task: {email: EmailInput} (or the EmailInput itself).
   * output: {triageFacts: TriageFacts}
   */
  async _run(task, ctx) {
    const email = task?.email ?? task;
    if (!email || typeof email !== 'object' || typeof email.body !== 'string') {
      throw new Error('triage: task must include an EmailInput (task.email or the email itself)');
    }
    const basics = parseEmailBasics(email);

    const attempt = async (errors) => {
      const triageTask = {
        email,
        basics,
        instruction: TRIAGE_INSTRUCTION,
        ...(errors.length > 0 ? { previousAttemptErrors: errors } : {}),
      };
      const raw = await ctx.brain.complete(this.buildPrompt(triageTask), { json: true });
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { parseError: `brain returned non-JSON output: ${String(raw).slice(0, 200)}` };
      }
      return { facts: this._merge(basics, parsed) };
    };

    let result = await attempt([]);
    let validation = result.parseError
      ? { ok: false, errors: [result.parseError] }
      : validateTriageFacts(result.facts);
    let facts = result.facts;

    if (!validation.ok) {
      // Exactly ONE retry, with the validation errors appended to the prompt.
      result = await attempt(validation.errors);
      validation = result.parseError
        ? { ok: false, errors: [result.parseError] }
        : validateTriageFacts(result.facts);
      facts = result.facts;
      if (!validation.ok) {
        throw new Error(`triage: invalid TriageFacts after one retry: ${validation.errors.join('; ')}`);
      }
    }

    // Downstream note: the claim-honesty linter needs the customer's first
    // name to enforce the greeting rule; plain ledger assignment is intentional.
    ctx.ledger.customerFirstName = email.fromFirstName ?? 'there';
    if (ctx.ledger.provider !== facts.provider) {
      ctx.ledger.provider = facts.provider;
    }
    ctx.audit('triage_complete',
      `category=${facts.issueCategory} provider=${facts.provider} severity=${facts.severity}`);
    return { triageFacts: facts };
  }

  /**
   * Merge regex-extracted basics with brain output. Regex-found ids win over
   * the brain for orgId/clusterId; regex provider/mode win when not 'unknown'.
   */
  _merge(basics, brainFacts) {
    const b = brainFacts && typeof brainFacts === 'object' && !Array.isArray(brainFacts)
      ? brainFacts
      : {};
    const arr = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
    const components = [...new Set([...basics.components, ...arr(b.components)])];
    return {
      orgId: basics.orgId ?? b.orgId ?? null,
      clusterId: basics.clusterId ?? b.clusterId ?? null,
      provider: basics.provider !== 'unknown' ? basics.provider : (b.provider ?? 'unknown'),
      castaiMode: basics.castaiMode !== 'unknown' ? basics.castaiMode : (b.castaiMode ?? 'unknown'),
      components,
      issueCategory: b.issueCategory,
      severity: b.severity,
      expected: typeof b.expected === 'string' ? b.expected : '',
      actual: typeof b.actual === 'string' ? b.actual : '',
      missingInfo: arr(b.missingInfo),
    };
  }
}
