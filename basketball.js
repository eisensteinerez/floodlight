/* Floodlight · Basketball
   NBA, WNBA, men's and women's college basketball (NCAA Division I) and Australia's NBL from ESPN (read directly); EuroLeague, EuroCup, BCL, VTB, ABA, BAL, CBA, B.League, KBL, PBA,
   EASL and BCL Americas from Flashscore through the local server (/api/bb/…, see basketball.py). Bookmaker odds for every
   league come from Flashscore's odds comparison, plus ESPN's DraftKings line and Kalshi for the NBA and WNBA.
   Loaded after the main app script and football.js, and reuses their helpers. */
const BBE = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const BBE2 = 'https://site.api.espn.com/apis/v2/sports/basketball';
const BBW = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball';
const ESPN_LG = 'https://a.espncdn.com/i/teamlogos/leagues/500';
const BB_LEAGUES = [
  { key: 'nba', src: 'espn', path: 'nba', name: 'NBA', area: 'USA & Canada', region: 'North America', kx: 'NBA', hca: 2.4, sd: 12.5, logo: `${ESPN_LG}/nba.png` },
  { key: 'wnba', src: 'espn', path: 'wnba', name: 'WNBA', area: 'USA & Canada', region: 'North America', kx: 'WNBA', hca: 2.2, sd: 11.5, logo: `${ESPN_LG}/wnba.png` },
  // college: groups=50 asks ESPN for every Division I game, not just the featured ones
  { key: 'cbb', src: 'espn', path: 'mens-college-basketball', groups: 50, college: true, name: "Men's college (CBB)", short: 'CBB', area: 'NCAA Division I', region: 'College', kx: 'NCAAMB', hca: 3.2, sd: 11, total: 145, logo: `${ESPN_LG}/ncaa.png` },
  { key: 'wcbb', src: 'espn', path: 'womens-college-basketball', groups: 50, college: true, name: "Women's college (WCBB)", short: 'WCBB', area: 'NCAA Division I', region: 'College', kx: 'NCAAWB', hca: 3.4, sd: 12.5, total: 135, logo: `${ESPN_LG}/ncaa.png` },
  { key: 'euroleague', src: 'fs', name: 'EuroLeague', area: 'Europe · top club competition', region: 'Europe', hca: 3, sd: 11 },
  { key: 'eurocup', src: 'fs', name: 'EuroCup', area: 'Europe', region: 'Europe', hca: 3, sd: 11.5 },
  { key: 'bcl', src: 'fs', name: 'Basketball Champions League', short: 'BCL', area: 'Europe · FIBA', region: 'Europe', hca: 3, sd: 11.5 },
  { key: 'vtb', src: 'fs', name: 'VTB United League', short: 'VTB', area: 'Russia & neighbours', region: 'Europe', hca: 3, sd: 11.5 },
  { key: 'aba', src: 'fs', name: 'ABA League', short: 'ABA', area: 'Adriatic · Balkans', region: 'Europe', hca: 3, sd: 11.5 },
  { key: 'cba', src: 'fs', name: 'CBA', area: 'China', region: 'Asia & Pacific', hca: 3, sd: 13 },
  { key: 'bleague', src: 'fs', name: 'B.League', area: 'Japan', region: 'Asia & Pacific', hca: 2.5, sd: 12 },
  { key: 'kbl', src: 'fs', name: 'KBL', area: 'South Korea', region: 'Asia & Pacific', hca: 2.5, sd: 11.5 },
  { key: 'pba', src: 'fs', name: 'PBA', area: 'Philippines', region: 'Asia & Pacific', hca: 0, sd: 12 },
  { key: 'nbl', src: 'espn', path: 'nbl', name: 'NBL', area: 'Australia & New Zealand', region: 'Asia & Pacific', hca: 3, sd: 12 },
  { key: 'easl', src: 'fs', name: 'East Asia Super League', short: 'EASL', area: 'East Asia', region: 'Asia & Pacific', hca: 2.5, sd: 12 },
  { key: 'bal', src: 'fs', name: 'Basketball Africa League', short: 'BAL', area: 'Africa', region: 'Africa & Americas', hca: 1.5, sd: 12 },
  { key: 'bcla', src: 'fs', name: 'BCL Americas', area: 'The Americas · FIBA', region: 'Africa & Americas', hca: 3, sd: 12 },
];
const BBL = Object.fromEntries(BB_LEAGUES.map(l => [l.key, l]));
S.bb = { lg: store.get('fl.bbLg', 'all'), view: 'games', off: 0, filter: 'all', days: {}, stand: {}, league: {}, pools: {}, games: new Map(), meta: store.get('fl.bbMeta', {}) };
if (S.bb.lg !== 'all' && !BBL[S.bb.lg]) S.bb.lg = 'all';
const bbTz = () => Math.round(-new Date().getTimezoneOffset() / 60);
const bbShot = (id, path) => id ? `https://a.espncdn.com/i/headshots/${/college/.test(path || '') ? path : path === 'wnba' ? 'wnba' : 'nba'}/players/full/${id}.png` : SIL;
const bbLogo = key => BBL[key]?.logo || S.bb.meta[key]?.logo || '';
const bbName = key => BBL[key]?.short || BBL[key]?.name || key;
const dec2p = d => d > 1 ? 1 / d : null;
const am2dec = a => a == null || isNaN(+a) || !+a ? null : +a > 0 ? 1 + +a / 100 : 1 + 100 / -a;
const decAm = d => !d || d <= 1 ? '–' : d >= 2 ? '+' + Math.round((d - 1) * 100) : '−' + Math.round(100 / (d - 1));
const bbNum = x => { const n = parseFloat(String(x ?? '').replace(/[^\d.-]/g, '')); return isNaN(n) ? null : n };
const bbFix = (x, d = 1) => x == null || isNaN(x) ? '–' : (+x).toFixed(d);
const bbOrd = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) };

/* ---------- loading games ---------- */
function bbNormEspn(ev, l){
  const c = ev.competitions?.[0]; if (!c) return null;
  const st = c.status?.type || ev.status?.type || {};
  const side = ha => { const x = c.competitors.find(t => t.homeAway === ha) || {}, t = x.team || {};
    return { id: String(t.id || ''), name: t.shortDisplayName || t.name || t.displayName, full: t.displayName || t.name, abbr: t.abbreviation || '', logo: t.logo || t.logos?.[0]?.href || '',
      color: t.color, alt: t.alternateColor, score: (typeof x.score === 'object' ? x.score?.displayValue : x.score) ?? '', winner: x.winner,
      record: x.records?.[0]?.summary || '', lines: (x.linescores || []).map(q => q.displayValue ?? q.value), rank: x.curatedRank?.current > 0 && x.curatedRank.current <= 25 ? x.curatedRank.current : null } };
  const home = side('home'), away = side('away'); const [hc, ac] = teamColors(home, away); const o = c.odds?.[0];
  return { id: String(ev.id), src: 'espn', lg: l.key, path: l.path, date: new Date(ev.date), state: st.state, detail: st.shortDetail || st.detail || '',
    home, away, hc, ac, venue: c.venue?.fullName || '', city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(', '), neutral: !!c.neutralSite,
    tv: (c.broadcasts || []).flatMap(b => b.names || []).join(', '), line: o ? { details: o.details, ou: o.overUnder } : null, note: c.notes?.[0]?.headline || '' };
}
function bbNormFs(x){
  const side = t => ({ ...t, id: t.id, name: t.name, full: t.full, abbr: t.abbr, color: fmColor(t.full), alt: null });
  const home = side(x.home), away = side(x.away); const [hc, ac] = teamColors(home, away);
  return { ...x, date: new Date(x.ts * 1000), home, away, hc, ac, path: null, venue: '', tv: '', line: null, note: x.round || '' };
}
async function bbLoadDay(off){
  const cur = S.bb.days[off]; if (cur && Date.now() - cur.at < (off === 0 ? 20000 : 120000)) return cur;
  const d = new Date(); d.setDate(d.getDate() + off); const ymd = isoDay(d).replace(/-/g, '');
  const espn = BB_LEAGUES.filter(l => l.src === 'espn');
  const [fs, ...es] = await Promise.allSettled([getJSON(`/api/bb/day?off=${off}&tz=${bbTz()}`), ...espn.map(l => getJSON(`${BBE}/${l.path}/scoreboard?dates=${ymd}&limit=${l.groups ? 400 : 200}${l.groups ? '&groups=' + l.groups : ''}`))]);
  const evs = [];
  es.forEach((r, i) => { const l = espn[i]; for (const ev of val(r)?.events || []) { const e = bbNormEspn(ev, l); if (e && sameDay(e.date, d)) evs.push(e) } });
  const F = val(fs);
  const twins = [];
  if (F) { for (const [k, list] of Object.entries(F.games || {})) for (const x of list) { const e = bbNormFs(x); if (BBL[k]?.src === 'fs') { if (sameDay(e.date, d)) evs.push(e) } else twins.push(e) }
    let ch = false; for (const [k, m] of Object.entries(F.meta || {})) if (m.logo && S.bb.meta[k]?.logo !== m.logo) { S.bb.meta[k] = { ...(S.bb.meta[k] || {}), logo: m.logo, name: m.name }; ch = true }
    if (ch) store.set('fl.bbMeta', S.bb.meta) }
  for (const e of evs) { S.bb.games.set(e.id, e); if (e.src === 'espn' && !e.twin) { const t = twins.find(x => x.lg === e.lg && bbSameTeam(x.home, e.home) && bbSameTeam(x.away, e.away) && Math.abs(x.date - e.date) < 6 * 36e5); if (t) e.twin = { id: t.id, ja: t.home.pid, jb: t.away.pid } } }
  return S.bb.days[off] = { events: evs.sort((a, b) => a.date - b.date), at: Date.now(), fsDown: !F, espnDown: es.every(r => r.status === 'rejected') };
}

const bbLast = s => normName(s).split(' ').pop();
const bbSameTeam = (a, b) => { const x = normName(a.full), y = normName(b.full); return !!x && !!y && (x === y || x.includes(y) || y.includes(x) || bbLast(a.full) === bbLast(b.full)) };
// bookmaker odds for every upcoming and live game in the list, in batches (the server falls back to non-US books)
async function bbListOdds(off){
  const evs = (S.bb.days[off]?.events || []).filter(e => e.state !== 'post' && !(Date.now() - (S.bb.odds?.get(e.id)?.at || 0) < 120000));
  const spec = evs.map(e => e.src === 'fs' ? [e.id, e.home.pid, e.away.pid, e] : e.twin ? [e.twin.id, e.twin.ja, e.twin.jb, e] : null).filter(Boolean);
  if (!spec.length) return false;
  S.bb.odds ||= new Map();
  for (let i = 0; i < spec.length; i += 30) {
    const part = spec.slice(i, i + 30);
    try { const r = await getJSON(`/api/bb/odds?ids=${part.map(x => x.slice(0, 3).join(':')).join(',')}`);
      for (const [id, , , e] of part) if (r[id] && !(S.bb.odds.get(e.id)?.full && Date.now() - S.bb.odds.get(e.id).at < 120000)) S.bb.odds.set(e.id, { ...r[id], at: Date.now() }) } catch {}
  }
  return true;
}
// one line for a card: each side's best moneyline, the main spread and total
function bbCardOdds(e){
  const books = S.bb.odds?.get(e.id)?.books || []; if (!books.length) return null;
  const best = k => Math.max(0, ...books.map(b => b.ml?.[k] || 0));
  const sp = books.map(b => b.spread?.[0]).find(Boolean), to = books.map(bbMainTotal).find(Boolean);
  return { h: best('home') || null, a: best('away') || null, sp, to };
}

