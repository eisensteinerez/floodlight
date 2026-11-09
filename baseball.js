/* Floodlight · baseball
   MLB, the minor leagues, the Arizona Fall League, the Caribbean and Pacific winter leagues, the Australian league, the
   Mexican League, the independent leagues and the World Baseball Classic come from MLB StatsAPI (box scores, play by play,
   rosters, every player stat). Japan (NPB), Korea (KBO), Taiwan (CPBL) and Cuba come from Flashscore through the local
   server (scores, innings, lineups, standings, bookmaker odds). Odds: Kalshi plus FanDuel, DraftKings, BetMGM and Fanatics.
   Loaded after the main app script and football.js, and reuses their helpers. */
const SA = 'https://statsapi.mlb.com/api/v1';
const SA11 = 'https://statsapi.mlb.com/api/v1.1';
const BS_SPORTS = '1,11,12,13,14,17,23,51';
// src 'sa' = MLB StatsAPI (sport id, optional league id), 'fs' = Flashscore via /api/bsb
const BS_LEAGUES = [
  { key: 'mlb', src: 'sa', sport: 1, name: 'MLB', area: 'USA & Canada', grp: 'pro', kx: 'MLB', logo: 'https://www.mlbstatic.com/team-logos/league-on-light/1.svg', months: [2, 10] },
  { key: 'npb', src: 'fs', x: true, name: 'NPB', area: 'Japan', grp: 'asia', kx: 'NPB', months: [2, 10] },
  { key: 'kbo', src: 'fs', x: true, name: 'KBO', area: 'South Korea', grp: 'asia', kx: 'KBO', months: [2, 10] },
  { key: 'cpbl', src: 'fs', x: true, name: 'CPBL', area: 'Taiwan', grp: 'asia', months: [2, 10] },
  { key: 'lidom', src: 'sa', sport: 17, league: 131, name: 'LIDOM', area: 'Dominican Republic', grp: 'winter', months: [9, 0] },
  { key: 'lvbp', src: 'sa', sport: 17, league: 135, name: 'LVBP', area: 'Venezuela', grp: 'winter', months: [9, 0] },
  { key: 'lmp', src: 'sa', sport: 17, league: 132, name: 'Liga Mexicana del Pacífico', area: 'Mexico', grp: 'winter', months: [9, 0] },
  { key: 'lbprc', src: 'sa', sport: 17, league: 133, name: 'Puerto Rico (LBPRC)', area: 'Puerto Rico', grp: 'winter', months: [10, 0] },
  { key: 'abl', src: 'sa', sport: 17, league: 595, name: 'Australian Baseball League', area: 'Australia', grp: 'winter', months: [10, 1] },
  { key: 'afl', src: 'sa', sport: 17, league: 119, name: 'Arizona Fall League', area: 'MLB prospects', grp: 'winter', months: [9, 10] },
  { key: 'cs', src: 'sa', sport: 17, league: 162, name: 'Caribbean Series', area: 'Winter-league champions', grp: 'winter', months: [1, 1] },
  { key: 'bbcl', src: 'bb', name: 'Banana Ball', area: 'Savannah Bananas & the BBCL', grp: 'pro', logo: 'https://bananaball.com/wp-content/uploads/2023/11/cropped-bananaball.png?w=192', months: [1, 9] },
  { key: 'lmb', src: 'sa', sport: 23, league: 125, name: 'Mexican League (LMB)', area: 'Mexico', grp: 'pro', months: [3, 8] },
  { key: 'cuba', src: 'fs', name: 'Serie Nacional', area: 'Cuba', grp: 'pro', months: [0, 11] },
  { key: 'aaa', src: 'sa', sport: 11, name: 'Triple-A', area: 'Minor leagues', grp: 'minors', months: [2, 8] },
  { key: 'aa', src: 'sa', sport: 12, name: 'Double-A', area: 'Minor leagues', grp: 'minors', months: [3, 8] },
  { key: 'ha', src: 'sa', sport: 13, name: 'High-A', area: 'Minor leagues', grp: 'minors', months: [3, 8] },
  { key: 'sa1', src: 'sa', sport: 14, name: 'Single-A', area: 'Minor leagues', grp: 'minors', months: [3, 8] },
  { key: 'alpb', src: 'sa', sport: 23, league: 436, name: 'Atlantic League', area: 'Independent', grp: 'indy', months: [3, 8] },
  { key: 'aaipb', src: 'sa', sport: 23, league: 6045, name: 'American Association', area: 'Independent', grp: 'indy', months: [4, 8] },
  { key: 'frontier', src: 'sa', sport: 23, league: 442, name: 'Frontier League', area: 'Independent', grp: 'indy', months: [4, 8] },
  { key: 'wbc', src: 'sa', sport: 51, league: 160, name: 'World Baseball Classic', area: 'International', grp: 'intl', months: [2, 2] },
];
const BSL = Object.fromEntries(BS_LEAGUES.map(l => [l.key, l]));
const BS_GROUPS = [['pro', 'Pro'], ['asia', 'Asia'], ['winter', 'Winter & fall leagues'], ['minors', 'Minor leagues'], ['indy', 'Independent'], ['intl', 'International']];
const BS_KX_FUT = [
  ['mlb', 'KXMLB', 'World Series champion'], ['mlb', 'KXMLBSERIES', 'Series winner', true], ['mlb', 'KXMLBWSMVP', 'World Series MVP'],
  ['mlb', 'KXMLBALMVP', 'AL MVP'], ['mlb', 'KXMLBNLMVP', 'NL MVP'], ['mlb', 'KXMLBALCY', 'AL Cy Young'], ['mlb', 'KXMLBNLCY', 'NL Cy Young'],
  ['mlb', 'KXMLBALROTY', 'AL Rookie of the Year'], ['mlb', 'KXMLBNLROTY', 'NL Rookie of the Year'],
  ['npb', 'KXNPB', 'Japan Series champion'], ['kbo', 'KXKBO', 'Korean Series champion'],
];
const BS_PLAYER_FUT = new Set(['KXMLBWSMVP', 'KXMLBALMVP', 'KXMLBNLMVP', 'KXMLBALCY', 'KXMLBNLCY', 'KXMLBALROTY', 'KXMLBNLROTY']);
// MLB team colours (StatsAPI has none): primary, then a lighter alternate for very dark primaries
const BS_COLORS = { 108: ['BA0021'], 109: ['A71930'], 110: ['DF4601'], 111: ['BD3039'], 112: ['0E3386'], 113: ['C6011F'], 114: ['00385D', 'E50022'], 115: ['33006F'], 116: ['0C2340', 'FA4616'],
  117: ['EB6E1F'], 118: ['004687'], 119: ['005A9C'], 120: ['AB0003'], 121: ['FF5910', '002D72'], 133: ['003831', 'EFB21E'], 134: ['FDB827', '27251F'], 135: ['2F241D', 'FFC425'], 136: ['005C5C'],
  137: ['FD5A1E'], 138: ['C41E3A'], 139: ['092C5C', '8FBCE6'], 140: ['003278', 'C0111F'], 141: ['134A8E'], 142: ['002B5C', 'D31145'], 143: ['E81828'], 144: ['CE1141'], 145: ['27251F', 'C4CED4'],
  146: ['00A3E0'], 147: ['0C2340', 'C4CED3'], 158: ['12284B', 'FFC52F'] };
