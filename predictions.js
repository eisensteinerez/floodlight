/* Floodlight · Predictions: the edge board.
   Every pick here is one of two real things:
   - a player prop from the Lab's board (edge.js): "ours" is the Lab's heat reading for that side of the line, "market"
     is a two-sided book price at the same line with the margin taken out;
   - a match forecast the server has made (forecaster.py): "ours" is the forecast's chance for its pick, "market" is the
     book's chance for the same outcome with the margin taken out.
   Edge is always our number minus the market's, in whole points. A pick with no market price has no edge and is listed
   apart. Results come from the graded record of match forecasts (record.py); prop picks are not graded yet, and the page
   says so. Nothing here changes how a number is worked out. */
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
  const MIN = [[0, 'Any edge'], [3, '3+'], [5, '5+'], [10, '10+']];
  const SORT = [['edge', 'Biggest edge'], ['conf', 'Most confident'], ['soon', 'Starting soonest']];
  const LIVE_FOR = 5 * 3600e3;   // a started prop stays in "Live" this long; nothing tells us when its game ends
  const P = { sport: 'all', when: 'tonight', min: 0, sort: 'edge', props: null, matches: null, record: null, loading: false, at: 0, denied: false, all: false,
    slip: store.get('fl.slip', []), slips: store.get('fl.slips', []), confirm: null, saved: 0, timer: 0 };

  /* ---------- data ---------- */
  const get = url => fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || String(r.status)); e.status = r.status; throw e } return d });
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
  async function load(force) {
    if (P.loading) return; if (!force && P.at && Date.now() - P.at < 5 * 60000) return;
    P.loading = true; draw();
    const [props, fc, rec] = await Promise.all([
      window.flEdge ? window.flEdge.props(null, force) : Promise.resolve({ picks: [], by: {}, denied: false }),
      get('/api/forecast/list').catch(e => ({ matches: [], error: e.message, status: e.status })),
      get('/api/record').catch(e => ({ entries: [], error: e.message })),
    ]);
    P.props = props; P.denied = !!props.denied && (fc.status === 401 || fc.status === 403);
    P.matches = (fc.matches || []).map(matchPick); P.fcError = fc.error || ''; P.record = rec.entries || []; P.recError = rec.error || '';
    P.loading = false; P.at = Date.now(); syncSlip(); draw();
  }
  const allPicks = () => [...(P.props?.picks || []).map(p => ({ ...p, short: `${p.name.split(' ').slice(-1)[0]} ${p.text.toLowerCase()}` })), ...(P.matches || [])];
  const stateOf = (p, now) => !p.start || p.start > now ? 'pre' : p.type === 'prop' ? (now - p.start < LIVE_FOR ? 'live' : 'gone') : 'live';
  const dayStart = (d, add = 0) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + add); return x };
  function inWhen(p, now) {
    if (!p.start) return P.when !== 'tomorrow';   // a line with no start time is on today's board
    const t0 = dayStart(now), t1 = dayStart(now, 1), t2 = dayStart(now, 2), t7 = dayStart(now, 7);
    return P.when === 'tonight' ? p.start >= t0 && p.start < t1 : P.when === 'tomorrow' ? p.start >= t1 && p.start < t2 : p.start >= t0 && p.start < t7;
  }
  const time = d => !d ? 'Today' : (dayStart(d).getTime() === dayStart(new Date()).getTime() ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' ') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function lists() {
    const now = new Date(), every = allPicks(), bySport = every.filter(p => P.sport === 'all' || p.sport === P.sport);
    const live = bySport.filter(p => stateOf(p, now) === 'live');
    const pre = bySport.filter(p => stateOf(p, now) === 'pre' && inWhen(p, now));
    const cmp = { edge: (a, b) => b.edge - a.edge || b.ours - a.ours, conf: (a, b) => b.ours - a.ours, soon: (a, b) => (a.start || 0) - (b.start || 0) || b.ours - a.ours }[P.sort];
    const ranked = pre.filter(p => p.edge != null && p.edge >= P.min).sort(cmp);
    const bare = P.min > 0 ? [] : pre.filter(p => p.edge == null).sort(P.sort === 'soon' ? cmp : (a, b) => b.ours - a.ours);
    const done = (P.record || []).filter(e => ['won', 'lost'].includes(e.result) && e.ko * 1000 > now - 27 * 3600e3 && (P.sport === 'all' || (e.sport === 'soccer' ? 'soccer' : e.lg === 'nfl' ? 'nfl' : 'cfb') === P.sport)).sort((a, b) => b.ko - a.ko);
    return { every, live, ranked, bare, done, sports: SPORT_ORDER.filter(s => every.some(p => p.sport === s)) };
  }

  /* ---------- the page ---------- */
  function render(el) {
    el.innerHTML = `<div class="vst pd">
      <header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Predictions</h1><p class="pg-sub">Where our numbers disagree with the market, ranked by edge.</p></div></header>
      <div class="pd-filters" id="pdFilters"></div>
      <div class="g2 pd-cols"><div class="vst pd-board" id="pdBoard" aria-live="polite"></div><aside class="vst pd-side" id="pdSide" aria-label="Your slip and our results"></aside></div>
      <p class="lb pd-note">These are estimates from past games and posted prices, not guarantees. <a class="lk" href="#/guide/predictions" data-page="guide" data-arg="predictions">How we work out an edge</a></p>
      <section class="card pd-more" aria-label="More prediction tools"><div class="sec-h"><h2>More prediction tools</h2></div>
        <div class="cx-row"><button type="button" class="cx" data-pd="soccer">${ic('soccer', 18)}Soccer picks, match by match</button><button type="button" class="cx" data-pd="record">${ic('trophy', 18)}Full record of match picks</button><button type="button" class="cx" data-shell="lab">${ic('lab', 18)}Open the Lab</button></div></section>
    </div>`;
    draw();
  }
  function keep(fn) {   // repaint without losing the keyboard's place
    const a = document.activeElement, k = a?.closest?.('[data-fk]')?.dataset.fk; fn();
    if (k) { const b = [...document.querySelectorAll('#pg-predictions [data-fk]')].find(x => x.dataset.fk === k); b?.focus({ preventScroll: true }) }
  }
  function draw() { if (!$('pdBoard')) return; keep(() => { const L = lists(); drawFilters(L); drawBoard(L); drawSide(L) }) }

  function drawFilters(L) {
    const chip = (k, l, n) => `<button type="button" class="cx" role="radio" aria-checked="${P.sport === k}" tabindex="${P.sport === k ? 0 : -1}" data-pdsport="${k}" data-fk="sp-${k}">${esc(l)}${n != null ? `<span class="num pd-n">${n}</span>` : ''}</button>`;
    const now = new Date(), count = s => L.every.filter(p => (s === 'all' || p.sport === s) && stateOf(p, now) !== 'gone').length;
    const seg = (name, label, opts, cur) => `<div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" tabindex="${cur === k ? 0 : -1}" data-pd${name}="${k}" data-fk="${name}-${k}">${esc(l)}</button>`).join('')}</div>`;
    $('pdFilters').innerHTML = `<div class="cx-row scroll" role="radiogroup" aria-label="Sport">${chip('all', 'All sports', count('all'))}${L.sports.map(s => chip(s, SPORT_NAME[s], count(s))).join('')}</div>
      <div class="pd-ctl">${seg('when', 'When', WHEN, P.when)}<div class="pd-min"><span class="lb" id="pdMinL">Minimum edge</span>${seg('min', 'Minimum edge', MIN, P.min)}</div>
        <label class="fl-f pd-sort"><span class="sr-only">Sort by</span><select class="inp" id="pdSort" data-fk="sort">${SORT.map(([k, l]) => `<option value="${k}"${P.sort === k ? ' selected' : ''}>Sort: ${esc(l.toLowerCase())}</option>`).join('')}</select></label></div>`;
  }

  const inSlip = id => P.slip.some(l => l.id === id);
  const edgeTxt = e => e == null ? '–' : (e > 0 ? '+' : e < 0 ? '−' : '') + Math.abs(e);
  function card(p, rank, now) {
    const st = stateOf(p, now), on = inSlip(p.id);
    const when = st === 'live' ? `<span class="pl live"><i></i>Live</span>` : esc(time(p.start));
    const badge = p.heat != null ? window.flHeat.badge(p.heat) : p.conf ? `<span class="pl">${esc(p.conf)}</span>` : '';
    const bar = (label, v, cls) => `<div class="pd-bar ${cls}"><dt>${label}</dt><dd>${v == null ? `<span class="lb">No two-sided price posted</span>` : `<span class="trak"><i style="width:${pct(v)}%"></i></span><b class="num">${pct(v)}%</b>`}</dd></div>`;
    return `<article class="card pd-pk${p.edge != null && p.edge < 0 ? ' neg' : ''}" data-pk="${esc(p.id)}">
      <div class="pd-top">${rank ? `<span class="pd-rank num" aria-hidden="true">${rank}</span>` : ''}${face(p.photo, p.name, 'avx av-lg' + (p.type === 'match' ? ' crest' : ''))}
        <button type="button" class="pd-open" data-pdopen="${esc(p.id)}" data-fk="open-${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.text)}</span><small>${esc([p.type === 'prop' ? p.game : p.text === 'Draw' ? '' : p.game, SPORT_NAME[p.sport]].filter(Boolean).join(' · '))}${st === 'live' ? '' : ' · ' + when}</small><span class="sr-only">. Open in the Lab</span></button>
        <span class="pd-tags">${st === 'live' ? when : ''}${badge}</span>
        <div class="pd-edge"><span class="lb">Edge</span><b class="num">${edgeTxt(p.edge)}</b>${p.edge == null ? '<span class="sr-only">no market price</span>' : ''}</div>
        <button type="button" class="ib solid pd-add" data-pdadd="${esc(p.id)}" data-fk="add-${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(p.name)}, ${esc(p.text)}, ${on ? 'from' : 'to'} your slip">${ic(on ? 'check' : 'plus', 20)}</button></div>
      <dl class="pd-bars">${bar('Our number', p.ours, 'ours')}${bar('Market', p.market, 'mkt')}</dl>
      ${p.reasons.length ? `<ul class="cx-row pd-why" aria-label="Why">${p.reasons.map(r => `<li class="pl">${esc(r)}</li>`).join('')}</ul>` : ''}</article>`;
  }
  const skel = n => Array.from({ length: n }, () => `<div class="card pd-pk"><div class="skl" style="height:56px"></div><div class="skl" style="height:14px;margin-top:18px"></div><div class="skl" style="height:14px;margin-top:10px"></div></div>`).join('');
  function drawBoard(L) {
    const el = $('pdBoard'), now = new Date();
    if (P.loading && !P.props) { el.innerHTML = `<p class="sr-only">Loading tonight's picks.</p>${skel(4)}`; return }
    if (P.denied) { el.innerHTML = `<div class="card emp">${ic('members', 28)}<b>Predictions aren't part of your access yet</b><p>Your admin decides which parts of Floodlight each member can open. Ask them to switch Predictions on for you.</p><button type="button" class="bt" data-page="members">See your access</button></div>`; return }
    const CAP = 12, shown = P.all ? L.ranked : L.ranked.slice(0, CAP);
    let h = '';
    if (L.live.length) h += `<section aria-label="Live picks"><div class="sec-h"><h2>Live</h2><span class="lb">The game has started, so the price has moved</span></div><div class="vst pd-list">${L.live.map(p => card(p, 0, now)).join('')}</div></section>`;
    if (shown.length) h += `<section aria-label="The edge board"><div class="sec-h"><h2>${L.live.length ? 'Still to start' : 'The edge board'}</h2><span class="lb">${L.ranked.length} ${L.ranked.length === 1 ? 'pick' : 'picks'} with a market price</span></div><div class="vst pd-list">${shown.map((p, i) => card(p, i + 1, now)).join('')}</div>
      ${L.ranked.length > CAP ? `<button type="button" class="bt ghost wide" data-pd="all" data-fk="all">${P.all ? 'Show the top ' + CAP : `Show all ${L.ranked.length}`}</button>` : ''}</section>`;
    if (L.bare.length) h += `<section aria-label="Picks with no market price"><div class="sec-h"><h2>Our number only</h2><span class="lb">No book posts both sides of these lines, so there is no edge to rank</span></div><div class="vst pd-list">${L.bare.slice(0, P.all ? 60 : 6).map(p => card(p, 0, now)).join('')}</div>
      ${L.bare.length > 6 && !L.ranked.length ? `<button type="button" class="bt ghost wide" data-pd="all" data-fk="all">${P.all ? 'Show fewer' : `Show all ${L.bare.length}`}</button>` : ''}</section>`;
    if (L.done.length) h += `<section aria-label="Finished in the last day"><div class="sec-h"><h2>Finished</h2><span class="lb">Results stay here for a day</span></div><div class="card pd-done">${L.done.map(e => { const hit = e.result === 'won', pick = e.pick === 'draw' ? 'Draw' : `${e[e.pick]} to win`;
      return `<div class="rw"><span class="rw-t"><b>${esc(pick)}</b><small>${esc(e.home)} ${Array.isArray(e.final) ? `${e.final[0]}–${e.final[1]}` : 'v'} ${esc(e.away)} · we said ${pct(e.top)}%</small></span><span class="pl pd-res ${hit ? 'hit' : 'miss'}">${ic(hit ? 'check' : 'x', 14)}${hit ? 'Hit' : 'Miss'}</span></div>` }).join('')}</div></section>`;
    if (!L.live.length && !shown.length && !L.bare.length) {
      const any = L.every.some(p => stateOf(p, now) !== 'gone'), filtered = P.sport !== 'all' || P.when !== 'tonight' || P.min > 0;
      const checked = Object.values(P.props?.by || {}).filter(r => !r.error).map(r => SPORT_NAME[r.sport]).filter(Boolean);
      h = `<div class="card emp">${ic('pred', 28)}<b>${any && filtered ? 'No picks match these filters' : 'No picks on the board right now'}</b>
        <p>${any && filtered ? `Nothing ${P.sport === 'all' ? '' : 'in ' + esc(SPORT_NAME[P.sport]) + ' '}${P.when === 'tonight' ? 'tonight' : P.when === 'tomorrow' ? 'tomorrow' : 'this week'}${P.min ? ` has an edge of ${P.min} or more` : ''}. Widen the filters to see the rest.`
          : `A pick appears when PrizePicks or Sleeper posts a player line, or when a match you follow gets a forecast. ${checked.length ? `Checked just now: ${esc(checked.join(', '))}.` : ''}`}</p>
        ${any && filtered ? `<button type="button" class="bt" data-pd="clear" data-fk="clear">Clear the filters</button>` : `<button type="button" class="bt ghost" data-pd="reload" data-fk="reload">Check again</button>`}</div>` + h;
    }
    el.innerHTML = h;
  }

  /* ---------- the slip ---------- */
  // Legs from different games are independent, so their chances multiply. Legs from one game move together; for those
  // only the limits are known: no higher than the least likely leg, no lower than the sum of chances minus (legs - 1).
  function combine(legs, key) {
    const groups = new Map(); for (const l of legs) { if (l[key] == null) return null; groups.set(l.gameKey, [...(groups.get(l.gameKey) || []), l[key]]) }
    let lo = 1, hi = 1, linked = false;
    for (const ps of groups.values()) { if (ps.length === 1) { lo *= ps[0]; hi *= ps[0] } else { linked = true; lo *= Math.max(0, ps.reduce((a, b) => a + b, 0) - (ps.length - 1)); hi *= Math.min(...ps) } }
    return { lo, hi, linked };
  }
  const range = c => c.linked && pct(c.lo) !== pct(c.hi) ? `${pct(c.lo)}–${pct(c.hi)}%` : `${pct(c.linked ? c.hi : c.lo)}%`;
  function syncSlip() {   // legs keep the numbers they were added at, until the same pick is on the board again
    const live = new Map(allPicks().map(p => [p.id, p]));
    P.slip = P.slip.map(l => { const p = live.get(l.id); return p ? leg(p) : l }); store.set('fl.slip', P.slip);
  }
  const leg = p => ({ id: p.id, name: p.name, text: p.text, short: p.short || `${p.name} ${p.text}`, ours: p.ours, market: p.market, gameKey: p.gameKey, game: p.game, sport: p.sport });
  function toggle(id) {
    const i = P.slip.findIndex(l => l.id === id);
    if (i >= 0) P.slip.splice(i, 1); else { const p = allPicks().find(x => x.id === id); if (!p) return; if (P.slip.length >= 12) return window.toast?.('A slip holds up to 12 picks'); P.slip.push(leg(p)) }
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
  function slipCard() {
    const n = P.slip.length, ours = n ? combine(P.slip, 'ours') : null, mk = n ? combine(P.slip, 'market') : null, noMk = P.slip.filter(l => l.market == null).length;
    const games = [...new Set(P.slip.filter(l => P.slip.filter(x => x.gameKey === l.gameKey).length > 1).map(l => l.game))];
    return `<section class="card pd-slip${n ? ' has' : ''}" aria-label="Your slip"><div class="sec-h"><h2>Your slip</h2>${n ? `<span class="pl">${n} ${n === 1 ? 'pick' : 'picks'}</span>` : ''}</div>
      ${n ? `<ul class="pd-legs">${P.slip.map(l => `<li><span class="rw-t"><b>${esc(l.short)}</b><small>${esc(l.game || '')}</small></span><b class="num">${pct(l.ours)}%</b><button type="button" class="ib pd-rm" data-pdadd="${esc(l.id)}" data-fk="rm-${esc(l.id)}" aria-label="Remove ${esc(l.short)} from your slip">${ic('x', 16)}</button></li>`).join('')}</ul>
        <div class="pd-total"><div><span class="pd-k">${n === 1 ? 'Chance it hits' : `Chance all ${n} hit`}</span><b class="num pd-big">${range(ours)}</b></div><div class="pd-mk"><span class="pd-k">Market says</span><b class="num">${mk ? range(mk) : '–'}</b></div></div>
        <p class="pd-warn">${games.length ? `${ic('help', 16)}<span><b>Linked picks.</b> ${games.length === 1 ? `More than one pick comes from ${esc(games[0] || 'the same game')}` : 'Some picks come from the same games'}, so they move together and can't be multiplied. The range shows the limits the true chance sits between.</span>`
          : n > 1 ? `<span>No two picks come from the same game, so the chances are multiplied together.</span>` : `<span>Add another pick to see the chance they all hit.</span>`}${noMk ? `<span> ${noMk === n ? 'None of these picks has' : `${noMk} of these picks ${noMk === 1 ? 'has' : 'have'}`} no market price, so there is no market number for the slip.</span>` : ''}</p>
        <div class="pd-acts"><button type="button" class="bt wide pd-save" data-pd="save" data-fk="save">${ic('save', 18)}Save slip</button><button type="button" class="bt ghost pd-clear" data-pd="empty" data-fk="empty">Clear</button></div>
        <p class="pd-said" role="status">${P.saved ? `Saved. ${window.S?.me ? 'It is kept with your account.' : 'It is kept in this browser; log in to keep it with your account.'}` : ''}</p>`
        : `<p class="pd-empty">Your slip is empty. Press ${ic('plus', 14)}<span class="sr-only">the plus button</span> on a pick to add it, and see the chance they all hit.</p>`}
      ${P.slips.length ? `<div class="pd-saved"><span class="pd-k">Saved slips</span>${P.slips.slice(0, 3).map(s => { const c = combine(s.legs, 'ours');
        return P.confirm === s.id ? `<div class="pd-sv"><span class="rw-t"><b>Delete “${esc(s.name)}”?</b></span><button type="button" class="bt sm danger" data-pdyes="${s.id}" data-fk="yes-${s.id}">Delete slip</button><button type="button" class="bt sm ghost" data-pd="keep" data-fk="keepit">Keep it</button></div>`
          : `<div class="pd-sv"><button type="button" class="pd-load" data-pdload="${s.id}" data-fk="load-${s.id}"><b>${esc(s.name)}</b><small>${c ? range(c) + ' at the time' : ''}</small></button><button type="button" class="ib pd-rm" data-pddel="${s.id}" data-fk="del-${s.id}" aria-label="Delete the saved slip ${esc(s.name)}">${ic('x', 16)}</button></div>` }).join('')}</div>` : ''}</section>`;
  }

  /* ---------- how we have done ---------- */
  const BUCKETS = [[0, 45, 'Under 45%'], [45, 55, '45–54%'], [55, 65, '55–64%'], [65, 75, '65–74%'], [75, 101, '75%+']];
  function results() {
    const since = Date.now() / 1000 - 90 * 86400, rows = (P.record || []).filter(e => ['won', 'lost'].includes(e.result) && e.ko >= since && e.top);
    const buckets = BUCKETS.map(([lo, hi, label]) => { const xs = rows.filter(e => e.top * 100 >= lo && e.top * 100 < hi), n = xs.length;
      return { label, n, said: n ? xs.reduce((a, e) => a + e.top, 0) / n : null, hit: n ? xs.filter(e => e.result === 'won').length / n : null } });
    const won = rows.filter(e => e.result === 'won').length, priced = rows.filter(e => e.market && typeof e.market[e.pick] === 'number');
    const vs = priced.length ? (priced.filter(e => e.result === 'won').length / priced.length - priced.reduce((a, e) => a + e.market[e.pick], 0) / priced.length) * 100 : null;
    return { n: rows.length, rate: rows.length ? won / rows.length : null, buckets, vs, priced: priced.length };
  }
  function resultsCard() {
    const R = results(), H = 120, col = v => v == null ? 0 : Math.max(3, Math.round(v * H));
    if (!R.n) return `<section class="card pd-res-card" aria-label="How we have done"><div class="sec-h"><h2>How we have done</h2></div>
      <div class="emp">${ic('bars', 26)}<b>No graded picks in the last 90 days</b><p>${P.recError ? 'The record did not load. ' : ''}A match forecast is graded when the match ends, and its result is counted here, good or bad. Player props are not graded yet.</p></div></section>`;
    const vsTxt = R.vs == null ? '–' : (R.vs > 0 ? '+' : R.vs < 0 ? '−' : '') + Math.abs(R.vs).toFixed(1);
    return `<section class="card pd-res-card" aria-label="How we have done"><div class="sec-h"><h2>How we have done</h2></div>
      <p class="lb">When we said a pick would hit X% of the time, how often did it? Match forecasts, last 90 days.</p>
      <div class="pd-cal" role="img" aria-label="${esc(R.buckets.filter(b => b.n).map(b => `${b.label}: we said ${pct(b.said)}%, it hit ${pct(b.hit)}%, ${b.n} picks`).join('. '))}">${R.buckets.map(b => `<div class="pd-col${b.n ? '' : ' none'}" title="${esc(b.n ? `${b.label}: we said ${pct(b.said)}% on average, ${pct(b.hit)}% hit, ${b.n} ${b.n === 1 ? 'pick' : 'picks'}` : `${b.label}: no picks`)}">
          <div class="pd-pair" style="height:${H + 22}px"><span class="said" style="height:${col(b.said)}px"><i class="num">${b.n ? pct(b.said) : ''}</i></span><span class="hit" style="height:${col(b.hit)}px"><i class="num">${b.n ? pct(b.hit) : ''}</i></span></div>
          <b>${esc(b.label)}</b><small class="num">${b.n ? `${b.n} ${b.n === 1 ? 'pick' : 'picks'}` : 'none'}</small></div>`).join('')}</div>
      <div class="pd-leg" aria-hidden="true"><span><i class="said"></i>We said</span><span><i class="hit"></i>It hit</span></div>
      <details class="pd-tbl"><summary>See the numbers</summary><div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">We said</th><th scope="col" class="r">Average</th><th scope="col" class="r">It hit</th><th scope="col" class="r">Picks</th></tr></thead>
        <tbody>${R.buckets.map(b => `<tr><th scope="row">${esc(b.label)}</th><td class="r num">${b.n ? pct(b.said) + '%' : '–'}</td><td class="r num">${b.n ? pct(b.hit) + '%' : '–'}</td><td class="r num">${b.n}</td></tr>`).join('')}</tbody></table></div></details>
      <div class="pd-tiles"><div class="tile inset"><span class="lb">Picks</span><b class="fig num">${R.n}</b></div><div class="tile inset"><span class="lb">Hit rate</span><b class="fig num">${pct(R.rate)}%</b></div>
        <div class="tile inset"><span class="lb">Against the market</span><b class="fig num">${vsTxt}</b><small class="lb">${R.vs == null ? 'no prices saved' : `points ${R.vs >= 0 ? 'ahead' : 'behind'}, over ${R.priced} priced ${R.priced === 1 ? 'pick' : 'picks'}`}</small></div></div>
      <p class="lb">“Against the market” is our hit rate minus the chance the book's prices gave the same picks. Player props are not graded yet, so they are not counted.</p></section>`;
  }
  function fadeCard(L) {
    const now = new Date(), cold = window.flEdge ? window.flEdge.cold((P.props?.picks || []).filter(p => stateOf(p, now) !== 'gone'), 3) : [];
    return `<section class="card pd-fade" aria-label="Fade list"><div class="sec-h"><h2>Fade list</h2><span class="lb">The coldest players tonight</span></div>
      ${cold.length ? cold.map(p => `<button type="button" class="rw" data-pdlab="${esc(JSON.stringify(window.flEdge.labArgs(p)))}" data-fk="fade-${esc(p.id)}">${face(p.photo, p.name)}<span class="rw-t"><b>${esc(p.name)}</b><small>${esc(`${p.label} · line ${window.flEdge.fmt(p.line)}`)}</small></span>${window.flHeat.badge(p.heat)}</button>`).join('')
        : `<p class="lb">${P.loading ? 'Loading…' : 'Nobody with a line posted tonight reads cold. A player lands here when their heat reading is under 40.'}</p>`}</section>`;
  }
  function drawSide(L) { $('pdSide').innerHTML = slipCard() + (P.loading && !P.record ? `<div class="card"><div class="skl" style="height:220px"></div></div>` : resultsCard()) + fadeCard(L) }

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
    if (d.pdsport) { P.sport = d.pdsport; P.all = false; return draw() }
    if (d.pdwhen) { P.when = d.pdwhen; P.all = false; return draw() }
    if (d.pdmin != null) { P.min = +d.pdmin; P.all = false; return draw() }
    if (d.pdadd) return toggle(d.pdadd);
    if (d.pdopen) return openPick(d.pdopen);
    if (d.pdlab) { try { window.flLab?.open(JSON.parse(d.pdlab)) } catch (x) {} return }
    if (d.pdload) { const s = P.slips.find(x => x.id === d.pdload); if (s) { P.slip = s.legs.map(l => ({ ...l })); syncSlip(); P.saved = 0; draw() } return }
    if (d.pddel) { P.confirm = d.pddel; return draw() }
    if (d.pdyes) { P.slips = P.slips.filter(x => x.id !== d.pdyes); P.confirm = null; saveSlips(); return draw() }
    if (d.pd === 'keep') { P.confirm = null; return draw() }
    if (d.pd === 'save') return saveSlip();
    if (d.pd === 'empty') { P.slip = []; store.set('fl.slip', P.slip); P.saved = 0; return draw() }
    if (d.pd === 'all') { P.all = !P.all; return draw() }
    if (d.pd === 'clear') { P.sport = 'all'; P.when = 'tonight'; P.min = 0; return draw() }
    if (d.pd === 'reload') return load(true);
    if (d.pd === 'soccer') return oldPicks('today');
    if (d.pd === 'record') return oldPicks('record');
    if (t.matches('article[data-pk]') && !e.target.closest('button, a') && !String(getSelection?.() || '')) return openPick(d.pk);   // anywhere on the card
  });
  document.addEventListener('change', e => { if (e.target.id === 'pdSort') { P.sort = e.target.value; draw() } });
  // saved slips follow the account
  document.addEventListener('fl:me', () => { const mine = window.S?.me?.prefs?.slips; if (!Array.isArray(mine)) return;
    const have = new Set(P.slips.map(s => s.id)); const merged = [...P.slips, ...mine.filter(s => s && s.id && Array.isArray(s.legs) && !have.has(s.id))].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
    if (merged.length !== P.slips.length) { P.slips = merged; saveSlips(); draw() } });

  window.flPages.add('predictions', { title: 'Predictions', render,
    onShow() { load(); clearInterval(P.timer); P.timer = setInterval(() => { if (window.flPages.current() !== 'predictions') return; if (Date.now() - P.at > 5 * 60000) load(true); else if (!document.activeElement?.closest?.('#pg-predictions select')) draw() }, 60000) },
    onHide() { clearInterval(P.timer) } });
  window.flPredictions = { combine, results, state: P };   // not flPred: that is the match prediction card in predict.js
})();