/* ---------- main column ---------- */
function bbRail(){
  const d = S.bb.days[S.bb.off], cnt = {}; for (const e of d?.events || []) { const c = cnt[e.lg] ||= { n: 0, live: 0 }; c.n++; if (e.state === 'in') c.live++ }
  const on = k => S.bb.view === 'games' && S.bb.lg === k ? ' on' : '';
  const favs = S.fav.filter(f => f.sport === 'basketball');
  let h = `<h4>Basketball</h4><button class="lg${S.bb.view === 'games' ? on('all') : ''}" data-bblg="all"><span class="dot">●</span><span>All leagues</span>${d ? `<b>${d.events.length}</b>` : ''}</button>
    <button class="lg${S.bb.view === 'picks' ? ' on' : ''}" data-bbview="picks"><span class="dot">%</span><span>Predictions</span></button>`;
  if (favs.length) h += `<h4>My teams</h4>` + favs.map(f => `<button class="lg" data-bbteam="${esc(f.tid)}" data-bbl="${esc(f.lg)}" data-bbslug="${esc(f.slug || '')}"><img src="${esc(f.logo)}" alt=""><span>${esc(f.name)}</span></button>`).join('');
  for (const region of [...new Set(BB_LEAGUES.map(l => l.region))]) h += `<h4>${esc(region)}</h4>` + BB_LEAGUES.filter(l => l.region === region).map(l => { const c = cnt[l.key], logo = bbLogo(l.key);
    return `<button class="lg${on(l.key)}" data-bblg="${l.key}">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'dot',textContent:'●'}))">` : '<span class="dot">●</span>'}<span>${esc(l.name)}</span>${c?.live ? `<b class="live">${c.live}</b>` : c?.n ? `<b>${c.n}</b>` : ''}</button>` }).join('');
  $('rail').innerHTML = h;
  // phones: the rail is hidden, so the leagues become a row of chips
  $('chips').innerHTML = `<button class="chip${S.bb.lg === 'all' ? ' on' : ''}" data-bblg="all">All leagues</button>` + BB_LEAGUES.map(l => { const c = cnt[l.key], logo = bbLogo(l.key);
    return `<button class="chip${S.bb.lg === l.key ? ' on' : ''}" data-bblg="${l.key}">${logo ? `<img src="${esc(logo)}" alt="">` : ''}${esc(bbName(l.key))}${c?.live ? `<b>${c.live}</b>` : ''}</button>` }).join('');
}
function bbCard(e){
  const post = e.state === 'post', hs = +e.home.score, as = +e.away.score, hl = post && hs < as, al = post && as < hs;
  const st = e.state === 'in' ? `<div class="st live"><span class="min">${esc(e.detail.replace(/ - /, ' '))}</span>LIVE</div>`
    : e.state === 'pre' ? (/postpon|cancel|delay/i.test(e.detail) ? `<div class="st">${esc(e.detail)}</div>` : `<div class="st"><span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>`) : `<div class="st">${esc(e.detail.replace('Final', 'FT'))}</div>`;
  const team = (t, lose) => `<div class="tm${lose ? ' lose' : ''}"><img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${t.rank ? `<em class="rk">${t.rank}</em>` : ''}${esc(t.name)}</span>${t.record ? `<small class="rec">${esc(t.record)}</small>` : ''}</div>`;
  const P = S.bb.pred?.get(e.id);
  const O = e.state !== 'post' ? bbCardOdds(e) : null, ab = t => esc(t.abbr || t.name);
  const spTxt = O?.sp ? `${ab(O.sp.line < 0 ? e.home : e.away)} ${O.sp.line < 0 ? O.sp.line : -O.sp.line}` : e.line?.details ? esc(e.line.details) : '';
  const ouTxt = O?.to ? O.to.line : e.line?.ou || '';
  const odds = e.state !== 'post' && (O || e.line?.details || P) ? `<div class="oddrow" aria-hidden="true">${P && e.state === 'pre' ? `<span class="${P.pH >= .5 ? 'fav' : ''}">${ab(e.home)} ${pct(P.pH)}%</span><span class="${P.pH < .5 ? 'fav' : ''}">${ab(e.away)} ${pct(1 - P.pH)}%</span>` : ''}${O?.h && O?.a ? `<span class="bb-ml" title="Best moneyline">${ab(e.home)} ${decAm(O.h)} · ${ab(e.away)} ${decAm(O.a)}</span>` : ''}${spTxt ? `<span>${spTxt}</span>` : ''}${ouTxt ? `<span>O/U ${esc(ouTxt)}</span>` : ''}</div>` : '';
  // US leagues list the away team first; everywhere else the home team comes first
  const us = e.src === 'espn' && e.lg !== 'nbl', [A, B, la, lb] = us ? [e.away, e.home, al, hl] : [e.home, e.away, hl, al];
  return `<button class="m fb bb" data-bbgame="${esc(e.id)}" style="--hc:${us ? e.ac : e.hc};--ac:${us ? e.hc : e.ac}"
    aria-label="${esc(`${A.full} ${us ? 'at' : 'versus'} ${B.full}. ${e.state === 'pre' ? 'Tip-off ' + e.date.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : `${A.score} to ${B.score}, ${e.detail}`}`)}">
    ${st}<div class="tms">${team(A, la)}${team(B, lb)}${odds}</div>
    <div class="sc num">${e.state !== 'pre' ? `<span class="${la ? 'lose' : ''}">${esc(A.score)}</span><span class="${lb ? 'lose' : ''}">${esc(B.score)}</span>` : `<span class="tv">${esc((e.tv || '').split(',')[0])}</span><span>&nbsp;</span>`}</div></button>`;
}
async function renderBasketball(){
  const el = $('bb'); if (!el) return;
  bbRail();
  if (S.bb.view === 'picks') return renderBbPicks();
  const off = S.bb.off, key = S.bb.lg;
  const paint = () => {
    const d = S.bb.days[off]; if (!d || S.bb.view !== 'games') return;
    const q = S.q.trim().toLowerCase();
    const list = d.events.filter(e => (key === 'all' || e.lg === key) && (!q || `${e.home.full} ${e.away.full}`.toLowerCase().includes(q))
      && (S.bb.filter !== 'live' || e.state === 'in') && (S.bb.filter !== 'top25' || e.home.rank || e.away.rank) && (S.bb.filter !== 'fav' || S.fav.some(f => f.sport === 'basketball' && (f.tid === e.home.id || f.tid === e.away.id))));
    bbRail();
    const live = list.filter(e => e.state === 'in').length;
    const day = new Date(); day.setDate(day.getDate() + off);
    const groups = new Map(); for (const e of list) { if (!groups.has(e.lg)) groups.set(e.lg, []); groups.get(e.lg).push(e) }
    const order = BB_LEAGUES.map(l => l.key);
    const navs = `<div class="datebar"><button class="dnav" data-bbact="day" data-to="-1" aria-label="Previous day">‹</button>
      <button class="dtoggle" data-bbact="day" data-to="0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>${off === 0 ? 'Today' : off === -1 ? 'Yesterday' : off === 1 ? 'Tomorrow' : esc(day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</span></button>
      <button class="dnav" data-bbact="day" data-to="1" aria-label="Next day">›</button></div>`;
    const ranked = d.events.some(e => BBL[e.lg].college && (e.home.rank || e.away.rank) && (key === 'all' || e.lg === key));
    const chips = `<div class="quick">${[['all', 'All'], ['live', `Live${live ? ' · ' + live : ''}`], ...(ranked || S.bb.filter === 'top25' ? [['top25', 'Top 25']] : []), ['fav', '★ My teams']].map(([k, l]) => `<button class="qf" data-bbfilter="${k}" aria-pressed="${S.bb.filter === k}">${k === 'live' ? '<span class="dot"></span>' : ''}${l}</button>`).join('')}</div>`;
    const lgBtn = key !== 'all' ? `<button class="btn ghost lginfo" data-bbact="league">Standings, results & fixtures</button>` : '';
    el.innerHTML = navs + chips + `<div class="livebar"><h2>${esc(key === 'all' ? (off === 0 ? 'Today' : day.toLocaleDateString([], { weekday: 'long' })) : BBL[key].name)}</h2><span class="count">${list.length} game${list.length === 1 ? '' : 's'}${live ? ` · <span class="pill live">${live} live</span>` : ''}</span>${lgBtn}</div>`
      + (list.length ? [...groups].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, l]) => `<div class="group"><div class="group-h">${bbLogo(k) ? `<img src="${esc(bbLogo(k))}" alt="">` : ''}<strong>${esc(BBL[k].name)}</strong><span>· ${esc(BBL[k].area)}</span>${key === 'all' ? `<button class="linkbtn bb-more" data-bblg="${k}">All ${esc(bbName(k))} games ›</button>` : ''}</div><div class="cards">${l.map(bbCard).join('')}</div></div>`).join('')
        : `<div class="empty-state"><strong>${d.fsDown && d.espnDown ? "Couldn't load games" : 'No games'}</strong>${d.fsDown && d.espnDown ? 'Check your connection and try again.' : key !== 'all' ? `${esc(BBL[key].name)} has no games on this day. Use the arrows, or open standings, results & fixtures.${key === 'bal' ? ' The BAL plays in spring (March to June).' : key === 'bcla' ? ' BCL Americas runs from about November to April.' : key === 'wnba' ? ' The WNBA season runs May to October.' : ''}` : 'Try another day.'}</div>`)
      + (d.fsDown ? `<p class="srcnote">The local server isn't answering, so only the NBA, WNBA and NBL are shown. Start it with <code>python3 server.py --lan</code>.</p>` : '');
  };
  if (S.bb.days[off]) paint(); else el.innerHTML = '<div class="cards"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  await bbLoadDay(off);
  if (S.sport !== 'basketball' || S.bb.off !== off || S.bb.view !== 'games') return;
  paint();
  bbListPredictions(off).then(ch => { if (ch && S.sport === 'basketball' && S.bb.off === off) paint() }).catch(() => {});
  bbListOdds(off).then(ch => ch && bbListPredictions(off)).then(() => { if (S.sport === 'basketball' && S.bb.off === off) paint() }).catch(() => {});
}
// win chances on the cards for upcoming games, once each league's standings are loaded
async function bbListPredictions(off){
  const evs = (S.bb.days[off]?.events || []).filter(e => e.state === 'pre'); if (!evs.length) return false;
  const keys = [...new Set(evs.map(e => e.lg))].filter(k => S.bb.view === 'picks' || S.bb.lg === 'all' || k === S.bb.lg);
  await Promise.allSettled(keys.map(bbStandings));
  S.bb.pred ||= new Map(); let ch = false;
  for (const e of evs) { const P = bbPredict(e); if (P && Math.abs((S.bb.pred.get(e.id)?.pH ?? -1) - P.pH) > .001) { S.bb.pred.set(e.id, P); ch = true } }
  return ch;
}
function bbTicker(){
  const all = Object.values(S.bb.days).flatMap(d => d.events || []), seen = new Set();
  const live = all.filter(e => e.state === 'in' && !seen.has(e.id) && seen.add(e.id));
  const next = all.filter(e => e.state === 'pre' && e.date > Date.now() && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.date - b.date).slice(0, 6);
  const ab = t => esc(t.abbr || t.name);
  const chip = e => `<button class="tk" data-bbgame="${esc(e.id)}"><span class="mn ${e.state === 'in' ? '' : 'pre'}">${e.state === 'in' ? esc(e.detail.split(' ')[0]) : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><img src="${esc(e.home.logo)}" alt="">${ab(e.home)}${e.state === 'in' ? `<span class="s num">${esc(e.home.score)}–${esc(e.away.score)}</span>` : ' – '}${ab(e.away)}<img src="${esc(e.away.logo)}" alt=""></button>`;
  $('ticker').hidden = !live.length && !next.length;
  $('ticker').innerHTML = (live.length ? `<span class="lab">${live.length} live</span>` + live.map(chip).join('') : '') + (next.length ? `<span class="lab next">Next up</span>` + next.map(chip).join('') : '');
}

/* ---------- predictions page: today and tomorrow, every league, with filters (predfilter.js) ---------- */
async function renderBbPicks(){
  const el = $('bb');
  const paint = () => {
    if (S.sport !== 'basketball' || S.bb.view !== 'picks') return;
    const evs = [0, 1].flatMap(o => S.bb.days[o]?.events || []).filter(e => e.state !== 'post');
    const items = evs.map(e => { const P = bbPredict(e); if (!P) return null;
      return { e, P, id: e.id, lg: e.lg, lgName: BBL[e.lg].name, cat: BBL[e.lg].region, order: BB_LEAGUES.indexOf(BBL[e.lg]), date: e.date, live: e.state === 'in', conf: P.conf, top: P.top,
        edge: P.market != null ? (P.pick === 'home' ? P.pModel - P.market : P.market - P.pModel) : null,
        fav: S.fav.some(f => f.sport === 'basketball' && (f.tid === e.home.id || f.tid === e.away.id)) } }).filter(Boolean);
    const shown = PFX.apply('basketball', items), loading = !S.bb.days[0] || !S.bb.days[1];
    const cats = [...new Set(BB_LEAGUES.map(l => l.region))].map(r => [r, r]);
    el.innerHTML = `<div class="livebar"><h2>Predictions</h2><span class="count">${items.length} game${items.length === 1 ? '' : 's'} today and tomorrow</span></div>
      ${PFX.bar('basketball', items, cats)}
      <div class="cards">${shown.slice(0, 250).map(({ e, P }) => { const us = e.src === 'espn' && e.lg !== 'nbl', [A, B, ca, cb, pA] = us ? [e.away, e.home, e.ac, e.hc, 1 - P.pH] : [e.home, e.away, e.hc, e.ac, P.pH];
        const nm = t => `${t.rank ? `<em class="rk">${t.rank}</em>` : ''}${esc(t.name)}`;
        return `<button class="m pred-card fb" data-bbgame="${esc(e.id)}" data-bbtab="pred" style="--hc:${ca};--ac:${cb}">
        <div class="st">${e.state === 'in' ? `<span class="min" style="color:var(--live)">${esc(e.detail)}</span>LIVE` : `<span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}`}</div>
        <div class="tms"><div class="tm"><img src="${esc(A.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${nm(A)}</span></div><div class="tm"><img src="${esc(B.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${nm(B)}</span></div>
          <div class="pbar"><i style="flex-grow:${pA};background:${ca}"><span>${pct(pA)}%</span></i><i style="flex-grow:${1 - pA};background:${cb}"><span>${pct(1 - pA)}%</span></i></div></div>
        <div class="pc-side"><span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf}</span><b>${esc(e[P.pick].name)}</b><small class="num">${us ? P.score[1] + '–' + P.score[0] : P.score.join('–')} · ${pct(P.top)}%</small><small class="pfx-lg">${esc(bbName(e.lg))}</small></div></button>` }).join('')
        || PFX.empty('basketball', items.length) || (loading ? '<div class="skel"></div><div class="skel"></div>' : '<div class="empty-state"><strong>No upcoming games</strong>Nothing left to play today or tomorrow.</div>')}</div>
      ${shown.length > 250 ? `<p class="srcnote">Showing the first 250. Narrow it down with the filters above.</p>` : ''}
      <p class="srcnote">Each team's average margin this season plus home court, blended 70/30 with the sportsbooks' no-vig line where one exists (and Kalshi for the NBA, WNBA and college). In college, the AP Top 25 counts for a few points early in the season.</p>${RG}`;
  };
  if (S.bb.days[0] || S.bb.days[1]) paint(); else el.innerHTML = '<div class="skel" style="height:300px"></div>';
  await Promise.allSettled([bbLoadDay(0), bbLoadDay(1)]); paint();
  await Promise.allSettled([0, 1].map(o => bbListOdds(o).catch(() => {}))); paint();
  await Promise.allSettled([0, 1].map(o => bbListPredictions(o))); paint();
}
PFX.on('basketball', () => S.sport === 'basketball' && S.bb.view === 'picks' && renderBbPicks());

/* ---------- standings (normalized: groups of rows with gp, w, l, points for and against) ---------- */
async function bbStandings(key){
  if (S.bb.stand[key] && Date.now() - S.bb.stand[key].at < 600000) return S.bb.stand[key];
  const l = BBL[key];
  try {
    if (l.src === 'espn') {
      const d = await getJSON(`${BBE2}/${l.path}/standings`);
      const groups = (d.children?.length ? d.children : [d]).map(g => ({ name: g.name || g.abbreviation || '', rows: (g.standings?.entries || []).map(x => {
        const s = n => x.stats?.find(y => y.name === n || y.type === n); const v = n => s(n)?.value ?? 0;
        const gp = v('gamesPlayed') || v('wins') + v('losses');
        return { id: String(x.team?.id), name: x.team?.shortDisplayName || x.team?.displayName, full: x.team?.displayName, logo: x.team?.logos?.[0]?.href || '', gp, w: v('wins'), l: v('losses'),
          pct: s('winPercent')?.displayValue || '', ppg: v('avgPointsFor') || (gp ? v('pointsFor') / gp : 0), oppg: v('avgPointsAgainst') || (gp ? v('pointsAgainst') / gp : 0),
          gb: s('gamesBehind')?.displayValue || '', streak: s('streak')?.displayValue || '', seed: v('playoffSeed') || null, home: s('Home')?.displayValue || s('home')?.displayValue || '', away: s('Road')?.displayValue || s('road')?.displayValue || '', l10: s('Last Ten Games')?.displayValue || s('lasttengames')?.displayValue || '' } })
          .sort((a, b) => (a.seed || 99) - (b.seed || 99) || (b.w - b.l) - (a.w - a.l)) }));
      return S.bb.stand[key] = { groups, at: Date.now() };
    }
    const L = await bbLeague(key);
    const groups = (L.standings || []).map(g => ({ name: g.name, rows: g.rows.map(r => ({ id: r.id, slug: r.slug, name: r.name, full: r.name, logo: bbTeamLogo(key, r.id), gp: r.gp, w: r.w, l: r.l,
      pct: r.pct || (r.w + r.l ? (r.w / (r.w + r.l)).toFixed(3).replace(/^0/, '') : ''), ppg: r.gp ? r.pf / r.gp : 0, oppg: r.gp ? r.pa / r.gp : 0, streak: '', form: r.form, rank: r.rank, zone: r.zone, zoneColor: r.zoneColor })) }));
    return S.bb.stand[key] = { groups, at: Date.now() };
  } catch { return S.bb.stand[key] = { groups: [], at: Date.now() - 540000 } }
}
async function bbLeague(key){
  const c = S.bb.league[key]; if (c && Date.now() - c.at < 300000) return c;
  const d = await getJSON(`/api/bb/league?key=${key}`);
  d.results = (d.results || []).map(bbNormFs); d.fixtures = (d.fixtures || []).map(bbNormFs); d.at = Date.now();
  for (const e of [...d.results, ...d.fixtures]) { S.bb.games.set(e.id, e); if (e.home.logo) (S.bb.logos ||= {})[e.home.id] = e.home.logo; if (e.away.logo) S.bb.logos[e.away.id] = e.away.logo }
  return S.bb.league[key] = d;
}
const bbTeamLogo = (key, id) => S.bb.logos?.[id] || '';
function bbRow(key, id){ for (const g of S.bb.stand[key]?.groups || []) { const r = g.rows.find(x => x.id === id); if (r) return { ...r, group: g.name } } return null }
function bbStandingsHTML(key, hl = []){
  const st = S.bb.stand[key]; if (!st) return `<div class="skel" style="height:300px"></div>`;
  if (!st.groups.length) return `<div class="note">No standings published for ${esc(BBL[key].name)} yet.</div>`;
  const espn = BBL[key].src === 'espn';
  const gs = hl.length && st.groups.length > 1 ? [...st.groups.filter(g => g.rows.some(r => hl.includes(r.id))), ...st.groups.filter(g => !g.rows.some(r => hl.includes(r.id)))] : st.groups;
  return gs.map(g => `${g.name ? `<div class="grp-name">${esc(g.name)}</div>` : ''}<div class="tbl-wrap"><table class="bb-st"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PCT</th>${espn ? '<th>GB</th>' : ''}<th>PPG</th><th>OPP</th><th>DIFF</th><th>${espn ? 'STRK' : 'FORM'}</th></tr></thead><tbody>
    ${g.rows.map((r, i) => { const diff = r.ppg - r.oppg;
      return `<tr class="${hl.includes(r.id) ? 'hl' : ''}"><td class="r num">${r.zoneColor ? `<i style="background:#${esc(r.zoneColor)}"></i>` : r.seed && r.seed <= (key === 'nba' ? 6 : 8) ? `<i style="background:var(--win)"></i>` : ''}${r.seed || r.rank || i + 1}</td>
        <td class="t"><img src="${esc(r.logo || bbTeamLogo(key, r.id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><button class="linkbtn" data-bbteam="${esc(r.id)}" data-bbl="${esc(key)}" data-bbslug="${esc(r.slug || '')}">${esc(r.name)}</button></td>
        <td>${r.w}</td><td>${r.l}</td><td>${esc(r.pct)}</td>${espn ? `<td>${esc(r.gb)}</td>` : ''}<td>${bbFix(r.ppg)}</td><td>${bbFix(r.oppg)}</td><td class="${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${diff > 0 ? '+' : ''}${bbFix(diff)}</td>
        <td>${espn ? esc(r.streak) : `<span class="bb-form">${(r.form || []).slice(0, 5).map(f => `<i class="${f === 'W' ? 'w' : 'l'}">${f}</i>`).join('')}</span>`}</td></tr>` }).join('')}</tbody></table></div>`).join('')
    + (espn ? `<p class="srcnote">${key === 'nba' ? 'Green: top 6 in each conference go straight to the playoffs; 7–10 play the play-in.' : 'Green: playoff places.'} Standings from ESPN.</p>` : `<p class="srcnote">Coloured marks show the competition's qualification zones. Standings from Flashscore.</p>`);
}

/* ---------- predictions ---------- */
const bbMainTotal = b => b.total?.length ? b.total.reduce((x, y) => Math.abs(y.over - y.under) < Math.abs(x.over - x.under) ? y : x) : null;
const bbPhi = x => { const t = 1 / (1 + .2316419 * Math.abs(x)), d = .3989423 * Math.exp(-x * x / 2), p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p };
// consensus from the bookmakers: average no-vig chance of the home win, main spread and total
function bbMarket(e){
  const books = S.bb.odds?.get(e.id)?.books || [];
  const ml = books.filter(b => b.ml?.home && b.ml?.away).map(b => { const h = 1 / b.ml.home, a = 1 / b.ml.away; return h / (h + a) });
  const sp = books.map(b => b.spread?.[0]?.line).filter(x => x != null), to = books.map(b => bbMainTotal(b)?.line).filter(x => x != null);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  let pH = avg(ml), spread = avg(sp), total = avg(to);
  // no bookmaker feed yet: fall back to ESPN's line on the scoreboard ("ORL -2.5", O/U)
  if (pH == null && spread == null && e.line?.details) { const m = /^(\S+)\s+([-+]?\d+(?:\.\d+)?)$/.exec(e.line.details.trim());
    if (m) { const n = +m[2], homeFav = m[1].toUpperCase() === (e.home.abbr || '').toUpperCase(); spread = homeFav ? n : -n; pH = bbPhi(-spread / BBL[e.lg].sd) }
    else if (/even|pk/i.test(e.line.details)) { spread = 0; pH = .5 } }
  if (total == null && +e.line?.ou) total = +e.line.ou;
  const kx = S.odds.get('bb' + e.id)?.ml; if (kx?.home && kx?.away) pH = pH == null ? kx.home.p / (kx.home.p + kx.away.p) : pH * .7 + .3 * kx.home.p / (kx.home.p + kx.away.p);
  return { pH, spread, total, n: ml.length };
}
function bbPredict(e){
  const l = BBL[e.lg], H = bbRow(e.lg, e.home.id), A = bbRow(e.lg, e.away.id);
  const M = bbMarket(e);
  if (!H && !A && M.pH == null) return null;
  const rate = r => { if (!r || !r.gp) return 0; const k = r.gp / (r.gp + 6); return (r.ppg - r.oppg) * k };
  const hca = e.neutral ? 0 : l.hca;
  // college: an AP Top 25 ranking is worth points while there are only a few games to go on
  const poll = t => l.college && t.rank ? (26 - t.rank) * .35 * (1 - Math.min(1, ((H?.gp || 0) + (A?.gp || 0)) / 30)) : 0;
  const model = rate(H) - rate(A) + hca + poll(e.home) - poll(e.away);
  const lg = (() => { const rows = (S.bb.stand[e.lg]?.groups || []).flatMap(g => g.rows).filter(r => r.gp); return rows.length ? rows.reduce((s, r) => s + r.ppg, 0) / rows.length : null })();
  const exp = (o, d) => o && d && o.gp ? ((o.ppg + d.oppg) / 2) : lg;
  let total = (exp(H, A) ?? 0) + (exp(A, H) ?? 0);
  let pModel = bbPhi(model / l.sd);
  let pH = pModel, margin = model, src = ['model'];
  if (M.pH != null) { pH = M.pH * .7 + pModel * .3; src.push('market') }
  if (M.spread != null) margin = -M.spread * .7 + model * .3;
  else if (M.pH != null) { // turn the market chance back into a margin
    let lo = -40, hi = 40; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (bbPhi(mid / l.sd) < pH) lo = mid; else hi = mid } margin = (lo + hi) / 2 }
  if (M.total != null) total = total ? M.total * .7 + total * .3 : M.total;
  if (!total) total = l.total || (l.key === 'wnba' ? 162 : l.key === 'nba' ? 228 : 160);
  const espnP = S.bb.espnPred?.get(e.id); if (espnP != null) { pH = pH * .8 + espnP * .2; src.push('espn') }
  const top = Math.max(pH, 1 - pH);
  const sH = Math.round(total / 2 + margin / 2), sA = Math.round(total / 2 - margin / 2);
  return { pH, pModel, market: M.pH, margin, total, score: [sH, sA], pick: pH >= .5 ? 'home' : 'away', top, conf: top >= .72 ? 'Strong' : top >= .6 ? 'Lean' : 'Toss-up', src, H, A, hca, M };
}
function bbReasons(e, P){
  const out = [], hn = e.home.name, an = e.away.name, H = P.H, A = P.A;
  if (H?.gp && A?.gp) {
    out.push(`${hn} are ${H.w}-${H.l} and outscore opponents by ${bbFix(H.ppg - H.oppg)} a game; ${an} are ${A.w}-${A.l} at ${bbFix(A.ppg - A.oppg)}.`);
    out.push(`${hn} score ${bbFix(H.ppg)} and allow ${bbFix(H.oppg)} a game; ${an} score ${bbFix(A.ppg)} and allow ${bbFix(A.oppg)}.`);
    if (H.form?.length || A.form?.length) out.push(`Recent form: ${hn} ${(H.form || []).slice(0, 5).join('') || '–'}, ${an} ${(A.form || []).slice(0, 5).join('') || '–'}.`);
    else if (H.streak || A.streak) out.push(`Streaks: ${hn} ${H.streak || '–'}, ${an} ${A.streak || '–'}.`);
  } else out.push('Neither team has enough games in the standings yet, so the betting market carries the forecast.');
  if (P.hca && !e.neutral) out.push(`Home court is worth about ${P.hca} points in ${BBL[e.lg].name}.`);
  else if (e.neutral) out.push('Neutral site, so no home-court edge.');
  if (BBL[e.lg].college && (e.home.rank || e.away.rank)) out.push(`AP Top 25: ${[e.home, e.away].filter(t => t.rank).map(t => `${t.name} No. ${t.rank}`).join(', ')}. Early in the season the ranking adds a few points, fading as real results come in.`);
  if (P.market != null) out.push(`The bookmakers' consensus (vig removed${S.odds.get('bb' + e.id)?.ml ? ', with Kalshi' : ''}) gives ${hn} ${pct(P.market)}%${P.M.spread != null ? `, with ${P.M.spread < 0 ? hn : an} favoured by ${Math.abs(P.M.spread)}` : ''}${P.M.total != null ? ` and a total of ${bbFix(P.M.total)}` : ''}.`);
  if (S.bb.espnPred?.get(e.id) != null) out.push(`ESPN's matchup predictor gives ${hn} ${pct(S.bb.espnPred.get(e.id))}%.`);
  return out;
}

