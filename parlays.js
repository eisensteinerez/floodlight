/* Floodlight · Parlays: build a parlay before its games start, then follow it live.
   The sums are in parlaycore.js. This file is the page: the builder, the live cards, the finished list and the record.

   What each number on a card is, so nothing here reads as more than it is:
     Our live read    the site's own estimate from the score, the time left and what was expected before the start
     Books right now  what Kalshi, FanDuel, DraftKings and Polymarket post for the same pick this minute, margin taken out
     At the start     the number the pick had when the parlay was locked in
   A pick with no live count or no live price says so. Nothing is filled in. */
(() => {
  const C = window.flParlay; if (!C || !window.flPages) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const pct = x => Math.round(x * 100), fmt = C.fmt;
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(name)}</span></span>`;
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const when = t => (sameDay(t, Date.now()) ? '' : new Date(t).toLocaleDateString([], { weekday: 'short' }) + ' ') + clock(t);
  const dayOf = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const LEAGUES = ['nba', 'nfl', 'nhl', 'mlb', 'cfb', 'cbb', 'wnba', 'soccer'];
  const MAX = 12;

  const V = { open: false, tab: 'games', lg: store.get('fl.parlayLg', 'nba'), day: 0, games: null, gamesFor: '', gamesLoading: false, exp: '', lines: {}, q: '', props: null, propsLoading: false,
    draft: store.get('fl.parlayDraft', { legs: [], name: '', odds: '', stake: '' }), saving: false, err: '', said: '',
    live: new Map(), closeCand: new Map(), closeTried: new Set(), unfold: new Set(), at: 0, busy: false, timer: 0, all: false, confirm: '', edit: '', trail: store.get('fl.parlayTrail', {}) };
  if (!Array.isArray(V.draft?.legs)) V.draft = { legs: [], name: '', odds: '', stake: '' };
  // the draft is kept in this browser, and offered on Home's "Continue researching" while it has picks
  const saveDraft = () => { store.set('fl.parlayDraft', V.draft); const legs = V.draft.legs;
    try { if (legs.length) window.flRecent?.note({ kind: 'parlay', key: 'parlay-draft', label: `Your unfinished ${legs.length}-pick parlay`, sub: legs.slice(0, 2).map(l => l.short || l.text).join(' · '), open: { parlay: true } });
      else window.flRecent?.drop?.('parlay-draft') } catch (e) {} };

  /* ---------- following the games ---------- */
  const unsettled = p => p.legs.some(l => !l.res);
  // every parlay with a pick still to be decided. A parlay that has already lost keeps its other picks moving, so each one still gets its result.
  const tracked = () => C.list().filter(p => unsettled(p) && Math.max(...p.legs.map(l => l.start)) > Date.now() - 4 * 864e5);
  const info = (p, l) => V.live.get(p.id + '|' + l.id) || {};
  async function follow(p, l, force) {
    const k = p.id + '|' + l.id, was = V.live.get(k) || {};
    if (l.res) return;
    const g = await C.gameFor(l, force).catch(() => null);
    let box = null;
    if (g && l.type === 'prop' && g.state !== 'pre' && !g.off) box = C.boxValue(l, await C.summary(l.lg, g, force && g.state === 'in'));
    const r = C.read(l, g, box);
    let mk = was.mk || null;
    // in the last ten minutes before the start, read the books fresh each time, so the closing price is as late as it can be
    const closing = l.close == null && C.closeOpen(l) && Date.now() > l.start - 10 * 60000;
    if (g && g.state !== 'post' && !g.off) mk = C.marketNow(l, await C.oddsBoard(l, g, closing && g.state === 'pre').catch(() => null));
    V.live.set(k, { g, box, r, mk, at: Date.now() });
    /* the closing price: the latest pre-start read in the window is kept, and written once the game is about to start
       (five minutes out) or has started. A page closed before then leaves no closing price, and the card says so. */
    if (l.close == null && C.closeOpen(l) && g && !g.off) {
      if (g.state === 'pre' && mk?.p != null) V.closeCand.set(k, mk.p);
      const cand = V.closeCand.get(k);
      if (cand != null && (g.state !== 'pre' || Date.now() >= l.start - 5 * 60000)) { V.closeCand.delete(k); await C.closeLegs(p, [{ id: l.id, close: cand }]).catch(() => {}) }
      else if (g.state === 'pre' && mk?.p == null) V.closeTried.add(k);
    }
    return decide(l, g, r, box);
  }
  // a pick's result, once its game has said so. Anything short of certain waits.
  async function decide(l, g, r, box) {
    const done = (res, final) => ({ id: l.id, res, ...(final != null ? { final } : {}) });
    if (['hit', 'miss', 'push'].includes(r.state)) return done(r.state, r.final);
    if (r.state === 'void') return /postpon|cancel/i.test(g?.off || '') && Date.now() > l.start ? done('void') : null;
    if (r.state !== 'settle' || l.type !== 'prop') return null;
    const grade = v => done(v === l.line ? 'push' : (v > l.line) === (l.side !== 'under') ? 'hit' : 'miss', v);
    if (box?.seen && box.dnp) return done('void');                                   // listed, did not play: the pick does not count
    if (box?.seen && C.hasLive(l) && C.LG[l.lg].sport === 'football') return grade(0);   // in the box score, with nothing in this column
    const log = await C.fromLog(l);
    if (log.v != null) return grade(log.v);
    return log.none && Date.now() - l.start > 20 * 36e5 ? done('void') : null;        // no game for this player that day, a day on
  }
  function parlayRead(p) {
    const legs = p.legs.map(l => { const i = info(p, l), g = i.g; return { l, i, key: g ? `${l.lg}:${g.eid}` : l.gameKey || l.id } });
    const val = f => C.combine(legs.map(x => ({ id: x.l.id, gameKey: x.key, v: f(x) })), x => x.v);
    const one = x => x.l.res === 'hit' || x.l.res === 'push' || x.l.res === 'void' ? 1 : x.l.res === 'miss' ? 0 : null;
    const v = x => one(x) ?? (x.i.r ? x.i.r.p ?? (['push', 'void'].includes(x.i.r.state) ? 1 : null) : C.start0(x.l)), now = val(v), vals = new Map(legs.map(x => [x.l.id, v(x)]));
    const adj = now?.linked ? C.estimate(p.legs, l => vals.get(l.id)) : null;   // the rough range once linked picks are allowed for (parlaycore estimate)
    const open = legs.filter(x => !x.l.res && !['hit', 'miss', 'push', 'void'].includes(x.i.r?.state)), priced = open.filter(x => x.i.mk?.p != null).length;
    const books = open.length && priced === open.length ? val(x => one(x) ?? x.i.mk?.p ?? (x.i.r?.p === 1 ? 1 : x.i.r?.p === 0 ? 0 : null)) : null;
    const start = p.ours0 ?? C.combine(p.legs, C.start0)?.p ?? null;
    const anyLive = legs.some(x => !x.l.res && x.i.g?.state === 'in'), next = Math.min(...p.legs.filter(l => !l.res && l.start > Date.now()).map(l => l.start));
    return { legs, now, adj, books, priced, openN: open.length, start, anyLive, next: isFinite(next) ? next : null };
  }
  function sample(p, R) {
    if (!R.anyLive || R.now?.p == null) return;
    const t = V.trail[p.id] || (V.trail[p.id] = []), last = t[t.length - 1];
    if (last && Date.now() - last[0] < 50000) return;
    t.push([Date.now(), +R.now.p.toFixed(4)]); if (t.length > 240) t.splice(0, t.length - 240);
  }
  async function refresh(force) {
    if (V.busy) return; V.busy = true;
    try {
      const list = tracked();
      await Promise.all(list.map(async p => {
        const results = (await Promise.all(p.legs.map(l => follow(p, l, force).catch(() => null)))).filter(Boolean);
        if (!results.length) return;
        await C.settle(p, results).catch(() => {});
        // said once for a screen reader; the cards themselves repaint quietly
        const words = { hit: 'hit', miss: 'missed', push: 'pushed', void: 'is void' }, say = $('pySay');
        if (say) say.textContent = `${nameOf(p)}: ` + results.map(r => `${p.legs.find(l => l.id === r.id)?.text || 'a pick'} ${words[r.res]}`).join('. ') + '.';
      }));
      const keep = new Set(C.list().map(p => p.id)); for (const id of Object.keys(V.trail)) if (!keep.has(id)) delete V.trail[id];
      for (const p of tracked()) sample(p, parlayRead(p));
      store.set('fl.parlayTrail', V.trail); V.at = Date.now();
    } finally { V.busy = false }
    draw(); plan();
  }
  function plan() {
    clearTimeout(V.timer); if (window.flPages.current() !== 'parlays') return;
    const list = tracked(), live = list.some(p => p.legs.some(l => !l.res && l.start < Date.now() + 5 * 60000)), soon = list.length > 0;
    V.timer = setTimeout(() => document.hidden ? plan() : refresh(), live ? 20000 : soon ? 60000 : 5 * 60000);
  }

  /* ---------- the page ---------- */
  function render(el) {
    el.innerHTML = `<div class="vst py">
      <header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Parlays</h1><p class="pg-sub">Lock in your picks before the games start, then follow every one live.</p></div>
        <div class="pg-acts"><button type="button" class="bt py-new" data-py="new" data-fk="new">${ic('plus', 18)}New parlay</button><span id="pyQ"></span></div></header>
      <div id="pyHelp"></div><p class="sr-only" id="pySay" role="status"></p><div id="pyBuild"></div>
      <div class="g2 py-cols"><div class="vst py-main" id="pyMain"></div><aside class="vst py-side" id="pySide" aria-label="Your record"></aside></div>
    </div>`;
    draw();
  }
  function keep(fn) {   // repaint without losing the keyboard's place, or what is being typed
    const a = document.activeElement, k = a?.closest?.('[data-fk]')?.dataset.fk, sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    const form = document.querySelector('#pg-parlays form[data-pyform]'), typed = form ? [form.dataset.pyform, form.name.value, form.odds.value, form.stake.value] : null; fn();
    const f2 = typed && document.querySelector(`#pg-parlays form[data-pyform="${typed[0]}"]`); if (f2) { f2.name.value = typed[1]; f2.odds.value = typed[2]; f2.stake.value = typed[3] }
    if (k) { const b = [...document.querySelectorAll('#pg-parlays [data-fk]')].find(x => x.dataset.fk === k); b?.focus({ preventScroll: true }); try { if (sel && b && 'selectionStart' in b) b.setSelectionRange(sel[0], sel[1]) } catch (e) {} }
  }
  function draw() { if (!$('pyMain')) return; keep(() => { drawBuild(); drawMain(); drawSide() }) }

  /* ---------- one pick on a card ---------- */
  const WORD = [[.75, 'Looking good', 'up'], [.55, 'On track', 'up'], [.4, 'Could go either way', 'minus'], [.2, 'Needs help', 'down'], [0, 'In trouble', 'down']];
  const word = p => WORD.find(w => p >= w[0]);
  function gameLine(l, g) {
    if (!g) return l.start > Date.now() ? `${l.game ? l.game + ' · ' : ''}Starts ${when(l.start)}` : l.game || '';
    const soccer = C.LG[l.lg].sport === 'soccer', hs = g.home.score ?? 0, as = g.away.score ?? 0, h = g.home.abbr || g.home.name, a = g.away.abbr || g.away.name;
    const score = soccer ? `${g.home.name} ${hs}–${as} ${g.away.name}` : `${a} ${as}, ${h} ${hs}`;
    if (g.off) return `${soccer ? `${g.home.name} v ${g.away.name}` : `${a} at ${h}`} · ${g.off}`;
    if (g.state === 'pre') return `${soccer ? `${g.home.name} v ${g.away.name}` : `${a} at ${h}`} · Starts ${when(g.date)}`;
    return `${score} · ${g.state === 'post' ? (g.detail || 'Final') : g.detail || g.display || 'Live'}`;
  }
  function progress(l, r) {   // where the count stands against the line, in words and as a bar with the line marked on it
    if (r.state !== 'live' && !['hit', 'miss', 'push'].includes(r.state)) return '';
    const unit = l.type === 'total' ? C.LG[l.lg].unit : String(l.label || '').toLowerCase();
    if ((l.type === 'prop' || l.type === 'total') && typeof r.cur === 'number' && !l.yes) {
      const cur = r.cur, top = Math.max(l.line * 1.35, cur * 1.08, l.line + 1), over = l.side !== 'under';
      const txt = r.state !== 'live' ? `Finished on ${fmt(cur)}` : r.there ? `${fmt(cur)} so far: already over the line` : r.gone ? `${fmt(cur)} so far: already over the line, so the under is gone`
        : over ? `${fmt(cur)} so far, needs ${fmt(r.need)} more` : `${fmt(cur)} so far, ${fmt(r.room)} under the line`;
      return `<div class="py-prog"><span class="py-trak" role="img" aria-label="${esc(`${fmt(cur)} ${unit} against a line of ${fmt(l.line)}`)}"><i style="width:${Math.min(100, cur / top * 100).toFixed(1)}%"></i><em style="left:${(l.line / top * 100).toFixed(1)}%"></em></span>
        <span class="py-pt num">${esc(txt)}${r.state === 'live' && r.proj != null && !r.there && !r.gone ? ` · on course for about ${fmt(Math.round(r.proj * 10) / 10)}` : ''}</span></div>`;
    }
    if (l.type === 'prop' && typeof r.cur === 'number') return `<div class="py-prog"><span class="py-pt num">${r.cur > 0 ? 'Yes so far' : 'Not yet'}</span></div>`;
    if (r.state !== 'live') return '';
    if (l.type === 'spread' && r.cover != null) return `<div class="py-prog"><span class="py-pt num">${r.cover > 0 ? `Covering by ${fmt(r.cover)}` : r.cover < 0 ? `${fmt(-r.cover)} short of covering` : 'Exactly on the line'}</span></div>`;
    if (l.type === 'win' && r.margin != null) return `<div class="py-prog"><span class="py-pt num">${r.margin > 0 ? `Ahead by ${fmt(r.margin)}` : r.margin < 0 ? `Behind by ${fmt(-r.margin)}` : 'Level'}</span></div>`;
    if (l.type === 'draw' && r.margin != null) return `<div class="py-prog"><span class="py-pt num">${r.margin === 0 ? 'Level right now' : `${fmt(Math.abs(r.margin))} ${Math.abs(r.margin) === 1 ? 'goal' : 'goals'} apart`}</span></div>`;
    return '';
  }
  function legRow(p, l) {
    const i = info(p, l), r = l.res ? { state: l.res, p: l.res === 'hit' ? 1 : l.res === 'miss' ? 0 : null, final: l.final, cur: typeof l.final === 'number' ? l.final : undefined } : i.r || { state: l.start > Date.now() ? 'pre' : 'wait', p: C.start0(l) };
    const g = i.g, mk = !l.res && r.state !== 'pre' || r.state === 'pre' ? i.mk : null, live = r.state === 'live';
    const mark = { hit: ['check', 'Hit'], miss: ['x', 'Missed'], push: ['minus', 'Push: on the line exactly'], void: ['minus', 'Void: it does not count'], pre: ['clock', 'Not started'], settle: ['clock', 'Waiting for the final count'], 'lost-track': ['help', 'Game not found'], wait: ['clock', 'Waiting'] }[r.state];
    const w = live && r.p != null ? (r.there ? [1, 'Already there', 'check'] : r.gone ? [0, 'Out of reach', 'x'] : word(r.p)) : null;
    const verdict = w ? `<span class="pl py-word ${w[2]}">${ic(w[2], 14)}${w[1]}</span>` : `<span class="pl py-word ${r.state}">${ic(mark?.[0] || 'clock', 14)}${mark?.[1] || 'Waiting'}</span>`;
    const ours = r.p != null && !['hit', 'miss'].includes(r.state) ? `<div><dt>${live ? 'Our live read' : 'Our number'}</dt><dd class="num">${pct(r.p)}%</dd></div>` : '';
    const books = l.res || ['hit', 'miss', 'push', 'void'].includes(r.state) ? '' : mk?.p != null ? `<div><dt>Books ${live ? 'right now' : 'now'}</dt><dd class="num">${pct(mk.p)}%${mk.price != null ? `<small>best ${C.amTxt(mk.price)}${mk.book ? ' on ' + esc(mk.book) : ''}</small>` : ''}</dd></div>`
      : mk?.other != null ? `<div><dt>Books now</dt><dd class="py-moved">Line moved to ${l.type === 'spread' && mk.other > 0 ? '+' : ''}${fmt(mk.other)}</dd></div>`
      : live || r.state === 'pre' ? `<div><dt>Books now</dt><dd class="py-moved">${C.LG[l.lg]?.board ? 'No price posted' : 'Not covered for this league'}</dd></div>` : '';
    return `<li class="py-leg ${r.state}${live ? ' on' : ''}">
      <span class="py-mark ${r.state}" aria-hidden="true">${live ? '<i class="dot-live"></i>' : ic(mark?.[0] || 'clock', 16)}</span>
      <div class="py-lt"><b>${esc(l.text)}</b><small>${esc(l.res && !g ? [l.game, typeof l.final === 'string' ? 'Final: ' + l.final : ''].filter(Boolean).join(' · ') : gameLine(l, g))}</small>${r.note ? `<small class="py-note">${esc(r.note)}</small>` : ''}</div>
      ${verdict}${progress(l, r)}
      ${ours || books ? `<dl class="py-nums">${ours}${books}</dl>` : ''}${legHist(p, l)}</li>`;
  }
  /* ---------- the history kept with a parlay ----------
     Locked price: the odds the member typed, else the books' fair chance when it was locked in (market0).
     Closing price: each pick's books' chance read in the last minutes before its start (parlaycore closeOf). It is only read
     while this page is open, so a pick whose start passed with the page closed says so instead of showing a number.
     Against the close: the books' chance at the close minus at the lock. Up means the books moved toward the picks after
     they were locked in, which is the usual sign a price was a good one. Old parlays without these fields show what they have. */
  const CLOSE_WORDS = { later: 'Read in the 30 minutes before the start, while this page is open', due: 'Read in the last minutes before the start, while this page is open',
    none: 'No book prices for this league here', missed: 'Not read: the page was not open at the start', nop: 'Not read: no book posted a price at the start', old: 'Not recorded: this parlay was saved before closing prices were kept' };
  const legClose = (p, l) => { const c = C.closeOf(p, l); return c.state === 'missed' && V.closeTried.has(p.id + '|' + l.id) ? { state: 'nop' } : c };
  const pts2 = d => `${Math.abs(d)} ${Math.abs(d) === 1 ? 'point' : 'points'}`;
  function history(p) {
    const n = p.legs.length, cs = p.legs.map(l => legClose(p, l)), got = cs.filter(c => c.p != null).length, close = got === n ? cs.reduce((a, c) => a * c.p, 1) : null;
    const rest = cs.find(c => c.p == null), order = ['later', 'due', 'nop', 'missed', 'none', 'old'], why = rest ? order.find(k => cs.some(c => c.state === k)) : '';
    const lock = p.odds != null ? [C.amTxt(p.odds), `the odds you got${p.market0 != null ? ` · books’ fair chance ${pct(p.market0)}%` : ''}`] : p.market0 != null ? [`${pct(p.market0)}%`, `books’ fair chance, fair price ${C.amTxt(C.amFromP(p.market0))}`] : ['–', 'No book priced every pick'];
    const cl = close != null ? [`${pct(close)}%`, close > .003 && close < .997 ? `fair price ${C.amTxt(C.amFromP(close))}` : ''] : got ? [`${got} of ${n} read`, CLOSE_WORDS[why] || ''] : ['–', CLOSE_WORDS[why] || ''];
    const d = close != null && p.market0 != null ? pct(close) - pct(p.market0) : null;
    const clv = d == null ? '' : `<div><dt>Against the close</dt><dd class="num">${d > 0 ? `Beat it by ${pts2(d)}` : d < 0 ? `Behind by ${pts2(d)}` : 'Level'}<small>${d > 0 ? 'The books moved toward your picks after you locked in' : d < 0 ? 'The books moved away from your picks after you locked in' : 'The books didn’t move'}</small></dd></div>`;
    const edited = p.legs.filter(l => l.edited).length;
    const range = p.lo0 != null && p.hi0 != null ? `<div><dt>Adjusted range at lock</dt><dd class="num">${pct(p.lo0) === pct(p.hi0) ? pct(p.lo0) + '%' : `${pct(p.lo0)}–${pct(p.hi0)}%`}<small>a rough range for linked picks</small></dd></div>` : '';
    return `<div class="py-hist"><dl aria-label="Prices"><div><dt>Locked at</dt><dd class="num">${esc(lock[0])}<small>${esc(lock[1])}</small></dd></div>
        <div><dt>Closing price</dt><dd class="num">${esc(cl[0])}${cl[1] ? `<small>${esc(cl[1])}</small>` : ''}</dd></div>${clv}${range}</dl>
      ${p.warn || edited ? `<p class="py-warn">${edited ? `<span class="py-tag">${ic('edit', 12)}${edited === 1 ? 'Line edited' : `${edited} lines edited`}</span>` : ''}${p.warn ? `${ic('help', 14)}<span>Warning shown when you locked in: “${esc(p.warn)}”</span>` : ''}</p>` : ''}</div>`;
  }
  function legHist(p, l) {
    const tag = l.edited ? `<span class="py-tag">${ic('edit', 12)}${l.posted != null ? `Line edited: posted ${fmt(l.posted)}` : 'Your own line: none posted'}</span>` : '';
    const c = l.close != null ? (l.market0 != null ? `Books at lock ${pct(l.market0)}%, at the close ${pct(l.close)}%${pct(l.close) > pct(l.market0) ? ': moved your way' : pct(l.close) < pct(l.market0) ? ': moved against you' : ''}` : `Books at the close ${pct(l.close)}%`) : '';
    return tag || c ? `<p class="py-clv">${tag}${esc(c)}</p>` : '';
  }
  // the read while this page has been open: one line, the start marked on it
  function trail(p, R) {
    const t = V.trail[p.id] || []; if (t.length < 3 || R.start == null) return '';
    const W = 320, H = 64, x0 = t[0][0], x1 = t[t.length - 1][0], X = v => 4 + (v - x0) / Math.max(1, x1 - x0) * (W - 8), Y = v => 6 + (1 - v) * (H - 12);
    return `<figure class="py-trail"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`Our live read since ${clock(x0)}: from ${pct(t[0][1])}% to ${pct(t[t.length - 1][1])}%. It was ${pct(R.start)}% at the start.`)}">
      <line class="base" x1="0" x2="${W}" y1="${Y(R.start).toFixed(1)}" y2="${Y(R.start).toFixed(1)}"/><polyline points="${t.map(s => `${X(s[0]).toFixed(1)},${Y(s[1]).toFixed(1)}`).join(' ')}"/><circle cx="${X(x1).toFixed(1)}" cy="${Y(t[t.length - 1][1]).toFixed(1)}" r="4"/></svg>
      <figcaption class="lb">Our read since ${esc(clock(x0))}. The dashed line is where it started.</figcaption></figure>`;
  }
  function priceBits(p) {
    const pr = C.priceOf(p); if (!pr) return '';
    const st = p.stake ?? 1; return `<div><dt>${pr.est ? 'Fair price at the start' : 'Your price'}</dt><dd class="num">${C.amTxt(pr.am)}<small>${fmt(st)} ${st === 1 ? 'unit' : 'units'} to win ${fmt(Math.round(st * (pr.dec - 1) * 100) / 100)}</small></dd></div>`;
  }
  const nameOf = p => p.name || `${plural(p.legs.length, 'pick')} · ${dayOf(p.at)}`;
  function card(p) {
    const R = parlayRead(p), n = p.legs.length, open = p.status === 'open', now = R.now, hits = p.legs.filter(l => l.res === 'hit').length, left = p.legs.filter(l => !l.res).length;
    const delta = open && R.anyLive && now && R.start != null ? pct(now.p) - pct(R.start) : null;
    const status = !open ? `<span class="pl py-st ${p.status}">${ic(p.status === 'won' ? 'check' : p.status === 'lost' ? 'x' : 'minus', 14)}${p.status === 'won' ? 'Won' : p.status === 'lost' ? 'Lost' : 'Push'}</span>`
      : R.anyLive ? `<span class="pl live"><i></i>Live</span>` : R.next ? `<span class="pl">${ic('clock', 14)}Starts ${esc(when(R.next))}</span>` : `<span class="pl">${ic('clock', 14)}Waiting for results</span>`;
    const range = now ? `${pct(now.p)}%` : '–';
    const mood = !open ? '' : delta == null ? (now ? '' : 'Not enough to go on yet') : delta > 0 ? `${ic('up', 16)}Up ${delta} ${delta === 1 ? 'point' : 'points'} since the start` : delta < 0 ? `${ic('down', 16)}Down ${-delta} ${delta === -1 ? 'point' : 'points'} since the start` : `${ic('minus', 16)}Level with the start`;
    const head = open ? `<div class="py-read"><div class="py-now"><span class="lb">${R.anyLive ? 'Our live read' : 'Our number'}: ${n === 1 ? 'chance it hits' : `chance all ${n} hit`}</span><b class="fig num py-big">${range}</b>${mood ? `<span class="py-mood">${mood}</span>` : ''}
          ${hits ? `<span class="lb">${hits} of ${n} already in${left ? `, ${left} to go` : ''}</span>` : ''}</div>
        <dl class="py-facts">${R.start != null ? `<div><dt>At the start</dt><dd class="num">${pct(R.start)}%</dd></div>` : ''}
          <div><dt>Books right now</dt><dd class="num">${R.books ? pct(R.books.p) + '%' : '–'}<small>${R.books ? (R.books.p > .003 && R.books.p < .997 ? 'fair price ' + C.amTxt(C.amFromP(R.books.p)) : '') : R.openN ? `${R.priced} of ${plural(R.openN, 'pick')} priced` : ''}</small></dd></div>${priceBits(p)}</dl>${trail(p, R)}</div>
        ${now?.linked && pct(now.lo) !== pct(now.hi) ? `<p class="py-link lb">${ic('help', 14)}Some of these picks are from the same game, so they move together. The number multiplies them as if they didn't.${R.adj && !R.adj.conflict ? ` Allowing for the links, a rough range is ${pct(R.adj.lo) === pct(R.adj.hi) ? pct(R.adj.lo) + '%' : `${pct(R.adj.lo)}–${pct(R.adj.hi)}%`}.` : ''} Whatever the link, it sits between ${pct(now.lo)}% and ${pct(now.hi)}%.</p>` : ''}${history(p)}`
      : `<div class="py-read done"><div class="py-now"><span class="lb">${p.status === 'won' ? `All ${n === 1 ? 'in' : n + ' hit'}` : p.status === 'lost' ? `${hits} of ${n} hit` : 'Stake back'}</span>${(() => { const pr = C.priceOf(p), st = p.stake ?? 1; return pr && p.status !== 'push' ? `<b class="fig num py-big">${p.status === 'won' ? '+' + fmt(Math.round(st * (pr.dec - 1) * 100) / 100) : '−' + fmt(st)}<small> ${pr.est ? 'units, at a fair price' : 'units'}</small></b>` : '' })()}</div>
        <dl class="py-facts">${R.start != null ? `<div><dt>Our number at the start</dt><dd class="num">${pct(R.start)}%</dd></div>` : ''}${priceBits(p)}</dl></div>${history(p)}`;
    const tools = V.confirm === p.id ? `<div class="py-tools"><b>Delete “${esc(nameOf(p))}”? It comes off your record too.</b><button type="button" class="bt sm danger" data-pyyes="${p.id}" data-fk="yes-${p.id}">Delete parlay</button><button type="button" class="bt sm ghost" data-py="keep" data-fk="keep-${p.id}">Keep it</button></div>`
      : V.edit === p.id ? `<form class="py-tools py-edit" data-pyform="${p.id}"><label class="fl-f"><span>Name</span><input class="inp" name="name" maxlength="80" value="${esc(p.name || '')}" data-fk="en-${p.id}" autocomplete="off"></label>
          <label class="fl-f"><span>Odds you got</span><input class="inp num" name="odds" inputmode="text" placeholder="+450" value="${p.odds != null ? esc(C.amTxt(p.odds).replace('−', '-')) : ''}" data-fk="eo-${p.id}" autocomplete="off"></label>
          <label class="fl-f"><span>Stake, in units</span><input class="inp num" name="stake" inputmode="decimal" placeholder="1" value="${p.stake != null ? fmt(p.stake) : ''}" data-fk="es-${p.id}" autocomplete="off"></label>
          <button type="submit" class="bt sm" data-fk="esave-${p.id}">Save</button><button type="button" class="bt sm ghost" data-py="keep" data-fk="ecancel-${p.id}">Cancel</button>${V.err ? `<p class="py-err" role="alert">${esc(V.err)}</p>` : ''}</form>`
      : `<div class="py-tools"><button type="button" class="bt sm ghost" data-pyedit="${p.id}" data-fk="edit-${p.id}">${ic('edit', 16)}${p.odds != null ? 'Name and price' : 'Add your price'}</button><button type="button" class="bt sm ghost" data-pydel="${p.id}" data-fk="del-${p.id}">${ic('trash', 16)}Delete</button>
          ${p.local ? `<span class="lb">Kept in this browser only. Log in to keep it with your account.</span>` : ''}</div>`;
    return `<article class="card py-card ${p.status}${R.anyLive ? ' on' : ''}" data-py-card="${p.id}" aria-label="${esc(nameOf(p))}">
      <header class="py-h"><div class="py-name"><h3>${esc(nameOf(p))}</h3><small>${plural(n, 'pick')} · locked in ${esc(dayOf(p.at))}, ${esc(clock(p.at))}</small></div>${status}</header>
      ${head}${open || unsettled(p) ? `<ol class="py-legs" aria-label="Picks">${p.legs.map(l => legRow(p, l)).join('')}</ol>${tools}`
        : `<details class="py-fold"${V.unfold.has(p.id) ? ' open' : ''} data-pyfold="${p.id}"><summary data-fk="fold-${p.id}">${plural(n, 'pick')}: ${esc(p.legs.map(l => l.short || l.text).join(' · '))}</summary><ol class="py-legs" aria-label="Picks">${p.legs.map(l => legRow(p, l)).join('')}</ol>${tools}</details>`}</article>`;
  }

  /* An example for the empty page, so it is clear what a parlay looks like here. It is made from real picks on tonight's
     board (three from different games, strongest first), it is labelled as an example, and it is never saved. With no
     lines posted it is left out: there is nothing real to show. */
  // The picks are the ones where our number and the apps' prices are closest (but ours is still higher), so the
  // example shows an ordinary gap and says why it widens once picks are multiplied, rather than a 76% against 34%.
  const EX = { picks: null, asked: false, open: { ex: false, how: false } };
  function example() {
    if (!window.flEdge) return '';
    if (!EX.asked) { EX.asked = true; window.flEdge.props(['nba', 'nfl', 'nhl']).then(r => { const now = Date.now();
        const fresh = r.picks.filter(p => p.start && +p.start > now); EX.late = fresh.length < 3;   // late at night every game may have started: the board's picks are still real ones
        const pool = EX.late ? r.picks : fresh, gap = p => p.ours - p.market;
        const take = list => { const seen = new Set(), out = []; for (const p of list) { if (seen.has(p.gameKey)) continue; seen.add(p.gameKey); out.push(p); if (out.length === 3) break } return out };
        const calm = take(pool.filter(p => p.market != null && gap(p) > 0.005 && p.ours >= 0.5 && p.ours <= 0.8).sort((a, b) => gap(a) - gap(b)));
        EX.picks = calm.length >= 2 ? calm : take([...pool].sort((a, b) => b.ours - a.ours));
        if (window.flPages.current() === 'parlays') drawMain() }).catch(() => { EX.picks = [] }) }
    if (!EX.picks) return '<div class="skl" style="height:150px" aria-hidden="true"></div>';
    if (EX.picks.length < 2) return '<p class="lb">No lines are posted right now, so there is no real example to show. Check back when tonight’s board is up.</p>';
    const n = EX.picks.length, all = EX.picks.reduce((a, p) => a * p.ours, 1), mk = EX.picks.every(p => p.market != null) ? EX.picks.reduce((a, p) => a * p.market, 1) : null;
    const avg = mk == null ? null : EX.picks.reduce((a, p) => a + (p.ours - p.market), 0) / n * 100;
    return `<p class="lb">${n === 3 ? 'Three' : 'Two'} real picks from ${EX.late ? 'the latest board (these games have started, so they could not be added now)' : 'tonight’s board'}, each from a different game. Example only, nothing is saved.</p>
      <ul class="py-exl">${EX.picks.map(p => `<li><span class="rw-t"><b>${esc(p.name)}</b><small>${esc(p.text)}${p.game ? ' · ' + esc(p.game) : ''}</small></span><span class="py-exp num"><b>${pct(p.ours)}%</b>${p.market != null ? `<small class="lb">apps ${pct(p.market)}%</small>` : ''}</span></li>`).join('')}</ul>
      <dl class="py-exf"><div><dt>Our number: chance all ${n} hit</dt><dd class="num">${pct(all)}%</dd></div><div><dt>The same from the apps’ prices</dt><dd class="num">${mk == null ? '–' : pct(mk) + '%'}</dd></div></dl>
      ${avg == null ? '' : `<p class="lb">On each pick our number is about ${Math.max(1, Math.round(avg))} points above the apps’. Across ${n} picks the gap grows to ${Math.round((all - mk) * 100)} points, because the chances are multiplied and each pick’s gap is multiplied with them.</p>`}`;
  }
  const HOWP = `<ul><li><b>One pick.</b> Our number is our estimate of how often it hits. The apps’ number comes from their price, with their margin taken out.</li>
      <li><b>Picks from different games.</b> They don’t affect each other, so the chances are multiplied: two picks at 60% hit together 36% of the time.</li>
      <li><b>Picks from one game.</b> They move together, so a single number would mislead. Those parlays show a range instead.</li>
      <li><b>Small gaps grow.</b> If each pick is a few points better by our number, multiplying them widens the gap on the whole parlay. That is why a parlay’s gap is bigger than any one pick’s.</li></ul>
    <p class="lb">These are estimates for research, not a promise and not betting advice.</p>`;
  document.addEventListener('toggle', ev => { const k = ev.target.dataset?.pyfold; if (k) EX.open[k] = ev.target.open }, true);

  function drawMain() {
    const el = $('pyMain'), list = C.list(), st = C.state;
    if (!st.loaded && !list.length) { el.innerHTML = `<p class="sr-only">Loading your parlays.</p><div class="card"><div class="skl" style="height:140px"></div></div>`; return }
    const open = list.filter(p => p.status === 'open'), reads = new Map(open.map(p => [p.id, parlayRead(p)]));
    const live = open.filter(p => reads.get(p.id).anyLive), wait = open.filter(p => !reads.get(p.id).anyLive).sort((a, b) => (reads.get(a.id).next || 0) - (reads.get(b.id).next || 0));
    const done = list.filter(p => p.status !== 'open').sort((a, b) => (b.settled || b.at) - (a.settled || a.at)), CAP = 6;
    // one clear way in: while an empty state is showing its own Build button, the one in the header steps aside
    { const top = document.querySelector('#pg-parlays .py-new'); if (top) top.hidden = (!list.length || !open.length) && !V.open && st.loaded }
    let h = '';
    if (st.error) h += `<p class="card py-err" role="alert">Your saved parlays did not load: ${esc(st.error)} <button type="button" class="bt sm ghost" data-py="reload" data-fk="reload">Try again</button></p>`;
    if (live.length) h += `<section aria-label="Live parlays"><div class="sec-h"><h2>Live now</h2><span class="lb">${V.at ? `Updated ${clock(V.at)}` : 'Checking the games'}</span></div><div class="vst py-list">${live.map(card).join('')}</div></section>`;
    if (wait.length) h += `<section aria-label="Parlays still to start"><div class="sec-h"><h2>${live.length ? 'Still to start' : 'Locked in'}</h2><span class="lb">${plural(wait.length, 'parlay')}</span></div><div class="vst py-list">${wait.map(card).join('')}</div></section>`;
    if (!list.length && !V.open) h += `<div class="card emp py-none">${ic('ticket', 30)}<b>No tracked parlays</b><p>Build one from Predictions or create one here.</p>
      <div class="py-none-b"><button type="button" class="bt" data-py="new" data-fk="new2">${ic('plus', 18)}Create parlay</button><button type="button" class="bt ghost" data-page="predictions" data-fk="topred">Browse predictions</button></div></div>
      <details class="card drw py-ex" data-pyfold="ex"${EX.open.ex ? ' open' : ''}><summary>See an example <span class="lb">Real picks from tonight’s board</span></summary><div class="drw-b">${example()}</div></details>
      <details class="card drw py-how" data-pyfold="how"${EX.open.how ? ' open' : ''}><summary>How probabilities work</summary><div class="drw-b">${HOWP}</div></details>`;
    else if (!open.length && !V.open) h += `<div class="card emp py-none">${ic('ticket', 30)}<b>Nothing in play right now</b><p>Every parlay you saved has finished. Build another when you like.</p><button type="button" class="bt" data-py="new" data-fk="new2">${ic('plus', 18)}New parlay</button></div>`;
    if (done.length) h += `<section aria-label="Finished parlays"><div class="sec-h"><h2>Finished</h2><span class="lb">${plural(done.length, 'parlay')}</span></div><div class="vst py-list">${(V.all ? done : done.slice(0, CAP)).map(card).join('')}</div>
      ${done.length > CAP ? `<button type="button" class="bt ghost wide" data-py="all" data-fk="all">${V.all ? `Show the last ${CAP}` : `Show all ${done.length}`}</button>` : ''}</section>`;
    el.innerHTML = h;
  }

  /* ---------- the record, beside the cards ---------- */
  const mark = s => s === 'won' ? ['W', 'Won'] : s === 'lost' ? ['L', 'Lost'] : ['P', 'Push'];
  const strip = last => `<ol class="py-strip" aria-label="Last ${last.length}, oldest first">${last.map(p => { const [c, w] = mark(p.status); return `<li class="${p.status}" title="${esc(`${nameOf(p)}: ${w}`)}"><span aria-hidden="true">${c}</span><span class="sr-only">${w}</span></li>` }).join('')}</ol>`;
  function recordCard() {
    const S = C.stats();
    if (!S.n) return `<section class="card py-rec" aria-label="Your record"><div class="sec-h"><h2>Your record</h2></div><p class="lb">${S.open ? `${plural(S.open, 'parlay')} in play. Your record starts when the first one finishes.` : 'Your wins, losses and hit rate build up here as your parlays finish.'}</p></section>`;
    const u = S.units;
    return `<section class="card py-rec" aria-label="Your record"><div class="sec-h"><h2>Your record</h2><button type="button" class="lk" data-page="profile" data-fk="torec">Full record${ic('arrow', 16)}</button></div>
      <div class="py-tiles"><div class="tile inset"><span class="lb">Won–lost</span><b class="fig num">${S.won}–${S.lost}</b>${S.push ? `<small class="lb">${plural(S.push, 'push', 'pushes')}</small>` : ''}</div>
        <div class="tile inset"><span class="lb">Hit rate</span><b class="fig num">${S.rate == null ? '–' : pct(S.rate) + '%'}</b></div>
        <div class="tile inset"><span class="lb">Units</span><b class="fig num">${u == null ? '–' : (u > 0 ? '+' : u < 0 ? '−' : '') + fmt(Math.round(Math.abs(u) * 100) / 100)}</b><small class="lb">${u == null ? 'add your odds to count these' : S.est ? 'some at a fair price' : `over ${plural(S.priced, 'parlay')}`}</small></div></div>
      <div><span class="lb">Last ${S.last.length}</span>${strip(S.last)}</div>
      <p class="lb">${S.legN ? `Single picks: ${S.legHit} of ${S.legN} hit (${pct(S.legRate)}%).` : ''}${S.clvN ? ` Beat the closing price on ${S.clvBeat} of ${plural(S.clvN, 'pick')}.` : ''}</p></section>`;
  }
  const HOW = `
      <p>It is our own estimate, not a promise. Whatever has happened so far is fixed. The rest of the game is expected to go the way the whole game was expected to go before it started, scaled to the time left.</p>
      <ul><li><b>Players and totals.</b> The count so far, plus what is still expected, against the line.</li><li><b>Winners and spreads.</b> The score now, plus the edge the books gave before the start, over the time left.</li>
        <li><b>Books right now.</b> Live prices from Kalshi, FanDuel, DraftKings and Polymarket for the same pick, with their margin taken out. When a book has moved the line, the card says so and gives no number.</li>
        <li><b>The whole parlay.</b> Picks from different games are multiplied. Picks from one game move together, so those show a range.</li></ul>
      <p class="lb">Scores and box scores come from ESPN and can run a little behind the broadcast. This page checks again every 20 seconds while a game is on, and a parlay settles when the final score is in.</p>`;
  function drawSide() {
    const any = C.list().length > 0 || !C.state.loaded, side = $('pySide');
    side.hidden = !any; side.parentElement.classList.toggle('one', !any);
    side.innerHTML = any ? recordCard() : '';
    // the live read explained: open the first time someone has a parlay, then behind the ? in the heading
    const q = $('pyQ'), help = $('pyHelp'), want = any && C.state.loaded && window.flHelp;
    if (q && help) { if (want && !help.firstChild) { q.innerHTML = flHelp.button('parlays', 'How the live read works'); help.innerHTML = flHelp.panel('parlays', 'How the live read works', HOW) } else if (!want && help.firstChild) { q.innerHTML = ''; help.innerHTML = '' } }
  }

  /* ---------- the builder ---------- */
  const inDraft = id => V.draft.legs.some(l => l.id === id);
  function addLeg(leg) {
    if (!leg) return; const i = V.draft.legs.findIndex(l => l.id === leg.id);
    if (i >= 0) V.draft.legs.splice(i, 1);
    else { if (V.draft.legs.length >= MAX) return window.toast?.(`A parlay holds up to ${MAX} picks`);
      /* one side of a market per game: taking the other side, or another line, replaces it, and the ticket says so.
         The rule for each market: a player's stat (one line, one side), the winner (one team), the spread (one side, one line), the total (one line, one side). */
      const clash = l => l.gameKey === leg.gameKey && l.type === leg.type && (leg.type !== 'prop' || (l.player === leg.player && l.k === leg.k));
      const gone = V.draft.legs.filter(clash), why = { prop: `${leg.player} can only have one line and one side for ${String(leg.label || 'that stat').toLowerCase()}`, win: 'only one team can win the game', spread: 'a game takes one spread, at one line', total: 'a game takes one total, at one line', draw: 'that draw is already in' }[leg.type];
      V.draft.legs = V.draft.legs.filter(l => !clash(l)); V.draft.legs.push(leg);
      const r = V.draft.legs.length > 1 ? C.strongest(leg, V.draft.legs.slice(0, -1)) : null;
      V.priceNote = gone.length ? `${leg.short || leg.text} replaced ${gone.map(l => l.short || l.text).join(' and ')}: ${why}.` : '';
      say(`Added ${leg.text}.${gone.length ? ' ' + V.priceNote : ''}${r && r.level !== 'independent' ? ` ${({ slight: 'Slightly related', strong: 'Strongly related', conflict: 'Conflicting' })[r.level]} with ${r.with.short || r.with.text}: ${r.why}` : ''}`) }
    if (i >= 0) { V.priceNote = ''; say(`Took out ${leg.text}.`) }
    V.err = ''; V.said = ''; saveDraft(); draw();
  }
  const say = t => { const el = $('pySay'); if (el) el.textContent = t };
  /* Refresh prices: read the scoreboards and the player board again and rebuild each pick from what they post now.
     A pick keeps its side and line. When the board has moved a player's line, the pick stays at the member's line with no
     book price, and the ticket says so. A pick that has gone from the board can't be checked, so it keeps asking. */
  async function reprice() {
    if (V.repricing) return; V.repricing = true; V.err = ''; draw();
    const notes = [], legs = V.draft.legs.slice(), sports = [...new Set(legs.filter(l => l.type === 'prop').map(l => l.sport))];
    try {
      const board = sports.length && window.flEdge ? await window.flEdge.props(sports, true).catch(() => null) : null, now = Date.now();
      const out = await Promise.all(legs.map(async l => {
        if (l.type === 'prop') {
          const ps = (board?.picks || []).filter(p => p.sport === l.sport && C.norm(p.name) === C.norm(l.player) && p.k === l.k), same = ps.find(p => p.line === l.line), p = same || ps[0];
          if (!p) { notes.push(`${l.short || l.text} is no longer on the board, so its price can’t be checked. Take it out to lock in the rest.`); return l }
          if (same) return C.fromPick(same, l.side) || l;
          notes.push(`${l.player}’s line is now ${fmt(p.line)}. Your pick stays at ${fmt(l.line)}, with no book price at that line.`);
          const k = { ...l, rAt: p.at || now, ...(p.start ? { start: +p.start } : {}) }; delete k.market0; delete k.msrc; delete k.mAt; return k }
        const g = await C.gameFor(l, true).catch(() => null);
        if (!g) { notes.push(`${l.game || l.text} is not on the scoreboard right now, so its price can’t be checked.`); return l }
        const fresh = l.type === 'draw' ? C.fromGame({ ...g, readAt: now }, 'draw') : C.fromGame({ ...g, readAt: now }, l.type, l.side, l.line);
        return fresh ? { ...fresh, start: +g.date } : l }));
      V.draft.legs = out; V.games = null; V.priceNote = `Prices refreshed at ${clock(Date.now())}.${notes.length ? ' ' + notes.join(' ') : ''}`; saveDraft();
      if (V.tab === 'games') loadGames(true);
      say(V.priceNote);
    } finally { V.repricing = false; draw() }
  }
  const dayKey = () => C.etDay(new Date(Date.now() + V.day * 864e5));
  async function loadGames(force) {
    const key = V.lg + '|' + dayKey(); if (V.gamesFor === key && V.games && !force && Date.now() - (V.gamesAt || 0) < 10 * 60000) return;   // a list older than ten minutes is read again, so new picks carry fresh prices
    V.gamesFor = key; V.gamesLoading = true; draw();
    const games = await C.scoreboard(V.lg, dayKey(), force);
    if (V.gamesFor !== key) return;
    const readAt = Date.now(); V.gamesAt = readAt; V.games = games.filter(g => g.state === 'pre' && !g.off && +g.date > Date.now()).map(g => ({ ...g, readAt })).sort((a, b) => a.date - b.date); V.gamesLoading = false;
    if (!V.games.some(g => g.eid === V.exp)) V.exp = V.games[0]?.eid || '';
    draw();
  }
  async function loadProps(force) {
    if (!window.flEdge || V.propsLoading || (V.props && !force)) return;
    V.propsLoading = true; draw();
    V.props = await window.flEdge.props(null, force).catch(() => ({ picks: [], denied: false })); V.propsLoading = false; draw();
  }
  const half = v => Math.round(v * 2) / 2;
  function lineOf(g, kind) {   // the line the buttons offer: the member's own once they move it, else the one posted, else a usual number to start from
    const L = C.LG[g.lg], mine = V.lines[g.eid]?.[kind], o = g.odds || {};
    if (mine != null) return { v: mine, posted: false };
    if (kind === 'total') return o.total != null ? { v: o.total, posted: true } : { v: half(L.tot) + (Number.isInteger(half(L.tot)) ? .5 : 0), posted: false, guess: true };
    return o.spread != null ? { v: o.spread, posted: true } : { v: L.pois ? -1.5 : -2.5, posted: false, guess: true };
  }
  function gameRow(g) {
    const L = C.LG[g.lg], open = V.exp === g.eid, soccer = L.sport === 'soccer', title = soccer ? `${g.home.name} v ${g.away.name}` : `${g.away.name} at ${g.home.name}`, fair = g.odds?.fair || {};
    const mine = V.draft.legs.filter(l => l.gameKey === `${g.lg}:${g.eid}`).length;
    const btn = (leg, label, sub) => { const on = inDraft(leg.id); return `<button type="button" class="cx py-opt" aria-pressed="${on}" data-pyleg="${esc(JSON.stringify(leg))}" data-fk="lg-${esc(leg.id)}">${on ? ic('check', 16) : ''}<span>${esc(label)}</span>${sub ? `<small class="num">${esc(sub)}</small>` : ''}</button>` };
    const step = (kind, v, label) => `<span class="py-step" role="group" aria-label="${label}"><button type="button" class="ib" data-pystep="${g.eid}|${kind}|-0.5" data-fk="st-${g.eid}-${kind}-d" aria-label="${label}: lower by half a point">${ic('minus', 16)}</button><b class="num">${fmt(Math.abs(v))}</b><button type="button" class="ib" data-pystep="${g.eid}|${kind}|0.5" data-fk="st-${g.eid}-${kind}-u" aria-label="${label}: raise by half a point">${ic('plus', 16)}</button></span>`;
    let body = '';
    if (open) {
      const sp = lineOf(g, 'spread'), tt = lineOf(g, 'total'), sides = soccer ? ['home', 'away'] : ['away', 'home'], sign = v => v > 0 ? '+' : v < 0 ? '−' : '';
      const note = x => x.posted ? `The line posted${g.odds?.book ? ' at ' + esc(g.odds.book) : ''}` : x.guess ? 'No line posted yet. Set the one you have.' : 'Your line';
      body = `<div class="py-mk"><div class="py-mrow"><span class="lb">To win</span><div class="cx-row">${sides.map(s => btn(C.fromGame(g, 'win', s), g[s].name, fair[s] != null ? `books ${pct(fair[s])}%` : '')).join('')}${L.tie === 'draw' ? btn(C.fromGame(g, 'draw'), 'Draw', fair.draw != null ? `books ${pct(fair.draw)}%` : '') : ''}</div></div>
        <div class="py-mrow"><span class="lb">${L.sport === 'hockey' ? 'Puck line' : L.sport === 'baseball' ? 'Run line' : soccer ? 'Handicap' : 'Spread'}<small>${note(sp)}</small></span><div class="cx-row">${sides.map(s => { const v = s === 'home' ? sp.v : -sp.v; return btn(C.fromGame(g, 'spread', s, v), `${g[s].name} ${sign(v)}${fmt(Math.abs(v))}`) }).join('')}${step('spread', sp.v, `${g.home.name} line`)}</div></div>
        <div class="py-mrow"><span class="lb">Total ${L.unit}<small>${note(tt)}</small></span><div class="cx-row">${btn(C.fromGame(g, 'total', 'over', tt.v), `Over ${fmt(tt.v)}`)}${btn(C.fromGame(g, 'total', 'under', tt.v), `Under ${fmt(tt.v)}`)}${step('total', tt.v, 'Total line')}</div></div></div>`;
    }
    return `<div class="py-g${open ? ' open' : ''}"><button type="button" class="py-gh" aria-expanded="${open}" data-pygame="${g.eid}" data-fk="g-${g.eid}">${g.away.logo || g.home.logo ? `<span class="py-logos" aria-hidden="true">${[soccer ? g.home : g.away, soccer ? g.away : g.home].map(t => t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '').join('')}</span>` : ''}
      <span class="rw-t"><b>${esc(title)}</b><small>${esc([soccer ? g.league : '', when(g.date)].filter(Boolean).join(' · '))}</small></span>${mine ? `<span class="pl">${mine} added</span>` : ''}${ic(open ? 'minus' : 'plus', 18)}</button>${open && mine ? `<p class="py-same sm" role="note">${ic('help', 14)}<span>You already have a pick from this game. A second one moves with it: if one loses, the other often does too.</span></p>` : ''}${body}</div>`;
  }
  function gamesTab() {
    const chips = `<div class="cx-row scroll" role="radiogroup" aria-label="League">${LEAGUES.map(k => `<button type="button" class="cx" role="radio" aria-checked="${V.lg === k}" tabindex="${V.lg === k ? 0 : -1}" data-pylg="${k}" data-fk="lgc-${k}">${esc(C.LG[k].name)}</button>`).join('')}</div>
      <div class="seg" role="radiogroup" aria-label="Day">${[['0', 'Today'], ['1', 'Tomorrow'], ['2', new Date(Date.now() + 2 * 864e5).toLocaleDateString([], { weekday: 'long' })]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${String(V.day) === k}" class="${String(V.day) === k ? 'on' : ''}" tabindex="${String(V.day) === k ? 0 : -1}" data-pyday="${k}" data-fk="day-${k}">${esc(l)}</button>`).join('')}</div>`;
    const list = V.gamesLoading && !V.games ? `<div class="skl" style="height:64px"></div><div class="skl" style="height:64px"></div>`
      : V.games?.length ? V.games.map(gameRow).join('')
      : `<div class="emp">${ic('clock', 26)}<b>No ${esc(C.LG[V.lg].name)} games left to start ${V.day === 0 ? 'today' : V.day === 1 ? 'tomorrow' : 'that day'}</b><p>A game can go into a parlay until it starts. Try another day or another league.</p></div>`;
    return chips + `<div class="py-games">${list}</div>`;
  }
  function propsTab() {
    if (V.propsLoading && !V.props) return `<div class="skl" style="height:64px"></div><div class="skl" style="height:64px"></div>`;
    if (V.props?.denied) return `<div class="emp">${ic('members', 26)}<b>Player lines aren't part of your access</b><p>Ask your admin to switch on the Lab or Predictions for you. You can still add games.</p></div>`;
    const now = Date.now(), q = C.norm(V.q), all = (V.props?.picks || []).filter(p => p.start && +p.start > now && C.LG[p.sport]);
    const rows = all.filter(p => !q || C.norm(p.name).includes(q) || C.norm(p.team).includes(q) || C.norm(p.teamName).includes(q)).sort((a, b) => a.start - b.start || b.ours - a.ours).slice(0, 40);
    const search = `<label class="fl-f py-find"><span class="sr-only">Find a player or team</span><input class="inp" type="search" id="pyQ" data-fk="q" placeholder="Find a player or team" value="${esc(V.q)}" autocomplete="off"></label>`;
    if (!all.length) return `<div class="emp">${ic('lab', 26)}<b>No player lines posted for games still to start</b><p>A player shows here when PrizePicks or Sleeper posts a line for a game that has not begun.</p><button type="button" class="bt ghost sm" data-py="reprops" data-fk="reprops">Check again</button></div>`;
    return search + `<div class="py-games">${rows.length ? rows.map(p => { const over = C.fromPick(p, 'over'), under = C.fromPick(p, 'under'); if (!over) return '';
      const b = (leg, lab) => { const on = inDraft(leg.id); return `<button type="button" class="cx py-opt" aria-pressed="${on}" data-pyleg="${esc(JSON.stringify(leg))}" data-fk="lg-${esc(leg.id)}" aria-label="${esc(`${p.name}, ${lab} ${p.yes ? '' : fmt(p.line) + ' '}${p.label}`)}">${on ? ic('check', 16) : ''}<span>${lab}</span><small class="num">${pct(leg.ours0)}%</small></button>` };
      return `<div class="py-pr">${face(p.photo, p.name)}<span class="rw-t"><b>${esc(p.name)}</b><small>${p.fid && window.flPlayers ? window.flPlayers.span(p.fid, p.teamName || p.team) + (p.opp ? ' v ' + esc(p.opp) : '') + ' · ' : ''}${esc(`${p.label}${p.yes ? '' : ' · line ' + fmt(p.line)} · ${p.fid ? '' : (p.game || C.LG[p.sport].name) + ' · '}${when(p.start)}`)}</small></span><div class="cx-row">${b(over, p.yes ? 'Yes' : 'Over')}${b(under, p.yes ? 'No' : 'Under')}</div></div>` }).join('')
      : `<p class="lb">No player or team matches “${esc(V.q)}”.</p>`}</div><p class="lb">The percentage on each button is the Lab's own number for that side of the line.</p>`;
  }
  /* ---------- the ticket: how each pick relates to the ones before it, and the chance they all hit ---------- */
  const LEVEL = { independent: ['Independent', 1], slight: ['Slightly related', 2], strong: ['Strongly related', 3], conflict: ['Conflicting', 4] };
  const shortOf = l => l?.short || l?.text || '';
  // a small four-step meter. The words are always shown; the steps only repeat them
  function meter(r) {
    const [label, k] = LEVEL[r.level], o = shortOf(r.with);
    const tie = r.level === 'independent' ? '' : r.level === 'conflict' ? `with ${o}` : r.dir === 'together' ? `moves with ${o}` : r.dir === 'against' ? `pulls against ${o}` : `linked to ${o}`;
    return `<div class="py-rel ${r.level}"><span class="py-mtr" aria-hidden="true">${[1, 2, 3, 4].map(i => `<i${i <= k ? ' class="on"' : ''}></i>`).join('')}</span>
      <span class="py-rt"><span><b>${label}</b>${tie ? ` <span>${esc(tie)}</span>` : ''}</span><small>${esc(r.why)}</small></span></div>`;
  }
  // each pick after the first, against the picks above it: the strongest tie wins
  const ties = legs => legs.map((l, i) => i ? C.strongest(l, legs.slice(0, i)) : null);
  function relSummary(legs, rs) {
    const by = k => rs.filter(r => r?.level === k).length, games = new Set(C.linkKeys(legs)).size;
    if (by('conflict')) return { level: 'conflict', text: `${by('conflict') === 1 ? 'One pick' : `${by('conflict')} picks`} can’t hit alongside another. Take ${by('conflict') === 1 ? 'one of the pair' : 'one of each pair'} out to lock in.` };
    if (!by('strong') && !by('slight')) return { level: 'independent', text: `${legs.length === 2 ? 'Both picks come' : `All ${legs.length} picks come`} from different games, so each result stands on its own.` };
    const links = [by('strong') && plural(by('strong'), 'strong link'), by('slight') && plural(by('slight'), 'slight link')].filter(Boolean).join(' and ');
    return { level: by('strong') ? 'strong' : 'slight', text: `${plural(legs.length, 'pick')} from ${plural(games, 'game')}: ${links}. Linked picks don’t act like separate bets, so the chance is a range. Books usually price a same-game parlay below the multiplied chance.` };
  }
  // the short warning kept with the parlay when it is locked in: what the member was told
  function warnOf(legs) {
    const rs = ties(legs), S = relSummary(legs, rs); if (S.level === 'independent' || S.level === 'conflict') return '';
    const top = rs.filter(Boolean).sort((a, b) => (b.level === 'strong') - (a.level === 'strong'))[0];
    return `${LEVEL[top.level][0]}: ${shortOf(legs[rs.indexOf(top)])} and ${shortOf(top.with)}. ${top.why}`.slice(0, 240);
  }
  const pts = d => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} ${Math.abs(d) === 1 ? 'point' : 'points'}`;
  // the range on a 0-to-top scale: the band is the adjusted range, the bar is the plain product, the diamond is the books
  function rangeBar(e, book) {
    const top = Math.min(1, Math.max(.1, Math.ceil(Math.max(e.hi, e.p, book?.p || 0) * 1.25 * 10) / 10)), X = v => Math.max(0, Math.min(100, v / top * 100));
    const label = `${e.linked ? `Adjusted range ${pct(e.lo)} to ${pct(e.hi)}%, ` : ''}independent estimate ${pct(e.p)}%${book ? `, books ${pct(book.p)}%` : ''}, on a scale from 0 to ${pct(top)}%.`;
    return `<figure class="py-rb"><div class="py-rbt" role="img" aria-label="${esc(label)}">${e.linked ? `<span class="py-rbb" style="left:${X(e.lo).toFixed(1)}%;width:${(X(e.hi) - X(e.lo)).toFixed(1)}%"></span>` : ''}<i class="py-rbp" style="left:${X(e.p).toFixed(1)}%"></i>${book ? `<b class="py-rbk" style="left:${X(book.p).toFixed(1)}%"></b>` : ''}</div>
      <div class="py-rbx num" aria-hidden="true"><span>0%</span><span>${pct(top)}%</span></div>
      <figcaption class="py-rbl" aria-hidden="true">${e.linked ? '<span><i class="k-band"></i>Adjusted range</span>' : ''}<span><i class="k-p"></i>Independent</span>${book ? '<span><i class="k-b"></i>Books</span>' : ''}</figcaption></figure>`;
  }
  const HOWCALC = `<details class="py-howc"><summary data-fk="howc">How this is worked out</summary><ul>
      <li><b>Independent estimate.</b> Our chance for each pick, multiplied, as if no pick affected another.</li>
      <li><b>Adjusted for linked picks.</b> For picks from one game we judge each pair: independent, slightly or strongly related, and which way. Each judgement stands for a loose band of how much the two could move together, and the low and high ends of those bands give the range. It never goes past the hard limits: no higher than the least likely pick from that game, and no lower than the chances alone guarantee. The bands are judgement, not measurement, so treat the range as rough.</li>
      <li><b>Sportsbook price implies.</b> The odds you typed, turned into a chance (that includes the book’s cut). With no odds typed, each pick’s book price with the cut taken out, multiplied. A book prices a same-game parlay with its own model, usually lower.</li>
      <li><b>Difference.</b> Our independent estimate minus the books’ number, in percentage points.</li></ul></details>`;
  function chances(legs, srcTxt) {
    const e = C.estimate(legs, C.start0), mk = C.combine(legs, l => l.market0), odds = parseOdds(V.draft.odds), typed = odds != null && !Number.isNaN(odds);
    if (!e) return `<div class="py-tt"><div><span class="py-k">Chance all ${legs.length} hit</span><b class="num py-tbig">–</b></div></div><p class="py-hint">One of these picks has no number yet, so there is no chance to show.</p>`;
    const book = typed ? { p: 1 / C.dec(odds), src: `From the odds you typed, ${C.amTxt(odds)}, which include the book’s cut` } : mk ? { p: mk.p, src: srcTxt } : null;
    const range = pct(e.lo) === pct(e.hi) ? `${pct(e.lo)}%` : `${pct(e.lo)}–${pct(e.hi)}%`, d = book && !e.conflict ? pct(e.p) - pct(book.p) : null;
    const dr = book && e.linked && !e.conflict ? [pct(e.lo) - pct(book.p), pct(e.hi) - pct(book.p)] : null;
    return `<div class="py-prob" role="group" aria-label="${legs.length === 2 ? 'Chance both hit' : `Chance all ${legs.length} hit`}"><span class="py-k">${legs.length === 2 ? 'Chance both hit' : `Chance all ${legs.length} hit`}</span>
      <dl class="py-pq"><div class="big"><dt>Independent estimate</dt><dd class="num">${e.conflict ? '–' : pct(e.p) + '%'}</dd><small>${e.conflict ? 'Not shown while two picks clash' : 'Our chances, multiplied'}</small></div>
        <div class="big"><dt>Adjusted for linked picks</dt><dd class="num">${e.conflict ? '0%' : e.linked ? range : 'Same'}</dd><small>${e.conflict ? 'Two picks can’t both hit' : e.linked ? 'A rough range, not a measurement' : 'No two picks share a game'}</small></div>
        <div><dt>Sportsbook price implies</dt><dd class="num">${book ? pct(book.p) + '%' : '–'}</dd><small class="py-src">${esc(book ? book.src : srcTxt)}</small></div>
        <div><dt>Difference</dt><dd class="num">${d == null ? '–' : pts(d)}</dd><small>${d == null ? (e.conflict ? 'Fix the conflict first' : 'Needs a book price for every pick') : `${d > 0 ? 'Ours is above the books' : d < 0 ? 'Ours is below the books' : 'Level with the books'}${dr && dr[0] !== dr[1] ? `. With the range: ${pts(dr[0]).replace(/ points?$/, '')} to ${pts(dr[1])}` : ''}`}</small></div></dl>
      ${e.conflict ? '' : rangeBar(e, book)}${HOWCALC}</div>`;
  }
  function ticket() {
    const legs = V.draft.legs, n = legs.length, c = n ? C.combine(legs, C.start0) : null, mk = n ? C.combine(legs, l => l.market0) : null;
    // where "the books" number comes from, and how old it is
    const priced = legs.filter(l => l.market0 != null), srcs = [...new Set(priced.map(l => l.msrc).filter(Boolean))], oldest = Math.min(...priced.map(l => l.mAt || Date.now()));
    const srcTxt = priced.length ? `${srcs.length ? srcs.join(', ') : 'the books'}, read ${new Date(oldest).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${priced.length < n ? ` · ${n - priced.length} ${n - priced.length === 1 ? 'pick has' : 'picks have'} no price` : ''}` : 'No book posts a price for these picks';
    const rs = ties(legs), sum = n > 1 ? relSummary(legs, rs) : null;
    // why Lock it in is off, said beside it: every rule that fired, in words
    const blocks = n ? C.blockers(legs) : [], stale = blocks.find(b => b.kind === 'stale'), why = V.saving ? ['Saving…'] : V.repricing ? ['Refreshing prices…'] : blocks.map(b => b.why);
    const off = V.saving || V.repricing || blocks.length > 0;
    const legLi = (l, i) => `<li class="py-dli${blocks.some(b => b.kind !== 'stale' && b.ids.includes(l.id)) ? ' bad' : ''}"><div class="py-dlr"><span class="rw-t"><b>${esc(l.text)}</b><small>${esc(`${l.game ? l.game + ' · ' : ''}${l.start < Date.now() ? 'Already started' : when(l.start)}${l.edited ? (l.posted != null ? ` · your line, posted ${fmt(l.posted)}` : ' · your own line, none posted') : ''}`)}</small></span><button type="button" class="ib py-rm" data-pyrm="${esc(l.id)}" data-fk="rm-${esc(l.id)}" aria-label="Take out ${esc(l.text)}">${ic('x', 16)}</button></div>${rs[i] ? meter(rs[i]) : ''}</li>`;
    return `<section class="card py-ticket${n ? ' has' : ''}" id="pyTicket" tabindex="-1" aria-label="The parlay you are building"><div class="sec-h"><h2>${n === 1 ? 'Your tracked pick' : 'Your parlay'}</h2>${n ? `<span class="pl">${plural(n, 'pick')}</span>` : ''}</div>
      ${n === 1 ? '<p class="py-hint">One pick is tracked on its own. Add a second to make it a parlay.</p>' : ''}
      ${n ? `<ul class="py-dl">${legs.map(legLi).join('')}</ul>
        ${sum ? `<p class="py-relsum ${sum.level}" role="note">${ic(sum.level === 'independent' ? 'check' : 'help', 16)}<span>${esc(sum.text)}</span></p>` : ''}
        ${n === 1 ? `<div class="py-tt"><div><span class="py-k">Chance it hits</span><b class="num py-tbig">${c ? pct(c.p) + '%' : '–'}</b></div>
          <div class="py-tm"><span class="py-k">Books say</span><b class="num">${mk ? pct(mk.p) + '%' : '–'}</b><small class="py-src">${esc(srcTxt)}</small></div></div>` : chances(legs, srcTxt)}
        <div class="py-fields"><label class="fl-f"><span>Name (optional)</span><input class="inp" id="pyName" data-fk="name" maxlength="80" placeholder="Sunday four-leg" value="${esc(V.draft.name)}" autocomplete="off"></label>
          <label class="fl-f"><span>Odds you got (optional)</span><input class="inp num" id="pyOdds" data-fk="odds" inputmode="text" placeholder="+450" value="${esc(V.draft.odds)}" autocomplete="off" aria-describedby="pyOddsH"></label>
          <label class="fl-f"><span>Stake, in units (optional)</span><input class="inp num" id="pyStake" data-fk="stake" inputmode="decimal" placeholder="1" value="${esc(V.draft.stake)}" autocomplete="off"></label></div>
        <p class="py-hint" id="pyOddsH">American odds, like +450 or -120. With them, your record counts units won and lost.</p>
        <p class="py-notbet">${ic('help', 16)}<span><b>This tracks a parlay. It doesn’t place one.</b> Floodlight never takes money or sends anything to a sportsbook. Place a bet with your book if you want one, then log the odds here.</span></p>
        ${V.err ? `<p class="py-err" role="alert">${esc(V.err)}</p>` : ''}${V.priceNote ? `<p class="py-hint py-pnote">${esc(V.priceNote)}</p>` : ''}
        <div class="py-acts"><button type="button" class="bt wide py-lock" data-py="lock" data-fk="lock"${off ? ' disabled' : ''}${why.length ? ' aria-describedby="pyWhy"' : ''}>${ic('save', 18)}${V.saving ? 'Locking in…' : n === 1 ? 'Track this pick' : 'Lock it in'}</button>${stale && !V.saving ? `<button type="button" class="bt py-reprice" data-py="reprice" data-fk="reprice"${V.repricing ? ' disabled' : ''}>${ic('swap', 18)}${V.repricing ? 'Refreshing…' : 'Refresh prices'}</button>` : ''}<button type="button" class="bt ghost py-clr" data-py="empty" data-fk="empty">Clear</button></div>
        ${why.length ? `<ul class="py-why" id="pyWhy">${why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="py-hint">Once it is locked in, the picks can't be changed. ${window.S?.me ? 'It is kept with your account.' : 'It is kept in this browser. Log in to keep it with your account.'}</p>`
        : `<p class="py-empty">Nothing added yet. Choose a game or a player line${matchMedia('(max-width:1100px)').matches ? ' above' : ' on the left'} to start.</p>`}</section>`;
  }
  function drawBuild() {
    const el = $('pyBuild'); if (!el) return;
    document.querySelector('#pg-parlays .py-new')?.toggleAttribute('hidden', V.open);
    if (!V.open) { el.innerHTML = V.said ? `<p class="card py-said" role="status">${ic('check', 18)}${esc(V.said)}</p>` : ''; return }
    const seg = `<div class="seg" role="radiogroup" aria-label="What to add">${[['games', 'Games'], ['props', 'Player lines']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${V.tab === k}" class="${V.tab === k ? 'on' : ''}" tabindex="${V.tab === k ? 0 : -1}" data-pytab="${k}" data-fk="tab-${k}">${l}</button>`).join('')}</div>`;
    el.innerHTML = `<section class="py-build" aria-label="Build a parlay"><div class="sec-h"><h2>Build a parlay</h2><button type="button" class="bt sm ghost" data-py="close" data-fk="close">${ic('x', 16)}Close</button></div>
      <div class="g2 py-bcols"><div class="card py-pick"><p class="lb">Only games that haven't started can go in.</p>${V.draft.legs.length ? `<button type="button" class="bt sm py-jump" data-py="toticket" data-fk="toticket">${ic('down', 16)}Your parlay: ${plural(V.draft.legs.length, 'pick')}</button>` : ''}${seg}${V.tab === 'games' ? gamesTab() : propsTab()}</div>${ticket()}</div></section>`;
  }
  const parseOdds = s => { const t = String(s || '').replace(/[−–]/g, '-').replace(/\s/g, ''); if (!t) return null; const n = +t; return isFinite(n) && Math.abs(n) >= 100 && Math.abs(n) <= 1000000 ? Math.round(n) : NaN };
  const parseStake = s => { const t = String(s || '').replace(',', '.').trim(); if (!t) return null; const n = +t; return isFinite(n) && n > 0 && n <= 1e6 ? n : NaN };
  async function lock() {
    if (V.saving) return;
    const odds = parseOdds(V.draft.odds), stake = parseStake(V.draft.stake);
    if (Number.isNaN(odds)) { V.err = 'Write the odds the American way, like +450 or -120, or leave the box empty.'; draw(); return $('pyOdds')?.focus() }
    if (Number.isNaN(stake)) { V.err = 'Write your stake as a number of units, like 1 or 2.5, or leave the box empty.'; draw(); return $('pyStake')?.focus() }
    V.saving = true; V.err = ''; draw();
    try {
      const p = await C.add({ legs: V.draft.legs, name: V.draft.name.trim(), odds, stake, warn: warnOf(V.draft.legs) });
      V.said = `Locked in: ${nameOf(p)}. It will update here once the first game starts.`; V.draft = { legs: [], name: '', odds: '', stake: '' }; saveDraft(); V.open = false; V.saving = false;
      draw(); refresh(); document.querySelector('#pg-parlays .pg-title')?.focus({ preventScroll: true }); scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } catch (e) { V.saving = false; V.err = e.message || 'It did not save. Try again.'; draw() }
  }
  function openBuilder(tab) { V.open = true; V.said = ''; if (tab) V.tab = tab; if (V.tab === 'games') loadGames(); else loadProps(); draw() }
  // picks handed over from the Predictions slip
  function build(picks) {
    const legs = (picks || []).map(p => C.fromPick(p)).filter(l => l && l.start > Date.now()), lost = (picks || []).length - legs.length;
    for (const l of legs) if (!inDraft(l.id) && V.draft.legs.length < MAX) V.draft.legs.push(l);
    saveDraft(); window.flPages.show('parlays'); openBuilder(legs.some(l => l.type === 'prop') ? 'props' : 'games');
    if (lost) window.toast?.(`${plural(lost, 'pick')} left out: the game has started or is off the board`);
  }

  /* ---------- actions ---------- */
  document.addEventListener('click', e => {
    const pg = e.target.closest('#pg-parlays'); if (!pg) return;
    const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
    if (d.py === 'new') return openBuilder();
    if (d.py === 'close') { V.open = false; return draw() }
    if (d.pytab) { V.tab = d.pytab; return openBuilder() }
    if (d.pylg) { V.lg = d.pylg; store.set('fl.parlayLg', V.lg); V.games = null; return loadGames() }
    if (d.pyday) { V.day = +d.pyday; V.games = null; return loadGames() }
    if (d.pygame) { V.exp = V.exp === d.pygame ? '' : d.pygame; return draw() }
    if (d.pystep) { const [eid, kind, by] = d.pystep.split('|'), g = V.games?.find(x => x.eid === eid); if (!g) return; (V.lines[eid] || (V.lines[eid] = {}))[kind] = half(lineOf(g, kind).v + +by); if (kind === 'total' && V.lines[eid][kind] < .5) V.lines[eid][kind] = .5; return draw() }
    if (d.pyleg) { try { return addLeg(JSON.parse(d.pyleg)) } catch (x) { return } }
    if (d.pyrm) { const l = V.draft.legs.find(x => x.id === d.pyrm); V.draft.legs = V.draft.legs.filter(x => x.id !== d.pyrm); V.err = ''; V.priceNote = ''; saveDraft(); if (l) say(`Took out ${l.text}.`); draw(); return (document.querySelector('#pg-parlays [data-pyrm]') || $('pyTicket'))?.focus({ preventScroll: true }) }
    if (d.py === 'empty') { V.draft = { legs: [], name: '', odds: '', stake: '' }; V.err = ''; V.priceNote = ''; saveDraft(); return draw() }
    if (d.py === 'lock') return lock();
    if (d.py === 'reprice') return reprice();
    if (d.py === 'toticket') { const t = $('pyTicket'); t?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return t?.focus({ preventScroll: true }) }
    if (d.py === 'reprops') return loadProps(true);
    if (d.py === 'reload') return C.load().then(() => refresh(true));
    if (d.py === 'all') { V.all = !V.all; return draw() }
    if (d.pydel) { V.confirm = d.pydel; V.edit = ''; return draw() }
    if (d.pyedit) { V.edit = d.pyedit; V.confirm = ''; V.err = ''; return draw() }
    if (d.py === 'keep') { V.confirm = ''; V.edit = ''; V.err = ''; return draw() }
    if (d.pyyes) { V.confirm = ''; return C.remove(d.pyyes).then(draw, x => { V.err = x.message; draw() }) }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest?.('form[data-pyform]'); if (!f) return; e.preventDefault();
    const odds = parseOdds(f.odds.value), stake = parseStake(f.stake.value);
    if (Number.isNaN(odds)) { V.err = 'Write the odds the American way, like +450 or -120, or leave the box empty.'; return draw() }
    if (Number.isNaN(stake)) { V.err = 'Write your stake as a number of units, like 1 or 2.5, or leave the box empty.'; return draw() }
    C.edit(f.dataset.pyform, { name: f.name.value.trim(), odds, stake }).then(() => { V.edit = ''; V.err = ''; draw() }, x => { V.err = x.message || 'It did not save.'; draw() });
  });
  document.addEventListener('input', e => {
    const id = e.target.id; if (!e.target.closest?.('#pg-parlays')) return;
    if (id === 'pyName') { V.draft.name = e.target.value; saveDraft() } else if (id === 'pyOdds') { V.draft.odds = e.target.value; saveDraft() } else if (id === 'pyStake') { V.draft.stake = e.target.value; saveDraft() }
    else if (id === 'pyQ') { V.q = e.target.value; clearTimeout(V.qt); V.qt = setTimeout(draw, 160) }
  });
  document.addEventListener('toggle', e => { const d = e.target; if (d?.dataset?.pyfold) d.open ? V.unfold.add(d.dataset.pyfold) : V.unfold.delete(d.dataset.pyfold) }, true);
  document.addEventListener('fl:parlays', () => { if (window.flPages.current() === 'parlays' && !V.busy) draw() });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && window.flPages.current() === 'parlays' && Date.now() - V.at > 20000) refresh() });

  window.flPages.add('parlays', { title: 'Parlays', render,
    onShow() { (C.state.loaded ? Promise.resolve() : C.load()).then(() => { draw(); refresh() }); if (V.open) { V.tab === 'games' ? loadGames() : loadProps() } },
    onHide() { clearTimeout(V.timer) } });
  // the parlays page with the builder open on the saved draft (Home's "Continue researching" and saved boards open it this way)
  function openDraft() { window.flPages.show('parlays'); const t = V.draft.legs.length && V.draft.legs.every(l => l.type === 'prop') ? 'props' : 'games'; openBuilder(t) }
  window.flParlays = { build, open: openBuilder, openDraft, refresh, read: parlayRead, state: V, strip };
  // a parlay whose games are over is settled whenever the site is open, not only on this page, so the record on the profile is up to date
  setTimeout(() => { if (window.flAccess && !window.flAccess.has('predictions')) return;
    (C.state.loaded ? Promise.resolve() : C.load()).then(() => { if (tracked().some(p => p.legs.some(l => !l.res && l.start < Date.now()))) refresh() }) }, 7000);
})();
