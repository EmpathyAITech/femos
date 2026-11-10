import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, PERIODS } from '../learning/synth.js';
import { mineAll, mineIncremental, theilSen } from '../learning/mine.js';
import { buildDemo, summarise } from '../learning/seed-demo.js';
import { reduce } from '../core/workflow.js';

const small = (seed) => generate({ seed, women: 400, generatedAt: '2026-11-09T00:00:00Z' });

test('synth is deterministic for the same seed and differs across seeds', () => {
  const a = small(5);
  const b = small(5);
  assert.deepEqual(a, b);
  const c = small(6);
  assert.notDeepEqual(a.visits.slice(0, 50), c.visits.slice(0, 50));
  assert.equal(a.meta.periods.length, 24);
  assert.equal(a.meta.periods[0], '2024-11');
  assert.equal(a.meta.periods.at(-1), '2026-10');
  for (const k of ['individual', 'school', 'block', 'device', 'process']) assert.ok(Array.isArray(a.truth[k]) && a.truth[k].length, k);
  for (const v of a.visits.slice(0, 200)) {
    assert.ok(['asha', 'anm', 'school', 'camp', 'clinic', 'self'].includes(v.touchpoint));
    assert.ok(['accepted', 'rejected'].includes(v.ocr));
    if (!v.referred) assert.equal(v.followupDone, null);
  }
});

test('Theil–Sen ignores a single outlier', () => {
  const { slope } = theilSen([0, 1, 2, 3, 4], [12, 11.8, 6, 11.4, 11.2]);
  assert.ok(Math.abs(slope + 0.2) < 1e-9, String(slope));
});

/** Hand-built dataset: one declining woman, one stable woman, one already severe at first reading. */
function tiny() {
  const women = [
    { id: 'W-DECLINE', ageAtStart: 24, district: 'D1', block: 'D1-B1', village: 'V01', hmb: true },
    { id: 'W-STABLE', ageAtStart: 30, district: 'D1', block: 'D1-B1', village: 'V01', hmb: false },
    { id: 'W-SEVERE', ageAtStart: 35, district: 'D1', block: 'D1-B1', village: 'V01', hmb: true },
  ];
  const v = (womanId, date, hb) => ({ womanId, date, touchpoint: 'asha', deviceModel: 'QuickHb Q5', ocr: 'accepted', hb, symptoms: {}, referred: false, followupDone: null, followupDays: null });
  const visits = [
    v('W-DECLINE', '2025-01-10', 11.6), v('W-DECLINE', '2025-03-12', 11.1), v('W-DECLINE', '2025-05-15', 10.4), v('W-DECLINE', '2025-07-14', 9.9), v('W-DECLINE', '2025-09-10', 9.2),
    v('W-STABLE', '2025-01-11', 12.4), v('W-STABLE', '2025-03-10', 12.1), v('W-STABLE', '2025-05-16', 12.6), v('W-STABLE', '2025-07-15', 12.2), v('W-STABLE', '2025-09-12', 12.3),
    v('W-SEVERE', '2025-01-12', 7.4), v('W-SEVERE', '2025-03-12', 7.0), v('W-SEVERE', '2025-05-12', 6.6),
  ];
  return { meta: { seed: 0, periods: PERIODS, women: 3, visits: visits.length }, geography: {}, women, visits, truth: {} };
}

test('miner flags a declining woman early and not a stable one (or one already severe)', () => {
  const ds = tiny();
  const r = mineAll(ds, { asOf: '2025-10' });
  const ind = r.findings.filter((f) => f.level === 'individual');
  const keys = ind.map((f) => f.key);
  assert.ok(keys.includes('W-DECLINE'), JSON.stringify(keys));
  assert.ok(!keys.includes('W-STABLE'));
  assert.ok(!keys.includes('W-SEVERE'), 'already severe at first reading: not flagged');
  const f = ind.find((x) => x.key === 'W-DECLINE');
  assert.ok(f.firstFlaggedAt <= '2025-09-10');
  assert.ok(f.explanation.length > 20 && f.evidence.readings.length >= 3);
  // Before her third reading there is not enough data to flag anyone.
  assert.equal(mineAll(ds, { asOf: '2025-04-30' }).findings.filter((x) => x.level === 'individual').length, 0);
});

