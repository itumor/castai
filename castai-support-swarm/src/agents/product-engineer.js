// ProductEngineerAgent — investigation-side specialist (chunk 14a).
//
// Answers implementation-behavior questions (task.questions) using KB-backed
// code/docs reasoning:
//  1. For each question, search adapters.kb (top hits per question, deduped).
//  2. One brain (json mode) classification call over all questions + KB
//     material: {answers: [{question, answer, confirmed, path}]}.
//  3. Each confirmed answer backed by a searched KB path appends `code`
//     evidence (source "kb:<path>", reference = path). Unconfirmed answers and
//     paths outside the searched material get no evidence.
//
// Output: { answers: [{question, answer, evidenceIds}] }

import { BaseAgent } from './base-agent.js';

const MAX_RESULT_CHARS = 400;
const DEFAULT_MAX_HITS_PER_QUESTION = 3;

/** JSON.stringify a value and clip to maxLen chars (ellipsis included). */
function clipResult(value, maxLen = MAX_RESULT_CHARS) {
  let s;
  try {
    s = JSON.stringify(value);
    if (s === undefined) s = String(value);
  } catch {
    s = String(value);
  }
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

/** Parse a brain JSON response, throwing a readable error on non-JSON. */
function parseBrainJson(raw, who) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${who}: brain returned non-JSON response: ${String(raw).slice(0, 200)}`);
  }
}

export class ProductEngineerAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'product-engineer' });
    this.rolePrompt =
      'You are the product-engineer agent of the CAST AI support swarm. You answer ' +
      'implementation-behavior questions from knowledge-base sources. Respond ONLY with JSON.';
  }

  /**
   * task: {questions: string[], maxHits?: number}
   */
  async _run(task, ctx) {
    const questions = (Array.isArray(task?.questions) ? task.questions : [])
      .filter((q) => typeof q === 'string' && q.length > 0);
    if (questions.length === 0) {
      throw new Error('product-engineer: task.questions (non-empty string[]) is required');
    }
    const kb = ctx.adapters.kb;
    if (!kb) throw new Error('product-engineer: kb adapter is required');

    // (1) search per question, keep the top hits (deduped by path) + content.
    const material = [];
    const seen = new Set();
    const maxHits = task.maxHits ?? DEFAULT_MAX_HITS_PER_QUESTION;
    for (const question of questions) {
      const hits = await kb.search({ query: question });
      for (const hit of hits.slice(0, maxHits)) {
        if (seen.has(hit.path)) continue;
        seen.add(hit.path);
        // KbReader.read returns {path, content}; tolerate a bare string for
        // stub adapters.
        const read = await kb.read(hit.path);
        const content = typeof read === 'string' ? read : (read?.content ?? '');
        material.push({ path: hit.path, excerpt: hit.excerpt ?? '', content });
      }
    }

    // (2) one brain classification call over all questions + the KB material.
    const raw = await ctx.brain.complete(this.buildPrompt({
      instruction:
        'Answer each implementation question using only the KB material in the ledger. ' +
        'Respond ONLY with JSON: {answers: [{question, answer, confirmed: boolean, ' +
        'path: string|null}]}. confirmed=true only for facts backed by a material path.',
      questions,
    }), { json: true });
    const parsed = parseBrainJson(raw, 'product-engineer');
    if (!parsed || !Array.isArray(parsed.answers)) {
      throw new Error('product-engineer: brain answers JSON must be {answers: [...]}');
    }

    // (3) `code` evidence for confirmed answers grounded in searched material.
    const answers = parsed.answers
      .filter((a) => questions.includes(a?.question))
      .map((a) => {
        const evidenceIds = [];
        const doc = material.find((m) => m.path === a?.path);
        if (a.confirmed === true && doc) {
          const entry = ctx.addEvidence({
            type: 'code',
            source: `kb:${a.path}`,
            result: clipResult({ question: a.question, answer: a.answer ?? '', excerpt: doc.excerpt }),
            reference: a.path,
          });
          evidenceIds.push(entry.id);
        }
        return { question: a.question, answer: a.answer ?? '', evidenceIds };
      });

    const confirmedCount = answers.filter((a) => a.evidenceIds.length > 0).length;
    ctx.audit('product_engineering_complete',
      `${confirmedCount}/${answers.length} answers code-confirmed from ${material.length} KB docs`);

    return { answers };
  }
}
