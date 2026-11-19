/* Floodlight · track record
   Every forecast the server makes is locked in at kick-off and graded at full time (record.py). This page shows that
   record: W-L, hit rate, streak, a 30-day chart, how each confidence level, sport and league has done, the full history
   with filters, your own picks next to Floodlight's, and a shareable record card. */
S.rec = { data: null, loading: false, err: null, sport: 'all', range: 30, filter: 'all', show: 15, at: 0 };
S.picksTab = location.hash === '#record' ? 'record' : 'today';
const REC_FB = { nfl: 'NFL', fbs: 'College football', fcs: 'College football (FCS)', d2: 'NCAA D-II', d3: 'NCAA D-III', ufl: 'UFL' };
const recLeague = e => e.sport === 'football' ? (REC_FB[e.lg] || 'Football') : (typeof LG !== 'undefined' && LG[e.lg]?.name) || e.lg || 'Soccer';
const recSide = (e, k) => k === 'draw' ? 'Draw' : e[k] || k;
const recDay = t => new Date(t * 1000);
const recKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function recLoad(force){
  const R = S.rec;
  if (R.loading || (!force && R.data && Date.now() - R.at < 120000)) return;
  R.loading = true; R.err = null;
  api('/api/record').then(d => { R.data = d; R.at = Date.now() }).catch(err => { R.err = err.message || 'The record didn’t load.' })
    .finally(() => { R.loading = false; if (S.page === 'picks' && S.picksTab === 'record') renderRecord($('picks')) });
}

function recRows(){
  const R = S.rec, now = Date.now() / 1000;
  return (R.data?.entries || []).filter(e => (R.sport === 'all' || e.sport === R.sport) && (!R.range || e.ko >= now - R.range * 86400));
}

function recStats(rows){
  const g = rows.filter(e => e.result === 'won' || e.result === 'lost');
  const won = g.filter(e => e.result === 'won').length;
  let streak = 0, kind = null;
  for (const e of g) { kind = kind || e.result; if (e.result !== kind) break; streak++ }
  let best = 0, run = 0;
  for (const e of [...g].reverse()) { run = e.result === 'won' ? run + 1 : 0; best = Math.max(best, run) }
  return { n: g.length, won, lost: g.length - won, rate: g.length ? won / g.length : null, kind, streak, best,
    exact: g.filter(e => e.exact).length, pending: rows.filter(e => !e.result).length, push: rows.filter(e => e.result === 'push').length };
}

function recRateTxt(r){ return r == null ? '–' : `${Math.round(r * 100)}%` }

/* wins above the line, losses below, one column per day */
function recChart(rows){
  const days = Math.min(S.rec.range || 30, 30), today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); buckets.push({ d, w: 0, l: 0 }) }
  const idx = new Map(buckets.map((b, i) => [recKey(b.d), i]));
  for (const e of rows) { const i = idx.get(recKey(recDay(e.ko))); if (i == null) continue; if (e.result === 'won') buckets[i].w++; else if (e.result === 'lost') buckets[i].l++ }
  const max = Math.max(1, ...buckets.map(b => Math.max(b.w, b.l)));
  const W = 600, H = 150, mid = H / 2, cw = W / buckets.length, bw = Math.max(3, Math.min(14, cw - 4)), u = (mid - 14) / max;
  const bars = buckets.map((b, i) => {
    const x = i * cw + (cw - bw) / 2, lab = b.d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return `<g><title>${esc(lab)}: ${b.w} won, ${b.l} lost</title>
      ${b.w ? `<rect x="${x.toFixed(1)}" y="${(mid - 1 - b.w * u).toFixed(1)}" width="${bw.toFixed(1)}" height="${(b.w * u).toFixed(1)}" rx="2" class="rc-w"/>` : ''}
      ${b.l ? `<rect x="${x.toFixed(1)}" y="${mid + 1}" width="${bw.toFixed(1)}" height="${(b.l * u).toFixed(1)}" rx="2" class="rc-l"/>` : ''}
      <rect x="${(i * cw).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${H}" fill="transparent"/></g>` }).join('');
  const first = buckets[0].d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `<div class="rc-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Wins and losses per day over the last ${days} days">
      <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="rc-axis"/>${bars}</svg>
    <div class="rc-axis-l"><span>${esc(first)}</span><span><i class="rc-key w"></i>Won <i class="rc-key l"></i>Lost</span><span>Today</span></div></div>`;
}

