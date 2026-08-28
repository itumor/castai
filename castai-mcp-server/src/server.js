#!/usr/bin/env node
// CAST AI MCP server — stdio entry point.
//
// Phase 2 / step 1: scaffold only. The tool handlers are placeholders
// that return a "[step-1 placeholder]" message so the LLM host can
// verify the wiring (initialize, tools/list, tools/call) end-to-end
// before step 2 fills in real upstream calls.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { CastaiClient } from './castai-client.js';
import ApprovalGate from './approval-gate.js';
import {
  toolDefinitions,
  TOOL_NAMES,
  getToolDefinition,
  handlers as toolHandlers
} from './tools/index.js';

// ---------- config ----------

export function loadConfig(env = process.env) {
  return {
    apiKey: env.CASTAI_API_KEY || '',
    apiBase: env.CASTAI_API_BASE || 'https://api.eu.cast.ai',
    orgId: env.CASTAI_ORG_ID || null,
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
    approvalMode: (env.APPROVAL_MODE || 'block').toLowerCase()
  };
}

// ---------- secure logging stub ----------
//
// Step 1 ships a tiny stderr logger that goes through a no-op redactor
// stub. Step 4 fills in the real patterns from the security doc
// (castai_v1_*, Bearer tokens, X-API-Key headers, etc.).

const LEVELS = ['debug', 'info', 'warn', 'error'];

function levelIndex(level) {
  const i = LEVELS.indexOf(level);
  return i === -1 ? LEVELS.indexOf('info') : i;
}

export function createLogger(level = 'info', sink = process.stderr) {
  const min = levelIndex(level);
  const redact = createRedactor();
  const emit = (lvl) => (...args) => {
    if (levelIndex(lvl) < min) return;
    const line = args
      .map((a) => {
        const raw = typeof a === 'string' ? a : safeStringify(a);
        return redact(raw);
      })
      .join(' ');
    sink.write(`[${lvl}] ${line}\n`);
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    // Public hook so callers (and tests) can run the same redactor
    // over arbitrary input without going through the log line.
    redact
  };
}

const SENSITIVE_JSON_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'access-token',
  'authtoken',
  'auth_token',
  'auth-token',
  'password',
  'secret',
  'clientsecret',
  'client_secret',
  'client-secret'
]);

function redactJsonStringValues(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactJsonStringValues(parsed));
      } catch (_) {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactJsonStringValues(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_JSON_KEYS.has(String(k).toLowerCase()) && typeof v === 'string') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactJsonStringValues(v);
      }
    }
    return out;
  }
  return value;
}

