// Discover real console routes for the 3 NGM clusters, then screenshot correct pages.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG = '07aa3c29-3e1f-44bc-ad60-ceedb878d99a';
const HELIOS = '419c39e4-66bf-4d61-b833-4562968a61c7';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/savings-sigsw-snapshots-20261008';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', headless: false,
  viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

await page.goto(`${BASE}/automation/external-clusters/${HELIOS}/dashboard?org=${ORG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
// dump ALL links on the page (cluster sidebar routes)
const dump = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].map(a => `${(a.textContent || '').trim().replace(/\s+/g,' ').slice(0, 50)} -> ${a.getAttribute('href')}`)
    .filter((v, i, arr) => arr.indexOf(v) === i).join('\n'));
writeFileSync(`${OUT}/helios-page-links.txt`, dump);
console.log('LINKS_DUMPED');
// body innerText of main content to check rendering
const txt = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.slice(0, 3000));
writeFileSync(`${OUT}/helios-dashboard-text.txt`, txt);
console.log('TEXT_DUMPED');
await ctx.close();
process.exit(0);
