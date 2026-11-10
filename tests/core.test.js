import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEvent, reduce, propose } from '../core/workflow.js';
import { settle } from '../core/agents/index.js';
import { runChecks } from '../core/agents/check.js';
import { parseHbDisplay } from '../core/ocr.js';
import { extractHistory } from '../core/agents/intake.js';
import { nameKey, matchPatients } from '../core/identity.js';
import { toBundle } from '../core/fhir.js';
import { toDhis2, ask } from '../core/report.js';
import { classifyHb } from '../core/protocol.js';

const pack = JSON.parse(readFileSync(new URL('../protocols/anemia-hmb/pack.json', import.meta.url)));
const asha = { id: 'asha-01', role: 'asha' };
const doc = { id: 'dr-01', role: 'clinician' };
const doc2 = { id: 'dr-02', role: 'clinician' };
let clock = Date.parse('2026-11-01T09:00:00Z');
const at = () => new Date((clock += 60000)).toISOString();
const ev = (caseId, type, actor, payload) => makeEvent({ caseId, type, actor, payload, at: at(), protocol: { id: pack.id, version: pack.version } });

function openCase(caseId, patient, answers, hb = { value: 9.4, unit: 'g/dL' }) {
  const log = [
    ev(caseId, 'CASE_OPENED', asha, { patient, language: 'hi' }),
    ev(caseId, 'CONSENT_RECORDED', asha, { care: true, messaging: true, by: answers.ageYears < 18 ? 'guardian' : 'self' }),
    ev(caseId, 'HISTORY_SUBMITTED', asha, { answers, source: 'form' }),
    ev(caseId, 'HISTORY_VERIFIED', asha, {}),
    ev(caseId, 'READING_CAPTURED', asha, { readingId: `r-${caseId}`, kind: 'hb', value: hb.value, unit: hb.unit, method: 'camera_ocr' }),
    ev(caseId, 'READING_VERIFIED', asha, { readingId: `r-${caseId}`, value: hb.value, unit: hb.unit }),
  ];
  return log;
}
const base = { ageYears: 16, pregnant: 'no', periodDays: 8, padsPerDay: 7, heavyBleeding: true, dizziness: true, breathless: false, fainting: false };

test('WHO 2024 Hb bands by age', () => {
  assert.equal(classifyHb(pack, 7.9, 20).cls, 'severe');
  assert.equal(classifyHb(pack, 8.0, 20).cls, 'moderate');
  assert.equal(classifyHb(pack, 11.0, 20).cls, 'mild');
  assert.equal(classifyHb(pack, 12.0, 20).cls, 'none');
  assert.equal(classifyHb(pack, 11.4, 11).cls, 'mild');
  assert.equal(classifyHb(pack, 11.5, 11).cls, 'none');
});

test('full case: capture → checks → review → decision → task → FHIR', () => {
  let log = openCase('c1', { id: 'pt-1', name: 'Priya Kumari', birthYear: 2010, village: 'Rampur', block: 'Sadar', district: 'Gaya', phone: '+919900000001' }, base);
  log = settle(log, 'c1', { pack, now: at() });
  let s = reduce(log, 'c1');
  assert.equal(s.status, 'ready_for_review');
  assert.ok(s.flags.some((f) => f.code === 'HB_BAND' && f.hbClass === 'moderate'));
  assert.ok(s.flags.some((f) => f.code === 'HMB_INDICATORS'));
  assert.ok(s.handoff.lines.some((l) => l.kind === 'reading' && l.sources.length));
  log.push(ev('c1', 'SUBMITTED_FOR_REVIEW', asha, {}));
  assert.equal(reduce(log, 'c1').status, 'in_review');
  log.push(ev('c1', 'CLINICIAN_DECISION', doc, { decision: 'refer', note: 'PHC review' }));
  log.push(ev('c1', 'TASK_CREATED', doc, { taskId: 't1', kind: 'referral', due: '2026-11-03T00:00:00Z', assigneeRole: 'asha' }));
  s = reduce(log, 'c1');
  assert.equal(s.status, 'followup_pending');
  const b = toBundle(s, pack, { now: at() });
  const types = b.entry.map((e) => e.resource.resourceType);
  for (const r of ['Patient', 'Encounter', 'Observation', 'QuestionnaireResponse', 'Task', 'Provenance']) assert.ok(types.includes(r), r);
  const obs = b.entry.find((e) => e.resource.resourceType === 'Observation').resource;
  assert.equal(obs.code.coding[0].code, '718-7');
  assert.equal(obs.valueQuantity.code, 'g/dL');
  assert.ok(b.entry.every((e) => /^[A-Za-z0-9\-.]{1,64}$/.test(e.resource.id)));
});

