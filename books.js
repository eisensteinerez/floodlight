/* Floodlight · odds from several books
   Game lines and player props from Kalshi, FanDuel, DraftKings (via ESPN) and Polymarket, fetched by the local server.
   Pick one book to see just its prices, or compare them all with the best price for each bet highlighted. */
S.books = new Map(); S.bookSel = store.get('fl.book', 'all'); S.bookCat = 'game';
const BOOK_NAME = { kalshi: 'Kalshi', fanduel: 'FanDuel', draftkings: 'DraftKings', polymarket: 'Polymarket' };
const PROP_GROUPS = [
  ['pass', 'Passing', ['pass_yds', 'pass_td', 'pass_att', 'pass_cmp', 'int']], ['rush', 'Rushing', ['rush_yds', 'rush_att', 'longest_rush', 'rush_rec_yds']],
  ['rec', 'Receiving', ['rec_yds', 'receptions', 'longest_rec']], ['td', 'Touchdowns', ['anytime_td']],
  ['goal', 'Goals', ['anytime_goal']], ['shots', 'Shots', ['shots', 'sot']], ['other', 'More props', null],
];
const bkKey = e => `${isFbEv(e) ? 'football' : 'soccer'}:${e.id}`;
function bkQuery(e){
  const fb = isFbEv(e);
  const p = new URLSearchParams({ sport: fb ? 'football' : 'soccer', lg: fb ? e.lg : e.slug, id: /^\d+$/.test(e.id) ? e.id : '',
    home: e.home.full || e.home.name, away: e.away.full || e.away.name, date: e.date.toISOString(),
    kx: fb ? (FBL[e.lg]?.kx || '') : (KX[e.slug] || ''), espn: fb ? (FBL[e.lg]?.path ? 'football/' + FBL[e.lg].path : '') : (e.src === 'fm' ? '' : 'soccer/' + e.slug) });
  return p;
}
const bkInflight = new Map();
// returns the request in flight (so callers re-render once it lands), or null when there's nothing to fetch
function bkLoad(e, force){
  const k = bkKey(e); if (S.serverOK === false || e.src === 'tsdb') return null;
  if (bkInflight.has(k)) return bkInflight.get(k);
  const have = S.books.get(k); if (have && !force && Date.now() - have.at < 20000) return null;
  const req = getJSON(`/api/odds/board?${bkQuery(e)}`).then(d => { d.at = Date.now(); S.books.set(k, d) })
    .catch(() => { if (!S.books.has(k)) S.books.set(k, { error: true, at: Date.now() }) }).finally(() => bkInflight.delete(k));
  bkInflight.set(k, req);
  return req;
}
const amTxt = x => x ? (x.am > 0 ? '+' + x.am : '−' + Math.abs(x.am)) : '–';
const bkOpenEvent = () => { const e = fcOpenEvent(); if (!e) return null; const v = S.stack[S.stack.length - 1]; return (v?.type === 'fbgame' ? v.tab === 'odds' : S.tab === 'odds') ? e : null };
function bkRerender(){ if (bkOpenEvent()) renderSheet() }
setInterval(() => { const e = bkOpenEvent(); if (e && !document.hidden) bkLoad(e, true)?.then(bkRerender) }, 30000);

