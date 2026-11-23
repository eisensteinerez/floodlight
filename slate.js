/* Floodlight · big schedules made readable. A college Saturday can list 70 football or 150 basketball games, so a long
   slate gets:
   - "Top games" above it: ranked against ranked, close live games, a ranked team playing, a coin flip on the market,
     an upset, a national TV slot. Each says why it is there.
   - Progressive loading: each group shows its first games and a "Show all" button, so the page isn't one long wall.
   - Day groups that fold: a day whose games are all over starts folded.
   A short slate is drawn as before. Every reason is read from the scoreboard: ranks, scores, state, TV and, where the
   page has them, market chances. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BIG = 16, FIRST = 12;
  const NATIONAL = /\b(ESPN|ABC|FOX|CBS|NBC|TNT|ESPN2|FS1|BTN|SECN|ACCN|Peacock|Prime)\b/i;
  const open = new Set(), folded = new Map(), repaint = {};
  const rk = t => { const n = +t?.rank; return n > 0 && n <= 25 ? n : null };

  /* why a game is worth a look, best reason first. o: { close: points that count as close, p(e) -> home win chance or null } */
  function reasons(e, o = {}) {
    const a = rk(e.away), h = rk(e.home), out = [];
    const margin = Math.abs((+e.home.score || 0) - (+e.away.score || 0)), close = o.close || 8;
    if (a && h) out.push({ w: 100 - (a + h) / 2, t: `#${Math.min(a, h)} v #${Math.max(a, h)}` });
    if (e.state === 'in' && margin <= close) out.push({ w: 70 - margin, t: margin ? `Live, ${margin} in it` : 'Live, level' });
    if (e.state === 'post' && (a || h)) {   // a ranked team beaten by a lower-ranked or unranked one
      const hw = +e.home.score > +e.away.score, win = hw ? e.home : e.away, lose = hw ? e.away : e.home;
      if (rk(lose) && (!rk(win) || rk(win) > rk(lose))) out.push({ w: 55, t: `Upset: #${rk(lose)} lost` });
    }
    if ((a || h) && !(a && h) && !out.some(x => x.t.startsWith('Upset'))) out.push({ w: 40 - (a || h), t: `#${a || h} ${(a ? e.away : e.home).name || ''}`.trim() });
    const p = o.p ? o.p(e) : null;
    if (e.state === 'pre' && p != null && p >= .4 && p <= .6) out.push({ w: 18, t: 'Coin flip on the market' });
    const tv = String(e.tv || '').split(',')[0].trim();
    if (e.state !== 'post' && tv && NATIONAL.test(tv)) out.push({ w: 8, t: `On ${tv}` });
    return out.sort((x, y) => y.w - x.w);
  }
  // the best few: live and upcoming before finished, then by their best reason
  function top(list, o = {}) {
    if (list.length <= BIG) return [];
    return list.map(e => ({ e, r: reasons(e, o) })).filter(x => x.r.length && x.r[0].w >= 15)
      .sort((x, y) => (x.e.state === 'post') - (y.e.state === 'post') || y.r[0].w - x.r[0].w || x.e.date - y.e.date).slice(0, o.n || 6);
  }
  function topHTML(picks, card) {
    if (!picks.length) return '';
    return `<section class="group sl-top" aria-labelledby="slTopH"><div class="group-h"><strong id="slTopH">Top games</strong><span>· picked from ranks, scores, the market and TV</span></div>
      <div class="cards">${picks.map(x => `<div class="sl-pick">${card(x.e)}<p class="sl-why">${x.r.slice(0, 2).map(r => `<span>${esc(r.t)}</span>`).join('')}</p></div>`).join('')}</div></section>`;
  }
  // a group's cards: the first few, then a button for the rest
  function cards(key, list, card) {
    const all = open.has(key) || list.length <= BIG, shown = all ? list : list.slice(0, FIRST);
    return `<div class="cards">${shown.map(card).join('')}</div>${all ? '' : `<button type="button" class="btn ghost sl-more" data-slmore="${esc(key)}" aria-label="Show all ${list.length} games in this group">Show all ${list.length} games <span aria-hidden="true">(${list.length - FIRST} more)</span></button>`}`;
  }
  /* a day (or any group) that can fold. head is the group heading HTML. A day whose games are all over starts folded
     on a big slate; the reader's own choice is kept until the page is left. */
  function group(key, head, list, card, big) {
    const done = list.every(e => e.state === 'post'), live = list.filter(e => e.state === 'in').length;
    if (!big) return `<div class="group"><div class="group-h day-h">${head}</div>${cards(key, list, card)}</div>`;
    const isOpen = folded.has(key) ? !folded.get(key) : !done;
    return `<details class="group sl-day" data-slday="${esc(key)}"${isOpen ? ' open' : ''}><summary class="group-h day-h">${head}<span class="sl-n">${list.length} game${list.length === 1 ? '' : 's'}${live ? ` · ${live} live` : done ? ' · all finished' : ''}</span></summary>${cards(key, list, card)}</details>`;
  }
  const isBig = n => n > BIG;

  document.addEventListener('click', ev => {
    const b = ev.target.closest?.('[data-slmore]'); if (!b) return;
    const key = b.dataset.slmore; open.add(key);
    const page = key.split('|')[0], grp = b.previousElementSibling, n = grp?.children.length || 0;
    repaint[page]?.();
    // keep the reader where they were: focus the first newly shown game
    const box = document.querySelector(`[data-slday="${CSS.escape(key)}"] .cards, .sl-grp[data-slgrp="${CSS.escape(key)}"] .cards`);
    const next = box?.children[n]?.querySelector('button, [tabindex], a') || box?.children[n];
    next?.focus?.({ preventScroll: true });
  });
  document.addEventListener('toggle', ev => { const d = ev.target; if (d.matches?.('[data-slday]')) folded.set(d.dataset.slday, !d.open) }, true);

  /* ---------- the sport pages' frame: what is selected, and leagues with nothing on ----------
     Every sport draws its own rail of competitions, its chips (phones) and its heading. Rather than change six renderers,
     this tidies whatever they drew:
     - Leagues with no games found for the chosen dates fold under "More leagues", on the rail and in the chips. The selected
       one never folds, and nothing folds until at least one league has a count, so a page still loading shows all.
     - The heading gets a line naming the sport and the competition ("Basketball › NBA"), and the selected rail item is
       marked aria-current, so where you are is plain to see and to hear.
     - Every filter row is a labelled toolbar. */
  const LEAGUE = '.lg[data-f]:not([data-global]),.lg[data-bblg]:not([data-bblg="all"]),.lg[data-fblg]:not([data-fblg="all"]),.lg[data-hklg]:not([data-hklg="all"]),.lg[data-bslg]:not([data-bslg="all"]),.lg[data-tnlg]:not([data-tnlg="all"])';
  const KEY_ATTRS = ['f', 'bblg', 'fblg', 'hklg', 'bslg', 'tnlg'];
  const moreOpen = new Set();
  const SPORT_NAME = { soccer: 'Soccer', football: 'Football', basketball: 'Basketball', baseball: 'Baseball', hockey: 'Hockey', tennis: 'Tennis', ufc: 'UFC', boxing: 'Boxing' };
  const sportNow = () => document.documentElement.dataset.sport || 'soccer';
  const keyOf = el => { const a = KEY_ATTRS.find(k => el.dataset[k] != null); return a ? `${a}=${el.dataset[a]}` : '' };
  function foldRail() {
    const rail = document.getElementById('rail'); if (!rail || rail.querySelector('.rail-more')) return;
    const lgs = [...rail.querySelectorAll(LEAGUE)].filter(b => !b.closest('.rail-more'));
    const counted = lgs.filter(b => b.querySelector('b')), empty = lgs.filter(b => !b.querySelector('b') && !b.classList.contains('on') && !b.classList.contains('fav'));
    if (!counted.length || empty.length < 2) return;
    const region = b => { let e = b.previousElementSibling; while (e && e.tagName !== 'H4') e = e.previousElementSibling; return e?.textContent || '' };
    const groups = new Map(); for (const b of empty) { const r = region(b); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(b) }
    const d = document.createElement('details'); d.className = 'rail-more'; d.dataset.sport = sportNow(); if (moreOpen.has(sportNow())) d.open = true;
    d.innerHTML = `<summary class="lg"><span class="dot" aria-hidden="true">+</span><span>More leagues</span><b class="rm-n">${empty.length}</b></summary><p class="rm-note">No games found for these dates</p>`;
    for (const [r, bs] of groups) { if (r) { const h = document.createElement('h5'); h.textContent = r; d.appendChild(h) } for (const b of bs) d.appendChild(b) }
    // a region heading left with nothing under it goes too
    for (const h of [...rail.querySelectorAll(':scope > h4')]) { let e = h.nextElementSibling; if (!e || e.tagName === 'H4' || e.tagName === 'P') { if (groups.has(h.textContent)) h.remove() } }
    const tail = rail.querySelector(':scope > p'); tail ? rail.insertBefore(d, tail) : rail.appendChild(d);
    // the chips on phones: the same leagues tuck behind one chip
    const chips = document.getElementById('chips'), keys = new Set(empty.map(keyOf).filter(Boolean));
    if (chips && !chips.querySelector('.chip-more')) {
      const hide = [...chips.querySelectorAll('.chip')].filter(c => keys.has(keyOf(c)) && !c.classList.contains('on'));
      if (hide.length >= 2) {
        hide.forEach(c => c.classList.add('chip-x'));
        const open = moreOpen.has(sportNow());
        chips.classList.toggle('show-more', open);
        chips.insertAdjacentHTML('beforeend', `<button type="button" class="chip chip-more" aria-expanded="${open}">${open ? 'Fewer leagues' : `More leagues <b>${hide.length}</b>`}</button>`);
      }
    }
  }
  function frame() {
    foldRail();
    const rail = document.getElementById('rail');
    rail?.querySelectorAll('.lg').forEach(b => { const on = b.classList.contains('on'); if (on && b.getAttribute('aria-current') !== 'true') b.setAttribute('aria-current', 'true'); else if (!on && b.getAttribute('aria-current') === 'true') b.removeAttribute('aria-current') });
    const sp = SPORT_NAME[sportNow()] || '';
    const on = rail?.querySelector('.lg.on > span:not(.dot)')?.textContent.trim() || '';
    const txt = [sp, on].filter(Boolean);
    document.querySelectorAll('.shell .livebar').forEach(lb => {
      if (lb.closest('[id^="pg-"]')) return; let c = lb.querySelector(':scope > .sp-crumb');
      if (!txt.length) { c?.remove(); return }
      const html = txt.map(esc).join('<span aria-hidden="true"> › </span>');
      if (!c) { c = document.createElement('p'); c.className = 'sp-crumb'; lb.prepend(c) }
      if (c.innerHTML !== html) c.innerHTML = html;
    });
    document.querySelectorAll('.shell .quick:not([role])').forEach(q => { q.setAttribute('role', 'toolbar'); q.setAttribute('aria-label', 'Filters') });
  }
  let queued = 0;
  const later = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; frame() }) };
  const watch = () => { const sh = document.querySelector('.shell'); if (!sh) return; new MutationObserver(later).observe(sh, { childList: true, subtree: true }); later() };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', watch) : watch();
  document.addEventListener('toggle', ev => { const d = ev.target; if (d.matches?.('.rail-more')) d.open ? moreOpen.add(d.dataset.sport) : moreOpen.delete(d.dataset.sport) }, true);
  document.addEventListener('click', ev => {
    const b = ev.target.closest?.('.chip-more'); if (!b) return; const chips = b.parentElement, open = !chips.classList.contains('show-more');
    chips.classList.toggle('show-more', open); open ? moreOpen.add(sportNow()) : moreOpen.delete(sportNow());
    b.setAttribute('aria-expanded', open); b.innerHTML = open ? 'Fewer leagues' : `More leagues <b>${chips.querySelectorAll('.chip-x').length}</b>`;
  });

  window.flSlate = { reasons, top, topHTML, cards, group, isBig, repaint, BIG };
})();
