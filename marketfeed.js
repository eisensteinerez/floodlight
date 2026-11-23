/* Floodlight · the one market feed Home, alerts, the daily dashboard and the weekly recap read.
   Markets come from the verified market service (markets.js, window.flMarkets) when it is loaded: only open markets,
   with their supported edge, verification time and removal reasons. Until then they come from the Lab's board
   (edge.js, window.flEdge), filtered to games still ahead. Nothing here fetches a market source of its own, so every
   part of the site that uses this file shows the same lines as Predictions and the Lab.
   It also remembers the first line this browser saw for each market today, so "the line moved" can be said even
   where the service does not carry a line history.
     flFeed.open(sports, force)  -> Promise { markets, removed, at, by, failed, denied, stale, verified }
     flFeed.now()                -> the markets already in hand (no request)
     flFeed.hot(n) / cold(n)     -> the same hot and cold players the Lab and Prop Explorer show
     flFeed.ranked(list)         -> open markets, best supported edge first
     flFeed.moved(m)             -> { from, to, at } when the line moved today, else null
     flFeed.edge(m)              -> supported edge when known, else the raw edge
     flFeed.key(m)               -> one id per market (the service's market id, else the pick id)
   Fires 'fl:feed' on document whenever new markets arrive. */
(() => {
  const SPORTS = ['nba', 'nfl', 'nhl', 'mlb', 'wnba', 'soccer'];
  const M = () => window.flMarkets, E = () => window.flEdge;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const key = m => String(m?.mid || m?.id || `${m?.sport}:${m?.name}:${m?.k}`);
  const edge = m => m == null ? null : m.sedge != null ? m.sedge : m.edge != null ? m.edge : null;
  const startOf = m => m?.start ? +new Date(m.start) : 0;
  const ahead = (xs, now = Date.now()) => xs.filter(m => startOf(m) > now && (!m.status || m.status === 'open'));
  let last = { markets: [], removed: [], at: 0, by: {} };

  /* ---------- the first line seen today, per market ---------- */
  const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` };
  let SEEN = store.get('fl.mkSeen', {});
  if (SEEN.day !== dayKey()) SEEN = { day: dayKey(), m: {} };
  function sight(list) {
    if (SEEN.day !== dayKey()) SEEN = { day: dayKey(), m: {} };
    let ch = false;
    for (const m of list) { const k = key(m); if (m.line == null || SEEN.m[k]) continue; SEEN.m[k] = { line: m.line, at: Date.now() }; ch = true }
    if (ch) { const ks = Object.keys(SEEN.m); if (ks.length > 1500) for (const k of ks.slice(0, ks.length - 1500)) delete SEEN.m[k]; store.set('fl.mkSeen', SEEN) }
  }
  function moved(m) {
    if (!m || m.line == null) return null;
    if (m.lineFrom != null && +m.lineFrom !== +m.line) return { from: +m.lineFrom, to: +m.line, at: m.lineAt ? +new Date(m.lineAt) : 0 };
    const s = SEEN.m[key(m)];
    return s && +s.line !== +m.line ? { from: +s.line, to: +m.line, at: s.at } : null;
  }

  /* ---------- reading ---------- */
  // every source failed and nothing was kept: say so instead of calling it an empty day
  const failedAll = by => { const xs = Object.values(by || {}); return xs.length > 0 && xs.every(x => !(x.picks?.length || x.markets?.length) && (x.error || Object.keys(x.errors || {}).length) && x.status !== 401 && x.status !== 403) };
  async function open(sports = SPORTS, force = false) {
    let out;
    if (M()?.list) {
      const r = await M().list({ sports, force });
      out = { markets: ahead(r.markets || []), removed: r.removed || [], at: r.at || Date.now(), by: r.by || {}, verified: true };
    } else if (E()?.props) {
      const r = await E().props(sports, force);
      const parts = Object.values(r.by || {});
      out = { markets: ahead(r.picks || []), removed: [], by: r.by || {}, denied: !!r.denied, verified: false,
        at: Math.max(0, ...parts.map(x => x.at || 0)), stale: parts.some(x => x.stale) };
    } else out = { markets: [], removed: [], at: 0, by: {} };
    out.failed = !out.markets.length && failedAll(out.by);
    out.lastGood = Math.max(0, ...Object.values(out.by).map(x => (x.stale || x.error ? x.at : x.at) || 0));
    sight(out.markets); last = out;
    try { document.dispatchEvent(new CustomEvent('fl:feed', { detail: { at: out.at } })) } catch (e) {}
    return out;
  }
  // what is in hand right now, without a request: this visit's answer, else the reading kept from the last visit
  function now() {
    if (M()?.open) { try { return ahead(M().open() || []) } catch (e) {} }
    if (last.markets.length) return ahead(last.markets);
    const E1 = E(); if (E1?.have) return ahead(SPORTS.flatMap(s => E1.have(s)?.picks || []));
    return [];
  }
  // the time of the newest reading kept from an earlier visit, for "last successful update"
  function keptAt(sports = SPORTS) { const E1 = E(); return E1?.have ? Math.max(0, ...sports.map(s => E1.have(s)?.at || 0)) : 0 }
  const hot = (n = 3, list = now()) => M()?.hot ? M().hot(n) : E()?.hot ? E().hot(list, n) : [];
  const cold = (n = 2, list = now()) => M()?.cold ? M().cold(n) : E()?.cold ? E().cold(list, n) : [];
  const ranked = (list = now()) => ahead(list).filter(m => edge(m) != null).sort((a, b) => edge(b) - edge(a) || startOf(a) - startOf(b));
  const labArgs = m => E()?.labArgs ? E().labArgs(m) : { sport: m.sport, name: m.name, kind: 'player' };
  // a market is for this player (name match, accents and punctuation ignored)
  const flat = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const forPlayer = (name, list = now()) => { const n = flat(name); return n ? list.filter(m => flat(m.name) === n) : [] };
  document.addEventListener('fl:markets', () => { try { sight(now()); document.dispatchEvent(new CustomEvent('fl:feed', { detail: { at: Date.now() } })) } catch (e) {} });
  window.flFeed = { open, now, hot, cold, ranked, moved, edge, key, labArgs, forPlayer, keptAt, flat, SPORTS, verified: () => !!M()?.list };
})();
