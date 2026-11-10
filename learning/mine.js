// FEMOS pattern mining: explainable, rule-based statistics. No ML libraries, no fitted weights.
//
// Every finding is a suggestion for HUMAN REVIEW (shadow mode). Nothing here changes a case,
// sends a message or alters a protocol. Thresholds are fixed constants (see THRESHOLDS) chosen
// once, before evaluation, and versioned in learning/registry.json.
//
// No peeking: mineAll(dataset, {asOf}) only uses data that would have been known on `asOf`:
//   - a reading is known from its visit date;
//   - a referral outcome is known on visit date + followupDays if completed, or on
//     visit date + 30 days (the follow-up deadline) if not completed.
//
// Methods (one per level):
//   individual  Per woman, at each of her readings, look at readings within the previous 12 months.
//               (A) TREND: ≥3 readings spanning ≥60 days, Theil–Sen slope ≤ −0.1 g/dL/month, and the
//                   fitted line projects below 8.0 g/dL (WHO severe) within 6 months of the latest reading.
//               (B) DROP:  mean of the latest two readings is ≥1.5 g/dL below the personal maximum of the
//                   earlier readings in the window.
//               Women whose FIRST reading is already severe (<8.0) are not flagged: they are already on the
//               urgent pathway and an "earlier review" flag adds nothing.
//   school /    Monthly anaemia prevalence (WHO cut-off by age: <11.5 g/dL at 10–11 y, <12.0 at 12+ y)
//   village     among readings of the unit's members, vs the unit's OWN baseline (first 9 months, shrunk
//               toward the pooled baseline with a Beta prior worth 20 readings). One-sided upper CUSUM on
//               the monthly binomial z-score: S = max(0, S + z − k), k = 0.5, fire when S ≥ h = 4.
//               Months with < 5 readings are skipped.
//   block       Follow-up completion among referrals, by referral month, vs the block's own baseline
//               (first 9 months, shrunk to pooled). Only COMPLETE referral cohorts are used (month end +
//               30 days ≤ asOf), because partial cohorts over-represent quick completions. One-sided
//               lower CUSUM, k = 0.5, h = 4, min 5 resolved referrals per month.
//   device      OCR rejection rate per device model vs all other models pooled (cumulative to asOf):
//               two-proportion z ≥ 4, rate ratio ≥ 1.5, ≥ 100 photos.
//   process     Referral stall rate (resolved referrals with no follow-up within 30 days) per
//               district × touchpoint vs all other referrals: two-proportion z ≥ 3.5 (≈ Bonferroni over
//               the cells), rate ratio ≥ 1.5, ≥ 40 resolved referrals in the cell.

export const MINER_VERSION = 'femos-mine@0.1.0';

export const THRESHOLDS = Object.freeze({
  individual: { windowDays: 365, minReadings: 3, minSpanDays: 60, maxSlopePerMonth: -0.1, horizonMonths: 6, severe: 8.0, dropGdl: 1.5 },
  prevalence: { baselineMonths: 9, priorWeight: 20, k: 0.5, h: 4, minN: 5 },
  followup: { deadlineDays: 30, baselineMonths: 9, priorWeight: 20, k: 0.5, h: 4, minN: 5 },
  device: { z: 4, ratio: 1.5, minN: 100 },
  process: { z: 3.5, ratio: 1.5, minN: 40 },
});

const DAY = 864e5;
const ms = (d) => Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const monthEnd = (period) => iso(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0));
const addDays = (d, n) => iso(ms(d) + n * DAY);

/** Accepts 'YYYY-MM' (end of that month), 'YYYY-MM-DD', or a full ISO timestamp. */
export function normaliseAsOf(asOf, dataset) {
  if (!asOf) return dataset.visits.reduce((m, v) => (v.date > m ? v.date : m), '0000-00-00');
  const s = String(asOf);
  if (/^\d{4}-\d{2}$/.test(s)) return monthEnd(s);
  return s.slice(0, 10);
}

/** WHO 2024 anaemia cut-off (non-pregnant) by age. */
export const whoCutoff = (age) => (age < 12 ? 11.5 : 12.0);