export function createRedactor() {
  const REDACT_PATTERNS = [
    [/Authorization:\s*Token\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Token [REDACTED]'],
    [/Authorization:\s*Bearer\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Bearer [REDACTED]'],
    [/X-API-Key[\s:]+[A-Za-z0-9._\-\[\]]+/gi, 'X-API-Key: [REDACTED]'],
    [/Token\s+[A-Za-z0-9._\-\[\]]+/g, 'Token [REDACTED]'],
    [/Bearer\s+[A-Za-z0-9._\-\[\]]+/g, 'Bearer [REDACTED]'],
    [/castai_v1_[A-Za-z0-9._\-\[\]]+/g, 'castai_v1_[REDACTED]'],
    [/\bapi[_-]?key[\s]*[=:][\s]*[A-Za-z0-9._\-\[\]]+/gi, 'api_key=[REDACTED]']
  ];
  return function redact(input) {
    if (input == null) return input;
    let s = String(input);
    for (const [pattern, replacement] of REDACT_PATTERNS) {
      s = s.replace(pattern, replacement);
    }
    const walked = redactJsonStringValues(s);
    if (typeof walked === 'string') return walked;
    try {
      return JSON.stringify(walked);
    } catch (_) {
      return s;
    }
  };
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

// ---------- read-only enforcement middleware ----------
//
// Thin wrapper kept for the existing unit tests. The dispatcher in
// `buildServer` now talks to `ApprovalGate` directly; this wrapper
// preserves the contract exercised by test/server.test.js
// (blocks mutating tools in `block` mode, warns in `approve` mode).

export function enforceReadOnly(handler, { toolName, mutating, approvalMode, logger }) {
  return async (args, ctx) => {
    if (mutating && approvalMode !== 'approve') {
      const msg =
        `tool ${toolName} is a write operation; APPROVAL_MODE=approve is required ` +
        `(current mode: ${approvalMode || 'block'})`;
      logger.warn(`read-only gate blocked ${toolName}`);
      throw new Error(msg);
    }
    if (mutating && approvalMode === 'approve') {
      logger.warn(
        `approval gate for ${toolName} invoked; token check not yet implemented (step 1 stub)`
      );
    }
    return handler(args, ctx);
  };
}

// ---------- approval gate helpers ----------

// Render a tool's `pathTemplate` (e.g. "/v1/clusters/{clusterId}") using
// the caller-supplied arguments. Unknown placeholders are left as-is so
// the gate keeps a stable, debuggable path string.
function renderPath(template, args) {
  if (typeof template !== 'string' || !template) return template || '';
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const v = args && args[key];
    return v == null ? `{${key}}` : encodeURIComponent(String(v));
  });
}

function gateError(reason) {
  return {
    isError: true,
    content: [{ type: 'text', text: String(reason) }]
  };
}

// ---------- server factory ----------

// ---------- tool handlers ----------
//
// Real handlers live in src/tools/index.js. They each receive
// (args, { client }) and return an MCP-shaped result. Errors are
// already caught inside the handler and returned as
// { isError: true, content: [...] }, so the wrapped handler just
// passes them through.

// ---------- server factory ----------

export function buildServer(config, logger = createLogger(config.logLevel)) {
  const server = new Server(
    { name: 'castai-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // Lazy-construct the client. We avoid touching it on the
  // tools/list path so the server can boot before credentials are
  // available (useful for the `--check` / smoke test flow).
  let client = null;
  const getClient = () => {
    if (!client) {
      client = new CastaiClient({
        apiKey: config.apiKey,
        baseUrl: config.apiBase,
        orgId: config.orgId
      });
    }
    return client;
  };

  // Single shared gate instance. Mode comes from APPROVAL_MODE.
  const gate = new ApprovalGate(config.approvalMode);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = TOOL_NAMES.map((name) => {
      const def = toolDefinitions[name];
      return {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema
      };
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params || {};
    const def = getToolDefinition(name);
    if (!def) {
      throw new Error(`unknown tool: ${name}`);
    }
    const handler = toolHandlers[name];
    if (typeof handler !== 'function') {
      // Should never happen: registry and handler map are built from
      // the same source. Fail loud rather than silently no-op.
      throw new Error(`no handler registered for tool: ${name}`);
    }

    const a = args || {};
    const callClient = getClient();

    // Meta-tool: approve_operation. Always allowed (control plane),
    // returns a freshly minted token for the requested (toolName,
    // method, path) tuple.
    if (name === 'approve_operation') {
      const { toolName, method, path } = a;
      if (!toolName || !method || !path) {
        return gateError('approve_operation requires toolName, method and path');
      }
      const result = gate.approve(toolName, method, path);
      logger.info(`approval gate: granted token for ${toolName} ${method} ${path}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { toolName, method: method.toUpperCase(), path, token: result.token },
              null,
              2
            )
          }
        ]
      };
    }

    // Meta-tool: invoke_approved_operation. Verifies the token, then
    // runs the registered handler (which is itself the real mutating
    // tool). Read-only tools also go through this path so that callers
    // can opt into token-bearing invocations consistently, but the gate
    // passes them automatically because their HTTP method is GET.
    if (name === 'invoke_approved_operation') {
      const { toolName, method, path, token } = a;
      if (!toolName || !method || !path || !token) {
        return gateError(
          'invoke_approved_operation requires toolName, method, path and token'
        );
      }
      if (!gate.isApproved(toolName, method, path, token)) {
        logger.warn(
          `approval gate: rejected invoke_approved_operation for ${toolName} ${method} ${path}`
        );
        return gateError(
          `Token is invalid, expired, or already used for ${toolName} ${method} ${path}`
        );
      }
      const targetDef = getToolDefinition(toolName);
      const targetHandler = toolHandlers[toolName];
      if (!targetDef || typeof targetHandler !== 'function') {
        return gateError(`unknown tool: ${toolName}`);
      }
      logger.info(
        `approval gate: consumed token, invoking ${toolName} ${method} ${path}`
      );
      // Strip meta fields; pass through anything else as the inner
      // tool's arguments so e.g. delete_cluster still receives
      // clusterId.
      const { toolName: _tn, method: _m, path: _p, token: _t, ...innerArgs } = a;
      return targetHandler(innerArgs || {}, { client: callClient });
    }

    // Determine whether the call is mutating from either the explicit
    // flag or the inferred HTTP method (non-GET => mutating).
    const inferredMethod = def.method || (def.mutating ? 'POST' : 'GET');
    const resolvedPath =
      typeof def.pathTemplate === 'string'
        ? renderPath(def.pathTemplate, a)
        : a && a.path
          ? String(a.path)
          : '';

    if (def.mutating || inferredMethod !== 'GET') {
      const verdict = gate.check(name, inferredMethod, resolvedPath);
      if (!verdict.allowed) {
        logger.warn(
          `approval gate: blocked ${name} ${inferredMethod} ${resolvedPath} (mode=${config.approvalMode}): ${verdict.reason}`
        );
        return gateError(verdict.reason);
      }
      logger.info(
        `approval gate: allowed ${name} ${inferredMethod} ${resolvedPath} (mode=${config.approvalMode})`
      );
    }

    return handler(a, { client: callClient });
  });

  return { server, getClient };
}

// ---------- entry point ----------

export async function run() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (!config.apiKey) {
    logger.warn(
      'CASTAI_API_KEY not set; server will start but upstream calls will fail until a key is provided.'
    );
  } else {
    logger.info('castai-mcp-server starting');
    logger.info(`api base: ${config.apiBase}`);
    if (config.orgId) logger.info(`bound org id: ${config.orgId}`);
    logger.info(`approval mode: ${config.approvalMode}`);
  }

  const { server } = buildServer(config, logger);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('connected via stdio');
}

// Only auto-run when invoked directly. Allow tests to import the
// module without triggering stdio mode.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] || '');

if (invokedDirectly) {
  run().catch((err) => {
    process.stderr.write(
      `fatal: ${err && err.stack ? err.stack : String(err)}\n`
    );
    process.exit(1);
  });
}
