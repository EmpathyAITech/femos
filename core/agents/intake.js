// Intake agent (deterministic baseline). Turns free text into draft questionnaire answers, with
// the exact span each answer came from. Languages: English, Hindi (and Hinglish), Bengali,
// Marathi, Tamil, each a lexicon in core/i18n/intake/. All lexicons are combined, so mixed-language
// speech ("Mahwari 9 din, chakkar aate hain") works without choosing a language first.
// A symptom is set to "no" only when the text explicitly negates it: silence is never a negative.
// An LLM-backed extractor (server/llm.js) may replace this but must return the same shape.
import en from '../i18n/intake/en.js';
import hi from '../i18n/intake/hi.js';
import bn from '../i18n/intake/bn.js';
import mr from '../i18n/intake/mr.js';
import ta from '../i18n/intake/ta.js';

export const LEXICONS = { en, hi, bn, mr, ta };
const LX = Object.values(LEXICONS);
const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const merge = (k) => [...new Set(LX.flatMap((l) => l[k] ?? []))];
// Word boundaries: \b for Latin; for Indic scripts (where \b does not work) a Unicode
// letter/mark lookaround. Short Indic negations (ना, না, नको…) must stand alone as words,
// otherwise e.g. Marathi "करताना" ("while doing") would wrongly negate a symptom.
const NB = '(?<![\\p{L}\\p{M}])', NA = '(?![\\p{L}\\p{M}])';
const alt = (xs, { bound = 'start' } = {}) =>
  xs.length
    ? `(?:${xs.map((x) => (isAscii(x) ? (bound === 'both' ? `\\b${x}\\b` : `\\b${x}`) : bound === 'both' && [...x].length <= 3 ? `${NB}${x}${NA}` : x)).join('|')})`
    : '(?!)';

const DIGITS = Object.assign({}, ...LX.map((l) => l.digits ?? {}));
const WORDS = Object.assign({}, ...LX.map((l) => l.numberWords ?? {}));
const digitClass = `[0-9${Object.keys(DIGITS).join('')}]`;
// Indic number words must be whole words: Bengali এক (1) must not match inside অনেক (many).
const CLS = [...new Set(LX.flatMap((l) => l.classifiers ?? []))].filter((c) => !isAscii(c)).map(esc);
const wordEnd = `(?=${CLS.length ? `(?:${CLS.join('|')})|` : ''}[^\\p{L}\\p{M}]|$)`; // a classifier (দু+টো) may follow
const wordAlt = Object.keys(WORDS).sort((a, b) => b.length - a.length).map((w) => (isAscii(w) ? `\\b${esc(w)}\\b` : `(?<![\\p{L}\\p{M}])${esc(w)}${wordEnd}`)).join('|');
const NUM = `(${digitClass}{1,4}${wordAlt ? `|${wordAlt}` : ''})`;
const CLASSIFIER = merge('classifiers').length ? `(?:${merge('classifiers').join('|')})?` : '';
const U = (k) => alt([...new Set(LX.flatMap((l) => l.units?.[k] ?? []))]);
const NEG = new RegExp(alt(merge('negation'), { bound: 'both' }), 'iu');
const CONJ = merge('conjunctions');
const BOUNDARY = /[,.;!?।॥\n]/;

const FIELDS = [...new Set(LX.flatMap((l) => Object.keys(l.fields ?? {})))].map((field) => ({
  field,
  re: new RegExp(alt([...new Set(LX.flatMap((l) => l.fields?.[field] ?? []))]), 'iu'),
}));

