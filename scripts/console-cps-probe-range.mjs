// Probe: find the date-range control DOM on the Savings Report page.
import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const BASE = 'https://console.eu.cast.ai';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 },
});
let page = ctx.pages()[0] || await ctx.newPage();
await page.goto(`${BASE}/automation/external-clusters/${TEST}/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await sleep(8000);

const info = await page.evaluate(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const hits = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    const t = (el.textContent || '').trim();
    if (/^This month/.test(t) && t.length < 60) { hits.push(el); }
  }
  const last = hits[hits.length - 1];
  if (last) {
    let n = last;
    for (let d = 0; d < 7 && n && n !== document.body; d++) {
      out.push(`depth${d}: <${n.tagName.toLowerCase()}> role=${n.getAttribute('role')} class=${String(n.className).slice(0, 90)} text=${(n.textContent || '').trim().slice(0, 40)}`);
      n = n.parentElement;
    }
  }
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => t && t.length < 50);
  return { chain: out, buttons: btns.slice(0, 40) };
});
console.log('CHAIN:\n' + info.chain.join('\n'));
console.log('BUTTONS:\n' + info.buttons.map(b => ' • ' + b).join('\n'));
await page.screenshot({ path: '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z/13-probe.png' });
await ctx.close(); process.exit(0);
