/* Floodlight · Help center (#/help) and support tickets (support.py on the server).
   - Answers grouped by topic, with a search across all of them.
   - Contact support: a kind (question, bug report, incorrect data, billing, feature request, account recovery),
     a subject and the message. The page adds the technical details itself (page, browser, device, screen size,
     time zone, theme) and lists them on the form, so nobody has to type them. Each kind says how soon we answer.
   - A sent ticket gets a number at once; Your tickets lists them with every reply, and the member can answer back.
   - window.flSupport.report(fields) opens the shared "Report incorrect data" dialog (window.flReport) for a line or pick.
   - Usage statistics can be switched off here (analytics.js). */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const me = () => { try { return S.me } catch { return null } };
  const KINDS = [['question', 'A question'], ['bug', 'Something is broken'], ['data', 'Incorrect data'], ['billing', 'Billing'], ['feature', 'A feature request'], ['account', 'Getting into my account']];
  const DAYS = { data: 1, billing: 1, account: 1, bug: 2, question: 2, feature: 3 };
  const STATUS = { open: 'Waiting for us', answered: 'Answered', closed: 'Closed' };
  const H = { tickets: null, err: '', open: new Set(), sent: null, kind: 'question', busy: false };

  /* ---------- what the page attaches by itself ---------- */
  function browser() {
    const ua = navigator.userAgent;
    const b = /Edg\/(\d+)/.exec(ua) ? ['Edge', RegExp.$1] : /OPR\/(\d+)/.exec(ua) ? ['Opera', RegExp.$1] : /Firefox\/(\d+)/.exec(ua) ? ['Firefox', RegExp.$1]
      : /CriOS\/(\d+)/.exec(ua) || /Chrome\/(\d+)/.exec(ua) ? ['Chrome', RegExp.$1] : /Version\/(\d+).*Safari/.exec(ua) ? ['Safari', RegExp.$1] : ['Other', ''];
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
    return { browser: b.join(' ').trim(), os };
  }
  function context(extra) {
    const b = browser();
    return { page: location.pathname + location.hash, title: document.title, device: window.flTrack?.device?.() || '', browser: b.browser, os: b.os,
      viewport: `${innerWidth}×${innerHeight}`, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', theme: window.flTheme?.get?.() || '', lang: navigator.language || '', ...(extra || {}) };
  }
  const CTX_LABEL = { page: 'Page', device: 'Device', browser: 'Browser', os: 'System', viewport: 'Window size', tz: 'Time zone', theme: 'Theme',
    marketId: 'Market ID', providerMarketId: 'Provider’s market ID', eventId: 'Event ID', player: 'Player', stat: 'Statistic', line: 'Line', side: 'Side', sport: 'Sport',
    provider: 'Provider', verifiedAt: 'Last verified', start: 'Game start', opponent: 'Opponent' };
  const when = v => { const d = new Date(v); return isNaN(d) ? v : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) };
  const ctxList = c => `<dl class="hc-ctx">${Object.entries(c).filter(([k, v]) => CTX_LABEL[k] && v !== '' && v != null).map(([k, v]) => `<div><dt>${CTX_LABEL[k]}</dt><dd>${esc(/At$|^start$/.test(k) ? when(v) : v)}</dd></div>`).join('')}</dl>`;

  async function call(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `The server answered ${r.status}.`); e.field = d.field; e.status = r.status; throw e }
    return d;
  }

  /* ---------- the answers ---------- */
  const TOPICS = [
    { id: 'start', title: 'Getting started', qs: [
      ['What can I do on Floodlight?', 'Follow live scores, research players and teams in the Lab, read predictions with the evidence behind them, and set alerts for teams, players and picks. How to use Floodlight in the menu walks through each part with a small working example.'],
      ['How do I make Home about my teams?', 'Open Home, choose Edit your Home, and pick your sports, teams and players. Home then leads with your games and the players you follow.'],
      ['Can I install Floodlight on my phone?', 'Yes. In Safari, tap Share and then Add to Home Screen. In Chrome, open the menu and choose Install app. It opens full screen like an app.'] ] },
    { id: 'lab', title: 'The Lab', qs: [
      ['What does “over in 7 of the last 10” mean?', 'In seven of the player’s last ten games, the statistic finished above tonight’s line. It describes the past. It doesn’t promise tonight’s result, and a short record moves a lot with one unusual game.'],
      ['Why does a player show no line?', 'Either no book or pick’em app has posted one yet, or the line was taken down. Floodlight only shows lines it has verified recently, for games that haven’t started.'],
      ['Why does the team or opponent look wrong?', 'Trades and call-ups can take a day to reach every feed. Use Report incorrect data on the card, and the market details are attached for us automatically.'] ] },
    { id: 'predictions', title: 'Predictions and grading', qs: [
      ['How are predictions graded?', 'Each prediction is saved with its line, price and time before the game starts and can’t be changed afterwards. After the final, it’s graded from the official result as a hit, miss, push or void, with the source and time of grading kept beside it.'],
      ['What happens when a grade is wrong?', 'An owner corrects it, the original grade stays visible next to the correction, and the change is listed in the public correction log on the Trust and data page.'],
      ['Why is there no hit rate yet?', 'A hit rate from a handful of picks says almost nothing. Floodlight shows early results under 25 graded picks, adds a small-sample warning from 25 to 99, and publishes full reporting from 100.'] ] },
    { id: 'data', title: 'Data, sources and corrections', qs: [
      ['Where do the numbers come from?', 'Scores, schedules and box scores from league and team feeds; lines and prices from sportsbooks and pick’em apps; injuries from official reports. The Trust and data page shows how fresh each source is right now.'],
      ['How do I report a wrong number?', 'Open the pick or line and choose Report incorrect data. The market ID, player, provider and when the line was last verified are attached for you, with your browser and device. Add a sentence on what looks wrong.'] ] },
    { id: 'account', title: 'Account and sign-in', qs: [
      ['I forgot my password', 'Contact support below and choose Getting into my account. Include your username and an email we can reach you at. Account recovery is answered within one business day.'],
      ['How do I delete my account?', 'Open the menu, choose Edit profile, then Delete account. It asks for your password, then removes your account, your saved parlays and your sessions.'] ] },
    { id: 'billing', title: 'Plans and billing', qs: [
      ['Is Floodlight free?', 'There is always a free plan. Paid plans show the exact price and renewal date before you pay.'],
      ['How do I cancel?', 'From your account, at any time, without contacting support. You keep what you paid for until the end of the period.'],
      ['I was charged and something looks wrong', 'Contact support below and choose Billing. Billing questions are answered within one business day.'] ] },
    { id: 'privacy', title: 'Privacy and usage statistics', qs: [
      ['What does Floodlight count about how I use it?', 'Counts of actions such as a Lab search, a player opened or a board saved, so we can see which parts help. They are kept on Floodlight’s own server, with no outside analytics service and no cookies. Your IP address is not stored. If your browser asks sites not to track you, nothing is sent.'] ] },
  ];
  const words = (...xs) => esc(xs.join(' ').toLowerCase());

  function contactForm() {
    const u = me(), k = H.kind, ctx = context();
    return `<form class="card hc-form" id="hcForm" novalidate aria-labelledby="hcFormH">
      <h2 id="hcFormH">Contact support</h2>
      <p class="lb" id="hcWhen">We answer ${k === 'feature' ? 'feature requests within 3 business days' : `within ${DAYS[k]} business day${DAYS[k] === 1 ? '' : 's'}`}. You’ll get a ticket number as soon as you send.</p>
      <label class="fl-f" for="hcKind">What is it about?<select class="inp" id="hcKind" name="kind">${KINDS.map(([v, l]) => `<option value="${v}"${v === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fl-f" for="hcSub">Subject<input class="inp" id="hcSub" name="subject" maxlength="120" autocomplete="off" placeholder="For example: Live score stuck in the second half…"></label>
      <label class="fl-f" for="hcText">What happened?<textarea class="inp" id="hcText" name="text" rows="5" maxlength="4000" required aria-describedby="hcTextHint"></textarea></label>
      <p class="lb" id="hcTextHint">${k === 'bug' ? 'What you did, what you expected and what happened instead.' : k === 'data' ? 'Which game, player or line, and what the right value is if you know it.' : k === 'feature' ? 'What you’re trying to do, and what would make it easier.' : 'A sentence or two is enough.'}</p>
      <label class="fl-f" for="hcEmail">Email${u ? ' (optional)' : ''}<input class="inp" id="hcEmail" name="email" type="email" autocomplete="email" spellcheck="false" ${u ? '' : 'required'} placeholder="you@example.com…"></label>
      <input type="text" name="website" tabindex="-1" autocomplete="off" class="lp-hp" aria-hidden="true">
      <details class="hc-att"><summary>Attached automatically</summary>${ctxList(ctx)}<p class="lb">Nothing else from your device is sent.</p></details>
      <div class="hc-acts"><button class="bt" type="submit"${H.busy ? ' disabled' : ''}>${H.busy ? 'Sending…' : 'Send to support'}</button></div>
      <p class="hc-msg" role="alert" id="hcMsg"></p>
    </form>`;
  }
  function sentCard() {
    const t = H.sent;
    return `<section class="card hc-done" aria-labelledby="hcDoneH"><h2 id="hcDoneH" tabindex="-1">Ticket ${esc(t.id)} received</h2>
      <p>We’ll answer within ${t.replyDays} business day${t.replyDays === 1 ? '' : 's'}${t.email ? ` at ${esc(t.email)}` : ' here, under Your tickets'}. Keep the number in case you need to follow up.</p>
      <button type="button" class="bt ghost" data-hc="another">Send another message</button></section>`;
  }
  function ticketRow(t) {
    const open = H.open.has(t.id);
    return `<li class="hc-t"><button type="button" class="rw" data-hc-t="${esc(t.id)}" aria-expanded="${open}" aria-controls="hct-${esc(t.id)}">
        <span class="rw-t"><b>${esc(t.subject)}</b><small>${esc(t.id)}, ${esc(t.kindLabel)}, updated ${esc(when(t.updated * 1000))}</small></span>
        <span class="pl${t.status === 'answered' ? ' solid' : ''}">${STATUS[t.status] || t.status}</span></button>
      <div class="hc-thread" id="hct-${esc(t.id)}"${open ? '' : ' hidden'}>
        ${t.messages.map(m => `<div class="hc-m ${m.by === 'staff' ? 'staff' : ''}"><b>${m.by === 'staff' ? esc(m.name || 'Floodlight') : 'You'}</b><small>${esc(when(m.at * 1000))}</small><p>${esc(m.text)}</p></div>`).join('')}
        ${Object.keys(t.context || {}).length ? `<details class="hc-att"><summary>Details sent with this ticket</summary>${ctxList(t.context)}</details>` : ''}
        ${t.status !== 'closed' ? `<form class="hc-reply" data-hc-reply="${esc(t.id)}"><label class="fl-f">Reply<textarea class="inp" name="text" rows="2" maxlength="4000" required></textarea></label><button class="bt sm" type="submit">Send reply</button></form>` : '<p class="lb">This ticket is closed. Send a new message if you need more help.</p>'}
      </div></li>`;
  }
  function ticketsCard() {
    if (!me()) return '';
    const ts = H.tickets;
    return `<section class="card hc-tix" aria-labelledby="hcTixH"><div class="sec-h"><h2 id="hcTixH">Your tickets</h2></div>
      ${ts == null ? `<p class="lb">${H.err ? esc(H.err) : 'Loading your tickets…'}</p>${H.err ? '<button type="button" class="bt sm ghost" data-hc="reload">Try again</button>' : ''}`
        : ts.length ? `<ul class="hc-tl">${ts.map(ticketRow).join('')}</ul>` : '<p class="lb">No tickets yet. Anything you send appears here with our replies.</p>'}</section>`;
  }
  function privacyCard() {
    const T = window.flTrack, blocked = T?.blocked?.(), on = T?.enabled?.();
    return `<section class="card hc-priv" aria-labelledby="hcPrivH"><h2 id="hcPrivH">Usage statistics</h2>
      <p class="lb">Counts of actions like searches and saved boards, kept on Floodlight’s own server. No cookies, no outside service, no IP address stored.</p>
      ${blocked ? '<p>Your browser asks sites not to track you, so nothing is sent. Nothing to change here.</p>'
        : `<label class="hc-sw"><input type="checkbox" class="sw" data-hc="track"${on ? ' checked' : ''}><span>Share anonymous usage statistics from this browser</span></label>`}</section>`;
  }
  function render(el) {
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Help center</h1><p class="pg-sub">Answers to common questions, and a way to reach a person when they don’t cover it.</p></div></header>
      <div class="hc-search"><label class="gd-search"><span class="sr-only">Search help</span>${ic('search', 18)}<input class="inp" type="search" id="hcQ" placeholder="Search help, for example “grading” or “password”…" autocomplete="off"></label>
        <p class="lb" id="hcCount" role="status" aria-live="polite"></p></div>
      <div class="hc-grid">
        <div class="hc-topics" id="hcTopics">${TOPICS.map(t => `<section class="hc-topic" id="hc-${t.id}" aria-labelledby="hc-${t.id}-h" data-words="${words(t.title, ...t.qs.flat())}"><h2 id="hc-${t.id}-h">${esc(t.title)}</h2>
          ${t.qs.map(([q, a]) => `<details data-words="${words(t.title, q, a)}"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>`).join('')}
          <div class="emp card" id="hcNone" hidden><b>No answer matches that</b><p>Try a shorter word, or send us the question with the form.</p><button type="button" class="bt ghost" data-hc="clear">Clear the search</button></div></div>
        <div class="hc-side"><div id="hcContact">${H.sent ? sentCard() : contactForm()}</div><div id="hcTix">${ticketsCard()}</div>${privacyCard()}</div>
      </div>`;
  }
  function redraw(part) {
    if (part === 'tix') { const b = document.getElementById('hcTix'); if (b) b.innerHTML = ticketsCard(); return }
    if (part === 'contact') { const b = document.getElementById('hcContact'); if (b) b.innerHTML = H.sent ? sentCard() : contactForm(); return }
    window.flPages?.redraw('help');
  }
  async function loadTickets() {
    if (!me()) return;
    try { H.tickets = (await call('/api/support/tickets')).tickets || []; H.err = '' } catch (e) { H.tickets = null; H.err = 'Your tickets didn’t load. ' + e.message }
    redraw('tix');
  }
  function filter(q) {
    const el = document.getElementById('hcTopics'); if (!el) return;
    const ws = q.trim().toLowerCase().split(/\s+/).filter(Boolean); let n = 0;
    el.querySelectorAll('.hc-topic').forEach(sec => { let any = 0; sec.querySelectorAll('details').forEach(d => { const hit = !ws.length || ws.every(w => d.dataset.words.includes(w)); d.hidden = !hit; if (ws.length) d.open = hit; if (hit) { any++; n++ } }); sec.hidden = !any; if (!ws.length) sec.querySelectorAll('details').forEach(d => { d.open = false }) });
    document.getElementById('hcNone').hidden = n > 0;
    document.getElementById('hcCount').textContent = ws.length ? (n ? `${n} answer${n === 1 ? '' : 's'} match` : '') : '';
  }

  window.flPages?.add('help', { title: 'Help center', render, onShow(el, arg) { loadTickets(); if (KINDS.some(k => k[0] === arg)) { H.kind = arg; H.sent = null; redraw('contact'); setTimeout(() => document.getElementById('hcText')?.focus(), 60) } } });

  let qT = 0;
  document.addEventListener('input', ev => {
    if (ev.target.id === 'hcQ') { filter(ev.target.value); clearTimeout(qT); qT = setTimeout(() => window.flTrack?.('help_search'), 1500) }
  });
  document.addEventListener('change', ev => {
    if (ev.target.id === 'hcKind') {
      H.kind = ev.target.value;
      const t = document.getElementById('hcText')?.value || '', s = document.getElementById('hcSub')?.value || '';
      redraw('contact'); document.getElementById('hcText').value = t; document.getElementById('hcSub').value = s; document.getElementById('hcKind').focus();
    }
    if (ev.target.dataset?.hc === 'track') window.flTrack?.setEnabled(ev.target.checked);
  });
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-hc-t]');
    if (t) { const id = t.dataset.hcT; H.open.has(id) ? H.open.delete(id) : H.open.add(id); t.setAttribute('aria-expanded', H.open.has(id)); document.getElementById('hct-' + id).hidden = !H.open.has(id); return }
    const a = ev.target.closest?.('[data-hc]')?.dataset.hc;
    if (a === 'another') { H.sent = null; redraw('contact'); return document.getElementById('hcKind')?.focus() }
    if (a === 'reload') { H.err = ''; redraw('tix'); return loadTickets() }
    if (a === 'clear') { const q = document.getElementById('hcQ'); q.value = ''; filter(''); return q.focus() }
  });
  document.addEventListener('submit', async ev => {
    const f = ev.target;
    if (f.id === 'hcForm') {
      ev.preventDefault();
      const msg = document.getElementById('hcMsg'), body = { kind: f.kind.value, subject: f.subject.value.trim(), text: f.text.value.trim(), email: f.email.value.trim(), website: f.website.value, context: context(), vid: window.flTrack?.vid?.() || '' };
      if (body.text.length < 10) { msg.textContent = 'Describe what happened in a sentence or two (at least 10 characters).'; return f.text.focus() }
      if (!me() && !body.email) { msg.textContent = 'Add an email address so we can answer you.'; return f.email.focus() }
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      try { const d = await call('/api/support/tickets', body); H.sent = { ...d.ticket, email: body.email }; redraw('contact'); document.getElementById('hcDoneH')?.focus(); loadTickets() }
      catch (e) { btn.disabled = false; btn.textContent = 'Send to support'; msg.textContent = `${e.message} Your message is still here.`; (e.field && f[e.field])?.focus() }
    }
    if (f.dataset.hcReply) {
      ev.preventDefault();
      const text = f.text.value.trim(); if (text.length < 2) return f.text.focus();
      const btn = f.querySelector('button'); btn.disabled = true;
      try { const d = await call('/api/support/reply', { id: f.dataset.hcReply, text }); H.tickets = H.tickets.map(t => t.id === d.ticket.id ? d.ticket : t); H.open.add(d.ticket.id); redraw('tix'); document.querySelector(`[data-hc-t="${CSS.escape(d.ticket.id)}"]`)?.focus() }
      catch (e) { btn.disabled = false; window.toast?.(e.message) }
    }
  });
  document.addEventListener('fl:me', () => { H.tickets = null; if (window.flPages?.current?.() === 'help') { redraw(); loadTickets() } });

  /* "Report incorrect data" on a line or pick uses the shared dialog (window.flReport, datastatus.js), which sends a
     private report to the administrators. Without it, the Help center form opens on "Incorrect data". */
  const report = c => window.flReport ? window.flReport.open(c || {}) : window.flPages?.show('help', 'data');
  window.flSupport = { report, context, open: kind => window.flPages?.show('help', kind) };
})();
