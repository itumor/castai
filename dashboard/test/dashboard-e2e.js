'use strict';

// Temporary E2E driver for Phase-2 step-2 verification.
// Loads public/index.html + public/app.js in jsdom, stubs window.fetch with the
// real /api/clusters response from the running dashboard, and asserts that the
// frontend renders cluster cards with expected fields.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC_DIR = '/Users/eramadan/castai/dashboard/public';
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

const realClusters = JSON.parse(
  fs.readFileSync('/tmp/dashboard-clusters.json', 'utf8')
);

// Capture console output from the page to surface any client-side errors.
const consoleMessages = [];
function recordConsole(level) {
  return (...args) => {
    consoleMessages.push({ level, args: args.map((a) => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); }
      catch (_e) { return String(a); }
    }) });
  };
}

const dom = new JSDOM(indexHtml, {
  url: 'http://localhost:3456/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

window.console.log = recordConsole('log');
window.console.info = recordConsole('info');
window.console.warn = recordConsole('warn');
window.console.error = recordConsole('error');

// Mock fetch with the real /api/clusters response. Mirrors what the browser
// would receive from the dashboard server.
window.fetch = (url) => {
  if (typeof url === 'string' && url.endsWith('/api/clusters')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(realClusters),
      text: () => Promise.resolve(JSON.stringify(realClusters)),
    });
  }
  return Promise.reject(new Error('unexpected fetch in jsdom: ' + url));
};

window.eval(appJs);

(async () => {
  // Drain microtasks: fetch -> json() -> render -> lastUpdated text set.
  await new Promise((r) => setTimeout(r, 50));

  const { document } = window;
  const cards = document.querySelectorAll('article.card');
  const loading = document.getElementById('loading');
  const errorBanner = document.getElementById('error-banner');
  const emptyState = document.getElementById('empty-state');
  const lastUpdated = document.getElementById('last-updated');

  const result = {
    http: {
      indexHtml: '200 (from curl)',
      appJs: '200 (from curl)',
      clustersEndpoint: '200 (from curl)',
    },
    clusterArrayLength: Array.isArray(realClusters) ? realClusters.length : null,
    clusterIdSeen: Array.isArray(realClusters) && realClusters[0]
      ? (typeof realClusters[0].id === 'string'
          ? realClusters[0].id.slice(0, 8) + '...'
          : String(realClusters[0].id).slice(0, 8) + '...')
      : null,
    clusterNameSeen: Array.isArray(realClusters) && realClusters[0]
      ? realClusters[0].name : null,
    rawShape: Array.isArray(realClusters) && realClusters[0]
      ? {
          regionType: typeof realClusters[0].region,
          regionIsObject:
            realClusters[0].region !== null && typeof realClusters[0].region === 'object',
          statusType: typeof realClusters[0].status,
          providerType: typeof realClusters[0].providerType,
        }
      : null,
    rendered: {
      cardsRendered: cards.length,
      loadingHidden: loading && loading.hidden,
      errorBannerHidden: errorBanner && errorBanner.hidden,
      emptyStateHidden: emptyState && emptyState.hidden,
      lastUpdatedText: lastUpdated ? lastUpdated.textContent : null,
    },
    cardAssertions: [],
    consoleErrors: consoleMessages.filter((m) => m.level === 'error'),
    consoleWarnings: consoleMessages.filter((m) => m.level === 'warn'),
  };

  for (const card of cards) {
    const text = card.textContent;
    const regionEl = card.querySelectorAll('.kv__val')[1]; // Provider, Region, Agent, Nodes
    const regionText = regionEl ? regionEl.textContent : null;
    result.cardAssertions.push({
      clusterId: card.getAttribute('data-cluster-id'),
      hasName: text.includes('eks-08181-in'),
      hasStatus: text.includes('Failed'),
      hasProvider: text.includes('eks'),
      hasNodeCount: text.includes('1'),
      hasMemoryCpuLabels: text.includes('CPU') && text.includes('Memory'),
      hasSavings: text.includes('Monthly Cost'),
      hasOptimization: text.includes('Optimization'),
      regionRendered: regionText, // expect "[object Object]" bug or string
      regionLooksCorrect:
        regionText !== '[object Object]' &&
        !/\[object Object\]/.test(text),
    });
  }

  console.log(JSON.stringify(result, null, 2));
  dom.window.close();
})().catch((err) => {
  console.error('jsdom driver crashed:', err);
  process.exit(1);
});
