// tests/agents/researcher.test.js — src/agents/researcher.js.
// Injects a fake tools.kb.searchKb (no fs, no network) and verifies the agent
// searches per triage question, adds DOCUMENTED evidence with ref paths plus
// linked needsVerification claims, and returns { claimsAdded, evidenceAdded }.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createResearcher, classifyKbHit, cleanSnippet } from '../../src/agents/researcher.js';
import { claimClasses, createCase } from '../../src/core/model.js';

const REPO_ROOT = '/Users/eramadan/castai'; // real kb roots exist and are read-only

function makeCtx(questions, extra = {}) {
  const caseObj = createCase({
    id: 'case-research',
    thread: {
      from: 'Christoph Weber <christoph.weber@siemens.example.com>',
      subject: 'CAST AI node not scaling down after workload shrink',
      messages: [
        {
          from: 'Christoph Weber <christoph.weber@siemens.example.com>',
          date: '2026-01-05',
          body: 'One node is not scaling down. The pods have a PodDisruptionBudget.',
        },
      ],
    },
    customer: { name: 'Christoph Weber', email: 'christoph.weber@siemens.example.com' },
  });
  caseObj.triage = {
    category: 'node_downscale',
    provider: 'aws',
    platform: 'eks',
    castaiMode: 'full',
    questions,
    severity: 'low',
    missingInfo: ['orgId', 'clusterId'],
    entities: {},
    customerName: 'Christoph',
  };
  return { caseObj, repoRoot: REPO_ROOT, params: {}, ...extra };
}

function fakeKb(hitsByQuery = {}) {
  const calls = [];
  const kb = {
    searchKb: async (args) => {
      calls.push(args);
      return hitsByQuery[args.query] || [];
    },
  };
  return { calls, kb };
}

test('researcher searches kb for each triage question with repoRoot + limit', async () => {
  const questions = ['Could that be related?', 'What do we need to change?'];
  const { calls, kb } = fakeKb();
  const ctx = makeCtx(questions);
  const agent = createResearcher({ llm: {}, tools: { kb } });
  await agent.run(ctx);

  assert.equal(calls.length, 2);
  for (let i = 0; i < questions.length; i += 1) {
    assert.equal(calls[i].query, questions[i]);
    assert.equal(calls[i].repoRoot, REPO_ROOT);
    assert.equal(calls[i].limit, 5);
  }
});

test('researcher adds DOCUMENTED evidence with ref paths + linked claims', async () => {
  const hits = {
    'Could that be related?': [
      { path: '.kimchi/docs/token-rotation-e2e-status.md', score: 9, snippet: 'PodDisruptionBudgets block node removal until pods can move.' },
    ],
    'What do we need to change?': [
      { path: 'brain/notes/PutRolePolicy 403 Case.md', score: 7, snippet: 'Prior case: scoped-down IAM permissions resolved onboarding.' },
      { path: '.kimchi/docs/castai-api-savings-endpoints.md', score: 5, snippet: 'GET /v1/cost-reports returns realized savings.' },
    ],
  };
  const { kb } = fakeKb(hits);
  const ctx = makeCtx(['Could that be related?', 'What do we need to change?']);
  const agent = createResearcher({ llm: {}, tools: { kb } });
  const result = await agent.run(ctx);

  assert.deepEqual(result, { claimsAdded: 3, evidenceAdded: 3 });

  // evidence: 3 entries, agentId researcher, ref = source path
  assert.equal(ctx.caseObj.evidence.length, 3);
  for (const ev of ctx.caseObj.evidence) {
    assert.equal(ev.agentId, 'researcher');
    assert.equal(ev.source, 'kb');
    assert.equal(typeof ev.ref, 'string');
  }
  const byRef = new Map(ctx.caseObj.evidence.map((e) => [e.ref, e]));
  assert.equal(byRef.get('.kimchi/docs/token-rotation-e2e-status.md').type, 'documentation');
  assert.equal(byRef.get('brain/notes/PutRolePolicy 403 Case.md').type, 'prior_ticket');
  assert.equal(byRef.get('.kimchi/docs/castai-api-savings-endpoints.md').type, 'api_spec');

  // claims: needsVerification, statement carries the ref path, linked to evidence
  assert.equal(ctx.caseObj.claims.length, 3);
  for (const claim of ctx.caseObj.claims) {
    assert.equal(claim.needsVerification, true);
    assert.equal(claim.status, 'proposed');
    assert.match(claim.statement, /^Knowledge base source /);
    // the claim statement carries the ref path verbatim (paths may contain spaces)
    assert.ok(
      ctx.caseObj.evidence.some((ev) => claim.statement.includes(`${ev.ref} documents:`)),
      `claim '${claim.id}' must embed its evidence ref`,
    );
    assert.ok(claim.evidenceIds.length >= 1);
  }

  // ladder classes derived from linked evidence match evidence types
  const docClaim = ctx.caseObj.claims.find((c) => c.statement.includes('token-rotation-e2e-status.md'));
  assert.ok(claimClasses(ctx.caseObj, docClaim.id).includes('DOCUMENTED'));
  const apiClaim = ctx.caseObj.claims.find((c) => c.statement.includes('castai-api-savings-endpoints.md'));
  assert.ok(claimClasses(ctx.caseObj, apiClaim.id).includes('DOCUMENTED'));
  const priorClaim = ctx.caseObj.claims.find((c) => c.statement.includes('PutRolePolicy 403 Case.md'));
  assert.ok(claimClasses(ctx.caseObj, priorClaim.id).includes('SUPPORTING'));

  // trace: agent start/end, one kb.search per question, final summary
  const actions = ctx.caseObj.trace.map((entry) => entry.action);
  assert.deepEqual(actions, [
    'agent.start',
    'kb.search',
    'kb.search',
    'researcher.complete',
    'agent.end',
  ]);
});

