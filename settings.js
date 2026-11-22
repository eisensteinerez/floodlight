/* Floodlight · Settings: the theme picker, text size, brightness, motion.
   The theme itself is applied by the small script at the top of index.html (flApplyTheme), before the first paint.
   This file is the picker and the other appearance controls. A change applies at once and is saved; nothing reloads. */
(() => {
  const root = document.documentElement, T = window.FL_THEMES || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v } catch { return d } }, set(k, v) { try { localStorage.setItem(k, v) } catch {} } };
  const look = () => { try { return JSON.parse(ls.get('fl.look', '{}')) || {} } catch { return {} } };
  const setLook = patch => ls.set('fl.look', JSON.stringify({ ...look(), ...patch }));
  const THEMES = [
    ['night-match', 'Night Match', 'Stadium at night. Dark with gold light.'],
    ['team-colors', 'Team Colors', 'Bright and bold. Cards in each team’s colors.'],
    ['members-club', 'Members’ Club', 'Deep green, champagne and serif type.'],
    ['aurora-glass', 'Aurora Glass', 'Frosted glass over glowing color.'],
    ['chrono', 'Chrono', 'Clean white, thin numerals, watch-dial details.'],
    ['stadium-gold', 'Stadium Gold', 'Night stadium, gold light, broadcast type.'],
  ];
  const SIZES = [[0.9, 'Small'], [1, 'Default'], [1.15, 'Large'], [1.3, 'Extra large']];
  const BRIGHT = [['dim', 'Dimmed'], ['', 'Normal'], ['bright', 'Bright']];

  /* ---------- the theme ---------- */
  const current = () => root.dataset.theme;
  const nameOf = id => (THEMES.find(t => t[0] === id) || THEMES[0])[1];
  let saveT = 0;
  function setTheme(id, opts = {}) {
    if (!Object.prototype.hasOwnProperty.call(T, id)) id = 'night-match';
    const was = current(); window.flApplyTheme(id); ls.set('floodlight-theme', id);
    if (!opts.quiet && typeof S !== 'undefined' && S.me && typeof api === 'function') {   // signed in: the choice follows the account
      clearTimeout(saveT); saveT = setTimeout(() => api('/api/me/prefs', { theme: id }).then(d => { if (d.user) S.me = d.user }).catch(() => {}), 500);
    }
    if (was !== id) document.dispatchEvent(new CustomEvent('fl:theme', { detail: { id, scheme: T[id][0] } }));
    sync();
    return id;
  }
  // a member who has never chosen on this device gets the theme saved on their account
  document.addEventListener('fl:me', () => { const t = typeof S !== 'undefined' && S.me?.prefs?.theme; if (t && T[t] && !ls.get('floodlight-theme', null)) setTheme(t, { quiet: true }) });
  // another tab changed it
  addEventListener('storage', ev => { if (ev.key === 'floodlight-theme') { window.flApplyTheme(ev.newValue); document.dispatchEvent(new CustomEvent('fl:theme', { detail: { id: current() } })); sync() } });

  /* ---------- brightness: a film over the page, so the theme's own colours stay as designed ---------- */
  const film = document.createElement('div'); film.id = 'flBright'; film.setAttribute('aria-hidden', 'true'); document.body.appendChild(film);
  function setBright(v) { if (v) root.dataset.bright = v; else delete root.dataset.bright; setLook({ bright: v || '' }); sync() }

  /* ---------- text size and motion reuse the page's own preferences (S.prefs, saved as fl.prefs) ---------- */
  const prefs = () => (typeof S !== 'undefined' && S.prefs) || {};
  function setPref(k, v) { if (typeof S === 'undefined') return; S.prefs[k] = v; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs(); sync() }
  const sizeIndex = () => { const z = +prefs().size || 1; let best = 1; SIZES.forEach(([v], i) => { if (Math.abs(v - z) < Math.abs(SIZES[best][0] - z)) best = i }); return best };

  /* ---------- a small picture of each theme, drawn from that theme's own tokens ---------- */
  const preview = id => `<span class="thp" data-theme-preview="${id}" aria-hidden="true"><span class="thp-h"><i></i><b></b><b></b><b class="on"></b><b></b></span><span class="thp-t"></span>
    <span class="thp-d"><i></i><i></i><i class="on"></i><i></i><i></i></span><span class="thp-m"><em class="a"></em><strong>1<small>:</small>0</strong><em class="b"></em></span><span class="thp-r"><i></i><i></i><i></i></span></span>`;

  function render(el) {
    const cur = current(), p = prefs(), si = sizeIndex(), br = root.dataset.bright || '';
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Settings</h1><p class="pg-sub">How Floodlight looks and reads on this device.</p></div></header>
      <div class="card feature st-card">
        <p class="st-crumb">Settings › Appearance</p>
        <div class="st-h"><h2 id="stThemeH">Theme</h2><span class="st-saved" id="stSaved" role="status" aria-live="polite"></span></div>
        <p class="lb st-favnote"><span>Have more than one you like? Star them on your profile and switch between them from the menu.</span> <button type="button" class="lk" data-page="profile" data-arg="themes">Star favorite themes</button></p>
        <div class="st-themes" role="radiogroup" aria-labelledby="stThemeH">
          ${THEMES.map(([id, name, desc]) => `<button type="button" class="st-theme${id === cur ? ' on' : ''}" role="radio" aria-checked="${id === cur}" tabindex="${id === cur ? 0 : -1}" data-theme-pick="${id}">
            ${preview(id)}<span class="st-tn">${esc(name)}<svg class="st-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="st-td">${esc(desc)}</span></button>`).join('')}
        </div>
        <div class="st-rows">
          <div class="st-row"><div class="st-l"><label for="stSize">Text size</label><small>Makes everything on the page larger or smaller.</small></div>
            <div class="st-c st-size"><span class="st-a" aria-hidden="true">A</span><input id="stSize" type="range" min="0" max="${SIZES.length - 1}" step="1" value="${si}" aria-valuetext="${SIZES[si][1]}"><span class="st-a big" aria-hidden="true">A</span><span class="chip st-val" id="stSizeV">${SIZES[si][1]}</span></div></div>
          <div class="st-row"><div class="st-l"><span id="stBrL">Brightness</span><small>Dims or lifts the whole page without changing the theme.</small></div>
            <div class="st-c seg st-seg" role="radiogroup" aria-labelledby="stBrL">${BRIGHT.map(([v, l]) => `<button type="button" role="radio" aria-checked="${br === v}" class="${br === v ? 'on' : ''}" data-bright-pick="${v}">${l}</button>`).join('')}</div></div>
          <div class="st-row"><div class="st-l"><label for="prefMotion">Reduce motion</label><small>Turns off pulsing, flicker and grow-in animations.</small></div>
            <div class="st-c"><input class="sw" type="checkbox" role="switch" id="prefMotion" ${p.motion ? 'checked' : ''}></div></div>
          <div class="st-row"><div class="st-l"><label for="prefContrast">High contrast</label><small>Stronger text and borders.</small></div>
            <div class="st-c"><input class="sw" type="checkbox" role="switch" id="prefContrast" ${p.contrast ? 'checked' : ''}></div></div>
          <div class="st-row"><div class="st-l"><label for="prefAlerts">Announce goals</label><small>Reads out a goal in a match you have open, for screen readers.</small></div>
            <div class="st-c"><input class="sw" type="checkbox" role="switch" id="prefAlerts" ${ls.get('fl.alerts', 'true') !== 'false' ? 'checked' : ''}></div></div>
        </div>
      </div>`;
  }
  function sync() { const el = document.getElementById('pg-settings'); if (!el || el.hidden) return; const f = document.activeElement, pick = f?.dataset?.themePick, id = f?.id; render(el);
    if (pick) el.querySelector(`[data-theme-pick="${current()}"]`)?.focus(); else if (id) document.getElementById(id)?.focus() }
  function saved() { const s = document.getElementById('stSaved'); if (!s) return; s.textContent = 'Saved'; s.classList.add('on'); clearTimeout(saved.t); saved.t = setTimeout(() => { const n = document.getElementById('stSaved'); if (n) { n.textContent = ''; n.classList.remove('on') } }, 1800) }

  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-theme-pick]'); if (t) { setTheme(t.dataset.themePick); saved(); return }
    const b = ev.target.closest?.('[data-bright-pick]'); if (b) { setBright(b.dataset.brightPick); saved() }
  });
  document.addEventListener('keydown', ev => {   // the theme cards are one radio group: arrows move and choose
    const t = ev.target.closest?.('[data-theme-pick],[data-bright-pick]'); if (!t || !/^Arrow|^Home$|^End$/.test(ev.key)) return;
    const all = [...t.parentElement.children], i = all.indexOf(t), n = all.length;
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : /Right|Down/.test(ev.key) ? (i + 1) % n : (i - 1 + n) % n;
    ev.preventDefault(); all[j].focus(); all[j].click();
  });
  document.addEventListener('input', ev => { if (ev.target.id !== 'stSize') return; const i = +ev.target.value; ev.target.setAttribute('aria-valuetext', SIZES[i][1]); document.getElementById('stSizeV').textContent = SIZES[i][1];
    if (typeof S !== 'undefined') { S.prefs.size = SIZES[i][0]; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs() } saved() });
  document.addEventListener('change', ev => { if (/^pref(Motion|Contrast|Alerts)$/.test(ev.target.id) && ev.target.closest('#pg-settings')) saved() });

  /* ---------- favorite themes: starred on the profile page, then one press away in the three-dot menu ---------- */
  const localFavs = () => { try { const a = JSON.parse(ls.get('fl.favThemes', '[]')); return Array.isArray(a) ? a : [] } catch { return [] } };
  const favs = () => { const mine = typeof S !== 'undefined' && S.me?.prefs?.favThemes; return (Array.isArray(mine) ? mine : localFavs()).filter(id => Object.prototype.hasOwnProperty.call(T, id)) };
  function fav(id, on) {
    if (!Object.prototype.hasOwnProperty.call(T, id)) return favs();
    const next = favs().filter(x => x !== id); if (on) next.push(id);
    ls.set('fl.favThemes', JSON.stringify(next));
    if (typeof S !== 'undefined' && S.me && typeof api === 'function') { S.me.prefs = { ...S.me.prefs, favThemes: next }; api('/api/me/prefs', { favThemes: next }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) }
    document.dispatchEvent(new CustomEvent('fl:theme', { detail: { id: current(), favs: next } }));
    return next;
  }
  document.addEventListener('click', ev => { const t = ev.target.closest?.('[data-theme-use]'); if (t) setTheme(t.dataset.themeUse) });
  window.flTheme = { list: THEMES, get: current, name: () => nameOf(current()), set: setTheme, scheme: () => root.dataset.scheme, favs, fav, preview };
  // the menu's Theme item lands on the picker itself
  function onShow(el, arg) { if (arg !== 'theme') return; setTimeout(() => { el.querySelector('#stThemeH')?.scrollIntoView({ block: 'center' }); el.querySelector('[data-theme-pick][aria-checked="true"]')?.focus({ preventScroll: true }) }, 40) }
  window.flPages?.add('settings', { title: 'Settings', render, onShow, fresh: true });
})();
