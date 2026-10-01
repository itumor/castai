# CAST AI Support Swarm — Module Contracts

This file is the **single source of truth** for every module in this package.
Build agents: implement EXACTLY these signatures and data shapes. Do not invent
extra dependencies (no npm packages — Node stdlib only, `node:test` for tests).
Everything is ESM (`import`/`export`). All file paths below are relative to this
package root (`projects/castai-support-swarm/`).

Core principle: **the system never answers because it thinks it knows; it answers
when it can show why the answer is correct.** The writer agent may not claim an
action ("I checked", "I reproduced", "we confirmed") unless the case's evidence
ledger contains matching evidence.

Safety (from root AGENTS.md): read-only posture. Against CAST AI and
Kubernetes resources no module may perform HTTP methods other than GET, no
kubectl mutations, and no customer-facing sends — the email tool only writes
draft files for human review. The one deliberate exception is the §2 LLM
client itself: HttpLlm POSTs to the configured model provider endpoints
(api.anthropic.com / api.openai.com) exactly as §2 specifies; those endpoints
are neither CAST AI nor Kubernetes resources.

---

## 1. Data model — `src/core/model.js`

### Claim classes (evidence ladder, ascending strength)
```js
export const CLAIM_CLASSES = [
  'UNKNOWN', 'INFERRED', 'SUPPORTING', 'DOCUMENTED',
  'ENV_CONFIRMED', 'CODE_CONFIRMED', 'TEST_CONFIRMED', 'REPRODUCED', 'VERIFIED',
];
```

### Evidence types → base class + confidence points (deterministic scoring)
```js
export const EVIDENCE_TYPES = {
  customer_statement: { cls: 'UNKNOWN',        points: 0  },
  inference:          { cls: 'INFERRED',       points: 0  },
  prior_ticket:       { cls: 'SUPPORTING',     points: 5  },
  documentation:      { cls: 'DOCUMENTED',     points: 20 },
  api_spec:           { cls: 'DOCUMENTED',     points: 20 },
  environment:        { cls: 'ENV_CONFIRMED',  points: 10 },
  source_code:        { cls: 'CODE_CONFIRMED', points: 25 },
  e2e_test:           { cls: 'TEST_CONFIRMED', points: 20 },
  reproduction:       { cls: 'REPRODUCED',     points: 25 },
};
```

### Functions
```js
createCase({ id, thread, customer }) -> Case
// thread: { from, subject, messages: [{ from, date, body }] }
// customer: { name, email, orgId?, clusterId? }
// Case shape:
// {
//   id, createdAt, thread, customer,
//   triage: null, plan: null,
//   hypotheses: [],  // { id:'H1', statement, status:'open'|'confirmed'|'rejected', evidenceIds: [] }
//   evidence: [],    // { id:'E1', type, source, ref?, summary, agentId, at }
//   claims: [],      // { id:'C1', statement, needsVerification, status:'proposed'|'verified'|'rejected', evidenceIds: [] }
//   tests: { unit:'not_run', integration:'not_run', e2e:'not_run', regression:'not_run' }, // 'not_run'|'passed'|'failed'
//   solution: { status:'none', summary:'', steps: [] }, // status 'none'|'proposed'|'verified'
//   confidence: 0, verdict: null, reply: null, escalation: null,
//   kbNotes: [], trace: []
// }

addEvidence(caseObj, { type, source, ref?, summary, agentId }) -> evidence object (assigns id, at)
addHypothesis(caseObj, { statement, evidenceIds? }) -> hypothesis object
setHypothesisStatus(caseObj, id, status, evidenceIds?) -> hypothesis object
addClaim(caseObj, { statement, needsVerification = true, evidenceIds? }) -> claim object
linkEvidenceToClaim(caseObj, claimId, evidenceId) -> claim object
claimClasses(caseObj, claimId) -> string[] // unique classes derived from linked evidence EVIDENCE_TYPES
computeConfidence(caseObj) -> number 0..100
// Sum points of the DISTINCT evidence types present in evidence linked to claims
// that are status 'verified' OR 'proposed' with needsVerification=false ... NO —
// Simpler, deterministic: consider all evidence linked to claims with
// status !== 'rejected'. Sum distinct-type points, cap at 100.
verifyClaims(caseObj) -> caseObj  // helper: for each claim, if classes include a
// class >= 'ENV_CONFIRMED' (ladder index >= 4) -> status 'verified'
confidenceGate(confidence) -> 'NEEDS_MORE_EVIDENCE'|'ANSWER_WITH_UNCERTAINTY'|'ANSWER_WITH_EVIDENCE'|'VERIFIED_ANSWER'
// <60 NEEDS_MORE_EVIDENCE; 60-79 UNCERTAINTY; 80-94 EVIDENCE; >=95 VERIFIED_ANSWER.
// Non-finite or negative input (NaN, Infinity, <0) MUST degrade safely to
// NEEDS_MORE_EVIDENCE — a corrupt score can never unlock the strongest gate.
```

