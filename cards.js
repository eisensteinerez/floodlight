/* Floodlight · matchup cards. One card and one featured card shared by every sport.
   A sport hands over plain facts (teams, score, state, clock) and gets the markup back, so every sport looks the same
   and a change to the card is made once, here. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='4' fill='%23777'/%3E%3C/svg%3E";
  const TV = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>';

  /* a score that has just changed flashes for a few seconds, however many times the list is redrawn meanwhile */
  const seen = new Map(), hot = new Map();
  function bump(id, a, b) {
    if (id == null) return [false, false];
    const was = seen.get(id), now = Date.now(); seen.set(id, [a, b]);
    if (was && (was[0] !== a || was[1] !== b)) hot.set(id, { until: now + 6000, a: was[0] !== a, b: was[1] !== b });
    const h = hot.get(id); if (h && h.until < now) { hot.delete(id); return [false, false] }
    return h ? [h.a, h.b] : [false, false];
  }

  /* countdown text for a start time: hours and minutes far out, a ticking clock inside the last hour */
  function untilText(ts) {
    const s = Math.round((ts - Date.now()) / 1000); if (s <= 0) return 'Starting';
    if (s >= 86400) return '';
    if (s >= 3600) return `in ${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
    return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  setInterval(() => { if (document.hidden) return; document.querySelectorAll('[data-cd]').forEach(el => { const t = untilText(+el.dataset.cd); if (t && el.textContent !== t) el.textContent = t }) }, 1000);

  const logo = (t, cls) => `<img class="${cls}" src="${esc(t.logo || BLANK)}" alt="" loading="lazy" decoding="async" ${t.onerr || `onerror="this.onerror=null;this.src='${BLANK}'"`}>`;
  const badge = (o) => o.state === 'in' ? '<span class="mx-badge live"><i></i>Live</span>' : o.state === 'post' ? '<span class="mx-badge">Final</span>' : `<span class="mx-badge">${esc(o.note || 'Upcoming')}</span>`;
  const time = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP]M)$/i, '<small>$1</small>');
  function middle(o, big) {
    if (o.state === 'pre') { const cd = o.date && !o.note ? untilText(+o.date) : '';
      return `<span class="mx-mid pre"><b class="mx-time num">${o.time ? esc(o.time) : o.date ? time(o.date) : ''}</b>${cd ? `<small class="mx-cd num" data-cd="${+o.date}">${cd}</small>` : `<small>${esc(o.sub || (o.date ? o.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : ''))}</small>`}</span>` }
    const [fa, fb] = o.state === 'in' ? bump(o.id, String(o.a.score), String(o.b.score)) : [false, false];
    return `<span class="mx-mid"><span class="mx-sc num"><b class="${o.a.lose ? 'lose' : ''}${fa ? ' bump' : ''}">${esc(o.a.score)}</b><i>:</i><b class="${o.b.lose ? 'lose' : ''}${fb ? ' bump' : ''}">${esc(o.b.score)}</b></span><small class="${o.state === 'in' ? 'on' : ''}">${esc(o.state === 'in' ? o.clock : o.final || 'Final')}</small></span>`;
  }
  const side = (t, extra = '') => `<span class="mx-t${t.lose ? ' lose' : ''}${t.win ? ' win' : ''}">${logo(t, 'mx-logo')}<span class="mx-n">${t.rank ? `<em>${esc(t.rank)}</em>` : ''}${esc(t.name)}</span>${t.record ? `<small>${esc(t.record)}</small>` : ''}${extra}</span>`;
  const colours = o => `--hc:${o.hc || 'var(--muted)'};--ac:${o.ac || 'var(--muted)'}`;

  /* the standard card: crest and name either side, score or start time in the middle */
  window.flCard = function (o) {
    return `<button class="m mx ${o.state === 'in' ? 'is-live' : o.state === 'post' ? 'is-final' : 'is-pre'}${o.cls ? ' ' + o.cls : ''}" ${o.attrs || ''} style="${colours(o)}" aria-label="${esc(o.label || '')}">
      <span class="mx-top">${badge(o)}${o.lg ? `<span class="mx-lg">${esc(o.lg)}</span>` : ''}${o.tv ? `<span class="mx-tv">${TV}${esc(o.tv)}</span>` : ''}</span>
      <span class="mx-main">${side(o.a)}${middle(o)}${side(o.b)}</span>${o.extra ? `<span class="mx-x">${o.extra}</span>` : ''}</button>`;
  };

  /* the featured card at the top of a day: the same facts, larger, with room for a playing-surface graphic or other panel */
  window.flFeature = function (o) {
    return `<button class="ftr ${o.state === 'in' ? 'is-live' : o.state === 'post' ? 'is-final' : 'is-pre'}${o.panel ? ' has-panel' : ''}${o.cls ? ' ' + o.cls : ''}" ${o.attrs || ''} style="${colours(o)}" aria-label="${esc(o.label || '')}">
      <span class="ftr-body"><span class="mx-top">${badge(o)}${o.lg ? `<span class="mx-lg">${o.lgLogo ? `<img src="${esc(o.lgLogo)}" alt="">` : ''}${esc(o.lg)}</span>` : ''}${o.venue ? `<span class="mx-lg ftr-venue">${esc(o.venue)}</span>` : ''}${o.tv ? `<span class="mx-tv">${TV}${esc(o.tv)}</span>` : ''}</span>
        <span class="mx-main">${side(o.a, o.a.under || '')}${middle(o, true)}${side(o.b, o.b.under || '')}</span>${o.below || ''}${o.foot ? `<span class="ftr-foot">${esc(o.foot)}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>` : ''}</span>
      ${o.panel ? `<span class="ftr-panel">${o.panel}</span>` : ''}</button>`;
  };
  window.flCard.untilText = untilText;
})();
