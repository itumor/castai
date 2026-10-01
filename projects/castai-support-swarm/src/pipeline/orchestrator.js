// src/pipeline/orchestrator.js — section 8 of CONTRACTS.md.
//
// runCase(threadInput, deps) drives a support case through the whole swarm:
//
//   1. createCase; record 'case.received'
//   2. triage.run (seedClaims, if provided, are added as proposed claims — the
//      adversarial eval uses them to test the verifier)
//   3. supervisor.run -> plan
//   4. For each agentId in plan (ALL_AGENTS from src/agents/index.js): run it.
//      'writer', 'escalation' and 'knowledge' are deferred — see below.
//   5. After 'verifier': verdict REJECT + loops left -> record feedback, re-run
//      researcher+sre with ctx.params.verifierFeedback, then verifier again.
//   6. computeConfidence + confidenceGate + VERDICT-AWARE MODE (contract §8):
//      - verdict REJECT -> writer clarify mode (params.mode='clarify'), or
//        escalation for product_bug — no confidence score overrides a REJECT;
//      - verdict PASS -> writer normal mode (answer-with-citations) even when
//        the confidence gate reports NEEDS_MORE_EVIDENCE; summary.gate still
//        reports confidenceGate(computeConfidence(caseObj)).
//   7. knowledge.run when verdict PASS
//   8. email tool persists the reply draft (or escalation package) to
//      outboxDir; persistTrace writes the trace to outboxDir/traces/
//   9. return summary
//
// CLAIM CURATION (orchestrator duty, deterministic and auditable — §8 spec)
// Agents PROPOSE claims; the orchestrator selects the claim set the case
// stands behind; the VERIFIER alone judges it (the pass rule never runs
// inside curation). Before each verifier run the orchestrator:
//   a) synthesizes claims from CONFIRMED hypotheses (grounded in the
//      hypothesis evidence plus same-ref evidence — the same incident);
//   b) synthesizes claims from corroborated evidence clusters (>=2 evidence
//      entries sharing >=2 strong tokens — independent sources agreeing);
//   c) topical corroboration: links additional evidence to agent-proposed
//      claims when statements and evidence summaries share strong tokens, and
//      consults the knowledge base with the synthesized-claim wording to
//      attach genuinely corroborating documentation;
//   d) claim-set SELECTION by relevance: a claim sharing < 2 strong tokens
//      with the customer thread is removed and trace-recorded as
//      'claims.pruned' with reason 'off-topic'. This is the ONLY pre-gate
//      filter — every selected claim, grounded or not, reaches the verifier,
//      so REJECTED claims and the step-5 feedback loop work for agent-emitted
//      claims exactly as §8 intends. Seeded claims are NEVER pruned or
//      auto-grounded — they exist so the verifier can reject unsupported
//      assertions.
//
// Safety: read-only. The email tool writes drafts only; the trace is redacted
// by core/trace; nothing is sent, posted, or mutated outside the outbox dir.

import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  computeConfidence,
  confidenceGate,
  createCase,
  addClaim,
  addEvidence,
  linkEvidenceToClaim,
} from '../core/model.js';
import { HeuristicLlm } from '../core/llm.js';
import { record, persistTrace } from '../core/trace.js';
import { ALL_AGENTS } from '../agents/index.js';
import { classifyKbHit, toLedgerRef } from '../agents/researcher.js';
import { internalRefs } from '../agents/writer.js';
import { assembleTools } from '../tools/index.js';

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

const DEFAULT_OUTBOX = path.join(os.tmpdir(), 'castai-support-swarm-outbox');

