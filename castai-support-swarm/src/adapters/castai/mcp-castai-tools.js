/**
 * McpCastaiTools — real CAST AI MCP subprocess client (read-only).
 *
 * Spawns an MCP server over stdio, performs the initialize handshake via
 * @modelcontextprotocol/sdk, caches `tools/list`, and forwards whitelisted
 * read-only tool calls. Defense-in-depth: any tool name outside
 * READ_ONLY_TOOL_NAMES is rejected locally (ToolNotAllowedError) without an
 * RPC round trip.
 *
 * Lifecycle:
 *   1. start():  spawn serverCommand (stdio pipes), env inherited plus
 *                CASTAI_API_KEY / CASTAI_API_BASE / CASTAI_ORG_ID passthrough
 *                (never logged); connect with connectTimeoutMs; kill child on
 *                timeout; cache tools/list.
 *   2. call():   gate → client.callTool({name, arguments}) → parse
 *                content[0].text as JSON when possible → { ok, isError, data }.
 *   3. stop():   client.close() → SIGTERM → 3s grace → SIGKILL.
 *   4. Orphan guard: a process 'exit' listener SIGKILLs the child if still
 *      alive; stop() unregisters it.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { READ_ONLY_TOOL_NAMES, ToolNotAllowedError } from './castai-tools.js';

/** Component root (…/castai-support-swarm). */
const COMPONENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Repo root (parent of the component dir). */
const REPO_ROOT = path.dirname(COMPONENT_ROOT);

const GRACE_TERM_MS = 3000;
const CLIENT_INFO = { name: 'castai-support-swarm', version: '0.1.0' };

/** Environment variable names forwarded to the MCP server subprocess. */
const PASSTHROUGH_ENV_KEYS = Object.freeze([
  'CASTAI_API_KEY',
  'CASTAI_API_BASE',
  'CASTAI_ORG_ID',
]);

