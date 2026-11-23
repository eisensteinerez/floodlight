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
.flg-land{min-height:100vh;background:var(--bg);color:var(--fg);font-family:var(--f-body)}
.flg-nav{max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px}
.flg-nav .flg-brand{font-size:26px;margin:0}.flg-nav .flg-brand svg{width:26px;height:26px}
.flg-nav a{font:700 13px/1 var(--f-body);color:var(--fg);padding:10px 16px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--surface);text-decoration:none}
.flg-hero{max-width:1120px;margin:0 auto;padding:28px 20px 40px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,380px);gap:48px;align-items:center}
.flg-kick{display:inline-flex;align-items:center;gap:8px;font:700 12px/1 var(--f-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
.flg-kick i{width:8px;height:8px;border-radius:50%;background:var(--win,#16a34a);box-shadow:0 0 0 4px color-mix(in oklab,var(--win,#16a34a) 22%,transparent)}
.flg-hero h1{font:900 clamp(40px,6vw,68px)/.95 var(--f-display);text-transform:uppercase;letter-spacing:.01em;margin:0 0 16px;text-wrap:balance}
.flg-hero h1 em{font-style:normal;color:var(--accent)}
.flg-lead{font-size:17px;line-height:1.55;color:var(--muted);margin:0 0 22px;max-width:56ch;text-wrap:pretty}
.flg-sports{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:26px}
.flg-sports span{font:600 12px/1 var(--f-body);padding:7px 11px;border-radius:var(--r-pill);background:var(--surface);border:1px solid var(--line)}
.flg-demo{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:16px 18px;box-shadow:var(--shadow);max-width:520px}
.flg-demo-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px}
.flg-demo-top b{font-size:15px}.flg-demo-top small{font:700 12px/1 var(--f-body);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.flg-demo p{margin:0 0 12px;font-size:13px;color:var(--muted)}
.flg-bars{display:flex;align-items:flex-end;gap:6px;height:96px;position:relative;border-bottom:1px solid var(--line)}
.flg-bars::after{content:"";position:absolute;left:0;right:0;bottom:var(--line-at);border-top:2px dashed color-mix(in oklab,var(--fg) 45%,transparent)}
.flg-bars i{flex:1;border-radius:var(--r-ctl) var(--r-ctl) 0 0;background:var(--win,#16a34a);height:var(--h)}.flg-bars i.miss{background:var(--loss,#dc2626)}
.flg-rates{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
.flg-rates div{background:var(--surface-2);border-radius:var(--r-ctl);padding:8px 10px}.flg-rates b{display:block;font:800 18px/1 var(--f-body)}.flg-rates span{font-size:12px;color:var(--muted)}
.flg-hero .flg-card{max-width:none}
.flg-feat{max-width:1120px;margin:0 auto;padding:8px 20px 56px}
.flg-feat h2{font:900 30px/1 var(--f-display);text-transform:uppercase;margin:0 0 18px}
.flg-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.flg-grid article{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:18px}
.flg-grid h3{margin:10px 0 6px;font:800 15px/1.2 var(--f-body)}.flg-grid p{margin:0;font-size:13.5px;line-height:1.5;color:var(--muted)}
.flg-ico{width:36px;height:36px;border-radius:var(--r-ctl);display:grid;place-items:center;background:color-mix(in oklab,var(--accent) 16%,transparent);color:var(--accent)}
.flg-ico svg{width:19px;height:19px}
.flg-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:40px;counter-reset:st}
.flg-steps div{counter-increment:st;padding:16px 18px;border-radius:var(--r-card);border:1px dashed var(--line)}
.flg-steps div::before{content:counter(st);display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--fg);color:var(--bg);font:800 13px/1 var(--f-body);margin-bottom:10px}
.flg-steps b{display:block;font-size:14px;margin-bottom:4px}.flg-steps span{font-size:13px;color:var(--muted);line-height:1.45}
.flg-foot{max-width:1120px;margin:0 auto;padding:20px 20px 36px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.flg-h{font:900 26px/1 var(--f-display);text-transform:uppercase;margin:0 0 8px}
.flg-card .btn + .btn{margin-top:8px}
.flg-forgot{display:block;margin:12px auto 0;font:600 12.5px/1 var(--f-body);color:var(--muted);text-decoration:underline;text-underline-offset:3px}
@media (max-width:900px){.flg-hero{grid-template-columns:1fr;gap:28px}.flg-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.flg-hero{padding-top:8px}.flg-grid,.flg-steps{grid-template-columns:1fr}.flg-rates{grid-template-columns:repeat(2,1fr)}.flg-nav{padding:14px 16px}.flg-hero,.flg-feat{padding-left:16px;padding-right:16px}}`;
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
  const ICON = {
    research: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    props: '<path d="M3 6h18M3 12h12M3 18h7"/><path d="m17 16 2 2 4-4"/>',
    predict: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lineup: '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 20c0-2.6 1.3-4.6 4-5"/>',
    live: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/>',
    discord: '<path d="M8 12h.01M16 12h.01"/><path d="M7.5 17.5 6 20c-2-.6-3.6-1.6-5-3 .3-4 1.3-8 3.5-11.5C6 4.8 7.5 4.3 9 4l.8 1.6a12 12 0 0 1 4.4 0L15 4c1.5.3 3 .8 4.5 1.5C21.7 9 22.7 13 23 17c-1.4 1.4-3 2.4-5 3l-1.5-2.5"/>'
  };
  const ico = k => `<span class="flg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg></span>`;
  // the example on the front page: ten real games against a 35.5 line (under = green)
  const DEMO = [33, 24, 32, 18, 31, 31, 37, 28, 25, 32].reverse(), LINE = 35.5, TOP = 42;
  const demo = `<div class="flg-demo" aria-label="Example Lab card">
      <div class="flg-demo-top"><b>LeBron James · Pts + Reb + Ast</b><small>Example</small></div>
      <p>Under 35.5 · last 10 games, oldest to newest</p>
      <div class="flg-bars" style="--line-at:${(LINE / TOP * 100).toFixed(1)}%">${DEMO.map(v => `<i class="${v > LINE ? 'miss' : ''}" style="--h:${(v / TOP * 100).toFixed(1)}%" title="${v}"></i>`).join('')}</div>
      <div class="flg-rates"><div><b>100%</b><span>Last 5</span></div><div><b>90%</b><span>Last 10</span></div><div><b>70%</b><span>Last 20</span></div><div><b>91%</b><span>This season</span></div></div>
    </div>`;
  const FEATURES = [
    ['research', 'The Lab', 'Any player, any stat, any line. See every game against the line, with hit rates over the last 5, 10 and 20 games, this season, home or away and against tonight\'s opponent.'],
    ['props', "Today's props, ranked", 'Every PrizePicks, Sleeper and sportsbook line on the board, sorted by how often the player has actually cleared it.'],
    ['predict', 'Predictions', 'Win chances for every game from a model that blends form, goals and absences with the betting market, plus value spots where one book is out of line.'],
    ['lineups', 'Lineups and injuries', 'Predicted and confirmed lineups, probable pitchers and injury news, so a line never catches you off guard.'],
    ['live', 'Live scores', 'Soccer, NFL, NBA, MLB, NHL and tennis in one place, with box scores, play-by-play and stats.'],
    ['discord', 'In your Discord', 'The same numbers as slash commands in The Prop Room: /lab, /props, /predict, /scores and /lineup.']].map(([k, ...r]) => [k === 'lineups' ? 'lineup' : k, ...r]);
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
  window.flGateRedraw = () => gate(null);
  addEventListener('hashchange', () => {
    if (!signedOut) return;
    if (/^#\/auth\/(verify|magic|reset)\//.test(location.hash) && window.flAuth?.route({}, { gated: true })) return gate(null);
    if (/^#\/auth\/(login|signup|magic|forgot|username)$/.test(location.hash)) { window.flAuth?.route({}, { gated: true }); return gate(null) }
    if (!publicPage()) gate(null);
  });
  // inside the signed-out page, links to Plans and the policies change the address instead of opening an app page
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#flGate [data-page]'); if (!t || !signedOut) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    location.hash = '#/' + t.dataset.page + (t.dataset.arg ? '/' + t.dataset.arg : '');
  }, true);
  function gate(user, err) {
    if (!user && signedOut && publicPage()) return;
    ready(() => {
      let g = document.getElementById('flGate');
      if (!g) { g = document.createElement('div'); g.id = 'flGate'; document.body.prepend(g) }
      const focus = !!document.getElementById('flgCard');
      g.innerHTML = `<div class="flg-land">
        <nav class="flg-nav"><div class="flg-brand">${LOGO}Floodlight</div><a href="#flgCard" data-g="login">Log in</a></nav>
        <section class="flg-hero">
          <div>
            <div class="flg-kick"><i></i>Members-only sports numbers</div>
            <h1>Know the hit rate <em>before</em> you lock it in.</h1>
            <p class="flg-lead">Floodlight checks every player prop against what actually happened: last 5, 10 and 20 games, this season and head to head. Live scores, predictions and lineups sit alongside, for every major sport.</p>
            <div class="flg-sports">${['Soccer', 'NFL', 'NBA', 'WNBA', 'MLB', 'NHL', 'Tennis'].map(x => `<span>${x}</span>`).join('')}</div>
            ${demo}
          </div>
          ${card(user, err)}
        </section>
        <section class="flg-feat">
          <h2>What members get</h2>
          <div class="flg-grid">${FEATURES.map(([k, t, d]) => `<article>${ico(k)}<h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
          <div class="flg-steps"><div><b>Create your account</b><span>Pick a username and password. It takes ten seconds and needs no email.</span></div>
            <div><b>Get straight in</b><span>Live scores, lineups and predictions open up right away.</span></div>
            <div><b>Open the Lab</b><span>On the site, on your phone (add it to your home screen) or in Discord.</span></div></div>
        </section>
        ${FOOT}
      </div>`;
      if (focus || err) g.querySelector('#flgUser, #flgCard input')?.focus();
    });
  }
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-g]'); if (!b || !b.closest('#flGate')) return;
    const a = b.dataset.g;
    if ((a === 'login' || a === 'signup') && window.flAuth) { ev.preventDefault(); if (PUBLIC.test(location.hash)) history.replaceState(null, '', location.pathname); window.flAuth.set(a); gate(null); return document.getElementById('flgCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    if (a === 'login' || a === 'signup') { ev.preventDefault(); mode = a; forgot = false; if (invite) { invite = null; history.replaceState(null, '', location.pathname) } gate(null); return document.getElementById('flgCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    if (a === 'forgot') { forgot = true; return gate(null) }
    if (a === 'back') { forgot = false; return gate(null) }
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
    gate(d.user);
  }
  start();
})();