// Words that carry no topical meaning for corroboration (false-positive fuel).
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'along', 'also', 'because',
  'been', 'before', 'being', 'below', 'between', 'both', 'could', 'does',
  'doing', 'during', 'each', 'every', 'from', 'have', 'having', 'here',
  'into', 'itself', 'just', 'like', 'more', 'most', 'only', 'other', 'over',
  'same', 'shall', 'should', 'some', 'such', 'than', 'that', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under',
  'until', 'upon', 'very', 'what', 'when', 'where', 'which', 'while', 'with',
  'within', 'without', 'would', 'your', 'yours', 'node', 'nodes', 'cannot',
  'knowledge', 'source', 'documents', 'based', 'using', 'used', 'will',
  'still', 'make', 'makes', 'made', 'need', 'needs', 'please', 'thanks',
  'question', 'answer', 'support', 'customer', 'statement',
  // Platform-universal words: present in nearly every CAST AI case and KB
  // note, so they can never prove topic relevance on their own.
  'castai', 'cluster', 'kubernetes',
  // Generic verification/case-work glue observed producing junk links (eval
  // defect D3): one shared glue token must never corroborate a claim.
  'verified', 'verification', 'document', 'behavior', 'expected', 'related',
  'changes', 'state', 'action', 'working', 'issue', 'problem', 'found',
  'finding', 'findings', 'check', 'checks', 'checked', 'https', 'thanks',
  // Corpus person/org words: names appear in internal notes indiscriminately;
  // sharing a name never proves two entries discuss the same topic.
  'siemens', 'fabian', 'glejn', 'christoph', 'samuel', 'maria', 'ebrahim',
]);

// Deterministic synonym folding so a claim and an evidence entry that use
// different spellings of the same concept still corroborate each other.
function normalizeToken(token) {
  if (token === 'pdb' || token === 'poddisruptionbudgets') return 'poddisruptionbudget';
  if (token === 'evicting' || token === 'evicted' || token === 'evicts' || token === 'evictions') return 'eviction';
  if (token === 'scaledown' || token === 'scaling') return 'scale';
  if (token === 'autoscaling') return 'autoscaler';
  if (token === 'recommendations') return 'recommendation';
  if (token === 'drains') return 'drain';
  return token;
}

/** strongTokens(text) -> Set of deterministic topical tokens (length >= 5). */
function strongTokens(text) {
  const tokens = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 5) continue;
    const token = normalizeToken(raw);
    if (STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/** evidenceTokens(entry) -> strong tokens of the entry's summary + ref. */
function evidenceTokens(entry) {
  return strongTokens(`${entry.summary || ''} ${entry.ref || ''}`);
}

/**
 * claimTokens(claim) -> strong tokens of the claim statement with the
 * researcher's "Knowledge base source <path> documents:" scaffolding removed
 * (path segments would otherwise match every file-sourced evidence).
 */
function claimTokens(claim) {
  const statement = String(claim.statement || '').replace(
    /^Knowledge base source \S+ documents:\s*/i,
    '',
  );
  return strongTokens(statement);
}

function overlap(a, b) {
  const shared = [];
  for (const token of a) if (b.has(token)) shared.push(token);
  return shared;
}

function slugify(text, max = 28) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'case';
}

function caseIdFor(thread) {
  const hash = createHash('sha1')
    .update(`${thread.from || ''}\n${thread.subject || ''}`)
    .digest('hex')
    .slice(0, 8);
  return `case-${slugify(thread.subject)}-${hash}`;
}

/** Parse a "From: Display Name <addr>" header into a customer record. */
function customerFromThread(thread) {
  const from = String(thread.from || '');
  const emailMatch = from.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1].trim() : from.trim();
  const name = from.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  return { name, email };
}

// ---------------------------------------------------------------------------
// Claim curation (steps a-d above)
// ---------------------------------------------------------------------------

/**
 * ensureKbShape(tools): assembleTools exposes the bound kb search as a
 * callable with `.search`; the researcher agent asks for `.searchKb`. Alias it
 * here so the orchestrator works with both shapes (integration shim — the
 * mismatch between src/tools/index.js and src/agents/researcher.js is noted
 * for the integrator).
 */
function ensureKbShape(tools) {
  if (!tools || typeof tools !== 'object') return tools;
  const kb = tools.kb;
  if (kb && typeof kb.searchKb !== 'function') {
    if (typeof kb.search === 'function') kb.searchKb = kb.search;
    else if (typeof kb === 'function') kb.searchKb = kb;
  }
  return tools;
}

