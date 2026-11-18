/* Floodlight · Home, the Live Hub.
   One page for everything happening right now across every sport: a Live Now strip, today's biggest games,
   the next UFC and boxing nights with countdowns, the most confident predictions, today's standout players
   and the teams you follow. It reads the same public scoreboards the sport pages use and refreshes itself
   every 30 seconds while it is on screen. Clicking a game switches to its sport and opens it there. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = document.documentElement;
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  // every feed the hub reads: [sport, ESPN path, short name, league key on the sport page, weight for "biggest games"]
  const FEEDS = [
    ['soccer', 'soccer/all', 'Soccer', 'all', 6], ['football', 'football/nfl', 'NFL', 'nfl', 10], ['football', 'football/college-football', 'NCAAF', 'fbs', 7],
    ['basketball', 'basketball/nba', 'NBA', 'nba', 9], ['basketball', 'basketball/mens-college-basketball', 'NCAAB', 'cbb', 5],
    ['hockey', 'hockey/nhl', 'NHL', 'nhl', 7], ['baseball', 'baseball/mlb', 'MLB', 'mlb', 8],
    ['tennis', 'tennis/atp', 'ATP', 'all', 4], ['tennis', 'tennis/wta', 'WTA', 'all', 4], ['ufc', 'mma/ufc', 'UFC', null, 8],
  ];
  const SPORTS = [['all', 'All'], ['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC'], ['boxing', 'Boxing']];
  const TINT = { soccer: '#3DDC84', football: '#C9A15A', basketball: '#FF8A3D', baseball: '#FF5C6C', hockey: '#7CC8FF', tennis: '#D4F54A', ufc: '#E2263C', boxing: '#B3122E' };
  const H = { games: [], ufc: [], box: [], at: 0, loading: false, filter: 'all', err: 0 };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  H.filter = store.get('fl.hubFilter', 'all');

  /* ---------- the page itself ---------- */
  const sec = document.createElement('section'); sec.id = 'hub'; sec.className = 'hub'; sec.setAttribute('aria-label', 'Live Hub'); sec.hidden = true;
  document.querySelector('.shell')?.prepend(sec);

  const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  const j = url => timeout(fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }), 9000);
  const hex = c => c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c : null;
  const ml = o => { const n = parseFloat(o); if (!isFinite(n) || !n) return null; return n < 0 ? -n / (-n + 100) : 100 / (n + 100) };

  function norm(ev, f) {
    const [sport, path, short, lg, weight] = f;
    const comps = ev.competitions?.length ? ev.competitions : (ev.groupings || []).flatMap(g => g.competitions || []);
    if (sport === 'ufc') return [];   // UFC is shown by event, below
    return comps.slice(0, sport === 'tennis' ? 12 : 1).map(c => {
      const st = c.status?.type || ev.status?.type || {}, cs = c.competitors || [];
      const home = cs.find(x => x.homeAway === 'home') || cs[0] || {}, away = cs.find(x => x.homeAway === 'away') || cs[1] || {};
      const side = x => { const t = x.team || x.athlete || {}; return { id: String(t.id || x.id || ''), name: t.shortDisplayName || t.displayName || t.name || '', full: t.displayName || '', logo: t.logo || t.logos?.[0]?.href || t.headshot?.href || t.flag?.href || '',
        score: x.score?.displayValue ?? x.score ?? '', rank: x.curatedRank?.current && x.curatedRank.current <= 25 ? x.curatedRank.current : '', color: hex(t.color), record: x.records?.[0]?.summary || '', winner: !!x.winner, ml: null } };
      const us = !['soccer', 'tennis'].includes(sport), a = side(us ? away : home), b = side(us ? home : away);   // US scoreboards read away at home; soccer reads home first
      const odds = c.odds?.[0];
      if (odds) { a.ml = ml(odds.awayTeamOdds?.moneyLine ?? odds.moneyline?.away?.close?.odds); b.ml = ml(odds.homeTeamOdds?.moneyLine ?? odds.moneyline?.home?.close?.odds) }
      const leaders = (c.leaders || []).flatMap(cat => (cat.leaders || []).slice(0, 1).map(l => ({ cat: cat.displayName || cat.name, abbr: cat.abbreviation || '', val: +l.value || 0, show: l.displayValue, name: l.athlete?.displayName || l.athlete?.fullName, shot: l.athlete?.headshot?.href || l.athlete?.headshot || '', team: l.team?.id || l.athlete?.team?.id || '' })));
      return { key: `${sport}:${c.id || ev.id}`, sport, path, lg, short, league: ev.league?.abbreviation || c.league?.abbreviation || (sport === 'soccer' ? (ev.season?.slug || '') : short),
        lgName: sport === 'soccer' ? (c.competitionType?.text || '') : short, id: String(sport === 'tennis' ? c.id : ev.id), date: new Date(c.date || ev.date), state: st.state || 'pre',
        clock: st.shortDetail || st.detail || '', detail: st.shortDetail || st.detail || '', final: st.shortDetail || 'Final', a, b, weight, leaders,
        tv: c.broadcasts?.[0]?.names?.[0] || c.geoBroadcasts?.[0]?.media?.shortName || '', note: /postpon|cancel|delay/i.test(st.description || '') ? st.description : '' };
    });
  }
  function ufcNorm(ev) {
    const bouts = (ev.competitions || []).map(c => { const cs = c.competitors || []; const f = x => ({ name: x?.athlete?.displayName || '', photo: x?.athlete?.headshot?.href || '', rec: x?.records?.[0]?.summary || '', win: !!x?.winner });
      return { a: f(cs[0]), b: f(cs[1]), cls: c.type?.text || '', state: c.status?.type?.state || 'pre', detail: c.status?.type?.shortDetail || '', date: new Date(c.date || ev.date) } });
    const v = ev.competitions?.[0]?.venue || ev.venues?.[0] || {};
    const main = bouts[bouts.length - 1] || bouts[0];
    return { id: String(ev.id), name: ev.name || 'UFC', date: new Date(ev.date), state: bouts.some(b => b.state === 'in') ? 'in' : bouts.length && bouts.every(b => b.state === 'post') ? 'post' : 'pre',
      place: [v.fullName, v.address?.city, v.address?.country].filter(Boolean).join(' · '), main, bouts, live: bouts.find(b => b.state === 'in') };
  }

  async function load(force) {
    if (H.loading || (!force && Date.now() - H.at < 25000)) return;
    H.loading = true;
    const day = ymd(new Date());
    const jobs = FEEDS.map(f => j(`${ESPN}${f[1]}/scoreboard${f[0] === 'ufc' || f[0] === 'tennis' ? '' : `?dates=${day}`}${f[1].includes('college') ? (f[0] === 'basketball' ? '&groups=50' : '') : ''}`)
      .then(d => f[0] === 'ufc' ? (H.ufc = (d.events || []).map(ufcNorm), []) : (d.events || []).flatMap(ev => norm(ev, f))).catch(() => { H.err++; return [] }));
    jobs.push(j('/api/box/cards').then(d => { H.box = d.events || []; return [] }).catch(() => []));
    const all = (await Promise.all(jobs)).flat();
    // tennis: only today's and live matches, not the whole tournament
    const now = Date.now();
    H.games = all.filter(g => g.state === 'in' || Math.abs(+g.date - now) < 20 * 36e5 && sameLocalDay(g.date) || (g.state === 'post' && now - g.date < 12 * 36e5));
    H.at = Date.now(); H.loading = false;
    if (root.classList.contains('hub-on')) paint();
    document.dispatchEvent(new CustomEvent('fl:hub', { detail: { live: liveGames().length } }));
  }
  const sameLocalDay = d => { const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() };
  const pick = g => H.filter === 'all' || g.sport === H.filter;
  const liveGames = () => H.games.filter(g => g.state === 'in');

  /* ---------- pieces ---------- */
  const card = g => window.flCard({ id: g.key, attrs: `data-hub="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}"`, hc: g.a.color || TINT[g.sport], ac: g.b.color || TINT[g.sport],
    label: `${g.a.full || g.a.name} ${g.state === 'pre' ? 'v' : g.a.score + ' to ' + g.b.score} ${g.b.full || g.b.name}, ${g.short}`, state: g.state, lg: g.lgName || g.short, tv: g.tv,
    a: { name: g.a.name, logo: g.a.logo, score: g.a.score, rank: g.a.rank, lose: g.state === 'post' && g.b.winner, win: g.a.winner }, b: { name: g.b.name, logo: g.b.logo, score: g.b.score, rank: g.b.rank, lose: g.state === 'post' && g.a.winner, win: g.b.winner },
    clock: g.clock, final: g.final, note: g.note, date: g.date });
  const ico = k => (window.flShell?.ic ? window.flShell.ic(k === 'ufc' ? 'boxing' : k, 16) : '');
  const ini = n => esc((n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'hb-face') => src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<span class=&quot;${cls} ini&quot;>${ini(name)}</span>'">` : `<span class="${cls} ini">${ini(name)}</span>`;

  function countdown(ts, id) {
    const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
    const p = [[Math.floor(s / 86400), 'Days'], [Math.floor(s / 3600) % 24, 'Hrs'], [Math.floor(s / 60) % 60, 'Min'], [s % 60, 'Sec']];
    return `<div class="hb-cd" data-hubcd="${+ts}" aria-label="Starts ${new Date(ts).toLocaleString()}">${p.map(([n, l]) => `<span><b class="num">${String(n).padStart(2, '0')}</b><small>${l}</small></span>`).join('')}</div>`;
  }
  function fightTile() {
    const ufc = H.ufc.find(e => e.state !== 'post') || H.ufc[0];
    const now = Date.now(), bxWhen = e => e.ts ? new Date(e.ts) : new Date(e.date + 'T20:00:00');
    const box = (H.box || []).filter(e => !e.postponed && (bxWhen(e) > now - 6 * 36e5) && e.status !== 'FT').sort((a, b) => bxWhen(a) - bxWhen(b))[0];
    const t = [];
    if (ufc && (H.filter === 'all' || H.filter === 'ufc')) {
      const m = ufc.live || ufc.main || {};
      t.push(`<article class="hb hb-fight ufc" style="--t:${TINT.ufc}"><button class="hb-hit" data-hubgo="ufc" aria-label="Open ${esc(ufc.name)}"></button>
        <header><span class="hb-k">${ico('ufc')} Next UFC event</span>${ufc.state === 'in' ? '<span class="hub-live-b"><i></i>Live</span>' : ''}</header>
        <h3>${esc(ufc.name)}</h3>
        <div class="hb-vs">${face(m.a?.photo, m.a?.name, 'hb-fp')}<span><b>${esc(m.a?.name || 'TBA')}</b><small>${esc(m.a?.rec || '')}</small></span><i>VS</i><span><b>${esc(m.b?.name || 'TBA')}</b><small>${esc(m.b?.rec || '')}</small></span>${face(m.b?.photo, m.b?.name, 'hb-fp')}</div>
        ${ufc.state === 'pre' ? countdown(+ufc.date) : `<p class="hb-sub">${esc(ufc.live ? ufc.live.detail : 'Fight night under way')}</p>`}
        <p class="hb-sub">${esc(ufc.place || ufc.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</p></article>`);
    }
    if (box && (H.filter === 'all' || H.filter === 'boxing')) {
      t.push(`<article class="hb hb-fight box" style="--t:${TINT.boxing}"><button class="hb-hit" data-hubgo="boxing" data-hubid="${esc(box.id)}" aria-label="Open ${esc(box.name)}"></button>
        <header><span class="hb-k">${ico('boxing')} Next boxing night</span></header>
        <h3>${esc(box.series || box.name)}</h3>
        <div class="hb-vs"><span class="hb-fp ini">${ini(box.a)}</span><span><b>${esc(box.a || 'TBA')}</b></span><i>VS</i><span><b>${esc(box.b || 'TBA')}</b></span><span class="hb-fp ini">${ini(box.b)}</span></div>
        ${countdown(+bxWhen(box))}
        <p class="hb-sub">${esc([box.venue, box.city].filter(Boolean).join(' · '))}</p></article>`);
    }
    return t.join('');
  }
  function hot(list) {
    const rows = list.filter(g => g.state === 'pre' && (g.a.ml || g.b.ml)).map(g => { const pa = g.a.ml || 0, pb = g.b.ml || 0, s = pa + pb || 1; const fav = pa >= pb ? g.a : g.b; return { g, fav, p: Math.max(pa, pb) / s } })
      .sort((x, y) => y.p - x.p).slice(0, 5);
    if (!rows.length) return '';
    return `<article class="hb hb-hot"><header><span class="hb-k">Hot predictions</span><small>Highest confidence today</small></header><ol>${rows.map(({ g, fav, p }, i) => {
      const pc = Math.round(p * 100), C = 2 * Math.PI * 17;
      return `<li><button data-hub="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}" style="--i:${i}"><svg class="hb-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><circle class="a" cx="20" cy="20" r="17" style="stroke-dasharray:${(C * p).toFixed(1)} ${C.toFixed(1)}"/></svg><b class="hb-pc num" data-count="${pc}">${pc}%</b>
        <span class="hb-hn"><strong>${esc(fav.name)}</strong><small>${esc(g.a.name)} v ${esc(g.b.name)} · ${esc(g.short)} · ${g.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></span></button></li>` }).join('')}</ol></article>`;
  }
  function trending(list) {
    const seen = new Set(), rows = [];
    for (const g of list.filter(g => g.state !== 'pre').sort((a, b) => b.weight - a.weight)) for (const l of g.leaders) {
      if (!l.name || seen.has(l.name)) continue;
      const rank = /point|goal/i.test(l.cat) ? 3 : /rating|passing|yards/i.test(l.cat) ? 2 : 1;
      seen.add(l.name); rows.push({ ...l, g, score: g.weight * 10 + rank * 5 + Math.min(l.val, 60) / 4 });
    }
    rows.sort((a, b) => b.score - a.score);
    if (!rows.length) return '';
    return `<article class="hb hb-trend"><header><span class="hb-k">Trending players</span><small>Standout lines from today's games</small></header><div class="hb-tr">${rows.slice(0, 6).map((r, i) => `
      <button class="hb-tp" data-hub="${esc(r.g.sport)}|${esc(r.g.lg || '')}|${esc(r.g.id)}" style="--i:${i}">${face(r.shot, r.name)}<span><strong>${esc(r.name)}</strong><small>${esc(r.g.a.name)} · ${esc(r.g.b.name)}</small></span><em class="num">${esc(r.show || r.val)}<small>${esc(r.abbr || r.cat)}</small></em></button>`).join('')}</div></article>`;
  }
  function favs(list) {
    const F = (window.S?.fav || []), names = new Set(F.map(f => (f.name || '').toLowerCase())), ids = new Set(F.flatMap(f => [String(f.tid || ''), String(f.id || '')]));
    if (!F.length) return '';
    const mine = list.filter(g => [g.a, g.b].some(t => ids.has(t.id) || names.has((t.full || '').toLowerCase()) || names.has((t.name || '').toLowerCase())));
    return `<article class="hb hb-fav"><header><span class="hb-k">★ My favorites</span><small>${mine.length ? `${mine.length} playing today` : 'None of your teams play today'}</small></header>
      <div class="hb-chips">${F.slice(0, 12).map(f => `<span class="hb-chip">${f.logo ? `<img src="${esc(f.logo)}" alt="" loading="lazy">` : ''}${esc(f.name)}</span>`).join('')}</div>
      ${mine.length ? `<div class="hb-cards">${mine.slice(0, 4).map(card).join('')}</div>` : ''}</article>`;
  }

  function paint() {
    const list = H.games.filter(pick), live = list.filter(g => g.state === 'in');
    const counts = Object.fromEntries(SPORTS.map(([k]) => [k, k === 'all' ? H.games.length : k === 'ufc' ? H.ufc.filter(e => e.state !== 'post').length : k === 'boxing' ? 0 : H.games.filter(g => g.sport === k).length]));
    const liveBy = k => H.games.filter(g => g.state === 'in' && (k === 'all' || g.sport === k)).length;
    const big = list.filter(g => g.state !== 'post' || Date.now() - g.date < 4 * 36e5).map(g => ({ g, s: g.weight * 10 + (g.state === 'in' ? 25 : 0) + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0) + (g.tv ? 4 : 0) - Math.abs(g.date - Date.now()) / 36e5 }))
      .sort((x, y) => y.s - x.s).slice(0, 8).map(x => x.g);
    const now = new Date();
    const scroll = sec.querySelector('.hub-strip')?.scrollLeft || 0;
    sec.innerHTML = `
      <header class="hub-head"><div><span class="hub-kick"><i></i>Live Hub</span><h1>Right now</h1>
        <p>${now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · <b class="num">${H.games.filter(g => g.state === 'in').length}</b> live · <b class="num">${H.games.length}</b> games today</p></div>
        <div class="hub-upd">${H.loading && !H.at ? 'Loading…' : `Updated ${new Date(H.at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</div></header>
      <div class="hub-chips" role="toolbar" aria-label="Filter by sport">${SPORTS.map(([k, l]) => `<button class="hub-chip${H.filter === k ? ' on' : ''}" data-hubf="${k}" aria-pressed="${H.filter === k}" style="--t:${TINT[k] || 'var(--accent)'}">${k === 'all' ? '' : ico(k)}${l}${liveBy(k) && k !== 'all' ? `<i class="hub-dot" title="${liveBy(k)} live"></i>` : ''}${counts[k] ? `<small class="num">${counts[k]}</small>` : ''}</button>`).join('')}</div>
      <section class="hub-live" aria-label="Live now"><h2><span class="hub-live-b"><i></i>Live now</span><small>${live.length ? `${live.length} game${live.length > 1 ? 's' : ''} · updates every 30s` : ''}</small></h2>
        ${live.length ? `<div class="hub-strip">${live.map(card).join('')}</div>` : H.at ? `<div class="hub-empty"><b>Nothing live${H.filter !== 'all' ? ' in ' + esc(SPORTS.find(s => s[0] === H.filter)?.[1]) : ''} right now</b><span>${(() => { const nx = list.filter(g => g.state === 'pre').sort((a, b) => a.date - b.date)[0]; return nx ? `Next up: ${esc(nx.a.name)} v ${esc(nx.b.name)}, ${nx.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Check back later today.' })()}</span></div>` : `<div class="hub-strip">${'<div class="hub-sk"></div>'.repeat(4)}</div>`}</section>
      <div class="hub-bento">
        ${favs(H.games)}
        <article class="hb hb-big"><header><span class="hb-k">Today's biggest games</span><small>Across every sport</small></header>
          <div class="hb-cards">${big.length ? big.map(card).join('') : H.at ? '<div class="hub-empty"><b>No games found for today</b><span>Try another sport.</span></div>' : '<div class="hub-sk"></div>'.repeat(4)}</div></article>
        ${fightTile()}
        ${hot(list)}
        ${trending(list)}
      </div>`;
    const st = sec.querySelector('.hub-strip'); if (st) st.scrollLeft = scroll;
    if (!sec.dataset.shown) { sec.dataset.shown = 1; sec.classList.add('hub-in'); setTimeout(() => sec.classList.remove('hub-in'), 900) }
  }

  /* ---------- showing and leaving the hub ---------- */
  let poll = 0;
  function show() {
    root.classList.add('hub-on'); sec.hidden = false;
    window.S && S.stack?.length && typeof closeSheet === 'function' && closeSheet();
    paint(); load(); scrollTo({ top: 0 });
    clearInterval(poll); poll = setInterval(() => { if (!document.hidden && root.classList.contains('hub-on')) load(true) }, 30000);
    window.flShell?.sync?.();
  }
  function hide() { if (!root.classList.contains('hub-on')) return; root.classList.remove('hub-on'); sec.hidden = true; clearInterval(poll) }
  window.flHub = { show, hide, load, on: () => root.classList.contains('hub-on') };

  // Home opens the hub (capture phase, ahead of the older Home behaviour in shell.js)
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-shell="home"]'); if (!t) return;
    ev.stopPropagation(); document.getElementById('flSheet') && (document.getElementById('flSheet').hidden = true); show();
  }, true);
  // anything that navigates to a sport, a section or a profile leaves it
  document.addEventListener('click', ev => {
    if (ev.target.closest?.('#hub')) return;
    if (ev.target.closest?.('[data-sport],[data-shell]:not([data-shell="home"]):not([data-shell="sports"]),[data-rs],.rail button,#profileBtn,.ticker [data-ev],.ticker button')) hide();
  }, true);

  // inside the hub: filters, games, fight nights
  sec.addEventListener('click', ev => {
    const f = ev.target.closest('[data-hubf]');
    if (f) { H.filter = f.dataset.hubf; store.set('fl.hubFilter', H.filter); return paint() }
    const go = ev.target.closest('[data-hubgo]');
    if (go) return openFight(go.dataset.hubgo, go.dataset.hubid);
    const g = ev.target.closest('[data-hub]'); if (!g) return;
    const [sport, lg, id] = g.dataset.hub.split('|');
    openGame(sport, lg, id, g);
  });

  const ATTR = { soccer: 'data-ev', basketball: 'data-bbgame', football: 'data-fbgame', hockey: 'data-hkgame', baseball: 'data-bsgame', tennis: 'data-tngame' };
  const STATE = { basketball: ['bb', 'fl.bbLg'], football: ['fb', 'fl.fbLg'], hockey: ['hk', 'fl.hkLg'], baseball: ['bsb', 'fl.bsbLg'], tennis: ['tn', null] };
  let opening = 0;
  function switchTo(sport) {
    hide();
    const b = document.querySelector(`.fsn[data-sport="${sport}"]`) || document.querySelector(`[data-sport="${sport}"]`);
    if (window.S?.sport !== sport || !b) { if (b) b.click(); else if (typeof setSport === 'function') setSport(sport) }
  }
  async function openGame(sport, lg, id, btn) {
    const seq = ++opening; btn?.classList.add('hub-opening');
    const st = STATE[sport];
    if (st && window.S?.[st[0]] && lg && 'lg' in S[st[0]]) { S[st[0]].lg = lg; if (st[1]) store.set(st[1], lg); if ('view' in S[st[0]]) S[st[0]].view = 'games' }
    switchTo(sport);
    if (sport === 'soccer' && typeof select === 'function') { await select(id); return }
    // wait for the sport page to draw the game, then open it the same way a click on its card would
    for (let i = 0; i < 40 && seq === opening; i++) {
      const el = document.querySelector(`[${ATTR[sport]}="${CSS.escape(id)}"]`);
      if (el) { el.click(); return }
      await new Promise(r => setTimeout(r, 200));
    }
    if (seq === opening) toast('That game is on the ' + sport + ' page; it may be under another league or day.');
  }
  function openFight(kind, id) {
    if (kind === 'ufc') { switchTo('ufc'); if (typeof render === 'function') render(); return }
    if (window.S?.bx) { S.bx.tab = 'boxing'; store.set('fl.bxTab', 'boxing') }
    switchTo('boxing');
    if (typeof render === 'function') render();
    if (kind === 'boxing' && id) setTimeout(() => document.querySelector(`[data-bxfight="${CSS.escape(id)}"]`)?.click(), 600);
  }
  function toast(t) { const host = $('toasts'); if (!host) return; const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; host.appendChild(d); setTimeout(() => d.remove(), 4200) }

  // countdowns tick every second while the hub is on screen
  setInterval(() => {
    if (document.hidden || !root.classList.contains('hub-on')) return;
    sec.querySelectorAll('[data-hubcd]').forEach(el => { const s = Math.max(0, Math.floor((+el.dataset.hubcd - Date.now()) / 1000)), v = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
      el.querySelectorAll('b').forEach((b, i) => { const t = String(v[i]).padStart(2, '0'); if (b.textContent !== t) b.textContent = t }) });
  }, 1000);

  // the hub is the landing page, unless the address asks for something else
  load();
  if (!location.hash && !/[?&](sport|match|rs)=/.test(location.search) && store.get('fl.hubLanding', true)) show();
  else setInterval(() => { if (!document.hidden && !root.classList.contains('hub-on')) load() }, 120000);   // keeps the sidebar's live count right
})();
