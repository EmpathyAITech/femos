// FEMOS workflow engine.
// The engine — not any AI agent — owns case state. State is a pure function of an
// append-only event log, so phone and server compute identical state from the same events.
// Agents may only emit proposals, flags and drafts; humans approve anything with consequences.

export const ROLES = ['self', 'asha', 'anm', 'nurse', 'school', 'ngo', 'camp', 'clinician', 'medical_officer', 'agent', 'system'];
export const WORKER_ROLES = ['asha', 'anm', 'nurse', 'school', 'ngo', 'camp'];
export const HUMAN_ROLES = ROLES.filter((r) => r !== 'agent' && r !== 'system');
const CLINICAL = ['clinician', 'medical_officer'];
const CAPTURE = [...WORKER_ROLES, 'self', ...CLINICAL];

// Which roles may append which event types. Anything not listed is rejected.
export const PERMISSIONS = {
  CASE_OPENED: CAPTURE,
  CONSENT_RECORDED: CAPTURE,
  HISTORY_SUBMITTED: [...CAPTURE],
  HISTORY_VERIFIED: [...WORKER_ROLES, ...CLINICAL, 'self'], // self: she confirms her own answers
  READING_CAPTURED: [...CAPTURE],
  READING_VERIFIED: [...WORKER_ROLES, ...CLINICAL, 'self'],
  READING_REJECTED: [...WORKER_ROLES, ...CLINICAL, 'self'],
  FLAGS_RAISED: ['agent', 'system'],
  HANDOFF_PREPARED: ['agent', 'system'],
  SUBMITTED_FOR_REVIEW: [...CAPTURE],
  CLINICIAN_DECISION: CLINICAL,
  TASK_CREATED: [...CLINICAL, ...WORKER_ROLES],
  TASK_COMPLETED: [...WORKER_ROLES, ...CLINICAL, 'self'],
  MESSAGE_SENT: ['system'],
  PATIENTS_LINKED: [...WORKER_ROLES, ...CLINICAL],
  CONFLICT_RESOLVED: CLINICAL,
  CASE_CLOSED: CLINICAL,
  PROPOSAL_CREATED: ['agent', 'system', ...HUMAN_ROLES],
  PROPOSAL_APPROVED: HUMAN_ROLES,
  PROPOSAL_REJECTED: HUMAN_ROLES,
  NOTE_ADDED: [...HUMAN_ROLES, 'agent'],
};

// Actions an approved proposal may execute, and who may approve them.
export const PROPOSABLE = {
  TASK_CREATED: [...CLINICAL, ...WORKER_ROLES],
  MESSAGE_SEND: [...CLINICAL, 'anm', 'asha'],
  PATIENTS_LINKED: [...WORKER_ROLES, ...CLINICAL],
  ESCALATE: [...CLINICAL, 'anm'],
  RETAKE_PHOTO: [...CAPTURE],
  HISTORY_FIELDS: [...CAPTURE],
};

import { all as i18nAll } from './i18n/index.js';
export const STATUS = Object.fromEntries(
  ['draft', 'history_captured', 'reading_unverified', 'ready_for_review', 'in_review', 'returned', 'followup_pending', 'decided', 'conflict', 'closed'].map((k) => [k, i18nAll(`status.${k}`)]),
);

