// FEMOS planted-error benchmark for the check agent.
//
//   node benchmarks/checks/run.js   → results/checks.json (+ benchmarks/checks/last-run.json)
//
// Builds a deterministic set of synthetic FEMOS event logs: clean cases, cases with exactly one
// planted error (known expected flag code), identity "hard negatives" (similar names that are NOT the
// same person) and a few anchor cases that only exist so cross-case errors have something to collide
// with. All cases share ONE combined log so cross-case checks (duplicates, reused photos) run as in
// the product. Each scored case is settled with core/agents settle(log, caseId, {pack, now}).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeEvent, reduce } from '../../core/workflow.js';
import { settle } from '../../core/agents/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const pack = JSON.parse(readFileSync(join(ROOT, 'protocols', 'anemia-hmb', 'pack.json'), 'utf8'));
export const NOW = '2026-11-05T12:00:00.000Z';
export const SEED = 4242;

/** Clinical signals: expected on real patients, not errors. */
export const CLINICAL = ['HB_BAND', 'HMB_INDICATORS', 'DANGER_SIGNS', 'HB_FALLING'];
export const ERROR_TYPES = [
  'HB_UNIT_SUSPECT', 'HB_IMPLAUSIBLE', 'HB_DECIMAL_CORRECTION', 'HISTORY_CONTRADICTION', 'HISTORY_MISSING', 'HISTORY_OUT_OF_RANGE',
  'AGE_MISMATCH', 'DUPLICATE_SUSPECT', 'READING_REUSED', 'READING_STALE', 'CONSENT_GUARDIAN', 'OUT_OF_SCOPE', 'CONSENT_MISSING',
];
/** Errors that must stop SUBMITTED_FOR_REVIEW until fixed (our expectation, checked against the engine). */
export const SHOULD_BLOCK = ['HB_UNIT_SUSPECT', 'HB_IMPLAUSIBLE', 'HISTORY_MISSING', 'HISTORY_OUT_OF_RANGE', 'READING_REUSED', 'CONSENT_GUARDIAN', 'CONSENT_MISSING'];
/** What a plain digital form catches: required fields only. */
export const PLAIN_FORM = ['HISTORY_MISSING'];
/** A stricter form with numeric range validation on every field incl. Hb 3–20 g/dL (g/L 30–200). */
export const VALIDATED_FORM = ['HISTORY_MISSING', 'HISTORY_OUT_OF_RANGE', 'HB_IMPLAUSIBLE', 'HB_UNIT_SUSPECT'];

function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p };
}

const FIRST = ['Anita', 'Meena', 'Kavita', 'Reena', 'Mamta', 'Sarita', 'Geeta', 'Seema', 'Nisha', 'Rani', 'Kiran', 'Usha', 'Asha', 'Shanti', 'Kajal',
  'Neha', 'Komal', 'Khushboo', 'Rinki', 'Pinki', 'Sonam', 'Nazia', 'Rubina', 'Farzana', 'Shabnam', 'Bindu', 'Jyoti', 'Manju', 'Savitri', 'Lalita',
  'Radha', 'Durga', 'Champa', 'Basanti', 'Phoolmati', 'Tara', 'Malti', 'Sangita', 'Ritu', 'Archana', 'Babita', 'Chanda', 'Dimple', 'Gudiya', 'Hemlata'];
const FIRST_HI = ['अनीता', 'मीना', 'कविता', 'ममता', 'सरिता', 'गीता', 'नेहा', 'ज्योति', 'मंजू', 'राधा'];
const SURNAME = ['Kumari', 'Devi', 'Yadav', 'Singh', 'Paswan', 'Mahto', 'Khatoon', 'Prasad', 'Mandal', 'Manjhi', 'Ravidas', 'Bano'];
const SURNAME_HI = ['कुमारी', 'देवी', 'यादव', 'सिंह', 'पासवान'];
const VILLAGES = ['Rampur', 'Sonpur', 'Belaganj', 'Tekari', 'Manpur', 'Wazirganj', 'Atri', 'Khizarsarai', 'Mohanpur', 'Fatehpur', 'Dobhi', 'Paraiya'];

const asha = { id: 'asha-07', role: 'asha' };
const NOW_YEAR = new Date(NOW).getUTCFullYear();

