// KnowledgeAgent — KB/runbook proposal emitter (chunk 14b).
//
// Proposes knowledge-base/runbook TEXT via the brain from the closed case
// and returns the proposals in the AgentResult output. V1 NEVER writes
// files: there are no fs calls in this module by design — a human (or the
// orchestrator) reviews the proposals first. Only proposal strings leave
// this agent.

import { BaseAgent } from './base-agent.js';

function slugify(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'proposal';
}

export class KnowledgeAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'knowledge-agent' });
    this.rolePrompt =
      'You are the knowledge-agent of the CAST AI support swarm. You distill closed cases into ' +
      'runbook/KB article proposals. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {extraContext?: string}
   * output: {proposals: [{title, text, targetPath}]}
   * No file writes: proposals are returned as strings only.
   */
  async _run(task, ctx) {
    const ledger = ctx.ledger;
    const promptTask = {
      instruction:
        'Propose KB/runbook article updates capturing this case. Respond ONLY with JSON: ' +
        '{proposals: [{title: string, text: string, targetPath: string}]}. ' +
        'targetPath is the repo-relative path where the article WOULD live (do not write it).',
      caseId: ledger?.caseId ?? null,
      customerQuestion: ledger?.customerQuestion ?? [],
      solutionSummary: ledger?.solution?.summary ?? null,
      provider: ledger?.provider ?? null,
      extraContext: typeof task?.extraContext === 'string' ? task.extraContext : null,
    };
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true, tag: 'knowledge-agent:proposals' });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`knowledge-agent: brain returned non-JSON proposals: ${String(raw).slice(0, 200)}`);
    }
    if (!parsed || !Array.isArray(parsed.proposals) || parsed.proposals.length === 0) {
      throw new Error('knowledge-agent: brain JSON must be {proposals: [...]} with at least one proposal');
    }

    const proposals = parsed.proposals.map((p, i) => {
      if (!p || typeof p.title !== 'string' || p.title.length === 0 || typeof p.text !== 'string' || p.text.length === 0) {
        throw new Error(`knowledge-agent: proposal #${i + 1} must have non-empty title and text strings`);
      }
      const targetPath = typeof p.targetPath === 'string' && p.targetPath.length > 0
        ? p.targetPath
        : `out/knowledge-proposals/${slugify(p.title)}.md`;
      return { title: p.title, text: p.text, targetPath };
    });

    ctx.audit('proposals_emitted', `${proposals.length} proposal(s); no files written`);
    return { proposals };
  }
}
