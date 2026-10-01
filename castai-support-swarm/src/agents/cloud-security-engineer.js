// CloudSecurityEngineerAgent — investigation-side specialist (chunk 14a).
//
// IAM/permission analysis for task.focus (e.g. 'iam:PutRolePolicy 403'):
//  1. Optional CAST AI context: when task.clusterId is present, reads
//     get_cluster_details via the read-only CastaiTools adapter. Best-effort —
//     an unavailable adapter or failing call never fails the run.
//  2. KB search + read for the focus string (top hit).
//  3. The brain (json mode) produces the permission analysis and fix
//     statement: {analysis, requiredPermissions, fixStatement, confirmed}.
//  4. Appends `documentation` evidence for the KB hit and, when the brain
//     confirms the fix, `code` evidence for the permission fix — both
//     reference the KB path.
//
// Output: { analysis, requiredPermissions, evidenceIds }

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

/** Parse a brain JSON response, throwing a readable error on non-JSON. */
function parseBrainJson(raw, who) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${who}: brain returned non-JSON response: ${String(raw).slice(0, 200)}`);
  }
}

export class CloudSecurityEngineerAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'cloud-security-engineer' });
    this.rolePrompt =
      'You are the cloud-security-engineer agent of the CAST AI support swarm. You analyze ' +
      'IAM and permission issues and prescribe least-privilege fixes. Respond ONLY with JSON.';
  }

  /**
   * task: {focus: string, clusterId?: string, categoryHint?: string}
   */
  async _run(task, ctx) {
    const focus = task?.focus;
    if (!focus) throw new Error('cloud-security-engineer: task.focus is required');
    const kb = ctx.adapters.kb;
    if (!kb) throw new Error('cloud-security-engineer: kb adapter is required');

    const evidenceIds = [];

    // (1) optional cluster context (best-effort, tolerated to fail).
    let clusterContext = null;
    if (task.clusterId) {
      try {
        const castai = ctx.adapters.castai;
        if (!castai) throw new Error('castai adapter unavailable');
        clusterContext = await castai.call('get_cluster_details', { clusterId: task.clusterId });
      } catch {
        clusterContext = null;
      }
    }

    // (2) KB grounding for the focus string.
    const hits = await kb.search({ query: focus, categoryHint: task.categoryHint });
    let doc = null;
    const top = hits[0];
    if (top) {
      const read = await kb.read(top.path);
      doc = {
        path: top.path,
        excerpt: top.excerpt ?? '',
        content: typeof read === 'string' ? read : (read?.content ?? ''),
      };
    }

    // (3) brain analysis + permission fix statement.
    const raw = await ctx.brain.complete(this.buildPrompt({
      instruction:
        'Analyze the reported permission issue from the KB material in the ledger. Respond ONLY ' +
        'with JSON: {analysis: string, requiredPermissions: string[], fixStatement: string, ' +
        'confirmed: boolean}. confirmed=true only when the fix is backed by KB material.',
      focus,
      clusterContext,
    }), { json: true });
    const parsed = parseBrainJson(raw, 'cloud-security-engineer');
    const analysis = typeof parsed?.analysis === 'string' ? parsed.analysis : '';
    const requiredPermissions = Array.isArray(parsed?.requiredPermissions)
      ? parsed.requiredPermissions.filter((p) => typeof p === 'string')
      : [];

    // (4) evidence: documentation for the KB hit; code for the confirmed fix.
    if (doc) {
      const docEntry = ctx.addEvidence({
        type: 'documentation',
        source: `kb:${doc.path}`,
        result: clipResult({ focus, excerpt: doc.excerpt, content: doc.content }),
        reference: doc.path,
      });
      evidenceIds.push(docEntry.id);
      if (parsed?.confirmed === true) {
        const codeEntry = ctx.addEvidence({
          type: 'code',
          source: `kb:${doc.path}`,
          result: clipResult({
            focus,
            fixStatement: parsed.fixStatement ?? '',
            requiredPermissions,
          }),
          reference: doc.path,
        });
        evidenceIds.push(codeEntry.id);
      }
    }

    ctx.audit('security_analysis_complete',
      `${requiredPermissions.length} required permissions identified` +
      (doc ? ` (grounded in ${doc.path})` : ' (no KB grounding found)'));

    return { analysis, requiredPermissions, evidenceIds };
  }
}
