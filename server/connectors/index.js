// Connectors to existing systems. Each runs LIVE only when its environment variables are set;
// otherwise it runs in DRY-RUN: the exact payload is written to data/outbox/ for inspection.
// FEMOS integrates with these systems; it does not host or replace them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTBOX = join(process.cwd(), 'data', 'outbox');
const env = (k) => process.env[k] ?? '';

function dry(kind, name, body) {
  const dir = join(OUTBOX, kind);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.json`);
  writeFileSync(file, JSON.stringify(body, null, 2));
  return { live: false, dryRun: true, file: file.replace(process.cwd() + '/', '') };
}

async function http(url, { method = 'POST', headers = {}, body, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, json, text: json ? undefined : text.slice(0, 500) };
  } finally {
    clearTimeout(t);
  }
}

export const config = () => ({
  fhir: { live: !!env('FEMOS_FHIR_BASE'), target: env('FEMOS_FHIR_BASE') || null, note: 'Any FHIR R4 server (HAPI, OpenSRP FHIR gateway, Google FHIR store)' },
  dhis2: { live: !!(env('DHIS2_BASE') && env('DHIS2_USER')), target: env('DHIS2_BASE') || null, orgUnit: env('DHIS2_ORGUNIT') || null },
  whatsapp: { live: !!(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID')), note: 'Meta WhatsApp Cloud API; business-initiated messages need approved templates' },
  rapidpro: { live: !!(env('RAPIDPRO_BASE') && env('RAPIDPRO_TOKEN')), target: env('RAPIDPRO_BASE') || null },
});

/** FHIR: POST a transaction bundle (PUT entries → idempotent). */
export async function pushFhir(bundle, name) {
  const base = env('FEMOS_FHIR_BASE');
  if (!base) return dry('fhir', name, bundle);
  const r = await http(base.replace(/\/$/, ''), { body: bundle, headers: { accept: 'application/fhir+json', 'content-type': 'application/fhir+json' } });
  return { live: true, ok: r.ok, status: r.status, response: r.json ?? r.text };
}

/** FHIR: server-side validation of one resource ($validate), when a server is configured. */
export async function validateFhir(resource) {
  const base = env('FEMOS_FHIR_BASE');
  if (!base) return { live: false, skipped: 'FEMOS_FHIR_BASE not set' };
  const r = await http(`${base.replace(/\/$/, '')}/${resource.resourceType}/$validate`, { body: resource, headers: { 'content-type': 'application/fhir+json' } });
  const issues = (r.json?.issue ?? []).filter((i) => ['error', 'fatal'].includes(i.severity));
  return { live: true, ok: r.ok && issues.length === 0, status: r.status, errors: issues.map((i) => i.diagnostics), warnings: (r.json?.issue ?? []).filter((i) => i.severity === 'warning').length };
}

/** DHIS2: aggregate dataValueSet. UIDs come from the programme's metadata mapping. */
export async function pushDhis2(dataValueSet) {
  const base = env('DHIS2_BASE');
  const { _meta, ...payload } = dataValueSet;
  if (env('DHIS2_ORGUNIT')) payload.orgUnit = env('DHIS2_ORGUNIT');
  if (!base || !env('DHIS2_USER')) return { ...dry('dhis2', `datavalueset-${payload.period}`, payload), payload };
  const auth = Buffer.from(`${env('DHIS2_USER')}:${env('DHIS2_PASS')}`).toString('base64');
  // dryRun=true asks DHIS2 to validate without importing unless DHIS2_IMPORT=1.
  const q = env('DHIS2_IMPORT') === '1' ? '' : '?dryRun=true';
  const r = await http(`${base.replace(/\/$/, '')}/api/dataValueSets${q}`, { body: payload, headers: { authorization: `Basic ${auth}` } });
  return { live: true, dhis2DryRun: q !== '', ok: r.ok, status: r.status, response: r.json?.response ?? r.json ?? r.text };
}

/** WhatsApp Cloud API: approved template message. Text is never free-form to the patient. */
export async function sendWhatsApp({ to, templateName, language = 'en', params = [] }) {
  const body = {
    messaging_product: 'whatsapp',
    to: String(to).replace(/[^\d]/g, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: ['hi', 'bn', 'mr', 'ta'].includes(language) ? language : 'en' }, // a template must be approved in each language
      ...(params.length ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }] } : {}),
    },
  };
  const token = env('WHATSAPP_TOKEN');
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneId) return { ...dry('whatsapp', templateName, body), payload: body };
  const v = env('WHATSAPP_API_VERSION') || 'v21.0';
  const r = await http(`https://graph.facebook.com/${v}/${phoneId}/messages`, { body, headers: { authorization: `Bearer ${token}` } });
  return { live: true, ok: r.ok, status: r.status, providerId: r.json?.messages?.[0]?.id ?? null, error: r.ok ? null : r.json?.error?.message ?? r.text };
}

/** RapidPro: start a flow for a contact (SMS/IVR/WhatsApp channels configured in RapidPro). */
export async function startRapidPro({ urn, flow, params = {} }) {
  const body = { flow: flow ?? env('RAPIDPRO_FLOW_UUID'), urns: [urn], params };
  if (!env('RAPIDPRO_BASE') || !env('RAPIDPRO_TOKEN')) return { ...dry('rapidpro', 'flow-start', body), payload: body };
  const r = await http(`${env('RAPIDPRO_BASE').replace(/\/$/, '')}/api/v2/flow_starts.json`, { body, headers: { authorization: `Token ${env('RAPIDPRO_TOKEN')}` } });
  return { live: true, ok: r.ok, status: r.status, response: r.json ?? r.text };
}
