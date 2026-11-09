/* Floodlight · American football
   NFL, college (FBS, FCS, Division II, Division III) and UFL from ESPN; CFL from TheSportsDB;
   odds and futures from Kalshi through the local server. Loaded after the main app script and reuses its helpers. */
const FBB = 'https://site.api.espn.com/apis/site/v2/sports/football';
const FBB2 = 'https://site.api.espn.com/apis/v2/sports/football';
const FBW = 'https://site.web.api.espn.com/apis/common/v3/sports/football';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const FB_LEAGUES = [
  { key: 'nfl', path: 'nfl', name: 'NFL', area: 'Pro · USA', kx: 'NFL', hfa: 1.8, sd: 13.5 },
  { key: 'fbs', path: 'college-football', group: 80, name: 'College FBS', area: 'NCAA Division I', kx: 'NCAAF', hfa: 3, sd: 16, college: true },
  { key: 'fcs', path: 'college-football', group: 81, name: 'College FCS', area: 'NCAA Division I', kx: 'NCAAFCS', hfa: 3, sd: 16, college: true },
  { key: 'd2', path: 'college-football', group: 57, name: 'Division II', area: 'NCAA', kx: null, hfa: 3, sd: 17, college: true, ownLogo: true,
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/NCAA_DII_logo_c.svg/330px-NCAA_DII_logo_c.svg.png' },
  { key: 'd3', path: 'college-football', group: 58, name: 'Division III', area: 'NCAA', kx: 'NCAAFD3', hfa: 3, sd: 17, college: true, ownLogo: true,
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/NCAA_DIII_logo_c.svg/330px-NCAA_DIII_logo_c.svg.png' },
  { key: 'ufl', path: 'ufl', name: 'UFL', area: 'Pro · spring league (was XFL/USFL)', kx: 'UFL', hfa: 2, sd: 14 },
  { key: 'cfl', tsdb: 4405, name: 'CFL', area: 'Pro · Canada', kx: 'CFL', hfa: 2.5, sd: 14 },
];
const FBL = Object.fromEntries(FB_LEAGUES.map(l => [l.key, l]));
S.sport = store.get('fl.sport', 'soccer');
S.fb = { lg: store.get('fl.fbLg', 'nfl'), view: 'games', weeks: {}, data: {}, stand: {}, teams: {}, futures: null };
const fbLogoCache = new Map();          // "scope|team name" -> logo, kept apart per league (nfl, college, ufl, cfl)
const fbScope = key => FBL[key]?.college ? 'college' : key;
const fbSetLogo = (key, name, logo) => { if (name && logo) fbLogoCache.set(`${fbScope(key)}|${name}`, logo) };
// ESPN headshot for any football player, even when a feed leaves the link out
const fbShot = (a, key) => a?.headshot?.href || (a?.id ? `https://a.espncdn.com/i/headshots/${FBL[key]?.college ? 'college-football' : 'nfl'}/players/full/${a.id}.png` : SIL);

/* ---------- loading games ---------- */
function fbUrl(l, wk){
  const p = new URLSearchParams(); if (l.group) p.set('groups', l.group); p.set('limit', '300');
  if (wk) { p.set('week', wk.week); if (wk.type) p.set('seasontype', wk.type) }
  return `${FBB}/${l.path}/scoreboard?${p}`;
}
function fbNorm(ev, l){
  const c = ev.competitions?.[0]; if (!c) return null;
  const st = c.status?.type || {};
  const side = ha => { const x = c.competitors.find(t => t.homeAway === ha) || {}, t = x.team || {};
    fbSetLogo(l.key, t.displayName, t.logo || t.logos?.[0]?.href);
    return { id: t.id, name: t.shortDisplayName || t.displayName || t.name, full: t.displayName, abbr: t.abbreviation, logo: t.logo || t.logos?.[0]?.href || '',
      color: t.color, alt: t.alternateColor, score: (typeof x.score === 'object' ? x.score?.displayValue : x.score) ?? '', winner: x.winner,
      record: x.records?.[0]?.summary || x.record?.[0]?.displayValue || '', rank: x.curatedRank?.current && x.curatedRank.current <= 25 ? x.curatedRank.current : null,
      lines: (x.linescores || []).map(q => q.value ?? q.displayValue) } };
  const home = side('home'), away = side('away');
  const [hc, ac] = teamColors(home, away);
  const o = c.odds?.[0];
  return { id: String(ev.id), src: 'fb', lg: l.key, path: l.path, date: new Date(ev.date), state: st.state, completed: st.completed, detail: st.shortDetail || st.detail || '',
    period: c.status?.period, clock: c.status?.displayClock, home, away, hc, ac, neutral: !!c.neutralSite, venue: c.venue?.fullName, city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(', '),
    tv: (c.broadcasts || []).flatMap(b => b.names || []).join(', '), espnOdds: o ? { details: o.details, ou: o.overUnder } : null,
    situation: c.situation ? { text: c.situation.downDistanceText || c.situation.shortDownDistanceText, poss: c.situation.possession, red: c.situation.isRedZone, last: c.situation.lastPlay?.text } : null,
    note: c.notes?.[0]?.headline || '', week: ev.week?.number };
}
function tsdbNorm(x, l){
  const ts = x.strTimestamp ? new Date(x.strTimestamp + 'Z') : new Date(`${x.dateEvent}T${x.strTime || '00:00:00'}Z`);
  const done = /finish|FT|AOT/i.test(x.strStatus || '') || (x.intHomeScore != null && ts < Date.now() - 4 * 36e5);
  const live = !done && x.intHomeScore != null && ts < Date.now();
  const side = (n, logo, sc) => { fbSetLogo('cfl', n, logo); return { id: 'cfl-' + n, name: n.replace(/^(Toronto|Montreal|Ottawa|Hamilton|Winnipeg|Saskatchewan|Calgary|Edmonton|British Columbia|BC)\s+/, ''), full: n, abbr: n.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase(), logo, color: null, alt: null, score: sc ?? '', record: '', lines: [] } };
  const home = side(x.strHomeTeam, x.strHomeTeamBadge, x.intHomeScore), away = side(x.strAwayTeam, x.strAwayTeamBadge, x.intAwayScore);
  home.color = fmColor(home.full); away.color = fmColor(away.full);
  const [hc, ac] = teamColors(home, away);
  return { id: 'cfl' + x.idEvent, src: 'tsdb', lg: l.key, date: ts, state: done ? 'post' : live ? 'in' : 'pre', completed: done, detail: done ? 'Final' : live ? (x.strProgress || 'Live') : '',
    home, away, hc, ac, venue: x.strVenue, city: x.strCity || '', tv: x.strTVStation || '', note: x.intRound && x.intRound < 100 ? `Week ${x.intRound}` : '' };
}
async function fbLoad(key, wk){
  const l = FBL[key], id = `${key}|${wk ? wk.type + '-' + wk.week : 'now'}`;
  if (S.fb.data[id]?.events && Date.now() - S.fb.data[id].at < 30000) return S.fb.data[id];
  try {
    let evs = [], meta = {};
    if (l.tsdb) {
      const start = wk?.start ? new Date(wk.start) : (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 5) % 7)); d.setHours(12); return d })();   // Wednesday-to-Tuesday week
      const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d });
      const res = await Promise.allSettled(days.map(d => cj(`${TSDB}/eventsday.php?d=${isoDay(d)}&l=${l.tsdb}`)));
      res.forEach(r => r.status === 'fulfilled' && (r.value.events || []).forEach(x => evs.push(tsdbNorm(x, l))));
      meta = { label: `${days[0].toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString([], { day: 'numeric', month: 'short' })}`, start: start.toISOString() };
    } else {
      let d = await getJSON(fbUrl(l, wk));
      evs = (d.events || []).map(ev => fbNorm(ev, l)).filter(Boolean);
      // between weeks ESPN still reports the finished week as "current": move on to the next one
      if (!wk && evs.length && evs.every(e => e.state === 'post') && d.week?.number) {
        const n = await getJSON(fbUrl(l, { week: d.week.number + 1, type: d.season?.type })).catch(() => null);
        const nevs = (n?.events || []).map(ev => fbNorm(ev, l)).filter(Boolean);
        if (nevs.length) { d = n; evs = nevs }
      }
      const lg = d.leagues?.[0]; if (lg?.logos?.[0]?.href && !l.ownLogo) l.logo = lg.logos[0].href;
      meta = { week: d.week?.number, type: d.season?.type, label: d.week?.number ? `${d.season?.type === 3 ? 'Postseason · ' : ''}Week ${d.week.number}` : '', season: d.season?.year,
        calendar: lg?.calendar };
    }
    S.fb.data[id] = { events: evs.sort((a, b) => a.date - b.date), meta, at: Date.now() };
    if (!wk) S.fb.weeks[key] = S.fb.weeks[key] || { week: meta.week, type: meta.type, start: meta.start };
  } catch { S.fb.data[id] = { error: true, events: [], at: Date.now() } }
  return S.fb.data[id];
}
const fbWeekOf = key => S.fb.cur?.[key] || null;     // the week the viewer navigated to (null = this week)
async function fbOddsForList(evs){
  const groups = {}; evs.filter(e => e.state !== 'post' && FBL[e.lg].kx).forEach(e => (groups[FBL[e.lg].kx] ||= []).push(e));
  await Promise.allSettled(Object.entries(groups).map(async ([pre, list]) => {
    const kevs = await kxSeries(pre, 'GAME');
    for (const e of list) { const k = kxFind(kevs, e); if (!k) continue; const ml = parseML(e, k); if (ml) { const o = S.odds.get(e.id) || {}; o.ml = ml; S.odds.set(e.id, o) } }
  }));
}

