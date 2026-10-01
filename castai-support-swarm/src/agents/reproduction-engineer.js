// ReproductionEngineerAgent — investigation-side specialist (chunk 14a).
//
// Reproduces the reported issue in the sandbox:
//  1. Scenario comes from task.scenario (string id or {id, params}); when
//     absent it is derived from task.issueCategory as `repro-<category>`.
//  2. Runs adapters.sandbox.run(scenario) — the only adapter this role may
//     touch (permission matrix: sandbox only). A castai/k8s/kb adapter may be
//     present in the adapters object; it is never accessed.
//  3. Appends one `reproduction` evidence entry carrying the sandbox result's
//     `reproduced` flag verbatim, a before/after summary and the toolRun.
//  4. The brain (json mode) summarizes the reproduction; a brain failure never
//     fails the run — the raw sandbox facts are the output.
//
// Output: { scenario, reproduced, triggerConditions, before, after, summary? }

import { BaseAgent } from './base-agent.js';

const MAX_RESULT_CHARS = 400;

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

export class ReproductionEngineerAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'reproduction-engineer' });
    this.rolePrompt =
      'You are the reproduction-engineer agent of the CAST AI support swarm. You reproduce ' +
      'reported issues in a safe sandbox. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {scenario?: string|{id, params?}, issueCategory?: string}
   */
  async _run(task, ctx) {
    const scenario = task?.scenario
      ?? (task?.issueCategory ? `repro-${task.issueCategory}` : 'repro-generic');
    const id = typeof scenario === 'string' ? scenario : scenario?.id;
    const toolArgs = typeof scenario === 'string'
      ? { id: scenario }
      : { id: scenario?.id, ...(scenario?.params !== undefined ? { params: scenario.params } : {}) };

    const sandbox = ctx.adapters.sandbox;
    if (!sandbox) throw new Error('reproduction-engineer: sandbox adapter is required');
    const result = await sandbox.run(scenario);

    ctx.addEvidence({
      type: 'reproduction',
      source: `sandbox:${id}`,
      result: clipResult({ before: result.before, after: result.after, logs: result.logs ?? [] }),
      reference: id,
      reproduced: result.reproduced,
      toolRun: { tool: 'sandbox.run', args: toolArgs, ok: true },
    });

    const summary = await this._summarize(task, ctx, result);

    ctx.audit('reproduction_complete', `scenario '${id}' reproduced=${result.reproduced}`);

    const output = {
      scenario: id,
      reproduced: result.reproduced,
      triggerConditions: result.triggerConditions ?? [],
      before: result.before,
      after: result.after,
    };
    if (summary !== null) output.summary = summary;
    return output;
  }

  /** Brain summary is best-effort: any failure degrades to no summary. */
  async _summarize(task, ctx, result) {
    if (!ctx.brain) return null;
    try {
      const raw = await ctx.brain.complete(this.buildPrompt({
        instruction:
          'Summarize the sandbox reproduction run. Respond ONLY with JSON: {summary: string}.',
        scenario: task?.scenario ?? task?.issueCategory ?? 'repro-generic',
        result: {
          reproduced: result.reproduced,
          before: result.before,
          after: result.after,
          triggerConditions: result.triggerConditions ?? [],
        },
      }), { json: true });
      const parsed = JSON.parse(raw);
      return typeof parsed?.summary === 'string' ? parsed.summary : null;
    } catch {
      return null; // brain issues never fail a reproduction run
    }
  }
}