S.bsb = { lg: store.get('fl.bsbLg', 'all'), view: 'games', date: null, data: {}, stand: {}, teamStats: {}, futures: null, filter: 'all', showAll: {} };
const bsYear = () => new Date().getFullYear();
const bsYmd = d => isoDay(d);
const bsToday = () => bsYmd(new Date());
const bsDate = () => S.bsb.date || bsToday();
const bsOffset = ymd => Math.round((new Date(ymd + 'T12:00:00') - new Date(bsToday() + 'T12:00:00')) / 864e5);
const bsLogo = id => `https://www.mlbstatic.com/team-logos/${id}.svg`;
const bsShot = (id, mlb = true) => id ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${id}/headshot/${mlb ? 67 : 'milb'}/current` : SIL;
const bsImgErr = `onerror="this.onerror=null;this.src=SIL"`;
const bsLogoErr = `onerror="this.onerror=null;this.style.visibility='hidden'"`;
const bsNum = x => { if (x == null || x === '' || x === '-') return null; const n = parseFloat(String(x).replace(/,/g, '')); return isFinite(n) ? n : null };
const bsIP = x => { const n = bsNum(x); if (n == null) return null; const w = Math.trunc(n); return w + Math.round((n - w) * 10) / 3 };   // "123.1" = 123⅓ innings
const bsAm = d => !d || d <= 1 ? '–' : d >= 2 ? '+' + Math.round((d - 1) * 100) : '−' + Math.round(100 / (d - 1));
const bsInPlayoffs = e => /^[FDLWC]$/.test(e.gameType || '');
function bsColorFor(team, name){
  const c = BS_COLORS[team?.id]; if (c) return { color: c[0], alt: c[1] || null };
  return { color: fmColor(name || team?.name || ''), alt: null };
}
function bsLeagueOf(g){
  const sp = g.teams?.home?.team?.sport?.id ?? g.sport?.id, lg = g.teams?.home?.team?.league?.id;
  return BS_LEAGUES.find(l => l.src === 'sa' && l.sport === sp && (!l.league || l.league === lg)) || null;
}

/* ---------- loading games ---------- */
function bsSaNorm(g, l){
  const st = g.status || {}, ls = g.linescore || {}, abs = st.abstractGameState;
  const state = abs === 'Live' ? 'in' : abs === 'Final' ? 'post' : 'pre';
  const odd = /postpon|cancel|suspend|delay/i.test(st.detailedState || '');
  const inn = ls.currentInning;
  const detail = state === 'in' ? (st.detailedState === 'In Progress' || !st.detailedState || /progress/i.test(st.detailedState) ? `${ls.inningState === 'Top' ? 'Top' : ls.inningState === 'Bottom' ? 'Bot' : ls.inningState || ''} ${inn || ''}`.trim() : st.detailedState)
    : state === 'post' ? (odd ? st.detailedState : `Final${inn && inn !== (g.scheduledInnings || 9) ? '/' + inn : ''}`) : odd ? st.detailedState : '';
  const side = ha => { const x = g.teams?.[ha] || {}, t = x.team || {}, c = bsColorFor(t);
    const lt = ls.teams?.[ha] || {};
    return { id: String(t.id), name: (l.sport === 1 ? t.teamName : t.shortName || t.teamName || t.clubName) || t.name, full: t.name, abbr: t.abbreviation || (t.name || '').slice(0, 3).toUpperCase(),
      logo: bsLogo(t.id), color: c.color, alt: c.alt, score: x.score ?? '', winner: x.isWinner, record: x.leagueRecord ? `${x.leagueRecord.wins}-${x.leagueRecord.losses}` : '',
      lines: (ls.innings || []).map(i => i[ha]?.runs ?? ''), hits: lt.hits ?? '', errors: lt.errors ?? '',
      sp: x.probablePitcher ? { id: x.probablePitcher.id, name: x.probablePitcher.fullName } : null } };
  const home = side('home'), away = side('away');
  const [hc, ac] = teamColors(home, away);
  const off = ls.offense || {}, def = ls.defense || {};
  const tv = [...new Set((g.broadcasts || []).filter(b => b.type === 'TV' && !/^(home|away)$/i.test(b.name)).map(b => b.name))];
  const series = g.seriesDescription && bsInPlayoffs(g) ? `${g.seriesDescription}${g.seriesGameNumber ? ' · Game ' + g.seriesGameNumber : ''}` : '';
  return { id: String(g.gamePk), src: 'sa', lg: l.key, date: new Date(g.gameDate), ymd: g.officialDate, state, detail, home, away, hc, ac, gameType: g.gameType,
    venue: g.venue?.name || '', tv: tv.join(', '), series, seriesStatus: bsInPlayoffs(g) ? g.seriesStatus?.result || '' : '', dh: g.doubleHeader === 'Y' || g.doubleHeader === 'S' ? g.gameNumber : 0,
    sit: state === 'in' ? { outs: ls.outs ?? 0, balls: ls.balls ?? 0, strikes: ls.strikes ?? 0, on1: !!off.first, on2: !!off.second, on3: !!off.third, batter: off.batter?.fullName || '', pitcher: def.pitcher?.fullName || '', half: ls.inningState, inning: inn } : null,
    dec: g.decisions ? { w: g.decisions.winner, l: g.decisions.loser, s: g.decisions.save } : null, sched: g.scheduledInnings || 9 };
}
function bsFsNorm(x, key){
  const side = t => { if (!t.full) { const r = bsTeamRow(key, t.id); t = { ...t, name: r?.short || r?.name || t.slug.replace(/-/g, ' ') || '?', full: r?.name || t.slug.replace(/-/g, ' ') || '?', abbr: (r?.name || t.slug || '?').slice(0, 3).toUpperCase() } }
    const c = { color: fmColor(t.full), alt: null }; return { id: t.id, pid: t.pid, slug: t.slug, name: t.name, full: t.full, abbr: t.abbr, logo: t.logo, color: c.color, alt: null,
    score: t.score, lines: t.lines || [], hits: t.hits, errors: t.errors, record: '' } };
  const home = side(x.home), away = side(x.away), [hc, ac] = teamColors(home, away), d = new Date(x.ts * 1000);
  return { id: 'fs' + x.id, fsId: x.id, src: 'fs', lg: key, date: d, ymd: bsYmd(d), state: x.state, detail: x.detail, home, away, hc, ac, venue: '', tv: '',
    series: x.round && !/^\d+$/.test(x.round) ? x.round : '', seriesStatus: x.note || '', sit: null, dec: null, sched: 9 };
}
// one call covers every StatsAPI league on a day; one more covers the Flashscore leagues
async function bsLoadDay(ymd){
  const id = 'day|' + ymd, have = S.bsb.data[id];
  if (have?.events && Date.now() - have.at < 30000) return have;
  const tz = -new Date().getTimezoneOffset() / 60, off = bsOffset(ymd);
  const [a, b, c] = await Promise.allSettled([
    getJSON(`${SA}/schedule?sportId=${BS_SPORTS}&date=${ymd}&hydrate=linescore,probablePitcher,team,decisions,seriesStatus,broadcasts(all),venue`),
    Math.abs(off) <= 7 && S.serverOK !== false ? cjT(`/api/bsb/day?off=${off}&tz=${Math.round(tz)}`, 15000) : Promise.reject('range'),
    S.serverOK !== false ? cjT(`/api/bsb/banana/games?from=${ymd}&to=${ymd}`, 30000) : Promise.reject('offline')]);
  const evs = [];
  if (a.status === 'fulfilled') for (const d of a.value.dates || []) for (const g of d.games || []) { const l = bsLeagueOf(g); if (l && g.gameType !== 'E') evs.push(bsSaNorm(g, l)) }
  if (b.status === 'fulfilled') { S.serverOK = true; for (const [k, list] of Object.entries(b.value.games || {})) for (const x of list) evs.push(bsFsNorm(x, k)) }
  if (c.status === 'fulfilled') for (const g of c.value.games || []) evs.push(bsBbNorm(g));
  const prevEvs = have?.events || [];
  S.bsb.data[id] = { events: evs.length || a.status === 'fulfilled' ? evs.sort((x, y) => x.date - y.date) : prevEvs, at: Date.now(), error: a.status === 'rejected' && b.status === 'rejected', fsDown: b.status === 'rejected' && Math.abs(off) <= 7 };
  return S.bsb.data[id];
}
const bsAllEvents = () => { const m = new Map(); for (const d of Object.values(S.bsb.data)) for (const e of d.events || []) m.set(e.id, e); return [...m.values()] };
async function bsOddsForList(evs){
  const groups = {}; evs.filter(e => e.state !== 'post' && BSL[e.lg]?.kx).forEach(e => (groups[BSL[e.lg].kx] ||= []).push(e));
  await Promise.allSettled(Object.entries(groups).map(async ([pre, list]) => {
    const kevs = await kxSeries(pre, 'GAME');
    for (const e of list) { const k = kxFind(kevs, e); if (!k) continue; const ml = parseML(e, k); if (ml) { const o = S.odds.get(e.id) || {}; o.ml = ml; S.odds.set(e.id, o) } }
  }));
}

/* ---------- main column ---------- */
const bsOnNow = l => { const m = new Date().getMonth(), [a, b] = l.months || [0, 11]; return a <= b ? m >= a && m <= b : m >= a || m <= b };
function bsRail(){
  const c = S.bsb.counts || {}, on = k => S.bsb.view === 'games' && S.bsb.lg === k ? ' on' : '';
  const favs = S.fav.filter(f => f.sport === 'baseball');
  const btn = l => `<button class="lg${on(l.key)}" data-bslg="${l.key}">${l.logo ? `<img src="${esc(l.logo)}" alt="" ${bsLogoErr}>` : '<span class="dot">●</span>'}<span>${esc(l.name)}${bsOnNow(l) ? '' : ' <small class="bs-off">off-season</small>'}</span>${c[l.key]?.live ? `<b class="live">${c[l.key].live}</b>` : c[l.key]?.n ? `<b>${c[l.key].n}</b>` : ''}</button>`;
  let h = `<h4>Baseball</h4>
    <button class="lg${on('all')}" data-bslg="all"><span class="dot">●</span><span>All games</span></button>
    <button class="lg${S.bsb.view === 'futures' ? ' on' : ''}" data-bsview="futures"><span class="dot">%</span><span>Futures & title odds</span></button>
    <button class="lg${S.bsb.view === 'picks' ? ' on' : ''}" data-bsview="picks"><span class="dot">%</span><span>Predictions</span></button>`;
  if (favs.length) h += `<h4>My teams</h4>` + favs.map(f => `<button class="lg" data-bsteam="${esc(f.tid)}" data-bsl="${esc(f.lg)}"${f.slug ? ` data-bsslug="${esc(f.slug)}"` : ''}><img src="${esc(f.logo)}" alt="" ${bsLogoErr}><span>${esc(f.name)}</span></button>`).join('');
  for (const [g, label] of BS_GROUPS) h += `<h4>${label}</h4>` + BS_LEAGUES.filter(l => l.grp === g).map(btn).join('');
  h += `<p class="pf-hint" style="padding:10px">College baseball isn't covered: no free feed publishes its games and stats.</p>`;
  $('rail').innerHTML = h;
}
function bsBases(s, size = 30){
  const b = (on, x, y) => `<rect x="${x}" y="${y}" width="9" height="9" transform="rotate(45 ${x + 4.5} ${y + 4.5})" fill="${on ? 'var(--accent)' : 'none'}" stroke="${on ? 'var(--accent)' : 'var(--muted)'}" stroke-width="1.4"/>`;
  return `<svg class="bs-bases" viewBox="0 0 34 24" width="${size}" height="${size * 24 / 34}" aria-label="${esc(['first', 'second', 'third'].filter((_, i) => [s.on1, s.on2, s.on3][i]).join(', ') || 'Bases empty')}" role="img">${b(s.on2, 12.5, 2)}${b(s.on3, 3, 11.5)}${b(s.on1, 22, 11.5)}</svg>`;
}
const bsOuts = n => `<span class="bs-outs" aria-label="${n} out${n === 1 ? '' : 's'}">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
function bsCard(e){
  const post = e.state === 'post', hs = +e.home.score, as = +e.away.score, hl = post && hs < as, al = post && as < hs;
  const st = e.state === 'in' ? `<div class="st live"><span class="min">${esc(e.detail)}</span>LIVE</div>`
    : e.state === 'pre' ? `<div class="st"><span class="ko">${e.detail ? esc(e.detail) : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}</div>` : `<div class="st">${esc(e.detail)}</div>`;
  const team = (t, lose) => `<div class="tm${lose ? ' lose' : ''}"><img src="${esc(t.logo)}" alt="" loading="lazy" ${bsLogoErr}><span>${esc(t.name)}</span>${t.record ? `<small class="rec">${esc(t.record)}</small>` : ''}</div>`;
  const ml = S.odds.get(e.id)?.ml;
  const odds = e.state !== 'post' && ml?.home && ml?.away ? `<div class="oddrow" aria-hidden="true"><span class="${ml.home.p >= ml.away.p ? 'fav' : ''}">${esc(e.home.abbr)} ${pct(ml.home.p)}%</span><span class="${ml.away.p > ml.home.p ? 'fav' : ''}">${esc(e.away.abbr)} ${pct(ml.away.p)}%</span></div>` : '';
  let extra = '';
  if (e.sit) extra = `<div class="fb-sit bs-sit">${bsBases(e.sit, 24)}${bsOuts(e.sit.outs)}<span>${e.sit.balls}-${e.sit.strikes}</span>${e.sit.batter ? `<span class="bs-ab">${esc(e.sit.batter.split(' ').slice(-1)[0])} vs ${esc(e.sit.pitcher.split(' ').slice(-1)[0])}</span>` : ''}</div>`;
  else if (e.state === 'pre' && (e.away.sp || e.home.sp)) extra = `<div class="bs-sp">${esc(e.away.sp?.name || 'TBD')} <span>vs</span> ${esc(e.home.sp?.name || 'TBD')}</div>`;
  else if (post && e.dec?.w) extra = `<div class="bs-sp">W ${esc(e.dec.w.fullName)}${e.dec.l ? ` · L ${esc(e.dec.l.fullName)}` : ''}${e.dec.s ? ` · SV ${esc(e.dec.s.fullName)}` : ''}</div>`;
  const ser = e.series || e.seriesStatus ? `<div class="bs-ser">${esc([e.series, e.seriesStatus].filter(Boolean).join(' · '))}</div>` : '';
  return `<button class="m fb bs" data-bsgame="${esc(e.id)}" style="--hc:${e.ac};--ac:${e.hc}"
    aria-label="${esc(`${e.away.full} at ${e.home.full}. ${e.state === 'pre' ? 'First pitch ' + e.date.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : `${e.away.score} to ${e.home.score}, ${e.detail}`}${ml?.home ? `. Kalshi: ${e.home.name} ${pct(ml.home.p)} percent` : ''}${e.tv ? '. On ' + e.tv : ''}`)}">
    ${st}<div class="tms">${team(e.away, al)}${team(e.home, hl)}${ser}${extra}${odds}</div>
    <div class="sc num">${e.state !== 'pre' ? `<span class="${al ? 'lose' : ''}">${esc(e.away.score)}</span><span class="${hl ? 'lose' : ''}">${esc(e.home.score)}</span>` : `<span class="tv">${esc(e.tv.split(',')[0] || '')}</span><span>&nbsp;</span>`}</div></button>`;
}
function bsLgSelect(){ const key = S.bsb.view === 'games' ? S.bsb.lg : '_' + S.bsb.view, l = S.bsb.lg;
  return `<select class="bs-lgsel" id="bsLgSel" aria-label="League"><option value="all" ${key === 'all' ? 'selected' : ''}>All leagues</option><option value="_futures" ${key === '_futures' ? 'selected' : ''}>Futures & title odds</option><option value="_picks" ${key === '_picks' ? 'selected' : ''}>Predictions</option>${BS_GROUPS.map(([g, lab]) => `<optgroup label="${lab}">${BS_LEAGUES.filter(l => l.grp === g).map(l => `<option value="${l.key}" ${key === l.key ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`).join('')}</select>` }
function bsDateLabel(ymd){
  const off = bsOffset(ymd);
  return off === 0 ? 'Today' : off === -1 ? 'Yesterday' : off === 1 ? 'Tomorrow' : new Date(ymd + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
async function renderBaseball(){
  const el = $('bsb'); if (!el) return;
  bsRail();
  if (S.bsb.view === 'futures') return renderBsFutures();
  if (S.bsb.view === 'picks') return renderBsPicks();
  const key = S.bsb.lg, ymd = bsDate(), id = 'day|' + ymd;
  const title = key === 'all' ? bsDateLabel(ymd) : BSL[key].name;
  const paint = () => {
    const d = S.bsb.data[id]; if (!d) return;
    const q = S.q.trim().toLowerCase();
    const inLg = e => key === 'all' || e.lg === key;
    const list = d.events.filter(e => inLg(e) && (!q || `${e.home.full} ${e.away.full}`.toLowerCase().includes(q)) && (S.bsb.filter !== 'live' || e.state === 'in')
      && (S.bsb.filter !== 'fav' || S.fav.some(f => f.sport === 'baseball' && (String(f.tid) === e.home.id || String(f.tid) === e.away.id))));
    S.bsb.counts = {}; for (const e of d.events) { const c = S.bsb.counts[e.lg] ||= { n: 0, live: 0 }; c.n++; if (e.state === 'in') c.live++ }
    bsRail();
    const live = list.filter(e => e.state === 'in').length;
    const groups = new Map(); const order = BS_LEAGUES.map(l => l.key);
    for (const e of [...list].sort((a, b) => order.indexOf(a.lg) - order.indexOf(b.lg) || a.date - b.date)) { if (!groups.has(e.lg)) groups.set(e.lg, []); groups.get(e.lg).push(e) }
    const navs = `<div class="datebar"><button class="dnav" data-bsact="day" data-to="-1" aria-label="Previous day">‹</button>
        <label class="dtoggle bs-dpick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>${esc(bsDateLabel(ymd))}</span><input type="date" id="bsDate" value="${ymd}" aria-label="Pick a date"></label>
        <button class="dnav" data-bsact="day" data-to="1" aria-label="Next day">›</button></div>`;
    const chips = `<div class="quick">${[['all', 'All'], ['live', `Live${live ? ' · ' + live : ''}`], ['fav', '★ My teams']].map(([k, l]) => `<button class="qf" data-bsfilter="${k}" aria-pressed="${(S.bsb.filter || 'all') === k}">${k === 'live' ? '<span class="dot"></span>' : ''}${l}</button>`).join('')}
      ${ymd !== bsToday() ? `<button class="qf" data-bsact="today">Back to today</button>` : ''}
      ${bsLgSelect()}</div>`;
    const lgInfo = key !== 'all' ? `<button class="btn ghost lginfo" data-bsact="lginfo">Standings & leaders</button>` : '';
    let body;
    if (list.length) body = [...groups].map(([lk, l]) => `<div class="group"><div class="group-h"><strong>${esc(BSL[lk].name)}</strong><small style="color:var(--muted);margin-left:8px">${esc(BSL[lk].area)}</small>${key === 'all' ? `<button class="linkbtn" style="margin-left:auto;font-size:12px" data-bslg="${lk}">Open</button>` : ''}</div><div class="cards">${l.map(bsCard).join('')}</div></div>`).join('');
    else body = `<div class="empty-state"><strong>${d.error ? "Couldn't load games" : 'No games'}</strong>${d.error ? 'Check your connection and try again.' : key !== 'all' && !bsOnNow(BSL[key]) ? `${esc(BSL[key].name)} is in its off-season. Use the arrows or pick a date to look back at last season, or open its standings.` : 'Nothing scheduled on this day. Use the arrows to change day.'}</div>`;
    const fsNote = d.fsDown && (key === 'all' || BSL[key]?.src === 'fs') ? `<p class="srcnote">${S.serverOK === false ? 'NPB, KBO, CPBL and Cuba need the local server (python3 server.py).' : 'Japan, Korea, Taiwan and Cuba are only available within a week of today.'}</p>` : '';
    el.innerHTML = navs + chips + `<div class="livebar"><h2>${esc(title)}</h2><span class="count">${list.length} game${list.length === 1 ? '' : 's'}${live ? ` · <span class="pill live">${live} live</span>` : ''}${key !== 'all' ? ' · ' + esc(bsDateLabel(ymd)) : ''}</span>${lgInfo}</div>` + body + fsNote;
  };
  if (S.bsb.data[id]) paint(); else el.innerHTML = '<div class="cards"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  await bsLoadDay(ymd);
  if (S.sport !== 'baseball' || S.bsb.view !== 'games' || bsDate() !== ymd) return;
  paint(); bsTicker();
  bsOddsForList(S.bsb.data[id].events.filter(e => key === 'all' || e.lg === key)).then(() => { if (S.sport === 'baseball' && S.bsb.view === 'games') paint() }).catch(() => {});
}
function bsTicker(){
  const all = bsAllEvents();
  const live = all.filter(e => e.state === 'in');
  const next = all.filter(e => e.state === 'pre' && e.date > Date.now()).sort((a, b) => a.date - b.date).slice(0, 6);
  const chip = e => `<button class="tk" data-bsgame="${esc(e.id)}"><span class="mn ${e.state === 'in' ? '' : 'pre'}">${e.state === 'in' ? esc(e.detail) : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><img src="${esc(e.away.logo)}" alt="" ${bsLogoErr}>${esc(e.away.abbr)}${e.state === 'in' ? `<span class="s num">${esc(e.away.score)}–${esc(e.home.score)}</span>` : ' @ '}${esc(e.home.abbr)}<img src="${esc(e.home.logo)}" alt="" ${bsLogoErr}></button>`;
  $('ticker').hidden = !live.length && !next.length;
  $('ticker').innerHTML = (live.length ? `<span class="lab">${live.length} live</span>` + live.map(chip).join('') : '') + (next.length ? `<span class="lab next">Next up</span>` + next.map(chip).join('') : '');
}

/* ---------- standings ---------- */
// winter leagues run October to January under the year they start in
function bsSeason(key){
  const l = BSL[key], m = new Date().getMonth(), y = bsYear(); if (!l?.months) return y;
  const [a, b] = l.months;
  if (a > b) return m <= b + 1 ? y - 1 : y;
  return m < a ? y - 1 : y;
}
async function bsLeagueIds(l, season){
  if (l.league) return [l.league];
  if (l.sport === 1) return [103, 104];
  const d = await cj(`${SA}/league?sportId=${l.sport}&season=${season}`);
  return (d.leagues || []).map(x => x.id);
}
async function bsStandings(key){
  const l = BSL[key]; if (!l) return [];
  if (S.bsb.stand[key]) return S.bsb.stand[key];
  try {
    if (l.src === 'bb') {
      const d = await cjT(`/api/bsb/banana/standings`, 300000);
      return S.bsb.stand[key] = [{ name: d.season?.description ? `${d.season.year} ${d.season.description}` : '', entries: (d.rows || []).map(x => ({ ...x, short: x.name, pct: x.pct != null ? (+x.pct).toFixed(3).replace(/^0/, '') : '', gb: x.gb ? String(x.gb) : '-' })) }];
    }
    if (l.src === 'fs') {
      const d = await cjT(`/api/bsb/league?key=${key}`, 120000);
      S.bsb.lgfs ||= {}; S.bsb.lgfs[key] = d;
      if (d.logo && !l.logo) l.logo = d.logo;
      return S.bsb.stand[key] = (d.standings || []).map(g => ({ name: /^\d*$/.test(g.name) ? '' : g.name, entries: g.rows.map(x => ({ id: x.id, slug: x.slug, name: x.name, short: x.name,
        logo: bsFsLogo(key, x.id), w: x.w, l: x.l, t: x.t, gp: x.gp || x.w + x.l + x.t, pct: x.pct, rs: x.rs, ra: x.ra, gb: '', streak: x.form?.length ? x.form[0] : '', form: x.form || [] })) }));
    }
    const season = bsSeason(key), ids = await bsLeagueIds(l, season);
    const d = await cj(`${SA}/standings?leagueId=${ids.join(',')}&season=${season}&standingsTypes=regularSeason&hydrate=team(league,division)`);
    const groups = (d.records || []).map(r => ({ name: r.division?.name || r.teamRecords?.[0]?.team?.division?.name || r.league?.name || r.teamRecords?.[0]?.team?.league?.name || '', id: r.division?.id || r.league?.id,
      entries: (r.teamRecords || []).map(x => { const sp = n => x.records?.splitRecords?.find(s => s.type === n); const rec = s => s ? `${s.wins}-${s.losses}` : '';
        return { id: String(x.team.id), name: x.team.name, short: (l.sport === 1 ? x.team.teamName : x.team.shortName || x.team.teamName) || x.team.name, logo: bsLogo(x.team.id),
          w: x.wins, l: x.losses, t: 0, gp: x.gamesPlayed || x.wins + x.losses, pct: x.winningPercentage || x.leagueRecord?.pct || '', gb: x.divisionGamesBack || x.gamesBack || '', wcgb: x.wildCardGamesBack,
          rs: x.runsScored || 0, ra: x.runsAllowed || 0, streak: x.streak?.streakCode || '', home: rec(sp('home')), away: rec(sp('away')), l10: rec(sp('lastTen')), clinch: x.clinchIndicator || '',
          divRank: +x.divisionRank || null, wcRank: +x.wildCardRank || null } }) }));
    // MLB lists divisions by id; show AL then NL, east to west
    if (l.sport === 1) groups.sort((a, b) => a.id - b.id);
    return S.bsb.stand[key] = groups.filter(g => g.entries.length);
  } catch { return S.bsb.stand[key] = [] }
}
const bsFsLogos = new Map();   // "league|team id" -> crest, filled from games
function bsFsLogo(key, id){ const k = key + '|' + id; if (bsFsLogos.has(k)) return bsFsLogos.get(k);
  for (const e of bsAllEvents()) for (const t of [e.home, e.away]) if (t.id && t.logo) bsFsLogos.set(e.lg + '|' + t.id, t.logo);
  for (const d of Object.values(S.bsb.lgfs || {})) for (const e of [...(d.results || []), ...(d.fixtures || [])]) for (const t of [e.home, e.away]) if (t.id && t.logo) bsFsLogos.set(d.key + '|' + t.id, t.logo);
  return bsFsLogos.get(k) || '' }
function bsTeamRow(key, id){ for (const g of S.bsb.stand[key] || []) { const r = g.entries.find(x => String(x.id) === String(id)); if (r) return { ...r, group: g.name } } return null }
function bsStandingsHTML(key, hl = []){
  const gs = S.bsb.stand[key]; if (!gs) { bsStandings(key).then(() => renderSheet()); return `<div class="skel" style="height:300px"></div>` }
  if (!gs.length) return `<div class="note">No standings published for ${esc(BSL[key]?.name || 'this league')} yet.</div>`;
  const sa = BSL[key].src === 'sa' || BSL[key].src === 'bb', mlb = key === 'mlb', pts = BSL[key].src === 'bb';
  const show = gs.length > 2 && hl.length ? [...gs.filter(g => g.entries.some(x => hl.includes(String(x.id)))), ...gs.filter(g => !g.entries.some(x => hl.includes(String(x.id))))] : gs;
  return show.map(g => `${g.name ? `<div class="grp-name">${esc(g.name)}</div>` : ''}<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PCT</th>${sa ? '<th>GB</th>' : ''}<th>${pts ? 'PF' : 'RS'}</th><th>${pts ? 'PA' : 'RA'}</th><th>DIFF</th>${sa ? '<th>Home</th><th>Away</th><th>L10</th>' : ''}<th>${sa ? 'STRK' : 'Form'}</th></tr></thead><tbody>
    ${[...g.entries].sort((a, b) => (sa && a.divRank && b.divRank ? a.divRank - b.divRank : 0) || (b.w - b.l) - (a.w - a.l) || (b.rs - b.ra) - (a.rs - a.ra)).map((x, i) => `<tr class="${hl.includes(String(x.id)) ? 'hl' : ''}"><td class="r num">${x.clinch && mlb ? `<i style="background:var(--win)"></i>` : ''}${i + 1}</td>
      <td class="t"><img src="${esc(x.logo || '')}" alt="" loading="lazy" ${bsLogoErr}><button class="linkbtn" data-bsteam="${esc(x.id)}" data-bsl="${esc(key)}"${x.slug ? ` data-bsslug="${esc(x.slug)}"` : ''}>${esc(x.short || x.name)}</button>${x.clinch && mlb ? ` <small style="color:var(--muted)">${esc(x.clinch)}</small>` : ''}</td>
      <td>${x.w}</td><td>${x.l}</td><td>${esc(x.pct)}</td>${sa ? `<td>${esc(x.gb)}</td>` : ''}<td>${x.rs}</td><td>${x.ra}</td><td>${x.rs - x.ra > 0 ? '+' : ''}${x.rs - x.ra}</td>${sa ? `<td>${esc(x.home)}</td><td>${esc(x.away)}</td><td>${esc(x.l10)}</td>` : ''}
      <td>${sa ? esc(x.streak) : (x.form || []).slice(0, 5).map(f => `<span class="res ${f === 'W' ? 'W' : f === 'L' ? 'L' : 'D'}" style="margin-right:2px">${f}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>`).join('')
    + (mlb ? `<div class="notes"><span><i style="background:var(--win)"></i>Clinched a playoff spot (z = best record, y = division, x = playoffs, w = wild card)</span></div>` : '')
    + (BSL[key].src === 'fs' ? `<p class="srcnote">Regular-season table from Flashscore.</p>` : pts ? `<p class="srcnote">PF and PA are points (innings won and lost). World Tour table from bananaball.com.</p>` : '');
}

/* ---------- prediction model ---------- */
// Each side's expected runs: its scoring rate times the opponent's run prevention, where the starting pitcher covers
// about 58% of the innings. Rates are shrunk toward the league average early in the season. Win chance from those
// runs uses the Pythagorean formula (exponent 1.83), then blends with the betting market when there is one.
function bsLgRPG(key){ const rows = (S.bsb.stand[key] || []).flatMap(g => g.entries); const gp = rows.reduce((a, x) => a + (x.gp || 0), 0), rs = rows.reduce((a, x) => a + (x.rs || 0), 0); return gp > 20 && rs ? rs / gp : 4.5 }
function bsSpRA9(p, lg){
  const s = p?.stat; if (!s) return null; const ip = bsIP(s.inningsPitched) || 0; if (!ip) return null;
  const fip = (13 * (s.homeRuns || 0) + 3 * ((s.baseOnBalls || 0) + (s.hitByPitch || 0)) - 2 * (s.strikeOuts || 0)) / ip + 3.1;
  const era = bsNum(s.era) ?? lg, ra9 = (.5 * era + .5 * fip) * 1.08;   // runs allowed run about 8% above earned runs
  return (ra9 * ip + lg * 35) / (ip + 35);
}
function bsBooksProb(books){
  const xs = (books || []).filter(b => b.ml?.home > 1 && b.ml?.away > 1).map(b => { const h = 1 / b.ml.home, a = 1 / b.ml.away; return h / (h + a) });
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function bsBooksTotal(books){ const ls = (books || []).map(b => b.total?.length ? b.total.reduce((x, y) => Math.abs(1 / y.over - 1 / y.under) < Math.abs(1 / x.over - 1 / x.under) ? y : x).line : null).filter(x => x != null); return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null }
function bsPredict(e, v){
  const lg = bsLgRPG(e.lg), H = bsTeamRow(e.lg, e.home.id), A = bsTeamRow(e.lg, e.away.id), K = 20;
  const off = r => r && r.gp ? (r.rs + lg * K) / (r.gp + K) : lg, def = r => r && r.gp ? (r.ra + lg * K) / (r.gp + K) : lg;
  const spH = bsSpRA9(v?.sp?.home, lg), spA = bsSpRA9(v?.sp?.away, lg);
  const prevH = spH != null ? .42 * def(H) + .58 * spH : def(H), prevA = spA != null ? .42 * def(A) + .58 * spA : def(A);
  const hfa = bsInPlayoffs(e) ? 1.02 : 1.03;
  let rH = off(H) * prevA / lg * hfa, rA = off(A) * prevH / lg / hfa;
  rH = Math.min(12, Math.max(1.5, rH)); rA = Math.min(12, Math.max(1.5, rA));
  const model = rH ** 1.83 / (rH ** 1.83 + rA ** 1.83);
  const ml = S.odds.get(e.id)?.ml, market = ml?.home && ml?.away ? ml.home.p / (ml.home.p + ml.away.p) : null;
  const books = bsBooksProb(v?.books), mk = market ?? books;
  const pH = mk != null ? .6 * mk + .4 * model : model;
  const pick = pH >= .5 ? 'home' : 'away', top = Math.max(pH, 1 - pH), conf = top >= .64 ? 'Strong' : top >= .555 ? 'Lean' : 'Toss-up';
  const o = S.odds.get(e.id), kxT = o?.total?.length ? o.total.reduce((a, b) => Math.abs(b.p - .5) < Math.abs(a.p - .5) ? b : a).line : null;
  const mkT = kxT ?? bsBooksTotal(v?.books), T = mkT != null ? .6 * mkT + .4 * (rH + rA) : rH + rA;
  // split the projected total by the win chance, so the projected score always agrees with the pick
  const share = .5 + (pH - .5) * .55; let hs = Math.round(T * share), as = Math.round(T * (1 - share));
  if (hs === as) pick === 'home' ? hs++ : as++;
  if ((hs > as) !== (pick === 'home')) [hs, as] = [as, hs];
  return { H, A, lg, rH, rA, spH, spA, model, market, books, pH, pick, top, conf, total: T, score: [hs, as], hfa, base: H && A ? 'table' : 'none' };
}
function bsReasons(e, P, v){
  const out = [], hn = e.home.name, an = e.away.name, f = (x, d = 2) => x == null ? '–' : x.toFixed(d), pg = (r, k) => r?.gp ? (r[k] / r.gp).toFixed(2) : '–';
  if (P.base === 'table') {
    out.push(`Records: ${hn} ${P.H.w}-${P.H.l}, ${an} ${P.A.w}-${P.A.l}.`);
    out.push(`${hn} score ${pg(P.H, 'rs')} and allow ${pg(P.H, 'ra')} ${e.src === 'bb' ? 'points' : 'runs'} a game; ${an} score ${pg(P.A, 'rs')} and allow ${pg(P.A, 'ra')} (league average ${P.lg.toFixed(2)}).`);
    if (P.H.home || P.A.away) out.push(`${hn} at home: ${P.H.home || '–'}. ${an} on the road: ${P.A.away || '–'}.`);
    if (P.H.l10 || P.A.l10) out.push(`Last 10 games: ${hn} ${P.H.l10 || '–'}, ${an} ${P.A.l10 || '–'}.`);
  } else out.push(`There's no standings data for these teams yet, so the model starts both at the league average${P.market != null || P.books != null ? ' and leans on the market' : ''}.`);
  const sp = (side, ra9) => { const p = v?.sp?.[side], s = p?.stat; if (!p) return null; return `${p.name} (${s ? `${s.wins ?? 0}-${s.losses ?? 0}, ${s.era ?? '–'} ERA, ${s.whip ?? '–'} WHIP in ${s.inningsPitched ?? 0} IP` : 'no stats this season'}${ra9 != null ? `; worth about ${f(ra9)} runs per 9` : ''})` };
  const a = sp('away', P.spA), h = sp('home', P.spH);
  if (a || h) out.push(`Starting pitchers: ${a || an + ' TBD'} vs ${h || hn + ' TBD'}.`);
  else if (e.src === 'sa') out.push('No probable starters announced yet, so pitching is judged on each staff\'s runs allowed.');
  out.push(`Home field is worth about ${Math.round((P.hfa - 1) * 200)}% more runs to ${hn}.`);
  out.push(`Model: ${hn} ${f(P.rH, 1)} runs, ${an} ${f(P.rA, 1)}, a ${pct(P.model)}% chance for ${hn}.`);
  if (P.market != null) { const gap = P.model - P.market; out.push(`Kalshi gives ${P.market >= .5 ? hn : an} a ${pct(Math.max(P.market, 1 - P.market))}% chance.${Math.abs(gap) >= .05 ? ` The model is ${gap > 0 ? 'higher' : 'lower'} on ${hn} (${pct(P.model)}% vs ${pct(P.market)}%).` : ' The model broadly agrees.'}`) }
  else if (P.books != null) out.push(`The sportsbooks make ${P.books >= .5 ? hn : an} a ${pct(Math.max(P.books, 1 - P.books))}% favourite (margin removed).`);
  return out;
}

/* ---------- game page ---------- */
function bsFindEvent(id){ return bsAllEvents().find(x => x.id === String(id)) || S.bsb.extra?.get(String(id)) || null }
function openBsGame(id, tab){
  const e = bsFindEvent(id); if (!e) return bsOpenGameById(id);
  S.sel = null; S.stack = [{ type: 'bsbgame', id: e.id, e, tab: tab || (e.state === 'pre' ? 'pred' : 'summary') }];
  renderSheet(); $('sheet').classList.add('open'); $('sheet').querySelector('.sheet-body')?.scrollTo(0, 0);
  bsLoadGame(S.stack[0]);
}
// a game reached from a team schedule or a player's game log: build the event from its own schedule entry
async function bsOpenGameById(id){
  if (String(id).startsWith('fs')) return;
  try { const d = await getJSON(`${SA}/schedule?gamePk=${id}&hydrate=linescore,probablePitcher,team,decisions,seriesStatus,broadcasts(all),venue`);
    const g = d.dates?.[0]?.games?.[0]; const l = g && bsLeagueOf(g); if (!l) return;
    const e = bsSaNorm(g, l); (S.bsb.extra ||= new Map()).set(e.id, e); openBsGame(e.id) } catch {}
}
async function bsLoadGame(v){
  const e = v.e, rr = () => S.stack.includes(v) && renderSheet();
  bsStandings(e.lg).then(rr);
  if (BSL[e.lg].kx) bsGameOdds(e).then(rr).catch(() => {});
  if (e.src === 'bb') return rr();
  if (e.src === 'fs') {
    try { v.fs = await getJSON(`/api/bsb/game?id=${e.fsId}&ja=${e.home.pid || ''}&jb=${e.away.pid || ''}`); v.books = v.fs.odds?.books || [] } catch { v.fs = { error: true } }
    return rr();
  }
  const pk = e.id;
  const [f, wp] = await Promise.allSettled([getJSON(`${SA11}/game/${pk}/feed/live`), e.state !== 'pre' ? getJSON(`${SA}/game/${pk}/winProbability`) : Promise.reject()]);
  v.feed = val(f); v.wp = val(wp); if (!v.feed) v.err = true;
  if (v.feed) bsRefreshFromFeed(e, v.feed);
  rr();
  // starting pitchers' season numbers, for the matchup and the model
  const pp = v.feed?.gameData?.probablePitchers || {}, ids = [pp.away?.id || e.away.sp?.id, pp.home?.id || e.home.sp?.id];
  if (!v.sp && ids.some(Boolean)) {
    const l = BSL[e.lg], season = bsSeason(e.lg);
    getJSON(`${SA}/people?personIds=${ids.filter(Boolean).join(',')}&hydrate=stats(group=[pitching],type=[season],season=${season},sportId=${l.sport})`).then(d => {
      const get = id => { const p = (d.people || []).find(x => x.id === id); if (!p) return null; const sp = (p.stats || []).find(s => s.group?.displayName === 'pitching')?.splits || [];
        const mine = sp.find(x => !l.league || x.league?.id === l.league) || sp[0]; return { id: p.id, name: p.fullName, hand: p.pitchHand?.code, stat: mine?.stat || null } };
      v.sp = { away: ids[0] ? get(ids[0]) : null, home: ids[1] ? get(ids[1]) : null }; rr() }).catch(() => {});
  }
  // bookmaker prices through Flashscore, when it lists the game
  if (e.state === 'post' || S.serverOK === false) v.books ||= [];
  if (e.state !== 'post' && S.serverOK !== false && !v.books) {
    const d = e.date, ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    getJSON(`/api/bsb/find?date=${ymd}&home=${encodeURIComponent(e.home.full)}&away=${encodeURIComponent(e.away.full)}`).then(m => {
      if (!m?.id) { v.books = []; return rr() }
      return getJSON(`/api/bsb/odds?id=${m.id}&ja=${m.swapped ? m.jb : m.ja}&jb=${m.swapped ? m.ja : m.jb}`).then(o => { v.books = o.books || []; rr() });
    }).catch(() => { v.books = []; rr() });
  }
}
function bsRefreshFromFeed(e, f){
  const ls = f.liveData?.linescore || {}, st = f.gameData?.status || {};
  const abs = st.abstractGameState; e.state = abs === 'Live' ? 'in' : abs === 'Final' ? 'post' : 'pre';
  for (const ha of ['home', 'away']) { const t = ls.teams?.[ha] || {}; if (t.runs != null) e[ha].score = t.runs; e[ha].hits = t.hits ?? e[ha].hits; e[ha].errors = t.errors ?? e[ha].errors; e[ha].lines = (ls.innings || []).map(i => i[ha]?.runs ?? '') }
  if (e.state === 'in') { const off = ls.offense || {};
    e.detail = `${ls.inningState === 'Top' ? 'Top' : ls.inningState === 'Bottom' ? 'Bot' : ls.inningState || ''} ${ls.currentInning || ''}`.trim();
    e.sit = { outs: ls.outs ?? 0, balls: ls.balls ?? 0, strikes: ls.strikes ?? 0, on1: !!off.first, on2: !!off.second, on3: !!off.third, batter: off.batter?.fullName || '', pitcher: ls.defense?.pitcher?.fullName || '', half: ls.inningState, inning: ls.currentInning } }
  else if (e.state === 'post') { e.sit = null; e.detail = /postpon|cancel|suspend/i.test(st.detailedState || '') ? st.detailedState : `Final${ls.currentInning && ls.currentInning !== e.sched ? '/' + ls.currentInning : ''}` }
}
async function bsGameOdds(e){
  const pre = BSL[e.lg].kx;
  const [g, sp, to] = await Promise.allSettled(['GAME', 'SPREAD', 'TOTAL'].map(k => kxSeries(pre, k)));
  const o = S.odds.get(e.id) || {};
  const kg = val(g) && kxFind(val(g), e); if (kg) o.ml = parseML(e, kg);
  const ks = val(sp) && kxFind(val(sp), e);
  if (ks) o.spread = (ks.markets || []).map(m => ({ side: sideOf(e, (m.yes_sub_title || '').replace(/ wins? by.*$/i, '')), line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.side && x.line).sort((a, b) => a.line - b.line);
  const kt = val(to) && kxFind(val(to), e);
  if (kt) o.total = (kt.markets || []).map(m => ({ line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.line).sort((a, b) => a.line - b.line);
  o.at = Date.now(); o.found = !!(kg || ks || kt); S.odds.set(e.id, o);
}
function bsHero(e, back){
  const s = e.state !== 'pre', lines = s && (e.home.lines?.length || e.away.lines?.length);
  const side = (t, ha) => `<div class="side"><img src="${esc(t.logo)}" alt="" ${bsLogoErr}><strong><button class="linkbtn" data-bsteam="${esc(t.id)}" data-bsl="${esc(e.lg)}"${t.slug ? ` data-bsslug="${esc(t.slug)}"` : ''}>${esc(t.full || t.name)}</button></strong><small class="rec">${esc(t.record || '')}${ha ? `${t.record ? ' · ' : ''}${ha}` : ''}</small></div>`;
  const n = Math.max(e.sched || 9, e.home.lines?.length || 0, e.away.lines?.length || 0);
  const lineRow = t => `<tr><td class="t">${esc(t.abbr)}</td>${[...Array(n)].map((_, i) => `<td>${esc(t.lines?.[i] ?? '')}</td>`).join('')}<td class="pts">${esc(t.score)}</td><td>${esc(t.hits)}</td><td>${esc(t.errors)}</td></tr>`;
  const L = BSL[e.lg];
  return `<div class="hero" style="--hc:${e.ac};--ac:${e.hc}">
    ${topBar(back).replace('<div class="hero-top">', `<div class="hero-top"><div class="lgname">${L.logo ? `<img src="${esc(L.logo)}" width="16" height="16" alt="" ${bsLogoErr}>` : ''}<span>${esc(L.name)}${e.series ? ' · ' + esc(e.series) : ''}</span></div>`)}
    <div class="board">${side(e.away, 'Away')}
      <div class="score">${s ? `<div class="big num">${esc(e.away.score)}<em>–</em>${esc(e.home.score)}</div><div class="status">${e.state === 'in' ? `<span class="pill live">${esc(e.detail)}</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">${esc(e.detail)}</span>`}</div>`
        : `<div class="kick num">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="sub">${esc(e.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}${kickoffIn(e.date) ? '<br>' + kickoffIn(e.date) : ''}${e.detail ? '<br>' + esc(e.detail) : ''}</div>`}</div>
      ${side(e.home, 'Home')}</div>
    ${e.seriesStatus ? `<div class="hero-sit bs-ser">${esc(e.seriesStatus)}</div>` : ''}
    ${e.state === 'in' && e.sit ? `<div class="hero-sit bs-sit big">${bsBases(e.sit, 38)}${bsOuts(e.sit.outs)}<span class="num">${e.sit.balls}-${e.sit.strikes}</span>${e.sit.batter ? `<span>At bat: <b>${esc(e.sit.batter)}</b> · Pitching: <b>${esc(e.sit.pitcher)}</b></span>` : ''}</div>` : ''}
    ${lines ? `<div class="tbl-wrap"><table class="qtr bs-line"><thead><tr><th></th>${[...Array(n)].map((_, i) => `<th>${i + 1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>${lineRow(e.away)}${lineRow(e.home)}</tbody></table></div>` : ''}
    <div class="meta-row">${e.venue ? `<span>${esc(e.venue)}</span>` : ''}${e.tv ? `<span>TV: ${esc(e.tv)}</span>` : ''}</div></div>`;
}
const bsPlayerLink = (p, e, label) => p?.id ? `<button class="linkbtn" data-bsplayer="${esc(p.id)}" data-bsl="${esc(e.lg)}">${esc(label || p.fullName || p.name)}</button>` : esc(label || p?.fullName || p?.name || '');
function bsSummary(v){
  const e = v.e, f = v.feed;
  if (!f) return v.err ? `<div class="note">Couldn't load this game. It retries when you reopen it.</div>` : `<div class="skel" style="height:260px"></div>`;
  const plays = f.liveData?.plays?.allPlays || [], scoring = (f.liveData?.plays?.scoringPlays || []).map(i => plays[i]).filter(Boolean);
  let h = '';
  const dec = f.liveData?.decisions;
  if (dec?.winner) h += `<div class="tiles bs-dec">${[['Win', dec.winner], ['Loss', dec.loser], ['Save', dec.save]].filter(x => x[1]).map(([k, p]) => `<div class="tile"><img class="face-s" src="${esc(bsShot(p.id, BSL[e.lg].sport === 1))}" alt="" ${bsImgErr}><b>${bsPlayerLink(p, e)}</b><span>${k}</span></div>`).join('')}</div>`;
  if (v.wp?.length > 2) h += wpChart(e, v.wp.map(p => ({ homeWinPercentage: (p.homeTeamWinProbability ?? 50) / 100 })));
  const top = f.liveData?.boxscore?.topPerformers || [];
  if (top.length) h += `<div class="sub-h"><h5>Top performers</h5></div><div class="bench fb-leaders"><div>${top.map(t => { const p = t.player?.person, s = t.player?.stats;
    const line = t.type === 'pitcher' ? s?.pitching?.summary : s?.batting?.summary;
    return `<button class="ldr fbl" data-bsplayer="${esc(p?.id)}" data-bsl="${esc(e.lg)}"><span class="cat">${esc(t.type === 'pitcher' ? 'Pitcher' : t.type === 'starter' ? 'Starter' : 'Hitter')}</span><img class="face-s espn-shot" src="${esc(bsShot(p?.id, BSL[e.lg].sport === 1))}" alt="" ${bsImgErr}><span class="nm"><span>${esc(p?.fullName || '')}</span><small>${esc(line || '')}</small></span></button>` }).join('')}</div></div>`;
  h += `<div class="sub-h"><h5>Scoring plays</h5><small>${scoring.length}</small></div>${scoring.length ? `<ol class="plays">${scoring.map(p => { const t = p.about.isTopInning ? e.away : e.home;
    return `<li><img src="${esc(t.logo)}" alt="" ${bsLogoErr}><span class="pq">${p.about.isTopInning ? 'Top' : 'Bot'} ${p.about.inning}</span><span class="ptx">${esc(p.result.description)}</span><b class="num">${esc(p.result.awayScore)}–${esc(p.result.homeScore)}</b></li>` }).join('')}</ol>` : `<div class="note">${e.state === 'pre' ? 'Scoring plays appear here once the game starts.' : 'No runs yet.'}</div>`}`;
  const info = (f.liveData?.boxscore?.info || []).filter(x => x.label && x.value && /weather|wind|att|t$|first pitch|umpires|venue/i.test(x.label));
  const w = f.gameData?.weather;
  if (info.length || w?.condition) h += `<div class="sub-h"><h5>Game info</h5></div><div class="bio">${w?.condition ? `<div><span>Weather</span><strong>${esc(`${w.condition}${w.temp ? ', ' + w.temp + '°F' : ''}${w.wind ? ' · wind ' + w.wind : ''}`)}</strong></div>` : ''}${info.filter(x => !/weather|wind/i.test(x.label)).map(x => `<div><span>${esc(x.label)}</span><strong>${esc(String(x.value).replace(/\.$/, ''))}</strong></div>`).join('')}</div>`;
  return h;
}
function bsBox(v){
  const e = v.e, f = v.feed; if (!f) return `<div class="skel" style="height:260px"></div>`;
  const bx = f.liveData?.boxscore?.teams; if (!bx || !(bx.home?.batters?.length || bx.away?.batters?.length)) return `<div class="note">The box score appears once the game starts.</div>`;
  const mlb = BSL[e.lg].sport === 1;
  const tbl = (ha) => { const t = bx[ha], side = e[ha], P = id => t.players?.['ID' + id];
    const bat = (t.batters || []).map(P).filter(p => p && p.stats?.batting && (p.battingOrder || Object.keys(p.stats.batting).length));
    const pit = (t.pitchers || []).map(P).filter(Boolean);
    const bt = t.teamStats?.batting || {};
    return `<div class="sub-h"><h5><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px" ${bsLogoErr}>${esc(side.name)} batting</h5></div><div class="tbl-wrap"><table class="ctable bs-box"><thead><tr><th style="text-align:left">Batter</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th><th>HR</th><th>AVG</th><th>OPS</th></tr></thead><tbody>
      ${bat.map(p => { const s = p.stats.batting, ss = p.seasonStats?.batting || {}, sub = p.battingOrder && !String(p.battingOrder).endsWith('00');
        return `<tr><td class="t${sub ? ' bs-subrow' : ''}"><img src="${esc(bsShot(p.person.id, mlb))}" alt="" style="border-radius:50%;object-fit:cover" ${bsImgErr}>${bsPlayerLink(p.person, e, p.person.boxscoreName || p.person.fullName)} <small style="color:var(--muted)">${esc(p.position?.abbreviation || '')}</small></td>
          <td>${s.atBats ?? 0}</td><td>${s.runs ?? 0}</td><td>${s.hits ?? 0}</td><td>${s.rbi ?? 0}</td><td>${s.baseOnBalls ?? 0}</td><td>${s.strikeOuts ?? 0}</td><td>${s.homeRuns ?? 0}</td><td>${esc(ss.avg || '')}</td><td>${esc(ss.ops || '')}</td></tr>` }).join('')}
      <tr class="season"><td class="t"><b>Team</b></td><td><b>${bt.atBats ?? ''}</b></td><td><b>${bt.runs ?? ''}</b></td><td><b>${bt.hits ?? ''}</b></td><td><b>${bt.rbi ?? ''}</b></td><td><b>${bt.baseOnBalls ?? ''}</b></td><td><b>${bt.strikeOuts ?? ''}</b></td><td><b>${bt.homeRuns ?? ''}</b></td><td></td><td></td></tr></tbody></table></div>
      <div class="tbl-wrap"><table class="ctable bs-box"><thead><tr><th style="text-align:left">Pitcher</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th><th>NP</th><th>ERA</th></tr></thead><tbody>
      ${pit.map(p => { const s = p.stats.pitching || {}, ss = p.seasonStats?.pitching || {}, note = s.note || '';
        return `<tr><td class="t"><img src="${esc(bsShot(p.person.id, mlb))}" alt="" style="border-radius:50%;object-fit:cover" ${bsImgErr}>${bsPlayerLink(p.person, e, p.person.boxscoreName || p.person.fullName)} <small style="color:var(--muted)">${esc(note)}</small></td>
          <td>${esc(s.inningsPitched ?? '')}</td><td>${s.hits ?? 0}</td><td>${s.runs ?? 0}</td><td>${s.earnedRuns ?? 0}</td><td>${s.baseOnBalls ?? 0}</td><td>${s.strikeOuts ?? 0}</td><td>${s.homeRuns ?? 0}</td><td>${s.numberOfPitches ?? s.pitchesThrown ?? ''}</td><td>${esc(ss.era || '')}</td></tr>` }).join('')}</tbody></table></div>
      ${(t.info || []).filter(x => x.fieldList?.length).map(x => `<div class="bs-notes"><b>${esc(x.title)}</b>${x.fieldList.map(y => `<span><i>${esc(y.label)}:</i> ${esc(String(y.value).replace(/\.$/, ''))}</span>`).join('')}</div>`).join('')}`;
  };
  return tbl('away') + tbl('home') + `<p class="srcnote">AVG, OPS and ERA are season figures. Data from MLB StatsAPI.</p>`;
}
function bsPlays(v){
  const e = v.e, f = v.feed; if (!f) return `<div class="skel" style="height:260px"></div>`;
  const plays = (f.liveData?.plays?.allPlays || []).filter(p => p.result?.description);
  if (!plays.length) return `<div class="note">Play-by-play appears once the game starts.</div>`;
  const halves = new Map();
  for (const p of plays) { const k = `${p.about.inning}|${p.about.isTopInning ? 'top' : 'bot'}`; if (!halves.has(k)) halves.set(k, []); halves.get(k).push(p) }
  const keys = [...halves.keys()].reverse();
  return keys.map(k => { const [inn, half] = k.split('|'), t = half === 'top' ? e.away : e.home, list = halves.get(k);
    return `<div class="sub-h"><h5><img src="${esc(t.logo)}" alt="" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px" ${bsLogoErr}>${half === 'top' ? 'Top' : 'Bottom'} ${inn}</h5><small>${esc(t.name)} batting</small></div>
      <ol class="plays bs-pbp">${[...list].reverse().map(p => `<li class="${p.about.isScoringPlay ? 'score' : ''}"><span class="pq">${p.count?.outs ?? ''} out</span><span class="ptx"><strong>${esc(p.result.event || '')}</strong> ${esc(p.result.description)}</span><b class="num">${p.about.isScoringPlay ? `${esc(p.result.awayScore)}–${esc(p.result.homeScore)}` : ''}</b></li>`).join('')}</ol>` }).join('');
}
function bsMatchup(v){
  const e = v.e, f = v.feed, mlb = BSL[e.lg].sport === 1;
  let h = '';
  const sp = side => { const p = v.sp?.[side] || (e[side].sp ? { id: e[side].sp.id, name: e[side].sp.name } : null), s = p?.stat;
    if (!p) return `<div class="bs-spc"><span class="av sm" style="--av:#5C677D">?</span><div><strong>TBD</strong><small>${esc(e[side].name)} haven't named a starter</small></div></div>`;
    return `<div class="bs-spc"><img class="face" src="${esc(bsShot(p.id, mlb))}" alt="" ${bsImgErr}><div><strong>${bsPlayerLink(p, e)}</strong><small>${esc(e[side].name)}${p.hand ? ' · ' + (p.hand === 'L' ? 'Left' : 'Right') + '-handed' : ''}</small>
      ${s ? `<div class="bs-spl">${[['W-L', `${s.wins ?? 0}-${s.losses ?? 0}`], ['ERA', s.era], ['WHIP', s.whip], ['IP', s.inningsPitched], ['K', s.strikeOuts], ['BB', s.baseOnBalls], ['K/9', s.strikeoutsPer9Inn]].map(([k, x]) => `<span><b class="num">${esc(x ?? '–')}</b>${k}</span>`).join('')}</div>` : '<small>No stats this season</small>'}</div></div>` };
  h += `<div class="sub-h" style="margin-top:0"><h5>Probable starting pitchers</h5></div><div class="bs-sps">${sp('away')}${sp('home')}</div>`;
  const bx = f?.liveData?.boxscore?.teams;
  if (bx && (bx.home?.battingOrder?.length || bx.away?.battingOrder?.length)) {
    h += `<div class="sub-h"><h5>Lineups</h5></div><div class="bench">${['away', 'home'].map(ha => { const t = bx[ha];
      return `<div><div class="head"><img src="${esc(e[ha].logo)}" alt="" style="width:18px;height:18px" ${bsLogoErr}>${esc(e[ha].name)}</div><ol class="bs-lu">${(t.battingOrder || []).map(id => { const p = t.players?.['ID' + id]; if (!p) return '';
        return `<li><span class="num">${esc(p.position?.abbreviation || '')}</span>${bsPlayerLink(p.person, e)}<small>${esc(p.seasonStats?.batting?.avg || '')}${p.seasonStats?.batting?.ops ? ' · ' + esc(p.seasonStats.batting.ops) + ' OPS' : ''}</small></li>` }).join('')}</ol></div>` }).join('')}</div>`;
  } else h += `<p class="note">Lineups are usually posted a few hours before first pitch.</p>`;
  const H = bsTeamRow(e.lg, e.home.id), A = bsTeamRow(e.lg, e.away.id);
  if (H && A) { const rows = [['Record', `${A.w}-${A.l}`, `${H.w}-${H.l}`], ['Runs per game', (A.rs / Math.max(1, A.gp)).toFixed(2), (H.rs / Math.max(1, H.gp)).toFixed(2)], ['Allowed per game', (A.ra / Math.max(1, A.gp)).toFixed(2), (H.ra / Math.max(1, H.gp)).toFixed(2)],
      ['Run differential', (A.rs - A.ra > 0 ? '+' : '') + (A.rs - A.ra), (H.rs - H.ra > 0 ? '+' : '') + (H.rs - H.ra)], ...(H.home ? [['Home / away record', A.away, H.home], ['Last 10', A.l10, H.l10]] : [])];
    h += `<div class="sub-h"><h5>Season so far</h5><small>${esc(e.away.abbr)} · ${esc(e.home.abbr)}</small></div>` + rows.map(([l, a, b]) => `<div class="stat"><span class="v num">${esc(a)}</span><div><div class="lbl">${esc(l)}</div></div><span class="v num">${esc(b)}</span></div>`).join('') }
  return h;
}
function bsFsSummary(v){
  const e = v.e, d = v.fs; if (!d) return `<div class="skel" style="height:260px"></div>`;
  if (d.error) return `<div class="note">Couldn't load this game. It retries when you reopen it.</div>`;
  let h = '';
  if (d.innings?.length && !(e.home.lines?.length)) {
    e.home.lines = d.innings.map(i => i.home); e.away.lines = d.innings.map(i => i.away);
    if (d.totals) { e.home.hits = d.totals.homeHits; e.away.hits = d.totals.awayHits; e.home.errors = d.totals.homeErrors; e.away.errors = d.totals.awayErrors }
    setTimeout(renderSheet, 0);
  }
  const lu = d.lineups, dec = lu ? ['away', 'home'].flatMap(ha => lu[ha].pitchers.filter(p => p.dec).map(p => ({ ...p, side: ha }))) : [];
  if (dec.length) h += `<div class="tiles bs-dec">${dec.map(p => `<div class="tile"><b>${esc(p.name)}</b><span>${esc(p.dec.replace(/[()]/g, ''))} · ${esc(e[p.side].name)}</span></div>`).join('')}</div>`;
  const st = d.stats?.[0];
  if (st?.rows?.length) h += `<div class="sub-h"${dec.length ? '' : ' style="margin-top:0"'}><h5>Team stats</h5><small>${esc(e.away.abbr)} · ${esc(e.home.abbr)}</small></div>` + st.rows.map(r => { const a = bsNum(r.away) || 0, b = bsNum(r.home) || 0, m = Math.max(a, b, 1e-9);
    return `<div class="stat"><span class="v num ${a >= b && a ? 'lead' : ''}">${esc(r.away)}</span><div><div class="lbl">${esc(r.label)}</div><div class="bars"><span><i style="width:${a / m * 100}%;background:${e.ac}"></i></span><span><i style="width:${b / m * 100}%;background:${e.hc}"></i></span></div></div><span class="v num ${b >= a && b ? 'lead' : ''}">${esc(r.home)}</span></div>` }).join('');
  else if (e.state === 'pre') h += `<div class="note">Team stats appear once the game starts.</div>`;
  if (d.info?.venue) h += `<div class="sub-h"><h5>Game info</h5></div><div class="bio"><div><span>Venue</span><strong>${esc(d.info.venue)}${d.info.city ? ', ' + esc(d.info.city) : ''}</strong></div>${d.info.attendance ? `<div><span>Attendance</span><strong>${esc(d.info.attendance)}</strong></div>` : ''}</div>`;
  return h + `<p class="srcnote">${esc(BSL[e.lg].name)} data from Flashscore, which has scores, innings, team stats and lineups but no player box scores for this league.</p>`;
}
function bsFsLineups(v){
  const e = v.e, lu = v.fs?.lineups; if (!v.fs) return `<div class="skel" style="height:260px"></div>`;
  if (!lu || !(lu.home.batters.length || lu.away.batters.length)) return `<div class="note">Lineups appear here once they're announced, usually shortly before first pitch.</div>`;
  return `<div class="bench">${['away', 'home'].map(ha => `<div><div class="head"><img src="${esc(e[ha].logo)}" alt="" style="width:18px;height:18px" ${bsLogoErr}>${esc(e[ha].name)}${lu[ha].coach ? `<small>Manager ${esc(lu[ha].coach)}</small>` : ''}</div>
    <h5 class="bs-luh">Batters</h5><ol class="bs-lu">${lu[ha].batters.map(p => `<li class="${p.sub ? 'sub' : ''}"><span class="num">${esc(p.jersey)}</span><span>${esc(p.name)}</span><small>${esc(p.country)}</small></li>`).join('')}</ol>
    <h5 class="bs-luh">Pitchers</h5><ol class="bs-lu">${lu[ha].pitchers.map(p => `<li><span class="num">${esc(p.jersey)}</span><span>${esc(p.name)}</span><small>${esc(p.dec || p.country)}</small></li>`).join('')}</ol></div>`).join('')}</div>`;
}
function bsFsH2H(v){
  const e = v.e, d = v.fs; if (!d) return `<div class="skel" style="height:260px"></div>`;
  const gs = d.h2h || []; if (!gs.length) return `<div class="note">No previous meetings found.</div>`;
  return gs.map(g => `<div class="sub-h"><h5>${esc(g.title)}</h5><small>${g.games.length}</small></div><div class="fbsched">${g.games.slice(0, 10).map(x => `<div class="fx"><span class="d">${esc(fmtDate(new Date(x.ts * 1000), { day: 'numeric', month: 'short', year: '2-digit' }))}<br><small>${esc(x.lg)}</small></span>
    <span class="vs"><img src="${esc(x.alogo)}" alt="" ${bsLogoErr}><span>${esc(x.away)} @ ${esc(x.home)}</span><img src="${esc(x.hlogo)}" alt="" ${bsLogoErr}></span><span class="r num">${esc(x.as)}–${esc(x.hs)}${x.res ? ` <span class="res ${x.res === 'w' ? 'W' : x.res === 'l' ? 'L' : 'D'}">${esc(x.res.toUpperCase())}</span>` : ''}</span></div>`).join('')}</div>`).join('');
}
function bsBooksHTML(e, books){
  if (!books) return `<div class="sub-h"><h5>Sportsbooks</h5><small>Loading FanDuel, DraftKings, BetMGM and Fanatics…</small></div><div class="skel" style="height:140px"></div>`;
  if (!books.length) return `<div class="sub-h"><h5>Sportsbooks</h5></div><div class="note">${e.state === 'post' ? 'Betting has closed for this game.' : 'No sportsbook has posted odds for this game yet.'}</div>`;
  const best = (f) => Math.max(...books.map(f).filter(Boolean));
  const bH = best(b => b.ml?.home), bA = best(b => b.ml?.away);
  const cellD = (d, top) => d ? `<span class="bk-p${d === top ? ' best' : ''}">${bsAm(d)}</span>` : '<span class="bk-p none">–</span>';
  const mainT = b => b.total?.length ? b.total.reduce((x, y) => Math.abs(1 / y.over - 1 / y.under) < Math.abs(1 / x.over - 1 / x.under) ? y : x) : null;
  const mainS = b => b.spread?.[0] || null;
  const fair = bsBooksProb(books);
  return `<div class="sub-h"><h5>Sportsbooks</h5><small>${fair != null ? `Consensus without the margin: ${esc(e.home.abbr)} ${pct(fair)}%` : ''}</small></div>
    <div class="tbl-wrap"><table class="bk-t"><thead><tr><th></th>${books.map(b => `<th>${esc(b.name.replace(/\.us$/, ''))}</th>`).join('')}</tr></thead><tbody>
      <tr class="sec"><td colspan="${books.length + 1}">Moneyline</td></tr>
      <tr><td class="t">${esc(e.away.name)}</td>${books.map(b => `<td>${cellD(b.ml?.away, bA)}</td>`).join('')}</tr>
      <tr><td class="t">${esc(e.home.name)}</td>${books.map(b => `<td>${cellD(b.ml?.home, bH)}</td>`).join('')}</tr>
      ${books.some(mainS) ? `<tr class="sec"><td colspan="${books.length + 1}">Run line</td></tr>
      <tr><td class="t">${esc(e.away.name)}</td>${books.map(b => { const s = mainS(b); return `<td>${s ? `<span class="bk-ou"><span>${s.line > 0 ? '−' : '+'}${Math.abs(s.line)} <span class="bk-p">${bsAm(s.away)}</span></span></span>` : '–'}</td>` }).join('')}</tr>
      <tr><td class="t">${esc(e.home.name)}</td>${books.map(b => { const s = mainS(b); return `<td>${s ? `<span class="bk-ou"><span>${s.line > 0 ? '+' : '−'}${Math.abs(s.line)} <span class="bk-p">${bsAm(s.home)}</span></span></span>` : '–'}</td>` }).join('')}</tr>` : ''}
      ${books.some(mainT) ? `<tr class="sec"><td colspan="${books.length + 1}">Total runs</td></tr>
      <tr><td class="t">Over</td>${books.map(b => { const t = mainT(b); return `<td>${t ? `<span class="bk-ou"><span>${t.line} <span class="bk-p">${bsAm(t.over)}</span></span></span>` : '–'}</td>` }).join('')}</tr>
      <tr><td class="t">Under</td>${books.map(b => { const t = mainT(b); return `<td>${t ? `<span class="bk-ou"><span>${t.line} <span class="bk-p">${bsAm(t.under)}</span></span></span>` : '–'}</td>` }).join('')}</tr>` : ''}
    </tbody></table></div><p class="srcnote">Sportsbook prices via Flashscore's odds service, US market. The best moneyline price is highlighted.</p>`;
}
function bsKalshiHTML(e){
  const o = S.odds.get(e.id);
  if (!BSL[e.lg].kx) return '';
  if (!o?.at) return `<div class="skel" style="height:200px"></div>`;
  if (!o.found) return `<div class="sub-h" style="margin-top:0"><h5>Kalshi</h5></div><div class="note">${e.state === 'post' ? 'Markets for this game have closed.' : 'No Kalshi market found for this game yet.'}</div>`;
  let h = '';
  if (o.ml) h += `<div class="sub-h" style="margin-top:0"><h5>Moneyline · chance to win</h5><small>Kalshi</small></div><div class="mls" style="grid-template-columns:1fr 1fr">${['away', 'home'].map(k => { const x = o.ml[k]; if (!x) return '';
    return `<div class="ml${flashKey(e.id + k, x.p)}" style="--c:${k === 'home' ? e.hc : e.ac}"><span class="lbl">${esc(e[k].name)}</span><b class="num">${pct(x.p)}%</b><span class="am num">${american(x.p)} ${moveTag(x.p, x.prev)}</span><i style="width:${pct(x.p)}%"></i></div>` }).join('')}</div>`;
  if (o.spread?.length) h += `<div class="sub-h"><h5>Run line · win by more than</h5></div><div class="lines">${o.spread.map(x => `<div class="ln${flashKey(e.id + 's' + x.side + x.line, x.p)}"><span><b>${esc(e[x.side].abbr)} −${x.line}</b> <small>${esc(e[x.side].name)} by ${Math.ceil(x.line)}+</small></span><span class="bar"><i style="width:${pct(x.p)}%;background:${x.side === 'home' ? e.hc : e.ac}"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small> ${moveTag(x.p, x.prev)}</span></div>`).join('')}</div>`;
  if (o.total?.length) { const main = o.total.reduce((a, b) => Math.abs(b.p - .5) < Math.abs(a.p - .5) ? b : a);
    h += `<div class="sub-h"><h5>Total runs · over</h5><small>Main line ${main.line}</small></div><div class="lines">${o.total.map(x => `<div class="ln${x === main ? ' main' : ''}${flashKey(e.id + 't' + x.line, x.p)}"><span><b>Over ${x.line}</b> <small>Under ${pct(1 - x.p)}%</small></span><span class="bar"><i style="width:${pct(x.p)}%;background:var(--accent)"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small> ${moveTag(x.p, x.prev)}</span></div>`).join('')}</div>` }
  return h + `<p class="srcnote">Kalshi prices refresh every 30 seconds while this tab is open. ▲▼ show the 24-hour change.</p>`;
}
function bsPredPane(v){
  const e = v.e;
  if (!S.bsb.stand[e.lg]) { bsStandings(e.lg).then(() => renderSheet()); return `<div class="skel" style="height:260px"></div>` }
  const P = bsPredict(e, v), post = e.state === 'post', win = post ? (+e.home.score > +e.away.score ? 'home' : 'away') : null;
  return `<div class="pred-head"><div><h5>${post ? 'Pre-game prediction' : 'Floodlight prediction'}</h5><strong class="pred-pick">${esc(e[P.pick].name)} win</strong>
      <span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf} · ${pct(P.top)}%</span>${post ? `<span class="pred-out ${win === P.pick ? 'ok' : 'miss'}">${win === P.pick ? 'Called it' : 'Missed'} — final ${esc(e.away.score)}–${esc(e.home.score)}</span>` : ''}</div>
      <div class="pred-score"><small>Projected score</small><b class="num">${P.score[1]}–${P.score[0]}</b><small>${esc(e.away.abbr)} – ${esc(e.home.abbr)}</small></div></div>
    <div class="pbar" role="img" aria-label="${esc(`${e.away.name} ${pct(1 - P.pH)} percent, ${e.home.name} ${pct(P.pH)} percent`)}"><i style="flex-grow:${1 - P.pH};background:${e.ac}"><span>${pct(1 - P.pH)}%</span></i><i style="flex-grow:${P.pH};background:${e.hc}"><span>${pct(P.pH)}%</span></i></div>
    <div class="pred-legend"><span><i style="background:${e.ac}"></i>${esc(e.away.name)}</span><span><i style="background:${e.hc}"></i>${esc(e.home.name)}</span></div>
    <div class="tiles pred-tiles"><div class="tile"><b class="num">${P.total.toFixed(1)}</b><span>Projected total ${e.src === 'bb' ? 'points' : 'runs'}</span></div>
      <div class="tile"><b class="num">${P.rA.toFixed(1)}–${P.rH.toFixed(1)}</b><span>Model ${e.src === 'bb' ? 'points' : 'runs'} ${esc(e.away.abbr)}–${esc(e.home.abbr)}</span></div>
      <div class="tile"><b class="num">${P.market != null ? pct(P.market) + '%' : P.books != null ? pct(P.books) + '%' : '–'}</b><span>${esc(e.home.abbr)} ${P.market != null ? 'on Kalshi' : 'at the books'}</span></div></div>
    <div class="sub-h"><h5>Why</h5></div><ul class="why">${bsReasons(e, P, v).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="srcnote">Model: each team's runs scored and allowed per game (shrunk toward the league average early in the season), the probable starters' ERA and FIP, and home field. The shown chance weighs the betting market (Kalshi, or the sportsbooks' consensus) at 60% and the model at 40% when a market exists.</p>${RG}`;
}
function bsGamePane(v){
  const e = v.e;
  if (v.tab === 'pred') return bsPredPane(v);
  if (v.tab === 'odds') return bsKalshiHTML(e) + bsBooksHTML(e, v.books);
  if (v.tab === 'stand') return bsStandingsHTML(e.lg, [e.home.id, e.away.id]);
  if (e.src === 'bb') return bsBbSummary(v);
  if (e.src === 'fs') return v.tab === 'lineups' ? bsFsLineups(v) : v.tab === 'h2h' ? bsFsH2H(v) : bsFsSummary(v);
  if (v.tab === 'box') return bsBox(v);
  if (v.tab === 'plays') return bsPlays(v);
  if (v.tab === 'matchup') return bsMatchup(v);
  return bsSummary(v);
}

/* ---------- team pages ---------- */
const bsSlug = s => normName(s || '').replace(/\s+/g, '-');
function openBsTeam(id, lg, slug){
  if (!id || !BSL[lg]) return;
  pushView({ type: 'bsbteam', id: String(id), lg, slug: slug || '', tab: 'sched' });
  const v = S.stack[S.stack.length - 1], l = BSL[lg], rr = () => S.stack.includes(v) && renderSheet();
  if (l.src === 'bb') return openBsBbTeam(v);
  bsStandings(lg).then(rr);
  if (l.src === 'fs') {
    const sl = v.slug || bsSlug(bsTeamRow(lg, id)?.name || '');
    getJSON(`/api/bsb/team?id=${id}&slug=${sl}`).then(d => { v.fsTeam = d; v.team = { id, name: d.name, logo: d.logo || bsFsLogo(lg, id) } }).catch(() => { v.err = true }).finally(rr);
    if (l.kx) bsLoadFutures().then(rr);
    return;
  }
  const season = bsSeason(lg); v.season = season;
  Promise.allSettled([cj(`${SA}/teams/${id}?hydrate=league,division,venue,sport`),
    cj(`${SA}/schedule?teamId=${id}&season=${season}&sportId=${l.sport}&gameType=R,F,D,L,W,C,P&hydrate=team,linescore,decisions`)]).then(([t, s]) => {
    v.team = val(t)?.teams?.[0]; v.sched = val(s); if (!v.team) v.err = true; rr() });
  bsRoster(v);
  if (l.kx) bsLoadFutures().then(rr);
}
async function bsRoster(v, kind){
  const l = BSL[v.lg], season = v.season;
  v.rosterKind = kind || v.rosterKind || 'active';
  // the chosen list first, then the others so there is always something to show
  const order = [v.rosterKind, ...['active', '40Man', 'fullSeason'].filter(t => t !== v.rosterKind)];
  for (const type of order) {
    try { const d = await cj(`${SA}/teams/${v.id}/roster?rosterType=${type}&season=${season}&hydrate=person(stats(type=season,season=${season},sportId=${l.sport},group=[hitting,pitching]))`);
      if (d.roster?.length) { v.roster = d.roster; v.rosterType = type; break } } catch {}
  }
  v.roster ||= []; if (S.stack.includes(v)) renderSheet();
}
const BS_ROSTERS = [['active', 'Active'], ['40Man', '40-man'], ['fullSeason', 'Everyone this season']];
async function bsTeamStats(lg, season){
  const k = `${lg}|${season}`; if (S.bsb.teamStats[k]) return S.bsb.teamStats[k];
  const l = BSL[lg];
  const [h, p] = await Promise.allSettled(['hitting', 'pitching'].map(g => cj(`${SA}/teams/stats?stats=season&group=${g}&season=${season}&sportIds=${l.sport}`)));
  const ids = new Set((S.bsb.stand[lg] || []).flatMap(g => g.entries.map(x => String(x.id))));
  const keep = d => (val(d)?.stats?.[0]?.splits || []).filter(s => !ids.size || ids.has(String(s.team?.id)));
  return S.bsb.teamStats[k] = { hitting: keep(h), pitching: keep(p) };
}
function bsTeamHero(v, back){
  const t = v.team, l = BSL[v.lg], row = t ? bsTeamRow(v.lg, v.id) : null, c = bsColorFor({ id: +v.id }, t?.name);
  const col = hex('#' + c.color) && lum(hex('#' + c.color)) > .03 ? '#' + c.color : hex('#' + (c.alt || '')) || '#3D6FD9'; v.color = col;
  const favId = `bs-${v.lg}-${v.id}`, logo = l.src === 'bb' ? (t?.logo || '') : l.src === 'fs' ? (t?.logo || bsFsLogo(v.lg, v.id)) : bsLogo(v.id);
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead">${t ? `<img class="crest" src="${esc(logo)}" alt="" ${bsLogoErr}>` : ''}<div><h3>${esc(t?.name || 'Loading…')}</h3>
    <p>${row ? `<span>${row.w}-${row.l}</span>` : ''}${row?.group || t?.division?.name ? `<span>${esc(t?.division?.name || row.group)}</span>` : ''}<span>${esc(l.name)}</span>${t?.venue?.name ? `<span>${esc(t.venue.name)}</span>` : ''}${v.fsTeam?.coach ? `<span>Manager ${esc(v.fsTeam.coach)}</span>` : ''}</p>
    ${t ? `<button class="favbtn" data-bsact="fav" aria-pressed="${S.fav.some(f => f.id === favId)}">${S.fav.some(f => f.id === favId) ? '★ Following' : '☆ Follow'}</button>` : ''}</div></div>
    ${row ? `<div class="tiles"><div class="tile"><b class="num">${row.w}-${row.l}</b><span>Record${row.pct ? ' · ' + esc(row.pct) : ''}</span></div><div class="tile"><b class="num">${(row.rs / Math.max(1, row.gp)).toFixed(2)}</b><span>${l.src === 'bb' ? 'Points' : 'Runs'} a game</span></div><div class="tile"><b class="num">${(row.ra / Math.max(1, row.gp)).toFixed(2)}</b><span>Allowed a game</span></div><div class="tile"><b class="num">${row.rs - row.ra > 0 ? '+' : ''}${row.rs - row.ra}</b><span>${l.src === 'bb' ? 'Point' : 'Run'} differential</span></div></div>` : ''}</div>`;
}
function bsSchedRow(v, e){
  // e: { id, date, home{id,name,logo,score}, away{...}, state, detail }
  const me = e.home.id === v.id ? 'home' : 'away', op = me === 'home' ? e.away : e.home;
  const won = e.state === 'post' && +e[me].score > +op.score, lost = e.state === 'post' && +e[me].score < +op.score;
  return `<button class="fx bs-fx" data-bsgameid="${esc(e.id)}"><span class="d">${esc(fmtDate(e.date))}${e.tag ? `<br><small>${esc(e.tag)}</small>` : ''}</span><span class="vs"><small>${me === 'home' ? 'vs' : '@'}</small><img src="${esc(op.logo)}" alt="" ${bsLogoErr}><span>${esc(op.name)}</span></span>
    <span class="r num">${e.state === 'post' ? `${esc(e[me].score)}–${esc(op.score)} <span class="res ${won ? 'W' : lost ? 'L' : 'D'}">${won ? 'W' : lost ? 'L' : 'T'}</span>` : e.state === 'in' ? `<span class="pill live">${esc(e[me].score)}–${esc(op.score)}</span>` : esc(e.detail || e.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span></button>`;
}
function bsRosterGroup(pos){ const a = pos?.abbreviation, t = pos?.type; return t === 'Pitcher' || a === 'P' ? 'Pitchers' : a === 'C' ? 'Catchers' : /^(1B|2B|3B|SS|IF)$/.test(a) ? 'Infielders' : /^(LF|CF|RF|OF)$/.test(a) ? 'Outfielders' : a === 'TWP' ? 'Two-way players' : 'Designated hitters & others' }
function bsTeamPane(v){
  const l = BSL[v.lg];
  if (v.err) return `<div class="note">Couldn't load this team.</div>`;
  if (!v.team) return `<div class="skel" style="height:260px"></div>`;
  if (v.tab === 'stand') return bsStandingsHTML(v.lg, [v.id]);
  if (v.tab === 'fut') return bsTeamFutures(v);
  if (l.src === 'bb') return bsBbTeamPane(v);
  if (l.src === 'fs') {
    const d = v.fsTeam;
    if (v.tab === 'sched') {
      const evs = [...(d.fixtures || []).slice(0, 15).reverse(), ...(d.results || [])].map(x => { const e = bsFsNorm(x, x.lg || v.lg); e.tag = x.lgName || ''; (S.bsb.extra ||= new Map()).set(e.id, e); return e });
      return evs.length ? `<div class="fbsched">${evs.map(e => bsSchedRow(v, e)).join('')}</div>` : `<div class="note">No games found.</div>`;
    }
    if (v.tab === 'roster') {
      if (l.x) { const h = bsXRoster(v); if (h != null) return h }
      const r = d.roster || []; if (!r.length) return `<div class="note">No recent lineups to build a roster from.</div>`;
      const grp = [['Pitchers', r.filter(p => p.role !== 'B')], ['Position players', r.filter(p => p.role === 'B')]];
      return grp.map(([t, list]) => list.length ? `<div class="sub-h"><h5>${t}</h5><small>${list.length}</small></div>` + list.sort((a, b) => b.games - a.games).map(p => `<div class="prow ph"><b>${esc(p.jersey || '–')}</b><span class="av sm" style="--av:${esc(v.color || '#5C677D')}">${esc(initials(p.name))}</span>
        <span class="nm"><span>${esc(p.name)}</span><small>${esc([p.country, `in ${p.games} of the last ${Math.min(6, d.results.length)} lineups`].filter(Boolean).join(' · '))}</small></span><span class="st2"></span></div>`).join('') : '').join('')
        + `<p class="srcnote">Flashscore publishes lineups but no squads or player stats for ${esc(l.name)}, so this roster lists everyone in the team's last six lineups.</p>`;
    }
    return '';
  }
  if (v.tab === 'sched') {
    const games = (v.sched?.dates || []).flatMap(d => d.games || []);
    if (!games.length) return `<div class="note">No ${v.season} schedule published.</div>`;
    const evs = games.map(g => { const e = bsSaNorm(g, l); e.tag = /^[FDLWC]$/.test(g.gameType) ? (g.seriesDescription || 'Postseason') : ''; (S.bsb.extra ||= new Map()).set(e.id, e); return e });
    const next = evs.filter(e => e.state !== 'post'), done = evs.filter(e => e.state === 'post').reverse();
    return (next.length ? `<div class="sub-h" style="margin-top:0"><h5>Upcoming</h5><small>${next.length}</small></div><div class="fbsched">${next.slice(0, 20).map(e => bsSchedRow(v, e)).join('')}</div>` : '')
      + `<div class="sub-h"${next.length ? '' : ' style="margin-top:0"'}><h5>Results</h5><small>${done.length} games</small></div><div class="fbsched">${done.map(e => bsSchedRow(v, e)).join('')}</div>`;
  }
  if (v.tab === 'roster') {
    if (!v.roster) return `<div class="skel" style="height:260px"></div>`;
    const rpick = l.sport === 1 ? `<div class="quick" role="group" aria-label="Which roster">${BS_ROSTERS.map(([k, n]) => `<button class="qf" data-bsact="rkind" data-to="${k}" aria-pressed="${(v.rosterKind || 'active') === k}">${n}</button>`).join('')}</div>` : '';
    if (!v.roster.length) return rpick + `<div class="note">No roster published.</div>`;
    const order = ['Pitchers', 'Catchers', 'Infielders', 'Outfielders', 'Two-way players', 'Designated hitters & others'], groups = {};
    for (const r of v.roster) (groups[bsRosterGroup(r.position)] ||= []).push(r);
    const mlb = l.sport === 1;
    const line = (p, pit) => { const st = (p.stats || []).find(s => s.group?.displayName === (pit ? 'pitching' : 'hitting'))?.splits?.[0]?.stat; if (!st) return '';
      return pit ? `${st.wins ?? 0}-${st.losses ?? 0} · ${st.era ?? '–'} ERA · ${st.strikeOuts ?? 0} K` : `${st.avg ?? '–'} · ${st.homeRuns ?? 0} HR · ${st.rbi ?? 0} RBI · ${st.ops ?? '–'} OPS` };
    return rpick + order.filter(g => groups[g]).map(g => `<div class="sub-h"><h5>${g}</h5><small>${groups[g].length}</small></div>` + groups[g].sort((a, b) => (a.person.lastName || '').localeCompare(b.person.lastName || '')).map(r => { const p = r.person, pit = g === 'Pitchers';
      return `<button class="prow ph${/injur|IL/i.test(r.status?.description || '') ? ' out' : ''}" data-bsplayer="${esc(p.id)}" data-bsl="${esc(v.lg)}"><b>${esc(r.jerseyNumber || '–')}</b><img class="face-s espn-shot" src="${esc(bsShot(p.id, mlb))}" alt="" loading="lazy" ${bsImgErr}>
        <span class="nm"><span>${esc(p.fullName)}</span>${r.status?.code && r.status.code !== 'A' ? ` <span class="stat-badge injured">${esc(r.status.description)}</span>` : ''}<small>${esc([r.position?.abbreviation, p.currentAge ? p.currentAge + ' yrs' : '', p.height, p.weight ? p.weight + ' lb' : '', p.batSide?.code && p.pitchHand?.code ? `B/T ${p.batSide.code}/${p.pitchHand.code}` : ''].filter(Boolean).join(' · '))}</small></span>
        <span class="st2 bs-rl">${esc(line(p, pit))}</span></button>` }).join('')).join('')
      + `<p class="srcnote">${v.rosterType === 'active' ? 'Active roster' : v.rosterType === '40Man' ? '40-man roster' : 'Everyone who played for the team this season'}, ${v.season} season stats. Tap a player for every stat and his league ranks.</p>`;
  }
  if (v.tab === 'stats') {
    const k = `${v.lg}|${v.season}`, ts = S.bsb.teamStats[k];
    if (!ts) { bsTeamStats(v.lg, v.season).then(() => renderSheet()); return `<div class="skel" style="height:300px"></div>` }
    return ['hitting', 'pitching'].map(g => { const all = ts[g], mine = all.find(s => String(s.team?.id) === v.id); if (!mine) return '';
      const keys = BS_TEAM_KEYS[g].filter(kk => mine.stat[kk] != null);
      return `<div class="sub-h"><h5>${g === 'hitting' ? 'Hitting' : 'Pitching'}</h5><small>rank among ${all.length} teams</small></div>` + keys.map(kk => { const x = bsNum(mine.stat[kk]), low = BS_LOW[g].has(kk);
        const better = all.filter(s => { const y = bsNum(s.stat[kk]); return y != null && (low ? y < x : y > x) }).length, rank = better + 1, pc = all.length > 1 ? Math.round(100 * (all.length - rank) / (all.length - 1)) : null, cls = pc == null ? '' : pc >= 70 ? 'hi' : pc < 30 ? 'lo' : '';
        return `<div class="fbps-row"><span class="ps-t">${esc(bsLabel(g, kk))}</span><b class="num">${esc(mine.stat[kk])}</b><span class="num ps-90"></span><span class="fbps-rk"><b class="num">${fbOrd(rank)}</b><small>/${all.length}</small></span><span class="ps-bar-c"><span class="ps-bar"><i class="${cls}" style="width:${Math.max(2, pc ?? 0)}%"></i></span></span><span class="num ps-p ${cls}">${pc ?? ''}</span></div>` }).join('') }).join('')
      + `<p class="srcnote">${v.season} season. Rank 1 = best in the league (for ERA, WHIP and runs allowed, lower is better). Data from MLB StatsAPI.</p>`;
  }
  return '';
}
const BS_TEAM_KEYS = { hitting: ['runs', 'hits', 'homeRuns', 'avg', 'obp', 'slg', 'ops', 'doubles', 'triples', 'rbi', 'baseOnBalls', 'strikeOuts', 'stolenBases', 'leftOnBase', 'babip'],
  pitching: ['era', 'whip', 'runs', 'earnedRuns', 'strikeOuts', 'baseOnBalls', 'homeRuns', 'hits', 'saves', 'blownSaves', 'strikeoutsPer9Inn', 'walksPer9Inn', 'avg', 'shutouts', 'completeGames'] };
function bsTeamFutures(v){
  const F = S.bsb.futures; if (!F) return `<div class="skel" style="height:200px"></div>`;
  const name = v.team?.name || '', short = v.team?.teamName || v.team?.clubName || '';
  const rows = F.groups.filter(g => g.lg === v.lg && !BS_PLAYER_FUT.has(g.series)).map(g => { const r = g.rows.find(x => teamSim(x.name, name) >= .6 || (short && teamSim(x.name, short) >= .85) || (v.team?.locationName && teamSim(x.name, v.team.locationName) >= .85)); return r ? { g, r } : null }).filter(Boolean);
  if (!rows.length) return `<div class="note">Kalshi has no title markets for this team right now.</div>`;
  return `<div class="tiles" style="grid-template-columns:repeat(${Math.min(4, rows.length)},minmax(0,1fr))">${rows.map(({ g, r }) => `<div class="tile"><b class="num">${r.p < .01 ? '<1' : pct(r.p)}%</b><span>${esc(g.label)}</span>${r.prev != null ? `<div style="margin-top:6px">${moveTag(r.p, r.prev)}</div>` : ''}</div>`).join('')}</div>
    <p class="srcnote">Live Kalshi prices; 25¢ means the market gives a 25% chance.</p>${RG}`;
}

/* ---------- player pages: every stat, per game, rank and percentile in the league ---------- */
const BS_LABEL = {
  hitting: { gamesPlayed: 'Games', plateAppearances: 'Plate appearances', atBats: 'At bats', runs: 'Runs', hits: 'Hits', doubles: 'Doubles', triples: 'Triples', homeRuns: 'Home runs', rbi: 'Runs batted in', baseOnBalls: 'Walks',
    intentionalWalks: 'Intentional walks', strikeOuts: 'Strikeouts', hitByPitch: 'Hit by pitch', stolenBases: 'Stolen bases', caughtStealing: 'Caught stealing', stolenBasePercentage: 'Stolen-base %', avg: 'Batting average (AVG)',
    obp: 'On-base % (OBP)', slg: 'Slugging (SLG)', ops: 'OPS', babip: 'BABIP', totalBases: 'Total bases', groundIntoDoublePlay: 'Grounded into double plays', leftOnBase: 'Left on base', sacBunts: 'Sacrifice bunts', sacFlies: 'Sacrifice flies',
    atBatsPerHomeRun: 'At bats per home run', groundOutsToAirouts: 'Ground outs per fly out', numberOfPitches: 'Pitches seen', groundOuts: 'Ground outs', airOuts: 'Fly outs', catchersInterference: "Catcher's interference" },
  pitching: { gamesPlayed: 'Games', gamesStarted: 'Games started', wins: 'Wins', losses: 'Losses', winPercentage: 'Win %', era: 'ERA', whip: 'WHIP', inningsPitched: 'Innings pitched', saves: 'Saves', saveOpportunities: 'Save chances', holds: 'Holds',
    blownSaves: 'Blown saves', strikeOuts: 'Strikeouts', baseOnBalls: 'Walks', hits: 'Hits allowed', runs: 'Runs allowed', earnedRuns: 'Earned runs', homeRuns: 'Home runs allowed', hitByPitch: 'Hit batters', avg: 'Opponent AVG', obp: 'Opponent OBP',
    slg: 'Opponent SLG', ops: 'Opponent OPS', strikeoutsPer9Inn: 'Strikeouts per 9', walksPer9Inn: 'Walks per 9', hitsPer9Inn: 'Hits per 9', homeRunsPer9: 'Home runs per 9', runsScoredPer9: 'Runs per 9', strikeoutWalkRatio: 'Strikeout-to-walk',
    completeGames: 'Complete games', shutouts: 'Shutouts', battersFaced: 'Batters faced', numberOfPitches: 'Pitches', pitchesPerInning: 'Pitches per inning', strikePercentage: 'Strike %', wildPitches: 'Wild pitches', balks: 'Balks',
    gamesFinished: 'Games finished', inheritedRunners: 'Inherited runners', inheritedRunnersScored: 'Inherited runners scored', groundOutsToAirouts: 'Ground outs per fly out', stolenBases: 'Stolen bases allowed', caughtStealing: 'Runners caught stealing',
    intentionalWalks: 'Intentional walks', sacBunts: 'Sacrifice bunts allowed', sacFlies: 'Sacrifice flies allowed', groundIntoDoublePlay: 'Double plays induced', pickoffs: 'Pickoffs', gamesPitched: 'Games pitched', outs: 'Outs recorded',
    doubles: 'Doubles allowed', triples: 'Triples allowed', atBats: 'At bats against', totalBases: 'Total bases allowed', strikes: 'Strikes', balls: 'Balls', hitBatsmen: 'Hit batters', catchersInterference: "Catcher's interference", babip: 'Opponent BABIP' },
  extra: { walkOffs: 'Walk-offs', ballFourSprints: 'Ball-four sprints', goldenBatters: 'Golden batter picks', showdownWalkOffs: 'Showdown walk-offs', foulOutsToFans: 'Foul balls caught by fans (outs)',
    sprintsAllowed: 'Ball-four sprints allowed', walkOffsAllowed: 'Walk-offs allowed', fip: 'FIP', opsPlus: 'OPS+', woba: 'wOBA', iso: 'Isolated power (ISO)', wpa: 'Win probability added', kPct: 'Strikeout %', bbPct: 'Walk %',
    risp: 'AVG with runners in scoring position', qualityStarts: 'Quality starts', errors: 'Errors' },
  fielding: { gamesPlayed: 'Games', gamesStarted: 'Games started', innings: 'Innings', chances: 'Chances', putOuts: 'Putouts', assists: 'Assists', errors: 'Errors', fielding: 'Fielding %', doublePlays: 'Double plays', triplePlays: 'Triple plays',
    rangeFactorPerGame: 'Range factor per game', rangeFactorPer9Inn: 'Range factor per 9', throwingErrors: 'Throwing errors', passedBall: 'Passed balls', stolenBases: 'Stolen bases allowed', caughtStealing: 'Runners caught stealing', wildPitches: 'Wild pitches', pickoffs: 'Pickoffs' },
};
const bsLabel = (g, k) => BS_LABEL[g]?.[k] || BS_LABEL.extra[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const BS_SKIP = new Set(['age', 'summary', 'stolenBasePercentage_', 'caughtStealingPercentage', 'position', 'type', 'note', 'flyOuts', 'popOuts', 'lineOuts', 'groundOutsToAirouts_', 'numberOfPitches_']);
const BS_RATE = new Set(['fip', 'opsPlus', 'woba', 'iso', 'wpa', 'kPct', 'bbPct', 'risp', 'avg', 'obp', 'slg', 'ops', 'babip', 'era', 'whip', 'winPercentage', 'strikeoutsPer9Inn', 'walksPer9Inn', 'hitsPer9Inn', 'homeRunsPer9', 'runsScoredPer9', 'strikeoutWalkRatio', 'pitchesPerInning', 'strikePercentage',
  'stolenBasePercentage', 'atBatsPerHomeRun', 'groundOutsToAirouts', 'fielding', 'rangeFactorPerGame', 'rangeFactorPer9Inn']);
const BS_LOW = { hitting: new Set(['strikeOuts', 'caughtStealing', 'groundIntoDoublePlay', 'leftOnBase', 'atBatsPerHomeRun', 'foulOutsToFans', 'errors']),
  pitching: new Set(['fip', 'bbPct', 'sprintsAllowed', 'walkOffsAllowed', 'era', 'whip', 'losses', 'baseOnBalls', 'hits', 'runs', 'earnedRuns', 'homeRuns', 'hitByPitch', 'avg', 'obp', 'slg', 'ops', 'walksPer9Inn', 'hitsPer9Inn', 'homeRunsPer9', 'runsScoredPer9', 'blownSaves', 'wildPitches', 'balks',
    'inheritedRunnersScored', 'stolenBases', 'pitchesPerInning', 'doubles', 'triples', 'totalBases', 'babip', 'intentionalWalks', 'hitBatsmen']), fielding: new Set(['errors', 'throwingErrors', 'passedBall']) };
const BS_FIRST = { hitting: ['gamesPlayed', 'plateAppearances', 'atBats', 'avg', 'obp', 'slg', 'ops', 'hits', 'homeRuns', 'rbi', 'runs', 'doubles', 'triples', 'baseOnBalls', 'strikeOuts', 'stolenBases', 'caughtStealing', 'totalBases', 'babip'],
  pitching: ['gamesPlayed', 'gamesStarted', 'wins', 'losses', 'era', 'whip', 'inningsPitched', 'strikeOuts', 'baseOnBalls', 'strikeoutsPer9Inn', 'walksPer9Inn', 'strikeoutWalkRatio', 'saves', 'holds', 'hits', 'earnedRuns', 'homeRuns', 'avg', 'ops'],
  fielding: ['gamesPlayed', 'innings', 'chances', 'putOuts', 'assists', 'errors', 'fielding', 'doublePlays'] };
const BS_KEY = { hitting: { tiles: ['avg', 'homeRuns', 'rbi', 'ops'], radar: [['avg', 'AVG'], ['obp', 'OBP'], ['slg', 'Power'], ['homeRuns', 'HR'], ['stolenBases', 'Speed'], ['strikeOuts', 'Avoids K']] },
  pitching: { tiles: ['era', 'wins', 'strikeOuts', 'whip'], radar: [['era', 'ERA'], ['whip', 'WHIP'], ['strikeoutsPer9Inn', 'K/9'], ['walksPer9Inn', 'Control'], ['homeRunsPer9', 'Limits HR'], ['avg', 'Opp. AVG']] } };
const BS_TILE = { avg: 'AVG', homeRuns: 'HR', rbi: 'RBI', ops: 'OPS', era: 'ERA', wins: 'Wins', strikeOuts: 'Strikeouts', whip: 'WHIP' };

const bsPools = new Map();
function bsPool(lg, season, group){
  const l = BSL[lg], key = `${lg}|${season}|${group}`;
  if (!bsPools.has(key)) bsPools.set(key, getJSON(`${SA}/stats?stats=season&group=${group}&season=${season}&sportId=${l.sport}${l.league ? '&leagueIds=' + l.league : ''}&playerPool=ALL&limit=4000`).then(d =>
    (d.stats?.[0]?.splits || []).map(s => ({ id: String(s.player?.id), pos: s.position?.abbreviation, s: s.stat })))
    .catch(() => { bsPools.delete(key); return null }));
  return bsPools.get(key);
}
// peers: hitters by plate appearances, pitchers by role (starter or reliever) and innings, both at least 40% of the busiest
function bsPeers(pool, group, me){
  if (!pool) return null;
  if (group === 'hitting') { const xs = pool.filter(p => p.pos !== 'P'), max = Math.max(0, ...xs.map(p => p.s.plateAppearances || 0)); return xs.filter(p => (p.s.plateAppearances || 0) >= Math.max(10, max * .4)) }
  if (group === 'pitching') { const sp = s => (s.gamesStarted || 0) >= (s.gamesPlayed || s.gamesPitched || 1) / 2, role = me ? sp(me) : true;
    const xs = pool.filter(p => sp(p.s) === role), max = Math.max(0, ...xs.map(p => bsIP(p.s.inningsPitched) || 0)); return xs.filter(p => (bsIP(p.s.inningsPitched) || 0) >= Math.max(5, max * .4)) }
  const max = Math.max(0, ...pool.map(p => p.s.gamesPlayed || 0)); return pool.filter(p => (p.s.gamesPlayed || 0) >= Math.max(5, max * .4));
}
function bsRankIn(peers, group, key, me, id){
  if (!peers || me?.[key] == null) return null;
  const rate = BS_RATE.has(key), low = BS_LOW[group]?.has(key), gp = me.gamesPlayed || 0;
  const metric = s => { const x = key === 'inningsPitched' ? bsIP(s[key]) : bsNum(s[key]); if (x == null) return null; return rate ? x : (s.gamesPlayed ? x / s.gamesPlayed : null) };
  const mine = metric(me); if (mine == null || (!rate && !gp)) return null;
  const vals = []; for (const p of peers) { if (p.id === String(id)) continue; const m = metric(p.s); if (m != null) vals.push(m) }
  if (vals.length < 8) return null;
  let better = 0, worse = 0; for (const m of vals) { if (low ? m < mine - 1e-9 : m > mine + 1e-9) better++; else if (low ? m > mine + 1e-9 : m < mine - 1e-9) worse++ }
  return { rank: better + 1, n: vals.length + 1, pc: Math.round(100 * (worse + (vals.length - better - worse) / 2) / vals.length), perGame: !rate };
}
function openBsPlayer(id, lg, group){
  if (!id) return;
  if (lg === 'bbcl') return openBsBbPlayer(id, group);
  if (BSL[lg]?.x) return openBsXPlayer(id, lg, group);
  pushView({ type: 'bsbplayer', id: String(id), lg: BSL[lg] ? lg : 'mlb', tab: 'stats' });
  const v = S.stack[S.stack.length - 1], rr = () => S.stack.includes(v) && renderSheet();
  cj(`${SA}/people/${id}?hydrate=currentTeam,team`).then(d => {
    v.bio = d.people?.[0]; if (!v.bio) { v.err = true; return rr() }
    const pos = v.bio.primaryPosition || {};
    v.groups = pos.abbreviation === 'TWP' ? ['hitting', 'pitching'] : pos.type === 'Pitcher' ? ['pitching'] : ['hitting'];
    v.grp = v.groups[0];
    // the league the player is in now, if the page was opened from somewhere generic
    const t = v.bio.currentTeam; if (t?.sport?.id && BSL[v.lg].sport !== t.sport.id) { const l2 = BS_LEAGUES.find(l => l.src === 'sa' && l.sport === t.sport.id && (!l.league || l.league === t.league?.id)); if (l2 && v.fromSearch) v.lg = l2.key }
    bsCareer(v).then(() => { const yrs = v.years || []; bsPlayerSeason(v, yrs.includes(bsSeason(v.lg)) ? bsSeason(v.lg) : yrs[0] || bsSeason(v.lg)) });
    rr();
  }).catch(() => { v.err = true; rr() });
}
async function bsCareer(v){
  const groups = [...new Set([...v.groups, 'hitting'])].filter(g => g !== 'hitting' || v.groups.includes('hitting'));
  const sports = [1, 11, 12, 13, 14, 16, 17, 23, 51];
  const res = await Promise.allSettled(sports.map(sp => cj(`${SA}/people/${v.id}/stats?stats=yearByYear&group=${v.groups.join(',')}&sportId=${sp}`)));
  v.career = {}; const yrs = new Set();
  res.forEach((r, i) => { for (const s of val(r)?.stats || []) { const g = s.group?.displayName; for (const x of s.splits || []) { (v.career[g] ||= []).push({ ...x, sportId: sports[i] }); if (sports[i] === BSL[v.lg].sport && (!BSL[v.lg].league || x.league?.id === BSL[v.lg].league)) yrs.add(+x.season) } } });
  for (const g in v.career) v.career[g].sort((a, b) => b.season - a.season || a.sportId - b.sportId);
  v.years = [...yrs].sort((a, b) => b - a);
  if (!v.years.length) { const any = Object.values(v.career).flat()[0]; if (any) { const l2 = BS_LEAGUES.find(l => l.src === 'sa' && l.sport === any.sportId && (!l.league || l.league === any.league?.id)); if (l2) { v.lg = l2.key; return bsCareer(v) } } }
  void groups;
}
function bsPlayerSeason(v, yr){
  v.season = yr; v.ss ||= {}; if (v.ss[yr]) return renderSheet();
  const l = BSL[v.lg], ss = v.ss[yr] = { loading: true };
  Promise.allSettled([cj(`${SA}/people/${v.id}/stats?stats=season,gameLog&group=hitting,pitching,fielding&season=${yr}&sportId=${l.sport}${l.league ? '&leagueListId=' : ''}`),
    ...v.groups.map(g => bsPool(v.lg, yr, g))]).then(([st, ...pools]) => {
    const all = val(st)?.stats || [];
    ss.season = {}; ss.log = {}; ss.fielding = [];
    for (const s of all) { const g = s.group?.displayName, t = s.type?.displayName;
      const sp = (s.splits || []).filter(x => !l.league || !x.league || x.league.id === l.league);
      if (t === 'season') { if (g === 'fielding') ss.fielding = sp; else { const tot = sp.find(x => !x.team) || (sp.length > 1 ? null : sp[0]) || sp[0]; if (tot) ss.season[g] = tot.stat; ss.teams = sp.filter(x => x.team).map(x => x.team) } }
      if (t === 'gameLog') ss.log[g] = sp }
    ss.peers = {}; v.groups.forEach((g, i) => { ss.peers[g] = bsPeers(val(pools[i]), g, ss.season[g]) });
    ss.loading = false; if (S.stack.includes(v)) renderSheet() });
  renderSheet();
}
function bsPlayerHero(v, back){
  const a = v.bio, t = a?.currentTeam, c = bsColorFor(t, t?.name), col = (() => { const x = hex('#' + c.color); return x && lum(x) > .03 ? x : hex('#' + (c.alt || '')) || '#3D6FD9' })(); v.color = col;
  const ss = v.ss?.[v.season], g = v.grp, st = ss?.season?.[g], mlb = BSL[v.lg].sport === 1 || t?.sport?.id === 1;
  let tiles = '';
  if (st) tiles = `<div class="tiles">${BS_KEY[g].tiles.map(k => { if (st[k] == null) return ''; const r = bsRankIn(ss.peers?.[g], g, k, st, v.id);
      return `<div class="tile"><b class="num">${esc(st[k])}</b><span>${BS_TILE[k]}</span>${r ? `<em class="fbt-rk">${fbOrd(r.rank)} of ${r.n}${r.perGame ? ' · per game' : ''}</em>` : ''}</div>` }).join('')}</div>
    <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(v.season)} · ${esc(BSL[v.lg].name)} · ${st.gamesPlayed || 0} games${ss.peers?.[g] ? ` · ranked among ${ss.peers[g].length} ${g === 'pitching' ? ((st.gamesStarted || 0) >= (st.gamesPlayed || 1) / 2 ? 'starting pitchers' : 'relievers') : 'regular hitters'}` : ''}</p>`;
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(a ? bsShot(a.id, mlb) : SIL)}" alt="" ${bsImgErr}><div><h3>${esc(a?.fullName || 'Loading…')}</h3>
    ${a ? `<p>${a.primaryNumber ? `<span class="num">#${esc(a.primaryNumber)}</span>` : ''}<span>${esc(a.primaryPosition?.name || '')}</span>${t ? `<span><img src="${esc(bsLogo(t.id))}" alt="" ${bsLogoErr}> <button class="linkbtn" data-bsteam="${esc(t.id)}" data-bsl="${esc(BS_LEAGUES.find(l => l.src === 'sa' && l.sport === t.sport?.id && (!l.league || l.league === t.league?.id))?.key || v.lg)}">${esc(t.name)}</button></span>` : ''}</p>` : ''}</div></div>${tiles}</div>`;
}
function bsPlayerPicker(v){
  const ys = v.years?.length ? v.years : [v.season];
  const gs = v.groups?.length > 1 ? `<div class="quick" role="group" aria-label="Stat group">${v.groups.map(g => `<button class="qf" data-bsact="grp" data-to="${g}" aria-pressed="${v.grp === g}">${g === 'hitting' ? 'Hitting' : 'Pitching'}</button>`).join('')}</div>` : '';
  return gs + (ys.length > 1 ? `<div class="tc-bar"><label class="season"><span>Season</span><select id="bsSeason" aria-label="Season">${ys.map(y => `<option value="${y}" ${y === v.season ? 'selected' : ''}>${y} · ${esc(BSL[v.lg].name)}</option>`).join('')}</select></label></div>` : '');
}
function bsStatRow(v, g, k, st, peers){
  const raw = st[k], n = k === 'inningsPitched' ? bsIP(raw) : bsNum(raw), rate = BS_RATE.has(k), gp = st.gamesPlayed || 0;
  const pg = !rate && gp && n != null && k !== 'gamesPlayed' ? n / gp : null, r = bsRankIn(peers, g, k, st, v.id);
  const pc = r?.pc, cls = pc == null ? '' : pc >= 70 ? 'hi' : pc < 30 ? 'lo' : '';
  const pgTxt = pg == null ? '' : pg >= 10 ? pg.toFixed(1) : pg.toFixed(2);
  return `<div class="fbps-row${n ? '' : ' z'}"><span class="ps-t">${esc(bsLabel(g, k))}</span><b class="num">${esc(raw)}</b><span class="num ps-90">${pgTxt}</span><span class="fbps-rk">${r ? `<b class="num">${fbOrd(r.rank)}</b><small>/${r.n}</small>` : ''}</span>
    ${pc == null ? '<span class="ps-bar-c"></span><span></span>' : `<span class="ps-bar-c"><span class="ps-bar" role="img" aria-label="${pc} percentile"><i class="${cls}" style="width:${Math.max(2, pc)}%"></i></span></span><span class="num ps-p ${cls}">${pc}</span>`}</div>`;
}
function bsStatsBody(v){
  const ss = v.ss?.[v.season];
  if (!ss || ss.loading) return `<div class="skel" style="height:300px"></div>`;
  const g = v.grp, st = ss.season[g];
  if (!st) return `<div class="note">No ${esc(v.season)} ${g} stats in ${esc(BSL[v.lg].name)} for this player.</div>`;
  const peers = ss.peers?.[g];
  let h = '';
  if (peers) {
    const items = BS_KEY[g].radar.map(([k, title]) => { const r = bsRankIn(peers, g, k, st, v.id); return r ? { title, value: r.pc / 100 } : null }).filter(Boolean);
    const cand = Object.keys(st).filter(k => !BS_SKIP.has(k) && k !== 'gamesPlayed' && bsNum(st[k]) != null).map(k => ({ k, r: bsRankIn(peers, g, k, st, v.id) })).filter(c => c.r);
    const strong = cand.filter(c => c.r.pc >= 80).sort((a, b) => b.r.pc - a.r.pc).slice(0, 5), weak = cand.filter(c => c.r.pc <= 20).sort((a, b) => a.r.pc - b.r.pc).slice(0, 4);
    const chip = c => `<li><span>${esc(bsLabel(g, c.k))}</span><b class="num">${esc(st[c.k])}</b><small>${fbOrd(c.r.rank)} of ${c.r.n}</small></li>`;
    const rad = items.length >= 3 ? radarSVG({ title: 'vs league', items }, v.color || '#3D6FD9') : '';
    if (rad || strong.length || weak.length) h += `<div class="fbp-viz">${rad ? `<div class="radar"><h5>Compared with the league</h5>${rad}<small>Percentile, 0–100 (100 = best). Totals are compared per game.</small></div>` : ''}
      <div class="fbp-sw">${strong.length ? `<h5>Best at</h5><ul class="fbp-chips hi">${strong.map(chip).join('')}</ul>` : ''}${weak.length ? `<h5>Below average</h5><ul class="fbp-chips lo">${weak.map(chip).join('')}</ul>` : ''}
        ${!peers.some(p => p.id === String(v.id)) ? `<p class="fbp-q">Not enough ${g === 'pitching' ? 'innings' : 'plate appearances'} yet to count as a regular, so these comparisons are rough.</p>` : ''}</div></div>`;
  }
  const first = BS_FIRST[g], keys = Object.keys(st).filter(k => !BS_SKIP.has(k) && (typeof st[k] === 'number' || /^[-.\d]/.test(String(st[k]))) && !/^[.-]+-*$/.test(String(st[k])))
    .sort((a, b) => { const i = x => { const j = first.indexOf(x); return j < 0 ? 99 : j }; return i(a) - i(b) });
  const nz = keys.filter(k => bsNum(st[k])), zero = keys.filter(k => !bsNum(st[k]));
  h += `<div class="sub-h"><h5>${g === 'hitting' ? 'Hitting' : 'Pitching'}</h5><small>${keys.length} stats</small></div>
    <div class="fbps-head" aria-hidden="true"><span></span><span style="text-align:right">Total</span><span style="text-align:right">Per game</span><span style="text-align:right">Rank</span><span class="ps-bar-c">Percentile</span><span></span></div>
    ${nz.map(k => bsStatRow(v, g, k, st, peers)).join('')}${zero.length ? `<details class="fbp-zero"><summary>${zero.length} more at zero</summary>${zero.map(k => bsStatRow(v, g, k, st, peers)).join('')}</details>` : ''}`;
  const fl = (ss.fielding || []).filter(x => x.stat && x.position);
  if (fl.length) h += `<div class="sub-h"><h5>Fielding</h5><small>by position</small></div><div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Pos</th><th>G</th><th>Inn</th><th>PO</th><th>A</th><th>E</th><th>DP</th><th>FPCT</th></tr></thead><tbody>
    ${fl.map(x => `<tr><td class="t" style="display:table-cell">${esc(x.position.abbreviation)}</td><td>${x.stat.gamesPlayed ?? ''}</td><td>${esc(x.stat.innings ?? '')}</td><td>${x.stat.putOuts ?? ''}</td><td>${x.stat.assists ?? ''}</td><td>${x.stat.errors ?? ''}</td><td>${x.stat.doublePlays ?? ''}</td><td>${esc(x.stat.fielding ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
  h += `<p class="srcnote">Per game = total ÷ ${st.gamesPlayed || 0} games. ${peers ? `Rank and percentile compare per-game numbers (or rates such as AVG and ERA) with ${peers.length} ${esc(BSL[v.lg].name)} ${g === 'pitching' ? 'pitchers in the same role' : 'hitters'} who got at least 40% of the busiest player's ${g === 'pitching' ? 'innings' : 'plate appearances'}; 100 = best, and for stats like strikeouts (hitters) or ERA, lower is better. ` : ''}Data from MLB StatsAPI.</p>`;
  return h;
}
function bsGameLog(v){
  const ss = v.ss?.[v.season]; if (!ss || ss.loading) return `<div class="skel" style="height:240px"></div>`;
  const g = v.grp, rows = [...(ss.log?.[g] || [])].reverse(); if (!rows.length) return `<div class="note">No games in ${esc(v.season)}.</div>`;
  const cols = g === 'pitching' ? [['inningsPitched', 'IP'], ['hits', 'H'], ['runs', 'R'], ['earnedRuns', 'ER'], ['baseOnBalls', 'BB'], ['strikeOuts', 'SO'], ['homeRuns', 'HR'], ['numberOfPitches', 'NP'], ['era', 'ERA']]
    : [['atBats', 'AB'], ['runs', 'R'], ['hits', 'H'], ['doubles', '2B'], ['homeRuns', 'HR'], ['rbi', 'RBI'], ['baseOnBalls', 'BB'], ['strikeOuts', 'SO'], ['stolenBases', 'SB'], ['avg', 'AVG'], ['ops', 'OPS']];
  return `<div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opponent</th><th>Result</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(x => `<tr><td class="t" style="display:table-cell">${esc(fmtDate(new Date(x.date + 'T12:00:00')))}</td><td class="t"><button class="linkbtn" data-bsgameid="${esc(x.game?.gamePk)}">${x.isHome ? 'vs' : '@'} ${esc(x.opponent?.name || '')}</button></td><td>${x.isWin === true ? '<span class="res W">W</span>' : x.isWin === false ? '<span class="res L">L</span>' : ''}</td>${cols.map(c => `<td>${esc(x.stat?.[c[0]] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p style="font-size:11.5px;color:var(--muted)">AVG, OPS and ERA are the running season figures after each game.</p>`;
}
const BS_SPORT_NAME = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'A+', 14: 'A', 16: 'Rookie', 17: 'Winter', 23: 'Indy', 51: 'Intl' };
function bsCareerPane(v){
  if (!v.career) return `<div class="skel" style="height:240px"></div>`;
  return v.groups.map(g => { const rows = v.career[g] || []; if (!rows.length) return '';
    const cols = g === 'pitching' ? [['gamesPlayed', 'G'], ['gamesStarted', 'GS'], ['wins', 'W'], ['losses', 'L'], ['era', 'ERA'], ['inningsPitched', 'IP'], ['strikeOuts', 'SO'], ['baseOnBalls', 'BB'], ['whip', 'WHIP'], ['saves', 'SV']]
      : [['gamesPlayed', 'G'], ['plateAppearances', 'PA'], ['hits', 'H'], ['homeRuns', 'HR'], ['rbi', 'RBI'], ['stolenBases', 'SB'], ['avg', 'AVG'], ['obp', 'OBP'], ['slg', 'SLG'], ['ops', 'OPS']];
    return `<div class="sub-h"><h5>${g === 'hitting' ? 'Hitting' : 'Pitching'}</h5><small>every level</small></div><div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team</th><th>Lvl</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(x => `<tr><td class="t" style="display:table-cell">${esc(x.season)}</td><td class="t">${x.team?.id ? `<img src="${esc(bsLogo(x.team.id))}" alt="" ${bsLogoErr}>` : ''}${esc(x.team?.name || '')}</td><td>${esc(BS_SPORT_NAME[x.sportId] || '')}</td>${cols.map(c => `<td>${esc(x.stat?.[c[0]] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` }).join('')
    + `<p style="font-size:11.5px;color:var(--muted)">Regular seasons in MLB, the minors, winter leagues and international play, from MLB StatsAPI.</p>`;
}
function bsPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  const a = v.bio; if (!a) return `<div class="skel" style="height:240px"></div>`;
  if (v.tab === 'stats') {
    const rows = [['Position', a.primaryPosition?.name], ['Bats / throws', a.batSide && a.pitchHand ? `${a.batSide.description} / ${a.pitchHand.description}` : ''], ['Age', a.currentAge ? `${a.currentAge}${a.birthDate ? ' · born ' + fmtDate(new Date(a.birthDate + 'T12:00:00'), { day: 'numeric', month: 'long', year: 'numeric' }) : ''}` : ''],
      ['Height / weight', [a.height, a.weight ? a.weight + ' lb' : ''].filter(Boolean).join(' · ')], ['Born in', [a.birthCity, a.birthStateProvince, a.birthCountry].filter(Boolean).join(', ')], ['MLB debut', a.mlbDebutDate ? fmtDate(new Date(a.mlbDebutDate + 'T12:00:00'), { day: 'numeric', month: 'short', year: 'numeric' }) : ''],
      ['Drafted', a.draftYear ? String(a.draftYear) : ''], ['Nickname', a.nickName]].filter(r => r[1]);
    return bsPlayerPicker(v) + bsStatsBody(v) + `<div class="sub-h"><h5>Profile</h5></div><div class="bio">${rows.map(([k, x]) => `<div><span>${k}</span><strong>${esc(x)}</strong></div>`).join('')}</div>`;
  }
  if (v.tab === 'log') return bsPlayerPicker(v) + bsGameLog(v);
  if (v.tab === 'career') return bsCareerPane(v);
  return '';
}

/* ---------- KBO, NPB and CPBL rosters and players (official KBO site, Yahoo! Japan, Rebas, through /api/bsb/x) ---------- */
const BS_X_SRC = { kbo: 'the KBO (koreabaseball.com)', npb: 'Yahoo! Japan', cpbl: 'Rebas (rebas.tw)', bbcl: 'bananaball.com' };
function bsXRosterLoad(v){
  if (v.xr) return;
  v.xr = { loading: true };
  getJSON(`/api/bsb/x/roster?lg=${v.lg}&team=${encodeURIComponent(v.team?.name || '')}`).then(d => { v.xr = d.error ? { error: true } : d }).catch(() => { v.xr = { error: true } })
    .finally(() => S.stack.includes(v) && renderSheet());
}
function bsXRoster(v){
  bsXRosterLoad(v);
  const d = v.xr; if (d.loading) return `<div class="skel" style="height:260px"></div><p class="srcnote">Loading the roster from ${esc(BS_X_SRC[v.lg])}. The first load can take a few seconds.</p>`;
  if (d.error) return null;
  const line = (p, pit) => { const s = p.s || {}; return pit ? `${s.wins ?? 0}-${s.losses ?? 0} · ${s.era ?? '–'} ERA · ${s.inningsPitched ?? 0} IP · ${s.strikeOuts ?? 0} K` : `${s.avg ?? '–'} · ${s.homeRuns ?? 0} HR · ${s.rbi ?? 0} RBI · ${s.ops ?? '–'} OPS` };
  const row = (p, pit) => `<button class="prow ph" data-bsplayer="${esc(p.id)}" data-bsl="${esc(v.lg)}" data-bsgroup="${pit ? 'pitching' : 'hitting'}"><b>${esc(p.number || '–')}</b>
      ${p.photo ? `<img class="face-s espn-shot" src="${esc(p.photo)}" alt="" loading="lazy" ${bsImgErr}>` : `<span class="av sm" style="--av:${esc(v.color || '#5C677D')}">${esc(initials(p.name))}</span>`}
      <span class="nm"><span>${esc(p.name)}</span><small>${esc([p.pos, p.name !== p.local ? p.local : '', `${p.s?.gamesPlayed ?? 0} games`].filter(Boolean).join(' · '))}</small></span><span class="st2 bs-rl">${esc(line(p, pit))}</span></button>`;
  const by = (a, b) => (b.s?.gamesPlayed || 0) - (a.s?.gamesPlayed || 0);
  return `<div class="sub-h" style="margin-top:0"><h5>Pitchers</h5><small>${d.pitching.length}</small></div>${[...d.pitching].sort(by).map(p => row(p, true)).join('')}
    <div class="sub-h"><h5>Position players</h5><small>${d.hitting.filter(p => p.s?.plateAppearances).length}</small></div>${[...d.hitting].filter(p => p.s?.plateAppearances).sort(by).map(p => row(p, false)).join('')}
    <p class="srcnote">Everyone who played for the team in the ${bsSeason(v.lg)} regular season, with season stats, from ${esc(BS_X_SRC[v.lg])}.${v.lg === 'cpbl' ? ' Names are in Chinese, as the source publishes them.' : v.lg === 'npb' ? ' Names are romanised from their Japanese reading; a few appear in Japanese until they are looked up.' : ''} Tap a player for every stat and his league ranks.</p>`;
}
const bsXPools = new Map();
function bsXPool(lg, group){
  const k = lg + '|' + group;
  if (!bsXPools.has(k)) bsXPools.set(k, getJSON(`/api/bsb/x/pool?lg=${lg}&group=${group}`).then(d => (d.players || []).map(p => ({ id: String(p.id), pos: p.pos || '', s: p.s })))
    .catch(() => { bsXPools.delete(k); return null }));
  return bsXPools.get(k);
}
function openBsXPlayer(id, lg, group){
  const from = S.stack[S.stack.length - 1]?.team?.name || '';
  pushView({ type: 'bsbplayer', x: true, id: String(id), lg, tab: 'stats', grp: group || 'hitting', teamName: from });
  const v = S.stack[S.stack.length - 1], rr = () => S.stack.includes(v) && renderSheet();
  getJSON(`/api/bsb/x/player?lg=${lg}&id=${encodeURIComponent(id)}${group ? '&group=' + group : ''}`).then(async d => {
    if (!d?.bio) { v.err = true; return rr() }
    v.xb = d.bio; v.grp = d.group; v.groups = [d.group]; v.season = bsSeason(lg); v.years = [v.season];
    v.ss = { [v.season]: { loading: true } }; rr();
    const pool = await bsXPool(lg, d.group);
    v.ss[v.season] = { season: d.season ? { [d.group]: d.season } : {}, peers: { [d.group]: bsPeers(pool, d.group, d.season) }, xlog: d.log || [], loading: false };
    v.xcareer = d.career || [];
    rr();
  }).catch(() => { v.err = true; rr() });
}
function bsXHero(v, back){
  const b = v.xb, ss = v.ss?.[v.season], g = v.grp, st = ss?.season?.[g];
  const team = b?.team || v.teamName || '';
  const c = { color: fmColor(team || BSL[v.lg].name) }, col = (() => { const x = hex('#' + c.color); return x && lum(x) > .03 ? x : '#3D6FD9' })(); v.color = col;
  let tiles = '';
  if (st) tiles = `<div class="tiles">${BS_KEY[g].tiles.map(k => { if (st[k] == null) return ''; const r = bsRankIn(ss.peers?.[g], g, k, st, v.id);
      return `<div class="tile"><b class="num">${esc(st[k])}</b><span>${BS_TILE[k]}</span>${r ? `<em class="fbt-rk">${fbOrd(r.rank)} of ${r.n}${r.perGame ? ' · per game' : ''}</em>` : ''}</div>` }).join('')}</div>
    <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(v.season)} · ${esc(BSL[v.lg].name)} regular season · ${st.gamesPlayed || 0} games${ss.peers?.[g] ? ` · ranked among ${ss.peers[g].length} ${g === 'pitching' ? ((st.gamesStarted || 0) >= (st.gamesPlayed || 1) / 2 ? 'starting pitchers' : 'relievers') : 'regular hitters'}` : ''}</p>`;
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead">${b?.photo ? `<img class="face espn-shot" src="${esc(b.photo)}" alt="" ${bsImgErr}>` : `<span class="av" style="--av:${col}">${esc(initials(b?.name || '?'))}</span>`}<div><h3>${esc(b?.name || 'Loading…')}</h3>
    ${b ? `<p>${b.number ? `<span class="num">#${esc(b.number)}</span>` : ''}${b.position ? `<span>${esc(b.position)}</span>` : ''}${team ? `<span>${esc(team)}</span>` : ''}<span>${esc(BSL[v.lg].name)}</span>${b.local && b.local !== b.name ? `<span>${esc(b.local)}</span>` : ''}</p>` : ''}</div></div>${tiles}</div>`;
}
function bsXLog(v){
  const ss = v.ss?.[v.season]; if (!ss || ss.loading) return `<div class="skel" style="height:240px"></div>`;
  const rows = [...(ss.xlog || [])].sort((a, b) => b.date.localeCompare(a.date)); if (!rows.length) return `<div class="note">No game log published for ${esc(v.season)}.</div>`;
  const g = v.grp, cols = g === 'pitching' ? [['decision', 'Dec'], ['inningsPitched', 'IP'], ['hits', 'H'], ['runs', 'R'], ['earnedRuns', 'ER'], ['baseOnBalls', 'BB'], ['strikeOuts', 'SO'], ['homeRuns', 'HR'], ['numberOfPitches', 'NP']]
    : [['atBats', 'AB'], ['runs', 'R'], ['hits', 'H'], ['doubles', '2B'], ['homeRuns', 'HR'], ['rbi', 'RBI'], ['baseOnBalls', 'BB'], ['strikeOuts', 'SO'], ['stolenBases', 'SB'], ['summary', 'At bats']];
  const used = cols.filter(c => rows.some(r => r.stat?.[c[0]] != null && r.stat[c[0]] !== ''));
  return `<div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opponent</th>${used.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(x => `<tr><td class="t" style="display:table-cell">${esc(fmtDate(new Date(x.date + 'T12:00:00')))}${x.tag ? `<br><small style="color:var(--muted)">${esc(x.tag)}</small>` : ''}</td><td class="t" style="display:table-cell">${esc(x.opp)}</td>${used.map(c => `<td${c[0] === 'summary' ? ' style="text-align:left;white-space:normal"' : ''}>${esc(x.stat?.[c[0]] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function bsXCareer(v){
  const rows = v.xcareer; if (!rows) return `<div class="skel" style="height:240px"></div>`;
  if (!rows.length) return `<div class="note">${v.lg === 'npb' ? 'Yahoo! Japan only publishes the current season, so there are no past seasons here.' : 'No career stats published.'}</div>`;
  const g = v.grp, cols = g === 'pitching' ? [['gamesPlayed', 'G'], ['wins', 'W'], ['losses', 'L'], ['saves', 'SV'], ['holds', 'HLD'], ['era', 'ERA'], ['inningsPitched', 'IP'], ['strikeOuts', 'SO'], ['baseOnBalls', 'BB'], ['whip', 'WHIP']]
    : [['gamesPlayed', 'G'], ['atBats', 'AB'], ['hits', 'H'], ['homeRuns', 'HR'], ['rbi', 'RBI'], ['stolenBases', 'SB'], ['avg', 'AVG'], ['obp', 'OBP'], ['slg', 'SLG'], ['ops', 'OPS']];
  return `<div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(x => `<tr><td class="t" style="display:table-cell">${esc(x.season)}</td><td class="t" style="display:table-cell">${esc(x.team)}</td>${cols.map(c => `<td>${esc(x.stat?.[c[0]] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p style="font-size:11.5px;color:var(--muted)">Regular seasons in ${esc(BSL[v.lg].name)}, from ${esc(BS_X_SRC[v.lg])}.</p>`;
}
function bsXPane(v){
  if (v.err) return `<div class="note">Couldn't load this player from ${esc(BS_X_SRC[v.lg])}.</div>`;
  const b = v.xb; if (!b) return `<div class="skel" style="height:240px"></div>`;
  if (v.tab === 'stats') {
    const rows = [['Position', b.position], ['Bats / throws', b.bt], ['Born', b.born], ['Birthplace', b.birthplace], ['Height / weight', b.htwt || [b.height, b.weight].filter(Boolean).join(' · ')],
      ['Debut', b.debut], ['Drafted', b.draft], ['Pro seasons', b.years], ['Salary', b.salary]].filter(r => r[1]);
    return bsPlayerPicker(v) + bsStatsBody(v).replace(/Data from MLB StatsAPI\./, `Data from ${esc(BS_X_SRC[v.lg])}.`) + `<div class="sub-h"><h5>Profile</h5></div><div class="bio">${rows.map(([k, x]) => `<div><span>${k}</span><strong>${esc(x)}</strong></div>`).join('')}</div>`;
  }
  if (v.tab === 'log') return bsXLog(v);
  if (v.tab === 'career') return bsXCareer(v);
  return '';
}

/* ---------- Banana Ball (bananaball.com's stats site, through /api/bsb/banana) ---------- */
// the venue's local clock time -> a real Date, using the browser's time-zone data
function bsZoned(date, time, tz){
  const guess = new Date(`${date}T${time || '19:00:00'}Z`);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(guess).map(x => [x.type, x.value]));
    const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return new Date(guess.getTime() - (asLocal - guess.getTime()));
  } catch { return guess }
}
function bsBbNorm(g){
  const side = t => ({ id: t.id, name: t.name.replace(/^(The )/, ''), full: t.name, abbr: t.abbr || t.name.slice(0, 3).toUpperCase(), logo: t.logo, color: null, alt: null,
    score: t.points ?? '', runs: t.runs, hits: t.hits ?? '', errors: '', trick: t.trick, record: '', lines: [], sp: t.sp, wp: t.wp, lp: t.lp });
  const home = side(g.home), away = side(g.away);
  home.color = fmColor(home.full); away.color = fmColor(away.full);
  const [hc, ac] = teamColors(home, away), d = bsZoned(g.date, g.time, g.tz);
  const post = g.state === 'post';
  return { id: 'bb' + g.id, bbId: g.id, src: 'bb', lg: 'bbcl', date: d, ymd: g.date, state: g.state, detail: post ? 'Final' : g.state === 'in' ? `${g.half === 'top' ? 'Top' : 'Bot'} ${g.inning || ''}`.trim() : '',
    home, away, hc, ac, venue: '', tv: '', series: '', season: g.season,
    seriesStatus: home.runs != null && (post || g.state === 'in') ? `Points ${away.score}–${home.score} · runs ${away.runs ?? '–'}–${home.runs ?? '–'}` : '', sit: null,
    dec: post ? { w: (home.wp || away.wp) ? { fullName: (home.wp || away.wp).name } : null, l: (home.lp || away.lp) ? { fullName: (home.lp || away.lp).name } : null } : null, sched: 9 };
}
const bsBbPool = new Map();
function bsBbPlayers(group){
  if (!bsBbPool.has(group)) bsBbPool.set(group, getJSON(`/api/bsb/banana/players?group=${group}`).then(d => d.players || []).catch(() => { bsBbPool.delete(group); return [] }));
  return bsBbPool.get(group);
}
function bsBbSummary(v){
  const e = v.e, H = e.home, A = e.away;
  const rows = [['Points (innings won)', A.score, H.score], ['Runs', A.runs, H.runs], ['Hits', A.hits, H.hits], ['Trick plays', A.trick, H.trick]].filter(r => r[1] != null && r[1] !== '');
  let h = e.state === 'pre' ? `<div class="note">The box score appears once the game starts.</div>` : `<div class="sub-h" style="margin-top:0"><h5>Game</h5><small>${esc(A.abbr)} · ${esc(H.abbr)}</small></div>` + rows.map(([l, a, b]) => { const x = +a || 0, y = +b || 0, m = Math.max(x, y, 1e-9);
    return `<div class="stat"><span class="v num ${x >= y && x ? 'lead' : ''}">${esc(a)}</span><div><div class="lbl">${esc(l)}</div><div class="bars"><span><i style="width:${x / m * 100}%;background:${e.ac}"></i></span><span><i style="width:${y / m * 100}%;background:${e.hc}"></i></span></div></div><span class="v num ${y >= x && y ? 'lead' : ''}">${esc(b)}</span></div>` }).join('');
  const pit = [['Starter', A.sp, A], ['Starter', H.sp, H], ['Win', A.wp || H.wp, A.wp ? A : H], ['Loss', A.lp || H.lp, A.lp ? A : H]].filter(x => x[1]);
  if (pit.length) h += `<div class="sub-h"><h5>Pitchers</h5></div><div class="tiles bs-dec">${pit.map(([k, p, t]) => `<div class="tile"><img class="face-s" src="${esc(p.photo || SIL)}" alt="" ${bsImgErr}><b><button class="linkbtn" data-bsplayer="${esc(p.id)}" data-bsl="bbcl">${esc(p.name)}</button></b><span>${k} · ${esc(t.name)}${p.ip != null ? ` · ${esc(p.ip)} IP` : ''}</span></div>`).join('')}</div>`;
  return h + `<p class="srcnote">Banana Ball scores by points: the team that scores more runs in an inning wins that inning's point, and the most points wins. Data from bananaball.com.</p>`;
}
function bsBbTeamPane(v){
  if (v.tab === 'sched') {
    if (!v.games) return `<div class="skel" style="height:260px"></div>`;
    const evs = v.games.filter(e => e.home.id === v.id || e.away.id === v.id); evs.forEach(e => (S.bsb.extra ||= new Map()).set(e.id, e));
    if (!evs.length) return `<div class="note">No games found this year.</div>`;
    const next = evs.filter(e => e.state !== 'post'), done = evs.filter(e => e.state === 'post').reverse();
    return (next.length ? `<div class="sub-h" style="margin-top:0"><h5>Upcoming</h5><small>${next.length}</small></div><div class="fbsched">${next.map(e => bsSchedRow(v, e)).join('')}</div>` : '')
      + `<div class="sub-h"${next.length ? '' : ' style="margin-top:0"'}><h5>Results</h5><small>${done.length} games · score in points</small></div><div class="fbsched">${done.map(e => bsSchedRow(v, e)).join('')}</div>`;
  }
  if (v.tab === 'roster') {
    if (!v.bbRoster) return `<div class="skel" style="height:260px"></div>`;
    const { hit, pit } = v.bbRoster; if (!hit.length && !pit.length) return `<div class="note">No player stats for this team yet.</div>`;
    const row = (p, g) => `<button class="prow ph" data-bsplayer="${esc(p.id)}" data-bsl="bbcl" data-bsgroup="${g}"><b>${esc(p.number ?? '–')}</b><img class="face-s espn-shot" src="${esc(p.photo || SIL)}" alt="" loading="lazy" ${bsImgErr}>
      <span class="nm"><span>${esc(p.name)}</span><small>${esc([p.posLabel, `${p.s.gamesPlayed ?? 0} games`].filter(Boolean).join(' · '))}</small></span>
      <span class="st2 bs-rl">${esc(g === 'pitching' ? `${p.s.wins ?? 0}-${p.s.losses ?? 0} · ${p.s.era ?? '–'} ERA · ${p.s.strikeOuts ?? 0} K` : `${p.s.avg ?? '–'} · ${p.s.homeRuns ?? 0} HR · ${p.s.ops ?? '–'} OPS`)}</span></button>`;
    return `<div class="sub-h" style="margin-top:0"><h5>Pitchers</h5><small>${pit.length}</small></div>${pit.map(p => row(p, 'pitching')).join('')}<div class="sub-h"><h5>Hitters</h5><small>${hit.length}</small></div>${hit.map(p => row(p, 'hitting')).join('')}
      <p class="srcnote">Everyone with stats for the team on this year's World Tour, from bananaball.com.</p>`;
  }
  return '';
}
function openBsBbTeam(v){
  const yr = new Date().getFullYear(), rr = () => S.stack.includes(v) && renderSheet();
  bsStandings('bbcl').then(() => { const r = bsTeamRow('bbcl', v.id); v.team = { id: v.id, name: r?.name || 'Team', logo: r?.logo || '' }; rr() });
  getJSON(`/api/bsb/banana/games?from=${yr}-01-01&to=${yr}-12-31`).then(d => { v.games = (d.games || []).map(bsBbNorm); rr() }).catch(() => { v.games = []; rr() });
  Promise.all([bsBbPlayers('hitting'), bsBbPlayers('pitching')]).then(([h, p]) => { v.bbRoster = { hit: h.filter(x => x.teamId === v.id && x.s.plateAppearances).sort((a, b) => b.s.gamesPlayed - a.s.gamesPlayed), pit: p.filter(x => x.teamId === v.id).sort((a, b) => b.s.gamesPlayed - a.s.gamesPlayed) }; rr() });
}
async function openBsBbPlayer(id, group){
  pushView({ type: 'bsbplayer', x: true, id: String(id), lg: 'bbcl', tab: 'stats', grp: group || 'hitting' });
  const v = S.stack[S.stack.length - 1], rr = () => S.stack.includes(v) && renderSheet();
  const [hp, pp] = await Promise.all([bsBbPlayers('hitting'), bsBbPlayers('pitching')]);
  const h = hp.find(x => x.id === v.id), p = pp.find(x => x.id === v.id), me = h || p;
  if (!me) { v.err = true; return rr() }
  v.groups = [...(h?.s.plateAppearances ? ['hitting'] : []), ...(p ? ['pitching'] : [])]; if (!v.groups.length) v.groups = ['hitting'];
  if (!v.groups.includes(v.grp)) v.grp = v.groups[0];
  if (me.pos === 'P' && v.groups.includes('pitching') && !group) v.grp = 'pitching';
  v.xb = { name: me.name, photo: me.photo, number: me.number != null ? String(me.number) : '', position: me.posLabel, team: me.team };
  v.season = new Date().getFullYear(); v.years = [v.season];
  v.ss = { [v.season]: { season: { ...(h ? { hitting: h.s } : {}), ...(p ? { pitching: p.s } : {}) }, peers: { hitting: bsPeers(hp.map(x => ({ id: x.id, pos: x.pos, s: x.s })), 'hitting', h?.s), pitching: bsPeers(pp.map(x => ({ id: x.id, pos: x.pos, s: x.s })), 'pitching', p?.s) }, xlog: [], loading: false } };
  v.xcareer = [];
  rr();
}

/* ---------- league page (standings, leaders, results) ---------- */
// leaders for the leagues outside StatsAPI, worked out from every player's line (rates need a regular's playing time)
async function bsPoolLeaders(key){
  const get = g => key === 'bbcl' ? bsBbPlayers(g) : getJSON(`/api/bsb/x/pool?lg=${key}&group=${g}`).then(d => d.players || []);
  const [hp, pp] = await Promise.all([get('hitting'), get('pitching')]).catch(() => [[], []]);
  const maxPA = Math.max(0, ...hp.map(p => p.s.plateAppearances || 0)), maxIP = Math.max(0, ...pp.map(p => bsIP(p.s.inningsPitched) || 0));
  const regH = hp.filter(p => (p.s.plateAppearances || 0) >= maxPA * .6), regP = pp.filter(p => (bsIP(p.s.inningsPitched) || 0) >= maxIP * .5);
  const cat = (name, list, k, low, group) => ({ leaderCategory: name, statGroup: group, leaders: [...list].filter(p => bsNum(p.s[k]) != null).sort((a, b) => (low ? 1 : -1) * (bsNum(a.s[k]) - bsNum(b.s[k]))).slice(0, 5)
    .map(p => ({ person: { id: p.id, fullName: p.name }, team: { name: (typeof p.team === 'string' ? p.team : '') || p.teamName || '' }, value: p.s[k], photo: p.photo })) });
  return [cat('battingAverage', regH, 'avg'), cat('homeRuns', hp, 'homeRuns'), cat('runsBattedIn', hp, 'rbi'), cat('onBasePlusSlugging', regH, 'ops'), cat('stolenBases', hp, 'stolenBases'), cat('hits', hp, 'hits'),
    cat('earnedRunAverage', regP, 'era', true, 'pitching'), cat('strikeouts', pp, 'strikeOuts', false, 'pitching'), cat('wins', pp, 'wins', false, 'pitching'), cat('saves', pp, 'saves', false, 'pitching'), cat('walksAndHitsPerInningPitched', regP, 'whip', true, 'pitching')];
}
function bsLeagueSheet(key){
  S.sel = null; S.stack = [{ type: 'bsbleague', id: key, tab: 'stand' }];
  const v = S.stack[0], l = BSL[key];
  if (l.x || l.src === 'bb') bsPoolLeaders(key).then(ls => { v.leaders = ls; S.stack.includes(v) && renderSheet() });
  if (l.src === 'sa') { const season = bsSeason(key);
    Promise.allSettled(['hitting', 'pitching'].map(g => cj(`${SA}/stats/leaders?leaderCategories=${g === 'hitting' ? 'battingAverage,homeRuns,runsBattedIn,onBasePlusSlugging,stolenBases,hits' : 'earnedRunAverage,strikeouts,wins,saves,walksAndHitsPerInningPitched,inningsPitched'}&statGroup=${g}&season=${season}&sportId=${l.sport}${l.league ? '&leagueId=' + l.league : ''}&limit=5&hydrate=person,team`)))
      .then(rs => { v.leaders = rs.flatMap(r => val(r)?.leagueLeaders || []); S.stack.includes(v) && renderSheet() }) }
  bsStandings(key).then(() => S.stack.includes(v) && renderSheet());
  renderSheet(); $('sheet').classList.add('open');
}
const BS_LDR = { battingAverage: 'Batting average', homeRuns: 'Home runs', runsBattedIn: 'Runs batted in', onBasePlusSlugging: 'OPS', stolenBases: 'Stolen bases', hits: 'Hits', earnedRunAverage: 'ERA', strikeouts: 'Strikeouts', wins: 'Wins', saves: 'Saves', walksAndHitsPerInningPitched: 'WHIP', inningsPitched: 'Innings pitched' };
function bsLeaguePane(v){
  const key = v.id, l = BSL[key];
  if (v.tab === 'stand') return bsStandingsHTML(key);
  if (v.tab === 'leaders') {
    if (!v.leaders) return `<div class="skel" style="height:300px"></div>`;
    if (!v.leaders.length) return `<div class="note">No leaders published for this season yet.</div>`;
    return `<div class="bs-ldrs">${v.leaders.filter(c => c.leaders?.length).map(c => `<div><h5>${esc(BS_LDR[c.leaderCategory] || c.leaderCategory)}${c.statGroup === 'pitching' && c.leaderCategory === 'strikeouts' ? ' (pitching)' : ''}</h5><ol>${c.leaders.map(x => `<li><button class="ldr-row" data-bsplayer="${esc(x.person?.id)}" data-bsl="${esc(key)}" data-bsgroup="${c.statGroup === 'pitching' ? 'pitching' : 'hitting'}"><img class="face-s" src="${esc(x.photo || (l.src === 'sa' ? bsShot(x.person?.id, l.sport === 1) : SIL))}" alt="" ${bsImgErr}><span><b>${esc(x.person?.fullName || '')}</b><small>${esc(x.team?.name || '')}</small></span><b class="num">${esc(x.value)}</b></button></li>`).join('')}</ol></div>`).join('')}</div>`;
  }
  if (v.tab === 'results') { const d = S.bsb.lgfs?.[key]; if (!d) return `<div class="skel" style="height:300px"></div>`;
    const evs = [...(d.fixtures || []).slice(0, 12).reverse(), ...(d.results || []).slice(0, 40)].map(x => { const e = bsFsNorm(x, key); (S.bsb.extra ||= new Map()).set(e.id, e); return e });
    return evs.length ? `<div class="cards">${evs.map(bsCard).join('')}</div>` : `<div class="note">No games.</div>` }
  return '';
}

/* ---------- futures ---------- */
async function bsLoadFutures(force){
  if (S.bsb.futures && !force && Date.now() - S.bsb.futures.at < 60000) return S.bsb.futures;
  await Promise.allSettled(['mlb', 'npb', 'kbo'].map(k => bsStandings(k)));
  const res = await Promise.allSettled(BS_KX_FUT.map(([lg, s, label, multi]) => cjT(`/api/kalshi/events?series_ticker=${s}&status=open&with_nested_markets=true&limit=${multi ? 20 : 5}`, 30000)
    .then(d => { const evs = (d.events || []).sort((a, b) => (b.markets?.length || 0) - (a.markets?.length || 0));
      return (multi ? evs : evs.slice(0, 1)).map((ev, i) => ({ lg, s: multi ? `${s}-${i}` : s, series: s, label: multi ? ev.title.replace(/^Series Winner:\s*/i, '') + ' · series' : label, ev })) })));
  if (res.every(r => r.status === 'rejected')) return S.bsb.futures = { offline: true, groups: [], at: Date.now() };
  const groups = [];
  for (const r of res) for (const g of r.status === 'fulfilled' ? r.value : []) {
    const rows = (g.ev.markets || []).map(m => ({ name: m.yes_sub_title || m.title, p: fprice(m), prev: +m.previous_price_dollars || null })).filter(x => x.name && x.p > 0).sort((a, b) => b.p - a.p);
    if (rows.length) groups.push({ ...g, title: g.ev.title, rows }) }
  return S.bsb.futures = { groups, at: Date.now() };
}
function bsLogoFor(name, lg){
  let best = '', score = 0;
  for (const x of (S.bsb.stand[lg] || []).flatMap(g => g.entries)) { const s = Math.max(teamSim(x.name, name), teamSim(x.short || '', name)); if (s > score) { score = s; best = x.logo } }
  return score >= .6 ? best : '';
}
const bsFaceCache = new Map();
function bsFaceFor(name){
  if (bsFaceCache.has(name)) return bsFaceCache.get(name);
  bsFaceCache.set(name, null);
  cj(`${SA}/people/search?names=${encodeURIComponent(name)}&sportIds=1`).then(d => { const p = (d.people || []).find(x => teamSim(x.fullName, name) >= .85) || d.people?.[0];
    bsFaceCache.set(name, p ? bsShot(p.id) : ''); if (S.sport === 'baseball' && S.bsb.view === 'futures') renderBsFutures() }).catch(() => bsFaceCache.set(name, ''));
  return null;
}
async function renderBsFutures(){
  const el = $('bsb');
  const paint = () => { const F = S.bsb.futures;
    if (!F) { el.innerHTML = '<div class="skel" style="height:300px"></div>'; return }
    if (F.offline) { el.innerHTML = serverNote('odds'); return }
    el.innerHTML = `<div class="quick">${bsLgSelect()}</div><div class="livebar"><h2>Futures & title odds</h2><span class="count">Live Kalshi prices</span></div>` + ['mlb', 'npb', 'kbo'].map(lg => { const gs = F.groups.filter(g => g.lg === lg); if (!gs.length) return '';
      return `<div class="grp-name" style="font-size:22px">${esc(BSL[lg].name)}</div>` + gs.map(g => { const all = S.bsb.showAll[g.s], rows = all ? g.rows : g.rows.slice(0, 10), top = g.rows[0].p, people = BS_PLAYER_FUT.has(g.series);
        return `<div class="sub-h"><h5>${esc(g.label)}</h5><small>${esc(g.title)}</small></div><div class="futs">${rows.map((x, i) => { const pic = people ? bsFaceFor(x.name) : bsLogoFor(x.name, lg);
          return `<div class="fut${flashKey(g.s + x.name, x.p)}"><b class="rk num">${i + 1}</b>${pic ? `<img class="${people ? 'fut-face' : ''}" src="${esc(pic)}" alt="" ${bsImgErr}>` : `<span class="av sm" style="width:22px;height:22px;font-size:9px;--av:#5C677D">${esc(initials(x.name))}</span>`}<span class="nm">${esc(x.name)}</span><span class="bar"><i style="width:${Math.max(2, x.p / top * 100)}%"></i></span><span class="pv num">${x.p < .01 ? '<1' : pct(x.p)}% <small>${american(x.p)}</small> ${moveTag(x.p, x.prev)}</span></div>` }).join('')}</div>
          ${g.rows.length > 10 ? `<button class="btn ghost" style="margin-top:8px" data-bsact="futall" data-to="${esc(g.s)}">${all ? 'Show top 10' : `Show all ${g.rows.length}`}</button>` : ''}` }).join('') }).join('')
      + `<p class="srcnote">Prices from Kalshi, refreshed every 30 seconds while this page is open; 25¢ means a 25% chance. Kalshi lists no CPBL markets.</p>${RG}`;
  };
  paint(); await bsLoadFutures(); if (S.sport === 'baseball' && S.bsb.view === 'futures') paint();
}

/* ---------- predictions list ---------- */
async function renderBsPicks(){
  const el = $('bsb'), lg = S.bsb.lg;
  el.innerHTML = '<div class="skel" style="height:300px"></div>';
  const days = [bsToday(), bsYmd(new Date(Date.now() + 864e5))];
  await Promise.allSettled(days.map(bsLoadDay));
  const evs = days.flatMap(d => S.bsb.data['day|' + d]?.events || []).filter(e => e.state === 'pre' && (lg === 'all' || e.lg === lg));
  await Promise.allSettled([...new Set(evs.map(e => e.lg))].map(bsStandings));
  await bsOddsForList(evs).catch(() => {});
  if (S.bsb.view !== 'picks') return;
  const preds = evs.map(e => ({ e, P: bsPredict(e, null) })).sort((a, b) => b.P.top - a.P.top);
  // filters (predfilter.js): league group, league, confidence, first pitch, value against the market, my teams
  const items = preds.map(({ e, P }) => ({ e, P, id: e.id, lg: e.lg, lgName: BSL[e.lg].name, cat: BSL[e.lg].grp, order: BS_LEAGUES.indexOf(BSL[e.lg]), date: e.date, live: e.state === 'in',
    conf: P.conf, top: P.top, edge: P.market != null && P.model != null ? (P.pick === 'home' ? P.model - P.market : P.market - P.model) : null,
    fav: S.fav.some(f => f.sport === 'baseball' && (String(f.tid) === e.home.id || String(f.tid) === e.away.id)) }));
  const shown = PFX.apply('baseball', items);
  el.innerHTML = `<div class="quick">${bsLgSelect()}</div><div class="livebar"><h2>Predictions</h2><span class="count">${preds.length} game${preds.length === 1 ? '' : 's'} today and tomorrow${lg !== 'all' ? ' · ' + esc(BSL[lg].name) : ''}</span></div>
    ${PFX.bar('baseball', items, BS_GROUPS)}
    <div class="cards">${shown.map(({ e, P }) => `<button class="m pred-card fb" data-bsgame="${esc(e.id)}" data-bstab="pred" style="--hc:${e.ac};--ac:${e.hc}">
      <div class="st"><span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}</div>
      <div class="tms"><div class="tm"><img src="${esc(e.away.logo)}" alt="" ${bsLogoErr}><span>${esc(e.away.name)}</span></div><div class="tm"><img src="${esc(e.home.logo)}" alt="" ${bsLogoErr}><span>${esc(e.home.name)}</span></div>
        <div class="pbar"><i style="flex-grow:${1 - P.pH};background:${e.ac}"><span>${pct(1 - P.pH)}%</span></i><i style="flex-grow:${P.pH};background:${e.hc}"><span>${pct(P.pH)}%</span></i></div></div>
      <div class="pc-side"><span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf}</span><b>${esc(e[P.pick].name)}</b><small class="num">${P.score[1]}–${P.score[0]} · ${pct(P.top)}%</small><small class="pfx-lg">${esc(BSL[e.lg].name)}</small></div></button>`).join('') || PFX.empty('baseball', items.length) || '<div class="empty-state"><strong>No upcoming games</strong>Nothing left to play today or tomorrow in these leagues.</div>'}</div>
    <p class="srcnote">This list uses records, runs and the market. Open a game to add the probable starting pitchers to the prediction.</p>${RG}`;
}

PFX.on('baseball', () => S.sport === 'baseball' && S.bsb.view === 'picks' && renderBsPicks());

/* ---------- sheet rendering ---------- */
function bsRenderSheet(v){
  const sheet = $('sheet');
  const back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  let hero, tabs, body;
  if (v.type === 'bsbgame') { const e = v.e; hero = bsHero(e, back);
    tabs = e.src === 'bb' ? [['summary', 'Summary'], ['pred', 'Prediction'], ['stand', 'Standings']] : e.src === 'fs' ? [['summary', 'Summary'], ['lineups', 'Lineups'], ['odds', 'Odds'], ['pred', 'Prediction'], ['h2h', 'Head to head'], ['stand', 'Standings']]
      : e.state === 'pre' ? [['pred', 'Prediction'], ['matchup', 'Matchup'], ['odds', 'Odds'], ['stand', 'Standings']]
      : [['summary', 'Summary'], ['box', 'Box score'], ['plays', 'Plays'], ['matchup', 'Matchup'], ['odds', 'Odds'], ['pred', 'Prediction'], ['stand', 'Standings']];
    if (!tabs.some(t => t[0] === v.tab)) v.tab = tabs[0][0]; body = bsGamePane(v) }
  else if (v.type === 'bsbteam') { hero = bsTeamHero(v, back); tabs = [['sched', 'Schedule'], ['roster', 'Roster'], ...(BSL[v.lg].src === 'sa' ? [['stats', 'Team stats']] : []), ['stand', 'Standings'], ...(BSL[v.lg].kx ? [['fut', 'Title odds']] : [])]; body = bsTeamPane(v) }
  else if (v.type === 'bsbleague') { const l = BSL[v.id];
    hero = `<div class="hero solo" style="--tc:var(--accent)">${topBar(back)}<div class="thead">${l.logo ? `<img class="crest" src="${esc(l.logo)}" alt="" ${bsLogoErr}>` : ''}<div><h3>${esc(l.name)}</h3><p><span>${esc(l.area)}</span><span>${bsSeason(v.id)} season</span></p></div></div></div>`;
    tabs = [['stand', 'Standings'], ...(l.src === 'sa' || l.x || l.src === 'bb' ? [['leaders', 'Leaders']] : []), ...(l.src === 'fs' ? [['results', 'Results & fixtures']] : [])]; body = bsLeaguePane(v) }
  else if (v.x) { hero = bsXHero(v, back); tabs = [['stats', 'Stats'], ['log', 'Game log'], ['career', 'Career']]; body = bsXPane(v) }
  else { hero = bsPlayerHero(v, back); tabs = [['stats', 'Stats'], ['log', 'Game log'], ['career', 'Career']]; body = bsPlayerPane(v) }
  S.curTabs = tabs;
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  sheet.innerHTML = `<div class="sheet-body">${hero}${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel" style="--tc:${esc(v.color || 'var(--accent)')}">${body}</div></div>`;
  sheet.querySelector('.sheet-body').scrollTop = scroll;
}

/* ---------- search ---------- */
let bsTeamList = null;
async function bsSearch(q){
  const box = $('sres'); q = q.trim(); if (q.length < 2) { hideResults(); return }
  bsTeamList ||= cj(`${SA}/teams?sportIds=${BS_SPORTS}&season=${bsYear()}`).then(d => d.teams || []).catch(() => []);
  const [teams, people] = await Promise.allSettled([bsTeamList, cj(`${SA}/people/search?names=${encodeURIComponent(q)}&sportIds=${BS_SPORTS}&hydrate=currentTeam`)]);
  const ql = q.toLowerCase();
  const T = (val(teams) || []).filter(t => `${t.name} ${t.abbreviation || ''}`.toLowerCase().includes(ql)).map(t => ({ t, l: BS_LEAGUES.find(l => l.src === 'sa' && l.sport === t.sport?.id && (!l.league || l.league === t.league?.id)) })).filter(x => x.l).slice(0, 6);
  const F = BS_LEAGUES.filter(l => l.src === 'fs').flatMap(l => (S.bsb.stand[l.key] || []).flatMap(g => g.entries).filter(x => x.name.toLowerCase().includes(ql)).map(x => ({ x, l }))).slice(0, 6);
  const P = (val(people)?.people || []).sort((a, b) => !!b.currentTeam - !!a.currentTeam || !!b.active - !!a.active).slice(0, 8);
  let h = '';
  if (T.length || F.length) h += `<div class="sr-h">Teams</div>` + T.map(({ t, l }) => `<button class="sr" data-bsteam="${esc(t.id)}" data-bsl="${l.key}"><img src="${esc(bsLogo(t.id))}" alt="" ${bsLogoErr}><div><strong>${esc(t.name)}</strong><small>${esc(l.name)}</small></div></button>`).join('')
    + F.map(({ x, l }) => `<button class="sr" data-bsteam="${esc(x.id)}" data-bsl="${l.key}" data-bsslug="${esc(x.slug || '')}"><img src="${esc(x.logo)}" alt="" ${bsLogoErr}><div><strong>${esc(x.name)}</strong><small>${esc(l.name)}</small></div></button>`).join('');
  if (P.length) h += `<div class="sr-h">Players</div>` + P.map(p => { const t = p.currentTeam, l = t ? BS_LEAGUES.find(l => l.src === 'sa' && l.sport === t.sport?.id && (!l.league || l.league === t.league?.id)) : null;
    return `<button class="sr" data-bsplayer="${esc(p.id)}" data-bsl="${l?.key || 'mlb'}" data-bsfrom="1"><img class="face espn-shot" src="${esc(bsShot(p.id, !t || t.sport?.id === 1))}" alt="" ${bsImgErr}><div><strong>${esc(p.fullName)}</strong><small>${esc([p.primaryPosition?.abbreviation, t?.name].filter(Boolean).join(' · ') || 'Free agent or retired')}</small></div></button>` }).join('');
  box.innerHTML = h || `<div class="sr-none">No baseball teams or players match “${esc(q)}”.${BS_LEAGUES.some(l => l.src === 'fs' && !S.bsb.stand[l.key]) ? ' Open NPB, KBO or CPBL standings once to search their teams.' : ''}</div>`; box.hidden = false;
}

/* ---------- hooks into the main app ---------- */
(function bsInstall(){
  const sw = document.querySelector('.sport-sw');
  if (sw && !sw.querySelector('[data-sport="baseball"]')) sw.insertAdjacentHTML('beforeend', `<button role="tab" data-sport="baseball" class="sp-baseball">Baseball</button>`);
  if (!$('bsb')) { const sec = document.createElement('section'); sec.id = 'bsb'; sec.hidden = true; sec.setAttribute('aria-label', 'Baseball'); const sheet = $('sheet'); sheet.parentNode.insertBefore(sec, sheet) }
  const _render = render;
  render = function(){
    if (S.sport !== 'baseball') { $('bsb').hidden = true; return _render.apply(this, arguments) }
    document.querySelectorAll('.sport-sw button').forEach(b => { const on = b.dataset.sport === 'baseball'; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) });
    document.querySelectorAll('main.shell > section').forEach(s => { s.hidden = s.id !== 'bsb' });
    $('chips').classList.add('mk-hide'); document.querySelector('.shell').classList.remove('mk-page');
    renderBaseball(); bsTicker();
  };
  const _sheet = renderSheet;
  renderSheet = function(){ const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('bsb')) return bsRenderSheet(v); return _sheet.apply(this, arguments) };
  const _search = searchAll;
  searchAll = function(q){ if (S.sport === 'baseball') return bsSearch(q); return _search.apply(this, arguments) };
  const _openLeague = openLeague;
  openLeague = function(){ if (S.sport === 'baseball') return; return _openLeague.apply(this, arguments) };
})();
document.addEventListener('change', ev => {
  if (ev.target.id === 'bsSeason') { const v = S.stack[S.stack.length - 1]; if (v?.type === 'bsbplayer') bsPlayerSeason(v, +ev.target.value); return }
  if (ev.target.id === 'bsLgSel') { const x = ev.target.value; if (x === '_futures' || x === '_picks') S.bsb.view = x.slice(1); else { S.bsb.lg = x; S.bsb.view = 'games'; store.set('fl.bsbLg', x) } return render() }
  if (ev.target.id === 'bsDate' && ev.target.value) { S.bsb.date = ev.target.value === bsToday() ? null : ev.target.value; render() }
});
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-bslg],[data-bsview],[data-bsgame],[data-bsgameid],[data-bsteam],[data-bsplayer],[data-bsact],[data-bsfilter],[data-bspicklg]'); if (!t) return;
  hideResults();
  if (t.dataset.bslg) { S.bsb.lg = t.dataset.bslg; S.bsb.view = 'games'; store.set('fl.bsbLg', S.bsb.lg); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.bsview) { S.bsb.view = t.dataset.bsview; return render() }
  if (t.dataset.bsfilter) { S.bsb.filter = t.dataset.bsfilter; return render() }
  if (t.dataset.bspicklg) { S.bsb.lg = t.dataset.bspicklg; return render() }
  if (t.dataset.bsgame) return openBsGame(t.dataset.bsgame, t.dataset.bstab);
  if (t.dataset.bsgameid) { const id = t.dataset.bsgameid; return bsFindEvent(id) ? openBsGame(id) : bsOpenGameById(id) }
  if (t.dataset.bsteam) return openBsTeam(t.dataset.bsteam, t.dataset.bsl, t.dataset.bsslug);
  if (t.dataset.bsplayer) { openBsPlayer(t.dataset.bsplayer, t.dataset.bsl, t.dataset.bsgroup); if (t.dataset.bsfrom) S.stack[S.stack.length - 1].fromSearch = true; return }
  const a = t.dataset.bsact, v = S.stack[S.stack.length - 1];
  if (a === 'day') { const d = new Date(bsDate() + 'T12:00:00'); d.setDate(d.getDate() + +t.dataset.to); S.bsb.date = bsYmd(d) === bsToday() ? null : bsYmd(d); return render() }
  if (a === 'today') { S.bsb.date = null; return render() }
  if (a === 'lginfo') return bsLeagueSheet(S.bsb.lg);
  if (a === 'futall') { S.bsb.showAll[t.dataset.to] = !S.bsb.showAll[t.dataset.to]; return renderBsFutures() }
  if (a === 'rkind' && v?.type === 'bsbteam') { v.roster = null; renderSheet(); return bsRoster(v, t.dataset.to) }
  if (a === 'grp' && v?.type === 'bsbplayer') { v.grp = t.dataset.to; return renderSheet() }
  if (a === 'fav' && v?.team) { const id = `bs-${v.lg}-${v.id}`;
    S.fav = S.fav.some(f => f.id === id) ? S.fav.filter(f => f.id !== id) : [...S.fav, { id, tid: v.id, sport: 'baseball', lg: v.lg, slug: v.slug || '', name: v.team.name, logo: BSL[v.lg].src === 'fs' ? (v.team.logo || '') : bsLogo(v.id) }];
    savePrefs(); renderSheet(); bsRail() }
});
setInterval(() => { if (document.hidden || S.sport !== 'baseball') return;
  if (S.bsb.view === 'futures') { bsLoadFutures(true).then(() => S.bsb.view === 'futures' && renderBsFutures()); return }
  const d = S.bsb.data['day|' + bsDate()];
  if (S.bsb.view === 'games' && d?.events.some(e => e.state === 'in' || (e.state === 'pre' && e.date < Date.now() + 10 * 6e4))) { d.at = 0; renderBaseball() }
  const v = S.stack[S.stack.length - 1];
  if (v?.type === 'bsbgame' && v.e.state !== 'post') { if (v.tab === 'odds' && BSL[v.e.lg].kx) bsGameOdds(v.e).then(() => renderSheet()); if (v.e.state === 'in') bsLoadGame(v) }
}, 30000);
document.head.insertAdjacentHTML('beforeend', `<style>
.bs-off{font:600 9.5px/1 var(--f-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-left:4px}
.bs-sit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bs-sit .bs-ab{color:var(--muted);font-weight:500}
.hero-sit.bs-sit{justify-content:center;font-size:13px}.hero-sit.bs-sit span b{font-weight:650}
.bs-outs{display:inline-flex;gap:3px}.bs-outs i{width:7px;height:7px;border-radius:50%;border:1.4px solid var(--muted)}.bs-outs i.on{background:var(--live);border-color:var(--live)}
.bs-sp,.bs-ser{font:500 11.5px/1.35 var(--f-body);color:var(--muted);margin-top:2px}.bs-sp span{opacity:.7}.bs-ser{color:var(--accent);font-weight:600}
.hero-sit.bs-ser{margin-top:8px;text-align:center}
.bs-line th,.bs-line td{padding:4px 6px}.bs-line td.pts{font-weight:700}
.bs-dec{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}.bs-dec .tile{display:flex;flex-direction:column;align-items:flex-start;gap:4px}.bs-dec .tile img{width:34px;height:34px;border-radius:50%;object-fit:cover}
.bs-box td.t{white-space:nowrap}.bs-subrow{padding-left:22px!important}
.bs-notes{font-size:12px;color:var(--muted);margin:6px 0 14px;display:flex;flex-wrap:wrap;gap:4px 12px}.bs-notes b{color:var(--fg);width:100%}.bs-notes i{font-style:normal;color:var(--fg)}
.bs-pbp li{grid-template-columns:44px minmax(0,1fr) auto}.bs-pbp li.score .ptx{font-weight:600}.bs-pbp li .ptx strong{color:var(--accent);margin-right:4px}
.bs-sps{display:grid;grid-template-columns:1fr 1fr;gap:12px}.bs-spc{display:flex;gap:10px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
.bs-spc img.face{width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none;background:var(--surface)}.bs-spc strong{display:block}.bs-spc small{display:block;color:var(--muted);font-size:12px}
.bs-spl{display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:8px}.bs-spl span{display:flex;flex-direction:column;font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.bs-spl b{font-size:14px;color:var(--fg);letter-spacing:0}
.bs-lu{margin:0;padding:0;list-style:none;counter-reset:lu}.bs-lu li{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;align-items:center}
.bs-lu li .num{color:var(--muted);font-size:11.5px}.bs-lu li small{color:var(--muted);font-size:11.5px}.bs-lu li.sub{opacity:.7}.bs-luh{margin:12px 0 4px}
.bs-fx{width:100%;text-align:left}.bs-fx:hover{background:var(--surface-2)}
.bs-rl{font:500 11.5px/1.3 var(--f-mono);color:var(--muted);text-align:right;max-width:180px}
.bs-ldrs{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}.bs-ldrs h5{margin:0 0 6px}.bs-ldrs ol{list-style:none;margin:0;padding:0}
.ldr-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);border-radius:6px}.ldr-row:hover{background:var(--surface-2)}
.ldr-row img{width:30px;height:30px;border-radius:50%;object-fit:cover}.ldr-row small{display:block;color:var(--muted);font-size:11.5px}
.bs-lgsel{display:none;margin-left:auto;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:600 13px/1 var(--f-body)}
@media (max-width:1180px){ .bs-lgsel{display:block} }
.bs-dpick{position:relative}.bs-dpick input{position:absolute;inset:0;opacity:0;cursor:pointer}
@media (max-width:620px){ .bs-sps{grid-template-columns:1fr} .bs-rl{display:none} }
</style>`);
if (S.sport === 'baseball') { S.stack = []; const sh = $('sheet'); if (sh && !sh.querySelector('.sheet-empty')) { sh.innerHTML = emptySheet(); sh.classList.remove('open') } setTimeout(render, 0) }
