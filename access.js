/* Floodlight · members only
   On the hosted site, nobody sees data until they log in with an account the admin has approved.
   Roles: viewer (games, scores, odds), research (also prop research and AI forecasts), admin (everything, plus Members).
   Running on your own computer, the server reports gated: false and this file steps aside. */
(function () {
  const root = document.documentElement;
  root.classList.add('fl-gating');
  const css = `
html.fl-gating body > *:not(#flGate){display:none!important}
html.fl-noresearch .rs-open{display:none!important}
.flg{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font-family:var(--f-body)}
.flg-card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:var(--shadow)}
.flg-brand{display:flex;align-items:center;gap:10px;font:900 30px/1 var(--f-display);text-transform:uppercase;letter-spacing:.02em;margin-bottom:6px}
.flg-brand svg{width:30px;height:30px}
.flg p{color:var(--muted);font-size:14px;line-height:1.45;margin:0 0 18px}
.flg-tabs{display:flex;gap:4px;background:var(--surface-2);border-radius:999px;padding:4px;margin-bottom:16px}
.flg-tabs button{flex:1;height:34px;border-radius:999px;font:700 13px/1 var(--f-body);color:var(--muted)}
.flg-tabs button.on{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}
.flg label{display:block;font:600 12px/1 var(--f-body);color:var(--muted);margin:12px 0 6px}
.flg input,.flm select,.flm input{width:100%;height:42px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--fg);padding:0 12px;font:500 15px/1 var(--f-body)}
.flg .btn{width:100%;justify-content:center;height:44px;margin-top:18px;font-size:14px}
.flg-err{color:var(--loss);font-size:13px;margin-top:12px;min-height:1em}
.flg-ok{background:var(--surface-2);border-radius:10px;padding:12px;font-size:14px;line-height:1.45;margin-bottom:6px}
.flm-btn{display:flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font:700 13px/1 var(--f-body);color:var(--fg);flex:none}
.flm-btn b{background:var(--live);color:#fff;border-radius:999px;font-size:11px;padding:2px 6px}
@media (max-width:900px){.flm-btn span{display:none}}
.flm{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 16px 24px;overflow-y:auto}
.flm-in{width:100%;max-width:640px;background:var(--surface);color:var(--fg);border-radius:16px;padding:20px;box-shadow:var(--shadow);font-family:var(--f-body)}
.flm-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.flm h2{margin:0;font:900 26px/1 var(--f-display);text-transform:uppercase}
.flm h3{font:800 13px/1 var(--f-body);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:20px 0 8px}
.flm-x{font:700 14px/1 var(--f-body);color:var(--fg);padding:9px 12px;border-radius:999px}
.flm-row{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:8px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.flm-row strong{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis}
.flm-row small{color:var(--muted);font-size:12px}
.flm-row select{height:36px;font-size:13px}
.flm-del{height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);font:600 13px/1 var(--f-body);color:var(--loss)}
.flm-add{display:grid;grid-template-columns:1fr 1fr 130px auto;gap:8px}
.flm-add input,.flm-add select{height:38px;font-size:13px}
.flm-add .btn{height:38px}
.flm-tag{display:inline-block;font:700 11px/1 var(--f-body);text-transform:uppercase;padding:4px 8px;border-radius:999px;background:var(--live);color:#fff}
.flm-help{color:var(--muted);font-size:13px;line-height:1.45;margin:4px 0 0}
@media (max-width:560px){.flm-row{grid-template-columns:minmax(0,1fr) 120px}.flm-row .flm-del{grid-column:1/-1}.flm-add{grid-template-columns:1fr}}`;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function call(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }
      : { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();
  const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="14.5" y="12" width="3" height="18" rx="1" fill="currentColor"/><rect x="5" y="3" width="22" height="10" rx="2" fill="currentColor"/><g fill="var(--accent)"><circle cx="9.5" cy="8" r="2.2"/><circle cx="16" cy="8" r="2.2"/><circle cx="22.5" cy="8" r="2.2"/></g></svg>`;

  function open(user) {
    root.classList.remove('fl-gating');
    const role = user?.role;
    window.FL_ROLE = role || null;
    if (role && role !== 'research' && role !== 'admin') root.classList.add('fl-noresearch');
    document.getElementById('flGate')?.remove();
    if (role === 'admin') ready(mountMembers);
  }

  /* ---------- the login screen ---------- */
  let mode = 'login';
  function gate(user, err) {
    ready(() => {
      let g = document.getElementById('flGate');
      if (!g) { g = document.createElement('div'); g.id = 'flGate'; document.body.prepend(g) }
      const pending = user && user.role === 'pending';
      g.innerHTML = `<div class="flg"><div class="flg-card">
        <div class="flg-brand">${LOGO}Floodlight</div>
        ${pending ? `<p>Signed in as <strong>${esc(user.username)}</strong>.</p>
          <div class="flg-ok">Your account is waiting for approval. You'll get in as soon as the admin lets you in.</div>
          <button class="btn" data-g="check">Check again</button>
          <button class="btn ghost" data-g="logout">Log out</button>`
        : `<p>Floodlight is members only. Log in, or ask for an account and the admin will let you in.</p>
          <div class="flg-tabs" role="tablist"><button type="button" data-g="login" class="${mode === 'login' ? 'on' : ''}">Log in</button><button type="button" data-g="signup" class="${mode === 'signup' ? 'on' : ''}">Ask for an account</button></div>
          <form id="flgForm">
            <label for="flgUser">Username</label><input id="flgUser" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            <label for="flgPass">Password</label><input id="flgPass" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="${mode === 'login' ? 1 : 8}">
            <button class="btn" type="submit">${mode === 'login' ? 'Log in' : 'Send request'}</button>
          </form>`}
        <div class="flg-err" role="alert">${esc(err || '')}</div>
      </div></div>`;
      g.querySelector('#flgUser')?.focus();
    });
  }
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-g]'); if (!b || !b.closest('#flGate')) return;
    const a = b.dataset.g;
    if (a === 'login' || a === 'signup') { mode = a; return gate(null) }
    if (a === 'logout') { await call('/api/auth/logout', {}).catch(() => {}); return gate(null) }
    if (a === 'check') return start();
  });
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'flgForm') return;
    ev.preventDefault();
    const username = document.getElementById('flgUser').value.trim(), password = document.getElementById('flgPass').value;
    try {
      const d = await call(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', { username, password, display: username });
      if (d.user && d.user.role !== 'pending') return location.reload();
      gate(d.user);
    } catch (e) { gate(null, e.message) }
  });

  /* ---------- Members (admin only) ---------- */
  const ROLE_LABEL = { pending: 'Waiting', viewer: 'Games only', research: 'Games + research' };
  let members = [];
  function mountMembers() {
    const host = document.querySelector('.top-in .prefwrap');
    if (!host || document.getElementById('flmBtn')) return;
    host.insertAdjacentHTML('beforebegin', `<button class="flm-btn" id="flmBtn" data-m="open" aria-label="Members"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 4a4 4 0 0 1 0 8M22 21c0-3-1.6-5-4-5.7"/></svg><span>Members</span></button>`);
    refresh(false);
  }
  async function refresh(show = true) {
    try { members = (await call('/api/admin/users')).users || [] } catch (e) { if (show) alert(e.message) }
    const n = members.filter(m => m.role === 'pending').length, b = document.getElementById('flmBtn');
    if (b) b.querySelector('b')?.remove(), n && b.insertAdjacentHTML('beforeend', `<b>${n}</b>`);
    if (show) renderMembers();
  }
  function renderMembers(err) {
    let m = document.getElementById('flm');
    if (!m) { m = document.createElement('div'); m.id = 'flm'; m.className = 'flm'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Members'); document.body.append(m) }
    const row = u => u.role === 'admin'
      ? `<div class="flm-row"><div><strong>${esc(u.username)}</strong><small>You · admin</small></div><div></div></div>`
      : `<div class="flm-row"><div><strong>${esc(u.username)}</strong><small>${u.role === 'pending' ? '<span class="flm-tag">New request</span> ' : ''}joined ${new Date(u.created * 1000).toLocaleDateString()}</small></div>
        <select data-m="role" data-u="${esc(u.username)}" aria-label="Access for ${esc(u.username)}">${['pending', 'viewer', 'research'].map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
        <button class="flm-del" data-m="remove" data-u="${esc(u.username)}">Remove</button></div>`;
    const pend = members.filter(u => u.role === 'pending'), rest = members.filter(u => u.role !== 'pending');
    m.innerHTML = `<div class="flm-in">
      <div class="flm-top"><h2>Members</h2><button class="flm-x" data-m="close">Close</button></div>
      <p class="flm-help">"Games only" sees games, scores and odds. "Games + research" also gets prop research and AI forecasts. "Waiting" can't see anything.</p>
      ${pend.length ? `<h3>Waiting for you (${pend.length})</h3>${pend.map(row).join('')}` : ''}
      <h3>Members (${rest.length})</h3>${rest.map(row).join('')}
      <h3>Add someone</h3>
      <form id="flmAdd" class="flm-add"><input id="flmU" placeholder="Username" autocapitalize="none" required><input id="flmP" type="password" placeholder="Password (8+ characters)" minlength="8" required>
        <select id="flmR"><option value="viewer">Games only</option><option value="research">Games + research</option></select><button class="btn" type="submit">Add</button></form>
      <div class="flg-err" role="alert">${esc(err || '')}</div></div>`;
  }
  document.addEventListener('click', async ev => {
    if (ev.target.id === 'flm') return ev.target.remove();
    const b = ev.target.closest('[data-m]'); if (!b) return;
    const a = b.dataset.m;
    if (a === 'open') return refresh(true);
    if (a === 'close') return document.getElementById('flm')?.remove();
    if (a === 'remove') {
      if (!confirm(`Remove ${b.dataset.u}? They'll lose access right away.`)) return;
      try { members = (await call('/api/admin/remove', { username: b.dataset.u })).users; renderMembers() } catch (e) { renderMembers(e.message) }
      refresh(false);
    }
  });
  document.addEventListener('change', async ev => {
    const s = ev.target.closest('[data-m="role"]'); if (!s) return;
    try { members = (await call('/api/admin/set', { username: s.dataset.u, role: s.value })).users; renderMembers() } catch (e) { renderMembers(e.message) }
    refresh(false);
  });
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'flmAdd') return;
    ev.preventDefault();
    try {
      members = (await call('/api/admin/add', { username: document.getElementById('flmU').value.trim(), password: document.getElementById('flmP').value, role: document.getElementById('flmR').value })).users;
      renderMembers();
    } catch (e) { renderMembers(e.message) }
  });

  /* ---------- start ---------- */
  async function start() {
    let d;
    try { d = await call('/api/me') } catch { return open(null) }   // no server (opened as a file): nothing to gate
    window.FL_GATED = !!d.gated;
    if (!d.gated) return open(d.user);
    if (d.user && d.user.role && d.user.role !== 'pending') return open(d.user);
    gate(d.user);
  }
  start();
})();
