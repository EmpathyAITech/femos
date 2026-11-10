// FEMOS Field app. Every action becomes an event in the local log; agents run on the phone;
// the outbox syncs when there is a connection.
import { openClient, sha256 } from '/core/client.js';
import { makeEvent, uid, STATUS, WORKER_ROLES } from '/core/workflow.js';
import { t as pt, toCanonical } from '/core/protocol.js';
import { findDuplicates } from '/core/identity.js';
import { extractHistory } from '/core/agents/intake.js';
import { OCR_STATUS_TEXT } from '/core/ocr.js';
import { ROLE_LABEL, EVENT_LABEL, ACTION_LABEL, tr } from '/core/i18n.js';
import { T, LANGS, langInfo } from '/core/i18n/index.js';
import { readDisplay, getWorker } from '/app/ocr.js';
import { readViaWebBluetooth, captureModes } from '/core/devices.js';

const pack = await (await fetch('/protocols/anemia-hmb/pack.json')).json();
const PROTO = { id: pack.id, version: pack.version };
const registry = await (await fetch('/adapters/registry.json')).json();
// Devices that can produce a haemoglobin reading in this protocol pack.
const DEVICES = [
  ...registry.devices.filter((d) => d.kind === 'hb' || d.measures?.includes('hb')).map((d) => ({ id: d.id, make: d.make, model: d.model, status: d.modes.camera_ocr })),
  { id: 'other', make: 'Other', model: 'unlisted', status: 'manual-only' },
];

// ---------- tiny utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let lang = store.get('femos.lang', 'en');
let actor = store.get('femos.actor', null);
const L = (k, vars) => T(k, lang, vars);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(langInfo(lang).locale, { day: 'numeric', month: 'short' }) : '');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(langInfo(lang).locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }
const isSelf = () => actor?.role === 'self';

const client = await openClient({ pack, onChange: renderSync });
const ev = (caseId, type, payload) => makeEvent({ caseId, type, actor, payload, protocol: PROTO, device: client.device });

function renderSync(st = client.status()) {
  const b = $('#sync');
  if (!b) return;
  const cls = st.mode === 'server' ? (st.queued ? 'warn' : 'ok') : 'off';
  const label = st.mode === 'server' ? (st.queued ? `${st.queued} ${L('queued')}` : L('synced')) : st.mode === 'offline' ? `${L('offline')}${st.queued ? ` · ${st.queued}` : ''}` : L('standalone');
  b.className = `pill ${cls}`;
  b.innerHTML = `<span class="dot"></span>${esc(label)}`;
  b.title = st.lastSync ? `Last sync ${fmtTime(st.lastSync)}` : '';
}
$('#sync').onclick = async () => { await client.sync(); renderSync(); route(); };
$('#lang').innerHTML = LANGS.map((l) => `<option value="${l.code}" lang="${l.code}">${l.short}</option>`).join('');
$('#lang').onchange = () => { lang = $('#lang').value; store.set('femos.lang', lang); applyLang(); route(); };
$('#who').onclick = () => (location.hash = '#/role');
function applyLang() {
  document.documentElement.lang = lang;
  $('#lang').value = lang;
  $('#lang').title = langInfo(lang).native;
  $('#who').textContent = actor ? (actor.name ?? actor.id).split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase() : '?';
  renderSync();
}

// ---------- derived views ----------
const flagIcon = { urgent: '!', error: '!', warn: '!', info: 'i' };
function flagHTML(f) {
  const c = f.rule ? `<div class="fc">${esc(f.rule.title)}${f.rule.url ? ` · <a href="${esc(f.rule.url)}" target="_blank" rel="noopener">source</a>` : ''} · ${esc(f.rule.packId)}@${esc(f.rule.packVersion)}</div>` : '';
  return `<div class="flag ${f.severity}"><span class="ic" aria-hidden="true">${flagIcon[f.severity]}</span><div>${f.blocking ? `<div class="blk">${esc(L('fixFirst'))}</div>` : ''}<div class="fm">${esc(pt(f.message, lang))}</div>${c}</div></div>`;
}
const statusChip = (s) => {
  const cls = { closed: '', in_review: 'plum', ready_for_review: 'ok', followup_pending: 'info', conflict: 'urgent', returned: 'warn', reading_unverified: 'warn' }[s.status] ?? '';
  return `<span class="chip ${cls}">${esc(tr(STATUS[s.status], lang))}</span>`;
};
function lastHb(s) {
  const r = Object.values(s.readings).filter((x) => x.status === 'verified').sort((a, b) => (a.verifiedAt < b.verifiedAt ? 1 : -1))[0];
  return r ? toCanonical(pack, 'hb', r.value, r.unit) : null;
}
function myCases() {
  const all = client.states().filter((s) => s.openedAt);
  if (!actor) return [];
  if (isSelf()) return all.filter((s) => s.entry?.by === actor.id);
  return all;
}
function needsAction(s) {
  if (s.closed) return null;
  if (s.flags.some((f) => f.blocking)) return 'blocking';
  if (s.status === 'returned') return 'returned';
  if (s.status === 'reading_unverified') return 'reading';
  if (Object.values(s.proposals).some((p) => p.status === 'pending' && canApprove(p))) return 'proposal';
  if (Object.values(s.tasks).some((t) => t.status === 'open' && t.due && Date.parse(t.due) < Date.now() && (t.assigneeRole ?? 'asha') === actor.role)) return 'overdue';
  return null;
}
const APPROVERS = { MESSAGE_SEND: ['clinician', 'medical_officer', 'anm', 'asha'], ESCALATE: ['clinician', 'medical_officer', 'anm'], PATIENTS_LINKED: [...WORKER_ROLES, 'clinician', 'medical_officer'], TASK_CREATED: [...WORKER_ROLES, 'clinician', 'medical_officer'], HISTORY_FIELDS: [...WORKER_ROLES, 'self'], RETAKE_PHOTO: [...WORKER_ROLES, 'self'] };
const canApprove = (p) => (APPROVERS[p.action.type] ?? []).includes(actor?.role);

