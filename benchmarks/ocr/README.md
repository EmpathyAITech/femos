# FEMOS OCR benchmark

Measures how often on-device OCR proposes the right haemoglobin value from a photo of a meter
display, how often it declines (the worker types the value), and how often it proposes a wrong
value ("unsafe"). Synthetic images only. This is engineering evidence, not clinical evidence.

```
node benchmarks/ocr/gen.js              # 154 test images + 84 calibration images (deterministic)
node benchmarks/ocr/run.js --calibrate  # compare settings on the calibration set only
node benchmarks/ocr/run.js              # run the chosen settings on the test set → results/ocr.json
```

| File | What it is |
|---|---|
| `gen.js` | Draws displays as SVG, rasterises and degrades them with sharp. Seeded PRNG (test seed 20261109, calibration seed 7). |
| `images/`, `labels.json` | Test set: 14 conditions × 11 images. `truth` is `{value, unit}`, or `null` for error/blank screens. |
| `calib/` | Calibration set (other seed, 6 per condition). Settings are chosen here and never on the test set. |
| `preprocess.js` | Pure-JS preprocessing with no dependencies. The browser can import it as is. |
| `run.js` | OCR (tesseract.js, offline `eng` best_int), parsing (`core/ocr.js`), the agreement rule, and scoring. |
| `calibration.json` | Every configuration tried on the calibration set, and the one chosen. |
| `last-run.json` | Per-image details of the last test run: OCR text, words, each variant's status, outcome. |

## Preprocessing (mirror this in the browser)

Constants are in `PRE` in `preprocess.js`. Steps 2 to 6b are `preparePanel()`. The browser can
import that function and call it on canvas data. Only steps 1 and 7 need canvas code.

1. **Greyscale and resize.** Resize the photo to a width of **1200 px**, keeping the aspect
   ratio. Node uses sharp's default lanczos3. In the browser, use `drawImage` onto a
   1200-px-wide canvas with `imageSmoothingQuality = 'high'`. Convert to grey with
   Rec. 601 luma, `(299R + 587G + 114B) / 1000` (`rgbaToGrey()`).
   *Small difference:* sharp's `greyscale()` uses a slightly different luma. Results may differ
   on a few images, but the method is the same.
2. **Contrast stretch.** Map the 1st percentile to 0 and the 99th to 255, linearly (`stretch()`).
3. **Global Otsu threshold.** Pixels above T are "light" (`otsu()`).
4. **Find the display panel.** Take the largest 4-connected light region whose bounding box
   does not touch the photo border and that covers at least **4 %** of the photo
   (`components()`). If there is none, use the whole photo.
   *Why:* Tesseract returns **no text at all** when the LCD sits inside a dark bezel. Cropping
   to the panel fixes that.
5. **Crop** the stretched image to the panel's bounding box. Stretch it again, and run Otsu
   again inside the crop.
6. **Remove the frame.** Find every dark pixel connected to the crop border (bezel corners
   after rotation, the LCD frame) and paint it white (`borderDark()`).
   This gives two variants:
   - **A, "grey":** the cropped greyscale, frame painted white, stretched again.
   - **B, "binary":** the Otsu black/white crop, frame painted white.
   - *6b, off in the chosen configuration:* thicken B's dark strokes with a square min filter
     of radius 0.4 % of the crop width (`dilateDark()`).
7. **Resize and pad.** Resize each variant to a width of **700 px**, then add **40 px** of white
   on every side. Encode as PNG and pass it to Tesseract.

## Tesseract settings

`createWorker('eng', 1 /* LSTM */, { langPath: node_modules/@tesseract.js-data/eng/4.0.0_best_int, gzip: true, cacheMethod: 'none' })`,
with `tessedit_pageseg_mode = 6`, `user_defined_dpi = 300`, and **no** character whitelist.
`recognize(png, {}, { text: true, blocks: true })` returns the text, and the words (with their
confidence) come from `blocks → paragraphs → lines → words`.

These settings were chosen on the calibration set. The selection rule was fixed in advance:
fewest unsafe, then most correct, with ties going to the earlier entry in the grid. The grid
was output width {500, 700} × PSM {6, 11} × whitelist `0123456789.,gdLlmo/ %:-EHbM` {on, off} ×
dilation {off, on}. The whitelist did not help, and it lowered recall at PSM 6. All results are
in `calibration.json`.

## Agreement rule (a safety feature)

Each variant is parsed separately by `parseHbDisplay(text, { words })`. A value is proposed only if:

- **both variants** return `candidate` with the **same value**. The unit is kept only if both
  read the same unit. If only one read a unit, the unit is set to null and the worker selects
  it. If they read different units, the reading is rejected.
- **or exactly one variant** returns `candidate`, and the other returns `no_reading` (it found
  no plausible number and no number that has lost its decimal point), or `low_confidence`
  where every plausible number equals the candidate. The unit is kept only if the other
  variant read no unit or the same one.

Everything else is rejected, and the worker types the value. That covers different values,
`ambiguous`, `decimal_suspect` or `unit_conflict` next to a candidate, and no candidate at all.
On the test set, either variant alone would have proposed 8–9 wrong values. With the rule, 8
wrong values got through (see `results/ocr.json` → `singleVariant`). The rule's main catch is
the "dropped leading digit": one variant reads `13.8` and the other reads `1 3.8`, which the
parser turns into 3.8.

Outcome per image:
- **correct:** the proposed value equals the truth, and the unit equals the truth or is null.
- **rejected:** nothing was proposed. This is safe.
- **unsafe:** a wrong value was proposed, or any value on an error or blank screen.
