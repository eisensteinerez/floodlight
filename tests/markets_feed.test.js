// The verified market feed in the browser (markets.js, edge.js, market.js gate(), lab.html's Prop Explorer):
// the client half of Erez's acceptance tests. The server half is tests/test_markets.py.
// Run: node tests/markets_feed.test.js
const path = require('path'), fs = require('fs'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const H = 36e5, MIN = 6e4;
const NOW0 = Date.parse('2026-11-23T17:00:00Z');   // Monday 12:00 PM in New York
let clock = NOW0;
const realNow = Date.now; Date.now = () => clock;

// a tiny browser: window, document events, localStorage and a fetch that answers the board
const listeners = {}, events = [];
global.window = global;
global.document = { hidden: false, documentElement: {}, addEventListener: (k, f) => (listeners[k] ||= []).push(f), dispatchEvent: e => { events.push(e); (listeners[e.type] || []).forEach(f => f(e)) } };
global.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o?.detail } };
const disk = new Map(); global.localStorage = { getItem: k => disk.has(k) ? disk.get(k) : null, setItem: (k, v) => disk.set(k, String(v)), removeItem: k => disk.delete(k) };
let BOARD = {};
global.fetch = async url => { const sp = new URL('http://x' + url).searchParams.get('sport'); const d = BOARD[sp] || { rows: [] }; return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(d)) } };
for (const f of ['meter.js', 'market.js', 'labcore.js', 'edge.js', 'markets.js', 'marketfeed.js']) require(path.join(ROOT, f));
const MK = window.flMarket, E = window.flEdge, F = window.flMarkets, K = window.flLabCore, FD = window.flFeed;

// lab.html's own feed functions (Prop Explorer), run here exactly as written there
const lab = fs.readFileSync(path.join(ROOT, 'lab.html'), 'utf8');
const grab = name => { const i = lab.indexOf(name); assert(i >= 0, name); let j = lab.indexOf('\n', i); if (/^(async )?function/.test(name)) { let d = 0; for (j = lab.indexOf('{', i); j < lab.length; j++) { if (lab[j] === '{') d++; else if (lab[j] === '}' && !--d) break } j++ } return lab.slice(i, j) };
// the Lab page's own list is the feed: these are its functions, run exactly as written there (no window.parent here,
// so FEED() is this window's flMarkets, as when the Lab is opened on its own)
const LAB = new Function('S', `${grab('function FEED()')}\n${grab('function feedDoc()')}\n${grab('const MK = () =>')}\n${grab('const msOf = ')}\n${grab('function asRow(')}\n${grab('function liveRows(')}\n${grab('function boardOf(')}\n${grab('async function boardFor(')}\nreturn { liveRows, boardFor };`)({ board: {} });
const labRows = async sp => LAB.liveRows(await LAB.boardFor(sp, true));

const games = (vals, from = NOW0 - 2 * 24 * H, step = 7) => vals.map((v, i) => [v, i % 2, 60, 'DAL', 'DAL', new Date(from - i * step * 24 * H).toISOString()]);
// a row as /api/lab/board sends it after the verified market service (markets.py) checked it
const row = (player, o = {}) => ({ player, team: 'PHI', teamName: 'Eagles', opp: 'NYG', oppName: 'Giants', k: 'py', label: 'Pass yards', line: 225.5, side: 'over', l5: .8, l10: .8, l20: .7, avg: 240, n: 10,
  books: ['prizepicks'], offers: [{ book: 'prizepicks', line: 225.5, kind: 'standard', mid: 'prizepicks:' + player }], games: games([250, 230, 260, 240, 210, 270, 235, 228, 241, 262, 218, 233]),
  mid: 'mk_' + player.replace(/\W/g, ''), eventId: '401', teamId: '21', oppId: '19', status: 'open', verifiedAt: Math.round((NOW0 - 2 * MIN) / 1000), firstSeen: Math.round((NOW0 - H) / 1000),
  start: new Date(NOW0 + 3 * H).toISOString(), matchup: 'schedule', hot: true, ...o });
