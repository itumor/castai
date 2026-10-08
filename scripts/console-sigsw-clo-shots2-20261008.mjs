// Round 2: correct routes for SI GSW CLO evidence snapshots.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const ORG = '07aa3c29-3e1f-44bc-ad60-ceedb878d99a';
const HELIOS = '419c39e4-66bf-4d61-b833-4562968a61c7';
const INTEG  = '1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f';
const KRONOS = '6d20eb8e-a1e5-4411-b4c8-5346ac3291b0';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/savings-sigsw-snapshots-20261008';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const orgQ = `org=${ORG}`;

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false,
  viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();

async function shot(name, url, extraWait = 12000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await sleep(extraWait);
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
      const txt = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.slice(0, 4000));
      (await import('node:fs')).writeFileSync(`${OUT}/${name}.txt`, txt);
      console.log('SHOT_OK', name);
      return;
    } catch (e) {
      const msg = String(e).slice(0, 120);
      if (/closed/.test(msg) && attempt === 1) { page = ctx.pages()[0] || await ctx.newPage(); continue; }
      console.log('SHOT_FAIL', name, msg);
      return;
    }
  }
}

await shot('SNAP-02-helios-dashboard',   `${BASE}/automation/external-clusters/${HELIOS}/dashboard?${orgQ}`);
await shot('SNAP-03-helios-avail-savings', `${BASE}/automation/external-clusters/${HELIOS}/available-savings?${orgQ}`, 14000);
await shot('SNAP-04-integ-avail-savings',  `${BASE}/automation/external-clusters/${INTEG}/available-savings?${orgQ}`, 14000);
await shot('SNAP-05-kronos-avail-savings', `${BASE}/automation/external-clusters/${KRONOS}/available-savings?${orgQ}`, 14000);
await shot('SNAP-06-helios-cost-report',   `${BASE}/automation/external-clusters/${HELIOS}/cost-report?${orgQ}`, 14000);
await shot('SNAP-07-integ-cost-report',    `${BASE}/automation/external-clusters/${INTEG}/cost-report?${orgQ}`, 14000);
await shot('SNAP-08-org-overview',         `${BASE}/automation/overview?${orgQ}`, 12000);
await shot('SNAP-09-org-cost-report',      `${BASE}/automation/cost-report?${orgQ}`, 14000);

console.log('DONE');
await sleep(2000);
await ctx.close();
process.exit(0);
