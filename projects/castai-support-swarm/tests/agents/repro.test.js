// tests/agents/repro.test.js — contract section 7 (src/agents/repro.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRepro } from '../../src/agents/repro.js';
import { createSre } from '../../src/agents/sre.js';
import {
  createCase,
  addHypothesis,
  addClaim,
  linkEvidenceToClaim,
  claimClasses,
} from '../../src/core/model.js';
import * as lab from '../../src/tools/lab.js';

const NODE = 'ip-10-0-1-10';
const POD = 'web-7d9f6b4c-x1';

const PDB_SPEC = {
  nodes: [{ name: NODE }],
  pods: [{ name: POD, node: NODE, pdbProtected: true }],
};

function makeCase(category = 'node_downscale') {
  const caseObj = createCase({
    id: 'case-repro',
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

async function runSre(caseObj, simSpec) {
  const agent = createSre({ tools: { lab } });
  return agent.run({ caseObj, repoRoot: '.', params: { simSpec } });
}

function runRepro(caseObj, params = {}) {
  const agent = createRepro({ tools: { lab } });
  return agent.run({ caseObj, repoRoot: '.', params });
}

test('lab sim directly: pdbProtected pod blocks scale-down; remove-pdb makes the node removable', () => {
  const cluster = lab.createCluster(PDB_SPEC);

  const before = lab.simulateScaleDown(cluster);
  assert.deepEqual(before.blocked, [{ node: NODE, reasons: ['pdb-blocks-eviction'] }]);
  assert.deepEqual(before.removable, []);

  const fixed = lab.applyFix(cluster, { kind: 'remove-pdb', pod: POD });
  const after = lab.simulateScaleDown(fixed);
  assert.deepEqual(after.removable, [NODE]);
  assert.deepEqual(after.blocked, []);

  // applyFix never mutates its input.
  assert.equal(cluster.pods[0].pdbProtected, true);
});

test('createRepro returns the contract agent shape', () => {
  const agent = createRepro({ llm: null, tools: { lab } });
  assert.equal(agent.id, 'repro');
  assert.equal(typeof agent.name, 'string');
  assert.equal(typeof agent.run, 'function');
});

test('reproduces the PDB blocker, proves removability, confirms the hypothesis', async () => {
  const caseObj = makeCase('node_downscale');
  await runSre(caseObj, PDB_SPEC);

  const result = await runRepro(caseObj, { simSpec: PDB_SPEC });

  assert.equal(result.reproduced, true);
  assert.deepEqual(result.fix, { kind: 'remove-pdb', pod: POD, node: NODE });

  // REPRODUCED reproduction evidence with concrete node/pod + reason.
  const evidence = caseObj.evidence.find((e) => e.type === 'reproduction');
  assert.ok(evidence, 'expected reproduction evidence');
  assert.equal(evidence.agentId, 'repro');
  assert.equal(evidence.ref, NODE);
  assert.match(evidence.summary, /pdb-blocks-eviction/);
  assert.match(evidence.summary, new RegExp(POD));
  assert.match(evidence.summary, /removable/);

  // The SRE hypothesis flips to confirmed and links the reproduction proof.
  assert.equal(caseObj.hypotheses.length, 1);
  const hypothesis = caseObj.hypotheses[0];
  assert.equal(hypothesis.status, 'confirmed');
  assert.ok(hypothesis.evidenceIds.includes(evidence.id));

  // The evidence sits on the REPRODUCED rung of the claim ladder.
  const claim = addClaim(caseObj, { statement: 'Removing the PDB lets the node scale down' });
  linkEvidenceToClaim(caseObj, claim.id, evidence.id);
  assert.ok(claimClasses(caseObj, claim.id).includes('REPRODUCED'));
});

test('rejects hypotheses the simulation disproves; leaves foreign hypotheses untouched', async () => {
  const caseObj = makeCase('node_downscale');
  await runSre(caseObj, PDB_SPEC);

  // A plausible-but-false scale-down hypothesis for the same node...
  const falseHypothesis = addHypothesis(caseObj, {
    statement:
      `Node '${NODE}' cannot scale down: the node is marked do-not-evict ` +
      '(safe-to-evict: false) (node-marked-do-not-evict)',
  });
  // ...and a hypothesis this agent has no business judging.
  const foreignHypothesis = addHypothesis(caseObj, {
    statement: 'Customer DNS is misconfigured',
  });

  const result = await runRepro(caseObj, { simSpec: PDB_SPEC });
  assert.equal(result.reproduced, true);

  const pdbHypothesis = caseObj.hypotheses.find((h) => h.statement.includes('pdb-blocks-eviction'));
  assert.equal(pdbHypothesis.status, 'confirmed');
  assert.equal(falseHypothesis.status, 'rejected');
  assert.equal(foreignHypothesis.status, 'open');
});

test('no blockers in the simulation -> nothing reproduced, no evidence fabricated', async () => {
  const caseObj = makeCase('node_downscale');
  const result = await runRepro(caseObj, {}); // default healthy spec

  assert.equal(result.reproduced, false);
  assert.equal(result.fix, undefined);
  assert.equal(caseObj.evidence.filter((e) => e.type === 'reproduction').length, 0);
  assert.ok(
    caseObj.trace.some((t) => t.actor === 'repro' && t.action === 'reproduction.no-blockers'),
  );
});

test('node-level blocker without a lab fix honestly reports no reproduction', async () => {
  const caseObj = makeCase('node_downscale');
  const simSpec = { nodes: [{ name: 'legacy-node', doNotEvict: true }], pods: [] };
  await runSre(caseObj, simSpec);

  const result = await runRepro(caseObj, { simSpec });

  assert.equal(result.reproduced, false);
  assert.equal(result.fix, undefined);
  assert.equal(caseObj.evidence.filter((e) => e.type === 'reproduction').length, 0);
  // The blocker is real (the simulation reports it), so its hypothesis stays open.
  const hypothesis = caseObj.hypotheses.find((h) =>
    h.statement.includes('node-marked-do-not-evict'),
  );
  assert.ok(hypothesis);
  assert.equal(hypothesis.status, 'open');
});

test('multi-reason node: applies the matching fix per reason and confirms both hypotheses', async () => {
  const simSpec = {
    nodes: [{ name: 'n1' }],
    pods: [
      { name: 'pdb-pod', node: 'n1', pdbProtected: true },
      { name: 'ls-pod', node: 'n1', localStorage: true },
    ],
  };
  const caseObj = makeCase('node_downscale');
  await runSre(caseObj, simSpec);

  const result = await runRepro(caseObj, { simSpec });

  assert.equal(result.reproduced, true);
  const evidence = caseObj.evidence.find((e) => e.type === 'reproduction');
  assert.ok(evidence);
  assert.match(evidence.summary, /pdb-blocks-eviction/);
  assert.match(evidence.summary, /pod-has-local-storage/);

  const statuses = caseObj.hypotheses.map((h) => h.status);
  assert.deepEqual(statuses, ['confirmed', 'confirmed']);
});
