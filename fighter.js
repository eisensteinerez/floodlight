/* Floodlight · the fighter profile, shared by UFC and boxing.
   ufc.js and boxing.js load their own data and hand it here as plain facts; this file lays the page out: ranking status
   and the division ladder first, the header, how they win, the tale of the tape, awards, the next fight and the fight
   history. A fighter who holds a title gets the gold page (the fgt-gold class re-points the theme tokens, tokens.css)
   and the belt. The belt is our own drawing in the shape of a real title belt (see belt() below).
   Nothing here is hard-coded about any fighter: champion, rank and dates all come from what the caller read. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const star = (cx, cy, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * .42 : r; d += (i ? 'L' : 'M') + (cx + q * Math.cos(a)).toFixed(1) + ' ' + (cy + q * Math.sin(a)).toFixed(1) } return d + 'Z' };
  /* The belt, drawn in the shape of a real title belt: a black leather strap with stitching, two gold side plates a
     side, and a big eight-sided centre plate with a bevelled rim, an engraved globe and a CHAMPION band. A glint runs
     across the gold now and then (still when the reader asks for less motion). The gold gradients live once in the
     page (defs below) and every belt points at them, so a hundred belts on a card cost nothing. */
  function defs() {
    if (document.getElementById('flBeltDefs')) return;
    const g = (id, x2, y2, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" style="stop-color:var(${c})${a != null ? `;stop-opacity:${a}` : ''}"/>`).join('')}</linearGradient>`;
    document.body.insertAdjacentHTML('afterbegin', `<svg id="flBeltDefs" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>
      ${g('flGold', 0, 1, [[0, '--champ-1'], [.42, '--champ-2'], [.78, '--champ-3'], [1, '--champ-2']])}
      ${g('flGoldDeep', 0, 1, [[0, '--champ-3'], [.5, '--champ-2'], [1, '--champ-3']])}
      ${g('flGoldSide', 1, 0, [[0, '--champ-3'], [.5, '--champ-1'], [1, '--champ-3']])}
      <linearGradient id="flShine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <clipPath id="flBeltMiniClip"><rect x="7" y="6" width="11" height="16" rx="2.500"/><rect x="46" y="6" width="11" height="16" rx="2.500"/><path d="M24 1h16l4.500 4.500v17L40 27H24l-4.500-4.500v-17z"/></clipPath>
      <clipPath id="flBeltClip"><rect x="40" y="46" width="52" height="88" rx="10"/><rect x="348" y="46" width="52" height="88" rx="10"/><rect x="96" y="40" width="40" height="100" rx="9"/><rect x="304" y="40" width="40" height="100" rx="9"/><path d="M178 6h84l42 42v84l-42 42h-84l-42-42V48z"/></clipPath>
    </defs></svg>`);
  }
  const starPath = star;
  // the small one, beside a champion's name
  function miniBelt(label) {
    defs();
    return `<svg class="fl-belt-mini" viewBox="0 0 64 28" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'} focusable="false">
      <rect x="0" y="8" width="64" height="12" rx="3" style="fill:var(--champ-strap)"/><rect x="2" y="10" width="60" height="8" rx="2" fill="none" style="stroke:var(--champ-stitch)" stroke-width=".8" stroke-dasharray="1.600 1.600"/>
      ${[7, 46].map(x => `<rect x="${x}" y="6" width="11" height="16" rx="2.500" fill="url(#flGoldSide)" style="stroke:var(--champ-ink)" stroke-width=".7"/><circle cx="${x + 5.5}" cy="14" r="2.300" fill="url(#flGoldDeep)" style="stroke:var(--champ-ink)" stroke-width=".5"/>`).join('')}
      <path d="M24 1h16l4.500 4.500v17L40 27H24l-4.500-4.500v-17z" fill="url(#flGold)" style="stroke:var(--champ-ink)" stroke-width=".8"/>
      <path d="M25.200 3.500h13.600l3.300 3.300v14.400l-3.300 3.300H25.200l-3.300-3.300V6.800z" fill="url(#flGoldDeep)" opacity=".85"/>
      <circle cx="32" cy="14" r="6.400" fill="url(#flGold)" style="stroke:var(--champ-ink)" stroke-width=".6"/><path d="${starPath(32, 14, 4)}" style="fill:var(--champ-ink)" opacity=".75"/>
      <g clip-path="url(#flBeltMiniClip)"><rect class="fl-belt-shine" x="-24" y="0" width="16" height="28" fill="url(#flShine)" transform="skewX(-18)"/></g></svg>`;
  }
  // the big one, on a champion's profile
  function belt(label) {
    defs();
    const globe = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#flGold)" style="stroke:var(--champ-ink)" stroke-width="2"/>
      <g fill="none" style="stroke:var(--champ-ink)" stroke-width="1.300" opacity=".55"><ellipse cx="${cx}" cy="${cy}" rx="${r * .45}" ry="${r}"/><ellipse cx="${cx}" cy="${cy}" rx="${r * .85}" ry="${r}"/><path d="M${cx - r} ${cy}h${2 * r}M${cx - r * .9} ${cy - r * .45}h${1.8 * r}M${cx - r * .9} ${cy + r * .45}h${1.8 * r}"/></g>`;
    const side = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#flGoldSide)" style="stroke:var(--champ-ink)" stroke-width="2"/><rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="${rx - 3}" fill="url(#flGoldDeep)" style="stroke:var(--champ-ink)" stroke-width="1" opacity=".9"/>`;
    return `<svg class="fgt-belt" viewBox="0 0 440 180" role="img" aria-label="${esc(label || 'Championship belt')}">
      <rect x="0" y="58" width="440" height="64" rx="16" style="fill:var(--champ-strap)"/><rect x="8" y="66" width="424" height="48" rx="11" fill="none" style="stroke:var(--champ-stitch)" stroke-width="1.600" stroke-dasharray="6 5"/>
      ${[[14, 76], [14, 104], [426, 76], [426, 104]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.400" fill="url(#flGold)"/>`).join('')}
      ${side(40, 46, 52, 88, 10)}${side(348, 46, 52, 88, 10)}${globe(66, 90, 15)}${globe(374, 90, 15)}
      ${side(96, 40, 40, 100, 9)}${side(304, 40, 40, 100, 9)}<path d="${starPath(116, 90, 11)}" style="fill:var(--champ-ink)" opacity=".7"/><path d="${starPath(324, 90, 11)}" style="fill:var(--champ-ink)" opacity=".7"/>
      <path d="M178 6h84l42 42v84l-42 42h-84l-42-42V48z" fill="url(#flGold)" style="stroke:var(--champ-ink)" stroke-width="3"/>
      <path d="M184 18h72l36 36v72l-36 36h-72l-36-36V54z" fill="url(#flGoldDeep)" style="stroke:var(--champ-ink)" stroke-width="1.400"/>
      <path d="M188 26h64l30 30v68l-30 30h-64l-30-30V56z" fill="url(#flGold)" opacity=".92"/>
      ${Array.from({ length: 24 }, (_, i) => { const a = i * Math.PI / 12; return `<circle cx="${(220 + 66 * Math.cos(a)).toFixed(1)}" cy="${(90 + 66 * Math.sin(a)).toFixed(1)}" r="1.800" style="fill:var(--champ-ink)" opacity=".45"/>` }).join('')}
      ${globe(220, 76, 34)}
      <rect x="150" y="108" width="140" height="26" rx="4" style="fill:var(--champ-strap);stroke:var(--champ-ink)" stroke-width="1.500"/>
      <text x="220" y="126" text-anchor="middle" style="fill:var(--champ-1);font:800 15px/1 var(--font-body);letter-spacing:.32em">CHAMPION</text>
      <g clip-path="url(#flBeltClip)"><rect class="fl-belt-shine" x="-150" y="0" width="90" height="180" fill="url(#flShine)" transform="skewX(-18)"/></g></svg>`;
  }
  const day = d => d ? new Date(d).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const mon = d => d ? new Date(d).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '';
  const sec = (title, sub, body, cls = '') => `<section class="card fgt-card ${cls}" aria-label="${esc(title)}"><div class="sec-h"><h2>${esc(title)}</h2>${sub ? `<span class="lb">${sub}</span>` : ''}</div>${body}</section>`;
  const link = (o, f, inner, cls = '') => { const at = (f.id || f.name) && o.fighterAttr(f); return at ? `<button type="button" class="${cls}" ${at}>${inner}</button>` : `<span class="${cls}">${inner}</span>` };

  /* Prime and shape (o.prime from ufc.js ufcPrime): four facts, one sentence, and a line of form over every fight
     with the prime shaded. A win is a filled dot, a loss an open square, a draw a diamond, so the result never rests
     on colour. Hover or focus a fight for its details; the table under it has every number. */
  function prime(o) {
    const P = o.prime;
    if (!P) return o.primeLoading ? sec('Prime and shape', 'loading the whole UFC career…', '<div class="skel" style="height:220px"></div>', 'fgt-prime') : '';
    if (!P.pts) return sec('Prime and shape', '', `<p class="lb">One UFC fight on file is not enough to tell a prime from a bad night. It fills in after the next fight.</p>`, 'fgt-prime');
    const pts = P.pts, n = pts.length, yr = d => new Date(d).getFullYear(), W = innerWidth < 600 ? 360 : innerWidth < 1100 ? 620 : 900, H = innerWidth < 600 ? 220 : 250, l = 34, r = 18, t = 26, b = 30;
    const X = i => n === 1 ? (l + W - r) / 2 : l + i * (W - l - r) / (n - 1), Y = v => t + (100 - v) / 100 * (H - t - b), step = n > 1 ? (W - l - r) / (n - 1) : 40;
    const RES = { w: 'Won', l: 'Lost', d: 'Draw' };
    const tip = (x, i) => `${day(x.date)} · ${RES[x.res]} vs ${x.op}${x.method ? `, ${x.method}` : ''}${x.title ? ', title fight' : ''}. Fight score ${x.perf}, form ${x.form}${i === P.peak.i ? ' (peak)' : ''}.`;
    const mark = (x, i) => { const cx = X(i).toFixed(1), cy = Y(x.form).toFixed(1), big = i === n - 1 || i === P.peak.i;
      const shape = x.res === 'w' ? `<circle cx="${cx}" cy="${cy}" r="${big ? 7 : 5}" class="pm w"/>` : x.res === 'l' ? `<rect x="${(cx - (big ? 6 : 4.500)).toFixed(1)}" y="${(cy - (big ? 6 : 4.500)).toFixed(1)}" width="${big ? 12 : 9}" height="${big ? 12 : 9}" class="pm l"/>`
        : `<path d="M${cx} ${cy - 6}l6 6-6 6-6-6z" class="pm d"/>`;
      return `<g class="fgt-pt" tabindex="0" role="img" aria-label="${esc(tip(x, i))}" data-fgttip="${esc(tip(x, i))}"><rect x="${(X(i) - Math.max(step / 2, 10)).toFixed(1)}" y="${t}" width="${Math.max(step, 20).toFixed(1)}" height="${H - t - b}" class="pt-hit"/>${shape}</g>` };
    const years = [...new Set(pts.map(x => yr(x.date)))], every = Math.ceil(years.length / (W < 400 ? 4 : 8)), shown = new Set(years.filter((_, i) => i % every === 0 || i === years.length - 1));
    const ticks = pts.map((x, i) => i === pts.findIndex(z => yr(z.date) === yr(x.date)) && shown.has(yr(x.date)) ? `<text x="${X(i).toFixed(1)}" y="${H - 8}" class="ax" text-anchor="${i === 0 ? 'start' : 'middle'}">${yr(x.date)}</text>` : '').join('');
    const bx0 = Math.max(l - 4, X(P.win.lo) - step / 2), bx1 = Math.min(W - r + 4, X(P.win.hi) + step / 2);
    const svg = `<svg class="fgt-prime-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Form over ${n} UFC fights, prime shaded">
      <rect x="${bx0.toFixed(1)}" y="${t - 18}" width="${(bx1 - bx0).toFixed(1)}" height="${H - t - b + 18}" rx="8" class="band"/><text x="${((bx0 + bx1) / 2).toFixed(1)}" y="${t - 5}" text-anchor="middle" class="band-l">Prime</text>
      ${[0, 50, 100].map(v => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${l - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('')}
      <path d="${pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(x.form).toFixed(1)}`).join('')}" class="ln"/>${pts.map(mark).join('')}${ticks}</svg>`;
    const range = (a, b, yrs) => a === b ? String(a) : yrs && Math.floor(a / 100) === Math.floor(b / 100) ? `${a}–${String(b).slice(2)}` : `${a}–${b}`, ages = P.win.ageFrom != null ? `age ${range(P.win.ageFrom, P.win.ageTo)} · ` : '';
    const inPrime = P.win.hi - P.win.lo + 1, ago = P.now.months < 1 ? 'This month' : P.now.months < 24 ? `${P.now.months} mo` : `${Math.floor(P.now.months / 12)} yrs`;
    const tiles = [['Prime', range(yr(P.win.from), yr(P.win.to), 1), `${ages}${inPrime} fight${inPrime === 1 ? '' : 's'}`], ['Peak form', String(P.peak.form), `after ${pts[P.peak.i].op}, ${mon(pts[P.peak.i].date)}`],
      ['Shape now', String(P.now.form), P.now.pct != null ? `${P.now.pct}% of the peak` : ''], ['Last fight', ago, `${P.now.months < 1 ? '' : 'ago, '}${RES[pts[n - 1].res].toLowerCase()} vs ${pts[n - 1].op}`]];
    const say = { 'At peak': 'Form is at its best right now.', 'In prime': 'Still inside the prime: form has stayed within 10 points of the best.', 'Near peak': 'Close to the best: form is within 5 points of the peak.',
      'Bouncing back': 'Below the peak, but the last result moved form back up.', 'Past peak': `Form is ${P.peak.form - P.now.form} points under the peak${P.now.notes.length ? '' : '.'}`, 'Early days': 'Only a few UFC fights so far, so the prime is still taking shape.' }[P.now.word];
    const sentence = `${say}${P.now.notes.length ? `${P.now.word === 'Past peak' ? ',' : ''} ${P.now.word === 'Past peak' ? '' : 'Also: '}${P.now.notes.join(', ')}.` : ''}`;
    const table = `<details class="fgt-numbers"><summary>See every fight</summary><div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Result</th><th scope="col" class="r">Fight score</th><th scope="col" class="r">Form</th></tr></thead><tbody>
      ${pts.slice().reverse().map(x => `<tr><td class="num">${esc(mon(x.date))}</td><td>${esc(x.op)}</td><td>${RES[x.res]}${x.method ? ` · ${esc(x.method)}` : ''}</td><td class="r num">${x.perf}</td><td class="r num">${x.form}</td></tr>`).join('')}</tbody></table></div></details>`;
    const body = `<div class="fgt-prime-top"><span class="pl solid fgt-verdict">${esc(P.now.word)}</span><p class="fgt-prime-say">${esc(sentence)}</p></div>
      <div class="fgt-prime-tiles">${tiles.map(([lb, v, sub]) => `<div class="tile inset"><span class="lb">${lb}</span><b class="num">${esc(v)}</b>${sub ? `<small class="lb">${esc(sub)}</small>` : ''}</div>`).join('')}</div>
      <div class="fgt-prime-plot">${svg}<div class="fgt-tip" role="status" aria-live="off" hidden></div></div>
      <p class="lb fgt-prime-key"><span><i class="k w"></i>Won</span><span><i class="k l"></i>Lost</span><span><i class="k d"></i>Draw</span><span><i class="k band"></i>Prime</span></p>${table}
      <p class="lb">Our own read, 0 to 100: each fight is scored from the result, how it ended and the opponent's record, and form leans on the latest fights. UFC fights from ${yr(P.since)}${P.early ? ' (the feed starts in 2014, so earlier fights and other promotions are not counted)' : ''}.</p>`;
    return sec('Prime and shape', `${n} UFC fight${n === 1 ? '' : 's'}${o.primeLoading ? ' · loading earlier fights…' : ''}`, body, 'fgt-prime');
  }
  // the hover and focus tooltip on the prime chart
  const showTip = e => { const g = e.target.closest?.('[data-fgttip]'), plot = e.target.closest?.('.fgt-prime-plot'); if (!plot) return; const tip = plot.querySelector('.fgt-tip'); if (!tip) return;
    if (!g) { tip.hidden = true; return } const pr = plot.getBoundingClientRect(), gr = g.querySelector('.pm').getBoundingClientRect();
    tip.textContent = g.dataset.fgttip; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(pr.width - w, gr.left - pr.left + gr.width / 2 - w / 2)) + 'px'; tip.style.top = Math.max(0, gr.top - pr.top - tip.offsetHeight - 10) + 'px' };
  document.addEventListener('pointerover', showTip); document.addEventListener('focusin', showTip);
  document.addEventListener('pointerout', e => { const plot = e.target.closest?.('.fgt-prime-plot'); if (plot && !plot.contains(e.relatedTarget)) { const t = plot.querySelector('.fgt-tip'); if (t) t.hidden = true } });
  document.addEventListener('focusout', e => { const plot = e.target.closest?.('.fgt-prime-plot'); if (plot && !plot.contains(e.relatedTarget)) { const t = plot.querySelector('.fgt-tip'); if (t) t.hidden = true } });

  /* o: see ufc.js ufcFighterSheet and boxing.js bxFighterSheet for the facts handed in */
  function page(o) {
    const st = o.status || {}, champs = st.champs || [], gold = champs.length > 0, r = o.record;
    // 1. ranking status, always first
    const badges = [...champs.map(c => `<span class="pl solid fgt-b">${ic('trophy', 14)}${esc(c.cls)} ${c.interim ? 'interim champion' : 'champion'}</span>`),
      !gold && st.rank != null ? `<span class="pl solid fgt-b"><b class="num">#${st.rank}</b> ${esc(st.cls || '')}${typeof st.change === 'number' && st.change ? ` <small class="fgt-mv">${st.change > 0 ? 'up' : 'down'} ${Math.abs(st.change)}</small>` : st.change === 'new' ? ' <small class="fgt-mv">new</small>' : ''}</span>` : '',
      !gold && st.rank == null && st.known && st.p4p == null && st.wp4p == null ? `<span class="pl fgt-b">Unranked</span>` : '', !st.known && st.note ? `<span class="pl fgt-b">${esc(st.note)}</span>` : '',
      st.p4p != null ? `<span class="pl fgt-b">Pound-for-pound <b class="num">#${st.p4p}</b></span>` : '', st.wp4p != null ? `<span class="pl fgt-b">Women's pound-for-pound <b class="num">#${st.wp4p}</b></span>` : '', !gold && st.former ? `<span class="pl fgt-b">Former champion</span>` : '',
      o.active === false ? `<span class="pl fgt-b">Not active</span>` : '', o.heat != null && window.flHeat ? window.flHeat.badge(o.heat) : ''].filter(Boolean).join('');
    const recTxt = r ? `${r.w}–${r.l}–${r.d}` : '', onlyInterim = gold && champs.every(c => c.interim), champWord = onlyInterim ? 'interim champion' : 'champion';
    const tiles = [r ? ['Record', recTxt, `${r.w} wins, ${r.l} losses, ${r.d} draws${r.nc ? `, ${r.nc} no contest${r.nc === 1 ? '' : 's'}` : ''}`, r.nc ? `${r.nc} no contest${r.nc === 1 ? '' : 's'}` : 'won, lost, drawn'] : o.recordText ? ['Record', o.recordText, ''] : null,
      gold && o.defenses != null ? ['Title defenses', String(o.defenses), ''] : null, gold && o.since ? [`Days as ${champWord}`, String(Math.max(0, Math.floor((Date.now() - new Date(o.since)) / 864e5))), ''] : null,
      o.streak ? [o.streak.win ? 'Win streak' : 'Losing run', String(o.streak.n), o.streak.note || ''] : null].filter(Boolean);
    const hero = `<div class="hero solo fgt-hero">${typeof topBar === 'function' ? topBar(o.back) : ''}<div class="fgt-in">
        <div class="fgt-id">${badges ? `<div class="fgt-badges">${badges}</div>` : ''}${o.nick ? `<p class="fgt-nick">“${esc(o.nick)}”</p>` : ''}
          <div class="fgt-who">${gold ? '' : o.photo || ''}<h3 class="fgt-name">${esc(o.name)}</h3></div>
          <p class="fgt-sub">${[o.division, o.weight, o.stance, o.country].filter(Boolean).map(esc).join(' · ')}</p>
          ${tiles.length ? `<div class="fgt-tiles">${tiles.map(([l, v, t, sub]) => `<div class="tile"${t ? ` title="${esc(t)}"` : ''}><span class="lb">${l}</span><b class="num">${esc(v)}</b>${sub ? `<small class="lb">${esc(sub)}</small>` : ''}</div>`).join('')}</div>` : ''}</div>
        ${gold ? `<div class="fgt-belts">${o.photo ? `<div class="fgt-champ-photo">${o.photo}</div>` : ''}${champs.map(c => belt(`${c.cls} championship belt`)).join('')}${o.since ? `<p class="lb">${champs.length > 1 ? esc(champs[0].cls) + ' champion' : onlyInterim ? 'Interim champion' : 'Champion'} since ${esc(day(o.since))}</p>` : ''}</div>` : ''}</div></div>`;
    // the division ladder: champion and the top five, the rest on request
    const L = o.ladder, lad = L && (L.champ.length || L.list.length) ? (() => { const n = o.ladderAll ? 15 : 5, rows = L.list.slice(0, n), more = L.list.length > 5;
      const cell = (f, tag) => { const ch = tag === 'C' || tag === 'IC'; return link(o, f, `<b class="num">${ch ? miniBelt() + `<span class="sr-only">${tag === 'IC' ? 'Interim champion' : 'Champion'}</span>${tag === 'IC' ? '<span aria-hidden="true">&nbsp;IC</span>' : ''}` : tag}</b><span>${esc(f.name || 'Unknown')}</span>`, 'fgt-rung' + (ch ? ' ch' : '') + (String(f.id) === String(o.id) || (!f.id && f.name === o.name) ? ' me' : '')) };
      const mine = L.list.find(f => String(f.id) === String(o.id)), far = mine && !rows.includes(mine);
      return `<nav class="card fgt-ladder" aria-label="${esc(L.cls)} rankings"><span class="fgt-ladder-h">${esc(L.cls)} ranks</span><div class="fgt-rungs">${L.champ.map(f => cell(f, f.interim ? 'IC' : 'C')).join('')}${rows.map(f => cell(f, '#' + f.rank)).join('')}${far ? cell(mine, '#' + mine.rank) : ''}</div>
        ${more ? `<button type="button" class="bt sm ghost" ${o.actAttr('ladder')} aria-expanded="${!!o.ladderAll}">${o.ladderAll ? 'Top 5' : 'Top 15'}</button>` : ''}</nav>` })() : '';
    // 2. how they win
    const W = o.wins, how = W ? (() => { const parts = [['ko', 'Knockout', W.ko], ['sub', 'Submission', W.sub], ['dec', 'Decision', W.dec]].filter(x => x[2] != null), tot = parts.reduce((a, x) => a + x[2], 0);
      return `<div class="fgt-split" role="img" aria-label="How the ${tot} wins came: ${parts.map(x => `${x[2]} by ${x[1].toLowerCase()}`).join(', ')}">${parts.filter(x => x[2]).map(([c, , n]) => `<i class="${c}" style="flex:${n}"></i>`).join('')}</div>
        <div class="fgt-counts">${parts.map(([c, l, n]) => `<div class="${c}"><b class="fig num">${n}</b><span class="lb"><i></i>${l}</span></div>`).join('')}</div>` })() : `<p class="lb">The record does not say how the wins came.</p>`;
    const rates = (o.rates || []).length ? `<dl class="fgt-rates">${o.rates.map(x => `<div><dt>${esc(x.label)}</dt><dd><span class="trak"><i style="width:${Math.max(0, Math.min(100, x.pct))}%"></i></span><b class="num">${esc(x.value)}</b></dd></div>`).join('')}</dl>${o.ratesNote ? `<p class="lb">${esc(o.ratesNote)}</p>` : ''}`
      : `<p class="lb fgt-miss">${esc(o.ratesNote || 'Striking and grappling numbers are not in the data source for this fighter.')}</p>`;
    const nums = (o.nums || []).length ? `<div class="fgt-nums">${o.nums.map(([l, v, t]) => `<div class="tile inset"><span class="lb">${esc(l)}</span><b class="num">${esc(v)}</b>${t ? `<small class="lb">${esc(t)}</small>` : ''}</div>`).join('')}</div>` : '';
    const tape = (o.tape || []).filter(x => x[1] != null && x[1] !== '');
    const tapeH = tape.length ? `<div class="fgt-tape">${tape.map(([l, v]) => `<div class="tile"><span class="lb">${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : `<p class="lb">No measurements on file.</p>`;
    // 5. next fight
    const N = o.next, next = N ? `<div class="fgt-next">${N.op.face || ''}<span class="rw-t"><b>vs ${esc(N.op.name)}${N.op.tag ? ` <span class="lb">(${esc(N.op.tag)})</span>` : ''}</b><small>${esc([N.event, N.date ? day(N.date) : 'date to be announced'].filter(Boolean).join(' · '))}</small></span>${N.title ? `<span class="pl solid">Title fight</span>` : ''}</div>
        <div class="cx-row">${N.h2h ? `<button type="button" class="bt sm" ${N.h2h}>Head to head</button>` : ''}${o.labArgs ? `<button type="button" class="bt sm ghost" data-fgtlab="${esc(JSON.stringify(o.labArgs))}">${ic('lab', 16)}Open in the Lab</button>` : ''}</div>`
      : `<p class="lb">${esc(o.nextNote || 'No fight booked.')}</p>${o.labArgs ? `<div class="cx-row"><button type="button" class="bt sm ghost" data-fgtlab="${esc(JSON.stringify(o.labArgs))}">${ic('lab', 16)}Open in the Lab</button></div>` : ''}`;
    // 6. fight history: the result is a word and a shape, never colour alone
    const RES = { w: ['Win', 'check'], l: ['Loss', 'x'], d: ['Draw', ''], nc: ['No contest', ''], f: ['Fought', ''] };
    const H = o.history || [], hist = H.length ? `<div class="tbx-wrap"><table class="tbx fgt-hist"><thead><tr><th scope="col">Result</th><th scope="col">Opponent</th><th scope="col">Method</th><th scope="col">Round</th><th scope="col">Date</th><th scope="col">Event</th><th scope="col"><span class="sr-only">Title fight</span></th></tr></thead><tbody>
        ${H.map(h => `<tr><td><span class="pl fgt-res ${h.res}">${RES[h.res][1] ? ic(RES[h.res][1], 13) : ''}${RES[h.res][0]}</span></td><td>${link(o, h.op, esc(h.op.name || 'To be announced'), 'fgt-op')}</td><td>${esc(h.method || '–')}</td><td class="num">${h.round ? `R${h.round}${h.clock ? ' · ' + esc(h.clock) : ''}` : '–'}</td><td class="num">${esc(mon(h.date))}</td>
          <td>${h.fightAttr ? `<button type="button" class="fgt-op" ${h.fightAttr}>${esc(h.event || 'Fight')}</button>` : esc(h.event || '')}</td><td>${h.title ? `<span class="pl">Title fight</span>` : ''}</td></tr>`).join('')}</tbody></table></div>${o.historyMore || ''}`
      : `<div class="emp">${ic('versus', 26)}<b>No fights on file</b><p>${esc(o.historyNote || 'The data source has no fight list for this fighter.')}</p></div>${o.historyMore || ''}`;
    const awards = window.flProfile ? window.flProfile.shelf({ sport: o.sport, id: o.awardId || o.id, name: o.name }) : '';
    const body = `${lad}${prime(o)}<div class="fgt-grid">${sec(o.winsTitle || 'How they win', o.winsSub || '', how + nums + rates)}${sec('Tale of the tape', '', tapeH)}${sec('Next fight', '', next, 'fgt-nextc')}</div>${awards}
      ${sec('Fight history', o.historySub || '', hist, 'fgt-histc')}${o.source ? `<p class="lb fgt-src">${o.source}</p>` : ''}`;
    return { hero, body, gold };
  }
  document.addEventListener('click', e => { const b = e.target.closest?.('[data-fgtlab]'); if (b) { try { window.flLab?.open(JSON.parse(b.dataset.fgtlab)) } catch (x) {} } });
  window.flFighter = { page, belt, miniBelt, defs };
})();