/* ---------- game page ---------- */
function openBbGame(id){
  const e = S.bb.games.get(String(id)); if (!e) return;
  S.sel = null; S.stack = [{ type: 'bbgame', id: e.id, e, tab: e.state === 'pre' ? 'pred' : 'box' }];
  renderSheet(); $('sheet').classList.add('open'); $('sheet').querySelector('.sheet-body')?.scrollTo(0, 0);
  bbLoadGame(S.stack[0]);
}
async function bbLoadGame(v){
  const e = v.e, re = () => S.stack.includes(v) && renderSheet();
  bbStandings(e.lg).then(re);
  const jobs = [];
  if (e.src === 'espn') {
    jobs.push(getJSON(`${BBE}/${e.path}/summary?event=${e.id}`).then(d => { v.sum = d;
      const pr = d.predictor?.homeTeam?.gameProjection ?? d.predictor?.homeTeam?.teamChanceLoss; if (d.predictor?.homeTeam?.gameProjection != null) (S.bb.espnPred ||= new Map()).set(e.id, +d.predictor.homeTeam.gameProjection / 100);
      if (d.header?.competitions?.[0]?.status?.type?.state) { const c = d.header.competitions[0]; e.state = c.status.type.state; e.detail = c.status.type.shortDetail || e.detail;
        for (const x of c.competitors || []) { const s = x.homeAway === 'home' ? e.home : e.away; s.score = x.score ?? s.score; s.lines = (x.linescores || []).map(q => q.displayValue ?? q.value) } }
    }).catch(() => { v.sum = { error: true } }));
    // bookmaker odds from Flashscore for the same game
    const d = isoDay(e.date).replace(/-/g, '');
    jobs.push(getJSON(`/api/bb/find?date=${d}&home=${encodeURIComponent(e.home.full)}&away=${encodeURIComponent(e.away.full)}&tz=${bbTz()}`).then(x => { if (x?.id) { v.fsid = x.id; v.ja = x.home?.pid; v.jb = x.away?.pid; return bbFsGame(v) } }).catch(() => {}));
    if (BBL[e.lg].kx) jobs.push(bbKalshi(e).catch(() => {}));
  } else { v.fsid = e.id; v.ja = e.home.pid; v.jb = e.away.pid; jobs.push(bbFsGame(v)) }
  for (const j of jobs) j.then(re);
  await Promise.allSettled(jobs); v.loaded = true;
  if (e.state === 'pre') { const P = bbPredict(e); if (P) (S.bb.pred ||= new Map()).set(e.id, P) }
  re();
}
async function bbFsGame(v){
  try { const g = await getJSON(`/api/bb/game?id=${v.fsid}&ja=${v.ja || ''}&jb=${v.jb || ''}`); v.fs = g; (S.bb.odds ||= new Map()).set(v.e.id, { ...(g.odds || { books: [] }), at: Date.now(), full: true });
    if (v.e.src === 'fs') { if (g.info?.venue) v.e.venue = g.info.venue; if (g.info?.city) v.e.city = g.info.city } }
  catch { v.fs = { error: true } }
}
async function bbKalshi(e){
  const pre = BBL[e.lg].kx;
  const [g, sp, to] = await Promise.allSettled(['GAME', 'SPREAD', 'TOTAL'].map(k => kxSeries(pre, k)));
  const o = {};
  const kg = val(g) && kxFind(val(g), e); if (kg) o.ml = parseML(e, kg);
  const ks = val(sp) && kxFind(val(sp), e);
  if (ks) o.spread = (ks.markets || []).map(m => ({ side: sideOf(e, (m.yes_sub_title || '').replace(/ wins? by.*$/i, '')), line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.side && x.line).sort((a, b) => a.line - b.line);
  const kt = val(to) && kxFind(val(to), e);
  if (kt) o.total = (kt.markets || []).map(m => ({ line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.line).sort((a, b) => a.line - b.line);
  o.at = Date.now(); o.found = !!(kg || ks || kt); S.odds.set('bb' + e.id, o);
}
function bbHero(e, back){
  const s = e.state !== 'pre', us = e.src === 'espn' && e.lg !== 'nbl';
  const [L, R, lt, rt] = us ? [e.away, e.home, 'Away', e.neutral ? 'Neutral' : 'Home'] : [e.home, e.away, e.neutral ? 'Neutral' : 'Home', 'Away'];
  const side = (t, ha) => `<div class="side"><img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'"><strong><button class="linkbtn" data-bbteam="${esc(t.id)}" data-bbl="${esc(e.lg)}" data-bbslug="${esc(t.slug || '')}">${esc(t.full || t.name)}</button></strong><small class="rec">${esc(t.record || '')}${t.record ? ' · ' : ''}${ha}</small></div>`;
  const lines = e.home.lines?.length ? e.home.lines : null;
  return `<div class="hero" style="--hc:${us ? e.ac : e.hc};--ac:${us ? e.hc : e.ac}">
    ${topBar(back).replace('<div class="hero-top">', `<div class="hero-top"><div class="lgname">${bbLogo(e.lg) ? `<img src="${esc(bbLogo(e.lg))}" width="16" height="16" alt="">` : ''}<span>${esc(BBL[e.lg].name)}${e.note ? ' · ' + esc(e.note) : ''}</span></div>`)}
    <div class="board">${side(L, lt)}
      <div class="score">${s ? `<div class="big num">${esc(L.score)}<em>–</em>${esc(R.score)}</div><div class="status">${e.state === 'in' ? `<span class="pill live">${esc(e.detail)}</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">${esc(e.detail)}</span>`}</div>`
        : `<div class="kick num">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="sub">${esc(e.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}${kickoffIn(e.date) ? '<br>' + kickoffIn(e.date) : ''}</div>`}</div>
      ${side(R, rt)}</div>
    ${lines ? `<div class="tbl-wrap"><table class="qtr"><thead><tr><th></th>${lines.map((_, i) => { const per = e.lg === 'cbb' ? 2 : 4; return `<th>${i < per ? (per === 2 ? 'H' : 'Q') + (i + 1) : 'OT' + (i > per ? i - per + 1 : '')}</th>` }).join('')}<th>T</th></tr></thead><tbody>
      ${[L, R].map(t => `<tr><td class="t">${esc(t.abbr || t.name)}</td>${(t.lines || []).map(x => `<td>${esc(x)}</td>`).join('')}<td class="pts">${esc(t.score)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="meta-row">${e.venue ? `<span>${esc(e.venue)}${e.city ? ', ' + esc(e.city) : ''}</span>` : ''}${e.tv ? `<span>TV: ${esc(e.tv)}</span>` : ''}${e.line?.details ? `<span>Line: ${esc(e.line.details)}${e.line.ou ? ` · O/U ${esc(e.line.ou)}` : ''}</span>` : ''}</div></div>`;
}
const bbLoading = h => `<div class="skel" style="height:${h || 260}px"></div>`;
function bbPane(v){
  const e = v.e;
  if (v.tab === 'pred') return bbPredPane(v);
  if (v.tab === 'odds') return bbOddsPane(v);
  if (v.tab === 'stand') { if (!S.bb.stand[e.lg]) bbStandings(e.lg).then(() => S.stack.includes(v) && renderSheet()); return bbStandingsHTML(e.lg, [e.home.id, e.away.id]) }
  if (v.tab === 'h2h') return bbH2HPane(v);
  if (v.tab === 'box') return e.src === 'espn' ? bbEspnBox(v) : bbFsBox(v);
  if (v.tab === 'team') return bbTeamStatsPane(v);
  return '';
}
function bbStatBars(e, rows){
  return rows.map(r => { const a = bbNum(r.l), h = bbNum(r.r), m = Math.max(a || 0, h || 0, 1);
    return `<div class="stat"><span class="v num ${a >= h && a ? 'lead' : ''}">${esc(r.l)}</span><div><div class="lbl">${esc(r.label)}</div><div class="bars"><span><i style="width:${(a || 0) / m * 100}%;background:${r.lc}"></i></span><span><i style="width:${(h || 0) / m * 100}%;background:${r.rc}"></i></span></div></div><span class="v num ${h >= a && h ? 'lead' : ''}">${esc(r.r)}</span></div>` }).join('');
}
function bbTeamStatsPane(v){
  const e = v.e, us = e.src === 'espn' && e.lg !== 'nbl';
  const [L, R, lc, rc] = us ? [e.away, e.home, e.ac, e.hc] : [e.home, e.away, e.hc, e.ac];
  if (e.src === 'espn') {
    if (!v.sum) return bbLoading(); if (v.sum.error) return `<div class="note">Couldn't load this game.</div>`;
    const teams = v.sum.boxscore?.teams || []; if (e.state === 'pre' || !teams.length || !teams[0].statistics?.length) return `<div class="note">Team stats appear once the game starts.</div>` + bbSeasonCompare(v);
    const by = id => teams.find(t => String(t.team?.id) === id) || {}, TL = by(L.id), TR = by(R.id);
    const rows = (TL.statistics || []).map((s, i) => ({ label: s.label || s.name, l: s.displayValue, r: (TR.statistics || []).find(x => x.name === s.name)?.displayValue ?? '', lc, rc }));
    return `<div class="sub-h" style="margin-top:0"><h5>Team stats</h5><small>${esc(L.abbr)} · ${esc(R.abbr)}</small></div>` + bbStatBars(e, rows) + bbSeasonCompare(v);
  }
  const fs = v.fs; if (!fs) return bbLoading(); if (fs.error) return `<div class="note">Couldn't load this game.</div>`;
  if (!fs.stats?.length) return `<div class="note">Team stats appear once the game starts.</div>` + bbSeasonCompare(v);
  v.period ??= 0; const per = fs.stats[Math.min(v.period, fs.stats.length - 1)];
  const flip = r => us ? { l: r.away, r: r.home } : { l: r.home, r: r.away };
  return `<div class="sub-h" style="margin-top:0"><h5>Team stats</h5><small>${esc(L.abbr || L.name)} · ${esc(R.abbr || R.name)}</small></div>
    ${fs.stats.length > 1 ? `<div class="quick">${fs.stats.map((p, i) => `<button class="qf" data-bbact="period" data-to="${i}" aria-pressed="${i === v.period}">${esc(p.period === 'Match' ? 'Game' : p.period)}</button>`).join('')}</div>` : ''}
    ${per.groups.map(g => `<div class="grp-name" style="font-size:13px">${esc(g.name)}</div>` + bbStatBars(e, g.rows.map(r => ({ label: r.label, ...flip(r), lc, rc })))).join('')}` + bbSeasonCompare(v);
}
// season averages side by side, from the standings
function bbSeasonCompare(v){
  const e = v.e, H = bbRow(e.lg, e.home.id), A = bbRow(e.lg, e.away.id); if (!H?.gp || !A?.gp) return '';
  const rows = [['Record', `${H.w}-${H.l}`, `${A.w}-${A.l}`], ['Points a game', bbFix(H.ppg), bbFix(A.ppg)], ['Allowed a game', bbFix(H.oppg), bbFix(A.oppg)], ['Point difference', bbFix(H.ppg - H.oppg), bbFix(A.ppg - A.oppg)]];
  return `<div class="sub-h"><h5>Season so far</h5><small>${esc(e.home.abbr || e.home.name)} · ${esc(e.away.abbr || e.away.name)}</small></div><div class="bb-cmp">${rows.map(([k, h, a]) => `<div><b class="num">${esc(h)}</b><span>${esc(k)}</span><b class="num">${esc(a)}</b></div>`).join('')}</div>`;
}
function bbEspnBox(v){
  const e = v.e, d = v.sum; if (!d) return bbLoading(); if (d.error) return `<div class="note">Couldn't load this game.</div>`;
  const P = d.boxscore?.players || [];
  if (!P.length) return `<div class="note">The box score appears once the game starts.</div>${bbEspnLeaders(v)}${bbInjuries(v)}`;
  return bbEspnLeaders(v) + P.map(t => { const side = String(t.team?.id) === e.home.id ? e.home : e.away, g = t.statistics?.[0]; if (!g) return '';
    const rows = g.athletes || [];
    return `<div class="sub-h"><h5><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px">${esc(side.name)}</h5></div><div class="tbl-wrap"><table class="ctable bb-box"><thead><tr><th style="text-align:left">Player</th>${g.labels.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((a, i) => `<tr class="${i === 5 ? 'bench-start' : ''}${a.didNotPlay ? ' dnp' : ''}"><td class="t"><img src="${esc(a.athlete?.headshot?.href || bbShot(a.athlete?.id, e.path))}" alt="" class="bb-face" onerror="this.onerror=null;this.src=SIL"><button class="linkbtn" data-bbplayer="${esc(a.athlete?.id)}" data-bbl="${esc(e.lg)}">${esc(a.athlete?.shortName || a.athlete?.displayName || '')}</button>${a.starter ? '' : ''}<small>${esc(a.athlete?.position?.abbreviation || '')}</small></td>${a.didNotPlay ? `<td colspan="${g.labels.length}" class="dnp-r">${esc(a.reason || 'Did not play')}</td>` : (a.stats || []).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}
      ${g.totals?.length ? `<tr class="tot"><td class="t">Team</td>${g.totals.map(x => `<td>${esc(x)}</td>`).join('')}</tr>` : ''}</tbody></table></div>` }).join('') + `<p class="srcnote">Starters listed first. Tap a player for season stats, ranks and game log.</p>`;
}
function bbEspnLeaders(v){
  const e = v.e, L = (v.sum?.leaders || []).filter(t => t.leaders?.some(c => c.leaders?.length)); if (!L.length) return '';
  return `<div class="sub-h" style="margin-top:0"><h5>${e.state === 'pre' ? 'Season leaders' : 'Game leaders'}</h5></div><div class="bench fb-leaders">${L.map(t => { const side = String(t.team?.id) === e.home.id ? e.home : e.away;
    return `<div><div class="head"><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px">${esc(side.name)}</div>${(t.leaders || []).slice(0, 3).map(c => { const a = c.leaders?.[0]; if (!a) return '';
      return `<button class="ldr fbl" data-bbplayer="${esc(a.athlete?.id)}" data-bbl="${esc(e.lg)}"><span class="cat">${esc(c.displayName || c.name)}</span><img class="face-s espn-shot" src="${esc(a.athlete?.headshot?.href || bbShot(a.athlete?.id, e.path))}" alt="" onerror="this.onerror=null;this.src=SIL"><span class="nm"><span>${esc(a.athlete?.displayName || '')}</span><small>${esc(a.displayValue || '')}</small></span></button>` }).join('')}</div>` }).join('')}</div>`;
}
function bbInjuries(v){
  const inj = v.sum?.injuries || []; if (!inj.some(t => t.injuries?.length)) return '';
  const e = v.e;
  return `<div class="sub-h"><h5>Injury report</h5></div><div class="bench news-out">${inj.map(t => { const side = String(t.team?.id) === e.home.id ? e.home : e.away;
    return `<div><div class="head"><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px">${esc(side.name)}</div><ul>${(t.injuries || []).map(x => `<li><img class="mini" src="${esc(x.athlete?.headshot?.href || bbShot(x.athlete?.id, e.path))}" alt="" onerror="this.onerror=null;this.src=SIL"><span><button class="linkbtn" data-bbplayer="${esc(x.athlete?.id)}" data-bbl="${esc(e.lg)}">${esc(x.athlete?.displayName || '')}</button><small>${esc(x.details?.type || x.details?.detail || x.type?.description || '')}</small></span><span class="stat-badge ${/out/i.test(x.status) ? 'injured' : 'suspended'}">${esc(x.status || '')}</span></li>`).join('') || '<li><span style="color:var(--muted)">None reported.</span></li>'}</ul></div>` }).join('')}</div>`;
}
const BB_FS_COLS = ['MIN', 'PTS', 'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA', 'OR', 'DR', 'REB', 'AST', 'ST', 'BS', 'TO', 'PF', '+/-'];
const BB_FS_LBL = { ST: 'STL', BS: 'BLK', OR: 'OREB', DR: 'DREB' };
function bbFsBox(v){
  const e = v.e, fs = v.fs; if (!fs) return bbLoading(); if (fs.error) return `<div class="note">Couldn't load this game.</div>`;
  const tab = fs.box?.find(t => t.name === 'Overall') || fs.box?.[0];
  if (!tab?.players?.length) return `<div class="note">${e.state === 'pre' ? 'The box score appears once the game starts.' : 'Flashscore has no player box score for this game.'}</div>`;
  // live feeds can leave out field goals: rebuild them from 2- and 3-pointers
  for (const p of tab.players) for (const [f, a, b] of [['FGM', '2PM', '3PM'], ['FGA', '2PA', '3PA']]) if (!p.stats[f] && (p.stats[a] || p.stats[b])) p.stats[f] = String((+p.stats[a] || 0) + (+p.stats[b] || 0));
  const cols = BB_FS_COLS.filter(c => tab.players.some(p => p.stats[c]));
  const teams = [...new Set(tab.players.map(p => p.team))];
  const sideOfAbbr = ab => [e.home, e.away].find(t => (t.abbr || '').toUpperCase() === (ab || '').toUpperCase());
  const ordered = teams.map((ab, i) => ({ ab, side: sideOfAbbr(ab) || (i === 0 ? e.home : e.away), players: tab.players.filter(p => p.team === ab) }));
  const pctOf = (m, a) => +a ? Math.round(+m / +a * 100) + '%' : '';
  return ordered.map(({ side, players }) => {
    const tot = c => players.reduce((s, p) => s + (bbNum(p.stats[c]) || 0), 0);
    return `<div class="sub-h"><h5><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px">${esc(side.name)}</h5></div><div class="tbl-wrap"><table class="ctable bb-box"><thead><tr><th style="text-align:left">Player</th>${cols.map(c => `<th title="${esc(tab.cols.find(x => x.key === c)?.label || '')}">${esc(BB_FS_LBL[c] || c)}</th>`).join('')}<th>FG%</th><th>3P%</th></tr></thead><tbody>
      ${players.map(p => `<tr><td class="t"><button class="linkbtn" data-bbfsplayer="${esc(p.id)}" data-bbslug="${esc(p.slug)}" data-bbl="${esc(e.lg)}">${esc(p.name)}</button><small>${esc(p.country || '')}</small></td>${cols.map(c => `<td>${esc(p.stats[c] || (c === 'MIN' ? '' : '0'))}</td>`).join('')}<td>${pctOf(p.stats.FGM || 0, p.stats.FGA)}</td><td>${pctOf(p.stats['3PM'] || 0, p.stats['3PA'])}</td></tr>`).join('')}
      <tr class="tot"><td class="t">Team</td>${cols.map(c => `<td>${c === 'MIN' || c === '+/-' ? '' : tot(c)}</td>`).join('')}<td>${pctOf(tot('FGM'), tot('FGA'))}</td><td>${pctOf(tot('3PM'), tot('3PA'))}</td></tr></tbody></table></div>` }).join('')
    + `<p class="srcnote">Box score from Flashscore. Tap a player for their profile, season averages and recent games.</p>`;
}
function bbH2HPane(v){
  const e = v.e;
  if (e.src === 'espn' && v.sum?.seasonseries?.length) {
    const ss = v.sum.seasonseries[0];
    return `<div class="sub-h" style="margin-top:0"><h5>Season series</h5><small>${esc(ss.summary || '')}</small></div><div class="fbsched">${(ss.events || []).map(x => { const h = x.competitors?.find(c => c.homeAway === 'home'), a = x.competitors?.find(c => c.homeAway === 'away');
      return `<div class="fx"><span class="d">${esc(fmtDate(x.date))}</span><span class="vs"><img src="${esc(a?.team?.logo || '')}" alt=""><span>${esc(a?.team?.abbreviation || '')} @ ${esc(h?.team?.abbreviation || '')}</span><img src="${esc(h?.team?.logo || '')}" alt=""></span><span class="r num">${x.statusType?.completed || x.status === 'post' ? `${esc(a?.score)}–${esc(h?.score)}` : esc(x.statusType?.shortDetail || '')}</span></div>` }).join('')}</div>` + bbFsH2H(v, true);
  }
  return bbFsH2H(v, false);
}
function bbFsH2H(v, extra){
  const fs = v.fs; if (!fs) return extra ? '' : bbLoading(); if (fs.error || !fs.h2h?.length) return extra ? '' : `<div class="note">No head-to-head history found.</div>`;
  return fs.h2h.map(sec => { const games = sec.games.slice(0, sec.title.startsWith('Head') ? 10 : 8); if (!games.length) return '';
    return `<div class="sub-h"><h5>${esc(sec.title.replace('Last matches:', 'Last games:'))}</h5></div><div class="fbsched">${games.map(g => `<div class="fx"><span class="d">${esc(fmtDate(g.ts * 1000, { day: 'numeric', month: 'short', year: '2-digit' }))}<br>${esc(g.lg)}</span><span class="vs"><img src="${esc(g.hlogo)}" alt=""><span>${esc(g.home)} – ${esc(g.away)}</span><img src="${esc(g.alogo)}" alt=""></span><span class="r num">${esc(g.hs)}–${esc(g.as)} ${g.res ? `<span class="res ${g.res === 'w' ? 'W' : g.res === 'l' ? 'L' : 'D'}">${esc(g.res.toUpperCase())}</span>` : ''}</span></div>`).join('')}</div>` }).join('')
    + `<p class="srcnote">W/L is from the point of view of the team named in each heading.</p>`;
}
function bbOddsPane(v){
  const e = v.e, o = S.bb.odds?.get(e.id), kx = S.odds.get('bb' + e.id);
  let h = '';
  const us = e.src === 'espn' && e.lg !== 'nbl', [L, R, lk, rk] = us ? [e.away, e.home, 'away', 'home'] : [e.home, e.away, 'home', 'away'];
  if (e.src === 'espn' && v.sum?.pickcenter?.length) {
    h += `<div class="sub-h" style="margin-top:0"><h5>Line via ESPN</h5></div><div class="bb-books"><div class="bb-bh"><span>Book</span><span>${esc(L.abbr)}</span><span>${esc(R.abbr)}</span><span>Spread</span><span>Total</span></div>${v.sum.pickcenter.map(p => {
      const ml = s => p[s + 'TeamOdds']?.moneyLine; return `<div class="bb-br"><span>${esc(p.provider?.name || 'Book')}</span><span class="num">${ml(lk) != null ? (ml(lk) > 0 ? '+' : '') + ml(lk) : '–'}</span><span class="num">${ml(rk) != null ? (ml(rk) > 0 ? '+' : '') + ml(rk) : '–'}</span><span class="num">${esc(p.details || '–')}</span><span class="num">${p.overUnder ? 'O/U ' + esc(p.overUnder) : '–'}</span></div>` }).join('')}</div>`;
  }
  if (!o && !v.loaded) return h + bbLoading(200);
  const books = o?.books || [];
  if (books.length) {
    const best = k => Math.max(...books.map(b => b.ml?.[k] || 0));
    const bH = best(lk), bA = best(rk);
    h += `<div class="sub-h"${h ? '' : ' style="margin-top:0"'}><h5>Moneyline · sportsbooks</h5><small>American odds · best price highlighted</small></div><div class="bb-books"><div class="bb-bh"><span>Book</span><span>${esc(L.abbr || L.name)}</span><span>${esc(R.abbr || R.name)}</span><span>Spread</span><span>Total</span></div>
      ${books.map(b => { const sp = b.spread?.[0], to = bbMainTotal(b);
        const spTxt = sp ? `${esc((sp.line < 0 ? e.home : e.away).abbr || '')} ${sp.line < 0 ? sp.line : -sp.line} <small>${decAm(sp.line < 0 ? sp.home : sp.away)}</small>` : '–';
        const mv = (d, d0) => d0 && d && Math.abs(d - d0) > .02 ? `<small class="${d < d0 ? 'up' : 'dn'}" title="Opened ${decAm(d0)}">${d < d0 ? '▲' : '▼'}</small>` : '';
        return `<div class="bb-br"><span>${esc(b.name.replace('.us', ''))}</span><span class="num${b.ml?.[lk] && b.ml[lk] === bH ? ' best' : ''}">${b.ml ? decAm(b.ml[lk]) + mv(b.ml[lk], b.ml[lk + '0']) : '–'}</span><span class="num${b.ml?.[rk] && b.ml[rk] === bA ? ' best' : ''}">${b.ml ? decAm(b.ml[rk]) + mv(b.ml[rk], b.ml[rk + '0']) : '–'}</span><span class="num">${spTxt}</span><span class="num">${to ? `${to.line} <small>o${decAm(to.over)} u${decAm(to.under)}</small>` : '–'}</span></div>` }).join('')}</div>`;
    const M = bbMarket(e);
    if (M.pH != null) h += `<div class="tiles"><div class="tile"><b class="num">${pct(us ? 1 - M.pH : M.pH)}%</b><span>${esc(L.name)} win chance (no vig)</span></div><div class="tile"><b class="num">${pct(us ? M.pH : 1 - M.pH)}%</b><span>${esc(R.name)}</span></div>${M.spread != null ? `<div class="tile"><b class="num">${esc((M.spread < 0 ? e.home : e.away).abbr || '')} −${bbFix(Math.abs(M.spread))}</b><span>Consensus spread</span></div>` : ''}${M.total != null ? `<div class="tile"><b class="num">${bbFix(M.total)}</b><span>Consensus total</span></div>` : ''}</div>`;
    const sp0 = books.find(b => b.spread?.length > 1), to0 = books.find(b => b.total?.length > 1);
    if (sp0 || to0) h += `<div class="sub-h"><h5>Alternative lines</h5><small>${esc((sp0 || to0).name.replace('.us', ''))}</small></div><div class="bb-alt">${sp0 ? `<div><h6>Spread (${esc(e.home.abbr || e.home.name)})</h6>${sp0.spread.slice().sort((a, b) => a.line - b.line).map(x => `<div><span class="num">${x.line > 0 ? '+' : ''}${x.line}</span><span class="num">${decAm(x.home)}</span><span class="num">${decAm(x.away)}</span></div>`).join('')}</div>` : ''}${to0 ? `<div><h6>Total points</h6>${to0.total.map(x => `<div><span class="num">${x.line}</span><span class="num">o ${decAm(x.over)}</span><span class="num">u ${decAm(x.under)}</span></div>`).join('')}</div>` : ''}</div>`;
  } else if (!h) h += `<div class="note">${e.state === 'post' ? 'Betting has closed for this game.' : 'No bookmaker odds listed for this game yet.'}</div>`;
  if (kx?.found) {
    h += `<div class="grp-name bk-kx">Kalshi live markets</div>`;
    if (kx.ml) h += `<div class="mls" style="grid-template-columns:1fr 1fr">${[lk, rk].map(k => { const x = kx.ml[k]; if (!x) return ''; return `<div class="ml" style="--c:${k === 'home' ? e.hc : e.ac}"><span class="lbl">${esc(e[k].name)}</span><b class="num">${pct(x.p)}%</b><span class="am num">${american(x.p)} ${moveTag(x.p, x.prev)}</span><i style="width:${pct(x.p)}%"></i></div>` }).join('')}</div>`;
    if (kx.total?.length) { const main = kx.total.reduce((a, b) => Math.abs(b.p - .5) < Math.abs(a.p - .5) ? b : a);
      h += `<div class="sub-h"><h5>Total points · over</h5><small>Main line ${main.line}</small></div><div class="lines">${kx.total.map(x => `<div class="ln${x === main ? ' main' : ''}"><span><b>Over ${x.line}</b></span><span class="bar"><i style="width:${pct(x.p)}%;background:var(--accent)"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small></span></div>`).join('')}</div>` }
  }
  return h + `<p class="srcnote">Sportsbook prices (FanDuel, DraftKings, BetMGM, Fanatics and others where listed) from Flashscore's odds comparison, ${S.bb.odds?.get(e.id)?.region ? `${esc(S.bb.odds.get(e.id).region)} market (no US sportsbook lists this game)` : 'US market'}. ▲▼ show the move since the line opened. Prices change quickly; check the book before betting.</p>${RG}`;
}
function bbPredPane(v){
  const e = v.e;
  if (!S.bb.stand[e.lg] || (!v.loaded && !S.bb.odds?.get(e.id))) return bbLoading();
  const P = bbPredict(e); if (!P) return `<div class="note">Not enough information to predict this game yet.</div>`;
  const post = e.state === 'post', win = post ? (+e.home.score > +e.away.score ? 'home' : 'away') : null, pickTeam = e[P.pick];
  const us = e.src === 'espn' && e.lg !== 'nbl', [L, R, lc, rc, pL] = us ? [e.away, e.home, e.ac, e.hc, 1 - P.pH] : [e.home, e.away, e.hc, e.ac, P.pH];
  const [sL, sR] = us ? [P.score[1], P.score[0]] : P.score;
  return `<div class="pred-head"><div><h5>${post ? 'Pre-game prediction' : 'Floodlight prediction'}</h5><strong class="pred-pick">${esc(pickTeam.name)} win</strong>
      <span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf} · ${pct(P.top)}%</span>${post ? `<span class="pred-out ${win === P.pick ? 'ok' : 'miss'}">${win === P.pick ? 'Called it' : 'Missed'} — final ${esc(L.score)}–${esc(R.score)}</span>` : ''}</div>
      <div class="pred-score"><small>Projected score</small><b class="num">${sL}–${sR}</b><small>${esc(L.abbr || L.name)} – ${esc(R.abbr || R.name)}</small></div></div>
    <div class="pbar" role="img" aria-label="${esc(`${L.name} ${pct(pL)} percent, ${R.name} ${pct(1 - pL)} percent`)}"><i style="flex-grow:${pL};background:${lc}"><span>${pct(pL)}%</span></i><i style="flex-grow:${1 - pL};background:${rc}"><span>${pct(1 - pL)}%</span></i></div>
    <div class="pred-legend"><span><i style="background:${lc}"></i>${esc(L.name)}</span><span><i style="background:${rc}"></i>${esc(R.name)}</span></div>
    <div class="tiles pred-tiles"><div class="tile"><b class="num">${esc((P.margin >= 0 ? e.home : e.away).abbr || (P.margin >= 0 ? e.home : e.away).name)} −${Math.abs(P.margin).toFixed(1)}</b><span>Projected spread</span></div>
      <div class="tile"><b class="num">${P.total.toFixed(1)}</b><span>Projected total${P.M.total != null ? ` · books ${bbFix(P.M.total)}` : ''}</span></div>
      <div class="tile"><b class="num">${P.market != null ? pct(P.market) + '%' : '–'}</b><span>${esc(e.home.abbr || e.home.name)} in the market</span></div>
      <div class="tile"><b class="num">${pct(P.pModel)}%</b><span>${esc(e.home.abbr || e.home.name)} on form alone</span></div></div>
    <div class="sub-h"><h5>Why</h5></div><ul class="why">${bbReasons(e, P).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    ${bbSeasonCompare(v)}
    <p class="srcnote">Model: each team's average winning margin this season (shrunk toward zero early on) plus home court, turned into a win chance. When sportsbooks list the game, their no-vig consensus carries 70% of the chance, spread and total${BBL[e.lg].kx ? ' (Kalshi included)' : ''}; ESPN's matchup predictor adds 20% where it exists.</p>${RG}`;
}
function bbGameTabs(v){
  const e = v.e;
  return [['box', 'Box score'], ['team', 'Team stats'], ['odds', 'Odds'], ['pred', 'Prediction'], ['h2h', e.src === 'espn' ? 'Series & H2H' : 'Head to head'], ['stand', 'Standings']];
}

/* ---------- team pages ---------- */
function openBbTeam(id, lgKey, slug){
  if (!id) return;
  const l = BBL[lgKey] || BBL.nba;
  pushView({ type: 'bbteam', id: String(id), lg: l.key, slug: slug || '', tab: 'roster' });
  const v = S.stack[S.stack.length - 1], re = () => S.stack.includes(v) && renderSheet();
  bbStandings(l.key).then(re);
  if (l.src === 'espn') {
    Promise.allSettled([cj(`${BBE}/${l.path}/teams/${id}`), cj(`${BBE}/${l.path}/teams/${id}/roster`), cj(`${BBE}/${l.path}/teams/${id}/schedule`), cj(`${BBE}/${l.path}/teams/${id}/statistics`)]).then(([t, r, s, st]) => {
      v.team = val(t)?.team; v.roster = val(r); v.sched = val(s); v.stats = val(st); if (!v.team) v.err = true; re() });
  } else {
    const row = bbRow(l.key, String(id)); if (!v.slug && row?.slug) v.slug = row.slug;
    const go = () => getJSON(`/api/bb/team?id=${id}&slug=${encodeURIComponent(v.slug)}`).then(d => { v.fs = d; for (const e of [...d.results, ...d.fixtures]) S.bb.games.set(e.id, bbNormFs(e)); re() }).catch(() => { v.err = true; re() });
    if (v.slug) go(); else bbStandings(l.key).then(() => { const r = bbRow(l.key, String(id)); if (r?.slug) { v.slug = r.slug; go() } else { v.err = true; re() } });
  }
}
function bbTeamHero(v, back){
  const l = BBL[v.lg], espn = l.src === 'espn', t = espn ? v.team : v.fs, row = bbRow(v.lg, v.id);
  const name = espn ? t?.displayName : t?.name, logo = espn ? t?.logos?.[0]?.href : t?.logo || bbTeamLogo(v.lg, v.id);
  const col = espn && hex(t?.color) && lum(hex(t.color)) > .03 ? hex(t.color) : '#' + fmColor(name || v.id);
  v.color = col;
  const favId = `bb-${v.lg}-${v.id}`, isFavd = S.fav.some(f => f.id === favId);
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead">${logo ? `<img class="crest" src="${esc(logo)}" alt="">` : ''}<div><h3>${esc(name || 'Loading…')}</h3>
    <p>${row ? `<span>${row.w}-${row.l}</span>` : espn && t?.record?.items?.[0]?.summary ? `<span>${esc(t.record.items[0].summary)}</span>` : ''}${espn && t?.standingSummary ? `<span>${esc(t.standingSummary)}</span>` : row?.group ? `<span>${esc(row.group)}</span>` : ''}<span>${esc(l.name)}</span>${!espn && t?.venue ? `<span>${esc(t.venue)}${t.city ? ', ' + esc(t.city) : ''}</span>` : ''}</p>
    ${name ? `<button class="favbtn" data-bbact="fav" aria-pressed="${isFavd}">${isFavd ? '★ Following' : '☆ Follow'}</button>` : ''}</div></div>
    ${row ? `<div class="tiles"><div class="tile"><b class="num">${row.w}-${row.l}</b><span>Record</span></div><div class="tile"><b class="num">${bbFix(row.ppg)}</b><span>Points a game</span></div><div class="tile"><b class="num">${bbFix(row.oppg)}</b><span>Allowed a game</span></div><div class="tile"><b class="num">${row.ppg - row.oppg > 0 ? '+' : ''}${bbFix(row.ppg - row.oppg)}</b><span>Point difference</span></div></div>` : ''}</div>`;
}
function bbTeamPane(v){
  const l = BBL[v.lg], espn = l.src === 'espn';
  if (v.err) return `<div class="note">Couldn't load this team.</div>`;
  if (espn ? !v.team : !v.fs) return bbLoading();
  if (v.tab === 'roster') {
    if (espn) { const list = v.roster?.athletes || []; if (!list.length) return `<div class="note">No roster published.</div>`;
      return `<div class="sub-h" style="margin-top:0"><h5>Roster</h5><small>${list.length} players</small></div>` + list.map(a => `<button class="prow ph${a.injuries?.length ? ' out' : ''}" data-bbplayer="${esc(a.id)}" data-bbl="${esc(v.lg)}">
        <b>${esc(a.jersey ?? '–')}</b><img class="face-s espn-shot" src="${esc(a.headshot?.href || bbShot(a.id, l.path))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=SIL">
        <span class="nm"><span>${esc(a.displayName)}</span> ${a.injuries?.length ? `<span class="stat-badge injured">${esc(a.injuries[0].status || 'Injured')}</span>` : ''}<small>${esc([a.position?.displayName, a.age ? a.age + ' yrs' : '', a.displayHeight, a.displayWeight, a.college?.shortName || a.birthPlace?.country].filter(Boolean).join(' · '))}</small></span>
        <span class="st2">${a.experience?.years != null ? (a.experience.years ? a.experience.years + ' yr' + (a.experience.years > 1 ? 's' : '') : 'Rookie') : ''}</span></button>`).join('') }
    const list = v.fs.roster || []; if (!list.length) return `<div class="note">No roster published.</div>`;
    return `<div class="sub-h" style="margin-top:0"><h5>Roster</h5><small>${list.length} players</small></div>` + list.map(a => `<button class="prow ph${a.out ? ' out' : ''}" data-bbfsplayer="${esc(a.id)}" data-bbslug="${esc(a.slug)}" data-bbl="${esc(v.lg)}">
      <b>${esc(a.jersey || '–')}</b><img class="face-s" src="${esc(S.bb.faces?.[a.id] || SIL)}" alt="" loading="lazy" data-bbface="${esc(a.id)}" data-bbslug="${esc(a.slug)}" onerror="this.onerror=null;this.src=SIL">
      <span class="nm"><span>${esc(a.name)}</span> ${a.out ? `<span class="stat-badge injured">${esc(a.out)}</span>` : ''}<small>${esc([a.country, a.age ? a.age + ' yrs' : ''].filter(Boolean).join(' · '))}</small></span><span class="st2"></span></button>`).join('')
      + `<p class="srcnote">Roster from Flashscore. Tap a player for photo, bio, season averages and recent games.</p>`;
  }
  if (v.tab === 'sched') {
    if (espn) { const evs = (v.sched?.events || []).map(ev => ({ ev, c: ev.competitions?.[0] })).filter(x => x.c); if (!evs.length) return `<div class="note">No schedule published.</div>`;
      return `<div class="fbsched">${evs.map(({ ev, c }) => { const me = c.competitors.find(x => String(x.team?.id) === v.id), op = c.competitors.find(x => x !== me) || {}; const st = c.status?.type || {};
        const sc = x => (typeof x?.score === 'object' ? x.score?.displayValue : x?.score) ?? ''; const res = st.completed ? (me?.winner ? 'W' : 'L') : ''; const d = new Date(ev.date);
        return `<div class="fx"><span class="d">${esc(fmtDate(d))}</span><span class="vs"><small>${me?.homeAway === 'home' ? 'vs' : '@'}</small><img src="${esc(op.team?.logos?.[0]?.href || op.team?.logo || '')}" alt=""><span><button class="linkbtn" data-bbteam="${esc(op.team?.id)}" data-bbl="${esc(v.lg)}">${esc(op.team?.displayName || 'TBD')}</button></span></span>
          <span class="r num">${st.completed ? `${esc(sc(me))}–${esc(sc(op))} <span class="res ${res}">${res}</span>` : esc(d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span></div>` }).join('')}</div>` }
    const all = [...(v.fs.fixtures || []).slice(0, 12).reverse(), ...(v.fs.results || [])].map(x => x.date ? x : bbNormFs(x));
    if (!all.length) return `<div class="note">No games found.</div>`;
    return `<div class="fbsched">${all.map(e => { const home = e.home.id === v.id, me = home ? e.home : e.away, op = home ? e.away : e.home; const res = e.state === 'post' ? (+me.score > +op.score ? 'W' : 'L') : '';
      return `<button class="fx bb-fx" data-bbgame="${esc(e.id)}"><span class="d">${esc(fmtDate(e.date))}<br>${esc(e.lgName || bbName(e.lg) || '')}</span><span class="vs"><small>${home ? 'vs' : '@'}</small><img src="${esc(op.logo)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(op.full || op.name)}</span></span>
        <span class="r num">${e.state === 'post' ? `${esc(me.score)}–${esc(op.score)} <span class="res ${res}">${res}</span>` : esc(e.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span></button>` }).join('')}</div>`;
  }
  if (v.tab === 'stats') return bbTeamSeasonPane(v);
  if (v.tab === 'stand') return bbStandingsHTML(v.lg, [v.id]);
  return '';
}
function bbTeamSeasonPane(v){
  const l = BBL[v.lg], row = bbRow(v.lg, v.id);
  let h = '';
  if (l.src === 'espn') {
    const cats = v.stats?.results?.stats?.categories || v.stats?.statistics?.splits?.categories || [];
    if (cats.length) h += cats.map(c => `<div class="grp-name" style="font-size:13px">${esc(c.displayName || c.name)}</div><div class="bb-tstats">${(c.stats || []).filter(s => s.displayValue != null).map(s => `<div><span>${esc(s.displayName || s.name)}</span><b class="num">${esc(s.displayValue)}</b>${s.rankDisplayValue ? `<small>${esc(s.rankDisplayValue)}</small>` : ''}</div>`).join('')}</div>`).join('');
  } else {
    const res = (v.fs?.results || []).map(x => x.date ? x : bbNormFs(x)).filter(e => !BBL[v.lg] || e.lg === v.lg || !e.lg);
    const mine = res.map(e => { const home = e.home.id === v.id, me = home ? e.home : e.away, op = home ? e.away : e.home; return { home, f: +me.score, a: +op.score, w: +me.score > +op.score, q: me.lines || [], oq: op.lines || [] } }).filter(x => !isNaN(x.f) && !isNaN(x.a) && (x.f || x.a));
    if (mine.length) {
      const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null;
      const H = mine.filter(x => x.home), A = mine.filter(x => !x.home), last = mine.slice(0, 10);
      const quarter = i => avg(mine.filter(x => x.q[i] != null), x => +x.q[i] - +x.oq[i]);
      h += `<div class="sub-h" style="margin-top:0"><h5>From the last ${mine.length} games</h5><small>all competitions</small></div><div class="bb-tstats">
        ${[['Record', `${mine.filter(x => x.w).length}-${mine.filter(x => !x.w).length}`], ['Points a game', bbFix(avg(mine, x => x.f))], ['Allowed a game', bbFix(avg(mine, x => x.a))], ['Average margin', bbFix(avg(mine, x => x.f - x.a))],
          ['Home record', `${H.filter(x => x.w).length}-${H.filter(x => !x.w).length}`], ['Away record', `${A.filter(x => x.w).length}-${A.filter(x => !x.w).length}`], ['Home points', bbFix(avg(H, x => x.f))], ['Away points', bbFix(avg(A, x => x.f))],
          ['Last 10', `${last.filter(x => x.w).length}-${last.filter(x => !x.w).length}`], ['Average total', bbFix(avg(mine, x => x.f + x.a))], ['Close games (≤5)', `${mine.filter(x => Math.abs(x.f - x.a) <= 5 && x.w).length}-${mine.filter(x => Math.abs(x.f - x.a) <= 5 && !x.w).length}`],
          ...[0, 1, 2, 3].map(i => [`Q${i + 1} margin`, (quarter(i) > 0 ? '+' : '') + bbFix(quarter(i))])].map(([k, x]) => `<div><span>${esc(k)}</span><b class="num">${esc(x)}</b></div>`).join('')}</div>`;
    }
  }
  if (!h && !row) return `<div class="note">No team stats yet.</div>`;
  return h + (row ? `<div class="sub-h"><h5>League table</h5></div><div class="bb-tstats"><div><span>Position</span><b class="num">${row.rank || row.seed || '–'}</b></div><div><span>Win %</span><b class="num">${esc(row.pct)}</b></div><div><span>Points a game</span><b class="num">${bbFix(row.ppg)}</b></div><div><span>Allowed</span><b class="num">${bbFix(row.oppg)}</b></div></div>` : '');
}

/* ---------- player pages ---------- */
// ESPN leagues: bio, season averages with rank and percentile among qualified players, game log, splits and career.
// Flashscore leagues: photo, bio, season averages by competition, and recent games.
const BB_RANK = [['offensive.avgPoints', 'Points', 'PTS'], ['general.avgRebounds', 'Rebounds', 'REB'], ['offensive.avgAssists', 'Assists', 'AST'], ['defensive.avgSteals', 'Steals', 'STL'],
  ['defensive.avgBlocks', 'Blocks', 'BLK'], ['offensive.avgThreePointFieldGoalsMade', '3-pointers made', '3PM'], ['offensive.fieldGoalPct', 'Field goal %', 'FG%'], ['offensive.threePointFieldGoalPct', '3-point %', '3P%'],
  ['offensive.freeThrowPct', 'Free throw %', 'FT%'], ['general.avgMinutes', 'Minutes', 'MIN'], ['offensive.avgFieldGoalsAttempted', 'Shots a game', 'FGA'], ['offensive.avgFreeThrowsAttempted', 'Free throws a game', 'FTA'],
  ['offensive.avgTurnovers', 'Turnovers (fewer is better)', 'TO', true], ['general.doubleDouble', 'Double-doubles', 'DD2']];
async function bbPool(path, season){
  const k = `${path}|${season || 'now'}`; if (S.bb.pools[k]) return S.bb.pools[k];
  return S.bb.pools[k] = (async () => {
    const out = [];
    for (let page = 1; page <= 6; page++) {
      const d = await getJSON(`${BBW}/${path}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&limit=200&page=${page}&sort=offensive.avgPoints%3Adesc${season ? `&season=${season}&seasontype=2` : ''}`);
      const names = Object.fromEntries((d.categories || []).map(c => [c.name, c.names]));
      for (const a of d.athletes || []) { const vals = {}; for (const c of a.categories || []) (names[c.name] || []).forEach((n, i) => { vals[c.name + '.' + n] = bbNum(c.totals?.[i]) });
        out.push({ id: String(a.athlete?.id), name: a.athlete?.displayName, gp: vals['general.gamesPlayed'] || 0, vals }) }
      if (!d.pagination || page >= d.pagination.pages) break;
    }
    return out;
  })().catch(() => { delete S.bb.pools[k]; return [] });
}
function bbRankIn(pool, id, key, low){
  if (!pool?.length) return null;
  const maxGp = Math.max(...pool.map(p => p.gp)); const min = Math.max(1, Math.round(maxGp * .4));
  const pctStat = /Pct$/.test(key), q = pool.filter(p => p.gp >= min && p.vals[key] != null && (!pctStat || (p.vals[key.replace('fieldGoalPct', 'avgFieldGoalsAttempted').replace('threePointFieldGoalPct', 'avgThreePointFieldGoalsAttempted').replace('freeThrowPct', 'avgFreeThrowsAttempted')] || 0) >= 1));
  const me = pool.find(p => p.id === String(id)); if (!me || me.vals[key] == null) return null;
  const v = me.vals[key], better = q.filter(p => low ? p.vals[key] < v : p.vals[key] > v).length;
  const inPool = q.some(p => p.id === me.id);
  const n = q.length + (inPool ? 0 : 1);
  return { rank: better + 1, n, pc: Math.round((1 - better / Math.max(1, n - 1)) * 100), qualified: inPool, val: v };
}
function openBbPlayer(id, lgKey){
  const l = BBL[lgKey] || BBL.nba; if (!id) return;
  pushView({ type: 'bbplayer', id: String(id), lg: l.key, tab: 'stats' });
  const v = S.stack[S.stack.length - 1], re = () => S.stack.includes(v) && renderSheet();
  Promise.allSettled([cj(`${BBW}/${l.path}/athletes/${id}`), cj(`${BBW}/${l.path}/athletes/${id}/stats`), cj(`${BBW}/${l.path}/athletes/${id}/gamelog`), cj(`${BBW}/${l.path}/athletes/${id}/splits`)]).then(([b, s, g, sp]) => {
    v.bio = val(b)?.athlete; v.stats = val(s); v.log = val(g); v.splits = val(sp); if (!v.bio) v.err = true;
    // season to compare: the latest one the player has stats for
    const av = v.stats?.categories?.find(c => c.name === 'averages'), last = av?.statistics?.[av.statistics.length - 1];
    v.season = last?.season?.year || null;
    re();
    bbPool(l.path, v.season).then(p => { v.pool = p; re() });
  });
}
function bbPlayerHero(v, back){
  const a = v.bio, t = a?.team, l = BBL[v.lg];
  const col = hex(t?.color) && lum(hex(t.color)) > .03 ? hex(t.color) : '#3D6FD9'; v.color = col;
  const av = v.stats?.categories?.find(c => c.name === 'averages'), last = av?.statistics?.[av.statistics.length - 1];
  const sv = n => { const i = av?.names?.indexOf(n); return i >= 0 ? last?.stats?.[i] : null };
  const tiles = last ? [['avgPoints', 'Points', 'offensive.avgPoints'], ['avgRebounds', 'Rebounds', 'general.avgRebounds'], ['avgAssists', 'Assists', 'offensive.avgAssists'], ['fieldGoalPct', 'FG %', 'offensive.fieldGoalPct']].map(([n, lbl, key]) => {
    const r = bbRankIn(v.pool, v.id, key); return `<div class="tile"><b class="num">${esc(sv(n) ?? '–')}</b><span>${lbl} ${n === 'fieldGoalPct' ? '' : 'a game'}</span>${r ? `<em class="bb-rk">${bbOrd(r.rank)} of ${r.n}</em>` : ''}</div>` }).join('') : '';
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(a?.headshot?.href || bbShot(v.id, l.path))}" alt="" onerror="this.onerror=null;this.src=SIL"><div><h3>${esc(a?.displayName || 'Loading…')}</h3>
    ${a ? `<p>${a.displayJersey ? `<span class="num">${esc(a.displayJersey)}</span>` : ''}<span>${esc(a.position?.displayName || '')}</span>${t ? `<span><img src="${esc(t.logos?.[0]?.href || '')}" alt=""> <button class="linkbtn" data-bbteam="${esc(t.id)}" data-bbl="${esc(v.lg)}">${esc(t.displayName)}</button></span>` : ''}</p>
      <p class="bb-bio">${[a.age ? a.age + ' yrs' : '', a.displayHeight, a.displayWeight, a.displayBirthPlace, a.displayDraft ? 'Draft: ' + a.displayDraft : '', a.displayExperience, a.college?.name].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</p>
      ${a.injuries?.length ? `<p><span class="stat-badge injured">${esc(a.injuries[0].status || 'Injured')}${a.injuries[0].details?.type ? ' · ' + esc(a.injuries[0].details.type) : ''}</span></p>` : ''}` : ''}</div></div>
    ${tiles ? `<div class="tiles">${tiles}</div><p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(last.season?.displayName || '')} per game${v.pool ? ` · ranked among ${esc(l.name)} players with enough games` : ''}</p>` : ''}</div>`;
}
function bbPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  if (!v.bio) return bbLoading();
  const l = BBL[v.lg];
  if (v.tab === 'stats') {
    const av = v.stats?.categories?.find(c => c.name === 'averages'), last = av?.statistics?.[av.statistics.length - 1];
    if (!last) return `<div class="note">No stats for this player yet.</div>`;
    let h = '';
    if (!v.pool) h += bbLoading(120);
    else {
      const rows = BB_RANK.map(([key, label, ab, low]) => ({ key, label, ab, low, r: bbRankIn(v.pool, v.id, key, low) })).filter(x => x.r);
      if (rows.length) {
        const me = v.pool.find(p => p.id === v.id);
        const items = rows.filter(x => ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%'].includes(x.ab)).map(x => ({ title: x.ab, value: x.r.pc / 100 }));
        const rad = items.length >= 3 ? radarSVG({ items }, v.color || '#3D6FD9') : '';
        const strong = rows.filter(x => x.r.pc >= 80 && x.r.qualified).sort((a, b) => b.r.pc - a.r.pc).slice(0, 5), weak = rows.filter(x => x.r.pc <= 25 && x.r.qualified).sort((a, b) => a.r.pc - b.r.pc).slice(0, 4);
        const chip = x => `<li><span>${esc(x.label)}</span><b class="num">${bbFix(x.r.val, /%/.test(x.ab) ? 1 : x.ab === 'DD2' ? 0 : 1)}</b><small>${bbOrd(x.r.rank)} of ${x.r.n}</small></li>`;
        h += `<div class="bb-viz">${rad ? `<div class="radar"><h5>Compared with the league</h5>${rad}<small>Percentile among ${esc(l.name)} players with enough games (100 = best).</small></div>` : ''}
          <div class="bb-sw">${strong.length ? `<h5>Best at</h5><ul class="bb-chips hi">${strong.map(chip).join('')}</ul>` : ''}${weak.length ? `<h5>Below average</h5><ul class="bb-chips lo">${weak.map(chip).join('')}</ul>` : ''}
          ${rows[0] && !rows[0].r.qualified ? `<p class="bb-q">Not enough games yet to be ranked with the regulars, so these are rough.</p>` : ''}</div></div>
          <div class="sub-h"><h5>Per game and league rank</h5><small>${esc(last.season?.displayName || '')}${me ? ` · ${me.gp} games` : ''}</small></div>
          <div class="bb-rh"><span>Stat</span><span>Value</span><span>Rank</span><span>Percentile</span></div>${rows.map(x => { const pc = x.r.pc, cls = pc >= 70 ? 'hi' : pc < 30 ? 'lo' : '';
            return `<div class="bb-rr"><span>${esc(x.label)}</span><b class="num">${bbFix(x.r.val, x.ab === 'DD2' ? 0 : 1)}</b><span class="num">${bbOrd(x.r.rank)}<small>/${x.r.n}</small></span><span class="bb-pc"><span class="ps-bar"><i class="${cls}" style="width:${Math.max(2, pc)}%"></i></span><span class="num ${cls}">${pc}</span></span></div>` }).join('')}`;
      }
    }
    // full season table: every row ESPN returns (regular season by year)
    const tot = v.stats?.categories?.find(c => c.name === 'totals'), misc = v.stats?.categories?.find(c => c.name === 'miscellaneous');
    const table = (c, title) => c ? `<div class="sub-h"><h5>${esc(title)}</h5></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left">Season</th>${c.labels.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${c.statistics.slice().reverse().map(s => `<tr><td class="t">${esc(s.season?.displayName || '')} <small>${esc((s.teamSlug || '').split('-').pop())}</small></td>${s.stats.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    return h + table(av, 'Career per game') + table(tot, 'Career totals') + table(misc, 'Miscellaneous');
  }
  if (v.tab === 'log') {
    const g = v.log; if (!g?.seasonTypes?.length) return `<div class="note">No games logged this season.</div>`;
    const labels = (g.labels || []);
    return g.seasonTypes.map(st => { const evs = st.categories.filter(c => c.type === 'event').flatMap(c => c.events || []); if (!evs.length) return '';
      return `<div class="sub-h"><h5>${esc(st.displayName)}</h5><small>${evs.length} games</small></div><div class="tbl-wrap"><table class="ctable bb-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opp</th><th>Res</th>${labels.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
        ${evs.map(x => { const m = g.events?.[x.eventId] || {}; return `<tr><td class="t">${esc(fmtDate(m.gameDate))}</td><td class="t"><img src="${esc(m.opponent?.logo || '')}" alt="" style="width:16px;height:16px;object-fit:contain">${esc(m.atVs || '')} ${esc(m.opponent?.abbreviation || '')}</td><td><span class="res ${m.gameResult === 'W' ? 'W' : 'L'}">${esc(m.gameResult || '')}</span> ${esc(m.score || '')}</td>${x.stats.map(s => `<td>${esc(s)}</td>`).join('')}</tr>` }).join('')}</tbody></table></div>` }).join('');
  }
  if (v.tab === 'splits') {
    const s = v.splits; if (!s?.splitCategories?.length) return `<div class="note">No splits yet.</div>`;
    return `<p class="srcnote" style="margin-top:0">${esc(s.displayName || '')}</p>` + s.splitCategories.map(c => `<div class="sub-h"><h5>${esc(c.displayName === 'split' ? 'Overview' : c.displayName)}</h5></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left"></th>${s.labels.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${c.splits.map(r => `<tr><td class="t">${esc(r.displayName)}</td>${(r.stats || []).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  }
  return '';
}
// Flashscore player page
function openBbFsPlayer(id, slug, lgKey){
  if (!id || !slug) return;
  pushView({ type: 'bbfsplayer', id: String(id), slug, lg: lgKey || 'euroleague', tab: 'stats' });
  const v = S.stack[S.stack.length - 1];
  getJSON(`/api/bb/player?id=${id}&slug=${encodeURIComponent(slug)}`).then(d => { v.p = d; if (d.photo) (S.bb.faces ||= {})[id] = d.photo; S.stack.includes(v) && renderSheet(); bbFsPlayerLeagues(v) }).catch(() => { v.err = true; S.stack.includes(v) && renderSheet() });
}
function bbFsPlayerHero(v, back){
  const p = v.p, col = '#' + fmColor(p?.teamName || v.slug); v.color = col;
  const cur = p?.career?.find(c => c.type === 'league');
  const d = v.rk && S.bb.leaders?.[v.rk], me = d?.players.find(x => x.id === v.id);
  const rkTiles = me ? `<div class="tiles">${[['PTS', 'Points a game'], ['REB', 'Rebounds'], ['AST', 'Assists'], ['EFF', 'Efficiency']].map(([k, l]) => { const r = bbFsRank(d, v.id, k);
    return `<div class="tile"><b class="num">${bbFix(me.avg[k])}</b><span>${l}</span>${r ? `<em class="bb-rk">${bbOrd(r.rank)} of ${r.n}</em>` : ''}</div>` }).join('')}</div>
    <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(bbName(v.rk))} ${esc(d.season || '')} · ${me.gp} games · ranked among the league's regulars</p>` : '';
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(p?.photo || SIL)}" alt="" onerror="this.onerror=null;this.src=SIL"><div><h3>${esc(p?.name || 'Loading…')}</h3>
    ${p ? `<p>${p.position ? `<span>${esc(p.position)}</span>` : ''}${p.teamId ? `<span><button class="linkbtn" data-bbteam="${esc(p.teamId)}" data-bbslug="${esc(p.teamSlug)}" data-bbl="${esc(v.lg)}">${esc(p.teamName || p.teamSlug)}</button></span>` : ''}</p>
      <p class="bb-bio">${[p.age ? p.age + ' yrs' : '', p.born ? 'Born ' + p.born : '', p.height, p.weight, p.flag ? p.flag.toUpperCase() : ''].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</p>` : ''}</div></div>
    ${rkTiles || (cur ? `<div class="tiles"><div class="tile"><b class="num">${esc(cur.pts ?? '–')}</b><span>Points a game</span></div><div class="tile"><b class="num">${esc(cur.reb ?? '–')}</b><span>Rebounds</span></div><div class="tile"><b class="num">${esc(cur.ast ?? '–')}</b><span>Assists</span></div><div class="tile"><b class="num">${esc(cur.gp ?? '–')}</b><span>Games</span></div></div>
      <p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(cur.comp)} ${esc(cur.season)} · ${esc(cur.team)}</p>` : '')}</div>`;
}
function bbFsPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  const p = v.p; if (!p) return bbLoading();
  if (v.tab === 'stats') {
    // averages over the recent games we have box-score lines for
    const L = p.last.filter(m => m.stats && Object.keys(m.stats).length && !m.absent);
    const avg = k => { const xs = L.map(m => k === 'minutes-played' ? (([a, b]) => +a + (+b || 0) / 60)(String(m.stats[k] || '0').split(':')) : bbNum(m.stats[k])).filter(x => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
    const recent = L.length ? `<div class="sub-h" style="margin-top:0"><h5>Last ${L.length} games</h5><small>per game</small></div><div class="bb-tstats">${[['point', 'Points'], ['total-rebound', 'Rebounds'], ['assist', 'Assists'], ['steal', 'Steals'], ['turnover', 'Turnovers'], ['minutes-played', 'Minutes'], ['block', 'Blocks']].map(([k, lbl]) => { const a = avg(k); return a == null ? '' : `<div><span>${lbl}</span><b class="num">${bbFix(a)}</b></div>` }).join('')}</div>` : '';
    const groups = {}; for (const c of p.career) (groups[c.type] ||= []).push(c);
    const title = { league: 'League seasons', 'international-cups': 'International cups', 'national-team': 'National team' };
    const car = Object.entries(groups).map(([k, rows]) => `<div class="sub-h"><h5>${esc(title[k] || k)}</h5><small>per game</small></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team · competition</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th></tr></thead><tbody>
      ${rows.map(c => `<tr><td class="t">${esc(c.season)}</td><td class="t">${c.logo ? `<img src="${esc(c.logo)}" alt="" style="width:16px;height:16px;object-fit:contain">` : ''}${c.teamId ? `<button class="linkbtn" data-bbteam="${esc(c.teamId)}" data-bbslug="${esc(c.teamSlug)}" data-bbl="${esc(v.lg)}">${esc(c.team)}</button>` : esc(c.team || '')} <small>${esc(c.comp || '')}</small></td><td>${esc(c.gp ?? '')}</td><td>${esc(c.min ?? '')}</td><td><b>${esc(c.pts ?? '')}</b></td><td>${esc(c.reb ?? '')}</td><td>${esc(c.ast ?? '')}</td><td>${esc(c.stl ?? '')}</td><td>${esc(c.blk ?? '')}</td></tr>`).join('')}</tbody></table></div>`).join('');
    const rk = bbFsRankHTML(v);
    return (rk + (rk && recent ? recent.replace('style="margin-top:0"', '') : recent) + car) || `<div class="note">No stats published for this player yet.</div>`;
  }
  if (v.tab === 'log') {
    if (!p.last.length) return `<div class="note">No recent games.</div>`;
    return `<div class="tbl-wrap"><table class="ctable bb-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Game</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>TO</th></tr></thead><tbody>
      ${p.last.map(m => `<tr><td class="t">${esc(m.date || '')}</td><td class="t"><button class="linkbtn" data-bbgame="${esc(m.id)}">${esc(m.home)} ${esc(m.hs ?? '')}–${esc(m.as ?? '')} ${esc(m.away)}</button><small>${esc(m.lg)}</small></td>${m.absent ? `<td colspan="6" class="dnp-r">${esc(m.absent)}</td>` : ['minutes-played', 'point', 'total-rebound', 'assist', 'steal', 'turnover'].map(k => `<td>${esc(m.stats[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="srcnote">Recent games from Flashscore. Tap a game for its full box score.</p>`;
  }
  return '';
}

/* ---------- league-wide player stats for Flashscore leagues (built by the server from every box score) ---------- */
const BB_FS_STATS = [['PTS', 'Points'], ['REB', 'Rebounds'], ['AST', 'Assists'], ['STL', 'Steals'], ['BLK', 'Blocks'], ['3PM', '3-pointers made'],
  ['FG%', 'Field goal %'], ['3P%', '3-point %'], ['FT%', 'Free throw %'], ['TS%', 'True shooting %'], ['EFF', 'Efficiency'], ['MIN', 'Minutes'],
  ['OREB', 'Offensive rebounds'], ['DREB', 'Defensive rebounds'], ['FGA', 'Shots a game'], ['FTA', 'Free throws a game'], ['PM', 'Plus-minus'], ['TO', 'Turnovers (fewer is better)', true]];
async function bbLeaders(key){
  const c = S.bb.leaders?.[key]; if (c && Date.now() - c.at < 600000) return c;
  const d = await getJSON(`/api/bb/leaders?key=${key}`); d.at = Date.now();
  return (S.bb.leaders ||= {})[key] = d;
}
// who counts in a ranking: enough games, and enough attempts for the shooting percentages
function bbFsPool(d, stat){
  const maxGp = Math.max(0, ...d.players.map(p => p.gp)), min = Math.max(1, Math.round(maxGp * .4));
  const att = { 'FG%': p => p.avg.FGA >= 3, '3P%': p => p.tot['3PA'] / p.gp >= 1, 'FT%': p => p.avg.FTA >= 1, 'TS%': p => p.avg.FGA >= 3 };
  return d.players.filter(p => p.gp >= min && p.avg[stat] != null && (!att[stat] || att[stat](p)));
}
function bbFsRank(d, id, stat, low){
  const me = d?.players.find(p => p.id === id); if (!me || me.avg[stat] == null) return null;
  const q = bbFsPool(d, stat), v = me.avg[stat], better = q.filter(p => low ? p.avg[stat] < v : p.avg[stat] > v).length;
  const inPool = q.some(p => p.id === id), n = q.length + (inPool ? 0 : 1);
  return { rank: better + 1, n, pc: Math.round((1 - better / Math.max(1, n - 1)) * 100), qualified: inPool, val: v };
}
const BB_FS_URL = [['/europe/euroleague/', 'euroleague'], ['/europe/eurocup/', 'eurocup'], ['/europe/champions-league/', 'bcl'], ['vtb-united-league', 'vtb'], ['aba-league', 'aba'],
  ['/africa/bal', 'bal'], ['/china/cba', 'cba'], ['/japan/b-league', 'bleague'], ['/south-korea/kbl', 'kbl'], ['/philippines/pba', 'pba'], ['/asia/easl', 'easl'], ['champions-league-americas', 'bcla']];
const bbKeyFromUrl = u => (BB_FS_URL.find(([k]) => (u || '').includes(k)) || [])[1] || null;
// the covered leagues a player is in this season: the page we came from, plus their latest career rows
async function bbFsPlayerLeagues(v){
  const p = v.p, latest = p.career.map(c => c.season).sort().pop();
  const keys = [...new Set([BBL[v.lg]?.src === 'fs' ? v.lg : null, ...p.career.filter(c => c.season === latest).map(c => bbKeyFromUrl(c.compUrl))].filter(k => k && BBL[k]?.src === 'fs'))];
  const res = await Promise.allSettled(keys.map(bbLeaders));
  v.ranks = keys.filter((k, i) => val(res[i])?.players?.some(x => x.id === v.id));
  v.rk ||= v.ranks[0] || null;
  if (S.stack.includes(v)) renderSheet();
}
function bbFsRankHTML(v){
  if (!v.ranks) return bbLoading(120);
  if (!v.ranks.length) return '';
  const key = v.rk, d = S.bb.leaders[key], me = d.players.find(p => p.id === v.id);
  const rows = BB_FS_STATS.map(([k, label, low]) => ({ k, label, low, r: bbFsRank(d, v.id, k, low) })).filter(x => x.r);
  const items = rows.filter(x => ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TS%', 'EFF'].includes(x.k)).map(x => ({ title: x.k, value: x.r.pc / 100 }));
  const rad = items.length >= 3 ? radarSVG({ items }, v.color || '#3D6FD9') : '';
  const strong = rows.filter(x => x.r.pc >= 80 && x.r.qualified).sort((a, b) => b.r.pc - a.r.pc).slice(0, 5), weak = rows.filter(x => x.r.pc <= 25 && x.r.qualified).sort((a, b) => a.r.pc - b.r.pc).slice(0, 4);
  const fmt = (k, x) => bbFix(x, k.endsWith('%') ? 1 : 1);
  const chip = x => `<li><span>${esc(x.label)}</span><b class="num">${fmt(x.k, x.r.val)}</b><small>${bbOrd(x.r.rank)} of ${x.r.n}</small></li>`;
  return `${v.ranks.length > 1 ? `<div class="quick">${v.ranks.map(k => `<button class="qf" data-bbact="rk" data-to="${k}" aria-pressed="${k === key}">${esc(bbName(k))}</button>`).join('')}</div>` : ''}
    <div class="bb-viz">${rad ? `<div class="radar"><h5>Compared with ${esc(bbName(key))}</h5>${rad}<small>Percentile among ${esc(bbName(key))} players with enough games (100 = best).</small></div>` : ''}
      <div class="bb-sw">${strong.length ? `<h5>Best at</h5><ul class="bb-chips hi">${strong.map(chip).join('')}</ul>` : ''}${weak.length ? `<h5>Below average</h5><ul class="bb-chips lo">${weak.map(chip).join('')}</ul>` : ''}
      ${rows[0] && !rows[0].r.qualified ? `<p class="bb-q">Not enough games yet to be ranked with the regulars, so these are rough.</p>` : ''}</div></div>
    <div class="sub-h"><h5>${esc(bbName(key))} per game and rank</h5><small>${esc(d.season || '')} · ${me.gp} game${me.gp === 1 ? '' : 's'}</small></div>
    <div class="bb-rh"><span>Stat</span><span>Value</span><span>Rank</span><span>Percentile</span></div>${rows.map(x => { const pc = x.r.pc, cls = pc >= 70 ? 'hi' : pc < 30 ? 'lo' : '';
      return `<div class="bb-rr"><span>${esc(x.label)}</span><b class="num">${fmt(x.k, x.r.val)}</b><span class="num">${bbOrd(x.r.rank)}<small>/${x.r.n}</small></span><span class="bb-pc"><span class="ps-bar"><i class="${cls}" style="width:${Math.max(2, pc)}%"></i></span><span class="num ${cls}">${pc}</span></span></div>` }).join('')}
    <div class="sub-h"><h5>${esc(bbName(key))} season totals</h5></div><div class="bb-tstats">${[['PTS', 'Points'], ['REB', 'Rebounds'], ['AST', 'Assists'], ['ST', 'Steals'], ['BS', 'Blocks'], ['TO', 'Turnovers'], ['3PM', '3-pointers'], ['MIN', 'Minutes']].map(([k, l]) => `<div><span>${l}</span><b class="num">${esc(me.tot[k] ?? 0)}</b></div>`).join('')}
      <div><span>Field goals</span><b class="num">${me.tot.FGM}/${me.tot.FGA}</b></div><div><span>3-pointers</span><b class="num">${me.tot['3PM']}/${me.tot['3PA']}</b></div><div><span>Free throws</span><b class="num">${me.tot.FTM}/${me.tot.FTA}</b></div></div>
    <p class="srcnote">Built from the box scores of ${d.games} ${esc(bbName(key))} game${d.games === 1 ? '' : 's'} this season. Ranked among players who played at least 40% of the games the busiest player played; shooting percentages also need enough attempts. Efficiency = points + rebounds + assists + steals + blocks − missed shots − turnovers, per game.</p>`;
}
function bbLeadersHTML(key){
  if (BBL[key].src === 'espn') {
    const pool = (S.bb.poolVals ||= {})[key]; if (!pool) { bbPool(BBL[key].path).then(p => { S.bb.poolVals[key] = p; renderSheet() }); return bbLoading() }
    if (!pool.length) return `<div class="note">No player stats yet this season.</div>`;
    const cats = [['offensive.avgPoints', 'Points'], ['general.avgRebounds', 'Rebounds'], ['offensive.avgAssists', 'Assists'], ['defensive.avgSteals', 'Steals'], ['defensive.avgBlocks', 'Blocks'], ['offensive.avgThreePointFieldGoalsMade', '3-pointers made'], ['offensive.fieldGoalPct', 'Field goal %'], ['offensive.threePointFieldGoalPct', '3-point %'], ['offensive.freeThrowPct', 'Free throw %']];
    const maxGp = Math.max(...pool.map(p => p.gp)), min = Math.max(1, Math.round(maxGp * .4));
    return `<div class="bb-lead">${cats.map(([k, label]) => { const top = pool.filter(p => p.gp >= min && p.vals[k] != null).sort((a, b) => b.vals[k] - a.vals[k]).slice(0, 10);
      return `<div><h5>${esc(label)}</h5><ol>${top.map(p => `<li><button class="linkbtn" data-bbplayer="${esc(p.id)}" data-bbl="${esc(key)}"><img class="bb-face" src="${esc(bbShot(p.id, BBL[key].path))}" alt="" onerror="this.onerror=null;this.src=SIL">${esc(p.name)}</button><b class="num">${bbFix(p.vals[k])}</b></li>`).join('')}</ol></div>` }).join('')}</div>
      <p class="srcnote">Per game, from ESPN. Players need at least 40% of the games the busiest player has played.</p>`;
  }
  const d = S.bb.leaders?.[key]; if (!d) { bbLeaders(key).then(() => renderSheet()).catch(() => { (S.bb.leaders ||= {})[key] = { players: [], games: 0, at: Date.now() }; renderSheet() }); return bbLoading() }
  if (!d.players.length) return `<div class="note">${key === 'vtb' || key === 'pba' ? `Flashscore doesn't publish player box scores for ${esc(BBL[key].name)}, so there are no league leaders.` : 'No player stats yet this season.'}</div>`;
  return `<div class="bb-lead">${BB_FS_STATS.filter(x => !x[2] && !['MIN', 'FGA', 'FTA', 'OREB', 'DREB'].includes(x[0])).map(([k, label]) => { const top = bbFsPool(d, k).sort((a, b) => b.avg[k] - a.avg[k]).slice(0, 10);
    return `<div><h5>${esc(label)}</h5><ol>${top.map(p => `<li><button class="linkbtn" data-bbfsplayer="${esc(p.id)}" data-bbslug="${esc(p.slug)}" data-bbl="${esc(key)}">${p.teamLogo ? `<img class="bb-tl" src="${esc(p.teamLogo)}" alt="">` : ''}${esc(p.name)}</button><b class="num">${bbFix(p.avg[k])}</b></li>`).join('')}</ol></div>` }).join('')}</div>
    <p class="srcnote">Per game, built from the box scores of ${d.games} ${esc(BBL[key].name)} game${d.games === 1 ? '' : 's'} this season. Players need at least 40% of the games the busiest player has played.</p>`;
}

/* ---------- league sheet (standings, results, fixtures) ---------- */
function openBbLeague(key){
  S.sel = null; S.stack = [{ type: 'bbleague', id: key, tab: 'stand' }];
  renderSheet(); $('sheet').classList.add('open');
  const v = S.stack[0], re = () => S.stack.includes(v) && renderSheet();
  bbStandings(key).then(re);
  if (BBL[key].src === 'fs') bbLeague(key).then(d => { v.L = d; re() }).catch(() => { v.err = true; re() });
  else { // ESPN: the last and next two weeks from the scoreboard
    const days = []; for (let i = -7; i <= 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(isoDay(d).replace(/-/g, '')) }
    Promise.allSettled(days.map(d => cj(`${BBE}/${BBL[key].path}/scoreboard?dates=${d}`))).then(rs => { const evs = rs.flatMap(r => val(r)?.events || []).map(ev => bbNormEspn(ev, BBL[key])).filter(Boolean);
      for (const e of evs) S.bb.games.set(e.id, e); v.L = { results: evs.filter(e => e.state === 'post').sort((a, b) => b.date - a.date), fixtures: evs.filter(e => e.state !== 'post').sort((a, b) => a.date - b.date) }; re() });
  }
}
function bbLeagueSheet(v){
  const key = v.id, l = BBL[key], sheet = $('sheet');
  const back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  const tabs = [['stand', 'Standings'], ['lead', 'Leaders'], ['res', 'Results'], ['fix', 'Fixtures']];
  let body;
  if (v.tab === 'stand') body = bbStandingsHTML(key);
  else if (v.tab === 'lead') body = bbLeadersHTML(key);
  else { const list = v.L?.[v.tab === 'res' ? 'results' : 'fixtures']; body = v.err ? `<div class="note">Couldn't load this league.</div>` : !list ? bbLoading() : !list.length ? `<div class="note">${v.tab === 'res' ? 'No results yet this season.' : 'No fixtures published.'}</div>`
    : `<div class="cards">${list.slice(0, 80).map(bbCard).join('')}</div>` }
  S.curTabs = tabs;
  sheet.innerHTML = `<div class="sheet-body"><div class="hero solo" style="--tc:var(--accent)">${topBar(back)}<div class="thead">${bbLogo(key) ? `<img class="crest" src="${esc(bbLogo(key))}" alt="">` : ''}<div><h3>${esc(l.name)}</h3><p><span>${esc(l.area)}</span>${v.L?.season ? `<span>${esc(v.L.season)}</span>` : ''}</p></div></div></div>${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel">${body}</div></div>`;
}

/* ---------- sheet routing ---------- */
function bbRenderSheet(v){
  if (v.type === 'bbleague') return bbLeagueSheet(v);
  const sheet = $('sheet');
  const back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  let hero, tabs, body;
  if (v.type === 'bbgame') { hero = bbHero(v.e, back); tabs = bbGameTabs(v); if (!tabs.some(t => t[0] === v.tab)) v.tab = tabs[0][0]; body = bbPane(v) }
  else if (v.type === 'bbteam') { hero = bbTeamHero(v, back); tabs = [['roster', 'Roster'], ['sched', 'Schedule'], ['stats', 'Team stats'], ['stand', 'Standings']]; body = bbTeamPane(v) }
  else if (v.type === 'bbplayer') { hero = bbPlayerHero(v, back); tabs = [['stats', 'Stats & ranks'], ['log', 'Game log'], ['splits', 'Splits']]; body = bbPlayerPane(v) }
  else { hero = bbFsPlayerHero(v, back); tabs = [['stats', 'Stats & ranks'], ['log', 'Recent games']]; body = bbFsPlayerPane(v) }
  S.curTabs = tabs;
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  sheet.innerHTML = `<div class="sheet-body">${hero}${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel" style="--tc:${esc(v.color || 'var(--accent)')}">${body}</div></div>`;
  sheet.querySelector('.sheet-body').scrollTop = scroll;
  if (v.type === 'bbteam' && v.tab === 'roster') bbLoadFaces();
}
// roster photos for Flashscore teams come from each player's page: fetch a few at a time
let bbFaceBusy = false;
async function bbLoadFaces(){
  if (bbFaceBusy) return; bbFaceBusy = true;
  try {
    const imgs = [...document.querySelectorAll('img[data-bbface]')].filter(i => !(S.bb.faces ||= {})[i.dataset.bbface] && !i.dataset.tried);
    for (let i = 0; i < imgs.length; i += 4) {
      await Promise.allSettled(imgs.slice(i, i + 4).map(async im => { im.dataset.tried = 1;
        const d = await getJSON(`/api/bb/player?id=${im.dataset.bbface}&slug=${encodeURIComponent(im.dataset.bbslug)}`);
        if (d.photo) { S.bb.faces[im.dataset.bbface] = d.photo; document.querySelectorAll(`img[data-bbface="${im.dataset.bbface}"]`).forEach(x => x.src = d.photo) }
        const row = im.closest('.prow'), age = row?.querySelector('.nm small'); if (age && d.position && !age.textContent.includes(d.position)) age.textContent = [d.position, d.height, age.textContent].filter(Boolean).join(' · ') }));
    }
  } finally { bbFaceBusy = false }
}

/* ---------- search ---------- */
let bbSearchSeq = 0;
async function bbSearch(q){
  const box = $('sres'); if (q.trim().length < 2) { hideResults(); return }
  const seq = ++bbSearchSeq;
  const [t, p, f] = await Promise.allSettled([...['team', 'player'].map(ty => cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&type=${ty}&sport=basketball&limit=8`)), getJSON(`/api/bb/search?q=${encodeURIComponent(q)}`)]);
  if (seq !== bbSearchSeq) return;
  const lgOf = x => { const s = x.league || x.defaultLeagueSlug || ''; return s === 'mens-college-basketball' ? 'cbb' : s === 'womens-college-basketball' ? 'wcbb' : BBL[s]?.src === 'espn' ? s : s.includes('wnba') ? 'wnba' : s === 'nbl' ? 'nbl' : 'nba' };
  const ok = x => /^(nba|wnba|nbl|mens-college-basketball|womens-college-basketball)$/.test(x.league || x.defaultLeagueSlug || '');
  const T = (val(t)?.items || []).filter(ok), P = (val(p)?.items || []).filter(ok), F = val(f) || { teams: [], players: [] };
  let h = '';
  if (T.length || F.teams.length) h += `<div class="sr-h">Teams</div>` + T.map(x => `<button class="sr" data-bbteam="${esc(x.id)}" data-bbl="${lgOf(x)}"><img src="${esc(x.logos?.[0]?.href || '')}" alt=""><div><strong>${esc(x.displayName)}</strong><small>${esc(bbName(lgOf(x)))}</small></div></button>`).join('')
    + F.teams.map(x => `<button class="sr" data-bbteam="${esc(x.id)}" data-bbslug="${esc(x.slug)}" data-bbl="fsany"><img src="${esc(x.img)}" alt=""><div><strong>${esc(x.name)}</strong><small>${esc(x.country)}</small></div></button>`).join('');
  if (P.length || F.players.length) h += `<div class="sr-h">Players</div>` + P.map(x => `<button class="sr" data-bbplayer="${esc(x.id)}" data-bbl="${lgOf(x)}"><img class="face espn-shot" src="${esc(x.headshot?.href || bbShot(x.id, lgOf(x)))}" alt="" onerror="this.onerror=null;this.src=SIL"><div><strong>${esc(x.displayName)}</strong><small>${esc(x.teamRelationships?.[0]?.displayName || (x.league || '').toUpperCase())}</small></div></button>`).join('')
    + F.players.filter(x => !P.some(y => normName(y.displayName) === normName(x.name.split(' ').reverse().join(' ')) || normName(y.displayName) === normName(x.name))).map(x => `<button class="sr" data-bbfsplayer="${esc(x.id)}" data-bbslug="${esc(x.slug)}" data-bbl="fsany"><img class="face espn-shot" src="${esc(x.img || SIL)}" alt="" onerror="this.onerror=null;this.src=SIL"><div><strong>${esc(x.name)}</strong><small>${esc(x.team || x.country)}</small></div></button>`).join('');
  box.innerHTML = h || `<div class="sr-none">No basketball teams or players match “${esc(q)}”.</div>`; box.hidden = false;
}
// a Flashscore team opened from search: find which covered league it plays in
async function openBbFsTeamAny(id, slug){
  openBbTeam(id, 'euroleague', slug);
  const v = S.stack[S.stack.length - 1];
  const t = setInterval(() => { if (!S.stack.includes(v)) return clearInterval(t); if (v.fs) { clearInterval(t); const lg = v.fs.leagues?.find(k => BBL[k]?.src === 'fs'); if (lg && lg !== v.lg) { v.lg = lg; bbStandings(lg).then(() => S.stack.includes(v) && renderSheet()) } } }, 300);
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-bblg],[data-bbview],[data-bbgame],[data-bbteam],[data-bbplayer],[data-bbfsplayer],[data-bbact],[data-bbfilter]'); if (!t) return;
  ev.stopPropagation(); hideResults();
  if (t.dataset.bblg) { S.bb.lg = t.dataset.bblg; S.bb.view = 'games'; store.set('fl.bbLg', S.bb.lg); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.bbview) { S.bb.view = t.dataset.bbview; window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.bbfilter) { S.bb.filter = t.dataset.bbfilter; return render() }
  if (t.dataset.bbgame) { const id = t.dataset.bbgame; if (S.bb.games.has(id)) { openBbGame(id); if (t.dataset.bbtab && S.stack[0]) { S.stack[0].tab = t.dataset.bbtab; renderSheet() } return }
    // a game we haven't listed (from a player's log): load it as a Flashscore game
    S.bb.games.set(id, bbNormFs({ id, src: 'fs', lg: S.stack[S.stack.length - 1]?.lg || 'euroleague', ts: Date.now() / 1000, state: 'post', detail: 'Final', home: { id: '', name: 'Home', full: 'Home', abbr: '', pid: '', slug: '', logo: '', score: '', lines: [] }, away: { id: '', name: 'Away', full: 'Away', abbr: '', pid: '', slug: '', logo: '', score: '', lines: [] } }));
    return openBbGame(id) }
  if (t.dataset.bbteam) { if (t.dataset.bbl === 'fsany') return openBbFsTeamAny(t.dataset.bbteam, t.dataset.bbslug); return openBbTeam(t.dataset.bbteam, t.dataset.bbl, t.dataset.bbslug) }
  if (t.dataset.bbplayer) return openBbPlayer(t.dataset.bbplayer, t.dataset.bbl);
  if (t.dataset.bbfsplayer) return openBbFsPlayer(t.dataset.bbfsplayer, t.dataset.bbslug, t.dataset.bbl === 'fsany' ? 'euroleague' : t.dataset.bbl);
  const a = t.dataset.bbact, v = S.stack[S.stack.length - 1];
  if (a === 'day') { const n = +t.dataset.to; S.bb.off = n ? Math.max(-7, Math.min(7, S.bb.off + n)) : 0; return render() }
  if (a === 'league') return openBbLeague(S.bb.lg);
  if (a === 'period' && v) { v.period = +t.dataset.to; return renderSheet() }
  if (a === 'rk' && v) { v.rk = t.dataset.to; return renderSheet() }
  if (a === 'fav' && v) { const id = `bb-${v.lg}-${v.id}`, espn = BBL[v.lg].src === 'espn';
    const name = espn ? v.team?.displayName : v.fs?.name, logo = espn ? v.team?.logos?.[0]?.href : v.fs?.logo;
    S.fav = S.fav.some(f => f.id === id) ? S.fav.filter(f => f.id !== id) : [...S.fav, { id, tid: v.id, sport: 'basketball', lg: v.lg, slug: v.slug || '', name: name || '', logo: logo || '' }];
    savePrefs(); renderSheet(); bbRail() }
}, true);
setInterval(() => { if (!document.hidden && S.sport === 'basketball') {
  const d = S.bb.days[S.bb.off]; if (d?.events.some(e => e.state === 'in')) { d.at = 0; renderBasketball() }
  const v = S.stack[0]; if (v?.type === 'bbgame' && v.e.state === 'in') bbLoadGame(v) } }, 30000);

document.head.insertAdjacentHTML('beforeend', `<style>
#bb{min-width:0}
.bb-more{margin-left:auto;font-size:12px;color:var(--muted)}
.oddrow .bb-ml{font-weight:600}
.bb-lead{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}
.bb-lead h5{margin:0 0 6px;font:600 11px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.bb-lead ol{margin:0;padding:0 0 0 20px;font-size:13px}.bb-lead li{padding:4px 0;border-top:1px solid var(--line)}
.bb-lead li{display:list-item}.bb-lead li .linkbtn{display:inline-flex;align-items:center;gap:6px;max-width:calc(100% - 50px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
.bb-lead li b{float:right}.bb-tl{width:16px;height:16px;object-fit:contain}
.bb-face{width:22px;height:22px;border-radius:50%;object-fit:cover;object-position:50% 20%;background:var(--surface-2);vertical-align:-6px;margin-right:6px}
.bb-box td.t small,.bb-car td.t small,.bb-log td.t small{color:var(--muted);font-size:10.5px;margin-left:6px}
.bb-box tr.tot td{font-weight:700;border-top:2px solid var(--line)}
.bb-box tr.bench-start td{border-top:2px solid var(--line)}
.bb-box tr.dnp td{color:var(--muted)}.dnp-r{text-align:left!important;color:var(--muted);font-size:12px}
.bb-st td.pos{color:var(--win)}.bb-st td.neg{color:var(--loss)}
.bb-st td.r i{display:inline-block;width:3px;height:14px;border-radius:2px;margin-right:6px;vertical-align:-2px}
.bb-form{display:inline-flex;gap:2px}.bb-form i{font:700 9.5px/16px var(--f-mono);font-style:normal;width:16px;text-align:center;border-radius:3px;color:#fff}.bb-form i.w{background:var(--win)}.bb-form i.l{background:var(--loss)}
.bb-cmp{display:grid;gap:0}.bb-cmp div{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:13px}
.bb-cmp div span{color:var(--muted);text-align:center;padding:0 10px}.bb-cmp div b:last-child{text-align:right}
.bb-books{display:grid;font-size:13px}
.bb-bh,.bb-br{display:grid;grid-template-columns:minmax(80px,1.1fr) 70px 70px minmax(90px,1.2fr) minmax(90px,1.2fr);gap:8px;align-items:center;padding:8px 4px;border-top:1px solid var(--line)}
.bb-bh{font:600 10.5px/1 var(--f-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-top:0}
.bb-br .best{color:var(--win);font-weight:700}.bb-br small{color:var(--muted);font-size:10.5px}.bb-br small.up{color:var(--win)}.bb-br small.dn{color:var(--loss)}
.bb-alt{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.bb-alt h6{margin:0 0 6px;font:600 11px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.bb-alt div div{display:grid;grid-template-columns:1fr 1fr 1fr;padding:5px 0;border-top:1px solid var(--line);font-size:12.5px}
.bb-tstats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.bb-tstats div{border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:4px}
.bb-tstats span{font-size:11.5px;color:var(--muted)}.bb-tstats b{font-size:18px}.bb-tstats small{font:600 10.5px/1 var(--f-mono);color:var(--muted)}
.bb-rk{display:block;margin-top:5px;font:600 10.5px/1.2 var(--f-mono);color:var(--fg);opacity:.75;font-style:normal}
.bb-bio{flex-wrap:wrap}.bb-bio span{font-size:12px}
.bb-viz{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start;margin-bottom:6px}
.bb-viz .radar h5,.bb-sw h5{margin:0 0 6px;font:600 11px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.bb-viz .radar small{font-size:11px;color:var(--muted)}
.bb-chips{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}.bb-chips li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:7px 10px;border-radius:9px;font-size:12.5px}
.bb-chips.hi li{background:color-mix(in oklab,var(--win) 12%,transparent)}.bb-chips.lo li{background:color-mix(in oklab,var(--loss) 12%,transparent)}.bb-chips small{color:var(--muted);font:600 10.5px/1 var(--f-mono)}
.bb-q{font-size:11.5px;color:var(--muted)}
.bb-rh,.bb-rr{display:grid;grid-template-columns:minmax(0,1.4fr) 60px 70px minmax(90px,1.2fr);gap:10px;align-items:center}
.bb-rh{font:600 10.5px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:6px 0}
.bb-rr{padding:8px 0;border-top:1px solid var(--line);font-size:13.5px}.bb-rr small{color:var(--muted)}
.bb-pc{display:grid;grid-template-columns:minmax(0,1fr) 28px;gap:8px;align-items:center}.bb-pc .hi{color:var(--win)}.bb-pc .lo{color:var(--loss)}
button.fx.bb-fx{width:100%;text-align:left}button.fx.bb-fx:hover{background:var(--surface-2)}
@media (max-width:620px){ .bb-viz{grid-template-columns:1fr} .bb-bh,.bb-br{grid-template-columns:minmax(64px,1fr) 52px 52px minmax(70px,1fr) minmax(70px,1fr);gap:5px;font-size:12px} }
</style>`);
if (S.sport === 'basketball') setTimeout(render, 0);
