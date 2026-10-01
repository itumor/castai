// DocsResearcherAgent — KB-backed claim classification (chunk 13).
//
// Flow (spec §5 chunk 13):
//  1. KB search via adapters.kb.search for each of task.queries ?? [task.query].
//  2. Read the top hits via adapters.kb.read (top 3 per query, deduped).
//  3. Classify each claim (task.claims, or brain-derived when absent):
//     documented when the claim's keywords are backed by an actual KB hit
//     (token coverage >= 0.6 against the read content), else inferred.
//  4. Append a `documentation` evidence entry per documented finding
//     (source "kb:<path>", reference = path). Output: {findings}.
//
// Pure research role — no tool execution beyond read-only KB access.

import { BaseAgent } from './base-agent.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'been', 'with', 'this', 'that',
  'our', 'you', 'your', 'not', 'does', 'did', 'from', 'when', 'how', 'why',
  'what', 'which', 'should', 'could', 'would', 'can', 'cannot', 'about',
  'into', 'over', 'under', 'after', 'before', 'has', 'have', 'had', 'but',
  'its', 'his', 'her', 'their', 'them', 'then', 'than', 'also', 'any',
  'all', 'per', 'out', 'get', 'set', 'use', 'using', 'one', 'two',
]);

const DEFAULT_MIN_COVERAGE = 0.6;
const DEFAULT_MAX_HITS_PER_QUERY = 3;

function claimTokens(claim) {
  return String(claim)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Fraction of the claim's tokens present in the (lowercased) document. */
function coverage(tokens, contentLower) {
  if (tokens.length === 0) return 0;
  const hit = tokens.filter((t) => contentLower.includes(t)).length;
  return hit / tokens.length;
}

export class DocsResearcherAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'docs-researcher' });
    this.rolePrompt =
      'You are the docs-researcher agent of the CAST AI support swarm. You ground claims ' +
      'in the internal knowledge base. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {query?: string, queries?: string[], claims?: string[],
   *        categoryHint?: string, minCoverage?: number, maxHits?: number}
   * output: {findings: [{claim, status: 'documented'|'inferred', path}]}
   */
  async _run(task, ctx) {
    const queries = Array.isArray(task?.queries) && task.queries.length > 0
      ? task.queries
      : (task?.query ? [task.query] : null);
    if (!queries) {
      throw new Error('docs-researcher: task.query or task.queries is required');
    }

    // (1)+(2) search and read the top hits, deduped by path.
    const docs = [];
    const seen = new Set();
    const maxHits = task.maxHits ?? DEFAULT_MAX_HITS_PER_QUERY;
    for (const query of queries) {
      const hits = await ctx.adapters.kb.search({ query, categoryHint: task.categoryHint });
      for (const hit of hits.slice(0, maxHits)) {
        if (seen.has(hit.path)) continue;
        seen.add(hit.path);
        // KbReader.read returns {path, content} (redacted); tolerate a bare
        // string for mock adapters.
        const read = await ctx.adapters.kb.read(hit.path);
        const content = typeof read === 'string' ? read : (read?.content ?? '');
        docs.push({ path: hit.path, excerpt: hit.excerpt ?? '', content });
      }
    }

    // (3) claims from the task, or derived by the brain from the KB material.
    const claims = Array.isArray(task.claims) && task.claims.length > 0
      ? task.claims
      : await this._brainClaims(task, docs, ctx);
    const minCoverage = task.minCoverage ?? DEFAULT_MIN_COVERAGE;

    const findings = claims.map((claim) => {
      const tokens = claimTokens(claim);
      let best = null;
      for (const doc of docs) {
        const c = coverage(tokens, doc.content.toLowerCase());
        if (best === null || c > best.coverage) best = { path: doc.path, coverage: c };
      }
      const documented = best !== null && best.coverage >= minCoverage;
      return {
        claim,
        status: documented ? 'documented' : 'inferred',
        path: documented ? best.path : null,
      };
    });

    // (4) documentation evidence for documented findings only.
    for (const finding of findings) {
      if (finding.status !== 'documented') continue;
      const doc = docs.find((d) => d.path === finding.path);
      ctx.addEvidence({
        type: 'documentation',
        source: `kb:${finding.path}`,
        result: `Documented claim: ${finding.claim}. Excerpt: ${(doc?.excerpt ?? '').slice(0, 200)}`,
        reference: finding.path,
      });
    }
    const documentedCount = findings.filter((f) => f.status === 'documented').length;
    ctx.audit('docs_research_complete',
      `${documentedCount}/${findings.length} claims documented across ${docs.length} KB docs`);

    return { findings };
  }

  /** Ask the brain to derive candidate claims from the read KB material. */
  async _brainClaims(task, docs, ctx) {
    const promptTask = {
      instruction:
        'From the KB material, list the candidate claims to verify. Respond ONLY with ' +
        'JSON: {claims: string[]}.',
      query: task.query ?? null,
      docs: docs.map((d) => ({ path: d.path, excerpt: d.excerpt })),
    };
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`docs-researcher: brain returned non-JSON claims: ${String(raw).slice(0, 200)}`);
    }
    if (!parsed || !Array.isArray(parsed.claims) || !parsed.claims.every((c) => typeof c === 'string')) {
      throw new Error('docs-researcher: brain claims JSON must be {claims: string[]}');
    }
    return parsed.claims;
  }
}
