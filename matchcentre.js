/* Floodlight · the match centre: one game, opened over the page you were on.
   A game on Home or Live opens here instead of leaving the feed, so closing it puts you back exactly where you were.
   Everything shown is read from the game's own public feed (ESPN's game summary: plays, scores by period, lineups,
   recent form, the season series, TV listing) and nothing is estimated here except what is plainly counted from the
   plays themselves: lead changes, ties, the biggest lead and unanswered runs. A section with no data in the feed is
   left out rather than filled in. "Catch me up" is those counted facts written as sentences; no AI writes it.
   Spoiler-free: scores can be hidden for one game or for every game, on the cards and in here, until you reveal them. */
(() => {
  const root = document.documentElement;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  const CAN = new Set(['soccer', 'football', 'basketball', 'hockey', 'baseball']);   // the sports whose feed has a game summary
  const UNIT = { soccer: ['goal', 'goals'], hockey: ['goal', 'goals'], baseball: ['run', 'runs'], football: ['point', 'points'], basketball: ['point', 'points'] };
  const RUN_MIN = { basketball: 8, football: 14, hockey: 3, soccer: 3, baseball: 4 };   // unanswered scoring worth a mention
  const LIVE_MS = 20000, IDLE_MS = 90000;
  const M = { odds: null, oddsAt: 0, oddsErr: '', oddsBusy: false, g: null, d: null, at: 0, err: '', loading: false, timer: 0, tick: 0, sel: null, every: false, mode: 'lead', from: null, seq: 0 };

  /* ---------- spoiler-free ---------- */
  const SP = store.get('fl.spoil', { all: false, hide: [], show: [] });
  const saveSp = () => { SP.hide = SP.hide.slice(-200); SP.show = SP.show.slice(-200); store.set('fl.spoil', SP); root.classList.toggle('no-spoil', !!SP.all); document.dispatchEvent(new CustomEvent('fl:spoil')) };
  const spoil = key => !!key && !SP.show.includes(key) && (SP.all || SP.hide.includes(key));
  function setSpoil(key, hide) { SP.hide = SP.hide.filter(k => k !== key); SP.show = SP.show.filter(k => k !== key); (hide ? SP.hide : SP.show).push(key); if (!hide && !SP.all) SP.show = SP.show.filter(k => k !== key); saveSp() }
  function setSpoilAll(on) { SP.all = !!on; SP.show = []; if (!on) SP.hide = []; saveSp() }
  root.classList.toggle('no-spoil', !!SP.all);

  /* ---------- reading the feed ---------- */
  const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('It took too long to answer.')), ms))]);
  const hex = c => c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c : '';
  const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null };
  function norm(raw, g) {
    const sport = g.sport, comp = raw.header?.competitions?.[0] || {}, cs = comp.competitors || [];
    const home = cs.find(c => c.homeAway === 'home') || cs[0] || {}, away = cs.find(c => c.homeAway === 'away') || cs[1] || {};
    const team = c => ({ id: String(c.team?.id || c.id || ''), name: c.team?.shortDisplayName || c.team?.name || c.team?.displayName || '', full: c.team?.displayName || '', abbr: c.team?.abbreviation || '', logo: c.team?.logos?.[0]?.href || c.team?.logo || '',
      color: hex(c.team?.color), score: c.score ?? '', record: (c.record || []).find(r => r.type === 'total')?.displayValue || c.record?.[0]?.displayValue || c.record?.[0]?.summary || '', lines: (c.linescores || []).map(l => l.displayValue), winner: !!c.winner, home: c.homeAway === 'home' });
    const us = sport !== 'soccer', a = team(us ? away : home), b = team(us ? home : away);   // the same order the cards use
    // logos are thin in the summary header for some sports: fall back to the scoreboard's
    for (const [t, s] of [[a, g.a], [b, g.b]]) { if (!t.logo) t.logo = s?.logo || ''; if (!t.name) t.name = s?.name || ''; if (!t.color) t.color = s?.color || '' }
    const st = comp.status?.type || {}, state = st.state || g.state || 'pre';
    const ab = (hs, as) => a.home ? [hs, as] : [as, hs];

    /* every play the feed lists, oldest first, in one shape */
    let src = [];
    if (Array.isArray(raw.plays) && raw.plays.length) src = raw.plays.map(p => ({ p, team: String(p.team?.id || '') }));
    else if (raw.drives) { const sc = new Map((raw.scoringPlays || []).map(p => [String(p.id), p]));
      src = [...(raw.drives.previous || []), ...(raw.drives.current ? [raw.drives.current] : [])].flatMap(dr => (dr.plays || []).map(p => ({ p, team: String(sc.get(String(p.id))?.team?.id || dr.team?.id || ''), type: sc.get(String(p.id))?.type?.text, short: sc.get(String(p.id))?.text })));
      const seen = new Set(); src = src.filter(x => !seen.has(x.p.id) && seen.add(x.p.id)) }
    else if (Array.isArray(raw.keyEvents)) src = raw.keyEvents.map(p => ({ p, team: String(p.team?.id || '') }));
    let sa = 0, sb = 0, counted = sport === 'soccer';
    const plays = src.map(({ p, team: tid, type, short }, i) => {
      const slug = p.type?.type || '', text = short || p.text || p.shortText || '', tt = type || p.type?.text || '';
      let kind = 'play';
      if (sport === 'soccer') kind = /goal|penalty---scored/.test(slug) && p.scoringPlay ? 'score' : /card/.test(slug) ? 'card' : /substitution/.test(slug) ? 'sub' : /kickoff|half|end-|start-/.test(slug) ? 'period' : 'play';
      else if (p.scoringPlay) kind = 'score';
      else if (/^end (of )?(the )?(period|quarter|half|game|regulation|inning)|^end /i.test(tt) || /^(end of|game end)/i.test(text)) kind = 'period';
      else if (sport === 'hockey' && /penalty/i.test(tt)) kind = 'card';
      else if (sport === 'football' && /intercept|fumble recovery \(opponent\)|blocked|safety/i.test(tt)) kind = 'turn';
      let pa, pb;
      if (counted) {   // soccer's key events carry no running score: count it from the goals, for the side the feed credits
        if (kind === 'score') { if (tid === a.id) sa++; else if (tid === b.id) sb++ }
        pa = sa; pb = sb;
      } else { const hs = num(p.homeScore), as = num(p.awayScore); if (hs == null || as == null) { pa = sa; pb = sb } else { [pa, pb] = ab(hs, as); sa = pa; sb = pb } }
      return { id: String(p.id || i), i, text, type: tt, kind, team: tid, a: pa, b: pb, period: p.period?.number || 0, pd: p.period?.displayValue || '', clock: p.clock?.displayValue || '', card: /red/.test(slug) ? 'red' : /yellow/.test(slug) ? 'yellow' : '', who: p.participants?.[0]?.athlete?.displayName || '' };
    });
    // counted soccer scores must end on the real score, or the count is not shown (an own goal credited the other way, say)
    const scoreOk = !counted || (state === 'pre') || (String(sa) === String(a.score) && String(sb) === String(b.score));

    /* the score through the game: one point per change */
    const pts = [{ i: -1, a: 0, b: 0, m: 0, play: null }];
    if (scoreOk) for (const p of plays) { const last = pts[pts.length - 1]; if (p.a !== last.a || p.b !== last.b) { p.changed = true; pts.push({ i: p.i, a: p.a, b: p.b, m: p.a - p.b, play: p }) } }
    /* counted from those points: lead changes, ties, biggest leads, unanswered runs */
    let lead = 0, changes = 0, ties = 0, bigA = 0, bigB = 0, run = null; const runs = [];
    for (const q of pts.slice(1)) {
      const prev = pts[pts.indexOf(q) - 1], side = q.a - prev.a > 0 && q.b === prev.b ? 'a' : q.b - prev.b > 0 && q.a === prev.a ? 'b' : '', by = side === 'a' ? q.a - prev.a : side === 'b' ? q.b - prev.b : 0;
      if (side && run && run.side === side) { run.n += by; run.end = q } else { if (run) runs.push(run); run = side ? { side, n: by, start: q, end: q } : null }
      const s = Math.sign(q.m);
      if (s && lead && s !== lead) { changes++; q.play.tag = 'Lead change' } else if (!s && prev.m) { ties++; q.play.tag = 'Tied' } else if (s && !lead && pts.indexOf(q) > 1 && prev.m === 0 && pts.some((x, k) => k < pts.indexOf(q) && x.m)) q.play.tag = Math.sign(pts.slice(0, pts.indexOf(q)).reverse().find(x => x.m)?.m || 0) !== s ? (changes++, 'Lead change') : 'Go-ahead';
      if (s) lead = s; bigA = Math.max(bigA, q.m); bigB = Math.max(bigB, -q.m);
    }
    if (run) runs.push(run);
    const minRun = RUN_MIN[sport] || 8, bigRuns = runs.filter(r => r.n >= minRun).sort((x, y) => y.n - x.n);
    for (const r of bigRuns.slice(0, 6)) if (r.end.play && !r.end.play.tag) r.end.play.tag = `${r.n}–0 run`;
    const nowRun = runs[runs.length - 1];

    /* ESPN's own live win chance, where the feed has one */
    const wp = new Map((raw.winprobability || []).map(w => [String(w.playId), w.homeWinPercentage]));
    const wps = wp.size ? plays.filter(p => wp.has(p.id)).map(p => ({ i: p.i, v: a.home ? wp.get(p.id) : 1 - wp.get(p.id), play: p })) : [];

    /* leaders, lineups, injuries, form, series, TV: each only if the feed has it */
    const leadersOf = t => { const blk = (raw.leaders || []).find(x => String(x.team?.id) === t.id); return (blk?.leaders || []).map(c => ({ cat: c.displayName || c.name, name: c.leaders?.[0]?.athlete?.displayName || '', val: c.leaders?.[0]?.displayValue || '', pos: c.leaders?.[0]?.athlete?.position?.abbreviation || '' })).filter(x => x.name && x.val) };
    const xi = t => { const r = (raw.rosters || []).find(x => String(x.team?.id) === t.id); if (!r?.roster?.length) return null;
      const row = p => ({ name: p.athlete?.displayName || '', num: p.jersey || '', pos: p.position?.abbreviation || '', off: !!p.subbedOut, on: !!p.subbedIn });
      return { formation: r.formation || '', start: r.roster.filter(p => p.starter).map(row), bench: r.roster.filter(p => !p.starter && p.subbedIn).map(row) } };
    const five = t => { const blk = (raw.boxscore?.players || []).find(x => String(x.team?.id) === t.id), st = blk?.statistics?.[0]; if (!st?.athletes?.some(x => x.starter)) return null;
      const L = st.labels || st.names || [], col = k => L.indexOf(k), pick = ['MIN', 'PTS', 'REB', 'AST'].filter(k => col(k) >= 0);
      if (!pick.length) return null;
      return { cols: pick, start: st.athletes.filter(x => x.starter).map(x => ({ name: x.athlete?.displayName || '', pos: x.athlete?.position?.abbreviation || '', num: x.athlete?.jersey || '', stats: pick.map(k => x.stats?.[col(k)] ?? '–') })) } };
    const hurt = t => ((raw.injuries || []).find(x => String(x.team?.id) === t.id)?.injuries || []).map(x => ({ name: x.athlete?.displayName || '', pos: x.athlete?.position?.abbreviation || '', status: x.status || x.type?.description || '' })).filter(x => x.name).slice(0, 8);
    const form = t => ((raw.lastFiveGames || []).find(x => String(x.team?.id) === t.id)?.events || []).map(e => ({ r: e.gameResult || '', opp: e.opponent?.abbreviation || e.opponent?.displayName || '', score: e.score || '', at: e.atVs === '@' ? 'at' : 'v', date: e.gameDate ? new Date(e.gameDate) : null })).filter(e => e.r).slice(0, 5);
    const ser = (raw.seasonseries || [])[0];
    const series = ser ? { title: ser.title || ser.seriesLabel || 'Series', summary: ser.summary || '', games: (ser.events || []).filter(e => String(e.id) !== String(g.id)).map(e => { const h = (e.competitors || []).find(c => c.homeAway === 'home') || {}, w = (e.competitors || []).find(c => c.homeAway === 'away') || {};
      return { date: e.date ? new Date(e.date) : null, done: e.status === 'post' || e.statusType?.completed, h: h.team?.abbreviation || h.team?.displayName || '', w: w.team?.abbreviation || w.team?.displayName || '', hs: h.score ?? '', ws: w.score ?? '' } }).sort((x, y) => (y.date || 0) - (x.date || 0)).slice(0, 5) } : null;
    const tv = [...new Set((raw.broadcasts || []).map(x => x.media?.shortName || x.station || x.media?.name).filter(Boolean))].slice(0, 4);
    const stats = (() => { const T = raw.boxscore?.teams || [], of = t => T.find(x => String(x.team?.id) === t.id)?.statistics || [], A = of(a), B = of(b);
      return A.map(s => ({ label: s.label || s.name, a: s.displayValue, b: B.find(x => x.name === s.name)?.displayValue })).filter(s => s.label && s.a != null && s.b != null).slice(0, 8) })();
    return { slug: raw.header?.league?.slug || '', sport, halves: sport === 'basketball' && /college/.test(g.path || ''), a, b, state, detail: st.shortDetail || st.detail || '', desc: st.description || '', date: comp.date ? new Date(comp.date) : g.date, plays, pts, scoreOk, changes, ties, bigA, bigB, bigRuns, nowRun, wps,
      periods: Math.max(a.lines.length, b.lines.length), leaders: { a: leadersOf(a), b: leadersOf(b) }, xi: { a: xi(a), b: xi(b) }, five: { a: five(a), b: five(b) }, hurt: { a: hurt(a), b: hurt(b) }, form: { a: form(a), b: form(b) }, series, tv,
      venue: raw.gameInfo?.venue?.fullName || g.venue || '', crowd: raw.gameInfo?.attendance || 0, stats,
      sit: raw.situation ? { text: raw.situation.downDistanceText || raw.situation.shortDownDistanceText || '', poss: String(raw.situation.possession || ''), red: !!raw.situation.isRedZone, last: raw.situation.lastPlay?.text || '' } : null };
  }

  async function load(quiet) {
    const g = M.g; if (!g || M.loading) return; const seq = M.seq;
    M.loading = true; if (!quiet) paint();
    try {
      const raw = await timeout(fetch(`${ESPN}${g.path}/summary?event=${encodeURIComponent(g.id)}`).then(r => { if (!r.ok) throw new Error(r.status === 404 ? 'This game has no detail feed yet.' : 'The game feed answered with an error.'); return r.json() }), 12000);
      if (seq !== M.seq) return;
      const prev = M.d; M.d = norm(raw, g); M.at = Date.now(); M.err = ''; say(prev, M.d); loadOdds();
    } catch (e) { if (seq !== M.seq) return; M.err = e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : 'The game feed did not answer.' }
    finally { if (seq === M.seq) { M.loading = false; paint() } }
  }

  /* ---------- prices, book by book ----------
     The same odds board the sport pages read (odds.py): each book's own price, the chance inside it, and which book has
     the best price for each side. Shown for comparison only. With one book posting there is nothing to compare, and the
     card says so. A book that did not answer is named. */
  const BOOKS = { draftkings: 'DraftKings', fanduel: 'FanDuel', kalshi: 'Kalshi', polymarket: 'Polymarket' };
  function oddsQuery(g, d) {
    const L = Object.values(window.flParlay?.LG || {}).find(x => x.path === g.path && x.board); if (!L) return null;
    const soccer = g.sport === 'soccer', lg = soccer ? d.slug : L.board[1]; if (!lg) return null;
    const home = d.a.home ? d.a : d.b, away = d.a.home ? d.b : d.a;
    return new URLSearchParams({ sport: L.board[0], lg, id: /^\d+$/.test(g.id) ? g.id : '', home: home.full || home.name, away: away.full || away.name, date: (d.date || g.date).toISOString(), kx: soccer ? '' : L.board[2], espn: soccer ? 'soccer/' + lg : L.path });
  }
  function loadOdds() {
    const g = M.g, d = M.d; if (!g || !d || M.oddsBusy || d.state === 'post') return;
    if (M.oddsAt && Date.now() - M.oddsAt < (d.state === 'in' ? 45000 : 5 * 60000)) return;
    const q = oddsQuery(g, d); if (!q) { M.odds = M.odds || { none: true }; return }
    const seq = M.seq; M.oddsBusy = true;
    timeout(fetch('/api/odds/board?' + q, { credentials: 'same-origin' }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'The prices did not load.'); return j }), 25000)
      .then(j => { if (seq !== M.seq) return; M.odds = j; M.oddsAt = Date.now(); M.oddsErr = '' }, e => { if (seq !== M.seq) return; M.oddsErr = e.message || 'The prices did not load.'; M.oddsAt = Date.now() - 30000 })
      .finally(() => { if (seq === M.seq) { M.oddsBusy = false; paint() } });
  }
  const am = p => p?.am == null ? '–' : (p.am > 0 ? '+' : '') + p.am;
  // sportsbooks set their own prices; exchanges and prediction markets are priced by the people trading on them
  const EXCH = new Set(['kalshi', 'polymarket']), isEx = of => !!of.exchange || EXCH.has(of.book);
  const grouped = offers => { const bk = offers.filter(o => !isEx(o)), ex = offers.filter(isEx);
    return bk.length && ex.length ? [{ head: 'Sportsbooks' }, ...bk, { head: 'Exchanges and prediction markets' }, ...ex] : ex.length ? [{ head: 'Exchanges and prediction markets' }, ...ex] : bk };
  function prices(d, hide) {
    const o = M.odds; if (d.state === 'post' || o?.none) return '';
    if (hide) return `<section class="card gx-card" id="gxs-px" data-gxk="px" aria-label="Prices">${`<div class="sec-h"><h3>Prices, book by book</h3></div>`}${hidden('Live prices show who is ahead')}</section>`;
    if (!o) return `<section class="card gx-card" id="gxs-px" data-gxk="px" aria-label="Prices"><div class="sec-h"><h3>Prices, book by book</h3></div>${M.oddsErr ? `<p class="gx-none">${esc(M.oddsErr)} <button type="button" class="bt sm" data-gx="odds">Try again</button></p>` : '<div class="skl" style="height:120px"></div>'}</section>`;
    const home = d.a.home ? 'a' : 'b', keyOf = t => (t === d[home] ? 'home' : 'away'), cols = d.sport === 'soccer' ? [[d.a, keyOf(d.a)], [null, 'draw'], [d.b, keyOf(d.b)]] : [[d.a, keyOf(d.a)], [d.b, keyOf(d.b)]];
    const offers = o.ml?.offers || [], many = offers.length > 1, bad = Object.keys(o.errors || {}).map(k => BOOKS[k] || k);
    const cell = (of, k, best) => { const p = of?.[k]; return `<td class="r num${best ? ' best' : ''}">${p ? `<b>${am(p)}</b><small>${Math.round(p.p * 100)}%</small>${best ? '<em class="pl gx-best">Best</em>' : ''}` : '<span class="lb">–</span>'}</td>` };
    const ml = offers.length ? `<div class="tbx-wrap"><table class="tbx gx-px"><caption class="sr-only">To win: each book's price and the chance inside it</caption><thead><tr><th scope="col">To win</th>${cols.map(([t]) => `<th scope="col" class="r">${esc(t ? t.abbr || t.name : 'Draw')}</th>`).join('')}</tr></thead>
      <tbody>${grouped(offers).map(x => x.head ? `<tr class="gx-grp"><th scope="colgroup" colspan="${cols.length + 1}">${x.head}</th></tr>` : `<tr><th scope="row">${esc(BOOKS[x.book] || x.book)}</th>${cols.map(([, k]) => cell(x, k, many && o.ml.best?.[k]?.book === x.book)).join('')}</tr>`).join('')}
        ${o.ml.fair && Object.keys(o.ml.fair).length ? `<tr class="gx-fair"><th scope="row">With the margin taken out</th>${cols.map(([, k]) => `<td class="r num">${o.ml.fair[k] != null ? Math.round(o.ml.fair[k] * 100) + '%' : '–'}</td>`).join('')}</tr>` : ''}</tbody></table></div>` : '';
    // the spread and total most books share (the one with the most prices; closest to even when tied)
    const main = (xs, ks) => [...(xs || [])].sort((x, y) => y.offers.length - x.offers.length || Math.abs((x.fair?.[ks[0]] ?? .5) - .5) - Math.abs((y.fair?.[ks[0]] ?? .5) - .5))[0];
    const sp = main(o.spreads, ['home']), tt = main(o.totals, ['over']), sgn = v => (v > 0 ? '+' : '') + v;
    const side = (label, off, k, best) => `<div class="gx-pxr"><span>${label}</span><span class="gx-pxb">${off.filter(x => x[k]).map(x => `<span class="${off.length > 1 && best?.[k]?.book === x.book ? 'best' : ''}"><small class="lb">${esc(BOOKS[x.book] || x.book)}</small> <b class="num">${am(x[k])}</b></span>`).join('') || '<span class="lb">–</span>'}</span></div>`;
    const hl = sp ? (d[home] === d.a ? sp.homeLine : -sp.homeLine) : null;
    const lines = sp || tt ? `<div class="gx-pxl">${sp ? side(`${esc(d.a.abbr || d.a.name)} ${sgn(hl)}`, sp.offers, keyOf(d.a), sp.best) + side(`${esc(d.b.abbr || d.b.name)} ${sgn(-hl)}`, sp.offers, keyOf(d.b), sp.best) : ''}${tt ? side(`Over ${tt.line}`, tt.offers, 'over', tt.best) + side(`Under ${tt.line}`, tt.offers, 'under', tt.best) : ''}</div>` : '';
    if (!ml && !lines) return `<section class="card gx-card" id="gxs-px" data-gxk="px" aria-label="Prices"><div class="sec-h"><h3>Prices, book by book</h3></div><p class="gx-none">No book we read has a price up for this game right now.${bad.length ? ` ${esc(bad.join(' and '))} did not answer.` : ''}</p></section>`;
    return `<section class="card gx-card" id="gxs-px" data-gxk="px" aria-label="Prices"><div class="sec-h"><h3>Prices, book by book</h3><span class="lb">${many ? 'Best price marked' : ''}</span></div>${ml}${lines}
      <p class="lb gx-pxn">Read <time data-gxago="${M.oddsAt}">${ago(M.oddsAt)}</time>; ${d.state === 'in' ? 're-read every 45 seconds while the game is live' : 're-read every 5 minutes before the start'}. ${!many && offers.length ? `Only ${esc(BOOKS[offers[0].book] || offers[0].book)} has this game up, so there is nothing to compare yet. ` : ''}${bad.length ? `${esc(bad.join(' and '))} did not answer this time. ` : ''}The percentage is the chance inside each price, margin included. Shown for research; Floodlight does not take bets.</p></section>`;
  }

  /* ---------- how the price has moved (linemove.js) ----------
     Every price reading the server kept for this game, so the chart and the prices card above it read the same board. */
  function movement(g, d, hide) {
    const LM = window.flLineMove, q = LM && oddsQuery(g, d); if (!q) return '';
    const h = `<div class="sec-h"><h3>How the price has moved</h3><span class="lb">Since we started reading it</span></div>`;
    if (hide && d.state !== 'pre') return `<section class="card gx-card" id="gxs-mv" data-gxk="mv" aria-label="How the price has moved">${h}${hidden('Live price moves show who is ahead')}</section>`;
    const home = d.a.home ? d.a : d.b, away = d.a.home ? d.b : d.a, nm = t => t.abbr || t.name;
    return `<section class="card gx-card" id="gxs-mv" data-gxk="mv" aria-label="How the price has moved">${h}${LM.html(LM.load(Object.fromEntries(q)), { head: false, names: { home: nm(home), away: nm(away), draw: 'Draw' }, side: d.a.home ? 'home' : 'away' })}</section>`;
  }
  document.addEventListener('fl:lm', () => { if (M.g && !host.hidden) paint() });

  /* ---------- pieces ---------- */
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 5 ? 'just now' : s < 60 ? `${s} seconds ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago` };
  const hm = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = d => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const perName = (d, n) => d.sport === 'soccer' ? (n === 1 ? '1st half' : n === 2 ? '2nd half' : 'extra time') : d.sport === 'baseball' ? `${ord(n)} inning` : d.sport === 'hockey' ? (n > 3 ? 'overtime' : `${ord(n)} period`)
    : d.halves && n <= 2 ? `${ord(n)} half` : d.halves ? 'overtime' : n > 4 ? 'overtime' : `${ord(n)} quarter`;
  const perShort = (d, n) => d.sport === 'soccer' ? (n === 1 ? '1H' : n === 2 ? '2H' : 'ET') : d.sport === 'baseball' ? String(n) : d.sport === 'hockey' ? (n > 3 ? 'OT' : 'P' + n) : d.halves ? (n <= 2 ? 'H' + n : 'OT') : n > 4 ? 'OT' : 'Q' + n;
  const when = (d, p) => p ? [d.sport === 'soccer' ? '' : perShort(d, p.period), p.clock].filter(Boolean).join(' ') : '';
  const crest = (t, cls = 'gx-crest') => `<span class="${cls}">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>`;
  const sideOf = (d, id) => id === d.a.id ? d.a : id === d.b.id ? d.b : null;
  const units = (d, n) => `${n} ${UNIT[d.sport][n === 1 ? 0 : 1]}`;

  /* "Catch me up": the counted facts, as sentences */
  function recap(d) {
    const out = [], a = d.a, b = d.b, sa = num(a.score) ?? 0, sb = num(b.score) ?? 0, top = sa === sb ? null : sa > sb ? a : b, low = top === a ? b : a;
    if (d.state === 'pre') {
      out.push(`${a.full || a.name} ${a.home ? 'host' : 'visit'} ${b.full || b.name}${d.date ? `, starting ${day(d.date)} at ${hm(d.date)}` : ''}${d.venue ? ` at ${d.venue}` : ''}.`);
      if (a.record && b.record) out.push(`Records: ${a.name} ${a.record}, ${b.name} ${b.record}.`);
      if (d.series?.summary) out.push(`${d.series.title}: ${d.series.summary}.`);
      return out;
    }
    const scoreTxt = `${Math.max(sa, sb)}–${Math.min(sa, sb)}`;
    out.push(d.state === 'post' ? (top ? `${top.full || top.name} beat ${low.full || low.name} ${scoreTxt}.` : `${a.full || a.name} and ${b.full || b.name} finished level at ${sa}–${sb}.`)
      : top ? `${top.full || top.name} lead ${low.full || low.name} ${scoreTxt}${d.detail ? ` (${d.detail})` : ''}.` : `It is level at ${sa}–${sb}${d.detail ? ` (${d.detail})` : ''}.`);
    if (d.scoreOk && d.pts.length > 1) {
      const bits = [];
      if (d.changes) bits.push(`the lead has changed hands ${d.changes === 1 ? 'once' : d.changes + ' times'}`);
      if (d.ties && d.sport !== 'soccer' && d.sport !== 'hockey') bits.push(`it has been tied ${d.ties === 1 ? 'once' : d.ties + ' times'} after the opening score`);
      if (bits.length) out.push(bits.join(' and ').replace(/^./, c => c.toUpperCase()) + '.');
      const big = [[a, d.bigA], [b, d.bigB]].filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]);
      if (big.length && ['basketball', 'football'].includes(d.sport)) out.push(big.length === 2 && big[1][1] >= 3 ? `${big[0][0].name} led by as many as ${big[0][1]}; ${big[1][0].name} by as many as ${big[1][1]}.` : `${big[0][0].name} have led by as many as ${big[0][1]}.`);
      // a comeback: the side in front (or the winner) trailed by a real margin
      if (top) { const trailed = top === a ? d.bigB : d.bigA, need = { basketball: 10, football: 10, hockey: 2, soccer: 1, baseball: 3 }[d.sport]; if (trailed >= need) out.push(`${top.name} ${d.state === 'post' ? 'came' : 'have come'} back from ${units(d, trailed)} down.`) }
      const r = d.bigRuns[0]; if (r && d.sport === 'basketball') out.push(`Biggest run: ${(r.side === 'a' ? a : b).name} ${r.n}–0${r.end.play ? ` in the ${perName(d, r.end.play.period)}` : ''}.`);
      const cur = d.nowRun; if (d.state === 'in' && cur && cur.n >= Math.ceil((RUN_MIN[d.sport] || 8) * .75) && cur !== r) out.push(`${(cur.side === 'a' ? a : b).name} have scored the last ${units(d, cur.n)}.`);
      const last = d.pts[d.pts.length - 1].play; if (last && d.state === 'in') out.push(`Latest score: ${last.text.replace(/\s+/g, ' ').replace(/\.$/, '')}${when(d, last) ? ` (${when(d, last)})` : ''}.`);
    } else if (!d.plays.length && d.state === 'in') out.push('The feed has no play-by-play for this game yet, so there is nothing more to recap.');
    if (d.sport === 'soccer') { const reds = d.plays.filter(p => p.card === 'red'); for (const p of reds.slice(0, 2)) { const t = sideOf(d, p.team); out.push(`${p.who || 'A player'}${t ? ` (${t.name})` : ''} was sent off${p.clock ? ` at ${p.clock}` : ''}.`) } }
    const stars = [[a, d.leaders.a[0]], [b, d.leaders.b[0]]].filter(x => x[1]);
    if (stars.length) out.push('Leading the way: ' + stars.map(([t, l]) => `${l.name} (${t.abbr || t.name}) ${/\d\s*[A-Za-z]/.test(l.val) ? l.val : `${l.val} ${l.val === '1' ? l.cat.toLowerCase().replace(/s$/, '') : l.cat.toLowerCase()}`}`).join('; ') + '.');
    const w = d.wps[d.wps.length - 1]; if (w && d.state === 'in') { const fav = w.v >= .5 ? a : b, v = Math.round(Math.max(w.v, 1 - w.v) * 100); out.push(`ESPN's live model gives ${fav.name} a ${Math.min(v, 99)}% chance from here.`) }
    return out;
  }

  /* the moments worth listing, newest first */
  function moments(d) {
    const key = p => p.kind === 'period' || p.kind === 'card' || p.kind === 'turn' || (d.sport === 'soccer' && p.kind === 'sub') || (p.kind === 'score' && (d.sport !== 'basketball' || M.every || p.tag));
    let list = d.plays.filter(key);
    if (d.sport === 'basketball' && !M.every && d.state === 'in') { const recent = d.plays.filter(p => p.kind === 'score').slice(-3); list = [...new Set([...list, ...recent])].sort((x, y) => x.i - y.i) }
    return list.reverse();
  }
  const kindIcon = p => p.kind === 'card' ? `<i class="gx-k card ${p.card || 'pen'}" aria-hidden="true"></i>` : p.kind === 'sub' ? `<i class="gx-k sub" aria-hidden="true">${ic('swap', 14)}</i>` : p.kind === 'period' ? `<i class="gx-k per" aria-hidden="true"></i>` : p.kind === 'turn' ? `<i class="gx-k turn" aria-hidden="true">${ic('swap', 14)}</i>` : `<i class="gx-k sc" aria-hidden="true"></i>`;
  function timeline(d, hide) {
    if (hide) return hidden('The timeline lists every score');
    const list = moments(d);
    if (!d.plays.length) return `<p class="gx-none">${d.state === 'pre' ? 'The timeline starts when the game does.' : 'The feed has no play-by-play for this game.'}</p>`;
    const more = d.sport === 'basketball' ? `<button type="button" class="lk gx-more" data-gx="every" aria-pressed="${M.every}">${M.every ? 'Show key moments only' : `Show every scoring play (${d.plays.filter(p => p.kind === 'score').length})`}</button>` : '';
    return `${more}<ol class="gx-tl" reversed>${list.map(p => { const t = sideOf(d, p.team), sc = p.changed || p.kind === 'score';
      return `<li class="gx-ev k-${p.kind}${M.sel === p.id ? ' on' : ''}"${t ? ` data-side="${t === d.a ? 'a' : 'b'}"` : ''}><button type="button" class="gx-evb" data-gxplay="${esc(p.id)}" ${sc && d.scoreOk ? '' : 'tabindex="-1" disabled'}>
        <span class="gx-evt num">${esc(when(d, p))}</span>${kindIcon(p)}${t ? crest(t, 'gx-crest sm') : '<span class="gx-crest sm"></span>'}
        <span class="gx-evx"><span>${esc(p.kind === 'period' && !p.text ? p.type : p.text)}</span>${p.tag ? `<em class="pl gx-tag">${esc(p.tag)}</em>` : ''}</span>
        ${sc && d.scoreOk ? `<b class="gx-evs num">${p.a}–${p.b}</b>` : ''}</button></li>` }).join('')}</ol>`;
  }

  /* game flow: who led, by how much, play by play. Tap or arrow through it; the play under the cursor is named below. */
  const W = 640, H = 190, PAD = { l: 34, r: 10, t: 14, b: 22 };
  function flow(d, hide) {
    if (hide) return hidden('The graph shows who led and when');
    if (!d.scoreOk) return `<p class="gx-none">The feed's goal list does not add up to the score, so the graph is left out rather than guessed.</p>`;
    if (d.pts.length < 2) return `<p class="gx-none">${d.state === 'pre' ? 'The graph draws itself once the scoring starts.' : d.plays.length ? 'No score yet.' : 'The feed has no play-by-play for this game.'}</p>`;
    const wp = M.mode === 'wp' && d.wps.length > 1, n = Math.max(1, d.plays.length - 1), x = i => PAD.l + Math.max(0, i) / n * (W - PAD.l - PAD.r), mid = PAD.t + (H - PAD.t - PAD.b) / 2, half = (H - PAD.t - PAD.b) / 2;
    const max = Math.max(d.bigA, d.bigB, 1), y = wp ? v => mid - (v - .5) * 2 * half : m => mid - m / max * half;
    let path = `M${x(0).toFixed(1)},${mid}`;
    if (wp) path = d.wps.map((w, k) => `${k ? 'L' : 'M'}${x(w.i).toFixed(1)},${y(w.v).toFixed(1)}`).join('');
    else { let py = mid; for (const q of d.pts.slice(1)) { const qx = x(q.i).toFixed(1), qy = y(q.m).toFixed(1); path += `H${qx}V${qy}`; py = qy } path += `H${x(n).toFixed(1)}` }
    const area = wp ? `${path}L${x(d.wps[d.wps.length - 1].i).toFixed(1)},${mid}L${x(d.wps[0].i).toFixed(1)},${mid}Z` : `${path}V${mid}Z`;
    // where each period starts
    const marks = []; let cur = 0; for (const p of d.plays) if (p.period && p.period !== cur) { cur = p.period; marks.push({ x: x(p.i), l: perShort(d, cur) }) }
    const few = d.pts.length <= 40, sel = M.sel ? d.pts.find(q => q.play?.id === M.sel) || (wp ? d.wps.find(w => w.play.id === M.sel) : null) : null;
    const selX = sel ? x(sel.i) : null, selY = sel ? (wp ? y(sel.v ?? d.wps.reduce((b0, w) => w.i <= sel.i ? w : b0, d.wps[0]).v) : y(sel.m)) : null;
    const lab = wp ? [`${esc(d.a.abbr || d.a.name)} 100%`, '50%', `${esc(d.b.abbr || d.b.name)} 100%`] : [`+${max}`, '0', `+${max}`];
    const sp = sel?.play || null, selWp = sp && d.wps.length ? d.wps.reduce((b0, w) => w.i <= sp.i ? w : b0, null) : null;
    const said = sp ? `<b class="num">${esc(when(d, sp))}</b><span>${esc(sp.text)}</span><b class="num gx-says">${sp.a}–${sp.b}</b>${selWp ? `<small class="lb">ESPN win chance: ${esc((selWp.v >= .5 ? d.a : d.b).name)} ${Math.min(99, Math.round(Math.max(selWp.v, 1 - selWp.v) * 100))}%</small>` : ''}`
      : `<span class="lb">${few ? 'Tap a point' : 'Tap or drag along the graph'} to see what happened there. Arrow keys step through each score.</span>`;
    const sum = wp ? `ESPN's win chance through the game. Now ${d.a.name} ${Math.round(d.wps[d.wps.length - 1].v * 100)}%.` : `Lead through the game. ${d.a.name} led by as many as ${d.bigA}, ${d.b.name} by as many as ${d.bigB}; ${d.changes} lead change${d.changes === 1 ? '' : 's'}.`;
    return `${d.wps.length > 1 ? `<div class="seg gx-mode" role="radiogroup" aria-label="Graph shows">${[['lead', 'Lead'], ['wp', 'Win chance']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${M.mode === k}" class="${M.mode === k ? 'on' : ''}" tabindex="${M.mode === k ? 0 : -1}" data-gxmode="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="gx-flow" tabindex="0" role="group" aria-label="Game flow graph. ${esc(sum)} Left and right arrows step through each score." data-gxflow>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(sum)}">
          <defs><clipPath id="gxTop"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath><clipPath id="gxBot"><rect x="0" y="${mid}" width="${W}" height="${H - mid}"/></clipPath></defs>
          ${marks.map(m => `<line class="gx-per" x1="${m.x.toFixed(1)}" x2="${m.x.toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}"/><text class="gx-pl" x="${(m.x + 4).toFixed(1)}" y="${H - 6}">${esc(m.l)}</text>`).join('')}
          <path class="gx-area a" d="${area}" clip-path="url(#gxTop)"/><path class="gx-area b" d="${area}" clip-path="url(#gxBot)"/>
          <line class="gx-zero" x1="${PAD.l}" x2="${W - PAD.r}" y1="${mid}" y2="${mid}"/><path class="gx-line" d="${path}"/>
          ${few && !wp ? d.pts.slice(1).map(q => `<circle class="gx-pt${q.play.id === M.sel ? ' on' : ''}" cx="${x(q.i).toFixed(1)}" cy="${y(q.m).toFixed(1)}" r="4"/>`).join('') : ''}
          ${sel ? `<line class="gx-cur" x1="${selX.toFixed(1)}" x2="${selX.toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}"/><circle class="gx-pt on" cx="${selX.toFixed(1)}" cy="${selY.toFixed(1)}" r="5.5"/>` : ''}
          <text class="gx-ax" x="2" y="${PAD.t + 9}">${lab[0]}</text><text class="gx-ax" x="2" y="${mid + 4}">${lab[1]}</text><text class="gx-ax" x="2" y="${H - PAD.b - 2}">${lab[2]}</text>
        </svg></div>
      <div class="gx-leg" aria-hidden="true"><span><i class="a"></i>${esc(d.a.name)} ${wp ? 'favoured' : 'ahead'}</span><span><i class="b"></i>${esc(d.b.name)} ${wp ? 'favoured' : 'ahead'}</span>${wp ? '<span class="lb">Win chance is ESPN\'s, not ours</span>' : ''}</div>
      <p class="gx-say" aria-live="polite">${said}</p>`;
  }

  function lineups(d) {
    const col = (t, k) => { const X = d.xi[k], F = d.five[k], L = d.leaders[k], I = d.hurt[k]; let h = '';
      if (X?.start.length) h += `<p class="lb">${X.formation ? `Formation ${esc(X.formation)}` : 'Starting eleven'}</p><ul class="gx-xi">${X.start.map(p => `<li><span class="num gx-num">${esc(p.num)}</span><span>${esc(p.name)}${p.off ? ' <em class="lb">off</em>' : ''}</span><small class="lb">${esc(p.pos)}</small></li>`).join('')}</ul>${X.bench.length ? `<p class="lb">Came on</p><ul class="gx-xi">${X.bench.map(p => `<li><span class="num gx-num">${esc(p.num)}</span><span>${esc(p.name)}</span><small class="lb">${esc(p.pos)}</small></li>`).join('')}</ul>` : ''}`;
      else if (F) h += `<div class="tbx-wrap"><table class="tbx gx-five"><thead><tr><th scope="col">Starters</th>${F.cols.map(c => `<th scope="col" class="r">${c}</th>`).join('')}</tr></thead><tbody>${F.start.map(p => `<tr><th scope="row">${esc(p.name)} <small class="lb">${esc(p.pos)}</small></th>${p.stats.map(s => `<td class="r num">${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      else if (L.length) h += `<ul class="gx-xi">${L.slice(0, 4).map(l => `<li><span>${esc(l.name)}</span><small class="lb">${esc(l.cat)} · ${esc(l.val)}</small></li>`).join('')}</ul>`;
      if (I.length) h += `<p class="lb">Injury report</p><ul class="gx-xi">${I.map(p => `<li><span>${esc(p.name)} <small class="lb">${esc(p.pos)}</small></span><em class="pl">${esc(p.status)}</em></li>`).join('')}</ul>`;
      return h ? `<div class="gx-col"><h4>${crest(t, 'gx-crest sm')}${esc(t.name)}</h4>${h}</div>` : '' };
    const a = col(d.a, 'a'), b = col(d.b, 'b');
    return a || b ? `<div class="gx-two">${a}${b}</div>` : '';
  }
  function formBlock(d, hide) {
    const row = (t, k) => d.form[k].length ? `<div class="gx-form"><span>${crest(t, 'gx-crest sm')}${esc(t.name)}</span><span class="gx-wdl" aria-label="Last ${d.form[k].length}, newest first: ${d.form[k].map(e => e.r).join(' ')}">${d.form[k].map(e => `<i class="r-${esc(e.r)}" title="${esc(`${e.r} ${e.score} ${e.at} ${e.opp}${e.date ? ', ' + day(e.date) : ''}`)}">${esc(e.r)}</i>`).join('')}</span></div>` : '';
    const f = row(d.a, 'a') + row(d.b, 'b'), s = d.series;
    const games = s?.games.filter(x => x.done).length ? `<ul class="gx-xi">${s.games.filter(x => x.done).map(x => `<li><span>${esc(x.w)} ${hide ? '' : esc(x.ws)} at ${esc(x.h)} ${hide ? '' : esc(x.hs)}</span><small class="lb">${x.date ? x.date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</small></li>`).join('')}</ul>` : '';
    const ser = s && (s.summary || games) ? `<div class="gx-ser"><h4>${esc(s.title)}</h4>${s.summary && !hide ? `<p>${esc(s.summary)}</p>` : ''}${games}</div>` : '';
    const stats = d.stats.length && d.state !== 'pre' && !hide ? `<div class="gx-ser"><h4>Team numbers</h4><table class="tbx gx-st"><thead><tr><th scope="col" class="r">${esc(d.a.abbr || d.a.name)}</th><th scope="col"><span class="sr-only">Stat</span></th><th scope="col">${esc(d.b.abbr || d.b.name)}</th></tr></thead><tbody>${d.stats.map(x => `<tr><td class="r num">${esc(x.a)}</td><th scope="row">${esc(x.label)}</th><td class="num">${esc(x.b)}</td></tr>`).join('')}</tbody></table></div>` : '';
    return f || ser || stats ? `${f ? `<div class="gx-ser"><h4>Recent form</h4>${f}</div>` : ''}${ser}${stats}` : '';
  }
  const hidden = why => `<div class="gx-hid">${ic('help', 22)}<p><b>Hidden while spoiler-free is on.</b> ${why}, so it stays covered until you reveal the score.</p><button type="button" class="bt sm" data-gx="reveal">Reveal this game</button></div>`;

  /* ---------- the sheet ---------- */
  const host = document.createElement('div'); host.id = 'flMC'; host.className = 'gx'; host.hidden = true;
  host.innerHTML = `<div class="gx-scrim" data-gx="close"></div><section class="gx-sheet" role="dialog" aria-modal="true" aria-labelledby="gxTitle" tabindex="-1"></section><div class="sr-only" id="gxSay" aria-live="polite" aria-atomic="true"></div>`;
  document.body.appendChild(host);
  const sheet = host.querySelector('.gx-sheet');

  // what is happening now, for the header that stays on screen: who has the ball, down and distance, and the latest play
  function now(g, d, hide) {
    const state = d?.state || g.state; if (state !== 'in' || hide) return { poss: '', line: '' };
    const sit = d?.sit || g.sit, last = sit?.last || [...(d?.plays || [])].reverse().find(p => p.text && p.kind !== 'period')?.text || '';
    const bits = [sit?.red ? 'Red zone' : '', sit?.text || ''].filter(Boolean).join(' · ');
    return { poss: sit?.poss || '', line: [bits, last].filter(Boolean).join(' · ') };
  }
  const SECTIONS = [['recap', 'Summary'], ['flow', 'Flow'], ['xi', 'Lineups'], ['tl', 'Timeline'], ['px', 'Prices'], ['mv', 'Line moves'], ['form', 'Stats']];
  function head(g, d, hide, secs = []) {
    const a = d?.a || g.a, b = d?.b || g.b, state = d?.state || g.state, live = state === 'in', N = now(g, d, hide);
    const has = t => N.poss && String(t.id) === N.poss ? `<span class="gx-poss" title="Has the ball"><i aria-hidden="true"></i><span class="sr-only">has the ball</span></span>` : '';
    const sc = t => state === 'pre' ? '' : `<b class="gx-sc num">${hide ? '–' : esc(t.score)}</b>`;
    const status = state === 'pre' ? `${day(d?.date || g.date)} · ${hm(d?.date || g.date)}` : hide ? (live ? 'In play' : 'Finished') : (d?.detail || g.clock || '');
    const lines = d && !hide && state !== 'pre' && d.periods > 1 && d.periods <= 12 ? `<table class="gx-lines"><thead><tr><th scope="col"><span class="sr-only">Team</span></th>${Array.from({ length: d.periods }, (_, i) => `<th scope="col">${perShort(d, i + 1)}</th>`).join('')}<th scope="col">T</th></tr></thead>
      <tbody>${[a, b].map(t => `<tr><th scope="row">${esc(t.abbr || t.name)}</th>${Array.from({ length: d.periods }, (_, i) => `<td class="num">${esc(t.lines[i] ?? '–')}</td>`).join('')}<td class="num"><b>${esc(t.score)}</b></td></tr>`).join('')}</tbody></table>` : '';
    return `<header class="gx-head" data-gxk="head" style="${window.flTeamColours ? window.flTeamColours({ hc: a.color, ac: b.color }) : ''}">
      <div class="gx-bar"><span class="gx-lg">${live ? '<span class="pl live"><i></i>Live</span>' : state === 'post' ? '<span class="pl">Final</span>' : '<span class="pl">Upcoming</span>'}<span class="lb">${esc(g.lgName || g.short || '')}</span></span>
        <span class="gx-tools">${window.flShare ? `<button type="button" class="bt ghost sm" data-gx="share">${window.flShare.ICON}Share</button>` : ''}${window.flHome && state !== 'post' ? `<button type="button" class="bt ghost sm" data-gx="watch" aria-pressed="${window.flHome.watching(g.key)}">${window.flHome.watching(g.key) ? 'Watching' : 'Watch'}</button>` : ''}<button type="button" class="bt ghost sm" data-gx="${hide ? 'reveal' : 'hide'}" aria-pressed="${hide}">${hide ? 'Reveal the score' : 'Hide the score'}</button><button type="button" class="ib" data-gx="close" aria-label="Close the match centre">${ic('x', 18) || '×'}</button></span></div>
      <h2 class="gx-title" id="gxTitle"><span class="gx-team">${crest(a)}<span><span class="gx-full">${esc(a.full || a.name)}</span><span class="gx-short">${esc(a.name || a.full)}</span></span>${has(a)}${a.record ? `<small class="lb">${esc(a.record)}</small>` : ''}</span>
        <span class="gx-mid">${state === 'pre' ? `<b class="gx-vs">v</b>` : `${sc(a)}<i aria-hidden="true">:</i><span class="sr-only"> to </span>${sc(b)}`}<small class="${live ? 'on' : ''}">${esc(status)}</small></span>
        <span class="gx-team">${crest(b)}<span><span class="gx-full">${esc(b.full || b.name)}</span><span class="gx-short">${esc(b.name || b.full)}</span></span>${has(b)}${b.record ? `<small class="lb">${esc(b.record)}</small>` : ''}</span></h2>
      ${N.line ? `<p class="gx-now"><span class="lb">Latest</span> ${esc(N.line.slice(0, 220))}</p>` : ''}
      ${lines}
      ${secs.length > 2 ? `<nav class="gx-nav" aria-label="Sections of this game"><ul>${secs.map(([k, l], i) => `<li><a href="#gxs-${k}" data-gxgo="${k}"${i === 0 ? ' aria-current="true"' : ''}>${l}</a></li>`).join('')}</ul></nav>` : ''}
      <p class="gx-meta lb">${[d?.venue || g.venue, d?.crowd ? `${d.crowd.toLocaleString()} there` : '', (d?.tv?.length ? d.tv : g.tv ? [g.tv] : []).length ? `TV (US listing): ${esc((d?.tv?.length ? d.tv : [g.tv]).join(', '))}` : ''].filter(Boolean).map(x => `<span>${x}</span>`).join('')}</p>
    </header>`;
  }
  function paint() {
    const g = M.g; if (!g || host.hidden) return;
    const d = M.d, hide = spoil(g.key), live = (d?.state || g.state) === 'in';
    const act = sheet.contains(document.activeElement) ? document.activeElement : null, keepSel = act ? ['data-gx', 'data-gxplay', 'data-gxmode', 'data-gxflow', 'data-gxgo'].map(k => act.hasAttribute(k) ? `[${k}${act.getAttribute(k) ? `="${CSS.escape(act.getAttribute(k))}"` : ''}]` : '').find(Boolean) : null;
    const scroll = sheet.querySelector('.gx-body')?.scrollTop || 0;
    const fresh = `<p class="gx-fresh" data-gxk="fresh">${M.err ? `<span class="pd-dot warn" aria-hidden="true"></span><b>${esc(M.err)}</b>${M.at ? ` <span class="lb">Showing what loaded <time data-gxago="${M.at}">${ago(M.at)}</time>.</span>` : ''} <button type="button" class="bt sm" data-gx="retry">Try again</button>`
      : M.at ? `<span class="pd-dot" aria-hidden="true"></span><b>Updated <time data-gxago="${M.at}">${ago(M.at)}</time></b><span class="lb">Source: ESPN game feed. ${live ? 'Checked every 20 seconds while the game is live; the feed can run behind the broadcast.' : 'Checked again every 90 seconds.'}</span>`
      : `<span class="pd-spin" aria-hidden="true"></span><b>Loading the game feed…</b>`}</p>`;
    let body;
    if (!d) body = M.err ? `<div class="emp" data-gxk="err">${ic('help', 28)}<b>The detail for this game did not load</b><p>${esc(M.err)} The score above is from the scoreboard and is still current.</p><button type="button" class="bt" data-gx="retry">Try again</button></div>`
      : `<div class="gx-grid" data-gxk="wait" aria-hidden="true"><div class="gx-c"><div class="skl" style="height:150px"></div><div class="skl" style="height:230px"></div></div><div class="gx-c"><div class="skl" style="height:320px"></div></div></div>`;
    else {
      const rc = hide ? '' : recap(d), L = lineups(d), F = formBlock(d, hide);
      body = `<div class="gx-grid"><div class="gx-c">
          <section class="card gx-card" id="gxs-recap" data-gxk="recap" aria-labelledby="gxRecapH"><div class="sec-h"><h3 id="gxRecapH">Catch me up</h3><span class="lb">Counted from the plays, not written by AI</span></div>
            ${hide ? hidden('The recap says who is winning') : `<ul class="gx-recap">${rc.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`}</section>
          <section class="card gx-card" id="gxs-flow" data-gxk="flow" aria-labelledby="gxFlowH"><div class="sec-h"><h3 id="gxFlowH">Game flow</h3><span class="lb">${d.scoreOk && d.pts.length > 1 && !hide ? `${d.changes} lead change${d.changes === 1 ? '' : 's'}` : ''}</span></div>${flow(d, hide)}</section>
          ${L ? `<section class="card gx-card" id="gxs-xi" data-gxk="xi" aria-labelledby="gxXiH"><div class="sec-h"><h3 id="gxXiH">${d.xi.a || d.xi.b ? 'Lineups' : d.five.a || d.five.b ? 'Starters' : 'Leaders'}</h3></div>${L}</section>` : ''}
        </div><div class="gx-c">
          <section class="card gx-card" id="gxs-tl" data-gxk="tl" aria-labelledby="gxTlH"><div class="sec-h"><h3 id="gxTlH">Timeline</h3><span class="lb">Newest first</span></div>${timeline(d, hide)}</section>
          ${prices(d, hide)}
          ${movement(g, d, hide)}
          ${F ? `<section class="card gx-card" id="gxs-form" data-gxk="form" aria-label="Form, series and team numbers">${F}</section>` : ''}
        </div></div>`;
    }
    // the section bar: only the sections this game has, Lineups named as its heading says
    const secs = d ? SECTIONS.filter(([k]) => body.includes(`data-gxk="${k}"`)).map(([k, l]) => [k, k === 'xi' ? (d.xi.a || d.xi.b ? 'Lineups' : d.five.a || d.five.b ? 'Starters' : 'Leaders') : l]) : [];
    const html = `${head(g, d, hide, secs)}<div class="gx-body" aria-busy="${M.loading && !d}">${fresh}${body}
      <footer class="gx-foot" data-gxk="foot"><button type="button" class="bt" data-gx="full">Open the full ${esc(g.sport)} page for this game${ic('arrow', 16)}</button>
        <label class="gx-all"><input class="sw" type="checkbox" role="switch" data-gx="all" ${SP.all ? 'checked' : ''}> Spoiler-free: hide every score until I reveal it</label></footer></div>`;
    if (!morph(html)) { sheet.innerHTML = html; const bodyEl = sheet.querySelector('.gx-body'); if (bodyEl) bodyEl.scrollTop = scroll }
    if (keepSel && !sheet.contains(document.activeElement)) sheet.querySelector(keepSel)?.focus({ preventScroll: true });
    spy();
  }
  /* The header stays on screen. Once the body is scrolled it tightens (the period table and venue line fold away), and
     the section bar marks the section in view. */
  function spy() {
    const b = sheet.querySelector('.gx-body'), nav = sheet.querySelector('.gx-nav'); if (!b) return;
    sheet.classList.toggle('gx-tight', b.scrollTop > 90);
    if (!nav) return;
    const top = b.getBoundingClientRect().top + 24, secs = [...b.querySelectorAll('[id^="gxs-"]')];
    let cur = secs[0]; for (const el of secs) if (el.getBoundingClientRect().top <= top) cur = el;
    if (b.scrollTop + b.clientHeight >= b.scrollHeight - 4) cur = secs.reduce((x, el) => el.getBoundingClientRect().top < b.getBoundingClientRect().bottom ? el : x, cur);
    nav.querySelectorAll('[data-gxgo]').forEach(a => { const on = cur && a.dataset.gxgo === cur.id.slice(4); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current') });
    const on = nav.querySelector('[aria-current]'), ul = nav.querySelector('ul');
    if (on && ul && (on.offsetLeft < ul.scrollLeft || on.offsetLeft + on.offsetWidth > ul.scrollLeft + ul.clientWidth)) ul.scrollLeft = on.offsetLeft - 16;
  }
  let spyF = 0;
  sheet.addEventListener('scroll', ev => { if (!ev.target.classList?.contains('gx-body') || spyF) return; spyF = requestAnimationFrame(() => { spyF = 0; spy() }) }, true);
  // a section link scrolls the body to that section and moves focus to its heading, so the keyboard and the reader follow
  sheet.addEventListener('click', ev => {
    const a = ev.target.closest('[data-gxgo]'); if (!a) return; ev.preventDefault();
    const b = sheet.querySelector('.gx-body'), el = sheet.querySelector('#gxs-' + a.dataset.gxgo); if (!b || !el) return;
    b.scrollTo({ top: Math.max(0, b.scrollTop + el.getBoundingClientRect().top - b.getBoundingClientRect().top - 12), behavior: root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const h = el.querySelector('h3') || el; if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true });
  });
  /* A refresh swaps only the blocks that changed. The sheet, its headings, its labels and whatever the reader or the
     keyboard is on stay put; a full redraw happens only when the set of blocks changes (loading to loaded, say). */
  const same = h => h.replace(/(<time data-gxago="\d+"[^>]*>)[^<]*/g, '$1');
  function morph(html) {
    const old = [...sheet.querySelectorAll('[data-gxk]')]; if (!old.length) return false;
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const nu = [...tpl.content.querySelectorAll('[data-gxk]')];
    if (nu.length !== old.length || nu.some((n, i) => n.dataset.gxk !== old[i].dataset.gxk)) return false;
    nu.forEach((n, i) => { if (same(n.outerHTML) !== same(old[i].outerHTML)) old[i].replaceWith(n) });
    const b = sheet.querySelector('.gx-body'), nb = tpl.content.querySelector('.gx-body'); if (b && nb) b.setAttribute('aria-busy', nb.getAttribute('aria-busy'));
    return true;
  }
  /* What a screen reader hears while the game is open: a score change or the final whistle, once, and nothing when
     the score is hidden. The "Updated" line no longer speaks on every refresh. */
  function say(prev, d) {
    const g = M.g; if (!g || !d || !prev || spoil(g.key)) return;
    const sc = x => `${x.a.name} ${x.a.score}, ${x.b.name} ${x.b.score}`;
    let t = '';
    if (d.state === 'post' && prev.state !== 'post') t = `Final. ${sc(d)}.`;
    else if (d.state === 'in' && (prev.a.score !== d.a.score || prev.b.score !== d.b.score)) { const last = [...d.plays].reverse().find(p => p.kind === 'score'); t = `Score. ${sc(d)}. ${last?.text ? String(last.text).slice(0, 140) : ''}` }
    else if (d.state === 'in' && prev.state === 'pre') t = `Started. ${sc(d)}.`;
    if (t) { const el = host.querySelector('#gxSay'); el.textContent = ''; setTimeout(() => { el.textContent = t }, 60) }
  }

  /* ---------- open, close, refresh ---------- */
  function find(o) { return (window.flHub?.games() || []).find(g => g.sport === o.sport && String(g.id) === String(o.id)) || null }
  function open(o, from) {
    const g = o.key ? o : find(o);
    if (!g || !CAN.has(g.sport) || !g.path) return false;
    M.seq++; M.g = g; M.d = null; M.at = 0; M.err = ''; M.odds = null; M.oddsAt = 0; M.oddsErr = ''; M.oddsBusy = false; M.loading = false; M.sel = null; M.every = false; M.mode = 'lead'; M.from = from || document.activeElement;
    window.flHome?.seen(g); sheet.innerHTML = ''; sheet.classList.remove('gx-tight');
    host.hidden = false; root.classList.add('gx-on'); paint(); sheet.focus({ preventScroll: true }); load();
    clearInterval(M.timer); M.timer = setInterval(() => { if (document.hidden || host.hidden) return; const live = (M.d?.state || M.g.state) === 'in'; if (Date.now() - (M.at || 0) >= (live ? LIVE_MS : IDLE_MS) - 500) load(true) }, 5000);
    clearInterval(M.tick); M.tick = setInterval(() => sheet.querySelectorAll('[data-gxago]').forEach(t => { const x = ago(+t.dataset.gxago); if (t.textContent !== x) t.textContent = x }), 1000);
    return true;
  }
  function close() {
    if (host.hidden) return; host.hidden = true; root.classList.remove('gx-on'); clearInterval(M.timer); clearInterval(M.tick); M.seq++;
    const f = M.from; M.g = null; M.d = null; if (f && document.contains(f)) f.focus({ preventScroll: true });
  }
  // the scoreboard keeps the score in the header current between feed reads
  document.addEventListener('fl:hub', () => { if (host.hidden || !M.g) return; const g = find(M.g); if (g) { M.g = g; if (!M.d) paint() } });

  function select(id, viaList) {
    M.sel = M.sel === id && viaList ? null : id; paint();
    if (!viaList && M.sel) sheet.querySelector(`[data-gxplay="${CSS.escape(M.sel)}"]`)?.closest('li')?.scrollIntoView({ block: 'nearest' });
  }
  function nearest(ev) {
    const d = M.d, box = ev.currentTarget.querySelector('svg').getBoundingClientRect(), fx = (ev.clientX - box.left) / box.width * W, n = Math.max(1, d.plays.length - 1), i = (fx - PAD.l) / (W - PAD.l - PAD.r) * n;
    const pool = M.mode === 'wp' && d.wps.length > 1 ? d.wps : d.pts.slice(1); let best = null;
    for (const q of pool) if (!best || Math.abs(q.i - i) < Math.abs(best.i - i)) best = q;
    return best?.play?.id || null;
  }
  sheet.addEventListener('click', ev => {
    const fl = ev.target.closest('[data-gxflow]'); if (fl && M.d) { const id = nearest({ currentTarget: fl, clientX: ev.clientX }); if (id) { M.sel = id; paint(); sheet.querySelector('[data-gxflow]')?.focus({ preventScroll: true }) } return }
    const t = ev.target.closest('[data-gx],[data-gxplay],[data-gxmode]'); if (!t) return;
    if (t.dataset.gxplay) return select(t.dataset.gxplay, true);
    if (t.dataset.gxmode) { M.mode = t.dataset.gxmode; M.sel = null; return paint() }
    const k = t.dataset.gx;
    if (k === 'close') return close();
    if (k === 'retry') return load();
    if (k === 'odds') { M.oddsAt = 0; M.oddsErr = ''; loadOdds(); return paint() }
    if (k === 'every') { M.every = !M.every; return paint() }
    if (k === 'watch') { window.flHome?.watch(M.g); return paint() }
    if (k === 'share') { const g = M.g, d = M.d, hide = spoil(g.key), st = d?.state || g.state, a = d?.a || g.a, b = d?.b || g.b;
      const when = (d?.date || g.date)?.toLocaleString?.([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) || '';
      const rc = d && !hide ? recap(d).slice(0, 2) : [];
      return window.flShare?.share({ file: `${a.name} v ${b.name}`, title: '', kicker: [g.lgName || g.short, when].filter(Boolean).join(' · '),
        score: { a: a.full || a.name, b: b.full || b.name, sa: st === 'pre' || hide ? null : a.score, sb: st === 'pre' || hide ? null : b.score, live: st === 'in' && !hide,
          status: st === 'pre' ? `Starts ${(d?.date || g.date)?.toLocaleTimeString?.([], { hour: 'numeric', minute: '2-digit' }) || ''}` : hide ? 'Score hidden' : st === 'in' ? (d?.detail || g.clock || 'Live') : (d?.detail || g.final || 'Final') },
        notes: rc, foot: hide ? 'Shared with the score hidden.' : 'Scores from the ESPN game feed.' }, ev.target.closest('button')) }
    if (k === 'hide') { setSpoil(M.g.key, true); return paint() }
    if (k === 'reveal') { setSpoil(M.g.key, false); return paint() }
    if (k === 'full') { const g = M.g; close(); window.flPages?.current?.() && window.flPages.hide(); return window.flHub?.open(g) }
  });
  sheet.addEventListener('change', ev => { if (ev.target.dataset.gx === 'all') { setSpoilAll(ev.target.checked); paint() } });
  host.querySelector('.gx-scrim').addEventListener('click', close);
  let drag = false;
  sheet.addEventListener('pointerdown', ev => { if (ev.target.closest('[data-gxflow]')) drag = true });
  addEventListener('pointerup', () => { drag = false });
  sheet.addEventListener('pointermove', ev => { if (!drag || !M.d) return; const fl = ev.target.closest('[data-gxflow]'); if (!fl) return; const id = nearest({ currentTarget: fl, clientX: ev.clientX }); if (id && id !== M.sel) { M.sel = id; paint() } });
  sheet.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); return close() }
    if (ev.target.matches?.('[data-gxflow]') && /^Arrow(Left|Right)$|^Home$|^End$/.test(ev.key) && M.d) {
      const pool = (M.mode === 'wp' && M.d.wps.length > 1 ? M.d.wps : M.d.pts.slice(1)).map(q => q.play.id); if (!pool.length) return;
      const i = pool.indexOf(M.sel), j = ev.key === 'Home' ? 0 : ev.key === 'End' ? pool.length - 1 : i < 0 ? (ev.key === 'ArrowLeft' ? pool.length - 1 : 0) : Math.max(0, Math.min(pool.length - 1, i + (ev.key === 'ArrowRight' ? 1 : -1)));
      ev.preventDefault(); select(pool[j]); sheet.querySelector('[data-gxflow]')?.focus({ preventScroll: true }); return;
    }
    if (ev.key === 'Tab') {   // keep the keyboard inside the sheet while it is open
      const f = [...sheet.querySelectorAll('button:not([disabled]),[href],input,select,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { ev.preventDefault(); last.focus() } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
    }
  });
  // a game on Home or Live opens here; the old way (its own sport page) is one button away inside
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#hub [data-hub], #pg-live [data-live]'); if (!t || t.dataset.hubtab === 'pitch') return;
    const [sport, , id] = (t.dataset.hub || t.dataset.live).split('|'); if (!CAN.has(sport)) return;
    if (open({ sport, id }, t)) { ev.stopPropagation(); ev.preventDefault() }
  }, true);

  window.flMC = { open, close, spoil, setSpoil, setSpoilAll, spoilAll: () => !!SP.all, state: M, can: s => CAN.has(s) };
})();
