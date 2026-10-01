// Chunk 16 — e2e case 1: PutRolePolicy 403 flow through runCase().
//
// The brain fixture triages the email as issueCategory 'iam' (spec §4).
// The orchestrator routes the iam specialists (docs-researcher,
// cloud-security-engineer, product-engineer) and appends the verification
// ladder (sre-investigator, reproduction-engineer, qa-engineer), so the
// ledger pairs documentation+code evidence with reproduction/test/telemetry
// evidence: confidence 100 → route 'fully_verified'.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runE2eCase, orchestratorEvents } from './helpers.js';

const CLUSTER_ID = '36575565-3657-4657-8657-556536575565';

describe('e2e case 1 — PutRolePolicy 403 (draft + fully-grounded flow)', () => {
  test('runs intake->done with a lint-clean, evidence-grounded draft', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'swarm-e2e-case1-'));
    const { caseRecord, ledger, verdict, draftPost, artifacts } = await runE2eCase(
      'putrolepolicy-403-email.md',
      'putrolepolicy-403-brain.json',
      { clusterId: CLUSTER_ID, reproKey: 'iam', outDir }
    );

    // Full state machine ran to done on the first loop (no verifier bounce).
    assert.equal(caseRecord.status, 'done');
    assert.equal(caseRecord.loopsUsed, 0);
    assert.deepEqual(orchestratorEvents(ledger), [
      'TRIAGED', 'PLAN_READY', 'PLAN_BUILT', 'INVESTIGATION_DONE',
      'VERIFY_PASS', 'DRAFT_OK', 'KNOWLEDGE_DONE',
    ]);

    // Triage facts (brain classify, merged with the regex pre-parse).
    assert.equal(ledger.triage.provider, 'eks');
    assert.equal(ledger.triage.castaiMode, 'full');
    assert.equal(ledger.triage.severity, 'P3');
    assert.equal(ledger.triage.clusterId, CLUSTER_ID);

    // Verdict passes and every claim is evidence-backed.
    assert.equal(verdict.pass, true);
    assert.ok(verdict.claims.length >= 2);
    for (const claim of verdict.claims) {
      assert.ok(claim.evidenceIds.length > 0, 'claim must cite evidence');
      assert.ok(
        ['DOCUMENTED', 'CODE-CONFIRMED', 'TEST-CONFIRMED', 'ENVIRONMENT-CONFIRMED'].includes(claim.classification),
        `claim classification must be verified, got ${claim.classification}`
      );
    }

    // Evidence categories: documentation, code, reproduction, telemetry and
    // test are all present (iam specialists + the verification ladder).
    const types = new Set(ledger.evidence.map((e) => e.type));
    for (const expected of ['documentation', 'code', 'reproduction', 'telemetry', 'test']) {
      assert.ok(types.has(expected), `ledger must contain ${expected} evidence`);
    }

    // The sandbox reproduction actually reproduced; QA passed all 4 levels.
    const repro = ledger.evidence.find((e) => e.type === 'reproduction');
    assert.equal(repro.reproduced, true);
    assert.equal(ledger.tests.unit, 'passed');
    assert.equal(ledger.tests.integration, 'passed');
    assert.equal(ledger.tests.e2e, 'passed');
    assert.equal(ledger.tests.regression, 'passed');

    // Confidence: docs 20 + code 25 + repro 25 + e2e 20 + telemetry 10 = 100
    // (code via cloud-security-engineer, ladder appended by the orchestrator).
    assert.equal(ledger.confidence, 100);
    assert.equal(draftPost.route, 'fully_verified');

    // Telemetry is cluster-linked via toolRun.args.clusterId.
    const telemetry = ledger.evidence.find((e) => e.type === 'telemetry');
    assert.equal(telemetry.toolRun.args.clusterId, CLUSTER_ID);

    // Draft content: human-sounding, specific, style-rule clean.
    const draftPath = path.join(artifacts.dir, 'draft.md');
    const draft = await readFile(draftPath, 'utf8');
    assert.match(draft, /Samuel/);
    assert.match(draft, /iam:PutRolePolicy/);
    assert.match(draft, /GetRolePolicy/);
    assert.match(draft, /DeleteRolePolicy/);
    assert.match(draft, /arn:aws:iam::951463557399:role\/cast-\*/);
    assert.match(draft, /no Terraform workaround/i);
    assert.match(draft, /idempotent/i);
    assert.match(draft, /— CAST AI Support\s*$/);
    assert.doesNotMatch(draft, /thank you for reaching out/i);
    assert.doesNotMatch(draft, /i hope this email finds you well/i);

    // Artifact trio persisted.
    assert.ok(artifacts.files.includes(path.join(artifacts.dir, 'ledger.json')));
    assert.ok(artifacts.files.includes(path.join(artifacts.dir, 'verdict.json')));
    assert.ok(artifacts.files.includes(draftPath));

    // Knowledge agent proposed a runbook (no file writes in V1).
    assert.ok(Array.isArray(caseRecord.knowledgeProposals));
    assert.equal(caseRecord.knowledgeProposals.length, 1);
    assert.match(caseRecord.knowledgeProposals[0].title, /PutRolePolicy/);
  });
});
