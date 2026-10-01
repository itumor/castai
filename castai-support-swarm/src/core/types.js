// Data contracts and pure validators for castai-support-swarm.
// Every validator returns { ok: boolean, errors: string[] }.

export const ISSUE_CATEGORIES = [
  'onboarding', 'node_upscale', 'node_downscale', 'rebalance',
  'workload_autoscaling', 'spot', 'cost_reporting', 'api', 'iam',
  'security', 'billing',
];

export const PROVIDERS = ['eks', 'aks', 'gke', 'unknown'];

export const CASTAI_MODES = [
  'readonly', 'workload-autoscaler', 'node-autoscaler', 'full', 'unknown',
];

export const SEVERITIES = ['P1', 'P2', 'P3', 'P4'];

export const CASE_STATUSES = [
  'intake', 'triage', 'planning', 'investigating', 'verifying',
  'writing', 'escalated', 'knowledge', 'done',
];

export const EVIDENCE_TYPES = [
  'telemetry', 'documentation', 'reproduction', 'test', 'code',
  'customer_statement', 'previous_ticket',
];

export const HYPOTHESIS_STATUSES = ['open', 'confirmed', 'rejected'];

export const TEST_LEVELS = ['passed', 'failed', 'not_run'];

export const TEST_KEYS = ['unit', 'integration', 'e2e', 'regression'];

export const SOLUTION_STATUSES = ['unsolved', 'proposed', 'verified', 'escalated'];

export const CLAIM_CLASSIFICATIONS = [
  'DOCUMENTED', 'CODE-CONFIRMED', 'TEST-CONFIRMED',
  'ENVIRONMENT-CONFIRMED', 'INFERRED', 'UNKNOWN',
];

export const DRAFT_ROUTES = [
  'answer_with_uncertainty', 'answer_with_evidence', 'fully_verified',
];

/**
 * @typedef {Object} Case
 * @property {string}  caseId            // UUID v4
 * @property {string}  createdAt         // ISO 8601
 * @property {'email'} source
 * @property {EmailInput} email
 * @property {string} status
 * @property {TriageFacts|null} triage
 * @property {InvestigationPlan|null} plan
 * @property {number}  loopsUsed          // verifier-bounce counter
 * @property {number}  maxLoops           // default 2, override via options
 */

/** @typedef {Object} EmailInput
 * @property {string} from                // full "Name <a@b.c>" or bare address
 * @property {string} fromName            // parsed display name
 * @property {string} fromFirstName       // first token of fromName; "there" if absent
 * @property {string} subject
 * @property {string} body                // latest email body
 * @property {{author: string, date: string, body: string}[]} thread // prior messages, oldest first
 */

/** @typedef {Object} TriageFacts
 * @property {string|null} orgId        // UUID or null
 * @property {string|null} clusterId    // UUID or null
 * @property {string} provider          // eks|aks|gke|unknown
 * @property {string} castaiMode        // readonly|workload-autoscaler|node-autoscaler|full|unknown
 * @property {string[]} components
 * @property {string} issueCategory
 * @property {string} severity          // P1..P4
 * @property {string} expected          // one sentence
 * @property {string} actual            // one sentence
 * @property {string[]} missingInfo
 */

/** @typedef {Object} EvidenceLedger
 * @property {string} caseId
 * @property {string[]} customerQuestion
 * @property {string|null} provider     // environment snapshot (from triage)
 * @property {Hypothesis[]} hypotheses
 * @property {Evidence[]} evidence
 * @property {{unit: string, integration: string, e2e: string, regression: string}} tests
 * @property {{status: string, summary: string|null}} solution
 * @property {number|null} confidence   // set only by confidence.js, never by an LLM
 * @property {Array<{at: string, agent: string, action: string, detail: string}>} auditLog
 */

/** @typedef {Object} Hypothesis
 * @property {string} id                // "H1", "H2", ...
 * @property {string} statement
 * @property {string} status            // open|confirmed|rejected
 * @property {string[]} evidenceIds
 */

/** @typedef {Object} Evidence
 * @property {string} id                // "E1", "E2", ...
 * @property {string} type
 * @property {string} source
 * @property {string} result            // redacted summary of what was observed
 * @property {string} reference
 * @property {string} capturedAt        // ISO 8601
 * @property {{tool: string, args: object, ok: boolean}|null} toolRun
 *                                      // executed tool call; null for documentation.
 *                                      // For telemetry: toolRun.args.clusterId (when present) is the
 *                                      //   case-cluster linkage used by the +10 scorer rule.
 * @property {boolean} [reproduced]     // only on type 'reproduction'; copied from Sandbox result
 */

/** @typedef {Object} AgentResult
 * @property {string} agent             // agent role key
 * @property {boolean} ok
 * @property {object|null} output       // agent-specific structured output
 * @property {string[]} evidenceIds     // evidence this agent appended
 * @property {string|null} error
 */

