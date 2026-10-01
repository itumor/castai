// SupportWriterAgent — customer reply composer (chunk 14b).
//
// Composes the reply from verifier-PASSED claims only, plus the customer
// question, first name and the confidence route. The draft body is linted
// with the deterministic claim-honesty linter before acceptance; on
// violations the agent retries ONCE with the violations fed back into the
// prompt. A second lint failure throws (execute → ok:false).
//
// This agent never touches any tool adapter: its permission row is
// draft-only and the BaseAgent proxy throws PermissionError on any castai/
// k8s/kb/sandbox access. The orchestrator (chunk 15) owns the actual
// DraftSink write; this agent only produces the DraftPost object.

import { BaseAgent } from './base-agent.js';
import { lintDraft } from '../core/claim-linter.js';
import { validateDraftPost } from '../core/types.js';

const VERIFIED_CLASSIFICATIONS = new Set([
  'DOCUMENTED',
  'CODE-CONFIRMED',
  'TEST-CONFIRMED',
  'ENVIRONMENT-CONFIRMED',
]);

const DRAFT_TAG = 'support-writer:draft';
const RETRY_TAG = 'support-writer:draft-retry';

function violationsSummary(violations) {
  return violations.map((v) => `"${v.phrase}": ${v.message}`).join('; ');
}

export class SupportWriterAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'support-writer' });
    this.rolePrompt =
      'You are the support-writer agent of the CAST AI support swarm. You write honest, ' +
      'evidence-grounded customer replies. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {verdict, route, to, subject}
   * output: {draft: {to, subject, body, caseId, confidence, route, unresolvedClaims}}
   */
  async _run(task, ctx) {
    const ledger = ctx.ledger;
    const verdict = task?.verdict;
    if (!verdict || !Array.isArray(verdict.claims)) {
      throw new Error('support-writer: task.verdict with a claims array is required');
    }
    if (typeof task.to !== 'string' || task.to.length === 0 || typeof task.subject !== 'string' || task.subject.length === 0) {
      throw new Error('support-writer: task.to and task.subject must be non-empty strings');
    }
    const passedClaims = verdict.claims.filter((c) => VERIFIED_CLASSIFICATIONS.has(c.classification));
    if (passedClaims.length === 0) {
      throw new Error('support-writer: no verifier-passed claims to compose a reply from');
    }
    const unresolvedClaims = verdict.claims
      .filter((c) => !VERIFIED_CLASSIFICATIONS.has(c.classification))
      .map((c) => c.claim);

    const promptTask = {
      instruction:
        'Write the customer reply body. Use ONLY the passed claims; never invent reproduction, ' +
        'test or confirmation statements that the ledger does not back. Avoid AI clichés. ' +
        'Respond ONLY with JSON: {body: string}.',
      passedClaims,
      unresolvedClaims,
      customerQuestion: ledger?.customerQuestion ?? [],
      customerFirstName: ledger?.customerFirstName ?? 'there',
      route: task.route ?? null,
      to: task.to,
      subject: task.subject,
    };

    // First attempt.
    let body = await this._requestBody(promptTask, ctx, DRAFT_TAG);
    let lint = lintDraft(body, ledger);
    if (!lint.ok) {
      // ONE retry with the violations fed back into the prompt.
      const retryTask = {
        ...promptTask,
        instruction:
          'Your previous draft violated the claim-honesty rules. Rewrite the reply body fixing ' +
          'EVERY violation listed in lintViolations (they are fatal). Respond ONLY with JSON: {body: string}.',
        lintViolations: lint.violations,
      };
      body = await this._requestBody(retryTask, ctx, RETRY_TAG);
      lint = lintDraft(body, ledger);
      if (!lint.ok) {
        throw new Error(`support-writer: draft failed lint after retry: ${violationsSummary(lint.violations)}`);
      }
    }

    const draft = {
      to: task.to,
      subject: `Re: ${task.subject}`,
      body,
      caseId: ledger?.caseId ?? '',
      confidence: ledger?.confidence,
      route: task.route,
      unresolvedClaims,
    };
    const validation = validateDraftPost(draft);
    if (!validation.ok) {
      throw new Error(`support-writer: invalid draft post: ${validation.errors.join('; ')}`);
    }
    ctx.audit('draft_composed', `lint ${lint.ok ? 'ok' : 'failed'}; route=${task.route}; unresolved=${unresolvedClaims.length}`);
    return { draft };
  }

  /**
   * Ask the brain for the reply body. Accepts {body} JSON or a bare text
   * response (used verbatim as the body).
   */
  async _requestBody(promptTask, ctx, tag) {
    const raw = await ctx.brain.complete(this.buildPrompt(promptTask), { json: true, tag });
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed.body === 'string') return parsed.body;
      throw new Error('support-writer: brain JSON must be {body: string}');
    } catch (err) {
      if (err instanceof SyntaxError) return String(raw).trim(); // plain-text brain response
      throw err;
    }
  }
}
