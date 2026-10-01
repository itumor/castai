// src/tools/kb.js — knowledge base search, pure fs and read-only
// (contract section 6).
//
// Recursively reads *.md | *.txt | *.skill under each root (resolved against
// repoRoot), scores by case-insensitive term frequency of the query tokens
// (filename matches count 3x), and returns the top hits with the snippet
// window that holds the highest density of distinct query tokens (a
// content-rich window, not the document header). Missing/unreadable roots and
// files are skipped, never fatal.

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const DEFAULT_KB_ROOTS = ['.kimchi/docs', 'brain/notes']; // resolved against repo root

const KB_EXTENSIONS = ['.md', '.txt', '.skill'];
const SNIPPET_RADIUS_BEFORE = 80; // chars kept before the best hit
const SNIPPET_LENGTH = 200; // total snippet budget ("first ~200 chars around best hit")

// Search terms that carry no topic signal. Scoring and snippet windows must be
// driven by the distinctive tokens of a question ('realized', 'formula',
// 'token') — otherwise chatter like 'what is the' picks the window.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'behind', 'can', 'could', 'do', 'does',
  'exact', 'exactly', 'for', 'how', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
  'our', 'should', 'so', 'something', 'that', 'the', 'this', 'to', 'us', 'we', 'what',
  'when', 'where', 'which', 'with', 'you', 'your',
]);

function queryTokens(query) {
  const all = tokenize(query ?? '');
  const distinctive = all.filter((token) => !STOPWORDS.has(token));
  return distinctive.length > 0 ? distinctive : all; // all-stopword query degenerates to unfiltered
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** countTokens — Map of token -> occurrence count for a pre-tokenized document. */
function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/** walkFiles — yields every KB file under dir, sorted per directory for determinism. */
async function* walkFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // missing or unreadable root: skip
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (KB_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        yield full;
      }
    }
  }
}

/** Every start position of `token` in `contentLower` (plain substring walk). */
function* occurrencePositions(contentLower, token) {
  let from = 0;
  for (;;) {
    const idx = contentLower.indexOf(token, from);
    if (idx === -1) return;
    yield idx;
    from = idx + token.length;
  }
}

/**
 * buildSnippet — the ~200-char window holding the highest density of DISTINCT
 * query tokens (ties: most total occurrences, then earliest). A title-heavy
 * header window loses to the body window that actually answers the query.
 */
function buildSnippet(content, contentLower, tokens, contentCounts) {
  let bestStart = 0;
  let bestDistinct = -1;
  let bestCount = 0;
  const seenStarts = new Set();
  for (const token of tokens) {
    if ((contentCounts.get(token) ?? 0) === 0) continue;
    for (const idx of occurrencePositions(contentLower, token)) {
      const start = Math.max(0, idx - SNIPPET_RADIUS_BEFORE);
      if (seenStarts.has(start)) continue;
      seenStarts.add(start);
      const windowTokens = countTokens(
        tokenize(contentLower.slice(start, start + SNIPPET_LENGTH)),
      );
      let distinct = 0;
      let total = 0;
      for (const t of tokens) {
        const c = windowTokens.get(t) ?? 0;
        if (c > 0) {
          distinct += 1;
          total += c;
        }
      }
      if (distinct > bestDistinct || (distinct === bestDistinct && total > bestCount)) {
        bestStart = start;
        bestDistinct = distinct;
        bestCount = total;
      }
    }
  }
  // Snap the raw window to sentence boundaries so the snippet is quotable
  // prose instead of a mid-sentence shred: expand the start back to the
  // previous sentence/line boundary (heading lines are skipped) and the end
  // forward to the sentence that finishes the window's last thought.
  let start = bestStart;
  const backLimit = Math.max(0, bestStart - SNIPPET_RADIUS_BEFORE);
  for (let i = bestStart; i > backLimit; i -= 1) {
    if (content[i] === '\n' || (content[i] === ' ' && content[i - 1] === '.')) {
      start = i + 1;
      break;
    }
  }
  while (content[start] === '#' || content[start] === '\n') start += 1;
  let end = bestStart + SNIPPET_LENGTH;
  const fwdLimit = Math.min(content.length, end + 120);
  for (let i = end; i < fwdLimit; i += 1) {
    if (content[i] === '\n' || (content[i] === ' ' && content[i - 1] === '.')) {
      end = i;
      break;
    }
  }
  return content
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * searchKb({ repoRoot, roots = DEFAULT_KB_ROOTS, query, limit = 5 })
 * -> [{ path, score, snippet }] sorted by score desc (path asc on ties).
 * Filename token matches count 3x relative to content occurrences.
 */
export async function searchKb({ repoRoot, roots = DEFAULT_KB_ROOTS, query, limit = 5 } = {}) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  const results = [];
  for (const root of roots) {
    const rootDir = path.resolve(repoRoot, root);
    for await (const file of walkFiles(rootDir)) {
      let content;
      try {
        content = await fsp.readFile(file, 'utf8');
      } catch {
        continue; // unreadable file: skip
      }
      const contentLower = content.toLowerCase();
      const contentCounts = countTokens(tokenize(content));
      const filenameCounts = countTokens(tokenize(path.basename(file)));
      let score = 0;
      for (const token of tokens) {
        score += (contentCounts.get(token) ?? 0) + 3 * (filenameCounts.get(token) ?? 0);
      }
      if (score <= 0) continue;
      results.push({
        path: file,
        score,
        snippet: buildSnippet(content, contentLower, tokens, contentCounts),
      });
    }
  }

  results.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results.slice(0, limit);
}
