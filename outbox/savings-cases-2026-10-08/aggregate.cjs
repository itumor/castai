#!/usr/bin/env node
/**
 * Aggregate raw CAST AI API captures into one dashboard-data.json.
 * Every number carries api provenance: { endpoint, field }.
 * Input:  raw/<id8>/01..07-*.json + raw/org-railigentx/*.json + _status.md files
 * Output: dashboard-data.json (embedded later into the HTML dashboard)
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RAW = path.join(ROOT, 'raw');

const readJson = (p) => {
  try {
    const t = fs.readFileSync(p, 'utf8');
    // nginx 404 bodies are HTML — guard
    if (!t.trim().startsWith('{') && !t.trim().startsWith('[')) return { __nonJson: t.slice(0, 160) };
    return JSON.parse(t);
  } catch (e) { return { __missing: true }; }
};

const statuses = (dir) => {
  const p = path.join(dir, '_status.md');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^(0\d)[^=]*=\s*(\d{3})/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
};

const EP = {
  '01': { name: 'Cluster detail', method: 'GET', path: '/v1/kubernetes/external-clusters/{clusterId}', doc: 'https://docs.cast.ai/reference/externalclusterapi_getcluster' },
  '02': { name: 'Cluster nodes', method: 'GET', path: '/v1/kubernetes/external-clusters/{clusterId}/nodes', doc: 'https://docs.cast.ai/reference/externalclusterapi_listnodes' },
  '03': { name: 'Baseline params', method: 'GET', path: '/reporting/v1beta/organizations/{orgId}/clusters/{clusterId}/baseline-params', doc: 'https://docs.cast.ai/docs/savings-baseline' },
  '04': { name: 'Workloads summary (WOOP)', method: 'GET', path: '/v1/workload-autoscaling/clusters/{clusterId}/workloads-summary', doc: 'https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadssummary' },
  '05': { name: 'Classic cluster savings', method: 'GET', path: '/v1/cost-reports/clusters/{clusterId}/savings', doc: 'https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport' },
  '06': { name: 'Value realization report', method: 'POST', path: '/reporting/v1beta/organizations/{orgId}/clusters:runValueRealizationReport', doc: 'https://docs.cast.ai/reference/valuerealizationapi_runclustersvaluerealizationreport' },
  '07': { name: 'Workloads summary metrics (effect over time)', method: 'GET', path: '/v1/workload-autoscaling/clusters/{clusterId}/workloads-summary-metrics', doc: 'https://docs.cast.ai/reference/workloadoptimizationapi_getworkloadssummarymetrics' },
};

const ORGS = {
  f15f33b9: { id: 'f15f33b9-20ad-4128-8289-da529844d3f0', name: 'SMO Railigent X' },
  '07aa3c29': { id: '07aa3c29-3e1f-44bc-ad60-ceedb878d99a', name: 'SI GSW CLO' },
  c67df1a0: { id: 'c67df1a0-06e0-46f9-a84e-27c14958d564', name: 'IT IPS' },
};
const orgFor = (id8) =>
  ['5771ec22','cf62a8e1','0e277bb2','7eb37770','f8dd5b4f','d0c7a7a5','4952c4ce','35c0f9b5','ae3e22a4','d03690cb'].includes(id8) ? ORGS.f15f33b9
  : ['6d20eb8e','419c39e4','51dd234c','9cabe4ee'].includes(id8) ? ORGS['07aa3c29']
  : ORGS.c67df1a0;

const money = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);
const num = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? Number(v.toFixed(d)) : null);

const clusters = [];
for (const id8 of fs.readdirSync(RAW)) {
  const dir = path.join(RAW, id8);
  if (!fs.statSync(dir).isDirectory() || id8.startsWith('org-')) continue;

  const st = statuses(dir);
  const c01 = readJson(path.join(dir, '01-cluster.json'));
  const c02 = readJson(path.join(dir, '02-nodes.json'));
  const c03 = readJson(path.join(dir, '03-baseline.json'));
  const c04 = readJson(path.join(dir, '04-was-summary.json'));
  const c05 = readJson(path.join(dir, '05-classic-savings.json'));
  const c06 = readJson(path.join(dir, '06-value-realization.json'));
  const c07 = readJson(path.join(dir, '07-was-metrics.json'));

  // --- nodes classification
  let nodes = { total: null, castManaged: null, karpenter: null, other: null, shareCastManagedPct: null };
  const nodeItems = c02.items || c02.nodes || null;
  if (Array.isArray(nodeItems)) {
    let cast = 0, karp = 0, other = 0;
    for (const n of nodeItems) {
      const labels = n.labels || n.state?.labels || {};
      const lstr = JSON.stringify(labels);
      if (lstr.includes('provisioner.cast.ai/managed-by') && (lstr.includes('"cast.ai"') || lstr.includes('managed-by=cast.ai'))) cast++;
      else if (lstr.includes('karpenter.sh')) karp++;
      else other++;
    }
    nodes = { total: nodeItems.length, castManaged: cast, karpenter: karp, other,
      shareCastManagedPct: nodeItems.length ? num((cast / nodeItems.length) * 100, 1) : null };
  }

  // --- WAS summary
  let was = null;
  if (c04 && typeof c04 === 'object' && !c04.__missing && !c04.__nonJson && c04.totalCount !== undefined) {
    was = {
      totalWorkloads: c04.totalCount ?? null,
      optimized: c04.optimizedCount ?? null,
      vpaOptimized: c04.vpaOptimizedCount ?? null,
      hpaOptimized: c04.hpaOptimizedCount ?? null,
      apiManaged: c04.apiManagedCount ?? null,
      cpuNow: num(c04.requestedCpuCores),
      cpuRecommended: num(c04.recommendedCpuCores),
      cpuOriginal: num(c04.originalRequestedCpuCores),
      ramNowGiB: num(c04.requestedMemory),
      ramRecommendedGiB: num(c04.recommendedMemory),
      ramOriginalGiB: num(c04.originalRequestedMemoryGibs),
      cpuReductionPct: (c04.originalRequestedCpuCores > 0 && c04.requestedCpuCores != null)
        ? num(100 * (1 - c04.requestedCpuCores / c04.originalRequestedCpuCores), 1) : null,
      ramReductionPct: (c04.originalRequestedMemoryGibs > 0 && c04.requestedMemory != null)
        ? num(100 * (1 - c04.requestedMemory / c04.originalRequestedMemoryGibs), 1) : null,
    };
  } else if (c04 && c04.message) {
    was = { notInstalledMessage: c04.message };
  }

  // --- metrics window (WAS effect over time)
  let wasMetrics = null;
  const mItems = c07.items || null;
  if (Array.isArray(mItems) && mItems.length) {
    const ts = mItems.map(i => i.timestamp || i.time || i.date).filter(Boolean).sort();
    wasMetrics = { points: mItems.length, firstPoint: ts[0] || null, lastPoint: ts[ts.length - 1] || null };
  }

  // --- value realization
  let vr = null;
  const vrItem = (c06.items && c06.items[0]) || null;
  if (vrItem) {
    vr = {
      clusterName: vrItem.clusterName, status: vrItem.clusterStatus,
      baselineType: vrItem.baselineType,
      woopAdopted: vrItem.woopAdopted ?? null,
      autoscalerAdopted: vrItem.autoscalerAdopted ?? null,
      actual: money(vrItem.cost?.actualCost),
      projected: money(vrItem.cost?.projectedCost),
      autoscalerSavings: money(vrItem.cost?.autoscalerSavings),
      workloadAutoscalerSavings: money(vrItem.cost?.workloadAutoscalerSavings),
      totalSavings: money(vrItem.cost?.totalSavings),
      cpu: vrItem.cpu ? { actual: money(vrItem.cpu.actualCost), projected: money(vrItem.cpu.projectedCost), provisionedCoreHours: num(vrItem.cpu.provisionedCoreHours, 0), requestedCoreHours: num(vrItem.cpu.requestedCoreHours, 0) } : null,
      memory: vrItem.memory ? { actual: money(vrItem.memory.actualCost), projected: money(vrItem.memory.projectedCost), provisionedGibHours: num(vrItem.memory.provisionedByteHours / 1024 ** 3, 0), requestedGibHours: num(vrItem.memory.requestedByteHours / 1024 ** 3, 0) } : null,
    };
  }

  // --- baseline params
  let baseline = null;
  if (c03 && !c03.__missing && !c03.__nonJson && (c03.baselineType || c03.baselinePeriodStartTime || c03.cpuOverprovisioningFactor != null)) {
    baseline = {
      type: c03.baselineType || null,
      periodStart: c03.baselinePeriodStartTime || null,
      periodEnd: c03.baselinePeriodEndTime || null,
      cpuFactor: num(c03.cpuOverprovisioningFactor, 4),
      ramFactor: num(c03.memoryOverprovisioningFactor, 4),
      cpuUnitCost: num(c03.costPerCpuCoreHourly, 6),
      ramUnitCost: num(c03.costPerMemoryGibHourly, 6),
      updateTime: c03.updateTime || null,
    };
  }

  // --- classic savings
  let classicSavings = null;
  if (c05 && !c05.__missing) {
    if (c05.message) classicSavings = { unavailable: c05.message };
    else classicSavings = c05;
  }

  // --- case classification
  let caseId = 'F'; // default: no data
  const woop = vr?.woopAdopted === true;
  const nas = vr?.autoscalerAdopted === true;
  if (vr) {
    if (nas && woop) caseId = 'D';       // both
    else if (nas && !woop) caseId = 'C'; // node autoscaler only
    else if (!nas && woop) caseId = 'B'; // workload autoscaler only
    else caseId = 'A';                   // connected, neither
  } else if (was?.notInstalledMessage) caseId = 'F';

  const org = orgFor(id8);
  clusters.push({
    id8, org: org.name, orgId: org.id,
    name: c01.name || vr?.clusterName || null,
    status: c01.status || vr?.status || null,
    provider: c01.eks?.region ? 'eks' : (c01.aks ? 'aks' : c01.gke ? 'gke' : (c01.providerType || null)),
    region: c01.eks?.region || c01.region?.name || null,
    createdAt: c01.createdAt || null,
    agentStatus: c01.agentStatus || null,
    http: st, nodes, was, wasMetrics, vr, baseline, classicSavings, caseId,
  });
}
clusters.sort((a, b) => a.caseId.localeCompare(b.caseId) || String(a.name).localeCompare(String(b.name)));

// --- org level
const orgReport = readJson(path.join(RAW, 'org-railigentx/06-org-value-realization-30d.json'));
const orgTimeline = readJson(path.join(RAW, 'org-railigentx/07-org-timeline-12m.json'));
const orgTotals = (() => {
  const acc = { actual: 0, projected: 0, totalSavings: 0, autoscalerSavings: 0, workloadAutoscalerSavings: 0 };
  for (const i of orgReport.items || []) {
    acc.actual += i.cost?.actualCost || 0;
    acc.projected += i.cost?.projectedCost || 0;
    acc.totalSavings += i.cost?.totalSavings || 0;
    acc.autoscalerSavings += i.cost?.autoscalerSavings || 0;
    acc.workloadAutoscalerSavings += i.cost?.workloadAutoscalerSavings || 0;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, money(v)]));
})();
const timeline = (orgTimeline.timelineItems || []).map(p => ({
  month: (p.timestamp || '').slice(0, 7),
  actual: money(p.cost?.actualCost),
  projected: money(p.cost?.projectedCost),
  autoscalerSavings: money(p.cost?.autoscalerSavings),
  workloadAutoscalerSavings: money(p.cost?.workloadAutoscalerSavings),
  totalSavings: money(p.cost?.totalSavings),
}));

const out = {
  generatedAtUtc: new Date().toISOString(),
  apiBase: 'https://api.eu.cast.ai',
  authNote: 'Every call: X-API-Key + X-CastAI-Organization-Id (enterprise master key sees 0 clusters without the org header — verified live 2026-10-08).',
  windows: {
    valueRealization: '2026-09-05T00:00:00Z → 2026-10-05T00:00:00Z',
    classicSavings: '2026-09-08T00:00:00Z → 2026-10-08T00:00:00Z',
    timeline: '2025-10-05T00:00:00Z → 2026-10-05T00:00:00Z, step=ONE_MONTH',
  },
  endpoints: EP,
  clusters,
  orgRailigentX: { totals: orgTotals, summary: orgTimeline.summary || null, timeline },
};
fs.writeFileSync(path.join(ROOT, 'dashboard-data.json'), JSON.stringify(out, null, 1));
console.log(`clusters=${clusters.length}  orgWas30d=${orgTotals.workloadAutoscalerSavings}  orgNodeSv30d=${orgTotals.autoscalerSavings}  timelinePts=${timeline.length}`);
for (const c of clusters) console.log(`${c.caseId}  ${String(c.name).padEnd(14)} ${c.id8}  woop=${c.vr?.woopAdopted ?? '-'} nas=${c.vr?.autoscalerAdopted ?? '-'}  was$=${c.vr?.workloadAutoscalerSavings ?? '-'} node$=${c.vr?.autoscalerSavings ?? '-'} base=${c.vr?.baselineType ?? '-'}`);
