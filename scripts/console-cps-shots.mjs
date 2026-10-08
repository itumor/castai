// Console proof screenshots — ORG CPS negative-savings case (2026-10-08)
// Flow: opens VISIBLE chromium (persistent profile /tmp/castai-console-profile-2),
// user logs in manually (credentials never touch the script), script detects login,
// then walks console.eu.cast.ai and screenshots the views the email cites.
// Read-only: navigation + screenshots only. No form fills besides nothing at all.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed'; // CPS
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51'; // dema-platform-services
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c'; // dema-platform-services-test
const BASE = 'https://console.eu.cast.ai';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const MARKER = '/tmp/console-login-ok.txt';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const orgQ = `org=${ORG}`;

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', {
  channel: 'chrome', // use installed Google Chrome — no browser download needed
  headless: false,
  viewport: { width: 1680, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

// --- wait for manual login (max 15 min) -------------------------------
console.log('WAITING_FOR_LOGIN — log in in the opened window (SSO or email). No action needed after that; the script continues automatically.');
let loggedIn = false;
for (let i = 0; i < 180; i++) {
  await sleep(5000);
  const url = page.url();
  const onConsole = /console\.(eu\.)?cast\.ai/.test(url) && !/login|sign-in|signin|\/auth|sso|forgot/i.test(url);
  if (onConsole) {
    // double-check: page shows app chrome (nav) not a login form
    const hasNav = await page.locator('nav, [class*=sidebar], [class*=Sidebar], header').count().catch(() => 0);
    const hasPwd = await page.locator('input[type=password]').count().catch(() => 0);
    if (hasNav > 0 && hasPwd === 0) { loggedIn = true; break; }
  }
}
if (!loggedIn) { console.log('LOGIN_TIMEOUT — no login detected in 15 min.'); await ctx.close(); process.exit(2); }
writeFileSync(MARKER, new Date().toISOString());
console.log('LOGIN_OK', page.url());

// dump nav links for route discovery
const navDump = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].map(a => `${(a.textContent || '').trim().slice(0, 40)} -> ${a.getAttribute('href')}`)
    .filter((v, i, arr) => arr.indexOf(v) === i).join('\n'));
writeFileSync(`${OUT}/nav-links.txt`, navDump);

async function shot(name, url, extraWait = 9000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await sleep(extraWait); // let charts/tables render
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
      console.log('SHOT_OK', name);
      return;
    } catch (e) {
      const msg = String(e).slice(0, 120);
      if (/closed/.test(msg) && attempt === 1) {
        console.log('SHOT_RETRY (reopened window)', name);
        page = ctx.pages()[0] || await ctx.newPage();
        continue;
      }
      console.log('SHOT_FAIL', name, msg);
      return;
    }
  }
}

// 1) cluster list (the view the customer screenshot shows; live route seen at login: /automation/cluster-list)
await shot('01-cluster-list', `${BASE}/automation/cluster-list?${orgQ}`);
// 2) main cluster overview + autoscaler pages
await shot('02-main-overview', `${BASE}/automation/external-clusters/${MAIN}/overview?${orgQ}`);
await shot('03-main-efficiency', `${BASE}/automation/external-clusters/${MAIN}/efficiency?${orgQ}`);
await shot('04-main-savings', `${BASE}/automation/external-clusters/${MAIN}/savings?${orgQ}`);
// 3) test cluster
await shot('05-test-overview', `${BASE}/automation/external-clusters/${TEST}/overview?${orgQ}`);
await shot('06-test-efficiency', `${BASE}/automation/external-clusters/${TEST}/efficiency?${orgQ}`);
// 4) org-level Savings Report — find route from nav dump if possible
const savingsHref = navDump.split('\n').map(l => l.split(' -> ')[1]).filter(Boolean)
  .find(h => /savings/i.test(h) && !/estimated/i.test(h));
if (savingsHref) {
  const u = savingsHref.startsWith('http') ? savingsHref : `${BASE}${savingsHref}${savingsHref.includes('?') ? '&' : '?'}${orgQ}`;
  await shot('07-org-savings-report', u, 12000);
} else {
  await shot('07-org-savings-report', `${BASE}/monitoring/savings?${orgQ}`, 12000);
}
// 5) workload autoscaling page (main) — shows WOOP side
const woopHref = navDump.split('\n').map(l => l.split(' -> ')[1]).filter(Boolean).find(h => /workload/i.test(h));
if (woopHref) {
  const u = woopHref.startsWith('http') ? woopHref : `${BASE}${woopHref}${woopHref.includes('?') ? '&' : '?'}${orgQ}`;
  await shot('08-workload-autoscaling', u, 10000);
}

console.log('DONE — screenshots in', OUT);
await sleep(4000);
await ctx.close();
process.exit(0);
