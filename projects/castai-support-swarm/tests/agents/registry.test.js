// tests/agents/registry.test.js — src/agents/registry.js.
// Verifies the 13 agent ids, the issue category list, the registry shape, and
// that each entry mirrors AGENT_PERMISSIONS. Cross-checks activateWhen against
// PLAN_TEMPLATES from supervisor.js so the two can never drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AGENT_IDS, AGENT_REGISTRY, ISSUE_CATEGORIES } from '../../src/agents/registry.js';
import { AGENT_PERMISSIONS } from '../../src/core/policy.js';
import { PLAN_TEMPLATES } from '../../src/agents/supervisor.js';
import { ALL_AGENTS } from '../../src/agents/index.js';

const EXPECTED_IDS = [
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

const EXPECTED_CATEGORIES = [
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

test('AGENT_IDS covers all 13 ids in contract order', () => {
  assert.deepEqual(AGENT_IDS, EXPECTED_IDS);
});

test('ISSUE_CATEGORIES matches the contract list exactly', () => {
  assert.deepEqual(ISSUE_CATEGORIES, EXPECTED_CATEGORIES);
});

test('AGENT_REGISTRY has one entry per id with the required shape', () => {
  assert.equal(AGENT_REGISTRY.length, 13);
  assert.deepEqual(
    AGENT_REGISTRY.map((entry) => entry.id),
    EXPECTED_IDS,
  );
  for (const entry of AGENT_REGISTRY) {
    assert.equal(typeof entry.name, 'string');
    assert.ok(entry.name.length > 0, `${entry.id} needs a name`);
    assert.equal(typeof entry.mission, 'string');
    assert.ok(entry.mission.length > 0, `${entry.id} needs a mission`);
    assert.ok(Array.isArray(entry.activateWhen), `${entry.id} needs activateWhen[]`);
    assert.ok(Object.keys(entry).length > 0);
  }
});

test('each registry entry mirrors AGENT_PERMISSIONS keys exactly', () => {
  for (const entry of AGENT_REGISTRY) {
    assert.equal(
      entry.permissions,
      AGENT_PERMISSIONS[entry.id],
      `permissions for '${entry.id}' must mirror core/policy.js`,
    );
  }
});

test('every activateWhen value is a valid issue category', () => {
  const categories = new Set(ISSUE_CATEGORIES);
  for (const entry of AGENT_REGISTRY) {
    for (const category of entry.activateWhen) {
      assert.ok(categories.has(category), `${entry.id} activates on unknown category '${category}'`);
    }
  }
});

test('activateWhen is consistent with PLAN_TEMPLATES membership', () => {
  // For every agent that appears in any plan template, its activateWhen set
  // must equal the set of categories whose template includes it.
  for (const [id, permissions] of Object.entries(AGENT_PERMISSIONS)) {
    const expected = EXPECTED_CATEGORIES.filter((category) =>
      (PLAN_TEMPLATES[category] || []).includes(id),
    );
    const entry = AGENT_REGISTRY.find((e) => e.id === id);
    const appearsAnywhere = expected.length > 0;
    if (appearsAnywhere) {
      assert.deepEqual(
        [...entry.activateWhen].sort(),
        [...expected].sort(),
        `activateWhen for '${id}' must mirror PLAN_TEMPLATES membership`,
      );
    } else {
      // supervisor and triage run before/outside plans: always active.
      assert.ok(
        id === 'supervisor' || id === 'triage',
        `agent '${id}' not in any template must be supervisor or triage`,
      );
      assert.deepEqual(
        [...entry.activateWhen].sort(),
        [...EXPECTED_CATEGORIES].sort(),
        `'${id}' activates on every category`,
      );
      void permissions;
    }
  }
});

test('researcher/verifier/writer activate on every category (omnipresent in plans)', () => {
  for (const id of ['researcher', 'verifier', 'writer']) {
    const entry = AGENT_REGISTRY.find((e) => e.id === id);
    assert.deepEqual([...entry.activateWhen].sort(), [...EXPECTED_CATEGORIES].sort());
  }
});

test('ALL_AGENTS factories mirror AGENT_IDS 1:1 and instantiate with the right id', () => {
  assert.deepEqual(Object.keys(ALL_AGENTS).sort(), [...AGENT_IDS].sort());
  for (const id of AGENT_IDS) {
    const agent = ALL_AGENTS[id]({});
    assert.ok(agent, `factory for '${id}' returns an agent`);
    assert.equal(agent.id, id, `factory for '${id}' produced agent id '${agent.id}'`);
    assert.equal(typeof agent.run, 'function');
  }
});
