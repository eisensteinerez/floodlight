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
    ['props', 'bars', 'Prop explorer', 'Today’s posted lines, ranked by how often they have hit.'],
    ['compare', 'compare', 'Compare', 'Two players on one combined line.'],
    ['matchup', 'versus', 'Matchup', 'A team’s results, totals and the next game’s lines.'],
    ['trends', 'trend', 'Trends', 'The same games as a trend line, with the average.'],
  ];
  const L = { engine: null, tool: null, cur: null, ready: false, pending: null, loaded: false, q: '', hits: null, seq: 0, sel: -1, board: null, saving: false, confirm: null,
    boards: store.get('fl.labBoards', []), recent: store.get('fl.labRecent', []), picks: null, denied: false };
  const frame = () => $('labFrame');
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
      <div class="g4 lab-tools" role="group" aria-label="Tools">${TOOLS.map(([k, icon, name, line]) => `<button type="button" class="card hit lab-tool" data-labtool="${k}" aria-pressed="false"><span class="lab-tool-i" aria-hidden="true">${ic(icon, 22)}</span><b>${name}</b><span>${line}</span></button>`).join('')}</div>
      <section class="lab-ws" id="labWs" aria-label="Workspace" hidden>
        <div class="lab-ws-h"><div class="lab-ws-t"><span class="lb" id="labWsK">Workspace</span><h2 id="labWsT" tabindex="-1"></h2></div>
          <div class="lab-ws-a" id="labWsA"></div></div>
        <div class="lab-views" id="labViews" hidden></div>
        <div class="lab-save" id="labSave" hidden></div>
        <div class="lab-frame" id="labFrameBox" hidden><div class="lab-skl" id="labSkl" aria-hidden="true"><div class="skl"></div><div class="skl"></div><div class="skl"></div></div>
          <iframe id="labFrame" title="The Lab workspace" scrolling="no" loading="eager"></iframe></div>
        <div class="lab-classic" id="labClassic" hidden></div>
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
    window.flEdge.props(today.length ? today : ['nba', 'nfl']).then(r => { L.picks = r.picks; L.denied = r.denied }).catch(() => { L.picks = [] }).finally(() => { L.loadingPicks = false; drawTry(); drawCast(); drawStart() });
  }
  function drawTry() {
    const box = $('labTry'); if (!box) return;
    const chips = [];
    for (const p of (L.picks ? window.flEdge.hot(L.picks, 2) : [])) chips.push([`${p.name} ${String(p.label).toLowerCase()}`, window.flEdge.labArgs(p)]);
    const games = (window.flHub?.games?.() || []).filter(g => g.state !== 'post' && ['nba', 'nfl', 'nhl', 'mlb'].includes(String(g.lg)) || g.sport === 'soccer' && g.state !== 'post').sort((a, b) => (b.state === 'in') - (a.state === 'in') || b.weight - a.weight).slice(0, 2);
    for (const g of games) chips.push([`${g.a.name} v ${g.b.name}`, { sport: g.sport === 'soccer' ? 'soccer' : g.lg, name: g.a.full || g.a.name, team: true }]);
    if (chips.length) chips.push(['Compare two players', { tool: 'compare' }]);
    box.innerHTML = chips.length ? `<span class="lb">Try</span>${chips.slice(0, 5).map(([l, a]) => `<button type="button" class="cx sm" data-labopen="${esc(JSON.stringify(a))}">${esc(l)}</button>`).join('')}` : '';
  }
  /* tonight's three hottest players, as a picture behind the bar. Decoration only: pages.css decides whether it shows (Stadium Gold does) */
  function drawCast() {
    const box = $('labCast'); if (!box) return;
    const faces = [...new Set((L.picks ? window.flEdge.hot(L.picks, 8) : []).map(p => p.photo).filter(Boolean))].slice(0, 3), key = faces.join('|');
    if (box.dataset.k === key) return; box.dataset.k = key;
    box.innerHTML = faces.map(src => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`).join('');
  }
  function drawStart() {
    const box = $('labStart'); if (!box) return;
    if (L.engine) { box.hidden = true; return } box.hidden = false;
    const hot = L.picks ? window.flEdge.hot(L.picks, 6) : null;
    box.innerHTML = `<div class="sec-h"><h2>Start with tonight’s hottest</h2>${hot?.length ? '<span class="lb">Players with a line posted today</span>' : ''}</div>` +
      (hot == null ? `<div class="g3">${'<div class="skl lab-card-skl"></div>'.repeat(6)}</div>`
        : hot.length ? `<div class="g3">${hot.map(p => `<button type="button" class="card hit lab-starter" data-labopen="${esc(JSON.stringify(window.flEdge.labArgs(p)))}">${face(p.photo, p.name, 'avx av-lg')}<span class="rw-t"><b>${esc(p.name)}</b><small>${esc([p.team, SPORT_NAME[p.sport]].filter(Boolean).join(' · '))}</small><small>${esc(p.text)}</small></span>${window.flHeat.badge(p.heat)}</button>`).join('')}</div>`
        : `<div class="card emp">${ic('lab', 28)}<b>${L.denied ? 'The Lab is switched off for your account' : 'No player is running hot yet today'}</b><p>${L.denied ? 'Ask your admin to switch it on.' : 'The books have not posted player lines that read 60 or more. Type any player or team in the bar above to start.'}</p></div>`);
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
    const E = type => fetchJSON(`${ESPN_SEARCH}?query=${encodeURIComponent(q)}&type=${type}&limit=8`).then(d => d.items || []).catch(() => []);
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
    ws.hidden = !e; $('labFrameBox').hidden = e !== 'lab'; $('labClassic').hidden = e !== 'classic';
    if (e !== 'classic') { try { typeof closeResearch === 'function' && S.rs.open && closeResearch() } catch (x) {} }
    drawStart(); drawHead();
  }
  function tool(k) { L.tool = k; document.querySelectorAll('.lab-tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.labtool === k))) }
  /* o: { sport, name | player, team (true for a team), stat, line, side, tab, mode } and, for the older engine, { classic, id, lg, tnId, ... } */
  function open(o = {}) {
    if (denied()) { window.flPages.show('lab'); return }
    if (!show()) return;
    if (o.q != null && !o.name && !o.player) { const a = $('labAsk'); a.value = o.q; a.focus(); if (o.q) search(o.q); return }
    if (o.tool) return runTool(o.tool);
    const name = o.name || o.player || '', sport = o.sport || (name ? store.get('lab.sport', 'nba') : '');
    if (!name && !o.tab && !o.id && !o.fmId && !o.tnId && !o.fsId && !o.fsTeam && !o.classic) return;   // just the page
    const useLab = !o.classic && LAB_SPORTS.has(sport) && (name || !(o.id || o.fmId));
    if (useLab) return openLab({ sport, name, kind: o.team === true || o.kind === 'team' ? 'team' : 'player', stat: o.stat || '', line: o.line, side: o.side, tab: o.tab, mode: o.mode });
    openClassic({ ...o, sport: sport || o.sport, name });
  }
  function openLab(m, keepBoard) {
    if (!keepBoard) { L.board = null }
    setEngine('lab'); tool(m.tab === 'board' ? 'props' : m.kind === 'team' ? 'matchup' : m.mode === 'trend' ? 'trends' : null);
    const f = frame(); L.cur = null; drawHead(m.name || (m.tab === 'board' ? 'Prop explorer' : ''));
    if (L.ready && f.contentWindow) f.contentWindow.postMessage({ flLab: m }, location.origin);
    else { L.pending = null; $('labSkl').hidden = false;
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
  function focusWs() { const ws = $('labWs'); if (!ws) return; setTimeout(() => { ws.scrollIntoView({ behavior: root.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' }); $('labWsT')?.focus({ preventScroll: true }) }, 60) }
  function runTool(k) {
    const c = L.cur, sport = c?.sport || store.get('lab.sport', 'nba');
    if (k === 'props') return openLab({ sport, tab: 'board' });
    if (k === 'trends') return c?.view === 'player' ? openLab({ sport: c.sport, name: c.name, kind: 'player', stat: c.k, line: c.line, side: c.side, mode: 'trend' }, true) : openLab({ sport, tab: 'player', mode: 'trend' });
    if (k === 'matchup') { const g = (window.flHub?.games?.() || []).filter(g => g.state !== 'post' && (['nba', 'nfl', 'nhl', 'mlb'].includes(String(g.lg)) || g.sport === 'soccer')).sort((a, b) => (b.state === 'in') - (a.state === 'in') || b.weight - a.weight)[0];
      return c?.view === 'team' ? openLab({ sport: c.sport, name: c.name, kind: 'team' }, true) : g ? openLab({ sport: g.sport === 'soccer' ? 'soccer' : g.lg, name: g.a.full || g.a.name, kind: 'team' }) : openLab({ sport, tab: 'team' }) }
    if (k === 'compare') { const CS = { nba: 'nba', wnba: 'nba', nfl: 'nfl', nhl: 'nhl', mlb: 'mlb', soccer: 'soccer' }, cs = CS[c?.sport];
      return c?.view === 'player' && cs ? openClassic({ sport: cs, name: c.name, compare: true, tab: 'player' }) : openClassic({ sport: cs || CS[sport] || S.rs?.sport || 'nba', tab: 'player', compare: true }) }
  }
  function more(k) {
    if (k === 'tennis') return openClassic({ sport: 'tennis', tab: 'player' });
    if (k === 'combo') return runTool('compare');
    if (k === 'book') return openClassic({ tab: 'board' });
    if (k === 'teamprops') return openClassic({ tab: 'team' });
    if (k === 'browse') { openClassic({ tab: 'player' }); try { S.rs.browse = { ...(S.rs.browse || {}), open: true, sport: S.rs.sport }; document.querySelector('#rs [data-rs="browse"]')?.click() } catch (e) {} return }
    openClassic({ tab: 'player' });
  }

  /* ---------- the workspace heading, saving, boards ---------- */
  const viewLabel = v => v.view === 'board' ? `${SPORT_NAME[v.sport] || ''} prop explorer` : v.view === 'team' ? `${v.name}${v.label ? ' · ' + v.label : ''}` : `${v.name} · ${v.yes ? v.label : `${v.side === 'under' ? 'Under' : 'Over'} ${fmt(v.line)} ${String(v.label || '').toLowerCase()}`}`;
  const viewKey = v => [v.view, v.sport, v.name || '', v.k || '', v.line ?? '', v.side || ''].join('|');
  const canSave = () => L.engine === 'lab' && L.cur && ['player', 'team', 'board'].includes(L.cur.view);
  function drawHead(title) {
    const t = $('labWsT'); if (!t) return;
    const c = L.cur, b = L.board ? L.boards.find(x => x.id === L.board) : null;
    if (title != null) t.textContent = title; else if (L.engine === 'lab' && c) t.textContent = c.view === 'board' ? 'Prop explorer' : c.view === 'home' ? (c.tab === 'team' ? 'Pick a team' : 'Pick a player') : c.name;
    $('labWsK').textContent = b ? `Board: ${b.name}` : L.engine === 'classic' ? (L.hint || 'More tools') : c?.sport ? `Workspace · ${SPORT_NAME[c.sport] || ''}` : 'Workspace';
    $('labWsA').innerHTML = `${canSave() ? `<button type="button" class="bt ghost" data-lab="save" aria-expanded="${L.saving}">${ic('save', 18)}Save to a board</button>` : ''}<button type="button" class="ib" data-lab="closews" aria-label="Close the workspace">${ic('x', 18)}</button>`;
    const vs = $('labViews'); vs.hidden = !b;
    if (b) vs.innerHTML = `<span class="lb">In this board</span><div class="cx-row scroll">${b.items.map((v, i) => `<span class="lab-view"><button type="button" class="cx sm" aria-pressed="${!!c && viewKey(c) === viewKey(v)}" data-labview="${i}">${esc(viewLabel(v))}</button><button type="button" class="lab-rm" data-labrm="${i}" aria-label="Remove ${esc(viewLabel(v))} from this board">${ic('x', 14)}</button></span>`).join('')}</div>`;
    drawSave();
  }
  function drawSave() {
    const box = $('labSave'); if (!box) return; box.hidden = !L.saving || !canSave(); if (box.hidden) return;
    const c = L.cur, b = L.board ? L.boards.find(x => x.id === L.board) : null;
    box.innerHTML = `<form class="lab-save-f tile" id="labSaveF"><label class="fl-f" for="labSaveN">Board name</label>
      <div class="lab-save-r"><input class="inp" id="labSaveN" maxlength="40" list="labSaveL" value="${esc(b ? b.name : '')}" placeholder="For example: Tonight’s points" autocomplete="off" required><datalist id="labSaveL">${L.boards.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
        <button class="bt" type="submit">Save this view</button><button class="bt ghost" type="button" data-lab="cancelsave">Cancel</button></div>
      <p class="lb" id="labSaveNote" role="status">Saving “${esc(viewLabel(c))}”. Type an existing board’s name to add this view to it.</p></form>`;
  }
  function saveBoards(note) {
    store.set('fl.labBoards', L.boards);
    try { if (S.me && typeof api === 'function') api('/api/me/prefs', { boards: L.boards.slice(0, 30) }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
    drawBoards(); if (note) say(note);
  }
  function say(t) { const a = $('announce'); if (a) { a.textContent = ''; setTimeout(() => { a.textContent = t }, 30) } }
  function saveView(name) {
    const c = L.cur; if (!canSave()) return;
    const v = { view: c.view, sport: c.sport, name: c.name || '', k: c.k || '', label: c.label || '', line: c.line ?? null, side: c.side || 'over', yes: !!c.yes, photo: c.photo || '', at: Date.now() };
    name = name.trim().slice(0, 40); if (!name) return;
    let b = L.boards.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!b) { b = { id: 'b' + Date.now().toString(36), name, items: [], at: Date.now() }; L.boards.unshift(b) }
    b.items = [v, ...b.items.filter(x => viewKey(x) !== viewKey(v))].slice(0, 24); b.at = Date.now();
    L.boards.sort((x, y) => y.at - x.at); L.board = b.id; L.saving = false;
    saveBoards(`Saved to ${b.name}. ${b.items.length} view${b.items.length === 1 ? '' : 's'} in this board.`); drawHead();
  }
  function openView(b, i) { const v = b.items[i]; if (!v) return; L.board = b.id;
    openLab(v.view === 'board' ? { sport: v.sport, tab: 'board' } : { sport: v.sport, name: v.name, kind: v.view === 'team' ? 'team' : 'player', stat: v.k, line: v.line, side: v.side }, true) }
  function drawBoards() {
    const box = $('labBoards'); if (!box) return;
    const all = L.boards, list = L.allBoards ? all : all.slice(0, 3);
    box.innerHTML = `<div class="sec-h"><h2>Saved boards</h2>${all.length > 3 ? `<button type="button" class="lk" data-lab="allboards" aria-expanded="${!!L.allBoards}">${L.allBoards ? 'Show the latest three' : `See all ${all.length}`}</button>` : ''}</div>` +
      (!all.length ? `<div class="card emp">${ic('save', 28)}<b>No boards yet</b><p>Open a player, a team or the prop explorer, then choose “Save to a board” to keep that view. Boards are saved ${hasAccount() ? 'to your account' : 'in this browser'}.</p></div>`
        : `<div class="g3">${list.map(b => L.confirm === b.id
          ? `<div class="card lab-board" role="group" aria-label="Delete ${esc(b.name)}"><span class="lb">Delete this board?</span><b>${esc(b.name)}</b><span class="lb">Its ${b.items.length} saved view${b.items.length === 1 ? '' : 's'} will be gone. This cannot be undone.</span><div class="lab-board-a"><button type="button" class="bt danger sm" data-labdel="${b.id}">Delete board</button><button type="button" class="bt ghost sm" data-lab="keep">Keep it</button></div></div>`
          : `<div class="card hit lab-board"><button type="button" class="lab-board-o" data-labboard="${b.id}" aria-label="Open the board ${esc(b.name)}"></button><span class="lb">Saved board</span><b>${esc(b.name)}</b><span class="lb">${b.items.length} view${b.items.length === 1 ? '' : 's'} · updated ${ago(b.at)}</span>
              <span class="lab-board-f">${b.items.slice(0, 4).map(v => face(v.photo, v.name || SPORT_NAME[v.sport], 'avx av-sm')).join('')}</span><button type="button" class="ib lab-board-x" data-labask="${b.id}" aria-label="Delete the board ${esc(b.name)}">${ic('x', 16)}</button></div>`).join('')}</div>`);
  }
  const hasAccount = () => { try { return !!S.me } catch (e) { return false } };
  // boards follow the account: on sign-in, merge what the account has with what this browser has (newest copy of each wins)
  document.addEventListener('fl:me', () => { try { const mine = S.me?.prefs?.boards; if (Array.isArray(mine) && mine.length) { const by = new Map(); for (const b of [...mine, ...L.boards]) { const o = by.get(b.id); if (!o || (b.at || 0) > (o.at || 0)) by.set(b.id, b) }
    L.boards = [...by.values()].filter(b => b && b.id && Array.isArray(b.items)).sort((a, b) => b.at - a.at); store.set('fl.labBoards', L.boards) } } catch (e) {} drawBoards(); if (L.loaded && window.flPages.current() === 'lab') window.flPages.redraw('lab') });

  /* ---------- what the workspace says back ---------- */
  addEventListener('message', ev => {
    const f = frame(); if (!f || ev.origin !== location.origin || ev.source !== f.contentWindow || !ev.data) return;
    const d = ev.data;
    if (d.lab === 'height') { f.style.height = Math.max(320, d.h + 8) + 'px'; $('labSkl').hidden = true }
    if (d.lab === 'ready') { L.ready = true; f.contentWindow.postMessage({ flTheme: root.dataset.theme, flMotion: root.dataset.motion || '' }, location.origin) }
    if (d.lab === 'loaded') remember(d.name, { sport: d.sport, name: d.name, team: d.kind === 'team' });
    if (d.lab === 'state') { L.cur = d; if (d.view !== 'player' && d.view !== 'team' && d.view !== 'board') L.saving = false;
      tool(d.view === 'board' ? 'props' : d.view === 'team' ? 'matchup' : L.tool === 'trends' && d.view === 'player' ? 'trends' : null); drawHead() }
  });
  document.addEventListener('fl:theme', () => { const f = frame(); if (L.ready && f?.contentWindow) f.contentWindow.postMessage({ flTheme: root.dataset.theme, flMotion: root.dataset.motion || '' }, location.origin) });
  document.addEventListener('fl:hub', () => { if (L.loaded && window.flPages.current() === 'lab') { drawTry(); if (L.picks == null) loadPicks() } });

  /* ---------- clicks ---------- */
  document.addEventListener('click', ev => {
    const pg = $('pg-lab'); if (!pg || pg.hidden) return;
    const t = ev.target;
    if (L.hits && !t.closest('.lab-bar')) closeHits();
    if (!pg.contains(t)) return;
    const hit = t.closest('[data-labhit]'); if (hit) return choose(flat()[+hit.dataset.labhit]);
    const o = t.closest('[data-labopen]'); if (o) { let a = {}; try { a = JSON.parse(o.dataset.labopen) } catch (e) {} return open(a) }
    const tl = t.closest('[data-labtool]'); if (tl) return runTool(tl.dataset.labtool);
    const mr = t.closest('[data-labmore]'); if (mr) return more(mr.dataset.labmore);
    const bd = t.closest('[data-labboard]'); if (bd) { const b = L.boards.find(x => x.id === bd.dataset.labboard); return b && openView(b, 0) }
    const vw = t.closest('[data-labview]'); if (vw) { const b = L.boards.find(x => x.id === L.board); return b && openView(b, +vw.dataset.labview) }
    const rm = t.closest('[data-labrm]'); if (rm) { const b = L.boards.find(x => x.id === L.board); if (!b) return; const gone = b.items.splice(+rm.dataset.labrm, 1)[0]; b.at = Date.now(); saveBoards(`Removed ${viewLabel(gone)} from ${b.name}.`); return drawHead() }
    const ask = t.closest('[data-labask]'); if (ask) { L.confirm = ask.dataset.labask; drawBoards(); return $('labBoards').querySelector('[data-labdel]')?.focus() }
    const del = t.closest('[data-labdel]'); if (del) { const b = L.boards.find(x => x.id === del.dataset.labdel); L.boards = L.boards.filter(x => x.id !== del.dataset.labdel); if (L.board === del.dataset.labdel) L.board = null; L.confirm = null; saveBoards(b ? `Deleted the board ${b.name}.` : ''); return drawHead() }
    const a = t.closest('[data-lab]')?.dataset.lab; if (!a) return;
    if (a === 'save') { L.saving = !L.saving; drawHead(); return L.saving && $('labSaveN')?.focus() }
    if (a === 'cancelsave') { L.saving = false; drawHead(); return pg.querySelector('[data-lab="save"]')?.focus() }
    if (a === 'keep') { L.confirm = null; return drawBoards() }
    if (a === 'allboards') { L.allBoards = !L.allBoards; return drawBoards() }
    if (a === 'closews') { L.board = null; L.cur = null; L.saving = false; tool(null); setEngine(null); return $('labAsk')?.focus() }
  });
  document.addEventListener('submit', ev => { if (ev.target.id !== 'labSaveF') return; ev.preventDefault(); saveView($('labSaveN').value) });

  window.flLab = { open, recent: () => L.recent, boards: () => L.boards };
  window.flPages?.add('lab', { title: 'The Lab', render,
    onShow(el) { if (denied() !== !$('labAsk')) render(el); if (L.engine === 'classic') { try { const r = $('rs'); if (r) { r.hidden = false; S.rs.open = true } } catch (e) {} } drawTry(); drawCast(); drawBoards(); if (L.picks == null) loadPicks() } });
  // old addresses: ?rs=1 and #research land on the Lab
  if (/[?&]rs=/.test(location.search) || location.hash === '#research') setTimeout(() => { history.replaceState(null, '', location.pathname); window.flPages.show('lab') }, 0);
})();
