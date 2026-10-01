import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KnowledgeAgent } from '../../../src/agents/knowledge-agent.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger, setSolution } from '../../../src/core/ledger.js';

const SHOULD_NOT_BE_WRITTEN = 'out/kb-proposals-test/runbook-node-scaling.md';
const PROPOSALS = {
  proposals: [
    {
      title: 'Runbook: node template misconfiguration blocks scaling',
      text: 'Symptom: nodes not scaling down.\nSteps: check node template, verify autoscaler state.',
      targetPath: SHOULD_NOT_BE_WRITTEN,
    },
    { title: 'KB: autoscaler cooldown defaults', text: 'Cooldown defaults and where to change them.' }, // no targetPath → default
  ],
};

function makeAgent(ledger, brain) {
  return new KnowledgeAgent({ key: 'knowledge-agent', brain, ledger, adapters: {} });
}

describe('KnowledgeAgent', () => {
  test('returns proposal text with targetPath and never writes files', async () => {
    const ledger = createLedger('kb-agent-case-1', null);
    setSolution(ledger, 'verified', 'Node template corrected; scaling restored');
    const brain = new ScriptedBrain({ defaultResponse: JSON.stringify(PROPOSALS) });
    const agent = makeAgent(ledger, brain);

    const result = await agent.execute({});
    assert.equal(result.ok, true, result.error ?? '');

    const proposals = result.output.proposals;
    assert.equal(proposals.length, 2);
    assert.equal(proposals[0].title, PROPOSALS.proposals[0].title);
    assert.equal(proposals[0].targetPath, SHOULD_NOT_BE_WRITTEN);
    assert.match(proposals[0].text, /nodes not scaling down/);
    // Brain omitted targetPath → deterministic default under out/knowledge-proposals/.
    assert.equal(proposals[1].targetPath, 'out/knowledge-proposals/kb-autoscaler-cooldown-defaults.md');

    // No fs writes: neither the proposed file nor its directory may exist after the run.
    assert.equal(fs.existsSync(SHOULD_NOT_BE_WRITTEN), false);
    assert.equal(fs.existsSync('out/kb-proposals-test'), false);
    assert.equal(fs.existsSync('out/knowledge-proposals'), false);
  });

  test('malformed brain output → ok:false', async () => {
    const ledger = createLedger('kb-agent-case-2', null);
    const brain = new ScriptedBrain({ defaultResponse: 'not json at all' });
    const result = await makeAgent(ledger, brain).execute({});
    assert.equal(result.ok, false);
    assert.equal(result.output, null);
    assert.match(result.error, /non-JSON proposals/);
  });

  test('empty proposals array → ok:false', async () => {
    const ledger = createLedger('kb-agent-case-3', null);
    const brain = new ScriptedBrain({ defaultResponse: '{"proposals":[]}' });
    const result = await makeAgent(ledger, brain).execute({});
    assert.equal(result.ok, false);
    assert.match(result.error, /at least one proposal/);
  });
});
