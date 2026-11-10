// Choose the OCR word-confidence threshold on the CALIBRATION set only (seed 7).
// Rule fixed in advance: fewest unsafe, then most correct.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorker, preprocess, outcome } from '../benchmarks/ocr/run.js';
import { parseHbDisplay, combineVariants } from '../core/ocr.js';
const dir = 'benchmarks/ocr/calib';
const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
const w = await makeWorker();
const raw = [];
for (const l of labels) {
  const pre = await preprocess(readFileSync(join(dir, l.file)));
  const per = [];
  for (const v of pre.variants) {
    const r = await w.recognize(v.png, {}, { text: true, blocks: true });
    const words = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((li) => li.words.map((x) => ({ text: x.text, confidence: Math.round(x.confidence), h: x.bbox.y1 - x.bbox.y0 })))));
    per.push({ text: r.data.text, words });
  }
  raw.push({ l, per });
}
await w.terminate();
const res = [];
for (const t of [0, 20, 30, 40, 50, 60, 70]) {
  const s = { t, correct: 0, rejected: 0, unsafe: 0 };
  for (const { l, per } of raw) s[outcome(combineVariants(...per.map((p) => parseHbDisplay(p.text, { words: p.words, minConfidence: t }))), l.truth)]++;
  res.push(s);
  console.log(JSON.stringify(s));
}
const best = [...res].sort((a, b) => a.unsafe - b.unsafe || b.correct - a.correct)[0];
console.log('chosen', best);