/** (a) Synthesize claims from confirmed hypotheses + same-ref evidence. */
function synthesizeHypothesisClaims(caseObj, synthesized) {
  let added = 0;
  for (const hypothesis of caseObj.hypotheses || []) {
    if (hypothesis.status !== 'confirmed') continue;
    if (caseObj.claims.some((c) => c.statement === hypothesis.statement)) continue;

    const claim = addClaim(caseObj, {
      statement: hypothesis.statement,
      needsVerification: true,
      evidenceIds: [...(hypothesis.evidenceIds || [])],
    });

    // Same-ref closure: evidence entries carrying the same ref (node, policy,
    // endpoint...) attest the same incident and honestly corroborate.
    const refs = new Set();
    for (const evId of hypothesis.evidenceIds || []) {
      const entry = (caseObj.evidence || []).find((e) => e.id === evId);
      if (entry && entry.ref !== undefined) refs.add(entry.ref);
    }
    for (const entry of caseObj.evidence || []) {
      if (entry.ref !== undefined && refs.has(entry.ref)) {
        linkEvidenceToClaim(caseObj, claim.id, entry.id);
      }
    }

    synthesized.push(claim);
    added += 1;
    record(caseObj, 'orchestrator', 'claim.synthesized', {
      claimId: claim.id,
      from: hypothesis.id,
      evidenceIds: [...claim.evidenceIds],
    });
  }
  return added;
}

/** (b) Synthesize claims from corroborated multi-evidence clusters. */
function synthesizeClusterClaims(caseObj, excludedClaimIds) {
  let added = 0;
  const linkedElsewhere = new Set();
  for (const claim of caseObj.claims || []) {
    for (const evId of claim.evidenceIds || []) linkedElsewhere.add(evId);
  }
  const pool = (caseObj.evidence || []).filter((entry) => !linkedElsewhere.has(entry.id));
  const tokenSets = pool.map((entry) => evidenceTokens(entry));

  // Union-find over pairwise overlaps; same-ref entries always share a cluster.
  const parent = pool.map((_, index) => index);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const sameRef = pool[i].ref !== undefined && pool[i].ref === pool[j].ref;
      if (sameRef || overlap(tokenSets[i], tokenSets[j]).length >= 2) union(i, j);
    }
  }

  const clusters = new Map();
  pool.forEach((entry, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(entry);
  });

  for (const members of clusters.values()) {
    if (members.length < 2) continue; // a singleton corroborates nothing
    const strongest = [...members].sort(
      (a, b) => classRank(b) - classRank(a) || a.id.localeCompare(b.id),
    )[0];
    const statement = String(strongest.summary || '').replace(/[.\s]+$/, '');
    if (!statement) continue;
    if (caseObj.claims.some((c) => c.statement === statement)) continue;
    const claim = addClaim(caseObj, {
      statement,
      needsVerification: true,
      evidenceIds: members.map((m) => m.id),
    });
    added += 1;
    record(caseObj, 'orchestrator', 'claim.synthesized', {
      claimId: claim.id,
      from: 'evidence-cluster',
      evidenceIds: [...claim.evidenceIds],
    });
  }
  return added;
}

function classRank(entry) {
  const order = {
    customer_statement: 0,
    inference: 1,
    prior_ticket: 2,
    documentation: 3,
    api_spec: 3,
    environment: 4,
    source_code: 5,
    e2e_test: 6,
    reproduction: 7,
  };
  return order[entry.type] ?? 0;
}

/** Cap on NEW topical links per claim — enough for class diversity, no ref spam. */
const MAX_TOPICAL_LINKS_PER_CLAIM = 4;

/** (c1) Link topically overlapping evidence to agent-proposed claims (capped). */
function corroborateClaimsTopically(caseObj, excludedClaimIds) {
  let linked = 0;
  const claims = (caseObj.claims || []).filter((c) => !excludedClaimIds.has(c.id));
  for (const claim of claims) {
    const claimSet = claimTokens(claim);
    const matched = [];
    for (const entry of caseObj.evidence || []) {
      if (claim.evidenceIds.includes(entry.id)) continue;
      const shared = overlap(claimSet, evidenceTokens(entry));
      if (shared.length >= 1) matched.push({ entry, shared });
    }
    const budget = Math.max(0, MAX_TOPICAL_LINKS_PER_CLAIM - claim.evidenceIds.length);
    const ordered = topicalCandidateOrder(caseObj, claim, matched.map((m) => m.entry));
    for (const entry of ordered.slice(0, budget)) {
      const shared = overlap(claimSet, evidenceTokens(entry));
      linkEvidenceToClaim(caseObj, claim.id, entry.id);
      linked += 1;
      record(caseObj, 'orchestrator', 'claim.corroborated', {
        claimId: claim.id,
        evidenceId: entry.id,
        shared,
      });
    }
  }
  return linked;
}

