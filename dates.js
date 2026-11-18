/* Floodlight · the date strip. One scrolling row of day pills shared by every sport.
   flDates(opts) returns the markup; each sport passes the attributes its own click handler already understands.
   The <fl-dates> element then slides the highlight from the day you were on, keeps the chosen day in view and
   fills in the dots for days that have games. */
(() => {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ymd = d => iso(d).replace(/-/g, '');
  const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const CHEV = { l: '<path d="M15 6l-6 6 6 6"/>', r: '<path d="M9 6l6 6-6 6"/>' };
  const svg = p => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const CAL = svg('<path d="M4 6h16v15H4zM4 10h16M8 3v5M16 3v5"/>');
  const still = () => matchMedia('(prefers-reduced-motion:reduce)').matches || document.documentElement.dataset.motion === 'reduce';

  /* ---------- which days have games ---------- */
  const known = new Map();                 // "sport|scope" -> Map(iso -> number of games)
  const asked = new Map();                 // "sport|scope" -> time of the last request
  const MAIN = { basketball: 'basketball/nba', hockey: 'hockey/nhl', baseball: 'baseball/mlb' };
  const API = 'https://site.api.espn.com/apis/site/v2/sports/';
  const bucket = k => { if (!known.has(k)) known.set(k, new Map()); return known.get(k) };
  const tell = k => document.dispatchEvent(new CustomEvent('fl:days', { detail: k }));
  function count(k, events, from, to) {
    const b = bucket(k); for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) if (!b.has(iso(d))) b.set(iso(d), 0);
    const seen = new Map(); for (const e of events || []) { const key = iso(new Date(e.date)); seen.set(key, (seen.get(key) || 0) + 1) }
    for (const [key, n] of seen) b.set(key, n);
  }
  const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() });
  function ensure(sport, scope, days) {
    const k = sport + '|' + (scope || ''); if (Date.now() - (asked.get(k) || 0) < 600000 || !days.length) return k;
    asked.set(k, Date.now());
    const from = days[0], to = days[days.length - 1], path = sport === 'soccer' ? (scope ? 'soccer/' + scope : null) : MAIN[sport];
    if (path) get(`${API}${path}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=500`).then(d => { count(k, d.events, from, to); tell(k) }).catch(() => {});
    else if (sport === 'soccer') days.forEach((d, i) => setTimeout(() => get(`${API}soccer/all/scoreboard?dates=${ymd(d)}`).then(r => { count(k, r.events, d, d); tell(k) }).catch(() => {}), 1500 + i * 220));
    return k;
  }
  // a sport that has just loaded a day can say so, which also covers leagues the request above does not
  window.flDays = { mark(sport, scope, date, n) { const k = sport + '|' + (scope || ''); const b = bucket(k), key = iso(date); if ((b.get(key) || 0) < n || !b.has(key)) { b.set(key, n); tell(k) } }, has: (k, key) => (known.get(k)?.get(key) || 0) > 0 };

  /* ---------- markup ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.flDates = function ({ sport, scope = '', sel, days, attr, prev = '', next = '', cal = '', dots = true }) {
    const today = day0(new Date()), s = iso(sel), k = dots ? ensure(sport, scope, days) : '';
    const pills = days.map(d => { const key = iso(d), off = Math.round((day0(d) - today) / 864e5), on = key === s;
      return `<button class="fld-d${on ? ' on' : ''}${off === 0 ? ' today' : ''}${k && flDays.has(k, key) ? ' has' : ''}" data-iso="${key}" ${attr(d, off)} aria-pressed="${on}" aria-label="${esc((off === 0 ? 'Today, ' : '') + d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}">${off === 0 ? '<em>Today</em>' : ''}<small>${esc(d.toLocaleDateString([], { weekday: 'short' }))}</small><b>${d.getDate()}</b><u></u></button>` }).join('');
    return `<fl-dates class="fld" data-key="${esc(sport)}" data-days="${esc(k)}" data-sel="${s}"><button class="fld-nav" ${prev} aria-label="Previous day">${svg(CHEV.l)}</button>
      <div class="fld-scroll"><div class="fld-track" role="group" aria-label="Choose a day"><i class="fld-ind"></i>${pills}</div></div>
      <button class="fld-nav" ${next} aria-label="Next day">${svg(CHEV.r)}</button>${cal}</fl-dates>`;
  };
  window.flDates.cal = (inputAttrs, label = 'Pick any date') => `<label class="fld-cal" title="${esc(label)}">${CAL}<input type="date" ${inputAttrs} aria-label="${esc(label)}"></label>`;
  window.flDates.range = (centre, before = 7, after = 7) => { const out = []; for (let i = -before; i <= after; i++) { const d = day0(centre); d.setDate(d.getDate() + i); out.push(d) } return out };
  window.flDates.iso = iso;

  /* ---------- the element ---------- */
  const memory = new Map();                // sport -> { sel, left } from the strip that was on screen before this redraw
  customElements.define('fl-dates', class extends HTMLElement {
    connectedCallback() {
      const key = this.dataset.key, was = memory.get(key), sc = this.querySelector('.fld-scroll'), ind = this.querySelector('.fld-ind'), on = this.querySelector('.fld-d.on');
      if (!sc || !ind) return;
      const place = (b, animate) => { ind.style.transition = animate ? '' : 'none'; ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; ind.hidden = false };
      const centre = b => Math.max(0, b.offsetLeft - sc.clientWidth / 2 + b.offsetWidth / 2);
      this._lay = () => { const cur = this.querySelector('.fld-d.on'); if (cur) place(cur, false) };
      if (!on) { ind.hidden = true; return }
      const from = was && was.sel !== this.dataset.sel ? this.querySelector(`.fld-d[data-iso="${was.sel}"]`) : null;
      if (from && !still()) { place(from, false); sc.scrollLeft = was.left; ind.getBoundingClientRect(); place(on, true); sc.scrollTo({ left: centre(on), behavior: 'smooth' }) }
      else { place(on, false); sc.scrollLeft = was && was.sel === this.dataset.sel ? was.left : centre(on) }
      memory.set(key, { sel: this.dataset.sel, left: sc.scrollLeft });
      sc.addEventListener('scroll', () => { const m = memory.get(key); if (m) m.left = sc.scrollLeft }, { passive: true });
      this._days = ev => { if (ev.detail !== this.dataset.days) return; this.querySelectorAll('.fld-d').forEach(b => b.classList.toggle('has', flDays.has(ev.detail, b.dataset.iso))) };
      document.addEventListener('fl:days', this._days); document.fonts?.ready.then(this._lay);
      // the strip can be drawn while its section is still hidden; once it has a real width, line it up (unless you have already moved it)
      let touched = false; for (const t of ['pointerdown', 'wheel', 'touchstart']) sc.addEventListener(t, () => touched = true, { passive: true });
      this._ro = new ResizeObserver(() => { const cur = this.querySelector('.fld-d.on'); if (!cur || !sc.clientWidth) return; place(cur, false); if (!touched) { sc.scrollLeft = centre(cur); const m = memory.get(key); if (m) m.left = sc.scrollLeft } });
      this._ro.observe(sc);
    }
    disconnectedCallback() { document.removeEventListener('fl:days', this._days); this._ro?.disconnect() }
  });
})();
