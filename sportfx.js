/* Floodlight · playing-surface graphics. One small drawing per sport, all plain SVG:
   basketball shot chart, football drive tracker, hockey shot map, baseball diamond.
   Each takes plain facts and returns markup; given nothing usable it returns '' so the page simply leaves it out. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
  const legend = (items) => `<div class="sfx-legend">${items.map(([c, t, hollow]) => `<span><i style="${hollow ? `box-shadow:inset 0 0 0 1.500px ${c}` : `background:${c}`}"></i>${esc(t)}</span>`).join('')}</div>`;
  const head = (t, s) => `<div class="sfx-h"><h5>${esc(t)}</h5>${s ? `<small>${esc(s)}</small>` : ''}</div>`;

  /* ---------- basketball: every shot on a full court, away shooting left, home shooting right ---------- */
  // shots: [{ x, y, made, home, text }] with x across the court (0–50 ft) and y out from the baseline (0–47 ft)
  function court(shots, o) {
    const ok = (shots || []).filter(s => s.x != null && s.y != null && s.x >= 0 && s.x <= 50 && s.y >= -2 && s.y <= 47);
    if (ok.length < 3) return '';
    const half = flip => { const t = flip ? 'transform="translate(94 50) rotate(180)"' : '';
      return `<g ${t}><rect x="0" y="17" width="19" height="16"/><circle cx="19" cy="25" r="6"/><path d="M0 3h14a23.750 23.750 0 0 1 0 44H0"/><path d="M4 22v6"/><circle cx="5.250" cy="25" r=".75"/></g>` };
    const dot = s => { const X = s.home ? 94 - Math.max(0, s.y) - 1 : Math.max(0, s.y) + 1, Y = s.home ? 50 - s.x : s.x, c = s.home ? 'var(--hc)' : 'var(--ac)';
      return `<circle class="sfx-shot${s.made ? ' made' : ''}" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${s.made ? 1 : .9}" ${s.made ? `fill="${c}"` : `fill="none" stroke="${c}" stroke-width=".35"`}><title>${esc(s.text || '')}</title></circle>` };
    const tally = home => { const l = ok.filter(s => !!s.home === home), m = l.filter(s => s.made).length; return `${m}/${l.length}` };
    return `<div class="sfx sfx-court" style="--hc:${o.hc};--ac:${o.ac}">${head('Shot chart', `${o.away} ${tally(false)} · ${o.home} ${tally(true)} from the field`)}
      <svg viewBox="-1 -1 96 52" role="img" aria-label="${esc(`Shot chart. ${o.away} made ${tally(false)}, ${o.home} made ${tally(true)}`)}"><g class="sfx-lines"><rect x="0" y="0" width="94" height="50" rx="1"/><path d="M47 0v50"/><circle cx="47" cy="25" r="6"/>${half(false)}${half(true)}</g>${ok.map(dot).join('')}</svg>
      ${legend([['var(--ac)', o.away + ' made'], ['var(--ac)', 'missed', true], ['var(--hc)', o.home + ' made'], ['var(--hc)', 'missed', true]])}</div>`;
  }

  /* ---------- football: each drive as a bar on the field ---------- */
  // drives: [{ home, abbr, logo, from, to, result, text, score, live }] with from/to as yards from the left goal line (0–100)
  function drives(list, o) {
    const ok = (list || []).filter(d => d.from != null && d.to != null);
    if (!ok.length) return '';
    const row = d => { const a = Math.max(0, Math.min(100, d.from)), b = Math.max(0, Math.min(100, d.to)), l = Math.min(a, b), w = Math.max(1.500, Math.abs(b - a)), c = d.home ? 'var(--hc)' : 'var(--ac)';
      return `<div class="sfx-drive${d.score ? ' score' : ''}${d.live ? ' live' : ''}">
        <span class="sfx-dt">${d.logo ? `<img src="${esc(d.logo)}" alt="" loading="lazy">` : ''}<b>${esc(d.abbr || '')}</b></span>
        <span class="sfx-field" role="img" aria-label="${esc(`${d.abbr} drive, ${d.result || ''}. ${d.text || ''}`)}"><i class="ez" style="background:${o.lc || 'var(--surface-2)'}"></i><span class="sfx-turf"><i class="sfx-run${b < a ? ' rev' : ''}" style="left:${l}%;width:${w}%;background:${c}"></i><i class="sfx-ball" style="left:${b}%"></i></span><i class="ez" style="background:${o.rc || 'var(--surface-2)'}"></i></span>
        <span class="sfx-dr"><b>${esc(d.result || (d.live ? 'In progress' : ''))}</b><small>${esc(d.text || '')}</small></span></div>` };
    return `<div class="sfx sfx-drives" style="--hc:${o.hc};--ac:${o.ac}">${head('Drive tracker', `${ok.length} drive${ok.length === 1 ? '' : 's'}`)}<div class="sfx-dlist">${ok.map(row).join('')}</div></div>`;
  }

  /* ---------- hockey: shots and goals on the rink, away attacking left, home attacking right ---------- */
  // shots: [{ x, y, goal, home, text }] in feet from centre ice (x −100…100, y −42.500…42.500)
  function rink(shots, o) {
    const ok = (shots || []).filter(s => s.x != null && s.y != null && Math.abs(s.x) <= 100 && Math.abs(s.y) <= 43);
    if (ok.length < 3) return '';
    const dot = s => { const ax = Math.abs(s.x), X = s.home ? 100 + ax : 100 - ax, Y = 42.500 + (s.home ? s.y : -s.y) * (s.x < 0 ? -1 : 1), c = s.home ? 'var(--hc)' : 'var(--ac)';
      return `<circle class="sfx-shot${s.goal ? ' made' : ''}" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${s.goal ? 2.400 : 1.600}" ${s.goal ? `fill="${c}" stroke="var(--fg)" stroke-width=".6"` : `fill="none" stroke="${c}" stroke-width=".7"`}><title>${esc(s.text || '')}</title></circle>` };
    const tally = home => { const l = ok.filter(s => !!s.home === home); return `${l.filter(s => s.goal).length} goal${l.filter(s => s.goal).length === 1 ? '' : 's'} from ${l.length} shots` };
    return `<div class="sfx sfx-rink" style="--hc:${o.hc};--ac:${o.ac}">${head('Shot map', `${o.away} ${tally(false)} · ${o.home} ${tally(true)}`)}
      <svg viewBox="-2 -2 204 89" role="img" aria-label="${esc(`Shot map. ${o.away} ${tally(false)}. ${o.home} ${tally(true)}`)}"><g class="sfx-lines"><rect x="0" y="0" width="200" height="85" rx="28"/><path class="red" d="M100 0v85M11 5.500v74M189 5.500v74"/><path class="blue" d="M75 0v85M125 0v85"/><circle cx="100" cy="42.500" r="15"/>
        ${[[31, 20.500], [31, 64.500], [169, 20.500], [169, 64.500]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15"/>`).join('')}<path d="M11 38.500a6 6 0 0 1 0 8M189 38.500a6 6 0 0 0 0 8"/></g>${ok.map(dot).join('')}</svg>
      ${legend([['var(--ac)', o.away + ' goal'], ['var(--ac)', 'shot', true], ['var(--hc)', o.home + ' goal'], ['var(--hc)', 'shot', true]])}</div>`;
  }

  /* ---------- baseball: the diamond with runners, the count and the outs ---------- */
  // s: { on1, on2, on3, outs, balls, strikes, batter, pitcher, half, inning }
  function diamond(s, o = {}) {
    if (!s) return '';
    const base = (on, x, y) => `<rect class="${on ? 'on' : ''}" x="${x - 7}" y="${y - 7}" width="14" height="14" rx="1.500" transform="rotate(45 ${x} ${y})"/>`;
    const pips = (n, of, cls) => `<span class="sfx-pips ${cls}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
    const on = ['first', 'second', 'third'].filter((_, i) => [s.on1, s.on2, s.on3][i]);
    return `<div class="sfx sfx-diamond">${head('On the field', s.inning ? `${s.half || ''} ${s.inning}`.trim() : '')}
      <div class="sfx-dia"><svg viewBox="0 0 120 104" role="img" aria-label="${esc(on.length ? 'Runners on ' + on.join(' and ') : 'Bases empty')}"><path class="sfx-grass" d="M60 98L8 46a74 74 0 0 1 104 0z"/><path class="sfx-path" d="M60 92L26 58 60 24l34 34z"/>${base(s.on2, 60, 24)}${base(s.on3, 26, 58)}${base(s.on1, 94, 58)}<path class="sfx-plate" d="M54 90h12v5l-6 5-6-5z"/></svg>
        <div class="sfx-count"><div><small>Balls</small>${pips(s.balls || 0, 4, 'b')}</div><div><small>Strikes</small>${pips(s.strikes || 0, 3, 's')}</div><div><small>Outs</small>${pips(s.outs || 0, 3, 'o')}</div>
          ${s.batter ? `<p><small>At bat</small><b>${esc(s.batter)}</b></p>` : ''}${s.pitcher ? `<p><small>Pitching</small><b>${esc(s.pitcher)}</b></p>` : ''}</div></div></div>`;
  }

  /* ---------- adapters: pull the facts out of the feeds the sports already load ---------- */
  // ESPN basketball summary: plays[] with shootingPlay, scoringPlay, coordinate {x,y} and team.id
  court.fromEspn = (sum, homeId) => (sum?.plays || []).filter(p => p.shootingPlay && p.coordinate && !/free throw/i.test(p.type?.text || p.text || ''))
    .map(p => ({ x: num(p.coordinate.x), y: num(p.coordinate.y), made: !!p.scoringPlay, home: String(p.team?.id) === String(homeId), text: p.text }));
  // ESPN football summary: drives.previous[] (+ drives.current) with start/end yardLine counted from one goal line
  drives.fromEspn = (sum, homeId) => { const d = sum?.drives; if (!d) return [];
    const all = [...(d.previous || [])]; if (d.current && !all.some(x => x.id === d.current.id)) all.push({ ...d.current, live: true });
    return all.map(x => ({ home: String(x.team?.id) === String(homeId), abbr: x.team?.abbreviation || x.team?.shortDisplayName || '', logo: x.team?.logos?.[0]?.href || '', from: num(x.start?.yardLine), to: num(x.end?.yardLine ?? x.plays?.slice(-1)[0]?.end?.yardLine),
      result: x.displayResult || x.result || '', text: x.description || '', score: !!x.isScore, live: !!x.live })).reverse() };
  // ESPN hockey summary: plays[] with coordinate {x,y}; goals are scoring plays, shots are named in the play type
  rink.fromEspn = (sum, homeId) => (sum?.plays || []).filter(p => p.coordinate && (p.scoringPlay || /shot|goal|save/i.test(p.type?.text || '')) && !/blocked|missed|shootout/i.test(p.type?.text || ''))
    .map(p => ({ x: num(p.coordinate.x), y: num(p.coordinate.y), goal: !!p.scoringPlay, home: String(p.team?.id) === String(homeId), text: p.text }));

  window.flFx = { court, drives, rink, diamond };
})();
