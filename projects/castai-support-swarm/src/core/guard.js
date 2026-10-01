// src/core/guard.js — section 4 of CONTRACTS.md
// Reply guard: grounds every first-person action claim in the case's evidence
// ledger, strips banned AI-ish phrases, and scores tone deterministically.

import { CLAIM_CLASSES, EVIDENCE_TYPES } from './model.js';

export const BANNED_PHRASES = [
  'thank you for reaching out',
  'based on the information provided',
  'rest assured',
  'please do not hesitate',
  'as an ai',
  'i apologize for any inconvenience',
  'seamless',
  'delve',
  'furthermore',
  'in conclusion',
  'i hope this email finds you well',
];

export const CLAIM_REQUIREMENTS = [
  // A first-person claim in the draft requires evidence classes in the case ledger.
  // claims here = union of classes across all linked evidence of non-rejected claims.
  // Tenses with 've/have, hedge adverbs and confirm/observe/find synonyms are
  // covered so a live LLM cannot slip the guard by rephrasing (contract §4).
  { pattern: /\bI(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:checked|looked\s+into|inspected|reviewed\s+your)\b/i, needs: ['ENV_CONFIRMED', 'DOCUMENTED', 'CODE_CONFIRMED'] },
  { pattern: /\bI(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:reproduced|recreated)\s+(?:this|the|it)\b/i, needs: ['REPRODUCED'] },
  { pattern: /\b(?:we|I)(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:confirmed|verified)\b/i, needs: ['VERIFIED', 'TEST_CONFIRMED', 'REPRODUCED'] },
  { pattern: /\bI(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:ran|executed)\s+(?:the\s+)?(?:test|tests)\b/i, needs: ['TEST_CONFIRMED'] },
  { pattern: /\b(?:we|I)\s+can\s+confirm\b/i, needs: ['VERIFIED', 'TEST_CONFIRMED', 'REPRODUCED'] },
  { pattern: /\b(?:we|I)\s+(?:observed|found)\s+(?:the|your|this|it)\b/i, needs: ['ENV_CONFIRMED', 'DOCUMENTED', 'CODE_CONFIRMED'] },
];

/** caseClaimClasses(caseObj) -> union ladder classes of non-rejected claims' linked evidence. */
export function caseClaimClasses(caseObj) {
  const classes = new Set();
  for (const claim of caseObj.claims || []) {
    if (claim.status === 'rejected') continue;
    for (const evId of claim.evidenceIds || []) {
      const ev = (caseObj.evidence || []).find((e) => e.id === evId);
      if (!ev) continue;
      const meta = EVIDENCE_TYPES[ev.type];
      if (meta) classes.add(meta.cls);
    }
  }
  return [...classes].sort((a, b) => CLAIM_CLASSES.indexOf(a) - CLAIM_CLASSES.indexOf(b));
}

/** Split a draft into sentences, keeping terminators; newlines are boundaries. */
function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|(?:\r?\n)+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Banned-phrase matching is word-bounded: 'delved' and 'as an aid' are NOT hits. */
function bannedPhrasePattern(phrase, flags = 'gi') {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, flags);
}

/** All indices of a phrase (word-bounded, case-insensitive), ascending. */
function bannedIndices(text, phrase) {
  const indices = [];
  const rx = bannedPhrasePattern(phrase);
  let match = rx.exec(text);
  while (match !== null) {
    indices.push(match.index);
    match = rx.exec(text);
  }
  return indices;
}

