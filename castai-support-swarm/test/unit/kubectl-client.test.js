// Unit tests for chunk 9 — KubectlClient whitelist subprocess wrapper.
// All tests stub execImpl; a real kubectl binary is NEVER spawned.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { KubectlClient, KubectlError } from '../../src/adapters/k8s/kubectl-client.js';

const MB = 1024 * 1024;

// Builds a fake child process handle that emits optional stream data and
// then closes with the given exit code on the next microtask (after the
// client has attached its handlers).
function makeFakeChild({ stdoutText = '', stderrText = '', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const kills = [];
  child.kill = (signal) => kills.push(signal);
  queueMicrotask(() => {
    if (stdoutText) child.stdout.emit('data', Buffer.from(stdoutText));
    if (stderrText) child.stderr.emit('data', Buffer.from(stderrText));
    child.emit('close', exitCode);
  });
  return { child, kills };
}

// Stub execImpl that records calls and returns a succeeding fake child.
function stubExec(childOverrides) {
  const calls = [];
  const execImpl = (cmd, argv, opts) => {
    calls.push({ cmd, argv, opts });
    const { child } = makeFakeChild(childOverrides);
    return child;
  };
  return { execImpl, calls };
}

test('refuses non-whitelisted verb BEFORE execImpl is invoked', async () => {
  const { execImpl, calls } = stubExec();
  const client = new KubectlClient({ execImpl });

  await assert.rejects(
    () => client.run('delete', 'pod', 'x'),
    (err) => err instanceof KubectlError && /not allowed/.test(err.message),
  );
  assert.equal(calls.length, 0, 'execImpl must never be called for a refused verb');
});

test("refuses 'apply' (and other mutating verbs) without spawning", async () => {
  const { execImpl, calls } = stubExec();
  const client = new KubectlClient({ execImpl });

  for (const verb of ['apply', 'patch', 'edit', 'exec', 'drain', 'scale']) {
    await assert.rejects(
      () => client.run(verb, 'pod', 'x'),
      KubectlError,
      `verb '${verb}' must be refused`,
    );
  }
  assert.equal(calls.length, 0, 'no spawn for any refused verb');
});

test('all 8 whitelisted verbs pass the gate with a stub execImpl', async () => {
  for (const verb of KubectlClient.ALLOWED_VERBS) {
    const { execImpl, calls } = stubExec({ stdoutText: 'ok' });
    const client = new KubectlClient({ execImpl });
    const res = await client.run(verb);
    assert.equal(calls.length, 1, `verb '${verb}' should spawn exactly once`);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, 'ok');
  }
});

test('ALLOWED_VERBS is exactly the specified frozen list', () => {
  assert.deepEqual([...KubectlClient.ALLOWED_VERBS], [
    'get',
    'describe',
    'logs',
    'top',
    'api-resources',
    'api-versions',
    'cluster-info',
    'version',
  ]);
  assert.equal(Object.isFrozen(KubectlClient.ALLOWED_VERBS), true);
});

test('refuses --raw= argument BEFORE execImpl is invoked', async () => {
  const { execImpl, calls } = stubExec({ stdoutText: 'raw body' });
  const client = new KubectlClient({ execImpl });

  await assert.rejects(
    () => client.run('get', '--raw=/api/v1/namespaces/default/pods'),
    (err) =>
      err instanceof KubectlError &&
      /--raw/.test(err.message) &&
      err.exitCode === null,
  );
  assert.equal(calls.length, 0, 'execImpl must never be called for a refused --raw arg');
});

test('timeout: child is SIGKILLed and run rejects with a timeout KubectlError', async () => {
  // A child that never closes on its own; kill() is recorded but has no
  // effect on emission (the close event never arrives).
  const hanging = new EventEmitter();
  hanging.stdout = new EventEmitter();
  hanging.stderr = new EventEmitter();
  const kills = [];
  hanging.kill = (signal) => kills.push(signal);

  const client = new KubectlClient({
    timeoutMs: 20,
    execImpl: () => hanging,
  });

  await assert.rejects(
    () => client.run('get', 'pods'),
    (err) =>
      err instanceof KubectlError && err.timedOut === true && /timed out/.test(err.message),
  );
  assert.deepEqual(kills, ['SIGKILL'], 'kill must be called with SIGKILL exactly once');
});

test('1MB cap: oversized stdout is truncated and flagged', async () => {
  const big = 'a'.repeat(2 * MB);
  const { execImpl } = stubExec({ stdoutText: big });
  const client = new KubectlClient({ execImpl });

  const res = await client.run('get', 'pods');
  assert.equal(res.stdoutTruncated, true);
  assert.ok(Buffer.byteLength(res.stdout, 'utf8') <= MB, 'stdout must not exceed 1MB');
  assert.equal(Buffer.byteLength(res.stdout, 'utf8'), MB);
});

test('1MB cap: oversized stderr is truncated and flagged', async () => {
  const big = 'e'.repeat(2 * MB);
  const { execImpl } = stubExec({ stderrText: big });
  const client = new KubectlClient({ execImpl });

  const res = await client.run('get', 'pods');
  assert.equal(res.stderrTruncated, true);
  assert.ok(Buffer.byteLength(res.stderr, 'utf8') <= MB, 'stderr must not exceed 1MB');
});

test('exit code != 0 rejects with KubectlError and redacted stderr', async () => {
  const secret = 'castai_v1_SUPERSECRET000111222';
  const { execImpl } = stubExec({
    stderrText: `Error: unauthorized with key ${secret}`,
    exitCode: 1,
  });
  const client = new KubectlClient({ execImpl });

  await assert.rejects(
    () => client.run('get', 'pods'),
    (err) => {
      assert.ok(err instanceof KubectlError, 'must be a KubectlError');
      assert.equal(err.exitCode, 1);
      assert.ok(err.stderr.includes('castai_v1_[REDACTED]'), 'secret key must be masked');
      assert.ok(!err.stderr.includes(secret), 'raw secret must not survive redaction');
      assert.ok(!err.message.includes(secret), 'message must not leak the raw secret');
      return true;
    },
  );
});

test('no shell: execImpl receives the binary plus an argv array and shell:false', async () => {
  const { execImpl, calls } = stubExec({ stdoutText: 'v1.29' });
  const client = new KubectlClient({ kubectlPath: '/usr/local/bin/kubectl', execImpl });

  await client.run('get', 'pods', '-A', '--field-selector', 'status.phase=Running');

  assert.equal(calls.length, 1);
  const { cmd, argv, opts } = calls[0];
  assert.equal(cmd, '/usr/local/bin/kubectl');
  assert.ok(Array.isArray(argv), 'argv must be an array, not a shell string');
  assert.deepEqual(argv, ['get', 'pods', '-A', '--field-selector', 'status.phase=Running']);
  assert.equal(opts.shell, false, 'must never run through a shell');
});

test('resolves {stdout, stderr, exitCode} shape on success', async () => {
  const { execImpl } = stubExec({ stdoutText: 'out', stderrText: 'warn' });
  const client = new KubectlClient({ execImpl });

  const res = await client.run('version');
  assert.deepEqual(
    { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode },
    { stdout: 'out', stderr: 'warn', exitCode: 0 },
  );
  assert.equal(res.stdoutTruncated, false);
  assert.equal(res.stderrTruncated, false);
});

test('defaults: kubectlPath=kubectl, timeoutMs=15000', () => {
  const client = new KubectlClient({});
  assert.equal(client.kubectlPath, 'kubectl');
  assert.equal(client.timeoutMs, 15000);
});
