/* Floodlight · boxing and UFC, the fight-night screens.
   Boxing: fight nights from TheSportsDB and the tale of the tape from Wikipedia, both through the local server
   (/api/box/…, see boxing.py). UFC: ESPN's fight cards, read directly, with every bout on the card.
   A fight page has the tale of the tape, the card and a prediction; a fighter has a profile page.
   Loaded after tennis.js and reuses the shared helpers (flPred, tabsHTML, pushView, getJSON). */
S.bx = { tab: 'boxing', cards: null, at: 0, ufc: null, ufcAt: 0, fighters: new Map(), ath: new Map() };
if (!['boxing', 'ufc'].includes(S.bx.tab)) S.bx.tab = 'boxing';
const BX_UFC = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const BX_ATH = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/athletes/';
const bxGlove = '<path d="M7 20h8v-4l3-3V8a3 3 0 0 0-3-3h-.5A2.500 2.500 0 0 0 12 3H9a3 3 0 0 0-3 3v2.500A2.500 2.500 0 0 0 4 11v1a3 3 0 0 0 3 3zM7 16h8M10 9h5"/>';

/* ---------- facts ---------- */
const bxWhen = e => e.ts ? new Date(e.ts) : new Date(e.date + 'T20:00:00');
function bxState(e){
  if (e.postponed) return 'off';
  const t = bxWhen(e).getTime(), now = Date.now();
  if (/^(FT|AET|Match Finished)$/i.test(e.status) || e.result || now > t + 7 * 36e5) return 'post';
  if (now >= t && e.timed) return 'in';
  return 'pre';
}
const bxPlace = e => [e.venue, e.city, e.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
const bxDay = d => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const bxTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const bxRec = f => f && f.wins != null ? `${f.wins}-${f.losses ?? 0}${f.draws ? '-' + f.draws : ''}` : '';
const bxKoPct = f => f && f.wins ? Math.round((f.ko || 0) / f.wins * 100) : null;
const bxLen = cm => { if (!cm) return ''; const inch = Math.round(cm / 2.54); return `${Math.floor(inch / 12)}′${inch % 12}″ · ${cm} cm` };
const bxReach = cm => cm ? `${Math.round(cm / 2.54)}″ · ${cm} cm` : '';
const bxSur = n => (n || '').trim().split(' ').slice(-1)[0];

async function bxLoad(force){
  if (!force && S.bx.cards && Date.now() - S.bx.at < 5 * 6e4) return;
  try { const d = await getJSON('/api/box/cards'); S.bx.cards = d.events || []; S.bx.at = Date.now(); S.bx.err = false;
    if (d.partial) { clearTimeout(S.bx.more); S.bx.more = setTimeout(() => bxLoad(true).then(() => S.sport === 'boxing' && S.bx.tab === 'boxing' && renderBoxing()), 45000) }
  } catch { S.bx.err = true; S.bx.cards = S.bx.cards || [] }
}
function bxFighter(name){
  const k = (name || '').toLowerCase(); if (!k) return null;
  if (!S.bx.fighters.has(k)) { S.bx.fighters.set(k, null);
    getJSON('/api/box/fighter?name=' + encodeURIComponent(name)).then(d => S.bx.fighters.set(k, d)).catch(() => S.bx.fighters.set(k, { name, found: false }))
      .finally(() => { const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('bx')) renderSheet() }) }
  return S.bx.fighters.get(k);
}
// UFC: one card (the next or current one) with every bout
function bxUfcNorm(ev){
  const bouts = (ev.competitions || []).map(c => { const st = c.status?.type || {}, cs = [...(c.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const f = x => ({ id: String(x?.id || x?.athlete?.id || ''), name: x?.athlete?.displayName || x?.athlete?.fullName || '', short: x?.athlete?.shortName || '', flag: x?.athlete?.flag?.href || '', country: x?.athlete?.flag?.alt || '',
      rec: x?.records?.[0]?.summary || x?.record || '', win: !!x?.winner, photo: x?.athlete?.headshot?.href || '' });
    return { id: String(c.id), a: f(cs[0]), b: f(cs[1]), cls: c.type?.text || c.type?.abbreviation || '', rounds: c.format?.regulation?.periods || 3, state: st.state || 'pre', detail: st.shortDetail || st.detail || '',
      date: new Date(c.date || ev.date), round: c.status?.period || 0, clock: c.status?.displayClock || '', how: c.status?.result?.shortDisplayName || c.status?.result?.displayName || '', tv: c.broadcasts?.[0]?.names?.[0] || '' } }).reverse();   // ESPN lists the opener first
  const v = ev.competitions?.[0]?.venue || ev.venues?.[0] || {};
  return { id: String(ev.id), name: ev.name || ev.shortName || 'UFC', short: ev.shortName || '', date: new Date(ev.date), state: ev.status?.type?.state || (bouts.some(b => b.state === 'in') ? 'in' : bouts.every(b => b.state === 'post') ? 'post' : 'pre'),
    venue: [v.fullName, v.address?.city, v.address?.country].filter(Boolean).join(' · '), bouts };
}
async function bxLoadUfc(force){
  if (!force && S.bx.ufc && Date.now() - S.bx.ufcAt < 30000) return;
  try { const d = await getJSON(BX_UFC); S.bx.ufc = { events: (d.events || []).map(bxUfcNorm), cal: (d.leagues?.[0]?.calendar || []).map(c => ({ label: c.label, date: new Date(c.startDate) })).filter(c => c.label) }; S.bx.ufcAt = Date.now(); S.bx.ufcErr = false }
  catch { S.bx.ufcErr = true; S.bx.ufc = S.bx.ufc || { events: [], cal: [] } }
}
function bxAthlete(id){
  if (!id) return null;
  if (!S.bx.ath.has(id)) { S.bx.ath.set(id, null);
    getJSON(BX_ATH + id).then(d => { const a = d.athlete || d; S.bx.ath.set(id, { found: true, name: a.displayName, photo: a.headshot?.href || '', nickname: a.nickname || '', age: a.age ?? null, born: a.displayDOB || '',
      height: a.displayHeight || '', weight: a.displayWeight || '', reach: a.displayReach || '', stance: a.stance?.text || a.stance || '', division: a.weightClass?.text || '', country: a.citizenship || a.flag?.alt || '',
      camp: a.association?.name || '', rec: a.statsSummary?.statistics?.find(s => /w-l-d|record/i.test(s.name + s.abbreviation))?.displayValue || '' }) })
      .catch(() => S.bx.ath.set(id, { found: false })).finally(() => { const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('bx')) renderSheet() }) }
  return S.bx.ath.get(id);
}

/* ---------- the countdown ---------- */
function bxCountdown(ts){
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000)), u = [['Days', Math.floor(s / 86400)], ['Hrs', Math.floor(s / 3600) % 24], ['Min', Math.floor(s / 60) % 60], ['Sec', s % 60]];
  return `<div class="bx-cd" data-bxcd="${+ts}" role="timer" aria-label="Time until the first bell">${u.map(([l, v]) => `<span><b class="num">${String(v).padStart(2, '0')}</b><small>${l}</small></span>`).join('')}</div>`;
}
setInterval(() => { if (document.hidden) return; document.querySelectorAll('[data-bxcd]').forEach(el => { const s = Math.max(0, Math.floor((+el.dataset.bxcd - Date.now()) / 1000)), v = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
  el.querySelectorAll('b').forEach((b, i) => { const t = String(v[i]).padStart(2, '0'); if (b.textContent !== t) b.textContent = t }) }) }, 1000);

