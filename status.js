/* Floodlight · honest states across the site.
   - Offline: a bar says so while the connection is down and refreshes the scores when it comes back.
   - Sign-in expired: a members' request answered 401 after you were signed in opens a bar with "Sign in again".
   - Slow loading: a placeholder (skeleton) still showing after ten seconds gets "This is taking longer than expected"
     and a Try again button, so a card is never left blank. Try again refreshes that part when the page knows how
     (the Live Hub, the match centre) and reloads the page otherwise. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bar = document.createElement('div'); bar.className = 'fl-netbar'; bar.setAttribute('role', 'status'); bar.hidden = true; document.body.appendChild(bar);
  let kind = '', hideT = 0;
  function show(k, html, ms) { kind = k; clearTimeout(hideT); bar.dataset.kind = k; bar.innerHTML = html; bar.hidden = false; if (ms) hideT = setTimeout(() => { if (kind === k) { bar.hidden = true; kind = '' } }, ms) }
  function off() { if (!navigator.onLine) show('offline', `<b>You are offline.</b> <span>Scores, prices and searches will refresh when the connection is back.</span>`) }
  addEventListener('offline', off);
  addEventListener('online', () => { if (kind !== 'offline') return; show('online', `<b>Back online.</b> <span>Refreshing the scores…</span>`, 4000); try { window.flHub?.load?.(true) } catch (e) {} });
  off();

  // a members' request that says the session is gone, after this browser was signed in
  const f0 = window.fetch;
  window.fetch = function (input, init) {
    return f0.apply(this, arguments).then(r => {
      try { const u = typeof input === 'string' ? input : input?.url || '';
        if (r.status === 401 && /^\/api\/|\/\/[^/]*\/api\//.test(u) && !/\/api\/(me|login|logout|signup)/.test(u) && window.S?.me && kind !== 'auth')
          show('auth', `<b>Your sign-in has expired.</b> <span>Sign in again to keep members’ pages up to date.</span><button type="button" class="bt sm" data-netact="signin">Sign in again</button>`) } catch (e) {}
      return r;
    });
  };
  bar.addEventListener('click', ev => { const a = ev.target.closest('[data-netact]')?.dataset.netact; if (a === 'signin') { bar.hidden = true; kind = ''; try { S.prof.mode = 'login'; openProfile() } catch (e) { location.reload() } } });

  /* slow placeholders: checked every two seconds; a container's note is added once and goes when the skeleton goes */
  const seen = new WeakMap();
  function retry(host) {
    if (host.closest('#flMC')) { const b = document.querySelector('#flMC [data-gx="retry"]'); if (b) return b.click(); const g = window.flMC?.state?.g; return g && window.flMC.open(g, document.body) }
    if (host.closest('#pg-live,#hub')) return window.flHub?.load?.(true);
    location.reload();
  }
  setInterval(() => {
    const now = Date.now();
    for (const s of document.querySelectorAll('.skl, .skel, [aria-busy="true"]')) {
      if (!s.getClientRects().length) continue;
      const host = s.closest('.card, section, .gx-body, .flpage, #view') || s.parentElement; if (!host) continue;
      if (!seen.has(host)) { seen.set(host, now); continue }
      if (now - seen.get(host) < 10000 || host.querySelector(':scope > .fl-slow')) continue;
      const n = document.createElement('div'); n.className = 'fl-slow'; n.setAttribute('role', 'status');
      n.innerHTML = `<p><b>This is taking longer than expected.</b> ${navigator.onLine ? 'The source may be busy.' : 'You are offline.'}</p><button type="button" class="bt sm ghost">Try again</button>`;
      n.querySelector('button').addEventListener('click', () => { n.remove(); seen.set(host, Date.now()); retry(host) });
      host.prepend(n);
    }
    // a note whose skeleton has gone goes too
    for (const n of document.querySelectorAll('.fl-slow')) { const h = n.parentElement; if (!h || !h.querySelector('.skl, .skel, [aria-busy="true"]')) { n.remove(); if (h) seen.delete(h) } }
  }, 2000);
})();
