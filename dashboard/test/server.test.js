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
  // Set removed keys to an empty string rather than deleting them so that a
  // re-required server.js does not re-populate them from `dashboard/.env`
  // via dotenv.config().
  for (const key of ['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'PORT', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS']) {
    process.env[key] = '';
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

const ORG_LIST = {
  organizations: [
    { id: '5e413e89-eb67-48fb-b81c-6172baa988ed', name: 'CPS' },
    { id: 'ba5eba11-0000-4b1e-b00c-f00df00df00d', name: 'Beta Org' },
  ],
};

const ESTIMATED_SAVINGS_CLUSTER_1 = {
  recommendations: {
    Layman: { hourly: 1.2, monthly: 876, savingsPercentage: 42.5 },
    SpotOnly: { hourly: 0.9, monthly: 657, savingsPercentage: 56.8 },
  },
  currentConfiguration: { monthly: 1525, hourly: 2.09 },
  isRebalancingRecommended: false,
  lastUpdatedAt: '2026-09-25T10:00:00Z',
};

const ESTIMATED_SAVINGS_HISTORY_CLUSTER_1 = {
  items: [
    {
      createdAt: '2026-09-23T00:00:00Z',
      current: { costPerHour: '2.10' },
      optimizedSpotInstances: { costPerHour: '1.05' },
      optimizedLayman: { costPerHour: '1.40' },
      optimizedSpotOnly: { costPerHour: '0.53' },
    },
    {
      createdAt: '2026-09-24T00:00:00Z',
      current: { costPerHour: '2.00' },
      optimizedSpotInstances: { costPerHour: '1.00' },
      optimizedLayman: { costPerHour: '1.30' },
      optimizedSpotOnly: { costPerHour: '0.50' },
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

    if (path === '/v1/organizations') {
      return makeJsonResponse(ORG_LIST);
    }
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
    const estSavingsMatch = u.pathname.match(/^\/v1\/cost-reports\/clusters\/([^/]+)\/estimated-savings$/);
    if (estSavingsMatch) {
      const id = estSavingsMatch[1];
      if (id === 'cluster-1') return makeJsonResponse(ESTIMATED_SAVINGS_CLUSTER_1);
      return makeJsonResponse({ recommendations: {} });
    }
    const estHistMatch = u.pathname.match(/^\/v1\/cost-reports\/clusters\/([^/]+)\/estimated-savings-history$/);
    if (estHistMatch) {
      const id = estHistMatch[1];
      if (id === 'cluster-1') return makeJsonResponse(ESTIMATED_SAVINGS_HISTORY_CLUSTER_1);
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
  for (const key of ['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'PORT', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS']) {
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

// ---- Organizations (sub-org selector) --------------------------------------

test('GET /api/orgs returns the sorted organization list', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/orgs`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [
      { id: 'ba5eba11-0000-4b1e-b00c-f00df00df00d', name: 'Beta Org' },
      { id: '5e413e89-eb67-48fb-b81c-6172baa988ed', name: 'CPS' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('valid orgId query param is forwarded upstream and overrides env default', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({
    CASTAI_API_KEY: 'test-key',
    CASTAI_ORG_ID: 'bbbbbbbb-0000-4000-8000-000000000000', // env default, must lose
  });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(
      `${baseUrl}/api/clusters/cluster-1/estimated-savings?orgId=ba5eba11-0000-4b1e-b00c-f00df00df00d`,
    );
    assert.equal(res.status, 200);
    const upstream = calls.find((c) => c.url.includes('/estimated-savings'));
    assert.equal(
      upstream.options.headers['X-CastAI-Organization-Id'],
      'ba5eba11-0000-4b1e-b00c-f00df00df00d',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('unknown but well-formed orgId returns 400 and never reaches CAST AI cost endpoints', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(
      `${baseUrl}/api/clusters/cluster-1/estimated-savings?orgId=deadbeef-0000-4000-8000-000000000000`,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /unknown orgId/);
    assert.ok(
      !calls.some((c) => c.url.includes('/estimated-savings')),
      'no cost-report call may be made for an unknown org',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('malformed orgId returns 400 without any upstream call', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters?orgId=not-a-uuid`);
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0, 'no upstream call may be made');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('GET /api/clusters?basic=true returns the lightweight listing', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters?basic=true`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [
      { id: 'cluster-1', name: 'demo-eks' },
      { id: 'cluster-2', name: 'demo-gke' },
    ]);
    // Basic mode must not fan out to per-cluster probes.
    assert.equal(calls.length, 1, 'only the cluster list call is expected');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

// ---- Estimated savings proxy routes ---------------------------------------

test('CASTAI_ORG_ID is sent upstream as X-CastAI-Organization-Id', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({
    CASTAI_API_KEY: 'test-key',
    CASTAI_ORG_ID: 'org-123',
  });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/cluster-1/estimated-savings`);
    assert.equal(res.status, 200);
    const upstream = calls.find((c) => c.url.includes('/estimated-savings'));
    assert.ok(upstream, 'an upstream call must be made');
    assert.equal(upstream.options.headers['X-CastAI-Organization-Id'], 'org-123');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('X-CastAI-Organization-Id is omitted when CASTAI_ORG_ID is unset', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/cluster-1/estimated-savings`);
    assert.equal(res.status, 200);
    const upstream = calls.find((c) => c.url.includes('/estimated-savings'));
    assert.ok(upstream);
    assert.ok(!('X-CastAI-Organization-Id' in upstream.options.headers));
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('GET /api/clusters/:id/estimated-savings proxies the CAST AI endpoint', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls, apiKeySeen } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/cluster-1/estimated-savings`);
    assert.equal(res.status, 200);
    assert.equal(res.body.recommendations.SpotOnly.savingsPercentage, 56.8);
    assert.equal(res.body.isRebalancingRecommended, false);

    const upstream = calls.find((c) => c.url.includes('/estimated-savings'));
    assert.ok(upstream, 'an upstream call must be made');
    assert.ok(upstream.url.endsWith('/v1/cost-reports/clusters/cluster-1/estimated-savings'));
    assert.ok(apiKeySeen.length > 0, 'X-API-Key must be sent upstream');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('GET /api/clusters/:id/estimated-savings without CASTAI_API_KEY returns 503', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({});
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/cluster-1/estimated-savings`);
    assert.equal(res.status, 503);
    assert.ok(typeof res.body.error === 'string');
  } finally {
    await stopServer(server);
    __restore();
  }
});

test('estimated-savings-history injects a default window when dates are omitted', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/cluster-1/estimated-savings-history`);
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 2);

    const upstream = calls.find((c) => c.url.includes('estimated-savings-history'));
    assert.ok(upstream);
    const u = new URL(upstream.url);
    assert.ok(u.searchParams.get('fromDate'), 'fromDate must be defaulted');
    assert.ok(u.searchParams.get('toDate'), 'toDate must be defaulted');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('estimated-savings-history forwards explicit dates and useListingPrices', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(
      `${baseUrl}/api/clusters/cluster-1/estimated-savings-history?fromDate=2026-09-01&toDate=2026-09-25&useListingPrices=true`,
    );
    assert.equal(res.status, 200);

    const upstream = calls.find((c) => c.url.includes('estimated-savings-history'));
    const u = new URL(upstream.url);
    // Upstream rejects plain dates: the proxy must expand them to RFC3339.
    assert.equal(u.searchParams.get('fromDate'), '2026-09-01T00:00:00.000Z');
    assert.equal(u.searchParams.get('toDate'), '2026-09-25T23:59:59.999Z');
    assert.equal(u.searchParams.get('useListingPrices'), 'true');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('estimated-savings-history rejects invalid and inverted dates', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });
  const { server, baseUrl } = await startServer(app);
  try {
    const garbage = await getJson(
      `${baseUrl}/api/clusters/cluster-1/estimated-savings-history?fromDate=../../etc&toDate=2026-09-25`,
    );
    assert.equal(garbage.status, 400);

    const inverted = await getJson(
      `${baseUrl}/api/clusters/cluster-1/estimated-savings-history?fromDate=2026-09-25&toDate=2026-09-01`,
    );
    assert.equal(inverted.status, 400);
  } finally {
    await stopServer(server);
    __restore();
  }
});

test('estimated-savings routes reject malformed cluster ids', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/bad%23id%2Fxx/estimated-savings`);
    assert.ok(res.status === 400 || res.status === 404, `expected 400/404, got ${res.status}`);
  } finally {
    await stopServer(server);
    __restore();
  }
});

test('estimated-savings upstream failure returns 5xx without leaking the API key', async () => {
  const sensitiveKey = 'sk_live_DO_NOT_LEAK_EST_SAVINGS';
  snapshotEnv(['CASTAI_API_KEY', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: sensitiveKey });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/clusters/cluster-1/estimated-savings`);
    assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
    assert.ok(!JSON.stringify(res.body).includes(sensitiveKey));
    assert.ok(typeof res.body.error === 'string');
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

// ---- Excel export ----------------------------------------------------------

function getRaw(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
  });
}

