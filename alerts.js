/* Floodlight · alerts for the teams you follow and the games on your watchlist.
   Off until you turn it on in Settings. Turning it on is the only thing that asks the browser for permission to show
   notifications. Three kinds, each with its own switch: a game starting, the score changing (in basketball only lead
   changes and ties, or every basket would ring), and the final score.
   Where notifications are blocked or not supported, the same alert shows as a quiet note inside the page instead.
   Alerts come from the same scoreboard Home and Live read (home.js), so they arrive while Floodlight is open in a tab,
   even a background one. There is no push service: with every Floodlight tab closed, nothing arrives. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'fl.notify';
  const DEF = { on: false, start: true, score: true, final: true, quiet: false, qFrom: 23, qTo: 8 };
  const read = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEF } } };
  // quiet hours: no browser notifications between these hours (an open page still shows its quiet note)
  const quietNow = () => { if (!A.quiet) return false; const h = new Date().getHours(); return A.qFrom > A.qTo ? h >= A.qFrom || h < A.qTo : h >= A.qFrom && h < A.qTo };
  const hr = h => new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  let A = read();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(A)) } catch {} };
  const can = () => 'Notification' in window;
  const perm = () => can() ? Notification.permission : 'unsupported';   // 'granted' | 'denied' | 'default' | 'unsupported'
  const mine = g => !!(window.flHome?.isMine?.(g) || window.flHome?.watching?.(g.key));

  /* ---------- deciding what to say ---------- */
  const seen = new Map();   // game key -> what we last saw: state, the two scores, who led
  const lead = g => { const a = +g.a.score, b = +g.b.score; return a > b ? 'a' : b > a ? 'b' : '=' };
  function check() {
    if (!A.on) return;
    for (const g of window.flHub?.games?.() || []) {
      if (!mine(g)) continue;
      const now = { st: g.state, a: String(g.a.score ?? ''), b: String(g.b.score ?? ''), l: lead(g) }, was = seen.get(g.key); seen.set(g.key, now);
      if (!was) continue;   // first sight of a game only sets the baseline, so opening the page never rings
      const line = `${g.a.name} ${g.a.score}–${g.b.score} ${g.b.name}`, lg = g.lgName || g.short || '';
      if (was.st === 'pre' && now.st === 'in' && A.start) send('start', g, `${g.a.name} v ${g.b.name} has started`, [lg, g.tv].filter(Boolean).join(' · '));
      else if (now.st === 'post' && was.st !== 'post' && A.final) send('final', g, `Final: ${line}`, lg);
      else if (now.st === 'in' && was.st === 'in' && A.score && (now.a !== was.a || now.b !== was.b)) {
        if (g.sport === 'basketball' && now.l === was.l) continue;   // a basket that does not change who leads stays quiet
        send('score', g, line, [lg, g.clock].filter(Boolean).join(' · '));
      }
    }
  }
  function send(kind, g, title, body) {
    if (perm() === 'granted' && !quietNow()) {
      try {
        const n = new Notification(title, { body, tag: g ? g.key : 'fl-test', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', silent: kind === 'score' });
        n.onclick = () => { window.focus(); if (g) window.flMC?.open?.(g) || window.flHub?.open?.(g); n.close() };
        return;
      } catch (e) { /* some browsers only allow notifications from a service worker: fall through to the page */ }
    }
    toast(title, body, g, kind === 'score' || kind === 'start');
  }
  function toast(title, body, g, hot) {
    const host = document.getElementById('toasts'); if (!host) return;
    const t = document.createElement('button'); t.type = 'button'; t.className = 'toast fl-toast al-toast' + (hot ? ' hot' : '');
    t.innerHTML = `${hot ? '<i aria-hidden="true"></i>' : ''}<span><b>${esc(title)}</b>${body ? `<small>${esc(body)}</small>` : ''}</span>`;
    if (g) t.addEventListener('click', () => { window.flMC?.open?.(g) || window.flHub?.open?.(g); t.remove() }); else t.addEventListener('click', () => t.remove());
    host.appendChild(t); setTimeout(() => t.classList.add('out'), 7500); setTimeout(() => t.remove(), 8000);
  }
  document.addEventListener('fl:hub', check);

  /* While alerts are on and one of your games is today and not over, keep the scoreboard fresh even when this tab is in
     the background (Home and Live only refresh while you look at them). Browsers slow background timers to about a
     minute, which is the pace we want anyway. */
  setInterval(() => {
    if (!A.on || !document.hidden) return;
    const H = window.flHub; if (!H?.games) return;
    if (H.games().some(g => g.state !== 'post' && mine(g) && g.date - Date.now() < 3 * 3600e3)) H.load?.(true);
  }, 60000);

  /* ---------- Settings › Alerts ---------- */
  function card() {
    const p = perm(), F = (() => { try { return (window.S?.fav || []).length } catch { return 0 } })(), W = window.flHome?.mine?.().watch?.length || 0;
    const who = F || W ? `You follow ${F} ${F === 1 ? 'team' : 'teams'} and have ${W} ${W === 1 ? 'game' : 'games'} on your watchlist.` : 'You don’t follow any teams or watch any games yet, so there is nothing to alert you about.';
    const state = !A.on ? '' : p === 'granted' ? 'Notifications are allowed. Alerts arrive while Floodlight is open in a tab, even in the background.'
      : p === 'denied' ? 'This browser blocks notifications for Floodlight, so alerts show as a small note inside the page. To get them outside the page, allow notifications for this site in your browser’s site settings.'
      : p === 'unsupported' ? 'This browser can’t show notifications, so alerts show as a small note inside the page.'
      : 'Alerts show as a small note inside the page for now. Above is a sample. To get them outside the page too, allow browser notifications; your browser will ask once.';
    const row = (k, label, sub) => `<div class="st-row"><div class="st-l"><label for="al-${k}">${label}</label><small>${sub}</small></div><div class="st-c"><input class="sw" type="checkbox" role="switch" id="al-${k}" data-al="${k}" ${A[k] ? 'checked' : ''} ${A.on ? '' : 'disabled'}></div></div>`;
    return `<section class="card feature st-card" id="stAlerts" aria-labelledby="stAlH">
      <p class="st-crumb">Settings › Alerts</p>
      <div class="st-h"><h2 id="stAlH">Alerts</h2></div>
      <p class="lb al-who">${esc(who)} <button type="button" class="lk" data-page-home>${F || W ? 'Change the teams you follow' : 'Choose teams to follow'}</button></p>
      <div class="st-rows">
        <div class="st-row"><div class="st-l"><label for="al-on">Game alerts</label><small>Turning this on shows a sample first. The browser is asked for permission only when you choose. Kept on this device.</small></div>
          <div class="st-c"><input class="sw" type="checkbox" role="switch" id="al-on" data-al="on" ${A.on ? 'checked' : ''}></div></div>
        ${row('start', 'Game starting', 'When one of your games kicks off or tips off.')}
        ${row('score', 'Score changes', 'Every goal, run or score. In basketball, only lead changes and ties.')}
        ${row('final', 'Final score', 'When one of your games ends.')}
        <div class="st-row"><div class="st-l"><label for="al-quiet">Quiet hours</label><small>No browser notifications ${hr(A.qFrom)} to ${hr(A.qTo)}. An open Floodlight page still shows a quiet note.</small></div>
          <div class="st-c al-q"><input class="sw" type="checkbox" role="switch" id="al-quiet" data-al="quiet" ${A.quiet ? 'checked' : ''} ${A.on ? '' : 'disabled'}>
            ${A.quiet ? `<label class="sr-only" for="al-qf">From</label><select class="inp sm" id="al-qf" data-alq="qFrom">${[...Array(24).keys()].map(h => `<option value="${h}"${h === A.qFrom ? ' selected' : ''}>${hr(h)}</option>`).join('')}</select><span aria-hidden="true">to</span><label class="sr-only" for="al-qt">To</label><select class="inp sm" id="al-qt" data-alq="qTo">${[...Array(24).keys()].map(h => `<option value="${h}"${h === A.qTo ? ' selected' : ''}>${hr(h)}</option>`).join('')}</select>` : ''}</div></div>
      </div>
      ${A.on ? `<p class="al-state lb" role="status">${esc(state)}</p><div class="st-foot">${p === 'default' ? '<button type="button" class="bt sm" data-al-ask>Allow browser notifications</button>' : ''}<button type="button" class="bt ghost sm" data-al-test>Show a sample alert</button><button type="button" class="bt ghost sm" data-al-reset>Reset alerts</button></div>` : ''}
    </section>`;
  }
  const repaint = focusId => { const el = document.getElementById('stAlerts'); if (!el) return; el.outerHTML = card(); if (focusId) document.getElementById(focusId)?.focus() };
  document.addEventListener('change', async ev => {
    const k = ev.target.dataset?.al; if (!k) return;
    A[k] = ev.target.checked; save();
    if (k === 'on' && A.on) {
      for (const g of window.flHub?.games?.() || []) if (mine(g)) seen.set(g.key, { st: g.state, a: String(g.a.score ?? ''), b: String(g.b.score ?? ''), l: lead(g) });
      toast('This is how an alert looks', 'Your teams’ starts, scores and finals arrive like this while Floodlight is open.', null, false);
    }
    repaint(ev.target.id);
  });
  document.addEventListener('click', ev => {
    if (ev.target.closest?.('[data-al-test]')) send('final', null, 'Sample alert from Floodlight', 'Alerts for your teams will look like this.');
    if (ev.target.closest?.('[data-al-ask]')) { (async () => { try { await Notification.requestPermission() } catch {} repaint('al-on') })() }
    if (ev.target.closest?.('[data-al-reset]')) { reset(); repaint('al-on') }
    if (ev.target.closest?.('[data-page-home]')) window.flHome?.edit ? window.flHome.edit() : window.flHub?.show?.();
  });

  function reset() { A = { ...DEF }; save() }
  document.addEventListener('change', ev => { const q = ev.target.dataset?.alq; if (!q) return; A[q] = +ev.target.value; save(); repaint(ev.target.id) });
  window.flAlerts = { on: () => A.on, card, reset };
})();
