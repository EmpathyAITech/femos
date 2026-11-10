// Synthetic haemoglobin-meter display generator for the FEMOS OCR benchmark.
//
//   node benchmarks/ocr/gen.js            → benchmarks/ocr/images/ + labels.json   (test set)
//                                         → benchmarks/ocr/calib/  + labels.json   (calibration set, other seed)
//
// Everything is deterministic: a seeded PRNG drives every random choice, displays are drawn as SVG,
// rasterised with sharp and degraded with sharp (or pixel maths driven by the same PRNG).
// The calibration set uses a different seed and is the ONLY set used to choose OCR settings.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CONDITIONS = [
  'clean', 'seven_segment', 'distractors', 'low_contrast', 'blur', 'glare', 'rotation', 'skew',
  'small', 'noise', 'g_per_L', 'hard_decimal', 'two_values', 'no_reading',
];
export const TEST_SEED = 20261109;
export const CALIB_SEED = 7;

/** mulberry32: small, fast, deterministic. */
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    uni: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss: () => {
      const u = Math.max(next(), 1e-12), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return r;
}

// ---------------------------------------------------------------- drawing primitives
const W = 640, H = 420;
const LCD = { x: 70, y: 70, w: 500, h: 260 };
const TABLES = ['#2b2b2b', '#d9d4c7', '#6b5a48', '#9aa3ab'];
const BEZELS = ['#22262b', '#2f3a4a', '#3a3a3a', '#e6e6e2', '#c9ccd1'];
const PANELS = ['#b9c7a3', '#c3cbb8', '#aebfa0', '#c8ccc4', '#bcc6b4'];
const INKS = ['#1b2118', '#202020', '#16201c', '#262b22'];
const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS'];
const BRANDS = ['HemoCheck', 'HbMeter', 'Haemo Pro', 'HemoSure', 'Hb Plus'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function mix(hexA, hexB, t) {
  const a = hexA.match(/\w\w/g).map((x) => parseInt(x, 16));
  const b = hexB.match(/\w\w/g).map((x) => parseInt(x, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Seven-segment glyphs (segments a b c d e f g).
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  L: 'def', o: 'cdeg', E: 'adefg', H: 'bcefg', i: 'c', '-': 'g', r: 'eg', ' ': '',
};
function segPolys(x, y, w, h, t) {
  const g = Math.max(2, t * 0.18), ht = t / 2, mid = y + h / 2;
  const hor = (x0, x1, yc) => [[x0, yc], [x0 + ht, yc - ht], [x1 - ht, yc - ht], [x1, yc], [x1 - ht, yc + ht], [x0 + ht, yc + ht]];
  const ver = (xc, y0, y1) => [[xc, y0], [xc + ht, y0 + ht], [xc + ht, y1 - ht], [xc, y1], [xc - ht, y1 - ht], [xc - ht, y0 + ht]];
  return {
    a: hor(x + g, x + w - g, y), g: hor(x + g, x + w - g, mid), d: hor(x + g, x + w - g, y + h),
    f: ver(x, y + g, mid - g), b: ver(x + w, y + g, mid - g), e: ver(x, mid + g, y + h - g), c: ver(x + w, mid + g, y + h - g),
  };
}
/** Draw a string in seven-segment style. `dotOpacity` lets hard_decimal fade the decimal point. */
function sevenSeg(str, { x, y, h, ink, ghost = 0, dotOpacity = 1, slant = 0 }) {
  const w = h * 0.5, t = h * 0.12, adv = w + t * 2.2;
  let cx = x, out = '';
  for (const ch of str) {
    if (ch === '.') {
      out += `<rect x="${(cx - t * 1.6).toFixed(1)}" y="${(y + h - t * 0.5).toFixed(1)}" width="${t.toFixed(1)}" height="${t.toFixed(1)}" fill="${ink}" fill-opacity="${dotOpacity}"/>`;
      cx += t * 1.2;
      continue;
    }
    const on = SEG[ch] ?? '';
    const polys = segPolys(cx, y, w, h, t);
    for (const [k, pts] of Object.entries(polys)) {
      const lit = on.includes(k);
      if (!lit && !ghost) continue;
      out += `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${ink}"${lit ? '' : ` fill-opacity="${ghost}"`}/>`;
    }
    cx += adv;
  }
  return { svg: `<g transform="skewX(${slant})">${out}</g>`, width: cx - x };
}
/** Draw a value in a proportional sans font; the decimal point can be faded. */
function sansValue(str, { x, y, size, ink, font, weight, dotOpacity = 1 }) {
  const parts = str.split('.');
  const tsp = parts.length === 2 ? `${esc(parts[0])}<tspan fill-opacity="${dotOpacity}">.</tspan>${esc(parts[1])}` : esc(str);
  return { svg: `<text x="${x}" y="${y}" font-family="${font}, sans-serif" font-weight="${weight}" font-size="${size}" fill="${ink}">${tsp}</text>`, width: size * 0.56 * str.length };
}

function displaySvg(d) {
  const ink = d.ink, panel = d.panel;
  let lcd = '';
  const label = (txt, x, y, size = 22, anchor = 'start') => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${ink}" text-anchor="${anchor}">${esc(txt)}</text>`;
  lcd += label('Hb', LCD.x + 18, LCD.y + 34, 24);
  for (const o of d.extras) lcd += label(o.text, o.x, o.y, o.size ?? 22, o.anchor);
  // main value
  const baseY = LCD.y + 175;
  let vx = LCD.x + 60;
  if (d.main != null) {
    if (d.style === 'seg') {
      const h = d.size;
      const s = sevenSeg(d.main, { x: vx, y: baseY - h, h, ink, ghost: d.ghost, dotOpacity: d.dotOpacity, slant: d.slant });
      lcd += s.svg;
      vx += s.width;
    } else {
      const s = sansValue(d.main, { x: vx, y: baseY, size: d.size, ink, font: d.font, weight: d.weight, dotOpacity: d.dotOpacity });
      lcd += s.svg;
      vx += s.width;
    }
  }
  if (d.unit) lcd += label(d.unit, Math.min(vx + 26, LCD.x + LCD.w - 95), baseY, d.unitSize);
  const brand = `<text x="${W / 2}" y="55" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="${d.brandInk}" text-anchor="middle">${esc(d.brand)}</text>`;
  const model = d.model ? `<text x="${W / 2}" y="375" font-family="Arial, sans-serif" font-size="18" fill="${d.brandInk}" text-anchor="middle">${esc(d.model)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${panel}"/><stop offset="1" stop-color="${mix(panel, '#000000', 0.08)}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="${d.table}"/>
<rect x="30" y="22" width="580" height="376" rx="34" fill="${d.bezel}"/>
<rect x="${LCD.x - 6}" y="${LCD.y - 6}" width="${LCD.w + 12}" height="${LCD.h + 12}" rx="8" fill="#111111"/>
<rect x="${LCD.x}" y="${LCD.y}" width="${LCD.w}" height="${LCD.h}" rx="4" fill="url(#lg)"/>
${brand}${model}
${lcd}
</svg>`;
}

// ---------------------------------------------------------------- specs
const hbValue = (r) => Math.round(r.uni(50, 165)) / 10;
const fmt = (v) => v.toFixed(1);

/** Build the deterministic list of image specs (no rendering). */
export function buildSpecs(seed = TEST_SEED, perCondition = 11) {
  const r = prng(seed);
  const specs = [];
  for (const condition of CONDITIONS) {
    for (let i = 0; i < perCondition; i++) {
      const base = {
        table: r.pick(TABLES), bezel: r.pick(BEZELS), panel: r.pick(PANELS), ink: r.pick(INKS), font: r.pick(FONTS),
        weight: r.next() < 0.3 ? 'bold' : 'normal', brand: r.pick(BRANDS), extras: [], ghost: 0, dotOpacity: 1, slant: 0,
        unit: 'g/dL', unitSize: r.int(32, 42),
      };
      base.brandInk = base.bezel > '#8' ? '#333333' : '#e8e8e8';
      // displays under degradation conditions use either style, chosen by the PRNG
      const segChance = condition === 'seven_segment' ? 1 : condition === 'clean' || condition === 'distractors' ? 0 : 0.4;
      base.style = r.next() < segChance ? 'seg' : 'sans';
      if (base.style === 'seg') {
        base.size = r.int(100, 125);
        base.ghost = r.next() < 0.5 ? Math.round(r.uni(0.04, 0.09) * 100) / 100 : 0;
        base.slant = r.next() < 0.5 ? -r.int(4, 8) : 0;
      } else base.size = r.int(105, 130);
      let truth = { value: hbValue(r), unit: 'g/dL' };
      base.main = base.style === 'seg' && truth.value < 10 ? ' ' + fmt(truth.value) : fmt(truth.value);
      const degrade = [];
      const notes = [];

      switch (condition) {
        case 'clean': case 'seven_segment': break;
        case 'distractors': {
          const hh = r.int(6, 18), mm = r.int(0, 59);
          base.extras.push({ text: `${hh}:${String(mm).padStart(2, '0')}`, x: LCD.x + LCD.w - 18, y: LCD.y + 34, anchor: 'end' });
          base.extras.push({ text: `${r.int(15, 100)}%`, x: LCD.x + LCD.w / 2, y: LCD.y + 34, anchor: 'middle' });
          base.extras.push({ text: `M ${String(r.int(1, 99)).padStart(2, '0')}`, x: LCD.x + 18, y: LCD.y + LCD.h - 22 });
          base.extras.push({ text: `${String(r.int(1, 28)).padStart(2, '0')}/${String(r.int(1, 12)).padStart(2, '0')}/26`, x: LCD.x + LCD.w - 18, y: LCD.y + LCD.h - 22, anchor: 'end' });
          base.model = `HB-${r.int(100, 999)}`;
          notes.push('time, battery %, memory slot, date on LCD; model on bezel');
          break;
        }
        case 'low_contrast': {
          const t = Math.round(r.uni(0.62, 0.75) * 100) / 100;
          base.ink = mix(base.ink, base.panel, t);
          degrade.push({ op: 'linear', a: 0.6, b: 50 });
          notes.push(`ink ${Math.round(t * 100)}% towards panel colour, global contrast 0.6`);
          break;
        }
        case 'blur': { const s = Math.round(r.uni(1, 2.5) * 10) / 10; degrade.push({ op: 'blur', sigma: s }); notes.push(`gaussian blur sigma ${s}`); break; }
        case 'glare': {
          const g = { op: 'glare', cx: r.int(LCD.x + 60, LCD.x + LCD.w - 60), cy: r.int(LCD.y + 40, LCD.y + LCD.h - 40), rad: r.int(110, 200), opacity: Math.round(r.uni(0.7, 0.92) * 100) / 100 };
          degrade.push(g);
          notes.push(`white radial glare r=${g.rad} opacity ${g.opacity}`);
          break;
        }
        case 'rotation': { const a = Math.round(r.sign() * r.uni(4, 10) * 10) / 10; degrade.push({ op: 'rotate', angle: a }); notes.push(`rotated ${a}°`); break; }
        case 'skew': {
          const kx = Math.round(r.sign() * r.uni(0.12, 0.28) * 100) / 100, ky = Math.round(r.sign() * r.uni(0.02, 0.07) * 100) / 100, sy = Math.round(r.uni(0.8, 0.95) * 100) / 100;
          degrade.push({ op: 'affine', m: [[1, kx], [ky, sy]] });
          notes.push(`affine shear kx=${kx} ky=${ky} sy=${sy} (perspective-like)`);
          break;
        }
        case 'small': { const w = r.int(170, 260); degrade.push({ op: 'downscale', width: w }); notes.push(`downscaled to ${w}px wide`); break; }
        case 'noise': { const s = r.int(18, 34); degrade.push({ op: 'noise', sigma: s, seed: r.int(1, 1e9) }); notes.push(`gaussian pixel noise sigma ${s}`); break; }
        case 'g_per_L': {
          const v = Math.round(truth.value * 10);
          truth = { value: v, unit: 'g/L' };
          base.main = String(v);
          base.unit = 'g/L';
          notes.push('device configured to g/L');
          break;
        }
        case 'hard_decimal': {
          base.dotOpacity = r.next() < 0.5 ? 0 : Math.round(r.uni(0.05, 0.15) * 100) / 100;
          notes.push(base.dotOpacity === 0 ? 'decimal point missing' : `decimal point opacity ${base.dotOpacity}`);
          if (r.next() < 0.4) { const s = Math.round(r.uni(0.8, 1.4) * 10) / 10; degrade.push({ op: 'blur', sigma: s }); notes.push(`blur ${s}`); }
          break;
        }
        case 'two_values': {
          const prev = hbValue(r);
          const kind = r.pick(['prev', 'last', 'mem']);
          const txt = kind === 'prev' ? `PREV ${fmt(prev)} g/dL` : kind === 'last' ? `Last ${fmt(prev)} g/dL` : `${fmt(prev)} g/dL`;
          base.extras.push({ text: txt, x: LCD.x + LCD.w - 18, y: LCD.y + LCD.h - 20, size: 34, anchor: 'end' });
          notes.push(`previous reading ${fmt(prev)} also shown ("${txt}")`);
          break;
        }
        case 'no_reading': {
          const kind = r.pick(['E-3', 'Lo', 'Hi', 'blank', '---', 'Err']);
          truth = null;
          if (kind === 'blank') { base.main = null; base.unit = null; }
          else if (kind === 'Err') { base.main = base.style === 'seg' ? `Er ${r.int(1, 9)}` : `Err ${r.int(1, 9)}`; base.unit = null; }
          else { base.main = kind; base.unit = kind === 'E-3' || kind === '---' ? null : base.unit; }
          if (base.style === 'seg' && base.main) base.main = base.main.replace('Err', 'Er').replace('---', '---');
          notes.push(`error/blank screen: ${kind}`);
          break;
        }
      }
      specs.push({ id: `${condition}_${String(i + 1).padStart(2, '0')}`, condition, truth, display: base, degrade, notes: [base.style === 'seg' ? 'seven-segment' : `sans (${base.font})`, ...notes].join('; ') });
    }
  }
  return specs;
}

export const specSvg = (spec) => displaySvg(spec.display);

/** Rasterise and degrade one spec. Returns a PNG buffer. */
export async function render(spec) {
  let img = sharp(Buffer.from(specSvg(spec))).flatten({ background: spec.display.table });
  let buf = await img.png().toBuffer();
  for (const d of spec.degrade) {
    const bg = spec.display.table;
    if (d.op === 'blur') buf = await sharp(buf).blur(d.sigma).png().toBuffer();
    else if (d.op === 'linear') buf = await sharp(buf).linear(d.a, d.b).png().toBuffer();
    else if (d.op === 'rotate') buf = await sharp(buf).rotate(d.angle, { background: bg }).png().toBuffer();
    else if (d.op === 'affine') buf = await sharp(buf).affine(d.m, { background: bg, interpolator: 'bilinear' }).flatten({ background: bg }).png().toBuffer();
    else if (d.op === 'downscale') buf = await sharp(buf).resize({ width: d.width }).png().toBuffer();
    else if (d.op === 'glare') {
      const ov = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="${d.cx}" cy="${d.cy}" r="${d.rad}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="${d.opacity}"/><stop offset="0.55" stop-color="#fff" stop-opacity="${(d.opacity * 0.55).toFixed(2)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`;
      buf = await sharp(buf).composite([{ input: Buffer.from(ov) }]).png().toBuffer();
    } else if (d.op === 'noise') {
      const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const nr = prng(d.seed);
      for (let p = 0; p < data.length; p += info.channels) {
        const n = nr.gauss() * d.sigma; // luminance-like noise, plus a little chroma noise
        for (let c = 0; c < info.channels; c++) data[p + c] = Math.max(0, Math.min(255, Math.round(data[p + c] + n + nr.gauss() * d.sigma * 0.25)));
      }
      buf = await sharp(data, { raw: info }).png().toBuffer();
    }
  }
  return sharp(buf).removeAlpha().png().toBuffer();
}

export async function generate({ seed, perCondition, outDir }) {
  rmSync(join(outDir, 'images'), { recursive: true, force: true });
  mkdirSync(join(outDir, 'images'), { recursive: true });
  const specs = buildSpecs(seed, perCondition);
  const labels = [];
  for (const s of specs) {
    const file = `images/${s.id}.png`;
    writeFileSync(join(outDir, file), await render(s));
    labels.push({ file, truth: s.truth, condition: s.condition, notes: s.notes });
  }
  writeFileSync(join(outDir, 'labels.json'), JSON.stringify(labels, null, 1));
  return labels;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  // test set lives directly in benchmarks/ocr/{images,labels.json}
  const test = await generate({ seed: TEST_SEED, perCondition: 11, outDir: HERE });
  const calib = await generate({ seed: CALIB_SEED, perCondition: 6, outDir: join(HERE, 'calib') });
  const hold = await generate({ seed: 20261110, perCondition: 11, outDir: join(HERE, 'holdout') });
  console.log(`generated ${hold.length} held-out images (seed 20261110)`);
  console.log(`generated ${test.length} test images and ${calib.length} calibration images in ${Date.now() - t0} ms`);
}
