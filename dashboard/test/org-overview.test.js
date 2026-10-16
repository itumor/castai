'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Same loading patterns as test/server.test.js: fresh module per test, empty
// env strings (not deletes) so dotenv does not repopulate from dashboard/.env.
function loadServer(env) {
  const prevEnv = { ...process.env };
  for (const key of ['CASTAI_API_KEY', 'CASTAI_REGION', 'CASTAI_ORG_ID', 'PORT', 'DASHBOARD_API_TOKEN', 'DASHBOARD_CACHE_TTL_MS', 'DASHBOARD_ORG_CACHE_TTL_MS']) {
    process.env[key] = '';
  }
  Object.assign(process.env, env);
  const modPath = require.resolve('../server.js');
  delete require.cache[modPath];
  const mod = require('../server.js');
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

async function getJson(url, headers = {}) {
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

function makeJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

// --- Fixture: one enterprise with two child orgs + one standalone org -------

const ENT = '11111111-1111-1111-1111-111111111111';
const CHILD_A = '22222222-2222-2222-2222-222222222222';
const CHILD_B = '33333333-3333-3333-3333-333333333333';
const SOLO = '44444444-4444-4444-4444-444444444444';

const ORGS = {
  organizations: [
    { id: ENT, name: 'Siemens AG', createdAt: '2024-01-01T00:00:00Z', type: 'ORGANIZATION_TYPE_ENTERPRISE' },
    { id: CHILD_A, name: 'SI GSW CLO', createdAt: '2025-02-05T00:00:00Z', parentId: ENT, type: 'ORGANIZATION_TYPE_CHILD' },
    { id: CHILD_B, name: 'IT IPS', createdAt: '2025-09-24T00:00:00Z', parentId: ENT, type: 'ORGANIZATION_TYPE_CHILD' },
    { id: SOLO, name: 'Siemens-test', createdAt: '2026-08-19T00:00:00Z', type: 'ORGANIZATION_TYPE_DEFAULT' },
  ],
};

const USERS_A = {
  users: [
    {
      user: { id: 'u1', name: 'Alice', email: 'alice@siemens.com', authProvider: 'waad' },
      createdAt: '2025-03-01T00:00:00Z',
      loginAt: '2026-10-10T09:00:00Z',
      groups: [],
    },
    {
      user: { id: 'u2', name: 'Bob', email: 'bob@siemens.com', authProvider: 'auth0' },
      createdAt: '2025-04-01T00:00:00Z',
      loginAt: null,
      groups: [],
    },
  ],
};

// Alice also belongs to CHILD_B with an older login; SSO provider must win.
const USERS_B = {
  users: [
    {
      user: { id: 'u1', name: 'Alice', email: 'alice@siemens.com', authProvider: 'auth0' },
      createdAt: '2025-03-01T00:00:00Z',
      loginAt: '2026-09-01T09:00:00Z',
      groups: [],
    },
  ],
};

const USERS_ENT = { users: [] };

const GROUPS_A = {
  groups: [
    {
      id: 'g1',
      organizationId: CHILD_A,
      name: 'CLO Member',
      description: '',
      createdAt: '2026-09-09T00:00:00Z',
      definition: { members: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] },
    },
  ],
};

const ROLE_BINDINGS_A = { roleBindings: [{ id: 'rb1' }, { id: 'rb2' }, { id: 'rb3' }] };
const ROLE_BINDINGS_ENT = { roleBindings: [{ id: 'rb-ent' }] };

const CLUSTERS_A = { items: [{ id: 'c1' }, { id: 'c2' }] };

const SSO = {
  connections: [
    {
      id: 'sso1',
      name: 'SiemensAGEntra',
      status: 'STATUS_ACTIVE',
      emailDomain: 'siemens.com',
      additionalEmailDomains: ['evosoft.com'],
      isSynced: false,
      createdAt: '2025-07-15T00:00:00Z',
      aad: {
        adDomain: 'siemens.onmicrosoft.com',
        clientId: 'public-client-id',
        clientSecret: 'SUPER-SECRET-MUST-NEVER-REACH-BROWSER',
      },
    },
  ],
};

const USAGE = {
  subscriptions: [],
  features: [
    { feature: 'phase2', displayName: 'Node Autoscaler', usage: 4884.8, unit: 'CPU' },
    { feature: 'woop', displayName: 'Workload Autoscaler', usage: 5000.7, unit: 'CPU' },
  ],
};

// Routes the stubbed fetches; CHILD_B fails on groups + clusters to prove the
// overview still builds with partial data.
function mockCastAiFetch(url, options = {}) {
  const path = url.replace(/^https:\/\/[^/]+/, '');
  const orgHeader = options.headers && options.headers['X-CastAI-Organization-Id'];

  if (path === '/v1/organizations') return makeJsonResponse(ORGS);
  if (path === `/v1/organizations/${ENT}/users`) return makeJsonResponse(USERS_ENT);
  if (path === `/v1/organizations/${CHILD_A}/users`) return makeJsonResponse(USERS_A);
  if (path === `/v1/organizations/${CHILD_B}/users`) return makeJsonResponse(USERS_B);
  if (path === `/v1/organizations/${SOLO}/users`) return makeJsonResponse({ users: [] });
  if (path === `/v1/organizations/${CHILD_A}/groups`) return makeJsonResponse(GROUPS_A);
  if (path === `/v1/organizations/${CHILD_B}/groups`) return makeJsonResponse({ message: 'denied' }, { ok: false, status: 404 });
  if (path === `/v1/organizations/${ENT}/groups`) return makeJsonResponse({ groups: [] });
  if (path === `/v1/organizations/${SOLO}/groups`) return makeJsonResponse({ groups: [] });
  if (path === `/v1/organizations/${ENT}/role-bindings`) return makeJsonResponse(ROLE_BINDINGS_ENT);
  if (path === `/v1/organizations/${CHILD_A}/role-bindings`) return makeJsonResponse(ROLE_BINDINGS_A);
  if (path === `/v1/organizations/${CHILD_B}/role-bindings`) return makeJsonResponse({ roleBindings: [] });
  if (path === `/v1/organizations/${SOLO}/role-bindings`) return makeJsonResponse({ roleBindings: [] });
  if (path === '/v1/kubernetes/external-clusters' && orgHeader === CHILD_A) return makeJsonResponse(CLUSTERS_A);
  if (path === '/v1/kubernetes/external-clusters' && orgHeader === CHILD_B) return makeJsonResponse({ message: 'denied' }, { ok: false, status: 404 });
  if (path === '/v1/kubernetes/external-clusters') return makeJsonResponse({ items: [] });
  if (path === '/v1/sso-connections') return makeJsonResponse(SSO);
  if (path === '/v1/billing/enterprise/platform-usage-report') return makeJsonResponse(USAGE);
  return makeJsonResponse({ message: 'not found' }, { ok: false, status: 404 });
}

function mockFetch() {
  globalThis.fetch = async (url, options) => mockCastAiFetch(url, options);
}

// --- Tests --------------------------------------------------------------------

test('org-overview returns 503 when CASTAI_API_KEY is missing', async () => {
  const { app, __restore } = loadServer({ CASTAI_API_KEY: '' });
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/org-overview`);
    assert.equal(res.status, 503);
    assert.match(res.body.error, /CASTAI_API_KEY/);
    // The page is still served even when the API is unconfigured.
    const page = await getJson(`${baseUrl}/org.html`);
    assert.equal(page.status, 200);
    assert.match(page.raw, /Org Structure/);
  } finally {
    await stopServer(server);
    __restore();
  }
});

test('org-overview aggregates enterprise, children, users, groups, sso, usage', async () => {
  const originalFetch = globalThis.fetch;
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key' });
  mockFetch();
  const { server, baseUrl } = await startServer(app);
  try {
    const res = await getJson(`${baseUrl}/api/org-overview`);
    assert.equal(res.status, 200);
    const body = res.body;

    assert.ok(body.generatedAt);
    assert.equal(body.enterprises.length, 1);
    const ent = body.enterprises[0];
    assert.equal(ent.enterprise.name, 'Siemens AG');

    // Organizations table: enterprise row first, then children alphabetically.
    assert.equal(ent.organizations.length, 3);
    assert.deepEqual(ent.organizations.map((o) => o.kind), ['enterprise', 'child', 'child']);
    assert.equal(ent.organizations[0].id, ENT);
    assert.equal(ent.organizations[0].roleBindings, 1);
    const childA = ent.organizations.find((o) => o.id === CHILD_A);
    assert.equal(childA.users, 2);
    assert.equal(childA.userGroups, 1);
    assert.equal(childA.roleBindings, 3);
    assert.equal(childA.clusters, 2);
    const childB = ent.organizations.find((o) => o.id === CHILD_B);
    // Failed probes leave counts null and record the endpoint in errors.
    assert.equal(childB.userGroups, null);
    assert.equal(childB.clusters, null);
    assert.deepEqual(childB.errors.sort(), ['clusters', 'groups']);

    // Totals (nulls contribute nothing).
    assert.equal(ent.totals.childOrganizations, 2);
    assert.equal(ent.totals.users, 2); // alice + bob, deduplicated
    assert.equal(ent.totals.userGroups, 1);
    assert.equal(ent.totals.roleBindings, 4);
    assert.equal(ent.totals.clusters, 2);
    assert.equal(ent.totals.ssoConnections, 1);
    assert.equal(ent.totals.ssoActive, 1);
    assert.equal(ent.totals.usersNeverLoggedIn, 1); // bob

    // Users table: dedupe, org tags, max loginAt, SSO classification wins.
    const alice = ent.users.find((u) => u.id === 'u1');
    assert.equal(alice.auth, 'SSO');
    assert.equal(alice.ssoProvider, 'Microsoft Entra ID');
    assert.deepEqual(alice.organizations.sort(), ['IT IPS', 'SI GSW CLO']);
    assert.equal(alice.lastActivity, '2026-10-10T09:00:00Z');
    const bob = ent.users.find((u) => u.id === 'u2');
    assert.equal(bob.auth, 'Email/password');
    assert.equal(bob.lastActivity, null);

    // User groups include member counts and org attribution.
    assert.equal(ent.userGroups.length, 1);
    assert.equal(ent.userGroups[0].members, 3);
    assert.equal(ent.userGroups[0].organizationName, 'SI GSW CLO');

    // SSO: shape kept, secrets stripped.
    assert.equal(ent.ssoConnections.length, 1);
    assert.equal(ent.ssoConnections[0].name, 'SiemensAGEntra');
    assert.equal(ent.ssoConnections[0].aad.adDomain, 'siemens.onmicrosoft.com');

    // Platform usage forwarded.
    assert.equal(ent.platformUsage.features.length, 2);
    assert.equal(ent.platformUsage.features[0].displayName, 'Node Autoscaler');

    // Standalone orgs are reported separately.
    assert.equal(body.standaloneOrganizations.length, 1);
    assert.equal(body.standaloneOrganizations[0].name, 'Siemens-test');

    // Partial failures are surfaced, not hidden.
    assert.ok(body.errors.some((e) => e.org === 'IT IPS' && e.endpoint === 'groups'));

    // Nothing secret anywhere in the response body.
    assert.doesNotMatch(res.raw, /SUPER-SECRET/i);
    assert.doesNotMatch(res.raw, /clientSecret/i);
  } finally {
    await stopServer(server);
    globalThis.fetch = originalFetch;
    __restore();
  }
});

test('org-overview caches the payload and refresh=1 bypasses the cache', async () => {
  const originalFetch = globalThis.fetch;
  const server_mod = loadServer({ CASTAI_API_KEY: 'test-key' });
  const { app, __restore } = server_mod;
  mockFetch();
  const { server, baseUrl } = await startServer(app);
  try {
    const first = await getJson(`${baseUrl}/api/org-overview`);
    assert.equal(first.status, 200);
    assert.equal(server_mod.getOrgOverviewBuildCount(), 1);
    const second = await getJson(`${baseUrl}/api/org-overview`);
    assert.equal(second.status, 200);
    assert.equal(server_mod.getOrgOverviewBuildCount(), 1, 'second request must be served from cache');
    assert.equal(second.body.generatedAt, first.body.generatedAt);

    const third = await getJson(`${baseUrl}/api/org-overview?refresh=1`);
    assert.equal(third.status, 200);
    assert.equal(server_mod.getOrgOverviewBuildCount(), 2, 'refresh must rebuild the payload');
    assert.notEqual(third.body.generatedAt, first.body.generatedAt);
  } finally {
    await stopServer(server);
    globalThis.fetch = originalFetch;
    __restore();
  }
});

test('org-overview honors the optional bearer token', async () => {
  const { app, __restore } = loadServer({ CASTAI_API_KEY: 'test-key', DASHBOARD_API_TOKEN: 'secret-token' });
  const { server, baseUrl } = await startServer(app);
  try {
    const denied = await getJson(`${baseUrl}/api/org-overview`);
    assert.equal(denied.status, 401);
  } finally {
    await stopServer(server);
    __restore();
  }
});
