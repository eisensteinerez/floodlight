/* Floodlight · the player profile's shared parts: the header card, the awards shelf, the recent-games chart and the
   career table. Each sport's own file still loads its own data and works out its own ranks; it hands the pieces here
   so every profile is laid out the same way.

   Awards: no data provider the site uses carries them. They live in the site's own awards file, which starts empty and
   only an admin adds to, one entry at a time with a source link (server.py, /api/awards). An athlete with no entries
   has no shelf at all. Nothing here ever fills an award in. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const medal = s => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8l-2.500 6h-3z"/><circle cx="12" cy="15" r="5.500"/><path d="M11.200 13.500l1-.7V17"/></svg>`;
  const icon = (k, s = 26) => k === 'medal' ? medal(s) : ic(k, s);

  /* The awards each sport has, most important first. [id, name, icon, short name for the badge] */
  const T = 'trophy', S_ = 'star', M = 'medal';
  const BASKET = [['mvp', 'Most Valuable Player', T, 'MVP'], ['finals-mvp', 'Finals MVP', T], ['champion', 'Champion', T], ['dpoy', 'Defensive Player of the Year', T, 'DPOY'], ['roy', 'Rookie of the Year', M],
    ['sixth-man', 'Sixth Man of the Year', M], ['mip', 'Most Improved Player', M], ['clutch', 'Clutch Player of the Year', M], ['all-nba-1', 'All-NBA First Team', M], ['all-nba-2', 'All-NBA Second Team', M], ['all-nba-3', 'All-NBA Third Team', M],
    ['all-defensive-1', 'All-Defensive First Team', M], ['all-defensive-2', 'All-Defensive Second Team', M], ['all-rookie-1', 'All-Rookie First Team', M], ['all-rookie-2', 'All-Rookie Second Team', M],
    ['all-star-mvp', 'All-Star Game MVP', S_], ['all-star', 'All-Star', S_], ['scoring-title', 'Scoring champion', T], ['rebounding-title', 'Rebounding champion', T], ['assist-title', 'Assists champion', T]];
  const FIGHT = [['title-win', 'Title win', T], ['fighter-of-the-year', 'Fighter of the Year', T], ['fight-of-the-night', 'Fight of the Night', S_], ['performance-of-the-night', 'Performance of the Night', M]];
  const CATALOGUE = {
    nba: BASKET, wnba: BASKET.map(a => [a[0], a[1].replace('All-NBA', 'All-WNBA'), a[2], a[3]]),
    nfl: [['mvp', 'Most Valuable Player', T, 'MVP'], ['super-bowl-mvp', 'Super Bowl MVP', T], ['super-bowl', 'Super Bowl champion', T], ['opoy', 'Offensive Player of the Year', T, 'OPOY'], ['dpoy', 'Defensive Player of the Year', T, 'DPOY'],
      ['oroy', 'Offensive Rookie of the Year', M], ['droy', 'Defensive Rookie of the Year', M], ['comeback', 'Comeback Player of the Year', M], ['walter-payton', 'Walter Payton Man of the Year', M], ['all-pro-1', 'First-team All-Pro', M], ['all-pro-2', 'Second-team All-Pro', M], ['pro-bowl', 'Pro Bowl', S_]],
    mlb: [['mvp', 'Most Valuable Player', T, 'MVP'], ['cy-young', 'Cy Young Award', T, 'Cy Young'], ['world-series-mvp', 'World Series MVP', T], ['world-series', 'World Series champion', T], ['roy', 'Rookie of the Year', M], ['gold-glove', 'Gold Glove', M],
      ['silver-slugger', 'Silver Slugger', M], ['reliever', 'Reliever of the Year', M], ['batting-title', 'Batting title', T], ['all-star', 'All-Star', S_]],
    nhl: [['hart', 'Hart Trophy', T, 'Hart'], ['conn-smythe', 'Conn Smythe Trophy', T, 'Conn Smythe'], ['stanley-cup', 'Stanley Cup', T], ['ted-lindsay', 'Ted Lindsay Award', T], ['art-ross', 'Art Ross Trophy', T], ['rocket-richard', 'Rocket Richard Trophy', T],
      ['norris', 'Norris Trophy', T], ['vezina', 'Vezina Trophy', T], ['selke', 'Selke Trophy', M], ['calder', 'Calder Trophy', M], ['all-star', 'All-Star', S_]],
    cfb: [['heisman', 'Heisman Trophy', T, 'Heisman'], ['maxwell', 'Maxwell Award', T], ['walter-camp', 'Walter Camp Award', T], ['davey-obrien', 'Davey O’Brien Award', M], ['doak-walker', 'Doak Walker Award', M], ['biletnikoff', 'Biletnikoff Award', M],
      ['outland', 'Outland Trophy', M], ['bednarik', 'Bednarik Award', M], ['nagurski', 'Nagurski Trophy', M], ['thorpe', 'Thorpe Award', M], ['all-american', 'All-American', S_], ['conference-poy', 'Conference player of the year', M]],
    cbb: [['wooden', 'Wooden Award', T, 'Wooden'], ['naismith', 'Naismith Player of the Year', T, 'Naismith'], ['ap-poy', 'AP Player of the Year', T], ['final-four-mop', 'Final Four Most Outstanding Player', T], ['all-american', 'All-American', S_], ['conference-poy', 'Conference player of the year', M]],
    soccer: [['ballon-dor', 'Ballon d’Or', T], ['fifa-best', 'The Best FIFA Player', T], ['trophy', 'Major trophy', T], ['golden-boot', 'Golden Boot', T], ['player-of-the-season', 'League player of the season', M], ['golden-glove', 'Golden Glove', M], ['team-of-the-season', 'Team of the season', S_]],
    tennis: [['australian-open', 'Australian Open title', T], ['roland-garros', 'Roland Garros title', T], ['wimbledon', 'Wimbledon title', T], ['us-open', 'US Open title', T], ['year-end-1', 'Year-end No. 1', T], ['tour-finals', 'Tour Finals title', T], ['olympic-medal', 'Olympic medal', M]],
    ufc: FIGHT, boxing: FIGHT,
  };
  const admin = () => window.S?.me?.role === 'admin';

  /* ---------- the awards file ---------- */
  const cache = new Map();   // "sport:id" -> { list } once loaded, { loading } before
  const rerender = () => { try { if (window.S?.stack?.length && typeof renderSheet === 'function') renderSheet(); else if (window.S?.sport === 'ufc' && typeof ufcRender === 'function') ufcRender() } catch (e) {} window.dispatchEvent(new Event('fl:awards')) };
  function awards(sport, id) {
    if (!CATALOGUE[sport] || !id) return [];
    const k = sport + ':' + id, c = cache.get(k); if (c) return c.list || [];
    cache.set(k, { loading: true });
    fetch(`/api/awards?sport=${encodeURIComponent(sport)}&id=${encodeURIComponent(id)}`, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { awards: [] }).catch(() => ({ awards: [] }))
      .then(d => { const list = Array.isArray(d.awards) ? d.awards : []; cache.set(k, { list }); if (list.length || admin()) rerender() });
    return [];
  }
  /* entries -> groups, most important first: [{ id, name, icon, short, detail, seasons[], entries[] }] */
  function groups(sport, list) {
    const cat = CATALOGUE[sport] || [], by = new Map();
    for (const a of list) { const def = cat.find(c => c[0] === a.award); if (!def) continue; const key = a.award + '|' + (a.detail || '');
      if (!by.has(key)) by.set(key, { id: a.award, name: def[1], icon: def[2], short: def[3] || def[1], detail: a.detail || '', order: cat.indexOf(def), seasons: [], entries: [] });
      const g = by.get(key); g.seasons.push(a.season); g.entries.push(a) }
    return [...by.values()].map(g => ({ ...g, seasons: g.seasons.sort() })).sort((a, b) => a.order - b.order || b.seasons.length - a.seasons.length);
  }
  const years = g => g.seasons.length > 6 ? `${g.seasons.length} times, ${g.seasons[0]} to ${g.seasons[g.seasons.length - 1]}` : g.seasons.join(' · ');
  function heatBadge(name, sport) {
    if (!name || !window.flEdge || !window.flHeat) return '';
    const n = String(name).toLowerCase(), mine = window.flEdge.all().filter(p => p.name.toLowerCase() === n && (!sport || p.sport === sport || (sport === 'cbb' || sport === 'cfb')));
    const p = window.flEdge.players(mine)[0]; return p ? window.flHeat.badge(p.heat) : '';
  }

  /* ---------- the header card ----------
     o: { back, sport, id, name, face (html), team (html), number, position, chips [text], stats [{ label, value, rank }], caption, extra (html),
          status (html), color, cls } */
  function hero(o) {
    const gs = groups(o.sport, awards(o.sport, o.id)), top = gs[0], many = gs.filter(g => g !== top && g.seasons.length >= 2).sort((a, b) => b.seasons.length - a.seasons.length)[0];
    const badges = [top ? `<span class="pl solid">${esc(top.short)}${top.detail ? ' · ' + esc(top.detail) : ''} ${esc(top.seasons[top.seasons.length - 1])}</span>` : '',
      top && top.seasons.length >= 2 && !many ? `<span class="pl">${top.seasons.length}× ${esc(top.short)}</span>` : '', many ? `<span class="pl">${many.seasons.length}× ${esc(many.short)}</span>` : '',
      heatBadge(o.name, o.heatSport || o.sport), o.status || ''].filter(Boolean).join('');
    // the team is the player record's (players.js): the page's own team stays only while the record agrees with it
    const reg = window.flPlayers?.fid(o.sport, o.id) || '';
    const team = o.team && reg ? `<span data-flreg="${esc(reg)}" data-flreg-show="keep" data-flreg-shown="${esc(String(o.teamId || ''))}" data-flreg-where="profile">${o.team}</span>` : o.team;
    const sub = [team, o.number ? `<span class="num">#${esc(String(o.number).replace(/^#/, ''))}</span>` : '', o.position ? `<span>${esc(o.position)}</span>` : ''].filter(Boolean).join('<i aria-hidden="true">·</i>');
    const stats = (o.stats || []).filter(s => s && s.value != null && s.value !== '');
    return `<div class="hero solo pfh ${o.cls || ''}" style="--tc:${esc(o.color || 'var(--accent)')}">${typeof topBar === 'function' ? topBar(o.back) : ''}
      <div class="pfh-main">${o.face || ''}<div class="pfh-id">${badges ? `<div class="pfh-badges">${badges}</div>` : ''}<h3 class="pfh-name">${esc(o.name || 'Loading…')}</h3>
        ${sub ? `<p class="pfh-sub">${sub}</p>` : ''}${reg ? `<p class="pfh-roster lb" data-flreg="${esc(reg)}" data-flreg-show="verified" aria-live="off" hidden></p>` : ''}${o.chips?.length ? `<ul class="pfh-chips">${o.chips.filter(Boolean).map(c => `<li class="pl">${esc(c)}</li>`).join('')}</ul>` : ''}${o.extra || ''}</div>
        ${stats.length ? `<div class="pfh-stats">${stats.map(s => `<div class="tile"><span class="lb">${esc(s.label)}</span><b class="num">${esc(s.value)}</b>${s.rank ? `<em>${esc(s.rank)}</em>` : ''}</div>`).join('')}</div>` : ''}</div>
      ${o.caption ? `<p class="pfh-cap">${o.caption}</p>` : ''}</div>${shelf(o)}${window.flTransfers?.movesCard(o.sport, o.name, o.id) || ''}`;
  }

  /* ---------- the awards shelf ---------- */
  function shelf(o) {
    const list = awards(o.sport, o.id), gs = groups(o.sport, list), cat = CATALOGUE[o.sport];
    if (!cat || !o.id || (!gs.length && !admin())) return '';   // no awards: no shelf, never an empty trophy case
    const tiles = gs.map((g, i) => `<article class="tile pfa-t${i === 0 ? ' pfa-first' : ''}">${icon(g.icon, 28)}<b>${esc(g.name)}${g.detail ? `<small>${esc(g.detail)}</small>` : ''}</b><span class="num">${esc(years(g))}</span></article>`).join('');
    const form = admin() ? `<details class="pfa-admin"${gs.length ? '' : ' open'}><summary>${gs.length ? 'Add or remove an award' : `Add an award for ${esc(o.name || 'this athlete')}`}</summary>
      <p class="lb">Only admins see this. Enter awards you have checked against a source; members see the shelf once there is at least one.</p>
      <form class="pfa-form" data-pfa="add" data-sport="${esc(o.sport)}" data-athlete="${esc(o.id)}" data-name="${esc(o.name || '')}">
        <label class="fl-f">Award<select class="inp" name="award" required>${cat.map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</select></label>
        <label class="fl-f">Season<input class="inp" name="season" required inputmode="numeric" autocomplete="off" placeholder="2025 or 2024-25…" pattern="(19|20)[0-9]{2}(-[0-9]{2})?"></label>
        <label class="fl-f">Detail, if it needs one<input class="inp" name="detail" maxlength="60" autocomplete="off" placeholder="The trophy, team or conference…"></label>
        <label class="fl-f">Source link<input class="inp" name="source" type="url" required autocomplete="off" placeholder="https://…"></label>
        <button class="bt" type="submit">Add award</button><p class="pfa-msg" role="alert"></p></form>
      ${list.length ? `<ul class="pfa-list">${list.slice().sort((a, b) => String(b.season).localeCompare(String(a.season))).map(a => { const def = cat.find(c => c[0] === a.award);
        return `<li><span><b>${esc(def ? def[1] : a.award)}${a.detail ? ' · ' + esc(a.detail) : ''}</b> ${esc(a.season)} · <a class="lk" href="${esc(a.source)}" target="_blank" rel="noopener noreferrer">source</a></span><button type="button" class="bt sm ghost" data-pfa-rm="${esc(a.id)}" data-sport="${esc(o.sport)}" data-athlete="${esc(o.id)}">Remove<span class="sr-only"> ${esc(def ? def[1] : a.award)} ${esc(a.season)}</span></button></li>` }).join('')}</ul>` : ''}</details>` : '';
    const n = list.filter(a => cat.some(c => c[0] === a.award)).length;
    return `<section class="card pfa" aria-label="Awards and honors"><div class="sec-h"><h2>${ic('spark', 20)}Awards and honors</h2>${n ? `<span class="lb">${n} career ${n === 1 ? 'honor' : 'honors'}</span>` : ''}</div>
      ${tiles ? `<div class="pfa-row">${tiles}</div>` : ''}${form}</section>`;
  }
  const post = body => fetch('/api/admin/awards', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
  document.addEventListener('submit', e => {
    const f = e.target.closest?.('form[data-pfa="add"]'); if (!f) return; e.preventDefault();
    const msg = f.querySelector('.pfa-msg'), b = f.querySelector('button[type=submit]'); b.disabled = true; msg.textContent = '';
    post({ op: 'add', sport: f.dataset.sport, athlete: f.dataset.athlete, name: f.dataset.name, award: f.award.value, season: f.season.value.trim(), detail: f.detail.value.trim(), source: f.source.value.trim() })
      .then(({ ok, d }) => { b.disabled = false; if (!ok) { msg.textContent = d.error || 'That did not save. Try again.'; return } cache.delete(f.dataset.sport + ':' + f.dataset.athlete); awards(f.dataset.sport, f.dataset.athlete) })
      .catch(() => { b.disabled = false; msg.textContent = 'That did not save. Check your connection and try again.' });
  });
  document.addEventListener('click', e => {
    const rm = e.target.closest?.('[data-pfa-rm]');
    if (rm) { rm.disabled = true; post({ op: 'remove', id: rm.dataset.pfaRm }).then(() => { cache.delete(rm.dataset.sport + ':' + rm.dataset.athlete); awards(rm.dataset.sport, rm.dataset.athlete) }); return }
    const tab = e.target.closest?.('[data-pfstat]');
    if (tab) { const v = window.S?.stack?.[window.S.stack.length - 1]; if (v) { v.pfStat = tab.dataset.pfstat; renderSheet(); document.querySelector(`[data-pfstat="${CSS.escape(v.pfStat)}"]`)?.focus({ preventScroll: true }) } }
  });

  /* ---------- six stat tiles: value, league rank, percentile bar ---------- */
  const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) };
  function statTiles(rows, peers) {
    rows = (rows || []).filter(r => r && r.pc != null && isFinite(r.pc)).slice(0, 6); if (!rows.length) return '';
    return `<div class="pf-six">${rows.map(r => `<article class="tile"><div class="pf-six-h"><span class="lb">${esc(r.label)}</span>${r.rank ? `<span class="pl num" title="${ord(r.rank)} of ${r.n}">${ord(r.rank)}</span>` : ''}</div>
      <b class="fig num">${esc(r.val)}</b><span class="trak" role="img" aria-label="${r.pc}th percentile"><i style="width:${Math.max(2, Math.min(100, r.pc))}%"></i></span>
      <small class="lb">${r.pc >= 50 ? `Better than ${Math.min(99, r.pc)}% of ${esc(peers || 'the league')}` : `Ahead of ${r.pc}% of ${esc(peers || 'the league')}`}</small></article>`).join('')}</div>`;
  }

  /* ---------- recent games, with a tab per stat ----------
     series: [{ k, label, unit, games: [{ v, opp, date, res, home }] oldest first }] */
  function recent(v, series, o = {}) {
    series = (series || []).filter(s => s.games?.length); if (!series.length) return '';
    const cur = series.find(s => s.k === v.pfStat) || series[0], vals = cur.games.map(g => +g.v), avg = vals.reduce((a, b) => a + b, 0) / vals.length, hi = Math.max(...vals);
    const few = cur.games.length < 5;
    return `<section class="card pf-recent" aria-label="Recent games"><div class="sec-h"><h2>${esc(cur.label)}, last ${cur.games.length} ${cur.games.length === 1 ? 'game' : 'games'}</h2>
        <div class="cx-row" role="group" aria-label="Stat">${series.map(s => `<button type="button" class="cx sm" aria-pressed="${s === cur}" data-pfstat="${esc(s.k)}">${esc(s.label)}</button>`).join('')}</div></div>
      ${window.flHeat.bars(cur.games, { line: few ? null : +avg.toFixed(1), lineLabel: 'Average', over: 'Above the average', under: 'Below the average', unit: cur.unit || cur.label.toLowerCase(), avg: false, label: `${cur.label}, game by game`, fresh: false })}
      <p class="lb">${few ? `Only ${cur.games.length} ${cur.games.length === 1 ? 'game' : 'games'} so far, so there is no average line yet. ` : ''}${o.span ? esc(o.span) + ' high' : 'High'}: <b class="num">${esc(window.flEdge?.fmt ? window.flEdge.fmt(hi) : hi)}</b> ${esc(cur.unit || cur.label.toLowerCase())}.</p></section>`;
  }
  /* an ESPN game log -> series. want: [[column label, name, unit]] */
  function espnSeries(log, want, n = 10) {
    const lab = log?.labels || [], evs = (log?.seasonTypes || []).flatMap(st => (st.categories || []).filter(c => !c.type || c.type === 'event').flatMap(c => c.events || [])).slice(0, n).reverse();
    return want.map(([col, label, unit]) => { const i = lab.indexOf(col); if (i < 0) return null;
      const games = evs.map(e => { const m = log.events?.[e.eventId] || {}, x = parseFloat(String(e.stats?.[i] ?? '').split('-')[0]); return isFinite(x) ? { v: x, opp: m.opponent?.abbreviation || '', date: m.gameDate, res: m.gameResult === 'W' || m.gameResult === 'L' ? m.gameResult : '', home: m.atVs ? m.atVs !== '@' : null } : null }).filter(Boolean);
      return { k: col, label, unit, games } }).filter(Boolean);
  }

  /* ---------- career by season, with a small trend bar on one column ---------- */
  function careerTable(c, title, trendCol) {
    if (!c?.statistics?.length) return '';
    const ti = trendCol ? c.labels.indexOf(trendCol) : -1, rows = c.statistics.slice().reverse(), max = ti < 0 ? 0 : Math.max(...rows.map(s => parseFloat(s.stats[ti]) || 0), 0);
    return `<div class="sub-h"><h5>${esc(title)}</h5></div><div class="tbx-wrap"><table class="tbx pf-career"><thead><tr><th scope="col">Season</th>${c.labels.map(x => `<th scope="col" class="r">${esc(x)}</th>`).join('')}${ti >= 0 ? `<th scope="col">${esc(trendCol)} by season</th>` : ''}</tr></thead><tbody>
      ${rows.map(s => `<tr><th scope="row">${esc(s.season?.displayName || '')} <small>${esc((s.teamSlug || '').split('-').pop())}</small></th>${s.stats.map(x => `<td class="r num">${esc(x)}</td>`).join('')}${ti >= 0 ? `<td><span class="trak pf-trend" aria-hidden="true"><i style="width:${max ? Math.round((parseFloat(s.stats[ti]) || 0) / max * 100) : 0}%"></i></span></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }

  window.flProfile = { hero, shelf, awards, groups, statTiles, recent, espnSeries, careerTable, heatBadge, CATALOGUE, ord };
})();
