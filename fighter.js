/* Floodlight · the fighter profile, shared by UFC and boxing.
   ufc.js and boxing.js load their own data and hand it here as plain facts; this file lays the page out: ranking status
   and the division ladder first, the header, how they win, the tale of the tape, awards, the next fight and the fight
   history. A fighter who holds a title gets the gold page (the fgt-gold class re-points the theme tokens, tokens.css)
   and the belt. The belt is our own drawing: a leather strap, a round centre plate with a star and two side plates.
   Nothing here is hard-coded about any fighter: champion, rank and dates all come from what the caller read. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const star = (cx, cy, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * .42 : r; d += (i ? 'L' : 'M') + (cx + q * Math.cos(a)).toFixed(1) + ' ' + (cy + q * Math.sin(a)).toFixed(1) } return d + 'Z' };
  let beltN = 0;
  function belt(label) {
    const g = 'fgtBelt' + (++beltN);
    return `<svg class="fgt-belt" viewBox="0 0 440 180" role="img" aria-label="${esc(label || 'Championship belt')}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--belt-plate-1)"/><stop offset="1" stop-color="var(--belt-plate-2)"/></linearGradient></defs>
      <rect x="6" y="52" width="428" height="76" rx="22" fill="var(--belt-strap)"/><rect x="16" y="61" width="408" height="58" rx="15" fill="none" stroke="var(--belt-stitch)" stroke-width="1.6" stroke-dasharray="5 6" opacity=".7"/>
      ${[[26, 78], [26, 102], [414, 78], [414, 102]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.200" fill="var(--belt-plate-1)"/>`).join('')}
      ${[92, 348].map(x => `<circle cx="${x}" cy="90" r="33" fill="url(#${g})" stroke="var(--belt-ink)" stroke-width="2"/><circle cx="${x}" cy="90" r="25" fill="none" stroke="var(--belt-ink)" stroke-width="1.4" opacity=".55"/><path d="${star(x, 90, 15)}" fill="var(--belt-ink)" opacity=".8"/>`).join('')}
      <circle cx="220" cy="90" r="84" fill="url(#${g})" stroke="var(--belt-ink)" stroke-width="2.500"/><circle cx="220" cy="90" r="70" fill="none" stroke="var(--belt-ink)" stroke-width="1.6" opacity=".5"/>
      ${Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8; return `<circle cx="${(220 + 77 * Math.cos(a)).toFixed(1)}" cy="${(90 + 77 * Math.sin(a)).toFixed(1)}" r="2.200" fill="var(--belt-ink)" opacity=".6"/>` }).join('')}
      <path d="${star(220, 90, 46)}" fill="var(--surface)" stroke="var(--belt-ink)" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }
  const day = d => d ? new Date(d).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const mon = d => d ? new Date(d).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '';
  const sec = (title, sub, body, cls = '') => `<section class="card fgt-card ${cls}" aria-label="${esc(title)}"><div class="sec-h"><h2>${esc(title)}</h2>${sub ? `<span class="lb">${sub}</span>` : ''}</div>${body}</section>`;
  const link = (o, f, inner, cls = '') => f.id || f.name ? `<button type="button" class="${cls}" ${o.fighterAttr(f)}>${inner}</button>` : `<span class="${cls}">${inner}</span>`;

  /* o: see ufc.js ufcFighterSheet and boxing.js bxFighterSheet for the facts handed in */
  function page(o) {
    const st = o.status || {}, champs = st.champs || [], gold = champs.length > 0, r = o.record;
    // 1. ranking status, always first
    const badges = [...champs.map(c => `<span class="pl solid fgt-b">${ic('trophy', 14)}${esc(c.cls)} ${c.interim ? 'interim champion' : 'champion'}</span>`),
      !gold && st.rank != null ? `<span class="pl solid fgt-b"><b class="num">#${st.rank}</b> ${esc(st.cls || '')}</span>` : '',
      !gold && st.rank == null && st.known ? `<span class="pl fgt-b">Unranked</span>` : '', !st.known && st.note ? `<span class="pl fgt-b">${esc(st.note)}</span>` : '',
      st.p4p != null ? `<span class="pl fgt-b">Pound-for-pound <b class="num">#${st.p4p}</b></span>` : '', !gold && st.former ? `<span class="pl fgt-b">Former champion</span>` : '',
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
      const cell = (f, tag) => link(o, f, `<b class="num">${tag}</b><span>${esc(f.name || 'Unknown')}</span>`, 'fgt-rung' + (String(f.id) === String(o.id) ? ' me' : ''));
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
    const body = `${lad}<div class="fgt-grid">${sec(o.winsTitle || 'How they win', o.winsSub || '', how + nums + rates)}${sec('Tale of the tape', '', tapeH)}${sec('Next fight', '', next, 'fgt-nextc')}</div>${awards}
      ${sec('Fight history', o.historySub || '', hist, 'fgt-histc')}${o.source ? `<p class="lb fgt-src">${o.source}</p>` : ''}`;
    return { hero, body, gold };
  }
  document.addEventListener('click', e => { const b = e.target.closest?.('[data-fgtlab]'); if (b) { try { window.flLab?.open(JSON.parse(b.dataset.fgtlab)) } catch (x) {} } });
  window.flFighter = { page, belt };
})();
