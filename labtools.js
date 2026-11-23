/* Floodlight · two Lab tools that live on the Lab page itself: Compare and Trends.
   Compare: two players side by side on the same stat. Choose a sport, put a player in each slot (search, or drag a
   player card onto a slot), and the numbers line up: average, median, how often each cleared their line, the last
   games as bars, and, on the nights both played, the two added together against a combined line (the old Combo).
   Presets answer the usual questions: every game, only the nights both played, and (for teammates) the games one
   played while the other sat.
   Trends: before a player is chosen, today's strongest trends from the posted lines: the longest runs over or under a
   line, and whose last five games are furthest from their last twenty. Each opens that player's trend view.
   Every number is counted from the games /api/lab/player returns; nothing is estimated here. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const fmt = v => v == null || isNaN(v) ? '–' : Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(name)}</span></span>`;
  const SPORTS = [['nba', 'NBA', 'basketball'], ['wnba', 'WNBA', 'basketball'], ['nfl', 'NFL', 'football'], ['nhl', 'NHL', 'hockey'], ['mlb', 'MLB', 'baseball'], ['soccer', 'Soccer', 'soccer']];
  const NAME = Object.fromEntries(SPORTS.map(s => [s[0], s[1]]));
  const WINDOWS = [[5, 'Last 5'], [10, 'Last 10'], [20, 'Last 20'], [0, 'This season']];
  const get = url => fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'It did not load.'); return d });
  const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
  const day = iso => String(iso).slice(0, 10);

  /* ---------------- Compare ---------------- */
  const C = { sport: 'nba', a: null, b: null, stat: '', win: 10, preset: 'all', lines: {}, sum: null, q: { a: '', b: '' }, hits: { a: null, b: null }, sel: { a: -1, b: -1 }, seq: 0, host: null, api: null };
  const slot = k => C[k];
  function load(k, name) {
    const seq = ++C.seq; C[k] = { name, loading: true }; draw();
    get(`/api/lab/player?sport=${encodeURIComponent(C.sport)}&name=${encodeURIComponent(name)}`)
      .then(d => { if (C[k]?.name !== name) return; C[k] = { name: d.name, d }; pickStat() })
      .catch(e => { if (C[k]?.name !== name) return; C[k] = { name, err: e.message || 'That player did not load.' } })
      .finally(() => { draw(); if (seq === C.seq) focusSlot(k) });
  }
  // the stat: the one asked for, else the one with a posted line for the first player, else the first both have
  function pickStat() {
    const A = C.a?.d, B = C.b?.d, has = (d, k) => !d || d.stats.some(s => s.k === k);
    if (C.stat && has(A, C.stat) && has(B, C.stat)) return;
    const posted = [...(A?.lines || []), ...(B?.lines || [])].map(l => l.k).find(k => has(A, k) && has(B, k));
    C.stat = posted || (A || B).stats.find(s => has(A, s.k) && has(B, s.k))?.k || '';
  }
  const statsBoth = () => { const A = C.a?.d, B = C.b?.d; if (!A && !B) return []; const base = (A || B).stats; return base.filter(s => (!A || A.stats.some(x => x.k === s.k)) && (!B || B.stats.some(x => x.k === s.k))) };
  const postedLine = (d, k) => { const ls = (d?.lines || []).filter(l => l.k === k); if (!ls.length) return null; const std = ls.find(l => l.kind === 'standard') || ls[0]; return std.line };
  const lineOf = k => { const d = C[k]?.d; if (!d) return null; const key = `${k}:${C.stat}`; return C.lines[key] ?? postedLine(d, C.stat) ?? null };
  const season = d => d.seasonStart ? d.seasonStart.slice(0, 10) : '';
  function gamesOf(k) {
    const d = C[k]?.d; if (!d) return [];
    let gs = d.games.filter(g => g.v[C.stat] != null);
    const other = C[k === 'a' ? 'b' : 'a']?.d, od = other ? new Set(other.games.filter(g => g.v[C.stat] != null).map(g => day(g.date))) : null;
    if (C.preset === 'both' && od) gs = gs.filter(g => od.has(day(g.date)));
    if (C.preset === 'without' && other) { const oall = new Set(other.games.map(g => day(g.date))); gs = gs.filter(g => !oall.has(day(g.date))) }
    if (!C.win) { const s = season(d); return s ? gs.filter(g => g.date >= s) : gs.slice(0, 82) }
    return gs.slice(0, C.win);
  }
  function summary(k) {
    const gs = gamesOf(k), vs = gs.map(g => g.v[C.stat]), line = lineOf(k);
    const scored = line == null ? [] : vs.filter(v => v !== line);
    return { gs, n: vs.length, avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, med: median(vs), line,
      over: line == null ? null : scored.filter(v => v > line).length, of: scored.length, last: vs[0] ?? null,
      hi: vs.length ? Math.max(...vs) : null, lo: vs.length ? Math.min(...vs) : null };
  }
  // the nights both played, added together: the old Combo
  function combined() {
    const A = C.a?.d, B = C.b?.d; if (!A || !B) return null;
    const bm = new Map(B.games.filter(g => g.v[C.stat] != null).map(g => [day(g.date), g]));
    let rows = A.games.filter(g => g.v[C.stat] != null && bm.has(day(g.date))).map(g => ({ date: g.date, a: g.v[C.stat], b: bm.get(day(g.date)).v[C.stat], opp: g.oppAbbr || g.opp }));
    if (!C.win) { const s = season(A); rows = s ? rows.filter(r => r.date >= s) : rows } else rows = rows.slice(0, C.win);
    const la = lineOf('a'), lb = lineOf('b'), line = C.sum ?? (la != null && lb != null ? la + lb : null);
    const sums = rows.map(r => r.a + r.b), scored = line == null ? [] : sums.filter(v => v !== line);
    return { rows, line, n: rows.length, avg: sums.length ? sums.reduce((x, y) => x + y, 0) / sums.length : null, over: line == null ? null : scored.filter(v => v > line).length, of: scored.length };
  }
  const sameTeam = () => C.a?.d && C.b?.d && C.a.d.team && C.a.d.team === C.b.d.team;

  // bars, newest on the right, each against the line; colour says over or under, the value is in the label and the table
  function bars(vals, line, label, W = 320) {
    if (!vals.length) return '';
    const H = W < 400 ? 124 : 150, P = 6, T = 20, B = 16, fs = W < 400 ? 9 : 12, max = Math.max(1, ...vals, line ?? 0) * 1.05;
    const step = (W - P * 2) / vals.length, bw = Math.max(4, Math.min(W < 400 ? 22 : 30, step - 4));
    const y = v => H - B - (v / max) * (H - T - B), ord = [...vals].reverse();
    return `<svg class="lc-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" style="font-size:${fs}px">
      ${line != null ? `<line x1="${W - P - fs * 7.2}" x2="${W - P - fs * 5.8}" y1="${fs * .7}" y2="${fs * .7}" class="ln"/><text x="${W - P}" y="${fs}" text-anchor="end" class="lt">Line ${fmt(line)}</text>` : ''}
      ${ord.map((v, i) => { const x = P + i * step + (step - bw) / 2, over = line != null && v > line, under = line != null && v < line;
        return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, H - B - y(v)).toFixed(1)}" rx="3" class="${over ? 'o' : under ? 'u' : 'e'}"><title>${fmt(v)}</title></rect>` }).join('')}
      ${line != null ? `<line x1="${P}" x2="${W - P}" y1="${y(line).toFixed(1)}" y2="${y(line).toFixed(1)}" class="ln"/>` : ''}
      <line x1="${P}" x2="${W - P}" y1="${H - B}" y2="${H - B}" class="ax"/><text x="${P}" y="${H - 3}" class="lt">Older</text><text x="${W - P}" y="${H - 3}" text-anchor="end" class="lt">Latest</text></svg>`;
  }
  function slotHTML(k) {
    const s = slot(k), lab = k === 'a' ? 'First player' : 'Second player';
    if (s?.d) { const d = s.d;
      return `<div class="card lc-slot full" data-cmpdrop="${k}"><span class="lb">${lab}</span><div class="lc-who">${face(d.photo, d.name, 'avx av-lg')}<span class="rw-t"><b>${esc(d.name)}</b><small>${[d.fid && window.flPlayers ? window.flPlayers.span(d.fid, d.team) : esc(d.team || ''), esc(d.pos || '')].filter(Boolean).join(' · ')}</small></span></div>
        <div class="lc-sa"><button type="button" class="bt ghost sm" data-cmp="change" data-k="${k}">Change</button><button type="button" class="lk" data-cmp="lab" data-k="${k}">Open in the Lab</button></div></div>` }
    const hits = C.hits[k];
    return `<div class="card lc-slot" data-cmpdrop="${k}"><label class="lb" for="lc-${k}">${lab}</label>
      ${s?.loading ? `<div class="lc-wait" role="status">${ic('search', 18)}Loading ${esc(s.name)}…</div>` : ''}
      <div class="lc-in"${s?.loading ? ' hidden' : ''}>${ic('search', 18)}<input class="inp" id="lc-${k}" type="search" role="combobox" aria-expanded="${!!hits?.length}" aria-controls="cmpl-${k}" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search ${esc(NAME[C.sport])} players" value="${esc(C.q[k])}"${C.sel[k] >= 0 ? ` aria-activedescendant="cmpo-${k}-${C.sel[k]}"` : ''}></div>
      <ul class="lc-list" id="cmpl-${k}" role="listbox" aria-label="${lab}: matches"${hits?.length ? '' : ' hidden'}>${(hits || []).map((h, i) => `<li role="option" id="cmpo-${k}-${i}" aria-selected="${i === C.sel[k]}" class="rw${i === C.sel[k] ? ' on' : ''}" data-cmppick="${k}|${i}">${face(h.img, h.name, 'avx av-sm')}<span class="rw-t"><b>${esc(h.name)}</b><small>${esc(h.sub || '')}</small></span></li>`).join('')}</ul>
      ${s?.err ? `<p class="lc-err" role="alert">${esc(s.err)}</p>` : `<p class="lb lc-hint">Or drag a player card here.</p>`}</div>`;
  }
  function resultHTML() {
    const A = C.a?.d, B = C.b?.d;
    if (!A || !B) return `<div class="lc-empty">${ic('compare', 22)}<p><b>${A || B ? 'Now add the second player' : 'Put a player in each slot'}</b><span>${A || B ? 'Their numbers will line up next to the first one’s.' : 'Search, or drag a card from “Start with tonight’s hottest” below. Then pick a stat.'}</span></p></div>`;
    const st = statsBoth(), label = st.find(s => s.k === C.stat)?.l || C.stat;
    if (!st.length) return `<p class="lc-err">These two players share no stat in their game logs. Pick players from the same sport.</p>`;
    const sa = summary('a'), sb = summary('b'), cb = combined();
    const rate = s => s.line == null ? '–' : s.of ? `${s.over} of ${s.of}` : '–';
    const tile = (d, s, k) => `<div class="lc-col"><div class="lc-h">${face(d.photo, d.name, 'avx')}<b>${esc(d.name)}</b></div>
      <dl class="lc-dl"><div><dt>Average</dt><dd class="num">${fmt(s.avg)}</dd></div><div><dt>Median</dt><dd class="num">${fmt(s.med)}</dd></div>
        <div><dt>Over the line</dt><dd class="num">${rate(s)}</dd></div><div><dt>Range</dt><dd class="num">${s.n ? `${fmt(s.lo)}–${fmt(s.hi)}` : '–'}</dd></div></dl>
      <label class="lc-line"><span class="lb">Line</span><input class="inp num" type="number" step="0.5" inputmode="decimal" data-cmpline="${k}" value="${s.line ?? ''}" placeholder="none" aria-label="${esc(d.name)}'s line for ${esc(label)}"></label>
      ${s.n ? bars(s.gs.map(g => g.v[C.stat]), s.line, `${d.name}, ${label}, ${s.n} games, newest on the right${s.line != null ? `. Over ${s.over} of ${s.of}` : ''}`) : `<p class="lc-none">No games match. Try “Every game” or a longer window.</p>`}
      <p class="lb">${s.n} ${s.n === 1 ? 'game' : 'games'}${postedLine(d, C.stat) != null && lineOf(k) === postedLine(d, C.stat) ? ' · posted line' : ''}</p></div>`;
    const within = C.win ? `over the last ${C.win} games` : 'this season';
    const scope = C.preset === 'both' ? `on the nights both played, ${within}` : C.preset === 'without' ? `when the other one sat, ${within}` : within;
    const none = C.preset === 'without' && (!sa.n || !sb.n);
    const lead = none
      ? `${!sa.n && !sb.n ? `${A.name} and ${B.name} played every game together` : !sa.n ? `${A.name} has played no game without ${B.name}` : `${B.name} has played no game without ${A.name}`}`
      : sa.avg != null && sb.avg != null ? (Math.abs(sa.avg - sb.avg) < 0.05 ? `${A.name} and ${B.name} are level at ${fmt(sa.avg)} ${label.toLowerCase()}` : `${sa.avg > sb.avg ? A.name : B.name} averages ${fmt(Math.abs(sa.avg - sb.avg))} more ${label.toLowerCase()}`) : '';
    const combo = cb && cb.n ? `<section class="lc-combo" aria-labelledby="cmpComboH"><div class="sec-h"><h3 id="cmpComboH">Together, on the nights both played</h3><span class="lb">${cb.n} ${cb.n === 1 ? 'night' : 'nights'}</span></div>
        <div class="lc-combo-r"><dl class="lc-dl"><div><dt>Combined average</dt><dd class="num">${fmt(cb.avg)}</dd></div><div><dt>Over the combined line</dt><dd class="num">${cb.line == null ? '–' : cb.of ? `${cb.over} of ${cb.of}` : '–'}</dd></div></dl>
          <label class="lc-line"><span class="lb">Combined line</span><input class="inp num" type="number" step="0.5" inputmode="decimal" data-cmpline="sum" value="${cb.line ?? ''}" placeholder="none" aria-label="Combined line"></label></div>
        ${bars(cb.rows.map(r => r.a + r.b), cb.line, `${A.name} plus ${B.name}, ${label}, ${cb.n} nights`, 720)}
        <details class="lc-tbl"><summary>See the nights</summary><div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col" class="r">${esc(A.name.split(' ').slice(-1)[0])}</th><th scope="col" class="r">${esc(B.name.split(' ').slice(-1)[0])}</th><th scope="col" class="r">Together</th></tr></thead>
          <tbody>${cb.rows.map(r => `<tr><td class="num">${esc(new Date(r.date).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</td><td>${esc(r.opp || '')}</td><td class="r num">${fmt(r.a)}</td><td class="r num">${fmt(r.b)}</td><td class="r num"><b>${fmt(r.a + r.b)}</b></td></tr>`).join('')}</tbody></table></div></details></section>`
      : cb ? `<p class="lb">${esc(A.name)} and ${esc(B.name)} have no ${esc(label.toLowerCase())} on the same night in these games, so there is no combined line.</p>` : '';
    return `<div class="lc-opts">
        <label class="lc-stat"><span class="lb">Stat</span><select class="inp" data-cmpstat>${st.map(s => `<option value="${esc(s.k)}"${s.k === C.stat ? ' selected' : ''}>${esc(s.l)}</option>`).join('')}</select></label>
        <div class="seg" role="radiogroup" aria-label="Games">${WINDOWS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${C.win === k}" class="${C.win === k ? 'on' : ''}" tabindex="${C.win === k ? 0 : -1}" data-cmpwin="${k}">${l}</button>`).join('')}</div>
        <div class="cx-row" role="radiogroup" aria-label="Which games">${[['all', 'Every game'], ['both', 'Only nights both played'], ...(sameTeam() ? [['without', 'When the other sat']] : [])].map(([k, l]) => `<button type="button" class="cx sm" role="radio" aria-checked="${C.preset === k}" data-cmppre="${k}">${l}</button>`).join('')}</div></div>
      ${lead ? `<p class="lc-lead"><b>${esc(lead)}</b> <span class="lb">${esc(none ? within : scope)}.</span></p>` : ''}
      <div class="lc-cols">${tile(A, sa, 'a')}${tile(B, sb, 'b')}</div>
      <div class="lc-key" aria-hidden="true"><span><i class="o"></i>Over the line</span><span><i class="u"></i>Under</span><span><i class="e"></i>On the line, or no line</span></div>
      ${combo}`;
  }
  function draw() {
    const h = C.host; if (!h || !document.contains(h)) return;
    const act = document.activeElement, keep = h.contains(act) ? (act.id || (act.dataset.cmpwin != null ? `[data-cmpwin="${act.dataset.cmpwin}"]` : act.dataset.cmppre ? `[data-cmppre="${act.dataset.cmppre}"]` : act.dataset.cmpline ? `[data-cmpline="${act.dataset.cmpline}"]` : act.matches('[data-cmpstat]') ? '[data-cmpstat]' : act.dataset.cmpsport ? `[data-cmpsport="${act.dataset.cmpsport}"]` : '')) : '';
    const caret = act?.selectionStart;
    h.innerHTML = `<div class="lc">
      <div class="lc-top"><div class="seg" role="radiogroup" aria-label="Sport">${SPORTS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${C.sport === k}" class="${C.sport === k ? 'on' : ''}" tabindex="${C.sport === k ? 0 : -1}" data-cmpsport="${k}">${l}</button>`).join('')}</div>
        ${C.a || C.b ? '<button type="button" class="lk" data-cmp="swap">Swap the two</button><button type="button" class="lk" data-cmp="clear">Start again</button>' : ''}</div>
      <div class="lc-slots">${slotHTML('a')}<span class="lc-vs" aria-hidden="true">v</span>${slotHTML('b')}</div>
      <div class="lc-res">${resultHTML()}</div></div>`;
    // one short spoken line when the answer changes, from a region that survives the redraw
    let sayEl = document.getElementById('lcSay'); if (!sayEl) { sayEl = document.createElement('p'); sayEl.id = 'lcSay'; sayEl.className = 'sr-only'; sayEl.setAttribute('role', 'status'); h.after(sayEl) }
    const line = h.querySelector('.lc-lead')?.textContent.trim() || '';
    if (line && sayEl.textContent !== line) sayEl.textContent = line;
    if (keep) { const el = keep.startsWith('[') ? h.querySelector(keep) : document.getElementById(keep); if (el) { el.focus({ preventScroll: true }); if (caret != null && el.setSelectionRange && el.type === 'search') try { el.setSelectionRange(caret, caret) } catch (e) {} } }
  }
  function focusSlot(k) { const h = C.host; if (!h) return; if (C[k]?.d) (h.querySelector(`[data-cmp="change"][data-k="${k}"]`))?.focus({ preventScroll: true }); else h.querySelector('#lc-' + k)?.focus({ preventScroll: true }) }
  // search a slot: tonight's players with a line in this sport first, then ESPN's player search for the sport
  const ESPN = 'https://site.api.espn.com/apis/common/v3/search', OK_LG = { nba: ['nba'], wnba: ['wnba'], nfl: ['nfl'], nhl: ['nhl'], mlb: ['mlb'] };
  let qT = 0;
  function find(k, q) {
    clearTimeout(qT); C.q[k] = q; const n = q.trim().toLowerCase();
    if (n.length < 2) { C.hits[k] = null; C.sel[k] = -1; return draw() }
    qT = setTimeout(async () => {
      const mine = [...new Map((window.flEdge?.all() || []).filter(p => p.sport === C.sport && p.name.toLowerCase().includes(n)).map(p => [p.name, { name: p.name, sub: [p.teamStatus === 'verified' ? p.teamName || p.team : '', 'line posted today'].filter(Boolean).join(' · '), img: p.photo }])).values()].slice(0, 4);
      let es = [];
      try { const sp = SPORTS.find(s => s[0] === C.sport)[2], d = await (typeof cj === 'function' ? cj : u => fetch(u).then(r => r.json()))(`${ESPN}?query=${encodeURIComponent(q.trim())}&type=player&sport=${sp}&limit=8`);
        es = (d.items || []).filter(x => C.sport === 'soccer' || (OK_LG[C.sport] || []).includes(x.league || x.defaultLeagueSlug)).map(x => ({ name: x.displayName, sub: [x.teamRelationships?.[0]?.displayName, x.isRetired ? 'retired' : ''].filter(Boolean).join(' · '), img: x.headshot?.href || '' })) } catch (e) {}
      if (C.q[k] !== q) return;
      const seen = new Set(), all = [...mine, ...es].filter(x => x.name && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase())).slice(0, 7);
      C.hits[k] = all.length ? all : [{ name: q.trim(), sub: `Look up “${q.trim()}” in ${NAME[C.sport]}`, img: '' }]; C.sel[k] = -1; draw();
    }, 200);
  }
  function put(k, name) { C.hits[k] = null; C.sel[k] = -1; C.q[k] = ''; load(k, name) }
  function wire(host) {
    if (host.dataset.cmpWired) return; host.dataset.cmpWired = 1;
    host.addEventListener('input', ev => { const t = ev.target;
      if (t.id === 'lc-a' || t.id === 'lc-b') return find(t.id.slice(-1), t.value);
      if (t.dataset.cmpline) { const v = t.value === '' ? null : +t.value; if (t.dataset.cmpline === 'sum') C.sum = v; else C.lines[`${t.dataset.cmpline}:${C.stat}`] = v; clearTimeout(t._t); t._t = setTimeout(draw, 350) } });
    host.addEventListener('change', ev => { if (ev.target.matches('[data-cmpstat]')) { C.stat = ev.target.value; C.sum = null; draw() } });
    host.addEventListener('keydown', ev => { const t = ev.target; if (t.id !== 'lc-a' && t.id !== 'lc-b') return; const k = t.id.slice(-1), hs = C.hits[k] || [];
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && hs.length) { ev.preventDefault(); C.sel[k] = ev.key === 'ArrowDown' ? (C.sel[k] + 1) % hs.length : (C.sel[k] - 1 + hs.length) % hs.length; return draw() }
      if (ev.key === 'Enter') { ev.preventDefault(); const h = hs[C.sel[k] >= 0 ? C.sel[k] : 0]; if (h) put(k, h.name); else if (t.value.trim().length > 1) put(k, t.value.trim()) }
      if (ev.key === 'Escape' && hs.length) { ev.preventDefault(); ev.stopPropagation(); C.hits[k] = null; draw() } });
    host.addEventListener('click', ev => { const t = ev.target;
      const pk = t.closest('[data-cmppick]'); if (pk) { const [k, i] = pk.dataset.cmppick.split('|'); const h = C.hits[k]?.[+i]; return h && put(k, h.name) }
      const sp = t.closest('[data-cmpsport]'); if (sp) { if (C.sport !== sp.dataset.cmpsport) { C.sport = sp.dataset.cmpsport; C.a = C.b = null; C.stat = ''; C.lines = {}; C.sum = null; C.hits = { a: null, b: null } } return draw() }
      const w = t.closest('[data-cmpwin]'); if (w) { C.win = +w.dataset.cmpwin; return draw() }
      const pr = t.closest('[data-cmppre]'); if (pr) { C.preset = pr.dataset.cmppre; return draw() }
      const b = t.closest('[data-cmp]'); if (!b) return; const a = b.dataset.cmp, k = b.dataset.k;
      if (a === 'change') { C[k] = null; C.sum = null; draw(); return focusSlot(k) }
      if (a === 'lab') return C.api?.openPlayer({ sport: C.sport, name: C[k].d.name, stat: C.stat, line: lineOf(k) });
      if (a === 'swap') { [C.a, C.b] = [C.b, C.a]; C.lines = Object.fromEntries(Object.entries(C.lines).map(([key, v]) => [key.replace(/^[ab]/, m => m === 'a' ? 'b' : 'a'), v])); return draw() }
      if (a === 'clear') { C.a = C.b = null; C.stat = ''; C.lines = {}; C.sum = null; draw(); return focusSlot('a') } });
    // drag a player card (anything with data-cmpdrag) onto a slot
    host.addEventListener('dragover', ev => { const z = ev.target.closest('[data-cmpdrop]'); if (!z || !ev.dataTransfer.types.includes('application/x-fl-player')) return; ev.preventDefault(); z.classList.add('over') });
    host.addEventListener('dragleave', ev => ev.target.closest?.('[data-cmpdrop]')?.classList.remove('over'));
    host.addEventListener('drop', ev => { const z = ev.target.closest('[data-cmpdrop]'); if (!z) return; ev.preventDefault(); z.classList.remove('over');
      try { const p = JSON.parse(ev.dataTransfer.getData('application/x-fl-player')); if (p.sport && p.sport !== C.sport && NAME[p.sport]) { C.sport = p.sport; C.a = C.b = null; C.stat = '' } if (p.stat) C.stat = p.stat; put(z.dataset.cmpdrop, p.name) } catch (e) {} });
  }
  function compare(host, o = {}, api) {
    C.host = host; C.api = api; wire(host);
    if (o.sport && NAME[o.sport] && o.sport !== C.sport) { C.sport = o.sport; C.a = C.b = null; C.stat = ''; C.lines = {} }
    if (o.stat) C.stat = o.stat;
    if (o.name && C.a?.name !== o.name) { C.b = null; load('a', o.name) } else draw();
    if (!o.name) setTimeout(() => focusSlot(C.a ? 'b' : 'a'), 80);
  }
  // any card with data-cmpdrag='{"sport","name","stat"}' can be dragged into Compare
  document.addEventListener('dragstart', ev => { const c = ev.target.closest?.('[data-cmpdrag]'); if (!c) return; ev.dataTransfer.setData('application/x-fl-player', c.dataset.cmpdrag); ev.dataTransfer.setData('text/plain', JSON.parse(c.dataset.cmpdrag).name || ''); ev.dataTransfer.effectAllowed = 'copy' });

  /* ---------------- Trends ---------------- */
  const T = { host: null, api: null, q: '' };
  function streak(p) {   // how many games in a row, newest first, on the side of the line the latest one landed
    const vs = (p.games || []).map(g => g.v).filter(v => v != null && v !== p.line); if (!vs.length) return null;
    const over = vs[0] > p.line; let n = 0; for (const v of vs) { if ((v > p.line) !== over) break; n++ }
    return { n, over };
  }
  function shift(p) {
    const vs = (p.games || []).map(g => g.v).filter(v => v != null); if (vs.length < 12) return null;
    const a5 = vs.slice(0, 5).reduce((a, b) => a + b, 0) / 5, a20 = vs.slice(0, 20).reduce((a, b) => a + b, 0) / Math.min(20, vs.length);
    return a20 ? { a5, a20, pct: (a5 - a20) / Math.max(1, Math.abs(a20)) } : null;
  }
  const spark = vs => { if (vs.length < 2) return ''; const W = 96, H = 26, max = Math.max(...vs), min = Math.min(...vs), r = max - min || 1, o = [...vs].reverse();
    return `<svg class="tr-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${o.map((v, i) => `${(i / (o.length - 1) * (W - 4) + 2).toFixed(1)},${(H - 3 - (v - min) / r * (H - 6)).toFixed(1)}`).join(' ')}"/></svg>` };
  function trendRow(p, note) {
    const args = window.flEdge.labArgs(p);
    return `<li><button type="button" class="tr-row" data-tropen="${esc(JSON.stringify({ ...args, mode: 'trend' }))}" draggable="true" data-cmpdrag="${esc(JSON.stringify({ sport: p.sport, name: p.name, stat: p.k }))}">${face(p.photo, p.name)}<span class="tr-t"><b>${esc(p.name)}</b><small>${p.fid || p.team ? (window.flPlayers ? window.flPlayers.span(p.fid, p.teamName || p.team) : esc(p.teamName || p.team || '')) + ' · ' : ''}${esc(`${p.label} · line ${fmt(p.line)}`)}</small></span>
      <span class="tr-r"><span class="tr-note">${note}</span>${spark((p.games || []).slice(0, 10).map(g => g.v).filter(v => v != null))}</span></button></li>`;
  }
  function trends(host, o = {}, api) {
    T.host = host; T.api = api;
    const picks = window.flEdge ? window.flEdge.all() : [], sport = o.sport;
    const pool = picks.filter(p => !p.yes && (!sport || p.sport === sport));
    const runs = pool.map(p => ({ p, s: streak(p) })).filter(x => x.s && x.s.n >= 4).sort((a, b) => b.s.n - a.s.n);
    const uniq = xs => { const seen = new Set(); return xs.filter(x => !seen.has(x.p.name) && seen.add(x.p.name)) };   // one row per player in each list
    const longRuns = uniq(runs).slice(0, 6);
    const moves = pool.map(p => ({ p, m: shift(p) })).filter(x => x.m && Math.abs(x.m.pct) >= 0.15).sort((a, b) => Math.abs(b.m.pct) - Math.abs(a.m.pct));
    const up = uniq(moves.filter(x => x.m.pct > 0)).slice(0, 5), down = uniq(moves.filter(x => x.m.pct < 0)).slice(0, 5);
    const loading = window.flEdge && !picks.length && !T.tried;
    const list = (title, sub, rows, note) => `<section class="card tr-card" aria-labelledby="tr-${title.replace(/\W+/g, '')}"><header><h3 id="tr-${title.replace(/\W+/g, '')}">${title}</h3><p class="lb">${sub}</p></header>
      ${rows.length ? `<ul class="tr-list">${rows.map(x => trendRow(x.p, note(x))).join('')}</ul>` : `<p class="lb">${loading ? 'Reading today’s lines…' : 'Nothing stands out here on today’s lines.'}</p>`}</section>`;
    host.innerHTML = `<div class="ltr">
      <form class="tr-ask card" data-trask><label class="lb" for="trQ">Trend for any player</label><div class="lc-in">${ic('search', 18)}<input class="inp" id="trQ" type="search" autocomplete="off" placeholder="Type a player’s name" value="${esc(T.q)}"><button class="bt sm" type="submit">Show the trend</button></div>
        <p class="lb">Or start from today’s lines below. Every trend opens that player’s games as a line, with the average and the posted line.</p></form>
      <div class="g3 tr-grid">
        ${list('Longest runs', 'Games in a row on one side of today’s line', longRuns, x => `<b class="num">${x.s.n}</b> straight ${x.s.over ? 'over' : 'under'}`)}
        ${list('Heating up', 'Last 5 games against the last 20', up, x => `<b class="num">${fmt(x.m.a5)}</b> <span class="lb">from ${fmt(x.m.a20)}</span>`)}
        ${list('Cooling off', 'Last 5 games against the last 20', down, x => `<b class="num">${fmt(x.m.a5)}</b> <span class="lb">from ${fmt(x.m.a20)}</span>`)}
      </div>
      <p class="lb">Counted from the games behind each posted line. A run says what happened, not what happens next.</p></div>`;
    if (!host.dataset.trWired) { host.dataset.trWired = 1;
      host.addEventListener('click', ev => { const r = ev.target.closest('[data-tropen]'); if (!r) return; let a = {}; try { a = JSON.parse(r.dataset.tropen) } catch (e) {} T.api?.openPlayer(a) });
      host.addEventListener('submit', ev => { if (!ev.target.matches('[data-trask]')) return; ev.preventDefault(); const q = $('trQ').value.trim(); T.q = q; if (q.length > 1) T.api?.openPlayer({ sport: o.sport || 'nba', name: q, mode: 'trend' }) });
    }
    if (loading && !T.waiting) { T.waiting = true; window.flEdge.props(null).catch(() => {}).finally(() => { T.waiting = false; T.tried = true; if (document.contains(host) && !host.hidden) trends(host, o, api) }) }
  }

  // a player card clicked while Compare is open: into the first empty slot (the keyboard way to do what dragging does)
  function add(p) {
    if (!C.host || !p?.name) return;
    if (p.sport && NAME[p.sport] && p.sport !== C.sport) { C.sport = p.sport; C.a = C.b = null; C.stat = ''; C.lines = {} }
    if (p.stat && !C.a && !C.b) C.stat = p.stat;
    const k = !C.a ? 'a' : !C.b ? 'b' : 'b'; put(k, p.name);
    C.host.closest('.lab-ws')?.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth', block: 'start' });
  }
  window.flLabTools = { compare, trends, add, state: C, _t: { streak, shift, summary, combined } };
})();