test('researcher dedupes identical claim statements (same hit re-surfaced across questions)', async () => {
  const shared = { path: '.kimchi/docs/verification.md', score: 8, snippet: 'Shared runbook guidance for the verification step.' };
  const { kb } = fakeKb({ Q1: [shared], Q2: [shared] });
  const ctx = makeCtx(['Q1', 'Q2']);
  const agent = createResearcher({ llm: {}, tools: { kb } });
  const result = await agent.run(ctx);

  // One evidence per ref, and — crucial for the verify-feedback loop — ONE
  // claim per distinct statement: the same hit surfacing under a second
  // question must not re-present the identical claim under a fresh id.
  assert.deepEqual(result, { claimsAdded: 1, evidenceAdded: 1 });
  assert.equal(ctx.caseObj.evidence.length, 1);
  assert.equal(ctx.caseObj.claims.length, 1);
  assert.deepEqual(ctx.caseObj.claims[0].evidenceIds, ['E1']);
});

test('researcher claims per hit when the statements DIFFER', async () => {
  const { kb } = fakeKb({
    Q1: [{ path: '.kimchi/docs/verification.md', score: 8, snippet: 'Runbook A: verify every claim against the evidence.' }],
    Q2: [{ path: '.kimchi/docs/verification.md', score: 8, snippet: 'Runbook B: a different verification window applies here.' }],
  });
  const ctx = makeCtx(['Q1', 'Q2']);
  const agent = createResearcher({ llm: {}, tools: { kb } });
  const result = await agent.run(ctx);

  assert.deepEqual(result, { claimsAdded: 2, evidenceAdded: 1 });
  assert.equal(ctx.caseObj.evidence.length, 1);
  assert.equal(ctx.caseObj.claims.length, 2);
  for (const claim of ctx.caseObj.claims) {
    assert.deepEqual(claim.evidenceIds, ['E1']);
  }
});

test('researcher falls back to the thread subject when triage has no questions', async () => {
  const { calls, kb } = fakeKb();
  const ctx = makeCtx([]);
  const agent = createResearcher({ llm: {}, tools: { kb } });
  await agent.run(ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, 'CAST AI node not scaling down after workload shrink');
});

test('researcher returns zeros gracefully when no db tools are provided', async () => {
  const ctx = makeCtx(['anything?']);
  const agent = createResearcher({ llm: {}, tools: {} });
  const result = await agent.run(ctx);
  assert.deepEqual(result, { claimsAdded: 0, evidenceAdded: 0 });
  assert.ok(ctx.caseObj.trace.some((entry) => entry.action === 'kb.unavailable'));
});

test('researcher uses docsSearch when provided and records it', async () => {
  const { kb } = fakeKb({ 'Q?': [] });
  const docsSearch = async ({ query }) => [
    { path: 'docs.cast.ai/spot-hints.md', snippet: `For this topic the full answer is documented in the public CAST AI docs.` },
  ];
  const ctx = makeCtx(['Q?']);
  const agent = createResearcher({ llm: {}, tools: { kb, docsSearch } });
  const result = await agent.run(ctx);
  assert.deepEqual(result, { claimsAdded: 1, evidenceAdded: 1 });
  assert.ok(ctx.caseObj.trace.some((entry) => entry.action === 'docsSearch.search'));
});

