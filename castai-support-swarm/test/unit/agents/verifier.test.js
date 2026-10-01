import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VerifierAgent } from '../../../src/agents/verifier.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { createLedger, addEvidence, setTests, setSolution } from '../../../src/core/ledger.js';

function makeAgent(ledger) {
  const brain = new ScriptedBrain({ defaultResponse: '{"claims":[]}' });
  return new VerifierAgent({ key: 'verifier', brain, ledger, adapters: {} });
}

describe('VerifierAgent', () => {
  test('claim with 2 evidence refs → pass + DOCUMENTED', async () => {
    const ledger = createLedger('v-case-1', null);
    addEvidence(ledger, {
      type: 'documentation', source: 'kb:docs/node-templates.md',
      result: 'Node template settings documented', reference: 'docs/node-templates.md',
    });
    addEvidence(ledger, {
      type: 'code', source: 'src/node-template.js',
      result: 'Node template code review confirms misconfiguration', reference: 'src/node-template.js:42',
    });
    const agent = makeAgent(ledger);
    const result = await agent.execute({
      proposedClaims: [{ claim: 'The node template was misconfigured', evidenceIds: ['E1', 'E2'] }],
    });

    assert.equal(result.ok, true, result.error ?? '');
    const verdict = result.output.verdict;
    assert.equal(verdict.pass, true);
    assert.equal(verdict.claims.length, 1);
    assert.equal(verdict.claims[0].classification, 'DOCUMENTED'); // highest priority when multiple
    assert.deepEqual(verdict.claims[0].evidenceIds, ['E1', 'E2']);
    assert.equal(verdict.openQuestions, null);
    assert.equal(typeof verdict.reason, 'string');
    assert.match(verdict.reason, /evidence-backed/);
  });

  test('same claim with empty evidenceIds → fail + INFERRED + openQuestions', async () => {
    const ledger = createLedger('v-case-2', null);
    addEvidence(ledger, {
      type: 'documentation', source: 'kb:docs/node-templates.md',
      result: 'Node template settings documented', reference: 'docs/node-templates.md',
    });
    const agent = makeAgent(ledger);
    const result = await agent.execute({
      proposedClaims: [{ claim: 'The node template was misconfigured', evidenceIds: [] }],
    });

    assert.equal(result.ok, true, result.error ?? '');
    const verdict = result.output.verdict;
    assert.equal(verdict.pass, false);
    assert.equal(verdict.claims[0].classification, 'INFERRED');
    assert.deepEqual(verdict.claims[0].evidenceIds, []);
    assert.ok(Array.isArray(verdict.openQuestions) && verdict.openQuestions.length === 1);
    assert.match(verdict.openQuestions[0], /misconfigured/);
    assert.match(verdict.reason, /lack verified evidence/);
  });

  test('mixed classifications precedence: DOCUMENTED > CODE > TEST > ENVIRONMENT; UNKNOWN/INFERRED fail', async () => {
    const ledger = createLedger('v-case-3', null);
    ledger.triage = { clusterId: 'c-1' }; // case cluster context for the ENVIRONMENT-CONFIRMED rule
    addEvidence(ledger, {
      type: 'telemetry', source: 'mcp:get_cluster_nodes',
      result: 'Node list captured', reference: 'cluster c-1',
      toolRun: { tool: 'mcp:get_cluster_nodes', args: { clusterId: 'c-1' }, ok: true },
    });
    addEvidence(ledger, {
      type: 'documentation', source: 'kb:docs/autoscaler.md',
      result: 'Autoscaler behaviour documented', reference: 'docs/autoscaler.md',
    });
    addEvidence(ledger, {
      type: 'code', source: 'src/autoscaler.js',
      result: 'Code confirms cooldown default', reference: 'src/autoscaler.js:10',
    });
    addEvidence(ledger, {
      type: 'test', source: 'sandbox:qa-unit',
      result: 'Unit scenario passed', reference: 'qa-unit',
      toolRun: { tool: 'sandbox:run', args: { scenario: 'qa-unit' }, ok: true },
    });
    setTests(ledger, { unit: 'passed', integration: 'not_run', e2e: 'not_run', regression: 'not_run' });
    const agent = makeAgent(ledger);

    const mixed = await agent.execute({
      proposedClaims: [
        { claim: 'Cluster state observed', evidenceIds: ['E1'] },
        { claim: 'Autoscaler behaviour documented and code-confirmed', evidenceIds: ['E2', 'E3'] },
        { claim: 'Unit scenario passes', evidenceIds: ['E4'] },
        { claim: 'Ghost claim', evidenceIds: ['E999'] }, // ids present, none resolve → UNKNOWN
        { claim: 'Bare brain assertion' }, // no ids → INFERRED
      ],
    });
    assert.equal(mixed.ok, true, mixed.error ?? '');
    const v = mixed.output.verdict;
    assert.deepEqual(v.claims.map((c) => c.classification), [
      'ENVIRONMENT-CONFIRMED', 'DOCUMENTED', 'TEST-CONFIRMED', 'UNKNOWN', 'INFERRED',
    ]);
    assert.equal(v.pass, false); // UNKNOWN + INFERRED are not in the verified set
    assert.equal(v.openQuestions.length, 2);

    const allVerified = await agent.execute({
      proposedClaims: [
        { claim: 'Cluster state observed', evidenceIds: ['E1'] },
        { claim: 'Autoscaler behaviour documented and code-confirmed', evidenceIds: ['E2', 'E3'] },
        { claim: 'Unit scenario passes', evidenceIds: ['E4'] },
      ],
    });
    assert.equal(allVerified.ok, true, allVerified.error ?? '');
    assert.equal(allVerified.output.verdict.pass, true);
    assert.equal(allVerified.output.verdict.openQuestions, null);
  });

  test('telemetry against a FOREIGN cluster does NOT yield ENVIRONMENT-CONFIRMED', async () => {
    const ledger = createLedger('v-case-5', null);
    ledger.triage = { clusterId: 'c-customer' };
    addEvidence(ledger, {
      type: 'telemetry', source: 'mcp:get_cluster_nodes',
      result: 'Node list captured from a different cluster', reference: 'cluster c-other',
      toolRun: { tool: 'get_cluster_nodes', args: { clusterId: 'c-other' }, ok: true },
    });
    const agent = makeAgent(ledger);
    const result = await agent.execute({
      proposedClaims: [{ claim: 'The customer cluster has 3 nodes', evidenceIds: ['E1'] }],
    });

    assert.equal(result.ok, true, result.error ?? '');
    const verdict = result.output.verdict;
    assert.equal(verdict.pass, false, 'foreign-cluster telemetry must not verify a claim');
    assert.equal(verdict.claims[0].classification, 'UNKNOWN');
    assert.ok(Array.isArray(verdict.openQuestions) && verdict.openQuestions.length === 1);
  });

  test('telemetry against the SAME cluster yields ENVIRONMENT-CONFIRMED', async () => {
    const ledger = createLedger('v-case-6', null);
    ledger.triage = { clusterId: 'c-customer' };
    addEvidence(ledger, {
      type: 'telemetry', source: 'mcp:get_cluster_nodes',
      result: 'Node list captured', reference: 'cluster c-customer',
      toolRun: { tool: 'get_cluster_nodes', args: { clusterId: 'c-customer' }, ok: true },
    });
    const agent = makeAgent(ledger);
    const result = await agent.execute({
      proposedClaims: [{ claim: 'The customer cluster has 3 nodes', evidenceIds: ['E1'] }],
    });

    assert.equal(result.ok, true, result.error ?? '');
    const verdict = result.output.verdict;
    assert.equal(verdict.pass, true);
    assert.equal(verdict.claims[0].classification, 'ENVIRONMENT-CONFIRMED');
  });

  test('kubectl-sourced telemetry yields ENVIRONMENT-CONFIRMED even without case cluster context', async () => {
    const ledger = createLedger('v-case-7', null);
    addEvidence(ledger, {
      type: 'telemetry', source: 'kubectl:get pods',
      result: 'Pod list captured', reference: 'get pods',
      toolRun: { tool: 'kubectl.get', args: { kind: 'pods' }, ok: true },
    });
    const agent = makeAgent(ledger);
    const result = await agent.execute({
      proposedClaims: [{ claim: 'The pods are running', evidenceIds: ['E1'] }],
    });

    assert.equal(result.ok, true, result.error ?? '');
    const verdict = result.output.verdict;
    assert.equal(verdict.pass, true);
    assert.equal(verdict.claims[0].classification, 'ENVIRONMENT-CONFIRMED');
  });

  test('claims derived from ledger.solution.summary via brain', async () => {
    const ledger = createLedger('v-case-4', null);
    addEvidence(ledger, {
      type: 'code', source: 'src/autoscaler.js',
      result: 'Cooldown default confirmed in code', reference: 'src/autoscaler.js:10',
    });
    setSolution(ledger, 'proposed', 'Autoscaler cooldown caused the scaling delay');
    const brain = new ScriptedBrain({
      defaultResponse: JSON.stringify({
        claims: [{ claim: 'Autoscaler cooldown caused the scaling delay', evidenceIds: ['E1'] }],
      }),
    });
    const agent = new VerifierAgent({ key: 'verifier', brain, ledger, adapters: {} });
    const result = await agent.execute({}); // no proposedClaims → brain derivation

    assert.equal(result.ok, true, result.error ?? '');
    const verdict = result.output.verdict;
    assert.equal(verdict.pass, true);
    assert.equal(verdict.claims[0].classification, 'CODE-CONFIRMED');
    assert.deepEqual(verdict.claims[0].evidenceIds, ['E1']);
  });
});
