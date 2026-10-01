/**
 * Chunk 10 unit tests — McpCastaiTools (MCP subprocess client).
 *
 * Runs a REAL MCP server subprocess (test/fixtures/fake-mcp-server.mjs) over
 * stdio and exercises the full lifecycle: start → tools/list cache →
 * whitelisted calls → gate rejection without RPC → crash mid-session → stop →
 * orphan-guard bookkeeping.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpCastaiTools, McpCastaiError } from '../../src/adapters/castai/mcp-castai-tools.js';
import {
  READ_ONLY_TOOL_NAMES,
  ToolNotAllowedError,
} from '../../src/adapters/castai/castai-tools.js';

const FAKE_SERVER = fileURLToPath(new URL('../fixtures/fake-mcp-server.mjs', import.meta.url));

/** Wait until the pid is dead (or fail after ~5s). */
async function assertDead(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      return; // ESRCH — process gone
    }
  }
  // Last resort: SIGKILL so the suite never leaks a subprocess.
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  assert.fail(`pid ${pid} still alive after stop()`);
}

/** Kill leftover child if a test bailed before stop(). */
function killLeftover(client) {
  if (client && client.pid) {
    try { client.pid && process.kill(client.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

let logFile;

beforeEach(() => {
  logFile = path.join(mkdtempSync(path.join(tmpdir(), 'mcp-test-')), 'calls.log');
});

const clientsToClean = [];
afterEach(async () => {
  while (clientsToClean.length) {
    const c = clientsToClean.pop();
    killLeftover(c);
    await c.stop().catch(() => {});
  }
});

function makeClient(extraEnv = {}) {
  const client = new McpCastaiTools({
    serverCommand: ['node', FAKE_SERVER],
    env: { ...extraEnv, FAKE_MCP_LOG: logFile },
    timeoutMs: 15000,
  });
  clientsToClean.push(client);
  return client;
}

test('full lifecycle: start → tools/list cached with all 10 names → calls round-trip → stop', async () => {
  const client = makeClient();
  await client.start();

  // tools/list cached with exactly the 10 read-only names.
  assert.deepEqual([...client.toolNames].sort(), [...READ_ONLY_TOOL_NAMES].sort());

  // Child actually spawned as a subprocess.
  assert.equal(typeof client.pid, 'number');

  // Call a couple of tools; data round-trips through content[0].text JSON.
  const clusters = await client.call('list_clusters', { limit: 3 });
  assert.deepEqual(clusters, { ok: true, isError: false, data: { tool: 'list_clusters', echo: { limit: 3 } } });

  const nodes = await client.call('get_cluster_nodes', { clusterId: 'c-123' });
  assert.equal(nodes.ok, true);
  assert.equal(nodes.isError, false);
  assert.deepEqual(nodes.data, { tool: 'get_cluster_nodes', echo: { clusterId: 'c-123' } });

  // Prove the RPCs actually hit the server subprocess (call log written).
  const logged = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.deepEqual(logged.sort(), ['get_cluster_nodes', 'list_clusters']);

  // Graceful stop: client closed, child terminated, exit guard removed.
  const pid = client.pid;
  await client.stop();
  assert.equal(client.pid, null);
  await assertDead(pid);
});

test('call() with non-whitelisted tool name throws ToolNotAllowedError without any RPC round trip', async () => {
  const client = makeClient();
  await client.start();

  await assert.rejects(
    () => client.call('delete_cluster', { clusterId: 'c-1' }),
    (err) => {
      assert.equal(err.name, 'ToolNotAllowedError');
      assert.equal(err.toolName, 'delete_cluster');
      assert.ok(err instanceof ToolNotAllowedError);
      assert.ok(!(err instanceof McpCastaiError), 'must be a local gate error, not an MCP error');
      return true;
    },
  );

  // No round trip: the server call log has no entry for delete_cluster.
  await new Promise((r) => setTimeout(r, 100));
  const logged = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  assert.equal(logged.includes('delete_cluster'), false);

  await client.stop();
});

test('crash mid-session: next call rejects with McpCastaiError; stop() still succeeds', async () => {
  const client = makeClient();
  await client.start();
  const pid = client.pid;
  assert.equal(typeof pid, 'number');

  // Kill the server subprocess out from under the client.
  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 200));

  await assert.rejects(
    () => client.call('list_clusters', {}),
    (err) => {
      assert.equal(err.name, 'McpCastaiError');
      assert.ok(err instanceof McpCastaiError);
      assert.equal(err.details?.phase, 'call');
      return true;
    },
  );

  // stop() is still safe and resolves.
  await client.stop();
  assert.equal(client.pid, null);
  await assertDead(pid);
});

test('orphan guard: exit listener registered on construct, removed after stop(); child not orphaned', async () => {
  const baseline = process.listenerCount('exit');

  const client = makeClient();
  // Constructing registers exactly one extra 'exit' listener (the orphan guard).
  assert.equal(process.listenerCount('exit'), baseline + 1);

  await client.start();
  const pid = client.pid;
  assert.equal(process.listenerCount('exit'), baseline + 1, 'guard stays registered while running');

  await client.stop();

  // stop() unregisters the guard.
  assert.equal(process.listenerCount('exit'), baseline);

  // And no orphan: the child process is dead.
  await assertDead(pid);
});
