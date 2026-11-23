/* Floodlight · signing in, creating an account and getting back in (accounts.py on the server).
   One card, many modes, drawn on the signed-out front page (access.js asks flAuth.card()) and as the in-app page #/auth/<mode>:
     login     username or email + password; then a 6-digit code when two-step sign-in is on
     signup    username, email, password, 18+ and terms boxes (an invite link fills the email)
     magic     email me a sign-in link            #/auth/magic/<token> signs in with it
     forgot    email me a password reset link     #/auth/reset/<token> sets the new password
     username  email me my username
     verify    #/auth/verify/<token> confirms an email address
   Also: the "accept the new terms" dialog when the terms changed since a member last accepted them.
   Without an email provider on your own computer, the server returns the link (devLink) and the card shows it. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const track = (n, p) => { try { window.flTrack?.(n, p) } catch {} };
  const A = { mode: 'login', err: '', msg: '', ticket: '', token: '', busy: false, terms: '', invite: null, host: null, gated: false };
  async function call(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.data = d; throw e }
    return d;
  }
  const dev = d => d && d.devLink ? `<p class="fla-dev">Email isn't set up on this server, so here is the link: <a href="${esc(d.devLink)}">${esc(d.devLink.replace(/^https?:\/\/[^/]+/, ''))}</a></p>` : '';
  const legal = (k, t) => `<a href="#/legal/${k}" target="_blank" rel="noopener">${t}</a>`;
  const TITLE = { login: 'Log in', signup: 'Create account', magic: 'Email me a sign-in link', forgot: 'Reset your password', username: 'Find your username',
    reset: 'Choose a new password', twofa: 'Enter your code', verify: 'Confirming your email', magicuse: 'Signing you in', done: '' };

  function form() {
    const m = A.mode, inv = A.invite && !A.invite.error ? A.invite : null;
    const tabs = (m === 'login' || m === 'signup') ? `<div class="flg-tabs" role="tablist" aria-label="Log in or create an account"><button type="button" role="tab" aria-selected="${m === 'login'}" class="${m === 'login' ? 'on' : ''}" data-fa="login">Log in</button><button type="button" role="tab" aria-selected="${m === 'signup'}" class="${m === 'signup' ? 'on' : ''}" data-fa="signup">Create account</button></div>` : '';
    const back = `<button type="button" class="flg-forgot" data-fa="login">Back to log in</button>`;
    const btn = l => `<button class="btn" type="submit" ${A.busy ? 'disabled' : ''}>${A.busy ? 'Working…' : l}</button>`;
    if (m === 'login') return `${tabs}<form id="flaForm" novalidate>
        <label for="faLogin">Username or email</label><input id="faLogin" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <label for="faPass">Password</label><input id="faPass" name="password" type="password" autocomplete="current-password" required>
        ${btn('Log in')}</form>
      <div class="fla-links"><button type="button" class="flg-forgot" data-fa="forgot">Forgot password?</button><button type="button" class="flg-forgot" data-fa="magic">Email me a sign-in link</button><button type="button" class="flg-forgot" data-fa="username">Forgot username?</button></div>`;
    if (m === 'signup') return `${tabs}<form id="flaForm" novalidate>
        <label for="faUser">Username</label><input id="faUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="20" placeholder="3–20 letters, numbers, . or _" aria-describedby="faUserH">
        <label for="faEmail">Email</label><input id="faEmail" name="email" type="email" autocomplete="email" spellcheck="false" required ${inv ? `value="${esc(inv.email)}"` : ''} placeholder="you@example.com">
        <label for="faPass">Password (8 or more characters)</label><input id="faPass" name="password" type="password" autocomplete="new-password" minlength="8" required>
        <label class="fla-check"><input type="checkbox" name="adult" required> I'm 18 or older (21 where my state requires it)</label>
        <label class="fla-check"><input type="checkbox" name="terms" required> I accept the ${legal('terms', 'Terms of Service')} and ${legal('privacy', 'Privacy Policy')}</label>
        ${btn(inv ? 'Join Floodlight' : 'Create account')}</form>
      <p class="fla-small" id="faUserH">We'll email you a link to confirm your address. It's how you get back in if you forget your password.</p>`;
    if (m === 'magic') return `<p>Enter the email on your account and we'll send a link that signs you in, no password needed. It works once, for 15 minutes.</p><form id="flaForm" novalidate>
        <label for="faEmail">Email</label><input id="faEmail" name="email" type="email" autocomplete="email" spellcheck="false" required>${btn('Email me a link')}</form>${back}`;
    if (m === 'forgot') return `<p>Enter your username or email and we'll send a link to choose a new password. It works for an hour.</p><form id="flaForm" novalidate>
        <label for="faLogin">Username or email</label><input id="faLogin" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required>${btn('Send reset link')}</form>${back}`;
    if (m === 'username') return `<p>Enter the email on your account and we'll send your username to it.</p><form id="flaForm" novalidate>
        <label for="faEmail">Email</label><input id="faEmail" name="email" type="email" autocomplete="email" spellcheck="false" required>${btn('Email my username')}</form>${back}`;
    if (m === 'reset') return `<form id="flaForm" novalidate>
        <label for="faPass">New password (8 or more characters)</label><input id="faPass" name="password" type="password" autocomplete="new-password" minlength="8" required>
        <label for="faPass2">Type it again</label><input id="faPass2" name="password2" type="password" autocomplete="new-password" required>
        ${btn('Save and log in')}</form><p class="fla-small">Saving signs you out on every other device.</p>`;
    if (m === 'twofa') return `<p>Open your authenticator app and enter the 6-digit code for Floodlight. Lost your phone? Enter one of your recovery codes.</p><form id="flaForm" novalidate>
        <label for="faCode">Code</label><input id="faCode" name="code" inputmode="numeric" autocomplete="one-time-code" spellcheck="false" required maxlength="12">${btn('Log in')}</form>${back}`;
    if (m === 'verify' || m === 'magicuse') return A.err ? back : `<p role="status">One moment…</p>`;
    return back;
  }

  function card(user, err) {
    if (err) A.err = err;
    const title = A.invite && !A.invite.error && A.mode === 'signup' ? "You're invited" : TITLE[A.mode] || 'Floodlight';
    const lead = A.invite && !A.invite.error && A.mode === 'signup' ? `<p>${esc(A.invite.by)} invited <strong>${esc(A.invite.email)}</strong>${A.invite.rank === 'admin' ? ' as an admin' : ''}. Pick a username and password to join.</p>`
      : A.mode === 'login' ? '<p>Welcome back.</p>' : A.mode === 'signup' && !A.invite ? '<p>Free to start: live scores, 5 Lab searches a day and your own Home.</p>' : '';
    return `<div class="flg-card fla" id="flgCard"><h2 class="flg-h" id="faH" tabindex="-1">${esc(title)}</h2>${lead}
      ${A.msg ? `<div class="flg-ok" role="status">${A.msg}</div>` : ''}${form()}
      <div class="flg-err" role="alert">${esc(A.err || '')}</div></div>`;
  }

  /* where the card lives: the signed-out front page (access.js) or the #/auth page inside the app */
  function redraw(focus) {
    if (A.gated && window.flGateRedraw) window.flGateRedraw();
    else if (A.host) A.host.innerHTML = `<div class="fla-page">${card()}</div>`;
    if (focus) setTimeout(() => (document.querySelector('#flgCard .flg-err:not(:empty)') ? document.querySelector('#flgCard input') : document.getElementById('faH'))?.focus(), 0);
  }
  function set(mode, extra = {}) { Object.assign(A, { mode, err: '', msg: '', busy: false }, extra); redraw(true) }

  async function signedIn(d, how) {
    if (how === 'signup') { try { sessionStorage.setItem('fl.newAccount', '1') } catch {} track('signup', {}) }
    let next = ''; try { next = sessionStorage.getItem('fl.after') || ''; sessionStorage.removeItem('fl.after') } catch {}
    if (A.gated || !window.flPages) { location.hash = next; location.reload(); return }
    if (typeof adoptUser === 'function') adoptUser(d.user);
    if (next) location.hash = next; else window.flPages.hide();
  }

  async function submit(f) {
    const v = Object.fromEntries(new FormData(f)), m = A.mode;
    A.err = ''; A.msg = '';
    const need = (ok, msg, field) => { if (!ok) { const e = new Error(msg); e.field = field; throw e } };
    try {
      if (m === 'login') need(v.login && v.password, 'Enter your username or email and your password.', 'login');
      if (m === 'signup') { need(v.username && v.email && v.password, 'Fill in a username, email and password.', 'username'); need(v.adult, "Tick the box to confirm you're 18 or older.", 'adult'); need(v.terms, 'Tick the box to accept the Terms and Privacy Policy.', 'terms') }
      if (m === 'reset') need(v.password === v.password2, "The two passwords don't match.", 'password2');
      A.busy = true; redraw();
      let d;
      if (m === 'login') { d = await call('/api/auth/login', { username: v.login, password: v.password }); if (d.need2fa) return set('twofa', { ticket: d.ticket }); return signedIn(d, 'login') }
      if (m === 'signup') {
        let ref = ''; try { ref = localStorage.getItem('fl.ref') || '' } catch {}
        d = await call('/api/auth/signup', { username: v.username, email: v.email, password: v.password, display: v.username, adult: true, terms: A.terms || (await terms()), ref, ...(A.invite?.token ? { invite: A.invite.token } : {}),
          prefs: window.S ? { favTeams: S.fav || [], favPlayers: S.favPlayers || [], favLeagues: S.favLeagues || [] } : undefined });
        if (A.invite) history.replaceState(null, '', location.pathname);
        return signedIn(d, 'signup');
      }
      if (m === 'twofa') { d = await call('/api/auth/2fa', { ticket: A.ticket, code: v.code }); return signedIn(d, 'login') }
      if (m === 'reset') { d = await call('/api/auth/reset', { token: A.token, password: v.password }); if (d.need2fa) return set('twofa', { ticket: d.ticket }); history.replaceState(null, '', location.pathname); return signedIn(d, 'login') }
      if (m === 'magic') d = await call('/api/auth/magic', { email: v.email });
      if (m === 'forgot') d = await call('/api/auth/forgot', { login: v.login });
      if (m === 'username') d = await call('/api/auth/username', { email: v.email });
      A.busy = false; A.msg = esc(d.message || 'Done.') + dev(d) + (d.devNames?.length ? `<p class="fla-dev">Usernames: ${d.devNames.map(esc).join(', ')}</p>` : '');
      redraw(true);
    } catch (e) { A.busy = false; A.err = e.message; redraw(); setTimeout(() => document.querySelector(`#flaForm [name="${e.field || e.data?.field || ''}"]`)?.focus?.() || document.querySelector('#flaForm input')?.focus(), 0) }
  }

  async function terms() {
    if (A.terms) return A.terms;
    try { A.terms = (await call('/api/me')).terms || '' } catch {}
    return A.terms;
  }

  // a link from an email: #/auth/<kind>/<token>
  async function link(kind, token) {
    if (kind === 'reset') return set('reset', { token });
    if (kind === 'verify') {
      set('verify');
      try { const d = await call('/api/auth/verify', { token }); history.replaceState(null, '', location.pathname); A.msg = `<strong>Email confirmed.</strong> ${esc(d.email)} is on @${esc(d.username)}.`; A.mode = window.S?.me ? 'done' : 'login'; track('email_verified', {}) }
      catch (e) { A.err = e.message }
      if (window.S?.me && typeof adoptUser === 'function') call('/api/me').then(d => d.user && adoptUser(d.user)).catch(() => {});
      return redraw(true);
    }
    if (kind === 'magic') {
      set('magicuse');
      try { const d = await call('/api/auth/magic/use', { token }); history.replaceState(null, '', location.pathname); if (d.need2fa) return set('twofa', { ticket: d.ticket }); return signedIn(d, 'login') }
      catch (e) { A.err = e.message; A.mode = 'magic'; return redraw(true) }
    }
  }

  /* Called by access.js on start. Returns true when the URL is an account link or a public page it should handle. */
  function route(d, opts = {}) {
    A.gated = !!opts.gated; A.terms = d.terms || A.terms;
    const h = location.hash;
    const m = /^#\/auth\/(verify|magic|reset)\/([\w-]{20,})$/.exec(h);
    if (m) { link(m[1], m[2]); return true }
    const p = /^#\/auth\/(login|signup|magic|forgot|username)$/.exec(h);
    if (p) { A.mode = p[1]; return true }
    return false;
  }

  /* the in-app page, for when nobody has to sign in to see the site (your own computer) or for links opened while signed in */
  const addPage = () => window.flPages?.add('auth', { title: 'Account', fresh: true, render(el, arg) {
    A.host = el; A.gated = false;
    const [kind, token] = String(arg || '').split('/');
    if (token) return link(kind, token);
    if (TITLE[kind] !== undefined && !['verify', 'magicuse', 'reset', 'twofa'].includes(kind)) A.mode = kind;
    redraw(true);
  } });
  if (window.flPages) addPage(); else document.addEventListener('DOMContentLoaded', addPage);

  document.addEventListener('click', ev => {
    const b = ev.target.closest?.('[data-fa]'); if (!b || !b.closest('#flgCard,.fla-page')) return;
    ev.preventDefault(); set(b.dataset.fa);
  });
  document.addEventListener('submit', ev => { if (ev.target.id === 'flaForm') { ev.preventDefault(); submit(ev.target) } });

  /* the terms changed since this member accepted them: ask before they carry on */
  function askTerms(user) {
    if (!user || user.terms?.ok !== false || document.getElementById('flaTerms')) return;
    const d = document.createElement('dialog'); d.id = 'flaTerms'; d.className = 'ac-dlg'; d.setAttribute('aria-labelledby', 'flaTermsH');
    d.innerHTML = `<h2 class="ac-h" id="flaTermsH">We've updated our terms</h2>
      <p class="ac-help">Please read and accept the current ${legal('terms', 'Terms of Service')}, ${legal('privacy', 'Privacy Policy')} and ${legal('subscription', 'Subscription Terms')} to keep using Floodlight.</p>
      <p class="flg-err" role="alert"></p>
      <div class="cx-row"><button type="button" class="bt" data-terms="ok">I accept</button><button type="button" class="bt ghost" data-terms="out">Log out</button></div>`;
    d.addEventListener('cancel', e => e.preventDefault());
    d.addEventListener('click', async e => {
      const b = e.target.closest('[data-terms]'); if (!b) return;
      if (b.dataset.terms === 'out') { await call('/api/auth/logout', {}).catch(() => {}); return location.reload() }
      try { await call('/api/me/terms', { version: user.terms.version }); user.terms.ok = true; d.close(); d.remove() } catch (err) { d.querySelector('.flg-err').textContent = err.message }
    });
    document.body.appendChild(d); d.showModal();
  }
  document.addEventListener('fl:me', () => askTerms(window.S?.me));

  window.flAuth = {
    card, route, set, askTerms,
    get mode() { return A.mode },
    invite(inv) { A.invite = inv; A.mode = 'signup' },
    open(mode = 'login') {
      if (A.gated || (window.FL_GATED && !window.S?.me)) { set(mode); document.getElementById('flgCard')?.scrollIntoView({ block: 'center' }); return }
      window.flPages?.show('auth', mode);
    },
    twofa(ticket) { A.ticket = ticket; window.flPages?.show('auth', 'twofa'); set('twofa', { ticket }) },
  };
})();
