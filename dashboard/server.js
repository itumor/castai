'use strict';

// Load environment variables from .env if present. dotenv does not throw when the
// .env file is missing - it simply returns { parsed: undefined }. The try/catch
// is defensive: if dotenv itself fails to load for any reason we still want the
// server to come up using the current process environment.
try {
  require('dotenv').config();
} catch (_err) {
  // .env is optional; ignore failures.
}

const path = require('node:path');
const express = require('express');

const DEFAULT_PORT = 3000;
const DEFAULT_CACHE_TTL_MS = 60_000;

// Read env-derived config lazily so tests can mutate process.env between
// requests without re-importing the module.
function getCastaiApiKey() {
  return process.env.CASTAI_API_KEY || '';
}

function getDashboardToken() {
  return process.env.DASHBOARD_API_TOKEN || '';
}

function getCastaiOrgId() {
  return process.env.CASTAI_ORG_ID || '';
}

function getCastaiBaseUrl() {
  const region = process.env.CASTAI_REGION || 'api.cast.ai';
  return `https://${region}`;
}

function getCacheTtlMs() {
  const raw = process.env.DASHBOARD_CACHE_TTL_MS;
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

const app = express();

// Serve static assets from public/. The directory may be empty during early
// development; express.static is a no-op in that case.
app.use(express.static(path.join(__dirname, 'public')));

// Optional bearer-token auth for the JSON API. When DASHBOARD_API_TOKEN is
// unset, the middleware is a no-op and the API is publicly reachable.
function bearerAuth(req, res, next) {
  const token = getDashboardToken();
  if (!token) {
    return next();
  }
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1] !== token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

app.use('/api', bearerAuth);

// --- Health ----------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- In-memory TTL cache ---------------------------------------------------

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function resetCache() {
  cache.clear();
}

// --- CAST AI fetch wrapper -------------------------------------------------

// Returns parsed JSON or throws an Error with a `.status` hint that callers can
// map to a safe HTTP status code (5xx). The API key is never put on the error
// object or in any logged value.
async function castaiGet(apiPath, orgIdOverride) {
  const apiKey = getCastaiApiKey();
  if (!apiKey) {
    const err = new Error('CASTAI_API_KEY is not configured');
    err.status = 503;
    throw err;
  }

  // Enterprise master keys need explicit org scoping; without this header
  // CAST AI silently returns empty lists / rejects cluster-scoped reads.
  // A per-request org (Siemens sub-org selector) wins over the env default.
  const orgId = typeof orgIdOverride === 'string' && orgIdOverride !== ''
    ? orgIdOverride
    : getCastaiOrgId();

  const cacheKey = `GET ${orgId}\n${apiPath}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const url = `${getCastaiBaseUrl()}${apiPath}`;
  const headers = {
    'X-API-Key': apiKey,
    'Accept': 'application/json',
  };
  if (orgId) {
    headers['X-CastAI-Organization-Id'] = orgId;
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (networkErr) {
    const err = new Error('CAST AI request failed');
    err.status = 502;
    err.cause = networkErr;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`CAST AI returned status ${res.status}`);
    err.status = 502;
    throw err;
  }

  const body = await res.json();
  cacheSet(cacheKey, body, getCacheTtlMs());
  return body;
}

// --- Aggregation helpers ---------------------------------------------------

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function pickLatestUsageItem(usage) {
  if (!usage) return {};
  if (Array.isArray(usage)) {
    if (usage.length === 0) return {};
    return usage[usage.length - 1];
  }
  if (typeof usage === 'object') return usage;
  return {};
}

function pickSavingsTotals(savings) {
  if (!savings || typeof savings !== 'object') {
    return {
      currentMonthlyCost: null,
      optimizedMonthlyCost: null,
      monthlySavings: null,
      savingsPercentage: null,
    };
  }
  const src = savings.totals || savings.summary || savings;
  return {
    currentMonthlyCost: pickNumber(src.currentMonthlyCost),
    optimizedMonthlyCost: pickNumber(src.optimizedMonthlyCost),
    monthlySavings: pickNumber(src.monthlySavings),
    savingsPercentage: pickNumber(src.savingsPercentage),
  };
}

function pickNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function countOptimizationOpportunities(workloads) {
  if (!Array.isArray(workloads)) return 0;
  let count = 0;
  for (const w of workloads) {
    if (!w || typeof w !== 'object') continue;
    const rec = w.recommendation
      || (Array.isArray(w.recommendations) ? w.recommendations[0] : null);
    if (!rec || typeof rec !== 'object') continue;

    const current = w.current || {};
    const currentCpu = current.cpu ?? w.currentCpu;
    const currentMemory = current.memory ?? w.currentMemory;
    const recCpu = rec.cpu ?? rec.recommendedCpu;
    const recMemory = rec.memory ?? rec.recommendedMemory;

    const cpuDifferent = recCpu != null && currentCpu != null && recCpu !== currentCpu;
    const memDifferent = recMemory != null && currentMemory != null && recMemory !== currentMemory;
    if (cpuDifferent || memDifferent) {
      count += 1;
    }
  }
  return count;
}

async function buildClusterSummary(cluster, orgId) {
  const id = cluster.id;
  let nodeCount = null;
  let resources = {
    cpuRequested: null,
    cpuUsed: null,
    cpuUtilization: null,
    memoryRequested: null,
    memoryUsed: null,
    memoryUtilization: null,
  };
  let savings = {
    currentMonthlyCost: null,
    optimizedMonthlyCost: null,
    monthlySavings: null,
    savingsPercentage: null,
  };
  let workloadOptimizationOpportunities = 0;

  if (id != null) {
    try {
      const nodesPayload = await castaiGet(`/v1/kubernetes/external-clusters/${encodeURIComponent(id)}/nodes`, orgId);
      nodeCount = extractItems(nodesPayload).length;
    } catch (_err) {
      // Leave nodeCount as null on failure.
    }

    try {
      const usagePayload = await castaiGet(`/v1/cost-reports/clusters/${encodeURIComponent(id)}/resource-usage`, orgId);
      const latest = pickLatestUsageItem(usagePayload);
      resources = {
        cpuRequested: pickNumber(latest.cpuRequested),
        cpuUsed: pickNumber(latest.cpuUsed),
        cpuUtilization: pickNumber(latest.cpuUtilization),
        memoryRequested: pickNumber(latest.memoryRequested),
        memoryUsed: pickNumber(latest.memoryUsed),
        memoryUtilization: pickNumber(latest.memoryUtilization),
      };
    } catch (_err) {
      // Keep defaults.
    }

    try {
      const savingsPayload = await castaiGet(`/v1/cost-reports/clusters/${encodeURIComponent(id)}/savings`, orgId);
      savings = pickSavingsTotals(savingsPayload);
    } catch (_err) {
      // Keep defaults.
    }

    try {
      const workloadsPayload = await castaiGet(`/v1/workload-autoscaling/clusters/${encodeURIComponent(id)}/workloads`, orgId);
      workloadOptimizationOpportunities = countOptimizationOpportunities(extractItems(workloadsPayload));
    } catch (_err) {
      // Keep at 0.
    }
  }

  const rawStatus = cluster.status;
  let status = null;
  let agentStatus = null;
  if (rawStatus && typeof rawStatus === 'object') {
    status = rawStatus.state || rawStatus.status || null;
    agentStatus = rawStatus.agentStatus != null ? rawStatus.agentStatus : null;
  } else if (typeof rawStatus === 'string') {
    status = rawStatus;
  }

  return {
    id: id != null ? id : null,
    name: cluster.name != null ? cluster.name : null,
    status,
    providerType: cluster.providerType != null ? cluster.providerType : null,
    region: cluster.region != null ? cluster.region : null,
    agentStatus,
    nodeCount,
    resources,
    savings,
    workloadOptimizationOpportunities,
  };
}

// --- Organizations (sub-org selector) ---------------------------------------
//
// Siemens runs one enterprise master org with many sub-organizations. The
// master API key addresses a sub-org via the X-CastAI-Organization-Id header.
// Clients pass ?orgId=<uuid> per request; every id is validated against the
// fetched organization list before it is ever used upstream (allow-list).

const ORG_ID_RE = /^[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/;

function extractOrgs(payload) {
  if (payload && Array.isArray(payload.organizations)) return payload.organizations;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

app.get('/api/orgs', async (_req, res) => {
  if (!getCastaiApiKey()) {
    return res.status(503).json({ error: 'CASTAI_API_KEY is not configured' });
  }
  try {
    const payload = await castaiGet('/v1/organizations');
    const orgs = extractOrgs(payload)
      .map((o) => ({
        id: o && o.id != null ? String(o.id) : null,
        name: o && o.name != null ? String(o.name) : null,
      }))
      .filter((o) => o.id !== null && o.name !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(orgs);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    res.status(status).json({ error: 'Failed to fetch organizations from CAST AI' });
  }
});

async function isKnownOrgId(orgId) {
  const payload = await castaiGet('/v1/organizations');
  return extractOrgs(payload).some((o) => o && String(o.id) === orgId);
}

// Returns '' when no org was requested (env default applies), the validated
// org id, or null when the request was already answered with an error.
async function requestedOrgOr400(req, res) {
  const raw = req.query && typeof req.query.orgId === 'string' ? req.query.orgId.trim() : '';
  if (raw === '') return '';
  if (!ORG_ID_RE.test(raw)) {
    res.status(400).json({ error: 'orgId must be a UUID' });
    return null;
  }
  let known;
  try {
    known = await isKnownOrgId(raw);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    res.status(status).json({ error: 'Failed to verify orgId against CAST AI' });
    return null;
  }
  if (!known) {
    res.status(400).json({ error: 'unknown orgId' });
    return null;
  }
  return raw;
}

// --- Clusters endpoint -----------------------------------------------------

app.get('/api/clusters', async (req, res) => {
  if (!getCastaiApiKey()) {
    return res.status(503).json({ error: 'CASTAI_API_KEY is not configured' });
  }

  const orgOverride = await requestedOrgOr400(req, res);
  if (orgOverride === null) return;
  const orgId = orgOverride || undefined;

  let clusters;
  try {
    const list = await castaiGet('/v1/kubernetes/external-clusters', orgId);
    clusters = extractItems(list);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    return res.status(status).json({ error: 'Failed to fetch clusters from CAST AI' });
  }

  // Lightweight listing (id/name only) for dropdown-style consumers; skips the
  // per-cluster probes that make the full summary expensive fleet-wide.
  if (req.query.basic === '1' || req.query.basic === 'true') {
    return res.json(clusters.map((c) => ({
      id: c && c.id != null ? c.id : null,
      name: c && c.name != null ? c.name : null,
    })));
  }

  const summaries = [];
  for (const cluster of clusters) {
    try {
      summaries.push(await buildClusterSummary(cluster, orgId));
    } catch (_err) {
      // Skip clusters that fail to summarise entirely.
    }
  }

  res.json(summaries);
});

// --- Estimated savings (read-only savings potential) ----------------------
//
// Proxies the CAST AI cost-report endpoints that back the "Available Savings"
// report for read-only clusters:
//   GET /v1/cost-reports/clusters/{id}/estimated-savings
//   GET /v1/cost-reports/clusters/{id}/estimated-savings-history
// Both are GET-only and safe under a read-only API key.

const CLUSTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Accepts YYYY-MM-DD or an RFC3339 date-time; rejects path tricks and garbage.
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function sanitizeClusterId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  return CLUSTER_ID_RE.test(id) ? id : null;
}

function isValidDateParam(value) {
  if (typeof value !== 'string' || !DATE_PARAM_RE.test(value.trim())) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function defaultHistoryRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  return { from, to };
}

// The upstream endpoint rejects plain dates ("parsing field from_date ..."):
// it only accepts RFC3339 date-times. Plain YYYY-MM-DD inputs are expanded to
// start/end of that day in UTC.
function toRFC3339(value, endOfDay) {
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!plain) return value;
  return endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
}

function proxyCastaiError(res, err, what) {
  const status = err && err.status ? err.status : 502;
  // Never leak upstream bodies, headers, or the API key to the client.
  res.status(status).json({ error: `Failed to fetch ${what} from CAST AI` });
}

app.get('/api/clusters/:clusterId/estimated-savings', async (req, res) => {
  if (!getCastaiApiKey()) {
    return res.status(503).json({ error: 'CASTAI_API_KEY is not configured' });
  }
  const orgOverride = await requestedOrgOr400(req, res);
  if (orgOverride === null) return;

  const clusterId = sanitizeClusterId(req.params.clusterId);
  if (!clusterId) {
    return res.status(400).json({ error: 'invalid cluster id' });
  }

  try {
    const data = await castaiGet(
      `/v1/cost-reports/clusters/${encodeURIComponent(clusterId)}/estimated-savings`,
      orgOverride || undefined,
    );
    res.json(data);
  } catch (err) {
    proxyCastaiError(res, err, 'estimated savings');
  }
});

app.get('/api/clusters/:clusterId/estimated-savings-history', async (req, res) => {
  if (!getCastaiApiKey()) {
    return res.status(503).json({ error: 'CASTAI_API_KEY is not configured' });
  }
  const orgOverride = await requestedOrgOr400(req, res);
  if (orgOverride === null) return;

  const clusterId = sanitizeClusterId(req.params.clusterId);
  if (!clusterId) {
    return res.status(400).json({ error: 'invalid cluster id' });
  }

  const defaults = defaultHistoryRange();
  const fromRaw = req.query.fromDate ? String(req.query.fromDate) : defaults.from.toISOString();
  const toRaw = req.query.toDate ? String(req.query.toDate) : defaults.to.toISOString();
  if (!isValidDateParam(fromRaw) || !isValidDateParam(toRaw)) {
    return res.status(400).json({ error: 'fromDate/toDate must be YYYY-MM-DD or RFC3339' });
  }
  if (new Date(fromRaw).getTime() > new Date(toRaw).getTime()) {
    return res.status(400).json({ error: 'fromDate must not be after toDate' });
  }

  const params = new URLSearchParams({
    fromDate: toRFC3339(fromRaw.trim(), false),
    toDate: toRFC3339(toRaw.trim(), true),
  });
  if (req.query.useListingPrices === 'true' || req.query.useListingPrices === 'false') {
    params.set('useListingPrices', req.query.useListingPrices);
  }

  try {
    const data = await castaiGet(
      `/v1/cost-reports/clusters/${encodeURIComponent(clusterId)}/estimated-savings-history?${params.toString()}`,
      orgOverride || undefined,
    );
    res.json(data);
  } catch (err) {
    proxyCastaiError(res, err, 'estimated savings history');
  }
});

// --- Fleet-wide Excel export (savings potential) ---------------------------
//
// GET /api/export/savings-potential.xlsx
// Fans out read-only across every visible org -> cluster -> estimated-savings
// (plus estimated-savings-history medians) and returns an .xlsx workbook.
// Query params:
//   historyDays  (default 14; 0 = snapshot only, no history medians; max 90)
//   orgId        (optional: export a single org; validated like everywhere else)

const ExcelJS = require('exceljs');

function pairNum(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function costAfter(value) {
  const n = pairNum(value);
  if (n !== null) return n;
  if (value && typeof value === 'object') return pairNum(value.priceAfter);
  return null;
}

function costBefore(value) {
  if (value && typeof value === 'object') return pairNum(value.priceBefore);
  return null;
}

function exportClassifyScenario(key) {
  const k = String(key).toLowerCase();
  const hasSpot = /spot/.test(k);
  const hasArm = /arm|graviton/.test(k);
  if (hasSpot && hasArm) return 'Spot + ARM';
  if (hasSpot) return 'Spot';
  if (hasArm) return 'ARM';
  return 'Rightsizing';
}

function exportNodeMix(details) {
  const ca = details && typeof details === 'object' ? details.configurationAfter : null;
  const nodes = ca && Array.isArray(ca.nodes) ? ca.nodes : null;
  if (!nodes || nodes.length === 0) return { nodeMix: null, nodesAfter: null, spotNodesAfter: null };
  const byType = new Map();
  let spot = 0;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const type = n.instanceType != null ? String(n.instanceType) : 'unknown';
    byType.set(type, (byType.get(type) || 0) + 1);
    if (n.spot === true) spot += 1;
  }
  const nodeMix = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count}x ${type}`)
    .join(' + ');
  return { nodeMix, nodesAfter: nodes.length, spotNodesAfter: spot };
}

