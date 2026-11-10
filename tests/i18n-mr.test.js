// Marathi (mr): intake extraction from Marathi, romanised Marathi and code-mixed speech; cross-script
// identity matching; UI catalogue completeness and placeholders. Silence must never become "no".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHistory } from '../core/agents/intake.js';
import { nameKey, matchPatients } from '../core/identity.js';
import { T, CATALOGUES, missing } from '../core/i18n/index.js';

const ex = (s) => extractHistory(s).answers;

test('mr: age, period length, pads and dizziness (Devanagari)', () => {
  const a = ex('माझे वय 16 वर्षे आहे. पाळी 9 दिवस चालते, 7 पॅड लागतात, चक्कर येते');
  assert.equal(a.ageYears, 16);
  assert.equal(a.periodDays, 9);
  assert.equal(a.padsPerDay, 7);
  assert.equal(a.dizziness, true);
  assert.equal(a.fatigue, undefined);
  assert.equal(a.breathless, undefined);
});

test('mr: number words in Devanagari', () => {
  const a = ex('वय सोळा वर्षे, मासिक पाळी आठ दिवस असते, दोन पॅड लागतात');
  assert.equal(a.ageYears, 16);
  assert.equal(a.periodDays, 8);
  assert.equal(a.padsPerDay, 2);
});

test('mr: "पण" flips polarity: fatigue yes, breathless no', () => {
  const a = ex('थकवा खूप आहे पण दम लागत नाही');
  assert.equal(a.fatigue, true);
  assert.equal(a.breathless, false);
  assert.equal(a.dizziness, undefined);
  assert.equal(a.heavyBleeding, undefined);
});

test('mr: romanised Marathi', () => {
  const a = ex('vay sola varsh, pali saha divas, chakkar yete ani thakva aahe');
  assert.equal(a.ageYears, 16);
  assert.equal(a.periodDays, 6);
  assert.equal(a.dizziness, true);
  assert.equal(a.fatigue, true);
  assert.equal(a.breathless, undefined);
});

test('mr: explicit negation of pregnancy and fainting', () => {
  const a = ex('मी गरोदर नाही. भोवळ कधीच आली नाही.');
  assert.equal(a.pregnant, 'no');
  assert.equal(a.fainting, false);
  assert.equal(a.dizziness, undefined);
});

test('mr: pregnancy stated (romanised) and breathlessness', () => {
  const a = ex('Mala dam lagto. Ti garodar aahe');
  assert.equal(a.breathless, true);
  assert.equal(a.pregnant, 'yes');
});

test('mr: code-mixed with English', () => {
  const a = ex('Periods 8 days, dar 1-2 tasala pad bhijte, gathi padtat, but iron goli ghetli nahi');
  assert.equal(a.periodDays, 8);
  assert.equal(a.soakingHourly, true);
  assert.equal(a.clots, true);
  assert.equal(a.ifaLastMonth, false);
  assert.equal(a.padsPerDay, undefined);
});

test('mr: "N दिवसांपासून" gives symptom days', () => {
  const a = ex('पाच दिवसांपासून थकवा आणि धाप लागते');
  assert.equal(a.symptomDays, 5);
  assert.equal(a.fatigue, true);
  assert.equal(a.breathless, true);
  assert.equal(a.periodDays, undefined);
});

test('mr: heavy bleeding, flooding, hourly soaking, IFA', () => {
  const a = ex('खूप जास्त रक्तस्राव होतो, कपड्यांवर डाग लागतात, दर तासाला पॅड भिजते. लोहाच्या गोळ्या घेतल्या.');
  assert.equal(a.heavyBleeding, true);
  assert.equal(a.flooding, true);
  assert.equal(a.soakingHourly, true);
  assert.equal(a.ifaLastMonth, true);
  assert.equal(ex('आयर्न गोळी घेतली नाही').ifaLastMonth, false);
  assert.equal(ex('रक्तस्राव जास्त नाही').heavyBleeding, false);
});

test('mr: fainting (romanised) and silence stays undefined', () => {
  assert.equal(ex('kal beshuddh zali hoti').fainting, true);
  const a = ex('पाळी 5 दिवस असते');
  assert.equal(a.periodDays, 5);
  for (const f of ['dizziness', 'fatigue', 'breathless', 'fainting', 'clots', 'flooding', 'soakingHourly', 'heavyBleeding', 'ifaLastMonth', 'pregnant']) {
    assert.equal(a[f], undefined, `${f} must stay undefined when not mentioned`);
  }
});

test('mr: no false positives for दम inside other words', () => {
  // दमलेली = tired (fatigue), not breathless; दमट = humid; कदम = step.
  const a = ex('ती दमलेली असते');
  assert.equal(a.fatigue, true);
  assert.equal(a.breathless, undefined);
  assert.equal(ex('आज हवा दमट आहे').breathless, undefined);
  assert.equal(ex('दोन कदम चालली').breathless, undefined);
});

test('mr: one field stem does not match another field', () => {
  const clots = ex('रक्ताच्या मोठ्या गाठी पडतात');
  assert.equal(clots.clots, true);
  assert.equal(clots.heavyBleeding, undefined);
  assert.equal(clots.fatigue, undefined);
  const tired = ex('थकवा जाणवतो');
  assert.equal(tired.fatigue, true);
  assert.equal(tired.clots, undefined); // Hindi थक्के (clots) must not fire on थकवा
  const pads = ex('3 कापड लागतात');
  assert.equal(pads.padsPerDay, 3);
  assert.equal(pads.flooding, undefined);
});

test('mr identity: प्रिया पाटील and Priya Patil are likely the same person', () => {
  assert.equal(nameKey('प्रिया पाटील'), nameKey('Priya Patil'));
  const m = matchPatients(
    { name: 'प्रिया पाटील', village: 'Wadgaon', birthYear: 2008 },
    { name: 'Priya Patil', village: 'Wadgaon', birthYear: 2008 },
  );
  assert.equal(m.level, 'likely');
});

test('mr identity: different names stay unlikely even with same village and year', () => {
  const m = matchPatients(
    { name: 'सुनीता जाधव', village: 'Wadgaon', birthYear: 2008 },
    { name: 'Priya Patil', village: 'Wadgaon', birthYear: 2008 },
  );
  assert.equal(m.level, 'unlikely');
});

test('mr UI: complete, Marathi script, placeholders intact', () => {
  assert.match(T('newCase', 'mr'), /[ऀ-ॿ]/);
  assert.notEqual(T('newCase', 'mr'), T('newCase', 'en'));
  assert.deepEqual(missing('mr'), []);
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[0]);
  for (const [k, v] of Object.entries(CATALOGUES.en)) {
    for (const p of ph(v)) assert.ok(CATALOGUES.mr[k].includes(p), `${k}: lost ${p}`);
  }
});

// Known limitations in shared lexicons (not fixable from mr.js because all lexicons are merged).
test('mr: "-ताना" (while doing) is not a negation', () => {
  assert.equal(ex('काम करताना चक्कर येते').dizziness, true);
  assert.equal(ex('दगड उचलताना दम लागतो').breathless, true);
});

test('mr: सासूबाई (mother-in-law) is not breathlessness', () => {
  assert.equal(ex('सासूबाई म्हणतात मला चक्कर येते').breathless, undefined);
});
