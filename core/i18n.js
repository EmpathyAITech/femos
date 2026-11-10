// Compatibility layer over core/i18n/index.js: dictionaries of multilingual entries
// ({en, hi, bn, mr, ta}) built from the catalogues. New code should call T(key, lang).
import { all, tr, T, LANGS, langInfo, CATALOGUES } from './i18n/index.js';

const group = (prefix) =>
  Object.fromEntries(Object.keys(CATALOGUES.en).filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), all(k)]));

export const S = Object.fromEntries(Object.keys(CATALOGUES.en).filter((k) => !k.includes('.')).map((k) => [k, all(k)]));
export const ROLE_LABEL = group('role.');
export const EVENT_LABEL = group('event.');
export const ACTION_LABEL = group('action.');
export { tr, T, LANGS, langInfo, all };
