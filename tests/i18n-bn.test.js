// Bengali (bn): intake extraction, cross-script identity, and catalogue integrity.
// Utterances are written the way health workers type: Bengali script, romanised Bengali, and
// code-mixed with English. Silence must stay undefined; only an explicit negation gives false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHistory } from '../core/agents/intake.js';
import { nameKey, matchPatients } from '../core/identity.js';
import { T, CATALOGUES } from '../core/i18n/index.js';

const ans = (t) => extractHistory(t).answers;

test('bn script: age, period days, pads with classifier, dizziness; silence stays undefined', () => {
  const a = ans('বয়স ১৬ বছর। মাসিক ৯ দিন চলে, ৭টা প্যাড লাগে, মাথা ঘোরে');
  assert.equal(a.ageYears, 16);
  assert.equal(a.periodDays, 9);
  assert.equal(a.padsPerDay, 7);
  assert.equal(a.dizziness, true);
  for (const f of ['fatigue', 'fainting', 'breathless', 'clots', 'pregnant', 'ifaLastMonth']) assert.equal(a[f], undefined, f);
  assert.equal(extractHistory('বয়স ১৬ বছর').language, 'bn');
});

test('bn script: কিন্তু splits polarity (dizziness negated, weakness affirmed)', () => {
  const a = ans('মাথা ঘোরে না কিন্তু খুব দুর্বল লাগে');
  assert.equal(a.dizziness, false);
  assert.equal(a.fatigue, true);
});

test('bn script: pregnancy denied, IFA not taken (খাইনি), breathless for 5 days', () => {
  const a = ans('গর্ভবতী নয়। আয়রন ট্যাবলেট খাইনি। ৫ দিন ধরে শ্বাসকষ্ট');
  assert.equal(a.pregnant, 'no');
  assert.equal(a.ifaLastMonth, false);
  assert.equal(a.symptomDays, 5);
  assert.equal(a.breathless, true);
});

test('bn script: clots, flooding, hourly soaking; "বদলাতে" does not read as a clot', () => {
  const a = ans('চাকা চাকা রক্ত পড়ে, কাপড়ে দাগ লেগে যায়, প্রতি ঘণ্টায় প্যাড বদলাতে হয়');
  assert.equal(a.clots, true);
  assert.equal(a.flooding, true);
  assert.equal(a.soakingHourly, true);
  assert.equal(ans('প্রতি ঘণ্টায় প্যাড বদলাতে হয়').clots, undefined);
});

test('bn script: joined negation (ঘোরেনা), দুটো classifier, period 10 days', () => {
  const a = ans('দুটো প্যাড, মাথা ঘোরেনা');
  assert.equal(a.padsPerDay, 2);
  assert.equal(a.dizziness, false);
  const b = ans('বয়স ১৭, পিরিয়ড ১০ দিন থাকে');
  assert.equal(b.ageYears, 17);
  assert.equal(b.periodDays, 10);
});

test('bn script: fainting denied with কখনো…হয়নি; "fell from dizziness" is fainting, not dizziness', () => {
  const a = ans('কখনো অজ্ঞান হয়নি, মাথা ঘুরে পড়ে যায়নি');
  assert.equal(a.fainting, false);
  assert.equal(a.dizziness, undefined);
  const b = ans('matha ghure pore gechhilo');
  assert.equal(b.fainting, true);
  assert.equal(b.dizziness, undefined);
});

test('bn: no false positives from common words (অনেক দিন, বিশ্বাস, unrelated talk)', () => {
  const a = ans('অনেক দিন ধরে ক্লান্ত লাগে');
  assert.equal(a.fatigue, true);
  assert.equal(a.symptomDays, undefined, '"অনেক" must not be read as এক = 1');
  assert.deepEqual(ans('বিশ্বাস করি, ভালো আছে'), {});
  assert.deepEqual(ans('সে স্কুলে পড়ে, গ্রামে থাকে'), {});
});

