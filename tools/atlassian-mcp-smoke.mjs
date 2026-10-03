#!/usr/bin/env node
// Minimal read-only smoke test / CLI for the Atlassian Rovo MCP server,
// bridged over stdio via mcp-remote with cached OAuth (~/.mcp-auth).
//
// Usage:
//   node atlassian-mcp-smoke.mjs tools                 # list remote tools
//   node atlassian-mcp-smoke.mjs call <tool> '<json>'  # call a tool (GET-only tools!)
//
// Read-only posture per AGENTS.md: never call write/mutation tools here.

import { spawn } from 'node:child_process';

const NODE = '/Users/eramadan/.local/bin/node';
const PROXY = '/Users/eramadan/.dsh/mcp-remote/node_modules/mcp-remote/dist/proxy.js';
const URL = 'https://mcp.atlassian.com/v2/mcp';

const [, , action = 'tools', toolName, toolArgsRaw] = process.argv;

const child = spawn(NODE, [PROXY, URL], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

child.stderr.on('data', (d) => {
  const s = d.toString();
  if (process.env.ATLASSIAN_MCP_DEBUG) process.stderr.write('[bridge] ' + s);
});

function request(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const init = await request('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'atlassian-mcp-smoke', version: '0.1.0' },
}, 60000);

if (init.error) {
  console.error('initialize error:', JSON.stringify(init.error));
  child.kill();
  process.exit(1);
}

notify('notifications/initialized', {});

if (action === 'tools') {
  const res = await request('tools/list', {}, 60000);
  if (res.error) {
    console.error('tools/list error:', JSON.stringify(res.error));
  } else {
    for (const t of res.result.tools) {
      const desc = (t.description || '').split('\n')[0].slice(0, 100);
      console.log(`${t.name}  -- ${desc}`);
    }
  }
  child.kill();
  process.exit(0);
}

if (action === 'call') {
  if (!toolName) { console.error('usage: call <tool> <jsonArgs>'); child.kill(); process.exit(2); }
  let args = {};
  if (toolArgsRaw) { try { args = JSON.parse(toolArgsRaw); } catch (e) { console.error('bad json args:', e.message); child.kill(); process.exit(2); } }
  const res = await request('tools/call', { name: toolName, arguments: args }, 120000);
  console.log(JSON.stringify(res, null, 2));
  child.kill();
  process.exit(0);
}

console.error(`unknown action: ${action}`);
child.kill();
process.exit(2);
