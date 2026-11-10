/* Homepage: fill the stats band from the latest published benchmark run (assets/results.json). */
(function () {
  if (!window.fetch) return;
  fetch('assets/results.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var set = function (k, v) { var el = document.querySelector('[data-stat="' + k + '"]'); if (el && v != null) el.textContent = v; };
      if (d.checks && d.checks.planted) set('errors', d.checks.detected + '/' + d.checks.planted);
      var ind = d.learning && d.learning.patterns && d.learning.patterns.individual;
      if (ind && ind.medianLeadDays) set('lead', Math.round(ind.medianLeadDays) + (document.documentElement.lang === 'en' ? ' days' : ''));
    })
    .catch(function () {});
})();
