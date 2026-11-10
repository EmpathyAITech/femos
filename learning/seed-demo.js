// Realistic SYNTHETIC demo event log for the FEMOS field app and clinician console.
//
// Builds ~80 cases in Gaya district (Bihar), blocks Sadar, Bodh Gaya and Tekari, over the ~60 days
// before a fixed anchor (2026-11-09T09:00:00Z). Every human step is a real FEMOS event built with
// makeEvent, and the bounded agents are run with settle() after each step with an advancing clock,
// so flags, handoffs and proposals are exactly what the engine would produce.
//
// Deterministic: a seeded PRNG drives the content, and crypto.randomUUID (used by core uid() for
// event, proposal and task ids) is temporarily replaced with a seeded generator while building.
//
// All people are fictional. Phone numbers use the +9190000xxxxx range. Not real data.
//
// Usage: node learning/seed-demo.js [--seed 7] [--out data/demo/events.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEvent, reduce, reduceAll } from '../core/workflow.js';
import { settle } from '../core/agents/index.js';
import { extractHistory } from '../core/agents/intake.js';
import { matchPatients } from '../core/identity.js';
import { makeRng, parseSeed } from './rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ANCHOR = '2026-11-09T09:00:00Z';
const ANCHOR_MS = Date.parse(ANCHOR);
const MIN = 6e4;
const DAY = 864e5;
const FACILITY = 'PHC Gaya Sadar';
const YEAR = 2026;

const A = (id, role, name) => ({ id, role, name });
export const ACTORS = {
  'asha-01': A('asha-01', 'asha', 'Sunaina Devi'),
  'asha-02': A('asha-02', 'asha', 'Phoolmati Kumari'),
  'asha-03': A('asha-03', 'asha', 'Rubi Khatoon'),
  'asha-04': A('asha-04', 'asha', 'Mamta Paswan'),
  'asha-05': A('asha-05', 'asha', 'Indu Yadav'),
  'asha-06': A('asha-06', 'asha', 'Sushila Manjhi'),
  'anm-01': A('anm-01', 'anm', 'Kiran Sinha'),
  'anm-02': A('anm-02', 'anm', 'Shabana Parveen'),
  'nurse-01': A('nurse-01', 'nurse', 'Reena Kujur'),
  'school-01': A('school-01', 'school', 'Govt. Girls Middle School Bodh Gaya (health teacher)'),
  'camp-01': A('camp-01', 'camp', 'Tekari block screening camp'),
  'dr-01': A('dr-01', 'clinician', 'Dr. Anjali Verma'),
  'dr-02': A('dr-02', 'clinician', 'Dr. Farhan Ali'),
  'mo-01': A('mo-01', 'medical_officer', 'Dr. R. K. Prasad (MO i/c)'),
};
const SYSTEM = { id: 'femos-messaging', role: 'system' };

const BLOCKS = {
  Sadar: { villages: ['Chandauti', 'Manpur', 'Nauranga', 'Bhusunda'], ashas: ['asha-01', 'asha-02'], anm: 'anm-01' },
  'Bodh Gaya': { villages: ['Bakraur', 'Mastipur', 'Sekhwara', 'Silaunja'], ashas: ['asha-03', 'asha-04'], anm: 'anm-01' },
  Tekari: { villages: ['Kespa', 'Guraru', 'Sondiha', 'Mau'], ashas: ['asha-05', 'asha-06'], anm: 'anm-02' },
};
const BLOCK_NAMES = Object.keys(BLOCKS);

// Latin / Devanagari name pairs. Adolescents mostly "Kumari"; married women "Devi" or a surname.
const FIRST = [['Priya', 'प्रिया'], ['Anita', 'अनीता'], ['Sunita', 'सुनीता'], ['Rekha', 'रेखा'], ['Pooja', 'पूजा'], ['Kavita', 'कविता'], ['Meena', 'मीना'],
  ['Lata', 'लता'], ['Rani', 'रानी'], ['Kiran', 'किरण'], ['Neha', 'नेहा'], ['Ritu', 'रितु'], ['Sarita', 'सरिता'], ['Geeta', 'गीता'], ['Seema', 'सीमा'],
  ['Manju', 'मंजू'], ['Rinku', 'रिंकू'], ['Khushboo', 'ख़ुशबू'], ['Nisha', 'निशा'], ['Sapna', 'सपना'], ['Shabnam', 'शबनम'], ['Ruksana', 'रुख़साना'],
  ['Savitri', 'सावित्री'], ['Bindu', 'बिंदु'], ['Mamta', 'ममता'], ['Sangita', 'संगीता'], ['Archana', 'अर्चना'], ['Komal', 'कोमल'], ['Jyoti', 'ज्योति'],
  ['Suman', 'सुमन'], ['Anjali', 'अंजलि'], ['Babita', 'बबीता'], ['Laxmi', 'लक्ष्मी'], ['Radha', 'राधा'], ['Shanti', 'शांति'], ['Usha', 'उषा'],
  ['Parvati', 'पार्वती'], ['Chanda', 'चंदा'], ['Nazia', 'नाज़िया'], ['Sonam', 'सोनम'], ['Dimple', 'डिंपल'], ['Muskan', 'मुस्कान']];
