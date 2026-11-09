/* Floodlight · hockey
   NHL and NCAA men's and women's hockey from ESPN (read directly): scores, period by period, box scores with every skater
   and goalie stat, scoring and penalty summaries, rosters, player stats, game logs and splits. The NHL's own stats API
   (through the local server, /api/hk/nhl) adds the league-wide skater, goalie and team tables and official player pages.
   AHL, ECHL, PWHL, the CHL junior leagues, the European leagues (KHL, SHL, Liiga, DEL, National League, Extraliga and more)
   and IIHF events come from Flashscore through the local server (/api/hk/…, see hockey.py).
   Odds: Kalshi for the NHL, ESPN's line, and the bookmakers in Flashscore's odds comparison.
   Loaded after basketball.js and baseball.js, and reuses their helpers (bbNum, bbFix, bbOrd, decAm, bbStatBars, bbMainTotal). */
const HKE = 'https://site.api.espn.com/apis/site/v2/sports/hockey';
const HKE2 = 'https://site.api.espn.com/apis/v2/sports/hockey';
const HKW = 'https://site.web.api.espn.com/apis/common/v3/sports/hockey';
const hkNhl = (u, q) => `/api/hk/nhl?u=${encodeURIComponent(u)}${q ? '&q=' + encodeURIComponent(q) : ''}`;
// mu: goals per team per game; hia: home-ice multiplier on expected goals
const HK_LEAGUES = [
  { key: 'nhl', src: 'espn', path: 'nhl', name: 'NHL', area: 'USA & Canada', region: 'NHL & pro North America', kx: 'NHL', mu: 3.05, hia: 1.045, logo: `${ESPN_LG}/nhl.png` },
  { key: 'ahl', src: 'fs', name: 'AHL', area: 'NHL development league', region: 'NHL & pro North America', mu: 3.1, hia: 1.05 },
  { key: 'echl', src: 'fs', name: 'ECHL', area: 'USA & Canada', region: 'NHL & pro North America', mu: 3.2, hia: 1.05 },
  { key: 'pwhl', src: 'fs', name: 'PWHL', area: "Professional Women's Hockey League", region: 'NHL & pro North America', mu: 2.6, hia: 1.04 },
  { key: 'ncaam', src: 'espn', path: 'mens-college-hockey', college: true, name: "NCAA men's hockey", short: 'NCAA men', area: 'Division I', region: 'College & juniors', mu: 3.0, hia: 1.08, logo: `${ESPN_LG}/ncaa.png` },
  { key: 'ncaaw', src: 'espn', path: 'womens-college-hockey', college: true, name: "NCAA women's hockey", short: 'NCAA women', area: 'Division I', region: 'College & juniors', mu: 2.9, hia: 1.08, logo: `${ESPN_LG}/ncaa.png` },
  { key: 'ohl', src: 'fs', name: 'OHL', area: 'CHL juniors · Ontario', region: 'College & juniors', mu: 3.5, hia: 1.06 },
  { key: 'whl', src: 'fs', name: 'WHL', area: 'CHL juniors · Western Canada & USA', region: 'College & juniors', mu: 3.5, hia: 1.06 },
  { key: 'qmjhl', src: 'fs', name: 'QMJHL', area: 'CHL juniors · Quebec & Maritimes', region: 'College & juniors', mu: 3.5, hia: 1.06 },
  { key: 'khl', src: 'fs', name: 'KHL', area: 'Russia & neighbours', region: 'Europe', mu: 2.6, hia: 1.06 },
  { key: 'shl', src: 'fs', name: 'SHL', area: 'Sweden', region: 'Europe', mu: 2.8, hia: 1.06 },
  { key: 'liiga', src: 'fs', name: 'Liiga', area: 'Finland', region: 'Europe', mu: 2.8, hia: 1.06 },
  { key: 'del', src: 'fs', name: 'DEL', area: 'Germany', region: 'Europe', mu: 3.1, hia: 1.06 },
  { key: 'nla', src: 'fs', name: 'National League', area: 'Switzerland', region: 'Europe', mu: 3.0, hia: 1.06 },
  { key: 'czech', src: 'fs', name: 'Extraliga', area: 'Czech Republic', region: 'Europe', mu: 2.8, hia: 1.06 },
  { key: 'slovak', src: 'fs', name: 'Slovak Extraliga', area: 'Slovakia', region: 'Europe', mu: 3.0, hia: 1.06 },
  { key: 'icehl', src: 'fs', name: 'ICE Hockey League', short: 'ICEHL', area: 'Austria & neighbours', region: 'Europe', mu: 3.1, hia: 1.06 },
  { key: 'allsv', src: 'fs', name: 'HockeyAllsvenskan', area: 'Sweden · second tier', region: 'Europe', mu: 2.9, hia: 1.06 },
  { key: 'norway', src: 'fs', name: 'EliteHockey Ligaen', area: 'Norway', region: 'Europe', mu: 3.0, hia: 1.06 },
  { key: 'denmark', src: 'fs', name: 'Metal Ligaen', area: 'Denmark', region: 'Europe', mu: 3.0, hia: 1.06 },
  { key: 'magnus', src: 'fs', name: 'Ligue Magnus', area: 'France', region: 'Europe', mu: 3.0, hia: 1.06 },
  { key: 'eihl', src: 'fs', name: 'Elite League', short: 'EIHL', area: 'United Kingdom', region: 'Europe', mu: 3.2, hia: 1.06 },
  { key: 'poland', src: 'fs', name: 'Polska Hokej Liga', area: 'Poland', region: 'Europe', mu: 3.0, hia: 1.06 },
  { key: 'chl', src: 'fs', name: 'Champions Hockey League', short: 'CHL', area: 'Europe · top clubs', region: 'Europe', mu: 2.9, hia: 1.05 },
  { key: 'spengler', src: 'fs', name: 'Spengler Cup', area: 'Davos · December', region: 'International', mu: 3.0, hia: 1 },
  { key: 'wjc', src: 'fs', name: 'World Juniors (U20)', area: 'IIHF · late December', region: 'International', mu: 3.2, hia: 1 },
  { key: 'wch', src: 'fs', name: 'World Championship', area: 'IIHF · May', region: 'International', mu: 2.9, hia: 1 },
  { key: 'olympics', src: 'fs', name: 'Olympic Games', area: 'IIHF · Winter Olympics', region: 'International', mu: 2.9, hia: 1 },
];
const HKL = Object.fromEntries(HK_LEAGUES.map(l => [l.key, l]));
const HK_REGIONS = [...new Set(HK_LEAGUES.map(l => l.region))];
S.hk = { lg: store.get('fl.hkLg', 'all'), view: store.get('fl.hkView', 'games'), off: 0, filter: 'all', days: {}, stand: {}, league: {}, games: new Map(), meta: store.get('fl.hkMeta', {}),
  odds: new Map(), pred: new Map(), espnLine: new Map(), stats: {}, statTab: 'skaters', statSort: {} };
if (S.hk.lg !== 'all' && !HKL[S.hk.lg]) S.hk.lg = 'all';
if (!['games', 'picks', 'stats'].includes(S.hk.view)) S.hk.view = 'games';
const hkTz = () => Math.round(-new Date().getTimezoneOffset() / 60);
const hkShot = (id, path) => id ? `https://a.espncdn.com/i/headshots/${path && path !== 'nhl' ? path : 'nhl'}/players/full/${id}.png` : SIL;
const hkLogo = key => HKL[key]?.logo || S.hk.meta[key]?.logo || '';
const hkName = key => HKL[key]?.short || HKL[key]?.name || key;
const hkSeason = () => { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 8 ? `${y}${y + 1}` : `${y - 1}${y}` };   // NHL season id, e.g. 20262027
const hkLoading = h => `<div class="skel" style="height:${h || 260}px"></div>`;
const hkErr = `onerror="this.onerror=null;this.style.visibility='hidden'"`;
const hkFaceErr = `onerror="this.onerror=null;this.src=SIL"`;
const hkUS = e => e.src === 'espn';   // ESPN leagues list the away team first
const hkToi = s => { const n = +s; if (!isFinite(n) || !n) return '–'; const m = Math.floor(n / 60), x = Math.round(n % 60); return `${m}:${String(x).padStart(2, '0')}` };
const hkP = x => x == null || x === '' || isNaN(+x) ? '–' : (+x * (Math.abs(+x) <= 1 ? 100 : 1)).toFixed(1) + '%';
// the NHL stats API uses its own abbreviations; ESPN's team pages take ESPN's
const HK_ESPN_ABBR = { LAK: 'LA', NJD: 'NJ', SJS: 'SJ', TBL: 'TB', UTA: 'UTAH' };

/* ---------- loading games ---------- */
function hkNormEspn(ev, l){
  const c = ev.competitions?.[0]; if (!c) return null;
  const st = c.status?.type || ev.status?.type || {};
  const side = ha => { const x = c.competitors.find(t => t.homeAway === ha) || {}, t = x.team || {};
    return { id: String(t.id || ''), name: t.shortDisplayName || t.name || t.displayName, full: t.displayName || t.name, abbr: t.abbreviation || '', logo: t.logo || t.logos?.[0]?.href || '',
      color: t.color, alt: t.alternateColor, score: (typeof x.score === 'object' ? x.score?.displayValue : x.score) ?? '', winner: x.winner,
      record: x.records?.[0]?.summary || '', lines: (x.linescores || []).map(q => q.displayValue ?? q.value), rank: x.curatedRank?.current > 0 && x.curatedRank.current <= 20 ? x.curatedRank.current : null,
      sog: (x.statistics || []).find(s => /shots/i.test(s.name || ''))?.displayValue || '' } };
  const home = side('home'), away = side('away'); const [hc, ac] = teamColors(home, away); const o = c.odds?.[0];
  return { id: String(ev.id), src: 'espn', lg: l.key, path: l.path, date: new Date(ev.date), state: st.state, detail: st.shortDetail || st.detail || '', ot: /OT|SO/.test(st.shortDetail || ''),
    home, away, hc, ac, venue: c.venue?.fullName || '', city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(', '), neutral: !!c.neutralSite,
    tv: (c.broadcasts || []).flatMap(b => b.names || []).join(', '), line: o ? { details: o.details, ou: o.overUnder, home: o.homeTeamOdds?.moneyLine, away: o.awayTeamOdds?.moneyLine } : null,
    note: c.notes?.[0]?.headline || c.series?.summary || '' };
}
function hkNormFs(x){
  const side = t => ({ ...t, color: fmColor(t.full), alt: null });
  const home = side(x.home), away = side(x.away); const [hc, ac] = teamColors(home, away);
  return { ...x, date: new Date(x.ts * 1000), home, away, hc, ac, path: null, venue: '', tv: '', line: null, note: x.round || '' };
}
async function hkLoadDay(off){
  const cur = S.hk.days[off]; if (cur && Date.now() - cur.at < (off === 0 ? 20000 : 120000)) return cur;
  const d = new Date(); d.setDate(d.getDate() + off); const ymd = isoDay(d).replace(/-/g, '');
  const espn = HK_LEAGUES.filter(l => l.src === 'espn');
  const [fs, ...es] = await Promise.allSettled([getJSON(`/api/hk/day?off=${off}&tz=${hkTz()}`), ...espn.map(l => getJSON(`${HKE}/${l.path}/scoreboard?dates=${ymd}&limit=300${l.college ? '&groups=50' : ''}`))]);
  const evs = [], twins = [];
  es.forEach((r, i) => { const l = espn[i]; for (const ev of val(r)?.events || []) { const e = hkNormEspn(ev, l); if (e && sameDay(e.date, d)) evs.push(e) } });
  const F = val(fs);
  if (F) { for (const [k, list] of Object.entries(F.games || {})) for (const x of list) { const e = hkNormFs(x); if (HKL[k]?.src === 'fs') { if (sameDay(e.date, d)) evs.push(e) } else twins.push(e) }
    let ch = false; for (const [k, m] of Object.entries(F.meta || {})) if (m.logo && S.hk.meta[k]?.logo !== m.logo) { S.hk.meta[k] = { ...(S.hk.meta[k] || {}), logo: m.logo, name: m.name }; ch = true }
    if (ch) store.set('fl.hkMeta', S.hk.meta) }
  for (const e of evs) { const old = S.hk.games.get(e.id); if (old) { Object.assign(old, { state: e.state, detail: e.detail, ot: e.ot, home: { ...old.home, ...e.home }, away: { ...old.away, ...e.away }, line: e.line || old.line }) } else S.hk.games.set(e.id, e);
    const g = S.hk.games.get(e.id);
    if (g.src === 'espn' && !g.twin) { const t = twins.find(x => x.lg === g.lg && bbSameTeam(x.home, g.home) && bbSameTeam(x.away, g.away) && Math.abs(x.date - g.date) < 6 * 36e5); if (t) g.twin = { id: t.id, ja: t.home.pid, jb: t.away.pid } } }
  const list = evs.map(e => S.hk.games.get(e.id));
  return S.hk.days[off] = { events: list.sort((a, b) => a.date - b.date), at: Date.now(), fsDown: !F, espnDown: es.every(r => r.status === 'rejected') };
}
// bookmaker odds for the list (Flashscore), plus Kalshi's NHL moneylines in one request
async function hkListOdds(off){
  const evs = (S.hk.days[off]?.events || []).filter(e => e.state !== 'post');
  const spec = evs.filter(e => !(Date.now() - (S.hk.odds.get(e.id)?.at || 0) < 120000)).map(e => e.src === 'fs' ? [e.id, e.home.pid, e.away.pid, e] : e.twin ? [e.twin.id, e.twin.ja, e.twin.jb, e] : null).filter(Boolean);
  const jobs = [];
  for (let i = 0; i < spec.length; i += 30) { const part = spec.slice(i, i + 30);
    jobs.push(getJSON(`/api/hk/odds?ids=${part.map(x => x.slice(0, 3).join(':')).join(',')}`).then(r => { for (const [id, , , e] of part) if (r[id]) S.hk.odds.set(e.id, { ...r[id], at: Date.now() }) }).catch(() => {})) }
  if (evs.some(e => e.lg === 'nhl')) jobs.push(kxSeries('NHL', 'GAME').then(kevs => { for (const e of evs.filter(x => x.lg === 'nhl')) { const k = kxFind(kevs, e); const ml = k && parseML(e, k); if (ml) { const o = S.odds.get('hk' + e.id) || {}; o.ml = ml; o.found = true; S.odds.set('hk' + e.id, o) } } }).catch(() => {}));
  await Promise.allSettled(jobs);
  return jobs.length > 0;
}
async function hkListPredictions(off){
  const evs = (S.hk.days[off]?.events || []).filter(e => e.state === 'pre'); if (!evs.length) return false;
  await Promise.allSettled([...new Set(evs.map(e => e.lg))].map(hkStandings));
  let ch = false;
  for (const e of evs) { const P = hkPredict(e); if (P && Math.abs((S.hk.pred.get(e.id)?.pH ?? -1) - P.pH) > .001) { S.hk.pred.set(e.id, P); ch = true } }
  return ch;
}

