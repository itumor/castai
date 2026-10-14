// Open Jira CSU ticket for the CPS rebalancer RCA (2026-10-14)
// Visible Chrome, manual login if needed (credentials never touch the script).
// Flow: board -> "c" (create) -> fill summary/description (markdown via clipboard) -> Create -> capture issue key.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = '/Users/eramadan/castai/.kimchi/docs/2026-10-14-cps-rebalancer-rca/jira';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SUMMARY = 'CPS Rebalancer — Why is c8in.large selected over cheaper c5a.large?';
const DESCRIPTION = `**Severity:** P3
**Cluster:** 5dc3bf31-a263-4c6b-88bb-e95b6403aa51
**Org:** 5e413e89-eb67-48fb-b81c-6172baa988ed (EU)
**Region:** eu-central-1
**Plan:** 5e132d41-d02e-4030-a6f7-d2ea9fe498a3

h3. Issue

The customer noticed that the same Rebalancer plan recommends two EC2 instances with identical CPU and memory but significantly different prices:

|| Instance || Resources || Monthly cost ||
| c8in.large | 2 vCPU / 4 GiB | $67.91 |
| c5a.large | 2 vCPU / 4 GiB | $38.13 |

The c8in.large is approximately *78% more expensive*.

The plan was generated using the default unconstrained node template, with Spot disabled.

Although these instances differ in networking, EBS performance, and pod density, we have not identified a workload requirement explaining the more expensive selection.

h3. Engineering questions

# Why did Rebalancer select c8in.large when the cheaper c5a.large was also included in the same plan?
# Which scheduling constraints, capacity signals, or instance-scoring factors influenced this decision?
# Is this expected optimization behavior, or is there an opportunity to improve cost-based instance selection?

*Impact:* No production changes. The customer is requesting a clear explanation before proceeding with rebalancing.

*Attachment:* Screenshot of the Rebalancer plan showing both instances and their pricing (to be added by reporter).

*Console:* https://console.eu.cast.ai/automation/external-clusters/5dc3bf31-a263-4c6b-88bb-e95b6403aa51/rebalance/list/log?org=5e413e89-eb67-48fb-b81c-6172baa988ed`;

const ctx = await chromium.launchPersistentContext('/tmp/atlassian-castai-profile', {
  channel: 'chrome', headless: false,
  viewport: { width: 1680, height: 1050 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();

await page.goto('https://castai.atlassian.net/jira/software/projects/CSU/boards/58', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});

console.log('WAITING_FOR_LOGIN — log in in the opened window if needed (Google SSO). Waiting up to 15 min.');
let loggedIn = false;
for (let i = 0; i < 180; i++) {
  await sleep(5000);
  const url = page.url();
  const onJira = /castai\.atlassian\.net/.test(url) && !/id\.atlassian\.com|\/login|no-user/.test(url);
  if (onJira) {
    const hasBoard = await page.locator('h1, [data-testid="software-board.header"], nav').count().catch(() => 0);
    const hasPwd = await page.locator('input[type=password]').count().catch(() => 0);
    if (hasBoard > 0 && hasPwd === 0) { loggedIn = true; break; }
  }
}
if (!loggedIn) { console.log('LOGIN_TIMEOUT'); await ctx.close(); process.exit(2); }
console.log('LOGIN_OK', page.url());
await sleep(4000);

// stage the description into macOS clipboard
writeFileSync('/tmp/jira-desc.txt', DESCRIPTION);
execSync('pbcopy < /tmp/jira-desc.txt');

// open create dialog with "c"
await page.keyboard.press('c');
await sleep(4000);

// summary
const summarySel = 'input#summary-field, input[name="summary"], input[data-testid*="summary" i]';
await page.locator(summarySel).first().click({ timeout: 15000 });
await page.keyboard.type(SUMMARY, { delay: 12 });
console.log('SUMMARY_FILLED');

// description: click editor and paste
const descSel = 'div[contenteditable="true"], #description, .ProseMirror';
const desc = page.locator(descSel).first();
await desc.click({ timeout: 15000 });
await sleep(800);
await page.keyboard.press('Meta+v');
await sleep(1500);
console.log('DESCRIPTION_PASTED');

await page.screenshot({ path: `${OUT}/01-jira-filled.png`, fullPage: false });
console.log('SHOT_OK 01-jira-filled');

// create
const createBtn = page.locator('button:has-text("Create")').last();
await createBtn.click({ timeout: 15000 });
console.log('CREATE_CLICKED — waiting for issue creation');
await sleep(6000);
await page.screenshot({ path: `${OUT}/02-jira-created.png`, fullPage: false });

// try to harvest the new issue key from toast/link
let key = '';
try {
  const toast = await page.evaluate(() => document.body.innerText);
  const m = toast.match(/CSU-\d+/);
  if (m) key = m[0];
} catch {}
console.log('ISSUE_KEY', key || 'NOT_DETECTED');
writeFileSync(`${OUT}/issue-key.txt`, key + '\n' + page.url() + '\n');
console.log('DONE');
process.exit(0);
