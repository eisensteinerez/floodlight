/* Floodlight · members only
   On the hosted site, nobody sees data until they log in. Every member has every service unless an admin switched one
   off for them; the server sends that list with /api/me (user.services) and refuses a switched-off service itself.
   window.flAccess answers "can this member use X?" for the pages. The Members page itself lives in members.js.
   Running on your own computer, the server reports gated: false and the login wall steps aside. */
(function () {
  const root = document.documentElement;
  root.classList.add('fl-gating');
  const css = `
html.fl-gating body > *:not(#flGate){display:none!important}
html.fl-noresearch .rs-open{display:none!important}
.flg{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font-family:var(--f-body)}
.flg-card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:28px 24px;box-shadow:var(--shadow)}
.flg-brand{display:flex;align-items:center;gap:10px;font:900 30px/1 var(--f-display);text-transform:uppercase;letter-spacing:.02em;margin-bottom:6px}
.flg-brand svg{width:30px;height:30px}
.flg-card p{color:var(--muted);font-size:14px;line-height:1.45;margin:0 0 18px}
.flg-tabs{display:flex;gap:4px;background:var(--surface-2);border-radius:var(--r-pill);padding:4px;margin-bottom:16px}
.flg-tabs button{flex:1;height:34px;border-radius:var(--r-pill);font:700 13px/1 var(--f-body);color:var(--muted)}
.flg-tabs button.on{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}
.flg-card label{display:block;font:600 12px/1 var(--f-body);color:var(--muted);margin:12px 0 6px}
.flg-card input{width:100%;height:42px;border-radius:var(--r-ctl);border:1px solid var(--line);background:var(--surface-2);color:var(--fg);padding:0 12px;font:500 15px/1 var(--f-body)}
.flg-card .btn{width:100%;justify-content:center;height:44px;margin-top:18px;font-size:14px}
.flg-err{color:var(--loss);font-size:13px;margin-top:12px;min-height:1em}
.flg-ok{background:var(--surface-2);border-radius:var(--r-ctl);padding:12px;font-size:14px;line-height:1.45;margin-bottom:6px}
.flg-h{font:900 26px/1 var(--f-display);text-transform:uppercase;margin:0 0 8px}
.flg-card .btn + .btn{margin-top:8px}
.flg-forgot{display:block;margin:12px auto 0;font:600 12.5px/1 var(--f-body);color:var(--muted);text-decoration:underline;text-underline-offset:3px}
`;
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

  const SERVICE = { live: 'Live scores', lab: 'The Lab', predictions: 'Predictions', transfers: 'Transfer window', profiles: 'Profiles and awards', alerts: 'Alerts' };
  let current = null;
  const services = () => (window.S && window.S.me && window.S.me.services) || (current && current.services) || null;
  /* has('lab'): no account (your own computer) and owners and admins have everything; a member has it unless it was switched off */
  const has = svc => { const sv = services(); return !sv || sv[svc] !== false };
  function mark() {
    root.classList.toggle('fl-noresearch', !has('lab'));
    for (const k of Object.keys(SERVICE)) root.classList.toggle('fl-no-' + k, !has(k));
  }
  /* the friendly page a member sees in place of a service that is switched off for them */
  const block = svc => { if (window.flPages && window.flPages.show('noaccess', svc)) return true; return false };
  window.flAccess = { has, block, mark, name: k => SERVICE[k] || '', services: () => services() || {}, set(u) { current = u || null; mark() } };
  document.addEventListener('fl:me', mark);
  // with live scores off, the sport lists and the ticker have nothing to open: show the page that says why
  document.addEventListener('click', ev => {
    if (has('live')) return;
    const t = ev.target.closest?.('button[data-sport],.rail button,.ticker [data-ev],.ticker button,[data-shell="sports"],.sresults button');
    if (!t || t.closest('#flGate,.flpage')) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); block('live');
  }, true);
  function open(user) {
    root.classList.remove('fl-gating');
    window.FL_ROLE = user?.role || null;
    current = user || null; mark();
    document.getElementById('flGate')?.remove();
  }

  /* ---------- the front page and login ---------- */
  let mode = 'login', forgot = false, invite = null;   // invite: what /api/invite said about the link that was opened
  function card(user, err) {
    const pending = user && user.role === 'pending';
    // sign-in, sign-up and recovery live in auth.js; this file keeps the paused-account card
    if (window.flAuth && !pending && !(invite && invite.error)) return window.flAuth.card(user, err);
    if (pending) return `<div class="flg-card" id="flgCard"><h2 class="flg-h">Not open yet</h2><p>Signed in as <strong>${esc(user.username)}</strong>.</p>
        <div class="flg-ok">Your account is paused or still waiting for an admin to switch it on. Ask your admin, then check again.</div>
        <button class="btn" data-g="check">Check again</button>
        <button class="btn ghost" data-g="logout">Log out</button><div class="flg-err" role="alert">${esc(err || '')}</div></div>`;
    if (invite && invite.error) return `<div class="flg-card" id="flgCard"><h2 class="flg-h">Invite not found</h2>
        <div class="flg-ok">${esc(invite.error)}</div>
        <button class="btn" data-g="login">Go to log in</button></div>`;
    if (invite) return `<div class="flg-card" id="flgCard"><h2 class="flg-h">You're invited</h2>
        <p>${esc(invite.by)} invited <strong>${esc(invite.email)}</strong> to Floodlight${invite.rank === 'admin' ? ' as an admin' : ''}. Pick a username and password to join. You get every service from the start.</p>
        <form id="flgForm">
          <label for="flgUser">Username</label><input id="flgUser" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          <label for="flgPass">Password (8 or more characters)</label><input id="flgPass" type="password" autocomplete="new-password" required minlength="8">
          <button class="btn" type="submit">Join Floodlight</button>
        </form>
        <div class="flg-err" role="alert">${esc(err || '')}</div></div>`;
    if (forgot) return `<div class="flg-card" id="flgCard"><h2 class="flg-h">Forgot your password?</h2>
        <p>Floodlight doesn't keep email addresses, so a reset goes through the admin. Message the admin (or post in The Prop Room on Discord) with your username, and you'll get a temporary password to log in with.</p>
        <button class="btn" data-g="back">Back to log in</button></div>`;
    return `<div class="flg-card" id="flgCard"><h2 class="flg-h">${mode === 'login' ? 'Member login' : 'Create account'}</h2>
        <p>${mode === 'login' ? 'Welcome back. Log in to your account.' : 'Pick a username and password and you are in. No email needed.'}</p>
        <div class="flg-tabs" role="tablist"><button type="button" role="tab" aria-selected="${mode === 'login'}" data-g="login" class="${mode === 'login' ? 'on' : ''}">Log in</button><button type="button" role="tab" aria-selected="${mode === 'signup'}" data-g="signup" class="${mode === 'signup' ? 'on' : ''}">Create account</button></div>
        <form id="flgForm">
          <label for="flgUser">Username</label><input id="flgUser" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          <label for="flgPass">Password</label><input id="flgPass" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="${mode === 'login' ? 1 : 8}">
          <button class="btn" type="submit">${mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
        ${mode === 'login' ? '<button type="button" class="flg-forgot" data-g="forgot">Forgot password?</button>' : ''}
        <div class="flg-err" role="alert">${esc(err || '')}</div></div>`;
  }
  /* public pages a signed-out visitor can read: plans and the policies (pricing.js, legal.js) */
  const PUBLIC = /^#\/(pricing|legal)(?:\/([a-z-]+))?$/;
  function publicPage() {
    const m = PUBLIC.exec(location.hash); if (!m) return false;
    ready(() => {
      let g = document.getElementById('flGate');
      if (!g) { g = document.createElement('div'); g.id = 'flGate'; document.body.prepend(g) }
      delete g.dataset.landing;   // the landing page is drawn again when the visitor leaves Plans or a policy
      g.innerHTML = `<div class="flg-land flg-pub"><nav class="flg-nav"><a class="flg-brand flg-home" href="#">${LOGO}Floodlight</a><a href="#/auth/login" data-g="login">Log in</a></nav>
        <main class="flg-pub-main" id="flgPub" tabindex="-1"></main>${FOOT}</div>`;
      const el = g.querySelector('#flgPub');
      if (m[1] === 'pricing') window.flPricing?.render(el, { standalone: true }); else window.flLegal?.render(el, m[2]);
      document.title = (m[1] === 'pricing' ? 'Plans' : 'Policies') + ' · Floodlight';
      el.focus({ preventScroll: true }); scrollTo({ top: 0 });
    });
    return true;
  }
  const FOOT = `<footer class="flg-foot"><span>Floodlight · research, not a sportsbook. 18+ (21+ where required). Hit rates show past results, not guarantees.</span>
    <nav aria-label="Policies"><a href="#/pricing">Plans</a> <a href="#/legal/terms">Terms</a> <a href="#/legal/privacy">Privacy</a> <a href="#/legal/cookies">Cookies</a> <a href="#/legal/refunds">Refunds</a> <a href="#/legal/contact">Contact</a></nav></footer>`;
  let signedOut = false;
  window.flGateRedraw = () => gate(null, '', true);
  addEventListener('hashchange', () => {
    if (!signedOut) return;
    if (/^#\/auth\/(verify|magic|reset)\//.test(location.hash) && window.flAuth?.route({}, { gated: true })) return gate(null, '', true);
    if (/^#\/auth\/(login|signup|magic|forgot|username)$/.test(location.hash)) { window.flAuth?.route({}, { gated: true }); return gate(null, '', true) }
    if (!publicPage()) gate(null);
  });
  // inside the signed-out page, links to Plans and the policies change the address instead of opening an app page
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#flGate [data-page]'); if (!t || !signedOut) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    location.hash = '#/' + t.dataset.page + (t.dataset.arg ? '/' + t.dataset.arg : '');
  }, true);
  /* The landing page (landing.js) is drawn once; the sign-in card is redrawn into its dialog (#flgSlot).
     The dialog opens by itself for an invite link, an account waiting to be switched on, or an error. */
  function gate(user, err, show) {
    if (!user && signedOut && publicPage()) return;
    ready(() => {
      let g = document.getElementById('flGate');
      if (!g) { g = document.createElement('div'); g.id = 'flGate'; document.body.prepend(g) }
      const L = window.flLanding;
      if (L && !g.dataset.landing) { g.innerHTML = L.page(); g.dataset.landing = '1'; L.mount(g) }
      if (!L) g.innerHTML = `<div class="flg"><div id="flgSlot"></div></div>`;
      const slot = document.getElementById('flgSlot');
      slot.innerHTML = card(user, err);
      if (L && (show || err || invite || (user && user.role === 'pending'))) L.open();
      if (err) g.querySelector('#flgUser')?.focus();
    });
  }
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-g]'); if (!b || !b.closest('#flGate')) return;
    const a = b.dataset.g;
    if (a === 'login' || a === 'signup') { ev.preventDefault(); if (PUBLIC.test(location.hash)) history.replaceState(null, '', location.pathname); if (window.flAuth) { window.flAuth.set(a); return gate(null, '', true) } mode = a; forgot = false; if (invite) { invite = null; history.replaceState(null, '', location.pathname) } return gate(null, '', true) }
    if (a === 'forgot') { forgot = true; return gate(null, '', true) }
    if (a === 'back') { forgot = false; return gate(null, '', true) }
    if (a === 'logout') { await call('/api/auth/logout', {}).catch(() => {}); return gate(null) }
    if (a === 'check') return start();
  });
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'flgForm') return;
    ev.preventDefault();
    const username = document.getElementById('flgUser').value.trim(), password = document.getElementById('flgPass').value;
    try {
      const d = await call(mode === 'login' && !invite ? '/api/auth/login' : '/api/auth/signup', { username, password, display: username, ...(invite ? { invite: invite.token } : {}) });
      if (invite) history.replaceState(null, '', location.pathname);
      if (d.user && d.user.role !== 'pending') return location.reload();
      gate(d.user);
    } catch (e) { gate(null, e.message) }
  });

  /* ---------- start ---------- */
  async function start() {
    let d;
    try { d = await call('/api/me') } catch { return open(null) }   // no server (opened as a file): nothing to gate
    window.FL_GATED = !!d.gated;
    // an invite link (#/join/<code>): a signed-out visitor gets the join card, wherever the site is running
    const join = /^#\/join\/([\w-]{8,})$/.exec(location.hash);
    if (join && !d.user) {
      try { invite = { ...(await call('/api/invite?token=' + encodeURIComponent(join[1]))), token: join[1] } } catch (e) { invite = { error: e.message } }
      if (!invite.error) window.flAuth?.invite(invite);
      window.flAuth?.route(d, { gated: true });
      signedOut = true; mode = 'signup'; return gate(null);
    }
    if (join) history.replaceState(null, '', location.pathname);
    if (!d.gated) return open(d.user);
    if (d.user && d.user.role && d.user.role !== 'pending') return open(d.user);
    signedOut = !d.user;
    if (signedOut && window.flAuth) window.flAuth.route(d, { gated: true });
    gate(d.user, '', signedOut && /^#\/auth\//.test(location.hash));
  }
  start();
})();
