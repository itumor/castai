// Round 6: frame-aware date-range probe + August selection.
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

async function findMonthFrame(id) {
  for (const f of page.frames()) {
    try {
      const box = await f.evaluate(() => {
        const els = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (w.nextNode()) {
          const el = w.currentNode;
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (/^This month/.test(t) && t.length < 120) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) els.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: t.slice(0, 50), x: r.x, y: r.y, wd: r.width, h: r.height });
          }
        }
        return els.slice(-4);
      }).catch(() => null);
      if (box && box.length) { console.log('FRAME_HIT', f.url().slice(0, 110), JSON.stringify(box)); return { frame: f, box: box[box.length - 1] }; }
    } catch {}
  }
  return null;
}

async function setAugust(hit, tag) {
  const f = hit.frame;
  // click the range control inside its frame
  await f.evaluate(({ x, y, wd, h }) => {
    const el = document.elementFromPoint(x + wd / 2, y + h / 2);
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, hit.box);
  await sleep(2000);
  // dump what appeared (in all frames + main)
  for (const fr of page.frames()) {
    const menu = await fr.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (w.nextNode()) {
        const el = w.currentNode;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(August|September|July|Last (7|30) days|Last month|This month|Custom( range)?|Month to date)$/i.test(t) && t.length < 30) {
          const r = el.getBoundingClientRect();
          if (r.width > 0) out.push({ t, x: r.x + r.width / 2, y: r.y + r.height / 2 });
        }
      }
      return out.slice(0, 12);
    }).catch(() => []);
    if (menu.length) {
      console.log('MENU_ITEMS', fr.url().slice(0, 60), JSON.stringify(menu));
      // prefer August; else Last month
      for (const m of menu) if (/^August$/i.test(m.t)) { await fr.mouse.click(m.x, m.y).catch(() => {}); console.log('CLICKED_AUGUST'); await sleep(1500); return 'august'; }
      for (const m of menu) if (/^Custom/i.test(m.t)) { await fr.mouse.click(m.x, m.y).catch(() => {}); await sleep(1500); return 'custom'; }
      for (const m of menu) if (/^Last month$/i.test(m.t)) { await fr.mouse.click(m.x, m.y).catch(() => {}); console.log('CLICKED_LAST_MONTH'); await sleep(1500); return 'lastmonth'; }
    }
  }
  return 'none';
}

for (const [tag, id] of [['test', TEST], ['main', MAIN]]) {
  await page.goto(`${BASE}/automation/external-clusters/${id}/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(10000);
  const rej = page.getByRole('button', { name: /^Reject$/i }).first();
  if (await rej.count().catch(() => 0)) await rej.click().catch(() => {});
  console.log('FRAMES', page.frames().length, page.frames().map(f => f.url().slice(0, 80)).join(' || '));
  const hit = await findMonthFrame(id);
  if (!hit) { console.log('NO_MONTH_CONTROL', tag); await page.screenshot({ path: `${OUT}/16-${tag}-noctl.png` }); continue; }
  const r = await setAugust(hit, tag);
  console.log('RANGE_RESULT', tag, r);
  if (r !== 'none') {
    await settle(10000);
    await page.screenshot({ path: `${OUT}/17-${tag}-august.png` });
    console.log('AUGUST_SHOT', tag);
  }
}
console.log('DONE-R6');
await ctx.close(); process.exit(0);
