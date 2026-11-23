/* Floodlight · the evidence behind a pick, shown when a pick on the Predictions page is opened.
   Nothing here changes a number. It lays out what the number was made from:
   - a player prop: the game log against the line, how often each side hit, the spread of results, home and away and
     opponent splits, our projection beside the line, and every posted price. All of it is the same list of games the
     Lab's reading (meter.js) used, so the panel and the number cannot disagree.
   - a match forecast: every forecast the server has saved for the match, oldest to newest, so what moved is read off the
     record (the book's line, the quarterbacks, the weather, the news check), plus the reasons saved with the latest one.
   The range beside a number is not a second model. For a prop it is one standard error either side, from the number of
   games behind the reading. For a match it is the span between our model alone and the market, which the forecast blends.
   "What would change this" lists the inputs the number rests on, and says plainly what it does not know about. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => Math.round(x * 100), fmt = v => Number.isInteger(v) ? String(v) : (+v).toFixed(1);
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' };
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago` };
  const tile = (k, v, sub = '') => `<div class="tile inset ev-tile"><span class="lb">${k}</span><b class="fig num">${v}</b>${sub ? `<small class="lb">${sub}</small>` : ''}</div>`;
  const sec = (title, body, note = '') => body ? `<section class="ev-sec"><h4>${title}</h4>${note ? `<p class="lb">${note}</p>` : ''}${body}</section>` : '';

  /* one standard error either side of a hit chance, from the effective number of games behind it */
  function propRange(p) { const n = Math.max(1, p.neff || p.n || 1), se = Math.sqrt(p.ours * (1 - p.ours) / n); return { lo: Math.max(.02, p.ours - se), hi: Math.min(.98, p.ours + se), n: p.n || 0 } }
  /* a match forecast blends our model with the market: the range is the span between the two */
  function matchRange(p, snap) { const k = p.m.pick, mine = snap?.model?.pH != null && k !== 'draw' ? (k === 'home' ? snap.model.pH : 1 - snap.model.pH) : null, xs = [p.ours, p.market, mine].filter(v => v != null); return xs.length > 1 ? { lo: Math.min(...xs), hi: Math.max(...xs), model: mine } : null }

  /* moving the line on the game log: recount over, under and push for the games shown. Counting only, no new estimate. */
  const tryText = (log, line, posted) => { const o = log.filter(g => g.v > line).length, u = log.filter(g => g.v < line).length, ps = log.length - o - u;
    return `<b class="num">Line ${fmt(line)}</b>${line === posted ? ' <span class="lb">posted</span>' : ''} · Over <b class="num">${o}</b> · Under <b class="num">${u}</b>${ps ? ` · Push <b class="num">${ps}</b>` : ''} <span class="lb">of the last ${log.length}</span>` };
  function setLine(box, line) {
    const top = +box.dataset.evtop, posted = +box.dataset.evposted, over = box.dataset.evside === 'over', wrap = box.parentElement;
    line = Math.max(.5, Math.min(Math.round(line * 2) / 2, Math.ceil(top / 1.12) + .5));
    const mark = box.querySelector('.ev-line'); mark.style.bottom = (line / top * 100).toFixed(1) + '%'; mark.querySelector('i').textContent = fmt(line); mark.classList.toggle('moved', line !== posted);
    const bars = [...box.querySelectorAll('.ev-bar')], log = bars.map(b => ({ v: +b.dataset.v }));
    bars.forEach(b => { const v = +b.dataset.v; b.classList.remove('hit', 'miss', 'push'); b.classList.add(v === line ? 'push' : (over ? v > line : v < line) ? 'hit' : 'miss') });
    const out = wrap.querySelector('.ev-tryout'), sl = wrap.querySelector('[data-evline]'), rs = wrap.querySelector('[data-evreset]');
    if (out) out.innerHTML = tryText(log, line, posted); if (sl && +sl.value !== line) sl.value = line; if (rs) rs.hidden = line === posted;
  }
  document.addEventListener('input', ev => { if (ev.target.matches?.('[data-evline]')) { const box = ev.target.closest('.ev-sec')?.querySelector('.ev-log'); if (box) setLine(box, +ev.target.value) } });
  document.addEventListener('click', ev => { const r = ev.target.closest?.('[data-evreset]'); if (r) { const box = r.closest('.ev-sec')?.querySelector('.ev-log'); if (box) { setLine(box, +box.dataset.evposted); r.closest('.ev-try')?.querySelector('[data-evline]')?.focus() } } });
  let dragBox = null;
  const fromY = (box, y) => { const r = box.getBoundingClientRect(), cs = getComputedStyle(box), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom), h = r.height - pt - pb; return (1 - (y - r.top - pt) / h) * +box.dataset.evtop };
  document.addEventListener('pointerdown', ev => { const box = ev.target.closest?.('.ev-log.drag'); if (!box) return; dragBox = box; box.classList.add('dragging'); setLine(box, fromY(box, ev.clientY)); ev.preventDefault() });
  document.addEventListener('pointermove', ev => { if (dragBox) setLine(dragBox, fromY(dragBox, ev.clientY)) });
  document.addEventListener('pointerup', () => { dragBox?.classList.remove('dragging'); dragBox = null });
  document.addEventListener('pointercancel', () => { dragBox?.classList.remove('dragging'); dragBox = null });

  /* ---------- a player prop ---------- */
  function prop(p) {
    const gs = (p.games || []).filter(g => g.v != null), over = p.side === 'over', hit = g => over ? g.v > p.line : g.v < p.line, push = g => g.v === p.line;
    const warn = p.teamNote ? `<p class="ev-warn" role="note"><b>Team check.</b> ${esc(p.teamNote)}</p>` : '';
    if (!gs.length) return warn + `<p class="lb">The games behind this line were not kept with it. Open it in the Lab to see the full log.</p>`;
    const word = p.yes ? (over ? 'Yes' : 'No') : over ? 'Over' : 'Under', R = propRange(p);
    // the log: the last 20, oldest on the left, each against the line
    const log = gs.slice(0, 20).reverse(), top = Math.max(p.line, ...log.map(g => g.v)) * 1.12 || 1, lineY = p.line / top * 100;
    const vmax = Math.ceil(Math.max(p.line, ...log.map(g => g.v))), canTry = !p.yes && vmax > 1;
    const bars = `<div class="ev-log${canTry ? ' drag' : ''}" data-evtop="${top}" data-evposted="${p.line}" data-evside="${over ? 'over' : 'under'}" role="img" aria-label="Last ${log.length} games, oldest first: ${esc(log.map(g => fmt(g.v)).join(', '))}. Line ${fmt(p.line)}.">
      <span class="ev-line" style="bottom:${lineY.toFixed(1)}%"><i class="num">${fmt(p.line)}</i></span>
      ${log.map(g => `<span class="ev-bar ${push(g) ? 'push' : hit(g) ? 'hit' : 'miss'}" data-v="${g.v}" title="${esc(`${fmt(g.v)}${g.oppAbbr ? ` ${g.home === false ? 'at' : 'v'} ${g.oppAbbr}` : ''}${g.min ? `, ${fmt(g.min)} min` : ''}`)}"><i style="height:${Math.max(2, g.v / top * 100).toFixed(1)}%"><b class="num">${fmt(g.v)}</b></i><small>${esc(g.oppAbbr || '')}</small></span>`).join('')}</div>
      <div class="pd-leg" aria-hidden="true"><span><i class="hit"></i>${word}</span><span><i class="said"></i>${p.yes ? (over ? 'No' : 'Yes') : over ? 'Under' : 'Over'}</span><span class="lb">Oldest on the left, newest on the right</span></div>
      ${canTry ? `<div class="ev-try"><label><span>Try another line</span><input type="range" min="0.5" max="${vmax + 0.5}" step="0.5" value="${p.line}" data-evline aria-describedby="evTryOut"></label>
        <output class="ev-tryout" id="evTryOut" aria-live="polite">${tryText(log, p.line, p.line)}</output><button type="button" class="lk" data-evreset hidden>Back to the posted line</button></div>
        <p class="lb">Drag the dashed line on the chart, or use the slider, to see how the last ${log.length} games fall against any line. This only recounts the games shown; our number above stays tied to the posted line.</p>` : ''}`;
    // counts for the side picked
    const count = (xs, label) => { const d = xs.filter(g => !push(g)), h = d.filter(hit).length, ps = xs.length - d.length; return d.length ? { label, h, n: d.length, ps, rate: h / d.length } : null };
    const rows = [count(gs.slice(0, 5), 'Last 5'), count(gs.slice(0, 10), 'Last 10'), count(gs.slice(0, 20), 'Last 20'), gs.length > 20 ? count(gs, `All ${gs.length}`) : null,
      gs.some(g => g.home === true) ? count(gs.filter(g => g.home === true), 'Home') : null, gs.some(g => g.home === false) ? count(gs.filter(g => g.home === false), 'Away') : null].filter(Boolean);
    const oppGs = p.opp ? gs.filter(g => [g.opp, g.oppAbbr].some(o => o && (String(o).toLowerCase() === String(p.opp).toLowerCase()))) : [];
    if (oppGs.length) rows.push(count(oppGs, `Against ${p.opp}`));
    const table = `<div class="tbx-wrap"><table class="tbx ev-tbl"><thead><tr><th scope="col">Games</th><th scope="col" class="r">${word}</th><th scope="col" class="r">Rate</th><th scope="col" class="r">Average</th>${rows.some(r => r && r.ps) ? '<th scope="col" class="r">Pushes</th>' : ''}</tr></thead>
      <tbody>${rows.filter(Boolean).map(r => { const src = r.label === 'Home' ? gs.filter(g => g.home === true) : r.label === 'Away' ? gs.filter(g => g.home === false) : r.label.startsWith('Against') ? oppGs : r.label.startsWith('All') ? gs : gs.slice(0, +r.label.split(' ')[1]);
        return `<tr><th scope="row">${esc(r.label)}</th><td class="r num">${r.h} of ${r.n}</td><td class="r num">${pct(r.rate)}%</td><td class="r num">${p.yes ? '–' : fmt(Math.round(avg(src.map(g => g.v)) * 10) / 10)}</td>${rows.some(x => x && x.ps) ? `<td class="r num">${r.ps || '–'}</td>` : ''}</tr>` }).join('')}</tbody></table></div>`;
    // the spread of results
    let dist = '';
    if (!p.yes) { const vs = gs.slice(0, 40).map(g => g.v), lo = Math.floor(Math.min(...vs, p.line)), hi = Math.ceil(Math.max(...vs, p.line)), span = Math.max(1, hi - lo), step = span <= 12 ? 1 : Math.ceil(span / 10), bins = [];
      const edge = Math.floor(p.line) + 1, from = edge - Math.ceil((edge - lo) / step) * step;   // a bin edge sits on the line, so no bin straddles it
      for (let a = from; a <= hi; a += step) bins.push({ a, b: a + step, n: vs.filter(v => v >= a && v < a + step).length });
      const mx = Math.max(1, ...bins.map(b => b.n));
      dist = `<div class="ev-dist" role="img" aria-label="How the last ${vs.length} results spread: ${esc(bins.filter(b => b.n).map(b => `${b.n} at ${step === 1 ? b.a : `${b.a} to ${b.b - 1}`}`).join(', '))}.">${bins.map(b => { const side = b.b <= p.line ? 'lo' : b.a > p.line ? 'hi' : 'mid', good = side === 'mid' ? 'push' : (side === 'hi') === over ? 'hit' : 'miss';
        return `<span class="ev-bin ${good}"><i style="height:${(b.n / mx * 100).toFixed(0)}%">${b.n ? `<b class="num">${b.n}</b>` : ''}</i><small class="num">${step === 1 ? b.a : `${b.a}–${b.b - 1}`}</small></span>` }).join('')}</div>` }
    // our projection beside the line, and each posted price
    const offers = (p.offers || []).filter(o => o.line != null);
    const market = offers.length ? `<div class="tbx-wrap"><table class="tbx ev-tbl"><thead><tr><th scope="col">App</th><th scope="col" class="r">Line</th><th scope="col">Type</th><th scope="col" class="r">${word} chance in the price</th></tr></thead>
      <tbody>${offers.map(o => { const po = o.pOver == null ? null : over ? o.pOver : 1 - o.pOver; return `<tr><th scope="row">${esc(BOOK[o.book] || o.book || '–')}</th><td class="r num">${fmt(o.line)}${o.line !== p.line ? ' <small class="lb">other line</small>' : ''}</td><td>${esc(o.kind === 'standard' ? 'Standard' : o.kind || '–')}</td><td class="r num">${po == null ? '<span class="lb">One-sided, no price</span>' : pct(po) + '%'}</td></tr>` }).join('')}</tbody></table></div>` : '';
    const mins = gs.map(g => g.min).filter(m => m != null), m5 = avg(gs.slice(0, 5).map(g => g.min).filter(m => m != null)), mAll = avg(mins);
    // what the number rests on
    const flip = !p.yes && p.mu != null ? `The lean flips if the line moves to about ${fmt(Math.round(p.mu * 2) / 2)}, which is our projection.` : '';
    const what = [flip,
      m5 && mAll && mins.length >= 10 ? `It assumes about ${fmt(Math.round(m5))} minutes, the last-5 average (${fmt(Math.round(mAll))} over the whole log). A cut in minutes lowers every counting stat.` : '',
      p.market != null ? `The edge is ${p.edge > 0 ? '+' : ''}${p.edge} against a price read ${p.at ? ago(p.at) : 'earlier'}. If the app moves the line or the price, the edge moves with it.` : 'No app posts both sides of this line, so there is no market number to compare with.',
      'Not in this number: injuries, a changed role or starting lineup, rest days and anything announced after the games in the log.'].filter(Boolean);
    return `${warn}<div class="ev-tiles">${tile('Our number', `${pct(p.ours)}%`, `Likely range ${pct(R.lo)}–${pct(R.hi)}%`)}${tile('Market', p.market == null ? '–' : `${pct(p.market)}%`, p.market == null ? 'No two-sided price' : 'Margin taken out')}
        ${p.yes ? '' : tile('We project', fmt(Math.round(p.mu * 10) / 10), `Line ${fmt(p.line)}${p.sd ? ` · usually ${fmt(Math.max(0, Math.round((p.mu - p.sd) * 10) / 10))} to ${fmt(Math.round((p.mu + p.sd) * 10) / 10)}` : ''}`)}${tile('Games read', R.n, p.conf ? `${esc(p.conf)} confidence` : '')}</div>
      ${sec('Game log against the line', bars)}
      ${sec(`How often ${word.toLowerCase()} hit`, table)}
      ${sec('Spread of results', dist, dist ? `The last ${Math.min(40, gs.length)} games, grouped by result. The line is ${fmt(p.line)}.` : '')}
      ${sec('Posted prices', market, market ? `Read ${p.at ? ago(p.at) : 'earlier'}. A chance is shown only where the app posts both sides, with its margin taken out.` : '')}
      ${sec('What would change this pick', `<ul class="ev-list">${what.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`)}
      <p class="lb ev-how">How it is made: the Lab's heat reading. Recent games count more than old ones, and the hit rate is blended with a projection for this line. The range is one standard error either side, so it is wider when fewer games are behind it. This is research from past games, not a guarantee.</p>`;
  }

  /* ---------- a match forecast ---------- */
  const STAGE = { week: 'A week out', days3: 'Three days out', days2: 'Two days out', day: 'The day before', morning: 'Morning of', hours3: 'Three hours out', hour: 'An hour out', lineups: 'After lineups', final: 'Last forecast', live: 'In play' };
  const stageName = s => STAGE[s] || String(s || '').replace(/^./, c => c.toUpperCase());
  const whenTxt = t => new Date(t * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function match(p, view) {
    if (!view) return `<div class="ev-wait" aria-busy="true"><span class="pd-spin" aria-hidden="true"></span><span class="lb">Loading the saved forecasts for this match…</span></div>`;
    if (view.error) return `<div class="ev-wait"><span class="lb">The saved forecasts did not load: ${esc(view.error)}</span><button type="button" class="bt sm" data-pdevretry="${esc(p.id)}">Try again</button></div>`;
    const m = p.m, k = m.pick, snaps = (view.snaps || []).filter(s => s.pick && s.final), last = snaps[snaps.length - 1];
    if (!last) return `<p class="lb">No saved forecast for this match yet.</p>`;
    const side = s => s.final?.[k] ?? null, mk = s => s.market?.pH == null || k === 'draw' ? (s === last ? p.market : null) : k === 'home' ? s.market.pH : 1 - s.market.pH;
    const R = matchRange(p, last), pickName = k === 'draw' ? 'Draw' : m[k];
    const outs = ['home', 'draw', 'away'].filter(o => last.final[o] != null);
    const bars = `<dl class="ev-outs">${outs.map(o => `<div class="${o === k ? 'on' : ''}"><dt>${esc(o === 'draw' ? 'Draw' : m[o])}</dt><dd><span class="trak"><i style="width:${pct(last.final[o])}%"></i></span><b class="num">${pct(last.final[o])}%</b><small class="lb num">${m.market?.[o] != null ? `market ${pct(m.market[o])}%` : ''}</small></dd></div>`).join('')}</dl>`;
    // what moved: each saved forecast, and what was different about it
    const moved = snaps.map((s, i) => { const prev = snaps[i - 1], why = [];
      if (prev) {
        if (s.market?.details && prev.market?.details && s.market.details !== prev.market.details) why.push(`Line ${prev.market.details} to ${s.market.details}`);
        if (s.market?.total != null && prev.market?.total != null && s.market.total !== prev.market.total) why.push(`Total ${prev.market.total} to ${s.market.total}`);
        for (const sd of ['home', 'away']) { const a = prev.qb?.[sd]?.name, b = s.qb?.[sd]?.name; if (a && b && a !== b) why.push(`${m[sd]} quarterback ${a} to ${b}`) }
        const out = Object.keys(s.qbOut || {}).filter(x => !(prev.qbOut || {})[x]); if (out.length) why.push(`Quarterback ruled out: ${out.map(x => m[x] || x).join(', ')}`);
        if (s.ai && !prev.ai) why.push('News check added');
        if (s.pick !== prev.pick) why.push('Pick changed');
        if (!why.length && Math.abs((side(s) ?? 0) - (side(prev) ?? 0)) >= .01) why.push('Team form and prices updated');
      }
      return { s, why, ours: side(s), mk: mk(s) } });
    const first = moved[0], lastM = moved[moved.length - 1], delta = first.ours != null && lastM.ours != null ? Math.round((lastM.ours - first.ours) * 100) : 0;
    const trail = `<div class="tbx-wrap"><table class="tbx ev-tbl"><thead><tr><th scope="col">Forecast</th><th scope="col">Made</th><th scope="col" class="r">Ours</th><th scope="col" class="r">Market</th><th scope="col">What was different</th></tr></thead>
      <tbody>${moved.map(x => `<tr><th scope="row">${esc(stageName(x.s.stage))}</th><td class="num">${esc(whenTxt(x.s.at))}</td><td class="r num">${x.ours == null ? '–' : pct(x.ours) + '%'}</td><td class="r num">${x.mk == null ? '–' : pct(x.mk) + '%'}</td><td>${x.why.length ? esc(x.why.join('. ')) : x === first ? 'First forecast' : '<span class="lb">Nothing notable</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    const proj = [last.score?.length === 2 ? tile('Projected score', `${last.score[0]}–${last.score[1]}`, `${esc(m.home)} first`) : '',
      last.margin != null && m.sport !== 'soccer' ? tile('Our margin', fmt(Math.abs(last.margin)), `${esc(last.margin >= 0 ? m.home : m.away)}${last.market?.details ? ` · book ${esc(last.market.details)}` : ''}`) : '',
      last.total != null ? tile('Our total', fmt(last.total), last.market?.total != null ? `Book ${fmt(last.market.total)}` : '') : '',
      Array.isArray(last.xg) && last.xg[0] != null ? tile('Expected goals', `${(+last.xg[0]).toFixed(1)}–${(+last.xg[1]).toFixed(1)}`) : ''].join('');
    const reasons = (last.reasons || []).filter(r => typeof r === 'string' && r.trim());
    const what = [
      last.qb?.home?.name || last.qb?.away?.name ? `It assumes these quarterbacks start: ${[last.qb.home?.name && `${last.qb.home.name} (${m.home})`, last.qb.away?.name && `${last.qb.away.name} (${m.away})`].filter(Boolean).join(', ')}. A change there moves it most.` : '',
      last.market?.details ? `The book's line is ${last.market.details}${last.market.book ? ` (${last.market.book})` : ''}. The forecast leans on the market, so a line move pulls it the same way.` : 'No book price was saved with this forecast, so it rests on our model alone.',
      R && R.model != null ? `Our model on its own says ${pct(R.model)}%; the market says ${p.market != null ? pct(p.market) + '%' : 'nothing yet'}. The number shown sits between them.` : '',
      last.weather ? `Weather at the last check: ${last.weather}.` : '',
      last.ai ? 'A news check was included.' : 'No news check was run for this match: late injuries and team news are not in it unless the book has priced them.'].filter(Boolean);
    return `<div class="ev-tiles">${tile(`${esc(pickName)}${k === 'draw' ? '' : ' to win'}`, `${pct(p.ours)}%`, R ? `Range ${pct(R.lo)}–${pct(R.hi)}%` : '')}${tile('Market', p.market == null ? '–' : `${pct(p.market)}%`, p.market == null ? 'No price saved' : 'Margin taken out')}${proj}</div>
      ${sec('Every outcome', bars)}
      ${sec('What moved this forecast', trail, snaps.length > 1 ? `${snaps.length} forecasts saved. Since the first, our number for ${esc(pickName)} has ${delta === 0 ? 'not moved' : `moved ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'point' : 'points'}`}.` : 'Only one forecast has been saved so far, so there is no movement to show yet.')}
      ${moved_(p)}
      ${sec('Why the model leans this way', reasons.length ? `<ul class="ev-list">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '')}
      ${sec('What would change this pick', `<ul class="ev-list">${what.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`)}
      <p class="lb ev-how">How it is made: Floodlight's forecast model blended with the book's price. Last made ${esc(whenTxt(last.at))} (${esc(stageName(last.stage).toLowerCase())})${(last.books || []).length ? `, prices from ${esc(last.books.join(', '))}` : ''}. The range is the span between our model alone and the market. This is research, not a guarantee.</p>`;
  }
  /* how the book's price has moved since the server started reading it (linemove.js, the same readings as the match centre) */
  function moved_(p) {
    const LM = window.flLineMove, m = p.m; if (!LM || !m?.ko || !m.lg) return '';
    const e = LM.load({ sport: m.sport, lg: m.lg, home: m.home, away: m.away, date: new Date(m.ko * 1000).toISOString() });
    return `<section class="ev-sec">${LM.html(e, { title: 'How the price has moved', names: { home: m.home, away: m.away, draw: 'Draw' }, side: m.pick })}</section>`;
  }
  window.flEvidence = { prop, match, propRange, matchRange };
})();
