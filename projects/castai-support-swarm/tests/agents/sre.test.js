// tests/agents/sre.test.js — contract section 7 (src/agents/sre.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSre } from '../../src/agents/sre.js';
import {
  createCase,
  addClaim,
  linkEvidenceToClaim,
  claimClasses,
} from '../../src/core/model.js';
import * as lab from '../../src/tools/lab.js';

function makeCase(category = 'node_downscale') {
  const caseObj = createCase({
    id: 'case-sre',
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

const PDB_SPEC = {
  nodes: [{ name: 'ip-10-0-1-10' }],
  pods: [{ name: 'web-7d9f6b4c-x1', node: 'ip-10-0-1-10', pdbProtected: true }],
};

function runSre(caseObj, params = {}) {
  const agent = createSre({ tools: { lab } });
  return agent.run({ caseObj, repoRoot: '.', params });
}

test('createSre returns the contract agent shape', () => {
  const agent = createSre({ llm: null, tools: { lab } });
  assert.equal(agent.id, 'sre');
  assert.equal(typeof agent.name, 'string');
  assert.equal(typeof agent.run, 'function');
});

test('node_downscale checklist finds the PDB blocker with concrete node/pod names', async () => {
  const caseObj = makeCase('node_downscale');
  const result = await runSre(caseObj, { simSpec: PDB_SPEC });

  assert.equal(result.hypothesesAdded, 1);
  assert.ok(result.evidenceAdded >= 1);

  // ENV_CONFIRMED environment evidence naming the actual node and pod.
  const blockerEvidence = caseObj.evidence.find((e) => e.ref === 'ip-10-0-1-10');
  assert.ok(blockerEvidence, 'expected blocker evidence with ref to the node');
  assert.equal(blockerEvidence.type, 'environment');
  assert.equal(blockerEvidence.agentId, 'sre');
  assert.match(blockerEvidence.summary, /ip-10-0-1-10/);
  assert.match(blockerEvidence.summary, /web-7d9f6b4c-x1/);
  assert.match(blockerEvidence.summary, /pdb-blocks-eviction/);

  // The hypothesis is open, names the blocker and links the evidence.
  assert.equal(caseObj.hypotheses.length, 1);
  const hypothesis = caseObj.hypotheses[0];
  assert.equal(hypothesis.status, 'open');
  assert.match(hypothesis.statement, /pdb-blocks-eviction/);
  assert.match(hypothesis.statement, /ip-10-0-1-10/);
  assert.ok(hypothesis.evidenceIds.includes(blockerEvidence.id));

  // The linked evidence lands on the ENV_CONFIRMED rung of the claim ladder.
  const claim = addClaim(caseObj, { statement: 'A PDB blocks eviction of the node' });
  linkEvidenceToClaim(caseObj, claim.id, blockerEvidence.id);
  assert.ok(claimClasses(caseObj, claim.id).includes('ENV_CONFIRMED'));
});

test('checklist is category-driven: non-scale categories only inventory the environment', async () => {
  const caseObj = makeCase('cost_reporting');
  const result = await runSre(caseObj, { simSpec: PDB_SPEC });

  assert.equal(result.hypothesesAdded, 0);
  assert.equal(caseObj.hypotheses.length, 0);
  assert.ok(result.evidenceAdded >= 1);
  assert.ok(caseObj.evidence.every((e) => e.type === 'environment'));
  assert.ok(caseObj.evidence.some((e) => e.summary.includes('Lab environment')));
  // The inventory must name the concrete cluster objects it observed.
  assert.ok(caseObj.evidence.some((e) => e.summary.includes('ip-10-0-1-10')));
});

test('missing simSpec falls back to a trivial healthy cluster: no blockers, no hypotheses', async () => {
  const caseObj = makeCase('node_downscale');
  const result = await runSre(caseObj, {});

  assert.equal(result.hypothesesAdded, 0);
  assert.equal(caseObj.hypotheses.length, 0);
  const clean = caseObj.evidence.find((e) => e.summary.includes('no blockers'));
  assert.ok(clean, 'expected an environment evidence stating there are no blockers');
  assert.equal(clean.type, 'environment');
  assert.match(clean.summary, /node-1/);
});

test('one hypothesis per blocker reason across pdb / local-storage / do-not-evict', async () => {
  const caseObj = makeCase('node_downscale');
  const simSpec = {
    nodes: [{ name: 'n1' }, { name: 'n2', doNotEvict: true }],
    pods: [
      { name: 'pdb-pod', node: 'n1', pdbProtected: true },
      { name: 'ls-pod', node: 'n1', localStorage: true },
    ],
  };
  const result = await runSre(caseObj, { simSpec });

  assert.equal(result.hypothesesAdded, 3);
  assert.equal(caseObj.hypotheses.length, 3);
  // inventory + one environment evidence per blocker reason
  assert.equal(result.evidenceAdded, 4);

  const statements = caseObj.hypotheses.map((h) => h.statement).join('\n');
  assert.match(statements, /pdb-blocks-eviction/);
  assert.match(statements, /pod-has-local-storage/);
  assert.match(statements, /node-marked-do-not-evict/);

  const summaries = caseObj.evidence.map((e) => e.summary).join('\n');
  assert.match(summaries, /pdb-pod/);
  assert.match(summaries, /ls-pod/);
  assert.match(summaries, /n2/);
  for (const h of caseObj.hypotheses) assert.equal(h.status, 'open');
});

test('records every meaningful action on the case trace', async () => {
  const caseObj = makeCase('node_downscale');
  await runSre(caseObj, { simSpec: PDB_SPEC });

  const mine = caseObj.trace.filter((t) => t.actor === 'sre');
  assert.ok(mine.length >= 2);
  const actions = mine.map((t) => t.action);
  assert.ok(actions.includes('investigation.start'));
  assert.ok(actions.includes('investigation.complete'));
});
