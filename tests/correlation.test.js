// Correlation warnings on a slip or parlay (parlaycore correlation and slipChance). Required test 9: strongly
// correlated parlay selections get a warning and no misleading single number. Run: node tests/correlation.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const mem = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v) }, removeItem: k => { delete mem[k] } };
globalThis.document = { addEventListener() {}, dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail } };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'parlaycore.js'), 'utf8'));
const C = window.flParlay;

const T0 = Date.now() + 3 * 36e5;
const prop = (player, team, opp, k, side, line, ours = .58, lg = 'nfl') => ({ id: `prop:${lg}:${player}:${k}:${line}:${side}`, type: 'prop', lg, sport: lg, player, team, opp, k, label: k, line, side, start: T0, gameKey: `${lg}:${[team, opp].sort().join('|')}`, ours0: ours });
const milton = [prop('Joe Milton', 'DAL', 'LV', 'pcmp', 'under', 18.5), prop('Joe Milton', 'DAL', 'LV', 'pyd', 'under', 205.5), prop('Joe Milton', 'DAL', 'LV', 'patt', 'under', 30.5)];
const get = l => l.ours0;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name) };

t('9: three unders on one quarterback are Strong, named as such, and get no single number', () => {
  const c = C.correlation(milton);
  assert.equal(c.label, 'Strong'); assert.ok(c.kinds.includes('qb')); assert.ok(c.kinds.includes('player')); assert.equal(c.modeled, false);
  assert.match(c.text, /cannot be calculated by simply multiplying them/); assert.match(c.text, /3 unders on Joe Milton’s passing/);
  const s = C.slipChance(milton, get);
  assert.equal(s.kind, 'limits'); assert.ok(s.lo <= s.p && s.p <= s.hi); assert.ok(s.hi <= .58 + 1e-9);   // never above the least likely pick
});
t('9: a quarterback and his receiver, both over, are Strong: statistics that depend on each other, same team', () => {
  const c = C.correlation([prop('Patrick Mahomes', 'KC', 'BUF', 'pyd', 'over', 274.5), prop('Travis Kelce', 'KC', 'BUF', 'reyd', 'over', 62.5)]);
  assert.equal(c.label, 'Strong'); assert.ok(c.kinds.includes('depend')); assert.ok(c.kinds.includes('team'));
});
t('9: one player’s points and points + rebounds + assists are Strong', () => {
  const c = C.correlation([prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, .6, 'nba'), prop('Jalen Brunson', 'NY', 'BOS', 'pra', 'over', 38.5, .6, 'nba')]);
  assert.equal(c.label, 'Strong'); assert.equal(C.slipChance([prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, .6, 'nba'), prop('Jalen Brunson', 'NY', 'BOS', 'pra', 'over', 38.5, .6, 'nba')], get).kind, 'limits');
});
t('opposing outcomes on one line are Conflicting, 0%', () => {
  const legs = [prop('Joe Milton', 'DAL', 'LV', 'pyd', 'over', 205.5), prop('Joe Milton', 'DAL', 'LV', 'pyd', 'under', 205.5)];
  const c = C.correlation(legs); assert.equal(c.label, 'Conflicting'); assert.ok(c.kinds.includes('opposed'));
  const s = C.slipChance(legs, get); assert.equal(s.kind, 'conflict'); assert.equal(s.p, 0);
});
t('one player, two stats that don’t overlap, is Moderate with an adjusted range', () => {
  const legs = [prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, .6, 'nba'), prop('Jalen Brunson', 'NY', 'BOS', 'reb', 'over', 3.5, .6, 'nba')];
  const c = C.correlation(legs); assert.equal(c.label, 'Moderate'); assert.ok(c.modeled); assert.match(c.text, /the same player/);
  const s = C.slipChance(legs, get); assert.equal(s.kind, 'adjusted'); assert.ok(s.lo <= s.hi);
});
t('teammates in one game are Moderate: same team', () => {
  const c = C.correlation([prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, .6, 'nba'), prop('Karl-Anthony Towns', 'NY', 'BOS', 'reb', 'over', 10.5, .6, 'nba')]);
  assert.equal(c.label, 'Moderate'); assert.ok(c.kinds.includes('team'));
});
t('opponents in one game are Low: same game', () => {
  const c = C.correlation([prop('Jalen Brunson', 'NY', 'BOS', 'reb', 'over', 3.5, .6, 'nba'), prop('Jayson Tatum', 'BOS', 'NY', 'reb', 'over', 8.5, .6, 'nba')]);
  assert.equal(c.label, 'Low'); assert.ok(c.kinds.includes('game'));
});
t('different games: no warning, the chances multiply', () => {
  const legs = [prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, .6, 'nba'), prop('Joe Milton', 'DAL', 'LV', 'pyd', 'under', 205.5, .5)];
  assert.equal(C.correlation(legs).label, null);
  const s = C.slipChance(legs, get); assert.equal(s.kind, 'independent'); assert.ok(Math.abs(s.p - .3) < 1e-9);
});

