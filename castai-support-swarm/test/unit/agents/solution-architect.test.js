import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolutionArchitectAgent } from '../../../src/agents/solution-architect.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger } from '../../../src/core/ledger.js';

const KB_HIT = { path: 'docs/arch/hpa-interactions.md', excerpt: 'HPA and Workload Autoscaler interactions' };

function fakeKb({ hits = [KB_HIT] } = {}) {
  return {
    search: async () => hits,
    read: async (path) => ({ path, content: 'Architecture guidance: rollout order and rollback for autoscalers.' }),
  };
}

function makeAgent(ledger, kb, fit, notes) {
  const brain = new ScriptedBrain({ defaultResponse: JSON.stringify({ fit, notes }) });
  return new SolutionArchitectAgent({ key: 'solution-architect', brain, ledger, adapters: { kb } });
}

describe('SolutionArchitectAgent', () => {
  test('ok path: brain fit ok + KB evidence appended as documentation', async () => {
    const ledger = createLedger('arch-case-1', null);
    const notes = 'Rollout is safe: rollback path exists; no HPA/VPA conflict with Workload Autoscaler.';
    const agent = makeAgent(ledger, fakeKb(), 'ok', notes);

    const result = await agent.execute({
      proposedSolution: 'Correct the node template and let the node autoscaler rebalance',
    });
    assert.equal(result.ok, true, result.error ?? '');

    const review = result.output.architectureReview;
    assert.equal(review.fit, 'ok');
    assert.equal(review.notes, notes);
    assert.equal(review.evidenceIds.length, 1);
    assert.deepEqual(review.evidenceIds, ['E1']);
    assert.equal(ledger.evidence.length, 1);
    const ev = ledger.evidence[0];
    assert.equal(ev.type, 'documentation');
    assert.equal(ev.source, `kb:${KB_HIT.path}`);
    assert.equal(ev.reference, KB_HIT.path);
  });

  test('concerns path: brain flags concerns, no KB hits → no evidence appended', async () => {
    const ledger = createLedger('arch-case-2', null);
    const notes = 'No rollback path documented; HPA may conflict with Workload Autoscaler.';
    const agent = makeAgent(ledger, fakeKb({ hits: [] }), 'concerns', notes);

    const result = await agent.execute({
      proposedSolution: 'Install workload autoscaler alongside existing HPAs without coordination',
    });
    assert.equal(result.ok, true, result.error ?? '');

    const review = result.output.architectureReview;
    assert.equal(review.fit, 'concerns');
    assert.equal(review.notes, notes);
    assert.deepEqual(review.evidenceIds, []);
    assert.equal(ledger.evidence.length, 0);
  });

  test('missing proposedSolution → ok:false; malformed brain fit → ok:false', async () => {
    const ledger = createLedger('arch-case-3', null);
    const missing = await makeAgent(ledger, fakeKb(), 'ok', 'notes').execute({});
    assert.equal(missing.ok, false);
    assert.match(missing.error, /proposedSolution/);

    const badFit = await makeAgent(ledger, fakeKb(), 'maybe', 'notes').execute({
      proposedSolution: 'some fix',
    });
    assert.equal(badFit.ok, false);
    assert.match(badFit.error, /fit/);
  });
});