function propGroup(cat){ for (const [k, , cats] of PROP_GROUPS) if (cats && cats.includes(cat)) return k; return 'other' }
function booksBlock(e){
  if (S.serverOK === false || e.src === 'tsdb') return '';
  const d = S.books.get(bkKey(e));
  if (!d) { bkLoad(e)?.then(bkRerender); return `<div class="sub-h" style="margin-top:0"><h5>Compare sportsbooks</h5><small>Loading Kalshi, FanDuel, DraftKings and Polymarket…</small></div><div class="skel" style="height:160px"></div>` }
  if (d.error) return `<div class="note">Couldn't load sportsbook odds right now.</div>`;
  if (!d.books.length) return `<div class="sub-h" style="margin-top:0"><h5>Compare sportsbooks</h5></div><div class="note">${e.state === 'post' ? 'Betting has closed for this game.' : 'None of the books has posted odds for this game yet.'}</div>`;
  const books = d.books.map(b => b.book), sel = books.includes(S.bookSel) ? S.bookSel : 'all', cols = sel === 'all' ? books : [sel];
  const groups = PROP_GROUPS.filter(([k]) => d.props.some(p => propGroup(p.cat) === k && (sel === 'all' || p.offers.some(o => o.book === sel))));
  if (S.bookCat === '_first') S.bookCat = groups[0]?.[0] || 'game';
  const cat = S.bookCat === 'game' || groups.some(g => g[0] === S.bookCat) ? S.bookCat : 'game';
  let h = `<div class="sub-h" style="margin-top:0"><h5>Compare sportsbooks</h5><small>Updated ${new Date(d.fetched * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · every 30 s</small></div>
    <div class="quick bk-books" role="group" aria-label="Sportsbook">${['all', ...books].map(b => `<button class="qf" data-bk="book" data-to="${b}" aria-pressed="${sel === b}">${b === 'all' ? 'All books' : esc(BOOK_NAME[b])}</button>`).join('')}</div>
    <div class="quick bk-cats" role="group" aria-label="Market">${[['game', 'Game lines'], ...groups.map(([k, l]) => [k, l])].map(([k, l]) => `<button class="qf" data-bk="cat" data-to="${k}" aria-pressed="${cat === k}">${esc(l)}</button>`).join('')}</div>`;
  if (d.value?.length && sel === 'all') h += `<div class="bk-value"><strong>Best prices vs the other books</strong>${d.value.slice(0, 4).map(v => `<span>${esc(bkValueLabel(e, v))} <b class="num">${amTxt(v.price)}</b> at ${esc(BOOK_NAME[v.book])} <em>+${(v.ev * 100).toFixed(1)}% vs consensus</em></span>`).join('')}</div>`;
  h += cat === 'game' ? bkGame(e, d, cols) : bkProps(e, d, cols, cat);
  h += `<p class="srcnote">Prices: ${d.books.map(b => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>${b.via ? ` (via ${esc(b.via)})` : ''}`).join(', ')}. The best price for each bet is highlighted. Kalshi and Polymarket are exchanges, so their prices are converted to American odds and ignore fees. FanDuel's prices are for Ohio and can differ a little by state. ${d.missing.map(m => esc(m.why)).join(' ')}</p>`;
  return h + RG;
}
function bkValueLabel(e, v){
  if (v.type === 'ml') return v.label === 'draw' ? 'Draw' : `${e[v.label].name} to win`;
  return v.label;
}
const cell = (x, best) => x ? `<span class="bk-p${best ? ' best' : ''}">${amTxt(x)}</span>` : '<span class="bk-p none">–</span>';
function bkTable(head, rows){
  return `<div class="tbl-wrap"><table class="bk-t"><thead><tr><th></th>${head.map(b => `<th>${esc(BOOK_NAME[b] || b)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function bkGame(e, d, cols){
  const fb = isFbEv(e), rows = [];
  const bestOf = (offers, k) => { const c = offers.filter(o => o[k] && cols.includes(o.book)); if (c.length < 2) return null; return c.reduce((a, b) => (b[k].am > 0 ? b[k].am : 1e4 / -b[k].am) > (a[k].am > 0 ? a[k].am : 1e4 / -a[k].am) ? b : a).book };
  const line = (label, offers, k) => { const b = bestOf(offers, k); return `<tr><td class="t">${label}</td>${cols.map(c => { const o = offers.find(x => x.book === c); return `<td>${cell(o?.[k], b === c)}</td>` }).join('')}</tr>` };
  const ml = d.ml.offers;
  if (ml.length) {
    rows.push(`<tr class="sec"><td colspan="${cols.length + 1}">Moneyline</td></tr>`);
    for (const k of fb ? ['away', 'home'] : ['home', 'draw', 'away']) rows.push(line(k === 'draw' ? 'Draw' : esc(e[k].name), ml, k));
  }
  // spreads: the lines more than one book offers, plus each book's line nearest to even money
  const sp = d.spreads.filter(s => s.offers.some(o => cols.includes(o.book)));
  const near = s => Math.min(...s.offers.map(o => Math.abs((o.home?.p ?? .5) - .5)));
  // lines to show: the sportsbooks' main lines first, then lines several books share, then the closest to even money
  const pickLines = (arr, nearFn) => { const sb = arr.filter(x => x.offers.some(o => !o.exchange && cols.includes(o.book)));
    const shared = arr.filter(x => x.offers.filter(o => cols.includes(o.book)).length > 1).sort((a, b) => nearFn(a) - nearFn(b));
    return [...new Set([...sb, ...shared, ...[...arr].sort((a, b) => nearFn(a) - nearFn(b))])].slice(0, sb.length ? Math.max(2, sb.length) : 2) };
  const spShow = pickLines(sp, near).sort((a, b) => a.homeLine - b.homeLine);
  if (spShow.length) {
    rows.push(`<tr class="sec"><td colspan="${cols.length + 1}">${fb ? 'Spread' : 'Handicap'}</td></tr>`);
    for (const s of spShow) { const hl = s.homeLine, f = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
      rows.push(line(`${esc(e.away.abbr || e.away.name)} ${f(-hl)}`, s.offers, 'away'), line(`${esc(e.home.abbr || e.home.name)} ${f(hl)}`, s.offers, 'home')) }
  }
  const to = d.totals.filter(t => t.offers.some(o => cols.includes(o.book)));
  const nearT = t => Math.min(...t.offers.map(o => Math.abs((o.over?.p ?? .5) - .5)));
  const toShow = pickLines(to, nearT).sort((a, b) => a.line - b.line);
  if (toShow.length) {
    rows.push(`<tr class="sec"><td colspan="${cols.length + 1}">Total ${fb ? 'points' : 'goals'}</td></tr>`);
    for (const t of toShow) rows.push(line(`Over ${t.line}`, t.offers, 'over'), line(`Under ${t.line}`, t.offers, 'under'));
  }
  if (d.corners?.length && cols.includes('polymarket')) {
    const c = d.corners.filter(x => x.over).sort((a, b) => Math.abs(a.over.p - .5) - Math.abs(b.over.p - .5)).slice(0, 2).sort((a, b) => a.line - b.line);
    rows.push(`<tr class="sec"><td colspan="${cols.length + 1}">Total corners</td></tr>`);
    for (const x of c) rows.push(`<tr><td class="t">Over ${x.line}</td>${cols.map(b => `<td>${b === 'polymarket' ? cell(x.over) : cell(null)}</td>`).join('')}</tr>`);
  }
  if (!rows.length) return `<div class="note">${cols.length === 1 ? esc(BOOK_NAME[cols[0]]) + ' has' : 'The books have'} no game lines for this match yet.</div>`;
  return bkTable(cols, rows);
}
function bkProps(e, d, cols, group){
  const list = d.props.filter(p => propGroup(p.cat) === group && p.offers.some(o => cols.includes(o.book)));
  if (!list.length) return `<div class="note">No props in this group yet.</div>`;
  cols = cols.filter(c => list.some(p => p.offers.some(o => o.book === c)));         // hide books with no props here
  const byCat = new Map(); list.forEach(p => { if (!byCat.has(p.label)) byCat.set(p.label, []); byCat.get(p.label).push(p) });
  return [...byCat].map(([label, ps]) => {
    const yes = ps[0].kind === 'yes';
    const rows = ps.slice(0, 40).map(p => {
      const val = (d.value || []).some(v => v.type === 'prop' && v.label.startsWith(p.player) && v.label.includes(p.label));
      const best = k => p.best?.[k]?.n >= 2 ? p.best[k].book : null;
      const cellFor = o => {
        if (!o) return `<td>${cell(null)}</td>`;
        if (yes) return `<td>${cell(o.yes, best('yes') === o.book)}</td>`;
        const off = o.line !== p.line ? `<small class="bk-alt">${o.line}</small>` : '';
        return `<td><span class="bk-ou">${off}<span>O ${cell(o.over, o.line === p.line && best('over') === o.book)}</span><span>U ${cell(o.under, o.line === p.line && best('under') === o.book)}</span></span></td>` };
      return `<tr><td class="t"><span>${esc(p.player)}${val ? ' <span class="bk-val" title="Best price beats the other books">value</span>' : ''}</span>${yes ? '' : `<small class="num">${p.line}</small>`}</td>${cols.map(c => cellFor(p.offers.find(o => o.book === c))).join('')}</tr>` });
    return `<div class="sub-h"><h5>${esc(label)}</h5><small>${yes ? 'Price to score at least once' : 'O = over, U = under the line'}</small></div>${bkTable(cols, rows)}`;
  }).join('') + `<p class="srcnote">Exchange prices are read off their ladders at the sportsbook's line when they cover it; a small grey number shows a different line.</p>`;
}
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-bk]'); if (!el) return;
  if (el.dataset.bk === 'book') { S.bookSel = el.dataset.to; store.set('fl.book', S.bookSel) }
  if (el.dataset.bk === 'cat') S.bookCat = el.dataset.to;
  renderSheet();
});

