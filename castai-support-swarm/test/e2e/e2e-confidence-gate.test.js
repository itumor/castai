// Chunk 16 — e2e case 4: confidence gate after a PASSING verdict.
//
// The verifier PASSes (single claim backed by code + telemetry evidence), but
// the sandbox cannot reproduce the issue and the QA levels fail, so
// scoreFromLedger stays at 35 (code 25 + telemetry 10) < 60 -> the
// orchestrator emits ESCALATE with reason 'low-confidence', folds the plan's
// missingInfoQuestions into the escalation package and produces no draft.
// This is the exact shape specified in orchestrator revision 5 (d) / chunk 16
// accept (4); the verification ladder runs but contributes no points here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runE2eCase, orchestratorEvents } from './helpers.js';

describe('e2e case 4 — verifier PASS with thin evidence hits the confidence gate', () => {
  test('pass=true but confidence < 60 -> escalated low-confidence, no draft', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'swarm-e2e-case4-'));
    // Thin sandbox: the reproduction scenario does NOT reproduce and every QA
    // level fails, so the ladder adds no confidence points.
    const failScenario = {
      reproduced: true,
      triggerConditions: ['report generation always drifts'],
      before: 'report totals differ',
      after: 'still differ',
      logs: ['thin scenario: issue persists'],
    };
    const { caseRecord, ledger, verdict, draftPost, artifacts } = await runE2eCase(
      'savings-vague-email.md',
      'savings-thin-brain.json',
      {
        clusterId: null,
        reproKey: 'cost_reporting',
        outDir,
        sandboxScenarios: {
          cost_reporting: { ...failScenario, reproduced: false },
          'qa-unit': { ...failScenario },
          'qa-integration': { ...failScenario },
          'qa-e2e': { ...failScenario },
          'qa-regression': { ...failScenario },
        },
      }
    );

    // The verdict itself passed, but the deterministic scorer rated the
    // ledger thin (code + telemetry only; no documentation, reproduction or
    // passing e2e) -> below the 60 gate.
    assert.equal(verdict.pass, true);
    assert.equal(ledger.confidence, 35, 'code 25 + telemetry 10, ladder adds nothing here');
    assert.ok(ledger.solution.status === 'escalated' || ledger.solution.status === 'proposed');
    assert.equal(draftPost, null);
    assert.equal(caseRecord.status, 'done');

    // History: the pass was converted into ESCALATE (low-confidence).
    assert.deepEqual(orchestratorEvents(ledger), [
      'TRIAGED', 'PLAN_READY', 'PLAN_BUILT', 'INVESTIGATION_DONE',
      'ESCALATE', 'DONE',
    ]);
    const escalateAudit = ledger.auditLog.find((a) => a.agent === 'orchestrator' && a.action === 'ESCALATE');
    assert.match(escalateAudit.detail, /low-confidence/);
    assert.match(escalateAudit.detail, /< 60/);
    assert.equal(caseRecord.escalationReason, 'low-confidence');

    // Escalation package exists and folds the plan's missing-info questions in.
    const escalationPath = path.join(artifacts.dir, 'escalation.json');
    const pkg = JSON.parse(await readFile(escalationPath, 'utf8'));
    assert.ok(Array.isArray(pkg.openQuestions) && pkg.openQuestions.length > 0);
    assert.match(pkg.openQuestions.join(' '), /realized savings values/);
    assert.match(pkg.openQuestions.join(' '), /report period/);
    assert.ok(pkg.suggestedNextSteps.length > 0);

    // No draft file exists.
    await assert.rejects(
      access(path.join(artifacts.dir, 'draft.md')),
      (err) => err.code === 'ENOENT'
    );
  });
});