/* ---------- the page ---------- */
const bxBadge = st => st === 'in' ? '<span class="mx-badge live"><i></i>Fight night</span>' : st === 'post' ? '<span class="mx-badge">Final</span>' : st === 'off' ? '<span class="mx-badge">Postponed</span>' : '<span class="mx-badge">Upcoming</span>';
function bxHero(e){
  const st = bxState(e), d = bxWhen(e);
  return `<button class="bx-hero is-${st}" data-bxfight="${esc(e.id)}" aria-label="${esc(`${e.name}, ${bxDay(d)}. Open the fight page`)}">
    ${e.thumb ? `<img class="bx-hero-bg" src="${esc(e.thumb)}" alt="" loading="lazy">` : ''}
    <span class="bx-hero-in"><span class="mx-top">${bxBadge(st)}<span class="mx-lg">${esc(e.series || 'Main event')}</span></span>
      <span class="bx-vs"><b>${esc(e.a)}</b><i>vs</i><b>${esc(e.b || 'TBA')}</b></span>
      ${st === 'pre' ? bxCountdown(d.getTime()) : st === 'post' && e.result ? `<span class="bx-res">${esc(e.result.split('\n')[0].slice(0, 140))}</span>` : ''}
      <span class="bx-meta"><span>${esc(bxDay(d))}${e.timed ? ' · ' + esc(bxTime(d)) : ''}</span>${bxPlace(e) ? `<span>${esc(bxPlace(e))}</span>` : ''}</span>
      <span class="ftr-foot">Tale of the tape<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></span></button>`;
}
function bxCard(e){
  const st = bxState(e), d = bxWhen(e);
  return `<button class="bx-card is-${st}" data-bxfight="${esc(e.id)}" aria-label="${esc(`${e.name}, ${bxDay(d)}`)}">
    <span class="bx-card-img">${e.thumb ? `<img src="${esc(e.thumb)}/preview" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(e.thumb)}'">` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${bxGlove}</svg>`}${bxBadge(st)}</span>
    <span class="bx-card-b">${e.series ? `<small>${esc(e.series)}</small>` : ''}<b>${esc(e.a)}</b><i>vs</i><b>${esc(e.b || 'TBA')}</b>
      <span class="bx-card-m">${esc(bxDay(d))}${e.timed && st !== 'post' ? ' · ' + esc(bxTime(d)) : ''}${e.country ? ' · ' + esc(e.venue || e.country) : ''}</span></span></button>`;
}
function bxBoutRow(b, main){
  const side = (f, r) => `<span class="bx-f${r ? ' r' : ''}${b.state === 'post' && !f.win ? ' lose' : ''}${f.win ? ' win' : ''}">${f.flag ? `<img src="${esc(f.flag)}" alt="${esc(f.country)}" loading="lazy">` : ''}<span><b>${esc(f.name || 'TBA')}</b><small>${esc(f.rec)}</small></span></span>`;
  const mid = b.state === 'in' ? `<span class="mx-badge live"><i></i>R${b.round || 1} ${esc(b.clock)}</span>` : b.state === 'post' ? `<span class="bx-how">${esc(b.how || b.detail || 'Final')}</span>` : `<span class="bx-how">${esc(bxTime(b.date))}</span>`;
  return `<button class="bx-bout${main ? ' main' : ''} is-${b.state}" data-bxbout="${esc(b.id)}" aria-label="${esc(`${b.a.name} versus ${b.b.name}, ${b.cls}`)}">${side(b.a)}<span class="bx-mid"><small>${esc(b.cls)}${b.rounds ? ` · ${b.rounds} rds` : ''}</small>${mid}</span>${side(b.b, true)}</button>`;
}
async function renderBoxing(){
  const el = $('bx'); if (!el) return;
  bxRail();
  const head = `<div class="livebar"><h2>Fight night</h2><span class="count">${S.bx.tab === 'ufc' ? 'UFC' : 'Boxing'}</span></div>
    <div class="filters"><div class="seg" role="tablist" aria-label="Combat sport">${[['boxing', 'Boxing'], ['ufc', 'UFC']].map(([k, l]) => `<button role="tab" class="${S.bx.tab === k ? 'on' : ''}" aria-selected="${S.bx.tab === k}" data-bxtab="${k}">${l}</button>`).join('')}</div></div>`;
  const paint = () => {
    if (S.sport !== 'boxing') return;
    if (S.bx.tab === 'ufc') { const u = S.bx.ufc;
      if (!u) { el.innerHTML = head + '<div class="skel" style="height:320px"></div>'; return }
      const ev = u.events.find(e => e.state !== 'post') || u.events[0];
      if (!ev) { el.innerHTML = head + `<div class="empty-state"><strong>${S.bx.ufcErr ? 'Could not load the UFC card' : 'No UFC card this week'}</strong>${u.cal.filter(c => c.date > Date.now()).slice(0, 4).map(c => `${esc(c.label)} · ${esc(bxDay(c.date))}`).join('<br>')}</div>`; return }
      const main = ev.bouts[0], next = u.cal.filter(c => c.date > ev.date.getTime() + 864e5).slice(0, 6);
      el.innerHTML = head + `<div class="bx-hero is-${ev.state} flat"><span class="bx-hero-in"><span class="mx-top">${bxBadge(ev.state)}<span class="mx-lg">${esc(ev.short || 'UFC')}</span></span>
          <span class="bx-vs"><b>${esc(main?.a.name || ev.name)}</b>${main ? `<i>vs</i><b>${esc(main.b.name)}</b>` : ''}</span>${ev.state === 'pre' ? bxCountdown(ev.date.getTime()) : ''}
          <span class="bx-meta"><span>${esc(bxDay(ev.date))} · ${esc(bxTime(ev.date))}</span>${ev.venue ? `<span>${esc(ev.venue)}</span>` : ''}</span></span></div>
        <div class="group"><div class="group-h"><strong>Fight card</strong><span>${ev.bouts.length} bouts</span></div><div class="bx-bouts">${ev.bouts.map((b, i) => bxBoutRow(b, i === 0)).join('')}</div></div>
        ${next.length ? `<div class="group"><div class="group-h"><strong>Coming up</strong></div><div class="bx-cal">${next.map(c => `<div><b>${esc(c.label)}</b><small>${esc(bxDay(c.date))}</small></div>`).join('')}</div></div>` : ''}`;
      return }
    const all = S.bx.cards;
    if (!all) { el.innerHTML = head + '<div class="skel" style="height:320px"></div><div class="skel"></div>'; return }
    const up = all.filter(e => ['pre', 'in'].includes(bxState(e))).sort((a, b) => bxWhen(a) - bxWhen(b)), done = all.filter(e => bxState(e) === 'post').sort((a, b) => bxWhen(b) - bxWhen(a));
    if (!all.length) { el.innerHTML = head + `<div class="empty-state"><strong>${S.bx.err ? 'Could not load the fight calendar' : 'No fight nights listed'}</strong>${S.bx.err ? 'Boxing needs the Floodlight server. It retries when you come back to this page.' : 'Nothing on the calendar for the next few weeks.'}</div>`; return }
    const lead = up[0];
    el.innerHTML = head + (lead ? bxHero(lead) : '')
      + (up.length > 1 ? `<div class="group"><div class="group-h"><strong>Upcoming fight nights</strong><span>${up.length - 1}</span></div><div class="bx-grid">${up.slice(1).map(bxCard).join('')}</div></div>` : '')
      + (done.length ? `<div class="group"><div class="group-h"><strong>Results</strong><span>${done.length}</span></div><div class="bx-grid">${done.slice(0, 12).map(bxCard).join('')}</div></div>` : '')
      + `<p class="srcnote">Fight calendar from TheSportsDB. Records and measurements on each fight page come from Wikipedia.</p>`;
  };
  paint();
  await (S.bx.tab === 'ufc' ? bxLoadUfc() : bxLoad()); paint();
}
function bxRail(){
  const r = $('rail'); if (!r) return;
  r.innerHTML = `<h4>Fight night</h4>${[['boxing', 'Boxing'], ['ufc', 'UFC']].map(([k, l]) => `<button class="lg${S.bx.tab === k ? ' on' : ''}" data-bxtab="${k}"><span class="dot">●</span><span>${l}</span></button>`).join('')}`;
}

/* ---------- fight pages ---------- */
function bxOpenFight(id){ const e = (S.bx.cards || []).find(x => x.id === id); if (!e) return; pushView({ type: 'bxfight', id, e, tab: 'tape' }) }
function bxOpenBout(id){ const b = (S.bx.ufc?.events || []).flatMap(e => e.bouts).find(x => x.id === id); if (!b) return; pushView({ type: 'bxbout', id, b, tab: 'tape' }) }
function bxOpenFighter(name){ if (name) pushView({ type: 'bxfighter', id: name.toLowerCase(), name, tab: 'overview' }) }

// the two corners in one shape, whichever sport they come from
function bxCorners(v){
  if (v.type === 'bxbout') { const mk = f => { const a = bxAthlete(f.id), [w, l, d] = (f.rec || '').split('-').map(Number);
      return { name: f.name, loading: a === null, photo: a?.photo || f.photo, flag: f.flag, sub: [f.country, a?.nickname ? `“${a.nickname}”` : ''].filter(Boolean).join(' · '), rec: f.rec, wins: isNaN(w) ? null : w, losses: isNaN(l) ? null : l, draws: d || 0, ko: null,
        age: a?.age, heightT: a?.height || '', reachT: a?.reach || '', stance: a?.stance || '', division: a?.division || '', win: f.win } };
    return [mk(v.b.a), mk(v.b.b)] }
  const mk = n => { const f = bxFighter(n); return { name: f?.found ? f.name : n, key: n, loading: f === null, found: !!f?.found, photo: f?.photo || '', sub: [f?.nationality, f?.nickname ? `“${f.nickname}”` : ''].filter(Boolean).join(' · '), rec: bxRec(f), wins: f?.wins ?? null, losses: f?.losses ?? null, draws: f?.draws || 0, ko: f?.ko ?? null,
    age: f?.age, height: f?.height, reach: f?.reach, heightT: bxLen(f?.height), reachT: bxReach(f?.reach), stance: f?.stance || '', division: f?.division || '' } };
  return [mk(v.e.a), mk(v.e.b)];
}
function bxFightHero(v, back){
  const [A, B] = bxCorners(v), box = v.type === 'bxfight', st = box ? bxState(v.e) : v.b.state, d = box ? bxWhen(v.e) : v.b.date;
  const corner = (f, r) => `<div class="bx-corner${r ? ' r' : ''}${st === 'post' && f.win === false ? ' lose' : ''}"><span class="bx-ph">${f.photo ? `<img src="${esc(f.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">${bxGlove}</svg></span>
    <strong>${box && f.key ? `<button class="linkbtn" data-bxfighter="${esc(f.key)}">${esc(f.name)}</button>` : esc(f.name)}</strong>${f.rec ? `<b class="bx-rec num">${esc(f.rec)}</b>` : ''}${f.sub ? `<small>${esc(f.sub)}</small>` : ''}</div>`;
  return `<div class="hero bx-stage is-${st}">${topBar(back)}
    <div class="bx-stage-top">${bxBadge(st)}<span class="mx-lg">${esc(box ? (v.e.series || 'Boxing') : `${v.b.cls}${v.b.rounds ? ` · ${v.b.rounds} rounds` : ''}`)}</span></div>
    <div class="bx-face">${corner(A)}<div class="bx-centre"><i>VS</i>${st === 'pre' ? bxCountdown(d.getTime()) : st === 'in' ? `<span class="pill live">${box ? 'On now' : `Round ${v.b.round || 1} · ${esc(v.b.clock)}`}</span>` : `<span class="bx-how">${esc(box ? 'Final' : v.b.how || 'Final')}</span>`}</div>${corner(B, true)}</div>
    <div class="meta-row"><span>${esc(bxDay(d))} · ${esc(bxTime(d))}</span>${box && bxPlace(v.e) ? `<span>${esc(bxPlace(v.e))}</span>` : ''}${!box && v.b.tv ? `<span>TV: ${esc(v.b.tv)}</span>` : ''}</div></div>`;
}
function bxTape(v){
  const [A, B] = bxCorners(v);
  if (A.loading || B.loading) return '<div class="skel" style="height:300px"></div>';
  const ko = f => f.wins ? (f.ko != null ? Math.round(f.ko / f.wins * 100) : null) : null;
  const rows = [['Record', A.rec, B.rec, A.wins != null && B.wins != null ? [A.wins - (A.losses || 0), B.wins - (B.losses || 0)] : null], ['Knockouts', A.ko ?? '', B.ko ?? '', A.ko != null && B.ko != null ? [A.ko, B.ko] : null],
    ['KO rate', ko(A) != null ? ko(A) + '%' : '', ko(B) != null ? ko(B) + '%' : '', ko(A) != null && ko(B) != null ? [ko(A), ko(B)] : null], ['Age', A.age ?? '', B.age ?? '', null],
    ['Height', A.heightT, B.heightT, A.height && B.height ? [A.height, B.height] : null], ['Reach', A.reachT, B.reachT, A.reach && B.reach ? [A.reach, B.reach] : null], ['Stance', A.stance, B.stance, null], ['Division', A.division, B.division, null]]
    .filter(r => r[1] !== '' || r[2] !== '');
  if (!rows.length) return `<div class="note">No measurements on record for these two fighters yet.</div>`;
  return `<div class="bx-tape"><div class="bx-tape-h"><b>${esc(bxSur(A.name))}</b><span>Tale of the tape</span><b>${esc(bxSur(B.name))}</b></div>
    ${rows.map(([k, a, b, cmp], i) => { const w = cmp ? (cmp[0] > cmp[1] ? 'a' : cmp[1] > cmp[0] ? 'b' : '') : '';
      return `<div class="bx-tape-r" style="--i:${i}"><b class="num${w === 'a' ? ' up' : ''}">${esc(a === '' ? '–' : a)}</b><span>${k}</span><b class="num${w === 'b' ? ' up' : ''}">${esc(b === '' ? '–' : b)}</b></div>` }).join('')}</div>
    ${v.type === 'bxfight' && (!A.found || !B.found) ? `<p class="srcnote">${[A, B].filter(f => !f.found).map(f => esc(f.name)).join(' and ')} could not be matched to a Wikipedia page, so that corner is blank.</p>` : ''}
    <p class="srcnote">${v.type === 'bxfight' ? 'Records and measurements from Wikipedia. Tap a name for the full profile.' : 'Records and measurements from ESPN.'}</p>`;
}
// a plain reading of the two records: win rate, stoppage power and experience. No market, no form.
function bxPredict(A, B){
  if (A.wins == null || B.wins == null) return null;
  const s = f => { const n = f.wins + (f.losses || 0) + (f.draws || 0), wr = (f.wins + 2) / (n + 4), kr = f.ko != null && f.wins ? f.ko / f.wins : .5; return wr * (1 + .18 * kr) * (1 + Math.min(n, 30) / 150) };
  let p = s(A) ** 3 / (s(A) ** 3 + s(B) ** 3);
  if (A.reach && B.reach) p += Math.max(-.03, Math.min(.03, (A.reach - B.reach) * .003));
  p = Math.max(.08, Math.min(.92, p)); const top = Math.max(p, 1 - p);
  return { pH: p, pick: p >= .5 ? 'home' : 'away', top, conf: top >= .7 ? 'Strong' : top >= .58 ? 'Lean' : 'Toss-up' };
}
function bxPredPane(v){
  const [A, B] = bxCorners(v); if (A.loading || B.loading) return '<div class="skel" style="height:300px"></div>';
  const P = bxPredict(A, B); if (!P) return `<div class="note">Not enough on record to call this one: a fight record is missing for at least one corner.</div>`;
  const st = v.type === 'bxfight' ? bxState(v.e) : v.b.state, fav = P.pick === 'home' ? A : B, dog = P.pick === 'home' ? B : A;
  const actual = v.type === 'bxbout' && st === 'post' ? (v.b.a.win ? 'home' : v.b.b.win ? 'away' : null) : null;
  const F = []; const n = f => f.wins + (f.losses || 0) + (f.draws || 0), wr = f => Math.round(f.wins / Math.max(1, n(f)) * 100);
  F.push({ ico: 'table', side: wr(A) === wr(B) ? '' : wr(A) > wr(B) ? 'home' : 'away', title: 'Records', text: `${A.name} is ${A.rec} (${wr(A)}% wins). ${B.name} is ${B.rec} (${wr(B)}% wins).` });
  if (A.ko != null && B.ko != null && A.wins && B.wins) { const ka = Math.round(A.ko / A.wins * 100), kb = Math.round(B.ko / B.wins * 100); F.push({ ico: 'star', side: ka === kb ? '' : ka > kb ? 'home' : 'away', title: 'Stopping power', text: `${A.name} has finished ${ka}% of wins inside the distance, ${B.name} ${kb}%.` }) }
  if (A.reach && B.reach && A.reach !== B.reach) F.push({ ico: 'form', side: A.reach > B.reach ? 'home' : 'away', title: 'Reach', text: `${(A.reach > B.reach ? A : B).name} has ${Math.abs(A.reach - B.reach)} cm more reach.` });
  if (n(A) !== n(B)) F.push({ ico: 'rest', side: n(A) > n(B) ? 'home' : 'away', title: 'Experience', text: `${n(A)} professional fights against ${n(B)}.` });
  if (A.age && B.age && Math.abs(A.age - B.age) >= 3) F.push({ ico: 'info', title: 'Age', text: `${A.name} is ${A.age}, ${B.name} is ${B.age}.` });
  const mk = (f, col) => ({ name: f.name, short: bxSur(f.name), logo: f.flag || '', col });
  return flPred({ key: 'box:' + v.id, home: mk(A, 'var(--tint)'), away: mk(B, 'var(--fg)'), probs: { home: P.pH, away: 1 - P.pH }, pick: P.pick, pickLabel: fav.name + ' to win', conf: P.conf,
    line: P.top >= .7 ? `${fav.name} is the clear favourite on paper.` : P.top >= .58 ? `${fav.name} has the better record, but ${dog.name} is live.` : 'Very little between them on paper.', factors: F,
    final: actual ? { actual, text: v.b.how } : null }) + `<p class="srcnote">This call reads only the two records: win rate, stoppages, experience and reach. It does not know about form, style, injuries or the betting market, so treat it as a starting point.</p>${RG}`;
}
function bxCardPane(v){
  if (v.type === 'bxbout') { const ev = (S.bx.ufc?.events || []).find(e => e.bouts.includes(v.b)); return ev ? `<div class="bx-bouts">${ev.bouts.map((b, i) => bxBoutRow(b, i === 0)).join('')}</div>` : '' }
  const e = v.e;
  return `${e.poster ? `<img class="bx-poster" src="${esc(e.poster)}" alt="${esc(e.name)} poster" loading="lazy">` : ''}
    ${e.result ? `<div class="sub-h"><h5>Result</h5></div><p class="bx-text">${esc(e.result).replace(/\n+/g, '<br>')}</p>` : ''}
    ${e.desc ? `<div class="sub-h"><h5>The card</h5></div><p class="bx-text">${esc(e.desc).replace(/\n+/g, '<br>')}</p>` : !e.result ? `<div class="note">The full card has not been published for this fight night yet.</div>` : ''}`;
}
function bxFighterSheet(v, back){
  const f = bxFighter(v.name);
  if (f === null) return { hero: `<div class="hero solo">${topBar(back)}<div class="skel" style="height:160px"></div></div>`, body: '' };
  if (!f.found) return { hero: `<div class="hero solo">${topBar(back)}<div class="thead"><div><h3>${esc(v.name)}</h3></div></div></div>`, body: `<div class="note">No Wikipedia profile could be matched to this name.</div>` };
  const n = (f.wins || 0) + (f.losses || 0) + (f.draws || 0), dec = Math.max(0, (f.wins || 0) - (f.ko || 0));
  const hero = `<div class="hero bx-stage bx-prof">${topBar(back)}<div class="bx-prof-in"><span class="bx-ph big">${f.photo ? `<img src="${esc(f.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">${bxGlove}</svg></span>
      <div><small class="pr-k">${esc([f.nationality, f.stance].filter(Boolean).join(' · '))}</small><h3>${esc(f.name)}</h3>${f.nickname ? `<p>“${esc(f.nickname)}”</p>` : ''}<b class="bx-rec num big">${esc(bxRec(f))}</b><small>${f.ko != null ? `${f.ko} by knockout` : ''}</small></div></div></div>`;
  const tiles = [['Fights', n || '–'], ['Wins', f.wins ?? '–'], ['By KO', f.ko ?? '–'], ['KO rate', bxKoPct(f) != null ? bxKoPct(f) + '%' : '–'], ['Losses', f.losses ?? '–'], ['Draws', f.draws ?? 0]];
  const body = `<div class="tiles">${tiles.map(([l, x]) => `<div class="tile"><b class="num">${esc(x)}</b><span>${l}</span></div>`).join('')}</div>
    ${n ? `<div class="sub-h"><h5>How the fights ended</h5></div><div class="h2h-bar bx-split" role="img" aria-label="${f.ko || 0} knockout wins, ${dec} decision wins, ${f.losses || 0} losses, ${f.draws || 0} draws">${[[f.ko, 'var(--tint)'], [dec, 'var(--fg)'], [f.draws, 'var(--line-2)'], [f.losses, 'var(--muted)']].map(([x, c]) => x ? `<i style="flex:${x};background:${c}"></i>` : '').join('')}</div>
      <div class="sfx-legend">${[[f.ko, 'var(--tint)', 'KO wins'], [dec, 'var(--fg)', 'Decision wins'], [f.draws, 'var(--line-2)', 'Draws'], [f.losses, 'var(--muted)', 'Losses']].filter(x => x[0]).map(([x, c, l]) => `<span><i style="background:${c}"></i>${x} ${l}</span>`).join('')}</div>` : ''}
    <div class="sub-h"><h5>Tale of the tape</h5></div><div class="bx-facts">${[['Age', f.age], ['Born', f.born ? new Date(f.born + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : ''], ['From', f.birthplace], ['Height', bxLen(f.height)], ['Reach', bxReach(f.reach)], ['Stance', f.stance], ['Divisions', f.division]]
      .filter(x => x[1]).map(([k, x]) => `<div><span>${k}</span><b>${esc(x)}</b></div>`).join('')}</div>
    <p class="srcnote">From <a href="${esc(f.url)}" target="_blank" rel="noopener">Wikipedia</a>.</p>`;
  return { hero, body };
}
function bxRenderSheet(v){
  const sheet = $('sheet'), back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  if (v.type === 'bxfighter') { const { hero, body } = bxFighterSheet(v, back); S.curTabs = []; sheet.innerHTML = `<div class="sheet-body">${hero}<div class="pane" id="pane">${body}</div></div>` }
  else { const tabs = [['tape', 'Tale of the tape'], ['card', 'Fight card'], ['pred', 'Prediction']]; if (!tabs.some(t => t[0] === v.tab)) v.tab = 'tape'; S.curTabs = tabs;
    sheet.innerHTML = `<div class="sheet-body">${bxFightHero(v, back)}${tabsHTML(tabs, v.tab)}<div class="pane" id="pane" role="tabpanel">${v.tab === 'pred' ? bxPredPane(v) : v.tab === 'card' ? bxCardPane(v) : bxTape(v)}</div></div>` }
  sheet.querySelector('.sheet-body').scrollTop = scroll;
}

/* ---------- hooks into the main app ---------- */
(function bxInstall(){
  const sw = document.querySelector('.sport-sw');
  if (sw && !sw.querySelector('[data-sport="boxing"]')) sw.insertAdjacentHTML('beforeend', `<button role="tab" data-sport="boxing" class="sp-boxing">Boxing</button>`);
  if (!$('bx')) { const sec = document.createElement('section'); sec.id = 'bx'; sec.hidden = true; sec.setAttribute('aria-label', 'Boxing'); const sheet = $('sheet'); sheet.parentNode.insertBefore(sec, sheet) }
  if (typeof STAGE !== 'undefined') ['bxfight', 'bxbout', 'bxfighter'].forEach(t => STAGE.add(t));
  const _render = render;
  render = function(){
    if (S.sport !== 'boxing') { $('bx').hidden = true; return _render.apply(this, arguments) }
    document.querySelectorAll('.sport-sw button').forEach(b => { const on = b.dataset.sport === 'boxing'; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) });
    document.querySelectorAll('main.shell > section').forEach(s => { s.hidden = s.id !== 'bx' });
    document.querySelector('.shell').classList.remove('mk-page'); const tk = $('ticker'); if (tk) tk.hidden = true;
    renderBoxing();
  };
  const _sheet = renderSheet;
  renderSheet = function(){ const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('bx')) { if (typeof syncStage === 'function') syncStage(); return bxRenderSheet(v) } return _sheet.apply(this, arguments) };
  const _search = searchAll;
  searchAll = function(q){ if (S.sport !== 'boxing') return _search.apply(this, arguments);
    const box = $('sres'); if (!box) return; q = q.trim().toLowerCase(); if (q.length < 2) { box.hidden = true; return }
    const hits = (S.bx.cards || []).filter(e => e.name.toLowerCase().includes(q)).slice(0, 8), bouts = (S.bx.ufc?.events || []).flatMap(e => e.bouts).filter(b => `${b.a.name} ${b.b.name}`.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = (hits.length ? '<div class="sr-h">Boxing</div>' + hits.map(e => `<button class="sr" data-bxfight="${esc(e.id)}"><div><strong>${esc(e.a)} v ${esc(e.b)}</strong><small>${esc(bxDay(bxWhen(e)))}</small></div></button>`).join('') : '')
      + (bouts.length ? '<div class="sr-h">UFC</div>' + bouts.map(b => `<button class="sr" data-bxbout="${esc(b.id)}"><div><strong>${esc(b.a.name)} v ${esc(b.b.name)}</strong><small>${esc(b.cls)}</small></div></button>`).join('') : '') || `<div class="sr-none">No fights match “${esc(q)}”.</div>`;
    box.hidden = false };
  const _openLeague = openLeague;
  openLeague = function(){ if (S.sport === 'boxing') return; return _openLeague.apply(this, arguments) };
})();
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-bxtab],[data-bxfight],[data-bxbout],[data-bxfighter]'); if (!t) return;
  ev.stopPropagation(); if (typeof hideResults === 'function') hideResults();
  if (t.dataset.bxtab === 'ufc' && typeof setSport === 'function') return setSport('ufc');   // UFC is its own sport now (ufc.js)
  if (t.dataset.bxtab) { S.bx.tab = t.dataset.bxtab; store.set('fl.bxTab', S.bx.tab); window.scrollTo({ top: 0 }); return render() }
  if (t.dataset.bxfighter) return bxOpenFighter(t.dataset.bxfighter);
  if (t.dataset.bxfight) return bxOpenFight(t.dataset.bxfight);
  if (t.dataset.bxbout) return bxOpenBout(t.dataset.bxbout);
}, true);
setInterval(() => { if (document.hidden || S.sport !== 'boxing' || S.bx.tab !== 'ufc') return;
  if (S.bx.ufc?.events.some(e => e.state === 'in' || (e.state === 'pre' && e.date < Date.now() + 15 * 6e4))) bxLoadUfc(true).then(() => { if (!S.stack.length) renderBoxing(); else { const v = S.stack[0]; if (v?.type === 'bxbout') { const nb = S.bx.ufc.events.flatMap(e => e.bouts).find(b => b.id === v.id); if (nb) { v.b = nb; renderSheet() } } } }) }, 20000);