/* ---------- standings (normalized rows: gp, w, l, otl, pts, gf, ga) ---------- */
async function hkStandings(key){
  if (S.hk.stand[key] && Date.now() - S.hk.stand[key].at < 600000) return S.hk.stand[key];
  const l = HKL[key];
  try {
    if (l.src === 'espn') {
      const d = await getJSON(`${HKE2}/${l.path}/standings`);
      const flat = g => g.children?.length ? g.children.flatMap(flat) : [g];
      const groups = flat(d).map(g => ({ name: g.name || g.abbreviation || '', rows: (g.standings?.entries || []).map(x => {
        const s = (...ns) => x.stats?.find(y => ns.includes(y.name) || ns.includes(y.type) || ns.includes(y.abbreviation)); const v = (...ns) => +s(...ns)?.value || 0;
        const w = v('wins'), lo = v('losses'), otl = v('otLosses', 'overtimeLosses', 'OTL'), t = v('ties');
        const gp = v('gamesPlayed') || w + lo + otl + t, gf = v('pointsFor', 'goalsFor', 'GF'), ga = v('pointsAgainst', 'goalsAgainst', 'GA');
        const pts = v('points', 'PTS') || 2 * w + otl + t;
        return { id: String(x.team?.id), name: x.team?.shortDisplayName || x.team?.displayName, full: x.team?.displayName, abbr: x.team?.abbreviation || '', logo: x.team?.logos?.[0]?.href || '',
          gp, w, l: lo, otl, t, pts, gf, ga, ppct: gp ? pts / (2 * gp) : 0, streak: s('streak')?.displayValue || '', seed: v('playoffSeed') || null,
          home: s('Home', 'home')?.displayValue || '', away: s('Road', 'road', 'Away')?.displayValue || '', l10: s('Last Ten Games', 'lasttengames', 'L10')?.displayValue || '', rw: v('regulationWins', 'RW') || null } })
          .sort((a, b) => b.pts - a.pts || a.gp - b.gp || (b.gf - b.ga) - (a.gf - a.ga)) })).filter(g => g.rows.length);
      return S.hk.stand[key] = { groups, at: Date.now() };
    }
    const L = await hkLeague(key);
    const groups = (L.standings || []).map(g => ({ name: g.name, rows: g.rows.map(r => { const w = r.w + (r.otw || 0), otl = r.otl || 0;
      return { id: r.id, slug: r.slug, name: r.name, full: r.name, logo: S.hk.logos?.[r.id] || '', gp: r.gp, w, l: r.l, otl, t: r.d || 0, pts: r.pts || 2 * w + otl, gf: r.gf, ga: r.ga,
        ppct: r.gp ? (r.pts || 2 * w + otl) / (r.pts && r.pts > 2.2 * r.gp ? 3 * r.gp : 2 * r.gp) : 0, streak: '', form: r.form, rank: r.rank, zone: r.zone, zoneColor: r.zoneColor, rw: r.otw != null ? r.w : null } }) }));
    return S.hk.stand[key] = { groups, at: Date.now() };
  } catch { return S.hk.stand[key] = { groups: [], at: Date.now() - 540000 } }
}
async function hkLeague(key){
  const c = S.hk.league[key]; if (c && Date.now() - c.at < 300000) return c;
  const d = await getJSON(`/api/hk/league?key=${key}`);
  d.results = (d.results || []).map(hkNormFs); d.fixtures = (d.fixtures || []).map(hkNormFs); d.at = Date.now();
  for (const e of [...d.results, ...d.fixtures]) { if (!S.hk.games.has(e.id)) S.hk.games.set(e.id, e); if (e.home.logo) (S.hk.logos ||= {})[e.home.id] = e.home.logo; if (e.away.logo) S.hk.logos[e.away.id] = e.away.logo }
  return S.hk.league[key] = d;
}
function hkRow(key, id){ for (const g of S.hk.stand[key]?.groups || []) { const r = g.rows.find(x => x.id === String(id)); if (r) return { ...r, group: g.name } } return null }
function hkStandingsHTML(key, hl = []){
  const st = S.hk.stand[key]; if (!st) return hkLoading(300);
  if (!st.groups.length) return `<div class="note">No standings published for ${esc(HKL[key].name)} yet.</div>`;
  const espn = HKL[key].src === 'espn', showOtl = st.groups.some(g => g.rows.some(r => r.otl)), showT = st.groups.some(g => g.rows.some(r => r.t));
  const gs = hl.length && st.groups.length > 1 ? [...st.groups.filter(g => g.rows.some(r => hl.includes(r.id))), ...st.groups.filter(g => !g.rows.some(r => hl.includes(r.id)))] : st.groups;
  return gs.map(g => `${g.name ? `<div class="grp-name">${esc(g.name)}</div>` : ''}<div class="tbl-wrap"><table class="bb-st hk-st"><thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th>${showOtl ? '<th title="Overtime and shootout losses">OTL</th>' : ''}${showT ? '<th>T</th>' : ''}<th>PTS</th><th title="Points percentage">P%</th><th>GF</th><th>GA</th><th>DIFF</th><th>${espn ? 'STRK' : 'FORM'}</th>${espn && g.rows.some(r => r.l10) ? '<th>L10</th>' : ''}</tr></thead><tbody>
    ${g.rows.map((r, i) => { const diff = r.gf - r.ga;
      return `<tr class="${hl.includes(r.id) ? 'hl' : ''}"><td class="r num">${r.zoneColor ? `<i style="background:#${esc(r.zoneColor)}"></i>` : r.seed && r.seed <= 8 ? `<i style="background:var(--win)"></i>` : ''}${r.rank || i + 1}</td>
        <td class="t"><img src="${esc(r.logo || S.hk.logos?.[r.id] || '')}" alt="" loading="lazy" ${hkErr}><button class="linkbtn" data-hkteam="${esc(r.id)}" data-hkl="${esc(key)}" data-hkslug="${esc(r.slug || '')}">${esc(r.name)}</button></td>
        <td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td>${showOtl ? `<td>${r.otl}</td>` : ''}${showT ? `<td>${r.t}</td>` : ''}<td><b>${r.pts}</b></td><td>${r.ppct ? r.ppct.toFixed(3).replace(/^0/, '') : '–'}</td><td>${r.gf}</td><td>${r.ga}</td><td class="${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${diff > 0 ? '+' : ''}${diff}</td>
        <td>${espn ? esc(r.streak) : `<span class="bb-form">${(r.form || []).slice(0, 5).map(f => `<i class="${f === 'W' ? 'w' : 'l'}">${f}</i>`).join('')}</span>`}</td>${espn && g.rows.some(x => x.l10) ? `<td>${esc(r.l10)}</td>` : ''}</tr>` }).join('')}</tbody></table></div>`).join('')
    + `<p class="srcnote">${espn ? (key === 'nhl' ? 'Two points for a win, one for an overtime or shootout loss. Green: playoff position. ' : '') + 'Standings from ESPN.' : 'Coloured marks show the competition\'s playoff and relegation zones. Standings from Flashscore; leagues that award three points for a regulation win show those points.'}</p>`;
}

/* ---------- prediction model ----------
   Expected goals for each side = league average × its scoring rate × the opponent's conceding rate (both shrunk toward
   average early on), with home ice. A Poisson grid gives regulation results; ties go to overtime and the shootout,
   which the home side wins a little over half the time. Bookmakers (no vig), Kalshi and ESPN's line carry 65%. */
const hkPois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p };
function hkGrid(lh, la){
  let reg = { home: 0, draw: 0, away: 0 }, plH = 0, plA = 0; const scores = [], tot = {};
  for (let i = 0; i <= 11; i++) for (let j = 0; j <= 11; j++) { const p = hkPois(i, lh) * hkPois(j, la);
    if (i > j) reg.home += p; else if (i === j) reg.draw += p; else reg.away += p;
    if (i - j >= 2) plH += p; if (j - i >= 2) plA += p; tot[i + j] = (tot[i + j] || 0) + p; scores.push([i, j, p]) }
  scores.sort((a, b) => b[2] - a[2]);
  return { reg, pH: reg.home + reg.draw * .52, plH, plA, tot, scores };
}
const hkAm2p = a => a == null || isNaN(+a) || !+a ? null : +a < 0 ? -a / (-a + 100) : 100 / (+a + 100);
function hkMarket(e){
  const books = S.hk.odds.get(e.id)?.books || [];
  const ml = books.filter(b => b.ml?.home && b.ml?.away).map(b => { const h = 1 / b.ml.home, a = 1 / b.ml.away; return h / (h + a) });
  const to = books.map(b => bbMainTotal(b)?.line).filter(x => x != null);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  let pH = avg(ml), total = avg(to), src = ml.length ? 'books' : '';
  // ESPN's line: both moneylines when the scoreboard has them, else "BOS -165"
  const L = S.hk.espnLine.get(e.id) || e.line;
  if (L) { const h = hkAm2p(L.home), a = hkAm2p(L.away); let p = h && a ? h / (h + a) : null;
    if (p == null && L.details) { const m = /^(\S+)\s+([-+]\d+)$/.exec(String(L.details).trim()); if (m) { const q = hkAm2p(+m[2]); const fav = m[1].toUpperCase(); const isH = fav === (e.home.abbr || '').toUpperCase(); if (q) p = isH ? q - .02 : 1 - q + .02 } }
    if (p != null) { pH = pH == null ? p : pH * .6 + p * .4; src = src ? src + '+espn' : 'espn' }
    if (total == null && +L.ou) total = +L.ou }
  const kx = S.odds.get('hk' + e.id)?.ml; if (kx?.home && kx?.away) { const k = kx.home.p / (kx.home.p + kx.away.p); pH = pH == null ? k : pH * .7 + .3 * k; src = src ? src + '+kalshi' : 'kalshi' }
  return { pH, total, n: ml.length, src };
}
function hkPredict(e){
  const l = HKL[e.lg], H = hkRow(e.lg, e.home.id), A = hkRow(e.lg, e.away.id), M = hkMarket(e);
  if (!H && !A && M.pH == null) return null;
  const rows = (S.hk.stand[e.lg]?.groups || []).flatMap(g => g.rows).filter(r => r.gp);
  const gp = rows.reduce((s, r) => s + r.gp, 0), mu = gp > 20 ? rows.reduce((s, r) => s + r.gf, 0) / gp : l.mu, K = 10;
  const att = r => r?.gp ? ((r.gf || 0) + mu * K) / (r.gp + K) / mu : 1, def = r => r?.gp ? ((r.ga || 0) + mu * K) / (r.gp + K) / mu : 1;
  const hia = e.neutral ? 1 : l.hia;
  let lh = mu * att(H) * def(A) * hia, la = mu * att(A) * def(H) / hia;
  lh = Math.max(.8, Math.min(lh, 6)); la = Math.max(.8, Math.min(la, 6));
  const G0 = hkGrid(lh, la), pModel = G0.pH, tModel = lh + la;
  let pH = M.pH != null ? .65 * M.pH + .35 * pModel : pModel;
  const total = M.total != null ? .6 * M.total + .4 * tModel : tModel;
  // bend the goal expectations until the grid agrees with the blended chance and total
  let lo = .3, hi = 3; for (let i = 0; i < 30; i++) { const k = (lo + hi) / 2, s = total / (lh * k + la / k); if (hkGrid(lh * k * s, la / k * s).pH < pH) lo = k; else hi = k }
  const k = (lo + hi) / 2, s = total / (lh * k + la / k), fh = lh * k * s, fa = la / k * s, G = hkGrid(fh, fa);
  const pick = pH >= .5 ? 'home' : 'away', top = Math.max(pH, 1 - pH), conf = top >= .65 ? 'Strong' : top >= .565 ? 'Lean' : 'Toss-up';
  const win = G.scores.find(([i, j]) => pick === 'home' ? i > j : j > i) || G.scores[0];
  const line = Math.round(total * 2) / 2 % 1 ? Math.round(total * 2) / 2 : Math.floor(total) + .5;
  const over = Object.entries(G.tot).reduce((s, [g, p]) => s + (+g > line ? p : 0), 0);
  return { pH, pModel, market: M.pH, M, lh: fh, la: fa, total, tModel, reg: G.reg, ot: G.reg.draw, pl: { home: G.plH, away: G.plA }, ou: { line, over }, pick, top, conf,
    score: [win[0], win[1]], likely: G.scores.slice(0, 4), H, A, mu, hia };
}
function hkReasons(e, P){
  const out = [], hn = e.home.name, an = e.away.name, H = P.H, A = P.A, pg = (x, n) => x?.gp ? (x[n] / x.gp).toFixed(2) : '–';
  if (H?.gp && A?.gp) {
    out.push(`${hn} are ${H.w}-${H.l}${H.otl ? '-' + H.otl : ''} (${H.pts} points from ${H.gp} games); ${an} are ${A.w}-${A.l}${A.otl ? '-' + A.otl : ''} (${A.pts} from ${A.gp}).`);
    out.push(`${hn} score ${pg(H, 'gf')} and allow ${pg(H, 'ga')} goals a game; ${an} score ${pg(A, 'gf')} and allow ${pg(A, 'ga')}.`);
    if (Math.min(H.gp, A.gp) < 10) out.push(`Only ${Math.min(H.gp, A.gp)} games in, so those rates are pulled toward the league average.`);
    if (H.streak || A.streak || H.l10 || A.l10) out.push(`Form: ${hn} ${[H.streak, H.l10 && 'last 10 ' + H.l10].filter(Boolean).join(', ') || '–'}; ${an} ${[A.streak, A.l10 && 'last 10 ' + A.l10].filter(Boolean).join(', ') || '–'}.`);
    else if (H.form?.length || A.form?.length) out.push(`Recent form: ${hn} ${(H.form || []).slice(0, 5).join('') || '–'}, ${an} ${(A.form || []).slice(0, 5).join('') || '–'}.`);
  } else out.push('There isn\'t a standings table for these teams yet, so the betting market carries the forecast.');
  if (!e.neutral && P.hia > 1) out.push(`Home ice adds about ${Math.round((P.hia - 1) * 100)}% to ${hn}'s expected goals.`);
  out.push(`Expected goals: ${hn} ${P.lh.toFixed(2)}, ${an} ${P.la.toFixed(2)}. There's a ${pct(P.ot)}% chance it's level after 60 minutes and goes to overtime.`);
  if (P.market != null) out.push(`The market (${P.M.src.replace('books', 'bookmakers, no vig').replace('espn', "ESPN's line").replace('kalshi', 'Kalshi').split('+').join(', ')}) gives ${hn} ${pct(P.market)}%${P.M.total != null ? `, with a total of ${bbFix(P.M.total)} goals` : ''}.`);
  return out;
}

