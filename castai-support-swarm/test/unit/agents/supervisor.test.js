import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorAgent } from '../../../src/agents/supervisor.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger } from '../../../src/core/ledger.js';

const IAM_TRIAGE = {
  orgId: null,
  clusterId: null,
  provider: 'eks',
  castaiMode: 'full',
  components: ['castai-agent'],
  issueCategory: 'iam',
  severity: 'P1',
  expected: 'Onboarding completes with the CAST AI role policy attached',
  actual: 'connect fails with iam:PutRolePolicy 403',
  missingInfo: ['IAM policy JSON for the cast-eks role'],
};

function makeAgent(ledger) {
  // The supervisor is pure planning — the brain is unused by _run.
  return new SupervisorAgent({
    brain: new ScriptedBrain({ defaultResponse: '{}' }),
    ledger: ledger ?? createLedger('plan-case', null),
    adapters: {},
  });
}

describe('SupervisorAgent', () => {
  test('iam plan includes cloud-security-engineer, excludes reproduction-engineer', async () => {
    const ledger = createLedger('plan-case', null);
    const agent = makeAgent(ledger);
    const result = await agent.execute({ triage: IAM_TRIAGE });

    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
    const plan = result.output.plan;

    // Exact specialist subset from CAPABILITY_ROUTES['iam'].
    assert.deepEqual(plan.agentSubset,
      ['docs-researcher', 'cloud-security-engineer', 'product-engineer']);
    assert.ok(plan.agentSubset.includes('cloud-security-engineer'));
    assert.ok(!plan.agentSubset.includes('reproduction-engineer'));
    // Orchestrator-appended roles are never routed by the supervisor.
    assert.ok(!plan.agentSubset.includes('verifier'));
    assert.ok(!plan.agentSubset.includes('support-writer'));
    assert.ok(!plan.agentSubset.includes('supervisor'));

    // One-line task per routed agent.
    assert.deepEqual(Object.keys(plan.tasksPerAgent).sort(), [...plan.agentSubset].sort());
    for (const task of Object.values(plan.tasksPerAgent)) {
      assert.equal(typeof task, 'string');
      assert.match(task, /iam/);
      assert.match(task, /PutRolePolicy 403/);
    }

    // missingInfoQuestions come from triage.missingInfo.
    assert.deepEqual(plan.missingInfoQuestions, IAM_TRIAGE.missingInfo);
    assert.ok(ledger.auditLog.some((e) => e.agent === 'supervisor' && e.action === 'plan_built'));
  });

  test('re-investigation round folds openQuestions into every task', async () => {
    const agent = makeAgent();
    const openQuestions = [
      'Does the deployer role policy allow iam:GetRolePolicy?',
      'Is an SCP explicitly denying PutRolePolicy attached?',
    ];
    const result = await agent.execute({ triage: IAM_TRIAGE, openQuestions });
    assert.equal(result.ok, true, result.error ?? '');
    const plan = result.output.plan;

    for (const task of Object.values(plan.tasksPerAgent)) {
      assert.match(task, /Re-investigation must also resolve/);
      assert.ok(openQuestions.every((q) => task.includes(q)));
    }
    // Missing-info questions are unchanged by openQuestions (they go to tasks).
    assert.deepEqual(plan.missingInfoQuestions, IAM_TRIAGE.missingInfo);
  });

  test('missing triage → ok:false', async () => {
    const agent = makeAgent();
    const result = await agent.execute({});
    assert.equal(result.ok, false);
    assert.match(result.error, /task\.triage/);
  });

  test('unknown issueCategory → ok:false (router throws)', async () => {
    const agent = makeAgent();
    const result = await agent.execute({
      triage: { ...IAM_TRIAGE, issueCategory: 'not-a-category' },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /unknown issueCategory/);
  });
});
