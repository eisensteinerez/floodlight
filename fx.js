/* Floodlight · the finishing layer: the design sheet gets the last word, and cards light up under the pointer. */
document.head.appendChild(document.getElementById('flTheme'));
document.addEventListener('pointermove', ev => {
  const c = ev.target.closest?.('.m,.spot,.rs-tile,.tile,.ml,.rs-game,.fx-card,.flg-grid article'); if (!c) return;
  const b = c.getBoundingClientRect(); c.style.setProperty('--mx', ev.clientX - b.left + 'px'); c.style.setProperty('--my', ev.clientY - b.top + 'px');
}, { passive: true });
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
