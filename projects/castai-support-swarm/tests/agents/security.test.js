// tests/agents/security.test.js — least-privilege reasoning for iam_* only.
//
// EVIDENCE HONESTY is what is pinned here: the security agent may only cite
// documents it actually read from the on-disk knowledge base (repo-relative
// refs via the real searchKb), plus ONE explicitly-typed inference entry.
// The old pinned behavior — two hardcoded "documentation"/"prior_ticket"
// entries with invented refs — was deleted as fabrication, and these tests
// now assert the honest replacement behavior end to end with a hermetic
// fixture KB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCase, claimClasses } from '../../src/core/model.js';
import { createSecurity } from '../../src/agents/security.js';
import { searchKb } from '../../src/tools/kb.js';

function freshCase(category) {
  const caseObj = createCase({
    id: 'S-1',
    thread: {
      from: 'Dev Ops <devops@example.com>',
      subject: 'AccessDenied PutRolePolicy during CAST AI onboarding',
      messages: [
        {
          from: 'devops@example.com',
          date: '2026-01-01',
          body: 'Our GitHub Actions role gets 403 on iam:PutRolePolicy while onboarding.',
        },
      ],
    },
    customer: { name: 'Dev Ops', email: 'devops@example.com' },
  });
  caseObj.triage = {
    category,
    provider: 'aws',
    platform: 'eks',
    castaiMode: 'readonly',
    questions: [],
    severity: 'medium',
    missingInfo: [],
    entities: {},
    customerName: 'Dev',
  };
  return caseObj;
}

/** Hermetic fixture: a tiny on-disk KB about PutRolePolicy onboarding. */
async function fixtureRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'swarm-security-kb-'));
  await mkdir(path.join(root, '.kimchi', 'docs'), { recursive: true });
  await mkdir(path.join(root, 'brain', 'notes'), { recursive: true });
  await writeFile(
    path.join(root, '.kimchi', 'docs', 'iam-onboarding-least-privilege.md'),
    '# IAM onboarding least privilege\n\n' +
      'During CAST AI onboarding the deployer identity gets 403 on ' +
      'iam:PutRolePolicy AccessDenied. The least privilege fix is to scope ' +
      'the CI role policy to the CAST AI role ARNs through the Terraform path, ' +
      'never IAMFullAccess on the whole account.\n',
  );
  await writeFile(
    path.join(root, 'brain', 'notes', 'case-putrolepolicy-403.md'),
    '# Case: PutRolePolicy 403\n\n' +
      'A customer hit iam:PutRolePolicy AccessDenied during onboarding. We ' +
      'scoped the permission to the CAST AI role ARNs and succeeded on retry.\n',
  );
  return root;
}

function ctxFor(caseObj, repoRoot) {
  return { caseObj, repoRoot, params: {} };
}

test('iam_onboarding: cites REAL KB hits it actually read plus ONE inference entry', async (t) => {
  const root = await fixtureRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  const caseObj = freshCase('iam_onboarding');
  const security = createSecurity({ llm: undefined, tools: { kb: { searchKb } } });
  const { evidenceAdded, risks } = await security.run(ctxFor(caseObj, root));

  // Every non-inference evidence entry must quote an on-disk file.
  const kbEvidence = caseObj.evidence.filter((e) => e.type !== 'inference');
  assert.ok(kbEvidence.length >= 2, `expected >=2 real KB hits, got ${kbEvidence.length}`);
  assert.ok(evidenceAdded === kbEvidence.length + 1, 'evidenceAdded = KB hits + inference');
  for (const evidence of kbEvidence) {
    assert.ok(['documentation', 'prior_ticket', 'api_spec', 'reference'].includes(evidence.type));
    assert.equal(evidence.agentId, 'security');
    assert.ok(typeof evidence.ref === 'string' && evidence.ref.length > 0);
    assert.ok(!path.isAbsolute(evidence.ref), `ref must be repo-relative: ${evidence.ref}`);
    assert.ok(
      existsSync(path.join(root, evidence.ref)),
      `evidence ref must exist on disk: ${evidence.ref}`,
    );
    const summaries = evidence.summary.toLowerCase();
    assert.ok(
      summaries.includes('putrolepolicy') ||
        summaries.includes('least privilege') ||
        summaries.includes('role'),
      `summary quotes real content: ${evidence.summary}`,
    );
  }

  // Exactly one inference entry, with honest provenance and no ref.
  const inference = caseObj.evidence.filter((e) => e.type === 'inference');
  assert.equal(inference.length, 1);
  assert.equal(inference[0].ref, undefined);
  assert.ok(inference[0].summary.toLowerCase().includes('inference'));

  // No fabricated hard proof may ever appear from this agent.
  const types = new Set(caseObj.evidence.map((e) => e.type));
  assert.ok(!types.has('reproduction') && !types.has('e2e_test') && !types.has('code_change'));

  // ONE conclusion claim, needsVerification, linked ONLY to the read evidence.
  const claims = caseObj.claims || [];
  assert.equal(claims.length, 1);
  const claim = claims[0];
  assert.equal(claim.needsVerification, true);
  assert.match(claim.statement, /PutRolePolicy/);
  assert.match(claim.statement, /CAST AI role ARNs/);
  assert.match(claim.statement, /never IAMFullAccess/);
  const linked = new Set(claim.evidenceIds);
  for (const id of linked) {
    assert.ok((caseObj.evidence || []).some((e) => e.id === id), `linked evidence ${id} in ledger`);
  }
  // The claim's classes reflect ONLY real material: documentation + prior
  // ticket + inference — never a fabricated hard class.
  const classes = claimClasses(caseObj, claim.id);
  assert.ok(classes.includes('DOCUMENTED'));
  assert.ok(classes.includes('INFERRED'));
  assert.ok(!classes.some((c) => ['ENV_CONFIRMED', 'CODE_CONFIRMED', 'TEST_CONFIRMED', 'REPRODUCED'].includes(c)));

  // Risks land in the solution steps (append, preserving any earlier steps).
  assert.ok(Array.isArray(risks) && risks.length >= 2);
  const joined = risks.join('\n');
  assert.match(joined, /PutRolePolicy/);
  assert.match(joined, /IAMFullAccess/);
  assert.match(joined, /Terraform|CI/);
  assert.match(joined, /specific CAST AI role ARNs/);
  for (const risk of risks) {
    assert.ok(caseObj.solution.steps.includes(risk));
    assert.match(risk, /^Risk:/);
  }
  assert.equal(caseObj.solution.status, 'proposed');

  const actions = caseObj.trace.filter((tr) => tr.actor === 'security').map((tr) => tr.action);
  assert.ok(actions.includes('security.start'));
  assert.ok(actions.includes('security.kb.search'));
  assert.ok(actions.includes('security.evidence.added'));
  assert.ok(actions.includes('security.claim.added'));
  assert.ok(actions.includes('security.risks.appended'));
});

