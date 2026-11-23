/* Floodlight · the Lab's numbers: what Prop Explorer, the research panel, the pick cards and the Prediction Card share.
   Nothing here fetches anything or decides whether a market may be shown. That is the verified market feed's job
   (markets.js, checked by market.js). This file only explains a market that already passed:
   - breakdown(): the raw edge, then what each kind of doubt took off it (sample size, availability, data quality, a
     moving line), down to the supported edge. The steps always add up to the supported edge on the card.
   - grade(): an evidence grade from A to D. It reads only how much stands behind a number (games on record, whether
     the recent windows agree, how the matchup and price were checked, availability). It never looks at the edge or the
     chance, so a big edge on thin evidence still reads D.
   - splits(): the record behind a line: last 5, 10 and 20, this season, home and away, against tonight's opponent,
     average and median, the minutes trend, and earlier lines for the same stat with how they finished.
   - explore(): Prop Explorer's filters and sorts.
   - card(): a Prediction Card or parlay read as a whole: average evidence, the weakest pick, what expires first, lines
     that moved, players ruled out, picks that clash.
   - history(): a member's finished cards: hit rate, best card, streak, average size, by sport and by size.
   Pure functions: the pages and tests/labcore.test.js call the same code. */
(function (root) {
  const DAY = 864e5;
  const fmt = v => v == null ? '–' : Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
  const tm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /* ---------- supported edge, step by step ---------- */
  const EXPLAIN = 'Supported edge adjusts the raw difference for sample size, injuries, lineup uncertainty, missing information and data quality.';
  // which kind of doubt a reason from market.js supported() is. Anything not recognised counts as data quality.
  const KIND_RX = [
    ['sample', /available games?|no games on record|gap since the last appearance|days since the last appearance|gap in appearances|more than two months old/i],
    ['avail', /injury report|role changed|minutes vary|lineup|ruled out|listed out/i],
    ['move', /line moved/i],
  ];
  const kindOf = why => (KIND_RX.find(([, rx]) => rx.test(why)) || ['data'])[0];
  const STEPS = [['sample', 'Sample-size adjustment'], ['avail', 'Availability adjustment'], ['data', 'Data-quality adjustment'], ['move', 'Line-movement adjustment']];
  /* raw: the raw edge in whole points. cuts: [[factor, reason], ...] as market.js supported() makes them.
     -> { raw, edge, rows: [{ key, label, pts, reasons }], text } where raw + the sum of pts is exactly edge.
     The cuts are applied one kind at a time and each step is rounded, so the rounding never leaves a stray point. */
  function breakdown(raw, cuts) {
    if (raw == null || isNaN(raw)) return null;
    raw = Math.round(+raw);
    const by = { sample: [], avail: [], data: [], move: [] };
    for (const c of cuts || []) { const [f, why] = Array.isArray(c) ? c : [c.f ?? c.factor, c.why ?? c.reason]; if (f == null || isNaN(f)) continue; by[kindOf(String(why || ''))].push([+f, String(why || '')]) }
    let v = raw, shown = raw;
    const rows = [];
    for (const [key, label] of STEPS) {
      const f = by[key].reduce((a, [x]) => a * x, 1); v *= f;
      const now = Math.round(v), pts = now - shown; shown = now;
      if (key === 'move' && !by.move.length) continue;   // a line that hasn't moved gets no row
      rows.push({ key, label, pts, reasons: by[key].sort((a, b) => a[0] - b[0]).map(x => x[1]) });
    }
    return { raw, edge: shown, rows, text: EXPLAIN };
  }
  const signed = n => n == null ? '–' : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';

  /* ---------- evidence grade ---------- */
  const GRADE_WORD = { A: 'Strong evidence', B: 'Good evidence', C: 'Limited evidence', D: 'Highly uncertain' };
  /* p: a verified market (the fields markets.js and edge.js give a prop). -> { grade, word, score, points: [{ ok, text }] }
     Points: games on record (0-3), recent windows agree (0-1), matchup checked on the schedule (0-1), more than one
     provider (0-1), fresh price (0 or -1), availability (0 to -2), the books' team and the stats' team disagree (-2). */
  function grade(p, now = Date.now()) {
    if (!p) return null;
    const pts = [], add = (n, ok, text) => { pts.push({ n, ok, text }) };
    if (p.type === 'match') {
      const c = String(p.conf || '').toLowerCase();
      add(c === 'high' ? 3 : c === 'medium' ? 2 : 1, c === 'high', `Forecast confidence ${c || 'not given'}`);
      add(p.market != null ? 1 : 0, p.market != null, p.market != null ? 'A market price to check it against' : 'No market price to check it against');
      add(1, true, 'Kick-off on the fixture list');
    } else {
      const gs = (p.games || []).filter(g => g && g.v != null), n = gs.length;
      add(n >= 15 ? 3 : n >= 10 ? 2 : n >= 5 ? 1 : 0, n >= 10, n ? `${n} ${n === 1 ? 'game' : 'games'} on record` : 'No games on record');
      const over = p.side !== 'under', hit = g => over ? g.v > p.line : g.v < p.line, rate = k => { const w = gs.slice(0, k).filter(g => g.v !== p.line); return w.length ? w.filter(hit).length / w.length : null };
      const rs = [rate(5), rate(10), rate(20)].filter(r => r != null), agree = rs.length >= 2 && Math.max(...rs) - Math.min(...rs) <= .2;
      add(agree ? 1 : 0, agree, rs.length < 2 ? 'Too few games to compare recent windows' : agree ? 'Last 5, 10 and 20 tell the same story' : 'Last 5, 10 and 20 disagree');
      const how = p.v?.event?.verified;
      add(how === 'schedule' ? 1 : 0, how === 'schedule', how === 'schedule' ? 'Matchup confirmed on the league schedule' : how === 'provider' ? 'Matchup from the provider only' : 'Matchup not confirmed');
      const books = new Set((p.offers || []).filter(o => o.line === p.line).map(o => o.book).concat(p.offers?.length ? [] : p.books || [])).size;
      add(books >= 2 ? 1 : 0, books >= 2, books >= 2 ? `${books} providers post this line` : 'One provider posts this line');
      const at = p.verifiedAt || p.at, age = at ? now - at : null;
      if (age == null || age > 30 * 60e3) add(-1, false, age == null ? 'No verification time' : `Price last verified ${Math.round(age / 60e3)} min ago`);
      const lv = p.av?.lv || p.injury?.lv;
      if (lv === 'doubtful' || lv === 'out') add(-2, false, 'Doubtful or out on the injury report');
      else if (lv === 'questionable' || lv === 'dtd') add(-1, false, 'Questionable on the injury report');
      const ms = gs.slice(0, 5).map(g => g.min).filter(m => m != null), m5 = mean(ms);
      if (ms.length >= 4 && m5 && Math.sqrt(mean(ms.map(m => (m - m5) ** 2))) / m5 > .25) add(-1, false, 'Minutes vary from game to game');
      if (p.teamNote || p.teamOk === false) add(-2, false, 'The books’ team and the stats’ team disagree');
    }
    const score = pts.reduce((a, x) => a + x.n, 0), g = score >= 6 ? 'A' : score >= 4 ? 'B' : score >= 2 ? 'C' : 'D';
    return { grade: g, word: GRADE_WORD[g], score, points: pts.map(({ ok, text }) => ({ ok, text })) };
  }
  const GRADE_RANK = { A: 4, B: 3, C: 2, D: 1 };

  /* ---------- the record behind a line ---------- */
  /* games: newest first, { v, home, min, opp, oppAbbr, date }. o: { line, side, yes, opp, oppAbbr, prior: [{ line, side, result, start }] }
     -> { windows: [{ key, label, n, hit, push, rate }], home, away, vsOpp, avg, med, mins: { l5, l20, trend }, similar, summary } */
  function splits(games, o = {}) {
    const gs = (games || []).filter(g => g && g.v != null && !isNaN(g.v)), line = +o.line, over = o.side !== 'under';
    const hit = g => over ? g.v > line : g.v < line;
    const rec = (xs, key, label) => { const push = xs.filter(g => g.v === line).length, h = xs.filter(hit).length, dec = xs.length - push; return { key, label, n: xs.length, hit: h, push, miss: dec - h, rate: dec ? h / dec : null } };
    // this season: back to the first break of more than 90 days (the off-season)
    let season = gs.length;
    for (let i = 0; i + 1 < gs.length; i++) if (gs[i].date && gs[i + 1].date && gs[i].date - gs[i + 1].date > 90 * DAY) { season = i + 1; break }
    const windows = [rec(gs.slice(0, 5), 'l5', 'Last 5'), rec(gs.slice(0, 10), 'l10', 'Last 10'), rec(gs.slice(0, 20), 'l20', 'Last 20'), rec(gs.slice(0, season), 'season', 'This season')];
    const opp = [o.opp, o.oppAbbr].map(tm).filter(Boolean);
    const vs = opp.length ? gs.filter(g => [g.opp, g.oppAbbr].map(tm).some(x => x && opp.includes(x))) : [];
    const vals = gs.slice(0, Math.min(20, gs.length)).map(g => g.v);
    const ms = n => gs.slice(0, n).map(g => g.min).filter(m => m != null), l5 = mean(ms(5)), l20 = mean(ms(20));
    const trend = l5 == null || l20 == null || !l20 ? null : (l5 - l20) / l20;
    const similar = (o.prior || []).filter(x => x && x.result && x.line != null && Math.abs(x.line - line) <= Math.max(1, Math.abs(line) * .1)).slice(0, 10)
      .map(x => ({ line: x.line, side: x.side, result: x.result, start: x.start }));
    const sim = similar.filter(x => x.result === 'won' || x.result === 'lost');
    const res = { windows, home: rec(gs.filter(g => g.home === true), 'home', 'Home'), away: rec(gs.filter(g => g.home === false), 'away', 'Away'),
      vsOpp: vs.length ? rec(vs, 'opp', `Against ${o.opp || o.oppAbbr}`) : null, avg: vals.length ? Math.round(mean(vals) * 10) / 10 : null, med: median(vals),
      n: vals.length, mins: { l5: l5 == null ? null : Math.round(l5 * 10) / 10, l20: l20 == null ? null : Math.round(l20 * 10) / 10, trend },
      similar, similarRec: sim.length ? { n: sim.length, won: sim.filter(x => x.result === 'won').length } : null };
    // one sentence a screen reader (and a skimming eye) can take in without the chart
    const w = windows[1].n ? windows[1] : windows[0], word = o.yes ? (over ? 'Yes' : 'No') : over ? 'Over' : 'Under';
    res.summary = !gs.length ? 'No games on record.' : `${word} ${fmt(line)} in ${w.hit} of ${w.n - w.push} ${w.key === 'l10' && w.n === 10 ? 'of the last 10 games' : 'recent games'}${w.push ? ` (${w.push} on the line)` : ''}. Average ${fmt(res.avg)}, median ${fmt(res.med)} over the last ${vals.length}.`;
    return res;
  }

  /* ---------- Prop Explorer: filters and sorts ---------- */
  const WHEN = { soon: 2 * 3600e3 };
  const defaults = () => ({ sport: 'all', league: 'all', game: 'all', team: 'all', q: '', stat: 'all', provider: 'all', side: 'all', l5: 0, l10: 0, l20: 0, edge: null, grade: 'all', when: 'all', injury: 'all', moved: 'all', games: 0, mins: 0 });
  // the line a market opened at, and how far it has moved since, in the direction that matters (+ = easier for the pick)
  function movement(p) {
    const open = p.lineFrom ?? p.openLine ?? p.firstLine ?? null; if (open == null || p.line == null) return null;
    const d = p.line - open; return { from: open, to: p.line, d, easier: d === 0 ? 0 : (p.side === 'under' ? d > 0 : d < 0) ? 1 : -1 };
  }
  const injuryOf = p => p.av?.lv && !['ok', 'active', 'probable'].includes(p.av.lv) ? p.av.lv : null;
  const minsOf = p => mean((p.games || []).slice(0, 5).map(g => g.min).filter(m => m != null));
  /* markets: verified open markets. f: defaults() with changes. o: { now, tz, dayDiff (market.js), grades: Map(id -> grade) }
     -> the markets that pass every filter */
  function filter(markets, f, o = {}) {
    const now = o.now ?? Date.now(), q = tm(f.q), dd = o.dayDiff || ((t, n) => Math.floor(t / DAY) - Math.floor(n / DAY));
    const gr = p => (o.grades?.get(p.id) || p.grade || grade(p, now))?.grade;
    return (markets || []).filter(p =>
      (f.sport === 'all' || p.sport === f.sport) && (f.league === 'all' || (p.league || p.sport) === f.league)
      && (f.game === 'all' || (p.eventId || p.gameKey) === f.game) && (f.team === 'all' || tm(p.team) === tm(f.team) || tm(p.teamName) === tm(f.team))
      && (!q || tm(p.name).includes(q)) && (f.stat === 'all' || p.k === f.stat) && (f.provider === 'all' || (p.books || []).includes(f.provider))
      && (f.side === 'all' || p.side === f.side)
      && (!f.l5 || (p.l5 ?? -1) >= f.l5) && (!f.l10 || (p.l10 ?? -1) >= f.l10) && (!f.l20 || (p.l20 ?? -1) >= f.l20)
      && (f.edge == null || (p.sedge ?? -1e9) >= f.edge)
      && (f.grade === 'all' || GRADE_RANK[gr(p)] >= GRADE_RANK[f.grade])
      && (f.when === 'all' || (f.when === 'soon' ? p.start && +p.start - now <= WHEN.soon : f.when === 'today' ? p.start && dd(+p.start, now, o.tz) === 0 : f.when === 'tomorrow' ? p.start && dd(+p.start, now, o.tz) === 1 : f.when === 'later' ? p.start && dd(+p.start, now, o.tz) >= 2 : true))
      && (f.injury === 'all' || (f.injury === 'clear' ? !injuryOf(p) : !!injuryOf(p)))
      && (f.moved === 'all' || (() => { const m = movement(p); return f.moved === 'moved' ? !!m && m.d !== 0 : f.moved === 'easier' ? m?.easier === 1 : f.moved === 'harder' ? m?.easier === -1 : true })())
      && (!f.games || (p.games || []).filter(g => g.v != null).length >= f.games) && (!f.mins || (minsOf(p) ?? 0) >= f.mins));
  }
  const SORTS = [['edge', 'Best supported edge'], ['evidence', 'Best evidence'], ['hit', 'Highest recent hit rate'], ['move', 'Biggest line movement'], ['soon', 'Starting soon'], ['new', 'Newly posted'], ['followed', 'Most followed'], ['researched', 'Most researched']];
  /* o: { grades, pop: { followed: Map(key -> n), researched: Map(key -> n) }, key: p -> string } */
  function sort(markets, by = 'edge', o = {}) {
    const g = p => GRADE_RANK[(o.grades?.get(p.id) || p.grade || grade(p))?.grade] || 0, se = p => p.sedge ?? -1e9, key = o.key || (p => p.id);
    const pop = (m, p) => (o.pop?.[m]?.get(key(p)) || 0), mv = p => Math.abs(movement(p)?.d || 0), hit = p => p.l10 ?? p.l5 ?? -1;
    const cmp = {
      edge: (a, b) => se(b) - se(a) || g(b) - g(a),
      evidence: (a, b) => g(b) - g(a) || se(b) - se(a),
      hit: (a, b) => hit(b) - hit(a) || (b.l5 ?? -1) - (a.l5 ?? -1) || se(b) - se(a),
      move: (a, b) => mv(b) - mv(a) || se(b) - se(a),
      soon: (a, b) => (+a.start || 9e15) - (+b.start || 9e15) || se(b) - se(a),
      new: (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0) || se(b) - se(a),
      followed: (a, b) => pop('followed', b) - pop('followed', a) || se(b) - se(a),
      researched: (a, b) => pop('researched', b) - pop('researched', a) || se(b) - se(a),
    }[by] || ((a, b) => se(b) - se(a));
    return [...(markets || [])].sort(cmp);
  }
  // what each filter could be set to, from the markets in hand: only values that exist are offered
  function options(markets) {
    const uniq = (f, lab) => { const m = new Map(); for (const p of markets || []) { const k = f(p); if (k != null && k !== '' && !m.has(k)) m.set(k, lab(p)) } return [...m].sort((a, b) => String(a[1]).localeCompare(String(b[1]))) };
    return { sport: uniq(p => p.sport, p => p.sport), league: uniq(p => p.league || p.sport, p => p.league || p.sport), game: uniq(p => p.eventId || p.gameKey, p => p.game || [p.team, p.opp].filter(Boolean).join(' v ')),
      team: uniq(p => p.team, p => p.teamName || p.team), stat: uniq(p => p.k, p => p.label), provider: [...new Set((markets || []).flatMap(p => p.books || []))].sort().map(b => [b, b]) };
  }

  /* ---------- a Prediction Card or parlay read as a whole ---------- */
  /* legs: [{ id, name, short, text, start (ms), line, line0 (line when added), side, grade?, ours, sedge?, out (ruled out), res }]
     -> { n, avgGrade, weakest, expires, moved, outs, open } */
  function card(legs, now = Date.now()) {
    const open = (legs || []).filter(l => !l.res);
    const gs = open.map(l => GRADE_RANK[l.grade?.grade || l.grade]).filter(Boolean), avg = gs.length ? mean(gs) : null;
    const letter = avg == null ? null : avg >= 3.5 ? 'A' : avg >= 2.5 ? 'B' : avg >= 1.5 ? 'C' : 'D';
    const weakScore = l => (GRADE_RANK[l.grade?.grade || l.grade] || 2.5) * 10 + (l.ours ?? .5) * 5;
    const weakest = open.length > 1 ? [...open].sort((a, b) => weakScore(a) - weakScore(b))[0] : null;
    const ahead = open.filter(l => l.start && +l.start > now).sort((a, b) => +a.start - +b.start), started = open.filter(l => l.start && +l.start <= now);
    const moved = open.filter(l => l.line0 != null && l.line != null && l.line0 !== l.line).map(l => ({ ...l, from: l.line0, to: l.line, worse: l.side === 'under' ? l.line < l.line0 : l.line > l.line0 }));
    return { n: (legs || []).length, avgGrade: letter, weakest, expires: ahead[0] ? { leg: ahead[0], in: +ahead[0].start - now } : null, started, moved, outs: open.filter(l => l.out) };
  }
  // "2 h 14 min", "38 min", "under a minute"
  function countdown(ms) {
    if (ms == null) return ''; if (ms <= 0) return 'started'; const m = Math.floor(ms / 60e3);
    if (m < 1) return 'under a minute'; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); if (h < 48) return `${h} h ${m % 60} min`; return `${Math.round(h / 24)} days`;
  }

  /* ---------- finished cards ---------- */
  /* cards: [{ id, name, status: 'open' | 'won' | 'lost' | 'push', legs: [{ lg, res }], at, settled, ours0 }]
     -> { active, done, won, lost, push, rate, best, streak: { kind, n }, avgSize, bySport: [[sport, {won, lost}]], bySize: [[size, {won, lost}]] } */
  function history(cards) {
    const all = cards || [], active = all.filter(c => c.status === 'open'), done = all.filter(c => c.status !== 'open').sort((a, b) => (b.settled || b.at || 0) - (a.settled || a.at || 0));
    const dec = done.filter(c => c.status === 'won' || c.status === 'lost'), won = dec.filter(c => c.status === 'won');
    let streak = { kind: null, n: 0 }; for (const c of dec) { if (!streak.kind) streak = { kind: c.status, n: 1 }; else if (c.status === streak.kind) streak.n++; else break }
    // the best card: the won card that was least likely to win when it was locked (the most legs as a tie-break)
    const best = won.length ? [...won].sort((a, b) => (a.ours0 ?? 1) - (b.ours0 ?? 1) || b.legs.length - a.legs.length)[0] : null;
    const tally = key => { const m = new Map(); for (const c of dec) for (const k of new Set(key(c))) { const t = m.get(k) || { won: 0, lost: 0 }; t[c.status === 'won' ? 'won' : 'lost']++; m.set(k, t) } return [...m].sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost)) };
    const sizeOf = c => { const n = c.legs.length; return n >= 5 ? '5+ picks' : `${n} ${n === 1 ? 'pick' : 'picks'}` };
    return { active: active.length, done: done.length, won: won.length, lost: dec.length - won.length, push: done.length - dec.length, rate: dec.length ? won.length / dec.length : null,
      best, streak, avgSize: all.length ? Math.round(mean(all.map(c => c.legs.length)) * 10) / 10 : null,
      bySport: tally(c => c.legs.map(l => l.lg || l.sport).filter(Boolean)), bySize: tally(c => [sizeOf(c)]) };
  }

  const api = { EXPLAIN, breakdown, kindOf, signed, grade, GRADE_WORD, GRADE_RANK, splits, median, defaults, filter, sort, SORTS, options, movement, injuryOf, card, countdown, history };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.flLabCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
