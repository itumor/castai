// Chunk 7 acceptance tests for the KB reader (symlink jail + secret refusal).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { KbReader, ForbiddenPathError } from '../../src/adapters/kb/kb-reader.js';

const REAL_REPO_ROOT = '/Users/eramadan/castai';

async function makeTempRepo() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'kb-reader-test-'));
}

describe('KbReader.isSecretPath (static)', () => {
  test('matches env-shaped basenames', () => {
    assert.equal(KbReader.isSecretPath('/repo/.env'), true);
    assert.equal(KbReader.isSecretPath('/repo/.env.local'), true);
    assert.equal(KbReader.isSecretPath('/repo/production.env'), true);
    assert.equal(KbReader.isSecretPath('/repo/awskey.env'), true);
    assert.equal(KbReader.isSecretPath('/repo/notes/AWS key.md'), false);
    assert.equal(KbReader.isSecretPath('/repo/readme.md'), false);
  });
});

describe('KbReader.isPathAllowed (static)', () => {
  test('allows paths inside the real repo root', () => {
    assert.equal(KbReader.isPathAllowed(REAL_REPO_ROOT, 'brain/notes'), true);
    assert.equal(
      KbReader.isPathAllowed(REAL_REPO_ROOT, 'brain/notes/PutRolePolicy 403 Case.md'),
      true
    );
  });

  test('rejects paths outside the repo root', () => {
    assert.equal(KbReader.isPathAllowed(REAL_REPO_ROOT, '/etc/hosts'), false);
    assert.equal(KbReader.isPathAllowed(REAL_REPO_ROOT, '../outside.md'), false);
    assert.equal(KbReader.isPathAllowed(REAL_REPO_ROOT, 'does/not/exist.md'), false);
  });
});

describe('KbReader.read — real repo', () => {
  test('acceptance 1: reads the PutRolePolicy 403 note', async () => {
    const reader = new KbReader({ repoRoot: REAL_REPO_ROOT });
    const { path: rel, content } = await reader.read(
      'brain/notes/PutRolePolicy 403 Case.md'
    );
    assert.equal(rel, 'brain/notes/PutRolePolicy 403 Case.md');
    assert.ok(content.includes('PutRolePolicy'), 'content must mention PutRolePolicy');
  });

  test('read() output is redacted', async () => {
    const reader = new KbReader({ repoRoot: REAL_REPO_ROOT });
    const { content } = await reader.read('brain/notes/PutRolePolicy 403 Case.md');
    assert.ok(!/Authorization:\s*Token\s+\S+/.test(content), 'no raw token headers');
  });
});

describe('KbReader.read — symlink jail', () => {
  test('acceptance 2: symlink pointing outside the repo root throws', async () => {
    const repo = await makeTempRepo();
    const outsideDir = await makeTempRepo();
    const outsideFile = path.join(outsideDir, 'secret-outside.txt');
    await fsp.writeFile(outsideFile, 'OUTSIDE_CONTENT_MUST_NOT_LEAK\n');
    const notesDir = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(notesDir, { recursive: true });
    await fsp.symlink(outsideFile, path.join(notesDir, 'escape.md'));

    const reader = new KbReader({ repoRoot: repo });
    await assert.rejects(
      () => reader.read('brain/notes/escape.md'),
      ForbiddenPathError
    );
    // search() must not surface out-of-jail content either
    const hits = await reader.search({ query: 'OUTSIDE_CONTENT' });
    assert.equal(hits.length, 0);
  });
});

