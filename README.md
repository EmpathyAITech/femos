# FEMOS

**The agentic operating layer for last-mile women's healthcare.** FEMOS is open source and works offline first. It connects the diagnostic devices, frontline workers, doctors, policies and public-health systems that already exist. AI agents do the mechanical work, people make the decisions, and fewer women are lost between screening, clinical review and follow-up.

> **Engineering prototype. Synthetic data only. Not a medical device. Not for patient care.**
> FEMOS is independent and is not affiliated with or endorsed by UNICEF, WHO or the Government of India.

The first protocol pack covers **anaemia and heavy menstrual bleeding** in adolescent girls and women in India. The platform itself is not tied to any one condition: each new condition is a new protocol pack, not a new app.

## Quick start

```bash
npm ci                 # Node ≥ 20. No native build steps.
npm run synth          # synthetic longitudinal dataset (3,000 women, 24 months)
npm run seed           # synthetic demo event log (81 cases)
npm start              # http://127.0.0.1:8765
```

| URL | What it is |
|---|---|
| `/` | Website |
| `/app/` | **Field app**, an installable offline web app (PWA). Any role can start a case: ASHA, ANM, nurse, school team, NGO worker, camp, or the woman herself. |
| `/console/` | **Clinician and supervisor console**: review queue, decisions, agent proposals, follow-up, insights, DHIS2 and FHIR |

```bash
npm test               # 30 unit tests (engine, safety guards, OCR parser, intake, identity, FHIR, devices, learning, benchmarks)
npm run e2e            # drives the field app and console in real Chrome (needs Google Chrome)
npm run results        # merges all benchmarks → docs/RESULTS.md and site/assets/results.json
npm run build:static   # public/: static site + apps in standalone mode (DigitalOcean App Platform)
```

## What is built

| Part | Status |
|---|---|
| **Workflow engine** ([core/workflow.js](core/workflow.js)): an append-only event log; the case state is a pure function of the log; role permissions; proposals and approvals; conflict detection; sync is idempotent | Built and tested |
| **Agents** ([core/agents/](core/agents/)): **intake** (English, Hindi, Bengali, Marathi and Tamil text, in native script, romanised or mixed with English, turned into fields with the source quote for each), **check** (14 error and signal types), **handoff** (each line linked to its source events), **follow-up** (escalations and neutral reminders, proposed only), **connect** (identity matching across scripts, FHIR mapping), **supervisor** (deterministic queries) | Built as rule-based baselines. An LLM adapter ([server/llm.js](server/llm.js)) works with any OpenAI-compatible model, defaults to open weights, and requires every extraction to quote the input verbatim |
| **Protocol pack** ([protocols/anemia-hmb/pack.json](protocols/anemia-hmb/pack.json)): WHO 2024 Hb cut-offs, heavy menstrual bleeding indicators, danger signs, follow-up rules, DPDP consent, neutral message templates. Every rule is cited | **Draft. Not yet reviewed by a clinician** |
| **On-device OCR** of meter displays ([apps/field/ocr.js](apps/field/ocr.js)): the same pipeline as the benchmark, with a rule that two image variants must agree | Built. Recall is low (see results), and it proposed 0 wrong values on the held-out set |
| **FEMOS Kit**: device registry ([adapters/registry.json](adapters/registry.json)) and Bluetooth health-profile parsers ([core/devices.js](core/devices.js)) | Built. Tested on synthetic images and specification byte vectors. **No device has been validated on real hardware yet** |
| **Field app** (PWA, offline) and **console**, in **English, हिन्दी, বাংলা, मराठी, தமிழ்** | Built, with end-to-end tests in Chrome, including a check that every language renders in its own script ([docs/LANGUAGE.md](docs/LANGUAGE.md)). Indian-language text is a machine-assisted draft pending native-speaker review |
| **Interoperability**: FHIR R4 (PUT bundles, so re-sync is idempotent), DHIS2 dataValueSets, WhatsApp Cloud API templates, RapidPro flow starts | Built. Connectors run in **dry-run** until credentials are configured. FHIR output validates against the HL7 R4 JSON Schema |
| **Learning module** ([learning/](learning/)): governed pattern mining at individual, school, village, block, device and process level, in shadow mode | Built. Evaluated on synthetic data with planted patterns |

**Not built yet (next):** native Android app, offline Hindi and Bengali speech recognition, validation on real devices, ABHA/ABDM integration, clinician-approved pathways, authentication and key management, and a field pilot under ethics approval.

## Results (synthetic, not clinical evidence)

See [docs/RESULTS.md](docs/RESULTS.md) for method, caveats and every number.

- **Error checks:** 78 of 78 planted errors caught. A plain form would catch 6 of 78. All 42 errors that should block submission did. 7 false alarms, all non-blocking "possible duplicate" prompts.
- **OCR, held-out set:** 30 of 154 displays read correctly, **0 wrong values proposed**. The other 124 were declined, so the worker typed the value. v1 proposed 8 wrong values on its own test set; the failure modes were fixed and re-measured on fresh images.
- **Early detection:** 47 of 120 planted haemoglobin declines were flagged before reaching the severe range, a median of 130 days earlier. School, block, device and process patterns were found with few false alarms.
- **FHIR:** 425 of 425 resources are structurally valid against the HL7 R4 schema.

## Design principles

1. **Agents propose, people decide.** Agents can only emit flags, drafts and proposals. The engine rejects any clinical decision, reading verification or outbound message from an agent ([tests](tests/core.test.js)).
2. **Clinical logic lives in cited, versioned protocol packs**, not in a model. Numbers shown to supervisors are computed, never generated.
3. **Readings are never guessed.** An unclear decimal, a unit mismatch or a second number on the screen means rejection and typed entry.
4. **Works with what is there.** Any role, any device that can be photographed, any connectivity, any FHIR server, any model, or none.
5. **Privacy by default.** Messages never name the condition, minors need guardian consent plus their own assent, photos stay on the phone, and real patient data never goes on this stack.

## Repository map

```text
core/         engine, agents, protocol evaluator, OCR parser + preprocessing, identity, FHIR, devices, reports, i18n, browser client
protocols/    protocol packs (cited JSON)
adapters/     FEMOS Kit device registry
apps/field/   field PWA       apps/console/  clinician & supervisor console
server/       Node server: static hosting, sync, server-side agents, connectors, LLM adapter
learning/     synthetic generator, pattern miner, evaluation, model registry
benchmarks/   OCR (calibration / test / held-out), planted-error checks, FHIR schema validation
site/         website         docs/  results, kit, deployment, language, submission notes
```

## Licence

[Apache-2.0](LICENSE) for original code. Third-party components keep their own licences: tesseract.js (Apache-2.0), the Tesseract eng traineddata (Apache-2.0), puppeteer-core, sharp and ajv (dev only). Any LLM's weights have their own terms; check them before redistribution. See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