export const uid = (prefix = 'e') =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 20)}`;

// Monotonic clock: events created on one device never share or reverse a timestamp, so a
// batch like [HISTORY_SUBMITTED, HISTORY_VERIFIED] always keeps its causal order.
let lastMs = 0;
export function now() {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  return new Date(ms).toISOString();
}

/** Create a well-formed event. `at` defaults to the monotonic now(). */
export function makeEvent({ caseId, type, actor, payload = {}, at, device = 'unknown', protocol, causedBy, id }) {
  if (!caseId) throw new Error('caseId required');
  if (!PERMISSIONS[type]) throw new Error(`unknown event type ${type}`);
  if (!actor?.id || !actor?.role) throw new Error('actor {id, role} required');
  return {
    id: id ?? uid('e'),
    caseId,
    type,
    at: at ?? now(),
    actor: { id: actor.id, role: actor.role, ...(actor.name ? { name: actor.name } : {}) },
    device,
    ...(protocol ? { protocol } : {}),
    ...(causedBy ? { causedBy } : {}),
    payload,
  };
}

/** Deterministic total order: timestamp, then id. */
export const order = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Dedupe by id (idempotent sync) and sort. If two copies of one id differ (the same
 * deterministic proposal made on two devices), the earliest wins on every device.
 */
export function normalise(events) {
  const seen = new Map();
  for (const e of events) {
    const prev = seen.get(e.id);
    if (!prev || e.at < prev.at || (e.at === prev.at && JSON.stringify(e) < JSON.stringify(prev))) seen.set(e.id, e);
  }
  return [...seen.values()].sort(order);
}

function empty(caseId) {
  return {
    caseId,
    patient: null,
    entry: null,
    language: 'en',
    protocol: null,
    consent: { care: false, messaging: false, learning: false, by: null, assent: null },
    history: null,
    readings: {},
    flags: [],
    handoff: null,
    review: null,
    decision: null,
    decisions: [],
    tasks: {},
    messages: {},
    proposals: {},
    links: [],
    conflicts: [],
    notes: [],
    rejected: [],
    events: [],
    openedAt: null,
    updatedAt: null,
    closed: false,
    status: 'draft',
  };
}

/** Why an event cannot be applied to the current state, or null if it can. */
export function guard(s, e) {
  const allowed = PERMISSIONS[e.type];
  if (!allowed) return `unknown event type ${e.type}`;
  if (!allowed.includes(e.actor?.role)) return `role ${e.actor?.role} may not ${e.type}`;
  if (e.type !== 'CASE_OPENED' && !s.openedAt) return 'case not opened';
  if (e.type === 'CASE_OPENED' && s.openedAt) return 'case already opened';
  if (s.closed && !['NOTE_ADDED'].includes(e.type)) return 'case closed';
  const p = e.payload ?? {};
  switch (e.type) {
    case 'READING_VERIFIED':
    case 'READING_REJECTED':
      if (!s.readings[p.readingId]) return 'unknown reading';
      if (s.readings[p.readingId].status !== 'unverified') return 'reading already resolved';
      return null;
    case 'HISTORY_VERIFIED':
      return s.history ? null : 'no history to verify';
    case 'SUBMITTED_FOR_REVIEW':
      if (s.status !== 'ready_for_review' && s.status !== 'returned') return `cannot submit from ${s.status}`;
      if (!s.history?.verified) return 'history not verified';
      if (!Object.values(s.readings).some((r) => r.status === 'verified')) return 'no verified reading';
      if (s.flags.some((f) => f.blocking)) return `blocking flags: ${s.flags.filter((f) => f.blocking).map((f) => f.code).join(', ')}`;
      return null;
    case 'CLINICIAN_DECISION':
      if (!s.review || s.review.decidedBy) {
        // A second decision for the same review is a conflict, not silently dropped.
        if (s.review?.decidedBy && s.review.decidedBy !== e.actor.id) return null;
        return 'no open review';
      }
      if (!['refer', 'manage_locally', 'return_for_info', 'close'].includes(p.decision)) return 'invalid decision';
      return null;
    case 'TASK_COMPLETED':
      if (!s.tasks[p.taskId]) return 'unknown task';
      if (s.tasks[p.taskId].status === 'done') return 'task already done';
      return null;
    case 'PROPOSAL_APPROVED':
    case 'PROPOSAL_REJECTED': {
      const pr = s.proposals[p.proposalId];
      if (!pr) return 'unknown proposal';
      if (pr.status !== 'pending') return 'proposal already resolved';
      if (e.type === 'PROPOSAL_APPROVED') {
        const approvers = PROPOSABLE[pr.action.type] ?? [];
        if (!approvers.includes(e.actor.role)) return `role ${e.actor.role} may not approve ${pr.action.type}`;
      }
      return null;
    }
    case 'MESSAGE_SENT': {
      const pr = s.proposals[p.proposalId];
      if (!pr || pr.status !== 'approved' || pr.action.type !== 'MESSAGE_SEND') return 'message not approved';
      if (!s.consent.messaging) return 'no messaging consent';
      return null;
    }
    case 'CONFLICT_RESOLVED':
      return s.conflicts.some((c) => c.id === p.conflictId && !c.resolved) ? null : 'unknown conflict';
    case 'PROPOSAL_CREATED':
      if (!PROPOSABLE[p.action?.type]) return `action ${p.action?.type} is not proposable`;
      return null;
    default:
      return null;
  }
}

function applyOne(s, e) {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'CASE_OPENED':
      s.patient = p.patient;
      s.entry = { role: e.actor.role, by: e.actor.id, channel: p.channel ?? 'app' };
      s.language = p.language ?? 'en';
      s.protocol = e.protocol ?? null;
      s.openedAt = e.at;
      break;
    case 'CONSENT_RECORDED':
      s.consent = { ...s.consent, ...p, at: e.at, recordedBy: e.actor.id };
      break;
    case 'HISTORY_SUBMITTED':
      s.history = {
        answers: { ...(s.history?.answers ?? {}), ...p.answers },
        source: p.source ?? 'form',
        originalText: p.originalText ?? s.history?.originalText ?? null,
        language: p.language ?? s.language,
        extractedBy: p.extractedBy ?? null,
        verified: false,
        eventId: e.id,
        at: e.at,
      };
      break;
    case 'HISTORY_VERIFIED':
      s.history.verified = true;
      s.history.verifiedBy = e.actor.id;
      s.history.verifiedAt = e.at;
      break;
    case 'READING_CAPTURED':
      s.readings[p.readingId] = { ...p, status: 'unverified', capturedBy: e.actor.id, capturedAt: e.at, eventId: e.id };
      break;
    case 'READING_VERIFIED':
      Object.assign(s.readings[p.readingId], {
        status: 'verified',
        value: p.value,
        unit: p.unit,
        correctedFrom: p.value !== s.readings[p.readingId].value || p.unit !== s.readings[p.readingId].unit ? s.readings[p.readingId].value : undefined,
        correctedFromUnit: p.value !== s.readings[p.readingId].value || p.unit !== s.readings[p.readingId].unit ? s.readings[p.readingId].unit : undefined,
        verifiedBy: e.actor.id,
        verifiedAt: e.at,
        verifyEventId: e.id,
      });
      break;
    case 'READING_REJECTED':
      Object.assign(s.readings[p.readingId], { status: 'rejected', rejectReason: p.reason, verifiedBy: e.actor.id, verifiedAt: e.at });
      break;
    case 'FLAGS_RAISED':
      s.flags = p.flags ?? [];
      s.flagsAt = e.at;
      break;
    case 'HANDOFF_PREPARED':
      s.handoff = { ...p, at: e.at, eventId: e.id };
      break;
    case 'SUBMITTED_FOR_REVIEW':
      s.review = { submittedAt: e.at, submittedBy: e.actor.id, eventId: e.id };
      break;
    case 'CLINICIAN_DECISION': {
      if (s.review?.decidedBy && s.review.decidedBy !== e.actor.id) {
        s.conflicts.push({ id: `c_${e.id}`, kind: 'competing_decision', eventIds: [s.review.decisionEventId, e.id], resolved: false, at: e.at });
        s.decisions.push({ ...p, by: e.actor.id, at: e.at, eventId: e.id, contested: true });
        break;
      }
      const d = { ...p, by: e.actor.id, at: e.at, eventId: e.id };
      s.decision = d;
      s.decisions.push(d);
      s.review.decidedBy = e.actor.id;
      s.review.decisionEventId = e.id;
      if (p.decision === 'return_for_info') {
        s.review = null;
        if (s.history) s.history.verified = false;
      }
      if (p.decision === 'close') s.closed = true;
      break;
    }
    case 'TASK_CREATED':
      s.tasks[p.taskId] = { ...p, status: 'open', createdBy: e.actor.id, createdAt: e.at };
      break;
    case 'TASK_COMPLETED':
      Object.assign(s.tasks[p.taskId], { status: 'done', doneBy: e.actor.id, doneAt: e.at, outcome: p.outcome ?? null });
      break;
    case 'PROPOSAL_CREATED':
      s.proposals[p.proposalId] = {
        id: p.proposalId,
        agent: e.actor.id,
        action: p.action,
        rationale: p.rationale ?? '',
        evidence: p.evidence ?? [],
        status: 'pending',
        at: e.at,
      };
      break;
    case 'PROPOSAL_APPROVED': {
      const pr = s.proposals[p.proposalId];
      pr.status = 'approved';
      pr.decidedBy = e.actor.id;
      pr.decidedAt = e.at;
      pr.decisionMs = Date.parse(e.at) - Date.parse(pr.at);
      // Approval executes the action deterministically, attributed to the approver.
      const a = pr.action;
      if (a.type === 'TASK_CREATED') s.tasks[a.payload.taskId] = { ...a.payload, status: 'open', createdBy: e.actor.id, createdAt: e.at, proposalId: pr.id };
      if (a.type === 'PATIENTS_LINKED') s.links.push({ ...a.payload, by: e.actor.id, at: e.at });
      if (a.type === 'HISTORY_FIELDS' && s.history) {
        s.history.answers = { ...s.history.answers, ...a.payload.answers };
        s.history.verified = false;
      }
      if (a.type === 'MESSAGE_SEND') s.messages[pr.id] = { ...a.payload, status: 'approved', approvedBy: e.actor.id };
      if (a.type === 'ESCALATE') s.tasks[a.payload.taskId] = { ...a.payload, kind: 'escalation', status: 'open', createdBy: e.actor.id, createdAt: e.at, proposalId: pr.id };
      break;
    }
    case 'PROPOSAL_REJECTED': {
      const pr = s.proposals[p.proposalId];
      pr.status = 'rejected';
      pr.decidedBy = e.actor.id;
      pr.decidedAt = e.at;
      pr.rejectReason = p.reason ?? null;
      pr.decisionMs = Date.parse(e.at) - Date.parse(pr.at);
      break;
    }
    case 'MESSAGE_SENT':
      Object.assign(s.messages[p.proposalId] ?? (s.messages[p.proposalId] = {}), { status: 'sent', sentAt: e.at, channel: p.channel, providerId: p.providerId ?? null, dryRun: !!p.dryRun });
      break;
    case 'PATIENTS_LINKED':
      s.links.push({ ...p, by: e.actor.id, at: e.at });
      break;
    case 'CONFLICT_RESOLVED': {
      const c = s.conflicts.find((x) => x.id === p.conflictId);
      c.resolved = true;
      c.keep = p.keepEventId;
      c.by = e.actor.id;
      const kept = s.decisions.find((d) => d.eventId === p.keepEventId);
      if (kept) s.decision = { ...kept, contested: false };
      break;
    }
    case 'CASE_CLOSED':
      s.closed = true;
      break;
    case 'NOTE_ADDED':
      s.notes.push({ text: p.text, by: e.actor.id, role: e.actor.role, at: e.at });
      break;
  }
}

function deriveStatus(s) {
  if (s.closed) return 'closed';
  if (s.conflicts.some((c) => !c.resolved)) return 'conflict';
  if (s.review && !s.review.decidedBy) return 'in_review';
  if (s.decision) {
    if (s.decision.decision === 'return_for_info' && !s.review) return 'returned';
    return Object.values(s.tasks).some((t) => t.status === 'open') ? 'followup_pending' : 'decided';
  }
  const readings = Object.values(s.readings);
  if (readings.some((r) => r.status === 'unverified')) return 'reading_unverified';
  if (s.history?.verified && readings.some((r) => r.status === 'verified')) return 'ready_for_review';
  if (s.history) return 'history_captured';
  return 'draft';
}

/** Fold events into case state. Invalid events are kept in `rejected`, never applied. */
export function reduce(events, caseId) {
  const evs = normalise(events.filter((e) => !caseId || e.caseId === caseId));
  const s = empty(caseId ?? evs[0]?.caseId ?? null);
  for (const e of evs) {
    const why = guard(s, e);
    if (why) {
      s.rejected.push({ eventId: e.id, type: e.type, reason: why });
      continue;
    }
    applyOne(s, e);
    s.events.push(e.id);
    s.updatedAt = e.at;
    s.status = deriveStatus(s);
  }
  return s;
}

/** Group a mixed event log into case states. */
export function reduceAll(events) {
  const by = new Map();
  for (const e of events) {
    if (!by.has(e.caseId)) by.set(e.caseId, []);
    by.get(e.caseId).push(e);
  }
  return [...by.entries()].map(([id, evs]) => reduce(evs, id));
}

/** Check whether appending would be accepted, without mutating anything. */
export function canAppend(events, e) {
  return guard(reduce(events, e.caseId), e);
}

/** Stable 64-bit-ish string hash (cyrb53) → hex. Used for deterministic ids. */
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Proposal helper: agents call this rather than emitting consequential events.
 * With a dedupeKey, ids are deterministic, so the same proposal made independently on a
 * phone and on the server merges into one on sync instead of appearing twice.
 */
export function propose({ caseId, agent, action, rationale, evidence = [], at }) {
  if (!PROPOSABLE[action?.type]) throw new Error(`action ${action?.type} not proposable`);
  const key = action.payload?.dedupeKey ?? (action.type === 'PATIENTS_LINKED' ? `link:${action.payload.otherCaseId}` : null);
  const h = key ? hash(`${caseId}|${key}`) : null;
  const payload = { ...action.payload };
  // Deterministic ids for tasks created by deduplicated proposals, too.
  if (h && payload.taskId) payload.taskId = `t_${h}`;
  return makeEvent({
    caseId,
    type: 'PROPOSAL_CREATED',
    actor: { id: agent, role: 'agent' },
    payload: { proposalId: h ? `p_${h}` : uid('p'), action: { ...action, payload }, rationale, evidence },
    at,
    id: h ? `e_${h}` : undefined,
  });
}
