/* Floodlight · Admin mode: every owner-only control in one place.
   Owners see the site exactly as members do. A small "Owner" button sits at the bottom corner; turning Admin mode on
   shows the owner tools that belong to the screen you are on (awards on a player profile, key dates on the Transfer
   window, corrections on Data status) in that bar, plus a pencil beside the sections they edit. Each tool opens in one
   drawer on the right. Nothing owner-only is ever placed between public sections of a page.
   Pages register a tool: flAdmin.tool({ id, title: () => text, when: () => bool, html: () => html }).
   The choice is kept in this browser (fl.adminMode). Members never see any of this. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pen = s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.500 6.500l4 4"/></svg>`;
  const xIc = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
  const get = () => { try { return localStorage.getItem('fl.adminMode') === '1' } catch { return false } };
  const put = on => { try { localStorage.setItem('fl.adminMode', on ? '1' : '0') } catch {} };
  const tools = [];
  const A = { on: get(), drawer: null, from: null, focusId: '', sig: '' };
  const owner = () => { const u = window.S?.me; return !!u && (u.role === 'admin' || u.role === 'owner' || u.rank === 'owner' || u.rank === 'admin') };
  const on = () => owner() && A.on;
  const here = () => tools.filter(t => { try { return !!t.when() } catch { return false } });
  const title = t => typeof t.title === 'function' ? t.title() : t.title;

  function tool(t) { if (!t?.id || tools.some(x => x.id === t.id)) return; tools.push(t); bar() }

  /* ---------- where the switch lives ----------
     Wide screens: a small bar in the bottom corner, with room kept under the page so it never sits on a card.
     Phones and narrow windows: no floating control at all. Admin mode and the tools for the screen are items in the
     three-dot profile menu, and while it is on the menu button wears an "Admin" tag, so the state is always visible. */
  const narrow = matchMedia('(max-width:820px)');
  function tag() {
    const dots = document.getElementById('flDots'); if (!dots) return;
    const show = owner() && A.on;
    dots.classList.toggle('own-tagged', show);
    dots.setAttribute('aria-label', show ? 'Menu: profile, settings and help. Admin mode is on' : 'Menu: profile, settings and help');
  }
  // the menu's items for an owner (shell.js draws them inside the three-dot menu)
  function menu(mi) {
    if (!owner()) return '';
    const list = A.on ? here() : [];
    return `<div class="flm-g flm-own" role="group" aria-label="Owner">
      <button class="flm-i flm-own-sw" role="menuitemcheckbox" aria-checked="${A.on}" tabindex="-1" data-own="mode">${pen(18)}<span>Admin mode</span><em>${A.on ? 'On' : 'Off'}</em></button>
      ${list.map(t => mi('edit', esc(title(t)), `data-own="open:${esc(t.id)}"`)).join('')}${A.on && !list.length ? '<p class="flm-note">No owner tools on this screen</p>' : ''}</div>`;
  }

  /* ---------- the bar at the bottom corner (wide screens) ---------- */
  function bar() {
    let el = document.getElementById('flOwn'); tag();
    if (!owner() || narrow.matches) { el?.remove(); A.sig = ''; document.documentElement.classList.remove('own-bar-on'); document.documentElement.classList.toggle('own-on', owner() && A.on); return }
    const list = A.on ? here() : [], sig = `${A.on}|${list.map(t => t.id + ':' + title(t)).join(',')}`;
    document.documentElement.classList.toggle('own-on', A.on); document.documentElement.classList.add('own-bar-on');
    if (el && sig === A.sig) return; A.sig = sig;
    if (!el) { el = document.createElement('div'); el.id = 'flOwn'; el.className = 'own-bar'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Owner tools'); document.body.appendChild(el) }
    const keep = document.activeElement?.closest?.('#flOwn [data-own]')?.dataset.own;
    el.innerHTML = `<button type="button" class="own-sw" data-own="mode" aria-pressed="${A.on}">${pen(16)}<span>Admin mode</span><b>${A.on ? 'On' : 'Off'}</b></button>
      ${A.on ? list.length ? list.map(t => `<button type="button" class="own-t" data-own="open:${esc(t.id)}">${esc(title(t))}</button>`).join('') : '<span class="own-none">No owner tools on this screen</span>' : ''}`;
    if (keep) el.querySelector(`[data-own="${CSS.escape(keep)}"]`)?.focus();
  }

  /* ---------- the drawer ---------- */
  function open(id, from) {
    const list = here(); if (!list.length) return;
    A.from = from || document.activeElement; A.focusId = id || list[0].id;
    if (!A.drawer) { A.drawer = document.createElement('div'); A.drawer.className = 'own-dr-wrap'; document.body.appendChild(A.drawer) }
    draw(true); window.flOverlay?.open(A.drawer, { from: A.from, trap: false });
  }
  function draw(first) {
    const d = A.drawer; if (!d) return;
    const list = here(); if (!list.length) return close();
    const act = document.activeElement, actSel = act && d.contains(act) && act.name ? `[name="${CSS.escape(act.name)}"]` : '';
    // keep what an owner is typing when a tool redraws (a save elsewhere, a page refresh)
    const vals = first ? null : [...d.querySelectorAll('input,select,textarea')].map(x => [x.closest('[data-owntool-body]')?.dataset.owntoolBody + '|' + x.name, x.value]);
    d.innerHTML = `<div class="own-scrim" data-own="close"></div><aside class="own-dr" role="dialog" aria-modal="true" aria-labelledby="ownH">
      <header><h2 id="ownH" tabindex="-1">Owner tools</h2><button type="button" class="ib" data-own="close" aria-label="Close owner tools">${xIc}</button></header>
      <p class="lb">Only owners see this drawer. Members see the page without it.</p>
      ${list.map(t => `<section class="own-sec" id="own-${esc(t.id)}" aria-labelledby="own-${esc(t.id)}-h"><h3 id="own-${esc(t.id)}-h">${esc(title(t))}</h3><div data-owntool-body="${esc(t.id)}">${t.html()}</div></section>`).join('')}
      <p class="own-live sr-only" role="status" aria-live="polite"></p></aside>`;
    if (vals) for (const [k, v] of vals) { const [tid, name] = k.split('|'); const x = d.querySelector(`[data-owntool-body="${CSS.escape(tid)}"] [name="${CSS.escape(name)}"]`); if (x && x.type !== 'submit') x.value = v }
    if (first) { const s = d.querySelector(`#own-${CSS.escape(A.focusId)}`); s?.scrollIntoView({ block: 'start' }); (s?.querySelector('input,select,textarea,button') || d.querySelector('#ownH'))?.focus() }
    else if (actSel) d.querySelector(actSel)?.focus();
  }
  function close() {
    if (!A.drawer) return; window.flOverlay?.close(A.drawer, { focus: false }); A.drawer.remove(); A.drawer = null;
    if (A.from?.isConnected && A.from.getClientRects().length) A.from.focus({ preventScroll: true }); else (document.querySelector('#flOwn .own-sw') || document.getElementById('flDots'))?.focus();
  }
  function say(text) {
    const live = A.drawer?.querySelector('.own-live');
    if (live) { live.textContent = ''; setTimeout(() => { live.textContent = text }, 30); return }
    if (typeof toast === 'function') toast(text);
  }

  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-own],[data-owntool]'); if (!t) return;
    if (t.dataset.owntool) return open(t.dataset.owntool, t);
    const a = t.dataset.own;
    if (a === 'mode') { A.on = !A.on; put(A.on); bar(); refreshPage(); if (t.closest('#flMenu')) document.getElementById('flDots')?.focus(); say(A.on ? 'Admin mode on. Owner tools for this screen are in the bar.' : 'Admin mode off. You see the page as members do.'); return }
    if (a === 'close') return close();
    if (a.startsWith('open:')) return open(a.slice(5), t);
  });
  document.addEventListener('keydown', ev => {
    if (!A.drawer) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return close() }
    if (ev.key === 'Tab') {   // keep focus inside the drawer
      const f = [...A.drawer.querySelectorAll('.own-dr button,.own-dr input,.own-dr select,.own-dr textarea,.own-dr a[href],.own-dr [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return; const i = f.indexOf(document.activeElement);
      if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus() } else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus() }
    }
  }, true);
  // pencils in the page come and go with the mode: redraw what is showing
  function refreshPage() {
    try { if (window.S?.stack?.length && typeof renderSheet === 'function') renderSheet() } catch (e) {}
    try { const p = window.flPages?.current?.(); if (p) window.flPages.redraw?.(p) } catch (e) {}
  }
  document.addEventListener('fl:admin-refresh', () => { bar(); if (A.drawer) draw() });
  document.addEventListener('fl:me', () => { bar(); if (!owner()) close() });
  addEventListener('hashchange', () => setTimeout(bar, 60));
  narrow.addEventListener?.('change', bar);
  // the screen changes under the bar (a profile opens, a page changes): check what applies, cheaply
  setInterval(() => { if (owner()) { bar(); if (A.drawer && !here().length) close() } }, 1200);

  window.flAdmin = { tool, owner, on, open, close, say, menu, refresh: () => { bar(); if (A.drawer) draw() } };
})();
