import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedSandbox } from '../../src/adapters/sandbox/simulated-sandbox.js';

test('sandbox scenario replays identically on repeat (deep-equal, frozen)', async () => {
  const sandbox = new SimulatedSandbox({
    'sim-scenario-2': {
      reproduced: true,
      triggerConditions: ['spot interruption during rollout'],
      before: '3 nodes Ready',
      after: 'pod api-7f9 Pending',
      logs: ['event: FailedScheduling'],
    },
  });

  const first = await sandbox.run('sim-scenario-2');
  const second = await sandbox.run('sim-scenario-2');
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.triggerConditions), true);
  assert.equal(Object.isFrozen(first.logs), true);

  // caller mutation of the first result cannot poison the replay
  try {
    first.logs.push('tampered');
  } catch {
    // frozen: mutation throws in strict mode
  }
  const third = await sandbox.run('sim-scenario-2');
  assert.deepEqual(third, second);
  assert.deepEqual(third.logs, ['event: FailedScheduling']);
});

test('sandbox accepts {id, params} and passes params to fixture functions', async () => {
  const sandbox = new SimulatedSandbox({
    'sim-spot-churn': (params) => ({
      reproduced: params.interruptions >= 2,
      triggerConditions: [`${params.interruptions} interruptions in ${params.window}`],
      before: 'rollout healthy',
      after: 'pods restarting',
      logs: [],
    }),
  });

  const hit = await sandbox.run({ id: 'sim-spot-churn', params: { interruptions: 3, window: '10m' } });
  assert.equal(hit.reproduced, true);
  assert.deepEqual(hit.triggerConditions, ['3 interruptions in 10m']);

  const miss = await sandbox.run({ id: 'sim-spot-churn', params: { interruptions: 1, window: '10m' } });
  assert.equal(miss.reproduced, false);
});

test('unknown scenario id returns the frozen default result', async () => {
  const sandbox = new SimulatedSandbox();
  const result = await sandbox.run('no-such-scenario');
  assert.deepEqual(result, {
    reproduced: false,
    triggerConditions: [],
    before: 'unknown scenario',
    after: 'no change',
    logs: [],
  });
  assert.equal(Object.isFrozen(result), true);

  const objectForm = await sandbox.run({ id: 'also-missing', params: { x: 1 } });
  assert.deepEqual(objectForm, result);
});

test('registry values are copied per run: mutating a result does not affect the registry', async () => {
  const shared = { reproduced: true, triggerConditions: ['t'], before: 'b', after: 'a', logs: ['l'] };
  const sandbox = new SimulatedSandbox({ 'sim-shared': shared });

  const run1 = await sandbox.run('sim-shared');
  try {
    run1.triggerConditions.push('injected');
  } catch {
    // frozen
  }
  const run2 = await sandbox.run('sim-shared');
  assert.deepEqual(run2.triggerConditions, ['t']);
  // the raw registry entry itself is untouched
  assert.deepEqual(shared.triggerConditions, ['t']);
});
