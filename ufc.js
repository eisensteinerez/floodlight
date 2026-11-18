/* Floodlight · UFC, a sport of its own, organised by events and fight nights rather than by date.
   Events page: the next event as a hero with a countdown, the upcoming events, and every past event back to 2014,
   browsable by year and searchable by event or fighter. Event page: the card in its segments (Main Card, Prelims,
   Early Prelims) with photos, records, weight class and title badges; before, live and after states.
   Fight page: Tale of the Tape, prediction (method and round), and round-by-round strike stats with a body map.
   Fighter page: photo, nickname, record, method split and a fight-history timeline.
   Data: ESPN's public MMA feeds, read directly (scoreboard by year for the schedule and results, fightcenter for
   one event's full card, athletes for a fighter). Every photo falls back to a silhouette with the fighter's initials. */
const UFC_SB = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const UFC_FC = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/fightcenter/';
const UFC_ATH = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/athletes/';
const UFC_FIRST_YEAR = 2014;
S.ufc = { years: new Map(), loading: new Set(), fc: new Map(), ath: new Map(), year: new Date().getFullYear(), q: '', err: false };

/* ---------- facts ---------- */
const ufcIni = n => String(n || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const ufcShot = id => id ? `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png` : '';
// a photo that never breaks: on error it becomes the premium silhouette with initials
function ufcFace(f, cls = 'ufc-face', eager){
  const src = f?.photo || ufcShot(f?.id), ini = esc(ufcIni(f?.name));
  const ph = `<span class="${cls} ufc-sil" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="15" r="7.5"/><path d="M5 40c0-9 7-14 15-14s15 5 15 14z"/></svg><b>${ini}</b></span>`;
  if (!src) return ph;
  return `<img class="${cls}" src="${esc(src)}" alt="" ${eager ? '' : 'loading="lazy"'} decoding="async" onerror="this.outerHTML=this.dataset.ph" data-ph="${esc(ph)}">`;
}
const ufcDay = d => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
const ufcTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ufcNumbered = name => /^UFC \d+/.test(name || '');

// one event from the scoreboard feed (fights in card order: ESPN lists the main event last)
function ufcNormEvent(ev){
  const bouts = (ev.competitions || []).map(c => {
    const cs = [...(c.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0)), st = c.status?.type || {};
    const f = x => ({ id: String(x?.athlete?.id || x?.id || ''), name: x?.athlete?.displayName || '', flag: x?.athlete?.flag?.href || '', country: x?.athlete?.flag?.alt || '', rec: x?.records?.[0]?.summary || '', win: !!x?.winner });
    return { id: String(c.id), a: f(cs[0]), b: f(cs[1]), cls: c.type?.abbreviation || c.type?.text || '', rounds: c.format?.regulation?.periods || 3, state: st.state || 'pre', detail: st.shortDetail || '',
      round: c.status?.period || 0, clock: c.status?.displayClock || '', date: new Date(c.date || ev.date) };
  }).reverse();
  const v = ev.competitions?.[0]?.venue || {}, state = bouts.some(b => b.state === 'in') ? 'in' : bouts.length && bouts.every(b => b.state === 'post') ? 'post' : 'pre';
  return { id: String(ev.id), name: ev.name || 'UFC', short: ev.shortName || '', date: new Date(ev.date), end: new Date(ev.endDate || ev.date), state, bouts, main: bouts[0],
    venue: v.fullName || '', city: [v.address?.city, v.address?.state, v.address?.country].filter(Boolean).join(', '), year: new Date(ev.date).getFullYear() };
}
async function ufcLoadYear(y, force){
  const cur = S.ufc.years.get(y);
  if (!force && cur && (y < new Date().getFullYear() || Date.now() - cur.at < 60000)) return cur;
  if (S.ufc.loading.has(y)) return cur;
  S.ufc.loading.add(y);
  try { const d = await getJSON(`${UFC_SB}?dates=${y}`); const r = { events: (d.events || []).map(ufcNormEvent).sort((a, b) => a.date - b.date), at: Date.now() }; S.ufc.years.set(y, r); S.ufc.err = false; return r }
  catch { S.ufc.err = true; return cur } finally { S.ufc.loading.delete(y) }
}
const ufcAll = () => [...S.ufc.years.values()].flatMap(y => y.events).sort((a, b) => a.date - b.date);
const ufcNext = () => ufcAll().find(e => e.state !== 'post' && e.end > Date.now() - 6 * 36e5);
function ufcFindEvent(id){ return ufcAll().find(e => e.id === String(id)) }

// one event's full card from fightcenter: segments, title flags, method, per-fighter stats and profiles
async function ufcLoadCard(id, force){
  const cur = S.ufc.fc.get(id); if (!force && cur && (cur.state === 'post' || Date.now() - cur.at < 20000)) return cur;
  try {
    const d = await getJSON(`${UFC_FC}${id}?region=us&lang=en`);
    const segs = Object.values(d.cards || {}).map(s => ({ key: s.cardSegment || s.name, name: s.displayName || s.name, fights: (s.competitions || []).map(c => {
      const st = c.status || {}, cs = [...(c.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      const f = x => { const a = x?.athlete || {}; return { id: String(a.id || x?.id || ''), name: a.displayName || '', photo: a.headshot?.href || ufcShot(a.id), stance: a.images?.find(i => i.rel?.includes('rightStance'))?.href || '',
        flag: a.flag?.href || '', country: a.country || a.flag?.alt || '', rec: x?.displayRecord || '', win: !!x?.winner, age: a.age ?? null, height: a.displayHeight || '', reach: a.displayReach || '', weight: a.displayWeight || '',
        stanceText: a.stance?.text || '', cls: a.weightClass?.text || '', col: a.color || '', stats: Object.fromEntries((x?.stats || []).map(s => [s.name, s.displayValue])) } };
      const title = (c.types || []).find(t => /title/i.test(t.text || '')) || (/title fight/i.test(c.note || '') ? { text: 'Title fight' } : null);
      return { id: String(c.id), a: f(cs[0]), b: f(cs[1]), cls: c.type?.text || '', note: c.note || '', title: title?.text || '', main: /main event/i.test(c.note || ''), co: /co-main/i.test(c.note || ''),
        state: st.type?.state || 'pre', detail: st.type?.shortDetail || '', round: st.period || 0, clock: st.displayClock || '', date: new Date(c.date),
        how: st.result ? { name: st.result.displayName || '', desc: st.result.displayDescription || st.result.description || '', target: st.result.target?.displayDescription || '' } : null,
        rounds: /title|main event/i.test((c.note || '') + (title?.text || '')) ? 5 : 3 } }) }))
      .filter(s => s.fights.length);
    // the segment order ESPN uses varies; main card first, then prelims, then early prelims
    const ord = s => /main/i.test(s.key + s.name) ? 0 : /early/i.test(s.name) ? 2 : 1; segs.sort((a, b) => ord(a) - ord(b));
    const fights = segs.flatMap(s => s.fights);
    const r = { id, name: d.event?.name || '', date: new Date(d.event?.date || Date.now()), venue: d.venue?.displayNameLocation || d.venue?.fullName || '', segs, fights,
      state: fights.some(f => f.state === 'in') ? 'in' : fights.length && fights.every(f => f.state === 'post') ? 'post' : 'pre', at: Date.now() };
    S.ufc.fc.set(id, r); return r;
  } catch { const r = cur || { id, error: true, segs: [], fights: [], at: Date.now() }; S.ufc.fc.set(id, r); return r }
}
function ufcAthlete(id){
  if (!id) return null;
  if (!S.ufc.ath.has(id)) { S.ufc.ath.set(id, null);
    getJSON(UFC_ATH + id).then(d => { const a = d.athlete || d, ss = Object.fromEntries((a.statsSummary?.statistics || []).map(s => [s.name, s.displayValue]));
      S.ufc.ath.set(id, { found: true, id, name: a.displayName, nick: a.nickname || '', photo: a.headshot?.href || ufcShot(id), age: a.age ?? null, dob: a.displayDOB || '', height: a.displayHeight || '', weight: a.displayWeight || '', reach: a.displayReach || '',
        stance: a.stance?.text || '', cls: a.weightClass?.text || '', country: a.citizenship || a.flag?.alt || '', flag: a.flag?.href || '', camp: a.association?.name || '', style: a.displayFightingStyle || '',
        rec: ss['wins-losses-draws'] || '', ko: ss['tkos-tkoLosses'] || '', sub: ss['submissions-submissionLosses'] || '', active: a.active !== false }) })
      .catch(() => S.ufc.ath.set(id, { found: false, id })).finally(() => { const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('ufc')) renderSheet() }) }
  return S.ufc.ath.get(id);
}
const ufcSplit = s => { const m = String(s || '').match(/(\d+)\s*[-–]\s*(\d+)/); return m ? [+m[1], +m[2]] : [null, null] };
const ufcRec = s => { const m = String(s || '').match(/(\d+)-(\d+)(?:-(\d+))?/); return m ? { w: +m[1], l: +m[2], d: +(m[3] || 0) } : null };
const ufcInch = s => { const m = String(s || '').match(/(\d+)'\s*(\d+)?/); if (m) return +m[1] * 12 + +(m[2] || 0); const n = parseFloat(s); return isFinite(n) ? n : null };

/* ---------- countdown ---------- */
function ufcCountdown(ts){
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000)), u = [['Days', Math.floor(s / 86400)], ['Hrs', Math.floor(s / 3600) % 24], ['Min', Math.floor(s / 60) % 60], ['Sec', s % 60]];
  return `<div class="bx-cd ufc-cd" data-bxcd="${+ts}" role="timer" aria-label="Time until the first fight">${u.map(([l, v]) => `<span><b class="num">${String(v).padStart(2, '0')}</b><small>${l}</small></span>`).join('')}</div>`;
}

/* ---------- the events page ---------- */
function ufcHero(e){
  const m = e.main || {}, A = m.a || {}, B = m.b || {};
  return `<section class="ufc-hero is-${e.state}" aria-label="${esc(e.name)}">
    <div class="ufc-hero-bg" aria-hidden="true"></div>
    <div class="ufc-hero-f l">${ufcFace(A, 'ufc-hero-img', true)}</div><div class="ufc-hero-f r">${ufcFace(B, 'ufc-hero-img', true)}</div>
    <div class="ufc-hero-in"><span class="ufc-k">${e.state === 'in' ? '<span class="hub-live-b"><i></i>Live now</span>' : 'Next event'}</span>
      <h2>${esc(e.name.replace(/:.*/, ''))}</h2>${/:/.test(e.name) ? `<p class="ufc-hero-sub">${esc(e.name.replace(/^[^:]*:\s*/, ''))}</p>` : ''}
      <div class="ufc-hero-vs"><span><b>${esc(A.name || 'TBA')}</b><small>${esc(A.rec || '')}</small></span><i>VS</i><span><b>${esc(B.name || 'TBA')}</b><small>${esc(B.rec || '')}</small></span></div>
      <p class="ufc-cls">${esc(m.cls || '')}${m.rounds ? ` · ${m.rounds} rounds` : ''}</p>
      ${e.state === 'pre' ? ufcCountdown(+e.date) : ''}
      <p class="ufc-meta">${esc(ufcDay(e.date))} · ${esc(ufcTime(e.date))}${e.venue ? ' · ' + esc(e.venue) : ''}${e.city ? ', ' + esc(e.city) : ''}</p>
      <button class="btn ufc-cta" data-ufcev="${esc(e.id)}">Open fight card</button></div></section>`;
}
function ufcEventCard(e, i = 0){
  const m = e.main || {}, A = m.a || {}, B = m.b || {}, w = A.win ? A : B.win ? B : null;
  return `<button class="ufc-ev is-${e.state}${ufcNumbered(e.name) ? ' num' : ''}" data-ufcev="${esc(e.id)}" style="--i:${Math.min(i, 12)}" aria-label="${esc(`${e.name}, ${ufcDay(e.date)}`)}">
    <span class="ufc-ev-faces">${ufcFace(A, 'ufc-ev-face')}${ufcFace(B, 'ufc-ev-face')}</span>
    <span class="ufc-ev-b"><small>${esc(ufcDay(e.date))}${e.state === 'in' ? ' · <em class="lv">Live</em>' : ''}</small><b>${esc(e.name.replace(/:.*/, ''))}</b>
      <span class="ufc-ev-m">${esc(A.name || 'TBA')} <i>vs</i> ${esc(B.name || 'TBA')}</span>
      ${e.state === 'post' && w ? `<span class="ufc-ev-w">✓ ${esc(w.name)}</span>` : `<span class="ufc-ev-v">${esc([e.venue, e.city].filter(Boolean).join(' · '))}</span>`}</span>
    <span class="ufc-ev-n num">${e.bouts.length}<small>fights</small></span></button>`;
}
async function renderUfc(){
  const el = $('ufc'); if (!el) return;
  const y = new Date().getFullYear();
  const paint = () => {
    if (S.sport !== 'ufc') return;
    const all = ufcAll(), next = ufcNext(), now = Date.now();
    const upcoming = all.filter(e => e !== next && e.state !== 'post' && e.date > now - 6 * 36e5);
    const q = S.ufc.q.trim().toLowerCase();
    const past = (S.ufc.years.get(S.ufc.year)?.events || []).filter(e => e.state === 'post' || e.date < now - 12 * 36e5).filter(e => !q || e.name.toLowerCase().includes(q) || e.bouts.some(b => `${b.a.name} ${b.b.name}`.toLowerCase().includes(q))).reverse();
    const years = Array.from({ length: y - UFC_FIRST_YEAR + 1 }, (_, i) => y - i);
    el.innerHTML = `<div class="livebar"><h2>UFC</h2><span class="count">Events and fight nights</span></div>
      ${next ? ufcHero(next) : S.ufc.years.has(y) ? `<div class="hub-empty"><b>No UFC event scheduled yet</b><span>${S.ufc.err ? 'Could not reach the schedule. It retries shortly.' : 'Check back soon.'}</span></div>` : '<div class="skel" style="height:360px;border-radius:22px"></div>'}
      ${upcoming.length ? `<div class="group"><div class="group-h"><strong>Upcoming events</strong><span>· ${upcoming.length}</span></div><div class="ufc-evs">${upcoming.slice(0, 12).map(ufcEventCard).join('')}</div></div>` : ''}
      <div class="group ufc-past"><div class="group-h"><strong>Past events</strong><span>· browse every card back to ${UFC_FIRST_YEAR}</span></div>
        <div class="ufc-filters"><label class="search ufc-q"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="ufcQ" type="search" placeholder="Search an event or fighter" value="${esc(S.ufc.q)}" aria-label="Search past UFC events by name or fighter"></label>
          <div class="hub-chips ufc-years" role="toolbar" aria-label="Year">${years.map(k => `<button class="hub-chip${S.ufc.year === k ? ' on' : ''}" data-ufcyear="${k}" aria-pressed="${S.ufc.year === k}" style="--t:#E2263C">${k}</button>`).join('')}</div></div>
        <div class="ufc-evs">${!S.ufc.years.has(S.ufc.year) ? '<div class="skel"></div><div class="skel"></div><div class="skel"></div>' : past.length ? past.map(ufcEventCard).join('') : `<div class="hub-empty"><b>No events${q ? ` match “${esc(S.ufc.q)}”` : ''}</b><span>${q ? 'Try another name or year.' : 'Nothing finished yet this year.'}</span></div>`}</div></div>
      <p class="srcnote">Cards, results and fighter profiles from ESPN. Times are local.</p>`;
    const qi = $('ufcQ'); if (qi && S.ufc.focusQ) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length) }
  };
  paint();
  await Promise.all([ufcLoadYear(y), new Date().getMonth() === 11 ? ufcLoadYear(y + 1) : null, S.ufc.year !== y ? ufcLoadYear(S.ufc.year) : null]);
  paint();
}

