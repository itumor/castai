#!/usr/bin/env node
/* CAST AI · Fleet Realized-Savings Dashboard — zero-dependency local server.
 *
 * Every number shown in the UI is fetched LIVE from the CAST AI EU API:
 *   GET  /v1/organizations                                     → org list
 *   GET  /v1/kubernetes/external-clusters   (per org)          → fleet + agent status
 *   POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport?startTime&endTime
 *        (report query, read-semantics)                        → flags + savings per cluster
 *   Drill-down (per cluster, on drawer open):
 *   GET  /reporting/v1beta/organizations/{org}/clusters/{id}/baseline-params  (200 | 404 = no baseline)
 *   GET  /v1/kubernetes/external-clusters/{id}/nodes           (managed-by / karpenter label share)
 *   GET  /v1/workload-autoscaling/clusters/{id}/workloads-summary (400 = agent not installed)
 *   GET  /v1/cost-reports/clusters/{id}/savings                (400 = read-only signal)
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..', '..');

/* ---------- env: key resolution without ever printing it ---------- */
function loadDotenv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    out[m[1]] = v;
  }
  return out;
}
const dotenv = { ...loadDotenv(join(REPO, '.env')), ...loadDotenv(join(REPO, 'awskey.env')) };
const env = (k) => process.env[k] || dotenv[k];
const KEY_CANDIDATES = ['Castai_mcp', 'CASTAI_API_KEY', 'TF_VAR_castai_api_token'];
let API_KEY = null; let API_KEY_NAME = null;
const API_BASE = (env('CASTAI_API_BASE') || 'https://api.eu.cast.ai').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3377);

/* pick the candidate that actually answers /v1/organizations with 200 */
for (const name of KEY_CANDIDATES) {
  const candidate = env(name);
  if (!candidate) continue;
  try {
    const res = await fetch(`${API_BASE}/v1/organizations`, { headers: { 'X-API-Key': candidate, Accept: 'application/json' } });
    if (res.status === 200) { API_KEY = candidate; API_KEY_NAME = name; break; }
    console.log(`key candidate ${name}: HTTP ${res.status} on /v1/organizations — skipped`);
  } catch (e) {
    console.log(`key candidate ${name}: request failed (${e.message}) — skipped`);
  }
}
if (!API_KEY) {
  console.error('FATAL: no CAST AI key answered /v1/organizations with 200 (tried ' + KEY_CANDIDATES.join(', ') + ' in env/.env/awskey.env).');
  process.exit(1);
}
console.log(`api base: ${API_BASE}  ·  key: ${API_KEY_NAME} (present, ${API_KEY.length} chars)  ·  port: ${PORT}`);

/* ---------- tiny fetch helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call({ method = 'GET', path, orgId, body, timeoutMs = 25000, attempt = 1 }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const headers = { 'X-API-Key': API_KEY, Accept: 'application/json' };
  if (orgId) headers['X-CastAI-Organization-Id'] = orgId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers, signal: ctl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* nginx html etc */ }
    if (res.status === 429 && attempt <= 4) {
      const wait = Number(res.headers.get('retry-after') || attempt * 2);
      await sleep(wait * 1000);
      return call({ method, path, orgId, body, timeoutMs, attempt: attempt + 1 });
    }
    return { status: res.status, json, snippet: text.slice(0, 240).replace(/\s+/g, ' ').trim() };
  } catch (e) {
    if (attempt <= 3) { await sleep(800 * attempt); return call({ method, path, orgId, body, timeoutMs, attempt: attempt + 1 }); }
    return { status: -1, json: null, snippet: String(e && e.message || e).slice(0, 160) };
  } finally { clearTimeout(t); }
}

const iso = (d) => d.toISOString();
function computeWindow(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400 * 1000);
  return { startTime: iso(start), endTime: iso(end), days };
}
function computeCustomWindow(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('invalid dates — use YYYY-MM-DD');
  if (end <= start) throw new Error('end date must be after start date');
  return { startTime: iso(start), endTime: iso(end), days: Math.round((end - start) / 86400000) };
}

