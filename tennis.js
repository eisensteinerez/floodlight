/* Floodlight · tennis
   Every level of the game from Flashscore through the local server (/api/tn/…, see tennis.py): the Grand Slams, ATP and
   WTA tours and Finals, ATP Challengers, WTA 125s, the ITF men's and women's tours, doubles, team events and exhibitions.
   Live scores with the point score and server, set by set serve and return stats, point by point, head to head by
   surface, bookmaker odds, and player pages with ranking, match log, titles and full stats built from recent matches.
   ESPN's ATP and WTA rankings (read directly) add points, movement, photos and career totals for the top players.
   Predictions: a rating from the world ranking, best of three or five sets, blended with the bookmaker market.
   Loaded after basketball.js and hockey.js, and reuses their helpers (decAm, bbStatBars, bbFix). */
const TN_LEVELS = [
  { key: 'slam', name: 'Grand Slams', short: 'Slams', area: 'Australian Open · Roland Garros · Wimbledon · US Open' },
  { key: 'atp', name: 'ATP Tour', short: 'ATP', area: 'Men · Masters 1000, 500, 250 and the Finals' },
  { key: 'wta', name: 'WTA Tour', short: 'WTA', area: 'Women · 1000, 500, 250 and the Finals' },
  { key: 'chm', name: 'ATP Challenger', short: 'Challenger', area: 'Men · second tier' },
  { key: 'chw', name: 'WTA 125', short: 'WTA 125', area: 'Women · second tier' },
  { key: 'itfm', name: 'ITF men', short: 'ITF M', area: 'M15 · M25 · World Tennis Tour' },
  { key: 'itfw', name: 'ITF women', short: 'ITF W', area: 'W15 to W100 · World Tennis Tour' },
  { key: 'other', name: 'Team events & exhibitions', short: 'Other', area: 'Davis Cup, Billie Jean King Cup, United Cup, exhibitions' },
  { key: 'junior', name: 'Juniors', short: 'Juniors', area: 'Boys and girls' },
];
const TNL = Object.fromEntries(TN_LEVELS.map(l => [l.key, l]));
const TN_MEN = new Set(['atp', 'chm', 'itfm']), TN_WOMEN = new Set(['wta', 'chw', 'itfw']);
S.tn = { view: store.get('fl.tnView', 'matches'), lg: store.get('fl.tnLg', 'all'), disc: store.get('fl.tnDisc', 'S'), off: 0, filter: 'all', days: {}, matches: new Map(), tours: {},
  odds: new Map(), espn: {}, frank: new Map(), rankTour: store.get('fl.tnRankTour', 'atp'), rankQ: '' };
if (!['matches', 'picks', 'rank'].includes(S.tn.view)) S.tn.view = 'matches';
if (S.tn.lg !== 'all' && !TNL[S.tn.lg]) S.tn.lg = 'all';
const tnTz = () => Math.round(-new Date().getTimezoneOffset() / 60);
const tnLoading = h => `<div class="skel" style="height:${h || 240}px"></div>`;
// photos: ESPN headshots for ranked players, Flashscore's otherwise; sent without a referrer, with a fallback chain
const tnFaceErr = `referrerpolicy="no-referrer" onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=''}else{this.onerror=null;this.src=SIL}"`;
const tnPhotoOf = (e, side) => { const p = e[side]; if (p.players?.length > 1) return { src: p.photo, alt: '' }; const es = S.tn.espn ? tnEspnOf(p.name, tnGender(e)) : null; return es?.photo ? { src: es.photo, alt: p.photo || '' } : { src: p.photo, alt: '' } };
const tnFace = (e, side, cls, lazy = true) => { const f = tnPhotoOf(e, side); return `<img class="${cls}" src="${esc(f.src || SIL)}" data-alt="${esc(f.alt)}" alt=""${lazy ? ' loading="lazy"' : ''} ${tnFaceErr}>` };
const tnFlag = c => c ? `<span class="tn-cc">${esc(String(c).slice(0, 3).toUpperCase())}</span>` : '';
const tnSurf = s => s ? `<span class="tn-surf tn-${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</span>` : '';
const tnTour = e => S.tn.tours[e.tn] || {};
const tnName = t => t?.name || '';
const tnAge = born => born ? Math.floor((Date.now() / 1000 - born) / (365.25 * 864e2)) : null;
// best of five for men's Grand Slam main draws, three everywhere else
const tnBo = e => { const t = tnTour(e); return t.level === 'slam' && t.tour?.startsWith('ATP') && t.disc === 'S' && !t.qual ? 5 : 3 };

