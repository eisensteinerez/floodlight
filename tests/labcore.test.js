// The Lab's shared numbers (labcore.js): edge breakdown, evidence grade, splits, Prop Explorer filters and sorts,
// Prediction Card analytics and card history. Run: node tests/labcore.test.js
const path = require('path'), assert = require('assert');
const L = require(path.join(__dirname, '..', 'labcore.js'));
const M = require(path.join(__dirname, '..', 'market.js'));

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name) };
const H = 36e5, MIN = 6e4, DAY = 864e5;
const NOW = Date.parse('2026-11-23T17:00:00Z');
const games = (vals, o = {}) => vals.map((v, i) => ({ v, min: o.min ?? 30, home: i % 2 === 0, opp: i % 3 === 0 ? 'Celtics' : 'Knicks', oppAbbr: i % 3 === 0 ? 'BOS' : 'NYK', date: NOW - (i + 1) * 2 * DAY }));
const mk = (o = {}) => ({ id: 'prop:nba:A:pts:20.5', type: 'prop', sport: 'nba', name: 'Alpha Player', team: 'LAL', opp: 'BOS', k: 'pts', label: 'Points', line: 20.5, side: 'over',
  ours: .7, market: .5, edge: 20, at: NOW - 2 * MIN, start: NOW + 3 * H, books: ['prizepicks', 'sleeper'], offers: [{ book: 'prizepicks', line: 20.5 }, { book: 'sleeper', line: 20.5, pOver: .5 }],
  games: games([25, 22, 18, 24, 26, 21, 19, 23, 27, 22, 20, 24, 25, 23, 22, 21]), v: { state: 'open', event: { verified: 'schedule' } }, ...o });

/* ---------- breakdown ---------- */
t('Erez’s example: +31 raw, −1 sample, −2 availability, 0 data quality = +28, and the rows add up', () => {
  const b = L.breakdown(31, [[.97, 'Only 12 available games'], [.935, 'Questionable on the injury report']]);
  assert.equal(b.raw, 31); assert.deepEqual(b.rows.map(r => [r.key, r.pts]), [['sample', -1], ['avail', -2], ['data', 0]]); assert.equal(b.edge, 28);
  assert.equal(b.raw + b.rows.reduce((a, r) => a + r.pts, 0), b.edge);
});
t('the breakdown ends on exactly the supported edge market.js puts on the card, for every pick', () => {
  for (const o of [{}, { games: games([25, 22, 18]) }, { offers: [{ book: 'prizepicks', line: 20.5 }], books: ['prizepicks'] }, { at: NOW - 50 * MIN, teamNote: 'x' }, { edge: -14 }, { edge: 3, games: games([30, 31]) }]) {
    const p = mk(o), real = M.supported(p, { now: NOW, verdict: p.v });
    // market.js gives cuts as [factor, reason] pairs once the verified feed lands; until then the whole factor rides on the first reason
    const s = M.supported(p, { now: NOW, verdict: p.v, moved: null });
    const b = L.breakdown(p.edge, s.cuts || s.reasons.map((why, i, all) => [i === 0 ? s.factor : 1, why]));
    assert.equal(b.edge, real.edge, JSON.stringify(o)); assert.equal(b.raw + b.rows.reduce((a, r) => a + r.pts, 0), b.edge);
  }
});
t('a moved line gets its own row; an unmoved one gets none', () => {
  assert.ok(L.breakdown(20, [[.9, 'Line moved from 20.5 to 22.5']]).rows.some(r => r.key === 'move' && r.pts === -2));
  assert.ok(!L.breakdown(20, [[.9, 'Only one provider posts this line']]).rows.some(r => r.key === 'move'));
});
t('reasons are sorted into the right kind', () => {
  assert.equal(L.kindOf('Only 4 available games'), 'sample'); assert.equal(L.kindOf('43-day gap since the last appearance'), 'sample');
  assert.equal(L.kindOf('Doubtful on the injury report'), 'avail'); assert.equal(L.kindOf('Role changed recently'), 'avail'); assert.equal(L.kindOf('Minutes vary from game to game'), 'avail');
  assert.equal(L.kindOf('Opponent unknown'), 'data'); assert.equal(L.kindOf('Price last verified 41 min ago'), 'data'); assert.equal(L.kindOf('Matchup confirmed by the provider only'), 'data');
  assert.equal(L.kindOf('Line moved from 18.5 to 20.5'), 'move');
});
t('no raw edge, no breakdown; signs read as on the card', () => {
  assert.equal(L.breakdown(null, []), null); assert.equal(L.signed(3), '+3'); assert.equal(L.signed(-2), '−2'); assert.equal(L.signed(0), '0');
});

