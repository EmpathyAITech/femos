// FHIR R4 mapping. One case → a transaction Bundle of linked resources using PUT with stable
// logical ids, so re-syncing is idempotent. Provenance records who captured, who verified,
// and which agent assembled what.
import { toCanonical, classifyHb } from './protocol.js';

const fid = (x) => String(x).replace(/[^A-Za-z0-9\-.]/g, '-').slice(0, 64);
const BASE = 'https://femos.org/fhir';
export const ID_SYSTEMS = {
  femos: `${BASE}/sid/patient`,
  abha: 'https://healthid.abdm.gov.in',
  rch: 'https://rch.nhm.gov.in/id',
};

function patient(state) {
  const p = state.patient;
  return {
    resourceType: 'Patient',
    id: fid(p.id ?? `pt-${state.caseId}`),
    meta: { tag: [{ system: `${BASE}/tag`, code: 'synthetic', display: 'Synthetic test data' }] },
    identifier: [{ system: ID_SYSTEMS.femos, value: p.id ?? state.caseId }, ...(p.identifiers ?? []).map((i) => ({ system: ID_SYSTEMS[i.system] ?? i.system, value: i.value }))],
    name: [{ text: p.name }],
    gender: 'female',
    ...(p.birthYear ? { birthDate: String(p.birthYear) } : {}),
    ...(p.village ? { address: [{ city: p.village, district: p.district, state: p.state, country: 'IN', text: [p.village, p.block, p.district].filter(Boolean).join(', ') }] } : {}),
    communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: String(state.language ?? 'en').split('-')[0] }] }, preferred: true }],
  };
}

function practitioner(id, role) {
  // Logical reference by identifier: valid without a Practitioner resource on the server.
  return { identifier: { system: `${BASE}/sid/user`, value: String(id) }, display: `${role}:${id}` };
}