function recBreak(title, groups){
  const rows = groups.filter(g => g.s.n).sort((a, b) => b.s.n - a.s.n);
  if (!rows.length) return '';
  return `<div class="rc-block"><h5>${esc(title)}</h5>${rows.map(g => `<div class="rc-row"><span class="rc-name">${esc(g.name)}</span>
      <span class="rc-bar" aria-hidden="true"><i style="width:${Math.round((g.s.rate || 0) * 100)}%"></i></span>
      <b class="num">${recRateTxt(g.s.rate)}</b><small class="num">${g.s.won}-${g.s.lost}</small></div>`).join('')}</div>`;
}

function recGroup(rows, keyFn, order){
  const m = new Map();
  for (const e of rows) { const k = keyFn(e); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(e) }
  const out = [...m].map(([name, r]) => ({ name, s: recStats(r) }));
  return order ? out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) : out;
}

function recVsYou(rows){
  const mine = new Map((S.picks || []).filter(p => p.result).map(p => [String(p.id), p]));
  const both = rows.filter(e => e.sport === 'soccer' && (e.result === 'won' || e.result === 'lost') && mine.has(String(e.id)));
  const allMine = [...mine.values()], myWon = allMine.filter(p => p.result === 'won').length;
  if (!allMine.length) return `<div class="rc-block rc-you"><h5>You vs Floodlight</h5><p class="rc-hint">Save your own pick on any upcoming soccer match (the “Your pick” buttons on a match’s prediction) and your record shows up here next to Floodlight’s.</p></div>`;
  const fl = both.filter(e => e.result === 'won').length, you = both.filter(e => mine.get(String(e.id)).result === 'won').length;
  return `<div class="rc-block rc-you"><h5>You vs Floodlight</h5>
    <div class="rc-duel"><div><small>You</small><b class="num">${myWon}-${allMine.length - myWon}</b><span>${recRateTxt(myWon / allMine.length)} overall</span></div>
      <div class="rc-vs">${both.length ? `<b class="num">${you}–${fl}</b><small>on the ${both.length} match${both.length === 1 ? '' : 'es'} you both called</small>` : '<small>No shared matches graded yet</small>'}</div>
      <div><small>Floodlight</small><b class="num">${fl}-${both.length - fl}</b><span>same matches</span></div></div></div>`;
}

function recHistory(rows){
  const R = S.rec, f = R.filter;
  const list = rows.filter(e => f === 'all' || (f === 'pending' ? !e.result : e.result === f));
  const mine = new Map((S.picks || []).map(p => [String(p.id), p]));
  const counts = { all: rows.length, won: rows.filter(e => e.result === 'won').length, lost: rows.filter(e => e.result === 'lost').length, pending: rows.filter(e => !e.result).length };
  let lastDay = '';
  const items = list.slice(0, R.show).map(e => {
    const d = recDay(e.ko), dk = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const head = dk !== lastDay ? `<div class="rc-day">${esc(dk)}</div>` : ''; lastDay = dk;
    const my = e.sport === 'soccer' ? mine.get(String(e.id)) : null;
    const badge = e.result === 'won' ? '<em class="rc-b won">Won</em>' : e.result === 'lost' ? '<em class="rc-b lost">Lost</em>' : e.result === 'push' ? '<em class="rc-b">Push</em>' : e.result === 'void' ? '<em class="rc-b">Void</em>' : '<em class="rc-b open">Pending</em>';
    return head + `<div class="rc-item ${e.result || 'open'}">
      <div class="rc-teams"><span>${esc(e.home)} <span class="rc-v">v</span> ${esc(e.away)}</span>
        <small>${esc(recLeague(e))} · ${esc(d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}${e.research ? ' · with research' : ''}</small></div>
      <div class="rc-call"><small>Floodlight</small><b>${esc(recSide(e, e.pick))}</b><span class="num">${Math.round((e.top || 0) * 100)}%${e.conf ? ' · ' + esc(e.conf) : ''}</span>
        ${my ? `<small class="rc-mine ${my.result || ''}">You: ${esc(recSide(e, my.pick))}</small>` : ''}</div>
      <div class="rc-res">${e.final ? `<b class="num">${e.final[0]}–${e.final[1]}</b>` : '<b class="num">–</b>'}${e.exact ? '<small class="rc-exact">Exact score</small>' : e.score && e.sport === 'soccer' ? `<small class="num">called ${e.score[0]}–${e.score[1]}</small>` : ''}${badge}</div></div>` }).join('');
  return `<div class="sub-h"><h5>History</h5><small>Locked at kick-off, graded at full time</small></div>
    <div class="rc-filters" role="group" aria-label="Filter results">${[['all', 'All'], ['won', 'Won'], ['lost', 'Lost'], ['pending', 'Pending']].map(([k, l]) =>
      `<button class="qf" data-rec="filter" data-to="${k}" aria-pressed="${f === k}">${l} <span class="num">${counts[k]}</span></button>`).join('')}</div>
    <div class="rc-list">${items || `<div class="empty-state"><strong>Nothing here yet</strong>${f === 'pending' ? 'No matches are waiting on a result.' : 'Try another filter or a longer time range.'}</div>`}</div>
    ${list.length > R.show ? `<div style="text-align:center;margin-top:10px"><button class="btn ghost" data-rec="more">Show ${Math.min(20, list.length - R.show)} more</button></div>` : ''}`;
}

