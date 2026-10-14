// Pass 4 — final console evidence: Optimization constraints page + clean plan log
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/.kimchi/docs/2026-10-14-cps-rebalancer-rca/console-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-3', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1050 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

async function dismissCookies() {
  for (const label of ['Reject', 'Save my preferences']) {
    try { const b = page.locator(`button:has-text("${label}")`).first();
      if (await b.count()) { await b.click({ timeout: 2500 }); await sleep(1200); console.log('COOKIE', label); } } catch {}
  }
}

// 1) Optimization constraints (template/constraints view in console)
for (const u of [
  `${BASE}/automation/external-clusters/${MAIN}/optimization-constraints?org=${ORG}`,
  `${BASE}/automation/external-clusters/${MAIN}/constraints?org=${ORG}`,
]) {
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await sleep(5000);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 400));
  if (!/404|not found/i.test(text)) {
    await dismissCookies();
    await page.screenshot({ path: `${OUT}/08-optimization-constraints.png`, fullPage: true });
    console.log('SHOT_OK 08-optimization-constraints', page.url());
    break;
  }
}

// 2) Clean full-page plan log (no cookie banner)
await page.goto(`${BASE}/automation/external-clusters/${MAIN}/rebalance/list/log?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
await sleep(5000);
await dismissCookies();
await sleep(1000);
await page.screenshot({ path: `${OUT}/01-rebalance-plan-log.png`, fullPage: true });
console.log('SHOT_OK 01-rebalance-plan-log clean');

console.log('DONE4');
await sleep(1500);
await ctx.close();
process.exit(0);
