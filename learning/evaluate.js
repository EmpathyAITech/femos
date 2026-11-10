// Honest evaluation of the FEMOS miner against the planted ground truth.
//
// Thresholds live in learning/mine.js (THRESHOLDS) and were fixed before this evaluation; they
// are NOT tuned per seed. The primary seed (default 42) is reported in full, and seeds 1, 2, 3
// are re-generated and re-scored to show how much the numbers move (`robustness`).
//
// Usage: node learning/evaluate.js [--seed 42] [--no-robustness]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './synth.js';
import { mineIncremental, THRESHOLDS, MINER_VERSION } from './mine.js';
import { parseSeed } from './rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 864e5;
const ms = (d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const monthDiff = (a, b) => (+a.slice(0, 4) - +b.slice(0, 4)) * 12 + (+a.slice(5, 7) - +b.slice(5, 7));
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);

export const METHOD =
  'Explainable rules, no ML: individual = Theil–Sen trend over ≥3 readings in 12 months projecting below 8.0 g/dL within 6 months, or a ≥1.5 g/dL drop from personal max (first-reading-severe excluded); school/village = one-sided CUSUM (k=0.5, h=4) on monthly WHO-cut-off prevalence vs own shrunk 9-month baseline; block = lower CUSUM on follow-up completion of complete referral cohorts; device = two-proportion z (≥4, ratio ≥1.5) on OCR rejection vs other models; process = two-proportion z (≥3.5, ratio ≥1.5) on referral stall rate per district×touchpoint vs all others. Evaluated month by month with no access to future data.';

