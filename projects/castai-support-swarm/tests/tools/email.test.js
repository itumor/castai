// tests/tools/email.test.js — draft-only email outbox (contract section 6).
// Writes only into os.tmpdir(); the tool never sends anything.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { draftEmail } from '../../src/tools/email.js';

test('writes <caseId>.md and <caseId>.json into the outbox (mkdir -p)', async () => {
  const outboxDir = path.join(mkdtempSync(path.join(tmpdir(), 'outbox-')), 'nested', 'outbox');
  const { mdPath, jsonPath } = await draftEmail({
    outboxDir,
    caseId: 'case-42',
    to: 'customer@example.com',
    subject: 'Re: node is not scaling down',
    body: 'Hi Aki,\n\nYour node is blocked by a PodDisruptionBudget.\n\n— CAST AI Support\n',
    meta: { threadId: 'thread-9', agent: 'writer' },
  });

  assert.equal(mdPath, path.join(outboxDir, 'case-42.md'));
  assert.equal(jsonPath, path.join(outboxDir, 'case-42.json'));
  assert.ok(existsSync(mdPath), 'markdown draft written');
  assert.ok(existsSync(jsonPath), 'json sidecar written');

  assert.equal(
    readFileSync(mdPath, 'utf8'),
    'Hi Aki,\n\nYour node is blocked by a PodDisruptionBudget.\n\n— CAST AI Support\n',
  );

  const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.equal(meta.to, 'customer@example.com');
  assert.equal(meta.subject, 'Re: node is not scaling down');
  assert.equal(meta.caseId, 'case-42');
  assert.equal(meta.draftOnly, true);
  assert.equal(meta.threadId, 'thread-9');
  assert.equal(meta.agent, 'writer');
  assert.ok(!Number.isNaN(Date.parse(meta.createdAt)), 'createdAt is an ISO timestamp');
});

test('json sidecar defaults meta to {} and keeps draftOnly: true', async () => {
  const outboxDir = mkdtempSync(path.join(tmpdir(), 'outbox-'));
  const { jsonPath } = await draftEmail({
    outboxDir,
    caseId: 'case-plain',
    to: 'a@example.com',
    subject: 's',
    body: 'b',
  });
  const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.equal(meta.draftOnly, true);
  assert.deepEqual(Object.keys(meta).sort(), ['caseId', 'createdAt', 'draftOnly', 'subject', 'to']);
});

test('rejects unsafe caseId values (no escaping the outbox)', async () => {
  const outboxDir = mkdtempSync(path.join(tmpdir(), 'outbox-'));
  for (const caseId of ['../escape', 'a/b', 'a\\b', '..', '']) {
    await assert.rejects(() =>
      draftEmail({ outboxDir, caseId, to: 'a', subject: 'b', body: 'c' }),
    );
  }
});

test('requires an outboxDir', async () => {
  await assert.rejects(() => draftEmail({ caseId: 'case-1', to: 'a', subject: 's', body: 'b' }));
});
