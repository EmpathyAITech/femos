# Contributing to FEMOS

Thank you for helping. FEMOS touches women's health, so some rules here are stricter than usual.

## Ground rules

1. **Synthetic data only.** Never commit or attach real patient data, photos, audio or identifiers.
2. **No clinical logic in code.** Thresholds, danger signs and schedules belong in a protocol pack (`protocols/`), with a citation. Pull requests that hard-code clinical numbers will be declined.
3. **Agents propose, people decide.** A new agent may emit `FLAGS_RAISED`, `HANDOFF_PREPARED` or `PROPOSAL_CREATED` events and nothing else. Add a test proving that the engine rejects anything more.
4. **Never guess a reading.** OCR and device changes must keep the unsafe rate on the held-out set at 0. Choose settings on the calibration set only, then report the held-out numbers once.
5. **Report results as they are.** Benchmarks are run, not tuned to the test set. If a number gets worse, say so in the PR.

## Development

```bash
npm ci && npm run synth && npm run seed
npm test        # must pass
npm run e2e     # if you touched the UI (needs Chrome)
npm run results # if you touched OCR, checks or learning
```

Code style: ES modules, no build step, and minimal dependencies. Every dependency needs a licence check.

## Adding a device to the FEMOS Kit

See [docs/KIT.md](docs/KIT.md). A device moves to `validated` only after the validation protocol has been run on physical units and the results are published.

## Translations

Hindi strings are in `core/i18n.js`, `site/assets/site.js` and the protocol packs. All current Hindi is a **machine-assisted draft**. Native-speaker review is very welcome. Clinical text must be reviewed by a clinician fluent in the language.