const PATTERNS = [
  { field: 'ageYears', re: new RegExp(`${NUM}\\s*${CLASSIFIER}\\s*${U('years')}`, 'iu') },
  { field: 'ageYears', re: new RegExp(`${alt(merge('age'))}[^\\d${Object.keys(DIGITS).join('')},.;।]{0,12}?${NUM}`, 'iu') },
  { field: 'periodDays', re: new RegExp(`${alt(merge('period'))}[^,.;।]{0,40}?${NUM}\\s*${CLASSIFIER}\\s*${U('days')}`, 'iu') },
  { field: 'periodDays', re: new RegExp(`${NUM}\\s*${CLASSIFIER}\\s*${U('days')}[^,.;।]{0,24}?${alt(merge('period'))}`, 'iu') },
  { field: 'padsPerDay', re: new RegExp(`${NUM}\\s*${CLASSIFIER}\\s*${U('pads')}`, 'iu') },
  { field: 'symptomDays', re: new RegExp(`${NUM}\\s*${CLASSIFIER}\\s*${U('days')}\\s*${alt(merge('since'))}`, 'iu') },
  { field: 'symptomDays', re: new RegExp(`${alt(merge('sinceBefore'))}\\s+${NUM}\\s*${U('days')}`, 'iu') },
];
const PREG = new RegExp(alt(merge('pregnant')), 'iu');
// A number word before a unit is a quantity, not a negation: Bengali নয় = "nine" and "is not",
// so "নয় দিন ধরে মাথা ঘোরে" (dizzy for nine days) must not negate dizziness.
const QUANTITY = new RegExp(`${NUM}\\s*${CLASSIFIER}\\s*(?:${U('years')}|${U('days')}|${U('pads')})`, 'giu');
const negated = (clause) => NEG.test(clause.replace(QUANTITY, ' '));

function toNum(s) {
  if (s == null) return null;
  const d = [...s].map((c) => (c in DIGITS ? DIGITS[c] : c)).join('');
  if (/^\d+$/.test(d)) return Number(d);
  return WORDS[s] ?? WORDS[s.toLowerCase()] ?? null;
}

/** Split into clauses on punctuation and on conjunctions that often flip polarity. */
function clauses(text) {
  const out = [];
  let start = 0;
  const push = (a, b) => { if (text.slice(a, b).trim()) out.push({ text: text.slice(a, b), start: a }); };
  const conj = CONJ.length ? new RegExp(CONJ.map((c) => (isAscii(c) ? `\\b${c.trim()}\\b` : esc(c))).join('|'), 'giu') : null;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || BOUNDARY.test(text[i])) {
      const seg = text.slice(start, i);
      let last = 0;
      if (conj) for (const m of seg.matchAll(conj)) { push(start + last, start + m.index); last = m.index + m[0].length; }
      push(start + last, i);
      start = i + 1;
    }
  }
  return out;
}

export function detectLanguage(text) {
  if (/[஀-௿]/.test(text)) return 'ta';
  if (/[ঀ-৿]/.test(text)) return 'bn';
  if (/[ऀ-ॿ]/.test(text)) return /(?:आहे|नाही|आहेत|होते|मला|तिला)/.test(text) ? 'mr' : 'hi';
  if (/\b(hai|hain|nahi|din|saal|ghante|khoon|chakkar)\b/i.test(text)) return 'hi-Latn';
  return 'en';
}

/**
 * @returns {{answers: object, spans: {field, value, text, start, end}[], language: string, extractedBy: string}}
 */
export function extractHistory(input) {
  const text = String(input ?? '').normalize('NFC');
  const answers = {};
  const spans = [];
  const set = (field, value, t0, start) => {
    if (answers[field] !== undefined) return;
    answers[field] = value;
    spans.push({ field, value, text: t0.trim(), start, end: start + t0.length });
  };
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      const v = toNum(m[1]);
      if (v != null) set(p.field, v, m[0], m.index);
    }
  }
  const cls = clauses(text);
  const preg = text.match(PREG);
  if (preg) {
    const cl = cls.find((c) => preg.index >= c.start && preg.index < c.start + c.text.length);
    set('pregnant', cl && negated(cl.text) ? 'no' : 'yes', cl?.text ?? preg[0], cl?.start ?? preg.index);
  }
  for (const c of cls) {
    for (const b of FIELDS) {
      if (!b.re.test(c.text)) continue;
      set(b.field, !negated(c.text), c.text, c.start);
    }
  }
  return { answers, spans, language: detectLanguage(text), extractedBy: 'femos-intake-rules@0.2.0' };
}
