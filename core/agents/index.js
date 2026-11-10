// Agent runner. After any change to a case, run the bounded agents and return the events
// they want to append. The engine (workflow.reduce) still decides what is accepted.
import { makeEvent, reduce, propose, uid } from '../workflow.js';
import { runChecks, verifiedHb } from './check.js';
import { buildHandoffAll as buildHandoff } from './handoff.js';
import { scanFollowUp } from './followup.js';

const sameFlags = (a, b) => JSON.stringify(a.map((f) => [f.code, f.severity, f.message?.en])) === JSON.stringify(b.map((f) => [f.code, f.severity, f.message?.en]));

/**
 * @param events  full event log (all cases)
 * @param caseId  the case that changed
 * @param ctx     { pack, now?, lang? }
 * @returns {object[]} new events (FLAGS_RAISED, HANDOFF_PREPARED, PROPOSAL_CREATED)
 */
export function runAgents(events, caseId, ctx) {
  const { pack } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const state = reduce(events, caseId);
  if (!state.openedAt || state.closed) return [];
  const others = [];
  const priorReadings = [];
  const hashes = new Map();
  const byCase = new Map();
  for (const e of events) {
    if (e.caseId === caseId) continue;
    if (!byCase.has(e.caseId)) byCase.set(e.caseId, []);
    byCase.get(e.caseId).push(e);
  }
  const linked = new Set([...state.links.map((l) => l.otherCaseId), ...(state.patient?.priorCaseIds ?? [])]);
  for (const [id, evs] of byCase) {
    const s = reduce(evs, id);
    if (!s.patient) continue;
    others.push({ caseId: id, patient: s.patient });
    for (const r of Object.values(s.readings)) if (r.imageHash) hashes.set(r.imageHash, id);
    const sameId = s.patient.id && s.patient.id === state.patient?.id;
    if (linked.has(id) || sameId || s.links.some((l) => l.otherCaseId === caseId)) {
      // Never let a later visit change how an earlier case is judged.
      const own = verifiedHb(pack, state).map((r) => r.at).sort().at(-1) ?? now;
      for (const r of verifiedHb(pack, s)) if (r.at <= own) priorReadings.push({ gdl: r.gdl, at: r.at, caseId: id, eventId: r.eventId });
    }
  }
  const out = [];
  const flags = runChecks(state, { pack, now, others, priorReadings, otherImageHashes: hashes });
  if (!sameFlags(flags, state.flags)) {
    out.push(makeEvent({ caseId, type: 'FLAGS_RAISED', actor: { id: 'femos-check', role: 'agent' }, payload: { flags, agent: 'femos-check@0.1.0' }, at: now, device: ctx.device ?? 'agent' }));
  }
  const ready = state.history && verifiedHb(pack, state).length > 0;
  if (ready) {
    const h = buildHandoff({ ...state, flags }, flags, pack, ctx.lang ?? 'en');
    const prev = state.handoff;
    if (!prev || JSON.stringify(prev.lines) !== JSON.stringify(h.lines) || JSON.stringify(prev.signals) !== JSON.stringify(h.signals)) {
      out.push(makeEvent({ caseId, type: 'HANDOFF_PREPARED', actor: { id: 'femos-handoff', role: 'agent' }, payload: h, at: now, device: ctx.device ?? 'agent' }));
    }
  }
  // Identity: propose links for likely duplicates (a person confirms).
  for (const f of flags.filter((x) => x.code === 'DUPLICATE_SUSPECT' && (x.level === 'likely' || x.level === 'same_identifier'))) {
    const exists = Object.values(state.proposals).some((p) => p.action.type === 'PATIENTS_LINKED' && p.action.payload.otherCaseId === f.otherCaseId);
    if (!exists) out.push(propose({ caseId, agent: 'femos-connect', at: now, action: { type: 'PATIENTS_LINKED', payload: { otherCaseId: f.otherCaseId, score: f.score } }, rationale: f.message.en, evidence: [] }));
  }
  out.push(...scanFollowUp(state, pack, now, ctx.facility));
  return out;
}

/** Convenience for tests and the server: append agent output until it settles. */
export function settle(events, caseId, ctx, maxRounds = 3) {
  let log = [...events];
  for (let i = 0; i < maxRounds; i++) {
    const add = runAgents(log, caseId, ctx);
    if (!add.length) break;
    log = log.concat(add);
  }
  return log;
}

export { uid };