/** Typed error for transport/protocol/lifecycle failures. */
export class McpCastaiError extends Error {
  /**
   * @param {string} message
   * @param {object} [details] structured details (never includes env values)
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'McpCastaiError';
    this.details = details;
  }
}

/** Default serverCommand: node <repoRoot>/castai-mcp-server/src/server.js. */
function defaultServerCommand() {
  return ['node', path.join(REPO_ROOT, 'castai-mcp-server', 'src', 'server.js')];
}

export class McpCastaiTools {
  /**
   * @param {object} opts
   * @param {string[]} [opts.serverCommand] argv array, no shell (default: bundled castai-mcp-server)
   * @param {object} [opts.env] extra env vars for the subprocess (e.g. CASTAI_API_*); merged over process.env
   * @param {number} [opts.timeoutMs] connect timeout in ms (default 15000)
   */
  constructor({ serverCommand, env, timeoutMs = 15000 } = {}) {
    this._serverCommand = Array.isArray(serverCommand) && serverCommand.length > 0
      ? [...serverCommand]
      : defaultServerCommand();
    this._extraEnv = env ?? {};
    this._timeoutMs = timeoutMs;

    this._client = null;
    this._transport = null;
    this._child = null;
    this._toolNames = null;
    this._stopped = false;

    // Orphan guard: if this process exits while the server child is alive,
    // SIGKILL it so we never leak MCP subprocesses.
    this._exitGuard = () => {
      if (this._child && this._child.exitCode === null && this._child.pid) {
        try { this._child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };
    process.on('exit', this._exitGuard);
  }

  /** PID of the spawned server child, or null when not running. */
  get pid() {
    if (this._child && this._child.exitCode === null) return this._child.pid;
    return null;
  }

  /** Cached tool names from tools/list (null before start()). */
  get toolNames() {
    return this._toolNames ? Object.freeze([...this._toolNames]) : null;
  }

  /** Whether the orphan-guard 'exit' listener is currently registered. */
  get hasExitGuard() {
    return process.listenerCount('exit') > 0
      && process.listeners('exit').includes(this._exitGuard);
  }

  /**
   * Build the subprocess env: inherit process.env, overlay user-supplied env,
   * and ensure the CASTAI_* passthrough keys flow through when present.
   * Values are never logged anywhere in this class.
   * @returns {Record<string, string>}
   */
  _buildEnv() {
    const env = { ...process.env, ...this._extraEnv };
    for (const key of PASSTHROUGH_ENV_KEYS) {
      if (env[key] === undefined && process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }
    return env;
  }

  /**
   * Spawn the MCP server and perform the initialize handshake, then cache
   * tools/list. On timeout or handshake failure the child is killed and the
   * promise rejects with McpCastaiError.
   */
  async start() {
    if (this._client) {
      throw new McpCastaiError('McpCastaiTools already started', { phase: 'start' });
    }

    const transport = new StdioClientTransport({
      command: this._serverCommand[0],
      args: this._serverCommand.slice(1),
      env: this._buildEnv(),
      stderr: 'pipe',
    });

    const client = new Client(CLIENT_INFO, { capabilities: {} });

    let timer;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new McpCastaiError(
              `MCP connect timed out after ${this._timeoutMs}ms`,
              { phase: 'connect', timeoutMs: this._timeoutMs },
            ));
          }, this._timeoutMs);
        }),
      ]);
    } catch (err) {
      clearTimeout(timer);
      // Rejection path: kill the child, tear down, rethrow as McpCastaiError.
      const child = transport._process ?? null;
      if (child && child.exitCode === null && child.pid) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
      try { await transport.close(); } catch { /* best effort */ }
      if (err instanceof McpCastaiError) throw err;
      throw new McpCastaiError(
        `MCP connect failed: ${err?.message ?? String(err)}`,
        { phase: 'connect' },
      );
    }
    clearTimeout(timer);

    this._client = client;
    this._transport = transport;
    this._child = transport._process ?? null;

    // Cache tools/list once.
    let tools;
    try {
      const res = await client.listTools();
      tools = res.tools ?? [];
    } catch (err) {
      await this.stop().catch(() => {});
      throw new McpCastaiError(
        `MCP tools/list failed: ${err?.message ?? String(err)}`,
        { phase: 'listTools' },
      );
    }
    this._toolNames = tools.map((t) => t.name).filter(Boolean);
  }

  /**
   * Call a read-only CAST AI tool.
   *
   * @param {string} toolName must be in READ_ONLY_TOOL_NAMES
   * @param {object} [args]
   * @returns {Promise<{ok: boolean, isError: boolean, data: unknown}>}
   * @throws {ToolNotAllowedError} non-whitelisted tool name (no RPC round trip)
   * @throws {McpCastaiError} not started, or transport/protocol failure
   */
  async call(toolName, args = {}) {
    if (!READ_ONLY_TOOL_NAMES.includes(toolName)) {
      // Rejected locally — never sent to the server subprocess.
      throw new ToolNotAllowedError(toolName);
    }
    if (!this._client) {
      throw new McpCastaiError('McpCastaiTools not started (call start() first)', { phase: 'call' });
    }
    if (this._stopped) {
      throw new McpCastaiError('McpCastaiTools already stopped', { phase: 'call' });
    }

    let result;
    try {
      result = await this._client.callTool({ name: toolName, arguments: args });
    } catch (err) {
      // Transport-level failure (e.g. server crashed mid-session).
      throw new McpCastaiError(
        `MCP call failed for '${toolName}': ${err?.message ?? String(err)}`,
        { phase: 'call', toolName },
      );
    }

    const isError = result?.isError === true;
    const content = Array.isArray(result?.content) ? result.content : [];
    let data = null;
    const first = content[0];
    if (first && first.type === 'text' && typeof first.text === 'string') {
      try {
        data = JSON.parse(first.text);
      } catch {
        data = first.text; // not JSON — pass the raw text through
      }
    }

    return { ok: !isError, isError, data };
  }

  /**
   * Graceful teardown: client.close() → SIGTERM → 3s grace → SIGKILL.
   * Unregisters the orphan-guard 'exit' listener. Idempotent.
   */
  async stop() {
    this._stopped = true;

    if (this._client) {
      try { await this._client.close(); } catch { /* best effort */ }
      this._client = null;
    }

    const child = this._child;
    if (child && child.exitCode === null && child.pid) {
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(termTimer);
          clearTimeout(killTimer);
          resolve();
        };
        const termTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }, GRACE_TERM_MS);
        const killTimer = setTimeout(done, GRACE_TERM_MS + 500);
        child.once('exit', done);
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      });
    }
    this._child = null;

    if (this._transport) {
      try { await this._transport.close(); } catch { /* best effort */ }
      this._transport = null;
    }

    // Orphan guard no longer needed — unregister.
    process.removeListener('exit', this._exitGuard);
  }
}