/* ---------- main column ---------- */
function fbRail(){
  const c = S.fb.counts || {}, on = k => S.fb.view === 'games' && S.fb.lg === k ? ' on' : '';
  const favs = S.fav.filter(f => f.sport === 'football');
  let h = `<h4>Football</h4>
    <button class="lg${on('all')}" data-fblg="all"><span class="dot">●</span><span>All games this week</span></button>
    <button class="lg${S.fb.view === 'futures' ? ' on' : ''}" data-fbview="futures"><span class="dot">%</span><span>Futures & title odds</span></button>
    <button class="lg${S.fb.view === 'picks' ? ' on' : ''}" data-fbview="picks"><span class="dot">%</span><span>Predictions</span></button>`;
  if (favs.length) h += `<h4>My teams</h4>` + favs.map(f => `<button class="lg" data-fbteam="${esc(f.tid)}" data-fbl="${esc(f.lg)}"><img src="${esc(f.logo)}" alt=""><span>${esc(f.name)}</span></button>`).join('');
  h += `<h4>Pro</h4>` + FB_LEAGUES.filter(l => !l.college).map(l => `<button class="lg${on(l.key)}" data-fblg="${l.key}">${l.logo ? `<img src="${esc(l.logo)}" alt="">` : '<span class="dot">●</span>'}<span>${esc(l.name)}</span>${c[l.key]?.live ? `<b class="live">${c[l.key].live}</b>` : c[l.key]?.n ? `<b>${c[l.key].n}</b>` : ''}</button>`).join('');
  h += `<h4>College</h4>` + FB_LEAGUES.filter(l => l.college).map(l => `<button class="lg${on(l.key)}" data-fblg="${l.key}">${l.logo ? `<img src="${esc(l.logo)}" alt="">` : '<span class="dot">●</span>'}<span>${esc(l.name)}</span>${c[l.key]?.live ? `<b class="live">${c[l.key].live}</b>` : c[l.key]?.n ? `<b>${c[l.key].n}</b>` : ''}</button>`).join('');
  h += `<p class="pf-hint" style="padding:10px">NAIA and junior-college (NJCAA) football aren't covered: no free data source publishes them.</p>`;
  $('rail').innerHTML = h;
}
function fbCard(e){
  const post = e.state === 'post', hs = +e.home.score, as = +e.away.score, hl = post && hs < as, al = post && as < hs;
  const st = e.state === 'in' ? `<div class="st live"><span class="min">${esc(e.detail.replace(/ - /, ' '))}</span>LIVE</div>`
    : e.state === 'pre' ? `<div class="st"><span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}</div>` : `<div class="st">${esc(e.detail)}</div>`;
  const team = (t, lose) => `<div class="tm${lose ? ' lose' : ''}"><img src="${esc(t.logo)}" alt="" loading="lazy"><span>${t.rank ? `<em class="rk">${t.rank}</em>` : ''}${esc(t.name)}</span>${t.record ? `<small class="rec">${esc(t.record)}</small>` : ''}</div>`;
  const ml = S.odds.get(e.id)?.ml;
  const odds = e.state !== 'post' && ml?.home && ml?.away ? `<div class="oddrow" aria-hidden="true"><span class="${ml.home.p >= ml.away.p ? 'fav' : ''}">${esc(e.home.abbr)} ${pct(ml.home.p)}%</span><span class="${ml.away.p > ml.home.p ? 'fav' : ''}">${esc(e.away.abbr)} ${pct(ml.away.p)}%</span>${e.espnOdds?.details ? `<span>${esc(e.espnOdds.details)}</span>` : ''}</div>`
    : e.espnOdds?.details && e.state === 'pre' ? `<div class="oddrow" aria-hidden="true"><span>${esc(e.espnOdds.details)}</span>${e.espnOdds.ou ? `<span>O/U ${esc(e.espnOdds.ou)}</span>` : ''}</div>` : '';
  const sit = e.state === 'in' && e.situation?.text ? `<div class="fb-sit">${e.situation.red ? '<b>RED ZONE</b> ' : ''}${esc(e.situation.text)}</div>` : '';
  // ESPN lists the away team first in American football; keep that convention
  return `<button class="m fb" data-fbgame="${esc(e.id)}" data-fbl="${esc(e.lg)}" style="--hc:${e.ac};--ac:${e.hc}"
    aria-label="${esc(`${e.away.full} at ${e.home.full}. ${e.state === 'pre' ? 'Kick-off ' + e.date.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : `${e.away.score} to ${e.home.score}, ${e.detail}`}${ml?.home ? `. Kalshi: ${e.home.name} ${pct(ml.home.p)} percent` : ''}${e.tv ? '. On ' + e.tv : ''}`)}">
    ${st}<div class="tms">${team(e.away, al)}${team(e.home, hl)}${sit}${odds}</div>
    <div class="sc num">${e.state !== 'pre' ? `<span class="${al ? 'lose' : ''}">${esc(e.away.score)}</span><span class="${hl ? 'lose' : ''}">${esc(e.home.score)}</span>` : `<span class="tv">${esc(e.tv.split(',')[0] || '')}</span><span>&nbsp;</span>`}</div></button>`;
}
async function renderFootball(){
  const el = $('fb'); if (!el) return;
  fbRail();
  if (S.fb.view === 'futures') return renderFbFutures();
  if (S.fb.view === 'picks') return renderFbPicks();
  const key = S.fb.lg, keys = key === 'all' ? ['nfl', 'fbs', 'fcs', 'ufl', 'cfl'] : [key];
  const wk = key === 'all' ? null : fbWeekOf(key);
  const title = key === 'all' ? 'This week' : FBL[key].name;
  const cachedId = k => `${k}|${(k === key ? wk : null) ? wk.type + '-' + wk.week : 'now'}`;
  const have = keys.map(k => S.fb.data[cachedId(k)]).filter(Boolean);
  const paint = () => {
    const sets = keys.map(k => S.fb.data[cachedId(k)]).filter(Boolean);
    const evs = sets.flatMap(d => d.events), meta = sets[0]?.meta || {};
    const q = S.q.trim().toLowerCase();
    const list = evs.filter(e => (!q || `${e.home.full} ${e.away.full}`.toLowerCase().includes(q)) && (S.fb.filter !== 'live' || e.state === 'in') && (S.fb.filter !== 'fav' || S.fav.some(f => f.sport === 'football' && (f.tid === e.home.id || f.tid === e.away.id)))
      && (S.fb.filter !== 'top25' || e.home.rank || e.away.rank));
    S.fb.counts = {}; for (const k of keys) { const d = S.fb.data[cachedId(k)]; if (d) S.fb.counts[k] = { n: d.events.length, live: d.events.filter(e => e.state === 'in').length } }
    fbRail();
    const live = list.filter(e => e.state === 'in').length;
    const days = new Map(); for (const e of list) { const k = e.date.toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(e) }
    const navs = key !== 'all' ? `<div class="datebar"><button class="dnav" data-fbact="wk" data-to="-1" aria-label="Previous week">‹</button>
        <button class="dtoggle" data-fbact="wk" data-to="0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>${esc(meta.label || 'This week')}${wk ? '' : ' · this week'}</span></button>
        <button class="dnav" data-fbact="wk" data-to="1" aria-label="Next week">›</button></div>` : '';
    const chips = `<div class="quick">${[['all', 'All'], ['live', `Live${live ? ' · ' + live : ''}`], ['fav', '★ My teams'], ...(FBL[key]?.college || key === 'all' ? [['top25', 'Top 25']] : [])].map(([k, l]) => `<button class="qf" data-fbfilter="${k}" aria-pressed="${(S.fb.filter || 'all') === k}">${k === 'live' ? '<span class="dot"></span>' : ''}${l}</button>`).join('')}</div>`;
    el.innerHTML = navs + chips + `<div class="livebar"><h2>${esc(title)}</h2><span class="count">${list.length} game${list.length === 1 ? '' : 's'}${live ? ` · <span class="pill live">${live} live</span>` : ''}</span>
      ${key !== 'all' && !FBL[key].tsdb ? `<button class="btn ghost lginfo" data-fbact="lginfo">Standings${FBL[key].college ? ', rankings' : ''} & odds</button>` : ''}</div>`
      + (list.length ? [...days].map(([k, l]) => `<div class="group"><div class="group-h day-h"><strong>${esc(new Date(k).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}</strong></div><div class="cards">${l.map(fbCard).join('')}</div></div>`).join('')
        : `<div class="empty-state"><strong>${sets.some(d => d.error) ? "Couldn't load games" : 'No games'}</strong>${sets.some(d => d.error) ? 'Check your connection and try again.' : key === 'ufl' ? 'The UFL plays in spring (March to June). Use the arrows to look back at last season.' : 'Nothing scheduled for this week. Use the arrows to change week.'}</div>`)
      + (key === 'cfl' ? `<p class="srcnote">CFL games come from TheSportsDB's free feed, which can miss some games and has no player stats.</p>` : '');
  };
  if (have.length === keys.length) paint(); else el.innerHTML = '<div class="cards"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  await Promise.allSettled(keys.map(k => fbLoad(k, k === key ? wk : null)));
  if (S.sport !== 'football' || S.fb.view !== 'games' || S.fb.lg !== key) return;
  paint();
  fbOddsForList(keys.flatMap(k => S.fb.data[cachedId(k)]?.events || [])).then(() => { if (S.sport === 'football' && S.fb.view === 'games') paint() }).catch(() => {});
}
function fbTicker(){
  const all = Object.values(S.fb.data).flatMap(d => d.events || []); const seen = new Set();
  const live = all.filter(e => e.state === 'in' && !seen.has(e.id) && seen.add(e.id));
  const next = all.filter(e => e.state === 'pre' && e.date > Date.now() && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.date - b.date).slice(0, 6);
  const chip = e => `<button class="tk" data-fbgame="${esc(e.id)}" data-fbl="${esc(e.lg)}"><span class="mn ${e.state === 'in' ? '' : 'pre'}">${e.state === 'in' ? esc(e.detail.split(' ')[0]) : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><img src="${esc(e.away.logo)}" alt="">${esc(e.away.abbr)}${e.state === 'in' ? `<span class="s num">${esc(e.away.score)}–${esc(e.home.score)}</span>` : ' @ '}${esc(e.home.abbr)}<img src="${esc(e.home.logo)}" alt=""></button>`;
  $('ticker').hidden = !live.length && !next.length;
  $('ticker').innerHTML = (live.length ? `<span class="lab">${live.length} live</span>` + live.map(chip).join('') : '') + (next.length ? `<span class="lab next">Next up</span>` + next.map(chip).join('') : '');
}

/* ---------- standings ---------- */
async function fbStandings(key){
  const l = FBL[key]; if (!l || l.tsdb) return null;
  if (S.fb.stand[key]) return S.fb.stand[key];
  try {
    const d = await cj(`${FBB2}/${l.path}/standings${l.group ? '?group=' + l.group : ''}`);
    const groups = (d.children?.length ? d.children : [d]).map(g => ({ name: g.name, abbr: g.abbreviation, id: g.id, logo: fbConfLogo(key, g), entries: (g.standings?.entries || []).map(x => {
      const v = n => (x.stats || []).find(s => s.name === n || s.type === n || s.abbreviation === n); const num = n => +v(n)?.value || 0;
      fbSetLogo(key, x.team?.displayName, x.team?.logos?.[0]?.href);
      return { id: x.team?.id, name: x.team?.displayName, short: x.team?.shortDisplayName || x.team?.location, logo: x.team?.logos?.[0]?.href, w: num('wins'), l: num('losses'), t: num('ties'),
        pf: num('pointsFor'), pa: num('pointsAgainst'), pct: v('winPercent')?.displayValue || '', streak: v('streak')?.displayValue || '', seed: num('playoffSeed') || null,
        home: v('Home')?.displayValue || v('home')?.displayValue || '', road: v('Road')?.displayValue || v('road')?.displayValue || '', conf: v('vs. Conf.')?.displayValue || v('conferenceRecord')?.displayValue || '' } }) }));
    S.fb.stand[key] = groups; return groups;
  } catch { return S.fb.stand[key] = [] }
}
function fbTeamRow(key, id){ for (const g of S.fb.stand[key] || []) { const r = g.entries.find(x => x.id === id); if (r) return { ...r, group: g.name, groupLogo: g.logo } } return null }
// conference logos: ESPN keeps one per college conference id, and AFC/NFC badges for the NFL
function fbConfLogo(key, g){
  if (key === 'nfl' && /^(AFC|NFC)$/.test(g.abbreviation || '')) return `https://a.espncdn.com/i/teamlogos/nfl/500/${g.abbreviation.toLowerCase()}.png`;
  if (FBL[key]?.college && g.id && !/independent/i.test(g.name || '')) return `https://a.espncdn.com/i/teamlogos/ncaa_conf/500/${g.id}.png`;
  return '';
}
const confImg = (src, cls = 'conf-logo') => src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : '';
function fbStandingsHTML(key, hl = []){
  const gs = S.fb.stand[key]; if (!gs) return `<div class="skel" style="height:300px"></div>`;
  if (!gs.length) return `<div class="note">No standings published.</div>`;
  const show = gs.length > 4 && hl.length ? [...gs.filter(g => g.entries.some(x => hl.includes(x.id))), ...gs.filter(g => !g.entries.some(x => hl.includes(x.id)))] : gs;
  return show.map(g => `<div class="grp-name">${confImg(g.logo)}${esc(g.name)}</div><div class="tbl-wrap"><table><thead><tr>${key === 'nfl' ? '<th>Seed</th>' : '<th>#</th>'}<th>Team</th><th>W</th><th>L</th>${g.entries.some(x => x.t) ? '<th>T</th>' : ''}<th>PCT</th><th>PF</th><th>PA</th><th>DIFF</th><th>STRK</th></tr></thead><tbody>
    ${[...g.entries].sort((a, b) => key === 'nfl' && a.seed && b.seed ? a.seed - b.seed : (b.w - b.l) - (a.w - a.l) || (b.pf - b.pa) - (a.pf - a.pa)).map((x, i) => `<tr class="${hl.includes(x.id) ? 'hl' : ''}"><td class="r num">${key === 'nfl' && x.seed ? `<i style="background:${x.seed <= 7 ? 'var(--win)' : 'transparent'}"></i>${x.seed}` : i + 1}</td>
      <td class="t"><img src="${esc(x.logo || '')}" alt="" loading="lazy"><button class="linkbtn" data-fbteam="${esc(x.id)}" data-fbl="${esc(key)}">${esc(x.short || x.name)}</button></td><td>${x.w}</td><td>${x.l}</td>${g.entries.some(y => y.t) ? `<td>${x.t}</td>` : ''}<td>${esc(x.pct)}</td><td>${x.pf}</td><td>${x.pa}</td><td>${x.pf - x.pa > 0 ? '+' : ''}${x.pf - x.pa}</td><td>${esc(x.streak)}</td></tr>`).join('')}</tbody></table></div>`).join('')
    + (key === 'nfl' ? `<div class="notes"><span><i style="background:var(--win)"></i>Playoff seed (top 7 in each conference)</span></div>` : '');
}

