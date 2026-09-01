#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * E2E launcher. Starts the backend (MOCK_K8S=true) and a static
 * frontend server with /api proxy. Kills both on exit.
 *
 * Usage: node test/e2e/start-servers.mjs <backendPort> <frontendPort>
 */

import { spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const backendPort = Number(process.argv[2] ?? 3101);
const frontendPort = Number(process.argv[3] ?? 5103);

const env = {
  ...process.env,
  MOCK_K8S: 'true',
  PORT: String(backendPort),
  NODE_ENV: 'production',
};

const procs = [];

function spawnChild(name, command, args, childEnv, options = {}) {
  const proc = spawn(command, args, {
    cwd: projectRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  proc.stdout.on('data', (d) =>
    process.stdout.write(`[${name}] ${d.toString()}`),
  );
  proc.stderr.on('data', (d) =>
    process.stderr.write(`[${name}] ${d.toString()}`),
  );
  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  procs.push(proc);
  return proc;
}

function killAll(signal = 'SIGTERM') {
  for (const p of procs) {
    if (!p.killed) {
      try {
        p.kill(signal);
      } catch {
        /* ignore */
      }
    }
  }
}

process.on('SIGINT', () => {
  killAll();
  process.exit(130);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(143);
});
process.on('exit', () => killAll());

// Best-effort: kill any stale instance of our own servers from
// previous runs on the same ports so the launcher is idempotent.
async function killPortOwner(port) {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

await killPortOwner(backendPort);
await killPortOwner(frontendPort);
await new Promise((r) => setTimeout(r, 250));

// 1. Build backend if dist is missing.
const backendEntry = path.join(
  projectRoot,
  'dist',
  'backend',
  'backend',
  'server.js',
);
if (!existsSync(backendEntry)) {
  console.log('[e2e] building backend…');
  await new Promise((resolve, reject) => {
    const build = spawnChild(
      'build-be',
      'npx',
      ['tsc', '-p', 'tsconfig.backend.json'],
      process.env,
    );
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('backend build failed')),
    );
  });
}

const frontendDist = path.join(projectRoot, 'dist', 'frontend');
if (!existsSync(path.join(frontendDist, 'index.html'))) {
  console.log('[e2e] building frontend…');
  await new Promise((resolve, reject) => {
    const build = spawnChild('build-fe', 'npx', ['vite', 'build'], process.env);
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('frontend build failed')),
    );
  });
}

// 2. Start backend and wait until /api/healthz responds.
console.log(`[e2e] starting backend on :${backendPort} (MOCK_K8S=true)`);
spawnChild('backend', process.execPath, [backendEntry], env, { detached: false });

async function waitForBackend() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${backendPort}/api/healthz`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend did not become ready in time');
}

await waitForBackend();
console.log('[e2e] backend ready');

// 3. Static frontend server with /api proxy and SPA fallback.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const resolved = path.resolve(root, '.' + urlPath.split('?')[0]);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const staticServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost`);

    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      const backendUrl = `http://127.0.0.1:${backendPort}${url.pathname}${url.search}`;
      let body;
      if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = Buffer.concat(chunks);
      }
      const upstream = await fetch(backendUrl, {
        method: req.method,
        headers: req.headers['content-type']
          ? { 'content-type': req.headers['content-type'] }
          : {},
        body,
        duplex: 'half',
      });
      res.statusCode = upstream.status;
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
      return;
    }

    let filePath = safeJoin(frontendDist, url.pathname);
    if (!filePath) {
      res.statusCode = 400;
      res.end('bad request');
      return;
    }
    let s;
    try {
      s = await stat(filePath);
    } catch {
      filePath = path.join(frontendDist, 'index.html');
      try {
        s = await stat(filePath);
      } catch {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
    }
    if (s.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.end(data);
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
});

await new Promise((resolve, reject) => {
  staticServer.once('error', reject);
  staticServer.listen(frontendPort, '127.0.0.1', () => {
    console.log(`[e2e] frontend static server on :${frontendPort}`);
    resolve();
  });
});

console.log('[e2e] all servers up — Playwright may now run tests');

// Keep the process alive.
setInterval(() => {}, 1 << 30);