test('agents cannot make clinical decisions or send messages', () => {
  const log = openCase('c2', { id: 'pt-2', name: 'Anita', birthYear: 2000 }, { ...base, ageYears: 26 });
  log.push(ev('c2', 'SUBMITTED_FOR_REVIEW', asha, {}));
  log.push(ev('c2', 'CLINICIAN_DECISION', { id: 'femos-x', role: 'agent' }, { decision: 'close' }));
  log.push(ev('c2', 'READING_VERIFIED', { id: 'femos-x', role: 'agent' }, { readingId: 'r-c2', value: 12, unit: 'g/dL' }));
  const s = reduce(log, 'c2');
  assert.equal(s.decision, null);
  assert.ok(s.rejected.some((r) => /role agent may not CLINICIAN_DECISION/.test(r.reason)));
});

test('blocking flags stop submission until fixed', () => {
  let log = openCase('c3', { id: 'pt-3', name: 'Sunita', birthYear: 1999 }, { ...base, ageYears: 27 }, { value: 112, unit: 'g/dL' });
  log = settle(log, 'c3', { pack, now: at() });
  let s = reduce(log, 'c3');
  assert.ok(s.flags.some((f) => f.code === 'HB_UNIT_SUSPECT' && f.blocking));
  log.push(ev('c3', 'SUBMITTED_FOR_REVIEW', asha, {}));
  s = reduce(log, 'c3');
  assert.ok(s.rejected.some((r) => /blocking flags/.test(r.reason)));
  assert.notEqual(s.status, 'in_review');
});

test('competing offline decisions become a conflict, resolved by a human', () => {
  let log = openCase('c4', { id: 'pt-4', name: 'Rekha', birthYear: 1998 }, { ...base, ageYears: 28 });
  log = settle(log, 'c4', { pack, now: at() });
  log.push(ev('c4', 'SUBMITTED_FOR_REVIEW', asha, {}));
  const d1 = ev('c4', 'CLINICIAN_DECISION', doc, { decision: 'refer' });
  const d2 = ev('c4', 'CLINICIAN_DECISION', doc2, { decision: 'manage_locally' });
  log.push(d2, d1); // arrive out of order from two devices
  let s = reduce(log, 'c4');
  assert.equal(s.status, 'conflict');
  log.push(ev('c4', 'CONFLICT_RESOLVED', doc, { conflictId: s.conflicts[0].id, keepEventId: d1.id }));
  s = reduce(log, 'c4');
  assert.equal(s.decision.decision, 'refer');
  assert.notEqual(s.status, 'conflict');
});

test('sync is idempotent: duplicated events do not change state', () => {
  const log = openCase('c5', { id: 'pt-5', name: 'Meena', birthYear: 2001 }, { ...base, ageYears: 25 });
  const a = reduce(log, 'c5');
  const b = reduce([...log, ...log, ...log.slice().reverse()], 'c5');
  assert.deepEqual(a, b);
});

test('proposal → approval executes action attributed to the approver', () => {
  let log = openCase('c6', { id: 'pt-6', name: 'Kavita', birthYear: 2002 }, { ...base, ageYears: 24 });
  const p = propose({ caseId: 'c6', agent: 'femos-followup', at: at(), action: { type: 'ESCALATE', payload: { taskId: 'tx', assigneeRole: 'anm', reason: 'overdue' } }, rationale: 'test' });
  log.push(p);
  log.push(ev('c6', 'PROPOSAL_APPROVED', { id: 'anm-1', role: 'anm' }, { proposalId: p.payload.proposalId }));
  const s = reduce(log, 'c6');
  assert.equal(s.tasks.tx.createdBy, 'anm-1');
  assert.equal(s.proposals[p.payload.proposalId].status, 'approved');
});

test('falling Hb across linked visits is flagged', () => {
  const log1 = openCase('v1', { id: 'pt-7', name: 'Pooja', birthYear: 2008 }, { ...base, ageYears: 18 }, { value: 11.8, unit: 'g/dL' });
  const log2 = openCase('v2', { id: 'pt-7', name: 'Pooja', birthYear: 2008 }, { ...base, ageYears: 18 }, { value: 10.4, unit: 'g/dL' });
  const log = settle([...log1, ...log2], 'v2', { pack, now: at() });
  const s = reduce(log, 'v2');
  assert.ok(s.flags.some((f) => f.code === 'HB_FALLING'), JSON.stringify(s.flags.map((f) => f.code)));
});

