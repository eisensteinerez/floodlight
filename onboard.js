/* Floodlight · first-visit setup. Three short steps that make Home yours: the sports you follow, teams to follow,
   and a look. It fills the same preferences "Edit your Home" uses (home.js: favorite sports and followed teams) and the
   theme picker in Settings, so nothing here is a second copy of a setting.
   It shows once, on a first visit that lands on Home with nothing set up yet. Finishing or skipping it marks it done for
   good; Settings has "Set up Home again". Whatever was picked before a skip is kept. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'fl.onboarded';
  const done = () => { try { return !!localStorage.getItem(KEY) } catch { return true } };
  const mark = how => { try { localStorage.setItem(KEY, JSON.stringify({ how, at: Date.now() })) } catch {} };
  const O = { step: 0, sports: [], from: null, el: null };
  const SPORTS = [['soccer', 'Soccer'], ['football', 'Football'], ['basketball', 'Basketball'], ['baseball', 'Baseball'], ['hockey', 'Hockey'], ['tennis', 'Tennis'], ['ufc', 'UFC'], ['boxing', 'Boxing']];
  const STEPS = ['Your sports', 'Teams to follow', 'Your look'];
  const TEAM_SPORTS = new Set(['soccer', 'football', 'basketball', 'baseball', 'hockey']);

  /* teams on the board in the sports picked: today's games, or the day the board shows */
  function teams() {
    const out = new Map(), want = O.sports.filter(s => TEAM_SPORTS.has(s));
    for (const g of window.flHub?.games?.() || []) {
      if (!(want.length ? want.includes(g.sport) : TEAM_SPORTS.has(g.sport))) continue;
      for (const t of [g.a, g.b]) { if (!t?.id || !t.name) continue; const k = g.sport + ':' + t.id; if (!out.has(k)) out.set(k, { g, t, lg: g.short || g.lgName || g.sport }) }
    }
    // biggest leagues first, at most 16 teams from each, so one busy college slate does not crowd out the rest
    const by = new Map(); for (const x of [...out.values()].sort((x, y) => (y.g.weight || 0) - (x.g.weight || 0) || (x.t.full || x.t.name).localeCompare(y.t.full || y.t.name))) (by.get(x.lg) || by.set(x.lg, []).get(x.lg)).push(x);
    return [...by.values()].slice(0, 6).flatMap(xs => xs.slice(0, 16));
  }

  function body() {
    if (O.step === 0) return `<p class="obd-lead">Your sports come first on Home and in Live. Pick as many as you like.</p>
      <div class="cx-row obd-chips" role="group" aria-label="Sports">${SPORTS.map(([k, l]) => `<button type="button" class="cx" aria-pressed="${O.sports.includes(k)}" data-obsport="${k}">${esc(l)}</button>`).join('')}</div>`;
    if (O.step === 1) {
      const list = teams(), H = window.flHome;
      if (!list.length) return `<p class="obd-lead">Followed teams go to the top of Home, in “Your games”.</p><div class="obd-empty"><b>No games for ${O.sports.some(s => TEAM_SPORTS.has(s)) ? 'your sports' : 'team sports'} on today’s board.</b><p class="lb">You can follow a team later from any of its games: open the game and press Follow.</p></div>`;
      const by = new Map(); for (const x of list) (by.get(x.lg) || by.set(x.lg, []).get(x.lg)).push(x);
      return `<p class="obd-lead">Followed teams go to the top of Home, in “Your games”. These teams play today; you can follow others later from any game.</p>
        ${[...by].map(([lg, xs]) => `<div class="obd-grp" role="group" aria-label="${esc(lg)}"><span class="lb">${esc(lg)}</span><div class="cx-row obd-chips">${xs.map(x => { const on = !!H?.following(x.g, x.t);
          return `<button type="button" class="cx obd-team" aria-pressed="${on}" data-obteam="${esc(x.g.key)}|${esc(x.t.id)}">${x.t.logo ? `<img src="${esc(x.t.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async" onerror="this.remove()">` : ''}${esc(x.t.full || x.t.name)}</button>` }).join('')}</div></div>`).join('')}`;
    }
    const T = window.flTheme, cur = T?.get();
    return `<p class="obd-lead">Six looks, same scores. You can change it any time in Settings.</p>
      <div class="st-themes obd-themes" role="radiogroup" aria-label="Theme">${(T?.list || []).map(([id, name, desc]) => `<button type="button" class="st-theme${id === cur ? ' on' : ''}" role="radio" aria-checked="${id === cur}" tabindex="${id === cur ? 0 : -1}" data-obtheme="${id}">
        ${T.preview(id)}<span class="st-tn">${esc(name)}</span><span class="st-td">${esc(desc)}</span></button>`).join('')}</div>`;
  }
  function paint(focusSel) {
    const el = O.el; if (!el) return; const last = O.step === STEPS.length - 1;
    el.querySelector('.obd-card').innerHTML = `
      <header class="obd-head"><p class="lb obd-step" id="obStep">Step ${O.step + 1} of ${STEPS.length}</p><ol class="obd-dots" aria-hidden="true">${STEPS.map((_, i) => `<li class="${i <= O.step ? 'on' : ''}"></li>`).join('')}</ol>
        <h2 id="obTitle" tabindex="-1">${esc(['What do you follow?', 'Teams to follow', 'Pick a look'][O.step])}</h2></header>
      <div class="obd-body">${body()}</div>
      <footer class="obd-foot"><button type="button" class="lk obd-skip" data-ob="skip">Skip setup</button>
        <span class="obd-nav">${O.step ? '<button type="button" class="bt ghost" data-ob="back">Back</button>' : ''}<button type="button" class="bt" data-ob="${last ? 'finish' : 'next'}">${last ? 'Show me Home' : 'Next'}</button></span></footer>`;
    (focusSel ? el.querySelector(focusSel) : el.querySelector('#obTitle'))?.focus({ preventScroll: true });
  }
  function open(force, from) {
    if (O.el || (!force && done())) return false;
    O.step = 0; O.sports = [...(window.flHome?.mine?.().sports || [])]; O.from = from || document.activeElement;
    const el = document.createElement('div'); el.className = 'obd'; el.innerHTML = `<div class="obd-scrim"></div><section class="obd-card card" role="dialog" aria-modal="true" aria-labelledby="obTitle" aria-describedby="obStep"></section>`;
    document.body.appendChild(el); O.el = el; document.documentElement.classList.add('obd-on'); paint(); return true;
  }
  function close(how) {
    if (!O.el) return; mark(how);
    O.el.remove(); O.el = null; document.documentElement.classList.remove('obd-on');
    if (how === 'finished' && window.flHub?.show) window.flHub.show();
    (O.from && document.contains(O.from) ? O.from : document.querySelector('.tb-brand'))?.focus?.({ preventScroll: true });
  }

  document.addEventListener('click', ev => {
    if (!O.el || !O.el.contains(ev.target)) { const s = ev.target.closest?.('[data-obagain]'); if (s) open(true, s); return }
    const t = ev.target.closest('button'); if (!t) return; const d = t.dataset;
    if (d.obsport) { const k = d.obsport; O.sports = O.sports.includes(k) ? O.sports.filter(x => x !== k) : [...O.sports, k]; window.flHome?.setSports(O.sports); return paint(`[data-obsport="${k}"]`) }
    if (d.obteam) { const [key, id] = d.obteam.split('|'), x = teams().find(y => y.g.key === key && y.t.id === id); if (x) window.flHome?.follow(x.g, x.t); return paint(`[data-obteam="${CSS.escape(d.obteam)}"]`) }
    if (d.obtheme) { window.flTheme?.set(d.obtheme); return paint(`[data-obtheme="${d.obtheme}"]`) }
    if (d.ob === 'next') { O.step = Math.min(STEPS.length - 1, O.step + 1); return paint() }
    if (d.ob === 'back') { O.step = Math.max(0, O.step - 1); return paint() }
    if (d.ob === 'finish') return close('finished');
    if (d.ob === 'skip') return close('skipped');
  });
  document.addEventListener('keydown', ev => {
    if (!O.el) return;
    if (ev.key === 'Escape') { ev.preventDefault(); return close('skipped') }
    const th = ev.target.closest?.('[data-obtheme]');
    if (th && /^Arrow|^Home$|^End$/.test(ev.key)) { const all = [...th.parentElement.children], i = all.indexOf(th), n = all.length, j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : /Right|Down/.test(ev.key) ? (i + 1) % n : (i - 1 + n) % n; ev.preventDefault(); all[j].click(); return }
    if (ev.key !== 'Tab') return;   // keep focus inside the dialog
    const f = [...O.el.querySelectorAll('button:not([disabled]),[tabindex="0"],h2[tabindex]')].filter(x => x.offsetParent || x.id === 'obTitle'); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus() } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
  });
  document.addEventListener('fl:hub', () => { if (O.el && O.step === 1) { const a = document.activeElement?.dataset?.obteam; paint(a ? `[data-obteam="${CSS.escape(a)}"]` : null) } });

  /* first visit: landing on Home, nothing set up yet, not inside a theme preview or the Lab's embed */
  function maybe() {
    if (done() || window.top !== window || /[?&](flpreview|embed)=/.test(location.search) || location.hash) return;
    let has = false; try { has = (window.S?.fav || []).length || JSON.parse(localStorage.getItem('fl.favSports') || '[]').length || localStorage.getItem('fl.homeSkip') } catch {}
    if (has) return mark('had-setup');
    open();
  }
  if (document.readyState === 'complete') setTimeout(maybe, 1200); else addEventListener('load', () => setTimeout(maybe, 1200));

  const settingsCard = () => `<section class="card feature st-card" aria-labelledby="stObH"><p class="st-crumb">Settings › Home</p><div class="st-h"><h2 id="stObH">Home setup</h2></div>
    <div class="st-rows"><div class="st-row"><div class="st-l"><span>Set up Home again</span><small>Walks through your sports, teams to follow and a look. What you already have is kept.</small></div>
      <div class="st-c"><button type="button" class="bt ghost" data-obagain>Set up Home again</button></div></div></div></section>`;
  window.flOnboard = { open: () => open(true), done, settingsCard };
})();
