// Round 3: efficiency tab (realized savings view) per cluster.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

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

async function shot(name, url, extraWait = 14000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await sleep(extraWait);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    const txt = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.slice(0, 4000));
    writeFileSync(`${OUT}/${name}.txt`, txt);
    console.log('SHOT_OK', name);
  } catch (e) { console.log('SHOT_FAIL', name, String(e).slice(0, 100)); }
}

await shot('SNAP-10-helios-efficiency', `${BASE}/automation/external-clusters/${HELIOS}/cost-report/cluster/efficiency?${orgQ}`);
await shot('SNAP-11-integ-efficiency',  `${BASE}/automation/external-clusters/${INTEG}/cost-report/cluster/efficiency?${orgQ}`);
await shot('SNAP-12-kronos-efficiency', `${BASE}/automation/external-clusters/${KRONOS}/cost-report/cluster/efficiency?${orgQ}`);
console.log('DONE');
await ctx.close();
process.exit(0);
