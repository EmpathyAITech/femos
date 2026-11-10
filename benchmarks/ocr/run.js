// FEMOS OCR benchmark runner.
//
//   node benchmarks/ocr/run.js               run the chosen configuration on the test set → results/ocr.json
//   node benchmarks/ocr/run.js --calibrate   compare candidate configurations on the CALIBRATION set only
//                                            (different seed) → benchmarks/ocr/calibration.json
//
// Fully offline: the traineddata is read from node_modules/@tesseract.js-data/eng/4.0.0_best_int.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { parseHbDisplay } from '../../core/ocr.js';
import { PRE, preparePanel } from './preprocess.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const require = createRequire(import.meta.url);
const TESS_VERSION = require('tesseract.js/package.json').version;
export const LANG_PATH = join(ROOT, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');
export const WHITELIST = '0123456789.,gdLlmo/ %:-EHbM';

// Chosen ONCE from the calibration set (see benchmarks/ocr/calibration.json); not tuned on the test set.
export const CONFIG = Object.freeze({ psm: '6', whitelist: false, outWidth: PRE.outWidth, dilate: true }); // calibration.json (parser v2)

export const PREPROCESSING =
  `sharp/canvas: greyscale → resize to width ${PRE.analysisWidth} → [preprocess.js] contrast stretch (1st–99th percentile) → ` +
  `Otsu threshold → display panel = largest light 4-connected region not touching the photo border and ≥${PRE.minPanelFrac * 100}% of the area ` +
  `(fallback: whole photo) → crop to its bounding box → re-stretch + Otsu inside the crop → paint dark regions connected to the crop border white → ` +
  `two variants: A = stretched greyscale, B = Otsu black/white → resize to width ${PRE.outWidth} → pad ${PRE.pad}px white`;

export const RULE =
  'Each variant is parsed by core/ocr.js parseHbDisplay. Accept only if (a) both variants return status "candidate" with the same value ' +
  '(unit kept only if both read the same unit; one unit missing → unit null, worker selects; two different units → reject), or ' +
  '(b) exactly one variant returns "candidate" and the other returns "no_reading" (no plausible number, no decimal-less number) or ' +
  '"low_confidence" whose plausible numbers all equal the candidate value; unit then kept only if the other variant read no unit or the same unit. ' +
  'Anything else — different values, ambiguous/decimal_suspect/unit_conflict in either variant beside a candidate, or no candidate at all — is rejected ' +
  'and the worker types the reading.';

export async function makeWorker(cfg = CONFIG) {
  const cachePath = join(tmpdir(), 'femos-tess-cache');
  mkdirSync(cachePath, { recursive: true });
  const w = await createWorker('eng', 1, { langPath: LANG_PATH, cachePath, cacheMethod: 'none', gzip: true });
  await w.setParameters({
    tessedit_pageseg_mode: cfg.psm,
    tessedit_char_whitelist: cfg.whitelist ? WHITELIST : '',
    user_defined_dpi: '300',
  });
  return w;
}

/** Steps 1–7: returns two PNG buffers (variant A grey, variant B binary). */
export async function preprocess(input, cfg = CONFIG) {
  const { data, info } = await sharp(input).greyscale().resize({ width: PRE.analysisWidth }).raw().toBuffer({ resolveWithObject: true });
  const grey = info.channels === 1 ? data : Uint8Array.from({ length: info.width * info.height }, (_, i) => data[i * info.channels]);
  const p = preparePanel(grey, info.width, info.height, { dilate: !!cfg.dilate });
  const out = async (buf) =>
    sharp(Buffer.from(buf), { raw: { width: p.w, height: p.h, channels: 1 } })
      .resize({ width: cfg.outWidth })
      .extend({ top: PRE.pad, bottom: PRE.pad, left: PRE.pad, right: PRE.pad, background: '#ffffff' })
      .png()
      .toBuffer();
  return { panel: p.panel, variants: [{ name: 'grey', png: await out(p.grey) }, { name: 'binary', png: await out(p.binary) }] };
}

async function ocr(worker, png) {
  const r = await worker.recognize(png, {}, { text: true, blocks: true });
  const words = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((x) => ({ text: x.text, confidence: Math.round(x.confidence), h: x.bbox.y1 - x.bbox.y0 })))));
  return { text: r.data.text, words };
}