function caseItem(s) {
  const hb = lastHb(s);
  const urgent = s.flags.some((f) => f.severity === 'urgent');
  const blocking = s.flags.some((f) => f.blocking);
  const age = s.history?.answers?.ageYears;
  return `<a class="item ${urgent ? 'urgent' : blocking ? 'blocking' : ''}" href="#/case/${encodeURIComponent(s.caseId)}">
    <span class="t">${esc(s.patient?.name)}</span>
    <span class="r">${hb != null ? `<div class="hb">${hb}<small> g/dL</small></div>` : ''}${statusChip(s)}</span>
    <span class="s">${[age != null ? `${age} ${L('f.y')}` : null, s.patient?.village, fmtDate(s.updatedAt)].filter(Boolean).map(esc).join(' · ')}${urgent ? ` · <b style="color:var(--urgent)">${esc(L('f.urgent'))}</b>` : ''}</span>
  </a>`;
}

// ---------- screens ----------
const view = () => $('#view');

function screenRole() {
  const people = {
    asha: 'Sunita Devi', anm: 'Rekha Kumari', nurse: 'Nurse Farida', school: 'School health team, GMS Rampur', ngo: 'Asha Kiran Trust', camp: 'Block health camp', self: 'Priya',
  };
  const roles = ['asha', 'anm', 'nurse', 'school', 'ngo', 'camp', 'self'];
  let sel = actor?.role ?? 'asha';
  view().innerHTML = `
    <h1>${esc(L('whoAreYou'))}</h1>
    <p class="lead">${esc(L('f.femos_doesn_t_depend_on_one'))}</p>
    <div class="roles" role="group">${roles.map((r) => `<button class="role" data-r="${r}" aria-pressed="${r === sel}"><b>${esc(tr(ROLE_LABEL[r], lang))}</b><span>${esc(people[r])}</span></button>`).join('')}</div>
    <label class="f" for="nm">${esc(L('name'))}</label><input id="nm" type="text" value="${esc(actor?.name ?? people[sel])}" autocomplete="name">
    <div class="sticky-cta"><button class="btn btn-primary btn-block" id="go">${esc(L('continue'))}</button></div>
    <p class="hint">${esc(L('f.demo_sign_in_a_real_deployment'))}</p>`;
  view().querySelectorAll('.role').forEach((b) => (b.onclick = () => {
    sel = b.dataset.r;
    view().querySelectorAll('.role').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#nm').value = people[sel];
  }));
  $('#go').onclick = () => {
    const name = $('#nm').value.trim() || people[sel];
    const id = sel === 'self' ? `self-${client.device}` : `${sel}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || '01'}`;
    actor = { id, role: sel, name };
    store.set('femos.actor', actor);
    applyLang();
    location.hash = '#/';
  };
}

function screenHome() {
  const cases = myCases().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const action = cases.filter((s) => needsAction(s));
  const first = (actor.name ?? '').split(' ')[0];
  view().innerHTML = `
    <h1>${esc(L('namaste'))}, ${esc(first)}</h1>
    <p class="muted small">${esc(tr(ROLE_LABEL[actor.role], lang))} · <a href="#/role" style="color:inherit">${esc(L('switchRole'))}</a></p>
    <div class="card hero-card" style="margin-top:16px">
      <h3 style="font:600 22px/1.2 var(--font-display)">${esc(isSelf() ? L('selfStart') : L('newCase'))}</h3>
      <p>${esc(isSelf() ? L('selfStartSub') : L('newCaseSub'))}</p>
      <a class="btn btn-light btn-block" href="#/new">${esc(isSelf() ? L('selfStart') : L('newCase'))} →</a>
    </div>
    ${isSelf() ? '' : `<h2>${esc(L('needsAction'))}</h2><div class="list">${action.length ? action.slice(0, 8).map(caseItem).join('') : `<p class="muted">${esc(L('nothing'))}</p>`}</div>`}
    <h2>${esc(L('myCases'))} · ${cases.length}</h2>
    <div class="list">${cases.length ? cases.slice(0, 40).map(caseItem).join('') : `<p class="muted">${esc(L('noCases'))}</p>`}</div>
    <div class="foot"><a href="#/kit" style="color:inherit">${esc(L('f.device_kit'))}</a> · ${esc(L('synthetic'))}<br><button id="demo">${esc(L('loadDemo'))}</button> · <button id="reset">${esc(L('resetDemo'))}</button></div>`;
  $('#reset').onclick = async () => { if (confirm('Delete all FEMOS data on this device?')) { await client.reset(); route(); } };
  $('#demo').onclick = async () => { const n = await client.loadDemo(); toast(`${n} events`); route(); };
}