/* ---------- case classification (matches CASES.md / flow diagram) ---------- */
function classify({ item, agentStatus }) {
  if (item) {
    const w = item.woopAdopted === true, n = item.autoscalerAdopted === true;
    if (w && n) return 'D';
    if (w && !n) return 'B';
    if (!w && n) return 'C';
    return 'A';
  }
  if (['disconnected', 'non-responding', 'waiting-connection', 'archived'].includes(agentStatus)) return 'F';
  return 'A';
}
const shortId = (id) => (id || '').slice(0, 8);

/* ---------- fleet sweep job ---------- */
const jobs = new Map();
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function sweep(job, { windowDays, startDate, endDate, orgIds }) {
  const win = (startDate && endDate) ? computeCustomWindow(startDate, endDate) : computeWindow(windowDays);
  // 1) orgs
  const orgsRes = await call({ path: '/v1/organizations' });
  if (orgsRes.status !== 200) throw new Error(`organizations call failed: HTTP ${orgsRes.status} ${orgsRes.snippet}`);
  let orgs = (orgsRes.json.organizations || orgsRes.json || []).map((o) => ({ id: o.id, name: o.name }));
  if (orgIds?.length) orgs = orgs.filter((o) => orgIds.includes(o.id));
  job.total = orgs.length;
  job.progress.current = `${orgs.length} organizations`;

  const rows = [];
  const orgErrors = [];
  const orgsMeta = [];
  const perOrgTotals = new Map();

  // 2) per org: clusters + report, waves of 8
  let idx = 0;
  async function oneOrg(org) {
    const clustersRes = await call({ path: '/v1/kubernetes/external-clusters', orgId: org.id });
    const vrPath = `/reporting/v1beta/organizations/${org.id}/clusters:runValueRealizationReport?startTime=${encodeURIComponent(win.startTime)}&endTime=${encodeURIComponent(win.endTime)}`;
    const reportRes = await call({ method: 'POST', path: vrPath, orgId: org.id, body: {} });
    job.done += 1; job.progress.current = org.name;

    const orgErr = {};
    if (clustersRes.status !== 200) orgErr.clusters = `HTTP ${clustersRes.status} ${clustersRes.snippet}`;
    if (reportRes.status !== 200) orgErr.report = `HTTP ${reportRes.status} ${reportRes.snippet}`;
    if (Object.keys(orgErr).length) { orgErrors.push({ orgId: org.id, orgName: org.name, ...orgErr }); return; }

    const clusters = (clustersRes.json.items || clustersRes.json.clusters || clustersRes.json || []).map((c) => ({
      clusterId: c.id, name: c.name,
      agentStatus: c.agentStatus || c.status || 'unknown',
      clusterStatus: c.status || '',
      region: c.region || c.cloudProvider?.region || '',
      providerType: c.providerType || c.cloudProvider?.type || '',
      eks: c.eks, aks: c.aks, gke: c.gke,
    }));
    const items = reportRes.json.items || [];
    const byId = new Map(items.map((i) => [i.clusterId, i]));
    const seen = new Set();
    let orgNa = 0, orgNb = 0, orgNw = 0, orgNact = 0;

    const addRow = (c, item) => {
      const caseId = classify({ item, agentStatus: c.agentStatus });
      const was = item?.cost?.workloadAutoscalerSavings ?? null;
      const node = item?.cost?.autoscalerSavings ?? null;
      const total = item?.cost?.totalSavings ?? null;
      const actual = item?.cost?.actualCost ?? null;
      rows.push({
        orgId: org.id, orgName: org.name,
        clusterId: c.clusterId, id8: shortId(c.clusterId), name: item?.clusterName || c.name,
        caseId,
        woopAdopted: item ? item.woopAdopted === true : null,
        autoscalerAdopted: item ? item.autoscalerAdopted === true : null,
        baselineType: item?.baselineType || null,
        clusterStatus: item?.clusterStatus || c.clusterStatus,
        agentStatus: c.agentStatus, region: c.region, providerType: c.providerType,
        wasSavings: was, nodeSavings: node, totalSavings: total, actualCost: actual,
        projectedCost: item?.cost?.projectedCost ?? null,
        inReport: !!item,
      });
      if (was || node || actual) { orgNw += was || 0; orgNb += node || 0; orgNa += total || 0; orgNact += actual || 0; }
    };
    for (const c of clusters) { seen.add(c.clusterId); addRow(c, byId.get(c.clusterId)); }
    for (const i of items) if (!seen.has(i.clusterId)) addRow({ clusterId: i.clusterId, name: i.clusterName, agentStatus: i.clusterStatus || 'unknown', clusterStatus: i.clusterStatus, region: '', providerType: '' }, i);

    // classic cost-reports savings in the SAME window — methodology diff vs the VR report
    const myRows = rows.filter((r) => r.orgId === org.id);
    for (let k = 0; k < myRows.length; k += 12) {
      await Promise.all(myRows.slice(k, k + 12).map(async (r) => {
        const cs = await call({
          path: `/v1/cost-reports/clusters/${r.clusterId}/savings?startTime=${encodeURIComponent(win.startTime)}&endTime=${encodeURIComponent(win.endTime)}`,
          orgId: org.id, timeoutMs: 15000,
        });
        r.classicStatus = cs.status;
        if (cs.status === 200 && cs.json?.summary) {
          r.classicSavings = Number(cs.json.summary.totalSavings);
          r.classicCost = Number(cs.json.summary.totalCost);
        }
      }));
    }

    perOrgTotals.set(org.id, {
      orgId: org.id, orgName: org.name, clusters: clusters.length,
      reportItems: items.length,
      wasSavings: orgNw, nodeSavings: orgNb, totalSavings: orgNa, actualCost: orgNact,
    });
  }

  while (idx < orgs.length) {
    const wave = orgs.slice(idx, idx + 8);
    await Promise.all(wave.map(oneOrg));
    idx += 8;
  }

  const totals = perOrgTotals.values().reduce((a, t) => ({
    clusters: a.clusters + t.clusters, reportItems: a.reportItems + t.reportItems,
    wasSavings: a.wasSavings + t.wasSavings, nodeSavings: a.nodeSavings + t.nodeSavings,
    totalSavings: a.totalSavings + t.totalSavings, actualCost: a.actualCost + t.actualCost,
  }), { clusters: 0, reportItems: 0, wasSavings: 0, nodeSavings: 0, totalSavings: 0, actualCost: 0 });

  const caseCounts = rows.reduce((a, r) => ((a[r.caseId] = (a[r.caseId] || 0) + 1), a), {});
  return {
    window: win, fetchedAtUtc: new Date().toISOString(),
    organizations: orgs, orgsReached: perOrgTotals.size ? [...perOrgTotals.values()] : [],
    orgErrors, rows, totals, caseCounts,
    provenance: {
      savings: 'POST reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport?startTime&endTime → items[].cost.{workloadAutoscalerSavings,autoscalerSavings,totalSavings,actualCost}',
      flags: 'same response → items[].woopAdopted / autoscalerAdopted / baselineType / clusterStatus',
      fleet: 'GET /v1/kubernetes/external-clusters (org-scoped) → items[].name/agentStatus/region/providerType',
    },
  };
}

