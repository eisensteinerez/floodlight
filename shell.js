/* Floodlight · the app shell: the sidebar on desktop and the bottom bar on phones.
   It adds no navigation logic of its own. Every button carries the same data attributes the page already listens for
   (data-sport, data-f, data-act, data-rs), so the existing code does the work and this file only draws and tracks state. */
(() => {
  const el = id => document.getElementById(id);
  const still = () => matchMedia('(prefers-reduced-motion:reduce)').matches || document.documentElement.dataset.motion === 'reduce';
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M7.800 16.200a6 6 0 0 1 0-8.400M16.200 7.800a6 6 0 0 1 0 8.400M4.900 19.100a10 10 0 0 1 0-14.200M19.100 4.900a10 10 0 0 1 0 14.200"/>',
    soccer: '<circle cx="12" cy="12" r="9"/><path d="M12 7.500l4 2.900-1.500 4.700h-5L8 10.400zM12 3v4.500M3.600 9.600 8 10.400M20.400 9.600 16 10.400M6.500 19l3-3.900M17.500 19l-3-3.900"/>',
    football: '<path d="M4 20c-1-6 2-13 9-15 3-1 6-1 7-1 0 1 0 4-1 7-2 7-9 10-15 9zM9 15l6-6M10.500 10.500l3 3M12.500 8.500l3 3M8.500 12.500l3 3"/>',
    basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.600 5.600c3 3 3 9.800 0 12.800M18.400 5.600c-3 3-3 9.800 0 12.800"/>',
    baseball: '<circle cx="12" cy="12" r="9"/><path d="M6.500 5c2.500 4 2.500 10 0 14M17.500 5c-2.500 4-2.500 10 0 14"/>',
    hockey: '<path d="M6 3l7 14h5a2 2 0 0 1 0 4h-7L4 4"/><path d="M3 20.500h3.500"/>',
    tennis: '<circle cx="12" cy="12" r="9"/><path d="M5 6c4 2 6 6 5 13M19 18c-4-2-6-6-5-13"/>',
    ufc: '<path d="M8.5 3h7l5.5 5.5v7L15.5 21h-7L3 15.5v-7z"/><path d="M9 9.500h6M9 12h6M9 14.500h4"/>',
    boxing: '<path d="M7 20h8v-4l3-3V8a3 3 0 0 0-3-3h-.5A2.5 2.5 0 0 0 12 3H9a3 3 0 0 0-3 3v2.5A2.5 2.5 0 0 0 4 11v1a3 3 0 0 0 3 3zM7 16h8M10 9h5"/>',
    research: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.300-4.300"/>',
    pred: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    fav: '<path d="M12 3l2.800 5.700 6.200.9-4.500 4.400 1.100 6.200L12 17.300l-5.600 2.900 1.100-6.200L3 9.600l6.200-.9z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  };
  const ic = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
  const SPORTS = [['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC'], ['boxing', 'Boxing']];
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const root = document.documentElement;
  root.dataset.sport = S.sport || 'soccer';

  /* ---------- sidebar ---------- */
  const side = document.createElement('aside'); side.id = 'flSide'; side.className = 'flside'; side.setAttribute('aria-label', 'Main menu');
  const item = (k, label, attrs, extra = '') => `<button class="fsn" data-k="${k}" ${attrs} title="${label}">${ic(k)}<span class="fsn-l">${label}</span>${extra}</button>`;
  side.innerHTML = `<div class="fls-brand"><span class="fls-mark">${ic('bolt', 18)}</span><b>Floodlight</b></div>
    <button class="fls-jump" type="button" onclick="window.flPalette && flPalette.open()" title="Jump anywhere">${ic('research', 16)}<span class="fsn-l">Jump to…</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl '}K</kbd></button>
    <nav class="fls-nav" id="sideNav" aria-label="Sections"><div class="fls-ind" id="sideInd" hidden></div>
      ${item('home', 'Home', 'data-shell="home"')}
      ${item('live', 'Live', 'data-shell="live"', '<span class="fsn-live" id="sideLive" hidden><i></i><b></b></span>')}
      <h4>Sports</h4>
      ${SPORTS.map(([k, l]) => item(k, l, `data-sport="${k}"`)).join('')}
      <h4>You</h4>
      ${item('research', 'Research', 'data-rs="open"')}
      ${item('pred', 'Predictions', 'data-shell="pred"')}
      ${item('fav', 'Favorites', 'data-shell="fav"')}
      ${item('profile', 'Profile', 'data-shell="profile"')}
    </nav>
    <div class="fls-comp" id="sideComp"></div>
    <button class="fsn fls-collapse" id="sideCollapse" aria-pressed="false" title="Collapse menu">${ic('left')}<span class="fsn-l">Collapse</span></button>`;
  document.body.prepend(side);
  const rail = el('rail'); if (rail) side.querySelector('#sideComp').appendChild(rail);   // the sport's competitions list lives in the sidebar now

  const setMini = on => { root.classList.toggle('side-mini', on); el('sideCollapse').setAttribute('aria-pressed', on); el('sideCollapse').title = on ? 'Expand menu' : 'Collapse menu' };
  setMini(!!store.get('fl.sideMini', false));
  el('sideCollapse').addEventListener('click', () => { const on = !root.classList.contains('side-mini'); setMini(on); store.set('fl.sideMini', on); setTimeout(sync, 320) });

  /* the sport's own list repeats a few of the entries above; hide those copies */
  const railLabel = b => (b.querySelector('span:not(.dot)')?.textContent || b.textContent).trim();
  const railBtn = re => [...(rail?.querySelectorAll('.lg') || [])].find(b => re.test(railLabel(b)));
  const tidyRail = () => rail?.querySelectorAll('.lg').forEach(b => b.classList.toggle('dup', /^(Predictions|Live now|All matches)$/.test(railLabel(b))));

  /* ---------- Cmd/Ctrl+K: research from anywhere, cursor in its search box ---------- */
  const KBD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  function focusResearch(tries = 0) {
    const rs = document.getElementById('rs'), q = rs && !rs.hidden && rs.querySelector('#rsQ, #rsBq');
    if (q) { q.closest('.search')?.setAttribute('data-kbd', KBD); q.focus(); q.select(); return }
    const fr = rs && rs.querySelector('iframe');
    if (fr) { try { const i = fr.contentDocument?.getElementById('q'); if (i) { fr.contentWindow.focus(); i.focus(); return } } catch (e) {} }
    if (tries < 12) setTimeout(() => focusResearch(tries + 1), 120);
  }
  document.addEventListener('keydown', ev => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      const rs = document.getElementById('rs');
      if (!rs || rs.hidden) { closeSheetUI(); document.querySelector('[data-rs="open"]')?.click() }
      focusResearch();
    }
  });
  new MutationObserver(() => document.querySelectorAll('#rs .rs-search .search:not([data-kbd])').forEach(l => l.setAttribute('data-kbd', KBD)))
    .observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- page transitions: changing sport, day or filter brings the new list in softly, cards one after another ---------- */
  let navT = 0;
  document.addEventListener('click', ev => {
    if (!ev.target.closest?.('[data-sport],[data-iso],[data-days],[data-f],[data-shell="home"],[data-shell="live"],.rail button')) return;
    const main = document.querySelector('.shell'); if (!main) return;
    main.classList.remove('fl-enter'); clearTimeout(navT);
    requestAnimationFrame(() => { main.classList.add('fl-enter'); navT = setTimeout(() => main.classList.remove('fl-enter'), 1100) });
  }, true);

  /* ---------- actions the page has no single attribute for ---------- */
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-shell]'); if (!t) return;
    const a = t.dataset.shell, soccer = S.sport === 'soccer';
    closeSheetUI();
    if (a === 'profile') return typeof openProfile === 'function' && openProfile();
    if (a === 'pred') { const b = railBtn(/^Predictions/); if (b) b.click(); return }
    if (a === 'home') { if (window.flHub) return window.flHub.show(); if (soccer) { clickAttr('data-f', 'all'); if (typeof goToDate === 'function' && typeof sameDay === 'function' && !sameDay(S.date, new Date())) goToDate(new Date()) } else firstRail(); return scrollTo({ top: 0 }) }
    if (a === 'live') { if (soccer) clickAttr('data-f', 'live'); else firstRail(); return scrollTo({ top: 0 }) }
    if (a === 'fav') { if (soccer) clickAttr('data-f', 'fav'); else typeof openProfile === 'function' && openProfile(); return }
    if (a === 'sports') return openSheetUI();
  });
  // run one of the page's own filter clicks without drawing a second button for it
  function clickAttr(attr, v) { const b = document.createElement('button'); b.setAttribute(attr, v); b.setAttribute('data-global', ''); b.hidden = true; document.body.appendChild(b); b.click(); b.remove() }
  function firstRail() { rail?.querySelector('.lg')?.click() }

  /* ---------- bottom bar and sports sheet (phones) ---------- */
  const bar = document.createElement('nav'); bar.id = 'flBar'; bar.className = 'flbar'; bar.setAttribute('aria-label', 'Sections');
  const tab = (k, icon, label, attrs, extra = '') => `<button class="flb" data-k="${k}" ${attrs}>${ic(icon, 22)}<span>${label}</span>${extra}</button>`;
  bar.innerHTML = `<div class="flbar-ind" id="flBarInd"></div>${tab('home', 'home', 'Home', 'data-shell="home"')}${tab('sports', 'grid', 'Sports', 'data-shell="sports" aria-haspopup="dialog"')}
    ${tab('live', 'live', 'Live', 'data-shell="live"', '<b id="flBarLive" hidden></b>')}${tab('research', 'research', 'Research', 'data-rs="open"')}${tab('profile', 'profile', 'Profile', 'data-shell="profile"')}`;
  document.body.appendChild(bar);
  const sheet = document.createElement('div'); sheet.id = 'flSheet'; sheet.className = 'flsheet-bg'; sheet.hidden = true;
  sheet.innerHTML = `<div class="flsheet" role="dialog" aria-modal="true" aria-label="Sports"><h4>Sports</h4>
    <div class="flsheet-grid">${SPORTS.map(([k, l]) => `<button class="flsheet-i" data-sport="${k}">${ic(k)}<span>${l}</span></button>`).join('')}</div>
    <h4>More</h4><div class="flsheet-grid"><button class="flsheet-i" data-shell="pred">${ic('pred')}<span>Predictions</span></button><button class="flsheet-i" data-shell="fav">${ic('fav')}<span>Favorites</span></button>
      <button class="flsheet-i fl-soccer-only" data-act="tc">${ic('swap')}<span>Transfer market</span></button></div></div>`;
  document.body.appendChild(sheet);
  function openSheetUI() { sheet.hidden = false; sheet.querySelector('.flsheet-i')?.focus({ preventScroll: true }); sync() }
  function closeSheetUI() { if (!sheet.hidden) { sheet.hidden = true; sync() } }
  sheet.addEventListener('click', ev => { if (ev.target === sheet || ev.target.closest('.flsheet-i')) setTimeout(closeSheetUI, 0) });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheetUI() });
  function syncBar(k, n) {
    const pf = el('profile'), which = !sheet.hidden ? 'sports' : pf && !pf.hidden ? 'profile' : k === 'research' ? 'research' : k === 'live' ? 'live' : k === 'home' ? 'home' : 'sports';
    const on = bar.querySelector(`.flb[data-k="${which}"]`), ind = el('flBarInd');
    bar.querySelectorAll('.flb').forEach(b => { b.classList.toggle('on', b === on); if (b === on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current') });
    if (on && on.offsetWidth) { ind.style.width = (on.offsetWidth - 10) + 'px'; ind.style.transform = `translateX(${on.offsetLeft + 5}px)` }
    const lv = el('flBarLive'); lv.hidden = !n; lv.textContent = n;
    sheet.querySelectorAll('[data-sport]').forEach(b => b.classList.toggle('on', b.dataset.sport === S.sport));
  }

  /* ---------- keep the highlight on what is showing ---------- */
  function current() {
    if (root.classList.contains('hub-on')) return 'home';
    const rs = el('rs'); if (rs && !rs.hidden) return 'research';
    if (railBtn(/^Predictions/)?.classList.contains('on') || S.page === 'picks') return 'pred';
    if (S.sport === 'soccer' && !S.scope && S.page !== 'transfers') { if (S.filter === 'live') return 'live'; if (S.filter === 'fav') return 'fav' }
    return S.sport || 'soccer';
  }
  let hubLive = 0; document.addEventListener('fl:hub', e => { hubLive = e.detail.live; sync() });
  function liveCount() {
    if (root.classList.contains('hub-on') || hubLive) return hubLive || 0;
    if (S.sport === 'soccer') return [...S.events.values()].filter(e => e.state === 'in').length;
    return [...(rail?.querySelectorAll('.lg:not(.dup) b.live') || [])].reduce((n, b) => n + (+b.textContent || 0), 0);
  }
  function sync() {
    if (root.dataset.sport !== S.sport) root.dataset.sport = S.sport;
    tidyRail();
    const k = current(), nav = el('sideNav'), on = nav.querySelector(`.fsn[data-k="${k}"]`), ind = el('sideInd');
    nav.querySelectorAll('.fsn').forEach(b => { b.classList.toggle('on', b === on); b.classList.toggle('cur', b.dataset.k === S.sport && b !== on); if (b === on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current') });
    if (on) { if (ind.hidden || still()) { ind.style.transition = 'none'; requestAnimationFrame(() => ind.style.transition = '') } ind.hidden = false; ind.style.transform = `translateY(${on.offsetTop}px)` }
    const n = liveCount(), lv = el('sideLive'); lv.hidden = !n; lv.querySelector('b').textContent = n;
    syncBar(k, n);
    document.dispatchEvent(new CustomEvent('fl:shell', { detail: { view: k, live: n } }));
  }
  // the page redraws through render(); follow it, and anything else that changes what is showing
  if (typeof window.render === 'function') { const r = window.render; window.render = function () { const out = r.apply(this, arguments); queueMicrotask(sync); return out } }
  document.addEventListener('click', () => setTimeout(sync, 0));
  if (rail) new MutationObserver(() => { tidyRail(); queueMicrotask(sync) }).observe(rail, { childList: true });
  new MutationObserver(() => { const rs = el('rs'); if (rs && !rs._flWatch) { rs._flWatch = 1; new MutationObserver(sync).observe(rs, { attributes: true, attributeFilter: ['hidden'] }) } sync() }).observe(document.body, { childList: true });
  addEventListener('resize', sync); document.fonts?.ready.then(sync);
  sync();
  window.flShell = { sync, ic, SPORTS, current, liveCount };
})();
