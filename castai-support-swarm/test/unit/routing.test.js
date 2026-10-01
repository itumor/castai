import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_ROUTES, routeToAgents } from '../../src/core/routing.js';
import { PERMISSIONS } from '../../src/permissions.js';

// The 11 issueCategory values from src/core/types.js ISSUE_CATEGORIES.
const ALL_CATEGORIES = [
  'onboarding', 'node_upscale', 'node_downscale', 'rebalance',
  'workload_autoscaling', 'spot', 'cost_reporting', 'api', 'iam',
  'security', 'billing',
];

// Agents the orchestrator appends itself — the router must never return them.
const ORCHESTRATOR_APPENDED = new Set(['supervisor', 'verifier', 'support-writer']);

describe('CAPABILITY_ROUTES table', () => {
  test('has exactly the 11 issueCategory keys', () => {
    assert.deepEqual(Object.keys(CAPABILITY_ROUTES).sort(), [...ALL_CATEGORIES].sort());
  });

  test('every routed agent exists as a key in PERMISSIONS', () => {
    for (const [category, agents] of Object.entries(CAPABILITY_ROUTES)) {
      for (const agent of agents) {
        assert.ok(PERMISSIONS[agent], `${category} routes to unknown agent '${agent}'`);
      }
    }
  });

  test('no route includes supervisor/verifier/support-writer', () => {
    for (const [category, agents] of Object.entries(CAPABILITY_ROUTES)) {
      for (const agent of agents) {
        assert.ok(!ORCHESTRATOR_APPENDED.has(agent), `${category} must not route to '${agent}'`);
      }
    }
  });
});

describe('routeToAgents', () => {
  test('accept (1): all 11 categories return non-empty subsets containing docs-researcher', () => {
    for (const category of ALL_CATEGORIES) {
      const agents = routeToAgents(category);
      assert.ok(Array.isArray(agents) && agents.length > 0, `${category} returned empty route`);
      assert.ok(agents.includes('docs-researcher'), `${category} route must contain docs-researcher`);
    }
  });

  test('returns the verbatim specialist subset for each category', () => {
    assert.deepEqual(
      routeToAgents('iam'),
      ['docs-researcher', 'cloud-security-engineer', 'product-engineer']
    );
    assert.deepEqual(
      routeToAgents('node_upscale'),
      ['docs-researcher', 'sre-investigator', 'reproduction-engineer', 'qa-engineer', 'solution-architect']
    );
    assert.deepEqual(
      routeToAgents('node_downscale'),
      ['docs-researcher', 'sre-investigator', 'reproduction-engineer', 'qa-engineer', 'solution-architect']
    );
    assert.deepEqual(
      routeToAgents('rebalance'),
      ['docs-researcher', 'sre-investigator', 'reproduction-engineer', 'qa-engineer', 'solution-architect']
    );
    assert.deepEqual(
      routeToAgents('cost_reporting'),
      ['docs-researcher', 'product-engineer', 'sre-investigator']
    );
    assert.deepEqual(
      routeToAgents('billing'),
      ['docs-researcher', 'product-engineer', 'sre-investigator']
    );
    assert.deepEqual(
      routeToAgents('onboarding'),
      ['docs-researcher', 'cloud-security-engineer', 'product-engineer', 'sre-investigator']
    );
    assert.deepEqual(
      routeToAgents('workload_autoscaling'),
      ['docs-researcher', 'sre-investigator', 'qa-engineer', 'solution-architect']
    );
    assert.deepEqual(
      routeToAgents('api'),
      ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer']
    );
    assert.deepEqual(
      routeToAgents('security'),
      ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer']
    );
    assert.deepEqual(
      routeToAgents('spot'),
      ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer']
    );
  });

  test('base mapping is by category; triageFacts accepted but do not change it', () => {
    assert.deepEqual(
      routeToAgents('spot', { provider: 'eks', mode: 'production', confidence: 0.9 }),
      routeToAgents('spot')
    );
  });

  test('returns a fresh copy — mutating result does not corrupt the table', () => {
    const route = routeToAgents('api');
    route.push('qa-engineer');
    assert.deepEqual(
      routeToAgents('api'),
      ['docs-researcher', 'product-engineer', 'sre-investigator', 'cloud-security-engineer']
    );
  });

  test('unknown issueCategory throws', () => {
    assert.throws(() => routeToAgents('pod_crash'), /unknown issueCategory 'pod_crash'/);
  });
});
