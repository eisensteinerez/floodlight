// Expired markets, day labels, matchups, sample size, supported edge and grouping (market.js). Run: node tests/market.test.js
const path = require('path'), assert = require('assert');
const M = require(path.join(__dirname, '..', 'market.js'));

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name) };
const H = 36e5, MIN = 6e4;
const NOW = Date.parse('2026-11-23T17:00:00Z');   // Monday 12:00 PM in New York
const NY = 'America/New_York', TLV = 'Asia/Jerusalem', LA = 'America/Los_Angeles';

// an ESPN scoreboard event
const ev = (id, start, home, away, state = 'pre', extra = {}) => ({ id, date: new Date(start).toISOString(), competitions: [{ status: { type: { state, completed: state === 'post', name: extra.name || '', description: extra.description || '' } },
  competitors: [{ homeAway: 'home', team: { id: home.id, abbreviation: home.abbr, displayName: home.name, shortDisplayName: home.short } }, { homeAway: 'away', team: { id: away.id, abbreviation: away.abbr, displayName: away.name, shortDisplayName: away.short } }] }] });
const PHI = { id: '21', abbr: 'PHI', name: 'Philadelphia Eagles', short: 'Eagles' }, LV = { id: '13', abbr: 'LV', name: 'Las Vegas Raiders', short: 'Raiders' };
const CLE = { id: '5', abbr: 'CLE', name: 'Cleveland Browns', short: 'Browns' }, PIT = { id: '23', abbr: 'PIT', name: 'Pittsburgh Steelers', short: 'Steelers' };
const games = (vals, from = NOW - 2 * 24 * H, step = 7) => vals.map((v, i) => ({ v, min: 60, date: from - i * step * 24 * H }));
const prop = (o = {}) => ({ id: 'prop:nfl:Joe Milton:pc:18.5', sk: 'prop:nfl:Joe Milton:pc', type: 'prop', sport: 'nfl', name: 'Joe Milton', team: 'CLE', opp: 'PIT', k: 'pc', label: 'Completions', line: 18.5, side: 'under',
  ours: .7, market: .5, edge: 20, at: NOW - 2 * MIN, start: NOW + 3 * H, books: ['prizepicks', 'sleeper'], offers: [{ book: 'prizepicks', line: 18.5 }, { book: 'sleeper', line: 18.5, pOver: .5 }],
  games: games([15, 17, 20, 14, 16, 18, 19, 22, 12, 17, 16, 15, 14, 13, 18, 17]), mu: 16.4, ...o });
const sched = (...evs) => ({ status: 'ready', events: evs });
const today = sched(ev('401', NOW + 3 * H, PIT, CLE));

/* 1. Expired markets disappear at game start */
t('a prop whose game starts later today is open, with the schedule’s event, start and opponent', () => {
  const v = M.verify(prop(), { now: NOW, tz: NY, sched: today });
  assert.equal(v.state, 'open'); assert.equal(v.event.id, '401'); assert.equal(v.event.oppId, '23'); assert.equal(v.event.teamId, '5'); assert.equal(v.event.verified, 'schedule');
});
t('one minute after the start the prop is closed, whatever the schedule says', () => {
  const p = prop({ start: NOW - MIN }), v = M.verify(p, { now: NOW, tz: NY, sched: sched(ev('401', NOW - MIN, PIT, CLE)) });
  assert.equal(v.state, 'closed'); assert.equal(v.label, 'Awaiting result');
  assert.equal(M.verify(p, { now: NOW, tz: NY, sched: { status: 'loading' } }).state, 'closed');
  assert.equal(M.verify(p, { now: NOW, tz: NY, sched: { status: 'error' } }).state, 'closed');
});
t('a game the schedule shows as started or final closes the prop even if the provider’s time is later', () => {
  assert.equal(M.verify(prop(), { now: NOW, tz: NY, sched: sched(ev('401', NOW + 3 * H, PIT, CLE, 'in')) }).state, 'closed');
  assert.equal(M.verify(prop(), { now: NOW, tz: NY, sched: sched(ev('401', NOW + 3 * H, PIT, CLE, 'post')) }).state, 'closed');
});
t('a postponed or cancelled game files the prop as Cancelled', () => {
  const v = M.verify(prop(), { now: NOW, tz: NY, sched: sched(ev('401', NOW + 3 * H, PIT, CLE, 'pre', { name: 'STATUS_POSTPONED', description: 'Postponed' })) });
  assert.equal(v.state, 'closed'); assert.equal(v.label, 'Cancelled');
});
t('a match forecast that kicked off is closed too', () => {
  assert.equal(M.verify({ type: 'match', id: 'match:x', start: new Date(NOW - MIN), m: { key: 'x' } }, { now: NOW, tz: NY }).state, 'closed');
  assert.equal(M.verify({ type: 'match', id: 'match:x', start: new Date(NOW + H), m: { key: 'x' } }, { now: NOW, tz: NY }).state, 'open');
});

