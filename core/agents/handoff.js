// Handoff agent: assembles a clinician summary where every line points back to the events it
// came from. It states facts and cited protocol signals; it does not diagnose or advise treatment.
import { t, toCanonical, classifyHb } from '../protocol.js';
import { verifiedHb, priority } from './check.js';
import { T, CODES } from '../i18n/index.js';

export function buildHandoff(state, flags, pack, lang = 'en') {
  const a = state.history?.answers ?? {};
  const L = (key, vars) => T(key, lang, vars);
  const lines = [];
  const p = state.patient ?? {};
  lines.push({ kind: 'who', text: `${p.name ?? '—'}, ${a.ageYears ?? '?'} ${L('h.y')} · ${p.village ?? ''}`.trim(), sources: [state.events[0]] });

  const hbs = verifiedHb(pack, state);
  for (const r of hbs) {
    const c = Number.isFinite(Number(a.ageYears)) ? classifyHb(pack, r.gdl, Number(a.ageYears)) : null;
    const how = { camera_ocr: L('h.camera_verified'), manual: L('h.typed_verified'), lab_report: L('h.lab_report') }[r.method] ?? r.method;
    lines.push({
      kind: 'reading',
      text: `Hb ${r.gdl} g/dL${r.unit !== 'g/dL' ? ` (${r.value} ${r.unit})` : ''} · ${how}${r.device?.model ? ` · ${r.device.make ?? ''} ${r.device.model}` : ''}${c && c.cls !== 'none' ? ` · WHO: ${c.cls}` : ''}`,
      sources: [r.eventId, r.verifyEventId].filter(Boolean),
    });
  }

  const sym = [];
  const yes = (k, key) => a[k] === true && sym.push(L(key));
  if (a.periodDays != null) sym.push(L('h.period_days', { n: a.periodDays }));
  if (a.padsPerDay != null) sym.push(L('h.pads_heaviest', { n: a.padsPerDay }));
  yes('soakingHourly', 'h.soaking');
  yes('clots', 'h.clots');
  yes('flooding', 'h.flooding');
  yes('fatigue', 'h.fatigue');
  yes('dizziness', 'h.dizziness');
  yes('breathless', 'h.breathless');
  yes('fainting', 'h.fainting');
  if (a.symptomDays != null) sym.push(L('h.for_days', { n: a.symptomDays }));
  if (sym.length) lines.push({ kind: 'history', text: sym.join(' · '), sources: [state.history?.eventId].filter(Boolean) });
  const ctx = [];
  if (a.ifaLastMonth === true) ctx.push(L('h.ifa_yes'));
  if (a.ifaLastMonth === false) ctx.push(L('h.ifa_no'));
  if (a.dewormedLastYear) ctx.push(L('h.dewormed', { v: L(`choice.${a.dewormedLastYear}`) }));
  if (ctx.length) lines.push({ kind: 'context', text: ctx.join(' · '), sources: [state.history?.eventId].filter(Boolean) });
  if (state.history?.originalText) lines.push({ kind: 'original', text: state.history.originalText, sources: [state.history.eventId], language: state.history.language });

  const signals = flags.filter((f) => ['urgent', 'warn'].includes(f.severity) || f.code === 'HMB_INDICATORS' || f.code === 'HB_BAND');
  const open = flags.filter((f) => ['HISTORY_MISSING', 'HISTORY_CONTRADICTION', 'DUPLICATE_SUSPECT', 'AGE_MISMATCH', 'READING_STALE'].includes(f.code));
  const urgent = flags.some((f) => f.severity === 'urgent');

  return {
    headline: urgent ? L('h.urgent') : L('h.routine'),
    urgent,
    priority: priority(flags),
    lines,
    signals: signals.map((f) => ({ code: f.code, severity: f.severity, text: t(f.message, lang), rule: f.rule, evidence: f.evidence })),
    openQuestions: open.map((f) => t(f.message, lang)),
    protocol: { id: pack.id, version: pack.version, status: pack.status },
    language: lang,
    generatedBy: 'femos-handoff@0.1.0',
    disclaimer: L('h.disclaimer'),
  };
}

/**
 * The summary in every language at once: lines/headline/signals carry `i18n` maps so a
 * clinician reads it in their own language regardless of the language it was captured in.
 */
export function buildHandoffAll(state, flags, pack, lang = 'en') {
  const per = Object.fromEntries(CODES.map((c) => [c, buildHandoff(state, flags, pack, c)]));
  const base = per[lang] ?? per.en;
  const pick = (f) => Object.fromEntries(CODES.map((c) => [c, f(per[c])]));
  return {
    ...base,
    i18n: { headline: pick((h) => h.headline), disclaimer: pick((h) => h.disclaimer) },
    lines: base.lines.map((l, i) => (l.kind === 'original' ? l : { ...l, i18n: pick((h) => h.lines[i]?.text) })),
    signals: base.signals.map((sg, i) => ({ ...sg, i18n: pick((h) => h.signals[i]?.text) })),
    openQuestions: base.openQuestions,
    openQuestionsI18n: pick((h) => h.openQuestions),
  };
}
