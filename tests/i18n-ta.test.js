// Tamil (ta) localisation tests: intake extraction (Tamil script, Tanglish, code-mixed),
// cross-script identity, and catalogue completeness. Machine-assisted draft, pending review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHistory } from '../core/agents/intake.js';
import { nameKey, matchPatients } from '../core/identity.js';
import { T, missing } from '../core/i18n/index.js';
import en from '../core/i18n/en.js';
import ta from '../core/i18n/ta.js';

const ex = (s) => extractHistory(s).answers;

test('ta intake: Tamil script, numbers, units, negation per clause', () => {
  const a = ex('எனக்கு 25 வயசு. மாதவிடாய் 9 நாள் வரும், ஒரு நாளைக்கு 7 பேட் மாத்துவேன். தலை சுத்துது, ஆனால் மயக்கம் இல்லை.');
  assert.equal(a.ageYears, 25);
  assert.equal(a.periodDays, 9); // "ஒரு நாளைக்கு" (per day) must not become a 1-day duration
  assert.equal(a.padsPerDay, 7);
  assert.equal(a.dizziness, true);
  assert.equal(a.fainting, false);
  assert.equal(a.breathless, undefined); // silence is never "no"
  assert.equal(extractHistory('தலை சுத்துது').language, 'ta');
});

test('ta intake: suffix "since" form, clots, fatigue', () => {
  const a = ex('வயது 17. பீரியட்ஸ் 8 நாட்கள். ரத்தக் கட்டிகள் வருது. 10 நாட்களாக சோர்வா இருக்கு.');
  assert.equal(a.ageYears, 17);
  assert.equal(a.periodDays, 8);
  assert.equal(a.symptomDays, 10);
  assert.equal(a.clots, true);
  assert.equal(a.fatigue, true);
  assert.equal(a.dizziness, undefined);
});

test('ta intake: explicit negation is false; "cannot breathe" (முடியல) is not a negation', () => {
  const a = ex('தலைசுற்றல் இல்லை. மூச்சு விட முடியல. கர்ப்பம் இல்லை.');
  assert.equal(a.dizziness, false);
  assert.equal(a.breathless, true);
  assert.equal(a.pregnant, 'no');
  assert.equal(a.fatigue, undefined);
});

test('ta intake: -வில்லை / colloquial negatives, and "தெம்பே இல்லை" means fatigue', () => {
  const a = ex('மயங்கி விழுந்தேன். இரும்புச்சத்து மாத்திரை சாப்பிடல. தெம்பே இல்லை.');
  assert.equal(a.fainting, true);
  assert.equal(a.ifaLastMonth, false);
  assert.equal(a.fatigue, true);
  const b = ex('தலைசுற்றல் வரவில்லை, கட்டிகள் கிடையாது');
  assert.equal(b.dizziness, false);
  assert.equal(b.clots, false);
});

test('ta intake: Tamil digits, glued number+unit, மயக்கமா = dizziness (not fainting)', () => {
  const a = ex('மயக்கமா இருக்கு, துணியில் கறை படுது, ௨௧ வயது');
  assert.equal(a.ageYears, 21);
  assert.equal(a.dizziness, true);
  assert.equal(a.fainting, undefined);
  assert.equal(a.flooding, true);
  const b = ex('10நாட்களாக தலைசுற்றல்');
  assert.equal(b.symptomDays, 10);
  assert.equal(b.dizziness, true);
});

test('ta intake: Tamil number words and heavy bleeding', () => {
  const a = ex('பத்து நாளா மூச்சு வாங்குது, நிறைய ரத்தம் போகுது, மூன்று பேட்');
  assert.equal(a.symptomDays, 10);
  assert.equal(a.breathless, true);
  assert.equal(a.heavyBleeding, true);
  assert.equal(a.padsPerDay, 3);
});

test('ta intake: romanised Tamil (Tanglish)', () => {
  const a = ex('enakku 19 vayasu, periods 10 naal varum, romba ratham, thalai suthudhu aanaa mayakkam illa');
  assert.equal(a.ageYears, 19);
  assert.equal(a.periodDays, 10);
  assert.equal(a.heavyBleeding, true);
  assert.equal(a.dizziness, true);
  assert.equal(a.fainting, false);
  const b = ex('naan karbama illa, moonu pad podren');
  assert.equal(b.pregnant, 'no');
  assert.equal(b.padsPerDay, 3);
});

test('ta intake: code-mixed Tamil and English', () => {
  const a = ex('Periods heavy-aa irukku, ovvoru mani nerathukkum pad maathanum, 5 naalaa sorvu');
  assert.equal(a.heavyBleeding, true);
  assert.equal(a.soakingHourly, true);
  assert.equal(a.symptomDays, 5);
  assert.equal(a.fatigue, true);
  const b = ex('Age 22, periods 7 days, iron mathirai saapdala, dizziness illa but very tired');
  assert.equal(b.ageYears, 22);
  assert.equal(b.periodDays, 7);
  assert.equal(b.ifaLastMonth, false);
  assert.equal(b.dizziness, false);
  assert.equal(b.fatigue, true);
  assert.equal(b.fainting, undefined);
});

test('ta intake: the input-box example text parses', () => {
  const a = ex(T('f.e_g_umar_16_saal_mahwari', 'ta'));
  assert.equal(a.ageYears, 16);
  assert.equal(a.periodDays, 9);
  assert.equal(a.padsPerDay, 7);
  assert.equal(a.dizziness, true);
});

test('ta identity: Tamil transliteration meets the Latin spelling', () => {
  assert.ok(nameKey('பிரியா').length > 0);
  assert.match(nameKey('பிரியா'), /^[a-z ]+$/);
  assert.equal(nameKey('பிரியா'), nameKey('Priya'));
  assert.equal(nameKey('லக்ஷ்மி'), nameKey('Lakshmi'));
});

test('ta identity: மீனா / Meena, same village and birth year, is likely', () => {
  const m = matchPatients({ name: 'மீனா', village: 'மேலூர்', birthYear: 2006 }, { name: 'Meena', village: 'Melur', birthYear: 2006 });
  assert.equal(m.level, 'likely');
});

test('ta catalogue: complete, Tamil, placeholders preserved', () => {
  assert.equal(missing('ta').length, 0);
  assert.match(T('newCase', 'ta'), /[஀-௿]/);
  assert.notEqual(T('newCase', 'ta'), T('newCase', 'en'));
  for (const [k, v] of Object.entries(en)) {
    for (const ph of v.match(/\{\w+\}/g) ?? []) assert.ok(ta[k].includes(ph), `${k} lost ${ph}`);
  }
});
