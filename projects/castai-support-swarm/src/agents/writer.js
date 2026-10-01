// src/agents/writer.js — section 7 of CONTRACTS.md.
// Builds `draft` from: customerName, verified (evidence-backed) claims,
// solution.steps, relevant refs. Style: direct greeting `Hi <Name>,`, short
// sentences, contractions, states what was checked/found (only grounded
// first-person claims — every "I checked / I reproduced / we verified" line is
// emitted only when the evidence ledger carries the classes the reply guard
// requires), one next step, sign-off `— CAST AI Support`.
//
// Honesty (binding): first-person leads say what actually happened. A
// TEST_CONFIRMED class backed by a real test runner reads "I ran the tests";
// TEST_CONFIRMED derived from the reproduction lab reads "the fix held in our
// reproduction lab". Internal absolute paths never reach the customer: the
// body cites documents repo-relative and the full refs land in meta.references.
//
// Modes:
//   normal  — full grounded answer.
//   clarify (ctx.params.mode === 'clarify') — asks for the specific
//   triage.missingInfo / org id / cluster id, makes NO technical claims, and
//   always assembles deterministic text so the draft trivially passes the guard.
//
// Then: guard = evaluateReply({ caseObj, draft }); if !guard.ok or banned
// found -> draft = sanitizeReply(...) and re-evaluate (max 2 passes). If the
// guard STILL fails, the draft is discarded and the clarify template replaces
// it (forcedClarify) — a draft that fails the guard never leaves the writer.
// Sets caseObj.reply = { body, guard, forcedClarify? }. Returns { reply }.
//
// The writer never persists or sends mail — the orchestrator writes the draft
// to the outbox (draft-only posture).

import { HeuristicLlm } from '../core/llm.js';
import { CLAIM_CLASSES, EVIDENCE_TYPES } from '../core/model.js';
import { caseClaimClasses, evaluateReply, sanitizeReply } from '../core/guard.js';
import { record } from '../core/trace.js';

const SIGNOFF = '— CAST AI Support';
const MAX_FINDINGS = 8; // documentation-class answers need room for every cited fact
const MAX_REFS_PER_FINDING = 3;

