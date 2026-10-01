// tests/agents/verifier.test.js — the strict gate.
// Seeds claims via model.createCase + addClaim/addEvidence and asserts the
// verifier PASSes only under the exact contract rule, and REJECTs for: zero
// evidence, single DOCUMENTED only, docs+api (still ONE class), strict mode
// with one hard class, zero evidence-backed claims, only UNKNOWN-class
// evidence, and the adversarial false-claim case.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addClaim,
  addEvidence,
  createCase,
  linkEvidenceToClaim,
} from '../../src/core/model.js';
import { createVerifier } from '../../src/agents/verifier.js';

function freshCase(id = 'VC-1') {
  return createCase({
    id,
    thread: {
      from: 'Ann Example <ann@example.com>',
      subject: 'node not scaling down',
      messages: [{ from: 'ann@example.com', date: '2026-01-01', body: 'node stuck' }],
    },
    customer: { name: 'Ann Example', email: 'ann@example.com' },
  });
}

function ctxFor(caseObj, params = {}) {
  return { caseObj, repoRoot: '/nonexistent', params };
}

/** Seed a claim and link one freshly-added evidence per given type. */
function seedClaim(caseObj, { statement, needsVerification = true, types = [] }) {
  const claim = addClaim(caseObj, { statement, needsVerification });
  for (const type of types) {
    const evidence = addEvidence(caseObj, {
      type,
      source: 'test',
      summary: `evidence of ${type}`,
      agentId: 'test',
    });
    linkEvidenceToClaim(caseObj, claim.id, evidence.id);
  }
  return claim;
}

async function runVerifier(caseObj, params) {
  const agent = createVerifier({ llm: undefined, tools: undefined });
  const result = await agent.run(ctxFor(caseObj, params));
  return { agent, result };
}

test('PASS with a single hard proof class (environment) and flips claim to verified', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'The node is blocked by pdb-blocks-eviction.',
    types: ['environment'],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'PASS');
  assert.deepEqual(result.verdict.rejectedClaims, []);
  assert.equal(caseObj.claims[0].status, 'verified');
  assert.equal(caseObj.verdict, result.verdict);
  assert.match(caseObj.verdict.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('PASS with two independent classes incl. DOCUMENTED (documentation + prior_ticket)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'PDBs block CAST AI node removal per the docs.',
    types: ['documentation', 'prior_ticket'],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'PASS');
  assert.deepEqual(result.verdict.rejectedClaims, []);
  // DOCUMENTED (ladder index 3) is below ENV_CONFIRMED, so no auto-verified flip.
  assert.equal(caseObj.claims[0].status, 'proposed');
});

test('PASS with reproduction evidence (hard proof) regardless of other classes', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, { statement: 'Reproduced in lab.', types: ['reproduction'] });
  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'PASS');
  assert.equal(caseObj.claims[0].status, 'verified');
});

test('REJECT: zero evidence on a needsVerification claim', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, { statement: 'Unbacked claim.', types: [] });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.equal(result.verdict.rejectedClaims.length, 1);
  assert.equal(result.verdict.rejectedClaims[0].id, 'C1');
  assert.equal(result.verdict.rejectedClaims[0].statement, 'Unbacked claim.');
  assert.match(result.verdict.rejectedClaims[0].missing, /no linked evidence/i);
  assert.equal(caseObj.claims[0].status, 'rejected');
});

test('REJECT: single DOCUMENTED only (one class is not enough)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, { statement: 'Docs-only claim.', types: ['documentation'] });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.equal(result.verdict.rejectedClaims.length, 1);
  assert.match(result.verdict.rejectedClaims[0].missing, /DOCUMENTED alone/i);
  assert.equal(caseObj.claims[0].status, 'rejected');
});

test('REJECT: documentation + api_spec is still ONE class (both map to DOCUMENTED)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'Docs plus api spec claim.',
    types: ['documentation', 'api_spec'],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.match(result.verdict.rejectedClaims[0].missing, /DOCUMENTED alone/i);
});

test('REJECT: non-hard, non-DOCUMENTED classes only (SUPPORTING + INFERRED)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'Weak evidence claim.',
    types: ['prior_ticket', 'inference'],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.match(result.verdict.rejectedClaims[0].missing, /missing hard proof/i);
});

