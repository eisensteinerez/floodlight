/* Floodlight · alerts: what you hear about, and the checks that send it.
   Off until you turn game alerts on in Settings (pick, player and summary alerts have their own switches). Turning
   alerts on is the only thing that asks the browser for permission to show notifications; where notifications are
   blocked, the same alert shows as a quiet note in the page. Every alert also lands in the alerts inbox (inbox.js).
   What can ring:
   - Games of the teams you follow and games you watch: start, score changes (in basketball only lead changes and
     ties), final, and a confirmed starting lineup (soccer, from FotMob). Each team can have its own choices.
   - Players you follow: injury report changes (filtered by how serious) and line moves.
   - Picks you follow on Predictions: line moves, injury news, the market being taken off the board, and the grade.
     Each pick can have its own choices. (This file now sends these; Predictions' own copies stay quiet.)
   - Line alerts you set: "Tell me if LeBron James's points line moves from 24.5 to 25.5", on any provider or one.
   - New markets reaching a supported edge you choose, optionally only in your sports.
   - A daily summary and a weekly performance summary at the time you pick.
   Markets come from the one feed (marketfeed.js), injuries from the league reports (injuries.js), results from the pick
   record. Checks run while Floodlight is open in a tab, even a background one; there is no push service. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'fl.notify';
  const DEF = { on: false, start: true, score: true, final: true, lineup: true, quiet: false, qFrom: 23, qTo: 8, pkInjury: true, pkLine: true, pkResult: true, pkRemoved: true,
    plInjury: true, plLine: true, injSev: 'doubtful', edgeOn: false, edgeMin: 10, edgeMine: true, daily: false, dailyAt: 9, weekly: false, weeklyDay: 1, weeklyAt: 9,
    teams: {}, picks: {}, rules: [] };
  const read = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEF } } };
  const quietNow = () => { if (!A.quiet) return false; const h = new Date().getHours(); return A.qFrom > A.qTo ? h >= A.qFrom || h < A.qTo : h >= A.qFrom && h < A.qTo };
  const hr = h => new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  let A = read();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(A)) } catch {} };
  const can = () => 'Notification' in window;
  const perm = () => can() ? Notification.permission : 'unsupported';   // 'granted' | 'denied' | 'default' | 'unsupported'
  const advanced = () => window.flPlan?.can?.('advanced_alerts') ?? true;   // line and edge alerts may be a paid feature later
  const flat = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fmtL = v => Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const sign = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  // what each check last saw, so a change is told once and opening the page never rings
  let ST = store.get('fl.alertState', {}); ST.p = ST.p || {}; ST.pl = ST.pl || {}; ST.e = ST.e || {}; ST.lu = ST.lu || {}; ST.sum = ST.sum || {};
  const saveST = () => store.set('fl.alertState', ST);
  const send = (kind, title, body, o = {}) => window.flNotify ? window.flNotify(kind, title, body, o) : null;

  /* ---------- games ---------- */
  const favs = () => { try { return window.S?.fav || [] } catch { return [] } };
  const teamOf = (g, t) => favs().find(f => (f.tid && String(f.tid) === t.id && f.sport === g.sport) || flat(f.name) === flat(t.full) || flat(f.name) === flat(t.name));
  // a game rings when a team you follow (not a quiet one) wants that kind, or when you watch the game
  function wants(g, kind) {
    if (!A[kind]) return false;
    if (window.flHome?.watching?.(g.key)) return true;
    return [g.a, g.b].some(t => { const f = teamOf(g, t); if (!f || f.level === 'quiet') return false; const o = A.teams[f.id]; return !o || o[kind] !== false });
  }
  const mineG = g => !!(window.flHome?.loud ? window.flHome.loud(g) : (window.flHome?.isMine?.(g) || window.flHome?.watching?.(g.key)));
  const gameLink = g => ({ game: { sport: g.sport, lg: g.lg || '', id: g.id } });
  const seen = new Map();   // game key -> what we last saw: state, the two scores, who led
  const lead = g => { const a = +g.a.score, b = +g.b.score; return a > b ? 'a' : b > a ? 'b' : '=' };
  function check() {
    if (!A.on) return;
    for (const g of window.flHub?.games?.() || []) {
      if (!mineG(g)) continue;
      const now = { st: g.state, a: String(g.a.score ?? ''), b: String(g.b.score ?? ''), l: lead(g) }, was = seen.get(g.key); seen.set(g.key, now);
      if (!was) continue;   // first sight of a game only sets the baseline, so opening the page never rings
      const line = `${g.a.name} ${g.a.score}–${g.b.score} ${g.b.name}`, lg = g.lgName || g.short || '';
      if (was.st === 'pre' && now.st === 'in' && wants(g, 'start')) send('start', `${g.a.name} v ${g.b.name} has started`, [lg, g.tv].filter(Boolean).join(' · '), { link: gameLink(g), tag: 'st-' + g.key });
      else if (now.st === 'post' && was.st !== 'post' && wants(g, 'final')) send('final', `Final: ${line}`, lg, { link: gameLink(g), tag: 'fn-' + g.key });
      else if (now.st === 'in' && was.st === 'in' && wants(g, 'score') && (now.a !== was.a || now.b !== was.b)) {
        if (g.sport === 'basketball' && now.l === was.l) continue;   // a basket that does not change who leads stays quiet
        send('score', line, [lg, g.clock].filter(Boolean).join(' · '), { link: gameLink(g), silent: true, tag: 'sc-' + g.key });
      }
    }
    lineups();
  }
  // confirmed starting lineups: soccer games of your teams, from an hour and a half before kick-off (FotMob)
  const LU = { busy: false, at: {} };
  async function lineups() {
    if (!A.on || !A.lineup || LU.busy) return;
    const due = (window.flHub?.games?.() || []).filter(g => g.sport === 'soccer' && g.state === 'pre' && g.date - Date.now() < 90 * 60000 && g.date > Date.now() && !ST.lu[g.key] && wants(g, 'lineup') && Date.now() - (LU.at[g.key] || 0) > 8 * 60000);
    if (!due.length) return; LU.busy = true;
    for (const g of due.slice(0, 3)) {
      LU.at[g.key] = Date.now();
      const d = g.date, ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      try {
        const r = await fetch(`/api/fm/lineup?date=${ymd}&home=${encodeURIComponent(g.a.full || g.a.name)}&away=${encodeURIComponent(g.b.full || g.b.name)}`, { credentials: 'same-origin' }).then(x => x.ok ? x.json() : null);
        const ok = r && !r.error && r.home?.starters?.length && r.away?.starters?.length && !/predict/i.test(String(r.type || ''));
        if (ok) { ST.lu[g.key] = Date.now(); saveST(); send('lineup', `Lineups confirmed: ${g.a.name} v ${g.b.name}`, `${r.home.formation || ''} v ${r.away.formation || ''}`.trim() || 'Both starting elevens are out.', { link: gameLink(g), tag: 'lu-' + g.key }) }
      } catch (e) {}
    }
    LU.busy = false;
  }
  document.addEventListener('fl:hub', check);
  /* While game alerts are on and one of your games is today and not over, keep the scoreboard fresh even when this tab
     is in the background (Home and Live only refresh while you look at them). Browsers slow background timers to about
     a minute, which is the pace we want anyway. */
  setInterval(() => {
    if (!A.on || !document.hidden) return;
    const H = window.flHub; if (!H?.games) return;
    if (H.games().some(g => g.state !== 'post' && mineG(g) && g.date - Date.now() < 3 * 3600e3)) H.load?.(true);
  }, 60000);

  /* ---------- players, picks, line rules and edge thresholds ---------- */
  const SEV = { out: ['out'], doubtful: ['out', 'doubtful'], any: ['out', 'doubtful', 'questionable', 'dtd', 'probable', 'active', ''] };
  const sevOk = lv => (SEV[A.injSev] || SEV.doubtful).includes(lv || '');
  const pickParts = f => { const p = String(f.id || '').split(':'); return { sport: f.sport || p[1], k: p[3] || '' } };
  const pickPref = (f, kind) => (A.picks[f.k] || {})[kind] !== false;
  function marketFor(f, list) { const { sport, k } = pickParts(f), n = flat(f.name); return list.find(m => flat(m.name) === n && m.sport === sport && (!k || m.k === k)) || null }
  function removedFor(f) { const R = window.flMarkets?.removed?.() || [], { sport, k } = pickParts(f), n = flat(f.name); return R.find(m => flat(m.name) === n && m.sport === sport && (!k || m.k === k)) || null }
  const linkLab = m => ({ lab: window.flFeed?.labArgs ? window.flFeed.labArgs(m) : { sport: m.sport, name: m.name, kind: 'player' } });
  const lineOn = (m, prov) => { if (!prov || prov === 'any') return m.line; const o = (m.offers || []).find(x => flat(x.book || x.provider) === flat(prov)); return o ? o.line : null };
  let busy = false;
  function checkMarkets() {
    const F = window.flFeed; if (!F || busy) return; busy = true;
    try {
      const list = F.now(), I = window.flInjuries; let ch = false;
      // picks you follow
      for (const f of store.get('fl.pdFollow', []) || []) {
        if (!f || !f.k) continue;
        const s = ST.p[f.k] || (ST.p[f.k] = {}), m = marketFor(f, list), started = f.start && Date.now() > f.start;
        if (m && m.line != null) {
          if (s.line == null) { s.line = m.line; ch = true }
          else if (+s.line !== +m.line) { if (A.pkLine && pickPref(f, 'line')) send('line', `${f.name}: line ${fmtL(s.line)} → ${fmtL(m.line)}`, `${m.text || f.text}. A pick you follow.`, { link: linkLab(m), tag: `pl-${f.k}-${m.line}` }); window.flDaily?.log?.('moved'); s.line = m.line; ch = true }
        }
        const gone = !started && !s.gone && removedFor(f);
        if (gone) { s.gone = 1; ch = true; if (A.pkRemoved && pickPref(f, 'removed')) send('removed', `${f.name}: taken off the board`, `${f.text}. ${gone.removalReason || gone.statusLabel || 'The market is no longer open.'}`, { link: { page: 'predictions' }, tag: 'rm-' + f.k }) }
        if (I && f.sport && I.PATH?.[f.sport] && I.ready(f.sport) && !started) {
          const st = I.status(f.sport, f.name), now = st ? (st.status || I.LEVEL_NAME[st.lv]) : '';
          if (s.inj === undefined) { s.inj = now; ch = true }
          else if (now !== s.inj) { if (A.pkInjury && pickPref(f, 'injury') && (!st || sevOk(st.lv))) send('injury', `${f.name}: ${now ? `now ${now}` : 'off the injury report'}`, `${f.text}. ${st?.what ? st.what + '. ' : ''}From the league injury report.`, { link: { page: 'injuries', arg: f.sport }, tag: `pi-${f.k}-${now}` }); s.inj = now; ch = true }
        }
        const e = !s.told && f.start && Date.now() - f.start > 3 * 3600e3 ? window.flDaily?.graded?.(f) : null;
        if (e) { s.told = 1; ch = true; if (A.pkResult && pickPref(f, 'result')) send('graded', `${f.name}: ${{ won: 'hit', lost: 'missed', push: 'push', void: 'void' }[e.result]}${e.actual != null && e.actual !== '' ? ` (${e.actual})` : ''}`, `${f.text}. Graded from the game log; the receipt is in Pick history.`, { link: { page: 'history' }, tag: 'gr-' + f.k }) }
      }
      // players you follow
      for (const p of (store.get('fl.follows', []) || []).filter(x => x && x.k === 'player' && x.name)) {
        const pk = `${p.lg}:${flat(p.name)}`, s = ST.pl[pk] || (ST.pl[pk] = { lines: {} });
        for (const m of F.forPlayer(p.name, list)) {
          const mk = F.key(m).replace(/:[\d.]+$/, ''), was = s.lines[mk];
          if (was == null) { s.lines[mk] = m.line; ch = true }
          else if (+was !== +m.line) { if (A.plLine) send('line', `${p.name}: ${m.label || 'line'} ${fmtL(was)} → ${fmtL(m.line)}`, `${[m.team, m.opp].filter(Boolean).join(' v ')}. A player you follow.`, { link: linkLab(m), tag: `pp-${mk}-${m.line}` }); s.lines[mk] = m.line; ch = true }
        }
        if (I && I.PATH?.[p.lg]) { if (!I.ready(p.lg)) I.load(p.lg); else { const st = I.status(p.lg, p.name), now = st ? (st.status || I.LEVEL_NAME[st.lv]) : '';
          if (s.inj === undefined) { s.inj = now; ch = true } else if (now !== s.inj) { if (A.plInjury && (!st || sevOk(st.lv))) send('injury', `${p.name}: ${now ? `now ${now}` : 'off the injury report'}`, `${st?.what ? st.what + '. ' : ''}${st?.teamName || ''}. A player you follow.`, { link: { page: 'injuries', arg: p.lg }, tag: `ij-${pk}-${now}` }); s.inj = now; ch = true } } }
      }
      // line alerts you set
      if (advanced()) for (const r of A.rules) {
        if (!r.on || r.fired) continue;
        const m = list.find(x => flat(x.name) === flat(r.player) && x.sport === r.sport && x.k === r.k); if (!m) continue;
        const line = lineOn(m, r.provider); if (line == null) continue;
        const hit = r.cond === 'move' ? +line !== +r.from : r.cond === 'above' ? +line >= +r.value : +line <= +r.value;
        if (hit) { r.fired = Date.now(); r.got = line; save(); send('line', `${r.player}: ${r.label || r.k} line ${fmtL(r.from)} → ${fmtL(line)}`, `${r.provider && r.provider !== 'any' ? `On ${r.provider}. ` : ''}${condText(r)}.`, { link: linkLab(m), tag: 'rule-' + r.id }) }
      }
      // new markets that reach your supported edge
      if (A.edgeOn && advanced()) {
        const day = new Date().toDateString(); if (ST.e.day !== day) { ST.e = { day, k: [] }; ch = true }
        const mySports = new Set((window.flHome?.mine?.()?.sports || []).map(s => ({ basketball: 'nba', football: 'nfl', hockey: 'nhl', baseball: 'mlb', soccer: 'soccer' })[s]).filter(Boolean));
        const fresh = F.ranked(list).filter(m => F.edge(m) >= A.edgeMin && !ST.e.k.includes(F.key(m)) && (!A.edgeMine || !mySports.size || mySports.has(m.sport)));
        if (fresh.length && ST.e.base) {
          const top = fresh[0]; send('edge', `${top.name}: ${top.text}, ${top.sedge != null ? 'supported edge' : 'edge'} ${sign(F.edge(top))}`, `${[top.game || [top.team, top.opp].filter(Boolean).join(' v '), fresh.length > 1 ? `and ${fresh.length - 1} more at ${sign(A.edgeMin)} or better` : ''].filter(Boolean).join(' · ')}`, { link: { page: 'predictions' }, tag: 'edge-' + F.key(top) });
        }
        ST.e.k = [...ST.e.k, ...fresh.map(F.key)].slice(-600); ST.e.base = 1; ch = true;
      }
      if (ch) saveST();
    } finally { busy = false }
  }
  const condText = r => r.cond === 'move' ? `Any move from ${fmtL(r.from)}` : r.cond === 'above' ? `Moves to ${fmtL(r.value)} or higher` : `Moves to ${fmtL(r.value)} or lower`;
  ['fl:feed', 'fl:markets', 'fl:board', 'fl:injuries'].forEach(e => document.addEventListener(e, () => setTimeout(checkMarkets, 50)));
  setInterval(() => { checkMarkets(); summaries() }, 120000);
  setTimeout(() => { checkMarkets(); summaries() }, 9000);
  // the injury reports for followed picks and players load on their own every ten minutes
  setInterval(() => { const I = window.flInjuries; if (!I) return; const sp = new Set([...(store.get('fl.pdFollow', []) || []).map(f => f.sport), ...(store.get('fl.follows', []) || []).filter(x => x.k === 'player').map(x => x.lg)]); sp.forEach(s => I.PATH?.[s] && I.load(s, true)) }, 10 * 60000);

  /* ---------- daily and weekly summaries ---------- */
  function summaries() {
    const now = new Date(), d = now.toDateString();
    if (A.daily && now.getHours() >= A.dailyAt && ST.sum.d !== d) { const t = window.flDaily?.summary?.(); if (t) { ST.sum.d = d; saveST(); send('summary', `Your day on Floodlight`, t, { link: { page: 'today' }, tag: 'sum-' + d }) } }
    const wk = `${now.getFullYear()}-${Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 6048e5)}`;
    if (A.weekly && now.getDay() === +A.weeklyDay && now.getHours() >= A.weeklyAt && ST.sum.w !== wk) { const t = window.flDaily?.weekly?.(); ST.sum.w = wk; saveST(); if (t) send('weekly', 'Your week on Floodlight', t, { link: { page: 'recap' }, tag: 'wk-' + wk }) }
  }

  /* ---------- previews: what each alert looks like, sent to the page only ---------- */
  const PV_NAME = { start: 'Game starting', score: 'Score change', final: 'Final score', lineup: 'Lineup confirmed', injury: 'Injury news', line: 'Line move', removed: 'Market removed', graded: 'Prediction graded', edge: 'Supported edge', summary: 'Daily summary', weekly: 'Weekly summary' };
  const PV = { k: 'line' };
  const PREVIEW = {
    start: ['start', 'Lakers v Celtics has started', 'NBA · ESPN'], score: ['score', 'Lakers 88–90 Celtics', 'NBA · Q4 4:12'], final: ['final', 'Final: Lakers 110–104 Celtics', 'NBA'],
    lineup: ['lineup', 'Lineups confirmed: Arsenal v Chelsea', '4-3-3 v 4-2-3-1'], injury: ['injury', 'LeBron James: now Questionable', 'Ankle. From the league injury report.'],
    line: ['line', 'LeBron James: points line 24.5 → 25.5', 'Lakers v Celtics. A player you follow.'], removed: ['removed', 'Jalen Brunson: taken off the board', 'Over 26.5 points. The player was ruled out.'],
    graded: ['graded', 'Jalen Brunson: hit (31)', 'Over 26.5 points. The receipt is in Pick history.'], edge: ['edge', 'Anthony Edwards: Over 25.5 points, supported edge +12', 'Timberwolves v Grizzlies'],
    summary: ['summary', 'Your day on Floodlight', '3 games with your teams · 2 followed players with lines · best supported edge +12'], weekly: ['weekly', 'Your week on Floodlight', 'You researched 18 players, followed 7 predictions and your followed predictions finished 5–2.'] };
  function preview(k) { const p = PREVIEW[k]; if (!p) return; window.flNotify ? window.flNotify(p[0], `Preview · ${p[1]}`, p[2], { preview: true }) : null }

  /* ---------- Settings › Alerts ---------- */
  const sw = (k, label, sub, dis = false) => `<div class="st-row"><div class="st-l"><label for="al-${k}">${label}</label><small>${sub}</small></div><div class="st-c"><input class="sw" type="checkbox" role="switch" id="al-${k}" data-al="${k}" ${A[k] ? 'checked' : ''}${dis ? ' disabled' : ''}></div></div>`;
  const sel = (k, label, opts, cur) => `<label class="sr-only" for="al-${k}">${label}</label><select class="inp sm" id="al-${k}" data-alq="${k}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const HOURS = [...Array(24).keys()].map(h => [h, hr(h)]), DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];
  const RULE = { open: false, player: '', sport: '', k: '', cond: 'move', value: '', provider: 'any', err: '' };
  function ruleForm() {
    const F = window.flFeed, list = F ? F.now() : [], names = [...new Map(list.map(m => [flat(m.name), m])).values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 400);
    const pm = RULE.player ? list.filter(m => flat(m.name) === flat(RULE.player)) : [], cur = pm.find(m => m.k === RULE.k) || pm[0];
    const books = cur ? [...new Set((cur.offers || []).map(o => o.book || o.provider).filter(Boolean))] : [];
    return `<form class="al-rule" data-alrule aria-labelledby="alRuleH"><h4 id="alRuleH" class="st-sub">New line alert</h4>
      <div class="al-rule-g"><label for="alRp">Player</label><input class="inp sm" id="alRp" name="player" list="alRpL" autocomplete="off" value="${esc(RULE.player)}" placeholder="For example: LeBron James…" data-alrf="player">
        <datalist id="alRpL">${names.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
        <label for="alRk">Line</label><select class="inp sm" id="alRk" data-alrf="k"${pm.length ? '' : ' disabled'}>${pm.length ? pm.map(m => `<option value="${esc(m.k)}"${cur && m.k === cur.k ? ' selected' : ''}>${esc(m.label || m.k)} ${fmtL(m.line)}</option>`).join('') : '<option>Choose a player with a line today</option>'}</select>
        <label for="alRc">When</label><select class="inp sm" id="alRc" data-alrf="cond"><option value="move"${RULE.cond === 'move' ? ' selected' : ''}>It moves at all</option><option value="above"${RULE.cond === 'above' ? ' selected' : ''}>It reaches or passes</option><option value="below"${RULE.cond === 'below' ? ' selected' : ''}>It drops to or below</option></select>
        ${RULE.cond !== 'move' ? `<label for="alRv">Line value</label><input class="inp sm" id="alRv" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(RULE.value || (cur ? (RULE.cond === 'above' ? cur.line + 1 : Math.max(0, cur.line - 1)) : ''))}" data-alrf="value">` : ''}
        <label for="alRb">Provider</label><select class="inp sm" id="alRb" data-alrf="provider"><option value="any">Any provider</option>${books.map(b => `<option value="${esc(b)}"${RULE.provider === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
      ${RULE.err ? `<p class="al-err" role="alert">${esc(RULE.err)}</p>` : ''}
      <div class="st-foot"><button type="submit" class="bt sm">Add line alert</button><button type="button" class="bt ghost sm" data-al-rule="cancel">Cancel</button></div></form>`;
  }
  function card() {
    const p = perm(), F = favs(), W = window.flHome?.mine?.().watch?.length || 0, adv = advanced();
    const pl = (store.get('fl.follows', []) || []).filter(x => x && x.k === 'player'), pk = (store.get('fl.pdFollow', []) || []).filter(Boolean);
    const who = F.length || W ? `You follow ${F.length} ${F.length === 1 ? 'team' : 'teams'} and have ${W} ${W === 1 ? 'game' : 'games'} on your watchlist.` : 'You don’t follow any teams or watch any games yet, so there is nothing to alert you about.';
    const state = !A.on ? '' : p === 'granted' ? 'Notifications are allowed. Alerts arrive while Floodlight is open in a tab, even in the background, and every alert is kept in your alerts inbox.'
      : p === 'denied' ? 'This browser blocks notifications for Floodlight, so alerts show as a small note inside the page and in your alerts inbox. To get them outside the page, allow notifications for this site in your browser’s site settings.'
      : p === 'unsupported' ? 'This browser can’t show notifications, so alerts show as a small note inside the page and in your alerts inbox.'
      : 'Alerts show as a small note inside the page and in your alerts inbox for now. To get them outside the page too, allow browser notifications; your browser will ask once.';
    const gRow = (k, label, sub) => sw(k, label, sub, !A.on);
    const teamRows = F.length ? `<table class="al-t"><caption class="sr-only">Alerts for each team you follow</caption><thead><tr><th scope="col">Team</th>${['start', 'score', 'final', 'lineup'].map(k => `<th scope="col">${{ start: 'Start', score: 'Score', final: 'Final', lineup: 'Lineup' }[k]}</th>`).join('')}</tr></thead>
      <tbody>${F.map(f => `<tr><th scope="row">${esc(f.name)}${f.level === 'quiet' ? ' <small class="lb">quiet: no alerts</small>' : ''}</th>${['start', 'score', 'final', 'lineup'].map(k => `<td><label class="al-cbl"><input type="checkbox" class="al-cb" data-alteam="${esc(f.id)}|${k}" aria-label="${esc(f.name)}: ${k === 'lineup' ? 'lineup confirmed' : k}"${(A.teams[f.id] || {})[k] !== false && A[k] ? ' checked' : ''}${!A.on || !A[k] || f.level === 'quiet' ? ' disabled' : ''}></label></td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="lb">Follow a team on Home or its own page to choose alerts for it.</p>';
    const pickRows = pk.length ? `<table class="al-t"><caption class="sr-only">Alerts for each pick you follow</caption><thead><tr><th scope="col">Pick</th><th scope="col">Line</th><th scope="col">Injury</th><th scope="col">Removed</th><th scope="col">Result</th></tr></thead>
      <tbody>${pk.slice(-30).reverse().map(f => `<tr><th scope="row">${esc(f.name)} <small class="lb">${esc(f.text || '')}</small></th>${['line', 'injury', 'removed', 'result'].map(k => `<td><label class="al-cbl"><input type="checkbox" class="al-cb" data-alpick="${esc(f.k)}|${k}" aria-label="${esc(f.name)}, ${esc(f.text || '')}: ${k}"${pickPref(f, k) ? ' checked' : ''}></label></td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="lb">Follow a pick on Predictions to choose alerts for it.</p>';
    const rules = A.rules.length ? `<ul class="al-rules">${A.rules.map(r => `<li><span class="rw-t"><b>${esc(r.player)}: ${esc(r.label || r.k)} from ${fmtL(r.from)}</b><small>${esc(condText(r))}${r.provider && r.provider !== 'any' ? ` · on ${esc(r.provider)}` : ' · any provider'}${r.fired ? ` · sent ${esc(new Date(r.fired).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))} at ${fmtL(r.got)}` : ''}</small></span>
        ${r.fired ? `<button type="button" class="bt ghost sm" data-al-rule="rearm:${esc(r.id)}">Watch again<span class="sr-only"> ${esc(r.player)}</span></button>` : ''}<button type="button" class="ib" data-al-rule="del:${esc(r.id)}" aria-label="Delete the line alert for ${esc(r.player)}">${window.flShell?.ic?.('x', 16) || '×'}</button></li>`).join('')}</ul>` : '';
    return `<section class="card feature st-card" id="stAlerts" aria-labelledby="stAlH">
      <p class="st-crumb">Settings › Alerts</p>
      <div class="st-h"><h2 id="stAlH">Alerts</h2><button type="button" class="bt ghost sm" data-page="inbox">Open alerts inbox</button></div>
      <p class="lb al-who">${esc(who)} <button type="button" class="lk" data-page-home>${F.length || W ? 'Change the teams you follow' : 'Choose teams to follow'}</button></p>
      <div class="st-rows">
        <div class="st-row"><div class="st-l"><label for="al-on">Game alerts</label><small>Turning this on shows a sample first. The browser is asked for permission only when you choose. Kept on this device.</small></div>
          <div class="st-c"><input class="sw" type="checkbox" role="switch" id="al-on" data-al="on" ${A.on ? 'checked' : ''}></div></div>
        ${gRow('start', 'Game starting', 'When one of your games kicks off or tips off.')}
        ${gRow('score', 'Score changes', 'Every goal, run or score. In basketball, only lead changes and ties.')}
        ${gRow('final', 'Final score', 'When one of your games ends.')}
        ${gRow('lineup', 'Starting lineup confirmed', 'Soccer only for now: when both elevens are named, about an hour before kick-off.')}
        <details class="st-drw"><summary>Choose alerts team by team</summary>${teamRows}</details>
        <div class="st-row"><div class="st-l"><label for="al-quiet">Quiet hours</label><small>No browser notifications ${hr(A.qFrom)} to ${hr(A.qTo)}. Alerts still go to your inbox, and an open page still shows a quiet note.</small></div>
          <div class="st-c al-q"><input class="sw" type="checkbox" role="switch" id="al-quiet" data-al="quiet" ${A.quiet ? 'checked' : ''}>
            ${A.quiet ? `${sel('qFrom', 'From', HOURS, A.qFrom)}<span aria-hidden="true">to</span>${sel('qTo', 'To', HOURS, A.qTo)}` : ''}</div></div>

        <h3 class="st-sub">Players you follow</h3>
        <p class="lb">${pl.length ? `${pl.length} ${pl.length === 1 ? 'player' : 'players'}: ${esc(pl.slice(0, 6).map(x => x.name).join(', '))}${pl.length > 6 ? ' and more' : ''}.` : 'Press Follow on a player’s profile to hear about them.'} These work whether or not game alerts are on.</p>
        ${sw('plInjury', 'Injury news', 'When a player you follow joins, leaves or changes status on the injury report.')}
        ${sw('plLine', 'Line moves', 'When any line for a player you follow moves.')}
        <div class="st-row"><div class="st-l"><label for="al-injSev">Injury news to include</label><small>For players and picks you follow.</small></div><div class="st-c">${sel('injSev', 'Injury news to include', [['out', 'Ruled out only'], ['doubtful', 'Out or doubtful'], ['any', 'Every change, including questionable']], A.injSev)}</div></div>

        <h3 class="st-sub">Picks you follow</h3>
        <p class="lb">Follow a pick on Predictions to hear about it.</p>
        ${sw('pkLine', 'Line moves', 'When the line on a pick you follow moves.')}
        ${sw('pkInjury', 'Injury news', 'When the player in a pick you follow changes status on the injury report.')}
        ${sw('pkRemoved', 'Market removed', 'When a pick you follow is taken off the board before its game, with the reason.')}
        ${sw('pkResult', 'Prediction graded', 'When a pick you follow is graded: hit, miss, push or void.')}
        <details class="st-drw"><summary>Choose alerts pick by pick</summary>${pickRows}</details>

        <h3 class="st-sub">Line alerts</h3>
        ${adv ? `<p class="lb">Hear when one line moves, or reaches a number, on any provider or one you choose.</p>${rules}${RULE.open ? ruleForm() : '<div class="st-foot"><button type="button" class="bt ghost sm" data-al-rule="new">Add a line alert</button></div>'}
        <div class="st-row"><div class="st-l"><label for="al-edgeOn">Supported edge alerts</label><small>When a new market reaches the supported edge you choose. At most one alert per refresh, with how many more qualify.</small></div>
          <div class="st-c al-q"><input class="sw" type="checkbox" role="switch" id="al-edgeOn" data-al="edgeOn" ${A.edgeOn ? 'checked' : ''}>${A.edgeOn ? sel('edgeMin', 'Minimum supported edge', [5, 8, 10, 12, 15, 20].map(n => [n, `+${n} or more`]), A.edgeMin) : ''}</div></div>
        ${A.edgeOn ? sw('edgeMine', 'Only in my sports', 'Skip markets outside the sports you picked on Home.') : ''}` : '<p class="lb">Line alerts and supported edge alerts are part of Floodlight Plus.</p>'}

        <h3 class="st-sub">Summaries</h3>
        <div class="st-row"><div class="st-l"><label for="al-daily">Daily summary</label><small>Your teams’ games, followed players with lines, injury news and the best supported edge, once a day.</small></div>
          <div class="st-c al-q"><input class="sw" type="checkbox" role="switch" id="al-daily" data-al="daily" ${A.daily ? 'checked' : ''}>${A.daily ? sel('dailyAt', 'Daily summary time', HOURS, A.dailyAt) : ''}</div></div>
        <div class="st-row"><div class="st-l"><label for="al-weekly">Weekly performance summary</label><small>What you researched and how your followed predictions finished, once a week.</small></div>
          <div class="st-c al-q"><input class="sw" type="checkbox" role="switch" id="al-weekly" data-al="weekly" ${A.weekly ? 'checked' : ''}>${A.weekly ? `${sel('weeklyDay', 'Weekly summary day', DAYS, A.weeklyDay)}${sel('weeklyAt', 'Weekly summary time', HOURS, A.weeklyAt)}` : ''}</div></div>
      </div>
      ${A.on ? `<p class="al-state lb" role="status">${esc(state)}</p>` : ''}
      <h3 class="st-sub al-pv-h">See what an alert looks like</h3>
      <div class="st-foot al-pv"><label class="sr-only" for="alPv">Alert to preview</label><select class="inp sm" id="alPv" data-alpv>${Object.entries(PV_NAME).map(([k, l]) => `<option value="${k}"${PV.k === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select><button type="button" class="bt ghost sm" data-al-prev>Preview<span class="sr-only"> this alert on the page</span></button></div>
      <p class="lb">A preview shows on this page only and is not kept. A test notification goes through your browser, so you can check that notifications arrive, and is kept in your inbox.</p>
      <div class="st-foot">${A.on && p === 'default' ? '<button type="button" class="bt sm" data-al-ask>Allow browser notifications</button>' : ''}<button type="button" class="bt ghost sm" data-al-test>Send a test notification</button></div>
    </section>`;
  }
  const repaint = focusId => { const el = document.getElementById('stAlerts'); if (!el) return; const open = [...el.querySelectorAll('details')].map(d => d.open); el.outerHTML = card(); const nw = document.getElementById('stAlerts'); [...(nw?.querySelectorAll('details') || [])].forEach((d, i) => { if (open[i]) d.open = true }); if (focusId) document.getElementById(focusId)?.focus() };
  document.addEventListener('change', ev => {
    const t = ev.target, k = t.dataset?.al;
    if (k) {
      A[k] = t.checked; save();
      if (k === 'on' && A.on) {
        for (const g of window.flHub?.games?.() || []) if (mineG(g)) seen.set(g.key, { st: g.state, a: String(g.a.score ?? ''), b: String(g.b.score ?? ''), l: lead(g) });
        send('test', 'This is how an alert looks', 'Your teams’ starts, scores and finals arrive like this while Floodlight is open, and are kept in your alerts inbox.', { preview: true });
      }
      return repaint(t.id);
    }
    if (t.dataset?.alpv !== undefined) { PV.k = t.value; return }
    const q = t.dataset?.alq; if (q) { A[q] = q === 'injSev' ? t.value : +t.value; save(); return repaint(t.id) }
    const tm = t.dataset?.alteam; if (tm) { const [id, kind] = tm.split('|'); A.teams[id] = { ...(A.teams[id] || {}), [kind]: t.checked }; save(); return }
    const pc = t.dataset?.alpick; if (pc) { const i = pc.lastIndexOf('|'), id = pc.slice(0, i), kind = pc.slice(i + 1); A.picks[id] = { ...(A.picks[id] || {}), [kind]: t.checked }; save(); return }
    const rf = t.dataset?.alrf; if (rf) { RULE[rf] = t.value; if (rf === 'player') { RULE.k = ''; RULE.provider = 'any' } if (rf === 'cond') RULE.value = ''; RULE.err = ''; return repaint(t.id) }
  });
  document.addEventListener('submit', ev => {
    if (!ev.target.matches?.('[data-alrule]')) return; ev.preventDefault();
    const F = window.flFeed, list = F ? F.now() : [], m = list.find(x => flat(x.name) === flat(RULE.player) && (!RULE.k || x.k === RULE.k));
    if (!m) { RULE.err = 'Choose a player who has a line today, from the list.'; return repaint('alRp') }
    const from = lineOn(m, RULE.provider) ?? m.line, v = parseFloat(document.getElementById('alRv')?.value ?? RULE.value);
    if (RULE.cond !== 'move' && !isFinite(v)) { RULE.err = 'Enter the line value to watch for.'; return repaint('alRv') }
    if (RULE.cond === 'above' && v <= from) { RULE.err = `The line is ${fmtL(from)} now. Enter a higher number, or choose “It moves at all”.`; return repaint('alRv') }
    if (RULE.cond === 'below' && v >= from) { RULE.err = `The line is ${fmtL(from)} now. Enter a lower number, or choose “It moves at all”.`; return repaint('alRv') }
    A.rules = [...A.rules, { id: Date.now().toString(36), sport: m.sport, player: m.name, k: m.k, label: m.label || m.k, cond: RULE.cond, value: RULE.cond === 'move' ? null : v, from, provider: RULE.provider || 'any', on: true, at: Date.now() }].slice(-40);
    save(); Object.assign(RULE, { open: false, player: '', k: '', cond: 'move', value: '', provider: 'any', err: '' }); repaint(); document.querySelector('[data-al-rule="new"]')?.focus();
  });
  document.addEventListener('click', ev => {
    if (ev.target.closest?.('[data-al-test]')) send('test', 'Test notification from Floodlight', 'If you can read this outside the page, browser notifications work. It is also in your alerts inbox.', { tag: 'test-' + Date.now() });
    if (ev.target.closest?.('[data-al-prev]')) preview(document.getElementById('alPv')?.value || PV.k);
    if (ev.target.closest?.('[data-al-ask]')) { (async () => { try { await Notification.requestPermission() } catch {} repaint('al-on') })() }
    if (ev.target.closest?.('[data-al-reset]')) { reset(); repaint('al-on') }
    if (ev.target.closest?.('[data-page-home]')) window.flHome?.edit ? window.flHome.edit() : window.flHub?.show?.();
    const r = ev.target.closest?.('[data-al-rule]'); if (r) { const [a, id] = r.dataset.alRule.split(':');
      if (a === 'new') { RULE.open = true; repaint('alRp') }
      if (a === 'cancel') { RULE.open = false; RULE.err = ''; repaint(); document.querySelector('[data-al-rule="new"]')?.focus() }
      if (a === 'del') { A.rules = A.rules.filter(x => x.id !== id); save(); repaint(); document.querySelector('[data-al-rule="new"]')?.focus() }
      if (a === 'rearm') { const x = A.rules.find(y => y.id === id); if (x) { const F = window.flFeed, m = F?.now().find(y => flat(y.name) === flat(x.player) && y.k === x.k); x.fired = 0; if (m) x.from = lineOn(m, x.provider) ?? m.line; save(); repaint() } } }
  });

  function reset() { A = { ...DEF, teams: {}, picks: {}, rules: [] }; save() }
  const set = patch => { A = { ...A, ...patch }; save() };   // the first-visit setup's switches
  // another page (a prop row, a player panel) can start a line alert: flAlerts.watchLine(market, { cond, value, provider })
  function watchLine(m, o = {}) { if (!m || m.line == null) return false; A.rules = [...A.rules, { id: Date.now().toString(36), sport: m.sport, player: m.name, k: m.k, label: m.label || m.k, cond: o.cond || 'move', value: o.value ?? null, from: m.line, provider: o.provider || 'any', on: true, at: Date.now() }].slice(-40); save(); return true }
  /* Predictions asks flAlerts.pick(kind) before sending its own pick alerts. This file now sends every pick alert (with
     per-pick choices and the inbox), so the answer is no, and Predictions' own copies stay quiet. */
  window.flAlerts = { on: () => A.on, card, reset, set, pick: () => false, quiet: quietNow, watchLine, settings: () => ({ ...A }), check: checkMarkets };
})();