function renderRecord(el){
  if (!el) return;
  const R = S.rec;
  recLoad();
  if (typeof settlePicks === 'function') settlePicks();
  const tabs = recTabs();
  if (!R.data) {
    el.innerHTML = tabs + (R.err ? `<div class="err">${esc(R.err)} <button class="linkbtn" data-rec="reload">Try again</button></div>` : '<div class="skel" style="height:180px"></div><div class="skel" style="height:300px;margin-top:12px"></div>');
    return;
  }
  const rows = recRows(), s = recStats(rows);
  const conf = recGroup(rows, e => e.conf, ['Strong', 'Lean', 'Toss-up']);
  const sport = recGroup(rows, e => e.sport === 'football' ? 'American football' : 'Soccer');
  const lg = recGroup(rows, recLeague).filter(g => g.s.n).sort((a, b) => b.s.n - a.s.n).slice(0, 8);
  const ranges = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']];
  const tone = s.rate == null ? '' : s.rate >= .55 ? 'hot' : s.rate < .45 ? 'cold' : '';
  el.innerHTML = tabs + `
    <div class="rc-controls">
      <div class="seg" role="radiogroup" aria-label="Sport">${[['all', 'All'], ['soccer', 'Soccer'], ['football', 'Football']].map(([k, l]) => `<button role="radio" aria-checked="${R.sport === k}" class="${R.sport === k ? 'on' : ''}" data-rec="sport" data-to="${k}">${l}</button>`).join('')}</div>
      <div class="seg" role="radiogroup" aria-label="Time range">${ranges.map(([k, l]) => `<button role="radio" aria-checked="${R.range === k}" class="${R.range === k ? 'on' : ''}" data-rec="range" data-to="${k}">${l}</button>`).join('')}</div>
    </div>
    <section class="rc-hero ${tone}" aria-label="Record summary">
      <div class="rc-big"><small>Record</small><b class="num">${s.won}-${s.lost}</b><span>${s.n ? `${s.n} graded pick${s.n === 1 ? '' : 's'}` : 'No graded picks yet'}</span></div>
      <div class="rc-ring" style="--p:${Math.round((s.rate || 0) * 100)}"><b class="num">${recRateTxt(s.rate)}</b><small>Hit rate</small></div>
      <div class="rc-facts">
        <div><b class="num ${s.kind === 'won' ? 'up' : s.kind === 'lost' ? 'down' : ''}">${s.kind ? (s.kind === 'won' ? 'W' : 'L') + s.streak : '–'}</b><span>Current streak</span></div>
        <div><b class="num">${s.best ? 'W' + s.best : '–'}</b><span>Best run</span></div>
        <div><b class="num">${s.exact}</b><span>Exact scores</span></div>
        <div><b class="num">${s.pending}</b><span>Pending</span></div>
      </div>
      <button class="btn rc-share-btn" data-rec="share" ${s.n ? '' : 'disabled'}>Share record card</button>
    </section>
    ${recChart(rows)}
    <div class="rc-grid">${recBreak('By confidence', conf)}${R.sport === 'all' ? recBreak('By sport', sport) : ''}${recBreak('By league', lg)}${recVsYou(rows)}</div>
    ${recHistory(rows)}
    <p class="srcnote">Each match's last forecast before kick-off is saved and can't change afterwards. Soccer picks are home, draw or away over 90 minutes; American football picks are the winner, and a tie counts as a push. Postponed matches are void. Matches are the ones Floodlight tracks: followed teams, saved picks, starred leagues, matches opened in the app, every NFL game and ranked college games.</p>${typeof RG === 'undefined' ? '' : RG}`;
}