/* ---------- main column ---------- */
function hkRail(){
  const d = S.hk.days[S.hk.off], cnt = {}; for (const e of d?.events || []) { const c = cnt[e.lg] ||= { n: 0, live: 0 }; c.n++; if (e.state === 'in') c.live++ }
  const on = k => S.hk.view === 'games' && S.hk.lg === k ? ' on' : '';
  const favs = S.fav.filter(f => f.sport === 'hockey');
  let h = `<h4>Hockey</h4><button class="lg${on('all')}" data-hklg="all"><span class="dot">●</span><span>All leagues</span>${d ? `<b>${d.events.length}</b>` : ''}</button>
    <button class="lg${S.hk.view === 'picks' ? ' on' : ''}" data-hkview="picks"><span class="dot">%</span><span>Predictions</span></button>
    <button class="lg${S.hk.view === 'stats' ? ' on' : ''}" data-hkview="stats"><span class="dot">≡</span><span>NHL stats</span></button>`;
  if (favs.length) h += `<h4>My teams</h4>` + favs.map(f => `<button class="lg" data-hkteam="${esc(f.tid)}" data-hkl="${esc(f.lg)}" data-hkslug="${esc(f.slug || '')}"><img src="${esc(f.logo)}" alt=""><span>${esc(f.name)}</span></button>`).join('');
  for (const region of HK_REGIONS) h += `<h4>${esc(region)}</h4>` + HK_LEAGUES.filter(l => l.region === region).map(l => { const c = cnt[l.key], logo = hkLogo(l.key);
    return `<button class="lg${on(l.key)}" data-hklg="${l.key}">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'dot',textContent:'●'}))">` : '<span class="dot">●</span>'}<span>${esc(l.name)}</span>${c?.live ? `<b class="live">${c.live}</b>` : c?.n ? `<b>${c.n}</b>` : ''}</button>` }).join('');
  $('rail').innerHTML = h;
  $('chips').innerHTML = [['all', 'All leagues'], ['_picks', 'Predictions'], ['_stats', 'NHL stats']].map(([k, lab]) => `<button class="chip${(k === 'all' && S.hk.view === 'games' && S.hk.lg === 'all') || (k === '_' + S.hk.view) ? ' on' : ''}" ${k[0] === '_' ? `data-hkview="${k.slice(1)}"` : 'data-hklg="all"'}>${lab}</button>`).join('')
    + HK_LEAGUES.filter(l => cnt[l.key] || S.hk.lg === l.key || l.key === 'nhl').map(l => { const c = cnt[l.key], logo = hkLogo(l.key);
      return `<button class="chip${S.hk.view === 'games' && S.hk.lg === l.key ? ' on' : ''}" data-hklg="${l.key}">${logo ? `<img src="${esc(logo)}" alt="">` : ''}${esc(hkName(l.key))}${c?.live ? `<b>${c.live}</b>` : ''}</button>` }).join('');
  $('chips').classList.remove('mk-hide');
}
function hkCard(e){
  const post = e.state === 'post', hs = +e.home.score, as = +e.away.score, hl = post && hs < as, al = post && as < hs;
  const st = e.state === 'in' ? `<div class="st live"><span class="min">${esc(e.detail.replace(/ - /, ' '))}</span>LIVE</div>`
    : e.state === 'pre' ? (/postpon|cancel|delay/i.test(e.detail) ? `<div class="st">${esc(e.detail)}</div>` : `<div class="st"><span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>`) : `<div class="st">${esc(e.detail.replace('Final', 'FT'))}</div>`;
  const team = (t, lose) => `<div class="tm${lose ? ' lose' : ''}"><img src="${esc(t.logo)}" alt="" loading="lazy" ${hkErr}><span>${t.rank ? `<em class="rk">${t.rank}</em>` : ''}${esc(t.name)}</span>${t.record ? `<small class="rec">${esc(t.record)}</small>` : ''}</div>`;
  const P = S.hk.pred.get(e.id), ab = t => esc(t.abbr || t.name);
  const books = e.state !== 'post' ? S.hk.odds.get(e.id)?.books || [] : [], best = k => Math.max(0, ...books.map(b => b.ml?.[k] || 0)), to = books.map(bbMainTotal).find(Boolean);
  const odds = e.state !== 'post' && (P || books.length || e.line?.details) ? `<div class="oddrow" aria-hidden="true">${P && e.state === 'pre' ? `<span class="${P.pH >= .5 ? 'fav' : ''}">${ab(e.home)} ${pct(P.pH)}%</span><span class="${P.pH < .5 ? 'fav' : ''}">${ab(e.away)} ${pct(1 - P.pH)}%</span>` : ''}${best('home') && best('away') ? `<span class="bb-ml" title="Best moneyline">${ab(e.home)} ${decAm(best('home'))} · ${ab(e.away)} ${decAm(best('away'))}</span>` : e.line?.details ? `<span>${esc(e.line.details)}</span>` : ''}${to ? `<span>O/U ${esc(to.line)}</span>` : e.line?.ou ? `<span>O/U ${esc(e.line.ou)}</span>` : ''}</div>` : '';
  const us = hkUS(e), [A, B, la, lb] = us ? [e.away, e.home, al, hl] : [e.home, e.away, hl, al];
  return `<button class="m fb bb" data-hkgame="${esc(e.id)}" style="--hc:${us ? e.ac : e.hc};--ac:${us ? e.hc : e.ac}"
    aria-label="${esc(`${A.full} ${us ? 'at' : 'versus'} ${B.full}. ${e.state === 'pre' ? 'Puck drop ' + e.date.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : `${A.score} to ${B.score}, ${e.detail}`}`)}">
    ${st}<div class="tms">${team(A, la)}${team(B, lb)}${odds}</div>
    <div class="sc num">${e.state !== 'pre' ? `<span class="${la ? 'lose' : ''}">${esc(A.score)}</span><span class="${lb ? 'lose' : ''}">${esc(B.score)}</span>` : `<span class="tv">${esc((e.tv || '').split(',')[0])}</span><span>&nbsp;</span>`}</div></button>`;
}
function hkDateBar(off){
  const day = new Date(); day.setDate(day.getDate() + off);
  return `<div class="datebar"><button class="dnav" data-hkact="day" data-to="-1" aria-label="Previous day">‹</button>
    <button class="dtoggle" data-hkact="day" data-to="0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>${off === 0 ? 'Today' : off === -1 ? 'Yesterday' : off === 1 ? 'Tomorrow' : esc(day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</span></button>
    <button class="dnav" data-hkact="day" data-to="1" aria-label="Next day">›</button></div>`;
}
async function renderHockey(){
  const el = $('hk'); if (!el) return;
  hkRail();
  if (S.hk.view === 'picks') return renderHkPicks();
  if (S.hk.view === 'stats') return renderHkStats();
  const off = S.hk.off, key = S.hk.lg;
  const paint = () => {
    const d = S.hk.days[off]; if (!d || S.sport !== 'hockey' || S.hk.view !== 'games' || S.hk.off !== off) return;
    const q = S.q.trim().toLowerCase();
    const list = d.events.filter(e => (key === 'all' || e.lg === key) && (!q || `${e.home.full} ${e.away.full}`.toLowerCase().includes(q))
      && (S.hk.filter !== 'live' || e.state === 'in') && (S.hk.filter !== 'nhl' || e.lg === 'nhl') && (S.hk.filter !== 'fav' || S.fav.some(f => f.sport === 'hockey' && (f.tid === e.home.id || f.tid === e.away.id))));
    hkRail();
    const live = list.filter(e => e.state === 'in').length, day = new Date(); day.setDate(day.getDate() + off);
    const groups = new Map(); for (const e of list) { if (!groups.has(e.lg)) groups.set(e.lg, []); groups.get(e.lg).push(e) }
    const order = HK_LEAGUES.map(l => l.key);
    const chips = `<div class="quick">${[['all', 'All'], ['live', `Live${live ? ' · ' + live : ''}`], ...(key === 'all' ? [['nhl', 'NHL only']] : []), ['fav', '★ My teams']].map(([k, l]) => `<button class="qf" data-hkfilter="${k}" aria-pressed="${S.hk.filter === k}">${k === 'live' ? '<span class="dot"></span>' : ''}${l}</button>`).join('')}</div>`;
    const lgBtn = key !== 'all' ? `<button class="btn ghost lginfo" data-hkact="league">Standings, ${key === 'nhl' ? 'leaders, ' : ''}results & fixtures</button>` : '';
    el.innerHTML = hkDateBar(off) + chips + `<div class="livebar"><h2>${esc(key === 'all' ? (off === 0 ? 'Today' : day.toLocaleDateString([], { weekday: 'long' })) : HKL[key].name)}</h2><span class="count">${list.length} game${list.length === 1 ? '' : 's'}${live ? ` · <span class="pill live">${live} live</span>` : ''}</span>${lgBtn}</div>`
      + (list.length ? [...groups].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, l]) => `<div class="group"><div class="group-h">${hkLogo(k) ? `<img src="${esc(hkLogo(k))}" alt="">` : ''}<strong>${esc(HKL[k].name)}</strong><span>· ${esc(HKL[k].area)}</span>${key === 'all' ? `<button class="linkbtn bb-more" data-hklg="${k}">All ${esc(hkName(k))} games ›</button>` : ''}</div><div class="cards">${l.map(hkCard).join('')}</div></div>`).join('')
        : `<div class="empty-state"><strong>${d.fsDown && d.espnDown ? "Couldn't load games" : 'No games'}</strong>${d.fsDown && d.espnDown ? 'Check your connection and try again.' : key !== 'all' ? `${esc(HKL[key].name)} has no games on this day. Use the arrows, or open standings, results & fixtures.${key === 'wjc' || key === 'spengler' ? ' It runs in late December.' : key === 'wch' ? ' It runs in May.' : key === 'olympics' ? ' The next Winter Olympics are in 2030.' : ''}` : 'Try another day.'}</div>`)
      + (d.fsDown ? `<p class="srcnote">The local server isn't answering, so only the NHL and college hockey are shown. Start it with <code>python3 server.py --lan</code>.</p>` : '');
  };
  if (S.hk.days[off]) paint(); else el.innerHTML = hkDateBar(off) + '<div class="cards"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  await hkLoadDay(off);
  paint();
  hkListPredictions(off).then(ch => ch && paint()).catch(() => {});
  hkListOdds(off).then(ch => ch && hkListPredictions(off)).then(paint).catch(() => {});
}
function hkTicker(){
  const all = Object.values(S.hk.days).flatMap(d => d.events || []), seen = new Set();
  const live = all.filter(e => e.state === 'in' && !seen.has(e.id) && seen.add(e.id));
  const next = all.filter(e => e.state === 'pre' && e.date > Date.now() && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => (b.lg === 'nhl') - (a.lg === 'nhl') || a.date - b.date).slice(0, 6);
  const ab = t => esc(t.abbr || t.name);
  const chip = e => `<button class="tk" data-hkgame="${esc(e.id)}"><span class="mn ${e.state === 'in' ? '' : 'pre'}">${e.state === 'in' ? esc(e.detail.split(' - ')[0]) : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><img src="${esc(e.away.logo)}" alt="">${ab(e.away)}${e.state === 'in' ? `<span class="s num">${esc(e.away.score)}–${esc(e.home.score)}</span>` : ' @ '}${ab(e.home)}<img src="${esc(e.home.logo)}" alt=""></button>`;
  $('ticker').hidden = !live.length && !next.length;
  $('ticker').innerHTML = (live.length ? `<span class="lab">${live.length} live</span>` + live.map(chip).join('') : '') + (next.length ? `<span class="lab next">Next up</span>` + next.map(chip).join('') : '');
}

/* ---------- predictions page ---------- */
async function renderHkPicks(){
  const el = $('hk');
  const paint = () => {
    if (S.sport !== 'hockey' || S.hk.view !== 'picks') return;
    const evs = [0, 1].flatMap(o => S.hk.days[o]?.events || []).filter(e => e.state !== 'post');
    const items = evs.map(e => { const P = hkPredict(e); if (!P) return null;
      return { e, P, id: e.id, lg: e.lg, lgName: HKL[e.lg].name, cat: HKL[e.lg].region, order: HK_LEAGUES.indexOf(HKL[e.lg]), date: e.date, live: e.state === 'in', conf: P.conf, top: P.top,
        edge: P.market != null ? (P.pick === 'home' ? P.pModel - P.market : P.market - P.pModel) : null, fav: S.fav.some(f => f.sport === 'hockey' && (f.tid === e.home.id || f.tid === e.away.id)) } }).filter(Boolean);
    const shown = PFX.apply('hockey', items), loading = !S.hk.days[0] || !S.hk.days[1];
    el.innerHTML = `<div class="livebar"><h2>Predictions</h2><span class="count">${items.length} game${items.length === 1 ? '' : 's'} today and tomorrow</span></div>
      ${PFX.bar('hockey', items, HK_REGIONS.map(r => [r, r]))}
      <div class="cards">${shown.slice(0, 200).map(({ e, P }) => { const us = hkUS(e), [A, B, ca, cb, pA] = us ? [e.away, e.home, e.ac, e.hc, 1 - P.pH] : [e.home, e.away, e.hc, e.ac, P.pH];
        return `<button class="m pred-card fb" data-hkgame="${esc(e.id)}" data-hktab="pred" style="--hc:${ca};--ac:${cb}">
        <div class="st">${e.state === 'in' ? `<span class="min" style="color:var(--live)">${esc(e.detail)}</span>LIVE` : `<span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}`}</div>
        <div class="tms"><div class="tm"><img src="${esc(A.logo)}" alt="" loading="lazy" ${hkErr}><span>${A.rank ? `<em class="rk">${A.rank}</em>` : ''}${esc(A.name)}</span></div><div class="tm"><img src="${esc(B.logo)}" alt="" loading="lazy" ${hkErr}><span>${B.rank ? `<em class="rk">${B.rank}</em>` : ''}${esc(B.name)}</span></div>
          <div class="pbar"><i style="flex-grow:${pA};background:${ca}"><span>${pct(pA)}%</span></i><i style="flex-grow:${1 - pA};background:${cb}"><span>${pct(1 - pA)}%</span></i></div></div>
        <div class="pc-side"><span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf}</span><b>${esc(e[P.pick].name)}</b><small class="num">${us ? P.score[1] + '–' + P.score[0] : P.score.join('–')} · ${pct(P.top)}% · O/U ${P.ou.line}</small><small class="pfx-lg">${esc(hkName(e.lg))}</small></div></button>` }).join('')
        || PFX.empty('hockey', items.length) || (loading ? '<div class="skel"></div><div class="skel"></div>' : '<div class="empty-state"><strong>No upcoming games</strong>Nothing left to play today or tomorrow.</div>')}</div>
      <p class="srcnote">Expected goals from each team's goals for and against this season, with home ice; ties after 60 minutes go to overtime. Where bookmakers, Kalshi or ESPN price the game, the market carries 65%.</p>${RG}`;
  };
  if (S.hk.days[0] || S.hk.days[1]) paint(); else el.innerHTML = '<div class="skel" style="height:300px"></div>';
  await Promise.allSettled([hkLoadDay(0), hkLoadDay(1)]); paint();
  await Promise.allSettled([0, 1].map(hkListPredictions)); paint();
  await Promise.allSettled([0, 1].map(o => hkListOdds(o).catch(() => {}))); paint();
}

/* ---------- NHL stats page: skaters, goalies, teams, hits & blocks (official NHL stats API) ---------- */
const HK_STAT_TABS = {
  skaters: { u: 'stats/rest/en/skater/summary', name: 'skaterFullName', def: 'points', cols: [['gamesPlayed', 'GP'], ['goals', 'G'], ['assists', 'A'], ['points', 'PTS'], ['plusMinus', '+/-'], ['penaltyMinutes', 'PIM'], ['ppGoals', 'PPG'], ['ppPoints', 'PPP'], ['shGoals', 'SHG'], ['gameWinningGoals', 'GWG'], ['otGoals', 'OTG'], ['shots', 'S'], ['shootingPct', 'S%', 'pct'], ['timeOnIcePerGame', 'TOI', 'toi'], ['faceoffWinPct', 'FO%', 'pct'], ['pointsPerGame', 'P/GP', 'f2']] },
  goalies: { u: 'stats/rest/en/goalie/summary', name: 'goalieFullName', def: 'wins', cols: [['gamesPlayed', 'GP'], ['gamesStarted', 'GS'], ['wins', 'W'], ['losses', 'L'], ['otLosses', 'OTL'], ['goalsAgainstAverage', 'GAA', 'f2', true], ['savePct', 'SV%', 'sv'], ['shotsAgainst', 'SA'], ['saves', 'SV'], ['goalsAgainst', 'GA', '', true], ['shutouts', 'SO'], ['timeOnIce', 'TOI', 'toiH']] },
  teams: { u: 'stats/rest/en/team/summary', name: 'teamFullName', def: 'points', cols: [['gamesPlayed', 'GP'], ['wins', 'W'], ['losses', 'L'], ['otLosses', 'OTL'], ['points', 'PTS'], ['pointPct', 'P%', 'f3'], ['goalsForPerGame', 'GF/GP', 'f2'], ['goalsAgainstPerGame', 'GA/GP', 'f2', true], ['powerPlayPct', 'PP%', 'pct'], ['penaltyKillPct', 'PK%', 'pct'], ['shotsForPerGame', 'SF/GP', 'f1'], ['shotsAgainstPerGame', 'SA/GP', 'f1', true], ['faceoffWinPct', 'FO%', 'pct'], ['winsInRegulation', 'RW']] },
  realtime: { u: 'stats/rest/en/skater/realtime', name: 'skaterFullName', def: 'hits', cols: [['gamesPlayed', 'GP'], ['hits', 'HIT'], ['hitsPer60', 'HIT/60', 'f1'], ['blockedShots', 'BLK'], ['blockedShotsPer60', 'BLK/60', 'f1'], ['takeaways', 'TK'], ['giveaways', 'GV', '', true], ['missedShots', 'MISS'], ['emptyNetGoals', 'ENG'], ['firstGoals', '1st G'], ['timeOnIcePerGame', 'TOI', 'toi']] },
};
const HK_STAT_LABEL = { skaters: 'Skaters', goalies: 'Goalies', teams: 'Teams', realtime: 'Hits, blocks & takeaways' };
function hkStatFmt(v, f){ if (v == null || v === '') return '–'; if (f === 'pct') return (+v * 100).toFixed(1); if (f === 'sv') return (+v).toFixed(3).replace(/^0/, ''); if (f === 'toi') return hkToi(v); if (f === 'toiH') return Math.round(+v / 60).toLocaleString();
  if (f === 'f1') return (+v).toFixed(1); if (f === 'f2') return (+v).toFixed(2); if (f === 'f3') return (+v).toFixed(3).replace(/^0/, ''); return typeof v === 'number' ? v.toLocaleString() : esc(v) }