const SURNAME_ADULT = [['Devi', 'देवी'], ['Yadav', 'यादव'], ['Manjhi', 'मांझी'], ['Paswan', 'पासवान'], ['Khatoon', 'ख़ातून'], ['Prasad', 'प्रसाद'], ['Ravidas', 'रविदास'], ['Singh', 'सिंह']];
const GUARDIAN_FIRST = ['Ramesh', 'Suresh', 'Dinesh', 'Mukesh', 'Rajkumar', 'Shambhu', 'Arjun', 'Mohammad Salim', 'Birju', 'Lalan', 'Sanjay', 'Umesh', 'Kailash', 'Nagendra', 'Abdul Rahim', 'Pappu', 'Shiv Shankar', 'Bablu'];
const GUARDIAN_SURNAME = ['Yadav', 'Manjhi', 'Paswan', 'Prasad', 'Ravidas', 'Chaudhary', 'Ansari', 'Ram', 'Mahto', 'Sharma'];
const DEVICES = [
  { make: 'HemoCheck', model: 'HB-201' },
  { make: 'Hemo-Lite', model: '3' },
  { make: 'QuickHb', model: 'Q5' },
  { make: 'SahiHb', model: 'S2' },
];

/**
 * Build the demo log.
 * @returns {{events, cases: {caseId, archetype, patientId}[], deliberateRejections: {eventId, caseId, reason}[], anchor}}
 */
export function buildDemo({ seed = 7, pack } = {}) {
  pack ??= JSON.parse(readFileSync(join(ROOT, 'protocols/anemia-hmb/pack.json'), 'utf8'));
  const r = makeRng(seed);
  const idRng = makeRng(seed ^ 0x5eed);
  const desc = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value: () => {
      const h = idRng.hex(32);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });
  try {
    return build(r, pack);
  } finally {
    if (desc) Object.defineProperty(globalThis.crypto, 'randomUUID', desc);
    else delete globalThis.crypto.randomUUID;
  }
}

