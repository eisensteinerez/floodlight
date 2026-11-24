/* Floodlight · Predictions: the edge board.
   Every pick here is one of two real things:
   - a player prop from the Lab's board (edge.js): "ours" is the Lab's heat reading for that side of the line, "market"
     is a two-sided book price at the same line with the margin taken out;
   - a match forecast the server has made (forecaster.py): "ours" is the forecast's chance for its pick, "market" is the
     book's chance for the same outcome with the margin taken out.
   Edge is always our number minus the market's, in whole points. A pick with no market price has no edge and is listed
   apart. Results come from two graded records: match forecasts (record.py) and player props (propbook.py). The props
   this page shows before their start are sent to the server once per load, which locks the first reading of each and
   grades it when the game is over. Nothing here changes how a number is worked out. */
(() => {
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const pct = x => Math.round(x * 100);
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(name)}</span></span>`;
  const SPORT_NAME = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer', cfb: 'College football' };
  const SPORT_ORDER = ['nba', 'nfl', 'nhl', 'mlb', 'wnba', 'soccer', 'cfb'];
  const WHEN = [['tonight', 'Tonight'], ['tomorrow', 'Tomorrow'], ['week', 'This week']];
  const MIN = [[0, 'Any'], [3, '3+'], [5, '5+'], [10, '10+']];
  // the default order is the supported edge: the raw gap with the market, cut down by what stands behind it (market.js)
  const SORT = [['edge', 'Best supported edge'], ['prob', 'Highest model probability'], ['evidence', 'Strongest evidence'], ['fresh', 'Freshest markets'], ['soon', 'Starting soon'], ['raw', 'Raw edge']];
  const GROUP = [['player', 'Best pick per player'], ['game', 'Best pick per game'], ['all', 'Show every market']];
  const KIND = [['all', 'Props and match results'], ['prop', 'Player props only'], ['match', 'Match results only']];
  const MK = window.flMarket;
  const STALE = MK.FRESH;        // a reading of the books older than this is "Using last verified price" (the server re-reads them every 15 minutes)
  const P = { sport: 'all', when: 'tonight', min: 0, sort: 'edge', props: null, matches: null, record: null, loading: false, at: 0, denied: false, all: false,
    open: new Set(), ev: new Map(), pending: new Set(), fcAt: 0, recAt: 0, fcError: '', recError: '', fcStatus: 0, srcOpen: false, retries: 0, retryT: 0,
    kind: 'all', priced: false, clean: false, mine: false, more: false, ctx: new Map(), ctxAsked: new Map(), group: 'player', grp: new Set(), fold: new Set(), gone: new Map(), wasOpen: new Map(), tz: MK.localTz(),
    slip: store.get('fl.slip', []), follow: store.get('fl.pdFollow', []), seen: store.get('fl.lineSeen', {}), tried: new Map(), slips: store.get('fl.slips', []), confirm: null, saved: 0, timer: 0 };

  /* ---------- data ---------- */
  const get = (url, ms = 20000) => Promise.race([fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || String(r.status)); e.status = r.status; throw e } return d }),
    new Promise((_, no) => setTimeout(() => no(new Error('It took too long to answer.')), ms))]);
  function matchPick(m) {
    const sport = m.sport === 'soccer' ? 'soccer' : m.lg === 'nfl' ? 'nfl' : 'cfb', draw = m.pick === 'draw', team = draw ? '' : m[m.pick] || '';
    const ours = m.probs?.[m.pick] ?? m.top, market = m.market?.[m.pick] ?? null, why = [];
    if (Array.isArray(m.score) && m.score.length === 2) why.push(`Model score ${m.score[0]}–${m.score[1]}`);
    if (Array.isArray(m.xg) && m.xg[0] != null && m.xg[1] != null) why.push(`Expected goals ${m.xg[0].toFixed(1)} v ${m.xg[1].toFixed(1)}`);
    if (m.margin != null && m.sport !== 'soccer') why.push(`${m.margin >= 0 ? m.home : m.away} by ${Math.abs(m.margin).toFixed(1)}`);
    if (m.ai) why.push('Includes the news check');
    return { id: 'match:' + m.key, type: 'match', sport, name: draw ? `${m.home} v ${m.away}` : team, team: '', photo: '', text: draw ? 'Draw' : 'To win', short: draw ? `${m.home} v ${m.away} draw` : `${team} to win`,
      ours, market, edge: market == null ? null : pct(ours) - pct(market), heat: null, conf: m.conf || '', reasons: why.slice(0, 3), start: new Date(m.ko * 1000),
      game: `${m.home} v ${m.away}`, gameKey: 'match:' + m.key, m };
  }
  const LAB_SPORTS = () => (window.flEdge?.SPORTS || []).map(x => x[0]);
  // everything in hand right now: each sport that has answered, or the reading kept from the last visit
  function gather() { const by = {}; for (const k of LAB_SPORTS()) { const r = window.flEdge.have(k); if (r) by[k] = r } P.props = { picks: Object.values(by).flatMap(r => r.picks), by } }
  /* Every source loads on its own and the page draws what it has as each one answers: match forecasts and the record
     take under a second, a sport's player lines can take twenty. A source that fails keeps its last reading (marked
     stale) and is tried again; nothing waits for the slowest one. */
  async function load(force) {
    if (P.loading) return; if (!force && P.at && Date.now() - P.at < 5 * 60000) return;
    clearTimeout(P.retryT); P.loading = true; P.pending = new Set([...LAB_SPORTS(), 'fc', 'rec']);
    const done = k => { P.pending.delete(k); if (window.flEdge) gather(); syncSlip(); draw() };
    if (window.flEdge) gather(); draw();
    const [props] = await Promise.all([
      window.flEdge ? window.flEdge.props(null, force, r => done(r.sport)) : Promise.resolve({ denied: false }),
      get('/api/forecast/list').then(d => { P.matches = (d.matches || []).map(matchPick); P.fcError = ''; P.fcStatus = 0; P.fcAt = Date.now() }, e => { P.matches = P.matches || []; P.fcError = e.message || 'It did not load.'; P.fcStatus = e.status || 0 }).then(() => done('fc')),
      recordLoad(force).then(() => done('rec')),
    ]);
    publish();
    P.denied = !!props.denied && (P.fcStatus === 401 || P.fcStatus === 403);
    P.loading = false; P.pending.clear(); P.at = Date.now(); draw();
    // something did not answer: try again by itself, twice, then leave it to the Retry button
    if (failed().length && !P.denied && P.retries < 2) { P.retries++; P.retryT = setTimeout(() => { if (window.flPages.current() === 'predictions' && !document.hidden) load(true) }, 20000 * P.retries) } else if (!failed().length) P.retries = 0;
  }
  /* Every prop shown on the board goes to the server's record (propbook.py), which keeps the first reading of each and
     the last one before the start. Only a prop that passed every check (market.js verify: a verified upcoming event,
     an open market, a player not ruled out) is sent, with what it was checked against: the event, the teams, the
     provider's market, the supported edge and the availability at that moment. Only what changed is sent again. */
  const sent = new Map();
  function publish() {
    const now = Date.now(), out = [];
    for (const p of (P.lastOpen || [])) {
      if (p.type !== 'prop' || p.v?.state !== 'open' || !p.start || p.start <= now) continue;
      const sig = `${p.side}:${p.line}:${Math.round(p.ours * 100)}:${p.market == null ? '' : Math.round(p.market * 100)}:${p.sedge ?? ''}`;
      if (sent.get(p.id) === sig) continue; sent.set(p.id, sig);
      const ev = p.v.event || {}, R = window.flEvidence?.propRange?.(p), offer = (p.offers || []).find(o => o.line === p.line) || {};
      out.push({ sport: p.sport, player: p.name, team: p.team, opp: ev.oppAbbr || p.opp, k: p.k, label: p.label, line: p.line, side: p.side, yes: p.yes, ours: +p.ours.toFixed(3),
        market: p.market == null ? null : +p.market.toFixed(3), conf: p.conf, start: Math.round(+p.start / 1000), books: p.books,
        proj: p.mu == null ? null : +(+p.mu).toFixed(2), hit: p.smp?.rate == null ? null : +p.smp.rate.toFixed(3), n: p.smp?.n || null,
        // the receipt's ids and the state at publication (the record keeps the first one it gets)
        event: ev.id || '', playerId: p.fid || '', teamId: ev.teamId || '', oppId: ev.oppId || '', league: p.sport, marketId: p.mid || offer.mid || `${offer.book || (p.books || [])[0] || ''}:${p.k}:${p.line}`, providerMarketId: offer.mid || '', grade: gradeOf(p)?.grade || null,
        provider: (p.books || []).map(b => BOOK[b] || b).join(', '), sedge: p.sedge, lo: R ? +R.lo.toFixed(3) : null, hi: R ? +R.hi.toFixed(3) : null,
        sources: [ev.verified === 'schedule' ? 'ESPN schedule' : 'Provider schedule', 'ESPN game log', ...(p.books || []).map(b => BOOK[b] || b), ...(p.av?.lv && p.av.lv !== 'unknown' ? ['ESPN injury report'] : [])],
        injury: p.av?.report || '', lineup: p.av?.start || '', verifiedAt: p.at || now, tz: P.tz });
    }
    for (let i = 0; i < out.length; i += 120)
      fetch('/api/props/seen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ props: out.slice(i, i + 120) }) }).catch(() => {});
  }
  /* ---------- freshness: what was read, when, and what did not answer ---------- */
  const BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' };
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 10 ? 'just now' : s < 60 ? `${s} seconds ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago` };
  const agoTag = t => t ? `<time data-pdago="${+t}" datetime="${new Date(t).toISOString()}" title="${esc(new Date(t).toLocaleString())}">${ago(t)}</time>` : '–';
  function sources() {   // one row per source: { key, name, from, at, state: 'ok' | 'loading' | 'stale' | 'failed' | 'off', note }
    const now = Date.now(), rows = LAB_SPORTS().map(k => { const r = P.props?.by?.[k], wait = P.pending.has(k), down = Object.keys(r?.errors || {}).map(b => BOOK[b] || b);
      const off = r && (r.status === 401 || r.status === 403);
      const state = off ? 'off' : r?.error ? (r.at ? 'stale' : 'failed') : !r ? (wait ? 'loading' : 'failed') : r.kept && wait ? 'loading' : now - r.at > STALE ? 'stale' : 'ok';
      const books = [...new Set((r?.picks || []).flatMap(p => p.books || []))].map(b => BOOK[b] || b);
      return { key: k, name: `${SPORT_NAME[k] || k} player lines`, from: books.join(', ') || (down.length ? '' : 'PrizePicks, Sleeper'), at: r?.at || 0, state, n: r?.picks?.length || 0, checked: r?.checked || 0,
        note: [r?.error && !off ? `Did not answer${r.at ? ', so this is the last reading' : ''}: ${r.error}` : '', down.length ? `${down.join(' and ')} did not answer` : '', r && !r.error && !r.picks.length && !down.length ? 'No lines posted today' : ''].filter(Boolean).join('. ') } });
    rows.push({ key: 'fc', name: 'Match forecasts', from: 'Floodlight forecast model, with book prices', at: P.fcAt, state: P.fcError ? (P.fcAt ? 'stale' : 'failed') : P.pending.has('fc') && !P.fcAt ? 'loading' : 'ok', n: (P.matches || []).length, note: P.fcError ? `Did not answer: ${P.fcError}` : '' });
    rows.push({ key: 'rec', name: 'Graded results', from: 'Floodlight record of finished matches and props', at: P.recAt, state: P.recError ? (P.recAt ? 'stale' : 'failed') : P.pending.has('rec') && !P.recAt ? 'loading' : 'ok', n: (P.record || []).length + (P.propRec || []).length, note: P.recError ? `Did not answer: ${P.recError}` : '' });
    return rows;
  }
  const failed = () => sources().filter(x => x.state === 'failed' || (x.state === 'stale' && x.note));
  // one word set for a source everywhere: Updated, Checking, Using last verified price, Temporarily unavailable
  const STATE_TXT = { ok: 'Updated', loading: 'Checking…', stale: 'Using last verified price', failed: 'Temporarily unavailable', off: 'Not in your access' };
  /* What the sources say, in one sentence (item 21): how many price sources updated, which ones are delayed by name,
     when we checked, and whether the board is safe to use. Everything else sits in the panel the indicator opens. */
  const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function health() {
    const src = sources().filter(x => x.key !== 'rec' && x.state !== 'off'), wait = src.filter(x => x.state === 'loading');
    const part = src.filter(x => x.state === 'ok' && /did not answer/.test(x.note));
    const late = src.filter(x => x.state === 'failed' || x.state === 'stale');
    // the books that did not answer inside a sport that otherwise did, named once each
    const books = [...new Set(part.flatMap(x => (x.note.match(/^(.*) did not answer/) || [, ''])[1].split(' and ').filter(Boolean)))];
    const names = [...late.map(x => x.key === 'fc' ? 'match forecasts' : x.name.replace(' player lines', ' lines')), ...books];
    const oldest = late.filter(x => x.at).reduce((a, x) => Math.min(a, x.at), Infinity);
    const safe = !late.some(x => x.state === 'stale' && x.at && Date.now() - x.at > 2 * STALE);
    return { src, wait, total: src.length, late, part, names, books, oldest, safe,
      bad: late.length > 0 || books.length > 0, last: Math.max(0, ...src.filter(x => x.state === 'ok').map(x => x.at || 0)) };
  }
  function healthText(h) {
    if (!h.bad) return { head: 'All sources updated', sub: `${h.total} of ${h.total} price sources answered.` };
    const lst = xs => xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
    const updated = h.total - h.late.length;
    const head = `Some sources delayed: ${updated} of ${h.total} updated`;
    const who = h.names.length ? `${lst(h.names.map((x, i) => i ? x : x.charAt(0).toUpperCase() + x.slice(1)))} ${h.names.length === 1 ? 'is' : 'are'} temporarily delayed.` : 'Some market prices are delayed.';
    return { head, sub: `${who} Picks on a delayed source show their last verified price and rank lower.` };
  }
  const srcNote = x => x.state === 'failed' ? 'No answer yet; it is tried again by itself' : x.state === 'stale' && x.at ? 'Using the last verified price' : x.note.replace(/ did not answer/g, ' delayed');
  // the picks on the board that rest on a delayed source's old price, by name
  const staleUsers = x => (P.lastOpen || []).filter(p => p.type === 'prop' && p.sport === x.key && p.v?.price === 'stale');
  const usersNote = x => { const u = staleUsers(x); if (!u.length) return ''; const names = u.slice(0, 4).map(p => `${p.name} ${p.text.toLowerCase()}`);
    return `<small class="pd-s-use">Uses this old price: ${esc(names.join('; '))}${u.length > 4 ? ` and ${u.length - 4} more` : ''}</small>` };
  function drawFresh() {
    const stat = $('pdStat'), el = $('pdFresh'); if (!stat || !el) return;
    if (P.denied) { stat.innerHTML = ''; el.innerHTML = ''; return }
    const h = health(), T = healthText(h);
    const short = P.loading ? `Checking ${h.wait.length ? h.wait.length + ' ' + (h.wait.length === 1 ? 'source' : 'sources') : 'the books'}…`
      : !h.last && !h.late.some(x => x.at) ? 'Nothing has loaded yet' : `Updated ${P.at ? `<span data-pdago="${P.at}">${ago(P.at)}</span>` : 'just now'}${h.bad ? ' · Some sources delayed' : ''}`;
    stat.innerHTML = `<button type="button" class="pd-stat${h.bad ? ' warn' : ''}" data-pd="src" data-fk="src" aria-expanded="${P.srcOpen}" aria-controls="pdFresh">${P.loading ? '<span class="pd-spin" aria-hidden="true"></span>' : `<span class="pd-dot${h.bad || !h.last ? ' warn' : ''}" aria-hidden="true"></span>`}<span>${short}</span><span class="sr-only">. Show the price sources</span></button>`;
    if (!P.srcOpen) { el.innerHTML = ''; el.hidden = true; return }
    el.hidden = false;
    const src = sources();
    el.innerHTML = `<div class="card pd-srcp" role="region" aria-label="Price sources">
        <div class="pd-srcp-h"><span class="rw-t"><b>${esc(T.head)}</b>${T.sub ? `<small>${esc(T.sub)}</small>` : ''}</span><button type="button" class="bt ghost sm" data-pd="reload" data-fk="reload-top"${P.loading ? ' disabled' : ''}>${h.bad ? 'Retry' : 'Refresh'}</button></div>
        <p class="pd-srcp-m"><span>Checked ${P.at ? esc(clock(P.at)) : '–'}</span><span class="pd-safe ${h.safe ? 'ok' : 'warn'}">${h.safe ? 'Every pick shows when its price was last verified' : `Some prices are from ${esc(clock(h.oldest))}; those picks are marked and rank lower`}</span></p>
        <div class="tbx-wrap"><table class="tbx"><caption class="sr-only">Every source, when it was read and its status</caption><thead><tr><th scope="col">Source</th><th scope="col">Read from</th><th scope="col" class="r">Picks</th><th scope="col">Last read</th><th scope="col">Status</th></tr></thead>
          <tbody>${src.map(x => `<tr class="pd-s-${x.state}"><th scope="row">${esc(x.name)}</th><td>${esc(x.from || '–')}${srcNote(x) ? `<small class="pd-s-note">${esc(srcNote(x))}</small>` : ''}${usersNote(x)}</td><td class="r num">${x.state === 'loading' && !x.at ? '–' : x.n}</td><td>${x.at ? agoTag(x.at) : '–'}</td><td><span class="pd-st ${x.state}">${STATE_TXT[x.state]}</span></td></tr>`).join('')}</tbody></table></div>
        <p class="lb">Player lines are read from the pick’em apps at most every 15 minutes, so a line can be up to 15 minutes behind the app. A price older than 30 minutes shows as “Using last verified price” and its supported edge is cut; after 90 minutes the pick leaves the board until it is verified again. A line whose game has started or closed never shows an update time.</p></div>`;
  }
  const allPicks = () => [...(P.props?.picks || []).map(p => ({ ...p, short: `${p.name.split(' ').slice(-1)[0]} ${p.text.toLowerCase()}` })), ...(P.matches || [])];
  /* ---------- the checks behind every pick (market.js), run on every draw ----------
     Every draw re-checks every pick against the clock, the league schedule, the injury report and the age of its price,
     so the board is checked on first load, after each refresh, at local midnight, when the tab comes back, when a
     provider answers, when a schedule changes and the moment a listed game starts. */
  const SCHED = { nba: 'basketball/nba', wnba: 'basketball/wnba', nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
  const ymd = (t, tz) => MK.dayKey(t, tz).replace(/-/g, '');
  const SCHED_TTL = 2 * 60000;   // a day's schedule is read again after two minutes, so a start, a delay or a final reaches the board
  function schedDay(sport, day) {
    const key = `${sport}:${day}`, have = P.ctx.get(key), asked = P.ctxAsked.get(key) || 0;
    if ((!have || Date.now() - have.at > SCHED_TTL) && Date.now() - asked > 20000 && window.flSched) {
      P.ctxAsked.set(key, Date.now());
      window.flSched.day({ path: SCHED[sport], day }, !!have).then(r => { P.ctx.set(key, { at: Date.now(), status: r.status === 'error' ? (have?.status === 'ready' ? 'ready' : 'error') : 'ready', games: r.status === 'error' ? (have?.games || []) : r.games || [] }); redraw() },
        () => { P.ctx.set(key, { at: Date.now(), status: have?.status === 'ready' ? 'ready' : 'error', games: have?.games || [] }); redraw() });
    }
    return have || null;
  }
  /* the schedule for a pick: the day of its start in the viewer's zone and in New York (ESPN's days), or, with no start
     time, today and tomorrow. Loading until one of the days answers. */
  function schedFor(p, now) {
    if (!SCHED[p.sport] || !window.flSched) return { status: 'none' };
    const days = p.start ? [ymd(+p.start, P.tz), ymd(+p.start, 'America/New_York')] : [ymd(now, P.tz), ymd(now + 864e5, P.tz), ymd(now, 'America/New_York')];
    const recs = [...new Set(days)].map(d => schedDay(p.sport, d));
    if (recs.some(r => !r)) return recs.some(r => r && r.status === 'ready') && recs.filter(r => !r).length < recs.length ? { status: 'ready', events: dedupe(recs) } : { status: 'loading' };
    return recs.every(r => r.status === 'error') ? { status: 'error' } : { status: 'ready', events: dedupe(recs) };
  }
  const dedupe = recs => { const m = new Map(); for (const r of recs) for (const e of r?.games || []) m.set(e.id, e); return [...m.values()] };
  const injAsked = new Map();   // sport -> when the report was last asked for, so a report that fails is not asked for on every redraw
  function injury(p) {
    const I = window.flInjuries; if (p.type !== 'prop' || !I?.PATH?.[p.sport]) return { ready: false, st: null };
    if (!I.ready(p.sport)) { const t = injAsked.get(p.sport) || 0; if (Date.now() - t > 5 * 60000) { injAsked.set(p.sport, Date.now()); I.load(p.sport) } return { ready: false, st: null } }
    return { ready: true, st: I.status(p.sport, p.name) };
  }
  function roleUncertain(p) {
    const ms = (p.games || []).slice(0, 5).map(g => g.min).filter(m => m != null); if (ms.length < 4) return false;
    const m = ms.reduce((a, b) => a + b, 0) / ms.length; return m > 0 && Math.sqrt(ms.reduce((a, x) => a + (x - m) ** 2, 0) / ms.length) / m > .25;
  }
  // one pick with its checks: the verdict, the start and matchup from the schedule, the sample, availability and the supported edge
  function enrich(p, now) {
    const inj = injury(p), v = MK.verify(p, { now, tz: P.tz, sched: p.type === 'prop' ? schedFor(p, now) : { status: 'none' }, injury: inj.st });
    const start = v.start ? new Date(v.start) : p.start || null;
    const q = { ...p, v, start, eventId: v.event?.id || '' };
    if (p.type === 'prop') { q.smp = MK.sample(p.games, p.line, p.side, p.yes); q.av = MK.availability(inj.st, inj.ready, { uncertain: roleUncertain(p) }) }
    const S = MK.supported(q, { now, verdict: v, injury: inj.st, moved: moved(p) });
    q.sedge = S.edge; q.support = S.factor; q.cut = S.reasons; q.strength = S.strength;
    return q;
  }
  const dayStart = (d, add = 0) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + add); return x };
  function inWhen(p, now) {
    const d = MK.dayDiff(+p.start, now, P.tz);
    return P.when === 'tonight' ? d === 0 : P.when === 'tomorrow' ? d === 1 : d >= 0 && d < 7;
  }
  const time = d => d ? MK.when(+d, Date.now(), P.tz) : 'Time to be confirmed';
  // a pick taken off the board is kept here with its state for the rest of the visit (and its result lands in Pick history)
  function retire(p, why, label, text) {
    const k = keyOf(p); if (P.gone.has(k)) return;
    P.gone.set(k, { k, name: p.name, text: p.text, sport: p.sport, game: p.game || '', start: p.start ? +p.start : 0, label, why, note: text, at: Date.now() });
    if (P.gone.size > 60) P.gone.delete(P.gone.keys().next().value);
  }
  P.readAt = {};
  function lists() {
    const now = Date.now(), all = allPicks().map(p => enrich(p, now));
    // checked on every draw: what closed since the last one, and the lines a fresh reading no longer has
    for (const p of all) if (p.v.state === 'closed') retire(p, p.v.why, p.v.label, p.v.text);
    const answered = new Set(Object.values(P.props?.by || {}).filter(r => !r.error && !r.kept && r.at && r.at !== P.readAt[r.sport]).map(r => r.sport));
    if (answered.size) { for (const p of MK.withdrawn(P.wasOpen, all.filter(p => p.type === 'prop'), answered)) retire(p, 'withdrawn', MK.GONE.withdrawn, 'The provider stopped offering this line'); for (const r of Object.values(P.props?.by || {})) if (answered.has(r.sport)) P.readAt[r.sport] = r.at }
    P.wasOpen = new Map(all.filter(p => p.type === 'prop' && p.v.state === 'open').map(p => [keyOf(p), p]));
    const by = all.filter(p => (P.sport === 'all' || p.sport === P.sport) && (P.kind === 'all' || p.type === P.kind) && (!P.mine || following(p)) && (!P.clean || !warnsOf(p).length));
    const open = by.filter(p => p.v.state === 'open'), pre = open.filter(p => inWhen(p, now));
    const ranked = pre.filter(p => p.sedge != null && p.sedge >= P.min).sort(MK.SORTS[P.sort] || MK.SORTS.edge);
    const bare = P.min > 0 || P.priced ? [] : pre.filter(p => p.edge == null).sort(P.sort === 'soon' ? MK.SORTS.soon : (a, b) => b.ours - a.ours);
    // the markets the verified service took off (markets.py): never cards, listed with their status and reason
    const srv = Object.values(P.props?.by || {}).flatMap(r => (r.removed || []).map(x => ({ ...x, sport: r.sport }))).filter(x => P.sport === 'all' || x.sport === P.sport);
    const rtext = x => x.label ? `${x.side === 'under' ? 'Under' : 'Over'} ${window.flEdge?.fmt ? window.flEdge.fmt(x.line) : x.line} ${String(x.label).toLowerCase()}` : '';
    const incomplete = [...by.filter(p => p.v.state === 'incomplete'), ...srv.filter(x => MK.STATUS_STATE[x.status] === 'incomplete' && P.kind !== 'match')
      .map(x => ({ id: x.mid, name: x.player, text: rtext(x), sport: x.sport, start: x.start ? new Date(x.start) : null, v: { text: `${x.statusLabel}: ${x.reason}` } }))];
    const checking = by.filter(p => p.v.state === 'checking');
    for (const x of srv) if (MK.STATUS_STATE[x.status] === 'closed' && !P.gone.has(x.mid) && P.kind !== 'match')
      P.gone.set(x.mid, { k: x.mid, name: x.player, text: rtext(x), sport: x.sport, game: x.opp ? `v ${x.opp}` : '', start: x.start ? Date.parse(x.start) || 0 : 0, label: MK.STATUS_LABEL[x.status] || x.statusLabel, why: x.status, note: x.reason, at: Date.now() });
    P.lastOpen = all.filter(p => p.v.state === 'open');
    const done = (P.record || []).filter(e => ['won', 'lost'].includes(e.result) && e.ko * 1000 > now - 27 * 3600e3 && (P.sport === 'all' || (e.sport === 'soccer' ? 'soccer' : e.lg === 'nfl' ? 'nfl' : 'cfb') === P.sport)).sort((a, b) => b.ko - a.ko);
    const gone = [...P.gone.values()].filter(g => P.sport === 'all' || g.sport === P.sport).sort((a, b) => b.at - a.at);
    return { all, every: all, open, ranked, groups: MK.arrange(ranked, P.group), bare, incomplete, checking, gone, done, sports: SPORT_ORDER.filter(s => all.some(p => p.sport === s)) };
  }
  /* the next moment the board must change by itself: the next start among the picks shown, or local midnight */
  let tickT = 0;
  function arm(L) {
    clearTimeout(tickT); const now = Date.now();
    const next = Math.min(...(L.open || []).map(p => +p.start).filter(t => t > now), now + MK.toMidnight(now, P.tz) + 1000);
    tickT = setTimeout(() => { if (window.flPages.current() === 'predictions' && !document.hidden) draw() }, Math.max(1000, Math.min(next - now + 500, 2 ** 31 - 1)));
  }
  let rdT = 0; const redraw = () => { clearTimeout(rdT); rdT = setTimeout(() => { if ($('pdBoard')) draw() }, 120) };

  /* ---------- the page ---------- */
  const DEFS = `<dl class="pd-dl">
        <div><dt>Floodlight’s chance</dt><dd>Our projection for this side of the line, from past games with the recent ones counting more. It is the number we stand behind.</dd></div>
        <div><dt>Market’s chance</dt><dd>What the app’s price says, with its margin taken out. Shown only where an app posts both sides.</dd></div>
        <div><dt>Hit rate</dt><dd>What actually happened: how often this side came in over recent games. It feeds our chance but is not the same thing.</dd></div>
        <div><dt>Raw and supported edge</dt><dd>The raw edge is the gap between our chance and the market’s. The supported edge is that gap cut down by what stands behind it: how many games, how recent, whether the matchup is confirmed, the injury report, role and minutes, how fresh the price is and how many providers post it. The board ranks by supported edge; each pick’s evidence shows both and why they differ.</dd></div>
        <div><dt>Things to weigh</dt><dd>A card shows the most important one, such as Small sample · 7 games. Open the pick to read every one.</dd></div>
        <div><dt>Only verified games</dt><dd>A pick is on the board only while its game is on the league schedule, has not started, and the provider still offers the line. Lines without a confirmed game are listed under Incomplete markets; lines whose game started or closed move to Taken off the board.</dd></div></dl>`;
  function render(el) {
    el.innerHTML = `<div class="vst pd">
      <header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Predictions</h1><p class="pg-sub">Where our numbers disagree with the market, ranked by supported edge.</p></div>${window.flHelp?.button ? window.flHelp.button('predictions') : ''}</header>
      <div class="pd-filters" id="pdFilters"></div>
      <div class="pd-fresh" id="pdFresh" hidden></div>
      ${window.flHelp?.panel ? window.flHelp.panel('predictions', 'What the numbers on a pick mean', DEFS) : ''}
      <div class="g2 pd-cols"><div class="vst pd-board" id="pdBoard" aria-live="polite"></div><aside class="vst pd-side" id="pdSide" aria-label="Your slip and our results"></aside></div>
      <p class="lb pd-note">These are estimates from past games and posted prices, not guarantees. <a class="lk" href="#/guide/predictions" data-page="guide" data-arg="predictions">How we work out an edge</a></p>
      ${window.flHelp?.panel ? '' : `<details class="pd-defs"><summary>What the numbers on a pick mean</summary>${DEFS}</details>`}
      <section class="card pd-more" aria-label="More prediction tools"><div class="sec-h"><h2>More prediction tools</h2></div>
        <div class="cx-row"><button type="button" class="cx" data-pd="soccer">${ic('soccer', 18)}Soccer picks, match by match</button><button type="button" class="cx" data-page="history">${ic('trophy', 18)}Pick history: every hit and miss</button><button type="button" class="cx" data-page="injuries">${ic('help', 18)}Injuries and lineups</button><button type="button" class="cx" data-shell="lab">${ic('lab', 18)}Open the Lab</button></div></section>
    </div>`;
    draw();
  }
  function keep(fn) {   // repaint without losing the keyboard's place
    const a = document.activeElement, k = a?.closest?.('[data-fk]')?.dataset.fk; fn();
    if (k) { const b = [...document.querySelectorAll('#pg-predictions [data-fk]')].find(x => x.dataset.fk === k); b?.focus({ preventScroll: true }) }
  }
  let pubT = 0;
  function draw() { if (!$('pdBoard')) return; keep(() => { const L = lists(); drawFilters(L); drawFresh(); drawBoard(L); drawSide(L); restoreTried(); arm(L) }); clearTimeout(pubT); pubT = setTimeout(publish, 1500) }
  // a line tried on an open evidence chart stays tried through refreshes, filter and sort changes
  function restoreTried() { for (const [k, v] of P.tried) { const box = document.querySelector(`#pg-predictions [data-pdk="${CSS.escape(k)}"] .ev-log`); if (box && window.flEvidence?.setLine) window.flEvidence.setLine(box, v) } }
  document.addEventListener('input', e => { const r = e.target.closest?.('#pg-predictions [data-evline]'); if (!r) return; const k = r.closest('[data-pdk]')?.dataset.pdk; if (k) P.tried.set(k, +r.value) });
  document.addEventListener('fl:lm', () => { if (P.open.size && !document.getElementById('pg-predictions')?.hidden) draw() });   // a price history landed (linemove.js)

  /* One compact bar: Sport | Date | Edge | Sort, then More filters (what to show, how to group), then one small sources indicator. */
  const moreCount = () => [P.kind !== 'all', P.group !== 'player', P.priced, P.clean, P.mine].filter(Boolean).length;
  function drawFilters(L) {
    const count = sp => L.open.filter(p => sp === 'all' || p.sport === sp).length;
    const sel = (key, label, opts, cur) => `<label class="pd-fs"><span class="pd-fs-l" id="pdF-${key}">${label}</span><select class="inp sm" data-pdsel="${key}" data-fk="sel-${key}" aria-labelledby="pdF-${key}">${opts.map(([k, l]) => `<option value="${k}"${String(cur) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const sports = [['all', `All${P.loading && !count('all') ? '' : ` (${count('all')})`}`], ...L.sports.map(sp => [sp, `${SPORT_NAME[sp]} (${count(sp)})`])];
    if (P.sport !== 'all' && !L.sports.includes(P.sport)) sports.push([P.sport, `${SPORT_NAME[P.sport] || P.sport} (0)`]);
    const n = moreCount(), chk = (k, l) => `<label class="pd-chk"><input type="checkbox" data-pdchk="${k}" data-fk="chk-${k}"${P[k] ? ' checked' : ''}><span>${esc(l)}</span></label>`;
    $('pdFilters').innerHTML = `<div class="pd-fbar" role="group" aria-label="Filter the picks">
        ${sel('sport', 'Sport', sports, P.sport)}${sel('when', 'Date', WHEN, P.when)}${sel('min', 'Edge', MIN, P.min)}${sel('sort', 'Sort', SORT, P.sort)}
        <button type="button" class="bt ghost sm pd-morebtn" data-pd="more" data-fk="more" aria-expanded="${P.more}" aria-controls="pdMore">More filters${n ? ` <span class="pd-n num">${n}</span>` : ''}<svg class="pd-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <span class="pd-fbar-end" id="pdStat"></span></div>
      <div class="pd-more-f" id="pdMore"${P.more ? '' : ' hidden'}>
        ${sel('kind', 'Show', KIND, P.kind)}${sel('group', 'Display', GROUP, P.group)}
        <fieldset class="pd-chks"><legend class="sr-only">Narrow the board</legend>${chk('priced', 'Only picks with a market price')}${chk('clean', 'Hide picks with an uncertainty warning')}${chk('mine', 'Only picks I follow')}</fieldset>
        ${n ? `<button type="button" class="lk" data-pd="clear" data-fk="clear-more">Clear all filters</button>` : ''}
      </div>`;
  }

  const inSlip = id => P.slip.some(l => l.id === id);
  const edgeTxt = e => e == null ? '–' : (e > 0 ? '+' : e < 0 ? '−' : '') + Math.abs(e);
  // a pick's own key: a prop keeps it when its line moves, so its open evidence, a follow and the first sighting survive
  const keyOf = p => p.sk || p.id;
  const fmtL = v => Number.isInteger(v) ? String(v) : (+v).toFixed(1);
  /* The line moved: the first line and price this browser saw for a pick today, against now. Kept for a day. */
  function sight(picks) {
    const now = Date.now(); let ch = false;
    for (const k of Object.keys(P.seen)) if (now - P.seen[k].at > 864e5) { delete P.seen[k]; ch = true }
    for (const p of picks) { if (p.type !== 'prop' || P.seen[keyOf(p)]) continue; P.seen[keyOf(p)] = { line: p.line, side: p.side, market: p.market, at: now }; ch = true }
    if (ch) store.set('fl.lineSeen', P.seen);
  }
  function moved(p) {
    const f = P.seen[keyOf(p)]; if (!f || p.type !== 'prop') return null;
    if (f.line !== p.line) return { kind: 'line', from: f.line, to: p.line, at: f.at, txt: `Line ${fmtL(f.line)} → ${fmtL(p.line)}`, say: `The line moved from ${fmtL(f.line)} to ${fmtL(p.line)} since you first saw it at ${time(new Date(f.at))}.` };
    if (f.market != null && p.market != null && f.side === p.side && Math.abs(pct(p.market) - pct(f.market)) >= 4) return { kind: 'price', from: f.market, to: p.market, at: f.at, txt: `Price ${pct(f.market)}% → ${pct(p.market)}%`, say: `The market's chance moved from ${pct(f.market)}% to ${pct(p.market)}% since you first saw it at ${time(new Date(f.at))}.` };
    return null;
  }
  /* Following a pick, with an optional alert when its edge reaches a number. Kept in this browser. */
  const following = p => P.follow.find(f => f.k === keyOf(p));
  const saveFollow = () => store.set('fl.pdFollow', P.follow.slice(-60));
  function follow(p) {
    if (following(p)) P.follow = P.follow.filter(f => f.k !== keyOf(p));
    else { P.follow.push({ k: keyOf(p), id: p.id, name: p.name, text: p.text, sport: p.sport, game: p.game || '', start: p.start ? +p.start : 0, edge: p.edge, at: Date.now(), alert: null }); try { window.flTrack?.('prediction_follow', { sport: p.sport }) } catch (e) {} }
    saveFollow(); draw();
  }
  function checkAlerts() {
    if (!P.follow.length) return; const live = new Map(allPicks().map(p => [keyOf(p), p])); let ch = false;
    for (const f of P.follow) {
      const p = live.get(f.k); if (!p) continue;
      if (f.line === undefined) { f.line = p.line ?? null; ch = true }
      if (f.alert != null && p.edge >= f.alert && (f.edge == null || f.edge < f.alert)) say(`${p.name}: the edge reached ${edgeTxt(p.edge)}`, `${p.text}. You asked to hear at ${edgeTxt(f.alert)}.`, p);
      if (f.line != null && p.line != null && p.line !== f.line && pickAlert('line')) say(`${p.name}: the line moved ${fmtL(f.line)} to ${fmtL(p.line)}`, `${p.text}. Edge now ${edgeTxt(p.edge)}.`, p, 'line');
      if (f.line !== p.line) { f.line = p.line; ch = true }
      if (p.edge != null && (f.edge !== p.edge || f.id !== p.id || f.text !== p.text)) { f.edge = p.edge; f.id = p.id; f.text = p.text; ch = true }
    }
    if (ch) saveFollow();
  }
  function say(title, body, p, kind = 'edge') {
    if (window.flAlerts?.quiet?.()) return toastOnly(title, body);
    try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body, tag: `fl-${kind}-` + (p.id || p.name), icon: '/icons/icon-192.png' }); n.onclick = () => { window.focus(); window.flPages?.show?.('predictions'); n.close() }; return } } catch (e) {}
    toastOnly(title, body);
  }
  function toastOnly(title, body) {
    const host = $('toasts'); if (!host) return;
    const t = document.createElement('button'); t.type = 'button'; t.className = 'toast fl-toast al-toast';
    t.innerHTML = `<span><b>${esc(title)}</b><small>${esc(body)}</small></span>`; t.addEventListener('click', () => t.remove());
    host.appendChild(t); setTimeout(() => t.classList.add('out'), 9500); setTimeout(() => t.remove(), 10000);
  }
  document.addEventListener('fl:board', () => { gather(); sight(P.props?.picks || []); checkAlerts(); if (window.flPages.current() === 'predictions') redraw() });
  // an open evidence panel fills in its line history and injury report once they arrive (evidence.js, injuries.js)
  let evT = 0;
  const evRedraw = () => { if (!P.open.size || !$('pdBoard')) return; clearTimeout(evT); evT = setTimeout(draw, 60) };
  document.addEventListener('fl:evidence', evRedraw);
  document.addEventListener('fl:injuries', () => { if ($('pdBoard') && window.flPages.current() === 'predictions') { clearTimeout(evT); evT = setTimeout(draw, 60) } checkInjuries() });
  /* alerts for the picks you follow: injury news on the player, a line move, and the result once it is graded */
  const pickAlert = kind => window.flAlerts?.pick?.(kind);
  function checkInjuries() {
    const I = window.flInjuries; if (!I || !P.follow.length || !pickAlert('injury')) return; let ch = false;
    for (const f of P.follow) {
      if (!f.sport || !I.ready(f.sport) || (f.start && Date.now() > f.start)) continue;
      const st = I.status(f.sport, f.name), now = st ? (st.status || I.LEVEL_NAME[st.lv]) : '';
      if (f.inj === undefined) { f.inj = now; ch = true; continue }   // the first look only sets the baseline
      if (now !== f.inj) { say(`${f.name}: ${now ? `now ${now}` : 'off the injury report'}`, `${f.text}. ${st?.what ? st.what + '. ' : ''}From the league injury report.`, { id: f.id, name: f.name, text: f.text }, 'inj'); f.inj = now; ch = true }
    }
    if (ch) saveFollow();
  }
  async function checkResults() {
    if (!P.follow.length || !pickAlert('result')) return;
    const due = P.follow.filter(f => f.start && Date.now() - f.start > 3 * 3600e3 && Date.now() - f.start < 4 * 86400e3 && !f.told); if (!due.length) return;
    let d; try { d = await fetch('/api/props/record', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null) } catch { return } if (!d) return;
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); let ch = false;
    for (const f of due) {
      const e = (d.entries || []).find(e => norm(e.player) === norm(f.name) && Math.abs(e.start * 1000 - f.start) < 6 * 3600e3 && ['won', 'lost', 'push', 'void'].includes(e.result)); if (!e) continue;
      say(`${f.name}: ${{ won: 'hit', lost: 'missed', push: 'push', void: 'void' }[e.result]}${e.actual ? ` (${e.actual})` : ''}`, `${f.text}. Graded from the game log; the receipt is in Pick history.`, { id: f.id, name: f.name, text: f.text }, 'res');
      f.told = true; ch = true;
    }
    if (ch) saveFollow();
  }
  setInterval(() => { if (!P.follow.length) return; [...new Set(P.follow.map(f => f.sport))].forEach(sp => window.flInjuries?.load(sp)); checkResults() }, 10 * 60000);
  setTimeout(() => { [...new Set(P.follow.map(f => f.sport))].forEach(sp => window.flInjuries?.load(sp)); checkResults() }, 8000);
  /* ---------- the game behind a pick: the verified event, its start, the provider and when its price was verified ---------- */
  const tm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // "Browns vs Steelers": the two teams of the verified event; a match forecast names both sides
  function matchup(p) {
    if (p.type === 'match') return `${esc(p.m.home)} vs ${esc(p.m.away)}`;
    const e = p.v?.event; const us = e?.team || p.teamName || p.team, them = e?.opp || p.opp;
    return them ? `${esc(us || '')} vs ${esc(them)}` : esc(us || '');
  }
  // "PrizePicks · verified 2 min ago"; an old price says so; a line with no two-sided price says that
  function provider(p) {
    if (p.type === 'match') return P.fcAt ? `Forecast with book prices · verified ${agoTag(P.fcAt)}` : 'Forecast with book prices';
    const names = (p.books || []).map(b => BOOK[b] || b).join(', ') || 'Provider';
    if (p.v?.price === 'stale') return `<span class="pd-stale">${esc(names)} · using last verified price, ${agoTag(p.at)}</span>`;
    return `${esc(names)} · verified ${agoTag(p.at)}${p.market == null ? ' · <span class="lb">no verified market price</span>' : ''}`;
  }
  /* uncertainty, in neutral words, most important first. The card shows the first; the evidence lists all of them. */
  const WARN_ORDER = ['Listed out', 'Doubtful to play', 'Questionable to play', 'Day to day', 'Possible data mismatch', 'Matchup from the provider only', 'Using last verified price', 'Recently transferred', 'Long break', 'Role changed recently', 'Minutes vary', 'Small sample', 'Providers differ', 'Model and market differ', 'Opponent unknown', 'Few games against', 'Line moved', 'Probable'];
  const warnRank = t => { const i = WARN_ORDER.findIndex(w => t.startsWith(w)); return i < 0 ? 50 : i };
  const warnMemo = new Map();
  function warnsOf(p) {
    const mk = `${p.id}|${p.at}|${p.v?.price}|${p.av?.lv}|${p.line}`; if (warnMemo.has(mk)) return warnMemo.get(mk);
    let out = []; try { out = window.flEvidence?.flags ? window.flEvidence.flags(p) : [] } catch (e) { out = [] }
    const mv = moved(p); if (mv && ((mv.kind === 'line' && Math.abs(mv.to - mv.from) >= 1) || (mv.kind === 'price' && Math.abs(pct(mv.to) - pct(mv.from)) >= 8)) && !out.some(([t]) => t.startsWith('Line moved'))) out.push([mv.kind === 'line' ? `Line moved ${fmtL(Math.abs(mv.to - mv.from))}` : 'Line moved', mv.say]);
    if (p.v?.price === 'stale') out.push(['Using last verified price', `${(p.books || []).map(b => BOOK[b] || b).join(', ') || 'The provider'} did not answer the last check, so this price is from ${ago(p.at)}. The supported edge is cut for it.`]);
    if (p.v?.event?.verified === 'provider') out.push(['Matchup from the provider only', 'No league schedule is read for this sport, so the start time and opponent come from the provider.']);
    if (p.av?.tag && !out.some(([t]) => t === p.av.tag)) out.push([p.av.tag, `${p.av.report}. ${p.av.start}.`]);
    out = out.filter(([t]) => t !== 'Back-to-back' && t !== 'No market price').sort((a, b) => warnRank(a[0]) - warnRank(b[0]));
    if (warnMemo.size > 800) warnMemo.clear(); warnMemo.set(mk, out); return out;
  }
  // a started pick that is in the record with its first reading saved before the start: "Locked before start"
  function lockedRec(p) {
    if (p.type === 'match') { const e = (P.record || []).find(x => x.key === p.m.key); return e && e.locked && (e.first?.at || e.made) < e.ko ? e : null }
    const norm = x => tm(x); const e = (P.propRec || []).find(x => norm(x.player) === norm(p.name) && x.k === p.k && Math.abs(x.start * 1000 - +p.start) < 6 * 3600e3);
    return e && e.first?.at && e.first.at < e.start ? e : null;
  }
  const lockTag = e => e ? `<span class="pl fl-lock" title="Saved with its original numbers ${esc(new Date((e.first?.at || e.made) * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}, before the start. It is graded automatically on that line.">${ic('check', 12)}Locked before start</span>` : '';
  const WARN_IC = '<svg class="pd-wic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>';
  /* a card: player, market and line, the matchup with its start and league, the provider and when it was verified,
     the supported edge, the two chances, one sample sentence, the most important warning, and the group's other markets */
  function card(p, rank, now, grp) {
    const on = inSlip(p.id), k = keyOf(p), open = P.open.has(k), mv = moved(p), fol = following(p);
    const badge = p.heat != null ? window.flHeat.badge(p.heat) : p.conf ? `<span class="pl">${esc(p.conf)}</span>` : '';
    const W = warnsOf(p), lk = lockedRec(p);
    const mvTag = mv ? `<span class="pl pd-moved" title="${esc(mv.say)}">${ic(mv.to > mv.from ? 'up' : 'down', 14)}${esc(mv.txt)}<span class="sr-only">. ${esc(mv.say)}</span></span>` : '';
    const bar = (label, v, cls) => `<div class="pd-bar ${cls}"><dt>${label}</dt><dd>${v == null ? `<span class="lb">No two-sided price posted</span>` : `<span class="trak"><i style="width:${pct(v)}%"></i></span><b class="num">${pct(v)}%</b>`}</dd></div>`;
    // the same player line on every app that posts it
    const lines = p.type === 'prop' ? [...new Map((p.offers || []).filter(o => o.line != null).map(o => [o.book + o.line, o])).values()] : [];
    const multi = lines.some(o => o.line !== p.line);   // only when the apps post different lines
    const why = p.type === 'prop' ? [p.smp?.texts.hit, p.smp?.texts.avg, p.smp?.texts.run].filter(Boolean) : p.reasons;
    const more = grp && grp.more.length ? grp.more : null, gOpen = more && P.grp.has(grp.key), who = P.group === 'game' ? matchup(p).replace(/<[^>]+>/g, '') : p.name;
    const sedgeTxt = p.sedge == null ? '–' : edgeTxt(p.sedge);
    return `<article class="card pd-pk${p.sedge != null && p.sedge < 0 ? ' neg' : ''}${open ? ' open' : ''}${p.v?.price === 'stale' ? ' stale' : ''}" data-pk="${esc(p.id)}" data-pdk="${esc(k)}">
      <div class="pd-top">${rank ? `<span class="pd-rank num" aria-hidden="true">${rank}</span>` : ''}${face(p.photo, p.name, 'avx av-lg' + (p.type === 'match' ? ' crest' : ''))}
        <button type="button" class="pd-open" data-pdev="${esc(k)}" data-fk="open-${esc(k)}" aria-expanded="${open}"${open ? ` aria-controls="ev-${esc(k)}"` : ''}><b>${esc(p.name)}</b><span>${esc(p.text)}</span>
          <small class="pd-mu">${[matchup(p), esc(time(p.start)), esc(SPORT_NAME[p.sport] || '')].filter(Boolean).join('<span aria-hidden="true"> · </span>')}</small>
          <small class="pd-pv">${provider(p)}</small>
          <em class="pd-cue">${open ? 'Hide the evidence' : 'See the evidence'}<svg class="pd-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></em></button>
        <span class="pd-tags">${badge}</span>
        <div class="pd-edge" title="${p.edge == null ? 'No market price' : `Raw edge ${edgeTxt(p.edge)}, supported edge ${sedgeTxt}`}"><span class="lb">Edge</span><b class="num">${sedgeTxt}</b>${p.edge == null ? '<span class="sr-only">no market price</span>' : `<span class="sr-only">supported; raw edge ${edgeTxt(p.edge)}</span>`}</div>
        <button type="button" class="ib solid pd-add" data-pdadd="${esc(p.id)}" data-fk="add-${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(p.name)}, ${esc(p.text)}, ${on ? 'from' : 'to'} your slip">${ic(on ? 'check' : 'plus', 20)}</button></div>
      <dl class="pd-bars">${bar('Floodlight’s chance', p.ours, 'ours')}${bar('Market’s chance', p.market, 'mkt')}
        ${p.type === 'prop' && p.smp?.n ? `<div class="pd-hr"><dt>Hit rate, ${esc(p.smp.label)}</dt><dd><b class="num">${p.smp.hits} of ${p.smp.n}</b></dd></div>` : ''}${gradeRow(p)}</dl>
      ${(p.av && p.av.tag == null && p.av.avail !== 'Not checked') || W.length || lk ? `<p class="pd-ctx pd-warn1">${p.av && p.av.tag == null && p.av.avail !== 'Not checked' ? `<span class="pd-av ok">${esc(p.av.avail)}</span>` : ''}${W.length ? `<span class="pd-w1" title="${esc(W[0][1])}">${WARN_IC}<span>${esc(W[0][0])}</span><span class="sr-only">: ${esc(W[0][1])}</span></span>${W.length > 1 ? `<span class="pd-wmore">+${W.length - 1} additional ${W.length === 2 ? 'risk' : 'risks'}</span>` : ''}` : ''}${lk ? lockTag(lk) : ''}</p>` : ''}
      ${mv || fol || multi ? `<div class="pd-meta">${mvTag}${fol ? `<span class="pl pd-fol">${ic('star', 14)}Following${fol.alert != null ? ` · alert at ${edgeTxt(fol.alert)}` : ''}</span>` : ''}${multi ? `<p class="pd-lines"><span class="lb">Lines posted</span>${lines.map(o => `<span class="pd-ln${o.line === p.line ? ' on' : ''}">${esc(BOOK[o.book] || o.book)} <b class="num">${fmtL(o.line)}</b></span>`).join('')}</p>` : ''}</div>` : ''}
      ${why.length ? `<ul class="cx-row pd-why" aria-label="Why">${why.map(r => `<li class="pl">${esc(r)}</li>`).join('')}</ul>` : ''}
      ${evidence(p)}
      ${more ? `<div class="pd-grpf"><span class="lb">${more.length} additional ${more.length === 1 ? 'market' : 'markets'} ${P.group === 'game' ? 'from this game' : 'available'}</span><button type="button" class="bt ghost sm" data-pdgrp="${esc(grp.key)}" data-fk="grp-${esc(grp.key)}" aria-expanded="${!!gOpen}"${gOpen ? ` aria-controls="grp-${esc(grp.key)}"` : ''}>${gOpen ? 'Hide the other markets' : `Show all ${esc(who)} markets`}</button></div>
        ${gOpen ? `<ul class="pd-grpl" id="grp-${esc(grp.key)}" aria-label="Other markets for ${esc(who)}">${more.map(q => mini(q)).join('')}</ul>` : ''}` : ''}</article>`;
  }
  /* another market in an opened group: one row (market, both chances, supported edge, add), its evidence on request */
  function mini(p) {
    const k = keyOf(p), open = P.open.has(k), on = inSlip(p.id), W = warnsOf(p);
    return `<li class="pd-mini${open ? ' open' : ''}" data-pk="${esc(p.id)}" data-pdk="${esc(k)}">
      <div class="pd-mini-r"><button type="button" class="pd-open pd-mini-o" data-pdev="${esc(k)}" data-fk="open-${esc(k)}" aria-expanded="${open}"${open ? ` aria-controls="ev-${esc(k)}"` : ''}><span>${esc(P.group === 'game' ? `${p.name}: ${p.text}` : p.text)}</span>
          <small class="num">Ours ${pct(p.ours)}% · market ${p.market == null ? 'no price' : pct(p.market) + '%'}${W.length ? ` · ${esc(W[0][0])}` : ''}</small></button>
        <span class="pd-mini-e"><span class="lb">Edge</span><b class="num">${p.sedge == null ? '–' : edgeTxt(p.sedge)}</b></span>
        <button type="button" class="ib solid sm pd-add" data-pdadd="${esc(p.id)}" data-fk="add-${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(p.name)}, ${esc(p.text)}, ${on ? 'from' : 'to'} your slip">${ic(on ? 'check' : 'plus', 18)}</button></div>
      ${open ? evidence(p) : ''}</li>`;
  }
  // the skeleton is the pick card's own layout: photo, three lines of text, the edge number, the two bars
  /* the evidence panel: closed by default, opened per pick; a match's saved forecasts are fetched the first time */
  function rangeOf(p) { const E = window.flEvidence; if (!E) return null; if (p.type === 'prop') return E.propRange(p); const v = P.ev.get(p.id); return v && !v.error ? E.matchRange(p, (v.snaps || []).filter(s => s.pick && s.final).slice(-1)[0]) : null }
  /* the evidence grade, A to D, apart from the edge and the chance (labcore.js): how much stands behind the number */
  const gradeOf = p => p.grade?.grade ? p.grade : window.flLabCore?.grade(p) || null;
  function gradeRow(p) { const g = gradeOf(p); return g ? `<div class="pd-hr pd-eg"><dt>Evidence quality</dt><dd><b class="pd-gl g-${g.grade}">${g.grade}</b> <span>${esc(g.word)}</span></dd></div>` : '' }
  /* the supported edge, step by step: raw edge, what sample size, availability, data quality and a moving line took off */
  function breakdownTable(p) {
    const K = window.flLabCore; if (!K || p.edge == null) return '';
    // only with each reason's own factor (the verified feed's cuts); without them the reasons are listed instead
    if (!Array.isArray(p.cuts)) return ''; const b = K.breakdown(p.edge, p.cuts); if (!b) return '';
    return `<table class="pd-eb"><caption class="sr-only">From the raw edge to the supported edge</caption><tbody><tr><th scope="row">Raw edge</th><td class="num">${edgeTxt(b.raw)}</td></tr>
      ${b.rows.map(r => `<tr><th scope="row">${esc(r.label)}${r.reasons.length ? `<small>${esc(r.reasons.join('. '))}</small>` : ''}</th><td class="num">${r.pts ? edgeTxt(r.pts) : '0'}</td></tr>`).join('')}
      <tr class="tot"><th scope="row">Supported edge</th><td class="num">${edgeTxt(p.sedge ?? b.edge)}</td></tr></tbody></table><p class="lb">${esc(K.EXPLAIN)}</p>`;
  }
  /* the top of the evidence: raw and supported edge with the reasons, the game and market it was checked against,
     availability in three separate lines, and every uncertainty in plain words */
  function support(p) {
    const W = warnsOf(p), e = p.v?.event, cut = p.cut || [];
    const edges = p.edge == null ? `<p class="lb">No provider posts both sides of this line, so there is no market price and no edge. The pick is listed for our number only.</p>`
      : `<dl class="pd-se"><div><dt>Floodlight chance</dt><dd class="num">${pct(p.ours)}%</dd></div><div class="on"><dt>Supported edge</dt><dd class="num">${edgeTxt(p.sedge)}</dd></div><div><dt>Evidence quality</dt><dd>${esc(gradeOf(p)?.grade || '–')}</dd></div>${p.type === 'prop' ? `<div><dt>Sample</dt><dd class="num">${(p.games || []).filter(g => g.v != null).length} games</dd></div>` : ''}</dl>
        ${breakdownTable(p) || (cut.length ? `<p class="pd-se-h">${p.sedge === p.edge ? 'Checked, with little effect:' : 'Reduced because:'}</p><ul class="ev-list pd-se-l">${cut.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '')}
        ${cut.length ? '' : '<p class="lb">Nothing reduced it: a full, recent game log, a confirmed matchup and a fresh price from more than one provider.</p>'}
        ${(() => { const g = gradeOf(p); return g ? `<details class="pd-egd"><summary>Why evidence quality is ${g.grade}</summary><ul class="ev-list">${g.points.map(x => `<li>${x.ok ? '' : '<span class="sr-only">Weakness: </span>'}${esc(x.text)}</li>`).join('')}</ul></details>` : '' })()}`;
    const game = `<dl class="pd-facts">${[
      ['Game', `${matchup(p)} · ${esc(time(p.start))}`],
      ['League', esc(SPORT_NAME[p.sport] || p.sport)],
      ['Matchup', e?.verified === 'schedule' ? 'Confirmed on the league schedule' : e?.verified === 'provider' ? 'From the provider only' : e?.verified === 'forecast' ? 'From the forecast’s fixture' : 'Not confirmed'],
      p.type === 'prop' ? ['Market', `${esc(p.text)} · ${provider(p)}`] : null,
      p.type === 'prop' && p.av ? ['Availability', esc(p.av.avail)] : null,
      p.type === 'prop' && p.av ? ['Injury report', esc(p.av.report)] : null,
      p.type === 'prop' && p.av ? ['Starting status', esc(p.av.start === 'Lineup not announced' ? 'Not confirmed (lineups are not announced yet)' : p.av.start)] : null,
    ].filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    const risks = W.length ? `<ul class="ev-warns" aria-label="Things to weigh">${W.map(([t, w]) => `<li><b>${esc(t)}</b><small>${esc(w)}</small></li>`).join('')}</ul>` : '<p class="lb">Nothing unusual stands out for this pick.</p>';
    return `<section class="ev-sec pd-sup"><h4>Supported edge</h4>${edges}</section><section class="ev-sec"><h4>The game and the market</h4>${game}</section><section class="ev-sec"><h4>Things to weigh</h4>${risks}</section>`;
  }
  // what "Report incorrect data" sends with the member's note (datastatus.js opens the dialog)
  const reportOf = p => ({ marketId: p.mid || p.id, eventId: p.eventId || p.v?.event?.id || '', player: p.name, provider: (p.books || []).map(b => BOOK[b] || b).join(', '),
    sport: p.sport, stat: p.text, line: p.line, side: p.side, verifiedAt: p.at ? Math.round(+new Date(p.at) / 1000) : '', page: '#/predictions' });
  function evidence(p) {
    if (!window.flEvidence) return '';
    const k = keyOf(p), on = P.open.has(k), R = rangeOf(p), fol = following(p);
    const alertSel = fol ? `<label class="pd-alsel"><span>Alert me when the edge reaches</span><select class="inp sm" data-pdalert="${esc(k)}" data-fk="al-${esc(k)}">${[['', 'No alert'], ...[3, 5, 8, 10, 15].map(n => [n, '+' + n])].map(([v, l]) => `<option value="${v}"${String(fol.alert ?? '') === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
    return `<div class="pd-evbar"><button type="button" class="lk" data-pdopen="${esc(p.id)}" data-fk="lab-${esc(k)}">${ic('lab', 16)}Open in the Lab<span class="sr-only">: ${esc(p.name)}, ${esc(p.text)}</span></button>
        <button type="button" class="lk pd-folb" data-pdfollow="${esc(k)}" data-fk="fol-${esc(k)}" aria-pressed="${!!fol}">${ic('star', 16)}${fol ? 'Following' : 'Follow'}<span class="sr-only"> ${esc(p.name)}, ${esc(p.text)}</span></button>
        ${window.flShare ? `<button type="button" class="lk pd-share" data-pdshare="${esc(p.id)}" data-fk="sh-${esc(k)}">${window.flShare.ICON}Share<span class="sr-only"> ${esc(p.name)}, ${esc(p.text)} as a picture</span></button>` : ''}
        <button type="button" class="lk pd-rep" data-report="${esc(JSON.stringify(reportOf(p)))}" data-fk="rep-${esc(k)}">${ic('help', 16)}Report incorrect data<span class="sr-only">: ${esc(p.name)}, ${esc(p.text)}</span></button>
        ${R ? `<span class="lb num pd-rng" title="${p.type === 'prop' ? 'One standard error either side, from the games behind the reading' : 'The span between our model alone and the market'}">Likely ${pct(R.lo)}–${pct(R.hi)}%</span>` : ''}${alertSel}</div>
      ${on ? `<div class="pd-ev" id="ev-${esc(k)}" role="region" aria-label="Evidence for ${esc(p.name)}, ${esc(p.text)}">${support(p)}${p.type === 'prop' ? window.flEvidence.prop(p) : window.flEvidence.match(p, P.ev.get(p.id))}${window.flShare || window.flBoards ? `<div class="pd-evfoot">${window.flBoards ? `<button type="button" class="bt ghost sm" data-pdboard="${esc(k)}" data-fk="bd-${esc(k)}">${window.flShell?.ic?.('save', 16) || ''}Save to a board</button>` : ''}${window.flShare ? `<button type="button" class="bt ghost sm" data-pdshareev="${esc(p.id)}" data-fk="shev-${esc(k)}">${window.flShare.ICON}Share this evidence</button>` : ''}</div>` : ''}</div>` : ''}`;
  }
  /* a pick, or a pick with its evidence, as a picture to share (share.js draws it in the current theme) */
  function shareOpts(p, withEvidence) {
    const R = rangeOf(p), day = p.start ? p.start.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const o = { file: p.short || p.name, kicker: [SPORT_NAME[p.sport], day].filter(Boolean).join(' · '), title: p.type === 'prop' ? `${p.name}: ${p.text}` : p.short || `${p.name} ${p.text}`,
      sub: p.game || '', stats: [['Our number', pct(p.ours) + '%', 'accent'], ['Market', p.market == null ? 'No price' : pct(p.market) + '%'], ['Edge', edgeTxt(p.edge), p.edge > 0 ? 'good' : p.edge < 0 ? 'bad' : ''], R ? ['Likely range', `${pct(R.lo)}–${pct(R.hi)}%`] : null],
      foot: 'Floodlight research, not a guarantee. The market price has the book’s margin taken out.',
      markets: p.type === 'prop' ? [{ mid: p.mid, sport: p.sport, name: p.name, k: p.k }] : null };
    if (!withEvidence) return o;
    if (p.type === 'prop') {
      const S = MK.sample(p.games, p.line, p.side, p.yes);   // the same sample as the card
      o.stats = [['Our number', pct(p.ours) + '%', 'accent'], S.n ? [`Hit, ${S.label}`, `${S.hits} of ${S.n}`] : null, S.avg != null && !p.yes ? [S.full ? 'Average, last 10' : `Average, ${S.n} games`, String(S.avg)] : null, p.line != null ? ['Line', String(p.line)] : null];
      o.sub = `${p.game || ''}${S.total ? ` · the evidence: ${S.total} ${S.total === 1 ? 'game' : 'games'} on the log` : ''}`;
    } else {
      const v = P.ev.get(p.id), snaps = v && !v.error ? (v.snaps || []).filter(s => s.pick && s.final) : [];
      o.stats = [['Our number', pct(p.ours) + '%', 'accent'], ['Market', p.market == null ? 'No price' : pct(p.market) + '%'], R ? ['Likely range', `${pct(R.lo)}–${pct(R.hi)}%`] : null, snaps.length ? ['Forecasts saved', String(snaps.length)] : null];
      o.sub = `${p.game || ''}${snaps.length ? ` · ${(snaps[snaps.length - 1].reasons || []).filter(r => typeof r === 'string')[0] || ''}` : ''}`;
    }
    return o;
  }
  function loadEvidence(p, force) {
    if (p.type !== 'match' || (P.ev.has(p.id) && !force)) return;
    if (force) P.ev.delete(p.id);
    get('/api/forecast/get?keys=' + encodeURIComponent(p.m.key)).then(d => P.ev.set(p.id, d.forecasts?.[p.m.key] || { error: 'nothing saved' }), e => P.ev.set(p.id, { error: e.message || 'it did not answer' })).then(draw);
  }
  // a pick as something to come back to (Home's Continue researching) or to keep on a board
  const pickItem = (p, k = keyOf(p)) => ({ kind: 'pred', key: 'pred:' + k, label: `${p.name}: ${p.text}`, sub: [p.game, p.start ? new Date(p.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : ''].filter(Boolean).join(' · '), photo: p.photo || '', open: { page: 'predictions', pick: k } });
  function toggleEvidence(k) { const p = allPicks().find(x => keyOf(x) === k || x.id === k); if (!p) return; k = keyOf(p); if (P.open.has(k)) P.open.delete(k); else { P.open.add(k); loadEvidence(p); window.flRecent?.note(pickItem(p, k)) } draw() }
  const skel = n => Array.from({ length: n }, () => `<div class="card pd-pk pd-skl" aria-hidden="true"><div class="pd-top"><span class="skl pd-sk-av"></span><span class="pd-sk-t"><i class="skl" style="width:46%"></i><i class="skl" style="width:64%"></i><i class="skl" style="width:38%"></i></span><span class="skl pd-sk-e"></span><span class="skl pd-sk-b"></span></div>
    <div class="pd-bars"><i class="skl"></i><i class="skl"></i></div></div>`).join('');
  function drawBoard(L) {
    const el = $('pdBoard'), now = Date.now();
    const src = sources(), waiting = src.filter(x => x.state === 'loading' && x.key !== 'rec'), down = src.filter(x => (x.state === 'failed' || x.state === 'stale') && x.note && x.key !== 'rec');
    if (P.loading && !L.every.length) { el.innerHTML = `<p class="sr-only">Loading the picks.</p>${skel(4)}`; return }
    if (P.denied) { el.innerHTML = `<div class="card emp">${ic('members', 28)}<b>Predictions aren't part of your access yet</b><p>Your admin decides which parts of Floodlight each member can open. Ask them to switch Predictions on for you.</p><button type="button" class="bt" data-page="members">See your access</button></div>`; return }
    const CAP = 12, groups = L.groups, shown = P.all ? groups : groups.slice(0, CAP), nMk = L.ranked.length;
    // a source that did not answer is said here, above the picks it would have fed, with the way to try again
    // a delayed source is said once, above the picks, in one line with the time and a retry (the indicator has the details)
    const H = health(), T = healthText(H);
    let h = '', alert = !P.loading && H.late.some(x => x.state === 'failed' || (x.state === 'stale' && x.note)) ? `<p class="pd-delay" role="status">${ic('help', 18)}<span><b>${esc(T.head)}.</b> ${esc(T.sub)} <span class="lb">Checked ${esc(clock(P.at || Date.now()))}.</span></span><button type="button" class="bt ghost sm" data-pd="reload" data-fk="reload-alert">Retry</button></p>` : '';
    const what = P.group === 'player' ? `${groups.length} ${groups.length === 1 ? 'player' : 'players'}, best supported market each` : P.group === 'game' ? `${groups.length} ${groups.length === 1 ? 'game' : 'games'}, best supported market each` : `${nMk} ${nMk === 1 ? 'market' : 'markets'}`;
    if (shown.length) h += `<section aria-label="The edge board"><div class="sec-h"><h2>The edge board</h2><span class="lb">${esc(what)}${P.group !== 'all' && nMk > groups.length ? ` · ${nMk} markets in all` : ''}</span></div><div class="vst pd-list">${shown.map((g, i) => card(g.best, i + 1, now, g)).join('')}</div>
      ${groups.length > CAP ? `<button type="button" class="bt ghost wide" data-pd="all" data-fk="all">${P.all ? 'Show the top ' + CAP : `Show all ${groups.length}`}</button>` : ''}</section>`;
    if (L.checking.length && !shown.length) h += `<p class="pd-chk-n lb" role="status"><span class="pd-spin" aria-hidden="true"></span>Checking ${L.checking.length} ${L.checking.length === 1 ? 'line' : 'lines'} against the league schedule…</p>`;
    // lines whose game or opponent can't be confirmed: listed with the reason, never ranked
    if (L.incomplete.length) h += `<section aria-label="Incomplete markets"><details class="card pd-held pd-inc" data-pdfold="inc"${P.fold.has('inc') ? ' open' : ''}><summary><b>Incomplete markets</b> <span class="lb">${L.incomplete.length} waiting for matchup confirmation</span></summary>
      <p class="lb">These lines are posted, but their game, opponent or price can’t be confirmed yet, so they aren’t ranked. They join the board once the schedule confirms them.</p>
      <ul class="pd-heldl">${L.incomplete.slice(0, 40).map(p => `<li><b>${esc(p.name)}</b> ${esc(p.text)} <span class="lb">${esc(SPORT_NAME[p.sport] || '')}${p.start ? ` · ${esc(time(p.start))}` : ''}</span><small>${esc(p.v.text)}</small></li>`).join('')}</ul></details></section>`;
    // props held back while the player's team is checked (players.py): listed with the reason, never ranked
    const held = (window.flEdge?.held?.() || []).filter(p => (P.sport === 'all' || p.sport === P.sport) && p.start && p.start > now);
    if (held.length) h += `<section aria-label="Held for a team check"><details class="card pd-held" data-pdfold="held"${P.fold.has('held') ? ' open' : ''}><summary><b>${held.length} ${held.length === 1 ? 'prop is' : 'props are'} held back</b> <span class="lb">while we check the player’s team</span></summary>
      <p class="lb">These lines are posted, but the team rosters and the sportsbooks don’t agree on who the player plays for, so Floodlight doesn’t rank them yet.</p>
      <ul class="pd-heldl">${held.slice(0, 30).map(p => `<li><b>${esc(p.name)}</b> ${esc(p.text)} <span class="lb">${esc(SPORT_NAME[p.sport] || '')}</span><small>${esc(p.teamNote || 'Team information is being verified.')}</small></li>`).join('')}</ul></details></section>`;
    if (L.bare.length) h += `<section aria-label="Picks with no market price"><div class="sec-h"><h2>Our number only</h2><span class="lb">No book posts both sides of these lines, so there is no edge to rank</span></div><div class="vst pd-list">${L.bare.slice(0, P.all ? 60 : 6).map(p => card(p, 0, now)).join('')}</div>
      ${L.bare.length > 6 && !L.ranked.length ? `<button type="button" class="bt ghost wide" data-pd="all" data-fk="all">${P.all ? 'Show fewer' : `Show all ${L.bare.length}`}</button>` : ''}</section>`;
    // taken off the board during this visit: started, closed, cancelled or ruled out, with the state Pick history files it under
    if (L.gone.length) h += `<section aria-label="Taken off the board"><details class="card pd-held pd-gone" data-pdfold="gone"${P.fold.has('gone') ? ' open' : ''}><summary><b>Taken off the board</b> <span class="lb">${L.gone.length} recently</span></summary>
      <ul class="pd-heldl">${L.gone.slice(0, 30).map(g => `<li><b>${esc(g.name)}</b> ${esc(g.text)} <span class="pl pd-gst">${esc(g.label)}</span><small>${esc(g.note)}${g.start ? ` · ${esc(new Date(g.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}</small></li>`).join('')}</ul>
      <p class="lb">Props shown before their start are graded after the game. <button type="button" class="lk" data-page="history" data-fk="gone-hist">See Pick history</button></p></details></section>`;
    if (L.done.length) h += `<section aria-label="Finished in the last day"><div class="sec-h"><h2>Finished</h2><span class="lb">Results stay here for a day</span></div><div class="card pd-done">${L.done.map(e => { const hit = e.result === 'won', pick = e.pick === 'draw' ? 'Draw' : `${e[e.pick]} to win`;
      return `<div class="rw"><span class="rw-t"><b>${esc(pick)}</b><small>${esc(e.home)} ${Array.isArray(e.final) ? `${e.final[0]}–${e.final[1]}` : 'v'} ${esc(e.away)} · we said ${pct(e.top)}%</small></span><span class="pd-resw"><span class="pl pd-res ${hit ? 'hit' : 'miss'}">${ic(hit ? 'check' : 'x', 14)}${hit ? 'Hit' : 'Miss'}</span>${['server', 'github'].includes(e.by) && e.locked && (e.first?.at || e.made) < e.ko ? lockTag(e) : ''}</span></div>` }).join('')}</div></section>`;
    if (P.loading && waiting.length) h += `<section aria-label="Still loading"><div class="sec-h"><h2 class="pd-wait-h">More on the way</h2><span class="lb">${esc(waiting.map(x => x.name).join(', '))}</span></div><div class="vst pd-list">${skel(L.every.length ? 1 : 3)}</div></section>`;
    if (!shown.length && !L.bare.length && !(P.loading && waiting.length) && !L.checking.length) {
      const any = L.open.length > 0, filtered = P.sport !== 'all' || P.when !== 'tonight' || P.min > 0;
      const checked = Object.values(P.props?.by || {}).filter(r => !r.error).map(r => SPORT_NAME[r.sport]).filter(Boolean);
      const allDown = !any && down.length && !src.some(x => x.key !== 'rec' && x.state === 'ok');
      h = allDown ? `<div class="card emp">${ic('help', 28)}<b>The picks did not load</b><p>None of the sources answered, so there is nothing to show yet. This is a connection problem, not an empty board.${P.retryT && P.retries <= 2 ? ' The page is trying again by itself.' : ''}</p><button type="button" class="bt" data-pd="reload" data-fk="reload">Try again</button></div>` + h
        : `<div class="card emp">${ic('pred', 28)}<b>${any && filtered ? 'No picks match these filters' : 'No picks on the board right now'}</b>
        <p>${any && filtered ? `Nothing ${P.sport === 'all' ? '' : 'in ' + esc(SPORT_NAME[P.sport]) + ' '}${P.when === 'tonight' ? 'tonight' : P.when === 'tomorrow' ? 'tomorrow' : 'this week'}${P.min ? ` has an edge of ${P.min} or more` : ''}. Widen the filters to see the rest.`
          : `A pick appears when PrizePicks or Sleeper posts a player line, or when a match you follow gets a forecast. ${checked.length ? `Checked just now: ${esc(checked.join(', '))}.` : ''}`}</p>
        ${any && filtered ? `<button type="button" class="bt" data-pd="clear" data-fk="clear">Clear the filters</button>` : `<button type="button" class="bt ghost" data-pd="reload" data-fk="reload">Check again</button>`}</div>` + h;
      if (allDown) alert = '';
    }
    el.innerHTML = alert + h;
  }

  /* ---------- the slip ----------
     The combined chance comes from parlaycore (slipChance): picks from different games multiply; Low or Moderate links
     (same game, same team, same player) give a rough range; Strong links (one player's stats that count the same plays,
     a quarterback and his receiver, several overs or unders on one quarterback) are too tight for our rules of thumb, so
     the slip says so and shows only the limits; picks that can't both hit give 0%. Each leg carries what relate() reads. */
  const PL = ['type', 'lg', 'sport', 'player', 'team', 'opp', 'k', 'label', 'line', 'side', 'yes', 'start', 'gameKey', 'home', 'away', 'eid'];
  function plOf(p) { try { const x = window.flParlay?.fromPick(p); return x ? Object.fromEntries(PL.filter(k => x[k] != null).map(k => [k, x[k]])) : null } catch (e) { return null } }
  const corrLegs = legs => legs.map(l => ({ ...(l.pl || { type: 'other', lg: l.sport }), id: l.id, gameKey: l.pl?.gameKey || l.gameKey, ours0: l.ours, market0: l.market }));
  function combine(legs, key) {
    const C = window.flParlay, xs = corrLegs(legs); if (!C || !legs.length) return null;
    return C.slipChance(xs, l => key === 'ours' ? l.ours0 : l.market0);
  }
  const range = c => !c ? '–' : c.kind === 'conflict' ? '0%' : pct(c.lo) === pct(c.hi) ? `${pct(c.lo)}%` : `${pct(c.lo)}–${pct(c.hi)}%`;
  function syncSlip() {   // legs keep the numbers they were added at, until the same pick is on the board again
    const live = new Map(allPicks().map(p => [p.id, p]));
    // a pick no longer on the board keeps its numbers and says why it left (ruled out, closed, started)
    P.slip = P.slip.map(l => { const p = live.get(l.id); if (p) return { ...leg(p), line0: l.line0 ?? l.line ?? p.line ?? null };
      const g = l.mid && window.flMarkets?.get?.(l.mid); return g && g.status && g.status !== 'open' ? { ...l, gone: g.statusLabel || g.status, out: l.out || g.status === 'player_out' } : l });
    store.set('fl.slip', P.slip);
  }
  const leg = p => ({ id: p.id, mid: p.mid || '', name: p.name, text: p.text, short: p.short || `${p.name} ${p.text}`, ours: p.ours, market: p.market, gameKey: p.gameKey, game: p.game, sport: p.sport, pl: plOf(p),
    grade: gradeOf(p)?.grade || null, start: p.start ? +new Date(p.start) || null : null, line: p.line ?? null, line0: p.line ?? null, side: p.side || null, out: p.av?.lv === 'out' });
  function toggle(id) {
    const i = P.slip.findIndex(l => l.id === id);
    if (i >= 0) P.slip.splice(i, 1); else { const p = allPicks().find(x => x.id === id); if (!p) return; if (P.slip.length >= 12) return window.toast?.('A Prediction Card holds up to 12 picks'); P.slip.push(leg(p)) }
    store.set('fl.slip', P.slip); P.saved = 0; draw();
  }
  function saveSlips() {
    store.set('fl.slips', P.slips);
    try { if (window.S?.me && typeof api === 'function') api('/api/me/prefs', { slips: P.slips.slice(0, 30) }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
  }
  function saveSlip() {
    if (!P.slip.length) return;
    const d = new Date(), name = `${P.slip.length} ${P.slip.length === 1 ? 'pick' : 'picks'} · ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    P.slips.unshift({ id: 's' + Date.now().toString(36), name, legs: P.slip.map(l => ({ ...l })), at: Date.now() }); P.slips = P.slips.slice(0, 30); saveSlips(); P.saved = Date.now(); draw();
  }
  const CORR_ICON = { Low: 'help', Moderate: 'help', Strong: 'help', Conflicting: 'x' };
  function corrNote(c, legs) {
    if (!c?.corr?.label) return '';
    const k = c.corr, by = new Map(legs.map(l => [l.id, l])), nm = x => by.get(x.id)?.short || x.player || '';
    const pairs = k.qb ? [] : k.pairs.filter(x => x.label !== 'Low' || k.label === 'Low').slice(0, 2);   // one quarterback's stack is named in the sentence already
    return `<div class="pd-corr ${k.label.toLowerCase()}" role="note" aria-label="${esc(k.head)}"><p class="pd-corr-h">${ic(CORR_ICON[k.label], 16)}<b>${esc(k.head)}</b>${k.label === 'Conflicting' ? `<span class="pl pd-corr-l">${esc(k.label)}</span>` : ''}</p><p>${esc(k.text)}</p>
      ${pairs.length ? `<ul class="pd-corr-p">${pairs.map(x => `<li><span>${esc(nm(x.a))} + ${esc(nm(x.b))}</span><small>${esc(x.label)}: ${esc(x.why)}</small></li>`).join('')}</ul>` : ''}</div>`;
  }

  /* the Prediction Card read as a whole (labcore.card): evidence, the weakest pick, when it locks, and what changed */
  function cardRead(legs) {
    const K = window.flLabCore; if (!K || !legs.length) return '';
    const c = K.card(legs), rows = [];
    if (c.avgGrade) rows.push(['grade', `<span class="pd-gl g-${c.avgGrade}">${c.avgGrade}</span>`, `Average evidence quality: ${K.GRADE_WORD[c.avgGrade].toLowerCase()}`, 'Graded apart from the chance. One weak pick can sink a strong card.']);
    if (c.weakest) rows.push(['weak', ic('help', 16), `Weakest pick: ${esc(c.weakest.short)}`, `${c.weakest.grade ? `Evidence ${c.weakest.grade}, ` : ''}${pct(c.weakest.ours)}% on its own. Taking it out raises the chance the rest hit.`]);
    if (c.expires) rows.push(['clock', ic('clock', 16), `Closes in <span data-pdcd="${+c.expires.leg.start}">${esc(K.countdown(c.expires.in))}</span>`, `${esc(c.expires.leg.game || c.expires.leg.short)} starts first. A pick can’t be added or changed once its game starts.`]);
    if (c.started.length) rows.push(['start', ic('clock', 16), `${c.started.length === 1 ? 'One pick has' : `${c.started.length} picks have`} started`, `${esc(c.started.map(l => l.short).join(', '))}. Its chance is the one from before the start.`]);
    for (const m of c.moved) rows.push(['moved', ic('trend', 16), `Line moved: ${esc(m.name || m.short)} ${fmtL(m.from)} → ${fmtL(m.to)}`, `The ${esc(m.side || 'pick')} is now ${m.worse ? 'harder' : 'easier'} to hit than when you added it.`]);
    for (const l of legs.filter(l => l.out || l.gone)) rows.push(['out', ic('x', 16), `${esc(l.short)}: ${esc(l.out ? 'ruled out' : String(l.gone).toLowerCase())}`, 'This pick is off the board. Take it out, or the card can’t hit.']);
    return rows.length ? `<ul class="pd-cx">${rows.map(([k, i, h, d]) => `<li class="pd-cx-${k}">${i}<span><b>${h}</b><small>${d}</small></span></li>`).join('')}</ul>` : '';
  }
  // the countdowns tick once a minute while the card is on screen
  setInterval(() => { const K = window.flLabCore; if (!K) return; document.querySelectorAll('[data-pdcd]').forEach(e => { e.textContent = K.countdown(+e.dataset.pdcd - Date.now()) }) }, 30000);
  /* Share: the card as a picture, through the phone's share sheet where there is one, else downloaded */
  async function shareCard() {
    const legs = P.slip; if (!legs.length) return;
    if (!(window.flPlan?.can?.('share_cards') ?? true)) return window.toast?.('Shareable cards are part of Plus. See Plans to upgrade.');
    // every pick is checked again before the picture is made: a pick taken off the board is named on it
    const st = window.flMarkets?.recheck ? await window.flMarkets.recheck(legs.filter(l => l.mid).map(l => ({ mid: l.mid, sport: l.sport, name: l.name }))).catch(() => []) : [];
    const shut = st.filter(x => x && !x.open && x.status !== 'awaiting_verification');
    const ours = combine(legs, 'ours'), big = !ours ? '–' : ours.kind === 'limits' ? `${pct(ours.lo)}–${pct(ours.hi)}%` : range(ours), c = window.flLabCore?.card(legs);
    const cv = cardCanvas({ kicker: 'Floodlight · Prediction Card', title: `${legs.length} ${legs.length === 1 ? 'pick' : 'picks'} · chance all hit ${big}`, rows: legs.map(l => [l.short, `${pct(l.ours)}%`, l.game || '']),
      foot: [shut.length ? `No longer open: ${shut.map(x => `${x.market?.name || 'a pick'} (${x.message || 'Market closed'})`).join(', ')}` : '', c?.avgGrade ? `Average evidence quality ${c.avgGrade}` : '', 'Chances are estimates, not a promise of what happens next.'].filter(Boolean) });
    try { window.flTrack?.('card_create', { n: legs.length }) } catch (e) {}
    cv.toBlob(async b => { if (!b) return announce('The picture could not be made in this browser.'); const file = new File([b], 'prediction-card.png', { type: 'image/png' });
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'My Prediction Card' }); return } } catch (e) { if (e?.name === 'AbortError') return }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'prediction-card.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); announce('Saved the card as a picture.') }, 'image/png');
  }
  const announce = t => { const a = document.getElementById('announce'); if (a) { a.textContent = ''; setTimeout(() => { a.textContent = t }, 30) } };
  /* a card drawn in the current theme: kicker, title, rows of [left, right, under] and a footer. Parlays uses it too. */
  function cardCanvas({ kicker, title, rows, foot }) {
    const cs = getComputedStyle(document.body), c = (n, d) => cs.getPropertyValue(n).trim() || d, fam = c('--font-body', 'system-ui, sans-serif'), disp = c('--font-display', fam);
    const W = 1080, PAD = 64, RH = 88, list = rows.slice(0, 12), H = PAD + 170 + list.length * RH + (foot || []).length * 36 + 70;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
    const fit = (t, w) => { t = String(t || ''); if (x.measureText(t).width <= w) return t; while (t && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…' };
    x.fillStyle = c('--surface', '#111'); x.fillRect(0, 0, W, H); x.fillStyle = c('--accent', '#e8b64c'); x.fillRect(0, 0, W, 10);
    x.fillStyle = c('--muted', '#999'); x.font = `600 24px ${fam}`; x.fillText(fit(`${kicker} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`, W - 2 * PAD), PAD, PAD + 18);
    x.fillStyle = c('--text', '#fff'); x.font = `800 48px ${disp}`; x.fillText(fit(title, W - 2 * PAD), PAD, PAD + 96);
    let y = PAD + 160;
    for (const [l, r, u] of list) { x.strokeStyle = c('--border', '#333'); x.lineWidth = 2; x.beginPath(); x.moveTo(PAD, y - 6); x.lineTo(W - PAD, y - 6); x.stroke();
      x.fillStyle = c('--text', '#fff'); x.font = `700 32px ${fam}`; x.fillText(fit(l, W - 2 * PAD - 200), PAD, y + 36);
      if (u) { x.fillStyle = c('--muted', '#999'); x.font = `500 24px ${fam}`; x.fillText(fit(u, W - 2 * PAD - 200), PAD, y + 68) }
      x.textAlign = 'right'; x.fillStyle = c('--text', '#fff'); x.font = `800 36px ${fam}`; x.fillText(r || '', W - PAD, y + 48); x.textAlign = 'left'; y += RH }
    x.fillStyle = c('--muted', '#999'); x.font = `500 22px ${fam}`; for (const t of foot || []) { y += 36; x.fillText(fit(t, W - 2 * PAD), PAD, y) }
    return cv;
  }
  function slipCard() {
    const n = P.slip.length, ours = n ? combine(P.slip, 'ours') : null, mk = n ? combine(P.slip, 'market') : null, noMk = P.slip.filter(l => l.market == null).length;
    const kind = ours?.kind, big = !ours ? '–' : kind === 'limits' ? `${pct(ours.lo)}–${pct(ours.hi)}%` : range(ours);
    const sub = kind === 'limits' ? 'Limits only: the link is too strong to model' : kind === 'adjusted' ? `A rough range. Multiplied: ${pct(ours.p)}%` : kind === 'conflict' ? 'These picks can’t all hit' : n > 1 ? 'Different games, so multiplied' : '';
    return `<section class="card pd-slip${n ? ' has' : ' none'}" aria-label="Your Prediction Card"><div class="sec-h"><h2>${n ? 'Your Prediction Card' : 'Your Prediction Card is empty'}</h2>${n ? `<span class="pl">${n} ${n === 1 ? 'pick' : 'picks'}</span>` : ''}</div>
      ${n ? `<ul class="pd-legs">${P.slip.map(l => `<li><span class="rw-t"><b>${esc(l.short)}</b><small>${esc(l.game || '')}</small></span><b class="num">${pct(l.ours)}%</b><button type="button" class="ib pd-rm" data-pdadd="${esc(l.id)}" data-fk="rm-${esc(l.id)}" aria-label="Remove ${esc(l.short)} from your Prediction Card">${ic('x', 16)}</button></li>`).join('')}</ul>
        <div class="pd-total"><div><span class="pd-k">${n === 1 ? 'Chance it hits' : `Chance all ${n} hit`}</span><b class="num pd-big">${big}</b>${sub ? `<small class="lb">${esc(sub)}</small>` : ''}</div><div class="pd-mk"><span class="pd-k">Market says</span><b class="num">${mk && !noMk ? (mk.kind === 'limits' ? `${pct(mk.lo)}–${pct(mk.hi)}%` : range(mk)) : '–'}</b></div></div>
        ${n > 1 ? corrNote(ours, P.slip) : ''}
        ${cardRead(P.slip)}
        ${(() => { const w = `${n === 1 ? '<span>Add another pick to see the chance they all hit.</span>' : !ours?.corr?.label ? '<span>No two picks come from the same game, so the chances are multiplied together.</span>' : ''}${noMk ? `<span> ${noMk === n ? 'None of these picks has' : `${noMk} of these picks ${noMk === 1 ? 'has' : 'have'}`} no market price, so there is no market number for the slip.</span>` : ''}`; return w ? `<p class="pd-warn">${w}</p>` : '' })()}
        <div class="pd-acts"><button type="button" class="bt wide pd-save" data-pd="track" data-fk="track">${ic('ticket', 18)}Track it live</button><button type="button" class="bt ghost pd-clear" data-pd="save" data-fk="save">Save card</button><button type="button" class="bt ghost pd-clear" data-pd="sharecard" data-fk="sharecard">${ic('share', 16)}Share</button><button type="button" class="bt ghost pd-clear" data-pd="empty" data-fk="empty">Clear</button></div>
        <p class="lb pd-nog">Chances are estimates. Past hit rates describe past games and don’t guarantee what happens next.</p>
        <p class="pd-said" role="status">${P.saved ? `Saved. ${window.S?.me ? 'It is kept with your account.' : 'It is kept in this browser; log in to keep it with your account.'}` : ''}</p>`
        : `<p class="pd-empty">Add two or more picks to see the chance they all hit, the weakest one and how good the evidence is.</p>`}
      ${P.slips.length ? `<div class="pd-saved"><span class="pd-k">Saved cards</span>${P.slips.slice(0, 3).map(s => { const c = combine(s.legs, 'ours');
        return P.confirm === s.id ? `<div class="pd-sv"><span class="rw-t"><b>Delete “${esc(s.name)}”?</b></span><button type="button" class="bt sm danger" data-pdyes="${s.id}" data-fk="yes-${s.id}">Delete card</button><button type="button" class="bt sm ghost" data-pd="keep" data-fk="keepit">Keep it</button></div>`
          : `<div class="pd-sv"><button type="button" class="pd-load" data-pdload="${s.id}" data-fk="load-${s.id}"><b>${esc(s.name)}</b><small>${c ? range(c) + ' at the time' : ''}</small></button><button type="button" class="ib pd-rm" data-pddel="${s.id}" data-fk="del-${s.id}" aria-label="Delete the saved card ${esc(s.name)}">${ic('x', 16)}</button></div>` }).join('')}</div>` : ''}</section>`;
  }

  /* ---------- how we have done ----------
     The same record service, response and sums as Pick history (history.js): one request for both pages, so this
     section can't say "did not load" while Pick history shows the record. With nothing graded it says so plainly. */
  function recordLoad(force) {
    const H = window.flHistory; if (!H) return Promise.resolve();
    return H.load(force).then(Hs => { P.record = Hs.rows || P.record || []; P.propRec = Hs.props || P.propRec || []; P.recError = Hs.rows || Hs.status ? '' : Hs.err; P.recAt = Hs.at || P.recAt });
  }
  const SPORT_KEY = { NBA: 'nba', WNBA: 'wnba', NFL: 'nfl', NHL: 'nhl', MLB: 'mlb', Soccer: 'soccer' };
  const sportKey = e => SPORT_KEY[e.sport] || 'cfb';
  function resultsCard() { return window.flHistory ? window.flHistory.widget(e => P.sport === 'all' || sportKey(e) === P.sport) : '' }
  document.addEventListener('fl:record', () => { if (window.flPages.current() === 'predictions' && $('pdSide')) draw() });   // draw() keeps the keyboard's place and passes the lists drawSide needs
  function fadeCard(L) {
    const cold = window.flEdge ? window.flEdge.cold((L.open || []).filter(p => p.type === 'prop'), 3) : [];
    return `<section class="card pd-fade" aria-label="Fade list"><div class="sec-h"><h2>Fade list</h2><span class="lb">The coldest players tonight</span></div>
      ${cold.length ? cold.map(p => `<button type="button" class="rw" data-pdlab="${esc(JSON.stringify(window.flEdge.labArgs(p)))}" data-fk="fade-${esc(p.id)}">${face(p.photo, p.name)}<span class="rw-t"><b>${esc(p.name)}</b><small>${esc(`${p.label} · line ${window.flEdge.fmt(p.line)}`)}</small></span>${window.flHeat.badge(p.heat)}</button>`).join('')
        : `<p class="lb">${P.loading ? 'Loading…' : 'Nobody with a line posted tonight reads cold. A player lands here when their heat reading is under 40.'}</p>`}</section>`;
  }
  /* the picks you follow: their edge now, or where they went */
  function followCard() {
    if (!P.follow.length) return '';
    const live = new Map((P.lastOpen || []).map(p => [keyOf(p), p])), now = Date.now();
    const rows = P.follow.slice().reverse().filter(f => live.has(f.k) || !f.start || now - f.start < 12 * 3600e3).slice(0, 8);
    if (!rows.length) return '';
    return `<section class="card pd-folc" aria-labelledby="pdFolH"><div class="sec-h"><h2 id="pdFolH">Following</h2><span class="lb">${rows.length} ${rows.length === 1 ? 'pick' : 'picks'}</span></div>
      <ul class="hm-bl">${rows.map(f => { const p = live.get(f.k), g = P.gone.get(f.k);
        return `<li class="pd-folr"><span class="rw-t"><b>${esc(f.name)}</b><small>${esc(p ? p.text : f.text)}${p ? '' : g ? ` · ${esc(g.label.toLowerCase())}` : ' · off the board'}${f.alert != null ? ` · alert at ${edgeTxt(f.alert)}` : ''}</small></span>
          <b class="num pd-foled">${p ? edgeTxt(p.sedge) : '–'}</b><button type="button" class="ib sm" data-pdfollow="${esc(f.k)}" data-fk="unf-${esc(f.k)}" aria-label="Stop following ${esc(f.name)}, ${esc(f.text)}">${ic('x', 16)}</button></li>` }).join('')}</ul>
      <p class="lb">Alerts show on this page while Floodlight is open, and as browser notifications when Alerts are on in Settings.</p></section>`;
  }
  function drawSide(L) { const el = $('pdSide'); if (el && L) el.innerHTML = slipCard() + followCard() + resultsCard() + fadeCard(L) }

  /* ---------- actions ---------- */
  function openPick(id) {
    const p = allPicks().find(x => x.id === id); if (!p) return;
    if (p.type === 'prop') return window.flLab?.open(window.flEdge.labArgs(p));
    const m = p.m, team = m.pick === 'away' ? m.away : m.home;
    if (p.sport === 'cfb') return window.flHub?.open({ sport: 'football', lg: m.lg, id: m.id });
    window.flLab?.open({ sport: p.sport, name: team, team: true });
  }
  function oldPicks(tab) {   // the match-by-match soccer picks and the full record still live on the soccer page
    window.flPages.hide();
    const go = () => { try { S.picksTab = tab; openPicks() } catch (e) {} };
    if (window.S?.sport !== 'soccer') { document.querySelector('.tbs[data-sport="soccer"], .fsn[data-sport="soccer"]')?.click(); setTimeout(go, 250) } else go();
  }
  document.addEventListener('click', e => {
    const pg = e.target.closest('#pg-predictions'); if (!pg) return;
    const t = e.target.closest('button, a, article'); if (!t) return;
    const d = t.dataset;
    if (d.pdsport) { P.sport = d.pdsport; P.all = false; if (P.sport !== 'all') window.flRecent?.note({ kind: 'filters', key: 'filters:predictions', label: `Predictions for ${t.firstChild?.textContent?.trim() || P.sport}`, sub: 'The last filter you chose', open: { page: 'predictions', filters: { sport: P.sport } } }); return draw() }
    if (d.pdwhen) { P.when = d.pdwhen; P.all = false; return draw() }
    if (d.pdmin != null) { P.min = +d.pdmin; P.all = false; return draw() }
    if (d.pdev) return toggleEvidence(d.pdev);
    if (d.pdgrp) { if (P.grp.has(d.pdgrp)) P.grp.delete(d.pdgrp); else P.grp.add(d.pdgrp); return draw() }
    if (d.pdboard) { const p = allPicks().find(x => keyOf(x) === d.pdboard); return p && window.flBoards?.offer(pickItem(p, d.pdboard), t) }
    if (d.pdshare || d.pdshareev) { const p = allPicks().find(x => x.id === (d.pdshare || d.pdshareev)); return p && window.flShare?.share(shareOpts(p, !!d.pdshareev), t) }
    if (d.pdevretry) { const p = allPicks().find(x => x.id === d.pdevretry); if (p) { loadEvidence(p, true); draw() } return }
    if (d.pdadd) return toggle(d.pdadd);
    if (d.pdfollow) { const p = allPicks().find(x => keyOf(x) === d.pdfollow); if (p) return follow(p); P.follow = P.follow.filter(f => f.k !== d.pdfollow); saveFollow(); return draw() }
    if (d.pdopen) return openPick(d.pdopen);
    if (d.pdlab) { try { window.flLab?.open(JSON.parse(d.pdlab)) } catch (x) {} return }
    if (d.pdload) { const s = P.slips.find(x => x.id === d.pdload); if (s) { P.slip = s.legs.map(l => ({ ...l })); syncSlip(); P.saved = 0; draw() } return }
    if (d.pddel) { P.confirm = d.pddel; return draw() }
    if (d.pdyes) { P.slips = P.slips.filter(x => x.id !== d.pdyes); P.confirm = null; saveSlips(); return draw() }
    if (d.pd === 'keep') { P.confirm = null; return draw() }
    if (d.pd === 'save') return saveSlip();
    if (d.pd === 'track') { const live = new Map(allPicks().map(p => [p.id, p])); return window.flParlays?.build(P.slip.map(l => live.get(l.id) || { gone: true })) }   // the slip becomes a parlay to lock in and follow
    if (d.pd === 'sharecard') return shareCard();
    if (d.pd === 'empty') { P.slip = []; store.set('fl.slip', P.slip); P.saved = 0; return draw() }
    if (d.pd === 'all') { P.all = !P.all; return draw() }
    if (d.pd === 'clear') { Object.assign(P, { sport: 'all', when: 'tonight', min: 0, kind: 'all', group: 'player', priced: false, clean: false, mine: false, all: false }); return draw() }
    if (d.pd === 'more') { P.more = !P.more; draw(); if (P.more) $('pdMore')?.querySelector('select, input')?.focus({ preventScroll: true }); return }
    if (d.pd === 'src') { P.srcOpen = !P.srcOpen; return draw() }
    if (d.pd === 'reload') { P.retries = 0; return load(true) }
    if (d.pd === 'soccer') return oldPicks('today');
    if (d.pd === 'record') return oldPicks('record');
    if (t.matches('article[data-pk]') && !e.target.closest('button, a, select, label, .pd-ev, .pd-evbar, .pd-grpf, .pd-grpl') && !String(getSelection?.() || '')) { toggleEvidence(d.pdk); return document.querySelector(`#pg-predictions [data-pdk="${CSS.escape(d.pdk)}"] .pd-open`)?.focus({ preventScroll: true }) }   // anywhere on the card: the evidence
  });
  document.addEventListener('change', e => {
    const sel = e.target.closest?.('#pg-predictions [data-pdsel]');
    if (sel) { const k = sel.dataset.pdsel, v = sel.value; P[k] = k === 'min' ? +v : v; P.all = false;
      if (k === 'sport' && v !== 'all') window.flRecent?.note({ kind: 'filters', key: 'filters:predictions', label: `Predictions for ${SPORT_NAME[v] || v}`, sub: 'The last filter you chose', open: { page: 'predictions', filters: { sport: v } } });
      return draw() }
    const ck = e.target.closest?.('#pg-predictions [data-pdchk]'); if (ck) { P[ck.dataset.pdchk] = ck.checked; P.all = false; return draw() }
    const al = e.target.dataset?.pdalert; if (al != null) { const f = P.follow.find(x => x.k === al); if (f) { f.alert = e.target.value === '' ? null : +e.target.value; saveFollow(); draw() } } });
  setInterval(() => { if (window.flPages.current() !== 'predictions' || document.hidden) return; document.querySelectorAll('#pg-predictions [data-pdago]').forEach(t => { const x = ago(+t.dataset.pdago); if (t.textContent !== x) t.textContent = x }) }, 5000);
  // the tab comes back: check every pick again at once (a game may have started while it was hidden), then reload if old
  document.addEventListener('visibilitychange', () => { if (document.hidden || window.flPages.current() !== 'predictions') return; P.tz = MK.localTz(); draw(); if (Date.now() - P.at > 5 * 60000) load(true) });
  // a folded section stays open or closed through redraws
  document.addEventListener('toggle', e => { const f = e.target?.dataset?.pdfold; if (f) { if (e.target.open) P.fold.add(f); else P.fold.delete(f) } }, true);
  // a schedule changed (a start, a delay, a final) or a provider answered: check again
  document.addEventListener('fl:schedule', () => { if (window.flPages.current() === 'predictions') redraw() });
  // saved slips follow the account
  document.addEventListener('fl:me', () => { const mine = window.S?.me?.prefs?.slips; if (!Array.isArray(mine)) return;
    const have = new Set(P.slips.map(s => s.id)); const merged = [...P.slips, ...mine.filter(s => s && s.id && Array.isArray(s.legs) && !have.has(s.id))].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
    if (merged.length !== P.slips.length) { P.slips = merged; saveSlips(); draw() } });

  window.flPages.add('predictions', { title: 'Predictions', render,
    onShow() { load(); clearInterval(P.timer); P.timer = setInterval(() => { if (window.flPages.current() !== 'predictions') return; if (Date.now() - P.at > 5 * 60000) load(true); else if (!document.activeElement?.closest?.('#pg-predictions select')) draw() }, 60000) },
    onHide() { clearInterval(P.timer); clearTimeout(P.retryT) } });
  window.flPredictions = { combine, state: P, picks: allPicks, sources, load };   // not flPred: that is the match prediction card in predict.js
  // the Lab's research panel adds to the Prediction Card (the slip) and follows picks with the same lists this page keeps
  window.flPredictions.cardCanvas = cardCanvas;
  window.flPredictions.slip = { has: inSlip, toggle(p) { if (inSlip(p.id) || allPicks().some(x => x.id === p.id)) return toggle(p.id); if (P.slip.length >= 12) return window.toast?.('A Prediction Card holds up to 12 picks'); P.slip.push(leg(p)); store.set('fl.slip', P.slip); P.saved = 0; draw() } };
  window.flPredictions.follow = { has: p => !!following(p), toggle: follow };
})();
