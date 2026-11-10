import { all as i18nAll } from './i18n/index.js';
// Device-display reading parser. Takes raw OCR output and returns a *candidate* only when the
// display is unambiguous. It never guesses a decimal point, never invents a unit, and every
// result still requires a human to compare it against the physical display.

const UNIT_PATTERNS = [
  { unit: 'g/dL', re: /g\s*[\/|]?\s*d\s*[lLI1|]\b/ },
  { unit: 'mmol/L', re: /mmol\s*[\/|]?\s*[lLI1|]\b/i },
  { unit: 'g/L', re: /g\s*[\/|]\s*[lLI1|]\b/ },
];

const UNIT_RANGES = {
  'g/dL': { min: 3, max: 20, expectDecimal: true },
  'g/L': { min: 30, max: 200, expectDecimal: false },
  'mmol/L': { min: 1.8, max: 12.5, expectDecimal: true },
};

/** Fix only character confusions that are unambiguous inside a numeric token. */
function repairToken(tok) {
  const fixes = [];
  let out = '';
  for (const ch of tok) {
    const rep = { O: '0', o: '0', D: '0', l: '1', I: '1', '|': '1', ',': '.' }[ch];
    if (rep !== undefined) {
      fixes.push(`${ch}→${rep}`);
      out += rep;
    } else out += ch;
  }
  return { out, fixes };
}

export function detectUnit(text) {
  const found = UNIT_PATTERNS.filter((u) => u.re.test(text)).map((u) => u.unit);
  return [...new Set(found)];
}

/**
 * @param {string} text  raw OCR text
 * @param {{words?: {text:string, confidence:number, h?:number}[], kind?: 'hb', minConfidence?: number}} opts
 * @returns {{status: 'candidate'|'ambiguous'|'decimal_suspect'|'no_reading'|'low_confidence'|'unit_conflict',
 *            value: number|null, unit: string|null, candidates: object[], reasons: string[], cleaned: string}}
 */
