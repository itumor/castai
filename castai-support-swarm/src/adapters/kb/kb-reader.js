// Filesystem knowledge-base reader with a symlink jail and secret refusal.
//
// Safety invariants (spec chunk 7):
//  - Every candidate file resolves via fs.realpath; the real path must live
//    inside the real repoRoot (prefix check on separator-terminated paths).
//    Symlinks pointing outside the repo root are refused (ForbiddenPathError).
//  - Secret paths (*.env, .env*, awskey.env) and secret-content files
//    (first 4KB matching PRIVATE KEY / castai_v1_ / AKIA[0-9A-Z]{16}) are
//    never read: read() throws ForbiddenPathError, never returns content.
//  - read() output always passes through redact() before returning.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { redact } from '../../core/redact.js';

const DEFAULT_ROOTS = ['brain/notes', '.kimchi/docs', '.kimchi/skills'];
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

// Secret content patterns checked against the first 4KB of a file.
const SECRET_CONTENT_RE = /PRIVATE KEY|castai_v1_|AKIA[0-9A-Z]{16}/;
const SECRET_HEAD_BYTES = 4096;

// Search scoring knobs.
const SEARCH_MAX_HITS = 10;
const SEARCH_HEAD_BYTES = 4096; // score against the head of the file
const SEARCH_MAX_LINES = 80; // "first-N-lines text match"
const SCORE_FILENAME_TOKEN = 10;
const SCORE_CONTENT_HIT = 2;
const SCORE_CATEGORY_HINT = 3;
const EXCERPT_MAX_CHARS = 400;
const EXCERPT_CONTEXT_CHARS = 150;

/** Thrown when a path is outside the symlink jail or looks like a secret. */
export class ForbiddenPathError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ForbiddenPathError';
  }
}

function defaultRepoRoot() {
  // src/adapters/kb/kb-reader.js → component dir is 3 levels up;
  // repoRoot is the parent of the component dir → 4 levels up.
  const componentDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..'
  );
  return path.resolve(componentDir, '..');
}

function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((t) => t.length > 0);
}

function extractTitle(text, basename) {
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return basename;
}

function makeExcerpt(text, tokens) {
  const flat = text.replace(/\s+/g, ' ');
  let idx = -1;
  for (const token of tokens) {
    const at = flat.toLowerCase().indexOf(token);
    if (at !== -1 && (idx === -1 || at < idx)) idx = at;
  }
  if (idx === -1) return flat.slice(0, EXCERPT_MAX_CHARS);
  const start = Math.max(0, idx - EXCERPT_CONTEXT_CHARS);
  return flat.slice(start, start + EXCERPT_MAX_CHARS);
}

export class KbReader {
  /**
   * @param {object} [options]
   * @param {string[]} [options.roots] KB roots relative to repoRoot.
   * @param {string} [options.repoRoot] defaults to parent of the component dir.
   * @param {number} [options.maxFileBytes] files larger than this are skipped
   *        by search() and refused by read().
   */
  constructor({ roots, repoRoot, maxFileBytes = DEFAULT_MAX_FILE_BYTES } = {}) {
    // Store the REAL repoRoot (symlinks resolved) so jail prefix checks and
    // repo-relative path computation agree even when the repo root itself is
    // reached through a symlink (e.g. macOS /var → /private/var).
    this.repoRoot = fs.realpathSync(path.resolve(repoRoot || defaultRepoRoot()));
    this.roots = (roots || DEFAULT_ROOTS).map((r) =>
      path.resolve(this.repoRoot, r)
    );
    this.maxFileBytes = maxFileBytes;
  }

  /** True if the basename looks like an environment/secret file. */
  static isSecretPath(p) {
    const base = path.basename(String(p || ''));
    if (base === '') return false;
    if (base === 'awskey.env') return true;
    if (base.endsWith('.env')) return true;
    if (base.startsWith('.env')) return true;
    return false;
  }

  /**
   * Symlink jail check: resolves repoRoot and the candidate through
   * fs.realpath and requires the real candidate path to be inside the real
   * repoRoot (separator-terminated prefix comparison). Returns false on any
   * resolution failure (missing file, permission error, escape).
   */
  static isPathAllowed(repoRoot, p) {
    try {
      const realRoot = fs.realpathSync(path.resolve(repoRoot));
      const candidate = path.isAbsolute(p)
        ? path.resolve(p)
        : path.resolve(realRoot, p);
      const realCandidate = fs.realpathSync(candidate);
      if (realCandidate === realRoot) return true;
      const jailRoot = realRoot.endsWith(path.sep)
        ? realRoot
        : realRoot + path.sep;
      return realCandidate.startsWith(jailRoot);
    } catch {
      return false;
    }
  }

