// tests/agents/qa.test.js — contract section 7 (src/agents/qa.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQa } from '../../src/agents/qa.js';
import { createRepro } from '../../src/agents/repro.js';
import { createSre } from '../../src/agents/sre.js';
import {
  createCase,
  addClaim,
  linkEvidenceToClaim,
  claimClasses,
} from '../../src/core/model.js';
import * as lab from '../../src/tools/lab.js';

const PDB_SPEC = {
  nodes: [{ name: 'ip-10-0-1-10' }],
  pods: [{ name: 'web-7d9f6b4c-x1', node: 'ip-10-0-1-10', pdbProtected: true }],
};

function makeCase(category = 'node_downscale') {
  const caseObj = createCase({
    id: 'case-qa',
    thread: {
      from: 'Jane Doe <jane@example.com>',
      subject: 'nodes not scaling down',
      messages: [{ from: 'jane@example.com', date: '2026-01-01', body: 'nodes are stuck' }],
    },
    customer: { name: 'Jane Doe', email: 'jane@example.com', orgId: 'org-1', clusterId: 'clu-1' },
  });
  caseObj.triage = { category };
  return caseObj;
}

function runQa(caseObj, tools = {}) {
  const agent = createQa({ tools });
  return agent.run({ caseObj, repoRoot: '.', params: {} });
}

// Builds a case whose ledger already contains repro's REPRODUCED evidence the
// honest way: by running the sre + repro agents against the PDB lab spec.
async function caseWithReproProof() {
  const caseObj = makeCase('node_downscale');
  await createSre({ tools: { lab } }).run({ caseObj, repoRoot: '.', params: { simSpec: PDB_SPEC } });
  await createRepro({ tools: { lab } }).run({ caseObj, repoRoot: '.', params: { simSpec: PDB_SPEC } });
  return caseObj;
}

test('createQa returns the contract agent shape', () => {
  const agent = createQa({ llm: null, tools: {} });
  assert.equal(agent.id, 'qa');
  assert.equal(typeof agent.name, 'string');
  assert.equal(typeof agent.run, 'function');
});

test('reproduction proof marks e2e passed and adds TEST_CONFIRMED e2e_test evidence', async () => {
  const caseObj = await caseWithReproProof();
  const result = await runQa(caseObj);

  assert.equal(caseObj.tests.e2e, 'passed');
  assert.equal(caseObj.tests.unit, 'not_run');
  assert.equal(caseObj.tests.integration, 'not_run');
  assert.equal(caseObj.tests.regression, 'not_run');
  assert.deepEqual(result.tests, caseObj.tests);

  const evidence = caseObj.evidence.find((e) => e.type === 'e2e_test');
  assert.ok(evidence, 'expected e2e_test evidence');
  assert.equal(evidence.agentId, 'qa');
  assert.ok(evidence.summary.includes('Reproduced') || evidence.summary.includes('proof'));

  const claim = addClaim(caseObj, { statement: 'The fix was verified end to end' });
  linkEvidenceToClaim(caseObj, claim.id, evidence.id);
  assert.ok(claimClasses(caseObj, claim.id).includes('TEST_CONFIRMED'));
});

test('without reproduction proof every level stays not_run and nothing is claimed', async () => {
  const caseObj = makeCase('node_downscale');
  const result = await runQa(caseObj);

  assert.deepEqual(caseObj.tests, {
    unit: 'not_run',
    integration: 'not_run',
    e2e: 'not_run',
    regression: 'not_run',
  });
  assert.deepEqual(result.tests, caseObj.tests);
  assert.equal(caseObj.evidence.length, 0);
  assert.ok(
    caseObj.trace.some((t) => t.actor === 'qa' && t.action === 'qa.no-reproduction'),
  );
});

test('a provided tools.testRunner is used and its results land on the tests ledger', async () => {
  const caseObj = makeCase('node_downscale');
  const testRunner = {
    async run() {
      return { unit: 'passed', integration: 'passed', e2e: 'passed', summary: '12 tests green' };
    },
  };
  const result = await runQa(caseObj, { testRunner });

  assert.equal(caseObj.tests.unit, 'passed');
  assert.equal(caseObj.tests.integration, 'passed');
  assert.equal(caseObj.tests.e2e, 'passed');
  assert.equal(caseObj.tests.regression, 'not_run');
  assert.deepEqual(result.tests, caseObj.tests);

  const evidence = caseObj.evidence.find((e) => e.type === 'e2e_test');
  assert.ok(evidence);
  assert.equal(evidence.source, 'test-runner');
  assert.ok(evidence.summary.includes('12 tests green'));
  // Honesty marker: a real runner executed — the summary says so.
  assert.match(evidence.summary, /test runner executed/);
});

test('lab-only proof is MARKED lab-simulated — the reader can never mistake it for a real runner', async () => {
  const caseObj = await caseWithReproProof();
  await runQa(caseObj); // no testRunner supplied
  const evidence = caseObj.evidence.find((e) => e.type === 'e2e_test');
  assert.ok(evidence, 'expected e2e_test evidence');
  assert.match(evidence.summary, /lab-simulated/);
  assert.match(evidence.summary, /no external test runner executed/);
  assert.notEqual(evidence.source, 'test-runner');
});

test('a failing e2e run from the testRunner is recorded honestly, not claimed', async () => {
  const caseObj = makeCase('node_downscale');
  const testRunner = { async run() { return { e2e: 'failed' }; } };
  await runQa(caseObj, { testRunner });

  assert.equal(caseObj.tests.e2e, 'failed');
  assert.equal(caseObj.evidence.filter((e) => e.type === 'e2e_test').length, 0);
});

test('records start and completion on the trace', async () => {
  const caseObj = await caseWithReproProof();
  await runQa(caseObj);

  const mine = caseObj.trace.filter((t) => t.actor === 'qa');
  const actions = mine.map((t) => t.action);
  assert.ok(actions.includes('qa.start'));
  assert.ok(actions.includes('qa.complete'));
});