/** Order evidence for the capped topical pass: new classes first, hard first. */
function topicalCandidateOrder(caseObj, claim, entries) {
  const presentTypes = new Set(
    claim.evidenceIds.map(
      (id) => (caseObj.evidence.find((e) => e.id === id) || {}).type,
    ),
  );
  return [...entries].sort((a, b) => {
    const aNew = presentTypes.has(a.type) ? 1 : 0;
    const bNew = presentTypes.has(b.type) ? 1 : 0;
    return aNew - bNew || classRank(b) - classRank(a) || a.id.localeCompare(b.id);
  });
}

/**
 * (c2) Consult the knowledge base with the confirmed-hypothesis wording and
 * attach genuinely corroborating documentation to those synthesized claims.
 * This is the orchestrator doing its own focused doc check (independent of
 * whatever the customer's phrasing made triage ask).
 */
async function corroborateHypothesesWithKb(caseObj, tools, params, synthesized) {
  if (!Array.isArray(synthesized) || synthesized.length === 0) return 0;
  const kbSearch =
    tools && tools.kb && typeof tools.kb.searchKb === 'function'
      ? tools.kb.searchKb.bind(tools.kb)
      : null;
  if (!kbSearch) return 0;

  const existingByRef = new Map();
  for (const entry of caseObj.evidence || []) {
    if (entry.ref && !existingByRef.has(entry.ref)) existingByRef.set(entry.ref, entry);
  }

  let linked = 0;
  for (const claim of synthesized) {
    // Query with the claim's strong tokens only (plus the PDB abbreviation):
    // a scoring hit then means the doc's strongest matched token IS one of the
    // claim's terms, and the snippet is centered on it — genuine corroboration.
    const claimSet = claimTokens(claim);
    if (claimSet.size === 0) continue;
    // Abbreviation expansion: a claim about a PodDisruptionBudget must also
    // find docs that just say "PDB".
    const queryTokens = [...claimSet];
    if (claimSet.has('poddisruptionbudget')) queryTokens.push('pdb');
    const query = queryTokens.join(' ');
    let hits = [];
    try {
      hits = await kbSearch({
        repoRoot: params.repoRoot,
        query,
        limit: 5,
        ...(Array.isArray(params.kbRoots) ? { roots: params.kbRoots } : {}),
      });
    } catch {
      hits = [];
    }
    for (const hit of Array.isArray(hits) ? hits : []) {
      if (!hit || typeof hit.path !== 'string') continue;
      const shared = overlap(claimSet, strongTokens(hit.snippet || ''));
      if (shared.length < 1) continue;

      const ref = toLedgerRef(hit.path, params.repoRoot);
      let entry = existingByRef.get(ref);
      if (!entry) {
        entry = addEvidence(caseObj, {
          type: classifyKbHit(ref),
          source: 'kb',
          ref,
          summary: String(hit.snippet || '').replace(/\s+/g, ' ').trim(),
          agentId: 'orchestrator',
        });
        existingByRef.set(ref, entry);
        record(caseObj, 'orchestrator', 'evidence.added', {
          evidenceId: entry.id,
          type: entry.type,
          ref,
        });
      }
      if (!claim.evidenceIds.includes(entry.id)) {
        linkEvidenceToClaim(caseObj, claim.id, entry.id);
        linked += 1;
        record(caseObj, 'orchestrator', 'claim.corroborated', {
          claimId: claim.id,
          evidenceId: entry.id,
          shared,
        });
      }
    }
  }
  return linked;
}

/**
 * (d) Claim-set selection — the ONLY pre-gate filter, and it is relevance
 * only, never a mirror of the verifier's pass rule: a claim that has nothing
 * to do with the customer's thread (the heuristic triage questions are
 * generic; a KB hit on an unrelated note must never become a customer-facing
 * finding, however well-cited it is) is removed and trace-recorded as
 * 'claims.pruned' with reason 'off-topic'. Relevance is deterministic and
 * subject-anchored: the claim must share (a) >= 1 strong token with the
 * thread SUBJECT — the actual topic — and (b) >= 2 strong tokens with the
 * thread overall (subject + bodies). Generic body nouns ('instance',
 * 'types', 'capacity', ...) collide with unrelated notes all over the corpus
 * and cannot anchor a claim on their own; when the subject yields no strong
 * tokens, rule (b) alone applies. Grounding is judged by the VERIFIER alone
 * (§8): selected claims reach it whether or not they can pass, and its
 * REJECTED claims drive the step-5 feedback loop. Seeded claims stay (they
 * belong to the verifier's judgment).
 */
