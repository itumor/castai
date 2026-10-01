// Capability routing table (spec §4, verbatim).
// Maps issueCategory → specialist agent subsets.
// `verifier` and `support-writer` are always appended by the orchestrator,
// never returned by the router.

export const CAPABILITY_ROUTES = Object.freeze({
  'iam':                  ['docs-researcher', 'cloud-security-engineer', 'product-engineer'],
  'node_upscale':         ['docs-researcher', 'sre-investigator', 'reproduction-engineer', 'qa-engineer', 'solution-architect'],
  'node_downscale':       ['docs-researcher', 'sre-investigator', 'reproduction-engineer', 'qa-engineer', 'solution-architect'],
  'rebalance':            ['docs-researcher', 'sre-investigator', 'reproduction-engineer', 'qa-engineer', 'solution-architect'],
  'cost_reporting':       ['docs-researcher', 'product-engineer', 'sre-investigator'],
  'billing':              ['docs-researcher', 'product-engineer', 'sre-investigator'],
  'onboarding':           ['docs-researcher', 'cloud-security-engineer', 'product-engineer', 'sre-investigator'],
  'workload_autoscaling': ['docs-researcher', 'sre-investigator', 'qa-engineer', 'solution-architect'],
  'api':                  ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer'],
  'security':             ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer'],
  'spot':                 ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer'],
});

/**
 * Returns the specialist agent keys for `issueCategory`.
 * `triageFacts` may refine routing in future, but the base mapping is by
 * category. Never includes supervisor/verifier/support-writer (the
 * orchestrator appends those). Throws on an unknown category.
 */
export function routeToAgents(issueCategory, triageFacts) {
  void triageFacts; // accepted for signature compatibility; base mapping is category-only
  const route = CAPABILITY_ROUTES[issueCategory];
  if (!route) {
    throw new Error(`routeToAgents: unknown issueCategory '${issueCategory}'`);
  }
  return [...route];
}
