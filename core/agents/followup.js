// Follow-up agent: watches every case for stalled or overdue steps and PROPOSES escalations and
// reminders. It never sends a message or reassigns work itself.
import { propose, uid } from '../workflow.js';
import { render, t } from '../protocol.js';
import { verifiedHb } from './check.js';
import { classifyHb } from '../protocol.js';

const DAY = 864e5;

function pendingFor(state, kind, key) {
  // One proposal per key: once proposed (pending, approved or rejected) the agent does not nag.
  return Object.values(state.proposals).some((p) => p.action.payload?.dedupeKey === `${kind}:${key}`);
}

/**
 * @returns {object[]} PROPOSAL_CREATED events
 */
export function scanFollowUp(state, pack, now = new Date().toISOString(), facility = 'the health centre') {
  if (state.closed) return [];
  const out = [];
  const nowMs = Date.parse(now);
  const fu = pack.rules.followUp;
  const chain = fu.escalationChain;
  const lang = String(state.language ?? 'en').split('-')[0]; // her chosen message language; template falls back to English

  // 1. Overdue tasks → escalate one level, and (with consent) a neutral reminder.
  for (const task of Object.values(state.tasks)) {
    if (task.status !== 'open' || !task.due) continue;
    const late = Math.floor((nowMs - Date.parse(task.due)) / DAY);
    if (late < 1) continue;
    const at = chain.indexOf(task.assigneeRole ?? 'asha');
    const level = at < 0 ? chain.indexOf('anm') : Math.min(chain.length - 1, at + 1);
    const to = chain[Math.max(level, 0)];
    if (!pendingFor(state, 'escalate', task.taskId)) {
      out.push(
        propose({
          caseId: state.caseId,
          agent: 'femos-followup',
          at: now,
          action: { type: 'ESCALATE', payload: { taskId: uid('t'), parentTaskId: task.taskId, assigneeRole: to, due: new Date(nowMs + 3 * DAY).toISOString(), reason: `${task.kind} overdue ${late} days`, dedupeKey: `escalate:${task.taskId}` } },
          rationale: `Task "${task.kind}" was due ${task.due.slice(0, 10)} and is ${late} days overdue. Escalation chain: ${chain.join(' → ')}.`,
          evidence: [task.taskId],
        }),
      );
    }
    if (state.consent.messaging && state.patient?.phone && !pendingFor(state, 'remind', task.taskId)) {
      const tpl = pack.messages.templates.followup_reminder;
      out.push(
        propose({
          caseId: state.caseId,
          agent: 'femos-followup',
          at: now,
          action: {
            type: 'MESSAGE_SEND',
            payload: {
              channel: 'whatsapp',
              to: state.patient.phone,
              templateId: 'followup_reminder',
              language: lang,
              params: { name: state.patient.name?.split(' ')[0] ?? '', facility, date: new Date(nowMs + 2 * DAY).toISOString().slice(0, 10) },
              text: render(t(tpl, lang), { name: state.patient.name?.split(' ')[0] ?? '', facility, date: new Date(nowMs + 2 * DAY).toISOString().slice(0, 10) }),
              dedupeKey: `remind:${task.taskId}`,
            },
          },
          rationale: `Neutral reminder (does not name the condition) for an overdue ${task.kind}. Messaging consent recorded.`,
          evidence: [task.taskId],
        }),
      );
    }
  }

  // 2. Lost before review: abnormal verified reading but the case never reached a clinician.
  const a = state.history?.answers ?? {};
  const last = verifiedHb(pack, state).at(-1);
  if (last && !state.review && !state.decision && Number.isFinite(Number(a.ageYears))) {
    const c = classifyHb(pack, last.gdl, Number(a.ageYears));
    const age = Math.floor((nowMs - Date.parse(last.verifiedAt ?? last.at)) / DAY);
    const limit = c?.cls === 'severe' ? 1 : fu.lostAfterDays;
    if (c && c.cls !== 'none' && age >= limit && !pendingFor(state, 'stalled', state.caseId)) {
      out.push(
        propose({
          caseId: state.caseId,
          agent: 'femos-followup',
          at: now,
          action: { type: 'ESCALATE', payload: { taskId: uid('t'), assigneeRole: 'anm', due: new Date(nowMs + 2 * DAY).toISOString(), reason: `Hb ${last.gdl} (${c.cls}) verified ${age} days ago, never reviewed`, dedupeKey: `stalled:${state.caseId}` } },
          rationale: `Reading in the WHO "${c.cls}" range has waited ${age} days without clinician review (limit ${limit} days).`,
          evidence: [last.eventId],
        }),
      );
    }
  }
  return out;
}