/* ---------- drill-down probes (live, per cluster) ---------- */
async function clusterDetail(orgId, clusterId) {
  const [bp, nodes, was, classic] = await Promise.all([
    call({ path: `/reporting/v1beta/organizations/${orgId}/clusters/${clusterId}/baseline-params`, orgId }),
    call({ path: `/v1/kubernetes/external-clusters/${clusterId}/nodes`, orgId }),
    call({ path: `/v1/workload-autoscaling/clusters/${clusterId}/workloads-summary`, orgId }),
    call({ path: `/v1/cost-reports/clusters/${clusterId}/savings`, orgId }),
  ]);
  const out = { probes: {} };
  // baseline-params
  if (bp.status === 200 && bp.json) {
    const j = bp.json; const cpu = j.cpuParams || j.cpu || {}; const mem = j.memoryParams || j.memory || {};
    out.probes.baseline = {
      status: 200, signal: 'baseline exists',
      type: j.baselineType, start: j.baselinePeriodStartTime, end: j.baselinePeriodEndTime,
      cpuFactor: cpu.overprovisioningFactor ?? j.cpuOverprovisioningFactor ?? null,
      ramFactor: mem.overprovisioningFactor ?? j.memoryOverprovisioningFactor ?? null,
      cpuPrice: cpu.costPerCpuCoreHourly ?? j.costPerCpuCoreHourly ?? null,
      ramPrice: mem.costPerMemoryGibHourly ?? j.costPerMemoryGibHourly ?? null,
    };
  } else if (bp.status === 404) out.probes.baseline = { status: 404, signal: 'no baseline — cluster has none (normal for WAS-only)' };
  else out.probes.baseline = { status: bp.status, signal: bp.snippet };
  // nodes
  if (nodes.status === 200 && nodes.json) {
    const list = nodes.json.items || nodes.json.nodes || [];
    const managed = list.filter((n) => (n.labels || {})['provisioner.cast.ai/managed-by'] === 'cast.ai').length;
    const karp = list.filter((n) => Object.keys(n.labels || {}).some((k) => k.startsWith('karpenter.sh'))).length;
    out.probes.nodes = { status: 200, total: list.length, castManaged: managed, karpenter: karp, sharePct: list.length ? +(100 * managed / list.length).toFixed(1) : null };
  } else out.probes.nodes = { status: nodes.status, signal: nodes.snippet };
  // was summary
  if (was.status === 200 && was.json) {
    const j = was.json;
    out.probes.workloads = {
      status: 200, total: j.totalCount ?? j.totalWorkloadsCount ?? null, optimized: j.optimizedCount ?? null,
      cpuOriginal: j.originalRequestedCpuCores ?? null, cpuNow: j.requestedCpuCores ?? null,
      cpuRecommended: j.recommendedCpuCores ?? null,
      ramOriginalGiB: j.originalRequestedMemoryGibs ?? j.originalRequestedMemoryGiB ?? null,
      ramNowGiB: j.requestedMemoryGibs ?? j.requestedMemory ?? null,
      ramRecommendedGiB: j.recommendedMemory ?? null,
      apiManaged: j.apiManagedCount ?? null, annotationManaged: j.annotationManagedCount ?? null,
    };
  } else if (was.status === 400) out.probes.workloads = { status: 400, signal: 'WAS agent not installed (or not enabled) on this cluster' };
  else out.probes.workloads = { status: was.status, signal: was.snippet };
  // classic savings
  if (classic.status === 200 && classic.json) {
    const j = classic.json;
    out.probes.classicSavings = { status: 200, autoscalerSavings: j.summary?.autoscalerSavings ?? j.autoscalerSavings ?? null, note: 'classic methodology — may diverge from value-realization' };
  } else if (classic.status === 400) out.probes.classicSavings = { status: 400, signal: 'cluster is read-only → node track OFF (machine signal for Case B)' };
  else out.probes.classicSavings = { status: classic.status, signal: classic.snippet };
  return out;
}

