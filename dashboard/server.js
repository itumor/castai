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
async function castaiGet(apiPath) {
  const apiKey = getCastaiApiKey();
  if (!apiKey) {
    const err = new Error('CASTAI_API_KEY is not configured');
    err.status = 503;
    throw err;
  }

  const cacheKey = `GET ${apiPath}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const url = `${getCastaiBaseUrl()}${apiPath}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
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

async function buildClusterSummary(cluster) {
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
      const nodesPayload = await castaiGet(`/v1/kubernetes/external-clusters/${encodeURIComponent(id)}/nodes`);
      nodeCount = extractItems(nodesPayload).length;
    } catch (_err) {
      // Leave nodeCount as null on failure.
    }

    try {
      const usagePayload = await castaiGet(`/v1/cost-reports/clusters/${encodeURIComponent(id)}/resource-usage`);
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
      const savingsPayload = await castaiGet(`/v1/cost-reports/clusters/${encodeURIComponent(id)}/savings`);
      savings = pickSavingsTotals(savingsPayload);
    } catch (_err) {
      // Keep defaults.
    }

    try {
      const workloadsPayload = await castaiGet(`/v1/workload-autoscaling/clusters/${encodeURIComponent(id)}/workloads`);
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

// --- Clusters endpoint -----------------------------------------------------

app.get('/api/clusters', async (_req, res) => {
  if (!getCastaiApiKey()) {
    return res.status(503).json({ error: 'CASTAI_API_KEY is not configured' });
  }

  let clusters;
  try {
    const list = await castaiGet('/v1/kubernetes/external-clusters');
    clusters = extractItems(list);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    return res.status(status).json({ error: 'Failed to fetch clusters from CAST AI' });
  }

  const summaries = [];
  for (const cluster of clusters) {
    try {
      summaries.push(await buildClusterSummary(cluster));
    } catch (_err) {
      // Skip clusters that fail to summarise entirely.
    }
  }

  res.json(summaries);
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
