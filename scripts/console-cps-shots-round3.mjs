// Round 3: Savings Report deep-dive — August range + per-cluster scope.
import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();
async function settle(ms = 6000) { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await sleep(ms); }
async function shot(name, w = 5000) { await sleep(w); await page.screenshot({ path: `${OUT}/${name}.png` }).catch(e => console.log('SHOT_FAIL', name)); console.log('SHOT_OK', name, '|', page.url()); }
async function clickText(re, idx = 0, timeout = 4000) {
  const loc = page.getByText(re, { exact: false }).nth(idx);
  if (await loc.count().catch(() => 0)) { await loc.click({ timeout }).catch(e => console.log('CLICK_FAIL', re, String(e).slice(0, 80))); return true; }
  console.log('NO_TEXT', re); return false;
}

await page.goto(`${BASE}/automation/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(9000);
// dismiss cookie banner if present
const rej = page.getByRole('button', { name: /^Reject$/i }).first();
if (await rej.count().catch(() => 0)) await rej.click().catch(() => {});
await shot('06-savings-default'); // reference: This month, all clusters

// --- try to switch range to August ---
// open the range control (label like "This month GMT +03:00")
const opened = await clickText(/This month/i) || await clickText(/GMT \+03/i);
await sleep(1500);
await shot('06b-daterange-open', 500); // debug: what does the picker look like?
// try common option labels
const picked = await clickText(/^Last month$/i) || await clickText(/^August$/i) || await clickText(/Previous month/i) || await clickText(/^Custom range$/i) || await clickText(/^Custom$/i);
if (picked) { await sleep(1500); await shot('06c-daterange-picked', 500); }
// if a custom-range form appeared, try filling date inputs
const inputs = page.locator('input[type=text], input[type=date], input:not([type])');
const n = await inputs.count().catch(() => 0);
console.log('INPUTS_VISIBLE', n);
if (picked && n > 0) {
  try {
    await inputs.nth(0).click({ timeout: 2000 }); await inputs.nth(0).fill('2026-08-01').catch(() => {});
    if (n > 1) { await inputs.nth(1).click({ timeout: 2000 }); await inputs.nth(1).fill('2026-08-31').catch(() => {}); }
    await page.keyboard.press('Enter').catch(() => {});
    await clickText(/^Apply$/i) || await clickText(/^Save$/i) || await clickText(/^OK$/i);
  } catch (e) { console.log('FILL_FAIL', String(e).slice(0, 100)); }
}
await settle(10000);
await shot('07-savings-august');

// --- scope: test cluster only ---
await clickText(/Adjust scope/i); await sleep(2000);
await shot('07b-scope-open', 500);
// click main cluster checkbox/label to deselect; fall back to clicking its row
const desel = await clickText(/dema-platform-services$/i) || await clickText(/dema-platform-services(?!-test)/i);
await sleep(500);
await clickText(/^Apply$/i) || await clickText(/^Save$/i) || await clickText(/^Confirm$/i);
await settle(10000);
await shot('08-savings-test-only');

// --- scope: main cluster only (re-open, reselect main, deselect test) ---
await clickText(/Adjust scope/i); await sleep(2000);
await clickText(/dema-platform-services$/i); await sleep(300);
await clickText(/dema-platform-services-test/i); await sleep(300);
await clickText(/^Apply$/i) || await clickText(/^Save$/i) || await clickText(/^Confirm$/i);
await settle(10000);
await shot('09-savings-main-only');

// --- back to all clusters, range Last 30 days for the 30d proof ---
await clickText(/Adjust scope/i); await sleep(2000);
await clickText(/dema-platform-services-test/i); await sleep(300);
await clickText(/^Apply$/i) || await clickText(/^Reset$/i) || await clickText(/^Select all$/i);
await settle(3000);
await clickText(/August|Last month|This month|Custom/i); await sleep(1500);
await clickText(/^Last 30 days$/i) || await clickText(/30 days/i);
await settle(10000);
await shot('10-savings-last30d-all');

console.log('DONE-R3');
await sleep(2000); await ctx.close(); process.exit(0);
