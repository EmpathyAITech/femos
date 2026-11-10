// Protocol pack evaluation. Clinical/operational logic lives in versioned, cited JSON packs;
// this file only interprets them. No thresholds are hard-coded here.

export const t = (obj, lang = 'en') => (obj && typeof obj === 'object' ? obj[lang] ?? obj.en ?? '' : obj ?? '');

export function source(pack, id) {
  return pack.sources.find((s) => s.id === id) ?? { id, title: id };
}

export function cite(pack, id) {
  const s = source(pack, id);
  return { sourceId: s.id, title: s.title, url: s.url ?? null, packId: pack.id, packVersion: pack.version };
}

/** Convert a value in `unit` to the pack's canonical unit. Returns null for unknown units. */
export function toCanonical(pack, kind, value, unit) {
  const m = pack.measurements[kind];
  const f = m?.acceptedUnits?.[unit];
  if (f == null || typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(value * f * 10 ** m.decimals) / 10 ** m.decimals;
}

/** WHO-band classification for haemoglobin, by age. Returns {cls, band, source} or null. */
export function classifyHb(pack, gdl, ageYears) {
  const c = pack.measurements.hb.classification;
  const band = c.bands.find((b) => ageYears >= b.ageYears[0] && ageYears <= b.ageYears[1]);
  if (!band || typeof gdl !== 'number') return null;
  const cls = gdl < band.severe ? 'severe' : gdl < band.moderate ? 'moderate' : gdl < band.mild ? 'mild' : 'none';
  return { cls, band, source: cite(pack, c.source) };
}

function test(cond, answers, ctx) {
  if (cond.all) return cond.all.every((c) => test(c, answers, ctx));
  if (cond.any) return cond.any.some((c) => test(c, answers, ctx));
  if (cond.hbClass) return ctx.hbClass === cond.hbClass;
  const v = answers?.[cond.field];
  if (v === undefined || v === null || v === '') return false;
  if ('equals' in cond) return v === cond.equals;
  if ('gt' in cond) return Number(v) > cond.gt;
  if ('gte' in cond) return Number(v) >= cond.gte;
  if ('lt' in cond) return Number(v) < cond.lt;
  return false;
}

/** Return the matching items of a rule's `any` list. */
export function matches(rule, answers, ctx = {}) {
  return (rule?.any ?? []).filter((c) => test(c, answers, ctx));
}

export function inScope(pack, answers) {
  const out = [];
  const age = Number(answers?.ageYears);
  const { min, max } = pack.scope.ageYears;
  if (Number.isFinite(age) && (age < min || age > max)) out.push({ reason: 'age', min, max, age });
  for (const ex of pack.scope.excludes ?? []) if (answers?.[ex.field] === ex.equals) out.push({ reason: ex.field, route: ex.route, message: ex.message });
  return out;
}

export function missingRequired(pack, answers) {
  return pack.questionnaire.items.filter((i) => i.required && (answers?.[i.linkId] === undefined || answers?.[i.linkId] === null || answers?.[i.linkId] === ''));
}

export function outOfRange(pack, answers) {
  return pack.questionnaire.items.filter((i) => {
    const v = answers?.[i.linkId];
    if (v === undefined || v === null || v === '' || i.type !== 'integer') return false;
    const n = Number(v);
    return !Number.isInteger(n) || (i.min != null && n < i.min) || (i.max != null && n > i.max);
  });
}

export function evaluateContradictions(pack, answers) {
  const hmb = matches(pack.rules.hmbIndicators, answers);
  return pack.rules.contradictions.list.filter((c) => {
    if (!test(c.when, answers, {})) return false;
    if (c.andAnyHmbIndicator) return hmb.length > 0;
    if (c.and) return test(c.and, answers, {});
    return true;
  });
}

export function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}
