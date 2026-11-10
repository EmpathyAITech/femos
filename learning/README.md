# FEMOS governed learning module

This module finds patterns across many cases that no single visit shows: one woman's Hb sliding
toward severe, a school whose anaemia rate is climbing, a block where referrals stop being
followed up, a device whose photos fail OCR, a hand-off that stalls. It produces **findings for
human review only**. It never changes a case, sends a message or edits a protocol.

Everything here runs on **synthetic data with planted patterns**. The numbers below show that the
rules do what they claim on data built to contain those patterns. They are **not clinical
evidence** and say nothing about how the rules would perform on real populations.

```
npm run synth          # data/synthetic/longitudinal.json   (seed 42; --seed N to change)
npm run learn          # results/learning.json + table       (also re-scores seeds 1, 2, 3)
npm run seed           # data/demo/events.json               (UI demo log; see data/demo/README.md)
node --test tests/learning.test.js
```

Node built-ins only. On a laptop, synth takes about 60 ms, one `mineAll` about 65 ms, and the full
evaluation over 4 seeds about 3.5 s.

## Files

| file | what it is |
|---|---|
| `rng.js` | mulberry32 PRNG + helpers (seeded, deterministic) |
| `synth.js` | synthetic population generator; `generate({seed, women})` |
| `mine.js` | the miner; `mineAll`, `mineIncremental`, `THRESHOLDS` |
| `evaluate.js` | scoring against planted truth → `results/learning.json` |
| `registry.json` | model/rule-set registry entry (version, thresholds, status, limitations, bias checks) |
| `seed-demo.js` | builds the FEMOS demo event log with the real engine and agents |

## The synthetic population (`synth.js`)

About 3000 girls and women aged 10–49 in 1 state, 2 districts, 6 blocks, 60 villages and 30
schools. Adolescents (10–19) are attached to the school serving their village. The data covers 24
monthly periods (2024-11 to 2026-10) with 1–8 irregular visits per person (≈12.6k visits) at
`asha | anm | school | camp | clinic | self`. Baseline Hb is about N(11.6, 1.4), lower for
adolescents and for the ~15% with heavy menstrual bleeding. Readings have measurement noise
(sd 0.4) and come from 4 device models, with an OCR outcome, symptoms, and referral and follow-up
outcomes.

Five patterns are planted and recorded under `truth`:

| level | planted pattern |
|---|---|
| individual | 4% of women decline 0.15–0.35 g/dL/month until they cross WHO severe (< 8.0). The month and date of crossing are recorded |
| school | 3 schools have an IFA stock-out from a random month in year 2, and mean Hb falls ~0.8 g/dL |
| block | 1 block's follow-up completion falls from 75% to 35% from a given month |
| device | 1 model's OCR rejection rate is 25%, against 6% for the others |
| process | in 1 district, referrals made at school stall at 2× the normal rate |

## Methods (`mine.js`)

All methods are classical, explainable statistics. Each finding carries `explanation` (plain
language) and `evidence` (the numbers behind it).

**No peeking.** `mineAll(ds, {asOf})` uses only what was knowable on `asOf`. A reading is known
from its visit date. A referral outcome is known on *visit + followupDays* if completed, or on
*visit + 30 days* (the deadline) if not. Tests check this by corrupting every later record and
flipping every not-yet-knowable outcome, then requiring identical output.

| level | method | fires when |
|---|---|---|
| individual | Per woman, at each reading, look at her readings in the previous 12 months. **Trend:** Theil–Sen slope (robust to one bad reading) over ≥3 readings spanning ≥60 days. **Drop:** mean of the latest two readings vs the earlier personal max | slope ≤ −0.1 g/dL/month **and** the projection falls below 8.0 within 6 months; **or** drop ≥ 1.5 g/dL. Women already severe at their first reading are not flagged, because they are already on the urgent pathway |
| school, village | Monthly share of readings below the WHO 2024 cut-off by age (< 11.5 at 10–11 y, < 12.0 at 12+). Compared with the unit's own first-9-month baseline, Beta-shrunk toward the pooled baseline (prior weight 20). One-sided upper CUSUM on the monthly binomial z: S = max(0, S + z − k) | S ≥ h, with k = 0.5, h = 4. Months with < 5 readings are skipped |
| block | Follow-up completion by referral month vs the block's own baseline. Only **complete** cohorts are used (month end + 30 d ≤ asOf), because partial cohorts over-represent quick completions. Lower CUSUM | S ≥ 4 (k = 0.5, ≥ 5 per month) |
| device | OCR rejection rate per model vs all other models pooled, cumulative to asOf | two-proportion z ≥ 4, ratio ≥ 1.5, ≥ 100 photos |
| process | Stall rate (no follow-up within 30 d) per district × touchpoint vs all other referrals | z ≥ 3.5 (≈ Bonferroni over the cells), ratio ≥ 1.5, ≥ 40 resolved referrals |

The thresholds were chosen once, before evaluation, from first principles: the WHO severe cut-off,
textbook CUSUM k/h, and a Bonferroni-style z. They were **not tuned per seed**. Changing them makes
a new version in `registry.json`, and that version must be re-evaluated on every seed.

### API