function build(r, pack) {
  const protocol = { id: pack.id, version: pack.version };
  const cases = [];
  const usedNames = new Set();
  const usedGuardians = new Set();
  const people = []; // everyone created so far (for accidental look-alike checks)
  let pSeq = 0;
  let phoneSeq = 10000 + r.int(0, 50000);

  // ---------- people ----------
  function person({ age, block, village, devanagari = r.bool(0.12), phone, abha = false, first, surname, birthYear } = {}) {
    const fixedVillage = village;
    birthYear ??= YEAR - age;
    let p;
    let f;
    let s;
    // Unrelated people must not look like duplicates to the identity agent (core/identity.js), or
    // the demo would be full of accidental "same person?" flags. Intended duplicates pass `first`.
    for (let attempt = 0; attempt < 200; attempt++) {
      const b = block ?? r.pick(BLOCK_NAMES);
      const v = fixedVillage ?? r.pick(BLOCKS[b].villages);
      f = first ?? r.pick(FIRST);
      s = surname ?? (age < 20 ? ['Kumari', 'कुमारी'] : r.pick(SURNAME_ADULT));
      if (!first && usedNames.has(f[0] + s[0])) continue;
      const name = devanagari ? `${f[1]} ${s[1]}` : `${f[0]} ${s[0]}`;
      p = { id: null, name, birthYear, village: v, block: b, district: 'Gaya', state: 'Bihar' };
      if (age < 18) {
        // Guardian names are unique per family: a shared guardian name is evidence of the same person.
        let g;
        let tries = 0;
        do g = `${r.pick(GUARDIAN_FIRST)} ${s[0] === 'Kumari' ? r.pick(GUARDIAN_SURNAME) : s[0]}`;
        while (usedGuardians.has(g) && tries++ < 60);
        p.guardian = g;
      }
      if (first || people.every((q) => matchPatients(p, q).level === 'unlikely')) break;
    }
    usedNames.add(f[0] + s[0]);
    if (p.guardian) usedGuardians.add(p.guardian);
    p.id = `pt-${String(++pSeq).padStart(4, '0')}`;
    if (phone ?? r.bool(0.6)) p.phone = `+9190000${String(phoneSeq++).padStart(5, '0')}`;
    if (abha) p.identifiers = [{ system: 'abha', value: `91-${r.int(1000, 9999)}-${r.int(1000, 9999)}-${r.int(1000, 9999)}` }];
    people.push({ name: p.name, birthYear: p.birthYear, village: p.village, guardian: p.guardian });
    return p;
  }

  // Intended duplicate pairs (section H) are reserved up front so no unrelated person resembles them.
  const dupDefs = [
    { f: FIRST[0], s: ['Kumari', 'कुमारी'], ag: 16, block: 'Sadar', village: 'Chandauti', guardian: 'Bholanath Chaudhary' },
    { f: FIRST[2], s: ['Devi', 'देवी'], ag: 34, block: 'Bodh Gaya', village: 'Mastipur' },
    { f: FIRST[3], s: ['Manjhi', 'मांझी'], ag: 27, block: 'Tekari', village: 'Kespa' },
  ];
  for (const d of dupDefs) {
    usedNames.add(d.f[0] + d.s[0]);
    people.push({ name: `${d.f[0]} ${d.s[0]}`, birthYear: YEAR - d.ag, village: d.village, guardian: d.guardian });
  }

  // ---------- history answers consistent with a profile ----------
  function answers(age, { hmb = r.bool(0.45), dizzy, fainting = false, breathless = false, severeSymptoms = false } = {}) {
    const a = {
      ageYears: age,
      pregnant: 'no',
      periodDays: hmb ? r.int(8, 10) : r.int(3, 6),
      padsPerDay: hmb ? r.int(6, 9) : r.int(2, 4),
      heavyBleeding: hmb,
      fatigue: hmb || severeSymptoms || r.bool(0.4),
      dizziness: dizzy ?? (severeSymptoms || r.bool(hmb ? 0.5 : 0.2)),
      breathless,
      fainting,
      ifaLastMonth: r.bool(0.45),
      dewormedLastYear: r.pick(['yes', 'no', 'unknown']),
      symptomDays: r.pick([14, 30, 60, 90, 180]),
    };
    if (hmb) {
      a.clots = r.bool(0.6);
      a.flooding = r.bool(0.5);
      a.soakingHourly = r.bool(0.3);
    } else {
      a.clots = false;
      a.flooding = false;
      a.soakingHourly = false;
    }
    if (a.soakingHourly && a.dizziness && !severeSymptoms) a.soakingHourly = false; // avoid unintended danger sign
    return a;
  }

  /** Free-text (voice/Hinglish or Hindi) narration of answers, run through the intake agent. */
  function narrated(a, hindi) {
    const txt = hindi
      ? `उम्र ${a.ageYears} साल। माहवारी ${a.periodDays} दिन तक चलती है, ${a.padsPerDay} पैड लगते हैं। ${a.dizziness ? 'चक्कर आते हैं' : 'चक्कर नहीं आते'}। ${a.fainting ? 'एक बार बेहोश हुई' : 'बेहोश नहीं हुई'}।`
      : `Umar ${a.ageYears} saal. Mahwari ${a.periodDays} din chalti hai, ${a.padsPerDay} pad lagte hain. ${a.dizziness ? 'Chakkar aate hain' : 'Chakkar nahi aate'}, ${a.fainting ? 'ek baar behosh hui' : 'behosh nahi hui'}. ${a.breathless ? 'Saans phoolti hai' : 'Saans nahi phoolti'}.`;
    const ex = extractHistory(txt);
    return { answers: { ...a, ...ex.answers }, source: 'voice', originalText: txt, language: hindi ? 'hi' : 'hi-Latn', extractedBy: ex.extractedBy };
  }

  function reading(caseId, n, value, { unit = 'g/dL', method = 'camera_ocr', device, imageHash, ocrText, measuredOffsetMin = 4 } = {}) {
    device ??= method === 'lab_report' ? { make: 'Sysmex', model: 'XP-100' } : r.pick(DEVICES);
    const p = { readingId: `r-${caseId}-${n}`, kind: 'hb', value, unit, method, device, _measuredOffsetMin: measuredOffsetMin };
    if (method === 'camera_ocr') {
      p.imageHash = imageHash ?? `sha256:${r.hex(64)}`;
      p.ocr = { status: 'candidate', text: ocrText ?? `${device.make} ${device.model}\n${value} ${unit}\n${String(r.int(9, 16)).padStart(2, '0')}:${String(r.int(0, 59)).padStart(2, '0')}`, engine: 'tesseract.js' };
    }
    return p;
  }

  // ---------- case script DSL ----------
  // Each step: { at (ms), actor, type, payload | (state, log) => payload|null }
  const startTime = (daysAgo) => {
    const d = new Date(ANCHOR_MS - daysAgo * DAY);
    d.setUTCHours(3, 30, 0, 0); // 09:00 IST
    const t = d.getTime() + r.int(0, 420) * MIN; // within the working day
    return Math.min(t, ANCHOR_MS - 5 * 3600e3 - r.int(0, 60) * MIN);
  };
  let cSeq = 0;
  function newCase(archetype, patient, { daysAgo, entry, language = 'hi', channel = 'app' }) {
    const caseId = `c-gaya-${String(++cSeq).padStart(4, '0')}`;
    const t0 = startTime(daysAgo);
    const c = { caseId, archetype, patient, entry, steps: [], t: t0, language };
    c.step = (gapMin, actor, type, payload) => {
      c.t += gapMin * MIN;
      c.steps.push({ at: c.t, actor: typeof actor === 'string' ? ACTORS[actor] : actor, type, payload });
      return c;
    };
    c.wait = (days, hourJitter = true) => {
      let next = c.t + Math.max(10 * MIN, days * DAY + (hourJitter ? r.int(-60, 120) * MIN : 0));
      // Never run past the anchor: compress the wait into the remaining time instead.
      const limit = ANCHOR_MS - 2 * 3600e3;
      if (next > limit) next = c.t + Math.max(5 * MIN, (limit - c.t) / 2);
      c.t = next;
      return c;
    };
    c.step(0, entry, 'CASE_OPENED', { patient, language, channel });
    cases.push(c);
    return c;
  }
  const ashaFor = (p) => r.pick(BLOCKS[p.block].ashas);
  const anmFor = (p) => BLOCKS[p.block].anm;
  const clin = () => r.weighted([['dr-01', 5], ['dr-02', 4], ['mo-01', 1]]);
  const actorOf = (c) => (typeof c.entry === 'string' ? ACTORS[c.entry] : c.entry);

  function consent(c, { messaging, by, guardianName } = {}) {
    const minor = YEAR - c.patient.birthYear < 18;
    messaging ??= !!c.patient.phone && r.bool(0.75);
    const p = { care: true, messaging: !!(messaging && c.patient.phone), learning: r.bool(0.5), by: by ?? (minor ? 'guardian' : 'self'), method: 'verbal_recorded', language: c.language };
    if (p.by === 'guardian') { p.guardianName = guardianName ?? c.patient.guardian; p.assent = true; }
    if (minor && p.by === 'self') p.assent = true;
    return c.step(2, c.entry, 'CONSENT_RECORDED', p);
  }

  /** Open → consent → history → verify history → reading → verify reading. */
  function capture(c, a, hb, { narrate = false, hindi = false, readingOpts = {}, verifyAs, verifyValue, skipVerifyReading = false, skipVerifyHistory = false, consentOpts = {} } = {}) {
    consent(c, consentOpts);
    const h = narrate ? narrated(a, hindi) : { answers: a, source: 'form' };
    c.step(r.int(3, 9), c.entry, 'HISTORY_SUBMITTED', h);
    const verifier = verifyAs ?? (actorOf(c).role === 'self' ? null : c.entry);
    if (!skipVerifyHistory && verifier) c.step(r.int(1, 4), verifier, 'HISTORY_VERIFIED', {});
    const rd = reading(c.caseId, 1, hb, readingOpts);
    c.step(r.int(2, 6), c.entry, 'READING_CAPTURED', rd);
    if (!skipVerifyReading) c.step(1, verifyAs ?? c.entry, 'READING_VERIFIED', { readingId: rd.readingId, value: verifyValue ?? rd.value, unit: rd.unit });
    return c;
  }

  const submit = (c, by = c.entry, gapDays = r.range(0.05, 1.5)) => c.wait(gapDays).step(5, by, 'SUBMITTED_FOR_REVIEW', {});
  const decide = (c, decision, note, who = clin(), gapDays = r.range(0.2, 2.5)) => {
    c.wait(gapDays).step(3, who, 'CLINICIAN_DECISION', { decision, note });
    c.decider = who;
    return c;
  };
  let tSeq = 0;
  const task = (c, kind, dueDays, extra = {}) => {
    const taskId = `t-${c.caseId}-${++tSeq}`;
    const due = new Date(c.t + dueDays * DAY);
    due.setUTCHours(12, 30, 0, 0);
    c.step(2, c.decider, 'TASK_CREATED', { taskId, kind, due: due.toISOString(), assigneeRole: 'asha', assigneeId: ashaFor(c.patient), facility: extra.facility ?? FACILITY, note: extra.note ?? null });
    c.lastTask = taskId;
    return taskId;
  };
  const complete = (c, taskId, outcome, gapDays) => c.wait(gapDays).step(5, ashaFor(c.patient), 'TASK_COMPLETED', { taskId, outcome });

  const age = (lo, hi) => r.int(lo, hi);
  const hbFor = (cls, a) => {
    const mildTop = a < 12 ? 11.4 : 11.9;
    return Math.round(({ none: r.range(12.1, 13.8), mild: r.range(11.0, mildTop), moderate: r.range(8.4, 10.9), severe: r.range(6.4, 7.8) }[cls]) * 10) / 10;
  };
  const deliberate = []; // { caseId, at, reason } resolved to event ids after build

  // ======================= ARCHETYPES =======================

  // A. Ready for review, not yet submitted (incl. one severe left waiting, and one stale moderate).
  for (let i = 0; i < 6; i++) {
    const ag = age(14, 45);
    const p = person({ age: ag });
    const entry = i === 0 ? 'anm-01' : i === 1 ? 'nurse-01' : ashaFor(p);
    const daysAgo = i === 0 ? 3 : i === 1 ? 38 : r.int(1, 12);
    const c = newCase('ready', p, { daysAgo, entry });
    const cls = i === 0 ? 'severe' : r.pick(['mild', 'moderate', 'moderate']);
    capture(c, answers(ag), hbFor(cls, ag), { narrate: i === 3 || i === 5, hindi: i === 5, readingOpts: i === 1 ? { method: 'lab_report' } : {} });
  }

  // B. With clinician (in review). Some urgent: severe Hb, fainting, breathless, soaking+dizzy.
  const urgentProfiles = [
    { cls: 'severe', opts: { severeSymptoms: true } },
    { cls: 'severe', opts: { hmb: true } },
    { cls: 'moderate', opts: { fainting: true, dizzy: true } },
    { cls: 'moderate', opts: { breathless: true } },
    { cls: 'moderate', opts: { hmb: true, severeSymptoms: true } },
  ];
  for (let i = 0; i < 12; i++) {
    const ag = age(12, 47);
    const p = person({ age: ag, abha: ag >= 18 && r.bool(0.3) });
    const entry = i === 6 ? 'camp-01' : i === 7 ? 'anm-02' : ashaFor(p);
    const c = newCase('in_review', p, { daysAgo: r.int(1, 9), entry });
    const prof = urgentProfiles[i] ?? { cls: r.pick(['mild', 'moderate']), opts: {} };
    const a = answers(ag, prof.opts);
    if (prof === urgentProfiles[4]) { a.soakingHourly = true; a.dizziness = true; }
    if (i === 8) { a.heavyBleeding = false; a.periodDays = 9; } // contradiction warn for the clinician
    const hb = hbFor(prof.cls, ag);
    // One OCR decimal slip corrected by the ASHA (94 → 9.4) to show HB_DECIMAL_CORRECTION.
    const ro = i === 9 ? { ocrText: `QuickHb Q5\n${Math.round(hb * 10)} g/dL`, device: DEVICES[2] } : {};
    capture(c, a, i === 9 ? Math.round(hb * 10) : hb, { readingOpts: ro, verifyValue: i === 9 ? hb : undefined, narrate: i === 10 });
    submit(c);
  }

  // C. Falling Hb across visits: 2 women, each with 2 prior cases linked by patient.id.
  const fallSeries = [[11.6, 10.4, 9.1], [10.9, 9.6, 8.3]];
  for (let k = 0; k < 2; k++) {
    const ag = k === 0 ? 17 : 29;
    const p = person({ age: ag, block: k === 0 ? 'Tekari' : 'Sadar', abha: k === 1, phone: true });
    const days = [56, 31, 4];
    fallSeries[k].forEach((hb, j) => {
      const entry = k === 0 && j === 0 ? 'school-01' : ashaFor(p);
      const c = newCase(j < 2 ? 'prior_visit' : 'falling_current', p, { daysAgo: days[j], entry });
      capture(c, answers(ag, { hmb: true }), hb);
      if (j < 2) {
        submit(c);
        if (j === 0) {
          decide(c, 'manage_locally', 'Mild anaemia with heavy periods. IFA and diet counselling; recheck in 4 weeks.');
          const tk = task(c, 'recheck', 28);
          complete(c, tk, 'Rechecked at home visit', 24);
          c.wait(1).step(10, c.decider, 'CASE_CLOSED', { reason: 'recheck done; new case opened for repeat Hb' });
        } else {
          decide(c, 'refer', 'Hb falling despite IFA. Refer to PHC for evaluation of bleeding.');
          const tk = task(c, 'referral', 7);
          complete(c, tk, 'Attended PHC; advised review after next period', 6);
        }
      } else submit(c);
    });
  }

  // D. Blocking flags.
  // D1. Unit entered wrongly: g/L value typed as g/dL. One worker then tries to submit (rejected).
  for (let i = 0; i < 3; i++) {
    const ag = age(19, 44);
    const p = person({ age: ag });
    const entry = i === 2 ? 'camp-01' : ashaFor(p);
    const c = newCase('blocked_unit', p, { daysAgo: r.int(0, 6), entry });
    const gl = Math.round(hbFor('moderate', ag) * 10);
    capture(c, answers(ag), gl, { readingOpts: { method: 'manual', device: DEVICES[i % 4] } });
    if (i === 0) {
      c.step(6, c.entry, 'SUBMITTED_FOR_REVIEW', {});
      deliberate.push({ caseId: c.caseId, at: c.t, reason: 'Worker tried to submit with blocking HB_UNIT_SUSPECT flag; the engine refuses.' });
    }
  }
  // D2. Missing required history fields (partial voice intake, never completed).
  for (let i = 0; i < 4; i++) {
    const ag = age(20, 46);
    const p = person({ age: ag });
    const c = newCase('blocked_missing', p, { daysAgo: r.int(0, 8), entry: ashaFor(p) });
    const full = answers(ag);
    const drop = [['padsPerDay'], ['fainting', 'breathless'], ['periodDays'], ['pregnant']][i];
    for (const k of drop) delete full[k];
    capture(c, full, hbFor(r.pick(['mild', 'moderate']), ag));
  }
  // D3. Minor without guardian consent (school / camp screening). One tries to submit (rejected).
  for (let i = 0; i < 3; i++) {
    const ag = age(13, 16);
    const p = person({ age: ag, block: i === 0 ? 'Bodh Gaya' : undefined, devanagari: i === 1 });
    const entry = i === 2 ? 'camp-01' : 'school-01';
    const c = newCase('blocked_minor_consent', p, { daysAgo: r.int(1, 10), entry });
    capture(c, answers(ag), hbFor('mild', ag), { consentOpts: { by: 'self', messaging: false } });
    if (i === 0) {
      c.step(4, c.entry, 'SUBMITTED_FOR_REVIEW', {});
      deliberate.push({ caseId: c.caseId, at: c.t, reason: 'School team tried to submit a minor\'s case without guardian consent (CONSENT_GUARDIAN is blocking); the engine refuses.' });
    }
  }

  // E. Decided, follow-up task open. 6 overdue → follow-up agent proposals.
  const followups = [];
  for (let i = 0; i < 15; i++) {
    const ag = age(13, 46);
    const overdue = i < 6;
    const p = person({ age: ag, phone: overdue ? i % 3 !== 2 : undefined });
    const entry = i === 9 ? 'anm-02' : i === 10 ? 'camp-01' : ashaFor(p);
    const refer = overdue || r.bool(0.5);
    // Overdue: referral due 7 days after a decision 10–25 days ago. Not overdue: due in the future.
    const daysAgo = overdue ? r.int(14, 30) : refer ? r.int(2, 5) : r.int(3, 25);
    const c = newCase('followup_pending', p, { daysAgo, entry });
    capture(c, answers(ag), hbFor(refer ? 'moderate' : r.pick(['mild', 'moderate']), ag), { consentOpts: overdue && i % 3 !== 2 ? { messaging: true } : {} });
    submit(c, c.entry, 0.3);
    if (refer) {
      decide(c, 'refer', r.pick(['Moderate anaemia with heavy bleeding: refer to PHC for evaluation.', 'Refer to PHC for Hb confirmation and HMB assessment.', 'Refer to CHC gynaecology OPD.']), undefined, 0.5);
      task(c, 'referral', 7, { facility: r.pick([FACILITY, 'CHC Tekari', 'District Hospital Gaya']) });
    } else {
      decide(c, 'manage_locally', 'Mild/moderate anaemia: IFA as per AMB, diet counselling, recheck Hb in 4 weeks.', undefined, 0.5);
      task(c, 'recheck', 28);
    }
    followups.push({ c, overdue });
  }

  // F. Decided, follow-up completed (status "decided").
  for (let i = 0; i < 3; i++) {
    const ag = age(18, 44);
    const p = person({ age: ag });
    const c = newCase('decided', p, { daysAgo: r.int(20, 45), entry: ashaFor(p) });
    capture(c, answers(ag), hbFor('moderate', ag));
    submit(c);
    decide(c, 'manage_locally', 'IFA as per AMB; recheck in 2 weeks.');
    const tk = task(c, 'recheck', 14);
    complete(c, tk, r.pick(['Recheck done at VHSND: Hb improving', 'Visited; taking IFA daily']), r.int(10, 14));
  }

  // G. Closed.
  for (let i = 0; i < 9; i++) {
    const ag = age(15, 45);
    const p = person({ age: ag });
    const entry = i === 0 ? 'school-01' : i === 1 ? 'camp-01' : ashaFor(p);
    const c = newCase('closed', p, { daysAgo: r.int(25, 58), entry });
    if (i < 3) {
      capture(c, answers(ag, { hmb: false }), hbFor('none', ag));
      submit(c);
      decide(c, 'close', 'Hb within normal range; no heavy-bleeding indicators. Routine advice.');
    } else if (i === 3) {
      const a = answers(ag);
      a.pregnant = 'yes';
      capture(c, a, hbFor('mild', ag));
      submit(c);
      decide(c, 'close', 'Pregnant: outside this protocol. Routed to the ANC pathway with the ANM.');
    } else {
      capture(c, answers(ag), hbFor(r.pick(['mild', 'moderate']), ag));
      submit(c);
      decide(c, 'refer', 'Refer to PHC for evaluation.');
      const tk = task(c, 'referral', 7);
      complete(c, tk, r.pick(['Attended PHC; treatment started', 'Seen at CHC; follow-up with ANM', 'Attended PHC; ultrasound advised']), r.int(3, 8));
      c.wait(r.range(1, 4)).step(10, c.decider, 'CASE_CLOSED', { reason: 'referral completed' });
    }
  }

  // H. Duplicate person across scripts: प्रिया कुमारी / Priya Kumari etc. (same village & birth year).
  dupDefs.forEach((d, k) => {
    const pa = person({ age: d.ag, block: d.block, village: d.village, devanagari: true, first: d.f, surname: d.s });
    const pb = person({ age: d.ag, block: d.block, village: d.village, first: d.f, surname: d.s, phone: true });
    if (d.guardian) pa.guardian = pb.guardian = d.guardian; // same family
    else { delete pa.guardian; delete pb.guardian; }
    // First registration (Devanagari, often self-registered or by camp) ...
    const ca = newCase(k === 0 ? 'duplicate_a_self' : 'duplicate_a', pa, { daysAgo: 40 - k * 6, entry: k === 0 ? { id: `self-${pa.id}`, role: 'self' } : 'camp-01' });
    if (k === 0) {
      // Self-started on her own phone: history and reading entered by her, never verified by a worker.
      consent(ca, { by: 'guardian', guardianName: pa.guardian, messaging: false });
      ca.step(6, ca.entry, 'HISTORY_SUBMITTED', { answers: answers(d.ag), source: 'self_form' });
      ca.step(5, ca.entry, 'READING_CAPTURED', reading(ca.caseId, 1, hbFor('moderate', d.ag)));
    } else {
      capture(ca, answers(d.ag), hbFor('mild', d.ag));
      submit(ca);
      decide(ca, 'close', 'Mild anaemia: IFA advice given at camp; ASHA to recheck at next routine visit.');
    }
    // ... later the ASHA registers her again in Latin script.
    const cb = newCase(k === 2 ? 'duplicate_b_linked' : 'duplicate_b', pb, { daysAgo: r.int(1, 6), entry: ashaFor(pb) });
    capture(cb, answers(d.ag), hbFor('moderate', d.ag));
    if (k === 2) {
      // The ASHA confirms the agent's link proposal.
      cb.step(20, cb.entry, 'PROPOSAL_APPROVED', (s) => {
        const pr = Object.values(s.proposals).find((x) => x.action.type === 'PATIENTS_LINKED' && x.status === 'pending');
        return pr ? { proposalId: pr.id, note: 'Same person: confirmed with her mother at home visit' } : null;
      });
    }
  });

  // I. Reused photo: the same device photo attached to a second woman's case (blocking).
  {
    const ag1 = age(22, 40);
    const p1 = person({ age: ag1, block: 'Bodh Gaya' });
    const hash = `sha256:${r.hex(64)}`;
    const c1 = newCase('photo_original', p1, { daysAgo: 2, entry: 'asha-03' });
    capture(c1, answers(ag1), 9.8, { readingOpts: { imageHash: hash, device: DEVICES[0] } });
    const ag2 = age(22, 40);
    const p2 = person({ age: ag2, block: 'Bodh Gaya' });
    const c2 = newCase('blocked_reused_photo', p2, { daysAgo: 2, entry: 'asha-03' });
    c2.t = c1.t + 25 * MIN; // same ASHA, next house, same afternoon
    c2.steps[0].at = c2.t;
    capture(c2, answers(ag2), 9.8, { readingOpts: { imageHash: hash, device: DEVICES[0] } });
  }

  // J. Early stages: self-started, unverified readings, drafts.
  for (let i = 0; i < 4; i++) {
    const ag = age(19, 38);
    const p = person({ age: ag, phone: true, devanagari: i % 2 === 0 });
    const self = { id: `self-${p.id}`, role: 'self' };
    const c = newCase('self_started', p, { daysAgo: r.int(0, 5), entry: self, channel: i === 3 ? 'whatsapp' : 'app' });
    consent(c, { messaging: true });
    const a = answers(ag);
    if (i < 2) c.step(7, self, 'HISTORY_SUBMITTED', narrated(a, i === 0));
    else {
      c.step(7, self, 'HISTORY_SUBMITTED', { answers: a, source: 'self_form' });
      const rd = reading(c.caseId, 1, hbFor('mild', ag));
      c.step(4, self, 'READING_CAPTURED', rd);
      if (i === 3) c.step(2, self, 'READING_VERIFIED', { readingId: rd.readingId, value: rd.value, unit: rd.unit });
    }
  }
  // Self-started then picked up and verified by the ASHA → ready for review.
  {
    const ag = age(20, 35);
    const p = person({ age: ag, phone: true });
    const self = { id: `self-${p.id}`, role: 'self' };
    const c = newCase('self_then_asha', p, { daysAgo: 6, entry: self });
    consent(c, { messaging: true });
    c.step(9, self, 'HISTORY_SUBMITTED', narrated(answers(ag, { hmb: true }), false));
    const rd = reading(c.caseId, 1, hbFor('moderate', ag));
    c.wait(1).step(0, ashaFor(p), 'HISTORY_VERIFIED', {});
    c.step(3, ashaFor(p), 'READING_CAPTURED', rd);
    c.step(1, ashaFor(p), 'READING_VERIFIED', { readingId: rd.readingId, value: rd.value, unit: rd.unit });
  }
  for (let i = 0; i < 3; i++) {
    const ag = age(14, 30);
    const p = person({ age: ag });
    const entry = 'camp-01';
    const c = newCase('reading_unverified', p, { daysAgo: 0.2 + i * 0.1, entry });
    capture(c, answers(ag), hbFor(r.pick(['mild', 'moderate']), ag), { skipVerifyReading: true });
  }
  {
    const ag = age(25, 40);
    const p = person({ age: ag });
    const c = newCase('draft', p, { daysAgo: 0.1, entry: ashaFor(p) });
    consent(c);
  }

  // K. Returned for more information.
  for (let i = 0; i < 2; i++) {
    const ag = age(18, 40);
    const p = person({ age: ag });
    const c = newCase('returned', p, { daysAgo: r.int(3, 10), entry: ashaFor(p) });
    capture(c, answers(ag, { hmb: true }), hbFor('moderate', ag));
    submit(c);
    decide(c, 'return_for_info', i === 0 ? 'Please confirm pad count on heaviest day and whether clots are larger than a ₹5 coin.' : 'Please repeat Hb: device photo is blurred.');
  }

  // L. Competing offline decisions → conflict for the MO to resolve.
  {
    const ag = age(24, 40);
    const p = person({ age: ag, block: 'Tekari' });
    const c = newCase('conflict', p, { daysAgo: 3, entry: 'anm-02' });
    capture(c, answers(ag, { hmb: true }), hbFor('moderate', ag));
    submit(c);
    c.wait(1).step(0, 'dr-01', 'CLINICIAN_DECISION', { decision: 'refer', note: 'Refer to CHC for gynaecology review.' });
    c.step(7, 'dr-02', 'CLINICIAN_DECISION', { decision: 'manage_locally', note: 'IFA and recheck in 4 weeks (decided offline at sub-centre).' });
  }

  // ---------- run the global timeline ----------
  let log = [];
  const all = [];
  for (const c of cases) for (const s of c.steps) all.push({ ...s, caseId: c.caseId, c });
  // Follow-up handling on overdue tasks needs the agents' proposals first: a sweep 3 days before
  // the anchor, then human actions on some proposals, then the final sweep at the anchor.
  const sweep1 = ANCHOR_MS - 3 * DAY + 2 * 3600e3;
  all.push({ at: sweep1, sweep: true });
  const od = followups.filter((f) => f.overdue).map((f) => f.c);
  const human = (c, at, actor, type, payload) => all.push({ at, caseId: c.caseId, c, actor: ACTORS[actor] ?? actor, type, payload });
  const findProp = (type) => (s) => Object.values(s.proposals).find((p) => p.action.type === type && p.status === 'pending');
  // od[0]: ANM approves the escalation; ASHA approves the reminder; system sends it (dry run).
  human(od[0], sweep1 + 26 * 3600e3, anmFor(od[0].patient), 'PROPOSAL_APPROVED', (s) => { const p = findProp('ESCALATE')(s); return p && { proposalId: p.id }; });
  human(od[0], sweep1 + 27 * 3600e3, ashaFor(od[0].patient), 'PROPOSAL_APPROVED', (s) => { const p = findProp('MESSAGE_SEND')(s); return p && { proposalId: p.id }; });
  human(od[0], sweep1 + 27 * 3600e3 + 2 * MIN, SYSTEM, 'MESSAGE_SENT', (s) => { const m = Object.values(s.proposals).find((p) => p.action.type === 'MESSAGE_SEND' && p.status === 'approved'); return m && { proposalId: m.id, channel: 'whatsapp', providerId: null, dryRun: true }; });
  // od[1]: ANM rejects the escalation with a reason (she already knows why).
  human(od[1], sweep1 + 30 * 3600e3, anmFor(od[1].patient), 'PROPOSAL_REJECTED', (s) => { const p = findProp('ESCALATE')(s); return p && { proposalId: p.id, reason: 'Family travelling for a wedding; ASHA will visit on return next week.' }; });
  // od[2]: MO approves the escalation.
  human(od[2], sweep1 + 31 * 3600e3, 'mo-01', 'PROPOSAL_APPROVED', (s) => { const p = findProp('ESCALATE')(s); return p && { proposalId: p.id }; });
  all.push({ at: ANCHOR_MS - 1000, sweep: true, final: true }); // agents' output lands exactly on the anchor

  all.sort((x, y) => x.at - y.at);
  const deliberateIds = [];
  const ctxFor = (at) => ({ pack, now: new Date(at + 1000).toISOString(), facility: FACILITY, device: 'demo-seed' });
  const closedNow = (id) => reduce(log, id).closed;
  for (const s of all) {
    if (s.at > ANCHOR_MS) throw new Error(`step after anchor: ${s.caseId} ${s.type}`);
    if (s.sweep) {
      for (const c of cases) if (!closedNow(c.caseId)) log = settle(log, c.caseId, ctxFor(s.at));
      continue;
    }
    let payload = s.payload;
    if (typeof payload === 'function') {
      payload = payload(reduce(log, s.caseId), log);
      if (!payload) throw new Error(`no target for ${s.type} on ${s.caseId}`);
    }
    if (s.type === 'READING_CAPTURED' && payload._measuredOffsetMin != null) {
      const { _measuredOffsetMin, ...rest } = payload;
      payload = { ...rest, measuredAt: new Date(s.at - _measuredOffsetMin * MIN).toISOString() };
    }
    const e = makeEvent({ caseId: s.caseId, type: s.type, actor: s.actor, payload, at: new Date(s.at).toISOString(), protocol, device: s.actor.role === 'self' ? 'own-phone' : s.actor.role === 'system' ? 'server' : `tab-${s.actor.id}` });
    log.push(e);
    const d = deliberate.find((x) => x.caseId === s.caseId && x.at === s.at);
    if (d) deliberateIds.push({ eventId: e.id, caseId: s.caseId, type: s.type, reason: d.reason });
    // Opening and consent are one sitting in the field app: agents run after consent, so every
    // case log starts CASE_OPENED → CONSENT_RECORDED.
    if (s.type === 'CASE_OPENED') continue;
    if (!closedNow(s.caseId)) log = settle(log, s.caseId, ctxFor(s.at));
  }

  log.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return {
    anchor: ANCHOR,
    events: log,
    cases: cases.map((c) => ({ caseId: c.caseId, archetype: c.archetype, patientId: c.patient.id })),
    deliberateRejections: deliberateIds,
  };
}

