// End-to-end test of the field app in real Chrome: a health worker registers a woman, records
// history in Hinglish, photographs a (synthetic) Hb meter screen, verifies the OCR reading and
// sends the case to a clinician. Usage: node scripts/e2e.js [baseUrl] [screenshotDir]
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const OUT = process.argv[3] ?? join(process.cwd(), 'docs/screenshots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const img = join(OUT, '_e2e-display.png');
if (!existsSync(img)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
    <rect width="640" height="400" rx="40" fill="#2b2f33"/><rect x="60" y="60" width="520" height="280" rx="16" fill="#c9d3c0"/>
    <text x="90" y="110" font-family="Helvetica" font-size="28" fill="#222">HemoCheck HB-201</text>
    <text x="520" y="110" font-family="Helvetica" font-size="26" fill="#222" text-anchor="end">10:42</text>
    <text x="300" y="260" font-family="Helvetica" font-weight="bold" font-size="130" fill="#111" text-anchor="middle">9.6</text>
    <text x="440" y="260" font-family="Helvetica" font-size="44" fill="#111">g/dL</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(img);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource: the server responded with a status of (404|501)/.test(m.text()) && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: join(OUT, `field-${n}.png`), fullPage: true });
const step = (s) => console.log(`• ${s}`);
const clickText = async (sel, text) => {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 15000 }, sel, text);
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t)).click(), sel, text);
};

try {
  await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { localStorage.clear(); indexedDB.deleteDatabase('femos'); });
  await page.goto(`${BASE}/app/#/role`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.role');
  await shot('01-role');
  step('role screen');
  await page.click('.role[data-r="asha"]');
  await page.click('#go');
  await page.waitForSelector('.hero-card');
  await shot('02-home');
  step('home');

  await page.click('.hero-card a');
  await page.waitForSelector('#pn');
  await page.type('#pn', 'Test Kumari');
  await page.type('#by', '2007');
  await page.type('#vi', 'Rampur');
  await page.type('#bl', 'Sadar');
  await page.type('#ph', '+919000000999');
  await page.$eval('#c1', (e) => e.click());
  await page.$eval('#c2', (e) => e.click());
  await shot('03-register');
  await page.click('#mk');
  step('case created');

  await page.waitForSelector('[data-tab="words"]');
  await page.click('[data-tab="words"]');
  await page.waitForSelector('#tx');
  await page.type('#tx', 'Umar 19 saal. Pregnant nahi hai. Mahwari 9 din chalti hai, 7 pad lagte hain, bade thakke aate hain. Chakkar aate hain aur thakan rehti hai, lekin behosh nahi hui. Saans nahi phoolti. Heavy bleeding hai.');
  await page.click('#ex');
  await page.waitForSelector('#use');
  await shot('04-own-words');
  const found = await page.$$eval('.found', (els) => els.length);
  step(`intake extracted ${found} fields`);
  await page.click('#use');
  await page.waitForSelector('#cf');
  await page.$eval('#cf', (e) => e.click());
  await shot('05-history-form');
  await page.click('#sv');
  step('history saved and confirmed');

  await page.waitForSelector('#cam', { timeout: 15000 });
  const input = await page.$('#cam');
  await input.uploadFile(img);
  step('photo uploaded, OCR running in the browser…');
  await page.waitForFunction(() => document.querySelector('#yes') || document.querySelector('#man2'), { timeout: 120000 });
  await shot('06-ocr-result');
  const ok = await page.$('#yes');
  if (ok) {
    const v = await page.$eval('#bigv', (e) => e.textContent);
    step(`OCR candidate ${v}`);
    if (v !== '9.6') throw new Error(`UNSAFE: OCR proposed ${v}, display shows 9.6`);
    await page.click('#yes');
  } else {
    // Safe rejection → the worker types the reading twice (double entry).
    step(`OCR rejected safely: ${(await page.$eval('#out .fm', (e) => e.innerText)).split('\n')[0]} → typing it`);
    await page.click('#man2');
    await page.waitForSelector('#v1');
    await page.type('#v1', '9.6');
    await page.type('#v2', '9.6');
    await page.waitForFunction(() => !document.querySelector('#sv').disabled);
    await page.click('#sv');
  }

  await page.waitForSelector('.steps');
  await new Promise((r) => setTimeout(r, 500));
  await shot('07-case-checks');
  const flags = await page.$$eval('.flag .fm', (els) => els.map((e) => e.textContent));
  step(`flags: ${flags.join(' | ')}`);
  const btn = await page.$('#submit');
  if (!btn) throw new Error('no submit button');
  if (await page.$eval('#submit', (b) => b.disabled)) throw new Error('submit disabled (blocking flags?)');
  await page.click('#submit');
  await page.waitForFunction(() => document.body.innerText.includes('With clinician') || document.body.innerText.includes('चिकित्सक के पास'), { timeout: 10000 });
  await shot('08-sent');
  step('sent to clinician');

  await page.click('#lang');
  await new Promise((r) => setTimeout(r, 300));
  await shot('09-hindi');
  step('Hindi UI');

  const status = await page.evaluate(async () => { try { const r = await fetch('/api/health'); return r.ok ? r.json() : null; } catch { return null; } });
  step(status ? `server events after sync: ${status.events}` : 'standalone (static) mode: case stays on this device');
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('E2E PASS');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  console.error('E2E FAIL:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