function selectCaseClaims(caseObj, excludedClaimIds, focus) {
  const pruned = [];
  caseObj.claims = (caseObj.claims || []).filter((claim) => {
    if (excludedClaimIds.has(claim.id)) return true; // seeded claims stay
    if (claim.status === 'rejected') {
      // Already judged by the verifier in a previous loop; keep history.
      return true;
    }
    if (claim.status === 'verified') return true; // hard-proven already
    if (focus && focus.all) {
      const tokens = claimTokens(claim);
      const shared = overlap(tokens, focus.all);
      if (shared.length < 2) {
        pruned.push({ id: claim.id, statement: claim.statement, reason: 'off-topic', shared });
        return false;
      }
      if (focus.subject.size > 0 && overlap(tokens, focus.subject).length < 1) {
        pruned.push({
          id: claim.id,
          statement: claim.statement,
          reason: 'off-topic',
          shared,
        });
        return false;
      }
    }
    return true;
  });
  if (pruned.length > 0) {
    record(caseObj, 'orchestrator', 'claims.pruned', { claims: pruned });
  }
  return pruned.length;
}

/**
 * (e) Prune evidence that no surviving claim or hypothesis references. Keeps
 * downstream consumers (architect corpus, escalation evidence index, kb note
 * signals) free of sources the case could not use anyway. Trace-recorded.
 */
function pruneOrphanEvidence(caseObj) {
  const used = new Set();
  for (const claim of caseObj.claims || []) {
    for (const evId of claim.evidenceIds || []) used.add(evId);
  }
  for (const hypothesis of caseObj.hypotheses || []) {
    for (const evId of hypothesis.evidenceIds || []) used.add(evId);
  }
  const before = (caseObj.evidence || []).length;
  caseObj.evidence = (caseObj.evidence || []).filter((entry) => used.has(entry.id));
  const removed = before - caseObj.evidence.length;
  if (removed > 0) {
    record(caseObj, 'orchestrator', 'evidence.pruned', { removed, kept: caseObj.evidence.length });
  }
  return removed;
}

/** Thread focus tokens: the customer's own words (subject + message bodies). */
function threadFocusTokens(thread) {
  // The SUBJECT carries the actual topic anchors; the bodies add texture.
  // Relevance must hit at least one subject anchor, not only generic body
  // nouns ('instance', 'types', 'capacity', ...) — those collide with
  // unrelated notes all over the corpus.
  const subject = strongTokens(thread && thread.subject ? thread.subject : '');
  const parts = [thread && thread.subject ? thread.subject : ''];
  for (const message of (thread && thread.messages) || []) {
    if (message && message.body) parts.push(message.body);
  }
  return { subject, all: strongTokens(parts.join('\n')) };
}

/** Run the full curation pass (idempotent across verify loops). */
async function curateClaims(caseObj, tools, params, excludedClaimIds) {
  const synthesized = [];
  record(caseObj, 'orchestrator', 'claims.curation.start', {
    claims: (caseObj.claims || []).length,
    evidence: (caseObj.evidence || []).length,
  });
  synthesizeHypothesisClaims(caseObj, synthesized);
  synthesizeClusterClaims(caseObj, excludedClaimIds);
  corroborateClaimsTopically(caseObj, excludedClaimIds);
  await corroborateHypothesesWithKb(caseObj, tools, params, synthesized);
  selectCaseClaims(caseObj, excludedClaimIds, params.focusTokens);
  pruneOrphanEvidence(caseObj);
  record(caseObj, 'orchestrator', 'claims.curation.done', {
    claims: (caseObj.claims || []).length,
    evidence: (caseObj.evidence || []).length,
  });
}

// ---------------------------------------------------------------------------
// runCase
// ---------------------------------------------------------------------------

