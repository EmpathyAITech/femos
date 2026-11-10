# FEMOS: initial results

_Generated 2026-11-10 by `npm run results`. Every number below comes from synthetic data that the repository generates deterministically. Clinical evaluation follows in field pilots with our collaborating health centres._

## Summary

| Area | Result |
|---|---|
| Automated tests | 90 passing, 0 failing (`node --test tests/*.test.js`) |
| FHIR R4 structure | 425/425 resources in 81 bundles valid against the HL7 R4 JSON Schema (structure and datatypes; terminology and invariants not checked) |
| OCR parser history | v1 on its test set: 14/154 correct, **8 unsafe**. v2 (after fixing the failure modes v1 exposed) on a fresh held-out set (seed 20261110): 30/154 correct, **0 unsafe**. Disclosure: the held-out set was scored twice: once with the v1 settings (29/154, 0 unsafe) and once after the settings were re-chosen on the separate calibration set (30/154, 0 unsafe); it was never used to choose anything. |
| Reading meter displays (OCR) | 30/154 images read correctly (19.5%). 124 declined, so the worker typed the value. **0 wrong values proposed (0.0%)**, each still subject to the worker's visual check. |
| Catching planted errors | FEMOS caught **78/78** planted errors (100.0%). A plain form with required fields would catch 6/78. A form that also validates ranges would catch 24/78. False alarms: 7, all of them "possible duplicate" prompts. |
| Spotting patterns over time | Women with a planted Hb decline flagged before reaching the severe range: 47/120 (recall 39%, precision 58%, median lead 130 days). |

## 1. Reading haemoglobin meter displays (OCR)

**Question:** can the phone read the Hb value from a photo of the meter? When it can't, does it decline rather than guess?

**Method:** 154 synthetic display photos across 14 conditions (`benchmarks/ocr`), read with tesseract.js 7.0.0 eng best_int running fully offline. A separate calibration set with a different seed was used to choose the settings; the test set was run once.
- Preprocessing: sharp/canvas: greyscale → resize to width 1200 → [preprocess.js] contrast stretch (1st–99th percentile) → Otsu threshold → display panel = largest light 4-connected region not touching the photo border and ≥4% of the area (fallback: whole photo) → crop to its bounding box → re-stretch + Otsu inside the crop → paint dark regions connected to the crop border white → two variants: A = stretched greyscale, B = Otsu black/white → resize to width 500 → pad 40px white.
- Tesseract: page segmentation mode 6, character whitelist none.
- Parsing: `core/ocr.js` `parseHbDisplay`. Safety rule: Each variant is parsed by core/ocr.js parseHbDisplay. Accept only if (a) both variants return status "candidate" with the same value (unit kept only if both read the same unit; one unit missing → unit null, worker selects; two different units → reject), or (b) exactly one variant returns "candidate" and the other returns "no_reading" (no plausible number, no decimal-less number) or "low_confidence" whose plausible numbers all equal the candidate value; unit then kept only if the other variant read no unit or the same unit. Anything else — different values, ambiguous/decimal_suspect/unit_conflict in either variant beside a candidate, or no candidate at all — is rejected and the worker types the reading.

Outcomes: **correct** = the proposed value matches the display. **Rejected** = nothing was proposed and the worker types the value; this is safe. **Unsafe** = a wrong value was proposed, or any value on an error or blank screen.

| Condition | n | Correct | Rejected | Unsafe |
|---|---:|---:|---:|---:|
| clean | 11 | 5 | 6 | 0 |
| seven segment | 11 | 1 | 10 | 0 |
| distractors | 11 | 2 | 9 | 0 |
| low contrast | 11 | 3 | 8 | 0 |
| blur | 11 | 6 | 5 | 0 |
| glare | 11 | 3 | 8 | 0 |
| rotation | 11 | 3 | 8 | 0 |
| skew | 11 | 2 | 9 | 0 |
| small | 11 | 3 | 8 | 0 |
| noise | 11 | 1 | 10 | 0 |
| g per L | 11 | 0 | 11 | 0 |
| hard decimal | 11 | 0 | 11 | 0 |
| two values | 11 | 1 | 10 | 0 |
| no reading | 11 | 0 | 11 | 0 |
| **Total** | **154** | **30** | **124** | **0** |

Without the agreement rule, a single preprocessing variant would have produced: grey, 21 correct and 0 unsafe; black/white, 47 correct and 2 unsafe. Median time was 81.5 ms per photo (two OCR passes) on a laptop CPU.

**What this shows.** Tesseract's general English model reads the large LCD digits poorly. It fails on seven-segment digits, splits big glyphs ("1 3.8") and mistakes square LCD decimal points for letters. The parser and the agreement rule therefore decline most photos, so recall is low. The wrong values that got through follow a few patterns that the parser can detect: a dropped leading digit, a previous reading labelled PREV/Last when the current value was not read, and a value with no unit. Changes to the parser are proposed separately. A digit recogniser trained for LCDs and seven-segment displays is the obvious next step. Until then, OCR only saves typing on clear photos, and the worker always confirms the value.

## 2. Catching data errors before a clinician sees the case

