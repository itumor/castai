// SupervisorAgent — pure planning (chunk 13).
//
// Builds an InvestigationPlan (spec §3) from the validated TriageFacts:
//  - agentSubset: routeToAgents(triage.issueCategory, triage) — specialist
//    keys only; verifier/support-writer are appended by the orchestrator.
//  - tasksPerAgent: one-line task per routed agent, derived from the triage
//    facts; openQuestions (re-investigation rounds after a verifier FAIL)
//    are folded into every task.
//  - missingInfoQuestions: from triage.missingInfo.
//
// No tool execution — the supervisor only plans.

import { BaseAgent } from './base-agent.js';
import { routeToAgents } from '../core/routing.js';

function taskFor(agentKey, { category, provider, summary, openQuestions }) {
  const base = {
    'docs-researcher':
      `Find KB documentation explaining the ${category} issue (provider ${provider}): ${summary}`,
    'sre-investigator':
      `Inspect cluster telemetry (nodes, utilization, autoscaler status, events) for the ${category} issue (provider ${provider}): ${summary}`,
    'reproduction-engineer':
      `Reproduce the ${category} issue (provider ${provider}): ${summary}`,
    'qa-engineer':
      `Design and run tests covering the ${category} issue (provider ${provider}): ${summary}`,
    'product-engineer':
      `Explain the product/implementation behavior behind the ${category} issue (provider ${provider}): ${summary}`,
    'cloud-security-engineer':
      `Analyze IAM/permissions implications of the ${category} issue (provider ${provider}): ${summary}`,
    'solution-architect':
      `Assess the fix architecture (rollout, rollback, interactions) for the ${category} issue (provider ${provider}): ${summary}`,
  }[agentKey] ?? `Investigate the ${category} issue (provider ${provider}): ${summary}`;

  if (openQuestions.length > 0) {
    return `${base} Re-investigation must also resolve: ${openQuestions.join('; ')}`;
  }
  return base;
}

export class SupervisorAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'supervisor' });
    this.rolePrompt =
      'You are the supervisor agent of the CAST AI support swarm. You plan investigations; ' +
      'you never execute tools. Respond ONLY with JSON when asked.';
  }

  /**
   * task: {triage: TriageFacts, openQuestions?: string[]}
   * output: {plan: InvestigationPlan}
   */
  async _run(task, ctx) {
    const triage = task?.triage;
    if (!triage || typeof triage !== 'object' || Array.isArray(triage)) {
      throw new Error('supervisor: task.triage (TriageFacts) is required');
    }

    // Throws on an unknown issueCategory → surfaces as ok:false AgentResult.
    const agentSubset = routeToAgents(triage.issueCategory, triage);

    const openQuestions = Array.isArray(task.openQuestions)
      ? task.openQuestions.filter((q) => typeof q === 'string' && q.length > 0)
      : [];
    const summary = `expected: ${triage.expected || 'n/a'}; actual: ${triage.actual || 'n/a'}`;
    const planInput = {
      category: triage.issueCategory,
      provider: triage.provider ?? 'unknown',
      summary,
      openQuestions,
    };

    const tasksPerAgent = {};
    for (const agentKey of agentSubset) {
      tasksPerAgent[agentKey] = taskFor(agentKey, planInput);
    }

    const missingInfoQuestions = Array.isArray(triage.missingInfo)
      ? [...triage.missingInfo]
      : [];

    ctx.audit('plan_built',
      `agents=[${agentSubset.join(',')}] openQuestions=${openQuestions.length}`);

    return { plan: { agentSubset, tasksPerAgent, missingInfoQuestions } };
  }
}
