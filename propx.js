/* Floodlight · Prop Explorer and the research panel, inside the Lab's workspace.
   Every line here comes from the verified market feed (markets.js, window.flMarkets): the same open markets the
   Predictions board ranks, so the two can never disagree. Markets the feed took off the board are listed apart with
   the reason. This file only filters, sorts and explains them; the sums are in labcore.js and market.js.
   - The explorer: sport chips, a player search, a sort, and a filter panel (league, game, team, statistic, provider,
     over or under, last 5/10/20 hit rates, supported edge, evidence grade, start time, injury, line movement, games
     and minutes). Filters and sort are kept in this browser.
   - The research panel opens from a row: the player, the matchup and start, the line at every provider, the numbers
     (Floodlight chance, supported edge with its breakdown, evidence grade, sample), the game log as a chart and a
     table, the splits, minutes, injury news and the line's history, and the actions (Prediction Card, Follow, Save to
     a board, Share).
   Plan limits come from plan.js (window.flPlan). Until it is loaded, or while the owner has limits off, everything is
   open. */
(() => {
  const K = window.flLabCore, MK = window.flMarket; if (!K || !MK) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const pct = x => x == null ? '–' : Math.round(x * 100) + '%', fmt = v => v == null ? '–' : Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" width="44" height="44" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(name)}</span></span>`;
  const SPORT = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer', cfb: 'College football' };
  const BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' };
  const book = b => BOOK[b] || b;
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago` };
  const can = f => { try { return window.flPlan?.can?.(f) ?? true } catch (e) { return true } };
  const upsell = (f, what) => { try { if (window.flPlan?.upsell) return window.flPlan.upsell(f) } catch (e) {} return `<p class="px-plus" data-pxplus="${esc(f)}">${ic('lock', 14)}<span>${esc(what)} <a href="#/pricing">See Plus</a></span></p>` };
  const track = (ev, o) => { try { window.flTrack?.(ev, o) } catch (e) {} };
  const tz = () => MK.localTz();
  const keyOf = p => `${p.sport}|${p.name}|${p.k}`;
  const guest = () => { let g = store.get('fl.guest', ''); if (!g) { g = Math.random().toString(36).slice(2, 12); store.set('fl.guest', g) } return g };

  const X = { host: null, api: null, f: { ...K.defaults(), ...store.get('fl.px', {}) }, sort: store.get('fl.pxSort', 'edge'), rows: null, removed: [], at: 0, err: '', loading: false,
    panelOpen: false, shown: 40, pop: null, popAt: 0, grades: new Map(), panel: null };
  if (!K.SORTS.some(s => s[0] === X.sort)) X.sort = 'edge';

  /* ---------- the feed ---------- */
  // one source for every line: the verified market service (markets.js). No second feed, no copies of its checks.
  function feed(force) {
    if (!window.flMarkets?.list) return Promise.reject(new Error('The verified lines did not load. Reload the page to try again.'));
    return window.flMarkets.list({ force });
  }
  function setRows(ms) {
    X.rows = ms.map(p => ({ p, g: p.grade?.grade ? p.grade : K.grade(p), s: K.splits(p.games, { line: p.line, side: p.side, yes: p.yes, opp: p.v?.event?.opp || p.opp, oppAbbr: p.v?.event?.oppAbbr }) }));
    X.grades = new Map(X.rows.map(r => [r.p.id, r.g]));
  }
  async function load(force) {
    if (X.loading) return; X.loading = true; if (!X.rows) draw();
    try {
      const r = await feed(force); X.err = ''; X.at = r.at || Date.now(); X.removed = r.removed || []; X.denied = !!r.denied; X.by = r.by || {};
      setRows(r.markets || []);
    } catch (e) { X.err = e.message || 'The lines did not load.'; X.rows = X.rows || [] }
    finally { X.loading = false; draw() }
    loadPop();
  }
  function loadPop() {
    if (Date.now() - X.popAt < 120000) return; X.popAt = Date.now();
    fetch('/api/popular', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => { if (!d) return; X.pop = { followed: new Map(Object.entries(d.followed || {})), researched: new Map(Object.entries(d.researched || {})) }; if (['followed', 'researched'].includes(X.sort)) draw() }).catch(() => {});
  }
  const count = (p, kind) => fetch('/api/popular', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: keyOf(p), kind, guest: guest() }) }).catch(() => {});
  // the feed changed (a game started, a line moved, a player was ruled out): take what is open now from it, without asking
  // the server again, and never in answer to its own 'load' notice (list() sends one each time, so that would loop)
  document.addEventListener('fl:markets', ev => { if (ev.detail?.reason === 'load' || !X.rows || !window.flMarkets?.open) return;
    if (X.host?.isConnected) { X.removed = window.flMarkets.removed(); setRows(window.flMarkets.open()); draw() } if (X.panel?.isConnected) redrawPanel() });

  /* ---------- the explorer ---------- */
  const save = () => { store.set('fl.px', X.f); store.set('fl.pxSort', X.sort) };
  const ADV = ['league', 'game', 'team', 'provider', 'l5', 'l10', 'l20', 'edge', 'grade', 'when', 'injury', 'moved', 'games', 'mins'];
  const isAdv = k => ADV.includes(k);
  function active() {
    const d = K.defaults(), out = [];
    for (const k of Object.keys(d)) if (k !== 'sport' && JSON.stringify(X.f[k]) !== JSON.stringify(d[k])) out.push(k);
    return out;
  }
  const RATE = [[0, 'Any'], [.6, '60%+'], [.7, '70%+'], [.8, '80%+'], [1, '100%']];
  const EDGE = [[null, 'Any'], [0, 'Above 0'], [3, '+3 or more'], [5, '+5 or more'], [10, '+10 or more']];
  const GRADES = [['all', 'Any'], ['A', 'A only'], ['B', 'B or better'], ['C', 'C or better']];
  const WHEN = [['all', 'Any time'], ['soon', 'In the next 2 hours'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['later', 'Later']];
  const INJ = [['all', 'Any'], ['clear', 'Not on the injury report'], ['listed', 'On the injury report']];
  const MOVED = [['all', 'Any'], ['moved', 'Line has moved'], ['easier', 'Moved in the pick’s favour'], ['harder', 'Moved against the pick']];
  const GAMES = [[0, 'Any'], [5, '5+'], [10, '10+'], [20, '20+']];
  const MINS = [[0, 'Any'], [15, '15+ min'], [25, '25+ min'], [32, '32+ min']];
  const SIDE = [['all', 'Over and under'], ['over', 'Over only'], ['under', 'Under only']];
  const chipName = k => {
    const v = X.f[k], find = (list, x) => (list.find(o => JSON.stringify(o[0]) === JSON.stringify(x)) || [, String(x)])[1], o = K.options(X.rows?.map(r => r.p) || []);
    const opt = name => (o[name].find(x => x[0] === v) || [, v])[1];
    return { q: `Player: ${v}`, league: `League: ${SPORT[v] || v}`, game: `Game: ${opt('game')}`, team: `Team: ${opt('team')}`, stat: `Stat: ${opt('stat')}`, provider: `Provider: ${book(v)}`, side: find(SIDE, v),
      hot: 'Running hot', l5: `Last 5: ${find(RATE, v)}`, l10: `Last 10: ${find(RATE, v)}`, l20: `Last 20: ${find(RATE, v)}`, edge: `Supported edge ${find(EDGE, v)}`, grade: `Evidence ${find(GRADES, v)}`, when: find(WHEN, v),
      injury: find(INJ, v), moved: find(MOVED, v), games: `${find(GAMES, v)} games`, mins: `Minutes ${find(MINS, v)}` }[k] || k;
  };
  function mount(host, o = {}, api = {}) {
    X.host = host; X.api = api; X.shown = 40;
    if (o.sport) X.f.sport = o.sport;
    host.innerHTML = `<div class="px" id="px"><div id="pxHead"></div><div id="pxBody" aria-live="polite" aria-busy="true"></div></div>`;
    draw(); load();
  }
  function select(id, label, k, list, adv) {
    const off = adv && !can('advanced_filters');
    return `<label class="fl-f px-f${off ? ' off' : ''}" for="${id}"><span>${label}</span><select class="inp" id="${id}" name="${k}" data-pxf="${k}"${off ? ' disabled aria-describedby="pxPlusF"' : ''}>${list.map(([v, l]) => `<option value="${esc(JSON.stringify(v))}"${JSON.stringify(X.f[k]) === JSON.stringify(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }
  function head() {
    const all = X.rows?.map(r => r.p) || [], o = K.options(all), n = all.length, act = active();
    const bySport = new Map(); for (const p of all) bySport.set(p.sport, (bySport.get(p.sport) || 0) + 1);
    const sports = [['all', `All sports`, n], ...[...bySport].sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, SPORT[k] || k, c])];
    if (X.f.sport !== 'all' && !bySport.has(X.f.sport) && X.rows?.length) X.f.sport = 'all';
    const opts = (list, any) => [['all', any], ...list];
    const panel = `<div class="card px-panel" id="pxPanel"${X.panelOpen ? '' : ' hidden'} role="region" aria-label="Filters">
        <div class="px-grid">
          ${select('pxLeague', 'League', 'league', opts(o.league.map(([k]) => [k, SPORT[k] || k]), 'Every league'), true)}
          ${select('pxGame', 'Game', 'game', opts(o.game, 'Every game'), true)}
          ${select('pxTeam', 'Team', 'team', opts(o.team, 'Every team'), true)}
          ${select('pxStat', 'Statistic', 'stat', opts(o.stat, 'Every statistic'))}
          ${select('pxBook', 'Provider', 'provider', opts(o.provider.map(([k]) => [k, book(k)]), 'Every provider'), true)}
          ${select('pxSide', 'Over or under', 'side', SIDE)}
          ${select('pxHot', 'Running hot', 'hot', [[false, 'Any line'], [true, 'Hot lines only']])}
          ${select('pxL5', 'Last 5 hit rate', 'l5', RATE, true)}
          ${select('pxL10', 'Last 10 hit rate', 'l10', RATE, true)}
          ${select('pxL20', 'Last 20 hit rate', 'l20', RATE, true)}
          ${select('pxEdge', 'Supported edge', 'edge', EDGE, true)}
          ${select('pxGrade', 'Evidence quality', 'grade', GRADES, true)}
          ${select('pxWhen', 'Starting time', 'when', WHEN, true)}
          ${select('pxInj', 'Injury status', 'injury', INJ, true)}
          ${select('pxMove', 'Line movement', 'moved', MOVED, true)}
          ${select('pxGames', 'Games on record', 'games', GAMES, true)}
          ${select('pxMins', 'Minutes (last 5)', 'mins', MINS, true)}
        </div>
        ${can('advanced_filters') ? '' : `<p class="lb" id="pxPlusF">${ic('lock', 14)} The greyed filters are part of Plus. Sport, statistic, player and over or under stay free. <a href="#/pricing">See Plus</a></p>`}
        <div class="px-pa"><button type="button" class="bt ghost sm" data-px="clear"${act.length ? '' : ' disabled'}>Clear filters</button><button type="button" class="bt sm" data-px="closef">Done</button></div></div>`;
    $('pxHead').innerHTML = `<div class="px-top">
        <div class="cx-row scroll px-sports" role="group" aria-label="Sport">${sports.map(([k, l, c]) => `<button type="button" class="cx sm" data-pxsport="${k}" aria-pressed="${X.f.sport === k}">${esc(l)} <span class="num px-c">${c}</span></button>`).join('')}</div>
        <div class="px-bar">
          <label class="px-q" for="pxQ"><span class="sr-only">Find a player</span>${ic('search', 18)}<input id="pxQ" class="inp" type="search" name="player" placeholder="Find a player…" autocomplete="off" spellcheck="false" value="${esc(X.f.q)}"></label>
          <label class="px-sort" for="pxSort"><span>Sort</span><select class="inp" id="pxSort" name="sort">${K.SORTS.map(([k, l]) => `<option value="${k}"${X.sort === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <button type="button" class="bt ghost px-fb" data-px="filters" aria-expanded="${X.panelOpen}" aria-controls="pxPanel">${ic('filter', 18)}Filters${act.filter(k => k !== 'q').length ? ` <span class="pl solid px-n">${act.filter(k => k !== 'q').length}</span>` : ''}</button>
        </div></div>
      ${panel}
      ${act.length ? `<div class="cx-row px-chips" role="group" aria-label="Filters in use">${act.map(k => `<button type="button" class="cx sm" data-pxdrop="${k}" aria-label="Remove the filter ${esc(chipName(k))}">${esc(chipName(k))}${ic('x', 14)}</button>`).join('')}<button type="button" class="lk" data-px="clear">Clear all</button></div>` : ''}`;
  }
  function hr(w, k) {   // a hit-rate cell: the rate, and the count beside it so it is never colour alone
    if (!w || !w.n) return `<td class="r num px-na" data-k="${k}">–</td>`;
    const dec = w.n - w.push, r = dec ? w.hit / dec : null;
    return `<td class="r num${r != null && r >= .7 ? ' px-hi' : r != null && r <= .3 ? ' px-lo' : ''}" data-k="${k}"><b>${r == null ? '–' : Math.round(r * 100) + '%'}</b><small>${w.hit}/${dec}</small></td>`;
  }
  const gradeTag = g => g ? `<span class="px-g px-g-${g.grade}" title="${esc(g.word)}"><b>${g.grade}</b><span class="sr-only">, ${esc(g.word)}</span></span>` : '–';
  function startTxt(p) { return MK.when(p.start ? +p.start : null, Date.now(), tz()) || 'Time not confirmed' }
  function opp(p) { const e = p.v?.event || {}; return e.opp || p.opp || '' }
  function row(r) {
    const p = r.p, w = r.s.windows, mv = K.movement(p), se = p.sedge ?? null, o = opp(p), home = p.v?.event?.home;
    return `<tr data-pxrow="${esc(p.id)}">
      <th scope="row" class="px-who"><button type="button" class="px-open" data-pxopen="${esc(p.id)}">${face(p.photo, p.name)}<span class="rw-t"><b><span class="px-nm">${esc(p.name)}</span>${MK.isHot(p) ? ' <span class="pl px-hot" title="7 of the last 10 and 3 of the last 5 on this line, with 8 or more games">Hot</span>' : ''}</b><small>${esc([p.teamName || p.team, o ? `${home === false ? 'at' : 'v'} ${o}` : ''].filter(Boolean).join(' '))}</small></span></button></th>
      <td class="px-mk"><b>${esc(p.text)}</b><small>${esc(SPORT[p.sport] || p.sport)}${mv && mv.d ? ` · <span class="${mv.easier > 0 ? 'px-up' : 'px-dn'}">${mv.easier > 0 ? 'Moved for' : 'Moved against'} (was ${fmt(mv.from)})</span>` : ''}</small></td>
      <td class="px-when"><span>${esc(startTxt(p))}</span></td>
      ${hr(w[0], 'Last 5')}${hr(w[1], 'Last 10')}${hr(w[2], 'Last 20')}
      <td class="r num px-se" data-k="Supported edge">${se == null ? '<b class="px-na" aria-label="No market price, so no edge">–</b><small>No price</small>' : `<b>${K.signed(se)}</b>${p.edge != null && se !== p.edge ? `<small>raw ${K.signed(p.edge)}</small>` : ''}`}</td>
      <td class="px-gc" data-k="Evidence">${gradeTag(r.g)}</td>
      <td class="px-bk"><small>${esc((p.books || []).map(book).join(', ') || '–')}</small></td></tr>`;
  }
  function body() {
    const el = $('pxBody'); if (!el) return; el.setAttribute('aria-busy', String(X.loading && !X.rows));
    if (!X.rows) { el.innerHTML = `<p class="sr-only" role="status">Loading the open lines…</p>${'<div class="skl px-skl" aria-hidden="true"></div>'.repeat(6)}`; return }
    if (X.denied) { el.innerHTML = `<div class="card emp">${ic('lab', 28)}<b>The Lab is switched off for your account</b><p>Ask your admin to switch it on.</p></div>`; return }
    const all = X.rows.map(r => r.p), byId = new Map(X.rows.map(r => [r.p.id, r]));
    const list = K.sort(K.filter(all, X.f, { now: Date.now(), tz: tz(), dayDiff: MK.dayDiff, grades: X.grades }), X.sort, { grades: X.grades, pop: X.pop, key: keyOf });
    const shown = list.slice(0, X.shown), sports = new Set(list.map(p => p.sport)).size;
    const status = X.err ? `<p class="px-err" role="alert">${ic('help', 16)}The lines did not refresh: ${esc(X.err)} <button type="button" class="bt ghost sm" data-px="reload">Try again</button></p>` : '';
    const note = '';
    const sum = `<p class="px-sum" role="status"><b class="num">${list.length}</b> ${list.length === 1 ? 'open line' : 'open lines'}${X.f.sport === 'all' && sports > 1 ? ` across ${sports} sports` : ''}${X.at ? ` · checked <time datetime="${new Date(X.at).toISOString()}">${ago(X.at)}</time>` : ''}${X.loading ? ' · checking…' : ''}${list.length !== all.length ? ` <span class="lb">(${all.length - list.length} hidden by filters)</span>` : ''}</p>`;
    const table = !all.length ? `<div class="card emp">${ic('bars', 28)}<b>No open lines right now</b><p>${X.err ? 'The providers did not answer. Try again in a minute.' : 'Every listed game has started or no provider has posted player lines yet. New lines appear here as soon as they are verified.'}</p></div>`
      : !list.length ? `<div class="card emp">${ic('filter', 28)}<b>No lines match these filters</b><p>${all.length} open ${all.length === 1 ? 'line is' : 'lines are'} hidden by them.</p><button type="button" class="bt" data-px="clear">Clear filters</button></div>`
      : `<div class="px-tw"><table class="px-t"><caption class="sr-only">Open player lines, ${esc(K.SORTS.find(s => s[0] === X.sort)[1].toLowerCase())} first. Select a player for the research panel.</caption>
          <thead><tr><th scope="col">Player</th><th scope="col">Line</th><th scope="col">Starts</th><th scope="col" class="r"><abbr title="Hit rate over the last 5 games">L5</abbr></th><th scope="col" class="r"><abbr title="Hit rate over the last 10 games">L10</abbr></th><th scope="col" class="r"><abbr title="Hit rate over the last 20 games">L20</abbr></th><th scope="col" class="r">Supported edge</th><th scope="col">Evidence</th><th scope="col">Provider</th></tr></thead>
          <tbody>${shown.map(p => row(byId.get(p.id))).join('')}</tbody></table></div>
        ${list.length > shown.length ? `<button type="button" class="bt ghost wide" data-px="more">Show ${Math.min(40, list.length - shown.length)} more of ${list.length - shown.length}</button>` : ''}`;
    const gone = X.removed.filter(p => X.f.sport === 'all' || p.sport === X.f.sport);
    const removed = gone.length ? `<details class="card drw px-gone"><summary>Taken off the board <span class="lb">${gone.length} ${gone.length === 1 ? 'line' : 'lines'}, each with the reason</span></summary><div class="drw-b"><ul class="px-gl">${gone.slice(0, 60).map(p => `<li><span class="rw-t"><b>${esc(p.name)} · ${esc(p.text || p.label || '')}</b><small>${esc(p.message || MK.removalMessage(p.status, p.removalReason || p.reason) || p.statusLabel || p.v?.label || 'Removed')}${p.removalReason || p.v?.text ? ': ' + esc(p.removalReason || p.v?.text) : ''}</small></span></li>`).join('')}</ul></div></details>` : '';
    el.innerHTML = status + sum + note + table + removed + `<p class="lb px-foot">Hit rates describe past games, not the next one. Supported edge and evidence are explained in each player’s research panel.</p>`;
  }
  function draw() { if (!X.host?.isConnected) return; const a = document.activeElement, id = a?.id, fk = a?.dataset?.pxsport || a?.dataset?.px || a?.dataset?.pxdrop;
    head(); body();
    // keep the keyboard's place across a redraw
    const back = id ? $(id) : fk ? X.host.querySelector(`[data-pxsport="${fk}"],[data-px="${fk}"],[data-pxdrop="${fk}"]`) : null; if (back && back !== a) { back.focus({ preventScroll: true }); if (id === 'pxQ') { const v = back.value; back.setSelectionRange?.(v.length, v.length) } } }

  /* ---------- explorer events ---------- */
  let qT = 0;
  document.addEventListener('input', ev => { if (ev.target.id !== 'pxQ') return; clearTimeout(qT); const v = ev.target.value; qT = setTimeout(() => { X.f.q = v.trim(); X.shown = 40; save(); draw() }, 160) });
  document.addEventListener('change', ev => {
    const t = ev.target; if (!X.host?.contains(t)) return;
    if (t.id === 'pxSort') { X.sort = t.value; save(); if (['followed', 'researched'].includes(X.sort)) loadPop(); return draw() }
    const k = t.dataset.pxf; if (!k) return;
    let v; try { v = JSON.parse(t.value) } catch (e) { v = t.value }
    X.f[k] = v; X.shown = 40; save(); draw();
  });
  document.addEventListener('click', ev => {
    const t = ev.target; if (!X.host?.contains(t)) return;
    const sp = t.closest('[data-pxsport]'); if (sp) { X.f.sport = sp.dataset.pxsport; X.shown = 40; save(); return draw() }
    const dr = t.closest('[data-pxdrop]'); if (dr) { X.f[dr.dataset.pxdrop] = K.defaults()[dr.dataset.pxdrop]; save(); draw(); return (X.host.querySelector('[data-pxdrop]') || $('pxQ'))?.focus() }
    const op = t.closest('[data-pxopen]'); if (op) return openPanel(op.dataset.pxopen, op);
    const tr = t.closest('tr[data-pxrow]'); if (tr && !t.closest('a,button,select,input')) return openPanel(tr.dataset.pxrow, tr.querySelector('[data-pxopen]'));
    const a = t.closest('[data-px]')?.dataset.px; if (!a) return;
    if (a === 'filters') { X.panelOpen = !X.panelOpen; draw(); return X.panelOpen && $('pxPanel')?.querySelector('select:not([disabled])')?.focus() }
    if (a === 'closef') { X.panelOpen = false; draw(); return X.host.querySelector('[data-px="filters"]')?.focus() }
    if (a === 'clear') { const sport = X.f.sport; X.f = { ...K.defaults(), sport }; save(); draw(); return $('pxQ')?.focus() }
    if (a === 'more') { X.shown += 40; return body() }
    if (a === 'reload') return load(true);
  });

  /* ---------- the research panel ---------- */
  const R = { p: null, from: null, moves: null, prior: null, tab: 'chart', key: '', lens: null, lensWin: 'l10' };
  const find = id => X.rows?.find(r => r.p.id === id)?.p || window.flMarkets?.get?.(id) || null;
  async function openPanel(id, from) {
    const p = typeof id === 'string' ? find(id) : id; if (!p) return;
    // one Lab search on the free plan is opening a player's research; a filter is never one
    if (window.flPlan?.use && !(window.flPlan.can?.('lab_unlimited') ?? true)) {
      const u = await window.flPlan.use('lab_search', `${p.sport}:${p.name}`).catch(() => ({ ok: true }));   // the same player twice in a day counts once
      if (u && u.ok === false) { let box = X.host?.querySelector('#pxPlan'); if (!box && X.host) { box = document.createElement('div'); box.id = 'pxPlan'; box.tabIndex = -1; X.host.prepend(box) }
        if (box) { box.innerHTML = upsell('lab_unlimited', 'Unlimited Lab searches are part of Plus.'); box.focus() } return }
    }
    if (R.key !== keyOf(p) || R.p?.line !== p.line) R.lens = null;
    R.p = p; R.from = from || document.activeElement; R.moves = null; R.prior = null; R.key = keyOf(p);
    track('player_open', { sport: p.sport, player: p.name }); count(p, 'research');
    try { window.flRecent?.note({ kind: 'player', key: `player:${p.sport}:${p.name}:${p.k}`, label: p.name, sub: p.text, photo: p.photo || '', open: { lab: { sport: p.sport, name: p.name, kind: 'player', stat: p.k, line: p.line, side: p.side } } }) } catch (e) {}
    if (!X.panel) { X.panel = document.createElement('div'); X.panel.className = 'rp'; X.panel.id = 'flRP'; document.body.appendChild(X.panel) }
    redrawPanel(true);
    window.flOverlay?.open(X.panel, { from: R.from });
    $('rpT')?.focus();
    loadMoves(p);
  }
  function closePanel() {
    if (!X.panel) return; const el = X.panel; X.panel = null; R.p = null;
    if (window.flOverlay) window.flOverlay.close(el); el.remove();
    if (R.from?.isConnected) R.from.focus({ preventScroll: true });
  }
  function loadMoves(p) {
    if (!can('line_history')) return;
    const q = new URLSearchParams({ sport: p.sport, player: p.name, k: p.k, start: p.start ? Math.round(+p.start / 1000) : '' }), q2 = new URLSearchParams({ sport: p.sport, player: p.name, k: p.k });
    const get = u => fetch(u, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))));
    get('/api/props/moves?' + q).then(d => { R.moves = d.props || [] }, () => { R.moves = [] }).finally(() => R.p === p && redrawPanel());
    get('/api/props/moves?' + q2).then(d => { R.prior = (d.props || []).filter(x => !p.start || Math.abs(x.start * 1000 - +p.start) > 6 * 3600e3) }, () => { R.prior = [] }).finally(() => R.p === p && redrawPanel());
  }
  // the hit/miss chart: one bar per game, oldest left, the line drawn across; every bar also says hit, miss or push in its label
  function chart(p, gs) {
    const xs = gs.slice(0, 20).reverse(); if (!xs.length) return '<p class="lb">No games on record.</p>';
    const over = p.side !== 'under', top = Math.max(p.line * 1.25, ...xs.map(g => g.v)) || 1, W = 100 / xs.length;
    const res = g => g.v === p.line ? 'push' : (over ? g.v > p.line : g.v < p.line) ? 'hit' : 'miss';
    const word = { hit: 'hit', miss: 'miss', push: 'push' }, day = t => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    return `<svg class="rp-ch" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-labelledby="rpChT"><title id="rpChT">${esc(K.splits(gs, { line: p.line, side: p.side, yes: p.yes }).summary)}</title>
      ${xs.map((g, i) => { const h = Math.max(.8, g.v / top * 56), r = res(g); return `<rect class="rp-b ${r}" x="${(i * W + W * .14).toFixed(2)}" y="${(60 - h).toFixed(2)}" width="${(W * .72).toFixed(2)}" height="${h.toFixed(2)}"><title>${esc(`${day(g.date)}${g.opp ? ' v ' + g.opp : ''}: ${fmt(g.v)}, ${word[r]}`)}</title></rect>` }).join('')}
      <line class="rp-ln" x1="0" x2="100" y1="${(60 - p.line / top * 56).toFixed(2)}" y2="${(60 - p.line / top * 56).toFixed(2)}"/></svg>
      <div class="rp-chk" aria-hidden="true"><span><i class="hit"></i>${over ? 'Over' : 'Under'} the line</span><span><i class="miss"></i>Missed</span><span><i class="ln"></i>Line ${fmt(p.line)}</span></div>`;
  }
  function log(p, gs) {
    const over = p.side !== 'under', res = g => g.v === p.line ? 'Push' : (over ? g.v > p.line : g.v < p.line) ? 'Hit' : 'Miss';
    return `<div class="tbx-wrap"><table class="tbx rp-log"><caption class="sr-only">Game log against the line ${fmt(p.line)}, newest first</caption><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col" class="r">Min</th><th scope="col" class="r">${esc(p.label)}</th><th scope="col">Result</th></tr></thead>
      <tbody>${gs.slice(0, 20).map(g => `<tr><th scope="row" class="num">${g.date ? esc(new Date(g.date).toLocaleDateString([], { month: 'short', day: 'numeric' })) : '–'}</th><td>${g.home === false ? 'at ' : g.home ? 'v ' : ''}${esc(g.oppAbbr || g.opp || '–')}</td><td class="r num">${g.min == null ? '–' : Math.round(g.min)}</td><td class="r num">${fmt(g.v)}</td><td><span class="rp-r ${res(g).toLowerCase()}">${res(g)}</span></td></tr>`).join('')}</tbody></table></div>`;
  }
  const rec = w => !w || !w.n ? '–' : `${w.hit}–${w.miss}${w.push ? `–${w.push}` : ''}`;
  const rate = w => !w || !(w.n - w.push) ? '' : Math.round(w.hit / (w.n - w.push) * 100) + '%';
  function splitTable(s, full) {
    const rows = full ? [...s.windows, s.home, s.away, s.vsOpp].filter(Boolean) : [s.windows[1]];
    return `<div class="tbx-wrap"><table class="tbx rp-sp"><caption class="sr-only">Record against this line by window, hits first</caption><thead><tr><th scope="col">Games</th><th scope="col" class="r">Hit–miss${rows.some(w => w.push) ? '–push' : ''}</th><th scope="col" class="r">Rate</th><th scope="col" class="r">Played</th></tr></thead>
      <tbody>${rows.map(w => `<tr><th scope="row">${esc(w.label)}</th><td class="r num">${rec(w)}</td><td class="r num"><b>${rate(w) || '–'}</b></td><td class="r num">${w.n}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function numbers(p, g, s) {
    const n = (p.games || []).filter(x => x.v != null).length;
    return `<dl class="rp-nums">
      <div><dt>Floodlight chance</dt><dd class="fig num">${pct(p.ours)}</dd></div>
      <div><dt>Supported edge</dt><dd class="fig num">${p.sedge == null ? '–' : K.signed(p.sedge)}</dd>${p.sedge == null ? '<small class="lb">No market price, so no edge</small>' : ''}</div>
      <div><dt>Evidence quality</dt><dd class="fig">${g ? g.grade : '–'}</dd>${g ? `<small class="lb">${esc(g.word)}</small>` : ''}</div>
      <div><dt>Sample</dt><dd class="fig num">${n}</dd><small class="lb">${n === 1 ? 'game' : 'games'} on record</small></div></dl>`;
  }
  function edgeBox(p) {
    if (p.edge == null) return '';
    const b = Array.isArray(p.cuts) ? K.breakdown(p.edge, p.cuts) : null, why = p.cut || [];
    // without each reason's own factor (the verified feed's cuts) the steps can't be split honestly: the reasons are listed instead
    if (!b) return `<section class="rp-sec"><h3>How the supported edge is worked out</h3><p class="lb">${esc(K.EXPLAIN)}</p>
      <table class="rp-eb"><tbody><tr><th scope="row">Raw edge</th><td class="r num">${K.signed(p.edge)}</td></tr><tr class="tot"><th scope="row">Supported edge${why.length ? `<small>Reduced because: ${esc(why.join('. '))}</small>` : ''}</th><td class="r num">${K.signed(p.sedge)}</td></tr></tbody></table>
      <p class="lb">Raw edge is our chance minus the market’s, in points (${pct(p.ours)} against ${pct(p.market)}).</p></section>`;
    const ok = b.edge === (p.sedge ?? b.edge);
    return `<section class="rp-sec"><h3>How the supported edge is worked out</h3><p class="lb">${esc(K.EXPLAIN)}</p>
      <table class="rp-eb"><caption class="sr-only">From the raw edge to the supported edge</caption><tbody>
        <tr><th scope="row">Raw edge</th><td class="r num">${K.signed(b.raw)}</td></tr>
        ${b.rows.map(r => `<tr><th scope="row">${esc(r.label)}${r.reasons.length ? `<small>${esc(r.reasons.join('. '))}</small>` : ''}</th><td class="r num">${r.pts ? K.signed(r.pts) : '0'}</td></tr>`).join('')}
        <tr class="tot"><th scope="row">Supported edge</th><td class="r num">${K.signed(ok ? b.edge : p.sedge)}</td></tr></tbody></table>
      <p class="lb">Raw edge is our chance minus the market’s, in points (${pct(p.ours)} against ${pct(p.market)}).</p></section>`;
  }
  function gradeBox(g) {
    if (!g) return '';
    return `<section class="rp-sec"><h3>Evidence quality: ${g.grade} <span class="lb">${esc(g.word)}</span></h3><p class="lb">How much stands behind the number, graded apart from the edge and the chance.</p>
      <ul class="rp-why">${g.points.map(x => `<li class="${x.ok ? 'ok' : 'no'}">${ic(x.ok ? 'check' : 'help', 14)}<span>${esc(x.text)}</span></li>`).join('')}</ul></section>`;
  }
  function providers(p) {
    const offers = (p.offers || []).filter(o => o.line != null);
    if (!offers.length) return '';
    if (!can('provider_compare')) return `<section class="rp-sec"><h3>Every provider</h3>${upsell('provider_compare', 'Comparing providers is part of Plus.')}</section>`;
    const over = p.side !== 'under', best = offers.reduce((a, o) => (over ? o.line < a.line : o.line > a.line) ? o : a, offers[0]);
    return `<section class="rp-sec"><h3>Every provider</h3><div class="tbx-wrap"><table class="tbx"><caption class="sr-only">The line and price at each provider</caption><thead><tr><th scope="col">Provider</th><th scope="col" class="r">Line</th><th scope="col" class="r">${over ? 'Over' : 'Under'} chance</th><th scope="col"></th></tr></thead>
      <tbody>${offers.map(o => `<tr><th scope="row">${esc(book(o.book))}</th><td class="r num">${fmt(o.line)}</td><td class="r num">${o.pOver == null ? '<span class="lb">Fixed payout</span>' : pct(over ? o.pOver : 1 - o.pOver)}</td><td>${o === best && offers.length > 1 ? `<span class="pl">Best line for the ${over ? 'over' : 'under'}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="lb">Verified ${p.verifiedAt || p.at ? esc(ago(p.verifiedAt || p.at)) : 'time unknown'}. A chance is shown only where the provider prices both sides, with its margin taken out.</p></section>`;
  }
  function lineHist(p, s) {
    if (!can('line_history')) return `<section class="rp-sec"><h3>Line history</h3>${upsell('line_history', 'Line history is part of Plus.')}</section>`;
    const m = R.moves, rec0 = (m || []).find(x => x.side === p.side || x.line === p.line) || (m || [])[0], reads = rec0?.readings || [];
    const first = reads[0], open = p.lineFrom ?? p.openLine ?? first?.line ?? null;
    const body = m == null ? '<p class="lb">Loading the saved readings…</p>'
      : `<dl class="rp-mini"><div><dt>Opening line</dt><dd class="num">${fmt(open)}</dd></div><div><dt>Now</dt><dd class="num">${fmt(p.line)}</dd></div><div><dt>Readings</dt><dd class="num">${reads.length || '–'}</dd></div></dl>
        ${reads.length > 1 ? `<ol class="rp-lh">${reads.slice(-8).map(r => `<li><time>${esc(new Date(r.at * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</time><b class="num">${fmt(r.line)}</b>${r.market != null ? `<small>market ${pct(r.market)}</small>` : ''}</li>`).join('')}</ol>` : `<p class="lb">${open != null && open !== p.line ? `Opened at ${fmt(open)}.` : 'The line has not moved since we first saw it.'}</p>`}`;
    const sim = s.similar.length ? `<h4>Similar earlier lines</h4><ul class="rp-sim">${s.similar.map(x => `<li><span class="num">${x.side === 'under' ? 'Under' : 'Over'} ${fmt(x.line)}</span><small>${x.start ? esc(new Date(x.start * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })) : ''}</small><span class="rp-r ${x.result === 'won' ? 'hit' : x.result === 'lost' ? 'miss' : 'push'}">${x.result === 'won' ? 'Hit' : x.result === 'lost' ? 'Miss' : 'Push'}</span></li>`).join('')}</ul>` : R.prior == null ? '' : '<p class="lb">No graded earlier lines for this stat yet.</p>';
    return `<section class="rp-sec"><h3>Line history</h3>${body}${sim}</section>`;
  }
  function availability(p, s) {
    const a = p.av, m = s.mins, t = m.trend;
    const minsTxt = m.l5 == null ? 'Minutes are not in the log for this sport.' : `${fmt(m.l5)} minutes a game over the last 5${m.l20 != null ? `, ${fmt(m.l20)} over the last 20` : ''}${t != null && Math.abs(t) >= .08 ? ` (${t > 0 ? 'up' : 'down'} ${Math.round(Math.abs(t) * 100)}%)` : ''}.`;
    return `<section class="rp-sec"><h3>Availability and usage</h3><ul class="rp-av">
      <li><span class="lb">Injury report</span><b>${esc(a?.report || 'Not checked yet')}</b></li><li><span class="lb">Status</span><b>${esc(a?.avail || 'Not checked yet')}</b></li>
      <li><span class="lb">Lineup</span><b>${esc(a?.start || 'Lineup not announced')}</b></li><li><span class="lb">Minutes</span><b>${esc(minsTxt)}</b></li></ul></section>`;
  }

  /* ---------- Line Lens: drag the line, or jump to a line a provider has open now ----------
     The counting is labcore.js lens() and curve(); the snap points are labcore.snaps() over the verified feed's open
     markets only, so a closed or expired line is never offered. Moving the line recounts the games. It never changes
     the chance, the edge or the grade above, which stay tied to the posted line. */
  const LW = [['l5', 'Last 5'], ['l10', 'Last 10'], ['l20', 'Last 20'], ['season', 'Season']];
  function lensData(p, gone) {
    const gs = (p.games || []).filter(x => x.v != null), open = gone ? [] : (window.flMarkets?.open?.() || X.rows?.map(r => r.p) || []);
    const sn = K.snaps(p, open), rg = K.lensRange(gs, p.line, sn.map(x => x.line));
    const line = R.lens ?? p.line;
    return { gs, sn, rg, line, L: K.lens(gs, line, p.side), full: can('splits_full') };
  }
  const bookList = x => x.books.map(b => book(b.book)).join(', ');
  const snapAge = x => { const t = Math.max(...x.books.map(b => +b.at || 0)); return t ? `verified ${ago(t > 1e11 ? t : t * 1000)}` : 'verification time unknown' };
  function lensViz(p, d) {
    const { gs, rg, line, L, sn, full } = d, under = p.side === 'under', word = under ? 'Under' : 'Over';
    const xs = gs.slice(0, 20).reverse();
    const top = Math.max(rg.hi, ...xs.map(g => g.v), .5) * 1.08, Y = v => 60 - v / top * 56;
    const res = v => v === line ? 'push' : (under ? v < line : v > line) ? 'hit' : 'miss', W = 100 / Math.max(1, xs.length);
    const bars = xs.length ? `<svg class="rp-ch ll-svg" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      ${sn.map(x => `<line class="ll-sn" x1="0" x2="100" y1="${Y(x.line).toFixed(2)}" y2="${Y(x.line).toFixed(2)}"/>`).join('')}
      ${xs.map((g, i) => { const h = Math.max(.8, g.v / top * 56); return `<rect class="rp-b ${res(g.v)}" x="${(i * W + W * .14).toFixed(2)}" y="${(60 - h).toFixed(2)}" width="${(W * .72).toFixed(2)}" height="${h.toFixed(2)}"><title>${esc(`${g.date ? new Date(g.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}${g.opp ? ' v ' + g.opp : ''}: ${fmt(g.v)}`)}</title></rect>` }).join('')}</svg>
      <span class="ll-ln${line !== p.line ? ' moved' : ''}" style="bottom:${(Math.min(56, line / top * 56) / 60 * 100).toFixed(1)}%"><i class="num">${fmt(line)}</i></span>` : '';
    const rows = full ? L.rows : L.rows.filter(r => r.key === 'l10' || (r.key === 'season' && !L.rows.some(x => x.key === 'l10')));
    const table = `<div class="tbx-wrap"><table class="tbx ll-t"><caption class="sr-only">Games against ${fmt(line)}, by window</caption><thead><tr><th scope="col">Games</th><th scope="col" class="r">Over</th><th scope="col" class="r">Under</th><th scope="col" class="r">Push</th><th scope="col" class="r">${word} rate</th></tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${esc(r.key === 'season' ? `This season (${r.n})` : r.label)}</th><td class="r num">${r.over}</td><td class="r num">${r.under}</td><td class="r num">${r.push || '–'}</td><td class="r num"><b>${r.rate == null ? '–' : pct(r.rate)}</b></td></tr>`).join('')}</tbody></table></div>
      ${full ? '' : upsell('splits_full', 'Last 5, last 20 and season counts in Line Lens are part of Plus.')}`;
    // how the rate changes as the line moves, for one window, with the open lines marked on the axis
    const win = full && L.rows.some(r => r.key === R.lensWin) ? R.lensWin : (L.rows.find(r => r.key === 'l10') || L.rows[0])?.key || 'l10';
    const cv = K.curve(gs, p.side, rg.lines, win).filter(c => c.rate != null), n = rg.lines.length;
    const X = x => n > 1 ? (x - rg.lo) / (rg.hi - rg.lo) * 100 : 50, CY = r => 38 - r * 34;
    const path = cv.map((c, i) => `${i ? 'L' : 'M'}${X(c.line).toFixed(2)} ${CY(c.rate).toFixed(2)}`).join('');
    const wName = (LW.find(w => w[0] === win) || [, 'Last 10'])[1].toLowerCase();
    const at = cv.find(c => c.line === line) || cv.reduce((a, c) => !a || Math.abs(c.line - line) < Math.abs(a.line - line) ? c : a, null);
    const curve = cv.length > 1 ? `<figure class="ll-cv"><figcaption class="ll-cvh"><b>${word} rate at each line</b>${full ? '' : `<span class="lb">${esc(wName)}</span>`}</figcaption>
      ${full ? `<div class="seg ll-win" role="radiogroup" aria-label="Games counted in the curve">${LW.filter(w => L.rows.some(r => r.key === w[0])).map(([k, l]) => `<button type="button" role="radio" aria-checked="${win === k}" class="${win === k ? 'on' : ''}" tabindex="${win === k ? 0 : -1}" data-llwin="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="ll-cvp"><span class="ll-ya lb" aria-hidden="true"><i>100%</i><i>50%</i><i>0%</i></span>
        <svg class="ll-cvs" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(`${word} rate over the ${wName} at each line from ${fmt(rg.lo)} to ${fmt(rg.hi)}. At ${fmt(line)}: ${at?.rate == null ? 'no games off the line' : pct(at.rate)}. The table below lists every line.`)}">
          <line class="ll-g" x1="0" x2="100" y1="4" y2="4"/><line class="ll-g" x1="0" x2="100" y1="21" y2="21"/><line class="ll-ax" x1="0" x2="100" y1="38" y2="38"/>
          ${sn.map(x => `<line class="ll-snx" x1="${X(x.line).toFixed(2)}" x2="${X(x.line).toFixed(2)}" y1="4" y2="38"/>`).join('')}
          <path class="ll-path" d="${path}"/>
          <line class="ll-now" x1="${X(line).toFixed(2)}" x2="${X(line).toFixed(2)}" y1="2" y2="38"/>
          ${cv.map(c => `<rect class="ll-hit" x="${(X(c.line) - 50 / n).toFixed(2)}" y="0" width="${(100 / n).toFixed(2)}" height="40"><title>${esc(`Line ${fmt(c.line)}: ${pct(c.rate)} ${word.toLowerCase()}, ${c.d} games off the line`)}</title></rect>`).join('')}</svg></div>
      <div class="ll-xa lb" aria-hidden="true"><span class="num">${fmt(rg.lo)}</span><span>${sn.length ? '<i class="ll-k"></i>Lines open now' : ''}</span><span class="num">${fmt(rg.hi)}</span></div>
      <details class="ll-tbl"><summary>Every line as a table</summary><div class="tbx-wrap"><table class="tbx"><caption class="sr-only">${esc(word)} rate over the ${esc(wName)} at each line</caption><thead><tr><th scope="col">Line</th><th scope="col" class="r">${word} rate</th><th scope="col" class="r">Games off the line</th><th scope="col">Open now</th></tr></thead>
        <tbody>${cv.map(c => { const o = sn.find(x => x.line === c.line); return `<tr${c.line === line ? ' class="on"' : ''}><th scope="row" class="num">${fmt(c.line)}</th><td class="r num">${pct(c.rate)}</td><td class="r num">${c.d}</td><td>${o ? esc(bookList(o)) : ''}</td></tr>` }).join('')}</tbody></table></div></details></figure>` : '';
    return `<div class="ll-ch" data-llchart data-top="${top}">${bars}</div>
      <p class="ll-out" id="llOut"><b>${esc(L.summary)}</b>${line !== p.line ? ` <span class="lb">The posted line is ${fmt(p.line)}.</span>` : ''}</p>${table}${curve}`;
  }
  function lensBox(p, gone) {
    const d = lensData(p, gone); if (!d.gs.length || p.yes) return '';
    const { rg, sn, line } = d, smin = Math.max(.5, Math.floor(rg.lo * 2) / 2), smax = Math.ceil(rg.hi * 2) / 2;
    const chips = sn.length ? `<div class="ll-snaps" role="group" aria-label="Lines open now: choose one to jump to it">${sn.map(x => `<button type="button" class="cx sm ll-snap" data-llsnap="${x.line}" aria-pressed="${x.line === line}"><b class="num">${fmt(x.line)}</b><small>${esc(bookList(x))} · ${esc(snapAge(x))}</small></button>`).join('')}</div>`
      : `<p class="lb">${gone ? 'This market is off the board, so there are no open lines to jump to.' : 'No provider has another line open for this stat right now.'}</p>`;
    return `<section class="rp-sec ll" aria-labelledby="llH"><div class="ll-hd"><h3 id="llH">Line Lens</h3><button type="button" class="lk" data-ll="reset"${line === p.line ? ' hidden' : ''}>Back to the posted line, ${fmt(p.line)}</button></div>
      <p class="lb">Drag the line across ${d.gs.length > 20 ? 'the last 20 games' : 'the games'}, or jump to a line a provider has open now. The counts change as you move it; the chance and edge above stay on the posted line.</p>
      ${chips}
      <label class="ll-sl" for="llR"><span class="lb">Line</span><input type="range" id="llR" min="${smin}" max="${smax}" step="0.5" value="${line}" aria-valuetext="${esc(d.L.summary)}"><output class="num" for="llR">${fmt(line)}</output></label>
      <div id="llViz">${lensViz(p, d)}</div></section>`;
  }
  // a new line: repaint the lens only (the rest of the panel, and the slider being dragged, stay put)
  function setLens(v, from) {
    const p0 = R.p; if (!p0 || !X.panel) return; const p = find(p0.id) || p0, gone = !find(p0.id) && X.rows;
    const d0 = lensData(p, gone), sn = d0.sn;
    v = Math.round(+v * 2) / 2; if (isNaN(v)) return;
    // within a quarter of a provider's line, the line snaps to it
    if (from === 'drag') { const near = sn.find(x => Math.abs(x.line - v) <= .25); if (near) v = near.line }
    R.lens = v === p.line ? null : v;
    const d = lensData(p, gone), box = X.panel.querySelector('#llViz'); if (!box) return;
    box.innerHTML = lensViz(p, d);
    const r = X.panel.querySelector('#llR'); if (r) { if (+r.value !== d.line) r.value = d.line; r.setAttribute('aria-valuetext', d.L.summary); const o = r.parentElement.querySelector('output'); if (o) o.textContent = fmt(d.line) }
    X.panel.querySelectorAll('[data-llsnap]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.llsnap === d.line)));
    const rs = X.panel.querySelector('[data-ll="reset"]'); if (rs) rs.hidden = d.line === p.line;
  }
  let llDrag = null;
  const llFromY = (el, y) => { const r = el.getBoundingClientRect(); return (1 - (y - r.top) / r.height) * 60 / 56 * +el.dataset.top };
  document.addEventListener('input', ev => { if (ev.target.id === 'llR' && X.panel?.contains(ev.target)) setLens(ev.target.value) });
  document.addEventListener('pointerdown', ev => { const c = ev.target.closest?.('[data-llchart]'); if (!c || !X.panel?.contains(c) || ev.button > 0) return; llDrag = c.closest('#llViz'); c.classList.add('drag'); setLens(llFromY(c, ev.clientY), 'drag'); ev.preventDefault() });
  document.addEventListener('pointermove', ev => { if (!llDrag) return; const c = llDrag.querySelector('[data-llchart]'); if (c) { c.classList.add('drag'); setLens(llFromY(c, ev.clientY), 'drag') } });
  const llUp = () => { if (!llDrag) return; llDrag.querySelector('[data-llchart]')?.classList.remove('drag'); llDrag = null; say(X.panel?.querySelector('#llOut')?.textContent || '') };
  document.addEventListener('pointerup', llUp); document.addEventListener('pointercancel', llUp);
  // what "Report incorrect data" sends with the member's note (the dialog is datastatus.js's, the same as on Predictions)
  const reportOf = p => ({ marketId: p.mid || p.id, eventId: p.eventId || p.v?.event?.id || '', player: p.name, provider: (p.books || []).map(book).join(', '),
    sport: p.sport, stat: p.text, line: p.line, side: p.side, verifiedAt: p.verifiedAt ? Math.round(+p.verifiedAt > 1e11 ? +p.verifiedAt / 1000 : +p.verifiedAt) : '', page: '#/lab (Prop Explorer)' });
  const inCard = p => { try { return !!window.flPredictions?.slip?.has(p.id) } catch (e) { return false } };
  const followed = p => { try { return !!window.flPredictions?.follow?.has(p) } catch (e) { return false } };
  function redrawPanel(first) {
    const el = X.panel, p0 = R.p; if (!el || !p0) return;
    const p = find(p0.id) || p0, gone = !find(p0.id) && X.rows;   // the market left the board while the panel was open
    const g = X.grades.get(p.id) || K.grade(p), gs = (p.games || []).filter(x => x.v != null), e = p.v?.event || {}, o = opp(p);
    const s = K.splits(gs, { line: p.line, side: p.side, yes: p.yes, opp: o, oppAbbr: e.oppAbbr, prior: (R.prior || []).map(x => ({ line: x.line, side: x.side, result: x.result, start: x.start })) });
    const full = can('splits_full');
    const scroll = el.querySelector('.rp-b0')?.scrollTop || 0;
    el.innerHTML = `<div class="rp-scrim" data-rp="close"></div><div class="rp-sheet" role="dialog" aria-modal="true" aria-labelledby="rpT" aria-describedby="rpSub">
      <header class="rp-h">${face(p.photo, p.name, 'avx av-lg')}<div class="rp-ht"><h2 id="rpT" tabindex="-1">${esc(p.name)}</h2>
        <p id="rpSub">${esc([[p.teamName || p.team, o ? `${e.home === false ? 'at' : 'v'} ${o}` : ''].filter(Boolean).join(' '), SPORT[p.sport] || p.sport].filter(Boolean).join(' · '))}</p><p class="lb">${esc(startTxt(p))}</p></div>
        <button type="button" class="ib" data-rp="close" aria-label="Close the research panel">${ic('x', 18)}</button></header>
      <div class="rp-b0">
      ${gone ? `<p class="px-err" role="alert">${ic('help', 16)}This line has left the board (its game started, the provider closed it or it could not be verified). What follows is the last reading.</p>` : ''}
      <div class="rp-line"><span class="lb">Current line</span><b class="rp-lt">${esc(p.text)}</b><small class="lb">${esc((p.books || []).map(book).join(', '))}${p.verifiedAt || p.at ? ` · verified ${esc(ago(p.verifiedAt || p.at))}` : ''}</small></div>
      ${numbers(p, g, s)}
      <div class="rp-acts">
        <button type="button" class="bt" data-rp="card" aria-pressed="${inCard(p)}">${ic(inCard(p) ? 'check' : 'plus', 18)}${inCard(p) ? 'On your Prediction Card' : 'Add to Prediction Card'}</button>
        <button type="button" class="bt ghost" data-rp="follow" aria-pressed="${followed(p)}">${ic('star', 18)}${followed(p) ? 'Following' : 'Follow'}</button>
        <button type="button" class="bt ghost" data-rp="board">${ic('save', 18)}Save to board</button>
        <button type="button" class="bt ghost" data-rp="share">${ic('share', 18)}Share</button>
        <button type="button" class="bt ghost" data-rp="compare">${ic('compare', 18)}Compare</button>
        <button type="button" class="lk" data-rp="lab">Full player page${ic('arrow', 16)}</button></div>
      <p class="sr-only" role="status" id="rpSay"></p>
      <section class="rp-sec"><h3>Every game against this line</h3><p class="rp-sum">${esc(s.summary)}</p>
        <div class="seg rp-tabs" role="tablist" aria-label="Show the games as"><button type="button" role="tab" id="rpTabC" aria-selected="${R.tab === 'chart'}" aria-controls="rpPane" data-rptab="chart" tabindex="${R.tab === 'chart' ? 0 : -1}">Chart</button><button type="button" role="tab" id="rpTabL" aria-selected="${R.tab === 'log'}" aria-controls="rpPane" data-rptab="log" tabindex="${R.tab === 'log' ? 0 : -1}">Game log</button></div>
        <div id="rpPane" role="tabpanel" aria-labelledby="${R.tab === 'chart' ? 'rpTabC' : 'rpTabL'}">${R.tab === 'chart' ? chart(p, gs) : log(p, gs)}</div></section>
      ${lensBox(p, gone)}
      <section class="rp-sec"><h3>Splits</h3>
        <dl class="rp-mini"><div><dt>Average</dt><dd class="num">${fmt(s.avg)}</dd></div><div><dt>Median</dt><dd class="num">${fmt(s.med)}</dd></div><div><dt>Line</dt><dd class="num">${fmt(p.line)}</dd></div></dl>
        ${splitTable(s, full)}${full ? '' : upsell('splits_full', 'Last 5, last 20, season, home and away and opponent splits are part of Plus.')}</section>
      ${edgeBox(p)}${gradeBox(g)}${availability(p, s)}${providers(p)}${lineHist(p, s)}
      <p class="lb rp-foot">Past results describe what happened, not what will happen next. This is research, not betting advice.
        <button type="button" class="lk ds-rep" data-report="${esc(JSON.stringify(reportOf(p)))}">${ic('help', 16)}Report incorrect data<span class="sr-only">: ${esc(p.name)}, ${esc(p.text)}</span></button></p></div></div>`;
    window.flOverlay?.guard?.(el);
    if (!first) { const b = el.querySelector('.rp-b0'); if (b) b.scrollTop = scroll }
  }
  const say = t => { const s = $('rpSay'); if (s) { s.textContent = ''; setTimeout(() => { s.textContent = t }, 30) } };
  document.addEventListener('click', ev => {
    if (!X.panel || !X.panel.contains(ev.target)) return;
    const sn = ev.target.closest('[data-llsnap]'); if (sn) { setLens(+sn.dataset.llsnap); sn.focus(); return say(X.panel.querySelector('#llOut')?.textContent || '') }
    if (ev.target.closest('[data-ll="reset"]')) { const p = find(R.p.id) || R.p; setLens(p.line); X.panel.querySelector('#llR')?.focus(); return say(X.panel.querySelector('#llOut')?.textContent || '') }
    const lw = ev.target.closest('[data-llwin]'); if (lw) { R.lensWin = lw.dataset.llwin; setLens(R.lens ?? (find(R.p.id) || R.p).line); return X.panel.querySelector(`[data-llwin="${R.lensWin}"]`)?.focus() }
    const tb = ev.target.closest('[data-rptab]'); if (tb) { R.tab = tb.dataset.rptab; redrawPanel(); return X.panel.querySelector(`[data-rptab="${R.tab}"]`)?.focus() }
    const a = ev.target.closest('[data-rp]')?.dataset.rp; if (!a) return; const p = find(R.p.id) || R.p;
    if (a === 'close') return closePanel();
    if (a === 'card') { const S = window.flPredictions?.slip; if (!S) return say('The Prediction Card did not load. Open Predictions and try again.'); S.toggle(p); redrawPanel(); X.panel.querySelector('[data-rp="card"]')?.focus(); return say(inCard(p) ? `Added ${p.name}, ${p.text}, to your Prediction Card.` : `Removed from your Prediction Card.`) }
    if (a === 'follow') { const F = window.flPredictions?.follow; if (!F) return say('Following did not load. Open Predictions and try again.'); F.toggle(p); if (followed(p)) { count(p, 'follow'); track('prediction_follow', { sport: p.sport }) } redrawPanel(); X.panel.querySelector('[data-rp="follow"]')?.focus(); return say(followed(p) ? `Following ${p.name}, ${p.text}.` : 'No longer following.') }
    if (a === 'board') return window.flBoards?.offer({ kind: 'player', key: `player:${p.sport}:${p.name}:${p.k}`, label: p.name, sub: p.text, photo: p.photo || '', line: p.line, side: p.side, start: p.start ? +p.start : null, mid: p.mid || p.id,
      open: { lab: { sport: p.sport, name: p.name, kind: 'player', stat: p.k, line: p.line, side: p.side } } }, ev.target.closest('button'));
    if (a === 'share') return share(p);
    // Compare, one player: this player and stat, two lines to start (the posted one and the next open one)
    if (a === 'compare') { const args = { sport: p.sport, a: p.name, who: 'one', one: 'lines', stat: p.k }; closePanel(); return window.flLab?.compare?.(args) }
    if (a === 'lab') { const args = { sport: p.sport, name: p.name, kind: 'player', stat: p.k, line: p.line, side: p.side }; closePanel(); return X.api?.openPlayer ? X.api.openPlayer(args) : window.flLab?.open(args) }
  });
  document.addEventListener('keydown', ev => {
    if (!X.panel) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return closePanel() }
    const lw = ev.target.closest?.('[data-llwin]'); if (lw && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); const all = [...lw.parentElement.querySelectorAll('[data-llwin]')], i = all.indexOf(lw), nx = all[(i + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]; R.lensWin = nx.dataset.llwin; setLens(R.lens ?? (find(R.p.id) || R.p).line); return X.panel.querySelector(`[data-llwin="${R.lensWin}"]`)?.focus() }
    const tb = ev.target.closest?.('[data-rptab]'); if (tb && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) { ev.preventDefault(); R.tab = R.tab === 'chart' ? 'log' : 'chart'; redrawPanel(); X.panel.querySelector(`[data-rptab="${R.tab}"]`)?.focus() }
  }, true);
  async function share(p) {
    // checked again before it is shared: a line that just closed is not passed on as open
    const st = window.flMarkets?.recheck ? (await window.flMarkets.recheck([{ mid: p.mid, sport: p.sport, name: p.name, k: p.k }]).catch(() => []))[0] : null;
    if (st && !st.open && st.status !== 'awaiting_verification') { say(`This line is no longer open: ${st.message || 'Market closed'}.`); return redrawPanel?.() }
    const url = new URL(location.href); url.hash = '#/lab'; url.search = '';
    url.searchParams.set('px', [p.sport, p.name, p.k, p.line, p.side].join('|'));
    const link = window.flRef?.link ? window.flRef.link(url.toString()) : url.toString(), text = `${p.name}: ${p.text}, ${startTxt(p)}. Research it on Floodlight.`;
    try { if (navigator.share) { await navigator.share({ title: `${p.name} · ${p.text}`, text, url: link }); return say('Shared.') } } catch (e) { if (e?.name === 'AbortError') return }
    try { await navigator.clipboard.writeText(link); say('Link copied.'); window.toast?.('Link copied') } catch (e) { say('Copy this link: ' + link) }
  }
  // a shared link (?px=sport|player|stat|line|side) opens the Lab on that player's research panel once the lines are in
  function fromLink() {
    const v = new URLSearchParams(location.search).get('px'); if (!v) return;
    const [sport, name, k, line, side] = v.split('|'); if (!sport || !name) return;
    const clean = () => { const u = new URL(location.href); u.searchParams.delete('px'); history.replaceState(history.state, '', u) };
    window.flLab?.open({ tool: 'props', sport });
    const tryOpen = n => { const r = X.rows?.find(r => r.p.sport === sport && r.p.name === name && (!k || r.p.k === k) && (line == null || String(r.p.line) === line) && (!side || r.p.side === side)) || X.rows?.find(r => r.p.sport === sport && r.p.name === name && (!k || r.p.k === k));
      if (r) { clean(); return openPanel(r.p.id) } if (X.rows && !X.loading) { clean(); return window.toast?.(`${name}’s line is no longer open.`) } if (n < 60) setTimeout(() => tryOpen(n + 1), 500) };
    tryOpen(0);
  }
  setTimeout(fromLink, 900);

  window.flPropX = { mount, open: openPanel, close: closePanel, load, rows: () => X.rows, state: X };
})();
