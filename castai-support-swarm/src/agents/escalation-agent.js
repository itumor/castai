// EscalationAgent — engineering debug package builder (chunk 14b).
//
// Produces {summary, evidenceDump, reproductionStatus, openQuestions,
// suggestedNextSteps}. Every included text is redacted: the whole package is
// serialized and pushed through redact() before it is returned, so secrets
// that slipped into evidence results (or brain output) never leave the
// process. suggestedNextSteps come from the brain; everything else is
// deterministic over the ledger.

import { BaseAgent } from './base-agent.js';
import { redact } from '../core/redact.js';

/** 'reproduced' | 'not_reproduced' | 'not_attempted' from reproduction evidence. */
function reproductionStatus(ledger) {
  const repro = (ledger?.evidence ?? []).filter((e) => e.type === 'reproduction');
  if (repro.some((e) => e.reproduced === true)) return 'reproduced';
  if (repro.length > 0) return 'not_reproduced';
  return 'not_attempted';
}

export class EscalationAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'escalation-agent' });
    this.rolePrompt =
      'You are the escalation-agent of the CAST AI support swarm. You package unresolved cases ' +
      'for the engineering team. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {reason?: string, openQuestions?: string[]}
   * output: {escalationPackage: {summary, evidenceDump, reproductionStatus,
   *          openQuestions, suggestedNextSteps}}
   */
  async _run(task, ctx) {
    const ledger = ctx.ledger;
    const reason = typeof task?.reason === 'string' && task.reason.length > 0
      ? task.reason
      : (typeof ledger?.solution?.summary === 'string' && ledger.solution.summary.length > 0
          ? ledger.solution.summary
          : 'No escalation reason provided');
    const openQuestions = Array.isArray(task?.openQuestions)
      ? task.openQuestions.filter((q) => typeof q === 'string')
      : [];

    const suggestedNextSteps = await this._brainNextSteps(ledger, ctx, reason, openQuestions);
    const reproStatus = reproductionStatus(ledger);

    const summary =
      `Escalation reason: ${reason} ` +
      `(reproduction status: ${reproStatus}; ${openQuestions.length} open question(s)` +
      `${ledger?.solution?.summary ? `; solution summary: ${ledger.solution.summary}` : ''})`;

    // Redact ALL included text in one pass over the serialized package.
    const rawPackage = {
      summary,
      evidenceDump: ledger?.evidence ?? [],
      reproductionStatus: reproStatus,
      openQuestions,
      suggestedNextSteps,
    };
    const escalationPackage = JSON.parse(redact(JSON.stringify(rawPackage)));

    ctx.audit('escalation_package_built', `reproduction=${reproStatus}; evidence=${rawPackage.evidenceDump.length} entries`);
    return { escalationPackage };
  }

  /** Ask the brain for concrete next debug steps. */
  async _brainNextSteps(ledger, ctx, reason, openQuestions) {
    const promptTask = {
      instruction:
        'Propose concrete next debugging steps for the engineering team. Respond ONLY with JSON: ' +
        '{suggestedNextSteps: string[]}.',
      reason,
      openQuestions,
      solutionSummary: ledger?.solution?.summary ?? null,
      provider: ledger?.provider ?? null,
    };
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true, tag: 'escalation-agent:steps' });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`escalation-agent: brain returned non-JSON next steps: ${String(raw).slice(0, 200)}`);
    }
    if (!parsed || !Array.isArray(parsed.suggestedNextSteps) || parsed.suggestedNextSteps.some((s) => typeof s !== 'string')) {
      throw new Error('escalation-agent: brain JSON must be {suggestedNextSteps: string[]}');
    }
    return parsed.suggestedNextSteps;
  }
}
