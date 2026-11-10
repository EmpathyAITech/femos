// FEMOS server: static hosting for site/app/console, idempotent event sync, server-side agents,
// and connectors. Node built-ins only. Synthetic data only: do not put real patient data here.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { reduce, reduceAll, makeEvent } from '../core/workflow.js';
import { settle, runAgents } from '../core/agents/index.js';
import { extractHistory } from '../core/agents/intake.js';
import { toBundle } from '../core/fhir.js';
import { toDhis2, ask, INTENT_IDS, places, summarise } from '../core/report.js';
import { render, t } from '../core/protocol.js';
import * as connectors from './connectors/index.js';
import { llmConfigured, llmInfo, llmExtract, llmPlanQuery } from './llm.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8765);
// Local: localhost only. On a platform (DigitalOcean App Platform, Render…) PORT is set and the
// health check comes from outside the container, so listen on all interfaces.
const HOST = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const pack = JSON.parse(readFileSync(join(ROOT, 'protocols/anemia-hmb/pack.json'), 'utf8'));
const FACILITY = process.env.FEMOS_FACILITY ?? 'PHC';

const demoFile = join(ROOT, 'data/demo/events.json');
const seed = process.env.FEMOS_DEMO !== '0' && existsSync(demoFile) ? JSON.parse(readFileSync(demoFile, 'utf8')) : [];
const store = new Store(join(ROOT, 'data/events.jsonl'), { seed });

const MOUNTS = [
  ['/vendor/tesseract/', join(ROOT, 'node_modules/tesseract.js/dist/')],
  ['/vendor/tesseract-core/', join(ROOT, 'node_modules/tesseract.js-core/')],
  ['/vendor/lang/', join(ROOT, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/')],
  ['/app/', join(ROOT, 'apps/field/')],
  ['/console/', join(ROOT, 'apps/console/')],
  ['/core/', join(ROOT, 'core/')],
  ['/protocols/', join(ROOT, 'protocols/')],
  ['/adapters/', join(ROOT, 'adapters/')],
  ['/demo/', join(ROOT, 'data/demo/')],
  ['/', join(ROOT, 'site/')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix) && pathname + '/' !== prefix) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length));
    let file = normalize(join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, 'forbidden');
    if (pathname + '/' === prefix) return send(res, 301, '', { location: prefix });
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      if (prefix === '/') continue;
      return send(res, 404, 'not found');
    }
    const ext = extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': prefix.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(file.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}),
    });
    return createReadStream(file).pipe(res);
  }
  send(res, 404, 'not found');
}

async function body(req, limit = 4e6) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

/** Run server-side agents for the cases touched by new events. */
function agentPass(caseIds) {
  const now = new Date().toISOString();
  for (const id of new Set(caseIds)) {
    const before = store.log.length;
    const log = settle(store.log, id, { pack, now, facility: FACILITY, device: 'server' });
    store.append(log.slice(before));
  }
}

let insightsCache = null;
async function insights() {
  if (insightsCache) return insightsCache;
  const f = join(ROOT, 'data/synthetic/longitudinal.json');
  const m = join(ROOT, 'learning/mine.js');
  if (!existsSync(f) || !existsSync(m)) return { available: false, reason: 'Run `npm run synth` to generate the synthetic longitudinal dataset.' };
  const { mineAll } = await import(m);
  const ds = JSON.parse(readFileSync(f, 'utf8'));
  const asOf = ds.meta?.periods?.at?.(-1) ?? undefined;
  const r = mineAll(ds, asOf ? { asOf } : {});
  const reg = existsSync(join(ROOT, 'learning/registry.json')) ? JSON.parse(readFileSync(join(ROOT, 'learning/registry.json'), 'utf8')) : null;
  insightsCache = { available: true, dataset: ds.meta, registry: reg, ...r, caveat: 'Synthetic longitudinal data with planted patterns. Findings are for human review only (shadow mode).' };
  return insightsCache;
}

