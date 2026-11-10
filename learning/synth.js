// Synthetic longitudinal population for the FEMOS learning module.
//
// Generates ~3000 girls and women (10–49 y) across 1 state, 2 districts, 6 blocks, 60 villages
// and 30 schools, followed for 24 monthly periods (2024-11 .. 2026-10), with irregular visits.
// Five ground-truth patterns are PLANTED and recorded under `truth` so the miner can be scored:
//   a) individual: ~4% progressive decline (0.15–0.35 g/dL/month) that crosses WHO severe (<8.0)
//   b) school:     3 schools get an IFA stock-out in year 2 → mean Hb falls ~0.8 g/dL
//   c) block:      1 block's follow-up completion drops from ~75% to ~35%
//   d) device:     1 device model's OCR rejection rate is ~25% vs ~6%
//   e) process:    in 1 district, referrals made by school teams stall at 2× the normal rate
//
// Everything is synthetic. Nothing here is clinical evidence.
//
// Usage: node learning/synth.js [--seed 42] [--out data/synthetic/longitudinal.json] [--women 3000]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng, parseSeed } from './rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DEVICE_MODELS = ['HemoCheck HB-201', 'Hemo-Lite 3', 'QuickHb Q5', 'SahiHb S2'];
export const START = { year: 2024, month: 11 };
export const N_PERIODS = 24;

export const periodOf = (m) => {
  const y = START.year + Math.floor((START.month - 1 + m) / 12);
  const mo = ((START.month - 1 + m) % 12) + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
};
export const PERIODS = Array.from({ length: N_PERIODS }, (_, m) => periodOf(m));
const daysIn = (period) => new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate();
/** Continuous time in months since the start for a YYYY-MM-DD date. */
const tOf = (m, day, period) => m + (day - 1) / daysIn(period);
const dateAt = (t) => {
  const m = Math.floor(t);
  const p = periodOf(m);
  const day = 1 + Math.floor((t - m) * daysIn(p));
  return `${p}-${String(day).padStart(2, '0')}`;
};

const DISTRICTS = [
  { id: 'D1', name: 'Sonpur', blocks: ['Sonpur Sadar', 'Belhar', 'Kharik'] },
  { id: 'D2', name: 'Amarpur', blocks: ['Amarpur Sadar', 'Raniganj', 'Dhoraiya'] },
];
const VILLAGE_STEMS = ['Rampur', 'Sitapur', 'Madhopur', 'Chandpur', 'Bishunpur', 'Lakhanpur', 'Haripur', 'Gopalpur', 'Kishanpur', 'Shivpur',
  'Bhagwanpur', 'Narayanpur', 'Fatehpur', 'Bela', 'Kusumbha', 'Parsa', 'Jamuni', 'Belwa', 'Sakra', 'Mohanpur'];

function geography() {
  const g = { state: { id: 'S1', name: 'Synthetic State' }, districts: [], blocks: [], villages: [], schools: [] };
  let v = 0;
  let s = 0;
  DISTRICTS.forEach((d, di) => {
    g.districts.push({ id: d.id, name: d.name });
    d.blocks.forEach((bname, bi) => {
      const bid = `${d.id}-B${bi + 1}`;
      g.blocks.push({ id: bid, name: bname, district: d.id });
      const vids = [];
      for (let k = 0; k < 10; k++) {
        v++;
        const vid = `V${String(v).padStart(2, '0')}`;
        vids.push(vid);
        g.villages.push({ id: vid, name: `${VILLAGE_STEMS[(v - 1) % VILLAGE_STEMS.length]}${v > 20 ? ` ${Math.ceil(v / 20)}` : ''}`, block: bid, district: d.id });
      }
      for (let k = 0; k < 5; k++) {
        s++;
        const sid = `SCH${String(s).padStart(2, '0')}`;
        g.schools.push({ id: sid, name: `Govt. Girls' School ${s}`, block: bid, district: d.id, villages: [vids[2 * k], vids[2 * k + 1]] });
      }
    });
    void di;
  });
  return g;
}

/**
 * Generate the dataset. Pure function of (seed, options).
 * @returns {{meta, geography, women, visits, truth}}
 */
