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

  window.flSlate = { reasons, top, topHTML, cards, group, isBig, repaint, BIG };
})();
