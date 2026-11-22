/* Floodlight · Live: every game in play right now, in every sport, on one page.
   It reads the same list Home keeps fresh (home.js, every 30 seconds) and only draws it: by sport, live first,
   then what starts later today, then what has finished. A game opens on its own sport page, as it does from Home. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const SPORTS = [['all', 'All sports'], ['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC']];
  const L = { sport: 'all', show: 'live', timer: 0, view: (() => { try { return localStorage.getItem('fl.liveView') === 'compact' ? 'compact' : 'cards' } catch { return 'cards' } })() };
  const hub = () => window.flHub;
  const hubAttr = g => `data-live="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}"`;

  function render(el) {
    const H = hub(), games = H?.games() || [], ready = !!H?.at();
    const ufcLive = (H?.ufc() || []).filter(e => e.state === 'in');
    const inSport = g => L.sport === 'all' || g.sport === L.sport;
    const live = games.filter(g => g.state === 'in'), next = games.filter(g => g.state === 'pre').sort((a, b) => a.date - b.date), done = games.filter(g => g.state === 'post').sort((a, b) => b.date - a.date);
    const count = k => live.filter(g => k === 'all' || g.sport === k).length + (k === 'all' || k === 'ufc' ? ufcLive.length : 0);
    const set = L.show === 'live' ? live : L.show === 'next' ? next : done, list = set.filter(inSport);
    const groups = new Map(); for (const g of list) { const k = g.short || g.sport; (groups.get(k) || groups.set(k, []).get(k)).push(g) }
    const ufcBlock = L.show === 'live' && (L.sport === 'all' || L.sport === 'ufc') ? ufcLive.map(e => `<button type="button" class="card hit lv-ufc" data-livego="ufc"><span class="pl live"><i></i>Live</span><span class="rw-t"><b>${esc(e.name)}</b><small>${esc(e.live ? `${e.live.a.name} v ${e.live.b.name} · ${e.live.detail}` : 'Fight night under way')}</small></span>${ic('arrow', 18)}</button>`).join('') : '';
    const none = L.show === 'live' ? ['Nothing is live right now', next.filter(inSport)[0] ? `Next up: ${next.filter(inSport)[0].a.name} v ${next.filter(inSport)[0].b.name} at ${next.filter(inSport)[0].date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Nothing else is scheduled today in this sport.', 'next', 'See what is up next']
      : L.show === 'next' ? ['Nothing more to start today', 'Every game on today’s board has started or finished.', 'live', 'See what is live'] : ['Nothing has finished yet', 'Results from today’s games collect here.', 'live', 'See what is live'];
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Live</h1><p class="pg-sub">Every game in play, in every sport. Scores update on their own.</p></div>
        <div class="seg" role="radiogroup" aria-label="Show">${[['live', `Live${live.length + ufcLive.length ? ` · ${live.length + ufcLive.length}` : ''}`], ['next', 'Up next'], ['done', 'Finished']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${L.show === k}" data-liveshow="${k}">${l}</button>`).join('')}</div></header>
      <div class="lv-opts"><div class="seg" role="radiogroup" aria-label="View">${[['cards', 'Cards'], ['compact', 'Compact']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${L.view === k}" class="${L.view === k ? 'on' : ''}" tabindex="${L.view === k ? 0 : -1}" data-liveview="${k}">${l}</button>`).join('')}</div>
        <label class="lv-sp"><input class="sw" type="checkbox" role="switch" id="lvSpoil" ${window.flMC?.spoilAll() ? 'checked' : ''}> Spoiler-free <span class="lb">hide scores until I reveal them</span></label></div>
      <div class="cx-row scroll" role="group" aria-label="Sport">${SPORTS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${L.sport === k}" data-livesport="${k}">${esc(l)}${count(k) ? `<b class="lv-n num" aria-label="${count(k)} live">${count(k)}</b>` : ''}</button>`).join('')}</div>
      ${!ready ? `<div class="g4">${'<div class="skl hm-card-skl"></div>'.repeat(8)}</div>`
        : !list.length && !ufcBlock ? `<div class="card emp">${ic('live', 30)}<b>${none[0]}</b><p>${esc(none[1])}</p><button type="button" class="bt ghost" data-liveshow="${none[2]}">${none[3]}</button></div>`
        : `${ufcBlock}${[...groups].map(([k, gs]) => `<section class="lv-g" aria-label="${esc(k)}"><div class="sec-h"><h2>${esc(k)}</h2><span class="lb">${gs.length} game${gs.length === 1 ? '' : 's'}</span></div>${L.view === 'compact' ? `<div class="card lv-rows">${gs.map(row).join('')}</div>` : `<div class="g4 hm-cards">${gs.map(g => window.flCard({ ...cardFacts(g), attrs: hubAttr(g) })).join('')}</div>`}</section>`).join('')}`}`;
  }
  // the same card Home draws
  const TINT = 'var(--muted)';
  const cardFacts = g => ({ id: 'lv' + g.key, hc: g.a.color || TINT, ac: g.b.color || TINT, label: `${g.a.full || g.a.name} ${g.state === 'pre' ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}, ${g.short}`, state: g.state, lg: g.lgName || g.short, tv: g.tv,
    a: { name: g.a.name, logo: g.a.logo, score: g.a.score, rank: g.a.rank, lose: g.state === 'post' && g.b.winner, win: g.a.winner }, b: { name: g.b.name, logo: g.b.logo, score: g.b.score, rank: g.b.rank, lose: g.state === 'post' && g.a.winner, win: g.b.winner },
    clock: g.clock, final: g.final, note: g.note, date: g.date, ...(g.state !== 'pre' && window.flMC?.spoil(g.key) ? { spoil: true } : {}) });
  // the compact view: one line a game, for scanning a long night
  const row = g => { const sp = g.state !== 'pre' && window.flMC?.spoil(g.key), t = (x, o) => `<span class="lv-t${!sp && g.state === 'post' && o.winner ? ' lose' : ''}">${x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '<i></i>'}<span>${x.rank ? `<em>${esc(x.rank)}</em> ` : ''}${esc(x.name)}</span>${g.state === 'pre' ? '' : `<b class="num">${sp ? '–' : esc(x.score)}</b>`}</span>`;
    return `<button type="button" class="lv-row${g.state === 'in' ? ' is-live' : ''}" ${hubAttr(g)} aria-label="${esc(`${g.a.full || g.a.name} ${g.state === 'pre' || sp ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}${sp ? ', score hidden' : ''}`)}">
      <span class="lv-when num${g.state === 'in' ? ' on' : ''}">${g.state === 'pre' ? esc(g.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : sp ? (g.state === 'in' ? 'Live' : 'Final') : esc(g.state === 'in' ? g.clock : g.final || 'Final')}</span>
      <span class="lv-ts">${t(g.a, g.b)}${t(g.b, g.a)}</span>${g.tv ? `<span class="lb lv-tv">${esc(g.tv)}</span>` : ''}</button>` };
  const page = () => document.getElementById('pg-live');
  const redraw = () => { const el = page(); if (!el || el.hidden) return; const a = document.activeElement, key = el.contains(a) ? a.id === 'lvSpoil' ? '#lvSpoil' : ['data-live', 'data-livesport', 'data-liveshow', 'data-liveview'].map(k => a.hasAttribute(k) ? `[${k}="${CSS.escape(a.getAttribute(k))}"]` : '').find(Boolean) : null;
    render(el); if (key) el.querySelector(key)?.focus({ preventScroll: true }) };
  document.addEventListener('fl:hub', redraw); document.addEventListener('fl:spoil', redraw);
  document.addEventListener('change', ev => { if (ev.target.id === 'lvSpoil') window.flMC?.setSpoilAll(ev.target.checked) });
  document.addEventListener('click', ev => {
    const el = page(); if (!el || el.hidden || !el.contains(ev.target)) return;
    const s = ev.target.closest('[data-livesport]'); if (s) { L.sport = s.dataset.livesport; return redraw() }
    const w = ev.target.closest('[data-liveshow]'); if (w) { L.show = w.dataset.liveshow; redraw(); return el.querySelector(`[data-liveshow="${L.show}"]`)?.focus() }
    const v = ev.target.closest('[data-liveview]'); if (v) { L.view = v.dataset.liveview; try { localStorage.setItem('fl.liveView', L.view) } catch {} redraw(); return el.querySelector(`[data-liveview="${L.view}"]`)?.focus() }
    const u = ev.target.closest('[data-livego]'); if (u) { window.flPages.hide(); return document.querySelector('.tbs[data-sport="ufc"]')?.click() }
    const g = ev.target.closest('[data-live]'); if (!g) return;
    const [sport, lg, id] = g.dataset.live.split('|'); window.flPages.hide(); hub()?.open({ sport, lg, id });
  });
  window.flPages?.add('live', { title: 'Live', render, fresh: true,
    onShow() { hub()?.today(); clearInterval(L.timer); L.timer = setInterval(() => { if (!document.hidden) hub()?.load(true) }, 30000) },
    onHide() { clearInterval(L.timer) } });
})();
