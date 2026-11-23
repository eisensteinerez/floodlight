// How parlay picks relate, the adjusted range and what blocks a lock-in (parlaycore.js). Run: node tests/parlay_relate.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const mem = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v) }, removeItem: k => { delete mem[k] } };
globalThis.document = { addEventListener() {}, dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail } };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'parlaycore.js'), 'utf8'));
const C = window.flParlay;

const T0 = Date.now() + 3 * 36e5;
// the shapes fromPick and fromGame make
const prop = (player, team, opp, k, side, line, lg = 'nfl', label = k) => ({ id: `prop:${lg}:${player}:${k}:${line}:${side}`, type: 'prop', lg, sport: lg, player, team, opp, k, label, line, side, start: T0, gameKey: `${lg}:${[team, opp].sort().join('|')}`, text: `${player} ${side} ${line}`, short: `${player} ${side}`, rAt: Date.now(), ours0: .55 });
const g = { lg: 'nfl', eid: '401', home: 'Kansas City Chiefs', away: 'Buffalo Bills', homeAbbr: 'KC', awayAbbr: 'BUF', start: T0, gameKey: 'nfl:401', game: 'Bills at Chiefs', rAt: Date.now() };
const win = side => ({ ...g, id: `win:nfl:401:${side}`, type: 'win', side, team: side === 'home' ? 'Chiefs' : 'Bills', text: `${side} to win`, ours0: side === 'home' ? .6 : .4 });
const spread = (side, line) => ({ ...g, id: `spread:nfl:401:${side}:${line}`, type: 'spread', side, line, team: side === 'home' ? 'Chiefs' : 'Bills', text: `${side} ${line}`, ours0: .5 });
const total = (side, line) => ({ ...g, id: `total:nfl:401:${side}:${line}`, type: 'total', side, line, text: `${side} ${line}`, ours0: .5 });
const draw = () => ({ ...g, lg: 'soccer', id: 'draw:soccer:9', gameKey: 'soccer:9', type: 'draw', side: 'home', text: 'draw', ours0: .27 });
const other = { lg: 'nfl', eid: '402', home: 'Dallas Cowboys', away: 'New York Giants', homeAbbr: 'DAL', awayAbbr: 'NYG', start: T0, gameKey: 'nfl:402', id: 'win:nfl:402:home', type: 'win', side: 'home', team: 'Cowboys', text: 'Cowboys to win', ours0: .6, rAt: Date.now() };

const mahomes = prop('Patrick Mahomes', 'KC', 'BUF', 'pyd', 'over', 274.5), kelce = prop('Travis Kelce', 'KC', 'BUF', 'reyd', 'over', 62.5), allen = prop('Josh Allen', 'BUF', 'KC', 'pyd', 'over', 250.5);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name) };
const lv = (a, b) => C.relate(a, b);

t('two games are independent', () => assert.deepStrictEqual([lv(win('home'), other).level, lv(win('home'), other).dir], ['independent', null]));
t('QB passing and his receiver are strongly related, together', () => { const r = lv(mahomes, kelce); assert.equal(r.level, 'strong'); assert.equal(r.dir, 'together'); assert.ok(r.why.length > 10) });
t('QB over and receiver under pull against', () => assert.equal(lv(mahomes, { ...kelce, side: 'under', id: 'x' }).dir, 'against'));
t('team to win and its player over: slight, together', () => { const r = lv(win('home'), mahomes); assert.equal(r.level, 'slight'); assert.equal(r.dir, 'together') });
t('team to win and the other team’s player over: slight, against', () => { const r = lv(win('home'), allen); assert.equal(r.level, 'slight'); assert.equal(r.dir, 'against') });
t('a prop and a game pick from one game are linked though their keys differ', () => assert.ok(C.sameGame(mahomes, win('home'))));
t('team win and the total: slight', () => assert.equal(lv(win('home'), total('over', 47.5)).level, 'slight'));
t('favourite spread and the over: slight, together', () => assert.equal(lv(spread('home', -3.5), total('over', 47.5)).dir, 'together'));
t('same player, points and rebounds: slight; points and PRA: strong', () => {
  const a = prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, 'nba'), b = prop('Jalen Brunson', 'NY', 'BOS', 'reb', 'over', 3.5, 'nba'), c = prop('Jalen Brunson', 'NY', 'BOS', 'pra', 'over', 38.5, 'nba');
  assert.equal(lv(a, b).level, 'slight'); assert.equal(lv(a, b).dir, 'together'); assert.equal(lv(a, c).level, 'strong') });
