#!/usr/bin/env node
// Read-only deep dive for ONE cluster: baseline-params, VR report (7d), classic
// savings items (7d), workloads-summary (WOOP). Prints a compact JSON to stdout.
// Usage: node deepdive.cjs <orgId> <clusterId>
const BASE = 'https://api.eu.cast.ai';
const KEY = process.env.CASTAI_API_KEY;
const [orgId, clusterId] = process.argv.slice(2);
if (!KEY || !orgId || !clusterId) { console.error('usage: CASTAI_API_KEY=.. node deepdive.cjs <orgId> <clusterId>'); process.exit(1); }

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-API-Key': KEY, 'X-CastAI-Organization-Id': orgId, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 500) }; }
  return { status: res.status, body: j };
}

const end = new Date(); end.setUTCHours(0, 0, 0, 0);
const start = new Date(end.getTime() - 7 * 864e5);
const st = start.toISOString(), en = end.toISOString();

(async () => {
  const out = { window: { st, en } };
  out.baselineParams = await req('GET', `/reporting/v1beta/organizations/${orgId}/clusters/${clusterId}/baseline-params`);
  out.vr = await req('POST', `/reporting/v1beta/organizations/${orgId}/clusters:runValueRealizationReport?startTime=${encodeURIComponent(st)}&endTime=${encodeURIComponent(en)}`, { clusterIds: [clusterId] });
  out.classic = await req('GET', `/v1/cost-reports/clusters/${clusterId}/savings?startTime=${encodeURIComponent(st)}&endTime=${encodeURIComponent(en)}&stepSeconds=86400`);
  out.woopSummary = await req('GET', `/v1/workload-autoscaling/clusters/${clusterId}/workloads-summary`);
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
