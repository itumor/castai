// src/agents/supervisor.js — contract section 7 (supervisor agent).
//
// createSupervisor({ llm }): asks the llm for a plan, then CLAMPS the
// suggestion to PLAN_TEMPLATES[caseObj.triage.category] — the template both
// bounds and grounds the plan: unknown ids are dropped and the plan never
// returns fewer agents than the template. Stores caseObj.plan = { agents,
// rationale } (the only place 'plan' may be written, per AGENT_PERMISSIONS).

import { AGENT_PERMISSIONS } from '../core/policy.js';
import { jsonOnly } from '../core/llm.js';
import { record } from '../core/trace.js';
import { createAgent } from './base.js';
import { AGENT_IDS } from './registry.js';

/** Canonical per-category plan templates (contract section 7, verbatim). */
export const PLAN_TEMPLATES = {
  docs_question: ['researcher', 'verifier', 'writer'],
  node_downscale: ['sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge'],
  node_upscale: ['sre', 'researcher', 'repro', 'qa', 'architect', 'verifier', 'writer', 'knowledge'],
  iam_onboarding: ['sre', 'security', 'researcher', 'repro', 'verifier', 'writer', 'knowledge'],
  token_rotation: ['researcher', 'sre', 'architect', 'verifier', 'writer', 'knowledge'],
  workload_autoscaling: ['researcher', 'sre', 'product', 'verifier', 'writer', 'knowledge'],
  cost_reporting: ['researcher', 'product', 'qa', 'verifier', 'writer', 'knowledge'],
  spot: ['researcher', 'sre', 'verifier', 'writer', 'knowledge'],
  product_bug: [
    'sre',
    'researcher',
    'repro',
    'qa',
    'product',
    'architect',
    'security',
    'verifier',
    'writer',
    'escalation',
    'knowledge',
  ],
  billing: ['researcher', 'verifier', 'writer'],
  unknown: ['researcher', 'verifier', 'writer'],
};

export function createSupervisor({ llm } = {}) {
  return createAgent({
    id: 'supervisor',
    name: 'Supervisor',
    permissions: AGENT_PERMISSIONS.supervisor,
    async handler(ctx) {
      const { caseObj } = ctx;
      const category =
        caseObj.triage && typeof caseObj.triage.category === 'string'
          ? caseObj.triage.category
          : 'unknown';
      const template = PLAN_TEMPLATES[category] || PLAN_TEMPLATES.unknown;

      // Ask the llm for a plan (best-effort; the template decides regardless).
      let suggested = [];
      if (llm && typeof llm.complete === 'function') {
        record(caseObj, 'supervisor', 'plan.request', { category });
        const raw = await llm.complete({
          system:
            'You coordinate a CAST AI customer-support agent swarm. Plan which ' +
            'specialist agents should investigate this issue category and return ' +
            'JSON { "agents": [...] }.',
          prompt: `Plan agents for a '${category}' support case. Return JSON.`,
          json: true,
        });
        const parsed = jsonOnly(raw);
        suggested = Array.isArray(parsed.agents)
          ? parsed.agents.filter((a) => typeof a === 'string')
          : [];
      }

      // Clamp: intersect with the known roster for a sane trace note, then
      // take the template itself — ordered by the template, never fewer.
      const roster = new Set(AGENT_IDS);
      const recognised = [...new Set(suggested.filter((a) => roster.has(a)))];
      const agents = [...new Set(template)];

      const rationale =
        `Category '${category}' maps to the standard ${agents.length}-agent template ` +
        `(${agents.join(' -> ')}); ${recognised.length} llm-suggested agent(s) were ` +
        'clamped to that template so coverage never shrinks.';

      caseObj.plan = { agents, rationale };

      record(caseObj, 'supervisor', 'plan.created', {
        category,
        suggested: recognised,
        agents,
      });

      return { category, agents };
    },
  });
}