export function generate({ seed = 42, women: nWomen = 3000, generatedAt = new Date().toISOString() } = {}) {
  const r = makeRng(seed);
  const geo = geography();
  const schoolOfVillage = new Map();
  for (const s of geo.schools) for (const v of s.villages) schoolOfVillage.set(v, s.id);

  // ---- planted patterns (chosen up front, recorded in truth) ----
  const stockouts = r.sample(geo.schools, 3).map((s) => ({ school: s.id, fromIdx: r.int(12, 19), drop: 0.8 }));
  const blockDrop = { block: r.pick(geo.blocks).id, fromIdx: r.int(10, 18), before: 0.75, after: 0.35 };
  const badModel = r.pick(DEVICE_MODELS);
  const processDistrict = r.pick(geo.districts).id;
  const stockoutBySchool = new Map(stockouts.map((s) => [s.school, s]));

  const women = [];
  const visits = [];
  const truthIndividual = [];
  const nDecliners = Math.round(nWomen * 0.04);
  const declinerIdx = new Set(r.sample([...Array(nWomen).keys()], nDecliners));

  for (let i = 0; i < nWomen; i++) {
    const id = `W${String(i + 1).padStart(4, '0')}`;
    const village = r.pick(geo.villages);
    const adolescent = r.bool(0.4);
    const ageAtStart = adolescent ? r.int(10, 19) : r.int(20, 49);
    const school = adolescent ? schoolOfVillage.get(village.id) : undefined;
    const hmb = r.bool(0.15);
    // Baseline Hb: population mean ~11.6, sd ~1.4; lower for adolescents and with HMB.
    let base = r.normal(11.8, 1.3) - (adolescent ? 0.35 : 0) - (hmb ? 0.8 : 0);
    base = Math.max(7.2, Math.min(15.5, base));
    // Small idiosyncratic drift for everyone (realism: not every decline is planted).
    const drift = r.normal(0, 0.015);

    let decline = null;
    if (declinerIdx.has(i)) {
      // Progressive decline (e.g. untreated HMB) that eventually crosses WHO severe (<8.0).
      const slope = r.range(0.15, 0.35);
      base = Math.max(base, r.range(10.0, 12.0));
      let dur = (base - 8) / slope; // months from onset to severe
      if (dur > 21) {
        base = 8 + slope * r.range(10, 21);
        dur = (base - 8) / slope;
      }
      const latestOnset = 23 - dur;
      const onset = latestOnset <= 0 ? 0 : r.range(0, latestOnset);
      const severeT = onset + dur;
      decline = { slope, onset, severeT };
      truthIndividual.push({
        womanId: id,
        severeMonth: periodOf(Math.floor(severeT)),
        severeDate: dateAt(severeT),
        onsetMonth: periodOf(Math.floor(onset)),
        slopePerMonth: Math.round(slope * 100) / 100,
        baselineHb: Math.round(base * 10) / 10,
        adolescent,
        district: village.district,
      });
    }

    women.push({ id, ageAtStart, district: village.district, block: village.block, village: village.id, ...(school ? { school } : {}), hmb });

    const trueHb = (t) => {
      let h = base + drift * t;
      if (decline && t > decline.onset) h -= decline.slope * (t - decline.onset);
      const so = school && stockoutBySchool.get(school);
      if (so && t >= so.fromIdx) h -= so.drop * Math.min(1, (t - so.fromIdx) / 2 + 0.25);
      return Math.max(5.5, h);
    };

    // Visits: irregular, 1–8 over 24 months.
    const k = r.weighted([[1, 10], [2, 14], [3, 17], [4, 17], [5, 14], [6, 11], [7, 9], [8, 8]]);
    const months = r.sample([...Array(N_PERIODS).keys()], k).sort((a, b) => a - b);
    for (const m of months) {
      const period = periodOf(m);
      const day = r.int(1, daysIn(period));
      const t = tOf(m, day, period);
      const touchpoint = school
        ? r.weighted([['school', 50], ['camp', 15], ['asha', 20], ['clinic', 8], ['anm', 4], ['self', 3]])
        : r.weighted([['asha', 38], ['anm', 15], ['clinic', 20], ['camp', 15], ['self', 12]]);
      const deviceModel = r.pick(DEVICE_MODELS);
      const ocr = r.bool(deviceModel === badModel ? 0.25 : 0.06) ? 'rejected' : 'accepted';
      const hb = Math.round(Math.max(4, r.normal(trueHb(t), 0.4)) * 10) / 10;
      const sev = Math.max(0, 12 - hb); // anaemia depth drives symptoms
      const symptoms = {
        fatigue: r.bool(Math.min(0.9, 0.15 + 0.12 * sev)),
        dizziness: r.bool(Math.min(0.8, 0.08 + 0.1 * sev)),
        breathless: r.bool(hb < 8 ? 0.35 : 0.03),
        fainting: r.bool(hb < 8 ? 0.12 : 0.01),
        heavyBleeding: r.bool(hmb ? 0.85 : 0.06),
      };
      const pRefer = hb < 10 ? 0.8 : symptoms.heavyBleeding && hb < 12 ? 0.3 : hb < 11 ? 0.1 : 0.01;
      const referred = r.bool(pRefer);
      let followupDone = null;
      let followupDays = null;
      if (referred) {
        let pDone = 0.75;
        if (village.block === blockDrop.block && m >= blockDrop.fromIdx) pDone = Math.min(pDone, blockDrop.after);
        if (village.district === processDistrict && touchpoint === 'school') pDone = Math.min(pDone, 1 - 2 * (1 - 0.75)); // stall ×2
        followupDone = r.bool(pDone);
        if (followupDone) followupDays = Math.min(28, 1 + Math.round(Math.exp(r.normal(2.0, 0.6))));
      }
      visits.push({ womanId: id, date: `${period}-${String(day).padStart(2, '0')}`, touchpoint, deviceModel, ocr, hb, symptoms, referred, followupDone, followupDays });
    }
  }
  visits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.womanId < b.womanId ? -1 : 1));

  return {
    meta: {
      seed,
      generatedAt,
      generator: 'femos-synth@0.1.0',
      women: women.length,
      visits: visits.length,
      periods: PERIODS,
      note: 'Synthetic data with planted patterns. Not real people. Not clinical evidence.',
      definitions: {
        followupDone: 'For referred visits: true if follow-up completed (followupDays after the visit), false if not completed within 30 days; null if not referred.',
        ocr: 'Outcome of camera OCR on the device screen photo; a rejected photo is re-entered manually, so hb is still recorded.',
      },
    },
    geography: geo,
    women,
    visits,
    truth: {
      individual: truthIndividual,
      school: stockouts.map((s) => ({ school: s.school, fromMonth: periodOf(s.fromIdx), drop: s.drop })),
      block: [{ block: blockDrop.block, fromMonth: periodOf(blockDrop.fromIdx), before: blockDrop.before, after: blockDrop.after }],
      device: [{ model: badModel, rejectRate: 0.25, othersRate: 0.06 }],
      process: [{ district: processDistrict, touchpoint: 'school', stallMultiplier: 2 }],
    },
  };
}