// Snapshot scenarios are keyed "Layman"/"SpotOnly" while history items use
// "optimizedLayman"/"optimizedSpotOnly". Normalize before matching medians.
function normalizeScenarioKey(key) {
  return String(key).replace(/^optimized/i, '');
}

function exportMedian(points, scenarioKey) {
  const pcts = [];
  for (const p of points) {
    if (!p || p.current == null || p.current <= 0) continue;
    const scen = p.scenarios[scenarioKey];
    if (scen == null) continue;
    pcts.push((1 - scen / p.current) * 100);
  }
  if (pcts.length === 0) return { median: null, days: 0 };
  pcts.sort((a, b) => a - b);
  const mid = Math.floor(pcts.length / 2);
  return {
    median: pcts.length % 2 === 0 ? (pcts[mid - 1] + pcts[mid]) / 2 : pcts[mid],
    days: pcts.length,
  };
}

function exportParseHistory(payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const points = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const current = item.current && typeof item.current === 'object'
      ? pairNum(item.current.costPerHour)
      : null;
    const scenarios = {};
    for (const key of Object.keys(item)) {
      if (key === 'createdAt' || key === 'timestamp' || key === 'current') continue;
      const v = item[key];
      if (!v || typeof v !== 'object') continue;
      const cost = pairNum(v.costPerHour);
      if (cost !== null) scenarios[key] = cost;
    }
    points.push({ current, scenarios });
  }
  return points;
}