test('OCR parser: accepts clean, rejects ambiguous, never repairs decimals', () => {
  assert.deepEqual([parseHbDisplay('HemoCheck HB-201\n11.4 g/dL\n10:42').status, parseHbDisplay('HemoCheck HB-201\n11.4 g/dL\n10:42').value], ['candidate', 11.4]);
  assert.equal(parseHbDisplay('Hb 9.8 g/dL 85%').value, 9.8);
  assert.equal(parseHbDisplay('124 g/dL').status, 'decimal_suspect');
  assert.equal(parseHbDisplay('12 g/dL').status, 'decimal_suspect');
  assert.equal(parseHbDisplay('11.4 9.8 g/dL').status, 'ambiguous');
  assert.equal(parseHbDisplay('').status, 'no_reading');
  assert.equal(parseHbDisplay('Hb 1l.4 g/dL').value, 11.4);
  const gl = parseHbDisplay('Hb 114 g/L');
  assert.equal(gl.status, 'candidate');
  assert.equal(gl.unit, 'g/L');
  assert.equal(parseHbDisplay('10.2').unit, null);
  // v2 regressions from the benchmark
  assert.equal(parseHbDisplay('1 3.1 g/dL').status, 'ambiguous', 'split leading digit');
  assert.equal(parseHbDisplay('Hb\nI ] I g/dL\nPREV 13.7 g/dL').status, 'no_reading', 'labelled previous value');
  assert.equal(parseHbDisplay('M 03\n11.4 g/dL').value, 11.4, 'memory slot ignored');
  assert.equal(parseHbDisplay('Hb 11.4 g/dL', { words: [{ text: 'Hb', confidence: 95 }, { text: '11.4', confidence: 20 }] }).status, 'low_confidence');
  assert.equal(parseHbDisplay('5.1 g/dL', { words: [{ text: '5.1', confidence: 90, h: 20 }, { text: '1]3', confidence: 30, h: 90 }] }).status, 'ambiguous', 'small number when big digits unread');
});

test('intake extracts Hindi/Hinglish/English with explicit negation only', () => {
  const h = extractHistory('Umar 16 saal. Mahwari 9 din chalti hai, 7 pad lagte hain. Chakkar aate hain, lekin behosh nahi hui. Saans nahi phoolti.');
  assert.equal(h.answers.ageYears, 16);
  assert.equal(h.answers.periodDays, 9);
  assert.equal(h.answers.padsPerDay, 7);
  assert.equal(h.answers.dizziness, true);
  assert.equal(h.answers.fainting, false);
  assert.equal(h.answers.breathless, false);
  assert.equal(h.answers.clots, undefined);
  const k = extractHistory('Bade thakke aate hain. Chakkar aate hain.');
  assert.equal(k.answers.clots, true);
  assert.equal(k.answers.fatigue, undefined, 'thakke (clots) must not be read as fatigue');
  assert.equal(extractHistory('aur thakan rehti hai').answers.fatigue, true);
  const d = extractHistory('उम्र 22 साल। माहवारी 8 दिन तक, बहुत खून आता है। चक्कर आते हैं।');
  assert.equal(d.answers.ageYears, 22);
  assert.equal(d.answers.periodDays, 8);
  assert.equal(d.answers.heavyBleeding, true);
  assert.equal(d.answers.dizziness, true);
  const e = extractHistory('She is 30 years old, period lasts 5 days, not dizzy, feels tired, has clots.');
  assert.equal(e.answers.dizziness, false);
  assert.equal(e.answers.fatigue, true);
  assert.equal(e.answers.clots, true);
});

test('identity matching across scripts proposes, never decides', () => {
  assert.equal(nameKey('प्रिया'), nameKey('Priya'));
  assert.equal(nameKey('Pria'), nameKey('PRIYAA'));
  assert.equal(nameKey('பிரியா'), nameKey('Priya'), 'Tamil');
  assert.equal(nameKey('ப்ரியா'), nameKey('Priya'), 'Tamil with pulli');
  const m = matchPatients({ name: 'प्रिया कुमारी', birthYear: 2010, village: 'Rampur' }, { name: 'Priya Kumari', birthYear: 2010, village: 'Rampur' });
  assert.equal(m.level, 'likely');
  assert.equal(matchPatients({ name: 'A', identifiers: [{ system: 'abha', value: '1' }] }, { name: 'A', identifiers: [{ system: 'abha', value: '2' }] }).level, 'different_identifier');
});

test('reports and supervisor answers are computed deterministically', () => {
  let log = openCase('r1', { id: 'pt-9', name: 'Lata', birthYear: 1996, village: 'Rampur', block: 'Sadar' }, { ...base, ageYears: 30 }, { value: 7.2, unit: 'g/dL' });
  log = settle(log, 'r1', { pack, now: at() });
  const s = reduce(log, 'r1');
  assert.ok(s.flags.some((f) => f.code === 'DANGER_SIGNS'));
  const d = toDhis2([s], pack, { period: '202611', orgUnit: 'OU1' });
  assert.equal(d.dataValues.find((v) => v.dataElement === 'FEMOS_HB_SEVERE').value, '1');
  const a = ask('severe cases in Rampur', [s], pack);
  assert.equal(a.count, 1);
});

test('minor without guardian consent is blocked', () => {
  const log = openCase('m1', { id: 'pt-10', name: 'Riya', birthYear: 2012 }, { ...base, ageYears: 14 });
  log[1].payload.by = 'self';
  const s = reduce(log, 'm1');
  const flags = runChecks(s, { pack, now: at() });
  assert.ok(flags.some((f) => f.code === 'CONSENT_GUARDIAN' && f.blocking));
});