---

## 2. LLM abstraction — `src/core/llm.js`

```js
export class HeuristicLlm {
  // Offline deterministic "brain" so the whole system works without API keys.
  // complete({ system, prompt, json }) -> Promise<string>
  // Recognises these intents by scanning prompt text (case-insensitive keywords):
  //  - 'triage'    -> JSON TriageResult (see triage agent contract) using keyword rules
  //  - 'plan'      -> JSON { agents: [...] } (best-effort; supervisor clamps anyway)
  //  - 'writer'    -> a plain, human-sounding draft assembled from data listed in the prompt
  // Otherwise returns '{}'.
}
export class HttpLlm {
  constructor({ provider = 'anthropic', apiKey, model, fetchImpl })
  // provider 'anthropic': POST https://api.anthropic.com/v1/messages
  //   model default 'claude-sonnet-4-5', header 'x-api-key', 'anthropic-version: 2023-06-01'
  // provider 'openai': POST https://api.openai.com/v1/chat/completions
  // complete({ system, prompt, json }) -> Promise<string>
}
export function defaultLlm(env = process.env)
// -> HttpLlm if env.ANTHROPIC_API_KEY or env.OPENAI_API_KEY set, else HeuristicLlm
export function jsonOnly(text) -> any  // tolerant JSON extraction (```json fences, leading prose).
// Object-preferred: when both array and object blocks exist, the first balanced {...}
// block wins (triage JSON is an object — a stray '[1]' in prose must not shadow it);
// falls back to the first balanced [...] block when no object block exists.
```

---

## 3. Permission policy — `src/core/policy.js`

```js
export class PolicyError extends Error {}
export const AGENT_PERMISSIONS = {
  supervisor:  { tools: [], writes: ['plan'] },
  triage:      { tools: ['kb'] },
  researcher:  { tools: ['kb', 'docsSearch'] },
  sre:         { tools: ['kube', 'castai', 'lab'] },
  repro:       { tools: ['lab'] },
  qa:          { tools: ['lab', 'testRunner'] },
  product:     { tools: ['kb', 'repoSearch'] },
  architect:   { tools: ['kb'] },
  security:    { tools: ['kb'] },
  verifier:    { tools: ['kb'] },
  writer:      { tools: ['emailDraft'] },
  escalation:  { tools: ['kb'] },
  knowledge:   { tools: ['kb', 'kbWrite'] },
};
assertToolAllowed(agentId, toolName) // throws PolicyError when not listed
export const CASTAI_READ_PATHS = [ /^\/v1\/organizations(\/|$)/, /^\/v1\/kubernetes\/external-clusters(\/|$)/, /^\/v1\/cost-reports(\/|$)/, /^\/v1\/workload-autoscaling(\/|$)/, /^\/v1\/inventory(\/|$)/, /^\/v1\/recommendations(\/|$)/, /^\/v1\/pricing(\/|$)/ ];
assertCastaiReadPath(path) // throws PolicyError unless path matches CASTAI_READ_PATHS
export const KUBECTL_READ_VERBS = ['get', 'describe', 'logs', 'top', 'explain', 'api-resources', 'version', 'config'];
assertKubectlArgs(args /* string[] */) // throws PolicyError unless args[0] in KUBECTL_READ_VERBS;
// also throws on dangerous flags and verbs. Binding restrictions (read-only posture):
// - mutating verbs anywhere in the arg list: 'exec','apply','delete','edit','patch','cp',
//   'port-forward','attach' ('--follow=false' and similar benign output flags are fine);
// - 'config' is read-only only for subcommands 'get-contexts', 'current-context', 'view'
//   ('config use-context|set-context|delete-cluster|...' mutate kubeconfig -> throw);
// - auth/impersonation-overriding flags throw in BOTH forms ('--flag=value' and '--flag value'):
//   --server (and -s), --token, --kubeconfig, --context, --as, --as-group, --username,
//   --password, --client-certificate, --client-key, --certificate-authority;
// - 'secret' / 'secrets' as a resource argument throws for get/describe/logs (cluster
//   secret values must never flow into the ledger);
// - '--raw' throws entirely (arbitrary API-server paths bypass the resource checks).
export const SENSITIVE_KEYS = ['token', 'secret', 'password', 'apikey', 'api_key', 'authorization', 'credential'];
redact(value) -> deep-cloned value with any object key whose lowercase name contains a SENSITIVE_KEYS entry replaced by '***REDACTED***'
// Additionally, STRING values that embed secret-shaped material are masked:
// 'Bearer <token>', JWTs (eyJ...), AWS key ids (AKIA/ASIA+16), long hex runs (>=32),
// and 'sensitiveWord: value' / 'sensitiveWord = value' pairs (quoted or not).
export function maskSecretsString(text) // the string-level mask used by redact and the kube tool
```

---

## 4. Reply guard — `src/core/guard.js`

```js
export const BANNED_PHRASES = [
  'thank you for reaching out', 'based on the information provided', 'rest assured',
  'please do not hesitate', 'as an ai', 'i apologize for any inconvenience',
  'seamless', 'delve', 'furthermore', 'in conclusion', 'i hope this email finds you well',
];
export const CLAIM_REQUIREMENTS = [
  // A first-person claim in the draft requires evidence classes in the case ledger.
  // claims here = union of classes across all linked evidence of non-rejected claims.
  // Patterns cover tenses with 've/have and hedge adverbs (just/already), plus
  // confirm/observe/find synonyms — a live LLM must not slip the guard by rephrasing.
  { pattern: /\bI(?:'ve| have)?\s+(?:just |already )?(?:checked|looked into|inspected|reviewed your)\b/i, needs: ['ENV_CONFIRMED', 'DOCUMENTED', 'CODE_CONFIRMED'] },
  { pattern: /\bI(?:'ve| have)?\s+(?:just |already )?(?:reproduced|recreated)\s+(?:this|the|it)\b/i,     needs: ['REPRODUCED'] },
  { pattern: /\b(?:we|I)(?:'ve|\s+have)?\s+(?:just |already )?(?:confirmed|verified)\b/i,                needs: ['VERIFIED', 'TEST_CONFIRMED', 'REPRODUCED'] },
  { pattern: /\bI(?:'ve| have)?\s+(?:just |already )?ran\s+(?:the\s+)?(?:test|tests)\b|\bI\s+(?:just |already )?executed\s+(?:the\s+)?(?:test|tests)\b/i, needs: ['TEST_CONFIRMED'] },
  { pattern: /\b(?:we|I)\s+can\s+confirm\b/i,                                                           needs: ['VERIFIED', 'TEST_CONFIRMED', 'REPRODUCED'] },
  { pattern: /\b(?:we|I)\s+(?:observed|found)\s+(?:that\s+)?(?:the|your|this|it)\b/i,                   needs: ['ENV_CONFIRMED', 'DOCUMENTED', 'CODE_CONFIRMED'] },
];
export function caseClaimClasses(caseObj) -> string[] // union ladder classes of non-rejected claims' linked evidence
export function evaluateReply({ caseObj, draft }) -> {
  ok: boolean,
  violations: [{ sentence, needs, present }],   // first-person claims without required evidence
  banned: [{ phrase, index, indices }],         // banned AI-ish phrases (word-bounded; index = first, indices = all)
  tone: { score /* 0..100 */, issues: string[], wordsPerSentence, hasGreeting, hasNextStep },
}
export function sanitizeReply({ caseObj, draft, violations }) -> string
// Rewrites each violating sentence to hedged wording, e.g.
//   "I checked your cluster" -> "Based on the CAST AI documentation" (uses available classes honestly).
// The first-person claim span is removed WHEREVER it appears in the sentence (not only
// at ^), surrounding connectors (and/but/so/also) are cleaned up, and the factual
// remainder is kept. Strips banned phrases with word boundaries ('delved'/'as an aid'
// are NOT hits). Returns sanitized draft. Sanitized output MUST re-pass evaluateReply.
// Tone scoring (deterministic):
//   +20 greeting matches /^Hi (?:[A-Z][A-Za-z'’-]*|there),/   ('Hi there,' is the no-name fallback)
//   +20 no banned phrases
//   +20 no ungrounded first-person claims
//   +15 avg words/sentence <= 24 (conversational)
//   +15 contains at least one contraction (n't, 're, 'll, 've)
//   +10 ends with a clear next step (last non-empty line contains 'you', '?', or 'If ')
```

---

## 5. Trace — `src/core/trace.js`

```js
export function record(caseObj, actor, action, detail = {}) // pushes { at, actor, action, detail } onto caseObj.trace (redact(detail) first — import redact from policy.js)
export async function persistTrace(caseObj, dir) -> path // writes <dir>/<caseObj.id>.trace.jsonl (one JSON object per line), mkdir -p first
// persistTrace validates caseObj.id exactly like draftEmail validates caseId: separators
// ('/', '\\') and '..' throw — a case id must never escape the traces directory.
// Guarantee: key-based redaction (§3) + secret-shaped string masking; the audit trail
// does not persist a value shaped like a known secret.
```

---

## 6. Tools — `src/tools/*`

### `src/tools/castai.js` — read-only CAST AI API client
```js
import { assertCastaiReadPath, redact } from '../core/policy.js';
export function createCastaiClient({ apiKey, baseUrl, fetchImpl = fetch })
// baseUrl default env.CASTAI_API_BASE || 'https://api.eu.cast.ai' (AGENTS.md default for this repo);
// throws if URL host does not end with 'cast.ai'.
// Returns { get(path) } — ONLY get exists. get asserts assertCastaiReadPath(path),
// calls fetchImpl(baseUrl + path, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } }),
// throws on !ok with { status }, returns redact(await res.json()). Never logs the key.
```

### `src/tools/kube.js` — read-only kubectl wrapper
```js
import { execFile } from 'node:child_process';
import { assertKubectlArgs, maskSecretsString } from '../core/policy.js';
export async function kubectlRead(args, { execImpl } = {}) // validates args then runs kubectl; returns
// stdout passed through maskSecretsString — cluster secret material can never reach the ledger
export function parseKubejson(stdout) // JSON.parse helper used by sre agent
```

### `src/tools/kb.js` — knowledge base search (pure fs, read-only)
```js
export const DEFAULT_KB_ROOTS = ['.kimchi/docs', 'brain/notes']; // resolved against repo root passed in
export async function searchKb({ repoRoot, roots = DEFAULT_KB_ROOTS, query, limit = 5 })
// Recursively reads *.md|*.txt|*.skill under each root; scores by case-insensitive
// term frequency of DISTINCTIVE query tokens (a stopword list drops 'what/is/the/…'
// so ranking and windows follow the topic, not chatter; all-stopword queries
// degenerate to unfiltered). Filename match counts 3x. Returns
// [{ path, score, snippet }] sorted desc; snippet = the ~200-char window with the
// highest DENSITY of distinct query tokens (ties: most hits, then earliest) — a
// content-rich window, not the document header — SNAPPED to sentence boundaries
// (heading lines skipped, last sentence allowed to finish beyond the budget).
```

### `src/tools/email.js` — draft-only email outbox (NEVER sends)
```js
export async function draftEmail({ outboxDir, caseId, to, subject, body, meta = {} })
// mkdir -p outboxDir; writes <outboxDir>/<caseId>.md (body) and <outboxDir>/<caseId>.json
// ({ to, subject, caseId, draftOnly: true, createdAt, ...meta }); returns { mdPath, jsonPath }.
```

### `src/tools/lab.js` — simulated cluster lab (deterministic reproduction sandbox)
```js
export function createCluster(spec)
// spec: { nodes: [{ name, managed=true, doNotEvict=false }],
//         pods: [{ name, node, pdbProtected=false, localStorage=false, managed=true, canMove=true }] }
export function findScaleDownBlockers(cluster) -> [{ node, reasons: string[] }]
// A node can be removed iff managed && !doNotEvict && every pod can move:
// pod blocks when pdbProtected || localStorage || !managed || !canMove.
// reasons strings are stable, e.g. 'pdb-blocks-eviction', 'pod-has-local-storage',
// 'pod-not-managed-by-controller', 'node-marked-do-not-evict', 'node-not-castai-managed'.
export function applyFix(cluster, fix) // fix: { kind: 'remove-pdb'|'remove-local-storage'|'adopt-pod', pod?, node? } — returns new cluster
export function simulateScaleDown(cluster) -> { removable: string[], blocked: [{node, reasons}] }
```

---

## 7. Agents — `src/agents/*`

Every agent module exports a factory `create<Name>({ llm, tools }) -> agent` where
`agent = { id, name, async run(ctx) }`. `ctx = { caseObj, repoRoot, params = {} }`.
`run` MUST: use `record()` for every meaningful action; only use tools permitted by
AGENT_PERMISSIONS (call assertToolAllowed first); return a short structured result.
`tools` is `{ kb, castai, kube, lab, email }` factories/clients assembled by the orchestrator.
Construction styles (deliberate): triage, supervisor and researcher are built through
the `createAgent` wrapper in `src/agents/base.js` (guaranteed agent.start/agent.end
trace records + guarded `useTool` helper); the remaining agents hand-roll `run()`
with the same obligations (record() + explicit assertToolAllowed per tool touched),
because their tool use is conditional (e.g. qa uses testRunner only when provided).
The writer persists nothing itself (draft-only posture: the orchestrator writes the
outbox entry), so `emailDraft` is asserted by the orchestrator's persistence step.

### `src/agents/registry.js`
```js
export const AGENT_IDS = ['supervisor','triage','researcher','sre','repro','qa','product','architect','security','verifier','writer','escalation','knowledge'];
export const AGENT_REGISTRY = AGENT_IDS.map(...) // [{ id, name, mission, permissions (mirror policy), activateWhen: string[] }]
// activateWhen uses issue categories from triage:
export const ISSUE_CATEGORIES = ['docs_question','node_downscale','node_upscale','iam_onboarding','workload_autoscaling','cost_reporting','spot','token_rotation','product_bug','billing','unknown'];
```

### `src/agents/triage.js` — `createTriage({ llm, tools })`
`run(ctx)`: builds TriageResult via llm (HeuristicLlm keyword rules) and stores on `caseObj.triage`.
```js
// TriageResult: { category /* ISSUE_CATEGORIES */, provider: 'aws'|'azure'|'gcp'|'unknown',
//   platform: 'eks'|'aks'|'gke'|'unknown', castaiMode: 'readonly'|'workload-autoscaler'|'node-autoscaler'|'full'|'unknown',
//   questions: string[], severity: 'low'|'medium'|'high', missingInfo: string[],
//   entities: { clusterId?, orgId? }, customerName: 'Firstname' | '' }
// HeuristicLlm rules (must implement): 'scal'+'down|not scale|stuck' -> node_downscale;
// 'PutRolePolicy|AccessDenied|403|onboard' -> iam_onboarding; '401|token|authoriz' -> token_rotation;
// 'savings|cost|billing method|formula|baseline' -> cost_reporting; 'workload autoscal|recommendation|vpa|hpa' -> workload_autoscaling;
// 'spot' -> spot; 'how do|documentation|docs' alone -> docs_question; else 'unknown'.
// customerName: first token of From: display name or salutation "Hi X,".
```

### `src/agents/supervisor.js` — `createSupervisor({ llm })`
```js
export const PLAN_TEMPLATES = {
  docs_question:        ['researcher', 'verifier', 'writer'],
  node_downscale:       ['sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge'],
  node_upscale:         ['sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge'],
  iam_onboarding:       ['sre', 'security', 'researcher', 'repro', 'verifier', 'writer', 'knowledge'],
  token_rotation:       ['researcher', 'sre', 'architect', 'verifier', 'writer', 'knowledge'],
  workload_autoscaling: ['researcher', 'sre', 'product', 'verifier', 'writer', 'knowledge'],
  cost_reporting:       ['researcher', 'product', 'qa', 'verifier', 'writer', 'knowledge'],
  spot:                 ['researcher', 'sre', 'verifier', 'writer', 'knowledge'],
  product_bug:          ['sre', 'researcher', 'repro', 'qa', 'product', 'architect', 'security', 'verifier', 'writer', 'escalation', 'knowledge'],
  billing:              ['researcher', 'verifier', 'writer'],
  unknown:              ['researcher', 'verifier', 'writer'],
};
// run(ctx): asks llm for a plan, intersects/orders by PLAN_TEMPLATES[caseObj.triage.category],
// stores caseObj.plan = { agents, rationale }. Never returns fewer than the template.
```

### `src/agents/researcher.js`
Searches kb roots (+ docsSearch tool if provided) for each question in triage;
adds `documentation`/`api_spec`/`prior_ticket` evidence + claims (needsVerification: true).
Records the source path as `ref` — REPO-RELATIVE when the file resolves under repoRoot
(`.kimchi/docs/x.md`), so internal absolute machine paths never enter the ledger.
Every snippet passes cleanSnippet() (exported): markdown residue removal, internal
doc-path neutralisation (content paths become 'the internal runbook'), mid-word
leading-fragment repair, trailing-fragment closing, and a sentence filter
(>=20 chars, terminated, non-junk, not a question, not a filename list). An
irreparable snippet means the whole hit is skipped: no evidence, no claim.
Returns { claimsAdded, evidenceAdded }.

### `src/agents/sre.js`
Investigation checklist driven by category. In offline mode uses `tools.lab` cluster
built from `ctx.params.simSpec` (orchestrator provides). Adds `environment` evidence
(e.g. "node X blocked by pdb-blocks-eviction"), opens hypotheses
(e.g. H: 'PDB prevents eviction'). Returns { hypothesesAdded, evidenceAdded }.

### `src/agents/repro.js`
Uses tools.lab: runs simulateScaleDown, then applyFix for the top blocker and shows
the node becomes removable. Adds `reproduction` evidence, sets hypothesis status
confirmed/rejected. Returns { reproduced: boolean, fix? }.

### `src/agents/qa.js`
Runs `tools.testRunner` if provided, else simulates levels from lab results:
sets caseObj.tests.e2e='passed' when repro succeeded etc.; adds `e2e_test` evidence.
Honesty marker (binding): the evidence summary MUST state its backing — a
testRunner-backed entry says 'test runner executed'; a lab-derived entry says
'lab-simulated (no external test runner executed)'. The writer keys its wording
on this marker — a reply must never tell the customer "I ran the tests" for a
lab-derived result. Returns { tests: caseObj.tests }.

### `src/agents/product.js`
Searches local CAST AI sources (repoRoot castai-mcp-server/src, castai-terraform-1) for
keywords from triage (e.g. savings endpoints) via grep-like fs scan; adds `source_code`
evidence with file refs. Returns { evidenceAdded }.

### `src/agents/architect.js`
Consumes hypotheses + evidence, writes caseObj.solution = { status:'proposed', summary, steps[] }
(incl. rollback/alternative where applicable). Returns { solution }.
Fix rules fire on TWO deliberately separate corpora: cause-scoped rules match ONLY
confirmed hypotheses + evidence linked to them (unrelated KB noise must never
attach wrong steps to an answer), while scope:'customer' rules (token rotation
guidance) match the customer's own words so category-level facts are stated even
without a lab hypothesis.

### `src/agents/security.js`
For iam_* categories: reasons about least privilege (e.g. PutRolePolicy is write —
must come from the approved Terraform path, never a live console change).
Evidence honesty (binding): every `documentation`/`prior_ticket` evidence entry MUST
quote a real source the agent actually read via its `kb` tool permission
(summary from the hit snippet, repo-relative ref) — invented refs are fabrication
and forbidden. The least-privilege reasoning itself is recorded as ONE
`inference` evidence entry (INFERRED, 0 points, no ref) and appended as
'Risk: ...' notes into solution steps. It also adds ONE claim stating the
least-privilege conclusion (needsVerification: true), linked ONLY to the KB
evidence it actually read plus that inference entry — the verifier then judges
it on real material. Returns { evidenceAdded, risks: string[] }.

### `src/agents/verifier.js` — the strict gate
```js
// run(ctx): for each claim with needsVerification:
//   cls = claimClasses(caseObj, claim.id)
//   PASS claim iff cls contains any of ENV_CONFIRMED/CODE_CONFIRMED/TEST_CONFIRMED/REPRODUCED (hard proof),
//   OR at least TWO independent classes incl. DOCUMENTED (docs+api count as one class each).
// Also calls verifyClaims(caseObj) to flip verified statuses.
// Enterprise mode ctx.params.strictTwoSource === true: require >=2 independent hard-or-doc classes.
// Sets caseObj.verdict = { status:'PASS'|'REJECT', rejectedClaims: [{id, statement, missing}], at }.
// REJECT when ANY needsVerification claim fails OR there are zero evidence-backed claims.
```

### `src/agents/writer.js`
Builds `draft` from: customerName, verified claims, solution.steps, relevant refs.
Offline assembly opens with a customerTopic() sentence (the cleaned subject) then
grounded first-person leads only. Customer bodies cite PUBLIC docs.cast.ai links
ONLY; internal KB paths, machine paths and code refs stay in meta.references
(internalRefs) for the human reviewer (root AGENTS.md: never forward raw internal
material). Near-paraphrase findings (Jaccard >= 0.35 over >=4-letter word sets)
are emitted once, strongest evidence rank first.
Style: direct greeting `Hi <Name>,`, short sentences, contractions, states what was
checked/found (only grounded), one next step, sign-off `— CAST AI Support`. In live
mode the llm writes it; offline it assembles deterministic text. Then:
`guard = evaluateReply({caseObj, draft})`; if !guard.ok or banned found ->
`draft = sanitizeReply(...)` and re-evaluate (max 2 passes). Sets
`caseObj.reply = { body: draft, guard }`. Returns { reply }.
Binding details:
- First-person leads are keyed to what actually happened: TEST_CONFIRMED from a
  real test runner -> "I ran the tests ..."; TEST_CONFIRMED derived from the lab
  -> "the fix held in our reproduction lab" (honest about the simulation).
- The reply body NEVER embeds internal absolute paths and never prints raw
  evidence refs; document citations are repo-relative doc paths only
  ('.kimchi/docs/foo.md'), and full refs live in the outbox .json meta
  (meta.references) for the human reviewer. The live-mode prompt likewise
  withholds path refs (doc titles at most).
- Hard fallback: if the guard still fails after the 2 sanitize passes, the
  writer MUST discard the draft and emit the clarify template instead
  (caseObj.reply gains { forcedClarify: true }); a draft that fails the guard
  must never reach the outbox as-is. The pass budget is params.maxGuardPasses
  (default 2); the orchestrator never sets it — tests use 0 to exercise this
  fallback deterministically.

### `src/agents/escalation.js`
Writes `caseObj.escalation` markdown package: problem, expected vs observed, env,
hypotheses tested w/ status, evidence index, repro summary, tests, customer impact,
attachments list. Returns { escalation }.

### `src/agents/knowledge.js`
Writes KB note `kb/<date>-<caseId>.md` (inside this package): generic problem,
detection signals, resolution, reusable checklist. Appends path to caseObj.kbNotes.
Notes are re-ingested as prior_ticket evidence, so they carry NO customer
identifiers: email addresses, org/cluster-shaped hex ids, and the case
customer's name tokens are masked before writing. Returns { notePath }.

---

## 8. Orchestrator — `src/pipeline/orchestrator.js`

```js
export async function runCase(threadInput, deps) -> {
  caseObj, summary: { verdict, confidence, gate, replyPath?, escalationPath?, agentsRun: string[] },
}
// deps: { repoRoot, llm, tools, outboxDir, kbRoots?, maxVerifyLoops = 2,
//         strictTwoSource = false, simSpec?, seedClaims? }
// threadInput: { from, subject, messages:[...] }
// Flow:
// 1. createCase; record 'case.received'
// 2. triage.run    (seedClaims, if provided, are added as proposed claims — used by evals to test the verifier)
// 3. supervisor.run -> plan
// 4. For each agentId in plan: instantiate via registry factored map ALL_AGENTS = { triage: createTriage, ... } exported from src/agents/index.js
//    - skip 'knowledge' until the end; run 'escalation' only when needed (see 6)
// 5. After 'verifier': if verdict REJECT and loops left: record feedback, re-run
//    researcher+sre with verifier feedback in ctx.params, then verifier again.
// 6. computeConfidence + confidenceGate + VERDICT-AWARE MODE (the gate informs,
//    the verdict decides):
//    - verdict REJECT -> writer in clarify mode (params.mode='clarify': asks the
//      customer for missing info, no technical claims) OR escalation when
//      triage.category==='product_bug'. No confidence score overrides a REJECT.
//    - verdict PASS -> writer normal mode (answer-with-citations), even when the
//      confidence gate is NEEDS_MORE_EVIDENCE: a documentation-class answer the
//      verifier passed MUST be delivered with its cited sources rather than
//      withheld behind a points ceiling designed for test-backed categories.
//    - summary.gate still reports confidenceGate(computeConfidence(caseObj)).
// 7. knowledge.run when verdict PASS
// 8. email tool: persist reply draft (or escalation package) to outboxDir; persistTrace.
//    The reply-draft .json meta carries meta.references (repo-relative doc refs of
//    the claims used) for the human reviewer — never internal absolute paths.
// 9. return summary
```

### Claim curation (orchestrator duty, binding semantics)

Agents PROPOSE claims; the orchestrator selects the claim set the case stands
behind, then the VERIFIER alone judges it (the pass rule never runs inside
curation). Before each verifier run the orchestrator:
- **(a) hypothesis synthesis**: confirmed hypotheses become claims grounded in the
  hypothesis evidence plus same-ref evidence (the same incident).
- **(b) cluster synthesis**: >=2 unlinked evidence entries sharing >=2 strong
  tokens (or a ref) form a cluster; its strongest summary becomes a claim.
- **(c1) topical corroboration**: evidence sharing >=1 strong token with a claim
  is linked to it, capped (4 new links/claim, new-classes-first, hard-first).
- **(c2) KB corroboration**: the KB is consulted with the synthesized claims'
  own wording; genuinely corroborating hits (>=1 shared strong token) become
  evidence (repo-relative refs) linked to those claims.
- **(d) claim-set selection (relevance, NOT the verifier's pass rule)**: a claim
  that is not anchored in the customer's thread is removed from
  caseObj.claims and trace-recorded as 'claims.pruned' with reason
  'off-topic' — an unrelated KB note must never become a customer-facing
  finding. Anchored means (a) sharing >= 1 strong token with the thread
  SUBJECT and (b) sharing >= 2 strong tokens with the thread overall
  (subject + bodies); when the subject yields no strong tokens, (b) alone
  applies. Generic body nouns ('instance', 'types', 'capacity', ...) cannot
  anchor a claim by themselves — they collide with unrelated notes across the
  corpus. THIS IS THE ONLY PRE-GATE FILTER. Every selected claim — grounded or
  not — reaches the verifier; the verifier's REJECTED claims and the step-5
  feedback loop apply to agent-emitted claims exactly as to seeded ones.
  Claims the verifier already rejected are kept (history), never re-filtered.
  Strong tokens: lowercase alnum runs >= 5 chars, synonym-folded, minus the
  deterministic stoplist in the implementation (connectors, platform-universal
  words like 'castai'/'cluster'/'kubernetes', and known corpus glue/person
  words such as 'verified', 'document', 'behavior', 'expected').
- **(e) orphan-evidence pruning**: evidence referenced by no surviving claim or
  hypothesis is removed from the ledger (trace-recorded).
All steps are deterministic and trace-recorded.

### `src/agents/index.js` — `export const ALL_AGENTS = { supervisor, triage, researcher, sre, repro, qa, product, architect, security, verifier, writer, escalation, knowledge }` (factories).

---

## 9. CLI — `bin/support-swarm.mjs`

```
node bin/support-swarm.mjs answer <thread-file.md> [--live] [--strict] [--out <dir>]
```
Parses a thread file: the FIRST `From:`/`Subject:` headers at the top of the file
form the header block; everything after the first blank line is the body and is
kept verbatim (quoted/forwarded `From:`/`Subject:` lines inside the body survive) —
only `;; sim:` lines are filtered out of the body. Offline by default
(sim lab populated from a `;; sim:` comment block if present, e.g.
`;; sim: nodes=1 pods=1 pdb=true`). `--live` uses HttpLlm + real CAST AI client
(still read-only GET). Prints verdict/confidence/gate/agents and artifact paths.
Exit 0 always on handled cases, 2 on usage error.

---

## 10. Evals — `evals/`

- `evals/dataset/*.json`: tickets `{ id, file|inline thread, simSpec?, seedClaims?, expect: { category, planIncludes[], verdict, minConfidence?, maxConfidence?, replyMustInclude: [regex..], replyMustExclude: [regex..] } }`.
- `evals/run.js`: runs each through runCase (offline), scores checks, prints table,
  writes `evals/EVALUATION.md` + `evals/results.json`. Exit code 1 when any check fails.
  Universal safety checks on EVERY case: banned phrases, guard.ok, and
  reply.noInternalPaths (.kimchi/ | brain/notes/ | /Users/<user>/ in the customer
  body). When a case sets referencesMustInclude, the draft's JSON sidecar must
  carry those internal citations (provenance for the reviewer, not the customer).
- Required dataset cases (at minimum):
  1. `pdb-scaledown` — node stuck, PDB blocker (fixtures/thread-pdb-scaledown.md)
  2. `putrolepolicy-403` — onboarding IAM error
  3. `realized-savings` — methodology/formula question
  4. `token-rotation-401` — matches root repo runbook (POST /v1/kubernetes/external-clusters/{id}/token; old token stays valid; update secrets + restart components; org key is NOT a substitute — ground truth from `.kimchi/docs/`)
  5. `workload-autoscaler-not-applying`
  6. `adversarial-hallucination` — seedClaims with a FALSE claim ("The autoscaler ignores PDBs") and no evidence: verifier MUST REJECT and final output must be clarify/escalation, never a technical answer
  7. `vague-no-info` — almost no detail: expect NEEDS_MORE_EVIDENCE + clarify reply asking for org/cluster id

## 11. Tests — `tests/`

`node --test`, `assert/strict`. Layout mirrors src: `tests/core/*.test.js`,
`tests/tools/*.test.js`, `tests/agents/*.test.js`, `tests/pipeline/*.test.js`.
Use temp dirs (`fs.mkdtempSync(os.tmpdir()+...)`) for any fs writes. No network.
Mock fetchImpl/execImpl for tools. Every module in this contract gets a test file.
E2E tests cover: happy-path PDB case (verdict PASS, reply grounded, no banned phrases),
adversarial seeded false claim (REJECT loop then clarify), low-confidence clarify path.
