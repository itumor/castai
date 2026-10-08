import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', { channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 } });
let page = ctx.pages()[0] || await ctx.newPage();
async function settle(ms = 8000) { await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}); await sleep(ms); }
async function pickPreset(label) {
  const hit = await page.evaluate(() => {
    for (const el of document.querySelectorAll('div, span, p, button')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(This|Last) month|^Last [0-9]+ days/.test(t) && t.length < 45) {
        const r = el.getBoundingClientRect(); if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  if (!hit) return false;
  await page.mouse.click(hit.x, hit.y); await sleep(1500);
  const item = await page.evaluate((want) => {
    for (const el of document.querySelectorAll('li, div[role=option], [class*=MenuItem i], [role=menuitem]')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t === want) { const r = el.getBoundingClientRect(); if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return null;
  }, label);
  if (!item) return false;
  await page.mouse.click(item.x, item.y); await sleep(1500); return true;
}
for (const [tag, url] of [
  ['org',   `${BASE}/automation/cost-report/savings-report?org=${ORG}`],
  ['main',  `${BASE}/automation/external-clusters/${MAIN}/cost-report/savings-report?org=${ORG}`],
  ['test',  `${BASE}/automation/external-clusters/${TEST}/cost-report/savings-report?org=${ORG}`],
]) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(10000);
  const rej = page.getByRole('button', { name: /^Reject$/i }).first();
  if (await rej.count().catch(() => 0)) await rej.click().catch(() => {});
  const ok = await pickPreset('Last 30 days');
  console.log('PRESET30', tag, ok);
  await settle(10000);
  await page.screenshot({ path: `${OUT}/22-${tag}-savings-last30d.png` });
  console.log('SHOT', tag);
}
console.log('DONE-R9');
await ctx.close(); process.exit(0);
