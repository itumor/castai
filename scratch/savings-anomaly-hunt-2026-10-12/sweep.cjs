#!/usr/bin/env node
// Read-only hunt: for a slice of CAST AI orgs, list clusters and compute
// last-7d classic realized savings (summary.totalSavings / totalCost) per cluster.
// Usage: node sweep.cjs <sliceIndex> <numSlices>
// Env:  CASTAI_API_KEY (required)
// Output: TSV rows to stdout: orgName\tclusterName\tclusterId\tfirstOp\tcost7d\tsavings7d\tsavPerDay\tcostPerDay\tratio
const BASE = 'https://api.eu.cast.ai';
const KEY = process.env.CASTAI_API_KEY;
if (!KEY) { console.error('CASTAI_API_KEY missing'); process.exit(1); }
const slice = parseInt(process.argv[2] || '0', 10);
const nslices = parseInt(process.argv[3] || '1', 10);

async function get(path, orgId) {
  const h = { 'X-API-Key': KEY, 'Accept': 'application/json' };
  if (orgId) h['X-CastAI-Organization-Id'] = orgId;
  const res = await fetch(BASE + path, { headers: h });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { if (i === tries - 1) throw e; await sleep(500 * (i + 1)); }
  }
}

const end = new Date(); end.setUTCHours(0, 0, 0, 0);
const start = new Date(end.getTime() - 7 * 864e5);
const st = start.toISOString(), en = end.toISOString();

(async () => {
  const orgs = (await withRetry(() => get('/v1/organizations'))).organizations || [];
  const mine = orgs.filter((_, i) => i % nslices === slice);
  for (const org of mine) {
    let clusters;
    try {
      clusters = await withRetry(() => get('/v1/kubernetes/external-clusters', org.id));
    } catch (e) { console.error(`# orgfail ${org.name}: ${e.message}`); continue; }
    const items = clusters.items || clusters.clusters || clusters || [];
    if (!Array.isArray(items) || items.length === 0) continue;
    for (const c of items) {
      const id = c.id, name = c.name || c.clusterName || '?';
      let row = `${org.name}\t${name}\t${id}\t${c.firstOperationAt || '-'}`;
      try {
        const s = await withRetry(() =>
          get(`/v1/cost-reports/clusters/${id}/savings?startTime=${encodeURIComponent(st)}&endTime=${encodeURIComponent(en)}`, org.id));
        const cost = parseFloat(s.summary?.totalCost ?? 'NaN');
        const sav = parseFloat(s.summary?.totalSavings ?? 'NaN');
        const cpd = cost / 7, spd = sav / 7;
        const ratio = (isFinite(cpd) && cpd > 0) ? (spd / cpd) : NaN;
        console.log(`${row}\t${cost.toFixed(2)}\t${sav.toFixed(2)}\t${spd.toFixed(2)}\t${cpd.toFixed(2)}\t${isFinite(ratio) ? ratio.toFixed(2) : 'NA'}`);
      } catch (e) {
        console.log(`${row}\tERR\t${e.message}\t-\t-\t-`);
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
