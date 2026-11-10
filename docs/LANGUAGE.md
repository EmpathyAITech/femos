# Languages in FEMOS

FEMOS ships in **English, Hindi (हिन्दी), Bengali (বাংলা), Marathi (मराठी) and Tamil (தமிழ்)**. That covers three scripts (Devanagari, Bengali, Tamil) and both of India's large language families.

> **All Indian-language text is a machine-assisted draft, pending native-speaker and clinical review.** Do not use it with patients until it has been reviewed.

## Language at every level

| Level | How it is adapted | Where it lives |
|---|---|---|
| Screens (field app, console, website) | Each user picks their own language; it is remembered on their device | `core/i18n/<lang>.js`, `site/assets/i18n/<lang>.js` |
| Questions she is asked | Every protocol question in all five languages | `protocols/anemia-hmb/i18n/<lang>.json`, merged into the pack |
| Her own words | Typed or dictated in any of the five languages, in native script or romanised, mixed with English. FEMOS extracts the answers and keeps her original words beside them. Silence is never recorded as "no" | `core/i18n/intake/<lang>.js` |
| Flags and clinician summaries | Stored in **every** language in the case log, so a case recorded in Tamil reads correctly for a clinician who reads Hindi, even offline | `core/agents/check.js`, `core/agents/handoff.js` |
| Messages to her | Sent in the language she chose at registration, using neutral templates that never name the condition (a test checks every language) | protocol pack `messages.templates` |
| Names | Matched across scripts: प्रिया = প্রিয়া = பிரியா = Priya | `core/identity.js` |
| Reports | The supervisor view and the computed numbers appear in the officer's language | console |

## Rules

1. **Never translate numbers or units.** Values like 11.4 g/dL are shown the same in every language.
2. **Keep the original.** Her words are stored as she said them, and translations are labelled.
3. **Clinical text needs clinical review** in each language before use.
4. **Fall back to English, never to blank.** A missing key shows English, and `tests/i18n.test.js` fails the build if any key is missing.

## Adding a language (for example Telugu, `te`)

1. Add an entry to `LANGS` in `core/i18n/index.js`, and create `core/i18n/te.js` with every key from `en.js`.
2. Create `protocols/anemia-hmb/i18n/te.json` with every path from `en.json`, then run `node scripts/i18n-pack.js`.
3. Create the intake lexicon `core/i18n/intake/te.js` and import it in `core/agents/intake.js`.
4. Create `site/assets/i18n/te.js` and add it to `site/index.html`, along with an option in the language selector.
5. Add the transliteration map to `core/identity.js` if the script is new, and the font to `core/ui/tokens.css`.
6. Add `tests/i18n-te.test.js` with real utterances. `npm test` and `node scripts/e2e-langs.js` must both pass.

## Not yet built

- **Speech recognition.** Voice notes are recorded, but the transcript is typed. Offline Hindi, Bengali, Marathi and Tamil speech recognition (sherpa-onnx or whisper.cpp) is on the funded roadmap. Its success measure will be the clinical entity error rate, not only word error rate.
- **WhatsApp templates.** Meta requires a template to be approved separately in each language.
