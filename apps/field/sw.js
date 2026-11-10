// Offline service worker: caches the app shell, shared core, protocol pack and the OCR engine,
// so capture, checks and handoff all work with no network. API calls are never cached.
const VERSION = 'femos-field-v4';
const SHELL = [
  '/app/', '/app/index.html', '/app/app.css', '/app/app.js', '/app/ocr.js', '/app/manifest.webmanifest', '/app/icon.svg',
  '/core/ui/tokens.css', '/core/workflow.js', '/core/protocol.js', '/core/ocr.js', '/core/identity.js', '/core/fhir.js',
  '/core/report.js', '/core/client.js', '/core/i18n.js', '/core/i18n/index.js', '/core/i18n/en.js', '/core/i18n/hi.js', '/core/i18n/bn.js', '/core/i18n/mr.js', '/core/i18n/ta.js', '/core/i18n/intake/en.js', '/core/i18n/intake/hi.js', '/core/i18n/intake/bn.js', '/core/i18n/intake/mr.js', '/core/i18n/intake/ta.js', '/core/agents/index.js', '/core/agents/check.js',
  '/core/agents/handoff.js', '/core/agents/intake.js', '/core/agents/followup.js', '/core/devices.js', '/core/ocr-preprocess.js',
  '/protocols/anemia-hmb/pack.json', '/adapters/registry.json',
];
const ENGINE = [
  '/vendor/tesseract/tesseract.min.js', '/vendor/tesseract/worker.min.js',
  '/vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js', '/vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  '/vendor/lang/eng.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    // The OCR engine is large; cache it but don't fail install if one variant is missing.
    await Promise.all(ENGINE.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network-first for app code (so updates arrive), cache fallback offline; cache-first for the engine.
  const engine = url.pathname.startsWith('/vendor/');
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    if (engine) {
      const hit = await c.match(e.request);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) ?? (url.pathname.startsWith('/app') ? c.match('/app/index.html') : Response.error());
    }
  })());
});
