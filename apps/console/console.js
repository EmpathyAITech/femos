// FEMOS Console: clinicians review and decide; supervisors see follow-up, insights and reports.
// Agents prepare everything; every consequential action here is a human event in the log.
import { openClient } from '/core/client.js';
import { makeEvent, uid, STATUS } from '/core/workflow.js';
import { t as pt, toCanonical, cite, classifyHb } from '/core/protocol.js';
import { summarise, toDhis2, ask } from '/core/report.js';
import { toBundle } from '/core/fhir.js';
import { verifiedHb } from '/core/agents/check.js';
import { ROLE_LABEL, EVENT_LABEL, ACTION_LABEL, tr } from '/core/i18n.js';
import { T, LANGS, langInfo } from '/core/i18n/index.js';

const pack = await (await fetch('/protocols/anemia-hmb/pack.json')).json();
const PROTO = { id: pack.id, version: pack.version };
const USERS = [
  { id: 'dr-01', role: 'clinician', name: 'Dr Meera Sinha · PHC Sadar' },
  { id: 'dr-02', role: 'clinician', name: 'Dr Arjun Rao · CHC Tekari' },
  { id: 'mo-01', role: 'medical_officer', name: 'Dr S. Prasad · Block MO' },
  { id: 'anm-01', role: 'anm', name: 'Rekha Kumari · ANM' },
];
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } } };
let lang = ls.get('femos.console.lang', 'en');
let user = USERS.find((u) => u.id === ls.get('femos.console.user', 'dr-01')) ?? USERS[0];
const actor = () => ({ id: user.id, role: user.role, name: user.name });
const ev = (caseId, type, payload) => makeEvent({ caseId, type, actor: actor(), payload, protocol: PROTO, device: client.device });
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(langInfo(lang).locale, { day: 'numeric', month: 'short' }) : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(langInfo(lang).locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const L = (k, vars) => T(k, lang, vars);
function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }

let busy = false;
let ready = false;
const client = await openClient({ pack, onChange: () => { if (!ready) return; renderSync(); if (!busy) route(true); } });

