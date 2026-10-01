/**
 * Integration test: MCP roundtrip against the real castai-mcp-server (chunk 17a).
 *
 * Opt-in via env: SWARM_INT_MCP=1 and CASTAI_API_KEY must both be set, else the
 * roundtrip test skips cleanly (naming exactly which vars are missing) and the
 * suite still exits 0.
 *
 * When enabled, spawns the real ../castai-mcp-server/src/server.js over stdio,
 * verifies the cached tools/list contains all 10 read-only tool names, calls
 * list_clusters over the wire, and tolerates the server's real response
 * envelope (bare array or an envelope object containing the cluster array).
 *
 * A second, always-run sub-test needs no env: a bogus serverCommand path must
 * reject start() with the typed McpCastaiError within timeoutMs.
 *
 * No secrets are printed; the CASTAI_API_KEY is only read for presence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  McpCastaiTools,
  McpCastaiError,
} from '../../src/adapters/castai/mcp-castai-tools.js';
import { READ_ONLY_TOOL_NAMES } from '../../src/adapters/castai/castai-tools.js';

/** Hard cap for the opt-in roundtrip test body. */
const HARD_CAP_MS = 30_000;

/**
 * Env guard for the opt-in roundtrip. Returns the names of every missing
 * guard variable (empty array = enabled).
 * @returns {string[]}
 */
function missingGuardVars() {
  const missing = [];
  if (process.env.SWARM_INT_MCP !== '1') missing.push('SWARM_INT_MCP=1');
  if (!process.env.CASTAI_API_KEY) missing.push('CASTAI_API_KEY');
  return missing;
}

/**
 * Tolerate the real server's response envelope: the cluster list may be the
 * data itself, or nested one level inside a wrapper object (clusters, items,
 * result, data, or the first array-valued property).
 * @param {unknown} data
 * @returns {unknown[] | null}
 */
function extractClusterArray(data) {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (data);
    for (const key of ['clusters', 'items', 'result', 'data']) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

test('MCP roundtrip: real castai-mcp-server, list_clusters returns clusters (opt-in)', { timeout: HARD_CAP_MS }, async (t) => {
  // Guard FIRST — skip (never fail) when not opted in.
  const missing = missingGuardVars();
  if (missing.length > 0) {
    t.skip(`set SWARM_INT_MCP=1 + CASTAI_API_KEY to enable; missing: ${missing.join(', ')}`);
    return;
  }

  const tools = new McpCastaiTools({});
  let hardCapTimer;
  /** @type {Promise<never>} */
  let hardCap;
  /** @type {Promise<void> | undefined} */
  let body;
  try {
    // Belt-and-braces internal cap: guarantees stop() runs even if a call
    // hangs past the cap, so the test process can always exit.
    hardCap = new Promise((_, reject) => {
      hardCapTimer = setTimeout(
        () => reject(new Error(`roundtrip exceeded hard cap of ${HARD_CAP_MS}ms`)),
        HARD_CAP_MS - 500,
      );
      hardCapTimer.unref?.();
    });

    body = (async () => {
      await tools.start();

      // Cached tool list must include all 10 read-only names.
      const cached = tools.toolNames;
      assert.ok(Array.isArray(cached), 'tools/list cached after start()');
      for (const name of READ_ONLY_TOOL_NAMES) {
        assert.ok(cached.includes(name), `cached tool list includes '${name}'`);
      }

      // Real RPC roundtrip.
      const res = await tools.call('list_clusters');
      assert.equal(res.ok, true, `list_clusters ok (data: ${JSON.stringify(res.data)?.slice(0, 200)})`);
      assert.equal(res.isError, false);

      const clusters = extractClusterArray(res.data);
      assert.ok(Array.isArray(clusters), 'list_clusters data is an array (or an envelope containing one)');
      for (const entry of clusters) {
        assert.ok(entry !== null && typeof entry === 'object', 'cluster entries are objects');
      }
    })();

    await Promise.race([body, hardCap]);
  } finally {
    clearTimeout(hardCapTimer);
    // If the hard cap fired first, the abandoned body rejects later — keep a
    // no-op handler attached so the run never dies on an unhandled rejection.
    body?.catch(() => { /* unblock hard-cap path */ });
    await tools.stop();
  }
});

test('start() rejects with typed error for bogus serverCommand (always runs)', { timeout: 10_000 }, async () => {
  const bogusServer = path.join('does', 'not', 'exist', 'fake-mcp-server.js');
  const timeoutMs = 3_000;
  const tools = new McpCastaiTools({
    serverCommand: ['node', bogusServer],
    timeoutMs,
  });

  const startedAt = Date.now();
  try {
    await assert.rejects(
      () => tools.start(),
      (err) => {
        assert.ok(err instanceof McpCastaiError, `typed McpCastaiError, got ${err?.constructor?.name}: ${err?.message}`);
        assert.equal(err.name, 'McpCastaiError');
        return true;
      },
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(
      elapsedMs < timeoutMs + 2_000,
      `start() rejected within timeoutMs (elapsed ${elapsedMs}ms, timeoutMs ${timeoutMs})`,
    );
  } finally {
    await tools.stop().catch(() => { /* already torn down */ });
  }
});