  /**
   * Resolve a user-supplied path (repo-relative or absolute) through the
   * symlink jail. Throws ForbiddenPathError unless the real path is inside
   * the real repoRoot.
   */
  _jail(p) {
    const candidate = path.isAbsolute(p)
      ? path.resolve(p)
      : path.resolve(this.repoRoot, p);
    if (!KbReader.isPathAllowed(this.repoRoot, candidate)) {
      throw new ForbiddenPathError(
        `path escapes the repository jail or does not exist: ${p}`
      );
    }
    return fs.realpathSync(candidate);
  }

  async _readHead(realPath) {
    const stat = await fsp.stat(realPath);
    if (!stat.isFile()) {
      throw new ForbiddenPathError(`not a regular file: ${realPath}`);
    }
    if (stat.size > this.maxFileBytes) {
      throw new ForbiddenPathError(
        `file exceeds maxFileBytes (${this.maxFileBytes}): ${realPath}`
      );
    }
    const fh = await fsp.open(realPath, 'r');
    try {
      const length = Math.min(SECRET_HEAD_BYTES, stat.size);
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, 0);
      return { headBuf: buf, stat };
    } finally {
      await fh.close();
    }
  }

  /**
   * Read a KB file. Returns { path, content } where content is redacted.
   * Throws ForbiddenPathError for jail escapes, secret-named files,
   * secret-content files, or oversized files.
   */
  async read(p) {
    const realPath = this._jail(p);
    if (
      KbReader.isSecretPath(p) ||
      KbReader.isSecretPath(realPath)
    ) {
      throw new ForbiddenPathError(
        `refusing to read secret-named file: ${path.basename(realPath)}`
      );
    }
    const { headBuf } = await this._readHead(realPath);
    if (SECRET_CONTENT_RE.test(headBuf.toString('latin1'))) {
      throw new ForbiddenPathError(
        'refusing to read file with secret-like content (first 4KB)'
      );
    }
    const content = await fsp.readFile(realPath, 'utf8');
    const rel = path.relative(this.repoRoot, realPath);
    return { path: rel, content: redact(content) };
  }

  /**
   * Score KB files against a query. Returns up to 10 hits sorted by score:
   * [{ path, title, excerpt, score }]. Skips (never throws on) individual
   * files that fail the jail, are secret-named, secret-content, or oversized.
   */
  async search({ query, categoryHint } = {}) {
    const tokens = tokenize(query);
    const files = [];
    for (const root of this.roots) {
      this._walk(root, files);
    }
    const hits = [];
    for (const realPath of files) {
      try {
        const hit = await this._scoreFile(realPath, tokens, categoryHint);
        if (hit && hit.score > 0) hits.push(hit);
      } catch {
        // fail closed per-file: unreadable/refused files never appear
      }
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, SEARCH_MAX_HITS);
  }

  /** Collect regular, non-symlinked-directory files under root (jail-safe). */
  _walk(dir, out, depth = 0) {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing root
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._walk(full, out, depth + 1);
        continue;
      }
      if (entry.isSymbolicLink()) {
        // Allow symlinked FILES that stay inside the jail; never recurse
        // into symlinked directories (out-of-jail links resolve via realpath
        // below and are dropped).
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) continue;
      } else if (!entry.isFile()) {
        continue;
      }
      try {
        const real = fs.realpathSync(full);
        if (!KbReader.isPathAllowed(this.repoRoot, real)) continue;
        if (KbReader.isSecretPath(real)) continue;
        const st = fs.statSync(real);
        if (!st.isFile() || st.size > this.maxFileBytes) continue;
        out.push(real);
      } catch {
        continue;
      }
    }
  }

  async _scoreFile(realPath, tokens, categoryHint) {
    const { headBuf } = await this._readHead(realPath);
    const head = headBuf.toString('utf8');
    if (SECRET_CONTENT_RE.test(headBuf.toString('latin1'))) return null;
    if (KbReader.isSecretPath(realPath)) return null;

    const lines = head.split('\n').slice(0, SEARCH_MAX_LINES).join('\n');
    const lowerLines = lines.toLowerCase();
    const lowerBase = path.basename(realPath).toLowerCase();
    const rel = path.relative(this.repoRoot, realPath);

    let score = 0;
    let matched = false;
    for (const token of tokens) {
      if (lowerBase.includes(token)) {
        score += SCORE_FILENAME_TOKEN;
        matched = true;
      }
      const occurrences = lowerLines.split(token).length - 1;
      if (occurrences > 0) {
        score += Math.min(occurrences, 10) * SCORE_CONTENT_HIT;
        matched = true;
      }
    }
    if (!matched) return null;

    if (categoryHint) {
      const hint = String(categoryHint).toLowerCase();
      if (rel.toLowerCase().includes(hint)) score += SCORE_CATEGORY_HINT;
    }

    return {
      path: rel,
      title: extractTitle(lines, path.basename(realPath)),
      excerpt: makeExcerpt(lines, tokens),
      score,
    };
  }
}
