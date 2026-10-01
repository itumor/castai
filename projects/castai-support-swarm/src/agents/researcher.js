// src/agents/researcher.js — contract section 7 (researcher agent).
//
// createResearcher({ llm, tools }): for each question in the triage result,
// searches the knowledge base via tools.kb.searchKb (pure fs, read-only) and
// the optional tools.docsSearch. Every hit becomes:
//   - one evidence entry (documentation | api_spec | prior_ticket, classified
//     deterministically from the source path) with the source path as `ref`,
//   - one claim (needsVerification: true) linked to that evidence, so the
//     verifier can later demand corroboration.
// Returns { claimsAdded, evidenceAdded }.

import { isAbsolute, relative, sep } from 'node:path';

import { AGENT_PERMISSIONS } from '../core/policy.js';
import { addClaim, addEvidence } from '../core/model.js';
import { record } from '../core/trace.js';
import { createAgent } from './base.js';

/**
 * Deterministic evidence-type classification from the source path.
 * 'reply-'/'case'/'ticket' notes -> prior_ticket (someone was here before);
 * API-ish specs -> api_spec; everything else -> documentation.
 */
export function classifyKbHit(path) {
  const base = String(path || '')
    .toLowerCase()
    .split('/')
    .pop();
  if (/^reply[-_ ]/.test(base) || /\bcase\b|\bticket\b/.test(base)) return 'prior_ticket';
  if (/(^|[^a-z])api([^a-z]|$)|endpoint|spec/.test(base)) return 'api_spec';
  return 'documentation';
}

