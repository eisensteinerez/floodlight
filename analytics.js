/* Floodlight · usage statistics, kept on Floodlight's own server (analytics.py). No outside service, no cookies.
   window.flTrack(name, props) queues one named event; the queue goes to POST /api/t every few seconds and when the tab
   is hidden. A signed-out visitor is a random id made here (fl.vid), which the server only keeps as a salted hash.
   Nothing is sent when the browser asks sites not to track (Global Privacy Control or Do Not Track), or after the person
   switches usage statistics off (flTrack.setEnabled(false), saved as fl.analytics = "off").
   Also here: window.flRef, the member's invite code. A visit to ?ref=CODE remembers the code for 30 days; once that
   visitor has an account (created in the last two days) the code is sent to /api/referrals/claim, once. */
(() => {
  const ls = { get(k) { try { return localStorage.getItem(k) } catch { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch {} }, del(k) { try { localStorage.removeItem(k) } catch {} } };
  const asked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  const enabled = () => !asked() && ls.get('fl.analytics') !== 'off' && !/[?&](flpreview|embed)=/.test(location.search);
  function vid() {
    let v = ls.get('fl.vid');
    if (!v || !/^[a-f0-9]{24}$/.test(v)) { const b = new Uint8Array(12); (crypto.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256 })); v = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); ls.set('fl.vid', v) }
    return v;
  }
  const device = () => { const w = Math.min(screen.width || innerWidth, innerWidth || 9999); return /Mobi|iPhone|Android.+Mobile/.test(navigator.userAgent) || w < 600 ? 'phone' : w < 1024 ? 'tablet' : 'desktop' };
  const Q = []; let timer = 0;
  function flush(beacon) {
    clearTimeout(timer); timer = 0;
    if (!Q.length || !enabled()) { Q.length = 0; return }
    const body = JSON.stringify({ vid: vid(), events: Q.splice(0, 30) });
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body, keepalive: true }).catch(() => {});
    } catch {}
    if (Q.length) timer = setTimeout(flush, 1500);
  }
  const once = new Set();
  function track(name, props) {
    if (!enabled() || typeof name !== 'string') return;
    const p = props && typeof props === 'object' ? props : {};
    if (p.once) { if (once.has(name)) return; once.add(name); delete p.once }
    Q.push({ e: name, p });
    if (!timer) timer = setTimeout(flush, 4000);
  }
  track.enabled = enabled;
  track.blocked = asked;
  track.setEnabled = on => { if (on) ls.del('fl.analytics'); else { ls.set('fl.analytics', 'off'); Q.length = 0 } };
  track.vid = () => enabled() ? vid() : '';
  track.device = device;
  window.flTrack = track;
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true) });
  addEventListener('pagehide', () => flush(true));

  /* pages people open (names only, never what is on them) */
  document.addEventListener('fl:page', ev => { const n = ev.detail?.name; if (n) track('page', { name: n }); if (n === 'pricing' || n === 'upgrade') track('upgrade_view') });

  /* a page that took longer than 2.5 seconds to show its main content (Largest Contentful Paint) */
  try {
    let worst = 0;
    new PerformanceObserver(list => { for (const e of list.getEntries()) worst = Math.max(worst, e.startTime) }).observe({ type: 'largest-contentful-paint', buffered: true });
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && worst > 2500) { track('slow_page', { name: (document.documentElement.dataset.page || (document.getElementById('flGate') ? 'landing' : 'home')), ms: Math.round(worst), device: device() }); worst = 0; flush(true) } }, { capture: true });
  } catch {}

  /* ---------- the invite code ---------- */
  const m = /[?&]ref=([A-Za-z0-9]{5,12})\b/.exec(location.search);
  if (m) { ls.set('fl.ref', JSON.stringify({ code: m[1].toUpperCase(), at: Date.now() })); try { const u = new URL(location.href); u.searchParams.delete('ref'); history.replaceState(history.state, '', u.pathname + u.search + u.hash) } catch {} }
  const pending = () => { try { const r = JSON.parse(ls.get('fl.ref') || 'null'); return r && Date.now() - r.at < 30 * 864e5 ? r.code : '' } catch { return '' } };
  let mine = '';
  window.flRef = {
    pending,
    code: () => mine,
    set(code) { mine = code || '' },
    // any share link: adds ?ref=CODE when the member has one
    link(url) { try { const u = new URL(url, location.origin); if (mine) u.searchParams.set('ref', mine); return u.toString() } catch { return url } },
  };
  document.addEventListener('fl:me', async () => {
    const me = window.S?.me; if (!me) return;
    track('session', { once: true });   // one per visit; it also joins what this browser did before signing up to the account
    const code = pending();
    if (!code || Date.now() / 1000 - (me.created || 0) > 2 * 86400) { if (code && Date.now() / 1000 - (me.created || 0) > 2 * 86400) ls.del('fl.ref'); return }
    try {
      const r = await fetch('/api/referrals/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ code, vid: track.vid() }) });
      if (r.ok || r.status === 400) ls.del('fl.ref');
    } catch {}
  });
})();
