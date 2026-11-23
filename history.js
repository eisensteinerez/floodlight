/* Floodlight · Pick history: every published pick, its state from publication to result, and how the record adds up.
   Two records on the server, read together (receipts included):
   - match forecasts (record.py): every forecast before kick-off is kept, the last one is locked at kick-off and graded;
   - player props (propbook.py): the first reading is the original and is never replaced, later readings are kept beside
     it, readings stop five minutes before the start, and the prop is graded on the original line.
   Grading runs on the server and, every hour, on GitHub (site_grader.py), which also keeps a copy of the record so a
   deploy can't lose it. /api/grading/status says when it last ran.
   Honest by construction: a miss stays on the list exactly like a hit, a push or void is never a hit, nothing is
   graded on a later line, test picks never appear, and a hit rate is only shown once there are enough graded picks. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const pct = x => Math.round(x * 100);
  const LG = { nfl: 'NFL', fbs: 'College football', fcs: 'College football (FCS)', ufl: 'UFL' };
  const PROP_SPORT = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer' };
  const BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' };
  const fmt = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  /* Performance is not advertised before it means something (Erez's rule):
     under 25 graded picks: "Early results", the record only (no hit rate, units, ROI or calibration);
     25 to 99: every figure, under a small-sample warning; 100 and more: full reporting. */
  const EARLY = 25, FULL = 100;
  const MIN_RATE = EARLY;   // graded picks before a hit rate is shown at all
  const SMALL = FULL;       // under this, every figure says it is a small sample
  const tier = n => n < EARLY ? 'early' : n < FULL ? 'small' : 'full';
  const tierNote = (n, short) => n >= FULL ? '' : n < EARLY
    ? `<p class="hs-tier early" role="note"><b>Early results.</b> ${n} graded ${n === 1 ? 'pick' : 'picks'} so far${short ? '' : '. Hit rate, units and calibration appear at 25 graded picks, and full reporting at 100'}.</p>`
    : `<p class="hs-tier small" role="note"><b>Small sample.</b> ${n} graded picks. ${short ? 'Figures can swing a lot until 100.' : 'These figures can swing a lot until 100 picks are graded; read them as a first look, not a track record.'}</p>`;
  const RANGE = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']];
  const KINDS = [['all', 'All picks'], ['match', 'Match forecasts'], ['prop', 'Player props']];
  const CAL = [[0, 50, 'Under 50%'], [50, 60, '50–59%'], [60, 70, '60–69%'], [70, 80, '70–79%'], [80, 90, '80–89%'], [90, 101, '90%+']];
  const EDGES = [[-1e9, 0, 'Below 0'], [0, 3, '0–2 points'], [3, 5, '3–4 points'], [5, 10, '5–9 points'], [10, 1e9, '10+ points']];
  const LEAD = [[0, 3600, 'Under 1 hour'], [3600, 6 * 3600, '1–6 hours'], [6 * 3600, 86400, '6–24 hours'], [86400, 1e12, 'Over a day']];
  const STATES = [['published', 'Published', 'Saved with its original numbers; readings are still added until the lock'], ['locked', 'Locked', 'Five minutes before the start: nothing changes from here'],
    ['started', 'Game started', 'Being played'], ['pending', 'Pending result', 'Over, waiting for the box score or final'], ['won', 'Hit', ''], ['lost', 'Miss', ''],
    ['push', 'Push', 'Landed on the line, or a tie'], ['void', 'Void', 'Did not play, or postponed'], ['unknown', 'Not graded', 'The result could not be found for certain'], ['corrected', 'Corrected', 'The result changed after a re-check']];
  const STATE_NAME = Object.fromEntries(STATES.map(([k, l]) => [k, l]));
  const Hs = { rows: null, props: null, upcoming: [], status: null, at: 0, err: '', propErr: '', statusErr: '', loading: false, wBy: 'sport', sport: 'all', kind: 'all', res: 'all', days: 30, shown: 40, by: 'sport', open: new Set() };
  const get = url => Promise.race([fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || String(r.status)); return d }), new Promise((_, no) => setTimeout(() => no(new Error('It took too long to answer.')), 45000))]);
  /* ---------- the record service ----------
     One request and one shape for every place that shows the record: this page and Predictions' "How we have done".
     Both read Hs through load(); a second caller while a read is running gets the same promise. A failed read is tried
     once more by itself before anything says it failed, and the grader's status (counts only, a cheap request) is enough
     to show the right empty state when the full record is slow. Every answer is announced with the fl:record event. */
  let inflight = null;
  const once = () => Promise.all([
    get('/api/record?receipts=1').then(d => { Hs.rows = d.entries || []; Hs.upcoming = d.upcoming || []; Hs.err = '' }, e => { Hs.err = e.message || 'It did not load.' }),
    get('/api/props/record?receipts=1').then(d => { Hs.props = d.entries || []; Hs.propErr = '' }, e => { Hs.props = Hs.props || []; Hs.propErr = e.message || 'It did not load.' }),
    get('/api/grading/status').then(d => { Hs.status = d; Hs.statusErr = '' }, e => { Hs.statusErr = e.message || 'It did not load.' })]);
  function load(force) {
    if (inflight) return inflight;
    if (!force && Hs.at && Date.now() - Hs.at < 60000) return Promise.resolve(Hs);
    Hs.loading = true; draw();
    inflight = once().then(() => Hs.err ? new Promise(ok => setTimeout(ok, 3000)).then(once) : null).then(() => {
      if (!Hs.err) Hs.at = Date.now();
      Hs.loading = false; inflight = null; draw();
      try { document.dispatchEvent(new CustomEvent('fl:record')) } catch (e) {}
      return Hs });
    return inflight;
  }

  /* ---------- one shape for both records ---------- */
  // decimal odds a pick was priced at: the book's own price when one was saved, else the market's no-vig chance
  const dec = (price, mkt) => typeof price === 'number' ? (price > 0 ? 1 + price / 100 : 1 + 100 / -price) : mkt > 0.02 && mkt < 0.98 ? 1 / mkt : null;
  function fromMatch(e) {
    const mk = e.market && typeof e.market[e.pick] === 'number' ? e.market[e.pick] : null, fin = Array.isArray(e.final) ? `${e.final[0]}–${e.final[1]}` : '';
    const reads = e.readings || [], first = e.first || reads[0] || null;
    const mFirst = first?.market && typeof first.market[e.pick] === 'number' ? first.market[e.pick] : null;
    // closing line for a match: did the market's chance for our pick rise between our first forecast and kick-off?
    const clv = mFirst != null && mk != null && Math.abs(mk - mFirst) >= 0.005 && first?.pick === e.pick ? { beat: mk > mFirst, moved: `Market ${pct(mFirst)}% to ${pct(mk)}%` } : null;
    const move = mFirst != null && mk != null && first?.pick === e.pick ? (mk - mFirst) * 100 : null;   // closing-line move, in points of chance for our pick
    return { kind: 'match', key: e.key, t: e.ko, made: e.made || first?.at || null, move, sport: e.sport === 'soccer' ? 'Soccer' : LG[e.lg] || 'Football', providers: [mk == null ? 'No price saved' : 'Sportsbooks'],
      market: e.pick === 'draw' ? 'Match result: draw' : 'Match result: win', ours: e.top, mkt: mk, edge: mk == null ? null : pct(e.top) - pct(mk), conf: e.conf || '', result: e.result || null,
      state: e.state || (e.result || 'pending'), clv, clvNote: clv?.moved || '', price: null,
      title: e.pick === 'draw' ? 'Draw' : `${e[e.pick]} to win`, sub: `${e.home} ${fin || 'v'} ${e.away}`, actual: fin, why: e.why || '', raw: e };
  }
  // how far the market moved for our side between publication and the close, at the same line, in points of chance
  function propMove(e) {
    const a = e.first, b = e.close; if (!a || !b || ['published', 'locked'].includes(e.state) || a.line !== b.line || a.market == null || b.market == null) return null;
    const mb = b.side === e.side ? b.market : 1 - b.market, ma = a.side === e.side ? a.market : 1 - a.market;
    return (mb - ma) * 100;
  }
  function fromProp(e) {
    const over = e.side === 'over', what = e.yes ? `${e.label}: ${over ? 'Yes' : 'No'}` : `${over ? 'Over' : 'Under'} ${fmt(e.line)} ${String(e.label).toLowerCase()}`;
    return { kind: 'prop', key: e.key, t: e.start, made: e.made || null, move: propMove(e), sedge: e.sedge ?? null, sport: PROP_SPORT[e.sport] || e.sport, providers: (e.books || []).map(b => BOOK[b] || b).filter(Boolean), market: e.label,
      ours: e.ours, mkt: e.market, edge: e.edge, conf: e.conf || '', result: e.result || null, state: e.state || (e.result || 'pending'), price: e.first?.price ?? null,
      clv: e.clv && e.clv.beat != null && !['published', 'locked'].includes(e.state) ? e.clv : null, clvNote: e.clv?.moved || '',   // the close is only known after the lock
      title: `${e.player} ${what.charAt(0).toLowerCase() + what.slice(1)}`, sub: [e.team, e.opp].filter(Boolean).join(' v '), actual: e.actual || '', why: e.why || '', raw: e };
  }
  function fromUpcoming(e) {
    const mk = e.market && typeof e.market[e.pick] === 'number' ? e.market[e.pick] : null;
    return { kind: 'match', key: e.key, t: e.ko, made: e.made, sport: e.sport === 'soccer' ? 'Soccer' : LG[e.lg] || 'Football', providers: [], market: e.pick === 'draw' ? 'Match result: draw' : 'Match result: win',
      ours: e.top, mkt: mk, edge: mk == null ? null : pct(e.top) - pct(mk), conf: e.conf || '', result: null, state: e.state, clv: null, clvNote: '', price: null,
      title: e.pick === 'draw' ? 'Draw' : `${e[e.pick]} to win`, sub: `${e.home} v ${e.away}`, actual: '', why: '', raw: { ...e, upcoming: true } };
  }
  const all = (matches, props, upcoming) => [...(matches || []).map(fromMatch), ...(props || []).map(fromProp), ...(upcoming || []).map(fromUpcoming)].sort((a, b) => b.t - a.t);
  // a hit or a miss whose start has passed: a pick for a game still to come is never counted, whatever it says
  const graded = e => (e.result === 'won' || e.result === 'lost') && !!e.t && e.t * 1000 <= Date.now();
  /* "Locked before start": the pick's first reading was saved before the game began, it was locked with those numbers,
     and the result was put on it by the grader (server or GitHub) from the final score or box score, not typed in. */
  const AUTO = new Set(['server', 'github']);
  function verified(e) {
    const r = e.raw || e, start = e.t || r.ko || r.start, first = r.first?.at || r.made || 0;
    if (!start || !first || first >= start) return false;
    if (e.kind === 'match' && !(r.locked && r.locked <= start + 60)) return false;
    return ['won', 'lost', 'push', 'void'].includes(e.result) && AUTO.has(r.by);
  }
  const lockBadge = e => verified(e) ? `<span class="pl fl-lock" title="Saved ${esc(new Date((e.raw?.first?.at || e.raw?.made || e.made) * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}, before the start, and graded automatically from the final result">${ic('check', 12)}Locked before start</span>` : '';
  function stats(rows) {
    const g = rows.filter(graded), won = g.filter(e => e.result === 'won').length, priced = g.filter(e => e.mkt != null);
    const vs = priced.length ? (priced.filter(e => e.result === 'won').length / priced.length - priced.reduce((a, e) => a + e.mkt, 0) / priced.length) * 100 : null;
    const cl = rows.filter(e => e.clv), beat = cl.filter(e => e.clv.beat).length;
    const paid = g.map(e => ({ e, d: dec(e.price, e.mkt) })).filter(x => x.d), units = paid.reduce((a, x) => a + (x.e.result === 'won' ? x.d - 1 : -1), 0);
    const edged = g.filter(e => typeof e.edge === 'number'), over = e => !!e.t && e.t * 1000 <= Date.now(), mv = rows.filter(e => typeof e.move === 'number' && over(e));
    return { n: g.length, won, lost: g.length - won, push: rows.filter(e => e.result === 'push' && over(e)).length, void: rows.filter(e => e.result === 'void' && over(e)).length,
      unknown: rows.filter(e => e.result === 'unknown' && over(e)).length, moveN: mv.length, move: mv.length ? mv.reduce((a, e) => a + e.move, 0) / mv.length : null, rate: g.length ? won / g.length : null, said: g.length ? g.reduce((a, e) => a + (e.ours || 0), 0) / g.length : null,
      vs, priced: priced.length, clvN: cl.length, clv: cl.length ? beat / cl.length : null, staked: paid.length, units: paid.length ? units : null, roi: paid.length ? units / paid.length : null,
      edge: edged.length ? edged.reduce((a, e) => a + e.edge, 0) / edged.length : null };
  }
  const group = (rows, keys) => { const m = new Map(); for (const e of rows) for (const k of [].concat(keys(e) ?? [])) { if (k == null || k === '') continue; (m.get(k) || m.set(k, []).get(k)).push(e) } return [...m].map(([k, xs]) => ({ k, ...stats(xs) })).filter(x => x.n || x.clvN) };
  const ordered = (list, xs) => xs.sort((a, b) => list.findIndex(x => x[2] === a.k) - list.findIndex(x => x[2] === b.k));
  const inBand = (list, v) => v == null ? null : (list.find(([lo, hi]) => v >= lo && v < hi) || [])[2] || null;
  const BY = {
    sport: ['Sport', rows => group(rows, e => e.sport).sort((a, b) => b.n - a.n)],
    market: ['Market', rows => group(rows, e => e.market).sort((a, b) => b.n - a.n)],
    said: ['Confidence range', rows => ordered(CAL, group(rows, e => e.ours == null ? null : inBand(CAL, e.ours * 100)))],
    conf: ['Confidence label', rows => group(rows, e => e.conf ? e.conf.charAt(0).toUpperCase() + e.conf.slice(1) : null).sort((a, b) => b.n - a.n)],
    lead: ['Time before start', rows => ordered(LEAD, group(rows, e => e.made ? inBand(LEAD, e.t - e.made) : null))],
    edge: ['Edge', rows => { const xs = group(rows, e => e.edge == null ? 'No market price' : inBand(EDGES, e.edge)), at = k => k === 'No market price' ? 99 : EDGES.findIndex(x => x[2] === k); return xs.sort((a, b) => at(a.k) - at(b.k)) }],
    provider: ['Provider', rows => group(rows, e => e.providers).sort((a, b) => b.n - a.n)],
    sedge: ['Supported edge', rows => { const xs = group(rows, e => e.sedge == null ? 'Not recorded' : inBand(EDGES, e.sedge)), at = k => k === 'Not recorded' ? 99 : EDGES.findIndex(x => x[2] === k); return xs.sort((a, b) => at(a.k) - at(b.k)) }],
  };
  const signed = (v, d = 1) => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const rateCell = r => r.n >= 10 && !Hs.early ? `<b>${pct(r.rate)}%</b>` : r.n ? `<span class="lb" title="${r.n} graded: too few to rate">${r.won} of ${r.n}</span>` : '–';
  const ago = t => { const s = Math.max(0, Math.round(Date.now() / 1000 - t)); return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago` };
  const when = t => new Date(t * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  /* ---------- "How we have done": the same record and the same sums, short, for the Predictions page ----------
     Never a loading failure when the truth is "nothing graded yet": with no graded pick it says so and counts the picks
     waiting for their games. A failure is shown only when the record and the grader's status both did not answer. */
  const WAIT = new Set(['published', 'locked', 'started', 'pending']);
  const WBY = [['sport', 'Sport'], ['market', 'Market'], ['provider', 'Provider'], ['conf', 'Confidence']];
  const isWaiting = e => !e.result && WAIT.has(e.state);
  function summary(rows) {
    const S = stats(rows), g = rows.filter(e => graded(e) && e.ours != null);
    const cal = CAL.map(([lo, hi, label]) => { const xs = g.filter(e => e.ours * 100 >= lo && e.ours * 100 < hi), n = xs.length, won = xs.filter(e => e.result === 'won').length;
      return { label, n, won, said: n ? xs.reduce((a, e) => a + e.ours, 0) / n : null, rate: n ? won / n : null } }).filter(b => b.n);
    return { ...S, waiting: rows.filter(isWaiting).length, cal };
  }
  const waitingFromStatus = st => !st ? null : ['matches', 'props'].reduce((a, k) => a + [...WAIT].reduce((b, x) => b + ((st[k] || {})[x] || 0), 0), 0);
  // ok: (row) -> bool, the Predictions page's sport filter. Returns the section's HTML.
  function widget(ok = () => true) {
    const head = `<div class="sec-h"><h2 id="hw-h">How we have done</h2></div>`;
    if (!Hs.rows && !Hs.status) {
      if (Hs.loading || inflight || !Hs.err) return `<section class="card pd-res-card hw" aria-labelledby="hw-h" aria-busy="true">${head}<i class="skl" style="height:18px;width:80%;display:block"></i></section>`;
      return `<section class="card pd-res-card hw" aria-labelledby="hw-h">${head}<p class="lb" role="status">We couldn’t reach the pick record just now. The record itself is safe on the server and on GitHub.</p><button type="button" class="bt sm ghost" data-hw="reload" data-fk="hw-retry">Try again</button></section>`;
    }
    const rows = all(Hs.rows, Hs.props, Hs.upcoming).filter(ok), S = summary(rows);
    const waiting = Hs.rows ? S.waiting : waitingFromStatus(Hs.status) || 0;
    const link = `<button type="button" class="lk" data-page="history" data-fk="hist">Open Pick history</button>`;
    if (!S.n) return `<section class="card pd-res-card hw hw-zero" aria-labelledby="hw-h">${head}<p class="hw-big">No graded picks yet</p>
      <p>${waiting ? `${waiting} ${waiting === 1 ? 'prediction is' : 'predictions are'} currently locked.` : 'Each prediction is saved with its original numbers when it is published.'} Results will appear after ${waiting === 1 ? 'its game finishes' : 'their games finish'}.</p>
      ${S.push || S.void || S.unknown ? `<p class="lb">${[S.push && `${S.push} push`, S.void && `${S.void} void`, S.unknown && `${S.unknown} not graded`].filter(Boolean).join(', ')}: listed in Pick history, never counted as hits or misses.</p>` : ''}${waiting || rows.length ? link : ''}</section>`;
    const rateOk = S.n >= MIN_RATE, by = WBY.find(x => x[0] === Hs.wBy) ? Hs.wBy : 'sport', groups = BY[by][1](rows).slice(0, 6);
    const cell = (k, v, sub) => `<div class="tile inset"><span class="lb">${k}</span><b class="fig num">${v}</b>${sub ? `<small class="lb">${sub}</small>` : ''}</div>`;
    if (tier(S.n) === 'early') return `<section class="card pd-res-card hw" aria-labelledby="hw-h">${head}${tierNote(S.n, true)}
      <div class="pd-tiles hw-tiles">${cell('Record', `${S.won}–${S.lost}${S.push ? `–${S.push}` : ''}`, `hits–misses${S.push ? '–pushes' : ''}${S.void ? ` · ${S.void} void` : ''}`)}${cell('Graded', S.n, `of ${EARLY} before figures are shown`)}</div>
      <p class="lb">${S.waiting ? `${S.waiting} ${S.waiting === 1 ? 'pick is' : 'picks are'} waiting for ${S.waiting === 1 ? 'its game' : 'their games'}. ` : ''}Every pick is listed, hits and misses alike.</p>${link}</section>`;
    return `<section class="card pd-res-card hw" aria-labelledby="hw-h">${head}${tierNote(S.n, true)}
      <div class="pd-tiles hw-tiles">
        ${cell('Record', `${S.won}–${S.lost}${S.push ? `–${S.push}` : ''}`, `hits–misses${S.push ? '–pushes' : ''}${S.void ? ` · ${S.void} void` : ''}`)}
        ${cell('Hit rate', rateOk ? pct(S.rate) + '%' : '–', rateOk ? `we said ${pct(S.said)}%` : `${S.n} of ${MIN_RATE} graded needed`)}
        ${cell('Units', S.units == null ? '–' : signed(S.units), S.units == null ? 'no prices saved' : `ROI ${signed(S.roi * 100)}% over ${S.staked}`)}
        ${cell('Closing line', S.move == null ? '–' : signed(S.move) + ' pts', S.move == null ? 'once a line moves' : `average move for our side${S.clvN ? `, beat ${pct(S.clv)}% of ${S.clvN}` : ''}`)}</div>
      ${S.cal.length ? `<details class="hw-d"><summary data-fk="hw-cal">Calibration by probability range</summary><div class="tbx-wrap"><table class="tbx hs-tbl"><thead><tr><th scope="col">We said</th><th scope="col" class="r">Picks</th><th scope="col" class="r">Average</th><th scope="col" class="r">It hit</th></tr></thead>
        <tbody>${S.cal.map(b => `<tr><th scope="row">${esc(b.label)}</th><td class="r num">${b.n}</td><td class="r num">${pct(b.said)}%</td><td class="r num">${b.n >= 10 ? pct(b.rate) + '%' : `<span class="lb">${b.won} of ${b.n}</span>`}</td></tr>`).join('')}</tbody></table></div>
        <p class="lb">A range shows its hit rate from 10 graded picks.</p></details>` : ''}
      <div class="hw-by"><label class="fl-f hw-sel"><span>Record by</span><select class="inp" data-hwby data-fk="hw-by">${WBY.map(([k, l]) => `<option value="${k}"${k === by ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${groups.length ? `<div class="tbx-wrap"><table class="tbx hs-tbl"><thead><tr><th scope="col">${esc(BY[by][0])}</th><th scope="col" class="r">Hit–miss</th><th scope="col" class="r">Hit rate</th><th scope="col" class="r">Units</th></tr></thead>
          <tbody>${groups.map(r => `<tr><th scope="row">${esc(r.k)}</th><td class="r num">${r.won}–${r.lost}</td><td class="r num">${rateCell(r)}</td><td class="r num">${r.units == null ? '–' : signed(r.units)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="lb">Nothing graded in this group yet.</p>'}</div>
      <p class="lb">${S.waiting ? `${S.waiting} ${S.waiting === 1 ? 'pick is' : 'picks are'} waiting for ${S.waiting === 1 ? 'its game' : 'their games'} and not counted. ` : ''}Only finished games are graded.</p>${link}</section>`;
  }
  document.addEventListener('change', ev => { const sel = ev.target.closest?.('[data-hwby]'); if (!sel) return; Hs.wBy = sel.value; try { document.dispatchEvent(new CustomEvent('fl:record')) } catch (e) {} });
  document.addEventListener('click', ev => { if (ev.target.closest?.('[data-hw="reload"]')) load(true) });

  function breakdown(rows) {
    const [first, fn] = BY[Hs.by], xs = fn(rows);
    const tabs = Object.entries(BY).map(([k, [l]]) => `<button type="button" role="tab" id="hs-tab-${k}" aria-selected="${Hs.by === k}" aria-controls="hs-by" tabindex="${Hs.by === k ? 0 : -1}" class="cx" data-hsby="${k}" data-fk="by-${k}">${esc(l)}</button>`).join('');
    return `<section class="card hs-card" aria-labelledby="hs-by-h"><div class="sec-h"><h2 id="hs-by-h">Record by</h2><div class="cx-row scroll" role="tablist" aria-label="Group the record by">${tabs}</div></div>
      <div id="hs-by" role="tabpanel" aria-labelledby="hs-tab-${Hs.by}">${xs.length ? `<div class="tbx-wrap"><table class="tbx hs-tbl"><thead><tr><th scope="col">${esc(first)}</th><th scope="col" class="r">Graded</th><th scope="col" class="r">Hit–miss</th><th scope="col" class="r">Hit rate</th><th scope="col" class="r">Expected</th><th scope="col" class="r">Units</th><th scope="col" class="r">ROI</th><th scope="col" class="r">Beat the close</th></tr></thead>
        <tbody>${xs.map(r => `<tr><th scope="row">${esc(r.k)}</th><td class="r num">${r.n}</td><td class="r num">${r.won}–${r.lost}</td><td class="r num">${rateCell(r)}</td><td class="r num">${r.n ? pct(r.said) + '%' : '–'}</td><td class="r num">${r.units == null ? '<span class="lb">no prices</span>' : signed(r.units)}</td><td class="r num">${r.roi == null ? '–' : signed(r.roi * 100) + '%'}</td><td class="r num">${r.clvN ? `${pct(r.clv)}% <small class="lb">of ${r.clvN}</small>` : '<span class="lb">–</span>'}</td></tr>`).join('')}</tbody></table></div>
        <p class="lb">A row with fewer than 10 graded picks shows the count, not a percentage.${Hs.by === 'provider' ? ' A prop posted on more than one app is counted under each of them.' : ''}${Hs.by === 'lead' ? ' Time before start is when the pick was first published.' : ''}</p>` : '<p class="lb">Nothing graded in this view yet.</p>'}</div></section>`;
  }

  function calibration(rows) {
    const g = rows.filter(e => graded(e) && e.ours != null);
    const bs = CAL.map(([lo, hi, label]) => { const xs = g.filter(e => e.ours * 100 >= lo && e.ours * 100 < hi), n = xs.length, won = xs.filter(e => e.result === 'won').length;
      return { label, n, won, said: n ? xs.reduce((a, e) => a + e.ours, 0) / n : null, rate: n ? won / n : null } });
    const shown = bs.filter(b => b.n || b.label !== 'Under 50%'), H = 130, col = v => v == null ? 0 : Math.max(3, Math.round(v * H)), enough = b => b.n >= 10;
    const diff = b => { if (!enough(b)) return b.n ? '<span class="lb">too few</span>' : '–'; const d = (b.rate - b.said) * 100; return `<span class="${Math.abs(d) < 5 ? '' : d > 0 ? 'hs-up' : 'hs-dn'}">${signed(d)} pts</span>` };
    return `<section class="card hs-card" aria-labelledby="hs-cal-h"><div class="sec-h"><h2 id="hs-cal-h">Calibration</h2><span class="lb">When we said 70%, did about 70% hit?</span></div>
      ${g.length ? `<div class="pd-cal hs-cal" style="grid-template-columns:repeat(${shown.length},minmax(0,1fr))" role="img" aria-label="${esc(shown.filter(enough).map(b => `${b.label}: we said ${pct(b.said)}%, ${pct(b.rate)}% hit, ${b.n} picks`).join('. ') || 'No range has 10 graded picks yet')}">${shown.map(b => `<div class="pd-col${enough(b) ? '' : ' none'}" title="${esc(b.n ? `${b.label}: ${b.n} graded, ${b.won} hit${enough(b) ? `; we said ${pct(b.said)}% on average` : ' (too few to chart)'}` : `${b.label}: none`)}"><div class="pd-pair" style="height:${H + 22}px"><span class="said" style="height:${enough(b) ? col(b.said) : 0}px"><i class="num">${enough(b) ? pct(b.said) : ''}</i></span><span class="hit" style="height:${enough(b) ? col(b.rate) : 0}px"><i class="num">${enough(b) ? pct(b.rate) : ''}</i></span></div><b>${esc(b.label)}</b><small class="num">${b.n ? `${b.n} graded` : 'none'}</small></div>`).join('')}</div>
      <div class="pd-leg" aria-hidden="true"><span><i class="said"></i>We said</span><span><i class="hit"></i>It hit</span></div>` : ''}
      <div class="tbx-wrap"><table class="tbx hs-tbl"><thead><tr><th scope="col">Model range</th><th scope="col" class="r">Picks</th><th scope="col" class="r">We said</th><th scope="col" class="r">Actual hit rate</th><th scope="col" class="r">Difference</th></tr></thead>
        <tbody>${shown.map(b => `<tr><th scope="row">${esc(b.label)}</th><td class="r num">${b.n || '–'}</td><td class="r num">${b.n ? pct(b.said) + '%' : '–'}</td><td class="r num">${enough(b) ? pct(b.rate) + '%' : b.n ? `<span class="lb">${b.won} of ${b.n}</span>` : '–'}</td><td class="r num">${diff(b)}</td></tr>`).join('')}</tbody></table></div>
      <p class="lb">A range is charted once it has 10 graded picks. A positive difference means we were too cautious in that range; a negative one means we were too sure.${g.length && g.length < SMALL ? ` With ${g.length} graded picks this is a small sample, so expect big swings.` : ''}</p></section>`;
  }

  /* ---------- the receipt: everything about one pick ---------- */
  function receipt(e) {
    const r = e.raw, dl = pairs => `<dl class="hs-dl">${pairs.filter(p => p[1] != null && p[1] !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    const p = v => v == null ? '–' : pct(v) + '%';
    let orig = '', reads = '';
    if (e.kind === 'prop') {
      const f = r.first || {};
      orig = dl([['Player', esc(r.player)], ['Team', esc(r.team || '–')], ['Opponent', esc(r.opp || '–')], ['Market', esc(r.label)], ['Line', esc(fmt(r.line))], ['Side', r.yes ? (r.side === 'over' ? 'Yes' : 'No') : (r.side === 'over' ? 'Over' : 'Under')],
        ['Model probability', p(f.ours ?? r.ours)], ['Market probability', p(f.market ?? r.market)], ['Book price', f.price != null ? signed(f.price, 0) : 'None (pick’em app)'],
        ['Edge', f.edge == null ? '–' : signed(f.edge, 0) + ' points'], ['Published', f.at ? esc(when(f.at)) : '–'], ['Data source', esc((f.books || r.books || []).map(b => BOOK[b] || b).join(', ') || '–')]]);
      const rs = (r.readings || []).slice(1);
      reads = rs.length ? `<div class="tbx-wrap"><table class="tbx hs-tbl"><caption class="lb">Later readings, saved beside the original. The pick is graded on the original line.</caption><thead><tr><th scope="col">Read</th><th scope="col" class="r">Line</th><th scope="col">Side</th><th scope="col" class="r">Ours</th><th scope="col" class="r">Market</th></tr></thead>
        <tbody>${rs.slice(-10).map(x => `<tr><th scope="row" class="num">${esc(when(x.at))}</th><td class="r num">${esc(fmt(x.line))}</td><td>${x.side === 'over' ? 'Over' : 'Under'}</td><td class="r num">${p(x.ours)}</td><td class="r num">${p(x.market)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="lb">No later readings: the line had not moved when it was locked.</p>';
    } else {
      const f = r.first || {}, side = k => k === 'draw' ? 'Draw' : r[k] || k;
      orig = dl([['First forecast', f.pick ? `${esc(side(f.pick))} · ${p(f.top)}` : '–'], ['Published', f.at ? esc(when(f.at)) : r.made ? esc(when(r.made)) : '–'],
        [r.upcoming ? 'Latest forecast' : 'Locked at kick-off', `${esc(side(r.pick))} · ${p(r.top)}`], ['Market probability', p(e.mkt)], ['Edge', e.edge == null ? '–' : signed(e.edge, 0) + ' points'],
        ['Predicted score', Array.isArray(r.score) ? esc(r.score.join('–')) : null], ['Data source', 'Floodlight forecast model, sportsbook prices with the margin removed']]);
      const rs = r.readings || [];
      reads = rs.length > 1 ? `<div class="tbx-wrap"><table class="tbx hs-tbl"><caption class="lb">Every forecast before kick-off. The last one is graded.</caption><thead><tr><th scope="col">Made</th><th scope="col">Pick</th><th scope="col" class="r">Ours</th><th scope="col" class="r">Market</th></tr></thead>
        <tbody>${rs.map(x => `<tr><th scope="row" class="num">${esc(when(x.at))}</th><td>${esc(side(x.pick))}</td><td class="r num">${p(x.top)}</td><td class="r num">${p(x.market && x.market[x.pick])}</td></tr>`).join('')}</tbody></table></div>` : (r.why_pick || []).length ? `<ul class="hs-why-list">${r.why_pick.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    }
    const res = e.result ? dl([['Result', esc(STATE_NAME[e.result] || e.result)], [e.kind === 'prop' ? 'Player stat' : 'Final score', esc(e.actual || '–')], ['How it was graded', esc(r.calc || r.why || '–')],
      ['Source', esc(r.source || '–')], ['Graded', r.graded ? esc(when(r.graded)) : '–'], ['Graded by', r.by === 'github' ? 'Floodlight grader on GitHub' : r.by === 'server' ? 'Floodlight server' : String(r.by || '').startsWith('admin') ? 'Corrected by an administrator' : '–']])
      : `<p class="lb">${esc(STATES.find(s => s[0] === e.state)?.[2] || 'Waiting for the result.')}</p>`;
    const cor = (r.corrections || []).length ? `<ul class="hs-cor">${r.corrections.map(c => `<li><b>${esc(STATE_NAME[c.from] || c.from)} → ${esc(STATE_NAME[c.to] || c.to)}</b> on ${esc(when(c.at))}${c.fromActual || c.toActual ? ` (${esc(c.fromActual || '–')} → ${esc(c.toActual || '–')})` : ''}${c.why ? `: ${esc(c.why)}` : ''}</li>`).join('')}</ul>` : '<p class="lb">No corrections.</p>';
    return `<div class="hs-rc"><section><h3>Original prediction</h3>${orig}${reads}</section><section><h3>Result</h3>${res}<h3>Correction history</h3>${cor}${fixForm(e)}</section></div>`;
  }
  /* Admin mode only: correct a wrong grade. The receipt is never touched; the change goes into the pick's correction
     history and the public correction log, and automatic re-grading leaves the pick alone from then on. */
  function fixForm(e) {
    if (!window.flAdmin?.on?.() || !e.t || e.t * 1000 > Date.now()) return '';
    const id = `hsfix-${String(e.key).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return `<form class="hs-fix" data-hsfix="${esc(e.key)}" data-kind="${e.kind}" aria-labelledby="${id}-h"><h3 id="${id}-h">Correct this grade</h3>
      <div class="hs-fix-row"><label class="fl-f"><span>Grade</span><select class="inp" name="result" required>${[['won', 'Hit'], ['lost', 'Miss'], ['push', 'Push'], ['void', 'Void']].map(([k, l]) => `<option value="${k}"${e.result === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fl-f"><span>${e.kind === 'prop' ? 'Player stat' : 'Final score'}</span><input class="inp" name="actual" value="${esc(e.actual || '')}" maxlength="40" autocomplete="off"></label></div>
      <label class="fl-f"><span>Why (shown in the public correction log)</span><textarea class="inp" name="why" rows="2" minlength="8" maxlength="200" required></textarea></label>
      <div class="hs-fix-row"><button type="submit" class="bt sm">Save correction</button><span class="lb" role="status" aria-live="polite" data-hsfixmsg></span></div></form>`;
  }

  function statusLine() {
    const s = Hs.status; if (!s) return '';
    const run = s.lastRun?.at || s.lastGraded, gh = s.github?.at, stale = run && Date.now() / 1000 - run > 3 * 3600 && s.pending;
    const where = s.storage === 'database' ? 'Kept in the database' : s.storage === 'github' ? `Backed up on GitHub ${ago(gh)}` : 'Kept on the server only, so a deploy can wipe it until the GitHub backup runs';
    return `<p class="hs-status${stale || s.storage === 'disk' ? ' warn' : ''}" role="status">${ic(stale || s.storage === 'disk' ? 'help' : 'check', 16)}<span>${run ? `${s.lastRun?.at ? 'Grader last ran' : 'Last pick graded'} ${ago(run)}${s.lastRun?.by === 'github' ? ' on GitHub' : ''}` : 'The grader has not graded anything yet'}${s.pending ? ` · ${s.pending} waiting for a result` : ''} · ${esc(where)}</span></p>`;
  }

  function render(el) {
    el.innerHTML = `<div class="vst hs"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Pick history</h1><p class="pg-sub">Every pick we published, saved with its original numbers, locked before the start and graded on its own. Misses stay on the list.</p></div>
      <button type="button" class="bt ghost" data-page="predictions">${ic('pred', 18)}Back to Predictions</button></header><div id="hsBody" class="vst" aria-live="polite"></div></div>`;
    draw();
  }
  function draw() {
    const el = document.getElementById('hsBody'); if (!el) return;
    if (!Hs.rows) { el.innerHTML = Hs.err ? `<div class="card emp">${ic('help', 28)}<b>The record did not load</b><p>${esc(Hs.err)} This is a connection problem; the record itself is kept on the server and on GitHub.</p><button type="button" class="bt" data-hs="reload">Try again</button></div>`
      : `<div class="hs-tiles" aria-hidden="true">${'<i class="skl" style="height:96px;display:block"></i>'.repeat(4)}</div><div class="skl" style="height:260px"></div><div class="skl" style="height:320px"></div>`; return }
    const act = document.activeElement?.closest?.('#pg-history [data-fk]')?.dataset.fk;
    const every = all(Hs.rows, Hs.props, Hs.upcoming), since = Hs.days ? Date.now() / 1000 - Hs.days * 86400 : 0, sports = [...new Set(every.map(e => e.sport))];
    const rows = every.filter(e => (e.t >= since || !e.result) && (Hs.kind === 'all' || e.kind === Hs.kind) && (Hs.sport === 'all' || e.sport === Hs.sport)), S = stats(rows);
    const byState = Object.fromEntries(STATES.map(([k]) => [k, rows.filter(e => e.state === k).length]));
    const list = rows.filter(e => Hs.res === 'all' || e.state === Hs.res);
    const seg = (name, label, opts, cur) => `<div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" tabindex="${cur === k ? 0 : -1}" data-hs${name}="${k}" data-fk="${name}-${k}">${esc(l)}</button>`).join('')}</div>`;
    const resPill = e => { const st = e.state, a = e.kind === 'prop' && e.actual ? ` · ${esc(e.actual)}` : '';
      if (e.result === 'won') return `<span class="pl pd-res hit">${ic('check', 14)}Hit${a}</span>${st === 'corrected' ? '<small class="hs-corr">Corrected</small>' : ''}`;
      if (e.result === 'lost') return `<span class="pl pd-res miss hs-miss">${ic('x', 14)}Miss${a}</span>${st === 'corrected' ? '<small class="hs-corr">Corrected</small>' : ''}`;
      if (e.result === 'push') return `<span class="pl">${e.kind === 'prop' ? `Push${a}` : 'Tie, no result'}</span>`;
      if (e.result === 'void') return `<span class="pl">${e.kind === 'prop' ? 'Void, did not play' : 'Void, not played'}</span>`;
      if (e.result === 'unknown') return `<span class="pl" title="${esc(e.why)}">Not graded</span>`;
      return `<span class="pl hs-st-${st}">${esc(STATE_NAME[st] || 'Waiting')}</span>` };
    const row = e => { const open = Hs.open.has(e.key), id = `hs-rc-${esc(e.key).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      return `<tr><td class="num hs-when">${esc(new Date(e.t * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
      <th scope="row"><b>${esc(e.title)}</b><small>${esc([e.sub, e.sport, e.kind === 'prop' ? e.providers.join(', ') : ''].filter(Boolean).join(' · '))}</small>${e.why && e.result && e.result !== 'won' ? `<small class="hs-why">${esc(e.why)}</small>` : ''}</th>
      <td class="r num">${e.ours == null ? '–' : pct(e.ours) + '%'}</td><td class="r num">${e.mkt == null ? '<span class="lb">–</span>' : pct(e.mkt) + '%'}</td>
      <td class="hs-clv">${e.clv ? `<span class="${e.clv.beat ? 'hs-up' : 'hs-dn'}">${e.clv.beat ? 'Beat it' : 'Lost it'}</span><small>${esc(e.clvNote)}</small>` : '<span class="lb">–</span>'}</td><td class="hs-res">${resPill(e)}${lockBadge(e)}</td>
      <td><button type="button" class="bt ghost sm" aria-expanded="${open}" aria-controls="${id}" data-hsrc="${esc(e.key)}" data-fk="rc-${esc(e.key)}">${open ? 'Hide receipt' : 'Receipt'}</button></td></tr>
      ${open ? `<tr class="hs-rc-row" id="${id}"><td colspan="7">${receipt(e)}</td></tr>` : ''}` };
    const small = S.n < SMALL, rateOk = S.n >= MIN_RATE, early = tier(S.n) === 'early'; Hs.early = early;
    const voided = rows.filter(e => e.result === 'void'), fixed = rows.filter(e => (e.raw?.corrections || []).length);
    el.innerHTML = `${statusLine()}<div class="pd-filters"><div class="cx-row scroll" role="radiogroup" aria-label="Sport">${[['all', 'All sports'], ...sports.map(s => [s, s])].map(([k, l]) => `<button type="button" class="cx" role="radio" aria-checked="${Hs.sport === k}" tabindex="${Hs.sport === k ? 0 : -1}" data-hssport="${esc(k)}" data-fk="sp-${esc(k)}">${esc(l)}</button>`).join('')}</div>
        <div class="pd-ctl">${seg('kind', 'Kind of pick', KINDS, Hs.kind)}${seg('days', 'Period', RANGE, Hs.days)}<span class="lb hs-at">${Hs.loading ? 'Checking…' : `Record read ${new Date(Hs.at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}${Hs.err ? ' · the last check failed, showing the earlier reading' : ''}${Hs.propErr ? ' · the props record did not load' : ''}</span><button type="button" class="bt ghost sm" data-hs="reload" data-fk="reload"${Hs.loading ? ' disabled' : ''}>Refresh</button></div></div>
      ${rows.length ? tierNote(S.n) : ''}
      ${!rows.length ? `<div class="card emp">${ic('bars', 28) || ic('trophy', 28)}<b>No picks in this period</b><p>A pick lands here the moment it is published: a match forecast when the model first makes it, a player prop the first time the Predictions page shows it. Widen the period or choose another sport.</p></div>` : `
      <div class="hs-tiles">
        <div class="tile inset"><span class="lb">Record</span><b class="fig num">${S.won}–${S.lost}${S.push ? `–${S.push}` : ''}</b><small class="lb">hits–misses${S.push ? '–pushes' : ''}${S.void ? ` · ${S.void} void` : ''}${S.unknown ? ` · ${S.unknown} not graded` : ''}</small></div>
        <div class="tile inset"><span class="lb">Hit rate</span><b class="fig num">${rateOk ? pct(S.rate) + '%' : '–'}</b><small class="lb">${rateOk ? `expected ${pct(S.said)}%${small ? ' · small sample' : ''}` : S.n ? `${S.n} graded; shown from ${MIN_RATE}` : 'nothing graded yet'}</small></div>
        ${early ? '' : `<div class="tile inset"><span class="lb">Units</span><b class="fig num">${S.units == null ? '–' : signed(S.units)}</b><small class="lb">${S.units == null ? 'no prices saved with these picks' : `1 unit a pick, ROI ${signed(S.roi * 100)}% over ${S.staked}`}</small></div>
        <div class="tile inset"><span class="lb">Beat the closing line</span><b class="fig num">${S.clvN ? pct(S.clv) + '%' : '–'}</b><small class="lb">${S.clvN ? `of ${S.clvN} where the line or price moved` : 'once a line moves before the start'}</small></div>
        <div class="tile inset"><span class="lb">Average edge</span><b class="fig num">${S.edge == null ? '–' : signed(S.edge)}</b><small class="lb">${S.edge == null ? 'no market price saved' : 'points over the market, graded picks'}</small></div>
        <div class="tile inset"><span class="lb">Against the market</span><b class="fig num">${rateOk ? signed(S.vs) : '–'}</b><small class="lb">${S.vs == null ? 'no prices saved with these picks' : rateOk ? `points of hit rate, ${S.priced} priced` : 'shown with the hit rate'}</small></div>`}</div>
      ${early ? '' : calibration(rows)}
      ${breakdown(rows)}
      ${voided.length || fixed.length ? `<section class="card hs-card" aria-labelledby="hs-vc-h"><div class="sec-h"><h2 id="hs-vc-h">Voided and corrected</h2><span class="lb">${voided.length} void · ${fixed.length} corrected</span></div>
        ${voided.length ? `<h3 class="hs-h3">Voided selections</h3><p class="lb">Listed, never counted as hits or misses.</p><ul class="hs-vlist">${voided.slice(0, 30).map(e => `<li><b>${esc(e.title)}</b> <span class="lb">${esc([e.sub, e.sport, new Date(e.t * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })].filter(Boolean).join(' · '))}</span>${e.why ? `<small>${esc(e.why)}</small>` : ''}</li>`).join('')}</ul>` : ''}
        ${fixed.length ? `<h3 class="hs-h3">Corrections</h3><p class="lb">A grade changed after it was first given. The original stays in the pick’s receipt, and every change is also in the <button type="button" class="lk" data-page="status" data-arg="corrections" data-fk="hs-trust">public correction log</button>.</p><ul class="hs-vlist">${fixed.slice(0, 30).map(e => { const c = e.raw.corrections[e.raw.corrections.length - 1];
          return `<li><b>${esc(e.title)}</b> <span class="lb">${esc(STATE_NAME[c.from] || c.from || 'Not graded')} → ${esc(STATE_NAME[c.to] || c.to)}${c.fromActual || c.toActual ? ` (${esc(c.fromActual || '–')} → ${esc(c.toActual || '–')})` : ''} · ${esc(when(c.at))}${c.admin ? ' · by an administrator' : ' · automatic re-check'}</span>${c.why ? `<small>${esc(c.why)}</small>` : ''}</li>` }).join('')}</ul>` : ''}</section>` : ''}
      <section class="card hs-card" aria-labelledby="hs-every-h"><div class="sec-h"><h2 id="hs-every-h">Every pick</h2></div>
        <div class="cx-row scroll" role="radiogroup" aria-label="Show picks that are">${[['all', `All ${rows.length}`], ...STATES.filter(([k]) => byState[k]).map(([k, l]) => [k, `${l} ${byState[k]}`])].map(([k, l]) => `<button type="button" class="cx" role="radio" aria-checked="${Hs.res === k}" tabindex="${Hs.res === k ? 0 : -1}" data-hsres="${k}" data-fk="res-${k}">${esc(l)}</button>`).join('')}</div>
        ${list.length ? `<div class="tbx-wrap"><table class="tbx hs-list"><thead><tr><th scope="col">Start</th><th scope="col">Pick</th><th scope="col" class="r">We said</th><th scope="col" class="r">Market</th><th scope="col">Closing line</th><th scope="col">State</th><th scope="col"><span class="sr-only">Receipt</span></th></tr></thead><tbody>${list.slice(0, Hs.shown).map(row).join('')}</tbody></table></div>
          ${list.length > Hs.shown ? `<button type="button" class="bt ghost wide" data-hs="more" data-fk="more">Show ${Math.min(40, list.length - Hs.shown)} more of ${list.length}</button>` : ''}` : '<p class="lb">Nothing in this view.</p>'}</section>`}
      <details class="card hs-how"><summary>How the record is kept</summary>
        <p>A pick is saved the moment it is published, with the player, team, opponent, market, line, side, our chance, the market’s chance, any book price, the edge, the time and where the line came from. Those numbers are never replaced. Later readings are saved beside them, and they stop five minutes before the start, when the pick is locked.</p>
        <p>After the game, the grader reads the final score or the player’s game log (ESPN; MLB’s own log for baseball) and grades the pick on its original line. It runs on the Floodlight server and every hour on GitHub, which also keeps a copy so a site update can’t lose a pick. A day later it checks the result once more in case a stat was corrected; any change is listed in the pick’s correction history.</p>
        <p>Hit rate counts hits and misses only. A push, a void (did not play, or postponed) and a pick that could not be graded are listed but never counted as hits. Units pay 1 unit a pick at the book’s price when one was saved, else at the market’s chance with the margin removed. Test picks are never shown or counted. Soccer props aren’t graded yet. This is a record of research, not betting advice.</p></details>`;
    if (act) [...document.querySelectorAll('#pg-history [data-fk]')].find(x => x.dataset.fk === act)?.focus({ preventScroll: true });
  }
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#pg-history [data-hs],#pg-history [data-hssport],#pg-history [data-hsdays],#pg-history [data-hsres],#pg-history [data-hskind],#pg-history [data-hsby],#pg-history [data-hsrc]'); if (!t) return; const d = t.dataset;
    if (d.hssport) { Hs.sport = d.hssport; Hs.shown = 40 } else if (d.hsdays != null) { Hs.days = +d.hsdays; Hs.shown = 40 } else if (d.hsres) { Hs.res = d.hsres; Hs.shown = 40 }
    else if (d.hskind) { Hs.kind = d.hskind; Hs.shown = 40 } else if (d.hsby) Hs.by = d.hsby
    else if (d.hsrc) { Hs.open.has(d.hsrc) ? Hs.open.delete(d.hsrc) : Hs.open.add(d.hsrc) }
    else if (d.hs === 'more') Hs.shown += 40; else if (d.hs === 'reload') return load(true);
    draw();
  });
  // the "Record by" tabs move with the arrow keys
  document.addEventListener('keydown', ev => {
    const t = ev.target.closest?.('#pg-history [data-hsby]'); if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const ks = Object.keys(BY), i = ks.indexOf(Hs.by), n = ev.key === 'Home' ? 0 : ev.key === 'End' ? ks.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + ks.length) % ks.length;
    ev.preventDefault(); Hs.by = ks[n]; draw(); document.querySelector(`#pg-history [data-hsby="${ks[n]}"]`)?.focus();
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest?.('[data-hsfix]'); if (!f) return; ev.preventDefault();
    const msg = f.querySelector('[data-hsfixmsg]'), body = { kind: f.dataset.kind, key: f.dataset.hsfix, result: f.result.value, actual: f.actual.value.trim(), why: f.why.value.trim() };
    msg.textContent = 'Saving…';
    fetch('/api/admin/grade', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(d => ({ ok: r.ok, d }))).then(({ ok, d }) => { if (!ok) { msg.textContent = d.error || 'It wasn’t saved. Try again.'; return }
        msg.textContent = d.changed ? 'Saved. The correction is in the history and the public log.' : 'Nothing changed.'; window.flAdmin?.say?.('Grade corrected.'); load(true) })
      .catch(() => { msg.textContent = 'It wasn’t saved. Check the connection and try again.' });
  });
  window.flPages?.add('history', { title: 'Pick history', render, onShow() { load() } });
  window.flHistory = { stats, state: Hs, all, graded, verified, lockBadge, BY, MIN_RATE, EARLY, FULL, tier, load, summary, widget };
})();
