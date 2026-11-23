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
    const games = (r.games || []).map(g => ({ v: g[0], home: g[1] == null ? null : !!g[1], min: g[2], opp: g[3] || '', oppAbbr: g[4] || '', date: g[5] ? Date.parse(g[5].length === 10 ? g[5] + 'T12:00:00Z' : g[5]) || null : null }));
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
    const h5 = hits(5), h10 = hits(10), h20 = hits(20), rate = h => h ? h.hit / h.n : null;
    // one sample for every sentence (market.js): "6 of 7 available games", "averaging 9.4 across those 7 games"
    const S = window.flMarket?.sample(games, r.line, side, yes), reasons = S ? [S.texts.hit, S.texts.avg, S.texts.run].filter(Boolean) : [];
    const start = r.start ? new Date(r.start) : null;
    return { id: `prop:${sport}:${r.player}:${r.k}:${r.line}`, sk: `prop:${sport}:${r.player}:${r.k}`, type: 'prop', sport, name: r.player, team: r.team || '', opp: r.opp || '', photo: r.photo || '',
      k: r.k, label: r.label, line: r.line, side, yes, text: yes ? `${r.label}: ${over ? 'Yes' : 'No'}` : `${over ? 'Over' : 'Under'} ${fmt(r.line)} ${String(r.label).toLowerCase()}`,
      ours, market, edge: market == null ? null : pct(ours) - pct(market), heat: pct(ours), n: J.n, reasons: reasons.slice(0, 3),
      // the books' team and the team of the player whose games were read disagree: the reading may be someone else's, so it is low confidence and says why
      conf: r.teamOk === false ? 'low' : J.conf, teamNote: r.teamOk === false ? (r.teamNote || 'The books’ team for this player does not match the team the stats come from.') : '',
      // who it is for: the player record's team (players.py), the same one every page shows; hold = being checked
      fid: r.fid || '', teamName: r.teamName || '', teamStatus: r.teamStatus || 'unknown', bookTeam: r.bookTeam || '', prev: r.prev || null, flags: r.flags || [], hold: !!r.hold,
      start: start && !isNaN(start) ? start : null, game: [r.team, r.opp].filter(Boolean).join(' v '), gameKey: `${sport}:${[r.team, r.opp].filter(Boolean).sort().join('|') || r.player}`,
      books: r.books || [], l5: rate(h5), l10: rate(h10), l20: rate(h20), h10, avg: S ? S.avg : r.avg, smp: S, mu: J.mu, sd: J.sd,
      games: games.slice(0, 60), offers: r.offers || [], neff: J.neff };   // the games and prices behind the reading, for the evidence panel   // mu and sd: what the reading expects, used to follow the pick live
  }
  /* A board that answered is also kept in this browser for a few hours, so the next visit can show the last reading at
     once (marked with its age) while a fresh one loads, and a failed check falls back to it instead of an empty page. */
  const KEEP = 3 * 3600e3;
  const disk = { get(sport) { try { const v = JSON.parse(localStorage.getItem('fl.board.' + sport)); return v && v.d && Date.now() - v.got < KEEP ? v : null } catch { return null } },
    set(sport, d, got) { try { localStorage.setItem('fl.board.' + sport, JSON.stringify({ got, d })) } catch {} } };
  // at: when the server read the books (it re-reads them at most every 15 minutes). got: when this browser asked.
  /* A prop whose player record is being checked (two rosters, a sportsbook that disagrees, a game the player's team
     isn't in) is held back from every list, Predictions, Home, the Lab and parlays alike, and listed apart with the
     reason: nothing questionable is published as a pick. */
  const shape = (d, sport, got) => { const at = d.at ? d.at * 1000 : got, all = (d.rows || []).map(r => propPick(r, sport)).filter(Boolean).map(p => ({ ...p, at }));
    return { sport, picks: all.filter(p => !p.hold), held: all.filter(p => p.hold), checked: d.checked || 0, note: d.note || '', errors: d.errors || {}, at, got } };
  function kept(sport) { const v = disk.get(sport); if (!v) return null; try { return { ...shape(v.d, sport, v.got), kept: true } } catch { return null } }
  function board(sport, force) {
    const c = cache.get(sport);
    if (c && !force && (c.promise || Date.now() - c.at < TTL)) return c.promise || Promise.resolve(c.data);
    const promise = get('/api/lab/board?sport=' + encodeURIComponent(sport), 45000).then(d => { const got = Date.now(); disk.set(sport, d, got); return shape(d, sport, got) })
      .catch(e => { const old = (c?.data?.picks ? c.data : null) || kept(sport), err = { error: e.message || 'It did not load.', status: e.status || 0, failedAt: Date.now() };
        return old && old.at ? { ...old, ...err, stale: true } : { sport, picks: [], checked: 0, at: 0, ...err } })
      .then(data => { cache.set(sport, { at: Date.now(), data }); try { document.dispatchEvent(new CustomEvent('fl:board', { detail: { sport } })) } catch (e) {} return data });
    cache.set(sport, { at: c?.at || 0, data: c?.data, promise });
    return promise;
  }
  /* every sport asked for, together. -> { picks, by: {sport: result}, denied (the member has no Lab access) }
     onPart is called with each sport's result as it arrives, so a page can draw what it has instead of waiting for the slowest. */
  /* Home, the Lab's lists and parlays only ever get lines whose game has a start time still ahead: a line with no
     start (Sleeper posts none) or one whose game began is never a current pick. Predictions reads the boards itself
     (have()) and runs the full checks against the league schedule (market.js). */
  const upcoming = (picks, now = Date.now()) => picks.filter(p => p.start && +p.start > now);
  async function props(sports, force, onPart) {
    const res = await Promise.all((sports || SPORTS.map(s => s[0])).map(s => board(s, force).then(r => { try { onPart?.(r) } catch (e) {} return r })));
    return { picks: upcoming(res.flatMap(r => r.picks)), by: Object.fromEntries(res.map(r => [r.sport, r])), denied: res.length > 0 && res.every(r => r.status === 401 || r.status === 403) };
  }
  // what is in hand for a sport right now: this visit's answer, or the reading kept from the last visit
  const have = sport => { const c = cache.get(sport); if (c?.data) return c.data; const k = kept(sport); if (k) cache.set(sport, { at: 0, data: k, promise: c?.promise }); return k };
  const all = () => upcoming([...cache.values()].flatMap(c => c.data?.picks || []));
  const held = () => [...cache.values()].flatMap(c => c.data?.held || []);
  // one reading per player for the hot and cold lists: their strongest line either way
  function players(picks) {
    const best = new Map();
    for (const p of upcoming(picks)) { const over = p.side === 'over' ? p.heat : 100 - p.heat, cur = best.get(p.sport + p.name); if (!cur || Math.abs(over - 50) > Math.abs(cur.heat - 50)) best.set(p.sport + p.name, { ...p, heat: over }) }
    return [...best.values()];
  }
  const hot = (picks, n = 3) => players(picks).filter(p => p.heat >= 60).sort((a, b) => b.heat - a.heat).slice(0, n);
  const cold = (picks, n = 2) => players(picks).filter(p => p.heat < 40).sort((a, b) => a.heat - b.heat).slice(0, n);
  const ranked = picks => upcoming(picks).filter(p => p.edge != null).sort((a, b) => b.edge - a.edge || b.ours - a.ours);
  // opening a pick in the Lab: the player, the stat and the line it was read at
  const labArgs = p => ({ sport: p.sport, player: p.name, stat: p.k, line: p.line, side: p.side });

  window.flEdge = { SPORTS, board, props, have, all, held, hot, cold, ranked, players, labArgs, fmt, upcoming };
})();