/* ---------- loading ---------- */
async function tnLoadDay(off){
  const cur = S.tn.days[off]; if (cur && Date.now() - cur.at < (off === 0 ? 15000 : 120000)) return cur;
  let d;
  try { d = await getJSON(`/api/tn/day?off=${off}&tz=${tnTz()}`) } catch { return S.tn.days[off] = { events: cur?.events || [], at: Date.now(), down: true } }
  Object.assign(S.tn.tours, d.tours || {});
  const list = [];
  for (const x of d.matches || []) { const old = S.tn.matches.get(x.id); const e = { ...x, date: new Date(x.ts * 1000) };
    if (old) { Object.assign(old, e); list.push(old) } else { S.tn.matches.set(x.id, e); list.push(e) } }
  return S.tn.days[off] = { events: list.sort((a, b) => a.date - b.date), at: Date.now(), down: false };
}
async function tnListOdds(evs){
  const need = evs.filter(e => e.state !== 'post' && e.home.pid && e.away.pid && !(Date.now() - (S.tn.odds.get(e.id)?.at || 0) < 180000)).slice(0, 240);
  const jobs = [];
  for (let i = 0; i < need.length; i += 30) { const part = need.slice(i, i + 30);
    jobs.push(getJSON(`/api/tn/odds?ids=${part.map(e => `${e.id}:${e.home.pid}:${e.away.pid}`).join(',')}`).then(r => { for (const e of part) S.tn.odds.set(e.id, { ...(r[e.id] || { books: [] }), at: Date.now() }) }).catch(() => {})) }
  await Promise.allSettled(jobs); return jobs.length > 0;
}
// ESPN rankings: top 150 or so of each tour, with points, movement and headshots
async function tnEspnRanks(tour){
  const c = S.tn.espn[tour]; if (c && (c.list || c.err) && Date.now() - c.at < 36e5) return c;
  if (c?.p) return c.p;
  const p = cj(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/rankings`).then(d => {
    const list = (d.rankings?.[0]?.ranks || []).map(r => ({ rank: r.current, prev: r.previous, pts: r.points, trend: r.trend, id: r.athlete?.id, name: r.athlete?.displayName || '', first: r.athlete?.firstName || '', last: r.athlete?.lastName || '',
      photo: r.athlete?.headshot || '', flag: r.athlete?.flag || '', country: r.athlete?.flagAltText || '', cc: r.athlete?.citizenshipCountry || '', age: r.athlete?.age }));
    const by = new Map(); for (const x of list) by.set(tnKey(x.last, x.first), x);
    return S.tn.espn[tour] = { list, by, at: Date.now(), date: d.rankings?.[0]?.date || '' };
  }).catch(() => S.tn.espn[tour] = { list: [], by: new Map(), err: true, at: Date.now() });
  S.tn.espn[tour] = { p, at: 0 }; return p;
}
// "Sinner J." / "Auger-Aliassime F." / "Trotter J. K." -> surname + first initial, to meet ESPN's "Jannik Sinner"
const tnKey = (last, first) => normName(last).replace(/\s+/g, '') + ':' + normName(first).slice(0, 1);
const tnFsKey = name => { const m = String(name || '').match(/^(.*?)\s+((?:[A-Z][a-z]?\.\s*-?)+)$/); return m ? tnKey(m[1], m[2]) : tnKey(name, '') };
const tnGender = e => { const t = tnTour(e); return TN_WOMEN.has(t.tourLevel) || /^WTA|WOMEN|GIRLS/.test(t.tour || '') ? 'wta' : 'atp' };
function tnEspnOf(name, tour){ const R = S.tn.espn[tour]; return R?.by?.get(tnFsKey(name)) || null }
function tnRankOf(e, side){
  const p = e[side]; if (p.players?.length > 1) return null;
  const es = tnEspnOf(p.name, tnGender(e)); if (es) return es.rank;
  const f = S.tn.frank.get(p.id); return f?.rank ?? null;
}
async function tnLoadRanks(evs){
  await Promise.allSettled([tnEspnRanks('atp'), tnEspnRanks('wta')]);
  const ids = [...new Set(evs.flatMap(e => ['home', 'away'].filter(s => e[s].players?.length === 1 && !tnEspnOf(e[s].name, tnGender(e)) && !S.tn.frank.has(e[s].id)).map(s => e[s].id)))].filter(Boolean).slice(0, 400);
  const jobs = []; for (let i = 0; i < ids.length; i += 60) { const part = ids.slice(i, i + 60);
    jobs.push(getJSON(`/api/tn/ranks?ids=${part.join(',')}`).then(r => { for (const id of part) S.tn.frank.set(id, r[id] || { rank: null }) }).catch(() => { for (const id of part) S.tn.frank.set(id, { rank: null }) })) }
  await Promise.allSettled(jobs); return ids.length > 0;
}

/* ---------- prediction model ---------- */
// rating from the world ranking (about 110 points per doubling of the rank), win chance by the Elo curve
const TN_DEFAULT_RANK = { slam: 120, atp: 110, wta: 110, chm: 260, chw: 260, itfm: 900, itfw: 800, other: 150, junior: 900 };
const tnRating = r => 2000 - 110 * Math.log(Math.max(1, r));
const tnBo3 = s => s * s * (3 - 2 * s), tnBo5 = s => s ** 3 * (10 - 15 * s + 6 * s * s);
function tnSetP(p, bo){ let lo = 0, hi = 1; const f = bo === 5 ? tnBo5 : tnBo3; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) < p) lo = m; else hi = m } return (lo + hi) / 2 }
function tnFromSets(s, bo, a = 0, b = 0){ const need = bo === 5 ? 3 : 2; const go = (x, y) => x >= need ? 1 : y >= need ? 0 : s * go(x + 1, y) + (1 - s) * go(x, y + 1); return go(a, b) }
function tnMarket(e){
  const books = (S.tn.odds.get(e.id)?.books || []).filter(b => b.ml?.home > 1 && b.ml?.away > 1); if (!books.length) return null;
  const ps = books.map(b => { const h = 1 / b.ml.home, a = 1 / b.ml.away; return h / (h + a) }).sort((x, y) => x - y);
  return { p: ps[Math.floor(ps.length / 2)], n: books.length, best: { home: Math.max(...books.map(b => b.ml.home)), away: Math.max(...books.map(b => b.ml.away)) } };
}
function tnPredict(e){
  if (e.state === 'post' && !e.keepPred) return null;
  const t = tnTour(e), doubles = (e.home.players?.length || 1) > 1, M = tnMarket(e);
  const rH = tnRankOf(e, 'home'), rA = tnRankOf(e, 'away');
  if (doubles && !M) return null;
  const dflt = TN_DEFAULT_RANK[t.level] || 300, bo = tnBo(e);
  let pModel = null;
  if (!doubles && (rH || rA)) pModel = 1 / (1 + 10 ** (-(tnRating(rH || dflt * 1.6) - tnRating(rA || dflt * 1.6)) / 400));
  if (pModel == null && !M) return null;
  // the ranking curve is for best of three; stretch it for best of five
  if (pModel != null && bo === 5) pModel = tnBo5(tnSetP(pModel, 3));
  let pH = M ? (pModel != null ? .35 * pModel + .65 * M.p : M.p) : pModel;
  pH = Math.min(.985, Math.max(.015, pH));
  const s = tnSetP(pH, bo);
  let pNow = pH;
  if (e.state === 'in') pNow = tnFromSets(s, bo, e.home.sets || 0, e.away.sets || 0);
  const need = bo === 5 ? 3 : 2, scores = [];
  const comb = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r };
  for (let l = 0; l < need; l++) { scores.push({ w: 'home', a: need, b: l, p: comb(need - 1 + l, l) * s ** need * (1 - s) ** l }); scores.push({ w: 'away', a: l, b: need, p: comb(need - 1 + l, l) * (1 - s) ** need * s ** l }) }
  scores.sort((x, y) => y.p - x.p);
  const pick = pNow >= .5 ? 'home' : 'away', top = Math.max(pNow, 1 - pNow);
  const pDecider = scores.filter(x => Math.min(x.a, x.b) === need - 1).reduce((a, x) => a + x.p, 0);
  return { pH: pNow, pPre: pH, pModel, market: M?.p ?? null, M, rH, rA, bo, s, scores, pick, top, conf: PFX.confOf(top), pDecider, doubles,
    straight: { home: scores.filter(x => x.w === 'home' && x.b === 0)[0]?.p || 0, away: scores.filter(x => x.w === 'away' && x.a === 0)[0]?.p || 0 } };
}
function tnReasons(e, P){
  const out = [], hn = e.home.name, an = e.away.name;
  if (P.rH || P.rA) out.push(`World ranking: ${hn} ${P.rH ? 'No. ' + P.rH : 'unranked or unknown'}, ${an} ${P.rA ? 'No. ' + P.rA : 'unranked or unknown'}.${P.pModel != null ? ` On ranking alone that is ${pct(P.pModel)}% for ${hn}.` : ''}`);
  if (P.market != null) out.push(`${P.M.n} bookmaker${P.M.n === 1 ? '' : 's'} (no vig) give ${hn} ${pct(P.market)}%. The market carries 65% of the prediction because it already knows about form, fitness and the surface.`);
  out.push(`Best of ${P.bo} sets: that works out to a ${pct(P.s)}% chance for ${hn} to win any one set, and a ${pct(P.pDecider)}% chance the match goes the distance.`);
  if (e.state === 'in') out.push(`Live: ${e.home.sets || 0}–${e.away.sets || 0} in sets, so ${hn}'s chance is now ${pct(P.pH)}% (the model counts sets, not games).`);
  const t = tnTour(e); if (t.surface) out.push(`Surface: ${t.surface}${t.indoor ? ', indoors' : ''}. Open the head-to-head tab for each player's results on it.`);
  return out;
}

/* ---------- main column ---------- */
function tnFiltered(d){
  const q = S.q.trim().toLowerCase();
  return (d?.events || []).filter(e => { const t = tnTour(e);
    return (S.tn.lg === 'all' || t.level === S.tn.lg) && (S.tn.disc === 'all' || t.disc === S.tn.disc || (S.tn.disc === 'D' && t.disc === 'X'))
      && (!q || `${e.home.name} ${e.away.name} ${t.name}`.toLowerCase().includes(q)) && (S.tn.filter !== 'live' || e.state === 'in')
      && (S.tn.filter !== 'fav' || S.fav.some(f => f.sport === 'tennis' && (e.home.id.split('/').includes(f.tid) || e.away.id.split('/').includes(f.tid)))) });
}
function tnRail(){
  const d = S.tn.days[S.tn.off], cnt = {}; for (const e of d?.events || []) { const t = tnTour(e); if (S.tn.disc !== 'all' && t.disc !== S.tn.disc && !(S.tn.disc === 'D' && t.disc === 'X')) continue; const c = cnt[t.level] ||= { n: 0, live: 0 }; c.n++; if (e.state === 'in') c.live++ }
  const on = k => S.tn.view === 'matches' && S.tn.lg === k ? ' on' : '';
  const favs = S.fav.filter(f => f.sport === 'tennis'), total = Object.values(cnt).reduce((a, c) => a + c.n, 0);
  let h = `<h4>Tennis</h4><button class="lg${on('all')}" data-tnlg="all"><span class="dot">●</span><span>All tournaments</span>${d ? `<b>${total}</b>` : ''}</button>
    <button class="lg${S.tn.view === 'picks' ? ' on' : ''}" data-tnview="picks"><span class="dot">%</span><span>Predictions</span></button>
    <button class="lg${S.tn.view === 'rank' ? ' on' : ''}" data-tnview="rank"><span class="dot">#</span><span>ATP & WTA rankings</span></button>`;
  if (favs.length) h += `<h4>My players</h4>` + favs.map(f => `<button class="lg" data-tnplayer="${esc(f.tid)}" data-tnslug="${esc(f.slug || '')}"><img class="tn-railface" src="${esc(f.logo || SIL)}" alt="" ${tnFaceErr}><span>${esc(f.name)}</span></button>`).join('');
  h += `<h4>Tours</h4>` + TN_LEVELS.map(l => { const c = cnt[l.key]; return `<button class="lg${on(l.key)}" data-tnlg="${l.key}"><span class="dot tn-dot tn-l-${l.key}">●</span><span>${esc(l.name)}</span>${c?.live ? `<b class="live">${c.live}</b>` : c?.n ? `<b>${c.n}</b>` : ''}</button>` }).join('');
  $('rail').innerHTML = h;
  $('chips').innerHTML = [['all', 'All'], ['_picks', 'Predictions'], ['_rank', 'Rankings']].map(([k, lab]) => `<button class="chip${(k === 'all' && S.tn.view === 'matches' && S.tn.lg === 'all') || k === '_' + S.tn.view ? ' on' : ''}" ${k[0] === '_' ? `data-tnview="${k.slice(1)}"` : 'data-tnlg="all"'}>${lab}</button>`).join('')
    + TN_LEVELS.filter(l => cnt[l.key] || S.tn.lg === l.key).map(l => `<button class="chip${S.tn.view === 'matches' && S.tn.lg === l.key ? ' on' : ''}" data-tnlg="${l.key}">${esc(l.short)}${cnt[l.key]?.live ? `<b>${cnt[l.key].live}</b>` : ''}</button>`).join('');
  $('chips').classList.remove('mk-hide');
}
function tnSetsHTML(e, side, opp){
  const p = e[side], o = e[opp], n = Math.max(p.games.length, o.games.length);
  let h = '';
  for (let i = 0; i < n; i++) { const g = p.games[i], og = o.games[i], won = g != null && og != null && (g > og) && (e.state !== 'in' || i < n - 1);
    h += `<span class="tn-g${won ? ' w' : ''}">${g ?? ''}${p.tb[i] != null && o.tb[i] != null ? `<sup>${p.tb[i]}</sup>` : ''}</span>` }
  if (e.state === 'in') h += `<span class="tn-pt">${esc(p.point || '')}</span>`;
  return h;
}
function tnPlayerLine(e, side){
  const p = e[side], opp = side === 'home' ? 'away' : 'home', lose = e.state === 'post' && e.winner && e.winner !== side, rk = tnRankOf(e, side);
  const ppl = p.players?.length ? p.players : [{ name: p.name, photo: p.photo }];
  return `<div class="tm tn-row${lose ? ' lose' : ''}">${ppl.length > 1 ? `<span class="tn-pair">${ppl.slice(0, 2).map(x => `<img src="${esc(x.photo || SIL)}" alt="" loading="lazy" ${tnFaceErr}>`).join('')}</span>` : tnFace(e, side, 'tn-face')}
    <span class="tn-nm">${e.state === 'in' && p.serving ? '<i class="tn-serve" title="Serving"></i>' : ''}${esc(p.name)}${rk ? ` <small class="tn-rk">${rk}</small>` : ''}${e.winner === side && e.state === 'post' ? ' <i class="tn-win">✓</i>' : ''}</span>
    <span class="tn-sets num">${e.state !== 'pre' ? `<b class="tn-s">${p.sets ?? ''}</b>` : ''}${tnSetsHTML(e, side, opp)}</span></div>`;
}
function tnStatus(e){
  if (e.state === 'in') return `<div class="st live"><span class="min">${esc(e.detail.replace('Set ', 'S'))}</span>LIVE</div>`;
  if (e.state === 'pre') return /postpon|cancel|interrupt/i.test(e.detail) ? `<div class="st">${esc(e.detail)}</div>` : `<div class="st"><span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>`;
  return `<div class="st">${esc(e.detail === 'Final' ? 'FT' : e.detail === 'Retired' ? 'Ret.' : e.detail === 'Walkover' ? 'W/O' : e.detail)}</div>`;
}
function tnCard(e){
  const P = e.state !== 'post' ? tnPredict(e) : null, M = e.state !== 'post' ? tnMarket(e) : null, ab = s => esc((e[s].players?.length > 1 ? e[s].players.map(x => x.name.split(' ')[0]).join('/') : e[s].name.split(' ')[0]));
  const odds = P || M ? `<div class="oddrow" aria-hidden="true">${P && e.state === 'pre' ? `<span class="${P.pH >= .5 ? 'fav' : ''}">${ab('home')} ${pct(P.pH)}%</span><span class="${P.pH < .5 ? 'fav' : ''}">${ab('away')} ${pct(1 - P.pH)}%</span>` : ''}${M ? `<span title="Best price">${ab('home')} ${decAm(M.best.home)} · ${ab('away')} ${decAm(M.best.away)}</span>` : ''}</div>` : '';
  const t = tnTour(e);
  return `<button class="m tn-m" data-tngame="${esc(e.id)}" style="--hc:${e.state === 'in' ? 'var(--live)' : 'var(--line)'};--ac:${e.state === 'in' ? 'var(--live)' : 'var(--line)'}"
    aria-label="${esc(`${e.home.name} versus ${e.away.name}, ${t.name}. ${e.state === 'pre' ? 'Starts ' + e.date.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : `${e.home.sets ?? 0} sets to ${e.away.sets ?? 0}, ${e.detail}`}`)}">
    ${tnStatus(e)}<div class="tms">${tnPlayerLine(e, 'home')}${tnPlayerLine(e, 'away')}${e.round ? `<small class="tn-round">${esc(e.round)}</small>` : ''}${odds}</div></button>`;
}
function tnDateBar(off){
  const day = new Date(); day.setDate(day.getDate() + off);
  return `<div class="datebar"><button class="dnav" data-tnact="day" data-to="-1" aria-label="Previous day">‹</button>
    <button class="dtoggle" data-tnact="day" data-to="0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>${off === 0 ? 'Today' : off === -1 ? 'Yesterday' : off === 1 ? 'Tomorrow' : esc(day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</span></button>
    <button class="dnav" data-tnact="day" data-to="1" aria-label="Next day">›</button></div>`;
}
function tnTourHead(t, n){
  return `<div class="group-h tn-gh"><span class="tn-lvl tn-l-${esc(t.level)}">${esc(TNL[t.level]?.short || '')}</span><button class="linkbtn tn-tname" data-tntour="${esc(t.id)}"><strong>${esc(t.name)}</strong></button><span>${t.country ? '· ' + esc(t.country) : ''}${t.disc === 'D' ? ' · Doubles' : t.disc === 'X' ? ' · Mixed' : ''}${t.stage ? ' · ' + esc(t.stage) : ''}</span>${tnSurf(t.surface)}${t.indoor ? '<span class="tn-surf">Indoor</span>' : ''}<small class="tn-gn">${n}</small></div>`;
}
const TN_SHOW = 40;   // matches per tournament before "show all"
async function renderTennis(){
  const el = $('tn'); if (!el) return;
  tnRail();
  if (S.tn.view === 'picks') return renderTnPicks();
  if (S.tn.view === 'rank') return renderTnRank();
  const off = S.tn.off;
  const paint = () => {
    const d = S.tn.days[off]; if (!d || S.sport !== 'tennis' || S.tn.view !== 'matches' || S.tn.off !== off) return;
    tnRail();
    const list = tnFiltered(d), live = list.filter(e => e.state === 'in').length, day = new Date(); day.setDate(day.getDate() + off);
    const groups = new Map(); for (const e of list) { if (!groups.has(e.tn)) groups.set(e.tn, []); groups.get(e.tn).push(e) }
    const order = TN_LEVELS.map(l => l.key);
    const chips = `<div class="quick">${[['all', 'All'], ['live', `Live${live ? ' · ' + live : ''}`], ['fav', '★ My players']].map(([k, l]) => `<button class="qf" data-tnfilter="${k}" aria-pressed="${S.tn.filter === k}">${k === 'live' ? '<span class="dot"></span>' : ''}${l}</button>`).join('')}
      <span class="tn-sep"></span>${[['S', 'Singles'], ['D', 'Doubles'], ['all', 'Both']].map(([k, l]) => `<button class="qf" data-tndisc="${k}" aria-pressed="${S.tn.disc === k}">${l}</button>`).join('')}</div>`;
    const title = S.tn.lg === 'all' ? (off === 0 ? 'Today' : day.toLocaleDateString([], { weekday: 'long' })) : TNL[S.tn.lg].name;
    el.innerHTML = tnDateBar(off) + chips + `<div class="livebar"><h2>${esc(title)}</h2><span class="count">${list.length} match${list.length === 1 ? '' : 'es'} · ${groups.size} tournament${groups.size === 1 ? '' : 's'}${live ? ` · <span class="pill live">${live} live</span>` : ''}</span></div>`
      + (list.length ? [...groups].sort((a, b) => { const ta = S.tn.tours[a[0]] || {}, tb = S.tn.tours[b[0]] || {}; return order.indexOf(ta.level) - order.indexOf(tb.level) || (ta.disc > tb.disc ? 1 : ta.disc < tb.disc ? -1 : 0) || (b[1].some(e => e.state === 'in') - a[1].some(e => e.state === 'in')) || String(ta.name).localeCompare(tb.name) })
          .map(([k, l]) => { const t = S.tn.tours[k] || {}, open = S.tn.open?.[k] || l.length <= TN_SHOW, sorted = [...l].sort((a, b) => (b.state === 'in') - (a.state === 'in') || (a.state === 'post') - (b.state === 'post') || a.date - b.date);
            return `<div class="group">${tnTourHead(t, l.length)}<div class="cards">${(open ? sorted : sorted.slice(0, TN_SHOW)).map(tnCard).join('')}</div>${open ? '' : `<button class="linkbtn bb-more" data-tnact="more" data-to="${esc(k)}">Show all ${l.length} matches ›</button>`}</div>` }).join('')
        : `<div class="empty-state"><strong>${d.down ? "Couldn't load matches" : 'No matches'}</strong>${d.down ? 'The local server isn\'t answering. Start it with <code>python3 server.py --lan</code>.' : S.tn.filter === 'live' ? 'Nothing live right now.' : 'Try another day, tour or singles/doubles.'}</div>`)
      + `<p class="srcnote">Scores, stats and odds from Flashscore; rankings from ESPN. Times are local.</p>`;
  };
  if (S.tn.days[off]) paint(); else el.innerHTML = tnDateBar(off) + '<div class="cards"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
  await tnLoadDay(off); paint();
  const vis = tnFiltered(S.tn.days[off]).filter(e => e.state !== 'post');
  tnLoadRanks(vis.slice(0, 200)).then(paint).catch(() => {});
  tnListOdds(vis.slice(0, 120)).then(ch => ch && paint()).catch(() => {});
}
function tnTicker(){
  const all = Object.values(S.tn.days).flatMap(d => d.events || []), seen = new Set(), rankOf = e => Math.min(TN_LEVELS.findIndex(l => l.key === tnTour(e).level) + 1 || 99);
  const live = all.filter(e => e.state === 'in' && tnTour(e).disc === 'S' && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 14);
  const next = all.filter(e => e.state === 'pre' && e.date > Date.now() && tnTour(e).disc === 'S' && ['slam', 'atp', 'wta'].includes(tnTour(e).level) && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.date - b.date).slice(0, 6);
  const sn = p => esc(p.name.split(' ')[0]);
  const chip = e => `<button class="tk" data-tngame="${esc(e.id)}"><span class="mn ${e.state === 'in' ? '' : 'pre'}">${e.state === 'in' ? esc(e.detail.replace('Set ', 'S')) : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${sn(e.home)}${e.state === 'in' ? `<span class="s num">${e.home.sets ?? 0}–${e.away.sets ?? 0}</span>` : ' v '}${sn(e.away)}</button>`;
  $('ticker').hidden = !live.length && !next.length;
  $('ticker').innerHTML = (live.length ? `<span class="lab">${live.length} live</span>` + live.map(chip).join('') : '') + (next.length ? `<span class="lab next">Next up</span>` + next.map(chip).join('') : '');
}

/* ---------- predictions page ---------- */
async function renderTnPicks(){
  const el = $('tn');
  const paint = () => {
    if (S.sport !== 'tennis' || S.tn.view !== 'picks') return;
    const evs = [0, 1].flatMap(o => S.tn.days[o]?.events || []).filter(e => e.state !== 'post' && !/cancel|postpon/i.test(e.detail));
    const items = evs.map(e => { const P = tnPredict(e); if (!P) return null; const t = tnTour(e);
      return { e, P, id: e.id, lg: e.tn, lgName: `${t.name}${t.disc === 'D' ? ' (doubles)' : ''} · ${TNL[t.level]?.short || ''}`, cat: t.level, order: TN_LEVELS.findIndex(l => l.key === t.level), date: e.date, live: e.state === 'in', conf: P.conf, top: P.top,
        edge: P.market != null && P.pModel != null ? (P.pick === 'home' ? P.pModel - P.market : P.market - P.pModel) : null,
        fav: S.fav.some(f => f.sport === 'tennis' && (e.home.id.split('/').includes(f.tid) || e.away.id.split('/').includes(f.tid))) } }).filter(Boolean);
    const shown = PFX.apply('tennis', items), loading = !S.tn.days[0] || !S.tn.days[1];
    el.innerHTML = `<div class="livebar"><h2>Predictions</h2><span class="count">${items.length} match${items.length === 1 ? '' : 'es'} today and tomorrow</span></div>
      ${PFX.bar('tennis', items, TN_LEVELS.map(l => [l.key, l.name]))}
      <div class="cards">${shown.slice(0, 250).map(({ e, P }) => { const pH = P.pH, t = tnTour(e), sc = P.scores[0];
        return `<button class="m pred-card tn-pc" data-tngame="${esc(e.id)}" data-tntab="pred" style="--hc:var(--accent);--ac:var(--line)">
        <div class="st">${e.state === 'in' ? `<span class="min" style="color:var(--live)">${esc(e.detail)}</span>LIVE` : `<span class="ko">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>${esc(e.date.toLocaleDateString([], { weekday: 'short' }))}`}</div>
        <div class="tms">${['home', 'away'].map(s => `<div class="tm">${tnFace(e, s, 'tn-face')}<span>${esc(e[s].name)}${(s === 'home' ? P.rH : P.rA) ? ` <small class="tn-rk">${s === 'home' ? P.rH : P.rA}</small>` : ''}${e.state === 'in' ? ` <small class="tn-rk">${e[s].sets ?? 0}</small>` : ''}</span></div>`).join('')}
          <div class="pbar"><i style="flex-grow:${pH};background:var(--accent)"><span>${pct(pH)}%</span></i><i style="flex-grow:${1 - pH};background:color-mix(in oklab,var(--muted) 55%,var(--surface-2))"><span>${pct(1 - pH)}%</span></i></div></div>
        <div class="pc-side"><span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${P.conf}</span><b>${esc(e[P.pick].name)}</b><small class="num">${sc.w === 'home' ? sc.a + '–' + sc.b : sc.b + '–' + sc.a} sets · ${pct(P.top)}%${P.market != null ? ' · mkt ' + pct(P.pick === 'home' ? P.market : 1 - P.market) + '%' : ''}</small><small class="pfx-lg">${esc(t.name)} · ${esc(TNL[t.level]?.short || '')}</small></div></button>` }).join('')
        || PFX.empty('tennis', items.length) || (loading ? '<div class="skel"></div><div class="skel"></div>' : '<div class="empty-state"><strong>No upcoming matches</strong>Nothing left to play today or tomorrow.</div>')}</div>
      <p class="srcnote">Each player's rating comes from the world ranking; best of five sets for men's Grand Slam main draws, three elsewhere. Where bookmakers price the match, the market carries 65%. Doubles appear only when bookmakers price them. Retirements, walkovers and injuries are not modelled.</p>${RG}`;
  };
  if (S.tn.days[0] || S.tn.days[1]) paint(); else el.innerHTML = '<div class="skel" style="height:300px"></div>';
  await Promise.allSettled([tnLoadDay(0), tnLoadDay(1)]); paint();
  const evs = [0, 1].flatMap(o => S.tn.days[o]?.events || []).filter(e => e.state !== 'post');
  await tnLoadRanks(evs).catch(() => {}); paint();
  // odds first for the main tours, then the rest
  const main = evs.filter(e => ['slam', 'atp', 'wta', 'chm', 'chw'].includes(tnTour(e).level)), rest = evs.filter(e => !main.includes(e));
  await tnListOdds(main).catch(() => {}); paint();
  await tnListOdds(rest).catch(() => {}); paint();
}

/* ---------- rankings page (ESPN) ---------- */
async function renderTnRank(){
  const el = $('tn'), tour = S.tn.rankTour;
  const paint = () => {
    if (S.sport !== 'tennis' || S.tn.view !== 'rank') return;
    const R = S.tn.espn[tour], q = normName(S.tn.rankQ || '');
    const tabs = `<div class="quick">${[['atp', 'ATP men'], ['wta', 'WTA women']].map(([k, l]) => `<button class="qf" data-tnact="ranktour" data-to="${k}" aria-pressed="${tour === k}">${l}</button>`).join('')}<input class="tn-rq" type="search" placeholder="Filter by name or country" value="${esc(S.tn.rankQ || '')}" data-tnrq="1" aria-label="Filter rankings"></div>`;
    if (!R?.list) { el.innerHTML = `<div class="livebar"><h2>${tour.toUpperCase()} rankings</h2></div>` + tabs + tnLoading(400); return }
    const list = R.list.filter(x => !q || normName(`${x.name} ${x.country} ${x.cc}`).includes(q));
    el.innerHTML = `<div class="livebar"><h2>${tour === 'atp' ? 'ATP' : 'WTA'} singles rankings</h2><span class="count">${R.list.length} players${R.date ? ' · ' + esc(fmtDate(R.date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</span></div>` + tabs
      + (R.err ? `<div class="note">Couldn't load ESPN's rankings.</div>` : `<div class="tbl-wrap"><table class="ctable tn-rank"><thead><tr><th>#</th><th></th><th style="text-align:left">Player</th><th>Age</th><th>Points</th><th>Move</th></tr></thead><tbody>
        ${list.map(x => { const mv = +String(x.trend || '0').replace('+', '') || 0;
          return `<tr><td class="num"><b>${x.rank}</b></td><td>${x.photo ? `<img class="tn-rface" src="${esc(x.photo)}" alt="" loading="lazy" ${tnFaceErr}>` : ''}</td><td style="text-align:left"><button class="linkbtn" data-tnfind="${esc(x.name)}" data-tnft="${tour}">${x.flag ? `<img class="tn-flag" src="${esc(x.flag)}" alt="" loading="lazy">` : ''}${esc(x.name)}</button> <small class="tn-mut">${esc(x.cc || x.country)}</small></td><td class="num">${x.age ?? '–'}</td><td class="num">${(+x.pts || 0).toLocaleString()}</td><td class="num ${mv > 0 ? 'tn-up' : mv < 0 ? 'tn-down' : ''}">${mv > 0 ? '▲' + mv : mv < 0 ? '▼' + -mv : '–'}</td></tr>` }).join('')}</tbody></table></div>`)
      + `<p class="srcnote">Rankings from ESPN, updated weekly on Mondays. Tap a player for their full profile and stats.</p>`;
  };
  paint(); await tnEspnRanks(tour); paint();
}

/* ---------- match page ---------- */
function openTnGame(id, tab){
  const e = S.tn.matches.get(String(id)); if (!e) return;
  S.sel = null; S.stack = [{ type: 'tngame', id: e.id, e, tab: tab || (e.state === 'pre' ? 'pred' : 'summary') }];
  renderSheet(); $('sheet').classList.add('open'); $('sheet').querySelector('.sheet-body')?.scrollTo(0, 0);
  tnLoadGame(S.stack[0]);
}
async function tnLoadGame(v){
  const e = v.e, re = () => S.stack.includes(v) && renderSheet();
  tnLoadRanks([e]).then(re).catch(() => {});
  try { const g = await getJSON(`/api/tn/match?id=${e.id}&ja=${e.home.pid || ''}&jb=${e.away.pid || ''}`); v.g = g; S.tn.odds.set(e.id, { ...(g.odds || { books: [] }), at: Date.now() }) }
  catch { v.g = { error: true } }
  v.loaded = true; re();
}
function tnHero(v, back){
  const e = v.e, t = tnTour(e), s = e.state !== 'pre';
  const who = side => { const p = e[side], ppl = p.players?.length ? p.players : [{ name: p.name, id: p.id, slug: p.slug, photo: p.photo }], rk = tnRankOf(e, side);
    return `<div class="side tn-side${e.state === 'post' && e.winner && e.winner !== side ? ' lose' : ''}">${ppl.length > 1 ? `<span class="tn-pair big">${ppl.map(x => `<img src="${esc(x.photo || SIL)}" alt="" ${tnFaceErr}>`).join('')}</span>` : tnFace(e, side, 'tn-hface', false)}
      <strong>${ppl.map(x => x.id && (x.slug || ppl.length === 1) ? `<button class="linkbtn" data-tnplayer="${esc(x.id)}" data-tnslug="${esc(x.slug || p.slug || '')}" data-tnname="${esc(x.name)}">${esc(x.name)}</button>` : `<button class="linkbtn" data-tnplayer="${esc(x.id)}" data-tnname="${esc(x.name)}">${esc(x.name)}</button>`).join(' / ')}</strong>
      <small class="rec">${esc(p.country || '')}${rk ? ` · No. ${rk}` : ''}${e.state === 'in' && p.serving ? ' · serving' : ''}</small></div>` };
  const n = Math.max(e.home.games.length, e.away.games.length);
  const row = side => { const p = e[side], o = e[side === 'home' ? 'away' : 'home'];
    return `<tr><td class="t">${e.state === 'in' && p.serving ? '<i class="tn-serve"></i>' : ''}${esc(p.name)}</td>${Array.from({ length: n }, (_, i) => `<td class="${p.games[i] != null && o.games[i] != null && p.games[i] > o.games[i] ? 'tn-w' : ''}">${p.games[i] ?? ''}${p.tb[i] != null && o.tb[i] != null ? `<sup>${p.tb[i]}</sup>` : ''}</td>`).join('')}${e.state === 'in' ? `<td class="tn-pt">${esc(p.point || '')}</td>` : ''}<td class="pts">${p.sets ?? ''}</td></tr>` };
  return `<div class="hero tn-hero" style="--hc:var(--accent);--ac:var(--line)">
    ${topBar(back).replace('<div class="hero-top">', `<div class="hero-top"><div class="lgname"><span class="tn-lvl tn-l-${esc(t.level)}">${esc(TNL[t.level]?.short || '')}</span><span>${esc(t.name || '')}${e.round ? ' · ' + esc(e.round) : ''}</span></div>`)}
    <div class="board">${who('home')}
      <div class="score">${s ? `<div class="big num">${esc(e.home.sets ?? 0)}<em>–</em>${esc(e.away.sets ?? 0)}</div><div class="status">${e.state === 'in' ? `<span class="pill live">${esc(e.detail)}</span>` : `<span class="pill" style="background:var(--surface-2);color:var(--muted)">${esc(e.detail)}</span>`}</div>`
        : `<div class="kick num">${e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><div class="sub">${esc(e.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}${kickoffIn(e.date) ? '<br>' + kickoffIn(e.date).replace('Kick-off', 'Starts') : ''}</div>`}</div>
      ${who('away')}</div>
    ${n ? `<div class="tbl-wrap"><table class="qtr tn-qtr"><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}${e.state === 'in' ? '<th>Pts</th>' : ''}<th>Sets</th></tr></thead><tbody>${row('home')}${row('away')}</tbody></table></div>` : ''}
    <div class="meta-row">${t.country ? `<span>${esc(t.country)}</span>` : ''}${t.surface ? `<span>${esc(t.surface[0].toUpperCase() + t.surface.slice(1))}${t.indoor ? ' · indoor' : ''}</span>` : ''}<span>Best of ${tnBo(e)}</span>${v.g?.info?.time ? `<span>Match time ${esc(v.g.info.time)}</span>` : ''}${e.note ? `<span>${esc(e.note)}</span>` : ''}</div></div>`;
}
function tnGameTabs(v){
  const e = v.e, g = v.g;
  if (e.state === 'pre') return [['pred', 'Prediction'], ['odds', 'Odds'], ['h2h', 'Head to head'], ['form', 'Form']];
  return [['summary', 'Summary'], ...(g?.stats?.length ? [['stats', 'Stats']] : []), ...(g?.pbp?.length ? [['pbp', 'Point by point']] : []), ['h2h', 'Head to head'], ['form', 'Form'], ['odds', 'Odds'], ['pred', 'Prediction']];
}
function tnPane(v){
  const e = v.e, g = v.g;
  if (v.tab === 'pred') return tnPredPane(v);
  if (v.tab === 'odds') return tnOddsPane(v);
  if (!g) return tnLoading();
  if (g.error) return `<div class="note">Couldn't load this match. Is the local server running?</div>`;
  if (v.tab === 'summary') return tnSummaryPane(v);
  if (v.tab === 'stats') return tnStatsPane(v);
  if (v.tab === 'pbp') return tnPbpPane(v);
  if (v.tab === 'h2h') return tnH2HPane(v);
  if (v.tab === 'form') return tnFormPane(v);
  return '';
}
function tnStatRows(per){ const out = {}; for (const gr of per?.groups || []) for (const r of gr.rows) out[r.label] = r; return out }
function tnSummaryPane(v){
  const e = v.e, g = v.g; let h = '';
  if (g.sets?.length) h += `<div class="sub-h" style="margin-top:0"><h5>Set by set</h5>${g.info?.time ? `<small>${esc(g.info.time)} in all</small>` : ''}</div><div class="tn-setlist">${g.sets.map(s => `<div><span>${esc(s.set)}</span><b class="num">${esc(s.home)}${s.tbHome ? `<sup>${esc(s.tbHome)}</sup>` : ''}–${esc(s.away)}${s.tbAway ? `<sup>${esc(s.tbAway)}</sup>` : ''}</b><small>${esc(s.time || '')}</small></div>`).join('')}</div>`;
  const R = tnStatRows(g.stats?.find(p => p.period === 'Match'));
  const key = ['Aces', 'Double Faults', '1st serve percentage', '1st serve points won', '2nd serve points won', 'Break Points Converted', 'Service games won', 'Total Points Won'].filter(k => R[k]);
  if (key.length) h += `<div class="sub-h"><h5>Key numbers</h5><small>${esc(e.home.name)} · ${esc(e.away.name)}</small></div>` + bbStatBars(e, key.map(k => ({ label: k, l: R[k].home, r: R[k].away, lc: 'var(--accent)', rc: 'color-mix(in oklab,var(--muted) 60%,var(--surface-2))' })));
  const last = g.pbp?.[g.pbp.length - 1];
  if (e.state === 'in' && last) { const gm = last.games[last.games.length - 1];
    h += `<div class="sub-h"><h5>Now</h5><small>${esc(last.name)}</small></div><p class="tn-now">${gm ? `${esc(e[gm.server === 1 ? 'home' : 'away'].name)} served the last game (${gm.h}–${gm.a} in games).` : ''} ${last.now ? `Current game: ${esc(last.now)}.` : ''}</p>` }
  if (e.note) h += `<p class="srcnote">${esc(e.note)}</p>`;
  return h || `<div class="note">Details appear once the match starts.</div>`;
}
function tnStatsPane(v){
  const e = v.e, st = v.g.stats; v.period ??= 0; const per = st[Math.min(v.period, st.length - 1)];
  return `<div class="sub-h" style="margin-top:0"><h5>Match stats</h5><small>${esc(e.home.name)} · ${esc(e.away.name)}</small></div>
    ${st.length > 1 ? `<div class="quick">${st.map((p, i) => `<button class="qf" data-tnact="period" data-to="${i}" aria-pressed="${i === v.period}">${esc(p.period)}</button>`).join('')}</div>` : ''}
    ${per.groups.map(gr => `<div class="grp-name" style="font-size:13px">${esc(gr.name)}</div>` + bbStatBars(e, gr.rows.map(r => ({ label: r.label, l: r.home, r: r.away, lc: 'var(--accent)', rc: 'color-mix(in oklab,var(--muted) 60%,var(--surface-2))' })))).join('')}`;
}
function tnPbpPane(v){
  const e = v.e, sets = v.g.pbp; v.pset ??= sets.length - 1; const S_ = sets[Math.min(v.pset, sets.length - 1)];
  const nm = i => esc(e[i === 1 ? 'home' : 'away'].name);
  return `<div class="quick">${sets.map((s, i) => `<button class="qf" data-tnact="pset" data-to="${i}" aria-pressed="${i === v.pset}">${esc(s.name)}</button>`).join('')}</div>
    <ul class="tn-pbp">${S_.games.map(gm => `<li class="${gm.lost ? 'brk' : ''}"><span class="num tn-gs">${S_.tb ? `${gm.h ?? ''}–${gm.a ?? ''}` : `${gm.h}–${gm.a}`}</span><span class="tn-srv">${gm.server ? `${nm(gm.server)} serving` : ''}${gm.lost ? ' · <b>broken</b>' : ''}${gm.tbH != null ? ` · tiebreak ${gm.tbH}–${gm.tbA}` : ''}</span>
      <span class="tn-pts">${gm.points.map(p => `<i class="${p.bp ? 'bp' : ''}${p.sp ? ' sp' : ''}${p.mp ? ' mp' : ''}" title="${p.bp ? 'Break point' : p.sp ? 'Set point' : p.mp ? 'Match point' : ''}">${esc(p.s)}</i>`).join('')}</span></li>`).join('')}</ul>
    <p class="srcnote">Each game shows the score after it, who served, and the points in order. Highlighted points were break, set or match points.</p>`;
}
function tnH2HPane(v){
  const tabs = v.g.h2h || []; if (!tabs.length) return `<div class="note">No head-to-head history found.</div>`;
  v.hsurf ??= 0; const T = tabs[Math.min(v.hsurf, tabs.length - 1)];
  const meet = T.sections.find(s => /head-to-head/i.test(s.title)) || { games: [] };
  const e = v.e, hk = normName(e.home.name), wins = { h: 0, a: 0 };
  for (const g of meet.games) { if (g.code === '5') continue; const hw = +g.hs > +g.as, homeIsH = normName(g.home) === hk; if (hw === homeIsH) wins.h++; else wins.a++ }
  return `<div class="quick">${tabs.map((t, i) => `<button class="qf" data-tnact="hsurf" data-to="${i}" aria-pressed="${i === v.hsurf}">${esc(t.surface)}</button>`).join('')}</div>
    <div class="tn-h2hsum"><div><b class="num">${wins.h}</b><span>${esc(e.home.name)}</span></div><small>${meet.games.length ? `${meet.games.length} meeting${meet.games.length === 1 ? '' : 's'}${T.surface !== 'All surfaces' ? ' on ' + esc(T.surface.toLowerCase()) : ''}` : 'Never met' + (T.surface !== 'All surfaces' ? ' on ' + esc(T.surface.toLowerCase()) : '')}</small><div><b class="num">${wins.a}</b><span>${esc(e.away.name)}</span></div></div>
    ${meet.games.length ? `<div class="sub-h"><h5>Meetings</h5></div>${tnGamesList(meet.games)}` : ''}`;
}
function tnGamesList(games, me){
  return `<div class="fbsched">${games.map(g => `<div class="fx"><span class="d">${esc(fmtDate(g.ts * 1000, { day: 'numeric', month: 'short', year: '2-digit' }))}<br>${esc(g.tn)}</span><span class="vs"><span>${g.hid || g.hslug ? `<button class="linkbtn" data-tnplayer="${esc(g.hid)}" data-tnslug="${esc(g.hslug)}">${esc(g.home)}</button>` : esc(g.home)} – ${g.aid || g.aslug ? `<button class="linkbtn" data-tnplayer="${esc(g.aid)}" data-tnslug="${esc(g.aslug)}">${esc(g.away)}</button>` : esc(g.away)}</span></span><span class="r num">${esc(g.hs)}–${esc(g.as)} ${tnSurf(g.surface)} ${g.res ? `<span class="res ${g.res === 'w' ? 'W' : 'L'}">${g.res.toUpperCase()}</span>` : ''}</span></div>`).join('')}</div>`;
}
function tnFormPane(v){
  const tabs = v.g?.h2h || []; if (!v.g) return tnLoading(); if (!tabs.length) return `<div class="note">No recent results found.</div>`;
  v.hsurf ??= 0; const T = tabs[Math.min(v.hsurf, tabs.length - 1)];
  const secs = T.sections.filter(s => /^Last matches/i.test(s.title));
  return `<div class="quick">${tabs.map((t, i) => `<button class="qf" data-tnact="hsurf" data-to="${i}" aria-pressed="${i === v.hsurf}">${esc(t.surface)}</button>`).join('')}</div>`
    + secs.map(s => { const w = s.games.filter(g => g.res === 'w').length, l = s.games.filter(g => g.res === 'l').length;
      return `<div class="sub-h"><h5>${esc(s.title.replace('Last matches:', 'Recent:'))}</h5><small>${w}–${l}${T.surface !== 'All surfaces' ? ' on ' + esc(T.surface.toLowerCase()) : ''}</small></div><div class="tn-form">${s.games.map(g => `<span class="res ${g.res === 'w' ? 'W' : 'L'}">${(g.res || '?').toUpperCase()}</span>`).join('')}</div>${tnGamesList(s.games)}` }).join('');
}
function tnOddsPane(v){
  const e = v.e, o = S.tn.odds.get(e.id);
  if (!o && !v.loaded) return tnLoading(200);
  const books = (o?.books || []).filter(b => b.ml);
  let h = '';
  if (books.length) { const bH = Math.max(...books.map(b => b.ml.home)), bA = Math.max(...books.map(b => b.ml.away)), M = tnMarket(e);
    const mv = (x, x0) => x0 && Math.abs(x - x0) > .005 ? ` <small class="${x < x0 ? 'tn-up' : 'tn-down'}">${x < x0 ? '▼' : '▲'}</small>` : '';
    h += `<div class="sub-h" style="margin-top:0"><h5>Match winner · sportsbooks</h5><small>American odds · best price highlighted · arrows show the move since opening</small></div>
      <div class="tn-books"><div class="tn-bh"><span>Book</span><span>${esc(e.home.name)}</span><span>${esc(e.away.name)}</span><span>Opened</span></div>
      ${books.map(b => `<div class="tn-br"><span>${esc(b.name.replace('.us', ''))}</span><span class="num${b.ml.home === bH ? ' best' : ''}">${decAm(b.ml.home)}${mv(b.ml.home, b.ml.home0)}</span><span class="num${b.ml.away === bA ? ' best' : ''}">${decAm(b.ml.away)}${mv(b.ml.away, b.ml.away0)}</span><span class="num tn-mut">${b.ml.home0 ? decAm(b.ml.home0) + ' / ' + decAm(b.ml.away0) : '–'}</span></div>`).join('')}</div>
      ${M ? `<div class="tiles pred-tiles"><div class="tile"><b class="num">${pct(M.p)}%</b><span>${esc(e.home.name)} implied (no vig)</span></div><div class="tile"><b class="num">${pct(1 - M.p)}%</b><span>${esc(e.away.name)} implied (no vig)</span></div><div class="tile"><b class="num">${decAm(bH)}</b><span>Best ${esc(e.home.name)}</span></div><div class="tile"><b class="num">${decAm(bA)}</b><span>Best ${esc(e.away.name)}</span></div></div>` : ''}`;
  } else h += `<div class="note">${e.state === 'post' ? 'Betting has closed for this match.' : 'No bookmaker odds listed for this match yet.'}</div>`;
  return h + `<p class="srcnote">Prices from Flashscore's odds comparison${o?.region ? ` (${esc(o.region)} market)` : ''}. Prices change quickly; check the book before betting.</p>${RG}`;
}
function tnPredPane(v){
  const e = v.e;
  if (!v.loaded && !S.tn.odds.get(e.id)) return tnLoading();
  e.keepPred = true; const P = tnPredict(e); e.keepPred = false;
  if (!P) return `<div class="note">Not enough information to predict this match: neither player has a known ranking and no bookmaker prices it.</div>`;
  const post = e.state === 'post', pH = post ? P.pPre : P.pH, fav = pH >= .5 ? 'home' : 'away';
  const top = P.scores.slice(0, 6).map(x => `<div class="tile"><b class="num">${x.a}–${x.b}</b><span>${esc(e[x.w].name)} · ${pct(x.p)}%</span></div>`).join('');
  return `<div class="pred-head"><div><h5>${post ? 'Pre-match prediction' : 'Floodlight prediction'}</h5><strong class="pred-pick">${esc(e[fav].name)} to win</strong>
      <span class="conf ${P.conf === 'Strong' ? 'high' : P.conf === 'Lean' ? 'medium' : 'low'}">${PFX.confOf(Math.max(pH, 1 - pH))} · ${pct(Math.max(pH, 1 - pH))}%</span>${post && e.winner ? `<span class="pred-out ${e.winner === fav ? 'ok' : 'miss'}">${e.winner === fav ? 'Called it' : 'Missed'} — ${e.home.sets}–${e.away.sets} in sets</span>` : ''}</div>
      <div class="pred-score"><small>Most likely result</small><b class="num">${P.scores[0].a}–${P.scores[0].b}</b><small>sets, ${esc(e.home.name.split(' ')[0])} – ${esc(e.away.name.split(' ')[0])}</small></div></div>
    <div class="pbar" role="img" aria-label="${esc(`${e.home.name} ${pct(pH)} percent, ${e.away.name} ${pct(1 - pH)} percent`)}"><i style="flex-grow:${pH};background:var(--accent)"><span>${pct(pH)}%</span></i><i style="flex-grow:${1 - pH};background:color-mix(in oklab,var(--muted) 55%,var(--surface-2))"><span>${pct(1 - pH)}%</span></i></div>
    <div class="pred-legend"><span><i style="background:var(--accent)"></i>${esc(e.home.name)}</span><span><i style="background:color-mix(in oklab,var(--muted) 55%,var(--surface-2))"></i>${esc(e.away.name)}</span></div>
    <div class="tiles pred-tiles"><div class="tile"><b class="num">${pct(P.s)}%</b><span>${esc(e.home.name)} wins a set</span></div>
      <div class="tile"><b class="num">${pct(P.pDecider)}%</b><span>Goes to a deciding set</span></div>
      <div class="tile"><b class="num">${pct(P.straight[fav])}%</b><span>${esc(e[fav].name)} in straight sets</span></div>
      <div class="tile"><b class="num">${P.market != null ? pct(P.market) + '%' : '–'}</b><span>${esc(e.home.name)} in the market</span></div>
      <div class="tile"><b class="num">${P.pModel != null ? pct(P.pModel) + '%' : '–'}</b><span>${esc(e.home.name)} on ranking alone</span></div>
      <div class="tile"><b class="num">${P.rH || '–'} · ${P.rA || '–'}</b><span>World rankings</span></div></div>
    <div class="sub-h"><h5>Set scores</h5><small>Best of ${P.bo}</small></div><div class="tiles">${top}</div>
    <div class="sub-h"><h5>Why</h5></div><ul class="why">${tnReasons(e, P).map(r => `<li>${esc(r)}</li>`).join('')}</ul>${RG}`;
}

/* ---------- player page ---------- */
function openTnPlayer(id, slug, name){
  if (!id && !name) return;
  if (!slug) return tnFindPlayer(name, null, id);
  pushView({ type: 'tnplayer', id: String(id), slug, tab: 'overview', mfilter: 'S' });
  const v = S.stack[S.stack.length - 1]; if (v.p) return;
  getJSON(`/api/tn/player?id=${id}&slug=${encodeURIComponent(slug)}`).then(d => { v.p = d; tnPlayerEspn(v).then(() => S.stack.includes(v) && renderSheet()); S.stack.includes(v) && renderSheet() })
    .catch(() => { v.err = true; S.stack.includes(v) && renderSheet() });
}
// find a player from a name (rankings, doubles partners): Flashscore search, best match on surname and initial
async function tnFindPlayer(name, tour, id){
  if (!name) return;
  try { const r = await getJSON(`/api/tn/search?q=${encodeURIComponent(name.replace(/\s+[A-Z]\.(\s*[A-Z]\.)*$/, ''))}`), P = r.players || [];
    const k = /\.\s*$/.test(name) ? tnFsKey(name) : (() => { const parts = name.split(' '); return tnKey(parts.slice(1).join(' ') || parts[0], parts[0]) })();
    const hit = (id && P.find(x => x.id === id)) || P.find(x => { const parts = x.name.split(' '); return tnKey(parts.slice(1).join(' '), parts[0]) === k || tnFsKey(x.name) === k }) || P.find(x => (tour === 'wta' ? /women/i : /men/i).test(x.gender || '')) || P[0];
    if (hit) return openTnPlayer(hit.id, hit.slug);
  } catch {}
  alert(`Couldn't find ${name} on Flashscore.`);
}
async function tnPlayerEspn(v){
  const p = v.p; if (!p) return;
  const tour = /women|female/i.test(p.gender || '') || p.tour === 'WTA' ? 'wta' : 'atp';
  await tnEspnRanks(tour);
  const parts = p.name.split(' '), es = S.tn.espn[tour]?.by?.get(tnKey(parts.slice(1).join(' '), parts[0])) || S.tn.espn[tour]?.by?.get(tnKey(parts[parts.length - 1], parts[0]));
  if (!es) return;
  v.espn = es;
  const [base, st] = await Promise.allSettled([cj(`https://site.web.api.espn.com/apis/common/v3/sports/tennis/${tour}/athletes/${es.id}`), cj(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/${tour}/athletes/${es.id}/statistics`)]);
  v.espnBio = val(base)?.athlete || null;
  const cats = val(st)?.splits?.categories || []; v.espnStats = Object.fromEntries(cats.flatMap(c => c.stats || []).map(s => [s.name, s.value]));
}
function tnPlayerHero(v, back){
  const p = v.p, es = v.espn, b = v.espnBio, fav = S.fav.some(f => f.id === 'tn-' + v.id);
  return `<div class="hero solo tn-phero" style="--tc:var(--accent)">${topBar(back)}<div class="thead"><img class="face espn-shot" src="${esc(es?.photo || p?.photo || SIL)}" data-alt="${esc(es?.photo && p?.photo ? p.photo : '')}" alt="" ${tnFaceErr}><div><h3>${esc(p?.name || 'Loading…')}</h3>
    ${p ? `<p>${p.rank ? `<span><b>${esc(p.tour || '')} No. ${p.rank}</b></span>` : ''}${es?.pts ? `<span>${(+es.pts).toLocaleString()} pts</span>` : ''}${p.country ? `<span>${es?.flag ? `<img class="tn-flag" src="${esc(es.flag)}" alt="">` : ''}${esc(p.country)}</span>` : ''}${p.injury ? `<span class="tn-inj">${esc(p.injury)}</span>` : ''}</p>
      <p class="bb-bio">${[p.born ? tnAge(p.born) + ' yrs' : '', p.born ? 'Born ' + new Date(p.born * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '', b?.displayHeight, b?.displayWeight, b?.hand?.displayValue ? b.hand.displayValue + '-handed' : '', b?.displayExperience].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</p>
      <p><button class="btn ghost tn-favbtn" data-tnact="fav">${fav ? '★ Following' : '☆ Follow'}</button></p>` : ''}</div></div></div>`;
}
const tnPc = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '–';
const tnWL = x => x ? `${x[0]}–${x[1]}` : '–';
const tnWLp = x => x && x[0] + x[1] ? Math.round(x[0] / (x[0] + x[1]) * 100) + '%' : '–';
function tnPlayerPane(v){
  if (v.err) return `<div class="note">Couldn't load this player.</div>`;
  const p = v.p; if (!p) return tnLoading(320);
  const sp = p.splits || {}, T = p.stats?.totals || {}, n = p.stats?.matches || 0, es = v.espnStats;
  if (v.tab === 'overview') {
    const singles = p.matches.filter(m => m.disc === 'S' && m.state === 'post'), y = String(new Date().getFullYear()), yr = sp.year?.[y];
    let h = `<div class="tiles pred-tiles">
      <div class="tile"><b class="num">${p.rank ? '#' + p.rank : '–'}</b><span>${esc(p.tour || 'World')} ranking${+v.espn?.trend ? ` · ${+v.espn.trend > 0 ? 'up' : 'down'} ${Math.abs(+v.espn.trend)} this week` : ''}</span></div>
      <div class="tile"><b class="num">${tnWL(yr)}</b><span>${y} singles W–L</span></div>
      <div class="tile"><b class="num">${(sp.titles || []).filter(t => new Date(t.ts * 1000).getFullYear() === +y).length}</b><span>${y} titles</span></div>
      <div class="tile"><b class="num">${es?.singlesWon != null ? `${es.singlesWon}–${es.singlesLost}` : '–'}</b><span>Career singles W–L</span></div>
      <div class="tile"><b class="num">${es?.singlesTitles ?? '–'}</b><span>Career singles titles</span></div>
      <div class="tile"><b class="num">${es?.prize ? '$' + (es.prize >= 1e6 ? (es.prize / 1e6).toFixed(1) + 'M' : Math.round(es.prize / 1e3) + 'K') : '–'}</b><span>Career prize money</span></div></div>`;
    if (sp.form?.length) h += `<div class="sub-h"><h5>Form</h5><small>Last ${sp.form.length} singles, newest first</small></div><div class="tn-form">${sp.form.map(r => `<span class="res ${r}">${r}</span>`).join('')}</div>`;
    if (p.upcoming?.length) h += `<div class="sub-h"><h5>Next</h5></div><div class="cards">${p.upcoming.slice(0, 3).map(m => tnLogRow(m, p.id)).join('')}</div>`;
    h += `<div class="sub-h"><h5>Latest matches</h5><button class="linkbtn" data-tab="log">All matches ›</button></div><div class="cards">${singles.slice(0, 6).map(m => tnLogRow(m, p.id)).join('') || '<div class="note">No recent singles matches.</div>'}</div>`;
    if (sp.titles?.length) h += `<div class="sub-h"><h5>Recent titles</h5><small>${sp.titles.length} in this span</small></div>${tnTitles(sp.titles.slice(0, 5))}`;
    return h + `<p class="srcnote">${n ? `Season numbers cover the matches Flashscore lists since ${esc(fmtDate((singles[singles.length - 1]?.ts || 0) * 1000, { month: 'short', year: 'numeric' }))}. ` : ''}Career totals from ESPN for players in its top rankings.</p>`;
  }
  if (v.tab === 'stats') {
    if (!n) return `<div class="note">No serve and return stats published for this player's recent matches.</div>`;
    const g = k => T[k] || [0, 0], per = x => (x / n).toFixed(1);
    const svPts = g('svPts'), first = g('first'), fw = g('firstWon'), sw = g('secondWon'), bps = g('bpSaved'), svg = g('svGames'), r1 = g('ret1'), r2 = g('ret2'), bpc = g('bpConv'), rg = g('retGames'), rp = g('retPts'), tp = g('totPts'), tg = g('totGames');
    const tile = (val, lab) => `<div class="tile"><b class="num">${val}</b><span>${lab}</span></div>`;
    return `<div class="sub-h" style="margin-top:0"><h5>Serve</h5><small>Last ${n} singles matches with stats</small></div><div class="tiles pred-tiles">
        ${tile(per(g('aces')[0]), 'Aces a match')}${tile(per(g('df')[0]), 'Double faults a match')}${tile(tnPc(first[0], first[1]), '1st serves in')}
        ${tile(tnPc(fw[0], fw[1]), '1st-serve points won')}${tile(tnPc(sw[0], sw[1]), '2nd-serve points won')}${tile(tnPc(svPts[0], svPts[1]), 'Service points won')}
        ${tile(tnPc(svg[0], svg[1]), 'Service games held')}${tile(tnPc(bps[0], bps[1]), `Break points saved (${bps[0]}/${bps[1]})`)}${tile(svg[1] ? (bps[1] / (svg[1] / 10)).toFixed(1) : '–', 'Break points faced per 10 service games')}</div>
      <div class="sub-h"><h5>Return</h5></div><div class="tiles pred-tiles">
        ${tile(tnPc(r1[0], r1[1]), 'Points won returning 1st serve')}${tile(tnPc(r2[0], r2[1]), 'Points won returning 2nd serve')}${tile(tnPc(rp[0], rp[1]), 'Return points won')}
        ${tile(tnPc(rg[0], rg[1]), 'Return games won (breaks)')}${tile(tnPc(bpc[0], bpc[1]), `Break points converted (${bpc[0]}/${bpc[1]})`)}${tile(rg[1] ? (bpc[1] / (rg[1] / 10)).toFixed(1) : '–', 'Break chances per 10 return games')}</div>
      <div class="sub-h"><h5>Overall & under pressure</h5></div><div class="tiles pred-tiles">
        ${tile(tnPc(tp[0], tp[1]), 'Total points won')}${tile(tnPc(tg[0], tg[1]), 'Total games won')}${tile(svPts[1] && rp[1] ? ((svPts[0] / svPts[1]) + (rp[0] / rp[1])).toFixed(2) : '–', 'Dominance (serve + return points won)')}
        ${tile(tnWL(sp.tiebreaks), `Tiebreaks won (${tnWLp(sp.tiebreaks)})`)}${tile(tnWL(sp.deciding), `Deciding sets (${tnWLp(sp.deciding)})`)}${tile(sp.sets ? tnWL(sp.sets) : '–', `Sets won–lost (${tnWLp(sp.sets)})`)}
        ${tile(tnWL(sp.afterSet1?.won1), `After winning set 1 (${tnWLp(sp.afterSet1?.won1)})`)}${tile(tnWL(sp.afterSet1?.lost1), `After losing set 1 (${tnWLp(sp.afterSet1?.lost1)})`)}${tile(g('mpSaved')[0], 'Match points saved')}</div>
      <p class="srcnote">Built from Flashscore's stats for each match (walkovers left out). Tiebreaks, sets and deciding sets count every singles match listed, not only those with stats.</p>`;
  }
  if (v.tab === 'splits') {
    const tbl = (title, obj, ord) => { const rows = Object.entries(obj || {}).sort((a, b) => ord ? ord.indexOf(a[0]) - ord.indexOf(b[0]) : (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])); if (!rows.length) return '';
      return `<div class="sub-h"><h5>${title}</h5></div><div class="tn-split">${rows.map(([k, x]) => { const w = x[0] / Math.max(1, x[0] + x[1]);
        return `<div><span>${esc(k)}</span><span class="tn-bar"><i style="width:${w * 100}%"></i></span><b class="num">${x[0]}–${x[1]}</b><small class="num">${Math.round(w * 100)}%</small></div>` }).join('')}</div>` };
    return tbl('By surface', sp.surface, ['Hard', 'Clay', 'Grass', 'Carpet', 'Other']) + tbl('Indoor or outdoor', sp.indoor) + tbl('By level', sp.level) + tbl('By year', sp.year, Object.keys(sp.year || {}).sort().reverse())
      + `<div class="sub-h"><h5>Close calls</h5></div><div class="tn-split">${[['Tiebreaks', sp.tiebreaks], ['Deciding sets', sp.deciding], ['After winning the first set', sp.afterSet1?.won1], ['After losing the first set', sp.afterSet1?.lost1]].map(([k, x]) => { const w = x ? x[0] / Math.max(1, x[0] + x[1]) : 0;
        return `<div><span>${k}</span><span class="tn-bar"><i style="width:${w * 100}%"></i></span><b class="num">${tnWL(x)}</b><small class="num">${x && x[0] + x[1] ? Math.round(w * 100) + '%' : '–'}</small></div>` }).join('')}</div>
      <p class="srcnote">Singles matches Flashscore lists for this player (about the last ${Math.max(1, Object.keys(sp.year || {}).length)} season${Object.keys(sp.year || {}).length === 1 ? '' : 's'}), walkovers counted as wins or losses.</p>`;
  }
  if (v.tab === 'log') {
    const f = v.mfilter || 'S', ms = p.matches.filter(m => f === 'all' || m.disc === f || (f === 'D' && m.disc === 'X'));
    return `<div class="quick">${[['S', 'Singles'], ['D', 'Doubles'], ['all', 'All']].map(([k, l]) => `<button class="qf" data-tnact="mfilter" data-to="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      <div class="tbl-wrap"><table class="ctable tn-log"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Tournament</th><th style="text-align:left">Opponent</th><th></th><th style="text-align:left">Score</th></tr></thead><tbody>
      ${ms.map(m => { const me = (m.home.id || '').split('/').includes(p.id) ? 'home' : 'away', op = me === 'home' ? 'away' : 'home', won = m.winner === me;
        const score = m[me].games.map((g, i) => `${g}${m[me].tb[i] != null && m[op].tb[i] != null ? `<sup>${Math.min(m[me].tb[i], m[op].tb[i])}</sup>` : ''}-${m[op].games[i]}`).join(' ');
        return `<tr data-tnlog="${esc(m.id)}"><td class="t">${esc(fmtDate(m.ts * 1000, { day: 'numeric', month: 'short', year: '2-digit' }))}</td><td class="tn-l tn-tn">${esc(m.tnName)} ${tnSurf(m.surface)}<small>${esc(m.levelName)}</small></td>
          <td class="tn-l">${m[op].players?.map(x => `<button class="linkbtn" data-tnplayer="${esc(x.id)}" data-tnslug="${esc(x.slug || '')}" data-tnname="${esc(x.name)}">${esc(x.name)}</button>`).join(' / ') || esc(m[op].name)}</td>
          <td>${m.state === 'post' && m.winner ? `<span class="res ${won ? 'W' : 'L'}">${won ? 'W' : 'L'}</span>` : ''}</td><td class="tn-l num">${score}${m.code === '8' ? ' ret.' : m.code === '9' ? ' w/o' : ''}</td></tr>` }).join('') || '<tr><td colspan="5">No matches.</td></tr>'}</tbody></table></div>`;
  }
  if (v.tab === 'titles') {
    const t = sp.titles || []; if (!t.length) return `<div class="note">No singles titles in the matches Flashscore lists for this player.</div>`;
    return `<div class="sub-h" style="margin-top:0"><h5>Singles titles</h5><small>${t.length} in the span listed${v.espnStats?.singlesTitles != null ? ` · ${v.espnStats.singlesTitles} in their career (ESPN)` : ''}</small></div>${tnTitles(t)}
      <p class="srcnote">A title is an event where the player won the last match they played and the event was over. Exhibitions, qualifying and group stages are left out.</p>`;
  }
  return '';
}
function tnTitles(list){ return `<div class="fbsched">${list.map(t => `<div class="fx"><span class="d">${esc(fmtDate(t.ts * 1000, { month: 'short', year: 'numeric' }))}</span><span class="vs"><span><b>${esc(t.tn)}</b> <small class="tn-mut">${esc(t.level)}</small></span></span><span class="r">${tnSurf(t.surface)} <small class="tn-mut">beat ${esc(t.opp)}</small></span></div>`).join('')}</div>` }
function tnLogRow(m, pid){
  const me = (m.home.id || '').split('/').includes(pid) ? 'home' : 'away', op = me === 'home' ? 'away' : 'home', won = m.winner === me;
  return `<button class="m tn-m tn-logm" data-tnlog="${esc(m.id)}" style="--hc:${m.state === 'post' ? (won ? 'var(--win,#2e9d5b)' : 'var(--loss,#c94a4a)') : 'var(--line)'};--ac:${m.state === 'post' ? (won ? 'var(--win,#2e9d5b)' : 'var(--loss,#c94a4a)') : 'var(--line)'}">
    <div class="st">${m.state === 'pre' ? `<span class="ko">${esc(fmtDate(m.ts * 1000))}</span>` : esc(fmtDate(m.ts * 1000))}</div>
    <div class="tms"><div class="tm"><span>${m.state === 'post' && m.winner ? `<span class="res ${won ? 'W' : 'L'}">${won ? 'W' : 'L'}</span> ` : ''}vs ${esc(m[op].name)}</span></div><small class="tn-round">${esc(m.tnName)} · ${esc(m.levelName)}${m.surface ? ' · ' + esc(m.surface) : ''}</small></div>
    <div class="sc num tn-logsc">${m[me].games.map((g, i) => `${g}-${m[op].games[i]}`).join(' ')}</div></button>`;
}
// a match from a player's log: open it as a match page (it may not be in today's list)
function tnOpenLogMatch(v, id){
  const m = [...(v.p?.matches || []), ...(v.p?.upcoming || [])].find(x => x.id === id); if (!m) return;
  if (!S.tn.matches.has(m.id)) { S.tn.matches.set(m.id, { ...m, date: new Date(m.ts * 1000) }); if (!S.tn.tours[m.tn]) S.tn.tours[m.tn] = { id: m.tn, name: m.tnName, level: m.level, disc: m.disc, surface: m.surface, indoor: m.indoor, tour: m.levelName, path: m.tnPath, qual: m.qual } }
  const e = S.tn.matches.get(m.id); pushView({ type: 'tngame', id: e.id, e, tab: e.state === 'pre' ? 'pred' : 'summary' }); tnLoadGame(S.stack[S.stack.length - 1]);
}

/* ---------- tournament sheet ---------- */
function openTnTour(id){
  const t = S.tn.tours[id]; if (!t) return;
  S.sel = null; S.stack = [{ type: 'tntour', id, t, tab: 'today' }];
  renderSheet(); $('sheet').classList.add('open');
  const v = S.stack[0];
  if (t.path) getJSON(`/api/tn/tournament?path=${encodeURIComponent(t.path)}`).then(d => { v.d = d; for (const tt of Object.values(d.tours || {})) if (!S.tn.tours[tt.id]) S.tn.tours[tt.id] = tt;
    for (const m of [...(d.results || []), ...(d.fixtures || [])]) if (!S.tn.matches.has(m.id)) S.tn.matches.set(m.id, { ...m, date: new Date(m.ts * 1000) }); S.stack.includes(v) && renderSheet() }).catch(() => { v.err = true; S.stack.includes(v) && renderSheet() });
}
function tnTourSheet(v){
  const t = v.t, sheet = $('sheet'), back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  const tabs = [['today', 'Today'], ['res', 'Results'], ['fix', 'Upcoming']];
  let body;
  if (v.tab === 'today') { const evs = Object.values(S.tn.days).flatMap(d => d.events || []).filter(e => e.tn === v.id); const seen = new Set(); body = `<div class="cards">${evs.filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.date - b.date).map(tnCard).join('') || '<div class="note">No matches in the days loaded.</div>'}</div>` }
  else { const list = v.d?.[v.tab === 'res' ? 'results' : 'fixtures'];
    body = v.err ? `<div class="note">Couldn't load this tournament.</div>` : !list ? tnLoading() : !list.length ? `<div class="note">${v.tab === 'res' ? 'No results yet.' : 'No matches scheduled yet.'}</div>`
      : `<div class="cards">${list.slice(0, 150).map(m => tnCard(S.tn.matches.get(m.id) || { ...m, date: new Date(m.ts * 1000) })).join('')}</div>` }
  S.curTabs = tabs;
  sheet.innerHTML = `<div class="sheet-body"><div class="hero solo" style="--tc:var(--accent)">${topBar(back)}<div class="thead"><div><h3>${esc(t.name)}</h3><p><span class="tn-lvl tn-l-${esc(t.level)}">${esc(TNL[t.level]?.name || '')}</span>${t.country ? `<span>${esc(t.country)}</span>` : ''}${t.surface ? `<span>${esc(t.surface)}${t.indoor ? ' · indoor' : ''}</span>` : ''}<span>${t.disc === 'D' ? 'Doubles' : t.disc === 'X' ? 'Mixed doubles' : 'Singles'}</span>${t.stage ? `<span>${esc(t.stage)}</span>` : ''}</p></div></div></div>${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel">${body}</div></div>`;
}

/* ---------- sheet routing ---------- */
function tnRenderSheet(v){
  if (v.type === 'tntour') return tnTourSheet(v);
  const sheet = $('sheet'), back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  let hero, tabs, body;
  if (v.type === 'tngame') { hero = tnHero(v, back); tabs = tnGameTabs(v); if (!tabs.some(t => t[0] === v.tab)) v.tab = tabs[0][0]; body = tnPane(v) }
  else { hero = tnPlayerHero(v, back); tabs = [['overview', 'Overview'], ['stats', 'Stats'], ['splits', 'Splits'], ['log', 'Matches'], ['titles', 'Titles']]; body = tnPlayerPane(v) }
  S.curTabs = tabs;
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  sheet.innerHTML = `<div class="sheet-body">${hero}${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel" style="--tc:var(--accent)">${body}</div></div>`;
  sheet.querySelector('.sheet-body').scrollTop = scroll;
}

/* ---------- search ---------- */
let tnSearchSeq = 0;
async function tnSearch(q){
  const box = $('sres'); if (!box) return;
  q = q.trim(); if (q.length < 2) { box.hidden = true; return }
  const seq = ++tnSearchSeq;
  box.innerHTML = '<div class="sr-none">Searching…</div>'; box.hidden = false;
  let P = [];
  try { P = (await getJSON(`/api/tn/search?q=${encodeURIComponent(q)}`)).players || [] } catch {}
  if (seq !== tnSearchSeq) return;
  const today = Object.values(S.tn.days).flatMap(d => d.events || []).filter(e => `${e.home.name} ${e.away.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  let h = '';
  if (P.length) h += `<div class="sr-h">Players</div>` + P.map(x => `<button class="sr" data-tnplayer="${esc(x.id)}" data-tnslug="${esc(x.slug)}"><img class="face espn-shot" src="${esc(x.img || SIL)}" alt="" ${tnFaceErr}><div><strong>${esc(x.name)}</strong><small>${esc([x.country, x.gender].filter(Boolean).join(' · '))}</small></div></button>`).join('');
  if (today.length) h += `<div class="sr-h">Matches</div>` + today.map(e => `<button class="sr" data-tngame="${esc(e.id)}"><div><strong>${esc(e.home.name)} v ${esc(e.away.name)}</strong><small>${esc(tnTour(e).name || '')} · ${e.state === 'in' ? 'Live' : e.state === 'post' ? 'Finished' : e.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div></button>`).join('');
  box.innerHTML = h || `<div class="sr-none">No tennis players match “${esc(q)}”.</div>`; box.hidden = false;
}

/* ---------- hooks into the main app ---------- */
(function tnInstall(){
  const sw = document.querySelector('.sport-sw');
  if (sw && !sw.querySelector('[data-sport="tennis"]')) sw.insertAdjacentHTML('beforeend', `<button role="tab" data-sport="tennis" class="sp-tennis">Tennis</button>`);
  if (!$('tn')) { const sec = document.createElement('section'); sec.id = 'tn'; sec.hidden = true; sec.setAttribute('aria-label', 'Tennis'); const sheet = $('sheet'); sheet.parentNode.insertBefore(sec, sheet) }
  const _render = render;
  render = function(){
    if (S.sport !== 'tennis') { $('tn').hidden = true; return _render.apply(this, arguments) }
    document.querySelectorAll('.sport-sw button').forEach(b => { const on = b.dataset.sport === 'tennis'; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) });
    document.querySelectorAll('main.shell > section').forEach(s => { s.hidden = s.id !== 'tn' });
    document.querySelector('.shell').classList.remove('mk-page');
    renderTennis(); tnTicker();
  };
  const _sheet = renderSheet;
  renderSheet = function(){ const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('tn')) return tnRenderSheet(v); return _sheet.apply(this, arguments) };
  const _search = searchAll;
  searchAll = function(q){ if (S.sport === 'tennis') return tnSearch(q); return _search.apply(this, arguments) };
  const _openLeague = openLeague;
  openLeague = function(){ if (S.sport === 'tennis') return; return _openLeague.apply(this, arguments) };
})();
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-tnlg],[data-tnview],[data-tngame],[data-tnplayer],[data-tnfind],[data-tnact],[data-tnfilter],[data-tndisc],[data-tntour],[data-tnlog]'); if (!t) return;
  ev.stopPropagation(); hideResults();
  if (t.dataset.tnlg) { S.tn.lg = t.dataset.tnlg; S.tn.view = 'matches'; store.set('fl.tnLg', S.tn.lg); store.set('fl.tnView', 'matches'); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.tnview) { S.tn.view = t.dataset.tnview; store.set('fl.tnView', S.tn.view); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.tnfilter) { S.tn.filter = t.dataset.tnfilter; return render() }
  if (t.dataset.tndisc) { S.tn.disc = t.dataset.tndisc; store.set('fl.tnDisc', S.tn.disc); return render() }
  if (t.dataset.tngame) { openTnGame(t.dataset.tngame, t.dataset.tntab); return }
  if (t.dataset.tntour) return openTnTour(t.dataset.tntour);
  if (t.dataset.tnplayer != null && (t.dataset.tnplayer || t.dataset.tnname)) return openTnPlayer(t.dataset.tnplayer, t.dataset.tnslug, t.dataset.tnname);
  if (t.dataset.tnfind) return tnFindPlayer(t.dataset.tnfind, t.dataset.tnft);
  const v = S.stack[S.stack.length - 1];
  if (t.dataset.tnlog && v?.type === 'tnplayer') return tnOpenLogMatch(v, t.dataset.tnlog);
  const a = t.dataset.tnact;
  if (a === 'day') { const n = +t.dataset.to; S.tn.off = n ? Math.max(-7, Math.min(7, S.tn.off + n)) : 0; return render() }
  if (a === 'more') { (S.tn.open ||= {})[t.dataset.to] = true; return renderTennis() }
  if (a === 'ranktour') { S.tn.rankTour = t.dataset.to; store.set('fl.tnRankTour', S.tn.rankTour); return renderTnRank() }
  if (!v) return;
  if (a === 'period') { v.period = +t.dataset.to; return renderSheet() }
  if (a === 'pset') { v.pset = +t.dataset.to; return renderSheet() }
  if (a === 'hsurf') { v.hsurf = +t.dataset.to; return renderSheet() }
  if (a === 'mfilter') { v.mfilter = t.dataset.to; return renderSheet() }
  if (a === 'fav' && v.type === 'tnplayer' && v.p) { const id = 'tn-' + v.id;
    S.fav = S.fav.some(f => f.id === id) ? S.fav.filter(f => f.id !== id) : [...S.fav, { id, tid: v.id, sport: 'tennis', slug: v.slug, name: v.p.name, logo: v.espn?.photo || v.p.photo || '' }];
    savePrefs(); renderSheet(); if (S.sport === 'tennis') tnRail() }
}, true);
document.addEventListener('input', ev => { const t = ev.target.closest('[data-tnrq]'); if (!t) return; S.tn.rankQ = t.value; clearTimeout(tnSearchSeq.t); const pos = t.selectionStart;
  renderTnRank().then(() => { const i = document.querySelector('[data-tnrq]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos) } catch {} } }) });
PFX.on('tennis', () => S.sport === 'tennis' && S.tn.view === 'picks' && renderTnPicks());
setInterval(() => { if (document.hidden || S.sport !== 'tennis') return;
  const d = S.tn.days[S.tn.off]; if (S.tn.view === 'matches' && d?.events.some(e => e.state === 'in' || (e.state === 'pre' && e.date < Date.now() + 10 * 6e4))) { d.at = 0; renderTennis() }
  const v = S.stack[0]; if (v?.type === 'tngame' && v.e.state === 'in') { const cur = S.tn.days[0]; if (cur) cur.at = 0; tnLoadDay(0).then(() => tnLoadGame(v)) } }, 20000);
document.head.insertAdjacentHTML('beforeend', `<style>
#tn{min-width:0}
.tn-sep{width:1px;align-self:stretch;background:var(--line);margin:0 4px}
.tn-gh{flex-wrap:wrap;gap:6px}
.tn-gh .tn-tname{font:inherit;color:inherit;text-align:left}
.tn-gh .tn-gn{margin-left:auto;color:var(--muted);font:600 11px/1 var(--f-mono)}
.tn-lvl{display:inline-block;font:700 9.5px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.04em;padding:3px 6px;border-radius:5px;background:var(--surface-2);color:var(--fg);white-space:nowrap}
.tn-l-slam{background:#1f6f43;color:#fff}.tn-l-atp{background:#1a4b8c;color:#fff}.tn-l-wta{background:#7a2b83;color:#fff}.tn-l-chm{background:#2f6fa8;color:#fff}.tn-l-chw{background:#9b4fa3;color:#fff}
.tn-dot.tn-l-slam,.tn-dot.tn-l-atp,.tn-dot.tn-l-wta,.tn-dot.tn-l-chm,.tn-dot.tn-l-chw,.tn-dot.tn-l-itfm,.tn-dot.tn-l-itfw,.tn-dot.tn-l-other,.tn-dot.tn-l-junior{background:none;padding:0}
.tn-dot.tn-l-slam{color:#1f6f43}.tn-dot.tn-l-atp{color:#1a4b8c}.tn-dot.tn-l-wta{color:#7a2b83}.tn-dot.tn-l-chm{color:#2f6fa8}.tn-dot.tn-l-chw{color:#9b4fa3}
.tn-surf{display:inline-block;font:600 9.5px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.04em;padding:3px 6px;border-radius:999px;background:var(--surface-2);color:var(--muted)}
.tn-surf.tn-clay{background:#c8643b22;color:#b5552d}.tn-surf.tn-grass{background:#3c9a4a22;color:#2d8a3b}.tn-surf.tn-hard{background:#2f6fa822;color:#2f6fa8}
.m.tn-m{grid-template-columns:56px minmax(0,1fr)}
.tn-m .tms{gap:4px}
.tn-row{display:grid!important;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center}
.tn-face{width:22px;height:22px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
.tn-pair{display:inline-flex;width:22px;height:22px;position:relative}.tn-pair img{width:15px;height:15px;border-radius:50%;object-fit:cover;background:var(--surface-2);position:absolute}.tn-pair img:first-child{left:0;top:0}.tn-pair img:nth-child(2){right:0;bottom:0;outline:2px solid var(--surface)}
.tn-pair.big{width:56px;height:56px}.tn-pair.big img{width:38px;height:38px}
.tn-nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tn-rk{font:600 10.5px/1 var(--f-mono);color:var(--muted);margin-left:2px}
.tn-win{color:var(--accent);font-style:normal;font-weight:800}
.tn-serve{display:inline-block;width:7px;height:7px;border-radius:50%;background:#d6e04a;box-shadow:0 0 0 1px #9aa21f;margin-right:5px;vertical-align:1px}
.tn-sets{display:flex;gap:3px;align-items:center;font:700 14px/1 var(--f-mono)}
.tn-sets .tn-s{min-width:16px;text-align:center;color:var(--accent);font-size:14.5px;margin-right:4px}
.tn-g{min-width:15px;text-align:center;color:var(--muted);font-weight:600}.tn-g.w{color:var(--fg);font-weight:800}
.tn-g sup,.tn-qtr sup,.tn-setlist sup,.tn-log sup{font-size:8.5px;margin-left:1px;color:var(--muted)}
.tn-pt{min-width:24px;margin-left:4px;padding:2px 4px;border-radius:4px;background:color-mix(in oklab,var(--live) 16%,transparent);color:var(--live);text-align:center;font-size:12px}
.tm.lose .tn-nm{color:var(--muted);font-weight:500}
.tn-round{display:block;font:500 10.5px/1.2 var(--f-body);color:var(--muted)}
.tn-railface{width:20px;height:20px;border-radius:50%;object-fit:cover}
.tn-hface{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
.tn-side.lose strong{opacity:.65}
.tn-qtr{max-width:420px}.tn-qtr td.t{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tn-qtr td.tn-w{font-weight:800}
.tn-setlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px}
.tn-setlist div{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:1px solid var(--line);border-radius:10px}
.tn-setlist span{font:600 10.5px/1 var(--f-body);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.tn-setlist b{font-size:18px}.tn-setlist small{color:var(--muted);font-size:11px}
.tn-now{font-size:13px;margin:0}
.tn-pbp{list-style:none;margin:6px 0;padding:0}
.tn-pbp li{display:grid;grid-template-columns:44px minmax(0,1fr);gap:4px 10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.tn-pbp li.brk .tn-gs{color:var(--live)}
.tn-gs{font:700 13px/1 var(--f-mono)}
.tn-srv{color:var(--muted)}.tn-srv b{color:var(--live)}
.tn-pts{grid-column:2;display:flex;flex-wrap:wrap;gap:3px}
.tn-pts i{font:500 10.5px/1 var(--f-mono);font-style:normal;padding:2px 4px;border-radius:4px;background:var(--surface-2)}
.tn-pts i.bp{background:color-mix(in oklab,var(--live) 20%,transparent);color:var(--live)}.tn-pts i.sp,.tn-pts i.mp{background:color-mix(in oklab,var(--accent) 22%,transparent)}
.tn-h2hsum{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin:10px 0;text-align:center}
.tn-h2hsum div{display:flex;flex-direction:column;gap:2px}.tn-h2hsum b{font-size:28px}.tn-h2hsum span{font-size:12px;color:var(--muted)}.tn-h2hsum small{color:var(--muted);font-size:11.5px}
.tn-form{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 8px}
.tn-books{display:grid;gap:2px;font-size:13px}
.tn-bh,.tn-br{display:grid;grid-template-columns:minmax(0,1.2fr) 1fr 1fr minmax(0,1fr);gap:8px;padding:7px 6px;align-items:center}
.tn-bh{font:600 10.5px/1.2 var(--f-body);text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.tn-bh span,.tn-br span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tn-br{border-top:1px solid var(--line)}.tn-br .best{font-weight:800;color:var(--accent)}
.tn-mut{color:var(--muted)}
.tn-up{color:#2e9d5b}.tn-down{color:#c94a4a}
.tn-rank td,.tn-rank th{white-space:nowrap}.tn-rface{width:26px;height:26px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
.tn-flag{width:16px;height:11px;object-fit:cover;border-radius:2px;margin-right:5px;vertical-align:-1px}
.tn-rq{margin-left:auto;min-height:30px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:500 12.5px var(--f-body);min-width:0;width:200px;max-width:100%}
.tn-inj{color:var(--live);font-weight:600}
.tn-split{display:grid;gap:2px}
.tn-split div{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(60px,1.4fr) auto 40px;gap:10px;align-items:center;padding:7px 4px;border-top:1px solid var(--line);font-size:13px}
.tn-bar{height:7px;border-radius:999px;background:var(--surface-2);overflow:hidden}.tn-bar i{display:block;height:100%;background:var(--accent);border-radius:999px}
.tn-split small{color:var(--muted);text-align:right}
td.tn-l{text-align:left!important;white-space:nowrap}td.tn-tn{white-space:normal;min-width:120px}td.tn-l small{color:var(--muted);font-size:10.5px;margin-left:6px}
.tn-log tr[data-tnlog]{cursor:pointer}
.m.tn-logm{grid-template-columns:56px minmax(0,1fr) auto}.tn-logsc{font:700 13px/1.2 var(--f-mono)!important}
.tn-favbtn{min-height:30px;padding:0 12px;font-size:12.5px}
@media (max-width:520px){ .tn-sets{font-size:13px} .tn-g{min-width:12px} .tn-rq{width:100%;margin-left:0} .tn-split div{grid-template-columns:minmax(0,1fr) 70px auto 34px;gap:6px} }
</style>`);
if (S.sport === 'tennis') { S.stack = []; const sh = $('sheet'); if (sh && !sh.querySelector('.sheet-empty')) { sh.innerHTML = emptySheet(); sh.classList.remove('open') } setTimeout(render, 0) }