/** Realistic, internally consistent answers for a woman of `age`. */
function cleanAnswers(r, age) {
  const periodDays = r.pick([3, 4, 4, 5, 5, 5, 6, 6, 7, 8, 9, 10]);
  const padsPerDay = r.pick([2, 3, 3, 4, 4, 5, 5, 6, 7, 8]);
  const clots = r.chance(0.2), flooding = r.chance(0.1), soakingHourly = r.chance(0.1);
  const hmb = periodDays > 7 || padsPerDay >= 6 || clots || flooding || soakingHourly;
  const a = {
    ageYears: age, pregnant: r.chance(0.9) ? 'no' : 'unknown', periodDays, padsPerDay, heavyBleeding: hmb ? true : r.chance(0.15),
    dizziness: r.chance(0.35), breathless: r.chance(0.08), fainting: r.chance(0.05), fatigue: r.chance(0.5),
  };
  if (clots) a.clots = true; else if (r.chance(0.5)) a.clots = false;
  if (flooding) a.flooding = true;
  if (soakingHourly) a.soakingHourly = true;
  if (r.chance(0.5)) a.ifaLastMonth = r.chance(0.4);
  if (r.chance(0.3)) a.dewormedLastYear = r.pick(['yes', 'no', 'unknown']);
  return a;
}
/** Hb in g/dL: mixture of normal and anaemic women. */
const cleanHb = (r) => Math.round((r.chance(0.55) ? 9.5 + r.next() * 5 : 6 + r.next() * 4.5) * 10) / 10;

function hex(r, n = 16) { let s = ''; for (let i = 0; i < n; i++) s += r.int(0, 15).toString(16); return s; }

/**
 * A case description: patient, consent, answers, reading. `toEvents` turns it into FEMOS events.
 */
function baseCase(r, id, slot, used) {
  let name, village, key;
  do {
    const hi = r.chance(0.2);
    name = hi ? `${r.pick(FIRST_HI)} ${r.pick(SURNAME_HI)}` : `${r.pick(FIRST)} ${r.pick(SURNAME)}`;
    village = r.pick(VILLAGES);
    key = `${name}|${village}`;
  } while (used.has(key));
  used.add(key);
  const age = r.chance(0.25) ? r.int(12, 17) : r.int(18, 45);
  const birthYear = NOW_YEAR - age - (r.chance(0.5) ? 1 : 0); // birthday may not have passed yet
  const hb = cleanHb(r);
  const gL = r.chance(0.15); // some devices are set to g/L
  return {
    id, slot,
    patient: { id: `pt-${id}`, name, birthYear, village, block: 'Sadar', district: 'Gaya' },
    consent: { care: true, messaging: r.chance(0.7), by: age < 18 ? 'guardian' : 'self' },
    answers: cleanAnswers(r, age),
    reading: { captured: gL ? Math.round(hb * 10) : hb, verified: gL ? Math.round(hb * 10) : hb, unit: gL ? 'g/L' : 'g/dL', imageHash: `sha256-${hex(r)}`, staleHours: 0 },
  };
}

function toEvents(c) {
  const t0 = Date.parse('2026-11-01T05:00:00Z') + c.slot * 20 * 60000;
  let n = 0;
  const ev = (type, payload) => makeEvent({ id: `${c.id}-e${++n}`, caseId: c.id, type, actor: asha, payload, at: new Date(t0 + n * 60000).toISOString(), device: 'bench', protocol: { id: pack.id, version: pack.version } });
  const out = [ev('CASE_OPENED', { patient: c.patient, language: 'hi' })];
  if (c.consent) out.push(ev('CONSENT_RECORDED', c.consent));
  out.push(ev('HISTORY_SUBMITTED', { answers: c.answers, source: 'form' }), ev('HISTORY_VERIFIED', {}));
  const capAt = new Date(t0 + (n + 1) * 60000);
  const measuredAt = new Date(capAt.getTime() - (c.reading.staleHours * 3600e3 || 3 * 60000)).toISOString();
  out.push(ev('READING_CAPTURED', { readingId: `r-${c.id}`, kind: 'hb', value: c.reading.captured, unit: c.reading.capturedUnit ?? c.reading.unit, method: 'camera_ocr', imageHash: c.reading.imageHash, measuredAt }));
  out.push(ev('READING_VERIFIED', { readingId: `r-${c.id}`, value: c.reading.verified, unit: c.reading.unit }));
  return out;
}

