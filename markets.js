/* Floodlight · the verified market feed in the browser: window.flMarkets (also window.flVerified).
   Every page that shows a player line reads it from here: Predictions, the Lab's Prop Explorer and start screen, player
   profiles, Search, Parlays, the Fade List, Standout Lines, Alerts and Home. The server's verified market service
   (markets.py, through /api/lab/board) decides which markets are open; this file runs the checks that depend on the
   clock (market.js gate(): started, verified too long ago, ruled out) every time anything changes, so a page never
   shows a market another page has taken off.

   list({ sport?, sports?, force? }) -> Promise<{ markets, removed, at, by }>
   standing({ mid? | sport, name, k }) -> { open, market, status, message, reason }
   recheck([items], { maxAge }) -> Promise<[standing]>: read again first if the board is older than two minutes
   open(sport?) · removed(sport?) · get(mid) · hot(n, { sport }) · cold(n, { sport }) · enrich(pick)
   document event 'fl:markets' { sport, reason, added: [mid], changed: [mid], removed: [{ mid, status, reason }] }
   Rechecked: on load, when the tab comes back, when a provider read finishes, at each game's start, when an injury
   report or lineup changes, at midnight in the viewer's zone, and when a market passes its verification age. */
(() => {
  const MK = window.flMarket, E = () => window.flEdge;
  const SPORTS = () => (E()?.SPORTS || []).map(s => s[0]);
  const F = { open: new Map(), gone: new Map(), sig: new Map(), at: 0, tz: MK.localTz(), timer: 0, asked: new Set() };

  function injuryOf(p) {
    const I = window.flInjuries, ready = !!I?.ready?.(p.sport);
    return { st: ready ? I.status(p.sport, p.name) : null, ready };
  }
  /* one market with everything a card needs: the verdict (market.js verify, which defers to the server's checks), one
     sample size, availability, and the supported edge with its cuts as [factor, reason] pairs */
  function enrich(p, now = Date.now()) {
    const inj = injuryOf(p), v = MK.verify(p, { now, tz: F.tz, injury: inj.st });
    const q = { ...p, v, start: v.start ? new Date(v.start) : p.start || null, eventId: p.eventId || v.event?.id || '' };
    if (p.type === 'prop') { q.smp = MK.sample(p.games, p.line, p.side, p.yes); q.av = MK.availability(inj.st, inj.ready, { uncertain: false }) }
    const S = MK.supported(q, { now, verdict: v, injury: inj.st, moved: p.lineFrom != null && p.lineFrom !== p.line ? { kind: 'line', from: p.lineFrom, to: p.line } : null });
    q.sedge = S.edge; q.support = S.factor; q.cut = S.reasons; q.strength = S.strength; q.cuts = S.cuts || [];
    q.status = v.state === 'open' ? 'open' : v.status || (p.status && p.status !== 'open' ? p.status : 'awaiting_verification');
    q.statusLabel = MK.STATUS_LABEL[q.status] || q.status;
    if (q.status !== 'open') q.removalReason = v.text || p.removalReason || '';
    return q;
  }
  const gone = (p, status, reason) => ({ mid: p.mid || p.id, id: p.id, sport: p.sport, name: p.name, player: p.name, team: p.team, opp: p.opp, k: p.k, label: p.label, line: p.line, side: p.side,
    books: p.books || [], status, statusLabel: MK.STATUS_LABEL[status] || status, reason, removalReason: reason, message: MK.removalMessage(status, reason), start: p.start ? +p.start : null, eventId: p.eventId || '', verifiedAt: p.verifiedAt || null });

  /* rebuild what is open from every board in hand, compare with the last build and tell the pages what changed */
  function rebuild(reason = 'refresh', only) {
    if (!E()) return;
    const now = Date.now(), open = new Map(), off = new Map();
    for (const sp of SPORTS()) {
      const r = E().have(sp); if (!r) continue;
      for (const x of r.removed || []) off.set(x.mid, { ...x, sport: sp, name: x.player, removalReason: x.reason, message: x.message || MK.removalMessage(x.status, x.reason), start: x.start ? Date.parse(x.start) || null : null });
      for (const p of [...(r.picks || []), ...(r.held || [])]) {
        if (!p.mid) { if (p.start && +p.start > now) open.set(p.id, enrich(p, now)); continue }   // an older server: start time only
        const q = enrich(p, now);
        if (q.status === 'open') open.set(q.mid, q); else off.set(q.mid, gone(q, q.status, q.removalReason));
      }
    }
    const added = [], changed = [], removed = [];
    for (const [k, q] of open) { const sig = `${q.line}:${q.side}:${q.market ?? ''}:${q.verifiedAt ?? ''}:${q.sedge ?? ''}`; if (!F.open.has(k)) added.push(k); else if (F.sig.get(k) !== sig) changed.push(k); F.sig.set(k, sig) }
    for (const [k] of F.open) if (!open.has(k)) { const g = off.get(k) || { status: 'closed', reason: 'The provider no longer offers this line' }; removed.push({ mid: k, status: g.status, reason: g.reason || g.removalReason || '' }); F.sig.delete(k) }
    F.open = open; F.gone = off; F.at = now;
    arm();
    if (added.length || changed.length || removed.length || reason === 'load')
      try { document.dispatchEvent(new CustomEvent('fl:markets', { detail: { sport: only || 'all', reason, added, changed, removed } })) } catch (e) {}
  }
  /* the next moment something must change by itself: a game starting, a market passing its verification age, midnight */
  function arm() {
    clearTimeout(F.timer); const now = Date.now();
    const starts = [...F.open.values()].map(p => +p.start).filter(t => t > now);
    const ages = [...F.open.values()].map(p => p.verifiedAt ? p.verifiedAt + MK.MAX_AGE : 0).filter(t => t > now);
    const mid = now + MK.toMidnight(now, F.tz) + 500, next = Math.min(...starts, ...ages, mid);
    const why = next === mid ? 'midnight' : starts.includes(next) ? 'start' : 'stale';
    F.timer = setTimeout(() => rebuild(why), Math.max(1000, Math.min(next - now + 250, 2 ** 31 - 1)));
  }
  const pick = (m, sport) => [...m.values()].filter(p => !sport || p.sport === sport || (Array.isArray(sport) && sport.includes(p.sport)));
  const open = sport => pick(F.open, sport);
  const removed = sport => pick(F.gone, sport);
  const get = mid => F.open.get(mid) || F.gone.get(mid) || null;
  const hot = (n = 3, o = {}) => E() ? E().hot(open(o.sport), n) : [];
  const cold = (n = 2, o = {}) => E() ? E().cold(open(o.sport), n) : [];
  /* one market's standing in the feed, found by its market id or by player, sport and statistic (a saved board item, a
     parlay leg, a followed pick): { open, market, status, message, reason } */
  const flat = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function standing(x, now = Date.now()) {
    const same = p => (!x.sport || p.sport === x.sport) && flat(p.name || p.player) === flat(x.name || x.player) && (!x.k || p.k === x.k);
    const m = (x.mid && (F.open.get(x.mid) || F.gone.get(x.mid))) || [...F.open.values()].find(same) || [...F.gone.values()].find(same) || null;
    if (m && F.open.has(m.mid || m.id)) { const g = MK.gate(m, { now, injury: injuryOf(m).st }); if (g.status === 'open') return { open: true, market: m, status: 'open', message: '', reason: '' };
      return { open: false, market: m, status: g.status, message: MK.removalMessage(g.status, g.reason), reason: g.reason } }
    if (m) return { open: false, market: m, status: m.status, message: m.message || MK.removalMessage(m.status, m.reason || m.removalReason), reason: m.reason || m.removalReason || '' };
    const asked = !x.sport || F.asked.has(x.sport) || !!E()?.have(x.sport);
    return asked ? { open: false, market: null, status: 'closed', message: 'Market closed', reason: 'No provider in the verified feed has this line open' }
      : { open: false, market: null, status: 'awaiting_verification', message: 'Data source temporarily unavailable', reason: 'Not checked yet' };
  }
  /* Check markets again right before they are used: when a saved board opens, before an alert rings, before a share
     card is drawn. A sport whose board is older than maxAge (two minutes) is read again first. -> [standing] */
  async function recheck(items, o = {}) {
    const xs = (items || []).filter(Boolean), maxAge = o.maxAge ?? 2 * 60000;
    const sports = [...new Set(xs.map(x => x.sport).filter(s => SPORTS().includes(s)))];
    const old = sports.filter(s => { const r = E()?.have(s); return !r || Date.now() - (r.got || 0) > maxAge });
    if (old.length) await list({ sports: old, force: true }).catch(() => null); else rebuild('recheck');
    return xs.map(x => standing(x));
  }
  async function list(o = {}) {
    const sports = o.sports || (o.sport ? [o.sport] : null);
    (sports || SPORTS()).forEach(s => F.asked.add(s));
    await E()?.props(sports, !!o.force, r => rebuild('refresh', r.sport)).catch(() => null);
    rebuild('load');
    const want = sports || null, by = {};
    for (const sp of want || SPORTS()) { const r = E()?.have(sp); if (r) by[sp] = { at: r.at, verified: !!r.verified, error: r.error || '', providers: r.providers || {}, schedule: r.schedule || null, counts: r.counts || {} } }
    return { markets: open(want), removed: removed(want), at: F.at, by };
  }

  // the moments the feed is checked again
  document.addEventListener('fl:board', ev => rebuild('refresh', ev.detail?.sport));
  document.addEventListener('fl:injuries', () => rebuild('injury'));
  document.addEventListener('fl:lineups', () => rebuild('lineup'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    rebuild('focus');
    // a board older than five minutes is read again when the viewer comes back
    const old = [...F.asked].filter(s => { const r = E()?.have(s); return !r || Date.now() - (r.got || 0) > 5 * 60000 });
    if (old.length) E()?.props(old, true, r => rebuild('refresh', r.sport)).catch(() => {});
  });
  const api = { list, open, removed, get, hot, cold, enrich, rebuild, standing, recheck, STATUS: MK.STATUS, LABEL: MK.STATUS_LABEL };
  window.flMarkets = api; window.flVerified = api;
})();
