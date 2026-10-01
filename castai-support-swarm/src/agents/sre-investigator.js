// SreInvestigatorAgent — investigation-side specialist (chunk 14a).
//
// Collects environment telemetry for the case cluster:
//  1. CAST AI MCP read-only tools: get_cluster_nodes, get_cluster_utilization,
//     get_workload_autoscaler_status, get_recent_optimization_actions — each
//     called with { clusterId } (toolRun.args.clusterId is the case-cluster
//     linkage used by the scorer/verifier).
//  2. K8sClient.get('pods') / get('events') when task.podFacts is requested.
//  3. Each successful adapter call becomes `telemetry` evidence with a toolRun
//     (source "mcp:<toolName>" or "kubectl:<method>", result clipped to 400
//     chars). Failures (missing tool, transport error, absent adapter) are
//     tolerated: recorded as ok:false toolRuns in the output, never thrown.
//  4. The brain (json mode) votes on each task.hypotheses entry; resolved
//     votes (confirmed/rejected) update the hypothesis via setHypothesisStatus
//     with the supporting evidence ids. Inconclusive votes leave it open.
//
// Output: { hypothesisVotes: [{id, vote, reason}], toolRuns: [{tool, args, ok, error?}] }

import { setHypothesisStatus } from '../core/ledger.js';
import { BaseAgent } from './base-agent.js';

const CASTAI_TOOLS = Object.freeze([
  'get_cluster_nodes',
  'get_cluster_utilization',
  'get_workload_autoscaler_status',
  'get_recent_optimization_actions',
]);

const MAX_RESULT_CHARS = 400;

/** JSON.stringify a result and clip to maxLen chars (ellipsis included). */
function clipResult(result, maxLen = MAX_RESULT_CHARS) {
  let s;
  try {
    s = JSON.stringify(result);
    if (s === undefined) s = String(result);
  } catch {
    s = String(result);
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

export class SreInvestigatorAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'sre-investigator' });
    this.rolePrompt =
      'You are the sre-investigator agent of the CAST AI support swarm. You collect cluster ' +
      'telemetry and vote on hypotheses from observed facts. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {clusterId, podFacts?: boolean, k8sOpts?: {pods?: object, events?: object},
   *        hypotheses?: [{id, statement}]}
   */
  async _run(task, ctx) {
    const clusterId = task?.clusterId;
    if (!clusterId) throw new Error('sre-investigator: task.clusterId is required');

    const toolRuns = [];
    const runEvidenceIds = [];

    // (1) CAST AI MCP read-only sequence. Every call is independent: a failure
    // is recorded as an ok:false toolRun instead of crashing the run.
    for (const toolName of CASTAI_TOOLS) {
      const args = { clusterId, ...(task.toolArgs?.[toolName] ?? {}) };
      await this._safeTelemetry(ctx, {
        source: `mcp:${toolName}`,
        reference: `${toolName}(${JSON.stringify(args)})`,
        toolRun: { tool: toolName, args },
        runEvidenceIds,
        toolRuns,
        attempt: async () => {
          const castai = ctx.adapters.castai;
          if (!castai) throw new Error('castai adapter unavailable');
          return await castai.call(toolName, args);
        },
      });
    }

    // (2) Pod-level facts via kubectl when the task asks for them.
    if (task.podFacts) {
      for (const kind of ['pods', 'events']) {
        const opts = task.k8sOpts?.[kind] ?? {};
        await this._safeTelemetry(ctx, {
          source: 'kubectl:get',
          reference: `get(${JSON.stringify({ kind, ...opts })})`,
          toolRun: { tool: 'kubectl.get', args: { kind, ...opts } },
          runEvidenceIds,
          toolRuns,
          attempt: async () => {
            const k8s = ctx.adapters.k8s;
            if (!k8s) throw new Error('k8s adapter unavailable');
            return await k8s.get(kind, opts);
          },
        });
      }
    }

    // (4) Brain votes on the task's hypotheses.
    const hypothesisVotes = await this._voteHypotheses(task, ctx, runEvidenceIds);

    ctx.audit(
      'sre_investigation_complete',
      `${runEvidenceIds.length} telemetry evidence entries, ` +
      `${toolRuns.filter((t) => !t.ok).length} failed tool calls`
    );

    return { hypothesisVotes, toolRuns };
  }

  /**
   * Run one telemetry attempt. Success → telemetry evidence (toolRun ok:true).
   * Failure → ok:false toolRun in the output, no ledger evidence, no throw.
   */
  async _safeTelemetry(ctx, { source, reference, toolRun, runEvidenceIds, toolRuns, attempt }) {
    try {
      const result = await attempt();
      const entry = ctx.addEvidence({
        type: 'telemetry',
        source,
        result: clipResult(result),
        reference,
        toolRun: { ...toolRun, ok: true },
      });
      runEvidenceIds.push(entry.id);
      toolRuns.push({ ...toolRun, ok: true });
    } catch (err) {
      toolRuns.push({ ...toolRun, ok: false, error: String(err?.message ?? err) });
    }
  }

  /**
   * Ask the brain (json mode) to vote on each task.hypotheses entry using the
   * telemetry now in the ledger. Resolved votes (confirmed/rejected) update
   * the hypothesis status with supporting evidence ids; unknown hypothesis
   * ids and inconclusive votes are tolerated without crashing.
   */
  async _voteHypotheses(task, ctx, runEvidenceIds) {
    const hypotheses = Array.isArray(task?.hypotheses) ? task.hypotheses : [];
    if (hypotheses.length === 0 || !ctx.brain) return [];

    const promptTask = {
      instruction:
        'Vote on each hypothesis against the collected telemetry in the ledger. Respond ONLY ' +
        'with JSON: {votes: [{id, vote: "confirmed"|"rejected"|"inconclusive", reason, ' +
        'evidenceIds?}]}. Cite evidence ids that support the vote.',
      clusterId: task.clusterId,
      hypotheses,
    };
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true });
    const parsed = parseBrainJson(raw, 'sre-investigator');
    const votes = Array.isArray(parsed?.votes) ? parsed.votes : [];

    const evidenceIdSet = new Set((ctx.ledger?.evidence ?? []).map((e) => e.id));
    const resolved = [];
    for (const vote of votes) {
      const normalized = { id: vote?.id, vote: vote?.vote, reason: vote?.reason ?? '' };
      resolved.push(normalized);
      if (normalized.vote !== 'confirmed' && normalized.vote !== 'rejected') continue; // inconclusive stays open
      const hypothesis = ctx.ledger?.hypotheses?.find((h) => h.id === normalized.id);
      if (!hypothesis) continue; // tolerate votes for hypothesis ids absent from the ledger
      const evidenceIds = (Array.isArray(vote.evidenceIds) ? vote.evidenceIds : runEvidenceIds)
        .filter((id) => evidenceIdSet.has(id));
      setHypothesisStatus(ctx.ledger, normalized.id, normalized.vote, evidenceIds);
    }
    return resolved;
  }
}
