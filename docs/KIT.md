# FEMOS Kit

**Integration, not new hardware.** The FEMOS Kit is software, a printed setup and capture card and, only where a programme needs one, a validated device bought locally. FEMOS reads the haemoglobin meters, BP monitors and glucometers that clinics already use, by whichever route each device allows. It ships no proprietary sensor.

The registry of devices, capture modes and statuses is [adapters/registry.json](../adapters/registry.json). The field app, the website and this document all read from it.

## Capture modes

| Mode | Works with | How it stays safe | Status |
|---|---|---|---|
| **Camera** | Any device with a numeric display | Read on the phone. Two image variants must agree. A split digit, a second number, a labelled stored value, an unclear decimal or a low-confidence word means rejection. A person always compares the value with the screen. | Built. Tested on synthetic displays |
| **Bluetooth LE** | Devices that implement the Bluetooth SIG health profiles: Blood Pressure (0x1810), Glucose (0x1808), Health Thermometer (0x1809) | BP is captured as three separate values. Body movement or poor cuff fit means repeat. Control-solution glucose tests are rejected. | Parsers built and tested on specification byte vectors. Web Bluetooth test screen in the app. Not yet tested on real hardware |
| **USB / serial** | Only where the manufacturer documents and permits the protocol | Adapters are isolated per model | Planned |
| **Lab files** | CSV, HL7 v2, FHIR, supported PDFs | A person reconciles patient identity | Planned (lab-report photos use camera mode) |
| **Manual** | Anything | Typed twice; a mismatch blocks saving | Built |

## Kit options (planning estimates; confirm locally)

| Kit | Contents | Incremental cost (₹) |
|---|---|---|
| **Clinic BYOD** (recommended) | Existing phone and existing Hb meter, FEMOS app, printed card | 0 diagnostic hardware |
| Camera capture starter | Worker's phone, app, card, optional stand or glare shield | 0–1,000 |
| Community kit | Existing phone, low-cost Hb meter (validated first), starter consumables, sharps container, card | ≈5,500–10,000 |
| Reference-grade kit | Existing phone, HemoCue-class meter, cuvettes, QC material, card | ≈37,000–42,000+ |
| NCD add-on (next module) | Validated BP monitor, glucometer | ≈1,000–2,000 each |

Ongoing costs (strips or cuvettes, lancets, gloves, sharps disposal, QC, calibration, worker time) belong to the programme's budget. **Inventory a clinic's equipment before buying anything.**

## The capture card (printed, one page)

1. Clean, dry finger. Follow the device's own instructions for the sample. FEMOS does not change how the test is done.
2. Wait for the final result. Ignore memory, previous and average screens.
3. Photograph the screen straight on, filling the frame, with no glare and the whole number visible.
4. Compare the number FEMOS shows with the device screen. If anything differs, tap **Correct it**.
5. If FEMOS says it cannot read the screen, type the value twice.
6. Never photograph a patient's body. FEMOS reads instrument screens only.

## Validating a device (before it can be called "validated")

For each make, model and firmware version:

1. **Units and displays.** Record every screen the device can show: result, units, errors, memory, low battery, out of range. Write a display profile.
2. **Photo set.** At least 300 photos from 3 or more units and 3 or more phones, covering indoor, outdoor and low light, angles up to 20°, glare and a low battery. Label each photo with the true value, read by two people independently.
3. **Metrics.** Correct-read rate, rejection rate and the **unsafe rate (target 0, upper 95% confidence bound reported)**, reported by condition.
4. **Bluetooth (if applicable).** Pairing, bonding, record access, timestamps, units and repeated or duplicate records, on at least 2 units.
5. **Field check.** Run a supervised session with frontline workers and time it against manual transcription.
6. **Publish** the results and change the registry status. Re-validate after any firmware or app OCR change.

Being listed as validated means FEMOS reads that device's output reliably. It does **not** validate the device's clinical accuracy. That depends on the device's own regulatory approval and on the programme's procurement.