/** Compact JSON: one record per line, keeps the file small but diff-able. */
export function serialise(ds) {
  const lines = (arr) => arr.map((x) => '    ' + JSON.stringify(x)).join(',\n');
  return `{
  "meta": ${JSON.stringify(ds.meta)},
  "geography": ${JSON.stringify(ds.geography)},
  "truth": ${JSON.stringify(ds.truth)},
  "women": [
${lines(ds.women)}
  ],
  "visits": [
${lines(ds.visits)}
  ]
}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = parseSeed(process.argv);
  const oi = process.argv.indexOf('--out');
  const out = oi >= 0 ? process.argv[oi + 1] : join(ROOT, 'data/synthetic/longitudinal.json');
  const wi = process.argv.indexOf('--women');
  const t0 = performance.now();
  const ds = generate({ seed, women: wi >= 0 ? Number(process.argv[wi + 1]) : 3000 });
  mkdirSync(dirname(out), { recursive: true });
  const text = serialise(ds);
  writeFileSync(out, text);
  console.log(`seed ${seed}: ${ds.meta.women} women, ${ds.meta.visits} visits, ${ds.meta.periods.length} months → ${out} (${(text.length / 1e6).toFixed(2)} MB, ${Math.round(performance.now() - t0)} ms)`);
  console.log(`truth: ${ds.truth.individual.length} decliners; stock-out schools ${ds.truth.school.map((s) => `${s.school}@${s.fromMonth}`).join(', ')}; block ${ds.truth.block[0].block}@${ds.truth.block[0].fromMonth}; device ${ds.truth.device[0].model}; process ${ds.truth.process[0].district}×school`);
}
