// Product screenshots for the website, taken from the running app with the demo data.
// Usage: node scripts/shots-marketing.js [baseUrl]  → site/assets/shots/*.webp
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const OUT = join(process.cwd(), 'site/assets/shots');
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const save = async (buf, name, width) => { await sharp(buf).resize({ width }).webp({ quality: 84 }).toFile(join(OUT, `${name}.webp`)); console.log('✔', name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function phone(lang, path, name, prep) {
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await p.evaluateOnNewDocument((l) => { localStorage.setItem('femos.lang', JSON.stringify(l)); localStorage.setItem('femos.actor', JSON.stringify({ id: 'asha-01', role: 'asha', name: 'Sunita Devi' })); }, lang);
  await p.goto(`${BASE}/app/#/`, { waitUntil: 'networkidle0' });
  if (path) { await p.goto(`${BASE}/app/${await path(p)}`, { waitUntil: 'networkidle0' }); }
  if (prep) await prep(p);
  await wait(400);
  await save(await p.screenshot(), name, 560);
  await p.close();
}
const urgentCase = async (p) => p.$eval('.item.urgent', (a) => a.getAttribute('href'));

try {
  // Field app
  await phone('en', null, 'phone-home');
  await phone('en', urgentCase, 'phone-case');
  await phone('en', async (p) => `${await urgentCase(p)}/history`, 'phone-words', async (p) => {
    await p.click('[data-tab="words"]');
    await p.waitForSelector('#tx');
    await p.$eval('#tx', (t) => { t.value = ''; });
    await p.type('#tx', 'Umar 17 saal. Mahwari 9 din chalti hai, 7 pad lagte hain. Chakkar aate hain, lekin behosh nahi hui.');
    await p.click('#ex');
    await p.waitForSelector('.found');
    await p.evaluate(() => document.querySelector('#res').scrollIntoView({ block: 'start' }));
  });
  for (const l of ['hi', 'bn', 'mr', 'ta']) await phone(l, null, `phone-home-${l}`);
  // Console
  const c = await b.newPage();
  await c.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await c.evaluateOnNewDocument(() => localStorage.setItem('femos.console.lang', JSON.stringify('en')));
  await c.goto(`${BASE}/console/#/queue`, { waitUntil: 'networkidle0' });
  await c.waitForSelector('#review .name');
  await wait(400);
  await save(await c.screenshot(), 'console-review', 1600);
  await c.goto(`${BASE}/console/#/insights`, { waitUntil: 'networkidle0' });
  await c.waitForSelector('.finding', { timeout: 20000 });
  await wait(400);
  await save(await c.screenshot(), 'console-insights', 1600);
  await c.goto(`${BASE}/console/#/proposals`, { waitUntil: 'networkidle0' });
  await wait(600);
  await save(await c.screenshot(), 'console-proposals', 1600);
} finally {
  await b.close();
}