/* ---------- evidence grade ---------- */
t('a long, consistent, schedule-checked, two-provider, fresh market grades A', () => assert.equal(L.grade(mk(), NOW).grade, 'A'));
t('the grade never reads the edge or the chance', () => {
  const a = L.grade(mk({ edge: 2, ours: .52 }), NOW), b = L.grade(mk({ edge: 40, ours: .95 }), NOW);
  assert.equal(a.grade, b.grade); assert.equal(a.score, b.score);
});
t('three games, one provider, a provider-only matchup and an old price grade D', () => {
  const g = L.grade(mk({ games: games([25, 22, 18]), offers: [{ book: 'prizepicks', line: 20.5 }], books: ['prizepicks'], at: NOW - 70 * MIN, v: { state: 'open', event: { verified: 'provider' } } }), NOW);
  assert.equal(g.grade, 'D'); assert.ok(g.points.some(x => !x.ok && /One provider/.test(x.text)));
});
t('a questionable player drops a grade, a team mismatch drops two', () => {
  assert.equal(L.grade(mk({ av: { lv: 'questionable' } }), NOW).grade, 'B');
  assert.equal(L.grade(mk({ teamNote: 'The books’ team does not match' }), NOW).grade, 'B');
  assert.equal(L.grade(mk({ teamNote: 'x', av: { lv: 'doubtful' } }), NOW).grade, 'C');
});

/* ---------- splits ---------- */
t('last 5, 10, 20 and the season, with pushes kept apart, and an honest summary', () => {
  const s = L.splits(mk().games, { line: 22, side: 'over', opp: 'Celtics', oppAbbr: 'BOS' });
  assert.deepEqual(s.windows.map(w => [w.key, w.n]), [['l5', 5], ['l10', 10], ['l20', 16], ['season', 16]]);
  const l10 = s.windows[1]; assert.equal(l10.hit + l10.miss + l10.push, 10); assert.equal(l10.push, 2);
  assert.match(s.summary, /^Over 22 in \d of 8 of the last 10 games \(2 on the line\)\. Average [\d.]+, median [\d.]+ over the last 16\.$/);
});
t('home and away, against tonight’s opponent, average and median', () => {
  const s = L.splits(games([10, 20, 30, 40]), { line: 25, side: 'under', opp: 'Celtics' });
  assert.equal(s.home.n, 2); assert.equal(s.away.n, 2); assert.equal(s.vsOpp.n, 2); assert.equal(s.avg, 25); assert.equal(s.med, 25);
  assert.equal(s.home.hit, 1);   // 10 and 30 at home: under 25 once
});
t('the season stops at the off-season break', () => {
  const gs = games([20, 21, 22, 23]); gs[2].date = gs[1].date - 120 * DAY; gs[3].date = gs[2].date - 2 * DAY;
  assert.equal(L.splits(gs, { line: 20 }).windows[3].n, 2);
});
t('the minutes trend and earlier lines near this one', () => {
  const gs = games([20, 20, 20, 20, 20, 20, 20, 20, 20, 20]); gs.forEach((g, i) => g.min = i < 5 ? 36 : 28);
  const s = L.splits(gs, { line: 20.5, prior: [{ line: 20.5, side: 'over', result: 'won' }, { line: 21.5, side: 'over', result: 'lost' }, { line: 30.5, result: 'won' }, { line: 20.5, result: null }] });
  assert.equal(s.mins.l5, 36); assert.ok(s.mins.trend > .1); assert.equal(s.similar.length, 2); assert.deepEqual(s.similarRec, { n: 2, won: 1 });
});
t('no games: says so', () => assert.equal(L.splits([], { line: 10 }).summary, 'No games on record.'));

