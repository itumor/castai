import { chromium } from 'playwright';
const ORG = '5e413e89-eb67-48fb-b81c-6172baa988ed';
const TEST = '00ee8944-67f6-43d5-8517-c270951ec02c';
const OUT = '/Users/eramadan/castai/outbox/case-threads/console-shots-20261007T2155Z';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ctx = await chromium.launchPersistentContext('/tmp/castai-console-profile-2', { channel: 'chrome', headless: false, viewport: { width: 1680, height: 1000 } });
let page = ctx.pages()[0] || await ctx.newPage();
async function tiles() {
  await sleep(7000);
  return page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ');
    const grab = (label) => { const m = t.match(new RegExp(label + '.{0,60}', 'i')); return m ? m[0] : null; };
    return { baseline: grab('BASELINE SPEND'), realized: grab('REALIZED SAVINGS'), woop: grab('WORKLOAD AUTOSCALER SAVINGS'), actual: grab('ACTUAL SPEND'), rangeLbl: grab('(This month|Last [0-9]+ (days|months)|Previous month) GMT') };
  });
}
const variants = [
  ['from-to-iso',   'from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z'],
  ['startTime-end', 'startTime=2026-08-01T00:00:00Z&endTime=2026-09-01T00:00:00Z'],
  ['startDate',     'startDate=2026-08-01&endDate=2026-08-31'],
  ['dateFrom',      'dateFrom=2026-08-01&dateTo=2026-08-31'],
  ['from-to-date',  'from=2026-08-01&to=2026-08-31'],
  ['period',        'period.from=2026-08-01&period.to=2026-08-31'],
  ['range',         'rangeStart=2026-08-01&rangeEnd=2026-08-31'],
];
for (const [tag, qs] of variants) {
  await page.goto(`https://console.eu.cast.ai/automation/external-clusters/${TEST}/cost-report/savings-report?org=${ORG}&${qs}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const rej = page.getByRole('button', { name: /^Reject$/i }).first();
  if (await rej.count().catch(() => 0)) await rej.click().catch(() => {});
  const t = await tiles();
  console.log(tag, '->', JSON.stringify(t));
  // August test values from API: baseline 727.95, actual 514.62, realized +213.33, WOOP -24.81
  const hit = /72[0-9]|51[0-9]|213/.test([t.baseline, t.actual, t.realized].join(' '));
  console.log('  AUGUST_MATCH', hit);
  if (hit) { await page.screenshot({ path: `${OUT}/21-test-august-${tag}.png` }); console.log('  SAVED PROOF SHOT'); }
}
console.log('DONE-R8');
await ctx.close(); process.exit(0);
