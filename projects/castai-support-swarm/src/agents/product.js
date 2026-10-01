// src/agents/product.js — contract section 7 of CONTRACTS.md
// Product engineering agent. Greps the local CAST AI sources under the repo
// root (castai-mcp-server/src and castai-terraform-1) for keywords derived
// from the triage category (e.g. savings/cost/token endpoints) using only
// read-only fs calls. Adds CODE_CONFIRMED "source_code" evidence with real
// file:line refs for what it finds — and adds nothing when nothing matches.
// It never fabricates a code reference.
//
// Safety: read-only fs only; snippets are size-capped and secret-shaped
// literals are masked before they touch the ledger.

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

import { addEvidence } from '../core/model.js';
import { assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';

const AGENT_ID = 'product';
const AGENT_NAME = 'Product Engineer';

// Local CAST AI source trees, resolved against ctx.repoRoot.
const SCAN_DIRS = ['castai-mcp-server/src', 'castai-terraform-1'];

// Source/config/doc files only; obvious noise is skipped.
const SCAN_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts',
  '.tf', '.hcl', '.json', '.md',
  '.yaml', '.yml', '.txt',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_EVIDENCE = 20;
const MAX_SNIPPET = 140;

// Triage-category -> keyword sets (lowercased, substring matched). Designed
// for the known support themes: savings/cost endpoints, token handling, etc.
const CATEGORY_KEYWORDS = {
  docs_question: [], // falls back to subject tokens
  node_downscale: ['pdb', 'eviction', 'scale-down', 'scaledown'],
  node_upscale: ['node template', 'node-template', 'nodetemplate', 'provisioning'],
  iam_onboarding: ['iam', 'role', 'policy', 'onboard'],
  workload_autoscaling: ['workload', 'recommendation', 'autoscal'],
  cost_reporting: ['savings', 'cost-report', 'costreport', 'realized'],
  spot: ['spot', 'interruption'],
  token_rotation: ['token', 'rotate', 'rotation'],
  product_bug: [], // falls back to subject tokens
  billing: ['billing', 'invoice', 'cost'],
  unknown: [], // falls back to subject tokens
};

// Words too generic to be useful search anchors when falling back to the
// subject line.
const STOPWORDS = new Set([
  'about', 'would', 'could', 'should', 'there', 'which', 'their', 'please',
  'thanks', 'thank', 'hello', 'hi', 'dear', 'regards', 'issue', 'problem',
  'question', 'help', 'urgent', 'broken', 'working',
]);

const SENSITIVE_WORD = /token|secret|password|apikey|api_key|authorization|credential/i;

// Chooses deterministic keywords: the triage category mapping when it has
// entries, otherwise distinctive subject tokens (>=5 chars, deduped, max 5).
function keywordsFor(caseObj) {
  const category = caseObj?.triage?.category ?? 'unknown';
  const mapped = CATEGORY_KEYWORDS[category];
  if (Array.isArray(mapped) && mapped.length > 0) {
    return { origin: 'category', category, keywords: [...mapped] };
  }
  const subject = caseObj?.thread?.subject ?? '';
  const tokens = subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5 && !STOPWORDS.has(token));
  return { origin: 'subject', category, keywords: [...new Set(tokens)].slice(0, 5) };
}

async function listSourceFiles(rootAbs) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing or unreadable directory — nothing to scan here
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  await walk(rootAbs);
  return files;
}

// Masks secret material on lines that mention secret-ish words, so a leaked
// value can never ride into the ledger via a snippet: long quoted literals
// AND unquoted 'word: value' / 'word = value' pairs (8+ chars) are masked.
function maskSecrets(line) {
  if (!SENSITIVE_WORD.test(line)) return line;
  return line
    .replace(/(['"])[^'"]{8,}\1/g, '$1***REDACTED***$1')
    .replace(
      /(\b(?:token|secret|password|api[-_]?key|authorization|credential)\w*)\s*[:=]\s*(?!\*{3})[^\s,}]{8,}/gi,
      '$1= ***REDACTED***',
    );
}

function snippet(line) {
  const cleaned = maskSecrets(line.trim());
  return cleaned.length > MAX_SNIPPET ? `${cleaned.slice(0, MAX_SNIPPET - 1)}…` : cleaned;
}

export function createProduct({ llm, tools } = {}) {
  return {
    id: AGENT_ID,
    name: AGENT_NAME,

    /**
     * run(ctx): ctx = { caseObj, repoRoot, params = {} }.
     * Returns { evidenceAdded }.
     */
    async run(ctx) {
      const { caseObj, repoRoot } = ctx;
      const { origin, category, keywords } = keywordsFor(caseObj);
      record(caseObj, AGENT_ID, 'scan.start', { scanDirs: SCAN_DIRS, keywordOrigin: origin, category });

      // The fs scan below is the 'repoSearch' capability granted to this agent.
      assertToolAllowed(AGENT_ID, 'repoSearch');

      let evidenceAdded = 0;

      if (!repoRoot || keywords.length === 0 || evidenceAdded >= MAX_EVIDENCE) {
        record(caseObj, AGENT_ID, 'scan.no-keywords', { keywords });
        record(caseObj, AGENT_ID, 'scan.complete', { evidenceAdded });
        return { evidenceAdded };
      }

      const loweredKeywords = keywords.map((k) => k.toLowerCase());

      for (const dir of SCAN_DIRS) {
        if (evidenceAdded >= MAX_EVIDENCE) break;
        const files = await listSourceFiles(join(repoRoot, dir));
        for (const fileAbs of files) {
          if (evidenceAdded >= MAX_EVIDENCE) break;

          let info;
          try {
            info = await stat(fileAbs);
          } catch {
            continue;
          }
          if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;

          let content;
          try {
            content = await readFile(fileAbs, 'utf8');
          } catch {
            continue; // unreadable or non-utf8 file — skip, never guess
          }

          const lines = content.split(/\r?\n/);
          const hits = []; // [{ keyword, line, text }]
          for (const keyword of loweredKeywords) {
            const index = lines.findIndex((l) => l.toLowerCase().includes(keyword));
            if (index !== -1) {
              hits.push({ keyword, line: index + 1, text: lines[index] });
            }
          }
          if (hits.length === 0) continue;

          const relPath = relative(repoRoot, fileAbs).split(sep).join('/');
          const first = hits[0];
          const evidence = addEvidence(caseObj, {
            type: 'source_code',
            source: 'repo',
            ref: `${relPath}:${first.line}`,
            summary:
              `Source scan: '${relPath}' matches keyword(s) ${hits.map((h) => `"${h.keyword}"`).join(', ')}; ` +
              `line ${first.line}: "${snippet(first.text)}"`,
            agentId: AGENT_ID,
          });
          evidenceAdded += 1;
          record(caseObj, AGENT_ID, 'evidence.added', {
            evidenceId: evidence.id,
            type: evidence.type,
            ref: evidence.ref,
            keywords: hits.map((h) => h.keyword),
          });
        }
      }

      if (evidenceAdded === 0) {
        record(caseObj, AGENT_ID, 'scan.no-matches', { keywords });
      }
      record(caseObj, AGENT_ID, 'scan.complete', { evidenceAdded });
      return { evidenceAdded };
    },
  };
}
