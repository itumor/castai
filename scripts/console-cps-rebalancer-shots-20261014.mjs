// Console evidence screenshots — CPS rebalancer RCA (2026-10-14)
// Opens VISIBLE Chrome (fresh persistent profile /tmp/castai-console-profile-3).
// User logs in manually in that window (credentials never touch the script).
// Then the script navigates read-only and screenshots:
//   - rebalance plan log (the customer's URL)
//   - each of the 5 reviewed plan detail views (obsolete plans still open read-only)
//   - available-savings view for the "66→8-9 nodes" figure
// Output: .kimchi/docs/2026-10-14-cps-rebalancer-rca/console-shots/
// STRICTLY read-only: navigation + link clicking + screenshots. No form input.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG  = '5e413e89-eb67-48fb-b81c-6172baa988ed'; // CPS
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51'; // dema-platform-services
const BASE = 'https://console.eu.cast.ai';
const OUT  = '/Users/eramadan/castai/.kimchi/docs/2026-10-14-cps-rebalancer-rca/console-shots';
mkdirSync(OUT, { recursive: true });

const PLANS = [
  ['106f0905', 'plan-106f0905-11h27-fullscope-diverse'],
  ['5e132d41', 'plan-5e132d41-11h40-diverse-c8in'],   // the c8in/c5a plan
  ['5ada1f8b', 'plan-5ada1f8b-12h13-t3aonly'],
  ['c15d34a9', 'plan-c15d34a9-08h45-diverse'],
  ['d44d1095', 'plan-d44d1095-10h13-t3aonly-negative'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const orgQ = `org=${ORG}`;

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-3', {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1680, height: 1050 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

console.log('WAITING_FOR_LOGIN — a Chrome window just opened. If you are not already logged in, log in (SSO or email). The script continues automatically for up to 15 minutes.');
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

async function shot(name, url, extraWait = 8000, fullPage = false) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await sleep(extraWait);
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
      console.log('SHOT_OK', name);
      return true;
    } catch (e) {
      const msg = String(e).slice(0, 140);
      if (/closed/.test(msg) && attempt === 1) { page = ctx.pages()[0] || await ctx.newPage(); continue; }
      console.log('SHOT_FAIL', name, msg);
      return false;
    }
  }
}

// 1) The rebalance plan log — the customer's URL
const logUrl = `${BASE}/automation/external-clusters/${MAIN}/rebalance/list/log?${orgQ}`;
await shot('01-rebalance-plan-log', logUrl, 10000, true);

// 2) Discover plan detail links on the log page
await page.goto(logUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await sleep(6000);
const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
writeFileSync(`${OUT}/rebalance-links.txt`, hrefs.filter(Boolean).join('\n'));
const planLinks = hrefs.filter(h => h && /rebalance/i.test(h) && /[0-9a-f]{8}-[0-9a-f]{4}-/.test(h));
console.log('PLAN_LINKS_FOUND', planLinks.length);

for (const [prefix, name] of PLANS) {
  const link = planLinks.find(h => h.includes(prefix));
  if (link) {
    const u = link.startsWith('http') ? link : `${BASE}${link}${link.includes('?') ? '&' : '?'}${orgQ}`;
    await shot(`02-${name}-detail`, u, 9000, true);
  } else {
    console.log('PLAN_LINK_MISSING', prefix, '— trying direct click on row text');
    try {
      const row = page.locator(`text=${prefix}`).first();
      if (await row.count()) { await row.click(); await sleep(8000); await page.screenshot({ path: `${OUT}/02-${name}-detail.png`, fullPage: true }); console.log('SHOT_OK via click', name); }
      else console.log('ROW_NOT_FOUND', prefix);
    } catch (e) { console.log('CLICK_FAIL', prefix, String(e).slice(0, 120)); }
  }
}

// 3) Available Savings (the "66→9 nodes, −37%" view) — try known/candidate routes
const avsCandidates = [
  `${BASE}/automation/external-clusters/${MAIN}/available-savings?${orgQ}`,
  `${BASE}/automation/external-clusters/${MAIN}/estimated-savings?${orgQ}`,
  `${BASE}/savings/external-clusters/${MAIN}?${orgQ}`,
];
for (const u of avsCandidates) {
  const ok = await shot('03-available-savings', u, 12000, true);
  if (ok) break;
}

// 4) Node templates view (shows the t3a-only default + turbo r8id) — discovery from nav
const navDump = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => `${(a.textContent||'').trim().slice(0,40)} -> ${a.getAttribute('href')}`).join('\n'));
writeFileSync(`${OUT}/nav-links.txt`, navDump);
const tplHref = navDump.split('\n').map(l => l.split(' -> ')[1]).filter(Boolean).find(h => /node-template|node_template|templates/i.test(h));
if (tplHref) {
  const u = tplHref.startsWith('http') ? tplHref : `${BASE}${tplHref}${tplHref.includes('?') ? '&' : '?'}${orgQ}`;
  await shot('04-node-templates', u, 9000, true);
} else {
  await shot('04-node-templates', `${BASE}/automation/external-clusters/${MAIN}/node-templates?${orgQ}`, 9000, true);
}

console.log('DONE — screenshots in', OUT);
await sleep(3000);
await ctx.close();
process.exit(0);