// ---------- shell ----------
$('#who').innerHTML = USERS.map((u) => `<option value="${u.id}" ${u.id === user.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
$('#who').onchange = () => { user = USERS.find((u) => u.id === $('#who').value); ls.set('femos.console.user', user.id); route(); };
$('#lang').innerHTML = LANGS.map((l) => `<option value="${l.code}" lang="${l.code}">${l.native}</option>`).join('');
$('#lang').value = lang;
document.documentElement.lang = lang;
const shellLabels = () => { $('label[for="who"]').textContent = L('c.signed_in_as'); $('label[for="lang"]').textContent = L('c.language'); };
shellLabels();
$('#lang').onchange = () => { lang = $('#lang').value; ls.set('femos.console.lang', lang); document.documentElement.lang = lang; shellLabels(); route(); };
function renderSync() {
  const s = client.status();
  const el = $('#sync');
  el.className = `sync ${s.mode === 'server' ? 'ok' : ''}`;
  el.innerHTML = `<span class="dot"></span>${s.mode === 'server' ? `Synced${s.queued ? ` · ${s.queued} queued` : ''}` : s.mode === 'offline' ? 'Offline' : 'Standalone demo (this browser)'}`;
}

const APPROVE = { ESCALATE: ['clinician', 'medical_officer', 'anm'], MESSAGE_SEND: ['clinician', 'medical_officer', 'anm'], PATIENTS_LINKED: ['clinician', 'medical_officer', 'anm'], TASK_CREATED: ['clinician', 'medical_officer', 'anm'] };
const canApprove = (p) => (APPROVE[p.action.type] ?? []).includes(user.role);
const isClin = () => ['clinician', 'medical_officer'].includes(user.role);

function data() {
  const states = client.states().filter((s) => s.openedAt);
  const queue = states.filter((s) => s.status === 'in_review' || s.status === 'conflict').sort((a, b) => (b.handoff?.priority ?? 0) - (a.handoff?.priority ?? 0) || (a.review?.submittedAt < b.review?.submittedAt ? -1 : 1));
  const proposals = states.flatMap((s) => Object.values(s.proposals).filter((p) => p.status === 'pending' && canApprove(p)).map((p) => ({ s, p })));
  const tasks = states.flatMap((s) => Object.values(s.tasks).filter((t) => t.status === 'open').map((t) => ({ s, t, late: t.due && Date.parse(t.due) < Date.now() })));
  return { states, queue, proposals, tasks };
}

function nav(cur) {
  const d = data();
  const items = [
    ['queue', L('c.review_queue'), d.queue.length, d.queue.some((s) => s.handoff?.urgent)],
    ['proposals', L('c.agent_proposals'), d.proposals.length, false],
    ['followup', L('c.follow_up'), d.tasks.filter((x) => x.late).length, d.tasks.some((x) => x.late)],
    ['insights', L('c.insights'), null],
    ['reports', L('c.reports_sync'), null],
  ];
  $('#nav').innerHTML = items.map(([k, label, n, hot]) => `<a href="#/${k}" ${cur === k ? 'aria-current="page"' : ''}><span>${esc(label)}</span>${n != null ? `<span class="count ${hot ? 'hot' : ''}">${n}</span>` : ''}</a>`).join('');
}

// ---------- review queue + case review ----------
let openedAt = {};
function qItem(s, cur) {
  const sum = summarise(s, pack);
  const urgent = s.handoff?.urgent || s.status === 'conflict';
  const attn = s.flags.some((f) => f.severity === 'warn');
  return `<a class="qi ${urgent ? 'urgent' : attn ? 'attn' : ''}" href="#/queue/${encodeURIComponent(s.caseId)}" ${cur === s.caseId ? 'aria-current="true"' : ''}>
    <span class="bar"></span>
    <span><div class="t">${esc(s.patient.name)}</div><div class="s">${[s.history?.answers?.ageYears != null ? L('c.age_short', { n: s.history.answers.ageYears }) : null, s.patient.village, tr(ROLE_LABEL[s.entry?.role], lang), fmtDate(s.review?.submittedAt)].filter(Boolean).map(esc).join(' · ')}</div>
    <div style="margin-top:6px">${s.status === 'conflict' ? `<span class="chip urgent">${L('c.conflict')}</span>` : urgent ? `<span class="chip urgent">${L('c.urgent')}</span>` : ''} ${sum.hmb ? `<span class="chip info">HMB</span>` : ''} ${sum.falling ? `<span class="chip warn">${L('c.falling_hb')}</span>` : ''}</div></span>
    <span class="hb">${sum.hb ?? '—'}<small>${sum.hbClass && sum.hbClass !== 'none' ? L('c.who_band', { band: L(`band.${sum.hbClass}`) }) : 'g/dL'}</small></span></a>`;
}

function screenQueue(caseId) {
  const { queue, states } = data();
  const decided = states.flatMap((s) => s.decisions.filter((d) => d.reviewMs)).map((d) => d.reviewMs).sort((a, b) => a - b);
  const median = decided.length ? decided[Math.floor(decided.length / 2)] : null;
  const sel = caseId ?? queue[0]?.caseId;
  $('#main').innerHTML = `
    <div class="head"><div><h1>${L('c.review_queue')}</h1><p class="sub">${L('c.agents_prepared_each_case_you_decide')}</p></div>
      <div class="row"><span class="chip plum">${queue.length} ${L('c.waiting')}</span>${median != null ? `<span class="chip ok">${L('c.median_time_to_decision')}: ${Math.round(median / 1000)} s (n=${decided.length})</span>` : ''}</div></div>
    ${queue.length ? `<div class="split"><div class="queue">${queue.map((s) => qItem(s, sel)).join('')}</div><div id="review"></div></div>` : `<div class="card empty">${L('c.no_cases_waiting_for_review')}</div>`}`;
  if (sel) renderReview(sel);
}

function trendChart(series) {
  // Single series: Hb over time with WHO reference lines (labelled, not colour-only).
  const W = 560, Hh = 170, P = { l: 34, r: 70, t: 12, b: 24 };
  const xs = series.map((p) => Date.parse(p.at));
  const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1;
  const vals = series.map((p) => p.gdl);
  const lo = Math.min(6, Math.floor(Math.min(...vals) - 1)), hi = Math.max(14, Math.ceil(Math.max(...vals) + 1));
  const X = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (Hh - P.t - P.b);
  const refs = [[12, 'mild <12'], [11, 'moderate <11'], [8, 'severe <8']].filter(([v]) => v > lo && v < hi);
  const ticks = [];
  for (let v = Math.ceil(lo / 2) * 2; v <= hi; v += 2) ticks.push(v);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${X(Date.parse(p.at)).toFixed(1)},${Y(p.gdl).toFixed(1)}`).join('');
  return `<div class="chart" role="img" aria-label="Haemoglobin over time: ${series.map((p) => `${p.gdl} on ${fmtDate(p.at)}`).join(', ')}">
    <svg viewBox="0 0 ${W} ${Hh}">
      <g class="grid">${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>
      <g class="axis">${ticks.map((v) => `<text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        <text x="${P.l}" y="${Hh - 4}">${fmtDate(series[0].at)}</text><text x="${W - P.r}" y="${Hh - 4}" text-anchor="end">${fmtDate(series.at(-1).at)}</text></g>
      <g class="ref">${refs.map(([v, l]) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--ink-3)"/><text x="${W - P.r + 6}" y="${Y(v) + 4}" fill="var(--ink-3)">${l}</text>`).join('')}</g>
      <path class="series" d="${path}"/>
      ${series.map((p) => `<circle class="pt" cx="${X(Date.parse(p.at))}" cy="${Y(p.gdl)}" r="4.5"/><circle class="hit" cx="${X(Date.parse(p.at))}" cy="${Y(p.gdl)}" r="14" data-tip="${esc(`${p.gdl} g/dL · ${fmtDate(p.at)}${p.caseId ? ` · case ${p.caseId.slice(0, 8)}` : ''}`)}"/>`).join('')}
    </svg></div>`;
}

function patientSeries(s) {
  const all = client.states().filter((x) => x.patient && (x.caseId === s.caseId || (s.patient.id && x.patient.id === s.patient.id) || s.links.some((l) => l.otherCaseId === x.caseId) || (s.patient.priorCaseIds ?? []).includes(x.caseId)));
  return all.flatMap((x) => verifiedHb(pack, x).map((r) => ({ gdl: r.gdl, at: r.at, caseId: x.caseId }))).filter((p) => p.gdl != null).sort((a, b) => (a.at < b.at ? -1 : 1));
}

function renderReview(caseId) {
  const s = client.state(caseId);
  if (!s.openedAt) return;
  openedAt[caseId] ??= Date.now();
  const h = s.handoff;
  const series = patientSeries(s);
  const a = s.history?.answers ?? {};
  const fu = pack.rules.followUp.defaultDaysByDecision;
  const flags = s.flags;
  const box = $('#review');
  const conflict = s.conflicts.find((c) => !c.resolved);
  box.innerHTML = `
    <div class="card">
      <div class="who"><div><div class="name">${esc(s.patient.name)}</div><div class="muted small">${[a.ageYears != null ? L('c.age_years', { n: a.ageYears }) : null, s.patient.village, s.patient.block, s.patient.identifiers?.length ? `ABHA ${s.patient.identifiers[0].value}` : null].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="small muted" style="margin-top:4px">${L('c.started_by')} ${esc(tr(ROLE_LABEL[s.entry?.role], lang))} · ${esc(fmtTime(s.openedAt))} · ${esc(s.protocol?.id ?? pack.id)}@${esc(s.protocol?.version ?? pack.version)}</div></div>
        <span class="chip ${s.status === 'conflict' ? 'urgent' : 'plum'}">${esc(tr(STATUS[s.status], lang))}</span></div>
      ${h ? `<div class="headline ${h.urgent ? 'urgent' : 'routine'}">${h.urgent ? '⚠' : '✓'} ${esc(tr(h.i18n?.headline, lang) || h.headline)}</div>` : ''}
      ${h ? h.lines.map((l) => `<div class="line"><span class="lk">${esc(L(`kind.${l.kind}`))}</span><span class="${l.kind === 'original' ? 'orig' : ''}">${l.kind === 'original' ? `“${esc(l.text)}” <span class="chip">${esc(l.language ?? '')}</span>` : esc(tr(l.i18n, lang) || l.text)}<span class="srcs">${(l.sources ?? []).map((id) => `<button class="src" data-ev="${esc(id)}" title="Show source event">${esc(id.slice(0, 8))}</button>`).join('')}</span></span></div>`).join('') : `<p class="muted">${L('c.no_summary_yet')}</p>`}
    </div>
    ${series.length > 1 ? `<h2>${L('c.haemoglobin_over_time_all_linked_visits')}</h2><div class="card">${trendChart(series)}</div>` : ''}
    <h2>${L('c.signals_and_checks')}</h2>
    <div class="card">${flags.length ? flags.map((f) => `<div class="sig ${f.severity}"><span class="ic">${f.severity === 'info' ? 'i' : '!'}</span><div><div>${esc(pt(f.message, lang))}</div>${f.rule ? `<div class="cite">${esc(f.rule.title)}${f.rule.url ? ` · <a href="${esc(f.rule.url)}" target="_blank" rel="noopener">source</a>` : ''} · ${esc(f.rule.packId)}@${esc(f.rule.packVersion)}</div>` : ''}</div></div>`).join('') : `<p class="muted">${L('c.no_flags')}</p>`}
      ${h?.openQuestions?.length ? `<p class="note"><b>${L('c.open_questions')}:</b> ${(tr(h.openQuestionsI18n, lang) || h.openQuestions).map(esc).join(' · ')}</p>` : ''}
      <p class="note">${esc(tr(h?.i18n?.disclaimer, lang) || h?.disclaimer || '')}</p></div>
    ${conflict ? `<h2>${L('c.conflicting_decisions')}</h2><div class="card"><p>${L('c.two_clinicians_decided_this_case_on')}</p>
      ${s.decisions.filter((d) => conflict.eventIds.includes(d.eventId)).map((d) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:10px 0"><span><b>${esc(d.decision)}</b> · ${esc(d.by)} · ${esc(fmtTime(d.at))}${d.note ? ` · “${esc(d.note)}”` : ''}</span>${isClin() ? `<button class="btn btn-quiet" data-keep="${esc(d.eventId)}">${L('c.keep_this')}</button>` : ''}</div>`).join('')}</div>` : ''}
    ${!conflict && s.status === 'in_review' ? (isClin() ? `<h2>${L('c.your_decision')}</h2>
    <div class="card decide">
      <div class="opts" role="group">
        ${[['refer', L('c.refer'), L('c.followup_in_n_days', { n: fu.refer })], ['manage_locally', L('c.manage_locally'), L('c.review_in_n_days', { n: fu.manage_locally })], ['return_for_info', L('c.return_for_info'), L('c.back_to_the_worker')], ['close', L('c.close'), L('c.no_further_action')]].map(([k, l, d]) => `<button class="opt" data-d="${k}" aria-pressed="false">${esc(l)}<span>${esc(d)}</span></button>`).join('')}
      </div>
      <label class="small muted" for="note">${L('c.note_shared_with_the_worker')}</label><textarea id="note"></textarea>
      <div class="row"><label class="small muted" for="days">${L('c.follow_up_in_days')}</label><input id="days" type="number" min="0" max="365" style="width:90px">
        <label class="small muted" for="asg">${L('c.assign_to')}</label><select id="asg" class="f" style="width:auto"><option value="asha">ASHA</option><option value="anm">ANM</option><option value="self">${L('c.the_woman_self')}</option></select></div>
      <div class="row" style="justify-content:space-between"><span class="small muted">${L('c.your_decision_is_logged_with_your')}</span><button class="btn btn-primary" id="dec" disabled>${L('c.record_decision')}</button></div>
      <details class="ref"><summary>${L('c.clinician_reference_cited')}</summary><p class="note">${esc(pack.clinicianReference.note)}</p>${pack.clinicianReference.links.map((l) => { const c = cite(pack, l.source); return `<div><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(pt(l.label, lang))}</a></div>`; }).join('')}</details>
    </div>` : `<p class="note">${L('c.sign_in_as_a_clinician_to')}</p>`) : ''}
    <h2>${L('c.audit_trail')}</h2><div class="card"><details><summary>${s.events.length} ${L('c.events')}${s.rejected.length ? ` · ${s.rejected.length} ${L('c.rejected_by_the_engine')}` : ''}</summary><div id="tl" style="margin-top:12px">${timeline(s)}</div></details></div>`;

  let choice = null;
  box.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
    choice = b.dataset.d;
    box.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const d = fu[choice];
    $('#days').value = d ?? '';
    $('#dec').disabled = choice === 'return_for_info' && !$('#note').value.trim();
  }));
  $('#note')?.addEventListener('input', () => { if (choice) $('#dec').disabled = choice === 'return_for_info' && !$('#note').value.trim(); });
  $('#dec') && ($('#dec').onclick = async () => {
    busy = true;
    const days = Number($('#days').value);
    const evs = [ev(caseId, 'CLINICIAN_DECISION', { decision: choice, note: $('#note').value.trim() || null, reviewMs: Date.now() - openedAt[caseId], evidenceShown: s.events.slice(-50) })];
    if ((choice === 'refer' || choice === 'manage_locally') && days > 0) {
      evs.push(ev(caseId, 'TASK_CREATED', { taskId: uid('t'), kind: choice === 'refer' ? 'referral' : 'followup', due: new Date(Date.now() + days * 864e5).toISOString(), assigneeRole: $('#asg').value, reason: $('#note').value.trim() || null }));
    }
    await client.append(evs);
    busy = false;
    toast(L('c.decision_recorded'));
    const next = data().queue[0];
    location.hash = next ? `#/queue/${encodeURIComponent(next.caseId)}` : '#/queue';
  });
  box.querySelectorAll('[data-keep]').forEach((b) => (b.onclick = async () => { await client.append(ev(caseId, 'CONFLICT_RESOLVED', { conflictId: conflict.id, keepEventId: b.dataset.keep })); toast('Resolved'); route(); }));
  box.querySelectorAll('.src').forEach((b) => (b.onclick = () => {
    const d = box.querySelector('details:last-of-type');
    d.open = true;
    box.querySelectorAll('.tl li').forEach((li) => li.classList.toggle('hl', li.dataset.ev === b.dataset.ev));
    box.querySelector(`.tl li[data-ev="${CSS.escape(b.dataset.ev)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  bindTips(box);
}

function timeline(s) {
  const byId = new Map(client.events().filter((e) => e.caseId === s.caseId).map((e) => [e.id, e]));
  return `<ul class="tl">${s.events.map((id) => byId.get(id)).filter(Boolean).map((e) => {
    const agent = ['agent', 'system'].includes(e.actor.role);
    let x = '';
    if (e.type === 'READING_CAPTURED') x = ` · ${e.payload.value} ${e.payload.unit} · ${e.payload.method}${e.payload.device ? ` · ${e.payload.device.make} ${e.payload.device.model}` : ''}${e.payload.ocr ? ` · OCR ${e.payload.ocr.status}` : ''}${e.payload.imageHash ? ` · photo ${e.payload.imageHash.slice(0, 10)}…` : ''}`;
    if (e.type === 'READING_VERIFIED') x = ` · ${e.payload.value} ${e.payload.unit}`;
    if (e.type === 'PROPOSAL_CREATED') x = ` · ${tr(ACTION_LABEL[e.payload.action.type], lang)}`;
    if (e.type === 'CLINICIAN_DECISION') x = ` · ${e.payload.decision}`;
    if (e.type === 'HISTORY_SUBMITTED') x = ` · ${Object.keys(e.payload.answers).length} answers · ${e.payload.source}${e.payload.extractedBy ? ` · ${e.payload.extractedBy}` : ''}`;
    return `<li class="${agent ? 'agent' : 'human'}" data-ev="${esc(e.id)}"><div>${esc(tr(EVENT_LABEL[e.type], lang))}${esc(x)}</div><div class="tm">${esc(fmtTime(e.at))} · ${esc(tr(ROLE_LABEL[e.actor.role], lang))} ${esc(e.actor.id)} · <code>${esc(e.id.slice(0, 8))}</code></div></li>`;
  }).join('')}${s.rejected.map((r) => `<li><div><span class="chip urgent">${L('c.rejected')}</span> ${esc(r.type)}: ${esc(r.reason)}</div></li>`).join('')}</ul>`;
}

function bindTips(root) {
  const tip = $('#tip');
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointerenter', (e) => { tip.textContent = el.dataset.tip; tip.hidden = false; tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 36}px`; });
    el.addEventListener('pointermove', (e) => { tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 36}px`; });
    el.addEventListener('pointerleave', () => (tip.hidden = true));
  });
}

// ---------- proposals ----------
function screenProposals() {
  const { proposals } = data();
  $('#main').innerHTML = `<div class="head"><div><h1>${L('c.agent_proposals')}</h1><p class="sub">${L('c.agents_never_act_on_their_own')}</p></div></div>
    ${proposals.length ? `<div class="grid">${proposals.map(({ s, p }) => `<div class="card prop"><div><h3>${esc(tr(ACTION_LABEL[p.action.type], lang))} · <a href="#/queue/${encodeURIComponent(s.caseId)}" style="color:inherit">${esc(s.patient.name)}</a></h3>
      <div class="rat">${esc(p.rationale)}</div>
      ${p.action.payload.text ? `<div class="msg"><span class="small muted">${esc(p.action.payload.channel)} → ${esc(p.action.payload.to)} · ${esc(p.action.payload.language)}</span><br>“${esc(p.action.payload.text)}”</div>` : ''}
      ${p.action.type === 'ESCALATE' ? `<div class="small muted" style="margin-top:6px">→ ${esc(tr(ROLE_LABEL[p.action.payload.assigneeRole], lang))} · ${L('c.due')} ${esc(fmtDate(p.action.payload.due))}</div>` : ''}
      <div class="small muted" style="margin-top:6px">${esc(p.agent)} · ${esc(fmtTime(p.at))}</div></div>
      <div class="row"><button class="btn btn-ok" data-ap="${esc(s.caseId)}|${esc(p.id)}">${L('c.approve')}</button><button class="btn btn-ghost" data-rj="${esc(s.caseId)}|${esc(p.id)}">${L('c.reject')}</button></div></div>`).join('')}</div>` : `<div class="card empty">${L('c.no_proposals_waiting_for_your_role')}</div>`}`;
  $('#main').querySelectorAll('[data-ap]').forEach((b) => (b.onclick = async () => {
    const [caseId, pid] = b.dataset.ap.split('|');
    const p = client.state(caseId).proposals[pid];
    busy = true;
    await client.append(ev(caseId, 'PROPOSAL_APPROVED', { proposalId: pid }));
    busy = false;
    if (p.action.type === 'MESSAGE_SEND') {
      try { await client.sync(); const r = await client.api('/api/messages/send', { method: 'POST', body: { caseId, proposalId: pid } }); toast(r.dryRun ? L('c.approved_sent_in_dry_run_see') : L('c.approved_sent')); await client.sync(); }
      catch (e) { toast(`${L('c.approved_will_send_when_connected')} (${e.message})`); }
    } else toast(L('c.approved'));
    route();
  }));
  $('#main').querySelectorAll('[data-rj]').forEach((b) => (b.onclick = async () => { const [caseId, pid] = b.dataset.rj.split('|'); await client.append(ev(caseId, 'PROPOSAL_REJECTED', { proposalId: pid, reason: 'rejected in console' })); toast(L('c.rejected_2')); route(); }));
}

// ---------- follow-up ----------
function screenFollowup() {
  const { tasks } = data();
  const sorted = tasks.sort((a, b) => (b.late - a.late) || (a.t.due < b.t.due ? -1 : 1));
  $('#main').innerHTML = `<div class="head"><div><h1>${L('c.follow_up')}</h1><p class="sub">${L('c.every_referral_is_tracked_until_it')}</p></div>
    <div class="row"><span class="chip urgent">${tasks.filter((x) => x.late).length} ${L('c.overdue')}</span><span class="chip">${tasks.length} ${L('c.open')}</span></div></div>
    <div class="card" style="overflow-x:auto"><table><thead><tr><th>${L('c.patient')}</th><th>${L('c.task')}</th><th>${L('c.assigned')}</th><th>${L('c.block')}</th><th class="num">${L('c.due_2')}</th><th></th></tr></thead><tbody>
    ${sorted.map(({ s, t, late }) => `<tr><td><a href="#/queue/${encodeURIComponent(s.caseId)}" style="color:inherit;font-weight:600">${esc(s.patient.name)}</a><div class="small muted">${esc(s.patient.village ?? '')}</div></td><td>${esc(t.kind)}${t.reason ? `<div class="small muted">${esc(t.reason)}</div>` : ''}</td><td>${esc(tr(ROLE_LABEL[t.assigneeRole ?? 'asha'], lang))}</td><td>${esc(s.patient.block ?? '')}</td><td class="num">${late ? `<span class="chip urgent">${esc(fmtDate(t.due))}</span>` : esc(fmtDate(t.due))}</td><td><button class="btn btn-quiet" data-done="${esc(s.caseId)}|${esc(t.taskId)}">${L('c.mark_done')}</button></td></tr>`).join('') || `<tr><td colspan="6" class="empty">${L('c.no_open_tasks')}</td></tr>`}
    </tbody></table></div>`;
  $('#main').querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => { const [c, tid] = b.dataset.done.split('|'); await client.append(ev(c, 'TASK_COMPLETED', { taskId: tid, outcome: 'completed' })); toast(L('c.done')); route(); }));
}

// ---------- insights ----------
async function screenInsights() {
  const { states } = data();
  const rows = states.map((s) => summarise(s, pack));
  const n = (f) => rows.filter(f).length;
  const bands = ['none', 'mild', 'moderate', 'severe'].map((b) => [b, n((r) => r.hbClass === b)]);
  const totalB = bands.reduce((m, [, v]) => m + v, 0) || 1;
  const blocks = {};
  for (const r of rows) { const k = r.block ?? '—'; blocks[k] ??= { cases: 0, anaemia: 0, overdue: 0, referred: 0 }; blocks[k].cases++; if (r.hbClass && r.hbClass !== 'none') blocks[k].anaemia++; blocks[k].overdue += r.overdue; if (r.referred) blocks[k].referred++; }
  const maxB = Math.max(1, ...Object.values(blocks).map((b) => b.cases));
  const entries = rows.reduce((m, r) => ((m[r.entry] = (m[r.entry] ?? 0) + 1), m), {});
  $('#main').innerHTML = `<div class="head"><div><h1>${L('c.insights')}</h1><p class="sub">${L('c.numbers_are_computed_from_the_case')}</p></div></div>
    <div class="grid g4">
      <div class="tile"><div class="k">${L('c.cases')}</div><div class="v">${rows.length}</div><div class="d">${Object.entries(entries).map(([k, v]) => `${tr(ROLE_LABEL[k], lang)} ${v}`).join(' · ')}</div></div>
      <div class="tile"><div class="k">${L('c.hb_below_who_cut_off')}</div><div class="v">${n((r) => r.hbClass && r.hbClass !== 'none')}</div><div class="d">${L('c.of')} ${n((r) => r.hb != null)} ${L('c.screened')}</div></div>
      <div class="tile hot"><div class="k">${L('c.urgent_review')}</div><div class="v">${n((r) => r.urgent)}</div><div class="d">${L('c.protocol_danger_signs')}</div></div>
      <div class="tile"><div class="k">${L('c.overdue_follow_ups')}</div><div class="v">${rows.reduce((m, r) => m + r.overdue, 0)}</div><div class="d">${n((r) => r.falling)} ${L('c.with_falling_hb')}</div></div>
    </div>
    <h2>${L('c.ask')}</h2>
    <div class="card"><form class="ask" id="askf"><input id="q" type="text" placeholder="${L('c.e_g_overdue_follow_ups_in')}" aria-label="Question"><button class="btn btn-primary">${L('c.ask')}</button></form>
      <div class="chips">${['Overdue follow-ups', 'Severe anaemia this month', 'Falling Hb', 'Heavy bleeding in Sadar', 'Cases started by the woman herself', 'Waiting for review'].map((c) => `<button type="button" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div id="ans"></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h3>${L('c.haemoglobin_bands_latest_reading_per_case')}</h3>
        <div class="bands" role="img" aria-label="${bands.map(([b, v]) => `${b} ${v}`).join(', ')}">${bands.filter(([, v]) => v).map(([b, v]) => `<span class="b-${b}" style="width:${(v / totalB) * 100}%" data-tip="${b}: ${v} (${Math.round((v / totalB) * 100)}%)"></span>`).join('')}</div>
        <div class="legend">${bands.map(([b, v]) => `<span><i class="b-${b}"></i>${b === 'none' ? L('c.no_anaemia') : `WHO ${b}`} · <b>${v}</b></span>`).join('')}</div>
        <p class="note">WHO 2024 cut-offs by age · ${esc(pack.id)}@${esc(pack.version)}</p></div>
      <div class="card" style="overflow-x:auto"><h3>${L('c.by_block')}</h3><table><thead><tr><th>${L('c.block')}</th><th>${L('c.cases')}</th><th class="num">${L('c.anaemia')}</th><th class="num">${L('c.referred')}</th><th class="num">${L('c.overdue_2')}</th></tr></thead><tbody>
        ${Object.entries(blocks).sort((a, b) => b[1].cases - a[1].cases).map(([k, b]) => `<tr><td>${esc(k)}</td><td><div class="hbar"><i style="width:${(b.cases / maxB) * 120}px"></i><span>${b.cases}</span></div></td><td class="num">${b.anaemia}</td><td class="num">${b.referred}</td><td class="num">${b.overdue ? `<span class="chip urgent">${b.overdue}</span>` : 0}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <h2>${L('c.learning_module_pattern_mining_shadow_mode')}</h2>
    <div class="card" id="learn"><p class="muted">${L('c.loading')}</p></div>`;
  bindTips($('#main'));
  const run = async (q) => {
    $('#q').value = q;
    let r;
    try { r = client.status().mode === 'server' ? await client.api('/api/ask', { method: 'POST', body: { question: q } }) : ask(q, client.states(), pack); } catch { r = ask(q, client.states(), pack); }
    $('#ans').innerHTML = `<div style="margin-top:14px"><div class="row"><span style="font:600 28px/1 var(--font)">${r.count}</span><span class="muted">${esc(r.understood.join(' · '))}</span><span class="chip">${esc(r.planner ?? 'rules')}</span></div>
      <p class="note">${esc(r.method)}</p>${r.rows.length ? `<table style="margin-top:8px"><tbody>${r.rows.slice(0, 12).map((x) => `<tr><td><a href="#/queue/${encodeURIComponent(x.caseId)}" style="color:inherit;font-weight:600">${esc(x.name)}</a></td><td>${esc(x.village ?? '')}</td><td>${esc(x.block ?? '')}</td><td class="num">${x.hb ?? '—'}</td><td>${esc(tr(STATUS[x.status], lang))}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
  };
  $('#askf').onsubmit = (e) => { e.preventDefault(); run($('#q').value); };
  $('#main').querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => run(b.dataset.q)));
  try {
    let ins;
    try { ins = await client.api('/api/insights'); } catch { ins = await (await fetch('/demo/insights.json')).json(); } // static deployment
    if (!ins.available) throw new Error(ins.reason);
    const lv = { individual: L('c.individual'), school: L('c.school'), village: L('c.village'), block: L('c.block'), device: L('c.device'), process: L('c.process') };
    const byLevel = ins.findings.reduce((m, f) => ((m[f.level] = (m[f.level] ?? 0) + 1), m), {});
    const top = ['school', 'village', 'block', 'device', 'process'].flatMap((l) => ins.findings.filter((f) => f.level === l).slice(0, 4)).concat(ins.findings.filter((f) => f.level === 'individual').slice(0, 4));
    $('#learn').innerHTML = `<p class="small muted">${esc(ins.caveat)} ${ins.dataset ? `· ${ins.dataset.women} women · ${ins.dataset.visits} visits · seed ${ins.dataset.seed}` : ''}${ins.registry ? ` · ${esc(ins.registry.id ?? '')} ${esc(ins.registry.version ?? '')} · status: <b>${esc(ins.registry.status ?? 'shadow')}</b>` : ''}</p>
      <div class="row" style="margin:10px 0">${Object.entries(byLevel).map(([k, v]) => `<span class="chip plum">${esc(lv[k] ?? k)} · ${v}</span>`).join('')}</div>
      ${top.map((f) => `<div class="finding"><span class="chip">${esc(lv[f.level] ?? f.level)}</span><div><b>${esc(f.label)}</b><div class="small muted">${esc(f.explanation)}</div></div><span class="small muted">${esc(String(f.firstFlaggedAt ?? '').slice(0, 10))}</span></div>`).join('')}
      <p class="note">${L('c.findings_are_proposals_for_human_review')}</p>`;
  } catch (e) {
    $('#learn').innerHTML = `<p class="muted">${L('c.learning_findings_need_the_femos_server')}</p><p class="note">${esc(e.message)}</p>`;
  }
}

// ---------- reports & sync ----------
async function screenReports() {
  const { states } = data();
  const period = new Date().toISOString().slice(0, 7).replace('-', '');
  const dvs = toDhis2(states, pack, { period, orgUnit: 'ORG_UNIT_UID' });
  let cfg = null;
  try { cfg = (await client.api('/api/health')).connectors; } catch { /* standalone */ }
  const live = (k) => (cfg ? (cfg[k].live ? `<span class="chip ok">live</span>` : `<span class="chip warn">dry-run</span>`) : `<span class="chip">no server</span>`);
  const withHb = states.filter((s) => Object.values(s.readings).some((r) => r.status === 'verified'));
  $('#main').innerHTML = `<div class="head"><div><h1>${L('c.reports_sync')}</h1><p class="sub">${L('c.femos_integrates_with_existing_systems_it')}</p></div></div>
    <div class="grid g2">
      <div class="card"><div class="row" style="justify-content:space-between"><h3>DHIS2 · ${L('c.monthly_aggregate')} ${period}</h3>${live('dhis2')}</div>
        <table><tbody>${dvs.dataValues.map((v) => `<tr><td><code>${esc(v.dataElement)}</code></td><td class="num">${esc(v.value)}</td></tr>`).join('')}</tbody></table>
        <p class="note">${esc(pack.reporting.dhis2.note)}</p>
        <button class="btn btn-primary" id="dh">${L('c.send_to_dhis2')}</button><div id="dhr"></div></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>FHIR R4 · ${L('c.per_case')}</h3>${live('fhir')}</div>
        <select id="fc" class="f">${withHb.map((s) => `<option value="${esc(s.caseId)}">${esc(s.patient.name)} · ${esc(s.patient.village ?? '')}</option>`).join('')}</select>
        <div class="row" style="margin-top:10px"><button class="btn btn-quiet" id="fv">${L('c.view_bundle')}</button><button class="btn btn-primary" id="fp">${L('c.push_to_fhir_server')}</button></div>
        <p class="note">Patient · Encounter · Observation (LOINC 718-7, UCUM g/dL) · QuestionnaireResponse · Task · Provenance. PUT with stable ids → ${L('c.re_sync_is_idempotent')}.</p><div id="fr"></div></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>WhatsApp · RapidPro</h3><span>${live('whatsapp')} ${live('rapidpro')}</span></div>
        <p class="small">${L('c.messages_are_sent_only_after_a')}</p>
        ${Object.entries(pack.messages.templates).map(([k, v]) => `<div class="small" style="background:var(--paper-2);padding:10px;border-radius:10px;margin-top:8px"><code>${esc(k)}</code><br>${esc(pt(v, lang))}</div>`).join('')}</div>
      <div class="card"><h3>${L('c.sync_status')}</h3><pre class="json">${esc(JSON.stringify({ ...client.status(), server: undefined, protocol: `${pack.id}@${pack.version}`, events: client.events().length }, null, 2))}</pre></div>
    </div>`;
  $('#dh').onclick = async () => { try { const r = await client.api('/api/connect/dhis2', { method: 'POST', body: { period } }); $('#dhr').innerHTML = `<pre class="json">${esc(JSON.stringify(r, null, 2))}</pre>`; } catch (e) { $('#dhr').innerHTML = `<p class="note">${esc(e.message)}</p><pre class="json">${esc(JSON.stringify(dvs, null, 2))}</pre>`; } };
  $('#fv').onclick = () => { const s = client.state($('#fc').value); $('#fr').innerHTML = `<pre class="json">${esc(JSON.stringify(toBundle(s, pack), null, 2))}</pre>`; };
  $('#fp').onclick = async () => { try { await client.sync(); const r = await client.api('/api/connect/fhir', { method: 'POST', body: { caseId: $('#fc').value } }); $('#fr').innerHTML = `<pre class="json">${esc(JSON.stringify(r, null, 2))}</pre>`; } catch (e) { $('#fr').innerHTML = `<p class="note">${esc(e.message)}</p>`; } };
}

// ---------- router ----------
let lastRoute = '';
function route(soft = false) {
  const h = location.hash.slice(1) || '/queue';
  if (soft && (h === lastRoute) && document.activeElement && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) return; // don't clobber typing
  lastRoute = h;
  const [, sec = 'queue', id] = h.split('/');
  nav(sec);
  renderSync();
  if (sec === 'queue') screenQueue(id ? decodeURIComponent(id) : undefined);
  else if (sec === 'proposals') screenProposals();
  else if (sec === 'followup') screenFollowup();
  else if (sec === 'insights') { if (!soft) screenInsights(); }
  else if (sec === 'reports') { if (!soft) screenReports(); }
  if (!soft) $('#main').focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => route());
ready = true;
route();
