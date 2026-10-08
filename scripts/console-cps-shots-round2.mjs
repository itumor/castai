// Round 2: targeted console proof — cookie bar dismiss + real sidebar routes.
// Same persistent profile (session already logged in). Read-only: navigation + screenshots.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();

async function settle(ms = 9000) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await sleep(ms);
}
async function dismissCookies() {
  for (const label of ['Reject', 'Reject all', 'Accept all']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
    if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); await sleep(800); return; }
  }
}
async function shot(name, extraWait = 6000) {
  await sleep(extraWait);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(e => console.log('SHOT_FAIL', name, String(e).slice(0, 100)));
  console.log('SHOT_OK', name, '|', page.url());
}

// 1) cluster list org=CPS, cookie-free
await page.goto(`${BASE}/automation/cluster-list?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(); await dismissCookies(); await settle(3000);
await shot('01-cluster-list');

// 2) per-cluster pages via sidebar link text
async function clusterPages(clusterId, tag) {
  await page.goto(`${BASE}/automation/external-clusters/${clusterId}/overview?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(); await dismissCookies();
  // dump sidebar hrefs for route truth
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map(a => `${(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)} -> ${a.getAttribute('href')}`).filter((v, i, arr) => arr.indexOf(v) === i).join('\n'));
  writeFileSync(`${OUT}/sidebar-${tag}.txt`, hrefs);
  for (const [label, name, wait] of [
    ['Dashboard', `${tag}-dashboard`, 9000],
    ['Cluster score', `${tag}-score`, 7000],
    ['Available savings', `${tag}-available-savings`, 9000],
    ['Workload autoscaler', `${tag}-workload-autoscaler`, 9000],
    ['Node autoscaler', `${tag}-node-autoscaler`, 9000],
  ]) {
    const link = page.getByRole('link', { name: new RegExp(`^${label}`, 'i') }).first();
    if (await link.count().catch(() => 0)) {
      await link.click().catch(() => {});
      await settle(wait); await shot(name);
    } else { console.log('NO_LINK', label, tag); }
  }
}
await clusterPages(MAIN, '02-main');
await clusterPages(TEST, '03-test');

// 3) org-level: Cost monitoring + hunt the Savings Report
await page.goto(`${BASE}/automation/cluster-list?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(); await dismissCookies();
const costMon = page.getByRole('link', { name: /^Cost monitoring/i }).first();
if (await costMon.count().catch(() => 0)) { await costMon.click().catch(() => {}); await settle(10000); await shot('04-org-cost-monitoring', 4000); }
// look for savings links anywhere in DOM now
const savingsHrefs = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /savings/i.test(h || '')));
console.log('SAVINGS_HREFS', JSON.stringify(savingsHrefs));
for (const h of savingsHrefs.slice(0, 3)) {
  const u = h.startsWith('http') ? h : `${BASE}${h}${h.includes('?') ? '&' : '?'}org=${ORG}`;
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await settle(10000);
  await shot(`05-savings-${savingsHrefs.indexOf(h)}`);
}
console.log('DONE-R2');
await sleep(2000); await ctx.close(); process.exit(0);
