/* Floodlight · scheduled forecasts
   The local server writes each tracked match's forecast at 7:00 (soccer) or 9:00 (football) on match day, then 1 hour
   and 30 minutes before kick-off, even while this page is closed. With an Anthropic API key saved on the server, each
   update also includes Claude's web research. This file shows those forecasts and tells the server which matches you care about. */
S.fc = new Map(); S.fcSettings = null;
const isFbEv = e => e?.src === 'fb' || e?.src === 'tsdb';
const fcKeyOf = e => `${isFbEv(e) ? 'football' : 'soccer'}:${e.id}`;
const FC_LABEL = { week: 'A week before', days3: '3 days before', morning: 'Morning', hour: '1 hour before', final: '30 min before', now: 'On request' };
const fcTime = t => new Date(t * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function fcItem(e){
  return isFbEv(e) ? { sport: 'football', id: e.id, lg: e.lg, date: e.date.toISOString(), home: e.home.full || e.home.name, away: e.away.full || e.away.name }
    : { sport: 'soccer', id: e.id, lg: e.slug, date: e.date.toISOString(), src: e.src === 'fm' ? 'fm' : 'espn', fmId: e.fmId, home: e.home.full || e.home.name, away: e.away.full || e.away.name };
}
const fcSent = new Set();
function fcTrack(evs){
  const items = evs.filter(e => e && e.state === 'pre' && e.src !== 'tsdb' && !fcSent.has(fcKeyOf(e))).map(fcItem);
  if (!items.length || S.serverOK === false) return Promise.resolve();
  items.forEach(i => fcSent.add(`${i.sport}:${i.id}`));
  return api('/api/forecast/track', { matches: items }).catch(() => items.forEach(i => fcSent.delete(`${i.sport}:${i.id}`)));
}
async function fcFetch(keys){
  if (!keys.length || S.serverOK === false) return [];
  const d = await api(`/api/forecast/get?keys=${keys.map(encodeURIComponent).join(',')}`);
  S.fcSettings = d.settings;
  const fresh = [];
  for (const [k, v] of Object.entries(d.forecasts || {})) {
    const old = S.fc.get(k);
    if (old && v.snaps.length > old.snaps.length) fresh.push([k, v]);
    S.fc.set(k, v);
  }
  return fresh;
}
const fcLatest = e => { const s = S.fc.get(fcKeyOf(e))?.snaps; return s?.length ? s[s.length - 1] : null };

// the match open in the side panel, if any
function fcOpenEvent(){
  const v = S.stack[S.stack.length - 1];
  if (v?.type === 'fbgame') return v.e;
  return S.sel ? S.events.get(S.sel) : null;
}
const fbWatched = e => S.fav.some(f => f.sport === 'football' && f.lg === e.lg && (String(f.tid) === String(e.home.id) || String(f.tid) === String(e.away.id)));
function fcRerender(key){
  const e = fcOpenEvent(); if (!e || fcKeyOf(e) !== key) return;
  const v = S.stack[S.stack.length - 1];
  if (v?.type === 'fbgame' ? v.tab === 'pred' : S.tab === 'insight') renderSheet();
}
let fcBusy = false;
async function fcTick(){
  if (fcBusy || document.hidden || S.serverOK === false) return; fcBusy = true;
  try {
    const soccer = [...new Set([...S.events.values(), ...(S.extra?.values() || [])])].filter(e => e.state === 'pre' && watched(e));
    const fb = Object.values(S.fb?.data || {}).flatMap(d => d.events || []).filter(e => e.state === 'pre' && fbWatched(e));
    const open = fcOpenEvent();
    const all = [...soccer, ...fb, ...(open ? [open] : [])];
    await fcTrack(all);
    const fresh = await fcFetch([...new Set(all.map(fcKeyOf))]).catch(() => []);
    for (const [k, f] of fresh) {
      const s = f.snaps[f.snaps.length - 1], e = all.find(x => fcKeyOf(x) === k); if (!e) continue;
      const t = document.createElement('div'); t.className = 'toast';
      t.innerHTML = `<b>${esc(FC_LABEL[s.stage] || 'Update')}</b><span>${esc(e.away.name)} ${isFbEv(e) ? '@' : 'v'} ${esc(e.home.name)}<br><span style="opacity:.75">${esc(fcPickLabel(s))} · ${pct(s.top)}%${s.ai && !s.ai.error ? ' · with Claude research' : ''}</span></span>`;
      t.onclick = () => { if (isFbEv(e)) { openFbGame(e.id, e.lg); const v = S.stack[S.stack.length - 1]; if (v) { v.tab = 'pred'; renderSheet() } } else { S.tab = 'insight'; select(e.id) } };
      $('toasts').appendChild(t); setTimeout(() => t.remove(), 12000);
      $('announce').textContent = `Forecast updated for ${e.home.name} versus ${e.away.name}: ${fcPickLabel(s)}, ${pct(s.top)} percent.`;
      fcRerender(k);
    }
  } finally { fcBusy = false }
}
setInterval(fcTick, 60000);
setTimeout(fcTick, 5000);
const fcPickLabel = s => s.pick === 'draw' ? 'Draw' : `${s[s.pick]} win`;

// the latest server forecast replaces the live numbers at the top of the prediction tab
function fcApplySoccer(e, P){
  const L = fcLatest(e); if (!L || !L.final) return P;
  return { ...P, final: L.final, pick: L.pick, top: L.top, conf: L.conf, score: L.score, lh: L.xg?.[0] ?? P.lh, la: L.xg?.[1] ?? P.la,
    o25: L.o25 ?? P.o25, btts: L.btts ?? P.btts, likely: L.likely || P.likely, fromServer: L };
}
function fcApplyFootball(e, P){
  const L = fcLatest(e); if (!L || !L.final) return P;
  return { ...P, pH: L.final.home, pick: L.pick, top: L.top, conf: L.conf, score: L.score, effMargin: L.margin, total: L.total, fromServer: L };
}
const fcTag = P => P.fromServer ? ` <small class="fc-tag">${esc(FC_LABEL[P.fromServer.stage] || '')} update${P.fromServer.ai && !P.fromServer.ai.error ? ' · Claude research' : ''}</small>` : '';

/* ---------- the timeline ---------- */
const fcPending = new Set();
function fcBlock(e){
  if (S.serverOK === false || e.src === 'tsdb') return '';
  const key = fcKeyOf(e), f = S.fc.get(key);
  if (!f) {
    if (e.state === 'pre' && !fcPending.has(key)) { fcPending.add(key); fcTrack([e]).then(() => fcFetch([key])).then(() => fcRerender(key)).catch(() => {}).finally(() => fcPending.delete(key)) }
    return e.state === 'pre' ? `<div class="sub-h"><h5>Scheduled forecasts</h5><small>Loading…</small></div>` : '';
  }
  if (!f.snaps.length && !f.plan) return '';
  const fb = isFbEv(e), morning = fb ? '9:00' : '7:00';
  const asItem = s => ({ stage: s.stage, at: s.at, done: true, snap: s });
  const stages = (f.plan ? [...f.plan.map(p => ({ ...p, snap: f.snaps.find(s => s.stage === p.stage) })), ...f.snaps.filter(s => s.stage === 'now').map(asItem)] : f.snaps.map(asItem))
    .sort((a, b) => (a.snap?.at || a.at) - (b.snap?.at || b.at));
  let prev = null;
  const items = stages.map(p => {
    const s = p.snap, label = p.stage === 'morning' ? `Morning (${morning})` : FC_LABEL[p.stage];
    if (!s) return `<li><span class="cp-dot"></span><div><strong>${esc(label)}</strong> <small>${esc(fcTime(p.at))}</small><p class="fc-wait">${p.skipped ? 'Skipped: the match was added after this time, or the server was off' : f.running && !stages.some(x => x.snap && x.at > p.at) && p.at * 1000 <= Date.now() ? 'Writing now…' : 'Scheduled'}</p></div></li>`;
    const d = prev ? Math.round((s.final[s.pick] - (prev.final[s.pick] || 0)) * 100) : null, changed = prev && prev.pick !== s.pick;
    prev = s;
    const ai = s.ai && !s.ai.error ? s.ai : null;
    const score = fb ? `${s.away} ${s.score[1]}–${s.score[0]} ${s.home}` : `${s.score[0]}–${s.score[1]}`;
    const extra = fb ? `${s.margin >= 0 ? esc(s.home) : esc(s.away)} by ${Math.abs(s.margin).toFixed(1)} · total ${s.total}` : `xG ${s.xg?.[0]}–${s.xg?.[1]}`;
    return `<li><span class="cp-dot ${p.stage === 'final' ? 'final' : 'day'}"></span><div><strong>${esc(label)}</strong> <small>${esc(fcTime(s.at))}${s.lineup?.type ? ' · ' + esc((LINEUP_LABEL[s.lineup.type] || '').replace(/ \(.*\)/, '')) : ''}</small>
      <p>${esc(fcPickLabel(s))} · ${pct(s.top)}%${d ? ` <em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : ''} · ${esc(score)}${changed ? ' · <em class="down">pick changed</em>' : ''}${ai ? ' <span class="fc-ai">Claude</span>' : ''}</p>
      <small>${extra}</small>
      <details class="fc-more"><summary>${ai ? 'Read the analysis' : 'What went into it'}</summary>
        ${ai ? `${ai.changed ? `<p><strong>What changed:</strong> ${esc(ai.changed)}</p>` : ''}<p>${esc(ai.summary || '')}</p>
          ${ai.factors?.length ? `<h6>Key factors</h6><ul class="why">${ai.factors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${ai.risks?.length ? `<h6>What could go differently</h6><ul class="why">${ai.risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${['lineups', 'injuries', 'coaches'].filter(k => ai[k]).map(k => `<p><strong>${k[0].toUpperCase() + k.slice(1)}:</strong> ${esc(ai[k])}</p>`).join('')}
          ${ai.props?.length ? `<h6>Player props Claude likes</h6><ul class="why">${ai.props.filter(x => x?.player).map(x => `<li><strong>${esc(x.player)} · ${esc(x.pick || '')}</strong> (${esc(x.market || '')}): ${esc(x.why || '')}</li>`).join('')}</ul>` : ''}
          <p class="pf-hint">Claude's own call: ${Object.entries(ai.probabilities || {}).map(([k, v]) => `${esc(k === 'draw' ? 'draw' : s[k])} ${pct(v)}%`).join(', ')}${ai.score ? `, ${esc(ai.score)}` : ''} (${esc(ai.confidence || '')} confidence). The headline blends this 50/50 with the numbers below.</p>` : ''}
        ${s.ai?.error ? `<p class="pf-hint">Research didn't run: ${esc(s.ai.error)}</p>` : ''}
        ${s.value?.length ? `<h6>Best prices vs the market at this time</h6><ul class="why">${s.value.map(v => `<li>${esc(v.type === 'ml' ? (v.label === 'draw' ? 'Draw' : s[v.label] + ' to win') : v.label)}: ${v.price.am > 0 ? '+' : ''}${v.price.am} at ${esc(BOOK_NAME[v.book] || v.book)} (+${(v.ev * 100).toFixed(1)}% vs the other books)</li>`).join('')}</ul>` : ''}
        <h6>The numbers</h6><ul class="why">${(s.reasons || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="pf-hint">${fb ? `Numbers: ${s.market ? 'the sportsbook line (55%), ' : ''}${s.fpi ? 'ESPN’s matchup predictor (25%), ' : ''}and a points model with home field, recent form and position-weighted injuries, including the quarterback.` : `Numbers: a goals model built from attack and defense split by home and away, recent form, lineup strength by market value, injuries and head-to-head${s.market ? ', blended 60/40 with the sportsbook price' : ''}.`}</p>
        ${ai?.sources?.length ? `<h6>Sources</h6><ul class="srcs">${ai.sources.slice(0, 8).map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a></li>`).join('')}</ul>` : ''}
      </details></div></li>`;
  }).join('');
  const st = f.running ? 'Writing an update now…' : f.queued ? 'Update queued…' : `A week and 3 days before, ${morning} on ${fb ? 'game' : 'match'} day, then 1 hour and 30 minutes before kick-off`;
  return `<div class="sub-h"><h5>Scheduled forecasts</h5><small>${esc(st)}</small></div>
    ${items ? `<ol class="cp fc">${items}</ol>` : ''}${f.error ? `<p class="pf-hint">Last update failed: ${esc(f.error)}</p>` : ''}
    ${fcSettingsRow(e, f)}`;
}
function fcSettingsRow(e, f){
  const s = S.fcSettings; if (!s) return '';
  const run = S.me && e.state === 'pre' ? `<button class="btn ghost sm" data-fc="run" data-to="${esc(fcKeyOf(e))}"${f.running || f.queued ? ' disabled' : ''}>Update now</button>` : '';
  const scope = s.scope === 'all' ? 'every tracked match' : 'followed teams and saved picks';
  let h;
  if (s.hasKey && s.enabled && !s.keyError) h = `<p class="pf-hint"><strong>Claude research is on</strong> for ${scope} · ${s.used} of ${s.cap} today${f.research ? '' : '. This match gets the numbers only; follow a team or save a pick to include it.'}</p>`;
  else if (s.keyError) h = `<p class="pf-hint err">${esc(s.keyError)}</p>`;
  else if (s.hasKey) h = `<p class="pf-hint">Claude research is off for scheduled forecasts.</p>`;
  else h = `<p class="pf-hint">Add Claude research to these updates: at each one, Claude reads the latest team news, lineups, injuries and coaching notes on the web and gives its own forecast, blended 50/50 with the numbers. It uses your Anthropic API key, billed per update; a daily cap keeps the cost in check.</p>`;
  const ctl = !S.me ? `<p class="pf-hint">Log in from the profile icon to change research settings${s.hasKey ? '' : ' or add your key'}.</p>`
    : `<details class="fc-set"><summary>Research settings</summary>
      ${!s.hasKey || s.keyError ? (store.get('fl.key', '') ? `<p><button class="btn sm" data-fc="usekey">Use the key saved in this browser</button></p>` : '')
        + `<form id="fcKeyForm" class="keyrow"><input id="fcKey" type="password" placeholder="Anthropic API key (sk-ant-…)" autocomplete="off" aria-label="Anthropic API key"><button class="btn" type="submit">Save on server</button></form>` : ''}
      ${s.hasKey ? `<div class="fc-ctl"><label>Research <select data-fc="enabled"><option value="1"${s.enabled ? ' selected' : ''}>On</option><option value="0"${!s.enabled ? ' selected' : ''}>Off</option></select></label>
        <label>For <select data-fc="scope"><option value="watched"${s.scope !== 'all' ? ' selected' : ''}>Followed teams &amp; picks</option><option value="all"${s.scope === 'all' ? ' selected' : ''}>Every tracked match</option></select></label>
        <label>Daily limit <select data-fc="cap">${[5, 10, 20, 40, 80].map(n => `<option${n === s.cap ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn ghost sm" data-fc="forget">Remove key</button></div>` : ''}
      <p class="pf-hint">The key is stored only on this Mac, in Floodlight's private settings file. Updates run while the server is running and the Mac is awake.</p></details>`;
  return `<div class="fc-foot">${h}${run}${ctl}</div>`;
}
async function fcSave(body){
  try { S.fcSettings = await api('/api/forecast/settings', body); toast('Research settings saved') }
  catch (err) { toast(err.message) }
  const e = fcOpenEvent(); if (e) fcRerender(fcKeyOf(e));
}
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-fc]'); if (!el || el.tagName === 'SELECT') return;
  const a = el.dataset.fc;
  if (a === 'run') { el.disabled = true; api('/api/forecast/run', { key: el.dataset.to }).then(() => { const f = S.fc.get(el.dataset.to); if (f) f.queued = true; fcRerender(el.dataset.to); setTimeout(() => fcFetch([el.dataset.to]).then(() => fcRerender(el.dataset.to)), 4000) }).catch(err => toast(err.message)); return }
  if (a === 'usekey') return fcSave({ key: store.get('fl.key', '') });
  if (a === 'forget') return fcSave({ clearKey: true });
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('select[data-fc]'); if (!el) return;
  const a = el.dataset.fc;
  if (a === 'enabled') fcSave({ enabled: el.value === '1' });
  if (a === 'scope') fcSave({ scope: el.value });
  if (a === 'cap') fcSave({ cap: +el.value });
});
document.addEventListener('submit', ev => {
  if (ev.target.id !== 'fcKeyForm') return;
  ev.preventDefault(); const k = $('fcKey').value.trim(); if (k) fcSave({ key: k });
});
// keep the "writing now" state fresh while a prediction tab is open
setInterval(() => { const e = fcOpenEvent(); if (!e || document.hidden) return; const f = S.fc.get(fcKeyOf(e)); if (f && (f.running || f.queued)) fcFetch([fcKeyOf(e)]).then(() => fcRerender(fcKeyOf(e))).catch(() => {}) }, 8000);
