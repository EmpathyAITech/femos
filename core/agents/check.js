// Check agent: finds errors, gaps and protocol signals. Output is flags with evidence and a
// citation. Flags never change state; `blocking` flags must be fixed before review submission.
import { classifyHb, toCanonical, matches, missingRequired, outOfRange, evaluateContradictions, inScope, cite, t } from '../protocol.js';
import { findDuplicates } from '../identity.js';
import { all as M, T } from '../i18n/index.js';

const F = (code, severity, message, evidence = [], rule = null, extra = {}) => ({ code, severity, message, evidence, rule, blocking: severity === 'error', ...extra });

/** Verified readings in canonical units, oldest first. */
export function verifiedHb(pack, state) {
  return Object.values(state.readings)
    .filter((r) => r.kind === 'hb' && r.status === 'verified')
    .map((r) => ({ ...r, gdl: toCanonical(pack, 'hb', r.value, r.unit), at: r.measuredAt ?? r.capturedAt }))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

/**
 * @param state  case state from reduce()
 * @param ctx { pack, priorReadings?: {gdl, at, caseId, eventId}[], others?: {caseId, patient}[],
 *              otherImageHashes?: Map<hash, caseId>, now?: string }
 */
export function runChecks(state, ctx) {
  const { pack } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const flags = [];
  const a = state.history?.answers ?? {};
  const hbm = pack.measurements.hb;
  const ops = cite(pack, 'femos-ops');

  // ---- readings ----
  for (const r of Object.values(state.readings)) {
    if (r.kind !== 'hb') continue;
    if (r.status === 'unverified') {
      flags.push(F('READING_UNVERIFIED', 'warn', M('check.READING_UNVERIFIED'), [r.eventId]));
      continue;
    }
    if (r.status !== 'verified') continue;
    const ev = [r.eventId, r.verifyEventId].filter(Boolean);
    const gdl = toCanonical(pack, 'hb', r.value, r.unit);
    if (gdl == null) {
      flags.push(F('UNIT_UNKNOWN', 'error', M('check.UNIT_UNKNOWN', { unit: r.unit ?? '—' }), ev));
      continue;
    }
    if (r.unit === 'g/dL' && r.value >= 25 && r.value <= 200) {
      flags.push(F('HB_UNIT_SUSPECT', 'error', M('check.HB_UNIT_SUSPECT_gdl', { value: r.value, alt: (r.value / 10).toFixed(1) }), ev, ops));
    } else if (r.unit === 'g/L' && r.value < 25) {
      flags.push(F('HB_UNIT_SUSPECT', 'error', M('check.HB_UNIT_SUSPECT_gl', { value: r.value }), ev, ops));
    } else if (gdl < hbm.plausible.min || gdl > hbm.plausible.max) {
      flags.push(F('HB_IMPLAUSIBLE', 'error', M('check.HB_IMPLAUSIBLE', { value: gdl, min: hbm.plausible.min, max: hbm.plausible.max }), ev, ops));
    }
    if (r.correctedFrom != null && r.correctedFrom !== 0) {
      // Compare in one unit: 114 g/L → 11.4 g/dL is a legitimate unit correction, not a slip.
      const f = pack.measurements.hb.acceptedUnits;
      const before = r.correctedFrom * (f[r.correctedFromUnit ?? r.unit] ?? NaN);
      const after = r.value * (f[r.unit] ?? NaN);
      const ratio = Number.isFinite(before) && before ? after / before : r.value / r.correctedFrom; // unrounded
      if (Math.abs(ratio - 10) < 0.01 || Math.abs(ratio - 0.1) < 0.001) {
        flags.push(F('HB_DECIMAL_CORRECTION', 'warn', M('check.HB_DECIMAL_CORRECTION', { from: r.correctedFrom, to: r.value }), ev));
      }
    }
    if (r.measuredAt && r.capturedAt) {
      const h = (Date.parse(r.capturedAt) - Date.parse(r.measuredAt)) / 36e5;
      if (h > pack.rules.readingFreshnessHours) flags.push(F('READING_STALE', 'warn', M('check.READING_STALE_behind', { h: Math.round(h) }), ev, ops));
      else if (-h > pack.rules.readingFreshnessHours) flags.push(F('READING_STALE', 'warn', M('check.READING_STALE_ahead', { h: Math.round(-h) }), ev, ops));
    }
    if (r.imageHash && ctx.otherImageHashes?.has(r.imageHash) && ctx.otherImageHashes.get(r.imageHash) !== state.caseId) {
      flags.push(F('READING_REUSED', 'error', M('check.READING_REUSED'), ev, ops, { otherCaseId: ctx.otherImageHashes.get(r.imageHash) }));
    }
  }

  // ---- history ----
  if (state.history) {
    const ev = [state.history.eventId];
    const miss = missingRequired(pack, a);
    if (miss.length) flags.push(F('HISTORY_MISSING', 'warn', M('check.HISTORY_MISSING', (lng) => ({ fields: miss.map((i) => t(i.text, lng)).join('; ') })), ev, null, { fields: miss.map((i) => i.linkId), blocking: true }));
    for (const i of outOfRange(pack, a)) flags.push(F('HISTORY_OUT_OF_RANGE', 'error', M('check.HISTORY_OUT_OF_RANGE', (lng) => ({ field: t(i.text, lng), value: a[i.linkId], min: i.min, max: i.max })), ev, null, { fields: [i.linkId] }));
    for (const c of evaluateContradictions(pack, a)) flags.push(F('HISTORY_CONTRADICTION', 'warn', c.label, ev, cite(pack, pack.rules.contradictions.source), { contradiction: c.id }));
    for (const s of inScope(pack, a)) {
      if (s.reason === 'age') flags.push(F('OUT_OF_SCOPE_AGE', 'warn', M('check.OUT_OF_SCOPE_AGE', { age: s.age, min: s.min, max: s.max }), ev));
      else flags.push(F('OUT_OF_SCOPE', 'urgent', s.message, ev, null, { route: s.route }));
    }
    const by = state.patient?.birthYear;
    if (by && a.ageYears != null) {
      const est = new Date(now).getUTCFullYear() - by;
      if (Math.abs(est - Number(a.ageYears)) > 1) flags.push(F('AGE_MISMATCH', 'warn', M('check.AGE_MISMATCH', { age: a.ageYears, year: by, est }), ev));
    }
  }

  // ---- clinical signals (from cited pack rules; for clinician review, not diagnosis) ----
  const hbs = verifiedHb(pack, state).filter((r) => r.gdl != null);
  const latest = hbs.at(-1);
  const age = Number(a.ageYears);
  let hbClass = null;
  if (latest && Number.isFinite(age)) {
    const c = classifyHb(pack, latest.gdl, age);
    if (c) {
      hbClass = c.cls;
      if (c.cls !== 'none') flags.push(F('HB_BAND', c.cls === 'severe' ? 'urgent' : 'info', M('check.HB_BAND', (lng) => ({ value: latest.gdl, band: T(`band.${c.cls}`, lng), age })), [latest.eventId], c.source, { hbClass: c.cls }));
    }
  }
  if (state.history) {
    const hmb = matches(pack.rules.hmbIndicators, a);
    if (hmb.length) flags.push(F('HMB_INDICATORS', 'info', M('check.HMB_INDICATORS', (lng) => ({ list: hmb.map((h) => t(h.label, lng)).join('; ') })), [state.history.eventId], cite(pack, pack.rules.hmbIndicators.source)));
    const danger = matches(pack.rules.dangerSigns, a, { hbClass });
    if (danger.length) flags.push(F('DANGER_SIGNS', 'urgent', M('check.DANGER_SIGNS', (lng) => ({ list: danger.map((d) => t(d.label, lng)).join('; ') })), [state.history.eventId, latest?.eventId].filter(Boolean), cite(pack, pack.rules.dangerSigns.source)));
  }

  // ---- longitudinal trend across this and earlier cases ----
  const tr = pack.rules.trend;
  const series = [...(ctx.priorReadings ?? []), ...hbs.map((r) => ({ gdl: r.gdl, at: r.at, caseId: state.caseId, eventId: r.eventId }))]
    .filter((r) => r.gdl != null && Date.parse(now) - Date.parse(r.at) <= tr.windowDays * 864e5)
    .sort((x, y) => (x.at < y.at ? -1 : 1));
  if (series.length >= tr.minReadings) {
    const peak = series.slice(0, -1).reduce((m, r) => (r.gdl > m.gdl ? r : m), series[0]);
    const last = series.at(-1);
    const drop = Math.round((peak.gdl - last.gdl) * 10) / 10;
    if (drop >= tr.dropGdl) flags.push(F('HB_FALLING', 'warn', M('check.HB_FALLING', { drop, from: peak.gdl, to: last.gdl, days: tr.windowDays }), series.map((s) => s.eventId), cite(pack, tr.source), { series }));
  }

  // ---- identity & consent ----
  if (state.patient && ctx.others?.length) {
    const dups = findDuplicates(state.patient, ctx.others.filter((o) => o.caseId !== state.caseId && !state.links.some((l) => l.otherCaseId === o.caseId)));
    for (const d of dups.slice(0, 3)) flags.push(F('DUPLICATE_SUSPECT', 'warn', M('check.DUPLICATE_SUSPECT', { name: d.patient.name, village: d.patient.village ?? '?', reasons: d.reasons.join('; ') }), [], null, { otherCaseId: d.caseId, score: d.score, level: d.level }));
  }
  if (Number.isFinite(age) && age < 18 && state.consent.by !== 'guardian') {
    flags.push(F('CONSENT_GUARDIAN', 'warn', M('check.CONSENT_GUARDIAN'), [], cite(pack, 'dpdp-2023'), { blocking: true }));
  }
  if (!state.consent.care) flags.push(F('CONSENT_MISSING', 'error', M('check.CONSENT_MISSING'), []));

  const rank = { urgent: 0, error: 1, warn: 2, info: 3 };
  return flags.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/** Queue priority for the clinician console (higher first). */
export function priority(flags) {
  let p = 0;
  for (const f of flags) {
    if (f.severity === 'urgent') p += 100;
    if (f.code === 'HB_BAND') p += { severe: 50, moderate: 20, mild: 5 }[f.hbClass] ?? 0;
    if (f.code === 'HB_FALLING') p += 15;
    if (f.code === 'HMB_INDICATORS') p += 10;
  }
  return p;
}
