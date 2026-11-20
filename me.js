/* Floodlight · My profile: who you are here, how your parlays and picks have gone, what you follow, and the themes you like.
   Everything on it is counted from your own saved parlays (parlaycore.js) and your own match picks. With nothing
   finished yet, a section says so; it never shows a sample number. Signing in and editing still happen in the profile
   drawer (index.html); this page opens it. */
(() => {
  if (!window.flPages) return;
  const C = window.flParlay;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const pct = x => Math.round(x * 100);
  const fmt = v => C ? C.fmt(v) : String(v);
  const r2 = v => Math.round(v * 100) / 100;
  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(r2(Math.abs(v)));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const me = () => window.S?.me || null;
  const M = { mode: '', tip: null };

  /* ---------- the header ---------- */
  function head(S) {
    const u = me();
    const record = S && S.n ? `<div class="me-score" aria-label="${esc(`Parlay record: ${S.won} won, ${S.lost} lost${S.push ? `, ${plural(S.push, 'push', 'pushes')}` : ''}`)}"><span class="lb">Parlay record</span><b class="fig num">${S.won}–${S.lost}</b>
        <span class="me-score-s">${S.rate == null ? '' : `${pct(S.rate)}% hit`}${S.units != null ? ` · ${signed(S.units)} units` : ''}</span></div>` : '';
    if (!u) return `<section class="card feature me-head guest" aria-label="Your profile"><span class="me-av guest" aria-hidden="true">${ic('profile', 44)}</span>
      <div class="me-id"><h1 class="pg-title" tabindex="-1">Your profile</h1><p class="me-bio">You're browsing as a guest. Your parlays, picks and favorites are kept in this browser. Log in to keep them with your name on any device.</p>
        <div class="cx-row me-acts"><button type="button" class="bt" data-me="login">Log in</button><button type="button" class="bt ghost" data-me="signup">Create account</button></div></div>${record}</section>`;
    const since = u.created ? new Date(u.created * 1000).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '';
    const role = u.role === 'admin' || u.role === 'owner' ? 'Owner' : u.role === 'manager' ? 'Admin' : u.role === 'pending' || u.status === 'paused' ? 'Paused' : 'Member';
    return `<section class="card feature me-head" aria-label="Your profile"><span class="me-av" style="--av:${esc(u.prefs?.color || 'var(--accent-fill)')}" aria-hidden="true">${initials(u.display)}</span>
      <div class="me-id"><h1 class="pg-title" tabindex="-1">${esc(u.display)}</h1><p class="me-meta"><span>@${esc(u.username)}</span>${since ? `<span>Member since ${esc(since)}</span>` : ''}<span class="pl">${role}</span></p>
        ${u.prefs?.bio ? `<p class="me-bio">${esc(u.prefs.bio)}</p>` : `<p class="me-bio none">No bio yet. Say who you support and what you follow.</p>`}
        <div class="cx-row me-acts"><button type="button" class="bt" data-me="edit">${ic('edit', 18)}Edit profile</button><button type="button" class="bt ghost" data-page="settings">${ic('gear', 18)}Settings</button></div></div>${record}</section>`;
  }

  /* ---------- the results chart: one line, a step for each finished parlay ----------
     Units when the parlays have a price, wins minus losses when they don't. A win is a filled dot and a loss an open
     square, so the two never depend on colour. The same numbers are in the table under it. */
  function chart(S) {
    const priced = S.series.filter(s => s.u != null), mode = M.mode || (priced.length >= 2 ? 'units' : 'net'), units = mode === 'units';
    let run = 0; const pts = (units ? priced : S.series.filter(s => s.status !== 'push')).map((s, i) => { run = units ? run + s.u : run + (s.status === 'won' ? 1 : -1); return { ...s, i: i + 1, y: run } });
    if (!pts.length) return '';
    const small = matchMedia('(max-width:700px)').matches, W = small ? 350 : 720, H = small ? 210 : 240, L = 46, R = 18, T = 22, B = 30, ys = [0, ...pts.map(p => p.y)], lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo || 1) * .12, y0 = lo - pad, y1 = hi + pad;
    const X = i => L + (pts.length === 1 ? .5 : i / pts.length) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    let d = `M${X(0).toFixed(1)},${Y(0).toFixed(1)}`; pts.forEach(p => { d += ` H${X(p.i).toFixed(1)} V${Y(p.y).toFixed(1)}` });
    const ticks = [...new Set([lo, 0, hi])].filter(v => Math.abs(Y(v) - Y(0)) > 16 || v === 0), lab = v => units ? signed(v) : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
    const end = pts[pts.length - 1], few = pts.length <= 40;
    const marks = pts.map(p => { const x = X(p.i), y = Y(p.y), t = `${p.name || plural(p.n, 'pick')}: ${p.status === 'won' ? 'won' : 'lost'}${p.u != null ? `, ${signed(p.u)} units` : ''}. Running total ${lab(p.y)}${units ? ' units' : ''}.`;
      return `<g class="me-pt ${p.status}" data-tip="${esc(t)}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}">${few ? (p.status === 'won' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"/>` : `<rect x="${(x - 4.5).toFixed(1)}" y="${(y - 4.5).toFixed(1)}" width="9" height="9" rx="1.5"/>`) : ''}<rect class="hit" x="${(x - Math.max(6, (W - L - R) / pts.length / 2)).toFixed(1)}" y="${T}" width="${Math.max(12, (W - L - R) / pts.length).toFixed(1)}" height="${H - T - B}"/></g>` }).join('');
    const seg = priced.length >= 2 && S.series.some(s => s.u == null && s.status !== 'push') || priced.length >= 2 ? `<div class="seg me-mode" role="radiogroup" aria-label="What the chart counts">${[['units', 'Units'], ['net', 'Wins minus losses']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${mode === k}" class="${mode === k ? 'on' : ''}" tabindex="${mode === k ? 0 : -1}" data-memode="${k}">${l}</button>`).join('')}</div>` : '';
    return `<figure class="me-chart"><div class="me-chart-h"><figcaption><b>${units ? 'Units won and lost' : 'Wins minus losses'}</b><span class="lb">One step for each finished parlay, oldest first${units && priced.length < S.series.filter(s => s.status !== 'push').length ? `. ${plural(S.series.filter(s => s.status !== 'push').length - priced.length, 'parlay')} with no price ${S.series.filter(s => s.status !== 'push').length - priced.length === 1 ? 'is' : 'are'} left out` : ''}${units && S.est ? '. Parlays without your own odds use the fair price at the start' : ''}.</span></figcaption>${seg}</div>
      <div class="me-plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${units ? 'Units' : 'Wins minus losses'} over ${plural(pts.length, 'finished parlay')}: now ${lab(end.y)}${units ? ' units' : ''}. Highest ${lab(hi)}, lowest ${lab(lo)}.`)}">
        ${ticks.map(v => `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${lab(v)}</text>`).join('')}
        <text class="ax" x="${L}" y="${H - 8}">First</text><text class="ax" x="${W - R}" y="${H - 8}" text-anchor="end">Latest</text>
        <path class="line" d="${d}"/>${marks}<text class="end" x="${Math.min(W - R, X(end.i)).toFixed(1)}" y="${(Y(end.y) - 12).toFixed(1)}" text-anchor="end">${lab(end.y)}${units ? ' units' : ''}</text></svg><div class="me-tip" id="meTip" role="status" hidden></div></div>
      <div class="me-key" aria-hidden="true"><span><i class="won"></i>Won</span><span><i class="lost"></i>Lost</span></div>
      <details class="pd-tbl"><summary>See the numbers</summary><div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">Parlay</th><th scope="col">Result</th><th scope="col" class="r">${units ? 'Units' : 'Picks'}</th><th scope="col" class="r">Running total</th></tr></thead>
        <tbody>${pts.slice().reverse().slice(0, 60).map(p => `<tr><th scope="row">${esc(p.name || plural(p.n, 'pick'))}<small class="lb"> ${esc(new Date(p.t).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</small></th><td>${p.status === 'won' ? 'Won' : 'Lost'}</td><td class="r num">${units ? signed(p.u) : p.n}</td><td class="r num">${lab(p.y)}</td></tr>`).join('')}</tbody></table></div></details></figure>`;
  }
  const split = (title, rows, noun) => rows.length ? `<div class="me-split"><h3>${title}</h3><ul>${rows.slice(0, 6).map(r => `<li><span class="me-sk">${esc(r.k)}</span><span class="trak" aria-hidden="true"><i style="width:${pct(r.hit / r.n)}%"></i></span><b class="num">${r.hit} of ${r.n}</b><small class="num">${pct(r.hit / r.n)}%</small></li>`).join('')}</ul><p class="lb">${noun}</p></div>` : '';
  function parlays(S) {
    if (!C) return '';
    const tile = (l, v, s) => `<div class="tile inset"><span class="lb">${l}</span><b class="fig num">${v}</b>${s ? `<small class="lb">${s}</small>` : ''}</div>`;
    if (!S.n) return `<section class="card me-sec" aria-label="Your parlays"><div class="sec-h"><h2>Parlays</h2></div>
      <div class="emp">${ic('ticket', 28)}<b>${S.open ? `${plural(S.open, 'parlay')} in play, none finished yet` : 'No parlays yet'}</b><p>${S.open ? 'Your record, hit rate and chart start as soon as the first one finishes.' : 'Lock in a parlay before its games start. When it finishes it is counted here: wins, losses, hit rate and a chart of how you are doing.'}</p>
        <button type="button" class="bt" data-page="parlays">${ic('ticket', 18)}${S.open ? 'Follow them live' : 'Build a parlay'}</button></div></section>`;
    const st = S.streak;
    return `<section class="card me-sec" aria-label="Your parlays"><div class="sec-h"><h2>Parlays</h2><button type="button" class="lk" data-page="parlays">Open the tracker${ic('arrow', 16)}</button></div>
      <div class="me-tiles">${tile('Won–lost', `${S.won}–${S.lost}`, S.push ? plural(S.push, 'push', 'pushes') : S.open ? `${S.open} in play` : '')}${tile('Hit rate', S.rate == null ? '–' : pct(S.rate) + '%', `${plural(S.won + S.lost, 'parlay')} decided`)}
        ${tile('Units', S.units == null ? '–' : signed(S.units), S.units == null ? 'add your odds to count these' : `on ${fmt(r2(S.staked))} staked${S.est ? ', some at a fair price' : ''}`)}${tile('Return', S.roi == null ? '–' : (S.roi > 0 ? '+' : S.roi < 0 ? '−' : '') + Math.abs(pct(S.roi)) + '%', S.roi == null ? '' : 'units won for each unit staked')}
        ${tile('Streak', st ? `${st.n} ${st.kind === 'won' ? (st.n === 1 ? 'win' : 'wins') : st.n === 1 ? 'loss' : 'losses'}` : '–', 'right now')}${tile('Best run', S.best ? plural(S.best, 'win') : '–', 'in a row')}
        ${tile('Single picks', S.legRate == null ? '–' : pct(S.legRate) + '%', S.legN ? `${S.legHit} of ${S.legN} hit` : '')}${tile('In play', S.open, S.open === 1 ? 'parlay still going' : 'parlays still going')}</div>
      ${chart(S)}
      <div class="me-last"><span class="lb">Last ${S.last.length}, oldest first</span>${window.flParlays?.strip ? window.flParlays.strip(S.last) : ''}</div>
      <div class="me-splits">${split('By league', S.byLeague, 'Single picks that hit.')}${split('By kind of pick', S.byType, 'Single picks that hit.')}${split('By size', S.bySize, 'Whole parlays that won.')}</div></section>`;
  }

  /* ---------- match picks: the sides you tapped on a game's Prediction tab ---------- */
  function picks() {
    const all = Array.isArray(window.S?.picks) ? window.S.picks : [], done = all.filter(p => p.result === 'won' || p.result === 'lost').sort((a, b) => new Date(a.date) - new Date(b.date));
    const won = done.filter(p => p.result === 'won').length, open = all.length - done.length, last = done.slice(-10);
    let streak = 0; for (let i = done.length - 1; i >= 0 && done[i].result === done[done.length - 1].result; i--) streak++;
    const body = !all.length ? `<div class="emp">${ic('pred', 26)}<b>No match picks yet</b><p>Open any game's Prediction tab and tap a side. When the game ends, your pick is graded and counted here.</p></div>`
      : `<div class="me-tiles three"><div class="tile inset"><span class="lb">Right–wrong</span><b class="fig num">${won}–${done.length - won}</b>${open ? `<small class="lb">${open} waiting</small>` : ''}</div>
          <div class="tile inset"><span class="lb">Hit rate</span><b class="fig num">${done.length ? pct(won / done.length) + '%' : '–'}</b></div>
          <div class="tile inset"><span class="lb">Streak</span><b class="fig num">${done.length ? `${streak} ${done[done.length - 1].result === 'won' ? 'right' : 'wrong'}` : '–'}</b></div></div>
        ${last.length ? `<div class="me-last"><span class="lb">Last ${last.length}, oldest first</span><ol class="py-strip" aria-label="Last ${last.length} picks, oldest first">${last.map(p => `<li class="${p.result}" title="${esc(`${p.home} v ${p.away}: ${p.result === 'won' ? 'right' : 'wrong'}`)}"><span aria-hidden="true">${p.result === 'won' ? 'W' : 'L'}</span><span class="sr-only">${p.result === 'won' ? 'Right' : 'Wrong'}</span></li>`).join('')}</ol></div>` : ''}`;
    return `<section class="card me-sec" aria-label="Your match picks"><div class="sec-h"><h2>Match picks</h2><button type="button" class="lk" data-shell="pred">Predictions${ic('arrow', 16)}</button></div>${body}</section>`;
  }

  /* ---------- what you follow ---------- */
  function favorites() {
    const S = window.S || {}, teams = S.fav || [], players = S.favPlayers || [], leagues = (S.favLeagues || []).map(s => { try { return LG[s]?.name || s } catch (e) { return s } });
    const group = (title, items, draw) => `<div class="me-fav"><h3>${title}<span class="lb num">${items.length}</span></h3>${items.length ? `<ul class="cx-row">${items.slice(0, 14).map(x => `<li class="pl">${draw(x)}</li>`).join('')}${items.length > 14 ? `<li class="pl">and ${items.length - 14} more</li>` : ''}</ul>` : `<p class="lb">None yet.</p>`}</div>`;
    const logo = x => x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<section class="card me-sec" aria-label="Your favorites"><div class="sec-h"><h2>Favorites</h2><button type="button" class="lk" data-me="favs">Add or change${ic('arrow', 16)}</button></div>
      ${group('Teams', teams, x => logo(x) + esc(x.name || ''))}${group('Players', players, x => esc(x.name || ''))}${group('Leagues', leagues, x => esc(x))}
      <p class="lb">Your teams come first on Home and in every match list. Star a team or a player on their page to add them.</p></section>`;
  }

  /* ---------- favorite themes ---------- */
  function themes() {
    const T = window.flTheme; if (!T || typeof T.get !== 'function') return '';   // before settings.js has run, window.flTheme is still the stylesheet link of that id
    const cur = T.get(), favs = T.favs(), list = [...T.list].sort((a, b) => (favs.includes(b[0]) - favs.includes(a[0])));
    return `<section class="card me-sec me-themes" id="meThemes" aria-label="Your favorite themes"><div class="sec-h"><h2>Favorite themes</h2><button type="button" class="lk" data-page="settings" data-arg="theme">All settings${ic('arrow', 16)}</button></div>
      <p class="lb">Star the ones you like. Starred themes show in the three-dot menu, so you can switch in one press${me() ? ', and they follow your account to any device' : ''}.</p>
      <ul class="me-tl">${list.map(([id, name, desc]) => { const on = favs.includes(id), use = id === cur;
        return `<li class="me-th${use ? ' on' : ''}">${T.preview(id)}<span class="rw-t"><b>${esc(name)}</b><small>${esc(desc)}</small></span>
          <button type="button" class="ib me-star" aria-pressed="${on}" data-mefav="${id}" aria-label="${on ? `Remove ${esc(name)} from your favorite themes` : `Add ${esc(name)} to your favorite themes`}">${ic('star', 20)}</button>
          ${use ? `<span class="pl solid me-use">${ic('check', 14)}In use</span>` : `<button type="button" class="bt sm ghost me-use" data-theme-use="${id}" data-mefocus="${id}">Use<span class="sr-only"> ${esc(name)}</span></button>`}</li>` }).join('')}</ul></section>`;
  }

  function render(el, arg) {
    const S = C ? C.stats() : null, a = document.activeElement, fk = a?.dataset?.mefav ? `[data-mefav="${a.dataset.mefav}"]` : a?.dataset?.memode ? `[data-memode="${a.dataset.memode}"]` : a?.dataset?.mefocus ? `.me-th.on .me-star` : '';
    el.innerHTML = `<div class="vst me">${head(S)}<div class="me-cols"><div class="vst">${S ? parlays(S) : ''}${picks()}</div><div class="vst">${themes()}${favorites()}</div></div></div>`;
    if (fk && el.contains(a) === false) el.querySelector(fk)?.focus({ preventScroll: true });
  }
  const redraw = () => { const el = document.getElementById('pg-profile'); if (el && !el.hidden) render(el) };

  document.addEventListener('click', e => {
    const pg = e.target.closest?.('#pg-profile'); if (!pg) return;
    const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
    if (d.mefav) { const T = window.flTheme; T.fav(d.mefav, !T.favs().includes(d.mefav)); return }   // fl:theme redraws
    if (d.memode) { M.mode = d.memode; return redraw() }
    if (d.me && typeof openProfile === 'function') { try { if (d.me === 'login') S.prof.mode = 'login'; if (d.me === 'signup') S.prof.mode = 'signup'; if (d.me === 'edit') S.prof.edit = true } catch (x) {} return openProfile() }
  });
  // the chart's tooltip: the nearest parlay under the pointer
  document.addEventListener('pointermove', e => {
    const g = e.target.closest?.('#pg-profile .me-pt'), tip = document.getElementById('meTip'); if (!tip) return;
    if (!g) { if (!tip.hidden) tip.hidden = true; return }
    const svg = g.ownerSVGElement, box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, x = +g.dataset.x / vb.width * box.width, y = +g.dataset.y / vb.height * box.height;
    tip.textContent = g.dataset.tip; tip.hidden = false; tip.style.left = Math.max(8, Math.min(box.width - tip.offsetWidth - 8, x - tip.offsetWidth / 2)) + 'px'; tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px';
  });
  for (const ev of ['fl:parlays', 'fl:me', 'fl:theme']) document.addEventListener(ev, redraw);
  matchMedia('(max-width:700px)').addEventListener?.('change', redraw);   // the chart is drawn for the width it has

  window.flPages.add('profile', { title: 'My profile', fresh: true, render,
    onShow(el, arg) { if (C) (C.state.loaded ? Promise.resolve() : C.load()).then(() => { redraw(); window.flParlays?.refresh() }); if (arg === 'themes') setTimeout(() => { const s = document.getElementById('meThemes'); s?.scrollIntoView({ block: 'start' }); s?.querySelector('.me-star')?.focus({ preventScroll: true }) }, 40) } });
})();
