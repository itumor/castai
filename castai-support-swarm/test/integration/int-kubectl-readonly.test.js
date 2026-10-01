// Integration test — chunk 17b: KubectlClient read-only against a real cluster.
//
// Opt-in via SWARM_INT_KUBECTL=1 plus a reachable kubeconfig. Without the
// env var (or without a working `kubectl config current-context`) the
// guarded tests SKIP cleanly so the default `npm test` run stays green.
//
// Contract under test:
//   - `run('version')` and `run('get','namespaces')` succeed against the
//     live cluster with real kubectl (no execImpl stub).
//   - `run('delete', ...)` is refused SYNCHRONOUSLY by the frozen verb
//     whitelist — before any child process is spawned — with a KubectlError
//     carrying the whitelist message (exitCode null, empty stderr), NOT a
//     kubectl server error.
//   - The whitelist gate holds regardless of environment: the always-run
//     sub-test proves a non-whitelisted verb never reaches execImpl even
//     with no env var set.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { KubectlClient, KubectlError } from '../../src/adapters/k8s/kubectl-client.js';

const SKIP_HINT = 'set SWARM_INT_KUBECTL=1 with a reachable kubeconfig; missing:';

// Detect (and memoize) the integration preconditions. The env-var check
// short-circuits, so `kubectl` is only probed when explicitly opted in.
let cachedEnv = null;
function detectEnv() {
  if (cachedEnv) return cachedEnv;
  if (process.env.SWARM_INT_KUBECTL !== '1') {
    cachedEnv = { ok: false, missing: 'SWARM_INT_KUBECTL=1' };
    return cachedEnv;
  }
  const probe = spawnSync('kubectl', ['config', 'current-context'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (probe.error || probe.status !== 0 || !String(probe.stdout || '').trim()) {
    cachedEnv = { ok: false, missing: 'reachable kubeconfig (kubectl config current-context failed)' };
    return cachedEnv;
  }
  cachedEnv = { ok: true, context: String(probe.stdout).trim() };
  return cachedEnv;
}

function skip(env) {
  return `${SKIP_HINT} ${env.missing}`;
}

// --- Guarded tests: only meaningful with SWARM_INT_KUBECTL=1 + a cluster ---

test('int kubectl: run("version") succeeds against the live cluster', async (t) => {
  const env = detectEnv();
  if (!env.ok) return t.skip(skip(env));

  // Real KubectlClient — real spawn, no execImpl stub.
  const client = new KubectlClient();
  const res = await client.run('version');
  assert.strictEqual(res.exitCode, 0, `kubectl version exited ${res.exitCode}: ${res.stderr}`);
  assert.ok(res.stdout.trim().length > 0, 'kubectl version stdout must be non-empty');
});

test('int kubectl: run("delete","pod","does-not-matter") throws KubectlError BEFORE spawning', async (t) => {
  const env = detectEnv();
  if (!env.ok) return t.skip(skip(env));

  // Real client (real spawn would hit the cluster if the gate leaked) —
  // but `delete` must be refused by the whitelist before any spawn. The
  // whitelist message with empty stderr / null exitCode proves the failure
  // is the local gate, not a kubectl server error (server errors arrive as
  // non-zero exit + populated stderr).
  const client = new KubectlClient();
  await assert.rejects(
    client.run('delete', 'pod', 'does-not-matter'),
    (err) => {
      assert.ok(err instanceof KubectlError, `expected KubectlError, got ${err?.name}`);
      assert.match(
        err.message,
        /^kubectl verb not allowed: "delete"\. Allowed verbs: /,
        'expected the whitelist refusal message, not a kubectl error',
      );
      assert.strictEqual(err.exitCode, null, 'refusal happens before any process exit code');
      assert.strictEqual(err.stderr, '', 'refusal happens before any kubectl stderr');
      assert.strictEqual(err.timedOut, false);
      return true;
    },
  );
});

test('int kubectl: run("get","namespaces") lists at least one namespace', async (t) => {
  const env = detectEnv();
  if (!env.ok) return t.skip(skip(env));

  const client = new KubectlClient();
  const res = await client.run('get', 'namespaces');
  assert.strictEqual(res.exitCode, 0, `kubectl get namespaces exited ${res.exitCode}: ${res.stderr}`);

  const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.length >= 1, 'namespace listing stdout must be non-empty');
  const rows = lines.slice(1); // drop the NAME/Age header row
  assert.ok(
    rows.length >= 1,
    `expected at least one namespace row, got output: ${JSON.stringify(lines)}`,
  );
});

// --- Always-run sub-test: the whitelist gate holds with NO env var set ---

test('whitelist gate holds without env: run("delete","pod","x") never invokes execImpl', async () => {
  let execCalls = 0;
  // Stub execImpl that would record any spawn attempt. If the gate leaked,
  // this would increment (and the fake child would fail the test).
  const recordingExec = (cmd, argv, opts) => {
    execCalls += 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };

  const client = new KubectlClient({ execImpl: recordingExec });
  await assert.rejects(
    client.run('delete', 'pod', 'x'),
    (err) => {
      assert.ok(err instanceof KubectlError);
      assert.match(err.message, /^kubectl verb not allowed: "delete"\. Allowed verbs: /);
      return true;
    },
  );
  assert.strictEqual(execCalls, 0, 'non-whitelisted verb must never reach execImpl');
});