function oneLine(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * toLedgerRef(hitPath, repoRoot) — internal absolute machine paths must never
 * enter the evidence ledger (contract §7): a hit resolving under repoRoot is
 * stored repo-relative ('.kimchi/docs/x.md'); anything else passes through.
 */
export function toLedgerRef(hitPath, repoRoot) {
  const raw = String(hitPath || '');
  if (typeof repoRoot === 'string' && repoRoot.length > 0 && isAbsolute(raw)) {
    const rel = relative(repoRoot, raw).split(sep).join('/');
    if (rel.length > 0 && rel !== '..' && !rel.startsWith('../')) return rel;
  }
  return raw;
}

/**
 * Sentences that are document meta-noise, never customer substance: Q&A
 * headings leaked from docs (Q6. ...), review verdicts, tool output. These
 * make terrible findings in a customer reply.
 */
const JUNK_SENTENCE_RE = /(^|\s)q\d+\.|needs_revision|reviewed against|shellcheck is clean|exit code:/i;

/** A sentence that is really a bare listing of document filenames. */
const FILE_LIST_RE = /(?:\b[\w-]+\.md\b.*){2}/i;

/**
 * cleanSnippet(raw) — repair a raw ~200-char KB window into clean sentence(s)
 * a claim can honestly carry. Snippets start/end mid-word and carry markdown
 * residue; returning them verbatim makes customer replies read like machine
 * scrapings. Returns '' when the snippet is irreparable (the hit is skipped —
 * a claim is never built on text we would be ashamed to quote).
 */
export function cleanSnippet(raw) {
  let s = oneLine(raw);
  if (!s) return '';
  // Markdown residue: emphasis asterisks, code backticks, ATX heading hashes,
  // a leading list bullet (the claim renderer adds its own bullets).
  s = s
    .replace(/\*+/g, '')
    .replace(/`/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/<(https:\/\/[^>\s]+)>/g, '$1')
    .replace(/\(md verified\)/gi, '')
    .replace(/^[-*•]\s+/, '')
    .trim();
  // Internal doc paths cited INSIDE content must never reach a customer body.
  s = s
    .replace(/(?:\.kimchi\/docs|brain\/notes)\/\S+?\.(?:md|txt|skill)/gi, 'the internal runbook')
    .replace(/(?:\.kimchi\/docs|brain\/notes)\/\S+/gi, 'the internal runbook');
  // Leading fragment repair. The window starts mid-word, e.g. 'he old token
  // continued…' (partial article) or 'tate the token, update every secret…'
  // (partial verb). A ≤2-letter stub is dropped (the rest of the sentence is
  // intact); a longer partial word carried meaning → cut to the first clause
  // boundary instead of sacrificing the whole sentence. Without any boundary
  // the snippet is irreparable.
  if (/^[a-z]/.test(s)) {
    const stub = /^[a-z]+/.exec(s)[0];
    if (stub.length <= 2) {
      s = s.slice(stub.length + 1).trim();
    } else {
      const boundary = /[,;.!?][)"'\]]?\s+/.exec(s);
      if (!boundary) return '';
      s = s.slice(boundary.index + boundary[0].length).trim();
    }
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Trailing fragments: stray colon + alpha stub ('later: th.'), stubby 1-2
  // letter final word ('what is the re.'), dangling ':.'. Digits are kept —
  // 'replica count: 2.' is substance, not a fragment.
  s = s
    .replace(/[:;]\s+[A-Za-z]{1,6}\.$/, '.')
    .replace(/\s+[a-z]{1,2}\.$/, '')
    .replace(/[:;](?=\.$)/, '');
  const sentences = s
    .split(/(?<=[.!?])["')\]]?\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const kept = sentences.filter(
    (t) =>
      t.length >= 20 &&
      /[.!?]["')\]]?$/.test(t) &&
      !/[?]["')\]]?$/.test(t) && // findings state facts; Q&A-heading questions are not facts
      !JUNK_SENTENCE_RE.test(t) &&
      !FILE_LIST_RE.test(t),
  );
  const out = kept.join(' ').trim();
  return out.length >= 30 && /[A-Za-z]/.test(out) ? out : '';
}

/** Normalise a search hit to { ref, snippet }. Returns null when unusable. */
function normalizeHit(hit, repoRoot) {
  if (!hit || typeof hit !== 'object') return null;
  const raw = hit.path !== undefined ? hit.path : hit.ref;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const snippet = cleanSnippet(hit.snippet);
  if (!snippet) return null; // irreparable fragment — no evidence, no claim
  return { ref: toLedgerRef(raw, repoRoot), snippet };
}

export function createResearcher({ llm, tools } = {}) {
  return createAgent({
    id: 'researcher',
    name: 'KB Researcher',
    permissions: AGENT_PERMISSIONS.researcher,
    async handler(ctx, { useTool }) {
      const { caseObj, repoRoot, params = {} } = ctx;

      const triage = caseObj.triage && typeof caseObj.triage === 'object' ? caseObj.triage : {};
      let queries = Array.isArray(triage.questions)
        ? triage.questions.filter((q) => typeof q === 'string' && q.trim().length > 0)
        : [];
      // No explicit questions triaged: fall back to the thread subject.
      if (queries.length === 0 && caseObj.thread && caseObj.thread.subject) {
        queries = [caseObj.thread.subject];
      }

      const kbTool = tools && tools.kb && typeof tools.kb.searchKb === 'function' ? tools.kb : null;
      const docsSearch =
        tools && tools.docsSearch
          ? typeof tools.docsSearch === 'function'
            ? { search: tools.docsSearch }
            : typeof tools.docsSearch.search === 'function'
              ? tools.docsSearch
              : null
          : null;

      const limit = Number.isInteger(params.kbLimit) && params.kbLimit > 0 ? params.kbLimit : 5;
      const roots = Array.isArray(params.kbRoots) ? params.kbRoots : undefined;

      let claimsAdded = 0;
      let evidenceAdded = 0;
      const evidenceByRef = new Map(); // dedupe evidence per source path within this run

      const absorb = (rawHits, via) => {
        const hits = Array.isArray(rawHits) ? rawHits : [];
        for (const rawHit of hits) {
          const hit = normalizeHit(rawHit, repoRoot);
          if (!hit) continue;
          let evidence = evidenceByRef.get(hit.ref);
          if (!evidence) {
            const type = classifyKbHit(hit.ref);
            evidence = addEvidence(caseObj, {
              type,
              source: 'kb',
              ref: hit.ref,
              summary: hit.snippet,
              agentId: 'researcher',
            });
            evidenceByRef.set(hit.ref, evidence);
            evidenceAdded += 1;
          }
          // Skip a claim whose statement ALREADY exists in the ledger: the
          // verify-feedback loop re-runs researchers over the same corpus, and
          // a duplicate proposal adds nothing but verdict noise (the same
          // rejected claim must not be re-presented under a fresh id).
          const statement = `Knowledge base source ${hit.ref} documents: ${hit.snippet}`;
          const alreadyProposed = (caseObj.claims || []).some(
            (claim) => claim.statement === statement,
          );
          if (alreadyProposed) continue;
          addClaim(caseObj, {
            statement,
            needsVerification: true,
            evidenceIds: [evidence.id],
          });
          claimsAdded += 1;
        }
      };

      if (!kbTool && !docsSearch) {
        record(caseObj, 'researcher', 'kb.unavailable', { queries: queries.length });
        return { claimsAdded: 0, evidenceAdded: 0 };
      }

      for (const query of queries) {
        if (kbTool) {
          useTool('kb');
          const args = { repoRoot, query, limit };
          if (roots) args.roots = roots;
          const hits = await kbTool.searchKb(args);
          record(caseObj, 'researcher', 'kb.search', {
            query,
            hits: Array.isArray(hits) ? hits.length : 0,
          });
          absorb(hits, 'kb');
        }
        if (docsSearch) {
          useTool('docsSearch');
          const hits = await docsSearch.search({ repoRoot, query, limit });
          record(caseObj, 'researcher', 'docsSearch.search', {
            query,
            hits: Array.isArray(hits) ? hits.length : 0,
          });
          absorb(hits, 'docsSearch');
        }
      }

      record(caseObj, 'researcher', 'researcher.complete', { claimsAdded, evidenceAdded });
      return { claimsAdded, evidenceAdded };
    },
  });
}
