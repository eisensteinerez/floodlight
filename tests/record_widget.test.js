// "How we have done" on Predictions (history.js widget): the same record service as Pick history, the zero state, and
// future picks never counted as graded. Required test 12 (results-widget empty state). Run: node tests/record_widget.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.window = globalThis;
const calls = [];
let answers = {};
globalThis.fetch = url => { calls.push(url); const a = answers[url.split('?')[0]]; return a instanceof Error ? Promise.reject(a) : Promise.resolve({ ok: true, json: () => Promise.resolve(a || {}) }) };
globalThis.document = { addEventListener() {}, dispatchEvent() {}, getElementById: () => null, activeElement: null };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail } };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'history.js'), 'utf8'));
const H = window.flHistory, Hs = H.state;
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const now = Date.now() / 1000;
const prop = (o = {}) => ({ key: 'nba:x:' + Math.random(), sport: 'nba', player: 'Jalen Brunson', team: 'NY', opp: 'BOS', k: 'pts', label: 'Points', line: 26.5, side: 'over',
  start: now - 86400, ours: 0.6, market: 0.52, edge: 8, books: ['prizepicks'], state: 'won', result: 'won', actual: '31', ...o });
const reset = () => Object.assign(Hs, { rows: null, props: null, upcoming: [], status: null, at: 0, err: '', propErr: '', statusErr: '', loading: false });
let n = 0; const t = async (name, fn) => { reset(); await fn(); n++; console.log('ok', name) };