function recTabs(count){
  return `<div class="livebar"><h2>Predictions</h2>${count ? `<span class="count">${count}</span>` : ''}</div>
    <div class="seg rc-tabs" role="tablist" aria-label="Predictions view"><button role="tab" aria-selected="${S.picksTab !== 'record'}" class="${S.picksTab !== 'record' ? 'on' : ''}" data-rec="tab" data-to="today">Upcoming</button><button role="tab" aria-selected="${S.picksTab === 'record'}" class="${S.picksTab === 'record' ? 'on' : ''}" data-rec="tab" data-to="record">Track record</button></div>`;
}

/* ---------- shareable record card ---------- */
function recCard(){
  const R = S.rec, rows = recRows(), s = recStats(rows);
  const c = document.createElement('canvas'); c.width = 1200; c.height = 675;
  const x = c.getContext('2d'), F = '"FL Wide", Geist, system-ui, sans-serif', B = 'Geist, system-ui, sans-serif';
  const g = x.createLinearGradient(0, 0, 1200, 675); g.addColorStop(0, '#0B111C'); g.addColorStop(1, '#16233A');
  x.fillStyle = g; x.fillRect(0, 0, 1200, 675);
  x.fillStyle = '#F4C542'; x.fillRect(0, 0, 1200, 8);
  x.fillStyle = '#E8ECF3'; x.font = `900 44px ${F}`; x.fillText('FLOODLIGHT', 64, 92);
  x.fillStyle = '#8C98B0'; x.font = `600 22px ${B}`;
  const scope = (R.sport === 'soccer' ? 'Soccer' : R.sport === 'football' ? 'American football' : 'All sports') + ' · ' + (R.range ? `Last ${R.range} days` : 'All time');
  x.fillText(`TRACK RECORD · ${scope.toUpperCase()}`, 64, 132);
  x.fillStyle = '#E8ECF3'; x.font = `900 190px ${F}`; x.fillText(`${s.won}-${s.lost}`, 58, 330);
  x.fillStyle = s.rate >= .5 ? '#3FCB7E' : '#FF6B6B'; x.font = `800 84px ${F}`; x.fillText(recRateTxt(s.rate), 64, 430);
  const rw = x.measureText(recRateTxt(s.rate)).width;
  x.fillStyle = '#8C98B0'; x.font = `600 22px ${B}`; x.fillText('HIT RATE', 64 + rw + 18, 422);
  const facts = [[s.kind ? (s.kind === 'won' ? 'W' : 'L') + s.streak : '–', 'STREAK'], [s.best ? 'W' + s.best : '–', 'BEST RUN'], [String(s.exact), 'EXACT SCORES']];
  facts.forEach(([v, l], i) => { const fx = 64 + i * 190; x.fillStyle = '#E8ECF3'; x.font = `800 52px ${F}`; x.fillText(v, fx, 530); x.fillStyle = '#8C98B0'; x.font = `600 17px ${B}`; x.fillText(l, fx, 560) });
  // latest results down the right
  x.fillStyle = '#121A28'; x.beginPath(); x.roundRect ? x.roundRect(660, 70, 476, 520, 22) : x.rect(660, 70, 476, 520); x.fill();
  x.fillStyle = '#8C98B0'; x.font = `600 18px ${B}`; x.fillText('LATEST RESULTS', 692, 116);
  const last = rows.filter(e => e.result === 'won' || e.result === 'lost').slice(0, 7);
  const clip = (t, w) => { if (x.measureText(t).width <= w) return t; while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…' };
  last.forEach((e, i) => { const y = 168 + i * 62;
    x.fillStyle = e.result === 'won' ? '#3FCB7E' : '#FF6B6B'; x.beginPath(); x.arc(706, y - 8, 12, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#0B111C'; x.font = `800 15px ${B}`; x.textAlign = 'center'; x.fillText(e.result === 'won' ? 'W' : 'L', 706, y - 3); x.textAlign = 'left';
    x.fillStyle = '#E8ECF3'; x.font = `600 20px ${B}`; x.fillText(clip(`${e.home} ${e.final[0]}–${e.final[1]} ${e.away}`, 390), 732, y - 10);
    x.fillStyle = '#8C98B0'; x.font = `500 16px ${B}`; x.fillText(clip(`Picked ${recSide(e, e.pick)} · ${Math.round((e.top || 0) * 100)}%`, 390), 732, y + 14) });
  if (!last.length) { x.fillStyle = '#8C98B0'; x.font = `500 20px ${B}`; x.fillText('No graded picks yet', 692, 170) }
  x.fillStyle = '#5C677D'; x.font = `500 17px ${B}`; x.fillText('Locked at kick-off, graded at full time. Past results, not guarantees. 21+.', 64, 630);
  return c;
}
async function recShare(){
  const c = recCard(), s = recStats(recRows());
  const text = `Floodlight track record: ${s.won}-${s.lost} (${recRateTxt(s.rate)} hit rate)${s.kind ? `, current streak ${s.kind === 'won' ? 'W' : 'L'}${s.streak}` : ''}.`;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = blob && new File([blob], 'floodlight-record.png', { type: 'image/png' });
  try {
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return }
  } catch (err) { if (err?.name === 'AbortError') return }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'floodlight-record.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  try { await navigator.clipboard.writeText(text) } catch {}
  if (typeof toast === 'function') toast('Record card saved. The summary text is copied too, ready to paste into Discord.');
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-rec]'); if (!b) return;
  const R = S.rec, a = b.dataset.rec, to = b.dataset.to;
  if (a === 'tab') { S.picksTab = to; try { history.replaceState(null, '', to === 'record' ? '#record' : location.pathname + location.search) } catch {} return renderPicks() }
  if (a === 'sport') R.sport = to;
  if (a === 'range') R.range = +to;
  if (a === 'filter') R.filter = to;
  if (a === 'sport' || a === 'range' || a === 'filter') R.show = 15;
  if (a === 'more') R.show += 20;
  if (a === 'reload') return recLoad(true);
  if (a === 'share') return recShare();
  renderRecord($('picks'));
});

