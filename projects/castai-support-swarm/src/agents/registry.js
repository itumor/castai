// src/agents/registry.js — contract section 7 (registry).
//
// Static registry of the 13 agents: stable ids, display names, missions,
// permission mirrors (read from policy.js, never re-declared here), and the
// triage issue categories that activate each agent. `activateWhen` mirrors
// PLAN_TEMPLATES in supervisor.js (every category where the agent appears);
// tests/agents/registry.test.js cross-checks the two stay in sync.

import { AGENT_PERMISSIONS } from '../core/policy.js';

/** Stable agent ids, in canonical order (contract section 7). */
export const AGENT_IDS = [
  'supervisor',
  'triage',
  'researcher',
  'sre',
  'repro',
  'qa',
  'product',
  'architect',
  'security',
  'verifier',
  'writer',
  'escalation',
  'knowledge',
];

/** Issue categories produced by triage (contract section 7). */
export const ISSUE_CATEGORIES = [
  'docs_question',
  'node_downscale',
  'node_upscale',
  'iam_onboarding',
  'workload_autoscaling',
  'cost_reporting',
  'spot',
  'token_rotation',
  'product_bug',
  'billing',
  'unknown',
];

const ALL_CATEGORIES = [...ISSUE_CATEGORIES];

// Categories where the agent appears in PLAN_TEMPLATES (supervisor.js).
// Supervisor and triage always run before any plan, so they activate on all.
const DEFINITIONS = {
  supervisor: {
    name: 'Supervisor',
    mission:
      'Builds the case plan from the triage category and dispatches specialist ' +
      'agents, clamped to PLAN_TEMPLATES so coverage never shrinks.',
    activateWhen: ALL_CATEGORIES,
  },
  triage: {
    name: 'Triage Analyst',
    mission:
      'Reads the incoming thread and classifies it: category, cloud provider, ' +
      'platform, CAST AI mode, severity, entities, customer name and open questions.',
    activateWhen: ALL_CATEGORIES,
  },
  researcher: {
    name: 'KB Researcher',
    mission:
      'Searches the knowledge base for each triage question and records every ' +
      'source found as evidence linked to a claim (with the source path as ref).',
    activateWhen: ALL_CATEGORIES,
  },
  sre: {
    name: 'SRE Investigator',
    mission:
      'Investigates the customer environment (kubectl reads, CAST AI read-only ' +
      'API, deterministic lab) with a per-category checklist; opens hypotheses ' +
      'and records environment evidence.',
    activateWhen: [
      'node_downscale',
      'node_upscale',
      'iam_onboarding',
      'token_rotation',
      'workload_autoscaling',
      'spot',
      'product_bug',
    ],
  },
  repro: {
    name: 'Repro Engineer',
    mission:
      'Reproduces the top hypothesis in the deterministic cluster lab, applies ' +
      'the candidate fix, and confirms or rejects hypotheses with reproduction evidence.',
    activateWhen: ['node_downscale', 'node_upscale', 'iam_onboarding', 'product_bug'],
  },
  qa: {
    name: 'QA Engineer',
    mission:
      'Runs the test runner (or simulates test levels from lab results) and ' +
      'records e2e_test evidence for verified behaviour.',
    activateWhen: ['node_downscale', 'node_upscale', 'cost_reporting', 'product_bug'],
  },
  product: {
    name: 'Product SME',
    mission:
      'Scans the local CAST AI sources for the code paths behind a product or ' +
      'billing question and records source_code evidence with file refs.',
    activateWhen: ['workload_autoscaling', 'cost_reporting', 'product_bug'],
  },
  architect: {
    name: 'Solution Architect',
    mission:
      'Composes hypotheses and evidence into a proposed solution with ordered ' +
      'steps and rollback/alternative guidance.',
    activateWhen: ['node_downscale', 'node_upscale', 'token_rotation', 'product_bug'],
  },
  security: {
    name: 'Security Reviewer',
    mission:
      'Reviews IAM and security aspects for least privilege (write permissions ' +
      'must come from the approved Terraform path) and appends risk notes.',
    activateWhen: ['iam_onboarding', 'product_bug'],
  },
  verifier: {
    name: 'Verifier',
    mission:
      'Strict gate: a claim passes only with hard proof (environment, code, ' +
      'test or reproduction) or two independent documented sources. Sets the verdict.',
    activateWhen: ALL_CATEGORIES,
  },
  writer: {
    name: 'Reply Writer',
    mission:
      'Drafts the customer reply from grounded claims only — greeting, what was ' +
      'checked/found, one next step — and passes the reply guard.',
    activateWhen: ALL_CATEGORIES,
  },
  escalation: {
    name: 'Escalation Packager',
    mission:
      'Packages the full case (problem, hypotheses, evidence index, repro, ' +
      'tests, customer impact) into an escalation document for engineering.',
    activateWhen: ['product_bug'],
  },
  knowledge: {
    name: 'Knowledge Curator',
    mission:
      'Writes a reusable KB note from a resolved case (problem, detection ' +
      'signals, resolution, checklist) so future triage starts from precedent.',
    activateWhen: [
      'node_downscale',
      'node_upscale',
      'iam_onboarding',
      'token_rotation',
      'workload_autoscaling',
      'cost_reporting',
      'spot',
      'product_bug',
    ],
  },
};

/**
 * AGENT_REGISTRY — [{ id, name, mission, permissions, activateWhen }].
 * `permissions` mirrors AGENT_PERMISSIONS[id] from core/policy.js exactly;
 * `activateWhen` lists the triage issue categories that activate the agent.
 */
export const AGENT_REGISTRY = AGENT_IDS.map((id) => ({
  id,
  name: DEFINITIONS[id].name,
  mission: DEFINITIONS[id].mission,
  permissions: AGENT_PERMISSIONS[id],
  activateWhen: [...DEFINITIONS[id].activateWhen],
}));
