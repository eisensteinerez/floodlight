/* Floodlight · the landing page signed-out visitors see on the hosted site (drawn by access.js inside #flGate).
   It answers four things in order: what Floodlight is, why it is useful, why to trust it, and what it costs.
   Sections: hero with a working example (drag the line), the Lab, Predictions, the live match centre, alerts,
   verified performance (real counts from /api/grading/status), plans (from /api/plans when paid plans are on,
   otherwise the planned prices marked as not on sale yet), questions, and a last sign-up button.
   Nothing here claims picks will win. Performance is published by the rule in Erez's plan: under 25 graded picks it
   says "Early results"; 25 to 99 shows the record with a small-sample warning; from 100 the full numbers.
   The sign-in card itself still comes from access.js (card()); this file only gives it a dialog to sit in.
   window.flLanding = { page(), mount(root), open(), close(), help() } */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (n, p) => window.flTrack?.(n, p);
  const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true" width="28" height="28"><rect x="14.5" y="12" width="3" height="18" rx="1" fill="currentColor"/><rect x="5" y="3" width="22" height="10" rx="2" fill="currentColor"/><g fill="var(--accent)"><circle cx="9.5" cy="8" r="2.2"/><circle cx="16" cy="8" r="2.2"/><circle cx="22.5" cy="8" r="2.2"/></g></svg>`;
  const X = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

  /* ---------- the working example: a sample player's last 20 games against a line you can move ----------
     Sample numbers, labelled as such. Newest game on the right. */
  const GAMES = [19, 31, 24, 22, 28, 17, 26, 30, 21, 25, 33, 23, 27, 20, 29, 24, 32, 26, 22, 28];
  const TOP = 36;
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const med = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2 };
  const fmt1 = x => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
  function hits(line, n) { const g = GAMES.slice(-n); return g.filter(x => x > line).length }
  function example() {
    return `<figure class="lp-ex" aria-labelledby="lpExCap">
      <div class="lp-ex-top"><div><b>Sample guard</b><span>Points, last 20 games</span></div><span class="lp-tag">Sample data</span></div>
      <div class="lp-bars" id="lpBars" style="--at:${(24.5 / TOP * 100).toFixed(2)}%" aria-hidden="true">
        ${GAMES.map((v, i) => `<i style="--h:${(v / TOP * 100).toFixed(2)}%;--d:${i * 18}ms" data-v="${v}"></i>`).join('')}
        <span class="lp-line"><em id="lpLineTag">24.5</em></span>
      </div>
      <label class="lp-slide" for="lpLine"><span>Move the line</span>
        <input type="range" id="lpLine" min="16.5" max="33.5" step="1" value="24.5" aria-valuetext="Line 24.5 points"></label>
      <dl class="lp-rates" id="lpRates"></dl>
      <figcaption id="lpExCap" class="lp-cap">Filled bars cleared the line, outlined bars fell short. This is how the Lab shows every player, team and stat.</figcaption>
      <p class="sr-only" role="status" aria-live="polite" id="lpSay"></p>
    </figure>`;
  }
  function paintExample(line) {
    const bars = document.getElementById('lpBars'), rates = document.getElementById('lpRates'); if (!bars || !rates) return;
    bars.style.setProperty('--at', (line / TOP * 100).toFixed(2) + '%');
    document.getElementById('lpLineTag').textContent = line;
    bars.querySelectorAll('i').forEach(b => b.classList.toggle('ov', +b.dataset.v > line));
    const rows = [['Last 5', hits(line, 5), 5], ['Last 10', hits(line, 10), 10], ['Last 20', hits(line, 20), 20]];
    rates.innerHTML = rows.map(([k, h, n]) => `<div><dt>${k}</dt><dd><b>${h} of ${n}</b><small>${Math.round(h / n * 100)}%</small></dd></div>`).join('')
      + `<div><dt>Average</dt><dd><b>${fmt1(avg(GAMES))}</b><small>median ${fmt1(med(GAMES))}</small></dd></div>`;
    return rows;
  }

  /* ---------- the feature sections: words on one side, a small honest picture of the real screen on the other ---------- */
  const shots = {
    lab: `<div class="lp-shot lp-split" aria-hidden="true">
        <div class="lp-shot-h"><b>Sample guard</b><span>Over 24.5 points</span></div>
        <table><thead><tr><th>Split</th><th>Record</th><th>Avg</th></tr></thead><tbody>
          <tr><td>Last 5</td><td>3 of 5</td><td>25.8</td></tr><tr><td>Last 10</td><td>6 of 10</td><td>25.2</td></tr>
          <tr><td>This season</td><td>11 of 20</td><td>25.3</td></tr><tr><td>Home</td><td>6 of 10</td><td>26.1</td></tr>
          <tr><td>Away</td><td>5 of 10</td><td>24.5</td></tr><tr><td>Against tonight’s opponent</td><td>2 of 3</td><td>27.0</td></tr></tbody></table></div>`,
    predictions: `<div class="lp-shot lp-receipt" aria-hidden="true">
        <div class="lp-shot-h"><b>Prediction receipt</b><span class="lp-tag">Example</span></div>
        <dl><div><dt>Pick</dt><dd>Sample guard over 24.5 points</dd></div><div><dt>Game</dt><dd>Harbor at Summit, 7:30 PM</dd></div>
          <div><dt>Line and price when published</dt><dd>24.5 at −110</dd></div><div><dt>Published</dt><dd>4:12 PM, locked 5 minutes before the start</dd></div>
          <div><dt>Result</dt><dd><span class="lp-res">Hit</span> 27 points, graded from the official box score</dd></div>
          <div><dt>Closing line</dt><dd>25.5</dd></div></dl></div>`,
    live: `<div class="lp-shot lp-live" aria-hidden="true">
        <div class="lp-shot-h"><b>Tonight</b><span>3 live</span></div>
        ${[['Q3 4:12', 'Harbor', 78, 'Summit', 74], ['62′', 'Northside', 1, 'Riverton', 1], ['2nd 08:40', 'Ironbridge', 2, 'Lakeport', 0]].map(([c, a, sa, b, sb]) =>
          `<div class="lp-game"><span class="lp-clock"><i></i>${c}</span><span class="lp-tm">${a}</span><b>${sa}</b><b>${sb}</b><span class="lp-tm r">${b}</span></div>`).join('')}
        <p class="lp-shot-f">Box score, lineups, play by play and stats for each game</p></div>`,
    alerts: `<div class="lp-shot lp-alerts" aria-hidden="true">
        <div class="lp-shot-h"><b>Alerts</b><span>Your follows</span></div>
        <ul><li><b>Line moved</b><span>Sample guard points: 24.5 to 25.5</span></li><li><b>Injury update</b><span>Sample forward: questionable to out</span></li>
          <li><b>Starting soon</b><span>Harbor at Summit in 30 minutes</span></li><li><b>Prediction graded</b><span>Sample guard over 24.5: hit</span></li></ul></div>`,
  };
  const FEATURES = [
    ['lab', 'The Lab', 'Look up any player, team or prop and see every recent game against the line. Last 5, 10 and 20 games, this season, home and away, and against tonight’s opponent, side by side. Compare lines from the books and pick’em apps on one screen.'],
    ['predictions', 'Predictions with a receipt', 'Each prediction is saved with its line, price and time before the game starts, and it can’t be edited afterwards. After the final, it is graded from the official result. The record keeps the misses next to the hits, and corrections are logged in public.'],
    ['live', 'Live match centre', 'Scores across soccer, NFL, NBA, WNBA, MLB, NHL, college sports, tennis, UFC and boxing. Open any game for the box score, lineups, injuries and play by play.'],
    ['alerts', 'Alerts', 'Follow a team, a player or a pick. Floodlight tells you when a line moves, an injury report changes, a game is about to start or a prediction is graded.'],
  ];

  /* ---------- plans: the server's list when paid plans are on, the planned prices otherwise ---------- */
  const PLANNED = [
    { id: 'free', name: 'Free', price_cents: 0, interval: null, features: ['Live scores and match centre', 'Player profiles', 'Five Lab searches a day', 'One saved board'] },
    { id: 'plus', name: 'Plus', price_cents: 499, interval: 'month', trial_days: 7, features: ['Unlimited Lab searches and boards', 'Last 5, 10, 20 and season splits', 'Line movement and book comparison', 'Predictions with full Pick history', 'Advanced alerts'] },
    { id: 'plus_annual', name: 'Plus, yearly', price_cents: 2999, interval: 'year', trial_days: 7, features: ['Everything in Plus', 'About $2.50 a month, billed once a year'] },
    { id: 'group', name: 'Group', price_cents: 999, interval: 'month', features: ['Plus for five accounts', 'Private prediction competitions'] },
  ];
  const money = c => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  function planCard(p, live) {
    const per = p.interval === 'year' ? 'a year' : p.interval === 'month' ? 'a month' : '';
    return `<article class="lp-plan${p.id === 'plus' ? ' lead' : ''}"><h3>${esc(p.name)}</h3>
      <p class="lp-price"><b>${p.price_cents ? money(p.price_cents) : '$0'}</b>${per ? `<span>${per}</span>` : '<span>forever</span>'}</p>
      ${p.trial_days && live ? `<p class="lb">${p.trial_days}-day free trial, then ${money(p.price_cents)} ${per}. Cancel any time from your account.</p>` : ''}
      <ul>${(p.features || []).slice(0, 6).map(f => `<li>${esc(f)}</li>`).join('')}</ul></article>`;
  }
  function drawPlans(list, live) {
    const box = document.getElementById('lpPlans'); if (!box) return;
    box.innerHTML = `<div class="lp-plans">${list.map(p => planCard(p, live)).join('')}</div>
      <p class="lp-note">${live ? 'Prices include no hidden fees. Your renewal price is shown before you pay, and you can cancel from your account without contacting support.'
        : 'Paid plans aren’t on sale yet. Every account gets all of Floodlight free while the prediction record builds. When plans start, you’ll see the exact price before paying anything.'}</p>
      ${live ? '<a class="bt ghost" href="/pricing">Compare plans in detail</a>' : ''}`;
  }
  async function loadPlans() {
    try {
      const r = await fetch('/api/plans', { credentials: 'same-origin' }); if (!r.ok) throw 0;
      const d = await r.json(), list = Array.isArray(d) ? d : d.plans;
      if (!Array.isArray(list) || !list.length || d.on_sale === false) throw 0;   // on_sale: billing.py says paid plans can be bought
      drawPlans(list, true);
    } catch { drawPlans(PLANNED, false) }
  }

  /* ---------- verified performance: counts from the grader, published by sample size ---------- */
  async function loadRecord() {
    const box = document.getElementById('lpRecord'); if (!box) return;
    let s;
    try { const r = await fetch('/api/grading/status', { credentials: 'same-origin' }); if (!r.ok) throw 0; s = await r.json() } catch { s = null }
    if (!s) { box.innerHTML = `<p class="lp-rec-empty">The pick record couldn’t be loaded just now. It is public to members in Pick history.</p>`; return }
    const sum = k => (s.matches?.[k] || 0) + (s.props?.[k] || 0);
    const won = sum('won'), lost = sum('lost'), push = sum('push'), voided = sum('void'), corrected = sum('corrected');
    const graded = won + lost + corrected, waiting = sum('published') + sum('locked') + sum('started') + sum('pending');
    const last = s.lastGraded ? new Date(s.lastGraded * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : '';
    let head, body;
    if (graded < 25) {
      head = 'Early results';
      body = `<p>${graded ? `${graded} prediction${graded === 1 ? ' has' : 's have'} been graded so far.` : 'No prediction has been graded yet.'} That’s too few to say anything about accuracy, so we don’t publish a hit rate until at least 25 are graded.</p>`;
    } else {
      const rate = Math.round(won / (won + lost) * 100);
      head = graded < 100 ? 'Results so far, small sample' : 'Results';
      body = `<p>${graded < 100 ? `Only ${graded} graded predictions: a small sample, so expect this to move a lot. Full reporting starts at 100.` : 'Every graded prediction, including the misses. Past results don’t guarantee future ones.'}</p>
        <dl class="lp-recnums"><div><dt>Hits</dt><dd>${won}</dd></div><div><dt>Misses</dt><dd>${lost}</dd></div><div><dt>Hit rate</dt><dd>${rate}%</dd></div>${corrected ? `<div><dt>Corrected</dt><dd>${corrected}</dd></div>` : ''}</dl>`;
    }
    box.innerHTML = `<h3 class="lp-rec-h">${head}</h3>${body}
      <ul class="lp-recmeta"><li>${waiting} waiting for their games</li>${push + voided ? `<li>${push} pushes and ${voided} voided, not counted as hits or misses</li>` : ''}${last ? `<li>Last graded ${esc(last)}</li>` : ''}</ul>`;
  }

  const FAQ = [
    ['What is Floodlight?', 'A research site for sports fans who follow player lines. It puts live scores, player and team history, lines from several books, injuries and line movement in one place, and keeps a graded record of its own predictions.'],
    ['Does Floodlight take bets?', 'No. Floodlight never takes or places bets and never holds money. It shows research. What you do with it is up to you.'],
    ['Will it tell me which picks will win?', 'No one can. Floodlight shows the evidence behind a line: how often it has cleared, the splits, injuries and how the line moved. Predictions are estimates, and every one is graded in public, misses included.'],
    ['Where does the data come from?', 'League and team feeds for scores, schedules and box scores; sportsbooks and pick’em apps for lines and prices; official injury reports. Each source’s freshness is shown on the Trust and data page, and corrections are logged there.'],
    ['How are predictions graded?', 'A prediction is saved before its game starts and can’t be changed. After the final, it is graded from the official result as a hit, miss, push or void. If a grade was wrong, the correction is shown next to it.'],
    ['What does it cost?', 'There is always a free plan. A paid plan shows its exact price and renewal date before you pay, and you can cancel it from your account at any time, without contacting support.'],
    ['What if I can’t get into my account?', 'Use Help and contact at the bottom of this page. Tell us your username and an email to reach you, and we’ll answer within one business day.'],
    ['Who can use it?', 'Floodlight is for adults. Where it covers betting lines, you must be 21 or older and follow the law where you live.'],
  ];

  function page() {
    return `<div class="lp">
      <a class="skip lp-skip" href="#lpMain">Skip to content</a>
      <header class="lp-nav"><a class="lp-brand" href="#lpMain" translate="no">${LOGO}<span>Floodlight</span></a>
        <nav aria-label="Landing page"><a href="#lpHow">How it works</a><a href="#lpTrust">Track record</a><a href="#lpPrice">Pricing</a><button type="button" class="lp-link" data-lp="help">Help</button></nav>
        <div class="lp-nav-acts"><button type="button" class="bt ghost sm" data-g="login" data-lp-where="nav">Log in</button><button type="button" class="bt sm" data-g="signup" data-lp-where="nav">Try it free</button></div></header>
      <main id="lpMain" tabindex="-1">
        <section class="lp-hero" aria-labelledby="lpH1">
          <div class="lp-hero-t">
            <h1 id="lpH1">Research every game in one place.</h1>
            <p class="lp-lead">Compare player lines, explore recent performance, follow injuries and line movement, and track every prediction from publication to final result.</p>
            <div class="lp-cta"><button type="button" class="bt" data-g="signup" data-lp-where="hero">Try Floodlight free</button><a class="bt ghost" href="#lpHow" data-lp-where="how">See how it works</a></div>
            <p class="lp-fine">Free to start, no card needed. For adults 21 and over.</p>
            <p class="lp-sports">Soccer, NFL, NBA, WNBA, MLB, NHL, college sports, tennis, UFC and boxing</p>
          </div>
          ${example()}
        </section>
        <section class="lp-how" id="lpHow" aria-labelledby="lpHowH" tabindex="-1">
          <h2 id="lpHowH">Understand the evidence behind each line</h2>
          ${FEATURES.map(([k, h, p], i) => `<article class="lp-row${i % 2 ? ' flip' : ''}" aria-labelledby="lpF-${k}"><div class="lp-row-t"><h3 id="lpF-${k}">${h}</h3><p>${p}</p></div>${shots[k]}</article>`).join('')}
        </section>
        <section class="lp-trust" id="lpTrust" aria-labelledby="lpTrustH" tabindex="-1">
          <div class="lp-trust-t"><h2 id="lpTrustH">A track record you can check</h2>
            <p>Floodlight publishes its own record. Predictions are locked before the start, graded from official results, and never quietly removed. We only publish a hit rate once enough predictions are graded to mean something.</p>
            <ul class="lp-rules"><li>Under 25 graded: early results only</li><li>25 to 99 graded: shown with a small-sample warning</li><li>100 or more: full reporting by sport, market and confidence</li></ul></div>
          <div class="lp-rec" id="lpRecord" aria-live="polite"><p class="lb">Loading the record…</p></div>
        </section>
        <section class="lp-price" id="lpPrice" aria-labelledby="lpPriceH" tabindex="-1">
          <h2 id="lpPriceH">Plans and pricing</h2>
          <div id="lpPlans"><p class="lb">Loading plans…</p></div>
        </section>
        <section class="lp-faq" aria-labelledby="lpFaqH">
          <h2 id="lpFaqH">Questions</h2>
          <div class="lp-faq-l">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
        </section>
        <section class="lp-end" aria-labelledby="lpEndH">
          <h2 id="lpEndH">Start with the free plan</h2>
          <p>Create an account in under a minute. You can look around before deciding anything.</p>
          <button type="button" class="bt" data-g="signup" data-lp-where="end">Try Floodlight free</button>
        </section>
      </main>
      <footer class="lp-foot">
        <p>Floodlight shows research, not betting advice. Past results don’t guarantee future results. 21+. If gambling stops being fun, call or text 1-800-GAMBLER.</p>
        <nav aria-label="Policies and help"><a href="#/legal/terms">Terms</a><a href="#/legal/privacy">Privacy</a><a href="#/legal/cookies">Cookies</a><a href="#/legal/refunds">Refunds</a><a href="#/legal/disclaimer">Prediction disclaimer</a><a href="#/legal/data-sources">Data sources</a><button type="button" class="lp-link" data-lp="help">Help and contact</button></nav>
      </footer>
      <dialog class="lp-dlg" id="flgDlg" aria-labelledby="flgDlgH">
        <h2 class="sr-only" id="flgDlgH">Your Floodlight account</h2>
        <button type="button" class="ib lp-dlg-x" data-lp="close" aria-label="Close">${X}</button>
        <div id="flgSlot"></div>
      </dialog>
    </div>`;
  }

  /* ---------- help while signed out: get back into an account, billing, or a question ---------- */
  function helpForm(msg) {
    return `<div class="flg-card lp-help" id="lpHelp"><h2 class="flg-h">Contact support</h2>
      <p>Can’t get into your account, or have a question before joining? Leave your email and we’ll answer within one business day.</p>
      <form id="lpHelpForm" novalidate>
        <label for="lpHk">What do you need?</label>
        <select class="inp" id="lpHk" name="kind"><option value="account">I can’t get into my account</option><option value="billing">A billing question</option><option value="question">Something else</option></select>
        <label for="lpHe">Email</label><input class="inp" id="lpHe" name="email" type="email" autocomplete="email" spellcheck="false" required placeholder="you@example.com…">
        <label for="lpHt">What happened?</label><textarea class="inp" id="lpHt" name="text" rows="4" maxlength="4000" required placeholder="Your username, if you have one, and what you tried…"></textarea>
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="lp-hp" aria-hidden="true">
        <button class="btn" type="submit">Send to support</button>
      </form>
      <div class="flg-err" role="alert">${esc(msg || '')}</div>
      <button type="button" class="flg-forgot" data-g="login">Back to log in</button></div>`;
  }

  const L = { from: null, ready: false };
  function dlg() { return document.getElementById('flgDlg') }
  function open(from) {
    const d = dlg(); if (!d) return;
    L.from = from || document.activeElement;
    if (!d.open) { try { d.showModal() } catch { d.setAttribute('open', '') } }
    (d.querySelector('#flgSlot input:not([type=hidden]):not([tabindex="-1"]), #flgSlot button') || d.querySelector('.lp-dlg-x'))?.focus();
  }
  function close() { const d = dlg(); if (d?.open) d.close() }
  function help(msg) { const s = document.getElementById('flgSlot'); if (!s) return; s.innerHTML = helpForm(msg); open() }

  function mount(root) {
    if (L.ready) return; L.ready = true;
    paintExample(24.5);
    T('landing_view', { once: true });
    const range = root.querySelector('#lpLine'); let sayT = 0;
    range?.addEventListener('input', () => {
      const v = +range.value, rows = paintExample(v); range.setAttribute('aria-valuetext', `Line ${v} points`);
      clearTimeout(sayT); sayT = setTimeout(() => { document.getElementById('lpSay').textContent = `Line ${v}: over in ${rows[1][1]} of the last 10 and ${rows[2][1]} of the last 20.` }, 500);
      T('landing_cta', { where: 'example', once: true });
    });
    root.addEventListener('click', ev => {
      const w = ev.target.closest?.('[data-lp-where]'); if (w) T('landing_cta', { where: w.dataset.lpWhere });
      const a = ev.target.closest?.('[data-lp]')?.dataset.lp;
      if (a === 'close') return close();
      if (a === 'help') return help();
      const jump = ev.target.closest?.('a[href^="#lp"]');
      if (jump) { const t = document.querySelector(jump.getAttribute('href')); if (t) { ev.preventDefault(); t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); t.focus({ preventScroll: true }) } }
    });
    const d = dlg();
    d?.addEventListener('close', () => { if (L.from?.isConnected) L.from.focus() });
    d?.addEventListener('click', ev => { if (ev.target === d) close() });   // a click on the backdrop
    root.addEventListener('submit', async ev => {
      if (ev.target.id !== 'lpHelpForm') return; ev.preventDefault();
      const f = ev.target, btn = f.querySelector('button[type=submit]'), err = document.querySelector('#lpHelp .flg-err');
      const body = { kind: f.kind.value, email: f.email.value.trim(), text: f.text.value.trim(), website: f.website.value, vid: window.flTrack?.vid?.() || '',
        context: { page: 'landing', device: window.flTrack?.device?.() || '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', lang: navigator.language || '' } };
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(body.email)) { err.textContent = 'Add the email address we should answer.'; return f.email.focus() }
      if (body.text.length < 10) { err.textContent = 'Describe what happened in a sentence or two.'; return f.text.focus() }
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await fetch('/api/support/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'It didn’t send.');
        const t = out.ticket || {};
        document.getElementById('flgSlot').innerHTML = `<div class="flg-card" id="lpHelpDone"><h2 class="flg-h" tabindex="-1">Ticket ${esc(t.id || '')} received</h2>
          <p>We’ll answer at ${esc(body.email)} within ${t.replyDays || 1} business day${(t.replyDays || 1) === 1 ? '' : 's'}. Keep the ticket number in case you need to follow up.</p>
          <button type="button" class="btn" data-lp="close">Done</button></div>`;
        document.querySelector('#lpHelpDone .flg-h')?.focus();
      } catch (e) { btn.disabled = false; btn.textContent = 'Send to support'; err.textContent = `${e.message} Your message is still here, so try again in a minute.` }
    });
    loadRecord(); loadPlans();
  }

  window.flLanding = { page, mount, open, close, help };
})();
