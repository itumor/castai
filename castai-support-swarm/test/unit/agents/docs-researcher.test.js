import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DocsResearcherAgent } from '../../../src/agents/docs-researcher.js';
import { ScriptedBrain } from '../../../src/brains/scripted-brain.js';
import { KbReader } from '../../../src/adapters/kb/kb-reader.js';
import { createLedger } from '../../../src/core/ledger.js';

const REPO_ROOT = '/Users/eramadan/castai';
const KB_NOTE = 'brain/notes/PutRolePolicy 403 Case.md';

const DOCUMENTED_CLAIM =
  'The deployer IAM role needs the iam:PutRolePolicy permission to attach policies to the cast- role';
const INFERRED_CLAIM =
  'The cluster runs a Kafka ingestion pipeline written in Python';

function makeAgent({ ledger, claims } = {}) {
  // Scripted brain supplies claim candidates when the task omits task.claims.
  const brain = new ScriptedBrain({
    defaultResponse: JSON.stringify({ claims: [DOCUMENTED_CLAIM, INFERRED_CLAIM] }),
  });
  const kb = new KbReader({ repoRoot: REPO_ROOT });
  return new DocsResearcherAgent({
    key: 'docs-researcher',
    brain,
    ledger: ledger ?? createLedger('kb-case', null),
    adapters: { kb },
  });
}

describe('DocsResearcherAgent with real KbReader', () => {
  test('finds the PutRolePolicy note and classifies a backed claim as documented', async () => {
    const ledger = createLedger('kb-case', null);
    const agent = makeAgent({ ledger });
    const result = await agent.execute({
      query: 'PutRolePolicy 403',
      claims: [DOCUMENTED_CLAIM, INFERRED_CLAIM],
    });

    assert.equal(result.ok, true, `expected ok, got: ${result.error}`);
    const findings = result.output.findings;
    assert.equal(findings.length, 2);

    const documented = findings.find((f) => f.claim === DOCUMENTED_CLAIM);
    assert.equal(documented.status, 'documented');
    assert.equal(documented.path, KB_NOTE);

    const inferred = findings.find((f) => f.claim === INFERRED_CLAIM);
    assert.equal(inferred.status, 'inferred');
    assert.equal(inferred.path, null);

    // Documentation evidence appended only for the documented finding.
    assert.equal(ledger.evidence.length, 1);
    const ev = ledger.evidence[0];
    assert.equal(ev.type, 'documentation');
    assert.equal(ev.source, `kb:${KB_NOTE}`);
    assert.equal(ev.reference, KB_NOTE);
    assert.equal(ev.toolRun, null);
    assert.deepEqual(result.evidenceIds, ['E1']);
  });

  test('brain-derived claims (no task.claims) go through the scripted brain', async () => {
    const ledger = createLedger('kb-case-2', null);
    const agent = makeAgent({ ledger });
    const result = await agent.execute({ queries: ['PutRolePolicy 403'] });

    assert.equal(result.ok, true, result.error ?? '');
    const findings = result.output.findings;
    assert.deepEqual(findings.map((f) => f.claim), [DOCUMENTED_CLAIM, INFERRED_CLAIM]);
    assert.equal(findings[0].path, KB_NOTE);
    assert.equal(ledger.evidence.length, 1);
  });

  test('missing query and queries → ok:false', async () => {
    const agent = makeAgent({});
    const result = await agent.execute({ claims: ['x'] });
    assert.equal(result.ok, false);
    assert.match(result.error, /task\.query or task\.queries/);
  });

  test('kb adapter access is permission-filtered (docs-researcher has kb:read)', async () => {
    const agent = makeAgent({});
    // Allowed: kb passes through.
    const hits = await agent.adapters.kb.search({ query: 'PutRolePolicy 403' });
    assert.ok(hits.some((h) => h.path === KB_NOTE));
    // Disallowed: castai is 'none' for docs-researcher.
    assert.throws(() => agent.adapters.castai, (err) => err.name === 'PermissionError');
  });
});
