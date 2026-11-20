/* Floodlight · picks: the one list Home and Predictions both read.
   A pick is a player prop from the Lab's board (the lines posted on PrizePicks and Sleeper today) or a match forecast
   the server has made. "Ours" is the Lab's own estimate for that side of the line (meter.js, the same number as the
   heat meter). "Market" is the price a book posts for it, turned into a chance with the book's margin taken out; it
   is null when no book posts a two-sided price, and such a pick has no edge. Nothing here is made up: a sport with no
   lines today simply returns no picks. */
(() => {
  const SPORTS = [['nba', 'NBA', 'basketball'], ['nfl', 'NFL', 'football'], ['nhl', 'NHL', 'hockey'], ['mlb', 'MLB', 'baseball'], ['wnba', 'WNBA', 'basketball'], ['soccer', 'Soccer', 'soccer']];
  const YES = new Set(['win', 'btts', 'cs', 'dd', 'g1']);
  const cache = new Map();   // sport -> { at, promise, data }
  const TTL = 5 * 60000;
  const get = (url, ms = 25000) => Promise.race([fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || String(r.status)); e.status = r.status; throw e } return d }),
    new Promise((_, no) => setTimeout(() => no(new Error('It took too long to answer.')), ms))]);
  const fmt = v => Number.isInteger(v) ? String(v) : (+v).toFixed(1);

  function propPick(r, sport) {
    const games = (r.games || []).map(g => ({ v: g[0], home: g[1] == null ? null : !!g[1], min: g[2], opp: g[3] || '', oppAbbr: g[4] || '' }));
    const yes = YES.has(r.k), pct = x => Math.round(x * 100);
    const read = side => window.flMeter?.judge(games, { line: r.line, side, yes, stat: r.k, opp: r.opp });
    // the market: a two-sided price at this exact line, averaged when more than one book posts it
    const priced = (r.offers || []).filter(o => o.pOver != null && o.line === r.line);
    const mOver = priced.length ? priced.reduce((a, o) => a + o.pOver, 0) / priced.length : null;
    // the side: the one the board ranked (its better last-10 record), unless a market price says our edge is on the other
    let side = r.side, J = read(side); if (!J) return null;
    let market = mOver == null ? null : side === 'over' ? mOver : 1 - mOver;
    if (market != null && J.p < market) { side = side === 'over' ? 'under' : 'over'; J = read(side); market = 1 - market }
    const ours = J.p, over = side === 'over';
    // reasons, counted from the same games the reading uses
    const hits = n => { const gs = games.filter(g => g.v != null).slice(0, n).filter(g => g.v !== r.line); return gs.length ? { n: gs.length, hit: gs.filter(g => over ? g.v > r.line : g.v < r.line).length } : null };
    const h5 = hits(5), h10 = hits(10), h20 = hits(20), rate = h => h ? h.hit / h.n : null, reasons = [];
    if (h10) reasons.push(`${yes ? (over ? 'Yes' : 'No') : over ? 'Over' : 'Under'} in ${h10.hit} of last ${h10.n}`);
    if (r.avg != null && !yes) reasons.push(`Averaging ${fmt(r.avg)} over the last 10`);
    if (h5 && h5.n >= 4 && (rate(h5) >= .8 || rate(h5) <= .2)) reasons.push(`${h5.hit} of the last ${h5.n}`);
    else if (h20 && h20.n >= 15) reasons.push(`${pct(rate(h20))}% over the last ${h20.n}`);
    const start = r.start ? new Date(r.start) : null;
    return { id: `prop:${sport}:${r.player}:${r.k}:${r.line}`, type: 'prop', sport, name: r.player, team: r.team || '', opp: r.opp || '', photo: r.photo || '',
      k: r.k, label: r.label, line: r.line, side, yes, text: yes ? `${r.label}: ${over ? 'Yes' : 'No'}` : `${over ? 'Over' : 'Under'} ${fmt(r.line)} ${String(r.label).toLowerCase()}`,
      ours, market, edge: market == null ? null : pct(ours) - pct(market), heat: pct(ours), conf: J.conf, n: J.n, reasons: reasons.slice(0, 3),
      start: start && !isNaN(start) ? start : null, game: [r.team, r.opp].filter(Boolean).join(' v '), gameKey: `${sport}:${[r.team, r.opp].filter(Boolean).sort().join('|') || r.player}`,
      books: r.books || [], l5: rate(h5), l10: rate(h10), l20: rate(h20), avg: r.avg };
  }
  function board(sport, force) {
    const c = cache.get(sport);
    if (c && !force && (c.promise || Date.now() - c.at < TTL)) return c.promise || Promise.resolve(c.data);
    const promise = get('/api/lab/board?sport=' + encodeURIComponent(sport)).then(d => ({ sport, picks: (d.rows || []).map(r => propPick(r, sport)).filter(Boolean), checked: d.checked || 0, note: d.note || '', errors: d.errors || {} }))
      .catch(e => ({ sport, picks: [], checked: 0, error: e.message || 'It did not load.', status: e.status || 0 }))
      .then(data => { cache.set(sport, { at: Date.now(), data }); return data });
    cache.set(sport, { at: c?.at || 0, data: c?.data, promise });
    return promise;
  }
  /* every sport asked for, together. -> { picks, by: {sport: result}, denied (the member has no Lab access) } */
  async function props(sports, force) {
    const res = await Promise.all((sports || SPORTS.map(s => s[0])).map(s => board(s, force)));
    return { picks: res.flatMap(r => r.picks), by: Object.fromEntries(res.map(r => [r.sport, r])), denied: res.length > 0 && res.every(r => r.status === 401 || r.status === 403) };
  }
  const have = sport => cache.get(sport)?.data || null;
  const all = () => [...cache.values()].flatMap(c => c.data?.picks || []);
  // one reading per player for the hot and cold lists: their strongest line either way
  function players(picks) {
    const best = new Map();
    for (const p of picks) { const over = p.side === 'over' ? p.heat : 100 - p.heat, cur = best.get(p.sport + p.name); if (!cur || Math.abs(over - 50) > Math.abs(cur.heat - 50)) best.set(p.sport + p.name, { ...p, heat: over }) }
    return [...best.values()];
  }
  const hot = (picks, n = 3) => players(picks).filter(p => p.heat >= 60).sort((a, b) => b.heat - a.heat).slice(0, n);
  const cold = (picks, n = 2) => players(picks).filter(p => p.heat < 40).sort((a, b) => a.heat - b.heat).slice(0, n);
  const ranked = picks => picks.filter(p => p.edge != null).sort((a, b) => b.edge - a.edge || b.ours - a.ours);
  // opening a pick in the Lab: the player, the stat and the line it was read at
  const labArgs = p => ({ sport: p.sport, player: p.name, stat: p.k, line: p.line, side: p.side });

  window.flEdge = { SPORTS, board, props, have, all, hot, cold, ranked, players, labArgs, fmt };
})();
