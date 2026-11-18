/* Floodlight · deep predictions for every sport, and the injury "what if".
   flPredDeep(o) wraps the shared prediction panel (predict.js) in the same five views soccer has:
   Verdict, Why, What if, Scorelines, Markets. A sport passes its model numbers and gets the views back.

   o = flPred options, plus
     model:   { kind:'normal', mean:[home, away], sd, unit:'points' }       (basketball, football, baseball)
              { kind:'poisson', mean:[lamHome, lamAway], unit:'goals', draw:true|false }  (soccer, hockey)
              { kind:'fit' }                                                  (tennis, boxing: fitness, not players)
     roster:  async () => ({ home:[{ name, share, note }], away:[…] })        share of the team's scoring, 0..1
     markets: [{ label, model, market, note }]
     scorelines: [{ label, p }]                                               optional, for set or method lists
     method:  one plain sentence on how the what-if is estimated

   How a player being out is estimated: the team's expected score drops by that player's share of the team's
   production times (1 - replacement). Replacement is set per sport (model.replace): the minutes still get played, by
   someone a little worse, so a 25-point scorer out costs an NBA team about 5 points, in line with typical on/off numbers.
   The win chance, projected score, spread and total are then recomputed from the adjusted means. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = p => Math.round((p || 0) * 100);
  const REPLACE = .45;
  const CFG = new Map();      // key -> latest options (functions cannot live in markup)
  const ST = new Map();       // key -> { out:Set, added:[{side,name,share}], fit:{home,away}, roster, loading, view }
  const store = { get(k) { try { return JSON.parse(localStorage.getItem('fl.wi.' + k) || 'null') } catch { return null } }, set(k, v) { try { localStorage.setItem('fl.wi.' + k, JSON.stringify(v)) } catch {} } };
  const st = k => { if (!ST.has(k)) { const s = store.get(k) || {}; ST.set(k, { out: new Set(s.out || []), added: s.added || [], fit: s.fit || { home: 100, away: 100 }, view: 'sum' }) } return ST.get(k) };
  const save = k => { const s = ST.get(k); store.set(k, { out: [...s.out], added: s.added, fit: s.fit }) };

  /* ---------- the maths ---------- */
  const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y };
  const phi = z => .5 * (1 + erf(z / Math.SQRT2));
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p };
  function outcome(m, mean) {
    if (m.kind === 'poisson') {
      let h = 0, d = 0, a = 0; const grid = [];
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = pois(i, mean[0]) * pois(j, mean[1]); grid.push([i, j, p]); if (i > j) h += p; else if (i === j) d += p; else a += p }
      grid.sort((x, y) => y[2] - x[2]);
      if (!m.draw) { h += d * mean[0] / (mean[0] + mean[1]); a += d * mean[1] / (mean[0] + mean[1]); d = 0 }   // ties go to OT/shootout
      return { pH: h, pD: m.draw ? d : null, pA: a, score: [grid[0][0], grid[0][1]], grid, margin: mean[0] - mean[1], total: mean[0] + mean[1] };
    }
    const margin = mean[0] - mean[1], pH = phi(margin / (m.sd || 12));
    return { pH, pA: 1 - pH, pD: null, score: [Math.round(mean[0]), Math.round(mean[1])], margin, total: mean[0] + mean[1] };
  }
  function adjusted(k) {
    const o = CFG.get(k), s = st(k), m = o.model; if (!m || m.kind === 'fit') return null;
    const R = s.roster || { home: [], away: [] }, lost = { home: 0, away: 0 }, names = [];
    for (const side of ['home', 'away']) {
      for (const p of R[side] || []) if (s.out.has(side + '|' + p.name)) { lost[side] += p.share; names.push(p.name) }
      for (const p of s.added) if (p.side === side) { lost[side] += p.share; names.push(p.name) }
    }
    const keep = m.replace ?? REPLACE, mean = [m.mean[0] * (1 - Math.min(.8, lost.home) * (1 - keep)), m.mean[1] * (1 - Math.min(.8, lost.away) * (1 - keep))];
    return { base: outcome(m, m.mean), now: outcome(m, mean), mean, names };
  }
  // individual sports: fitness moves the win chance on the log-odds scale (each 10% below full fitness ~ -0.45)
  function fitAdjusted(k) {
    const o = CFG.get(k), s = st(k), p0 = o.probs.home, lo = Math.log(p0 / (1 - p0)) - (100 - s.fit.home) * .045 + (100 - s.fit.away) * .045, p = 1 / (1 + Math.exp(-lo));
    return { p0, p, changed: s.fit.home !== 100 || s.fit.away !== 100 };
  }

  /* ---------- views ---------- */
  const VIEWS = [['sum', 'Verdict'], ['why', 'Why'], ['wi', 'What if'], ['sc', 'Scorelines'], ['mk', 'Markets']];
  function nav(k) { const v = st(k).view; return `<div class="pv-nav" role="tablist" aria-label="Prediction views">${VIEWS.map(([id, l]) => `<button role="tab" aria-selected="${v === id}" class="${v === id ? 'on' : ''}" data-wiview="${id}" data-wik="${esc(k)}">${l}</button>`).join('')}</div>` }
  function whyView(o) {
    const f = o.factors || [];
    return `<div class="wx-why">${f.length ? f.map(x => `<div class="pr-f${x.side ? ' ' + x.side : ''}"><span class="pr-fi">${flPred.ico(x.ico)}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></div>`).join('') : '<p class="wx-note">No factors stand out for this one.</p>'}
      ${o.methodWhy ? `<p class="wx-note">${esc(o.methodWhy)}</p>` : ''}</div>`;
  }
  function wiResult(k) {
    const o = CFG.get(k), s = st(k), A = adjusted(k), unit = o.model.unit || 'points', H = o.home.short || o.home.name, W = o.away.short || o.away.name;
    if (!A) return '';
    const d = (x, y) => { const v = x - y; return Math.abs(v) < .05 ? '' : ` <em class="${v > 0 ? 'up' : 'dn'}">${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(unit === 'goals' || unit === 'runs' ? 2 : 1)}</em>` };
    const pd = (x, y) => { const v = Math.round((x - y) * 100); return v ? ` <em class="${v > 0 ? 'up' : 'dn'}">${v > 0 ? '+' : '−'}${Math.abs(v)}</em>` : '' };
    const n = A.now, b = A.base;
    return `<div class="wx-res" aria-live="polite">${A.names.length ? `<p class="wx-badge">Adjusted for: ${esc(A.names.join(', '))} out <button class="linkbtn" data-wireset="${esc(k)}">Reset</button></p>` : '<p class="wx-badge off">Mark players out to see the prediction move.</p>'}
      <div class="wx-grid">
        <div><small>${esc(H)} win</small><b class="num">${pc(n.pH)}%</b>${pd(n.pH, b.pH)}</div>
        ${n.pD != null ? `<div><small>Draw</small><b class="num">${pc(n.pD)}%</b>${pd(n.pD, b.pD)}</div>` : ''}
        <div><small>${esc(W)} win</small><b class="num">${pc(n.pA)}%</b>${pd(n.pA, b.pA)}</div>
        <div><small>Projected ${esc(unit)}</small><b class="num">${A.mean[0].toFixed(1)}–${A.mean[1].toFixed(1)}</b></div>
        <div><small>Spread</small><b class="num">${esc(n.margin >= 0 ? H : W)} −${Math.abs(n.margin).toFixed(1)}</b>${d(Math.abs(n.margin), Math.abs(b.margin))}</div>
        <div><small>Total</small><b class="num">${n.total.toFixed(1)}</b>${d(n.total, b.total)}</div></div></div>`;
  }
  function wiView(k) {
    const o = CFG.get(k), s = st(k), m = o.model;
    if (!m) return '<p class="wx-note">No model numbers for this game yet.</p>';
    if (m.kind === 'fit') {
      const F = fitAdjusted(k), H = o.home.name, W = o.away.name;
      return `<div class="wx"><p class="wx-lead">Not fully fit? Set how close to 100% each side is and the win chance moves.</p>
        ${['home', 'away'].map(side => `<label class="wx-fit"><span>${esc(o[side].name)}</span><input type="range" min="60" max="100" step="5" value="${s.fit[side]}" data-wifit="${side}" data-wik="${esc(k)}" aria-label="${esc(o[side].name)} fitness"><b class="num">${s.fit[side]}%</b></label>`).join('')}
        <div class="wx-res" aria-live="polite">${F.changed ? `<p class="wx-badge">Adjusted for fitness <button class="linkbtn" data-wireset="${esc(k)}">Reset</button></p>` : ''}<div class="wx-grid"><div><small>${esc(H)} win</small><b class="num">${pc(F.p)}%</b></div><div><small>${esc(W)} win</small><b class="num">${pc(1 - F.p)}%</b></div><div><small>Before</small><b class="num">${pc(F.p0)}–${pc(1 - F.p0)}</b></div></div></div>
        <p class="wx-note">Each 10% below full fitness takes about 10 points of win chance off an even match, less at the extremes. A rough guide, not a medical report.</p></div>`;
    }
    if (!s.roster && !s.loading && o.roster) { s.loading = true; o.roster().then(r => { s.roster = r || { home: [], away: [] } }).catch(() => { s.roster = { home: [], away: [] }; s.err = true }).finally(() => { s.loading = false; repaint(k) }) }
    const R = s.roster;
    const col = side => { const list = (R?.[side] || []).slice(0, 10), extra = s.added.filter(p => p.side === side);
      return `<section class="wx-team"><h6>${esc(o[side].name)}</h6>
        ${!R ? '<div class="skel" style="height:180px"></div>' : list.length ? `<ul>${list.map(p => { const id = side + '|' + p.name, on = s.out.has(id);
          return `<li><button class="wx-p${on ? ' out' : ''}" aria-pressed="${on}" data-wiout="${esc(id)}" data-wik="${esc(k)}"><span><b>${esc(p.name)}</b><small>${esc(p.note || '')}</small></span><em class="num">${pc(p.share)}%</em><i>${on ? 'Out' : 'Playing'}</i></button></li>` }).join('')}</ul>` : `<p class="wx-note">${s.err ? 'Player numbers did not load. Add players by hand below.' : 'No player numbers for this team yet. Add players by hand below.'}</p>`}
        ${extra.map((p, i) => `<p class="wx-added"><b>${esc(p.name)}</b> out · ${pc(p.share)}% of scoring <button class="linkbtn" data-widel="${esc(side + '|' + p.name)}" data-wik="${esc(k)}">Remove</button></p>`).join('')}
        <form class="wx-add" data-wiadd="${side}" data-wik="${esc(k)}"><input name="n" placeholder="Player out…" autocomplete="off" aria-label="Name of a ${esc(o[side].name)} player who is out" required>
          <select name="s" aria-label="How big a part of the team's scoring"><option value=".25">Star (25%)</option><option value=".15" selected>Starter (15%)</option><option value=".07">Rotation (7%)</option><option value=".03">Bench (3%)</option></select><button class="btn ghost">Add</button></form></section>` };
    return `<div class="wx"><p class="wx-lead">Mark anyone who is out. The prediction recalculates straight away.</p>${wiResult(k)}<div class="wx-teams">${col(o.flip ? 'away' : 'home')}${col(o.flip ? 'home' : 'away')}</div>
      <p class="wx-note">${esc(o.method || `How it's estimated: each player's share of the team's ${m.unit || 'points'} this season. When someone is out, the team keeps ${Math.round((m.replace ?? REPLACE) * 100)}% of that (someone else plays the minutes), and the win chance, score, spread and total are recomputed from there.`)}</p></div>`;
  }
  function scView(k) {
    const o = CFG.get(k), m = o.model;
    if (o.scorelines?.length) { const mx = Math.max(...o.scorelines.map(x => x.p));
      return `<div class="wx-sc"><p class="wx-lead">The likeliest results</p>${o.scorelines.map(x => `<div class="wx-bar"><span>${esc(x.label)}</span><i><em style="width:${(x.p / mx * 100).toFixed(0)}%"></em></i><b class="num">${pc(x.p)}%</b></div>`).join('')}</div>` }
    if (!m || m.kind === 'fit') return '<p class="wx-note">No score model for this one.</p>';
    const A = adjusted(k) || { now: outcome(m, m.mean), mean: m.mean }, H = o.home.short || o.home.name, W = o.away.short || o.away.name;
    if (m.kind === 'poisson') { const top = A.now.grid.slice(0, 8), mx = top[0][2];
      return `<div class="wx-sc"><p class="wx-lead">The likeliest exact scores</p>${top.map(([i, j, p]) => `<div class="wx-bar"><span>${esc(H)} ${i}–${j} ${esc(W)}</span><i><em style="width:${(p / mx * 100).toFixed(0)}%"></em></i><b class="num">${(p * 100).toFixed(1)}%</b></div>`).join('')}</div>` }
    // margin and total bands from the normal model
    const sd = m.sd || 12, mg = A.mean[0] - A.mean[1], tot = A.mean[0] + A.mean[1], tsd = m.totSd || sd * 1.1, step = m.step || (sd > 8 ? 5 : 1);
    const band = (mu, s, lo, hi) => phi((hi - mu) / s) - phi((lo - mu) / s);
    const mb = []; for (let x = -3 * step; x <= 3 * step; x += step) mb.push([x, band(mg, sd, x - step / 2, x + step / 2)]);
    const tb = []; const t0 = Math.round(tot / step) * step; for (let x = t0 - 3 * step; x <= t0 + 3 * step; x += step) tb.push([x, band(tot, tsd, x - step / 2, x + step / 2)]);
    const bars = (list, lab) => { const mx = Math.max(...list.map(x => x[1])); return list.map(([x, p]) => `<div class="wx-bar"><span>${esc(lab(x))}</span><i><em style="width:${(p / mx * 100).toFixed(0)}%"></em></i><b class="num">${pc(p)}%</b></div>`).join('') };
    return `<div class="wx-sc"><p class="wx-lead">Winning margin</p>${bars(mb, x => x === 0 ? 'Within ' + step / 2 : x > 0 ? `${H} by ~${x}` : `${W} by ~${-x}`)}
      <p class="wx-lead">Total ${esc(m.unit || 'points')}</p>${bars(tb, x => `About ${x}`)}<p class="wx-note">Spread of outcomes from the model's typical miss (±${sd.toFixed(1)} on the margin).</p></div>`;
  }
  function mkView(k) {
    const o = CFG.get(k), rows = (o.markets || []).filter(r => r.model != null || r.market != null);
    if (!rows.length) return '<p class="wx-note">No market prices for this game yet.</p>';
    return `<div class="wx-mk"><table><thead><tr><th scope="col">Market</th><th scope="col" class="r">Model</th><th scope="col" class="r">Books</th><th scope="col" class="r">Gap</th></tr></thead><tbody>
      ${rows.map(r => { const g = typeof r.model === 'number' && typeof r.market === 'number' ? r.model - r.market : null;
        return `<tr><td>${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</td><td class="r num">${esc(r.fmt ? r.fmt(r.model) : r.model ?? '–')}</td><td class="r num">${esc(r.fmt ? r.fmt(r.market) : r.market ?? '–')}</td><td class="r num ${g == null ? '' : Math.abs(g) >= (r.edge || .04) ? 'big' : ''}">${g == null ? '–' : (g > 0 ? '+' : '−') + (r.fmt ? r.fmt(Math.abs(g)).replace(/%$/, ' pts') : Math.abs(g).toFixed(1))}</td></tr>` }).join('')}</tbody></table>
      <p class="wx-note">A gap is where the model and the books disagree. It is not a bet recommendation.</p></div>`;
  }
  function body(k) {
    const o = CFG.get(k), v = st(k).view;
    if (v === 'why') return whyView(o); if (v === 'wi') return wiView(k); if (v === 'sc') return scView(k); if (v === 'mk') return mkView(k);
    return '';
  }
  function repaint(k) { document.querySelectorAll('.wx-host').forEach(el => { if (el.dataset.k === k) { const s = st(k); el.dataset.view = s.view; el.querySelector('.wx-body').innerHTML = body(k); el.querySelectorAll('[data-wiview]').forEach(b => { const on = b.dataset.wiview === s.view; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) }); const badge = el.querySelector('.wx-flag'); if (badge) badge.innerHTML = flag(k) } }) }
  function flag(k) { const A = CFG.get(k)?.model?.kind === 'fit' ? null : adjusted(k); return A?.names?.length ? `<button class="wx-chip" data-wiview="wi" data-wik="${esc(k)}">What if: ${esc(A.names.length === 1 ? A.names[0] : A.names.length + ' players')} out · ${pc(A.now.pH)}% for ${esc(CFG.get(k).home.short || CFG.get(k).home.name)}</button>` : '' }

  window.flPredDeep = function (o) {
    const k = o.key || Math.random().toString(36).slice(2); CFG.set(k, o); const s = st(k);
    const verdict = flPred({ ...o, factors: [] });
    return `<div class="wx-host" data-k="${esc(k)}" data-view="${s.view}">${nav(k)}<div class="wx-flag">${flag(k)}</div><div class="wx-sum">${verdict}</div><div class="wx-body">${body(k)}</div></div>`;
  };
  window.flPredDeep.outcome = outcome;
  window.flPredDeep.whatIfOnly = function (o) { const k = o.key; CFG.set(k, o); st(k).view = 'wi'; return `<div class="wx-host" data-k="${esc(k)}" data-view="wi"><div class="wx-body">${wiView(k)}</div></div>` };

  /* ---------- events ---------- */
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-wiview],[data-wiout],[data-wireset],[data-widel]'); if (!t) return;
    const k = t.dataset.wik || t.dataset.wireset || t.closest('.wx-host')?.dataset.k; if (!k || !CFG.has(k)) return;
    ev.preventDefault(); ev.stopPropagation(); const s = st(k);
    if (t.dataset.wiview) s.view = t.dataset.wiview;
    else if (t.dataset.wiout) { s.out.has(t.dataset.wiout) ? s.out.delete(t.dataset.wiout) : s.out.add(t.dataset.wiout); save(k) }
    else if (t.dataset.widel) { const [side, name] = t.dataset.widel.split('|'); s.added = s.added.filter(p => !(p.side === side && p.name === name)); save(k) }
    else if (t.dataset.wireset) { s.out.clear(); s.added = []; s.fit = { home: 100, away: 100 }; save(k) }
    repaint(k);
  }, true);
  document.addEventListener('submit', ev => {
    const f = ev.target.closest?.('form[data-wiadd]'); if (!f) return; ev.preventDefault();
    const k = f.dataset.wik, s = st(k), name = f.n.value.trim().slice(0, 40); if (!name) return;
    s.added.push({ side: f.dataset.wiadd, name, share: +f.s.value }); save(k); repaint(k);
  });
  document.addEventListener('input', ev => {
    const r = ev.target.closest?.('[data-wifit]'); if (!r) return; const k = r.dataset.wik, s = st(k); s.fit[r.dataset.wifit] = +r.value; save(k);
    const host = r.closest('.wx-host'); const res = host?.querySelector('.wx-res'); r.nextElementSibling.textContent = r.value + '%';
    if (res) { const tmp = document.createElement('div'); tmp.innerHTML = wiView(k); res.replaceWith(tmp.querySelector('.wx-res')) }
  });

  /* ---------- rosters: each player's share of the team's production, from ESPN's league stat pages ---------- */
  const POOLS = new Map();
  async function espnPool(path, sorts) {
    const key = path + '|' + sorts.map(s => s[0]).join(','); if (POOLS.has(key)) return POOLS.get(key);
    const p = (async () => {
      const out = new Map();
      for (const [sort, pages] of sorts) for (let page = 1; page <= pages; page++) {
        const r = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&limit=200&page=${page}&sort=${encodeURIComponent(sort)}`);
        if (!r.ok) break; const d = await r.json();
        const names = Object.fromEntries((d.categories || []).map(c => [c.name, c.names]));
        for (const a of d.athletes || []) { const id = String(a.athlete?.id); if (out.has(id)) continue; const v = {};
          for (const c of a.categories || []) (names[c.name] || []).forEach((n, i) => { const x = parseFloat(String(c.totals?.[i] ?? '').replace(/,/g, '')); if (isFinite(x)) v[c.name + '.' + n] = x });
          out.set(id, { id, name: a.athlete?.displayName || '', team: String(a.athlete?.teamId || ''), pos: a.athlete?.position?.abbreviation || '', v }) }
        if (!d.pagination || page >= d.pagination.pages) break;
      }
      return [...out.values()];
    })();
    POOLS.set(key, p); p.catch(() => POOLS.delete(key)); return p;
  }
  // value(player) -> that player's production per game; note(player) -> a short label
  async function shares(path, sorts, teams, value, note, top = 10) {
    const pool = await espnPool(path, sorts), out = {};
    for (const [side, id] of Object.entries(teams)) {
      const mine = pool.filter(p => p.team === String(id)).map(p => ({ ...p, x: value(p) || 0 })).filter(p => p.x > 0).sort((a, b) => b.x - a.x);
      const sum = mine.reduce((a, p) => a + p.x, 0) || 1;
      out[side] = mine.slice(0, top).map(p => ({ name: p.name, share: p.x / sum, note: note(p) }));
    }
    return out;
  }
  const gp = p => p.v['general.gamesPlayed'] || p.v['general.games'] || 1;
  window.flRoster = {
    basketball: (path, teams) => shares(path, [['offensive.avgPoints:desc', 3]], teams, p => p.v['offensive.avgPoints'], p => `${(p.v['offensive.avgPoints'] || 0).toFixed(1)} pts a game${p.pos ? ' · ' + p.pos : ''}`),
    hockey: (path, teams) => shares(path, [['offensive.points:desc', 4]], teams, p => (p.v['offensive.goals'] || 0) + .5 * (p.v['offensive.assists'] || 0), p => `${p.v['offensive.goals'] || 0} G, ${p.v['offensive.assists'] || 0} A${p.pos ? ' · ' + p.pos : ''}`),
    football: (path, teams) => shares(path, [['passing.passingYards:desc', 1], ['rushing.rushingYards:desc', 2], ['receiving.receivingYards:desc', 3]], teams,
      p => .5 * (p.v['passing.passingYards'] || 0) + (p.v['rushing.rushingYards'] || 0) + .5 * (p.v['receiving.receivingYards'] || 0) + 20 * ((p.v['passing.passingTouchdowns'] || 0) + (p.v['rushing.rushingTouchdowns'] || 0) + (p.v['receiving.receivingTouchdowns'] || 0)),
      p => [p.pos, p.v['passing.passingYards'] ? `${p.v['passing.passingYards']} pass yds` : '', p.v['rushing.rushingYards'] ? `${p.v['rushing.rushingYards']} rush` : '', p.v['receiving.receivingYards'] ? `${p.v['receiving.receivingYards']} rec` : ''].filter(Boolean).join(' · ')),
    baseball: (path, teams) => shares(path, [['batting.RBIs:desc', 4]], teams, p => (p.v['batting.runs'] || 0) + (p.v['batting.RBIs'] || 0), p => `${p.v['batting.runs'] || 0} R, ${p.v['batting.RBIs'] || 0} RBI${p.pos ? ' · ' + p.pos : ''}`, 12),
  };
})();