```js
import { mineAll, mineIncremental, THRESHOLDS } from './learning/mine.js';

mineAll(dataset, { asOf?: 'YYYY-MM' | 'YYYY-MM-DD' | ISO, levels?: string[] })
  // → { asOf: 'YYYY-MM-DD', miner: 'femos-mine@0.1.0', thresholds, status: 'shadow',
  //     findings: [{ id, level, key, label, score, firstFlaggedAt, active, explanation, evidence,
  //                  firstFlaggedMonth? }] }
  // level ∈ individual | school | village | block | device | process
  // 'YYYY-MM' means the end of that month. Without asOf, the last visit date is used.

mineIncremental(dataset, { levels? })
  // Walks month by month (asOf = each month end, plus one step 30 days past the end so the last
  // referral cohorts can complete) and returns
  // → { asOf, months, findings: [{ ...finding as first seen, firstMonth }] }
```

`firstFlaggedAt` is the date the triggering data became available. For an individual, that is the
date of the reading that tipped the rule. For a school or village, it is the end of the month the
CUSUM crossed h. For a block, it is the end of the cohort month + 30 days.

## Results (seed 42, from `results/learning.json`)

| level | planted | found | missed | false alarms | timing |
|---|---|---|---|---|---|
| individual | 120 | 47 | 73 | 50 | precision 0.58, recall 0.39 (0.60 among the 78 who had ≥3 readings before going severe); median lead **130 days**; 35% of all decliners flagged ≥30 days early |
| school | 3 | 2 | 1 | 1 | median delay 7 months (9 and 5) |
| block | 1 | 1 | 0 | 0 | delay 2 months |
| device | 1 | 1 | 0 | 0 | flagged in the first month |
| process | 1 | 1 | 0 | 0 | 9 months (needs ≥40 resolved referrals in the cell) |
| village (nothing planted) | 0 | – | – | 2 of 3 unexplained | 1 village flag is explained by its school's stock-out |

Robustness, with the same thresholds on seeds 42/1/2/3 (mean [min–max]): individual recall
0.44 [0.39–0.48], precision 0.55 [0.50–0.58], median lead 141 d [125–158], school found 2 of 3
[1–3] with 1 false alarm per seed and a median delay of 5.5 months [2–7], block found 4 of 4 with a
2.5-month delay, device and process found 4 of 4 with no false alarms.

Reading the numbers honestly:

- **Individual recall is limited by visits, not only by the rule.** 42 of 120 decliners never had
  3 readings before becoming severe, so no trend rule could have caught them. 21 more were flagged
  only after crossing 8.0, and those count as misses. Of the 50 false alarms, 8 are girls in
  stock-out schools whose Hb really did fall. Others are noise, or real non-planted drift.
- **School monitoring is slow.** With about 40 girls per school and about 7 readings per school
  per month, a 0.8 g/dL fall moves prevalence by about 17 points, and the CUSUM needs months to
  separate that from noise. In practice this signal should be paired with IFA supply data rather
  than used alone.
- **Bias check.** Recall is similar for adolescents (0.39) and adults (0.39). Adolescents get more
  than twice as many false alarms per 1000 (26.6 vs 11.4), partly because of the stock-outs.
  Recall by district: D1 0.44, D2 0.33. These are small groups.

## Governance loop

```
collect → mine → propose → shadow → approve → deploy → monitor
   ↑                                                     │
   └─────────────────────────────────────────────────────┘
```

1. **Collect**: only cases whose `consent.learning` is true, de-identified, under the data-sharing
   agreement.
2. **Mine**: run a registered, versioned rule set (`registry.json`) with fixed thresholds.
3. **Propose**: findings are suggestions with evidence, e.g. "visit W0008 earlier" or "check IFA
   stock at SCH16".
4. **Shadow**: findings are shown to programme staff next to normal work. Nothing is automated.
   Staff record whether each finding was useful and whether it was true, and that record becomes the
   real-world evaluation.
5. **Approve**: a named clinical owner and the programme approve a version for a specific,
   limited use. Approval is recorded in `registry.json.approvals`.
6. **Deploy**: even when deployed, a finding at most *proposes* an action through the FEMOS
   proposal mechanism (`PROPOSAL_CREATED`), which a human must approve. This is the same rule
   every agent follows.
7. **Monitor**: re-run the evaluation and bias checks on each new period. Watch for drift (new
   devices, new touchpoints, seasonality). Roll back when performance falls below the agreed bar.

### Why findings are not applied automatically

- The rules were evaluated only on synthetic data made by the same team that wrote them.
- Precision is about 0.55: roughly every second individual flag is not a planted decliner. Acting
  automatically would spend scarce ASHA time and could alarm women for no reason.
- Unit-level flags (a school, a block, a team) can be misread as blame. They are prompts to check
  supply, staffing or process, and a person who knows the context has to interpret them.
- Women seen rarely cannot be flagged at all. An automatic system would make this blind spot look
  like an absence of risk.

### Regulatory note (SaMD)

If findings were used to direct the care of individual patients, the software could qualify as
**Software as a Medical Device**. In India that falls under the Medical Devices Rules 2017 (CDSCO).
The EU MDR, US FDA and IMDRF have comparable frameworks. FEMOS keeps the module in shadow mode, for
programme-level review, until a qualified clinical owner, an ethics committee and the applicable
regulator have reviewed the intended use. That review would include clinical validation on real,
consented, retrospective data.

## Limitations

- Synthetic data only. Real Hb distributions, visit patterns and device behaviour will differ.
- WHO cut-offs are applied without altitude, smoking or pregnancy adjustment.
- Bias checks cover only age group and district. Caste/community, religion, income, disability and
  access are not represented in the synthetic data and must be checked on real data.
- Cumulative two-proportion tests (device, process) find persistent differences, not short
  episodes.
- Thresholds are fixed constants. They will need recalibration on real data, as a new version
  under the governance loop.