// Duplicate pairs: [anchor, planted, expectation]
const DUP_POSITIVE = [
  [{ name: 'Priya Kumari', village: 'Rampur', birthYear: 2008 }, { name: 'प्रिया कुमारी', village: 'Rampur', birthYear: 2008 }, 'Devanagari vs Latin, same village and birth year'],
  [{ name: 'Pooja Devi', village: 'Sonpur', birthYear: 1997 }, { name: 'Puja Devi', village: 'Sonpur', birthYear: 1997 }, 'Pooja/Puja spelling'],
  [{ name: 'Lakshmi Yadav', village: 'Tekari', birthYear: 2001 }, { name: 'Laxmi Yadav', village: 'Tekari', birthYear: 2001 }, 'Lakshmi/Laxmi spelling'],
  [{ name: 'Sunita Devi', village: 'Atri', birthYear: 1993 }, { name: 'सुनीता देवी', village: 'Atri', birthYear: 1994 }, 'Sunita/सुनीता, birth year ±1'],
  [{ name: 'Rekha Kumari', village: 'Manpur', birthYear: 2006 }, { name: 'रेखा कुमारी', village: 'Manpur', birthYear: 2006 }, 'Devanagari vs Latin'],
  [{ name: 'Priyanka Paswan', village: 'Dobhi', birthYear: 1999 }, { name: 'Priyanka Paswaan', village: 'Dobhi', birthYear: 1999 }, 'Paswan/Paswaan spelling'],
];
// Different people with similar names: must NOT be a "likely" duplicate.
const DUP_NEGATIVE = [
  [{ name: 'Sunita Devi', village: 'Wazirganj', birthYear: 1990 }, { name: 'सुनीता देवी', village: 'Belaganj', birthYear: 1990 }, 'Sunita/सुनीता, different village'],
  [{ name: 'Pooja Kumari', village: 'Fatehpur', birthYear: 2003 }, { name: 'Puja Kumari', village: 'Mohanpur', birthYear: 2003 }, 'Pooja/Puja, different village'],
  [{ name: 'Lakshmi Devi', village: 'Paraiya', birthYear: 1988 }, { name: 'Laxmi Devi', village: 'Khizarsarai', birthYear: 1992 }, 'Lakshmi/Laxmi, different village, birth year +4'],
  [{ name: 'Priya Kumari', village: 'Belaganj', birthYear: 2002 }, { name: 'प्रिया कुमारी', village: 'Sonpur', birthYear: 2009 }, 'Priya/प्रिया, different village, birth year +7'],
];

