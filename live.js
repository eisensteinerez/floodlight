/* Floodlight · Live: every game in play right now, in every sport, on one page.
   It reads the same list Home keeps fresh (home.js, every 30 seconds) and only draws it: Live, Up next and Finished.
   A long list starts with My teams, Top games, On TV and (Up next) Starting in the next hour, then All competitions,
   five games each with "Show all", and any competition can be folded (remembered). Seven orders replace the grouping.
   Off-screen sections skip layout (content-visibility), so a night of 100+ games scrolls smoothly. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const SPORTS = [['all', 'All sports'], ['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC']];
  /* The reader's choices are kept in this browser, so leaving Live and coming back finds the page as it was. */
  const KEEP = 'fl.liveF';
  const kept = (() => { try { return JSON.parse(localStorage.getItem(KEEP) || '{}') } catch { return {} } })();
  const L = { sport: kept.sport || 'all', show: kept.show || 'live', only: kept.only || 'all', watch: kept.watch || 'any', sort: kept.sort || 'big', day: 0, timer: 0, more: new Set(), fold: new Set(kept.fold || []), view: (() => { try { return localStorage.getItem('fl.liveView') === 'compact' ? 'compact' : 'cards' } catch { return 'cards' } })() };
  const keep = () => { try { localStorage.setItem(KEEP, JSON.stringify({ sport: L.sport, show: L.show, only: L.only, watch: L.watch, sort: L.sort, fold: [...L.fold].slice(-60) })) } catch {} };
  const hub = () => window.flHub;
  const hubAttr = g => `data-live="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}"`;

  /* what the filters read, all from the scoreboard */
  const CLOSE = { football: 8, basketball: 6, hockey: 1, soccer: 1, baseball: 2 };
  const gap = g => Math.abs((+g.a.score || 0) - (+g.b.score || 0));
  const isClose = g => g.state === 'in' && CLOSE[g.sport] != null && g.a.score !== '' && gap(g) <= CLOSE[g.sport];
  const isOT = g => g.state !== 'pre' && /\b(OT|\d?OT|overtime|extra time|ET|AET|SO|shootout|penalties|pens)\b/i.test(`${g.clock} ${g.final}`);
  function upset(g) {   // a ranked side behind a lower-ranked or unranked one, or the market's clear favourite behind
    if (g.state === 'pre' || g.a.score === '') return false;
    const lead = +g.a.score > +g.b.score ? g.a : +g.b.score > +g.a.score ? g.b : null; if (!lead) return false;
    const trail = lead === g.a ? g.b : g.a;
    if (trail.rank && (!lead.rank || lead.rank > trail.rank)) return true;
    return trail.ml != null && trail.ml >= .65;
  }
  /* Show only: each label says what it keeps without needing the row around it, and each has one line saying how a game
     qualifies (read by screen readers with the button, shown in the empty state). */
  const ONLY = [['all', 'Every game'], ['close', 'Close games'], ['upset', 'Potential upsets'], ['ot', 'Overtime'], ['tv', 'On TV'], ['mine', 'My teams'], ['pred', 'Predictions available']];
  const ONLY_WHY = { all: 'No filter: every game for the day and sport you picked.', close: 'Games in play where the margin is within a score or two for the sport.',
    upset: 'Games where a ranked team or the betting favourite is behind.', ot: 'Games that went to overtime, extra time or a shootout.', tv: 'Games on a national TV network in the US listing.',
    mine: 'Games of the teams you follow and games on your watchlist.', pred: 'Games Floodlight has published a pre-game prediction for.' };
  const ONLY_NONE = { close: 'close games', upset: 'potential upsets', ot: 'games in overtime', tv: 'games on national TV', mine: 'games from your teams', pred: 'games with a prediction' };
  /* Where to watch: national TV, local TV (a team's regional network or station), streaming, free, subscription, or not
     known. broadcast.js sorts each game's channels from the feed's own market and type, so a regional network or a
     team's app is never counted as national. */
  const WATCH = window.flTV?.FILTERS || [['any', 'Any']];
  const watchOk = g => !window.flTV || window.flTV.test(L.watch, g.watch);
  const nat = g => !!g.tvNat, onAir = g => !!(g.watch ? g.watch.all.length : g.tv);
  const hasPick = g => !!window.flMC?.hasPick?.(g);
  const ONLY_F = { all: () => true, close: isClose, ot: isOT, upset, tv: g => nat(g), mine: g => mine(g), pred: hasPick };
  // when each game's score last changed, seen from this tab; the "just scored" sort and tag read it
  const scored = new Map(), lastScore = new Map();
  function track() { const now = Date.now(); for (const g of hub()?.games() || []) { if (g.state === 'pre') continue; const k = `${g.a.score}-${g.b.score}`, was = lastScore.get(g.key); if (was != null && was !== k) scored.set(g.key, now); lastScore.set(g.key, k) } }
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : `${m} min ago` };
  const dayLabel = o => o === 0 ? 'Today' : o === -1 ? 'Yesterday' : o === 1 ? 'Tomorrow' : '';

  /* How the list is arranged when there are many games: first the few worth seeing (your teams, the biggest games,
     what is on TV, what starts within the hour), then every competition, five games each until you ask for all.
     A competition can be folded away and stays folded on this browser. */
  const TOP_SOCCER = /premier league|laliga|la liga|bundesliga|serie a|ligue 1|champions league|europa league|conference league|mls|fa cup|copa|eredivisie|liga mx|world cup|euro\b|nations league/i;
  const YOUTH = /\bu-?(1[5-9]|2[0-3])\b|youth|under-?\d|reserves|friendl/i;
  // a soccer game names its competition; when the feed leaves that out, the league code (eng.1) is turned back into its name
  const lgNamed = code => { try { const r = (typeof LEAGUES !== 'undefined' ? LEAGUES : []).find(l => l[1] === code); return r ? r[2] : '' } catch (e) { return '' } };
  const comp = g => g.sport === 'soccer' ? (g.lgName || lgNamed(g.league) || 'Soccer') : g.short || g.sport;
  const mine = g => { try { return !!(window.flHome?.isMine?.(g) || window.flHome?.watching?.(g.key)) } catch { return false } };
  function pop(g) {   // how much a game is likely to matter to most people: league weight, ranks, TV, a top soccer league; youth and friendlies sink
    const c = comp(g); let p = (g.weight || 3) * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0) + (nat(g) ? 6 : onAir(g) ? 2 : 0) + (mine(g) ? 60 : 0);
    if (g.sport === 'soccer') p += TOP_SOCCER.test(c) && !YOUTH.test(c) ? 30 : 0;
    if (YOUTH.test(c) || YOUTH.test(`${g.a.full} ${g.b.full}`)) p -= 35;
    return p;
  }
  const evenness = g => g.a.ml != null && g.b.ml != null ? Math.abs(g.a.ml - g.b.ml) : g.state === 'in' ? gap(g) / 10 + .5 : 9;
  const SORTS = { soon: (a, b) => a.date - b.date, pop: (a, b) => pop(b) - pop(a), close: (a, b) => (a.state === 'in' && b.state === 'in' ? gap(a) - gap(b) : evenness(a) - evenness(b)) || a.date - b.date,
    ranked: (a, b) => (!!(b.a.rank || b.b.rank) - !!(a.a.rank || a.b.rank)) || (Math.min(a.a.rank || 99, a.b.rank || 99) - Math.min(b.a.rank || 99, b.b.rank || 99)) || a.date - b.date,
    tv: (a, b) => (nat(b) - nat(a)) || (onAir(b) - onAir(a)) || pop(b) - pop(a), mine: (a, b) => (mine(b) - mine(a)) || a.date - b.date, just: (a, b) => (scored.get(b.key) || 0) - (scored.get(a.key) || 0) };
  const SORT_NAMES = [['big', 'By competition'], ['soon', 'Starting soonest'], ['pop', 'Most popular'], ['close', 'Closest matchup'], ['ranked', 'Ranked teams first'], ['tv', 'National TV first'], ['mine', 'My teams first']];
  const PER = 5, FLAT = 24;
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}` }
  // a section of cards or rows; an id keeps focus when it redraws
  function block(id, title, gs, opts = {}) {
    const folded = opts.fold && L.fold.has(id), all = L.more.has(id), shown = opts.cap && !all ? gs.slice(0, opts.cap) : gs, hid = gs.length - shown.length;
    const body = folded ? '' : `${L.view === 'compact' ? `<div class="card lv-rows">${shown.map(row).join('')}</div>` : `<div class="g4 hm-cards">${shown.map(g => cardOf(g)).join('')}</div>`}
      ${hid > 0 ? `<button type="button" class="bt ghost lv-more" data-livemore="${esc(id)}">Show all ${gs.length} ${esc(opts.noun || 'games')}</button>` : all && opts.cap && gs.length > opts.cap ? `<button type="button" class="lk lv-more" data-liveless="${esc(id)}">Show fewer</button>` : ''}`;
    return `<section class="lv-g${opts.cls ? ' ' + opts.cls : ''}${folded ? ' folded' : ''}" aria-labelledby="lvh-${esc(id)}" data-lvsec="${esc(id)}"><div class="sec-h">${opts.fold
      ? `<h2 id="lvh-${esc(id)}"><button type="button" class="lv-fold" aria-expanded="${!folded}" data-livefold="${esc(id)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${folded ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'}"/></svg><span>${esc(title)}</span></button></h2>`
      : `<h2 id="lvh-${esc(id)}">${esc(title)}</h2>`}<span class="lb">${plural(gs.length, 'game', 'games')}${opts.why ? ` · ${esc(opts.why)}` : ''}</span></div>${body}</section>`;
  }
  let cardOf = g => '';
  function arrange(list, show) {
    if (L.sort !== 'big') {   // one ordered list, a page at a time
      const sorted = [...list].sort(SORTS[L.sort] || SORTS.soon), name = (SORT_NAMES.find(x => x[0] === L.sort) || [])[1] || (L.sort === 'just' ? 'Just scored first' : 'Ordered');
      return block('flat', name, sorted, { cap: FLAT, noun: show === 'live' ? 'live games' : 'games' });
    }
    let h = '';
    const used = new Set(), take = (gs, n) => { const out = gs.filter(g => !used.has(g.key)).slice(0, n); out.forEach(g => used.add(g.key)); return out };
    if (list.length > 8) {   // a long night: the few worth seeing first
      const my = take(list.filter(mine).sort(SORTS.soon), 12);
      if (my.length) h += block('mine', 'My teams', my, { why: 'teams and games you follow' });
      const top = take([...list].filter(g => pop(g) >= 75).sort(SORTS.pop), 4);
      if (top.length) h += block('top', 'Top games', top, { why: 'biggest leagues, ranked teams and national TV' });
      // two honest groups: a US national network, and anything else listed (a team's regional network, a local station, a stream)
      const tv = take([...list].filter(nat).sort(SORTS.pop), 4);
      if (tv.length) h += block('tv', 'National TV', tv, { why: 'on a US national network' });
      const avail = take([...list].filter(g => !nat(g) && onAir(g)).sort(SORTS.pop), 4);
      if (avail.length) h += block('watch', 'Available to watch', avail, { why: 'local TV or streaming, often only in the teams’ home areas' });
      if (show === 'next') { const soon = take(list.filter(g => g.date - Date.now() < 3600e3).sort(SORTS.soon), 6); if (soon.length) h += block('hour', 'Starting in the next hour', soon) }
      h += `<h2 class="lv-allh">All competitions</h2>`;
    }
    const groups = new Map();
    for (const g of [...list].sort(show === 'done' ? (a, b) => b.date - a.date : SORTS.soon)) { const k = comp(g); (groups.get(k) || groups.set(k, []).get(k)).push(g) }
    const order = [...groups].sort((a, b) => Math.max(...b[1].map(pop)) - Math.max(...a[1].map(pop)));
    // folding is remembered by competition name, so "NCAAB" stays folded tomorrow too
    h += order.map(([k, gs]) => block('c:' + k, k, gs, { cap: PER, fold: true, noun: `${k} games` })).join('');
    return h;
  }

  function render(el) {
    const H = hub(), games = H?.games() || [], ready = !!H?.at(), today = L.day === 0;
    const ufcLive = today ? (H?.ufc() || []).filter(e => e.state === 'in') : [];
    const inSport = g => L.sport === 'all' || g.sport === L.sport, only = ONLY_F[L.only] || ONLY_F.all;
    const live = games.filter(g => g.state === 'in'), next = games.filter(g => g.state === 'pre').sort((a, b) => a.date - b.date), done = games.filter(g => g.state === 'post').sort((a, b) => b.date - a.date);
    const count = k => live.filter(g => k === 'all' || g.sport === k).length + (k === 'all' || k === 'ufc' ? ufcLive.length : 0);
    // another day has nothing live: show what that day holds
    const show = !today && L.show === 'live' ? (L.day < 0 ? 'done' : 'next') : L.show;
    const set = show === 'live' ? live : show === 'next' ? next : done;
    const list = set.filter(inSport).filter(only).filter(watchOk);
    const ufcBlock = show === 'live' && L.only === 'all' && (L.sport === 'all' || L.sport === 'ufc') ? ufcLive.map(e => `<button type="button" class="card hit lv-ufc" data-livego="ufc"><span class="pl live"><i></i>Live</span><span class="rw-t"><b>${esc(e.name)}</b><small>${esc(e.live ? `${e.live.a.name} v ${e.live.b.name} · ${e.live.detail}` : 'Fight night under way')}</small></span>${ic('arrow', 18)}</button>`).join('') : '';
    // just finished: today's games that ended in the last two hours stay in view under the live ones
    const recent = today && show === 'live' && L.only === 'all' ? done.filter(inSport).filter(g => Date.now() - g.date < 5 * 3600e3).slice(0, 4) : [];
    const sName = (SPORTS.find(x => x[0] === L.sport) || [])[1] || '';
    const filtered = L.sport !== 'all' || L.only !== 'all' || L.watch !== 'any';
    const wName = (WATCH.find(x => x[0] === L.watch) || [])[1] || '';
    const sp = L.sport !== 'all' ? `${sName.toLowerCase()} ` : '';
    const none = L.watch !== 'any' && L.only === 'all' ? [`No ${sp}games ${show === 'live' ? 'live right now' : show === 'next' ? 'to come' : 'among the results'} match “${wName}”`, L.watch === 'unknown' ? 'Every game here lists at least one channel.' : 'The feed lists US channels only; a game with no listing shows under “Unknown availability”.', 'watch:any', `Clear “${wName}”`]
      : L.only !== 'all' ? [`No ${sp}${ONLY_NONE[L.only] || 'games'} ${show === 'live' ? 'right now' : show === 'next' ? 'to come' : 'among the results'}`, ONLY_WHY[L.only] || '', 'only:all', `Clear “${(ONLY.find(x => x[0] === L.only) || [])[1] || ''}”`]
      : show === 'live' ? [`No ${sp}games are live right now`, next.filter(inSport)[0] ? `Next up: ${next.filter(inSport)[0].a.name} v ${next.filter(inSport)[0].b.name} at ${next.filter(inSport)[0].date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Nothing else is scheduled today in this sport.', 'show:next', 'See what is up next']
      : show === 'next' ? [today ? 'Nothing more to start today' : `Nothing scheduled ${dayLabel(L.day).toLowerCase()}`, today ? 'Every game on today’s board has started or finished.' : 'Pick another day above.', today ? 'show:live' : 'day:0', today ? 'See what is live' : 'Back to today']
      : [today ? 'Nothing has finished yet' : 'No results for this day', today ? 'Results from today’s games collect here.' : 'Pick another day above.', today ? 'show:live' : 'day:0', today ? 'See what is live' : 'Back to today'];
    const at = H?.at?.() || 0;
    const card = g => window.flCard({ ...cardFacts(g), attrs: hubAttr(g), extra: just(g) }); cardOf = card;
    if ((L.sort === 'just' && show !== 'live') || (L.sort === 'soon' && show === 'done') || !(L.sort in SORTS || L.sort === 'big')) L.sort = 'big';
    // the 30-second refresh patches the page in place (morph.js), so a card, a switch or the menu the reader is on is not rebuilt
    (window.flMorph ? h => window.flMorph(el, h) : h => { el.innerHTML = h })(`<header class="pg-head"><div><h1 class="pg-title">Live${today ? '' : ` · ${dayLabel(L.day)}`}</h1><p class="pg-sub">${today ? 'Every game in play, in every sport. Scores update on their own.' : L.day < 0 ? 'Yesterday’s results, in every sport.' : 'Tomorrow’s schedule, in every sport.'}</p></div>
        <div class="lv-head-r"><div class="seg" role="radiogroup" aria-label="Day">${[-1, 0, 1].map(o => `<button type="button" role="radio" aria-checked="${L.day === o}" class="${L.day === o ? 'on' : ''}" tabindex="${L.day === o ? 0 : -1}" data-liveday="${o}">${dayLabel(o)}</button>`).join('')}</div>
        ${today ? `<div class="seg" role="radiogroup" aria-label="Show">${[['live', `Live now${live.length + ufcLive.length ? ` · ${live.length + ufcLive.length}` : ''}`], ['next', 'Up next'], ['done', 'Finished']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${L.show === k}" class="${L.show === k ? 'on' : ''}" tabindex="${L.show === k ? 0 : -1}" data-liveshow="${k}">${l}</button>`).join('')}</div>` : ''}</div></header>
      <p class="lv-upd lb" aria-live="off">${at ? `<span class="dot-live" aria-hidden="true"></span><span>Updated <span data-lvago="${at}">${ago(at)}</span> · ${today ? (window.flSaver?.() ? 'data saver: refreshes every 2 minutes' : 'refreshes every 30 seconds') : 'scores for this day'}</span>` : 'Loading the scoreboards…'}</p>
      <div class="lv-opts"><div class="seg" role="radiogroup" aria-label="View">${[['cards', 'Cards'], ['compact', 'Compact']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${L.view === k}" class="${L.view === k ? 'on' : ''}" tabindex="${L.view === k ? 0 : -1}" data-liveview="${k}">${l}</button>`).join('')}</div>
        <label class="lv-sp"><input class="sw" type="checkbox" role="switch" id="lvSpoil" ${window.flMC?.spoilAll() ? 'checked' : ''}> Spoiler-free <span class="lb">hide scores until I reveal them</span></label></div>
      <div class="cx-row scroll" role="group" aria-label="Sport">${SPORTS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${L.sport === k}" data-livesport="${k}">${esc(l)}${count(k) ? `<b class="lv-n num" aria-label="${count(k)} live">${count(k)}</b>` : ''}</button>`).join('')}</div>
      <div class="lv-filt"><div class="cx-row scroll lv-only" role="group" aria-label="Show only">${ONLY.map(([k, l]) => `<button type="button" class="cx sm" aria-pressed="${L.only === k}" data-liveonly="${k}" aria-describedby="lvWhy-${k}" title="${esc(ONLY_WHY[k])}">${esc(l)}</button>`).join('')}</div>
        <div hidden>${ONLY.map(([k]) => `<span id="lvWhy-${k}">${esc(ONLY_WHY[k])}</span>`).join('')}</div>
        <div class="lv-sels">${window.flTV ? `<label class="fl-f lv-sort lv-watch"><span class="lb">Watch</span><select class="inp sm" id="lvWatch" aria-label="Where to watch">${WATCH.map(([k, l]) => `<option value="${k}"${L.watch === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
        <label class="fl-f lv-sort"><span class="lb">Order</span><select class="inp sm" id="lvSort" aria-label="Order">${[...SORT_NAMES.slice(0, 1), ...(show === 'live' ? [['just', 'Just scored first']] : []), ...SORT_NAMES.slice(1)].filter(([k]) => !(show === 'done' && k === 'soon')).map(([k, l]) => `<option value="${k}"${L.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div></div>
      ${filtered ? `<p class="lv-scope" role="status"><b>${esc([sName && L.sport !== 'all' ? sName : 'All sports', L.only !== 'all' ? ONLY_NONE[L.only] || '' : '', L.watch !== 'any' ? wName : ''].filter(Boolean).join(', '))}</b> · ${list.length + (L.sport === 'ufc' ? ufcLive.length : 0)} shown<button type="button" class="lk" data-livereset>Show everything</button></p>` : ''}
      ${!ready ? `<div class="g4">${'<div class="skl hm-card-skl"></div>'.repeat(8)}</div>`
        : !list.length && !ufcBlock ? `<div class="card emp">${ic('live', 30)}<b>${none[0]}</b><p>${esc(none[1])}</p><button type="button" class="bt ghost" data-livego2="${none[2]}">${none[3]}</button></div>`
        : `${ufcBlock}${arrange(list, show)}`}
      ${recent.length ? `<section class="lv-g lv-recent" aria-label="Just finished"><div class="sec-h"><h2>Just finished</h2><button type="button" class="lk" data-liveshow="done">All results</button></div>${L.view === 'compact' ? `<div class="card lv-rows">${recent.map(row).join('')}</div>` : `<div class="g4 hm-cards">${recent.map(card).join('')}</div>`}</section>` : ''}`);
  }
  // a tag on a game whose score changed in the last few minutes, unless its score is hidden
  const just = g => { const t = scored.get(g.key); return t && Date.now() - t < 5 * 60000 && g.state === 'in' && !window.flMC?.spoil(g.key) ? `<span class="pl lv-just">Scored ${ago(t)}</span>` : '' };
  // the same card Home draws
  const TINT = 'var(--muted)';
  // a card's spoken name never carries a score that spoiler-free is hiding
  const hid = g => g.state !== 'pre' && !!window.flMC?.spoil(g.key);
  const cardFacts = g => ({ id: 'lv' + g.key, hc: g.a.color || TINT, ac: g.b.color || TINT, label: `${g.a.full || g.a.name} ${g.state === 'pre' || hid(g) ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}, ${g.short}${hid(g) ? ', score hidden by spoiler-free mode' : ''}${g.tv ? `, on ${g.tv}` : ''}`, state: g.state, lg: g.lgName || g.short, tv: g.tv,
    a: { name: g.a.name, ab: g.a.ab, logo: g.a.logo, score: g.a.score, rank: g.a.rank, lose: g.state === 'post' && g.b.winner, win: g.a.winner }, b: { name: g.b.name, ab: g.b.ab, logo: g.b.logo, score: g.b.score, rank: g.b.rank, lose: g.state === 'post' && g.a.winner, win: g.b.winner },
    clock: g.clock, final: g.final, note: g.note, date: g.date, ...(g.state !== 'pre' && window.flMC?.spoil(g.key) ? { spoil: true } : {}) });
  // the compact view: one line a game, for scanning a long night
  const row = g => { const sp = g.state !== 'pre' && window.flMC?.spoil(g.key), t = (x, o) => `<span class="lv-t${!sp && g.state === 'post' && o.winner ? ' lose' : ''}">${x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '<i></i>'}<span>${x.rank ? `<em>${esc(x.rank)}</em> ` : ''}${esc(x.name)}</span>${g.state === 'pre' ? '' : `<b class="num">${sp ? '<span aria-hidden="true">–</span><span class="sr-only">Score hidden by spoiler-free mode</span>' : esc(x.score)}</b>`}</span>`;
    return `<button type="button" class="lv-row${g.state === 'in' ? ' is-live' : ''}" ${hubAttr(g)} aria-label="${esc(`${g.a.full || g.a.name} ${g.state === 'pre' || sp ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}${sp ? ', score hidden by spoiler-free mode' : ''}`)}">
      <span class="lv-when num${g.state === 'in' ? ' on' : ''}">${g.state === 'pre' ? esc(g.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : esc(g.state === 'in' ? g.clock || 'Live' : sp ? 'Final' : g.final || 'Final')}</span>
      <span class="lv-ts">${t(g.a, g.b)}${t(g.b, g.a)}</span>${g.tv ? `<span class="lb lv-tv">${esc(g.tv)}</span>` : ''}</button>` };
  const page = () => document.getElementById('pg-live');
  const redraw = () => { const el = page(); if (!el || el.hidden) return; const a = document.activeElement, key = el.contains(a) ? a.id === 'lvSpoil' || a.id === 'lvSort' || a.id === 'lvWatch' ? '#' + a.id : ['data-live', 'data-livesport', 'data-liveshow', 'data-liveview', 'data-liveonly', 'data-liveday', 'data-livefold'].map(k => a.hasAttribute(k) ? `[${k}="${CSS.escape(a.getAttribute(k))}"]` : '').find(Boolean) : null;
    render(el); if (key) el.querySelector(key)?.focus({ preventScroll: true }) };
  document.addEventListener('fl:hub', () => { track(); redraw() }); document.addEventListener('fl:hubday', redraw); document.addEventListener('fl:spoil', redraw); document.addEventListener('fl:fc', () => { if (L.only === 'pred') redraw() });
  document.addEventListener('change', ev => { if (ev.target.id === 'lvSpoil') window.flMC?.setSpoilAll(ev.target.checked); if (ev.target.id === 'lvSort') { L.sort = ev.target.value; keep(); redraw(); document.getElementById('lvSort')?.focus() }
    if (ev.target.id === 'lvWatch') { L.watch = ev.target.value; L.more.clear(); keep(); redraw(); document.getElementById('lvWatch')?.focus() } });
  document.addEventListener('click', ev => {
    const el = page(); if (!el || el.hidden || !el.contains(ev.target)) return;
    const s = ev.target.closest('[data-livesport]'); if (s) { L.sport = s.dataset.livesport; L.more.clear(); keep(); return redraw() }
    const mo = ev.target.closest('[data-livemore]'); if (mo) { const id = mo.dataset.livemore, sec = mo.closest('.lv-g'), n = sec?.querySelectorAll('[data-live]').length || 0; L.more.add(id); redraw();
      // focus the first game that was hidden, so the keyboard carries on where the list was cut
      const now = page()?.querySelector(`[data-lvsec="${CSS.escape(id)}"]`); return (now?.querySelectorAll('[data-live]')[n] || now?.querySelector('[data-liveless]'))?.focus() }
    const le = ev.target.closest('[data-liveless]'); if (le) { L.more.delete(le.dataset.liveless); redraw(); return page()?.querySelector(`[data-lvsec="${CSS.escape(le.dataset.liveless)}"] h2 button, [data-lvsec="${CSS.escape(le.dataset.liveless)}"] h2`)?.focus?.() }
    const fo = ev.target.closest('[data-livefold]'); if (fo) { const id = fo.dataset.livefold; L.fold.has(id) ? L.fold.delete(id) : L.fold.add(id); keep(); redraw(); return page()?.querySelector(`[data-livefold="${CSS.escape(id)}"]`)?.focus() }
    const o = ev.target.closest('[data-liveonly]'); if (o) { L.only = o.dataset.liveonly; keep(); redraw(); return el.querySelector(`[data-liveonly="${L.only}"]`)?.focus() }
    if (ev.target.closest('[data-livereset]')) { L.sport = 'all'; L.only = 'all'; L.watch = 'any'; keep(); redraw(); return el.querySelector('[data-livesport="all"]')?.focus() }
    const dy = ev.target.closest('[data-liveday]'); if (dy) { L.more.clear(); setDay(+dy.dataset.liveday); return el.querySelector(`[data-liveday="${L.day}"]`)?.focus() }
    const g2 = ev.target.closest('[data-livego2]'); if (g2) { const [k, v] = g2.dataset.livego2.split(':'); if (k === 'only') L.only = v; else if (k === 'watch') L.watch = v; else if (k === 'show') L.show = v; else if (k === 'day') return setDay(+v); keep(); return redraw() }
    const w = ev.target.closest('[data-liveshow]'); if (w) { L.show = w.dataset.liveshow; L.more.clear(); keep(); redraw(); return el.querySelector(`[data-liveshow="${L.show}"]`)?.focus() }
    const v = ev.target.closest('[data-liveview]'); if (v) { L.view = v.dataset.liveview; try { localStorage.setItem('fl.liveView', L.view) } catch {} redraw(); return el.querySelector(`[data-liveview="${L.view}"]`)?.focus() }
    const u = ev.target.closest('[data-livego]'); if (u) { window.flPages.hide(); return document.querySelector('.tbs[data-sport="ufc"]')?.click() }
    const g = ev.target.closest('[data-live]'); if (!g) return;
    const [sport, lg, id] = g.dataset.live.split('|'); window.flPages.hide(); hub()?.open({ sport, lg, id });
  });
  function setDay(o) { L.day = o; const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + o); hub()?.setDay?.(d); redraw() }
  setInterval(() => { const el = page(); if (!el || el.hidden) return; el.querySelectorAll('[data-lvago]').forEach(t => { const x = ago(+t.dataset.lvago); if (t.textContent !== x) t.textContent = x }) }, 15000);
  window.flPages?.add('live', { title: 'Live', render, fresh: true,
    /* Home's glance numbers open the list they count: "show:live,watch:national". Any other filter is cleared, so the
       list matches the number that was pressed. */
    onShow(el, arg) { const kv = Object.fromEntries(String(arg || '').split(',').map(x => x.split(':')).filter(x => x.length === 2));
      if (kv.show || kv.watch || kv.only) { L.day = 0; L.sport = 'all'; L.only = ONLY.some(x => x[0] === kv.only) ? kv.only : 'all'; L.more.clear(); if (['live', 'next', 'done'].includes(kv.show)) L.show = kv.show; L.watch = WATCH.some(x => x[0] === kv.watch) ? kv.watch : 'any'; keep(); redraw() }
      if (L.day) setDay(L.day); else hub()?.today(); clearInterval(L.timer); L.timer = setInterval(() => { if (!document.hidden && !L.day && !(window.flSaver?.() && Date.now() - (hub()?.at() || 0) < 12e4)) hub()?.load(true) }, 30000) },
    onHide() { clearInterval(L.timer); if (L.day) hub()?.today() } });
})();