/* 2. Cached props from yesterday never become today's */
t('yesterday’s cached prop is closed today and never labelled Today', () => {
  const yday = Date.parse('2026-11-22T18:00:00Z'), p = prop({ start: yday, at: yday - H });
  const v = M.verify(p, { now: NOW, tz: NY, sched: today });
  assert.equal(v.state, 'closed'); assert.ok(!/today/i.test(v.text));
  assert.ok(!/^Today/.test(M.when(yday, NOW, NY)));
});
t('a line with no start time (Sleeper) is never Today: with no game today or tomorrow it is taken off', () => {
  const p = prop({ start: null, at: NOW - MIN, books: ['sleeper'] });
  assert.equal(M.when(p.start, NOW, NY), null);
  const v = M.verify(p, { now: NOW, tz: NY, sched: sched(ev('399', Date.parse('2026-11-22T18:00:00Z'), PIT, CLE, 'post')) });
  assert.equal(v.state, 'closed'); assert.equal(v.label, 'Market closed'); assert.ok(!/Today/.test(v.text));
  assert.equal(M.verify(p, { now: NOW, tz: NY, sched: sched() }).state, 'closed');
});
t('a line with no start time takes the start from the schedule when the team plays later', () => {
  const v = M.verify(prop({ start: null }), { now: NOW, tz: NY, sched: today });
  assert.equal(v.state, 'open'); assert.equal(v.start, NOW + 3 * H);
});
t('an answer read hours ago is not shown as verified', () => {
  const v = M.verify(prop({ at: NOW - 3 * H }), { now: NOW, tz: NY, sched: today });
  assert.equal(v.state, 'incomplete'); assert.equal(v.why, 'unverified');
  assert.equal(M.verify(prop({ at: NOW - 40 * MIN }), { now: NOW, tz: NY, sched: today }).price, 'stale');
  assert.equal(M.verify(prop(), { now: NOW, tz: NY, sched: today }).price, 'fresh');
});

/* 3. Time zone rollover */
t('“Today” comes from the timestamp in the viewer’s zone', () => {
  const start = Date.parse('2026-11-24T01:00:00Z');   // 8 PM Monday in New York, 3 AM Tuesday in Israel
  assert.match(M.when(start, NOW, NY), /^Today 8:00 PM/);
  assert.match(M.when(start, NOW, TLV), /^Tomorrow 3:00 AM/);
  assert.match(M.when(start, NOW, LA), /^Today 5:00 PM/);
});
t('after local midnight the same game moves from Tomorrow to Today, and yesterday’s games stop being Today', () => {
  const start = Date.parse('2026-11-24T18:00:00Z'), before = Date.parse('2026-11-24T04:59:00Z'), after = Date.parse('2026-11-24T05:01:00Z');   // NY midnight is 05:00Z
  assert.match(M.when(start, before, NY), /^Tomorrow/); assert.match(M.when(start, after, NY), /^Today/);
  const lastNight = Date.parse('2026-11-24T03:00:00Z');
  assert.equal(M.dayWord(lastNight, before, NY), 'today'); assert.equal(M.dayWord(lastNight, after, NY), 'past');
});
t('the time to the next local midnight is worked out in the viewer’s zone', () => {
  assert.equal(M.toMidnight(Date.parse('2026-11-24T04:59:00Z'), NY), 60000);
  assert.equal(M.toMidnight(Date.parse('2026-11-23T21:59:00Z'), TLV), 60000);
});
t('a week ahead shows the date, not a weekday that could be this week', () => {
  assert.match(M.when(NOW + 8 * 24 * H, NOW, NY), /Dec, /);
  assert.match(M.when(NOW + 3 * 24 * H, NOW, NY), /^Thu /);
});