function screenNew() {
  const blocks = [...new Set(client.states().map((s) => s.patient?.block).filter(Boolean))];
  const self = isSelf();
  view().innerHTML = `
    <a class="back" href="#/">← ${esc(L('back'))}</a>
    <h1>${esc(self ? L('selfStart') : L('newCase'))}</h1>
    <div class="card">
      <label class="f" for="pn">${esc(L('name'))}</label><input id="pn" type="text" autocomplete="off" value="${self ? esc(actor.name) : ''}">
      <div id="dups"></div>
      <div class="row">
        <div style="flex:1 1 140px"><label class="f" for="by">${esc(L('birthYear'))}</label><input id="by" type="number" inputmode="numeric" min="1960" max="2020" placeholder="2009"></div>
        <div style="flex:1 1 140px"><label class="f" for="vi">${esc(L('village'))}</label><input id="vi" type="text" list="villages"></div>
      </div>
      <label class="f" for="bl">${esc(L('block'))}</label><input id="bl" type="text" list="blocks" placeholder="${esc(blocks[0] ?? 'Sadar')}">
      <datalist id="blocks">${blocks.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <datalist id="villages">${[...new Set(client.states().map((s) => s.patient?.village).filter(Boolean))].map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <label class="f" for="ph">${esc(L('phone'))}</label><input id="ph" type="tel" inputmode="tel" placeholder="+91">
      <p class="hint">${esc(L('phoneHint'))}</p>
      <div id="minor" hidden><label class="f" for="gu">${esc(L('guardian'))}</label><input id="gu" type="text"></div>
      <details><summary>${esc(L('abha'))}</summary><input id="ab" type="text" inputmode="numeric" placeholder="91-1234-5678-9012"></details>
    </div>
    <h2>${esc(L('consent'))}</h2>
    <div class="card">
      <label class="check"><input type="checkbox" id="c1"><span>${esc(L('consentCare'))}</span></label>
      <div id="minorc" hidden>
        <label class="check"><input type="checkbox" id="cg"><span><b>${esc(L('minorConsent'))}</b></span></label>
        <label class="check"><input type="checkbox" id="ca"><span>${esc(L('assent'))}</span></label>
      </div>
      <label class="check"><input type="checkbox" id="c2"><span>${esc(L('consentMsg'))}<div class="hint">${esc(L('phoneHint'))}</div></span></label>
      <label class="check"><input type="checkbox" id="c3"><span>${esc(L('consentLearn'))}</span></label>
      <label class="f" for="ml">${esc(L('msgLang'))}</label>
      <select id="ml">${LANGS.map((l) => `<option value="${l.code}" ${l.code === (lang === 'en' ? 'hi' : lang) ? 'selected' : ''}>${l.native}</option>`).join('')}</select>
    </div>
    <div class="sticky-cta"><button class="btn btn-primary btn-block" id="mk" disabled>${esc(L('create'))}</button></div>`;
  const others = client.states().filter((s) => s.patient).map((s) => ({ caseId: s.caseId, patient: s.patient }));
  const minor = () => { const y = Number($('#by').value); return y > 1900 && new Date().getFullYear() - y < 18; };
  const valid = () => $('#pn').value.trim() && $('#c1').checked && (!minor() || $('#cg').checked);
  let linkTo = null;
  const update = () => {
    $('#minor').hidden = $('#minorc').hidden = !minor();
    $('#mk').disabled = !valid();
    const p = { name: $('#pn').value, birthYear: Number($('#by').value) || null, village: $('#vi').value || null, phone: $('#ph').value || null, guardian: $('#gu').value || null };
    const d = p.name.trim().length > 2 ? findDuplicates(p, others).slice(0, 2) : [];
    $('#dups').innerHTML = d.map((m) => `<div class="flag warn" style="margin-top:10px"><span class="ic">!</span><div><div class="fm">${esc(L('maybeSame'))}: <b>${esc(m.patient.name)}</b> · ${esc(m.patient.village ?? '')} ${m.patient.birthYear ?? ''}</div><div class="fc">${esc(m.reasons.join(' · '))}</div><div class="row" style="margin-top:8px"><a class="btn btn-quiet" href="#/case/${encodeURIComponent(m.caseId)}">${esc(L('openExisting'))}</a><button class="btn btn-ghost" data-link="${esc(m.caseId)}" data-pid="${esc(m.patient.id ?? '')}">${esc(L('f.new_visit_same_person'))}</button></div></div></div>`).join('');
    $('#dups').querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => { linkTo = { caseId: b.dataset.link, patientId: b.dataset.pid }; b.textContent = '✓'; toast(L('f.will_be_linked_to_the_earlier')); }));
  };
  view().querySelectorAll('input,select').forEach((i) => i.addEventListener('input', update));
  $('#mk').onclick = async () => {
    const caseId = uid('c');
    const by = Number($('#by').value) || null;
    const patient = {
      id: linkTo?.patientId || uid('pt'),
      name: $('#pn').value.trim(),
      birthYear: by,
      village: $('#vi').value.trim() || null,
      block: $('#bl').value.trim() || null,
      district: client.states().find((s) => s.patient?.district)?.patient.district ?? null,
      phone: $('#ph').value.trim() || null,
      guardian: $('#gu').value.trim() || null,
      identifiers: $('#ab').value.trim() ? [{ system: 'abha', value: $('#ab').value.trim() }] : [],
      ...(linkTo ? { priorCaseIds: [linkTo.caseId] } : {}),
    };
    const evs = [
      ev(caseId, 'CASE_OPENED', { patient, language: $('#ml').value, channel: isSelf() ? 'self-app' : 'field-app' }),
      ev(caseId, 'CONSENT_RECORDED', { care: true, messaging: $('#c2').checked && !!patient.phone, learning: $('#c3').checked, by: minor() ? 'guardian' : 'self', assent: minor() ? $('#ca').checked : null }),
    ];
    if (linkTo) evs.push(ev(caseId, 'PATIENTS_LINKED', { otherCaseId: linkTo.caseId, reason: 'confirmed by worker at registration' }));
    await client.append(evs);
    location.hash = `#/case/${caseId}/history`;
  };
}