export function parseHbDisplay(text, opts = {}) {
  const minConfidence = opts.minConfidence ?? 50; // chosen on the calibration set (scripts/calib-confidence.js): tie → most conservative
  const reasons = [];
  const raw = String(text ?? '');
  // Remove things that look like numbers but are not the result.
  let cleaned = raw
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:[AaPp][Mm])\b/g, ' ') // 10:42 AM
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ') // 10:42
    .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, ' ') // dates
    .replace(/\b\d{1,3}\s*%/g, ' ') // battery %
    .replace(/\b(?:id|sn|s\/n|lot|ref|model|mem)\s*[:.#]?\s*[\w-]*\d[\w-]*/gi, ' ') // ids, memory slots
    .replace(/\bM\s*\d{1,3}\b/g, ' ') // memory index "M 03"
    .replace(/\b[A-Za-z]{1,6}-\d+[A-Za-z]*\b/g, ' '); // model names like HB-201
  // v2: a line labelled as an earlier/stored value is never the current reading.
  const labelled = /\b(?:prev(?:ious)?|last|mem(?:ory)?|avg|average|old|history)\b/i;
  if (labelled.test(cleaned)) {
    cleaned = cleaned.split('\n').map((l) => (labelled.test(l) ? ' ' : l)).join('\n');
    reasons.push('ignored a line labelled as a previous/stored value');
  }

  const units = detectUnit(cleaned);
  if (units.length > 1) return { status: 'unit_conflict', value: null, unit: null, candidates: [], reasons: ['multiple units visible'], cleaned };
  const unit = units[0] ?? null;
  if (!unit) reasons.push('unit not read: worker must select it');

  // Numeric tokens, allowing unambiguous OCR confusions inside them.
  const tokenRe = /(?<![A-Za-z])[0-9OoDlI|][0-9OoDlI|]*(?:[.,][0-9OoDlI|]+)?(?![A-Za-z])/g;
  const candidates = [];
  for (const m of cleaned.matchAll(tokenRe)) {
    if (!/\d/.test(m[0])) continue;
    const { out, fixes } = repairToken(m[0]);
    const value = Number(out);
    if (!Number.isFinite(value)) continue;
    candidates.push({ raw: m[0], value, hasDecimal: out.includes('.'), fixes, index: m.index });
  }
  // v2: "1 3.1" is a split "13.1" whose leading digit separated: never take the tail.
  for (const c of candidates) {
    const before = cleaned.slice(0, c.index);
    const after = cleaned.slice(c.index + c.raw.length);
    if (/\d[ \t]+$/.test(before) || /^[ \t]+\d/.test(after)) c.split = true;
  }
  if (candidates.some((c) => c.split && c.hasDecimal)) {
    return { status: 'ambiguous', value: null, unit: units[0] ?? null, candidates, reasons: ['digits are separated by spaces: the leading digit may be split off'], cleaned };
  }

  const range = UNIT_RANGES[unit ?? 'g/dL'];
  const inRange = candidates.filter((c) => c.value >= range.min && c.value <= range.max);
  // v2: a decimal display's reading always has a decimal point; bare integers are not candidates.
  const plausible = range.expectDecimal && inRange.some((c) => c.hasDecimal) ? inRange.filter((c) => c.hasDecimal) : inRange;
  const distinct = [...new Set(plausible.map((c) => c.value))];

  // A g/dL display showing e.g. "124" probably lost its decimal point. Never repair it.
  const decimalSuspect = (unit === 'g/dL' || unit === null) && candidates.some((c) => !c.hasDecimal && c.value >= 30 && c.value <= 200);
  if (plausible.length === 0) {
    if (decimalSuspect) return { status: 'decimal_suspect', value: null, unit, candidates, reasons: ['number looks like a reading without its decimal point; enter manually'], cleaned };
    return { status: 'no_reading', value: null, unit, candidates, reasons: ['no plausible reading found'], cleaned };
  }
  if (distinct.length > 1) return { status: 'ambiguous', value: null, unit, candidates: plausible, reasons: ['more than one plausible number on the display'], cleaned };

  const pick = plausible[0];
  if (range.expectDecimal && !pick.hasDecimal) {
    return { status: 'decimal_suspect', value: null, unit, candidates: plausible, reasons: ['expected a decimal reading (e.g. 11.4); decimal point not read'], cleaned };
  }
  if (decimalSuspect) reasons.push('another number on the display could be a reading without its decimal point');
  if (pick.fixes.length) reasons.push(`character repairs: ${pick.fixes.join(', ')}`);

  // Word-level evidence from the OCR engine, when available.
  if (opts.words?.length) {
    const digitWord = (x) => /\d/.test(x.text);
    const core = (t) => t.replace(/[^\dOoDlI|.,]/g, '');
    // v2: match the word that actually contains the number (empty strings never match).
    const w = opts.words.find((x) => core(x.text) === pick.raw) ?? opts.words.find((x) => core(x.text) && x.text.includes(pick.raw));
    if (w && w.confidence < minConfidence) {
      return { status: 'low_confidence', value: null, unit, candidates: plausible, reasons: [`OCR confidence ${Math.round(w.confidence)} < ${minConfidence}`], cleaned };
    }
    // v2: the result is the biggest number on a meter display. A small number (e.g. a
    // stored value) when bigger digits were seen but not read is not trusted.
    const hs = opts.words.filter((x) => digitWord(x) && x.h).map((x) => x.h);
    if (w?.h && hs.length > 1 && w.h < 0.7 * Math.max(...hs)) {
      return { status: 'ambiguous', value: null, unit, candidates: plausible, reasons: ['larger digits on the display were not read'], cleaned };
    }
  }
  return { status: 'candidate', value: pick.value, unit, candidates: plausible, reasons, cleaned };
}

/**
 * Combine the parses of two preprocessing variants (grey, binary). Accept a value only if both
 * agree, or one reads it and the other is silent. Disagreement is rejection, never a vote.
 */
export function combineVariants(a, b) {
  const cand = (r) => r.status === 'candidate';
  if (cand(a) && cand(b)) {
    if (a.value !== b.value) return { status: 'ambiguous', value: null, unit: null, candidates: [], reasons: [`variants disagree: ${a.value} vs ${b.value}`], agreement: 'disagree' };
    if (a.unit && b.unit && a.unit !== b.unit) return { status: 'unit_conflict', value: null, unit: null, candidates: [], reasons: [`variants read different units: ${a.unit} vs ${b.unit}`], agreement: 'disagree' };
    return { status: 'candidate', value: a.value, unit: a.unit === b.unit ? a.unit : null, candidates: a.candidates, reasons: [...a.reasons], agreement: 'both' };
  }
  if (cand(a) || cand(b)) {
    const c = cand(a) ? a : b, o = cand(a) ? b : a;
    const silent = o.status === 'no_reading' || (o.status === 'low_confidence' && (o.candidates ?? []).every((x) => x.value === c.value));
    if (!silent) return { status: o.status === 'low_confidence' ? 'ambiguous' : o.status, value: null, unit: null, candidates: [], reasons: [`one variant read ${c.value}, the other says ${o.status}`], agreement: 'disagree' };
    const unit = !o.unit || o.unit === c.unit ? c.unit : null;
    return { status: 'candidate', value: c.value, unit, candidates: c.candidates, reasons: [...c.reasons, `only one variant read a value (other: ${o.status})`], agreement: 'single' };
  }
  const order = ['unit_conflict', 'ambiguous', 'decimal_suspect', 'low_confidence', 'no_reading'];
  const worst = order.find((st) => a.status === st || b.status === st) ?? a.status;
  return { status: worst, value: null, unit: null, candidates: [], reasons: [...new Set([...a.reasons, ...b.reasons])], agreement: 'none' };
}

export const OCR_STATUS_TEXT = Object.fromEntries(
  ['candidate', 'ambiguous', 'decimal_suspect', 'no_reading', 'low_confidence', 'unit_conflict'].map((k) => [k, i18nAll(`ocr.${k}`)]),
);
