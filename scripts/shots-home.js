// Full-page screenshots of the homepage (desktop + phone, any language), with all images loaded.
// Usage: node scripts/shots-home.js [baseUrl] [outDir] [lang]
import puppeteer from 'puppeteer-core';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const OUT = process.argv[3] ?? 'docs/screenshots';
const LANG = process.argv[4] ?? 'en';
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
try {
  for (const [n, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }]]) {
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.setViewport(vp);
    await p.evaluateOnNewDocument((l) => localStorage.setItem('femos-lang', l), LANG);
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await p.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((i) => (i.loading = 'eager')));
    await p.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); })))));
    await new Promise((r) => setTimeout(r, 600));
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    await p.screenshot({ path: join(OUT, `home-${n}-${LANG}.png`), fullPage: true });
    console.log(n, LANG, 'scrollWidth', w, errs.length ? errs : 'no errors');
    await p.close();
  }
} finally { await b.close(); }
