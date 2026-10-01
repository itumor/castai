import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ReproductionEngineerAgent } from '../../../src/agents/reproduction-engineer.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { SimulatedSandbox } from '../../../src/adapters/sandbox/simulated-sandbox.js';
import { MockCastaiTools } from '../../../src/adapters/castai/mock-castai-tools.js';
import { createLedger } from '../../../src/core/ledger.js';

function makeSandbox() {
  return new SimulatedSandbox({
    'repro-pending-pods': {
      reproduced: true,
      triggerConditions: ['node pressure', 'PDB blocks eviction'],
      before: 'deployment wants 3 replicas',
      after: 'pod stuck Pending',
      logs: ['event: FailedScheduling'],
    },
    'repro-node_upscale': {
      reproduced: false,
      triggerConditions: [],
      before: 'upscale requested',
      after: 'node joined and became Ready',
      logs: [],
    },
  });
}

describe('ReproductionEngineerAgent', () => {
  test('runs the task scenario and copies the sandbox reproduced flag into evidence', async () => {
    const sandbox = makeSandbox();
    const ledger = createLedger('case-repro', null);
    const brain = new ScriptedBrain({
      defaultResponse: JSON.stringify({ summary: 'Issue reproduces under node pressure' }),
    });
    const agent = new ReproductionEngineerAgent({
      brain, ledger, adapters: { sandbox },
    });

    const result = await agent.execute({
      scenario: { id: 'repro-pending-pods', params: { replicas: 3 } },
    });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.scenario, 'repro-pending-pods');
    assert.equal(result.output.reproduced, true);
    assert.deepEqual(result.output.triggerConditions, ['node pressure', 'PDB blocks eviction']);
    assert.equal(result.output.before, 'deployment wants 3 replicas');
    assert.equal(result.output.after, 'pod stuck Pending');
    assert.equal(result.output.summary, 'Issue reproduces under node pressure');

    assert.equal(ledger.evidence.length, 1);
    const ev = ledger.evidence[0];
    assert.equal(ev.type, 'reproduction');
    assert.equal(ev.source, 'sandbox:repro-pending-pods');
    assert.equal(ev.reproduced, true); // copied verbatim from the sandbox result
    assert.equal(ev.reference, 'repro-pending-pods');
    assert.match(ev.result, /deployment wants 3 replicas/);
    assert.deepEqual(ev.toolRun, {
      tool: 'sandbox.run',
      args: { id: 'repro-pending-pods', params: { replicas: 3 } },
      ok: true,
    });
    assert.deepEqual(result.evidenceIds, ['E1']);
  });

  test('reproduced:false scenario and default scenario derived from issueCategory', async () => {
    const sandbox = makeSandbox();
    const ledger = createLedger('case-repro-2', null);
    const agent = new ReproductionEngineerAgent({
      brain: new ScriptedBrain({ steps: [] }), // never called with a matching rule
      ledger,
      adapters: { sandbox },
    });

    const result = await agent.execute({ issueCategory: 'node_upscale' });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.scenario, 'repro-node_upscale');
    assert.equal(result.output.reproduced, false);
    assert.equal(ledger.evidence[0].reproduced, false);
    assert.equal(ledger.evidence[0].source, 'sandbox:repro-node_upscale');
  });

  test('string scenario id and castai adapter never touched', async () => {
    const sandbox = makeSandbox();
    const castai = new MockCastaiTools({});
    const ledger = createLedger('case-repro-3', null);
    const agent = new ReproductionEngineerAgent({
      brain: new ScriptedBrain({ steps: [] }),
      ledger,
      adapters: { sandbox, castai }, // castai present but not granted for this role
    });

    const result = await agent.execute({ scenario: 'repro-pending-pods' });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.reproduced, true);
    // The agent never touched the castai adapter despite it being injected.
    assert.deepEqual(castai.calls, []);
    assert.deepEqual(ledger.evidence[0].toolRun, {
      tool: 'sandbox.run', args: { id: 'repro-pending-pods' }, ok: true,
    });
  });

  test('no brain and failing brain both degrade to ok:true without summary', async () => {
    const sandbox = makeSandbox();
    const ledgerNoBrain = createLedger('case-repro-4', null);
    const agentNoBrain = new ReproductionEngineerAgent({
      brain: null, ledger: ledgerNoBrain, adapters: { sandbox },
    });
    const resultNoBrain = await agentNoBrain.execute({ scenario: 'repro-pending-pods' });
    assert.equal(resultNoBrain.ok, true);
    assert.equal(resultNoBrain.output.summary, undefined);

    // A ScriptedBrain with no matching rule throws → summary dropped, run still ok.
    const ledgerFailingBrain = createLedger('case-repro-5', null);
    const agentFailingBrain = new ReproductionEngineerAgent({
      brain: new ScriptedBrain({ steps: [] }),
      ledger: ledgerFailingBrain,
      adapters: { sandbox },
    });
    const resultFailing = await agentFailingBrain.execute({ scenario: 'repro-pending-pods' });
    assert.equal(resultFailing.ok, true);
    assert.equal(resultFailing.output.summary, undefined);
    assert.equal(resultFailing.output.reproduced, true);
  });

  test('missing sandbox adapter → ok:false', async () => {
    const agent = new ReproductionEngineerAgent({
      brain: new ScriptedBrain({ steps: [] }),
      ledger: createLedger('case-repro-6', null),
      adapters: {},
    });
    const result = await agent.execute({ scenario: 'repro-pending-pods' });
    assert.equal(result.ok, false);
    assert.match(result.error, /sandbox/);
  });
});
