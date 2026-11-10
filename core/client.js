// Browser client shared by the field app and the clinician console.
// Offline-first: every event is written to IndexedDB first, agents run locally on the device,
// and an outbox syncs to the server whenever there is a connection. Without a server
// ("standalone"), everything still works on the device.
import { normalise, reduce, reduceAll, now } from './workflow.js';
import { settle } from './agents/index.js';

const DB = 'femos';
const VERSION = 1;

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('events', { keyPath: 'id' });
      db.createObjectStore('outbox', { keyPath: 'id' });
      db.createObjectStore('meta');
      db.createObjectStore('blobs');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = (db, store, mode, fn) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
const all = (db, store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const get = (db, store, key) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function deviceId() {
  try {
    let id = localStorage.getItem('femos.device');
    if (!id) { id = `dev_${crypto.randomUUID().slice(0, 8)}`; localStorage.setItem('femos.device', id); }
    return id;
  } catch { return 'dev_ephemeral'; }
}

export async function openClient({ pack, base = '', onChange = () => {}, demo = 'auto' } = {}) {
  let db = null;
  try { db = await idb(); } catch { db = null; } // private mode: memory only
  let log = db ? normalise(await all(db, 'events')) : [];
  let outbox = new Set(db ? (await all(db, 'outbox')).map((o) => o.id) : []);
  let cursor = (db && (await get(db, 'meta', 'cursor'))) || 0;
  const status = { mode: 'starting', online: navigator.onLine, queued: outbox.size, lastSync: null, server: null, error: null };
  const device = deviceId();
  let syncing = null;

  const emit = () => onChange({ ...status, queued: outbox.size });

  async function persist(evs, { queue }) {
    if (!db) return;
    await tx(db, 'events', 'readwrite', (s) => evs.forEach((e) => s.put(e)));
    if (queue) await tx(db, 'outbox', 'readwrite', (s) => evs.forEach((e) => s.put({ id: e.id })));
  }

  async function merge(evs, { queue }) {
    const known = new Set(log.map((e) => e.id));
    const fresh = evs.filter((e) => !known.has(e.id));
    if (!fresh.length) return [];
    log = normalise(log.concat(fresh));
    await persist(fresh, { queue });
    if (queue) fresh.forEach((e) => outbox.add(e.id));
    return fresh;
  }

  /** Append human events, then let local agents react (flags, handoff, proposals). */
  async function append(events) {
    const evs = (Array.isArray(events) ? events : [events]).map((e) => ({ ...e, device: e.device === 'unknown' ? device : e.device }));
    await merge(evs, { queue: true });
    const cases = [...new Set(evs.map((e) => e.caseId))];
    for (const c of cases) {
      const before = new Set(log.map((e) => e.id));
      const after = settle(log, c, { pack, now: now(), device });
      await merge(after.filter((e) => !before.has(e.id)), { queue: true });
    }
    emit();
    sync().catch(() => {});
    return evs;
  }

  let lastProbe = 0;
  async function health() {
    // No server (static hosting): don't probe more than once a minute.
    if (status.mode === 'standalone' && Date.now() - lastProbe < 60000) return status.mode;
    lastProbe = Date.now();
    try {
      const r = await fetch(`${base}/api/health`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      status.server = await r.json();
      status.mode = 'server';
    } catch {
      status.server = null;
      status.mode = navigator.onLine ? 'standalone' : 'offline';
    }
    return status.mode;
  }

  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      if (!navigator.onLine) { status.mode = 'offline'; emit(); return; }
      if (status.mode !== 'server' && (await health()) !== 'server') { emit(); return; }
      const ids = [...outbox];
      const byId = new Map(log.map((e) => [e.id, e]));
      const send = ids.map((id) => byId.get(id)).filter(Boolean);
      try {
        const r = await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: send, cursor }) });
        if (!r.ok) throw new Error(`sync ${r.status}`);
        const j = await r.json();
        await merge(j.events, { queue: false });
        const acc = new Set(j.accepted);
        for (const id of ids) if (acc.has(id)) outbox.delete(id);
        if (db) await tx(db, 'outbox', 'readwrite', (s) => ids.filter((id) => acc.has(id)).forEach((id) => s.delete(id)));
        cursor = j.cursor;
        if (db) await tx(db, 'meta', 'readwrite', (s) => s.put(cursor, 'cursor'));
        status.lastSync = new Date().toISOString();
        status.error = null;
      } catch (e) {
        status.error = String(e.message ?? e);
        await health();
      }
      emit();
    })().finally(() => { syncing = null; });
    return syncing;
  }

  async function loadDemo() {
    try {
      const r = await fetch(`${base}/demo/events.json`);
      if (!r.ok) return 0;
      const evs = await r.json();
      const fresh = await merge(evs, { queue: false });
      emit();
      return fresh.length;
    } catch { return 0; }
  }

  async function putBlob(key, blob) { if (db) await tx(db, 'blobs', 'readwrite', (s) => s.put(blob, key)); }
  async function getBlob(key) { return db ? get(db, 'blobs', key) : null; }

  async function reset() {
    if (!db) { log = []; outbox.clear(); return; }
    for (const s of ['events', 'outbox', 'meta', 'blobs']) await tx(db, s, 'readwrite', (st) => st.clear());
    log = []; outbox.clear(); cursor = 0;
    emit();
  }

  window.addEventListener('online', () => { status.online = true; sync(); });
  window.addEventListener('offline', () => { status.online = false; status.mode = 'offline'; emit(); });
  setInterval(() => sync().catch(() => {}), 20000);

  await health();
  if (status.mode === 'server') await sync();
  else if (demo === 'auto' && !log.length) await loadDemo();
  emit();

  return {
    device,
    status: () => ({ ...status, queued: outbox.size }),
    events: () => log,
    state: (caseId) => reduce(log, caseId),
    states: () => reduceAll(log),
    append,
    sync,
    loadDemo,
    putBlob,
    getBlob,
    reset,
    api: async (path, init) => {
      const r = await fetch(`${base}${path}`, { headers: { 'content-type': 'application/json' }, ...init, body: init?.body ? JSON.stringify(init.body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
      return j;
    },
  };
}

/** SHA-256 of a Blob, hex. Used to detect the same photo attached to two patients. */
export async function sha256(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
