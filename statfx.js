/* Floodlight · creative statistics. A small chart kit shared by every sport, all plain SVG and CSS:
   - every side-by-side stat row on the site (the .stat rows each sport draws) becomes a mirrored bar from the centre,
     the bigger side glowing, and percentages get a small ring on each side
   - win-probability timeline with a momentum fill, from ESPN's play-by-play win chances
   - period-by-period scoring (quarters, periods, innings, sets) as paired columns
   - stat "story" cards: one big number and a sentence, from each game's leaders
   - ring, sparkline and percentile helpers for pages that want them
   - a Share button on any card marked data-share, which turns it into a PNG to post or save
   Each builder takes plain facts and returns '' when there is nothing worth drawing. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null };
  const still = () => matchMedia('(prefers-reduced-motion:reduce)').matches || document.documentElement.dataset.motion === 'reduce';
  const SHARE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>';
  const head = (t, s, share) => `<div class="sfx-h"><h5>${esc(t)}</h5>${s ? `<small>${esc(s)}</small>` : ''}${share ? `<button class="vz-share" data-vzshare aria-label="Share ${esc(t)} as an image">${SHARE}<span>Share</span></button>` : ''}</div>`;

  /* ---------- ring: a percentage as an arc ---------- */
  function ring(p, o = {}) {
    const v = Math.max(0, Math.min(1, p > 1 ? p / 100 : p)), r = o.r || 16, C = 2 * Math.PI * r, s = (r + 4) * 2;
    return `<svg class="vz-ring${o.cls ? ' ' + o.cls : ''}" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="--c:${o.c || 'var(--accent)'}"><circle cx="${s / 2}" cy="${s / 2}" r="${r}"/><circle class="a" cx="${s / 2}" cy="${s / 2}" r="${r}" stroke-dasharray="${(C * v).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${s / 2} ${s / 2})"/>${o.label != null ? `<text x="50%" y="50%" dy=".35em">${esc(o.label)}</text>` : ''}</svg>`;
  }
  /* ---------- sparkline: a tiny trend, last value marked ---------- */
  function spark(vals, o = {}) {
    const v = (vals || []).map(Number).filter(x => isFinite(x)); if (v.length < 2) return '';
    const w = o.w || 84, h = o.h || 24, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => [i / (v.length - 1) * (w - 4) + 2, h - 2 - (x - lo) / span * (h - 4)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(''), last = pts[pts.length - 1];
    return `<svg class="vz-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label || 'Trend')}: ${v.join(', ')}" data-tip="${esc((o.label ? o.label + ': ' : '') + v.join(' · '))}"><path d="${d}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4"/></svg>`;
  }
  /* ---------- percentile: where a number ranks, red to green ---------- */
  function pctile(p, o = {}) {
    const v = Math.max(0, Math.min(100, Math.round(p))), hue = Math.round(v * 1.25);   // 0 red · 125 green
    return `<div class="vz-pct" style="--p:${v}%;--h:${hue}" data-tip="${esc(`${o.label || ''} ${v}th percentile`)}"><span class="vz-pct-l">${esc(o.label || '')}</span><span class="vz-pct-t"><i></i></span><b class="num">${v}</b><small>${v >= 95 ? 'Top 5%' : v >= 90 ? 'Top 10%' : v >= 75 ? 'Top 25%' : ''}</small></div>`;
  }
  /* ---------- story card: one big number and a sentence ---------- */
  function story(o) {
    if (!o || o.value == null || o.value === '') return '';
    return `<article class="vz-story" style="--c:${o.c || 'var(--accent)'}" data-share='${esc(JSON.stringify({ kind: 'story', title: o.who, value: String(o.value), unit: o.unit || '', text: o.text || '', sub: o.sub || '' }))}'>
      ${o.face ? `<img class="vz-story-face" src="${esc(o.face)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <b class="vz-story-n num">${esc(o.value)}<small>${esc(o.unit || '')}</small></b><strong>${esc(o.who || '')}</strong><p>${esc(o.text || '')}</p>
      <button class="vz-share" data-vzshare aria-label="Share this stat as an image">${SHARE}</button></article>`;
  }

  /* ---------- win-probability timeline with momentum ---------- */
  // pts: [{ t (0..1 through the game), p (home win chance 0..1), tip }], marks: period boundaries as fractions
  function wp(pts, o) {
    const ok = (pts || []).filter(x => isFinite(x.t) && isFinite(x.p)); if (ok.length < 6) return '';
    const W = 600, H = 150, y = p => (1 - p) * (H - 20) + 10, x = t => t * W;
    const line = ok.map((q, i) => (i ? 'L' : 'M') + x(q.t).toFixed(1) + ' ' + y(q.p).toFixed(1)).join('');
    const area = `M0 ${y(.5)} ` + ok.map(q => 'L' + x(q.t).toFixed(1) + ' ' + y(q.p).toFixed(1)).join('') + ` L${x(ok[ok.length - 1].t).toFixed(1)} ${y(.5)}Z`;
    // momentum: the swing over the last stretch of plays, as a strip of coloured ticks
    const N = 40, mom = Array.from({ length: N }, (_, i) => { const a = ok[Math.floor(i / N * (ok.length - 1))], b = ok[Math.floor((i + 1) / N * (ok.length - 1))]; return b.p - a.p });
    const big = Math.max(.02, ...mom.map(Math.abs));
    const last = ok[ok.length - 1], hp = Math.round(last.p * 100), swing = ok.reduce((m, q, i) => i && Math.abs(q.p - ok[i - 1].p) > Math.abs(m.d) ? { d: q.p - ok[i - 1].p, q } : m, { d: 0, q: null });
    const hit = ok.filter((_, i) => i % Math.ceil(ok.length / 60) === 0).map(q => `<rect x="${(x(q.t) - 5).toFixed(1)}" y="0" width="10" height="${H}" data-tip="${esc(`${q.tip ? q.tip + ' · ' : ''}${o.home} ${Math.round(q.p * 100)}% · ${o.away} ${100 - Math.round(q.p * 100)}%`)}"/>`).join('');
    return `<div class="sfx vz-wp" style="--hc:${o.hc};--ac:${o.ac}">${head(o.title || 'Win probability', o.title ? `${hp >= 50 ? o.home : o.away} on top${o.live ? ' · live' : ''}` : `${o.home} ${hp}% · ${o.away} ${100 - hp}%${o.live ? ' · live' : ''}`, true)}
      <div class="vz-wp-box"><span class="vz-wp-lab top">${esc(o.home)}</span><span class="vz-wp-lab bot">${esc(o.away)}</span>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`Win probability through the game. ${o.home} now ${hp}%.${swing.q ? ` Biggest swing: ${swing.q.tip || ''}` : ''}`)}">
        <defs><clipPath id="vzTop${o.id}"><rect x="0" y="0" width="${W}" height="${y(.5)}"/></clipPath><clipPath id="vzBot${o.id}"><rect x="0" y="${y(.5)}" width="${W}" height="${H}"/></clipPath></defs>
        ${(o.marks || []).map(m => `<path class="vz-mark" d="M${x(m).toFixed(1)} 0V${H}"/>`).join('')}<path class="vz-mid" d="M0 ${y(.5)}H${W}"/>
        <path class="vz-area h" d="${area}" clip-path="url(#vzTop${o.id})"/><path class="vz-area a" d="${area}" clip-path="url(#vzBot${o.id})"/>
        <path class="vz-line${still() ? '' : ' draw'}" d="${line}" pathLength="1"/><g class="vz-hit">${hit}</g></svg></div>
      <div class="vz-mom" aria-label="Momentum through the game">${mom.map(d => `<i style="--v:${(Math.abs(d) / big).toFixed(2)};background:${d >= 0 ? 'var(--hc)' : 'var(--ac)'}"></i>`).join('')}</div>
      <div class="vz-wp-k"><span><i style="background:var(--hc)"></i>${esc(o.home)} gaining</span><span><i style="background:var(--ac)"></i>${esc(o.away)} gaining</span>${o.periodNames ? `<span class="vz-per">${o.periodNames.map(n => `<b>${esc(n)}</b>`).join('')}</span>` : ''}</div></div>`;
  }
  // ESPN summary: winprobability[] keyed to plays[] (period, clock); returns { pts, marks }
  wp.fromEspn = (sum) => {
    const W = sum?.winprobability; if (!W?.length) return null;
    const plays = new Map((sum.plays || []).map(p => [String(p.id), p]));
    const rows = W.map(w => ({ w, p: plays.get(String(w.playId)) })).filter(r => r.w.homeWinPercentage != null);
    if (rows.length < 6) return null;
    const per = rows.map(r => r.p?.period?.number || 0), maxPer = Math.max(1, ...per);
    // spread each period evenly; inside a period, follow the order of plays
    const counts = {}; per.forEach(n => counts[n] = (counts[n] || 0) + 1); const seen = {};
    const pts = rows.map((r, i) => { const n = per[i] || 1, k = seen[n] = (seen[n] || 0) + 1; const t = Math.min(1, ((n - 1) + k / (counts[n] || 1)) / maxPer);
      return { t, p: +r.w.homeWinPercentage, tip: [r.p?.period?.displayValue, r.p?.clock?.displayValue, (r.p?.text || '').slice(0, 70)].filter(Boolean).join(' · ') } });
    return { pts, marks: Array.from({ length: maxPer - 1 }, (_, i) => (i + 1) / maxPer) };
  };

  /* ---------- period by period ---------- */
  // rows: [{ name, logo, c, lines: [..] }] two teams; labels: ['Q1','Q2',…]
  function periods(rows, labels, o = {}) {
    if (!rows || rows.length !== 2) return '';
    const n = Math.max(rows[0].lines.length, rows[1].lines.length); if (!n) return '';
    const v = rows.map(r => r.lines.map(num)), max = Math.max(1, ...v.flat().filter(x => x != null));
    const best = Array.from({ length: n }, (_, i) => (v[0][i] ?? 0) > (v[1][i] ?? 0) ? 0 : (v[1][i] ?? 0) > (v[0][i] ?? 0) ? 1 : -1);
    return `<div class="sfx vz-per-chart" style="--n:${n}">${head(o.title || 'Scoring by period', o.sub || '', true)}
      <div class="vz-cols">${Array.from({ length: n }, (_, i) => `<div class="vz-col${best[i] === -1 ? ' tie' : ''}" style="--i:${i}">
        <div class="vz-bars">${[0, 1].map(k => `<i class="${best[i] === k ? 'win' : ''}" style="--h:${((v[k][i] ?? 0) / max * 100).toFixed(0)}%;--c:${rows[k].c}" data-tip="${esc(`${labels[i] || i + 1}: ${rows[k].name} ${rows[k].lines[i] ?? '–'}`)}"><b class="num">${esc(rows[k].lines[i] ?? '')}</b></i>`).join('')}</div>
        <small>${esc(labels[i] || i + 1)}</small></div>`).join('')}</div>
      <div class="vz-wp-k">${rows.map(r => `<span><i style="background:${r.c}"></i>${esc(r.name)} <b class="num">${v[rows.indexOf(r)].reduce((a, b) => a + (b || 0), 0)}</b></span>`).join('')}</div></div>`;
  }

  /* ---------- the extras block for a team-sport game: timeline, periods, story cards ---------- */
  // e: the sport's game object (home/away with name/abbr/id/logo, hc/ac), sum: ESPN summary, o: { periodName: i => 'Q1' }
  function gameStory(e, sum, o = {}) {
    if (!sum || sum.error) return '';
    const comp = sum.header?.competitions?.[0], cs = comp?.competitors || [];
    const H = cs.find(c => c.homeAway === 'home'), A = cs.find(c => c.homeAway === 'away');
    const hn = e.home.abbr || e.home.name, an = e.away.abbr || e.away.name, id = String(e.id || Math.random()).replace(/\W/g, '');
    let h = '';
    const W = wp.fromEspn(sum);
    if (W) h += wp(W.pts, { home: hn, away: an, hc: e.hc, ac: e.ac, id, marks: W.marks, live: e.state === 'in' });
    if (H?.linescores?.length && A?.linescores?.length) {
      const n = Math.max(H.linescores.length, A.linescores.length), lab = Array.from({ length: n }, (_, i) => o.periodName ? o.periodName(i, n) : String(i + 1));
      const r = (c, x, col) => ({ name: x.abbr || x.name, c: col, lines: c.linescores.map(l => l.displayValue ?? l.value) });
      h += periods(o.awayFirst === false ? [r(H, e.home, e.hc), r(A, e.away, e.ac)] : [r(A, e.away, e.ac), r(H, e.home, e.hc)], lab, { title: o.periodTitle || 'Scoring by period' });
    }
    // story cards from the game leaders: the top line of each team's first two categories
    const L = (sum.leaders || []).flatMap(t => (t.leaders || []).slice(0, 2).map(cat => ({ t, cat, l: cat.leaders?.[0] }))).filter(x => x.l?.athlete);
    if (L.length && e.state !== 'pre') {
      const cards = L.slice(0, 4).map(({ t, cat, l }) => { const home = String(t.team?.id) === String(H?.team?.id);
        return story({ value: l.mainStat?.value ?? num(l.displayValue) ?? l.displayValue, unit: (l.mainStat?.label || cat.shortDisplayName || cat.abbreviation || '').toUpperCase(), who: l.athlete.displayName || l.athlete.shortName,
          text: l.summary || l.displayValue || '', face: l.athlete.headshot?.href || l.athlete.headshot || '', c: home ? e.hc : e.ac, sub: `${an} at ${hn}` }) }).join('');
      if (cards) h += `<div class="sfx vz-stories">${head(e.state === 'in' ? 'Standing out so far' : 'Standout performances', '')}<div class="vz-story-row">${cards}</div></div>`;
    }
    return h ? `<div class="vz-block">${h}</div>` : '';
  }

  /* ---------- every .stat row on the site becomes a mirrored comparison ---------- */
  function enhance(root) {
    root.querySelectorAll?.('.stat:not([data-vz])').forEach(row => {
      row.dataset.vz = 1;
      const vs = row.querySelectorAll(':scope > .v'), lbl = row.querySelector('.lbl'); if (vs.length < 2 || !lbl) return;
      const a = num(vs[0].textContent), b = num(vs[vs.length - 1].textContent);
      if (a == null || b == null) return;
      row.classList.add('vz-m');
      const low = /turnover|foul|penalt|error|giveaway|allowed|against|lost|double fault|unforced|era|whip|bogey|sacked|interception/i.test(lbl.textContent);
      const lead = a === b ? 0 : (a > b) !== low ? -1 : 1;
      row.classList.toggle('vz-ll', lead === -1); row.classList.toggle('vz-lr', lead === 1);
      vs.forEach(v => v.classList.remove('lead'));
      const pct = /%|pct|percent/i.test(vs[0].textContent + vs[vs.length - 1].textContent + lbl.textContent) && a <= 100 && b <= 100;
      if (pct && !row.querySelector('.vz-ring')) { row.classList.add('vz-pctrow'); vs[0].insertAdjacentHTML('afterbegin', ring(a / 100, { r: 8, c: 'var(--vz-l, var(--accent))' })); vs[vs.length - 1].insertAdjacentHTML('beforeend', ring(b / 100, { r: 8, c: 'var(--vz-r, var(--muted))' })) }
      const tip = `${lbl.textContent.trim()}: ${vs[0].textContent.trim()} · ${vs[vs.length - 1].textContent.trim()}`; row.dataset.tip = tip;
    });
  }
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; enhance(document) }) }).observe(document.documentElement, { childList: true, subtree: true });
  enhance(document);

  /* ---------- Share: any card with data-share, or the chart around the button, becomes a PNG ---------- */
  async function toPng(card) {
    const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim() || '#fff';
    const bg = '#0B0B0F', fg = '#F4F4F6', muted = '#8E8E9C', acc = col('--accent') || '#C6FF3D';
    const W = 1080, Hh = 1080, c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d');
    await document.fonts?.ready;
    const grad = g.createRadialGradient(W / 2, -200, 50, W / 2, -200, 1200); grad.addColorStop(0, '#24242e'); grad.addColorStop(1, bg); g.fillStyle = grad; g.fillRect(0, 0, W, Hh);
    g.fillStyle = acc; g.font = '700 30px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('FLOODLIGHT', 70, 100);
    let data = null; try { data = JSON.parse(card.dataset.share || 'null') } catch {}
    if (data?.kind === 'story') {
      g.fillStyle = fg; g.font = '700 300px "Barlow Condensed", Impact, sans-serif'; g.fillText(data.value, 70, 520);
      const w = g.measureText(data.value).width; g.fillStyle = acc; g.font = '700 80px "Barlow Condensed", sans-serif'; g.fillText(data.unit, 90 + w, 520);
      g.fillStyle = fg; g.font = '700 72px "Barlow Condensed", sans-serif'; g.fillText(data.title.toUpperCase(), 70, 640);
      g.fillStyle = muted; g.font = '500 36px Inter, sans-serif'; wrap(g, data.text, 70, 710, W - 140, 48); g.fillText(data.sub || '', 70, Hh - 80);
    } else {
      // a chart or stat block: draw a snapshot of its rows as clean bars
      const title = card.querySelector('h5,h4,.lbl')?.textContent || 'Floodlight stats';
      g.fillStyle = fg; g.font = '700 70px "Barlow Condensed", sans-serif'; g.fillText(title.toUpperCase(), 70, 200);
      const rows = [...card.querySelectorAll('.stat')].slice(0, 9);
      if (rows.length) rows.forEach((r, i) => { const vs = r.querySelectorAll(':scope > .v'), l = r.querySelector('.lbl')?.textContent || '', a = num(vs[0]?.textContent) || 0, b = num(vs[vs.length - 1]?.textContent) || 0, m = Math.max(a, b, 1), Y = 290 + i * 84;
        g.fillStyle = muted; g.font = '500 28px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(l, W / 2, Y);
        g.fillStyle = fg; g.font = '700 40px "Barlow Condensed", sans-serif'; g.textAlign = 'left'; g.fillText(vs[0]?.textContent.trim() || '', 70, Y + 34); g.textAlign = 'right'; g.fillText(vs[vs.length - 1]?.textContent.trim() || '', W - 70, Y + 34); g.textAlign = 'left';
        g.fillStyle = a >= b ? acc : '#3a3a46'; g.fillRect(W / 2 - 330 * a / m - 6, Y + 14, 330 * a / m, 14); g.fillStyle = b > a ? acc : '#3a3a46'; g.fillRect(W / 2 + 6, Y + 14, 330 * b / m, 14) });
      else { const svg = card.querySelector('svg'); if (svg) await drawSvg(g, svg, 70, 260, W - 140, 600) }
      g.fillStyle = muted; g.font = '500 30px Inter, sans-serif'; g.fillText(card.querySelector('.sfx-h small')?.textContent || '', 70, Hh - 80);
    }
    return new Promise(r => c.toBlob(r, 'image/png'));
  }
  function wrap(g, text, x, y, w, lh) { let line = ''; for (const word of String(text).split(' ')) { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > w && line) { g.fillText(line, x, y); line = word; y += lh } else line = t } if (line) g.fillText(line, x, y) }
  async function drawSvg(g, svg, x, y, w, h) {
    const clone = svg.cloneNode(true), cs = getComputedStyle(svg);
    clone.querySelectorAll('*').forEach((el, i) => { const src = svg.querySelectorAll('*')[i]; if (!src) return; const s = getComputedStyle(src); el.setAttribute('style', `fill:${s.fill};stroke:${s.stroke};stroke-width:${s.strokeWidth};opacity:${s.opacity}`) });
    clone.setAttribute('width', w); clone.setAttribute('height', h); clone.style.color = cs.color;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    await new Promise(res => { const im = new Image(); im.onload = () => { g.drawImage(im, x, y, w, h); res() }; im.onerror = res; im.src = url });
  }
  document.addEventListener('click', async ev => {
    const b = ev.target.closest?.('[data-vzshare]'); if (!b) return;
    ev.stopPropagation(); ev.preventDefault();
    const card = b.closest('[data-share]') || b.closest('.sfx, .pcard, .stat-card, section, .pane');
    b.disabled = true;
    try {
      const blob = await toPng(card); const file = new File([blob], 'floodlight-stat.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Floodlight' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'floodlight-stat.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }
    } catch {} finally { b.disabled = false }
  }, true);

  window.flViz = { ring, spark, pctile, story, wp, periods, gameStory, enhance };
})();
