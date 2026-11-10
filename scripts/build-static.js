// Build a fully static deployment in public/ (DigitalOcean App Platform static site, GitHub
// Pages, any CDN). Website at /, field app at /app/, console at /console/. Without the Node
// server the apps run in "standalone" mode: offline-first on the device, demo cases loaded from
// /demo/events.json, connectors and LLM disabled. Synthetic data only.
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const copy = (from, to) => cpSync(join(ROOT, from), join(OUT, to), { recursive: true });

copy('site', '');
copy('apps/field', 'app');
copy('apps/console', 'console');
copy('core', 'core');
copy('protocols', 'protocols');
copy('adapters', 'adapters');
mkdirSync(join(OUT, 'demo'), { recursive: true });
cpSync(join(ROOT, 'data/demo/events.json'), join(OUT, 'demo/events.json'));
copy('node_modules/tesseract.js/dist', 'vendor/tesseract');
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.js', 'tesseract-core-lstm.js', 'tesseract-core-relaxedsimd-lstm.js']) {
  const src = join(ROOT, 'node_modules/tesseract.js-core', f);
  if (existsSync(src)) cpSync(src, join(OUT, 'vendor/tesseract-core', f));
}
copy('node_modules/@tesseract.js-data/eng/4.0.0_best_int', 'vendor/lang');

// Precompute learning insights (the server computes these live; a static site cannot).
const ds = join(ROOT, 'data/synthetic/longitudinal.json');
if (existsSync(ds)) {
  const { mineAll } = await import(join(ROOT, 'learning/mine.js'));
  const data = JSON.parse(readFileSync(ds, 'utf8'));
  const r = mineAll(data, { asOf: data.meta.periods.at(-1) });
  const registry = JSON.parse(readFileSync(join(ROOT, 'learning/registry.json'), 'utf8'));
  writeFileSync(join(OUT, 'demo/insights.json'), JSON.stringify({ available: true, dataset: data.meta, registry, ...r, caveat: 'Demo dataset. Findings run in shadow mode: people review every pattern before it informs care.' }));
}
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(`public/ built: site /, field app /app/, console /console/ (standalone mode, synthetic demo data)`);