/** Score one dataset. Returns the `patterns`, `bias` and extra diagnostics blocks. */
export function evaluate(ds) {
  const t0 = performance.now();
  const inc = mineIncremental(ds);
  const runtimeMs = Math.round(performance.now() - t0);
  const F = (lvl) => inc.findings.filter((f) => f.level === lvl);
  const women = new Map(ds.women.map((w) => [w.id, w]));
  const visitsBy = new Map();
  for (const v of ds.visits) {
    if (!visitsBy.has(v.womanId)) visitsBy.set(v.womanId, []);
    visitsBy.get(v.womanId).push(v);
  }

  // ---------- individual ----------
  const truth = new Map(ds.truth.individual.map((t) => [t.womanId, t]));
  const ind = new Map(F('individual').map((f) => [f.key, f]));
  const leads = [];
  let found = 0;
  let late = 0;
  let detectable = 0;
  let foundDetectable = 0;
  const groups = {};
  const bump = (g, k) => { groups[g] ??= { planted: 0, found: 0, flaggedOthers: 0, others: 0 }; groups[g][k]++; };
  for (const [wid, t] of truth) {
    const w = women.get(wid);
    const gA = w.ageAtStart < 20 ? 'adolescent_10_19' : 'adult_20_49';
    const gD = `district_${w.district}`;
    bump(gA, 'planted');
    bump(gD, 'planted');
    // "Detectable": she had ≥3 readings before becoming severe, and her first was not severe.
    const before = (visitsBy.get(wid) ?? []).filter((v) => v.date < t.severeDate);
    const isDetectable = before.length >= THRESHOLDS.individual.minReadings && before[0].hb >= THRESHOLDS.individual.severe;
    if (isDetectable) detectable++;
    const f = ind.get(wid);
    if (!f) continue;
    if (f.firstFlaggedAt < t.severeDate) {
      found++;
      if (isDetectable) foundDetectable++;
      leads.push((ms(t.severeDate) - ms(f.firstFlaggedAt)) / DAY);
      bump(gA, 'found');
      bump(gD, 'found');
    } else late++;
  }
  const stockout = new Map(ds.truth.school.map((s) => [s.school, s.fromMonth]));
  let fa = 0;
  let faExplained = 0;
  for (const [wid, f] of ind) {
    if (truth.has(wid)) continue;
    fa++;
    const w = women.get(wid);
    if (w.school && stockout.has(w.school) && f.firstFlaggedAt.slice(0, 7) >= stockout.get(w.school)) faExplained++;
  }
  for (const w of ds.women) {
    if (truth.has(w.id)) continue;
    const gA = w.ageAtStart < 20 ? 'adolescent_10_19' : 'adult_20_49';
    for (const g of [gA, `district_${w.district}`]) {
      bump(g, 'others');
      if (ind.has(w.id)) bump(g, 'flaggedOthers');
    }
  }
  const flaggedTruth = [...ind.keys()].filter((k) => truth.has(k)).length;
  const individual = {
    planted: truth.size,
    found,
    missed: truth.size - found,
    flaggedAfterSevere: late,
    falseAlarms: fa,
    falseAlarmsInStockoutSchools: faExplained,
    precision: ratio(flaggedTruth, ind.size),
    recall: ratio(found, truth.size),
    detectable,
    recallAmongDetectable: ratio(foundDetectable, detectable),
    medianLeadDays: leads.length ? Math.round(median(leads)) : null,
    pctFlagged30dEarly: truth.size ? Math.round((leads.filter((d) => d >= 30).length / truth.size) * 1000) / 10 : null,
    pctOfFoundFlagged30dEarly: leads.length ? Math.round((leads.filter((d) => d >= 30).length / leads.length) * 1000) / 10 : null,
    definitions: {
      found: 'planted decliners first flagged BEFORE the date their true Hb crosses 8.0',
      precision: 'flagged women who are planted decliners / all flagged women (late flags on decliners count as correct)',
      recall: 'found / planted',
      detectable: 'planted decliners with ≥3 readings before becoming severe and a non-severe first reading',
      pctFlagged30dEarly: '% of ALL planted decliners flagged ≥30 days before becoming severe',
      falseAlarmsInStockoutSchools: 'false alarms among girls in a stock-out school flagged after the stock-out began (a real decline, but not a planted individual pattern)',
    },
  };

  // ---------- units with onset month (school, block) ----------
  const unitScore = (lvl, truthList, keyOf) => {
    const fs = F(lvl);
    const tk = new Map(truthList.map((t) => [keyOf(t), t.fromMonth]));
    const delays = [];
    let foundN = 0;
    let falseN = 0;
    const detail = [];
    for (const f of fs) {
      const flaggedMonth = f.firstFlaggedAt.slice(0, 7);
      if (tk.has(f.key) && flaggedMonth >= tk.get(f.key)) {
        foundN++;
        delays.push(monthDiff(flaggedMonth, tk.get(f.key)));
        detail.push({ key: f.key, fromMonth: tk.get(f.key), flaggedAt: f.firstFlaggedAt, delayMonths: monthDiff(flaggedMonth, tk.get(f.key)) });
      } else {
        falseN++;
        detail.push({ key: f.key, falseAlarm: true, flaggedAt: f.firstFlaggedAt });
      }
    }
    for (const [k, from] of tk) if (!detail.some((d) => d.key === k && !d.falseAlarm)) detail.push({ key: k, fromMonth: from, missed: true });
    return { planted: tk.size, found: foundN, missed: tk.size - foundN, falseAlarms: falseN, medianDelayMonths: median(delays), detail };
  };
  const school = unitScore('school', ds.truth.school, (t) => t.school);
  const block = unitScore('block', ds.truth.block, (t) => t.block);

  // Villages have no planted pattern; a village flag is "explained" if its school had a stock-out.
  const schoolOfVillage = new Map();
  for (const s of ds.geography.schools) for (const v of s.villages) schoolOfVillage.set(v, s.id);
  const villageF = F('village');
  const villageExplained = villageF.filter((f) => stockout.has(schoolOfVillage.get(f.key)) && f.firstFlaggedAt.slice(0, 7) >= stockout.get(schoolOfVillage.get(f.key))).length;
  const village = { planted: 0, flagged: villageF.length, explainedByStockout: villageExplained, unexplained: villageF.length - villageExplained, keys: villageF.map((f) => f.key) };

  // ---------- constant patterns (device, process): present from the start ----------
  const start = ds.meta.periods[0];
  const constScore = (lvl, keys) => {
    const fs = F(lvl);
    const tk = new Set(keys);
    const hit = fs.filter((f) => tk.has(f.key));
    return {
      planted: tk.size,
      found: hit.length,
      missed: tk.size - hit.length,
      falseAlarms: fs.length - hit.length,
      medianDelayMonths: median(hit.map((f) => monthDiff(f.firstFlaggedAt.slice(0, 7), start))),
      flagged: fs.map((f) => ({ key: f.key, flaggedAt: f.firstFlaggedAt, truth: tk.has(f.key) })),
    };
  };
  const device = constScore('device', ds.truth.device.map((d) => d.model));
  const processP = constScore('process', ds.truth.process.map((p) => `${p.district}|${p.touchpoint}`));

  const bias = { individualRecallBy: {}, note: 'Recall = planted decliners flagged before severe / planted, per group. falseAlarmPer1000 = flagged non-planted women per 1000 non-planted women in the group. Small groups: read with care.' };
  for (const [g, c] of Object.entries(groups)) {
    bias.individualRecallBy[g] = { planted: c.planted, found: c.found, recall: ratio(c.found, c.planted), falseAlarmPer1000: c.others ? Math.round((c.flaggedOthers / c.others) * 10000) / 10 : null };
  }
  return { patterns: { individual, school, block, device: device, process: processP }, village, bias, runtimeMs };
}

