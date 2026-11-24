/* Floodlight · new-account setup. Six short steps right after sign-up (and on a first visit to Home with nothing set up):
     1 sports        NFL, NBA, Soccer (with its leagues), NHL, MLB, College sports, Tennis, UFC, Boxing. Saves the favorite
                     sports (home.js) and the matching leagues (S.favLeagues, account prefs favLeagues)
     2 teams         about three teams, so Home is personal at once: S.fav with a level on each (fav, follow, quiet)
     3 players       suggested from the chosen teams' rosters (ESPN), plus search: S.favPlayers
     4 interests     live scores, player stats, fantasy, predictions, injuries, transfers, line movement, and sportsbooks:
                     account prefs interests (fl.interests) and fl.myBooks
     5 alerts        game starting, score changes, final result, player injury, line movement, prediction result: flAlerts.set()
     6 how it works  one example player card that explains hit rate, supported edge, following, boards and Prediction Cards
   then "Your Floodlight is ready." Every answer lands in the setting the rest of the site already reads, so nothing here is
   a second copy. Finishing or skipping marks it done for good; Settings has "Set up Home again". */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s = 16) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const KEY = 'fl.onboarded';
  const done = () => { try { return !!localStorage.getItem(KEY) } catch { return true } };
  const mark = how => { try { localStorage.setItem(KEY, JSON.stringify({ how, at: Date.now() })) } catch {} };
  const O = { step: 0, sports: [], from: null, el: null, q: '', pq: '', phits: null, pseq: 0, said: '' };
  const SPORTS = [['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC'], ['boxing', 'Boxing']];
  const STEPS = [['Sports', 'What do you follow?'], ['Teams', 'Pick about three teams'], ['Players', 'Players to follow'], ['Interests', 'What are you here for?'], ['Alerts', 'What should we tell you about?'], ['How it works', 'How to read a player']];
  // the sports a person picks on step 1: [key, label, home.js sports, leagues]
  const PICKS = [['nfl', 'NFL', ['football'], ['nfl']], ['nba', 'NBA', ['basketball'], ['nba']], ['soccer', 'Soccer', ['soccer'], []], ['nhl', 'NHL', ['hockey'], ['nhl']], ['mlb', 'MLB', ['baseball'], ['mlb']],
    ['college', 'College sports', ['football', 'basketball'], ['fbs', 'cbb']], ['tennis', 'Tennis', ['tennis'], ['atp', 'wta']], ['ufc', 'UFC', ['ufc'], ['ufc']], ['boxing', 'Boxing', ['boxing'], []]];
  const INTERESTS = [['live', 'Live scores'], ['stats', 'Player statistics'], ['fantasy', 'Fantasy sports'], ['predictions', 'Predictions'], ['injuries', 'Injuries'], ['transfers', 'Transfers'], ['lines', 'Line movement']];
  const ALERTS = [['start', 'Game starting'], ['score', 'Score changes'], ['final', 'Final result'], ['pkInjury', 'Player injury'], ['pkLine', 'Line movement', 'advanced_alerts'], ['pkResult', 'Prediction result']];
  const TEAM_GOAL = 3;
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  const flat = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  const S_ = () => window.S || {};

  /* ---------- leagues ---------- */
  // [key, name, sport, ESPN path, popular teams (names as ESPN writes them)]
  const US = [
    ['nfl', 'NFL', 'football', 'football/nfl', ['Chiefs', 'Cowboys', 'Eagles', '49ers', 'Bills', 'Packers', 'Lions', 'Ravens', 'Steelers', 'Bears', 'Patriots', 'Giants']],
    ['fbs', 'College football', 'football', 'football/college-football', ['Alabama', 'Georgia', 'Ohio State', 'Michigan', 'Texas', 'Notre Dame', 'Oregon', 'LSU', 'USC', 'Clemson', 'Penn State', 'Florida State']],
    ['nba', 'NBA', 'basketball', 'basketball/nba', ['Lakers', 'Celtics', 'Warriors', 'Knicks', 'Bulls', 'Heat', 'Thunder', 'Nuggets', 'Mavericks', 'Bucks', '76ers', 'Cavaliers']],
    ['cbb', 'College basketball', 'basketball', 'basketball/mens-college-basketball', ['Duke', 'Kentucky', 'Kansas', 'North Carolina', 'UConn', 'Gonzaga', 'Michigan State', 'Arizona', 'Houston', 'Purdue']],
    ['mlb', 'MLB', 'baseball', 'baseball/mlb', ['Yankees', 'Dodgers', 'Red Sox', 'Cubs', 'Braves', 'Mets', 'Astros', 'Phillies', 'Giants', 'Cardinals']],
    ['nhl', 'NHL', 'hockey', 'hockey/nhl', ['Maple Leafs', 'Canadiens', 'Rangers', 'Bruins', 'Oilers', 'Golden Knights', 'Penguins', 'Blackhawks', 'Red Wings', 'Panthers']],
    ['atp', 'ATP', 'tennis', '', []], ['wta', 'WTA', 'tennis', '', []], ['ufc', 'UFC', 'ufc', '', []]];
  const SOCCER_POP = { 'eng.1': ['Arsenal', 'Liverpool', 'Manchester City', 'Manchester United', 'Chelsea', 'Tottenham Hotspur'], 'esp.1': ['Real Madrid', 'Barcelona', 'Atlético Madrid'],
    'ger.1': ['Bayern Munich', 'Borussia Dortmund'], 'ita.1': ['Internazionale', 'Juventus', 'AC Milan', 'Napoli'], 'fra.1': ['Paris Saint-Germain', 'Marseille'], 'usa.1': ['Inter Miami CF', 'LA Galaxy', 'LAFC'],
    'mex.1': ['América', 'Guadalajara', 'Tigres UANL'], 'por.1': ['Benfica', 'FC Porto', 'Sporting CP'], 'usa.nwsl': [] };
  const SOCCER_KEYS = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'uefa.champions', 'usa.1', 'mex.1', 'por.1', 'uefa.europa', 'usa.nwsl', 'fifa.world'];
  const soccerLeagues = () => { const L = typeof LG === 'object' && LG ? LG : {}; return SOCCER_KEYS.filter(k => L[k]).map(k => [k, L[k].name, 'soccer', 'soccer/' + k, SOCCER_POP[k] || []]) };
  const allLeagues = () => [...US, ...soccerLeagues()];
  const leagueOf = k => allLeagues().find(x => x[0] === k);
  const favLeagues = () => (S_().favLeagues || []);
  function setLeague(k, on) {
    const S = S_(); if (!Array.isArray(S.favLeagues)) return;
    S.favLeagues = on ? [...new Set([...S.favLeagues, k])] : S.favLeagues.filter(x => x !== k);
    typeof savePrefs === 'function' && savePrefs();
  }

  /* ---------- teams: ESPN's list for each league, loaded once ---------- */
  const TEAMS = new Map();   // league key -> { list, err, loading }
  const PRE = { football: 'fb', basketball: 'bb', hockey: 'hk', baseball: 'bs' };
  function loadTeams(k) {
    const L = leagueOf(k); if (!L || !L[3] || TEAMS.has(k)) return;
    TEAMS.set(k, { list: null, loading: true });
    fetch(`${ESPN}${L[3]}/teams?limit=400`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }).then(d => {
      const list = (d.sports?.[0]?.leagues?.[0]?.teams || []).map(x => x.team || x).filter(t => t?.id && (t.displayName || t.name)).map(t => ({ id: String(t.id), name: t.shortDisplayName || t.name || t.displayName, full: t.displayName || t.name, ab: t.abbreviation || '', logo: t.logos?.[0]?.href || t.logo || '' }));
      TEAMS.set(k, { list });
    }).catch(() => TEAMS.set(k, { list: [], err: true })).finally(() => { if (O.el && O.step === 1) paint(document.activeElement?.id ? '#' + CSS.escape(document.activeElement.id) : null) });
  }
  // a team in the shape S.fav keeps (the same id the team pages and home.js give it)
  function favOf(lgKey, t) {
    const L = leagueOf(lgKey), sport = L?.[2] || 'soccer';
    return PRE[sport] ? { id: `${PRE[sport]}-${lgKey}-${t.id}`, tid: t.id, sport, lg: lgKey, name: t.full || t.name, logo: t.logo || '' } : { id: t.id, name: t.full || t.name, logo: t.logo || '', lg: lgKey };
  }
  const favs = () => (S_().fav || []);
  const findFav = f => favs().find(x => x.id === f.id || (f.tid && x.tid && String(x.tid) === String(f.tid) && x.sport === f.sport));
  function setFav(f, level) {
    const S = S_(); if (!Array.isArray(S.fav)) return;
    const same = x => x.id === f.id || (f.tid && x.tid && String(x.tid) === String(f.tid) && x.sport === f.sport);
    if (!level) S.fav = S.fav.filter(x => !same(x));
    else if (S.fav.some(same)) S.fav = S.fav.map(x => same(x) ? { ...x, level } : x);   // a new level keeps the team where it is in the list
    else S.fav = [...S.fav, { ...f, level }];
    typeof savePrefs === 'function' && savePrefs();
    document.dispatchEvent(new Event('fl:follow'));
  }
  // recommended: the popular teams of each league picked, then teams playing today in your sports
  function recommended() {
    const out = [], seen = new Set(), push = (lg, t, why) => { const f = favOf(lg, t); if (seen.has(f.id)) return; seen.add(f.id); out.push({ lg, t, f, why }) };
    for (const k of favLeagues()) { const L = leagueOf(k), T = TEAMS.get(k); if (!L || !T?.list) continue;
      for (const name of L[4]) { const t = T.list.find(x => flat(x.name) === flat(name) || flat(x.full) === flat(name) || flat(x.full).endsWith(flat(name))); if (t) push(k, t, L[1]) } }
    const want = O.sports;
    for (const g of window.flHub?.games?.() || []) {
      if (!PRE[g.sport] && g.sport !== 'soccer') continue; if (want.length && !want.includes(g.sport)) continue;
      const lg = g.sport === 'soccer' ? '' : g.lg; if (g.sport !== 'soccer' && !leagueOf(lg)) continue;
      for (const t of [g.a, g.b]) if (t?.id && t.name && out.length < 60) push(lg || 'soccer', { id: t.id, name: t.name, full: t.full || t.name, logo: t.logo }, 'Plays today');
    }
    return out;
  }
  function search(q) {
    const n = flat(q); if (n.length < 2) return [];
    const out = [];
    for (const [k, T] of TEAMS) for (const t of T.list || []) if ([t.name, t.full, t.ab].some(x => flat(x).includes(n))) out.push({ lg: k, t, f: favOf(k, t), why: leagueOf(k)?.[1] || '' });
    return out.slice(0, 16);
  }

  /* ---------- step 1: a pick turns on its sports and leagues ---------- */
  const picked = k => { const p = PICKS.find(x => x[0] === k); if (!p) return false; if (p[3].length) return p[3].every(l => favLeagues().includes(l)); return p[2].every(sp => O.sports.includes(sp)) && (k !== 'soccer' || favLeagues().some(l => SOCCER_KEYS.includes(l)) || O.sports.includes('soccer')) };
  function togglePick(k) {
    const p = PICKS.find(x => x[0] === k); if (!p) return;
    const on = !picked(k);
    for (const l of p[3]) setLeague(l, on);
    const others = PICKS.filter(x => x[0] !== k && picked(x[0])).flatMap(x => x[2]);
    O.sports = on ? [...new Set([...O.sports, ...p[2]])] : O.sports.filter(sp => !p[2].includes(sp) || others.includes(sp));
    if (on && k === 'soccer' && !favLeagues().some(l => SOCCER_KEYS.includes(l))) setLeague('eng.1', true);
    if (!on && k === 'soccer') for (const l of SOCCER_KEYS) if (favLeagues().includes(l)) setLeague(l, false);
    window.flHome?.setSports(O.sports);
    for (const l of p[3]) if (on) loadTeams(l);
    return on;
  }

  /* ---------- step 3: players from the chosen teams' rosters ---------- */
  const ROSTERS = new Map();   // fav id -> { list } | { loading } | { err }
  function loadRoster(f) {
    const L = leagueOf(f.lg); if (!L || !L[3] || !f.tid || ROSTERS.has(f.id)) return;
    ROSTERS.set(f.id, { loading: true });
    fetch(`${ESPN}${L[3]}/teams/${encodeURIComponent(f.tid)}/roster`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }).then(d => {
      const raw = (d.athletes || []).flatMap(x => x.items ? x.items : [x]);
      const list = raw.filter(a => a?.id && a.displayName).map(a => ({ id: String(a.id), name: a.displayName, team: f.name, photo: a.headshot?.href || '', sport: L[2], league: L[1], yrs: +(a.experience?.years || 0), pos: a.position?.abbreviation || '' }))
        .sort((a, b) => (!!b.photo - !!a.photo) || (b.yrs - a.yrs)).slice(0, 5);
      ROSTERS.set(f.id, { list });
    }).catch(() => ROSTERS.set(f.id, { err: true })).finally(() => { if (O.el && O.step === 2) paint(document.activeElement?.id ? '#' + CSS.escape(document.activeElement.id) : null) });
  }
  const interests = () => store.get('fl.interests', []);
  function setInterests(list) {
    store.set('fl.interests', list);
    try { if (window.S?.me && typeof api === 'function') api('/api/me/prefs', { interests: list }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
  }

  /* ---------- players: ESPN's player search ---------- */
  const SEARCH = 'https://site.api.espn.com/apis/common/v3/search';
  let pT = 0;
  function findPlayers(q) {
    clearTimeout(pT); O.pq = q; const seq = ++O.pseq;
    if (q.trim().length < 2) { O.phits = null; return paint('#obPq') }
    pT = setTimeout(() => fetch(`${SEARCH}?query=${encodeURIComponent(q.trim())}&type=player&limit=10`).then(r => r.json()).then(d => {
      if (seq !== O.pseq) return;
      O.phits = (d.items || []).filter(x => x.displayName && x.id).map(x => ({ id: String(x.id), name: x.displayName, team: x.teamRelationships?.[0]?.displayName || '', photo: x.headshot?.href || '', sport: x.sport || '', league: (x.league || x.defaultLeagueSlug || '').toUpperCase(), retired: !!x.isRetired })).filter(x => !x.retired).slice(0, 8);
    }).catch(() => { if (seq === O.pseq) O.phits = 'error' }).finally(() => { if (seq === O.pseq) paint('#obPq') }), 250);
  }
  const favPlayers = () => (S_().favPlayers || []);
  function setPlayer(p, on) {
    const S = S_(); if (!Array.isArray(S.favPlayers)) return;
    S.favPlayers = S.favPlayers.filter(x => String(x.id) !== String(p.id));
    if (on) S.favPlayers = [...S.favPlayers, { id: p.id, name: p.name, team: p.team, photo: p.photo, sport: p.sport, league: p.league }];
    typeof savePrefs === 'function' && savePrefs();
  }

  /* ---------- settings ---------- */
  const BOOKS = [['draftkings', 'DraftKings'], ['fanduel', 'FanDuel'], ['kalshi', 'Kalshi'], ['polymarket', 'Polymarket']];
  const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } };
  const TZS = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Mexico_City', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Tokyo', 'Australia/Sydney'];
  const tzName = z => { try { const p = new Intl.DateTimeFormat([], { timeZone: z, timeZoneName: 'long' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName')?.value; return `${z.split('/').pop().replace(/_/g, ' ')}${p ? ` (${p})` : ''}` } catch { return z } };
  function saveTz(z) {
    store.set('fl.tz', z);
    try { if (window.S?.me && typeof api === 'function') api('/api/me/prefs', { tz: z }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
  }
  function saveBooks(list) {
    store.set('fl.myBooks', list);
    if (list.length === 1) { store.set('fl.book', list[0]); try { if (window.S) S.bookSel = list[0] } catch (e) {} }
    try { if (window.S?.me && typeof api === 'function') api('/api/me/prefs', { books: list }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
  }
  const NDEF = { on: false, start: true, score: true, final: true, pkInjury: true, pkLine: true, pkResult: true };
  const notify = () => { try { return { ...NDEF, ...JSON.parse(localStorage.getItem('fl.notify') || '{}') } } catch { return { ...NDEF } } };
  function setNotify(patch) { if (window.flAlerts?.set) window.flAlerts.set(patch); else store.set('fl.notify', { ...notify(), ...patch }) }


  /* ---------- step 6: one real line from the verified market feed (markets.js), explained ----------
     The line is an open market the feed has verified: a scheduled game that hasn't started, the player on one of its
     teams, a provider that confirmed the price recently. A followed player comes first, then a followed team, then the
     best evidence. With no open line (an off day, a provider down), the card says so and uses a marked example. */
  const T = { m: null, at: 0, loading: false, done: false };
  const BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' };
  const LAB_OF = { football: ['nfl'], basketball: ['nba', 'wnba'], hockey: ['nhl'], baseball: ['mlb'], soccer: ['soccer'] };
  function tourPick(list, now = Date.now()) {
    const K = window.flLabCore, mine = new Set(favPlayers().map(p => flat(p.name))), teams = favs().map(f => flat(f.name)).filter(Boolean);
    const onTeam = m => { const t = flat(m.teamName || m.team); return !!t && teams.some(x => x === t || x.endsWith(t) || t.endsWith(x)) };
    const score = m => (mine.has(flat(m.name)) ? 1000 : 0) + (onTeam(m) ? 500 : 0) + (K?.GRADE_RANK?.[K.grade(m)?.grade] || 0) * 20 + Math.max(-20, Math.min(20, m.sedge || 0));
    return (list || []).filter(m => m && m.type === 'prop' && m.status === 'open' && m.name && m.line != null && m.start && +m.start > now && m.verifiedAt && (m.games || []).length >= 5)
      .sort((a, b) => score(b) - score(a) || +a.start - +b.start)[0] || null;
  }
  function loadTour() {
    const M = window.flMarkets; if (T.loading || T.done) return; if (!M?.list) { T.done = true; return }
    T.loading = true;
    const known = (window.flEdge?.SPORTS || []).map(x => x[0]);
    const want = [...new Set(O.sports.flatMap(s => LAB_OF[s] || []))].filter(s => known.includes(s));
    const give = setTimeout(() => { if (T.loading) { T.loading = false; T.done = true; if (O.el && O.step === 5) paint() } }, 8000);   // never wait on a slow provider
    const ask = sports => M.list(sports.length ? { sports } : {}).then(r => r?.markets || []).catch(() => []);
    ask(want).then(list => tourPick(list) || (want.length ? ask([]).then(tourPick) : null)).then(m => { T.m = m || null; T.at = Date.now() })
      .finally(() => { clearTimeout(give); if (!T.loading) return; T.loading = false; T.done = true; if (O.el && O.step === 5) paint() });
  }
  const agoMin = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'less than a minute ago' : m === 1 ? '1 minute ago' : `${m} minutes ago` };
  function tourBody() {
    loadTour();
    const m = T.m && window.flMarkets?.standing?.({ mid: T.m.mid, sport: T.m.sport, name: T.m.name, k: T.m.k })?.open !== false ? T.m : null;   // gone since it was picked: don't show it
    const items = (hit, chance, grade, who) => `<ol class="obd-explain">
        <li><b>Hit rate</b><span>${hit} Check last 5, 20 and the season too; one hot week is not a trend.</span></li>
        <li><b>Floodlight chance and supported edge</b><span>${chance} Supported edge starts from the raw gap, then takes off points for a small sample, injuries, lineup doubts and missing data. Open “See the evidence” on any card for the steps.</span></li>
        <li><b>Evidence grade</b><span>${grade} A to D: how much solid data sits behind the number. A strong edge on D evidence is a guess.</span></li>
        <li><b>Follow</b><span>The ☆ on ${who} puts new lines on Home and in your alerts.</span></li>
        <li><b>Save to a board</b><span>Boards keep lines you're researching, like “Tonight's NBA”. They tell you when a line moves or a game starts.</span></li>
        <li><b>Add to a Prediction Card</b><span>Group picks, see the combined chance, and get a warning when two picks depend on each other.</span></li></ol>`;
    if (!m && T.loading) return `<p class="obd-lead">Every player in the Lab reads the same way. We're finding a line that's open right now to show you.</p><p class="lb" role="status">Checking today's verified lines…</p>`;
    if (!m) return `<p class="obd-lead">Every player in the Lab reads the same way. No verified line is open right now${T.done && window.flMarkets ? ' (between games, or a provider is slow)' : ''}, so this example uses made-up numbers, not a live line.</p>
      <figure class="obd-demo"><div class="obd-demo-top"><b>Example player · Points</b><span class="pl">Over 25.5 · example</span></div>
        ${items('How often he went over this line: <strong>6 of the last 10</strong> games.', 'Our estimate (58%) against the line’s price.', 'This example would be a B.', 'a player')}</figure>`;
    const K = window.flLabCore, MK = window.flMarket, g = K?.grade?.(m), smp = m.smp || MK?.sample?.(m.games, m.line, m.side, m.yes) || {};
    const side = m.yes ? (m.side === 'under' ? 'No' : 'Yes') : m.side === 'under' ? 'Under' : 'Over', fmt = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
    const books = [...new Set((m.offers || []).map(o => o.book).concat(m.books || []))].map(b => BOOK[b] || b).filter(Boolean);
    const when = MK?.when?.(+m.start, Date.now()) || new Date(+m.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const match = [m.teamName || m.team, m.oppName || m.opp].filter(Boolean).join(' v ');
    const chance = m.ours != null ? `Our estimate for this line is <strong>${Math.round(m.ours * 100)}%</strong>${m.market != null ? `, against ${Math.round(m.market * 100)}% in the price` : ''}. Supported edge: <strong>${esc(K?.signed ? K.signed(m.sedge) : m.sedge)}</strong>.` : `Supported edge: <strong>${esc(K?.signed ? K.signed(m.sedge) : m.sedge ?? '–')}</strong>.`;
    return `<p class="obd-lead">Every player in the Lab reads the same way. Here's a real line that's open right now${favPlayers().some(p => flat(p.name) === flat(m.name)) ? ', for a player you follow' : ''}.</p>
      <figure class="obd-demo obd-live" aria-labelledby="obLiveH"><div class="obd-demo-top"><b id="obLiveH">${esc(m.name)} · ${esc(m.label || m.k)}</b><span class="pl">${esc(side)} ${esc(fmt(m.line))}</span></div>
        <p class="lb obd-live-m">${esc([match, when].filter(Boolean).join(' · '))}${books.length ? ` · ${esc(books.join(', '))}` : ''} · verified ${esc(agoMin(m.verifiedAt))}</p>
        ${items(`${esc(smp.texts?.hit || 'Not enough games to count yet.')}${smp.texts?.avg ? `. ${esc(smp.texts.avg)}.` : '.'}`, chance, g ? `This one is <strong>${esc(g.grade)}</strong>, ${esc(g.word.toLowerCase())}.` : '', esc(m.name))}
        <figcaption class="lb">Research, not advice. Lines move and can close before the game.</figcaption></figure>`;
  }

  /* ---------- drawing ---------- */
  const logo = src => src ? `<img src="${esc(src)}" alt="" width="20" height="20" loading="lazy" decoding="async" onerror="this.remove()">` : '';
  const LEVELS = [['fav', 'Favorite', 'First on Home'], ['follow', 'Follow', 'On Home, with alerts'], ['quiet', 'Quiet', 'On Home, no alerts']];
  const levelSeg = (f, name) => `<div class="seg obd-lv" role="radiogroup" aria-label="How closely to follow ${esc(name)}">${LEVELS.map(([k, l, d]) => { const on = (findFav(f)?.level || 'follow') === k;
    return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" tabindex="${on ? 0 : -1}" data-oblv="${esc(f.id)}|${k}" title="${esc(d)}">${l}</button>` }).join('')}</div>`;
  const playerBtn = p => { const on = favPlayers().some(x => String(x.id) === String(p.id)); return `<li><button type="button" class="obd-pb" aria-pressed="${on}" data-obpl="${esc(JSON.stringify(p))}"><span class="avx av-sm">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span aria-hidden="true">${esc(p.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</span></span><span class="rw-t"><b>${esc(p.name)}</b><small>${esc([p.pos, p.team, p.league].filter(Boolean).join(' · '))}</small></span>${on ? `<span class="pl">${ic('check', 14)}Following</span>` : '<span class="lb">Follow</span>'}</button></li>` };
  function body() {
    const st = O.step;
    if (st === 0) {
      const soc = picked('soccer');
      return `<p class="obd-lead">Your sports come first on Home and in Live. Pick as many as you like.</p>
      <div class="cx-row obd-chips" role="group" aria-label="Sports">${PICKS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${picked(k)}" data-obpick="${k}">${esc(l)}</button>`).join('')}</div>
      ${soc ? `<div class="obd-grp" role="group" aria-label="Soccer leagues"><span class="lb">Soccer leagues</span><div class="cx-row obd-chips">${soccerLeagues().map(x => `<button type="button" class="cx" aria-pressed="${favLeagues().includes(x[0])}" data-oblg="${esc(x[0])}">${esc(x[1])}</button>`).join('')}</div></div>` : ''}`;
    }
    if (st === 1) {
      for (const k of favLeagues()) loadTeams(k);
      const F = favs(), loading = favLeagues().some(k => TEAMS.get(k)?.loading), rec = recommended(), hits = O.q ? search(O.q) : null;
      const chip = x => { const on = !!findFav(x.f); return `<button type="button" class="cx obd-team" aria-pressed="${on}" data-obteam="${esc(JSON.stringify(x.f))}">${logo(x.f.logo)}${esc(x.f.name)}</button>` };
      const byWhy = new Map(); for (const x of rec) (byWhy.get(x.why) || byWhy.set(x.why, []).get(x.why)).push(x);
      const n = F.length;
      return `<p class="obd-lead">Three teams is enough for Home to show your games, your players and your alerts from day one.</p>
        <div class="obd-goal" role="status"><span class="obd-goal-bar" aria-hidden="true"><i style="width:${Math.min(100, n / TEAM_GOAL * 100)}%"></i></span><b>${n >= TEAM_GOAL ? `${n} teams picked` : `${n} of ${TEAM_GOAL} teams`}</b></div>
        ${F.length ? `<div class="obd-mine"><span class="lb" id="obMineL">Your teams. <b>Favorite</b> comes first on Home, <b>Follow</b> adds alerts, <b>Quiet</b> means no alerts.</span><ul class="obd-fl" aria-labelledby="obMineL">${F.map(f => `<li><span class="obd-fn">${logo(f.logo)}<b>${esc(f.name)}</b></span>${levelSeg(f, f.name)}<button type="button" class="ib" data-obunfav="${esc(f.id)}" aria-label="Stop following ${esc(f.name)}">${ic('x', 16)}</button></li>`).join('')}</ul></div>` : ''}
        <div class="obd-find"><label class="lb" for="obQ">Find a team</label><div class="obd-q">${ic('search', 18)}<input class="inp" id="obQ" type="search" autocomplete="off" spellcheck="false" placeholder="${favLeagues().length ? 'A team in your sports…' : 'Pick sports first, or search today’s teams…'}" value="${esc(O.q)}"></div></div>
        ${hits ? (hits.length ? `<div class="cx-row obd-chips" role="group" aria-label="Matches">${hits.map(chip).join('')}</div>` : `<p class="lb">No team matches “${esc(O.q)}”. Check the spelling, or add its sport in the step before.</p>`) : ''}
        ${!hits && loading && !rec.length ? '<p class="lb" role="status">Loading teams…</p>' : ''}
        ${!hits ? [...byWhy].map(([why, xs]) => `<div class="obd-grp" role="group" aria-label="${esc(why === 'Plays today' ? 'Playing today' : `Popular in ${why}`)}"><span class="lb">${esc(why === 'Plays today' ? 'Playing today' : `Popular in ${why}`)}</span><div class="cx-row obd-chips">${xs.slice(0, 16).map(chip).join('')}</div></div>`).join('')
          + (!rec.length && !loading ? (favLeagues().some(k => TEAMS.get(k)?.err) ? `<div class="obd-empty"><b>Teams didn't load.</b><p class="lb">The team list didn't answer. Search by name above, try again in a moment, or go on and add teams later in Settings.</p></div>`
            : `<div class="obd-empty"><b>No teams to suggest.</b><p class="lb">Tennis, UFC and boxing have no teams. Pick a team sport in the step before, or go on.</p></div>`) : '') : ''}
        ${O.need ? `<p class="obd-need" role="alert">Pick ${TEAM_GOAL - n} more so Home has something to show, or <button type="button" class="lk" data-ob="force">go on without</button>.</p>` : ''}`;
    }
    if (st === 2) {
      const F = favs().filter(f => f.tid); F.slice(0, 6).forEach(loadRoster);
      const mine = favPlayers(), hits = O.phits;
      const sugg = F.slice(0, 6).map(f => [f, ROSTERS.get(f.id)]).filter(([, r]) => r?.list?.length);
      const loading = F.slice(0, 6).some(f => ROSTERS.get(f.id)?.loading);
      return `<p class="obd-lead">Followed players get their own lines on Home and are one tap away in the Lab.</p>
        ${mine.length ? `<div class="cx-row obd-chips" role="group" aria-label="Your players">${mine.map(p => `<button type="button" class="cx" data-obpl="${esc(JSON.stringify(p))}" aria-label="Stop following ${esc(p.name)}">${esc(p.name)}${ic('x', 14)}</button>`).join('')}</div>` : ''}
        ${sugg.map(([f, r]) => `<div class="obd-grp"><span class="lb">From ${esc(f.name)}</span><ul class="obd-pl" aria-label="Players on ${esc(f.name)}">${r.list.map(playerBtn).join('')}</ul></div>`).join('')}
        ${loading && !sugg.length ? '<p class="lb" role="status">Finding players on your teams…</p>' : ''}
        <div class="obd-find"><label class="lb" for="obPq">Find anyone else</label><div class="obd-q">${ic('search', 18)}<input class="inp" id="obPq" type="search" autocomplete="off" spellcheck="false" placeholder="For example: Jayson Tatum…" value="${esc(O.pq)}"></div></div>
        ${hits === 'error' ? '<p class="lb" role="status">The player search did not answer. Try again in a moment, or go on.</p>'
          : hits ? (hits.length ? `<ul class="obd-pl" aria-label="Matches">${hits.map(playerBtn).join('')}</ul>` : `<p class="lb">No player matches “${esc(O.pq)}”.</p>`) : ''}
        ${window.flPlan && !flPlan.can('follows_unlimited') ? `<p class="lb">Free follows up to 3 players. <a class="lk" href="#/pricing" data-page="pricing">Plus</a> has no limit.</p>` : ''}`;
    }
    if (st === 3) {
      const mine = interests(), books = store.get('fl.myBooks', []);
      return `<p class="obd-lead">We'll put these first. Pick any.</p>
        <div class="cx-row obd-chips" role="group" aria-label="Interests">${INTERESTS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${mine.includes(k)}" data-obint="${k}">${esc(l)}</button>`).join('')}</div>
        ${mine.some(k => ['predictions', 'lines', 'fantasy'].includes(k)) ? `<fieldset class="obd-fs"><legend>Where do you play?</legend><p class="lb">Prices open on your book when you pick just one.</p>
          <div class="cx-row obd-chips">${BOOKS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${books.includes(k)}" data-obbook="${k}">${l}</button>`).join('')}</div></fieldset>` : ''}`;
    }
    if (st === 4) {
      const N = notify(), plus = k => k && window.flPlan && !flPlan.can(k);
      return `<p class="obd-lead">Alerts are for the teams and players you follow, never quiet ones. They show while Floodlight is open; Settings can also turn on phone and browser notifications.</p>
        <fieldset class="obd-fs"><legend class="sr-only">Alerts</legend>
          <label class="obd-sw"><input class="sw" type="checkbox" role="switch" data-obal="on" ${N.on ? 'checked' : ''}><span><b>Alerts on</b></span></label>
          ${ALERTS.map(([k, l, feat]) => `<label class="obd-sw sub"><input class="sw" type="checkbox" role="switch" data-obal="${k}" ${N[k] && !plus(feat) ? 'checked' : ''} ${N.on && !plus(feat) ? '' : 'disabled'}><span>${l}${plus(feat) ? ' <span class="pl">Plus</span>' : ''}</span></label>`).join('')}</fieldset>`;
    }
    if (st === 5) return tourBody();
    return `<div class="obd-ready"><p class="obd-lead">Home now leads with ${favs().length ? `your ${favs().length} team${favs().length > 1 ? 's' : ''}` : 'your sports'}${favPlayers().length ? ` and ${favPlayers().length} player${favPlayers().length > 1 ? 's' : ''}` : ''}. Change any of it later in Settings.</p>
      ${S_().me && !S_().me.email_verified ? `<p class="lb">One more thing: confirm your email from the link we sent${S_().me.email ? ` to ${esc(S_().me.email)}` : ''}, so you can always get back in.</p>` : ''}</div>`;
  }
  function paint(focusSel) {
    const el = O.el; if (!el) return; const ready = O.step === STEPS.length, last = O.step === STEPS.length - 1;
    if (ready) {
      el.querySelector('.obd-card').innerHTML = `<header class="obd-head"><h2 id="obTitle" tabindex="-1">Your Floodlight is ready.</h2></header><div class="obd-body">${body()}</div>
        <footer class="obd-foot"><span></span><span class="obd-nav"><button type="button" class="bt ghost" data-ob="lab">Open the Lab</button><button type="button" class="bt" data-ob="finish">Show me my Home</button></span></footer>`;
      return el.querySelector('#obTitle')?.focus();
    }
    const caret = document.activeElement?.selectionStart;
    el.querySelector('.obd-card').innerHTML = `
      <header class="obd-head"><p class="lb obd-step" id="obStep">Step ${O.step + 1} of ${STEPS.length} · ${esc(STEPS[O.step][0])}</p><ol class="obd-dots" aria-hidden="true">${STEPS.map((_, i) => `<li class="${i <= O.step ? 'on' : ''}"></li>`).join('')}</ol>
        <h2 id="obTitle" tabindex="-1">${esc(STEPS[O.step][1])}</h2></header>
      <div class="obd-body">${body()}</div>
      <p class="sr-only" role="status" id="obSay">${esc(O.said)}</p>
      <footer class="obd-foot"><button type="button" class="lk obd-skip" data-ob="skip">Skip setup</button>
        <span class="obd-nav">${O.step ? '<button type="button" class="bt ghost" data-ob="back">Back</button>' : ''}<button type="button" class="bt" data-ob="next">${last ? 'Finish' : 'Next'}</button></span></footer>`;
    const f = focusSel ? el.querySelector(focusSel) : el.querySelector('#obTitle');
    f?.focus({ preventScroll: !!focusSel }); if (caret != null && f?.setSelectionRange && f.type === 'search') try { f.setSelectionRange(caret, caret) } catch (e) {}
  }
  const say = t => { O.said = t };
  function open(force, from) {
    if (O.el || (!force && done())) return false;
    O.step = 0; O.sports = [...(window.flHome?.mine?.().sports || [])]; O.from = from || document.activeElement; O.q = ''; O.pq = ''; O.phits = null; O.need = false;
    if (!store.get('fl.tz', '') && deviceTz()) saveTz(deviceTz());   // the device's time zone, kept with the account
    const el = document.createElement('div'); el.className = 'obd'; el.innerHTML = `<div class="obd-scrim"></div><section class="obd-card card" role="dialog" aria-modal="true" aria-labelledby="obTitle" aria-describedby="obStep"></section>`;
    document.body.appendChild(el); O.el = el; document.documentElement.classList.add('obd-on'); paint(); return true;
  }
  function close(how) {
    if (!O.el) return; mark(how);
    try { window.flTrack?.(how === 'finished' ? 'onboarding_done' : 'onboarding_skip', { step: O.step, teams: favs().length, players: favPlayers().length, live: !!T.m }) } catch (e) {}
    O.el.remove(); O.el = null; document.documentElement.classList.remove('obd-on');
    if (how === 'finished' && window.flHub?.show) { try { localStorage.removeItem('fl.upTab') } catch (e) {} window.flHub.show() }   // Up next opens on "For you" with the new choices
    (O.from && O.from !== document.body && document.contains(O.from) ? O.from : document.querySelector('#hub h1, .tb-brand'))?.focus?.({ preventScroll: true });   // a first visit opened over nothing: land on Home's heading
  }
  const parse = s => { try { return JSON.parse(s) } catch { return null } };
  document.addEventListener('click', ev => {
    if (!O.el || !O.el.contains(ev.target)) { const s = ev.target.closest?.('[data-obagain]'); if (s) open(true, s); return }
    const t = ev.target.closest('button'); if (!t) return; const d = t.dataset;
    if (d.obpick) { const on = togglePick(d.obpick); say(`${on ? 'Added' : 'Removed'} ${PICKS.find(x => x[0] === d.obpick)?.[1]}.`); return paint(`[data-obpick="${d.obpick}"]`) }
    if (d.obint) { const cur = interests(), list = cur.includes(d.obint) ? cur.filter(x => x !== d.obint) : [...cur, d.obint]; setInterests(list); return paint(`[data-obint="${d.obint}"]`) }
    if (d.ob === 'force') { O.need = false; O.step++; return paint() }
    if (d.ob === 'lab') { close('finished'); return window.flPages?.show('lab') }
    if (d.obsport) { const k = d.obsport; O.sports = O.sports.includes(k) ? O.sports.filter(x => x !== k) : [...O.sports, k]; window.flHome?.setSports(O.sports); return paint(`[data-obsport="${k}"]`) }
    if (d.oblg) { const on = !favLeagues().includes(d.oblg); setLeague(d.oblg, on); if (on) loadTeams(d.oblg); say(`${on ? 'Following' : 'Stopped following'} ${leagueOf(d.oblg)?.[1] || d.oblg}.`); return paint(`[data-oblg="${CSS.escape(d.oblg)}"]`) }
    if (d.obteam) { const f = parse(d.obteam); if (!f) return; const on = !findFav(f); setFav(f, on ? 'follow' : null); say(on ? `Following ${f.name}. Choose Favorite or Quiet above to change how closely.` : `Stopped following ${f.name}.`); return paint(`[data-obteam="${CSS.escape(d.obteam)}"]`) }
    if (d.oblv) { const [id, lv] = [d.oblv.slice(0, d.oblv.lastIndexOf('|')), d.oblv.slice(d.oblv.lastIndexOf('|') + 1)], f = favs().find(x => x.id === id); if (f) { setFav(f, lv); say(`${f.name}: ${LEVELS.find(x => x[0] === lv)[1]}.`) } return paint(`[data-oblv="${CSS.escape(d.oblv)}"]`) }
    if (d.obunfav) { const F = favs(), i = F.findIndex(x => x.id === d.obunfav), f = F[i]; if (f) { setFav(f, null); say(`Stopped following ${f.name}.`) } const nx = favs()[Math.min(i, favs().length - 1)]; return paint(nx ? `[data-obunfav="${CSS.escape(nx.id)}"]` : '#obQ') }
    if (d.obpl) { const p = parse(d.obpl); if (!p) return; const on = !favPlayers().some(x => String(x.id) === String(p.id)); setPlayer(p, on); say(on ? `Following ${p.name}.` : `Stopped following ${p.name}.`); return paint(`[data-obpl="${CSS.escape(d.obpl)}"]`) || paint('#obPq') }
    if (d.obbook) { const cur = store.get('fl.myBooks', []), list = cur.includes(d.obbook) ? cur.filter(x => x !== d.obbook) : [...cur, d.obbook]; saveBooks(list); return paint(`[data-obbook="${d.obbook}"]`) }
    if (d.obtheme) { window.flTheme?.set(d.obtheme); return paint(`[data-obtheme="${d.obtheme}"]`) }
    if (d.ob === 'next') {
      if (O.step === 1 && favs().length < TEAM_GOAL && recommended().length) { O.need = true; return paint('[data-ob="force"]') }
      O.need = false; O.step = Math.min(STEPS.length, O.step + 1); O.said = ''; return paint();
    }
    if (d.ob === 'back') { O.step = Math.max(0, O.step - 1); O.said = ''; O.need = false; return paint() }
    if (d.ob === 'finish') return close('finished');
    if (d.ob === 'skip') return close('skipped');
  });
  document.addEventListener('input', ev => {
    if (!O.el?.contains(ev.target)) return;
    if (ev.target.id === 'obQ') { O.q = ev.target.value; clearTimeout(O.qt); O.qt = setTimeout(() => paint('#obQ'), 150) }
    if (ev.target.id === 'obPq') findPlayers(ev.target.value);
  });
  document.addEventListener('change', ev => {
    if (!O.el?.contains(ev.target)) return; const t = ev.target;
    if (t.matches('[data-obtz]')) { saveTz(t.value); return paint('#obTz') }
    if (t.matches('[data-obspoil]')) { window.flMC?.setSpoilAll?.(t.checked); return paint('[data-obspoil]') }
    if (t.dataset.obal) { setNotify({ [t.dataset.obal]: t.checked }); return paint(`[data-obal="${t.dataset.obal}"]`) }
  });
  document.addEventListener('keydown', ev => {
    if (!O.el) return;
    if (ev.key === 'Escape') { if (ev.target.type === 'search' && ev.target.value) return; ev.preventDefault(); return close('skipped') }
    const th = ev.target.closest?.('[data-obtheme]');
    if (th && /^Arrow|^Home$|^End$/.test(ev.key)) { const all = [...th.parentElement.children], i = all.indexOf(th), n = all.length, j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : /Right|Down/.test(ev.key) ? (i + 1) % n : (i - 1 + n) % n; ev.preventDefault(); all[j].click(); return }
    if (ev.key !== 'Tab') return;   // keep focus inside the dialog
    const f = [...O.el.querySelectorAll('button:not([disabled]),input:not([disabled]),select,[tabindex="0"],h2[tabindex]')].filter(x => x.offsetParent || x.id === 'obTitle'); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus() } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
  });
  document.addEventListener('fl:hub', () => { if (O.el && O.step === 1) { const a = document.activeElement; paint(a?.id ? '#' + CSS.escape(a.id) : a?.dataset?.obteam ? `[data-obteam="${CSS.escape(a.dataset.obteam)}"]` : null) } });

  /* first visit: landing on Home, nothing set up yet, not inside a theme preview or the Lab's embed */
  function maybe() {
    let fresh = false; try { fresh = sessionStorage.getItem('fl.newAccount') === '1'; sessionStorage.removeItem('fl.newAccount') } catch {}
    if (fresh && window.top === window) return open(true);   // right after sign-up, whatever the page
    if (done() || window.top !== window || /[?&](flpreview|embed)=/.test(location.search) || location.hash) return;
    let has = false; try { has = (window.S?.fav || []).length || JSON.parse(localStorage.getItem('fl.favSports') || '[]').length || localStorage.getItem('fl.homeSkip') } catch {}
    if (has) return mark('had-setup');
    open();
  }
  // signing up inside the app (no reload): open as soon as the new account is in
  document.addEventListener('fl:me', () => { let f = false; try { f = sessionStorage.getItem('fl.newAccount') === '1' } catch {} if (f && window.S?.me && !O.el) setTimeout(maybe, 400) });
  if (document.readyState === 'complete') setTimeout(maybe, 1200); else addEventListener('load', () => setTimeout(maybe, 1200));

  const settingsCard = () => `<section class="card feature st-card" aria-labelledby="stObH"><p class="st-crumb">Settings › Home</p><div class="st-h"><h2 id="stObH">Home setup</h2></div>
    <div class="st-rows"><div class="st-row"><div class="st-l"><span>Set up Home again</span><small>Walks through your sports, teams (and how closely to follow each), players, interests, alerts and how to read a player. What you already have is kept.</small></div>
      <div class="st-c"><button type="button" class="bt ghost" data-obagain>Set up Home again</button></div></div></div></section>`;
  window.flOnboard = { open: () => open(true), done, settingsCard, LEVELS };
})();
