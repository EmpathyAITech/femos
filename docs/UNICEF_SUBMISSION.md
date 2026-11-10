# UNICEF Femtech Ventures: application draft notes

**Deadline:** 11 November 2026, 11:59 p.m. CET (check the official form again).

**Before submitting, confirm eligibility.** The applicant must be a **for-profit company registered in a UNICEF programme country**, working with a functional prototype, committed to open source, and using AI, data science or similar technology. Women-led startups and founders under 35 are encouraged. A website or repository is not proof of company eligibility.

> **Rule for this document:** describe only what the repository shows. Everything listed as "built" below can be demonstrated, and every number comes from [RESULTS.md](RESULTS.md) (synthetic data, not clinical evidence).

## One line

FEMOS is an open-source, offline-first agentic layer that connects the devices, frontline workers, doctors, policies and public-health systems already in place, so that fewer women and girls are lost between screening, clinical review and follow-up.

## Problem (≈100 words)

India already has frontline workers, diagnostic devices, doctors and digital public-health platforms. Nothing connects them for a woman as she moves between home, community, clinic and district. Haemoglobin readings are copied by hand from device screens. Heavy menstrual bleeding is under-reported. Referrals are not tracked, and data is typed twice into government systems. NFHS-5 (2019–21) reports anaemia in 57.0% of women aged 15–49 and 59.1% of adolescent girls aged 15–19. *(Check these figures against the official report.)*

## Solution and what makes it different

- **It connects; it does not replace.** FEMOS integrates with OpenSRP and FHIR servers, DHIS2, RapidPro and WhatsApp. It is not another case-management app or chatbot.
- **Agents do the mechanical work, people decide.** A durable workflow engine owns the case state. Agents can only flag, draft and propose. The engine rejects any clinical decision or outbound message from an agent.
- **It works with whoever and whatever is available.** A case can be started by any role, including the woman herself. Readings can come from any device with a screen, connectivity can be anything, and the system works with or without a model.
- **Policy as cited data.** WHO, national programme and state rules live in versioned protocol packs.
- **Built for how women's care fails.** Shared phones (messages never name the condition), adolescent consent, under-reported symptoms, and women who can't reach a health worker.
- **Early detection across touchpoints.** One longitudinal record per woman, with governed pattern mining in shadow mode.
- **FEMOS Kit: integration, not new hardware.** A device registry with honest compatibility statuses.

Compared with the first Femtech cohort: Nurtura monitors vitals in maternity facilities; FEMOS reads existing instruments in the community and in clinics. FemHealth Data Collaborative builds a data ecosystem that FEMOS could feed. HLlama and DawaMom are patient-facing chat; FEMOS is a coordination layer for workers and clinicians.

## Prototype: what is built (demonstrable)

- Offline field app (PWA) and a clinician and supervisor console in **five languages** (English, Hindi, Bengali, Marathi, Tamil; draft translations pending native-speaker review), both tested end to end in Chrome. Intake understands all five, in native script, romanised and code-mixed; flags and clinician summaries are stored in every language; names match across scripts
- Workflow engine with an event log, approvals, conflict resolution and idempotent sync. 30 automated tests
- Six rule-based agents, plus a model-agnostic LLM adapter that uses open-weight models by default and only accepts grounded extractions
- Anaemia and heavy menstrual bleeding protocol pack, **draft and pending clinical review**
- On-device OCR of meter displays, with rejection of unclear readings
- FHIR R4 export; DHIS2, WhatsApp and RapidPro connectors, **tested in dry-run** (no live credentials yet)
- Device registry and Bluetooth health-profile parsers, **not yet tested on real hardware**
- Learning pipeline on synthetic longitudinal data

## Initial results (synthetic, from RESULTS.md)

- **Error detection:** 78 of 78 planted errors caught, against 6 of 78 for a plain form. 0 clean cases blocked. 7 non-blocking duplicate prompts.
- **OCR safety:** on a fresh held-out set, **0 wrong values proposed** across 154 images. Recall is low (30 of 154 read correctly), and the rest fall back to double-entry typing. The first parser version proposed 8 wrong values; we fixed those failure modes and re-measured on new images.
- **Early detection:** 47 of 120 planted haemoglobin declines flagged a median of 130 days before reaching the severe range (precision 58%). School, block, device and process patterns were detected.
- **Interoperability:** 425 of 425 FHIR resources are structurally valid against the HL7 R4 schema.

## What the funding pays for (next 6–12 months)

1. A clinician-approved protocol pack (India-based clinical advisors) and an ethics-approved supervised pilot with one NGO or PHC partner, plus one ASHA cluster
2. Validation on real devices for 2–3 common Hb meters, and an LCD/seven-segment-trained digit recogniser to raise OCR recall while keeping the unsafe rate at 0
3. A native Android app with encrypted storage, authentication and key management, plus ABHA/ABDM integration in the sandbox
4. An offline Hindi and Bengali speech-recognition evaluation, measuring clinical entity error rate
5. Live DHIS2, RapidPro and WhatsApp integration with the partner's instances

**Pilot measures:** transcription errors, case completeness, time to clinician decision, referral completion, and cost per completed care pathway.

## Open source

Apache-2.0 for original code. Dependencies are licence-checked. Model weights' terms are documented separately. Public repository: *(add URL)*.

## Do not claim

- Any UNICEF, WHO or government partnership or endorsement
- Pilots, users or clinical validation
- That any device is validated
- That speech recognition works offline
- That connectors are live
