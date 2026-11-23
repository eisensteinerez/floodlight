/* Floodlight · Injuries and lineups: the league injury reports ESPN carries, one page for NBA, WNBA, NFL, NHL and MLB,
   and the lookups the evidence panel and pick alerts use (is this player listed, who is out on his team).
   Read in the browser straight from ESPN when asked, kept for ten minutes. Nothing is guessed: a player who is not on
   a report is shown as "not listed", which is not the same as confirmed in the lineup. Floodlight does not read
   confirmed starting lineups yet, and the page says so. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const PATH = { nba: 'basketball/nba', wnba: 'basketball/wnba', nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
  const NAME = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB' };
  const TTL = 10 * 60000;
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').replace(/ (jr|sr|ii|iii|iv)$/, '').trim();
  // one scale for every league's wording, most serious first
  const LEVELS = [['out', 'Out'], ['doubtful', 'Doubtful'], ['questionable', 'Questionable'], ['dtd', 'Day to day'], ['probable', 'Probable']];
  function level(s) {
    const t = String(s || '').toLowerCase();
    if (/out|injured reserve|\bir\b|injured list|\bil\b|suspen|inactive|pup|non-football/.test(t)) return 'out';
    if (/doubt/.test(t)) return 'doubtful';
    if (/question|game.?time/.test(t)) return 'questionable';
    if (/day.?to.?day|\bdtd\b/.test(t)) return 'dtd';
    if (/probable/.test(t)) return 'probable';
    return 'dtd';
  }
  const LEVEL_NAME = Object.fromEntries(LEVELS);
  const data = new Map();   // sport -> { at, teams: [{ name, abbr, players: [...] }], error, promise }

  function parse(d) {
    return (d.injuries || []).map(t => {
      const players = (t.injuries || []).map(x => { const a = x.athlete || {};
        return { name: a.displayName || a.fullName || '', pos: a.position?.abbreviation || '', status: x.status || x.type?.description || '', lv: level(x.status || x.type?.description),
          what: [x.details?.type, x.details?.location, x.details?.detail].filter(Boolean).join(', '), back: x.details?.returnDate || '', date: x.date ? Date.parse(x.date) || null : null,
          note: x.shortComment || x.longComment || '', team: a.team?.abbreviation || '' } }).filter(p => p.name);
      return { name: t.displayName || t.team?.displayName || '', abbr: t.team?.abbreviation || players.find(p => p.team)?.team || '', players };
    }).filter(t => t.players.length).sort((a, b) => a.name.localeCompare(b.name));
  }
  function load(sport, force) {
    if (!PATH[sport]) return Promise.resolve(null);
    const have = data.get(sport);
    if (have?.promise) return have.promise;
    if (have && !force && Date.now() - have.at < TTL) return Promise.resolve(have);
    const p = Promise.race([fetch(`https://site.api.espn.com/apis/site/v2/sports/${PATH[sport]}/injuries`).then(r => { if (!r.ok) throw new Error(`ESPN answered ${r.status}`); return r.json() }),
      new Promise((_, no) => setTimeout(() => no(new Error('ESPN took too long to answer')), 15000))])
      .then(d => { const v = { at: Date.now(), teams: parse(d), error: '' }; data.set(sport, v); document.dispatchEvent(new CustomEvent('fl:injuries', { detail: { sport } })); return v },
        e => { const v = { ...(have || { teams: null }), at: have?.at || 0, error: e.message || 'It did not load', promise: null }; data.set(sport, v); document.dispatchEvent(new CustomEvent('fl:injuries', { detail: { sport } })); return v });
    data.set(sport, { ...(have || {}), promise: p });
    return p;
  }
  const ready = sport => { const v = data.get(sport); return v && !v.promise && v.teams ? v : null };
  // a player's line on the report, or null when he isn't listed (or the report hasn't loaded: see ready())
  function status(sport, player) { const v = ready(sport), n = norm(player); if (!v || !n) return null; for (const t of v.teams) for (const p of t.players) if (norm(p.name) === n) return { ...p, teamName: t.name }; return null }
  // everyone listed on a team, matched by abbreviation or name
  function team(sport, t) {
    const v = ready(sport), n = norm(t); if (!v || !n) return null;
    return v.teams.find(x => norm(x.abbr) === n || norm(x.name) === n || norm(x.name).endsWith(' ' + n)) || null;
  }

  /* ---------- the page ---------- */
  const I = { sport: 'nba', lv: 'all', mine: false, lines: false, q: '' };
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago` };
  const day = t => t ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
  const linesToday = () => new Set((window.flPredictions?.picks?.() || []).filter(p => p.type === 'prop' && p.sport === I.sport).map(p => norm(p.name)));
  const myTeams = () => { try { return new Set((window.S?.fav || []).map(f => norm(f.abbr || f.short || f.name || ''))) } catch { return new Set() } };
  function render(el) {
    el.innerHTML = `<div class="vst ij"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Injuries and lineups</h1><p class="pg-sub">Every player on the league injury reports, by team. Check it before trusting a player prop.</p></div>
      <button type="button" class="bt ghost" data-page="predictions">${ic('pred', 18)}Back to Predictions</button></header><div id="ijBody" class="vst" aria-live="polite"></div></div>`;
    draw();
  }
  function draw() {
    const el = document.getElementById('ijBody'); if (!el) return;
    const v = data.get(I.sport), act = document.activeElement?.closest?.('#pg-injuries [data-fk]')?.dataset.fk;
    const seg = (name, label, opts, cur) => `<div class="cx-row scroll" role="radiogroup" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" class="cx" role="radio" aria-checked="${cur === k}" tabindex="${cur === k ? 0 : -1}" data-ij${name}="${k}" data-fk="${name}-${k}">${esc(l)}</button>`).join('')}</div>`;
    const head = `<div class="pd-filters">${seg('sport', 'League', Object.entries(NAME), I.sport)}
      <div class="pd-ctl">${seg('lv', 'Status', [['all', 'Everyone listed'], ...LEVELS.slice(0, 4)], I.lv)}
        <label class="ij-chk"><input type="checkbox" data-ijf="lines" data-fk="f-lines"${I.lines ? ' checked' : ''}> Only players with a line today</label>
        <label class="ij-chk"><input type="checkbox" data-ijf="mine" data-fk="f-mine"${I.mine ? ' checked' : ''}> Only my teams</label>
        <label class="ij-q"><span class="sr-only">Find a player or team</span><input class="inp sm" type="search" name="ij-q" autocomplete="off" placeholder="Find a player or team…" value="${esc(I.q)}" data-ijq data-fk="q"></label></div></div>`;
    if (!v || (v.promise && !v.teams)) { el.innerHTML = head + `<div class="card ij-wait" aria-busy="true"><span class="pd-spin" aria-hidden="true"></span><span>Loading the ${esc(NAME[I.sport])} injury report…</span></div>`; restore(act); return }
    if (!v.teams) { el.innerHTML = head + `<div class="card emp">${ic('help', 28)}<b>The ${esc(NAME[I.sport])} injury report did not load</b><p>${esc(v.error)}. This is a problem reaching ESPN, not an empty report.</p><button type="button" class="bt" data-ij="reload" data-fk="reload">Try again</button></div>`; restore(act); return }
    const lines = I.lines ? linesToday() : null, mine = I.mine ? myTeams() : null, q = norm(I.q);
    const teams = v.teams.map(t => ({ ...t, players: t.players.filter(p => (I.lv === 'all' || p.lv === I.lv) && (!lines || lines.has(norm(p.name))) && (!q || norm(p.name).includes(q) || norm(t.name).includes(q))) }))
      .filter(t => t.players.length && (!mine || mine.has(norm(t.abbr)) || [...mine].some(m => m && norm(t.name).includes(m))));
    const n = teams.reduce((a, t) => a + t.players.length, 0), outN = teams.reduce((a, t) => a + t.players.filter(p => p.lv === 'out').length, 0);
    el.innerHTML = head + `<p class="lb ij-at">Read from ESPN ${esc(ago(v.at))}${v.error ? ` · the last check failed (${esc(v.error)}), so this is the earlier reading` : ''} · ${n} ${n === 1 ? 'player' : 'players'} listed${outN ? `, ${outN} out` : ''} <button type="button" class="bt ghost sm" data-ij="reload" data-fk="reload">Refresh</button></p>
      ${teams.length ? `<div class="ij-grid">${teams.map(t => `<section class="card ij-team" aria-labelledby="ij-${esc(t.abbr || t.name)}"><h2 id="ij-${esc(t.abbr || t.name)}">${esc(t.name)}</h2>
        <ul class="ij-list">${t.players.sort((a, b) => LEVELS.findIndex(x => x[0] === a.lv) - LEVELS.findIndex(x => x[0] === b.lv)).map(p => `<li><div class="ij-p"><b>${esc(p.name)}</b>${p.pos ? `<small>${esc(p.pos)}</small>` : ''}</div>
          <span class="pl ij-lv ij-${p.lv}">${esc(p.status || LEVEL_NAME[p.lv])}</span>
          <small class="ij-what">${esc([p.what, p.back ? `expected back ${day(Date.parse(p.back))}` : '', p.date ? `updated ${day(p.date)}` : ''].filter(Boolean).join(' · '))}</small>
          ${p.note ? `<p class="ij-note">${esc(p.note)}</p>` : ''}</li>`).join('')}</ul></section>`).join('')}</div>`
      : `<div class="card emp">${ic('check', 28)}<b>${I.lv === 'all' && !lines && !mine && !q ? `No ${esc(NAME[I.sport])} players are on the injury report` : 'Nobody listed in this view'}</b><p>${lines ? 'None of the players with a line today is on the report. ' : ''}${q || I.lv !== 'all' || mine ? 'Clear a filter to see more.' : ''}</p></div>`}
      <details class="card hs-how"><summary>About lineups and this report</summary>
        <p>This is the league injury report as ESPN carries it, with each player’s status, the injury, any expected return and the team’s note. A player who isn’t listed is not confirmed in the lineup: Floodlight doesn’t read confirmed starting lineups yet, and ESPN lists starters only once a game begins. NBA teams post their status reports by the afternoon of a game and update them close to tip-off, so check again late.</p>
        <p>The evidence panel on a player prop uses this same report: it flags the player’s own status and lists teammates who are out, because a missing teammate can change minutes and usage.</p></details>`;
    restore(act);
  }
  const restore = act => { if (act) [...document.querySelectorAll('#pg-injuries [data-fk]')].find(x => x.dataset.fk === act)?.focus({ preventScroll: true }) };
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#pg-injuries [data-ijsport],#pg-injuries [data-ijlv],#pg-injuries [data-ij]'); if (!t) return; const d = t.dataset;
    if (d.ijsport) { I.sport = d.ijsport; load(I.sport) } else if (d.ijlv) I.lv = d.ijlv; else if (d.ij === 'reload') load(I.sport, true);
    draw();
  });
  document.addEventListener('change', ev => { const f = ev.target.dataset?.ijf; if (f) { I[f] = ev.target.checked; draw() } });
  let qt = 0;
  document.addEventListener('input', ev => { if (ev.target.matches?.('[data-ijq]')) { clearTimeout(qt); const v = ev.target.value; qt = setTimeout(() => { I.q = v; draw() }, 200) } });
  document.addEventListener('fl:injuries', ev => { if (ev.detail?.sport === I.sport && window.flPages?.current?.() === 'injuries') draw() });
  window.flPages?.add('injuries', { title: 'Injuries and lineups', render, onShow(el, arg) { if (arg && PATH[arg]) I.sport = arg; load(I.sport); draw() } });
  window.flInjuries = { load, ready, status, team, level, LEVEL_NAME, norm, PATH };
})();