function screenCase(caseId) {
  const s = client.state(caseId);
  if (!s.openedAt) { view().innerHTML = `<a class="back" href="#/">← ${esc(L('back'))}</a><p>Case not found.</p>`; return; }
  const a = s.history?.answers ?? {};
  const readings = Object.values(s.readings);
  const verified = readings.filter((r) => r.status === 'verified');
  const blocking = s.flags.filter((f) => f.blocking);
  const urgent = s.flags.some((f) => f.severity === 'urgent');
  const submitted = !!s.review || !!s.decision;
  const histDone = !!s.history?.verified;
  const readDone = verified.length > 0;
  const step = (n, title, desc, done, now, href) => `<li class="step ${done ? 'done' : now ? 'now' : ''}"><span class="n">${done ? '✓' : n}</span><div><div class="st">${esc(title)}</div><div class="sd">${desc}</div></div>${href ? `<a class="btn ${done ? 'btn-quiet' : 'btn-primary'}" href="${href}">${esc(done ? L('edit') : L('start'))}</a>` : ''}</li>`;
  const hb = lastHb(s);
  const myProps = Object.values(s.proposals).filter((p) => p.status === 'pending' && canApprove(p));
  const tasks = Object.values(s.tasks);

  view().innerHTML = `
    <a class="back" href="#/">← ${esc(L('back'))}</a>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div><h1>${esc(s.patient.name)}</h1><p class="muted small">${[a.ageYears != null ? `${a.ageYears} ${L('f.years')}` : s.patient.birthYear ? `b. ${s.patient.birthYear}` : null, s.patient.village, s.patient.block].filter(Boolean).map(esc).join(' · ')}</p></div>
      <div style="text-align:right">${hb != null ? `<div class="hb">${hb}<small> g/dL</small></div>` : ''}${statusChip(s)}</div>
    </div>
    ${urgent ? `<div class="banner"><span class="ic">⚠</span><span>${esc(isSelf() ? L('urgentSelf') : L('urgentBanner'))}</span></div>` : ''}
    ${s.decision ? `<div class="card" style="margin-top:12px"><h3>${esc(L('decision'))}: ${esc(L(s.decision.decision))}</h3>${s.decision.note ? `<p>${esc(s.decision.note)}</p>` : ''}<p class="muted small">${esc(s.decision.by)} · ${esc(fmtTime(s.decision.at))}</p></div>` : ''}
    <h2>${esc(L('steps'))}</h2>
    <div class="card"><ol class="steps">
      ${step(1, L('history'), histDone ? esc(L('f.confirmed')) : s.history ? esc(L('f.needs_confirmation')) : esc(L('f.questions_or_her_own_words')), histDone, !histDone, submitted && !s.decision ? null : `#/case/${caseId}/history`)}
      ${step(2, L('reading'), readDone ? verified.map((r) => `${esc(r.value)} ${esc(r.unit)} · ${esc(r.method === 'camera_ocr' ? (L('f.camera')) : r.method)}`).join('<br>') : esc(L('f.photo_of_the_screen_or_type')), readDone, histDone && !readDone, submitted && !s.decision ? null : `#/case/${caseId}/reading`)}
      ${step(3, isSelf() ? L('sendSelf') : L('send'), submitted ? esc(L('sent')) : blocking.length ? esc(L('fixFirst')) : esc(L('f.after_femos_checks')), submitted, histDone && readDone && !submitted, null)}
    </ol>
    ${!submitted && histDone && readDone ? `<button class="btn btn-primary btn-block" id="submit" ${blocking.length ? 'disabled' : ''} style="margin-top:8px">${esc(isSelf() ? L('sendSelf') : L('send'))}</button>` : ''}
    ${s.status === 'returned' && histDone && readDone ? `<button class="btn btn-primary btn-block" id="submit" ${blocking.length ? 'disabled' : ''} style="margin-top:8px">${esc(L('f.send_again'))}</button>` : ''}
    </div>
    ${s.flags.length ? `<h2>${esc(L('checks'))}</h2><div>${s.flags.map(flagHTML).join('')}</div>` : ''}
    ${myProps.length ? `<h2>${esc(L('proposals'))}</h2>${myProps.map((p) => `<div class="card"><h3>${esc(tr(ACTION_LABEL[p.action.type], lang))}</h3><p>${esc(p.rationale)}</p>${p.action.payload.text ? `<p class="small" style="background:var(--paper-2);padding:10px;border-radius:10px">“${esc(p.action.payload.text)}”</p>` : ''}<p class="muted small">${esc(p.agent)} · ${esc(fmtTime(p.at))}</p><div class="row"><button class="btn btn-ok" data-ap="${esc(p.id)}">${esc(L('approve'))}</button><button class="btn btn-ghost" data-rj="${esc(p.id)}">${esc(L('reject'))}</button></div></div>`).join('')}` : ''}
    ${tasks.length ? `<h2>${esc(L('tasks'))}</h2><div class="list">${tasks.map((t) => { const late = t.status === 'open' && t.due && Date.parse(t.due) < Date.now(); return `<div class="item ${late ? 'blocking' : ''}"><span class="t">${esc(t.kind)}${t.assigneeRole ? ` · ${esc(tr(ROLE_LABEL[t.assigneeRole], lang))}` : ''}</span><span class="r">${t.status === 'done' ? `<span class="chip ok">${esc(L('done'))}</span>` : `<button class="btn btn-quiet" data-done="${esc(t.taskId)}" style="min-height:40px">${esc(L('markDone'))}</button>`}</span><span class="s">${t.due ? `${esc(L('due'))} ${esc(fmtDate(t.due))}` : ''}${late ? ` · <b style="color:var(--warn)">${esc(L('overdue'))}</b>` : ''}${t.reason ? ` · ${esc(t.reason)}` : ''}</span></div>`; }).join('')}</div>` : ''}
    ${s.handoff && !isSelf() ? `<h2>${esc(L('handoff'))}</h2><div class="card">${s.handoff.lines.map((l) => `<div class="handoff-line">${l.kind === 'original' ? `<i>“${esc(l.text)}”</i>` : esc(tr(l.i18n, lang) || l.text)} <span class="src">[${esc(l.kind)}]</span></div>`).join('')}<p class="hint">${esc(tr(s.handoff.i18n?.disclaimer, lang) || s.handoff.disclaimer)}</p></div>` : ''}
    <details style="margin-top:22px"><summary>${esc(L('timeline'))} · ${s.events.length}</summary>${timeline(s)}</details>
    <div class="foot">${esc(L('synthetic'))} · ${esc(pack.id)}@${esc(pack.version)}</div>`;

  const sub = $('#submit');
  if (sub) sub.onclick = async () => { await client.append(ev(caseId, 'SUBMITTED_FOR_REVIEW', {})); toast(L('sent')); route(); };
  view().querySelectorAll('[data-ap]').forEach((b) => (b.onclick = async () => {
    const p = s.proposals[b.dataset.ap];
    await client.append(ev(caseId, 'PROPOSAL_APPROVED', { proposalId: p.id }));
    if (p.action.type === 'MESSAGE_SEND') {
      try { const r = await client.api('/api/messages/send', { method: 'POST', body: { caseId, proposalId: p.id } }); toast(r.dryRun ? 'Approved · sent (dry-run)' : 'Approved · sent'); await client.sync(); }
      catch { toast(L('f.approved_will_send_when_connected')); }
    } else toast(L('approve'));
    route();
  }));
  view().querySelectorAll('[data-rj]').forEach((b) => (b.onclick = async () => { await client.append(ev(caseId, 'PROPOSAL_REJECTED', { proposalId: b.dataset.rj, reason: 'rejected in field app' })); route(); }));
  view().querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => { await client.append(ev(caseId, 'TASK_COMPLETED', { taskId: b.dataset.done, outcome: 'completed' })); toast(L('done')); route(); }));
}

function timeline(s) {
  const byId = new Map(client.events().filter((e) => e.caseId === s.caseId).map((e) => [e.id, e]));
  const rows = s.events.map((id) => byId.get(id)).filter(Boolean);
  const rej = s.rejected.map((r) => ({ ...byId.get(r.eventId), _rejected: r.reason })).filter((r) => r.id);
  return `<ul class="tl" style="margin-top:10px">${[...rows, ...rej].sort((a, b) => (a.at < b.at ? -1 : 1)).map((e) => {
    const agent = e.actor.role === 'agent' || e.actor.role === 'system';
    let extra = '';
    if (e.type === 'PROPOSAL_CREATED') extra = ` · ${esc(tr(ACTION_LABEL[e.payload.action.type], lang))}`;
    if (e.type === 'FLAGS_RAISED') extra = ` · ${e.payload.flags.length}`;
    if (e.type === 'READING_VERIFIED') extra = ` · ${esc(e.payload.value)} ${esc(e.payload.unit)}`;
    if (e.type === 'CLINICIAN_DECISION') extra = ` · ${esc(L(e.payload.decision))}`;
    return `<li class="${agent ? 'agent' : 'human'}"><div>${esc(tr(EVENT_LABEL[e.type], lang))}${extra}${e._rejected ? ` <span class="chip urgent">rejected: ${esc(e._rejected)}</span>` : ''}</div><div class="tm">${esc(fmtTime(e.at))} · ${esc(tr(ROLE_LABEL[e.actor.role], lang))} ${esc(e.actor.id)}</div></li>`;
  }).join('')}</ul>`;
}

function screenHistory(caseId) {
  const s = client.state(caseId);
  const answers = { ...(s.history?.answers ?? {}) };
  let original = s.history?.originalText ?? '';
  let source = s.history?.source ?? 'form';
  let extractedBy = s.history?.extractedBy ?? null;
  let tab = 'form';
  const self = isSelf();
  const draw = () => {
    view().innerHTML = `
      <a class="back" href="#/case/${encodeURIComponent(caseId)}">← ${esc(s.patient.name)}</a>
      <h1>${esc(L('history'))}</h1>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${tab === 'form'}" data-tab="form">${esc(L('askQuestions'))}</button>
        <button role="tab" aria-selected="${tab === 'words'}" data-tab="words">${esc(self ? L('ownWordsSelf') : L('ownWords'))}</button>
      </div>
      <div id="pane"></div>`;
    view().querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
    tab === 'form' ? drawForm() : drawWords();
  };
  const drawForm = () => {
    const items = pack.questionnaire.items;
    $('#pane').innerHTML = `<div class="card">${items.map((i) => {
      const v = answers[i.linkId];
      const lbl = `<div class="ql"><span>${esc(pt(i.text, lang))}</span>${i.required ? `<span class="req">${L('f.required')}</span>` : ''}</div>`;
      if (i.type === 'integer') return `<div class="q">${lbl}<div class="num"><button type="button" data-dec="${i.linkId}" aria-label="minus">−</button><input type="number" inputmode="numeric" data-k="${i.linkId}" value="${v ?? ''}" min="${i.min}" max="${i.max}"><button type="button" data-inc="${i.linkId}" aria-label="plus">+</button></div></div>`;
      const opts = i.type === 'boolean' ? [[true, L('yes')], [false, L('no')], [undefined, L('notAsked')]] : i.options.map((o) => [o, L(o) === o ? o : L(o)]);
      return `<div class="q">${lbl}<div class="seg">${opts.map(([val, txt]) => `<button type="button" data-k="${i.linkId}" data-v='${JSON.stringify(val ?? null)}' aria-pressed="${v === val || (val === undefined && v === undefined)}" class="${val === true || val === 'yes' ? 'y' : ''}">${esc(txt)}</button>`).join('')}</div></div>`;
    }).join('')}</div>
    ${original ? `<div class="card"><p class="small muted">${esc(L('f.original_words_saved_alongside'))}</p><p><i>“${esc(original)}”</i></p></div>` : ''}
    <div class="card"><label class="check"><input type="checkbox" id="cf"><span>${esc(self ? L('confirmHistorySelf') : L('confirmHistory'))}</span></label></div>
    <div class="sticky-cta"><button class="btn btn-primary btn-block" id="sv">${esc(L('saveHistory'))}</button></div>`;
    $('#pane').querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('input', () => { answers[inp.dataset.k] = inp.value === '' ? undefined : Number(inp.value); }));
    $('#pane').querySelectorAll('[data-inc],[data-dec]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.inc ?? b.dataset.dec;
      const inp = $(`input[data-k="${k}"]`);
      const n = (Number(inp.value) || 0) + (b.dataset.inc ? 1 : -1);
      inp.value = Math.max(0, n);
      answers[k] = Number(inp.value);
    }));
    $('#pane').querySelectorAll('button[data-v]').forEach((b) => (b.onclick = () => {
      const v = JSON.parse(b.dataset.v);
      answers[b.dataset.k] = v === null ? undefined : v;
      b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }));
    $('#sv').onclick = async () => {
      const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined && v !== ''));
      const evs = [ev(caseId, 'HISTORY_SUBMITTED', { answers: clean, source, originalText: original || null, language: lang, extractedBy })];
      if ($('#cf').checked) evs.push(ev(caseId, 'HISTORY_VERIFIED', {}));
      await client.append(evs);
      toast(L('save'));
      const st = client.state(caseId);
      location.hash = st.history?.verified && !Object.values(st.readings).some((r) => r.status === 'verified') ? `#/case/${caseId}/reading` : `#/case/${caseId}`;
    };
  };
  const drawWords = () => {
    $('#pane').innerHTML = `<div class="card">
        <p class="small muted">${esc(L('ownWordsHint'))}</p>
        <textarea id="tx" placeholder="${esc(L('f.e_g_umar_16_saal_mahwari'))}">${esc(original)}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn btn-ghost" id="rec">● ${esc(L('record'))}</button><button class="btn btn-primary" id="ex">${esc(L('extract'))}</button></div>
        <p class="hint" id="recmsg"></p>
      </div><div id="res"></div>`;
    let mr = null;
    $('#rec').onclick = async () => {
      if (mr) { mr.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        mr = new MediaRecorder(stream);
        mr.ondataavailable = (e) => chunks.push(e.data);
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          await client.putBlob(`voice:${caseId}:${Date.now()}`, new Blob(chunks, { type: mr.mimeType }));
          mr = null;
          source = 'voice';
          $('#rec').textContent = `● ${L('record')}`;
          $('#recmsg').textContent = L('voiceSaved');
        };
        mr.start();
        $('#rec').textContent = `■ ${L('stop')}`;
      } catch { toast(L('f.microphone_not_available')); }
    };
    $('#ex').onclick = async () => {
      const text = $('#tx').value.trim();
      if (!text) return;
      original = text;
      if (source === 'form') source = 'text';
      let r = extractHistory(text);
      if (client.status().mode === 'server') { try { r = await client.api('/api/agents/intake', { method: 'POST', body: { text } }); } catch { /* local rules */ } }
      extractedBy = r.extractedBy;
      const fields = Object.entries(r.answers);
      const item = (k) => pack.questionnaire.items.find((i) => i.linkId === k);
      const hl = (() => { let out = ''; let pos = 0; for (const sp of [...r.spans].sort((a, b) => a.start - b.start)) { if (sp.start < pos) continue; out += esc(text.slice(pos, sp.start)) + `<mark class="span">${esc(text.slice(sp.start, sp.end))}</mark>`; pos = sp.end; } return out + esc(text.slice(pos)); })();
      $('#res').innerHTML = fields.length ? `<div class="card"><h3>${esc(L('found'))} · ${fields.length}</h3><p class="small">${hl}</p>${fields.map(([k, v]) => { const sp = r.spans.find((x) => x.field === k); return `<div class="found"><span>${esc(pt(item(k)?.text, lang))}</span><span class="fv">${esc(v === true ? L('yes') : v === false ? L('no') : v)}</span><span class="fq">“${esc(sp?.text ?? '')}”</span></div>`; }).join('')}
        ${r.disagreements?.length ? `<div class="flag warn"><span class="ic">!</span><div class="fm">Model and rules disagree on: ${esc(r.disagreements.join(', '))}. Rules kept, please check.</div></div>` : ''}
        <p class="hint">${esc(r.extractedBy)} · ${esc(L('f.silence_is_never_recorded_as_no'))}</p>
        <button class="btn btn-primary btn-block" id="use">${esc(L('useThese'))}</button></div>` : `<div class="card"><p>${esc(L('nothingFound'))}</p></div>`;
      const u = $('#use');
      if (u) u.onclick = () => { Object.assign(answers, r.answers); tab = 'form'; draw(); toast(L('f.answers_filled_in_review_and_confirm')); };
    };
  };
  draw();
}

