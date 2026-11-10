// Quick checks of the benchmark harnesses (kept small so `npm test` stays fast).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSpecs, specSvg, render, TEST_SEED } from '../benchmarks/ocr/gen.js';
import { makeWorker, readImage, outcome, combine } from '../benchmarks/ocr/run.js';
import { buildCases, evaluate, score, ERROR_TYPES } from '../benchmarks/checks/run.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const OCR_DIR = new URL('../benchmarks/ocr/', import.meta.url);

test('OCR generator is deterministic (specs, SVG and pixels)', async () => {
  const a = buildSpecs(TEST_SEED, 2), b = buildSpecs(TEST_SEED, 2);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, buildSpecs(TEST_SEED + 1, 2));
  assert.equal(specSvg(a[5]), specSvg(b[5]));
  const noisy = a.find((s) => s.condition === 'noise');
  assert.equal(sha(await render(noisy)), sha(await render(buildSpecs(TEST_SEED, 2).find((s) => s.condition === 'noise'))));
  // the committed labels match the generator
  const labels = JSON.parse(readFileSync(new URL('labels.json', OCR_DIR)));
  const full = buildSpecs(TEST_SEED, 11);
  assert.equal(labels.length, full.length);
  assert.deepEqual(labels.map((l) => [l.file, l.truth, l.condition]), full.map((s) => [`images/${s.id}.png`, s.truth, s.condition]));
});

test('agreement rule: variants must agree; a silent variant is not a contradiction', () => {
  const c = (value, unit = 'g/dL') => ({ status: 'candidate', value, unit, candidates: [{ value }], reasons: [] });
  const none = { status: 'no_reading', value: null, unit: null, candidates: [], reasons: [] };
  assert.equal(combine(c(11.4), c(11.4)).status, 'candidate');
  assert.equal(combine(c(13.8), c(3.8)).status, 'ambiguous');
  assert.equal(combine(c(11.4), none).value, 11.4);
  assert.equal(combine(c(11.4), { status: 'decimal_suspect', value: null, unit: null, candidates: [{ value: 114 }], reasons: [] }).status, 'decimal_suspect');
  assert.equal(combine(c(11.4, 'g/dL'), c(11.4, null)).unit, null);
  assert.equal(outcome({ status: 'candidate', value: 9 }, null), 'unsafe');
});

test('OCR end-to-end on a few generated images (offline tesseract)', { timeout: 60000 }, async () => {
  const worker = await makeWorker();
  try {
    const labels = JSON.parse(readFileSync(new URL('labels.json', OCR_DIR)));
    const pick = ['images/clean_01.png', 'images/clean_02.png', 'images/clean_08.png', 'images/clean_04.png', 'images/no_reading_01.png'];
    for (const file of pick) {
      const l = labels.find((x) => x.file === file);
      const r = await readImage(worker, new URL(file, OCR_DIR).pathname);
      const o = outcome(r.final, l.truth);
      assert.notEqual(o, 'unsafe', `${file}: proposed ${r.final.value}`);
      if (/clean_0[18]/.test(file)) assert.equal(o, 'correct', `${file}: ${r.final.status} ${JSON.stringify(r.per.map((p) => p.text))}`);
      // clean_02's digits read at low word confidence: rejecting is the safe, expected behaviour.
    }
  } finally {
    await worker.terminate();
  }
});

test('planted-error runner detects every planted type on a small subset', () => {
  const built = buildCases({ clean: 3, perType: 1 });
  const rows = evaluate(built);
  const s = score(rows);
  assert.equal(s.plantedCases, ERROR_TYPES.length);
  for (const t of ERROR_TYPES) assert.equal(s.byType[t].detected, 1, `${t} not detected: ${JSON.stringify(rows.find((r) => r.expected === t))}`);
  assert.equal(s.blocking.blocked, s.blocking.shouldBlock);
  assert.equal(s.cleanBlocked, 0);
  // deterministic
  assert.deepEqual(buildCases({ clean: 3, perType: 1 }).events, built.events);
});
