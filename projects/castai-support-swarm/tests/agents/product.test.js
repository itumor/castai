// tests/agents/product.test.js — contract section 7 (src/agents/product.js)
//
// All fs work happens in real (temporary) repo roots under os.tmpdir() so the
// scan is exercised end to end without touching the actual checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProduct } from '../../src/agents/product.js';
import {
  createCase,
  addClaim,
  linkEvidenceToClaim,
  claimClasses,
} from '../../src/core/model.js';

function makeCase({ category = 'unknown', subject = 'nodes not scaling down' } = {}) {
  const caseObj = createCase({
    id: 'case-product',
    thread: {
      from: 'Jane Doe <jane@example.com>',
      subject,
      messages: [{ from: 'jane@example.com', date: '2026-01-01', body: 'see subject' }],
    },
    customer: { name: 'Jane Doe', email: 'jane@example.com', orgId: 'org-1', clusterId: 'clu-1' },
  });
  caseObj.triage = { category };
  return caseObj;
}

// A minimal fake repo root with the two scan directories the agent reads.
function makeRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'swarm-product-'));
  mkdirSync(join(repoRoot, 'castai-mcp-server/src/tools'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'castai-mcp-server/src/tools/savings.js'),
    'export function savingsPath(clusterId) {\n' +
      '  return `/v1/cost-reports/savings/${clusterId}`;\n' +
      '}\n',
  );
  mkdirSync(join(repoRoot, 'castai-terraform-1'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'castai-terraform-1/main.tf'),
    'resource "castai_node_configuration" "default" {\n  name = "default"\n}\n',
  );
  return repoRoot;
}

function cleanup(repoRoot) {
  rmSync(repoRoot, { recursive: true, force: true });
}

test('createProduct returns the contract agent shape', () => {
  const agent = createProduct({ llm: null, tools: {} });
  assert.equal(agent.id, 'product');
  assert.equal(typeof agent.name, 'string');
  assert.equal(typeof agent.run, 'function');
});

test('cost_reporting finds the savings code and grounds it with a real file:line ref', async () => {
  const repoRoot = makeRepo();
  try {
    const caseObj = makeCase({ category: 'cost_reporting' });
    const agent = createProduct({ tools: {} });
    const result = await agent.run({ caseObj, repoRoot, params: {} });

    assert.equal(result.evidenceAdded, 1);
    assert.equal(caseObj.evidence.length, 1);

    const evidence = caseObj.evidence[0];
    assert.equal(evidence.type, 'source_code');
    assert.equal(evidence.source, 'repo');
    assert.equal(evidence.agentId, 'product');
    assert.equal(evidence.ref, 'castai-mcp-server/src/tools/savings.js:1');
    assert.ok(evidence.summary.includes('savings'));

    // The ref is real: the referenced file exists relative to repoRoot.
    const [refPath, refLine] = evidence.ref.split(':');
    assert.ok(existsSync(join(repoRoot, refPath)));
    assert.match(refLine, /^\d+$/);

    const claim = addClaim(caseObj, { statement: 'CAST AI exposes a savings/cost-report path' });
    linkEvidenceToClaim(caseObj, claim.id, evidence.id);
    assert.ok(claimClasses(caseObj, claim.id).includes('CODE_CONFIRMED'));
  } finally {
    cleanup(repoRoot);
  }
});

test('no keyword hits -> zero evidence, nothing fabricated', async () => {
  const repoRoot = makeRepo();
  try {
    const caseObj = makeCase({ category: 'unknown', subject: 'Zebra quokka jigsaw' });
    const agent = createProduct({ tools: {} });
    const result = await agent.run({ caseObj, repoRoot, params: {} });

    assert.equal(result.evidenceAdded, 0);
    assert.equal(caseObj.evidence.length, 0);
    assert.ok(
      caseObj.trace.some((t) => t.actor === 'product' && t.action === 'scan.no-matches'),
    );
  } finally {
    cleanup(repoRoot);
  }
});

test('missing scan directories are tolerated: zero evidence, no throw', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'swarm-product-empty-'));
  try {
    const caseObj = makeCase({ category: 'cost_reporting' });
    const agent = createProduct({ tools: {} });
    const result = await agent.run({ caseObj, repoRoot, params: {} });

    assert.equal(result.evidenceAdded, 0);
    assert.equal(caseObj.evidence.length, 0);
  } finally {
    cleanup(repoRoot);
  }
});

test('secret-shaped literals are masked before snippets reach the ledger', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'swarm-product-secret-'));
  try {
    mkdirSync(join(repoRoot, 'castai-mcp-server/src'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'castai-mcp-server/src/token.js'),
      'const fallbackToken = "abcd1234abcd1234abcd1234";\n' +
        'export const CLUSTER_TOKEN_PATH = "/v1/kubernetes/external-clusters/token";\n',
    );

    const caseObj = makeCase({ category: 'token_rotation', subject: '401 after rotation' });
    const agent = createProduct({ tools: {} });
    const result = await agent.run({ caseObj, repoRoot, params: {} });

    assert.equal(result.evidenceAdded, 1);
    const evidence = caseObj.evidence[0];
    assert.equal(evidence.type, 'source_code');
    assert.equal(evidence.ref, 'castai-mcp-server/src/token.js:1');
    assert.ok(evidence.summary.includes('***REDACTED***'));
    assert.ok(!evidence.summary.includes('abcd1234abcd1234abcd1234'));
  } finally {
    cleanup(repoRoot);
  }
});

test('categories without a mapping fall back to distinctive subject keywords', async () => {
  const repoRoot = makeRepo();
  try {
    const caseObj = makeCase({ category: 'product_bug', subject: 'Savings number looks wrong' });
    const agent = createProduct({ tools: {} });
    const result = await agent.run({ caseObj, repoRoot, params: {} });

    assert.ok(result.evidenceAdded >= 1);
    const evidence = caseObj.evidence[0];
    assert.equal(evidence.type, 'source_code');
    assert.ok(evidence.ref.startsWith('castai-mcp-server/src/tools/savings.js:'));
    assert.ok(evidence.summary.includes('savings'));
  } finally {
    cleanup(repoRoot);
  }
});

test('records scan start and completion on the trace', async () => {
  const repoRoot = makeRepo();
  try {
    const caseObj = makeCase({ category: 'cost_reporting' });
    const agent = createProduct({ tools: {} });
    await agent.run({ caseObj, repoRoot, params: {} });

    const mine = caseObj.trace.filter((t) => t.actor === 'product');
    const actions = mine.map((t) => t.action);
    assert.ok(actions.includes('scan.start'));
    assert.ok(actions.includes('scan.complete'));
  } finally {
    cleanup(repoRoot);
  }
});