/* ---------- prediction model ---------- */
const phi = x => { const t = 1 / (1 + .2316419 * Math.abs(x)), d = .3989423 * Math.exp(-x * x / 2), p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p };
function fbPredict(e){
  const l = FBL[e.lg], H = fbTeamRow(e.lg, e.home.id), A = fbTeamRow(e.lg, e.away.id);
  const rec = r => { const m = String(r || '').match(/(\d+)-(\d+)(?:-(\d+))?/); return m ? { w: +m[1], l: +m[2], t: +(m[3] || 0) } : null };
  const gp = x => x ? x.w + x.l + x.t : 0;
  const leagueAvg = 23;
  const rate = (x, k) => x && gp(x) ? (x[k] + leagueAvg * 2) / (gp(x) + 2) : null;         // points per game, shrunk toward average
  let rH = 0, rA = 0, totH = leagueAvg * 2, totA = leagueAvg * 2, base = 'table';
  if (H?.pf != null && gp(H) && A && gp(A)) { rH = rate(H, 'pf') - rate(H, 'pa'); rA = rate(A, 'pf') - rate(A, 'pa'); totH = rate(H, 'pf') + rate(A, 'pa'); totA = rate(A, 'pf') + rate(H, 'pa') }
  else { const a = rec(e.home.record), b = rec(e.away.record); base = a && b ? 'record' : 'none';
    if (a && b) { rH = ((a.w + 1) / (gp(a) + 2) - .5) * 20; rA = ((b.w + 1) / (gp(b) + 2) - .5) * 20 } }
  if (l.college && (e.home.rank || e.away.rank)) { rH += e.home.rank ? (26 - e.home.rank) * .25 : 0; rA += e.away.rank ? (26 - e.away.rank) * .25 : 0 }
  const outs = side => (e.inj?.[side] || []).filter(x => /out|doubtful|injured reserve/i.test(x.status)).length;
  const oH = outs('home'), oA = outs('away');
  const hfa = e.neutral ? 0 : l.hfa;
  let margin = (rH - rA) / 2 + hfa - Math.min(oH, 6) * .35 + Math.min(oA, 6) * .35;
  // each side's expected points = (its scoring rate + the opponent's conceding rate) / 2, so the game total is half the sum
  const T = Math.round(Math.min(80, Math.max(24, (totH + totA) / 2)) * 10) / 10;
  const model = phi(margin / l.sd);
  const ml = S.odds.get(e.id)?.ml;
  const market = ml?.home && ml?.away ? ml.home.p / (ml.home.p + ml.away.p) : null;
  // the sportsbook line and ESPN's matchup predictor (from the game summary) carry most of the weight when present
  const pc = e.sum?.pickcenter?.[0], fpiP = +e.sum?.predictor?.homeTeam?.gameProjection / 100 || null;
  const book = pc?.homeTeamOdds?.moneyLine && pc?.awayTeamOdds?.moneyLine ? (() => { const c = m => m > 0 ? 100 / (m + 100) : -m / (-m + 100), h = c(+pc.homeTeamOdds.moneyLine), a = c(+pc.awayTeamOdds.moneyLine); return h / (h + a) })() : null;
  const mk = market ?? book, parts = [[.55, mk], [.25, fpiP], [.2, model]].filter(x => x[1] != null);
  const pH = parts.reduce((a, [w, p]) => a + w * p, 0) / parts.reduce((a, [w]) => a + w, 0);
  const pick = pH >= .5 ? 'home' : 'away', top = Math.max(pH, 1 - pH);
  const conf = top >= .72 ? 'Strong' : top >= .58 ? 'Lean' : 'Toss-up';
  const effMargin = mk != null || fpiP != null ? (pH - .5) * l.sd * 2.5 : margin;
  const hs = Math.max(0, Math.round((T + effMargin) / 2)), as = Math.max(0, Math.round((T - effMargin) / 2));
  return { H, A, base, margin, effMargin, total: pc?.overUnder ? Math.round((.6 * pc.overUnder + .4 * T) * 10) / 10 : T, model, market, book, fpi: fpiP, pH, pick, top, conf, score: [hs, as], oH, oA, hfa, rH, rA };
}
function fbReasons(e, P){
  const out = [], hn = e.home.name, an = e.away.name, ppg = (x, k) => x && (x.w + x.l + x.t) ? (x[k] / (x.w + x.l + x.t)).toFixed(1) : null;
  if (P.base === 'table') {
    out.push(`Records: ${hn} ${P.H.w}-${P.H.l}${P.H.t ? '-' + P.H.t : ''}, ${an} ${P.A.w}-${P.A.l}${P.A.t ? '-' + P.A.t : ''}.`);
    out.push(`${hn} score ${ppg(P.H, 'pf')} and allow ${ppg(P.H, 'pa')} points a game; ${an} score ${ppg(P.A, 'pf')} and allow ${ppg(P.A, 'pa')}.`);
    if (P.H.home || P.A.road) out.push(`${hn} at home: ${P.H.home || '–'}. ${an} on the road: ${P.A.road || '–'}.`);
    if (P.H.streak || P.A.streak) out.push(`Streaks: ${hn} ${P.H.streak || '–'}, ${an} ${P.A.streak || '–'}.`);
  } else if (P.base === 'record') out.push(`No points data for this league, so the model works from the records (${hn} ${e.home.record}, ${an} ${e.away.record}).`);
  else out.push(`There's little data for these teams, so the model leans on home field${P.market != null ? ' and the market' : ''}.`);
  if (e.home.rank || e.away.rank) out.push(`AP rankings: ${[e.home.rank && `${hn} #${e.home.rank}`, e.away.rank && `${an} #${e.away.rank}`].filter(Boolean).join(', ')}.`);
  out.push(e.neutral ? 'Neutral site: no home-field edge.' : `Home field is worth about ${P.hfa} points to ${hn}.`);
  if (P.oH || P.oA) out.push(`Players listed out or doubtful: ${hn} ${P.oH}, ${an} ${P.oA}.`);
  out.push(`Model line: ${P.margin >= 0 ? hn : an} by ${Math.abs(P.margin).toFixed(1)}; projected total ${P.total.toFixed(1)} points.`);
  if (P.fpi != null) out.push(`ESPN's matchup predictor gives ${hn} ${pct(P.fpi)}%.`);
  if (P.book != null && P.market == null) out.push(`The sportsbook moneyline makes ${P.book >= .5 ? hn : an} a ${pct(Math.max(P.book, 1 - P.book))}% favourite (margin removed).`);
  if (P.market != null) { const mk = P.market, gap = P.model - mk;
    out.push(`Kalshi gives ${mk >= .5 ? hn : an} a ${pct(Math.max(mk, 1 - mk))}% chance.${Math.abs(gap) >= .05 ? ` The model is ${gap > 0 ? 'higher' : 'lower'} on ${hn} (${pct(P.model)}% vs ${pct(mk)}%).` : ' The model broadly agrees.'}`) }
  return out;
}

/* ---------- game page ---------- */
function openFbGame(id, lgKey){
  const all = Object.values(S.fb.data).flatMap(d => d.events || []);
  const e = all.find(x => x.id === String(id));
  if (!e) return;
  S.sel = null; S.stack = [{ type: 'fbgame', id: e.id, e, tab: e.state === 'pre' ? 'pred' : 'summary' }];
  renderSheet(); $('sheet').classList.add('open'); $('sheet').querySelector('.sheet-body')?.scrollTo(0, 0);
  fbLoadGame(S.stack[0]);
}
async function fbLoadGame(v){
  const e = v.e;
  fbStandings(e.lg).then(() => S.stack.includes(v) && renderSheet());
  if (FBL[e.lg].kx) fbGameOdds(e).then(() => S.stack.includes(v) && renderSheet()).catch(() => {});
  if (e.src === 'tsdb') { v.sum = { none: true }; return renderSheet() }
  try {
    const d = await getJSON(`${FBB}/${e.path}/summary?event=${e.id}`);
    v.sum = d; e.sum = d;
    e.inj = {}; for (const t of d.injuries || []) { const side = t.team?.id === e.home.id ? 'home' : 'away'; e.inj[side] = (t.injuries || []).map(x => ({ name: x.athlete?.displayName, id: x.athlete?.id, pos: x.athlete?.position?.abbreviation, status: x.status, detail: x.details?.type || x.details?.detail || '', headshot: fbShot(x.athlete, e.lg) })) }
  } catch { v.sum = { error: true } }
  if (S.stack.includes(v)) renderSheet();
}
async function fbGameOdds(e){
  const pre = FBL[e.lg].kx;
  const [g, sp, to] = await Promise.allSettled(['GAME', 'SPREAD', 'TOTAL'].map(k => kxSeries(pre, k)));
  const o = S.odds.get(e.id) || {};
  const kg = val(g) && kxFind(val(g), e); if (kg) o.ml = parseML(e, kg);
  const ks = val(sp) && kxFind(val(sp), e);
  if (ks) o.spread = (ks.markets || []).map(m => ({ side: sideOf(e, (m.yes_sub_title || '').replace(/ wins? by.*$/i, '')), line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.side && x.line).sort((a, b) => a.line - b.line);
  const kt = val(to) && kxFind(val(to), e);
  if (kt) o.total = (kt.markets || []).map(m => ({ line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.line).sort((a, b) => a.line - b.line);
  o.at = Date.now(); o.found = !!(kg || ks || kt); S.odds.set(e.id, o);
}
function fbHero(e, back){
  const s = e.state !== 'pre', lines = e.home.lines.length ? e.home.lines : null;
  const side = (t, ha) => `<div class="side"><img src="${esc(t.logo)}" alt=""><strong><button class="linkbtn" data-fbteam="${esc(t.id)}" data-fbl="${esc(e.lg)}">${t.rank ? `#${t.rank} ` : ''}${esc(t.full || t.name)}</button></strong><small class="rec">${esc(t.record || '')}${ha ? ` · ${ha}` : ''}</small></div>`;
  return `<div class="hero" style="--hc:${e.ac};--ac:${e.hc}">
    ${topBar(back).replace('<div class="hero-top">', `<div class="hero-top"><div class="lgname">${FBL[e.lg].logo ? `<img src="${esc(FBL[e.lg].logo)}" width="16" height="16" alt="">` : ''}<span>${esc(FBL[e.lg].name)}${e.week ? ' · Week ' + e.week : ''}${e.note ? ' · ' + esc(e.note) : ''}</span></div>`)}
    <div class="board">${side(e.away, 'Away')}
      <div class="score">${s ? `<div class="big num">${esc(e.away.score)}<em>–</em>${esc(e.home.score)}</div><div class="status">${e.state === 'in' ? `<span class="pill live">${esc(e.detail)}</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">${esc(e.detail)}</span>`}</div>`
        : `<div class="kick num">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="sub">${esc(e.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}${kickoffIn(e.date) ? '<br>' + kickoffIn(e.date) : ''}</div>`}</div>
      ${side(e.home, e.neutral ? 'Neutral' : 'Home')}</div>
    ${e.state === 'in' && e.situation?.text ? `<div class="fb-sit hero-sit">${e.situation.red ? '<b>RED ZONE</b> ' : ''}${esc(e.situation.text)}${e.situation.last ? ` · <span>${esc(e.situation.last)}</span>` : ''}</div>` : ''}
    ${lines ? `<div class="tbl-wrap"><table class="qtr"><thead><tr><th></th>${lines.map((_, i) => `<th>${i < 4 ? 'Q' + (i + 1) : 'OT'}</th>`).join('')}<th>T</th></tr></thead><tbody>
      ${[e.away, e.home].map(t => `<tr><td class="t">${esc(t.abbr)}</td>${t.lines.map(x => `<td>${esc(x)}</td>`).join('')}<td class="pts">${esc(t.score)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="meta-row">${e.venue ? `<span>${esc(e.venue)}${e.city ? ', ' + esc(e.city) : ''}</span>` : ''}${e.tv ? `<span>TV: ${esc(e.tv)}</span>` : ''}${e.espnOdds?.details ? `<span>Line: ${esc(e.espnOdds.details)}${e.espnOdds.ou ? ` · O/U ${esc(e.espnOdds.ou)}` : ''}</span>` : ''}</div></div>`;
}
function wpChart(e, wp){
  if (!wp?.length) return '';
  const W = 600, H = 150, xs = i => i / (wp.length - 1) * W, ys = p => H - p * H;
  const path = wp.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.homeWinPercentage).toFixed(1)}`).join(' ');
  const last = wp[wp.length - 1].homeWinPercentage;
  return `<div class="sub-h"><h5>Win probability</h5><small>${esc(e.home.name)} ${pct(last)}% · ${esc(e.away.name)} ${pct(1 - last)}%</small></div>
    <div class="flow"><svg viewBox="0 -6 ${W} ${H + 12}" role="img" aria-label="${esc(`Win probability over the game, ending with ${e.home.name} at ${pct(last)} percent`)}">
      <rect x="0" y="0" width="${W}" height="${H / 2}" fill="${e.hc}" fill-opacity=".08"/><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}" fill="${e.ac}" fill-opacity=".08"/>
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)"/>${[.25, .5, .75].map(f => `<line x1="${W * f}" x2="${W * f}" y1="0" y2="${H}" stroke="var(--line)" stroke-dasharray="3 3"/>`).join('')}
      <path d="${path}" fill="none" stroke="var(--fg)" stroke-width="2"/>
      <text x="6" y="14" font-size="11" fill="var(--fg)" font-weight="600">${esc(e.home.abbr)}</text><text x="6" y="${H - 6}" font-size="11" fill="var(--fg)" font-weight="600">${esc(e.away.abbr)}</text></svg></div>`;
}
function fbPane(v){
  const e = v.e, d = v.sum;
  if (v.tab === 'pred') return fbPredPane(e);
  if (v.tab === 'odds') return booksBlock(e) + `<div class="grp-name bk-kx">Kalshi live markets</div>` + fbOddsPane(e);
  if (v.tab === 'stand') { if (!S.fb.stand[e.lg]) fbStandings(e.lg).then(() => S.stack.includes(v) && renderSheet()); return fbStandingsHTML(e.lg, [e.home.id, e.away.id]) }
  if (!d) return `<div class="skel" style="height:260px"></div>`;
  if (d.none) return `<div class="note">Only scores and odds are available for this league.</div>`;
  if (d.error) return `<div class="note">Couldn't load this game. It retries when you reopen it.</div>`;
  if (v.tab === 'summary') {
    const sp = d.scoringPlays || [];
    const leaders = (d.leaders || []).map(t => { const side = t.team?.id === e.home.id ? e.home : e.away;
      return `<div><div class="head"><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px">${esc(side.name)}</div>${(t.leaders || []).map(c => { const a = c.leaders?.[0]; if (!a) return '';
        return `<button class="ldr fbl" data-fbplayer="${esc(a.athlete?.id)}" data-fbl="${esc(e.lg)}"><span class="cat">${esc(c.displayName || c.name)}</span><img class="face-s espn-shot" src="${esc(fbShot(a.athlete, e.lg))}" alt="" onerror="this.onerror=null;this.src=SIL"><span class="nm"><span>${esc(a.athlete?.displayName || '')}</span><small>${esc(a.displayValue || '')}</small></span></button>` }).join('')}</div>` }).join('');
    return wpChart(e, d.winprobability) + (leaders ? `<div class="sub-h"><h5>Game leaders</h5></div><div class="bench fb-leaders">${leaders}</div>` : '')
      + `<div class="sub-h"><h5>Scoring plays</h5><small>${sp.length}</small></div>${sp.length ? `<ol class="plays">${sp.map(p => { const t = p.team?.id === e.home.id ? e.home : e.away;
        return `<li><img src="${esc(t.logo)}" alt=""><span class="pq">Q${p.period?.number}<br>${esc(p.clock?.displayValue || '')}</span><span class="ptx"><strong>${esc(p.type?.abbreviation || p.type?.text || '')}</strong> ${esc(p.text)}</span><b class="num">${esc(p.awayScore)}–${esc(p.homeScore)}</b></li>` }).join('')}</ol>` : `<div class="note">${e.state === 'pre' ? 'Scoring plays appear here once the game starts.' : 'No scoring plays yet.'}</div>`}`;
  }
  if (v.tab === 'box') {
    const teams = d.boxscore?.teams || [];
    if (!teams.length) return `<div class="note">The box score appears once the game starts.</div>`;
    const by = id => teams.find(t => t.team?.id === id) || {}, H = by(e.home.id), A = by(e.away.id);
    const num = x => parseFloat(String(x ?? '').replace(/[^\d.]/g, '')) || 0;
    const rows = (A.statistics || []).map((s, i) => ({ label: s.label || s.name, a: s.displayValue, h: (H.statistics || [])[i]?.displayValue }));
    let html = `<div class="sub-h" style="margin-top:0"><h5>Team stats</h5><small>${esc(e.away.abbr)} · ${esc(e.home.abbr)}</small></div>` + rows.map(r => { const a = num(r.a), h = num(r.h), m = Math.max(a, h, 1);
      return `<div class="stat"><span class="v num ${a >= h && a ? 'lead' : ''}">${esc(r.a)}</span><div><div class="lbl">${esc(r.label)}</div><div class="bars"><span><i style="width:${a / m * 100}%;background:${e.ac}"></i></span><span><i style="width:${h / m * 100}%;background:${e.hc}"></i></span></div></div><span class="v num ${h >= a && h ? 'lead' : ''}">${esc(r.h)}</span></div>` }).join('');
    for (const t of d.boxscore?.players || []) {
      const side = t.team?.id === e.home.id ? e.home : e.away;
      html += `<div class="sub-h"><h5>${esc(side.name)} players</h5></div>` + (t.statistics || []).filter(g => g.athletes?.length).map(g => `<div class="grp-name" style="font-size:13px">${esc(g.text || g.name)}</div><div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Player</th>${g.labels.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
        ${g.athletes.map(a => `<tr><td class="t"><img src="${esc(fbShot(a.athlete, e.lg))}" alt="" style="border-radius:50%;object-fit:cover;object-position:50% 20%" onerror="this.onerror=null;this.src=SIL"><button class="linkbtn" data-fbplayer="${esc(a.athlete?.id)}" data-fbl="${esc(e.lg)}">${esc(a.athlete?.displayName || '')}</button></td>${(a.stats || []).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
    }
    return html;
  }
  if (v.tab === 'inj') {
    const sides = ['away', 'home'].map(k => { const list = e.inj?.[k] || [];
      return `<div><div class="head"><img src="${esc(e[k].logo)}" alt="" style="width:18px;height:18px">${esc(e[k].name)}<small>${list.length ? list.length + ' listed' : 'none'}</small></div><ul>${list.map(x => `<li><img class="mini" src="${esc(x.headshot || SIL)}" alt="" onerror="this.onerror=null;this.src=SIL"><span><button class="linkbtn" data-fbplayer="${esc(x.id)}" data-fbl="${esc(e.lg)}">${esc(x.name)}</button> <small style="display:inline">${esc(x.pos || '')}</small><small>${esc(x.detail)}</small></span><span class="stat-badge ${/out|reserve/i.test(x.status) ? 'injured' : /doubt|quest/i.test(x.status) ? 'suspended' : 'absent'}">${esc(x.status)}</span></li>`).join('') || '<li><span style="color:var(--muted)">No injuries reported.</span></li>'}</ul></div>` });
    return `<div class="bench news-out">${sides.join('')}</div><p class="srcnote">Official injury report from ESPN.</p>`;
  }
  return '';
}
function fbOddsPane(e){
  const o = S.odds.get(e.id);
  if (!FBL[e.lg].kx) return `<div class="note">Kalshi doesn't list games for ${esc(FBL[e.lg].name)}.</div>${e.espnOdds?.details ? `<p class="note">Bookmaker line (via ESPN): ${esc(e.espnOdds.details)}${e.espnOdds.ou ? `, total ${esc(e.espnOdds.ou)}` : ''}.</p>` : ''}`;
  if (!o?.at) { fbGameOdds(e).then(() => renderSheet()).catch(() => {}); return `<div class="skel" style="height:240px"></div>` }
  if (!o.found) return `<div class="note">${e.state === 'post' ? 'Markets for this game have closed.' : 'No Kalshi market found for this game yet.'}</div>`;
  let h = '';
  if (o.ml) h += `<div class="sub-h" style="margin-top:0"><h5>Moneyline · chance to win</h5><small>Kalshi</small></div><div class="mls" style="grid-template-columns:1fr 1fr">${['away', 'home'].map(k => { const x = o.ml[k]; if (!x) return '';
    return `<div class="ml${flashKey(e.id + k, x.p)}" style="--c:${k === 'home' ? e.hc : e.ac}"><span class="lbl">${esc(e[k].name)}</span><b class="num">${pct(x.p)}%</b><span class="am num">${american(x.p)} ${moveTag(x.p, x.prev)}</span><i style="width:${pct(x.p)}%"></i></div>` }).join('')}</div>`;
  if (o.spread?.length) h += `<div class="sub-h"><h5>Spread · win by more than</h5></div><div class="lines">${o.spread.map(x => `<div class="ln${flashKey(e.id + 's' + x.side + x.line, x.p)}"><span><b>${esc(e[x.side].abbr)} −${x.line}</b> <small>${esc(e[x.side].name)} by ${Math.ceil(x.line)}+</small></span><span class="bar"><i style="width:${pct(x.p)}%;background:${x.side === 'home' ? e.hc : e.ac}"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small> ${moveTag(x.p, x.prev)}</span></div>`).join('')}</div>`;
  if (o.total?.length) { const main = o.total.reduce((a, b) => Math.abs(b.p - .5) < Math.abs(a.p - .5) ? b : a);
    h += `<div class="sub-h"><h5>Total points · over</h5><small>Main line ${main.line}</small></div><div class="lines">${o.total.map(x => `<div class="ln${x === main ? ' main' : ''}${flashKey(e.id + 't' + x.line, x.p)}"><span><b>Over ${x.line}</b> <small>Under ${pct(1 - x.p)}%</small></span><span class="bar"><i style="width:${pct(x.p)}%;background:var(--accent)"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small> ${moveTag(x.p, x.prev)}</span></div>`).join('')}</div>` }
  return h + `<p class="srcnote">Prices from Kalshi, refreshed when you open this tab. ▲▼ show the 24-hour change. American odds are converted from the price and ignore fees.</p>`;
}
function fbPredPane(e){
  if (!S.fb.stand[e.lg] && !FBL[e.lg].tsdb) { fbStandings(e.lg).then(() => renderSheet()); return `<div class="skel" style="height:260px"></div>` }
  const P = fcApplyFootball(e, fbPredict(e)), post = e.state === 'post', win = post ? (+e.home.score > +e.away.score ? 'home' : 'away') : null;
  const o = S.odds.get(e.id), mainTotal = o?.total?.length ? o.total.reduce((a, b) => Math.abs(b.p - .5) < Math.abs(a.p - .5) ? b : a) : null;
  const pickTeam = e[P.pick];
  return `<div class="pred-head"><div><h5>${post ? 'Pre-game prediction' : 'Floodlight prediction'}${fcTag(P)}</h5><strong class="pred-pick">${esc(pickTeam.name)} win</strong>
      <span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf} · ${pct(P.top)}%</span>${post ? `<span class="pred-out ${win === P.pick ? 'ok' : 'miss'}">${win === P.pick ? 'Called it' : 'Missed'} — final ${esc(e.away.score)}–${esc(e.home.score)}</span>` : ''}</div>
      <div class="pred-score"><small>Projected score</small><b class="num">${P.score[1]}–${P.score[0]}</b><small>${esc(e.away.abbr)} – ${esc(e.home.abbr)}</small></div></div>
    <div class="pbar" role="img" aria-label="${esc(`${e.away.name} ${pct(1 - P.pH)} percent, ${e.home.name} ${pct(P.pH)} percent`)}"><i style="flex-grow:${1 - P.pH};background:${e.ac}"><span>${pct(1 - P.pH)}%</span></i><i style="flex-grow:${P.pH};background:${e.hc}"><span>${pct(P.pH)}%</span></i></div>
    <div class="pred-legend"><span><i style="background:${e.ac}"></i>${esc(e.away.name)}</span><span><i style="background:${e.hc}"></i>${esc(e.home.name)}</span></div>
    <div class="tiles pred-tiles"><div class="tile"><b class="num">${P.effMargin >= 0 ? esc(e.home.abbr) : esc(e.away.abbr)} −${Math.abs(P.effMargin).toFixed(1)}</b><span>Projected spread</span></div>
      <div class="tile"><b class="num">${P.total.toFixed(1)}</b><span>Projected total${mainTotal ? ` · Kalshi ${mainTotal.line}` : ''}</span></div>
      <div class="tile"><b class="num">${P.market != null ? pct(P.market) + '%' : '–'}</b><span>${esc(e.home.abbr)} on Kalshi</span></div></div>
    ${propsBlock(e)}${fcBlock(e)}
    <div class="sub-h"><h5>Why</h5></div><ul class="why">${fbReasons(e, P).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="srcnote">Model: each team's points scored and allowed per game (shrunk toward average early in the season), home field, AP rank for college games and the injury report. The shown chance weighs the betting market (Kalshi, or the sportsbook line) at 55%, ESPN's matchup predictor at 25% and the model at 20%, using whichever are available. Once the scheduled forecasts start, the latest one replaces these numbers.</p>${RG}`;
}

/* ---------- team & player pages ---------- */
function openFbTeam(id, lgKey){
  pushView({ type: 'fbteam', id: String(id), lg: lgKey || 'nfl', tab: 'sched' });
  const v = S.stack[S.stack.length - 1], l = FBL[v.lg];
  if (l.tsdb) { v.err = true; return renderSheet() }
  Promise.allSettled([cj(`${FBB}/${l.path}/teams/${id}/schedule`), cj(`${FBB}/${l.path}/teams/${id}/roster`), fbStandings(v.lg)]).then(([s, r]) => {
    v.sched = val(s); v.roster = val(r); v.team = v.sched?.team || v.roster?.team; if (!v.team) v.err = true; if (S.stack.includes(v)) renderSheet() });
  if (v.lg === 'nfl' || l.college) fbLoadFutures().then(() => S.stack.includes(v) && renderSheet());
}
function fbTeamHero(v, back){
  const t = v.team, l = FBL[v.lg], row = t ? fbTeamRow(v.lg, t.id) : null;
  const col = hex(t?.color) && lum(hex(t.color)) > .03 ? hex(t.color) : '#3D6FD9';
  v.color = col;
  const favId = `fb-${v.lg}-${v.id}`;
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead">${t ? `<img class="crest" src="${esc(t.logo || t.logos?.[0]?.href || '')}" alt="">` : ''}<div><h3>${esc(t?.displayName || 'Loading…')}</h3>
    <p>${t?.recordSummary ? `<span>${esc(t.recordSummary)}</span>` : row ? `<span>${row.w}-${row.l}${row.t ? '-' + row.t : ''}</span>` : ''}${t?.standingSummary ? `<span>${confImg(row?.groupLogo, 'conf-logo sm')}${esc(t.standingSummary)}</span>` : row?.group ? `<span>${confImg(row.groupLogo, 'conf-logo sm')}${esc(row.group)}</span>` : ''}<span>${esc(l.name)}</span></p>
    ${t ? `<button class="favbtn" data-fbact="fav" aria-pressed="${S.fav.some(f => f.id === favId)}">${S.fav.some(f => f.id === favId) ? '★ Following' : '☆ Follow'}</button>` : ''}</div></div>
    ${row ? `<div class="tiles"><div class="tile"><b class="num">${row.w}-${row.l}</b><span>Record</span></div><div class="tile"><b class="num">${(row.pf / Math.max(1, row.w + row.l + row.t)).toFixed(1)}</b><span>Points a game</span></div><div class="tile"><b class="num">${(row.pa / Math.max(1, row.w + row.l + row.t)).toFixed(1)}</b><span>Allowed a game</span></div><div class="tile"><b class="num">${esc(row.streak || '–')}</b><span>Streak</span></div></div>` : ''}</div>`;
}
function fbTeamPane(v){
  if (v.err) return `<div class="note">${FBL[v.lg].tsdb ? 'Team pages aren’t available for the CFL.' : 'Couldn’t load this team.'}</div>`;
  if (!v.team) return `<div class="skel" style="height:260px"></div>`;
  if (v.tab === 'sched') {
    const evs = (v.sched?.events || []).map(ev => ({ ev, c: ev.competitions?.[0] })).filter(x => x.c);
    if (!evs.length) return `<div class="note">No schedule published.</div>`;
    return `<div class="fbsched">${evs.map(({ ev, c }) => { const me = c.competitors.find(x => x.team?.id === v.id), op = c.competitors.find(x => x !== me) || {}; const st = c.status?.type || {};
      const sc = x => (typeof x?.score === 'object' ? x.score?.displayValue : x?.score) ?? '';
      const res = st.completed ? (me?.winner ? 'W' : op?.winner ? 'L' : 'T') : '';
      const d = new Date(ev.date);
      return `<div class="fx"><span class="d">${esc(ev.week?.text || (ev.week?.number ? 'Wk ' + ev.week.number : ''))}<br>${esc(fmtDate(d))}</span><span class="vs"><small>${me?.homeAway === 'home' ? 'vs' : '@'}</small><img src="${esc(op.team?.logos?.[0]?.href || op.team?.logo || '')}" alt=""><span><button class="linkbtn" data-fbteam="${esc(op.team?.id)}" data-fbl="${esc(v.lg)}">${esc(op.team?.displayName || 'TBD')}</button></span></span>
        <span class="r num">${st.completed ? `${esc(sc(me))}–${esc(sc(op))} <span class="res ${res === 'W' ? 'W' : res === 'L' ? 'L' : 'D'}">${res}</span>` : esc(d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span></div>` }).join('')}</div>`;
  }
  if (v.tab === 'roster') {
    const groups = v.roster?.athletes || []; if (!groups.length) return `<div class="note">No roster published.</div>`;
    const label = { offense: 'Offense', defense: 'Defense', specialTeam: 'Special teams', injuredReserveOrOut: 'Injured reserve / out', suspended: 'Suspended', practiceSquad: 'Practice squad' };
    return groups.map(g => { const items = g.items || []; if (!items.length) return '';
      return `<div class="sub-h"><h5>${esc(label[g.position] || g.position || 'Players')}</h5><small>${items.length}</small></div>` + items.map(a => `<button class="prow ph${/injured|suspend/i.test(g.position) ? ' out' : ''}" data-fbplayer="${esc(a.id)}" data-fbl="${esc(v.lg)}">
        <b>${esc(a.jersey ?? '–')}</b><img class="face-s espn-shot" src="${esc(fbShot(a, v.lg))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=SIL">
        <span class="nm"><span>${esc(a.displayName)}</span> ${a.injuries?.length ? `<span class="stat-badge injured">${esc(a.injuries[0].status || 'Injured')}</span>` : ''}<small>${esc([a.position?.abbreviation, a.age ? a.age + ' yrs' : '', a.displayHeight, a.displayWeight, a.college?.shortName || a.college?.name].filter(Boolean).join(' · '))}</small></span>
        <span class="st2">${a.experience?.years != null ? (a.experience.years ? a.experience.years + ' yr' + (a.experience.years > 1 ? 's' : '') : 'Rookie') : ''}</span></button>`).join('') }).join('');
  }
  if (v.tab === 'stand') return fbStandingsHTML(v.lg, [v.id]);
  if (v.tab === 'fut') {
    const F = S.fb.futures; if (!F) return `<div class="skel" style="height:200px"></div>`;
    const name = v.team.displayName, loc = v.team.location || '';
    const rows = F.groups.filter(g => g.lg === (FBL[v.lg].college ? 'college' : 'nfl') && !PLAYER_MARKETS.has(g.series) && !COACH_MARKETS.has(g.series)).map(g => { const r = g.rows.find(x => teamSim(x.name, name) >= .6 || (loc && teamSim(x.name, loc) >= .85)); return r ? { g, r } : null }).filter(Boolean);
    if (!rows.length) return `<div class="note">Kalshi has no title or playoff markets for this team right now.</div>`;
    return `<div class="tiles" style="grid-template-columns:repeat(${Math.min(4, rows.length)},minmax(0,1fr))">${rows.map(({ g, r }) => `<div class="tile"><b class="num">${r.p < .01 ? '<1' : pct(r.p)}%</b><span>${esc(g.label)}</span>${r.prev != null ? `<div style="margin-top:6px">${moveTag(r.p, r.prev)}</div>` : ''}</div>`).join('')}</div>
      <p class="srcnote">Live Kalshi prices; 25¢ means the market gives a 25% chance. ▲▼ show the 24-hour change.</p>${RG}`;
  }
  return '';
}
/* ---------- player pages: every stat by category, per game, rank and percentile vs the same position ---------- */
// Season stats come from ESPN's core API (every stat it tracks); the comparison pool is ESPN's league leaderboard
// for the player's position group, fetched once per season and kept in a compact form.
const FBCORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues';
const fbSeasonNow = () => { const d = new Date(); return d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear() };   // seasons start in late summer
const FBP_GROUPS = {
  QB: { pos: ['QB'], cat: 'offense:passing', label: 'QBs' },
  RB: { pos: ['RB', 'FB', 'HB'], cat: 'offense:rushing', label: 'RBs' },
  WR: { pos: ['WR'], cat: 'offense:receiving', label: 'WRs' },
  TE: { pos: ['TE'], cat: 'offense:receiving', label: 'TEs' },
  DL: { pos: ['DE', 'DT', 'NT', 'DL', 'EDGE'], cat: 'defense', label: 'defensive linemen', many: true },
  LB: { pos: ['LB', 'OLB', 'ILB', 'MLB'], cat: 'defense', label: 'linebackers', many: true },
  DB: { pos: ['CB', 'S', 'FS', 'SS', 'DB', 'SAF'], cat: 'defense', label: 'defensive backs', many: true },
  K: { pos: ['PK', 'K'], cat: 'specialTeams:kicking', label: 'kickers' },
  P: { pos: ['P'], cat: 'specialTeams:punting', label: 'punters' },
};
const fbGroupOf = abbr => Object.keys(FBP_GROUPS).find(k => FBP_GROUPS[k].pos.includes(abbr)) || null;
// per position: the hero numbers, the radar axes and extra candidates for strengths and weaknesses
const FBP_KEY = {
  QB: { tiles: ['passing.passingYards', 'passing.passingTouchdowns', 'passing.QBRating', 'passing.completionPct'],
    radar: [['passing.passingYards', 'Yards'], ['passing.passingTouchdowns', 'TDs'], ['passing.completionPct', 'Accuracy'], ['passing.yardsPerPassAttempt', 'Yds/att'], ['passing.interceptions', 'Avoids INTs'], ['rushing.rushingYards', 'Rushing']],
    more: ['passing.QBRating', 'passing.adjQBR', 'passing.sacks', 'rushing.rushingTouchdowns', 'passing.completions'] },
  RB: { tiles: ['rushing.rushingYards', 'rushing.yardsPerRushAttempt', 'rushing.rushingTouchdowns', 'receiving.receivingYards'],
    radar: [['rushing.rushingYards', 'Yards'], ['rushing.yardsPerRushAttempt', 'Yds/carry'], ['rushing.rushingTouchdowns', 'TDs'], ['rushing.rushingFirstDowns', '1st downs'], ['receiving.receptions', 'Catches'], ['receiving.receivingYards', 'Rec yards']],
    more: ['rushing.rushingAttempts', 'rushing.rushingBigPlays', 'rushing.rushingFumbles', 'receiving.receivingTouchdowns'] },
  WR: { tiles: ['receiving.receptions', 'receiving.receivingYards', 'receiving.receivingTouchdowns', 'receiving.yardsPerReception'],
    radar: [['receiving.receptions', 'Catches'], ['receiving.receivingYards', 'Yards'], ['receiving.yardsPerReception', 'Yds/catch'], ['receiving.receivingTouchdowns', 'TDs'], ['receiving.receivingYardsAfterCatch', 'YAC'], ['receiving.receivingFirstDowns', '1st downs']],
    more: ['receiving.receivingTargets', 'receiving.receivingBigPlays', 'receiving.receivingFumbles'] },
  DL: { tiles: ['defensive.sacks', 'defensive.tacklesForLoss', 'defensive.totalTackles', 'general.fumblesForced'],
    radar: [['defensive.sacks', 'Sacks'], ['defensive.tacklesForLoss', 'TFL'], ['defensive.totalTackles', 'Tackles'], ['defensive.soloTackles', 'Solo'], ['general.fumblesForced', 'Forced fum.'], ['defensive.passesDefended', 'Pass def.']],
    more: ['defensive.sackYards'] },
  LB: { tiles: ['defensive.totalTackles', 'defensive.sacks', 'defensive.tacklesForLoss', 'defensive.passesDefended'],
    radar: [['defensive.totalTackles', 'Tackles'], ['defensive.soloTackles', 'Solo'], ['defensive.tacklesForLoss', 'TFL'], ['defensive.sacks', 'Sacks'], ['defensive.passesDefended', 'Pass def.'], ['defensiveinterceptions.interceptions', 'INTs']],
    more: ['general.fumblesForced', 'defensive.assistTackles'] },
  DB: { tiles: ['defensive.totalTackles', 'defensiveinterceptions.interceptions', 'defensive.passesDefended', 'general.fumblesForced'],
    radar: [['defensive.passesDefended', 'Pass def.'], ['defensiveinterceptions.interceptions', 'INTs'], ['defensive.totalTackles', 'Tackles'], ['defensive.soloTackles', 'Solo'], ['defensive.tacklesForLoss', 'TFL'], ['general.fumblesForced', 'Forced fum.']],
    more: ['defensiveinterceptions.interceptionYards', 'defensive.sacks'] },
  K: { tiles: ['kicking.fieldGoalsMade', 'kicking.fieldGoalPct', 'kicking.longFieldGoalMade', 'kicking.extraPointPct'],
    radar: [['kicking.fieldGoalPct', 'FG %'], ['kicking.fieldGoalsMade', 'FGs made'], ['kicking.fieldGoalsMade50', '50+ made'], ['kicking.longFieldGoalMade', 'Long'], ['kicking.extraPointPct', 'XP %']],
    more: ['kicking.fieldGoalsMade40_49', 'kicking.extraPointsMade'] },
  P: { tiles: ['punting.punts', 'punting.grossAvgPuntYards', 'punting.netAvgPuntYards', 'punting.puntsInside20'],
    radar: [['punting.grossAvgPuntYards', 'Gross avg'], ['punting.netAvgPuntYards', 'Net avg'], ['punting.puntsInside20', 'Inside 20'], ['punting.longPunt', 'Long'], ['punting.touchbacks', 'Few TBs']],
    more: ['punting.puntReturnYards'] },
};
FBP_KEY.TE = FBP_KEY.WR;
const FBP_ORDER = { QB: ['passing', 'rushing', 'receiving', 'scoring', 'general'], RB: ['rushing', 'receiving', 'returning', 'passing', 'scoring', 'general'], WR: ['receiving', 'rushing', 'returning', 'passing', 'scoring', 'general'],
  TE: ['receiving', 'rushing', 'returning', 'passing', 'scoring', 'general'], DL: ['defensive', 'defensiveinterceptions', 'general', 'returning', 'scoring'], LB: ['defensive', 'defensiveinterceptions', 'general', 'returning', 'scoring'],
  DB: ['defensive', 'defensiveinterceptions', 'returning', 'general', 'scoring'], K: ['kicking', 'scoring', 'punting', 'general'], P: ['punting', 'kicking', 'general'] };
const FBP_FIRST = {
  passing: ['passingYards', 'passingTouchdowns', 'interceptions', 'completions', 'passingAttempts', 'completionPct', 'yardsPerPassAttempt', 'QBRating', 'adjQBR', 'QBR', 'sacks', 'sackYardsLost', 'passingFirstDowns', 'longPassing'],
  rushing: ['rushingYards', 'rushingAttempts', 'yardsPerRushAttempt', 'rushingTouchdowns', 'rushingFirstDowns', 'rushingBigPlays', 'longRushing'],
  receiving: ['receptions', 'receivingTargets', 'receivingYards', 'yardsPerReception', 'receivingTouchdowns', 'receivingYardsAfterCatch', 'receivingFirstDowns', 'receivingBigPlays', 'longReception'],
  defensive: ['totalTackles', 'soloTackles', 'assistTackles', 'sacks', 'tacklesForLoss', 'QBHits', 'hurries', 'passesDefended', 'stuffs'],
  kicking: ['fieldGoalsMade', 'fieldGoalAttempts', 'fieldGoalPct', 'longFieldGoalMade', 'extraPointsMade', 'extraPointAttempts', 'extraPointPct'],
  punting: ['punts', 'puntYards', 'grossAvgPuntYards', 'netAvgPuntYards', 'puntsInside20', 'longPunt', 'touchbacks'],
  scoring: ['totalPoints', 'totalTouchdowns'], general: ['gamesPlayed'],
};
// stats where a smaller number is better
const FBP_LOW = new Set(['passing.interceptions', 'passing.sacks', 'passing.sackYardsLost', 'passing.interceptionPct', 'passing.passingFumbles', 'passing.passingFumblesLost',
  'rushing.rushingFumbles', 'rushing.rushingFumblesLost', 'rushing.stuffs', 'rushing.stuffYardsLost', 'receiving.receivingFumbles', 'receiving.receivingFumblesLost',
  'general.fumbles', 'general.fumblesLost', 'punting.puntsBlocked', 'punting.touchbacks', 'punting.puntReturns', 'punting.puntReturnYards', 'punting.avgPuntReturnYards']);
// ESPN repeats team-level or derived numbers inside each category; these add noise, not information
const FBP_SKIP = new Set(['avgGain', 'netTotalYards', 'netYardsPerGame', 'totalYards', 'yardsPerGame', 'totalOffensivePlays', 'teamGamesPlayed', 'totalPointsPerGame', 'ESPNQBRating', 'ESPNRBRating', 'ESPNWRRating',
  'quarterbackRating', 'yardsFromScrimmagePerGame', 'passingYardsPerGame', 'netPassingYardsPerGame', 'rushingYardsPerGame', 'receivingYardsPerGame', 'yardsAllowed', 'pointsAllowed', 'netPassingYards', 'netPassingAttempts']);
const FBP_SKIP_IN = { passing: ['totalTouchdowns', 'totalYardsFromScrimmage'], rushing: ['totalTouchdowns', 'totalYardsFromScrimmage'], receiving: ['totalTouchdowns', 'totalYardsFromScrimmage'] };
const FBP_ADV = new Set(['offensiveSnapPct', 'targetSharePct', 'yardsPerRouteRun', 'avgDepthOfTarget']);   // listed but mostly unfilled
const FBP_SHOW = { passing: s => s.passingAttempts > 0, rushing: s => s.rushingAttempts > 0, receiving: s => s.receptions > 0 || s.receivingTargets > 0,
  defensive: s => s.totalTackles > 0 || s.sacks > 0 || s.passesDefended > 0, defensiveinterceptions: (s, gk) => s.interceptions > 0 || gk === 'DB' || gk === 'LB',
  kicking: s => s.fieldGoalAttempts > 0 || s.extraPointAttempts > 0, punting: s => s.punts > 0, returning: s => s.kickReturns > 0 || s.puntReturns > 0, scoring: s => s.totalPoints > 0, general: () => true };
const FBP_CATNAME = { defensive: 'Defense', defensiveinterceptions: 'Interceptions', general: 'General & fumbles', returning: 'Kick & punt returns' };
const fbRate = n => /pct|avg|per[A-Z]|pergame|^long|rating|qbr|gamesPlayed/i.test(n);
const fbNum = t => { if (t == null || t === '-' || t === '') return null; const x = parseFloat(String(t).replace(/,/g, '')); return isFinite(x) ? x : null };
const FBP_LABEL = { 'passing.sacks': 'Sacks taken', 'passing.sackYardsLost': 'Sack yards lost', 'passing.interceptions': 'Interceptions thrown', 'passing.longPassing': 'Longest pass' };
const fbLbl = (k, x) => FBP_LABEL[k] || x.displayName;
const fbOrd = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) };

// league leaderboard for a position group, reduced to { id, pos, gp, s: { 'category.stat': number } }
const fbPools = new Map();
function fbPool(path, season, gk){
  const g = FBP_GROUPS[gk]; if (!g) return Promise.resolve(null);
  const key = `${path}|${season}|${g.cat}`;
  if (!fbPools.has(key)) fbPools.set(key, getJSON(`${FBW}/${path}/statistics/byathlete?category=${g.cat}&limit=${g.many ? 1000 : 400}&season=${season}&seasontype=2`).then(d => {
    const cats = (d.categories || []).map(c => ({ n: String(c.name).toLowerCase(), names: c.names || [] }));
    return (d.athletes || []).map(a => { const s = {};
      for (const c of a.categories || []) { const m = cats.find(x => x.n === String(c.name).toLowerCase()); if (!m) continue;
        (c.totals || []).forEach((t, i) => { const x = fbNum(t); if (x != null && m.names[i]) s[m.n + '.' + m.names[i]] = x }) }
      return { id: String(a.athlete?.id), pos: a.athlete?.position?.abbreviation, gp: s['general.gamesPlayed'] || 0, s } });
  }).catch(() => { fbPools.delete(key); return null }));
  return fbPools.get(key);
}
// players at the same position who played at least 40% of the most games anyone in the group played
const fbPeerCache = new WeakMap();
function fbPeers(pool, gk){
  if (!pool) return null; let m = fbPeerCache.get(pool); if (!m) fbPeerCache.set(pool, m = {});
  if (!m[gk]) { const g = FBP_GROUPS[gk], same = pool.filter(p => g.pos.includes(p.pos)), max = Math.max(0, ...same.map(p => p.gp));
    m[gk] = same.filter(p => p.gp >= Math.max(1, Math.ceil(max * .4))) }
  return m[gk];
}
function fbRankIn(v, key, val){
  const ss = v.ss?.[v.season], peers = ss?.peers; if (!peers || val == null) return null;
  const name = key.split('.')[1], rate = fbRate(name), low = FBP_LOW.has(key), gp = ss.gp;
  if ((!rate && !gp) || name === 'gamesPlayed') return null;
  const metric = (x, g) => rate ? x : x / g, mine = metric(val, gp), vals = [];
  for (const p of peers) { if (p.id === String(v.id)) continue; const x = p.s[key]; if (x != null) vals.push(metric(x, p.gp)) }
  if (vals.length < 8) return null;
  let better = 0, worse = 0;
  for (const m of vals) { if (low ? m < mine - 1e-9 : m > mine + 1e-9) better++; else if (low ? m > mine + 1e-9 : m < mine - 1e-9) worse++ }
  const ties = vals.length - better - worse;
  return { rank: better + 1, n: vals.length + 1, pc: Math.round(100 * (worse + ties / 2) / vals.length), perGame: !rate };
}

function openFbPlayer(id, lgKey){
  if (!id) return;
  pushView({ type: 'fbplayer', id: String(id), lg: lgKey || 'nfl', tab: 'stats' });
  const v = S.stack[S.stack.length - 1], l = FBL[v.lg] || FBL.nfl;
  Promise.allSettled([cj(`${FBW}/${l.path}/athletes/${id}`), cj(`${FBW}/${l.path}/athletes/${id}/overview`), cj(`${FBW}/${l.path}/athletes/${id}/stats`)]).then(([b, o, c]) => {
    v.bio = val(b)?.athlete; v.ov = val(o); v.car = val(c); if (!v.bio) v.err = true;
    else { v.gk = fbGroupOf(v.bio.position?.abbreviation); v.seasons = fbCareerYears(v); const now = fbSeasonNow();
      if (!v.seasons.includes(now) && (!v.seasons.length || v.seasons[0] >= now - 1)) { v.seasons.unshift(now); v.autoSeason = true }   // career tables can lag the current season
      fbSeasonLoad(v, v.seasons[0]) }
    if (S.stack.includes(v)) renderSheet() });
}
function fbCareerYears(v){
  const ys = new Set(); for (const c of v.car?.categories || []) for (const r of c.statistics || []) if (r.season?.year) ys.add(+r.season.year);
  return [...ys].sort((a, b) => b - a);
}
function fbSeasonLoad(v, yr){
  v.season = yr; v.ss ||= {}; if (v.ss[yr]) return;
  const l = FBL[v.lg] || FBL.nfl, ss = v.ss[yr] = { loading: true };
  Promise.allSettled([cj(`${FBCORE}/${l.path}/seasons/${yr}/types/2/athletes/${v.id}/statistics`), fbPool(l.path, yr, v.gk), cj(`${FBW}/${l.path}/athletes/${v.id}/gamelog?season=${yr}`)]).then(([st, pool, gl]) => {
    const cats = val(st)?.splits?.categories || [];
    ss.cats = cats.map(c => ({ name: String(c.name).toLowerCase(), title: c.displayName, stats: c.stats || [] }));
    ss.raw = {}; for (const c of ss.cats) for (const x of c.stats) ss.raw[c.name + '.' + x.name] = x;
    ss.gp = ss.raw['general.gamesPlayed']?.value || 0;
    ss.pool = val(pool); ss.peers = v.gk ? fbPeers(ss.pool, v.gk) : null;
    ss.qualified = !!ss.pool?.some(p => p.id === String(v.id));
    ss.gl = val(gl); ss.loading = false;
    if (!ss.cats.length && v.autoSeason && v.season === yr && v.seasons.length > 1) { v.autoSeason = false; v.seasons = v.seasons.filter(y => y !== yr); delete v.ss[yr]; return fbSeasonLoad(v, v.seasons[0]) }
    if (S.stack.includes(v)) renderSheet() });
}
const fbStatVal = x => x == null ? null : typeof x.value === 'number' ? x.value : fbNum(x.displayValue);
function fbPeerLabel(v){ const g = FBP_GROUPS[v.gk]; return g ? (FBL[v.lg]?.college ? 'college ' : '') + g.label : '' }

function fbPlayerHero(v, back){
  const a = v.bio, t = a?.team; const col = hex(t?.color) && lum(hex(t.color)) > .03 ? hex(t.color) : '#3D6FD9'; v.color = col;
  const ss = v.ss?.[v.season], keys = FBP_KEY[v.gk]?.tiles || [];
  let tiles = '';
  if (ss?.raw && keys.some(k => ss.raw[k])) {
    tiles = `<div class="tiles">${keys.map(k => { const x = ss.raw[k]; if (!x) return ''; const r = fbRankIn(v, k, fbStatVal(x));
      return `<div class="tile"><b class="num">${esc(x.displayValue)}</b><span>${esc(x.shortDisplayName || x.displayName)}</span>${r ? `<em class="fbt-rk">${fbOrd(r.rank)} of ${r.n}${r.perGame ? ' · per game' : ''}</em>` : ''}</div>` }).join('')}</div>
      <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(v.season)} regular season${ss.gp ? ` · ${ss.gp} game${ss.gp === 1 ? '' : 's'}` : ''}${ss.peers ? ` · ranked among ${esc(fbPeerLabel(v))}` : ''}</p>`;
  } else if (a?.statsSummary?.statistics?.length) tiles = `<div class="tiles">${a.statsSummary.statistics.slice(0, 4).map(s => `<div class="tile"><b class="num">${esc(s.displayValue)}</b><span>${esc(s.shortDisplayName || s.displayName)}</span>${s.rankDisplayValue ? `<em class="fbt-rk">${esc(s.rankDisplayValue)}</em>` : ''}</div>`).join('')}</div><p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(a.statsSummary.displayName || '')}</p>`;
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(a ? fbShot(a, v.lg) : SIL)}" alt="" onerror="this.onerror=null;this.src=SIL"><div><h3>${esc(a?.displayName || 'Loading…')}</h3>
    ${a ? `<p>${a.displayJersey ? `<span class="num">${esc(a.displayJersey)}</span>` : ''}<span>${esc(a.position?.displayName || '')}</span>${t ? `<span><img src="${esc(t.logos?.[0]?.href || '')}" alt=""> <button class="linkbtn" data-fbteam="${esc(t.id)}" data-fbl="${esc(v.lg)}">${esc(t.displayName)}</button></span>` : ''}</p>
      ${a.injuries?.length ? `<p><span class="stat-badge injured">${esc(a.injuries[0].status || 'Injured')}</span></p>` : ''}` : ''}</div></div>${tiles}</div>`;
}
function fbSeasonPicker(v){
  const ys = v.seasons?.length ? v.seasons : [v.season]; if (ys.length < 2) return '';
  return `<div class="tc-bar"><label class="season"><span>Season</span><select id="fbpSeason" aria-label="Season">${ys.map(y => `<option value="${y}" ${y === v.season ? 'selected' : ''}>${y} regular season</option>`).join('')}</select></label></div>`;
}
// one stat row: name, total, per game, rank, percentile bar
function fbStatRow(v, cat, x){
  const key = cat + '.' + x.name, n = fbStatVal(x), ss = v.ss[v.season], rate = fbRate(x.name);
  const pg = !rate && ss.gp && n != null ? n / ss.gp : null, r = n ? fbRankIn(v, key, n) : (FBP_LOW.has(key) && n === 0 ? fbRankIn(v, key, 0) : null);
  const pc = r?.pc, cls = pc == null ? '' : pc >= 70 ? 'hi' : pc < 30 ? 'lo' : '';
  const rk = r ? `<b class="num">${fbOrd(r.rank)}</b><small>/${r.n}</small>` : n && x.rank && x.rank > 0 ? `<small title="ESPN rank among all ${esc(FBL[v.lg]?.name || '')} players">${esc(x.rankDisplayValue || fbOrd(x.rank))}</small>` : '';
  const pgTxt = pg == null ? '' : pg >= 100 ? pg.toFixed(0) : pg >= 10 ? pg.toFixed(1) : pg.toFixed(2);
  return `<div class="fbps-row${n ? '' : ' z'}"><span class="ps-t" title="${esc(x.description || '')}">${esc(fbLbl(key, x))}</span><b class="num">${esc(x.displayValue)}</b><span class="num ps-90">${pgTxt}</span><span class="fbps-rk">${rk}</span>
    ${pc == null ? '<span class="ps-bar-c"></span><span></span>' : `<span class="ps-bar-c"><span class="ps-bar" role="img" aria-label="${pc} percentile"><i class="${cls}" style="width:${Math.max(2, pc)}%"></i></span></span><span class="num ps-p ${cls}">${pc}</span>`}</div>`;
}
function fbStatsBody(v){
  const ss = v.ss?.[v.season];
  if (!ss || ss.loading) return `<div class="skel" style="height:300px"></div>`;
  if (!ss.cats?.length) return `<div class="note">No ${esc(v.season)} regular-season stats for this player yet.</div>`;
  const vals = {}; for (const c of ss.cats) { vals[c.name] = {}; for (const x of c.stats) vals[c.name][x.name] = fbStatVal(x) || 0 }
  const order = FBP_ORDER[v.gk] || ss.cats.map(c => c.name);
  const shown = ss.cats.filter(c => (FBP_SHOW[c.name] || (s => Object.values(s).some(Boolean)))(vals[c.name], v.gk))
    .sort((a, b) => { const i = x => { const k = order.indexOf(x.name); return k < 0 ? 99 : k }; return i(a) - i(b) });
  let h = '';
  // strengths, weaknesses and radar, from the curated stats for the position
  const K = FBP_KEY[v.gk];
  if (K && ss.peers) {
    const cand = [...new Set([...K.tiles, ...K.radar.map(r => r[0]), ...K.more])].map(k => { const x = ss.raw[k]; if (!x) return null; const n = fbStatVal(x);
      const [cat] = k.split('.'); if (!shown.some(c => c.name === cat)) return null;
      const r = n || FBP_LOW.has(k) ? fbRankIn(v, k, n) : null; return r ? { k, x, r } : null }).filter(Boolean);
    const strong = cand.filter(c => c.r.pc >= 75).sort((a, b) => b.r.pc - a.r.pc).slice(0, 5), weak = cand.filter(c => c.r.pc <= 25).sort((a, b) => a.r.pc - b.r.pc).slice(0, 4);
    const chip = c => `<li><span>${esc(fbLbl(c.k, c.x))}</span><b class="num">${esc(c.x.displayValue)}</b><small>${fbOrd(c.r.rank)} of ${c.r.n}</small></li>`;
    const items = K.radar.map(([k, title]) => { const x = ss.raw[k]; const n = fbStatVal(x); const r = x && (n || FBP_LOW.has(k)) ? fbRankIn(v, k, n) : null;
      return x ? { title, value: (r?.pc ?? 0) / 100 } : null }).filter(Boolean);
    const rad = items.length >= 3 ? radarSVG({ title: 'vs ' + fbPeerLabel(v), items }, v.color || '#3D6FD9') : '';
    if (rad || strong.length || weak.length) h += `<div class="fbp-viz">${rad ? `<div class="radar"><h5>Compared with ${esc(fbPeerLabel(v))}</h5>${rad}<small>Percentile, 0–100 (100 = best). Totals are compared per game.</small></div>` : ''}
      <div class="fbp-sw">${strong.length ? `<h5>Best at</h5><ul class="fbp-chips hi">${strong.map(chip).join('')}</ul>` : ''}${weak.length ? `<h5>Below average</h5><ul class="fbp-chips lo">${weak.map(chip).join('')}</ul>` : ''}
        ${!ss.qualified && v.gk !== 'DL' && v.gk !== 'LB' && v.gk !== 'DB' ? `<p class="fbp-q">Not enough plays yet to make ESPN's qualified list, so these comparisons are rough.</p>` : ''}</div></div>`;
  }
  for (const c of shown) {
    const skipIn = FBP_SKIP_IN[c.name] || [], first = FBP_FIRST[c.name] || [];
    const list = c.stats.filter(x => !FBP_SKIP.has(x.name) && !skipIn.includes(x.name) && !(c.name !== 'general' && x.name === 'gamesPlayed') && !(FBP_ADV.has(x.name) && !fbStatVal(x)))
      .sort((a, b) => { const i = x => { const k = first.indexOf(x.name); return k < 0 ? 99 : k }; return i(a) - i(b) });
    if (!list.length) continue;
    const nz = list.filter(x => fbStatVal(x)), zero = list.filter(x => !fbStatVal(x));
    h += `<div class="sub-h"><h5>${esc(FBP_CATNAME[c.name] || c.title || c.name)}</h5><small>${list.length} stats</small></div>
      <div class="fbps-head" aria-hidden="true"><span></span><span style="text-align:right">Total</span><span style="text-align:right">Per game</span><span style="text-align:right">Rank</span><span class="ps-bar-c">Percentile</span><span class="fbps-pch">Pct</span></div>
      ${nz.map(x => fbStatRow(v, c.name, x)).join('')}${zero.length ? `<details class="fbp-zero"><summary>${zero.length} more at zero</summary>${zero.map(x => fbStatRow(v, c.name, x)).join('')}</details>` : ''}`;
  }
  if (!v.gk) h += `<p class="srcnote">ESPN doesn't publish individual stats for this position beyond games played, so there's nothing to rank.</p>`;
  const peers = ss.peers?.length;
  h += `<p class="srcnote">Per game = total ÷ ${ss.gp || 0} games played. ${peers ? `Rank and percentile compare per-game numbers (or rates such as completion %) with ${peers + 1} ${esc(fbPeerLabel(v))} who played at least 40% of the season so far; 100 = best, and for stats like interceptions thrown, fewer is better. ` : ''}A rank shown without a percentile is ESPN's own rank among every ${esc(FBL[v.lg]?.name || '')} player. Hover a stat name for its definition. Data from ESPN.</p>`;
  return h;
}
function fbGameLog(v){
  const ss = v.ss?.[v.season]; if (!ss || ss.loading) return `<div class="skel" style="height:240px"></div>`;
  const g = ss.gl, types = (g?.seasonTypes || []).filter(t => t.categories?.some(c => c.events?.length));
  if (!types.length) return `<div class="note">No games in ${esc(v.season)}.</div>`;
  const groups = g.categories || [], labels = g.labels || [];
  const head = `<thead>${groups.length > 1 ? `<tr><th></th><th></th>${groups.map(c => `<th colspan="${c.count}" style="text-align:center;border-bottom:1px solid var(--line)">${esc(c.displayName)}</th>`).join('')}</tr>` : ''}
    <tr><th style="text-align:left">Game</th><th>Result</th>${labels.map((x, i) => `<th title="${esc(g.displayNames?.[i] || '')}">${esc(x)}</th>`).join('')}</tr></thead>`;
  return types.map(t => { const rows = t.categories.flatMap(c => c.events || []), tot = t.categories.find(c => c.totals)?.totals;
    return `<div class="sub-h"><h5>${esc(t.displayName)}</h5><small>${rows.length} game${rows.length === 1 ? '' : 's'}</small></div><div class="tbl-wrap"><table class="ctable">${head}<tbody>${rows.map(x => { const ev = g.events?.[x.eventId] || {};
      return `<tr><td class="t">${ev.week ? `<span style="color:var(--muted)">W${esc(ev.week)}</span> ` : ''}${esc(ev.atVs || '')} <img src="${esc(ev.opponent?.logo || '')}" alt="">${esc(ev.opponent?.abbreviation || ev.opponent?.displayName || '')}</td><td><span class="res ${esc(ev.gameResult === 'W' ? 'W' : ev.gameResult === 'L' ? 'L' : 'D')}">${esc(ev.gameResult || '')}</span> ${esc(ev.score || '')}</td>${x.stats.map(y => `<td>${esc(y)}</td>`).join('')}</tr>` }).join('')}
      ${tot ? `<tr class="fbp-tot"><td style="text-align:left"><b>Total</b></td><td></td>${tot.map(y => `<td><b>${esc(y)}</b></td>`).join('')}</tr>` : ''}</tbody></table></div>` }).join('')
    + `<p style="font-size:11.5px;color:var(--muted)">${labels.map((x, i) => `${esc(x)} = ${esc(g.displayNames?.[i] || '')}`).join(' · ')}</p>`;
}
function fbCareer(v){
  const cats = (v.car?.categories || []).filter(c => c.statistics?.length);
  if (!cats.length) return `<div class="note">No career stats published.</div>`;
  const teams = v.car.teams || {};
  return cats.map(c => `<div class="sub-h"><h5>${esc(c.displayName || c.name)}</h5></div><div class="tbl-wrap"><table class="ctable"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team</th>${c.labels.map((x, i) => `<th title="${esc(c.displayNames?.[i] || '')}">${esc(x)}</th>`).join('')}</tr></thead><tbody>
    ${[...c.statistics].reverse().map(r => { const t = teams[r.teamSlug] || {};
      return `<tr><td style="text-align:left">${esc(r.season?.displayName || '')}</td><td style="text-align:left">${t.logos?.[0]?.href ? `<img src="${esc(t.logos[0].href)}" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:5px">` : ''}${esc(t.abbreviation || '')}</td>${r.stats.map(y => `<td>${esc(y)}</td>`).join('')}</tr>` }).join('')}
    ${c.totals?.length ? `<tr class="fbp-tot"><td style="text-align:left"><b>Career</b></td><td></td>${c.totals.map(y => `<td><b>${esc(y)}</b></td>`).join('')}</tr>` : ''}</tbody></table></div>`).join('')
    + `<p style="font-size:11.5px;color:var(--muted)">Regular season only. Hover a column for its full name.</p>`;
}
function fbPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  const a = v.bio; if (!a) return `<div class="skel" style="height:240px"></div>`;
  if (v.tab === 'stats') {
    const rows = [['Position', a.position?.displayName], ['Age', a.age ? `${a.age}${a.displayDOB ? ' · born ' + a.displayDOB : ''}` : ''], ['Height', a.displayHeight], ['Weight', a.displayWeight],
      ['College', a.college?.name], ['Experience', a.displayExperience || (a.experience?.years != null ? a.experience.years + ' seasons' : '')], ['Birthplace', [a.displayBirthPlace].filter(Boolean).join('')], ['Draft', a.displayDraft]].filter(r => r[1]);
    return fbSeasonPicker(v) + fbStatsBody(v) + `<div class="sub-h"><h5>Profile</h5></div><div class="bio">${rows.map(([k, x]) => `<div><span>${k}</span><strong>${esc(x)}</strong></div>`).join('')}</div>`;
  }
  if (v.tab === 'log') return fbSeasonPicker(v) + fbGameLog(v);
  if (v.tab === 'career') return fbCareer(v);
  if (v.tab === 'news') return newsList(v.ov?.news);
  return '';
}
document.addEventListener('change', ev => {
  if (ev.target.id !== 'fbpSeason') return;
  const v = S.stack[S.stack.length - 1]; if (v?.type !== 'fbplayer') return;
  fbSeasonLoad(v, +ev.target.value); renderSheet();
});
document.head.insertAdjacentHTML('beforeend', `<style>
.shell.sheet-wide > #fb{display:none!important}
.fbt-rk{display:block;margin-top:5px;font:600 10.5px/1.2 var(--f-mono);color:var(--fg);opacity:.75;font-style:normal}
.fbps-head,.fbps-row{display:grid;grid-template-columns:minmax(0,1fr) 64px 60px 58px minmax(60px,120px) 26px;gap:10px;align-items:center}
.fbps-head{font:600 9.5px/1.2 var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding-bottom:4px}
.fbps-row{padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.fbps-row b,.fbps-row .ps-90,.fbps-row .ps-p,.fbps-rk{text-align:right}.fbps-row .ps-90,.fbps-row .ps-p{color:var(--muted);font-size:12px}
.fbps-row .ps-t{min-width:0;overflow-wrap:anywhere;line-height:1.25}
.fbps-row.z{opacity:.55}.fbps-pch{display:none;text-align:right}.fbps-rk b{font-size:12.5px}.fbps-rk small{color:var(--muted);font-size:11px}
.fbps-row .ps-p.hi{color:var(--win);font-weight:700}.fbps-row .ps-p.lo{color:var(--loss);font-weight:700}
td .ps-bar-c,.ps-bar-c .ps-bar{display:block}
.ctable tr.fbp-tot td{border-top:2px solid var(--line)}
details.fbp-zero summary{cursor:pointer;font-size:12.5px;color:var(--muted);padding:8px 0}
.fbp-viz{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:20px;align-items:start;margin-bottom:8px}
.fbp-viz h5{margin:0 0 8px}.fbp-viz .radar small{display:block;margin-top:6px;color:var(--muted);font-size:11.5px;text-align:center}
.fbp-chips{list-style:none;margin:0 0 14px;padding:0}.fbp-chips li{display:grid;grid-template-columns:minmax(0,1fr) auto 64px;gap:8px;align-items:center;padding:7px 10px;border-radius:8px;margin-bottom:4px;font-size:13px}
.fbp-chips.hi li{background:color-mix(in oklab,var(--win) 13%,transparent)}.fbp-chips.lo li{background:color-mix(in oklab,var(--loss) 12%,transparent)}
.fbp-chips small{color:var(--muted);font-size:11px;text-align:right}.fbp-q{font-size:12px;color:var(--muted);margin:0}
@media (max-width:620px){ .fbp-viz{grid-template-columns:1fr} }
@media (max-width:520px){ .fbps-head,.fbps-row{grid-template-columns:minmax(0,1fr) 54px 46px 50px 26px;gap:6px}.fbps-row{font-size:13px}.ps-bar-c{display:none}.fbps-pch{display:block} }
</style>`);

/* ---------- futures ---------- */
const FB_FUTURES = [
  ['nfl', 'KXSB', 'Super Bowl'], ['nfl', 'KXNFLAFCCHAMP', 'AFC champion'], ['nfl', 'KXNFLNFCCHAMP', 'NFC champion'], ['nfl', 'KXNFLPLAYOFF', 'Make the playoffs'], ['nfl', 'KXNFLMVP', 'MVP'],
  ['nfl', 'KXNFLOPOTY', 'Offensive Player of the Year'], ['nfl', 'KXNFLDPOTY', 'Defensive Player of the Year'], ['nfl', 'KXNFLOROTY', 'Offensive Rookie of the Year'],
  ['nfl', 'KXNFLDROTY', 'Defensive Rookie of the Year'], ['nfl', 'KXNFLCPOTY', 'Comeback Player of the Year'], ['nfl', 'KXNFLCOTY', 'Coach of the Year'], ['nfl', 'KXNFLSBMVP', 'Super Bowl MVP'],
  ['college', 'KXNCAAFPLAYOFF', 'Make the College Football Playoff'], ['college', 'KXHEISMAN', 'Heisman Trophy'], ['college', 'KXNCAAFCONF', 'Champion’s conference'],
  ['college', 'KXNCAAFAWARD', 'Awards', true], ['college', 'KXNCAAFCOTY', 'Coach of the Year'],
  ['ufl', 'KXUFLCHAMP', 'UFL champion'],
];
async function fbLoadFutures(force){
  if (S.fb.futures && !force && Date.now() - S.fb.futures.at < 60000) return S.fb.futures;
  // logos come from the standings feeds (ESPN's team list doesn't allow browser access)
  await Promise.allSettled([fbStandings('nfl'), fbStandings('fbs'), fbStandings('ufl')]);
  // most series hold one event (the main market); "multi" series hold one event per award, each shown as its own list
  const res = await Promise.allSettled(FB_FUTURES.map(([lg, s, label, multi]) => cjT(`/api/kalshi/events?series_ticker=${s}&status=open&with_nested_markets=true&limit=${multi ? 30 : 5}`, 30000)
    .then(d => { const evs = (d.events || []).sort((a, b) => (b.markets?.length || 0) - (a.markets?.length || 0));
      return (multi ? evs : evs.slice(0, 1)).map((ev, i) => ({ lg, s: multi ? `${s}-${i}` : s, series: s, label: multi ? ev.title.replace(/\s*Winner\??$/i, '') : label, ev })) })));
  if (res.every(r => r.status === 'rejected')) return S.fb.futures = { offline: true, groups: [], at: Date.now() };
  const groups = [];
  for (const r of res) for (const g of r.status === 'fulfilled' ? r.value : []) {
    const rows = (g.ev.markets || []).map(m => ({ name: m.yes_sub_title || m.title, p: fprice(m), prev: +m.previous_price_dollars || null })).filter(x => x.name && x.p > 0).sort((a, b) => b.p - a.p);
    if (rows.length) groups.push({ ...g, title: g.ev.title, rows }) }
  return S.fb.futures = { groups, at: Date.now() };
}
const fbLogoFor = (name, scope) => {
  let best = '', score = 0;
  for (const [k, l] of fbLogoCache) { const [sc, n] = k.split(/\|(.*)/s); if (sc !== scope || !l) continue;
    const s_ = n.toLowerCase().startsWith(name.toLowerCase() + ' ') ? 1.1 : teamSim(n, name); if (s_ > score) { score = s_; best = l } }
  return score >= .6 ? best : '';
};
// player markets (MVP, Heisman): find the player's ESPN headshot by name
const fbFaceCache = new Map();
function fbFaceFor(name, scope){
  const k = scope + '|' + name; if (fbFaceCache.has(k)) return fbFaceCache.get(k);
  fbFaceCache.set(k, null);
  cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&type=player&sport=football&limit=3`).then(d => {
    const hit = (d.items || []).find(x => (scope === 'college' ? /college/.test(x.league || '') : x.league === scope) && teamSim(x.displayName, name) >= .85) || (d.items || []).find(x => teamSim(x.displayName, name) >= .85);
    fbFaceCache.set(k, hit ? (hit.headshot?.href || `https://a.espncdn.com/i/headshots/${scope === 'college' ? 'college-football' : 'nfl'}/players/full/${hit.id}.png`) : '');
    if (S.sport === 'football' && S.fb.view === 'futures') renderFbFutures();
  }).catch(() => fbFaceCache.set(k, ''));
  return null;
}
const PLAYER_MARKETS = new Set(['KXNFLMVP', 'KXHEISMAN', 'KXNFLOPOTY', 'KXNFLDPOTY', 'KXNFLOROTY', 'KXNFLDROTY', 'KXNFLCPOTY', 'KXNFLSBMVP', 'KXNCAAFAWARD']);
const COACH_MARKETS = new Set(['KXNFLCOTY', 'KXNCAAFCOTY']);
async function renderFbFutures(){
  const el = $('fb');
  const paint = () => { const F = S.fb.futures;
    if (!F) { el.innerHTML = '<div class="skel" style="height:300px"></div>'; return }
    if (F.offline) { el.innerHTML = serverNote('odds'); return }
    S.fb.showAll ||= {};
    el.innerHTML = `<div class="livebar"><h2>Futures & title odds</h2><span class="count">Live Kalshi prices</span></div>` + ['nfl', 'college', 'ufl'].map(lg => { const gs = F.groups.filter(g => g.lg === lg); if (!gs.length) return '';
      return `<div class="grp-name" style="font-size:22px">${lg === 'nfl' ? 'NFL' : lg === 'college' ? 'College football' : 'UFL'}</div>` + gs.map(g => { const all = S.fb.showAll[g.s], rows = all ? g.rows : g.rows.slice(0, 10), top = g.rows[0].p;
        const scope = g.lg === 'college' ? 'college' : g.lg, people = PLAYER_MARKETS.has(g.series), coach = COACH_MARKETS.has(g.series);
        return `<div class="sub-h"><h5>${esc(g.label)}</h5><small>${esc(g.title)}</small></div><div class="futs">${rows.map((x, i) => { const pic = people ? fbFaceFor(x.name, scope) : coach ? '' : fbLogoFor(x.name, scope);
          return `<div class="fut${flashKey(g.s + x.name, x.p)}"><b class="rk num">${i + 1}</b>${pic ? `<img class="${people ? 'fut-face' : ''}" src="${esc(pic)}" alt="" onerror="this.onerror=null;this.src=SIL">` : `<span class="av sm" style="width:22px;height:22px;font-size:9px;--av:#5C677D">${esc(initials(x.name))}</span>`}<span class="nm">${esc(x.name)}</span><span class="bar"><i style="width:${Math.max(2, x.p / top * 100)}%"></i></span><span class="pv num">${x.p < .01 ? '<1' : pct(x.p)}% <small>${american(x.p)}</small> ${moveTag(x.p, x.prev)}</span></div>` }).join('')}</div>
          ${g.rows.length > 10 ? `<button class="btn ghost" style="margin-top:8px" data-fbact="futall" data-to="${esc(g.s)}">${all ? 'Show top 10' : `Show all ${g.rows.length}`}</button>` : ''}` }).join('') }).join('')
      + `<p class="srcnote">Prices from Kalshi, refreshed every 30 seconds while this page is open; 25¢ means a 25% chance. ▲▼ show the 24-hour change.</p>${RG}`;
  };
  paint(); await fbLoadFutures(); if (S.sport === 'football' && S.fb.view === 'futures') paint();
}
setInterval(() => { if (!document.hidden && S.sport === 'football' && S.fb.view === 'futures') fbLoadFutures(true).then(() => S.fb.view === 'futures' && renderFbFutures()) }, 30000);

/* ---------- predictions list ---------- */
async function renderFbPicks(){
  const el = $('fb'), keys = S.fb.lg === 'all' ? ['nfl', 'fbs'] : [S.fb.lg];
  el.innerHTML = '<div class="skel" style="height:300px"></div>';
  await Promise.allSettled(keys.map(k => fbLoad(k, fbWeekOf(k))));
  await Promise.allSettled(keys.map(k => fbStandings(k)));
  const evs = keys.flatMap(k => S.fb.data[`${k}|${fbWeekOf(k) ? fbWeekOf(k).type + '-' + fbWeekOf(k).week : 'now'}`]?.events || []).filter(e => e.state !== 'post');
  await fbOddsForList(evs).catch(() => {});
  if (S.fb.view !== 'picks') return;
  const preds = evs.map(e => ({ e, P: fbPredict(e) })).sort((a, b) => b.P.top - a.P.top);
  // filters (predfilter.js): pro or college, league, confidence, kick-off, value against the market, my teams
  const items = preds.map(({ e, P }) => ({ e, P, id: e.id, lg: e.lg, lgName: FBL[e.lg].name, cat: FBL[e.lg].college ? 'college' : 'pro', order: FB_LEAGUES.indexOf(FBL[e.lg]), date: e.date, live: e.state === 'in',
    conf: P.conf, top: P.top, edge: P.market != null ? (P.pick === 'home' ? P.model - P.market : P.market - P.model) : null,
    fav: S.fav.some(f => f.sport === 'football' && (String(f.tid) === String(e.home.id) || String(f.tid) === String(e.away.id))),
    ranked: !!(e.home.rank || e.away.rank) }));
  const shown = PFX.apply('football', items);
  el.innerHTML = `<div class="livebar"><h2>Predictions</h2><span class="count">${preds.length} upcoming game${preds.length === 1 ? '' : 's'} · ${esc(keys.map(k => FBL[k].name).join(' + '))}</span></div>
    <div class="quick">${['all', ...FB_LEAGUES.filter(l => !l.tsdb).map(l => l.key)].map(k => `<button class="qf" data-fbpicklg="${k}" aria-pressed="${S.fb.lg === k}">${k === 'all' ? 'NFL + FBS' : esc(FBL[k].name)}</button>`).join('')}</div>
    ${PFX.bar('football', items, [['pro', 'Pro'], ['college', 'College']])}
    <div class="cards">${shown.map(({ e, P }) => `<button class="m pred-card fb" data-fbgame="${esc(e.id)}" data-fbl="${esc(e.lg)}" data-fbtab="pred" style="--hc:${e.ac};--ac:${e.hc}">
      <div class="st"><span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}</div>
      <div class="tms"><div class="tm"><img src="${esc(e.away.logo)}" alt=""><span>${e.away.rank ? `<em class="rk">${e.away.rank}</em>` : ''}${esc(e.away.name)}</span></div><div class="tm"><img src="${esc(e.home.logo)}" alt=""><span>${e.home.rank ? `<em class="rk">${e.home.rank}</em>` : ''}${esc(e.home.name)}</span></div>
        <div class="pbar"><i style="flex-grow:${1 - P.pH};background:${e.ac}"><span>${pct(1 - P.pH)}%</span></i><i style="flex-grow:${P.pH};background:${e.hc}"><span>${pct(P.pH)}%</span></i></div></div>
      <div class="pc-side"><span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf}</span><b>${esc(e[P.pick].name)}</b><small class="num">${P.score[1]}–${P.score[0]} · ${pct(P.top)}%</small><small class="pfx-lg">${esc(FBL[e.lg].name)}</small></div></button>`).join('') || PFX.empty('football', items.length) || '<div class="empty-state"><strong>No upcoming games</strong>Nothing left to play this week.</div>'}</div>${RG}`;
}