const routes = {
  'GET /api/health': () => ({ ok: true, version: '0.1.0', events: store.cursor, protocol: `${pack.id}@${pack.version}`, llm: llmInfo(), connectors: connectors.config(), demo: seed.length > 0 }),

  'POST /api/sync': async (req) => {
    const b = await body(req);
    const incoming = Array.isArray(b.events) ? b.events.slice(0, 5000) : [];
    const added = store.append(incoming);
    if (added.length) agentPass(added.filter((e) => e.actor.role !== 'agent').map((e) => e.caseId));
    const cursor = Number(b.cursor) || 0;
    return { accepted: incoming.filter((e) => store.ids.has(e.id)).map((e) => e.id), cursor: store.cursor, events: store.since(cursor) };
  },

  'POST /api/agents/intake': async (req) => {
    const { text } = await body(req);
    const rules = extractHistory(text);
    if (!llmConfigured()) return { ...rules, mode: 'rules' };
    try {
      const llm = await llmExtract(text, pack);
      // Rules win on conflict; disagreements are surfaced for the worker.
      const disagreements = Object.keys(llm.answers).filter((k) => k in rules.answers && rules.answers[k] !== llm.answers[k]);
      const answers = { ...llm.answers, ...rules.answers };
      const spans = [...rules.spans, ...llm.spans.filter((s) => !(s.field in rules.answers))];
      return { answers, spans, disagreements, dropped: llm.dropped, language: rules.language, extractedBy: `${rules.extractedBy}+${llm.extractedBy}`, mode: 'rules+llm' };
    } catch (e) {
      return { ...rules, mode: 'rules', llmError: String(e.message ?? e) };
    }
  },

  'POST /api/ask': async (req) => {
    const { question } = await body(req);
    const states = reduceAll(store.log);
    let plan = null;
    if (llmConfigured()) {
      try { plan = await llmPlanQuery(question, INTENT_IDS, places(states)); } catch { plan = null; }
    }
    const r = ask(question, states, pack, new Date(), plan);
    return { ...r, rows: r.rows.slice(0, 200) };
  },

  'GET /api/insights': () => insights(),

  'GET /api/kpis': () => {
    const rows = reduceAll(store.log).map((s) => summarise(s, pack));
    const n = (f) => rows.filter(f).length;
    return {
      cases: rows.length,
      screened: n((r) => r.hb != null),
      bands: { none: n((r) => r.hbClass === 'none'), mild: n((r) => r.hbClass === 'mild'), moderate: n((r) => r.hbClass === 'moderate'), severe: n((r) => r.hbClass === 'severe') },
      hmb: n((r) => r.hmb),
      urgent: n((r) => r.urgent),
      inReview: n((r) => r.status === 'in_review'),
      referred: n((r) => r.referred),
      overdue: rows.reduce((m, r) => m + r.overdue, 0),
      entry: rows.reduce((m, r) => ((m[r.entry] = (m[r.entry] ?? 0) + 1), m), {}),
      byBlock: rows.reduce((m, r) => { const k = r.block ?? '—'; m[k] ??= { cases: 0, anaemia: 0, overdue: 0 }; m[k].cases++; if (r.hbClass && r.hbClass !== 'none') m[k].anaemia++; m[k].overdue += r.overdue; return m; }, {}),
    };
  },

  'GET /api/fhir': (req, url) => {
    const s = reduce(store.log, url.searchParams.get('caseId'));
    if (!s.openedAt) throw Object.assign(new Error('unknown case'), { status: 404 });
    return toBundle(s, pack);
  },

  'POST /api/connect/fhir': async (req) => {
    const { caseId } = await body(req);
    const s = reduce(store.log, caseId);
    if (!s.openedAt) throw Object.assign(new Error('unknown case'), { status: 404 });
    const bundle = toBundle(s, pack);
    const validation = [];
    if (connectors.config().fhir.live) for (const e of bundle.entry) validation.push({ type: e.resource.resourceType, ...(await connectors.validateFhir(e.resource)) });
    return { push: await connectors.pushFhir(bundle, caseId), validation, resources: bundle.entry.length };
  },

  'POST /api/connect/dhis2': async (req) => {
    const { period } = await body(req);
    const dvs = toDhis2(reduceAll(store.log), pack, { period, orgUnit: process.env.DHIS2_ORGUNIT ?? 'ORG_UNIT_UID' });
    return await connectors.pushDhis2(dvs);
  },

  'POST /api/messages/send': async (req) => {
    const { caseId, proposalId } = await body(req);
    const s = reduce(store.log, caseId);
    const p = s.proposals[proposalId];
    if (!p || p.action.type !== 'MESSAGE_SEND') throw Object.assign(new Error('no such message proposal'), { status: 404 });
    if (p.status !== 'approved') throw Object.assign(new Error('message not approved by a person'), { status: 409 });
    if (!s.consent.messaging) throw Object.assign(new Error('no messaging consent'), { status: 409 });
    if (s.messages[proposalId]?.status === 'sent') return { already: true, message: s.messages[proposalId] };
    const a = p.action.payload;
    const tplEnv = `WHATSAPP_TEMPLATE_${a.templateId.toUpperCase()}`;
    const params = a.params ? [a.params.name, a.params.facility, a.params.date] : [];
    const r = a.channel === 'rapidpro'
      ? await connectors.startRapidPro({ urn: `tel:${a.to}`, params: a.params ?? {} })
      : await connectors.sendWhatsApp({ to: a.to, templateName: process.env[tplEnv] ?? `femos_${a.templateId}`, language: a.language, params });
    if (r.live && !r.ok) return { sent: false, result: r };
    const e = makeEvent({ caseId, type: 'MESSAGE_SENT', actor: { id: 'femos-server', role: 'system' }, payload: { proposalId, channel: a.channel, providerId: r.providerId ?? null, dryRun: !r.live }, device: 'server' });
    store.append([e]);
    return { sent: true, dryRun: !r.live, result: r, event: e };
  },

  'GET /api/results': () => {
    const f = join(ROOT, 'site/assets/results.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { available: false };
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;
  try {
    if (routes[key]) return send(res, 200, await routes[key](req, url));
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    send(res, e.status ?? 500, { error: String(e.message ?? e) });
  }
});

// Periodic follow-up scan: overdue tasks and stalled cases → proposals for people to approve.
setInterval(() => {
  const ids = [...new Set(store.log.map((e) => e.caseId))];
  const now = new Date().toISOString();
  for (const id of ids) {
    const add = runAgents(store.log, id, { pack, now, facility: FACILITY, device: 'server' }).filter((e) => e.type === 'PROPOSAL_CREATED');
    if (add.length) store.append(add);
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  const c = connectors.config();
  console.log(`FEMOS 0.1.0  http://${HOST}:${PORT}`);
  console.log(`  site     /            field app /app/        console /console/`);
  console.log(`  events   ${store.cursor}${seed.length ? ` (${seed.length} synthetic demo events)` : ''}`);
  console.log(`  protocol ${pack.id}@${pack.version} [${pack.status}]`);
  console.log(`  llm      ${llmConfigured() ? `${llmInfo().model} @ ${llmInfo().base}` : 'none (rule-based agents)'}`);
  console.log(`  connect  fhir:${c.fhir.live ? 'live' : 'dry-run'} dhis2:${c.dhis2.live ? 'live' : 'dry-run'} whatsapp:${c.whatsapp.live ? 'live' : 'dry-run'} rapidpro:${c.rapidpro.live ? 'live' : 'dry-run'}`);
  console.log('  Synthetic data only. Not for clinical use.');
});
