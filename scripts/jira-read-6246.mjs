// Read-only: dump CSU-6246 content
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = '/Users/eramadan/castai/.kimchi/docs/2026-10-14-cps-rebalancer-rca/jira';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/atlassian-castai-profile', {
  channel: 'chrome', headless: false, viewport: { width: 1680, height: 1050 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://castai.atlassian.net/browse/CSU-6246', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
await sleep(9000);
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
for (const label of ['Only necessary', 'Accept all']) {
  try { const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count()) { await b.click({ timeout: 2500 }); await sleep(1000); } } catch {}
}
await sleep(4000);
const txt = await page.evaluate(() => document.body.innerText);
writeFileSync(`${OUT}/csu-6246.txt`, txt);
await page.screenshot({ path: `${OUT}/csu-6246.png`, fullPage: false });
console.log('URL', page.url());
console.log('TEXT_LEN', txt.length);
process.exit(0);
