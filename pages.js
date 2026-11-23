/* Floodlight · full pages that are not a sport: Settings, the guide, Predictions, Transfer window, Members.
   A page is a <section class="flpage"> inside the main column. While one is showing, the sport lists are hidden
   (the same way Home hides them) and the address ends in #/name, so Back and a shared link both work.
   Other files add a page with flPages.add(name, { title, render(el, arg), onShow(el, arg), onHide() }). */
(() => {
  const root = document.documentElement, defs = new Map(), els = new Map();
  let cur = null, lastFocus = null;
  const shell = () => document.querySelector('.shell');
  function host(name) {
    if (els.has(name)) return els.get(name);
    const s = document.createElement('section'); s.className = 'flpage'; s.id = 'pg-' + name; s.hidden = true; s.tabIndex = -1;
    s.setAttribute('aria-label', defs.get(name)?.title || name); shell()?.prepend(s); els.set(name, s); return s;
  }
  // a page that belongs to a service a member does not have opens the "Ask your admin" page in its place
  const NEEDS = { lab: 'lab', predictions: 'predictions', transfers: 'transfers', live: 'live', parlays: 'predictions', history: 'predictions', boards: 'lab' };
  function show(name, arg, opts = {}) {
    if (NEEDS[name] && window.flAccess && !window.flAccess.has(NEEDS[name]) && defs.has('noaccess')) { arg = NEEDS[name]; name = 'noaccess' }
    const d = defs.get(name); if (!d) return false;
    if (d.guard && d.guard(arg) === false) return false;
    if (cur && cur !== name) leave(cur);
    window.flHub?.on?.() && window.flHub.hide();
    try { S.stack?.length && typeof closeSheet === 'function' && closeSheet() } catch (e) {}
    try { S.rs?.open && typeof closeResearch === 'function' && closeResearch() } catch (e) {}
    const el = host(name); lastFocus = document.activeElement;
    cur = name; root.classList.add('page-on'); root.dataset.page = name; el.hidden = false;
    if (!el.dataset.ready || d.fresh) { d.render(el, arg); el.dataset.ready = '1' }
    d.onShow?.(el, arg);
    if (!opts.keepScroll) scrollTo({ top: 0 });
    const want = '#/' + name + (arg ? '/' + encodeURIComponent(arg) : '');
    if (!opts.fromHash && location.hash !== want) history.pushState({ flPage: name }, '', want);
    document.title = (d.title ? d.title + ' · ' : '') + 'Floodlight';
    window.flShell?.sync?.(); document.dispatchEvent(new CustomEvent('fl:page', { detail: { name, arg } }));
    return true;
  }
  function leave(name) { const el = els.get(name); if (el) el.hidden = true; defs.get(name)?.onHide?.(el) }
  function hide(opts = {}) {
    if (!cur) return;
    leave(cur); cur = null; root.classList.remove('page-on'); delete root.dataset.page; document.title = 'Floodlight';
    if (!opts.fromHash && location.hash.startsWith('#/')) history.pushState({}, '', location.pathname + location.search);
    window.flShell?.sync?.(); document.dispatchEvent(new CustomEvent('fl:page', { detail: { name: null } }));
    if (window.flAccess && !window.flAccess.has('live') && window.flHub && !window.flHub.on()) window.flHub.show();   // no scores to fall back to
  }
  function fromHash() {
    const m = /^#\/([a-z-]+)(?:\/(.+))?$/.exec(location.hash);
    if (m && defs.has(m[1])) show(m[1], m[2] ? decodeURIComponent(m[2]) : undefined, { fromHash: true });
    else if (cur) hide({ fromHash: true });
  }
  addEventListener('popstate', fromHash); addEventListener('hashchange', fromHash);
  // any link or button that names a page opens it
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-page]'); if (!t || t === root) return;
    ev.preventDefault(); window.flShell?.closeMenu?.(); show(t.dataset.page, t.dataset.arg);
  }, true);
  // anything that goes to a sport, Home, a match or the Lab leaves the page
  document.addEventListener('click', ev => {
    const inside = ev.target.closest?.('.flpage,[data-page],.flmenu,#flDots');
    if (!cur || (inside && inside !== root)) return;   // <html> carries data-page too while a page shows; it is not a page link
    if (ev.target.closest?.('button[data-sport],[data-shell="home"],[data-rs="open"],.rail button,.ticker [data-ev],.ticker button,.sresults button,[data-leave]')) hide();
  }, true);
  // radio groups drawn as segmented controls: arrow keys move and choose, as a native radio group would
  document.addEventListener('keydown', ev => {
    const t = ev.target.closest?.('[role="radiogroup"] > [role="radio"]'); if (!t || t.dataset.themePick != null || t.dataset.brightPick != null || !/^Arrow|^Home$|^End$/.test(ev.key)) return;
    const all = [...t.parentElement.querySelectorAll(':scope > [role="radio"]')], i = all.indexOf(t), n = all.length;
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : /Right|Down/.test(ev.key) ? (i + 1) % n : (i - 1 + n) % n;
    ev.preventDefault(); const sel = all[j].getAttributeNames().filter(a => a.startsWith('data-')).map(a => `[${a}="${CSS.escape(all[j].getAttribute(a))}"]`).join('');
    all[j].click(); setTimeout(() => (sel && document.querySelector(`[role="radiogroup"] > [role="radio"]${sel}`) || all[j]).focus(), 0);
  });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  defs.set('noaccess', { title: 'Ask your admin for access', fresh: true, render(el, svc) {
    const A = window.flAccess, name = A?.name(svc) || 'This part of Floodlight', mine = Object.entries(A?.services() || {}).filter(([k, on]) => on && A.name(k)).map(([k]) => A.name(k));
    el.innerHTML = `<div class="card emp na-card">${window.flShell?.ic?.('members', 32) || ''}<h1 class="na-h">Ask your admin for access</h1>
      <p>${esc(name)} is switched off for your account. Nothing is broken: an admin chooses which parts of Floodlight each member can open, and they can switch this on for you.</p>
      ${mine.length ? `<p class="na-have">You can open: ${mine.map(esc).join(', ')}.</p>` : ''}
      <div class="cx-row na-go"><button type="button" class="bt" data-shell="home">Go to Home</button><button type="button" class="bt ghost" data-shell="profile">Open my profile</button></div></div>`;
  } });
  window.flPages = { add(name, def) { defs.set(name, def); if (location.hash.startsWith('#/' + name)) setTimeout(fromHash, 0) }, show, hide, current: () => cur, redraw(name) { const el = els.get(name), d = defs.get(name); if (el && d && !el.hidden) d.render(el) } };
})();
