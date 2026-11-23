/* Floodlight · the one schedule request.
   Every place that counts or lists a league's games reads the same record from here: the sport page's navigation
   count, its heading, its week or date control, the list itself and the ticker, and Home, Live and the parlay builder
   for the same league and day. A record:
     key        what was asked: ESPN path, group (the league id inside a path: FBS is group 80), week or day
     league, season, week, type (preseason 1, regular 2, postseason 3), start, end (the week's own timestamps),
     tz         the viewer's time zone, which every day boundary is drawn in
     status     loading | ready | error
     games      the games, as the provider sent them
     counts     total, live, upcoming, final, postponed, canceled: every game is counted once, in total, and once in
                its state, the same way everywhere (postponed and canceled games stay in the total)
     at         when it was read
   Identical requests made at once share one fetch, and a record is reused for 30 seconds. A day inside a week that has
   already been read is answered from that week, so Home and the sport page can never disagree about it.
   window.flSched: week(spec), day(spec), get(key), counts(games), say(record, shown, filterText), STATES. */
(() => {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  const FRESH = 30e3;
  const recs = new Map();
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } })();
  const STATES = {
    loading: 'Loading this week’s games…',
    error: 'Schedule temporarily unavailable',
    empty: 'No games scheduled for this week',
  };
  const isPost = s => /postpon|delay/i.test(s);
  const isCancel = s => /cancel|forfeit/i.test(s);
  function stateOf(ev) {
    const t = ev?.competitions?.[0]?.status?.type || ev?.status?.type || {}, name = `${t.name || ''} ${t.description || ''} ${t.detail || ''}`;
    if (isCancel(name)) return 'canceled';
    if (isPost(name)) return 'postponed';
    return t.state === 'in' ? 'live' : t.state === 'post' || t.completed ? 'final' : 'upcoming';
  }
  function counts(games) {
    const c = { total: 0, live: 0, upcoming: 0, final: 0, postponed: 0, canceled: 0 };
    for (const g of games || []) { c.total++; c[g.st || stateOf(g)]++ }
    return c;
  }
  const keyOf = s => [s.path, s.group || '', s.week ? `w${s.type || ''}-${s.week}` : s.day ? `d${s.day}` : 'now', s.season || ''].join('|');
  const urlOf = s => { const p = new URLSearchParams(); if (s.group) p.set('groups', s.group); p.set('limit', '400');
    if (s.week) { p.set('week', s.week); if (s.type) p.set('seasontype', s.type); if (s.season) p.set('dates', s.season) } else if (s.day) p.set('dates', s.day);
    return `${ESPN}${s.path}/scoreboard?${p}` };
  const emit = rec => { try { document.dispatchEvent(new CustomEvent('fl:schedule', { detail: { key: rec.key } })) } catch (e) {} };
  const getJ = u => (typeof getJSON === 'function' ? getJSON(u) : fetch(u).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));

  function weekBounds(d, s) {
    const lg = d.leagues?.[0], n = d.week?.number, type = d.season?.type;
    const cal = (lg?.calendar || []).find(c => String(c.value) === String(type)) || null;
    const ent = cal?.entries?.find(e => String(e.value) === String(n));
    if (ent?.startDate && ent?.endDate) return [Date.parse(ent.startDate), Date.parse(ent.endDate)];
    const ts = (d.events || []).map(e => Date.parse(e.date)).filter(Boolean);
    return ts.length ? [Math.min(...ts), Math.max(...ts)] : [null, null];
  }
  /* one request, shared: spec { path, group, week, type, season } for a week ("now" when week is empty) */
  function load(spec, force) {
    const key = keyOf(spec), old = recs.get(key);
    if (old && !force && (old.promise || (old.status !== 'error' && Date.now() - old.at < FRESH))) return old.promise || Promise.resolve(old);
    const rec = { key, spec, league: spec.league || spec.path, tz, status: old?.games ? old.status : 'loading', games: old?.games || [], counts: old?.counts || counts([]), at: old?.at || 0, prevTotal: old?.counts?.total ?? null };
    rec.promise = getJ(urlOf(spec)).then(d => {
      const games = (d.events || []).map(e => (e.st = stateOf(e), e));
      const [start, end] = weekBounds(d, spec);
      Object.assign(rec, { status: 'ready', games, counts: counts(games), raw: d, season: d.season?.year ?? spec.season ?? null, type: d.season?.type ?? spec.type ?? null,
        week: d.week?.number ?? spec.week ?? null, start, end, at: Date.now(), error: '' });
      return rec;
    }, e => { Object.assign(rec, { status: 'error', error: e?.message || 'It did not answer.', at: Date.now() }); return rec })
      .then(r => { delete r.promise; emit(r); return r });
    recs.set(key, rec);
    return rec.promise;
  }
  const week = (spec, force) => load({ ...spec, day: null }, force);
  /* a day: answered from a week already read for this path and group when that week covers the day */
  function day(spec, force) {
    const d = spec.day, y = +d.slice(0, 4), m = +d.slice(4, 6) - 1, dd = +d.slice(6, 8);
    const from = new Date(y, m, dd).getTime(), to = new Date(y, m, dd + 1).getTime();   // the viewer's own midnight to midnight
    for (const r of recs.values()) {
      if (r.status !== 'ready' || r.spec.path !== spec.path || String(r.spec.group || '') !== String(spec.group || '') || r.spec.day || !r.start || !r.end) continue;
      if (r.start <= from && r.end >= to - 1 && Date.now() - r.at < FRESH * 4 && !force) {
        const games = r.games.filter(e => { const t = Date.parse(e.date); return t >= from && t < to });
        return Promise.resolve({ key: keyOf(spec), spec, from: r.key, tz, status: 'ready', games, counts: counts(games), at: r.at, raw: { events: games, leagues: r.raw?.leagues } });
      }
    }
    return load({ ...spec, week: null }, force);
  }
  const get = key => recs.get(key) || null;
  const all = () => [...recs.values()].filter(r => !r.promise || r.at);

  /* what to say: one sentence for the heading and the empty state, from the record and what the page shows of it */
  function say(rec, shown, filter) {
    if (!rec || (rec.status === 'loading' && !rec.games.length)) return { tone: 'loading', text: STATES.loading };
    const c = rec.counts, n = c.total, part = [c.postponed && `${c.postponed} postponed`, c.canceled && `${c.canceled} canceled`].filter(Boolean).join(', ');
    if (rec.status === 'error') {
      const known = rec.prevTotal || rec.knownTotal;
      return { tone: 'error', text: known ? `We found ${known} games but could not load the schedule. Try again.` : STATES.error, retry: true };
    }
    if (!n) return { tone: 'empty', text: STATES.empty };
    const head = `${n} game${n === 1 ? '' : 's'} scheduled${part ? ` (${part})` : ''}`;
    if (shown != null && shown < n) return { tone: shown ? 'filtered' : 'none-match', text: shown ? `Showing ${shown} of ${n} games${filter ? `, by ${filter}` : ''}` : `None of this week’s ${n} games match ${filter || 'these filters'}.`, head, clear: true };
    return { tone: 'ready', text: head, head };
  }

  /* a list that a filter or the search box emptied: say how many games there are and offer them back, never "no games" */
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function filterText(filter) {
    const q = typeof S !== 'undefined' && S.q ? S.q.trim() : '';
    const f = { live: 'Live', fav: 'My teams', top25: 'Top 25', nhl: 'NHL only' }[filter];
    return [q && `the search “${q}”`, f && `the ${f} filter`].filter(Boolean).join(' and ');
  }
  function filteredEmpty(total, sportKey, filter, when = 'on this day') {
    return `<div class="empty-state"><strong>None of the ${total} game${total === 1 ? '' : 's'} ${escH(when)} match ${escH(filterText(filter) || 'these filters')}</strong>The games are there; the filter hides them.<div style="margin-top:12px"><button class="btn ghost" data-schedclear="${escH(sportKey)}">Show all ${total} games</button></div></div>`;
  }
  document.addEventListener('click', ev => {
    const b = ev.target.closest?.('[data-schedclear]'); if (!b || typeof S === 'undefined') return;
    const st = S[b.dataset.schedclear]; if (st) st.filter = 'all';
    S.q = ''; const qi = document.getElementById('q'); if (qi) qi.value = '';
    if (typeof render === 'function') render();
  });

  window.flSched = { week, day, get, all, counts, say, stateOf, keyOf, urlOf, filterText, filteredEmpty, STATES, tz };
})();
