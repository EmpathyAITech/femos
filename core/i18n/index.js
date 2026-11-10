// FEMOS languages. Adding a language = add a catalogue here, a protocol-pack overlay
// (protocols/<pack>/i18n/<code>.json), an intake lexicon (core/i18n/intake/<code>.js) and website
// strings (site/assets/i18n/<code>.js). Missing keys fall back to English, never to blank.
import en from './en.js';
import hi from './hi.js';
import bn from './bn.js';
import mr from './mr.js';
import ta from './ta.js';

export const LANGS = [
  { code: 'en', native: 'English', english: 'English', locale: 'en-IN', script: 'Latn', short: 'EN' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', locale: 'hi-IN', script: 'Deva', short: 'हिं' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', locale: 'bn-IN', script: 'Beng', short: 'বাং' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', locale: 'mr-IN', script: 'Deva', short: 'मरा' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', locale: 'ta-IN', script: 'Taml', short: 'தமி' },
];
export const CODES = LANGS.map((l) => l.code);
export const CATALOGUES = { en, hi, bn, mr, ta };
export const langInfo = (code) => LANGS.find((l) => l.code === code) ?? LANGS[0];

export function fmt(s, vars) {
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

/** Translate one key into one language (English fallback, then the key itself). */
export function T(key, lang = 'en', vars) {
  const s = CATALOGUES[lang]?.[key] ?? CATALOGUES.en[key] ?? key;
  return fmt(s, typeof vars === 'function' ? vars(lang) : vars);
}

/**
 * The key in every language, as {en, hi, bn, mr, ta}. Used for anything stored in the case log
 * (flags, summaries) so any reader sees it in their own language later, even offline.
 * `vars` may be a function of the language (for lists of localised labels).
 */
export function all(key, vars) {
  return Object.fromEntries(CODES.map((c) => [c, T(key, c, vars)]));
}

/** Pick a language from a multilingual entry {en, hi, …}. */
export const tr = (entry, lang) => (entry && typeof entry === 'object' ? entry[lang] ?? entry.en ?? '' : entry ?? '');

/** Which keys a language is missing (for the completeness test and translators). */
export const missing = (lang) => Object.keys(en).filter((k) => !(k in (CATALOGUES[lang] ?? {})));
