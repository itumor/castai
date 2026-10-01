// tests/agents/triage.test.js — src/agents/triage.js.
// Fixture-based: parses the real fixtures/*.md thread files, runs triage with
// an offline HeuristicLlm (constructed here and passed in deps, per contract),
// and checks the stored TriageResult. No network, no fs writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createTriage, normalizeTriageResult, threadToText } from '../../src/agents/triage.js';
import { HeuristicLlm } from '../../src/core/llm.js';
import { createCase } from '../../src/core/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..', '..');
const REPO_ROOT = '/Users/eramadan/castai';

/** Parse a fixture thread file: `From:` / `Subject:` headers, blank line, body. */
function parseThreadFile(name) {
  const raw = readFileSync(join(PACKAGE_ROOT, 'fixtures', name), 'utf8');
  const lines = raw.split('\n');
  const fromLine = lines.find((line) => line.startsWith('From:'));
  const subjectLine = lines.find((line) => line.startsWith('Subject:'));
  const blankIndex = lines.findIndex((line) => line.trim() === '');
  const body = lines.slice(blankIndex === -1 ? lines.length : blankIndex + 1).join('\n').trim();
  const from = fromLine ? fromLine.slice('From:'.length).trim() : '';
  const subject = subjectLine ? subjectLine.slice('Subject:'.length).trim() : '';
  return { from, subject, messages: [{ from, date: '2026-01-05T09:00:00Z', body }] };
}

async function triageFixture({ llm, fixture, id = 'case-triage' }) {
  const thread = parseThreadFile(fixture);
  const caseObj = createCase({
    id,
    thread,
    customer: { name: thread.from.replace(/<.*>/, '').trim(), email: 'customer@example.com' },
  });
  const agent = createTriage({ llm, tools: {} });
  const ctx = { caseObj, repoRoot: REPO_ROOT, params: {} };
  const result = await agent.run(ctx);
  return { caseObj, result };
}

test('triage fixture thread-pdb-scaledown.md -> node_downscale on AWS EKS, Christoph, PDB question', async () => {
  const { caseObj, result } = await triageFixture({
    llm: new HeuristicLlm(),
    fixture: 'thread-pdb-scaledown.md',
  });

  // stored on the case
  assert.ok(caseObj.triage, 'caseObj.triage must be set');
  const t = caseObj.triage;

  assert.equal(t.category, 'node_downscale');
  assert.equal(t.provider, 'aws');
  assert.equal(t.platform, 'eks');
  assert.equal(t.castaiMode, 'full');
  assert.equal(t.customerName, 'Christoph');
  assert.equal(t.severity, 'low');
  assert.deepEqual(t.entities, {});
  assert.ok(t.missingInfo.includes('orgId'));
  assert.ok(t.missingInfo.includes('clusterId'));

  // one question about the PDB ("...Could / that be related?" — the fixture
  // wraps the sentence after the PodDisruptionBudget line, and extractQuestions
  // does not cross newlines, so assert the stable tail of that question)
  assert.ok(Array.isArray(t.questions));
  assert.equal(t.questions.length, 3);
  assert.ok(
    t.questions.some((q) => /be related\?/i.test(q)),
    `expected a PDB question, got: ${JSON.stringify(t.questions)}`,
  );
  assert.ok(t.questions.some((q) => /expected behavior/i.test(q)));

  // short structured result mirrors the stored triage
  assert.equal(result.category, 'node_downscale');
  assert.equal(result.provider, 'aws');
  assert.equal(result.platform, 'eks');
  assert.equal(result.customerName, 'Christoph');

  // trace: base start/end + triage.analyze + triage.result
  const actions = caseObj.trace.map((entry) => entry.action);
  assert.deepEqual(actions, ['agent.start', 'triage.analyze', 'triage.result', 'agent.end']);
  assert.ok(caseObj.trace.every((entry) => entry.actor === 'triage'));
});

test('triage fixture thread-putrolepolicy-403.md -> iam_onboarding, Samuel, eks', async () => {
  const { caseObj } = await triageFixture({
    llm: new HeuristicLlm(),
    fixture: 'thread-putrolepolicy-403.md',
  });
  assert.equal(caseObj.triage.category, 'iam_onboarding');
  assert.equal(caseObj.triage.provider, 'aws');
  assert.equal(caseObj.triage.platform, 'eks');
  assert.equal(caseObj.triage.customerName, 'Samuel');
});

test('triage fixture thread-realized-savings.md -> cost_reporting, Lena', async () => {
  const { caseObj } = await triageFixture({
    llm: new HeuristicLlm(),
    fixture: 'thread-realized-savings.md',
  });
  assert.equal(caseObj.triage.category, 'cost_reporting');
  assert.equal(caseObj.triage.customerName, 'Lena');
  assert.ok(caseObj.triage.questions.length >= 1);
});

test('triage normalizes garbage llm output to safe contract defaults', async () => {
  const llm = {
    complete: async () => JSON.stringify({
      category: 'not-a-category',
      provider: 'oracle',
      platform: 'riscv',
      castaiMode: 'ludicrous',
      severity: 'extreme',
      questions: 'not-an-array',
      missingInfo: 42,
      customerName: 123,
      entities: 'oops',
    }),
  };
  const { caseObj } = await triageFixture({ llm, fixture: 'thread-pdb-scaledown.md' });
  const t = caseObj.triage;
  assert.equal(t.category, 'unknown');
  assert.equal(t.provider, 'unknown');
  assert.equal(t.platform, 'unknown');
  assert.equal(t.castaiMode, 'unknown');
  assert.equal(t.severity, 'low');
  assert.deepEqual(t.questions, []);
  assert.deepEqual(t.missingInfo, []);
  assert.deepEqual(t.entities, {});
  assert.equal(t.customerName, '');
});

test('triage survives an llm returning non-JSON ("{}" fallback)', async () => {
  const llm = { complete: async () => 'no idea, sorry' };
  const { caseObj } = await triageFixture({ llm, fixture: 'thread-pdb-scaledown.md' });
  assert.equal(caseObj.triage.category, 'unknown');
  assert.equal(typeof caseObj.triage.customerName, 'string');
});

test('normalizeTriageResult / threadToText helpers', () => {
  assert.deepEqual(normalizeTriageResult(null), {
    category: 'unknown',
    provider: 'unknown',
    platform: 'unknown',
    castaiMode: 'unknown',
    questions: [],
    severity: 'low',
    missingInfo: [],
    entities: {},
    customerName: '',
  });
  assert.equal(threadToText(null), '');
  assert.equal(threadToText({}), '');
  assert.equal(
    threadToText({ from: 'A', subject: 'S', messages: [{ from: 'A', body: 'B' }] }),
    'From: A\n\nSubject: S\n\nB',
  );
});
