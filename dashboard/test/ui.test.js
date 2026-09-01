'use strict';

// UI tests for the Siemens CAST AI Dashboard.
//
// Strategy:
//   * Spin up a JSDOM instance from the real public/index.html.
//   * Mock window.fetch BEFORE evaluating public/app.js so the dashboard
//     code never hits the network or a real CAST AI API.
//   * Eval app.js inside the jsdom window so it runs against the mocked
//     document/fetch and produces the same DOM it would in a browser.
//   * Assert on the resulting DOM (visibility flags, card content, error
//     banner text).
//
// No real server, real network, or real API key is required.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

function makeResponse({ ok = true, status = 200, body = null } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

// Build a fresh jsdom + execute app.js with a controllable fetch implementation.
// `fetchImpl` is invoked as fetch(url, opts) and must return a Promise<response>.
// Pass a `pending` fetchImpl to keep the dashboard in its loading state.
function setupDom(fetchImpl) {
  const dom = new JSDOM(INDEX_HTML, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Suppress noisy CSS / resource load warnings that jsdom would otherwise
  // emit to its virtual console (does not affect test behaviour).
  if (window.console) {
    window.console.warn = () => {};
    window.console.error = () => {};
  }

  // Mock fetch BEFORE app.js runs. app.js calls fetch(/api/clusters) on init.
  window.fetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : () => Promise.reject(new Error('fetch not mocked'));

  // Execute app.js inside the jsdom window so its `document`/`fetch` references
  // resolve against the mocked environment.
  window.eval(APP_JS);

  return dom;
}

// Allow microtasks (fetch -> json -> render) to drain.
function flushAsync(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Convenience: extract a card by data-cluster-id.
function getCard(document, id) {
  return document.querySelector(`article.card[data-cluster-id="${id}"]`);
}

// Sample cluster used across the success tests.
function sampleClusters() {
  return [
    {
      id: 'cls-prod-east',
      name: 'production-east',
      status: 'ready',
      providerType: 'aws',
      region: 'us-east-1',
      agentStatus: 'connected',
      nodeCount: 12,
      resources: {
        cpuRequested: 48,
        cpuUsed: 22.5,
        cpuUtilization: 0.47,
        memoryRequested: 96,
        memoryUsed: 60,
        memoryUtilization: 0.625,
      },
      savings: {
        currentMonthlyCost: 12000,
        optimizedMonthlyCost: 8400,
        monthlySavings: 3600,
        savingsPercentage: 0.30,
      },
      workloadOptimizationOpportunities: 4,
    },
    {
      id: 'cls-stage-eu',
      name: 'staging-eu',
      status: 'degraded',
      providerType: 'gcp',
      region: 'europe-west1',
      agentStatus: 'warning',
      nodeCount: 5,
      resources: {
        cpuRequested: 16,
        cpuUsed: 9,
        cpuUtilization: 0.56,
        memoryRequested: 32,
        memoryUsed: 28,
        memoryUtilization: 0.875,
      },
      savings: {
        currentMonthlyCost: 4200,
        optimizedMonthlyCost: 3000,
        monthlySavings: 1200,
        savingsPercentage: 0.286,
      },
      workloadOptimizationOpportunities: 1,
    },
  ];
}

// --- Tests -----------------------------------------------------------------

test('loading indicator is visible while fetch is pending', async () => {
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const fetchImpl = () => pending;

  const dom = setupDom(fetchImpl);
  try {
    const { document } = dom.window;

    // DOMContentLoaded in jsdom fires asynchronously, so let init() run and
    // kick off loadClusters(). showLoading() executes synchronously before
    // the first await, so the indicator must be visible while fetch is
    // pending.
    await flushAsync();

    const loading = document.getElementById('loading');
    assert.ok(loading, 'loading element should exist');
    assert.equal(loading.hidden, false, 'loading indicator should be visible while fetch is pending');

    const errorBanner = document.getElementById('error-banner');
    assert.equal(errorBanner.hidden, true, 'error banner should be hidden during loading');

    const emptyState = document.getElementById('empty-state');
    assert.equal(emptyState.hidden, true, 'empty state should be hidden during loading');

    const clusters = document.getElementById('clusters');
    assert.equal(clusters.getAttribute('aria-busy'), 'true', 'clusters region marked busy during loading');
  } finally {
    // Resolve the pending fetch so any dangling promise chain can settle,
    // then close the jsdom window.
    resolveFetch(makeResponse({ ok: true, status: 200, body: [] }));
    await flushAsync();
    dom.window.close();
  }
});

test('successful render shows cluster cards with all expected fields', async () => {
  const clusters = sampleClusters();
  const fetchImpl = () => Promise.resolve(
    makeResponse({ ok: true, status: 200, body: clusters })
  );

  const dom = setupDom(fetchImpl);
  try {
    await flushAsync();
    const { document } = dom.window;

    // Loading should be gone.
    assert.equal(document.getElementById('loading').hidden, true, 'loading hidden after success');
    assert.equal(document.getElementById('error-banner').hidden, true, 'error banner hidden on success');
    assert.equal(document.getElementById('empty-state').hidden, true, 'empty state hidden when clusters present');

    const cards = document.querySelectorAll('article.card');
    assert.equal(cards.length, clusters.length, 'renders one card per cluster');

    // --- Card 1 ---
    const card1 = getCard(document, 'cls-prod-east');
    assert.ok(card1, 'first cluster card present');
    const text1 = card1.textContent;

    assert.ok(text1.includes('production-east'), 'card 1 shows cluster name');
    assert.ok(text1.includes('Ready'), 'card 1 shows status text (Ready)');

    // Agent status
    assert.ok(text1.includes('Connected'), 'card 1 shows agent status (Connected)');

    // Provider and region
    assert.ok(text1.includes('aws'), 'card 1 shows provider (aws)');
    assert.ok(text1.includes('us-east-1'), 'card 1 shows region (us-east-1)');

    // Node count
    assert.ok(text1.includes('12'), 'card 1 shows node count');

    // CPU: requested 48, used 22.5, util 0.47 -> 47.0%
    assert.ok(text1.includes('48'), 'card 1 shows CPU requested');
    assert.ok(text1.includes('22.5'), 'card 1 shows CPU used');
    assert.ok(/47(\.0)?%/.test(text1), 'card 1 shows CPU utilization percent');

    // Memory: requested 96, used 60, util 0.625 -> 62.5%
    assert.ok(text1.includes('96'), 'card 1 shows memory requested');
    assert.ok(text1.includes('60'), 'card 1 shows memory used');
    assert.ok(/62(\.5)?%/.test(text1), 'card 1 shows memory utilization percent');

    // Savings: 12000 / 8400 / 3600 / 30.0%
    assert.ok(text1.includes('$12,000') || text1.includes('12,000'), 'card 1 shows current monthly cost');
    assert.ok(text1.includes('$8,400') || text1.includes('8,400'), 'card 1 shows optimized monthly cost');
    assert.ok(text1.includes('$3,600') || text1.includes('3,600'), 'card 1 shows monthly savings');
    assert.ok(/30(\.0)?%/.test(text1), 'card 1 shows savings percentage');

    // Opportunities count
    assert.ok(text1.includes('4'), 'card 1 shows workload optimization opportunity count');

    // --- Card 2 ---
    const card2 = getCard(document, 'cls-stage-eu');
    assert.ok(card2, 'second cluster card present');
    const text2 = card2.textContent;
    assert.ok(text2.includes('staging-eu'), 'card 2 shows cluster name');
    assert.ok(text2.includes('Warning'), 'card 2 shows degraded status as Warning');
    assert.ok(text2.includes('gcp'), 'card 2 shows provider (gcp)');
    assert.ok(text2.includes('europe-west1'), 'card 2 shows region (europe-west1)');
    assert.ok(text2.includes('Degraded') || text2.includes('Warning'), 'card 2 shows agent warning');
    assert.ok(text2.includes('1'), 'card 2 shows opportunities count of 1');
    const oppSection2 = card2.querySelector('.card__section--opps');
    const oppLabel2 = oppSection2.querySelector('.opps__label').textContent;
    assert.equal(oppLabel2, 'opportunity',
      'card 2 uses singular "opportunity" when count is 1');
  } finally {
    dom.window.close();
  }
});

test('error banner appears with a safe message when /api/clusters fails', async () => {
  const fetchImpl = () => Promise.resolve(
    makeResponse({ ok: false, status: 500, body: { error: 'kaboom', apiKey: 'leaked-secret' } })
  );

  const dom = setupDom(fetchImpl);
  try {
    await flushAsync();
    const { document } = dom.window;

    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-banner__message');

    assert.equal(errorBanner.hidden, false, 'error banner should be visible on error');
    assert.ok(errorMessage, 'error message element exists');
    assert.ok(errorMessage.textContent.length > 0, 'error message populated');
    // No raw server payload / secret should ever reach the user.
    assert.ok(!errorMessage.textContent.includes('leaked-secret'),
      'error message does not leak raw response body');
    assert.ok(!errorMessage.textContent.includes('kaboom'),
      'error message does not echo internal error string');
    // A friendly, deterministic fallback message for 5xx.
    assert.ok(/temporarily unavailable|try again/i.test(errorMessage.textContent),
      'error message is a safe, user-friendly string');

    // Loading should be cleared and no cards rendered.
    assert.equal(document.getElementById('loading').hidden, true, 'loading hidden on error');
    assert.equal(document.querySelectorAll('article.card').length, 0,
      'no cluster cards rendered on error');
  } finally {
    dom.window.close();
  }
});

test('empty state is shown (not error banner) when /api/clusters returns []', async () => {
  const fetchImpl = () => Promise.resolve(
    makeResponse({ ok: true, status: 200, body: [] })
  );

  const dom = setupDom(fetchImpl);
  try {
    await flushAsync();
    const { document } = dom.window;

    const emptyState = document.getElementById('empty-state');
    const errorBanner = document.getElementById('error-banner');
    const loading = document.getElementById('loading');

    assert.ok(emptyState, 'empty-state element exists');
    assert.equal(emptyState.hidden, false, 'empty state visible when API returns []');
    assert.ok(/no clusters/i.test(emptyState.textContent),
      'empty state contains a no-clusters message');

    assert.equal(errorBanner.hidden, true, 'error banner hidden for empty (non-error) state');
    assert.equal(loading.hidden, true, 'loading hidden after success');
    assert.equal(document.querySelectorAll('article.card').length, 0,
      'no cluster cards rendered for empty array');
  } finally {
    dom.window.close();
  }
});

test('refresh button click re-fetches and re-renders cluster data', async () => {
  const initialClusters = [sampleClusters()[0]];
  const refreshedClusters = sampleClusters();
  let fetchCount = 0;

  const fetchImpl = () => {
    fetchCount += 1;
    const body = fetchCount === 1 ? initialClusters : refreshedClusters;
    return Promise.resolve(makeResponse({ ok: true, status: 200, body }));
  };

  const dom = setupDom(fetchImpl);
  try {
    await flushAsync();
    const { document } = dom.window;

    // After initial load, only the first cluster should be rendered.
    assert.equal(document.querySelectorAll('article.card').length, 1,
      'initial render shows one cluster card');
    assert.ok(getCard(document, 'cls-prod-east'), 'initial card is production-east');

    // Click the refresh button.
    const refreshBtn = document.getElementById('refresh-btn');
    assert.ok(refreshBtn, 'refresh button exists');
    refreshBtn.click();

    // Wait for the second fetch/render cycle.
    await flushAsync();

    assert.equal(fetchCount, 2, 'refresh click triggered a second fetch');
    assert.equal(document.querySelectorAll('article.card').length, 2,
      'refresh render shows both cluster cards');
    assert.ok(getCard(document, 'cls-stage-eu'), 'refreshed render includes staging-eu');
  } finally {
    dom.window.close();
  }
});

test('error banner dismiss button hides the error', async () => {
  const fetchImpl = () => Promise.resolve(
    makeResponse({ ok: false, status: 503, body: { error: 'service down' } })
  );

  const dom = setupDom(fetchImpl);
  try {
    await flushAsync();
    const { document } = dom.window;

    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-banner__message');
    assert.equal(errorBanner.hidden, false, 'error banner visible after failed fetch');
    assert.ok(errorMessage.textContent.length > 0, 'error message populated');

    const dismissBtn = document.getElementById('error-banner__dismiss');
    assert.ok(dismissBtn, 'error dismiss button exists');
    dismissBtn.click();

    // Dismiss is synchronous.
    assert.equal(errorBanner.hidden, true, 'error banner hidden after dismiss click');
    assert.equal(errorMessage.textContent, '', 'error message cleared after dismiss');
  } finally {
    dom.window.close();
  }
});

test('Region renders displayName when API returns region as an object {name, displayName}', async () => {
  // Real CAST AI /v1/kubernetes/external-clusters returns region as an object
  // `{ name, displayName }`. The frontend must coerce that to a string and
  // never produce "[object Object]" in the rendered Region cell.
  const clusters = [
    {
      id: 'cls-region-obj',
      name: 'region-obj-cluster',
      status: 'ready',
      providerType: 'eks',
      region: { name: 'us-west-2', displayName: 'US West (Oregon)' },
      agentStatus: 'connected',
      nodeCount: 2,
      resources: {
        cpuRequested: 4,
        cpuUsed: 1,
        cpuUtilization: 0.25,
        memoryRequested: 8,
        memoryUsed: 2,
        memoryUtilization: 0.25,
      },
      savings: {
        currentMonthlyCost: 100,
        optimizedMonthlyCost: 60,
        monthlySavings: 40,
        savingsPercentage: 0.4,
      },
      workloadOptimizationOpportunities: 0,
    },
    {
      // Belt-and-braces: only `name`, no `displayName` — must fall back to `name`.
      id: 'cls-region-name-only',
      name: 'region-name-only-cluster',
      status: 'ready',
      providerType: 'gke',
      region: { name: 'europe-west1' },
      agentStatus: 'connected',
      nodeCount: 1,
      resources: {},
      savings: {},
      workloadOptimizationOpportunities: 0,
    },
  ];

  const fetchImpl = () => Promise.resolve(
    makeResponse({ ok: true, status: 200, body: clusters })
  );

  const dom = setupDom(fetchImpl);
  try {
    await flushAsync();
    const { document } = dom.window;

    const card1 = getCard(document, 'cls-region-obj');
    assert.ok(card1, 'first card present');
    assert.ok(!card1.textContent.includes('[object Object]'),
      'card 1 must not render "[object Object]" anywhere');
    assert.ok(card1.textContent.includes('US West (Oregon)'),
      'card 1 renders region.displayName');
    // The raw object fields must not leak either.
    assert.ok(!card1.textContent.includes('us-west-2'),
      'card 1 prefers displayName over name when both are present');

    const card2 = getCard(document, 'cls-region-name-only');
    assert.ok(card2, 'second card present');
    assert.ok(!card2.textContent.includes('[object Object]'),
      'card 2 must not render "[object Object]" anywhere');
    assert.ok(card2.textContent.includes('europe-west1'),
      'card 2 falls back to region.name when displayName is absent');
  } finally {
    dom.window.close();
  }
});
