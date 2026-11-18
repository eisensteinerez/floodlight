/* Floodlight · the finishing layer: the design sheet gets the last word, and cards light up under the pointer. */
document.head.appendChild(document.getElementById('flTheme'));
{ // at most once a frame, and only on devices with a mouse
  let pend = null, raf = 0;
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) document.addEventListener('pointermove', ev => {
    pend = ev; if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const e = pend, c = e.target.closest?.('.m,.spot,.rs-tile,.tile,.ml,.rs-game,.fx-card,.flg-grid article'); if (!c) return;
      const b = c.getBoundingClientRect(); c.style.setProperty('--mx', e.clientX - b.left + 'px'); c.style.setProperty('--my', e.clientY - b.top + 'px') });
  }, { passive: true });
}
/* a soft pool of light follows the mouse across the page (desktop only) */
if (matchMedia('(hover:hover) and (pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
  const light = document.createElement('div'); light.id = 'flLight'; light.setAttribute('aria-hidden', 'true'); document.body.prepend(light);
  let lx = 0, ly = 0, raf = 0;
  document.addEventListener('pointermove', ev => { lx = ev.clientX; ly = ev.clientY; document.body.classList.add('fl-pointer');
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; light.style.transform = `translate3d(${lx}px,${ly}px,0)` }) }, { passive: true });
  document.addEventListener('pointerleave', () => document.body.classList.remove('fl-pointer'));
}
/* a small drawing for each sport in the switcher */
(() => {
  const I = {
    soccer: '<circle cx="12" cy="12" r="9"/><path d="m12 7.5 4.2 3-1.6 4.9H9.4L7.8 10.5zM12 3v4.5M3.6 9.6l4.2.9M20.4 9.6l-4.2.9M6.7 19.2l2.7-3.8M17.3 19.2l-2.7-3.8"/>',
    football: '<path d="M4 20c-1-6 3-15 16-16 1 13-10 17-16 16zM9 15l6-6M10.5 10.5l3 3M8.5 12.5l3 3M12.5 8.5l3 3"/>',
    basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.800 0 12.800M18.400 5.600c-3 3-3 9.800 0 12.800"/>',
    baseball: '<circle cx="12" cy="12" r="9"/><path d="M6 5.300c2.500 3.500 2.500 9.900 0 13.400M18 5.300c-2.500 3.500-2.500 9.900 0 13.400"/>',
    hockey: '<path d="M5 3l6 13h7a2 2 0 0 1 0 4h-8.500L3 5"/><ellipse cx="18.500" cy="9" rx="3" ry="1.500"/>',
    tennis: '<circle cx="12" cy="12" r="9"/><path d="M5 6.300c4 2 4 9.400 0 11.400M19 6.300c-4 2-4 9.400 0 11.400"/>',
  };
  document.querySelectorAll('.sport-sw button[data-sport]').forEach(b => { const d = I[b.dataset.sport]; if (d && !b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`) });
})();

/* one floating tooltip for every chart mark that carries data-tip (the pitch keeps its own) */
(() => {
  let tip;
  const hide = () => { if (tip) tip.hidden = true };
  const show = ev => {
    const el = ev.target.closest?.('[data-tip]');
    if (!el || el.closest('.pitch-wrap')) return hide();
    if (!tip) { tip = document.createElement('div'); tip.className = 'fx-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip) }
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, x = Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), innerWidth - w / 2 - 8);
    const up = r.top > tip.offsetHeight + 14;
    tip.style.left = x + 'px'; tip.style.top = (up ? r.top - 8 : r.bottom + 8) + 'px'; tip.classList.toggle('below', !up);
  };
  document.addEventListener('pointerover', show); document.addEventListener('focusin', show);
  document.addEventListener('pointerdown', ev => { if (!ev.target.closest?.('[data-tip]')) hide() });
  addEventListener('scroll', hide, { passive: true, capture: true });
})();

/* a ring of light where you press, on anything you can press */
document.addEventListener('pointerdown', ev => {
  const el = ev.target.closest?.('.m,.btn,.tab,.qf,.dt,.pod-c,.lt-r,.ob,.oc,.mk-row,.mk-head,.spot,.pulse-m,.rail-i,.seg button,.prow,.ldr,.fx,.pred-card');
  if (!el || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const r = document.createElement('span'); r.className = 'fx-rip'; r.style.left = ev.clientX + 'px'; r.style.top = ev.clientY + 'px';
  document.body.appendChild(r); r.addEventListener('animationend', () => r.remove());
}, { passive: true });

/* the sport switcher sits in the header as a row of channels (styled by .dock in theme.css) */
{ const sw = document.querySelector('.top .sport-sw'); if (sw) sw.classList.add('dock') }

/* three slow lights behind the page */
{ const a = document.createElement('div'); a.id = 'flAurora'; a.setAttribute('aria-hidden', 'true'); a.innerHTML = '<i></i><i></i><i></i>'; document.body.prepend(a) }

/* Photos at the size they are shown. ESPN logos and headshots arrive at 500px or more and were shown at
   18-90px: a match page decoded ~110 MB of pictures, the browser ran out of graphics memory and the page
   smeared into ghost copies while scrolling. ESPN's own resizer serves them small; every picture also
   decodes off the main thread, and pictures below the fold wait until they are needed. */
(() => {
  const ESPN = /^https?:\/\/a\.espncdn\.com(\/i\/[^?#]+\.(?:png|jpe?g))(?:[?#].*)?$/i;
  const widthFor = p => /\/headshots\//.test(p) ? 260 : 160;
  const fix = img => {
    if (img.decoding !== 'async') img.decoding = 'async';
    if (!img.hasAttribute('loading') && !img.closest('.hero,.top')) img.loading = 'lazy';
    const src = img.getAttribute('src') || '', m = ESPN.exec(src);
    if (!m) return;
    img.dataset.full = src;
    img.setAttribute('src', `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${widthFor(m[1])}`);
  };
  // if the resizer ever fails, fall back to the original picture before the page's own error handler runs
  document.addEventListener('error', e => {
    const img = e.target;
    if (img?.tagName !== 'IMG' || !img.dataset.full || !/\/combiner\/i\?/.test(img.src)) return;
    e.stopImmediatePropagation();
    const full = img.dataset.full; delete img.dataset.full; img.dataset.noshrink = '1'; img.setAttribute('src', full);
  }, true);
  const scan = root => {
    if (root.tagName === 'IMG') { if (!root.dataset.noshrink) fix(root); return }
    root.querySelectorAll?.('img:not([data-noshrink])').forEach(fix);
  };
  scan(document.body);
  new MutationObserver(list => {
    for (const r of list) {
      if (r.type === 'attributes') { if (!r.target.dataset.noshrink) fix(r.target) }
      else r.addedNodes.forEach(n => n.nodeType === 1 && scan(n));
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
})();
