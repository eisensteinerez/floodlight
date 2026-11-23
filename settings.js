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
  const sizeTxt = i => `${SIZES[i][1]} · ${Math.round(SIZES[i][0] * 100)}%`;
  // data saver: live pages refresh every two minutes instead of every 30 seconds (home.js, live.js, matchcentre.js read it)
  window.flSaver = () => look().saver === true;
  const RESET = { confirm: false };

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
  document.addEventListener('fl:me', () => { if (window.FL_PREVIEW) return; const t = typeof S !== 'undefined' && S.me?.prefs?.theme; if (t && T[t] && !ls.get('floodlight-theme', null)) setTheme(t, { quiet: true }) });
  // another tab changed it
  addEventListener('storage', ev => { if (ev.key === 'floodlight-theme' && !window.FL_PREVIEW) { window.flApplyTheme(ev.newValue); document.dispatchEvent(new CustomEvent('fl:theme', { detail: { id: current() } })); sync() } });

  /* ---------- brightness: a film over the page, so the theme's own colours stay as designed ---------- */
  const film = document.createElement('div'); film.id = 'flBright'; film.setAttribute('aria-hidden', 'true'); document.body.appendChild(film);
  function setBright(v) { if (v) root.dataset.bright = v; else delete root.dataset.bright; setLook({ bright: v || '' }); sync() }

  /* ---------- text size and motion reuse the page's own preferences (S.prefs, saved as fl.prefs) ---------- */
  const prefs = () => (typeof S !== 'undefined' && S.prefs) || {};
  function setPref(k, v) { if (typeof S === 'undefined') return; S.prefs[k] = v; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs(); sync() }
  const sizeIndex = () => { const z = +prefs().size || 1; let best = 1; SIZES.forEach(([v], i) => { if (Math.abs(v - z) < Math.abs(SIZES[best][0] - z)) best = i }); return best };

  /* ---------- a small picture of each theme, drawn from that theme's own tokens ---------- */
  // The match in the picture is a real one from today's board (the biggest live game, else the next to start), and it is
  // the same one in every theme, so the six pictures differ only by theme. Before the board has loaded it falls back to 1:0.
  function sample() { const gs = (window.flHub?.games?.() || []).filter(g => g.a?.name && g.b?.name && g.sport !== 'tennis'); if (!gs.length) return null;
    const size = g => (g.weight || 0) * 10 + (g.a.rank ? 8 : 0) + (g.b.rank ? 8 : 0); return gs.filter(g => g.state === 'in').sort((a, b) => size(b) - size(a))[0] || gs.filter(g => g.state === 'pre').sort((a, b) => a.date - b.date)[0] || gs.sort((a, b) => size(b) - size(a))[0] }
  const crestBg = t => t?.logo ? ` style="background-image:url(&quot;${esc(t.logo)}&quot;)"` : '';
  const preview = id => { const g = sample(), sc = g && g.state !== 'pre' && !window.flMC?.spoil(g.key);
    return `<span class="thp${g ? ' real' : ''}" data-theme-preview="${id}" aria-hidden="true"><span class="thp-h"><i></i><b></b><b></b><b class="on"></b><b></b></span><span class="thp-t"></span>
    <span class="thp-d"><i></i><i></i><i class="on"></i><i></i><i></i></span><span class="thp-m"><em class="a"${crestBg(g?.a)}></em><strong>${sc ? esc(g.a.score) : g ? '–' : 1}<small>:</small>${sc ? esc(g.b.score) : g ? '–' : 0}</strong><em class="b"${crestBg(g?.b)}></em></span><span class="thp-r"><i></i><i></i><i></i></span></span>` };

  /* ---------- the live preview: the real page, with today's real games, in any theme ----------
     It is the app itself in a frame, started with ?flpreview=<theme>. A preview frame takes its theme from the address,
     saves nothing, and ignores clicks, so trying a theme here never changes yours. Changing the theme or the page sends
     the frame a message instead of reloading it, so the same games stay on screen and only the theme changes.
     Two frames can sit side by side to compare two themes, and the card can fill the window. Each frame reports how far
     it has got (page open, games loaded, drawn), so the wait shows real progress. A reader who keeps scores hidden can
     show them in the preview only, so every theme is compared on the same scoreboard; nothing else changes. */
  const PAGES = [['home', 'Home'], ['live', 'Live'], ['lab', 'The Lab'], ['predictions', 'Predictions']];
  const SIZE = { desktop: [1280, 800], tablet: [820, 1080], phone: [390, 760] }, BORDER = { desktop: 1, tablet: 6, phone: 6 };
  const DEVICES = [['desktop', 'Desktop'], ['tablet', 'Tablet'], ['phone', 'Phone']];
  const STEPS = ['Opening the page', 'Loading today’s games', 'Ready'];
  const PV = { theme: null, cmp: '', page: 'home', device: 'desktop', full: false, scores: false, panes: [], ro: null, back: null };
  const spoilOn = () => { try { const s = JSON.parse(localStorage.getItem('fl.spoil') || 'null'); return !!(s && (s.all || s.hide?.length)) } catch { return false } };
  const FULL_IC = on => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${on ? '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' : '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'}</svg>`;

  function pvControls() {
    const el = document.getElementById('stPvCtl'); if (!el) return; const cur = current(), th = PV.theme || cur;
    if (PV.cmp === th) PV.cmp = '';
    const seg = (name, label, opts, val) => `<div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${val === k}" class="${val === k ? 'on' : ''}" tabindex="${val === k ? 0 : -1}" data-pv${name}="${k}">${esc(l)}</button>`).join('')}</div>`;
    const sp = spoilOn();
    // in full screen a round close button stays in the corner whatever is scrolled, so leaving is one press away
    el.innerHTML = `${PV.full ? `<button type="button" class="pv-x" data-pvfull aria-label="Exit full screen preview"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}<div class="st-h"><h2 id="stPvH">Preview on your real pages</h2></div>
      <p class="lb">Today’s real games and picks, drawn in any theme. Looking at a theme here does not change yours until you press Use.</p>
      <div class="pv-bar">
        <div class="cx-row scroll" role="radiogroup" aria-label="Theme to preview">${THEMES.map(([id, name]) => `<button type="button" class="cx" role="radio" aria-checked="${th === id}" tabindex="${th === id ? 0 : -1}" data-pvtheme="${id}">${esc(name)}${id === cur ? '<span class="pv-yours">yours</span>' : ''}</button>`).join('')}</div>
        <div class="pv-row">${seg('page', 'Page', PAGES, PV.page)}${seg('device', 'Screen size', DEVICES, PV.device)}
          <label class="pv-cmp"><span>Side by side with</span><select class="inp sm" data-pvcmp><option value="">No second theme</option>${THEMES.filter(([id]) => id !== th).map(([id, name]) => `<option value="${id}"${PV.cmp === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
          <span class="pv-acts"><button type="button" class="bt ghost" data-pvfull>${FULL_IC(PV.full)}${PV.full ? 'Exit full screen' : 'Full screen'}</button>
          <button type="button" class="bt pv-use" data-theme-pick="${th}"${th === cur ? ' disabled' : ''}>${th === cur ? `${esc(nameOf(th))} is your theme` : `Use ${esc(nameOf(th))}`}</button></span></div>
        ${sp ? `<label class="pv-sc"><input class="sw" type="checkbox" role="switch" data-pvscores${PV.scores ? ' checked' : ''}><span><b>Show scores in the preview</b><span class="lb">Spoiler-free is on, so scores are hidden. This shows them inside the preview only.</span></span></label>` : ''}
      </div>`;
    pvScores(); PV.panes.forEach(P => { P.wrap.querySelector('.pv-cap').innerHTML = cap(P.theme) });
  }

  /* ---------- how readable each theme is, measured from its own colours ----------
     Each theme's tokens are read off a hidden element that carries data-theme-preview, then flattened onto the theme's
     background in a 1×1 canvas (so see-through surfaces count as they look), and compared with the WCAG formula. */
  let SCORES = null;
  function measure() {
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true });
    const flat = cols => { x.clearRect(0, 0, 1, 1); for (const s of cols) { x.fillStyle = '#000'; x.fillStyle = s; x.fillRect(0, 0, 1, 1) } return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3) };
    const lum = rgb => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; return .2126 * f(rgb[0]) + .7152 * f(rgb[1]) + .0722 * f(rgb[2]) };
    const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((m, n) => n - m); return (h + .05) / (l + .05) };
    return THEMES.map(([id, name]) => {
      const p = document.createElement('span'); p.dataset.themePreview = id; p.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
      const i = document.createElement('i'); p.appendChild(i); document.body.appendChild(p);
      const raw = k => getComputedStyle(p).getPropertyValue(k).trim();
      const col = k => { i.style.color = `var(${k})`; return getComputedStyle(i).color };
      const stops = k => { const r = raw(k); return /gradient/.test(r) ? (r.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || []) : [col(k)] };
      const bg = col('--bg'), surf = col('--surface'), B = flat([bg]), Sf = flat([bg, surf]);
      const ctaBg = raw('--cta-bg') ? stops('--cta-bg') : [col('--accent')], ctaFg = flat([bg, raw('--cta-fg') ? col('--cta-fg') : col('--on-accent')]);
      const row = {
        id, name,
        body: ratio(flat([bg, col('--text')]), B),
        small: Math.min(ratio(flat([bg, surf, col('--muted')]), Sf), ratio(flat([bg, col('--muted')]), B)),
        accent: Math.min(ratio(flat([bg, col('--accent')]), B), ratio(flat([bg, surf, col('--accent')]), Sf)),
        button: Math.min(...ctaBg.map(s => ratio(ctaFg, flat([bg, s])))),
      };
      p.remove(); row.low = Math.min(row.body, row.small, row.accent, row.button); return row;
    });
  }
  const grade = r => r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'Large text only' : 'Too low';
  function pvScores() {
    const el = document.getElementById('stPvScores'); if (!el) return;
    try { SCORES = SCORES || measure() } catch (e) { el.hidden = true; return }
    const shown = [PV.theme || current(), PV.cmp].filter(Boolean);
    const cell = r => `<td><span class="num">${r.toFixed(1)}:1</span> <span class="pv-g g-${grade(r).split(' ')[0].toLowerCase()}">${grade(r)}</span></td>`;
    el.innerHTML = `<h3 id="stPvSH">Readability in each theme</h3>
      <p class="lb">Contrast between each theme’s text and the colour behind it. 4.5:1 is the minimum for normal text (WCAG AA) and 7:1 is the higher AAA level. The lowest pair sets the overall grade.</p>
      <div class="pv-tw" role="region" aria-labelledby="stPvSH" tabindex="0"><table class="pv-ct">
        <thead><tr><th scope="col">Theme</th><th scope="col">Overall</th><th scope="col">Body text</th><th scope="col">Small labels</th><th scope="col">Links and highlights</th><th scope="col">Buttons</th></tr></thead>
        <tbody>${SCORES.map(s => `<tr class="${shown.includes(s.id) ? 'on' : ''}"><th scope="row">${esc(s.name)}${shown.includes(s.id) ? ' <span class="lb">in the preview</span>' : ''}</th>${cell(s.low)}${cell(s.body)}${cell(s.small)}${cell(s.accent)}${cell(s.button)}</tr>`).join('')}</tbody></table></div>`;
  }

  const cap = th => `${esc(nameOf(th))}${th === current() ? ' <span class="lb">yours</span>' : ''}`;
  function step(P, n) {
    if (P.step >= n) return; P.step = n; const w = P.box.querySelector('.pv-wait');
    if (w) { w.querySelector('progress').value = n; w.querySelector('.pv-step').textContent = `${STEPS[n - 1]}${n < 3 ? '…' : ''}` }
    if (n === 3) { clearTimeout(P.timer); P.box.classList.add('ready') }
  }
  function pane(theme) {
    const wrap = document.createElement('figure'); wrap.className = 'pv-pane';
    wrap.innerHTML = `<figcaption class="pv-cap">${cap(theme)}</figcaption><div class="pv-box"><div class="pv-wait" role="status"><span class="pv-step lb">${STEPS[0]}…</span><progress max="3" value="1" aria-label="Preview loading"></progress></div></div>`;
    const box = wrap.querySelector('.pv-box'), f = document.createElement('iframe'), P = { theme, wrap, box, f, step: 1, timer: 0 };
    f.className = 'pv-frame'; f.title = `Preview of the page in ${nameOf(theme)}`; f.setAttribute('tabindex', '-1');
    f.src = `${location.pathname}?flpreview=${encodeURIComponent(theme)}&flpage=${PV.page}&flscores=${PV.scores ? 1 : 0}`;
    f.addEventListener('load', () => { step(P, 2); pvSay(P); P.timer = setTimeout(() => step(P, 3), 6000) });   // drawn, or six seconds, whichever comes first
    box.appendChild(f); return P;
  }
  function pvFit() {
    const stage = document.getElementById('stPvStage'); if (!stage || !PV.panes.length) return;
    const [w, h] = SIZE[PV.device], b = BORDER[PV.device], n = getComputedStyle(stage).flexDirection === 'column' ? 1 : PV.panes.length, gap = n > 1 ? parseFloat(getComputedStyle(stage).columnGap) || 16 : 0;
    let k = Math.min(1, ((stage.clientWidth - gap * (n - 1)) / n - 2 * b) / w);
    if (PV.full) k = Math.min(k, (innerHeight - stage.getBoundingClientRect().top + (document.querySelector('.pv-card')?.scrollTop || 0) - 48) / h);   // the whole page fits the window
    k = Math.max(k, .12);
    for (const P of PV.panes) {
      const f = P.f; f.width = w; f.height = h; f.style.width = w + 'px'; f.style.height = h + 'px'; f.style.transform = `scale(${k})`;
      P.box.dataset.device = PV.device; P.box.style.width = Math.round(w * k) + 2 * b + 'px'; P.box.style.height = Math.round(h * k) + 2 * b + 'px';
    }
  }
  const pvSay = P => { try { P.f.contentWindow?.postMessage({ flPreview: { theme: P.theme, page: PV.page, scores: PV.scores } }, location.origin) } catch (e) {} };
  function pvStart() {
    const stage = document.getElementById('stPvStage'); if (!stage || PV.panes.length) return;
    stage.innerHTML = ''; pvSync();
    PV.ro?.disconnect(); PV.ro = new ResizeObserver(() => pvFit()); PV.ro.observe(stage);
  }
  // one frame per theme shown; a theme that changes is sent as a message, a second theme gets its own frame
  function pvSync() {
    const stage = document.getElementById('stPvStage'); if (!stage) return;
    const want = [PV.theme || current(), PV.cmp].filter(Boolean);
    while (PV.panes.length > want.length) { const P = PV.panes.pop(); clearTimeout(P.timer); P.wrap.remove() }
    want.forEach((th, i) => { let P = PV.panes[i]; if (!P) { P = pane(th); PV.panes.push(P); stage.appendChild(P.wrap) } else if (P.theme !== th) { P.theme = th; P.f.title = `Preview of the page in ${nameOf(th)}`; pvSay(P) } else pvSay(P); P.wrap.querySelector('.pv-cap').innerHTML = cap(th) });
    stage.classList.toggle('two', want.length > 1); pvFit();
  }
  function pvStop() { PV.ro?.disconnect(); PV.panes.forEach(P => { clearTimeout(P.timer); P.wrap.remove() }); PV.panes = []; if (PV.full) pvFull(false) }
  addEventListener('message', ev => { if (ev.origin !== location.origin || !ev.data?.flPreviewReady) return; const P = PV.panes.find(p => p.f.contentWindow === ev.source); if (P) step(P, 3) });

  // full screen: the card fills the window and holds focus until Escape or Exit full screen
  function pvFull(on) {
    const card = document.querySelector('.pv-card'); if (!card) return; PV.full = on;
    card.classList.toggle('full', on); root.classList.toggle('pv-lock', on);
    if (on) { PV.back = document.activeElement; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); addEventListener('resize', pvFit); window.flOverlay?.open(card, { from: PV.back, trap: false }) }
    else { card.removeAttribute('role'); card.removeAttribute('aria-modal'); removeEventListener('resize', pvFit); window.flOverlay?.close(card, { focus: false }) }
    pvControls(); if (!PV.panes.length) pvStart(); else pvFit();
    const b = card.querySelector('[data-pvfull]'); (on ? b : (PV.back?.isConnected ? PV.back : b))?.focus({ preventScroll: !on });
  }
  document.addEventListener('keydown', ev => {
    if (!PV.full) return; const card = document.querySelector('.pv-card.full'); if (!card) return;
    if (ev.key === 'Escape') { ev.preventDefault(); pvFull(false); return }
    if (ev.key !== 'Tab') return;
    const f = [...card.querySelectorAll('button:not([disabled]),select,input,[tabindex="0"]')].filter(e => e.offsetParent !== null); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus() } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
    else if (!card.contains(document.activeElement)) { ev.preventDefault(); first.focus() }
  });

  document.addEventListener('click', ev => {
    if (ev.target.closest?.('[data-pvfull]')) { pvFull(!PV.full); return }
    const t = ev.target.closest?.('[data-pvtheme],[data-pvpage],[data-pvdevice]'); if (!t) return;
    if (t.dataset.pvtheme) PV.theme = t.dataset.pvtheme; else if (t.dataset.pvpage) PV.page = t.dataset.pvpage; else PV.device = t.dataset.pvdevice;
    const key = ['pvtheme', 'pvpage', 'pvdevice'].find(k => t.dataset[k]), val = t.dataset[key];
    pvControls(); if (PV.panes.length) pvSync(); else pvStart();
    document.querySelector(`[data-${key}="${CSS.escape(val)}"]`)?.focus({ preventScroll: true });
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.matches?.('[data-pvcmp]')) { PV.cmp = t.value; pvControls(); if (PV.panes.length) pvSync(); else pvStart(); document.querySelector('[data-pvcmp]')?.focus({ preventScroll: true }) }
    else if (t.matches?.('[data-pvscores]')) { PV.scores = t.checked; PV.panes.forEach(pvSay) }
  });

  /* inside a preview frame: follow the messages, ignore the pointer and keyboard, save nothing, and say when it is drawn */
  if (window.FL_PREVIEW) {
    const go = page => { try { if (page === 'home') window.flHub?.show(); else window.flPages?.show(page, undefined, { fromHash: true }) } catch (e) {} };
    const first = (/[?&]flpage=([a-z]+)/.exec(location.search) || [])[1] || 'home'; let at = first;
    const drawn = () => { try { parent.postMessage({ flPreviewReady: true }, location.origin) } catch (e) {} };
    addEventListener('load', () => setTimeout(() => {
      go(first);
      if (window.flHub?.games?.()?.length) setTimeout(drawn, 120); else { document.addEventListener('fl:hub', () => setTimeout(drawn, 120), { once: true }); setTimeout(drawn, 5000) }
    }, 0));
    addEventListener('message', ev => { if (ev.origin !== location.origin || ev.source !== window.parent) return; const m = ev.data?.flPreview; if (!m) return;
      if (m.theme && Object.prototype.hasOwnProperty.call(T, m.theme) && m.theme !== current()) window.flApplyTheme(m.theme);
      if ('scores' in m) window.flMC?.previewScores?.(m.scores);
      if (m.page && m.page !== at && PAGES.some(p => p[0] === m.page)) { at = m.page; go(m.page) } });
    for (const type of ['click', 'submit', 'dblclick', 'contextmenu', 'keydown', 'pointerdown', 'mousedown']) addEventListener(type, ev => { if (type === 'keydown' && /^(Arrow|Page|Home|End| )/.test(ev.key)) return; ev.preventDefault(); ev.stopImmediatePropagation() }, true);
  }


  /* ---------- the page is six tabs; one shows at a time ---------- */
  const TABS = [['appearance', 'Appearance'], ['alerts', 'Alerts'], ['home', 'Home'], ['data', 'Data'], ['access', 'Accessibility'], ['advanced', 'Advanced']];
  const ST = { tab: 'appearance' };
  const tabOf = a => a === 'theme' ? 'appearance' : TABS.some(t => t[0] === a) ? a : null;
  const row = (id, label, help, on) => `<div class="st-row"><div class="st-l"><label for="${id}">${label}</label><small>${help}</small></div><div class="st-c"><input class="sw" type="checkbox" role="switch" id="${id}" ${on ? 'checked' : ''}></div></div>`;
  function panel(tab) {
    const cur = current(), p = prefs(), si = sizeIndex(), br = root.dataset.bright || '';
    const head = (id, t) => `<div class="st-h"><h2 id="${id}">${t}</h2><span class="st-saved" id="stSaved" role="status" aria-live="polite"></span></div>`;
    if (tab === 'alerts') return window.flAlerts?.card() || '<div class="card emp"><b>Alerts are not available here</b></div>';
    if (tab === 'home') return window.flOnboard?.settingsCard() || '<div class="card emp"><b>Home setup is not available here</b></div>';
    if (tab === 'data') return `<section class="card feature st-card" aria-labelledby="stDataH">${head('stDataH', 'Data')}
        <div class="st-rows">${row('stSaver', 'Data saver', 'Live scores, Home and the match centre refresh every 2 minutes instead of every 30 seconds. Uses less data and battery. Kept on this device.', look().saver)}</div></section>`;
    if (tab === 'access') return `<section class="card feature st-card" aria-labelledby="stAccH">${head('stAccH', 'Accessibility')}
        <div class="st-rows">${row('prefMotion', 'Reduce motion', 'Turns off pulsing, flicker and grow-in animations.', p.motion)}${row('prefContrast', 'High contrast', 'Stronger text and borders.', p.contrast)}${row('prefAlerts', 'Announce goals', 'Reads out a goal in a match you have open, for screen readers.', ls.get('fl.alerts', 'true') !== 'false')}</div></section>`;
    // every reset lives here, away from the settings it undoes: one part at a time, or everything (asked once)
    if (tab === 'advanced') return `<section class="card st-card st-reset" aria-labelledby="stPartH">${head('stPartH', 'Reset one part')}
        <p class="lb">Each button puts one group back to how it started, straight away. Nothing else changes.</p>
        <div class="st-resets">
          <div class="st-rs"><div><b>Text size and brightness</b><small>Back to normal size and the theme’s own brightness.</small></div><button type="button" class="bt ghost sm" data-streset="look">Reset text size and brightness</button></div>
          <div class="st-rs"><div><b>Accessibility</b><small>Motion and contrast back to normal; goal announcements back on.</small></div><button type="button" class="bt ghost sm" data-streset="access">Reset accessibility</button></div>
          ${window.flAlerts ? `<div class="st-rs"><div><b>Alerts</b><small>Alerts off and every alert choice back to its default.</small></div><button type="button" class="bt ghost sm" data-streset="alerts">Reset alerts</button></div>` : ''}
        </div></section>
      <section class="card st-card st-reset" aria-labelledby="stResetH">${head('stResetH', 'Restore all defaults')}
        <p class="lb">Puts the theme, text size, brightness, motion, contrast, alerts and data saver on this device back to how they started. Teams you follow, your watchlist and saved slips are kept.</p>
        ${RESET.confirm ? `<div class="st-confirm" role="group" aria-label="Confirm"><b>Restore every setting on this page?</b><button type="button" class="bt sm" data-streset="all-yes">Restore defaults</button><button type="button" class="bt ghost sm" data-streset="all-no">Keep my settings</button></div>`
          : '<div><button type="button" class="bt ghost sm" data-streset="all">Restore all defaults…</button></div>'}</section>`;
    return `<div class="card feature st-card">
        ${head('stThemeH', 'Theme')}
        <p class="lb st-favnote"><span>Have more than one you like? Star them on your profile and switch between them from the menu.</span> <button type="button" class="lk" data-page="profile" data-arg="themes">Star favorite themes</button></p>
        <div class="st-themes" role="radiogroup" aria-labelledby="stThemeH">
          ${THEMES.map(([id, name, desc]) => `<button type="button" class="st-theme${id === cur ? ' on' : ''}" role="radio" aria-checked="${id === cur}" tabindex="${id === cur ? 0 : -1}" data-theme-pick="${id}">
            ${preview(id)}<span class="st-tn">${esc(name)}<svg class="st-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="st-td">${esc(desc)}</span></button>`).join('')}
        </div>
        <div class="st-rows">
          <div class="st-row"><div class="st-l"><label for="stSize">Text size</label><small>Makes everything on the page larger or smaller.</small></div>
            <div class="st-c st-size"><span class="st-a" aria-hidden="true">A</span><input id="stSize" type="range" min="0" max="${SIZES.length - 1}" step="1" value="${si}" aria-valuetext="${sizeTxt(si)}"><span class="st-a big" aria-hidden="true">A</span><span class="chip st-val num" id="stSizeV">${sizeTxt(si)}</span></div></div>
          <div class="st-row"><div class="st-l"><span id="stBrL">Brightness</span><small>Dims or lifts the whole page without changing the theme.</small></div>
            <div class="st-c seg st-seg" role="radiogroup" aria-labelledby="stBrL">${BRIGHT.map(([v, l]) => `<button type="button" role="radio" aria-checked="${br === v}" class="${br === v ? 'on' : ''}" data-bright-pick="${v}">${l}</button>`).join('')}</div></div>
        </div>
      </div>`;
  }
  function render(el, arg) {
    const cur = current(), t = tabOf(arg); if (t) ST.tab = t;
    if (!el.querySelector('#stMain')) { pvStop(); el.innerHTML = `<div id="stMain" class="vst"></div><section class="card feature st-card pv-card" aria-labelledby="stPvH" hidden><div id="stPvCtl" class="vst"></div><div class="pv-stage" id="stPvStage"><button type="button" class="bt ghost" data-pvpage="${PV.page}">Show the live preview</button></div></section>
        <details class="card st-card drw st-a11y" id="stA11y" hidden><summary>Accessibility details <span class="lb">How readable each theme is</span></summary><div class="drw-b"><div id="stPvScores" class="pv-scores"></div></div></details>` }
    if (PV.theme == null) PV.theme = cur;
    pvControls();
    const signed = typeof S !== 'undefined' && S.me, tab = ST.tab;
    el.querySelector('#stMain').innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Settings</h1><p class="pg-sub">How Floodlight looks, reads and alerts you.</p></div>${window.flHelp ? `<div class="pg-acts">${flHelp.button('settings', 'Where your settings are kept')}</div>` : ''}</header>
      ${window.flHelp?.panel('settings', 'Where your settings are kept', `<p>${signed ? 'Your theme and favorite themes follow your account. Everything else here is kept on this device only.' : 'Everything here is kept on this device. Sign in and your theme follows you to other devices too.'}</p><p>A change applies at once and is saved. Nothing reloads.</p>`) || ''}
      <div class="st-tabs cx-row scroll" role="tablist" aria-label="Settings sections">${TABS.map(([k, n]) => `<button type="button" class="cx" role="tab" id="stTab-${k}" aria-selected="${k === tab}" aria-controls="stPanel" tabindex="${k === tab ? 0 : -1}" data-sttab="${k}">${n}</button>`).join('')}</div>
      <div class="st-panel vst" id="stPanel" role="tabpanel" aria-labelledby="stTab-${tab}">${panel(tab)}</div>`;
    const pv = el.querySelector('.pv-card'), a11y = el.querySelector('#stA11y');
    if (pv) { if (tab !== 'appearance' && !pv.hidden) pvReset(); pv.hidden = tab !== 'appearance' }
    if (a11y) a11y.hidden = tab !== 'access';
    const on = el.querySelector('[data-sttab][aria-selected="true"]'), bar = on?.parentElement; if (bar && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2);
  }
  // the live preview is taken down when its tab is left, and starts again from its button
  function pvReset() { pvStop(); const b = document.getElementById('stPvStage'); if (b) { b.classList.remove('two'); b.innerHTML = `<button type="button" class="bt ghost" data-pvpage="${PV.page}">Show the live preview</button>` } }
  function goTab(k, focus) {
    if (!TABS.some(t => t[0] === k) || k === ST.tab) return; ST.tab = k; RESET.confirm = false;
    const el = document.getElementById('pg-settings'); if (!el) return; render(el);
    try { history.replaceState(history.state, '', '#/settings/' + k) } catch (e) {}
    if (focus) el.querySelector(`#stTab-${k}`)?.focus();
    if (k === 'appearance') watchPv(el);
  }
  document.addEventListener('click', ev => { const t = ev.target.closest?.('[data-sttab]'); if (t) goTab(t.dataset.sttab, true) });
  document.addEventListener('keydown', ev => {
    const t = ev.target.closest?.('[data-sttab]'); if (!t || !/^Arrow(Left|Right)$|^Home$|^End$/.test(ev.key)) return;
    const n = TABS.length, i = TABS.findIndex(x => x[0] === t.dataset.sttab);
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : ev.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
    ev.preventDefault(); goTab(TABS[j][0], true);
  });
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
  document.addEventListener('input', ev => { if (ev.target.id !== 'stSize') return; const i = +ev.target.value; ev.target.setAttribute('aria-valuetext', sizeTxt(i)); document.getElementById('stSizeV').textContent = sizeTxt(i);
    if (typeof S !== 'undefined') { S.prefs.size = SIZES[i][0]; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs() } saved() });
  document.addEventListener('change', ev => { if (/^pref(Motion|Contrast|Alerts)$/.test(ev.target.id) && ev.target.closest('#pg-settings')) saved();
    if (ev.target.id === 'stSaver') { setLook({ saver: ev.target.checked }); saved() } });
  /* resets: one section, or every setting on the page (asked once, in place) */
  function resetLook() { if (typeof S !== 'undefined') { S.prefs.size = 1; S.prefs.motion = false; S.prefs.contrast = false; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs() } ls.set('fl.alerts', 'true'); setBright('') }
  document.addEventListener('click', ev => {
    const r = ev.target.closest?.('[data-streset]'); if (!r) return; const k = r.dataset.streset, el = document.getElementById('pg-settings');
    if (k === 'look') { if (typeof S !== 'undefined') { S.prefs.size = 1; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs() } setBright(''); saved(); return el?.querySelector('[data-streset="look"]')?.focus() }
    if (k === 'access') { if (typeof S !== 'undefined') { S.prefs.motion = false; S.prefs.contrast = false; try { localStorage.setItem('fl.prefs', JSON.stringify(S.prefs)) } catch {} typeof applyPrefs === 'function' && applyPrefs() } ls.set('fl.alerts', 'true'); sync(); saved(); return el?.querySelector('[data-streset="access"]')?.focus() }
    if (k === 'alerts') { window.flAlerts?.reset?.(); saved(); return el?.querySelector('[data-streset="alerts"]')?.focus() }
    if (k === 'all') { RESET.confirm = true; sync(); return el?.querySelector('[data-streset="all-yes"]')?.focus() }
    if (k === 'all-no') { RESET.confirm = false; sync(); return el?.querySelector('[data-streset="all"]')?.focus() }
    if (k === 'all-yes') { RESET.confirm = false; resetLook(); setLook({ saver: false }); window.flAlerts?.reset?.(); setTheme('night-match'); saved(); el?.querySelector('#stResetH')?.setAttribute('tabindex', '-1'); el?.querySelector('#stResetH')?.focus(); const s = document.getElementById('stSaved'); if (s) s.textContent = 'Defaults restored' }
  });

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
  function watchPv(el) {
    // the preview starts by itself once it scrolls into view, and is taken down when Settings is left
    if (!PV.panes.length && 'IntersectionObserver' in window) { const box = el.querySelector('#stPvStage'); if (box) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); if (window.flPages.current() === 'settings' && ST.tab === 'appearance') pvStart() } }, { rootMargin: '200px' }); io.observe(box) } }
  }
  function onShow(el, arg) {
    if (ST.tab === 'appearance') watchPv(el);
    if (arg !== 'theme') return; setTimeout(() => { el.querySelector('#stThemeH')?.scrollIntoView({ block: 'center' }); el.querySelector('[data-theme-pick][aria-checked="true"]')?.focus({ preventScroll: true }) }, 40) }
  window.flPages?.add('settings', { title: 'Settings', render, onShow, fresh: true, onHide: pvReset });
  document.addEventListener('fl:hub', () => { const el = document.getElementById('pg-settings'); if (el && !el.hidden && !el.querySelector('.thp.real') && sample() && !el.contains(document.activeElement)) sync() }, { once: false });
})();
