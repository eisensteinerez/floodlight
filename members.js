/* Floodlight · Members (owners and admins only)
   Everyone has every service unless an admin switched one off for them. This page shows who is here, what each
   person can open, and lets an owner or admin invite, pause, limit or remove a member. Every change is made by the
   server (POST /api/admin/members), which also keeps the activity log shown at the bottom. Nothing here is a sample:
   an empty list is shown as an empty list. */
(() => {
  if (!window.flPages) return;
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = { d: null, err: '', loading: false, q: '', filter: 'all', sort: 'name', dir: 1, sel: null, picked: new Set(), menu: null, invite: null, ask: null,
    note: '', temp: null, logAll: false, busy: false };
  const RANK = { owner: 'Owner', admin: 'Admin', member: 'Member' }, RANK_N = { owner: 0, admin: 1, member: 2 };
  const STATUS = { active: 'Active', paused: 'Paused', invited: 'Invited', expired: 'Invite expired' }, STATUS_N = { active: 0, invited: 1, expired: 2, paused: 3 };
  const el = () => document.getElementById('pg-members');
  const admin = () => { const u = window.S?.me; return !!u && u.role === 'admin' };

  /* ---------- talking to the server ---------- */
  async function req(body) {
    const r = await fetch('/api/admin/members', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || (r.status === 403 ? 'Only owners and admins can manage members.' : 'The member list did not load. Try again.'));
    return d;
  }
  async function load() {
    M.loading = true; if (!M.d) draw();
    try { M.d = await req(); M.err = '' } catch (e) { M.err = e.message }
    M.loading = false; draw();
  }
  /* run one change, then redraw with what the server now says. ok: the line to announce when it worked */
  async function act(body, ok) {
    if (M.busy) return false; M.busy = true; M.note = '';
    try { const d = await req(body); M.d = d; M.temp = d.password ? { name: d.for, password: d.password } : M.temp; M.note = ok || 'Saved.'; M.busy = false; draw(); return d }
    catch (e) { M.busy = false; M.note = e.message; draw(); return false }
  }

  /* ---------- the rows: members and open invites in one list ---------- */
  const total = () => M.d.services.length;
  const onCount = m => total() - (m.off || []).length;
  function rows() {
    const d = M.d, me = d.me;
    const people = d.members.map(m => ({ key: 'u:' + m.username, kind: 'member', name: m.display, sub: m.email || '@' + m.username, rank: m.rank, status: m.status, seen: m.seen, created: m.created,
      on: onCount(m), custom: (m.off || []).length > 0, m, self: m.username.toLowerCase() === me.username.toLowerCase(),
      locked: m.fixed || (m.rank === 'owner' && me.rank !== 'owner') }));
    const invites = d.invites.map(i => ({ key: 'i:' + i.id, kind: 'invite', name: i.email, sub: `Invited by ${i.by}`, rank: i.rank, status: i.expired ? 'expired' : 'invited', seen: 0, created: i.at, on: total(), custom: false, i }));
    return [...people, ...invites];
  }
  function shown() {
    const q = M.q.trim().toLowerCase();
    const pass = { all: () => true, staff: r => r.rank !== 'member', custom: r => r.custom, paused: r => r.status === 'paused', invited: r => r.kind === 'invite' }[M.filter] || (() => true);
    const val = { name: r => r.name.toLowerCase(), role: r => RANK_N[r.rank], access: r => r.on, status: r => STATUS_N[r.status], seen: r => r.seen || 0 }[M.sort];
    return rows().filter(r => pass(r) && (!q || (r.name + ' ' + r.sub + ' ' + (r.m?.username || '')).toLowerCase().includes(q)))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * M.dir });
  }
  const find = key => M.d && rows().find(r => r.key === key);

  /* ---------- small pieces ---------- */
  function ago(ts) {
    if (!ts) return 'Not yet';
    const s = Date.now() / 1000 - ts;
    if (s < 3600) return s < 120 ? 'Just now' : `${Math.round(s / 60)} minutes ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? '' : 's'} ago`;
    if (s < 86400 * 14) return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? '' : 's'} ago`;
    return new Date(ts * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const day = ts => ts ? new Date(ts * 1000).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const stamp = ts => new Date(ts * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const initials = n => (n.replace(/@.*/, '').match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const avatar = (r, size = '') => `<span class="avx ${size} mb-av" aria-hidden="true">${r.kind === 'invite' ? ic('plus', 18) : esc(initials(r.name))}</span>`;
  const access = r => r.kind === 'invite' ? 'All services on joining' : r.rank !== 'member' || !r.custom ? 'All services' : `Custom · ${r.on} of ${total()}`;
  const statusPill = r => `<span class="pl mb-st mb-st-${r.status}">${ic(r.status === 'active' ? 'check' : r.status === 'paused' ? 'x' : 'bell', 14)}${STATUS[r.status]}</span>`;
  const inviteLink = i => `${location.origin}${location.pathname}#/join/${i.token}`;

  /* ---------- the page ---------- */
  function draw() {
    const host = el(); if (!host || host.hidden) return;
    const act = document.activeElement, keepSel = act && host.contains(act) ? (act.id ? '#' + CSS.escape(act.id) : act.dataset.k ? `[data-k="${CSS.escape(act.dataset.k)}"]` : null) : null, caret = act?.selectionStart;
    if (!M.d) {
      host.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Members</h1><p class="pg-sub">Everyone gets every service by default</p></div></header>
        ${M.err ? `<div class="card emp">${ic('members', 30)}<b>The member list did not load</b><p>${esc(M.err)}</p><button type="button" class="bt" data-mb="retry">Try again</button></div>`
          : '<div class="g4 mb-tiles">' + '<div class="skl mb-skl-t"></div>'.repeat(4) + '</div><div class="skl mb-skl"></div>'}`;
      return;
    }
    const d = M.d, all = rows(), people = all.filter(r => r.kind === 'member'), list = shown();
    const custom = people.filter(r => r.custom).length, pending = d.invites.filter(i => !i.expired).length;
    if (M.sel && !find(M.sel)) M.sel = null;
    for (const k of [...M.picked]) if (!find(k)) M.picked.delete(k);
    const sel = M.sel ? find(M.sel) : null;
    const tile = (n, label, sub) => `<div class="tile mb-tile"><span class="lb">${label}</span><b class="fig num">${n}</b><small class="lb">${sub}</small></div>`;
    const chip = (k, label, n) => `<button type="button" class="cx sm" data-mb="filter" data-v="${k}" data-k="f-${k}" aria-pressed="${M.filter === k}">${label}<span class="num mb-n">${n}</span></button>`;
    const th = (k, label, cls = '') => `<th scope="col" class="${cls}" aria-sort="${M.sort === k ? (M.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="mb-sort" data-mb="sort" data-v="${k}" data-k="s-${k}">${label}<i aria-hidden="true">${M.sort === k ? (M.dir > 0 ? '↑' : '↓') : ''}</i></button></th>`;
    const pickable = list.filter(r => r.kind === 'member' && !r.self && !r.locked), allPicked = pickable.length > 0 && pickable.every(r => M.picked.has(r.key));
    host.innerHTML = `
      <header class="pg-head"><div><h1 class="pg-title">Members</h1><p class="pg-sub">Everyone gets every service by default</p></div>
        <button type="button" class="bt" data-mb="invite-open" data-k="invite-open" aria-expanded="${!!M.invite}">${ic('plus', 18)}Invite member</button></header>
      ${inviteCard()}
      <div class="g4 mb-tiles">${tile(people.length, 'Members', people.length === 1 ? 'Just you so far' : `${people.filter(r => r.status === 'active').length} active`)}
        ${tile(people.length - custom, 'With all services', people.length ? `${Math.round((people.length - custom) / people.length * 100)}% of members` : 'No members yet')}
        ${tile(custom, 'Custom access', custom ? 'At least one service off' : 'Nobody is limited')}
        ${tile(pending, 'Invites pending', pending ? 'Waiting to be accepted' : 'No open invites')}</div>
      ${policyCard()}
      <p class="sr-only" role="status" aria-live="polite">${esc(M.note)}</p>
      ${M.note ? `<p class="mb-note" aria-hidden="true">${esc(M.note)}</p>` : ''}
      ${M.temp ? `<div class="tile mb-temp"><div><b>Temporary password for ${esc(M.temp.name)}</b><code class="num">${esc(M.temp.password)}</code><small class="lb">Pass it on yourself. They are logged out everywhere until they use it.</small></div><button type="button" class="bt ghost sm" data-mb="temp-done" data-k="temp-done">Done</button></div>` : ''}
      <div class="mb-main${sel ? ' has-sel' : ''}">
        <section class="card mb-list" aria-label="Member list">
          <div class="mb-bar"><label class="fl-f mb-search"><span class="sr-only">Search members</span><input class="inp" id="mbQ" type="search" placeholder="Search by name, username or email" value="${esc(M.q)}" autocomplete="off"></label>
            <div class="cx-row" role="group" aria-label="Show">${chip('all', 'All', all.length)}${chip('staff', 'Owners and admins', all.filter(r => r.rank !== 'member').length)}${chip('custom', 'Custom access', custom)}${chip('paused', 'Paused', people.filter(r => r.status === 'paused').length)}${chip('invited', 'Invited', d.invites.length)}</div></div>
          ${M.picked.size ? `<div class="tile mb-bulk" role="group" aria-label="Actions for the selected members"><b class="num">${M.picked.size} selected</b>
            <div class="cx-row"><button type="button" class="bt ghost sm" data-mb="bulk" data-v="pause" data-k="b-pause">Pause</button><button type="button" class="bt ghost sm" data-mb="bulk" data-v="resume" data-k="b-resume">Resume</button><button type="button" class="bt ghost sm" data-mb="bulk" data-v="reset" data-k="b-reset">Reset to all access</button><button type="button" class="bt ghost sm" data-mb="bulk" data-v="remove" data-k="b-remove">Remove</button><button type="button" class="lk" data-mb="bulk" data-v="clear" data-k="b-clear">Clear</button></div></div>` : ''}
          ${list.length ? `<div class="tbx-wrap"><table class="tbx mb-tbl"><caption class="sr-only">Members, their role, what they can open, and when they were last here</caption>
            <thead><tr><th scope="col" class="mb-ck"><input type="checkbox" class="mb-box" data-mb="pick-all" data-k="pick-all" aria-label="Select every member shown" ${allPicked ? 'checked' : ''} ${pickable.length ? '' : 'disabled'}></th>
              ${th('name', 'Member')}${th('role', 'Role')}${th('access', 'Access')}${th('status', 'Status')}${th('seen', 'Last seen')}<th scope="col" class="r"><span class="sr-only">More actions</span></th></tr></thead>
            <tbody>${list.map(row).join('')}</tbody></table></div>`
            : `<div class="emp">${ic('search', 28)}<b>${all.length ? 'Nobody matches' : 'No members yet'}</b><p>${all.length ? 'Clear the search or pick another filter.' : 'Invite the first member with the button above.'}</p>${all.length ? '<button type="button" class="bt ghost" data-mb="clear-filter" data-k="clear-filter">Show everyone</button>' : ''}</div>`}
        </section>
        ${sel ? detail(sel) : `<aside class="card mb-detail mb-none" aria-label="Member details"><div class="emp">${ic('members', 28)}<b>Pick a member</b><p>Choose someone from the list to see what they can open and change it.</p></div></aside>`}
      </div>
      ${logCard()}${feedbackCard()}`;
    const back = keepSel || (M.refocus && !M.ask ? `[data-k="${CSS.escape(M.refocus)}"]` : null); if (back && !M.ask) M.refocus = null;
    if (back) { const t = host.querySelector(back); if (t) { t.focus({ preventScroll: true }); if (t.id === 'mbQ' && caret != null) try { t.setSelectionRange(caret, caret) } catch (e) {} } }
    drawMenu(); drawAsk();
  }

  function row(r) {
    const on = M.sel === r.key, can = r.kind === 'member' && !r.self && !r.locked;
    return `<tr class="${on ? 'on' : ''}" data-row="${esc(r.key)}">
      <td class="mb-ck">${r.kind === 'member' ? `<input type="checkbox" class="mb-box" data-mb="pick" data-v="${esc(r.key)}" data-k="p-${esc(r.key)}" aria-label="Select ${esc(r.name)}" ${M.picked.has(r.key) ? 'checked' : ''} ${can ? '' : 'disabled'}>` : ''}</td>
      <td class="mb-who"><button type="button" class="rw mb-open" data-mb="open" data-v="${esc(r.key)}" data-k="o-${esc(r.key)}" aria-pressed="${on}">${avatar(r)}<span class="rw-t"><b>${esc(r.name)}${r.self ? ' <span class="lb">(you)</span>' : ''}</b><small>${esc(r.sub)}</small></span></button></td>
      <td data-l="Role">${RANK[r.rank]}</td>
      <td data-l="Access" class="num">${access(r)}</td>
      <td data-l="Status">${statusPill(r)}</td>
      <td data-l="Last seen" class="num">${r.kind === 'invite' ? `Sent ${ago(r.created).toLowerCase()}` : ago(r.seen)}</td>
      <td class="r mb-act"><button type="button" class="ib" data-mb="menu" data-v="${esc(r.key)}" data-k="m-${esc(r.key)}" aria-haspopup="menu" aria-expanded="${M.menu === r.key}" aria-label="Actions for ${esc(r.name)}">${ic('dots', 20)}</button></td></tr>`;
  }

  /* what the row menu offers for one row */
  function actions(r) {
    if (r.kind === 'invite') return [['copy', 'Copy invite link'], ['reinvite', 'Resend invite (new link)'], ['uninvite', 'Cancel invite']];
    if (r.locked) return [['open', 'See details']];
    const me = M.d.me, out = [['open', 'See details']];
    if (!r.self) {
      if (r.rank !== 'admin') out.push(['rank-admin', 'Change role to Admin']);
      if (r.rank !== 'member') out.push(['rank-member', 'Change role to Member']);
      if (r.rank !== 'owner' && me.rank === 'owner') out.push(['rank-owner', 'Change role to Owner']);
      if (r.rank !== 'owner') out.push(r.status === 'paused' ? ['resume', 'Resume'] : ['pause', 'Pause']);
      out.push(['password', 'Give a temporary password'], ['remove', 'Remove']);
    }
    return out;
  }
  function drawMenu() {
    document.getElementById('mbMenu')?.remove();
    const r = M.menu && find(M.menu), btn = r && el()?.querySelector(`[data-mb="menu"][data-v="${CSS.escape(r.key)}"]`);
    if (!r || !btn) { M.menu = null; return }
    const m = document.createElement('div'); m.id = 'mbMenu'; m.className = 'mb-menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', `Actions for ${r.name}`);
    m.innerHTML = actions(r).map(([k, label]) => `<button type="button" role="menuitem" tabindex="-1" data-mb="do" data-v="${k}" data-row="${esc(r.key)}">${label}</button>`).join('');
    document.body.append(m);
    const b = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.right - w)) + 'px';
    m.style.top = (b.bottom + h + 8 > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + 'px';
    m.querySelector('button')?.focus();
  }
  function closeMenu(refocus) { const k = M.menu; if (!k) return; M.menu = null; document.getElementById('mbMenu')?.remove(); const b = el()?.querySelector(`[data-mb="menu"][data-v="${CSS.escape(k)}"]`); b?.setAttribute('aria-expanded', 'false'); if (refocus) b?.focus() }

  function inviteCard() {
    const v = M.invite; if (!v) return '';
    return `<section class="card mb-invite" aria-labelledby="mbInvH"><div class="sec-h"><h2 id="mbInvH">Invite a member</h2><button type="button" class="lk" data-mb="invite-close" data-k="invite-close">Close</button></div>
      ${v.link ? `<div class="tile mb-link"><div><b>Invite link for ${esc(v.email)}</b><code id="mbLink">${esc(v.link)}</code><small class="lb">Floodlight cannot send email yet, so send this link yourself. It works once and lasts 14 days. They show as Invited until they join.</small></div>
          <button type="button" class="bt sm" data-mb="copy-link" data-k="copy-link">${ic('check', 16)}${v.copied ? 'Copied' : 'Copy link'}</button></div>` : ''}
      <form class="mb-form" id="mbInvite"><label class="fl-f">Email<input class="inp" id="mbEmail" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="name@example.com" required></label>
        <label class="fl-f">Role<select class="inp" id="mbRank"><option value="member">Member</option><option value="admin">Admin</option></select></label>
        <button type="submit" class="bt">Create invite link</button></form>
      <details class="mb-more"><summary>Add someone with a username and password instead</summary>
        <form class="mb-form" id="mbAdd"><label class="fl-f">Username<input class="inp" id="mbUser" autocapitalize="none" autocomplete="off" spellcheck="false" minlength="3" maxlength="20" required></label>
          <label class="fl-f">Password (8 or more characters)<input class="inp" id="mbPass" type="password" autocomplete="new-password" minlength="8" required></label>
          <label class="fl-f">Role<select class="inp" id="mbAddRank"><option value="member">Member</option><option value="admin">Admin</option></select></label>
          <button type="submit" class="bt ghost">Add member</button></form></details>
      ${v.err ? `<p class="mb-err" role="alert">${esc(v.err)}</p>` : ''}</section>`;
  }

  function policyCard() {
    const d = M.d, p = d.policy, owner = d.me.rank === 'owner';
    return `<section class="card mb-policy" aria-labelledby="mbPolH"><div class="mb-pol-top"><div><h2 id="mbPolH">New members get every service</h2>
        <p class="lb">${p.allNew ? `Anyone who joins can open all ${total()} services straight away, and any service added later.` : 'Switched off. New members start with only the services ticked below.'}${owner ? '' : ' Only an owner can change this.'}</p></div>
        <input class="sw" type="checkbox" role="switch" id="mbPolAll" data-mb="policy-all" aria-labelledby="mbPolH" ${p.allNew ? 'checked' : ''} ${owner ? '' : 'disabled'}></div>
      ${p.allNew ? '' : `<fieldset class="mb-start" ${owner ? '' : 'disabled'}><legend class="lb">New members start with</legend>${d.services.map(([k, n]) => `<label class="cx sm mb-tick"><input type="checkbox" class="mb-box" data-mb="policy-start" data-v="${k}" data-k="ps-${k}" ${p.start.includes(k) ? 'checked' : ''}>${esc(n)}</label>`).join('')}</fieldset>`}</section>`;
  }

  function detail(r) {
    const d = M.d, me = d.me;
    if (r.kind === 'invite') return `<aside class="card mb-detail" aria-label="Invite details" tabindex="-1" id="mbDetail"><div class="mb-d-top">${avatar(r, 'av-lg')}<div><h2>${esc(r.name)}</h2><p class="lb">Invited by ${esc(r.i.by)} on ${day(r.i.at)}</p>${statusPill(r)}</div></div>
        <p class="lb">${r.i.expired ? 'This invite ran out. Resend it to make a new link.' : `They join as ${r.rank === 'admin' ? 'an Admin' : 'a Member'} with every service. The link works once and runs out on ${day(r.i.exp)}.`}</p>
        <div class="vst mb-d-acts"><button type="button" class="bt" data-mb="do" data-v="copy" data-row="${esc(r.key)}" data-k="d-copy">Copy invite link</button><button type="button" class="bt ghost" data-mb="do" data-v="reinvite" data-row="${esc(r.key)}" data-k="d-reinvite">Resend invite (new link)</button><button type="button" class="bt ghost" data-mb="do" data-v="uninvite" data-row="${esc(r.key)}" data-k="d-uninvite">Cancel invite</button></div></aside>`;
    const m = r.m, staff = r.rank !== 'member', lock = r.locked, ranks = me.rank === 'owner' ? ['owner', 'admin', 'member'] : ['admin', 'member'];
    const why = r.m.fixed ? 'This is the site owner’s account. Its role is set on the server and can’t be changed here.' : lock ? 'Only an owner can change an owner.' : r.self ? 'This is you. Another owner or admin has to change your role or remove you.' : '';
    return `<aside class="card mb-detail" aria-label="Details for ${esc(r.name)}" tabindex="-1" id="mbDetail">
      <div class="mb-d-top">${avatar(r, 'av-lg')}<div><h2>${esc(r.name)}</h2><p class="lb">${m.email ? esc(m.email) + ' · ' : ''}@${esc(m.username)}</p><p class="lb">Joined ${day(m.created) || 'date not on file'}</p></div>
        <button type="button" class="ib mb-d-x" data-mb="close" data-k="d-close" aria-label="Close details">${ic('x', 18)}</button></div>
      <div class="cx-row mb-d-tags"><span class="pl${r.custom && !staff ? '' : ' solid'}">${!r.custom || staff ? ic('check', 14) : ''}${access(r)}</span>${statusPill(r)}<span class="pl">${RANK[r.rank]}</span></div>
      ${why ? `<p class="lb mb-why">${why}</p>` : ''}
      <h3 class="mb-h3" id="mbSvcH">Services</h3>
      <ul class="mb-svcs" aria-labelledby="mbSvcH">${d.services.map(([k, n, desc]) => { const off = !staff && m.off.includes(k);
        return `<li><label class="mb-svc" for="mbS-${k}"><b>${esc(n)}</b><small class="lb">${esc(desc)}</small></label><input class="sw" type="checkbox" role="switch" id="mbS-${k}" data-mb="svc" data-v="${k}" ${off ? '' : 'checked'} ${staff || lock ? 'disabled' : ''}></li>` }).join('')}</ul>
      ${staff ? '<p class="lb">Owners and admins always have every service.</p>' : `<button type="button" class="bt ghost wide" data-mb="reset" data-k="d-reset" ${r.custom ? '' : 'disabled'}>Reset to all access</button>`}
      <h3 class="mb-h3" id="mbRoleH">Role</h3>
      <div class="mb-roles" role="radiogroup" aria-labelledby="mbRoleH">${ranks.map(k => `<button type="button" role="radio" class="cx sm" aria-checked="${r.rank === k}" tabindex="${r.rank === k ? 0 : -1}" data-mb="rank" data-v="${k}" ${lock || r.self ? 'disabled' : ''}>${RANK[k]}</button>`).join('')}</div>
      <p class="lb">${{ owner: 'Owners can do everything, including changing other owners and the rule for new members.', admin: 'Admins manage members and their services, but can’t change or remove owners.', member: 'Members use the services that are switched on for them.' }[r.rank]}</p>
      ${lock || r.self ? '' : `<div class="vst mb-d-acts">${r.rank === 'owner' ? '' : `<button type="button" class="bt ghost" data-mb="do" data-v="${r.status === 'paused' ? 'resume' : 'pause'}" data-row="${esc(r.key)}" data-k="d-pause">${r.status === 'paused' ? 'Resume' : 'Pause'} ${esc(r.name)}</button>`}
        <button type="button" class="bt ghost" data-mb="do" data-v="password" data-row="${esc(r.key)}" data-k="d-pass">Give a temporary password</button>
        <button type="button" class="bt danger" data-mb="do" data-v="remove" data-row="${esc(r.key)}" data-k="d-remove">${ic('x', 16)}Remove ${esc(r.name)}</button></div>`}</aside>`;
  }

  function logCard() {
    const log = M.d.log || [], n = M.logAll ? log.length : 12;
    return `<section class="card mb-log" aria-labelledby="mbLogH"><div class="sec-h"><h2 id="mbLogH">Activity</h2><span class="lb num">${log.length ? `${log.length} most recent change${log.length === 1 ? '' : 's'}` : ''}</span></div>
      ${log.length ? `<ol class="mb-log-l">${log.slice(0, n).map(x => `<li><span class="mb-log-w"><b>${esc(x.by)}</b> ${esc(x.what)}</span><time class="lb num" datetime="${new Date(x.at * 1000).toISOString()}">${stamp(x.at)}</time></li>`).join('')}</ol>
        ${log.length > 12 ? `<button type="button" class="bt ghost sm" data-mb="log-more" data-k="log-more" aria-expanded="${M.logAll}">${M.logAll ? 'Show fewer' : `Show all ${log.length}`}</button>` : ''}`
        : `<div class="emp">${ic('book', 26)}<b>No changes yet</b><p>Every invite, role change, pause, service switch and removal is listed here with who did it and when.</p></div>`}</section>`;
  }
  function feedbackCard() {
    const f = M.d.feedback || []; if (!f.length) return '';
    return `<section class="card mb-log" aria-labelledby="mbFbH"><div class="sec-h"><h2 id="mbFbH">Notes from members</h2><span class="lb">Sent from the Help page</span></div>
      <ol class="mb-log-l">${f.map(x => `<li><span class="mb-log-w"><b>${esc(x.by || 'Someone')}</b> ${esc(x.text)}${x.page ? ` <span class="lb">(on ${esc(x.page)})</span>` : ''}</span><span class="mb-fb-r"><time class="lb num" datetime="${new Date(x.at * 1000).toISOString()}">${stamp(x.at)}</time><button type="button" class="lk" data-mb="fb-clear" data-v="${esc(x.id)}" data-k="fb-${esc(x.id)}" aria-label="Clear this note">Clear</button></span></li>`).join('')}</ol></section>`;
  }

  /* ---------- "are you sure?" for anything that takes access away ---------- */
  function drawAsk() {
    document.getElementById('mbAsk')?.remove();
    const a = M.ask; if (!a) return;
    const w = document.createElement('div'); w.id = 'mbAsk'; w.className = 'mb-ask';
    w.innerHTML = `<div class="card mb-ask-in" role="alertdialog" aria-modal="true" aria-labelledby="mbAskH" aria-describedby="mbAskP"><h2 id="mbAskH">${esc(a.title)}</h2><p id="mbAskP">${esc(a.text)}</p>
      <div class="mb-ask-b"><button type="button" class="bt ghost" data-mb="ask-no">${esc(a.no)}</button><button type="button" class="bt" data-mb="ask-yes">${esc(a.yes)}</button></div></div>`;
    document.body.append(w); w.querySelector('[data-mb="ask-no"]').focus();
  }
  function ask(o) { M.ask = { ...o, from: document.activeElement?.dataset?.k || M.refocus || null }; closeMenu(); drawAsk() }
  function closeAsk() { const k = M.ask?.from; M.ask = null; M.refocus = k; document.getElementById('mbAsk')?.remove(); if (k) el()?.querySelector(`[data-k="${CSS.escape(k)}"]`)?.focus() }
  const names = rs => rs.length <= 3 ? rs.map(r => r.name).join(', ').replace(/, ([^,]*)$/, ' and $1') : `${rs.slice(0, 3).map(r => r.name).join(', ')} and ${rs.length - 3} more`;

  /* ---------- doing things ---------- */
  function select(key) {
    M.sel = M.sel === key ? null : key; closeMenu(); draw();
    if (M.sel && matchMedia('(max-width:1100px)').matches) { const p = document.getElementById('mbDetail'); p?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' }); p?.focus({ preventScroll: true }) }
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true } catch (e) { return false } }
  async function run(k, r) {
    M.refocus = M.menu ? 'm-' + M.menu : document.activeElement?.dataset?.k || null;   // where the keyboard goes back to afterwards
    closeMenu();
    if (k === 'open') return M.sel === r.key ? document.getElementById('mbDetail')?.focus() : select(r.key);
    if (r.kind === 'invite') {
      if (k === 'copy') { const ok = await copy(inviteLink(r.i)); M.invite = { email: r.i.email, link: inviteLink(r.i), copied: ok }; M.note = ok ? `Invite link for ${r.i.email} copied.` : 'Copy the link from the box at the top of the page.'; return draw() }
      if (k === 'reinvite') { const d = await act({ op: 'reinvite', id: r.i.id }, `New invite link made for ${r.i.email}. The old link no longer works.`); if (d) { const i = d.invites.find(x => x.id === r.i.id); if (i) { M.invite = { email: i.email, link: inviteLink(i), copied: await copy(inviteLink(i)) }; draw() } } return }
      if (k === 'uninvite') return ask({ title: `Cancel the invite for ${r.name}?`, text: 'Their link stops working. You can invite them again later.', yes: 'Cancel invite', no: 'Keep invite', go: () => act({ op: 'uninvite', id: r.i.id }, `Invite for ${r.name} cancelled.`) });
      return;
    }
    const u = r.m.username;
    if (k.startsWith('rank-')) return setRank(r, k.slice(5));
    if (k === 'resume') return act({ op: 'resume', username: u }, `${r.name} can use Floodlight again.`);
    if (k === 'pause') return ask({ title: `Pause ${r.name}?`, text: `${r.name} is logged out and can't open anything until you resume them. Their account, picks and settings are kept.`, yes: `Pause ${r.name}`, no: 'Keep active', go: () => act({ op: 'pause', username: u }, `${r.name} is paused.`) });
    if (k === 'password') return ask({ title: `Give ${r.name} a temporary password?`, text: 'Their current password stops working and they are logged out everywhere. You pass the new one on yourself.', yes: 'Make temporary password', no: 'Keep their password', go: () => act({ op: 'password', username: u }, `Temporary password made for ${r.name}.`) });
    if (k === 'remove') return ask({ title: `Remove ${r.name}?`, text: `${r.name} loses access right away, and their account, saved picks and settings are deleted. This can't be undone.`, yes: `Remove ${r.name}`, no: 'Keep member', go: () => act({ op: 'remove', username: u }, `${r.name} was removed.`) });
  }
  function setRank(r, rank) {
    if (r.rank === rank) return;
    const go = () => act({ op: 'rank', username: r.m.username, rank }, `${r.name} is now ${rank === 'member' ? 'a Member' : rank === 'admin' ? 'an Admin' : 'an Owner'}.`);
    if (rank === 'owner') return ask({ title: `Make ${r.name} an owner?`, text: `Owners can do everything, including removing other owners and changing what new members get.`, yes: `Make ${r.name} an owner`, no: 'Leave as is', go });
    return go();
  }
  function bulk(k) {
    if (k === 'clear') { M.picked.clear(); return draw() }
    const rs = [...M.picked].map(find).filter(Boolean), usernames = rs.map(r => r.m.username); if (!rs.length) return;
    const done = () => M.picked.clear();
    if (k === 'resume') return act({ op: 'resume', usernames }, `${rs.length} member${rs.length === 1 ? '' : 's'} resumed.`).then(d => d && (done(), draw()));
    if (k === 'reset') return act({ op: 'reset', usernames }, `${rs.length} member${rs.length === 1 ? '' : 's'} reset to all access.`).then(d => d && (done(), draw()));
    if (k === 'pause') return ask({ title: `Pause ${rs.length} member${rs.length === 1 ? '' : 's'}?`, text: `${names(rs)} will be logged out and can't open anything until you resume them.`, yes: `Pause ${rs.length === 1 ? rs[0].name : rs.length + ' members'}`, no: 'Keep active', go: () => act({ op: 'pause', usernames }, `${rs.length} paused.`).then(d => d && (done(), draw())) });
    if (k === 'remove') return ask({ title: `Remove ${rs.length} member${rs.length === 1 ? '' : 's'}?`, text: `${names(rs)} will lose access right away and their accounts are deleted. This can't be undone.`, yes: `Remove ${rs.length === 1 ? rs[0].name : rs.length + ' members'}`, no: 'Keep members', go: () => act({ op: 'remove', usernames }, `${rs.length} removed.`).then(d => d && (done(), draw())) });
  }

  document.addEventListener('click', async ev => {
    const t = ev.target.closest?.('[data-mb]');
    if (M.menu && !ev.target.closest?.('#mbMenu,[data-mb="menu"]')) closeMenu();
    if (!t || t.disabled) return;
    const a = t.dataset.mb, v = t.dataset.v;
    if (a === 'ask-no') return closeAsk();
    if (a === 'ask-yes') { const go = M.ask?.go; closeAsk(); return go && go() }
    if (a === 'do') { const r = find(t.dataset.row); return r && run(v, r) }
    if (!t.closest('#pg-members')) return;
    if (a === 'retry') return load();
    if (a === 'filter') { M.filter = v; return draw() }
    if (a === 'clear-filter') { M.filter = 'all'; M.q = ''; return draw() }
    if (a === 'sort') { if (M.sort === v) M.dir = -M.dir; else { M.sort = v; M.dir = v === 'seen' || v === 'access' ? -1 : 1 } return draw() }
    if (a === 'open') return select(v);
    if (a === 'close') { const k = M.sel; M.sel = null; draw(); return el()?.querySelector(`[data-mb="open"][data-v="${CSS.escape(k)}"]`)?.focus() }
    if (a === 'menu') { M.menu = M.menu === v ? null : v; t.setAttribute('aria-expanded', String(!!M.menu)); return drawMenu() }
    if (a === 'bulk') return bulk(v);
    if (a === 'reset') { const r = find(M.sel); return r && act({ op: 'reset', username: r.m.username }, `${r.name} is back to all services.`) }
    if (a === 'rank') { const r = find(M.sel); return r && setRank(r, v) }
    if (a === 'invite-open') { M.invite = M.invite ? null : {}; draw(); return M.invite && document.getElementById('mbEmail')?.focus() }
    if (a === 'invite-close') { M.invite = null; draw(); return el()?.querySelector('[data-mb="invite-open"]')?.focus() }
    if (a === 'copy-link') { M.invite.copied = await copy(M.invite.link); M.note = M.invite.copied ? 'Invite link copied.' : 'Select the link and copy it by hand.'; return draw() }
    if (a === 'temp-done') { M.temp = null; return draw() }
    if (a === 'log-more') { M.logAll = !M.logAll; return draw() }
    if (a === 'fb-clear') return act({ op: 'feedback-clear', id: v }, 'Note cleared.');
  });
  document.addEventListener('change', ev => {
    const t = ev.target.closest?.('#pg-members [data-mb]'); if (!t) return;
    const a = t.dataset.mb, v = t.dataset.v;
    if (a === 'pick') { t.checked ? M.picked.add(v) : M.picked.delete(v); return draw() }
    if (a === 'pick-all') { shown().filter(r => r.kind === 'member' && !r.self && !r.locked).forEach(r => t.checked ? M.picked.add(r.key) : M.picked.delete(r.key)); return draw() }
    if (a === 'svc') { const r = find(M.sel); if (!r) return; const off = new Set(r.m.off); t.checked ? off.delete(v) : off.add(v); const name = M.d.services.find(s => s[0] === v)?.[1] || v;
      return act({ op: 'services', username: r.m.username, off: [...off] }, `${name} switched ${t.checked ? 'on' : 'off'} for ${r.name}.`) }
    if (a === 'policy-all') return act({ op: 'policy', allNew: t.checked, start: M.d.policy.start }, t.checked ? 'New members get every service.' : 'New members now start with the services ticked below.');
    if (a === 'policy-start') { const s = new Set(M.d.policy.start); t.checked ? s.add(v) : s.delete(v); return act({ op: 'policy', allNew: false, start: [...s] }, 'Starting services saved.') }
  });
  document.addEventListener('input', ev => { if (ev.target.id !== 'mbQ') return; M.q = ev.target.value; draw() });
  document.addEventListener('submit', async ev => {
    const id = ev.target.id; if (id !== 'mbInvite' && id !== 'mbAdd') return;
    ev.preventDefault(); const g = k => document.getElementById(k)?.value || '';
    if (id === 'mbInvite') {
      const email = g('mbEmail').trim().toLowerCase(), d = await act({ op: 'invite', email, rank: g('mbRank') }, `Invite link made for ${email}.`);
      if (!d) { M.invite = { err: M.note }; return draw() }
      const i = d.invites.find(x => x.email === email); M.invite = i ? { email, link: inviteLink(i), copied: await copy(inviteLink(i)) } : {}; draw(); document.querySelector('[data-mb="copy-link"]')?.focus();
    } else {
      const name = g('mbUser').trim(), d = await act({ op: 'add', username: name, password: g('mbPass'), rank: g('mbAddRank') }, `${name} was added with every service.`);
      if (!d) { M.invite = { err: M.note }; return draw() }
      M.invite = null; M.sel = 'u:' + name; draw();
    }
  });
  document.addEventListener('keydown', ev => {
    if (M.ask) {
      if (ev.key === 'Escape') { ev.preventDefault(); return closeAsk() }
      if (ev.key === 'Tab') { const bs = [...document.querySelectorAll('#mbAsk button')], i = bs.indexOf(document.activeElement); ev.preventDefault(); bs[(i + (ev.shiftKey ? -1 : 1) + bs.length) % bs.length]?.focus() }
      return;
    }
    const m = document.getElementById('mbMenu'); if (!m || !M.menu) return;
    const items = [...m.querySelectorAll('[role="menuitem"]')], i = items.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); return closeMenu(true) }
    if (ev.key === 'Tab') return closeMenu(true);
    if (/^Arrow(Down|Up)$|^Home$|^End$/.test(ev.key)) { ev.preventDefault(); items[ev.key === 'Home' ? 0 : ev.key === 'End' ? items.length - 1 : (i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }
  });
  addEventListener('scroll', () => M.menu && closeMenu(), { passive: true });
  addEventListener('resize', () => M.menu && closeMenu());

  window.flPages.add('members', { title: 'Members', fresh: true,
    guard: () => admin(),   // everyone else is sent to their own profile by the Members button
    render() { M.note = ''; M.menu = null; draw(); load() },
    onHide() { closeMenu(); M.ask = null; document.getElementById('mbAsk')?.remove() } });
  // a reload on #/members: the page can only open once the site knows who is signed in
  document.addEventListener('fl:me', () => { if (location.hash === '#/members' && window.flPages.current() !== 'members' && admin()) window.flPages.show('members', undefined, { fromHash: true }) });
  window.flMembers = { _state: M };
})();