/** Status / flag / proposal histograms and any unexpected rejections. */
export function summarise(demo) {
  const states = reduceAll(demo.events);
  const status = {};
  const flags = {};
  const proposals = {};
  const entry = {};
  const archetype = {};
  const unexpected = [];
  const expected = new Set(demo.deliberateRejections.map((d) => d.eventId));
  for (const s of states) {
    status[s.status] = (status[s.status] ?? 0) + 1;
    entry[s.entry?.role] = (entry[s.entry?.role] ?? 0) + 1;
    for (const f of s.flags) flags[f.code] = (flags[f.code] ?? 0) + 1;
    for (const p of Object.values(s.proposals)) {
      const k = `${p.action.type}:${p.status}`;
      proposals[k] = (proposals[k] ?? 0) + 1;
    }
    for (const rj of s.rejected) if (!expected.has(rj.eventId)) unexpected.push({ caseId: s.caseId, ...rj });
  }
  for (const c of demo.cases) archetype[c.archetype] = (archetype[c.archetype] ?? 0) + 1;
  const overdueTasks = states.reduce((n, s) => n + Object.values(s.tasks).filter((t) => t.status === 'open' && t.due && Date.parse(t.due) < Date.parse(demo.anchor)).length, 0);
  const rejected = states.reduce((n, s) => n + s.rejected.length, 0);
  return { anchor: demo.anchor, cases: states.length, events: demo.events.length, status, entry, flags, proposals, archetype, overdueTasks, rejected, deliberateRejections: demo.deliberateRejections, unexpectedRejections: unexpected };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = performance.now();
  const seed = parseSeed(process.argv, 7);
  const oi = process.argv.indexOf('--out');
  const out = oi >= 0 ? process.argv[oi + 1] : join(ROOT, 'data/demo/events.json');
  const demo = buildDemo({ seed });
  const sum = summarise(demo);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(demo.events, null, 1) + '\n');
  writeFileSync(join(dirname(out), 'summary.json'), JSON.stringify({ generatedBy: 'learning/seed-demo.js', seed, ...sum, cases: demo.cases }, null, 2) + '\n');
  const h = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join('\n');
  console.log(`demo seed ${seed}: ${sum.cases} cases, ${sum.events} events, anchor ${sum.anchor} → ${out}`);
  console.log(`\nstatus:\n${h(sum.status)}\n\nentry role:\n${h(sum.entry)}\n\nflags (cases with flag):\n${h(sum.flags)}\n\nproposals:\n${h(sum.proposals)}`);
  console.log(`\noverdue open tasks at anchor: ${sum.overdueTasks}`);
  console.log(`rejected events: ${sum.rejected} (deliberate ${sum.deliberateRejections.length}, unexpected ${sum.unexpectedRejections.length})`);
  for (const d of sum.deliberateRejections) console.log(`  deliberate: ${d.caseId} ${d.type} — ${d.reason}`);
  for (const u of sum.unexpectedRejections) console.log(`  UNEXPECTED: ${u.caseId} ${u.type} — ${u.reason}`);
  console.log(`(${Math.round(performance.now() - t0)} ms)`);
  if (sum.unexpectedRejections.length) process.exitCode = 1;
}
