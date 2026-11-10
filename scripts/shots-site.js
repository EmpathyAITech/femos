// Screenshots of the website at desktop and phone widths. Usage: node scripts/shots-site.js [base] [outDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8765';
const OUT = process.argv[3] ?? 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const errs = [];
for (const [name, vp] of [['desktop', { width: 1440, height: 900, deviceScaleFactor: 1 }], ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }]]) {
  const p = await b.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport(vp);
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in', 'is-visible', 'visible')));
  await new Promise((r) => setTimeout(r, 600));
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(name, 'scrollWidth', sw, 'viewport', vp.width);
  await p.screenshot({ path: join(OUT, `site-${name}.png`), fullPage: true });
  const kit = await p.$('#kit');
  if (kit) await kit.screenshot({ path: join(OUT, `site-kit-${name}.png`) });
  const res = await p.$('#results');
  if (res) await res.screenshot({ path: join(OUT, `site-results-${name}.png`) });
}
await b.close();
console.log(errs.length ? `ERRORS ${errs.join(' | ')}` : 'no page errors');