function firstName(value) {
  const token = String(value || '')
    .split(/\s+/)
    .find((part) => /^[A-Za-z]/.test(part.replace(/[^A-Za-z'’-]/g, '')));
  if (!token) return 'there';
  return token.replace(/[^A-Za-z'’]/g, '').replace(/^./, (c) => c.toUpperCase());
}

function customerFirstName(caseObj) {
  const fromTriage = caseObj.triage && caseObj.triage.customerName;
  const fromCustomer = caseObj.customer && caseObj.customer.name;
  const fromThread = caseObj.thread && caseObj.thread.from;
  return firstName(fromTriage || fromCustomer || fromThread);
}

/** Claims the writer may speak about: verified, or evidence-backed and not rejected. */
function usableFindings(caseObj) {
  const claims = (caseObj.claims || []).filter(
    (claim) =>
      claim.status !== 'rejected' &&
      Array.isArray(claim.evidenceIds) &&
      claim.evidenceIds.length > 0,
  );
  const strength = (claim) => {
    let best = -1;
    for (const evId of claim.evidenceIds) {
      const ev = (caseObj.evidence || []).find((e) => e.id === evId);
      const meta = ev && EVIDENCE_TYPES[ev.type];
      if (!meta) continue;
      const rank = CLAIM_CLASSES.indexOf(meta.cls);
      if (rank > best) best = rank;
    }
    return best;
  };
  // Strongest evidence first, stable — a verified root cause outranks a loose
  // doc hit, whatever order the agents proposed them in.
  return claims
    .map((claim, index) => ({ claim, index, strength: strength(claim) }))
    .sort((a, b) => b.strength - a.strength || a.index - b.index)
    .map((entry) => entry.claim);
}

/**
 * Refs citable in a customer-facing body: PUBLIC CAST AI links only
 * (docs.cast.ai / api.cast.ai / cast.ai). Internal KB notes (.kimchi/docs,
 * brain/notes), machine paths, lab node names and source-code file:line refs
 * stay internal — their filenames can carry project/person names and must
 * never reach a customer email (meta.references keeps them for the human
 * reviewer; AGENTS.md forbids forwarding raw internal material).
 */
function citableRefs(caseObj, claim) {
  const refs = [];
  for (const evId of claim.evidenceIds) {
    const ev = (caseObj.evidence || []).find((e) => e.id === evId);
    if (!ev || typeof ev.ref !== 'string') continue;
    if (!/^https:\/\/([a-z0-9-]+\.)*cast\.ai(\/|$)/i.test(ev.ref)) continue; // public CAST AI links only
    if (!refs.includes(ev.ref)) refs.push(ev.ref);
  }
  return refs.slice(0, MAX_REFS_PER_FINDING);
}

/** Word set for near-duplicate detection (>=4-letter alphanumeric words). */
function wordSet(text) {
  return new Set(String(text).toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const word of a) if (b.has(word)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Full internal ref set for meta.references (human reviewer only). */
export function internalRefs(caseObj, claims) {
  const refs = [];
  for (const claim of claims) {
    for (const evId of claim.evidenceIds || []) {
      const ev = (caseObj.evidence || []).find((e) => e.id === evId);
      if (ev && ev.ref && !refs.includes(ev.ref)) refs.push(ev.ref);
    }
  }
  return refs;
}

/** The researcher's provenance scaffold is ledger cargo, not customer prose. */
function displayStatement(statement) {
  return String(statement || '')
    .replace(/^Knowledge base source \S+ documents:\s*/i, '')
    .replace(/[.\s]+$/, '');
}

/**
 * What actually backs the case's TEST_CONFIRMED class: a supplied test runner
 * ('runner') or the reproduction lab ('lab'). A reply must never claim a real
 * test run for a lab-derived result (contract §7, honesty rule).
 */
function testBacking(caseObj) {
  const claims = (caseObj.claims || []).filter((c) => c.status !== 'rejected');
  const seen = new Set();
  for (const claim of claims) {
    for (const evId of claim.evidenceIds || []) seen.add(evId);
  }
  let lab = false;
  for (const ev of caseObj.evidence || []) {
    if (ev.type !== 'e2e_test' || !seen.has(ev.id)) continue;
    if (ev.source === 'test-runner') return 'runner';
    lab = true;
  }
  return lab ? 'lab' : 'none';
}

/**
 * Grounded first-person leads. Each line is emitted ONLY when the ledger
 * carries a class the guard requires for that exact phrasing:
 *   "I checked ..."        needs ENV_CONFIRMED | DOCUMENTED | CODE_CONFIRMED
 *   "I reproduced this"    needs REPRODUCED
 *   "I ran the tests"      needs TEST_CONFIRMED, backed by a real test runner
 *   "the fix held in ..."  needs TEST_CONFIRMED (lab-derived — no first-person verb)
 *   "We've verified"       needs VERIFIED | TEST_CONFIRMED | REPRODUCED
 */
function groundedLeads(caseObj, present) {
  const leads = [];
  const backing = testBacking(caseObj);
  if (present.some((c) => c === 'ENV_CONFIRMED' || c === 'DOCUMENTED' || c === 'CODE_CONFIRMED')) {
    leads.push("I checked your setup and here's what we found.");
  }
  if (present.includes('REPRODUCED')) {
    leads.push('I reproduced this in our lab, so the behavior below is a fact, not a guess.');
  }
  if (present.includes('TEST_CONFIRMED')) {
    if (backing === 'runner') {
      leads.push('I ran the tests for the proposed change and they pass.');
    } else {
      leads.push('The proposed fix held up when we re-ran the lab simulation on it.');
    }
  }
  if (present.includes('TEST_CONFIRMED') || present.includes('REPRODUCED') || present.includes('VERIFIED')) {
    leads.push(
      backing === 'runner'
        ? "We've verified the behavior end to end."
        : "We verified the behavior end to end inside the reproduction lab.",
    );
  }
  return leads;
}

/**
 * customerTopic — the subject line cleaned for a natural topic sentence, so
 * the reply visibly engages what the customer actually asked instead of
 * opening with a generic lead. Returns '' when there is no usable subject.
 */
export function customerTopic(caseObj) {
  let subject = (caseObj.thread && caseObj.thread.subject ? caseObj.thread.subject : '').trim();
  if (!subject) return '';
  subject = subject.replace(/^(re|fw|fwd):\s*/i, '').replace(/[?.\s]+$/, '').trim();
  if (subject.length < 4) return '';
  if (subject.length > 90) {
    const cut = subject.slice(0, 90);
    subject = cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trim();
  }
  return subject;
}

/** Deterministic offline assembly (contract: offline it assembles text). */
function assembleNormalDraft(caseObj) {
  const name = customerFirstName(caseObj);
  const present = caseClaimClasses(caseObj);
  const lines = [`Hi ${name},`, ''];

  const topic = customerTopic(caseObj);
  let leads = groundedLeads(caseObj, present);
  if (topic) {
    // The topic sentence replaces the generic 'here's what we found' lead.
    leads = leads.filter((lead) => !/here's what we found/i.test(lead));
    lines.push(`You asked about ${topic} — here's what we found.`);
  }
  if (leads.length > 0) lines.push(leads.join(' '));
  if (topic || leads.length > 0) lines.push('');

  const findings = usableFindings(caseObj);
  if (findings.length > 0) {
    lines.push(findings.length === 1 ? 'The finding:' : 'The findings:');
    const emittedWords = []; // near-duplicate suppression (Jaccard on word sets)
    let emitted = 0;
    for (const claim of findings) {
      if (emitted >= MAX_FINDINGS) break;
      const statement = displayStatement(claim.statement);
      if (statement.length < 3) continue;
      const words = wordSet(statement);
      // KB claims paraphrase the same facts heavily; emit each fact once, at
      // its strongest evidence rank (usableFindings is strength-sorted).
      if (emittedWords.some((seen) => jaccard(seen, words) >= 0.35)) continue;
      emittedWords.push(words);
      const refs = citableRefs(caseObj, claim);
      const suffix = refs.length > 0 ? ` (source: ${refs.join(', ')})` : '';
      lines.push(`- ${statement}${suffix}.`);
      emitted += 1;
    }
    lines.push('');
  }

  const steps = caseObj.solution && Array.isArray(caseObj.solution.steps)
    ? caseObj.solution.steps
    : [];
  if (steps.length > 0) {
    lines.push("Here's what we'd change:");
    steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${String(step).replace(/[.\s]+$/, '')}.`);
    });
    lines.push('');
  }

  lines.push(
    "If you can roll the top change out to one workload first, reply with what you see and we'll watch it together.",
    '',
    SIGNOFF,
  );
  return lines.join('\n');
}

/**
 * Clarify mode: asks for the specific missing info (org id / cluster id /
 * anything else triage flagged), makes NO technical claims, no grounded
 * first-person claims — the draft trivially passes the guard.
 */
function assembleClarifyDraft(caseObj) {
  const name = customerFirstName(caseObj);
  const missing = (caseObj.triage && Array.isArray(caseObj.triage.missingInfo)
    ? caseObj.triage.missingInfo
    : []
  ).filter((item) => typeof item === 'string');

  const asks = [];
  if (missing.includes('orgId')) asks.push('your CAST AI organization id');
  if (missing.includes('clusterId')) asks.push('the cluster id of the affected cluster');
  for (const item of missing) {
    if (item !== 'orgId' && item !== 'clusterId') asks.push(item);
  }
  if (asks.length === 0) {
    asks.push('your CAST AI organization id', 'the cluster id of the affected cluster');
  }

  const askText = asks.length === 1
    ? asks[0]
    : `${asks.slice(0, -1).join(', ')} and ${asks[asks.length - 1]}`;

  return [
    `Hi ${name},`,
    '',
    "Thanks for flagging this — we want to dig in, and we can't give you a grounded answer yet because a few details are missing.",
    '',
    `Could you share ${askText}? Once we have them, we'll pull the read-only data, try to reproduce the behavior, and come back with specifics.`,
    '',
    SIGNOFF,
  ].join('\n');
}

/**
 * Prompt for live mode (non-heuristic llm writes the draft). The prompt leaves
 * the machine, so it carries NO internal refs at all — no paths, no internal
 * document titles (they can embed project or person names) — only public
 * docs.cast.ai links, if any were recorded.
 */
function buildLivePrompt(caseObj, name) {
  const findings = usableFindings(caseObj).map((claim) => {
    const links = citableRefs(caseObj, claim);
    return `- finding: ${displayStatement(claim.statement)}${links.length ? ` (docs: ${links.join(', ')})` : ''}`;
  });
  const steps = ((caseObj.solution && caseObj.solution.steps) || []).map(
    (step, index) => `- step ${index + 1}: ${step}`,
  );
  return [
    'writer task: draft a short human support email reply.',
    `From: ${name}`,
    'Rules: start with a direct greeting "Hi <Name>,", short sentences, use contractions,',
    'only state what was checked/found when it is grounded in the findings below, one clear',
    'next step at the end, sign off exactly with "— CAST AI Support".',
    'Never claim a real test run when the finding comes from the reproduction lab;',
    'say the fix held in the lab instead.',
    ...findings,
    ...steps,
  ].join('\n');
}

const MAX_GUARD_PASSES = 2;

/**
 * createWriter({ llm, tools }) -> agent { id, name, async run(ctx) }.
 * Uses no tools directly — persistence happens in the orchestrator via the
 * draft-only email tool.
 */
export function createWriter({ llm, tools } = {}) {
  return {
    id: 'writer',
    name: 'Writer',

    async run(ctx) {
      const caseObj = ctx.caseObj;
      const params = ctx.params || {};
      const mode = params.mode === 'clarify' ? 'clarify' : 'normal';
      record(caseObj, 'writer', 'writer.start', { mode });

      let draft;
      if (mode === 'clarify') {
        draft = assembleClarifyDraft(caseObj);
      } else if (llm && typeof llm.complete === 'function' && !(llm instanceof HeuristicLlm)) {
        // Live mode: the llm writes it (HeuristicLlm = offline = assemble here).
        const name = customerFirstName(caseObj);
        draft = await llm.complete({
          system:
            'You write plain, human-sounding CAST AI support email drafts. ' +
            'Never use AI-ish filler phrases. writer style: direct greeting, short ' +
            'sentences, contractions, grounded claims only, one next step, ' +
            'sign-off "— CAST AI Support".',
          prompt: buildLivePrompt(caseObj, name),
        });
      } else {
        draft = assembleNormalDraft(caseObj);
      }
      record(caseObj, 'writer', 'writer.draft.built', { mode, chars: String(draft).length });

      // params.maxGuardPasses is a deterministic seam (the orchestrator never
      // sets it): tests use 0 to exercise the forced-clarify fallback below.
      const maxPasses =
        Number.isInteger(params.maxGuardPasses) && params.maxGuardPasses >= 0
          ? params.maxGuardPasses
          : MAX_GUARD_PASSES;

      let guard = evaluateReply({ caseObj, draft });
      let passes = 1;
      while ((!guard.ok || guard.banned.length > 0) && passes < maxPasses) {
        record(caseObj, 'writer', 'writer.guard.retry', {
          pass: passes,
          violations: guard.violations.length,
          banned: guard.banned.length,
        });
        draft = sanitizeReply({ caseObj, draft, violations: guard.violations });
        guard = evaluateReply({ caseObj, draft });
        passes += 1;
      }

      // Hard fallback (contract §7): a draft that still fails the guard must
      // never reach the outbox — replace it with the clarify template.
      let forcedClarify = false;
      if (!guard.ok || guard.banned.length > 0) {
        forcedClarify = true;
        record(caseObj, 'writer', 'writer.guard.exhausted', {
          passes,
          violations: guard.violations.length,
          banned: guard.banned.length,
        });
        draft = assembleClarifyDraft(caseObj);
        guard = evaluateReply({ caseObj, draft });
      }

      caseObj.reply = { body: draft, guard, ...(forcedClarify ? { forcedClarify: true } : {}) };
      record(caseObj, 'writer', 'writer.reply.set', {
        mode,
        ok: guard.ok,
        passes,
        toneScore: guard.tone.score,
        ...(forcedClarify ? { forcedClarify: true } : {}),
      });
      return { reply: caseObj.reply };
    },
  };
}
