/* Floodlight · line movement. How each book's price for a game has moved since we started reading it.
   The server keeps every fresh price reading with its time (linehist.py, /api/odds/history): a reading is kept when a
   price moves, or every 15 minutes while it holds, for 14 days. This draws them: one line per book for the chance inside
   its price to win, stepped (a price holds until the book changes it), plus the main spread and total, first to latest.
   With fewer than two readings there is no movement to draw, and it says so. Shown in the evidence panel and the match
   centre, for research only. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BOOKS = { fanduel: 'FanDuel', draftkings: 'DraftKings', kalshi: 'Kalshi', polymarket: 'Polymarket' };
  const ORDER = ['fanduel', 'draftkings', 'kalshi', 'polymarket'];   // colour follows the book, never its rank
  const DASH = ['', '', '6 4', '2 3'];                                  // a second cue beside colour
  const am = v => v == null ? '–' : (v > 0 ? '+' : '') + v, pc = p => Math.round(p * 100);
  const tm = t => new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const cache = new Map(), charts = new Map();
  let uid = 0;

  /* the same inputs the odds board takes: sport, league, the two teams and the start time */
  function key(q) { return ['sport', 'lg', 'home', 'away', 'date'].map(k => q[k] || '').join('|') }
  function load(q, done) {
    const k = key(q), hit = cache.get(k);
    if (hit && (hit.busy || Date.now() - hit.at < 60000)) return hit;
    const e = { busy: true, at: Date.now(), data: hit?.data || null, err: '' }; cache.set(k, e);
    const p = new URLSearchParams({ sport: q.sport, lg: q.lg, home: q.home, away: q.away, date: q.date });
    fetch('/api/odds/history?' + p, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(new Error('The price history did not load.')))
      .then(d => { e.data = d; e.err = '' }, x => { e.err = x.message || 'The price history did not load.'; e.at = Date.now() - 45000 })
      .finally(() => { e.busy = false; done?.(); document.dispatchEvent(new Event('fl:lm')) });
    return e;
  }

  /* one series per book: the chance inside its price for `side`, at each reading where it posted one */
  function series(rs, side) {
    const by = new Map();
    for (const r of rs) for (const [b, row] of Object.entries(r.ml || {})) { const v = row[side]; if (v) (by.get(b) || by.set(b, []).get(b)).push({ t: r.t, p: v[0], am: v[1] }) }
    return [...by].sort((x, y) => (ORDER.indexOf(x[0]) + 9) % 9 - (ORDER.indexOf(y[0]) + 9) % 9).map(([book, pts]) => ({ book, pts, i: Math.max(0, ORDER.indexOf(book)) }));
  }
  const firstLast = (rs, f) => { const v = rs.map(f).filter(x => x != null); return v.length ? [v[0], v[v.length - 1]] : null };

  function chart(S, t0, t1, names) {
    const all = S.flatMap(s => s.pts.map(p => p.p)); if (!all.length) return '';
    let lo = Math.min(...all), hi = Math.max(...all); const pad = Math.max(.02, (hi - lo) * .15); lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
    const W = 600, H = 160, span = Math.max(1, t1 - t0), x = t => (t - t0) / span * W, y = p => H - (p - lo) / (hi - lo) * H;
    const path = pts => pts.map((p, k) => k ? `H${x(p.t).toFixed(1)}V${y(p.p).toFixed(1)}` : `M${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join('') + `H${W}`;
    const id = 'lm' + (++uid); charts.set(id, { S, t0, t1, lo, hi, names });
    if (charts.size > 40) charts.delete(charts.keys().next().value);
    // direct labels at the right edge, nudged apart so two books on the same price do not overprint
    const ends = S.map(s => ({ s, y: y(s.pts[s.pts.length - 1].p) / H * 100 })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 13);
    if (ends.length) { ends[ends.length - 1].y = Math.min(100, ends[ends.length - 1].y); for (let k = ends.length - 2; k >= 0; k--) ends[k].y = Math.min(ends[k].y, ends[k + 1].y - 13) }
    const mid = (lo + hi) / 2;
    return `<div class="lm-plot" data-lmid="${id}" tabindex="0" role="group" aria-label="Price movement chart. Left and right arrows step through the readings.">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${[hi, mid, lo].map(v => `<line class="lm-grid" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join('')}
          ${S.map(s => `<path class="lm-line" d="${path(s.pts)}" style="stroke:var(--lm-${s.i + 1})" ${DASH[s.i] ? `stroke-dasharray="${DASH[s.i]}"` : ''}/>`).join('')}
          <line class="lm-cur" x1="0" x2="0" y1="0" y2="${H}" hidden/>
        </svg>
        <span class="lm-ax num" style="top:0">${pc(hi)}%</span><span class="lm-ax num" style="top:50%">${pc(mid)}%</span><span class="lm-ax num" style="top:100%">${pc(lo)}%</span>
        ${ends.map(e => `<span class="lm-end num" style="top:${e.y.toFixed(1)}%"><i style="background:var(--lm-${e.s.i + 1})"></i>${pc(e.s.pts[e.s.pts.length - 1].p)}%</span>`).join('')}
        <div class="lm-tip" role="status" aria-live="polite" hidden></div>
      </div>
      <div class="lm-time lb num"><span>${esc(tm(t0))}</span><span>${esc(tm(t1))}</span></div>`;
  }

  /* entry: what load() returned. o: { names: {home, away, draw}, side: 'home' | 'away' | 'draw', title } */
  function html(entry, o) {
    const head = o.head === false ? '' : `<h4 class="lm-h">${esc(o.title || 'How the price has moved')}</h4>`;
    if (!entry || (entry.busy && !entry.data)) return `<section class="lm">${head}<div class="skl lm-skl" aria-busy="true"></div><p class="sr-only">Loading the price history…</p></section>`;
    if (entry.err && !entry.data) return `<section class="lm">${head}<p class="lb">${esc(entry.err)} <button type="button" class="bt sm" data-lmretry>Try again</button></p></section>`;
    const d = entry.data || {}, rs = d.readings || [];
    if (rs.length < 2) return `<section class="lm">${head}<p class="lm-none"><b>No movement recorded yet.</b> <span class="lb">${rs.length ? `One price reading so far, ${esc(tm(rs[0].t))}.` : 'We have not read a price for this game yet.'} We keep each reading from now on; the chart draws itself from the second one.</span></p></section>`;
    const side = o.side || 'home', nm = (o.names || {})[side] || (side === 'draw' ? 'Draw' : side), S = series(rs, side);
    const t0 = rs[0].t, t1 = rs[rs.length - 1].t;
    // first to latest, per book, then the main spread and total
    const moves = S.map(s => { const a = s.pts[0], b = s.pts[s.pts.length - 1], dp = pc(b.p) - pc(a.p);
      return `<li><i class="lm-key" style="--c:var(--lm-${s.i + 1})" data-dash="${DASH[s.i] ? 1 : 0}"></i><b>${esc(BOOKS[s.book] || s.book)}</b> <span class="num">${am(a.am)} → ${am(b.am)}</span> <span class="lb num">${pc(a.p)}% → ${pc(b.p)}%${dp ? ` (${dp > 0 ? '+' : '−'}${Math.abs(dp)})` : ', no change'}</span></li>` }).join('');
    const sp = firstLast(rs, r => r.sp?.line), tt = firstLast(rs, r => r.tot?.line), hn = (o.names || {}).home || 'Home';
    const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
    const lines = [sp ? `<li><b>Spread</b> <span class="num">${esc(hn)} ${sgn(sp[0])} → ${sgn(sp[1])}</span>${sp[0] === sp[1] ? ' <span class="lb">held</span>' : ''}</li>` : '',
      tt ? `<li><b>Total</b> <span class="num">${tt[0]} → ${tt[1]}</span>${tt[0] === tt[1] ? ' <span class="lb">held</span>' : ''}</li>` : ''].join('');
    return `<section class="lm">${head}<p class="lb lm-sub">The chance inside each book's price for <b>${esc(nm)}</b>, ${rs.length} readings from ${esc(tm(t0))} to ${esc(tm(t1))}.</p>
      ${S.length ? chart(S, t0, t1, o.names || {}) : '<p class="lb">No book posted a price to win for this side.</p>'}
      <ul class="lm-moves">${moves}${lines}</ul>
      <p class="lb lm-how">What the books posted when we read them, not a forecast. A reading is kept when a price moves, or every 15 minutes while it holds; readings older than 14 days are dropped.</p></section>`;
  }

  /* hover, tap and arrow keys: a crosshair at the reading and every book's price there */
  function show(el, idx) {
    const c = charts.get(el.dataset.lmid); if (!c) return;
    const ts = [...new Set(c.S.flatMap(s => s.pts.map(p => p.t)))].sort((a, b) => a - b); if (!ts.length) return;
    idx = Math.max(0, Math.min(ts.length - 1, idx)); el.dataset.lmi = idx; const t = ts[idx];
    const at = s => s.pts.reduce((b, p) => p.t <= t ? p : b, null);
    const tip = el.querySelector('.lm-tip'), cur = el.querySelector('.lm-cur'), fx = (t - c.t0) / Math.max(1, c.t1 - c.t0);
    cur.setAttribute('x1', fx * 600); cur.setAttribute('x2', fx * 600); cur.hidden = false;
    tip.innerHTML = `<b class="num">${esc(tm(t))}</b>${c.S.map(s => { const p = at(s); return p ? `<span><i style="background:var(--lm-${s.i + 1})"></i>${esc(BOOKS[s.book] || s.book)} <b class="num">${am(p.am)}</b> <small class="num">${pc(p.p)}%</small></span>` : '' }).join('')}`;
    tip.hidden = false; tip.style.left = Math.min(100, Math.max(0, fx * 100)) + '%'; tip.classList.toggle('flip', fx > .6);
  }
  const hide = el => { el.querySelector('.lm-tip').hidden = true; el.querySelector('.lm-cur').hidden = true; delete el.dataset.lmi };
  const nearest = (el, clientX) => { const c = charts.get(el.dataset.lmid); if (!c) return 0; const r = el.querySelector('svg').getBoundingClientRect(), t = c.t0 + (clientX - r.left) / r.width * (c.t1 - c.t0);
    const ts = [...new Set(c.S.flatMap(s => s.pts.map(p => p.t)))].sort((a, b) => a - b); let k = 0; ts.forEach((v, i) => { if (Math.abs(v - t) < Math.abs(ts[k] - t)) k = i }); return k };
  document.addEventListener('pointermove', ev => { const el = ev.target.closest?.('.lm-plot'); if (el) show(el, nearest(el, ev.clientX)) });
  document.addEventListener('pointerout', ev => { const el = ev.target.closest?.('.lm-plot'); if (el && !el.contains(ev.relatedTarget) && document.activeElement !== el) hide(el) });
  document.addEventListener('focusout', ev => { if (ev.target.matches?.('.lm-plot')) hide(ev.target) });
  document.addEventListener('keydown', ev => { const el = ev.target.closest?.('.lm-plot'); if (!el || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(ev.key)) return; ev.preventDefault();
    if (ev.key === 'Escape') return hide(el); const i = el.dataset.lmi == null ? -1 : +el.dataset.lmi; show(el, ev.key === 'Home' ? 0 : ev.key === 'End' ? 1e9 : ev.key === 'ArrowLeft' ? (i < 0 ? 1e9 : i - 1) : i + 1) });

  // Try again: forget the failed reading so the next draw asks the server again
  document.addEventListener('click', ev => { if (!ev.target.closest?.('[data-lmretry]')) return; for (const e of cache.values()) if (e.err) e.at = 0; document.dispatchEvent(new Event('fl:lm')) });

  window.flLineMove = { load, html, key };
})();