if (location.hash === '#record') setTimeout(() => { if (typeof openPicks === 'function' && (!S.sport || S.sport === 'soccer')) openPicks() }, 0);

/* styles for this page */
document.head.insertAdjacentHTML('beforeend', `<style>
.rc-tabs{display:flex;max-width:340px;margin:-4px 0 16px}.rc-tabs button{flex:1;padding:8px 12px;font-size:13px}
.rc-controls{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}.rc-controls .seg{margin-bottom:0;flex-wrap:wrap}
.rc-hero{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:22px;align-items:center;margin-top:14px;padding:20px 22px;border:1px solid var(--line);border-radius:16px;
  background:linear-gradient(140deg,color-mix(in oklab,var(--accent) 12%,var(--surface)),var(--surface) 70%)}
.rc-hero.hot{background:linear-gradient(140deg,color-mix(in oklab,var(--win) 16%,var(--surface)),var(--surface) 70%)}
.rc-hero.cold{background:linear-gradient(140deg,color-mix(in oklab,var(--loss) 12%,var(--surface)),var(--surface) 70%)}
.rc-big small,.rc-facts span,.rc-ring small,.rc-call small,.rc-duel small{font:600 9.5px/1.2 var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.rc-big b{display:block;font:900 64px/0.95 var(--f-display);letter-spacing:.01em}.rc-big span{color:var(--muted);font-size:12px}
.rc-ring{--p:0;width:108px;height:108px;border-radius:50%;display:grid;place-content:center;text-align:center;
  background:radial-gradient(closest-side,var(--surface) 78%,transparent 79%),conic-gradient(var(--win) calc(var(--p)*1%),color-mix(in oklab,var(--loss) 55%,var(--surface-2)) 0)}
.rc-ring b{font:800 30px/1 var(--f-display)}
.rc-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.rc-facts b{display:block;font:800 26px/1 var(--f-display)}
.rc-facts b.up{color:var(--win)}.rc-facts b.down{color:var(--loss)}
.rc-chart{margin-top:12px;padding:14px 16px 10px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.rc-chart svg{width:100%;height:130px;display:block}.rc-w{fill:var(--win)}.rc-l{fill:var(--loss)}.rc-axis{stroke:var(--line);stroke-width:1}
.rc-chart g:hover rect.rc-w,.rc-chart g:hover rect.rc-l{opacity:.75}
.rc-axis-l{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:6px}.rc-key{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}
.rc-key.w{background:var(--win)}.rc-key.l{background:var(--loss)}
.rc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
.rc-block{border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:14px 16px}.rc-block h5{margin:0 0 10px}
.rc-row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 44px 52px;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:13px}
.rc-row:first-of-type{border-top:0}.rc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc-bar{height:8px;border-radius:999px;background:var(--surface-2);overflow:hidden}.rc-bar i{display:block;height:100%;background:var(--win);border-radius:999px}
.rc-row b{text-align:right}.rc-row small{color:var(--muted);text-align:right}
.rc-hint{color:var(--muted);font-size:13px;margin:0}
.rc-duel{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;text-align:center}.rc-duel b{display:block;font:800 30px/1.05 var(--f-display)}
.rc-duel span{color:var(--muted);font-size:11.5px}.rc-vs{padding:8px 12px;border-radius:12px;background:var(--surface-2)}.rc-vs b{font-size:22px}.rc-vs small{display:block;max-width:120px;text-transform:none;letter-spacing:0;font:500 11px/1.3 var(--f-body)}
.rc-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.rc-filters .num{opacity:.65;margin-left:2px}
.rc-list{display:grid;gap:6px}.rc-day{font:600 10.5px/1 var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:10px 0 2px}
.rc-item{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:14px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;background:var(--surface);font-size:13px}
.rc-item.won{border-left-color:var(--win)}.rc-item.lost{border-left-color:var(--loss)}.rc-item.open{border-left-color:var(--accent)}
.rc-teams span{font-weight:600}.rc-teams small{display:block;color:var(--muted);font-size:11.5px;margin-top:2px}.rc-v{color:var(--muted);font-weight:400}
.rc-call b{display:block;font-weight:700}.rc-call span{color:var(--muted);font-size:11.5px}.rc-call small{display:block}
.rc-mine{margin-top:3px;text-transform:none!important;letter-spacing:0!important;font:600 11px/1.2 var(--f-body)!important}.rc-mine.won{color:var(--win)!important}.rc-mine.lost{color:var(--loss)!important}
.rc-res{display:grid;justify-items:end;gap:3px;text-align:right}.rc-res b{font:800 20px/1 var(--f-display)}.rc-res small{color:var(--muted);font-size:11px}.rc-exact{color:var(--accent)!important;font-weight:700}
.rc-b{font:700 11px/1 var(--f-mono);font-style:normal;padding:4px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted)}
.rc-b.won{background:var(--win);color:#fff}.rc-b.lost{background:var(--loss);color:#fff}.rc-b.open{background:color-mix(in oklab,var(--accent) 20%,var(--surface-2));color:var(--fg)}
@media (max-width:820px){ .rc-hero{grid-template-columns:auto auto;gap:16px}.rc-facts,.rc-share-btn{grid-column:1/-1}.rc-grid{grid-template-columns:1fr} }
@media (max-width:520px){ .rc-hero{padding:16px}.rc-big b{font-size:52px}.rc-ring{width:92px;height:92px}.rc-facts{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rc-item{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px}.rc-call{grid-column:1;grid-row:2}.rc-res{grid-row:1/3;grid-column:2}.rc-tabs{max-width:none} }
</style>`);
