/* Floodlight · Pick history: every match forecast that was locked at kick-off, and how it turned out.
   It reads the server's record (record.py). A pick is copied there when its match kicks off and cannot be edited after;
   it is graded when the final score is in. A miss stays on the list exactly like a hit: nothing here filters by result
   unless you ask it to. Only match forecasts are graded so far. Player props are not, and the page says so. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const pct = x => Math.round(x * 100);
  const LG = { nfl: 'NFL', fbs: 'College football', fcs: 'College football (FCS)', ufl: 'UFL' };
  const sportOf = e => e.sport === 'soccer' ? 'Soccer' : LG[e.lg] || 'Football';
  const RANGE = [[30, '30 days'], [90, '90 days'], [0, 'All time']];
  const BUCKETS = [[0, 45, 'Under 45%'], [45, 55, '45–54%'], [55, 65, '55–64%'], [65, 75, '65–74%'], [75, 101, '75%+']];
  const Hs = { rows: null, at: 0, err: '', loading: false, sport: 'all', res: 'all', days: 90, shown: 40 };
  const get = url => Promise.race([fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || String(r.status)); return d }), new Promise((_, no) => setTimeout(() => no(new Error('It took too long to answer.')), 20000))]);
  async function load(force) {
    if (Hs.loading || (!force && Hs.at && Date.now() - Hs.at < 60000)) return; Hs.loading = true; draw();
    try { const d = await get('/api/record'); Hs.rows = d.entries || []; Hs.err = ''; Hs.at = Date.now() } catch (e) { Hs.err = e.message || 'It did not load.' }
    Hs.loading = false; draw();
  }
  const graded = e => e.result === 'won' || e.result === 'lost';
  function stats(rows) {
    const g = rows.filter(graded), won = g.filter(e => e.result === 'won').length, priced = g.filter(e => e.market && typeof e.market[e.pick] === 'number');
    const vs = priced.length ? (priced.filter(e => e.result === 'won').length / priced.length - priced.reduce((a, e) => a + e.market[e.pick], 0) / priced.length) * 100 : null;
    return { n: g.length, won, lost: g.length - won, rate: g.length ? won / g.length : null, said: g.length ? g.reduce((a, e) => a + (e.top || 0), 0) / g.length : null, vs, priced: priced.length };
  }
  const group = (rows, key) => { const m = new Map(); for (const e of rows) { const k = key(e); if (k == null) continue; (m.get(k) || m.set(k, []).get(k)).push(e) } return [...m].map(([k, xs]) => ({ k, ...stats(xs) })).filter(x => x.n).sort((a, b) => b.n - a.n) };
  const signed = v => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const table = (title, first, rows) => rows.length ? `<section class="card hs-card" aria-label="${esc(title)}"><div class="sec-h"><h2>${esc(title)}</h2></div><div class="tbx-wrap"><table class="tbx hs-tbl"><thead><tr><th scope="col">${esc(first)}</th><th scope="col" class="r">Picks</th><th scope="col" class="r">Hit</th><th scope="col" class="r">Missed</th><th scope="col" class="r">Hit rate</th><th scope="col" class="r">We said</th><th scope="col" class="r">Against the market</th></tr></thead>
    <tbody>${rows.map(r => `<tr><th scope="row">${esc(r.k)}</th><td class="r num">${r.n}</td><td class="r num">${r.won}</td><td class="r num">${r.lost}</td><td class="r num"><b>${pct(r.rate)}%</b></td><td class="r num">${pct(r.said)}%</td><td class="r num">${r.vs == null ? '<span class="lb">no prices</span>' : signed(r.vs)}</td></tr>`).join('')}</tbody></table></div>
    ${rows.some(r => r.n < 10) ? '<p class="lb">A row with fewer than 10 picks is too small to read much into.</p>' : ''}</section>` : '';

  function render(el) {
    el.innerHTML = `<div class="vst hs"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Pick history</h1><p class="pg-sub">Every match pick we locked in, and how it turned out. Misses stay on the list.</p></div>
      <button type="button" class="bt ghost" data-page="predictions">${ic('pred', 18)}Back to Predictions</button></header><div id="hsBody" class="vst" aria-live="polite"></div></div>`;
    draw();
  }
  function draw() {
    const el = document.getElementById('hsBody'); if (!el) return;
    if (!Hs.rows) { el.innerHTML = Hs.err ? `<div class="card emp">${ic('help', 28)}<b>The record did not load</b><p>${esc(Hs.err)} This is a connection problem; the record itself is kept on the server.</p><button type="button" class="bt" data-hs="reload">Try again</button></div>`
      : `<div class="hs-tiles" aria-hidden="true">${'<i class="skl" style="height:96px;display:block"></i>'.repeat(4)}</div><div class="skl" style="height:260px"></div><div class="skl" style="height:320px"></div>`; return }
    const act = document.activeElement?.closest?.('#pg-history [data-fk]')?.dataset.fk;
    const since = Hs.days ? Date.now() / 1000 - Hs.days * 86400 : 0, inRange = Hs.rows.filter(e => e.ko >= since), sports = [...new Set(Hs.rows.map(sportOf))];
    const rows = inRange.filter(e => Hs.sport === 'all' || sportOf(e) === Hs.sport), S = stats(rows), pending = rows.filter(e => !e.result).length, other = rows.filter(e => e.result && !graded(e)).length;
    const list = rows.filter(e => Hs.res === 'all' || (Hs.res === 'pending' ? !e.result : e.result === Hs.res));
    const seg = (name, label, opts, cur) => `<div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" tabindex="${cur === k ? 0 : -1}" data-hs${name}="${k}" data-fk="${name}-${k}">${esc(l)}</button>`).join('')}</div>`;
    const buckets = BUCKETS.map(([lo, hi, label]) => { const xs = rows.filter(e => graded(e) && e.top * 100 >= lo && e.top * 100 < hi); return { label, ...stats(xs) } }), H = 130, col = v => v == null ? 0 : Math.max(3, Math.round(v * H));
    const cal = S.n ? `<section class="card hs-card" aria-label="Calibration"><div class="sec-h"><h2>Were the percentages honest?</h2><span class="lb">When we said X%, how often it hit</span></div>
      <div class="pd-cal hs-cal" role="img" aria-label="${esc(buckets.filter(b => b.n).map(b => `${b.label}: we said ${pct(b.said)}%, it hit ${pct(b.rate)}%, ${b.n} picks`).join('. '))}">${buckets.map(b => `<div class="pd-col${b.n ? '' : ' none'}"><div class="pd-pair" style="height:${H + 22}px"><span class="said" style="height:${col(b.said)}px"><i class="num">${b.n ? pct(b.said) : ''}</i></span><span class="hit" style="height:${col(b.rate)}px"><i class="num">${b.n ? pct(b.rate) : ''}</i></span></div><b>${esc(b.label)}</b><small class="num">${b.n ? `${b.n} ${b.n === 1 ? 'pick' : 'picks'}` : 'none'}</small></div>`).join('')}</div>
      <div class="pd-leg" aria-hidden="true"><span><i class="said"></i>We said</span><span><i class="hit"></i>It hit</span></div>
      <p class="lb">The two bars in a group should be about the same height. A taller “It hit” bar means we were too cautious there; a shorter one means we were too sure.${S.n < 50 ? ` With ${S.n} graded picks, single groups can swing a lot.` : ''}</p></section>` : '';
    const row = e => { const pick = e.pick === 'draw' ? 'Draw' : `${e[e.pick]} to win`, fin = Array.isArray(e.final) ? `${e.final[0]}–${e.final[1]}` : '', mk = e.market && typeof e.market[e.pick] === 'number' ? e.market[e.pick] : null;
      const res = e.result === 'won' ? `<span class="pl pd-res hit">${ic('check', 14)}Hit</span>` : e.result === 'lost' ? `<span class="pl pd-res miss hs-miss">${ic('x', 14)}Miss</span>` : e.result ? `<span class="pl">${esc(e.result === 'push' ? 'Tie, no result' : 'Void')}</span>` : '<span class="pl">Waiting for the final</span>';
      return `<tr><td class="num hs-when">${esc(new Date(e.ko * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}</td><th scope="row"><b>${esc(pick)}</b><small>${esc(e.home)} ${fin ? esc(fin) : 'v'} ${esc(e.away)} · ${esc(sportOf(e))}</small></th><td class="r num">${pct(e.top)}%</td><td class="r num">${mk == null ? '<span class="lb">–</span>' : pct(mk) + '%'}</td><td>${esc(e.conf || '')}</td><td class="hs-res">${res}</td></tr>` };
    el.innerHTML = `<div class="pd-filters"><div class="cx-row scroll" role="radiogroup" aria-label="Sport">${[['all', 'All sports'], ...sports.map(s => [s, s])].map(([k, l]) => `<button type="button" class="cx" role="radio" aria-checked="${Hs.sport === k}" tabindex="${Hs.sport === k ? 0 : -1}" data-hssport="${esc(k)}" data-fk="sp-${esc(k)}">${esc(l)}</button>`).join('')}</div>
        <div class="pd-ctl">${seg('days', 'Period', RANGE.map(([k, l]) => [k, l]), Hs.days)}<span class="lb hs-at">${Hs.loading ? 'Checking…' : `Record read ${new Date(Hs.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}${Hs.err ? ' · the last check failed, showing the earlier reading' : ''}</span><button type="button" class="bt ghost sm" data-hs="reload" data-fk="reload"${Hs.loading ? ' disabled' : ''}>Refresh</button></div></div>
      ${!rows.length ? `<div class="card emp">${ic('bars', 28) || ic('trophy', 28)}<b>No picks in this period</b><p>A match forecast lands here when its match kicks off. Widen the period or choose another sport.</p></div>` : `
      <div class="hs-tiles"><div class="tile inset"><span class="lb">Graded picks</span><b class="fig num">${S.n}</b><small class="lb">${pending ? `${pending} waiting for a final` : 'none waiting'}${other ? ` · ${other} void or tied` : ''}</small></div>
        <div class="tile inset"><span class="lb">Hit</span><b class="fig num">${S.won}</b><small class="lb">Missed ${S.lost}</small></div>
        <div class="tile inset"><span class="lb">Hit rate</span><b class="fig num">${S.rate == null ? '–' : pct(S.rate) + '%'}</b><small class="lb">${S.said == null ? '' : `we said ${pct(S.said)}% on average`}</small></div>
        <div class="tile inset"><span class="lb">Against the market</span><b class="fig num">${signed(S.vs)}</b><small class="lb">${S.vs == null ? 'no prices saved with these picks' : `points, over ${S.priced} priced ${S.priced === 1 ? 'pick' : 'picks'}`}</small></div></div>
      ${cal}
      ${Hs.sport === 'all' ? table('By sport', 'Sport', group(rows, sportOf)) : ''}
      ${table('By confidence label', 'Label', group(rows, e => e.conf || null))}
      ${table('By what we said', 'Our number', buckets.filter(b => b.n).map(b => ({ k: b.label, ...b })))}
      <section class="card hs-card" aria-label="Every pick"><div class="sec-h"><h2>Every pick</h2>${seg('res', 'Show', [['all', `All ${rows.length}`], ['won', `Hits ${S.won}`], ['lost', `Misses ${S.lost}`], ...(pending ? [['pending', `Waiting ${pending}`]] : [])], Hs.res)}</div>
        ${list.length ? `<div class="tbx-wrap"><table class="tbx hs-list"><thead><tr><th scope="col">Kick-off</th><th scope="col">Pick</th><th scope="col" class="r">We said</th><th scope="col" class="r">Market</th><th scope="col">Label</th><th scope="col">Result</th></tr></thead><tbody>${list.slice(0, Hs.shown).map(row).join('')}</tbody></table></div>
          ${list.length > Hs.shown ? `<button type="button" class="bt ghost wide" data-hs="more" data-fk="more">Show ${Math.min(40, list.length - Hs.shown)} more of ${list.length}</button>` : ''}` : '<p class="lb">Nothing in this view.</p>'}</section>`}
      <p class="lb hs-how">How the record is kept: a pick is copied here when its match kicks off and is locked from then on. It is graded when the final score is in, and a miss is kept exactly like a hit. The server keeps the newest 3,000 picks. “Against the market” is our hit rate minus the chance the book’s prices gave the same picks. Player props are not graded yet, so they are not in these numbers. This is a record of research, not betting advice.</p>`;
    if (act) [...document.querySelectorAll('#pg-history [data-fk]')].find(x => x.dataset.fk === act)?.focus({ preventScroll: true });
  }
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#pg-history [data-hs],#pg-history [data-hssport],#pg-history [data-hsdays],#pg-history [data-hsres]'); if (!t) return; const d = t.dataset;
    if (d.hssport) { Hs.sport = d.hssport; Hs.shown = 40 } else if (d.hsdays != null) { Hs.days = +d.hsdays; Hs.shown = 40 } else if (d.hsres) { Hs.res = d.hsres; Hs.shown = 40 }
    else if (d.hs === 'more') Hs.shown += 40; else if (d.hs === 'reload') return load(true);
    draw();
  });
  window.flPages?.add('history', { title: 'Pick history', render, onShow() { load() } });
  window.flHistory = { stats, state: Hs };
})();