/* ---------- Case-E transition scan (org timeline, 12m) ---------- */
async function orgTimeline(orgId, startTime, endTime) {
  try {
    const r = await call({
      method: 'POST',
      path: `/reporting/v1beta/organizations/${orgId}:runValueRealizationTimelineReport?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&step=ONE_MONTH`,
      orgId, body: {},
    });
    if (r.status === 200 && r.json) return r.json;
    return { __status: r.status, __snippet: r.snippet };
  } catch (e) { return { __status: -1, __snippet: String(e && e.message || e) }; }
}

async function transitionScan(orgIds) {
  const end = new Date();
  const start = new Date(end.getTime() - 359 * 86400 * 1000);
  const out = [];
  let i = 0;
  while (i < orgIds.length) {
    const wave = orgIds.slice(i, i + 8);
    await Promise.all(wave.map(async (o) => {
      const j = await orgTimeline(o.id, iso(start), iso(end));
      const items = j.timelineItems || [];
      const monthOf = (it) => (it.startTime || it.start || it.timestamp || '').slice(0, 7);
      const first = (pred) => { const m = items.find(pred); return m ? { month: monthOf(m), was: m.cost?.workloadAutoscalerSavings || 0, node: m.cost?.autoscalerSavings || 0 } : null; };
      const firstWas = first((m) => (m.cost?.workloadAutoscalerSavings || 0) > 0);
      const firstNode = first((m) => (m.cost?.autoscalerSavings || 0) > 0);
      out.push({
        orgId: o.id, orgName: o.name, points: items.length,
        status: j.__status || 200, snippet: j.__status ? j.__snippet : undefined,
        firstWasMonth: firstWas?.month || null, firstNodeMonth: firstNode?.month || null,
        patternE: !!(firstWas && firstNode && firstWas.month < firstNode.month),
      });
    }));
    i += 8;
  }
  return { window: { startTime: iso(start), endTime: iso(end) }, orgs: out };
}

