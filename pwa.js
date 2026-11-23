/* Floodlight · the installable app: registers the service worker (sw.js) and offers "Install Floodlight" in the menu
   where the browser allows it (Chrome, Edge and Android; on iPhone it is Share › Add to Home Screen, which the guide
   explains). Nothing here runs in the theme preview frame. */
(() => {
  if (window.FL_PREVIEW) return;
  let ask = null;
  addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); ask = ev });
  addEventListener('appinstalled', () => { ask = null });
  async function install() {
    if (!ask) return false;
    const ev = ask; ask = null; ev.prompt();
    try { await ev.userChoice } catch (e) {}
    return true;
  }
  document.addEventListener('click', ev => { if (ev.target.closest?.('[data-install]')) { window.flShell?.closeMenu?.(); install() } });
  window.flApp = { canInstall: () => !!ask, install, standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true };
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !navigator.webdriver)
    addEventListener('load', () => setTimeout(() => navigator.serviceWorker.register('sw.js').catch(() => {}), 1500));
})();