export function toBundle(state, pack, { now = new Date().toISOString() } = {}) {
  const pt = patient(state);
  const ptRef = { reference: `Patient/${pt.id}` };
  const encId = fid(`enc-${state.caseId}`);
  const entries = [];
  const put = (r) => entries.push({ fullUrl: `${BASE}/${r.resourceType}/${r.id}`, resource: r, request: { method: 'PUT', url: `${r.resourceType}/${r.id}` } });

  put(pt);
  const actors = new Map();
  const remember = (id, role) => id && !actors.has(id) && actors.set(id, role);

  put({
    resourceType: 'Encounter',
    id: encId,
    status: state.closed ? 'finished' : 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: state.entry?.role === 'self' ? 'VR' : ['clinician', 'nurse'].includes(state.entry?.role) ? 'AMB' : 'HH', display: state.entry?.role === 'self' ? 'virtual' : 'community' },
    subject: ptRef,
    period: { start: state.openedAt, ...(state.closed ? { end: state.updatedAt } : {}) },
    serviceType: { text: `FEMOS ${pack.id}@${pack.version}` },
  });

  const obsIds = [];
  for (const r of Object.values(state.readings)) {
    if (r.kind !== 'hb' || r.status !== 'verified') continue;
    const gdl = toCanonical(pack, 'hb', r.value, r.unit);
    if (gdl == null) continue;
    const age = Number(state.history?.answers?.ageYears);
    const c = Number.isFinite(age) ? classifyHb(pack, gdl, age) : null;
    const id = fid(`obs-${r.readingId}`);
    obsIds.push(id);
    remember(r.capturedBy, 'capture');
    remember(r.verifiedBy, 'verify');
    put({
      resourceType: 'Observation',
      id,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: pack.measurements.hb.loinc.code, display: pack.measurements.hb.loinc.display }], text: 'Haemoglobin' },
      subject: ptRef,
      encounter: { reference: `Encounter/${encId}` },
      effectiveDateTime: r.measuredAt ?? r.capturedAt,
      issued: r.verifiedAt,
      performer: [practitioner(r.capturedBy, 'capture')],
      valueQuantity: { value: gdl, unit: 'g/dL', system: 'http://unitsofmeasure.org', code: 'g/dL' },
      ...(c && c.cls !== 'none' ? { interpretation: [{ text: `WHO 2024 band: ${c.cls} (classification of the value, not a diagnosis)` }] } : {}),
      method: { text: `${r.method}${r.method === 'camera_ocr' ? ' + human visual verification' : ''}` },
      ...(r.device?.model ? { device: { display: [r.device.make, r.device.model].filter(Boolean).join(' ') } } : {}),
      note: [
        ...(r.unit !== 'g/dL' ? [{ text: `Displayed as ${r.value} ${r.unit}` }] : []),
        ...(r.correctedFrom != null ? [{ text: `Value corrected by verifier from ${r.correctedFrom}` }] : []),
      ],
    });
  }

  let qrId = null;
  if (state.history) {
    qrId = fid(`qr-${state.caseId}`);
    const items = pack.questionnaire.items
      .filter((i) => state.history.answers[i.linkId] !== undefined && state.history.answers[i.linkId] !== null && state.history.answers[i.linkId] !== '')
      .map((i) => {
        const v = state.history.answers[i.linkId];
        const answer = i.type === 'integer' ? { valueInteger: Number(v) } : i.type === 'boolean' ? { valueBoolean: !!v } : { valueString: String(v) };
        return { linkId: i.linkId, text: i.text.en, answer: [answer] };
      });
    remember(state.history.verifiedBy, 'verify');
    put({
      resourceType: 'QuestionnaireResponse',
      id: qrId,
      questionnaire: `${BASE}/Questionnaire/${pack.questionnaire.id}|${pack.version}`,
      status: state.history.verified ? 'completed' : 'in-progress',
      subject: ptRef,
      encounter: { reference: `Encounter/${encId}` },
      authored: state.history.at,
      source: state.entry?.role === 'self' ? ptRef : undefined,
      item: items,
    });
  }

  for (const t of Object.values(state.tasks)) {
    const id = fid(`task-${t.taskId}`);
    put({
      resourceType: 'Task',
      id,
      status: t.status === 'done' ? 'completed' : 'requested',
      intent: 'order',
      code: { text: t.kind },
      description: t.reason ?? t.note ?? t.kind,
      for: ptRef,
      encounter: { reference: `Encounter/${encId}` },
      authoredOn: t.createdAt,
      ...(t.doneAt ? { lastModified: t.doneAt } : { lastModified: t.createdAt }),
      ...(t.due ? { restriction: { period: { end: t.due } } } : {}),
      ...(t.assigneeRole ? { owner: { display: t.assigneeRole } } : {}),
    });
  }

  // Provenance: every resource → who/what produced it, with the event ids as the audit trail.
  const targets = entries.filter((e) => e.resource.resourceType !== 'Patient').map((e) => ({ reference: `${e.resource.resourceType}/${e.resource.id}` }));
  const agents = [
    ...[...actors.entries()].map(([id, role]) => ({
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: role === 'verify' ? 'verifier' : 'author' }] },
      who: practitioner(id, role),
    })),
    { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'assembler' }] }, who: { display: 'FEMOS 0.1.0 (agents: femos-check, femos-handoff)' } },
  ];
  if (state.decision) {
    agents.push({ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'attester' }] }, who: practitioner(state.decision.by, 'clinician') });
  }
  put({
    resourceType: 'Provenance',
    id: fid(`prov-${state.caseId}`),
    target: targets,
    recorded: now,
    policy: [`${BASE}/protocol/${pack.id}|${pack.version}`],
    agent: agents,
    entity: state.events.slice(0, 200).map((id) => ({ role: 'source', what: { identifier: { system: `${BASE}/sid/event`, value: id } } })),
  });

  return { resourceType: 'Bundle', type: 'transaction', timestamp: now, entry: entries };
}
