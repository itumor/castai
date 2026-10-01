// Chunk 16 — e2e case 3: escalation after two VERIFY_FAILs.
//
// Underspecified "savings numbers don't match" email (no cluster id, no
// numbers, no period). The scripted specialist vote rejects the only
// hypothesis in BOTH loops, so ledger.solution stays 'unsolved', the verifier
// has no summary to extract claims from and fails twice; with maxLoops=2 the
// second VERIFY_FAIL becomes ESCALATE. The escalation package is written,
// no draft is produced.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runE2eCase, orchestratorEvents } from './helpers.js';

describe('e2e case 3 — underspecified case escalates after two verifier failures', () => {
  test('loopsUsed === 2 -> escalated -> escalation.json, no draft', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'swarm-e2e-case3-'));
    const { caseRecord, ledger, verdict, draftPost, artifacts } = await runE2eCase(
      'savings-vague-email.md',
      'savings-brain.json',
      { clusterId: null, reproKey: 'cost_reporting', outDir }
    );

    // Two verifier loops exhausted maxLoops=2 -> ESCALATE -> done.
    assert.equal(caseRecord.status, 'done');
    assert.equal(caseRecord.loopsUsed, 2);
    assert.equal(ledger.solution.status, 'unsolved');
    assert.equal(verdict, null);
    assert.equal(draftPost, null);

    assert.deepEqual(orchestratorEvents(ledger), [
      'TRIAGED', 'PLAN_READY',
      'PLAN_BUILT', 'INVESTIGATION_DONE', 'VERIFY_FAIL',
      'PLAN_BUILT', 'INVESTIGATION_DONE', 'ESCALATE',
      'DONE',
    ]);
    const escalateAudit = ledger.auditLog.find((a) => a.agent === 'orchestrator' && a.action === 'ESCALATE');
    assert.match(escalateAudit.detail, /loopsUsed=2 >= maxLoops=2/);

    // No confirmed hypothesis anywhere in the ledger.
    assert.ok(ledger.hypotheses.length >= 1);
    assert.ok(ledger.hypotheses.every((h) => h.status !== 'confirmed'));

    // Escalation package written; openQuestions carry the missing info asks.
    const escalationPath = path.join(artifacts.dir, 'escalation.json');
    const pkg = JSON.parse(await readFile(escalationPath, 'utf8'));
    assert.ok(Array.isArray(pkg.openQuestions) && pkg.openQuestions.length > 0);
    assert.match(pkg.openQuestions.join(' '), /cluster id/);
    assert.match(pkg.openQuestions.join(' '), /period/);
    assert.ok(Array.isArray(pkg.suggestedNextSteps) && pkg.suggestedNextSteps.length > 0);
    // The ladder's reproduction-engineer ran the 'cost_reporting' sandbox
    // scenario (reproduced=true) even though no hypothesis was confirmed.
    assert.equal(pkg.reproductionStatus, 'reproduced');
    assert.ok(Array.isArray(pkg.evidenceDump));

    // No draft file exists.
    await assert.rejects(
      access(path.join(artifacts.dir, 'draft.md')),
      (err) => err.code === 'ENOENT'
    );

    // The escalation brain step was consumed exactly once.
    assert.equal(caseRecord.escalationReason, null); // VERIFY_FAIL path leaves reason unset
    assert.equal(caseRecord.triage.severity, 'P4');
    assert.deepEqual(caseRecord.triage.missingInfo, ['cluster id', 'numbers', 'period']);
  });
});