/* ---------- event page ---------- */
function ufcBout(f, i){
  const side = (x, r) => { const lose = f.state === 'post' && !x.win && (f.a.win || f.b.win);
    return `<span class="ufc-fs${r ? ' r' : ''}${x.win ? ' win' : ''}${lose ? ' lose' : ''}">${ufcFace(x, 'ufc-fs-img')}<span class="ufc-fs-n">${x.win ? '<em class="ufc-crown" aria-label="Winner">★</em>' : ''}<b>${esc(x.name || 'TBA')}</b>
      <small>${x.flag ? `<img src="${esc(x.flag)}" alt="" loading="lazy">` : ''}${esc(x.rec || '')}${x.country ? ' · ' + esc(x.country) : ''}</small></span></span>` };
  const mid = f.state === 'in' ? `<span class="mx-badge live"><i></i>R${f.round || 1} · ${esc(f.clock)}</span>` : f.state === 'post' ? `<span class="ufc-how"><b>${esc(f.how?.name || f.detail || 'Final')}</b><small>${f.how?.desc && f.how.desc !== f.how.name ? esc(f.how.desc) + ' · ' : ''}R${f.round} ${esc(f.clock)}</small></span>` : `<span class="ufc-how"><b>${esc(ufcTime(f.date))}</b><small>${f.rounds} rounds</small></span>`;
  return `<button class="ufc-bout is-${f.state}${f.title ? ' title' : ''}${f.main ? ' main' : ''}" data-ufcfight="${esc(f.id)}" style="--i:${i}" aria-label="${esc(`${f.a.name} versus ${f.b.name}, ${f.cls}${f.title ? ', title fight' : ''}`)}">
    ${side(f.a)}<span class="ufc-mid"><span class="ufc-tags">${f.title ? '<span class="ufc-belt">Title fight</span>' : ''}${f.main ? '<span class="ufc-me">Main event</span>' : f.co ? '<span class="ufc-me">Co-main</span>' : ''}</span><small class="ufc-wc">${esc(f.cls)}</small>${mid}</span>${side(f.b, true)}</button>`;
}
function ufcEventSheet(v, back){
  const ev = ufcFindEvent(v.id) || {}, C = S.ufc.fc.get(v.id), name = C?.name || ev.name || 'UFC', d = C?.date || ev.date || new Date(), state = C?.state || ev.state || 'pre';
  const main = C?.fights?.find(f => f.main) || C?.fights?.[0];
  const hero = `<div class="hero solo ufc-ev-hero is-${state}">${topBar(back)}<div class="ufc-eh">
    ${main ? `<span class="ufc-eh-f l">${ufcFace(main.a, 'ufc-eh-img', true)}</span><span class="ufc-eh-f r">${ufcFace(main.b, 'ufc-eh-img', true)}</span>` : ''}
    <div class="ufc-eh-t"><span class="ufc-k">${state === 'in' ? '<span class="hub-live-b"><i></i>Live</span>' : state === 'post' ? 'Results' : 'Fight card'}</span><h3>${esc(name.replace(/:.*/, ''))}</h3>${/:/.test(name) ? `<p class="ufc-hero-sub">${esc(name.replace(/^[^:]*:\s*/, ''))}</p>` : ''}
      ${state === 'pre' ? ufcCountdown(+d) : ''}<p class="ufc-meta">${esc(ufcDay(d))} · ${esc(ufcTime(d))}${C?.venue || ev.venue ? ' · ' + esc(C?.venue || ev.venue) : ''}</p></div></div></div>`;
  let body;
  if (!C) body = `<div class="skel" style="height:420px"></div>`;
  else if (C.error && !C.fights.length) body = flErrorState("Couldn't load this card", 'ESPN did not answer. Try again in a moment.', 'ufcretry', 'Try again', 'data-ufcact');
  else body = C.segs.map(s => `<section class="ufc-seg"><h4><span>${esc(s.name)}</span><small>${s.fights.length} fight${s.fights.length === 1 ? '' : 's'}${s.fights[0] ? ' · ' + esc(ufcTime(s.fights[s.fights.length - 1].date)) : ''}</small></h4>
    <div class="ufc-bouts">${s.fights.map(ufcBout).join('')}</div></section>`).join('');
  return { hero, body };
}