async function hkLoadStats(tab, sort, dir, pos){
  const T = HK_STAT_TABS[tab], k = `${tab}|${sort}|${dir}|${pos || ''}`; if (S.hk.stats[k] && Date.now() - S.hk.stats[k].at < 600000) return S.hk.stats[k];
  const exp = `gameTypeId=2 and seasonId=${hkSeason()}${pos === 'F' ? ' and positionCode!="D"' : pos === 'D' ? ' and positionCode="D"' : ''}${tab === 'goalies' && /Average|Pct/.test(sort) ? ' and gamesPlayed>=3' : ''}`;
  const q = `isAggregate=false&isGame=false&sort=${JSON.stringify([{ property: sort, direction: dir }, ...(tab === 'teams' ? [] : [{ property: 'playerId', direction: 'ASC' }])])}&start=0&limit=${tab === 'teams' ? 40 : 100}&cayenneExp=${exp}`;
  const d = await getJSON(hkNhl(T.u, q));
  return S.hk.stats[k] = { rows: d.data || [], total: d.total, at: Date.now() };
}
async function renderHkStats(){
  const el = $('hk'), tab = S.hk.statTab, T = HK_STAT_TABS[tab], ss = S.hk.statSort[tab] || { k: T.def, dir: (T.cols.find(c => c[0] === T.def)?.[3]) ? 'ASC' : 'DESC' }, pos = S.hk.statPos || '';
  const head = `<div class="livebar"><h2>NHL stats</h2><span class="count">${esc(hkSeason().slice(0, 4))}–${esc(hkSeason().slice(6))} regular season</span><button class="btn ghost lginfo" data-hkact="nhlleague">Standings & leaders</button></div>
    <div class="quick">${Object.keys(HK_STAT_TABS).map(k => `<button class="qf" data-hkstat="${k}" aria-pressed="${tab === k}">${HK_STAT_LABEL[k]}</button>`).join('')}</div>
    ${tab === 'skaters' || tab === 'realtime' ? `<div class="quick">${[['', 'All skaters'], ['F', 'Forwards'], ['D', 'Defence']].map(([k, l]) => `<button class="qf" data-hkact="pos" data-to="${k}" aria-pressed="${pos === k}">${l}</button>`).join('')}</div>` : ''}`;
  el.innerHTML = head + hkLoading(400);
  let d; try { d = await hkLoadStats(tab, ss.k, ss.dir, tab === 'skaters' || tab === 'realtime' ? pos : '') } catch { d = null }
  if (S.sport !== 'hockey' || S.hk.view !== 'stats' || S.hk.statTab !== tab) return;
  if (!d) { el.innerHTML = head + `<div class="empty-state"><strong>Couldn't load NHL stats</strong>The full stat tables come from the NHL through the local server. Start it with <code>python3 server.py --lan</code>, then try again. Box scores, rosters and player pages still work without it.</div>`; return }
  if (!d.rows.length) { el.innerHTML = head + `<div class="empty-state"><strong>No stats yet</strong>The regular season hasn't started.</div>`; return }
  const shot = r => { const ab = String(r.teamAbbrevs || '').split(',').pop().trim(); return r.playerId && ab ? `https://assets.nhle.com/mugs/nhl/${hkSeason()}/${ab}/${r.playerId}.png` : SIL };
  const nameCell = r => tab === 'teams' ? `<td class="t"><img src="https://assets.nhle.com/logos/nhl/svg/${esc(hkAbbrOf(r.teamFullName))}_light.svg" alt="" class="hk-tlogo" ${hkErr}><button class="linkbtn" data-hkteamname="${esc(r.teamFullName)}">${esc(r.teamFullName)}</button></td>`
    : `<td class="t"><img src="${esc(shot(r))}" alt="" class="bb-face" ${hkFaceErr}><button class="linkbtn" data-hknhlp="${esc(r.playerId)}">${esc(r[T.name])}</button><small>${esc([r.positionCode, r.teamAbbrevs].filter(Boolean).join(' · '))}</small></td>`;
  el.innerHTML = head + `<div class="tbl-wrap hk-stats"><table class="ctable bb-box"><thead><tr><th>#</th><th style="text-align:left">${tab === 'teams' ? 'Team' : 'Player'}</th>${T.cols.map(([k, l, , low]) => `<th><button class="hk-sort${ss.k === k ? ' on' : ''}" data-hkact="sort" data-to="${k}" data-low="${low ? 1 : ''}" title="Sort by ${esc(l)}">${esc(l)}${ss.k === k ? (ss.dir === 'DESC' ? ' ▾' : ' ▴') : ''}</button></th>`).join('')}</tr></thead><tbody>
    ${d.rows.map((r, i) => `<tr><td class="num">${i + 1}</td>${nameCell(r)}${T.cols.map(([k, , f]) => `<td class="${ss.k === k ? 'hk-on' : ''}">${hkStatFmt(r[k], f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="srcnote">Top ${d.rows.length}${d.total ? ` of ${d.total}` : ''}, from the NHL's official stats. Tap a column to sort the whole league by it${tab === 'goalies' ? ' (save % and GAA need 3+ games)' : ''}; tap a ${tab === 'teams' ? 'team for its roster and schedule' : 'player for their full career and game log'}.</p>`;
}
const HK_NHL_TEAMS = { 'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF', 'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montréal Canadiens': 'MTL', 'Montreal Canadiens': 'MTL', 'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR', 'Utah Mammoth': 'UTA', 'Utah Hockey Club': 'UTA', 'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG' };
const hkAbbrOf = name => HK_NHL_TEAMS[name] || '';

/* ---------- game page ---------- */
function openHkGame(id, tab){
  const e = S.hk.games.get(String(id)); if (!e) return;
  S.sel = null; S.stack = [{ type: 'hkgame', id: e.id, e, tab: tab || (e.state === 'pre' ? 'pred' : 'summary') }];
  renderSheet(); $('sheet').classList.add('open'); $('sheet').querySelector('.sheet-body')?.scrollTo(0, 0);
  hkLoadGame(S.stack[0]);
}
async function hkLoadGame(v){
  const e = v.e, re = () => S.stack.includes(v) && renderSheet();
  hkStandings(e.lg).then(re);
  const jobs = [];
  if (e.src === 'espn') {
    jobs.push(getJSON(`${HKE}/${e.path}/summary?event=${e.id}`).then(d => { v.sum = d;
      const c = d.header?.competitions?.[0];
      if (c?.status?.type?.state) { e.state = c.status.type.state; e.detail = c.status.type.shortDetail || e.detail;
        for (const x of c.competitors || []) { const s = x.homeAway === 'home' ? e.home : e.away; s.score = x.score ?? s.score; s.lines = (x.linescores || []).map(q => q.displayValue ?? q.value); if (x.record?.[0]?.summary) s.record = x.record[0].summary } }
      const pc = d.pickcenter?.[0]; if (pc) S.hk.espnLine.set(e.id, { details: pc.details, ou: pc.overUnder, home: pc.homeTeamOdds?.moneyLine, away: pc.awayTeamOdds?.moneyLine });
    }).catch(() => { v.sum = { error: true } }));
    const d = isoDay(e.date).replace(/-/g, '');
    if (!e.twin) jobs.push(getJSON(`/api/hk/find?date=${d}&home=${encodeURIComponent(e.home.full)}&away=${encodeURIComponent(e.away.full)}&tz=${hkTz()}`).then(x => { if (x?.id) { e.twin = { id: x.id, ja: x.home?.pid, jb: x.away?.pid }; return hkFsGame(v) } }).catch(() => {}));
    else jobs.push(hkFsGame(v));
    if (HKL[e.lg].kx) jobs.push(hkKalshi(e).catch(() => {}));
  } else jobs.push(hkFsGame(v));
  for (const j of jobs) j.then(re);
  await Promise.allSettled(jobs); v.loaded = true;
  if (e.state === 'pre') { const P = hkPredict(e); if (P) S.hk.pred.set(e.id, P) }
  re();
}
async function hkFsGame(v){
  const e = v.e, id = e.src === 'fs' ? e.id : e.twin?.id, ja = e.src === 'fs' ? e.home.pid : e.twin?.ja, jb = e.src === 'fs' ? e.away.pid : e.twin?.jb; if (!id) return;
  try { const g = await getJSON(`/api/hk/game?id=${id}&ja=${ja || ''}&jb=${jb || ''}`); v.fs = g; S.hk.odds.set(e.id, { ...(g.odds || { books: [] }), at: Date.now(), full: true });
    if (e.src === 'fs') { if (g.info?.venue) e.venue = g.info.venue; if (g.info?.city) e.city = g.info.city } }
  catch { v.fs = { error: true } }
}
async function hkKalshi(e){
  const pre = HKL[e.lg].kx;
  const [g, sp, to] = await Promise.allSettled(['GAME', 'SPREAD', 'TOTAL'].map(k => kxSeries(pre, k)));
  const o = {};
  const kg = val(g) && kxFind(val(g), e); if (kg) o.ml = parseML(e, kg);
  const ks = val(sp) && kxFind(val(sp), e);
  if (ks) o.spread = (ks.markets || []).map(m => ({ side: sideOf(e, (m.yes_sub_title || '').replace(/ wins? by.*$/i, '')), line: +m.floor_strike, p: price(m), prev: prev(m), label: m.yes_sub_title })).filter(x => x.side && x.line).sort((a, b) => a.line - b.line);
  const kt = val(to) && kxFind(val(to), e);
  if (kt) o.total = (kt.markets || []).map(m => ({ line: +m.floor_strike, p: price(m), prev: prev(m) })).filter(x => x.line).sort((a, b) => a.line - b.line);
  o.at = Date.now(); o.found = !!(kg || ks || kt); S.odds.set('hk' + e.id, o);
}
function hkPerLabel(i, n, lg){ return i < 3 ? ['1st', '2nd', '3rd'][i] : i === 3 && n === 5 && lg === 'nhl' ? 'OT' : i === n - 1 && n >= 5 ? 'SO' : 'OT' + (i > 3 ? i - 2 : '') }
function hkHero(e, back){
  const s = e.state !== 'pre', us = hkUS(e);
  const [L, R, lt, rt] = us ? [e.away, e.home, 'Away', e.neutral ? 'Neutral' : 'Home'] : [e.home, e.away, e.neutral ? 'Neutral' : 'Home', 'Away'];
  const side = (t, ha) => `<div class="side"><img src="${esc(t.logo)}" alt="" ${hkErr}><strong><button class="linkbtn" data-hkteam="${esc(t.id)}" data-hkl="${esc(e.lg)}" data-hkslug="${esc(t.slug || '')}">${t.rank ? `<em class="rk">${t.rank}</em>` : ''}${esc(t.full || t.name)}</button></strong><small class="rec">${esc(t.record || '')}${t.record ? ' · ' : ''}${ha}</small></div>`;
  const lines = (L.lines?.length ? L.lines : R.lines?.length ? R.lines : null);
  return `<div class="hero" style="--hc:${us ? e.ac : e.hc};--ac:${us ? e.hc : e.ac}">
    ${topBar(back).replace('<div class="hero-top">', `<div class="hero-top"><div class="lgname">${hkLogo(e.lg) ? `<img src="${esc(hkLogo(e.lg))}" width="16" height="16" alt="">` : ''}<span>${esc(HKL[e.lg].name)}${e.note ? ' · ' + esc(e.note) : ''}</span></div>`)}
    <div class="board">${side(L, lt)}
      <div class="score">${s ? `<div class="big num">${esc(L.score)}<em>–</em>${esc(R.score)}</div><div class="status">${e.state === 'in' ? `<span class="pill live">${esc(e.detail)}</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">${esc(e.detail)}</span>`}</div>`
        : `<div class="kick num">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="sub">${esc(e.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}${kickoffIn(e.date) ? '<br>' + kickoffIn(e.date) : ''}</div>`}</div>
      ${side(R, rt)}</div>
    ${lines ? `<div class="tbl-wrap"><table class="qtr"><thead><tr><th></th>${lines.map((_, i) => `<th>${hkPerLabel(i, lines.length, e.lg)}</th>`).join('')}<th>T</th></tr></thead><tbody>
      ${[L, R].map(t => `<tr><td class="t">${esc(t.abbr || t.name)}</td>${(t.lines || []).map(x => `<td>${esc(x)}</td>`).join('')}<td class="pts">${esc(t.score)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="meta-row">${e.venue ? `<span>${esc(e.venue)}${e.city ? ', ' + esc(e.city) : ''}</span>` : ''}${e.tv ? `<span>TV: ${esc(e.tv)}</span>` : ''}${e.line?.details ? `<span>Line: ${esc(e.line.details)}${e.line.ou ? ` · O/U ${esc(e.line.ou)}` : ''}</span>` : ''}</div></div>`;
}
function hkGameTabs(v){
  const e = v.e;
  if (e.src === 'espn') return e.state === 'pre' ? [['pred', 'Prediction'], ['odds', 'Odds'], ['team', 'Matchup'], ['h2h', 'Season series'], ['stand', 'Standings']]
    : [['summary', 'Summary'], ['box', 'Box score'], ['team', 'Team stats'], ['odds', 'Odds'], ['pred', 'Prediction'], ['h2h', 'Season series'], ['stand', 'Standings']];
  return [['summary', 'Summary'], ...(v.fs?.box?.length ? [['box', 'Box score']] : []), ['team', 'Team stats'], ['odds', 'Odds'], ['pred', 'Prediction'], ['h2h', 'Head to head'], ['stand', 'Standings']];
}
function hkPane(v){
  const e = v.e;
  if (v.tab === 'pred') return hkPredPane(v);
  if (v.tab === 'odds') return hkOddsPane(v);
  if (v.tab === 'stand') { if (!S.hk.stand[e.lg]) hkStandings(e.lg).then(() => S.stack.includes(v) && renderSheet()); return hkStandingsHTML(e.lg, [e.home.id, e.away.id]) }
  if (v.tab === 'h2h') return hkH2HPane(v);
  if (v.tab === 'box') return e.src === 'espn' ? hkEspnBox(v) : hkFsBox(v);
  if (v.tab === 'team') return hkTeamStatsPane(v);
  if (v.tab === 'summary') return e.src === 'espn' ? hkEspnSummary(v) : hkFsSummary(v);
  return '';
}
// goals and penalties, period by period
function hkEspnSummary(v){
  const e = v.e, d = v.sum; if (!d) return hkLoading(); if (d.error) return `<div class="note">Couldn't load this game.</div>`;
  const plays = d.plays || [], teamOf = id => String(id) === e.home.id ? e.home : e.away;
  const goals = plays.filter(p => p.scoringPlay), pens = plays.filter(p => /penalty/i.test(p.type?.text || ''));
  let h = hkEspnLeaders(v);
  const per = p => p.period?.number ?? p.period ?? 0;
  const perName = n => n <= 3 ? ['1st period', '2nd period', '3rd period'][n - 1] : n === 4 ? 'Overtime' : n === 5 ? 'Shootout' : 'OT' + (n - 3);
  if (goals.length) {
    const ps = [...new Set(goals.map(per))].sort((a, b) => a - b);
    h += `<div class="sub-h"${h ? '' : ' style="margin-top:0"'}><h5>Scoring</h5><small>${goals.length} goal${goals.length === 1 ? '' : 's'}</small></div>` + ps.map(n => `<div class="grp-name" style="font-size:12.5px">${perName(n)}</div><ul class="hk-plays">${goals.filter(p => per(p) === n).map(p => { const t = teamOf(p.team?.id);
      const scorer = (p.participants || [])[0]?.athlete;
      return `<li><span class="clk num">${esc(p.clock?.displayValue || '')}</span><img src="${esc(t.logo)}" alt="" ${hkErr}><span class="ptx">${scorer?.id ? `<button class="linkbtn" data-hkplayer="${esc(scorer.id)}" data-hkl="${esc(e.lg)}">${esc(p.text || '')}</button>` : esc(p.text || '')}${p.strength?.text || p.strength?.abbreviation ? ` <span class="hk-str">${esc(p.strength?.text || p.strength?.abbreviation)}</span>` : ''}</span><b class="num">${esc(p.awayScore ?? '')}–${esc(p.homeScore ?? '')}</b></li>` }).join('')}</ul>`).join('');
  } else if (e.state !== 'pre') h += `<div class="note">No goals yet.</div>`;
  if (pens.length) h += `<div class="sub-h"><h5>Penalties</h5><small>${pens.length}</small></div><ul class="hk-plays pen">${pens.map(p => { const t = teamOf(p.team?.id); return `<li><span class="clk num">${esc(['', '1st', '2nd', '3rd'][per(p)] || 'OT')} ${esc(p.clock?.displayValue || '')}</span><img src="${esc(t.logo)}" alt="" ${hkErr}><span class="ptx">${esc(p.text || '')}</span><b></b></li>` }).join('')}</ul>`;
  const gi = d.gameInfo; if (gi?.venue || gi?.attendance) h += `<p class="srcnote">${esc([gi.venue?.fullName, gi.attendance ? `Attendance ${(+gi.attendance).toLocaleString()}` : '', ...(gi.officials || []).map(o => o.displayName)].filter(Boolean).join(' · '))}</p>`;
  return h || `<div class="note">The summary appears once the game starts.</div>`;
}
function hkEspnLeaders(v){
  const e = v.e, L = (v.sum?.leaders || []).filter(t => t.leaders?.some(c => c.leaders?.length)); if (!L.length) return '';
  return `<div class="sub-h" style="margin-top:0"><h5>${e.state === 'pre' ? 'Season leaders' : 'Game leaders'}</h5></div><div class="bench fb-leaders">${L.map(t => { const side = String(t.team?.id) === e.home.id ? e.home : e.away;
    return `<div><div class="head"><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px">${esc(side.name)}</div>${(t.leaders || []).slice(0, 4).map(c => { const a = c.leaders?.[0]; if (!a) return '';
      return `<button class="ldr fbl" data-hkplayer="${esc(a.athlete?.id)}" data-hkl="${esc(e.lg)}"><span class="cat">${esc(c.displayName || c.name)}</span><img class="face-s espn-shot" src="${esc(a.athlete?.headshot?.href || hkShot(a.athlete?.id, e.path))}" alt="" ${hkFaceErr}><span class="nm"><span>${esc(a.athlete?.displayName || '')}</span><small>${esc(a.displayValue || '')}</small></span></button>` }).join('')}</div>` }).join('')}</div>`;
}
function hkEspnBox(v){
  const e = v.e, d = v.sum; if (!d) return hkLoading(); if (d.error) return `<div class="note">Couldn't load this game.</div>`;
  const P = d.boxscore?.players || [];
  if (!P.length) return `<div class="note">The box score appears once the game starts.</div>`;
  const title = n => ({ forwards: 'Forwards', defenses: 'Defence', defensemen: 'Defence', goalies: 'Goalies', goalie: 'Goalies', skaters: 'Skaters' }[String(n || '').toLowerCase()] || n || '');
  return P.map(t => { const side = String(t.team?.id) === e.home.id ? e.home : e.away;
    return `<div class="sub-h"><h5><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px">${esc(side.name)}</h5></div>` + (t.statistics || []).map(g => { const rows = g.athletes || []; if (!rows.length) return '';
      return `<div class="grp-name" style="font-size:12.5px">${esc(title(g.name || g.text))}</div><div class="tbl-wrap"><table class="ctable bb-box"><thead><tr><th style="text-align:left">Player</th>${(g.labels || []).map((x, i) => `<th title="${esc(g.descriptions?.[i] || '')}">${esc(x)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(a => `<tr class="${a.didNotPlay ? 'dnp' : ''}"><td class="t"><img src="${esc(a.athlete?.headshot?.href || hkShot(a.athlete?.id, e.path))}" alt="" class="bb-face" ${hkFaceErr}><button class="linkbtn" data-hkplayer="${esc(a.athlete?.id)}" data-hkl="${esc(e.lg)}">${esc(a.athlete?.shortName || a.athlete?.displayName || '')}</button><small>${esc(a.athlete?.jersey ? '#' + a.athlete.jersey : a.athlete?.position?.abbreviation || '')}</small></td>${a.didNotPlay ? `<td colspan="${(g.labels || []).length}" class="dnp-r">${esc(a.reason || 'Did not play')}</td>` : (a.stats || []).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` }).join('') }).join('')
    + `<p class="srcnote">G goals · A assists · +/- plus-minus · S shots · BS blocked shots · PIM penalty minutes · HT hits · TK takeaways · GV giveaways · TOI time on ice · FW/FL faceoffs won/lost · SA shots against · SV saves. Tap a player for their season and game log.</p>`;
}
function hkFsBox(v){
  const e = v.e, fs = v.fs; if (!fs) return hkLoading(); if (fs.error) return `<div class="note">Couldn't load this game.</div>`;
  const tab = fs.box?.find(t => t.name === 'Overall') || fs.box?.[0];
  if (!tab?.players?.length) return `<div class="note">No player box score for this game.</div>`;
  const cols = tab.cols.filter(c => tab.players.some(p => p.stats[c.key]));
  const teams = [...new Set(tab.players.map(p => p.team))];
  return teams.map((ab, i) => { const side = [e.home, e.away].find(t => (t.abbr || '').toUpperCase() === (ab || '').toUpperCase()) || (i === 0 ? e.home : e.away);
    return `<div class="sub-h"><h5><img src="${esc(side.logo)}" alt="" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px">${esc(side.name)}</h5></div><div class="tbl-wrap"><table class="ctable bb-box"><thead><tr><th style="text-align:left">Player</th>${cols.map(c => `<th title="${esc(c.label)}">${esc(c.key)}</th>`).join('')}</tr></thead><tbody>
      ${tab.players.filter(p => p.team === ab).map(p => `<tr><td class="t"><button class="linkbtn" data-hkfsplayer="${esc(p.id)}" data-hkslug="${esc(p.slug)}" data-hkl="${esc(e.lg)}">${esc(p.name)}</button><small>${esc(p.country || '')}</small></td>${cols.map(c => `<td>${esc(p.stats[c.key] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` }).join('')
    + `<p class="srcnote">Box score from Flashscore.</p>`;
}
function hkFsSummary(v){
  const e = v.e, fs = v.fs; if (!fs) return hkLoading(); if (fs.error) return `<div class="note">Couldn't load this game.</div>`;
  let h = '';
  if (fs.periods?.length) h += `<div class="sub-h" style="margin-top:0"><h5>By period</h5></div><div class="bb-cmp">${fs.periods.map(p => `<div><b class="num">${esc(p.home)}</b><span>${esc(p.period)}</span><b class="num">${esc(p.away)}</b></div>`).join('')}</div>`;
  if (fs.info && (fs.info.venue || fs.info.refs)) h += `<p class="srcnote">${esc([fs.info.venue, fs.info.city, fs.info.attendance ? 'Attendance ' + fs.info.attendance : '', ...(fs.info.refs || []).map(r => 'Referee ' + r)].filter(Boolean).join(' · '))}</p>`;
  if (e.state === 'pre') h += hkPredPane(v);
  return h || `<div class="note">${e.state === 'pre' ? 'The game hasn\'t started.' : 'No summary published for this game.'}</div>`;
}
function hkTeamStatsPane(v){
  const e = v.e, us = hkUS(e), [L, R, lc, rc] = us ? [e.away, e.home, e.ac, e.hc] : [e.home, e.away, e.hc, e.ac];
  let h = '';
  if (e.src === 'espn') {
    if (!v.sum) return hkLoading(); if (v.sum.error) return `<div class="note">Couldn't load this game.</div>`;
    const teams = v.sum.boxscore?.teams || [];
    if (teams.length && teams[0].statistics?.length && e.state !== 'pre') { const by = id => teams.find(t => String(t.team?.id) === id) || {}, TL = by(L.id), TR = by(R.id);
      h += `<div class="sub-h" style="margin-top:0"><h5>Team stats</h5><small>${esc(L.abbr)} · ${esc(R.abbr)}</small></div>` + bbStatBars(e, (TL.statistics || []).map(s => ({ label: s.label || s.displayName || s.name, l: s.displayValue, r: (TR.statistics || []).find(x => x.name === s.name)?.displayValue ?? '', lc, rc }))) }
  } else if (v.fs?.stats?.length) { const per = v.fs.stats[Math.min(v.period || 0, v.fs.stats.length - 1)], flip = r => us ? { l: r.away, r: r.home } : { l: r.home, r: r.away };
    h += `<div class="sub-h" style="margin-top:0"><h5>Team stats</h5></div>${v.fs.stats.length > 1 ? `<div class="quick">${v.fs.stats.map((p, i) => `<button class="qf" data-hkact="period" data-to="${i}" aria-pressed="${i === (v.period || 0)}">${esc(p.period === 'Match' ? 'Game' : p.period)}</button>`).join('')}</div>` : ''}`
      + per.groups.map(g => `<div class="grp-name" style="font-size:13px">${esc(g.name)}</div>` + bbStatBars(e, g.rows.map(r => ({ label: r.label, ...flip(r), lc, rc })))).join('') }
  else if (e.src === 'fs' && !v.fs) return hkLoading();
  return (h || (e.state === 'pre' ? '' : `<div class="note">No team stats for this game.</div>`)) + hkSeasonCompare(v);
}
function hkSeasonCompare(v){
  const e = v.e, H = hkRow(e.lg, e.home.id), A = hkRow(e.lg, e.away.id); if (!H?.gp || !A?.gp) return '';
  const f = (x, n) => (x[n] / x.gp).toFixed(2);
  const rows = [['Record', `${H.w}-${H.l}-${H.otl}`, `${A.w}-${A.l}-${A.otl}`], ['Points', H.pts, A.pts], ['Points %', H.ppct.toFixed(3).replace(/^0/, ''), A.ppct.toFixed(3).replace(/^0/, '')], ['Goals for a game', f(H, 'gf'), f(A, 'gf')], ['Goals against a game', f(H, 'ga'), f(A, 'ga')], ['Goal difference', (H.gf - H.ga > 0 ? '+' : '') + (H.gf - H.ga), (A.gf - A.ga > 0 ? '+' : '') + (A.gf - A.ga)],
    ...(H.streak || A.streak ? [['Streak', H.streak || '–', A.streak || '–']] : []), ...(H.l10 || A.l10 ? [['Last 10', H.l10 || '–', A.l10 || '–']] : []), ...(H.home ? [['Home / road', H.home, A.away || '–']] : [])];
  return `<div class="sub-h"><h5>Season so far</h5><small>${esc(e.home.abbr || e.home.name)} · ${esc(e.away.abbr || e.away.name)}</small></div><div class="bb-cmp">${rows.map(([k, h, a]) => `<div><b class="num">${esc(h)}</b><span>${esc(k)}</span><b class="num">${esc(a)}</b></div>`).join('')}</div>`;
}
function hkH2HPane(v){
  const e = v.e;
  let h = '';
  if (e.src === 'espn' && v.sum?.seasonseries?.length) { const ss = v.sum.seasonseries[0];
    h += `<div class="sub-h" style="margin-top:0"><h5>Season series</h5><small>${esc(ss.summary || '')}</small></div><div class="fbsched">${(ss.events || []).map(x => { const hh = x.competitors?.find(c => c.homeAway === 'home'), a = x.competitors?.find(c => c.homeAway === 'away');
      return `<div class="fx"><span class="d">${esc(fmtDate(x.date))}</span><span class="vs"><img src="${esc(a?.team?.logo || '')}" alt=""><span>${esc(a?.team?.abbreviation || '')} @ ${esc(hh?.team?.abbreviation || '')}</span><img src="${esc(hh?.team?.logo || '')}" alt=""></span><span class="r num">${x.statusType?.completed || x.status === 'post' ? `${esc(a?.score)}–${esc(hh?.score)}` : esc(x.statusType?.shortDetail || '')}</span></div>` }).join('')}</div>` }
  const fs = v.fs;
  if (fs?.h2h?.length) h += fs.h2h.map(sec => { const games = sec.games.slice(0, 10); if (!games.length) return '';
    return `<div class="sub-h"><h5>${esc(sec.title.replace('Last matches:', 'Last games:'))}</h5></div><div class="fbsched">${games.map(g => `<div class="fx"><span class="d">${esc(fmtDate(g.ts * 1000, { day: 'numeric', month: 'short', year: '2-digit' }))}<br>${esc(g.lg)}</span><span class="vs"><img src="${esc(g.hlogo)}" alt=""><span>${esc(g.home)} – ${esc(g.away)}</span><img src="${esc(g.alogo)}" alt=""></span><span class="r num">${esc(g.hs)}–${esc(g.as)} ${g.res ? `<span class="res ${g.res === 'w' ? 'W' : g.res === 'l' ? 'L' : 'D'}">${esc(g.res.toUpperCase())}</span>` : ''}</span></div>`).join('')}</div>` }).join('');
  if (!h && !v.loaded) return hkLoading();
  return h || `<div class="note">No head-to-head history found.</div>`;
}
function hkOddsPane(v){
  const e = v.e, o = S.hk.odds.get(e.id), kx = S.odds.get('hk' + e.id), us = hkUS(e), [L, R, lk, rk] = us ? [e.away, e.home, 'away', 'home'] : [e.home, e.away, 'home', 'away'];
  let h = '';
  if (e.src === 'espn' && v.sum?.pickcenter?.length) h += `<div class="sub-h" style="margin-top:0"><h5>Line via ESPN</h5></div><div class="bb-books"><div class="bb-bh"><span>Book</span><span>${esc(L.abbr)}</span><span>${esc(R.abbr)}</span><span>Puck line</span><span>Total</span></div>${v.sum.pickcenter.map(p => {
    const ml = s => p[s + 'TeamOdds']?.moneyLine; return `<div class="bb-br"><span>${esc(p.provider?.name || 'Book')}</span><span class="num">${ml(lk) != null ? (ml(lk) > 0 ? '+' : '') + ml(lk) : '–'}</span><span class="num">${ml(rk) != null ? (ml(rk) > 0 ? '+' : '') + ml(rk) : '–'}</span><span class="num">${esc(p.spread != null ? `${p.spread > 0 ? '+' : ''}${p.spread}` : p.details || '–')}</span><span class="num">${p.overUnder ? 'O/U ' + esc(p.overUnder) : '–'}</span></div>` }).join('')}</div>`;
  if (!o && !v.loaded) return h + hkLoading(200);
  const books = o?.books || [];
  if (books.length) { const best = k => Math.max(...books.map(b => b.ml?.[k] || 0)), bL = best(lk), bR = best(rk);
    h += `<div class="sub-h"${h ? '' : ' style="margin-top:0"'}><h5>Moneyline · sportsbooks</h5><small>Including overtime · best price highlighted</small></div><div class="bb-books"><div class="bb-bh"><span>Book</span><span>${esc(L.abbr || L.name)}</span><span>${esc(R.abbr || R.name)}</span><span>Puck line</span><span>Total</span></div>
      ${books.map(b => { const sp = b.spread?.[0], to = bbMainTotal(b);
        const spTxt = sp ? `${esc((sp.line < 0 ? e.home : e.away).abbr || '')} ${sp.line < 0 ? sp.line : -sp.line} <small>${decAm(sp.line < 0 ? sp.home : sp.away)}</small>` : '–';
        return `<div class="bb-br"><span>${esc(b.name.replace('.us', ''))}</span><span class="num${b.ml?.[lk] && b.ml[lk] === bL ? ' best' : ''}">${b.ml ? decAm(b.ml[lk]) : '–'}</span><span class="num${b.ml?.[rk] && b.ml[rk] === bR ? ' best' : ''}">${b.ml ? decAm(b.ml[rk]) : '–'}</span><span class="num">${spTxt}</span><span class="num">${to ? `${to.line} <small>o${decAm(to.over)} u${decAm(to.under)}</small>` : '–'}</span></div>` }).join('')}</div>`;
    const to0 = books.find(b => b.total?.length > 1);
    if (to0) h += `<div class="sub-h"><h5>Total goals</h5><small>${esc(to0.name.replace('.us', ''))}</small></div><div class="bb-alt"><div>${to0.total.map(x => `<div><span class="num">${x.line}</span><span class="num">o ${decAm(x.over)}</span><span class="num">u ${decAm(x.under)}</span></div>`).join('')}</div></div>`;
  } else if (!h) h += `<div class="note">${e.state === 'post' ? 'Betting has closed for this game.' : 'No bookmaker odds listed for this game yet.'}</div>`;
  if (kx?.found) {
    h += `<div class="grp-name bk-kx">Kalshi live markets</div>`;
    if (kx.ml) h += `<div class="mls" style="grid-template-columns:1fr 1fr">${[lk, rk].map(k => { const x = kx.ml[k]; if (!x) return ''; return `<div class="ml" style="--c:${k === 'home' ? e.hc : e.ac}"><span class="lbl">${esc(e[k].name)}</span><b class="num">${pct(x.p)}%</b><span class="am num">${american(x.p)} ${moveTag(x.p, x.prev)}</span><i style="width:${pct(x.p)}%"></i></div>` }).join('')}</div>`;
    if (kx.spread?.length) h += `<div class="sub-h"><h5>Wins by more than…</h5></div><div class="lines">${kx.spread.map(x => `<div class="ln"><span><b>${esc(e[x.side].abbr || e[x.side].name)} by ${x.line}+</b></span><span class="bar"><i style="width:${pct(x.p)}%;background:${x.side === 'home' ? e.hc : e.ac}"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small></span></div>`).join('')}</div>`;
    if (kx.total?.length) { const main = kx.total.reduce((a, b) => Math.abs(b.p - .5) < Math.abs(a.p - .5) ? b : a);
      h += `<div class="sub-h"><h5>Total goals · over</h5><small>Main line ${main.line}</small></div><div class="lines">${kx.total.map(x => `<div class="ln${x === main ? ' main' : ''}"><span><b>Over ${x.line}</b></span><span class="bar"><i style="width:${pct(x.p)}%;background:var(--accent)"></i></span><span class="num pv">${pct(x.p)}% <small>${american(x.p)}</small></span></div>`).join('')}</div>` }
  }
  return h + `<p class="srcnote">Sportsbook prices from Flashscore's odds comparison${o?.region ? ` (${esc(o.region)} market)` : ''}, plus ESPN's line and Kalshi for the NHL. Prices change quickly; check the book before betting.</p>${RG}`;
}
function hkPredPane(v){
  const e = v.e;
  if (!S.hk.stand[e.lg] || (!v.loaded && !S.hk.odds.get(e.id) && !e.line)) return hkLoading();
  const P = hkPredict(e); if (!P) return `<div class="note">Not enough information to predict this game yet.</div>`;
  const post = e.state === 'post', win = post ? (+e.home.score > +e.away.score ? 'home' : 'away') : null;
  const us = hkUS(e), [L, R, lc, rc, pL] = us ? [e.away, e.home, e.ac, e.hc, 1 - P.pH] : [e.home, e.away, e.hc, e.ac, P.pH];
  const [sL, sR] = us ? [P.score[1], P.score[0]] : P.score, fav = P.pick, dog = fav === 'home' ? 'away' : 'home';
  const likely = P.likely.map(([i, j, p]) => { const [a, b] = us ? [j, i] : [i, j]; return `<div class="tile"><b class="num">${a}–${b}</b><span>${pct(p)}%${i === j ? ' · then OT' : ''}</span></div>` }).join('');
  return `<div class="pred-head"><div><h5>${post ? 'Pre-game prediction' : 'Floodlight prediction'}</h5><strong class="pred-pick">${esc(e[fav].name)} win</strong>
      <span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf} · ${pct(P.top)}%</span>${post ? `<span class="pred-out ${win === P.pick ? 'ok' : 'miss'}">${win === P.pick ? 'Called it' : 'Missed'} — final ${esc(L.score)}–${esc(R.score)}${e.ot ? ' (OT)' : ''}</span>` : ''}</div>
      <div class="pred-score"><small>Most likely winning score</small><b class="num">${sL}–${sR}</b><small>${esc(L.abbr || L.name)} – ${esc(R.abbr || R.name)}</small></div></div>
    <div class="pbar" role="img" aria-label="${esc(`${L.name} ${pct(pL)} percent, ${R.name} ${pct(1 - pL)} percent`)}"><i style="flex-grow:${pL};background:${lc}"><span>${pct(pL)}%</span></i><i style="flex-grow:${1 - pL};background:${rc}"><span>${pct(1 - pL)}%</span></i></div>
    <div class="pred-legend"><span><i style="background:${lc}"></i>${esc(L.name)}</span><span><i style="background:${rc}"></i>${esc(R.name)}</span></div>
    <div class="tiles pred-tiles"><div class="tile"><b class="num">${P.total.toFixed(1)}</b><span>Projected goals${P.M.total != null ? ` · line ${bbFix(P.M.total)}` : ''}</span></div>
      <div class="tile"><b class="num">${pct(P.ou.over)}%</b><span>Over ${P.ou.line}</span></div>
      <div class="tile"><b class="num">${pct(P.ot)}%</b><span>Goes to overtime</span></div>
      <div class="tile"><b class="num">${pct(P.pl[fav])}%</b><span>${esc(e[fav].abbr || e[fav].name)} −1.5 (wins by 2+)</span></div>
      <div class="tile"><b class="num">${pct(1 - P.pl[fav])}%</b><span>${esc(e[dog].abbr || e[dog].name)} +1.5</span></div>
      <div class="tile"><b class="num">${P.market != null ? pct(P.market) + '%' : '–'}</b><span>${esc(e.home.abbr || e.home.name)} in the market</span></div>
      <div class="tile"><b class="num">${pct(P.pModel)}%</b><span>${esc(e.home.abbr || e.home.name)} on goals alone</span></div>
      <div class="tile"><b class="num">${pct(P.reg.home)}–${pct(P.reg.draw)}–${pct(P.reg.away)}</b><span>Regulation: home, tie, away</span></div></div>
    <div class="sub-h"><h5>Most likely scores after 60 minutes</h5></div><div class="tiles">${likely}</div>
    <div class="sub-h"><h5>Why</h5></div><ul class="why">${hkReasons(e, P).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    ${hkSeasonCompare(v)}
    <p class="srcnote">Starting goalies are usually confirmed at the morning skate; a backup in net can swing an NHL game by several points. The model doesn't know the starter yet, but the market adjusts quickly once it's announced.</p>${RG}`;
}

/* ---------- team pages ---------- */
function openHkTeam(id, lgKey, slug){
  if (!id) return;
  const l = HKL[lgKey] || HKL.nhl;
  pushView({ type: 'hkteam', id: String(id), lg: l.key, slug: slug || '', tab: 'roster' });
  const v = S.stack[S.stack.length - 1], re = () => S.stack.includes(v) && renderSheet();
  hkStandings(l.key).then(re);
  if (l.src === 'espn') {
    Promise.allSettled([cj(`${HKE}/${l.path}/teams/${id}`), cj(`${HKE}/${l.path}/teams/${id}/roster`), cj(`${HKE}/${l.path}/teams/${id}/schedule`), cj(`${HKE}/${l.path}/teams/${id}/statistics`)]).then(([t, r, s, st]) => {
      v.team = val(t)?.team; v.roster = val(r); v.sched = val(s); v.stats = val(st); if (!v.team) v.err = true; else if (v.team.id && v.team.id !== v.id && /^\d+$/.test(v.team.id)) v.id = String(v.team.id); re() });
  } else {
    const go = () => getJSON(`/api/hk/team?id=${id}&slug=${encodeURIComponent(v.slug)}`).then(d => { v.fs = d; for (const x of [...d.results, ...d.fixtures]) if (!S.hk.games.has(x.id)) S.hk.games.set(x.id, hkNormFs(x)); re() }).catch(() => { v.err = true; re() });
    if (v.slug) go(); else hkStandings(l.key).then(() => { const r = hkRow(l.key, String(id)); if (r?.slug) { v.slug = r.slug; go() } else { v.err = true; re() } });
  }
}
function hkTeamHero(v, back){
  const l = HKL[v.lg], espn = l.src === 'espn', t = espn ? v.team : v.fs, row = hkRow(v.lg, v.id);
  const name = espn ? t?.displayName : t?.name, logo = espn ? t?.logos?.[0]?.href : t?.logo || S.hk.logos?.[v.id];
  const col = espn && hex(t?.color) && lum(hex(t.color)) > .03 ? hex(t.color) : '#' + fmColor(name || v.id); v.color = col;
  const favId = `hk-${v.lg}-${v.id}`, isFavd = S.fav.some(f => f.id === favId);
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead">${logo ? `<img class="crest" src="${esc(logo)}" alt="">` : ''}<div><h3>${esc(name || 'Loading…')}</h3>
    <p>${row ? `<span>${row.w}-${row.l}-${row.otl}</span><span>${row.pts} pts</span>` : espn && t?.record?.items?.[0]?.summary ? `<span>${esc(t.record.items[0].summary)}</span>` : ''}${espn && t?.standingSummary ? `<span>${esc(t.standingSummary)}</span>` : row?.group ? `<span>${esc(row.group)}</span>` : ''}<span>${esc(l.name)}</span>${!espn && t?.venue ? `<span>${esc(t.venue)}${t.city ? ', ' + esc(t.city) : ''}</span>` : ''}</p>
    ${name ? `<button class="favbtn" data-hkact="fav" aria-pressed="${isFavd}">${isFavd ? '★ Following' : '☆ Follow'}</button>` : ''}</div></div>
    ${row?.gp ? `<div class="tiles"><div class="tile"><b class="num">${row.pts}</b><span>Points (${row.ppct.toFixed(3).replace(/^0/, '')})</span></div><div class="tile"><b class="num">${(row.gf / row.gp).toFixed(2)}</b><span>Goals for a game</span></div><div class="tile"><b class="num">${(row.ga / row.gp).toFixed(2)}</b><span>Against a game</span></div><div class="tile"><b class="num">${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</b><span>Goal difference</span></div></div>` : ''}</div>`;
}
function hkTeamPane(v){
  const l = HKL[v.lg], espn = l.src === 'espn';
  if (v.err) return `<div class="note">Couldn't load this team.</div>`;
  if (espn ? !v.team : !v.fs) return hkLoading();
  if (v.tab === 'roster') {
    if (espn) {
      const raw = v.roster?.athletes || [], groups = raw.length && raw[0].items ? raw.map(g => ({ name: g.position || g.name || '', list: g.items || [] })) : [{ name: '', list: raw }];
      if (!groups.some(g => g.list.length)) return `<div class="note">No roster published.</div>`;
      return groups.map((g, i) => `<div class="sub-h"${i ? '' : ' style="margin-top:0"'}><h5>${esc(g.name ? g.name.replace(/^\w/, c => c.toUpperCase()) : 'Roster')}</h5><small>${g.list.length}</small></div>` + g.list.map(a => `<button class="prow ph${a.injuries?.length ? ' out' : ''}" data-hkplayer="${esc(a.id)}" data-hkl="${esc(v.lg)}">
        <b>${esc(a.jersey ?? '–')}</b><img class="face-s espn-shot" src="${esc(a.headshot?.href || hkShot(a.id, l.path))}" alt="" loading="lazy" ${hkFaceErr}>
        <span class="nm"><span>${esc(a.displayName)}</span> ${a.injuries?.length ? `<span class="stat-badge injured">${esc(a.injuries[0].status || 'Injured')}</span>` : ''}<small>${esc([a.position?.abbreviation, a.age ? a.age + ' yrs' : '', a.displayHeight, a.displayWeight, a.hand?.abbreviation ? 'Shoots ' + a.hand.abbreviation : '', a.birthPlace?.country].filter(Boolean).join(' · '))}</small></span>
        <span class="st2">${a.experience?.years != null ? (a.experience.years ? a.experience.years + ' yr' + (a.experience.years > 1 ? 's' : '') : 'Rookie') : ''}</span></button>`).join('')).join('');
    }
    const list = v.fs.roster || []; if (!list.length) return `<div class="note">No roster published.</div>`;
    const gs = [...new Set(list.map(a => a.group || ''))];
    return gs.map((g, i) => `<div class="sub-h"${i ? '' : ' style="margin-top:0"'}><h5>${esc(g || 'Roster')}</h5><small>${list.filter(a => (a.group || '') === g).length}</small></div>` + list.filter(a => (a.group || '') === g).map(a => `<button class="prow ph${a.out ? ' out' : ''}" data-hkfsplayer="${esc(a.id)}" data-hkslug="${esc(a.slug)}" data-hkl="${esc(v.lg)}">
      <b>${esc(a.jersey || '–')}</b><img class="face-s" src="${SIL}" alt="" loading="lazy"><span class="nm"><span>${esc(a.name)}</span> ${a.out ? `<span class="stat-badge injured">${esc(a.out)}</span>` : ''}<small>${esc([a.country, a.age ? a.age + ' yrs' : ''].filter(Boolean).join(' · '))}</small></span><span class="st2"></span></button>`).join('')).join('')
      + `<p class="srcnote">Roster from Flashscore. Tap a player for bio, season stats and recent games.</p>`;
  }
  if (v.tab === 'sched') {
    if (espn) { const evs = (v.sched?.events || []).map(ev => ({ ev, c: ev.competitions?.[0] })).filter(x => x.c); if (!evs.length) return `<div class="note">No schedule published.</div>`;
      return `<div class="fbsched">${evs.map(({ ev, c }) => { const me = c.competitors.find(x => String(x.team?.id) === v.id), op = c.competitors.find(x => x !== me) || {}; const st = c.status?.type || {};
        const sc = x => (typeof x?.score === 'object' ? x.score?.displayValue : x?.score) ?? ''; const res = st.completed ? (me?.winner ? 'W' : /OT|SO/.test(st.shortDetail || '') ? 'OTL' : 'L') : ''; const d = new Date(ev.date);
        return `<div class="fx"><span class="d">${esc(fmtDate(d))}</span><span class="vs"><small>${me?.homeAway === 'home' ? 'vs' : '@'}</small><img src="${esc(op.team?.logos?.[0]?.href || op.team?.logo || '')}" alt=""><span><button class="linkbtn" data-hkteam="${esc(op.team?.id)}" data-hkl="${esc(v.lg)}">${esc(op.team?.displayName || 'TBD')}</button></span></span>
          <span class="r num">${st.completed ? `${esc(sc(me))}–${esc(sc(op))}${/OT|SO/.test(st.shortDetail || '') ? ' <small>' + esc(st.shortDetail.replace(/^Final\/?/, '')) + '</small>' : ''} <span class="res ${res === 'W' ? 'W' : res === 'OTL' ? 'D' : 'L'}">${res}</span>` : esc(d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span></div>` }).join('')}</div>` }
    const all = [...(v.fs.fixtures || []).slice(0, 12).reverse(), ...(v.fs.results || [])].map(x => x.date ? x : hkNormFs(x));
    if (!all.length) return `<div class="note">No games found.</div>`;
    return `<div class="fbsched">${all.map(e => { const home = e.home.id === v.id, me = home ? e.home : e.away, op = home ? e.away : e.home; const res = e.state === 'post' ? (+me.score > +op.score ? 'W' : e.ot ? 'OTL' : 'L') : '';
      return `<button class="fx bb-fx" data-hkgame="${esc(e.id)}"><span class="d">${esc(fmtDate(e.date))}<br>${esc(e.lgName || hkName(e.lg) || '')}</span><span class="vs"><small>${home ? 'vs' : '@'}</small><img src="${esc(op.logo)}" alt="" ${hkErr}><span>${esc(op.full || op.name)}</span></span>
        <span class="r num">${e.state === 'post' ? `${esc(me.score)}–${esc(op.score)} <span class="res ${res === 'W' ? 'W' : res === 'OTL' ? 'D' : 'L'}">${res}</span>` : esc(e.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span></button>` }).join('')}</div>`;
  }
  if (v.tab === 'stats') {
    const cats = v.stats?.results?.stats?.categories || v.stats?.statistics?.splits?.categories || v.stats?.splits?.categories || [];
    const row = hkRow(v.lg, v.id);
    let h = cats.map(c => `<div class="grp-name" style="font-size:13px">${esc(c.displayName || c.name)}</div><div class="bb-tstats">${(c.stats || []).filter(s => s.displayValue != null).map(s => `<div><span>${esc(s.displayName || s.name)}</span><b class="num">${esc(s.displayValue)}</b>${s.rankDisplayValue ? `<small>${esc(s.rankDisplayValue)}</small>` : ''}</div>`).join('')}</div>`).join('');
    if (!espn && v.fs?.results?.length) { const mine = v.fs.results.map(x => x.date ? x : hkNormFs(x)).map(e => { const home = e.home.id === v.id, me = home ? e.home : e.away, op = home ? e.away : e.home; return { home, f: +me.score, a: +op.score, ot: e.ot } }).filter(x => !isNaN(x.f) && !isNaN(x.a));
      const avg = (arr, f) => arr.length ? (arr.reduce((s, x) => s + f(x), 0) / arr.length).toFixed(2) : '–';
      h += `<div class="sub-h" style="margin-top:0"><h5>From the last ${mine.length} games</h5><small>all competitions</small></div><div class="bb-tstats">${[['Record', `${mine.filter(x => x.f > x.a).length}-${mine.filter(x => x.f < x.a && !x.ot).length}-${mine.filter(x => x.f < x.a && x.ot).length}`], ['Goals for a game', avg(mine, x => x.f)], ['Against a game', avg(mine, x => x.a)], ['Average total', avg(mine, x => x.f + x.a)],
        ['Home', `${mine.filter(x => x.home && x.f > x.a).length}-${mine.filter(x => x.home && x.f < x.a).length}`], ['Away', `${mine.filter(x => !x.home && x.f > x.a).length}-${mine.filter(x => !x.home && x.f < x.a).length}`], ['Went to OT/SO', mine.filter(x => x.ot).length], ['Shutouts', mine.filter(x => !x.a).length]].map(([k, x]) => `<div><span>${esc(k)}</span><b class="num">${esc(x)}</b></div>`).join('')}</div>` }
    if (row) h += `<div class="sub-h"><h5>League table</h5></div><div class="bb-tstats"><div><span>Position</span><b class="num">${row.rank || '–'}</b></div><div><span>Points %</span><b class="num">${row.ppct.toFixed(3).replace(/^0/, '')}</b></div><div><span>Goals for</span><b class="num">${row.gf}</b></div><div><span>Goals against</span><b class="num">${row.ga}</b></div>${row.rw != null ? `<div><span>Regulation wins</span><b class="num">${row.rw}</b></div>` : ''}</div>`;
    return h || `<div class="note">No team stats yet.</div>`;
  }
  if (v.tab === 'stand') return hkStandingsHTML(v.lg, [v.id]);
  return '';
}

/* ---------- player pages ---------- */
// ESPN (NHL, college): bio, every stat ESPN keeps by season, game log and splits
function openHkPlayer(id, lgKey){
  const l = HKL[lgKey] || HKL.nhl; if (!id) return;
  pushView({ type: 'hkplayer', id: String(id), lg: l.key, tab: 'stats' });
  const v = S.stack[S.stack.length - 1], re = () => S.stack.includes(v) && renderSheet();
  Promise.allSettled([cj(`${HKW}/${l.path}/athletes/${id}`), cj(`${HKW}/${l.path}/athletes/${id}/stats`), cj(`${HKW}/${l.path}/athletes/${id}/gamelog`), cj(`${HKW}/${l.path}/athletes/${id}/splits`)]).then(([b, s, g, sp]) => {
    v.bio = val(b)?.athlete; v.stats = val(s); v.log = val(g); v.splits = val(sp); if (!v.bio) v.err = true; re() });
}
function hkStatCat(v){ const cats = v.stats?.categories || []; return cats.find(c => c.names?.includes('goals') || c.names?.includes('goalsAgainstAverage') || c.names?.includes('savePct')) || cats[0] }
function hkPlayerHero(v, back){
  const a = v.bio, t = a?.team, l = HKL[v.lg];
  const col = hex(t?.color) && lum(hex(t.color)) > .03 ? hex(t.color) : '#3D6FD9'; v.color = col;
  const goalie = /^G/.test(a?.position?.abbreviation || '');
  const cats = v.stats?.categories || [], seasonOf = c => c?.statistics?.[c.statistics.length - 1];
  const sv = names => { for (const c of cats) { const s = seasonOf(c); for (const n of names) { const i = c.names?.indexOf(n); if (i >= 0 && s?.stats?.[i] != null) return s.stats[i] } } return null };
  const tiles = (goalie ? [[['wins'], 'Wins'], [['goalsAgainstAverage', 'avgGoalsAgainst'], 'GAA'], [['savePct', 'savePercentage'], 'Save %'], [['shutouts'], 'Shutouts']]
    : [[['goals'], 'Goals'], [['assists'], 'Assists'], [['points'], 'Points'], [['plusMinus'], '+/-']]).map(([ns, lbl]) => { const x = sv(ns); return x == null ? '' : `<div class="tile"><b class="num">${esc(x)}</b><span>${lbl}</span></div>` }).join('');
  const season = seasonOf(hkStatCat(v))?.season?.displayName || '';
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(a?.headshot?.href || hkShot(v.id, l.path))}" alt="" ${hkFaceErr}><div><h3>${esc(a?.displayName || 'Loading…')}</h3>
    ${a ? `<p>${a.displayJersey ? `<span class="num">${esc(a.displayJersey)}</span>` : ''}<span>${esc(a.position?.displayName || '')}</span>${t ? `<span><img src="${esc(t.logos?.[0]?.href || '')}" alt=""> <button class="linkbtn" data-hkteam="${esc(t.id)}" data-hkl="${esc(v.lg)}">${esc(t.displayName)}</button></span>` : ''}</p>
      <p class="bb-bio">${[a.age ? a.age + ' yrs' : '', a.displayHeight, a.displayWeight, a.hand?.displayValue ? (goalie ? 'Catches ' : 'Shoots ') + a.hand.displayValue.toLowerCase() : '', a.displayBirthPlace, a.displayDraft ? 'Draft: ' + a.displayDraft : '', a.displayExperience].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</p>
      ${a.injuries?.length ? `<p><span class="stat-badge injured">${esc(a.injuries[0].status || 'Injured')}${a.injuries[0].details?.type ? ' · ' + esc(a.injuries[0].details.type) : ''}</span></p>` : ''}` : ''}</div></div>
    ${tiles ? `<div class="tiles">${tiles}</div><p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(season)}</p>` : ''}</div>`;
}
function hkPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  if (!v.bio) return hkLoading();
  if (v.tab === 'stats') {
    const cats = (v.stats?.categories || []).filter(c => c.statistics?.length);
    if (!cats.length) return `<div class="note">No stats for this player yet.</div>`;
    return cats.map(c => `<div class="sub-h"><h5>${esc(c.displayName || c.name)}</h5></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left">Season</th>${(c.labels || []).map((x, i) => `<th title="${esc(c.displayNames?.[i] || c.descriptions?.[i] || '')}">${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${c.statistics.slice().reverse().map(s => `<tr><td class="t">${esc(s.season?.displayName || '')} <small>${esc((s.teamSlug || '').split('-').pop())}</small></td>${(s.stats || []).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}
      ${c.totals?.length ? `<tr class="tot"><td class="t">Career</td>${c.totals.map(x => `<td>${esc(x)}</td>`).join('')}</tr>` : ''}</tbody></table></div>`).join('')
      + `<p class="srcnote">Every season ESPN keeps for this player. Hover a column for its meaning.</p>`;
  }
  if (v.tab === 'log') {
    const g = v.log; if (!g?.seasonTypes?.length) return `<div class="note">No games logged this season.</div>`;
    const labels = g.labels || [];
    return g.seasonTypes.map(st => { const evs = (st.categories || []).filter(c => c.type === 'event' || c.events).flatMap(c => c.events || []); if (!evs.length) return '';
      return `<div class="sub-h"><h5>${esc(st.displayName)}</h5><small>${evs.length} games</small></div><div class="tbl-wrap"><table class="ctable bb-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opp</th><th>Res</th>${labels.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
        ${evs.map(x => { const m = g.events?.[x.eventId] || {}; return `<tr><td class="t">${esc(fmtDate(m.gameDate))}</td><td class="hk-l"><img src="${esc(m.opponent?.logo || '')}" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:-3px">${esc(m.atVs || '')} ${esc(m.opponent?.abbreviation || '')}</td><td><span class="res ${m.gameResult === 'W' ? 'W' : m.gameResult === 'L' ? 'L' : 'D'}">${esc(m.gameResult || '')}</span> ${esc(m.score || '')}</td>${(x.stats || []).map(s => `<td>${esc(s)}</td>`).join('')}</tr>` }).join('')}</tbody></table></div>` }).join('') || `<div class="note">No games logged this season.</div>`;
  }
  if (v.tab === 'splits') {
    const s = v.splits; if (!s?.splitCategories?.length) return `<div class="note">No splits yet.</div>`;
    return `<p class="srcnote" style="margin-top:0">${esc(s.displayName || '')}</p>` + s.splitCategories.map(c => `<div class="sub-h"><h5>${esc(c.displayName === 'split' ? 'Overview' : c.displayName)}</h5></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left"></th>${(s.labels || []).map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
      ${(c.splits || []).map(r => `<tr><td class="t">${esc(r.displayName)}</td>${(r.stats || []).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  }
  return '';
}
// the NHL's official player page: featured season, career totals by league, last 5 games and the full game log
function openHkNhlPlayer(id){
  if (!id) return;
  pushView({ type: 'hknhlp', id: String(id), lg: 'nhl', tab: 'stats' });
  const v = S.stack[S.stack.length - 1], re = () => S.stack.includes(v) && renderSheet();
  Promise.allSettled([getJSON(hkNhl(`web/v1/player/${id}/landing`)), getJSON(hkNhl(`web/v1/player/${id}/game-log/now`))]).then(([a, g]) => { v.p = val(a); v.log = val(g); if (!v.p) v.err = true; re() });
}
const hkTxt = x => x?.default ?? x ?? '';
function hkNhlHero(v, back){
  const p = v.p, col = '#' + fmColor(p?.currentTeamAbbrev || String(v.id)); v.color = col;
  const goalie = p?.position === 'G', f = p?.featuredStats?.regularSeason?.subSeason;
  const tiles = !f ? '' : (goalie ? [['wins', 'Wins'], ['goalsAgainstAvg', 'GAA', 2], ['savePctg', 'Save %', 3], ['shutouts', 'Shutouts']] : [['goals', 'Goals'], ['assists', 'Assists'], ['points', 'Points'], ['plusMinus', '+/-']])
    .map(([k, l, d]) => `<div class="tile"><b class="num">${f[k] == null ? '–' : d ? (+f[k]).toFixed(d).replace(/^0\./, '.') : f[k]}</b><span>${l}</span></div>`).join('');
  const ht = p?.heightInInches ? `${Math.floor(p.heightInInches / 12)}′${p.heightInInches % 12}″` : '';
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(p?.headshot || SIL)}" alt="" ${hkFaceErr}><div><h3>${esc(p ? `${hkTxt(p.firstName)} ${hkTxt(p.lastName)}` : 'Loading…')}</h3>
    ${p ? `<p>${p.sweaterNumber ? `<span class="num">#${esc(p.sweaterNumber)}</span>` : ''}<span>${esc({ C: 'Centre', L: 'Left wing', R: 'Right wing', D: 'Defence', G: 'Goalie' }[p.position] || p.position || '')}</span>${p.teamLogo ? `<span><img src="${esc(p.teamLogo)}" alt=""> ${esc(hkTxt(p.fullTeamName) || p.currentTeamAbbrev || '')}</span>` : ''}</p>
      <p class="bb-bio">${[p.birthDate ? 'Born ' + fmtDate(p.birthDate + 'T12:00:00', { day: 'numeric', month: 'short', year: 'numeric' }) : '', [hkTxt(p.birthCity), p.birthCountry].filter(Boolean).join(', '), ht, p.weightInPounds ? p.weightInPounds + ' lb' : '', p.shootsCatches ? (goalie ? 'Catches ' : 'Shoots ') + p.shootsCatches : '', p.draftDetails ? `Draft ${p.draftDetails.year} · round ${p.draftDetails.round}, ${bbOrd(p.draftDetails.overallPick)} overall (${p.draftDetails.teamAbbrev})` : 'Undrafted'].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</p>` : ''}</div></div>
    ${tiles ? `<div class="tiles">${tiles}</div><p style="margin:8px 0 0;font-size:11.5px;color:var(--muted)">${esc(String(p.featuredStats.season || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1–$3'))} regular season · official NHL stats</p>` : ''}</div>`;
}
function hkNhlPane(v){
  if (v.err) return `<div class="note">Couldn't load this player. The NHL's player pages come through the local server.</div>`;
  const p = v.p; if (!p) return hkLoading();
  const goalie = p.position === 'G';
  const sCols = goalie ? [['gamesPlayed', 'GP'], ['wins', 'W'], ['losses', 'L'], ['otLosses', 'OTL'], ['goalsAgainstAvg', 'GAA', 2], ['savePctg', 'SV%', 3], ['shutouts', 'SO'], ['goalsAgainst', 'GA'], ['shotsAgainst', 'SA']]
    : [['gamesPlayed', 'GP'], ['goals', 'G'], ['assists', 'A'], ['points', 'PTS'], ['plusMinus', '+/-'], ['pim', 'PIM'], ['powerPlayGoals', 'PPG'], ['powerPlayPoints', 'PPP'], ['shorthandedGoals', 'SHG'], ['gameWinningGoals', 'GWG'], ['otGoals', 'OTG'], ['shots', 'S'], ['shootingPctg', 'S%', 'p'], ['avgToi', 'TOI'], ['faceoffWinningPctg', 'FO%', 'p']];
  const cell = (x, k, d) => { const n = x?.[k]; return n == null || n === '' ? '–' : d === 'p' ? (+n * 100).toFixed(1) : d ? (+n).toFixed(d).replace(/^0\./, '.') : esc(n) };
  if (v.tab === 'stats') {
    const f = p.featuredStats?.regularSeason, c = p.careerTotals;
    let h = '';
    if (f?.subSeason || c?.regularSeason) h += `<div class="sub-h" style="margin-top:0"><h5>Season and career</h5><small>NHL</small></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left"></th>${sCols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
      ${[['This season', f?.subSeason], ['NHL career', c?.regularSeason], ['Playoffs career', c?.playoffs]].filter(x => x[1]).map(([n, x]) => `<tr><td class="t">${n}</td>${sCols.map(([k, , d]) => `<td>${cell(x, k, d)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const seasons = (p.seasonTotals || []).filter(s => s.gameTypeId === 2).slice().reverse();
    if (seasons.length) h += `<div class="sub-h"><h5>Every season</h5><small>all leagues, regular season</small></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team</th>${sCols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
      ${seasons.map(s => `<tr class="${s.leagueAbbrev === 'NHL' ? '' : 'hk-minor'}"><td class="t">${esc(String(s.season).replace(/^(\d{4})\d{2}(\d{2})$/, '$1–$2'))}</td><td class="hk-l">${esc(hkTxt(s.teamName))} <small>${esc(s.leagueAbbrev || '')}</small></td>${sCols.map(([k, , d]) => `<td>${cell(s, k, d)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (p.last5Games?.length) h += `<div class="sub-h"><h5>Last 5 games</h5></div><div class="tbl-wrap"><table class="ctable bb-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opp</th>${goalie ? '<th>Dec</th><th>SA</th><th>GA</th><th>SV%</th><th>TOI</th>' : '<th>G</th><th>A</th><th>PTS</th><th>+/-</th><th>S</th><th>PIM</th><th>TOI</th>'}</tr></thead><tbody>
      ${p.last5Games.map(g => `<tr><td class="t">${esc(fmtDate(g.gameDate + 'T12:00:00'))}</td><td class="hk-l">${g.homeRoadFlag === 'R' ? '@' : 'vs'} ${esc(g.opponentAbbrev)}</td>${goalie ? `<td>${esc(g.decision || '')}</td><td>${esc(g.shotsAgainst ?? '')}</td><td>${esc(g.goalsAgainst ?? '')}</td><td>${g.savePctg != null ? (+g.savePctg).toFixed(3).replace(/^0/, '') : ''}</td><td>${esc(g.toi || '')}</td>` : `<td>${esc(g.goals)}</td><td>${esc(g.assists)}</td><td><b>${esc(g.points)}</b></td><td>${esc(g.plusMinus)}</td><td>${esc(g.shots ?? '')}</td><td>${esc(g.pim ?? '')}</td><td>${esc(g.toi || '')}</td>`}</tr>`).join('')}</tbody></table></div>`;
    return h || `<div class="note">No NHL stats yet.</div>`;
  }
  if (v.tab === 'log') {
    const L = v.log?.gameLog || []; if (!L.length) return `<div class="note">No games this season yet.</div>`;
    const tot = k => L.reduce((s, g) => s + (+g[k] || 0), 0);
    return `<div class="tbl-wrap"><table class="ctable bb-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opp</th>${goalie ? '<th>Dec</th><th>SA</th><th>GA</th><th>SV%</th><th>TOI</th>' : '<th>G</th><th>A</th><th>PTS</th><th>+/-</th><th>PPG</th><th>S</th><th>Shifts</th><th>PIM</th><th>TOI</th>'}</tr></thead><tbody>
      ${L.map(g => `<tr><td class="t">${esc(fmtDate(g.gameDate + 'T12:00:00'))}</td><td class="hk-l">${g.homeRoadFlag === 'R' ? '@' : 'vs'} ${esc(g.opponentAbbrev)}</td>${goalie ? `<td>${esc(g.decision || '')}</td><td>${esc(g.shotsAgainst ?? '')}</td><td>${esc(g.goalsAgainst ?? '')}</td><td>${g.savePctg != null ? (+g.savePctg).toFixed(3).replace(/^0/, '') : ''}</td><td>${esc(g.toi || '')}</td>`
        : `<td>${esc(g.goals)}</td><td>${esc(g.assists)}</td><td><b>${esc(g.points)}</b></td><td>${esc(g.plusMinus)}</td><td>${esc(g.powerPlayGoals ?? '')}</td><td>${esc(g.shots ?? '')}</td><td>${esc(g.shifts ?? '')}</td><td>${esc(g.pim ?? '')}</td><td>${esc(g.toi || '')}</td>`}</tr>`).join('')}
      ${goalie ? '' : `<tr class="tot"><td class="t" colspan="2">${L.length} games</td><td>${tot('goals')}</td><td>${tot('assists')}</td><td>${tot('points')}</td><td>${tot('plusMinus')}</td><td>${tot('powerPlayGoals')}</td><td>${tot('shots')}</td><td>${tot('shifts')}</td><td>${tot('pim')}</td><td></td></tr>`}</tbody></table></div><p class="srcnote">This season's game log from the NHL.</p>`;
  }
  return '';
}
// Flashscore player page (other leagues)
function openHkFsPlayer(id, slug, lgKey){
  if (!id || !slug) return;
  pushView({ type: 'hkfsplayer', id: String(id), slug, lg: lgKey || 'khl', tab: 'stats' });
  const v = S.stack[S.stack.length - 1];
  getJSON(`/api/hk/player?id=${id}&slug=${encodeURIComponent(slug)}`).then(d => { v.p = d; S.stack.includes(v) && renderSheet() }).catch(() => { v.err = true; S.stack.includes(v) && renderSheet() });
}
const HK_FS_KEYS = [['matches_played', 'GP'], ['goals', 'G'], ['assists', 'A'], ['points', 'PTS'], ['plus_minus', '+/-'], ['penalty_minutes', 'PIM'], ['yellow_cards', 'PIM'], ['saves', 'SV'], ['goals_against', 'GA'], ['save_percentage', 'SV%'], ['minutes_played', 'MIN']];
function hkFsPlayerHero(v, back){
  const p = v.p, col = '#' + fmColor(p?.teamName || v.slug); v.color = col;
  return `<div class="hero solo" style="--tc:${col}">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(p?.photo || SIL)}" alt="" ${hkFaceErr}><div><h3>${esc(p?.name || 'Loading…')}</h3>
    ${p ? `<p>${p.position ? `<span>${esc(p.position)}</span>` : ''}${p.teamId ? `<span><button class="linkbtn" data-hkteam="${esc(p.teamId)}" data-hkslug="${esc(p.teamSlug)}" data-hkl="${esc(v.lg)}">${esc(p.teamName || p.teamSlug)}</button></span>` : ''}</p>
      <p class="bb-bio">${[p.age ? p.age + ' yrs' : '', p.born ? 'Born ' + p.born : '', p.height, p.weight, p.flag ? p.flag.toUpperCase() : ''].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</p>` : ''}</div></div></div>`;
}
function hkFsPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  const p = v.p; if (!p) return hkLoading();
  if (v.tab === 'stats') {
    const rows = p.career || []; if (!rows.length) return `<div class="note">No stats published for this player yet.</div>`;
    const keys = HK_FS_KEYS.filter(([k]) => rows.some(r => r.stats?.[k] != null && r.stats[k] !== ''));
    const extra = [...new Set(rows.flatMap(r => Object.keys(r.stats || {})))].filter(k => !HK_FS_KEYS.some(([x]) => x === k) && rows.some(r => r.stats[k] !== '' && r.stats[k] != null && !isNaN(+r.stats[k]))).slice(0, 6).map(k => [k, k.replace(/_/g, ' ')]);
    const cols = [...keys, ...extra], groups = {}; for (const r of rows) (groups[r.type] ||= []).push(r);
    const title = { league: 'League seasons', 'international-cups': 'International cups', 'national-team': 'National team' };
    return Object.entries(groups).map(([k, list]) => `<div class="sub-h"><h5>${esc(title[k] || k)}</h5></div><div class="tbl-wrap"><table class="ctable bb-car"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team · competition</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>
      ${list.map(r => `<tr><td class="t">${esc(r.season)}</td><td class="hk-l">${r.logo ? `<img src="${esc(r.logo)}" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:-3px">` : ''}${esc(r.team || '')} <small>${esc(r.comp || '')}</small></td>${cols.map(([c]) => `<td>${esc(r.stats?.[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  }
  if (v.tab === 'log') {
    if (!p.last?.length) return `<div class="note">No recent games.</div>`;
    const ks = [...new Set(p.last.flatMap(m => Object.keys(m.stats || {})))].slice(0, 7);
    return `<div class="tbl-wrap"><table class="ctable bb-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Game</th>${ks.map(k => `<th>${esc(k.replace(/-/g, ' '))}</th>`).join('')}</tr></thead><tbody>
      ${p.last.map(m => `<tr><td class="t">${esc(m.date || '')}</td><td class="hk-l">${esc(m.home)} ${esc(m.hs ?? '')}–${esc(m.as ?? '')} ${esc(m.away)}<small>${esc(m.lg)}</small></td>${m.absent ? `<td colspan="${ks.length}" class="dnp-r">${esc(m.absent)}</td>` : ks.map(k => `<td>${esc(m.stats[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  return '';
}

/* ---------- league sheet: standings, leaders (NHL), results, fixtures, Stanley Cup odds ---------- */
function openHkLeague(key){
  S.sel = null; S.stack = [{ type: 'hkleague', id: key, tab: 'stand' }];
  renderSheet(); $('sheet').classList.add('open');
  const v = S.stack[0], re = () => S.stack.includes(v) && renderSheet(), l = HKL[key];
  hkStandings(key).then(re);
  if (l.src === 'fs') hkLeague(key).then(d => { v.L = d; re() }).catch(() => { v.err = true; re() });
  else { const days = []; for (let i = -7; i <= 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(isoDay(d).replace(/-/g, '')) }
    Promise.allSettled(days.map(d => cj(`${HKE}/${l.path}/scoreboard?dates=${d}&limit=300${l.college ? '&groups=50' : ''}`))).then(rs => { const evs = rs.flatMap(r => val(r)?.events || []).map(ev => hkNormEspn(ev, l)).filter(Boolean);
      for (const e of evs) if (!S.hk.games.has(e.id)) S.hk.games.set(e.id, e); v.L = { results: evs.filter(e => e.state === 'post').sort((a, b) => b.date - a.date), fixtures: evs.filter(e => e.state !== 'post').sort((a, b) => a.date - b.date) }; re() }) }
  if (key === 'nhl') {
    Promise.allSettled([getJSON(hkNhl('web/v1/skater-stats-leaders/current', 'categories=points,goals,assists,plusMinus,goalsPp,toi,faceoffLeaders,penaltyMins&limit=5')), getJSON(hkNhl('web/v1/goalie-stats-leaders/current', 'categories=wins,savePctg,goalsAgainstAverage,shutouts&limit=5'))])
      .then(([s, g]) => { v.ldr = { s: val(s), g: val(g) }; re() });
    getJSON(`/api/kalshi/events?series_ticker=KXNHL&status=open&with_nested_markets=true&limit=5`).then(d => { v.fut = d.events || []; re() }).catch(() => { v.fut = [] });
  }
}
const HK_LDR = { points: 'Points', goals: 'Goals', assists: 'Assists', plusMinus: 'Plus-minus', goalsPp: 'Power-play goals', toi: 'Time on ice a game', faceoffLeaders: 'Faceoff %', penaltyMins: 'Penalty minutes', wins: 'Wins', savePctg: 'Save %', goalsAgainstAverage: 'Goals-against average', shutouts: 'Shutouts' };
function hkLeagueSheet(v){
  const key = v.id, l = HKL[key], sheet = $('sheet');
  const back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  const tabs = [['stand', 'Standings'], ...(key === 'nhl' ? [['ldr', 'Leaders'], ['fut', 'Stanley Cup odds']] : []), ['res', 'Results'], ['fix', 'Fixtures']];
  let body;
  if (v.tab === 'stand') body = hkStandingsHTML(key);
  else if (v.tab === 'ldr') { const L = v.ldr; body = !L ? hkLoading(300) : !L.s && !L.g ? `<div class="note">Leaders come from the NHL through the local server, which isn't answering.</div>`
    : `<div class="bs-ldrs">${[...Object.entries(L.s || {}), ...Object.entries(L.g || {})].filter(([k, list]) => HK_LDR[k] && Array.isArray(list) && list.length).map(([k, list]) => `<div><h5>${HK_LDR[k]}</h5><ol>${list.map((p, i) => `<li><button class="ldr-row" data-hknhlp="${esc(p.id)}"><img src="${esc(p.headshot || SIL)}" alt="" ${hkFaceErr}><span>${esc(hkTxt(p.firstName))} ${esc(hkTxt(p.lastName))}<small>${esc(p.teamAbbrev || '')} · ${esc(p.position || '')}</small></span><b class="num">${k === 'toi' ? hkToi(p.value) : k === 'savePctg' ? (+p.value).toFixed(3).replace(/^0/, '') : k === 'faceoffLeaders' ? (+p.value * 100).toFixed(1) + '%' : k === 'goalsAgainstAverage' ? (+p.value).toFixed(2) : esc(p.value)}</b></button></li>`).join('')}</ol></div>`).join('')}</div><p class="srcnote">Official NHL leaders. Open NHL stats in the left menu for full sortable tables.</p>` }
  else if (v.tab === 'fut') { const evs = v.fut; body = !evs ? hkLoading(300) : !evs.length ? `<div class="note">No Stanley Cup market open on Kalshi right now.</div>`
    : evs.map(ev => `<div class="sub-h"><h5>${esc(ev.title || 'Stanley Cup')}</h5><small>Kalshi</small></div><div class="lines">${(ev.markets || []).map(m => ({ m, p: price(m) })).filter(x => x.p > .003).sort((a, b) => b.p - a.p).slice(0, 20).map(({ m, p }) => `<div class="ln"><span><b>${esc(m.yes_sub_title || m.title || '')}</b></span><span class="bar"><i style="width:${Math.max(1, pct(p))}%;background:var(--accent)"></i></span><span class="num pv">${pct(p)}% <small>${american(p)}</small> ${moveTag(p, prev(m))}</span></div>`).join('')}</div>`).join('') + RG }
  else { const list = v.L?.[v.tab === 'res' ? 'results' : 'fixtures']; body = v.err ? `<div class="note">Couldn't load this league.</div>` : !list ? hkLoading() : !list.length ? `<div class="note">${v.tab === 'res' ? 'No results yet this season.' : 'No fixtures published.'}</div>`
    : `<div class="cards">${list.slice(0, 80).map(hkCard).join('')}</div>` }
  S.curTabs = tabs;
  sheet.innerHTML = `<div class="sheet-body"><div class="hero solo" style="--tc:var(--accent)">${topBar(back)}<div class="thead">${hkLogo(key) ? `<img class="crest" src="${esc(hkLogo(key))}" alt="">` : ''}<div><h3>${esc(l.name)}</h3><p><span>${esc(l.area)}</span>${v.L?.season ? `<span>${esc(v.L.season)}</span>` : ''}</p></div></div></div>${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel">${body}</div></div>`;
}

/* ---------- sheet routing ---------- */
function hkRenderSheet(v){
  if (v.type === 'hkleague') return hkLeagueSheet(v);
  const sheet = $('sheet');
  const back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  let hero, tabs, body;
  if (v.type === 'hkgame') { hero = hkHero(v.e, back); tabs = hkGameTabs(v); if (!tabs.some(t => t[0] === v.tab)) v.tab = tabs[0][0]; body = hkPane(v) }
  else if (v.type === 'hkteam') { hero = hkTeamHero(v, back); tabs = [['roster', 'Roster'], ['sched', 'Schedule'], ['stats', 'Team stats'], ['stand', 'Standings']]; body = hkTeamPane(v) }
  else if (v.type === 'hkplayer') { hero = hkPlayerHero(v, back); tabs = [['stats', 'Stats'], ['log', 'Game log'], ['splits', 'Splits']]; body = hkPlayerPane(v) }
  else if (v.type === 'hknhlp') { hero = hkNhlHero(v, back); tabs = [['stats', 'Career'], ['log', 'Game log']]; body = hkNhlPane(v) }
  else { hero = hkFsPlayerHero(v, back); tabs = [['stats', 'Season stats'], ['log', 'Recent games']]; body = hkFsPlayerPane(v) }
  S.curTabs = tabs;
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  sheet.innerHTML = `<div class="sheet-body">${hero}${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel" style="--tc:${esc(v.color || 'var(--accent)')}">${body}</div></div>`;
  sheet.querySelector('.sheet-body').scrollTop = scroll;
}

/* ---------- search ---------- */
let hkSearchSeq = 0;
async function hkSearch(q){
  const box = $('sres'); if (q.trim().length < 2) { hideResults(); return }
  const seq = ++hkSearchSeq;
  const [t, p, f] = await Promise.allSettled([...['team', 'player'].map(ty => cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&type=${ty}&sport=hockey&limit=8`)), getJSON(`/api/hk/search?q=${encodeURIComponent(q)}`)]);
  if (seq !== hkSearchSeq) return;
  const lgOf = x => { const s = x.league || x.defaultLeagueSlug || ''; return HK_LEAGUES.find(l => l.path === s)?.key || 'nhl' };
  const ok = x => HK_LEAGUES.some(l => l.path && l.path === (x.league || x.defaultLeagueSlug || ''));
  const T = (val(t)?.items || []).filter(ok), P = (val(p)?.items || []).filter(ok), F = val(f) || { teams: [], players: [] };
  let h = '';
  if (T.length || F.teams.length) h += `<div class="sr-h">Teams</div>` + T.map(x => `<button class="sr" data-hkteam="${esc(x.id)}" data-hkl="${lgOf(x)}"><img src="${esc(x.logos?.[0]?.href || '')}" alt=""><div><strong>${esc(x.displayName)}</strong><small>${esc(hkName(lgOf(x)))}</small></div></button>`).join('')
    + F.teams.map(x => `<button class="sr" data-hkteam="${esc(x.id)}" data-hkslug="${esc(x.slug)}" data-hkl="khl" data-hkany="1"><img src="${esc(x.img)}" alt=""><div><strong>${esc(x.name)}</strong><small>${esc(x.country)}</small></div></button>`).join('');
  if (P.length || F.players.length) h += `<div class="sr-h">Players</div>` + P.map(x => `<button class="sr" data-hkplayer="${esc(x.id)}" data-hkl="${lgOf(x)}"><img class="face espn-shot" src="${esc(x.headshot?.href || hkShot(x.id, HKL[lgOf(x)].path))}" alt="" ${hkFaceErr}><div><strong>${esc(x.displayName)}</strong><small>${esc(x.teamRelationships?.[0]?.displayName || hkName(lgOf(x)))}</small></div></button>`).join('')
    + F.players.filter(x => !P.some(y => normName(y.displayName) === normName(x.name.split(' ').reverse().join(' ')) || normName(y.displayName) === normName(x.name))).map(x => `<button class="sr" data-hkfsplayer="${esc(x.id)}" data-hkslug="${esc(x.slug)}" data-hkl="khl"><img class="face espn-shot" src="${esc(x.img || SIL)}" alt="" ${hkFaceErr}><div><strong>${esc(x.name)}</strong><small>${esc(x.team || x.country)}</small></div></button>`).join('');
  box.innerHTML = h || `<div class="sr-none">No hockey teams or players match “${esc(q)}”.</div>`; box.hidden = false;
}

/* ---------- hooks into the main app ---------- */
(function hkInstall(){
  const sw = document.querySelector('.sport-sw');
  if (sw && !sw.querySelector('[data-sport="hockey"]')) sw.insertAdjacentHTML('beforeend', `<button role="tab" data-sport="hockey" class="sp-hockey">Hockey</button>`);
  if (!$('hk')) { const sec = document.createElement('section'); sec.id = 'hk'; sec.hidden = true; sec.setAttribute('aria-label', 'Hockey'); const sheet = $('sheet'); sheet.parentNode.insertBefore(sec, sheet) }
  const _render = render;
  render = function(){
    if (S.sport !== 'hockey') { $('hk').hidden = true; return _render.apply(this, arguments) }
    document.querySelectorAll('.sport-sw button').forEach(b => { const on = b.dataset.sport === 'hockey'; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) });
    document.querySelectorAll('main.shell > section').forEach(s => { s.hidden = s.id !== 'hk' });
    document.querySelector('.shell').classList.remove('mk-page');
    renderHockey(); hkTicker();
  };
  const _sheet = renderSheet;
  renderSheet = function(){ const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('hk')) return hkRenderSheet(v); return _sheet.apply(this, arguments) };
  const _search = searchAll;
  searchAll = function(q){ if (S.sport === 'hockey') return hkSearch(q); return _search.apply(this, arguments) };
  const _openLeague = openLeague;
  openLeague = function(){ if (S.sport === 'hockey') return; return _openLeague.apply(this, arguments) };
})();
async function hkOpenTeamByName(name){
  const ab = hkAbbrOf(name), espnAb = HK_ESPN_ABBR[ab] || ab;
  await hkStandings('nhl');
  const row = (S.hk.stand.nhl?.groups || []).flatMap(g => g.rows).find(r => r.full === name || normName(r.full) === normName(name) || (r.abbr && r.abbr === espnAb));
  openHkTeam(row?.id || espnAb.toLowerCase(), 'nhl');
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-hklg],[data-hkview],[data-hkgame],[data-hkteam],[data-hkteamname],[data-hkplayer],[data-hkfsplayer],[data-hknhlp],[data-hkact],[data-hkfilter],[data-hkstat]'); if (!t) return;
  ev.stopPropagation(); hideResults();
  if (t.dataset.hklg) { S.hk.lg = t.dataset.hklg; S.hk.view = 'games'; store.set('fl.hkLg', S.hk.lg); store.set('fl.hkView', 'games'); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.hkview) { S.hk.view = t.dataset.hkview; store.set('fl.hkView', S.hk.view); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.hkfilter) { S.hk.filter = t.dataset.hkfilter; return render() }
  if (t.dataset.hkstat) { S.hk.statTab = t.dataset.hkstat; return renderHkStats() }
  if (t.dataset.hkgame) return openHkGame(t.dataset.hkgame, t.dataset.hktab);
  if (t.dataset.hkteamname) return hkOpenTeamByName(t.dataset.hkteamname);
  if (t.dataset.hkteam) return openHkTeam(t.dataset.hkteam, t.dataset.hkl, t.dataset.hkslug);
  if (t.dataset.hkplayer) return openHkPlayer(t.dataset.hkplayer, t.dataset.hkl);
  if (t.dataset.hkfsplayer) return openHkFsPlayer(t.dataset.hkfsplayer, t.dataset.hkslug, t.dataset.hkl);
  if (t.dataset.hknhlp) return openHkNhlPlayer(t.dataset.hknhlp);
  const a = t.dataset.hkact, v = S.stack[S.stack.length - 1];
  if (a === 'day') { const n = +t.dataset.to; S.hk.off = n ? Math.max(-7, Math.min(7, S.hk.off + n)) : 0; return render() }
  if (a === 'league') return openHkLeague(S.hk.lg);
  if (a === 'nhlleague') return openHkLeague('nhl');
  if (a === 'pos') { S.hk.statPos = t.dataset.to; return renderHkStats() }
  if (a === 'sort') { const tab = S.hk.statTab, cur = S.hk.statSort[tab], k = t.dataset.to; S.hk.statSort[tab] = { k, dir: cur?.k === k ? (cur.dir === 'DESC' ? 'ASC' : 'DESC') : t.dataset.low ? 'ASC' : 'DESC' }; return renderHkStats() }
  if (a === 'period' && v) { v.period = +t.dataset.to; return renderSheet() }
  if (a === 'fav' && v) { const id = `hk-${v.lg}-${v.id}`, espn = HKL[v.lg].src === 'espn';
    const name = espn ? v.team?.displayName : v.fs?.name, logo = espn ? v.team?.logos?.[0]?.href : v.fs?.logo;
    S.fav = S.fav.some(f => f.id === id) ? S.fav.filter(f => f.id !== id) : [...S.fav, { id, tid: v.id, sport: 'hockey', lg: v.lg, slug: v.slug || '', name: name || '', logo: logo || '' }];
    savePrefs(); renderSheet(); hkRail() }
}, true);
PFX.on('hockey', () => S.sport === 'hockey' && S.hk.view === 'picks' && renderHkPicks());
setInterval(() => { if (document.hidden || S.sport !== 'hockey') return;
  const d = S.hk.days[S.hk.off]; if (S.hk.view === 'games' && d?.events.some(e => e.state === 'in' || (e.state === 'pre' && e.date < Date.now() + 10 * 6e4))) { d.at = 0; renderHockey() }
  const v = S.stack[0]; if (v?.type === 'hkgame' && v.e.state === 'in') hkLoadGame(v) }, 30000);
document.head.insertAdjacentHTML('beforeend', `<style>
#hk{min-width:0}
.hk-st th,.hk-st td{white-space:nowrap}
.hk-plays{list-style:none;margin:0 0 6px;padding:0}
.hk-plays li{display:grid;grid-template-columns:62px 20px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
.hk-plays li img{width:20px;height:20px;object-fit:contain}
.hk-plays .clk{color:var(--muted);font-size:11.5px}
.hk-plays .ptx .linkbtn{text-align:left;font-weight:500}
.hk-plays.pen li{font-size:12.5px;color:var(--muted)}.hk-plays.pen .ptx{color:var(--fg)}
.hk-str{font:700 9.5px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.04em;color:var(--accent);margin-left:4px}
.hk-sort{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;white-space:nowrap}
.hk-sort.on{color:var(--accent)}
.hk-stats td.hk-on{font-weight:700;color:var(--fg)}
.hk-stats td.t small{color:var(--muted);font-size:10.5px;margin-left:6px}
.hk-tlogo{width:20px;height:20px;object-fit:contain;vertical-align:-5px;margin-right:6px}
tr.hk-minor td{color:var(--muted)}
td.hk-l{text-align:left!important;white-space:nowrap}td.hk-l small{color:var(--muted);font-size:10.5px;margin-left:4px}
</style>`);
if (S.sport === 'hockey') { S.stack = []; const sh = $('sheet'); if (sh && !sh.querySelector('.sheet-empty')) { sh.innerHTML = emptySheet(); sh.classList.remove('open') } setTimeout(render, 0) }
