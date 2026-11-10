# FEMOS demo event log (synthetic)

`events.json` is a **synthetic** FEMOS event log for demonstrating the field app and the clinician
console. Every person, phone number (`+9190000xxxxx`), ABHA number and village record in it is
made up. It contains no real patient data. Do not add real data to this folder.

Regenerate it with:

```
npm run seed            # = node learning/seed-demo.js [--seed 7]
```

The output is deterministic for a given seed: the same seed gives byte-identical files.
`summary.json` holds the status, flag and proposal histograms, the case → archetype map and the
list of deliberate rejections.

## How it is built

`learning/seed-demo.js` scripts about 80 cases in **Gaya district, Bihar**, in blocks **Sadar,
Bodh Gaya and Tekari**, over the ~60 days before a fixed anchor of **2026-11-09T09:00:00Z**. All
human steps from all cases go onto one timeline in time order. Each one is created with
`makeEvent`, and then the real agents run with `settle(log, caseId, {pack, now})`, with `now` one
second after the step. The flags, handoffs and proposals are therefore exactly what the engine
produces. A sweep of the agents across all open cases runs 3 days before the anchor and again at
the anchor, and that is where the overdue follow-up proposals come from. Core `uid()` randomness is
replaced with a seeded generator while the log is built, so ids are reproducible.

Every case's log starts with `CASE_OPENED` followed by `CONSENT_RECORDED`. Agents first run after
consent, because the two are recorded in one sitting.

Actors: `asha-01`..`asha-06` (two per block), `anm-01` (Sadar and Bodh Gaya), `anm-02` (Tekari),
`nurse-01`, `school-01`, `camp-01`, clinicians `dr-01` and `dr-02`, medical officer `mo-01`, and
`self-<patientId>` for women who start a case on their own phone.

## What is in it (seed 7)

81 cases and 920 events.

| status | cases |
|---|---|
| ready_for_review | 22 (11 of them carry blocking flags) |
| in_review | 14 (5 urgent by protocol: two severe Hb, recent fainting, breathlessness, soaking every 1–2 h with dizziness; also a decimal-corrected OCR reading and a history contradiction) |
| followup_pending | 15 (6 with overdue tasks) |
| closed | 13 |
| decided | 5 |
| reading_unverified | 5 |
| history_captured | 3 (self-started) |
| returned | 2 |
| conflict | 1 (two clinicians decided differently while offline) |
| draft | 1 |

Scenarios included:

- **Blocking flags:**
  - 3 × `HB_UNIT_SUSPECT` (a g/L value typed as g/dL, e.g. 105 g/dL)
  - 4 × `HISTORY_MISSING`
  - 3 × `CONSENT_GUARDIAN` (minors screened at school or camp without guardian consent)
  - 2 × `READING_REUSED` (the same photo hash on two women's cases; both cases are flagged)
- **Follow-up agent:** 6 overdue tasks lead to `ESCALATE` proposals, and to `MESSAGE_SEND`
  proposals where the woman has a phone and gave messaging consent. Of those proposals:
  - one escalation and its reminder were approved, and the reminder was sent as a WhatsApp
    **dry run** (`dryRun: true`);
  - one escalation was rejected by the ANM with a reason;
  - one escalation was approved by the MO;
  - the rest are pending.
  Two "waiting without review" escalations were also raised: a severe reading that was not
  submitted, and a moderate one left for 35 days.
- **Identity:** 3 pairs of the same person registered in Devanagari and in Latin script, with the
  same village and birth year (प्रिया कुमारी / Priya Kumari, सुनीता देवी / Sunita Devi,
  रेखा मांझी / Rekha Manjhi). For each pair the agent raises `DUPLICATE_SUSPECT` and proposes
  `PATIENTS_LINKED`. In one pair the ASHA approved the link, which then exposes an `HB_FALLING` trend
  across the two records.
- **Longitudinal:** 2 women each have 2 earlier cases with falling Hb (11.6 → 10.4 → 9.1 and
  10.9 → 9.6 → 8.3), linked by the same `patient.id`. One also shares an ABHA number across the
  cases. Their current cases show `HB_FALLING`.
- **Entry channels:** cases started by `asha`, `anm`, `nurse`, `school`, `camp` and `self`
  (including a WhatsApp channel). Some histories come from voice or free text in Hinglish or Hindi
  via the intake agent, with `originalText` kept.
- **Out of scope:** a pregnant woman, routed to ANC and closed.

## Deliberate rejections

The log contains exactly **2** events that the engine rejects, and both are intentional. They show
the guard working:

1. A worker tries `SUBMITTED_FOR_REVIEW` on a case with a blocking `HB_UNIT_SUSPECT` flag.
2. A school team tries `SUBMITTED_FOR_REVIEW` on a minor's case without guardian consent
   (`CONSENT_GUARDIAN` is blocking).

Their event ids are listed under `deliberateRejections` in `summary.json`. Any other rejection is a
bug: `npm run seed` exits non-zero, and `tests/learning.test.js` fails.