/** Plant exactly one error of `type` into case `c` (mutates). Returns a human description. */
function plant(type, c, r, k, anchors) {
  const a = c.answers;
  const adult = () => { if (a.ageYears < 18) { a.ageYears = r.int(20, 40); c.patient.birthYear = NOW_YEAR - a.ageYears; c.consent.by = 'self'; } };
  const hbGdl = c.reading.unit === 'g/L' ? c.reading.verified / 10 : c.reading.verified;
  const setReading = (captured, verified, unit, capturedUnit) => Object.assign(c.reading, { captured, verified, unit, capturedUnit });
  switch (type) {
    case 'HB_UNIT_SUSPECT':
      if (k % 2 === 0) { const v = Math.round(hbGdl * 10); setReading(v, v, 'g/dL'); return `device showed ${v} g/L, entered as ${v} g/dL`; }
      setReading(hbGdl, hbGdl, 'g/L'); return `device showed ${hbGdl} g/dL, entered as ${hbGdl} g/L`;
    case 'HB_IMPLAUSIBLE': { const v = [2.1, 1.4, 22.5, 0.9, 24.0, 2.6][k % 6]; setReading(v, v, 'g/dL'); return `${v} g/dL typed`; }
    case 'HB_DECIMAL_CORRECTION': {
      const v = Math.round(hbGdl * 10) / 10;
      if (k % 2 === 0) { setReading(Math.round(v * 10), v, 'g/dL'); return `captured ${Math.round(v * 10)} g/dL, verifier changed it to ${v}`; }
      setReading(Math.round(v * 10) / 100, v, 'g/dL'); return `captured ${Math.round(v * 10) / 100} g/dL, verifier changed it to ${v}`;
    }
    case 'HISTORY_CONTRADICTION':
      if (k % 2 === 0) { a.heavyBleeding = false; a.padsPerDay = r.int(6, 9); return `heavyBleeding=false but ${a.padsPerDay} pads/day`; }
      a.periodDays = 0; a.padsPerDay = r.int(2, 5); a.heavyBleeding = false; delete a.clots; delete a.flooding; delete a.soakingHourly; return `periodDays=0 but ${a.padsPerDay} pads/day`;
    case 'HISTORY_MISSING': {
      const f = ['pregnant', 'periodDays', 'padsPerDay', 'heavyBleeding', 'dizziness', 'breathless', 'fainting'][k % 7];
      delete a[f]; return `required field "${f}" left empty`;
    }
    case 'HISTORY_OUT_OF_RANGE': {
      const [f, v] = [['periodDays', 45], ['padsPerDay', 60], ['symptomDays', 5000], ['periodDays', 6.5], ['padsPerDay', -2], ['periodDays', 31]][k % 6];
      a[f] = v; if (f !== 'symptomDays') a.heavyBleeding = true; return `${f}=${v}`;
    }
    case 'AGE_MISMATCH': {
      adult();
      const trueAge = NOW_YEAR - c.patient.birthYear;
      const d = r.int(3, 8) * (trueAge > 35 ? -1 : 1);
      a.ageYears = Math.min(49, Math.max(18, trueAge + d));
      if (Math.abs(a.ageYears - trueAge) <= 1) a.ageYears = trueAge + 4;
      return `stated age ${a.ageYears}, birth year ${c.patient.birthYear}`;
    }
    case 'DUPLICATE_SUSPECT': {
      const [anchor, dup, note] = DUP_POSITIVE[k % DUP_POSITIVE.length];
      const anc = anchors.make(anchor);
      Object.assign(c.patient, dup);
      a.ageYears = NOW_YEAR - dup.birthYear; c.consent.by = a.ageYears < 18 ? 'guardian' : 'self';
      return `${dup.name} (${dup.village}, ${dup.birthYear}) vs existing ${anchor.name} (${anchor.village}, ${anchor.birthYear}) in ${anc.id}: ${note}`;
    }
    case 'READING_REUSED': { const anc = anchors.make(null); c.reading.imageHash = anc.reading.imageHash; return `photo hash copied from ${anc.id}`; }
    case 'READING_STALE': c.reading.staleHours = r.int(30, 96); return `device timestamp ${c.reading.staleHours} h before capture`;
    case 'CONSENT_GUARDIAN':
      a.ageYears = r.int(12, 17); c.patient.birthYear = NOW_YEAR - a.ageYears; c.consent.by = 'self'; return `age ${a.ageYears}, consent by self`;
    case 'OUT_OF_SCOPE': adult(); a.pregnant = 'yes'; return 'pregnant';
    case 'CONSENT_MISSING':
      adult(); if (k % 2 === 0) c.consent = null; else c.consent = { ...c.consent, care: false }; return k % 2 === 0 ? 'no consent event' : 'consent recorded with care=false';
  }
  throw new Error(type);
}

/**
 * @returns {{cases: object[], events: object[]}} scored cases + the combined log (including anchors)
 */