test('no peeking: findings as of a date ignore everything after it', () => {
  const ds = small(9);
  const asOf = '2025-12';
  const base = mineAll(ds, { asOf });
  // Corrupt every future visit and outcome; earlier findings must not change.
  const tampered = structuredClone(ds);
  for (const v of tampered.visits) {
    if (v.date > '2025-12-31') {
      v.hb = 5.0;
      v.ocr = 'rejected';
      v.referred = true;
      v.followupDone = false;
      v.followupDays = null;
    }
  }
  assert.deepEqual(mineAll(tampered, { asOf }), base);
  // Referral outcomes are only visible once they happen (or their 30-day deadline passes).
  // Flip every referral outcome that was NOT yet knowable on asOf (resolution date after it);
  // the result must be identical. A completed follow-up is known at date + followupDays, a
  // missed one at date + 30 days.
  const end = Date.parse('2025-12-31T00:00:00Z');
  const resolved = (v) => Date.parse(`${v.date}T00:00:00Z`) + (v.followupDone ? v.followupDays : 30) * 864e5;
  const late = structuredClone(ds);
  let flipped = 0;
  for (const v of late.visits) {
    if (!v.referred || v.date > '2025-12-31' || resolved(v) <= end) continue;
    if (v.followupDone) { v.followupDone = false; v.followupDays = null; } else { v.followupDone = true; v.followupDays = 30; }
    flipped++;
  }
  assert.ok(flipped > 0);
  assert.deepEqual(mineAll(late, { asOf }), base);
});

test('mineIncremental reports when each finding first appears, consistent with mineAll', () => {
  const ds = small(11);
  const inc = mineIncremental(ds);
  const all = mineAll(ds, { asOf: inc.asOf });
  assert.deepEqual(new Set(inc.findings.map((f) => f.id)), new Set(all.findings.map((f) => f.id)));
  for (const f of inc.findings) {
    assert.ok(f.firstMonth, f.id);
    assert.ok(f.firstFlaggedAt.slice(0, 7) <= f.firstMonth, `${f.id} flagged ${f.firstFlaggedAt} but first seen ${f.firstMonth}`);
  }
});

test('demo seed: every case opens with consent and nothing is rejected unexpectedly', () => {
  const demo = buildDemo({ seed: 7 });
  const sum = summarise(demo);
  assert.equal(sum.unexpectedRejections.length, 0, JSON.stringify(sum.unexpectedRejections));
  assert.equal(sum.deliberateRejections.length, 2);
  assert.ok(sum.cases >= 75 && sum.cases <= 90, String(sum.cases));
  for (const s of ['ready_for_review', 'in_review', 'followup_pending', 'closed', 'decided', 'returned', 'conflict']) assert.ok(sum.status[s] > 0, s);
  for (const role of ['self', 'school', 'camp', 'anm', 'asha']) assert.ok(sum.entry[role] > 0, role);
  for (const code of ['HB_UNIT_SUSPECT', 'HISTORY_MISSING', 'CONSENT_GUARDIAN', 'READING_REUSED', 'DUPLICATE_SUSPECT', 'HB_FALLING', 'DANGER_SIGNS']) assert.ok(sum.flags[code] > 0, code);
  assert.ok(sum.overdueTasks >= 5);
  assert.ok(sum.proposals['ESCALATE:pending'] > 0 && sum.proposals['MESSAGE_SEND:pending'] > 0);
  const byCase = new Map();
  for (const e of demo.events) {
    assert.ok(Date.parse(e.at) <= Date.parse(demo.anchor), `event after anchor ${e.at}`);
    if (!byCase.has(e.caseId)) byCase.set(e.caseId, []);
    byCase.get(e.caseId).push(e);
  }
  for (const [id, evs] of byCase) {
    const s = reduce(evs, id);
    const applied = s.events.map((eid) => evs.find((e) => e.id === eid).type);
    assert.equal(applied[0], 'CASE_OPENED', id);
    assert.equal(applied[1], 'CONSENT_RECORDED', id);
    assert.equal(evs[0].type, 'CASE_OPENED', id);
    assert.equal(evs[1].type, 'CONSENT_RECORDED', id);
  }
  // Deterministic: same seed, same log.
  assert.deepEqual(buildDemo({ seed: 7 }).events.map((e) => e.id), demo.events.map((e) => e.id));
});
