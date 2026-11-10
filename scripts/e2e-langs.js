// Opens the field app and the console in every language and checks the UI is really in that
// script, with no raw message keys leaking. Saves one screenshot per language and screen.
// Usage: node scripts/e2e-langs.js [baseUrl] [screenshotDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const OUT = process.argv[3] ?? join(process.cwd(), 'docs/screenshots/languages');
mkdirSync(OUT, { recursive: true });
const SCRIPT = { en: /[A-Za-z]/, hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, ta: /[஀-௿]/ };
const LEAK = /\b(?:f|c|h|ui|check|status|event|action|role|ocr|band|choice)\.[a-z_]{3,}\b/; // un-translated key
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
let fail = 0;
const check = async (page, lang, where) => {
  const text = await page.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText);
  const share = (text.match(new RegExp(SCRIPT[lang].source, 'g')) ?? []).length;
  const leak = text.match(LEAK);
  const ok = share > 20 && !leak;
  if (!ok) fail++;
  console.log(`${ok ? '✔' : '✖'} ${lang} ${where}: ${share} script chars${leak ? ` · LEAKED KEY ${leak[0]}` : ''}`);
};
try {
  for (const lang of ['en', 'hi', 'bn', 'mr', 'ta']) {
    const p = await b.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    // Seed the signed-in user and language before the app's scripts run.
    await p.evaluateOnNewDocument((l) => { localStorage.setItem('femos.lang', JSON.stringify(l)); localStorage.setItem('femos.actor', JSON.stringify({ id: 'asha-01', role: 'asha', name: 'Sunita Devi' })); }, lang);
    await p.goto(`${BASE}/app/#/`, { waitUntil: 'networkidle0' });
    await p.waitForSelector('.hero-card');
    await check(p, lang, 'field home');
    await p.screenshot({ path: join(OUT, `field-home-${lang}.png`) });
    const href = await p.$eval('.item', (a) => a.getAttribute('href'));
    await p.goto(`${BASE}/app/${href}`, { waitUntil: 'networkidle0' });
    await p.waitForSelector('.steps');
    await check(p, lang, 'field case');
    await p.screenshot({ path: join(OUT, `field-case-${lang}.png`), fullPage: true });
    await p.goto(`${BASE}/app/${href}/history`, { waitUntil: 'networkidle0' });
    await p.waitForSelector('.q');
    await check(p, lang, 'field history questions');
    await p.screenshot({ path: join(OUT, `field-history-${lang}.png`) });
    const c = await b.newPage();
    await c.setViewport({ width: 1440, height: 1000 });
    await c.evaluateOnNewDocument((l) => localStorage.setItem('femos.console.lang', JSON.stringify(l)), lang);
    await c.goto(`${BASE}/console/#/queue`, { waitUntil: 'networkidle0' });
    await c.waitForSelector('#review .name');
    await check(c, lang, 'console review');
    await c.screenshot({ path: join(OUT, `console-review-${lang}.png`) });
    await p.close(); await c.close();
  }
} finally {
  await b.close();
}
console.log(fail ? `LANGUAGES FAIL (${fail})` : 'LANGUAGES PASS');
process.exitCode = fail ? 1 : 0;
