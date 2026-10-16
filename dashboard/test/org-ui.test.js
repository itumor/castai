'use strict';

// UI tests for the Org & Users view (public/org.html + public/org.js).
//
// Strategy mirrors ui.test.js:
//   * Spin up a JSDOM instance from the real public/org.html.
//   * Mock window.fetch BEFORE evaluating public/org.js so the page code
//     never hits the network or a real CAST AI API.
//   * Eval org.js inside the jsdom window and assert on the rendered DOM:
//     KPI cards, SSO cards, usage cards, organizations/users/groups tables,
//     standalone section, and the error banner.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ORG_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'org.html'), 'utf8');
const ORG_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'org.js'), 'utf8');

function makeResponse({ ok = true, status = 200, body = null } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

// Minimal but structurally faithful /api/org-overview payload.
function sampleOverview() {
  return {
    generatedAt: '2026-10-16T06:00:00.000Z',
    buildDurationMs: 1234,
    enterprises: [
      {
        enterprise: {
          id: 'e-1',
          name: 'Siemens AG',
          createdAt: '2025-02-06T14:00:20.503866Z',
        },
        totals: {
          childOrganizations: 2,
          users: 2,
          userGroups: 1,
          roleBindings: 3,
          clusters: 4,
          ssoConnections: 1,
          ssoActive: 1,
          usersNeverLoggedIn: 1,
        },
        ssoConnections: [
          {
            id: 'sso-1',
            name: 'Siemens Entra ID',
            status: 'STATUS_ACTIVE',
            aad: { domain: 'siemens.com' },
            emailDomain: 'siemens.com',
            additionalEmailDomains: [],
            isSynced: true,
            createdAt: '2025-03-01T00:00:00Z',
          },
        ],
        platformUsage: {
          features: [
            { feature: 'node-autoscaler', displayName: 'Node Autoscaler', usage: 4898.53, unit: 'CPU' },
          ],
          subscriptions: [],
        },
        organizations: [
          {
            id: 'e-1',
            name: 'Siemens AG',
            kind: 'enterprise',
            createdAt: '2025-02-06T14:00:20.503866Z',
            users: 2,
            userGroups: 0,
            roleBindings: 1,
            clusters: 0,
            errors: [],
          },
          {
            id: 'c-1',
            name: 'IT IPS',
            kind: 'child',
            createdAt: '2025-09-24T00:00:00Z',
            users: 1,
            userGroups: 1,
            roleBindings: 2,
            clusters: 4,
            errors: [],
          },
          {
            id: 'c-2',
            name: 'Broken Org',
            kind: 'child',
            createdAt: '2025-09-25T00:00:00Z',
            users: null,
            userGroups: null,
            roleBindings: null,
            clusters: null,
            errors: ['users'],
          },
        ],
        users: [
          {
            id: 'u-1',
            name: 'Ada Lovelace',
            email: 'ada@siemens.com',
            auth: 'SSO',
            ssoProvider: 'Microsoft Entra ID',
            organizations: ['Siemens AG', 'IT IPS'],
            lastActivity: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            createdAt: '2025-02-10T00:00:00Z',
          },
          {
            id: 'u-2',
            name: 'Never Logged In',
            email: 'nl@siemens.com',
            auth: 'Email/password',
            ssoProvider: null,
            organizations: ['IT IPS'],
            lastActivity: null,
            createdAt: '2025-02-11T00:00:00Z',
          },
        ],
        userGroups: [
          {
            id: 'g-1',
            name: 'platform-admins',
            description: '',
            organizationId: 'c-1',
            organizationName: 'IT IPS',
            members: 2,
            createdAt: '2025-09-24T00:00:00Z',
          },
        ],
      },
    ],
    standaloneOrganizations: [
      {
        id: 's-1',
        name: 'Siemens-test',
        kind: 'standalone',
        createdAt: '2025-01-01T00:00:00Z',
        users: null,
        userGroups: null,
        roleBindings: null,
        clusters: null,
        errors: ['users', 'groups'],
      },
    ],
    errors: [{ org: 'Siemens-test', endpoint: 'users', status: 502 }],
  };
}

function setupDom(fetchImpl) {
  const dom = new JSDOM(ORG_HTML, {
    url: 'http://localhost/org.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (window.console) {
    window.console.warn = () => {};
    window.console.error = () => {};
  }
  window.fetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : () => Promise.reject(new Error('fetch not mocked'));
  window.eval(ORG_JS);
  return dom;
}

function flushAsync(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('org view renders KPIs, SSO, usage and all tables from the overview payload', async () => {
  const dom = setupDom(() => Promise.resolve(makeResponse({ body: sampleOverview() })));
  await flushAsync();
  const d = dom.window.document;

  // Root visible, loading hidden.
  assert.equal(d.getElementById('overview-root').hidden, false);
  assert.equal(d.getElementById('loading').hidden, true);

  // KPI cards carry the totals.
  const kpis = [...d.querySelectorAll('#kpi-grid .kpi-card')];
  const kpiText = kpis.map((c) => c.textContent).join('\n');
  assert.equal(kpis.length, 7);
  assert.match(kpiText, /Child organizations\s*2/);
  assert.match(kpiText, /Users \(unique\)\s*2/);
  assert.match(kpiText, /Clusters connected\s*4/);
  assert.match(kpiText, /1\/1 active/);

  // SSO card shows the connection with an ACTIVE badge.
  assert.match(d.getElementById('sso-cards').textContent, /Siemens Entra ID/);
  assert.match(d.getElementById('sso-cards').textContent, /ACTIVE/);

  // Platform usage card shows the feature with its unit.
  assert.match(d.getElementById('usage-cards').textContent, /Node Autoscaler/);
  assert.match(d.getElementById('usage-cards').textContent, /CPU/);

  // Organizations table: 3 rows, enterprise badge on the root row.
  const orgRows = d.querySelectorAll('#org-tbody tr');
  assert.equal(orgRows.length, 3);
  assert.match(orgRows[0].textContent, /Siemens AG/);
  assert.match(orgRows[0].textContent, /ENTERPRISE/);

  // Users table: deduplicated users with org tags and SSO badge.
  const userRows = d.querySelectorAll('#user-tbody tr');
  assert.equal(userRows.length, 2);
  assert.match(userRows[0].textContent, /ada@siemens\.com/);
  assert.match(userRows[0].textContent, /SSO/);
  assert.match(userRows[0].textContent, /IT IPS/);
  // User without activity shows "Never logged in".
  assert.match(userRows[1].textContent, /Never logged in/);

  // Groups table lists the group with its organization.
  assert.match(d.getElementById('group-tbody').textContent, /platform-admins/);
  assert.match(d.getElementById('group-tbody').textContent, /IT IPS/);

  // Standalone section is visible with the key-level org.
  assert.equal(d.getElementById('standalone-section').hidden, false);
  assert.match(d.getElementById('standalone-tbody').textContent, /Siemens-test/);

  // Partial failures surface in the issues section.
  assert.equal(d.getElementById('errors-section').hidden, false);
  assert.match(d.getElementById('errors-list').textContent, /Siemens-test — users \(status 502\)/);

  // Updated stamp includes build duration.
  assert.match(d.getElementById('last-updated').textContent, /built in 1\.2s/);

  dom.window.close();
});

test('org view shows a safe error banner when the API fails', async () => {
  const dom = setupDom(() => Promise.resolve(makeResponse({ ok: false, status: 502, body: { error: 'x' } })));
  await flushAsync();
  const d = dom.window.document;

  assert.equal(d.getElementById('error-banner').hidden, false);
  assert.match(d.getElementById('error-banner__message').textContent, /Failed to load organization overview: HTTP 502/);
  assert.equal(d.getElementById('overview-root').hidden, true);

  // Dismiss works.
  d.getElementById('error-banner__dismiss').click();
  assert.equal(d.getElementById('error-banner').hidden, true);

  dom.window.close();
});

test('org view shows the loading state while the fetch is pending', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dom = setupDom(() => gate.then(() => makeResponse({ body: sampleOverview() })));
  await flushAsync(10);

  const d = dom.window.document;
  assert.equal(d.getElementById('loading').hidden, false);
  assert.equal(d.getElementById('overview-root').hidden, true);

  release();
  await flushAsync();
  assert.equal(d.getElementById('loading').hidden, true);
  assert.equal(d.getElementById('overview-root').hidden, false);

  dom.window.close();
});

test('org filter narrows the organizations table', async () => {
  const dom = setupDom(() => Promise.resolve(makeResponse({ body: sampleOverview() })));
  await flushAsync();
  const d = dom.window.document;

  const filter = d.getElementById('org-filter');
  filter.value = 'broken';
  filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await flushAsync(10);

  const rows = d.querySelectorAll('#org-tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Broken Org/);
  // Null counts render as an em dash, never "null" or "undefined".
  assert.match(rows[0].textContent, /—/);

  dom.window.close();
});