/* ---------- player props on the Prediction tab ---------- */
function propsBlock(e){
  if (S.serverOK === false || e.src === 'tsdb' || e.state === 'post') return '';
  const d = S.books.get(bkKey(e)); if (!d) { bkLoad(e)?.then(() => fcRerender(fcKeyOf(e))); return '' }
  const L = fcLatest(e), ai = L?.ai && !L.ai.error ? L.ai : null, picks = ai?.props?.filter(x => x?.player && x?.pick) || [];
  const value = (d.value || []).filter(v => v.type === 'prop');
  if (!picks.length && !value.length && !d.props?.length) return '';
  const lineFor = (player, market) => (d.props || []).find(p => teamSim(p.player, player) >= .85 && (!market || p.label.toLowerCase().includes(String(market).toLowerCase().split(' ')[0])));
  let h = `<div class="sub-h"><h5>Player props</h5><small>${d.props?.length ? `${d.props.length} props across ${esc(d.books.map(b => b.name).join(', '))}` : ''}</small></div>`;
  if (picks.length) h += `<ul class="pp">${picks.slice(0, 3).map(x => { const p = lineFor(x.player, x.market), side = /under/i.test(x.pick) ? 'under' : /score|anytime|yes/i.test(x.pick) ? 'yes' : 'over', b = p?.best?.[side];
    return `<li><span class="fc-ai">Claude</span><div><strong>${esc(x.player)} · ${esc(x.pick)}</strong> <small>${esc(x.market || '')}</small>${b ? ` <span class="bk-tag">best ${amTxt(b.price)} at ${esc(BOOK_NAME[b.book])}</span>` : ''}<p>${esc(x.why || '')}</p></div></li>` }).join('')}</ul>`;
  else if (L) h += `<p class="pf-hint">${ai ? 'Claude didn’t find a prop it likes at its last update.' : 'Turn on Claude research in the scheduled forecasts below to get prop picks with reasons.'}</p>`;
  if (value.length) h += `<div class="sub-h"><h5>Best prices vs the market</h5><small>Line shopping, not a prediction</small></div><ul class="pp">${value.map(v => `<li><span class="bk-val">+${(v.ev * 100).toFixed(1)}%</span><div><strong>${esc(v.label)}</strong> <span class="bk-tag">${amTxt(v.price)} at ${esc(BOOK_NAME[v.book])}</span><p>The books' consensus chance is about ${pct(v.fair)}%, so this price pays more than that chance suggests.</p></div></li>`).join('')}</ul>`;
  if (d.props?.length) h += `<button class="btn ghost sm" data-bk-open="1">See every prop and book on the Odds tab</button>`;
  return h;
}
document.addEventListener('click', ev => {
  if (!ev.target.closest('[data-bk-open]')) return;
  const v = S.stack[S.stack.length - 1]; S.bookCat = '_first';
  if (v?.type === 'fbgame') v.tab = 'odds'; else S.tab = 'odds';
  renderSheet();
});
