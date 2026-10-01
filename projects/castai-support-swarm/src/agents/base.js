// src/agents/base.js — shared agent factory (contract section 7).
//
// TWO deliberate construction styles exist in this swarm (contract §7):
//   a) triage, supervisor and researcher are built via createAgent() — the
//      wrapper guarantees the two cross-cutting behaviours below;
//   b) the remaining agents hand-roll run() with the SAME obligations
//      (record() for every meaningful action, assertToolAllowed() before any
//      tool touch), because their tool use is conditional (e.g. qa uses the
//      testRunner only when the orchestrator provides one; security uses kb
//      only for iam_* categories). Every agent's run() therefore records its
//      own start/complete/heartbeat records explicitly.
// The wrapper guarantees:
//   1. run() records 'agent.start' / 'agent.end' on the case trace
//      (via src/core/trace.js record(), which redacts details first).
//   2. Tools are reachable only through the guarded `useTool` helper, which
//      routes through assertToolAllowed() — so an agent physically cannot
//      touch a tool that AGENT_PERMISSIONS does not list for its id.
//
// Safety (root AGENTS.md): this helper adds no capability of its own; it only
// narrows what agent handlers can reach. Read-only posture is preserved.

import { AGENT_PERMISSIONS, assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';

/**
 * createAgent({ id, name, permissions, handler }) -> agent
 *
 * id:          agent id — must match a key of AGENT_PERMISSIONS for the
 *              permission guard to resolve (policy.js).
 * name:        human-readable display name (defaults to id).
 * permissions: defaults to AGENT_PERMISSIONS[id]; callers may pass an
 *              explicit mirror when building composite agents.
 * handler:     async (ctx, helpers) => short structured result.
 *              ctx = { caseObj, repoRoot, params = {}, ... }.
 *              helpers.useTool(toolName) asserts the agent may use that tool
 *              (throws PolicyError otherwise) and returns the tool name.
 *
 * Returned agent: { id, name, permissions, async run(ctx) }.
 */
export function createAgent({ id, name, permissions, handler } = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('createAgent: a non-empty string id is required');
  }
  if (typeof handler !== 'function') {
    throw new Error(`createAgent('${id}'): handler must be a function`);
  }

  const agent = {
    id,
    name: name || id,
    // Mirror the policy table by default so callers/tests can inspect what
    // this agent is allowed to do without importing policy.js themselves.
    permissions: permissions || AGENT_PERMISSIONS[id] || { tools: [] },

    async run(ctx = {}) {
      const caseObj = ctx.caseObj;
      if (!caseObj || typeof caseObj !== 'object') {
        throw new Error(`Agent '${agent.id}' requires a case object at ctx.caseObj`);
      }

      record(caseObj, agent.id, 'agent.start', { name: agent.name });

      const helpers = {
        /**
         * Guard a tool before touching it. Throws PolicyError when
         * AGENT_PERMISSIONS[agent.id] does not list the tool name.
         */
        useTool(toolName) {
          assertToolAllowed(agent.id, toolName);
          return toolName;
        },
      };

      try {
        const result = await handler(ctx, helpers);
        const detail = { ok: true };
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          detail.resultKeys = Object.keys(result).sort();
        }
        record(caseObj, agent.id, 'agent.end', detail);
        return result;
      } catch (error) {
        record(caseObj, agent.id, 'agent.end', {
          ok: false,
          error: String((error && error.message) || error),
        });
        throw error;
      }
    },
  };

  return agent;
}
