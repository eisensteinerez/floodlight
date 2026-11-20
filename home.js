/* Floodlight · Home, the Live Hub.
   One page for everything happening right now across every sport: a Live Now strip, today's biggest games,
   the next UFC and boxing nights with countdowns, the most confident predictions, today's standout players
   and the teams you follow. It reads the same public scoreboards the sport pages use and refreshes itself
   every 30 seconds while it is on screen. Clicking a game switches to its sport and opens it there. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = document.documentElement;
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  // every feed the hub reads: [sport, ESPN path, short name, league key on the sport page, weight for "biggest games"]
  const FEEDS = [
    ['soccer', 'soccer/all', 'Soccer', 'all', 6], ['football', 'football/nfl', 'NFL', 'nfl', 10], ['football', 'football/college-football', 'NCAAF', 'fbs', 7],
    ['basketball', 'basketball/nba', 'NBA', 'nba', 9], ['basketball', 'basketball/mens-college-basketball', 'NCAAB', 'cbb', 5],
    ['hockey', 'hockey/nhl', 'NHL', 'nhl', 7], ['baseball', 'baseball/mlb', 'MLB', 'mlb', 8],
    ['tennis', 'tennis/atp', 'ATP', 'all', 4], ['tennis', 'tennis/wta', 'WTA', 'all', 4], ['ufc', 'mma/ufc', 'UFC', null, 8],
  ];
  const SPORTS = [['all', 'All'], ['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC'], ['boxing', 'Boxing']];
  const TINT = { soccer: '#3DDC84', football: '#C9A15A', basketball: '#FF8A3D', baseball: '#FF5C6C', hockey: '#7CC8FF', tennis: '#D4F54A', ufc: '#E2263C', boxing: '#B3122E' };
  const H = { games: [], ufc: [], box: [], at: 0, loading: false, filter: 'all', err: 0, day: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })(), shown: '', live: 0 };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };

  /* ---------- the page itself ---------- */
  const sec = document.createElement('section'); sec.id = 'hub'; sec.className = 'hub'; sec.setAttribute('aria-label', 'Live Hub'); sec.hidden = true;
  document.querySelector('.shell')?.prepend(sec);

  const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  const j = url => timeout(fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }), 9000);
  const hex = c => c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c : null;
  const ml = o => { const n = parseFloat(o); if (!isFinite(n) || !n) return null; return n < 0 ? -n / (-n + 100) : 100 / (n + 100) };

  function norm(ev, f) {
    const [sport, path, short, lg, weight] = f;
    const comps = ev.competitions?.length ? ev.competitions : (ev.groupings || []).flatMap(g => g.competitions || []);
    if (sport === 'ufc') return [];   // UFC is shown by event, below
    return comps.slice(0, sport === 'tennis' ? 12 : 1).map(c => {
      const st = c.status?.type || ev.status?.type || {}, cs = c.competitors || [];
      const home = cs.find(x => x.homeAway === 'home') || cs[0] || {}, away = cs.find(x => x.homeAway === 'away') || cs[1] || {};
      const side = x => { const t = x.team || x.athlete || {}; return { id: String(t.id || x.id || ''), name: t.shortDisplayName || t.displayName || t.name || '', full: t.displayName || '', logo: t.logo || t.logos?.[0]?.href || t.headshot?.href || t.flag?.href || '',
        score: x.score?.displayValue ?? x.score ?? '', rank: x.curatedRank?.current && x.curatedRank.current <= 25 ? x.curatedRank.current : '', color: hex(t.color), record: x.records?.[0]?.summary || '', winner: !!x.winner, ml: null } };
      const us = !['soccer', 'tennis'].includes(sport), a = side(us ? away : home), b = side(us ? home : away);   // US scoreboards read away at home; soccer reads home first
      const odds = c.odds?.[0]; let draw = null;
      if (odds) { const hm = ml(odds.homeTeamOdds?.moneyLine ?? odds.moneyline?.home?.close?.odds), aw = ml(odds.awayTeamOdds?.moneyLine ?? odds.moneyline?.away?.close?.odds);
        (us ? a : b).ml = aw; (us ? b : a).ml = hm; draw = ml(odds.drawOdds?.moneyLine ?? odds.moneyline?.draw?.close?.odds) }
      // soccer scoreboards list each goal: who, when, and for which side
      const goals = (c.details || []).filter(x => x.scoringPlay).map(x => ({ t: String(x.team?.id || ''), who: x.athletesInvolved?.[0]?.shortName || x.athletesInvolved?.[0]?.displayName || '', min: x.clock?.displayValue || '', og: !!x.ownGoal, pen: !!x.penaltyKick })).filter(x => x.who);
      const leaders = (c.leaders || []).flatMap(cat => (cat.leaders || []).slice(0, 1).map(l => ({ cat: cat.displayName || cat.name, abbr: cat.abbreviation || '', val: +l.value || 0, show: l.displayValue, name: l.athlete?.displayName || l.athlete?.fullName, shot: l.athlete?.headshot?.href || l.athlete?.headshot || '', team: l.team?.id || l.athlete?.team?.id || '' })));
      return { key: `${sport}:${c.id || ev.id}`, sport, path, lg, short, league: ev.league?.abbreviation || c.league?.abbreviation || (sport === 'soccer' ? (ev.season?.slug || '') : short),
        lgName: sport === 'soccer' ? (c.competitionType?.text || '') : short, id: String(sport === 'tennis' ? c.id : ev.id), date: new Date(c.date || ev.date), state: st.state || 'pre',
        clock: st.shortDetail || st.detail || '', detail: st.shortDetail || st.detail || '', final: st.shortDetail || 'Final', a, b, weight, leaders,
        tv: c.broadcasts?.[0]?.names?.[0] || c.geoBroadcasts?.[0]?.media?.shortName || '', venue: c.venue?.fullName || ev.venue?.displayName || '', draw, goals, note: /postpon|cancel|delay/i.test(st.description || '') ? st.description : '' };
    });
  }
  function ufcNorm(ev) {
    const bouts = (ev.competitions || []).map(c => { const cs = c.competitors || []; const f = x => ({ name: x?.athlete?.displayName || '', photo: x?.athlete?.headshot?.href || '', rec: x?.records?.[0]?.summary || '', win: !!x?.winner });
      return { a: f(cs[0]), b: f(cs[1]), cls: c.type?.text || '', state: c.status?.type?.state || 'pre', detail: c.status?.type?.shortDetail || '', date: new Date(c.date || ev.date) } });
    const v = ev.competitions?.[0]?.venue || ev.venues?.[0] || {};
    const main = bouts[bouts.length - 1] || bouts[0];
    return { id: String(ev.id), name: ev.name || 'UFC', date: new Date(ev.date), state: bouts.some(b => b.state === 'in') ? 'in' : bouts.length && bouts.every(b => b.state === 'post') ? 'post' : 'pre',
      place: [v.fullName, v.address?.city, v.address?.country].filter(Boolean).join(' · '), main, bouts, live: bouts.find(b => b.state === 'in') };
  }

  async function load(force) {
    if (H.loading || (!force && Date.now() - H.at < 25000 && H.shown === ymd(H.day))) return;
    H.loading = true;
    const want = H.day, day = ymd(want), today = sameLocalDay(want);
    const jobs = FEEDS.map(f => j(`${ESPN}${f[1]}/scoreboard${f[0] === 'ufc' || (f[0] === 'tennis' && today) ? '' : `?dates=${day}`}${f[1].includes('college') ? (f[0] === 'basketball' ? '&groups=50' : '') : ''}`)
      .then(d => f[0] === 'ufc' ? (today && (H.ufc = (d.events || []).map(ufcNorm)), []) : (d.events || []).flatMap(ev => norm(ev, f))).catch(() => { H.err++; return [] }));
    if (today) jobs.push(j('/api/box/cards').then(d => { H.box = d.events || []; return [] }).catch(() => []));
    const all = (await Promise.all(jobs)).flat();
    H.loading = false;
    if (+want !== +H.day) return load(true);   // the day was changed while this one loaded
    // today: what is live, what starts today, and what finished in the last 12 hours. Another day: that day's games.
    const now = Date.now();
    H.games = today ? all.filter(g => g.state === 'in' || Math.abs(+g.date - now) < 20 * 36e5 && sameLocalDay(g.date) || (g.state === 'post' && now - g.date < 12 * 36e5))
      : all.filter(g => g.date.getFullYear() === want.getFullYear() && g.date.getMonth() === want.getMonth() && g.date.getDate() === want.getDate());
    H.at = Date.now(); H.shown = day;
    if (root.classList.contains('hub-on')) paint();
    if (today) { H.live = liveGames().length; document.dispatchEvent(new CustomEvent('fl:hub', { detail: { live: H.live } })) }
  }
  const sameLocalDay = d => { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() };
  const liveGames = () => H.games.filter(g => g.state === 'in');

  /* ---------- pieces ---------- */
  const facts = g => ({ id: g.key, hc: g.a.color || TINT[g.sport], ac: g.b.color || TINT[g.sport],
    label: `${g.a.full || g.a.name} ${g.state === 'pre' ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}, ${g.short}`, state: g.state, lg: g.lgName || g.short, tv: g.tv,
    a: { name: g.a.name, logo: g.a.logo, score: g.a.score, rank: g.a.rank, lose: g.state === 'post' && g.b.winner, win: g.a.winner }, b: { name: g.b.name, logo: g.b.logo, score: g.b.score, rank: g.b.rank, lose: g.state === 'post' && g.a.winner, win: g.b.winner },
    clock: g.clock, final: g.final, note: g.note, date: g.date });
  const hubAttr = g => `data-hub="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}"`;
  const card = g => window.flCard({ ...facts(g), attrs: hubAttr(g) });
  const ico = (k, s = 16) => (window.flShell?.ic ? window.flShell.ic(k, s) : '');
  const ini = n => esc((n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${ini(name)}</span></span>`;
  const hm = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isToday = () => sameLocalDay(H.day);
  const ago = d => { const m = Math.max(0, Math.round((Date.now() - d) / 60000)); return m < 60 ? `${m || 1} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago` };

  function countdown(ts) {
    const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
    const p = [[Math.floor(s / 86400), 'Days'], [Math.floor(s / 3600) % 24, 'Hrs'], [Math.floor(s / 60) % 60, 'Min'], [s % 60, 'Sec']];
    return `<div class="hm-cd" data-hubcd="${+ts}" aria-label="Starts ${new Date(ts).toLocaleString()}">${p.map(([n, l]) => `<span class="tile inset"><b class="fig num">${String(n).padStart(2, '0')}</b><small class="lb">${l}</small></span>`).join('')}</div>`;
  }

  /* the featured game: one of your teams first, then the biggest game in play, then the next big one to start */
  function featured(list) {
    const F = (window.S?.fav || []), names = new Set(F.map(f => (f.name || '').toLowerCase())), ids = new Set(F.flatMap(f => [String(f.tid || ''), String(f.id || '')]).filter(Boolean));
    const mine = g => [g.a, g.b].some(t => ids.has(t.id) || names.has((t.full || '').toLowerCase()) || names.has((t.name || '').toLowerCase()));
    const size = g => g.weight * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0) + (g.tv ? 4 : 0);
    const open = list.filter(g => g.state !== 'post'), live = open.filter(g => g.state === 'in'), pre = open.filter(g => g.state === 'pre');
    const soon = xs => [...xs].sort((a, b) => (size(b) - (b.date - Date.now()) / 36e5 * 3) - (size(a) - (a.date - Date.now()) / 36e5 * 3))[0];
    return live.filter(mine).sort((a, b) => size(b) - size(a))[0] || soon(pre.filter(mine)) || [...live].sort((a, b) => size(b) - size(a))[0] || soon(pre)
      || [...list].sort((a, b) => b.date - a.date || size(b) - size(a))[0] || null;
  }
  function featureHTML(g, list) {
    const f = facts(g), soccer = g.sport === 'soccer', pre = g.state === 'pre', live = g.state === 'in';
    // under each name: the latest goal for that side (soccer), or that side's leading player tonight
    const under = t => { const goal = soccer ? g.goals.filter(x => x.t === t.id).slice(-1)[0] : null, lead = !soccer ? g.leaders.find(l => String(l.team) === t.id) : null;
      return goal ? `<span class="ftr-g"><span>${esc(goal.who)} <b>${esc(goal.min)}</b>${goal.pen ? ' (pen)' : goal.og ? ' (og)' : ''}</span></span>`
        : lead && !pre ? `<span class="ftr-g"><span>${esc(lead.name)} <b>${esc(lead.show || lead.val)} ${esc(lead.abbr)}</b></span></span>`
        : soccer && live ? '<span class="ftr-g"><span>No goals yet</span></span>' : '' };
    f.a.under = under(g.a); f.b.under = under(g.b);
    // the chance bar: the books' prices, each turned into a chance and scaled so the three add to 100
    const pa = g.a.ml, pb = g.b.ml, pd = soccer ? g.draw : 0; let prob = '';
    if (pa && pb && (!soccer || pd)) { const t = pa + pb + (pd || 0), A = Math.round(pa / t * 100), D = pd ? Math.round(pd / t * 100) : 0, B = 100 - A - D;
      prob = `<span class="hm-prob" role="img" aria-label="Chance from the betting market: ${esc(g.a.name)} ${A}%${pd ? `, draw ${D}%` : ''}, ${esc(g.b.name)} ${B}%">
        <span class="hm-prob-l"><b>${esc(g.a.name)} ${A}%</b>${pd ? `<span>Draw ${D}%</span>` : '<span>Market chance</span>'}<b>${esc(g.b.name)} ${B}%</b></span>
        <span class="ftr-prob"><i style="flex:${A};background:var(--hc)"></i>${pd ? `<i class="d" style="flex:${D}"></i>` : ''}<i style="flex:${B};background:var(--ac)"></i></span></span>` }
    const liveN = list.filter(x => x.state === 'in').length;
    const acts = `<button type="button" class="ftr-foot" ${hubAttr(g)} data-hubtab="centre">${soccer ? 'Open match centre' : 'Open game'}${ico('arrow', 16)}</button>
      ${soccer && !pre ? `<button type="button" class="bt ghost ftr-alt" ${hubAttr(g)} data-hubtab="pitch">Pitch view</button>` : ''}
      <span class="hm-count num">${liveN ? `${liveN} live · ` : ''}${list.length} game${list.length === 1 ? '' : 's'} ${isToday() ? 'today' : 'this day'}</span>`;
    return window.flFeature({ ...f, as: 'article', cls: 'hm-ftr', label: (live ? 'Featured game, live. ' : 'Featured game. ') + f.label, venue: g.venue,
      below: (pre && g.date - Date.now() < 3 * 864e5 && g.date > Date.now() ? countdown(+g.date) : '') + prob, acts });
  }

  /* hot and cold: the Lab's heat reading for the players with lines posted today */
  const HEAT = { picks: null, at: 0, loading: false, denied: false, sports: '' };
  const LAB_SPORT = { basketball: 'nba', football: 'nfl', hockey: 'nhl', baseball: 'mlb', soccer: 'soccer' };
  function loadHeat() {
    if (!window.flEdge || HEAT.loading || Date.now() - HEAT.at < 5 * 60000) return;
    // the leagues playing today, biggest first; with no games at all, ask the two the books post most lines for
    const today = [...new Set(H.games.filter(g => ['nba', 'nfl', 'nhl', 'mlb'].includes(String(g.lg)) || g.sport === 'soccer').sort((a, b) => b.weight - a.weight).map(g => g.sport === 'soccer' ? 'soccer' : g.lg))].slice(0, 3);
    const sports = today.length ? today : H.at ? [] : null; if (!sports) return;
    HEAT.loading = true;
    window.flEdge.props(sports.length ? sports : ['nba', 'nfl']).then(r => { HEAT.picks = r.picks; HEAT.denied = r.denied; HEAT.at = Date.now() }).catch(() => { HEAT.picks = [] })
      .finally(() => { HEAT.loading = false; if (root.classList.contains('hub-on')) paint() });
  }
  const heatRow = p => `<button type="button" class="rw" data-hublab="${esc(JSON.stringify(window.flEdge.labArgs(p)))}">${face(p.photo, p.name)}<span class="rw-t"><b>${esc(p.name)}</b><small>${esc([p.team, p.label].filter(Boolean).join(' · '))}</small></span>${window.flHeat.badge(p.heat)}</button>`;
  function heatCard() {
    const E = window.flEdge, has = HEAT.picks && HEAT.picks.length;
    const hot = has ? E.hot(HEAT.picks, 3) : [], cold = has ? E.cold(HEAT.picks, 2) : [];
    const skl = n => '<div class="skl hm-skl"></div>'.repeat(n);
    const none = (t, d) => `<p class="hm-none"><b>${t}</b><span>${d}</span></p>`;
    return `<aside class="card hm-heat" aria-label="Hot and cold players"><div class="sec-h"><h2>Hot right now</h2><button type="button" class="lk" data-shell="lab">Open Lab</button></div>
      <div class="hm-rows">${HEAT.picks == null ? skl(3) : HEAT.denied ? none('The Lab is switched off for you', 'Ask your admin for Lab access to see who is running hot.')
        : hot.length ? hot.map(heatRow).join('') : none('Nobody is running hot', has ? 'No player with a line today reads 60 or more.' : 'The books have not posted player lines for today yet.')}</div>
      <div class="sec-h hm-ice"><h3>Ice cold</h3></div>
      <div class="hm-rows">${HEAT.picks == null ? skl(2) : HEAT.denied ? '' : cold.length ? cold.map(heatRow).join('') : none('Nobody is ice cold', has ? 'No player with a line today reads under 40.' : 'Check back when lines are posted.')}</div></aside>`;
  }

  /* the three cards: best edge, transfer wire, the Lab */
  function edgeCard() {
    const E = window.flEdge, top = HEAT.picks ? E.ranked(HEAT.picks)[0] : null, pc = x => Math.round(x * 100);
    const body = HEAT.picks == null ? '<div class="skl" style="height:150px"></div>'
      : HEAT.denied ? '<div class="emp"><b>Predictions are switched off for you</b><p>Ask your admin for access.</p></div>'
      : !top ? `<div class="emp">${ico('pred', 26)}<b>No priced picks yet</b><p>An edge needs a line with a price on both sides. None is posted for today’s games right now.</p></div>`
      : `<button type="button" class="hm-pick" data-hublab="${esc(JSON.stringify(E.labArgs(top)))}">${face(top.photo, top.name, 'avx av-lg')}<span class="rw-t"><b>${esc(top.name)}</b><small>${esc(top.text)}${top.game ? ' · ' + esc(top.game) : ''}</small></span></button>
        <div class="hm-nums"><span class="tile inset"><small class="lb">Our number</small><b class="fig num">${pc(top.ours)}%</b></span><span class="tile inset"><small class="lb">Market</small><b class="fig num">${pc(top.market)}%</b></span>
          <span class="tile inset"><small class="lb">Edge</small><b class="fig num hm-edge">${top.edge > 0 ? '+' : top.edge < 0 ? '−' : ''}${Math.abs(top.edge)}</b></span></div>`;
    return `<section class="card hm-c3" aria-label="Best edge tonight"><div class="sec-h"><h2>Best edge ${isNight() ? 'tonight' : 'today'}</h2>${top ? window.flHeat.badge(top.heat) : ''}</div>${body}
      <button type="button" class="bt wide" data-shell="pred">See all predictions${ico('arrow', 18)}</button></section>`;
  }
  const WIRE = { rows: null, at: 0, loading: false, denied: false };
  // the member's favorite sports decide which leagues feed the wire; with none chosen it reads every league that has a source
  const WIRE_LG = { basketball: ['nba'], football: ['nfl'], baseball: ['mlb'], soccer: ['soccer'], cbb: ['cbb'], cfb: ['cfb'] };
  function loadWire() {
    if (WIRE.loading || Date.now() - WIRE.at < 5 * 60000 || !window.flTransfers) return; WIRE.loading = true;
    const fav = (window.S?.me?.prefs?.favSports || []).flatMap(k => WIRE_LG[k] || []);
    window.flTransfers.latest(fav, 3).then(d => { WIRE.rows = d.rows; WIRE.denied = d.denied }).catch(() => { WIRE.rows = WIRE.rows || [] })
      .finally(() => { WIRE.loading = false; WIRE.at = Date.now(); if (root.classList.contains('hub-on')) paint() });
  }
  function wireCard() {
    const rows = WIRE.rows, day = d => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    const body = rows == null ? '<div class="skl hm-skl"></div>'.repeat(3)
      : !rows.length ? `<div class="emp">${ico('transfers', 26)}<b>${WIRE.denied ? 'Transfers are switched off for you' : 'No moves to show'}</b><p>${WIRE.denied ? 'Ask your admin for access.' : 'None of your leagues lists a move right now.'}</p></div>`
      : rows.map(t => `<div class="rw"><span class="hm-move" aria-hidden="true">${face(t.from?.logo, t.from?.short || t.from?.name || '–', 'avx av-sm')}${ico('arrow', 14)}${face(t.to?.logo, t.to?.short || t.to?.name || '–', 'avx av-sm')}</span>
          <span class="rw-t"><b>${esc(t.player?.name || t.lead?.name || '')}</b><small>${esc([t.league, [t.from?.short || t.from?.name, t.to?.short || t.to?.name].filter(Boolean).join(' to '), day(t.when)].filter(Boolean).join(' · '))}</small></span><span class="pl">${esc(t.label)}</span></div>`).join('');
    return `<section class="card hm-c3" aria-label="Transfer wire"><div class="sec-h"><h2>Transfer wire</h2><button type="button" class="lk" data-shell="transfers">All moves</button></div><div class="hm-rows">${body}</div></section>`;
  }
  function labCard() {
    const rec = (store.get('fl.labRecent', []) || []).slice(0, 3);
    return `<section class="card hm-c3" aria-label="The Lab"><div class="sec-h"><h2>${ico('lab', 22)} The Lab</h2></div><p class="hm-p">Every player, team and prop in one place.</p>
      <form class="hm-ask" data-hubask><label class="sr-only" for="hmAsk">Ask the Lab</label>${ico('search', 18)}<input class="inp" id="hmAsk" type="search" placeholder="A player, a team or a prop" autocomplete="off"></form>
      ${rec.length ? `<div class="cx-row" aria-label="Recent searches">${rec.map(r => `<button type="button" class="cx sm" data-hublab="${esc(JSON.stringify(r.args || { q: r.q }))}">${esc(r.label || r.q)}</button>`).join('')}</div>` : '<p class="lb">Your last three searches will sit here.</p>'}</section>`;
  }

  function fightTiles() {
    const ufc = H.ufc.find(e => e.state !== 'post') || H.ufc[0];
    const now = Date.now(), bxWhen = e => e.ts ? new Date(e.ts) : new Date(e.date + 'T20:00:00');
    const box = (H.box || []).filter(e => !e.postponed && (bxWhen(e) > now - 6 * 36e5) && e.status !== 'FT').sort((a, b) => bxWhen(a) - bxWhen(b))[0];
    const tile = (kind, k, title, a, b, when, place, live, id) => `<article class="card hm-fight"><div class="sec-h"><span class="lb">${ico(kind === 'ufc' ? 'ufc' : 'boxing')} ${k}</span>${live ? '<span class="pl live"><i></i>Live</span>' : ''}</div>
        <h3>${esc(title)}</h3><div class="hm-vs">${face(a.photo, a.name, 'avx av-lg')}<span><b>${esc(a.name || 'TBA')}</b><small class="lb">${esc(a.rec || '')}</small></span><i>v</i><span><b>${esc(b.name || 'TBA')}</b><small class="lb">${esc(b.rec || '')}</small></span>${face(b.photo, b.name, 'avx av-lg')}</div>
        ${when ? countdown(when) : ''}${place ? `<p class="lb">${esc(place)}</p>` : ''}<button type="button" class="bt ghost" data-hubgo="${kind}"${id ? ` data-hubid="${esc(id)}"` : ''}>Open ${kind === 'ufc' ? 'the card' : 'fight night'}</button></article>`;
    const out = [];
    if (ufc) { const m = ufc.live || ufc.main || {}; out.push(tile('ufc', 'Next UFC event', ufc.name, m.a || {}, m.b || {}, ufc.state === 'pre' ? +ufc.date : 0, ufc.place || ufc.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), ufc.state === 'in')) }
    if (box) out.push(tile('boxing', 'Next boxing night', box.series || box.name, { name: box.a }, { name: box.b }, +bxWhen(box), [box.venue, box.city].filter(Boolean).join(' · '), false, box.id));
    return out.join('');
  }
  function standouts(list) {
    const seen = new Set(), rows = [];
    for (const g of list.filter(g => g.state !== 'pre').sort((a, b) => b.weight - a.weight)) for (const l of g.leaders) {
      if (!l.name || seen.has(l.name)) continue;
      const rank = /point|goal/i.test(l.cat) ? 3 : /rating|passing|yards/i.test(l.cat) ? 2 : 1;
      seen.add(l.name); rows.push({ ...l, g, score: g.weight * 10 + rank * 5 + Math.min(l.val, 60) / 4 });
    }
    rows.sort((a, b) => b.score - a.score);
    if (!rows.length) return '';
    return `<section class="card" aria-label="Standout players"><div class="sec-h"><h2>Standout lines</h2><span class="lb">From ${isToday() ? 'today’s' : 'this day’s'} games</span></div><div class="hm-rows hm-two">${rows.slice(0, 6).map(r => `
      <button type="button" class="rw" ${hubAttr(r.g)}>${face(r.shot, r.name)}<span class="rw-t"><b>${esc(r.name)}</b><small>${esc(r.g.a.name)} v ${esc(r.g.b.name)}</small></span><span class="hm-val"><b class="num">${esc(r.show || r.val)}</b><small class="lb">${esc(r.abbr || r.cat)}</small></span></button>`).join('')}</div></section>`;
  }
  function favs(list) {
    const F = (window.S?.fav || []), names = new Set(F.map(f => (f.name || '').toLowerCase())), ids = new Set(F.flatMap(f => [String(f.tid || ''), String(f.id || '')]).filter(Boolean));
    if (!F.length) return '';
    const mine = list.filter(g => [g.a, g.b].some(t => ids.has(t.id) || names.has((t.full || '').toLowerCase()) || names.has((t.name || '').toLowerCase())));
    return `<section class="card" aria-label="Your teams"><div class="sec-h"><h2>Your teams</h2><span class="lb">${mine.length ? `${mine.length} playing ${isToday() ? 'today' : 'this day'}` : `None of them play ${isToday() ? 'today' : 'this day'}`}</span></div>
      <div class="cx-row">${F.slice(0, 12).map(f => `<span class="pl">${f.logo ? `<img class="hm-plimg" src="${esc(f.logo)}" alt="" loading="lazy">` : ''}${esc(f.name)}</span>`).join('')}</div>
      ${mine.length ? `<div class="g4 hm-cards">${mine.slice(0, 4).map(card).join('')}</div>` : ''}</section>`;
  }

  const isNight = () => new Date().getHours() >= 17;
  function days() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return `<div class="hm-days" role="group" aria-label="Choose a day">${[-3, -2, -1, 0, 1, 2, 3].map(o => { const d = new Date(t); d.setDate(t.getDate() + o); const on = +d === +H.day;
      return `<button type="button" class="hm-day${on ? ' on' : ''}" data-hubday="${o}" aria-pressed="${on}" aria-label="${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}${o ? '' : ', today'}"><span>${o ? d.toLocaleDateString([], { weekday: 'short' }) : 'Today'}</span><b class="num">${d.getDate()}</b></button>` }).join('')}</div>`;
  }

  function paint() {
    const list = H.games, live = list.filter(g => g.state === 'in'), today = isToday(), ready = H.at && H.shown === ymd(H.day);
    const ftr = ready ? featured(list) : null;
    // the row of four: games in play, or the next to start when nothing is live; never the featured one twice
    const size = g => g.weight * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0);
    const rest = list.filter(g => g !== ftr);
    const liveRow = rest.filter(g => g.state === 'in').sort((a, b) => size(b) - size(a));
    const nextRow = rest.filter(g => g.state === 'pre').sort((a, b) => a.date - b.date || size(b) - size(a));
    const doneRow = rest.filter(g => g.state === 'post').sort((a, b) => size(b) - size(a));
    const four = (liveRow.length ? liveRow : nextRow.length ? nextRow : doneRow).slice(0, 4);
    const rowTitle = liveRow.length ? 'Live now' : nextRow.length ? 'Up next' : 'Finished';
    const title = today ? (isNight() ? 'Tonight' : 'Today') : H.day.toLocaleDateString([], { weekday: 'long' });
    // a redraw every 30 seconds must not take the keyboard's place away
    const act = sec.contains(document.activeElement) ? document.activeElement : null, keepAsk = act?.id === 'hmAsk' ? act.value : null;
    const keep = act && !keepAsk ? ['data-hubday', 'data-hub', 'data-hublab', 'data-hubgo', 'data-shell'].map(a => act.hasAttribute(a) ? `[${a}="${CSS.escape(act.getAttribute(a))}"]${act.dataset.hubtab ? `[data-hubtab="${act.dataset.hubtab}"]` : ''}` : '').find(Boolean) : null;
    sec.innerHTML = `
      <header class="pg-head hm-head"><div><h1 class="pg-title">${title}</h1><p class="pg-sub">${H.day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>${days()}</header>
      <div class="g2 hm-top">
        ${!ready ? '<div class="skl hm-ftr-skl"></div>' : ftr ? featureHTML(ftr, list)
          : `<div class="card feature emp hm-empty">${ico('live', 30)}<b>No games ${today ? 'today' : 'on this day'}</b><p>${H.err && !list.length ? 'The scoreboards did not answer. This page tries again every 30 seconds.' : 'Pick another day above, or choose a sport to see its schedule.'}</p></div>`}
        ${heatCard()}
      </div>
      <section class="hm-live" aria-label="${rowTitle}"><div class="sec-h"><h2>${liveRow.length ? '<span class="dot-live" aria-hidden="true"></span> ' : ''}${rowTitle}</h2><button type="button" class="lk" data-shell="live">See all live${live.length ? ` (${live.length})` : ''}</button></div>
        ${!ready ? `<div class="g4 hm-cards">${'<div class="skl hm-card-skl"></div>'.repeat(4)}</div>` : four.length ? `<div class="g4 hm-cards">${four.map(card).join('')}</div>`
          : `<p class="hm-none"><b>Nothing else ${today ? 'today' : 'on this day'}</b><span>The featured game is the only one on the board.</span></p>`}</section>
      <div class="g3 hm-three">${edgeCard()}${wireCard()}${labCard()}</div>
      ${favs(list)}
      ${((f, st) => f && st ? `<div class="g2 hm-low">${st}<div class="vst">${f}</div></div>` : f ? `<div class="g3 hm-fights">${f}</div>` : st)(today ? fightTiles() : '', standouts(list))}`;
    if (keepAsk != null) { const a = $('hmAsk'); if (a) { a.value = keepAsk; a.focus() } } else if (keep) sec.querySelector(keep)?.focus({ preventScroll: true });
    { const dy = sec.querySelector('.hm-days'), on = dy?.querySelector('.on'); if (dy && on) dy.scrollLeft = on.offsetLeft - dy.offsetLeft - (dy.clientWidth - on.offsetWidth) / 2 }
    if (!sec.dataset.shown) { sec.dataset.shown = 1; sec.classList.add('hub-in'); setTimeout(() => sec.classList.remove('hub-in'), 900) }
    if (ready) { loadHeat(); loadWire() }
  }

  /* ---------- showing and leaving the hub ---------- */
  let poll = 0;
  let shownAt = 0;
  function show() {
    shownAt = Date.now(); root.classList.add('hub-on'); sec.hidden = false;
    window.S && S.stack?.length && typeof closeSheet === 'function' && closeSheet();
    paint(); load(); scrollTo({ top: 0 });
    clearInterval(poll); poll = setInterval(() => { if (!document.hidden && root.classList.contains('hub-on')) load(true) }, 30000);
    window.flShell?.sync?.();
  }
  function hide() { if (!root.classList.contains('hub-on')) return; root.classList.remove('hub-on'); sec.hidden = true; clearInterval(poll) }
  window.flHub = { show, hide, load, on: () => root.classList.contains('hub-on'), games: () => H.games, open: g => openGame(g.sport, g.lg, g.id), card, ufc: () => H.ufc, at: () => H.at,
    today() { if (!sameLocalDay(H.day)) { const d = new Date(); d.setHours(0, 0, 0, 0); H.day = d; H.games = []; return load(true) } return load() } };

  // Home opens the hub (capture phase, ahead of the older Home behaviour in shell.js)
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-shell="home"]'); if (!t) return;
    ev.stopPropagation(); document.getElementById('flSheet') && (document.getElementById('flSheet').hidden = true); show();
  }, true);
  // anything that navigates to a sport, a section or a profile leaves it
  document.addEventListener('click', ev => {
    if (ev.target.closest?.('#hub') || !ev.isTrusted && Date.now() - shownAt < 400) return;   // ignore the old Home behaviour's synthetic clicks
    if (ev.target.closest?.('button[data-sport],[data-shell]:not([data-shell="home"]):not([data-shell="sports"]),[data-rs],.rail button,#profileBtn,.ticker [data-ev],.ticker button')) hide();
  }, true);

  // inside the hub: filters, games, fight nights
  sec.addEventListener('click', ev => {
    const d = ev.target.closest('[data-hubday]');
    if (d) { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + +d.dataset.hubday); if (+t === +H.day) return; H.day = t; H.games = []; paint(); load(true);
      return setTimeout(() => sec.querySelector('.hm-day.on')?.focus(), 0) }
    const lab = ev.target.closest('[data-hublab]');
    if (lab) { let a = {}; try { a = JSON.parse(lab.dataset.hublab) } catch (e) {} return openLab(a) }
    const go = ev.target.closest('[data-hubgo]');
    if (go) return openFight(go.dataset.hubgo, go.dataset.hubid);
    const g = ev.target.closest('[data-hub]'); if (!g) return;
    const [sport, lg, id] = g.dataset.hub.split('|');
    openGame(sport, lg, id, g, g.dataset.hubtab);
  });
  sec.addEventListener('submit', ev => { if (!ev.target.matches('[data-hubask]')) return; ev.preventDefault(); const q = $('hmAsk').value.trim(); openLab(q ? { q } : {}) });
  // the Lab page takes it from here; before that page exists, fall back to the old research screen
  function openLab(args) { if (window.flLab?.open) return window.flLab.open(args); document.querySelector('[data-shell="lab"]')?.click() }

  const ATTR = { soccer: 'data-ev', basketball: 'data-bbgame', football: 'data-fbgame', hockey: 'data-hkgame', baseball: 'data-bsgame', tennis: 'data-tngame' };
  const STATE = { basketball: ['bb', 'fl.bbLg'], football: ['fb', 'fl.fbLg'], hockey: ['hk', 'fl.hkLg'], baseball: ['bsb', 'fl.bsbLg'], tennis: ['tn', null] };
  let opening = 0;
  function switchTo(sport) {
    hide();
    const b = document.querySelector(`.tbs[data-sport="${sport}"]`) || document.querySelector(`button[data-sport="${sport}"]`);
    if (window.S?.sport !== sport || !b) { if (b) b.click(); else if (typeof setSport === 'function') setSport(sport) }
  }
  async function openGame(sport, lg, id, btn, tab) {
    const seq = ++opening; btn?.classList.add('hub-opening');
    const st = STATE[sport];
    if (st && window.S?.[st[0]] && lg && 'lg' in S[st[0]]) { S[st[0]].lg = lg; if (st[1]) store.set(st[1], lg); if ('view' in S[st[0]]) S[st[0]].view = 'games' }
    switchTo(sport);
    if (sport === 'soccer' && typeof select === 'function') { if (tab && window.S) { S.tab = tab; S.tabForced = true } await select(id); return }
    // wait for the sport page to draw the game, then open it the same way a click on its card would
    for (let i = 0; i < 40 && seq === opening; i++) {
      const el = document.querySelector(`[${ATTR[sport]}="${CSS.escape(id)}"]`);
      if (el) { el.click(); return }
      await new Promise(r => setTimeout(r, 200));
    }
    if (seq === opening) toast('That game is on the ' + sport + ' page; it may be under another league or day.');
  }
  function openFight(kind, id) {
    if (kind === 'ufc') { switchTo('ufc'); if (typeof render === 'function') render(); return }
    if (window.S?.bx) { S.bx.tab = 'boxing'; store.set('fl.bxTab', 'boxing') }
    switchTo('boxing');
    if (typeof render === 'function') render();
    if (kind === 'boxing' && id) setTimeout(() => document.querySelector(`[data-bxfight="${CSS.escape(id)}"]`)?.click(), 600);
  }
  function toast(t) { const host = $('toasts'); if (!host) return; const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; host.appendChild(d); setTimeout(() => d.remove(), 4200) }

  // countdowns tick every second while the hub is on screen
  setInterval(() => {
    if (document.hidden || !root.classList.contains('hub-on')) return;
    sec.querySelectorAll('[data-hubcd]').forEach(el => { const s = Math.max(0, Math.floor((+el.dataset.hubcd - Date.now()) / 1000)), v = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
      el.querySelectorAll('b').forEach((b, i) => { const t = String(v[i]).padStart(2, '0'); if (b.textContent !== t) b.textContent = t }) });
  }, 1000);

  // the hub is the landing page, unless the address asks for something else
  load();
  if (!location.hash && !/[?&](sport|match|rs)=/.test(location.search) && store.get('fl.hubLanding', true)) show();
  else setInterval(() => { if (!document.hidden && !root.classList.contains('hub-on')) load() }, 120000);   // keeps the sidebar's live count right
})();
