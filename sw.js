/* Floodlight · the service worker: what makes the site an installable app.
   - The app's own files (the page, scripts, styles, icons) are kept after each visit, so Floodlight opens without a
     connection and your saved boards, follows and alerts inbox (all kept on this device) still work offline.
   - Every file is asked for fresh first, so a new version shows at once; the kept copy is used only when the network
     fails or takes longer than four seconds. Data (/api/...) is never kept here: each page already keeps its last
     reading with the time it was read, and says so.
   - With no connection and nothing kept yet, the page shows offline.html.
   - Pressing a notification opens Floodlight on what it is about (the link travels in the notification's data). */
const V = 'fl-app-1', FONTS = 'fl-fonts-1';
const SHELL = ['/', 'offline.html', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', ev => { ev.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())) });
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (p, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('slow')), ms); p.then(r => { clearTimeout(t); ok(r) }, e => { clearTimeout(t); no(e) }) });
async function fresh(req, key) {
  const c = await caches.open(V), net = fetch(req);
  // the network answer is kept even if it arrives after we gave up waiting
  net.then(r => { if (r && r.ok && r.type === 'basic') c.put(key || req, r.clone()) }).catch(() => {});
  try { return await timeout(net, 4000) }
  catch (e) {
    const hit = await c.match(key || req, { ignoreSearch: !!key });
    if (hit) return hit;
    try { return await net } catch (e2) {}
    if (req.mode === 'navigate') return (await c.match('offline.html')) || new Response('Offline', { status: 503 });
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
self.addEventListener('fetch', ev => {
  const req = ev.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) return;   // data goes straight to the network
    if (req.mode === 'navigate') return ev.respondWith(fresh(req, '/'));   // every address is the same page; the part after # picks the screen
    if (/\.(js|css|webmanifest|png|webp|svg|html)$/.test(u.pathname)) return ev.respondWith(fresh(req));
    return;
  }
  // the theme fonts: they never change at a given address, so a kept copy is used first
  if (u.hostname === 'fonts.gstatic.com' || u.hostname === 'fonts.googleapis.com') {
    ev.respondWith(caches.open(FONTS).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r })));
  }
});

// a notification was pressed: bring Floodlight forward on what it is about, or open it there
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const url = new URL(ev.notification.data?.url || '/', self.location.origin).href;
  ev.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = all.find(c => new URL(c.url).origin === self.location.origin);
    if (w) { await w.focus().catch(() => {}); w.postMessage({ type: 'fl-open', url }); return }
    await self.clients.openWindow(url);
  })());
});