function screenReading(caseId) {
  const s = client.state(caseId);
  const self = isSelf();
  let dev = store.get('femos.device.model', 0);
  view().innerHTML = `
    <a class="back" href="#/case/${encodeURIComponent(caseId)}">← ${esc(s.patient.name)}</a>
    <h1>${esc(L('reading'))}</h1>
    <div class="card">
      <label class="f" for="dv">${esc(L('device'))}</label>
      <select id="dv">${DEVICES.map((d, i) => `<option value="${i}" ${i === dev ? 'selected' : ''}>${esc(d.make)} ${esc(d.model)}${d.status ? ` · ${esc(d.status)}` : ''}</option>`).join('')}</select>
      <p class="hint"><a href="#/kit" style="color:inherit">${esc(L('f.device_kit_compatibility'))}</a></p>
      <label class="btn btn-primary btn-block" style="margin-top:14px">📷 ${esc(self ? L('takeReport') : L('takePhoto'))}<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
      <button class="btn btn-ghost btn-block" id="manual" style="margin-top:10px">${esc(L('typeInstead'))}</button>
      <p class="hint">${esc(L('photoStays'))} ${esc(L('f.the_screen_is_read_on_this'))}</p>
    </div>
    <div id="out"></div>`;
  $('#dv').onchange = () => { dev = Number($('#dv').value); store.set('femos.device.model', dev); };
  // Warm up the OCR engine in the background so the first read is faster.
  getWorker().catch(() => {});

  const unitSelect = (u) => `<select id="un"><option value="" ${!u ? 'selected' : ''} disabled>${esc(L('chooseUnit'))}</option>${Object.keys(pack.measurements.hb.acceptedUnits).map((x) => `<option ${x === u ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const deviceTime = `<label class="f" for="mt">${esc(L('deviceTime'))}</label><input id="mt" type="datetime-local">`;

  async function save({ value, unit, method, ocr, imageHash, capturedValue }) {
    const readingId = uid('r');
    const mt = $('#mt')?.value ? new Date($('#mt').value).toISOString() : undefined;
    const d = DEVICES[dev] ?? DEVICES.at(-1);
    const evs = [
      ev(caseId, 'READING_CAPTURED', { readingId, kind: 'hb', value: capturedValue ?? value, unit, method, device: { registryId: d.id, make: d.make, model: d.model }, ...(mt ? { measuredAt: mt } : {}), ...(imageHash ? { imageHash } : {}), ...(ocr ? { ocr } : {}) }),
      ev(caseId, 'READING_VERIFIED', { readingId, value, unit }),
    ];
    await client.append(evs);
    const st = client.state(caseId);
    const bad = st.flags.filter((f) => f.blocking);
    toast(bad.length ? pt(bad[0].message, lang) : L('f.reading_saved'));
    location.hash = `#/case/${caseId}`;
  }

  $('#manual').onclick = () => {
    $('#out').innerHTML = `<div class="card">
      <label class="f" for="v1">${esc(L('value'))}</label><input id="v1" type="text" inputmode="decimal" placeholder="11.4" autocomplete="off">
      <label class="f" for="v2">${esc(L('typeAgain'))}</label><input id="v2" type="text" inputmode="decimal" autocomplete="off">
      <label class="f" for="un">${esc(L('unit'))}</label>${unitSelect('g/dL')}
      ${deviceTime}
      <p class="hint" id="mm"></p>
      <button class="btn btn-ok btn-block" id="sv" disabled style="margin-top:14px">${esc(L('saveReading'))}</button></div>`;
    const chk = () => {
      const a = $('#v1').value.replace(',', '.').trim(), b = $('#v2').value.replace(',', '.').trim();
      const ok = a && a === b && Number.isFinite(Number(a)) && $('#un').value;
      $('#mm').textContent = a && b && a !== b ? L('mismatch') : '';
      $('#sv').disabled = !ok;
    };
    ['v1', 'v2', 'un'].forEach((id) => $(`#${id}`).addEventListener('input', chk));
    $('#sv').onclick = () => save({ value: Number($('#v1').value.replace(',', '.')), unit: $('#un').value, method: 'manual' });
    $('#v1').focus();
  };

  $('#cam').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    $('#out').innerHTML = `<div class="card"><img class="photo" src="${url}" alt="Photo of device screen"><p style="margin-top:12px"><span class="spinner"></span> <span id="pm">${esc(L('loadingEngine'))}</span></p><div class="progress"><i id="pb"></i></div></div>`;
    const imageHash = await sha256(file);
    let r;
    try {
      r = await readDisplay(file, (m) => {
        if (m.status === 'recognizing text') { $('#pm') && ($('#pm').textContent = L('readingOnPhone')); }
        if ($('#pb')) $('#pb').style.width = `${Math.round((m.progress ?? 0) * 100)}%`;
      });
    } catch (err) {
      r = { status: 'no_reading', reasons: [String(err.message ?? err)], text: '', candidates: [] };
    }
    const readingKey = `img:${caseId}:${imageHash.slice(0, 16)}`;
    await client.putBlob(readingKey, file);
    const ocr = { status: r.status, text: (r.text ?? '').slice(0, 400), reasons: r.reasons, engine: r.engine, ms: r.ms };
    const msg = tr(OCR_STATUS_TEXT[r.status], lang);
    const raw = `<details><summary>${esc(L('whatRead'))}</summary><pre class="ocr">${esc(r.text || '—')}</pre><p class="hint">${esc((r.reasons ?? []).join(' · '))}${r.ms ? ` · ${r.ms} ms` : ''}</p></details>`;
    if (r.status === 'candidate') {
      $('#out').innerHTML = `<div class="card"><img class="photo" src="${url}" alt="Photo of device screen">
        <div class="reading-big"><span class="v" id="bigv">${esc(r.value)}</span><span class="u">${esc(r.unit ?? '?')}</span></div>
        <p style="text-align:center"><b>${esc(L('compare'))}</b></p>
        ${!r.unit ? `<label class="f" for="un">${esc(L('unit'))}</label>${unitSelect(null)}` : ''}
        ${deviceTime}
        <div class="row" style="margin-top:14px"><button class="btn btn-ok" id="yes">✓ ${esc(L('matches'))}</button><button class="btn btn-ghost" id="fix">${esc(L('correctIt'))}</button></div>
        <div id="fixer" hidden><label class="f" for="cv">${esc(L('value'))}</label><input id="cv" type="text" inputmode="decimal" value="${esc(r.value)}"><button class="btn btn-ok btn-block" id="svc" style="margin-top:10px">${esc(L('saveReading'))}</button></div>
        ${raw}</div>`;
      const unit = () => r.unit ?? $('#un')?.value;
      $('#yes').onclick = () => { if (!unit()) return toast(L('chooseUnit')); save({ value: r.value, unit: unit(), method: s.patient && isSelf() ? 'lab_report' : 'camera_ocr', ocr, imageHash }); };
      $('#fix').onclick = () => { $('#fixer').hidden = false; $('#cv').focus(); };
      $('#svc').onclick = () => { const v = Number($('#cv').value.replace(',', '.')); if (!Number.isFinite(v) || !unit()) return toast(L('chooseUnit')); save({ value: v, unit: unit(), method: isSelf() ? 'lab_report' : 'camera_ocr', ocr, imageHash, capturedValue: r.value }); };
    } else {
      $('#out').innerHTML = `<div class="card"><img class="photo" src="${url}" alt="Photo of device screen">
        <div class="flag warn" style="margin-top:12px"><span class="ic">!</span><div class="fm"><b>${esc(msg)}</b><div class="fc">${esc(L('f.femos_never_guesses_an_unclear_reading'))}</div></div></div>
        <div class="row" style="margin-top:12px"><label class="btn btn-primary">${esc(L('retake'))}<input type="file" accept="image/*" capture="environment" hidden id="cam2"></label><button class="btn btn-ghost" id="man2">${esc(L('typeInstead'))}</button></div>
        ${raw}</div>`;
      $('#cam2').onchange = (ev2) => { $('#cam').files = ev2.target.files; $('#cam').dispatchEvent(new Event('change')); };
      $('#man2').onclick = () => $('#manual').click();
    }
  };
}