/* 4. Missing opponents */
t('a prop whose team has no game on the schedule at that time is incomplete, not on the board', () => {
  const v = M.verify(prop(), { now: NOW, tz: NY, sched: sched(ev('402', NOW + 3 * H, PHI, LV)) });
  assert.equal(v.state, 'incomplete'); assert.equal(v.why, 'no_event');
});
t('a provider opponent that differs from the schedule is incomplete', () => {
  const v = M.verify(prop({ opp: 'BAL' }), { now: NOW, tz: NY, sched: today });
  assert.equal(v.state, 'incomplete'); assert.equal(v.why, 'opp_mismatch');
});
t('with no league schedule (soccer) a prop needs the provider’s start and opponent', () => {
  const s = { sport: 'soccer', team: 'Arsenal' };
  assert.equal(M.verify(prop({ ...s, opp: '' }), { now: NOW, tz: NY, sched: { status: 'none' } }).why, 'no_opp');
  assert.equal(M.verify(prop({ ...s, start: null }), { now: NOW, tz: NY, sched: { status: 'none' } }).why, 'no_start');
  const ok = M.verify(prop({ ...s, opp: 'Chelsea' }), { now: NOW, tz: NY, sched: { status: 'none' } });
  assert.equal(ok.state, 'open'); assert.equal(ok.event.verified, 'provider');
});
t('a schedule that did not load leaves the prop incomplete, never ranked', () => assert.equal(M.verify(prop(), { now: NOW, tz: NY, sched: { status: 'error' } }).state, 'incomplete'));
t('while the schedule loads the prop is being checked, not shown', () => assert.equal(M.verify(prop(), { now: NOW, tz: NY, sched: { status: 'loading' } }).state, 'checking'));

/* 5. Closed provider markets */
t('a line the provider closed is filed as Market closed', () => {
  const v = M.verify(prop({ status: 'suspended' }), { now: NOW, tz: NY, sched: today });
  assert.equal(v.state, 'closed'); assert.equal(v.label, 'Market closed');
  assert.equal(M.verify(prop({ closed: true }), { now: NOW, tz: NY, sched: today }).label, 'Market closed');
});
t('a line missing from a fresh reading of its sport is withdrawn; a sport that did not answer withdraws nothing', () => {
  const a = prop(), b = prop({ sk: 'prop:nfl:Myles Garrett:sk', id: 'prop:nfl:Myles Garrett:sk:0.5', name: 'Myles Garrett' });
  const before = new Map([[a.sk, a], [b.sk, b]]);
  assert.deepEqual(M.withdrawn(before, [a], new Set(['nfl'])).map(p => p.name), ['Myles Garrett']);
  assert.deepEqual(M.withdrawn(before, [a], new Set(['nba'])), []);
});

