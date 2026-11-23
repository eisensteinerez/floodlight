/* Floodlight · the one player record, in the page (players.py on the server).
   A player's team is never worked out by a page. Every place that names a player's team writes a placeholder,
     <span data-flreg="nba:1966" data-flreg-show="team">fallback text</span>
   and this file fills it from the record: the search box, player profiles, Predictions, the Lab, trends, parlays,
   hot and cold lists and alerts all show the same team, from the same roster read.
   data-flreg-show:  team     "Philadelphia 76ers"
                     sub      "Philadelphia 76ers · NBA"
                     verified "Roster verified 18 minutes ago" (and the previous team, after a move)
                     line     both, on two lines
                     keep     leaves the page's own team (and its link) while the record agrees, else replaces it
   When the record is being checked (two rosters list the player, a sportsbook disagrees, no roster has listed them
   for two days), the team is replaced by "Team information is being verified", with the reason on hover and for
   screen readers. data-flreg-shown="<team id>" says which team the page itself showed; a different team is reported
   to the server, which flags the record (the profile-versus-card check). Broken headshots are reported too.
   window.flPlayers: fid(sport, id), get(fid), find(sport, name, team), text(rec), verified(rec), hydrate(root). */
(() => {
  const SPORTS = new Set(['nba', 'wnba', 'nfl', 'nhl', 'mlb']);
  const LEAGUE = { nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB' };
  const CHECKING = 'Team information is being verified';
  const TTL = 10 * 60e3;
  const mem = new Map();          // fid -> { at, rec, p }
  const wanted = new Set();
  let batchT = 0, hydrateT = 0;
  const seenQ = [], photoQ = new Set();
  let sendT = 0;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fid = (sport, id) => {
    const s = String(sport || '').toLowerCase(), i = String(id || '').replace(/^\D+/, '');
    return SPORTS.has(s) && /^\d{1,12}$/.test(i) ? `${s}:${i}` : '';
  };

  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60); if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  /* ---------- reading records: one request for every record a page asks for at once ---------- */
  function flush() {
    batchT = 0;
    const ids = [...wanted].slice(0, 60); ids.forEach(i => wanted.delete(i));
    if (wanted.size) batchT = setTimeout(flush, 0);
    if (!ids.length) return;
    fetch(`/api/players/get?ids=${encodeURIComponent(ids.join(','))}`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => ids.forEach(i => settle(i, d.players?.[i] || null)))
      .catch(() => ids.forEach(i => settle(i, undefined)));
  }
  function settle(i, rec) {
    const m = mem.get(i); if (!m) return;
    m.at = Date.now(); m.rec = rec === undefined ? m.rec ?? null : rec; m.failed = rec === undefined;
    m.res(m.rec); m.done = true;
  }
  function get(id) {
    if (!id) return Promise.resolve(null);
    const m = mem.get(id);
    if (m && (!m.done || Date.now() - m.at < (m.failed ? 30e3 : TTL))) return m.p;
    const n = { at: Date.now(), rec: m?.rec ?? null, done: false };
    n.p = new Promise(res => { n.res = res });
    mem.set(id, n); wanted.add(id);
    if (!batchT) batchT = setTimeout(flush, 40);
    return n.p;
  }
  const peek = id => mem.get(id)?.rec || null;
  function find(sport, name, team) {
    if (!SPORTS.has(sport) || !name) return Promise.resolve(null);
    const k = `find:${sport}:${String(name).toLowerCase()}:${team || ''}`;
    const m = mem.get(k); if (m && Date.now() - m.at < TTL) return m.p;
    const p = fetch(`/api/players/find?sport=${sport}&name=${encodeURIComponent(name)}${team ? '&team=' + encodeURIComponent(team) : ''}`, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null).then(d => { const rec = d?.player || null; if (rec) mem.set(rec.fid, { at: Date.now(), rec, done: true, p: Promise.resolve(rec) }); return rec }).catch(() => null);
    mem.set(k, { at: Date.now(), p });
    return p;
  }

  /* ---------- what a record says ---------- */
  const checking = rec => !rec || rec.status !== 'verified';
  function text(rec, mode = 'team') {
    if (!rec) return '';
    if (checking(rec)) return CHECKING;
    const team = rec.teamName || rec.teamAbbr || 'No team listed';
    return mode === 'sub' ? `${team} · ${rec.league || LEAGUE[rec.sport] || ''}` : team;
  }
  function verified(rec) {
    if (!rec) return '';
    if (checking(rec)) return rec.why || 'We are checking this player’s team against the team rosters.';
    const bits = [`Roster verified ${ago(rec.rosterAt)}`];
    if (rec.prev?.teamName) bits.push(`previously ${rec.prev.teamName}`);
    return bits.join(' · ');
  }

  /* ---------- filling the placeholders ---------- */
  function paint(el, rec) {
    const show = el.dataset.flregShow || 'team';
    el.dataset.flregDone = '1';
    if (!rec) { el.dataset.flregState = 'none'; return }   // no record (the server didn't answer): the page's own text stays
    const chk = checking(rec);
    el.dataset.flregState = chk ? 'checking' : 'verified';
    el.classList.toggle('flreg-checking', chk);
    if (show === 'verified') { el.textContent = verified(rec); el.hidden = false }
    else if (show === 'keep') { if (chk || (el.dataset.flregShown && rec.teamId && el.dataset.flregShown !== rec.teamId)) el.textContent = text(rec) }   // the page's own team (with its link) stays while it agrees
    else if (show === 'line') el.innerHTML = `<span class="flreg-team">${esc(text(rec, 'sub'))}</span><small class="flreg-when">${esc(verified(rec))}</small>`;
    else el.textContent = text(rec, show);
    if (chk && show !== 'verified') { el.title = rec.why || ''; el.setAttribute('aria-label', `${CHECKING}. ${rec.why || ''}`.trim()) }
    else { el.removeAttribute('title'); el.removeAttribute('aria-label') }
    const shown = el.dataset.flregShown;
    if (shown && rec.teamId && shown !== rec.teamId && !el.dataset.flregSent) {   // the page showed another team: tell the server
      el.dataset.flregSent = '1'; seenQ.push({ fid: rec.fid, teamId: shown, where: el.dataset.flregWhere || 'page' }); queueSend();
    }
  }
  function hydrate(root = document) {
    const els = [...(root.querySelectorAll ? root.querySelectorAll('[data-flreg]:not([data-flreg-done])') : [])];
    for (const el of els) {
      const id = el.dataset.flreg; if (!id) continue;
      const have = peek(id); if (have) paint(el, have);
      get(id).then(rec => { if (el.isConnected) paint(el, rec) });
    }
  }
  const later = () => { if (!hydrateT) hydrateT = setTimeout(() => { hydrateT = 0; hydrate() }, 60) };
  new MutationObserver(muts => { for (const m of muts) if (m.addedNodes.length) return later() }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', later);
  // "verified 18 minutes ago" keeps counting while the page is open
  setInterval(() => document.querySelectorAll('[data-flreg][data-flreg-state="verified"]').forEach(el => { const r = peek(el.dataset.flreg); if (r) paint(el, r) }), 60e3);

  /* ---------- reports: a page that showed another team, headshots that didn't load ---------- */
  function queueSend() { if (!sendT) sendT = setTimeout(send, 3000) }
  function send() {
    sendT = 0; if (!seenQ.length && !photoQ.size) return;
    const body = JSON.stringify({ seen: seenQ.splice(0, 40), photos: [...photoQ].slice(0, 40) }); photoQ.clear();
    fetch('/api/players/seen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
  window.addEventListener('error', ev => {
    const img = ev.target; if (!(img instanceof HTMLImageElement)) return;
    const m = /headshots\/(nba|wnba|nfl|nhl)\/players\/full\/(\d+)|people\/(\d+)\/headshot/.exec(img.currentSrc || img.src || ''); if (!m) return;
    photoQ.add(m[1] ? `${m[1]}:${m[2]}` : `mlb:${m[3]}`); queueSend();
  }, true);

  // the placeholder, for pages that build HTML strings: the fallback shows until the record arrives
  const span = (id, fallback, show = 'team') => id ? `<span data-flreg="${esc(id)}" data-flreg-show="${esc(show)}">${esc(fallback || '')}</span>` : esc(fallback || '');
  window.flPlayers = { fid, get, peek, find, text, verified, hydrate, ago, checking, span, CHECKING, SPORTS };
})();
