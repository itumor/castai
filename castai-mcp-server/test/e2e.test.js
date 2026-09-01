// End-to-end stdio MCP test with a mocked CAST AI upstream.
//
// Spawns `node src/server.js`, drives it over stdin/stdout with MCP
// JSON-RPC messages, and verifies that read-only tools call the
// expected CAST AI API paths on a local HTTP mock.

import { expect } from 'chai';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../src/server.js');

function startMockUpstream() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.method === 'GET' && req.url === '/v1/kubernetes/external-clusters') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clusters: [{ id: 'cluster-1', name: 'mock-cluster' }] }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const { port } = server.address();
      resolve({ server, port, requests });
    });
  });
}

function spawnServer(port) {
  const env = {
    ...process.env,
    CASTAI_API_KEY: 'test-api-key',
    CASTAI_API_BASE: `http://127.0.0.1:${port}`,
    LOG_LEVEL: 'error',
    APPROVAL_MODE: 'block'
  };
  const proc = spawn('node', [SERVER_PATH], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const stdoutLines = [];
  let stdoutBuffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let nl;
    while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, nl).trim();
      stdoutBuffer = stdoutBuffer.slice(nl + 1);
      if (line) stdoutLines.push(line);
    }
  });

  const stderrLines = [];
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    stderrLines.push(...chunk.split('\n').filter(Boolean));
  });

  return { proc, stdoutLines, stderrLines };
}

function send(proc, message) {
  return new Promise((resolve, reject) => {
    const line = JSON.stringify(message);
    if (proc.stdin.writableEnded || proc.stdin.destroyed) {
      return reject(new Error('stdin already closed'));
    }
    proc.stdin.write(`${line}\n`, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function waitForLines(lines, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const match = lines.find(predicate);
      if (match) {
        // Remove matched line so subsequent waits do not see it again.
        const idx = lines.indexOf(match);
        lines.splice(idx, 1);
        return resolve(JSON.parse(match));
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('timeout waiting for MCP response'));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function waitForResponse(lines, id, timeoutMs = 5000) {
  return waitForLines(lines, (line) => {
    try {
      const msg = JSON.parse(line);
      return msg.id === id;
    } catch (_) {
      return false;
    }
  }, timeoutMs);
}

describe('MCP stdio E2E with mocked upstream', function () {
  this.timeout(15000);

  let mock;
  let child;

  beforeEach(async () => {
    mock = await startMockUpstream();
    child = spawnServer(mock.port);
  });

  afterEach(async () => {
    if (child && child.proc && !child.proc.killed) {
      child.proc.kill('SIGTERM');
      // Give the process a moment to exit cleanly; force kill if needed.
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!child.proc.killed) child.proc.kill('SIGKILL');
    }
    if (mock && mock.server) {
      await new Promise((resolve) => mock.server.close(resolve));
    }
  });

  it('responds to initialize, lists tools, and calls list_clusters against the mock', async () => {
    const idInit = 1;
    await send(child.proc, {
      jsonrpc: '2.0',
      id: idInit,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' }
      }
    });
    const initRes = await waitForResponse(child.stdoutLines, idInit);
    expect(initRes.result.protocolVersion).to.equal('2024-11-05');
    expect(initRes.result.serverInfo.name).to.equal('castai-mcp-server');

    const idList = 2;
    await send(child.proc, {
      jsonrpc: '2.0',
      id: idList,
      method: 'tools/list'
    });
    const listRes = await waitForResponse(child.stdoutLines, idList);
    expect(listRes.result.tools).to.be.an('array');
    const toolNames = listRes.result.tools.map((t) => t.name);
    expect(toolNames).to.include('list_clusters');

    const idCall = 3;
    await send(child.proc, {
      jsonrpc: '2.0',
      id: idCall,
      method: 'tools/call',
      params: {
        name: 'list_clusters',
        arguments: {}
      }
    });
    const callRes = await waitForResponse(child.stdoutLines, idCall);
    expect(callRes.result.content).to.be.an('array');
    const parsed = JSON.parse(callRes.result.content[0].text);
    expect(parsed.clusters).to.have.lengthOf(1);
    expect(parsed.clusters[0].name).to.equal('mock-cluster');

    expect(mock.requests).to.have.lengthOf(1);
    expect(mock.requests[0].method).to.equal('GET');
    expect(mock.requests[0].url).to.equal('/v1/kubernetes/external-clusters');
    expect(mock.requests[0].headers.authorization).to.equal('Token test-api-key');
  });

  it('blocks mutating tools in block approval mode', async () => {
    const idInit = 10;
    await send(child.proc, {
      jsonrpc: '2.0',
      id: idInit,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' }
      }
    });
    await waitForResponse(child.stdoutLines, idInit);

    const idCall = 11;
    await send(child.proc, {
      jsonrpc: '2.0',
      id: idCall,
      method: 'tools/call',
      params: {
        name: 'delete_cluster',
        arguments: { clusterId: 'cluster-1' }
      }
    });
    const callRes = await waitForResponse(child.stdoutLines, idCall);
    expect(callRes.result.isError).to.equal(true);
    expect(callRes.result.content[0].text).to.match(/approval mode|read-only|write operation/i);
  });
});
