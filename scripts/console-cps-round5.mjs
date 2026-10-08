// Round 5: coordinate-driven date-range probe — find GMT element, click it, dump popup, set August.
import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 },
});
let page = ctx.pages()[0] || await ctx.newPage();
async function settle(ms = 7000) { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await sleep(ms); }

async function findGmtBox() {
  return page.evaluate(() => {
    const els = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/GMT ?[+-]?/i.test(t) && t.length < 120 && /month|day|GMT/i.test(t)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) els.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: t.slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return els.slice(-6);
  });
}

async function clickGmt() {
  const boxes = await findGmtBox();
  console.log('GMT_BOXES', JSON.stringify(boxes));
  if (!boxes.length) return false;
  const b = boxes[boxes.length - 1];
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
  await sleep(1500);
  return true;
}

async function dumpPopupAndPick() {
  const pop = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('body > div')].map((d, i) => ({ i, t: (d.textContent || '').replace(/\s+/g, ' ').trim() })).filter(c => c.t.length > 0 && c.t.length < 4000);
    return cands.map(c => `#${c.i}: ${c.t.slice(0, 300)}`).slice(-8);
  });
  console.log('TOPLEVEL_DIVS', JSON.stringify(pop, null, 1).slice(0, 2500));
  // try clicking August or custom options by coordinates of text spans
  const target = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const found = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(August|Aug 2026|Last month|Previous month|Custom( range)?|September)$/i.test(t) && t.length < 25) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) found.push({ text: t, x: r.x + r.width / 2, y: r.y + r.height / 2 });
      }
    }
    return found;
  });
  console.log('PICK_TARGETS', JSON.stringify(target));
  for (const t of target) {
    if (/august|aug 2026/i.test(t.text)) { await page.mouse.click(t.x, t.y); await sleep(1200); return 'august'; }
  }
  for (const t of target) {
    if (/custom/i.test(t.text)) { await page.mouse.click(t.x, t.y); await sleep(1200); return 'custom'; }
  }
  for (const t of target) {
    if (/last month|previous month/i.test(t.text)) { await page.mouse.click(t.x, t.y); await sleep(1200); return 'lastmonth'; }
  }
  return 'none';
}

for (const [tag, id] of [['test', TEST], ['main', MAIN]]) {
  await page.goto(`${BASE}/automation/external-clusters/${id}/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(9000);
  const rej = page.getByRole('button', { name: /^Reject$/i }).first();
  if (await rej.count().catch(() => 0)) await rej.click().catch(() => {});
  await sleep(1000);
  const opened = await clickGmt();
  console.log('OPENED', tag, opened);
  await page.screenshot({ path: `${OUT}/14-${tag}-menu-open.png` });
  if (opened) {
    const pick = await dumpPopupAndPick();
    console.log('PICK', tag, pick);
    if (pick === 'custom') {
      // try to set dates via inputs
      const ins = page.locator('input:visible');
      const n = await ins.count().catch(() => 0);
      console.log('CUSTOM_INPUTS', n);
      try {
        if (n >= 1) { await ins.nth(0).click({ timeout: 1500 }); await ins.nth(0).fill('2026-08-01').catch(() => {}); }
        if (n >= 2) { await ins.nth(1).click({ timeout: 1500 }); await ins.nth(1).fill('2026-08-31').catch(() => {}); }
        await page.keyboard.press('Enter');
        const apply = page.getByRole('button', { name: /Apply|Done|OK/i }).first();
        if (await apply.count().catch(() => 0)) await apply.click().catch(() => {});
      } catch {}
    }
    await settle(10000);
    await page.screenshot({ path: `${OUT}/15-${tag}-range-set.png` });
    console.log('RANGE_SET_SHOT', tag);
  }
}
console.log('DONE-R5');
await ctx.close(); process.exit(0);
