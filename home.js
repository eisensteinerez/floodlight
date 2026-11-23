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
  const H = { games: [], ufc: [], box: [], at: 0, loading: false, filter: 'all', err: 0, day: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })(), shown: '', live: 0 };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };

  /* ---------- what makes Home yours ----------
     Favorite sports put those sports first. Followed teams and a watchlist of single games fill "Your games". Sections you
     do not want can be switched off. All of it is kept in this browser and, when you are logged in, with your account. */
  /* Home's sections, in the order a member wants them. Each can move up or down; most can be switched off. A key in
     `sw` is a switch: on unless it is listed in MY.off. */
  const MODS = [
    { k: 'brief', l: 'Tonight in 60 seconds', sw: [['brief', 'Show it']] },
    { k: 'mine', l: 'Your games', sw: [] },
    { k: 'top', l: 'Featured game', sw: [['hot', 'Hot and cold players beside it']] },
    { k: 'live', l: 'Live now and up next', sw: [['live', 'Show it']] },
    { k: 'back', l: 'Continue researching', sw: [['back', 'Show it']] },
    { k: 'three', l: 'Best edge, transfer wire and the Lab', sw: [['three', 'Show them']] },
    { k: 'low', l: 'Fight nights and standout lines', sw: [['fights', 'UFC and boxing nights'], ['standouts', 'Standout lines']] }];
  // the saved order, with any section added since slotted in where it sits by default
  function order() {
    const o = (MY.order || []).filter((k, i, a) => MODS.some(m => m.k === k) && a.indexOf(k) === i);
    MODS.forEach((m, i) => { if (o.includes(m.k)) return; const before = MODS.slice(0, i).reverse().find(x => o.includes(x.k)); o.splice(before ? o.indexOf(before.k) + 1 : 0, 0, m.k) });
    return o;
  }
  const customOrder = () => order().join() !== MODS.map(m => m.k).join();
  const MY = { sports: store.get('fl.favSports', []), off: store.get('fl.homeOff', []), order: store.get('fl.homeOrder', []), watch: store.get('fl.watch', []), recent: store.get('fl.recentGames', []), edit: false, skip: store.get('fl.homeSkip', false) };
  let myT = 0;
  function saveMine() {
    MY.watch = MY.watch.filter(w => Date.now() - (w.at || 0) < 4 * 864e5).slice(-40);   // a watched game drops off a few days after it was added
    store.set('fl.favSports', MY.sports); store.set('fl.homeOff', MY.off); store.set('fl.homeOrder', MY.order); store.set('fl.watch', MY.watch);
    try { if (window.S?.me && typeof api === 'function') { clearTimeout(myT); myT = setTimeout(() => api('/api/me/prefs', { favSports: MY.sports, homeOff: MY.off, homeOrder: MY.order, watch: MY.watch }).then(d => { if (d.user) S.me = d.user }).catch(() => {}), 500) } } catch (e) {}
  }
  document.addEventListener('fl:me', () => { const p = window.S?.me?.prefs; if (!p) return; let ch = false;
    if (Array.isArray(p.favSports) && p.favSports.length && !MY.sports.length) { MY.sports = p.favSports; ch = true }
    if (Array.isArray(p.homeOff) && p.homeOff.length && !MY.off.length) { MY.off = p.homeOff; ch = true }
    if (Array.isArray(p.homeOrder) && p.homeOrder.length && !MY.order.length) { MY.order = p.homeOrder; ch = true }
    if (Array.isArray(p.watch) && p.watch.length) { const have = new Set(MY.watch.map(w => w.key)), add = p.watch.filter(w => w && w.key && !have.has(w.key)); if (add.length) { MY.watch = [...MY.watch, ...add]; ch = true } }
    if (ch) { store.set('fl.favSports', MY.sports); store.set('fl.homeOff', MY.off); store.set('fl.homeOrder', MY.order); store.set('fl.watch', MY.watch) }
    if (root.classList.contains('hub-on')) paint() });
  const watching = key => MY.watch.some(w => w.key === key);
  function watch(g, on = !watching(g.key)) { MY.watch = MY.watch.filter(w => w.key !== g.key); if (on) MY.watch.push({ key: g.key, sport: g.sport, id: g.id, a: g.a?.name || '', b: g.b?.name || '', at: Date.now() }); saveMine(); if (root.classList.contains('hub-on')) paint(); return on }
  function seen(g) { MY.recent = [{ key: g.key, sport: g.sport, id: g.id, a: g.a?.name || '', b: g.b?.name || '', at: Date.now() }, ...MY.recent.filter(r => r.key !== g.key)].slice(0, 8); store.set('fl.recentGames', MY.recent) }
  const likes = g => MY.sports.includes(g.sport);
  const PRE = { football: 'fb', basketball: 'bb', hockey: 'hk', baseball: 'bs' };   // the ids the sport pages give a followed team
  const favId = (g, t) => PRE[g.sport] ? `${PRE[g.sport]}-${g.lg}-${t.id}` : t.id;
  const favList = () => { try { return S.fav || [] } catch (e) { return [] } };
  // a followed team matches by name, or by its id within its own sport (ids repeat across sports)
  const isMine = (g, F = favList()) => [g.a, g.b].some(t => F.some(f => { const n = (f.name || '').toLowerCase(); return (n && (n === (t.full || '').toLowerCase() || n === (t.name || '').toLowerCase())) || ((f.sport || 'soccer') === g.sport && [String(f.tid || ''), f.sport ? '' : String(f.id || '')].includes(t.id) && !!t.id) }));
  function follow(g, t) { try { const id = favId(g, t), has = S.fav.some(f => f.id === id || (f.tid && String(f.tid) === t.id && f.sport === g.sport));
      S.fav = has ? S.fav.filter(f => !(f.id === id || (f.tid && String(f.tid) === t.id && f.sport === g.sport))) : [...S.fav, PRE[g.sport] ? { id, tid: t.id, sport: g.sport, lg: g.lg, name: t.full || t.name, logo: t.logo || '' } : { id, name: t.full || t.name, logo: t.logo || '', lg: '' }];
      typeof savePrefs === 'function' && savePrefs() } catch (e) {} }

  /* ---------- the page itself ---------- */
  const sec = document.createElement('section'); sec.id = 'hub'; sec.className = 'hub'; sec.setAttribute('aria-label', 'Live Hub'); sec.hidden = true;
  document.querySelector('.shell')?.prepend(sec);
  document.addEventListener('fl:spoil', () => { if (root.classList.contains('hub-on')) paint() });

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
      const side = x => { const t = x.team || x.athlete || {}; return { id: String(t.id || x.id || ''), name: t.shortDisplayName || t.displayName || t.name || '', full: t.displayName || '', ab: t.abbreviation || '', logo: t.logo || t.logos?.[0]?.href || t.headshot?.href || t.flag?.href || '',
        score: x.score?.displayValue ?? x.score ?? '', rank: x.curatedRank?.current && x.curatedRank.current <= 25 ? x.curatedRank.current : '', color: hex(t.color), record: x.records?.[0]?.summary || '', winner: !!x.winner, ml: null } };
      const us = !['soccer', 'tennis'].includes(sport), a = side(us ? away : home), b = side(us ? home : away);   // US scoreboards read away at home; soccer reads home first
      const odds = c.odds?.[0]; let draw = null;
      if (odds) { const hm = ml(odds.homeTeamOdds?.moneyLine ?? odds.moneyline?.home?.close?.odds), aw = ml(odds.awayTeamOdds?.moneyLine ?? odds.moneyline?.away?.close?.odds);
        (us ? a : b).ml = aw; (us ? b : a).ml = hm; draw = ml(odds.drawOdds?.moneyLine ?? odds.moneyline?.draw?.close?.odds) }
      // soccer scoreboards list each goal: who, when, and for which side
      const goals = (c.details || []).filter(x => x.scoringPlay).map(x => ({ t: String(x.team?.id || ''), who: x.athletesInvolved?.[0]?.shortName || x.athletesInvolved?.[0]?.displayName || '', min: x.clock?.displayValue || '', og: !!x.ownGoal, pen: !!x.penaltyKick })).filter(x => x.who);
      // game leaders, each tied to a team: a team's own list (where the feed gives one) names the team for certain; the game-wide list
      // carries a team id per player. A leader whose team is neither side is dropped rather than shown under the wrong game.
      const lead1 = (cat, tid) => (cat.leaders || []).slice(0, 1).map(l => ({ cat: cat.displayName || cat.name, abbr: cat.abbreviation || '', val: +l.value || 0, show: l.displayValue, name: l.athlete?.displayName || l.athlete?.fullName, shot: l.athlete?.headshot?.href || l.athlete?.headshot || '', team: String(tid || l.team?.id || l.athlete?.team?.id || '') }));
      const ids = [a.id, b.id].map(String);
      let leaders = (c.leaders || []).flatMap(cat => lead1(cat));
      if (!leaders.length) leaders = cs.flatMap(x => (x.leaders || []).flatMap(cat => lead1(cat, x.team?.id || x.id)));
      leaders = leaders.filter(l => !l.team || ids.includes(l.team));
      return { key: `${sport}:${c.id || ev.id}`, sport, path, lg, short, league: ev.league?.abbreviation || c.league?.abbreviation || (sport === 'soccer' ? (ev.season?.slug || '') : short),
        lgName: sport === 'soccer' ? (c.competitionType?.text || '') : short, id: String(sport === 'tennis' ? c.id : ev.id), date: new Date(c.date || ev.date), state: st.state || 'pre',
        clock: st.shortDetail || st.detail || '', detail: st.shortDetail || st.detail || '', final: st.shortDetail || 'Final', a, b, weight, leaders,
        sit: c.situation ? { text: c.situation.downDistanceText || c.situation.shortDownDistanceText || '', poss: String(c.situation.possession || ''), red: !!c.situation.isRedZone, last: c.situation.lastPlay?.text || '' } : null,
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

  const noLive = () => !!window.flAccess && !window.flAccess.has('live');
  async function load(force) {
    if (noLive()) { H.games = []; H.ufc = []; H.box = []; H.at = Date.now(); H.shown = ymd(H.day); return paint() }   // live scores are switched off for this member
    if (H.loading || (!force && Date.now() - H.at < 25000 && H.shown === ymd(H.day))) return;
    H.loading = true; H.err = 0;
    const want = H.day, day = ymd(want), today = sameLocalDay(want);
    const jobs = FEEDS.map(f => j(`${ESPN}${f[1]}/scoreboard${f[0] === 'ufc' || (f[0] === 'tennis' && today) ? '' : `?dates=${day}`}${f[1].includes('college') ? (f[0] === 'basketball' ? '&groups=50' : '') : ''}`)
      .then(d => f[0] === 'ufc' ? (today && (H.ufc = (d.events || []).map(ufcNorm)), []) : (d.events || []).flatMap(ev => norm(ev, f))).catch(() => { H.err++; return [] }));
    if (today) jobs.push(j('/api/box/cards').then(d => { H.box = d.events || []; return [] }).catch(() => []));
    const all = (await Promise.all(jobs)).flat();
    H.down = H.err >= Math.ceil(FEEDS.length / 2);   // most scoreboards failed: say so instead of "no games"
    H.loading = false;
    if (+want !== +H.day) return load(true);   // the day was changed while this one loaded
    // today: what is live, what starts today, and what finished in the last 12 hours. Another day: that day's games.
    const now = Date.now();
    H.games = today ? all.filter(g => g.state === 'in' || Math.abs(+g.date - now) < 20 * 36e5 && sameLocalDay(g.date) || (g.state === 'post' && now - g.date < 12 * 36e5))
      : all.filter(g => g.date.getFullYear() === want.getFullYear() && g.date.getMonth() === want.getMonth() && g.date.getDate() === want.getDate());
    H.at = Date.now(); H.shown = day;
    if (root.classList.contains('hub-on')) paint();
    if (today) { H.live = liveGames().length; document.dispatchEvent(new CustomEvent('fl:hub', { detail: { live: H.live } })) }
    else document.dispatchEvent(new Event('fl:hubday'));   // another day's board (Live reads it)
  }
  const sameLocalDay = d => { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() };
  const liveGames = () => H.games.filter(g => g.state === 'in');

  /* ---------- pieces ---------- */
  const facts = g => ({ id: g.key, hc: g.a.color || '', ac: g.b.color || '',   // no colour in the feed: the card falls back to the theme's own pair
    label: `${g.a.full || g.a.name} ${g.state === 'pre' ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}, ${g.short}`, state: g.state, lg: g.lgName || g.short, tv: g.tv,
    a: { name: g.a.name, ab: g.a.ab, logo: g.a.logo, score: g.a.score, rank: g.a.rank, lose: g.state === 'post' && g.b.winner, win: g.a.winner }, b: { name: g.b.name, ab: g.b.ab, logo: g.b.logo, score: g.b.score, rank: g.b.rank, lose: g.state === 'post' && g.a.winner, win: g.b.winner },
    clock: g.clock, final: g.final, note: g.note, date: g.date });
  const noSpoil = f => { if (f.state === 'pre' || !window.flMC?.spoil(f.id)) return f; f.spoil = true; f.label = f.label.replace(/ \S+ to \S+ /, ' v ') + ', score hidden'; for (const t of [f.a, f.b]) { t.lose = false; t.win = false } return f };
  const hubAttr = g => `data-hub="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}"`;
  const card = g => window.flCard({ ...noSpoil(facts(g)), attrs: hubAttr(g) });
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
    const mine = g => isMine(g);
    const size = g => g.weight * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0) + (g.tv ? 4 : 0) + (likes(g) ? 40 : 0) + (watching(g.key) ? 60 : 0);
    const open = list.filter(g => g.state !== 'post'), live = open.filter(g => g.state === 'in'), pre = open.filter(g => g.state === 'pre');
    const soon = xs => [...xs].sort((a, b) => (size(b) - (b.date - Date.now()) / 36e5 * 3) - (size(a) - (a.date - Date.now()) / 36e5 * 3))[0];
    return live.filter(mine).sort((a, b) => size(b) - size(a))[0] || soon(pre.filter(mine)) || [...live].sort((a, b) => size(b) - size(a))[0] || soon(pre)
      || [...list].sort((a, b) => b.date - a.date || size(b) - size(a))[0] || null;
  }
  /* The featured game doesn't jump away when it reaches half time or ends: a live game stays featured until it is
     over, and a finished one stays for 20 minutes with its final score and the next game to watch. A game of your
     own team starting still takes the spot. */
  function stickyFeature(list) {
    const pick = featured(list), prev = H.ftrKey && isToday() ? list.find(g => g.key === H.ftrKey) : null, mineNow = pick && (isMine(pick) || watching(pick.key));
    if (prev && pick && prev !== pick && !(mineNow && !isMine(prev) && !watching(prev.key))) {
      if (prev.state === 'in') return prev;
      if (prev.state === 'post') { H.ftrEnd = H.ftrEnd || Date.now(); if (Date.now() - H.ftrEnd < 20 * 60000) return prev }
    }
    if (pick?.key !== H.ftrKey) { H.ftrKey = pick?.key || ''; H.ftrEnd = pick?.state === 'post' ? Date.now() : 0 }
    return pick;
  }
  function featureHTML(g, list) {
    const f = noSpoil(facts(g)), soccer = g.sport === 'soccer', pre = g.state === 'pre', live = g.state === 'in';
    // under each name: the latest goal for that side (soccer), or that side's leading player tonight
    const under = t => { const goal = soccer ? g.goals.filter(x => x.t === t.id).slice(-1)[0] : null, lead = !soccer ? g.leaders.find(l => String(l.team) === t.id) : null;
      return goal ? `<span class="ftr-g"><span>${esc(goal.who)} <b>${esc(goal.min)}</b>${goal.pen ? ' (pen)' : goal.og ? ' (og)' : ''}</span></span>`
        : lead && !pre ? `<span class="ftr-g"><span>${esc(lead.name)} <b>${esc(lead.show || lead.val)}${/[a-z]/i.test(String(lead.show || '')) ? '' : ' ' + esc(lead.abbr)}</b></span></span>`
        : soccer && live ? '<span class="ftr-g"><span>No goals yet</span></span>' : '' };
    if (!f.spoil) { f.a.under = under(g.a); f.b.under = under(g.b) }
    // the chance bar: the books' prices, each turned into a chance and scaled so the three add to 100
    const pa = g.a.ml, pb = g.b.ml, pd = soccer ? g.draw : 0; let prob = '';
    if (pa && pb && (!soccer || pd) && !f.spoil) { const t = pa + pb + (pd || 0), A = Math.round(pa / t * 100), D = pd ? Math.round(pd / t * 100) : 0, B = 100 - A - D;
      prob = `<span class="hm-prob" role="img" aria-label="Chance from the betting market: ${esc(g.a.name)} ${A}%${pd ? `, draw ${D}%` : ''}, ${esc(g.b.name)} ${B}%">
        <span class="hm-prob-l"><b>${esc(g.a.name)} ${A}%</b>${pd ? `<span>Draw ${D}%</span>` : '<span>Market chance</span>'}<b>${esc(g.b.name)} ${B}%</b></span>
        <span class="ftr-prob"><i style="flex:${A};background:var(--hc)"></i>${pd ? `<i class="d" style="flex:${D}"></i>` : ''}<i style="flex:${B};background:var(--ac)"></i></span></span>` }
    const liveN = list.filter(x => x.state === 'in').length;
    // finished and still featured: what to watch next
    const next = g.state === 'post' && isToday() ? featured(list.filter(x => x !== g && x.state !== 'post')) : null;
    const after = next ? `<p class="hm-next">${ico('clock', 16)}<span>${f.spoil ? 'This game is over.' : soccer ? 'Full time.' : 'Final.'} Next: <button type="button" class="lk" ${hubAttr(next)}>${esc(next.a.name)} v ${esc(next.b.name)}</button>${next.state === 'in' ? ', live now' : `, ${hm(next.date)}`}</span></p>` : '';
    const acts = `<button type="button" class="ftr-foot" ${hubAttr(g)} data-hubtab="centre">${soccer ? 'Open match centre' : 'Open game'}${ico('arrow', 16)}</button>
      ${soccer && !pre ? `<button type="button" class="bt ghost ftr-alt" ${hubAttr(g)} data-hubtab="pitch">Pitch view</button>` : ''}
      <span class="hm-count num">${liveN ? `${liveN} live · ` : ''}${list.length} game${list.length === 1 ? '' : 's'} ${isToday() ? 'today' : 'this day'}</span>`;
    return window.flFeature({ ...f, as: 'article', cls: 'hm-ftr', label: (live ? 'Featured game, live. ' : 'Featured game. ') + f.label, venue: g.venue,
      below: (pre && g.date - Date.now() < 3 * 864e5 && g.date > Date.now() ? countdown(+g.date) : '') + prob + after, acts });
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
    window.flEdge.props(sports.length ? sports : ['nba', 'nfl']).then(r => { HEAT.picks = r.picks; HEAT.denied = r.denied; HEAT.at = Date.now()
      // every board failed and none was kept from an earlier visit: say so, don't call it an empty day
      HEAT.failed = !r.picks.length && Object.values(r.by || {}).length > 0 && Object.values(r.by).every(x => !x.picks?.length && (x.error || Object.keys(x.errors || {}).length) && x.status !== 401 && x.status !== 403) }).catch(() => { HEAT.picks = []; HEAT.failed = true; HEAT.at = Date.now() })
      .finally(() => { HEAT.loading = false; if (root.classList.contains('hub-on')) paint() });
  }
  // the states every Home module goes through: loading (with words, not only grey bars), failed (with a retry),
  // finished (today's games are over: point at tomorrow), and empty (nothing to show, said plainly)
  const loadingRows = (n, what) => `<div class="hm-load" role="status" aria-live="polite"><span class="sr-only">${what}</span>${'<div class="skl hm-skl" aria-hidden="true"></div>'.repeat(n)}</div>`;
  const state = (icon, t, d, btn = '') => `<div class="hm-state">${icon ? ico(icon, 20) : ''}<p><b>${t}</b><span>${d}</span></p>${btn}</div>`;
  const retry = what => `<button type="button" class="bt ghost sm" data-hubretry="${what}">Try again</button>`;
  const tomorrow = `<button type="button" class="bt ghost sm" data-hubday="1">See tomorrow</button>`;
  // today's lines are done once every pick's game has started
  const linesOver = () => isToday() && HEAT.picks?.length > 0 && HEAT.picks.every(p => p.start && p.start < Date.now());
  const heatRow = p => `<button type="button" class="rw" data-hublab="${esc(JSON.stringify(window.flEdge.labArgs(p)))}">${face(p.photo, p.name)}<span class="rw-t"><b>${esc(p.name)}</b><small>${esc([p.team, p.label].filter(Boolean).join(' · '))}</small></span>${window.flHeat.badge(p.heat)}</button>`;
  function heatCard() {
    const E = window.flEdge, has = HEAT.picks && HEAT.picks.length;
    const hot = has ? E.hot(HEAT.picks, 3) : [], cold = has ? E.cold(HEAT.picks, 2) : [];
    const head = `<div class="sec-h"><h2>Hot right now</h2><button type="button" class="lk" data-shell="lab">Open Lab</button></div>`;
    // one message for the whole card when there is nothing to split into hot and cold
    const whole = HEAT.picks == null ? loadingRows(4, 'Reading today’s player lines…')
      : HEAT.denied ? state('lab', 'The Lab is switched off for you', 'Ask your admin for Lab access to see who is running hot.')
      : HEAT.failed ? state('', 'Today’s player lines didn’t load', 'The pick’em apps didn’t answer. Nothing is wrong with your account.', retry('heat'))
      : !has ? state('', 'No player lines yet', isToday() ? 'The apps usually post lines in the morning. This fills in by itself.' : 'Lines are posted on the day of the games.')
      : linesOver() ? state('', 'Today’s lines are closed', 'Every game with a line has started. Tomorrow’s lines go up in the morning.', tomorrow) : '';
    if (whole) return `<aside class="card hm-heat" aria-label="Hot and cold players">${head}${whole}</aside>`;
    const none = (t, d) => `<p class="hm-none"><b>${t}</b><span>${d}</span></p>`;
    return `<aside class="card hm-heat" aria-label="Hot and cold players">${head}
      <div class="hm-rows">${hot.length ? hot.map(heatRow).join('') : none('Nobody is running hot', 'No player with a line today reads 60 or more.')}</div>
      <div class="sec-h hm-ice"><h3>Ice cold</h3></div>
      <div class="hm-rows">${cold.length ? cold.map(heatRow).join('') : none('Nobody is ice cold', 'No player with a line today reads under 40.')}</div></aside>`;
  }

  /* the three cards: best edge, transfer wire, the Lab */
  function edgeCard() {
    const E = window.flEdge, pc = x => Math.round(x * 100), open = (HEAT.picks || []).filter(p => !p.start || p.start > Date.now()), top = HEAT.picks ? E.ranked(open)[0] : null;
    const body = HEAT.picks == null ? loadingRows(3, 'Finding the best edge…')
      : HEAT.denied ? state('pred', 'Predictions are switched off for you', 'Ask your admin for access.')
      : HEAT.failed ? state('pred', 'Prices didn’t load', 'The apps didn’t answer, so there is no edge to show yet.', retry('heat'))
      : linesOver() ? state('pred', 'Today’s picks have started', 'Every priced pick is in play. See how they are doing on Predictions, or look at tomorrow.', tomorrow)
      : !top ? state('pred', 'No priced picks yet', 'An edge needs a line with a price on both sides. None is posted for today’s games right now.')
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
    window.flTransfers.latest(fav, 3).then(d => { WIRE.rows = d.rows; WIRE.denied = d.denied; WIRE.failed = d.failed && !d.rows.length }).catch(() => { WIRE.rows = WIRE.rows || []; WIRE.failed = !WIRE.rows.length })
      .finally(() => { WIRE.loading = false; WIRE.at = Date.now(); if (root.classList.contains('hub-on')) paint() });
  }
  function wireCard() {
    const rows = WIRE.rows, day = d => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    const body = rows == null ? loadingRows(3, 'Loading the latest moves…')
      : WIRE.denied ? state('transfers', 'Transfers are switched off for you', 'Ask your admin for access.')
      : WIRE.failed ? state('transfers', 'The moves didn’t load', 'The league lists didn’t answer.', retry('wire'))
      : !rows.length ? state('transfers', 'No moves this week', 'None of your leagues has listed a trade or signing lately.')
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
    for (const g of list.filter(g => g.state !== 'pre' && !window.flMC?.spoil(g.key)).sort((a, b) => b.weight - a.weight)) for (const l of g.leaders) {
      if (!l.name || seen.has(l.name)) continue;
      const rank = /point|goal/i.test(l.cat) ? 3 : /rating|passing|yards/i.test(l.cat) ? 2 : 1;
      seen.add(l.name); rows.push({ ...l, g, score: g.weight * 10 + rank * 5 + Math.min(l.val, 60) / 4 });
    }
    rows.sort((a, b) => b.score - a.score);
    if (!rows.length) { const started = list.some(g => g.state !== 'pre');
      return list.length ? `<section class="card hm-thin" aria-label="Standout lines"><div class="sec-h"><h2>Standout lines</h2></div>${state('', started ? 'No standout lines to show' : 'Standout lines start with the first game', started ? 'The games in play have no player numbers yet, or their scores are hidden.' : `The first game ${isToday() ? 'today' : 'that day'} starts at ${hm([...list].sort((a, b) => a.date - b.date)[0].date)}.`)}</section>` : '' }
    return `<section class="card" aria-label="Standout players"><div class="sec-h"><h2>Standout lines</h2><span class="lb">From ${isToday() ? 'today’s' : 'this day’s'} games</span></div><div class="hm-rows hm-two">${rows.slice(0, 6).map(r => `
      <button type="button" class="rw" ${hubAttr(r.g)}>${face(r.shot, r.name)}<span class="rw-t"><b>${esc(r.name)}</b><small>${esc((t => t ? `${t.name} v ${(t === r.g.a ? r.g.b : r.g.a).name}` : `${r.g.a.name} v ${r.g.b.name}`)([r.g.a, r.g.b].find(t => r.team && t.id === r.team)))}</small></span><span class="hm-val"><b class="num">${esc(r.show || r.val)}</b><small class="lb">${esc(r.abbr || r.cat)}</small></span></button>`).join('')}</div></section>`;
  }
  /* Your games: followed teams and watched games, live first. With nothing chosen yet, an invitation to choose. */
  function mine(list) {
    const F = favList(), has = F.length || MY.sports.length || MY.watch.length;
    if (MY.edit) return editor(list);
    if (!has) return MY.skip ? '' : `<section class="card hm-mine hm-invite" aria-label="Make Home yours"><div class="rw-t"><h2>Make Home yours</h2><p>Tap the sports you follow. Your games then sit at the top of Home and your sports come ahead of the rest.</p>
        <div class="cx-row hm-quick" role="group" aria-label="Your sports">${SPORTS.filter(x => !['all', 'boxing', 'ufc'].includes(x[0])).map(([k, l]) => `<button type="button" class="cx" aria-pressed="false" data-hubsport="${k}">${esc(l)}</button>`).join('')}</div></div>
      <div class="hm-inv-acts"><button type="button" class="bt" data-hubmy="edit">Choose teams too</button><button type="button" class="bt ghost" data-hubmy="skip">Not now</button></div></section>`;
    const rank = g => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2), games = list.filter(g => isMine(g, F) || watching(g.key)).sort((a, b) => rank(a) - rank(b) || a.date - b.date);
    const live = games.filter(g => g.state === 'in').length, gone = MY.watch.filter(w => !list.some(g => g.key === w.key)).length;
    const sub = games.length ? `${games.length} ${isToday() ? 'today' : 'this day'}${live ? ` · ${live} live` : ''}` : F.length || MY.watch.length ? `None of your teams play ${isToday() ? 'today' : 'this day'}` : 'No teams followed yet';
    // nothing of yours on the board: say what to do next, right here
    const empty = games.length ? '' : F.length || MY.watch.length ? `<div class="hm-state">${ico('clock', 20)}<p><b>None of your teams play ${isToday() ? 'today' : 'this day'}</b><span>Look at another day, or follow more teams.</span></p><button type="button" class="bt ghost sm" data-hubday="1">Tomorrow</button><button type="button" class="bt ghost sm" data-hubmy="edit">Follow teams</button></div>`
      : `<div class="hm-state">${ico('star', 20)}<p><b>Follow a team to fill this row</b><span>Your sports are set. Pick teams from today’s games, or from any team’s page.</span></p><button type="button" class="bt sm" data-hubmy="edit">Choose teams</button></div>`;
    const tag = g => watching(g.key) && !isMine(g, F) ? '<span class="pl hm-wtag">Watching</span>' : '';
    return `<section class="card hm-mine" aria-label="Your games"><div class="sec-h"><h2>Your games</h2><span class="lb">${sub}</span><button type="button" class="lk" data-hubmy="edit">Edit your Home</button></div>
      ${games.length ? `<div class="g4 hm-cards">${games.slice(0, 8).map(g => window.flCard({ ...noSpoil(facts(g)), attrs: hubAttr(g), extra: tag(g) })).join('')}</div>` : empty}
      ${F.length || MY.sports.length ? `<div class="cx-row hm-chips" aria-label="What you follow">${MY.sports.map(k => `<span class="pl solid">${esc((SPORTS.find(x => x[0] === k) || [k, k])[1])}</span>`).join('')}${F.slice(0, 14).map(f => `<span class="pl">${f.logo ? `<img class="hm-plimg" src="${esc(f.logo)}" alt="" loading="lazy">` : ''}${esc(f.name)}</span>`).join('')}${F.length > 14 ? `<span class="pl">+${F.length - 14} more</span>` : ''}</div>` : ''}
      ${gone && !games.length ? `<p class="lb">${gone} watched ${gone === 1 ? 'game is' : 'games are'} on another day.</p>` : ''}</section>`;
  }
  /* Continue researching: the games and Lab searches you opened last, so a return visit starts where the last one ended. */
  function back(list) {
    if (MY.off.includes('back')) return '';
    const F = favList(), inMine = g => isMine(g, F) || watching(g.key);
    const games = MY.recent.map(r => list.find(g => g.key === r.key)).filter(g => g && !inMine(g)).slice(0, 4);
    const lab = (store.get('fl.labRecent', []) || []).slice(0, 4);
    if (!games.length && !lab.length) return '';
    const st = g => g.state === 'in' ? '<span class="pl live"><i></i>Live</span>' : g.state === 'pre' ? `<small class="lb">${esc(hm(g.date))}</small>` : '<small class="lb">Final</small>';
    return `<section class="card hm-back" aria-labelledby="hmBackH"><div class="sec-h"><h2 id="hmBackH">Continue researching</h2><span class="lb">What you opened last</span></div>
      <div class="hm-back-g">${games.length ? `<div><h3 class="lb">Games</h3><ul class="hm-bl">${games.map(g => `<li><button type="button" class="hm-bi" ${hubAttr(g)}><span>${esc(g.a.name)} v ${esc(g.b.name)}</span>${st(g)}</button></li>`).join('')}</ul></div>` : ''}
        ${lab.length ? `<div><h3 class="lb">In the Lab</h3><ul class="hm-bl">${lab.map(r => `<li><button type="button" class="hm-bi" data-hublab="${esc(JSON.stringify(r.args || { q: r.q }))}">${ico('lab', 16)}<span>${esc(r.label || r.q)}</span></button></li>`).join('')}</ul></div>` : ''}</div></section>`;
  }
  /* Tonight in 60 seconds: the board in four lines. Each line is read from the games on Home and opens what it names.
     A game whose score you have hidden is never described by its score. */
  function brief(list, ftr) {
    if (MY.off.includes('brief') || !list.length) return '';
    const F = favList(), hid = g => g.state !== 'pre' && window.flMC?.spoil?.(g.key), out = [];
    const nm = g => `${g.a.name} v ${g.b.name}`, gap = g => Math.abs((+g.a.score || 0) - (+g.b.score || 0));
    const live = list.filter(g => g.state === 'in'), pre = list.filter(g => g.state === 'pre'), post = list.filter(g => g.state === 'post');
    const size = g => g.weight * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0) + (g.tv ? 4 : 0) + (likes(g) ? 40 : 0);
    if (live.length) {
      const close = live.filter(g => !hid(g) && g.a.score !== '' && g.sport !== 'tennis').sort((x, y) => gap(x) - gap(y) || size(y) - size(x))[0];
      out.push({ i: 'live', g: close || live[0], t: `<b>${live.length} live.</b> ${close ? `Closest: ${esc(nm(close))}, ${gap(close) ? `${gap(close)} in it` : 'level'}${close.clock ? `, ${esc(close.clock)}` : ''}.` : `Biggest: ${esc(nm(live.sort((x, y) => size(y) - size(x))[0]))}.`}` });
    }
    const mine = list.filter(g => isMine(g, F) || watching(g.key)).sort((x, y) => (x.state === 'in' ? 0 : x.state === 'pre' ? 1 : 2) - (y.state === 'in' ? 0 : y.state === 'pre' ? 1 : 2) || x.date - y.date);
    if (mine.length) { const g = mine[0]; out.push({ i: 'star', g, t: `<b>Your teams:</b> ${esc(nm(g))} ${g.state === 'in' ? 'is on now' : g.state === 'pre' ? `at ${esc(hm(g.date))}` : 'has finished'}${mine.length > 1 ? `, and ${mine.length - 1} more` : ''}.` }) }
    const next = pre.filter(g => g !== mine[0]).sort((x, y) => size(y) - size(x) || x.date - y.date)[0];
    if (next) out.push({ i: 'clock', g: next, t: `<b>Biggest still to come:</b> ${esc(nm(next))}, ${esc(hm(next.date))}${next.tv ? ` on ${esc(next.tv)}` : ''}.` });
    const E = window.flEdge, top = HEAT.picks && E ? E.ranked(HEAT.picks.filter(p => !p.start || p.start > Date.now()))[0] : null;
    if (top && !MY.off.includes('three')) out.push({ i: 'pred', lab: E.labArgs(top), t: `<b>Best edge:</b> ${esc(top.name)}, ${esc(top.text)}, ${top.edge > 0 ? '+' : top.edge < 0 ? '−' : ''}${Math.abs(top.edge)} on the market.` });
    const upset = post.filter(g => !hid(g)).map(g => { const w = g.a.winner ? g.a : g.b.winner ? g.b : null, l = w === g.a ? g.b : g.a; return w && l.rank && (!w.rank || w.rank > l.rank) ? { g, w, l } : null }).filter(Boolean).sort((x, y) => x.l.rank - y.l.rank)[0];
    if (upset && out.length < 4) out.push({ i: 'bolt', g: upset.g, t: `<b>Upset:</b> #${upset.l.rank} ${esc(upset.l.name)} lost to ${esc(upset.w.name)}.` });
    if (!live.length && !pre.length && out.length < 4) out.push({ i: 'clock', g: null, t: `<b>Everything ${isToday() ? 'today' : 'on this day'} is over.</b> ${post.length} final${post.length === 1 ? '' : 's'}.` });
    if (!out.length) return '';
    const head = isToday() ? (isNight() ? 'Tonight' : 'Today') : H.day.toLocaleDateString([], { weekday: 'long' });
    return `<section class="card hm-brief" aria-labelledby="hmBriefH"><h2 id="hmBriefH">${head} in 60 seconds</h2>
      <ul class="hm-bl">${out.slice(0, 4).map(x => `<li>${x.g || x.lab ? `<button type="button" class="hm-bi" ${x.g ? hubAttr(x.g) : `data-hublab="${esc(JSON.stringify(x.lab))}"`}>` : '<p class="hm-bi">'}${ico(x.i, 18)}<span>${x.t}</span>${x.g || x.lab ? '</button>' : '</p>'}</li>`).join('')}</ul></section>`;
  }
  function editor(list) {
    const F = favList(), pool = [], seenT = new Set();
    for (const g of [...list].sort((a, b) => likes(b) - likes(a) || b.weight - a.weight)) { if (g.sport === 'tennis' || (MY.sports.length && !likes(g))) continue; for (const t of [g.a, g.b]) { const k = g.sport + t.id; if (!t.id || !t.name || seenT.has(k)) continue; seenT.add(k); pool.push({ g, t }) } }
    const on = (g, t) => F.some(f => f.id === favId(g, t) || (f.tid && String(f.tid) === t.id && f.sport === g.sport) || (f.name || '').toLowerCase() === (t.full || t.name).toLowerCase());
    return `<section class="card hm-mine hm-edit" aria-label="Edit your Home"><div class="sec-h"><h2 tabindex="-1" id="hmEditH">Edit your Home</h2><button type="button" class="bt sm" data-hubmy="done">Done</button></div>
      <div class="hm-ed"><h3 id="hmEdS">Favorite sports</h3><p class="lb">These come first in the featured game and the rows below.</p>
        <div class="cx-row" role="group" aria-labelledby="hmEdS">${SPORTS.filter(x => !['all', 'boxing', 'ufc'].includes(x[0])).map(([k, l]) => `<button type="button" class="cx" aria-pressed="${MY.sports.includes(k)}" data-hubsport="${k}">${esc(l)}</button>`).join('')}</div></div>
      <div class="hm-ed"><h3 id="hmEdT">Teams you follow</h3>
        ${F.length ? `<div class="cx-row" role="group" aria-labelledby="hmEdT">${F.map(f => `<button type="button" class="cx sm" aria-pressed="true" data-hubunfav="${esc(f.id)}" aria-label="Stop following ${esc(f.name)}">${f.logo ? `<img class="hm-plimg" src="${esc(f.logo)}" alt="" loading="lazy">` : ''}${esc(f.name)}${ico('x', 14)}</button>`).join('')}</div>` : '<p class="lb">None yet.</p>'}
        <p class="lb">${pool.length ? `Playing ${isToday() ? 'today' : 'this day'}${MY.sports.length ? ' in your sports' : ''}. Press a team to follow it. Any team’s own page has a follow star too.` : `No teams from ${MY.sports.length ? 'your sports' : 'the board'} play ${isToday() ? 'today' : 'this day'}. Follow a team from its own page, or pick another day above.`}</p>
        ${pool.length ? `<div class="cx-row hm-pool">${pool.slice(0, 36).map(({ g, t }, i) => `<button type="button" class="cx sm" aria-pressed="${on(g, t)}" data-hubfav="${i}">${t.logo ? `<img class="hm-plimg" src="${esc(t.logo)}" alt="" loading="lazy">` : ''}${esc(t.full || t.name)}</button>`).join('')}</div>` : ''}</div>
      <div class="hm-ed"><h3 id="hmEdO">What Home shows, top to bottom</h3><p class="lb">Move a section up or down, or switch it off.</p>
        <ol class="hm-order" aria-labelledby="hmEdO">${order().map((k, i, o) => { const m = MODS.find(x => x.k === k); return `<li class="hm-ord"><span class="hm-ord-n num" aria-hidden="true">${i + 1}</span>
          <div class="hm-ord-t"><b>${esc(m.l)}</b>${m.sw.map(([s, l]) => `<label class="hm-sw"><input class="sw" type="checkbox" role="switch" data-hubsec="${s}" aria-label="${esc(m.sw.length > 1 ? l : `${m.l}: ${l}`)}" ${MY.off.includes(s) ? '' : 'checked'}> ${esc(l)}</label>`).join('')}${k === 'mine' ? '<small class="lb">Shown once you follow a sport or team</small>' : ''}</div>
          <div class="hm-mv"><button type="button" class="ib" data-hubmove="${k}|-1" aria-label="Move ${esc(m.l)} up"${i ? '' : ' disabled'}>${ico('up', 18)}</button><button type="button" class="ib" data-hubmove="${k}|1" aria-label="Move ${esc(m.l)} down"${i < o.length - 1 ? '' : ' disabled'}>${ico('down', 18)}</button></div></li>` }).join('')}</ol>
        ${customOrder() ? '<button type="button" class="lk" data-hubmy="reset">Put the sections back in the usual order</button>' : ''}</div>
      ${MY.watch.length ? `<div class="hm-ed"><h3>Watchlist</h3><div class="cx-row">${MY.watch.map(w => `<button type="button" class="cx sm" aria-pressed="true" data-hubunwatch="${esc(w.key)}" aria-label="Stop watching ${esc(w.a)} v ${esc(w.b)}">${esc(w.a)} v ${esc(w.b)}${ico('x', 14)}</button>`).join('')}</div><p class="lb">Add a game with the Watch button in its match centre.</p></div>` : '<p class="lb">To watch a single game, open it and press Watch. It then sits in Your games with live updates.</p>'}</section>`;
  }
  const isNight = () => new Date().getHours() >= 17;
  function days() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return `<div class="hm-days" role="group" aria-label="Choose a day">${[-3, -2, -1, 0, 1, 2, 3].map(o => { const d = new Date(t); d.setDate(t.getDate() + o); const on = +d === +H.day;
      return `<button type="button" class="hm-day${on ? ' on' : ''}" data-hubday="${o}" aria-pressed="${on}" aria-label="${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}${o ? '' : ', today'}"><span>${o ? d.toLocaleDateString([], { weekday: 'short' }) : 'Today'}</span><b class="num">${d.getDate()}</b></button>` }).join('')}</div>`;
  }

  function paint() {
    const list = H.games, live = list.filter(g => g.state === 'in'), today = isToday(), ready = H.at && H.shown === ymd(H.day);
    const ftr = ready ? stickyFeature(list) : null;
    // the row of four: games in play, or the next to start when nothing is live; never the featured one twice
    const size = g => g.weight * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0) + (likes(g) ? 40 : 0);   // your favorite sports come first
    const rest = list.filter(g => g !== ftr);
    const liveRow = rest.filter(g => g.state === 'in').sort((a, b) => size(b) - size(a));
    const nextRow = rest.filter(g => g.state === 'pre').sort((a, b) => likes(b) - likes(a) || a.date - b.date || size(b) - size(a));
    const doneRow = rest.filter(g => g.state === 'post').sort((a, b) => size(b) - size(a));
    const four = (liveRow.length ? liveRow : nextRow.length ? nextRow : doneRow).slice(0, 4);
    const rowTitle = liveRow.length ? 'Live now' : nextRow.length ? 'Up next' : 'Finished';
    const title = today ? (isNight() ? 'Tonight' : 'Today') : H.day.toLocaleDateString([], { weekday: 'long' });
    // a redraw every 30 seconds must not take the keyboard's place away
    const act = sec.contains(document.activeElement) ? document.activeElement : null, keepAsk = act?.id === 'hmAsk' ? act.value : null;
    const keep = act && !keepAsk ? ['data-hubday', 'data-hub', 'data-hublab', 'data-hubgo', 'data-hubmy', 'data-hubsport', 'data-hubsec', 'data-hubmove', 'data-hubfav', 'data-hubunfav', 'data-shell'].map(a => act.hasAttribute(a) ? `[${a}="${CSS.escape(act.getAttribute(a))}"]${act.dataset.hubtab ? `[data-hubtab="${act.dataset.hubtab}"]` : ''}` : '').find(Boolean) : null;
    // each section is drawn on its own, then laid out in the member's order
    const part = {
      brief: () => ready ? brief(list, ftr) : '',
      mine: () => mine(list),
      back: () => back(list),
      top: () => `<div class="g2 hm-top${MY.off.includes('hot') ? ' solo' : ''}">
        ${noLive() ? `<div class="card feature emp hm-empty">${ico('members', 30)}<b>Live scores are switched off for you</b><p>Ask your admin for access to see games, scores and lineups here.</p></div>`
          : !ready ? '<div class="skl hm-ftr-skl"></div>' : ftr ? featureHTML(ftr, list)
          : H.down && !list.length ? `<div class="card feature emp hm-empty">${ico('live', 30)}<b>The scoreboards didn’t load</b><p>This page tries again every 30 seconds.</p><button type="button" class="bt ghost sm" data-hubretry="games">Try now</button></div>`
          : `<div class="card feature emp hm-empty">${ico('live', 30)}<b>No games ${today ? 'today' : 'on this day'}</b><p>Pick another day above, or choose a sport to see its schedule.</p></div>`}
        ${MY.off.includes('hot') ? '' : heatCard()}
      </div>`,
      live: () => MY.off.includes('live') ? '' : `<section class="hm-live" aria-label="${rowTitle}"${noLive() || (ready && !list.length) ? ' hidden' : ''}><div class="sec-h"><h2>${liveRow.length ? '<span class="dot-live" aria-hidden="true"></span> ' : ''}${rowTitle}</h2><button type="button" class="lk" data-shell="live">See all live${live.length ? ` (${live.length})` : ''}</button></div>
        ${!ready ? `<div class="g4 hm-cards">${'<div class="skl hm-card-skl"></div>'.repeat(4)}</div>` : four.length ? `<div class="g4 hm-cards">${four.map(card).join('')}</div>`
          : `<p class="hm-none"><b>Nothing else ${today ? 'today' : 'on this day'}</b><span>The featured game is the only one on the board.</span></p>`}</section>`,
      three: () => `${MY.off.includes('three') ? '' : `<div class="g3 hm-three">${edgeCard()}${wireCard()}${labCard()}</div>`}`,
      low: () => `${((f, st) => f && st ? `<div class="g2 hm-low">${st}<div class="vst">${f}</div></div>` : f ? `<div class="g3 hm-fights">${f}</div>` : st)(today && !MY.off.includes('fights') ? fightTiles() : '', MY.off.includes('standouts') ? '' : standouts(list))}`,
    };
    // while Home is being edited, the editor sits at the top where it was opened
    const ord = MY.edit ? ['mine', ...order().filter(k => k !== 'mine')] : order();
    sec.innerHTML = `
      <header class="pg-head hm-head"><div><h1 class="pg-title">${title}</h1><p class="pg-sub">${H.day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>${days()}</header>
      ${ord.map(k => part[k]()).join('\n')}`;
    if (keepAsk != null) { const a = $('hmAsk'); if (a) { a.value = keepAsk; a.focus() } } else if (keep) sec.querySelector(keep)?.focus({ preventScroll: true });
    { const dy = sec.querySelector('.hm-days'), on = dy?.querySelector('.on'); if (dy && on) dy.scrollLeft = on.offsetLeft - dy.offsetLeft - (dy.clientWidth - on.offsetWidth) / 2 }
    if (!sec.dataset.shown) { sec.dataset.shown = 1; sec.classList.add('hub-in'); setTimeout(() => sec.classList.remove('hub-in'), 900) }
    if (ready) { if (!MY.off.includes('hot') || !MY.off.includes('three')) loadHeat(); if (!MY.off.includes('three')) loadWire() }
  }

  /* ---------- showing and leaving the hub ---------- */
  let poll = 0;
  let shownAt = 0;
  function show() {
    if (window.flPages?.current?.()) window.flPages.hide();   // Home from Live, the Lab, Predictions or any other page: close it, or both stay hidden
    shownAt = Date.now(); root.classList.add('hub-on'); sec.hidden = false;
    window.S && S.stack?.length && typeof closeSheet === 'function' && closeSheet(true);
    paint(); load(); scrollTo({ top: 0 });
    clearInterval(poll); poll = setInterval(() => { if (!document.hidden && root.classList.contains('hub-on') && !(window.flSaver?.() && Date.now() - H.at < 12e4)) load(true) }, 30000);   // data saver: every two minutes
    window.flShell?.sync?.();
  }
  function hide() { if (!root.classList.contains('hub-on')) return; root.classList.remove('hub-on'); sec.hidden = true; clearInterval(poll) }
  // for the first-visit setup (onboard.js): favorite sports, and following a team from a game on the board
  const following = (g, t) => favList().some(f => f.id === favId(g, t) || (f.tid && String(f.tid) === t.id && f.sport === g.sport) || (!PRE[g.sport] && (f.name || '').toLowerCase() === (t.full || t.name || '').toLowerCase()));
  function setSports(list) { MY.sports = SPORTS.map(s => s[0]).filter(k => k !== 'all' && list.includes(k)); saveMine(); if (root.classList.contains('hub-on')) paint() }
  window.flHome = { edit() { show(); MY.edit = true; paint(); sec.querySelector('#hmEditH')?.focus() }, watch, watching, seen, mine: () => MY, isMine: g => isMine(g), following, follow: (g, t) => { follow(g, t); if (root.classList.contains('hub-on')) paint(); return following(g, t) }, setSports, SPORTS };
  window.flHub = { show, hide, load, on: () => root.classList.contains('hub-on'), games: () => H.games, open: g => openGame(g.sport, g.lg, g.id), card, ufc: () => H.ufc, at: () => H.at,
    day: () => H.day, setDay(d) { if (+d === +H.day) return load(); H.day = d; H.games = []; H.at = 0; return load(true) },
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
    const rt = ev.target.closest('[data-hubretry]');
    if (rt) { const k = rt.dataset.hubretry; if (k === 'heat') { HEAT.at = 0; HEAT.picks = null; HEAT.failed = false; loadHeat() } else if (k === 'wire') { WIRE.at = 0; WIRE.rows = null; WIRE.failed = false; loadWire() } else { H.err = 0; load(true) } return paint() }
    const my = ev.target.closest('[data-hubmy],[data-hubsport],[data-hubfav],[data-hubunfav],[data-hubunwatch]');
    if (my) { const m = my.dataset;
      if (m.hubmy === 'edit') { MY.edit = true; paint(); return sec.querySelector('#hmEditH')?.focus() }
      if (m.hubmy === 'done') { MY.edit = false; paint(); return sec.querySelector('[data-hubmy="edit"]')?.focus() }
      if (m.hubmy === 'reset') { MY.order = []; saveMine(); paint(); tell('Sections are back in the usual order.'); return sec.querySelector('#hmEdO')?.closest('.hm-ed')?.querySelector('[data-hubmove]:not([disabled])')?.focus() }
      if (m.hubmy === 'skip') { MY.skip = true; store.set('fl.homeSkip', true); return paint() }
      if (m.hubsport) { MY.sports = MY.sports.includes(m.hubsport) ? MY.sports.filter(k => k !== m.hubsport) : [...MY.sports, m.hubsport]; saveMine(); return paint() }
      if (m.hubfav != null) { const pool = []; const seenT = new Set(); for (const g of [...H.games].sort((a, b) => likes(b) - likes(a) || b.weight - a.weight)) { if (g.sport === 'tennis' || (MY.sports.length && !likes(g))) continue; for (const t of [g.a, g.b]) { const k = g.sport + t.id; if (!t.id || !t.name || seenT.has(k)) continue; seenT.add(k); pool.push({ g, t }) } }
        const x = pool.find(p => (p.t.full || p.t.name) === my.textContent.trim()) || pool[+m.hubfav]; if (x) follow(x.g, x.t); paint(); return [...sec.querySelectorAll('[data-hubfav]')].find(b => b.textContent.trim() === my.textContent.trim())?.focus() }
      if (m.hubunfav) { try { S.fav = S.fav.filter(f => f.id !== m.hubunfav); typeof savePrefs === 'function' && savePrefs() } catch (e) {} return paint() }
      if (m.hubunwatch) { MY.watch = MY.watch.filter(w => w.key !== m.hubunwatch); saveMine(); return paint() }
    }
    const mv = ev.target.closest('[data-hubmove]');
    if (mv) { const [k, d] = mv.dataset.hubmove.split('|'), o = order(), i = o.indexOf(k), j = i + +d; if (i < 0 || j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]]; MY.order = o; saveMine(); paint();
      // stay on the same section's button; at the top or bottom that one is switched off, so move to its partner
      const at = sec.querySelector(`[data-hubmove="${k}|${d}"]`), other = sec.querySelector(`[data-hubmove="${k}|${-d}"]`);
      (at && !at.disabled ? at : other)?.focus();
      return tell(`${MODS.find(x => x.k === k).l} moved to ${j + 1} of ${o.length}.`) }
    const lab = ev.target.closest('[data-hublab]');
    if (lab) { let a = {}; try { a = JSON.parse(lab.dataset.hublab) } catch (e) {} return openLab(a) }
    const go = ev.target.closest('[data-hubgo]');
    if (go) return openFight(go.dataset.hubgo, go.dataset.hubid);
    const g = ev.target.closest('[data-hub]'); if (!g) return;
    const [sport, lg, id] = g.dataset.hub.split('|');
    openGame(sport, lg, id, g, g.dataset.hubtab);
  });
  sec.addEventListener('change', ev => { const k = ev.target.dataset?.hubsec; if (!k) return; MY.off = ev.target.checked ? MY.off.filter(x => x !== k) : [...new Set([...MY.off, k])]; saveMine(); paint() });
  sec.addEventListener('submit', ev => { if (!ev.target.matches('[data-hubask]')) return; ev.preventDefault(); const q = $('hmAsk').value.trim(); openLab(q ? { q } : {}) });
  let sayEl = null;
  function tell(t) { if (!sayEl) { sayEl = document.createElement('p'); sayEl.className = 'sr-only'; sayEl.setAttribute('role', 'status'); sec.after(sayEl) } sayEl.textContent = ''; setTimeout(() => { sayEl.textContent = t }, 60) }
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
