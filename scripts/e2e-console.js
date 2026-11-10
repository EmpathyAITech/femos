// Console end-to-end: a clinician reviews the top case and decides; an agent's reminder
// proposal is approved and sent (dry-run); insights and reports render.
// Usage: node scripts/e2e-console.js [baseUrl] [screenshotDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const OUT = process.argv[3] ?? join(process.cwd(), 'docs/screenshots');
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && !/Failed to load resource: the server responded with a status of (404|501)/.test(m.text()) && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: join(OUT, `console-${n}.png`), fullPage: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(`• ${s}`);

try {
  await page.goto(`${BASE}/console/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('femos'); });
  await page.goto(`${BASE}/console/#/queue`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.qi', { timeout: 20000 });
  const n = await page.$$eval('.qi', (e) => e.length);
  log(`queue has ${n} cases`);
  await page.waitForSelector('#review .name');
  await wait(400);
  await shot('01-queue-review');
  const top = await page.$eval('#review .name', (e) => e.textContent);
  log(`reviewing ${top}`);
  if (await page.$('.opt[data-d="refer"]')) {
    await page.click('.opt[data-d="refer"]');
    await page.type('#note', 'Please bring her to PHC Sadar for review this week.');
    await shot('02-decision');
    await page.click('#dec');
    await wait(800);
    log('decision recorded');
  } else log('top case has no decision panel (conflict?)');

  await page.goto(`${BASE}/console/#/proposals`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#main h1');
  await wait(300);
  await shot('03-proposals');
  const msg = await page.$$eval('.prop', (els) => els.findIndex((e) => e.textContent.includes('Send reminder')));
  if (msg >= 0) {
    const btns = await page.$$('.prop [data-ap]');
    await btns[msg].click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.length > 0, { timeout: 15000 });
    log(`message approval: ${await page.$eval('#toast', (e) => e.textContent)}`);
  }

  await page.goto(`${BASE}/console/#/followup`, { waitUntil: 'networkidle0' });
  await wait(300);
  await shot('04-followup');
  await page.goto(`${BASE}/console/#/insights`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.finding', { timeout: 15000 });
  await page.click('[data-q="Overdue follow-ups"]');
  await page.waitForSelector('#ans .row');
  log(`ask: ${await page.$eval('#ans .row', (e) => e.textContent.replace(/\s+/g, ' '))}`);
  await shot('05-insights');
  await page.goto(`${BASE}/console/#/reports`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#dh');
  await page.click('#dh');
  await page.waitForSelector('#dhr pre', { timeout: 15000 });
  await page.click('#fp');
  await page.waitForSelector('#fr pre, #fr .note', { timeout: 60000 });
  log(`fhir push: ${(await page.$eval('#fr', (e) => e.textContent)).slice(0, 160).replace(/\s+/g, ' ')}`);
  await shot('06-reports');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('CONSOLE E2E PASS');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('CONSOLE E2E FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