const STATUS_CLS = { validated: 'ok', 'synthetic-tested': 'info', implemented: 'plum', planned: '', 'manual-only': '' };
function screenKit() {
  const modeLabel = { camera_ocr: L('f.camera_2'), ble_gatt: 'Bluetooth', usb_serial: 'USB', lab_file: L('f.lab_file'), manual: L('f.typed') };
  view().innerHTML = `
    <a class="back" href="#/">← ${esc(L('back'))}</a>
    <h1>${esc(L('f.femos_device_kit'))}</h1>
    <p class="lead">${esc(L('f.no_new_hardware_femos_reads_the'))}</p>
    <div class="card"><p class="small">${esc(registry.note)}</p>
      <div class="row small" style="margin-top:6px">${Object.entries(registry.statusLegend).map(([k, v]) => `<span class="chip ${STATUS_CLS[k]}" title="${esc(v)}">${esc(k)}</span>`).join('')}</div></div>
    <h2>${esc(L('f.devices'))}</h2>
    <div class="list">${registry.devices.map((d) => `<div class="card" style="margin:0"><div style="display:flex;justify-content:space-between;gap:10px"><div><h3 style="margin:0">${esc(d.make)} ${esc(d.model)}</h3><p class="muted small">${esc(d.segment)}</p></div><span class="chip">${esc(d.kind)}</span></div>
      <div class="row" style="margin-top:6px">${Object.entries(d.modes).map(([m, st]) => `<span class="chip ${STATUS_CLS[st]}">${esc(modeLabel[m] ?? m)} · ${esc(st)}</span>`).join('')}</div>
      ${d.notes ? `<p class="hint">${esc(d.notes)}</p>` : ''}${d.priceIndicativeINR ? `<p class="hint">₹ ${esc(d.priceIndicativeINR)}</p>` : ''}
      ${d.modes.ble_gatt && d.modes.ble_gatt !== 'planned' ? `<button class="btn btn-ghost" data-ble="${esc(d.kind)}" style="margin-top:8px">${esc(L('f.test_via_bluetooth'))}</button>` : ''}</div>`).join('')}</div>
    <div id="bleout"></div>
    <h2>${esc(L('f.kit_options'))}</h2>
    <div class="list">${registry.kits.map((k) => `<div class="item"><span class="t">${esc(k.name)}${k.recommended ? ' <span class="chip ok">recommended</span>' : ''}</span><span class="r small">₹ ${esc(k.incrementalCostINR)}</span><span class="s">${esc(k.contents.join(' · '))}</span></div>`).join('')}</div>
    <div class="foot">${esc(L('f.prices_are_planning_estimates_from_earlier'))}</div>`;
  view().querySelectorAll('[data-ble]').forEach((b) => (b.onclick = async () => {
    $('#bleout').innerHTML = `<div class="card"><span class="spinner"></span> ${esc(L('f.choose_the_device_and_take_a'))}</div>`;
    try {
      const r = await readViaWebBluetooth(b.dataset.ble);
      $('#bleout').innerHTML = `<div class="card"><h3>${esc(r.device?.name ?? 'Device')} · ${esc(r.kind)}</h3>${r.values.map((v) => `<div class="found"><span>${esc(v.name)}</span><span class="fv">${esc(v.value)} ${esc(v.unit)}</span></div>`).join('')}<p class="hint">${esc(r.quality)}${r.problems?.length ? ` · ${esc(r.problems.join(', '))}` : ''} · ${esc(L('f.ncd_module_is_next_this_test'))}</p></div>`;
    } catch (e) {
      $('#bleout').innerHTML = `<div class="flag warn"><span class="ic">!</span><div class="fm">${esc(e.message)}</div></div>`;
    }
  }));
}

// ---------- router ----------
function route() {
  applyLang();
  if (!actor && location.hash !== '#/role') { location.hash = '#/role'; return; }
  const h = location.hash.slice(1) || '/';
  const m = h.match(/^\/case\/([^/]+)(?:\/(history|reading))?$/);
  window.scrollTo(0, 0);
  if (h === '/role') screenRole();
  else if (h === '/kit') screenKit();
  else if (h === '/new') screenNew();
  else if (m && m[2] === 'history') screenHistory(decodeURIComponent(m[1]));
  else if (m && m[2] === 'reading') screenReading(decodeURIComponent(m[1]));
  else if (m) screenCase(decodeURIComponent(m[1]));
  else screenHome();
  $('#view').focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
