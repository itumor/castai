import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EscalationAgent } from '../../../src/agents/escalation-agent.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger, addEvidence } from '../../../src/core/ledger.js';

const STEPS = { suggestedNextSteps: ['Collect autoscaler logs at debug level', 'Verify node group limits in the cloud console'] };

function makeAgent(ledger) {
  const brain = new ScriptedBrain({ defaultResponse: JSON.stringify(STEPS) });
  return new EscalationAgent({ key: 'escalation-agent', brain, ledger, adapters: {} });
}

describe('EscalationAgent', () => {
  test('package includes redacted evidenceDump, reproduction status, open questions and brain next steps', async () => {
    const ledger = createLedger('esc-case-1', null);
    // Planted secret with an identity redactFn — the agent's own redaction pass must mask it.
    addEvidence(ledger, {
      type: 'telemetry', source: 'mcp:get_cluster_nodes',
      result: 'API key castai_v1_supersecret123 found in autoscaler logs', reference: 'logs/autoscaler.txt',
      toolRun: { tool: 'mcp:get_cluster_nodes', args: { clusterId: 'c-1' }, ok: true },
    });
    addEvidence(ledger, {
      type: 'reproduction', source: 'sandbox:sim-scenario-1',
      result: 'Reproduced pending pods with the same node template', reference: 'sim-scenario-1',
      toolRun: { tool: 'sandbox:run', args: { scenario: 'sim-scenario-1' }, ok: true },
      reproduced: true,
    });

    const task = {
      reason: 'Root cause not identified after 2 verifier loops',
      openQuestions: ['Why did the autoscaler ignore the pending pods?'],
    };
    const result = await makeAgent(ledger).execute(task);
    assert.equal(result.ok, true, result.error ?? '');

    const pkg = result.output.escalationPackage;
    assert.equal(pkg.reproductionStatus, 'reproduced');
    assert.deepEqual(pkg.openQuestions, task.openQuestions);
    assert.deepEqual(pkg.suggestedNextSteps, STEPS.suggestedNextSteps);
    assert.match(pkg.summary, /Root cause not identified after 2 verifier loops/);

    const dumpJson = JSON.stringify(pkg.evidenceDump);
    assert.equal(pkg.evidenceDump.length, 2);
    assert.ok(!dumpJson.includes('supersecret123'), 'secret must be masked in evidenceDump');
    assert.ok(dumpJson.includes('castai_v1_[REDACTED]'));
    // Whole-package redaction: summary/next steps are redacted too.
    assert.ok(!JSON.stringify(pkg).includes('supersecret123'));
  });

  test('no reproduction evidence → reproductionStatus not_attempted', async () => {
    const ledger = createLedger('esc-case-2', null);
    const result = await makeAgent(ledger).execute({ reason: 'No sandbox available' });
    assert.equal(result.ok, true, result.error ?? '');
    const pkg = result.output.escalationPackage;
    assert.equal(pkg.reproductionStatus, 'not_attempted');
    assert.deepEqual(pkg.evidenceDump, []);
    assert.deepEqual(pkg.openQuestions, []);
  });

  test('reproduction evidence with reproduced=false → not_reproduced', async () => {
    const ledger = createLedger('esc-case-3', null);
    addEvidence(ledger, {
      type: 'reproduction', source: 'sandbox:sim-scenario-2',
      result: 'Could not reproduce in sandbox', reference: 'sim-scenario-2',
      toolRun: { tool: 'sandbox:run', args: { scenario: 'sim-scenario-2' }, ok: true },
      reproduced: false,
    });
    const result = await makeAgent(ledger).execute({ reason: 'unconfirmed' });
    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.escalationPackage.reproductionStatus, 'not_reproduced');
  });
});
