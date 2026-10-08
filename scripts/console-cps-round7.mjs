import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', { channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 } });
let page = ctx.pages()[0] || await ctx.newPage();
async function settle(ms = 7000) { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await sleep(ms); }
async function killCookie() {
  for (const t of ['Reject', 'Accept all']) {
    const b = page.getByRole('button', { name: new RegExp(`^${t}$`, 'i') }).first();
    if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); await sleep(700); }
  }
}
// find the month-select by scanning for elements whose text matches "^This month" OR a readonly input
async function clickMonthControl() {
  const hit = await page.evaluate(() => {
    const cand = [];
    for (const el of document.querySelectorAll('div, span, p, button, a, input')) {
      const t = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
      if (/^(This|Last) month/.test(t) && t.length < 45) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) cand.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, t });
      }
    }
    return cand.slice(-3);
  });
  console.log('MONTHCTL', JSON.stringify(hit));
  for (const h of hit) { await page.mouse.click(h.x, h.y); await sleep(1800); }
  return hit.length > 0;
}
async function dumpAndPick(tag) {
  await page.screenshot({ path: `${OUT}/19-${tag}-menu.png` });
  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('li, div[role=option], [class*=MenuItem], [class*=menuItem], [role=menuitem]')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 40) { const r = el.getBoundingClientRect(); if (r.width > 0) out.push({ t, x: r.x + r.width / 2, y: r.y + r.height / 2 }); }
    }
    return out.slice(-25);
  });
  console.log('MENU_ITEMS', JSON.stringify(items));
  for (const it of items) if (/^August/i.test(it.t)) { await page.mouse.click(it.x, it.y); await sleep(1500); return 'august'; }
  for (const it of items) if (/Custom/i.test(it.t)) { await page.mouse.click(it.x, it.y); await sleep(2000); return 'custom'; }
  return 'none';
}
async function customDates() {
  const ins = page.locator('input:visible');
  const n = await ins.count().catch(() => 0);
  console.log('INPUTS', n);
  const texts = [];
  for (let i = 0; i < Math.min(n, 6); i++) texts.push(await ins.nth(i).getAttribute('placeholder').catch(() => ''));
  console.log('PLACEHOLDERS', JSON.stringify(texts));
  try {
    if (n >= 1) { await ins.nth(0).click(); await page.keyboard.type('2026-08-01', { delay: 30 }); }
    if (n >= 2) { await ins.nth(1).click(); await page.keyboard.type('2026-08-31', { delay: 30 }); }
    await page.keyboard.press('Enter');
    const ap = page.getByRole('button', { name: /Apply|Done|OK|Save/i }).first();
    if (await ap.count().catch(() => 0)) await ap.click();
  } catch (e) { console.log('CUSTOM_ERR', String(e).slice(0, 80)); }
}
for (const [tag, id] of [['test', TEST], ['main', MAIN]]) {
  await page.goto(`${BASE}/automation/external-clusters/${id}/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(10000); await killCookie(); await sleep(1000);
  const ok = await clickMonthControl();
  console.log('OPENED', tag, ok);
  const pick = await dumpAndPick(tag);
  console.log('PICK', tag, pick);
  if (pick === 'custom') await customDates();
  await settle(10000);
  await page.screenshot({ path: `${OUT}/20-${tag}-august.png` });
  console.log('DONE', tag);
}
await ctx.close(); process.exit(0);
