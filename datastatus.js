/* Floodlight · Data status (#/status): how fresh each outside source is, and the public correction log.
   The server says what it has read (GET /api/health, health.py): scores, schedules, rosters, player props,
   sportsbook prices, injury reports, transfers and player game logs, each Live, Delayed, Partial or Unavailable, with
   each sport under it ("NBA props: updated 3 minutes ago"). Scores and schedules are mostly read by this browser
   straight from ESPN, so the schedules this page has read (schedule.js) are added to the server's list.
   Admins also see the owner alerts and the players whose team is being checked.
   The correction log (GET /api/corrections, corrections.py) lists every fix to something the site showed. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const STATE = { live: 'Live', delayed: 'Delayed', partial: 'Partial', unavailable: 'Unavailable', unknown: 'Not checked yet' };
  const NOTE = { live: 'Fresh, and answering on time.', delayed: 'Answering, but later than its normal refresh.', partial: 'Some sports or sources answered and some didn’t.',
    unavailable: 'The last tries failed, so nothing fresh is in hand.', unknown: 'Nothing has asked for it since the server started.' };
  const SPORT = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB' };
  const D = { at: 0, health: null, corr: null, alerts: null, flags: null, err: '', t: 0 };
  const admin = () => typeof S !== 'undefined' && S.me && (S.me.role === 'admin' || S.me.rank === 'owner' || S.me.rank === 'admin');
  const ago = ts => window.flPlayers?.ago(ts) || '';
  const get = u => fetch(u, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));

  async function load() {
    const [h, c] = await Promise.allSettled([get('/api/health'), get('/api/corrections')]);
    D.health = h.status === 'fulfilled' ? h.value : D.health; D.corr = c.status === 'fulfilled' ? c.value.entries || [] : D.corr;
    D.err = h.status === 'rejected' && !D.health ? 'The server didn’t answer, so the status below is only what this page has read itself.' : '';
    if (admin()) {
      const [a, f] = await Promise.allSettled([get('/api/admin/alerts'), get('/api/admin/flags')]);
      D.alerts = a.status === 'fulfilled' ? a.value.alerts || [] : null; D.flags = f.status === 'fulfilled' ? f.value.players || [] : null;
    }
    D.at = Date.now(); draw();
  }

  /* this browser's own schedule reads (schedule.js) join the server's schedule line */
  function withPage(feeds) {
    const mine = [];
    const sched = window.flSched?.all?.() || [];
    for (const r of sched) if (r.at) mine.push({ sport: r.spec.path, name: (r.spec.path.split('/')[1] || r.spec.path).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' (read by this page)',
      state: r.status === 'error' ? 'unavailable' : Date.now() - r.at > 3600e3 ? 'delayed' : 'live', at: r.at / 1000, err: r.error || '' });
    if (!mine.length) return feeds;
    return feeds.map(f => f.feed !== 'schedules' ? f : { ...f, sports: [...f.sports, ...mine], state: f.state === 'unknown' ? (mine.every(m => m.state === 'live') ? 'live' : 'partial') : f.state,
      at: Math.max(f.at || 0, ...mine.map(m => m.at)) });
  }

  const pill = st => `<span class="ds-st ds-${esc(st)}"><i aria-hidden="true"></i>${esc(STATE[st] || st)}</span>`;
  function feedRow(f) {
    const when = f.at ? `updated ${ago(f.at)}` : 'not read yet';
    const subs = f.sports.filter(s => s.sport !== 'all' || f.sports.length === 1);
    return `<li class="ds-row"><details${f.state === 'partial' || f.state === 'unavailable' ? ' open' : ''}><summary><span class="ds-name"><b>${esc(f.label)}</b><small>${esc(when)}</small></span>${pill(f.state)}</summary>
      <p class="lb">${esc(NOTE[f.state] || '')}</p>
      ${subs.length ? `<ul class="ds-subs">${subs.map(s => `<li><span>${esc(s.name)} ${esc(f.label.toLowerCase())}: ${s.at ? `updated ${esc(ago(s.at))}` : 'not read yet'}${s.state !== 'live' && s.err ? ` <small class="lb">· ${esc(s.err)}</small>` : ''}</span>${pill(s.state)}</li>`).join('')}</ul>` : ''}</details></li>`;
  }
  function rosterBlock(r) {
    if (!r) return '';
    const rows = Object.entries(r).filter(([, x]) => x.players || x.error);
    if (!rows.length) return `<p class="lb">The team rosters haven’t been read since the server started. They are read within a few minutes.</p>`;
    return `<ul class="ds-subs">${rows.map(([sp, x]) => `<li><span><b>${esc(SPORT[sp] || sp)}</b> · ${x.teams} teams, ${x.players} players${x.read ? `, read ${esc(ago(x.read))}` : ''}${x.checking ? ` · <b>${x.checking}</b> being checked` : ''}${x.error ? ` <small class="lb">· ${esc(x.error)}</small>` : ''}</span>${pill(x.error && !x.players ? 'unavailable' : x.read && Date.now() / 1000 - x.read < 13 * 3600 ? (x.checking ? 'partial' : 'live') : 'delayed')}</li>`).join('')}</ul>`;
  }
  const corrRow = e => `<li class="ds-corr"><p><b>${esc(e.subject)}</b> <span class="lb">${esc(new Date(e.at * 1000).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }))}${e.source === 'automatic' ? ' · found by the automatic check' : ''}</span></p>
    <p>${esc(e.text)}</p>${e.before || e.after || e.affected ? `<p class="lb">${[e.before && e.after ? `Shown: ${esc(e.before)} · Correct: ${esc(e.after)}` : '', e.affected ? `Affected: ${esc(e.affected)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
    ${admin() ? `<button type="button" class="bt sm ghost" data-dsrm="${esc(e.id)}">Remove<span class="sr-only"> the correction: ${esc(e.subject)}</span></button>` : ''}</li>`;

  function draw() {
    const el = $('pg-status'); if (!el || el.hidden) return;
    const h = D.health, feeds = withPage(h?.feeds || []);
    const worst = feeds.filter(f => f.state === 'unavailable' || f.state === 'partial' || f.state === 'delayed');
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Data status</h1><p class="pg-sub">How fresh each outside source is right now.</p>
        <p class="lb">Floodlight reads scores, rosters, lines and prices from outside providers. When one is late, it says so here and on the page that uses it. This page checks again every minute.</p></div></header>
      ${D.err ? `<div class="card ds-alert" role="alert">${ic('help', 20)}<span>${esc(D.err)}</span><button type="button" class="bt sm" data-dsre>Try again</button></div>` : ''}
      <section class="card ds-card" aria-labelledby="dsFeeds"><div class="sec-h"><h2 id="dsFeeds">Sources</h2><span class="lb" role="status">${!h && !D.at ? 'Checking…' : worst.length ? `${worst.length} of ${feeds.length} need a look` : feeds.some(f => f.state === 'live') ? 'Everything that has been read is answering' : feeds.length ? 'Nothing has been read yet' : ''}</span></div>
        ${feeds.length ? `<ul class="ds-list">${feeds.map(feedRow).join('')}</ul>` : `<p class="lb">${D.at ? 'No status yet.' : 'Checking…'}</p>`}</section>
      <section class="card ds-card" aria-labelledby="dsRoster"><div class="sec-h"><h2 id="dsRoster">Player teams</h2><span class="lb">Every page takes a player’s team from these roster reads</span></div>${rosterBlock(h?.rosters)}</section>
      ${admin() && D.flags ? `<section class="card ds-card" aria-labelledby="dsFlags"><div class="sec-h"><h2 id="dsFlags">Players being checked</h2><span class="lb">Only admins see this</span></div>
        ${D.flags.length ? `<ul class="ds-subs">${D.flags.slice(0, 60).map(p => `<li><span><b>${esc(p.name)}</b> · ${esc(p.teamName || 'no team')} · ${esc(p.league)}<br><small class="lb">${esc(p.flags.map(f => f.text).join(' '))}</small></span>${pill(p.status === 'verified' ? 'live' : 'partial')}</li>`).join('')}</ul>` : '<p class="lb">No player’s team is in question.</p>'}</section>` : ''}
      ${admin() && D.alerts ? `<section class="card ds-card" aria-labelledby="dsAlerts"><div class="sec-h"><h2 id="dsAlerts">Owner alerts</h2><span class="lb">Sent to Discord when an alert channel is set</span></div>
        ${D.alerts.length ? `<ul class="ds-subs">${D.alerts.slice(0, 30).map(a => `<li><span>${esc(a.text)}</span><small class="lb">${esc(ago(a.at))}</small></li>`).join('')}</ul>` : '<p class="lb">No alerts. The checks run every ten minutes.</p>'}</section>` : ''}
      <section class="card ds-card" id="corrections" aria-labelledby="dsCorr"><div class="sec-h"><h2 id="dsCorr">Corrections</h2><span class="lb">When something Floodlight showed was wrong, the fix is listed here</span></div>
        ${D.corr == null ? '<p class="lb">Loading the correction log…</p>' : D.corr.length ? `<ul class="ds-corrs">${D.corr.map(corrRow).join('')}</ul>` : '<p class="lb">No corrections so far. When a fix changes something the site showed, such as a player’s team or a graded pick, it is listed here with the date and what it affected.</p>'}
        ${admin() ? `<details class="ds-add"><summary>Add a correction</summary><form class="ds-form" data-dsadd>
          <label class="fl-f">What was corrected<input class="inp" name="subject" maxlength="120" required autocomplete="off" placeholder="For example: NFL Week 12 start times"></label>
          <label class="fl-f">What happened and what it changed<textarea class="inp" name="text" maxlength="600" required rows="3"></textarea></label>
          <label class="fl-f">Shown<input class="inp" name="before" maxlength="80" autocomplete="off"></label><label class="fl-f">Correct<input class="inp" name="after" maxlength="80" autocomplete="off"></label>
          <label class="fl-f">Affected<input class="inp" name="affected" maxlength="200" autocomplete="off" placeholder="For example: 4 predictions"></label>
          <button class="bt" type="submit">Publish the correction</button><p class="lb" role="alert" data-dsmsg></p></form></details>` : ''}</section>`;
  }

  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-dsre]')) return load();
    const rm = ev.target.closest('[data-dsrm]'); if (!rm) return;
    fetch('/api/admin/corrections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: rm.dataset.dsrm }) }).then(load);
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest('[data-dsadd]'); if (!f) return; ev.preventDefault();
    const body = Object.fromEntries(new FormData(f)), msg = f.querySelector('[data-dsmsg]');
    fetch('/api/admin/corrections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(d => ({ ok: r.ok, d }))).then(({ ok, d }) => { if (!ok) { msg.textContent = d.error || 'It wasn’t saved. Try again.'; return } load() })
      .catch(() => { msg.textContent = 'It wasn’t saved. Check your connection and try again.' });
  });

  window.flPages?.add('status', { title: 'Data status', render(el) { el.innerHTML = ''; draw() },
    onShow(el, arg) { draw(); load().then(() => { if (arg === 'corrections') document.getElementById('corrections')?.scrollIntoView() }); clearInterval(D.t); D.t = setInterval(() => { if (!document.hidden) load() }, 60e3) },
    onHide() { clearInterval(D.t) } });
})();
