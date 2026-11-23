/* Floodlight · the command palette (Cmd/Ctrl + K) and a few site-wide touches.
   The palette jumps anywhere: any page or sport, any game on today's Live Hub, any team playing today, UFC events and
   fighters, and looking a name up in the Lab. Arrow keys move, Enter opens, Esc closes.
   Also here: live toasts when a followed team scores or a game ends. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (k, s = 18) => window.flShell?.ic ? window.flShell.ic(k, s) : '';
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const still = () => matchMedia('(prefers-reduced-motion:reduce)').matches || document.documentElement.dataset.motion === 'reduce';
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- the dialog ---------- */
  const bg = document.createElement('div'); bg.className = 'cmdk-bg'; bg.hidden = true;
  bg.innerHTML = `<div class="cmdk" role="dialog" aria-modal="true" aria-label="Jump anywhere">
    <label class="cmdk-in"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="cmdkQ" type="text" placeholder="Jump to a game, team, fighter, sport or page…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list"><kbd>Esc</kbd></label>
    <div class="cmdk-list" id="cmdkList" role="listbox"></div>
    <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>${MAC ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd> toggle</span></div></div>`;
  document.body.appendChild(bg);
  const input = bg.querySelector('#cmdkQ'), list = bg.querySelector('#cmdkList');
  let items = [], sel = 0, lastFocus = null;

  const SPORT_NAMES = { soccer: 'Soccer', football: 'Football', basketball: 'Basketball', baseball: 'Baseball', hockey: 'Hockey', tennis: 'Tennis', ufc: 'UFC', boxing: 'Boxing' };
  function pages() {
    const go = sel => () => document.querySelector(sel)?.click();
    return [
      { g: 'Pages', t: 'Home · Live Hub', s: 'Everything happening right now', i: 'home', run: go('[data-shell="home"]') },
      { g: 'Pages', t: 'The Lab', s: 'Players, teams and props', i: 'research', run: () => window.flPages?.show('lab') },
      { g: 'Pages', t: 'Predictions', s: "Today's picks for the current sport", i: 'pred', run: go('[data-shell="pred"]') },
      { g: 'Pages', t: 'Favorites', s: 'Your teams and players', i: 'fav', run: go('[data-shell="fav"]') },
      { g: 'Pages', t: 'Profile', s: 'Account, picks and settings', i: 'profile', run: go('[data-shell="profile"]') },
      { g: 'Pages', t: 'Live now', s: 'Games in progress', i: 'live', run: go('[data-shell="live"]') },
      ...Object.entries(SPORT_NAMES).map(([k, l]) => ({ g: 'Sports', t: l, s: 'Open the ' + l + ' page', i: k, run: () => (document.querySelector(`.fsn[data-sport="${k}"]`) || document.querySelector(`[data-sport="${k}"]`))?.click() })),
    ];
  }
  function games() {
    const G = window.flHub?.games?.() || [];
    return G.map(g => ({ g: g.state === 'in' ? 'Live games' : 'Today', t: `${g.a.name} ${g.state === 'pre' ? 'v' : `${g.a.score}–${g.b.score}`} ${g.b.name}`,
      s: `${g.short}${g.state === 'in' ? ' · ' + g.clock : g.state === 'pre' ? ' · ' + g.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ' · Final'}`, i: g.sport === 'ufc' ? 'ufc' : g.sport,
      k: norm(`${g.a.name} ${g.a.full} ${g.b.name} ${g.b.full} ${g.short}`), live: g.state === 'in', run: () => window.flHub.open(g) }));
  }
  function teams() {
    const seen = new Set(), out = [];
    for (const g of window.flHub?.games?.() || []) for (const t of [g.a, g.b]) { const n = t.full || t.name; if (!n || seen.has(n)) continue; seen.add(n);
      out.push({ g: 'Teams playing today', t: n, s: `${SPORT_NAMES[g.sport] || g.short} · ${g.a.name} v ${g.b.name}`, i: g.sport, img: t.logo, k: norm(n), run: () => window.flHub.open(g) }) }
    return out;
  }
  function fighters() {
    if (typeof ufcAll !== 'function') return [];
    const evs = ufcAll(), seen = new Set(), out = [];
    for (const e of evs.slice(-60)) for (const b of e.bouts) for (const f of [b.a, b.b]) { if (!f.id || seen.has(f.id)) continue; seen.add(f.id);
      out.push({ g: 'UFC fighters', t: f.name, s: f.rec ? `${f.rec} · ${e.name.replace(/:.*/, '')}` : e.name, i: 'ufc', k: norm(f.name), run: () => { if (window.S?.sport !== 'ufc') document.querySelector('.fsn[data-sport="ufc"]')?.click(); setTimeout(() => ufcOpenFighter(f.id), 60) } }) }
    for (const e of evs) out.push({ g: 'UFC events', t: e.name, s: `${e.date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}${e.state === 'post' ? ' · results' : ''}`, i: 'ufc', k: norm(e.name), run: () => { if (window.S?.sport !== 'ufc') document.querySelector('.fsn[data-sport="ufc"]')?.click(); setTimeout(() => ufcOpenEvent(e.id), 60) } });
    return out;
  }
  function research(q) {
    return q.length < 2 ? [] : [{ g: 'The Lab', t: `Look up “${q}” in the Lab`, s: 'Players, teams and props', i: 'research', run: () => {
      window.flPages?.show('lab');
      let n = 0; const fill = () => { const inp = document.getElementById('labAsk');
        if (inp) { inp.value = q; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); return }
        if (n++ < 20) setTimeout(fill, 150) }; fill() } }];
  }

  function score(it, q) {
    if (!q) return 1;
    const k = it.k || norm(it.t + ' ' + (it.s || '')), w = q.split(/\s+/).filter(Boolean);
    if (!w.every(x => k.includes(x))) return 0;
    return (norm(it.t).startsWith(q) ? 3 : 1) + (it.live ? .5 : 0);
  }
  function build() {
    const q = norm(input.value.trim());
    const pool = q ? [...pages(), ...games(), ...teams(), ...fighters()] : [...pages().slice(0, 6), ...games().filter(x => x.live).slice(0, 6), ...pages().slice(6)];
    items = pool.map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, q ? 40 : 30).map(x => x.it);
    if (q) items.push(...research(input.value.trim()));
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let last = '';
    list.innerHTML = items.length ? items.map((it, i) => { const head = it.g !== last ? `<div class="cmdk-g">${esc(it.g)}</div>` : ''; last = it.g;
      return `${head}<button class="cmdk-i${i === sel ? ' on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}" id="cmdk${i}">
        <span class="cmdk-ic">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" onerror="this.remove()">` : ic(it.i)}</span><span class="cmdk-t"><b>${esc(it.t)}</b><small>${esc(it.s || '')}</small></span>${it.live ? '<span class="cmdk-live">Live</span>' : ''}<kbd>↵</kbd></button>` }).join('')
      : `<div class="cmdk-none">Nothing matches “${esc(input.value)}”.</div>`;
    input.setAttribute('aria-activedescendant', items.length ? 'cmdk' + sel : '');
  }
  function move(d) { if (!items.length) return; sel = (sel + d + items.length) % items.length; list.querySelectorAll('.cmdk-i').forEach((b, i) => { b.classList.toggle('on', i === sel); b.setAttribute('aria-selected', i === sel) }); list.querySelector('.cmdk-i.on')?.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', 'cmdk' + sel) }
  function open() { lastFocus = document.activeElement; bg.hidden = false; input.value = ''; sel = 0; build(); requestAnimationFrame(() => input.focus()); window.flHub?.load?.() }
  function close(restore = true) { if (bg.hidden) return; bg.hidden = true; if (restore) lastFocus?.focus?.() }
  function run(i) { const it = items[i]; if (!it) return; close(false); try { it.run() } catch (e) { console.warn(e) } }
  window.flPalette = { open, close };

  // capture phase, so the older Cmd/Ctrl+K (research) in shell.js does not also fire
  addEventListener('keydown', ev => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopImmediatePropagation(); bg.hidden ? open() : close(); return }
    if (bg.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close() }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1) }
    else if (ev.key === 'Enter') { ev.preventDefault(); run(sel) }
  }, true);
  input.addEventListener('input', () => { sel = 0; build() });
  list.addEventListener('click', ev => { const b = ev.target.closest('.cmdk-i'); if (b) run(+b.dataset.i) });
  list.addEventListener('pointermove', ev => { const b = ev.target.closest('.cmdk-i'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; move(0) } });
  bg.addEventListener('pointerdown', ev => { if (ev.target === bg) close() });
  // the search box in the header opens the palette too, on a long-press of "/" or a click on the shortcut hint
  addEventListener('keydown', ev => { if (ev.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) { ev.preventDefault(); open() } });

  /* ---------- live toasts: a followed team scores, or a followed game ends ---------- */
  const seen = new Map();
  document.addEventListener('fl:hub', () => {
    if (window.flAlerts?.on()) return;   // with alerts on, alerts.js says it (as a notification, or a note like this one)
    const favs = (window.S?.fav || []).map(f => norm(f.name)).filter(Boolean); if (!favs.length) return;
    for (const g of window.flHub?.games?.() || []) {
      const mine = [g.a, g.b].some(t => favs.includes(norm(t.full)) || favs.includes(norm(t.name))); if (!mine) continue;
      const key = g.key, now = `${g.state}|${g.a.score}|${g.b.score}`, was = seen.get(key); seen.set(key, now);
      if (!was || was === now) continue;
      const [ws] = was.split('|');
      if (g.state === 'post' && ws !== 'post') toast(`Final: ${g.a.name} ${g.a.score}–${g.b.score} ${g.b.name}`, g);
      else if (g.state === 'in') toast(`${g.short}: ${g.a.name} ${g.a.score}–${g.b.score} ${g.b.name}`, g, true);
    }
  });
  function toast(text, g, hot) {
    const host = document.getElementById('toasts'); if (!host) return;
    const t = document.createElement('button'); t.className = 'toast fl-toast' + (hot ? ' hot' : ''); t.innerHTML = `${hot ? '<i></i>' : ''}<span>${esc(text)}</span>`;
    t.addEventListener('click', () => { window.flHub?.open?.(g); t.remove() });
    host.appendChild(t); setTimeout(() => t.classList.add('out'), 6500); setTimeout(() => t.remove(), 7000);
  }

})();