export async function runCase(threadInput, deps = {}) {
  const {
    repoRoot = process.cwd(),
    llm = new HeuristicLlm(),
    outboxDir = DEFAULT_OUTBOX,
    kbRoots,
    maxVerifyLoops = 2,
    strictTwoSource = false,
    simSpec,
    seedClaims,
    kbRoot,
    env,
  } = deps;

  const tools = ensureKbShape(deps.tools ?? assembleTools({ repoRoot, env: env ?? process.env }));

  const thread = {
    from: String(threadInput?.from || ''),
    subject: String(threadInput?.subject || ''),
    messages: Array.isArray(threadInput?.messages) ? threadInput.messages : [],
  };

  // -- 1. createCase; record 'case.received' --------------------------------
  const caseObj = createCase({
    id: caseIdFor(thread),
    thread,
    customer: customerFromThread(thread),
  });
  record(caseObj, 'orchestrator', 'case.received', {
    subject: thread.subject,
    from: thread.from,
  });

  const agentsRun = [];

  // Shared ctx.params — agents read simSpec / kbRoots / verifierFeedback /
  // mode from here (contract section 7 + 8). focusTokens is orchestrator-internal.
  const params = {
    repoRoot,
    simSpec,
    strictTwoSource,
    kbRoots,
    focusTokens: threadFocusTokens(thread),
    ...(kbRoot ? { kbRoot } : {}),
  };
  const ctx = { caseObj, repoRoot, params };

  const runAgent = async (agentId, extraParams = {}) => {
    const factory = ALL_AGENTS[agentId];
    if (typeof factory !== 'function') {
      throw new Error(`orchestrator: unknown agent in plan: ${agentId}`);
    }
    const agent = factory({ llm, tools });
    Object.assign(params, extraParams);
    const result = await agent.run(ctx);
    agentsRun.push(agentId);
    return result;
  };

  // -- 2. triage.run (+ seedClaims for the adversarial eval) -----------------
  await runAgent('triage');

  const seededClaimIds = new Set();
  for (const statement of Array.isArray(seedClaims) ? seedClaims : []) {
    if (typeof statement !== 'string' || statement.trim() === '') continue;
    const claim = addClaim(caseObj, {
      statement: statement.trim(),
      needsVerification: true,
    });
    seededClaimIds.add(claim.id);
    record(caseObj, 'orchestrator', 'claim.seeded', {
      claimId: claim.id,
      statement: claim.statement,
    });
  }

  // -- 3. supervisor.run -> plan ---------------------------------------------
  await runAgent('supervisor');
  const planned = Array.isArray(caseObj.plan && caseObj.plan.agents)
    ? [...caseObj.plan.agents]
    : [];
  record(caseObj, 'orchestrator', 'plan.accepted', { agents: planned });

  // -- 4. run the plan (writer/escalation/knowledge deferred) ----------------
  const DEFERRED = new Set(['writer', 'escalation', 'knowledge']);
  let loopsLeft = Number.isInteger(maxVerifyLoops) ? Math.max(0, maxVerifyLoops) : 2;

  const iterate = async (agentIds) => {
    for (const agentId of agentIds) {
      if (DEFERRED.has(agentId)) continue;
      if (agentId === 'verifier') continue; // handled by the verify gate below
      // The architect composes its solution from the evidence corpus — run a
      // curation pass first so off-topic KB noise never reaches the plan.
      if (agentId === 'architect') {
        await curateClaims(caseObj, tools, params, seededClaimIds);
      }
      await runAgent(agentId);
    }
  };

  await iterate(planned);

  // -- 5. verifier gate with feedback loops ----------------------------------
  let verifyLoops = 0;
  for (;;) {
    await curateClaims(caseObj, tools, params, seededClaimIds);
    await runAgent('verifier');
    const verdict = caseObj.verdict || { status: 'REJECT', rejectedClaims: [] };
    if (verdict.status !== 'REJECT' || loopsLeft <= 0) break;

    loopsLeft -= 1;
    verifyLoops += 1;
    const feedback = {
      loop: verifyLoops,
      rejectedClaims: verdict.rejectedClaims.map((r) => ({
        id: r.id,
        statement: r.statement,
        missing: r.missing,
      })),
    };
    record(caseObj, 'orchestrator', 'verify.feedback', feedback);
    params.verifierFeedback = feedback;
    // Re-run the evidence gatherers with the feedback, then gate again.
    await iterate(planned.filter((id) => id === 'researcher' || id === 'sre'));
  }
  delete params.verifierFeedback;

  // -- 6. confidence gate -> writer mode / escalation -------------------------
  const confidence = computeConfidence(caseObj);
  caseObj.confidence = confidence;
  const gate = confidenceGate(confidence);
  const verdictStatus = caseObj.verdict ? caseObj.verdict.status : 'REJECT';
  const category = caseObj.triage && caseObj.triage.category ? caseObj.triage.category : 'unknown';

  record(caseObj, 'orchestrator', 'confidence.computed', { confidence, gate });

  // Verdict-aware mode (contract §8 step 6): a REJECT-exhausted case never
  // gets a technical answer — clarify (or escalate for product bugs), no
  // confidence score can buy it out. A PASS verdict always answers with its
  // citations, even when the evidence-point ceiling says NEEDS_MORE_EVIDENCE:
  // documentation-class answers the verifier passed must not be withheld
  // behind a ladder designed for test-backed categories.
  const gated = verdictStatus === 'REJECT';
  const escalate = gated && category === 'product_bug';

  if (escalate) {
    record(caseObj, 'orchestrator', 'case.escalating', { category, gate, verdict: verdictStatus });
    await runAgent('escalation');
  } else {
    await runAgent('writer', { mode: gated ? 'clarify' : 'normal' });
  }

  // -- 7. knowledge.run when verdict PASS -------------------------------------
  if (verdictStatus === 'PASS') {
    await runAgent('knowledge');
  }

  // -- 8. persist artifacts (draft-only email + trace) ------------------------
  const email = tools && tools.email && typeof tools.email.draftEmail === 'function'
    ? tools.email.draftEmail
    : null;
  if (!email) throw new Error('orchestrator: tools.email.draftEmail is required');

  const summary = {
    verdict: verdictStatus,
    confidence,
    gate,
    agentsRun,
  };

  const to = caseObj.customer && caseObj.customer.email ? caseObj.customer.email : thread.from;
  const subject = `Re: ${thread.subject}`;

  if (escalate) {
    const { mdPath } = await email({
      outboxDir,
      caseId: caseObj.id,
      to,
      subject,
      body: caseObj.escalation || '',
      meta: { kind: 'escalation', verdict: verdictStatus, confidence, gate, category },
    });
    summary.escalationPath = mdPath;
    record(caseObj, 'orchestrator', 'artifacts.persisted', { escalationPath: mdPath });
  } else {
    const body = caseObj.reply && typeof caseObj.reply.body === 'string' ? caseObj.reply.body : '';
    const citedClaims = (caseObj.claims || []).filter(
      (claim) =>
        claim.status !== 'rejected' &&
        Array.isArray(claim.evidenceIds) &&
        claim.evidenceIds.length > 0,
    );
    const { mdPath } = await email({
      outboxDir,
      caseId: caseObj.id,
      to,
      subject,
      body,
      meta: {
        kind: 'reply-draft',
        mode: gated ? 'clarify' : 'normal',
        verdict: verdictStatus,
        confidence,
        gate,
        category,
        guardOk: Boolean(caseObj.reply && caseObj.reply.guard && caseObj.reply.guard.ok),
        ...(caseObj.reply && caseObj.reply.forcedClarify ? { forcedClarify: true } : {}),
        // Full provenance for the human reviewer — the body itself cites
        // documents repo-relative and never carries internal absolute paths.
        references: internalRefs(caseObj, citedClaims),
      },
    });
    summary.replyPath = mdPath;
    record(caseObj, 'orchestrator', 'artifacts.persisted', { replyPath: mdPath });
  }

  record(caseObj, 'orchestrator', 'case.completed', {
    verdict: verdictStatus,
    confidence,
    gate,
    agentsRun: [...agentsRun],
  });

  // Trace goes LAST so the persisted audit captures the full run. Its path is
  // deterministic (<outboxDir>/traces/<caseId>.trace.jsonl) — callers derive
  // it from the outbox dir, keeping the summary shape exactly per contract.
  await persistTrace(caseObj, path.join(outboxDir, 'traces'));

  // -- 9. return ---------------------------------------------------------------
  return { caseObj, summary };
}
