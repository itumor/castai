'use strict';

// UI tests for the Savings Explorer page (public/savings.html + savings.js).
// Same strategy as ui.test.js: real HTML in jsdom, fetch mocked before the
// script is evaluated, assertions on the resulting DOM. No network, no keys.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SAVINGS_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'savings.html'), 'utf8');
const SAVINGS_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'savings.js'), 'utf8');

function makeResponse({ ok = true, status = 200, body = null } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const CPS_ORG_ID = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const BETA_ORG_ID = 'ba5eba11-0000-4b1e-b00c-f00df00df00d';

const ORGS = [
  { id: CPS_ORG_ID, name: 'CPS' },
  { id: BETA_ORG_ID, name: 'Beta Org' },
];

const CLUSTERS = [
  { id: 'c-1', name: 'read-only-demo' },
];

// Shape mirrors the live API (verified 2026-09-27 against a real cluster):
// monthly/hourly are {priceBefore, priceAfter} string pairs, savingsPercentage
// is a percent string, details holds configurationAfter.nodes.
const SNAPSHOT = {
  recommendations: {
    Layman: {
      monthly: { priceBefore: '1525.00', priceAfter: '876.00' },
      hourly: { priceBefore: '2.089', priceAfter: '1.20' },
      savingsPercentage: '42.5',
      details: {
        configurationAfter: {
          nodes: [
            { instanceType: 'm6a.8xlarge', spot: false },
            { instanceType: 'm6a.4xlarge', spot: true },
          ],
        },
      },
    },
    SpotOnly: {
      monthly: { priceBefore: '1525.00', priceAfter: '657.00' },
      hourly: { priceBefore: '2.089', priceAfter: '0.90' },
      savingsPercentage: '56.8',
      details: { configurationAfter: { nodes: [{ instanceType: 'm6a.4xlarge', spot: true }] } },
    },
  },
  currentConfiguration: { totalPrice: { hourly: '2.089', monthly: '1525.00' }, nodes: [], workloads: [] },
  isRebalancingRecommended: false,
  lastUpdatedAt: '2026-09-25T10:00:00Z',
};

const HISTORY = {
  items: [
    {
      createdAt: '2026-09-23T00:00:00Z',
      current: { costPerHour: '2.10' },
      optimizedSpotInstances: { costPerHour: '1.05' },
      optimizedLayman: { costPerHour: '1.40' },
    },
    {
      createdAt: '2026-09-24T00:00:00Z',
      current: { costPerHour: '2.00' },
      optimizedSpotInstances: { costPerHour: '1.00' },
      optimizedLayman: { costPerHour: '1.30' },
    },
  ],
};

function defaultFetch(url) {
  const u = String(url);
  defaultFetch.calls.push(u);
  if (u.includes('estimated-savings-history')) return Promise.resolve(makeResponse({ body: HISTORY }));
  if (u.includes('estimated-savings')) return Promise.resolve(makeResponse({ body: SNAPSHOT }));
  if (u.includes('/api/orgs')) return Promise.resolve(makeResponse({ body: ORGS }));
  if (u.includes('/api/clusters')) return Promise.resolve(makeResponse({ body: CLUSTERS }));
  return Promise.resolve(makeResponse({ ok: false, status: 404, body: { error: 'not found' } }));
}
defaultFetch.calls = [];

function setupDom(fetchImpl) {
  const dom = new JSDOM(SAVINGS_HTML, {
    url: 'http://localhost/savings.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (window.console) {
    window.console.warn = () => {};
    window.console.error = () => {};
  }
  // savings.js uses location.hash when selecting a cluster; jsdom supports it.
  window.fetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : () => Promise.reject(new Error('fetch not mocked'));
  window.eval(SAVINGS_JS);
  return dom;
}

function flushAsync(ms = 60) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('renders scenario cards from estimated-savings and excludes Spot by default', async () => {
  defaultFetch.calls.length = 0;
  const dom = setupDom(defaultFetch);
  const { document } = dom.window;

  await flushAsync();

  // Org dropdown populated, defaulting to CPS via DEFAULT_ORG_ID preference.
  const orgSelect = document.getElementById('org-select');
  assert.equal(orgSelect.options.length, 2);
  assert.equal(orgSelect.value, CPS_ORG_ID);

  // The selected org must travel with cluster-scoped fetches.
  assert.ok(
    defaultFetch.calls.some((u) => u.includes('/api/clusters?') && u.includes(`orgId=${CPS_ORG_ID}`)),
    'cluster listing must carry the selected orgId',
  );
  assert.ok(
    defaultFetch.calls.some((u) => u.includes('estimated-savings') && u.includes(`orgId=${CPS_ORG_ID}`)),
    'savings fetch must carry the selected orgId',
  );

  const cards = document.querySelectorAll('.scenario-card');
  assert.equal(cards.length, 2, 'two recommendation scenarios -> two cards');

  // Sorted by savingsPercentage desc -> SpotOnly first.
  const first = cards[0];
  assert.match(first.querySelector('.scenario-card__name').textContent, /Spotonly|Spot Only/);
  assert.equal(first.querySelector('.scenario-card__pct').textContent, '56.8%');

  // Spot toggle is off by default: the spot card is excluded and cannot win the forecast.
  assert.ok(first.classList.contains('scenario-card--excluded'));
  assert.match(first.textContent, /Excluded by constraints/);

  // Layman card shows the reduced configuration summary.
  const layman = document.querySelector('.scenario-card[data-scenario-key="Layman"]');
  assert.match(layman.querySelector('.scenario-card__details').textContent, /2 nodes/);
  assert.match(layman.querySelector('.scenario-card__details').textContent, /m6a\.8xlarge/);
  assert.match(layman.querySelector('.scenario-card__details').textContent, /1 on spot/);

  // Forecast falls back to the rightsizing scenario.
  assert.equal(document.getElementById('stat-forecast-pct').textContent, '42.5%');
  assert.match(document.getElementById('stat-forecast-scenario').textContent, /Layman/);

  // Delta vs the flat 40% assumption.
  assert.equal(document.getElementById('stat-delta').textContent, '+2.5 pts');

  // Current monthly cost from currentConfiguration.
  assert.equal(document.getElementById('stat-current').textContent, '$1,525');

  dom.window.close();
});

test('enabling the Spot toggle switches the forecast to the Spot scenario', async () => {
  const dom = setupDom(defaultFetch);
  const { document } = dom.window;
  await flushAsync();

  const toggle = document.getElementById('spot-toggle');
  toggle.checked = true;
  toggle.dispatchEvent(new dom.window.Event('change'));
  await flushAsync();

  assert.equal(document.getElementById('stat-forecast-pct').textContent, '56.8%');
  const spotCard = document.querySelector('.scenario-card[data-scenario-key="SpotOnly"]');
  assert.ok(spotCard.classList.contains('scenario-card--forecast'));
  assert.ok(!spotCard.classList.contains('scenario-card--excluded'));

  dom.window.close();
});

test('renders history chart svg, legend, and median table', async () => {
  const dom = setupDom(defaultFetch);
  const { document } = dom.window;
  await flushAsync();

  const svg = document.querySelector('#history-chart svg');
  assert.ok(svg, 'an svg chart must be rendered');
  const lines = svg.querySelectorAll('path.history-chart__line');
  assert.ok(lines.length >= 3, 'current + two scenario lines');

  const legendItems = document.querySelectorAll('.history-legend__item');
  assert.equal(legendItems.length, 3);

  const rows = document.querySelectorAll('#median-body tr');
  assert.equal(rows.length, 2, 'one median row per scenario');

  const rowText = (k) => Array.from(rows).map((r) => r.textContent).join(' ');
  assert.match(rowText(), /50\.0%/);   // SpotInstances: 50% on both days
  assert.match(rowText(), /34\.2%/);   // Layman: median of 33.3% and 35%

  dom.window.close();
});

test('switching the organization refetches clusters and savings with the new orgId', async () => {
  defaultFetch.calls.length = 0;
  const dom = setupDom(defaultFetch);
  const { document } = dom.window;
  await flushAsync();

  defaultFetch.calls.length = 0;
  const orgSelect = document.getElementById('org-select');
  orgSelect.value = BETA_ORG_ID;
  orgSelect.dispatchEvent(new dom.window.Event('change'));
  await flushAsync();

  assert.ok(
    defaultFetch.calls.some((u) => u.includes('/api/clusters?') && u.includes(`orgId=${BETA_ORG_ID}`)),
    'cluster refetch must use the new org',
  );
  assert.ok(
    defaultFetch.calls.some((u) => u.includes('estimated-savings') && u.includes(`orgId=${BETA_ORG_ID}`)),
    'savings refetch must use the new org',
  );
  assert.match(dom.window.location.hash, /org=ba5eba11/);

  dom.window.close();
});

test('shows a friendly error banner when both savings endpoints fail', async () => {
  const failing = (url) => {
    const u = String(url);
    if (u.includes('/api/orgs')) return Promise.resolve(makeResponse({ body: ORGS }));
    if (u.includes('/api/clusters') && !u.includes('estimated-savings')) {
      return Promise.resolve(makeResponse({ body: CLUSTERS }));
    }
    return Promise.resolve(makeResponse({ ok: false, status: 404, body: { error: 'not found' } }));
  };
  const dom = setupDom(failing);
  const { document } = dom.window;
  await flushAsync();

  const banner = document.getElementById('error-banner');
  assert.ok(!banner.hidden, 'error banner must be visible');
  assert.match(
    document.getElementById('error-banner__message').textContent,
    /not found/i,
  );

  dom.window.close();
});