/** @typedef {Object} Verdict
 * @property {boolean} pass
 * @property {{claim: string, classification: string, evidenceIds: string[]}[]} claims
 * @property {string} reason
 * @property {string[]|null} openQuestions
 */

/** @typedef {Object} DraftPost
 * @property {string} to
 * @property {string} subject           // "Re: " + original subject
 * @property {string} body
 * @property {string} caseId
 * @property {number} confidence
 * @property {string} route
 * @property {string[]} unresolvedClaims
 */

/** @typedef {Object} InvestigationPlan
 * @property {string[]} agentSubset             // agent keys to run in investigating state
 * @property {Object<string, string>} tasksPerAgent // agent key -> one-line task
 * @property {string[]} missingInfoQuestions    // questions to customer if route is ask_or_escalate
 */

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * @param {*} value
 * @param {string} name - field name for error messages
 * @param {string[]} allowed
 * @returns {string[]} errors
 */
function checkEnum(value, name, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return [`${name}: invalid value ${JSON.stringify(value)}; expected one of [${allowed.join(', ')}]`];
  }
  return [];
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateTriageFacts(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['triageFacts: expected an object'] };
  }
  for (const key of ['orgId', 'clusterId']) {
    if (value[key] !== null && typeof value[key] !== 'string') {
      errors.push(`${key}: must be a string or null, got ${JSON.stringify(value[key])}`);
    }
  }
  errors.push(...checkEnum(value.provider, 'provider', PROVIDERS));
  errors.push(...checkEnum(value.castaiMode, 'castaiMode', CASTAI_MODES));
  errors.push(...checkEnum(value.issueCategory, 'issueCategory', ISSUE_CATEGORIES));
  errors.push(...checkEnum(value.severity, 'severity', SEVERITIES));
  for (const key of ['components', 'missingInfo']) {
    if (!Array.isArray(value[key]) || !value[key].every((s) => typeof s === 'string')) {
      errors.push(`${key}: must be an array of strings`);
    }
  }
  for (const key of ['expected', 'actual']) {
    if (typeof value[key] !== 'string') {
      errors.push(`${key}: must be a string, got ${JSON.stringify(value[key])}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateCase(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['case: expected an object'] };
  }
  if (typeof value.caseId !== 'string' || value.caseId.length === 0) {
    errors.push('caseId: must be a non-empty string');
  }
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
    errors.push('createdAt: must be an ISO 8601 string');
  }
  if (value.source !== 'email') {
    errors.push(`source: invalid value ${JSON.stringify(value.source)}; expected "email"`);
  }
  if (value.email === null || typeof value.email !== 'object') {
    errors.push('email: must be an EmailInput object');
  } else {
    for (const key of ['from', 'fromName', 'fromFirstName', 'subject', 'body']) {
      if (typeof value.email[key] !== 'string') {
        errors.push(`email.${key}: must be a string`);
      }
    }
    if (!Array.isArray(value.email.thread)) {
      errors.push('email.thread: must be an array');
    }
  }
  errors.push(...checkEnum(value.status, 'status', CASE_STATUSES));
  if (value.triage !== null && !validateTriageFacts(value.triage).ok) {
    errors.push('triage: must be a valid TriageFacts or null');
  }
  for (const key of ['loopsUsed', 'maxLoops']) {
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || value[key] < 0) {
      errors.push(`${key}: must be a non-negative integer`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateHypothesis(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['hypothesis: expected an object'] };
  }
  if (typeof value.id !== 'string' || !/^H[1-9][0-9]*$/.test(value.id)) {
    errors.push(`id: must be an "H<n>" id, got ${JSON.stringify(value.id)}`);
  }
  if (typeof value.statement !== 'string' || value.statement.length === 0) {
    errors.push('statement: must be a non-empty string');
  }
  errors.push(...checkEnum(value.status, 'status', HYPOTHESIS_STATUSES));
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every((s) => typeof s === 'string')) {
    errors.push('evidenceIds: must be an array of strings');
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateEvidence(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['evidence: expected an object'] };
  }
  if (typeof value.id !== 'string' || !/^E[1-9][0-9]*$/.test(value.id)) {
    errors.push(`id: must be an "E<n>" id, got ${JSON.stringify(value.id)}`);
  }
  errors.push(...checkEnum(value.type, 'type', EVIDENCE_TYPES));
  for (const key of ['source', 'result', 'reference']) {
    if (typeof value[key] !== 'string') {
      errors.push(`${key}: must be a string, got ${JSON.stringify(value[key])}`);
    }
  }
  if (typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt))) {
    errors.push('capturedAt: must be an ISO 8601 string');
  }
  if (value.toolRun !== null && value.toolRun !== undefined) {
    if (typeof value.toolRun !== 'object' || Array.isArray(value.toolRun)) {
      errors.push('toolRun: must be an object or null');
    } else {
      if (typeof value.toolRun.tool !== 'string') {
        errors.push('toolRun.tool: must be a string');
      }
      if (typeof value.toolRun.ok !== 'boolean') {
        errors.push('toolRun.ok: must be a boolean');
      }
      if (value.toolRun.args === null || typeof value.toolRun.args !== 'object') {
        errors.push('toolRun.args: must be an object');
      }
    }
  }
  if (value.reproduced !== undefined && typeof value.reproduced !== 'boolean') {
    errors.push('reproduced: must be a boolean when present');
  } else if (value.reproduced !== undefined && value.type !== 'reproduction') {
    errors.push('reproduced: only allowed on evidence of type "reproduction"');
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateLedger(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['ledger: expected an object'] };
  }
  if (typeof value.caseId !== 'string' || value.caseId.length === 0) {
    errors.push('caseId: must be a non-empty string');
  }
  if (!Array.isArray(value.customerQuestion) || !value.customerQuestion.every((s) => typeof s === 'string')) {
    errors.push('customerQuestion: must be an array of strings');
  }
  if (value.provider !== null && value.provider !== undefined) {
    errors.push(...checkEnum(value.provider, 'provider', PROVIDERS));
  }
  if (!Array.isArray(value.hypotheses)) {
    errors.push('hypotheses: must be an array');
  } else {
    for (const h of value.hypotheses) errors.push(...validateHypothesis(h).errors.map((e) => `hypotheses: ${e}`));
  }
  if (!Array.isArray(value.evidence)) {
    errors.push('evidence: must be an array');
  } else {
    for (const e of value.evidence) errors.push(...validateEvidence(e).errors.map((m) => `evidence: ${m}`));
  }
  if (value.tests === null || typeof value.tests !== 'object') {
    errors.push('tests: must be an object with unit/integration/e2e/regression');
  } else {
    for (const key of TEST_KEYS) {
      errors.push(...checkEnum(value.tests[key], `tests.${key}`, TEST_LEVELS));
    }
  }
  if (value.solution === null || typeof value.solution !== 'object') {
    errors.push('solution: must be an object');
  } else {
    errors.push(...checkEnum(value.solution.status, 'solution.status', SOLUTION_STATUSES));
    if (value.solution.summary !== null && typeof value.solution.summary !== 'string') {
      errors.push('solution.summary: must be a string or null');
    }
  }
  if (value.confidence !== null && value.confidence !== undefined && typeof value.confidence !== 'number') {
    errors.push('confidence: must be a number or null');
  }
  if (!Array.isArray(value.auditLog)) {
    errors.push('auditLog: must be an array');
  } else {
    for (const a of value.auditLog) {
      if (a === null || typeof a !== 'object') {
        errors.push('auditLog: entries must be objects');
      } else {
        for (const key of ['at', 'agent', 'action', 'detail']) {
          if (typeof a[key] !== 'string') errors.push(`auditLog.${key}: must be a string`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateVerdict(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['verdict: expected an object'] };
  }
  if (typeof value.pass !== 'boolean') {
    errors.push('pass: must be a boolean');
  }
  if (!Array.isArray(value.claims)) {
    errors.push('claims: must be an array');
  } else {
    for (const c of value.claims) {
      if (c === null || typeof c !== 'object') {
        errors.push('claims: entries must be objects');
        continue;
      }
      if (typeof c.claim !== 'string') errors.push('claims.claim: must be a string');
      errors.push(...checkEnum(c.classification, 'claims.classification', CLAIM_CLASSIFICATIONS)
        .map((e) => e.replace('claims.classification', 'classification')));
      if (!Array.isArray(c.evidenceIds) || !c.evidenceIds.every((s) => typeof s === 'string')) {
        errors.push('claims.evidenceIds: must be an array of strings');
      }
    }
  }
  if (typeof value.reason !== 'string') {
    errors.push('reason: must be a string');
  }
  if (value.openQuestions !== null && value.openQuestions !== undefined) {
    if (!Array.isArray(value.openQuestions) || !value.openQuestions.every((s) => typeof s === 'string')) {
      errors.push('openQuestions: must be an array of strings or null');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateDraftPost(value) {
  const errors = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['draftPost: expected an object'] };
  }
  for (const key of ['to', 'subject', 'body', 'caseId']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      errors.push(`${key}: must be a non-empty string`);
    }
  }
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 100) {
    errors.push('confidence: must be a number between 0 and 100');
  }
  errors.push(...checkEnum(value.route, 'route', DRAFT_ROUTES));
  if (!Array.isArray(value.unresolvedClaims) || !value.unresolvedClaims.every((s) => typeof s === 'string')) {
    errors.push('unresolvedClaims: must be an array of strings');
  }
  return { ok: errors.length === 0, errors };
}
