/* Floodlight · the alerts inbox (#/inbox) and the one way the site sends an alert (flNotify).
   Every alert, whether it reaches the browser as a notification or only shows as a note in the page, is also kept
   here, so nothing is lost when a notification is missed or dismissed. Kept on this device for 30 days (200 at most).
   flNotify(kind, title, body, { link, tag, quiet, silent }):
     kind   start · score · final · lineup · injury · line · removed · edge · graded · summary · weekly · achievement · test
     link   where the alert leads, in recent.js's "open" shape ({ page, arg } · { game } · { lab } · { route })
     quiet  keep it in the inbox and the page only, never as a browser notification
   A notification opens the page it is about: through the service worker when there is one (sw.js), so a tap from
   the phone's notification shade opens Floodlight on that page (#/open/<link>), else straight from this tab.
   Alerts other parts of the site send on their own (browser notifications, page notes) are copied in too. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s = 18) => window.flShell?.ic?.(n, s) || '';
  const KEY = 'fl.inbox', MAX = 200, KEEP = 30 * 864e5;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const CAT = { start: 'games', score: 'games', final: 'games', lineup: 'games', injury: 'injuries', line: 'lines', removed: 'picks', edge: 'picks', graded: 'picks', summary: 'summaries', weekly: 'summaries', achievement: 'summaries', test: 'summaries', other: 'picks' };
  const ICON = { games: 'live', injuries: 'help', lines: 'trend', picks: 'pred', summaries: 'clock' };
  const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['games', 'Games'], ['picks', 'Picks'], ['lines', 'Lines'], ['injuries', 'Injuries'], ['summaries', 'Summaries']];
  let L = (store.get(KEY, []) || []).filter(x => x && x.id && x.title && Date.now() - x.at < KEEP);
  const save = () => { L = L.filter(x => Date.now() - x.at < KEEP).slice(0, MAX); store.set(KEY, L); badge(); if (window.flPages?.current?.() === 'inbox') draw() };
  const unread = () => L.filter(x => !x.read).length;

  /* ---------- adding ---------- */
  function add(kind, title, body = '', o = {}) {
    title = String(title || '').slice(0, 140); body = String(body || '').slice(0, 300); if (!title) return null;
    const dup = L.find(x => (o.tag && x.tag === o.tag && Date.now() - x.at < 10 * 60000) || (x.title === title && x.body === body && Date.now() - x.at < 2 * 60000));
    if (dup) return dup;
    const it = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: CAT[kind] ? kind : 'other', title, body, at: Date.now(), read: false, link: o.link || null, tag: o.tag || '' };
    L.unshift(it); save(); return it;
  }
  const linkURL = link => link ? `${location.origin}${location.pathname}#/open/${encodeURIComponent(JSON.stringify(link))}` : `${location.origin}${location.pathname}#/inbox`;
  const Orig = window.Notification;
  const quietNow = () => !!window.flAlerts?.quiet?.();
  async function notify(kind, title, body = '', o = {}) {
    if (o.preview) { toast({ title: String(title || ''), body: String(body || ''), link: { page: 'settings', arg: 'alerts' } }, false); return null }   // a sample: shown, never kept
    const it = add(kind, title, body, o);
    if (!it || it.at < Date.now() - 1000) return it;   // already told a moment ago
    const can = Orig && Orig.permission === 'granted' && !o.quiet && !quietNow();
    if (can) {
      const opts = { body, tag: o.tag || it.id, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', silent: !!o.silent, data: { url: linkURL(o.link), id: it.id } };
      try { const reg = await navigator.serviceWorker?.getRegistration?.(); if (reg?.showNotification) { await reg.showNotification(title, opts); return it } } catch (e) {}
      try { const n = new Orig(title, opts); n.onclick = () => { window.focus(); openItem(it); n.close() }; return it } catch (e) { /* some phones only allow notifications from a service worker */ }
    }
    if (!o.silentPage) toast(it, kind === 'score' || kind === 'start');
    return it;
  }
  function toast(it, hot) {
    const host = document.getElementById('toasts'); if (!host) return;
    const t = document.createElement('button'); t.type = 'button'; t.className = 'toast fl-toast al-toast' + (hot ? ' hot' : ''); t.dataset.inboxed = '1';
    t.innerHTML = `${hot ? '<i aria-hidden="true"></i>' : ''}<span><b>${esc(it.title)}</b>${it.body ? `<small>${esc(it.body)}</small>` : ''}</span>`;
    t.addEventListener('click', () => { openItem(it); t.remove() });
    host.appendChild(t); setTimeout(() => t.classList.add('out'), 8500); setTimeout(() => t.remove(), 9000);
  }

  /* ---------- copying in alerts sent elsewhere (Predictions' own notes and notifications) ---------- */
  const guess = tag => /line/.test(tag) ? 'line' : /inj/.test(tag) ? 'injury' : /res/.test(tag) ? 'graded' : /edge/.test(tag) ? 'edge' : 'other';
  if (Orig) {
    const N = function (title, o = {}) { try { add(guess(String(o.tag || '')), title, o.body, { tag: o.tag, link: o.tag && /^fl-/.test(o.tag) ? { page: 'predictions' } : null }) } catch (e) {} return new Orig(title, o) };
    N.prototype = Orig.prototype;
    Object.defineProperty(N, 'permission', { get: () => Orig.permission });
    N.requestPermission = (...a) => Orig.requestPermission(...a);
    try { window.Notification = N } catch (e) {}
  }
  const host = document.getElementById('toasts');
  if (host) new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
    if (n.nodeType !== 1 || n.dataset.inboxed || !n.classList.contains('al-toast')) continue;
    const t = n.querySelector('b')?.textContent || n.textContent, b = n.querySelector('small')?.textContent || '';
    add('other', t, b, { link: { page: 'predictions' } });
  } }).observe(host, { childList: true });

  /* ---------- opening what an alert is about ---------- */
  function openItem(it) {
    if (!it) return; it.read = true; save();
    if (it.link) return window.flRecent?.open ? window.flRecent.open({ open: it.link }) : window.flPages?.show?.(it.link.page || 'inbox', it.link.arg);
    window.flPages?.show?.('inbox');
  }
  // #/open/<link>: what a notification tap or a shared deep link opens
  function deep(arg) {
    let link = null; try { link = JSON.parse(arg) } catch (e) {}
    const it = link && L.find(x => JSON.stringify(x.link) === JSON.stringify(link)); if (it) { it.read = true; save() }
    // after every page has registered (a cold start from a notification arrives before the later scripts load), and with
    // the #/open/ address replaced, so Back goes to where you were and never re-opens the alert
    const go = () => { history.replaceState(null, '', location.pathname + location.search);
      if (!link || typeof link !== 'object') return window.flPages?.show?.('inbox');
      window.flRecent?.open ? window.flRecent.open({ open: link }) : window.flPages?.show?.(link.page || 'inbox', link.arg) };
    document.readyState === 'complete' ? setTimeout(go, 0) : addEventListener('load', () => setTimeout(go, 0), { once: true });
  }
  navigator.serviceWorker?.addEventListener?.('message', ev => { if (ev.data?.type === 'fl-open' && ev.data.url) { const h = new URL(ev.data.url).hash; if (h.startsWith('#/open/')) deep(decodeURIComponent(h.slice(7))) } });

  /* ---------- the bell in the header ---------- */
  function bell() {
    const before = document.getElementById('tbSearch'); if (!before || document.getElementById('tbBell')) return;
    before.insertAdjacentHTML('beforebegin', `<button type="button" class="tb-ic tb-bell" id="tbBell" data-page="inbox">${ic('bell', 20)}<b class="tb-bell-n num" id="tbBellN" hidden></b></button>`);
    badge();
  }
  function badge() {
    const b = document.getElementById('tbBell'), n = document.getElementById('tbBellN'), u = unread(); if (!b) return;
    b.setAttribute('aria-label', u ? `Alerts, ${u} unread` : 'Alerts'); n.hidden = !u; n.textContent = u > 99 ? '99+' : u;
    document.querySelectorAll('[data-inbox-n]').forEach(x => { x.textContent = u ? String(u) : ''; x.hidden = !u });
  }

  /* ---------- the page ---------- */
  const V = { f: 'all', confirm: false };
  const dayName = t => { const d = new Date(t), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) };
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function render(el) {
    el.innerHTML = `<div class="vst ibx"><header class="pg-head"><div><h1 class="pg-title" tabindex="-1">Alerts</h1><p class="pg-sub">Every alert Floodlight sent you, kept on this device for 30 days.</p></div>
      <div class="cx-row"><button type="button" class="bt ghost" data-page="settings" data-arg="alerts">${ic('gear')}Alert settings</button></div></header><div id="ibxBody" class="vst"></div></div>`;
    draw();
  }
  function draw() {
    const el = document.getElementById('ibxBody'); if (!el) return;
    const act = document.activeElement?.closest?.('#ibxBody [data-ibx]')?.dataset.ibx;
    const cnt = k => k === 'all' ? L.length : k === 'unread' ? unread() : L.filter(x => CAT[x.kind] === k || (k === 'picks' && x.kind === 'other')).length;
    const list = L.filter(x => V.f === 'all' || (V.f === 'unread' ? !x.read : CAT[x.kind] === V.f || (V.f === 'picks' && x.kind === 'other')));
    const groups = []; for (const x of list) { const d = dayName(x.at); let g = groups.find(y => y.d === d); if (!g) groups.push(g = { d, xs: [] }); g.xs.push(x) }
    const row = x => `<li class="ibx-i${x.read ? '' : ' new'}"><button type="button" class="ibx-open" data-ibx="open:${esc(x.id)}"><span class="ibx-ic" aria-hidden="true">${ic(ICON[CAT[x.kind]] || 'bell', 18)}</span>
        <span class="rw-t"><b>${esc(x.title)}</b>${x.body ? `<small>${esc(x.body)}</small>` : ''}</span><span class="ibx-t"><time class="lb" datetime="${new Date(x.at).toISOString()}">${esc(time(x.at))}</time>${x.read ? '' : '<span class="ibx-dot"><span class="sr-only">Unread</span></span>'}</span></button>
        <button type="button" class="ib" data-ibx="drop:${esc(x.id)}" aria-label="Delete alert: ${esc(x.title)}" title="Delete">${ic('x', 16)}</button></li>`;
    el.innerHTML = `<div class="ibx-bar"><div class="cx-row scroll" role="radiogroup" aria-label="Show">${FILTERS.map(([k, l]) => { const n = cnt(k); return `<button type="button" class="cx sm" role="radio" aria-checked="${V.f === k}" tabindex="${V.f === k ? 0 : -1}" data-ibx="f:${k}">${l}${n ? ` <span class="num lb">${n}</span>` : ''}</button>` }).join('')}</div>
        <div class="cx-row">${unread() ? '<button type="button" class="bt ghost sm" data-ibx="read">Mark all read</button>' : ''}${L.length ? (V.confirm ? `<span class="lb">Delete all ${L.length}?</span><button type="button" class="bt danger sm" data-ibx="clear:yes">Delete all</button><button type="button" class="bt ghost sm" data-ibx="clear:no">Cancel</button>` : '<button type="button" class="bt ghost sm" data-ibx="clear:ask">Delete all</button>') : ''}</div></div>
      ${list.length ? groups.map(g => `<section class="card ibx-day" aria-labelledby="ibx-${esc(g.d.replace(/\W/g, ''))}"><h2 id="ibx-${esc(g.d.replace(/\W/g, ''))}" class="ibx-h">${esc(g.d)}</h2><ul class="ibx-l">${g.xs.map(row).join('')}</ul></section>`).join('')
        : `<div class="card emp">${ic('bell', 30)}<b>${L.length ? 'Nothing in this view' : 'No alerts yet'}</b><p>${L.length ? 'Choose All to see every alert.' : 'Alerts for your teams, players, picks and line moves will collect here, even when a notification is missed.'}</p>${L.length ? '' : '<button type="button" class="bt" data-page="settings" data-arg="alerts">Choose what to hear about</button>'}</div>`}`;
    if (act) (el.querySelector(`[data-ibx="${CSS.escape(act)}"]`) || el.querySelector('[data-ibx^="f:"][aria-checked="true"]'))?.focus({ preventScroll: true });
  }
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('#pg-inbox [data-ibx]'); if (!t) return;
    const [a, v] = t.dataset.ibx.split(/:(.*)/s);
    if (a === 'f') { V.f = v; return draw() }
    if (a === 'open') return openItem(L.find(x => x.id === v));
    if (a === 'drop') { const i = L.findIndex(x => x.id === v); L = L.filter(x => x.id !== v); save(); const nx = L[Math.min(i, L.length - 1)]; return (nx ? document.querySelector(`[data-ibx="drop:${CSS.escape(nx.id)}"]`) : document.querySelector('#pg-inbox .pg-title'))?.focus() }
    if (a === 'read') { L.forEach(x => { x.read = true }); save(); return document.querySelector('#pg-inbox .pg-title')?.focus() }
    if (a === 'clear') { if (v === 'ask') { V.confirm = true; draw(); return document.querySelector('[data-ibx="clear:yes"]')?.focus() } V.confirm = false; if (v === 'yes') { L = []; save() } draw(); return document.querySelector('#pg-inbox .pg-title')?.focus() }
  });
  addEventListener('storage', ev => { if (ev.key === KEY) { L = store.get(KEY, []) || []; badge(); if (window.flPages?.current?.() === 'inbox') draw() } });
  window.flPages?.add('inbox', { title: 'Alerts', render, fresh: true });
  window.flPages?.add('open', { title: 'Opening', fresh: true, render(el, arg) { el.innerHTML = '<p class="lb" role="status">Opening…</p>'; deep(arg || '') } });
  bell();
  window.flInbox = { add, list: () => L, unread, open: openItem, url: linkURL };
  window.flNotify = notify;
})();
