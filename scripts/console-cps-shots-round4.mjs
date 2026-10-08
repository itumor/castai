// Round 4: August range on per-cluster Savings Reports (test + main).
import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();
async function settle(ms = 7000) { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await sleep(ms); }
async function shot(name, w = 5000) { await sleep(w); await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {}); console.log('SHOT_OK', name, '|', page.url()); }

async function openRangeMenu() {
  const candidates = [
    page.getByRole('button', { name: /This month|Last month|GMT/i }).first(),
    page.locator('button:has-text("This month"), [role="button"]:has-text("This month")').first(),
    page.locator('div:has(> button:has-text("GMT")), [class*="range" i] button').first(),
    page.locator('header button, [class*="header" i] button').nth(2),
  ];
  for (const c of candidates) {
    if (await c.count().catch(() => 0)) {
      await c.click({ timeout: 4000 }).catch(() => {});
      await sleep(1200);
      // did a menu/popover appear?
      const menus = page.locator('[role="menu"], [role="dialog"], [role="listbox"], [class*="popover" i], [class*="Popover" i], [class*="dropdown" i]');
      const cnt = await menus.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) {
        const t = (await menus.nth(i).innerText().catch(() => '')) || '';
        if (/month|day|range|GMT|August|September/i.test(t) && t.length < 3000) {
          console.log('MENU_FOUND >>>', t.replace(/\n+/g, ' | ').slice(0, 800));
          return menus.nth(i);
        }
      }
    }
  }
  console.log('MENU_NOT_FOUND');
  return null;
}

async function pickAugust() {
  // try preset/custom navigation inside any visible menu
  const tryClick = async (re) => {
    const el = page.getByText(re, { exact: false }).first();
    if (await el.count().catch(() => 0)) { await el.click({ timeout: 3000 }).catch(() => {}); await sleep(1200); return true; }
    return false;
  };
  if (await tryClick(/^Custom range$/i) || await tryClick(/^Custom$/i)) {
    // fill date fields
    const ins = page.locator('input[placeholder*="YYYY" i], input[type="text"], input[type="date"]');
    const n = await ins.count().catch(() => 0);
    console.log('CUSTOM_INPUTS', n);
    for (let i = 0; i < Math.min(n, 4); i++) {
      const v = i % 2 === 0 ? '2026-08-01' : '2026-08-31';
      await ins.nth(i).fill(v).catch(() => {});
    }
    await page.keyboard.press('Enter').catch(() => {});
    return (await tryClick(/^Apply$/i)) || (await tryClick(/^Done$/i)) || (await tryClick(/^OK$/i)) || true;
  }
  return false;
}

for (const [tag, id] of [['test', TEST], ['main', MAIN]]) {
  await page.goto(`${BASE}/automation/external-clusters/${id}/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(9000);
  const rej = page.getByRole('button', { name: /^Reject$/i }).first();
  if (await rej.count().catch(() => 0)) await rej.click().catch(() => {});
  await openRangeMenu();
  await shot(`11-${tag}-range-open`, 300);
  const ok = await pickAugust();
  console.log('PICK_AUGUST', tag, ok);
  await settle(10000);
  await shot(`12-${tag}-august`);
}
console.log('DONE-R4');
await sleep(2000); await ctx.close(); process.exit(0);
