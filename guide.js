/* Floodlight · "How to use Floodlight": one short section per area, each with a small working picture and a link
   to the real thing. Also holds What's new, Help and feedback, and the welcome tour.
   Nothing here reads match data. The pictures are drawn with the same shared pieces the real pages use. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const KEY = mac ? '⌘K' : 'Ctrl+K';
  const themes = () => window.flTheme?.list || [];

  /* ---------- the small pictures ---------- */
  const art = {
    live: () => `<div class="gd-score"><span class="pl live"><i></i>Live</span>
        <div class="gd-score-r"><span class="avx crest" aria-hidden="true">${ic('soccer', 20)}</span><b class="fig num">2</b><i>:</i><b class="fig num">1</b><span class="avx crest" aria-hidden="true">${ic('soccer', 20)}</span></div>
        <span class="lb">Home · Away · the clock runs on its own</span></div>`,
    lab: () => { const v = [14, 22, 9, 27, 18, 31, 12, 25], line = 20, max = 34;
      return `<div class="gd-bars" style="--line:${line / max * 100}%">${v.map(x => `<i class="${x > line ? 'ov' : 'un'}" style="height:${x / max * 100}%"></i>`).join('')}<span class="gd-line"><em>Line 20.5</em></span></div>
        <span class="lb">Sample bars: over the line is filled, under is outlined</span>` },
    heat: () => `<div class="gd-heat"><div id="gdMeter">${window.flHeat?.meter(72, { compact: true }) || ''}</div>
        <label class="fl-f gd-range"><span>Drag to see every level</span><input type="range" id="gdHeat" min="0" max="100" step="1" value="72" aria-valuetext="72, Heating up"></label></div>`,
    predictions: () => `<div class="gd-edge"><div class="gd-edge-r"><span class="lb">Our number</span><div class="trak"><i style="width:58%"></i></div><b class="num">58%</b></div>
        <div class="gd-edge-r"><span class="lb">Market</span><div class="trak mk"><i style="width:52%"></i></div><b class="num">52%</b></div>
        <div class="gd-edge-t"><span class="lb">Edge</span><b class="fig num">+6</b></div><span class="lb">A worked example, not a pick</span></div>`,
    transfers: () => `<div class="gd-move"><span class="avx crest" aria-hidden="true">${ic('profile', 20)}</span><span class="gd-move-a">${ic('arrow', 22)}</span><span class="avx crest" aria-hidden="true">${ic('profile', 20)}</span>
        <div class="gd-move-t"><span class="pl">Confirmed</span><span class="pl">Fee, when it is reported</span></div></div>`,
    profiles: () => `<div class="gd-prof"><span class="avx lg" aria-hidden="true">${ic('profile', 30)}</span><div><div class="gd-prof-l"><i></i><i></i></div>
        <div class="gd-prof-a">${ic('trophy', 22)}${ic('star', 22)}${ic('trophy', 22)}</div></div></div><span class="lb">Awards show only when we have a record of them</span>`,
    themes: () => `<div class="gd-themes" role="group" aria-label="Themes">${themes().map(([id, name]) => `<button type="button" class="gd-th" data-theme-pick="${id}" aria-pressed="${window.flTheme.get() === id}">
        <span class="gd-sw" data-theme-preview="${id}" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(name)}</span></button>`).join('')}</div>`,
  };

  /* ---------- the sections ---------- */
  const SECTIONS = [
    { id: 'live', title: 'Live scores', go: 'data-shell="live"', words: 'scores live match centre games tonight home refresh',
      text: `Home shows what is on tonight in every sport, and Live lists every game in play right now. Scores and clocks update on their own, so there is nothing to refresh. Open any game for its match centre: stats, lineups and play by play.` },
    { id: 'lab', title: 'The Lab', go: 'data-shell="lab"', words: 'lab research player team prop line search chart command bar hit rate',
      text: `The Lab is where you look up any player, team or prop. Type a name in the command bar, or press ${KEY} from anywhere, and you get their recent games as a chart with the line drawn across it. Move the line, switch the stat or pick an opponent to see how often it would have hit.` },
    { id: 'heat', title: 'Heat meter', go: 'data-shell="lab"', words: 'heat meter ice cold cool coin flip heating up on fire colour color 0 100',
      text: `The heat meter is one number from 0 to 100 for how a player is running against a line. Up to 19 is ice cold, 20 to 39 is cool, 40 to 59 is a coin flip, 60 to 79 is heating up, and 80 or more is on fire. It always shows the number, the label and an icon, so you never have to read it by color alone.` },
    { id: 'predictions', title: 'Predictions', go: 'data-shell="pred"', words: 'predictions edge market odds track record calibration slip picks',
      text: `Predictions ranks the picks where our number and the market disagree most. Edge is our chance minus the market’s chance: if we say 58% and the odds imply 52%, the edge is +6. The track record shows how often picks at each confidence level really hit, and it stays on the page when the results are bad. These are estimates, never guarantees.` },
    { id: 'transfers', title: 'Transfer window', go: 'data-shell="transfers"', words: 'transfers transfer window moves signings trades fee rumours rumors',
      text: `The transfer window lists confirmed moves, newest first. Choose a sport and a league, or search a club to see who came in and who left. Where a sport has no feed yet, the page says so instead of guessing.` },
    { id: 'profiles', title: 'Profiles and awards', go: 'data-guide="search"', goLabel: 'Search for a player', words: 'profile player fighter awards trophies champion career season belt',
      text: `Open any player or fighter to see this season, their career and their recent form on one page. Awards appear on a profile when we have a record of them. A reigning UFC or boxing champion gets a gold page.` },
    { id: 'themes', title: 'Themes and settings', go: 'data-page="settings" data-arg="theme"', words: 'themes settings night match team colors members club aurora glass chrono text size brightness motion contrast appearance',
      text: `Floodlight comes in five looks: Night Match, Team Colors, Members’ Club, Aurora Glass and Chrono. Choose one here or in Settings; it applies at once and follows your account. Text size, brightness, reduced motion and high contrast live in Settings too.` },
  ];
  const NEWS = [
    ['Five themes', 'Night Match, Team Colors, Members’ Club, Aurora Glass and Chrono. Choose yours in Settings. The old light and dark switch is now part of the themes.'],
    ['One menu for your account', 'The round button at the top right holds your profile, Settings, the theme, this guide and Sign out.'],
    ['Research is now the Lab', 'One place for every player, team and prop, with a command bar you can open from anywhere and boards you can save.'],
    ['The heat meter', 'A single ice-to-fire reading for how a player is running against a line.'],
    ['A new Home', 'The featured game, who is hot and who is cold, and everything live across sports.'],
    ['Predictions as an edge board', 'Picks ranked by how far our number is from the market, with an honest track record.'],
    ['Profiles, champions and transfers', 'Rebuilt player and fighter pages, a gold page for champions, and a transfer window that covers more sports.'],
  ];
  const FAQ = [
    ['A score looks late or wrong', 'Scores come from the leagues’ public feeds and refresh every few seconds while a game is live. If one is stuck, reload the page once. If it is still wrong, tell us below and name the game.'],
    ['I can’t open the Lab, Predictions or Transfers', 'Your admin chooses which services each member can use. Ask them to switch it on for you from the Members page.'],
    ['How do I change my name or favorite teams?', 'Open the round menu at the top right and choose Edit profile.'],
    ['How do I change how the site looks?', 'Open the menu, choose Theme and pick one of the five. Text size, brightness and motion are in Settings.'],
    ['What do “edge” and “heat” mean?', 'Edge is our chance minus the market’s chance for a pick. Heat is a 0 to 100 reading of how a player is running against a line. Both are explained in the sections above.'],
  ];

  function section(s, i) {
    return `<article class="card gd-sec${i % 2 ? ' flip' : ''}" id="gd-${s.id}" data-words="${esc((s.title + ' ' + s.words + ' ' + s.text).toLowerCase())}">
      <div class="gd-art tile inset" aria-hidden="${s.id === 'heat' || s.id === 'themes' ? 'false' : 'true'}">${art[s.id]()}</div>
      <div class="gd-tx"><h2>${esc(s.title)}</h2><p>${s.text}</p><button type="button" class="bt ghost" ${s.go}>${esc(s.goLabel || 'Take me there')}${ic('arrow', 18)}</button></div></article>`;
  }
  function render(el) {
    const me = (() => { try { return S.me } catch (e) { return null } })();
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">How to use <em>Floodlight</em></h1><p class="pg-sub">Seven short sections. Each one takes you to the real thing.</p></div>
        <button type="button" class="bt ghost" data-guide="tour">${ic('spark', 18)}Replay the welcome tour</button></header>
      <div class="gd-top"><label class="gd-search"><span class="sr-only">Search the guide</span>${ic('search', 18)}<input class="inp" type="search" id="gdQ" placeholder="Search the guide" autocomplete="off"></label>
        <nav class="cx-row scroll" aria-label="Guide sections">${SECTIONS.map(s => `<a class="cx sm" href="#gd-${s.id}" data-guide-jump="gd-${s.id}">${esc(s.title)}</a>`).join('')}
          <a class="cx sm" href="#gd-new" data-guide-jump="gd-new">What’s new</a><a class="cx sm" href="#gd-help" data-guide-jump="gd-help">Help and feedback</a></nav></div>
      <p class="lb" id="gdCount" role="status" aria-live="polite"></p>
      <div class="vst" id="gdList">${SECTIONS.map(section).join('')}</div>
      <div class="emp card" id="gdNone" hidden>${ic('search', 28)}<b>Nothing in the guide matches that</b><p>Try a shorter word, like “edge”, “theme” or “line”. Or ask us below.</p><button type="button" class="bt ghost" data-guide="clear">Clear the search</button></div>
      <section class="card gd-block" id="gd-new" tabindex="-1" data-words="${esc(('whats new what’s new changes update ' + NEWS.flat().join(' ')).toLowerCase())}"><div class="sec-h"><h2>What’s new</h2><span class="lb">The redesign</span></div>
        <ul class="gd-news">${NEWS.map(([t, d]) => `<li class="rw"><span class="rw-t gd-wrap"><b>${esc(t)}</b><small>${esc(d)}</small></span></li>`).join('')}</ul></section>
      <section class="card gd-block" id="gd-help" tabindex="-1" data-words="${esc(('help feedback question problem contact support ' + FAQ.flat().join(' ')).toLowerCase())}"><div class="sec-h"><h2>Help and feedback</h2></div>
        <div class="gd-help"><div class="gd-faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
          <form class="gd-form tile" id="gdForm" novalidate><label class="fl-f" for="gdMsg">Tell us what is broken, confusing or missing</label>
            <textarea class="inp" id="gdMsg" rows="4" maxlength="2000" placeholder="For example: the score for one game stopped updating." ${me ? '' : 'disabled'} aria-describedby="gdFormNote"></textarea>
            <p class="lb" id="gdFormNote" role="status" aria-live="polite">${me ? 'It goes to the people who run this Floodlight, with your member name.' : 'Sign in to send feedback, so we know who to answer.'}</p>
            ${me ? `<button class="bt" type="submit">Send feedback</button>` : `<button class="bt" type="button" data-guide="signin">Sign in</button>`}</form></div></section>`;
  }
  function jump(id, focus) { const t = document.getElementById(id); if (!t) return; t.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' }); if (focus) t.focus({ preventScroll: true }) }
  function onShow(el, arg) { if (arg === 'new' || arg === 'help') setTimeout(() => jump('gd-' + arg, true), 40); else if (arg) setTimeout(() => jump('gd-' + arg), 40) }
  function filter(q) {
    q = q.trim().toLowerCase(); const el = document.getElementById('pg-guide'); if (!el) return;
    const words = q.split(/\s+/).filter(Boolean); let n = 0;
    el.querySelectorAll('[data-words]').forEach(s => { const hit = !words.length || words.every(w => s.dataset.words.includes(w)); s.hidden = !hit; if (hit) n++ });
    document.getElementById('gdNone').hidden = n > 0;
    document.getElementById('gdCount').textContent = q ? (n ? `${n} section${n === 1 ? '' : 's'} match “${q}”` : '') : '';
  }

  document.addEventListener('input', ev => {
    if (ev.target.id === 'gdQ') return filter(ev.target.value);
    if (ev.target.id === 'gdHeat') { const v = +ev.target.value, box = document.getElementById('gdMeter'); if (!box || !window.flHeat) return;
      box.innerHTML = window.flHeat.meter(v, { compact: true }); ev.target.setAttribute('aria-valuetext', `${v}, ${window.flHeat.level(v).name}`) }
  });
  document.addEventListener('click', ev => {
    const j = ev.target.closest?.('[data-guide-jump]'); if (j) { ev.preventDefault(); return jump(j.dataset.guideJump, true) }
    const g = ev.target.closest?.('[data-guide]'); if (!g) return;
    const a = g.dataset.guide;
    if (a === 'tour') return tour.start(g);
    if (a === 'clear') { const q = document.getElementById('gdQ'); q.value = ''; filter(''); return q.focus() }
    if (a === 'signin') { try { S.prof.mode = 'login' } catch (e) {} return typeof openProfile === 'function' && openProfile() }
    if (a === 'search') { window.flPages?.hide(); const s = document.querySelector('header.top .search input'); const b = document.querySelector('.tb-search');
      if (s && s.offsetParent) s.focus(); else b?.click(); }
  });
  document.addEventListener('fl:theme', () => document.querySelectorAll('.gd-th').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePick === window.flTheme.get()))));
  document.addEventListener('fl:me', () => window.flPages?.redraw('guide'));
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'gdForm') return; ev.preventDefault();
    const box = document.getElementById('gdMsg'), note = document.getElementById('gdFormNote'), btn = ev.target.querySelector('button[type="submit"]'), text = box.value.trim();
    if (text.length < 5) { note.textContent = 'Write a sentence or two first, so we know what to look at.'; return box.focus() }
    btn.disabled = true; note.textContent = 'Sending…';
    try {
      const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ text, page: location.hash || location.pathname, theme: window.flTheme?.get?.() || '' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'It did not send.');
      box.value = ''; note.textContent = 'Sent. Thank you, an admin will read it.';
    } catch (e) { note.textContent = `${e.message || 'It did not send.'} Your text is still here, so try again in a minute.` }
    btn.disabled = false;
  });

  /* ---------- the welcome tour: five cards, one idea each ---------- */
  const STEPS = [
    { icon: 'home', title: 'Welcome to Floodlight', text: 'Every sport on one page. Home shows tonight’s featured game, who is hot and what is live.', go: 'data-shell="home"', label: 'Open Home' },
    { icon: 'lab', title: 'The Lab answers the question', text: `Look up any player, team or prop and see how often it would have hit. Press ${KEY} from anywhere to start typing.`, go: 'data-shell="lab"', label: 'Open the Lab' },
    { icon: 'bolt', title: 'Read the heat meter', text: 'One number from 0 to 100. Low is ice cold, the middle is a coin flip, high is on fire. It always comes with a label and an icon.', go: 'data-page="guide" data-arg="heat"', label: 'See every level' },
    { icon: 'pred', title: 'Predictions show the edge', text: 'Picks are ranked by how far our number is from the market. Edge is ours minus theirs, and the track record is always on the page.', go: 'data-shell="pred"', label: 'Open Predictions' },
    { icon: 'palette', title: 'Make it yours', text: 'Five themes, text size, brightness and motion are in Settings. The round menu at the top right holds your profile and this guide.', go: 'data-page="settings" data-arg="theme"', label: 'Choose a theme' },
  ];
  const tour = (() => {
    let box = null, i = 0, back = null;
    function draw() {
      const s = STEPS[i], last = i === STEPS.length - 1;
      box.innerHTML = `<div class="tour card feature" role="dialog" aria-modal="true" aria-labelledby="tourH" aria-describedby="tourP">
        <button type="button" class="ib tour-x" data-tour="close" aria-label="Close the tour">${ic('x', 18)}</button>
        <span class="tour-ic" aria-hidden="true">${ic(s.icon, 30)}</span>
        <p class="lb" aria-live="polite">Step ${i + 1} of ${STEPS.length}</p><h2 id="tourH" tabindex="-1">${esc(s.title)}</h2><p id="tourP">${esc(s.text)}</p>
        <div class="tour-dots" aria-hidden="true">${STEPS.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tour-b"><button type="button" class="bt ghost" data-tour="back" ${i ? '' : 'disabled'}>Back</button>
          <button type="button" class="bt ghost" data-tour="go" ${s.go}>${esc(s.label)}</button>
          <button type="button" class="bt" data-tour="${last ? 'close' : 'next'}">${last ? 'Done' : 'Next'}</button></div></div>`;
      box.querySelector('#tourH').focus();
    }
    function start(from) {
      back = from || document.activeElement; i = 0;
      if (!box) { box = document.createElement('div'); box.id = 'flTour'; box.className = 'tour-bg'; document.body.appendChild(box);
        box.addEventListener('click', ev => { const t = ev.target.closest('[data-tour]'); if (ev.target === box) return close();
          if (!t) return; const a = t.dataset.tour; if (a === 'next') { i++; draw() } else if (a === 'back') { i--; draw() } else close(a === 'go') });
        box.addEventListener('keydown', ev => {
          if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return close() }
          if (ev.key === 'ArrowRight' && i < STEPS.length - 1) { i++; return draw() }
          if (ev.key === 'ArrowLeft' && i) { i--; return draw() }
          if (ev.key !== 'Tab') return;
          const f = [...box.querySelectorAll('button:not([disabled])')], a = document.activeElement;
          if (ev.shiftKey && (a === f[0] || !box.contains(a) || a.id === 'tourH')) { ev.preventDefault(); f[f.length - 1].focus() }
          else if (!ev.shiftKey && a === f[f.length - 1]) { ev.preventDefault(); f[0].focus() }
        });
      }
      box.hidden = false; draw();
      try { localStorage.setItem('fl.tour', '1') } catch (e) {}
    }
    function close(leaving) { if (!box || box.hidden) return; box.hidden = true; if (!leaving) back?.focus?.() }
    return { start, close, seen: () => { try { return !!localStorage.getItem('fl.tour') } catch (e) { return true } } };
  })();
  // first visit after signing in (or on an open site): show the tour once
  let offered = false;
  function offer() { if (offered || tour.seen()) return; if (document.querySelector('.flg:not([hidden]),.modal:not([hidden]),[aria-modal="true"]:not([hidden])')) return; offered = true; tour.start(document.getElementById('flDots')) }
  document.addEventListener('fl:me', () => { try { if (S.me) setTimeout(offer, 900) } catch (e) {} });

  window.flTour = tour;
  window.flPages?.add('guide', { title: 'How to use Floodlight', render, onShow, fresh: true });
})();
