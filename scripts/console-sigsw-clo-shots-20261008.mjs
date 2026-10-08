// Console proof screenshots — SI GSW CLO savings-credibility case (2026-10-08)
// Reuses persistent Chrome profile /tmp/castai-console-profile-2 (login may still be valid;
// otherwise the window stays open for a manual login — credentials never touch the script).
// Read-only: navigation + screenshots only.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG = '07aa3c29-3e1f-44bc-ad60-ceedb878d99a'; // SI GSW CLO
const HELIOS = '419c39e4-66bf-4d61-b833-4562968a61c7';
const INTEG  = '1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f';
const KRONOS = '6d20eb8e-a1e5-4411-b4c8-5346ac3291b0';
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/savings-sigsw-snapshots-20261008';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const orgQ = `org=${ORG}`;

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

// wait up to 15 min for login state (manual step if session expired)
console.log('CHECKING_LOGIN — if a login window appears, log in manually; the script continues automatically.');
let loggedIn = false;
for (let i = 0; i < 180; i++) {
  await sleep(5000);
  const url = page.url();
  const onConsole = /console\.(eu\.)?cast\.ai/.test(url) && !/login|sign-in|signin|\/auth|sso|forgot/i.test(url);
  if (onConsole) {
    const hasNav = await page.locator('nav, [class*=sidebar], [class*=Sidebar], header').count().catch(() => 0);
    const hasPwd = await page.locator('input[type=password]').count().catch(() => 0);
    if (hasNav > 0 && hasPwd === 0) { loggedIn = true; break; }
  }
}
if (!loggedIn) { console.log('LOGIN_TIMEOUT'); await ctx.close(); process.exit(2); }
console.log('LOGIN_OK', page.url());

// discover nav routes first
const navDump = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].map(a => `${(a.textContent || '').trim().slice(0, 40)} -> ${a.getAttribute('href')}`)
    .filter((v, i, arr) => arr.indexOf(v) === i).join('\n'));
writeFileSync(`${OUT}/nav-links.txt`, navDump);

async function shot(name, url, extraWait = 9000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await sleep(extraWait);
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
      console.log('SHOT_OK', name);
      return;
    } catch (e) {
      const msg = String(e).slice(0, 120);
      if (/closed/.test(msg) && attempt === 1) {
        page = ctx.pages()[0] || await ctx.newPage();
        continue;
      }
      console.log('SHOT_FAIL', name, msg);
      return;
    }
  }
}

// Evidence slots referenced by the reply email (SNAP-xx):
await shot('SNAP-01-cluster-list',      `${BASE}/automation/cluster-list?${orgQ}`);
await shot('SNAP-02-helios-overview',   `${BASE}/automation/external-clusters/${HELIOS}/overview?${orgQ}`);
await shot('SNAP-03-helios-savings',    `${BASE}/automation/external-clusters/${HELIOS}/savings?${orgQ}`, 12000);
await shot('SNAP-04-integ-savings',     `${BASE}/automation/external-clusters/${INTEG}/savings?${orgQ}`, 12000);
await shot('SNAP-05-kronos-savings',    `${BASE}/automation/external-clusters/${KRONOS}/savings?${orgQ}`, 12000);
await shot('SNAP-06-helios-cost',       `${BASE}/automation/external-clusters/${HELIOS}/efficiency?${orgQ}`, 12000);
await shot('SNAP-07-integ-efficiency',  `${BASE}/automation/external-clusters/${INTEG}/efficiency?${orgQ}`, 12000);
// org-level savings report — best-effort route discovery
const savingsHref = navDump.split('\n').map(l => l.split(' -> ')[1]).filter(Boolean)
  .find(h => /savings/i.test(h) && !/estimated/i.test(h));
const orgSavingsUrl = savingsHref
  ? (savingsHref.startsWith('http') ? savingsHref : `${BASE}${savingsHref}`) + (savingsHref.includes('?') ? '&' : '?') + orgQ
  : `${BASE}/monitoring/savings?${orgQ}`;
await shot('SNAP-08-org-savings-report', orgSavingsUrl, 14000);

console.log('DONE — screenshots in', OUT);
await sleep(3000);
await ctx.close();
process.exit(0);