test('romanised bn: heavy bleeding negated with "na"; rokto beshi noy', () => {
  assert.equal(ans('Mashik er somoy beshi rokto jay na').heavyBleeding, false);
  assert.equal(ans('রক্তপাত বেশি নয়').heavyBleeding, false);
  assert.equal(ans('onek rokto jay').heavyBleeding, true);
});

test('code-mixed: "3 din dhore breathless … kintu fainting nei"', () => {
  const a = ans('Patient er 3 din dhore breathless, shwas kosto hoy, kintu fainting nei');
  assert.equal(a.symptomDays, 3);
  assert.equal(a.breathless, true);
  assert.equal(a.fainting, false);
  assert.equal(a.dizziness, undefined);
});

test('code-mixed: iron tablet khaini, 2 din dhore matha ghurche; pet e baccha → pregnant', () => {
  const a = ans('HB 7, iron tablet khaini, 2 din dhore matha ghurche');
  assert.equal(a.ifaLastMonth, false);
  assert.equal(a.symptomDays, 2);
  assert.equal(a.dizziness, true);
  assert.equal(ans('Pet e baccha ache, 2 mash').pregnant, 'yes');
  assert.equal(ans('লাল বড়ি খেয়েছে গত মাসে').ifaLastMonth, true);
});

test('romanised bn: age, period, pads with "ta" classifier', () => {
  const a = ans('Boyos 19 bochor, masik 8 din, din e 6 ta pad lage, matha ghore, onek rokto jay');
  assert.equal(a.ageYears, 19);
  assert.equal(a.periodDays, 8);
  assert.equal(a.padsPerDay, 6);
  assert.equal(a.dizziness, true);
  assert.equal(a.heavyBleeding, true);
  assert.equal(a.clots, undefined);
});

test('romanised bn: "8 din thake" (lasts 8 days) must not set clots',
  () => {
    assert.equal(ans('masik 8 din thake').clots, undefined);
  });

test('identity: প্রিয়া কুমারী and Priya Kumari, same village and birth year → likely', () => {
  assert.equal(nameKey('প্রিয়া কুমারী').split(' ')[1], nameKey('Priya Kumari').split(' ')[1]);
  const m = matchPatients(
    { name: 'প্রিয়া কুমারী', village: 'Bolpur', birthYear: 2008 },
    { name: 'Priya Kumari', village: 'Bolpur', birthYear: 2008 },
  );
  assert.equal(m.level, 'likely');
});

test('identity: different women in the same village and year are not linked; রুমা দাস = Ruma Das', () => {
  const m = matchPatients(
    { name: 'প্রিয়া কুমারী', village: 'Bolpur', birthYear: 2008 },
    { name: 'Sunita Das', village: 'Bolpur', birthYear: 2008 },
  );
  assert.equal(m.level, 'unlikely');
  assert.equal(nameKey('রুমা দাস'), nameKey('Ruma Das'));
});

test('catalogue: T("newCase","bn") is Bengali, and every placeholder survives', () => {
  const s = T('newCase', 'bn');
  assert.match(s, /[ঀ-৿]/);
  assert.notEqual(s, T('newCase', 'en'));
  const { en, bn } = CATALOGUES;
  for (const [k, v] of Object.entries(en)) {
    assert.ok(k in bn, `missing ${k}`);
    for (const p of v.match(/\{\w+\}/g) ?? []) assert.ok(bn[k].includes(p), `${k} lost ${p}`);
  }
});

test('bn: নয় = "nine" before a unit is a quantity, not a negation', () => {
  const r = extractHistory('নয় দিন ধরে মাথা ঘোরে');
  assert.equal(r.answers.symptomDays, 9);
  assert.equal(r.answers.dizziness, true);
  assert.equal(extractHistory('মাথা ঘোরা নয়').answers.dizziness, false);
});

test('bn: এক (one) is a whole word, never inside অনেক (many)', () => {
  assert.equal(extractHistory('এক দিন ধরে মাথা ঘোরে').answers.symptomDays, 1);
  assert.equal(extractHistory('অনেক দিন ধরে মাথা ঘোরে').answers.symptomDays, undefined);
});