// Parlays additions (item 18): invalid legs, market expiration, a player ruled out, and why the chance changed
t('a started pick, a clashing pick and a ruled-out player each say why they can’t go in; a game starting soon warns', () => {
  const now = Date.now(), a = prop('Joe Milton', 'DAL', 'LV', 'pyd', 'over', 205.5), b = { ...a, id: 'u', side: 'under' };
  const started = { ...prop('Jalen Brunson', 'NY', 'BOS', 'pts', 'over', 25.5, .6, 'nba'), start: now - 60000 };
  const soon = { ...prop('Jayson Tatum', 'BOS', 'NY', 'reb', 'over', 8.5, .6, 'nba'), start: now + 12 * 60000 };
  const hurt = prop('CeeDee Lamb', 'DAL', 'LV', 'reyd', 'over', 70.5);
  const m = C.legIssues([a, b, started, soon, hurt], now, l => l.player === 'CeeDee Lamb' ? { status: 'Out', what: 'Ankle' } : null);
  assert.deepStrictEqual(m.get(a.id), []);
  assert.equal(m.get('u')[0].kind, 'conflict'); assert.ok(m.get('u')[0].blocks);
  assert.equal(m.get(started.id)[0].kind, 'started'); assert.match(m.get(started.id)[0].why, /market is closed/);
  assert.equal(m.get(soon.id)[0].kind, 'soon'); assert.equal(m.get(soon.id)[0].blocks, false); assert.match(m.get(soon.id)[0].why, /Starts in 12 min/);
  assert.equal(m.get(hurt.id)[0].kind, 'out'); assert.match(m.get(hurt.id)[0].why, /listed Out \(Ankle\)/);
});
t('the combined chance explains itself when it changes', () => {
  const before = { p: .3, legs: [{ id: 'a', name: 'Milton under', v: .6 }, { id: 'b', name: 'Lamb over', v: .5 }] };
  assert.equal(C.explainChange(before, { p: .3, legs: before.legs }), '');
  assert.equal(C.explainChange(before, { p: .6, legs: [{ id: 'a', name: 'Milton under', v: .6 }, { id: 'b', name: 'Lamb over', v: 1, why: 'was ruled out, so it will be void and drops out' }] }),
    'Up from 30% to 60%: Lamb over was ruled out, so it will be void and drops out.');
  assert.equal(C.explainChange(before, { p: .27, legs: [{ id: 'a', name: 'Milton under', v: .54 }, { id: 'b', name: 'Lamb over', v: .5 }] }), 'Down from 30% to 27%: Milton under went from 60% to 54%.');
  assert.match(C.explainChange(before, { p: .6, legs: [before.legs[0]] }), /Lamb over was taken out/);
});
console.log(`${n} passed`);
