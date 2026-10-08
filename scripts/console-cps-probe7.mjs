import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', { channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 } });
let page = ctx.pages()[0] || await ctx.newPage();
await page.goto(`https://console.eu.cast.ai/automation/external-clusters/${TEST}/cost-report/savings-report?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await sleep(9000);
const r = await page.evaluate(() => {
  const out = { monthEls: 0, samples: [], shadowHosts: [], toolbar: '' };
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/month/i.test(t) && t.length < 150) { out.monthEls++; if (out.samples.length < 6) out.samples.push(`${el.tagName}.${String(el.className).slice(0,40)} :: ${t.slice(0,60)}`); }
    if (el.shadowRoot) out.shadowHosts.push(el.tagName + '.' + String(el.className).slice(0, 50));
  }
  // what's at the top-center of the page (where OCR shows the control)
  const el = document.elementFromPoint(window.innerWidth * 0.5, 130) || document.elementFromPoint(window.innerWidth * 0.55, 130);
  if (el) { let n = el; const chain = []; for (let d = 0; d < 6 && n; d++) { chain.push(`<${n.tagName.toLowerCase()} class=${String(n.className).slice(0,60)}> "${(n.textContent||'').replace(/\s+/g,' ').trim().slice(0,50)}"`); n = n.parentElement; } out.toolbar = chain.join(' <- '); }
  return out;
});
console.log(JSON.stringify(r, null, 1).slice(0, 3000));
await page.screenshot({ path: '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z/18-probe2.png' });
await ctx.close(); process.exit(0);
