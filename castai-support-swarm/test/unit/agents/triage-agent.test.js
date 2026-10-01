import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TriageAgent, parseEmailBasics } from '../../../src/agents/triage-agent.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger } from '../../../src/core/ledger.js';

// Spec §6 case 1 — EKS IAM PutRolePolicy 403 fixture email.
const PUTROLEPOLICY_EMAIL = {
  from: 'Samuel Frunza <samuel.frunza@customer.example.com>',
  fromName: 'Samuel Frunza',
  fromFirstName: 'Samuel',
  subject: 'CAST AI onboarding fails: iam:PutRolePolicy 403',
  body:
    "Hi — we're connecting our EKS test cluster (siemenstest-siemenstest-1, eu-west-1, " +
    'AWS account 951463557399) to CAST AI in full mode. The connect run gets most of the ' +
    'way through, then fails with "iam:PutRolePolicy" 403 on the role cast-eks-…-36575565. ' +
    'Read-only onboarding worked fine earlier today. What permission are we missing, and ' +
    'is there a Terraform workaround?',
  thread: [],
};

const VALID_BRAIN_JSON = JSON.stringify({
  orgId: null,
  clusterId: null,
  provider: 'unknown',
  castaiMode: 'unknown',
  components: ['castai-agent'],
  issueCategory: 'iam',
  severity: 'P1',
  expected: 'Onboarding completes with the CAST AI role policy attached',
  actual: 'connect fails with iam:PutRolePolicy 403',
  missingInfo: [],
});

function brainReturning(response) {
  return new ScriptedBrain({ defaultResponse: response });
}

describe('parseEmailBasics()', () => {
  test('extracts provider, mode, account and cluster tokens from the case-1 fixture', () => {
    const basics = parseEmailBasics(PUTROLEPOLICY_EMAIL);
    assert.equal(basics.provider, 'eks');
    // "in full mode" appears after "Read-only" — the latest mode statement wins.
    assert.equal(basics.castaiMode, 'full');
    assert.equal(basics.accountId, '951463557399');
    assert.equal(basics.clusterName, 'siemenstest-siemenstest-1');
    assert.equal(basics.orgId, null);
    assert.equal(basics.clusterId, null);
    assert.ok(Array.isArray(basics.components));
  });

  test('extracts UUID-labelled org and cluster ids and component keywords', () => {
    const basics = parseEmailBasics({
      subject: 'Cluster controller crash',
      body:
        'org id: 11111111-1111-4111-8111-111111111111, ' +
        'clusterId 22222222-2222-4222-8222-222222222222 — the cluster-controller pod ' +
        'crashloops and the spot-handler logs are empty. We run GKE.',
      fromFirstName: 'Dana',
    });
    assert.equal(basics.orgId, '11111111-1111-4111-8111-111111111111');
    assert.equal(basics.clusterId, '22222222-2222-4222-8222-222222222222');
    assert.equal(basics.provider, 'gke');
    assert.deepEqual(basics.components, ['cluster-controller', 'spot-handler']);
  });
});

describe('TriageAgent', () => {
  test('case-1 fixture: eks + iam + first name stored on ledger', async () => {
    const ledger = createLedger('case-1', null);
    const agent = new TriageAgent({
      brain: brainReturning(VALID_BRAIN_JSON),
      ledger,
      adapters: {},
    });
    const result = await agent.execute({ email: PUTROLEPOLICY_EMAIL });

    assert.equal(result.ok, true, `expected ok, got error: ${result.error}`);
    const facts = result.output.triageFacts;
    assert.equal(facts.provider, 'eks');           // regex wins over brain 'unknown'
    assert.equal(facts.issueCategory, 'iam');
    assert.equal(facts.severity, 'P1');
    assert.deepEqual(facts.components, ['castai-agent']);
    assert.equal(facts.expected, 'Onboarding completes with the CAST AI role policy attached');
    // Downstream linter needs the customer's first name.
    assert.equal(ledger.customerFirstName, 'Samuel');
    assert.equal(ledger.provider, 'eks');
    assert.ok(ledger.auditLog.some((e) => e.agent === 'triage' && e.action === 'triage_complete'));
    assert.deepEqual(result.evidenceIds, []);
  });

  test('regex-extracted UUIDs win over brain-provided ids', async () => {
    const brainJson = JSON.stringify({
      ...JSON.parse(VALID_BRAIN_JSON),
      orgId: '99999999-9999-4999-8999-999999999999',
      clusterId: '88888888-8888-4888-8888-888888888888',
      issueCategory: 'onboarding',
    });
    const agent = new TriageAgent({
      brain: brainReturning(brainJson),
      ledger: createLedger('case-2', null),
    });
    const result = await agent.execute({
      email: {
        ...PUTROLEPOLICY_EMAIL,
        body:
          'org id: 11111111-1111-4111-8111-111111111111, ' +
          'clusterId 22222222-2222-4222-8222-222222222222. ' +
          PUTROLEPOLICY_EMAIL.body,
      },
    });
    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.triageFacts.orgId, '11111111-1111-4111-8111-111111111111');
    assert.equal(result.output.triageFacts.clusterId, '22222222-2222-4222-8222-222222222222');
    assert.equal(result.output.triageFacts.issueCategory, 'onboarding');
  });

  test('invalid brain JSON → exactly ONE retry with errors → ok:false on second invalid', async () => {
    let calls = 0;
    const prompts = [];
    const brain = {
      complete: async (messages) => {
        calls += 1;
        prompts.push(messages.at(-1).content);
        return calls === 1 ? '{{definitely not json' : '{"issueCategory":"nope","severity":"P0"}';
      },
    };
    const agent = new TriageAgent({ brain, ledger: createLedger('case-3', null) });
    const result = await agent.execute({ email: PUTROLEPOLICY_EMAIL });

    assert.equal(calls, 2, 'brain must be called exactly twice (initial + one retry)');
    assert.equal(result.ok, false);
    assert.equal(result.output, null);
    assert.match(result.error, /invalid TriageFacts after one retry/);
    assert.match(result.error, /issueCategory/);
    // The retry prompt carries the first attempt's errors.
    assert.ok(prompts[1].includes('previousAttemptErrors'));
  });

  test('one retry after invalid JSON succeeds when the second answer is valid', async () => {
    let calls = 0;
    const brain = {
      complete: async () => {
        calls += 1;
        return calls === 1 ? 'nope' : VALID_BRAIN_JSON;
      },
    };
    const agent = new TriageAgent({ brain, ledger: createLedger('case-4', null) });
    const result = await agent.execute({ email: PUTROLEPOLICY_EMAIL });
    assert.equal(calls, 2);
    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.triageFacts.issueCategory, 'iam');
  });

  test('a thrown brain error surfaces as ok:false via execute (no retry)', async () => {
    let calls = 0;
    const brain = {
      complete: async () => { calls += 1; throw new Error('connection refused'); },
    };
    const agent = new TriageAgent({ brain, ledger: createLedger('case-5', null) });
    const result = await agent.execute({ email: PUTROLEPOLICY_EMAIL });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.match(result.error, /connection refused/);
  });

  test('missing email in task → ok:false', async () => {
    const agent = new TriageAgent({ brain: brainReturning(VALID_BRAIN_JSON), ledger: createLedger('c', null) });
    const result = await agent.execute({});
    assert.equal(result.ok, false);
    assert.match(result.error, /EmailInput/);
  });
});
