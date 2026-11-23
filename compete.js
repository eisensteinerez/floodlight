/* Floodlight · private competitions (#/groups): friend groups pick game winners and player lines for virtual points.
   No money anywhere: no stakes, no entry fee, no prizes. The server (groups.py) keeps the groups, locks each pick when
   its game starts, grades it from the final or the box score, and keeps the weekly and season leaderboards.
   Routes: #/groups (your groups), #/groups/<id> (one group), #/groups/join/<CODE> (an invite link). */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s = 18) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const C = { list: null, cur: null, tab: 'pick', err: '', busy: false, join: null, confirm: '', msg: '' };
  const TABS = [['pick', 'Make picks'], ['week', 'This week'], ['season', 'Season'], ['picks', 'Locked picks'], ['members', 'Members']];
  const LG_OK = { nfl: 'NFL', fbs: 'College football', nba: 'NBA', cbb: 'College basketball', wnba: 'WNBA', nhl: 'NHL', mlb: 'MLB', soccer: 'Soccer' };
  const RES = { won: 'Correct', lost: 'Wrong', push: 'Push', void: 'Void' };
  const hm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const when = t => { const d = new Date(t), n = new Date(); return (d.toDateString() === n.toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + hm(t) };
  const me = () => window.S?.me || null;
  async function call(path, body) {
    const r = await fetch(path, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `The server answered ${r.status}.`); return d;
  }
  const el = () => document.getElementById('pg-groups');
  const say = t => { const s = document.getElementById('cmpSay'); if (s) { s.textContent = ''; setTimeout(() => { s.textContent = t }, 50) } };

  /* ---------- loading ---------- */
  async function loadList() { try { C.list = (await call('/api/groups')).groups; C.err = '' } catch (e) { C.err = e.message; C.list = C.list || [] } draw() }
  async function loadGroup(id) { try { C.cur = (await call('/api/groups/get?id=' + encodeURIComponent(id))).group; C.err = ''; upsets() } catch (e) { C.err = e.message; C.cur = null } draw() }
  async function loadJoin(code) { try { C.join = { code, ...(await call('/api/groups/preview?code=' + encodeURIComponent(code))).group } } catch (e) { C.join = { code, error: e.message } } draw() }
  // a correct underdog pick is one of the quiet milestones on Your week (daily.js)
  function upsets() { if ((C.cur?.picks || []).some(p => p.mine && p.upset && p.result === 'won') && !store.get('fl.achUpset', 0)) store.set('fl.achUpset', Date.now()) }

  /* ---------- drawing ---------- */
  function shell(inner) {
    return `<div class="vst cmp-pg"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">${C.cur ? esc(C.cur.name) : 'Private competitions'}</h1>
      <p class="pg-sub">${C.cur ? `${C.cur.members} ${C.cur.members === 1 ? 'member' : 'members'} · picks lock when each game starts · points only, no money` : 'Pick winners and player lines with friends for points. Free, and no money is ever involved.'}</p></div>
      ${C.cur ? '<button type="button" class="bt ghost" data-cmp="list">All your groups</button>' : ''}</header>
      ${C.err ? `<p class="card cmp-err" role="alert">${esc(C.err)}</p>` : ''}<p class="sr-only" role="status" id="cmpSay"></p>${inner}</div>`;
  }
  function signedOut() {
    return `<div class="card emp">${ic('trophy', 30)}<b>Sign in to play with friends</b><p>Make a group, send the invite link, and pick game winners and player lines for points. Your account keeps your groups on every device.</p>
      <div class="cx-row"><button type="button" class="bt" data-shell="profile">Sign in</button></div></div>`;
  }
  function listView() {
    const L = C.list;
    const rows = L == null ? '<p class="lb" role="status">Loading your groups…</p>' : L.length ? `<ul class="cmp-list">${L.map(g => `<li><button type="button" class="rw" data-cmpopen="${esc(g.id)}"><span class="avx crest" aria-hidden="true">${ic('trophy', 18)}</span>
        <span class="rw-t"><b>${esc(g.name)}</b><small>${g.members} ${g.members === 1 ? 'member' : 'members'}${g.isOwner ? ' · you run it' : ''}</small></span>
        <span class="dly-num"><b class="num">${g.weekRank ? `#${g.weekRank}` : '–'}</b><small class="lb">${g.weekPoints} pts this week</small></span></button></li>`).join('')}</ul>`
      : `<p class="hm-none"><b>No groups yet</b><span>Make one below and send the invite link to your friends, or join one with a code.</span></p>`;
    return `<section class="card" aria-labelledby="cmpMineH"><div class="sec-h"><h2 id="cmpMineH">Your groups</h2></div>${rows}</section>
      <div class="g2 cmp-forms">
        <form class="card cmp-f" data-cmpform="create" aria-labelledby="cmpNewH"><h2 id="cmpNewH">Make a group</h2>
          <label for="cmpName">Group name</label><input class="inp" id="cmpName" name="group-name" maxlength="40" minlength="2" required autocomplete="off" placeholder="For example: Sunday crew…">
          <button type="submit" class="bt"${C.busy ? ' disabled' : ''}>Make group</button></form>
        <form class="card cmp-f" data-cmpform="join" aria-labelledby="cmpJoinH"><h2 id="cmpJoinH">Join with a code</h2>
          <label for="cmpCode">Invite code</label><input class="inp" id="cmpCode" name="invite-code" maxlength="8" required autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="8 letters and numbers…">
          <button type="submit" class="bt ghost"${C.busy ? ' disabled' : ''}>Join group</button></form></div>
      <details class="card hs-how"><summary>How points work</summary><p>A correct winner is 10 points, plus 5 when that team was the underdog on the betting line. A correct player over or under is 10 points. A push or a postponed game is 0. Picks can be changed until the game starts; then they lock and the rest of the group can see them. The weekly board runs Monday to Sunday (UTC); the season board counts everything since the group began.</p></details>`;
  }
  function joinView() {
    const J = C.join;
    if (!J || (!J.name && !J.error)) return '<p class="lb" role="status">Opening the invite…</p>';
    if (J.error) return `<div class="card emp">${ic('help', 28)}<b>This invite doesn’t work</b><p>${esc(J.error)}</p><button type="button" class="bt" data-cmp="list">See your groups</button></div>`;
    return `<div class="card emp">${ic('trophy', 30)}<b>Join “${esc(J.name)}”?</b><p>${esc(J.owner)} runs it, and ${J.members} ${J.members === 1 ? 'person is' : 'people are'} in. Picks are for points only.</p>
      <div class="cx-row">${J.in ? `<button type="button" class="bt" data-cmpopen="${esc(J.id)}">Open the group</button>` : `<button type="button" class="bt" data-cmpjoin="${esc(J.code)}">Join group</button>`}<button type="button" class="bt ghost" data-cmp="list">Not now</button></div></div>`;
  }
  const board = rows => rows.length ? `<table class="cmp-t"><caption class="sr-only">Leaderboard</caption><thead><tr><th scope="col">Rank</th><th scope="col">Member</th><th scope="col" class="n">Points</th><th scope="col" class="n">Correct</th><th scope="col" class="n">Wrong</th><th scope="col" class="n">Waiting</th></tr></thead>
    <tbody>${rows.map(r => `<tr${r.user === me()?.username?.toLowerCase() ? ' class="me"' : ''}><td class="num">${r.rank}</td><th scope="row">${esc(r.name)}${r.user === me()?.username?.toLowerCase() ? ' <small class="lb">(you)</small>' : ''}</th><td class="n num">${r.points}</td><td class="n num">${r.hits}</td><td class="n num">${r.misses}</td><td class="n num">${r.pending}</td></tr>`).join('')}</tbody></table>`
    : '<p class="hm-none"><b>No graded picks yet</b><span>The board fills in as games finish.</span></p>';
  function pickView() {
    const G = C.cur, mine = new Map((G.picks || []).filter(p => p.mine).map(p => [p.kind === 'winner' ? `w:${p.lg}:${p.event}` : `p:${p.lg}:${p.event}:${String(p.player).toLowerCase()}:${p.k}`, p]));
    const games = (window.flHub?.games?.() || []).filter(g => g.state === 'pre' && LG_OK[g.sport === 'soccer' ? 'soccer' : g.lg] && g.date > Date.now() + 60000).sort((a, b) => a.date - b.date).slice(0, 24);
    const gameRow = g => { const lg = g.sport === 'soccer' ? 'soccer' : g.lg, p = mine.get(`w:${lg}:${g.id}`), ch = p?.choice;
      const opt = (k, label) => `<button type="button" class="cx sm" aria-pressed="${ch === k}" data-cmpw="${esc(JSON.stringify({ lg, sport: g.sport, event: g.id, start: +g.date, a: { id: g.a.id, name: g.a.name }, b: { id: g.b.id, name: g.b.name }, choice: k }))}">${esc(label)}</button>`;
      return `<li class="cmp-g"><span class="rw-t"><b>${esc(g.a.name)} v ${esc(g.b.name)}</b><small>${esc(LG_OK[lg])} · ${esc(when(+g.date))}</small></span>
        <span class="cx-row" role="group" aria-label="Winner of ${esc(g.a.name)} v ${esc(g.b.name)}">${opt('a', g.a.name)}${lg === 'soccer' ? opt('draw', 'Draw') : ''}${opt('b', g.b.name)}</span></li>` };
    const F = window.flFeed, mk = F ? F.ranked(F.now()).filter(m => ['nba', 'wnba', 'nfl', 'nhl', 'mlb'].includes(m.sport) && m.line != null && m.start).slice(0, 12) : [];
    const mkRow = m => { const k = `p:${m.sport}:${m.eventId || m.gameKey || m.game}:${String(m.name).toLowerCase()}:${m.k}`, p = mine.get(k), ch = p?.choice;
      const base = { kind: 'player', lg: m.sport, sport: m.sport, event: String(m.eventId || '').replace(/[^A-Za-z0-9_-]/g, '') || String(m.gameKey || m.game || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24), start: +new Date(m.start), player: m.name, k: m.k, line: m.line, label: m.label, team: m.team, opp: m.opp };
      const opt = (side, label) => `<button type="button" class="cx sm" aria-pressed="${ch === side}" data-cmpp="${esc(JSON.stringify({ ...base, choice: side }))}">${label}</button>`;
      return `<li class="cmp-g"><span class="rw-t"><b>${esc(m.name)}</b><small>${esc(m.label || m.k)} ${esc(String(m.line))} · ${esc([m.team, m.opp].filter(Boolean).join(' v '))} · ${esc(when(+new Date(m.start)))}</small></span>
        <span class="cx-row" role="group" aria-label="${esc(m.name)}, ${esc(m.label || m.k)} ${esc(String(m.line))}">${opt('over', 'Over')}${opt('under', 'Under')}</span></li>` };
    const open = (G.picks || []).filter(p => p.mine && !p.locked);
    return `<section class="card" aria-labelledby="cmpGamesH"><div class="sec-h"><h2 id="cmpGamesH">Game winners</h2><span class="lb">Today’s games still to start</span></div>
        ${games.length ? `<ul class="cmp-gl">${games.map(gameRow).join('')}</ul>` : '<p class="hm-none"><b>No games left to pick today</b><span>Come back tomorrow, or pick a player line below.</span></p>'}</section>
      <section class="card" aria-labelledby="cmpLinesH"><div class="sec-h"><h2 id="cmpLinesH">Player lines</h2><span class="lb">Open, verified lines with the best supported edge</span></div>
        ${mk.length ? `<ul class="cmp-gl">${mk.map(mkRow).join('')}</ul>` : '<p class="hm-none"><b>No open player lines right now</b><span>Lines are usually posted on the morning of the games.</span></p>'}</section>
      ${open.length ? `<section class="card" aria-labelledby="cmpOpenH"><div class="sec-h"><h2 id="cmpOpenH">Your open picks</h2><span class="lb">${open.length}</span></div><ul class="cmp-gl">${open.map(p => `<li class="cmp-g"><span class="rw-t"><b>${esc(pickText(p))}</b><small>${esc(p.label)} · locks ${esc(when(p.start * 1000))}</small></span><button type="button" class="bt ghost sm" data-cmpun="${esc(p.id)}">Remove<span class="sr-only"> ${esc(pickText(p))}</span></button></li>`).join('')}</ul></section>` : ''}`;
  }
  const pickText = p => p.kind === 'winner' ? (p.choice === 'draw' ? 'Draw' : `${(p.choice === 'a' ? p.a : p.b)?.name || ''} to win`) : `${p.player}: ${p.choice === 'over' ? 'Over' : 'Under'} ${p.line} ${String(p.label || p.k).toLowerCase()}`;
  function lockedView() {
    const xs = (C.cur.picks || []).filter(p => p.locked);
    if (!xs.length) return '<div class="card"><p class="hm-none"><b>No locked picks yet</b><span>Each pick shows here once its game starts, for everyone in the group.</span></p></div>';
    const names = Object.fromEntries((C.cur.memberList || []).map(m => [m.user, m.name]));
    return `<div class="card"><ul class="cmp-gl">${xs.slice(0, 120).map(p => `<li class="cmp-g"><span class="rw-t"><b>${esc(names[p.user] || p.user)}: ${esc(pickText(p))}</b><small>${esc(p.label)} · ${esc(when(p.start * 1000))}${p.actual ? ` · ${esc(p.actual)}` : ''}</small></span>
      <span class="pl dly-g dly-${esc(p.result || 'wait')}">${esc(p.result ? `${RES[p.result]}${p.pts ? ` · +${p.pts}` : ''}${p.upset && p.result === 'won' ? ' · upset' : ''}` : 'Waiting for the result')}</span></li>`).join('')}</ul></div>`;
  }
  function membersView() {
    const G = C.cur, link = `${location.origin}${location.pathname}#/groups/join/${G.code}`;
    return `<section class="card" aria-labelledby="cmpInvH"><div class="sec-h"><h2 id="cmpInvH">Invite friends</h2></div>
        <p class="lb">Anyone with this link and a Floodlight account can join. Code <b class="num" translate="no">${esc(G.code)}</b>.</p>
        <div class="cmp-link"><label class="sr-only" for="cmpLink">Invite link</label><input class="inp" id="cmpLink" readonly value="${esc(link)}"><button type="button" class="bt" data-cmpcopy>Copy link</button>${G.isOwner ? '<button type="button" class="bt ghost" data-cmpact="code">Make a new link</button>' : ''}</div>
        ${G.isOwner ? '<p class="lb">A new link stops the old one from working.</p>' : ''}</section>
      <section class="card" aria-labelledby="cmpMemH"><div class="sec-h"><h2 id="cmpMemH">Members</h2><span class="lb">${G.members}</span></div>
        <ul class="cmp-gl">${(G.memberList || []).map(m => `<li class="cmp-g"><span class="rw-t"><b>${esc(m.name)}${m.user === G.owner ? ' <small class="lb">runs the group</small>' : ''}</b><small>Joined ${esc(new Date(m.joined).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</small></span>
          ${G.isOwner && m.user !== G.owner ? (C.confirm === 'rm:' + m.user ? `<span class="cx-row"><button type="button" class="bt danger sm" data-cmprm="${esc(m.user)}">Remove ${esc(m.name)}</button><button type="button" class="bt ghost sm" data-cmp="cancel">Cancel</button></span>` : `<button type="button" class="bt ghost sm" data-cmpask="rm:${esc(m.user)}">Remove<span class="sr-only"> ${esc(m.name)}</span></button>`) : ''}</li>`).join('')}</ul></section>
      <section class="card" aria-labelledby="cmpSetH"><div class="sec-h"><h2 id="cmpSetH">Group settings</h2></div>
        ${G.isOwner ? `<form class="cmp-f cmp-row" data-cmpform="rename"><label for="cmpRen">Group name</label><input class="inp" id="cmpRen" name="group-name" maxlength="40" minlength="2" required autocomplete="off" value="${esc(G.name)}"><button type="submit" class="bt ghost">Rename</button></form>` : ''}
        <div class="cx-row">${C.confirm === 'leave' || C.confirm === 'delete' ? `<span class="lb">${C.confirm === 'delete' ? 'Delete the group, every pick and both leaderboards for everyone?' : 'Leave the group? Your picks in it are removed.'}</span><button type="button" class="bt danger sm" data-cmpact="${C.confirm}">${C.confirm === 'delete' ? 'Delete group' : 'Leave group'}</button><button type="button" class="bt ghost sm" data-cmp="cancel">Cancel</button>`
          : `${G.isOwner ? '<button type="button" class="bt ghost sm" data-cmpask="delete">Delete group</button>' : ''}${!G.isOwner || G.members === 1 ? '<button type="button" class="bt ghost sm" data-cmpask="leave">Leave group</button>' : ''}`}</div></section>`;
  }
  function groupView() {
    const G = C.cur, tab = TABS.some(t => t[0] === C.tab) ? C.tab : 'pick';
    const body = tab === 'pick' ? pickView() : tab === 'week' ? `<div class="card">${board(G.week || [])}<p class="lb">This week started ${esc(new Date(G.weekStart * 1000).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }))}.</p></div>`
      : tab === 'season' ? `<div class="card">${board(G.season || [])}</div>` : tab === 'picks' ? lockedView() : membersView();
    return `<div class="cx-row scroll cmp-tabs" role="tablist" aria-label="${esc(G.name)}">${TABS.map(([k, l]) => `<button type="button" role="tab" id="cmpTab-${k}" class="cx${tab === k ? ' on' : ''}" aria-selected="${tab === k}" aria-controls="cmpPanel" tabindex="${tab === k ? 0 : -1}" data-cmptab="${k}">${l}</button>`).join('')}</div>
      <div id="cmpPanel" role="tabpanel" aria-labelledby="cmpTab-${tab}" class="vst">${body}</div>`;
  }
  function draw() {
    const e = el(); if (!e || e.hidden) return;
    const act = document.activeElement, keep = act && e.contains(act) ? [...act.attributes].filter(a => a.name.startsWith('data-cmp')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('') : '';
    e.innerHTML = shell(!me() ? signedOut() : C.route === 'join' ? joinView() : C.cur ? groupView() : C.route === 'group' ? '<p class="lb" role="status">Opening the group…</p>' : listView());
    if (keep) e.querySelector(keep)?.focus({ preventScroll: true });
  }

  /* ---------- actions ---------- */
  async function act(path, body, okMsg) {
    if (C.busy) return; C.busy = true;
    try { const d = await call(path, body); C.err = ''; if (d.group) { C.cur = d.group; C.route = 'group'; history.replaceState(null, '', '#/groups/' + d.group.id); upsets() } if (okMsg) say(okMsg); return d }
    catch (e) { C.err = e.message; say(e.message) } finally { C.busy = false; draw() }
  }
  document.addEventListener('click', async ev => {
    const t = ev.target.closest?.('#pg-groups [data-cmp],#pg-groups [data-cmpopen],#pg-groups [data-cmptab],#pg-groups [data-cmpw],#pg-groups [data-cmpp],#pg-groups [data-cmpun],#pg-groups [data-cmpjoin],#pg-groups [data-cmpcopy],#pg-groups [data-cmpask],#pg-groups [data-cmprm],#pg-groups [data-cmpact]'); if (!t) return;
    const d = t.dataset;
    if (d.cmp === 'list') { C.cur = null; C.route = 'list'; C.confirm = ''; history.pushState(null, '', '#/groups'); loadList(); return draw() }
    if (d.cmp === 'cancel') { C.confirm = ''; return draw() }
    if (d.cmpopen) { C.route = 'group'; C.cur = null; C.tab = 'pick'; history.pushState(null, '', '#/groups/' + d.cmpopen); draw(); return loadGroup(d.cmpopen) }
    if (d.cmptab) { C.tab = d.cmptab; draw(); return document.getElementById('cmpTab-' + C.tab)?.focus() }
    if (d.cmpjoin) return act('/api/groups/join', { code: d.cmpjoin }, 'You joined the group.');
    if (d.cmpw || d.cmpp) { let p = {}; try { p = JSON.parse(d.cmpw || d.cmpp) } catch (e) {} if (d.cmpw) p.kind = 'winner'; return act('/api/groups/pick', { id: C.cur.id, pick: p }, `Picked: ${pickText(p)}.`) }
    if (d.cmpun) return act('/api/groups/unpick', { id: C.cur.id, pid: d.cmpun }, 'Pick removed.');
    if (d.cmpcopy) { const v = document.getElementById('cmpLink')?.value; try { await navigator.clipboard.writeText(v); say('Invite link copied.'); t.textContent = 'Copied' } catch (e) { document.getElementById('cmpLink')?.select() } return }
    if (d.cmpask) { C.confirm = d.cmpask; draw(); return el()?.querySelector('.bt.danger')?.focus() }
    if (d.cmprm) { C.confirm = ''; return act('/api/groups/remove', { id: C.cur.id, user: d.cmprm }, 'Member removed.') }
    if (d.cmpact === 'code') return act('/api/groups/code', { id: C.cur.id }, 'New invite link made. The old one no longer works.');
    if (d.cmpact === 'leave' || d.cmpact === 'delete') { C.confirm = ''; const r = await act('/api/groups/' + d.cmpact, { id: C.cur.id }, d.cmpact === 'delete' ? 'Group deleted.' : 'You left the group.'); if (r?.ok) { C.cur = null; C.route = 'list'; history.replaceState(null, '', '#/groups'); loadList() } }
  });
  document.addEventListener('keydown', ev => {   // arrow keys move along the tabs, as a tab list should
    const t = ev.target.closest?.('#pg-groups [role="tab"]'); if (!t || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(ev.key)) return;
    const k = TABS.map(x => x[0]), i = k.indexOf(t.dataset.cmptab), j = ev.key === 'Home' ? 0 : ev.key === 'End' ? k.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + k.length) % k.length;
    ev.preventDefault(); C.tab = k[j]; draw(); document.getElementById('cmpTab-' + C.tab)?.focus();
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest?.('#pg-groups [data-cmpform]'); if (!f) return; ev.preventDefault(); const k = f.dataset.cmpform;
    if (k === 'create') return act('/api/groups/create', { name: f.querySelector('input').value }, 'Group made. Send the invite link to your friends.').then(() => { C.tab = 'members'; draw() });
    if (k === 'join') return act('/api/groups/join', { code: f.querySelector('input').value.trim().toUpperCase() }, 'You joined the group.');
    if (k === 'rename') return act('/api/groups/rename', { id: C.cur.id, name: f.querySelector('input').value }, 'Group renamed.');
  });
  document.addEventListener('fl:me', () => { if (window.flPages?.current?.() === 'groups') route(C.arg) });
  function route(arg) {
    C.arg = arg; C.err = ''; C.confirm = '';
    const m = /^join\/([A-Za-z0-9]{4,12})$/.exec(arg || '');
    if (m) { C.route = 'join'; C.cur = null; C.join = null; draw(); return me() && loadJoin(m[1].toUpperCase()) }
    if (arg && /^g[0-9a-f]{12}$/.test(arg)) { C.route = 'group'; if (C.cur?.id !== arg) C.cur = null; draw(); return me() && loadGroup(arg) }
    C.route = 'list'; C.cur = null; draw(); if (me()) loadList();
  }
  window.flPages?.add('groups', { title: 'Private competitions', fresh: true, render(e) { e.innerHTML = '' }, onShow(e, arg) { route(arg) } });
  window.flCompete = { open: id => window.flPages?.show?.('groups', id) };
})();
