// tests/pipeline/cli.test.js — contract section 9 (CLI).
// Spawns the real CLI off fixture threads; all outputs land in tmp dirs
// (--out). Exit codes: 0 ok, 2 usage/parse failures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseThreadFile } from '../../bin/support-swarm.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const binPath = path.join(packageRoot, 'bin', 'support-swarm.mjs');

async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [binPath, ...args], {
      encoding: 'utf8',
      env: { ...process.env }, // offline mode ignores credentials
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('CLI answer on the pdb fixture exits 0 and prints the reply path', async () => {
  const outbox = mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-'));
  const res = await runCli(['answer', path.join(packageRoot, 'fixtures', 'thread-pdb-scaledown.md'), '--out', outbox]);
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /verdict\s*:\s*PASS/);
  const replyMd = (res.stdout.match(/reply\s*:\s*(\S+\.md)/) || [])[1];
  assert.ok(replyMd && existsSync(replyMd), `expected reply md on disk: ${res.stdout}`);
});

test('CLI exits 2 for missing file, unparseable thread, and bad args', async () => {
  const missing = await runCli(['answer', '/definitely/not/here.md']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /cannot read thread file/);

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-bad-'));
  const bad = path.join(tmp, 'bad-thread.md');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(bad, 'this file has no From: header\n');
  const unparseable = await runCli(['answer', bad]);
  assert.equal(unparseable.code, 2);
  assert.match(unparseable.stderr, /cannot parse thread file/);

  const noArgs = await runCli([]);
  assert.equal(noArgs.code, 2);

  const badFlag = await runCli(['answer', path.join(packageRoot, 'fixtures', 'thread-pdb-scaledown.md'), '--nonsense']);
  assert.equal(badFlag.code === 1 || badFlag.code === 2, true, `unexpected code ${badFlag.code}`);
});

test('parseThreadFile: header parsed ONCE; quoted From:/Subject: inside the body are preserved verbatim', () => {
  const raw = [
    'From: Fabian Jennrich <fabian.jennrich@siemens.example.com>',
    'Subject: Onboarding fails — PutRolePolicy AccessDenied',
    '',
    'Our CI fails with iam:PutRolePolicy AccessDenied.',
    '',
    'Previously:',
    '',
    'From: Support <support@example.com>',
    'Subject: Re: earlier ticket',
    '',
    '(quoted below) Your earlier case was resolved by scoping the role.',
    '',
    ';; sim: nodes=1 managed=true pods=1',
    'From: not a header inside the body would be stripped WRONGLY',
  ].join('\n');
  const { thread, simSpec } = parseThreadFile(raw);

  assert.equal(thread.from, 'Fabian Jennrich <fabian.jennrich@siemens.example.com>');
  assert.equal(thread.subject, 'Onboarding fails — PutRolePolicy AccessDenied');
  assert.equal(simSpec.nodes.length, 1);
  assert.equal(simSpec.nodes[0].managed, true);
  assert.equal(simSpec.pods.length, 1);
  const body = thread.messages[0].body;
  // The quoted message's header lines survive — only the ;; sim: line is removed.
  assert.match(body, /From: Support <support@example\.com>/);
  assert.match(body, /Subject: Re: earlier ticket/);
  assert.match(body, /From: not a header inside the body would be stripped WRONGLY/);
  assert.doesNotMatch(body, /sim:/);
});

test('parseThreadFile rejects files without the From:/Subject: header pair', () => {
  assert.throws(() => parseThreadFile('Subject: no from\n\nbody'), /must start/);
  assert.throws(() => parseThreadFile('From: a@b.c\n\nSubject: too late\n'), /must start/);
});