test('iam_onboarding on an EMPTY KB: only inference evidence, claim ready to REJECT', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'swarm-security-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const caseObj = freshCase('iam_onboarding');
  const { evidenceAdded } = await createSecurity({
    tools: { kb: { searchKb } },
  }).run(ctxFor(caseObj, root));

  assert.equal(evidenceAdded, 1, 'only the inference entry');
  assert.equal(caseObj.evidence.length, 1);
  assert.equal(caseObj.evidence[0].type, 'inference');
  // The claim exists (agents propose; the verifier judges) but carries ONLY
  // the inference class — it can never satisfy the primary or fallback pass
  // rule, so a case like this must end REJECT/honest, never fabricated-pass.
  assert.equal(caseObj.claims.length, 1);
  assert.deepEqual(claimClasses(caseObj, caseObj.claims[0].id), ['INFERRED']);
});

test('iam_onboarding without a kb tool: records the call gap, still adds inference', () => {
  const caseObj = freshCase('iam_onboarding');
  return createSecurity({ tools: undefined })
    .run(ctxFor(caseObj, '/nonexistent'))
    .then(({ evidenceAdded }) => {
      assert.equal(evidenceAdded, 1);
      assert.equal(caseObj.evidence[0].type, 'inference');
      const actions = caseObj.trace.filter((tr) => tr.actor === 'security').map((tr) => tr.action);
      assert.ok(actions.includes('kb.unavailable'));
    });
});

test('appends risks after existing architect steps without removing them', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'swarm-security-steps-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caseObj = freshCase('iam_onboarding');
  caseObj.solution = {
    status: 'proposed',
    summary: 'already there',
    steps: ['1. Scope the CI policy first.'],
  };

  const { risks } = await createSecurity({ tools: { kb: { searchKb } } }).run(ctxFor(caseObj, root));
  assert.equal(caseObj.solution.steps[0], '1. Scope the CI policy first.');
  assert.equal(caseObj.solution.steps.length, 1 + risks.length);
});

test('non-iam category: records a skip and returns empty results', async () => {
  const caseObj = freshCase('node_downscale');
  const { evidenceAdded, risks } = await createSecurity().run(ctxFor(caseObj, '/nonexistent'));

  assert.equal(evidenceAdded, 0);
  assert.deepEqual(risks, []);
  assert.equal(caseObj.evidence.length, 0);
  assert.equal((caseObj.claims || []).length, 0);
  assert.equal(caseObj.solution.steps.length, 0);
  const actions = caseObj.trace.filter((tr) => tr.actor === 'security').map((tr) => tr.action);
  assert.deepEqual(actions, ['security.skipped']);
});

test('product_bug category: no IAM noise, still a clean skip', async () => {
  const caseObj = freshCase('product_bug');
  const { evidenceAdded, risks } = await createSecurity().run(ctxFor(caseObj, '/nonexistent'));
  assert.equal(evidenceAdded, 0);
  assert.deepEqual(risks, []);
});
