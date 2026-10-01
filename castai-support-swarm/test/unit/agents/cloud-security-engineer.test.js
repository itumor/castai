import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CloudSecurityEngineerAgent } from '../../../src/agents/cloud-security-engineer.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { MockCastaiTools } from '../../../src/adapters/castai/mock-castai-tools.js';
import { createLedger } from '../../../src/core/ledger.js';

const CLUSTER_ID = '22222222-2222-2222-2222-222222222222';
const KB_PATH = 'kb/iam-putrolepolicy-403.md';

const KB_DOCS = {
  [KB_PATH]: {
    excerpt: 'PutRolePolicy 403 means the deploying role lacks iam:PutRolePolicy.',
    content:
      'The API returns 403 on iam:PutRolePolicy when the calling role lacks the permission. ' +
      'Grant iam:PutRolePolicy on the cast- role to attach policies.',
  },
};

function makeKb() {
  return {
    async search({ query }) {
      const tokens = String(query ?? '').toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      return Object.entries(KB_DOCS)
        .filter(([p, d]) => tokens.some((t) => `${p} ${d.content}`.toLowerCase().includes(t)))
        .map(([path, d]) => ({ path, excerpt: d.excerpt, score: 1 }));
    },
    async read(path) {
      const doc = KB_DOCS[path];
      if (!doc) throw new Error(`unknown kb path ${path}`);
      return { path, content: doc.content };
    },
  };
}

const BRAIN_ANALYSIS = {
  analysis: 'The deploying IAM role lacks the iam:PutRolePolicy permission.',
  requiredPermissions: ['iam:PutRolePolicy'],
  fixStatement: 'Attach an inline policy granting iam:PutRolePolicy to the deploy role on the cast- role.',
  confirmed: true,
};

function makeAgent({ ledger, castai, kb, brain } = {}) {
  const adapters = {};
  if (castai !== undefined) adapters.castai = castai;
  if (kb !== undefined) adapters.kb = kb;
  return new CloudSecurityEngineerAgent({
    brain: brain ?? new ScriptedBrain({ defaultResponse: JSON.stringify(BRAIN_ANALYSIS) }),
    ledger: ledger ?? createLedger('case-sec', null),
    adapters,
  });
}

describe('CloudSecurityEngineerAgent', () => {
  test('analyzes the IAM focus with cluster context and appends documentation + code evidence', async () => {
    const castai = new MockCastaiTools({
      get_cluster_details: (args) => ({ clusterId: args.clusterId, provider: 'eks' }),
    });
    const ledger = createLedger('case-sec-1', null);
    const agent = makeAgent({ ledger, castai, kb: makeKb() });

    const result = await agent.execute({ focus: 'iam:PutRolePolicy 403', clusterId: CLUSTER_ID });

    assert.equal(result.ok, true, result.error ?? '');
    // Cluster context read via the read-only adapter, with the case clusterId.
    assert.equal(castai.calls.length, 1);
    assert.equal(castai.calls[0].toolName, 'get_cluster_details');
    assert.equal(castai.calls[0].args.clusterId, CLUSTER_ID);

    // Output shape: {analysis, requiredPermissions, evidenceIds}.
    assert.equal(result.output.analysis, BRAIN_ANALYSIS.analysis);
    assert.deepEqual(result.output.requiredPermissions, ['iam:PutRolePolicy']);
    assert.deepEqual(result.output.evidenceIds, ['E1', 'E2']);

    assert.equal(ledger.evidence.length, 2);
    const [docEv, codeEv] = ledger.evidence;
    assert.equal(docEv.type, 'documentation');
    assert.equal(docEv.source, `kb:${KB_PATH}`);
    assert.equal(docEv.reference, KB_PATH);
    assert.equal(docEv.toolRun, null);
    assert.match(docEv.result, /PutRolePolicy 403/);
    assert.equal(codeEv.type, 'code');
    assert.equal(codeEv.source, `kb:${KB_PATH}`);
    assert.equal(codeEv.reference, KB_PATH);
    assert.match(codeEv.result, /Attach an inline policy/);
    assert.match(codeEv.result, /iam:PutRolePolicy/);
  });

  test('no clusterId → no castai calls, KB grounding still produces both evidence entries', async () => {
    const castai = new MockCastaiTools({});
    const ledger = createLedger('case-sec-2', null);
    const agent = makeAgent({ ledger, castai, kb: makeKb() });

    const result = await agent.execute({ focus: 'iam:PutRolePolicy 403' });

    assert.equal(result.ok, true, result.error ?? '');
    assert.deepEqual(castai.calls, []);
    assert.deepEqual(result.output.evidenceIds, ['E1', 'E2']);
    assert.equal(ledger.evidence.length, 2);
  });

  test('no KB hits → ok:true with analysis but zero evidence', async () => {
    const emptyKb = {
      search: async () => [],
      read: async () => { throw new Error('should not be called'); },
    };
    const ledger = createLedger('case-sec-3', null);
    const agent = makeAgent({ ledger, kb: emptyKb });

    const result = await agent.execute({ focus: 'iam:PutRolePolicy 403' });

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(result.output.analysis, BRAIN_ANALYSIS.analysis);
    assert.deepEqual(result.output.requiredPermissions, ['iam:PutRolePolicy']);
    assert.deepEqual(result.output.evidenceIds, []);
    assert.equal(ledger.evidence.length, 0);
  });

  test('missing task.focus → ok:false', async () => {
    const agent = makeAgent({ castai: new MockCastaiTools({}), kb: makeKb() });
    const result = await agent.execute({ clusterId: CLUSTER_ID });
    assert.equal(result.ok, false);
    assert.match(result.error, /task\.focus/);
  });

  test('missing kb adapter → ok:false', async () => {
    const agent = makeAgent({ castai: new MockCastaiTools({}), kb: undefined });
    const result = await agent.execute({ focus: 'iam:PutRolePolicy 403' });
    assert.equal(result.ok, false);
    assert.match(result.error, /kb adapter/);
  });
});