/* ---------- http server ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'application/json') => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': MIME[type] || type, 'Cache-Control': 'no-store' });
    res.end(data);
  };
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(200, readFileSync(join(ROOT, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/api/config') {
      return send(200, { apiBase: API_BASE, port: PORT, readOnly: true, keyPresent: true });
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      let body = ''; for await (const ch of req) body += ch;
      const args = body ? JSON.parse(body) : {};
      const windowDays = Number(args.windowDays || 30);
      const startDate = typeof args.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.startDate) ? args.startDate : null;
      const endDate = typeof args.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.endDate) ? args.endDate : null;
      if ((startDate && !endDate) || (!startDate && endDate)) return send(400, { error: 'both startDate and endDate required for a custom window' });
      if (startDate && endDate) {
        try { computeCustomWindow(startDate, endDate); } catch (e) { return send(400, { error: e.message }); }
      }
      const orgIds = Array.isArray(args.orgIds) ? args.orgIds : null;
      const cacheKey = `${startDate ? `${startDate}→${endDate}` : windowDays + 'd'}|${(orgIds || []).join(',') || 'ALL'}`;
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return send(200, { jobId: null, cached: true, result: hit.result });
      const jobId = `job-${Date.now()}`;
      const job = { id: jobId, status: 'running', total: 0, done: 0, progress: { current: 'starting' }, startedAt: Date.now() };
      jobs.set(jobId, job);
      sweep(job, { windowDays, startDate, endDate, orgIds })
        .then((result) => { job.status = 'done'; job.result = result; cache.set(cacheKey, { ts: Date.now(), result }); })
        .catch((e) => { job.status = 'failed'; job.error = String(e && e.message || e); });
      return send(200, { jobId });
    }
    const jobMatch = url.pathname.match(/^\/api\/job\/(.+)$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(404, { error: 'unknown job' });
      return send(200, job);
    }
    if (url.pathname === '/api/cluster-detail') {
      const orgId = url.searchParams.get('orgId'); const clusterId = url.searchParams.get('clusterId');
      if (!orgId || !clusterId) return send(400, { error: 'orgId and clusterId required' });
      return send(200, await clusterDetail(orgId, clusterId));
    }
    if (url.pathname === '/api/transitions' && req.method === 'POST') {
      let body = ''; for await (const ch of req) body += ch;
      const args = body ? JSON.parse(body) : {};
      let orgIds = Array.isArray(args.orgIds) && args.orgIds.length ? args.orgIds : null;
      if (!orgIds) {
        const warm = [...cache.values()].map((c) => c.result).find((r) => r?.organizations);
        orgIds = warm ? warm.organizations.map((o) => o.id) : [];
      }
      const nameIdx = new Map();
      const warmRes = [...cache.values()].map((c) => c.result).find((r) => r?.organizations);
      (warmRes?.organizations || []).forEach((o) => nameIdx.set(o.id, o.name));
      const result = await transitionScan(orgIds.map((id) => ({ id, name: nameIdx.get(id) || id.slice(0, 8) })));
      return send(200, result);
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    return send(500, { error: String(e && e.message || e) });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`dashboard → http://127.0.0.1:${PORT}  (read-only; CTRL+C to stop)`));
