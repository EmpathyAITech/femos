// Every language is complete and safe: all keys present, placeholders intact, protocol pack and
// website covered, and patient messages never name the condition in any language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { CATALOGUES, LANGS, missing, T } from '../core/i18n/index.js';

const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const codes = LANGS.map((l) => l.code).filter((c) => c !== 'en');

for (const c of codes) {
  test(`${c}: UI catalogue complete, placeholders intact, nothing left in English by accident`, () => {
    assert.deepEqual(missing(c), [], `${c} missing keys`);
    const en = CATALOGUES.en, cat = CATALOGUES[c];
    const bad = Object.keys(en).filter((k) => ph(en[k]) !== ph(cat[k]));
    assert.deepEqual(bad, [], `${c} placeholder mismatch`);
    // Allow identical text only where it is a code/acronym (e.g. "FEMOS", "Hb").
    const same = Object.keys(en).filter((k) => cat[k] === en[k] && /[a-z]{4,}/.test(en[k]) && !/^[A-Z0-9 .:/·-]+$/.test(en[k]));
    assert.ok(same.length <= 8, `${c}: ${same.length} strings identical to English: ${same.slice(0, 10).join(', ')}`);
  });

  test(`${c}: protocol pack translated`, () => {
    const pack = JSON.parse(readFileSync(new URL('../protocols/anemia-hmb/pack.json', import.meta.url)));
    const items = pack.questionnaire.items.filter((i) => !i.text[c]);
    assert.deepEqual(items.map((i) => i.linkId), [], `${c}: questionnaire items without translation (run node scripts/i18n-pack.js)`);
    for (const [id, tpl] of Object.entries(pack.messages.templates)) {
      assert.ok(tpl[c], `${c}: message template ${id}`);
      for (const v of ['{name}', '{facility}', '{date}', '{caseRef}', '{village}'].filter((p) => tpl.en.includes(p))) assert.ok(tpl[c].includes(v), `${c}: ${id} lost ${v}`);
    }
  });

  test(`${c}: website strings complete`, () => {
    const src = JSON.parse(readFileSync(new URL('../site/assets/i18n/en.json', import.meta.url)));
    const file = new URL(`../site/assets/i18n/${c}.js`, import.meta.url);
    assert.ok(existsSync(file));
    const ctx = { window: {} };
    vm.runInNewContext(readFileSync(file, 'utf8'), ctx);
    const dict = ctx.window.FEMOS_SITE_I18N[c];
    const miss = Object.keys(src).filter((k) => !dict[k]);
    assert.deepEqual(miss, [], `${c}: website keys missing`);
    // Same HTML tags in source and translation.
    const tags = (h) => (h.match(/<\/?[a-z]+/g) ?? []).sort().join();
    const tagBad = Object.keys(src).filter((k) => tags(src[k]) !== tags(dict[k]));
    assert.deepEqual(tagBad, [], `${c}: HTML tags changed`);
  });
}

test('patient reminder templates never name the condition in any language', () => {
  const pack = JSON.parse(readFileSync(new URL('../protocols/anemia-hmb/pack.json', import.meta.url)));
  const banned = /an(a)?emi|haemoglobin|hemoglobin|\bhb\b|bleed|period|menstru|एनीमिया|खून|हीमोग्लोबिन|रक्त|माहवारी|पाळी|রক্ত|মাসিক|অ্যানিমিয়া|ரத்த|இரத்த|மாதவிடாய்|ரத்தசோகை/i;
  for (const [, tpl] of Object.entries(pack.messages.templates)) for (const [lang, text] of Object.entries(tpl)) assert.ok(!banned.test(text), `${lang}: "${text}"`);
});

test('every language renders a UI string in its own script', () => {
  const script = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, ta: /[஀-௿]/ };
  for (const c of codes) assert.match(T('newCase', c), script[c], c);
});
