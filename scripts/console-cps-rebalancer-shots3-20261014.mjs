// Pass 3 — CPS rebalancer console evidence: row chevron -> drawer for 5e132d41 (c8in plan)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG  = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const BASE = 'https://console.eu.cast.ai';
const OUT  = '/Users/eramadan/castai/.kimchi/docs/2026-10-14-cps-rebalancer-rca/console-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-3', {
  channel: 'chrome', headless: false,
  viewport: { width: 1680, height: 1050 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();

const logUrl = `${BASE}/automation/external-clusters/${MAIN}/rebalance/list/log?org=${ORG}`;
await page.goto(logUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await sleep(6000);

// cookie handling: "Reject" then "Save my preferences" if the customize panel opened
for (const label of ['Reject all', 'Reject', 'Save my preferences', 'Accept all']) {
  try {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count()) { await b.click({ timeout: 3000 }); await sleep(1200); console.log('COOKIE_CLICK', label); break; }
  } catch {}
}
try {
  const save = page.locator('button:has-text("Save my preferences")').first();
  if (await save.count()) { await save.click({ timeout: 3000 }); await sleep(1200); console.log('COOKIE_SAVED_PREFS'); }
} catch {}

async function openDrawer(prefix, name) {
  await page.goto(logUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await sleep(5000);
  // click the ">" chevron cell of the row containing the id
  const row = page.locator(`tr:has-text("${prefix}")`).first();
  if (!(await row.count())) { console.log('ROW_NOT_FOUND', prefix); return; }
  const lastCell = row.locator('td').last();
  if (await lastCell.count()) await lastCell.click().catch(() => {});
  else await row.click().catch(() => {});
  await sleep(6000);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  console.log('URL_AFTER_CLICK', prefix, page.url());
  await page.screenshot({ path: `${OUT}/${name}-drawer.png`, fullPage: true });
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 5000));
  writeFileSync(`${OUT}/${name}-drawer.txt`, txt);
  console.log('DRAWER_SHOT', name);
}

await openDrawer('5e132d41', '06-plan-5e132d41-c8in');
await openDrawer('d44d1095', '07-plan-d44d1095-negative');

console.log('DONE3');
await sleep(2000);
await ctx.close();
process.exit(0);