/* ---------- Prop Explorer ---------- */
const board = [
  mk({ id: 'a', l5: .8, l10: .7, l20: .6, sedge: 12, start: NOW + 1 * H, firstSeen: NOW - 5 * H, openLine: 21.5 }),
  mk({ id: 'b', name: 'Beta', team: 'BOS', opp: 'LAL', side: 'under', k: 'reb', label: 'Rebounds', line: 8.5, l5: .4, l10: .5, l20: .55, sedge: 4, start: NOW + 26 * H, firstSeen: NOW - 1 * H, openLine: 8.5, books: ['sleeper'], av: { lv: 'questionable' } }),
  mk({ id: 'c', name: 'Gamma', sport: 'nfl', k: 'pyds', label: 'Passing yards', line: 250.5, l5: 1, l10: .9, l20: .85, sedge: 20, start: NOW + 50 * H, firstSeen: NOW - 2 * H, openLine: 240.5, games: games([260, 270, 255]) }),
];
t('the default filters keep everything', () => assert.equal(L.filter(board, L.defaults(), { now: NOW }).length, 3));
t('sport, stat, side, provider and player search', () => {
  const f = o => L.filter(board, { ...L.defaults(), ...o }, { now: NOW }).map(p => p.id).join();
  assert.equal(f({ sport: 'nfl' }), 'c'); assert.equal(f({ stat: 'reb' }), 'b'); assert.equal(f({ side: 'under' }), 'b'); assert.equal(f({ provider: 'prizepicks' }), 'a,c'); assert.equal(f({ q: 'gam' }), 'c');
});
t('hit-rate floors, supported edge, evidence, games on record, injury status', () => {
  const f = o => L.filter(board, { ...L.defaults(), ...o }, { now: NOW }).map(p => p.id).join();
  assert.equal(f({ l5: .8 }), 'a,c'); assert.equal(f({ l20: .6 }), 'a,c'); assert.equal(f({ edge: 10 }), 'a,c'); assert.equal(f({ games: 10 }), 'a,b');
  assert.equal(f({ injury: 'listed' }), 'b'); assert.equal(f({ injury: 'clear' }), 'a,c'); assert.equal(f({ grade: 'A' }), 'a');
});
t('starting time uses the viewer’s day', () => {
  const f = w => L.filter(board, { ...L.defaults(), when: w }, { now: NOW, tz: 'America/New_York', dayDiff: M.dayDiff }).map(p => p.id).join();
  assert.equal(f('soon'), 'a'); assert.equal(f('today'), 'a'); assert.equal(f('tomorrow'), 'b'); assert.equal(f('later'), 'c');
});
t('line movement: moved, easier for the pick, harder', () => {
  const f = m => L.filter(board, { ...L.defaults(), moved: m }, { now: NOW }).map(p => p.id).join();
  assert.equal(f('moved'), 'a,c'); assert.equal(f('easier'), 'a'); assert.equal(f('harder'), 'c');
  assert.deepEqual(L.movement(board[0]), { from: 21.5, to: 20.5, d: -1, easier: 1 });
});
t('every sort', () => {
  const s = (by, o) => L.sort(board, by, o).map(p => p.id).join();
  assert.equal(s('edge'), 'c,a,b'); assert.equal(s('hit'), 'c,a,b'); assert.equal(s('move'), 'c,a,b'); assert.equal(s('soon'), 'a,b,c'); assert.equal(s('new'), 'b,c,a');
  assert.equal(s('evidence'), 'a,b,c');   // A, then B (questionable, one provider), then C (three games)
  const pop = { followed: new Map([['b', 3], ['a', 1]]), researched: new Map([['a', 9]]) };
  assert.equal(s('followed', { pop }), 'b,a,c'); assert.equal(s('researched', { pop }), 'a,c,b');
});

/* ---------- a card read as a whole ---------- */
t('average evidence, the weakest pick, what expires first, moved lines and ruled-out players', () => {
  const legs = [{ id: 1, name: 'A', grade: 'A', ours: .7, start: NOW + 2 * H, line: 20.5, line0: 20.5, side: 'over' }, { id: 2, name: 'B', grade: 'C', ours: .6, start: NOW + 30 * MIN, line: 9.5, line0: 8.5, side: 'over' },
    { id: 3, name: 'C', grade: 'B', ours: .65, start: NOW + 5 * H, out: true }];
  const c = L.card(legs, NOW);
  assert.equal(c.avgGrade, 'B'); assert.equal(c.weakest.id, 2); assert.equal(c.expires.leg.id, 2); assert.equal(L.countdown(c.expires.in), '30 min');
  assert.equal(c.moved.length, 1); assert.equal(c.moved[0].worse, true); assert.equal(c.outs.length, 1);
  assert.equal(L.countdown(2 * H + 14 * MIN), '2 h 14 min'); assert.equal(L.countdown(-1), 'started');
});
t('card history: hit rate, best card, streak, average size, by sport and by size', () => {
  const c = (status, n, at, lg = 'nba', ours0 = .3) => ({ id: at, status, at, settled: at, ours0, legs: Array.from({ length: n }, () => ({ lg })) });
  const h = L.history([c('won', 2, 9), c('won', 3, 8, 'nfl', .1), c('lost', 2, 7), c('push', 2, 6), c('open', 4, 10)]);
  assert.equal(h.active, 1); assert.equal(h.done, 4); assert.equal(h.won, 2); assert.equal(h.lost, 1); assert.equal(h.push, 1); assert.equal(Math.round(h.rate * 100), 67);
  assert.equal(h.best.id, 8); assert.deepEqual(h.streak, { kind: 'won', n: 2 }); assert.equal(h.avgSize, 2.6);
  assert.deepEqual(h.bySport.find(x => x[0] === 'nba')[1], { won: 1, lost: 1 }); assert.deepEqual(h.bySize.find(x => x[0] === '2 picks')[1], { won: 1, lost: 1 });
});

console.log(`\n${n} tests passed`);