describe('KbReader.read — secret path refusal', () => {
  test('acceptance 3: .env access throws', async () => {
    const repo = await makeTempRepo();
    await fsp.writeFile(path.join(repo, '.env'), 'TOP_SECRET_MARKER=1\n');
    const reader = new KbReader({ repoRoot: repo });
    await assert.rejects(() => reader.read('.env'), ForbiddenPathError);
  });

  test('acceptance 3: awskey.env access throws', async () => {
    const repo = await makeTempRepo();
    await fsp.writeFile(path.join(repo, 'awskey.env'), 'TOP_SECRET_MARKER=1\n');
    const reader = new KbReader({ repoRoot: repo });
    await assert.rejects(() => reader.read('awskey.env'), ForbiddenPathError);
  });

  test('acceptance 4a: secret-pattern content file throws (castai_v1_)', async () => {
    const repo = await makeTempRepo();
    const notes = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(notes, { recursive: true });
    await fsp.writeFile(
      path.join(notes, 'leaky.md'),
      '# note\nkey was castai_v1_test123 in prod\n'
    );
    const reader = new KbReader({ repoRoot: repo });
    await assert.rejects(() => reader.read('brain/notes/leaky.md'), ForbiddenPathError);
  });

  test('secret-pattern content file throws (PRIVATE KEY)', async () => {
    const repo = await makeTempRepo();
    const notes = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(notes, { recursive: true });
    await fsp.writeFile(
      path.join(notes, 'pem.md'),
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n'
    );
    const reader = new KbReader({ repoRoot: repo });
    await assert.rejects(() => reader.read('brain/notes/pem.md'), ForbiddenPathError);
  });

  test('secret-pattern content file throws (AKIA key)', async () => {
    const repo = await makeTempRepo();
    const notes = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(notes, { recursive: true });
    await fsp.writeFile(
      path.join(notes, 'aws.md'),
      'access key id AKIAIOSFODNN7EXAMPLE was rotated\n'
    );
    const reader = new KbReader({ repoRoot: repo });
    await assert.rejects(() => reader.read('brain/notes/aws.md'), ForbiddenPathError);
  });

  test('acceptance 4b: non-secret token-like content is redacted in output', async () => {
    const repo = await makeTempRepo();
    const notes = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(notes, { recursive: true });
    await fsp.writeFile(
      path.join(notes, 'safe.md'),
      '# Safe note\nconfigure api_key=sk-live-abcdef123456 in the console\n'
    );
    const reader = new KbReader({ repoRoot: repo });
    const { content } = await reader.read('brain/notes/safe.md');
    assert.ok(!content.includes('sk-live-abcdef123456'), 'raw key must not leak');
    assert.ok(content.includes('api_key=[REDACTED]'), 'key must be masked');
  });

  test('search() never returns secret-named or secret-content files', async () => {
    const repo = await makeTempRepo();
    const notes = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(notes, { recursive: true });
    await fsp.writeFile(path.join(notes, '.env'), 'password=wibble\n');
    await fsp.writeFile(path.join(notes, 'creds.md'), 'token castai_v1_zzz here\n');
    await fsp.writeFile(path.join(notes, 'good.md'), '# Good\nmentions wibble token freely\n');
    const reader = new KbReader({ repoRoot: repo });
    const hits = await reader.search({ query: 'wibble token' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, 'brain/notes/good.md');
  });
});

describe('KbReader.search — real repo', () => {
  test('acceptance 5: finds the PutRolePolicy note with path + excerpt', async () => {
    const reader = new KbReader({ repoRoot: REAL_REPO_ROOT });
    const hits = await reader.search({ query: 'PutRolePolicy' });
    assert.ok(hits.length > 0, 'must return at least one hit');
    const hit = hits.find((h) => h.path === 'brain/notes/PutRolePolicy 403 Case.md');
    assert.ok(hit, 'must include the PutRolePolicy note');
    assert.equal(hit.title, 'PutRolePolicy 403 Case');
    assert.ok(typeof hit.excerpt === 'string' && hit.excerpt.length > 0);
    assert.ok(hit.excerpt.length <= 400, 'excerpt must be <= 400 chars');
    assert.ok(hit.score > 0);
  });
});

describe('KbReader.search — fabricated temp KB', () => {
  test('title comes from first markdown heading, excerpt around first match', async () => {
    const repo = await makeTempRepo();
    const docs = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(docs, { recursive: true });
    await fsp.writeFile(
      path.join(docs, 'evictor.md'),
      [
        '# Evictor Consolidation Guide',
        'intro line',
        'The evictor moves pods off nodes. evictor again.',
        'padding padding padding',
      ].join('\n')
    );
    await fsp.writeFile(
      path.join(docs, 'evictor-config-reference.md'),
      '# Config Reference\nunrelated body text\n'
    );
    const reader = new KbReader({ repoRoot: repo });
    const hits = await reader.search({ query: 'evictor' });

    assert.ok(hits.length >= 2);
    const guide = hits.find((h) => h.path === 'brain/notes/evictor.md');
    assert.ok(guide, 'content-matching file must be a hit');
    assert.equal(guide.title, 'Evictor Consolidation Guide');
    assert.ok(guide.excerpt.includes('evictor'));
    assert.ok(guide.excerpt.length <= 400);
    assert.ok(guide.score > 0);

    const configRef = hits.find(
      (h) => h.path === 'brain/notes/evictor-config-reference.md'
    );
    assert.ok(configRef, 'filename match alone must be a hit');
    assert.equal(configRef.title, 'Config Reference');
    // filename match alone must still produce a hit with at least the
    // filename-token score; the content+filename hit can legitimately score
    // higher (multiple occurrences accumulate).
    assert.ok(configRef.score >= 10);
  });

  test('no matches returns empty list; results capped at 10', async () => {
    const repo = await makeTempRepo();
    const docs = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(docs, { recursive: true });
    for (let i = 0; i < 15; i++) {
      await fsp.writeFile(
        path.join(docs, `zebra-${i}.md`),
        `# Zebra ${i}\nzebra content here\n`
      );
    }
    const reader = new KbReader({ repoRoot: repo });

    const none = await reader.search({ query: 'albatross' });
    assert.deepEqual(none, []);

    const many = await reader.search({ query: 'zebra' });
    assert.equal(many.length, 10);
    for (const hit of many) {
      assert.ok(hit.path.startsWith('brain/notes/zebra-'));
      assert.ok(hit.score > 0);
    }
  });

  test('oversized files beyond maxFileBytes are skipped by search and refused by read', async () => {
    const repo = await makeTempRepo();
    const docs = path.join(repo, 'brain', 'notes');
    await fsp.mkdir(docs, { recursive: true });
    await fsp.writeFile(
      path.join(docs, 'huge.md'),
      '# Huge\n' + 'needle '.repeat(64 * 1024) + '\n'
    );
    const reader = new KbReader({ repoRoot: repo, maxFileBytes: 1024 });
    const hits = await reader.search({ query: 'needle' });
    assert.equal(hits.length, 0);
    await assert.rejects(() => reader.read('brain/notes/huge.md'), ForbiddenPathError);
  });

  test('categoryHint boosts files whose path mentions the hint', async () => {
    const repo = await makeTempRepo();
    const notes = path.join(repo, 'brain', 'notes');
    const iamDir = path.join(notes, 'iam');
    await fsp.mkdir(iamDir, { recursive: true });
    await fsp.writeFile(path.join(notes, 'plain.md'), '# Plain\nabout iam policies\n');
    await fsp.writeFile(path.join(path.join(iamDir), 'case.md'), '# IAM Case\nabout iam policies\n');
    const reader = new KbReader({ repoRoot: repo });
    const hits = await reader.search({ query: 'iam', categoryHint: 'iam' });
    assert.ok(hits.length === 2);
    assert.equal(hits[0].path, 'brain/notes/iam/case.md');
  });
});

describe('KbReader default roots + absolute read', () => {
  test('absolute path inside repo works and is normalized to repo-relative', async () => {
    const reader = new KbReader({ repoRoot: REAL_REPO_ROOT });
    const abs = path.join(REAL_REPO_ROOT, 'brain/notes/PutRolePolicy 403 Case.md');
    const { path: rel } = await reader.read(abs);
    assert.equal(rel, 'brain/notes/PutRolePolicy 403 Case.md');
  });

  test('default repoRoot (parent of component dir) resolves to the real repo', async () => {
    const reader = new KbReader();
    assert.equal(reader.repoRoot, REAL_REPO_ROOT);
  });
});

test.after(async () => {
  // temp dirs are left in os.tmpdir(); harmless, but keep the tree quiet
  void fs;
});
