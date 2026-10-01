import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileDraftSink } from '../../src/adapters/gmail/file-draft-sink.js';

const DRAFT_POST = {
  to: 'customer@example.com',
  subject: 'Re: Nodes not coming up',
  body: 'We reproduced the issue and confirmed the fix.\n\nStep 1: check node templates.',
  caseId: 'case-123',
  confidence: 85,
  route: 'answer_with_evidence',
  unresolvedClaims: [],
};

async function makeOutDir() {
  return mkdtemp(path.join(tmpdir(), 'draft-sink-'));
}

test('FileDraftSink writes draft.md whose content equals draftPost.body and returns its path', async () => {
  const outDir = await makeOutDir();
  try {
    const sink = new FileDraftSink({ outDir });
    const { path: draftPath } = await sink.save(DRAFT_POST);

    assert.equal(draftPath, path.join(outDir, 'case-123', 'draft.md'));
    assert.equal(await readFile(draftPath, 'utf8'), DRAFT_POST.body);
    // no ledger/verdict on this draftPost → no extra files
    assert.deepEqual(await readdir(path.join(outDir, 'case-123')), ['draft.md']);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('FileDraftSink writes ledger.json and verdict.json when draftPost carries them', async () => {
  const outDir = await makeOutDir();
  try {
    const ledger = { caseId: 'case-123', evidence: [{ id: 'E1', type: 'documentation' }] };
    const verdict = { pass: true, claims: [], reason: 'verified' };
    const sink = new FileDraftSink({ outDir });
    await sink.save({ ...DRAFT_POST, ledger, verdict });

    const caseDir = path.join(outDir, 'case-123');
    assert.deepEqual(await readdir(caseDir), ['draft.md', 'ledger.json', 'verdict.json']);
    assert.deepEqual(JSON.parse(await readFile(path.join(caseDir, 'ledger.json'), 'utf8')), ledger);
    assert.deepEqual(JSON.parse(await readFile(path.join(caseDir, 'verdict.json'), 'utf8')), verdict);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('FileDraftSink refuses caseIds containing ".."', async () => {
  const outDir = await makeOutDir();
  try {
    const sink = new FileDraftSink({ outDir });
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: '..' }), /refuses unsafe caseId/);
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: 'case..123' }), /refuses unsafe caseId/);
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: '../escape' }), /refuses unsafe caseId/);
    assert.equal(await readdir(outDir).then((entries) => entries.length), 0);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('FileDraftSink refuses caseIds containing path separators', async () => {
  const outDir = await makeOutDir();
  try {
    const sink = new FileDraftSink({ outDir });
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: 'a/b' }), /refuses unsafe caseId/);
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: 'a\\b' }), /refuses unsafe caseId/);
    assert.equal(await readdir(outDir).then((entries) => entries.length), 0);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('FileDraftSink rejects a draftPost without a usable caseId', async () => {
  const outDir = await makeOutDir();
  try {
    const sink = new FileDraftSink({ outDir });
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: undefined }), /caseId/);
    await assert.rejects(sink.save({ ...DRAFT_POST, caseId: '' }), /caseId/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