/* 6. Player ruled out after publication */
t('a player listed out is taken off the board as Voided', () => {
  const v = M.verify(prop(), { now: NOW, tz: NY, sched: today, injury: { lv: 'out', status: 'Out' } });
  assert.equal(v.state, 'closed'); assert.equal(v.label, 'Voided');
});
t('questionable stays on the board with a smaller supported edge; active is not a warning', () => {
  const v = M.verify(prop(), { now: NOW, tz: NY, sched: today, injury: { lv: 'questionable' } }); assert.equal(v.state, 'open');
  const q = M.supported(prop(), { now: NOW, verdict: v, injury: { lv: 'questionable' } }), a = M.supported(prop(), { now: NOW, verdict: v, injury: { lv: 'active' } });
  assert.ok(q.edge < a.edge); assert.ok(q.reasons.some(r => /Questionable/.test(r)));
  assert.equal(M.availability({ lv: 'active', status: 'Active', what: 'Shoulder' }, true).tag, null);
  const av = M.availability({ lv: 'active', status: 'Active', what: 'Shoulder' }, true);
  assert.equal(av.avail, 'Active and expected to play'); assert.match(av.report, /shoulder injury/); assert.equal(av.start, 'Lineup not announced');
  assert.equal(M.availability(null, true).report, 'Not on the injury report'); assert.equal(M.availability(null, true).tag, null);
  assert.equal(M.availability({ lv: 'questionable', status: 'Questionable' }, true).tag, 'Questionable to play');
});

/* 7. Samples smaller than ten games: one number everywhere */
const S = (k, line = 10.5, side = 'under') => M.sample(games(Array.from({ length: k }, (_, i) => [9, 8, 12, 9, 10, 7, 11, 9, 8, 10, 13, 9][i % 12])), line, side);
t('0 games: nothing is claimed', () => { const s = S(0); assert.equal(s.n, 0); assert.deepEqual(s.texts, { hit: '', avg: '', run: '' }) });
t('1 game: “the only available game”', () => { const s = S(1); assert.equal(s.n, 1); assert.match(s.texts.hit, /only available game/); assert.ok(!/last/.test(JSON.stringify(s.texts))) });
t('5 games: “of 5 available games”, “across those 5 games”, no last-5 run claimed on a 5-game log', () => { const s = S(5); assert.match(s.texts.hit, /of 5 available games/); assert.match(s.texts.avg, /across those 5 games/); assert.equal(s.texts.run, '') });
t('7 games: every sentence says 7', () => {
  const s = S(7), all = Object.values(s.texts).join(' | ');
  assert.equal(s.n, 7); assert.match(s.texts.hit, /^Under in \d of 7 available games$/); assert.match(s.texts.avg, /^Averaging [\d.]+ across those 7 games$/);
  assert.ok(!/last 10|last 7/.test(all), all);
});
t('10 games: “of the last 10” and “over the last 10”', () => { const s = S(10); assert.equal(s.n, 10); assert.match(s.texts.hit, /of the last 10$/); assert.match(s.texts.avg, /over the last 10$/) });
t('more than 10 games: the window is the last 10, the total is kept', () => { const s = S(16); assert.equal(s.n, 10); assert.equal(s.total, 16); assert.match(s.texts.hit, /of the last 10/) });
t('no sample under 10 ever says “last 10”', () => { for (let k = 0; k < 10; k++) assert.ok(!/last 10/.test(JSON.stringify(S(k).texts)), k) });
t('a push is counted and said', () => { const s = M.sample(games([10, 9, 11, 10]), 10, 'under'); assert.equal(s.pushes, 2); assert.match(s.texts.hit, /2 pushes/) });

