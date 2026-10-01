// tests/core/trace.test.js — contract section 5 (src/core/trace.js)
// fs writes only under os.tmpdir(); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCase } from '../../src/core/model.js';
import { record, persistTrace } from '../../src/core/trace.js';

function makeCase(id = 'trace-1') {
  return createCase({
    id,
    thread: { from: 'A <a@example.com>', subject: 's', messages: [] },
    customer: { name: 'A', email: 'a@example.com' },
  });
}

test('persistTrace rejects path-unsafe case ids exactly like draftEmail', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-trace-unsafe-'));
  for (const bad of ['../escape', 'a/b', 'a\\b', '..', '', null, undefined, 42]) {
    await assert.rejects(
      () => persistTrace(makeCaseWith(bad), dir),
      /unsafe case id/,
      `id ${JSON.stringify(bad)}`,
    );
  }
  assert.ok(!existsSync(join(dir, '..', 'escape.trace.jsonl')));
});

function makeCaseWith(id) {
  const c = makeCase();
  c.id = id;
  return c;
}

test('record masks secret-shaped STRING VALUES inside details', () => {
  const c = makeCase();
  record(c, 'sre', 'ops.note', {
    note: 'using api_key AKIAXYZ123456789ABCD for the probe',
    fine: 'the cluster token is a concept',
  });
  const detail = c.trace[0].detail;
  assert.ok(!detail.note.includes('AKIAXYZ123456789ABCD'), `leak: ${detail.note}`);
  assert.equal(detail.fine, 'the cluster token is a concept');
});

test('record appends { at, actor, action, detail } and redacts detail', () => {
  const c = makeCase();
  record(c, 'triage', 'case.received', { subject: 'help', apiKey: 'SHOULD-NOT-PERSIST' });
  record(c, 'sre', 'cluster.inspect', { nested: { authorization: 'Bearer xyz' }, ok: 1 });

  assert.equal(c.trace.length, 2);

  const [e1, e2] = c.trace;
  assert.equal(typeof e1.at, 'string');
  assert.ok(!Number.isNaN(Date.parse(e1.at)));
  assert.equal(e1.actor, 'triage');
  assert.equal(e1.action, 'case.received');
  assert.equal(e1.detail.subject, 'help');
  assert.equal(e1.detail.apiKey, '***REDACTED***');

  assert.equal(e2.detail.nested.authorization, '***REDACTED***');
  assert.equal(e2.detail.ok, 1);
});

test('record defaults detail to {} and tolerates a missing trace array', () => {
  const c = makeCase();
  const entry = record(c, 'qa', 'tests.run');
  assert.deepEqual(entry.detail, {});

  const bare = { id: 'bare' };
  record(bare, 'qa', 'tests.run', { clusterToken: 'x' });
  assert.equal(bare.trace.length, 1);
  assert.equal(bare.trace[0].detail.clusterToken, '***REDACTED***');
});

test('persistTrace mkdir -p and writes one JSON object per line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'swarm-trace-'));
  const dir = join(root, 'nested', 'traces'); // does not exist yet

  const c = makeCase('trace-persist');
  record(c, 'triage', 'case.received', { subject: 's' });
  record(c, 'writer', 'reply.drafted', { apiKey: 'hide', body: 'text' });

  const path = await persistTrace(c, dir);
  assert.equal(path, join(dir, 'trace-persist.trace.jsonl'));
  assert.ok(existsSync(path));

  const raw = readFileSync(path, 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 2);

  const parsed = lines.map((line) => JSON.parse(line));
  assert.deepEqual(parsed.map((e) => e.action), ['case.received', 'reply.drafted']);
  assert.equal(parsed[0].actor, 'triage');
  assert.equal(parsed[1].detail.apiKey, '***REDACTED***'); // stays redacted on disk
});

test('persistTrace of an empty trace writes an empty file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'swarm-trace-empty-'));
  const c = makeCase('trace-empty');
  const path = await persistTrace(c, root);
  assert.equal(readFileSync(path, 'utf8'), '');
});
