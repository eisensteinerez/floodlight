/* Floodlight · Trust and data (#/status): how fresh each outside source is, how many markets passed verification,
   the outages and how they ended, how every number is worked out, and the public correction log.
   GET /api/trust (markets.summary, health.incidents) gives the verified markets and the incidents without re-reading
   anything. Every card carries "Last verified", "View source details" and "Report incorrect data"; a report goes to
   POST /api/data-report and stays private for the administrators. In Admin mode the data monitoring
   (GET /api/admin/monitor) and the open reports show here too.
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
  const D = { at: 0, health: null, corr: null, trust: null, alerts: null, flags: null, mon: null, err: '', t: 0 };
  const LEAGUE = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer', cfb: 'College football', cbb: 'College basketball' };
  const when = ts => ts ? new Date(ts * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const span = (a, b) => { const m = Math.max(1, Math.round((b - a) / 60)); return m < 90 ? `${m} min` : `${Math.round(m / 6) / 10} h` };
  const admin = () => typeof S !== 'undefined' && S.me && (S.me.role === 'admin' || S.me.rank === 'owner' || S.me.rank === 'admin');
  const ago = ts => window.flPlayers?.ago(ts) || '';
  // owner-only sections and buttons show only in Admin mode (admin.js); the correction form lives in the owner drawer
  const editing = () => admin() && !!window.flAdmin?.on?.();
  window.flAdmin?.tool?.({ id: 'corrections', title: 'Add a correction', when: () => window.flPages?.current?.() === 'status',
    html: () => `<form class="ds-form" data-dsadd>
          <label class="fl-f">What was corrected<input class="inp" name="subject" maxlength="120" required autocomplete="off" placeholder="For example: NFL Week 12 start times"></label>
          <label class="fl-f">What happened and what it changed<textarea class="inp" name="text" maxlength="600" required rows="3"></textarea></label>
          <label class="fl-f">Shown<input class="inp" name="before" maxlength="80" autocomplete="off"></label><label class="fl-f">Correct<input class="inp" name="after" maxlength="80" autocomplete="off"></label>
          <label class="fl-f">Affected<input class="inp" name="affected" maxlength="200" autocomplete="off" placeholder="For example: 4 predictions"></label>
          <button class="bt" type="submit">Publish the correction</button><p class="lb" role="alert" data-dsmsg></p></form>` });
  const get = u => fetch(u, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));

  async function load() {
    const [h, c, t] = await Promise.allSettled([get('/api/health'), get('/api/corrections'), get('/api/trust')]);
    D.health = h.status === 'fulfilled' ? h.value : D.health; D.corr = c.status === 'fulfilled' ? c.value.entries || [] : D.corr;
    D.trust = t.status === 'fulfilled' ? t.value : D.trust;
    D.err = h.status === 'rejected' && !D.health ? 'The server didn’t answer, so the status below is only what this page has read itself.' : '';
    if (admin()) {
      const [a, f, m] = await Promise.allSettled([get('/api/admin/alerts'), get('/api/admin/flags'), get('/api/admin/monitor')]);
      D.alerts = a.status === 'fulfilled' ? a.value.alerts || [] : null; D.flags = f.status === 'fulfilled' ? f.value.players || [] : null;
      D.mon = m.status === 'fulfilled' ? m.value : null;
    }
    D.at = Date.now(); draw();
  }

  /* this browser's own schedule reads (schedule.js) join the server's schedule line */
  function withPage(feeds) {
    const mine = [];
    const NAME = { 'soccer/all': 'Soccer', 'football/nfl': 'NFL', 'football/college-football': 'College football', 'basketball/nba': 'NBA', 'basketball/wnba': 'WNBA',
      'basketball/mens-college-basketball': 'College basketball', 'hockey/nhl': 'NHL', 'baseball/mlb': 'MLB', 'tennis/atp': 'ATP', 'tennis/wta': 'WTA' };
    const last = new Map();   // the newest read of each league by this browser
    for (const r of window.flSched?.all?.() || []) if (r.at && (!last.has(r.spec.path) || last.get(r.spec.path).at < r.at)) last.set(r.spec.path, r);
    for (const [path, r] of last) mine.push({ sport: path, name: `${NAME[path] || path} (this browser)`, state: r.status === 'error' ? 'unavailable' : Date.now() - r.at > 3600e3 ? 'delayed' : 'live',
      at: r.status === 'error' ? null : r.at / 1000, err: r.status === 'error' ? 'didn’t answer' : '' });
    if (!mine.length) return feeds;
    return feeds.map(f => f.feed !== 'schedules' ? f : { ...f, sports: [...f.sports, ...mine], state: f.state === 'unknown' ? (mine.every(m => m.state === 'live') ? 'live' : 'partial') : f.state,
      at: Math.max(f.at || 0, ...mine.map(m => m.at || 0)) || null });
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
    ${editing() ? `<button type="button" class="bt sm ghost" data-dsrm="${esc(e.id)}">Remove<span class="sr-only"> the correction: ${esc(e.subject)}</span></button>` : ''}</li>`;

  /* ---------- the three actions every card carries ---------- */
  const rep = o => esc(JSON.stringify(o));
  function foot(at, src, report, label) {
    return `<div class="ds-foot"><span class="lb ds-lv">${ic('clock', 14)}Last verified ${at ? `<time datetime="${new Date(at * 1000).toISOString()}">${esc(ago(at))}</time>` : 'not yet'}</span>
      <details class="ds-src"><summary>View source details<span class="sr-only">: ${esc(label)}</span></summary><div class="ds-srcb">${src}</div></details>
      <button type="button" class="lk ds-rep" data-report="${rep(report)}">Report incorrect data<span class="sr-only">: ${esc(label)}</span></button></div>`;
  }
  const SRC = {
    sources: `<p>Scores, schedules, rosters, injury reports and player game logs come from ESPN. Player lines come from PrizePicks and Sleeper. Sportsbook prices come from Kalshi and the books we read. Transfers come from Transfermarkt.</p><p>Each source is read on its own timer. A source counts as delayed when its last good read is older than twice its normal refresh, and unavailable after two failed reads in a row.</p>`,
    markets: `<p>Every player line from PrizePicks and Sleeper is matched to a game on the ESPN schedule before any page shows it. The line has to belong to a game that hasn't started, the player’s team has to be in that game, the opponent has to match, the market date has to match the game date, and the provider has to have confirmed the line in the last 90 minutes.</p><p>Lines that fail any check are taken off every page at once, with the reason. Predictions, the Lab, player pages, search, parlays and Home all read this same list.</p>`,
    incidents: `<p>An incident starts when a source fails twice in a row and ends at its next good answer. Incidents from the last 30 days are listed. While one is open, the pages that use the source say so and show their last verified data.</p>`,
    corrections: `<p>Entries come from two places: the automatic check that compares the team shown on a card with the official roster, and administrators who fix a grade or a line. Each entry says what was shown, what is right and what it affected.</p>`,
  };

  /* ---------- the numbers at the top ---------- */
  function tiles(feeds) {
    const sp = D.trust?.markets?.sports || [], open = sp.reduce((n, x) => n + x.open, 0), off = sp.reduce((n, x) => n + Object.values(x.removed).reduce((a, b) => a + b, 0), 0);
    const answering = feeds.filter(f => f.state === 'live').length, read = feeds.filter(f => f.state !== 'unknown').length;
    const inc = D.trust?.incidents || { open: [], resolved: [] }, month = (D.corr || []).filter(e => e.at > Date.now() / 1000 - 30 * 86400).length;
    const t = (v, k, sub, cls = '') => `<div class="ds-tile ${cls}"><dt>${k}</dt><dd><b class="num">${v}</b><small>${sub}</small></dd></div>`;
    return `<dl class="ds-tiles" aria-label="Summary">
      ${t(read ? `${answering}/${read}` : '–', 'Sources answering', read ? 'of the sources read so far' : 'nothing read yet')}
      ${t(D.trust ? open : '–', 'Verified lines', D.trust ? `${off} taken off in the last day` : 'loading')}
      ${t(D.trust ? inc.open.length : '–', 'Open incidents', D.trust ? `${inc.resolved.length} resolved in 30 days` : 'loading', inc.open.length ? 'warn' : '')}
      ${t(D.corr ? month : '–', 'Corrections', 'published in 30 days')}</dl>`;
  }

  /* ---------- verified markets, per league ---------- */
  function marketsBlock() {
    const m = D.trust?.markets;
    if (!m) return `<p class="lb">${D.at ? 'The market check hasn’t answered. It is tried again every minute.' : 'Checking…'}</p>`;
    if (!m.sports.length) return `<p class="lb">No player lines have been checked since the server started. They are checked the first time a page asks for them.</p>`;
    return `<ul class="ds-subs ds-mk">${m.sports.map(x => {
      const off = Object.entries(x.removed).sort((a, b) => b[1] - a[1]), down = x.providers.filter(p => !p.ok);
      const st = down.length && down.length === x.providers.length ? 'unavailable' : down.length ? 'partial' : x.lastVerified && Date.now() / 1000 - x.lastVerified > m.fresh ? 'delayed' : x.open ? 'live' : 'unknown';
      return `<li><span><b>${esc(LEAGUE[x.sport] || x.sport.toUpperCase())}</b> · <span class="num">${x.open}</span> ${x.open === 1 ? 'line' : 'lines'} verified${x.lastVerified ? `, newest ${esc(ago(x.lastVerified))}` : ''}
        <small class="lb">${x.providers.map(p => `${esc(p.name)} ${p.ok ? (p.at ? `read ${esc(ago(p.at))}` : 'answering') : 'not answering'}`).join(' · ') || 'No provider read yet'}${x.schedule ? ` · ESPN schedule ${x.schedule.ok ? 'read' : 'not answering'}` : ''}</small>
        ${off.length ? `<small class="lb">Taken off in the last day: ${off.map(([k, n]) => `${esc(k)} ${n}`).join(', ')}</small>` : ''}</span>${pill(st)}</li>`;
    }).join('')}</ul>`;
  }

  /* ---------- outages, open and resolved ---------- */
  function incidentsBlock() {
    const i = D.trust?.incidents;
    if (!i) return `<p class="lb">${D.at ? 'The incident list didn’t load.' : 'Checking…'}</p>`;
    const row = (x, open) => `<li><span><b>${esc(x.name === 'All sports' ? x.label : `${x.name} ${x.label.toLowerCase()}`)}</b>
      <small class="lb">${open ? `Since ${esc(when(x.from))}, ${esc(span(x.from, Date.now() / 1000))} so far` : `${esc(when(x.from))} to ${esc(when(x.to))}, ${esc(span(x.from, x.to))}`}${x.err ? ` · ${esc(x.err)}` : ''}</small></span>${pill(open ? 'unavailable' : 'live').replace('Live', 'Resolved')}</li>`;
    if (!i.open.length && !i.resolved.length) return '<p class="lb">No outages in the last 30 days.</p>';
    return `<ul class="ds-subs">${i.open.map(x => row(x, true)).join('')}${i.resolved.map(x => row(x, false)).join('')}</ul>`;
  }

  /* ---------- how the numbers are made ---------- */
  const METHOD = [
    ['How a prediction is made', 'Floodlight’s chance for a player line comes from the player’s own game log: the last 5, 10 and 20 games, weighted toward the recent ones, adjusted for minutes or snaps, the opponent and where the game is played. A match forecast blends our model with the market. Nothing is predicted for a game that isn’t on the league schedule.'],
    ['Supported edge', 'The raw edge is our chance minus the market’s chance, with the book’s margin taken out. The supported edge is the raw edge after cuts for anything that makes it less certain: a short game log, an unconfirmed lineup, an injury listing, a price older than 30 minutes, a matchup from the provider only, or providers that disagree. Each card says which cuts were made.'],
    ['Sample size', 'A hit rate always says how many games it comes from. Under 8 games a line is marked Small sample and its edge is cut. Pick History shows only the record until 25 picks are graded, warns about a small sample from 25 to 99, and shows full reporting from 100.'],
    ['Injury sources', 'Injury status comes from each league’s official report as ESPN publishes it, read every few hours and again when a page asks. A player listed out is taken off every page at once. Doubtful and questionable players stay on, marked, with a cut to the edge.'],
    ['Grading', 'A pick is graded from the final box score once the game is final: the stat, the line, the closing line and price, the source and the time are saved with the grade. A push is a stat exactly on the line. A pick is void when the game is cancelled or the player doesn’t play. The receipt published before the game is locked and never changes.'],
    ['Correction policy', 'When something Floodlight showed was wrong, the fix is published here with the date, what was shown, what is right and what it affected. A grade can only be changed by an administrator, with a reason; the old grade stays in the pick’s history and the published receipt is never edited. Reports from members are read by an administrator, and every report that leads to a fix is listed below.'],
  ];
  const methodBlock = () => `<div class="ds-meth">${METHOD.map(([h, t]) => `<details class="ds-m"><summary><b>${esc(h)}</b></summary><p>${esc(t)}</p></details>`).join('')}</div>`;

  /* ---------- Admin mode: data monitoring and open reports ---------- */
  function monitorBlock() {
    const m = D.mon; if (!m) return '<p class="lb">The monitoring check didn’t answer.</p>';
    const SRC = { live: 'Live', delayed: 'Delayed', failed: 'Failed', idle: 'Not asked lately' }, KIND = { provider: 'Lines', schedule: 'Schedule', injuries: 'Injury report' };
    const srcs = (m.sources || []).filter(x => x.state !== 'idle' || x.lastSuccess);
    const table = srcs.length ? `<div class="tbx-wrap"><table class="tbx ds-src"><caption class="lb">Every source, newest good read first within each state. ${m.open ?? 0} markets open.</caption>
      <thead><tr><th scope="col">Source</th><th scope="col">State</th><th scope="col" class="r">Last good read</th></tr></thead>
      <tbody>${srcs.map(x => `<tr><th scope="row">${esc(x.name)} <small class="lb">${esc(String(x.sport || '').toUpperCase())} · ${esc(KIND[x.kind] || x.kind)}</small></th>
        <td><span class="ds-st ${x.state === 'live' ? 'ok' : x.state === 'idle' ? '' : 'bad'}">${esc(SRC[x.state] || x.state)}</span>${x.error ? `<small class="lb">${esc(x.error)}</small>` : ''}</td>
        <td class="r num">${x.lastSuccess ? `<time datetime="${new Date(x.lastSuccess * 1000).toISOString()}" title="${esc(when(x.lastSuccess))}">${esc(ago(x.lastSuccess) || when(x.lastSuccess))}</time>` : 'Never'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="lb">No source has been read since the server started.</p>';
    return `${table}<ul class="ds-subs">${m.checks.map(c => `<li><span><b>${esc(c.label)}</b>${c.items.length ? `<small class="lb">${c.items.slice(0, 3).map(x => esc([x.player || x.key, x.stat, x.line, x.reason || x.error].filter(v => v != null && v !== '').join(' · '))).join('<br>')}</small>` : ''}</span><b class="num ds-n${c.n ? ' bad' : ''}">${c.n}</b></li>`).join('')}</ul>`;
  }
  function reportsBlock() {
    const rs = (D.mon?.corrections?.reports || []).filter(r => !r.resolved);
    if (!rs.length) return '<p class="lb">No open reports.</p>';
    return `<ul class="ds-subs">${rs.slice(0, 40).map(r => `<li class="ds-rp"><span><b>${esc(r.player || r.page || 'Report')}</b>${r.stat ? ` · ${esc(r.stat)} ${esc(r.line ?? '')}` : ''}${r.provider ? ` · ${esc(r.provider)}` : ''}
        <small class="lb">${esc(ago(r.at))}${r.by ? ` · ${esc(r.by)}` : ''}${r.marketId ? ` · ${esc(r.marketId)}` : ''}</small><span>${esc(r.text)}</span></span>
        <span class="ds-rpb">${[['corrected', 'Fixed'], ['no_error', 'Not an error'], ['duplicate', 'Duplicate']].map(([o, l]) => `<button type="button" class="bt sm ghost" data-dsres="${esc(r.id)}" data-out="${o}">${l}<span class="sr-only"> for the report: ${esc(r.text.slice(0, 60))}</span></button>`).join('')}</span></li>`).join('')}</ul>`;
  }

  /* ---------- Report incorrect data: one dialog for every page ---------- */
  function reportDialog(fields) {
    let dlg = document.getElementById('flReport');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'flReport'; dlg.className = 'ds-dlg'; dlg.setAttribute('aria-labelledby', 'flReportH');
      dlg.innerHTML = `<form method="dialog" class="ds-form" data-dsrep><h2 id="flReportH">Report incorrect data</h2>
        <p class="lb" data-dswhat></p>
        <label class="fl-f">What looks wrong<textarea class="inp" name="text" rows="4" maxlength="800" required placeholder="For example: he was traded to Dallas last week, or the game was moved to Sunday"></textarea></label>
        <p class="lb">The page, the line, the provider and when it was verified are sent with your note. Reports go to an administrator and aren’t public. If it leads to a fix, the fix is listed in the correction log.</p>
        <p class="lb" role="status" data-dsrmsg></p>
        <div class="ds-dlgb"><button type="button" class="bt ghost" data-dsclose>Cancel</button><button type="submit" class="bt">Send the report</button></div></form>`;
      document.body.appendChild(dlg);
      dlg.querySelector('[data-dsclose]').addEventListener('click', () => dlg.close());
    }
    dlg._fields = { ...fields, page: fields.page || location.hash || '#/', device: `${innerWidth}×${innerHeight}${matchMedia('(pointer:coarse)').matches ? ' touch' : ''}` };
    const f = dlg._fields;
    dlg.querySelector('[data-dswhat]').textContent = [f.player, f.stat && `${f.stat}${f.line != null ? ' ' + f.line : ''}`, f.provider, f.what].filter(Boolean).join(' · ') || 'Tell us what looks wrong on this page.';
    dlg.querySelector('[data-dsrmsg]').textContent = ''; dlg.querySelector('textarea').value = '';
    dlg._from = document.activeElement;
    dlg.showModal(); dlg.querySelector('textarea').focus();
    dlg.onclose = () => dlg._from?.focus?.();
  }
  window.flReport = { open: reportDialog };

  function draw() {
    const el = $('pg-status'); if (!el || el.hidden) return;
    const h = D.health, feeds = withPage(h?.feeds || []);
    const worst = feeds.filter(f => f.state === 'unavailable' || f.state === 'partial' || f.state === 'delayed');
    const newestFeed = Math.max(0, ...feeds.map(f => f.at || 0)) || null, newestMk = Math.max(0, ...(D.trust?.markets?.sports || []).map(x => x.lastVerified || 0)) || null;
    const inc = D.trust?.incidents, lastInc = inc ? Math.max(0, ...inc.open.map(x => x.from), ...inc.resolved.map(x => x.to)) || null : null;
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Trust and data</h1><p class="pg-sub">Where every number comes from, how fresh it is, and what we fixed.</p>
        <p class="lb">Floodlight reads scores, rosters, lines and prices from outside providers and checks each line against the league schedule before showing it. When a source is late, it says so here and on the page that uses it. This page checks again every minute.</p></div></header>
      ${D.err ? `<div class="card ds-alert" role="alert">${ic('help', 20)}<span>${esc(D.err)}</span><button type="button" class="bt sm" data-dsre>Try again</button></div>` : ''}
      ${tiles(feeds)}
      <section class="card ds-card" aria-labelledby="dsFeeds"><div class="sec-h"><h2 id="dsFeeds">Sources</h2><span class="lb" role="status">${!h && !D.at ? 'Checking…' : worst.length ? `${worst.length} of ${feeds.length} need a look` : feeds.some(f => f.state === 'live') ? 'Everything that has been read is answering' : feeds.length ? 'Nothing has been read yet' : ''}</span></div>
        ${feeds.length ? `<ul class="ds-list">${feeds.map(feedRow).join('')}</ul>` : `<p class="lb">${D.at ? 'No status yet.' : 'Checking…'}</p>`}
        ${foot(newestFeed, SRC.sources, { what: 'Sources', page: '#/status' }, 'Sources')}</section>
      <section class="card ds-card" aria-labelledby="dsMk"><div class="sec-h"><h2 id="dsMk">Verified player lines</h2><span class="lb">Only lines that pass every check reach a page</span></div>
        ${marketsBlock()}${foot(newestMk, SRC.markets, { what: 'Verified player lines', page: '#/status' }, 'Verified player lines')}</section>
      <section class="card ds-card" aria-labelledby="dsInc"><div class="sec-h"><h2 id="dsInc">Incidents</h2><span class="lb">Outages in the last 30 days and how long they lasted</span></div>
        ${incidentsBlock()}${foot(lastInc || (D.trust && D.trust.now), SRC.incidents, { what: 'Incidents', page: '#/status' }, 'Incidents')}</section>
      <section class="card ds-card" aria-labelledby="dsRoster"><div class="sec-h"><h2 id="dsRoster">Player teams</h2><span class="lb">Every page takes a player’s team from these roster reads</span></div>${rosterBlock(h?.rosters)}
        ${foot(Math.max(0, ...Object.values(h?.rosters || {}).map(x => x.read || 0)) || null, '<p>Team rosters come from ESPN and are read twice a day. A player whose team differs between the roster and a provider is held off every page until the roster confirms it.</p>', { what: 'Player teams', page: '#/status' }, 'Player teams')}</section>
      <section class="card ds-card" aria-labelledby="dsMeth"><div class="sec-h"><h2 id="dsMeth">How the numbers are made</h2><span class="lb">The rules behind every card</span></div>${methodBlock()}</section>
      ${editing() ? `<section class="card ds-card" aria-labelledby="dsMon"><div class="sec-h"><h2 id="dsMon">Data monitoring</h2><span class="lb">Admin mode · an alert goes out when a check crosses its limit</span></div>${monitorBlock()}</section>
        <section class="card ds-card" aria-labelledby="dsReps"><div class="sec-h"><h2 id="dsReps">Open reports</h2><span class="lb">Admin mode · from Report incorrect data</span></div>${reportsBlock()}</section>` : ''}
      ${editing() && D.flags ? `<section class="card ds-card" aria-labelledby="dsFlags"><div class="sec-h"><h2 id="dsFlags">Players being checked</h2><span class="lb">Admin mode</span></div>
        ${D.flags.length ? `<ul class="ds-subs">${D.flags.slice(0, 60).map(p => `<li><span><b>${esc(p.name)}</b> · ${esc(p.teamName || 'no team')} · ${esc(p.league)}<br><small class="lb">${esc(p.flags.map(f => f.text).join(' '))}</small></span>${pill(p.status === 'verified' ? 'live' : 'partial')}</li>`).join('')}</ul>` : '<p class="lb">No player’s team is in question.</p>'}</section>` : ''}
      ${editing() && D.alerts ? `<section class="card ds-card" aria-labelledby="dsAlerts"><div class="sec-h"><h2 id="dsAlerts">Owner alerts</h2><span class="lb">Sent to Discord when an alert channel is set</span></div>
        ${D.alerts.length ? `<ul class="ds-subs">${D.alerts.slice(0, 30).map(a => `<li><span>${esc(a.text)}</span><small class="lb">${esc(ago(a.at))}</small></li>`).join('')}</ul>` : '<p class="lb">No alerts. The checks run every ten minutes.</p>'}</section>` : ''}
      <section class="card ds-card" id="corrections" aria-labelledby="dsCorr"><div class="sec-h"><h2 id="dsCorr">Corrections</h2><span class="lb">When something Floodlight showed was wrong, the fix is listed here</span></div>
        ${D.corr == null ? '<p class="lb">Loading the correction log…</p>' : D.corr.length ? `<ul class="ds-corrs">${D.corr.map(corrRow).join('')}</ul>` : '<p class="lb">No corrections so far. When a fix changes something the site showed, such as a player’s team or a graded pick, it is listed here with the date and what it affected.</p>'}
        ${foot(D.corr?.[0]?.at || null, SRC.corrections, { what: 'Correction log', page: '#/status/corrections' }, 'Corrections')}</section>`;
  }

  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-dsre]')) return load();
    const rb = ev.target.closest('[data-report]');
    if (rb) { let f = {}; try { f = JSON.parse(rb.dataset.report) } catch { } return reportDialog(f) }
    const rs = ev.target.closest('[data-dsres]');
    if (rs) return fetch('/api/admin/corrections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve', id: rs.dataset.dsres, outcome: rs.dataset.out }) })
      .then(r => { window.flAdmin?.say?.(r.ok ? 'Report closed.' : 'It wasn’t saved. Try again.'); load() });
    const rm = ev.target.closest('[data-dsrm]'); if (!rm) return;
    fetch('/api/admin/corrections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: rm.dataset.dsrm }) }).then(load);
  });
  document.addEventListener('submit', ev => {
    const rf = ev.target.closest('[data-dsrep]');
    if (rf) {
      ev.preventDefault();
      const dlg = rf.closest('dialog'), msg = rf.querySelector('[data-dsrmsg]'), btn = rf.querySelector('[type=submit]'), text = rf.elements.text.value.trim();
      if (text.length < 4) { msg.textContent = 'Say what looks wrong, in a few words.'; rf.elements.text.focus(); return }
      btn.disabled = true; msg.textContent = 'Sending…';
      fetch('/api/data-report', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...dlg._fields, text }) })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => { if (!ok) { msg.textContent = d.error || 'It wasn’t sent. Try again.'; return } dlg.close(); if (typeof toast === 'function') toast('Thanks. An administrator will look at it.') })
        .catch(() => { msg.textContent = 'It wasn’t sent. Check your connection and try again.' }).finally(() => { btn.disabled = false });
      return;
    }
    const f = ev.target.closest('[data-dsadd]'); if (!f) return; ev.preventDefault();
    const body = Object.fromEntries(new FormData(f)), msg = f.querySelector('[data-dsmsg]');
    fetch('/api/admin/corrections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(d => ({ ok: r.ok, d }))).then(({ ok, d }) => { if (!ok) { msg.textContent = d.error || 'It wasn’t saved. Try again.'; return } f.reset(); window.flAdmin?.say?.('Correction published.'); load() })
      .catch(() => { msg.textContent = 'It wasn’t saved. Check your connection and try again.' });
  });

  window.flPages?.add('status', { title: 'Trust and data', render(el) { el.innerHTML = ''; draw() },
    onShow(el, arg) { draw(); load().then(() => { if (arg === 'corrections') document.getElementById('corrections')?.scrollIntoView() }); clearInterval(D.t); D.t = setInterval(() => { if (!document.hidden) load() }, 60e3) },
    onHide() { clearInterval(D.t) } });
})();