/* supported edge */
t('a +34 raw edge from 7 games, a 308-day gap and an unconfirmed matchup is cut down, with the reasons', () => {
  const gs = games([15, 17, 14, 16, 12, 13, 15], NOW - 308 * 24 * H, 7);
  const p = prop({ edge: 34, games: gs }), v = { state: 'incomplete', event: null };
  const s = M.supported(p, { now: NOW, verdict: v });
  assert.equal(s.raw, 34); assert.ok(s.edge <= 12, s.edge); assert.equal(s.strength, 'limited');
  assert.ok(s.reasons.includes('Only 7 available games')); assert.ok(s.reasons.includes('308-day gap since the last appearance')); assert.ok(s.reasons.includes('Matchup not confirmed'));
});
t('a smaller edge on a full, recent log outranks it by supported edge, not by raw edge', () => {
  const big = { ...prop({ id: 'a', name: 'A', edge: 34, games: games([15, 17, 14, 16, 12, 13, 15], NOW - 308 * 24 * H) }) }, solid = { ...prop({ id: 'b', name: 'B', edge: 14 }) };
  for (const p of [big, solid]) { const s = M.supported(p, { now: NOW, verdict: { state: 'open', event: { verified: 'schedule', opp: 'PIT' } } }); p.sedge = s.edge; p.support = s.factor }
  assert.deepEqual([big, solid].sort(M.SORTS.edge).map(p => p.id), ['b', 'a']);
  assert.deepEqual([big, solid].sort(M.SORTS.raw).map(p => p.id), ['a', 'b']);
});
t('an old price lowers the supported edge', () => {
  const v = { state: 'open', event: { verified: 'schedule', opp: 'PIT' } };
  assert.ok(M.supported(prop({ at: NOW - 50 * MIN }), { now: NOW, verdict: v }).edge < M.supported(prop(), { now: NOW, verdict: v }).edge);
});

/* 8. Grouping by player */
const mk = (name, k, sedge, team = 'CLE', ev = '401') => ({ id: `${name}:${k}`, type: 'prop', sport: 'nfl', name, k, sedge, ours: .6, eventId: ev, team });
const board = [mk('Joe Milton', 'pc', 30), mk('Joe Milton', 'pyd', 28), mk('Joe Milton', 'pa', 27), mk('Joe Milton', 'int', 26), mk('Joe Milton', 'ptd', 25), mk('Joe Milton', 'ry', 24),
  mk('Jerry Jeudy', 'rey', 20), mk('Nick Chubb', 'ry', 18), mk('Jalen Hurts', 'pyd', 15, 'PHI', '402'), mk('A. J. Brown', 'rey', 12, 'PHI', '402'), mk('Saquon Barkley', 'ry', 10, 'PHI', '402'), mk('Brock Bowers', 'rey', 8, 'LV', '402')].sort(M.SORTS.edge);
t('best pick per player: one card for Joe Milton, his five other markets inside it', () => {
  const g = M.arrange(board, 'player'), jm = g.find(x => x.best.name === 'Joe Milton');
  assert.equal(g.filter(x => x.best.name === 'Joe Milton').length, 1); assert.equal(jm.best.k, 'pc'); assert.equal(jm.more.length, 5);
  assert.equal(g.length, 7);
});
t('best pick per game: one card per game', () => { const g = M.arrange(board, 'game'); assert.equal(g.length, 2); assert.deepEqual(g.map(x => x.best.name), ['Joe Milton', 'Jalen Hurts']); assert.equal(g[0].more.length, 7) });
t('every market: no player more than twice in the first ten, and nothing is dropped', () => {
  const big = [...board, mk('Kareem Hunt', 'ry', 7), mk('David Njoku', 'rey', 6), mk('DeVonta Smith', 'rey', 5, 'PHI', '402'), mk('Jakobi Meyers', 'rey', 4, 'LV', '402')].sort(M.SORTS.edge);
  const g = M.arrange(big, 'all'), top = g.slice(0, 10).map(x => x.best.name);
  assert.equal(top.filter(x => x === 'Joe Milton').length, 2); assert.equal(g.length, big.length);
  assert.deepEqual(g.slice(10).map(x => x.best.name).slice(0, 4), ['Joe Milton', 'Joe Milton', 'Joe Milton', 'Joe Milton']);
});
t('match forecasts group on their own', () => { const g = M.arrange([{ id: 'match:1', type: 'match', m: { key: '1' }, sedge: 5, ours: .6 }, ...board], 'player'); assert.ok(g.some(x => x.key === 'match:1')) });

console.log(`\n${n} tests passed`);