**Method:** 134 synthetic cases built as FEMOS event logs (`benchmarks/checks`): 52 clean, 78 with exactly one planted error each, and 4 hard negatives for identity matching (different women with similar names). Another 16 "anchor" records exist only so that duplicates and reused photos have something to collide with. All cases share one log and are processed by the real agent pipeline (`settle()`), which runs the cross-case checks. Clean cases are realistic: some are anaemic, some have heavy bleeding, some use g/L meters. Clinical signals (Hb band, heavy-bleeding indicators, danger signs, falling Hb) are expected on these cases and are not counted as errors.

| Planted error | Planted | Caught by FEMOS | Blocks submission | Plain form | Validated form |
|---|---:|---:|---|:-:|:-:|
| `HB_UNIT_SUSPECT` | 6 | 6 | 6/6 blocked |  | ✓ |
| `HB_IMPLAUSIBLE` | 6 | 6 | 6/6 blocked |  | ✓ |
| `HB_DECIMAL_CORRECTION` | 6 | 6 | 0/6 blocked |  |  |
| `HISTORY_CONTRADICTION` | 6 | 6 | 0/6 blocked |  |  |
| `HISTORY_MISSING` | 6 | 6 | 6/6 blocked | ✓ | ✓ |
| `HISTORY_OUT_OF_RANGE` | 6 | 6 | 6/6 blocked |  | ✓ |
| `AGE_MISMATCH` | 6 | 6 | 0/6 blocked |  |  |
| `DUPLICATE_SUSPECT` | 6 | 6 | 0/6 blocked |  |  |
| `READING_REUSED` | 6 | 6 | 6/6 blocked |  |  |
| `READING_STALE` | 6 | 6 | 0/6 blocked |  |  |
| `CONSENT_GUARDIAN` | 6 | 6 | 6/6 blocked |  |  |
| `OUT_OF_SCOPE` | 6 | 6 | 0/6 blocked |  |  |
| `CONSENT_MISSING` | 6 | 6 | 6/6 blocked |  |  |
| **Total** | **78** | **78** | | **6** | **24** |

- **Detection:** FEMOS caught 78/78 (100.0%). A plain digital form, which only enforces required fields, would catch 6/78 (7.7%). A form that also range-checks every number, including Hb, would catch 24/78 (30.8%).
- **Blocking:** 42/42 of the errors that must be fixed before submission blocked it. 0 of 36 warning-only cases were wrongly blocked, and 0 of 52 clean cases were blocked.
- **False alarms:** 7 in total: 2 on clean cases (2 of 52 clean cases had at least one) and 5 extra flags on planted cases. By code: `DUPLICATE_SUSPECT` ×7. Every one is a non-blocking "possible duplicate" prompt. It fires when two different women from the same village have birth years within one year of each other, even when their names differ. In a real village this would be more frequent, so the duplicate matcher needs tightening before use in the field.
- **Identity hard negatives:** 4 pairs of different women with similar names in different villages. 0 were marked "likely" the same person, and 2 were raised as "possible" prompts for a human to check. Planted cross-script and spelling duplicates found: 6/6 (प्रिया/Priya, Pooja/Puja, Lakshmi/Laxmi, Sunita/सुनीता, Rekha/रेखा, Paswan/Paswaan).

## 3. Spotting patterns over time

**Method:** Explainable rules, no ML: individual = Theil–Sen trend over ≥3 readings in 12 months projecting below 8.0 g/dL within 6 months, or a ≥1.5 g/dL drop from personal max (first-reading-severe excluded); school/village = one-sided CUSUM (k=0.5, h=4) on monthly WHO-cut-off prevalence vs own shrunk 9-month baseline; block = lower CUSUM on follow-up completion of complete referral cohorts; device = two-proportion z (≥4, ratio ≥1.5) on OCR rejection vs other models; process = two-proportion z (≥3.5, ratio ≥1.5) on referral stall rate per district×touchpoint vs all others. Evaluated month by month with no access to future data.

Data: 3000 synthetic women, 12628 visits over 24 months, with planted patterns (`learning/`).

| Pattern | Planted | Found | Missed | False alarms | Median delay |
|---|---:|---:|---:|---:|---|
| individual | 120 | 47 | 73 | 50 | 130 days early (lead) |
| school | 3 | 2 | 1 | 1 | 7 months |
| block | 1 | 1 | 0 | 0 | 2 months |
| device | 1 | 1 | 0 | 0 | 0 months |
| process | 1 | 1 | 0 | 0 | 9 months |

Robustness: Same fixed thresholds on independently generated datasets. mean [min–max]. Individual recall 0.442 [0.392–0.483], precision 0.553 [0.5–0.576].

_Synthetic data with planted patterns; not clinical evidence._

## Caveats

- **All data is synthetic.** The display images are drawn as SVG. Real phone photos add blur, reflections and odd angles, and the panel finder has not been tested on them. The event logs and patient histories are generated too. None of these results describe clinical performance or the experience of real users.
- **The planted-error results test the rules, not the frequency of errors.** Each error type is planted the way the rules expect it. The headline detection rate shows that each rule fires when its error is present, and how often the rules misfire on realistic clean cases. It does not show that FEMOS catches every real-world error.
- **People stay in the loop.** OCR only proposes a value, which the worker confirms against the device. Flags never change a record. Clinical decisions are made by clinicians.
- **Reproduce:** `node benchmarks/ocr/gen.js && npm run bench:ocr && npm run bench:checks && npm run learn && npm run results`.