const summaryRow = (p) => ({
  individualRecall: p.individual.recall,
  individualPrecision: p.individual.precision,
  medianLeadDays: p.individual.medianLeadDays,
  pctFlagged30dEarly: p.individual.pctFlagged30dEarly,
  individualFalseAlarms: p.individual.falseAlarms,
  schoolFound: p.school.found,
  schoolFalseAlarms: p.school.falseAlarms,
  schoolMedianDelayMonths: p.school.medianDelayMonths,
  blockFound: p.block.found,
  blockFalseAlarms: p.block.falseAlarms,
  blockMedianDelayMonths: p.block.medianDelayMonths,
  deviceFound: p.device.found,
  deviceFalseAlarms: p.device.falseAlarms,
  processFound: p.process.found,
  processFalseAlarms: p.process.falseAlarms,
});

function aggregate(rows) {
  const out = {};
  for (const k of Object.keys(rows[0])) {
    const vals = rows.map((r) => r[k]).filter((v) => v != null);
    if (!vals.length) { out[k] = { mean: null, min: null, max: null }; continue; }
    out[k] = { mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000, min: Math.min(...vals), max: Math.max(...vals) };
  }
  return out;
}

function printTable(res) {
  const p = res.patterns;
  const pad = (s, n) => String(s ?? '—').padEnd(n);
  console.log(`\nFEMOS learning evaluation — seed ${res.seed}, ${res.women} women, ${res.visits} visits, ${res.months} months (${res.caveat})\n`);
  console.log(pad('level', 12) + pad('planted', 9) + pad('found', 7) + pad('missed', 8) + pad('false+', 8) + 'detail');
  console.log('-'.repeat(96));
  const i = p.individual;
  console.log(pad('individual', 12) + pad(i.planted, 9) + pad(i.found, 7) + pad(i.missed, 8) + pad(i.falseAlarms, 8) + `precision ${i.precision}, recall ${i.recall} (${i.recallAmongDetectable} of detectable), median lead ${i.medianLeadDays} d, ${i.pctFlagged30dEarly}% ≥30 d early`);
  for (const l of ['school', 'block', 'device', 'process']) {
    const x = p[l];
    console.log(pad(l, 12) + pad(x.planted, 9) + pad(x.found, 7) + pad(x.missed, 8) + pad(x.falseAlarms, 8) + `median delay ${x.medianDelayMonths ?? '—'} months`);
  }
  console.log(pad('village', 12) + pad('0', 9) + pad('—', 7) + pad('—', 8) + pad(res.village.unexplained, 8) + `${res.village.flagged} flagged, ${res.village.explainedByStockout} explained by a school stock-out`);
  console.log('\nbias (individual recall / false alarms per 1000):');
  for (const [g, b] of Object.entries(res.bias.individualRecallBy)) console.log(`  ${pad(g, 20)} recall ${pad(b.recall, 7)} (${b.found}/${b.planted})   FA/1000 ${b.falseAlarmPer1000}`);
  if (res.robustness) {
    console.log(`\nrobustness over seeds ${res.robustness.seeds.join(', ')} (mean [min–max]):`);
    for (const [k, v] of Object.entries(res.robustness.summary)) console.log(`  ${pad(k, 26)} ${v.mean} [${v.min}–${v.max}]`);
  }
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = performance.now();
  const seed = parseSeed(process.argv);
  const file = join(ROOT, 'data/synthetic/longitudinal.json');
  let ds = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (!ds || ds.meta.seed !== seed) {
    console.log(`(generating seed ${seed} in memory; run \`npm run synth -- --seed ${seed}\` to write it)`);
    ds = generate({ seed });
  }
  const main = evaluate(ds);
  const res = {
    generatedAt: new Date().toISOString(),
    seed: ds.meta.seed,
    women: ds.meta.women,
    visits: ds.meta.visits,
    months: ds.meta.periods.length,
    miner: MINER_VERSION,
    thresholds: THRESHOLDS,
    patterns: main.patterns,
    village: main.village,
    bias: main.bias,
    method: METHOD,
    caveat: 'Synthetic data with planted patterns; not clinical evidence.',
  };
  if (!process.argv.includes('--no-robustness')) {
    const seeds = [ds.meta.seed, 1, 2, 3].filter((s, i, a) => a.indexOf(s) === i);
    const rows = [];
    const perSeed = {};
    for (const s of seeds) {
      const e = s === ds.meta.seed ? main : evaluate(generate({ seed: s }));
      rows.push(summaryRow(e.patterns));
      perSeed[s] = summaryRow(e.patterns);
    }
    res.robustness = { seeds, note: 'Same fixed thresholds on independently generated datasets. mean [min–max].', summary: aggregate(rows), perSeed };
  }
  res.runtimeMs = Math.round(performance.now() - t0);
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  writeFileSync(join(ROOT, 'results/learning.json'), JSON.stringify(res, null, 2) + '\n');
  printTable(res);
  console.log(`wrote results/learning.json in ${res.runtimeMs} ms`);
}