// ---------- indexing (cached per dataset object) ----------
const cache = new WeakMap();
function index(ds) {
  if (cache.has(ds)) return cache.get(ds);
  const periods = ds.meta?.periods ?? [...new Set(ds.visits.map((v) => v.date.slice(0, 7)))].sort();
  const pIdx = new Map(periods.map((p, i) => [p, i]));
  const women = new Map(ds.women.map((w) => [w.id, w]));
  const start = ms(`${periods[0]}-01`);
  const enriched = ds.visits
    .map((v) => {
      const w = women.get(v.womanId);
      const age = (w?.ageAtStart ?? 20) + Math.floor((ms(v.date) - start) / (365.25 * DAY));
      const resolvedOn = v.referred ? (v.followupDone ? addDays(v.date, v.followupDays ?? 0) : addDays(v.date, THRESHOLDS.followup.deadlineDays)) : null;
      return { ...v, month: v.date.slice(0, 7), mi: pIdx.get(v.date.slice(0, 7)), age, anaemic: v.hb < whoCutoff(age), w, resolvedOn };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byWoman = new Map();
  for (const v of enriched) {
    if (!byWoman.has(v.womanId)) byWoman.set(v.womanId, []);
    byWoman.get(v.womanId).push(v);
  }
  const idx = { periods, pIdx, women, visits: enriched, byWoman };
  cache.set(ds, idx);
  return idx;
}

// ---------- statistics helpers ----------
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Theil–Sen: median of pairwise slopes; intercept = median(y − slope·x). x in months. */
export function theilSen(xs, ys) {
  const slopes = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  const slope = median(slopes) ?? 0;
  const intercept = median(ys.map((y, i) => y - slope * xs[i]));
  return { slope, intercept };
}

/** Two-proportion z-test of a (x1/n1) vs b (x2/n2), pooled SE. */
export function twoPropZ(x1, n1, x2, n2) {
  if (!n1 || !n2) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (x1 / n1 - x2 / n2) / se : 0;
}

/**
 * One-sided CUSUM over monthly binomial counts vs baseline rate p0.
 * direction +1 detects an increase in rate, −1 a decrease.
 */
export function cusum(series, p0, { k, h, minN }, direction = 1) {
  let S = 0;
  let fired = null;
  const trace = [];
  for (const m of series) {
    if (m.n < minN) {
      trace.push({ ...m, z: null, S: r2(S) });
      continue;
    }
    const sd = Math.sqrt(m.n * p0 * (1 - p0)) || 1;
    const z = (direction * (m.x - m.n * p0)) / sd;
    S = Math.max(0, S + z - k);
    if (fired == null && S >= h) fired = m.month;
    trace.push({ ...m, rate: r3(m.x / m.n), z: r2(z), S: r2(S) });
  }
  return { S, fired, active: S >= h, trace };
}

// ---------- individual ----------
function evalWoman(rs, T) {
  // rs: readings of one woman up to some point, oldest first. Evaluate at the latest.
  const last = rs.at(-1);
  const lastMs = ms(last.date);
  const win = rs.filter((v) => lastMs - ms(v.date) <= T.windowDays * DAY);
  if (win.length < T.minReadings) return null;
  const x = win.map((v) => (ms(v.date) - lastMs) / (30.4375 * DAY));
  const y = win.map((v) => v.hb);
  const reasons = [];
  let score = 0;
  const span = (lastMs - ms(win[0].date)) / DAY;
  let trend = null;
  if (span >= T.minSpanDays) {
    const { slope, intercept } = theilSen(x, y);
    const fittedNow = intercept; // x = 0 at the latest reading
    const projected = fittedNow + slope * T.horizonMonths;
    trend = { slopePerMonth: r2(slope), fittedNow: r2(fittedNow), projected6m: r2(projected) };
    if (slope <= T.maxSlopePerMonth && projected < T.severe) {
      const monthsToSevere = fittedNow <= T.severe ? 0 : (T.severe - fittedNow) / slope;
      trend.monthsToSevere = r2(monthsToSevere);
      reasons.push(`trend ${r2(slope)} g/dL/month over ${win.length} readings; projected ${r2(projected)} g/dL in ${T.horizonMonths} months (WHO severe < ${T.severe})`);
      score = Math.max(score, Math.min(1, 1 - monthsToSevere / (T.horizonMonths * 2)));
    }
  }
  const earlier = win.slice(0, -2);
  let drop = null;
  if (earlier.length) {
    const peak = earlier.reduce((m, v) => (v.hb > m.hb ? v : m), earlier[0]);
    const recent = (win.at(-1).hb + win.at(-2).hb) / 2;
    drop = { peak: peak.hb, peakDate: peak.date, recentMean: r2(recent), drop: r2(peak.hb - recent) };
    if (peak.hb - recent >= T.dropGdl) {
      reasons.push(`fell ${r2(peak.hb - recent)} g/dL from personal max ${peak.hb} (${peak.date}) to recent mean ${r2(recent)}`);
      score = Math.max(score, Math.min(1, (peak.hb - recent) / 3));
    }
  }
  if (!reasons.length) return null;
  return { reasons, score: r2(score), trend, drop, readings: win.map((v) => ({ date: v.date, hb: v.hb, touchpoint: v.touchpoint })) };
}

function mineIndividuals(ix, asOf) {
  const T = THRESHOLDS.individual;
  const out = [];
  for (const [wid, all] of ix.byWoman) {
    const rs = all.filter((v) => v.date <= asOf);
    if (rs.length < T.minReadings) continue;
    if (rs[0].hb < T.severe) continue; // already severe at first reading: on the urgent pathway already
    let first = null;
    let current = null;
    for (let i = T.minReadings; i <= rs.length; i++) {
      const res = evalWoman(rs.slice(0, i), T);
      if (res && !first) first = { at: rs[i - 1].date, res };
      if (i === rs.length) current = res;
    }
    if (!first) continue;
    const show = current ?? first.res;
    const w = ix.women.get(wid);
    out.push({
      id: `individual:${wid}`,
      level: 'individual',
      key: wid,
      label: `Review earlier: ${wid} (${w.village}, age ${w.ageAtStart}+)`,
      score: show.score,
      firstFlaggedAt: first.at,
      active: !!current,
      explanation: `${show.reasons.join('; ')}. Suggest an earlier review visit; this is not a diagnosis.`,
      evidence: { woman: { id: wid, village: w.village, block: w.block, district: w.district, school: w.school ?? null, ageAtStart: w.ageAtStart }, trend: show.trend, drop: show.drop, readings: show.readings, firstTrigger: first.res.reasons },
    });
  }
  return out;
}

// ---------- unit prevalence (school / village) ----------
function monthlyCounts(visits, keyFn, valueFn, monthFn, nMonths) {
  const by = new Map();
  for (const v of visits) {
    const k = keyFn(v);
    if (k == null) continue;
    const val = valueFn(v);
    if (val == null) continue;
    if (!by.has(k)) by.set(k, Array.from({ length: nMonths }, () => ({ n: 0, x: 0 })));
    const mi = monthFn(v);
    if (mi == null || mi < 0 || mi >= nMonths) continue;
    const c = by.get(k)[mi];
    c.n++;
    if (val) c.x++;
  }
  return by;
}

function cusumUnits(ix, counts, P, direction, lastMonthIdx, meta) {
  const out = [];
  if (lastMonthIdx < P.baselineMonths) return out; // baseline not yet established
  let pooledN = 0;
  let pooledX = 0;
  for (const arr of counts.values()) for (let i = 0; i < P.baselineMonths; i++) { pooledN += arr[i].n; pooledX += arr[i].x; }
  const pooled = pooledN ? pooledX / pooledN : 0.5;
  for (const [key, arr] of counts) {
    let bn = 0;
    let bx = 0;
    for (let i = 0; i < P.baselineMonths; i++) { bn += arr[i].n; bx += arr[i].x; }
    const p0 = Math.min(0.97, Math.max(0.03, (bx + P.priorWeight * pooled) / (bn + P.priorWeight)));
    const series = [];
    for (let i = P.baselineMonths; i <= lastMonthIdx; i++) series.push({ month: ix.periods[i], n: arr[i].n, x: arr[i].x });
    const c = cusum(series, p0, P, direction);
    if (!c.fired) continue;
    const recent = c.trace.filter((t) => t.n > 0).slice(-3);
    const rn = recent.reduce((s, t) => s + t.n, 0);
    const rx = recent.reduce((s, t) => s + t.x, 0);
    out.push(meta(key, { p0, bn, bx, pooled, fired: c.fired, S: c.S, active: c.active, trace: c.trace, recentRate: rn ? rx / rn : null, recentN: rn }));
  }
  return out;
}

function minePrevalence(ix, visits, asOf, level) {
  const P = THRESHOLDS.prevalence;
  const lastComplete = lastCompleteMonth(ix, asOf);
  const keyFn = level === 'school' ? (v) => v.w?.school ?? null : (v) => v.w?.village ?? null;
  const counts = monthlyCounts(visits, keyFn, (v) => v.anaemic, (v) => v.mi, ix.periods.length);
  return cusumUnits(ix, counts, P, +1, lastComplete, (key, s) => ({
    id: `${level}:${key}`,
    level,
    key,
    label: `Anaemia prevalence rising: ${level} ${key}`,
    score: r2(Math.min(1, s.S / (P.h * 2))),
    firstFlaggedAt: monthEnd(s.fired),
    firstFlaggedMonth: s.fired,
    active: s.active,
    explanation: `Share of readings below the WHO cut-off rose from a baseline of ${Math.round(s.p0 * 100)}% (own first ${P.baselineMonths} months, n=${s.bn}) to ${s.recentRate == null ? '?' : Math.round(s.recentRate * 100)}% in the last 3 months with data (n=${s.recentN}); CUSUM crossed ${P.h} in ${s.fired}. Possible causes include IFA supply gaps, a camp mix change or device issues: check supply and screening records.`,
    evidence: { baselineRate: r3(s.p0), baselineN: s.bn, pooledBaseline: r3(s.pooled), cusum: r2(s.S), threshold: P.h, k: P.k, monthly: s.trace },
  }));
}

/** Index of the last month whose data is complete on asOf (month end ≤ asOf). */
function lastCompleteMonth(ix, asOf) {
  let last = -1;
  ix.periods.forEach((p, i) => { if (monthEnd(p) <= asOf) last = i; });
  return last;
}

// ---------- block follow-up completion ----------
function mineBlocks(ix, visits, asOf) {
  const P = THRESHOLDS.followup;
  // Complete cohorts only: every referral in the month has resolved by asOf.
  let lastCohort = -1;
  ix.periods.forEach((p, i) => { if (addDays(monthEnd(p), P.deadlineDays) <= asOf) lastCohort = i; });
  const refs = visits.filter((v) => v.referred && v.resolvedOn <= asOf);
  const counts = monthlyCounts(refs, (v) => v.w?.block ?? null, (v) => v.followupDone, (v) => v.mi, ix.periods.length);
  // CUSUM detects a DROP in completion (direction −1).
  return cusumUnits(ix, counts, P, -1, lastCohort, (key, s) => ({
    id: `block:${key}`,
    level: 'block',
    key,
    label: `Follow-up completion falling: block ${key}`,
    score: r2(Math.min(1, s.S / (P.h * 2))),
    firstFlaggedAt: addDays(monthEnd(s.fired), P.deadlineDays),
    firstFlaggedMonth: s.fired,
    active: s.active,
    explanation: `Referral follow-up completion fell from a baseline of ${Math.round(s.p0 * 100)}% (own first ${P.baselineMonths} months, n=${s.bn}) to ${s.recentRate == null ? '?' : Math.round(s.recentRate * 100)}% in the last 3 complete cohorts (n=${s.recentN}); CUSUM crossed ${P.h} for the ${s.fired} referral cohort. Check staffing, transport and ASHA workload in this block.`,
    evidence: { baselineRate: r3(s.p0), baselineN: s.bn, pooledBaseline: r3(s.pooled), cusum: r2(s.S), threshold: P.h, k: P.k, cohortRule: `referral month complete when month end + ${P.deadlineDays} days ≤ asOf`, monthly: s.trace },
  }));
}

// ---------- device OCR ----------
function mineDevices(ix, visits, asOf) {
  const P = THRESHOLDS.device;
  const out = [];
  const months = ix.periods.map((p, i) => ({ p, i })).filter(({ p }) => monthEnd(p) <= asOf || p === asOf.slice(0, 7));
  const models = [...new Set(visits.map((v) => v.deviceModel))].sort();
  // Cumulative test at each month end to find the first month it fires.
  for (const model of models) {
    let first = null;
    let last = null;
    for (const { p } of months) {
      const cut = monthEnd(p) <= asOf ? monthEnd(p) : asOf;
      const upTo = visits.filter((v) => v.date <= cut);
      const a = upTo.filter((v) => v.deviceModel === model);
      const b = upTo.filter((v) => v.deviceModel !== model);
      const xa = a.filter((v) => v.ocr === 'rejected').length;
      const xb = b.filter((v) => v.ocr === 'rejected').length;
      const z = twoPropZ(xa, a.length, xb, b.length);
      const ratio = xb && b.length ? xa / a.length / (xb / b.length) : Infinity;
      const fired = a.length >= P.minN && z >= P.z && ratio >= P.ratio;
      last = { month: p, n: a.length, rejected: xa, rate: a.length ? xa / a.length : 0, othersN: b.length, othersRate: b.length ? xb / b.length : 0, z, ratio, fired };
      if (fired && !first) first = { at: cut, month: p };
    }
    if (!first) continue;
    out.push({
      id: `device:${model}`,
      level: 'device',
      key: model,
      label: `OCR rejections high: ${model}`,
      score: r2(Math.min(1, last.z / (P.z * 3))),
      firstFlaggedAt: first.at,
      firstFlaggedMonth: first.month,
      active: last.fired,
      explanation: `${Math.round(last.rate * 100)}% of ${last.n} photos from ${model} were rejected by OCR vs ${Math.round(last.othersRate * 100)}% for other models (z = ${r2(last.z)}, ratio ${r2(last.ratio)}). Check device firmware, screen glare or the OCR template; until resolved, prefer manual double entry for this model.`,
      evidence: { n: last.n, rejected: last.rejected, rate: r3(last.rate), othersN: last.othersN, othersRate: r3(last.othersRate), z: r2(last.z), ratio: r2(last.ratio), thresholds: P },
    });
  }
  return out;
}

// ---------- process: referral stalls by district × touchpoint ----------
function mineProcess(ix, visits, asOf) {
  const P = THRESHOLDS.process;
  const out = [];
  const months = ix.periods.filter((p) => monthEnd(p) <= asOf || p === asOf.slice(0, 7));
  const refsAll = visits.filter((v) => v.referred);
  const cells = [...new Set(refsAll.map((v) => `${v.w.district}|${v.touchpoint}`))].sort();
  const stats = (cut) => {
    const refs = refsAll.filter((v) => v.resolvedOn <= cut);
    const by = new Map();
    let N = 0;
    let X = 0;
    for (const v of refs) {
      const k = `${v.w.district}|${v.touchpoint}`;
      if (!by.has(k)) by.set(k, { n: 0, x: 0 });
      const c = by.get(k);
      c.n++;
      N++;
      if (!v.followupDone) { c.x++; X++; }
    }
    return { by, N, X };
  };
  const firsts = new Map();
  let lastStats = null;
  for (const p of months) {
    const cut = monthEnd(p) <= asOf ? monthEnd(p) : asOf;
    const st = stats(cut);
    lastStats = st;
    for (const k of cells) {
      const c = st.by.get(k) ?? { n: 0, x: 0 };
      const on = st.N - c.n;
      const ox = st.X - c.x;
      const z = twoPropZ(c.x, c.n, ox, on);
      const ratio = ox && on ? c.x / c.n / (ox / on) : Infinity;
      if (!firsts.has(k) && c.n >= P.minN && z >= P.z && ratio >= P.ratio) firsts.set(k, { at: cut, month: p });
    }
  }
  if (!lastStats) return out;
  for (const k of cells) {
    if (!firsts.has(k)) continue;
    const c = lastStats.by.get(k) ?? { n: 0, x: 0 };
    const on = lastStats.N - c.n;
    const ox = lastStats.X - c.x;
    const z = twoPropZ(c.x, c.n, ox, on);
    const ratio = ox && on ? c.x / c.n / (ox / on) : Infinity;
    const [district, touchpoint] = k.split('|');
    const active = c.n >= P.minN && z >= P.z && ratio >= P.ratio;
    out.push({
      id: `process:${k}`,
      level: 'process',
      key: k,
      label: `Referrals stalling: ${touchpoint} referrals in district ${district}`,
      score: r2(Math.min(1, z / (P.z * 3))),
      firstFlaggedAt: firsts.get(k).at,
      firstFlaggedMonth: firsts.get(k).month,
      active,
      explanation: `${Math.round((c.x / c.n) * 100)}% of ${c.n} resolved referrals made at "${touchpoint}" in district ${district} had no follow-up within ${THRESHOLDS.followup.deadlineDays} days, vs ${Math.round((ox / on) * 100)}% for all other referrals (z = ${r2(z)}, ratio ${r2(ratio)}). Check the hand-off from ${touchpoint} teams to ASHAs/clinics in this district.`,
      evidence: { district, touchpoint, n: c.n, stalled: c.x, rate: r3(c.x / c.n), othersN: on, othersRate: r3(ox / on), z: r2(z), ratio: r2(ratio), thresholds: P },
    });
  }
  return out;
}

/**
 * Mine all levels using only data known on asOf.
 * @param dataset  synthetic longitudinal dataset (learning/synth.js shape)
 * @param opts     { asOf?: 'YYYY-MM' | 'YYYY-MM-DD' | ISO string, levels?: string[] }
 * @returns {{asOf: string, miner: string, thresholds: object, findings: object[]}}
 */
export function mineAll(dataset, { asOf, levels } = {}) {
  const ix = index(dataset);
  const at = normaliseAsOf(asOf, dataset);
  const visits = ix.visits.filter((v) => v.date <= at);
  const want = (l) => !levels || levels.includes(l);
  const findings = [
    ...(want('individual') ? mineIndividuals(ix, at) : []),
    ...(want('school') ? minePrevalence(ix, visits, at, 'school') : []),
    ...(want('village') ? minePrevalence(ix, visits, at, 'village') : []),
    ...(want('block') ? mineBlocks(ix, visits, at) : []),
    ...(want('device') ? mineDevices(ix, visits, at) : []),
    ...(want('process') ? mineProcess(ix, visits, at) : []),
  ];
  const lv = { device: 0, process: 1, block: 2, school: 3, village: 4, individual: 5 };
  findings.sort((a, b) => lv[a.level] - lv[b.level] || b.score - a.score || (a.key < b.key ? -1 : 1));
  return { asOf: at, miner: MINER_VERSION, thresholds: THRESHOLDS, status: 'shadow', findings };
}

/**
 * Walk month by month (asOf = each month end) and record when each finding first appears.
 * @param dataset
 * @param opts { levels?: string[] }
 * @returns {{asOf: string, months: string[], findings: (finding & {firstMonth: string})[]}}
 *   Each finding is the version first seen, with `firstMonth` (the walk month it appeared in)
 *   and its own `firstFlaggedAt` (the date the triggering data became available).
 */
export function mineIncremental(dataset, { levels } = {}) {
  const ix = index(dataset);
  const seen = new Map();
  for (const p of ix.periods) {
    const r = mineAll(dataset, { asOf: p, levels });
    for (const f of r.findings) if (!seen.has(f.id)) seen.set(f.id, { ...f, firstMonth: p });
  }
  // Block findings rely on complete cohorts (30-day lag), so also walk past the last month.
  const tail = addDays(monthEnd(ix.periods.at(-1)), THRESHOLDS.followup.deadlineDays);
  const r = mineAll(dataset, { asOf: tail, levels });
  for (const f of r.findings) if (!seen.has(f.id)) seen.set(f.id, { ...f, firstMonth: tail.slice(0, 7) });
  return { asOf: tail, months: ix.periods, findings: [...seen.values()] };
}
