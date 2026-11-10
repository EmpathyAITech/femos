// On-device OCR for instrument displays. Runs entirely in the browser (tesseract.js + WASM);
// the photo never leaves the phone. This is the SAME pipeline the benchmark measures
// (benchmarks/ocr/run.js): shared preprocessing (core/ocr-preprocess.js), two variants,
// the shared agreement rule (core/ocr.js combineVariants), PSM 6, no whitelist.
import { parseHbDisplay, combineVariants } from '/core/ocr.js';
import { PRE, preparePanel } from '/core/ocr-preprocess.js';

let workerP = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('OCR engine not available offline yet'));
    document.head.appendChild(s);
  });
}

export async function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript('/vendor/tesseract/tesseract.min.js');
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract-core/',
        langPath: '/vendor/lang',
        gzip: true,
        logger: (m) => onProgress?.(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: '6', user_defined_dpi: '300' });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

async function toBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  return img;
}

/** Step 1 (canvas): resize to analysis width, greyscale (299R+587G+114B)/1000. */
async function greyscale(file) {
  const bmp = await toBitmap(file);
  const w = PRE.analysisWidth;
  const h = Math.round((bmp.height * w) / bmp.width);
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const grey = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) grey[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return { grey, w, h };
}

/** Step 7 (canvas): resize a variant to the OCR width and pad with white. */
function toCanvas(buf, w, h) {
  const src = new OffscreenCanvas(w, h);
  const sg = src.getContext('2d');
  const img = sg.createImageData(w, h);
  for (let j = 0; j < buf.length; j++) { const v = buf[j]; img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = v; img.data[j * 4 + 3] = 255; }
  sg.putImageData(img, 0, 0);
  const ow = PRE.outWidth;
  const oh = Math.round((h * ow) / w);
  const out = document.createElement('canvas');
  out.width = ow + 2 * PRE.pad;
  out.height = oh + 2 * PRE.pad;
  const og = out.getContext('2d');
  og.fillStyle = '#fff';
  og.fillRect(0, 0, out.width, out.height);
  og.drawImage(src, PRE.pad, PRE.pad, ow, oh);
  return out;
}

function wordsOf(data) {
  const out = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) out.push({ text: w.text, confidence: w.confidence, h: w.bbox.y1 - w.bbox.y0 });
  return out;
}

/** OCR a photo of a device display and parse it conservatively. */
export async function readDisplay(file, onProgress) {
  const t0 = performance.now();
  const w = await getWorker(onProgress);
  const { grey, w: gw, h: gh } = await greyscale(file);
  const p = preparePanel(grey, gw, gh, { dilate: true }); // same config as benchmarks/ocr/run.js CONFIG
  const per = [];
  let text = '';
  for (const [name, buf] of [['grey', p.grey], ['binary', p.binary]]) {
    const { data } = await w.recognize(toCanvas(buf, p.w, p.h), {}, { text: true, blocks: true });
    per.push(parseHbDisplay(data.text, { words: wordsOf(data) }));
    text += `[${name}] ${data.text.trim()}\n`;
  }
  const final = combineVariants(per[0], per[1]);
  return { ...final, text, panelFound: !!p.panel, ms: Math.round(performance.now() - t0), engine: 'tesseract.js on-device · 2-variant agreement' };
}
