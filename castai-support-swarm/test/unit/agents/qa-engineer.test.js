import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QaEngineerAgent } from '../../../src/agents/qa-engineer.js';
import { SimulatedSandbox } from '../../../src/adapters/sandbox/simulated-sandbox.js';
import { MockCastaiTools } from '../../../src/adapters/castai/mock-castai-tools.js';
import { createLedger } from '../../../src/core/ledger.js';

const NOT_RUN = { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' };

function scenarioResult(reproduced, label) {
  return {
    reproduced,
    triggerConditions: reproduced ? ['trigger fired'] : [],
    before: `${label} trigger attempted`,
    after: reproduced ? `${label} issue still reproduces` : `${label} no failure`,
    logs: [],
  };
}

function makeSandbox(overrides = {}) {
  return new SimulatedSandbox({
    'qa-unit': scenarioResult(false, 'unit'),
    'qa-integration': scenarioResult(true, 'integration'),
    'qa-e2e': scenarioResult(false, 'e2e'),
    'qa-regression': scenarioResult(false, 'regression'),
    ...overrides,
  });
}

/** Recording wrapper so tests can observe which scenarios the agent ran. */
function recording(sandbox, calls) {
  return {
    run: async (scenario) => {
      calls.push(typeof scenario === 'string' ? scenario : scenario?.id);
      return await sandbox.run(scenario);
    },
  };
}

describe('QaEngineerAgent', () => {
  test('runs all four scenarios and maps outcomes into ledger.tests', async () => {
    const calls = [];
    const sandbox = makeSandbox();
    const ledger = createLedger('case-qa', null);
    const agent = new QaEngineerAgent({
      brain: null, // deterministic role: no brain needed
      ledger,
      adapters: { sandbox: recording(sandbox, calls) },
    });

    const result = await agent.execute({});

    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(calls, ['qa-unit', 'qa-integration', 'qa-e2e', 'qa-regression']);
    // reproduced:false → passed; reproduced:true → failed.
    assert.deepEqual(ledger.tests, {
      unit: 'passed', integration: 'failed', e2e: 'passed', regression: 'passed',
    });
    assert.deepEqual(result.output.tests, ledger.tests);
    assert.deepEqual(result.output.ran, [
      { level: 'unit', scenario: 'qa-unit', passed: true },
      { level: 'integration', scenario: 'qa-integration', passed: false },
      { level: 'e2e', scenario: 'qa-e2e', passed: true },
      { level: 'regression', scenario: 'qa-regression', passed: true },
    ]);
  });

  test('e2e pass appends one test evidence entry with ok:true toolRun', async () => {
    const ledger = createLedger('case-qa-2', null);
    const agent = new QaEngineerAgent({
      brain: null, ledger, adapters: { sandbox: makeSandbox() },
    });

    const result = await agent.execute({});

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(ledger.evidence.length, 1); // only the e2e outcome lands as evidence
    const ev = ledger.evidence[0];
    assert.equal(ev.type, 'test');
    assert.equal(ev.source, 'sandbox:qa-e2e');
    assert.equal(ev.reference, 'qa-e2e');
    assert.equal(ev.toolRun.tool, 'sandbox.run');
    assert.equal(ev.toolRun.ok, true); // pass flag
    assert.match(ev.result, /e2e passed/);
    assert.deepEqual(result.evidenceIds, ['E1']);
  });

  test('e2e failure appends test evidence with ok:false and marks the level failed', async () => {
    const ledger = createLedger('case-qa-3', null);
    const agent = new QaEngineerAgent({
      brain: null,
      ledger,
      adapters: { sandbox: makeSandbox({ 'qa-e2e': scenarioResult(true, 'e2e') }) },
    });

    const result = await agent.execute({});

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(ledger.tests.e2e, 'failed');
    assert.equal(ledger.evidence.length, 1);
    assert.equal(ledger.evidence[0].toolRun.ok, false);
    assert.match(ledger.evidence[0].result, /e2e failed/);
  });

  test('scenarios missing from the registry reproduce:false → passed', async () => {
    const ledger = createLedger('case-qa-4', null);
    const agent = new QaEngineerAgent({
      brain: null, ledger, adapters: { sandbox: new SimulatedSandbox({}) },
    });

    const result = await agent.execute({});

    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(ledger.tests, { unit: 'passed', integration: 'passed', e2e: 'passed', regression: 'passed' });
  });

  test('sandbox absent → all levels stay not_run', async () => {
    const ledger = createLedger('case-qa-5', null);
    const agent = new QaEngineerAgent({ brain: null, ledger, adapters: {} });

    const result = await agent.execute({});

    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(ledger.tests, NOT_RUN);
    assert.deepEqual(result.output.ran, []);
    assert.equal(ledger.evidence.length, 0);
  });

  test('castai adapter present but never touched', async () => {
    const castai = new MockCastaiTools({});
    const ledger = createLedger('case-qa-6', null);
    const agent = new QaEngineerAgent({
      brain: null, ledger, adapters: { sandbox: makeSandbox(), castai },
    });

    const result = await agent.execute({});

    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(castai.calls, []);
  });
});