test('classifyKbHit mapping is deterministic', () => {
  assert.equal(classifyKbHit('brain/notes/PutRolePolicy 403 Case.md'), 'prior_ticket');
  assert.equal(classifyKbHit('.kimchi/docs/reply-glejn-token-rotation.md'), 'prior_ticket');
  assert.equal(classifyKbHit('.kimchi/docs/castai-api-savings-endpoints.md'), 'api_spec');
  assert.equal(classifyKbHit('.kimchi/docs/eks-castai-readonly-spec.md'), 'api_spec');
  assert.equal(classifyKbHit('.kimchi/docs/rotate-token-manual-commands.md'), 'documentation');
  assert.equal(classifyKbHit('.kimchi/docs/karpenter-castai-clm-learnings.md'), 'documentation');
});

test('researcher ignores malformed hits without failing the run', async () => {
  const { kb } = fakeKb({
    'Q?': [null, {}, { score: 1 }, { path: '', snippet: 'x' }, { path: 'ok.md', snippet: 'A properly formed hit with a real sentence inside.' }],
  });
  const ctx = makeCtx(['Q?']);
  const agent = createResearcher({ llm: {}, tools: { kb } });
  const result = await agent.run(ctx);
  assert.deepEqual(result, { claimsAdded: 1, evidenceAdded: 1 });
  assert.equal(ctx.caseObj.evidence[0].ref, 'ok.md');
});

test('cleanSnippet repairs mid-sentence fragments and markdown residue', () => {
  // Leading fragment + bold residue + trailing stub ('Ther.'): repaired to the intact sentence.
  assert.equal(
    cleanSnippet(
      'nous token-revocation API for cluster tokens; the previous token remained valid after rotation. ' +
      'We empirically verified the old token returned HTTP 200 for at least **60 minutes** after rotation. Ther.',
    ),
    'The previous token remained valid after rotation. We empirically verified the old token returned HTTP 200 for at least 60 minutes after rotation.',
  );
  // Stray colon + stub tail ('later: th.') is closed to a real sentence.
  assert.equal(
    cleanSnippet(
      'he old token continued to authenticate successfully for at least 60 minutes after rotation. ' +
      'This explains why the cluster could initially continue working after rotation and only fail later: th.',
    ),
    'Old token continued to authenticate successfully for at least 60 minutes after rotation. This explains why the cluster could initially continue working after rotation and only fail later.',
  );
  // Q&A heading fragment + stub word tail ('the re.') is dropped entirely.
  assert.equal(
    cleanSnippet(
      'ts. 4. Do not route the token through castai_eks_cluster.this.cluster_token after rotation, ' +
      'because Terraform state will still hold the old value. ### Q6. After a token rotation, what is the re.',
    ),
    'Do not route the token through castai_eks_cluster.this.cluster_token after rotation, because Terraform state will still hold the old value.',
  );
  // Legitimate numerical ends are kept.
  assert.ok(cleanSnippet('Scale the deployment so minAvailable no longer equals the replica count: 2.').endsWith('count: 2.'));
});

test('cleanSnippet rejects irreparable fragments; the hit is skipped entirely', async () => {
  assert.equal(cleanSnippet('bash shellcheck -e SC1091 -x \\ e2e/run.sh \\ e2e/lib/*.sh # exit code: 0'), '');
  assert.equal(cleanSnippet('xs'), '');
  assert.equal(cleanSnippet(''), '');

  const { kb } = fakeKb({
    'Q?': [{ path: '.kimchi/docs/review-token-rotation-e2e.md', score: 5, snippet: 'bash shellcheck -e SC1091 # exit code: 0' }],
  });
  const agent = createResearcher({ llm: {}, tools: { kb } });
  const ctx2 = makeCtx(['Q?']);
  const result = await agent.run(ctx2);
  assert.deepEqual(result, { claimsAdded: 0, evidenceAdded: 0 });
  assert.equal(ctx2.caseObj.claims.length, 0); // no ledger pollution from fragments
  assert.equal(ctx2.caseObj.evidence.length, 0);
});

test('cleanSnippet drops question sentences — findings state facts, not Q&A headings', () => {
  const out = cleanSnippet(
    'Reference that secret in the Helm values for CAST AI components. Do not route the token through ' +
    'castai_eks_cluster.this.cluster_token after rotation, because Terraform state will still hold the old value. ' +
    'After a token rotation, what is the recommended way to propagate the new token to the CAST AI agent?',
  );
  assert.ok(!out.includes('?'), 'no question sentence survives');
  assert.match(out, /Do not route the token/);
});