export function buildCases({ seed = SEED, clean = 52, perType = 6 } = {}) {
  const r = prng(seed);
  const used = new Set();
  const cases = [];
  let slot = 0;
  const anchorsList = [];
  const anchors = {
    make(override) {
      const c = baseCase(r, `anchor-${String(anchorsList.length + 1).padStart(2, '0')}`, slot++, used);
      if (override) { Object.assign(c.patient, override); c.answers.ageYears = NOW_YEAR - override.birthYear; c.consent.by = c.answers.ageYears < 18 ? 'guardian' : 'self'; }
      anchorsList.push(c);
      return c;
    },
  };
  for (let i = 0; i < clean; i++) {
    const c = baseCase(r, `clean-${String(i + 1).padStart(3, '0')}`, slot++, used);
    cases.push({ ...c, kind: 'clean', expected: null, note: 'clean' });
  }
  for (const type of ERROR_TYPES) {
    for (let k = 0; k < perType; k++) {
      const c = baseCase(r, `${type.toLowerCase()}-${k + 1}`, slot++, used);
      const note = plant(type, c, r, k, anchors);
      cases.push({ ...c, kind: 'planted', expected: type, note });
    }
  }
  DUP_NEGATIVE.forEach(([anchor, other, note], k) => {
    anchors.make(anchor);
    const c = baseCase(r, `identity-neg-${k + 1}`, slot++, used);
    Object.assign(c.patient, other);
    c.answers.ageYears = NOW_YEAR - other.birthYear; c.consent.by = c.answers.ageYears < 18 ? 'guardian' : 'self';
    cases.push({ ...c, kind: 'hard_negative', expected: null, note: `${other.name} (${other.village}, ${other.birthYear}) vs ${anchor.name} (${anchor.village}, ${anchor.birthYear}): ${note}` });
  });
  const events = [...cases, ...anchorsList].flatMap(toEvents);
  return { cases, anchors: anchorsList, events };
}

/** Settle each scored case in the combined log and compare flags with expectations. */
export function evaluate({ cases, events }, { now = NOW } = {}) {
  const rows = [];
  for (const c of cases) {
    const log = settle(events, c.id, { pack, now });
    const s = reduce(log, c.id);
    const codes = [...new Set(s.flags.map((f) => f.code))];
    const errorCodes = codes.filter((x) => !CLINICAL.includes(x));
    // try to submit for review: is the case blocked?
    const submit = makeEvent({ id: `${c.id}-submit`, caseId: c.id, type: 'SUBMITTED_FOR_REVIEW', actor: asha, payload: {}, at: new Date(Date.parse(now) + 60000).toISOString() });
    const after = reduce([...log, submit], c.id);
    const blocked = after.rejected.some((x) => x.eventId === submit.id);
    const blockReason = after.rejected.find((x) => x.eventId === submit.id)?.reason ?? null;
    const dup = s.flags.filter((f) => f.code === 'DUPLICATE_SUSPECT').map((f) => ({ otherCaseId: f.otherCaseId, level: f.level, score: f.score }));
    const detected = c.expected ? codes.includes(c.expected) : null;
    const extra = errorCodes.filter((x) => x !== c.expected);
    rows.push({ id: c.id, kind: c.kind, expected: c.expected, note: c.note, codes, errorCodes, detected, extra, blocked, blockReason, duplicates: dup });
  }
  return rows;
}

