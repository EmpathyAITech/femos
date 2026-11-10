// Display-photo preprocessing for FEMOS OCR. Pure functions on 8-bit greyscale buffers, no
// dependencies, so the browser can run exactly the same code on canvas ImageData.
// Shared by the phone (apps/field/ocr.js) and the benchmark (benchmarks/ocr/run.js). See benchmarks/ocr/README.md for the step-by-step description.

export const PRE = Object.freeze({
  analysisWidth: 1200, // step 1: resize the photo to this width before anything else
  stretchLow: 0.01, // step 2: contrast stretch from the 1st ...
  stretchHigh: 0.99, //          ... to the 99th percentile
  minPanelFrac: 0.04, // step 4: a panel must cover >= 4% of the photo
  outWidth: 500, // step 7: the panel crop is resized to this width for OCR (chosen on the calibration set, parser v2)
  pad: 40, // step 7: white margin added on every side
  dilateFrac: 0.004, // optional step 6b: grow dark strokes of variant B by this fraction of the crop width
});

/** Grow dark (0) pixels of a 0/255 image by a square of radius r (separable min filter). */
export function dilateDark(bin, w, h, r) {
  if (r < 1) return bin;
  const tmp = new Uint8Array(bin.length), out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && m; k++) m = Math.min(m, bin[y * w + k]);
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && m; k++) m = Math.min(m, tmp[k * w + x]);
    out[y * w + x] = m;
  }
  return out;
}

/** Rec. 601 luma from RGBA (canvas ImageData layout). */
export function rgbaToGrey(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114 + 500) / 1000 | 0;
  return g;
}

/** Linear contrast stretch so the lo/hi percentiles map to 0/255. */
export function stretch(grey, lo = PRE.stretchLow, hi = PRE.stretchHigh) {
  const hist = new Uint32Array(256);
  for (const v of grey) hist[v]++;
  const n = grey.length;
  let acc = 0, a = 0, b = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * lo) { a = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * (1 - hi)) { b = i; break; } }
  const out = new Uint8Array(n);
  const span = Math.max(1, b - a);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round(((grey[i] - a) * 255) / span)));
  return out;
}

/** Otsu's threshold over a greyscale buffer. Pixels > T are "light". */
export function otsu(grey) {
  const hist = new Float64Array(256);
  for (const v of grey) hist[v]++;
  const n = grey.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, T = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; T = t; }
  }
  return T;
}

/**
 * 4-connected components of pixels where mask[i] === 1.
 * Returns [{area, x0, y0, x1, y1, touchesBorder, label}] and the label image.
 */
export function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    const label = ++next;
    let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = s;
    labels[s] = label;
    while (sp) {
      const i = stack[--sp];
      const x = i % w, y = (i - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = label; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = label; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = label; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = label; stack[sp++] = i + w; }
    }
    comps.push({ label, area, x0, y0, x1, y1, touchesBorder: x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1 });
  }
  return { comps, labels };
}

/** Mark every dark pixel (light[i] === 0) connected to the image border. */
export function borderDark(light, w, h) {
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i) => { if (!light[i] && !out[i]) { out[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  return out;
}

function crop(grey, w, box) {
  const cw = box.x1 - box.x0 + 1, ch = box.y1 - box.y0 + 1;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) out.set(grey.subarray((box.y0 + y) * w + box.x0, (box.y0 + y) * w + box.x0 + cw), y * cw);
  return { data: out, w: cw, h: ch };
}

/**
 * Steps 2–6 (step 1, the resize to PRE.analysisWidth, and step 7, the final resize + padding,
 * are done by the caller with sharp or canvas).
 * @param grey  Uint8Array greyscale image, w × h, already resized to PRE.analysisWidth
 * @returns {{panel: {x0,y0,x1,y1}|null, w:number, h:number, grey: Uint8Array, binary: Uint8Array}}
 *          two crops of the display panel with everything outside the panel painted white:
 *          `grey` (contrast-stretched greyscale) and `binary` (Otsu black/white).
 */
export function preparePanel(grey, w, h, { dilate = false } = {}) {
  // 2. contrast stretch
  const s = stretch(grey);
  // 3. global Otsu split into light / dark
  const T = otsu(s);
  const light = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) light[i] = s[i] > T ? 1 : 0;
  // 4. the display panel = largest light region that does not touch the photo border
  const { comps } = components(light, w, h);
  const inner = comps.filter((c) => !c.touchesBorder && c.area >= PRE.minPanelFrac * w * h).sort((a, b) => b.area - a.area);
  const panel = inner[0] ?? null;
  const box = panel ? { x0: panel.x0, y0: panel.y0, x1: panel.x1, y1: panel.y1 } : { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  // 5. crop to the panel's bounding box, re-stretch and re-threshold inside it
  const c = crop(s, w, box);
  const cs = stretch(c.data);
  const T2 = otsu(cs);
  const cl = new Uint8Array(cs.length);
  for (let i = 0; i < cs.length; i++) cl[i] = cs[i] > T2 ? 1 : 0;
  // 6. paint dark pixels connected to the crop border (bezel corners, frame) white
  const outside = borderDark(cl, c.w, c.h);
  const g = new Uint8Array(cs.length), b = new Uint8Array(cs.length);
  for (let i = 0; i < cs.length; i++) {
    g[i] = outside[i] ? 255 : cs[i];
    b[i] = outside[i] || cl[i] ? 255 : 0;
  }
  // 6b (optional): thicken strokes in the binary variant so seven-segment gaps close
  const bin = dilate ? dilateDark(b, c.w, c.h, Math.round(c.w * PRE.dilateFrac)) : b;
  return { panel: panel ? box : null, w: c.w, h: c.h, grey: stretch(g), binary: bin };
}
