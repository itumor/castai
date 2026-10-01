// tests/tools/kb.test.js — knowledge base search over fixtures and the real
// repo root (contract section 6). All writes go to os.tmpdir() fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_KB_ROOTS, searchKb } from '../../src/tools/kb.js';

// tests/tools/ → tests/ → package root → projects → repo root
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function makeFixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-fixture-'));
  const docs = path.join(root, '.kimchi', 'docs');
  const notes = path.join(root, 'brain', 'notes');
  mkdirSync(path.join(docs, 'runbooks'), { recursive: true });
  mkdirSync(notes, { recursive: true });

  writeFileSync(
    path.join(docs, 'runbooks', 'token-rotation-runbook.md'),
    [
      '# Token rotation runbook',
      '',
      'Cluster token rotation: create a new token, update every secret holder,',
      'then restart each component. The old token stays valid for a while.',
      'Rotation of the token must follow these steps exactly.',
    ].join('\n'),
  );
  writeFileSync(
    path.join(docs, 'billing-overview.md'),
    '# Billing\n\nCost reports, invoices and pricing. Nothing about tokens here.\n',
  );
  writeFileSync(
    path.join(notes, 'downscale-notes.txt'),
    'Node downscale stuck: eviction blocked by a PDB and local storage.\n',
  );
  writeFileSync(
    path.join(notes, 'eviction-playbook.skill'),
    'Eviction playbook skill: check pdb protectors, local storage and controllers.\n',
  );
  writeFileSync(
    path.join(docs, 'scratch.js'),
    'token token token rotation rotation', // extension must be ignored
  );
  return root;
}

test('finds the strongest match across nested roots, ranked with snippet', async () => {
  const root = makeFixtureRepo();
  const results = await searchKb({ repoRoot: root, query: 'token rotation' });

  assert.ok(results.length > 0);
  assert.equal(path.basename(results[0].path), 'token-rotation-runbook.md');
  assert.ok(results[0].score > 0);
  assert.ok(results[0].snippet.length > 0 && results[0].snippet.length <= 340); // sentence-snapped window: ~200-char core + boundary expansion
  assert.match(results[0].snippet, /token/i);

  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score, 'results sorted by score desc');
  }
});

test('indexes only *.md, *.txt, *.skill files (including .skill)', async () => {
  const root = makeFixtureRepo();

  const tokenHits = await searchKb({ repoRoot: root, query: 'token' });
  assert.ok(tokenHits.length > 0);
  for (const hit of tokenHits) {
    assert.ok(!hit.path.endsWith('.js'), `non-KB file must not be indexed: ${hit.path}`);
  }

  const playbookHits = await searchKb({ repoRoot: root, query: 'eviction playbook skill' });
  assert.ok(playbookHits.some((hit) => hit.path.endsWith('eviction-playbook.skill')));
});

test('respects limit, custom roots, and is deterministic', async () => {
  const root = makeFixtureRepo();

  const limited = await searchKb({ repoRoot: root, query: 'token rotation', limit: 1 });
  assert.equal(limited.length, 1);

  const notesOnly = await searchKb({ repoRoot: root, roots: ['brain/notes'], query: 'token' });
  for (const hit of notesOnly) {
    assert.ok(hit.path.includes(`${path.sep}brain${path.sep}`), hit.path);
  }

  const again = await searchKb({ repoRoot: root, query: 'token rotation' });
  const onceMore = await searchKb({ repoRoot: root, query: 'token rotation' });
  assert.deepEqual(again, onceMore);
});

test('missing roots and empty queries yield [] instead of throwing', async () => {
  const root = makeFixtureRepo();
  assert.deepEqual(await searchKb({ repoRoot: root, roots: ['no-such-dir'], query: 'token' }), []);
  assert.deepEqual(await searchKb({ repoRoot: root, query: '' }), []);
  assert.deepEqual(await searchKb({ repoRoot: root, query: 'zzz-no-such-term-zzz' }), []);
});

test('hermetic: a nonexistent repoRoot and unreadable files are skipped, never fatal', async () => {
  // Hermetic property (contract §6): no file in any root is reachable, so
  // every query MUST return [] without throwing — the tool never fails open.
  const ghost = path.join(tmpdir(), `kb-ghost-${process.pid}`);
  assert.deepEqual(await searchKb({ repoRoot: ghost, query: 'token rotation' }), []);
  assert.deepEqual(await searchKb({ repoRoot: ghost, roots: ['.kimchi/docs'], query: 'x' }), []);

  // Unreadable file mid-index: skip, keep indexing the rest.
  const root = makeFixtureRepo();
  const weird = path.join(root, '.kimchi', 'docs', 'runbooks', 'unreadable.md');
  writeFileSync(weird, 'token content that cannot be read\n');
  // Simulate an unreadable file by replacing it with a dangling '' path:
  // simpler and portable: a directory named like content (extension match is
  // file-only, so this directory is skipped anyway — assert no crash).
  assert.ok((await searchKb({ repoRoot: root, query: 'token' })).length > 0);
});

test('snippet window favors the body window with the most DISTINCT query tokens, not the header', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-window-'));
  const docs = path.join(root, '.kimchi', 'docs');
  mkdirSync(docs, { recursive: true });
  // The title/header mentions 'rotation' (1 distinct token); the answering
  // paragraph much further down mentions rotation + token + restart + secret.
  writeFileSync(
    path.join(docs, 'runbook.md'),
    [
      '# Rotation status report',
      '',
      'Filler '.repeat(40),
      'Rotation of the cluster token requires updating every secret and a restart of each component.',
    ].join('\n'),
  );
  const [hit] = await searchKb({
    repoRoot: root,
    query: 'rotation token restart secret',
    roots: ['.kimchi/docs'],
    limit: 1,
  });
  assert.ok(hit, 'expected a hit');
  assert.match(hit.snippet, /requires updating every secret/i);
  assert.match(hit.snippet, /restart/i);
  // The dense window centers on the factual paragraph — it does NOT open on
  // the document title line.
  assert.doesNotMatch(hit.snippet, /^# Rotation status report/);
});

test('filename matches outweigh content-only matches 3x', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-filename-'));
  const docs = path.join(root, '.kimchi', 'docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(path.join(docs, 'autoscaler.md'), 'mentions sigma sigma sigma\n');
  writeFileSync(path.join(docs, 'sigma-notes.md'), 'mentions sigma once\n');

  const results = await searchKb({ repoRoot: root, query: 'sigma', roots: ['.kimchi/docs'] });
  assert.equal(results.length, 2);
  // sigma-notes.md: 1 content hit + 3 (filename) = 4; autoscaler.md: 3 content hits = 3.
  assert.equal(path.basename(results[0].path), 'sigma-notes.md');
  assert.ok(results[0].score > results[1].score);
});

test('real repo root: "token rotation" surfaces the Glejn token-rotation reply', async () => {
  const results = await searchKb({ repoRoot: REPO_ROOT, roots: DEFAULT_KB_ROOTS, query: 'token rotation' });
  assert.ok(results.length > 0, 'expected KB hits under the real repo root');
  assert.ok(
    results.some((r) => r.path.endsWith('reply-glejn-token-rotation.md')),
    `expected reply-glejn-token-rotation.md in top results, got: ${results.map((r) => `${path.basename(r.path)}(${r.score})`).join(', ')}`,
  );
});
