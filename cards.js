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

  // the fallback lives in a data attribute: BLANK holds quotes, which broke the inline handler ("Unexpected identifier 'http'")
  const logo = (t, cls) => `<img class="${cls}" src="${esc(t.logo || BLANK)}" alt="" loading="lazy" decoding="async" data-fb="${esc(BLANK)}" ${t.onerr || `onerror="this.onerror=null;this.src=this.dataset.fb"`}>`;
  const badge = (o) => o.state === 'in' ? '<span class="mx-badge live"><i></i>Live</span>' : o.state === 'post' ? '<span class="mx-badge">Final</span>' : `<span class="mx-badge">${esc(o.note || 'Upcoming')}</span>`;
  const time = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP]M)$/i, '<small>$1</small>');
  // Team Colors paints a card in the two teams' own colours: each is darkened until white type on it passes 4.5:1,
  // the away side falls back to its second colour when the two are too alike, and a team with no colour gets the theme's pair.
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, n >> 8 & 255, n & 255] };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]) };
  const safe = h => { let c = rgb(h); if (!c) return null; for (let i = 0; i < 60 && 1.05 / (lum(c) + .05) < 4.5; i++) c = c.map(v => Math.round(v * .94)); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('') };
  const near = (a, b) => { const x = rgb(a), y = rgb(b); return !!x && !!y && Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 70 };
  const colours = o => { const h = safe(o.hc); let a = safe(o.ac); if (h && a && near(h, a)) { const a2 = safe(o.ac2); a = a2 && !near(h, a2) ? a2 : null }
    return `--hc:${o.hc || 'var(--muted)'};--ac:${o.ac || 'var(--muted)'};--hcs:${h || 'var(--team-a)'};--acs:${a || 'var(--team-b)'}` };
  window.flTeamColours = colours;
  // the watch dial some themes draw around the featured score: 60 ticks, 12 longer ones, and an arc for the minutes played
  const dial = o => { const m = /^(\d+)(?:\+\d+)?'/.exec(o.clock || ''), p = o.progress != null ? o.progress : o.state === 'post' ? 1 : o.state !== 'in' ? 0 : /^HT/i.test(o.clock || '') ? .5 : m ? Math.min(1, +m[1] / 90) : 0;
    return `<svg class="mx-dial" viewBox="0 0 300 300" aria-hidden="true"><circle class="d-min" cx="150" cy="150" r="140"/><circle class="d-maj" cx="150" cy="150" r="140"/><circle class="d-ring" cx="150" cy="150" r="122"/>${p > 0 ? `<circle class="d-arc" cx="150" cy="150" r="122" pathLength="100" stroke-dasharray="${(p * 100).toFixed(1)} 100" transform="rotate(-90 150 150)"/>` : ''}</svg>` };
  function middle(o, big) {
    if (o.state === 'pre') { const cd = o.date && !o.note ? untilText(+o.date) : '';
      return `<span class="mx-mid pre">${big ? dial(o) : ''}<b class="mx-time num">${o.time ? esc(o.time) : o.date ? time(o.date) : ''}</b>${cd ? `<small class="mx-cd num" data-cd="${+o.date}">${cd}</small>` : `<small>${esc(o.sub || (o.date ? o.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : ''))}</small>`}</span>` }
    const [fa, fb] = o.state === 'in' ? bump(o.id, String(o.a.score), String(o.b.score)) : [false, false];
    return `<span class="mx-mid">${big ? dial(o) : ''}<span class="mx-sc num"><b class="${o.a.lose ? 'lose' : ''}${fa ? ' bump' : ''}">${esc(o.a.score)}</b><i>:</i><b class="${o.b.lose ? 'lose' : ''}${fb ? ' bump' : ''}">${esc(o.b.score)}</b></span><small class="${o.state === 'in' ? 'on' : ''}">${esc(o.state === 'in' ? o.clock : o.final || 'Final')}</small></span>`;
  }
  const side = (t, extra = '') => `<span class="mx-t${t.lose ? ' lose' : ''}${t.win ? ' win' : ''}">${logo(t, 'mx-logo')}<span class="mx-n">${t.rank ? `<em>${esc(t.rank)}</em>` : ''}${esc(t.name)}</span>${t.record ? `<small>${esc(t.record)}</small>` : ''}${extra}</span>`;

  /* the standard card: crest and name either side, score or start time in the middle */
  window.flCard = function (o) {
    return `<button class="m mx ${o.state === 'in' ? 'is-live' : o.state === 'post' ? 'is-final' : 'is-pre'}${o.cls ? ' ' + o.cls : ''}" ${o.attrs || ''} style="${colours(o)}" aria-label="${esc(o.label || '')}">
      <span class="mx-top">${badge(o)}${o.lg ? `<span class="mx-lg">${esc(o.lg)}</span>` : ''}${o.tv ? `<span class="mx-tv">${TV}${esc(o.tv)}</span>` : ''}</span>
      <span class="mx-main">${side(o.a)}${middle(o)}${side(o.b)}</span>${o.extra ? `<span class="mx-x">${o.extra}</span>` : ''}</button>`;
  };

  /* the featured card at the top of a day: the same facts, larger, with room for a playing-surface graphic or other panel */
  window.flFeature = function (o) {
    // as: 'article' when the card holds its own buttons (Home); a card that is one big button otherwise
    const tag = o.as || 'button';
    return `<${tag} class="ftr ${o.state === 'in' ? 'is-live' : o.state === 'post' ? 'is-final' : 'is-pre'}${o.panel ? ' has-panel' : ''}${o.cls ? ' ' + o.cls : ''}" ${o.attrs || ''} style="${colours(o)}" aria-label="${esc(o.label || '')}">
      <span class="ftr-body"><span class="mx-top">${badge(o)}${o.lg ? `<span class="mx-lg">${o.lgLogo ? `<img src="${esc(o.lgLogo)}" alt="">` : ''}${esc(o.lg)}</span>` : ''}${o.venue ? `<span class="mx-lg ftr-venue">${esc(o.venue)}</span>` : ''}${o.tv ? `<span class="mx-tv">${TV}${esc(o.tv)}</span>` : ''}</span>
        <span class="mx-main">${side(o.a, o.a.under || '')}${middle(o, true)}${side(o.b, o.b.under || '')}</span>${o.below || ''}${o.foot ? `<span class="ftr-foot">${esc(o.foot)}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>` : ''}${o.acts ? `<span class="ftr-acts">${o.acts}</span>` : ''}</span>
      ${o.panel ? `<span class="ftr-panel">${o.panel}</span>` : ''}</${tag}>`;
  };
  window.flCard.untilText = untilText;

  /* <fl-tilt>: a card that leans toward the pointer, like a trading card held in the hand (transform only, off for reduced motion) */
  customElements.define('fl-tilt', class extends HTMLElement {
    connectedCallback() {
      if (matchMedia('(prefers-reduced-motion:reduce)').matches || document.documentElement.dataset.motion === 'reduce' || matchMedia('(hover:none)').matches) return;
      let raf = 0;
      this.addEventListener('pointermove', ev => { const r = this.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { this.style.setProperty('--ry', ((x - .5) * 22).toFixed(1) + 'deg'); this.style.setProperty('--rx', ((.5 - y) * 18).toFixed(1) + 'deg'); this.style.setProperty('--mx', (x * 100).toFixed(0) + '%'); this.style.setProperty('--my', (y * 100).toFixed(0) + '%'); this.classList.add('tilting') }) });
      this.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); this.classList.remove('tilting'); this.style.setProperty('--rx', '0deg'); this.style.setProperty('--ry', '0deg') });
    }
  });
})();

/* Loading and error states shared by every sport: a shimmer that has the shape of a match page while it loads,
   and a friendly message with a button instead of a blank or frozen panel. */
window.flSkeleton = () => `<div class="fl-skel" aria-busy="true" aria-label="Loading">
  <div class="fl-skel-hero"><i class="sk-c"></i><i class="sk-s"></i><i class="sk-c"></i></div>
  <div class="fl-skel-tabs">${'<i></i>'.repeat(5)}</div>
  <div class="fl-skel-grid"><i></i><i></i><i></i><i></i></div></div>`;
window.flErrorState = (title, text, act, label = 'Try again', attr = 'data-act') => `<div class="fl-err" role="alert">
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>
  <b>${String(title).replace(/</g, '&lt;')}</b><p>${String(text).replace(/</g, '&lt;')}</p>
  ${act ? `<button class="btn fl-err-btn" ${attr}="${act}">${act === 'closesheet' ? 'Close' : label}</button>` : ''}</div>`;