(async () => {
  await t('12: nothing graded yet is a zero state, not a loading failure, and counts the locked picks', () => {
    Hs.rows = []; Hs.props = Array.from({ length: 39 }, () => prop({ start: now + 7200, state: 'published', result: null, actual: null }));
    const s = text(H.widget());
    assert.match(s, /No graded picks yet/); assert.match(s, /39 predictions are currently locked\./); assert.match(s, /Results will appear after their games finish\./);
    assert.doesNotMatch(s, /did not load|couldn’t reach/i);
  });
  await t('12: one locked pick reads in the singular', () => {
    Hs.rows = []; Hs.props = [prop({ start: now + 60, state: 'locked', result: null })];
    assert.match(text(H.widget()), /1 prediction is currently locked\. Results will appear after its game finishes\./);
  });
  await t('12: no picks at all still is not an error', () => {
    Hs.rows = []; Hs.props = [];
    const s = text(H.widget()); assert.match(s, /No graded picks yet/); assert.doesNotMatch(s, /did not load/i);
  });
  await t('12: when only the grader status answered, its counts give the zero state', () => {
    Hs.err = 'It took too long to answer.'; Hs.status = { matches: { published: 2 }, props: { locked: 3, pending: 4, won: 0 } };
    const s = text(H.widget()); assert.match(s, /9 predictions are currently locked/); assert.doesNotMatch(s, /couldn’t reach/);
  });
  await t('12: a failure shows only when the record and the status both did not answer', () => {
    Hs.err = 'It took too long to answer.'; Hs.statusErr = 'x';
    assert.match(text(H.widget()), /couldn’t reach the pick record/);
  });
  await t('future picks are never counted as graded, even with a result on them', () => {
    Hs.rows = []; Hs.props = [prop({ start: now + 3600 })];
    assert.equal(H.graded(H.all([], Hs.props)[0]), false);
    assert.match(text(H.widget()), /No graded picks yet/);
  });
  await t('under 25 graded picks: "Early results", the record only, no performance figures', () => {
    Hs.rows = []; Hs.props = [prop(), prop({ result: 'lost', state: 'lost', actual: '20' }), prop({ result: 'void', state: 'void' }), prop({ start: now + 3600, state: 'published', result: null })];
    const s = text(H.widget());
    assert.match(s, /Early results\. 2 graded picks so far/); assert.match(s, /Record 1–1/); assert.match(s, /2 of 25 before figures are shown/); assert.match(s, /1 pick is waiting/);
    assert.doesNotMatch(s, /Units|ROI|Hit rate|Calibration/);
    const S = H.summary(H.all([], Hs.props)); assert.equal(S.n, 2); assert.equal(S.void, 1); assert.equal(S.waiting, 1);
    assert.equal(H.tier(24), 'early'); assert.equal(H.tier(25), 'small'); assert.equal(H.tier(99), 'small'); assert.equal(H.tier(100), 'full');
  });
  await t('25 to 99 graded: every figure, under a small-sample warning', () => {
    Hs.rows = []; Hs.props = Array.from({ length: 30 }, (_, i) => prop({ key: 'k' + i, result: i % 3 ? 'won' : 'lost', state: i % 3 ? 'won' : 'lost' }));
    const s = text(H.widget());
    assert.match(s, /Limited sample\. 30 graded picks/); assert.match(s, /Hit rate 67%/); assert.match(s, /Units/); assert.match(s, /Closing line/);
    assert.match(s, /Calibration by probability range/); assert.match(s, /Record by/);
  });
  await t('100 or more graded: full reporting, no warning', () => {
    Hs.rows = []; Hs.props = Array.from({ length: 100 }, (_, i) => prop({ key: 'k' + i, result: i % 2 ? 'won' : 'lost', state: i % 2 ? 'won' : 'lost' }));
    const s = text(H.widget());
    assert.doesNotMatch(s, /Limited sample|Early results/); assert.match(s, /Hit rate 50%/);
  });
  await t('the sport filter is applied to the same rows', () => {
    Hs.rows = []; Hs.props = [prop(), prop({ sport: 'nhl', result: 'lost', state: 'lost' })];
    assert.match(text(H.widget(e => e.sport === 'NHL')), /Record 0–1/);
  });
  await t('one request serves both pages, with receipts, and a second caller shares it', async () => {
    calls.length = 0; answers = { '/api/record': { entries: [], upcoming: [] }, '/api/props/record': { entries: [prop()] }, '/api/grading/status': { props: { won: 1 } } };
    const a = H.load(true), b = H.load(); assert.strictEqual(a, b); await a;
    assert.deepStrictEqual(calls.sort(), ['/api/grading/status', '/api/props/record?receipts=1', '/api/record?receipts=1']);
    assert.equal(Hs.props.length, 1); assert.equal(Hs.err, '');
  });
  await t('Pick history breaks the record down by league and by the evidence grade locked in the receipt', () => {
    const rows = H.all([{ key: 'm1', sport: 'soccer', lg: 'eng.1', ko: now - 86400, home: 'Arsenal', away: 'Chelsea', pick: 'home', top: 0.55, result: 'won', state: 'won' }],
      [prop({ evidence: 'B' }), prop({ evidence: 'B', result: 'lost', state: 'lost' }), prop({ receipt: { evidence: 'A' } }), prop()]);
    const lg = H.BY.league[1](rows), ev = H.BY.evidence[1](rows);
    assert.deepEqual(lg.map(x => [x.k, x.n]), [['NBA', 4], ['Premier League', 1]]);
    assert.deepEqual(ev.map(x => [x.k, x.n]), [['A · Strong evidence', 1], ['B · Good evidence', 2], ['Not recorded', 2]]);
    for (const k of ['sport', 'league', 'market', 'provider', 'sedge', 'conf', 'said', 'evidence']) assert.ok(H.BY[k], k);
  });
  await t('25 to 99 graded picks are labelled "Limited sample"', () => {
    Hs.rows = []; Hs.props = Array.from({ length: 30 }, (_, i) => prop(i % 3 ? {} : { result: 'lost', state: 'lost' }));
    assert.match(text(H.widget()), /Limited sample\. 30 graded picks/);
    assert.equal(H.tier(24), 'early'); assert.equal(H.tier(25), 'small'); assert.equal(H.tier(99), 'small'); assert.equal(H.tier(100), 'full');
  });
  console.log(`${n} passed`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1) });
