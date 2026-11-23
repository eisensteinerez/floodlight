/* Floodlight · the app shell: the top bar, the sport chips, the three-dot menu and the bottom bar on phones.
   It adds no navigation logic of its own. Every button carries the data attributes the page already listens for
   (data-sport, data-f, data-act, data-page), so the existing code does the work and this file only draws and tracks state. */
(() => {
  const el = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M7.800 16.200a6 6 0 0 1 0-8.400M16.200 7.800a6 6 0 0 1 0 8.400M4.900 19.100a10 10 0 0 1 0-14.200M19.100 4.900a10 10 0 0 1 0 14.200"/>',
    soccer: '<circle cx="12" cy="12" r="9"/><path d="M12 7.500l4 2.900-1.500 4.700h-5L8 10.400zM12 3v4.500M3.600 9.600 8 10.400M20.400 9.600 16 10.400M6.500 19l3-3.900M17.500 19l-3-3.900"/>',
    football: '<path d="M4 20c-1-6 2-13 9-15 3-1 6-1 7-1 0 1 0 4-1 7-2 7-9 10-15 9zM9 15l6-6M10.500 10.500l3 3M12.500 8.500l3 3M8.500 12.500l3 3"/>',
    basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.600 5.600c3 3 3 9.800 0 12.800M18.400 5.600c-3 3-3 9.800 0 12.800"/>',
    baseball: '<circle cx="12" cy="12" r="9"/><path d="M6.500 5c2.500 4 2.500 10 0 14M17.500 5c-2.500 4-2.500 10 0 14"/>',
    hockey: '<path d="M6 3l7 14h5a2 2 0 0 1 0 4h-7L4 4"/><path d="M3 20.500h3.500"/>',
    tennis: '<circle cx="12" cy="12" r="9"/><path d="M5 6c4 2 6 6 5 13M19 18c-4-2-6-6-5-13"/>',
    ufc: '<path d="M8.5 3h7l5.500 5.500v7L15.500 21h-7L3 15.500v-7z"/><path d="M9 9.500h6M9 12h6M9 14.500h4"/>',
    boxing: '<path d="M7 20h8v-4l3-3V8a3 3 0 0 0-3-3h-.5A2.500 2.500 0 0 0 12 3H9a3 3 0 0 0-3 3v2.500A2.500 2.500 0 0 0 4 11v1a3 3 0 0 0 3 3zM7 16h8M10 9h5"/>',
    cfb: '<path d="M4 20c-1-6 2-13 9-15 3-1 6-1 7-1 0 1 0 4-1 7-2 7-9 10-15 9zM9 15l6-6"/>',
    cbb: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/>',
    research: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.300-4.300"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.300-4.300"/>',
    lab: '<path d="M9 3h6M10 3v6.500L4.700 18.300A1.800 1.800 0 0 0 6.200 21h11.600a1.800 1.800 0 0 0 1.500-2.700L14 9.500V3"/><path d="M7.500 15h9"/>',
    pred: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    transfers: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    fav: '<path d="M12 3l2.800 5.700 6.200.9-4.500 4.400 1.100 6.200L12 17.300l-5.600 2.900 1.100-6.200L3 9.600l6.200-.9z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    members: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 4a4 4 0 0 1 0 8M22 21c0-3-1.600-5-4-5.700"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.500 6.500l4 4"/>',
    gear: '<circle cx="12" cy="12" r="3.200"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.400 0 2-1 2-2 0-1.700 1-2.500 2.500-2.500H18a3 3 0 0 0 3-3C21 7.600 17 3 12 3z"/><circle cx="7.500" cy="11.500" r="1"/><circle cx="10.500" cy="7.500" r="1"/><circle cx="15" cy="8" r="1"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    spark: '<path d="M12 3l1.900 5.600L19.500 10.500 13.900 12.400 12 18l-1.900-5.600L4.500 10.500l5.600-1.900z"/><path d="M19 16.500v4M17 18.500h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.600 2.600 0 1 1 3.700 2.300c-.8.400-1.200 1-1.200 1.900"/><path d="M12 17h.01"/>',
    out: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4M19 12H9"/>',
    dots: '<circle cx="5.500" cy="12" r="1.300"/><circle cx="12" cy="12" r="1.300"/><circle cx="18.500" cy="12" r="1.300"/>',
    more: '<circle cx="5.500" cy="12" r="1.300"/><circle cx="12" cy="12" r="1.300"/><circle cx="18.500" cy="12" r="1.300"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.500 2h-15z"/><path d="M10 20.500a2 2 0 0 0 4 0"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.500 20h7M10 17h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300l1.800 1.800M16.900 16.900l1.800 1.800M5.300 18.700l1.800-1.800M16.900 7.100l1.800-1.800"/>',
    week: '<rect x="3.500" y="5" width="17" height="15" rx="2"/><path d="M3.500 10h17M8 3v4M16 3v4M8 14h2M12 14h2M16 14h.01"/>',
    install: '<path d="M12 4v11M7.500 10.500 12 15l4.500-4.500"/><path d="M5 19h14"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.500 20h7M10 17h4"/>',
    star: '<path d="M12 3l2.800 5.700 6.200.9-4.500 4.400 1.100 6.200L12 17.300l-5.600 2.900 1.100-6.200L3 9.600l6.200-.9z"/>',
    save: '<path d="M6 4h12v16l-6-4-6 4z"/>', compare: '<path d="M8 4v16M16 4v16M4 8h4M16 16h4M4 14h4M16 10h4"/>',
    ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14.500 6v2M14.500 11v2M14.500 16v2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', minus: '<path d="M5 12h14"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/>', bars: '<path d="M5 20V10M10 20V4M15 20v-7M20 20v-11"/>', versus: '<path d="M4 6l4 12 4-12M14 8.500c0-1.400 1.200-2.500 3-2.500s3 1 3 2.300c0 3-6 1.700-6 5 0 1.500 1.300 2.700 3.200 2.700 1.800 0 2.800-1 2.800-2.300"/>',
  };
  const ic = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  // sport chips: [key, label, sport the page knows, league to choose first]
  const CHIPS = [['soccer', 'Soccer', 'soccer'], ['football', 'Football', 'football', 'nfl'], ['basketball', 'Basketball', 'basketball', 'nba'], ['baseball', 'Baseball', 'baseball'], ['hockey', 'Hockey', 'hockey'],
    ['tennis', 'Tennis', 'tennis'], ['ufc', 'UFC', 'ufc'], ['boxing', 'Boxing', 'boxing'], ['cfb', 'College football', 'football', 'fbs'], ['cbb', 'College basketball', 'basketball', 'cbb']];
  const SPORTS = CHIPS.slice(0, 8).map(c => [c[0], c[1]]);
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const root = document.documentElement;
  root.dataset.sport = S.sport || 'soccer';
  const pages = () => window.flPages;

  /* ---------- top bar ---------- */
  const top = document.querySelector('header.top'), topIn = top.querySelector('.top-in'), search = topIn.querySelector('label.search'), syncEl = el('sync');
  topIn.querySelector('.brand')?.remove(); topIn.querySelector('.sport-sw')?.remove();
  const nav = (k, label, attrs, extra = '') => `<button class="tbn" data-k="${k}" ${attrs}>${label}${extra}</button>`;
  topIn.insertAdjacentHTML('afterbegin', `<button class="tb-brand" data-shell="home" aria-label="Floodlight, home"><i class="tb-dot" aria-hidden="true"></i><b>Floodlight</b></button>
    <nav class="tb-nav" id="tbNav" aria-label="Sections">${nav('home', 'Home', 'data-shell="home"')}${nav('live', 'Live', 'data-shell="live"', '<b class="tb-live num" id="tbLive" hidden></b>')}${nav('lab', 'Lab', 'data-shell="lab"')}${nav('pred', 'Predictions', 'data-shell="pred"')}${nav('parlays', 'Parlays', 'data-shell="parlays"')}</nav>`);
  topIn.insertAdjacentHTML('beforeend', `<button class="tb-ic tb-search" id="tbSearch" aria-label="Search" aria-expanded="false">${ic('search')}</button>
    <button class="tb-members" id="tbMembers" data-shell="members">Members</button>
    <button class="tb-ic tb-dots" id="flDots" aria-haspopup="menu" aria-expanded="false" aria-controls="flMenu" aria-label="Menu: profile, settings and help">${ic('dots')}</button>
    <div class="flmenu" id="flMenu" role="menu" aria-labelledby="flDots" hidden></div>`);
  /* The sport chips sit in their own row under the bar, outside it, so only the bar itself (about 70px) stays at the top
     while scrolling. Home, Live and the sport pages show the row; Predictions and the Lab have their own sport filters,
     so the row is left out there and while a player profile is open; every other page folds it into a Sports menu in the
     bar (data-chrome on <html>: full, bare or menu). */
  const row = document.createElement('div'); row.className = 'tb-row2';
  row.innerHTML = `<div class="tb-sports" id="tbSports" role="toolbar" aria-label="Sports">${CHIPS.map(([k, l, sp, lg]) => `<button class="tbs" data-k="${k}" data-sport="${sp}"${lg ? ` data-lg="${lg}"` : ''}>${l}</button>`).join('')}</div>`;
  top.after(row); if (syncEl) row.appendChild(syncEl);
  el('tbNav').insertAdjacentHTML('beforeend', `<span class="tb-sp-w"><button class="tbn tb-spbtn" id="tbSpBtn" aria-haspopup="true" aria-expanded="false" aria-controls="tbSpPop">Sports<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    <div class="tb-sppop" id="tbSpPop" role="group" aria-label="Sports" hidden>${CHIPS.map(([k, l, sp, lg]) => `<button class="tbs" data-k="${k}" data-sport="${sp}"${lg ? ` data-lg="${lg}"` : ''}>${ic(k, 18)}${l}</button>`).join('')}</div></span>`);
  const spBtn = el('tbSpBtn'), spPop = el('tbSpPop');
  const spOpen = on => { spPop.hidden = !on; spBtn.setAttribute('aria-expanded', on); if (on) spPop.querySelector('button')?.focus() };
  spBtn.addEventListener('click', () => spOpen(spPop.hidden));
  document.addEventListener('click', ev => { if (!spPop.hidden && !ev.target.closest?.('.tb-sp-w')) spOpen(false); else if (ev.target.closest?.('#tbSpPop .tbs')) setTimeout(() => spOpen(false), 0) });
  spPop.addEventListener('keydown', ev => {
    const all = [...spPop.querySelectorAll('button')], i = all.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); spOpen(false); return spBtn.focus() }
    const j = /Down|Right/.test(ev.key) ? (i + 1) % all.length : /Up|Left/.test(ev.key) ? (i - 1 + all.length) % all.length : -1;
    if (j >= 0) { ev.preventDefault(); all[j].focus() }
  });
  spPop.addEventListener('focusout', ev => { if (!spPop.hidden && !ev.relatedTarget?.closest?.('.tb-sp-w')) spOpen(false) });
  // the bar stays at the top while scrolling (wide screens); pages that keep something sticky below it read --top-h
  const topH = () => root.style.setProperty('--top-h', (matchMedia('(min-width:821px)').matches ? top.offsetHeight : 0) + 'px');
  new ResizeObserver(topH).observe(top); addEventListener('resize', topH); topH();
  let stuckT = 0; addEventListener('scroll', () => { if (stuckT) return; stuckT = requestAnimationFrame(() => { stuckT = 0; top.classList.toggle('stuck', scrollY > 4) }) }, { passive: true });
  el('tbSearch').addEventListener('click', () => { const on = !top.classList.contains('search-open'); top.classList.toggle('search-open', on); el('tbSearch').setAttribute('aria-expanded', on); if (on) search?.querySelector('input')?.focus() });

  // College football and College basketball are the Football and Basketball pages with the college league chosen first
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('button[data-sport][data-lg]'); if (!t) return;
    const sp = t.dataset.sport, lg = t.dataset.lg;
    try { if (sp === 'football' && S.fb) { S.fb.lg = lg; S.fb.view = 'games'; store.set('fl.fbLg', lg) } if (sp === 'basketball' && S.bb) { S.bb.lg = lg; S.bb.view = 'games'; store.set('fl.bbLg', lg) } } catch (e) {}
  }, true);

  /* ---------- the competitions list stays where the page put it: the first column of a sport page ---------- */
  const rail = el('rail');
  const railLabel = b => (b.querySelector('span:not(.dot)')?.textContent || b.textContent).trim();
  const tidyRail = () => rail?.querySelectorAll('.lg').forEach(b => b.classList.toggle('dup', /^(Predictions|Live now|All matches|Transfer market)$/.test(railLabel(b))));

  /* ---------- three-dot menu ---------- */
  const menu = el('flMenu'), dots = el('flDots');
  const me = () => { try { return S.me } catch (e) { return null } };
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const accessLine = u => u.role === 'admin' || u.role === 'owner' ? 'Owner · all services' : u.role === 'pending' || u.status === 'paused' ? 'Paused' : `${u.role === 'manager' ? 'Admin' : 'Member'} · ${u.off && u.off.length ? 'custom access' : 'all services'}`;
  const mi = (icon, label, attrs, extra = '', cls = '') => `<button class="flm-i${cls}" role="menuitem" tabindex="-1" ${attrs}>${ic(icon, 18)}<span>${label}</span>${extra}</button>`;
  // starred themes, one press away. The one in use is left out: it is already named beside Theme
  const favThemes = () => { const T = window.flTheme, cur = T?.get?.(); return (T?.favs?.() || []).filter(id => id !== cur).map(id => { const t = T.list.find(x => x[0] === id); return t ? mi('star', `Switch to ${esc(t[1])}`, `data-theme-use="${id}"`, '', ' flm-fav') : '' }).join('') };
  function drawMenu() {
    const u = me(), theme = window.flTheme?.name?.() || '';
    menu.innerHTML = (u ? `<div class="flm-me"><span class="flm-av${u.prefs?.photo ? ' has-pic' : ''}" style="--av:${esc(u.prefs?.color || 'var(--accent-fill)')}">${initials(u.display)}${u.prefs?.photo ? `<img class="av-pic" src="/api/avatar?u=${encodeURIComponent(u.username)}&amp;v=${+u.prefs.photo}" alt="" decoding="async" onerror="this.remove()">` : ''}</span><span><b>${esc(u.display)}</b><small>${accessLine(u)}</small></span></div>`
        : `<div class="flm-auth">${mi('profile', 'Sign in', 'data-menu="signin"')}${mi('plus', 'Create account', 'data-menu="signup"')}</div>`)
      + `<div class="flm-g">${u ? mi('profile', 'My profile', 'data-page="profile"') + mi('edit', 'Edit profile', 'data-menu="edit"') : ''}${mi('ticket', 'My parlays', 'data-shell="parlays"')}${mi('members', 'Members', 'data-shell="members"', '', ' flm-narrow')}
        ${mi('sun', 'Your day', 'data-page="today"')}${mi('week', 'Your week', 'data-page="recap"')}${mi('bell', 'Alerts', 'data-page="inbox"')}${mi('trophy', 'Private competitions', 'data-page="groups"')}${mi('transfers', 'Transfers', 'data-shell="transfers"')}
        ${mi('gear', 'Settings', 'data-page="settings"')}${mi('palette', 'Theme', 'data-page="settings" data-arg="theme"', `<em>${esc(theme)}</em>`)}${favThemes()}
        ${mi('book', 'How to use Floodlight', 'data-page="guide"')}${mi('spark', 'What’s new', 'data-page="guide" data-arg="new"')}${mi('help', 'Help and feedback', 'data-page="guide" data-arg="help"')}${mi('clock', 'Data status and corrections', 'data-page="status"')}${window.flApp?.canInstall?.() ? mi('install', 'Install Floodlight', 'data-install') : ''}</div>`
      + (window.flAdmin?.menu?.(mi) || '')
      + (u ? `<div class="flm-g flm-end">${mi('out', 'Sign out', 'data-act="logout"', '', ' danger')}</div>` : '');
  }
  const items = () => [...menu.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]')];
  function openMenu(focusLast) { drawMenu(); menu.hidden = false; dots.setAttribute('aria-expanded', 'true'); const all = items(); (focusLast ? all[all.length - 1] : all[0])?.focus() }
  function closeMenu(back) { if (menu.hidden) return; menu.hidden = true; dots.setAttribute('aria-expanded', 'false'); if (back) dots.focus() }
  dots.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu(true));
  dots.addEventListener('keydown', ev => { if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); openMenu(ev.key === 'ArrowUp') } });
  menu.addEventListener('keydown', ev => {
    const all = items(), i = all.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return closeMenu(true) }
    if (ev.key === 'Tab') return closeMenu();
    const j = ev.key === 'ArrowDown' ? (i + 1) % all.length : ev.key === 'ArrowUp' ? (i - 1 + all.length) % all.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? all.length - 1 : -1;
    if (j >= 0) { ev.preventDefault(); all[j].focus() }
  });
  document.addEventListener('click', ev => {
    if (menu.hidden) return;
    const it = ev.target.closest?.('#flMenu [role="menuitem"],#flMenu [role="menuitemcheckbox"]');
    if (it) { const a = it.dataset.menu; closeMenu();
      if (a === 'profile' || a === 'signin') { typeof openProfile === 'function' && (a === 'signin' && (S.prof.mode = 'login'), openProfile()) }
      if (a === 'signup') { S.prof.mode = 'signup'; typeof openProfile === 'function' && openProfile() }
      if (a === 'edit') { S.prof.edit = true; typeof openProfile === 'function' && openProfile() }
      return }
    if (!ev.target.closest?.('#flMenu,#flDots')) closeMenu();
  });
  document.addEventListener('fl:theme', () => { if (!menu.hidden) drawMenu() });

  /* ---------- Cmd/Ctrl+K: the Lab from anywhere, cursor in its command bar ---------- */
  document.addEventListener('keydown', ev => {
    if (window.flSearch) return;   // search.js owns Cmd/Ctrl+K: it opens the search
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopImmediatePropagation(); closeSheetUI(); openLab(true) }
  }, true);
  function openLab(focus) { if (!pages()?.show('lab')) return document.querySelector('[data-rs="open"]')?.click(); if (focus) setTimeout(() => document.getElementById('labAsk')?.focus(), 60) }

  /* ---------- page transitions: changing sport, day or filter brings the new list in softly ---------- */
  let navT = 0;
  document.addEventListener('click', ev => {
    if (!ev.target.closest?.('[data-sport],[data-iso],[data-days],[data-f],[data-shell="home"],[data-shell="live"],.rail button')) return;
    const main = document.querySelector('.shell'); if (!main) return;
    main.classList.remove('fl-enter'); clearTimeout(navT);
    requestAnimationFrame(() => { main.classList.add('fl-enter'); navT = setTimeout(() => main.classList.remove('fl-enter'), 700) });
  }, true);

  /* ---------- actions the page has no single attribute for ---------- */
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-shell]'); if (!t) return;
    const a = t.dataset.shell, soccer = S.sport === 'soccer';
    closeSheetUI();
    if (a === 'profile') return typeof openProfile === 'function' && openProfile();
    if (a === 'members') { const u = me(); if (u && (u.role === 'admin' || u.role === 'owner' || u.role === 'manager') && pages()?.show('members')) return; return typeof openProfile === 'function' && openProfile() }
    if (a === 'lab') return openLab();
    if (a === 'pred') return pages()?.show('predictions');
    if (a === 'transfers') return pages()?.show('transfers');
    if (a === 'parlays') return pages()?.show('parlays');
    if (a === 'home') { if (window.flHub) return window.flHub.show(); if (soccer) { clickAttr('data-f', 'all'); if (typeof goToDate === 'function' && typeof sameDay === 'function' && !sameDay(S.date, new Date())) goToDate(new Date()) } else firstRail(); return scrollTo({ top: 0 }) }
    if (a === 'live') { if (pages()?.show('live')) return; if (soccer) clickAttr('data-f', 'live'); else firstRail(); return scrollTo({ top: 0 }) }
    if (a === 'fav') { if (soccer) clickAttr('data-f', 'fav'); else typeof openProfile === 'function' && openProfile(); return }
    if (a === 'sports') return openSheetUI();
  });
  // run one of the page's own filter clicks without drawing a second button for it
  function clickAttr(attr, v) { const b = document.createElement('button'); b.setAttribute(attr, v); b.setAttribute('data-global', ''); b.hidden = true; document.body.appendChild(b); b.click(); b.remove() }
  function firstRail() { rail?.querySelector('.lg')?.click() }

  /* ---------- bottom bar and the More sheet (phones) ---------- */
  const bar = document.createElement('nav'); bar.id = 'flBar'; bar.className = 'flbar'; bar.setAttribute('aria-label', 'Sections');
  const tab = (k, icon, label, attrs, extra = '') => `<button class="flb" data-k="${k}" ${attrs}>${ic(icon, 22)}<span>${label}</span>${extra}</button>`;
  bar.innerHTML = `${tab('home', 'home', 'Home', 'data-shell="home"')}${tab('live', 'live', 'Live', 'data-shell="live"', '<b class="num" id="flBarLive" hidden></b>')}${tab('lab', 'lab', 'Lab', 'data-shell="lab"')}${tab('pred', 'pred', 'Predictions', 'data-shell="pred"')}${tab('more', 'more', 'More', 'data-shell="sports" aria-haspopup="dialog"')}`;
  document.body.appendChild(bar);
  const sheet = document.createElement('div'); sheet.id = 'flSheet'; sheet.className = 'flsheet-bg'; sheet.hidden = true;
  sheet.innerHTML = `<div class="flsheet" role="dialog" aria-modal="true" aria-label="More"><h4>Sports</h4>
    <div class="flsheet-grid">${CHIPS.map(([k, l, sp, lg]) => `<button class="flsheet-i" data-k="${k}" data-sport="${sp}"${lg ? ` data-lg="${lg}"` : ''}>${ic(k)}<span>${l}</span></button>`).join('')}</div>
    <h4>More</h4><div class="flsheet-grid"><button class="flsheet-i" data-page="today">${ic('sun')}<span>Your day</span></button><button class="flsheet-i" data-page="inbox">${ic('bell')}<span>Alerts</span></button><button class="flsheet-i" data-page="groups">${ic('trophy')}<span>Competitions</span></button><button class="flsheet-i" data-page="recap">${ic('week')}<span>Your week</span></button><button class="flsheet-i" data-shell="parlays">${ic('ticket')}<span>Parlays</span></button><button class="flsheet-i" data-page="profile">${ic('profile')}<span>My profile</span></button><button class="flsheet-i" data-shell="transfers">${ic('transfers')}<span>Transfers</span></button><button class="flsheet-i" data-shell="members">${ic('members')}<span>Members</span></button>
      <button class="flsheet-i" data-shell="fav">${ic('fav')}<span>Favorites</span></button><button class="flsheet-i" data-page="settings">${ic('gear')}<span>Settings</span></button>
      <button class="flsheet-i" data-page="guide">${ic('book')}<span>How to use</span></button><button class="flsheet-i" data-page="status">${ic('clock')}<span>Data status</span></button></div></div>`;
  document.body.appendChild(sheet);
  function openSheetUI() { sheet.hidden = false; sheet.querySelector('.flsheet-i')?.focus({ preventScroll: true }); sync() }
  function closeSheetUI() { if (!sheet.hidden) { sheet.hidden = true; sync() } }
  sheet.addEventListener('click', ev => { if (ev.target === sheet || ev.target.closest('.flsheet-i')) setTimeout(closeSheetUI, 0) });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheetUI() });

  /* ---------- keep the highlight on what is showing ---------- */
  const PAGE_KEY = { lab: 'lab', predictions: 'pred', transfers: 'transfers', live: 'live', members: 'members', parlays: 'parlays' };
  function chipKey() { try { if (S.sport === 'football' && S.fb?.lg === 'fbs') return 'cfb'; if (S.sport === 'basketball' && S.bb?.lg === 'cbb') return 'cbb' } catch (e) {} return S.sport || 'soccer' }
  function current() {
    const pg = pages()?.current(); if (pg) return PAGE_KEY[pg] || pg;
    if (root.classList.contains('hub-on')) return 'home';
    if (S.sport === 'soccer' && !S.scope && S.page !== 'transfers') { if (S.filter === 'live') return 'live'; if (S.filter === 'fav') return 'fav' }
    return chipKey();
  }
  let hubLive = 0; document.addEventListener('fl:hub', e => { hubLive = e.detail.live; sync() });
  function liveCount() {
    if (hubLive) return hubLive;
    if (S.sport === 'soccer') return [...S.events.values()].filter(e => e.state === 'in').length;
    return [...(rail?.querySelectorAll('.lg:not(.dup) b.live') || [])].reduce((n, b) => n + (+b.textContent || 0), 0);
  }
  const mark = (list, on) => list.forEach(b => { const hit = b === on; b.classList.toggle('on', hit); if (hit) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current') });
  function sync() {
    if (root.dataset.sport !== S.sport) root.dataset.sport = S.sport;
    tidyRail();
    const k = current(), n = liveCount(), onSport = !pages()?.current() && !root.classList.contains('hub-on');
    root.classList.toggle('sport-on', onSport);
    const pg = pages()?.current(), v = (() => { try { return S.stack?.[S.stack.length - 1] } catch (e) { return null } })();
    const profile = !!v && /player$/.test(v.type || '') && !!document.getElementById('sheet')?.classList.contains('open');
    const chrome = profile || pg === 'predictions' || pg === 'lab' ? 'bare' : !pg || pg === 'live' ? 'full' : 'menu';
    if (root.dataset.chrome !== chrome) { root.dataset.chrome = chrome; if (chrome !== 'menu') spOpen(false) }
    spBtn.classList.toggle('on', chrome === 'menu' && onSport);
    mark([...el('tbNav').querySelectorAll('.tbn')], el('tbNav').querySelector(`.tbn[data-k="${k}"]`));
    const chip = onSport ? el('tbSports').querySelector(`.tbs[data-k="${chipKey()}"]`) : null; mark([...el('tbSports').querySelectorAll('.tbs')], chip);
    el('tbMembers').classList.toggle('on', k === 'members');
    const lv = el('tbLive'); lv.hidden = !n; lv.textContent = n; lv.setAttribute('aria-label', `${n} live`);
    const which = !sheet.hidden ? 'more' : ['home', 'live', 'lab', 'pred'].includes(k) ? k : 'more';
    mark([...bar.querySelectorAll('.flb')], bar.querySelector(`.flb[data-k="${which}"]`));
    const bl = el('flBarLive'); bl.hidden = !n; bl.textContent = n;
    sheet.querySelectorAll('[data-sport]').forEach(b => b.classList.toggle('on', onSport && b.dataset.k === chipKey()));
    document.dispatchEvent(new CustomEvent('fl:shell', { detail: { view: k, live: n } }));
  }
  // the page redraws through render(); follow it, and anything else that changes what is showing
  if (typeof window.render === 'function') { const r = window.render; window.render = function () { const out = r.apply(this, arguments); queueMicrotask(sync); return out } }
  document.addEventListener('click', () => setTimeout(sync, 0));
  document.addEventListener('fl:me', () => { if (!menu.hidden) drawMenu() });
  if (rail) new MutationObserver(() => { tidyRail(); queueMicrotask(sync) }).observe(rail, { childList: true });
  { const sh = document.getElementById('sheet'); if (sh) new MutationObserver(() => queueMicrotask(sync)).observe(sh, { attributes: true, attributeFilter: ['class'] }) }
  addEventListener('resize', sync);
  sync();
  /* Drawn icons are decoration: an <svg> with no role, label or <title> is hidden from screen readers, so a reader never
     hears "image" or a blank name between a control's words. Charts that mean something carry role="img" and a label. */
  const quiet = rootEl => { for (const s of (rootEl.querySelectorAll ? rootEl.querySelectorAll('svg:not([aria-hidden]):not([role]):not([aria-label])') : [])) if (!s.querySelector('title')) s.setAttribute('aria-hidden', 'true') };
  let qT = 0; new MutationObserver(() => { if (qT) return; qT = requestAnimationFrame(() => { qT = 0; quiet(document.body) }) }).observe(document.body, { childList: true, subtree: true });
  quiet(document.body);
  window.flShell = { sync, ic, SPORTS, CHIPS, current, liveCount, closeMenu };
})();