PFX.on('football', () => S.sport === 'football' && S.fb.view === 'picks' && renderFbPicks());

/* ---------- sheet rendering hook ---------- */
function fbRenderSheet(v){
  const sheet = $('sheet');
  const back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  let hero, tabs, body;
  if (v.type === 'fbgame') { const e = v.e; hero = fbHero(e, back);
    tabs = [['summary', 'Summary'], ['box', 'Box score'], ['odds', 'Odds'], ['pred', 'Prediction'], ...(e.lg === 'nfl' ? [['inj', 'Injuries']] : []), ['stand', 'Standings']];
    if (e.src === 'tsdb') tabs = [['odds', 'Odds'], ['pred', 'Prediction']];
    if (!tabs.some(t => t[0] === v.tab)) v.tab = tabs[0][0]; body = fbPane(v) }
  else if (v.type === 'fbteam') { hero = fbTeamHero(v, back); tabs = [['sched', 'Schedule'], ['roster', 'Roster'], ['stand', 'Standings'], ...(v.lg === 'nfl' || FBL[v.lg].college ? [['fut', 'Title odds']] : [])]; body = fbTeamPane(v) }
  else { hero = fbPlayerHero(v, back); tabs = [['stats', 'Stats'], ['log', 'Game log'], ['career', 'Career'], ['news', 'News']]; body = fbPlayerPane(v) }
  S.curTabs = tabs;
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  sheet.innerHTML = `<div class="sheet-body">${hero}${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel" style="--tc:${esc(v.color || 'var(--accent)')}">${body}</div></div>`;
  sheet.querySelector('.sheet-body').scrollTop = scroll;
}
function fbStandingsSheet(key){
  S.sel = null; S.stack = [{ type: 'fbgame-stand', id: key }];
  const sheet = $('sheet'), l = FBL[key];
  const paint = () => {
    const ranks = S.fb.ranks?.[key];
    sheet.innerHTML = `<div class="sheet-body"><div class="hero solo" style="--tc:var(--accent)">${topBar('<span></span>')}<div class="thead">${l.logo ? `<img class="crest" src="${esc(l.logo)}" alt="">` : ''}<div><h3>${esc(l.name)}</h3><p><span>${esc(l.area)}</span></p></div></div></div>
      <div class="pane">${ranks ? `<div class="sub-h" style="margin-top:0"><h5>${esc(ranks.name)}</h5></div><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Team</th><th>Record</th><th>Pts</th></tr></thead><tbody>${ranks.ranks.map(r => `<tr><td class="r num">${r.current}</td><td class="t"><img src="${esc(r.team?.logos?.[0]?.href || r.team?.logo || '')}" alt=""><button class="linkbtn" data-fbteam="${esc(r.team?.id)}" data-fbl="${esc(key)}">${esc(r.team?.location || r.team?.name || '')}</button></td><td>${esc(r.recordSummary || '')}</td><td>${esc(r.points ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="sub-h"${ranks ? '' : ' style="margin-top:0"'}><h5>Standings</h5></div>${fbStandingsHTML(key)}</div></div>`;
  };
  paint(); sheet.classList.add('open');
  fbStandings(key).then(paint);
  if (key === 'fbs' || key === 'fcs') cj(`${FBB}/college-football/rankings${key === 'fcs' ? '?groups=81' : ''}`).then(d => { (S.fb.ranks ||= {})[key] = d.rankings?.[0]; paint() }).catch(() => {});
}

/* ---------- search ---------- */
async function fbSearch(q){
  const box = $('sres'); if (q.trim().length < 2) { hideResults(); return }
  const [t, p] = await Promise.allSettled(['team', 'player'].map(ty => cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&type=${ty}&sport=football&limit=8`)));
  const lgOf = x => { const s = x.league || x.defaultLeagueSlug || ''; return s === 'nfl' ? 'nfl' : /college/.test(s) ? 'fbs' : s === 'ufl' ? 'ufl' : 'nfl' };
  const T = val(t)?.items || [], P = val(p)?.items || [];
  let h = '';
  if (T.length) h += `<div class="sr-h">Teams</div>` + T.map(x => `<button class="sr" data-fbteam="${esc(x.id)}" data-fbl="${lgOf(x)}"><img src="${esc(x.logos?.[0]?.href || '')}" alt=""><div><strong>${esc(x.displayName)}</strong><small>${esc((x.league || '').toUpperCase().replace('COLLEGE-FOOTBALL', 'College football'))}</small></div></button>`).join('');
  if (P.length) h += `<div class="sr-h">Players</div>` + P.map(x => `<button class="sr" data-fbplayer="${esc(x.id)}" data-fbl="${lgOf(x)}"><img class="face espn-shot" src="${esc(x.headshot?.href || `https://a.espncdn.com/i/headshots/${lgOf(x) === 'nfl' ? 'nfl' : 'college-football'}/players/full/${x.id}.png`)}" alt="" onerror="this.onerror=null;this.src=SIL"><div><strong>${esc(x.displayName)}</strong><small>${esc(x.teamRelationships?.[0]?.displayName || (x.league || '').toUpperCase())}</small></div></button>`).join('');
  box.innerHTML = h || `<div class="sr-none">No football teams or players match “${esc(q)}”.</div>`; box.hidden = false;
}

/* ---------- switching sport & events ---------- */
function setSport(sp){
  S.sport = sp; store.set('fl.sport', sp);
  document.documentElement.dataset.sport = sp;
  closeSheet(); S.page = 'matches'; render();
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('button[data-sport],[data-fblg],[data-fbview],[data-fbgame],[data-fbteam],[data-fbplayer],[data-fbact],[data-fbfilter],[data-fbpicklg]'); if (!t) return;
  hideResults();
  if (t.dataset.sport) return setSport(t.dataset.sport);
  if (t.dataset.fblg) { S.fb.lg = t.dataset.fblg; S.fb.view = 'games'; store.set('fl.fbLg', S.fb.lg); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.fbview) { S.fb.view = t.dataset.fbview; return render() }
  if (t.dataset.fbfilter) { S.fb.filter = t.dataset.fbfilter; return render() }
  if (t.dataset.fbpicklg) { S.fb.lg = t.dataset.fbpicklg; return render() }
  if (t.dataset.fbgame) { openFbGame(t.dataset.fbgame, t.dataset.fbl); if (t.dataset.fbtab) { S.stack[0].tab = t.dataset.fbtab; renderSheet() } return }
  if (t.dataset.fbteam) return openFbTeam(t.dataset.fbteam, t.dataset.fbl);
  if (t.dataset.fbplayer) return openFbPlayer(t.dataset.fbplayer, t.dataset.fbl);
  const a = t.dataset.fbact, v = S.stack[S.stack.length - 1];
  if (a === 'wk') { const key = S.fb.lg, base = S.fb.cur?.[key] || S.fb.weeks[key]; const n = +t.dataset.to;
    S.fb.cur ||= {};
    if (!n) delete S.fb.cur[key];
    else if (FBL[key].tsdb) { const d = new Date(base?.start || Date.now()); d.setDate(d.getDate() + 7 * n); S.fb.cur[key] = { start: d.toISOString(), type: 'w', week: isoDay(d) } }
    else if (base?.week) { let w = base.week + n, ty = base.type || 2; if (w < 1) { ty = ty === 3 ? 2 : ty; w = 1 } S.fb.cur[key] = { week: w, type: ty } }
    return render() }
  if (a === 'lginfo') return fbStandingsSheet(S.fb.lg);
  if (a === 'futall') { S.fb.showAll[t.dataset.to] = !S.fb.showAll[t.dataset.to]; return renderFbFutures() }
  if (a === 'fav' && v?.team) { const id = `fb-${v.lg}-${v.id}`;
    S.fav = S.fav.some(f => f.id === id) ? S.fav.filter(f => f.id !== id) : [...S.fav, { id, tid: v.id, sport: 'football', lg: v.lg, name: v.team.displayName, logo: v.team.logo || v.team.logos?.[0]?.href || '' }];
    savePrefs(); renderSheet(); fbRail() }
});
setInterval(() => { if (!document.hidden && S.sport === 'football' && S.fb.view === 'games') {
  const live = Object.values(S.fb.data).some(d => (d.events || []).some(e => e.state === 'in'));
  if (live) { for (const k in S.fb.data) S.fb.data[k].at = 0; renderFootball() }
  const v = S.stack[0]; if (v?.type === 'fbgame' && v.e.state === 'in') fbLoadGame(v) } }, 30000);
document.documentElement.dataset.sport = S.sport;
if (S.sport === 'football') setTimeout(render, 0);