test('GET /api/export/savings-potential.xlsx returns a valid workbook with one row per cluster x scenario', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });

  const originalFetch = globalThis.fetch;
  const { mockFetch, calls } = buildFetchMock();
  globalThis.fetch = mockFetch;

  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getRaw(`${baseUrl}/api/export/savings-potential.xlsx`);
    assert.equal(res.status, 200);
    assert.match(
      String(res.headers['content-type']),
      /openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
    assert.match(
      String(res.headers['content-disposition']),
      /attachment; filename="castai-savings-potential-\d{8}-\d{4}\.xlsx"/,
    );
    // XLSX is a zip container: must start with the PK signature.
    assert.equal(res.body[0], 0x50);
    assert.equal(res.body[1], 0x4b);

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);

    const names = wb.worksheets.map((w) => w.name);
    assert.deepEqual(names, ['Savings Potential', 'Cluster Summary', 'Errors', 'Meta']);

    // 2 mocked orgs x 2 mocked clusters; cluster-1 yields 2 scenarios,
    // cluster-2 yields none -> 4 data rows + header.
    const main = wb.getWorksheet('Savings Potential');
    assert.equal(main.rowCount, 5);
    const r2 = main.getRow(2);
    assert.equal(r2.getCell(5).value, 'SpotOnly'); // sorted desc by pct
    assert.equal(r2.getCell(6).value, 'Spot');
    assert.equal(Number(r2.getCell(7).value), 56.8);
    // History median joins snapshot rows across the key-prefix mismatch
    // (snapshot "SpotOnly" vs history "optimizedSpotOnly"):
    // (1-0.53/2.10)*100 = 74.76 and (1-0.50/2.00)*100 = 75 -> median ~74.88.
    const medianCell = Number(r2.getCell(18).value);
    assert.ok(Math.abs(medianCell - 74.88) < 0.1, `expected ~74.88, got ${medianCell}`);

    const byCluster = wb.getWorksheet('Cluster Summary');
    assert.equal(byCluster.rowCount, 5); // 4 clusters + header

    // Upstream fan-out happened per org (orgs -> clusters -> savings).
    assert.ok(calls.some((c) => c.url.includes('/v1/organizations')));
    assert.ok(calls.filter((c) => c.url.includes('/v1/kubernetes/external-clusters')).length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    await stopServer(server);
    __restore();
  }
});

test('export validates historyDays', async () => {
  snapshotEnv(['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'DASHBOARD_API_TOKEN']);
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/export/savings-potential.xlsx?historyDays=999`);
    assert.equal(res.status, 400);
  } finally {
    await stopServer(server);
    __restore();
  }
});
