/* Floodlight · reasons to come back each day: the personal briefing on Home, the daily dashboard (#/today), the weekly
   recap (#/recap) and a few quiet achievements.
   Everything personal is worked out in this browser from what you follow (teams, players, picks) and what you looked
   at (recent.js). Markets come from the one feed (marketfeed.js), injuries from the league reports (injuries.js), and
   graded results from the pick record (/api/props/record), so every number here matches the page it opens.
   Nothing is invented: a count with no source behind it is simply left out.
     flDaily.greeting(list)  the "Good morning, Erez" block at the top of Home's briefing
     flDaily.counts(list)    { mine, players, inj, moves, results } for Home's glance row
     flDaily.summary()       the text of the daily summary alert; flDaily.weekly() the weekly one
     flDaily.log(kind, x)    another page can add to the activity log (research, follow, moved) */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s = 18) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const flat = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const day0 = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d };
  const dkey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  const hm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtL = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const LG_NAME = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer', cbb: 'College basketball', cfb: 'College football', fbs: 'College football' };
  const SPORT_LG = { basketball: 'nba', football: 'nfl', hockey: 'nhl', baseball: 'mlb' };
  const INJ_SPORTS = ['nba', 'wnba', 'nfl', 'nhl', 'mlb'];

  /* ---------- the activity log: what you researched, followed and saw move, by day (this browser only) ---------- */
  let LOG = store.get('fl.activity', {});
  const saveLog = () => { const ks = Object.keys(LOG).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 120))) delete LOG[k]; store.set('fl.activity', LOG) };
  function log(kind, x = {}) {
    const k = dkey(), d = LOG[k] || (LOG[k] = { p: [], s: [], f: 0, m: 0, n: 0 });
    if (kind === 'research') { d.n++; if (x.name && !d.p.includes(x.name)) d.p.push(String(x.name).slice(0, 60)); if (x.sport && !d.s.includes(x.sport)) d.s.push(x.sport); seenOnServer(x) }
    if (kind === 'follow') d.f++;
    if (kind === 'moved') d.m++;
    d.p = d.p.slice(-80); saveLog(); checkAch();
  }
  // every player, team or prop you settle on in the Lab counts as research (recent.js is told about each one)
  const RESEARCH = new Set(['player', 'team', 'compare', 'trend', 'props', 'pred']);
  function hookRecent() {
    const R = window.flRecent; if (!R || R._daily) return; const note = R.note;
    R.note = item => { try { if (item && RESEARCH.has(item.kind)) log('research', { name: item.open?.lab?.name || (item.kind === 'player' ? item.label : ''), sport: item.open?.lab?.sport || item.open?.filters?.sport || '' }) } catch (e) {} return note(item) };
    R._daily = true;
  }
  hookRecent(); document.addEventListener('DOMContentLoaded', hookRecent);
  // the site-wide count behind "Most researched player": one anonymous tick per player, per device, per day
  const ticked = new Set(store.get('fl.rsTick', { d: '', n: [] }).d === dkey() ? store.get('fl.rsTick', {}).n : []);
  function seenOnServer(x) {
    if (!x.name || !x.sport || ticked.has(x.sport + ':' + x.name)) return; ticked.add(x.sport + ':' + x.name); store.set('fl.rsTick', { d: dkey(), n: [...ticked].slice(-200) });
    try { fetch('/api/daily/seen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: x.name, sport: x.sport }) }).catch(() => {}) } catch (e) {}
  }

  /* ---------- what you follow ---------- */
  const favTeams = () => { try { return window.S?.fav || [] } catch { return [] } };
  const follows = () => { const a = store.get('fl.follows', []), b = window.S?.me?.prefs?.follows; return (Array.isArray(b) && b.length ? b : a) || [] };
  const players = () => follows().filter(f => f && f.k === 'player' && f.name);
  const picks = () => (store.get('fl.pdFollow', []) || []).filter(f => f && f.name);
  const teamLg = f => f.lg && INJ_SPORTS.includes(f.lg) ? f.lg : SPORT_LG[f.sport] || '';

  /* ---------- graded results for the picks you follow (the pick record) ---------- */
  const REC = { at: 0, entries: null, loading: false };
  function loadRecord(force) {
    if (REC.loading || (!force && Date.now() - REC.at < 10 * 60000)) return; REC.loading = true;
    fetch('/api/props/record', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => { if (d) REC.entries = d.entries || [] })
      .catch(() => {}).finally(() => { REC.loading = false; REC.at = Date.now(); changed() });
  }
  const RES_NAME = { won: 'Hit', lost: 'Miss', push: 'Push', void: 'Void' };
  // a followed pick's graded entry: the same player, within six hours of the same start
  function graded(f) {
    if (!REC.entries || !f.start) return null;
    return REC.entries.find(e => flat(e.player) === flat(f.name) && Math.abs(e.start * 1000 - f.start) < 6 * 3600e3 && RES_NAME[e.result]) || null;
  }
  const resSeen = () => new Set(store.get('fl.resSeen', []));
  const newResults = () => { const s = resSeen(); return picks().map(f => ({ f, e: graded(f) })).filter(x => x.e && !s.has(x.f.k)) };
  function markResultsSeen() { const s = resSeen(); for (const x of newResults()) s.add(x.f.k); store.set('fl.resSeen', [...s].slice(-300)); changed() }

  /* ---------- injuries that are news today, for you ---------- */
  function injuryNews() {
    const I = window.flInjuries; if (!I) return [];
    const teams = favTeams(), pl = players(), pk = picks(), lined = new Set((window.flFeed?.now() || []).map(m => flat(m.name)));
    const sports = new Set([...teams.map(teamLg), ...pl.map(p => p.lg), ...pk.map(p => p.sport)].filter(s => INJ_SPORTS.includes(s)));
    const out = [], today = day0();
    for (const sp of sports) {
      if (!I.ready(sp)) { I.load(sp); continue }
      const v = I.ready(sp);
      for (const t of v.teams) {
        const mineTeam = teams.some(f => teamLg(f) === sp && (flat(f.name) === flat(t.name) || (f.abbr && flat(f.abbr) === flat(t.abbr))));
        for (const p of t.players) {
          if (!p.date || p.date < today) continue;
          const who = pl.some(f => flat(f.name) === flat(p.name)) ? 'player' : pk.some(f => flat(f.name) === flat(p.name)) ? 'pick' : mineTeam ? 'team' : '';
          if (who) out.push({ ...p, sport: sp, teamName: t.name, why: who, lined: lined.has(flat(p.name)) });
        }
      }
    }
    const order = { out: 0, doubtful: 1, questionable: 2, dtd: 3, probable: 4, active: 5 };
    return out.sort((a, b) => (order[a.lv] ?? 9) - (order[b.lv] ?? 9) || (b.date || 0) - (a.date || 0));
  }

  /* ---------- the numbers ---------- */
  const mineGames = (list = window.flHub?.games?.() || []) => list.filter(g => window.flHome?.isMine?.(g) || window.flHome?.watching?.(g.key));
  function playersWithLines() { const F = window.flFeed; if (!F) return []; return players().map(p => ({ p, m: F.forPlayer(p.name) })).filter(x => x.m.length) }
  function moves() { const F = window.flFeed; if (!F) return []; return F.now().map(m => ({ m, d: F.moved(m) })).filter(x => x.d).sort((a, b) => Math.abs(b.d.to - b.d.from) - Math.abs(a.d.to - a.d.from)) }
  function counts(list) {
    loadRecord();
    return { mine: mineGames(list).length, players: playersWithLines().length, inj: injuryNews().length, moves: moves().length, results: newResults().length };
  }
  const partOfDay = () => { const h = new Date().getHours(); return h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening' };
  const firstName = () => String(window.S?.me?.display || window.S?.me?.username || '').trim().split(/\s+/)[0];
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  function greeting(list) {
    const c = counts(list), nm = firstName();
    const line = (n, text, attrs, icon) => n ? `<li><button type="button" class="hm-bi hm-gl" ${attrs}>${ic(icon, 18)}<span class="hm-bt"><span class="hm-bm"><b class="num">${n}</b> ${esc(text)}</span></span></button></li>` : '';
    const lines = [
      line(c.mine, `${c.mine === 1 ? 'game involves' : 'games involve'} your teams today`, 'data-hubcmd="mine"', 'star'),
      line(c.players, `followed ${c.players === 1 ? 'player has' : 'players have'} lines today`, 'data-hubcmd="players"', 'profile'),
      line(c.inj, `injury ${c.inj === 1 ? 'update' : 'updates'} for your teams and players`, 'data-hubcmd="inj"', 'help'),
      line(c.results, `prediction ${c.results === 1 ? 'result is' : 'results are'} ready`, 'data-dlyres', 'check'),
      line(c.moves, `${c.moves === 1 ? 'line has' : 'lines have'} moved today`, 'data-hubcmd="moves"', 'trend')].filter(Boolean);
    const empty = !favTeams().length && !players().length && !picks().length;
    return `<div class="hm-greet"><h2 id="hmGreetH">Good ${partOfDay()}${nm ? `, ${esc(nm)}` : ''}</h2>
      ${lines.length ? `<ul class="hm-bl hm-greet-l">${lines.join('')}</ul>` : `<p class="lb">${empty ? 'Follow teams, players or picks and what is new for them will be listed here each day.' : 'Nothing new for your teams, players or picks yet today.'}</p>`}
      <p class="hm-greet-go"><button type="button" class="lk" data-page="today">Open your day${ic('arrow', 16)}</button>${new Date().getDay() === 1 || new Date().getDay() === 0 ? '<button type="button" class="lk" data-page="recap">Your week</button>' : ''}</p></div>`;
  }
  document.addEventListener('click', ev => { if (ev.target.closest?.('[data-dlyretry]')) { D.mk = null; changed(); loadMarkets(true).then(() => document.querySelector('#dly-best h2')?.closest('section')?.focus({ preventScroll: true })) } });
  document.addEventListener('click', ev => { if (ev.target.closest?.('[data-dlyres]')) { markResultsSeen(); window.flPages?.show?.('today', 'results') } });

  /* ---------- the daily dashboard (#/today) ---------- */
  const D = { top: null, yday: null, ydayAt: 0, ydayErr: '', mk: null, mkErr: false, at: 0 };
  async function loadMarkets(force) {
    const F = window.flFeed; if (!F) return;
    const lgs = [...new Set((window.flHub?.games?.() || []).map(g => g.sport === 'soccer' ? 'soccer' : String(g.lg)).filter(l => ['nba', 'nfl', 'nhl', 'mlb', 'wnba', 'soccer'].includes(l)))];
    D.mkErr = false; D.mkSlow = false;
    // never a lasting "Reading…": after twelve seconds the card says the provider is slow, and the answer still lands when it comes
    const slow = setTimeout(() => { if (!D.mk) { D.mkSlow = true; changed() } }, 12000);
    try { const r = await F.open(lgs.length ? lgs : F.SPORTS, force); D.mk = r; D.mkErr = r.failed } catch (e) { D.mkErr = true } clearTimeout(slow); D.mkSlow = false; changed();
  }
  async function loadTop() { try { const r = await fetch('/api/daily/top', { credentials: 'same-origin' }); D.top = r.ok ? (await r.json()).top || [] : [] } catch { D.top = [] } changed() }
  // yesterday's finals: your teams first, then the biggest leagues. Read from the same ESPN scoreboards Home uses.
  const YFEEDS = [['football/nfl', 'NFL', 'football', 'nfl'], ['basketball/nba', 'NBA', 'basketball', 'nba'], ['hockey/nhl', 'NHL', 'hockey', 'nhl'], ['baseball/mlb', 'MLB', 'baseball', 'mlb'], ['soccer/all', 'Soccer', 'soccer', 'soccer'], ['football/college-football', 'College football', 'football', 'fbs'], ['basketball/mens-college-basketball', 'College basketball', 'basketball', 'cbb']];
  async function loadYesterday() {
    if (D.yday && Date.now() - D.ydayAt < 15 * 60000) return;
    const d = new Date(day0() - 864e5), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const read = f => Promise.race([fetch(`https://site.api.espn.com/apis/site/v2/sports/${f[0]}/scoreboard?dates=${ymd}${f[3] === 'fbs' ? '&groups=80' : f[3] === 'cbb' ? '&groups=50' : ''}`).then(r => r.ok ? r.json() : { events: [] }), new Promise((_, n) => setTimeout(() => n(new Error('slow')), 12000))])
      .then(j => (j.events || []).map(ev => { const c = ev.competitions?.[0] || {}, cs = c.competitors || [], st = c.status?.type || ev.status?.type || {};
        const side = x => ({ name: x?.team?.shortDisplayName || x?.team?.displayName || '', full: x?.team?.displayName || '', id: String(x?.team?.id || ''), score: x?.score?.displayValue ?? x?.score ?? '', win: !!x?.winner, rank: x?.curatedRank?.current && x.curatedRank.current <= 25 ? x.curatedRank.current : 0, logo: x?.team?.logo || '' });
        const us = f[2] !== 'soccer', home = cs.find(x => x.homeAway === 'home') || cs[0], away = cs.find(x => x.homeAway === 'away') || cs[1];
        return { key: `${f[2]}:${c.id || ev.id}`, sport: f[2], lg: f[3], short: f[1], id: String(ev.id), done: st.state === 'post', a: side(us ? away : home), b: side(us ? home : away), tv: !!(c.broadcasts || []).some(b => b.market === 'national') } }).filter(g => g.done && g.a.name))
      .catch(() => null);
    const res = await Promise.all(YFEEDS.map(read));
    D.ydayErr = res.every(r => r == null) ? 'The scoreboards did not answer.' : '';
    D.yday = res.flat().filter(Boolean); D.ydayAt = Date.now(); changed();
  }
  const isMineTeam = (g, t) => favTeams().some(f => flat(f.name) === flat(t.full) || flat(f.name) === flat(t.name) || ((f.sport || 'soccer') === g.sport && String(f.tid || '') === t.id && !!t.id));

  const card = (id, title, body, more = '') => `<section class="card dly-c" id="dly-${id}" aria-labelledby="dly-${id}-h" tabindex="-1"><div class="sec-h"><h2 id="dly-${id}-h">${title}</h2>${more}</div>${body}</section>`;
  const face = (src, name) => `<span class="avx av-sm">${src ? `<img src="${esc(src)}" alt="" width="32" height="32" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${esc(String(name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span></span>`;
  const none = (t, d = '') => `<p class="hm-none"><b>${esc(t)}</b>${d ? `<span>${esc(d)}</span>` : ''}</p>`;
  const when = m => { const s = m.start ? new Date(m.start) : null; if (!s) return ''; return (day0(+s) === day0() ? '' : s.toLocaleDateString([], { weekday: 'short' }) + ' ') + hm(+s) };
  const mRow = (m, right) => { const F = window.flFeed; return `<button type="button" class="rw" data-dlylab="${esc(JSON.stringify(F.labArgs(m)))}">${face(m.photo, m.name)}<span class="rw-t"><b>${esc(m.name)}</b><small>${esc([m.text, m.game || [m.team, m.opp].filter(Boolean).join(' v '), when(m)].filter(Boolean).join(' · '))}</small></span>${right}</button>` };
  const sign = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

  function draw() {
    const el = document.getElementById('dlyBody'); if (!el) return;
    const F = window.flFeed, hub = window.flHub?.games?.() || [], mk = F ? F.now() : [];
    const loadingMk = !D.mk && !mk.length && !D.mkErr && !D.mkSlow;
    const good = F?.keptAt?.(F.SPORTS) || D.mk?.lastGood || 0;
    const retry = `<button type="button" class="bt ghost sm" data-dlyretry>Try again</button>`;
    const lastGood = good ? ` Last successful update: ${hm(good)}${day0(good) === day0() ? '' : ` on ${new Date(good).toLocaleDateString([], { weekday: 'short' })}`}.` : '';
    const mkDown = (D.mkErr || D.mkSlow) && !mk.length ? `${none(D.mkSlow ? 'Provider delay' : 'Today’s lines did not load', (D.mkSlow ? 'The line provider has not answered yet, so nothing is shown rather than a guess.' : 'The line provider did not answer.') + lastGood)}${retry}` : '';
    // best-supported markets
    const best = F ? F.ranked(mk).filter(m => F.edge(m) > 0).slice(0, 5) : [];
    const bestBody = loadingMk ? `<p class="lb" role="status">Reading today’s verified lines…</p>` : mkDown ? mkDown
      : best.length ? `<div class="hm-rows">${best.map(m => mRow(m, `<span class="dly-num"><b class="num">${sign(F.edge(m))}</b><small class="lb">${m.sedge != null ? 'supported edge' : 'edge'}${m.grade ? ` · evidence ${esc(m.grade)}` : ''}</small></span>`)).join('')}</div>`
      : none('No qualifying markets right now', 'A market shows here once it is open, verified and priced above the market for a game still to start.');
    // biggest line movement
    const mv = moves().slice(0, 6);
    const mvBody = loadingMk ? `<p class="lb" role="status">Reading lines…</p>` : mkDown && !mv.length ? mkDown : mv.length ? `<div class="hm-rows">${mv.map(({ m, d }) => mRow(m, `<span class="dly-num"><b class="num">${fmtL(d.from)} → ${fmtL(d.to)}</b><small class="lb">${d.to > d.from ? 'up' : 'down'} ${fmtL(Math.abs(d.to - d.from))}${d.at ? ` since ${esc(hm(d.at))}` : ''}</small></span>`)).join('')}</div>`
      : none('No line has moved yet today', 'Moves are counted from the first line this device saw today, or the provider’s own history when it has one.');
    // most researched player
    const mine = Object.entries(LOG).filter(([k]) => k === dkey()).flatMap(([, d]) => d.p);
    const topBody = D.top == null ? `<p class="lb" role="status">Counting…</p>` : D.top.length ? `<ol class="dly-ol">${D.top.slice(0, 5).map(x => `<li><button type="button" class="rw" data-dlylab="${esc(JSON.stringify({ sport: x.sport, name: x.name, kind: 'player' }))}"><span class="rw-t"><b>${esc(x.name)}</b><small>${esc(LG_NAME[x.sport] || x.sport)}</small></span><span class="dly-num"><b class="num">${x.n}</b><small class="lb">${x.n === 1 ? 'member' : 'members'}</small></span></button></li>`).join('')}</ol>`
      : none('No research counted yet today', mine.length ? `Counts update every few minutes. You looked at ${mine.slice(0, 3).join(', ')}.` : 'Counts update every few minutes. Open a player in the Lab to add yours.');
    // injury updates
    const inj = injuryNews();
    const injBody = inj.length ? `<ul class="dly-inj">${inj.slice(0, 12).map(p => `<li><span class="rw-t"><b>${esc(p.name)}${p.pos ? ` <small class="lb">${esc(p.pos)}</small>` : ''}</b><small>${esc([p.teamName, p.what, p.why === 'player' ? 'a player you follow' : p.why === 'pick' ? 'a pick you follow' : 'your team', p.lined ? 'has a line today' : ''].filter(Boolean).join(' · '))}</small></span><span class="pl ij-lv ij-${esc(p.lv)}">${esc(p.status || p.lv)}</span></li>`).join('')}</ul>`
      : !favTeams().length && !players().length ? none('Follow teams or players to see their injury news', 'Updates for teams and players you follow show here the day they are posted.')
      : none('No injury news for your teams or players today', 'From the NBA, WNBA, NFL, NHL and MLB injury reports.');
    // followed players
    const pw = playersWithLines(), pl = players();
    const plBody = pl.length ? `<div class="hm-rows">${pl.slice(0, 10).map(p => { const ms = F ? F.forPlayer(p.name) : [];
      return `<button type="button" class="rw" data-dlylab="${esc(JSON.stringify({ sport: p.lg, name: p.name, kind: 'player' }))}"><span class="rw-t"><b>${esc(p.name)}</b><small>${ms.length ? esc(ms.slice(0, 3).map(m => m.text).join(' · ')) : 'No open line today'}</small></span>${ms.length ? `<span class="pl">${ms.length} ${ms.length === 1 ? 'line' : 'lines'}</span>` : ''}</button>` }).join('')}</div>`
      : none('You don’t follow any players yet', 'Press Follow on a player’s profile. Their lines and injury news then show here.');
    // your teams today
    const mg = mineGames(hub).sort((a, b) => (a.state === 'in' ? 0 : a.state === 'pre' ? 1 : 2) - (b.state === 'in' ? 0 : b.state === 'pre' ? 1 : 2) || a.date - b.date);
    const tmBody = mg.length ? `<div class="g4 hm-cards">${mg.slice(0, 8).map(g => window.flHub.card(g)).join('')}</div>`
      : favTeams().length ? none('None of your teams play today') : none('You don’t follow any teams yet', 'Choose teams on Home to see their games here.');
    // yesterday
    const yd = D.yday || [], ym = yd.filter(g => isMineTeam(g, g.a) || isMineTeam(g, g.b)), big = yd.filter(g => !ym.includes(g) && (g.tv || g.a.rank || g.b.rank) && !window.flMC?.spoil?.(g.key)).slice(0, 6);
    const yRow = g => { const hide = window.flMC?.spoil?.(g.key); return `<li class="dly-res"><span class="lb">${esc(g.short)}</span><span class="${g.a.win ? 'w' : ''}">${esc(g.a.name)}</span><b class="num">${hide ? 'Score hidden' : `${esc(g.a.score)}–${esc(g.b.score)}`}</b><span class="${g.b.win ? 'w' : ''}">${esc(g.b.name)}</span>${hide ? '' : `<span class="sr-only">${esc((g.a.win ? g.a : g.b.win ? g.b : null)?.name || 'Draw')}${g.a.win || g.b.win ? ' won' : ''}</span>`}</li>` };
    const yRes = newResults().concat(picks().filter(f => f.start && f.start >= day0() - 864e5 && f.start < day0()).map(f => ({ f, e: graded(f) })).filter(x => x.e && !newResults().some(y => y.f.k === x.f.k)));
    const ydBody = D.yday == null ? `<p class="lb" role="status">Reading yesterday’s finals…</p>` : D.ydayErr && !yd.length ? none('Yesterday’s results did not load', D.ydayErr)
      : `${yRes.length ? `<h3 class="dly-h3">Your picks</h3><ul class="dly-list">${yRes.slice(0, 8).map(({ f, e }) => `<li><span class="rw-t"><b>${esc(f.name)}</b><small>${esc(f.text)}${e.actual != null && e.actual !== '' ? ` · finished ${esc(e.actual)}` : ''}</small></span><span class="pl dly-g dly-${esc(e.result)}">${esc(RES_NAME[e.result])}</span></li>`).join('')}</ul>` : ''}
        ${ym.length ? `<h3 class="dly-h3">Your teams</h3><ul class="dly-list">${ym.map(yRow).join('')}</ul>` : ''}
        ${big.length ? `<h3 class="dly-h3">Big games</h3><ul class="dly-list">${big.map(yRow).join('')}</ul>` : ''}
        ${!yRes.length && !ym.length && !big.length ? none('Nothing of yours finished yesterday') : ''}`;
    // national TV still to come
    const tv = hub.filter(g => g.state === 'pre' && g.tvNat).sort((a, b) => a.date - b.date).slice(0, 6);
    const tvBody = tv.length ? `<ul class="dly-list">${tv.map(g => `<li><button type="button" class="rw" data-hub="${esc(g.sport)}|${esc(g.lg || '')}|${esc(g.id)}"><span class="rw-t"><b>${esc(g.a.name)} v ${esc(g.b.name)}</b><small>${esc(g.short || '')}</small></span><span class="dly-num"><b class="num">${esc(hm(+g.date))}</b><small class="lb">${esc(window.flTV?.name ? window.flTV.name(g.tvNat) : g.tvNat)}</small></span></button></li>`).join('')}</ul>`
      : none('No more national TV games today');
    el.innerHTML = `<div class="dly-grid">
      ${card('best', 'Best-supported markets', bestBody, '<button type="button" class="lk" data-shell="pred">All predictions</button>')}
      ${card('moves', 'Biggest line movements', mvBody)}
      ${card('inj', 'Injury updates', injBody, '<button type="button" class="lk" data-page="injuries">Full reports</button>')}
      ${card('players', 'Followed players', plBody)}
      ${card('teams', 'Your teams today', tmBody)}
      ${card('results', 'Results from yesterday', ydBody)}
      ${card('top', 'Most researched today', topBody)}
      ${card('tv', 'Still to come on national TV', tvBody)}</div>`;
  }
  function render(el, arg) {
    const now = new Date();
    el.innerHTML = `<div class="vst dly"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Your day</h1><p class="pg-sub">${esc(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}. What changed for your teams, players and picks, and where to start.</p></div>
      <div class="cx-row"><button type="button" class="bt ghost" data-page="recap">${ic('bars')}Your week</button><button type="button" class="bt ghost" data-page="inbox">${ic('bell')}Alerts</button></div></header>
      <div id="dlyBody"></div></div>`;
    draw(); go(arg);
  }
  const go = arg => { if (!arg) return; setTimeout(() => { const s = document.getElementById('dly-' + arg); if (s) { s.scrollIntoView({ block: 'start' }); s.focus({ preventScroll: true }) } }, 60) };
  let drawT = 0;
  function changed() {
    clearTimeout(drawT); drawT = setTimeout(() => {
      if (window.flPages?.current?.() === 'today') { const a = document.activeElement, keep = a?.closest?.('#dlyBody') ? a.closest('section')?.id : null; draw(); if (keep) document.getElementById(keep)?.focus({ preventScroll: true }) }
      if (window.flPages?.current?.() === 'recap') drawRecap();
      document.dispatchEvent(new CustomEvent('fl:daily'));
    }, 120);
  }
  document.addEventListener('click', ev => {
    const l = ev.target.closest?.('[data-dlylab]'); if (l) { let a = {}; try { a = JSON.parse(l.dataset.dlylab) } catch (e) {} window.flPages?.hide?.(); return window.flLab?.open ? window.flLab.open(a) : document.querySelector('[data-shell="lab"]')?.click() }
    const g = ev.target.closest?.('#pg-today [data-hub]'); if (g) { const [sport, lg, id] = g.dataset.hub.split('|'); window.flPages?.hide?.(); window.flHub?.show?.(); const b = document.createElement('button'); b.hidden = true; b.dataset.hub = `${sport}|${lg}|${id}`; document.getElementById('hub')?.appendChild(b); b.click(); b.remove() }
  });
  ['fl:injuries', 'fl:feed'].forEach(e => document.addEventListener(e, () => { if (['today', 'recap'].includes(window.flPages?.current?.())) changed(); else document.dispatchEvent(new CustomEvent('fl:daily')) }));
  document.addEventListener('fl:hub', () => { if (window.flPages?.current?.() === 'today') changed() });

  /* ---------- the weekly recap (#/recap) ---------- */
  function week(from = day0() - 6 * 864e5, to = Date.now()) {
    const days = [...Array(7).keys()].map(i => dkey(from + i * 864e5)), rows = days.map(k => ({ k, d: LOG[k] || { p: [], s: [], f: 0, m: 0, n: 0 } }));
    const researched = new Set(rows.flatMap(r => r.d.p)), sports = {};
    rows.forEach(r => r.d.s.forEach(s => { sports[s] = (sports[s] || 0) + 1 }));
    const fol = picks().filter(f => f.at >= from && f.at <= to), res = fol.map(f => ({ f, e: graded(f) })).filter(x => x.e);
    const tally = xs => ({ w: xs.filter(x => x.e.result === 'won').length, l: xs.filter(x => x.e.result === 'lost').length, p: xs.filter(x => x.e.result === 'push').length, v: xs.filter(x => x.e.result === 'void').length });
    const bySport = {}; res.forEach(x => { (bySport[x.f.sport] = bySport[x.f.sport] || []).push(x) });
    const strong = Object.entries(bySport).map(([s, xs]) => ({ s, t: tally(xs) })).filter(x => x.t.w + x.t.l >= 2).sort((a, b) => b.t.w / (b.t.w + b.t.l) - a.t.w / (a.t.w + a.t.l) || (b.t.w + b.t.l) - (a.t.w + a.t.l))[0];
    const most = Object.entries(sports).sort((a, b) => b[1] - a[1])[0];
    return { rows, researched: researched.size, followed: fol.length, t: tally(res), graded: res.length, strong, most, moved: rows.reduce((n, r) => n + (r.d.m || 0), 0), streak: streak() };
  }
  function streak() { let n = 0; for (let t = day0(); ; t -= 864e5) { const d = LOG[dkey(t)]; if (d && d.n) n++; else if (t === day0()) continue; else break; if (n > 400) break } return n }
  const rec = t => `${t.w}–${t.l}${t.p ? `–${t.p}` : ''}`;
  function weekly() {
    const W = week(); if (!W.researched && !W.followed) return '';
    return [`You researched ${plural(W.researched, 'player')}`, W.followed ? `followed ${plural(W.followed, 'prediction')}` : '', W.graded ? `your followed predictions finished ${rec(W.t)}` : '',
      W.strong ? `your strongest sport was ${LG_NAME[W.strong.s] || W.strong.s}` : '', W.moved ? `${plural(W.moved, 'saved line')} moved` : ''].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
  }
  function summary() {
    const c = counts(), hub = window.flHub?.games?.() || [], F = window.flFeed, best = F ? F.ranked(F.now())[0] : null;
    return [c.mine ? `${plural(c.mine, 'game')} with your teams` : `${plural(hub.length, 'game')} today`, c.players ? `${plural(c.players, 'followed player')} with lines` : '', c.inj ? plural(c.inj, 'injury update') : '',
      best ? `best supported edge: ${best.name}, ${best.text} (${sign(F.edge(best))})` : ''].filter(Boolean).join(' · ');
  }
  const BAR_H = 64;
  function chart(W) {
    // seven bars, one per day: how many things you researched. The numbers are written under each bar, so the chart
    // never depends on its shapes alone, and a sentence says the same for screen readers.
    const max = Math.max(1, ...W.rows.map(r => r.d.n)), total = W.rows.reduce((n, r) => n + r.d.n, 0), busiest = [...W.rows].sort((a, b) => b.d.n - a.d.n)[0];
    const label = k => new Date(k + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
    return `<figure class="rcp-chart"><figcaption class="sr-only">Research by day: ${W.rows.map(r => `${label(r.k)} ${r.d.n}`).join(', ')}. ${total ? `Busiest day: ${label(busiest.k)}.` : ''}</figcaption>
      <div class="rcp-bars" aria-hidden="true">${W.rows.map(r => `<div class="rcp-bar"><span class="rcp-v num">${r.d.n || ''}</span><i style="height:${Math.round(r.d.n / max * BAR_H)}px"></i><small>${esc(label(r.k))}</small></div>`).join('')}</div></figure>`;
  }
  function drawRecap() {
    const el = document.getElementById('rcpBody'); if (!el) return; loadRecord();
    const W = week(), A = achievements();
    const stat = (n, l, sub = '') => `<div class="tile inset rcp-s"><b class="fig num">${n}</b><span>${esc(l)}</span>${sub ? `<small class="lb">${esc(sub)}</small>` : ''}</div>`;
    const quiet = !W.researched && !W.followed;
    el.innerHTML = `${quiet ? `<div class="card emp">${ic('bars', 28)}<b>Nothing to recap yet this week</b><p>Open players in the Lab and follow a few predictions. Your week is counted here, on this device.</p><button type="button" class="bt" data-shell="lab">Open the Lab</button></div>` : `
      <section class="card" aria-labelledby="rcpWkH"><div class="sec-h"><h2 id="rcpWkH">Last 7 days</h2><button type="button" class="bt ghost sm" data-rcpcopy>Copy summary</button></div>
        <p class="rcp-line">${esc(weekly())}</p>
        <div class="rcp-stats">${stat(W.researched, W.researched === 1 ? 'player researched' : 'players researched')}${stat(W.followed, W.followed === 1 ? 'prediction followed' : 'predictions followed')}
          ${stat(W.graded ? rec(W.t) : '–', 'followed predictions', W.graded ? `${W.graded} graded${W.t.v ? `, ${W.t.v} void` : ''}` : 'none graded yet')}
          ${stat(W.strong ? (LG_NAME[W.strong.s] || W.strong.s) : W.most ? (LG_NAME[W.most[0]] || W.most[0]) : '–', W.strong ? 'strongest sport' : 'most researched sport', W.strong ? rec(W.strong.t) : W.most ? 'no graded picks to compare yet' : '')}
          ${stat(W.moved, W.moved === 1 ? 'saved line moved' : 'saved lines moved')}${stat(W.streak, W.streak === 1 ? 'day research streak' : 'day research streak')}</div>
        ${chart(W)}
        <p class="lb">Past results don’t promise future ones. Counted on this device; a pick counts once it is graded in the pick record.</p></section>`}
      <section class="card" aria-labelledby="rcpAchH"><div class="sec-h"><h2 id="rcpAchH">Milestones</h2><span class="lb">${A.filter(a => a.at).length} of ${A.length}</span></div>
        <ul class="rcp-ach">${A.map(a => `<li class="${a.at ? 'got' : ''}"><span class="rcp-ach-i" aria-hidden="true">${ic(a.at ? 'check' : a.icon, 18)}</span><span class="rw-t"><b>${esc(a.name)}</b><small>${a.at ? `Reached ${esc(new Date(a.at).toLocaleDateString([], { day: 'numeric', month: 'short' }))}` : esc(a.how)}</small></span><span class="sr-only">${a.at ? 'Reached' : 'Not reached yet'}</span></li>`).join('')}</ul></section>`;
  }
  function renderRecap(el) {
    el.innerHTML = `<div class="vst rcp"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Your week</h1><p class="pg-sub">What you researched and followed in the last seven days, and how your followed predictions finished.</p></div>
      <button type="button" class="bt ghost" data-page="today">${ic('clock')}Your day</button></header><div id="rcpBody" class="vst" aria-live="polite"></div></div>`;
    drawRecap();
  }
  document.addEventListener('click', ev => { const b = ev.target.closest?.('[data-rcpcopy]'); if (!b) return; const t = `My Floodlight week: ${weekly()}`; try { navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied' }, () => {}) } catch (e) {} });

  /* ---------- milestones: few, plain, and never in the way ---------- */
  const ACH = [
    ['board', 'First saved board', 'Save a player or prop to a board in the Lab.', 'save', () => (store.get('fl.labBoards', []) || []).length > 0 || (window.flBoards?.list?.() || []).length > 0],
    ['five', 'Researched five sports', 'Research players in five different sports.', 'grid', () => new Set(Object.values(LOG).flatMap(d => d.s)).size >= 5],
    ['streak', 'Seven-day research streak', 'Research something seven days in a row.', 'clock', () => streak() >= 7],
    ['upset', 'Correct upset prediction', 'Pick an underdog that wins in a private competition.', 'trophy', () => !!store.get('fl.achUpset', 0)],
    ['teams', 'Followed ten teams', 'Follow ten teams.', 'star', () => favTeams().length >= 10],
    ['card', 'Perfect Prediction Card', 'Every pick on a tracked parlay hits.', 'ticket', () => !!store.get('fl.achCard', 0)]];
  let GOT = store.get('fl.ach', {});
  function checkAch() {
    let ch = false;
    for (const [k, name, , , test] of ACH) { if (GOT[k]) continue; let ok = false; try { ok = test() } catch (e) {} if (ok) { GOT[k] = Date.now(); ch = true; window.flNotify?.('achievement', `Milestone: ${name}`, 'See all your milestones on Your week.', { link: { page: 'recap' }, quiet: true }) } }
    if (ch) store.set('fl.ach', GOT);
  }
  const achievements = () => { checkAch(); return ACH.map(([k, name, how, icon]) => ({ k, name, how, icon, at: GOT[k] || 0 })) };
  // a perfect tracked parlay counts once its record says every leg hit
  async function checkCards() {
    if (GOT.card || !window.S?.me) return;
    try { const d = await fetch('/api/parlays', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null); if ((d?.parlays || []).some(p => p.legs?.length >= 2 && p.legs.every(l => l.res === 'won' || l.result === 'won'))) { store.set('fl.achCard', Date.now()); checkAch() } } catch (e) {}
  }
  setTimeout(() => { checkAch(); checkCards() }, 15000);

  window.flPages?.add('today', { title: 'Your day', render, fresh: true, onShow(el, arg) { loadMarkets(); loadTop(); loadYesterday(); loadRecord(); go(arg) } });
  window.flPages?.add('recap', { title: 'Your week', render: renderRecap, fresh: true, onShow() { loadRecord(true); checkCards() } });
  window.flDaily = { greeting, counts, summary, weekly, log, week, injuryNews, moves, newResults, markResultsSeen, achievements, graded };
})();
