/* Floodlight · The Lab: the one research area.
   The page is a command bar, four tools, a workspace and saved boards. The workspace is the Lab itself (lab.html, the
   same page the Discord /lab command opens) for the sports it covers, and the older research engine (research.js)
   for everything else: tennis, college and minor leagues, two-player combos, the sportsbook prop board.
   Nothing here computes a number. It opens things, remembers them and passes the theme down. */
(() => {
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const LAB_SPORTS = new Set(['nba', 'wnba', 'nfl', 'nhl', 'mlb', 'soccer', 'ufc', 'boxing']);
  const SPORT_NAME = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer', ufc: 'UFC', boxing: 'Boxing', tennis: 'Tennis' };
  const TOOLS = [
    ['props', 'bars', 'Prop explorer', 'Every open, verified line, with filters and a research panel.'],
    ['compare', 'compare', 'Compare', 'Two players on one combined line.'],
    ['matchup', 'versus', 'Matchup', 'A team’s results, totals and the next game’s lines.'],
    ['trends', 'trend', 'Trends', 'The same games as a trend line, with the average.'],
  ];
  const L = { engine: null, tool: null, cur: null, ready: false, pending: null, loaded: false, q: '', hits: null, seq: 0, sel: -1, board: null, saving: false, confirm: null,
    boards: store.get('fl.labBoards', []), recent: store.get('fl.labRecent', []), picks: null, denied: false };
  const frame = () => $('labFrame');

  const can = f => { try { return window.flPlan?.can?.(f) ?? true } catch (e) { return true } };
  const track = (ev, o) => { try { window.flTrack?.(ev, o) } catch (e) {} };
  /* ---------- saved boards: archived ones step aside, the free plan keeps one board ---------- */
  const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // unique even for two boards made in the same millisecond
  const live = () => L.boards.filter(b => !b.archived);
  const roomForBoard = () => can('boards_unlimited') || live().length < 1;
  const LIMIT_TXT = 'The free plan keeps one board. Plus keeps as many as you like.';
  const limitSaid = other => { if (!L.limitHit) return other; L.limitHit = false; return `${esc(LIMIT_TXT)} <a href="#/pricing">See Plus</a>` };
  /* a saved line knows what it was saved at; these flags say when the market has moved on since */
  const num = n => (Math.round(n * 10) / 10).toString();
  function lineOf(v) {
    if (!v || v.line == null || !Number.isFinite(+v.line)) return null;
    const m = /^player:([^:]+):(.+):([^:]+)$/.exec(v.key || '');
    return { sport: v.sport || m?.[1], name: v.name || m?.[2] || v.label, k: v.k || m?.[3], line: +v.line, side: v.side || 'over', start: +v.start || null };
  }
  const ms = t => t == null || t === '' ? null : typeof t === 'number' ? t : new Date(t).getTime() || null;
  function flagOf(v, now = Date.now()) {
    const s = lineOf(v); if (!s) return null;
    if (s.start && s.start <= now) return { k: 'closed', t: 'Closed', d: 'The game has started, so this line is no longer open.' };
    const rows = window.flPropX?.rows?.() || L.picks, cur = rows?.find(p => p.sport === s.sport && p.name === s.name && p.k === s.k);
    if (rows?.length && !cur) return { k: 'gone', t: 'Not offered now', d: 'No provider in the verified feed has this line open right now.' };
    if (cur && cur.line != null && +cur.line !== s.line) { const easier = s.side === 'under' ? +cur.line > s.line : +cur.line < s.line;
      return { k: 'moved', t: `Line moved to ${num(cur.line)}`, d: `Saved at ${num(s.line)}. The ${s.side} is now ${easier ? 'easier' : 'harder'} to hit.` } }
    const st = s.start || ms(cur?.start);
    if (st && st - now < 6 * 3600e3) return { k: 'soon', t: `Closes in ${window.flLabCore?.countdown ? window.flLabCore.countdown(st - now) : Math.round((st - now) / 6e4) + ' min'}`, d: 'Lines close when the game starts.' };
    return null;
  }
  function flagSum(b) {
    const n = { moved: 0, closed: 0, gone: 0 }; for (const v of b.items || []) { const f = flagOf(v); if (f && f.k in n) n[f.k]++ }
    return [n.moved && `${n.moved} line${n.moved === 1 ? '' : 's'} moved`, n.closed && `${n.closed} closed`, n.gone && `${n.gone} not offered now`].filter(Boolean).join(', ');
  }
  const flagHtml = f => f ? `<small class="bd-fl f-${f.k}"><b>${esc(f.t)}.</b> ${esc(f.d)}</small>` : '';
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(name)}</span></span>`;
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago` };
  const fmt = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const denied = () => root.classList.contains('fl-noresearch');

  /* ---------- the page ---------- */
  function render(el) {
    if (denied()) { el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">The Lab</h1></div></header><div class="card emp">${ic('lab', 30)}<b>The Lab is switched off for your account</b><p>Your admin chooses which services each member can use. Ask them to switch the Lab on for you.</p></div>`; return }
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">The Lab</h1><p class="pg-sub">One place for every player, team and prop.</p></div></header>
      <section class="card feature lab-bar" aria-label="Ask the Lab">
        <div class="lab-cast" id="labCast" aria-hidden="true"></div>
        <div class="lab-ask" id="labBox">${ic('search', 22)}
          <input id="labAsk" type="search" role="combobox" aria-expanded="false" aria-haspopup="listbox" autocomplete="off" spellcheck="false" placeholder="Ask the Lab: a player, a team, a matchup or a prop" aria-label="Ask the Lab: a player, a team, a matchup or a prop" aria-autocomplete="list" aria-controls="labHits">
          <kbd class="lab-kbd" aria-hidden="true">${mac ? '⌘K' : 'Ctrl K'}</kbd></div>
        <div class="lab-hits" id="labHits" role="listbox" aria-label="Results" hidden></div>
        <div class="lab-try" id="labTry"></div>
      </section>
      <div class="g4 lab-tools" role="tablist" aria-label="Lab tools">${TOOLS.map(([k, icon, name, line], i) => `<button type="button" class="card hit lab-tool" role="tab" id="labTab-${k}" data-labtool="${k}" aria-selected="false" aria-controls="labWs" tabindex="${i ? -1 : 0}"><span class="lab-tool-i" aria-hidden="true">${ic(icon, 22)}</span><b>${name}</b><span>${line}</span></button>`).join('')}</div>
      <section class="lab-ws" id="labWs" aria-label="Workspace" hidden>
        <div class="lab-ws-h"><div class="lab-ws-t"><span class="lb" id="labWsK">Workspace</span><h2 id="labWsT" tabindex="-1"></h2></div>
          <div class="lab-ws-a" id="labWsA"></div></div>
        <div class="lab-views" id="labViews" hidden></div>
        <div class="lab-save" id="labSave" hidden></div>
        <div class="lab-frame" id="labFrameBox" hidden><div class="lab-skl" id="labSkl" role="status"><p class="lab-skl-t">${ic('lab', 18)}<span id="labSklT">Opening the workspace…</span></p><div class="skl" aria-hidden="true"></div><div class="skl" aria-hidden="true"></div><div class="skl" aria-hidden="true"></div></div>
          <iframe id="labFrame" title="The Lab workspace" scrolling="no" loading="eager"></iframe></div>
        <div class="lab-classic" id="labClassic" hidden></div>
        <div class="lab-toolws" id="labTool" hidden></div>
      </section>
      <section class="lab-start" id="labStart" aria-label="Start here"></section>
      <section class="lab-boards" id="labBoards" aria-label="Saved boards"></section>
      <section class="card lab-more" aria-label="More tools"><div class="sec-h"><h2>More tools</h2><span class="lb">Tennis, combos, sportsbook boards and more</span></div>
        <div class="cx-row">${[['tennis', 'Tennis players'], ['combo', 'Combo of two players'], ['book', 'Sportsbook prop board'], ['teamprops', 'Team props for today'], ['browse', 'Browse teams by league'], ['classic', 'College and minor leagues']].map(([k, l]) => `<button type="button" class="cx" data-labmore="${k}">${l}</button>`).join('')}</div></section>
      <p class="lb lab-note">Hit rates describe the past, not the next game. Bet only what you can afford to lose.</p>`;
    L.loaded = true; L.ready = false; L.engine = null;
    drawTry(); drawStart(); drawBoards(); loadPicks();
  }

  /* ---------- tonight's players: the example chips and the starters ---------- */
  function loadPicks() {
    if (!window.flEdge || L.loadingPicks) return; L.loadingPicks = true;
    const games = window.flHub?.games?.() || [];
    const today = [...new Set(games.filter(g => ['nba', 'nfl', 'nhl', 'mlb'].includes(String(g.lg)) || g.sport === 'soccer').sort((a, b) => b.weight - a.weight).map(g => g.sport === 'soccer' ? 'soccer' : g.lg))].slice(0, 3);
    // the same verified feed as Prop Explorer and Predictions, so "hottest" can't disagree with them
    (window.flMarkets?.list ? window.flMarkets.list({}).then(r => ({ picks: r.markets || [], denied: !!r.denied })) : window.flEdge.props(today.length ? today : ['nba', 'nfl'])).then(r => { L.picks = r.picks || []; L.denied = r.denied }).catch(() => { L.picks = [] }).finally(() => { L.loadingPicks = false; drawTry(); drawCast(); drawStart(); drawBoards(); quietRedraw() });
  }
  // the hot list: the verified feed decides who is hot (one rule for Home, the Lab and Prop Explorer)
  const hotList = n => window.flMarkets?.hot ? window.flMarkets.hot(n) : window.flEdge.hot(L.picks, n);
  function drawTry() {
    const box = $('labTry'); if (!box) return;
    const chips = [];
    for (const p of (L.picks ? hotList(2) : [])) chips.push([`${p.name} ${String(p.label).toLowerCase()}`, window.flEdge.labArgs(p)]);
    const games = (window.flHub?.games?.() || []).filter(g => g.state !== 'post' && ['nba', 'nfl', 'nhl', 'mlb'].includes(String(g.lg)) || g.sport === 'soccer' && g.state !== 'post').sort((a, b) => (b.state === 'in') - (a.state === 'in') || b.weight - a.weight).slice(0, 2);
    for (const g of games) chips.push([`${g.a.name} v ${g.b.name}`, { sport: g.sport === 'soccer' ? 'soccer' : g.lg, name: g.a.full || g.a.name, team: true }]);
    if (chips.length) chips.push(['Compare two players', { tool: 'compare' }]);
    box.innerHTML = chips.length ? `<span class="lb">Try</span>${chips.slice(0, 5).map(([l, a]) => `<button type="button" class="cx sm" data-labopen="${esc(JSON.stringify(a))}">${esc(l)}</button>`).join('')}` : '';
  }
  /* tonight's three hottest players, as a picture behind the bar. Decoration only: pages.css decides whether it shows (Stadium Gold does) */
  function drawCast() {
    const box = $('labCast'); if (!box) return;
    const faces = [...new Set((L.picks ? hotList(8) : []).map(p => p.photo).filter(Boolean))].slice(0, 3), key = faces.join('|');
    if (box.dataset.k === key) return; box.dataset.k = key;
    box.innerHTML = faces.map(src => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`).join('');
  }
  function drawStart() {
    const box = $('labStart'); if (!box) return;
    if (L.engine && L.engine !== 'compare') { box.hidden = true; return } box.hidden = false;
    const cmp = L.engine === 'compare';
    // in Compare, any player with a line today can be dragged in, so the list isn't limited to the hot ones
    const hot = L.picks ? (cmp ? window.flEdge.players(L.picks).sort((a, b) => Math.abs(b.heat - 50) - Math.abs(a.heat - 50)).slice(0, 9) : hotList(6)) : null;
    box.innerHTML = `<div class="sec-h"><h2>${cmp ? 'Add a player to Compare' : 'Start with tonight’s hottest'}</h2>${hot?.length ? `<span class="lb">${cmp ? 'Drag a card onto a slot, or select it to fill the next empty one' : 'Players with a line posted today'}</span>` : ''}</div>` +
      (hot == null ? `<div class="g3">${'<div class="skl lab-card-skl"></div>'.repeat(6)}</div>`
        : hot.length ? `<div class="g3">${hot.map(p => `<button type="button" class="card hit lab-starter" data-labopen="${esc(JSON.stringify(window.flEdge.labArgs(p)))}" draggable="true" data-cmpdrag="${esc(JSON.stringify({ sport: p.sport, name: p.name, stat: p.k }))}">${face(p.photo, p.name, 'avx av-lg')}<span class="rw-t"><b>${esc(p.name)}</b><small>${[p.fid || p.team ? (window.flPlayers ? window.flPlayers.span(p.fid, p.teamName || p.team) : esc(p.teamName || p.team || '')) : '', esc(SPORT_NAME[p.sport] || '')].filter(Boolean).join(' · ')}</small><small>${esc(p.text)}</small></span>${window.flHeat.badge(p.heat)}</button>`).join('')}</div>`
        : `<div class="card emp">${ic('lab', 28)}<b>${L.denied ? 'The Lab is switched off for your account' : 'No open line reads hot right now'}</b><p>${L.denied ? 'Ask your admin to switch it on.' : `A line is hot when Floodlight’s chance for it is 60% or more. ${L.picks.length ? `None of the ${L.picks.length} open lines does yet; Prop Explorer lists them all with their recent hit rates.` : 'No player lines are open yet.'}`}</p>${!L.denied && L.picks.length ? '<button type="button" class="bt" data-labtool="props">Open Prop Explorer</button>' : ''}</div>`);
  }

  /* ---------- the command bar ---------- */
  const ESPN_SEARCH = 'https://site.api.espn.com/apis/common/v3/search';
  const fetchJSON = url => (typeof cj === 'function' ? cj(url) : fetch(url).then(r => r.json()));
  const LEAGUE_LAB = { nba: 'nba', wnba: 'wnba', nfl: 'nfl', nhl: 'nhl', mlb: 'mlb', ufc: 'ufc' };
  const CLASSIC_SPORT = { basketball: 'nba', football: 'nfl', hockey: 'nhl', baseball: 'mlb', soccer: 'soccer', tennis: 'tennis' };
  const SPORT_CHIP = { basketball: 'basketball', football: 'football', hockey: 'hockey', baseball: 'baseball', soccer: 'soccer', tennis: 'tennis', mma: 'ufc', boxing: 'boxing' };
  function argsFor(x, kind) {   // an ESPN search result -> what to open
    const lg = x.league || x.defaultLeagueSlug || '', sp = x.sport || '';
    const lab = sp === 'soccer' ? 'soccer' : sp === 'mma' ? 'ufc' : sp === 'boxing' ? 'boxing' : LEAGUE_LAB[lg];
    if (lab && !(kind === 'team' && (lab === 'ufc' || lab === 'boxing'))) return { sport: lab, name: x.displayName, team: kind === 'team' };
    if (CLASSIC_SPORT[sp]) return { classic: true, sport: CLASSIC_SPORT[sp], id: x.id, lg, name: x.displayName, kind: kind === 'team' ? 'team' : undefined, photo: x.headshot?.href || x.logos?.[0]?.href || '', team: kind === 'team' ? undefined : (x.teamRelationships?.[0]?.displayName || '') };
    return null;
  }
  async function search(q) {
    const seq = ++L.seq; q = q.trim(); L.q = q;
    if (q.length < 2) { L.hits = null; return drawHits() }
    L.hits = { loading: true, groups: [] }; drawHits();
    let bad = 0; const E = type => fetchJSON(`${ESPN_SEARCH}?query=${encodeURIComponent(q)}&type=${type}&limit=8`).then(d => d.items || []).catch(() => { bad++; return [] });
    const tn = fetch(`/api/tn/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    const [P, T, G, TN] = await Promise.all([E('player'), E('team'), E('league'), tn]);
    if (seq !== L.seq) return;
    const LG = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', ufc: 'UFC', 'mens-college-basketball': 'Men\'s college basketball', 'womens-college-basketball': 'Women\'s college basketball', 'college-football': 'College football', 'college-baseball': 'College baseball' };
    const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    const lgName = x => { const k = String(x.league || x.defaultLeagueSlug || ''); return LG[k] || (/\./.test(k) || !k ? cap(String(x.sport || '')) : cap(k.replace(/-/g, ' '))) };
    const ql = q.toLowerCase();
    const players = P.map(x => ({ label: x.displayName, sub: [x.teamRelationships?.[0]?.displayName, lgName(x)].filter(Boolean).join(' · '), img: x.headshot?.href || '', args: argsFor(x, 'player') })).filter(x => x.args).slice(0, 6);
    for (const x of (TN.players || []).slice(0, 3)) players.push({ label: x.name, sub: [x.country, 'Tennis'].filter(Boolean).join(' · '), img: x.img || '', args: { classic: true, sport: 'tennis', tnId: x.id, slug: x.slug, name: x.name, photo: x.img || '' } });
    const teams = T.map(x => ({ label: x.displayName, sub: lgName(x), img: x.logos?.[0]?.href || '', crest: true, args: argsFor(x, 'team') })).filter(x => x.args).slice(0, 5);
    const leagues = G.map(x => ({ label: x.displayName || x.name, sub: x.sport === 'mma' ? 'MMA' : cap(String(x.sport || '')), img: x.logos?.[0]?.href || '', crest: true, args: SPORT_CHIP[x.sport] ? { go: SPORT_CHIP[x.sport] } : null })).filter(x => x.args && x.label).slice(0, 4);
    const props = (window.flEdge?.all() || []).filter(p => `${p.name} ${p.label} ${p.team}`.toLowerCase().includes(ql)).slice(0, 5).map(p => ({ label: `${p.name}: ${p.text}`, sub: [p.game, SPORT_NAME[p.sport]].filter(Boolean).join(' · '), img: p.photo, heat: p.heat, args: window.flEdge.labArgs(p) }));
    L.hits = { loading: false, groups: [['Players', players], ['Teams', teams], ['Leagues', leagues], ['Props', props]].filter(g => g[1].length) }; L.sel = -1; drawHits();
    // one search counted per pause in typing, for the owner dashboard (analytics.js)
    clearTimeout(L.trackT); const empty = !L.hits.groups.length; L.trackT = setTimeout(() => { if (seq === L.seq) track('search', { kind: 'lab', empty, failed: bad === 3 }) }, 1500);
  }
  const flat = () => (L.hits?.groups || []).flatMap(g => g[1]);
  function drawHits() {
    const box = $('labHits'), cb = $('labAsk'); if (!box) return;
    const h = L.hits; box.hidden = !h; cb.setAttribute('aria-expanded', String(!!h));
    if (!h) { $('labAsk').removeAttribute('aria-activedescendant'); return }
    let i = 0;
    box.innerHTML = h.loading ? `<div class="lab-hl" aria-hidden="true">${'<div class="skl"></div>'.repeat(3)}</div><p class="sr-only" role="status">Searching</p>`
      : !h.groups.length ? `<div class="emp lab-hn"><b>Nothing matches “${esc(L.q)}”</b><p>Check the spelling, or press Enter to look that name up in ${esc(SPORT_NAME[store.get('lab.sport', 'nba')] || 'the Lab')}.</p></div>`
      : h.groups.map(([name, rows]) => `<div class="lab-hg" role="group" aria-label="${name}"><span class="lb">${name}</span>${rows.map(r => { const k = i++; return `<button type="button" class="rw lab-h${k === L.sel ? ' on' : ''}" role="option" id="labH${k}" aria-selected="${k === L.sel}" data-labhit="${k}" tabindex="-1">${face(r.img, r.label, r.crest ? 'avx crest' : 'avx')}<span class="rw-t"><b>${esc(r.label)}</b><small>${esc(r.sub || '')}</small></span>${r.heat != null ? window.flHeat.badge(r.heat, { short: true }) : ''}</button>` }).join('')}</div>`).join('');
    const a = $('labAsk'); if (L.sel >= 0) a.setAttribute('aria-activedescendant', 'labH' + L.sel); else a.removeAttribute('aria-activedescendant');
    $('labH' + L.sel)?.scrollIntoView({ block: 'nearest' });
  }
  function closeHits() { L.hits = null; L.sel = -1; drawHits() }
  let typeT = 0;
  document.addEventListener('input', ev => { if (ev.target.id !== 'labAsk') return; clearTimeout(typeT); const v = ev.target.value; typeT = setTimeout(() => search(v), 220) });
  document.addEventListener('keydown', ev => {
    if (ev.target.id !== 'labAsk') return;
    const all = flat();
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { if (!all.length) return; ev.preventDefault(); L.sel = ev.key === 'ArrowDown' ? (L.sel + 1) % all.length : (L.sel - 1 + all.length) % all.length; return drawHits() }
    if (ev.key === 'Escape' && L.hits) { ev.preventDefault(); ev.stopPropagation(); return closeHits() }
    if (ev.key === 'Enter') { ev.preventDefault(); const pick = all[L.sel >= 0 ? L.sel : 0]; const q = ev.target.value.trim();
      if (pick) return choose(pick); if (q) { closeHits(); return open({ sport: store.get('lab.sport', 'nba'), name: q }) } }
  });
  function choose(hit) {
    closeHits(); const a = $('labAsk'); if (a) a.value = '';
    if (hit.args.go) { window.flPages.hide(); return document.querySelector(`.tbs[data-sport="${hit.args.go}"]`)?.click() }
    open(hit.args);
  }

  /* ---------- opening things ---------- */
  function remember(label, args) {
    L.recent = [{ label, args, at: Date.now() }, ...L.recent.filter(r => r.label !== label)].slice(0, 8); store.set('fl.labRecent', L.recent);
  }
  function show() { if (window.flPages.current() !== 'lab') window.flPages.show('lab'); return !!$('labWs') }
  function setEngine(e) {
    L.engine = e; const ws = $('labWs'); if (!ws) return;
    ws.hidden = !e; $('labFrameBox').hidden = e !== 'lab'; $('labClassic').hidden = e !== 'classic'; $('labTool').hidden = !['compare', 'trends', 'props'].includes(e);
    if (e !== 'classic') { try { typeof closeResearch === 'function' && S.rs.open && closeResearch() } catch (x) {} }
    drawStart(); drawHead();
  }
  /* The four tools are tabs: one workspace below them, and only one tool in it at a time. With a player or team open
     from search, no tab is selected and the workspace is a plain region named "Workspace". Arrow keys move between tabs. */
  function tool(k) {
    L.tool = k; const tabs = [...document.querySelectorAll('.lab-tool')], ws = $('labWs');
    tabs.forEach((b, i) => { const on = b.dataset.labtool === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on || (!k && i === 0) ? 0 : -1 });
    if (!ws) return;
    if (k && tabs.some(b => b.dataset.labtool === k)) { ws.setAttribute('role', 'tabpanel'); ws.setAttribute('aria-labelledby', 'labTab-' + k); ws.removeAttribute('aria-label') }
    else { ws.removeAttribute('role'); ws.removeAttribute('aria-labelledby'); ws.setAttribute('aria-label', 'Workspace') }
  }
  document.addEventListener('keydown', ev => {
    const b = ev.target.closest?.('.lab-tool[role="tab"]'); if (!b) return;
    const tabs = [...document.querySelectorAll('.lab-tool[role="tab"]')], i = tabs.indexOf(b);
    const j = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? (i + 1) % tabs.length : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? (i - 1 + tabs.length) % tabs.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return; ev.preventDefault(); tabs[j].focus(); L.kbTab = true; runTool(tabs[j].dataset.labtool);
    setTimeout(() => { L.kbTab = false; if (document.activeElement !== tabs[j]) tabs[j].focus({ preventScroll: true }) }, 150);   // the tab keeps focus; the tool opened below it
  });
  /* o: { sport, name | player, team (true for a team), stat, line, side, tab, mode } and, for the older engine, { classic, id, lg, tnId, ... } */
  function open(o = {}) {
    if (denied()) { window.flPages.show('lab'); return }
    if (!show()) return;
    if (o.q != null && !o.name && !o.player) { const a = $('labAsk'); a.value = o.q; a.focus(); if (o.q) search(o.q); return }
    if (o.tool) return runTool(o.tool, o);
    const name = o.name || o.player || '', sport = o.sport || (name ? store.get('lab.sport', 'nba') : '');
    if (name && o.kind !== 'team') track('player_open', { sport, player: name });
    if (!name && !o.tab && !o.id && !o.fmId && !o.tnId && !o.fsId && !o.fsTeam && !o.classic) return;   // just the page
    const useLab = !o.classic && LAB_SPORTS.has(sport) && (name || !(o.id || o.fmId));
    if (useLab) return openLab({ sport, name, kind: o.team === true || o.kind === 'team' ? 'team' : 'player', stat: o.stat || '', line: o.line, side: o.side, tab: o.tab, mode: o.mode });
    openClassic({ ...o, sport: sport || o.sport, name });
  }
  function openLab(m, keepBoard) {
    if (m.tab === 'board') return openTools('props', { sport: m.sport });   // the prop board is Prop Explorer, on the verified feed
    if (!keepBoard) { L.board = null }
    setEngine('lab'); tool(m.tab === 'board' ? 'props' : m.kind === 'team' ? 'matchup' : m.mode === 'trend' ? 'trends' : null);
    const f = frame(); L.cur = null; drawHead(m.name || (m.tab === 'board' ? 'Prop explorer' : ''));
    if (L.ready && f.contentWindow) f.contentWindow.postMessage({ flLab: m }, location.origin);
    else { L.pending = null; $('labSkl').hidden = false; $('labSklT').textContent = m.name ? `Loading ${m.name}…` : m.tab === 'board' ? 'Loading the prop explorer…' : 'Opening the workspace…';
      const q = new URLSearchParams({ embed: 'page', theme: root.dataset.theme || 'night-match' });
      if (m.sport) q.set('sport', m.sport); if (m.name) q.set(m.kind === 'team' ? 'team' : 'player', m.name); if (m.stat) q.set('stat', m.stat);
      if (m.line != null && m.line !== '' && !isNaN(m.line)) q.set('line', m.line); if (m.side) q.set('side', m.side); if (m.tab) q.set('tab', m.tab); if (m.mode) q.set('mode', m.mode);
      f.src = '/lab?' + q }
    focusWs();
  }
  function openClassic(o) {
    L.board = null; setEngine('classic'); tool(o.compare ? 'compare' : null);
    const host = $('labClassic');
    try { const el = rsEl(); if (el.parentElement !== host) host.appendChild(el); el.classList.add('rs-inpage'); openResearch({ ...o, _in: true, classic: true }) } catch (e) { host.innerHTML = `<div class="card emp"><b>That tool did not open</b><p>Reload the page and try again.</p></div>` }
    L.hint = o.compare ? (o.name ? 'Compare · search the second player' : 'Compare · search the first player, then choose Combo') : '';
    drawHead(o.compare ? (o.name ? `${o.name} and another player` : 'Compare two players') : o.name || (o.tab === 'board' ? 'Sportsbook prop board' : o.tab === 'team' ? 'Team props' : o.sport === 'tennis' ? 'Tennis' : 'More tools'));
    focusWs();
  }
  function focusWs() { const ws = $('labWs'); if (!ws || L.kbTab) return; setTimeout(() => { ws.scrollIntoView({ behavior: root.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' }); $('labWsT')?.focus({ preventScroll: true }) }, 60) }
  function runTool(k, o = {}) {
    const c = L.cur, sport = c?.sport || store.get('lab.sport', 'nba');
    if (k === 'props') return openTools('props', { sport: o.sport || (c?.sport && L.engine === 'lab' ? c.sport : '') });
    if (k === 'trends') return c?.view === 'player' && L.engine === 'lab' ? openLab({ sport: c.sport, name: c.name, kind: 'player', stat: c.k, line: c.line, side: c.side, mode: 'trend' }, true) : openTools('trends', {});
    if (k === 'matchup') { const g = (window.flHub?.games?.() || []).filter(g => g.state !== 'post' && (['nba', 'nfl', 'nhl', 'mlb'].includes(String(g.lg)) || g.sport === 'soccer')).sort((a, b) => (b.state === 'in') - (a.state === 'in') || b.weight - a.weight)[0];
      return c?.view === 'team' ? openLab({ sport: c.sport, name: c.name, kind: 'team' }, true) : g ? openLab({ sport: g.sport === 'soccer' ? 'soccer' : g.lg, name: g.a.full || g.a.name, kind: 'team' }) : openLab({ sport, tab: 'team' }) }
    if (k === 'compare') return c?.view === 'player' && L.engine === 'lab' ? openTools('compare', { sport: c.sport, name: c.name, stat: c.k }) : openTools('compare', {});
  }
  // Compare and Trends: their own tools in the workspace (labtools.js)
  function openTools(k, o) {
    L.board = null; L.cur = null; L.saving = false; setEngine(k); tool(k);
    const host = $('labTool'), api = { openPlayer: a => openLab({ kind: 'player', ...a, name: a.name || a.player }) };
    drawHead(k === 'props' ? 'Prop explorer' : k === 'compare' ? (o.name ? `${o.name} and another player` : 'Compare two players') : 'Trends on today’s lines');
    const lib = k === 'props' ? window.flPropX && { props: window.flPropX.mount } : window.flLabTools;
    if (!lib) host.innerHTML = `<div class="card emp"><b>That tool did not load</b><p>Reload the page and try again.</p></div>`;
    else lib[k](host, o, api);
    if (k === 'trends' || k === 'props' || o.name) focusWs(); else { const ws = $('labWs'); setTimeout(() => ws?.scrollIntoView({ behavior: root.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' }), 60) }
  }
  function more(k) {
    if (k === 'tennis') return openClassic({ sport: 'tennis', tab: 'player' });
    if (k === 'combo') return openTools('compare', {});
    if (k === 'book') return openClassic({ tab: 'board' });
    if (k === 'teamprops') return openClassic({ tab: 'team' });
    if (k === 'browse') { openClassic({ tab: 'player' }); try { S.rs.browse = { ...(S.rs.browse || {}), open: true, sport: S.rs.sport }; document.querySelector('#rs [data-rs="browse"]')?.click() } catch (e) {} return }
    openClassic({ tab: 'player' });
  }

  /* ---------- the workspace heading, saving, boards ---------- */
  const viewLabel = v => v.kind ? v.label : v.view === 'board' ? `${SPORT_NAME[v.sport] || ''} prop explorer` : v.view === 'team' ? `${v.name}${v.label ? ' · ' + v.label : ''}` : `${v.name} · ${v.yes ? v.label : `${v.side === 'under' ? 'Under' : 'Over'} ${fmt(v.line)} ${String(v.label || '').toLowerCase()}`}`;
  const viewKey = v => v.kind ? v.key : [v.view, v.sport, v.name || '', v.k || '', v.line ?? '', v.side || ''].join('|');
  // what a saved thing is, in a word, and the second line under it
  const KIND_WORD = { player: 'player', team: 'team', compare: 'comparison', trend: 'trend', pred: 'prediction', parlay: 'parlay', game: 'game', filters: 'filters', props: 'prop explorer', note: 'note' };
  const kindOf = v => v.kind || (v.view === 'board' ? 'props' : v.view === 'team' ? 'team' : 'player');
  const subOf = v => v.kind ? [v.sub, KIND_WORD[v.kind]].filter(Boolean).join(' · ') : `${SPORT_NAME[v.sport] || v.sport || ''}${v.view === 'team' ? ' · team' : v.view === 'board' ? ' · prop explorer' : ' · player prop'}`;
  const canSave = () => L.engine === 'lab' && L.cur && ['player', 'team', 'board'].includes(L.cur.view);
  function drawHead(title) {
    const t = $('labWsT'); if (!t) return;
    const c = L.cur, b = L.board ? L.boards.find(x => x.id === L.board) : null;
    if (title != null) t.textContent = title; else if (L.engine === 'lab' && c) t.textContent = c.view === 'board' ? 'Prop explorer' : c.view === 'home' ? (c.tab === 'team' ? 'Pick a team' : 'Pick a player') : c.name;
    $('labWsK').textContent = b ? `Board: ${b.name}` : L.engine === 'classic' ? (L.hint || 'More tools') : L.engine === 'props' ? 'Open lines' : L.engine === 'compare' ? 'Compare' : L.engine === 'trends' ? 'Trends' : c?.sport ? `Workspace · ${SPORT_NAME[c.sport] || ''}` : 'Workspace';
    $('labWsA').innerHTML = `${canSave() ? `<button type="button" class="bt ghost" data-lab="save" aria-expanded="${L.saving}">${ic('save', 18)}Save to a board</button>` : ''}<button type="button" class="ib" data-lab="closews" aria-label="Close the workspace">${ic('x', 18)}</button>`;
    const vs = $('labViews'); vs.hidden = !b;
    if (b) vs.innerHTML = `<span class="lb">In this board</span><div class="cx-row scroll">${b.items.map((v, i) => `<span class="lab-view"><button type="button" class="cx sm${!!c && viewKey(c) === viewKey(v) ? " on" : ""}"${!!c && viewKey(c) === viewKey(v) ? " aria-current=\"true\"" : ""} data-labview="${i}">${esc(viewLabel(v))}</button><button type="button" class="lab-rm" data-labrm="${i}" aria-label="Remove ${esc(viewLabel(v))} from this board">${ic('x', 14)}</button></span>`).join('')}</div>`;
    drawSave();
  }
  function drawSave() {
    const box = $('labSave'); if (!box) return; box.hidden = !L.saving || !canSave(); if (box.hidden) return;
    const c = L.cur, b = L.board ? L.boards.find(x => x.id === L.board) : null;
    box.innerHTML = `<form class="lab-save-f tile" id="labSaveF"><label class="fl-f" for="labSaveN">Board name</label>
      <div class="lab-save-r"><input class="inp" id="labSaveN" maxlength="40" list="labSaveL" value="${esc(b ? b.name : '')}" placeholder="For example: Tonight’s points" autocomplete="off" required><datalist id="labSaveL">${live().map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
        <button class="bt" type="submit">Save this view</button><button class="bt ghost" type="button" data-lab="cancelsave">Cancel</button></div>
      <p class="lb" id="labSaveNote" role="status">Saving “${esc(viewLabel(c))}”. Type an existing board’s name to add this view to it.</p></form>`;
  }
  function saveBoards(note) {
    store.set('fl.labBoards', L.boards);
    try { if (S.me && typeof api === 'function') api('/api/me/prefs', { boards: L.boards.slice(0, 30) }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
    reshare(); drawBoards(); drawBoardsPage(); if (note) say(note);
  }
  function say(t) { const a = $('announce'); if (a) { a.textContent = ''; setTimeout(() => { a.textContent = t }, 30) } }
  function saveView(name) {
    const c = L.cur; if (!canSave()) return;
    const v = { view: c.view, sport: c.sport, name: c.name || '', k: c.k || '', label: c.label || '', line: c.line ?? null, side: c.side || 'over', yes: !!c.yes, photo: c.photo || '', at: Date.now() };
    name = name.trim().slice(0, 40); if (!name) return;
    const b = L.boards.find(x => x.name.toLowerCase() === name.toLowerCase()) || makeBoard(name, true);
    if (!b) { L.saving = false; drawHead(); return say(LIMIT_TXT) }
    b.items = [v, ...b.items.filter(x => viewKey(x) !== viewKey(v))].slice(0, 24); b.at = Date.now();
    L.board = b.id; L.saving = false;
    saveBoards(`Saved to ${b.name}. ${b.items.length} view${b.items.length === 1 ? '' : 's'} in this board.`); drawHead();
  }
  function openView(b, i) { const v = b.items[i]; if (!v) return;
    if (v.kind) { if (v.kind === 'note') return; return window.flRecent?.open(v) }
    L.board = b.id;
    openLab(v.view === 'board' ? { sport: v.sport, tab: 'board' } : { sport: v.sport, name: v.name, kind: v.view === 'team' ? 'team' : 'player', stat: v.k, line: v.line, side: v.side }, true) }
  function drawBoards() {
    const box = $('labBoards'); if (!box) return;
    const all = live(), list = L.allBoards ? all : all.slice(0, 3);
    box.innerHTML = `<div class="sec-h"><h2>Saved boards</h2>${all.length ? `<button type="button" class="lk" data-page="boards">${all.length > 3 ? `All ${all.length} boards` : 'Manage boards'}</button>` : ''}</div>` +
      (!all.length ? `<div class="card emp">${ic('save', 28)}<b>No boards yet</b><p>Open a player, a team or the prop explorer, then choose “Save to a board” to keep that view. Boards are saved ${hasAccount() ? 'to your account' : 'in this browser'}.</p></div>`
        : `<div class="g3">${list.map(b => L.confirm === b.id
          ? `<div class="card lab-board" role="group" aria-label="Delete ${esc(b.name)}"><span class="lb">Delete this board?</span><b>${esc(b.name)}</b><span class="lb">Its ${b.items.length} saved view${b.items.length === 1 ? '' : 's'} will be gone. This cannot be undone.</span><div class="lab-board-a"><button type="button" class="bt danger sm" data-labdel="${b.id}">Delete board</button><button type="button" class="bt ghost sm" data-lab="keep">Keep it</button></div></div>`
          : `<div class="card hit lab-board"><button type="button" class="lab-board-o" data-labboard="${b.id}" aria-label="Open the board ${esc(b.name)}"></button><span class="lb">Saved board</span><b>${esc(b.name)}</b><span class="lb">${b.items.length} saved · updated ${ago(b.at)}</span>${flagSum(b) ? `<span class="bd-fsum">${esc(flagSum(b))}</span>` : ''}
              <span class="lab-board-f">${b.items.filter(v => kindOf(v) !== 'note').slice(0, 4).map(v => face(v.photo, v.name || v.label || SPORT_NAME[v.sport], 'avx av-sm')).join('')}</span><button type="button" class="ib lab-board-x" data-labask="${b.id}" aria-label="Delete the board ${esc(b.name)}">${ic('x', 16)}</button></div>`).join('')}</div>`);
  }
  const hasAccount = () => { try { return !!S.me } catch (e) { return false } };
  // boards follow the account: on sign-in, merge what the account has with what this browser has (newest copy of each wins)
  // a board deleted on this browser stays deleted when the account's older copy comes back (ids kept for 60 days)
  const gone = () => store.get('fl.labBoardsGone', []).filter(g => Date.now() - g.at < 60 * 864e5);
  document.addEventListener('fl:me', () => { try { const mine = S.me?.prefs?.boards; if (Array.isArray(mine) && mine.length) { const by = new Map(), dead = new Set(gone().map(g => g.id)); for (const b of [...mine, ...L.boards]) { const o = by.get(b.id); if (!o || (b.at || 0) > (o.at || 0)) by.set(b.id, b) }
    const merged = [...by.values()].filter(b => b && b.id && Array.isArray(b.items) && !dead.has(b.id)), differs = JSON.stringify(merged) !== JSON.stringify(mine);
    L.boards = merged; store.set('fl.labBoards', L.boards); if (differs) saveBoards() } else if (S.me && L.boards.length) saveBoards() } catch (e) {} drawBoards(); drawBoardsPage(); if (L.loaded && window.flPages.current() === 'lab') window.flPages.redraw('lab') });

  /* ---------- what the workspace says back ---------- */
  addEventListener('message', ev => {
    const f = frame(); if (!f || ev.origin !== location.origin || ev.source !== f.contentWindow || !ev.data) return;
    const d = ev.data;
    if (d.lab === 'height') { f.style.height = Math.max(320, d.h + 8) + 'px'; $('labSkl').hidden = true; if (!scrollF) scrollF = requestAnimationFrame(tellScroll) }
    if (d.lab === 'ready') { L.ready = true; f.contentWindow.postMessage({ flTheme: root.dataset.theme, flMotion: root.dataset.motion || '' }, location.origin) }
    if (d.lab === 'scrollTo') { const r = f.getBoundingClientRect(); window.scrollTo({ top: Math.max(0, scrollY + r.top + (+d.y || 0) - siteTop()), behavior: root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return }
    if (d.lab === 'loaded') remember(d.name, { sport: d.sport, name: d.name, team: d.kind === 'team' });
    if (d.lab === 'state' && (d.view === 'player' || d.view === 'team') && d.name) window.flRecent?.note({ kind: d.view, key: `${d.view}:${d.sport}:${d.name}${d.view === 'player' && d.k ? ':' + d.k : ''}`, label: d.name,
      sub: d.view === 'player' && d.k ? (d.yes ? d.label : `${d.side === 'under' ? 'Under' : 'Over'} ${fmt(d.line)} ${String(d.label || '').toLowerCase()}`) : `${SPORT_NAME[d.sport] || ''} team`, photo: d.photo || '',
      open: { lab: { sport: d.sport, name: d.name, kind: d.view, ...(d.view === 'player' ? { stat: d.k, line: d.line, side: d.side } : {}) } } });
    if (d.lab === 'state') { L.cur = d; if (d.view !== 'player' && d.view !== 'team' && d.view !== 'board') L.saving = false;
      tool(d.view === 'board' ? 'props' : d.view === 'team' ? 'matchup' : L.tool === 'trends' && d.view === 'player' ? 'trends' : null); drawHead() }
  });
  /* The frame doesn't scroll; this page does. Tell the frame where its visible top is (below the site's bar), so the
     Lab's own section bar can follow the reader down a long player or team page. */
  function siteTop() {   // the bottom of whatever stays pinned at the top of the site
    let el = document.querySelector('.tb-brand'), h = 0;
    while (el && el !== document.body) { const p = getComputedStyle(el).position; if (p === 'fixed' || p === 'sticky') { h = Math.max(0, el.getBoundingClientRect().bottom); break } el = el.parentElement }
    return h;
  }
  let scrollF = 0;
  const tellScroll = () => { scrollF = 0; const f = $('labFrame'); if (!f || !L.ready || L.engine !== 'lab' || $('labFrameBox')?.hidden) return;
    try { f.contentWindow.postMessage({ flScroll: Math.round(siteTop() - f.getBoundingClientRect().top) }, location.origin) } catch (e) {} };
  addEventListener('scroll', () => { if (!scrollF) scrollF = requestAnimationFrame(tellScroll) }, { passive: true });
  addEventListener('resize', () => { if (!scrollF) scrollF = requestAnimationFrame(tellScroll) });
  document.addEventListener('fl:theme', () => { const f = frame(); if (L.ready && f?.contentWindow) f.contentWindow.postMessage({ flTheme: root.dataset.theme, flMotion: root.dataset.motion || '' }, location.origin) });
  // the feed changed: read what is open now from it (no new request, and never on its own 'load' notice, which list() sends)
  document.addEventListener('fl:markets', ev => { if (ev.detail?.reason === 'load' || !window.flMarkets?.open || L.picks == null) return; L.picks = window.flMarkets.open(); if (L.loaded && window.flPages.current() === 'lab') { drawTry(); drawCast(); drawStart() } drawBoards(); quietRedraw() });
  document.addEventListener('fl:hub', () => { if (L.loaded && window.flPages.current() === 'lab') { drawTry(); if (L.picks == null) loadPicks() } });

  /* ---------- clicks ---------- */
  document.addEventListener('click', ev => {
    const pg = $('pg-lab'); if (!pg || pg.hidden) return;
    const t = ev.target;
    if (L.hits && !t.closest('.lab-bar')) closeHits();
    if (!pg.contains(t)) return;
    const hit = t.closest('[data-labhit]'); if (hit) return choose(flat()[+hit.dataset.labhit]);
    const o = t.closest('[data-labopen]'); if (o) { if (L.engine === 'compare' && o.dataset.cmpdrag && window.flLabTools) { try { return window.flLabTools.add(JSON.parse(o.dataset.cmpdrag)) } catch (e) {} } let a = {}; try { a = JSON.parse(o.dataset.labopen) } catch (e) {} return open(a) }
    const tl = t.closest('[data-labtool]'); if (tl) return runTool(tl.dataset.labtool);
    const mr = t.closest('[data-labmore]'); if (mr) return more(mr.dataset.labmore);
    const bd = t.closest('[data-labboard]'); if (bd) { const b = L.boards.find(x => x.id === bd.dataset.labboard); return b && openView(b, 0) }
    const vw = t.closest('[data-labview]'); if (vw) { const b = L.boards.find(x => x.id === L.board); return b && openView(b, +vw.dataset.labview) }
    const rm = t.closest('[data-labrm]'); if (rm) { const b = L.boards.find(x => x.id === L.board); if (!b) return; const gone = b.items.splice(+rm.dataset.labrm, 1)[0]; b.at = Date.now(); saveBoards(`Removed ${viewLabel(gone)} from ${b.name}.`); return drawHead() }
    const ask = t.closest('[data-labask]'); if (ask) { L.confirm = ask.dataset.labask; drawBoards(); return $('labBoards').querySelector('[data-labdel]')?.focus() }
    const del = t.closest('[data-labdel]'); if (del) { deleteBoard(del.dataset.labdel); return drawHead() }
    const a = t.closest('[data-lab]')?.dataset.lab; if (!a) return;
    if (a === 'save') { L.saving = !L.saving; drawHead(); return L.saving && $('labSaveN')?.focus() }
    if (a === 'cancelsave') { L.saving = false; drawHead(); return pg.querySelector('[data-lab="save"]')?.focus() }
    if (a === 'keep') { L.confirm = null; return drawBoards() }
    if (a === 'allboards') { L.allBoards = !L.allBoards; return drawBoards() }
    if (a === 'closews') { L.board = null; L.cur = null; L.saving = false; tool(null); setEngine(null); return $('labAsk')?.focus() }
  });
  document.addEventListener('submit', ev => { if (ev.target.id !== 'labSaveF') return; ev.preventDefault(); saveView($('labSaveN').value) });

  function deleteBoard(id) {
    const b = L.boards.find(x => x.id === id); if (b?.share && typeof api === 'function') api('/api/boards/unshare', { id: b.share }).catch(() => {}); L.boards = L.boards.filter(x => x.id !== id); store.set('fl.labBoardsGone', [...gone(), { id, at: Date.now() }].slice(-100));
    if (L.board === id) L.board = null; L.confirm = null; saveBoards(b ? `Deleted the board ${b.name}.` : '');
  }
  /* ---------- the Boards view (#/boards): every saved board, to open, rename or delete ---------- */
  const BV = { edit: null, del: null, err: '', note: null, made: '', link: null, more: null, arch: false, busy: null, shareMsg: '' };
  const TEMPLATES = ['Tonight’s NBA', 'Favorite players', 'Best unders', 'Fantasy roster', 'Injury watch', 'Weekend NFL', 'My research'];
  const shareLink = id => { const u = `${location.origin}${location.pathname}#/board/${id}`; try { return window.flRef?.link?.(u) || u } catch (e) { return u } };   // carries the member's invite code when referrals are on
  function boardsPage(el) {
    const all = live(), arch = L.boards.filter(b => b.archived), acct = hasAccount();
    if (!L.picks && L.boards.some(b => b.items.some(lineOf))) loadPicks();
    const item = (b, v, i) => kindOf(v) === 'note'
      ? `<li class="bd-it bd-note"><p class="bd-nt"><small class="lb">Note · ${esc(ago(v.at || b.at))}</small>${esc(v.label)}</p><button type="button" class="ib bd-rm" data-bdrm="${b.id}|${i}" aria-label="Remove the note “${esc(v.label.slice(0, 40))}”">${ic('x', 16)}</button></li>`
      : `<li class="bd-it"><button type="button" class="bd-open" data-bdview="${b.id}|${i}">${face(v.photo, v.name || v.label || SPORT_NAME[v.sport], 'avx av-sm')}<span class="rw-t"><b>${esc(viewLabel(v))}</b><small>${esc(subOf(v))}${lineOf(v) ? ` · saved at ${esc(lineOf(v).side)} ${num(lineOf(v).line)}` : ''}</small>${flagHtml(flagOf(v))}</span></button>
        <button type="button" class="ib bd-rm" data-bdrm="${b.id}|${i}" aria-label="Remove ${esc(viewLabel(v))} from ${esc(b.name)}">${ic('x', 16)}</button></li>`;
    const counts = b => { const m = {}; for (const v of b.items) { const k = kindOf(v); m[k] = (m[k] || 0) + 1 } return Object.entries(m).map(([k, n]) => `${n} ${KIND_WORD[k]}${n === 1 ? '' : k === 'props' ? '' : 's'}`).join(', ') };
    const card = (b, i, list) => { const n = b.items.length, h = 'bdh-' + b.id, fs = flagSum(b);
      const more = b.archived
        ? `<button type="button" class="bt ghost sm" data-bd="restore" data-id="${b.id}">Restore</button><button type="button" class="bt ghost sm" data-bd="delete" data-id="${b.id}">Delete</button>`
        : `<button type="button" class="bt ghost sm" data-bd="note" data-id="${b.id}" aria-expanded="${BV.note === b.id}">${ic('edit', 16)}Add a note</button><button type="button" class="bt ghost sm" data-bd="share" data-id="${b.id}" aria-expanded="${BV.link === b.id}">${ic('share', 16)}${b.share ? 'Shared link' : 'Share'}</button>
            <details class="bd-more"${BV.more === b.id ? ' open' : ''}><summary class="bt ghost sm" data-bdmore="${b.id}">More<span class="sr-only"> for ${esc(b.name)}</span></summary><div class="bd-menu">
              <button type="button" class="bt ghost sm" data-bd="rename" data-id="${b.id}">Rename</button>
              <button type="button" class="bt ghost sm" data-bd="up" data-id="${b.id}"${i ? '' : ' disabled'}>Move up</button><button type="button" class="bt ghost sm" data-bd="down" data-id="${b.id}"${i < list.length - 1 ? '' : ' disabled'}>Move down</button>
              <button type="button" class="bt ghost sm" data-bd="dup" data-id="${b.id}">Duplicate</button><button type="button" class="bt ghost sm" data-bd="image" data-id="${b.id}"${n ? '' : ' disabled'}>Save as image</button>
              <button type="button" class="bt ghost sm" data-bd="archive" data-id="${b.id}">Archive</button><button type="button" class="bt ghost sm" data-bd="delete" data-id="${b.id}">Delete</button></div></details>`;
      const top = BV.edit === b.id
        ? `<form class="bd-ren" data-bdren="${b.id}"><label class="fl-f" for="bdn-${b.id}">New name for this board</label><div class="lab-save-r"><input class="inp" id="bdn-${b.id}" name="board-name" maxlength="40" value="${esc(b.name)}" autocomplete="off" required aria-describedby="bde-${b.id}"><button class="bt sm" type="submit">Save name</button><button class="bt ghost sm" type="button" data-bd="cancel">Cancel</button></div><p class="lb bd-err" id="bde-${b.id}" role="alert">${esc(BV.err)}</p></form>`
        : `<div class="bd-top"><div class="bd-t"><h2 id="${h}" tabindex="-1">${esc(b.name)}</h2><p class="lb">${n ? esc(counts(b)) : 'Empty'} · updated ${ago(b.at)}${b.share ? ' · shared' : ''}${b.archived ? ' · archived' : ''}</p>${fs ? `<p class="bd-fsum">${esc(fs)} since you saved ${fs.includes(',') ? 'them' : 'it'}</p>` : ''}</div>
            <div class="bd-acts">${more}</div></div>`;
      const ask = BV.del === b.id ? `<div class="bd-ask" role="group" aria-label="Delete ${esc(b.name)}"><p><b>Delete “${esc(b.name)}”?</b> <span class="lb">Its ${n} saved ${n === 1 ? 'item goes' : 'items go'} with it${b.share ? ', and its shared link stops working' : ''}. This can’t be undone.${b.archived ? '' : ' Archive it instead to keep it out of the way.'}</span></p><div class="lab-board-a"><button type="button" class="bt danger sm" data-labdel="${b.id}">Delete board</button><button type="button" class="bt ghost sm" data-bd="keep">Keep it</button></div></div>` : '';
      const note = BV.note === b.id ? `<form class="bd-nf" data-bdnote="${b.id}"><label class="fl-f" for="bdt-${b.id}">Note</label><textarea class="inp" id="bdt-${b.id}" name="note" maxlength="280" rows="3" placeholder="For example: fade if he’s on a minutes limit…" required></textarea><div class="lab-board-a"><button class="bt sm" type="submit">Add note</button><button class="bt ghost sm" type="button" data-bd="nonote" data-id="${b.id}">Cancel</button></div></form>` : '';
      const link = BV.link === b.id ? `<div class="bd-share" role="group" aria-labelledby="bdsh-${b.id}"><p class="fl-f" id="bdsh-${b.id}">Read-only link</p>${!acct
          ? `<p class="lb">Sign in to share a board. Anyone with the link sees a copy they can’t change.</p>`
          : b.share ? `<div class="lab-save-r"><input class="inp" id="bdl-${b.id}" readonly value="${esc(shareLink(b.share))}" aria-label="Link to ${esc(b.name)}"><button type="button" class="bt sm" data-bd="copy" data-id="${b.id}">Copy link</button><button type="button" class="bt ghost sm" data-bd="unshare" data-id="${b.id}">Stop sharing</button></div>
            <p class="lb">Anyone with this link sees the board’s lines and notes, and who shared it. They can’t change it. It updates when you change the board.</p>`
          : `<p class="lb">${BV.busy === b.id ? 'Making the link…' : 'Could not make a link.'}</p>`}<p class="lb bd-err" role="status">${esc(BV.shareMsg || '')}</p></div>` : '';
      return `<article class="card bd-card${b.archived ? ' bd-arch' : ''}" aria-labelledby="${h}">${top}${ask}${note}${link}${n ? `<ul class="bd-items">${b.items.map((v, j) => item(b, v, j)).join('')}</ul>` : '<p class="lb">This board is empty. Use “Save to a board” on a player, team, game, trend, comparison or pick, or add a note.</p>'}</article>` };
    const room = roomForBoard(), free = room ? TEMPLATES.filter(t => !L.boards.some(b => b.name.toLowerCase() === t.toLowerCase())) : [];
    const make = room
      ? `<form class="card bd-make" data-bdmake><label class="fl-f" for="bdNew">Start a board</label><div class="lab-save-r"><input class="inp" id="bdNew" name="board-name" maxlength="40" placeholder="Name it, or pick one below…" autocomplete="off" required aria-describedby="bdNewE"><button class="bt" type="submit">Create board</button></div>
        ${free.length ? `<div class="cx-row" role="group" aria-label="Ready-made names">${free.map(t => `<button type="button" class="cx sm" data-bdtpl="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}<p class="lb bd-err" id="bdNewE" role="alert">${esc(BV.made)}</p></form>`
      : `<div class="card bd-make bd-lim"><p><b>The free plan keeps one board.</b> <span class="lb">Plus keeps as many as you like, with read-only links for each.</span></p><a class="bt sm" href="#/pricing">See Plus</a></div>`;
    el.innerHTML = `<div class="vst bd"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Research boards</h1><p class="pg-sub">Players, lines, teams, games, trends and your own notes, kept together. A saved line shows when it moves or closes. ${acct ? 'Saved to your account, on every device you sign in on.' : 'Kept in this browser. Sign in to keep them on your account.'}</p></div>
        <button type="button" class="bt ghost" data-page="lab">${ic('lab', 18)}Back to the Lab</button></header>
      ${make}
      ${all.length ? `<div class="vst bd-list">${all.map(card).join('')}</div>`
        : `<div class="card emp">${ic('save', 28)}<b>No boards yet</b><p>Start one above, then use “Save to a board” anywhere you see it: a line in Prop Explorer, a player or team in the Lab, a comparison, a trend, a pick’s evidence, or a game in Continue researching on Home.</p></div>`}
      ${arch.length ? `<details class="bd-archd"${BV.arch ? ' open' : ''}><summary data-bdarch>Archived boards (${arch.length})</summary><div class="vst bd-list">${arch.map(card).join('')}</div></details>` : ''}</div>`;
  }
  /* Save as image: the board drawn on a canvas in the current theme's colours, downloaded as a PNG */
  function boardImage(b) {
    const cs = getComputedStyle(document.body), c = n => cs.getPropertyValue(n).trim();
    const fam = c('--font-body') || 'system-ui, sans-serif', disp = c('--font-display') || fam;
    const lines = b.items.filter(v => kindOf(v) !== 'note').slice(0, 14), notes = b.items.filter(v => kindOf(v) === 'note').slice(0, 3);
    const W = 1080, P = 64, RH = 84, H = P + 150 + lines.length * RH + (notes.length ? 50 + notes.length * 64 : 0) + 90;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
    const fit = (t, w) => { t = String(t || ''); if (x.measureText(t).width <= w) return t; while (t && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…' };
    x.fillStyle = c('--surface') || c('--bg') || '#111'; x.fillRect(0, 0, W, H);
    x.fillStyle = c('--accent') || '#e8b64c'; x.fillRect(0, 0, W, 10);
    x.fillStyle = c('--muted') || '#999'; x.font = `600 24px ${fam}`; x.fillText(`Floodlight · saved board · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`, P, P + 18);
    x.fillStyle = c('--text') || '#fff'; x.font = `800 56px ${disp}`; x.fillText(fit(b.name, W - 2 * P), P, P + 90);
    let y = P + 150;
    for (const v of lines) {
      const s = lineOf(v), f = flagOf(v);
      x.strokeStyle = c('--border') || '#333'; x.lineWidth = 2; x.beginPath(); x.moveTo(P, y - 4); x.lineTo(W - P, y - 4); x.stroke();
      x.fillStyle = c('--text') || '#fff'; x.font = `700 32px ${fam}`; x.fillText(fit(viewLabel(v), W - 2 * P - 260), P, y + 38);
      x.fillStyle = c('--muted') || '#999'; x.font = `500 24px ${fam}`; x.fillText(fit(f ? `${f.t}. ${subOf(v)}` : subOf(v), W - 2 * P - 260), P, y + 70);
      if (s) { x.textAlign = 'right'; x.fillStyle = c('--text') || '#fff'; x.font = `800 34px ${fam}`; x.fillText(`${s.side === 'under' ? 'Under' : 'Over'} ${num(s.line)}`, W - P, y + 50); x.textAlign = 'left' }
      y += RH;
    }
    if (notes.length) { y += 20; x.fillStyle = c('--muted') || '#999'; x.font = `700 22px ${fam}`; x.fillText('NOTES', P, y); y += 10;
      for (const v of notes) { x.fillStyle = c('--text') || '#fff'; x.font = `500 28px ${fam}`; x.fillText(fit('“' + v.label + '”', W - 2 * P), P, y + 42); y += 64 } }
    x.fillStyle = c('--muted') || '#999'; x.font = `500 22px ${fam}`; x.fillText(fit('Past results describe past games. They do not promise what happens next.', W - 2 * P), P, H - P + 20);
    const done = blob => { if (!blob) return say('The image could not be made in this browser.'); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (b.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'board') + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); say(`Saved ${b.name} as an image.`); track('board_image') };
    try { cv.toBlob(done, 'image/png') } catch (e) { say('The image could not be made in this browser.') }
    return cv;
  }
  /* read-only links (labshare.py): the link shows a copy; changing the board updates the copy behind the same link */
  async function shareBoard(b) {
    BV.busy = b.id; BV.shareMsg = ''; drawBoardsPage();
    try { const r = await api('/api/boards/share', { board: { id: b.id, name: b.name, items: b.items } }); b.share = r.id; b.sharedAt = Date.now(); track('board_share') }
    catch (e) { BV.shareMsg = e.message || 'Could not make a link. Try again.' }
    BV.busy = null; saveBoards(); drawBoardsPage(b.share ? `#bdl-${b.id}` : null);
  }
  function reshare() {   // a shared board that changed since its link was last updated
    if (!hasAccount() || typeof api !== 'function') return;
    for (const b of L.boards) if (b.share && (b.at || 0) > (b.sharedAt || 0)) { b.sharedAt = Date.now(); api('/api/boards/share', { board: { id: b.id, name: b.name, items: b.items } }).catch(() => { b.sharedAt = 0 }) }
  }
  function moveBoard(id, d) {
    const list = live(), i = list.findIndex(b => b.id === id), j = i + d; if (i < 0 || j < 0 || j >= list.length) return false;
    const a = L.boards.indexOf(list[i]), z = L.boards.indexOf(list[j]); [L.boards[a], L.boards[z]] = [L.boards[z], L.boards[a]]; return true;
  }
  function dupBoard(b) {
    if (!roomForBoard()) { BV.made = LIMIT_TXT; return null }
    let name = `${b.name.slice(0, 33)} (copy)`, k = 2; while (L.boards.some(x => x.name.toLowerCase() === name.toLowerCase())) name = `${b.name.slice(0, 30)} (copy ${k++})`;
    const c = { ...JSON.parse(JSON.stringify(b)), id: newId(), name, at: Date.now(), share: null, sharedAt: null, archived: false };
    L.boards.splice(L.boards.indexOf(b) + 1, 0, c); return c;
  }
  // redraw for new data only when nobody is typing or has a menu open on the page
  function quietRedraw() { const el = $('pg-boards'); if (!el || el.hidden) return; if (BV.note || BV.edit || BV.more || el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT|SUMMARY)$/.test(document.activeElement.tagName)) return; drawBoardsPage() }
  function drawBoardsPage(focus) { const el = $('pg-boards'); if (!el || el.hidden) return; boardsPage(el); if (focus) (el.querySelector(focus) || el.querySelector('.pg-title'))?.focus() }
  document.addEventListener('click', ev => {
    const pg = $('pg-boards'); if (!pg || pg.hidden || !pg.contains(ev.target)) return;
    const t = ev.target, find = id => L.boards.find(x => x.id === id);
    const vw = t.closest('[data-bdview]'); if (vw) { const [id, i] = vw.dataset.bdview.split('|'), b = find(id); if (!b) return; if (!b.items[+i]?.kind) window.flPages.show('lab'); return openView(b, +i) }
    const rm = t.closest('[data-bdrm]'); if (rm) { const [id, i] = rm.dataset.bdrm.split('|'), b = find(id); if (!b) return; const g = b.items.splice(+i, 1)[0]; b.at = Date.now(); saveBoards(`Removed ${viewLabel(g)} from ${b.name}.`); return drawBoardsPage(`[aria-labelledby="bdh-${id}"] .bd-open, [aria-labelledby="bdh-${id}"] [data-bd="rename"]`) }
    const del = t.closest('[data-labdel]'); if (del) { BV.del = null; deleteBoard(del.dataset.labdel); return drawBoardsPage('.pg-title') }
    const tp = t.closest('[data-bdtpl]'); if (tp) { const b = makeBoard(tp.dataset.bdtpl); if (!b && L.limitHit) { L.limitHit = false; BV.made = LIMIT_TXT } return drawBoardsPage(b ? `#bdh-${b.id}` : '#bdNew') }
    const a = t.closest('[data-bd]'); if (!a) return; const k = a.dataset.bd, id = a.dataset.id;
    if (k === 'note') { BV.note = BV.note === id ? null : id; drawBoardsPage(); return BV.note ? $('bdt-' + id)?.focus() : pg.querySelector(`[data-bd="note"][data-id="${id}"]`)?.focus() }
    if (k === 'nonote') { BV.note = null; return drawBoardsPage(`[data-bd="note"][data-id="${id}"]`) }
    if (k === 'rename') { BV.edit = id; BV.del = null; BV.err = ''; drawBoardsPage(); const i = $('bdn-' + id); i?.focus(); return i?.select() }
    if (k === 'cancel') { const was = BV.edit; BV.edit = null; BV.err = ''; return drawBoardsPage(`[data-bd="rename"][data-id="${was}"]`) }
    if (k === 'delete') { BV.del = id; BV.edit = null; drawBoardsPage(); return pg.querySelector('[data-labdel]')?.focus() }
    if (k === 'keep') { const was = BV.del; BV.del = null; return drawBoardsPage(`[data-bd="delete"][data-id="${was}"]`) }
    const b = find(id); if (!b) return;
    const keepMore = () => { BV.more = id };
    if (k === 'up' || k === 'down') { if (!moveBoard(id, k === 'up' ? -1 : 1)) return; keepMore(); saveBoards(`Moved ${b.name} ${k}.`); const btn = pg.querySelector(`[data-bd="${k}"][data-id="${id}"]`); return (btn && !btn.disabled ? btn : pg.querySelector(`[data-bd="${k === 'up' ? 'down' : 'up'}"][data-id="${id}"]`))?.focus() }
    if (k === 'dup') { const c = dupBoard(b); BV.more = null; if (!c) { drawBoardsPage(); return $('bdNewE') ? $('bdNewE').focus() : pg.querySelector('.bd-lim .bt')?.focus() } saveBoards(`Made ${c.name}.`); return drawBoardsPage(`#bdh-${c.id}`) }
    if (k === 'archive') { b.archived = true; BV.more = null; saveBoards(`Archived ${b.name}. It is under Archived boards at the bottom.`); return drawBoardsPage('.pg-title') }
    if (k === 'restore') { if (!roomForBoard()) { say(LIMIT_TXT); return } b.archived = false; saveBoards(`Restored ${b.name}.`); return drawBoardsPage(`#bdh-${b.id}`) }
    if (k === 'image') { BV.more = null; boardImage(b); return }
    if (k === 'share') { BV.link = BV.link === id ? null : id; BV.shareMsg = ''; if (BV.link && hasAccount() && !b.share) return shareBoard(b); drawBoardsPage(); return BV.link ? (b.share ? $('bdl-' + id)?.select() : null) : pg.querySelector(`[data-bd="share"][data-id="${id}"]`)?.focus() }
    if (k === 'copy') { const i = $('bdl-' + id), t = i?.value || ''; (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => { BV.shareMsg = 'Link copied.' }, () => { i?.select(); BV.shareMsg = 'Press Ctrl+C to copy the selected link.' }).finally(() => { const m = pg.querySelector(`[aria-labelledby="bdsh-${id}"] [role="status"]`); if (m) m.textContent = BV.shareMsg }); return }
    if (k === 'unshare') { const sid = b.share; b.share = null; b.sharedAt = null; BV.link = null; api('/api/boards/unshare', { id: sid }).catch(() => {}); saveBoards(`The link to ${b.name} no longer works.`); return drawBoardsPage(`[data-bd="share"][data-id="${id}"]`) }
  });
  document.addEventListener('toggle', ev => { const d = ev.target; if (!d.matches?.('#pg-boards .bd-more, #pg-boards .bd-archd')) return; if (d.matches('.bd-archd')) BV.arch = d.open; else { const id = d.querySelector('[data-bdmore]')?.dataset.bdmore; BV.more = d.open ? id : (BV.more === id ? null : BV.more) } }, true);
  // one More menu open at a time; Escape or a click elsewhere closes it, and Escape puts focus back on its button
  document.addEventListener('toggle', ev => { const d = ev.target; if (d.matches?.('#pg-boards .bd-more') && d.open) document.querySelectorAll('#pg-boards .bd-more[open]').forEach(o => { if (o !== d) o.open = false }) }, true);
  document.addEventListener('keydown', ev => { if (ev.key !== 'Escape') return; const d = ev.target.closest?.('#pg-boards .bd-more[open]'); if (!d) return; ev.preventDefault(); ev.stopPropagation(); d.open = false; BV.more = null; d.querySelector('summary')?.focus() }, true);
  document.addEventListener('click', ev => { if (ev.target.closest?.('.bd-more')) return; document.querySelectorAll('#pg-boards .bd-more[open]').forEach(o => { o.open = false }) });
  document.addEventListener('submit', ev => {
    const mk = ev.target.closest?.('[data-bdmake]'); if (mk) { ev.preventDefault(); const name = $('bdNew').value.trim(); if (L.boards.some(x => x.name.toLowerCase() === name.toLowerCase())) { BV.made = `You already have a board called “${name}”.`; drawBoardsPage(); return $('bdNew')?.focus() } BV.made = ''; const b = makeBoard(name); if (!b && L.limitHit) { L.limitHit = false; BV.made = LIMIT_TXT } return drawBoardsPage(b ? `#bdh-${b.id}` : '#bdNew') }
    const nf = ev.target.closest?.('[data-bdnote]'); if (nf) { ev.preventDefault(); const id = nf.dataset.bdnote, b = L.boards.find(x => x.id === id), txt = $('bdt-' + id).value.trim().slice(0, 280); if (!b || !txt) return;
      b.items = [{ kind: 'note', key: 'note:' + Date.now().toString(36), label: txt, at: Date.now() }, ...b.items].slice(0, 40); b.at = Date.now(); BV.note = null; saveBoards(`Note added to ${b.name}.`); return drawBoardsPage(`[data-bd="note"][data-id="${id}"]`) }
    const f = ev.target.closest?.('[data-bdren]'); if (!f) return; ev.preventDefault();
    const id = f.dataset.bdren, b = L.boards.find(x => x.id === id), name = $('bdn-' + id).value.trim().slice(0, 40); if (!b) return;
    if (!name) { BV.err = 'Give the board a name.'; drawBoardsPage(); return $('bdn-' + id)?.focus() }
    if (L.boards.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) { BV.err = `You already have a board called “${name}”. Pick another name.`; drawBoardsPage(); return $('bdn-' + id)?.focus() }
    const was = b.name; b.name = name; b.at = Date.now(); BV.edit = null; BV.err = '';
    saveBoards(was === name ? '' : `Renamed ${was} to ${name}.`); drawBoardsPage(`[data-bd="rename"][data-id="${id}"]`);
  });
  window.flPages?.add('boards', { title: 'Research boards', render: boardsPage, fresh: true, onHide() { BV.edit = BV.del = BV.note = BV.link = BV.more = null; BV.err = BV.made = BV.shareMsg = '' } });

  /* ---------- a shared board (#/board/<id>): the read-only copy behind a link, open without an account ---------- */
  const SB = { id: null, d: null, err: '' };
  function sharedPage(el, id) {
    if (id && id !== SB.id) { SB.id = id; SB.d = null; SB.err = '';
      fetch('/api/boards/shared?id=' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json().catch(() => ({})).then(j => { if (r.ok && j.name) SB.d = j; else SB.err = j.error || 'This board could not be opened.' }))
        .catch(() => { SB.err = 'This board could not be opened. Check your connection and try again.' }).finally(() => { if (SB.id === id) { const p = $('pg-board'); if (p && !p.hidden) sharedPage(p) } });
      if (!L.picks) loadPicks();
    }
    const d = SB.d, head = t => `<header class="pg-head"><div><p class="lb">Shared board · read-only</p><h1 class="pg-title" tabindex="-1">${esc(t)}</h1>${d ? `<p class="pg-sub">Shared by ${esc(d.by)} · updated ${esc(ago(d.at * 1000))}. You can look, not change it. Saved lines show when they move or close.</p>` : ''}</div></header>`;
    if (SB.err) { el.innerHTML = `<div class="vst bd">${head('Shared board')}<div class="card emp" role="alert">${ic('help', 28)}<b>${esc(SB.err)}</b><p>The owner may have stopped sharing it. Ask them for a new link.</p><button type="button" class="bt ghost" data-page="lab">Go to the Lab</button></div></div>`; return }
    if (!d) { el.innerHTML = `<div class="vst bd">${head('Shared board')}<div class="card emp" aria-busy="true"><p class="lb">Opening the board…</p></div></div>`; return }
    const items = (d.items || []).map((v, i) => { const s = lineOf(v);
      return `<li class="bd-it">${s ? `<button type="button" class="bd-open" data-sbopen="${i}">` : '<div class="bd-open">'}${face(v.photo, v.name || v.label, 'avx av-sm')}<span class="rw-t"><b>${esc(v.label || v.name)}</b><small>${esc(v.sub || '')}${s ? ` · saved at ${esc(s.side)} ${num(s.line)}` : ''}</small>${flagHtml(flagOf(v))}</span>${s ? '</button>' : '</div>'}</li>` }).join('');
    const room = roomForBoard();
    el.innerHTML = `<div class="vst bd">${head(d.name)}
      ${(d.notes || []).length ? `<section class="card bd-card" aria-label="Notes"><ul class="bd-items">${d.notes.map(n => `<li class="bd-it bd-note"><p class="bd-nt"><small class="lb">Note</small>${esc(n)}</p></li>`).join('')}</ul></section>` : ''}
      <section class="card bd-card" aria-label="Saved items">${items ? `<ul class="bd-items">${items}</ul>` : '<p class="lb">This board is empty.</p>'}</section>
      <div class="card bd-make"><p><b>Want to work on it?</b> <span class="lb">Copy it to your own boards and change it there. This link stays as the owner left it.</span></p>${room ? `<button type="button" class="bt sm" data-sbcopy>Copy to my boards</button>` : `<a class="bt sm" href="#/pricing">See Plus to keep more boards</a>`}<p class="lb bd-err" role="status" id="sbMsg"></p></div>
      <p class="lb">Past results describe past games. They do not promise what happens next.</p></div>`;
  }
  document.addEventListener('click', ev => {
    const pg = $('pg-board'); if (!pg || pg.hidden || !pg.contains(ev.target) || !SB.d) return;
    const o = ev.target.closest('[data-sbopen]'); if (o) { const s = lineOf(SB.d.items[+o.dataset.sbopen]); if (s) open({ sport: s.sport, name: s.name, kind: 'player', stat: s.k, line: s.line, side: s.side }); return }
    if (ev.target.closest('[data-sbcopy]')) { let name = SB.d.name, k = 2; while (L.boards.some(x => x.name.toLowerCase() === name.toLowerCase())) name = `${SB.d.name.slice(0, 34)} (${k++})`;
      const b = makeBoard(name, true), m = $('sbMsg'); if (!b) { if (m) m.textContent = LIMIT_TXT; L.limitHit = false; return }
      b.items = [...(SB.d.notes || []).map((t, i) => ({ kind: 'note', key: 'note:' + Date.now().toString(36) + i, label: t, at: Date.now() })), ...(SB.d.items || []).map(v => { const s = lineOf(v); return { ...v, kind: v.kind || 'player', at: Date.now(), ...(s ? { open: { lab: { sport: s.sport, name: s.name, kind: 'player', stat: s.k, line: s.line, side: s.side } } } : {}) } })].slice(0, 40);
      b.at = Date.now(); saveBoards(`Copied to your boards as ${b.name}.`); if (m) m.innerHTML = `Copied as <b>${esc(b.name)}</b>. <a href="#/boards">Open my boards</a>`; track('board_copy') }
  });
  window.flPages?.add('board', { title: 'Shared board', render: sharedPage, fresh: true });

  /* ---------- "Save to a board" from anywhere on the site (window.flBoards) ----------
     Any page hands over an item (recent.js describes the shape) and the button it came from. A small panel lists the
     boards with a tick on the ones that already hold it, and makes a new board on the spot, with a few ideas for names. */
  function makeBoard(name, quiet) {
    name = String(name || '').trim().slice(0, 40); if (!name) return null;
    let b = L.boards.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (b && b.archived) { b.archived = false; b.at = Date.now() }
    if (!b) { if (!roomForBoard()) { L.limitHit = true; return null } b = { id: newId(), name, items: [], at: Date.now() }; L.boards.unshift(b); saveBoards(quiet ? '' : `Made the board ${name}.`) }
    return b;
  }
  function addItem(item, name) {
    const b = makeBoard(name); if (!b || !item?.kind) return null;
    const v = { kind: item.kind, key: String(item.key || '').slice(0, 200), label: String(item.label || '').slice(0, 120), sub: String(item.sub || '').slice(0, 140), photo: item.photo || '', photo2: item.photo2 || '', open: item.open || null, at: Date.now() };
    for (const k of ['sport', 'name', 'k', 'side']) if (item[k]) v[k] = String(item[k]).slice(0, 80);
    for (const k of ['line', 'start']) if (Number.isFinite(+item[k]) && item[k] !== null && item[k] !== '') v[k] = +item[k];
    if (!v.key || !v.label) return null;
    b.items = [v, ...b.items.filter(x => viewKey(x) !== v.key)].slice(0, 40); b.at = Date.now(); track('board_save', { kind: v.kind });
    saveBoards(`Saved ${v.label} to ${b.name}.`); return b;
  }
  const OF = { el: null, item: null, from: null, said: '' };
  function drawOffer(focusSel) {
    const el = OF.el, x = OF.item; if (!el) return;
    const has = b => b.items.some(v => viewKey(v) === x.key), free = roomForBoard() ? TEMPLATES.filter(t => !L.boards.some(b => b.name.toLowerCase() === t.toLowerCase())).slice(0, 4) : [];
    el.innerHTML = `<div class="bo-card card" role="dialog" aria-modal="false" aria-labelledby="boT" aria-describedby="boWhat">
      <div class="sec-h"><h2 id="boT" tabindex="-1">Save to a board</h2><button type="button" class="ib" data-bo="close" aria-label="Close">${ic('x', 18)}</button></div>
      <p class="bo-what" id="boWhat"><b>${esc(x.label)}</b>${x.sub ? `<small class="lb">${esc(x.sub)}</small>` : ''}</p>
      ${live().length ? `<ul class="bo-list">${live().slice(0, 12).map(b => `<li><button type="button" class="bo-b" data-bo="add" data-id="${b.id}" aria-pressed="${has(b)}"><span class="rw-t"><b>${esc(b.name)}</b><small>${b.items.length} saved</small></span>${has(b) ? `<span class="pl">${ic('check', 14)}Saved</span>` : `<span class="lb">Add</span>`}</button></li>`).join('')}</ul>` : ''}
      <form class="bo-new" data-boform><label class="fl-f" for="boN">${L.boards.length ? 'Or a new board' : 'Name your first board'}</label><div class="lab-save-r"><input class="inp" id="boN" maxlength="40" placeholder="For example: Players to fade…" autocomplete="off" required><button class="bt sm" type="submit">Create and save</button></div>
        ${free.length ? `<div class="cx-row" role="group" aria-label="Ideas for a name">${free.slice(0, 5).map(t => `<button type="button" class="cx sm" data-bo="tpl" data-name="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}</form>
      <p class="lb bo-say" role="status">${OF.said}</p>
      <div class="bo-foot"><button type="button" class="lk" data-bo="boards">See all boards</button><button type="button" class="bt ghost sm" data-bo="close">Done</button></div></div>`;
    place(); (focusSel ? el.querySelector(focusSel) : null)?.focus();
  }
  function place() {
    const el = OF.el, c = el?.firstElementChild; if (!c) return;
    if (matchMedia('(max-width:640px)').matches || !OF.from?.isConnected) { el.classList.add('bo-sheet'); c.style.cssText = ''; return }
    el.classList.remove('bo-sheet'); const r = OF.from.getBoundingClientRect(), w = Math.min(380, innerWidth - 24), h = c.offsetHeight;
    const top = r.bottom + 8 + h > innerHeight - 12 ? Math.max(12, r.top - 8 - h) : r.bottom + 8;
    c.style.cssText = `position:fixed;width:${w}px;left:${Math.max(12, Math.min(innerWidth - w - 12, r.right - w))}px;top:${top}px`;
  }
  function offer(item, from) {
    if (!item?.kind || !item.key) return;
    closeOffer(true); OF.item = item; OF.from = from || document.activeElement; OF.said = '';
    const el = document.createElement('div'); el.className = 'bo'; document.body.appendChild(el); OF.el = el;
    drawOffer(); (el.querySelector('#boN') && !L.boards.length ? el.querySelector('#boN') : el.querySelector('#boT'))?.focus();
  }
  function closeOffer(silent) { if (!OF.el) return; OF.el.remove(); OF.el = null; if (!silent && OF.from?.isConnected) OF.from.focus({ preventScroll: true }) }
  document.addEventListener('click', ev => {
    if (!OF.el) return;
    if (!OF.el.contains(ev.target)) { if (ev.target !== OF.from && !OF.from?.contains?.(ev.target)) closeOffer(true); return }
    const t = ev.target.closest('[data-bo]'); if (!t) return; const a = t.dataset.bo;
    if (a === 'close') return closeOffer();
    if (a === 'boards') { closeOffer(true); window.flHub?.hide?.(); return window.flPages?.show('boards') }
    if (a === 'add' || a === 'tpl') { const b = a === 'add' ? L.boards.find(x => x.id === t.dataset.id) : null, name = b ? b.name : t.dataset.name;
      if (b && b.items.some(v => viewKey(v) === OF.item.key)) { b.items = b.items.filter(v => viewKey(v) !== OF.item.key); b.at = Date.now(); saveBoards(`Removed ${OF.item.label} from ${b.name}.`); OF.said = `Removed from <b>${esc(b.name)}</b>.`; return drawOffer(`[data-bo="add"][data-id="${b.id}"]`) }
      const nb = addItem(OF.item, name); OF.said = nb ? `Saved to <b>${esc(nb.name)}</b>.` : limitSaid('That did not save. Try again.'); return drawOffer(nb ? `[data-bo="add"][data-id="${nb.id}"]` : null) }
  });
  document.addEventListener('submit', ev => { if (!OF.el || !ev.target.matches('[data-boform]')) return; ev.preventDefault(); const nb = addItem(OF.item, OF.el.querySelector('#boN').value); OF.said = nb ? `Saved to <b>${esc(nb.name)}</b>.` : limitSaid('Give the board a name.'); drawOffer(nb ? `[data-bo="add"][data-id="${nb.id}"]` : '#boN') });
  document.addEventListener('keydown', ev => { if (OF.el && ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeOffer() } }, true);
  addEventListener('resize', () => OF.el && place());
  window.flBoards = { list: live, all: () => L.boards, offer, add: addItem, make: makeBoard, flag: flagOf, image: boardImage, TEMPLATES };

  window.flLab = { open, recent: () => L.recent, boards: () => L.boards,
    // a saved comparison reopens with both players and its choices: { sport, a, b, stat, statB, win, preset, mode, venue, vs }
    compare: (a = {}) => { if (denied()) return window.flPages.show('lab'); if (show()) openTools('compare', a.a && a.b ? { sport: a.sport, a: a.a, b: a.b, stat: a.stat, statB: a.statB, win: a.win, preset: a.preset, mode: a.mode, venue: a.venue, vs: a.vs } : { sport: a.sport, name: a.name, stat: a.stat }) },
    trends: (a = {}) => { if (denied()) return window.flPages.show('lab'); if (show()) openTools('trends', { sport: a.sport, filters: a.filters }) } };
  window.flPages?.add('lab', { title: 'The Lab', render,
    onShow(el) { if (denied() !== !$('labAsk')) render(el); if (L.engine === 'classic') { try { const r = $('rs'); if (r) { r.hidden = false; S.rs.open = true } } catch (e) {} } drawTry(); drawCast(); drawBoards(); if (L.picks == null) loadPicks() } });
  // old addresses: ?rs=1 and #research land on the Lab
  if (/[?&]rs=/.test(location.search) || location.hash === '#research') setTimeout(() => { history.replaceState(null, '', location.pathname); window.flPages.show('lab') }, 0);
})();
