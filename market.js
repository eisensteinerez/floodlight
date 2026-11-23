/* Floodlight · market checks: the one place that decides whether a prediction may be shown, and the numbers every
   part of a pick card shares.
   - verify(): a prediction is shown on the board only when its event exists on the league schedule, starts in the
     future, has not started, is still scheduled, the provider still offers the line, the player's team is one of the
     two teams, the player is not ruled out, and the price was read recently. Otherwise it is "incomplete" (listed
     apart, never ranked) or "closed" (taken off the board, with the state Pick history uses).
   - when(): "Today", "Tomorrow" or the weekday, worked out from the event's own timestamp in the viewer's time zone,
     never from text that came with a cached answer.
   - sample(): one sample size for every sentence on a card, so "6 of 7 available games" and "averaging 9.4 across
     those 7 games" can never disagree, and "last 10" is said only when ten games exist.
   - supported(): the raw edge cut down by what stands behind it (sample, a long break, an unconfirmed matchup, the
     injury report, role and minutes, an old price, one provider, a moving line, missing inputs), with the reasons.
   - arrange(): best pick per player (default), best per game, or every market with no player more than twice in the
     first ten.
   Pure functions: the page (predictions.js) and the tests (tests/market.test.js) call the same code. */
(function (root) {
  const DAY = 864e5;
  const FRESH = 30 * 60e3;       // a price read within this is current; older is "Using last verified price"
  const MAX_AGE = 90 * 60e3;     // older than this the line is not verified recently, so it leaves the board
  const SCHED_SPORTS = new Set(['nba', 'wnba', 'nfl', 'nhl', 'mlb']);   // leagues with one schedule to check against

  /* ---------- time, in the viewer's zone ---------- */
  const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' } };
  const fmtCache = new Map();
  function parts(t, tz) {
    const k = tz || '';
    if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }));
    const o = {}; for (const x of fmtCache.get(k).formatToParts(new Date(t))) o[x.type] = x.value;
    return o;
  }
  // the calendar day a moment falls on, in a zone: '2026-11-23'
  const dayKey = (t, tz) => { const o = parts(t, tz); return `${o.year}-${o.month}-${o.day}` };
  const dayNum = key => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY;
  // whole days from now's day to t's day: 0 today, 1 tomorrow, -1 yesterday
  const dayDiff = (t, now, tz) => Math.round(dayNum(dayKey(t, tz)) - dayNum(dayKey(now, tz)));
  // milliseconds until the next local midnight (the board is checked again then)
  function toMidnight(now, tz) { const o = parts(now, tz); const s = (+o.hour) * 3600 + (+o.minute) * 60 + (+o.second); return Math.max(1000, (86400 - s) * 1000 - (now % 1000)) }
  function clock(t, tz) { try { return new Date(t).toLocaleTimeString('en-US', { timeZone: tz || undefined, hour: 'numeric', minute: '2-digit' }) } catch (e) { return '' } }
  /* "Today 7:00 PM", "Tomorrow 1:00 PM", "Sun 1:00 PM", "Sun 30 Nov, 1:00 PM"; null when there is no start time */
  function when(t, now, tz) {
    if (t == null || isNaN(+t)) return null;
    t = +t; tz = tz || localTz(); const d = dayDiff(t, now, tz), c = clock(t, tz);
    if (d === 0) return `Today ${c}`;
    if (d === 1) return `Tomorrow ${c}`;
    const o = parts(t, tz);
    if (d > 1 && d < 7) return `${o.weekday} ${c}`;
    return `${o.weekday} ${+o.day} ${new Date(t).toLocaleDateString('en-US', { timeZone: tz, month: 'short' })}, ${c}`;
  }
  const dayWord = (t, now, tz) => { if (t == null) return null; const d = dayDiff(+t, now, tz || localTz()); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 0 ? 'past' : 'later' };

  /* ---------- the event behind a prop ---------- */
  const tm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function teamNames(c) { const t = c?.team || {}; return [t.abbreviation, t.displayName, t.shortDisplayName, t.name, t.location, t.nickname].map(tm).filter(Boolean) }
  function evStatus(ev) {
    const t = ev?.competitions?.[0]?.status?.type || ev?.status?.type || {}, txt = `${t.name || ''} ${t.description || ''} ${t.detail || ''}`;
    if (/cancel|forfeit/i.test(txt)) return 'cancelled';
    if (/postpon|suspend/i.test(txt)) return 'postponed';
    return t.state === 'in' ? 'live' : t.state === 'post' || t.completed ? 'final' : 'scheduled';
  }
  /* The game a prop belongs to, from the schedule's events: the one game the player's team is in, closest to the
     provider's start time (or, with no start time, the next one still to play). null when the team has no game. */
  function findEvent(p, events, now) {
    const mine = [p.team, p.teamName, p.bookTeam].map(tm).filter(Boolean); if (!mine.length) return null;
    const hits = [];
    for (const ev of events || []) {
      const cs = ev?.competitions?.[0]?.competitors || [], me = cs.find(c => teamNames(c).some(n => mine.includes(n))); if (!me) continue;
      const op = cs.find(c => c !== me), start = Date.parse(ev.date || ev.competitions?.[0]?.date || '') || null;
      hits.push({ id: String(ev.id || ''), start, status: evStatus(ev), teamId: String(me.team?.id || ''), team: me.team?.shortDisplayName || me.team?.name || me.team?.displayName || '',
        teamAbbr: me.team?.abbreviation || '', oppId: String(op?.team?.id || ''), opp: op?.team?.shortDisplayName || op?.team?.name || op?.team?.displayName || '', oppAbbr: op?.team?.abbreviation || '',
        oppNames: op ? teamNames(op) : [], home: me.homeAway === 'home' });
    }
    if (!hits.length) return null;
    if (p.start) return hits.sort((a, b) => Math.abs((a.start || 0) - p.start) - Math.abs((b.start || 0) - p.start))[0];
    const ahead = hits.filter(h => h.status === 'scheduled' && h.start > now).sort((a, b) => a.start - b.start);
    return ahead[0] || hits.sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  }

  /* ---------- may this prediction be shown? ---------- */
  // the states a prediction taken off the board is filed under (the same words Pick history uses)
  const GONE = { started: 'Awaiting result', finished: 'Awaiting result', closed: 'Market closed', withdrawn: 'Market closed', cancelled: 'Cancelled', postponed: 'Cancelled', out: 'Voided', past: 'Awaiting result', unknown: 'Data unavailable' };
  const closed = (why, text, extra) => ({ state: 'closed', why, label: GONE[why] || 'Data unavailable', text, ...extra });
  const incomplete = (why, text, extra) => ({ state: 'incomplete', why, text, ...extra });
  /* p: a pick. o: { now, tz, sched: { status: 'ready' | 'loading' | 'error' | 'none', events }, injury: { lv } | null }
     -> { state: 'open' | 'checking' | 'incomplete' | 'closed', why, text, label (closed only), start, event, price: 'fresh' | 'stale' } */
  function verify(p, o = {}) {
    const now = o.now ?? Date.now(), tz = o.tz || localTz();
    const at = p.at || 0, age = at ? now - at : Infinity, price = age <= FRESH ? 'fresh' : 'stale';
    if (p.type !== 'match' && p.mid) return fromServer(p, o);   // checked by the verified market service (markets.py)
    if (p.type === 'match') {
      const start = p.start ? +p.start : null;
      if (!start) return incomplete('no_start', 'Kick-off time not confirmed');
      if (start <= now) return closed(dayDiff(start, now, tz) < 0 ? 'past' : 'started', dayDiff(start, now, tz) < 0 ? `Played ${when(start, now, tz) || 'earlier'}` : 'The game has started');
      return { state: 'open', why: '', text: '', start, event: { id: String(p.m?.key || p.id), start, verified: 'forecast' }, price: 'fresh' };
    }
    if (p.closed || (p.status && !['pre_game', 'open', 'active', 'scheduled'].includes(String(p.status)))) return closed('closed', 'The provider closed this line');
    const inj = o.injury;
    let start = p.start ? +p.start : null;
    if (start && start <= now) return closed(dayDiff(start, now, tz) < 0 ? 'past' : 'started', dayDiff(start, now, tz) < 0 ? `From ${when(start, now, tz)}; that game is over` : 'The game has started');
    if (inj && inj.lv === 'out') return closed('out', `${p.name} is listed out${inj.status ? ` (${inj.status})` : ''}`);
    const S = o.sched || { status: SCHED_SPORTS.has(p.sport) ? 'loading' : 'none' };
    let ev = null, verified = '';
    if (S.status === 'ready') {
      ev = findEvent({ ...p, start }, S.events, now);
      if (!ev) return start ? incomplete('no_event', `No ${p.teamName || p.team || 'team'} game on the league schedule at that time`) : closed('unknown', `No ${p.teamName || p.team || 'team'} game today or tomorrow, so this line has nothing to settle on`);
      if (ev.status === 'cancelled' || ev.status === 'postponed') return closed(ev.status, ev.status === 'cancelled' ? 'The game was cancelled' : 'The game was postponed', { event: ev });
      if (ev.status === 'live') return closed('started', 'The game has started', { event: ev });
      // a line with no start time of its own that only matches a finished game is a line the provider forgot to close
      if (ev.status === 'final') return start ? closed(dayDiff(ev.start || now, now, tz) < 0 ? 'past' : 'finished', `The game is over (${when(ev.start, now, tz) || 'earlier'})`, { event: ev })
        : closed('closed', `Its game finished ${when(ev.start, now, tz) || 'earlier'}, but the provider still lists the line`, { event: ev });
      if (!ev.start || ev.start <= now) return closed('started', 'The game has started', { event: ev });
      if (start && Math.abs(ev.start - start) > 12 * 3600e3) return incomplete('time_mismatch', `The provider’s start time doesn’t match the schedule (${when(ev.start, now, tz)})`, { event: ev });
      if (p.opp && ev.oppNames.length && !ev.oppNames.includes(tm(p.opp))) return incomplete('opp_mismatch', `The provider lists ${p.opp} as the opponent; the schedule says ${ev.opp}`, { event: ev });
      start = ev.start; verified = 'schedule';
    } else if (S.status === 'loading') {
      return { state: 'checking', why: 'checking', text: 'Checking the league schedule', start, price };
    } else if (S.status === 'error') {
      return incomplete('no_schedule', 'The league schedule did not load, so the matchup can’t be confirmed', { start });
    } else {   // a league with no single schedule (soccer): the provider's own start time and opponent, both required
      if (!start) return incomplete('no_start', 'Game time not confirmed', { start });
      if (!p.opp) return incomplete('no_opp', 'Opponent not confirmed', { start });
      verified = 'provider';
      ev = { id: '', start, opp: p.opp, oppAbbr: p.opp, team: p.teamName || p.team, home: null };
    }
    if (age > MAX_AGE) return incomplete('unverified', `Price not re-checked since ${clock(at, tz)}`, { start, event: ev });
    return { state: 'open', why: '', text: '', start, event: { ...ev, verified }, price };
  }
  /* ---------- the verified market service's statuses (markets.py) ---------- */
  const STATUS = ['open', 'suspended', 'closed', 'started', 'expired', 'voided', 'missing_matchup', 'player_out', 'provider_unavailable', 'awaiting_verification'];
  const STATUS_LABEL = { open: 'Open', suspended: 'Suspended', closed: 'Closed', started: 'Started', expired: 'Expired', voided: 'Voided', missing_matchup: 'Missing matchup',
    player_out: 'Player ruled out', provider_unavailable: 'Provider unavailable', awaiting_verification: 'Awaiting verification' };
  // where a status that is not open is filed on the Predictions page: taken off the board, or an incomplete market
  const STATUS_STATE = { suspended: 'incomplete', missing_matchup: 'incomplete', awaiting_verification: 'incomplete', provider_unavailable: 'incomplete',
    closed: 'closed', started: 'closed', expired: 'closed', voided: 'closed', player_out: 'closed' };
  const STATUS_GONE = { closed: 'Market closed', started: 'Awaiting result', expired: 'Awaiting result', voided: 'Voided', player_out: 'Voided' };
  const ms = v => v == null || v === '' ? null : typeof v === 'number' ? (v > 1e11 ? v : v * 1000) : (Date.parse(v) || null);
  /* gate(): the checks that depend on the clock, run on every market the server marked open, in every page, every time
     it draws. p: a market (the server's row fields: status, start, verifiedAt, eventId). o: { now, injury: { lv } }.
     -> { status, label, reason } ; status 'open' only when every check passes. Pure: the tests drive it. */
  function gate(p, o = {}) {
    const now = o.now ?? Date.now(), st = p.status || 'awaiting_verification';
    const out = (status, reason) => ({ status, label: STATUS_LABEL[status], reason });
    if (st !== 'open') return out(st, p.removalReason || p.reason || STATUS_LABEL[st]);
    const start = ms(p.start);
    if (!start) return out('missing_matchup', 'Game time not confirmed');
    if (start <= now) return out('started', 'The game has started');
    if (!p.eventId && p.matchup !== 'provider') return out('missing_matchup', 'No game on the league schedule');
    if (o.injury?.lv === 'out') return out('player_out', `${p.name || p.player || 'The player'} is listed out`);
    const at = ms(p.verifiedAt);
    if (!at) return out('awaiting_verification', 'Not verified by the provider yet');
    if (now - at > MAX_AGE) return out('awaiting_verification', `Not re-checked by the provider since ${clock(at, o.tz)}`);
    return out('open', '');
  }
  /* the server's verdict, in verify()'s shape, for a market the verified service already checked */
  function fromServer(p, o) {
    const now = o.now ?? Date.now(), tz = o.tz || localTz(), g = gate(p, o), start = ms(p.start);
    const at = ms(p.verifiedAt) || p.at || 0, price = now - at <= FRESH ? 'fresh' : 'stale';
    const event = { id: p.eventId || '', start, teamId: p.teamId || '', team: p.teamName || p.team || '', teamAbbr: p.team || '', oppId: p.oppId || '', opp: p.oppName || p.opp || '', oppAbbr: p.opp || '',
      oppNames: [], home: p.home ?? null, verified: p.matchup === 'provider' ? 'provider' : 'schedule' };
    if (g.status === 'open') return { state: 'open', why: '', text: '', start, event, price, status: 'open' };
    const state = STATUS_STATE[g.status] || 'incomplete';
    return state === 'closed' ? { state, why: g.status, label: STATUS_GONE[g.status] || 'Market closed', text: g.reason, start, event, status: g.status }
      : { state, why: g.status, text: g.reason, start, event, status: g.status };
  }

  /* lines that were on the board and are missing from a fresh reading of the same sport: the provider stopped offering them */
  function withdrawn(before, picks, answered) {
    const have = new Set(picks.map(p => p.sk || p.id)), out = [];
    for (const [k, p] of before) if (answered.has(p.sport) && !have.has(k)) out.push(p);
    return out;
  }

  /* ---------- one sample size for the whole card ---------- */
  const fmt = v => Number.isInteger(v) ? String(v) : (+v).toFixed(1);
  /* games: newest first, each { v }. -> { total, n (games in the headline window), hits, pushes, avg, last5, label,
     texts: { hit, avg, run } }. The window is the last 10 when ten exist, otherwise every available game. */
  function sample(games, line, side, yes) {
    const gs = (games || []).filter(g => g && g.v != null && !isNaN(g.v)), total = gs.length, n = Math.min(10, total), win = gs.slice(0, n);
    const over = side !== 'under', word = yes ? (over ? 'Yes' : 'No') : over ? 'Over' : 'Under';
    const hit = g => over ? g.v > line : g.v < line, push = g => g.v === line;
    const hits = win.filter(hit).length, pushes = win.filter(push).length, avg = n ? Math.round(win.reduce((a, g) => a + g.v, 0) / n * 10) / 10 : null;
    const l5 = gs.slice(0, Math.min(5, total)), last5 = { n: l5.length, hit: l5.filter(hit).length };
    const full = total >= 10, label = !n ? 'no games' : full ? 'last 10' : n === 1 ? 'the only available game' : `${n} available games`;
    const texts = { hit: '', avg: '', run: '' };
    if (n) {
      texts.hit = n === 1 ? `${word} in the only available game` : full ? `${word} in ${hits} of the last 10` : `${word} in ${hits} of ${n} available games`;
      if (pushes) texts.hit += `, ${pushes} ${pushes === 1 ? 'push' : 'pushes'}`;
      if (!yes) texts.avg = n === 1 ? `${fmt(avg)} in that game` : full ? `Averaging ${fmt(avg)} over the last 10` : `Averaging ${fmt(avg)} across those ${n} games`;
      if (total > 5 && last5.n === 5 && (last5.hit === 5 || last5.hit === 0)) texts.run = last5.hit === 5 ? `${word} in the last 5` : `${yes ? (over ? 'No' : 'Yes') : over ? 'Under' : 'Over'} in the last 5`;
      else if (total > 5 && last5.n === 5 && (last5.hit === 4 || last5.hit === 1)) texts.run = `${word} in ${last5.hit} of the last 5`;
    }
    return { total, n, hits, pushes, rate: n - pushes ? hits / (n - pushes) : null, avg, last5, full, label, word, texts };
  }

  /* ---------- supported edge ---------- */
  const DAILY = new Set(['nba', 'wnba', 'nhl', 'mlb']);
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const INJ = { questionable: [.6, 'Questionable on the injury report'], doubtful: [.3, 'Doubtful on the injury report'], dtd: [.8, 'Day to day on the injury report'], probable: [.92, 'Probable on the injury report'] };
  /* p: a pick with edge. x: { verdict, injury, moved: { from, to } | null, now }.
     -> { raw, edge (supported, whole points), factor (0-1), reasons: [text], strength: 'strong' | 'moderate' | 'limited', inputs } */
  function supported(p, x = {}) {
    const now = x.now ?? Date.now(), raw = p.edge, cut = [];
    const add = (f, why) => { if (f < .995) cut.push([f, why]) };
    if (p.type === 'match') {
      const c = String(p.conf || '').toLowerCase();
      add(c === 'low' ? .6 : c === 'medium' ? .85 : 1, `Forecast confidence is ${c || 'not given'}`);
      if (p.market == null) add(.9, 'No market price to check it against');
    } else {
      const gs = (p.games || []).filter(g => g.v != null), n = gs.length;
      // sample size: full weight from 15 games
      add(n ? Math.min(1, Math.sqrt(n / 15)) : .2, n ? `Only ${n} available ${n === 1 ? 'game' : 'games'}` : 'No games on record');
      // days since the last appearance, and a long break inside the recent log
      const ds = gs.map(g => g.date).filter(Boolean), last = ds[0], gapDays = last ? Math.floor((now - last) / DAY) : null, long = DAILY.has(p.sport) ? 14 : 21;
      if (gapDays != null && gapDays >= 60) add(.5, `${gapDays}-day gap since the last appearance`);
      else if (gapDays != null && gapDays >= long) add(.8, `${gapDays} days since the last appearance`);
      else for (let i = 0; i + 1 < Math.min(ds.length, 6); i++) { const g = Math.round((ds[i] - ds[i + 1]) / DAY); if (g >= Math.max(long, 30)) { add(.75, `${g}-day gap in appearances`); break } }
      // recency: how much of the log is from the last 60 days
      if (ds.length >= 5 && ds.filter(d => now - d < 60 * DAY).length < Math.min(5, ds.length) / 2) add(.85, 'Most games are more than two months old');
      // minutes and role
      const mins = n => gs.slice(0, n).map(g => g.min).filter(m => m != null), m5 = mean(mins(5)), m20 = mean(mins(20));
      if (m5 && m20 && mins(20).length >= 10 && Math.abs(m5 - m20) / m20 >= .15) add(.85, 'Role changed recently');
      const ms = mins(5); if (ms.length >= 4 && m5) { const sd = Math.sqrt(mean(ms.map(m => (m - m5) ** 2))); if (sd / m5 > .25) add(.85, 'Minutes vary from game to game') }
      // the injury report and the lineup
      const lv = x.injury?.lv; if (INJ[lv]) add(INJ[lv][0], INJ[lv][1]);
      // providers: how many post this line, and how many price it
      const books = new Set((p.offers || []).filter(o => o.line === p.line).map(o => o.book)), priced = (p.offers || []).filter(o => o.pOver != null && o.line === p.line).length;
      if (books.size <= 1) add(.9, 'Only one provider posts this line');
      else if (priced <= 1 && p.market != null) add(.95, 'Only one provider prices both sides');
      // data quality and missing inputs
      if (p.teamNote || p.conf === 'low') add(.6, 'The books’ team and the stats’ team disagree');
      if (!p.opp && !x.verdict?.event?.opp) add(.85, 'Opponent unknown');
      if (p.mu == null && !p.yes) add(.9, 'No projection for this line');
    }
    // checks that apply to every pick
    const v = x.verdict;
    if (v?.event?.verified === 'provider') add(.75, 'Matchup confirmed by the provider only');
    if (v && v.state === 'incomplete') add(.5, 'Matchup not confirmed');
    const age = p.at ? now - p.at : null;
    if (p.type === 'prop' && age != null && age > FRESH) add(.8, `Price last verified ${Math.round(age / 60000)} min ago`);
    if (x.moved && x.moved.from != null && x.moved.to != null && x.moved.kind === 'line' && Math.abs(x.moved.to - x.moved.from) >= 1) add(.9, `Line moved from ${fmt(x.moved.from)} to ${fmt(x.moved.to)}`);
    const factor = cut.reduce((a, [f]) => a * f, 1);
    const edge = raw == null ? null : Math.round(raw * factor);
    const cuts = cut.sort((a, b) => a[0] - b[0]);
    return { raw, edge, factor, reasons: cuts.map(c => c[1]), cuts: cuts.map(c => [c[0], c[1]]), strength: factor >= .75 ? 'strong' : factor >= .45 ? 'moderate' : 'limited' };
  }

  /* ---------- the board's order and grouping ---------- */
  const SORTS = {
    edge: (a, b) => (b.sedge ?? -1e9) - (a.sedge ?? -1e9) || b.ours - a.ours,
    prob: (a, b) => b.ours - a.ours || (b.sedge ?? -1e9) - (a.sedge ?? -1e9),
    evidence: (a, b) => (b.support ?? 0) - (a.support ?? 0) || (b.sedge ?? -1e9) - (a.sedge ?? -1e9),
    fresh: (a, b) => (b.at || 0) - (a.at || 0) || (b.sedge ?? -1e9) - (a.sedge ?? -1e9),
    soon: (a, b) => (+a.start || 0) - (+b.start || 0) || (b.sedge ?? -1e9) - (a.sedge ?? -1e9),
    raw: (a, b) => (b.edge ?? -1e9) - (a.edge ?? -1e9) || b.ours - a.ours,
  };
  const playerKey = p => p.type === 'match' ? 'match:' + (p.m?.key || p.id) : `${p.sport}:${tm(p.name)}`;
  const gameKey = p => p.eventId ? `${p.sport}:ev:${p.eventId}` : p.gameKey || playerKey(p);
  /* picks sorted already. mode: 'player' (best pick per player), 'game' (best per game) or 'all'.
     -> [{ key, best, more: [picks] }]; in 'all' no player appears more than twice in the first ten */
  function arrange(picks, mode = 'player') {
    if (mode === 'all') {
      const out = [], wait = [], seen = new Map();
      for (const p of picks) { const k = playerKey(p), c = seen.get(k) || 0; if (out.length < 10 && c >= 2) { wait.push(p); continue } seen.set(k, c + 1); out.push(p) }
      // the held-back markets go straight after the first ten, in their own order
      const head = out.slice(0, 10), tail = [...wait, ...out.slice(10)].sort((a, b) => picks.indexOf(a) - picks.indexOf(b));
      return [...head, ...tail].map(p => ({ key: p.id, best: p, more: [] }));
    }
    const by = mode === 'game' ? gameKey : playerKey, groups = new Map();
    for (const p of picks) { const k = by(p); if (!groups.has(k)) groups.set(k, { key: k, best: p, more: [] }); else groups.get(k).more.push(p) }
    return [...groups.values()];
  }

  /* ---------- availability: three separate things ---------- */
  const LV_TEXT = { out: 'Out', doubtful: 'Doubtful', questionable: 'Questionable', dtd: 'Day to day', probable: 'Probable', active: 'Active' };
  /* st: the injury report line (injuries.js status()) or null; ready: whether the report loaded; role: { uncertain }.
     -> { avail, report, start, tag (a warning for the card, or null) } */
  function availability(st, ready, role) {
    if (!ready) return { avail: 'Not checked', report: 'Injury report not loaded', start: 'Lineup not announced', tag: null };
    const what = st?.what ? ` with ${st.what.toLowerCase().split(', ').filter(Boolean).slice(-1)[0] || st.what.toLowerCase()} injury` : '';
    const lv = st?.lv;
    const avail = !st ? 'Expected to play' : lv === 'active' || lv === 'probable' ? (lv === 'active' ? 'Active and expected to play' : 'Probable') : LV_TEXT[lv] || 'On injury report';
    const report = !st ? 'Not on the injury report' : `Listed${what || ' on the report'}${st.status && !/^active$/i.test(st.status) && LV_TEXT[lv] !== st.status ? ` (${st.status})` : ''}`;
    const start = role?.uncertain ? 'Available, role uncertain' : 'Lineup not announced';
    const tag = !st || lv === 'active' || lv === 'probable' ? null : lv === 'out' ? 'Listed out' : `${LV_TEXT[lv] || 'On injury report'} to play`;
    return { avail, report, start, tag, lv: lv || 'ok' };
  }

  const api = { STATUS, STATUS_LABEL, STATUS_STATE, gate, fromServer, FRESH, MAX_AGE, SCHED_SPORTS, GONE, localTz, dayKey, dayDiff, dayWord, toMidnight, when, clock, findEvent, evStatus, verify, withdrawn, sample, supported, SORTS, arrange, playerKey, gameKey, availability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.flMarket = api;
})(typeof window !== 'undefined' ? window : globalThis);