/* ---------- fight page ---------- */
function ufcFightOf(v){ const C = S.ufc.fc.get(v.ev); return C?.fights?.find(f => f.id === v.id) }
function ufcTapeRow(label, a, b, opt = {}){
  const na = opt.n ? opt.n(a) : parseFloat(a), nb = opt.n ? opt.n(b) : parseFloat(b), ok = isFinite(na) && isFinite(nb) && (na || nb);
  const better = !ok || na === nb ? 0 : (na > nb) !== !!opt.low ? -1 : 1, m = ok ? Math.max(na, nb) : 1;
  return `<div class="ufc-tr${better === -1 ? ' l' : better === 1 ? ' r' : ''}"><b class="num">${esc(a || '–')}</b><span><small>${esc(label)}</small>${ok ? `<i class="bars"><em style="--w:${(na / m * 100).toFixed(0)}%"></em><em style="--w:${(nb / m * 100).toFixed(0)}%"></em></i>` : ''}</span><b class="num">${esc(b || '–')}</b></div>`;
}
function ufcTape(f){
  const A = { ...f.a, ...(ufcAthlete(f.a.id) || {}) }, B = { ...f.b, ...(ufcAthlete(f.b.id) || {}) }, ra = ufcRec(A.rec), rb = ufcRec(B.rec);
  const ko = x => ufcSplit(x.ko)[0], sb = x => ufcSplit(x.sub)[0], dec = (x, r) => r && ko(x) != null && sb(x) != null ? Math.max(0, r.w - ko(x) - sb(x)) : null;
  const pct = (x, r) => r && x != null && r.w ? Math.round(x / r.w * 100) + '%' : '–';
  const rows = [['Record', A.rec, B.rec, { n: s => { const r = ufcRec(s); return r ? r.w - r.l : NaN } }], ['Age', A.age, B.age, { low: true }], ['Height', A.height, B.height, { n: ufcInch }], ['Reach', A.reach, B.reach, { n: ufcInch }],
    ['Stance', A.stance || A.stanceText, B.stance || B.stanceText, { n: () => NaN }], ['Weight class', A.cls || f.cls, B.cls || f.cls, { n: () => NaN }],
    ['KO / TKO wins', ko(A), ko(B)], ['Submission wins', sb(A), sb(B)], ['Decision wins', dec(A, ra), dec(B, rb)], ['Finish rate', pct((ko(A) || 0) + (sb(A) || 0), ra), pct((ko(B) || 0) + (sb(B) || 0), rb)]];
  const st = f.state !== 'pre' ? [['Sig. strike accuracy', f.a.stats.sigStrikes, f.b.stats.sigStrikes, { n: s => { const [x, y] = ufcSplit(s.replace('/', '-')); return y ? x / y * 100 : NaN } }], ['Takedown accuracy', f.a.stats.takedowns, f.b.stats.takedowns, { n: s => { const [x, y] = ufcSplit(s.replace('/', '-')); return y ? x / y * 100 : NaN } }]] : [];
  return `<div class="ufc-tape"><div class="ufc-tape-h">${ufcFace(A, 'ufc-tape-img', true)}<span><b>${esc(A.name)}</b>${A.nick ? `<small>“${esc(A.nick)}”</small>` : ''}</span><i>Tale of the tape</i><span class="r"><b>${esc(B.name)}</b>${B.nick ? `<small>“${esc(B.nick)}”</small>` : ''}</span>${ufcFace(B, 'ufc-tape-img', true)}</div>
    ${[...rows, ...st].map((r, i) => ufcTapeRow(r[0], r[1] == null ? '' : String(r[1]), r[2] == null ? '' : String(r[2]), r[3]).replace('class="ufc-tr', `style="--i:${i}" class="ufc-tr`)).join('')}
    <div class="ufc-tape-links"><button class="btn ghost" data-ufcfighter="${esc(f.a.id)}">${esc(A.name)} profile</button><button class="btn ghost" data-ufcfighter="${esc(f.b.id)}">${esc(B.name)} profile</button></div></div>`;
}
// prediction: a simple, explained model from records, finish rates, age and reach; the method from how each wins
function ufcPredict(f){
  const A = { ...f.a, ...(ufcAthlete(f.a.id) || {}) }, B = { ...f.b, ...(ufcAthlete(f.b.id) || {}) }, ra = ufcRec(A.rec), rb = ufcRec(B.rec);
  if (!ra || !rb) return null;
  const wr = r => (r.w + 1) / (r.w + r.l + 2), exp = r => Math.min(1, (r.w + r.l) / 25);
  let x = (wr(ra) - wr(rb)) * 3.2 + (exp(ra) - exp(rb)) * .5;
  const age = (A.age && B.age) ? (B.age - A.age) * .045 : 0; x += age;
  const reach = (ufcInch(A.reach) && ufcInch(B.reach)) ? (ufcInch(A.reach) - ufcInch(B.reach)) * .03 : 0; x += reach;
  const pA = 1 / (1 + Math.exp(-x));
  const share = (p, r) => { const k = ufcSplit(p.ko)[0] || 0, s = ufcSplit(p.sub)[0] || 0, w = r.w || 1; return { ko: k / w, sub: s / w, dec: Math.max(0, 1 - (k + s) / w) } };
  const ma = share(A, ra), mb = share(B, rb), mix = { ko: pA * ma.ko + (1 - pA) * mb.ko, sub: pA * ma.sub + (1 - pA) * mb.sub, dec: pA * ma.dec + (1 - pA) * mb.dec };
  const t = mix.ko + mix.sub + mix.dec || 1; mix.ko /= t; mix.sub /= t; mix.dec /= t;
  const fin = 1 - mix.dec, rounds = f.rounds || 3;
  const rp = Array.from({ length: rounds }, (_, i) => fin * Math.pow(.62, i) * .38 / (1 - Math.pow(.62, rounds))).map(p => p);
  const why = [];
  if (Math.abs(wr(ra) - wr(rb)) > .05) why.push({ t: 'Record', x: `${wr(ra) > wr(rb) ? A.name : B.name} wins more often (${ra.w}-${ra.l} against ${rb.w}-${rb.l}).` });
  if (Math.abs(age) > .1) why.push({ t: 'Age', x: `${age > 0 ? A.name : B.name} is ${Math.abs(A.age - B.age)} years younger.` });
  if (Math.abs(reach) > .05) why.push({ t: 'Reach', x: `${reach > 0 ? A.name : B.name} has ${Math.abs(ufcInch(A.reach) - ufcInch(B.reach))}″ more reach.` });
  why.push({ t: 'Finishing', x: `This fight goes the distance about ${Math.round(mix.dec * 100)}% of the time on these two records.` });
  return { pA, mix, rp, why, A, B };
}
function ufcPredPane(f){
  const P = ufcPredict(f); if (!P) return `<div class="note">Not enough of a record on one side for a prediction.</div>`;
  const fav = P.pA >= .5 ? P.A : P.B, fp = Math.max(P.pA, 1 - P.pA), C = 2 * Math.PI * 42;
  const meth = [['KO / TKO', P.mix.ko, '#FF5C4D'], ['Submission', P.mix.sub, '#7CC8FF'], ['Decision', P.mix.dec, '#E8B84A']];
  return `<div class="ufc-pred">
    <div class="ufc-pb"><span class="ufc-pb-n"><b>${esc(P.A.name)}</b><em class="num" data-count="${Math.round(P.pA * 100)}">${Math.round(P.pA * 100)}%</em></span>
      <span class="ufc-pb-bar"><i style="--w:${(P.pA * 100).toFixed(1)}%"></i><i style="--w:${(100 - P.pA * 100).toFixed(1)}%"></i></span>
      <span class="ufc-pb-n r"><b>${esc(P.B.name)}</b><em class="num">${Math.round((1 - P.pA) * 100)}%</em></span></div>
    <div class="ufc-pg"><div class="ufc-conf"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42"/><circle class="a" cx="50" cy="50" r="42" stroke-dasharray="${(C * fp).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg><b class="num">${Math.round(fp * 100)}%</b><small>confidence</small></div>
      <div class="ufc-pick"><small>Floodlight pick</small><b>${esc(fav.name)}</b><span>${esc(meth.slice().sort((a, b) => b[1] - a[1])[0][0])} most likely</span></div></div>
    <div class="sub-h"><h5>Method of victory</h5></div><div class="ufc-meth">${meth.map(([l, p, c], i) => `<div style="--c:${c};--i:${i}"><span>${l}</span><i><em style="--w:${(p * 100).toFixed(0)}%"></em></i><b class="num">${Math.round(p * 100)}%</b></div>`).join('')}</div>
    <div class="sub-h"><h5>Round it ends</h5><small>finish chances by round</small></div><div class="ufc-rounds">${P.rp.map((p, i) => `<div><i style="--h:${Math.max(4, p / Math.max(...P.rp) * 100).toFixed(0)}%"></i><b class="num">${Math.round(p * 100)}%</b><small>R${i + 1}</small></div>`).join('')}<div class="dec"><i style="--h:${Math.max(4, P.mix.dec / Math.max(...P.rp, P.mix.dec) * 100).toFixed(0)}%"></i><b class="num">${Math.round(P.mix.dec * 100)}%</b><small>Dec</small></div></div>
    <div class="sub-h"><h5>Key factors</h5></div><div class="ufc-why">${P.why.map(w => `<div><b>${esc(w.t)}</b><p>${esc(w.x)}</p></div>`).join('')}</div>
    <p class="srcnote">The model weighs each fighter's record and experience, age and reach; the method comes from how each one has won before. A guide, not a promise.</p></div>`;
}
// significant strikes by target on a body diagram, plus control time and takedowns
function ufcStatsPane(f){
  if (f.state === 'pre') return `<div class="note">Strike stats appear once the fight starts.</div>`;
  const s = k => [f.a.stats[k] || '', f.b.stats[k] || ''], land = v => +String(v).split('/')[0] || 0;
  const zones = [['Head', 'headStrikes'], ['Body', 'bodyStrikes'], ['Legs', 'legStrikes']];
  const body = (x, c) => { const t = zones.map(([, k]) => land(x.stats[k])), m = Math.max(1, ...t);
    return `<div class="ufc-body"><svg viewBox="0 0 60 120" role="img" aria-label="${esc(`${x.name}: head ${t[0]}, body ${t[1]}, legs ${t[2]} significant strikes landed`)}">
      <circle cx="30" cy="14" r="10" style="--o:${(.15 + t[0] / m * .85).toFixed(2)}" fill="${c}"/><path d="M14 30h32l4 38H10z" style="--o:${(.15 + t[1] / m * .85).toFixed(2)}" fill="${c}"/><path d="M12 70h16l-2 46h-10zM32 70h16l-4 46h-10z" style="--o:${(.15 + t[2] / m * .85).toFixed(2)}" fill="${c}"/></svg>
      <div>${zones.map(([l, k], i) => `<span><small>${l}</small><b class="num">${esc(x.stats[k] || '0/0')}</b></span>`).join('')}</div></div>` };
  const rows = [['Knockdowns', ...s('knockDowns')], ['Significant strikes', ...s('sigStrikes')], ['Total strikes', ...s('totalStrikes')], ['Head', ...s('headStrikes')], ['Body', ...s('bodyStrikes')], ['Legs', ...s('legStrikes')], ['Takedowns', ...s('takedowns')], ['Submission attempts', ...s('submissions')], ['Control time', ...s('timeInControl')]];
  return `<div class="ufc-stats"><div class="sub-h" style="margin-top:0"><h5>Where the strikes landed</h5><small>significant strikes landed / thrown</small></div>
    <div class="ufc-bodies"><div><b>${esc(f.a.name)}</b>${body(f.a, '#E2263C')}</div><div><b>${esc(f.b.name)}</b>${body(f.b, '#7CC8FF')}</div></div>
    <div class="sub-h"><h5>Fight stats</h5><small>${esc(f.a.name)} · ${esc(f.b.name)}</small></div>
    ${rows.map(([l, a, b]) => { const x = l === 'Control time' ? (a.split(':')[0] * 60 + +a.split(':')[1] || 0) : land(a), y = l === 'Control time' ? (b.split(':')[0] * 60 + +b.split(':')[1] || 0) : land(b), m = Math.max(x, y, 1);
      return `<div class="stat"><span class="v num">${esc(a || '0')}</span><div><div class="lbl">${esc(l)}</div><div class="bars"><span><i style="width:${x / m * 100}%;background:#E2263C"></i></span><span><i style="width:${y / m * 100}%;background:#7CC8FF"></i></span></div></div><span class="v num">${esc(b || '0')}</span></div>` }).join('')}</div>`;
}
function ufcFightSheet(v, back){
  const f = ufcFightOf(v);
  if (!f) return { hero: `<div class="hero solo">${topBar(back)}</div>`, body: `<div class="skel" style="height:360px"></div>`, tabs: [] };
  ufcAthlete(f.a.id); ufcAthlete(f.b.id);
  const C = S.ufc.fc.get(v.ev);
  const tabs = f.state === 'pre' ? [['tape', 'Tale of the tape'], ['pred', 'Prediction']] : [['stats', f.state === 'in' ? 'Live stats' : 'Fight stats'], ['tape', 'Tale of the tape'], ['pred', 'Prediction']];
  if (!tabs.some(t => t[0] === v.tab)) v.tab = tabs[0][0];
  const side = (x, r) => `<span class="ufc-fh-s${r ? ' r' : ''}${x.win ? ' win' : ''}${f.state === 'post' && !x.win && (f.a.win || f.b.win) ? ' lose' : ''}"><button class="ufc-fh-img" data-ufcfighter="${esc(x.id)}" aria-label="${esc(x.name)} profile">${ufcFace(x, 'ufc-fh-face', true)}</button><b>${esc(x.name)}</b><small>${esc(x.rec)}${x.country ? ' · ' + esc(x.country) : ''}</small></span>`;
  const mid = f.state === 'in' ? `<span class="mx-badge live"><i></i>Round ${f.round || 1} · ${esc(f.clock)}</span>` : f.state === 'post' ? `<span class="ufc-fh-how"><b>${esc(f.how?.name || 'Final')}</b><small>Round ${f.round}, ${esc(f.clock)}${f.how?.desc && f.how.desc !== f.how.name ? ' · ' + esc(f.how.desc) : ''}</small></span>` : ufcCountdown(+f.date);
  const hero = `<div class="hero solo ufc-fh is-${f.state}">${topBar(back)}<div class="ufc-fh-tags">${f.title ? `<span class="ufc-belt">${esc(f.title)}</span>` : ''}<span>${esc(f.cls)}</span><span>${f.rounds} rounds</span>${C?.name ? `<button class="linkbtn" data-ufcev="${esc(v.ev)}">${esc(C.name.replace(/:.*/, ''))}</button>` : ''}</div>
    <div class="ufc-fh-row">${side(f.a)}<span class="ufc-fh-mid"><i>VS</i>${mid}</span>${side(f.b, true)}</div></div>`;
  const body = v.tab === 'pred' ? ufcPredPane(f) : v.tab === 'stats' ? ufcStatsPane(f) : ufcTape(f);
  return { hero, body, tabs };
}

/* ---------- fighter page ---------- */
function ufcFighterSheet(v, back){
  const a = ufcAthlete(v.id), name = a?.name || v.name || 'Fighter';
  const hist = ufcAll().flatMap(e => e.bouts.filter(b => b.a.id === v.id || b.b.id === v.id).map(b => ({ e, b, me: b.a.id === v.id ? b.a : b.b, op: b.a.id === v.id ? b.b : b.a }))).sort((x, y) => y.e.date - x.e.date);
  const r = ufcRec(a?.rec), ko = ufcSplit(a?.ko)[0], sb = ufcSplit(a?.sub)[0], dec = r && ko != null && sb != null ? Math.max(0, r.w - ko - sb) : null;
  const hero = `<div class="hero solo ufc-fp">${topBar(back)}<div class="ufc-fp-in"><div class="ufc-fp-photo">${ufcFace({ id: v.id, name, photo: a?.photo }, 'ufc-fp-img', true)}</div>
    <div class="ufc-fp-t">${a?.nick ? `<span class="ufc-k">“${esc(a.nick)}”</span>` : ''}<h3>${esc(name)}</h3><p>${[a?.cls, a?.country, a?.camp].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="ufc-fp-rec"><b class="num">${esc(a?.rec || '–')}</b><small>W-L-D</small></div>
      ${r ? `<div class="ufc-fp-m">${[['KO/TKO', ko, '#FF5C4D'], ['Sub', sb, '#7CC8FF'], ['Dec', dec, '#E8B84A']].map(([l, n, c]) => `<span style="--c:${c};--w:${r.w ? ((n || 0) / r.w * 100).toFixed(0) : 0}%"><i></i><b class="num">${n ?? '–'}</b><small>${l}</small></span>`).join('')}</div>` : ''}</div></div></div>`;
  const facts = a?.found ? `<div class="ufc-facts">${[['Age', a.age], ['Born', a.dob], ['Height', a.height], ['Reach', a.reach], ['Weight', a.weight], ['Stance', a.stance], ['Style', a.style], ['Team', a.camp]].filter(x => x[1]).map(([l, x]) => `<div><small>${l}</small><b>${esc(x)}</b></div>`).join('')}</div>` : a === null ? '<div class="skel" style="height:90px"></div>' : '';
  const years = [...S.ufc.years.keys()], oldest = Math.min(...years);
  const tl = hist.length ? `<ol class="ufc-tl">${hist.map(({ e, b, me, op }, i) => { const res = b.state !== 'post' ? 'next' : me.win ? 'w' : op.win ? 'l' : 'd';
      return `<li class="${res}" style="--i:${Math.min(i, 14)}"><span class="ufc-tl-dot">${res === 'w' ? 'W' : res === 'l' ? 'L' : res === 'next' ? '•' : 'D'}</span><button data-ufcfightev="${esc(e.id)}" data-ufcfight="${esc(b.id)}"><small>${esc(ufcDay(e.date))} · ${esc(e.name.replace(/:.*/, ''))}</small><b>${res === 'next' ? 'vs' : res === 'w' ? 'Beat' : res === 'l' ? 'Lost to' : 'Drew with'} ${esc(op.name)}</b><span>${esc(b.cls)}${b.state === 'post' && b.round ? ` · R${b.round} ${esc(b.clock)}` : ''}</span></button></li>` }).join('')}</ol>`
    : '<div class="note">No UFC fights found in the years loaded.</div>';
  const body = `${facts}<div class="sub-h"><h5>Fight history</h5><small>UFC, ${oldest}–now</small></div>${tl}${oldest > UFC_FIRST_YEAR ? `<button class="btn ghost" data-ufcact="older" style="margin-top:12px">Load fights before ${oldest}</button>` : ''}`;
  return { hero, body };
}

/* ---------- sheet routing and opening ---------- */
function ufcRenderSheet(v){
  const sheet = $('sheet'), back = S.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Back">${BACK}Back</button>` : '<span></span>';
  const scroll = sheet.querySelector('.sheet-body')?.scrollTop || 0;
  let out, tabs = [];
  if (v.type === 'ufcevent') out = ufcEventSheet(v, back);
  else if (v.type === 'ufcfight') { out = ufcFightSheet(v, back); tabs = out.tabs }
  else out = ufcFighterSheet(v, back);
  S.curTabs = tabs;
  sheet.innerHTML = `<div class="sheet-body ufc-sheet">${out.hero}${tabs.length ? tabsHTML(tabs, v.tab) : ''}<div class="pane" id="pane"${tabs.length ? ' role="tabpanel"' : ''}>${out.body}</div></div>`;
  sheet.querySelector('.sheet-body').scrollTop = scroll;
  if (typeof fxEnter === 'function') fxEnter(sheet, v.type + v.id, v.tab || '');
}
async function ufcOpenEvent(id){
  S.sel = null; S.stack = [{ type: 'ufcevent', id: String(id) }];
  renderSheet(); $('sheet').classList.add('open'); $('sheet').querySelector('.sheet-body')?.scrollTo(0, 0);
  const v = S.stack[0]; await ufcLoadCard(String(id)); if (S.stack.includes(v)) renderSheet();
}
async function ufcOpenFight(id, ev){
  ev = ev || [...S.ufc.fc.values()].find(c => c.fights?.some(f => f.id === id))?.id || ufcAll().find(e => e.bouts.some(b => b.id === id))?.id;
  if (!ev) return;
  const v = { type: 'ufcfight', id: String(id), ev: String(ev), tab: '' };
  if (S.stack[S.stack.length - 1]?.type?.startsWith('ufc')) pushView(v); else { S.sel = null; S.stack = [v]; renderSheet(); $('sheet').classList.add('open') }
  if (!S.ufc.fc.has(String(ev))) { await ufcLoadCard(String(ev)); if (S.stack.includes(v)) renderSheet() }
}
async function ufcOpenFighter(id){
  const v = { type: 'ufcfighter', id: String(id) };
  if (S.stack[S.stack.length - 1]?.type?.startsWith('ufc')) pushView(v); else { S.sel = null; S.stack = [v]; renderSheet(); $('sheet').classList.add('open') }
  ufcAthlete(String(id));
  // the fight history comes from the yearly schedules: make sure the last few years are loaded
  const y = new Date().getFullYear(); await Promise.all([y, y - 1, y - 2, y - 3].map(k => ufcLoadYear(k))); if (S.stack.includes(v)) renderSheet();
}

/* ---------- hooks into the main app ---------- */
(function ufcInstall(){
  const sw = document.querySelector('.sport-sw');
  if (sw && !sw.querySelector('[data-sport="ufc"]')) sw.insertAdjacentHTML('beforeend', `<button role="tab" data-sport="ufc" class="sp-ufc">UFC</button>`);
  if (!$('ufc')) { const sec = document.createElement('section'); sec.id = 'ufc'; sec.hidden = true; sec.setAttribute('aria-label', 'UFC'); const sheet = $('sheet'); sheet.parentNode.insertBefore(sec, sheet) }
  if (typeof STAGE !== 'undefined') ['ufcevent', 'ufcfight', 'ufcfighter'].forEach(t => STAGE.add(t));
  const _render = render;
  render = function(){
    if (S.sport !== 'ufc') { $('ufc').hidden = true; return _render.apply(this, arguments) }
    document.querySelectorAll('.sport-sw button').forEach(b => { const on = b.dataset.sport === 'ufc'; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) });
    document.querySelectorAll('main.shell > section').forEach(s => { if (s.id !== 'hub') s.hidden = s.id !== 'ufc' });
    document.querySelector('.shell').classList.remove('mk-page'); const tk = $('ticker'); if (tk) tk.hidden = true;
    const rail = $('rail'); if (rail) rail.innerHTML = `<h4>UFC</h4><button class="lg on" data-ufcyear="${new Date().getFullYear()}"><span class="dot">●</span><span>Events</span></button>`;
    const ch = $('chips'); if (ch) ch.innerHTML = '';
    renderUfc();
  };
  const _sheet = renderSheet;
  renderSheet = function(){ const v = S.stack[S.stack.length - 1]; if (v?.type?.startsWith('ufc')) { if (typeof syncStage === 'function') syncStage(); return ufcRenderSheet(v) } return _sheet.apply(this, arguments) };
  if (typeof searchAll === 'function') { const _search = searchAll;
    searchAll = function(q){ if (S.sport !== 'ufc') return _search.apply(this, arguments);
      const box = $('sres'); if (!box) return; q = q.trim().toLowerCase(); if (q.length < 2) { box.hidden = true; return }
      const evs = ufcAll().filter(e => e.name.toLowerCase().includes(q)).slice(-6).reverse();
      const seen = new Set(), fighters = ufcAll().flatMap(e => e.bouts.flatMap(b => [b.a, b.b])).filter(f => f.name.toLowerCase().includes(q) && !seen.has(f.id) && seen.add(f.id)).slice(0, 8);
      box.innerHTML = (fighters.length ? '<div class="sr-h">Fighters</div>' + fighters.map(f => `<button class="sr" data-ufcfighter="${esc(f.id)}">${ufcFace(f, 'face')}<div><strong>${esc(f.name)}</strong><small>${esc(f.rec)}</small></div></button>`).join('') : '')
        + (evs.length ? '<div class="sr-h">Events</div>' + evs.map(e => `<button class="sr" data-ufcev="${esc(e.id)}"><div><strong>${esc(e.name)}</strong><small>${esc(ufcDay(e.date))}</small></div></button>`).join('') : '') || `<div class="sr-none">No UFC events or fighters match “${esc(q)}”.</div>`;
      box.hidden = false } }
})();
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-ufcev],[data-ufcfight],[data-ufcfighter],[data-ufcyear],[data-ufcact]'); if (!t) return;
  ev.stopPropagation(); if (typeof hideResults === 'function') hideResults();
  if (t.dataset.ufcyear) { S.ufc.year = +t.dataset.ufcyear; renderUfc(); return }
  if (t.dataset.ufcfighter) return ufcOpenFighter(t.dataset.ufcfighter);
  if (t.dataset.ufcfight) return ufcOpenFight(t.dataset.ufcfight, t.dataset.ufcfightev);
  if (t.dataset.ufcev) { if (S.sport !== 'ufc' && typeof setSport === 'function') setSport('ufc'); return ufcOpenEvent(t.dataset.ufcev) }
  const a = t.dataset.ufcact, v = S.stack[S.stack.length - 1];
  if (a === 'ufcretry' && v) { S.ufc.fc.delete(v.id); return ufcOpenEvent(v.id) }
  if (a === 'older') { const oldest = Math.min(...S.ufc.years.keys()); Promise.all([oldest - 1, oldest - 2, oldest - 3].filter(y => y >= UFC_FIRST_YEAR).map(y => ufcLoadYear(y))).then(() => S.stack.includes(v) && renderSheet()); t.disabled = true; t.textContent = 'Loading…' }
}, true);
document.addEventListener('input', ev => { if (ev.target.id !== 'ufcQ') return; S.ufc.q = ev.target.value; S.ufc.focusQ = true; clearTimeout(S.ufc.qt); S.ufc.qt = setTimeout(() => { renderUfc(); }, 160) });
// live: refresh the schedule and any open card while an event is on
setInterval(() => {
  if (document.hidden || S.sport !== 'ufc') return;
  const nx = ufcNext(); if (!nx || (nx.state !== 'in' && nx.date - Date.now() > 20 * 6e4)) return;
  ufcLoadYear(new Date().getFullYear(), true).then(() => { if (!S.stack.length) renderUfc() });
  const v = S.stack[0]; const id = v?.type === 'ufcevent' ? v.id : v?.type === 'ufcfight' ? v.ev : null;
  if (id) ufcLoadCard(id, true).then(() => { if (S.stack.length) renderSheet() });
}, 30000);
if (S.sport === 'ufc') setTimeout(render, 0);