// Small bounded-concurrency runner for the fan-out.
async function runPooled(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

app.get('/api/export/savings-potential.xlsx', async (req, res) => {
  if (!getCastaiApiKey()) {
    return res.status(503).json({ error: 'CASTAI_API_KEY is not configured' });
  }

  let historyDays = 14;
  if (req.query.historyDays != null) {
    const n = Number(req.query.historyDays);
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      return res.status(400).json({ error: 'historyDays must be 0..90' });
    }
    historyDays = Math.floor(n);
  }

  let orgScope = null; // null = all visible orgs
  if (req.query.orgId) {
    const checked = await requestedOrgOr400(req, res);
    if (checked === null) return;
    orgScope = checked || null;
  }

  const errors = [];
  const note = (scope, name, endpoint, message) =>
    errors.push({ scope, name, endpoint, message });

  // 1) Org list
  let orgs;
  try {
    orgs = extractOrgs(await castaiGet('/v1/organizations'))
      .filter((o) => o && o.id != null && o.name != null);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    return res.status(status).json({ error: 'Failed to fetch organizations from CAST AI' });
  }
  if (orgScope) orgs = orgs.filter((o) => String(o.id) === orgScope);

  // 2) Cluster list per org (bounded fan-out)
  const orgResults = await runPooled(orgs, 4, async (org) => {
    const orgId = String(org.id);
    try {
      const list = await castaiGet('/v1/kubernetes/external-clusters', orgId);
      return { org, clusters: extractItems(list).filter((c) => c && c.id != null) };
    } catch (err) {
      note('org', String(org.name), 'external-clusters', `status ${err && err.status ? err.status : '?'}`);
      return { org, clusters: [] };
    }
  });

  const targets = [];
  for (const r of orgResults) {
    for (const c of r.clusters) targets.push({ org: r.org, cluster: c });
  }

  // 3) Estimated savings (+ history) per cluster
  let histFrom = null;
  let histTo = null;
  if (historyDays > 0) {
    histTo = new Date();
    histFrom = new Date(histTo.getTime() - historyDays * 24 * 60 * 60 * 1000);
  }

  const rows = []; // one row per cluster x scenario
  const clusterSummaries = [];

  await runPooled(targets, 6, async ({ org, cluster }) => {
    const orgId = String(org.id);
    const orgName = String(org.name);
    const clusterId = String(cluster.id);
    const clusterName = cluster.name != null ? String(cluster.name) : '';

    let snapshot = null;
    try {
      snapshot = await castaiGet(
        `/v1/cost-reports/clusters/${encodeURIComponent(clusterId)}/estimated-savings`,
        orgId,
      );
    } catch (err) {
      note('cluster', `${orgName} / ${clusterName || clusterId}`, 'estimated-savings', `status ${err && err.status ? err.status : '?'}`);
      return;
    }

    const recs = snapshot && snapshot.recommendations && typeof snapshot.recommendations === 'object'
      ? snapshot.recommendations
      : {};
    const cc = snapshot && snapshot.currentConfiguration && typeof snapshot.currentConfiguration === 'object'
      ? snapshot.currentConfiguration
      : {};
    const tp = cc.totalPrice && typeof cc.totalPrice === 'object' ? cc.totalPrice : {};
    const currentMonthly = pairNum(tp.monthly);
    const currentNodes = Array.isArray(cc.nodes) ? cc.nodes.length : null;
    const currentWorkloads = Array.isArray(cc.workloads) ? cc.workloads.length : null;

    // History medians per scenario key (optional).
    const medians = new Map();
    if (histFrom && histTo) {
      try {
        const params = new URLSearchParams({
          fromDate: histFrom.toISOString(),
          toDate: histTo.toISOString(),
        });
        const hist = await castaiGet(
          `/v1/cost-reports/clusters/${encodeURIComponent(clusterId)}/estimated-savings-history?${params.toString()}`,
          orgId,
        );
        const points = exportParseHistory(hist);
        const keys = new Set();
        for (const p of points) for (const k of Object.keys(p.scenarios)) keys.add(k);
        for (const key of keys) medians.set(normalizeScenarioKey(key), exportMedian(points, key));
      } catch (_err) {
        // History is best-effort: snapshot rows are still exported.
      }
    }

    const scenarioKeys = Object.keys(recs);
    const pctOf = (name) => {
      const r = recs[name];
      return r != null ? pairNum(r.savingsPercentage) : null;
    };

    clusterSummaries.push({
      orgName,
      orgId,
      clusterName,
      clusterId,
      currentMonthly,
      currentNodes,
      currentWorkloads,
      scenarioCount: scenarioKeys.length,
      laymanPct: pctOf('Layman'),
      spotInstancesPct: pctOf('SpotInstances'),
      spotOnlyPct: pctOf('SpotOnly'),
      rebalancing: snapshot.isRebalancingRecommended === true,
      updatedAt: snapshot.lastUpdatedAt != null ? String(snapshot.lastUpdatedAt) : null,
    });

    for (const key of scenarioKeys) {
      const r = recs[key];
      if (!r || typeof r !== 'object') continue;
      const mix = exportNodeMix(r.details);
      const med = medians.get(normalizeScenarioKey(key)) || { median: null, days: 0 };
      rows.push({
        orgName,
        orgId,
        clusterName,
        clusterId,
        scenario: key,
        category: exportClassifyScenario(key),
        savingsPct: pairNum(r.savingsPercentage),
        monthlyBefore: costBefore(r.monthly),
        monthlyAfter: costAfter(r.monthly),
        hourlyBefore: costBefore(r.hourly),
        hourlyAfter: costAfter(r.hourly),
        armUpliftMonthly: pairNum(r.armSavingsMonthly),
        currentMonthly,
        nodesAfter: mix.nodesAfter,
        nodeMix: mix.nodeMix,
        spotNodesAfter: mix.spotNodesAfter,
        rebalancing: snapshot.isRebalancingRecommended === true,
        medianPct: med.median,
        medianDays: med.days,
        updatedAt: snapshot.lastUpdatedAt != null ? String(snapshot.lastUpdatedAt) : null,
      });
    }
  });

  rows.sort((a, b) =>
    a.orgName.localeCompare(b.orgName)
    || a.clusterName.localeCompare(b.clusterName)
    || (b.savingsPct || 0) - (a.savingsPct || 0));
  clusterSummaries.sort((a, b) =>
    a.orgName.localeCompare(b.orgName) || a.clusterName.localeCompare(b.clusterName));

  // 4) Build the workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Siemens CAST AI Dashboard';
  workbook.created = new Date();

  const main = workbook.addWorksheet('Savings Potential');
  main.columns = [
    { header: 'Organization', key: 'orgName', width: 24 },
    { header: 'Org ID', key: 'orgId', width: 38 },
    { header: 'Cluster', key: 'clusterName', width: 34 },
    { header: 'Cluster ID', key: 'clusterId', width: 38 },
    { header: 'Scenario', key: 'scenario', width: 16 },
    { header: 'Category', key: 'category', width: 13 },
    { header: 'Savings %', key: 'savingsPct', width: 11 },
    { header: 'Monthly before ($)', key: 'monthlyBefore', width: 17 },
    { header: 'Monthly after ($)', key: 'monthlyAfter', width: 17 },
    { header: 'Hourly before ($/h)', key: 'hourlyBefore', width: 17 },
    { header: 'Hourly after ($/h)', key: 'hourlyAfter', width: 17 },
    { header: 'ARM uplift ($/mo)', key: 'armUpliftMonthly', width: 17 },
    { header: 'Current monthly ($)', key: 'currentMonthly', width: 17 },
    { header: 'Nodes after', key: 'nodesAfter', width: 11 },
    { header: 'Node mix (after)', key: 'nodeMix', width: 46 },
    { header: 'Spot nodes after', key: 'spotNodesAfter', width: 15 },
    { header: 'Rebalancing recommended', key: 'rebalancing', width: 22 },
    { header: 'Median daily savings % (window)', key: 'medianPct', width: 26 },
    { header: 'History days with data', key: 'medianDays', width: 19 },
    { header: 'Estimate updated at', key: 'updatedAt', width: 26 },
  ];
  for (const r of rows) main.addRow(r);
  main.getRow(1).font = { bold: true };
  main.views = [{ state: 'frozen', ySplit: 1 }];

  const byCluster = workbook.addWorksheet('Cluster Summary');
  byCluster.columns = [
    { header: 'Organization', key: 'orgName', width: 24 },
    { header: 'Org ID', key: 'orgId', width: 38 },
    { header: 'Cluster', key: 'clusterName', width: 34 },
    { header: 'Cluster ID', key: 'clusterId', width: 38 },
    { header: 'Current monthly ($)', key: 'currentMonthly', width: 17 },
    { header: 'Current nodes', key: 'currentNodes', width: 14 },
    { header: 'Workloads', key: 'currentWorkloads', width: 11 },
    { header: 'Scenarios offered', key: 'scenarioCount', width: 16 },
    { header: 'Layman %', key: 'laymanPct', width: 11 },
    { header: 'SpotInstances %', key: 'spotInstancesPct', width: 15 },
    { header: 'SpotOnly %', key: 'spotOnlyPct', width: 12 },
    { header: 'Rebalancing recommended', key: 'rebalancing', width: 22 },
    { header: 'Estimate updated at', key: 'updatedAt', width: 26 },
  ];
  for (const r of clusterSummaries) byCluster.addRow(r);
  byCluster.getRow(1).font = { bold: true };
  byCluster.views = [{ state: 'frozen', ySplit: 1 }];

  const errSheet = workbook.addWorksheet('Errors');
  errSheet.columns = [
    { header: 'Scope', key: 'scope', width: 10 },
    { header: 'Name', key: 'name', width: 50 },
    { header: 'Endpoint', key: 'endpoint', width: 24 },
    { header: 'Message', key: 'message', width: 40 },
  ];
  for (const e of errors) errSheet.addRow(e);
  errSheet.getRow(1).font = { bold: true };

  const meta = workbook.addWorksheet('Meta');
  const generatedAt = new Date();
  [
    ['Generated at', generatedAt.toISOString()],
    ['Organizations in scope', orgs.length],
    ['Clusters in scope', targets.length],
    ['Scenario rows', rows.length],
    ['History window (days)', historyDays],
    ['History range', histFrom && histTo ? `${histFrom.toISOString()} .. ${histTo.toISOString()}` : 'disabled'],
    ['Source endpoints', 'GET /v1/cost-reports/clusters/{id}/estimated-savings (+ /estimated-savings-history)'],
    ['Note', 'Potential-savings estimates from current cluster snapshots - NOT realized savings.'],
    ['Note', 'Committed-use discounts (CUDs) are not included in CAST AI savings percentages.'],
    ['Note', 'Read-only export: no CAST AI resource is modified.'],
  ].forEach(([k, v]) => meta.addRow([k, v]));
  meta.getColumn(1).width = 26;
  meta.getColumn(2).width = 110;

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${generatedAt.getUTCFullYear()}${pad(generatedAt.getUTCMonth() + 1)}${pad(generatedAt.getUTCDate())}-${pad(generatedAt.getUTCHours())}${pad(generatedAt.getUTCMinutes())}`;
  const buffer = await workbook.xlsx.writeBuffer();

  console.log(`export: ${orgs.length} orgs, ${targets.length} clusters, ${rows.length} scenario rows, ${errors.length} errors`);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="castai-savings-potential-${stamp}.xlsx"`);
  res.send(Buffer.from(buffer));
});

// 404 fallback for unknown routes.
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Only bind the port when this module is the entrypoint. When required by
// tests, the module exports `app` and stays quiet.
if (require.main === module) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  app.listen(port, () => {
    // Never log the API key or any other secret. Port is non-sensitive.
    console.log(`CAST AI dashboard listening on port ${port}`);
  });
}

module.exports = {
  app,
  resetCache,
};
