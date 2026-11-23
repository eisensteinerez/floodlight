/* Floodlight · first-visit setup. Six short steps that build Home around you: your sports, your leagues, your teams
   (with how closely to follow each), your players, a few settings (sportsbooks, time zone, hidden scores, alerts) and a
   look. Every answer lands in the setting the rest of the site already reads, so nothing here is a second copy:
     sports          home.js favorite sports (fl.favSports, account prefs favSports)
     leagues         S.favLeagues (account prefs favLeagues): NFL, NBA… by key, soccer competitions by their slug
     teams           S.fav, the same list a team page's follow star writes, with a level on each:
                       fav    Favorite: comes first on Home (featured game and Your games)
                       follow Follow: on Home and in alerts
                       quiet  Quiet follow: on Home and in feeds, never in alerts
     players         S.favPlayers, the list the player pages' follow button writes
     sportsbooks     fl.myBooks; with one book chosen, prices open on that book (fl.book)
     time zone       fl.tz and account prefs tz (IANA name). Times still follow this device's clock; see the note
     hidden scores   the match centre's "hide every score" switch (flMC.setSpoilAll)
     alerts          alerts.js settings (flAlerts.set); the browser is never asked for permission here
   Recommended teams come from ESPN's team list for each league picked (the popular ones first), plus today's board,
   and a search across those lists. Players come from ESPN's player search.
   It shows once, on a first visit that lands on Home with nothing set up yet. Finishing or skipping marks it done for
   good; Settings has "Set up Home again". Whatever was picked before a skip is kept. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s = 16) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const KEY = 'fl.onboarded';
  const done = () => { try { return !!localStorage.getItem(KEY) } catch { return true } };
  const mark = how => { try { localStorage.setItem(KEY, JSON.stringify({ how, at: Date.now() })) } catch {} };
  const O = { step: 0, sports: [], from: null, el: null, q: '', pq: '', phits: null, pseq: 0, said: '' };
  const SPORTS = [['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC'], ['boxing', 'Boxing']];
  const STEPS = [['Your sports', 'What do you follow?'], ['Leagues', 'Your leagues'], ['Teams', 'Teams to follow'], ['Players', 'Players to follow'], ['Settings', 'A few settings'], ['Look', 'Pick a look']];
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
    }).catch(() => TEAMS.set(k, { list: [], err: true })).finally(() => { if (O.el && O.step === 2) paint(document.activeElement?.id ? '#' + CSS.escape(document.activeElement.id) : null) });
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
  const notify = () => { try { return { on: false, start: true, score: true, final: true, ...JSON.parse(localStorage.getItem('fl.notify') || '{}') } } catch { return { on: false, start: true, score: true, final: true } } };
  function setNotify(patch) { if (window.flAlerts?.set) window.flAlerts.set(patch); else store.set('fl.notify', { ...notify(), ...patch }) }

  /* ---------- drawing ---------- */
  const logo = src => src ? `<img src="${esc(src)}" alt="" width="20" height="20" loading="lazy" decoding="async" onerror="this.remove()">` : '';
  const LEVELS = [['fav', 'Favorite', 'First on Home'], ['follow', 'Follow', 'On Home, with alerts'], ['quiet', 'Quiet', 'On Home, no alerts']];
  const levelSeg = (f, name) => `<div class="seg obd-lv" role="radiogroup" aria-label="How closely to follow ${esc(name)}">${LEVELS.map(([k, l, d]) => { const on = (findFav(f)?.level || 'follow') === k;
    return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" tabindex="${on ? 0 : -1}" data-oblv="${esc(f.id)}|${k}" title="${esc(d)}">${l}</button>` }).join('')}</div>`;
  function body() {
    const st = O.step;
    if (st === 0) return `<p class="obd-lead">Your sports come first on Home and in Live. Pick as many as you like.</p>
      <div class="cx-row obd-chips" role="group" aria-label="Sports">${SPORTS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${O.sports.includes(k)}" data-obsport="${k}">${esc(l)}</button>`).join('')}</div>`;
    if (st === 1) {
      const mine = favLeagues(), groups = [...SPORTS.filter(([k]) => !O.sports.length || O.sports.includes(k)).map(([k, l]) => [l, allLeagues().filter(x => x[2] === k)])].filter(x => x[1].length);
      return `<p class="obd-lead">Games from your leagues rank higher on Home, after your own teams. Teams in the next step come from these leagues.</p>
        ${groups.map(([l, xs]) => `<div class="obd-grp" role="group" aria-label="${esc(l)}"><span class="lb">${esc(l)}</span><div class="cx-row obd-chips">${xs.map(x => `<button type="button" class="cx" aria-pressed="${mine.includes(x[0])}" data-oblg="${esc(x[0])}">${esc(x[1])}</button>`).join('')}</div></div>`).join('')}`;
    }
    if (st === 2) {
      for (const k of favLeagues()) loadTeams(k);
      const F = favs(), loading = favLeagues().some(k => TEAMS.get(k)?.loading), rec = recommended(), hits = O.q ? search(O.q) : null;
      const chip = x => { const on = !!findFav(x.f); return `<button type="button" class="cx obd-team" aria-pressed="${on}" data-obteam="${esc(JSON.stringify(x.f))}">${logo(x.f.logo)}${esc(x.f.name)}</button>` };
      const byWhy = new Map(); for (const x of rec) (byWhy.get(x.why) || byWhy.set(x.why, []).get(x.why)).push(x);
      return `<p class="obd-lead">Choose how closely to follow each one. <b>Favorite</b> teams come first on Home. <b>Follow</b> puts them on Home and in alerts. <b>Quiet</b> keeps them on Home with no alerts.</p>
        ${F.length ? `<div class="obd-mine"><span class="lb" id="obMineL">Your teams (${F.length})</span><ul class="obd-fl" aria-labelledby="obMineL">${F.map(f => `<li><span class="obd-fn">${logo(f.logo)}<b>${esc(f.name)}</b></span>${levelSeg(f, f.name)}<button type="button" class="ib" data-obunfav="${esc(f.id)}" aria-label="Stop following ${esc(f.name)}">${ic('x', 16)}</button></li>`).join('')}</ul></div>` : ''}
        <div class="obd-find"><label class="lb" for="obQ">Find a team</label><div class="obd-q">${ic('search', 18)}<input class="inp" id="obQ" type="search" autocomplete="off" spellcheck="false" placeholder="${favLeagues().length ? 'A team in your leagues…' : 'Pick leagues first, or search today’s teams…'}" value="${esc(O.q)}"></div></div>
        ${hits ? (hits.length ? `<div class="cx-row obd-chips" role="group" aria-label="Matches">${hits.map(chip).join('')}</div>` : `<p class="lb">No team in your leagues matches “${esc(O.q)}”. Check the spelling, or add its league in the step before.</p>`) : ''}
        ${!hits && loading && !rec.length ? '<p class="lb" role="status">Loading teams for your leagues…</p>' : ''}
        ${!hits ? [...byWhy].map(([why, xs]) => `<div class="obd-grp" role="group" aria-label="${esc(why === 'Plays today' ? 'Playing today' : `Popular in ${why}`)}"><span class="lb">${esc(why === 'Plays today' ? 'Playing today' : `Popular in ${why}`)}</span><div class="cx-row obd-chips">${xs.slice(0, 16).map(chip).join('')}</div></div>`).join('')
          + (!rec.length && !loading ? `<div class="obd-empty"><b>No teams to suggest yet.</b><p class="lb">Pick a league in the step before, or follow a team later from any of its games.</p></div>` : '') : ''}`;
    }
    if (st === 3) {
      const mine = favPlayers(), hits = O.phits;
      return `<p class="obd-lead">Followed players are easy to reach from the sport pages and the Lab. Search for anyone.</p>
        ${mine.length ? `<div class="cx-row obd-chips" role="group" aria-label="Your players">${mine.map(p => `<button type="button" class="cx" data-obpl="${esc(JSON.stringify(p))}" aria-label="Stop following ${esc(p.name)}">${esc(p.name)}${ic('x', 14)}</button>`).join('')}</div>` : ''}
        <div class="obd-find"><label class="lb" for="obPq">Find a player</label><div class="obd-q">${ic('search', 18)}<input class="inp" id="obPq" type="search" autocomplete="off" spellcheck="false" placeholder="For example: Jayson Tatum…" value="${esc(O.pq)}"></div></div>
        ${hits === 'error' ? '<p class="lb" role="status">The player search did not answer. Try again in a moment, or skip this step.</p>'
          : hits ? (hits.length ? `<ul class="obd-pl" aria-label="Matches">${hits.map(p => { const on = favPlayers().some(x => String(x.id) === p.id); return `<li><button type="button" class="obd-pb" aria-pressed="${on}" data-obpl="${esc(JSON.stringify(p))}"><span class="avx av-sm">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span aria-hidden="true">${esc(p.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</span></span><span class="rw-t"><b>${esc(p.name)}</b><small>${esc([p.team, p.league].filter(Boolean).join(' · '))}</small></span>${on ? `<span class="pl">${ic('check', 14)}Following</span>` : '<span class="lb">Follow</span>'}</button></li>` }).join('')}</ul>` : `<p class="lb">No player matches “${esc(O.pq)}”.</p>`) : ''}`;
    }
    if (st === 4) {
      const books = store.get('fl.myBooks', []), tz = store.get('fl.tz', '') || deviceTz(), dev = deviceTz(), zones = [...new Set([dev, ...TZS, tz].filter(Boolean))], N = notify(), hideAll = !!window.flMC?.spoilAll?.();
      return `<div class="obd-set">
        <fieldset class="obd-fs"><legend>Sportsbooks you use</legend><p class="lb">Floodlight reads these four. With one chosen, prices open on it.</p>
          <div class="cx-row obd-chips">${BOOKS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${books.includes(k)}" data-obbook="${k}">${l}</button>`).join('')}</div></fieldset>
        <fieldset class="obd-fs"><legend><label for="obTz">Time zone</label></legend>
          <select class="inp" id="obTz" data-obtz>${zones.map(z => `<option value="${esc(z)}"${z === tz ? ' selected' : ''}>${esc(tzName(z))}${z === dev ? ' · this device' : ''}</option>`).join('')}</select>
          <p class="lb">${tz === dev ? 'Times on Floodlight follow this device’s clock, which is set to this zone.' : 'Saved with your account. Floodlight still shows times by this device’s clock, which is set to ' + esc(tzName(dev)) + '.'}</p></fieldset>
        <fieldset class="obd-fs"><legend>Scores</legend>
          <label class="obd-sw"><input class="sw" type="checkbox" role="switch" data-obspoil ${hideAll ? 'checked' : ''}><span><b>Hide scores until I reveal them</b><small class="lb">For watching later. Each game has its own Reveal button.</small></span></label></fieldset>
        <fieldset class="obd-fs"><legend>Alerts for your teams</legend>
          <label class="obd-sw"><input class="sw" type="checkbox" role="switch" data-obal="on" ${N.on ? 'checked' : ''}><span><b>Game alerts</b><small class="lb">For teams you follow, not quiet ones. They show while Floodlight is open. Settings can also turn on browser notifications.</small></span></label>
          ${[['start', 'Game starting'], ['score', 'Score changes'], ['final', 'Final score']].map(([k, l]) => `<label class="obd-sw sub"><input class="sw" type="checkbox" role="switch" data-obal="${k}" ${N[k] ? 'checked' : ''} ${N.on ? '' : 'disabled'}><span>${l}</span></label>`).join('')}</fieldset></div>`;
    }
    const T = window.flTheme, cur = T?.get();
    return `<p class="obd-lead">Six looks, same scores. You can change it any time in Settings.</p>
      <div class="st-themes obd-themes" role="radiogroup" aria-label="Theme">${(T?.list || []).map(([id, name, desc]) => `<button type="button" class="st-theme${id === cur ? ' on' : ''}" role="radio" aria-checked="${id === cur}" tabindex="${id === cur ? 0 : -1}" data-obtheme="${id}">
        ${T.preview(id)}<span class="st-tn">${esc(name)}</span><span class="st-td">${esc(desc)}</span></button>`).join('')}</div>`;
  }
  function paint(focusSel) {
    const el = O.el; if (!el) return; const last = O.step === STEPS.length - 1;
    const caret = document.activeElement?.selectionStart;
    el.querySelector('.obd-card').innerHTML = `
      <header class="obd-head"><p class="lb obd-step" id="obStep">Step ${O.step + 1} of ${STEPS.length} · ${esc(STEPS[O.step][0])}</p><ol class="obd-dots" aria-hidden="true">${STEPS.map((_, i) => `<li class="${i <= O.step ? 'on' : ''}"></li>`).join('')}</ol>
        <h2 id="obTitle" tabindex="-1">${esc(STEPS[O.step][1])}</h2></header>
      <div class="obd-body">${body()}</div>
      <p class="sr-only" role="status" id="obSay">${esc(O.said)}</p>
      <footer class="obd-foot"><button type="button" class="lk obd-skip" data-ob="skip">Skip setup</button>
        <span class="obd-nav">${O.step ? '<button type="button" class="bt ghost" data-ob="back">Back</button>' : ''}<button type="button" class="bt" data-ob="${last ? 'finish' : 'next'}">${last ? 'Show me my Home' : 'Next'}</button></span></footer>`;
    const f = focusSel ? el.querySelector(focusSel) : el.querySelector('#obTitle');
    f?.focus({ preventScroll: !!focusSel }); if (caret != null && f?.setSelectionRange && f.type === 'search') try { f.setSelectionRange(caret, caret) } catch (e) {}
  }
  const say = t => { O.said = t };
  function open(force, from) {
    if (O.el || (!force && done())) return false;
    O.step = 0; O.sports = [...(window.flHome?.mine?.().sports || [])]; O.from = from || document.activeElement; O.q = ''; O.pq = ''; O.phits = null;
    const el = document.createElement('div'); el.className = 'obd'; el.innerHTML = `<div class="obd-scrim"></div><section class="obd-card card" role="dialog" aria-modal="true" aria-labelledby="obTitle" aria-describedby="obStep"></section>`;
    document.body.appendChild(el); O.el = el; document.documentElement.classList.add('obd-on'); paint(); return true;
  }
  function close(how) {
    if (!O.el) return; mark(how);
    O.el.remove(); O.el = null; document.documentElement.classList.remove('obd-on');
    if (how === 'finished' && window.flHub?.show) { try { localStorage.removeItem('fl.upTab') } catch (e) {} window.flHub.show() }   // Up next opens on "For you" with the new choices
    (O.from && O.from !== document.body && document.contains(O.from) ? O.from : document.querySelector('#hub h1, .tb-brand'))?.focus?.({ preventScroll: true });   // a first visit opened over nothing: land on Home's heading
  }
  const parse = s => { try { return JSON.parse(s) } catch { return null } };
  document.addEventListener('click', ev => {
    if (!O.el || !O.el.contains(ev.target)) { const s = ev.target.closest?.('[data-obagain]'); if (s) open(true, s); return }
    const t = ev.target.closest('button'); if (!t) return; const d = t.dataset;
    if (d.obsport) { const k = d.obsport; O.sports = O.sports.includes(k) ? O.sports.filter(x => x !== k) : [...O.sports, k]; window.flHome?.setSports(O.sports); return paint(`[data-obsport="${k}"]`) }
    if (d.oblg) { const on = !favLeagues().includes(d.oblg); setLeague(d.oblg, on); if (on) loadTeams(d.oblg); say(`${on ? 'Following' : 'Stopped following'} ${leagueOf(d.oblg)?.[1] || d.oblg}.`); return paint(`[data-oblg="${CSS.escape(d.oblg)}"]`) }
    if (d.obteam) { const f = parse(d.obteam); if (!f) return; const on = !findFav(f); setFav(f, on ? 'follow' : null); say(on ? `Following ${f.name}. Choose Favorite or Quiet above to change how closely.` : `Stopped following ${f.name}.`); return paint(`[data-obteam="${CSS.escape(d.obteam)}"]`) }
    if (d.oblv) { const [id, lv] = [d.oblv.slice(0, d.oblv.lastIndexOf('|')), d.oblv.slice(d.oblv.lastIndexOf('|') + 1)], f = favs().find(x => x.id === id); if (f) { setFav(f, lv); say(`${f.name}: ${LEVELS.find(x => x[0] === lv)[1]}.`) } return paint(`[data-oblv="${CSS.escape(d.oblv)}"]`) }
    if (d.obunfav) { const F = favs(), i = F.findIndex(x => x.id === d.obunfav), f = F[i]; if (f) { setFav(f, null); say(`Stopped following ${f.name}.`) } const nx = favs()[Math.min(i, favs().length - 1)]; return paint(nx ? `[data-obunfav="${CSS.escape(nx.id)}"]` : '#obQ') }
    if (d.obpl) { const p = parse(d.obpl); if (!p) return; const on = !favPlayers().some(x => String(x.id) === String(p.id)); setPlayer(p, on); say(on ? `Following ${p.name}.` : `Stopped following ${p.name}.`); return paint(`[data-obpl="${CSS.escape(d.obpl)}"]`) || paint('#obPq') }
    if (d.obbook) { const cur = store.get('fl.myBooks', []), list = cur.includes(d.obbook) ? cur.filter(x => x !== d.obbook) : [...cur, d.obbook]; saveBooks(list); return paint(`[data-obbook="${d.obbook}"]`) }
    if (d.obtheme) { window.flTheme?.set(d.obtheme); return paint(`[data-obtheme="${d.obtheme}"]`) }
    if (d.ob === 'next') { O.step = Math.min(STEPS.length - 1, O.step + 1); O.said = ''; return paint() }
    if (d.ob === 'back') { O.step = Math.max(0, O.step - 1); O.said = ''; return paint() }
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
  document.addEventListener('fl:hub', () => { if (O.el && O.step === 2) { const a = document.activeElement; paint(a?.id ? '#' + CSS.escape(a.id) : a?.dataset?.obteam ? `[data-obteam="${CSS.escape(a.dataset.obteam)}"]` : null) } });

  /* first visit: landing on Home, nothing set up yet, not inside a theme preview or the Lab's embed */
  function maybe() {
    if (done() || window.top !== window || /[?&](flpreview|embed)=/.test(location.search) || location.hash) return;
    let has = false; try { has = (window.S?.fav || []).length || JSON.parse(localStorage.getItem('fl.favSports') || '[]').length || localStorage.getItem('fl.homeSkip') } catch {}
    if (has) return mark('had-setup');
    open();
  }
  if (document.readyState === 'complete') setTimeout(maybe, 1200); else addEventListener('load', () => setTimeout(maybe, 1200));

  const settingsCard = () => `<section class="card feature st-card" aria-labelledby="stObH"><p class="st-crumb">Settings › Home</p><div class="st-h"><h2 id="stObH">Home setup</h2></div>
    <div class="st-rows"><div class="st-row"><div class="st-l"><span>Set up Home again</span><small>Walks through your sports, leagues, teams (and how closely to follow each), players, sportsbooks, time zone, hidden scores, alerts and a look. What you already have is kept.</small></div>
      <div class="st-c"><button type="button" class="bt ghost" data-obagain>Set up Home again</button></div></div></div></section>`;
  window.flOnboard = { open: () => open(true), done, settingsCard, LEVELS };
})();
