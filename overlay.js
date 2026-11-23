/* Floodlight · overlays that cover the page: the match centre, a player or team panel on a phone, the profile drawer and
   the owner tools. One set of rules for all of them, so a screen reader and the keyboard meet the same thing each time:
   - the page behind is made inert and hidden from assistive technology (live regions stay audible);
   - Tab and Shift+Tab stay inside the overlay;
   - a control with no name is taken out of the tab order instead of being read as a blank "button";
   - closing puts focus back on the control that opened it.
   Escape is left to each overlay, which already closes itself on it.
   flOverlay.open(el, { from, trap }) · flOverlay.close(el) · flOverlay.top() · flOverlay.name(control) */
(() => {
  const stack = [];   // [{ el, from, hidden: [[node, inert, ariaHidden]], mo, trap }]
  const KEEP = n => n.matches?.('script,style,link,template,[aria-live],[role="status"],[role="alert"],.sr-only');
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

  // the name a screen reader would read: labelledby, label, the text not hidden from it, alt text, title
  function name(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t }
    const al = (el.getAttribute('aria-label') || '').trim(); if (al) return al;
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent.trim()) return l.textContent.trim() }
    const wrap = el.closest('label'); if (wrap?.textContent.trim()) return wrap.textContent.trim();
    const walk = n => { let s = ''; for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true' && !c.hidden) s += c.tagName === 'IMG' ? (c.getAttribute('alt') || '') : c.tagName.toLowerCase() === 'svg' ? (c.querySelector('title')?.textContent || '') : walk(c) }
      return s };
    return (walk(el) || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').trim();
  }
  const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const focusables = el => [...el.querySelectorAll(FOCUSABLE)].filter(x => shown(x) && !x.closest('[inert],[aria-hidden="true"]'));

  // a blank control never reaches the tab order: it is skipped and kept away from the reader until it has a name again
  function guard(el) {
    for (const c of el.querySelectorAll('button,a[href],[role="button"],[role="link"],[role="tab"]')) {
      const blank = !name(c);
      if (blank && !c.hasAttribute('data-ovblank')) { c.setAttribute('data-ovblank', c.getAttribute('tabindex') ?? ''); c.setAttribute('tabindex', '-1'); c.setAttribute('aria-hidden', 'true') }
      else if (!blank && c.hasAttribute('data-ovblank')) { const t = c.getAttribute('data-ovblank'); c.removeAttribute('data-ovblank'); c.removeAttribute('aria-hidden'); if (t === '') c.removeAttribute('tabindex'); else c.setAttribute('tabindex', t) }
    }
  }

  // everything that is not on the overlay's own branch of the page: siblings of the overlay and of each of its ancestors
  function hideOutside(el) {
    const out = [];
    for (let n = el; n && n !== document.body && n.parentElement; n = n.parentElement)
      for (const s of n.parentElement.children) {
        if (s === n || KEEP(s)) continue;
        out.push([s, s.inert, s.getAttribute('aria-hidden')]); s.inert = true; s.setAttribute('aria-hidden', 'true');
      }
    return out;
  }
  function restore(hidden) {
    for (const [s, inert, ah] of hidden.reverse()) { s.inert = inert; if (ah == null) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', ah) }
  }

  function open(el, o = {}) {
    if (!el) return;
    const had = stack.find(x => x.el === el); if (had) { guard(el); return }
    const from = o.from && o.from !== document.body ? o.from : document.activeElement !== document.body ? document.activeElement : null;
    let t = 0; const mo = new MutationObserver(() => { if (t) return; t = requestAnimationFrame(() => { t = 0; guard(el) }) });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-labelledby', 'hidden'] });
    stack.push({ el, from, hidden: hideOutside(el), mo, trap: o.trap !== false });
    document.documentElement.classList.add('ov-on'); guard(el);
  }
  function close(el, o = {}) {
    const i = stack.findIndex(x => x.el === el); if (i < 0) return;
    const [x] = stack.splice(i, 1); x.mo.disconnect(); restore(x.hidden);
    if (!stack.length) document.documentElement.classList.remove('ov-on');
    // focus goes back where it was, unless the overlay's own code already put it somewhere on the page
    const act = document.activeElement, lost = !act || act === document.body || el.contains(act) || !act.isConnected;
    if (o.focus !== false && lost && x.from?.isConnected && !x.from.closest('[inert]')) x.from.focus({ preventScroll: true });
  }
  const top = () => stack[stack.length - 1] || null;

  // Tab never leaves the top overlay
  document.addEventListener('keydown', ev => {
    const o = top(); if (!o || ev.key !== 'Tab' || !o.trap) return;
    const f = focusables(o.el); if (!f.length) { ev.preventDefault(); return }
    const first = f[0], last = f[f.length - 1], a = document.activeElement, inside = o.el.contains(a);
    if (!inside) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); return }
    const i = f.indexOf(a);
    if (ev.shiftKey && (a === first || i < 0 && a === o.el)) { ev.preventDefault(); last.focus() }
    else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus() }
  }, true);

  /* ---------- the side panel (#sheet) is an overlay only on a phone, where it covers the whole schedule ----------
     On a wide screen it sits beside the list, or takes the stage with the list removed, so the page stays a page. */
  const narrow = matchMedia('(max-width:820px)');
  function sheetSync() {
    const sh = document.getElementById('sheet'); if (!sh) return;
    const modal = sh.classList.contains('open') && narrow.matches && !document.documentElement.classList.contains('hub-on') ? true : false;
    const on = stack.some(x => x.el === sh);
    if (modal) {
      const h = sh.querySelector('.pfh-name, .hero h1, .hero h2, .hero h3, h1, h2, h3');
      const what = (h?.textContent || '').replace(/\s+/g, ' ').trim();
      sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', what ? `${what}, details` : 'Details');
      if (!on) open(sh, { from: document.activeElement });
      // the reader lands on the panel's heading, not behind it (again once a loading panel has drawn its heading)
      const a = document.activeElement;
      if (!sh.contains(a) && (!a || a === document.body || a.closest('[inert]'))) requestAnimationFrame(() => { if (sh.contains(document.activeElement)) return;
        const t = sh.querySelector('.pfh-name, .hero h1, .hero h2, .hero h3, h1, h2, h3') || sh;
        if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }) });
    } else {
      if (on) close(sh);
      sh.removeAttribute('role'); sh.removeAttribute('aria-modal'); sh.setAttribute('aria-label', 'Match details');
    }
  }
  let st = 0; const later = () => { if (st) return; st = requestAnimationFrame(() => { st = 0; sheetSync() }) };
  const boot = () => { const sh = document.getElementById('sheet'); if (!sh) return;
    new MutationObserver(later).observe(sh, { attributes: true, attributeFilter: ['class'], childList: true });
    new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    narrow.addEventListener?.('change', later); later() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.flOverlay = { open, close, top, name, guard, focusables };
})();
