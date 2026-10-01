import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SupportWriterAgent } from '../../../src/agents/support-writer.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger, addEvidence } from '../../../src/core/ledger.js';
import { PermissionError } from '../../../src/permissions.js';

const GOOD_BODY =
  'Hi Erik,\n\n' +
  'We checked the node template configuration in your CAST AI console and applied the ' +
  'corrected settings. Node scaling is now behaving as expected.\n\n' +
  'If you notice anything else, please reply to this thread.\n\n' +
  'Best regards,\nCAST AI Support';
// Violates the claim-honesty rule: claims a reproduction the ledger does not back.
const BAD_BODY = 'I reproduced the fix and it works.';

/** Brain that records every complete() call and replays scripted responses in order. */
class RecordingBrain {
  constructor(responses) {
    this.calls = [];
    this.responses = responses;
  }
  async complete(messages, opts = {}) {
    this.calls.push({ messages, opts });
    const idx = Math.min(this.calls.length - 1, this.responses.length - 1);
    return this.responses[idx];
  }
}

function makeLedger(caseId) {
  const ledger = createLedger(caseId, null);
  addEvidence(ledger, {
    type: 'documentation', source: 'kb:docs/node-templates.md',
    result: 'Node template correction documented', reference: 'docs/node-templates.md',
  });
  ledger.customerQuestion = ['Why are my nodes not scaling down?'];
  ledger.customerFirstName = 'Erik';
  ledger.confidence = 85;
  return ledger;
}

const VERDICT = {
  pass: true,
  claims: [{ claim: 'The node template was misconfigured and has been corrected', classification: 'DOCUMENTED', evidenceIds: ['E1'] }],
  reason: 'All 1 claim(s) are evidence-backed: DOCUMENTED',
  openQuestions: null,
};

const TASK = { verdict: VERDICT, route: 'answer_with_evidence', to: 'erik@example.com', subject: 'Node scaling issue' };

describe('SupportWriterAgent', () => {
  test('first draft fails lint → retry prompt contains the violation → second response passes', async () => {
    const ledger = makeLedger('w-case-1');
    const brain = new RecordingBrain([BAD_BODY, GOOD_BODY]);
    const agent = new SupportWriterAgent({ key: 'support-writer', brain, ledger, adapters: {} });

    const result = await agent.execute(TASK);
    assert.equal(result.ok, true, result.error ?? '');

    const draft = result.output.draft;
    assert.equal(draft.to, 'erik@example.com');
    assert.equal(draft.subject, 'Re: Node scaling issue');
    assert.equal(draft.body, GOOD_BODY);
    assert.equal(draft.caseId, 'w-case-1');
    assert.equal(draft.confidence, 85);
    assert.equal(draft.route, 'answer_with_evidence');
    assert.deepEqual(draft.unresolvedClaims, []);

    // Exactly two brain calls; the retry prompt carries the lint violations.
    assert.equal(brain.calls.length, 2);
    const retryUser = [...brain.calls[1].messages].reverse().find((m) => m.role === 'user');
    assert.ok(retryUser, 'retry prompt must have a user message');
    assert.match(retryUser.content, /reproduced/); // violation phrase fed back
    assert.match(retryUser.content, /lintViolations/);
    assert.equal(brain.calls[1].opts.tag, 'support-writer:draft-retry');
  });

  test('castai and k8s adapter access throws PermissionError (draft-only permissions)', () => {
    const ledger = makeLedger('w-case-2');
    const brain = new RecordingBrain([GOOD_BODY]);
    const agent = new SupportWriterAgent({ key: 'support-writer', brain, ledger, adapters: {} });
    assert.throws(() => agent.adapters.castai, PermissionError);
    assert.throws(() => agent.adapters.k8s, PermissionError);
    assert.throws(() => agent.adapters.kb, PermissionError);
  });

  test('lint still failing after the single retry → ok:false', async () => {
    const ledger = makeLedger('w-case-3');
    const brain = new ScriptedBrain({ defaultResponse: BAD_BODY }); // both attempts violate
    const agent = new SupportWriterAgent({ key: 'support-writer', brain, ledger, adapters: {} });

    const result = await agent.execute(TASK);
    assert.equal(result.ok, false);
    assert.equal(result.output, null);
    assert.match(result.error, /failed lint after retry/);
    assert.match(result.error, /reproduced/);
  });

  test('unresolvedClaims lists non-passed verdict claims, passed claims drive the body', async () => {
    const ledger = makeLedger('w-case-4');
    const brain = new RecordingBrain([GOOD_BODY]);
    const agent = new SupportWriterAgent({ key: 'support-writer', brain, ledger, adapters: {} });

    const verdict = {
      pass: true,
      claims: [
        VERDICT.claims[0],
        { claim: 'Unrelated cluster rebuild suspicion', classification: 'INFERRED', evidenceIds: [] },
      ],
      reason: 'mixed',
      openQuestions: ['What about the cluster rebuild?'],
    };
    const result = await agent.execute({ ...TASK, verdict });
    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(result.output.draft.unresolvedClaims, ['Unrelated cluster rebuild suspicion']);
  });
});