test('REJECT: only customer_statement evidence (UNKNOWN class)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'The customer says nodes never drain.',
    types: ['customer_statement'],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.equal(result.verdict.rejectedClaims.length, 1);
});

test('REJECT: zero evidence-backed claims overall (claim opted out of verification, no evidence)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'No verification needed, but also no evidence.',
    needsVerification: false,
    types: [],
  });

  const { result } = await runVerifier(caseObj);
  // No per-claim rejection, yet zero evidence-backed claims => REJECT.
  assert.deepEqual(result.verdict.rejectedClaims, []);
  assert.equal(result.verdict.status, 'REJECT');
});

test('REJECT: empty case (no claims at all)', async () => {
  const caseObj = freshCase();
  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.deepEqual(result.verdict.rejectedClaims, []);
});

test('strictTwoSource: one hard class alone is NOT enough', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, { statement: 'Reproduced once.', types: ['reproduction'] });

  const { result } = await runVerifier(caseObj, { strictTwoSource: true });
  assert.equal(result.verdict.status, 'REJECT');
  assert.match(result.verdict.rejectedClaims[0].missing, /strictTwoSource/);
});

test('strictTwoSource: >=2 independent hard-or-doc classes passes', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'Docs plus environment.',
    types: ['documentation', 'environment'],
  });

  const { result } = await runVerifier(caseObj, { strictTwoSource: true });
  assert.equal(result.verdict.status, 'PASS');
  assert.deepEqual(result.verdict.rejectedClaims, []);
});

test('strictTwoSource: DOCUMENTED + SUPPORTING fails (SUPPORTING does not qualify)', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'Docs plus prior ticket only.',
    types: ['documentation', 'prior_ticket'],
  });

  const { result } = await runVerifier(caseObj, { strictTwoSource: true });
  assert.equal(result.verdict.status, 'REJECT');
  assert.match(result.verdict.rejectedClaims[0].missing, /strictTwoSource/);
});

test('whole verdict REJECTs when ANY needsVerification claim fails; others stay verified', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, { statement: 'Backed by the lab.', types: ['environment'] });
  seedClaim(caseObj, { statement: 'Pure speculation, no evidence.', types: [] });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.deepEqual(
    result.verdict.rejectedClaims.map((c) => c.id),
    ['C2'],
  );
  assert.equal(caseObj.claims[0].status, 'verified');
  assert.equal(caseObj.claims[1].status, 'rejected');
});

test('adversarial false claim with no evidence MUST be rejected and excluded', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'The autoscaler ignores PDBs.',
    types: [],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'REJECT');
  assert.equal(caseObj.claims[0].status, 'rejected');
  assert.equal(result.verdict.rejectedClaims.length, 1);
});

test('verdict shape is exactly { status, rejectedClaims: [{id, statement, missing}], at } and trace is recorded', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, { statement: 'Backed.', types: ['environment'] });

  const { result } = await runVerifier(caseObj);
  assert.deepEqual(Object.keys(result.verdict).sort(), ['at', 'rejectedClaims', 'status']);
  const actions = caseObj.trace.filter((t) => t.actor === 'verifier').map((t) => t.action);
  assert.ok(actions.includes('verifier.start'));
  assert.ok(actions.includes('verifier.verdict'));
});

test('loop-safe: a claim rejected earlier passes once evidence lands', async () => {
  const caseObj = freshCase();
  const claim = seedClaim(caseObj, { statement: 'Later backed.', types: [] });

  const first = await runVerifier(caseObj);
  assert.equal(first.result.verdict.status, 'REJECT');
  assert.equal(claim.status, 'rejected');

  const evidence = addEvidence(caseObj, {
    type: 'environment',
    source: 'test',
    summary: 'confirmation arrived late',
    agentId: 'test',
  });
  linkEvidenceToClaim(caseObj, claim.id, evidence.id);

  const second = await runVerifier(caseObj);
  assert.equal(second.result.verdict.status, 'PASS');
  assert.equal(claim.status, 'verified');
});

test('claims with needsVerification=false are not gate-checked but count as evidence-backed', async () => {
  const caseObj = freshCase();
  seedClaim(caseObj, {
    statement: 'Informational, documented once.',
    needsVerification: false,
    types: ['documentation'],
  });

  const { result } = await runVerifier(caseObj);
  assert.equal(result.verdict.status, 'PASS');
  assert.deepEqual(result.verdict.rejectedClaims, []);
});
