// Render CFR mockup panels to PNGs (local HTML, headless, no network, no login)
import { chromium } from 'playwright';
import path from 'node:path';

const HTML = '/Users/eramadan/castai/outbox/cfr-mockup-2026-10-16.html';
const OUT = '/Users/eramadan/castai/outbox';
const shots = [
  ['p1', 'cfr-mockup-1-before.png'],
  ['p2', 'cfr-mockup-2-why-explainer.png'],
  ['p3', 'cfr-mockup-3-compare-view.png'],
  ['p4', 'cfr-mockup-4-assumptions.png'],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('file://' + HTML, { waitUntil: 'load' });
await page.waitForTimeout(400);
for (const [id, name] of shots) {
  await page.locator('#' + id).screenshot({ path: path.join(OUT, name) });
  console.log('OK', name);
}
await browser.close();
