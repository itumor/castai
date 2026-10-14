// Pass 2 — CPS rebalancer console evidence (2026-10-14)
// Reuses the logged-in profile from pass 1. Read-only: navigate, click row/expansion, screenshot.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORG  = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const MAIN = '5dc3bf31-a263-4c6b-88bb-e95b6403aa51';
const BASE = 'https://console.eu.cast.ai';
const OUT  = '/Users/eramadan/castai/.kimchi/docs/2026-10-14-cps-rebalancer-rca/console-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-3', {
  channel: 'chrome', headless: false,
  viewport: { width: 1680, height: 1050 },
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] || await ctx.newPage();

const logUrl = `${BASE}/automation/external-clusters/${MAIN}/rebalance/list/log?org=${ORG}`;
await page.goto(logUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await sleep(7000);

// dismiss cookie banner if present (privacy choice: Reject)
try {
  const reject = page.locator('button:has-text("Reject"), button:has-text("Reject all")').first();
  if (await reject.count()) { await reject.click(); await sleep(1500); console.log('COOKIE_DISMISSED'); }
} catch (e) { console.log('COOKIE_SKIP', String(e).slice(0, 80)); }

// clean re-shot of the log (full page, no banner)
await page.screenshot({ path: `${OUT}/01-rebalance-plan-log.png`, fullPage: true });
console.log('SHOT_OK 01-rebalance-plan-log');

const TARGETS = [
  ['5e132d41', '02-plan-5e132d41-diverse-c8in'],
  ['5ada1f8b', '03-plan-5ada1f8b-t3aonly'],
  ['d44d1095', '04-plan-d44d1095-negative'],
  ['c15d34a9', '05-plan-c15d34a9-diverse'],
];

for (const [prefix, name] of TARGETS) {
  try {
    await page.goto(logUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await sleep(5000);
    const row = page.locator(`text=${prefix}`).first();
    if (!(await row.count())) { console.log('ROW_NOT_FOUND', prefix); continue; }
    await row.click();
    await sleep(7000);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    console.log('DETAIL_URL', prefix, page.url());
    await page.screenshot({ path: `${OUT}/${name}-detail.png`, fullPage: true });
    console.log('SHOT_OK', `${name}-detail`);

    // dump visible text + clickable candidates for discovery
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 6000));
    writeFileSync(`${OUT}/${name}-detail.txt`, txt);
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, [role=tab], [role=button]')]
        .map(b => (b.textContent || '').trim().slice(0, 60)).filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i).slice(0, 60));
    writeFileSync(`${OUT}/${name}-buttons.txt`, btns.join('\n'));

    // try expanding anything that looks like it reveals the node plan
    for (const probe of [/view/i, /detail/i, /node/i, /configuration/i, /plan/i]) {
      const el = page.locator(`button:has-text("${probe.source}"), [role=tab]:has-text("${probe.source}"), a:has-text("${probe.source}")`)
        .filter({ hasNotText: /event log|schedule|new plan|docs|help|workload|node autoscaler|node list/i }).first();
      if (await el.count()) {
        const label = (await el.textContent() || '').trim().slice(0, 50);
        await el.click().catch(() => {});
        await sleep(4000);
        await page.screenshot({ path: `${OUT}/${name}-expanded-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}.png`, fullPage: true });
        console.log('EXPAND_SHOT', prefix, label);
        break; // one expansion per plan is enough for discovery
      }
    }
  } catch (e) {
    console.log('PLAN_FAIL', prefix, String(e).slice(0, 140));
  }
}

console.log('DONE2');
await sleep(2000);
await ctx.close();
process.exit(0);
