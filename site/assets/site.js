/* FEMOS site: theme, language, menu, reveal-on-scroll, live benchmark results. No dependencies. */
(function () {
  'use strict';
  var root = document.documentElement;

  function store(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  /* ---------- Theme ---------- */
  var themeBtn = document.querySelector('.theme-toggle');
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return mql && mql.matches ? 'dark' : 'light';
  }
  function syncThemeUI() {
    var dark = currentTheme() === 'dark';
    if (themeBtn) themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    var meta = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < meta.length; i++) meta[i].setAttribute('content', dark ? '#160b19' : '#fbf7f2');
  }
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    store('femos-theme', next);
    syncThemeUI();
  });
  if (mql && mql.addEventListener) mql.addEventListener('change', syncThemeUI);
  syncThemeUI();

  /* ---------- Language ----------
     English lives in the HTML. Hindi strings are below, keyed by data-i18n.
     Values are trusted, hand-written HTML. */
  var I18N = window.FEMOS_SITE_I18N || {};;

  var nodes = document.querySelectorAll('[data-i18n]');
  var EN = [];
  for (var n = 0; n < nodes.length; n++) EN.push(nodes[n].innerHTML);

  var LANGS = ['en', 'hi', 'bn', 'mr', 'ta'];
  var langSel = document.querySelector('.lang-select');
  function setLang(lang, persist) {
    if (LANGS.indexOf(lang) < 0) lang = 'en';
    var dict = lang === 'en' ? null : I18N[lang] || {};
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      nodes[i].innerHTML = dict && dict[key] ? dict[key] : EN[i];
    }
    root.setAttribute('lang', lang);
    if (langSel) langSel.value = lang;
    if (persist) store('femos-lang', lang);
  }
  if (langSel) langSel.addEventListener('change', function () { setLang(this.value, true); });
  if (root.getAttribute('lang') !== 'en') setLang(root.getAttribute('lang'), false);

  /* ---------- Header: scrolled state + mobile menu ---------- */
  var header = document.querySelector('.site-header');
  var menuBtn = document.querySelector('.menu-toggle');
  function onScroll() { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  function closeMenu() {
    if (!header || !menuBtn) return;
    header.classList.remove('nav-open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      var open = !header.classList.contains('nav-open');
      header.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('.site-nav a').forEach(function (a) { a.addEventListener('click', closeMenu); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('nav-open')) { closeMenu(); menuBtn.focus(); }
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var reveals = document.querySelectorAll('.reveal');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    for (var r = 0; r < reveals.length; r++) reveals[r].classList.add('is-in');
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (var k = 0; k < reveals.length; k++) io.observe(reveals[k]);
  }

  /* ---------- Results ---------- */
  var resultsRoot = document.getElementById('results-root');
  if (resultsRoot && window.fetch) {
    fetch('assets/results.json', { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('no results'); return res.json(); })
      .then(function (data) { if (data && typeof data === 'object') renderResults(data); })
      .catch(function () { /* keep the empty state */ });
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmt(v) { return v == null ? '–' : v.toLocaleString('en-IN'); }
  function pct(a, b) { return b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

  function big(value, of, label, tone) {
    var wrap = el('div');
    var line = el('p', 'res-big');
    var b = el('b', tone ? 'tone-' + tone : '', fmt(value));
    line.appendChild(b);
    if (of != null) line.appendChild(el('span', 'of', 'of ' + fmt(of)));
    wrap.appendChild(line);
    wrap.appendChild(el('p', 'res-big-label', label));
    return wrap;
  }
  /* segments: [{v, cls}] */
  function bar(segments, total) {
    var b = el('div', 'bar');
    b.setAttribute('aria-hidden', 'true');
    segments.forEach(function (s) {
      if (!s.v) return;
      var i = el('i', s.cls);
      i.style.width = pct(s.v, total) + '%';
      b.appendChild(i);
    });
    return b;
  }
  function row(label, valueText, segments, total) {
    var r = el('div', 'res-row');
    var top = el('div', 'res-row-top');
    top.appendChild(el('span', null, label));
    top.appendChild(el('span', null, valueText));
    r.appendChild(top);
    r.appendChild(bar(segments, total));
    return r;
  }
  function legend(items) {
    var l = el('p', 'legend');
    l.setAttribute('aria-hidden', 'true');
    items.forEach(function (it) {
      var s = el('span');
      var i = el('i', it[1]);
      s.appendChild(i);
      s.appendChild(document.createTextNode(it[0]));
      l.appendChild(s);
    });
    return l;
  }
  function kv(pairs) {
    var d = el('dl', 'kv');
    pairs.forEach(function (p) {
      if (p[1] == null) return;
      var w = el('div');
      w.appendChild(el('dt', null, p[0]));
      w.appendChild(el('dd', null, p[2] ? p[2](p[1]) : fmt(p[1])));
      d.appendChild(w);
    });
    return d;
  }
  function card(title) {
    var c = el('article', 'res-card');
    c.appendChild(el('h3', null, title));
    return c;
  }
  function label(s) { return String(s).replace(/[_-]+/g, ' '); }

  function renderResults(d) {
    var grid = el('div', 'res-grid');
    var any = false;

    /* OCR */
    var ocr = obj(d.ocr);
    if (ocr) {
      var images = num(ocr.images), unsafe = num(ocr.unsafe), correct = num(ocr.correct), rejected = num(ocr.rejected);
      var c = card('Reading device screens (OCR)');
      if (unsafe != null) c.appendChild(big(unsafe, images, 'Unsafe OCR reads accepted', unsafe === 0 ? 'ok' : 'bad'));
      c.appendChild(kv([['Images', images], ['Read correctly', correct], ['Rejected for retake', rejected]]));
      if (images) {
        var rows = el('div', 'res-rows');
        rows.appendChild(row('All images', fmt(correct) + ' correct · ' + fmt(rejected) + ' rejected',
          [{ v: correct, cls: 'b-ok' }, { v: rejected, cls: 'b-warn' }, { v: unsafe, cls: 'b-bad' }], images));
        var byc = obj(ocr.byCondition);
        if (byc) Object.keys(byc).forEach(function (name) {
          var x = obj(byc[name]); if (!x) return;
          var nn = num(x.n);
          if (!nn) return;
          rows.appendChild(row(label(name), fmt(num(x.correct)) + ' / ' + fmt(nn) + (num(x.unsafe) ? ' · ' + fmt(num(x.unsafe)) + ' unsafe' : ''),
            [{ v: num(x.correct), cls: 'b-ok' }, { v: num(x.rejected), cls: 'b-warn' }, { v: num(x.unsafe), cls: 'b-bad' }], nn));
        });
        c.appendChild(rows);
        c.appendChild(legend([['correct', 'b-ok'], ['rejected (retake)', 'b-warn'], ['unsafe accepted', 'b-bad']]));
      }
      grid.appendChild(c); any = true;
    }

    /* Checks */
    var ch = obj(d.checks);
    if (ch) {
      var planted = num(ch.planted), detected = num(ch.detected);
      var c2 = card('Finding planted errors (Check agent)');
      if (planted != null) c2.appendChild(big(detected, planted, 'Planted errors detected', detected === planted ? 'ok' : 'warn'));
      c2.appendChild(kv([['Cases', num(ch.cases)], ['False alarms', num(ch.falseAlarms)],
        ['Clean cases flagged', num(ch.cleanFlagged) != null ? num(ch.cleanFlagged) : null,
          function (v) { return fmt(v) + (num(ch.cleanCases) != null ? ' of ' + fmt(num(ch.cleanCases)) : ''); }]]));
      var bt = obj(ch.byType);
      if (bt) {
        var rows2 = el('div', 'res-rows');
        Object.keys(bt).forEach(function (code) {
          var x = obj(bt[code]); if (!x) return;
          var p = num(x.planted), dd = num(x.detected);
          if (!p) return;
          rows2.appendChild(row(label(code), fmt(dd) + ' / ' + fmt(p), [{ v: dd, cls: 'b-ok' }], p));
        });
        if (rows2.childNodes.length) c2.appendChild(rows2);
      }
      grid.appendChild(c2); any = true;
    }

    /* Learning */
    var le = obj(d.learning);
    if (le) {
      var c3 = card('Early detection on longitudinal test histories');
      c3.appendChild(kv([['Women', num(le.women)], ['Visits', num(le.visits)]]));
      var pats = obj(le.patterns);
      if (pats) {
        var rows3 = el('div', 'res-rows');
        Object.keys(pats).forEach(function (lvl) {
          var x = obj(pats[lvl]); if (!x) return;
          var p = num(x.planted), f = num(x.found);
          if (!p) return;
          var extra = [];
          if (num(x.falseAlarms) != null) extra.push(fmt(num(x.falseAlarms)) + ' false alarms');
          if (num(x.medianLeadDays) != null) extra.push('median ' + fmt(num(x.medianLeadDays)) + ' days earlier');
          rows3.appendChild(row(label(lvl), fmt(f) + ' / ' + fmt(p) + ' found' + (extra.length ? ' · ' + extra.join(' · ') : ''),
            [{ v: f, cls: 'b-plum' }], p));
        });
        if (rows3.childNodes.length) c3.appendChild(rows3);
      }
      grid.appendChild(c3); any = true;
    }

    /* Tests */
    var t = obj(d.tests);
    if (t) {
      var pass = num(t.pass), fail = num(t.fail);
      var total = (pass || 0) + (fail || 0);
      var c4 = card('Automated test suite');
      c4.appendChild(big(pass, total || null, 'Tests passing', fail ? 'bad' : 'ok'));
      if (total) {
        var rows4 = el('div', 'res-rows');
        rows4.appendChild(row('Pass / fail', fmt(pass) + ' pass · ' + fmt(fail || 0) + ' fail',
          [{ v: pass, cls: 'b-ok' }, { v: fail, cls: 'b-bad' }], total));
        c4.appendChild(rows4);
      }
      grid.appendChild(c4); any = true;
    }

    if (!any) return;
    resultsRoot.innerHTML = '';
    resultsRoot.appendChild(grid);
    var meta = el('p', 'res-meta');
    var when = d.generatedAt ? new Date(d.generatedAt) : null;
    meta.textContent = 'Generated ' + (when && !isNaN(when) ? when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'at an unknown time') +
      ' by the FEMOS open benchmark suite (npm run results).';
    resultsRoot.appendChild(meta);
  }
})();


// ---- FEMOS Kit: render the device registry (same file the field app uses) ----
(async function kit() {
  const box = document.getElementById('kit-devices');
  const opts = document.getElementById('kit-options');
  if (!box) return;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const label = { camera_ocr: 'Camera', ble_gatt: 'Bluetooth', usb_serial: 'USB', lab_file: 'Lab file', manual: 'Manual' };
  const cls = { validated: 'ok', 'bench-tested': 'info', implemented: 'plum', planned: 'muted', 'manual-only': 'muted' };
  try {
    const r = await fetch('adapters/registry.json');
    if (!r.ok) throw new Error(r.status);
    const reg = await r.json();
    const devices = reg.devices.filter((d) => !d.id.startsWith('synthetic'));
    box.innerHTML = `<div class="table-scroll"><table class="kit"><caption class="sr-only">Device compatibility</caption>
      <thead><tr><th scope="col">Device</th><th scope="col">Measures</th><th scope="col">How FEMOS reads it</th></tr></thead><tbody>
      ${devices.map((d) => `<tr><th scope="row"><strong>${esc(d.make)}</strong> ${esc(d.model)}<span>${esc(d.segment)}</span></th><td>${esc(d.measures ? d.measures.join(', ') : d.kind)}</td>
        <td><div class="modes">${Object.entries(d.modes).map(([m, s]) => `<span class="mode mode-${cls[s]}">${esc(label[m] ?? m)} · ${esc(s)}</span>`).join('')}</div></td></tr>`).join('')}
      </tbody></table></div>
      <p class="kit-legend">${Object.entries(reg.statusLegend).map(([k, v]) => `<span><b class="mode mode-${cls[k]}">${esc(k)}</b> ${esc(v)}</span>`).join('')}</p>`;
    opts.innerHTML = `<h3 class="kit-h">Kit options</h3><ul class="kit-list">${reg.kits.map((k) => `<li${k.recommended ? ' class="rec"' : ''}><div class="kit-name">${esc(k.name)}${k.recommended ? ' <span class="mode mode-ok">recommended</span>' : ''}</div><div class="kit-cost">₹ ${esc(k.incrementalCostINR)}</div><div class="kit-contents">${esc(k.contents.join(' · '))}</div></li>`).join('')}</ul>`;
  } catch {
    box.innerHTML = '<p class="muted">The device registry (adapters/registry.json) is available in the repository.</p>';
  }
})();
