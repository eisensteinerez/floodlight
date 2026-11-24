/* Floodlight · the player profile's shared parts: the header card, what changed, the awards shelf, the recent-games
   chart, the trends, the career table with its controls, and the Summary / Standard / Advanced choice. Each sport's own
   file still loads its own data and works out its own ranks; it hands the pieces here so every profile is laid out the
   same way.

   The default page is short on purpose: who the player is, where they play next, today's lines, the season's headline
   numbers (each said once: "16.1 per game · 66th of 384 · 83rd percentile"), the last ten games and what is moving.
   Everything else sits behind a tab (Career, All stats, Awards, Transactions) or the Advanced view.

   Awards: no data provider the site uses carries them. They live in the site's own awards file, which starts empty and
   only an owner adds to, one entry at a time with a source link (server.py, /api/awards). An athlete with no entries
   has no shelf and no Awards tab. The form is in the owner drawer (admin.js), never in the page. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const F = () => window.flFmt || { ord: n => n + 'th', pct: pc => ({ line: pc + ' percentile', head: pc + ' percentile', tail: '' }), rankLine: () => '' };
  const ord = n => F().ord(n);
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').replace(/ (jr|sr|ii|iii|iv)$/, '').trim();
  const medal = s => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8l-2.500 6h-3z"/><circle cx="12" cy="15" r="5.500"/><path d="M11.200 13.500l1-.7V17"/></svg>`;
  const pencil = s => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>`;
  const icon = (k, s = 26) => k === 'medal' ? medal(s) : ic(k, s);
  const top = () => { const st = window.S?.stack; return st?.length ? st[st.length - 1] : null };
  const LAB = new Set(['nba', 'wnba', 'nfl', 'nhl', 'mlb', 'soccer']);

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
  const owner = () => !!window.flAdmin?.owner?.();
  const editing = () => !!window.flAdmin?.on?.();

  /* ---------- the awards file ---------- */
  const cache = new Map();   // "sport:id" -> { list } once loaded, { loading } before
  const rerender = () => { try { if (window.S?.stack?.length && typeof renderSheet === 'function') renderSheet(); else if (window.S?.sport === 'ufc' && typeof ufcRender === 'function') ufcRender() } catch (e) {} window.dispatchEvent(new Event('fl:awards')); document.dispatchEvent(new Event('fl:admin-refresh')) };
  function awards(sport, id) {
    if (!CATALOGUE[sport] || !id) return [];
    const k = sport + ':' + id, c = cache.get(k); if (c) return c.list || [];
    cache.set(k, { loading: true });
    fetch(`/api/awards?sport=${encodeURIComponent(sport)}&id=${encodeURIComponent(id)}`, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { awards: [] }).catch(() => ({ awards: [] }))
      .then(d => { const list = Array.isArray(d.awards) ? d.awards : []; cache.set(k, { list }); if (list.length || owner()) rerender() });
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

  /* ---------- the three views: Summary, Standard, Advanced (remembered) ---------- */
  const MODES = [['summary', 'Summary', 'The essentials'], ['standard', 'Standard', 'Season averages, ranks and game logs'], ['advanced', 'Advanced', 'Percentiles, every table and career totals']];
  const mode = () => { const m = store.get('fl.pfMode', 'summary'); return MODES.some(x => x[0] === m) ? m : 'summary' };
  const modeBar = () => `<div class="pf-mode" role="radiogroup" aria-label="How much to show">${MODES.map(([k, l, d]) => `<button type="button" class="pf-mode-b" role="radio" aria-checked="${mode() === k}" tabindex="${mode() === k ? 0 : -1}" data-pfmode="${k}" title="${esc(d)}">${l}</button>`).join('')}</div>`;

  /* ---------- the one person this profile is about (for tabs, the owner drawer, follow and board) ---------- */
  let who = null;   // { sport, lab, id, name, team, photo, league, sportName, at }

  /* ---------- next game: the team's own schedule, read once every ten minutes ---------- */
  const nextCache = new Map();
  function nextGame(path, teamId) {
    if (!path || !teamId) return null;
    const k = path + ':' + teamId, c = nextCache.get(k);
    if (c && (c.loading || Date.now() - c.at < 600e3)) return c.game || null;
    nextCache.set(k, { loading: true, game: c?.game || null });
    const get = u => typeof cj === 'function' ? cj(u) : fetch(u).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));
    get(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${encodeURIComponent(teamId)}/schedule`).then(d => {
      const now = Date.now() - 3 * 3600e3;
      const ev = (d?.events || []).filter(e => { const st = e.competitions?.[0]?.status?.type?.state; return st === 'in' || (st !== 'post' && Date.parse(e.date) > now) }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
      let game = null;
      if (ev) { const co = ev.competitions?.[0] || {}, me = (co.competitors || []).find(x => String(x.team?.id) === String(teamId)), op = (co.competitors || []).find(x => x !== me);
        const tv = (co.broadcasts || []).flatMap(b => b.media?.shortName || b.names || []).filter(Boolean)[0] || '';
        game = { at: Date.parse(ev.date), live: co.status?.type?.state === 'in', home: me?.homeAway === 'home', opp: op?.team?.location || op?.team?.shortDisplayName || op?.team?.displayName || '', oppFull: op?.team?.displayName || '', tv } }
      nextCache.set(k, { at: Date.now(), game }); if (game) rerender();
    }).catch(() => nextCache.set(k, { at: Date.now() - 480e3, game: null }));
    return c?.game || null;
  }
  function dayWord(t) {
    const d = new Date(t), a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0);
    const diff = Math.round((b - a) / 864e5), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return diff === 0 ? `Today ${time}` : diff === 1 ? `Tomorrow ${time}` : `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
  }
  const nextLine = g => !g ? '' : `${g.live ? 'Live now' : 'Next'}: ${g.home ? 'vs' : 'at'} ${g.opp}${g.live ? '' : ` · ${dayWord(g.at)}`}${g.tv ? ` · ${g.tv}` : ''}`;

  /* ---------- today's posted lines for this player (the same list Predictions and the Lab read) ---------- */
  const asked = new Set();
  function propsFor(lab, name) {
    const E = window.flEdge; if (!E || !lab || !name || !LAB.has(lab)) return null;
    const have = E.have(lab);
    if (!have && !asked.has(lab)) { asked.add(lab); E.board(lab).then(r => { if ((r?.picks || []).some(p => norm(p.name) === norm(name))) rerender() }).catch(() => {}) }
    if (!have) return null;
    return (have.picks || []).filter(p => norm(p.name) === norm(name)).sort((a, b) => (b.edge ?? -99) - (a.edge ?? -99) || Math.abs(b.heat - 50) - Math.abs(a.heat - 50));
  }

  /* ---------- follow (the same follows list the Transfer window keeps) ---------- */
  const fKey = o => ({ k: 'player', lg: o.lab || o.sport, id: String(o.id || ''), name: o.name });
  const following = o => !!window.flTransfers?.following?.(fKey(o));

  /* ---------- breadcrumbs: Search › Basketball › NBA › LeBron James ---------- */
  function crumbs(o) {
    const fromSearch = !!(window.flSearch?.last?.() && document.getElementById('gsBack'));
    const items = [fromSearch ? `<li><button type="button" class="pf-cr" data-pfcrumb="search">Search</button></li>` : '',
      o.sportName ? `<li><button type="button" class="pf-cr" data-pfcrumb="sport">${esc(o.sportName)}</button></li>` : '',
      o.league && o.league !== o.sportName ? `<li><button type="button" class="pf-cr" data-pfcrumb="league" data-lg="${esc(o.leagueKey || '')}">${esc(o.league)}</button></li>` : '',
      `<li><span aria-current="page">${esc(o.name || 'Player')}</span></li>`].filter(Boolean).join('');
    const big = !!window.S?.big;
    return `<div class="pf-nav"><nav class="pf-crumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>
      <div class="pf-nav-go">${fromSearch ? `<button type="button" class="bt sm ghost" data-pfcrumb="search">${ic('left', 16)}Back to search results</button>` : ''}
        <button type="button" class="bt sm ghost" data-act="expand">${big ? 'Close full page' : 'Open full player page'}</button></div></div>`;
  }

  /* ---------- the header card: the compact overview ----------
     o: { back, sport, lab, id, name, face (html), photo, team (html), teamName, number, position, chips [text], status (html),
          avail { text, tone: ok | warn | out }, next { path, teamId }, stats [{ label, value, unit, rank, n, pc } or { label, value, rank: text }],
          caption, extra (html), color, cls, tabs (true: Awards and Transactions are tabs, not cards), sportName, league, leagueKey } */
  function hero(o) {
    const lab = o.lab || (LAB.has(o.heatSport) ? o.heatSport : LAB.has(o.sport) ? o.sport : '');
    who = { sport: o.sport, lab, id: o.id, name: o.name, team: o.teamName || '', photo: o.photo || '', league: o.league || '', sportName: o.sportName || '', at: Date.now() };
    const gs = groups(o.sport, awards(o.sport, o.id)), topA = gs[0], many = gs.filter(g => g !== topA && g.seasons.length >= 2).sort((a, b) => b.seasons.length - a.seasons.length)[0];
    const badges = [topA ? `<span class="pl solid">${esc(topA.short)}${topA.detail ? ' · ' + esc(topA.detail) : ''} ${esc(topA.seasons[topA.seasons.length - 1])}</span>` : '',
      topA && topA.seasons.length >= 2 && !many ? `<span class="pl">${topA.seasons.length}× ${esc(topA.short)}</span>` : '', many ? `<span class="pl">${many.seasons.length}× ${esc(many.short)}</span>` : '',
      heatBadge(o.name, o.heatSport || o.sport)].filter(Boolean).join('');
    // the team is the player record's (players.js): the page's own team stays only while the record agrees with it
    const reg = window.flPlayers?.fid(o.sport, o.id) || '';
    const team = o.team && reg ? `<span data-flreg="${esc(reg)}" data-flreg-show="keep" data-flreg-shown="${esc(String(o.teamId || ''))}" data-flreg-where="profile">${o.team}</span>` : o.team;
    const sub = [team, o.number ? `<span class="num">#${esc(String(o.number).replace(/^#/, ''))}</span>` : '', o.position ? `<span>${esc(o.position)}</span>` : ''].filter(Boolean).join('<i aria-hidden="true">·</i>');
    const stats = (o.stats || []).filter(s => s && s.value != null && s.value !== '');
    who.stats = stats.slice(0, 4).map(s => [s.label, `${s.value}${s.unit ? ` ${s.unit}` : ''}`]); who.position = o.position || '';
    // availability and the next game, on one line under the team
    const inj = !o.avail && lab && window.flInjuries ? (window.flInjuries.load(lab), window.flInjuries.status(lab, o.name)) : null;
    const avail = o.avail || (inj ? { text: inj.status || window.flInjuries.LEVEL_NAME[inj.lv] || 'Injured', tone: inj.lv === 'out' ? 'out' : 'warn', what: inj.what } : null);
    const ng = o.next ? nextGame(o.next.path, o.next.teamId) : null;
    const now = [avail ? `<span class="pf-av ${avail.tone || 'ok'}"><i aria-hidden="true"></i>${esc(avail.text)}${avail.what ? `<small> · ${esc(avail.what)}</small>` : ''}</span>` : '', ng ? `<span class="pf-next">${esc(nextLine(ng))}</span>` : ''].filter(Boolean).join('');
    // three bio facts up front; the rest one tap away
    const chips = (o.chips || []).filter(Boolean), lead = chips.slice(0, 3), more = chips.slice(3);
    const chipHTML = lead.length ? `<ul class="pfh-chips">${lead.map(c => `<li class="pl">${esc(c)}</li>`).join('')}${more.length ? `<li><details class="pfh-more"><summary class="pl">More bio</summary><ul class="pfh-chips">${more.map(c => `<li class="pl">${esc(c)}</li>`).join('')}</ul></details></li>` : ''}</ul>` : '';
    // follow, compare, add to board
    const fol = following(o);
    const acts = o.id && o.name ? `<div class="pfh-acts">${window.flTransfers?.follow && !o.noFollow ? `<button type="button" class="bt sm${fol ? '' : ' ghost'}" data-pfact="follow" aria-pressed="${fol}" aria-label="Follow ${esc(o.name)}">${ic(fol ? 'check' : 'bell', 16)}${fol ? 'Following' : 'Follow'}</button>` : ''}
      ${lab && window.flLab?.compare ? `<button type="button" class="bt sm ghost" data-pfact="compare" aria-label="Compare ${esc(o.name)} with another player">${ic('compare', 16)}Compare</button>` : ''}
      ${lab && window.flBoards ? `<button type="button" class="bt sm ghost" data-pfact="board" aria-label="Add to board: ${esc(o.name)}">${ic('plus', 16)}Add to board</button>` : ''}${window.flShare ? `<button type="button" class="bt sm ghost" data-pfact="share" aria-label="Share a picture of ${esc(o.name)}'s card">${window.flShare.ICON}Share</button>` : ''}</div>` : '';
    // the headline numbers: each one once, with its rank and percentile
    const tiles = stats.length ? `<div class="pfh-stats">${stats.map(s => { const rl = s.n != null ? F().rankLine(s.rank, s.n, s.pc) : (s.rank || '');
      return `<div class="tile"><span class="lb">${esc(s.label)}</span><b class="num">${esc(s.value)}</b>${s.unit ? `<small class="pfh-u">${esc(s.unit)}</small>` : ''}${rl ? `<em>${esc(rl)}</em>` : ''}</div>` }).join('')}</div>` : '';
    // today's lines
    const props = propsFor(lab, o.name);
    const pr = props?.length ? `<div class="pf-props"><span class="lb">${props.length === 1 ? 'Line posted today' : `${props.length} lines posted today`}</span><ul>${props.slice(0, 4).map((p, i) => `<li><button type="button" class="pf-prop" data-pfprop="${i}">
        <span>${esc(p.text)}</span><b class="num">${Math.round(p.ours * 100)}%</b>${p.edge != null ? `<small class="num">${p.edge > 0 ? '+' : ''}${p.edge} edge</small>` : ''}</button></li>`).join('')}</ul>
        ${props.length > 4 ? `<button type="button" class="lk" data-pfact="lab">All ${props.length} lines in the Lab</button>` : ''}</div>` : '';
    const out = `<div class="hero solo pfh ${o.cls || ''}" style="--tc:${esc(o.color || 'var(--accent)')}">${typeof topBar === 'function' ? topBar(o.back) : ''}${o.id && o.name ? crumbs(o) : ''}
      <div class="pfh-main">${o.face || ''}<div class="pfh-id">${badges ? `<div class="pfh-badges">${badges}</div>` : ''}<h3 class="pfh-name">${esc(o.name || 'Loading…')}</h3>
        ${sub ? `<p class="pfh-sub">${sub}</p>` : ''}${now ? `<p class="pfh-now">${now}</p>` : ''}${reg ? `<p class="pfh-roster lb" data-flreg="${esc(reg)}" data-flreg-show="verified" aria-live="off" hidden></p>` : ''}${chipHTML}${o.status || ''}${o.extra || ''}${acts}</div>
        ${tiles}</div>${pr}
      ${o.caption ? `<p class="pfh-cap">${o.caption}</p>` : ''}${marker(o)}</div>${changed(o)}`;
    return o.tabs ? out : out + shelf(o) + (window.flTransfers?.movesCard(o.sport, o.name, o.id) || '');
  }

  /* ---------- what changed: a move that explains an unexpected team ---------- */
  function changed(o) {
    const moves = window.flTransfers?.moves?.(o.sport, o.name, o.id) || [];
    const reg = window.flPlayers?.fid(o.sport, o.id), rec = reg ? window.flPlayers.peek(reg) : null;
    const mv = moves.find(m => m.between && Date.now() - m.when < 200 * 864e5);
    const prev = rec?.prev?.teamName && Date.now() / 1000 - (rec.prev.until || 0) < 60 * 86400 ? rec.prev : null;
    if (!mv && !prev) return '';
    const now = mv?.to || rec?.teamName || '', before = mv?.from || prev?.teamName || '';
    const head = now ? `Joined ${now}` : mv ? mv.line : 'Changed teams';
    const when = mv ? `${mv.step} ${mv.when.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}` : `Roster change seen ${new Date(prev.until * 1000).toLocaleDateString([], { month: 'long', day: 'numeric' })}`;
    return `<section class="card pf-chg" aria-labelledby="pfChgH"><span class="pf-chg-k">${ic('transfers', 18)}What changed</span><div class="pf-chg-b"><h2 id="pfChgH">${esc(head)}</h2>
      <p>${esc(when)}${before && before !== now ? ` · Previous team: ${esc(before)}` : ''}</p>${mv && before ? '<p class="lb">Stats from earlier this season and before may be with the previous team.</p>' : ''}</div>
      ${moves.length && o.tabs ? `<button type="button" class="bt sm ghost" data-pftab="moves">All transactions</button>` : ''}</section>`;
  }

  /* ---------- the extra tabs every profile can grow: Awards and Transactions, only when there is something in them ---------- */
  function tabs(base, o = who) {
    if (!o) return base;
    const out = [...base];
    if (groups(o.sport, awards(o.sport, o.id)).length) out.push(['awards', 'Awards']);
    if ((window.flTransfers?.moves?.(o.sport, o.name, o.id) || []).length) out.push(['moves', 'Transactions']);
    return out;
  }
  function extra(v, o = who) {
    if (!o || !v) return null;
    if (v.tab === 'awards') return groups(o.sport, awards(o.sport, o.id)).length ? shelf(o) : `<div class="note">No awards entered for ${esc(o.name)} yet.</div>`;
    if (v.tab === 'moves') return window.flTransfers?.movesCard(o.sport, o.name, o.id) || `<div class="note">No transactions on record for ${esc(o.name)}.</div>`;
    return null;
  }

  /* ---------- the awards shelf (the form lives in the owner drawer) ---------- */
  function shelf(o) {
    const list = awards(o.sport, o.id), gs = groups(o.sport, list), cat = CATALOGUE[o.sport];
    if (!cat || !o.id || !gs.length) return marker(o);   // no awards: no shelf, never an empty trophy case (the marker lets an owner add one)
    const tiles = gs.map((g, i) => `<article class="tile pfa-t${i === 0 ? ' pfa-first' : ''}">${icon(g.icon, 28)}<b>${esc(g.name)}${g.detail ? `<small>${esc(g.detail)}</small>` : ''}</b><span class="num">${esc(years(g))}</span></article>`).join('');
    const n = list.filter(a => cat.some(c => c[0] === a.award)).length;
    return `<section class="card pfa" aria-labelledby="pfaH"><div class="sec-h"><h2 id="pfaH">${ic('spark', 20)}Awards and honors</h2>${n ? `<span class="lb">${n} career ${n === 1 ? 'honor' : 'honors'}</span>` : ''}
      ${editing() ? `<button type="button" class="ib own-pen" data-owntool="awards" aria-label="Edit awards for ${esc(o.name || 'this athlete')}" title="Edit awards">${pencil(18)}</button>` : ''}</div>
      <div class="pfa-row">${tiles}</div>${marker(o)}</section>`;
  }
  // the owner drawer's awards tool (admin.js shows it while a profile or fighter page with an awards catalogue is showing)
  const marker = o => CATALOGUE[o.sport] && o.id ? `<span hidden data-pfa-who="${esc(JSON.stringify({ sport: o.sport, id: String(o.id), name: o.name || '' }))}"></span>` : '';
  function curWho() {
    const el = [...document.querySelectorAll('[data-pfa-who]')].reverse().find(x => x.parentElement && x.parentElement.getClientRects().length && !x.closest('.own-dr-wrap'));
    try { return el ? JSON.parse(el.dataset.pfaWho) : null } catch { return null }
  }
  function awardsTool() {
    const o = curWho(), cat = o && CATALOGUE[o.sport]; if (!cat || !o.id) return '';
    const list = awards(o.sport, o.id);
    return `<p class="lb">Enter awards you have checked against a source. Members see the shelf and an Awards tab once there is at least one.</p>
      <form class="pfa-form" data-pfa="add" data-sport="${esc(o.sport)}" data-athlete="${esc(o.id)}" data-name="${esc(o.name || '')}">
        <label class="fl-f">Award<select class="inp" name="award" required>${cat.map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</select></label>
        <label class="fl-f">Season<input class="inp" name="season" required inputmode="numeric" autocomplete="off" placeholder="2025 or 2024-25…" pattern="(19|20)[0-9]{2}(-[0-9]{2})?"></label>
        <label class="fl-f">Detail, if it needs one<input class="inp" name="detail" maxlength="60" autocomplete="off" placeholder="The trophy, team or conference…"></label>
        <label class="fl-f">Source link<input class="inp" name="source" type="url" required autocomplete="off" placeholder="https://…"></label>
        <button class="bt" type="submit">Add award</button><p class="pfa-msg" role="alert"></p></form>
      ${list.length ? `<ul class="pfa-list">${list.slice().sort((a, b) => String(b.season).localeCompare(String(a.season))).map(a => { const def = cat.find(c => c[0] === a.award);
        return `<li><span><b>${esc(def ? def[1] : a.award)}${a.detail ? ' · ' + esc(a.detail) : ''}</b> ${esc(a.season)} · <a class="lk" href="${esc(a.source)}" target="_blank" rel="noopener noreferrer">source</a></span><button type="button" class="bt sm ghost" data-pfa-rm="${esc(a.id)}" data-sport="${esc(o.sport)}" data-athlete="${esc(o.id)}">Remove<span class="sr-only"> ${esc(def ? def[1] : a.award)} ${esc(a.season)}</span></button></li>` }).join('')}</ul>` : `<p class="lb">No awards entered for ${esc(o.name)} yet.</p>`}`;
  }
  window.flAdmin?.tool?.({ id: 'awards', title: () => `Awards for ${curWho()?.name || 'this player'}`, when: () => !!curWho(), html: awardsTool });
  const post = body => fetch('/api/admin/awards', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
  document.addEventListener('submit', e => {
    const f = e.target.closest?.('form[data-pfa="add"]'); if (!f) return; e.preventDefault();
    const msg = f.querySelector('.pfa-msg'), b = f.querySelector('button[type=submit]'); b.disabled = true; msg.textContent = '';
    post({ op: 'add', sport: f.dataset.sport, athlete: f.dataset.athlete, name: f.dataset.name, award: f.award.value, season: f.season.value.trim(), detail: f.detail.value.trim(), source: f.source.value.trim() })
      .then(({ ok, d }) => { b.disabled = false; if (!ok) { msg.textContent = d.error || 'That did not save. Try again.'; return } cache.delete(f.dataset.sport + ':' + f.dataset.athlete); awards(f.dataset.sport, f.dataset.athlete); window.flAdmin?.say?.('Award added.') })
      .catch(() => { b.disabled = false; msg.textContent = 'That did not save. Check your connection and try again.' });
  });

  /* ---------- clicks: awards removal, stat tabs, modes, breadcrumbs, actions, career controls ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest?.('[data-pfa-rm],[data-pfstat],[data-pfmode],[data-pfcrumb],[data-pfact],[data-pfprop],[data-pftab],[data-pfcar]'); if (!t) return;
    const d = t.dataset, v = top();
    if (d.pfaRm) { t.disabled = true; post({ op: 'remove', id: d.pfaRm }).then(() => { cache.delete(d.sport + ':' + d.athlete); awards(d.sport, d.athlete); window.flAdmin?.say?.('Award removed.') }); return }
    if (d.pfstat) { if (v) { v.pfStat = d.pfstat; renderSheet(); document.querySelector(`[data-pfstat="${CSS.escape(v.pfStat)}"]`)?.focus({ preventScroll: true }) } return }
    if (d.pfmode) { store.set('fl.pfMode', d.pfmode); renderSheet(); document.querySelector(`[data-pfmode="${d.pfmode}"]`)?.focus({ preventScroll: true }); return }
    if (d.pftab) { if (v) { v.tab = d.pftab; renderSheet(); document.querySelector(`#sheet .tab[data-tab="${CSS.escape(d.pftab)}"]`)?.focus() } return }
    if (d.pfcrumb) return crumb(d.pfcrumb, t);
    if (d.pfact || d.pfprop) return act(d, t);
    if (d.pfcar) return carAct(v, t);
  });
  function leaveSheet() { try { if (typeof closeSheet === 'function') closeSheet(true) } catch (e) {} }
  function crumb(k, t) {
    if (k === 'search') { const b = document.querySelector('#gsBack .gs-back-go'); leaveSheet(); if (b) b.click(); else window.flSearch?.open?.(); return }
    if (k === 'sport') return leaveSheet();
    if (k === 'league') {   // the sport page, on this league
      const lg = t.dataset.lg, S = window.S; leaveSheet();
      if (lg && S) { const st = { basketball: S.bb, football: S.fb, hockey: S.hk, baseball: S.bs }[S.sport]; if (st && 'lg' in st && st.lg !== lg) { st.lg = lg; try { typeof render === 'function' && render() } catch (e) {} } }
    }
  }
  /* the player card as a picture (share.js): the header's own numbers, and a line only when the verified feed has it open
     now. share.js checks that line once more right before drawing, so a line that just closed says so on the picture. */
  function shareCard(o, btn) {
    const M = window.flMarkets, line = o.lab && M?.open ? M.open(o.lab).filter(m => norm(m.name) === norm(o.name)).sort((a, b) => (b.sedge ?? -99) - (a.sedge ?? -99))[0] : null;
    const side = line ? (line.side === 'under' ? 'Under' : 'Over') : '', fmt = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
    window.flShare.share({ kicker: [o.league || o.sportName, 'Player card'].filter(Boolean).join(' · '), title: o.name, file: o.name,
      sub: [[o.team, o.position].filter(Boolean).join(' · '), line ? `Open line: ${side} ${fmt(line.line)} ${line.label || line.k}${line.verifiedAt ? `, verified ${new Date(line.verifiedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}` : ''].filter(Boolean).join('. '),
      stats: o.stats || [],
      markets: line ? [{ mid: line.mid, sport: line.sport, name: line.name, k: line.k }] : [] }, btn);
    try { window.flTrack?.('share', { kind: 'player' }) } catch (e) {}
  }
  function act(d, t) {
    const o = who; if (!o) return;
    if (d.pfact === 'follow') { const r = window.flTransfers?.follow?.(fKey(o)); if (r?.error) return window.flAdmin?.say?.(r.error); renderSheet(); window.flAdmin?.say?.(r?.on ? `Following ${o.name}. Their moves show on the Transfer window.` : `Stopped following ${o.name}.`); document.querySelector('[data-pfact="follow"]')?.focus(); return }
    if (d.pfact === 'compare') { leaveSheet(); return window.flLab?.compare?.({ sport: o.lab, name: o.name }) }
    if (d.pfact === 'board') return window.flBoards?.offer?.({ kind: 'player', key: `player:${o.lab}:${norm(o.name)}`, label: o.name, sub: [o.team, o.league].filter(Boolean).join(' · '), photo: o.photo || '', open: { lab: { sport: o.lab, name: o.name, kind: 'player' } } }, t);
    if (d.pfact === 'share') return shareCard(o, t);
    if (d.pfact === 'lab') { leaveSheet(); return window.flLab?.open?.({ sport: o.lab, name: o.name, kind: 'player' }) }
    if (d.pfprop != null) { const p = propsFor(o.lab, o.name)?.[+d.pfprop]; if (!p) return; leaveSheet(); return window.flLab?.open?.(window.flEdge.labArgs(p)) }
  }

  /* ---------- trends: the last ten games against the season, said in words ----------
     items: [{ label ('points'), season (number), recent (number), n (games) }] */
  function trends(items, o = {}) {
    const rows = (items || []).filter(x => x && isFinite(x.season) && isFinite(x.recent) && x.n >= 5 && x.season > 0).map(x => ({ ...x, d: (x.recent - x.season) / x.season }));
    const up = rows.filter(x => x.d >= .12).sort((a, b) => b.d - a.d), down = rows.filter(x => x.d <= -.12).sort((a, b) => a.d - b.d);
    const f = n => n >= 10 ? n.toFixed(1) : n.toFixed(1);
    const line = (x, w) => `<li class="pf-tr ${w}"><span class="pf-tr-k">${w === 'up' ? 'Up' : 'Down'}</span><span><b>${esc(x.label[0].toUpperCase() + x.label.slice(1))}: <span class="num">${f(x.recent)}</span> a game over the last ${x.n}</b><small>Season: <span class="num">${f(x.season)}</span></small></span></li>`;
    const list = [...up.slice(0, 3).map(x => line(x, 'up')), ...down.slice(0, 2).map(x => line(x, 'down'))];
    return `<section class="card pf-trends" aria-labelledby="pfTrH"><div class="sec-h"><h2 id="pfTrH">Trends</h2><span class="lb">Last ${rows[0]?.n || 10} games against the season</span></div>
      ${list.length ? `<ul class="pf-trl">${list.join('')}</ul>` : `<p class="lb">No big swings: the last ${rows[0]?.n || 10} games are close to ${esc(o.name ? o.name.split(' ').slice(-1)[0] + '’s' : 'the')} season averages.</p>`}</section>`;
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

  /* ---------- the six stat tiles (kept for pages that still ask; the header now carries the headline numbers) ---------- */
  function statTiles(rows, peers) {
    rows = (rows || []).filter(r => r && r.pc != null && isFinite(r.pc)).slice(0, 6); if (!rows.length) return '';
    return `<div class="pf-six">${rows.map(r => { const P = F().pct(r.pc, { low: r.low, peers });
      return `<article class="tile"><div class="pf-six-h"><span class="lb">${esc(r.label)}</span></div><b class="fig num">${esc(r.val)}</b><span class="trak" role="img" aria-label="${esc(P.aria || P.line)}"><i style="width:${Math.max(2, Math.min(100, r.pc))}%"></i></span>
      <small class="lb">${esc(F().rankLine(r.rank, r.n, r.pc))}</small></article>` }).join('')}</div>`;
  }

  /* ---------- career by season, with controls ----------
     sets: { avg: ESPN category (per game), tot: totals category, post: { avg, tot } playoffs when the source has them, misc }
     state on the view: v.car = { all, q, basis: 'avg' | 'tot', type: 'reg' | 'post', sort: [col, dir], pin } */
  const KEY_COLS = ['GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', '3P%', 'G', 'A', '+/-', 'SOG', 'W', 'GAA', 'SV%', 'YDS', 'TD', 'INT', 'REC', 'AVG', 'HR', 'RBI', 'OPS', 'ERA', 'SO', 'IP'];
  function careerTable(c, title, trendCol, o = {}) {
    const v = o.v || top(); if (!c?.statistics?.length) return '';
    return career(v, { avg: c, tot: o.tot, post: o.post, title, trendCol, misc: o.misc, note: o.note });
  }
  function career(v, sets) {
    const st = (v.car ||= { all: false, q: '', basis: 'avg', type: 'reg', sort: null, pin: '' });
    const pick = st.type === 'post' && sets.post ? sets.post : sets, cat = st.basis === 'tot' && pick.tot ? pick.tot : pick.avg;
    if (!cat?.statistics?.length) return '';
    const md = mode(), labels = cat.labels || [], hid = 'pfCarH-' + String(sets.title || 'career').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let cols = labels.map((l, i) => ({ l, i, d: cat.displayNames?.[i] || cat.descriptions?.[i] || '' }));
    if (md === 'summary') { const keep = cols.filter(c => KEY_COLS.includes(c.l)); if (keep.length >= 4) cols = keep }
    if (st.pin) { const p = cols.find(c => c.l === st.pin); if (p) cols = [p, ...cols.filter(c => c !== p)] }
    let rows = cat.statistics.map((s, k) => ({ s, k, season: s.season?.displayName || s.season?.year || '', team: (s.teamSlug || '').split('-').pop() || s.teamAbbr || '' })).reverse();
    const allN = rows.length, q = st.q.trim().toLowerCase();
    if (q) rows = rows.filter(r => `${r.season} ${r.team} ${(r.s.teamSlug || '').replace(/-/g, ' ')}`.toLowerCase().includes(q));
    if (st.sort) { const [col, dir] = st.sort, i = labels.indexOf(col);
      rows.sort((a, b) => { const x = col === 'Season' ? a.k : parseFloat(a.s.stats[i]), y = col === 'Season' ? b.k : parseFloat(b.s.stats[i]); return ((isNaN(x) ? -1e9 : x) - (isNaN(y) ? -1e9 : y)) * (dir === 'asc' ? 1 : -1) }) }
    const shown = st.all || q ? rows : rows.slice(0, 5);
    const ti = sets.trendCol ? labels.indexOf(sets.trendCol) : -1, max = ti < 0 ? 0 : Math.max(...cat.statistics.map(s => parseFloat(s.stats[ti]) || 0), 0);
    const sortBtn = (l, name) => { const on = st.sort?.[0] === l; return `<button type="button" class="pf-sort" data-pfcar="sort" data-col="${esc(l)}" aria-label="Sort by ${esc(name || l)}${on ? (st.sort[1] === 'asc' ? ', lowest first' : ', highest first') : ''}">${esc(l)}${on ? `<span aria-hidden="true">${st.sort[1] === 'asc' ? '▲' : '▼'}</span>` : ''}</button>` };
    const aria = l => st.sort?.[0] === l ? (st.sort[1] === 'asc' ? 'ascending' : 'descending') : 'none';
    const seg = (name, cur, opts) => `<div class="pf-seg" role="radiogroup" aria-label="${esc(name)}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" tabindex="${cur === k ? 0 : -1}" data-pfcar="${name === 'Numbers' ? 'basis' : 'type'}" data-to="${k}">${l}</button>`).join('')}</div>`;
    const bar = `<div class="pf-car-bar">
      <label class="pf-car-q"><span class="sr-only">Find a season or team</span><input class="inp sm" type="search" name="pf-season" autocomplete="off" placeholder="Find a season or team…" value="${esc(st.q)}" data-pfcar-q></label>
      ${sets.tot || sets.post?.tot ? seg('Numbers', st.basis, [['avg', 'Per game'], ['tot', 'Totals']]) : ''}
      ${sets.post?.avg?.statistics?.length ? seg('Season type', st.type, [['reg', 'Regular season'], ['post', 'Playoffs']]) : ''}
      <label class="pf-car-pin"><span>Pin</span><select class="inp sm" data-pfcar-pin aria-label="Keep a column beside the season"><option value="">No column</option>${labels.map(l => `<option${st.pin === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <button type="button" class="bt sm ghost" data-pfcar="csv">${ic('save', 16)}Export</button></div>`;
    const head = `<tr><th scope="col" class="pf-c0" aria-sort="${aria('Season')}">${sortBtn('Season', 'season')}</th>${cols.map((c, j) => `<th scope="col" class="r${st.pin && j === 0 ? ' pf-c1' : ''}" title="${esc(c.d)}" aria-sort="${aria(c.l)}">${sortBtn(c.l, c.d)}</th>`).join('')}${ti >= 0 ? `<th scope="col">${esc(sets.trendCol)} by season</th>` : ''}</tr>`;
    const body = shown.map(r => `<tr><th scope="row" class="pf-c0">${esc(r.season)} <small>${esc(r.team)}</small></th>${cols.map((c, j) => `<td class="r num${st.pin && j === 0 ? ' pf-c1' : ''}">${esc(r.s.stats[c.i] ?? '')}</td>`).join('')}${ti >= 0 ? `<td><span class="trak pf-trend" aria-hidden="true"><i style="width:${max ? Math.round((parseFloat(r.s.stats[ti]) || 0) / max * 100) : 0}%"></i></span></td>` : ''}</tr>`).join('');
    const tot = !q && (st.all || allN <= 5) && cat.totals?.length ? `<tr class="tot"><th scope="row" class="pf-c0">Career</th>${cols.map((c, j) => `<td class="r num${st.pin && j === 0 ? ' pf-c1' : ''}">${esc(cat.totals[c.i] ?? '')}</td>`).join('')}${ti >= 0 ? '<td></td>' : ''}</tr>` : '';
    // phones: one card per season with the key numbers, instead of a table that scrolls sideways
    const cardCols = cols.filter(c => KEY_COLS.includes(c.l)).slice(0, 6).length >= 3 ? cols.filter(c => KEY_COLS.includes(c.l)).slice(0, 6) : cols.slice(0, 6);
    const cards = `<ol class="pf-car-cards">${shown.map(r => `<li><b>${esc(r.season)} <small>${esc(r.team)}</small></b><dl>${cardCols.map(c => `<div><dt>${esc(c.l)}</dt><dd class="num">${esc(r.s.stats[c.i] ?? '')}</dd></div>`).join('')}</dl></li>`).join('')}</ol>`;
    const more = q ? `<p class="lb pf-car-n" role="status">${rows.length} of ${allN} seasons match “${esc(st.q)}”</p>`
      : allN > 5 ? `<button type="button" class="bt ghost wide pf-car-more" data-pfcar="all" aria-expanded="${st.all}">${st.all ? 'Show the last five seasons' : `View all ${allN} seasons`}</button>` : '';
    const title = `${sets.title || 'Career'}${st.type === 'post' ? ', playoffs' : ''}${st.basis === 'tot' && pick.tot ? ', totals' : ''}`;
    const miscT = md === 'advanced' && sets.misc?.statistics?.length ? `<section class="card pf-car pf-car-misc" aria-label="Miscellaneous"><div class="sec-h"><h2>Miscellaneous</h2><span class="lb">Advanced view</span></div><div class="tbx-wrap pf-car-wrap"><table class="tbx pf-career"><thead><tr><th scope="col" class="pf-c0">Season</th>${sets.misc.labels.map(x => `<th scope="col" class="r">${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${sets.misc.statistics.slice().reverse().map(s => `<tr><th scope="row" class="pf-c0">${esc(s.season?.displayName || '')} <small>${esc((s.teamSlug || '').split('-').pop())}</small></th>${s.stats.map(x => `<td class="r num">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>` : '';
    return `<section class="card pf-car" aria-labelledby="${hid}"><div class="sec-h"><h2 id="${hid}">${esc(title)}</h2><span class="lb">${st.all || q ? `${allN} seasons` : `Last ${Math.min(5, allN)} of ${allN} seasons`}${md === 'summary' && cols.length < labels.length ? ` · key columns (Standard shows all ${labels.length})` : ''}</span></div>
      ${bar}<div class="tbx-wrap pf-car-wrap" role="region" aria-labelledby="${hid}" tabindex="0"><table class="tbx pf-career${st.pin ? ' pinned' : ''}"><thead>${head}</thead><tbody>${body}${tot}</tbody></table></div>${cards}${more}
      ${sets.note ? `<p class="srcnote">${esc(sets.note)}</p>` : ''}</section>${miscT}`;
  }
  function carAct(v, t) {
    if (!v) return; const st = (v.car ||= { all: false, q: '', basis: 'avg', type: 'reg', sort: null, pin: '' }), k = t.dataset.pfcar, keep = sel => requestAnimationFrame(() => document.querySelector(sel)?.focus({ preventScroll: true }));
    if (k === 'all') { st.all = !st.all; renderSheet(); return keep('[data-pfcar="all"]') }
    if (k === 'basis' || k === 'type') { st[k] = t.dataset.to; renderSheet(); return keep(`[data-pfcar="${k}"][data-to="${t.dataset.to}"]`) }
    if (k === 'sort') { const c = t.dataset.col; st.sort = st.sort?.[0] === c ? (st.sort[1] === 'desc' ? [c, 'asc'] : null) : [c, c === 'Season' ? 'asc' : 'desc']; renderSheet(); return keep(`[data-pfcar="sort"][data-col="${CSS.escape(c)}"]`) }
    if (k === 'csv') return csv(t);
  }
  function csv(t) {
    const tb = t.closest('.pf-car')?.querySelector('table'); if (!tb) return;
    const cell = x => { const s = x.textContent.replace(/[▲▼]/g, '').trim(); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s };
    const text = [...tb.rows].map(r => [...r.cells].filter(c => !c.querySelector('.pf-trend') && !/by season$/.test(c.textContent)).map(cell).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `${(who?.name || 'player').replace(/[^\w]+/g, '-').toLowerCase()}-career.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    window.flAdmin?.say?.('Career table saved as a CSV file.');
  }
  let qT = 0;
  document.addEventListener('input', e => {
    if (!e.target.matches?.('[data-pfcar-q]')) return; const v = top(); if (!v) return;
    clearTimeout(qT); const val = e.target.value, pos = e.target.selectionStart;
    qT = setTimeout(() => { (v.car ||= { all: false, q: '', basis: 'avg', type: 'reg', sort: null, pin: '' }).q = val; renderSheet(); const i = document.querySelector('[data-pfcar-q]'); if (i) { i.focus({ preventScroll: true }); try { i.setSelectionRange(pos, pos) } catch (x) {} } }, 220);
  });
  document.addEventListener('change', e => {
    if (!e.target.matches?.('[data-pfcar-pin]')) return; const v = top(); if (!v) return;
    (v.car ||= { all: false, q: '', basis: 'avg', type: 'reg', sort: null, pin: '' }).pin = e.target.value; renderSheet(); document.querySelector('[data-pfcar-pin]')?.focus({ preventScroll: true });
  });
  // arrow keys move along a radio group (modes, per game / totals, regular season / playoffs)
  document.addEventListener('keydown', e => {
    const b = e.target.closest?.('.pf-mode [role=radio],.pf-seg [role=radio]'); if (!b || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    const all = [...b.parentElement.querySelectorAll('[role=radio]')], i = all.indexOf(b), n = all[(i + (/Right|Down/.test(e.key) ? 1 : -1) + all.length) % all.length];
    e.preventDefault(); n.click();
  });

  window.flProfile = { hero, shelf, awards, groups, statTiles, recent, espnSeries, careerTable, career, heatBadge, CATALOGUE, ord, mode, modeBar, trends, tabs, extra, changed, nextGame, who: () => who };
})();
