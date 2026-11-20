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
  function show(name, arg, opts = {}) {
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
    if (!cur || ev.target.closest?.('.flpage,[data-page],.flmenu,#flDots')) return;
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
  window.flPages = { add(name, def) { defs.set(name, def); if (location.hash.startsWith('#/' + name)) setTimeout(fromHash, 0) }, show, hide, current: () => cur, redraw(name) { const el = els.get(name), d = defs.get(name); if (el && d && !el.hidden) d.render(el) } };
})();