const board = rows => ({ sport: 'nfl', rows, removed: [], verified: true, at: Math.round(NOW0 / 1000) - 120, checked: 40 });
const ids = xs => xs.map(p => p.mid).sort();
let n = 0; const t = async (name, fn) => { clock = NOW0; await fn(); n++; console.log('ok', name) };

(async () => {
  await t('every page reads the same open markets: Predictions, Prop Explorer and the feed agree', async () => {
    BOARD.nfl = board([row('Jalen Hurts'), row('Saquon Barkley', { k: 'ry', label: 'Rush yards', line: 95.5, hot: false }), row('A.J. Brown', { k: 'rcy', label: 'Receiving yards', line: 70.5 })]);
    const r = await F.list({ sport: 'nfl', force: true });
    const explorer = (await labRows('nfl')).map(x => x.mid).sort();
    assert.deepEqual(K.filter(F.open('nfl'), K.defaults(), { now: clock }).map(p => p.mid).sort(), explorer);   // Prop Explorer with no filter
    assert.deepEqual(ids(r.markets), explorer);
    assert.deepEqual(ids(E.upcoming(E.have('nfl').picks)), explorer);   // Predictions, Home, Parlays and the Lab's lists read flEdge
    assert.deepEqual(ids(F.open('nfl')), explorer);
    for (const p of r.markets) assert.equal(MK.verify(p, { now: clock }).state, 'open');   // Predictions' own check agrees
  });

  await t('a prop disappears when its game starts', async () => {
    BOARD.nfl = board([row('Jalen Hurts'), row('Saquon Barkley', { start: new Date(NOW0 + 30 * MIN).toISOString() })]);
    await F.list({ sport: 'nfl', force: true });
    assert.equal(F.open('nfl').length, 2);
    const lb = await LAB.boardFor('nfl', true);   // the Lab page's board, read before the start
    clock = NOW0 + 31 * MIN; F.rebuild('start');
    assert.deepEqual(F.open('nfl').map(p => p.name), ['Jalen Hurts']);
    assert.equal(F.removed('nfl').find(x => x.name === 'Saquon Barkley').status, 'started');
    assert.equal(LAB.liveRows(lb, clock).length, 1);   // drawn again on the clock, the started game's line is gone without a new read
    const ev = events.filter(e => e.type === 'fl:markets').pop();
    assert.equal(ev.detail.removed[0].status, 'started');
  });

  await t('yesterday’s cached prop cannot become today’s', async () => {
    // the board kept in this browser from yesterday (edge.js keeps a reading for a few hours)
    const y = board([row('Joe Milton', { team: 'DAL', start: new Date(NOW0 - 20 * H).toISOString(), verifiedAt: Math.round((NOW0 - 22 * H) / 1000) })]);
    disk.set('fl.board.nba', JSON.stringify({ got: NOW0 - 2 * H, d: { ...y, sport: 'nba' } }));
    const kept = E.have('nba');
    assert.equal(kept.picks.length, 1);
    assert.equal(E.upcoming(kept.picks).length, 0);
    F.rebuild('load'); assert(!F.open('nba').some(p => p.name === 'Joe Milton'));
    // and a cached line with no start time is never shown as today's
    const nostart = row('Joe Milton', { start: null, eventId: '' });
    assert.equal(MK.gate({ ...nostart, start: null }, { now: clock }).status, 'missing_matchup');
  });

  await t('a player cannot appear against the wrong opponent (the server filed it; no page shows it)', async () => {
    BOARD.nfl = board([row('Jalen Hurts')]); BOARD.nfl.removed = [{ mid: 'mk_x', player: 'Joe Milton', k: 'py', label: 'Pass yards', line: 180.5, side: 'over', status: 'missing_matchup', reason: 'The provider lists DAL as the opponent; the schedule says Giants' }];
    await F.list({ sport: 'nfl', force: true });
    assert(!F.open('nfl').some(p => p.name === 'Joe Milton'));
    assert.equal(F.removed('nfl').find(x => x.mid === 'mk_x').status, 'missing_matchup');
  });

  await t('an unavailable provider cannot appear verified seconds ago', async () => {
    const old = Math.round((NOW0 - 95 * MIN) / 1000);
    BOARD.nfl = board([row('Jalen Hurts', { verifiedAt: old })]); BOARD.nfl.at = Math.round(NOW0 / 1000);   // the board was built just now
    await F.list({ sport: 'nfl', force: true });
    assert.equal(F.open('nfl').length, 0);
    assert.equal(F.removed('nfl')[0].status, 'awaiting_verification');
    // the price time a card shows is the provider's read, not the board's build time
    BOARD.nfl = board([row('Jalen Hurts', { verifiedAt: Math.round((NOW0 - 20 * MIN) / 1000) })]); BOARD.nfl.at = Math.round(NOW0 / 1000);
    await F.list({ sport: 'nfl', force: true });
    assert.equal(F.open('nfl')[0].at, NOW0 - 20 * MIN);
    assert.equal(F.open('nfl')[0].v.price, 'fresh');
    // and it leaves by itself once the 90 minutes pass
    clock = NOW0 + 71 * MIN; F.rebuild('stale');
    assert.equal(F.open('nfl').length, 0);
  });

  await t('a ruled-out player is removed as soon as the injury report says so', async () => {
    BOARD.nfl = board([row('Jalen Hurts'), row('A.J. Brown', { k: 'rcy', line: 70.5 })]);
    await F.list({ sport: 'nfl', force: true });
    assert.equal(F.open('nfl').length, 2);
    window.flInjuries = { ready: () => true, status: (sp, name) => name === 'A.J. Brown' ? { lv: 'out', status: 'Out' } : null };
    document.dispatchEvent(new CustomEvent('fl:injuries', { detail: { sport: 'nfl' } }));
    assert.deepEqual(F.open('nfl').map(p => p.name), ['Jalen Hurts']);
    assert.equal(F.removed('nfl').find(x => x.name === 'A.J. Brown').status, 'player_out');
    delete window.flInjuries;
  });

  await t('Home’s Hot right now agrees with Prop Explorer and the Lab, on one rule', async () => {
    const cold = games([80, 90, 100, 85, 70, 99, 60, 88, 92, 75, 81, 77]);   // 2 of 10 over 95.5
    BOARD.nfl = board([row('Jalen Hurts'), row('Saquon Barkley', { k: 'ry', label: 'Rush yards', line: 95.5, games: cold, hot: true }),   // the server's flag can't make it hot
      row('A.J. Brown', { k: 'rcy', line: 70.5, hot: false, games: games([80, 75, 90, 71, 88, 60, 95, 85, 72, 99]) }),   // nor can it make a hot line cold
      row('DeVonta Smith', { k: 'rec', line: 4.5, start: new Date(NOW0 - MIN).toISOString() })]);
    await F.list({ sport: 'nfl', force: true });
    const explorerHot = K.filter(F.open('nfl'), { ...K.defaults(), hot: true }, { now: clock }).map(p => p.name).sort();
    assert.deepEqual(explorerHot, ['A.J. Brown', 'Jalen Hurts']);
    assert.deepEqual(F.hot(10, { sport: 'nfl' }).map(p => p.name).sort(), explorerHot);
    assert.deepEqual(E.hot(E.all(), 10).map(p => p.name).sort(), explorerHot);   // the Lab's start screen
    assert.deepEqual(FD.hot(10).map(p => p.name).sort(), explorerHot);           // Home's Hot right now
    assert.deepEqual((await labRows('nfl')).filter(r => r.hot).map(r => r.player).sort(), explorerHot);   // the Lab page's Running hot
    // and the rule is the one written down: 8+ games, 70%+ of the last 10, 60%+ of the last 5, pushes left out
    const g = vs => games(vs).map(x => ({ v: x[0] }));
    assert.equal(MK.hotRead(g([1, 1, 1, 0, 0, 1, 1, 1, 1, 0]), .5, 'over').hot, true);    // 7 of 10, 3 of 5
    assert.equal(MK.hotRead(g([1, 1, 0, 0, 0, 1, 1, 1, 1, 1]), .5, 'over').hot, false);   // 7 of 10 but 2 of 5
    assert.equal(MK.hotRead(g([1, 1, 1, 1, 1, 1, 1]), .5, 'over').hot, false);             // only 7 games
    assert.equal(MK.hotRead(g([2, 3, 3, 3, 3, 3, 3, 3, 2, 1]), 2, 'over').hot, true);      // pushes left out: 4 of 4, 7 of 8
    assert.equal(MK.hotRead(g([2, 2, 2, 3, 3, 3, 3, 1, 1, 1]), 2, 'over').hot, false);     // 4 of 7 decided
  });

  await t('Best edge on Home is Predictions’ top pick', async () => {
    const priced = (p, o) => ({ book: 'prizepicks', line: o.line ?? 225.5, kind: 'standard', mid: 'prizepicks:' + p, pOver: o.pOver });
    BOARD.nfl = board([row('Jalen Hurts', { offers: [priced('Jalen Hurts', { pOver: .5 })] }), row('A.J. Brown', { k: 'rcy', line: 70.5, games: games([80, 75, 90, 71, 88, 60, 95, 85, 72, 99]), offers: [priced('A.J. Brown', { line: 70.5, pOver: .55 })] })]);
    await F.list({ sport: 'nfl', force: true });
    const pred = F.open('nfl').filter(p => p.sedge != null && p.sedge >= 0).sort(MK.SORTS.edge);   // Predictions' ranking
    assert(pred.length >= 1);
    assert.equal(FD.ranked()[0].mid, pred[0].mid);
  });

  await t('a postponed game leaves with its own status and message', async () => {
    BOARD.nfl = board([row('Jalen Hurts')]); BOARD.nfl.removed = [{ mid: 'mk_pp', player: 'Saquon Barkley', k: 'ry', label: 'Rush yards', line: 95.5, side: 'over', status: 'postponed', reason: 'The game was postponed' }];
    await F.list({ sport: 'nfl', force: true });
    const g = F.removed('nfl').find(x => x.mid === 'mk_pp');
    assert.equal(g.status, 'postponed'); assert.equal(MK.STATUS_LABEL.postponed, 'Postponed'); assert.equal(MK.removalMessage('postponed'), 'Event postponed');
    assert.equal(MK.gate({ status: 'postponed' }).status, 'postponed');
    assert.equal(MK.removalMessage('closed', 'The provider no longer offers this line'), 'Provider removed the line');
  });

  await t('a saved board, a share card and a parlay check the market again before use', async () => {
    BOARD.nfl = board([row('Jalen Hurts'), row('A.J. Brown', { k: 'rcy', line: 70.5 })]);
    await F.list({ sport: 'nfl', force: true });
    const saved = [{ sport: 'nfl', name: 'Jalen Hurts', k: 'py' }, { sport: 'nfl', name: 'A.J. Brown', k: 'rcy' }];
    assert.deepEqual((await F.recheck(saved)).map(x => x.open), [true, true]);
    // the provider drops A.J. Brown's line; the board is read again because it is over two minutes old
    BOARD.nfl = board([row('Jalen Hurts')]); clock = NOW0 + 3 * MIN;
    const st = await F.recheck(saved);
    assert.deepEqual(st.map(x => x.open), [true, false]);
    assert.equal(st[1].message, 'Market closed');
    // a parlay leg on that line is blocked with the reason, and the ruled-out check still comes first
    require(path.join(ROOT, 'parlaycore.js')); const C = window.flParlay;
    const leg = { id: 'l1', type: 'prop', sport: 'nfl', lg: 'nfl', player: 'A.J. Brown', k: 'rcy', start: NOW0 + 3 * H };
    const off = l => { const s2 = F.standing({ sport: l.sport, name: l.player, k: l.k }); return s2.open ? null : s2 };
    const iss = C.legIssues([leg], clock, () => null, off).get('l1');
    assert(iss.some(x => x.kind === 'removed' && x.blocks && /Taken off the board: Market closed/.test(x.why)));
  });

  await t('changing time zones does not move a market onto the wrong day', async () => {
    const late = NOW0 + 11.5 * H;   // 11:30 PM Monday in New York, Tuesday morning in Tel Aviv
    BOARD.nfl = board([row('Jalen Hurts', { start: new Date(late).toISOString() })]);
    await F.list({ sport: 'nfl', force: true });
    const p = F.open('nfl')[0];
    assert.equal(MK.when(late, clock, 'America/New_York'), 'Today 11:30 PM');
    assert.equal(MK.when(late, clock, 'Asia/Jerusalem'), 'Tomorrow 6:30 AM');
    // the market, its game and its open state are the same in every zone: only the words change
    for (const tz of ['America/New_York', 'Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Auckland']) {
      const v = MK.verify(p, { now: clock, tz });
      assert.equal(v.state, 'open'); assert.equal(v.event.id, '401'); assert.equal(+v.start, late);
    }
    // half an hour before the start the market is still the same game, now 'Today' in both zones; after midnight in
    // Tel Aviv it has not moved to another day's slate
    clock = NOW0 + 11 * H; BOARD.nfl = board([row('Jalen Hurts', { start: new Date(late).toISOString(), verifiedAt: Math.round((clock - MIN) / 1000) })]);
    await F.list({ sport: 'nfl', force: true }); F.rebuild('midnight');
    assert.equal(F.open('nfl').length, 1);
    assert.equal(MK.when(late, clock, 'America/New_York'), 'Today 11:30 PM');
    assert.equal(MK.when(late, clock, 'Asia/Jerusalem'), 'Today 6:30 AM');
    clock = late + MIN; F.rebuild('start');
    assert.equal(F.open('nfl').length, 0);
  });

  await t('the feed tells pages what changed, with the reason', async () => {
    BOARD.nfl = board([row('Jalen Hurts')]);
    await F.list({ sport: 'nfl', force: true });
    BOARD.nfl = board([row('Jalen Hurts', { line: 230.5, offers: [{ book: 'prizepicks', line: 230.5, mid: 'prizepicks:Jalen Hurts' }], lineFrom: 225.5 })]);
    await F.list({ sport: 'nfl', force: true });
    const ev = events.filter(e => e.type === 'fl:markets' && e.detail.changed.length).pop();
    assert.deepEqual(ev.detail.changed, ['mk_JalenHurts']);
    const p = F.get('mk_JalenHurts');
    assert.equal(p.line, 230.5); assert.equal(p.lineFrom, 225.5);
    assert(Array.isArray(p.cuts) && p.cuts.every(c => typeof c[0] === 'number' && typeof c[1] === 'string'));
  });

  await t('no page reads the pick’em apps’ lines around the feed', async () => {
    // every page the site serves: none reads the pick'em apps' lines (or the DFS endpoint) itself
    const pages = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f) && !['sw.js'].includes(f));
    assert(pages.includes('research.js') && pages.includes('lab.html'));
    for (const f of pages) assert(!/\/api\/dfs\//.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
    // and the Lab page has no board of its own: it reads the feed
    assert(!/api\('board\?/.test(lab) && /window\.parent\.flMarkets/.test(lab), 'lab.html reads the shared feed');
  });

  Date.now = realNow;
  console.log(`${n} tests passed`);
  process.exit(0);   // the feed's own timers (next start, midnight) would keep node waiting
})().catch(e => { console.error(e); process.exit(1) });
