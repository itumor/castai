// tests/agents/knowledge.test.js — KB note writing.
// All fs writes go under os.tmpdir() via ctx.params.kbRoot overrides.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase } from '../../src/core/model.js';
import { PolicyError } from '../../src/core/policy.js';
import { createKnowledge } from '../../src/agents/knowledge.js';

function freshCase() {
  const caseObj = createCase({
    id: 'K-1',
    thread: {
      from: 'Ann Example <ann@example.com>',
      subject: 'node not scaling down',
      messages: [{ from: 'ann@example.com', date: '2026-01-01', body: 'node stuck with PDB' }],
    },
    customer: { name: 'Ann Example', email: 'ann@example.com' },
  });
  caseObj.triage = {
    category: 'node_downscale',
    provider: 'aws',
    platform: 'eks',
    castaiMode: 'full',
    questions: ['Is the PDB the cause?'],
    severity: 'low',
    missingInfo: [],
    entities: {},
    customerName: 'Ann',
  };
  caseObj.solution = {
    status: 'proposed',
    summary: 'Remove the eviction blockers.',
    steps: ['Relax the PodDisruptionBudget.', 'Rollback: re-apply the previous manifest.'],
  };
  return caseObj;
}

function tempCtx(caseObj) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-note-'));
  return { caseObj, repoRoot: dir, params: { kbRoot: join(dir, 'kb') } };
}

test('the note strips customer identifiers: emails, hex ids, customer name tokens', async () => {
  const caseObj = freshCase();
  caseObj.thread.subject =
    'Ann: 401 on org 2b9d9744-f37d-4a22-b9c6-2f1857a5417d — contact ann@example.com';
  caseObj.triage.questions = [
    'Ask Ann Example whether anything changed on 2b9d9744-f37d-4a22-b9c6-2f1857a5417d',
  ];
  caseObj.solution.steps.push('Rotate ann@example.com token for cluster 36575565-aaaa-bbbb-cccc-dddddddddddd.');

  const ctx = tempCtx(caseObj);
  const agent = createKnowledge();
  await agent.run(ctx);

  const written = readdirSync(ctx.params.kbRoot)
    .filter((name) => name.endsWith('.md'))
    .sort()[0];
  const body = readFileSync(join(ctx.params.kbRoot, written), 'utf8');

  assert.ok(!body.includes('ann@example.com'), `email leaked: ${body}`);
  assert.ok(!body.includes('2b9d9744-f37d-4a22-b9c6-2f1857a5417d'), 'org id leaked');
  assert.ok(!body.includes('36575565-aaaa-bbbb-cccc-dddddddddddd'), 'cluster id leaked');
  assert.ok(!/\bAnn\b/.test(body), `customer name leaked: ${body}`);
  assert.ok(!body.includes('Example'), 'customer surname leaked');
  // And it still carries the generic signal.
  assert.match(body, /node_downscale/);
  assert.match(body, /PodDisruptionBudget/);
});

test('writes a real KB note under the kb root and appends the path to kbNotes', async () => {
  const caseObj = freshCase();
  const ctx = tempCtx(caseObj);

  const knowledge = createKnowledge({ llm: undefined, tools: undefined });
  const { notePath } = await knowledge.run(ctx);

  assert.equal(typeof notePath, 'string');
  assert.equal(basename(dirname(notePath)), 'kb');
  assert.match(basename(notePath), /^\d{4}-\d{2}-\d{2}-K-1\.md$/);
  assert.ok(caseObj.kbNotes.includes(notePath));
  assert.equal(caseObj.kbNotes.length, 1);

  const text = readFileSync(notePath, 'utf8');
  assert.match(text, /## Problem/);
  assert.match(text, /## Detection signals/);
  assert.match(text, /## Resolution/);
  assert.match(text, /## Reusable checklist/);
  assert.match(text, /Relax the PodDisruptionBudget\./);
  assert.match(text, /node_downscale/);
  assert.match(text, /Is the PDB the cause\?/);
  // Category-specific reusable checklist item for downscale cases.
  assert.match(text, /PDBs, local storage/);

  const actions = caseObj.trace.filter((t) => t.actor === 'knowledge').map((t) => t.action);
  assert.ok(actions.includes('knowledge.start'));
  assert.ok(actions.includes('knowledge.note.written'));
});

test('creates the kb directory recursively', async () => {
  const caseObj = freshCase();
  const dir = mkdtempSync(join(tmpdir(), 'kb-deep-'));
  const kbRoot = join(dir, 'nested', 'kb');
  const { notePath } = await createKnowledge().run({
    caseObj,
    repoRoot: dir,
    params: { kbRoot },
  });
  assert.equal(dirname(notePath), kbRoot);
  assert.equal(readdirSync(kbRoot).length, 1);
});

test('repeat run of the same case never overwrites: mkdtemp-style unique names', async () => {
  const caseObj = freshCase();
  const ctx = tempCtx(caseObj);
  const knowledge = createKnowledge();

  const first = await knowledge.run(ctx);
  const second = await knowledge.run(ctx);

  assert.notEqual(first.notePath, second.notePath);
  assert.ok(basename(second.notePath).includes('-K-1-'));
  assert.equal(caseObj.kbNotes.length, 2);
  assert.equal(readFileSync(first.notePath, 'utf8').length > 0, true);
  assert.equal(readFileSync(second.notePath, 'utf8').length > 0, true);
});

test('failed write surfaces the fs error (no silent swallow)', async () => {
  const caseObj = freshCase();
  const knowledge = createKnowledge();
  // A kb root that has a regular FILE as a path segment cannot be mkdir'ed.
  const dir = mkdtempSync(join(tmpdir(), 'kb-block-'));
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'occupied');
  await assert.rejects(
    knowledge.run({ caseObj, repoRoot: dir, params: { kbRoot: join(blocker, 'kb') } }),
  );
  assert.equal(caseObj.kbNotes.length, 0);
});

test('knowledge may use kbWrite but never, say, kube (permission boundary)', async () => {
  // The agent asserts its own permission internally; a smoke check that the
  // policy boundary exists for this id.
  const { assertToolAllowed } = await import('../../src/core/policy.js');
  assert.doesNotThrow(() => assertToolAllowed('knowledge', 'kbWrite'));
  assert.throws(() => assertToolAllowed('knowledge', 'kube'), PolicyError);
});