/** The variant-agreement rule (see RULE) lives in core so the phone uses the same rule. */
export { combineVariants as combine } from '../../core/ocr.js';
import { combineVariants as combine } from '../../core/ocr.js';

export function outcome(final, truth) {
  if (final.status !== 'candidate') return 'rejected';
  if (!truth) return 'unsafe';
  if (final.value === truth.value && (final.unit == null || final.unit === truth.unit)) return 'correct';
  return 'unsafe';
}

/** Read one image end-to-end. */
export async function readImage(worker, input, cfg = CONFIG) {
  const t0 = performance.now();
  const pre = await preprocess(input, cfg);
  const per = [];
  for (const v of pre.variants) {
    const o = await ocr(worker, v.png);
    const parsed = parseHbDisplay(o.text, { words: o.words });
    per.push({ variant: v.name, text: o.text, words: o.words, parsed });
  }
  const final = combine(per[0].parsed, per[1].parsed);
  return { final, per, panel: pre.panel, ms: Math.round(performance.now() - t0) };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export async function runSet(dir, cfg = CONFIG, { log = false } = {}) {
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const worker = await makeWorker(cfg);
  const rows = [];
  try {
    for (const l of labels) {
      const r = await readImage(worker, join(dir, l.file), cfg);
      const row = {
        file: l.file, condition: l.condition, truth: l.truth, notes: l.notes, outcome: outcome(r.final, l.truth),
        read: { status: r.final.status, value: r.final.value, unit: r.final.unit, agreement: r.final.agreement, reasons: r.final.reasons },
        variants: r.per.map((p) => ({ variant: p.variant, text: p.text, words: p.words, status: p.parsed.status, value: p.parsed.value, unit: p.parsed.unit, outcome: outcome(p.parsed, l.truth) })),
        panelFound: !!r.panel, ms: r.ms,
      };
      rows.push(row);
      if (log) process.stdout.write(row.outcome === 'correct' ? '.' : row.outcome === 'rejected' ? 'r' : 'X');
    }
  } finally {
    await worker.terminate();
  }
  if (log) process.stdout.write('\n');
  return rows;
}

export function summarise(rows, key = 'outcome') {
  const s = { images: rows.length, correct: 0, rejected: 0, unsafe: 0, byCondition: {} };
  for (const r of rows) {
    const o = typeof key === 'function' ? key(r) : r[key];
    s[o]++;
    const c = (s.byCondition[r.condition] ??= { n: 0, correct: 0, rejected: 0, unsafe: 0 });
    c.n++;
    c[o]++;
  }
  s.correctRate = Math.round((s.correct / s.images) * 1000) / 1000;
  s.unsafeRate = Math.round((s.unsafe / s.images) * 1000) / 1000;
  return s;
}

function table(s) {
  const lines = ['condition        n  correct rejected unsafe', '---------------  -- ------- -------- ------'];
  for (const [c, v] of Object.entries(s.byCondition)) lines.push(`${c.padEnd(15)} ${String(v.n).padStart(3)} ${String(v.correct).padStart(7)} ${String(v.rejected).padStart(8)} ${String(v.unsafe).padStart(6)}`);
  lines.push(`${'TOTAL'.padEnd(15)} ${String(s.images).padStart(3)} ${String(s.correct).padStart(7)} ${String(s.rejected).padStart(8)} ${String(s.unsafe).padStart(6)}`);
  return lines.join('\n');
}

async function calibrate() {
  const grid = [];
  for (const outWidth of [500, 700]) for (const psm of ['6', '11']) for (const whitelist of [true, false]) for (const dilate of [false, true]) grid.push({ psm, whitelist, outWidth, dilate });
  const out = [];
  for (const cfg of grid) {
    const t0 = Date.now();
    const rows = await runSet(join(HERE, 'calib'), cfg);
    const s = summarise(rows);
    const single = { grey: summarise(rows, (r) => r.variants[0].outcome), binary: summarise(rows, (r) => r.variants[1].outcome) };
    out.push({ cfg, combined: { correct: s.correct, rejected: s.rejected, unsafe: s.unsafe }, byCondition: Object.fromEntries(Object.entries(s.byCondition).map(([k, v]) => [k, `${v.correct}/${v.n}` + (v.unsafe ? ` (${v.unsafe} unsafe)` : '')])), greyOnly: { correct: single.grey.correct, unsafe: single.grey.unsafe }, binaryOnly: { correct: single.binary.correct, unsafe: single.binary.unsafe }, seconds: (Date.now() - t0) / 1000 });
    console.log(JSON.stringify(out.at(-1)));
  }
  // selection rule, fixed in advance: fewest unsafe, then most correct, then psm 6 / whitelist on
  const best = [...out].sort( // Array sort is stable: ties keep grid order
   (a, b) => a.combined.unsafe - b.combined.unsafe || b.combined.correct - a.combined.correct)[0];
  writeFileSync(join(HERE, 'calibration.json'), JSON.stringify({ generatedAt: new Date().toISOString(), set: 'benchmarks/ocr/calib (seed 7, 6 per condition, 84 images)', selection: 'fewest unsafe, then most correct', results: out, chosen: best.cfg }, null, 1));
  console.log('chosen', best.cfg);
}

async function main() {
  const t0 = Date.now();
  // --set holdout: a fresh seed never looked at while changing the parser.
  const holdout = process.argv.includes('--holdout');
  const SET = holdout ? join(HERE, 'holdout') : HERE;
  const rows = await runSet(SET, CONFIG, { log: true });
  const s = summarise(rows);
  const single = { grey: summarise(rows, (r) => r.variants[0].outcome), binary: summarise(rows, (r) => r.variants[1].outcome) };
  const result = {
    generatedAt: new Date().toISOString(),
    engine: `tesseract.js ${TESS_VERSION} eng best_int`,
    ocrParams: { tessedit_pageseg_mode: CONFIG.psm, tessedit_char_whitelist: CONFIG.whitelist ? WHITELIST : null, oem: 'LSTM (1)' },
    preprocessing: PREPROCESSING,
    rule: RULE,
    images: s.images, correct: s.correct, rejected: s.rejected, unsafe: s.unsafe, correctRate: s.correctRate, unsafeRate: s.unsafeRate,
    byCondition: s.byCondition,
    singleVariant: {
      grey: { correct: single.grey.correct, rejected: single.grey.rejected, unsafe: single.grey.unsafe },
      binary: { correct: single.binary.correct, rejected: single.binary.rejected, unsafe: single.binary.unsafe },
    },
    unsafeExamples: rows.filter((r) => r.outcome === 'unsafe').map((r) => ({ file: r.file, truth: r.truth, read: { value: r.read.value, unit: r.read.unit, status: r.read.status }, text: r.variants.map((v) => `${v.variant}: ${v.text.trim()}`).join(' | ') })),
    medianMs: median(rows.map((r) => r.ms)),
    totalSeconds: Math.round((Date.now() - t0) / 100) / 10,
    dataset: holdout ? 'benchmarks/ocr/holdout/labels.json (synthetic, fresh seed 20261110, generated after parser v2 changes, never used for tuning)' : 'benchmarks/ocr/labels.json (synthetic, seed 20261109)',
    parser: 'core/ocr.js v2',
  };
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  writeFileSync(join(ROOT, 'results', holdout ? 'ocr.json' : 'ocr-testset-v2.json'), JSON.stringify(result, null, 1));
  writeFileSync(join(SET, 'last-run.json'), JSON.stringify({ generatedAt: result.generatedAt, config: CONFIG, rows }, null, 1));
  console.log(table(s));
  console.log(`correct ${(s.correctRate * 100).toFixed(1)}%  unsafe ${(s.unsafeRate * 100).toFixed(1)}%  median ${result.medianMs} ms/image (2 OCR passes)  total ${result.totalSeconds}s`);
  console.log(`single-variant baselines: grey correct ${single.grey.correct} unsafe ${single.grey.unsafe}; binary correct ${single.binary.correct} unsafe ${single.binary.unsafe}`);
  for (const u of result.unsafeExamples) console.log('UNSAFE', JSON.stringify(u));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--calibrate')) await calibrate();
  else await main();
}
