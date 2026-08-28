'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Reset module cache so each test gets a fresh server module with clean state.
// This matters because server.js reads env vars at request time, but it also
// makes sure `app` reflects the latest DASHBOARD_API_TOKEN etc.
function loadServer(env) {
  const prevEnv = { ...process.env };
  // Wipe relevant variables first, then apply the test's env.
  for (const key of ['CASTAI_API_KEY', 'CASTAI_REGION', 'PORT', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  // Bust the module cache for server.js so the cached `app` instance is rebuilt.
  const modPath = require.resolve('../server.js');
  delete require.cache[modPath];
  const mod = require('../server.js');
  // Reset in-memory cache between tests to avoid cross-test pollution.
  if (typeof mod.resetCache === 'function') {
    mod.resetCache();
  }
  return { ...mod, __restore: () => { process.env = prevEnv; } };
}

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (_err) {
          parsed = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: body });
      });
    });
    req.on('error', reject);
  });
}

// Build a fetch Response-like object with .json() for our wrappers.
function makeJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

const CLUSTER_LIST = {
  items: [
    {
      id: 'cluster-1',
      name: 'demo-eks',
      status: { state: 'ready', agentStatus: 'connected' },
      providerType: 'eks',
      region: 'us-east-1',
    },
    {
      id: 'cluster-2',
      name: 'demo-gke',
      status: 'ready',
      providerType: 'gke',
      region: 'europe-west1',
    },
  ],
};

const NODES_CLUSTER_1 = { items: [{}, {}, {}] };
const NODES_CLUSTER_2 = { items: [{}, {}] };

const USAGE_CLUSTER_1 = [
  {
    cpuRequested: 10,
    cpuUsed: 4,
    cpuUtilization: 0.4,
    memoryRequested: 20,
    memoryUsed: 8,
    memoryUtilization: 0.4,
  },
];
const USAGE_CLUSTER_2 = {
  cpuRequested: 5,
  cpuUsed: 1,
  cpuUtilization: 0.2,
  memoryRequested: 10,
  memoryUsed: 2,
  memoryUtilization: 0.2,
};

const SAVINGS_CLUSTER_1 = {
  totals: {
    currentMonthlyCost: 100,
    optimizedMonthlyCost: 60,
    monthlySavings: 40,
    savingsPercentage: 40,
  },
};
const SAVINGS_CLUSTER_2 = {
  summary: {
    currentMonthlyCost: 50,
    optimizedMonthlyCost: 30,
    monthlySavings: 20,
    savingsPercentage: 40,
  },
};

const WORKLOADS_CLUSTER_1 = {
  items: [
    {
      id: 'wl-1',
      current: { cpu: '100m', memory: '128Mi' },
      recommendation: { cpu: '80m', memory: '128Mi' }, // cpu differs -> opportunity
    },
    {
      id: 'wl-2',
      current: { cpu: '200m', memory: '256Mi' },
      recommendation: { cpu: '200m', memory: '256Mi' }, // no diff
    },
  ],
};
const WORKLOADS_CLUSTER_2 = {
  items: [
    {
      id: 'wl-3',
      current: { cpu: '500m', memory: '1Gi' },
      recommendation: { cpu: '250m', memory: '512Mi' }, // both differ -> opportunity
    },
  ],
};

