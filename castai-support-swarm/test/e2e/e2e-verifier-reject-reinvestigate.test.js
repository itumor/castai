// Chunk 16 — e2e case 2: verifier REJECT -> re-investigate -> PASS.
//
// Loop 1: the scripted verifier claim has empty evidenceIds -> INFERRED ->
// VERIFY_FAIL -> loopsUsed=1 -> re-plan. Loop 2: docs-researcher grounds the
// token-rotation claims in the real KB note
// (.kimchi/docs/token-rotation-e2e-status.md), the second claim extraction
// cites evidence -> VERIFY_PASS -> draft.
//
// The brain fixture triages the email as issueCategory 'security' (spec §4);
// the orchestrator routes the security specialists and appends the
// verification ladder. Loop 2 lands at confidence 75 (docs 20 + repro 25 +
// e2e 20 + telemetry 10; no code producer in this fixture) ->
// route 'answer_with_uncertainty'.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runE2eCase, orchestratorEvents } from './helpers.js';

const CLUSTER_ID = '0858ecb1-9624-4669-b8d9-b08cba6f2ce6';

describe('e2e case 2 — verifier reject -> re-investigate -> pass', () => {
  test('loopsUsed === 1 after FAIL -> re-plan -> PASS, draft written', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'swarm-e2e-case2-'));
    const { caseRecord, ledger, verdict, draftPost, artifacts } = await runE2eCase(
      'token-rotation-email.md',
      'token-rotation-brain.json',
      { clusterId: CLUSTER_ID, reproKey: 'security', outDir }
    );

    // Exactly one verifier bounce; the case still finished with a draft.
    assert.equal(caseRecord.status, 'done');
    assert.equal(caseRecord.loopsUsed, 1);
    assert.equal(verdict.pass, true);
    assert.equal(draftPost.route, 'answer_with_uncertainty');
    assert.equal(ledger.confidence, 75);

    // State history: verifying -> planning (VERIFY_FAIL) then
    // planning -> investigating again (PLAN_BUILT), then VERIFY_PASS.
    const events = orchestratorEvents(ledger);
    assert.deepEqual(events, [
      'TRIAGED', 'PLAN_READY',
      'PLAN_BUILT', 'INVESTIGATION_DONE', 'VERIFY_FAIL',
      'PLAN_BUILT', 'INVESTIGATION_DONE', 'VERIFY_PASS',
      'DRAFT_OK', 'KNOWLEDGE_DONE',
    ]);
    const failAudit = ledger.auditLog.find((a) => a.agent === 'orchestrator' && a.action === 'VERIFY_FAIL');
    assert.match(failAudit.detail, /loopsUsed=1 < maxLoops=2/);
    assert.match(failAudit.detail, /re-planning/);

    // The failing loop-1 claim was INFERRED (empty evidence ids).
    assert.equal(verdict.claims.length, 2);
    for (const claim of verdict.claims) {
      assert.notEqual(claim.classification, 'INFERRED');
      assert.ok(claim.evidenceIds.length > 0);
    }

    // Loop-2 documentation evidence really comes from the KB note.
    const docPaths = ledger.evidence
      .filter((e) => e.type === 'documentation')
      .map((e) => e.reference);
    assert.ok(
      docPaths.some((p) => p.endsWith('token-rotation-e2e-status.md')),
      `docs-researcher must cite token-rotation-e2e-status.md, got ${JSON.stringify(docPaths)}`
    );

    // Draft written with the required content.
    const draftPath = path.join(artifacts.dir, 'draft.md');
    const draft = await readFile(draftPath, 'utf8');
    assert.match(draft, /Glejn/);
    assert.match(draft, /401 Authorization Required/);
    assert.match(draft, /castai-credentials/);
    assert.match(draft, /60 minutes/);
    assert.match(draft, /— CAST AI Support\s*$/);
    assert.doesNotMatch(draft, /thank you for reaching out/i);
  });
});
