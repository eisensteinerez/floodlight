/* Floodlight · the heat meter, heat badges, hit-rate rings and the shared game chart.
   One value in, 0 to 100, exactly as the Lab works it out. Nothing here changes a number: it only decides how it is shown.
   Colour is the ramp ice, mid, warm, fire from the theme tokens (--heat-ice, --heat-mid, --heat-warm, --heat-fire), mixed in CSS,
   so a theme switch recolours every meter with no script. The level name is always written out, so colour is never the only signal.
   Used by the site (index.html) and by the Lab page (lab.html). Styles are in heat.css. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = v => Math.max(0, Math.min(100, Math.round(+v || 0)));
  const LEVELS = [
    { to: 19, name: 'Ice cold', note: 'Frozen. Well under this line lately.', kind: 'ice' },
    { to: 39, name: 'Cool', note: 'Running cold against this line.', kind: 'ice' },
    { to: 59, name: 'Coin flip', note: 'Could go either way tonight.', kind: 'mid' },
    { to: 79, name: 'Heating up', note: 'Trending over this line.', kind: 'fire' },
    { to: 100, name: 'On fire', note: 'Scorching. Clearing this line for fun.', kind: 'fire' },
  ];
  const level = v => { v = clamp(v); const i = LEVELS.findIndex(l => v <= l.to); return { i, ...LEVELS[i] } };
  // the colour at a value: 0 ice, 50 mid, 75 warm, 100 fire, mixed between the two nearest stops
  const css = v => { v = Math.max(0, Math.min(100, +v || 0));
    const [a, b, t] = v <= 50 ? ['ice', 'mid', v / 50] : v <= 75 ? ['mid', 'warm', (v - 50) / 25] : ['warm', 'fire', (v - 75) / 25];
    return `color-mix(in oklab,var(--heat-${b}) ${Math.round(t * 100)}%,var(--heat-${a}))` };
  const FLAME = '<path class="f1" d="M12 2C12.5 6 17 7.5 17 13a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.6C9.4 10.4 10.2 11.5 11 11.5 11 8 10 5.5 12 2Z"/><path class="f2" d="M12 12c.4 1.6 2 2.2 2 4a2 2 0 0 1-4 0c0-1.6 1.4-2.2 2-4Z"/>';
  const FLAKE = '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M12 6l-2.5-2.5M12 6l2.5-2.5M12 18l-2.5 2.5M12 18l2.5 2.5"/>';
  const icon = (kind, size = 18) => kind === 'fire' ? `<svg class="hi hi-fire" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${FLAME}</svg>`
    : kind === 'ice' ? `<svg class="hi hi-ice" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${FLAKE}</svg>` : '';
  const ARC = 157.1;   // the half circle's length at r = 50
  let uid = 0;

  /* The full meter. opts: support (the "Over 20.5 in 6 of his last 10" line), label (default "Heat meter"), compact (gauge and words only),
     from (a value to animate from; call settle() after it is in the page). */
  function meter(value, opts = {}) {
    if (value == null || isNaN(value)) return '';
    const v = clamp(value), L = level(v), id = 'hg' + (++uid), from = opts.from == null ? v : clamp(opts.from);
    const legend = LEVELS.map((l, i) => `<li class="${i === L.i ? 'on' : ''}" style="--heat-c:${css(i * 25)}"><i></i>${l.name}</li>`).join('');
    return `<div class="hm${opts.compact ? ' hm-compact' : ''}" data-heat="${v}" data-kind="${L.kind}" data-shown="${from}" role="meter" aria-label="${esc(opts.label || 'Heat meter')}" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${L.name}" style="--heat-c:${css(v)}">
      <div class="hm-g"><svg viewBox="0 0 120 70" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" class="s-ice"/><stop offset=".5" class="s-mid"/><stop offset=".75" class="s-warm"/><stop offset="1" class="s-fire"/></linearGradient></defs>
        <path class="hm-t" d="M10,62 A50,50 0 0 1 110,62" stroke="url(#${id})"/><path class="hm-v" d="M10,62 A50,50 0 0 1 110,62" stroke="url(#${id})" stroke-dasharray="${(from / 100 * ARC).toFixed(1)} ${ARC}"/></svg>
        <span class="hm-arm" style="transform:rotate(${(from * 1.8).toFixed(1)}deg)"><i class="hm-k"></i></span><b class="hm-n num">${v}</b></div>
      <div class="hm-tx"><span class="lb">${esc(opts.label || 'Heat meter')}</span><strong class="hm-l">${icon(L.kind, 22)}<span>${L.name}</span></strong>
        <p class="hm-note">${L.note}</p>${opts.support ? `<p class="hm-sup">${esc(opts.support)}</p>` : ''}</div>
      <div class="hm-th" aria-hidden="true">${icon('ice', 16)}<span class="hm-bar"><i class="hm-d" style="left:${from}%"></i></span>${icon('fire', 16)}</div>
      <ol class="hm-leg" aria-hidden="true">${legend}</ol></div>`;
  }
  // move meters drawn with a "from" value to where they belong, so the arc and marker travel there
  function settle(root = document) {
    requestAnimationFrame(() => root.querySelectorAll('.hm[data-shown]').forEach(el => { const v = +el.dataset.heat; if (+el.dataset.shown === v) return; el.dataset.shown = v;
      const a = el.querySelector('.hm-v'), arm = el.querySelector('.hm-arm'), d = el.querySelector('.hm-d');
      if (a) a.setAttribute('stroke-dasharray', `${(v / 100 * ARC).toFixed(1)} ${ARC}`); if (arm) arm.style.transform = `rotate(${(v * 1.8).toFixed(1)}deg)`; if (d) d.style.left = v + '%' }));
  }
  // a small pill: icon, number and level name
  const badge = (value, opts = {}) => { if (value == null || isNaN(value)) return ''; const v = clamp(value), L = level(v);
    return `<span class="hbadge${opts.solid ? ' solid' : ''}" data-kind="${L.kind}" style="--heat-c:${css(v)}" title="Heat meter ${v} of 100">${icon(L.kind, 14)}<b class="num">${v}</b>${opts.short ? '' : `<em>${L.name}</em>`}</span>` };
  // a hit-rate ring: the percentage in the middle, the label and fraction below
  function ring(pct, opts = {}) {
    const has = pct != null && !isNaN(pct), p = has ? Math.max(0, Math.min(1, pct)) : 0;
    return `<span class="hring${has ? '' : ' none'}" style="--heat-c:${css(p * 100)}"><span class="hring-d"><svg viewBox="0 0 86 86" aria-hidden="true"><circle class="t" cx="43" cy="43" r="36" pathLength="100"/>${has ? `<circle class="a" cx="43" cy="43" r="36" pathLength="100" stroke-dasharray="${(p * 100).toFixed(1)} 100" transform="rotate(-90 43 43)"/>` : ''}</svg>
      <b class="num">${has ? Math.round(p * 100) + '%' : '–'}</b></span>${opts.label || opts.frac ? `<small class="num">${esc([opts.label, opts.frac].filter(Boolean).join(' · '))}</small>` : ''}</span>`;
  }

  /* The shared game chart: one bar per game against a line.
     games: oldest first, [{ v, opp, date, res, home, tip }]. opts: line, unit ("points"), avg (draw the 5-game average), height. */
  const smooth = pts => { if (pts.length < 3) return 'M' + pts.map(p => p.join(',')).join(' L');
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0]},${p2[1]}` }
    return d };
  const fmt = v => v == null ? '–' : Number.isInteger(v) ? String(v) : (+(+v).toFixed(1)).toString();
  function bars(games, opts = {}) {
    const gs = (games || []).filter(g => g && g.v != null && !isNaN(g.v)); if (!gs.length) return '';
    const line = opts.line, has = line != null && !isNaN(line), vals = gs.map(g => +g.v), max = Math.max(...vals, has ? line * 1.2 : 0, 1) * 1.08, y = v => Math.max(0, Math.min(100, v / max * 100)), n = gs.length;
    const roll = vals.map((_, i) => vals.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b, 0) / Math.min(5, i + 1));
    const day = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) };
    return `<div class="hc${n > 14 ? ' dense' : ''}${opts.fresh === false ? '' : ' fresh'}" role="group" aria-label="${esc(opts.label || 'Game by game')}">
      <div class="hc-plot" style="--n:${n}">${gs.map((g, i) => { const v = +g.v, d = has ? v - line : 0, cls = !has ? 'ov' : v > line ? 'ov' : v < line ? 'un' : 'push', big = has && Math.abs(d) >= 5;
        const tip = [g.date ? new Date(g.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '', `${g.home === false ? 'at ' : g.home ? 'vs ' : ''}${g.opp || ''}`, `${fmt(v)}${opts.unit ? ' ' + opts.unit : ''}`,
          has ? (d === 0 ? (opts.lineLabel ? 'Right on the ' + opts.lineLabel.toLowerCase() : 'Push, right on the line') : `${fmt(Math.abs(d))} ${d > 0 ? 'over' : 'under'} the ${opts.lineLabel ? opts.lineLabel.toLowerCase() : 'line'}`) : '', g.res === 'W' ? 'Won' : g.res === 'L' ? 'Lost' : g.res === 'D' ? 'Drew' : ''].filter(Boolean).join(' · ');
        const back = n - 1 - i, lbk = back % Math.max(1, Math.ceil(n / 16)) === 0 ? ' lbk' : '', lbs = back % Math.max(1, Math.ceil(n / 7)) === 0 ? ' lbs' : '';
        return `<div class="hc-b ${cls}${lbk}${lbs}" style="--i:${i}" tabindex="0" role="img" aria-label="${esc(tip)}" data-hctip="${esc(tip)}"><span class="hc-col"><em class="num">${big ? icon(d > 0 ? 'fire' : 'ice', 12) : ''}${fmt(v)}</em><i style="height:${Math.max(1.5, y(v)).toFixed(2)}%"></i></span>
          <span class="hc-x">${esc(g.opp || '')}<small>${esc(day(g.date))}</small>${g.res ? `<b class="${esc(g.res)}">${esc(g.res)}</b>` : ''}</span></div>` }).join('')}
        ${opts.avg !== false && n > 2 ? `<svg class="hc-avg" viewBox="0 0 ${n} 100" preserveAspectRatio="none" aria-hidden="true"><path d="${smooth(roll.map((v, i) => [i + .5, +(100 - y(v)).toFixed(2)]))}"/></svg>` : ''}
        ${has ? `<div class="hc-ln" style="bottom:${y(line).toFixed(2)}%"><span class="num">${esc(opts.lineLabel || 'Line')} ${fmt(line)}</span></div>` : ''}</div>
      <p class="hc-key">${has ? `<span><i class="ov"></i>${esc(opts.over || 'Over the line')}</span><span><i class="un"></i>${esc(opts.under || 'Under the line')}</span>` : ''}${opts.avg !== false && n > 2 ? '<span><i class="av"></i>5-game average</span>' : ''}</p></div>`;
  }
  // one small tooltip for every shared chart on the page
  let tip;
  const showTip = el => { if (!tip) { tip = document.createElement('div'); tip.className = 'hc-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip) }
    tip.textContent = el.dataset.hctip; tip.hidden = false; const r = el.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px' };
  const hideTip = () => { if (tip) tip.hidden = true };
  document.addEventListener('pointerover', e => { const b = e.target.closest?.('[data-hctip]'); b ? showTip(b) : hideTip() });
  document.addEventListener('focusin', e => { const b = e.target.closest?.('[data-hctip]'); b ? showTip(b) : hideTip() });
  document.addEventListener('scroll', hideTip, { passive: true, capture: true });

  window.flHeat = { level, css, icon, meter, settle, badge, ring, bars, smooth, LEVELS };
})();