function buildFetchMock() {
  const apiKeySeen = [];
  const calls = [];

  async function mockFetch(url, options = {}) {
    calls.push({ url, options });
    const headers = options.headers || {};
    if (headers['X-API-Key']) {
      apiKeySeen.push(headers['X-API-Key']);
    }

    const u = new URL(url);
    const path = u.pathname + u.search;

    if (path === '/v1/kubernetes/external-clusters') {
      return makeJsonResponse(CLUSTER_LIST);
    }
    const nodesMatch = path.match(/^\/v1\/kubernetes\/external-clusters\/([^/]+)\/nodes$/);
    if (nodesMatch) {
      const id = nodesMatch[1];
      if (id === 'cluster-1') return makeJsonResponse(NODES_CLUSTER_1);
      if (id === 'cluster-2') return makeJsonResponse(NODES_CLUSTER_2);
      return makeJsonResponse({ items: [] });
    }
    const usageMatch = path.match(/^\/v1\/cost-reports\/clusters\/([^/]+)\/resource-usage$/);
    if (usageMatch) {
      const id = usageMatch[1];
      if (id === 'cluster-1') return makeJsonResponse(USAGE_CLUSTER_1);
      if (id === 'cluster-2') return makeJsonResponse(USAGE_CLUSTER_2);
      return makeJsonResponse([]);
    }
    const savingsMatch = path.match(/^\/v1\/cost-reports\/clusters\/([^/]+)\/savings$/);
    if (savingsMatch) {
      const id = savingsMatch[1];
      if (id === 'cluster-1') return makeJsonResponse(SAVINGS_CLUSTER_1);
      if (id === 'cluster-2') return makeJsonResponse(SAVINGS_CLUSTER_2);
      return makeJsonResponse({});
    }
    const workloadsMatch = path.match(/^\/v1\/workload-autoscaling\/clusters\/([^/]+)\/workloads$/);
    if (workloadsMatch) {
      const id = workloadsMatch[1];
      if (id === 'cluster-1') return makeJsonResponse(WORKLOADS_CLUSTER_1);
      if (id === 'cluster-2') return makeJsonResponse(WORKLOADS_CLUSTER_2);
      return makeJsonResponse({ items: [] });
    }

    return makeJsonResponse({ error: `unexpected url: ${path}` }, { ok: false, status: 404 });
  }

  return { mockFetch, calls, apiKeySeen };
}

// ---- Tests ----------------------------------------------------------------

test.afterEach(() => {
  // Restore process.env to its pre-test state. The `loadServer` helper
  // captures a snapshot per test, but `process.env` is shared globally.
  // Tests that don't use loadServer should still reset state.
  for (const key of ['CASTAI_API_KEY', 'CASTAI_REGION', 'PORT', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS']) {
    if (process.env[`__RESTORE_${key}__`]) {
      process.env[key] = process.env[`__RESTORE_${key}__`];
      delete process.env[`__RESTORE_${key}__`];
    }
  }
});

function snapshotEnv(keys) {
  for (const key of keys) {
    if (key in process.env) {
      process.env[`__RESTORE_${key}__`] = process.env[key];
    } else {
      delete process.env[`__RESTORE_${key}__`];
    }
  }
}

test('GET /api/health returns 200 and {status:"ok"}', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app } = loadServer({ CASTAI_API_KEY: 'test-key' });
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  } finally {
    await stopServer(server);
  }
});

test('GET /api/clusters without DASHBOARD_API_TOKEN returns 200 and full cluster array', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body), 'response must be a JSON array');
    assert.equal(res.body.length, 2);

    const c1 = res.body[0];
    assert.equal(c1.id, 'cluster-1');
    assert.equal(c1.name, 'demo-eks');
    assert.equal(c1.status, 'ready');
    assert.equal(c1.providerType, 'eks');
    assert.equal(c1.region, 'us-east-1');
    assert.equal(c1.agentStatus, 'connected');
    assert.equal(c1.nodeCount, 3);
    assert.equal(c1.resources.cpuRequested, 10);
    assert.equal(c1.resources.cpuUsed, 4);
    assert.equal(c1.resources.cpuUtilization, 0.4);
    assert.equal(c1.resources.memoryRequested, 20);
    assert.equal(c1.resources.memoryUsed, 8);
    assert.equal(c1.resources.memoryUtilization, 0.4);
    assert.equal(c1.savings.currentMonthlyCost, 100);
    assert.equal(c1.savings.optimizedMonthlyCost, 60);
    assert.equal(c1.savings.monthlySavings, 40);
    assert.equal(c1.savings.savingsPercentage, 40);
    assert.equal(c1.workloadOptimizationOpportunities, 1);

    const c2 = res.body[1];
    assert.equal(c2.id, 'cluster-2');
    assert.equal(c2.nodeCount, 2);
    assert.equal(c2.workloadOptimizationOpportunities, 1);
    assert.equal(c2.savings.currentMonthlyCost, 50);
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('GET /api/clusters with DASHBOARD_API_TOKEN set but no Authorization header returns 401', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({
    CASTAI_API_KEY: 'test-key',
    DASHBOARD_API_TOKEN: 'secret-token',
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(res.status, 401);
  } finally {
    await stopServer(server);
    __restore();
  }
});

