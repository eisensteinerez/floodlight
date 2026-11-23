/* Floodlight · Pick history: every published pick, locked before the start, and how it turned out.
   Two records on the server, read together:
   - match forecasts (record.py): copied when the match kicks off and locked from then on, graded at full time;
   - player props (propbook.py): locked the first time the Predictions page shows them, graded from the player's game
     log when his game is over, with the last reading before the start kept for the closing-line check.
   A miss stays on the list exactly like a hit: nothing here filters by result unless you ask it to. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const pct = x => Math.round(x * 100);
  const LG = { nfl: 'NFL', fbs: 'College football', fcs: 'College football (FCS)', ufl: 'UFL' };
  const PROP_SPORT = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer' };
  const BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' };
  const fmt = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const RANGE = [[30, '30 days'], [90, '90 days'], [0, 'All time']];
  const KINDS = [['all', 'All picks'], ['match', 'Match forecasts'], ['prop', 'Player props']];
  const BUCKETS = [[0, 45, 'Under 45%'], [45, 55, '45–54%'], [55, 65, '55–64%'], [65, 75, '65–74%'], [75, 101, '75%+']];
  const EDGES = [[-1e9, 0, 'Below 0'], [0, 3, '0–2 points'], [3, 5, '3–4 points'], [5, 10, '5–9 points'], [10, 1e9, '10+ points']];
  const Hs = { rows: null, props: null, at: 0, err: '', propErr: '', loading: false, sport: 'all', kind: 'all', res: 'all', days: 90, shown: 40, by: 'sport' };
  const get = url => Promise.race([fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || String(r.status)); return d }), new Promise((_, no) => setTimeout(() => no(new Error('It took too long to answer.')), 20000))]);
  async function load(force) {
    if (Hs.loading || (!force && Hs.at && Date.now() - Hs.at < 60000)) return; Hs.loading = true; draw();
    await Promise.all([
      get('/api/record').then(d => { Hs.rows = d.entries || []; Hs.err = '' }, e => { Hs.err = e.message || 'It did not load.' }),
      get('/api/props/record').then(d => { Hs.props = d.entries || []; Hs.propErr = '' }, e => { Hs.props = Hs.props || []; Hs.propErr = e.message || 'It did not load.' })]);
    if (!Hs.err) Hs.at = Date.now();
    Hs.loading = false; draw();
  }

  /* one shape for both records: { kind, t, sport, providers, market, ours, mkt, edge, conf, result, clv, title, sub, actual, why } */
  function fromMatch(e) {
    const mk = e.market && typeof e.market[e.pick] === 'number' ? e.market[e.pick] : null, fin = Array.isArray(e.final) ? `${e.final[0]}–${e.final[1]}` : '';
    return { kind: 'match', key: e.key, t: e.ko, sport: e.sport === 'soccer' ? 'Soccer' : LG[e.lg] || 'Football', providers: [mk == null ? 'No price saved' : 'Sportsbooks'],
      market: e.pick === 'draw' ? 'Match result: draw' : 'Match result: win', ours: e.top, mkt: mk, edge: mk == null ? null : pct(e.top) - pct(mk), conf: e.conf || '', result: e.result || null, clv: null,
      title: e.pick === 'draw' ? 'Draw' : `${e[e.pick]} to win`, sub: `${e.home} ${fin || 'v'} ${e.away}`, actual: fin, why: '' };
  }
  function fromProp(e) {
    const over = e.side === 'over', what = e.yes ? `${e.label}: ${over ? 'Yes' : 'No'}` : `${over ? 'Over' : 'Under'} ${fmt(e.line)} ${String(e.label).toLowerCase()}`;
    return { kind: 'prop', key: e.key, t: e.start, sport: PROP_SPORT[e.sport] || e.sport, providers: (e.books || []).map(b => BOOK[b] || b).filter(Boolean), market: e.label,
      ours: e.ours, mkt: e.market, edge: e.edge, conf: e.conf || '', result: e.result || null, clv: e.clv && e.clv.beat != null ? e.clv : null, clvNote: e.clv?.moved || '',
      title: `${e.player} ${what.charAt(0).toLowerCase() + what.slice(1)}`, sub: [e.team, e.opp].filter(Boolean).join(' v '), actual: e.actual || '', why: e.why || '' };
  }
  const all = (matches, props) => [...(matches || []).map(fromMatch), ...(props || []).map(fromProp)].sort((a, b) => b.t - a.t);
  const graded = e => e.result === 'won' || e.result === 'lost';
  function stats(rows) {
    const g = rows.filter(graded), won = g.filter(e => e.result === 'won').length, priced = g.filter(e => e.mkt != null);
    const vs = priced.length ? (priced.filter(e => e.result === 'won').length / priced.length - priced.reduce((a, e) => a + e.mkt, 0) / priced.length) * 100 : null;
    const cl = rows.filter(e => e.clv), beat = cl.filter(e => e.clv.beat).length;
    return { n: g.length, won, lost: g.length - won, rate: g.length ? won / g.length : null, said: g.length ? g.reduce((a, e) => a + (e.ours || 0), 0) / g.length : null, vs, priced: priced.length,
      clvN: cl.length, clv: cl.length ? beat / cl.length : null };
  }
  const group = (rows, keys) => { const m = new Map(); for (const e of rows) for (const k of [].concat(keys(e) ?? [])) { if (k == null || k === '') continue; (m.get(k) || m.set(k, []).get(k)).push(e) } return [...m].map(([k, xs]) => ({ k, ...stats(xs) })).filter(x => x.n || x.clvN) };
  const BY = {
    sport: ['Sport', rows => group(rows, e => e.sport).sort((a, b) => b.n - a.n)],
    provider: ['Provider', rows => group(rows, e => e.providers).sort((a, b) => b.n - a.n)],
    market: ['Market', rows => group(rows, e => e.market).sort((a, b) => b.n - a.n)],
    edge: ['Edge', rows => { const xs = group(rows, e => e.edge == null ? 'No market price' : EDGES.find(([lo, hi]) => e.edge >= lo && e.edge < hi)[2]), at = k => k === 'No market price' ? 99 : EDGES.findIndex(x => x[2] === k); return xs.sort((a, b) => at(a.k) - at(b.k)) }],
    said: ['Our number', rows => { const xs = group(rows, e => e.ours == null ? null : BUCKETS.find(([lo, hi]) => e.ours * 100 >= lo && e.ours * 100 < hi)[2]), at = k => BUCKETS.findIndex(x => x[2] === k); return xs.sort((a, b) => at(a.k) - at(b.k)) }],
    conf: ['Confidence label', rows => group(rows, e => e.conf ? e.conf.charAt(0).toUpperCase() + e.conf.slice(1) : null).sort((a, b) => b.n - a.n)],
  };
  const signed = v => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  function breakdown(rows) {
    const [first, fn] = BY[Hs.by], xs = fn(rows);
    const tabs = Object.entries(BY).map(([k, [l]]) => `<button type="button" role="tab" id="hs-tab-${k}" aria-selected="${Hs.by === k}" aria-controls="hs-by" tabindex="${Hs.by === k ? 0 : -1}" class="cx" data-hsby="${k}" data-fk="by-${k}">${esc(l)}</button>`).join('');
    return `<section class="card hs-card" aria-label="Performance by group"><div class="sec-h"><h2>Performance by</h2><div class="cx-row scroll" role="tablist" aria-label="Group the record by">${tabs}</div></div>
      <div id="hs-by" role="tabpanel" aria-labelledby="hs-tab-${Hs.by}">${xs.length ? `<div class="tbx-wrap"><table class="tbx hs-tbl"><thead><tr><th scope="col">${esc(first)}</th><th scope="col" class="r">Picks</th><th scope="col" class="r">Hit</th><th scope="col" class="r">Missed</th><th scope="col" class="r">Hit rate</th><th scope="col" class="r">We said</th><th scope="col" class="r">Against the market</th><th scope="col" class="r">Beat the close</th></tr></thead>
        <tbody>${xs.map(r => `<tr><th scope="row">${esc(r.k)}</th><td class="r num">${r.n}</td><td class="r num">${r.won}</td><td class="r num">${r.lost}</td><td class="r num"><b>${r.n ? pct(r.rate) + '%' : '–'}</b></td><td class="r num">${r.n ? pct(r.said) + '%' : '–'}</td><td class="r num">${r.vs == null ? '<span class="lb">no prices</span>' : signed(r.vs)}</td><td class="r num">${r.clvN ? `${pct(r.clv)}% <small class="lb">of ${r.clvN}</small>` : '<span class="lb">–</span>'}</td></tr>`).join('')}</tbody></table></div>
        ${xs.some(r => r.n && r.n < 10) ? '<p class="lb">A row with fewer than 10 graded picks is too small to read much into.</p>' : ''}
        ${Hs.by === 'provider' ? '<p class="lb">A prop posted on more than one app is counted under each of them.</p>' : ''}` : '<p class="lb">Nothing graded in this view yet.</p>'}</div></section>`;
  }

  function render(el) {
    el.innerHTML = `<div class="vst hs"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Pick history</h1><p class="pg-sub">Every pick we published, locked before the start, and how it turned out. Misses stay on the list.</p></div>
      <button type="button" class="bt ghost" data-page="predictions">${ic('pred', 18)}Back to Predictions</button></header><div id="hsBody" class="vst" aria-live="polite"></div></div>`;
    draw();
  }
  function draw() {
    const el = document.getElementById('hsBody'); if (!el) return;
    if (!Hs.rows) { el.innerHTML = Hs.err ? `<div class="card emp">${ic('help', 28)}<b>The record did not load</b><p>${esc(Hs.err)} This is a connection problem; the record itself is kept on the server.</p><button type="button" class="bt" data-hs="reload">Try again</button></div>`
      : `<div class="hs-tiles" aria-hidden="true">${'<i class="skl" style="height:96px;display:block"></i>'.repeat(4)}</div><div class="skl" style="height:260px"></div><div class="skl" style="height:320px"></div>`; return }
    const act = document.activeElement?.closest?.('#pg-history [data-fk]')?.dataset.fk;
    const every = all(Hs.rows, Hs.props), since = Hs.days ? Date.now() / 1000 - Hs.days * 86400 : 0, sports = [...new Set(every.map(e => e.sport))];
    const rows = every.filter(e => e.t >= since && (Hs.kind === 'all' || e.kind === Hs.kind) && (Hs.sport === 'all' || e.sport === Hs.sport)), S = stats(rows);
    const pending = rows.filter(e => !e.result).length, other = rows.filter(e => e.result && !graded(e)).length;
    const list = rows.filter(e => Hs.res === 'all' || (Hs.res === 'pending' ? !e.result : e.result === Hs.res));
    const seg = (name, label, opts, cur) => `<div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}" tabindex="${cur === k ? 0 : -1}" data-hs${name}="${k}" data-fk="${name}-${k}">${esc(l)}</button>`).join('')}</div>`;
    const buckets = BUCKETS.map(([lo, hi, label]) => { const xs = rows.filter(e => graded(e) && e.ours * 100 >= lo && e.ours * 100 < hi); return { label, ...stats(xs) } }), H = 130, col = v => v == null ? 0 : Math.max(3, Math.round(v * H));
    const cal = S.n ? `<section class="card hs-card" aria-label="Calibration"><div class="sec-h"><h2>Were the percentages honest?</h2><span class="lb">When we said X%, how often it hit</span></div>
      <div class="pd-cal hs-cal" role="img" aria-label="${esc(buckets.filter(b => b.n).map(b => `${b.label}: we said ${pct(b.said)}%, it hit ${pct(b.rate)}%, ${b.n} picks`).join('. '))}">${buckets.map(b => `<div class="pd-col${b.n ? '' : ' none'}"><div class="pd-pair" style="height:${H + 22}px"><span class="said" style="height:${col(b.said)}px"><i class="num">${b.n ? pct(b.said) : ''}</i></span><span class="hit" style="height:${col(b.rate)}px"><i class="num">${b.n ? pct(b.rate) : ''}</i></span></div><b>${esc(b.label)}</b><small class="num">${b.n ? `${b.n} ${b.n === 1 ? 'pick' : 'picks'}` : 'none'}</small></div>`).join('')}</div>
      <div class="pd-leg" aria-hidden="true"><span><i class="said"></i>We said</span><span><i class="hit"></i>It hit</span></div>
      <p class="lb">The two bars in a group should be about the same height. A taller “It hit” bar means we were too cautious there; a shorter one means we were too sure.${S.n < 50 ? ` With ${S.n} graded picks, single groups can swing a lot.` : ''}</p></section>` : '';
    const resPill = e => e.result === 'won' ? `<span class="pl pd-res hit">${ic('check', 14)}Hit${e.kind === 'prop' && e.actual ? ` · ${esc(e.actual)}` : ''}</span>` : e.result === 'lost' ? `<span class="pl pd-res miss hs-miss">${ic('x', 14)}Miss${e.kind === 'prop' && e.actual ? ` · ${esc(e.actual)}` : ''}</span>`
      : e.result === 'push' ? `<span class="pl">${e.kind === 'prop' ? `Push${e.actual ? ` · ${esc(e.actual)}` : ''}` : 'Tie, no result'}</span>` : e.result === 'void' ? `<span class="pl">${e.kind === 'prop' ? 'Void, did not play' : 'Void'}</span>`
      : e.result === 'unknown' ? `<span class="pl" title="${esc(e.why)}">Not graded</span>` : `<span class="pl">${e.kind === 'prop' ? 'Waiting for the game' : 'Waiting for the final'}</span>`;
    const row = e => `<tr><td class="num hs-when">${esc(new Date(e.t * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
      <th scope="row"><b>${esc(e.title)}</b><small>${esc([e.sub, e.sport, e.kind === 'prop' ? e.providers.join(', ') : ''].filter(Boolean).join(' · '))}</small>${e.why && e.result !== 'won' ? `<small class="hs-why">${esc(e.why)}</small>` : ''}</th>
      <td class="r num">${e.ours == null ? '–' : pct(e.ours) + '%'}</td><td class="r num">${e.mkt == null ? '<span class="lb">–</span>' : pct(e.mkt) + '%'}</td>
      <td class="hs-clv">${e.clv ? `<span class="${e.clv.beat ? 'hs-up' : 'hs-dn'}">${e.clv.beat ? 'Beat it' : 'Lost it'}</span><small>${esc(e.clvNote)}</small>` : '<span class="lb">–</span>'}</td><td class="hs-res">${resPill(e)}</td></tr>`;
    const noProps = !(Hs.props || []).length;
    el.innerHTML = `<div class="pd-filters"><div class="cx-row scroll" role="radiogroup" aria-label="Sport">${[['all', 'All sports'], ...sports.map(s => [s, s])].map(([k, l]) => `<button type="button" class="cx" role="radio" aria-checked="${Hs.sport === k}" tabindex="${Hs.sport === k ? 0 : -1}" data-hssport="${esc(k)}" data-fk="sp-${esc(k)}">${esc(l)}</button>`).join('')}</div>
        <div class="pd-ctl">${seg('kind', 'Kind of pick', KINDS, Hs.kind)}${seg('days', 'Period', RANGE, Hs.days)}<span class="lb hs-at">${Hs.loading ? 'Checking…' : `Record read ${new Date(Hs.at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}${Hs.err ? ' · the last check failed, showing the earlier reading' : ''}${Hs.propErr ? ' · the props record did not load' : ''}</span><button type="button" class="bt ghost sm" data-hs="reload" data-fk="reload"${Hs.loading ? ' disabled' : ''}>Refresh</button></div></div>
      ${!rows.length ? `<div class="card emp">${ic('bars', 28) || ic('trophy', 28)}<b>No picks in this period</b><p>${Hs.kind === 'prop' && noProps ? 'Player props are recorded from the first time the Predictions page shows them, so this list starts with the next slate.' : 'A pick lands here once it is locked before its start. Widen the period or choose another sport.'}</p></div>` : `
      <div class="hs-tiles"><div class="tile inset"><span class="lb">Graded picks</span><b class="fig num">${S.n}</b><small class="lb">${pending ? `${pending} waiting for a result` : 'none waiting'}${other ? ` · ${other} void, push or not graded` : ''}</small></div>
        <div class="tile inset"><span class="lb">Hit rate</span><b class="fig num">${S.rate == null ? '–' : pct(S.rate) + '%'}</b><small class="lb">${S.n ? `${S.won} hit, ${S.lost} missed · we said ${pct(S.said)}%` : 'nothing graded yet'}</small></div>
        <div class="tile inset"><span class="lb">Against the market</span><b class="fig num">${signed(S.vs)}</b><small class="lb">${S.vs == null ? 'no prices saved with these picks' : `points, over ${S.priced} priced ${S.priced === 1 ? 'pick' : 'picks'}`}</small></div>
        <div class="tile inset"><span class="lb">Beat the closing line</span><b class="fig num">${S.clvN ? pct(S.clv) + '%' : '–'}</b><small class="lb">${S.clvN ? `of ${S.clvN} ${S.clvN === 1 ? 'prop' : 'props'} where the line or price moved` : 'props only, once a line moves before the start'}</small></div></div>
      ${cal}
      ${breakdown(rows)}
      <section class="card hs-card" aria-label="Every pick"><div class="sec-h"><h2>Every pick</h2>${seg('res', 'Show', [['all', `All ${rows.length}`], ['won', `Hits ${S.won}`], ['lost', `Misses ${S.lost}`], ...(pending ? [['pending', `Waiting ${pending}`]] : [])], Hs.res)}</div>
        ${list.length ? `<div class="tbx-wrap"><table class="tbx hs-list"><thead><tr><th scope="col">Start</th><th scope="col">Pick</th><th scope="col" class="r">We said</th><th scope="col" class="r">Market</th><th scope="col">Closing line</th><th scope="col">Result</th></tr></thead><tbody>${list.slice(0, Hs.shown).map(row).join('')}</tbody></table></div>
          ${list.length > Hs.shown ? `<button type="button" class="bt ghost wide" data-hs="more" data-fk="more">Show ${Math.min(40, list.length - Hs.shown)} more of ${list.length}</button>` : ''}` : '<p class="lb">Nothing in this view.</p>'}</section>`}
      <p class="lb hs-how">How the record is kept: a match forecast is copied here at kick-off; a player prop the first time the Predictions page shows it. Both are locked from then on and graded when the result is in, and a miss is kept exactly like a hit. A prop is graded from the player's game log (MLB's own log for baseball). If the player didn't play it is void, and if the game can't be found for certain it says “Not graded”. Soccer props aren't graded yet. “Against the market” is our hit rate minus the chance the prices gave the same picks. “Beat the closing line” compares the first reading with the last one before the start: a line that moved our way, or a better market price at the same line. This is a record of research, not betting advice.</p>`;
    if (act) [...document.querySelectorAll('#pg-history [data-fk]')].find(x => x.dataset.fk === act)?.focus({ preventScroll: true });
  }
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#pg-history [data-hs],#pg-history [data-hssport],#pg-history [data-hsdays],#pg-history [data-hsres],#pg-history [data-hskind],#pg-history [data-hsby]'); if (!t) return; const d = t.dataset;
    if (d.hssport) { Hs.sport = d.hssport; Hs.shown = 40 } else if (d.hsdays != null) { Hs.days = +d.hsdays; Hs.shown = 40 } else if (d.hsres) { Hs.res = d.hsres; Hs.shown = 40 }
    else if (d.hskind) { Hs.kind = d.hskind; Hs.shown = 40 } else if (d.hsby) Hs.by = d.hsby
    else if (d.hs === 'more') Hs.shown += 40; else if (d.hs === 'reload') return load(true);
    draw();
  });
  // the "Performance by" tabs move with the arrow keys
  document.addEventListener('keydown', ev => {
    const t = ev.target.closest?.('#pg-history [data-hsby]'); if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const ks = Object.keys(BY), i = ks.indexOf(Hs.by), n = ev.key === 'Home' ? 0 : ev.key === 'End' ? ks.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + ks.length) % ks.length;
    ev.preventDefault(); Hs.by = ks[n]; draw(); document.querySelector(`#pg-history [data-hsby="${ks[n]}"]`)?.focus();
  });
  window.flPages?.add('history', { title: 'Pick history', render, onShow() { load() } });
  window.flHistory = { stats, state: Hs, all, graded, BY };
})();
