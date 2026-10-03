#!/usr/bin/env node
// Granola MCP driver — talks to the OFFICIAL Granola MCP (https://mcp.granola.ai/mcp)
// through the mcp-remote OAuth bridge (stdio <-> Streamable HTTP).
//
// First run: opens a browser for Granola sign-in, caches tokens in .mcp-auth/ (git-ignored).
// Later runs: reuses + auto-refreshes cached tokens. No interaction needed.
//
// Usage:
//   granola-mcp.mjs account                                   # who am I / scopes
//   granola-mcp.mjs list [this_week|last_week|last_30_days]   # meeting titles + ids
//   granola-mcp.mjs get <meetingId> [<meetingId> ...]         # notes + AI summary
//   granola-mcp.mjs transcript <meetingId>                    # verbatim transcript
//   granola-mcp.mjs folders                                   # folders + ids
//   granola-mcp.mjs query "<natural language>"                # NL search over meetings
//   granola-mcp.mjs raw tools                                 # tools/list
//   granola-mcp.mjs raw call <tool> '<json-args>'             # any tool, raw
//
// Read-only by construction: the official Granola MCP exposes no write tools.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPS = path.join(HERE, '.deps');
const AUTH = process.env.MCP_REMOTE_CONFIG_DIR || path.join(HERE, '.mcp-auth');
const SERVER = process.env.GRANOLA_MCP_URL || 'https://mcp.granola.ai/mcp';
const BRIDGE = path.join(DEPS, 'node_modules', 'mcp-remote', 'dist', 'proxy.js');

async function ensureDeps() {
  if (existsSync(BRIDGE)) return;
  mkdirSync(DEPS, { recursive: true });
  console.error('[granola-mcp] installing mcp-remote bridge (one-time)...');
  const cache = path.join(DEPS, '.npmcache');
  const code = await new Promise((resolve) => {
    const r = spawn('npm', ['install', '--prefix', DEPS, 'mcp-remote@latest',
      '--no-fund', '--no-audit', '--loglevel=error'], {
      stdio: 'inherit',
      env: { ...process.env, npm_config_cache: cache },
    });
    r.on('exit', resolve);
    r.on('error', () => resolve(1));
  });
  if (code !== 0) { console.error(`npm install failed (${code})`); process.exit(1); }
}

function rpc(child, method, params, timeoutMs = 120000) {
  const id = rpc.nextId = (rpc.nextId || 0) + 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
    const onMsg = (buf) => {
      for (const line of buf.toString().split('\n')) {
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === id) {
          clearTimeout(timer); child.stdout.off('data', onMsg);
          msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
      }
    };
    child.stdout.on('data', onMsg);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) { console.error('no command given; see header of granola-mcp.mjs'); process.exit(2); }

  await ensureDeps();
  const child = spawn('node', [BRIDGE, SERVER], {
    stdio: ['pipe', 'pipe', process.env.GRANOLA_MCP_DEBUG ? 'inherit' : 'ignore'],
    env: { ...process.env, MCP_REMOTE_CONFIG_DIR: AUTH },
  });
  child.on('exit', (c) => { if (c && c !== 0) process.exit(c); });

  try {
    await rpc(child, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'granola-mcp-driver', version: '0.1.0' },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const call = async (name, args) => {
      const res = await rpc(child, 'tools/call', { name, arguments: args });
      if (res.isError) throw new Error(res.content.map((c) => c.text).join('\n'));
      return res.content.map((c) => c.text).join('\n');
    };

    switch (cmd) {
      case 'account':
        console.log(await call('get_account_info', {})); break;
      case 'list': {
        const txt = await call('list_meetings', { time_range: rest[0] || 'last_30_days' });
        for (const m of txt.matchAll(/<meeting id="([^"]+)" title="([^"]*)" date="([^"]*)"[^>]*url="([^"]*)"/g)) {
          console.log(`${m[3]}  |  ${m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}\n    id=${m[1]}\n    ${m[4]}`);
        }
        const count = txt.match(/count="(\d+)"/);
        console.error(`[${count ? count[1] : '?'} meetings]`);
        break;
      }
      case 'get':
        if (!rest.length) throw new Error('usage: get <meetingId> [...]');
        console.log(await call('get_meetings', { meeting_ids: rest })); break;
      case 'transcript':
        if (!rest[0]) throw new Error('usage: transcript <meetingId>');
        console.log(await call('get_meeting_transcript', { meeting_id: rest[0] })); break;
      case 'folders':
        console.log(await call('list_meeting_folders', {})); break;
      case 'query':
        if (!rest.length) throw new Error('usage: query "<natural language>"');
        console.log(await call('query_granola_meetings', { query: rest.join(' ') })); break;
      case 'raw':
        if (rest[0] === 'tools') {
          const t = await rpc(child, 'tools/list', {});
          for (const tool of t.tools) console.log('-', tool.name, '|', (tool.description || '').slice(0, 110));
        } else if (rest[0] === 'call') {
          console.log(await call(rest[1], JSON.parse(rest[2] || '{}')));
        } else throw new Error('usage: raw tools | raw call <tool> <json-args>');
        break;
      default:
        throw new Error(`unknown command: ${cmd}`);
    }
  } finally {
    child.kill();
  }
}

main().catch((e) => { console.error('[granola-mcp] error:', e.message); process.exit(1); });