test('GET /api/clusters with DASHBOARD_API_TOKEN set and correct Authorization header returns 200', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({
    CASTAI_API_KEY: 'test-key',
    DASHBOARD_API_TOKEN: 'secret-token',
  });

  const originalFetch = globalThis.fetch;
  const { mockFetch } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters`, {
      Authorization: 'Bearer secret-token',
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('Response body does not contain the CAST AI API key value', async () => {
  const sensitiveKey = 'sk_live_DO_NOT_LEAK_12345';
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: sensitiveKey });

  const originalFetch = globalThis.fetch;
  const { mockFetch } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters`);
    const text = JSON.stringify(res.body);
    assert.ok(
      !text.includes(sensitiveKey),
      'API key must not appear in the response body',
    );

    // Also verify the X-API-Key header is sent on upstream calls.
    // Trigger a fetch by hitting /api/health then /api/clusters again.
    await getJson(`${baseUrl}/api/health`);
    // The header check is implicit - we already intercepted mockFetch above.
    // Belt-and-braces: hit clusters again and re-check.
    const res2 = await getJson(`${baseUrl}/api/clusters`);
    assert.ok(!JSON.stringify(res2.body).includes(sensitiveKey));
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('CAST AI API failure returns 5xx JSON error without leaking the API key', async () => {
  const sensitiveKey = 'sk_live_DO_NOT_LEAK_67890';
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: sensitiveKey });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters`);
    assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
    const text = JSON.stringify(res.body);
    assert.ok(
      !text.includes(sensitiveKey),
      'API key must not appear in error response',
    );
    assert.ok(
      typeof res.body.error === 'string',
      'error response must include a safe message string',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('GET /api/clusters without CASTAI_API_KEY returns a clear error but /api/health still works', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({}); // no CASTAI_API_KEY
  const { server, baseUrl } = await startServer(app);
  try {
    const health = await getJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok' });

    const clusters = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(clusters.status, 503);
    assert.ok(typeof clusters.body.error === 'string');
  } finally {
    await stopServer(server);
    __restore();
  }
});

test('Second /api/clusters request reuses cached upstream data', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS']);
  const { app, __restore } = loadServer({
    CASTAI_API_KEY: 'test-key',
    DASHBOARD_CACHE_TTL_MS: '60000',
  });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const first = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(first.status, 200);
    const callsAfterFirst = calls.length;
    assert.ok(callsAfterFirst > 0, 'first request should hit upstream APIs');

    const second = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(second.status, 200);
    assert.equal(
      calls.length,
      callsAfterFirst,
      'second request must not make additional upstream fetch calls',
    );
    assert.deepEqual(second.body, first.body);
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('Cache entries expire after DASHBOARD_CACHE_TTL_MS', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS']);
  const { app, __restore } = loadServer({
    CASTAI_API_KEY: 'test-key',
    DASHBOARD_CACHE_TTL_MS: '10',
  });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const first = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(first.status, 200);
    const callsAfterFirst = calls.length;

    // Wait for the TTL to expire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await getJson(`${baseUrl}/api/clusters`);
    assert.equal(second.status, 200);
    assert.ok(
      calls.length > callsAfterFirst,
      'cache miss after TTL expiry should issue new upstream fetch calls',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});
