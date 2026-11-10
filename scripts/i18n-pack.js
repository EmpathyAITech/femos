// Merge protocol-pack translations (protocols/<pack>/i18n/<lang>.json, path → text) into
// pack.json, and report coverage. English overlay is the source; missing paths fall back to it.
// Usage: node scripts/i18n-pack.js [--check]   (--check: exit 1 if any language is incomplete)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKS = join(process.cwd(), 'protocols');
let incomplete = false;
for (const id of readdirSync(PACKS)) {
  const dir = join(PACKS, id);
  const file = join(dir, 'pack.json');
  if (!existsSync(join(dir, 'i18n'))) continue;
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  const src = JSON.parse(readFileSync(join(dir, 'i18n', 'en.json'), 'utf8'));
  // Same path scheme as the extraction: list items keyed by linkId / id / field, else index.
  const nodes = new Map();
  (function walk(o, path) {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      if (typeof o.en === 'string' && Object.values(o).every((v) => typeof v === 'string')) { nodes.set(path, o); return; }
      for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
    } else if (Array.isArray(o)) {
      o.forEach((v, i) => {
        const key = v && typeof v === 'object' ? v.linkId ?? v.id ?? v.field : null;
        walk(v, `${path}[${typeof key === 'string' ? key : i}]`);
      });
    }
  })(pack, '');
  const report = [];
  for (const f of readdirSync(join(dir, 'i18n')).filter((f) => f.endsWith('.json'))) {
    const lang = f.replace('.json', '');
    const tr = JSON.parse(readFileSync(join(dir, 'i18n', f), 'utf8'));
    let n = 0;
    for (const [path, node] of nodes) if (typeof tr[path] === 'string' && tr[path].trim()) { node[lang] = tr[path]; n++; }
    const miss = Object.keys(src).filter((p) => !tr[p]);
    if (miss.length) incomplete = true;
    report.push(`${lang} ${n}/${nodes.size}${miss.length ? ` (missing ${miss.length})` : ''}`);
  }
  writeFileSync(file, JSON.stringify(pack, null, 2) + '\n');
  console.log(`${id}: ${report.join(' · ')}`);
}
if (process.argv.includes('--check') && incomplete) process.exitCode = 1;