/** Deterministic tone scoring per the contract bullets (max 100). */
function scoreTone(draft, violations, banned) {
  const text = String(draft);
  const issues = [];

  const trimmed = text.trimStart();
  // 'Hi there,' is the writer's no-name fallback greeting — it is a greeting.
  const hasGreeting = /^Hi (?:[A-Z][A-Za-z'’-]*|there),/.test(trimmed);
  if (!hasGreeting) issues.push('missing greeting (expected "Hi <Name>,")');

  const bannedClean = banned.length === 0;
  if (!bannedClean) issues.push('banned AI-ish phrases present');

  const claimsClean = violations.length === 0;
  if (!claimsClean) issues.push('ungrounded first-person claims');

  const sentenceChunks = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  const wordsPerSentence = sentenceChunks.length === 0
    ? 0
    : Math.round((words.length / sentenceChunks.length) * 100) / 100;
  const conversational = wordsPerSentence <= 24;
  if (!conversational) issues.push('sentences too long (avg > 24 words)');

  const hasContraction = /n't|'re|'ll|'ve/i.test(text);
  if (!hasContraction) issues.push('no contractions (sounds stiff)');

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
  const hasNextStep = lastLine.includes('you') || lastLine.includes('?') || lastLine.includes('If ');
  if (!hasNextStep) issues.push('does not end with a clear next step');

  const score =
    (hasGreeting ? 20 : 0) +
    (bannedClean ? 20 : 0) +
    (claimsClean ? 20 : 0) +
    (conversational ? 15 : 0) +
    (hasContraction ? 15 : 0) +
    (hasNextStep ? 10 : 0);

  return { score, issues, wordsPerSentence, hasGreeting, hasNextStep };
}

/**
 * evaluateReply({ caseObj, draft }) -> {
 *   ok, violations: [{ sentence, needs, present }],
 *   banned: [{ phrase, index, indices }],
 *   tone: { score, issues, wordsPerSentence, hasGreeting, hasNextStep },
 * }
 */
export function evaluateReply({ caseObj, draft }) {
  const text = String(draft ?? '');
  const present = caseClaimClasses(caseObj);

  const violations = [];
  for (const sentence of splitSentences(text)) {
    for (const requirement of CLAIM_REQUIREMENTS) {
      if (requirement.pattern.test(sentence)) {
        const satisfied = requirement.needs.some((cls) => present.includes(cls));
        if (!satisfied) {
          violations.push({ sentence, needs: [...requirement.needs], present: [...present] });
        }
      }
    }
  }

  const banned = [];
  for (const phrase of BANNED_PHRASES) {
    const indices = bannedIndices(text, phrase);
    if (indices.length > 0) banned.push({ phrase, index: indices[0], indices });
  }

  const tone = scoreTone(text, violations, banned);
  const ok = violations.length === 0 && banned.length === 0;
  return { ok, violations, banned, tone };
}

// -- sanitizeReply ------------------------------------------------------------

// Strongest-first: attribute the finding to the best evidence class honestly
// available in the ledger. None of these match CLAIM_REQUIREMENTS or
// BANNED_PHRASES, so the rewrite re-passes the guard.
const HEDGE_BY_CLASS = [
  ['REPRODUCED', 'From our reproduction testing'],
  ['TEST_CONFIRMED', 'From our test results'],
  ['CODE_CONFIRMED', 'Based on the CAST AI source code'],
  ['ENV_CONFIRMED', 'Based on the environment data collected'],
  ['DOCUMENTED', 'Based on the CAST AI documentation'],
  ['SUPPORTING', 'Based on similar past support cases'],
];
const HEDGE_FALLBACK = 'Based on our current understanding';

function hedgePrefix(present) {
  for (const [cls, prefix] of HEDGE_BY_CLASS) {
    if (present.includes(cls)) return prefix;
  }
  return HEDGE_FALLBACK;
}

// First-person claim spans, aligned with CLAIM_REQUIREMENTS but NOT anchored:
// a claim in the middle of a sentence must be removed exactly like one at ^.
const CLAIM_SPAN_PATTERNS = [
  /\bI(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:checked|looked\s+into|inspected|reviewed)(?:\s+your\s+[A-Za-z'’-]+)?/gi,
  /\bI(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:reproduced|recreated)(?:\s+(?:this|the|it))?/gi,
  /\b(?:we|I)(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:confirmed|verified)(?:\s+that)?/gi,
  /\bI(?:'ve|\s+have)?\s+(?:just\s+|already\s+)?(?:ran|executed)\s+(?:the\s+)?tests?/gi,
  /\b(?:we|I)\s+can\s+confirm\s*(?:that)?/gi,
  /\b(?:we|I)\s+(?:observed|found)(?:\s+that)?/gi,
];

// A leading vocative ("hi Sam,") is not factual content; drop it before the
// claim surgery or it would be glued to the hedge prefix.
const VOCATIVE_PREFIX = /^(?:hi|hello|dear)\s+[A-Za-z'’-]+,\s*/i;

/**
 * Remove the first-person claim span WHEREVER it appears in the sentence and
 * keep the factual remainder; connectors orphaned by the cut are cleaned up.
 */
function stripFirstPersonClaim(sentence) {
  let core = sentence.replace(/[.!?]+\s*$/, '');
  core = core.replace(VOCATIVE_PREFIX, '');
  for (const pattern of CLAIM_SPAN_PATTERNS) {
    core = core.replace(pattern, '');
  }
  core = core
    .replace(/\s+(?:and|but|so|then)\s*$/i, '') // dangling trailing connector
    .replace(/^(?:and|but|so|also|then|because)\s+/i, '') // dangling leading connector
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/^[,;:\s]+/, '')
    .trim();
  if (core.length > 0 && /^[A-Z]/.test(core)) {
    core = core[0].toLowerCase() + core.slice(1);
  }
  return core;
}

function rewriteViolation(sentence, present) {
  const prefix = hedgePrefix(present);
  const core = stripFirstPersonClaim(sentence);
  if (core.length < 3) {
    return `${prefix}, we are still gathering direct evidence for this.`;
  }
  return `${prefix}, ${core}.`;
}

/**
 * sanitizeReply({ caseObj, draft, violations }) -> string
 * Rewrites each violating sentence to hedged wording grounded in the classes
 * the ledger actually has, then strips banned phrases (word-bounded). The
 * result re-passes evaluateReply by construction.
 */
export function sanitizeReply({ caseObj, draft, violations }) {
  const present = caseClaimClasses(caseObj);
  let out = String(draft ?? '');

  const list = Array.isArray(violations) ? violations : evaluateReply({ caseObj, draft }).violations;
  const seen = new Set();
  for (const violation of list) {
    if (!violation || typeof violation.sentence !== 'string') continue;
    if (seen.has(violation.sentence)) continue;
    seen.add(violation.sentence);
    const classes = Array.isArray(violation.present) && violation.present.length > 0
      ? violation.present
      : present;
    out = out.split(violation.sentence).join(rewriteViolation(violation.sentence, classes));
  }

  for (const phrase of BANNED_PHRASES) {
    out = out.replace(bannedPhrasePattern(phrase), '');
  }

  // Tidy up the holes left behind by stripped phrases.
  out = out
    .replace(/[ \t]+([,.!?;:])/g, '$1') // no horizontal space before punctuation
    .replace(/(^|[.!?]\s*|\n+)[,.!?;:]+\s*/gm, '$1') // dangling punctuation-led fragments
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  out = out.trim();
  if (/^[a-z]/.test(out)) out = out[0].toUpperCase() + out.slice(1);
  return out;
}
