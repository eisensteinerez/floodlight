/* Floodlight · the evidence behind a pick, shown when a pick on the Predictions page is opened.
   Nothing here changes a number. It lays out what the number was made from:
   - a player prop: the game log against the line, how often each side hit, the spread of results, home and away and
     opponent splits, our projection beside the line, and every posted price. All of it is the same list of games the
     Lab's reading (meter.js) used, so the panel and the number cannot disagree.
   - a match forecast: every forecast the server has saved for the match, oldest to newest, so what moved is read off the
     record (the book's line, the quarterbacks, the weather, the news check), plus the reasons saved with the latest one.
   The range beside a number is not a second model. For a prop it is one standard error either side, from the number of
   games behind the reading. For a match it is the span between our model alone and the market, which the forecast blends.
   "What would change this" lists the inputs the number rests on, and says plainly what it does not know about.
   Above the numbers, warning tags say what makes this one shakier than usual (small sample, a role change, minutes in
   doubt, a back-to-back, the line moving, the player on the injury report, a team mismatch). Three numbers are told
   apart in words: the hit rate (what happened), the projection (what we expect tonight) and the model probability (the
   chance this exact line hits). For a prop, the line's history comes from the prop record (propbook.py: the first
   reading is kept and later ones beside it), and "What changed since we first published" reads off those readings.
   The injury section reads the league report through injuries.js. */
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

  /* ---------- the prop's own history, from the prop record (fetched once per prop, then the page redraws) ---------- */
  const MOVES = new Map();   // sport|player|k -> { at, props } | { loading } | { error }
  const movesKey = p => `${p.sport}|${p.name}|${p.k}`;
  function moves(p) {
    const k = movesKey(p), have = MOVES.get(k);
    if (have && (have.loading || Date.now() - (have.at || 0) < 5 * 60000)) return have;
    MOVES.set(k, { ...(have || {}), loading: true });
    const q = new URLSearchParams({ sport: p.sport, player: p.name, k: p.k, start: p.start ? Math.round(+p.start / 1000) : '' });
    fetch('/api/props/moves?' + q, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => MOVES.set(k, { at: Date.now(), props: d.props || [] }), e => MOVES.set(k, { at: Date.now(), error: e.message || 'did not load' }))
      .finally(() => document.dispatchEvent(new CustomEvent('fl:evidence', { detail: { key: k } })));
    return MOVES.get(k);
  }
  const clock = t => new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  function lineHistory(p) {
    const m = moves(p), rec = (m.props || []).find(x => x.side === p.side || x.line === p.line) || (m.props || [])[0];
    const over = p.side === 'over', offers = (p.offers || []).filter(o => typeof o.line === 'number');
    const best = offers.length ? offers.reduce((a, o) => (over ? o.line < a.line : o.line > a.line) ? o : a) : null;
    if (m.loading && !rec) return sec('Line history', '<p class="lb">Loading the saved readings for this line…</p>');
    const reads = rec?.readings || [], first = reads[0], tiles = `<div class="ev-tiles">${tile('Opening line', first ? fmt(first.line) : '–', first ? `First read ${esc(clock(first.at))}` : 'Not saved yet')}${tile('Current line', fmt(p.line), p.at ? `Read ${ago(p.at)}` : '')}${best ? tile('Best available', fmt(best.line), `${esc(BOOK[best.book] || best.book || '')}${best.line !== p.line ? ` · better for the ${over ? 'over' : 'under'}` : ''}`) : ''}</div>`;
    const table = reads.length > 1 ? `<div class="tbx-wrap"><table class="tbx ev-tbl"><thead><tr><th scope="col">Read</th><th scope="col" class="r">Line</th><th scope="col" class="r">Ours</th><th scope="col" class="r">Market</th></tr></thead>
      <tbody>${reads.slice(-8).map(r => `<tr><th scope="row" class="num">${esc(clock(r.at))}</th><td class="r num">${fmt(r.line)}</td><td class="r num">${r.ours == null ? '–' : pct(r.ours) + '%'}</td><td class="r num">${r.market == null ? '–' : pct(r.market) + '%'}</td></tr>`).join('')}</tbody></table></div>` : '';
    // what changed since we first published, in words
    const why = [];
    if (first) {
      if (first.line !== p.line) why.push(`The line moved from ${fmt(first.line)} to ${fmt(p.line)}, which makes the ${over ? 'over' : 'under'} ${(p.line > first.line) === over ? 'harder' : 'easier'} to hit.`);
      if (first.ours != null && Math.abs(first.ours - p.ours) >= .01) why.push(`Our chance went from ${pct(first.ours)}% to ${pct(p.ours)}%${first.line !== p.line ? ', mostly because of the line move' : ', from a newer reading of his game log'}.`);
      if (first.market != null && p.market != null && Math.abs(first.market - p.market) >= .01) why.push(`The market’s chance went from ${pct(first.market)}% to ${pct(p.market)}%, so the books moved ${p.market > first.market ? 'toward' : 'away from'} this side.`);
      if (!why.length) why.push(`Nothing has moved since we first published it ${esc(clock(first.at))}.`);
    }
    const note = m.error ? `The saved readings did not load (${m.error}).` : first ? 'Every reading is saved beside the first one, which is never replaced. The pick is graded on the line first published.' : 'This line is saved the first time the Predictions page shows it, so its history starts now.';
    return sec('Line history', tiles + table, note) + (first ? sec('What changed since we first published', `<ul class="ev-list">${why.map(w => `<li>${w}</li>`).join('')}</ul>`) : '');
  }

  /* ---------- warning tags: what makes this reading shakier than usual ---------- */
  const DAILY = new Set(['nba', 'wnba', 'nhl', 'mlb']);
  /* the same tags as a list, for the pick card (predictions.js): [title, why], strongest first */
  const sameTeam = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();
  function flags(p) {
    if (p.type === 'match') {
      const out = [], gap = p.market == null ? null : Math.abs(p.ours - p.market);
      if (gap != null && gap >= .15) out.push(['Model and market differ', `We say ${pct(p.ours)}%, the price says ${pct(p.market)}%`]);
      if (p.market == null) out.push(['No market price', 'No book posts a price for this result yet']);
      return out;
    }
    const gs = (p.games || []).filter(g => g.v != null), oppGs = p.opp ? gs.filter(g => [g.opp, g.oppAbbr].some(o => sameTeam(o, p.opp))) : [];
    const out = list(p, gs, oppGs);
    if (!p.opp && !p.v?.event?.opp) out.push(['Opponent unknown', 'Neither the provider nor the schedule named the opponent']);
    const pv = p.prev;
    if (pv && (pv.teamName || pv.teamAbbr)) out.unshift(['Recently transferred', `Joined ${p.teamName || p.team || 'a new team'} from ${pv.teamName || pv.teamAbbr}${pv.until ? ` on ${new Date(pv.until * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}. Earlier games in the log were with ${pv.teamName || pv.teamAbbr}`]);
    const lines = [...new Set((p.offers || []).map(o => o.line).filter(v => typeof v === 'number'))], priced = (p.offers || []).filter(o => o.pOver != null && o.line === p.line).map(o => o.pOver);
    if (lines.length > 1 && Math.max(...lines) - Math.min(...lines) >= 1) out.push(['Providers differ', `Lines from ${fmt(Math.min(...lines))} to ${fmt(Math.max(...lines))} across the apps`]);
    else if (priced.length > 1 && Math.max(...priced) - Math.min(...priced) >= .08) out.push(['Providers differ', `The apps’ prices for this line are ${pct(Math.max(...priced) - Math.min(...priced))} points apart`]);
    return out;
  }
  function list(p, gs, oppGs) {
    const out = [], mins = n => gs.slice(0, n).map(g => g.min).filter(m => m != null), m5 = avg(mins(5)), m20 = avg(mins(20));
    // one sample size for the card and this panel (market.js): the number of games on record
    const n = gs.length;
    if (n < 15) out.push([`Small sample · ${n} ${n === 1 ? 'game' : 'games'}`, n ? `${n} ${n === 1 ? 'game is' : 'games are'} on record. A reading gets full weight from 15.` : 'No games on record for this stat.']);
    if (m5 && m20 && mins(20).length >= 10 && Math.abs(m5 - m20) / m20 >= .15) out.push(['Role changed recently', `${fmt(Math.round(m5))} minutes over the last 5 against ${fmt(Math.round(m20))} over the last ${Math.min(20, mins(20).length)}`]);
    const ms = mins(5); if (ms.length >= 4 && m5) { const sd = Math.sqrt(avg(ms.map(m => (m - m5) ** 2))); if (sd / m5 > .25) out.push(['Minutes vary', `Between ${fmt(Math.round(Math.min(...ms)))} and ${fmt(Math.round(Math.max(...ms)))} minutes in the last ${ms.length}`]) }
    const ds = gs.slice(0, 4).map(g => g.date).filter(Boolean), gap = DAILY.has(p.sport) ? 14 : 21, since = ds[0] ? Math.floor((Date.now() - ds[0]) / 864e5) : null;
    if (since != null && since >= gap) out.push([`Long break · ${since} days`, `${since} days since his last game on record`]);
    else for (let i = 0; i + 1 < ds.length; i++) if ((ds[i] - ds[i + 1]) / 864e5 >= gap) { out.push([`Long break · ${Math.round((ds[i] - ds[i + 1]) / 864e5)} days`, `A ${Math.round((ds[i] - ds[i + 1]) / 864e5)}-day gap between games ${i ? 'recently' : 'before his last game'}`]); break }
    if (p.start && ds[0] && DAILY.has(p.sport) && p.sport !== 'mlb' && (+p.start - ds[0]) / 36e5 < 36) out.push(['Back-to-back', 'He played yesterday']);
    if (p.opp && oppGs.length < 2) out.push([`Few games against ${p.opp}`, oppGs.length ? `One game against ${p.opp} in the log` : `No games against ${p.opp} in the log`]);
    const rec = (MOVES.get(movesKey(p))?.props || [])[0], f = rec?.readings?.[0];
    if (f && Math.abs(f.line - p.line) >= 1) out.push([`Line moved ${fmt(Math.abs(p.line - f.line))}`, `From ${fmt(f.line)} to ${fmt(p.line)} since we first published it`]);
    // the injury report and the lineup are separate: Active or not listed is no warning; only a real doubt is
    const I = window.flInjuries, st = I?.status(p.sport, p.name), av = window.flMarket?.availability(st, !!I?.ready?.(p.sport));
    if (av?.tag) out.push([av.tag, `${av.report}. Starting status: ${av.start === 'Lineup not announced' ? 'not confirmed yet' : av.start.toLowerCase()}.`]);
    if (p.teamNote) out.push(['Possible data mismatch', p.teamNote]);
    return out;
  }
  function warnings(p, gs, oppGs) {
    const out = list(p, gs, oppGs);
    return out.length ? `<ul class="ev-warns" aria-label="Warnings">${out.map(([t, w]) => `<li><b>${esc(t)}</b><small>${esc(w)}</small></li>`).join('')}</ul>` : '';
  }

  /* ---------- the injury report for this player and his team ---------- */
  function injuries(p) {
    const I = window.flInjuries; if (!I || !I.PATH[p.sport]) return '';
    const v = I.ready(p.sport); if (!v) { I.load(p.sport); return sec('Injuries and lineup', '<p class="lb">Loading the injury report…</p>') }
    const me = I.status(p.sport, p.name), tm = p.team ? I.team(p.sport, p.team) : null, mates = (tm?.players || []).filter(x => I.norm(x.name) !== I.norm(p.name) && ['out', 'doubtful'].includes(x.lv));
    const opp = p.opp ? I.team(p.sport, p.opp) : null, oppOut = (opp?.players || []).filter(x => x.lv === 'out');
    const av = window.flMarket?.availability(me, true);
    const li = [av ? `<b>Availability: ${esc(av.avail)}</b>. Injury report: ${esc(av.report)}${me?.note ? ` (${esc(me.note)})` : ''}. Starting status: ${av.start === 'Lineup not announced' ? 'not confirmed; Floodlight doesn’t read announced lineups yet' : esc(av.start.toLowerCase())}.` : '',
      mates.length ? `Teammates out or doubtful: ${mates.slice(0, 6).map(x => `${esc(x.name)}${x.pos ? ` (${esc(x.pos)})` : ''}, ${esc(x.status || I.LEVEL_NAME[x.lv])}`).join('; ')}. A missing teammate can raise his minutes and usage; the game log doesn’t know that yet.` : tm ? 'No teammates are listed out or doubtful.' : '',
      oppOut.length ? `${esc(opp.name)} are without ${oppOut.slice(0, 5).map(x => esc(x.name)).join(', ')}.` : ''].filter(Boolean);
    return sec('Injuries and lineup', `<ul class="ev-list">${li.map(x => `<li>${x}</li>`).join('')}</ul><p class="lb">From the league injury report, read ${ago(v.at)}. <a class="lk" href="#/injuries/${esc(p.sport)}" data-page="injuries" data-arg="${esc(p.sport)}">See the full report</a></p>`);
  }

  /* ---------- three numbers told apart ---------- */
  function three(p, R, h10) {
    const over = p.side === 'over', word = p.yes ? (over ? 'Yes' : 'No') : `${over ? 'over' : 'under'} ${fmt(p.line)}`;
    const rows = [
      ['Hit rate', h10 ? `${h10.h} of ${h10.n}` : '–', `What happened: how often the ${esc(word)} came in over his ${h10 ? esc(h10.label.toLowerCase()) : 'recent games'}.`],
      !p.yes && p.mu != null ? ['Projection', fmt(Math.round(p.mu * 10) / 10), `What we expect tonight: our estimate of his ${esc(String(p.label || '').toLowerCase())}, with recent games counting more.`] : null,
      ['Model probability', `${pct(p.ours)}%`, `The chance this exact line hits: our projection and his spread of results set against ${fmt(p.line)}.`],
      ['Confidence range', `${pct(R.lo)}–${pct(R.hi)}%`, `How sure we are of that chance: one standard error either side, from ${R.n || 'the'} games. Fewer or more uneven games make it wider.`]].filter(Boolean);
    return `<dl class="ev-three">${rows.map(([k, v, d]) => `<div><dt>${k} <b class="num">${v}</b></dt><dd>${d}</dd></div>`).join('')}</dl>
      ${h10 && h10.n >= 8 && h10.h / h10.n >= .8 ? `<p class="lb">${h10.h} of ${h10.n} does not mean a ${pct(h10.h / h10.n)}% chance tonight. A short run overstates what comes next, so the model probability pulls it back toward his projection and spread.</p>` : ''}`;
  }

  /* ---------- what was read, when, and what is not read at all ---------- */
  function coverage(p, gs) {
    const I = window.flInjuries, v = I?.ready(p.sport), last = gs.find(g => g.date)?.date, outdoor = p.sport === 'nfl' || p.sport === 'mlb';
    const li = [`Lines read ${p.at ? ago(p.at) : 'earlier'} from ${esc((p.books || []).map(b => BOOK[b] || b).join(', ') || 'the apps')}.`,
      last ? `Game log through ${esc(new Date(last).toLocaleDateString([], { day: 'numeric', month: 'short' }))} (${gs.length} games).` : `Game log: ${gs.length} games.`,
      v ? `Injury report read ${ago(v.at)}.` : I?.PATH[p.sport] ? 'Injury report not loaded.' : 'No injury report is read for this sport.',
      'Opponent strength: not rated yet. The “Against” row above is the only opponent signal.',
      outdoor ? 'Weather: not read into player props yet.' : 'Weather: indoor sport, not a factor.',
      'Confirmed starting lineups: not read yet.'];
    return sec('Data freshness and what isn’t read', `<ul class="ev-list">${li.map(x => `<li>${x}</li>`).join('')}</ul>`);
  }

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
        <p class="lb">Drag the dashed line on the chart, or use the slider, to see how ${log.length < gs.length ? `the last ${log.length}` : `all ${log.length}`} games fall against any line. This only recounts the games shown; our number above stays tied to the posted line.</p>` : ''}`;
    // counts for the side picked
    const count = (xs, label) => { const d = xs.filter(g => !push(g)), h = d.filter(hit).length, ps = xs.length - d.length; return d.length ? { label, h, n: d.length, ps, rate: h / d.length } : null };
    // windows only where that many games exist, then every game: a 7-game log reads "Last 5" and "All 7", never "Last 10"
    const rows = [...[5, 10, 20].filter(w => w < gs.length).map(w => count(gs.slice(0, w), `Last ${w}`)), count(gs, gs.length === 1 ? 'The only game' : `All ${gs.length}`),
      gs.some(g => g.home === true) ? count(gs.filter(g => g.home === true), 'Home') : null, gs.some(g => g.home === false) ? count(gs.filter(g => g.home === false), 'Away') : null].filter(Boolean);
    const oppGs = p.opp ? gs.filter(g => [g.opp, g.oppAbbr].some(o => o && (String(o).toLowerCase() === String(p.opp).toLowerCase()))) : [];
    if (oppGs.length) rows.push(count(oppGs, `Against ${p.opp}`));
    const table = `<div class="tbx-wrap"><table class="tbx ev-tbl"><thead><tr><th scope="col">Games</th><th scope="col" class="r">${word}</th><th scope="col" class="r">Rate</th><th scope="col" class="r">Average</th>${rows.some(r => r && r.ps) ? '<th scope="col" class="r">Pushes</th>' : ''}</tr></thead>
      <tbody>${rows.filter(Boolean).map(r => { const src = r.label === 'Home' ? gs.filter(g => g.home === true) : r.label === 'Away' ? gs.filter(g => g.home === false) : r.label.startsWith('Against') ? oppGs : r.label.startsWith('All') || r.label === 'The only game' ? gs : gs.slice(0, +r.label.split(' ')[1]);
        return `<tr><th scope="row">${esc(r.label)}</th><td class="r num">${r.h} of ${r.n}</td><td class="r num">${pct(r.rate)}%</td><td class="r num">${p.yes ? '–' : fmt(Math.round(avg(src.map(g => g.v)) * 10) / 10)}</td>${rows.some(x => x && x.ps) ? `<td class="r num">${r.ps || '–'}</td>` : ''}</tr>` }).join('')}</tbody></table></div>`;
    // the spread of results
    let dist = '';
    if (!p.yes) { const vs = gs.slice(0, 40).map(g => g.v), lo = Math.floor(Math.min(...vs, p.line)), hi = Math.ceil(Math.max(...vs, p.line)), span = Math.max(1, hi - lo), step = span <= 12 ? 1 : Math.ceil(span / 10), bins = [];
      const edge = Math.floor(p.line) + 1, from = edge - Math.ceil((edge - lo) / step) * step;   // a bin edge sits on the line, so no bin straddles it
      for (let a = from; a <= hi; a += step) bins.push({ a, b: a + step, n: vs.filter(v => v >= a && v < a + step).length });
      const mx = Math.max(1, ...bins.map(b => b.n));
      dist = `<div class="ev-dist" role="img" aria-label="How ${vs.length < gs.length ? `the last ${vs.length}` : `all ${vs.length}`} results spread: ${esc(bins.filter(b => b.n).map(b => `${b.n} at ${step === 1 ? b.a : `${b.a} to ${b.b - 1}`}`).join(', '))}.">${bins.map(b => { const side = b.b <= p.line ? 'lo' : b.a > p.line ? 'hi' : 'mid', good = side === 'mid' ? 'push' : (side === 'hi') === over ? 'hit' : 'miss';
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
    ].filter(Boolean);
    // the headline hit rate is the card's own sample (market.js): the last 10, or every game when there are fewer
    const S = window.flMarket ? window.flMarket.sample(gs, p.line, p.side, p.yes) : null;
    const h10 = S && S.n ? { h: S.hits, n: S.n - S.pushes, label: S.full ? 'Last 10' : S.n === 1 ? 'Only available game' : `${S.n} available games` } : rows[0];
    const lastDate = gs.find(g => g.date)?.date, rest = p.start && lastDate ? Math.max(0, Math.floor((+p.start - lastDate) / 864e5)) : null;
    const expMin = m5 && mins.length >= 5 ? tile('Expected minutes', fmt(Math.round(m5)), `Last-5 average${mAll ? ` · ${fmt(Math.round(mAll))} over the log` : ''}`) : '';
    const restT = rest != null ? tile('Rest', rest === 0 ? 'Same day' : `${rest} ${rest === 1 ? 'day' : 'days'}`, `Since his last game${rest <= 1 && DAILY.has(p.sport) && p.sport !== 'mlb' ? ' · back-to-back' : ''}`) : '';
    return `${warn}<div class="ev-tiles">${tile('Floodlight’s chance', `${pct(p.ours)}%`, `Our projection · likely ${pct(R.lo)}–${pct(R.hi)}%`)}${tile('Market’s chance', p.market == null ? '–' : `${pct(p.market)}%`, p.market == null ? 'No two-sided price' : 'From the price, margin taken out')}${h10 ? tile('Hit rate', `${h10.h} of ${h10.n}`, `${esc(h10.label.toLowerCase())}, what happened`) : ''}
        ${p.yes ? '' : tile('We project', fmt(Math.round(p.mu * 10) / 10), `Line ${fmt(p.line)}${p.sd ? ` · usually ${fmt(Math.max(0, Math.round((p.mu - p.sd) * 10) / 10))} to ${fmt(Math.round((p.mu + p.sd) * 10) / 10)}` : ''}`)}</div>
      ${sec('What these numbers mean', three(p, R, h10))}
      ${expMin || restT ? `<div class="ev-tiles">${expMin}${restT}</div>` : ''}
      ${sec('Game log against the line', bars)}
      ${sec(`How often ${word.toLowerCase()} hit`, table, gs.length > 5 ? `Recent windows up to all ${gs.length} games on record, home and away, and head to head against this opponent.` : `All ${gs.length} games on record, home and away, and head to head against this opponent.`)}
      ${sec('Spread of results', dist, dist ? `${gs.length > 40 ? 'The last 40' : `All ${gs.length}`} games, grouped by result. The line is ${fmt(p.line)}.` : '')}
      ${sec('Posted prices', market, market ? `Read ${p.at ? ago(p.at) : 'earlier'}. A chance is shown only where the app posts both sides, with its margin taken out.` : '')}
      ${lineHistory(p)}
      ${injuries(p)}
      ${sec('What would change this pick', `<ul class="ev-list">${what.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`)}
      ${wrong(p, R, gs)}
      ${coverage(p, gs)}
      <p class="lb ev-how">How it is made: the Lab's heat reading. Recent games count more than old ones, and the hit rate is blended with a projection for this line. The range is one standard error either side, so it is wider when fewer games are behind it. This is research from past games, not a guarantee.</p>`;
  }

  /* Why Floodlight may be wrong: the plain limits of this number, and why a big edge can sit beside middling confidence.
     Edge is the gap between our chance and the market's. Confidence is how much stands behind our chance. They are
     different measures, so a large gap read from few or uneven games is a large edge with modest confidence. */
  function wrong(p, R, gs) {
    const out = [];
    if (p.market != null && R) {
      const lo = pct(R.lo) - pct(p.market), hi = pct(R.hi) - pct(p.market), sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
      out.push(`Edge and confidence measure different things. The edge (${sg(p.edge)}) is the gap between our chance and the market’s. Confidence${p.conf ? ` (${p.conf})` : ''} is how much stands behind our chance. Across our likely range the edge runs from ${sg(lo)} to ${sg(hi)}${lo <= 0 && hi > 0 ? ', so it could be nothing at all' : ''}.`);
    }
    if (gs && gs.length < 15) out.push(`${gs.length} ${gs.length === 1 ? 'game is' : 'games are'} on record. A few unusual nights move a short log a long way.`);
    if (p.edge != null && Math.abs(p.edge) >= 10) out.push('Big gaps with the market are rare for good reason. The books hear about injuries, rest and role changes before a game log shows them, so a large edge sometimes means the market knows something we don’t.');
    if (gs) { const m5 = avg(gs.slice(0, 5).map(g => g.min).filter(m => m != null)), m20 = avg(gs.slice(0, 20).map(g => g.min).filter(m => m != null)); if (m5 && m20 && m5 < m20 * .85) out.push(`Minutes are falling: ${fmt(Math.round(m5))} over the last 5 against ${fmt(Math.round(m20))} over the last 20. If the role has shrunk, older games overstate it.`) }
    if (p.teamNote) out.push(p.teamNote);
    if (!gs) out.push('The forecast leans on the book’s line. If the line is stale or the news check was skipped, late team news is missing.');
    out.push(gs ? 'Injury and lineup news is shown above but not read into the number itself, and confirmed lineups are not read at all. Check the latest team news before the start.' : 'Injury and lineup news is not read into this number unless the news check ran. Check the latest team news before the start.');
    return sec('Why Floodlight may be wrong', `<ul class="ev-list">${out.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`);
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
    return `<div class="ev-tiles">${tile(`Floodlight: ${esc(pickName)}${k === 'draw' ? '' : ' to win'}`, `${pct(p.ours)}%`, R ? `Our forecast · range ${pct(R.lo)}–${pct(R.hi)}%` : 'Our forecast')}${tile('Market’s chance', p.market == null ? '–' : `${pct(p.market)}%`, p.market == null ? 'No price saved' : 'From the price, margin taken out')}${proj}</div>
      ${sec('Every outcome', bars)}
      ${sec('What moved this forecast', trail, snaps.length > 1 ? `${snaps.length} forecasts saved. Since the first, our number for ${esc(pickName)} has ${delta === 0 ? 'not moved' : `moved ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'point' : 'points'}`}.` : 'Only one forecast has been saved so far, so there is no movement to show yet.')}
      ${moved_(p)}
      ${sec('Why the model leans this way', reasons.length ? `<ul class="ev-list">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '')}
      ${sec('What would change this pick', `<ul class="ev-list">${what.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`)}
      ${wrong(p, R, null)}
      <p class="lb ev-how">How it is made: Floodlight's forecast model blended with the book's price. Last made ${esc(whenTxt(last.at))} (${esc(stageName(last.stage).toLowerCase())})${(last.books || []).length ? `, prices from ${esc(last.books.join(', '))}` : ''}. The range is the span between our model alone and the market. This is research, not a guarantee.</p>`;
  }
  /* how the book's price has moved since the server started reading it (linemove.js, the same readings as the match centre) */
  function moved_(p) {
    const LM = window.flLineMove, m = p.m; if (!LM || !m?.ko || !m.lg) return '';
    const e = LM.load({ sport: m.sport, lg: m.lg, home: m.home, away: m.away, date: new Date(m.ko * 1000).toISOString() });
    return `<section class="ev-sec">${LM.html(e, { title: 'How the price has moved', names: { home: m.home, away: m.away, draw: 'Draw' }, side: m.pick })}</section>`;
  }
  window.flEvidence = { prop, match, propRange, matchRange, setLine, flags };
})();