export function score(rows) {
  const clean = rows.filter((r) => r.kind === 'clean');
  const planted = rows.filter((r) => r.kind === 'planted');
  const neg = rows.filter((r) => r.kind === 'hard_negative');
  const byType = {};
  for (const t of ERROR_TYPES) byType[t] = { planted: 0, detected: 0 };
  for (const r of planted) { byType[r.expected].planted++; if (r.detected) byType[r.expected].detected++; }
  const detected = planted.filter((r) => r.detected).length;
  const faClean = clean.flatMap((r) => r.errorCodes.map((code) => ({ id: r.id, code, kind: 'clean', note: r.note, duplicates: r.duplicates })));
  const faExtra = planted.flatMap((r) => r.extra.map((code) => ({ id: r.id, code, kind: `planted ${r.expected}`, note: r.note, duplicates: code === 'DUPLICATE_SUSPECT' ? r.duplicates : undefined })));
  const shouldBlock = planted.filter((r) => SHOULD_BLOCK.includes(r.expected));
  const shouldPass = planted.filter((r) => !SHOULD_BLOCK.includes(r.expected) && r.extra.every((x) => !SHOULD_BLOCK.includes(x)));
  const base = (codes) => { const n = planted.filter((r) => codes.includes(r.expected)).length; return { detected: n, rate: Math.round((n / planted.length) * 1000) / 1000 }; };
  const falseAlarmCodes = {};
  for (const f of [...faClean, ...faExtra]) falseAlarmCodes[f.code] = (falseAlarmCodes[f.code] ?? 0) + 1;
  return {
    cases: rows.length,
    cleanCases: clean.length,
    plantedCases: planted.length,
    hardNegativeCases: neg.length,
    planted: planted.length,
    detected,
    missed: planted.length - detected,
    detectionRate: Math.round((detected / planted.length) * 1000) / 1000,
    falseAlarms: faClean.length + faExtra.length,
    falseAlarmsOnClean: faClean.length,
    extraFlagsOnPlanted: faExtra.length,
    falseAlarmCodes,
    cleanFlagged: clean.filter((r) => r.errorCodes.length).length,
    cleanBlocked: clean.filter((r) => r.blocked).length,
    baselinePlainForm: { ...base(PLAIN_FORM), catches: PLAIN_FORM },
    baselineValidatedForm: { ...base(VALIDATED_FORM), catches: VALIDATED_FORM },
    blocking: {
      expectedToBlock: SHOULD_BLOCK,
      shouldBlock: shouldBlock.length,
      blocked: shouldBlock.filter((r) => r.blocked).length,
      shouldNotBlock: shouldPass.length,
      wronglyBlocked: shouldPass.filter((r) => r.blocked).length,
      byType: Object.fromEntries(ERROR_TYPES.map((t) => { const xs = planted.filter((r) => r.expected === t); return [t, `${xs.filter((r) => r.blocked).length}/${xs.length} blocked`]; })),
    },
    identityHardNegatives: { n: neg.length, likely: neg.filter((r) => r.duplicates.some((d) => d.level === 'likely')).length, possible: neg.filter((r) => r.duplicates.length && !r.duplicates.some((d) => d.level === 'likely')).length, examples: neg.map((r) => ({ id: r.id, note: r.note, duplicates: r.duplicates })) },
    byType,
    missedExamples: planted.filter((r) => !r.detected).map((r) => ({ id: r.id, expected: r.expected, note: r.note, codes: r.codes })),
    falseAlarmExamples: [...faClean, ...faExtra],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const built = buildCases();
  const rows = evaluate(built);
  const s = score(rows);
  const result = { generatedAt: new Date().toISOString(), seed: SEED, now: NOW, pack: `${pack.id}@${pack.version}`, anchorCases: built.anchors.length, ...s, seconds: (Date.now() - t0) / 1000 };
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  writeFileSync(join(ROOT, 'results', 'checks.json'), JSON.stringify(result, null, 1));
  writeFileSync(join(HERE, 'last-run.json'), JSON.stringify({ generatedAt: result.generatedAt, rows }, null, 1));
  console.log('type                     planted detected  blocked');
  for (const [t, v] of Object.entries(s.byType)) console.log(`${t.padEnd(24)} ${String(v.planted).padStart(7)} ${String(v.detected).padStart(8)}  ${s.blocking.byType[t]}`);
  console.log(`cases ${s.cases} (clean ${s.cleanCases}, planted ${s.plantedCases}, identity hard negatives ${s.hardNegativeCases}; +${built.anchors.length} anchor cases in the log)`);
  console.log(`detected ${s.detected}/${s.planted} (${(s.detectionRate * 100).toFixed(1)}%); plain form ${s.baselinePlainForm.detected}/${s.planted}; validated form ${s.baselineValidatedForm.detected}/${s.planted}`);
  console.log(`false alarms ${s.falseAlarms} (on clean ${s.falseAlarmsOnClean}, extra on planted ${s.extraFlagsOnPlanted}) ${JSON.stringify(s.falseAlarmCodes)}; clean cases flagged ${s.cleanFlagged}/${s.cleanCases}; clean blocked ${s.cleanBlocked}`);
  console.log(`blocking: ${s.blocking.blocked}/${s.blocking.shouldBlock} should-block blocked; ${s.blocking.wronglyBlocked}/${s.blocking.shouldNotBlock} wrongly blocked`);
  console.log(`identity hard negatives: likely ${s.identityHardNegatives.likely}, possible ${s.identityHardNegatives.possible} of ${s.identityHardNegatives.n}`);
  for (const m of s.missedExamples) console.log('MISSED', JSON.stringify(m));
  for (const f of s.falseAlarmExamples) console.log('FALSE ALARM', JSON.stringify(f));
  console.log(`${result.seconds}s`);
}
