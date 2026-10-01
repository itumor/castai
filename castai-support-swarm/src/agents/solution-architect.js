// SolutionArchitectAgent — architecture-fit reviewer (chunk 14b).
//
// Validates the proposed fix's architecture fit (rollout order, rollback,
// interactions between Node Autoscaler / Workload Autoscaler / HPA / VPA)
// using the brain plus a KB search. Architecture facts found in the KB are
// appended as 'documentation' evidence so the verifier can classify
// solution claims as DOCUMENTED.

import { BaseAgent } from './base-agent.js';

const MAX_HITS = 3;

export class SolutionArchitectAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'solution-architect' });
    this.rolePrompt =
      'You are the solution-architect agent of the CAST AI support swarm. You review proposed ' +
      'solutions for rollout order, rollback safety and autoscaler interactions. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {proposedSolution: string, kbQuery?: string}
   * output: {architectureReview: {fit: 'ok'|'concerns', notes, evidenceIds}}
   */
  async _run(task, ctx) {
    const proposedSolution = task?.proposedSolution;
    if (typeof proposedSolution !== 'string' || proposedSolution.length === 0) {
      throw new Error('solution-architect: task.proposedSolution must be a non-empty string');
    }

    // KB search for architecture facts (read-only). Hits become documentation evidence.
    const kbQuery = typeof task?.kbQuery === 'string' && task.kbQuery.length > 0
      ? task.kbQuery
      : proposedSolution.slice(0, 200);
    const evidenceIds = [];
    const kbDocs = [];
    const hits = await ctx.adapters.kb.search({ query: kbQuery });
    const seen = new Set();
    for (const hit of (hits ?? []).slice(0, MAX_HITS)) {
      if (seen.has(hit.path)) continue;
      seen.add(hit.path);
      const read = await ctx.adapters.kb.read(hit.path);
      const content = typeof read === 'string' ? read : (read?.content ?? '');
      kbDocs.push({ path: hit.path, excerpt: hit.excerpt ?? '', content });
      const entry = ctx.addEvidence({
        type: 'documentation',
        source: `kb:${hit.path}`,
        result: `Architecture fact from KB (${hit.path}): ${(hit.excerpt || content).slice(0, 200)}`,
        reference: hit.path,
      });
      evidenceIds.push(entry.id);
    }

    // Brain review: rollout order, rollback, autoscaler interactions.
    const promptTask = {
      instruction:
        'Review the proposed solution for architecture fit: rollout order, rollback path, and ' +
        'interactions between Node Autoscaler, Workload Autoscaler, HPA and VPA. Respond ONLY with ' +
        'JSON: {fit: "ok"|"concerns", notes: string}.',
      proposedSolution,
      kbFacts: kbDocs.map((d) => ({ path: d.path, excerpt: d.excerpt })),
    };
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true, tag: 'solution-architect:review' });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`solution-architect: brain returned non-JSON review: ${String(raw).slice(0, 200)}`);
    }
    if (!parsed || (parsed.fit !== 'ok' && parsed.fit !== 'concerns') || typeof parsed.notes !== 'string') {
      throw new Error('solution-architect: brain JSON must be {fit: "ok"|"concerns", notes: string}');
    }

    ctx.audit('architecture_reviewed', `fit=${parsed.fit}; kbFacts=${kbDocs.length}`);
    return { architectureReview: { fit: parsed.fit, notes: parsed.notes, evidenceIds } };
  }
}