t('over and under one line conflicts', () => assert.equal(lv(mahomes, { ...mahomes, side: 'under', id: 'u' }).level, 'conflict'));
t('over a higher line than the under conflicts; a gap between is strong, against', () => {
  assert.equal(lv(mahomes, { ...mahomes, side: 'under', line: 260.5, id: 'u' }).level, 'conflict');
  const r = lv(mahomes, { ...mahomes, side: 'under', line: 299.5, id: 'u' }); assert.equal(r.level, 'strong'); assert.equal(r.dir, 'against') });
t('both teams to win conflicts', () => assert.equal(lv(win('home'), win('away')).level, 'conflict'));
t('a draw and a winner conflict', () => { const d = draw(); assert.equal(lv(d, { ...win('home'), lg: 'soccer', gameKey: d.gameKey }).level, 'conflict') });
t('two spreads in one game conflict', () => { assert.equal(lv(spread('home', -3.5), spread('away', 3.5)).level, 'conflict'); assert.equal(lv(spread('home', -3.5), spread('home', -6.5)).level, 'conflict') });
t('a favourite covering and the other team winning conflict', () => assert.equal(lv(spread('home', -3.5), win('away')).level, 'conflict'));
t('an underdog plus points and the favourite winning is strong, against', () => assert.equal(lv(spread('away', 3.5), win('home')).dir, 'against'));
t('same pick twice conflicts', () => assert.equal(lv(kelce, { ...kelce }).level, 'conflict'));
t('total over and under at the same line conflict', () => assert.equal(lv(total('over', 47.5), total('under', 47.5)).level, 'conflict'));
t('goalie saves and the other team’s shots are strong, together', () => {
  const sv = prop('Igor Shesterkin', 'NYR', 'BOS', 'sv', 'over', 27.5, 'nhl'), sog = prop('David Pastrnak', 'BOS', 'NYR', 'sog', 'over', 3.5, 'nhl');
  assert.deepStrictEqual([lv(sv, sog).level, lv(sv, sog).dir], ['strong', 'together']) });

t('estimate: different games give one number', () => { const e = C.estimate([win('home'), other], l => l.ours0); assert.equal(e.linked, false); assert.ok(Math.abs(e.p - .36) < 1e-9); assert.equal(e.lo, e.hi) });
t('estimate: a together pair pushes the top of the range up, inside the hard limits', () => {
  const e = C.estimate([mahomes, kelce], l => l.ours0); assert.ok(e.linked); assert.ok(e.hi > e.p); assert.ok(e.lo >= e.p - 1e-9); assert.ok(e.hi <= Math.min(.55, .55) + 1e-9); assert.ok(e.lo >= Math.max(0, .55 + .55 - 1) - 1e-9) });
t('estimate: an against pair pulls the bottom down', () => { const e = C.estimate([win('home'), allen], l => l.ours0); assert.ok(e.lo < e.p); assert.ok(e.hi <= e.p + 1e-9) });
t('estimate: a conflict gives 0', () => { const e = C.estimate([win('home'), win('away')], l => l.ours0); assert.equal(e.conflict, true); assert.equal(e.hi, 0) });
t('linkKeys groups a game’s picks', () => { const k = C.linkKeys([mahomes, other, win('home')]); assert.equal(k[0], k[2]); assert.notEqual(k[0], k[1]) });

t('blockers: conflicts, started games and stale prices', () => {
  const now = Date.now();
  assert.deepStrictEqual(C.blockers([mahomes, kelce], now), []);
  const b = C.blockers([win('home'), win('away')], now); assert.equal(b.length, 1); assert.equal(b[0].kind, 'conflict');
  assert.equal(C.blockers([{ ...kelce, start: now - 60000 }], now)[0].kind, 'started');
  const s = C.blockers([{ ...kelce, rAt: now - 31 * 60000 }], now); assert.equal(s[0].kind, 'stale'); assert.match(s[0].why, /30 minutes/);
  assert.equal(C.blockers([{ ...kelce, rAt: undefined, mAt: undefined }], now)[0].kind, 'stale');   // no read time at all: refresh first
});
t('fromGame marks a moved line as edited and keeps the posted one', () => {
  const G = { lg: 'nfl', eid: '7', date: new Date(T0), home: { name: 'Chiefs', full: 'Kansas City Chiefs', abbr: 'KC' }, away: { name: 'Bills', full: 'Buffalo Bills', abbr: 'BUF' }, odds: { total: 47.5, spread: -3.5, fair: { home: .6, away: .4 } }, readAt: Date.now() };
  const a = C.fromGame(G, 'total', 'over', 47.5), b = C.fromGame(G, 'total', 'over', 49), c = C.fromGame(G, 'spread', 'away', 3.5);
  assert.equal(a.edited, undefined); assert.equal(a.posted, 47.5); assert.equal(b.edited, true); assert.equal(b.posted, 47.5); assert.equal(c.posted, 3.5); assert.equal(c.edited, undefined); assert.ok(a.rAt) });
console.log(`${n} passed`);
