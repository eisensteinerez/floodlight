/* Floodlight · two Lab tools that live on the Lab page itself: Compare and Trends.
   Compare: two players side by side. Choose a sport, put a player in each slot (search, or drag a player card onto a
   slot), and the numbers line up: average, median, season average, how often each cleared their line, and one shared
   chart of both game logs on a common date axis with a line you can drag. Three ways to compare: the same stat, a
   different stat for each player, or the two added together on the dates both played (the old Combo). The games can
   be narrowed to the dates both played, the games they played against each other, (for teammates) the games one
   played while the other sat, home or away, and the games against tonight's opponent.
   Trends: before a player is chosen, today's strongest trends from the posted lines: the longest runs over or under a
   line, and whose last five games are furthest from their last twenty, with filters. Every run is set against the
   market's price and the player's own hit rate, so a long run that the price expects is not sold as a surprise.
   Every number is counted from the games /api/lab/player and the board return; nothing is estimated here. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const fmt = v => v == null || isNaN(v) ? '–' : Number.isInteger(+v) ? String(+v) : (+v).toFixed(1);
  const pct = x => Math.round(x * 100);
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const face = (src, name, cls = 'avx') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(name)}</span></span>`;
  const SPORTS = [['nba', 'NBA', 'basketball'], ['wnba', 'WNBA', 'basketball'], ['nfl', 'NFL', 'football'], ['nhl', 'NHL', 'hockey'], ['mlb', 'MLB', 'baseball'], ['soccer', 'Soccer', 'soccer']];
  const NAME = Object.fromEntries(SPORTS.map(s => [s[0], s[1]]));
  const WINDOWS = [[5, 'Last 5'], [10, 'Last 10'], [20, 'Last 20'], [0, 'This season']];
  const get = url => fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'It did not load.'); return d });
  const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const p2 = n => String(n).padStart(2, '0');
  // the calendar day a game was played, in this browser's time zone (two late games on one night share a day even when UTC splits them)
  const day = iso => { const s = String(iso || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const t = new Date(s); return isNaN(t) ? s.slice(0, 10) : `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}` };
  const short = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' }) };
  const nm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const teamIs = (name, team) => { const a = nm(name), b = nm(team); return !!a && !!b && (a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b))) };
  const games = n => `${n} ${n === 1 ? 'game' : 'games'}`;

  /* ---------------- Compare ---------------- */
  const MODES = [['same', 'Same stat'], ['diff', 'Different stats'], ['sum', 'Combined total']];
  const VENUES = [['all', 'Home and away'], ['home', 'Home'], ['away', 'Away']];
  const C = { sport: 'nba', a: null, b: null, stat: '', statB: '', mode: 'same', win: 10, preset: 'all', venue: 'all', vs: 'any', lines: {}, sum: null,
    q: { a: '', b: '' }, hits: { a: null, b: null }, sel: { a: -1, b: -1 }, seq: 0, host: null, api: null, drag: null, noted: '', w: 0 };
  const slot = k => C[k];
  const other = k => k === 'a' ? 'b' : 'a';
  const statOf = k => k === 'b' && C.mode === 'diff' ? (C.statB || C.stat) : C.stat;
  const statLabel = k => { const d = C[k]?.d || C[other(k)]?.d, st = statOf(k); return (d?.stats || []).find(s => s.k === st)?.l || (C[other(k)]?.d?.stats || []).find(s => s.k === st)?.l || st };
  function load(k, name) {
    const seq = ++C.seq; C[k] = { name, loading: true }; draw();
    get(`/api/lab/player?sport=${encodeURIComponent(C.sport)}&name=${encodeURIComponent(name)}`)
      .then(d => { if (C[k]?.name !== name) return; C[k] = { name: d.name, d }; pickStat() })
      .catch(e => { if (C[k]?.name !== name) return; C[k] = { name, err: e.message || 'That player did not load.' } })
      .finally(() => { draw(); if (seq === C.seq) focusSlot(k) });
  }
  // the stat: the one asked for, else the one with a posted line, else the first both have. Different stats: each player their own.
  function pickStat() {
    const A = C.a?.d, B = C.b?.d, has = (d, k) => !d || d.stats.some(s => s.k === k); if (!A && !B) return;
    const okA = k => has(A, k) && (C.mode === 'diff' || has(B, k));
    if (!(C.stat && okA(C.stat))) {
      const posted = [...(A?.lines || []), ...(C.mode === 'diff' ? [] : B?.lines || [])].map(l => l.k).find(okA);
      C.stat = posted || (A || B).stats.find(s => okA(s.k))?.k || '';
    }
    if (C.mode === 'diff' && B && !(C.statB && has(B, C.statB))) C.statB = (B.lines || []).map(l => l.k).find(k => has(B, k)) || (has(B, C.stat) ? C.stat : B.stats[0]?.k || '');
  }
  const statsBoth = () => { const A = C.a?.d, B = C.b?.d; if (!A && !B) return []; const base = (A || B).stats; return base.filter(s => (!A || A.stats.some(x => x.k === s.k)) && (!B || B.stats.some(x => x.k === s.k))) };
  const postedOf = (d, k) => { const ls = (d?.lines || []).filter(l => l.k === k); if (!ls.length) return null; return ls.find(l => l.kind === 'standard') || ls[0] };
  const postedLine = (d, k) => postedOf(d, k)?.line ?? null;
  const lineKey = k => `${k}:${statOf(k)}`;
  const lineOf = k => { const d = C[k]?.d; if (!d) return null; return C.lines[lineKey(k)] ?? postedLine(d, statOf(k)) ?? null };
  const setLine = (k, v) => { if (k === 'sum') C.sum = v; else C.lines[lineKey(k)] = v };
  const season = d => d.seasonStart ? day(d.seasonStart) : '';
  const nextOpp = d => d?.next?.opp || (d?.lines || []).find(l => l.opp)?.opp || '';
  const vsOpp = (g, o) => !!o && (nm(g.oppAbbr) === nm(o) || teamIs(g.opp, o));
  const sameTeam = () => C.a?.d && C.b?.d && C.a.d.team && C.a.d.team === C.b.d.team;
  /* the dates both played, each one sorted into: the same game against each other ('h2h'), the same game as teammates
     ('team'), or two separate games on one date ('apart'). The game id says whether it was one game; the home flags (or
     the opponents) say which side each was on. Without ids, the opponent's name against the other player's team. */
  let MC = null;
  function meet() {
    const A = C.a?.d, B = C.b?.d; if (!A || !B) return new Map();
    if (MC && MC.A === A && MC.B === B) return MC.m;
    const bd = new Map(), m = new Map(); for (const g of B.games) { const k = day(g.date); if (!bd.has(k)) bd.set(k, g) }
    for (const ga of A.games) { const k = day(ga.date), gb = bd.get(k); if (!gb || m.has(k)) continue;
      const one = ga.id != null && gb.id != null && ga.id !== '' && gb.id !== '' ? String(ga.id) === String(gb.id) : null;
      const side = ga.home != null && gb.home != null ? ga.home === gb.home : nm(ga.opp) === nm(gb.opp);
      m.set(k, one === true ? (side ? 'team' : 'h2h') : one === false ? 'apart' : teamIs(ga.opp, B.team) || teamIs(gb.opp, A.team) ? 'h2h' : nm(ga.opp) && nm(ga.opp) === nm(gb.opp) ? 'team' : 'apart') }
    MC = { A, B, m }; return m;
  }
  function gamesOf(k) {
    const d = C[k]?.d; if (!d) return [];
    const st = statOf(k), M = meet(), has2 = !!C[other(k)]?.d;
    let gs = d.games.filter(g => g.v[st] != null);
    if (has2 && C.preset === 'both') gs = gs.filter(g => M.has(day(g.date)));
    if (has2 && C.preset === 'h2h') gs = gs.filter(g => M.get(day(g.date)) === 'h2h');
    if (has2 && C.preset === 'without') gs = gs.filter(g => !M.has(day(g.date)));
    if (C.venue !== 'all') gs = gs.filter(g => g.home === (C.venue === 'home'));
    if (C.vs === 'opp') { const o = nextOpp(d); gs = o ? gs.filter(g => vsOpp(g, o)) : [] }
    if (!C.win) { const s = season(d); return s ? gs.filter(g => day(g.date) >= s) : gs.slice(0, 82) }
    return gs.slice(0, C.win);
  }
  const seasonAvg = k => { const d = C[k]?.d; if (!d) return null; const s = season(d), st = statOf(k); return mean(d.games.filter(g => g.v[st] != null && (!s || day(g.date) >= s)).map(g => g.v[st])) };
  const count = (vs, line) => { const scored = line == null ? [] : vs.filter(v => v !== line); return { over: line == null ? null : scored.filter(v => v > line).length, of: scored.length } };
  function summary(k) {
    const gs = gamesOf(k), st = statOf(k), vs = gs.map(g => g.v[st]), line = lineOf(k), c = count(vs, line);
    return { gs, st, n: vs.length, avg: mean(vs), med: median(vs), line, ...c, last: vs[0] ?? null, sAvg: seasonAvg(k), posted: postedOf(C[k]?.d, st),
      hi: vs.length ? Math.max(...vs) : null, lo: vs.length ? Math.min(...vs) : null };
  }
  // the dates both played, added together: the old Combo. Same stat only; "games the other missed" has no such dates.
  function combined() {
    const A = C.a?.d, B = C.b?.d; if (!A || !B || C.mode === 'diff' || C.preset === 'without') return null;
    const M = meet(), bm = new Map(B.games.filter(g => g.v[C.stat] != null).map(g => [day(g.date), g]));
    let rows = A.games.filter(g => g.v[C.stat] != null && bm.has(day(g.date))).map(g => ({ day: day(g.date), date: g.date, a: g.v[C.stat], b: bm.get(day(g.date)).v[C.stat], opp: g.oppAbbr || g.opp, t: M.get(day(g.date)) || 'apart' }));
    if (C.preset === 'h2h') rows = rows.filter(r => r.t === 'h2h');
    if (!C.win) { const s = season(A); rows = s ? rows.filter(r => r.day >= s) : rows } else rows = rows.slice(0, C.win);
    const la = lineOf('a'), lb = lineOf('b'), line = C.sum ?? (la != null && lb != null ? la + lb : null);
    const sums = rows.map(r => r.a + r.b), c = count(sums, line), pa = postedLine(A, C.stat), pb = postedLine(B, C.stat);
    return { rows, line, n: rows.length, avg: mean(sums), ...c, posted: pa != null && pb != null ? pa + pb : null };
  }
  // how the dates both played split: one game against each other, one game as teammates, or separate games
  function split(tags) { const n = { h2h: 0, team: 0, apart: 0 }; tags.forEach(t => n[t]++); return n }
  function splitText(n, total) {
    const bits = [n.h2h && `${n.h2h} ${n.h2h === 1 ? 'was the game' : 'were games'} they played against each other`, n.team && `${n.team} ${n.team === 1 ? 'was the same game' : 'were the same game'}, as teammates`, n.apart && `${n.apart} ${n.apart === 1 ? 'was a separate game' : 'were separate games'} that only shared the date`].filter(Boolean);
    if (bits.length === 1) return n.h2h === total ? `All ${total} were the same game, against each other.` : n.team === total ? `All ${total} were the same game, as teammates.` : `All ${total} were separate games that happened on the same date, not the same matchup.`;
    return `Of those, ${bits.length > 2 ? bits.slice(0, -1).join('; ') + '; and ' + bits[bits.length - 1] : bits.join(', and ')}.`;
  }

  /* the shared chart: one lane per player (and one for the two added together), on one date axis, oldest on the left.
     Filled marks cleared the line, hollow marks did not, a dash sat on it; a stem joins each mark to the line, so the
     margin reads at a glance. Same stat: both lanes share one scale. Different stats: each lane has its own. */
  const SHAPE = { a: 'c', b: 'd', sum: 's' };
  function mark(sh, x, y, r) { return sh === 'c' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"` : sh === 'd' ? `<path d="M${x.toFixed(1)} ${(y - r * 1.25).toFixed(1)}l${(r * 1.25).toFixed(1)} ${(r * 1.25).toFixed(1)}l-${(r * 1.25).toFixed(1)} ${(r * 1.25).toFixed(1)}l-${(r * 1.25).toFixed(1)} -${(r * 1.25).toFixed(1)}z"` : `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" rx="1.5"` }
  const hm = (v, line) => line == null ? 'e' : v > line ? 'h' : v < line ? 'm' : 'e';
  function cntText(line, vs, n) { const c = count(vs, line); return `${line == null ? 'No line yet' : c.of ? `Over ${fmt(line)} in ${c.over} of ${c.of}` : `No games to count against ${fmt(line)}`} · ${games(n)}` }
  const TAG = { h2h: 'they played each other', team: 'same game, as teammates', apart: 'both played, separate games' };
  function chart(lanes, W, same) {
    const dates = [...new Set(lanes.flatMap(l => l.pts.map(p => p.day)))].sort(); if (!dates.length) return '';
    const sm = W < 520, padL = 8, padR = sm ? 60 : 76, HEAD = 40, LH = sm ? 136 : 160, AX = 30, fs = sm ? 11 : 12;
    const H = lanes.length * LH + AX, PW = W - padL - padR, step = PW / dates.length, X = new Map(dates.map((d, i) => [d, padL + (i + .5) * step]));
    const r = Math.max(2.5, Math.min(sm ? 5 : 6, step * .3)), M = meet();
    const top = i => i * LH + HEAD, bot = i => (i + 1) * LH - 12;
    // each scale fits the games, the lines and the averages with a little room, so the margin around the line reads
    const dom = ls => { const xs = ls.flatMap(l => [...l.pts.map(p => p.v), l.line, l.posted, l.avg, l.sAvg]).filter(v => v != null); if (!xs.length) return [0, 1];
      const a = Math.min(...xs), b = Math.max(...xs), pad = Math.max(1, (b - a) * .12); return [Math.max(0, Math.floor(a - pad)), Math.ceil(b + pad)] };
    const shared = same ? dom(lanes.filter(l => l.key !== 'sum')) : null;
    const pl = lanes.filter(l => l.key !== 'sum'), both = pl.length === 2 ? new Set(pl[0].pts.map(p => p.day).filter(d => pl[1].pts.some(p => p.day === d))) : new Set();
    // the dates both played: a band through both player lanes, and a mark on the axis (a diamond when they faced each other)
    const yb0 = top(0) - 6, yb1 = bot(Math.min(1, lanes.length - 1)) + 4;
    const bands = [...both].map(d => { const t = M.get(d) || 'apart', x = X.get(d) - step / 2;
      return `<rect class="bd ${t === 'h2h' ? 'bh' : ''}" x="${x.toFixed(1)}" y="${yb0}" width="${step.toFixed(1)}" height="${yb1 - yb0}"/>` }).join('');
    const axY = lanes.length * LH + 4;
    const axMarks = [...both].map(d => { const t = M.get(d) || 'apart', x = X.get(d);
      return t === 'h2h' ? `<path class="mk-h" d="M${x.toFixed(1)} ${axY - 1}l5 5l-5 5l-5 -5z"><title>${esc(short(d))}: they played each other</title></path>` : `<circle class="mk-b" cx="${x.toFixed(1)}" cy="${axY + 4}" r="3"><title>${esc(short(d))}: ${TAG[t]}</title></circle>` }).join('');
    const lab = [0, dates.length - 1, ...(dates.length > 6 && !sm ? [Math.floor((dates.length - 1) / 2)] : [])].filter((v, i, a) => a.indexOf(v) === i);
    const axis = lab.map(i => `<text class="lt" x="${X.get(dates[i]).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}">${esc(short(dates[i]))}</text>`).join('');
    const body = lanes.map((l, i) => {
      const [lo, max] = same && l.key !== 'sum' ? shared : dom([l]), y0 = bot(i), y1 = top(i), y = v => y0 - (v - lo) / (max - lo) * (y0 - y1), sh = SHAPE[l.key];
      const hv = l.line ?? Math.round((l.avg ?? (lo + max) / 2) * 2) / 2, hy = y(hv), hx = W - padR + 16;
      const ref = (v, cls, t) => v == null ? '' : `<line class="${cls} c-${l.key}" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"><title>${esc(t)}</title></line>`;
      const pts = l.pts.map(p => { const x = X.get(p.day), py = y(p.v), c = hm(p.v, l.line), tag = l.key !== 'sum' && both.has(p.day) ? `. ${TAG[M.get(p.day) || 'apart']}` : '';
        const tip = `${short(p.day)}${p.opp ? ` v ${p.opp}` : ''}${p.home == null ? '' : p.home ? ' (home)' : ' (away)'}: ${fmt(p.v)} ${l.stat.toLowerCase()}${l.line == null ? '' : c === 'h' ? `, over ${fmt(l.line)}` : c === 'm' ? `, under ${fmt(l.line)}` : `, on the line`}${tag}`;
        return `<line class="st ${c}" data-st="${l.key}" data-v="${p.v}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${(l.line == null ? py : hy).toFixed(1)}" y2="${py.toFixed(1)}"/>${mark(sh, x, py, r)} class="pt ${c} c-${l.key}" data-lane="${l.key}" data-v="${p.v}"><title>${esc(tip)}</title>${sh === 'c' ? '</circle>' : sh === 'd' ? '</path>' : '</rect>'}` }).join('');
      const small = l.pts.length < 5;
      const posted = l.posted != null && l.posted !== l.line ? `<path class="pm" d="M${W - padR + 2} ${y(l.posted).toFixed(1)}l-7 -5v10z"><title>Posted line ${fmt(l.posted)}</title></path>` : '';
      const vt = l.line == null ? 'No line set. Use the arrow keys to set one.' : `${fmt(l.line)}. ${cntText(l.line, l.pts.map(p => p.v), l.pts.length)}`;
      return `<g class="ln-lane">
        <text class="lh" x="${padL + 14}" y="${i * LH + 15}"><tspan class="nm">${esc(l.name)}</tspan><tspan class="lt" dx="6">${esc(l.stat)}${same && l.key !== 'sum' ? '' : ' · own scale'}</tspan></text>
        ${mark(sh, padL + 5, i * LH + 11, 4.5)} class="pt h c-${l.key}" aria-hidden="true"/>
        <text class="ls" x="${padL}" y="${i * LH + 32}"><tspan id="lcCnt-${l.key}">${esc(cntText(l.line, l.pts.map(p => p.v), l.pts.length))}</tspan>${small ? '<tspan class="ss" dx="6">Small sample</tspan>' : ''}</text>
        <line class="ax" x1="${padL}" x2="${W - padR}" y1="${y0}" y2="${y0}"/>
        ${ref(l.sAvg, 'sa', `Season average ${fmt(l.sAvg)}`)}${ref(l.avg, 'av', `Average of these games ${fmt(l.avg)}`)}
        <line class="ln${l.line == null ? ' off' : ''}" data-ln="${l.key}" x1="${padL}" x2="${W - padR}" y1="${hy.toFixed(1)}" y2="${hy.toFixed(1)}"/>
        ${pts}${posted}
        <g class="lc-hd${l.line == null ? ' off' : ''}" data-cmphd="${l.key}" tabindex="0" role="slider" aria-orientation="vertical" aria-label="Line for ${esc(l.name)}, ${esc(l.stat.toLowerCase())}" aria-valuemin="${lo}" aria-valuemax="${max}" aria-valuenow="${hv}" aria-valuetext="${esc(vt)}"
          data-y0="${y0}" data-y1="${y1}" data-lo="${lo}" data-max="${max}" data-hx="${hx}" transform="translate(${hx} ${hy.toFixed(1)})"><circle class="hit" r="22"/><circle class="kn" r="10"/><path class="gr" d="M-4 -2.5h8M-4 2.5h8"/></g>
        <text class="lv" id="lcLv-${l.key}" x="${hx + 15}" y="${(hy + 4).toFixed(1)}">${l.line == null ? 'Set' : fmt(l.line)}</text></g>` }).join('');
    const aria = lanes.map(l => `${l.name}, ${l.stat.toLowerCase()}: ${cntText(l.line, l.pts.map(p => p.v), l.pts.length)}${l.avg != null ? `, average ${fmt(l.avg)}` : ''}`).join('. ') + `. ${both.size} ${both.size === 1 ? 'date' : 'dates'} both played. The table under the chart lists every game.`;
    return `<svg class="lc-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Game logs on one date axis" style="font-size:${fs}px"><title>${esc(aria)}</title>${bands}${body}
      <line class="ax" x1="${padL}" x2="${W - padR}" y1="${lanes.length * LH}" y2="${lanes.length * LH}"/>${axMarks}${axis}</svg>`;
  }
  // a dragged line repaints only the marks it changes, so the drag stays smooth; the full redraw follows on release
  function paint(key, v) {
    const svg = C.host?.querySelector('.lc-chart'), hd = svg?.querySelector(`[data-cmphd="${key}"]`); if (!hd) return;
    const y0 = +hd.dataset.y0, y1 = +hd.dataset.y1, lo = +hd.dataset.lo, max = +hd.dataset.max, yy = (y0 - (v - lo) / (max - lo) * (y0 - y1)).toFixed(1);
    hd.setAttribute('transform', `translate(${hd.dataset.hx} ${yy})`); hd.classList.remove('off');
    const lv = svg.querySelector('#lcLv-' + key); if (lv) { lv.setAttribute('y', (+yy + 4).toFixed(1)); lv.textContent = fmt(v) }
    const ln = svg.querySelector(`[data-ln="${key}"]`); if (ln) { ln.setAttribute('y1', yy); ln.setAttribute('y2', yy); ln.classList.remove('off') }
    const vs = [];
    svg.querySelectorAll(`.pt[data-lane="${key}"]`).forEach(p => { const x = +p.dataset.v; vs.push(x); p.setAttribute('class', `pt ${hm(x, v)} c-${key}`) });
    svg.querySelectorAll(`[data-st="${key}"]`).forEach(s => { s.setAttribute('y1', yy); s.setAttribute('class', `st ${hm(+s.dataset.v, v)}`) });
    const t = cntText(v, vs, vs.length), cn = svg.querySelector('#lcCnt-' + key); if (cn) cn.textContent = t;
    hd.setAttribute('aria-valuenow', v); hd.setAttribute('aria-valuetext', `${fmt(v)}. ${t}`);
    const inp = C.host.querySelector(`[data-cmpline="${key}"]`); if (inp) inp.value = v;
  }

  function slotHTML(k) {
    const s = slot(k), lab = k === 'a' ? 'First player' : 'Second player';
    if (s?.d) { const d = s.d;
      return `<div class="card lc-slot full c-${k}" data-cmpdrop="${k}"><span class="lb">${lab}</span><div class="lc-who">${face(d.photo, d.name, 'avx av-lg')}<span class="rw-t"><b>${esc(d.name)}</b><small>${esc([d.team, d.pos].filter(Boolean).join(' · '))}</small></span></div>
        <div class="lc-sa"><button type="button" class="bt ghost sm" data-cmp="change" data-k="${k}">Change</button><button type="button" class="lk" data-cmp="lab" data-k="${k}">Open in the Lab</button></div></div>` }
    const hits = C.hits[k];
    return `<div class="card lc-slot" data-cmpdrop="${k}"><label class="lb" for="lc-${k}">${lab}</label>
      ${s?.loading ? `<div class="lc-wait" role="status">${ic('search', 18)}Loading ${esc(s.name)}…</div>` : ''}
      <div class="lc-in"${s?.loading ? ' hidden' : ''}>${ic('search', 18)}<input class="inp" id="lc-${k}" type="search" role="combobox" aria-expanded="${!!hits?.length}" aria-controls="cmpl-${k}" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search ${esc(NAME[C.sport])} players" value="${esc(C.q[k])}"${C.sel[k] >= 0 ? ` aria-activedescendant="cmpo-${k}-${C.sel[k]}"` : ''}></div>
      <ul class="lc-list" id="cmpl-${k}" role="listbox" aria-label="${lab}: matches"${hits?.length ? '' : ' hidden'}>${(hits || []).map((h, i) => `<li role="option" id="cmpo-${k}-${i}" aria-selected="${i === C.sel[k]}" class="rw${i === C.sel[k] ? ' on' : ''}" data-cmppick="${k}|${i}">${face(h.img, h.name, 'avx av-sm')}<span class="rw-t"><b>${esc(h.name)}</b><small>${esc(h.sub || '')}</small></span></li>`).join('')}</ul>
      ${s?.err ? `<p class="lc-err" role="alert">${esc(s.err)} Check the spelling, or pick a name from the list.</p>` : `<p class="lb lc-hint">Or drag a player card here.</p>`}</div>`;
  }
  const radios = (label, opts, cur, attr, cls = 'seg') => `<div class="${cls}" role="radiogroup" aria-label="${esc(label)}">${opts.map(([k, l]) => `<button type="button" role="radio" aria-checked="${cur === k}" class="${cls === 'seg' ? (cur === k ? 'on' : '') : 'cx sm'}" tabindex="${cur === k ? 0 : -1}" ${attr}="${k}">${esc(l)}</button>`).join('')}</div>`;
  const presets = () => [['all', 'Every game'], ['both', 'Only dates both played'], ...(sameTeam() ? [['without', 'Only games the other missed']] : [['h2h', 'Only games against each other']])];
  function cmpItem() {
    const A = C.a?.d, B = C.b?.d; if (!A || !B) return null;
    const la = statLabel('a').toLowerCase(), lb = statLabel('b').toLowerCase(), l1 = lineOf('a'), l2 = lineOf('b');
    const label = C.mode === 'diff' ? `${A.name}, ${la}, and ${B.name}, ${lb}` : `${A.name} and ${B.name}, ${la}${C.mode === 'sum' ? ' combined' : ''}`;
    const sub = [WINDOWS.find(w => w[0] === C.win)?.[1], C.preset !== 'all' ? presets().find(p => p[0] === C.preset)?.[1] : '', C.venue !== 'all' ? (C.venue === 'home' ? 'Home games' : 'Away games') : '', C.vs === 'opp' ? 'Against tonight’s opponent' : '',
      C.mode === 'sum' ? (combined()?.line != null ? `Combined line ${fmt(combined().line)}` : '') : [l1, l2].some(v => v != null) ? `Lines ${fmt(l1)} and ${fmt(l2)}` : ''].filter(Boolean).join(' · ');
    const open = { sport: C.sport, a: A.name, b: B.name, stat: C.stat, statB: C.mode === 'diff' ? C.statB : '', win: C.win, preset: C.preset, mode: C.mode, venue: C.venue, vs: C.vs };
    return { kind: 'compare', key: `compare:${C.sport}:${A.name}|${B.name}:${C.stat}:${open.statB}:${C.mode}:${C.preset}:${C.win}:${C.venue}:${C.vs}`, label, sub, photo: A.photo || '', photo2: B.photo || '', open: { compare: open } };
  }
  function resultHTML(W) {
    const A = C.a?.d, B = C.b?.d;
    if (!A || !B) return `<div class="lc-empty">${ic('compare', 22)}<p><b>${A || B ? 'Now add the second player' : 'Put a player in each slot'}</b><span>${A || B ? 'Their numbers will line up next to the first one’s.' : 'Search, or drag a card from “Start with tonight’s hottest” below. Then pick a stat.'}</span></p></div>`;
    const st = statsBoth();
    if (C.mode !== 'diff' && !st.length) return `<p class="lc-err">These two players share no stat in their game logs. Choose “Different stats”, or pick two players from the same sport.</p>`;
    if (C.preset === 'without' && !sameTeam()) C.preset = 'all';
    if (C.preset === 'h2h' && sameTeam()) C.preset = 'all';
    const sa = summary('a'), sb = summary('b'), cb = combined(), labA = statLabel('a'), labB = statLabel('b'), same = C.mode !== 'diff' || C.stat === C.statB;
    const within = C.win ? `over the last ${C.win} games` : 'this season';
    const scope = [C.preset === 'both' ? 'on the dates both played' : C.preset === 'h2h' ? 'in the games against each other' : C.preset === 'without' ? 'when the other one sat' : '',
      C.venue === 'home' ? 'at home' : C.venue === 'away' ? 'away' : '', C.vs === 'opp' ? 'against tonight’s opponent' : '', within].filter(Boolean).join(', ');
    const rate = s => s.line == null ? '–' : s.of ? `${s.over} of ${s.of}` : '–';
    const tile = (d, s, k, label) => `<div class="lc-col c-${k}"><div class="lc-h"><span class="lc-sw" aria-hidden="true"></span>${face(d.photo, d.name, 'avx')}<b>${esc(d.name)}</b></div>
      <dl class="lc-dl"><div><dt>Average</dt><dd class="num">${fmt(s.avg)}</dd></div><div><dt>Median</dt><dd class="num">${fmt(s.med)}</dd></div><div><dt>Season average</dt><dd class="num">${fmt(s.sAvg)}</dd></div>
        <div><dt>Over the line</dt><dd class="num">${rate(s)}</dd></div><div><dt>Range</dt><dd class="num">${s.n ? `${fmt(s.lo)}–${fmt(s.hi)}` : '–'}</dd></div></dl>
      <label class="lc-line"><span class="lb">Line</span><input class="inp num" type="number" step="0.5" min="0" inputmode="decimal" data-cmpline="${k}" value="${s.line ?? ''}" placeholder="none" aria-label="${esc(d.name)}'s line for ${esc(label)}"></label>
      ${s.n ? '' : `<p class="lc-none">No games match. ${C.vs === 'opp' && !nextOpp(d) ? `${esc(d.name)} has no game posted tonight, so there is no opponent to match.` : 'Try “Every game”, “Home and away” or a longer window.'}</p>`}
      <p class="lb">${esc(label)} · ${games(s.n)}${s.n && s.n < 5 ? ' · <b class="lc-ss">small sample</b>' : ''}${s.posted ? ` · posted ${fmt(s.posted.line)}${s.posted.book ? ` on ${esc(s.posted.book)}` : ''}` : ' · no posted line'}</p></div>`;
    const none = C.preset === 'without' && (!sa.n || !sb.n);
    const lead = none
      ? `${!sa.n && !sb.n ? `${A.name} and ${B.name} played every game together` : !sa.n ? `${A.name} has played no game without ${B.name}` : `${B.name} has played no game without ${A.name}`}`
      : same && sa.avg != null && sb.avg != null ? (Math.abs(sa.avg - sb.avg) < 0.05 ? `${A.name} and ${B.name} are level at ${fmt(sa.avg)} ${labA.toLowerCase()}` : `${sa.avg > sb.avg ? A.name : B.name} averages ${fmt(Math.abs(sa.avg - sb.avg))} more ${labA.toLowerCase()}`) : '';
    // the answer in words: each player against their line, the two together, and what kind of dates those were
    const one = (d, s, label, it) => s.line == null ? `${d.name} has no line on ${label.toLowerCase()} yet; drag the line in the chart or type one.` : !s.of ? `${d.name} has no games to count against ${fmt(s.line)}.` : `${d.name} has cleared ${it ? 'it' : `${fmt(s.line)} ${label.toLowerCase()}`} in ${s.over} of ${s.of} ${s.of === 1 ? 'game' : 'games'}.`;
    const sents = [one(A, sa, labA, false), one(B, sb, labB, same && sa.line != null && sa.line === sb.line)];
    const ov = sa.gs.map(g => day(g.date)).filter(x => sb.gs.some(g => day(g.date) === x)), M = meet();
    if (cb && cb.n && cb.line != null && cb.of) sents.push(`Their combined line of ${fmt(cb.line)} has cleared in ${cb.over} of ${cb.of} overlapping game ${cb.of === 1 ? 'date' : 'dates'}.`, splitText(split(cb.rows.map(r => r.t)), cb.n));
    else if (ov.length) sents.push(`They played on the same date ${ov.length} ${ov.length === 1 ? 'time' : 'times'} in these games.`, splitText(split(ov.map(x => M.get(x) || 'apart')), ov.length));
    else if (!none && C.preset !== 'without') sents.push('None of these games fell on the same date.');
    const W2 = Math.max(280, W);
    const lanes = [['a', A, sa, labA], ['b', B, sb, labB]].map(([k, d, s, label]) => ({ key: k, name: d.name, stat: label, line: s.line, posted: s.posted?.line ?? null, avg: s.avg, sAvg: s.sAvg,
      pts: s.gs.map(g => ({ day: day(g.date), v: g.v[s.st], opp: g.oppAbbr || g.opp, home: g.home })) }));
    if (C.mode === 'sum' && cb?.n) lanes.push({ key: 'sum', name: 'Together', stat: labA, line: cb.line, posted: cb.posted, avg: cb.avg, sAvg: null, pts: cb.rows.map(r => ({ day: r.day, v: r.a + r.b, opp: r.opp, home: null })) });
    const svg = sa.n || sb.n ? chart(lanes, W2, same) : '';
    const allDays = [...new Set([...sa.gs, ...sb.gs].map(g => day(g.date)))].sort().reverse();
    const byDay = (s, x) => s.gs.find(g => day(g.date) === x);
    const last = s => esc(s.split(' ').slice(-1)[0]);
    const gameTable = `<details class="lc-tbl"><summary>See every game in the chart</summary><div class="tbx-wrap"><table class="tbx"><caption class="sr-only">Every game in the chart, newest first</caption><thead><tr><th scope="col">Date</th><th scope="col" class="r">${last(A.name)}${same ? '' : ` (${esc(labA.toLowerCase())})`}</th><th scope="col" class="r">${last(B.name)}${same ? '' : ` (${esc(labB.toLowerCase())})`}</th><th scope="col">Same date</th></tr></thead>
      <tbody>${allDays.map(x => { const ga = byDay(sa, x), gb = byDay(sb, x), t = ga && gb ? M.get(x) || 'apart' : '', cell = (g, s) => g ? `${fmt(g.v[s.st])}${s.line != null && g.v[s.st] !== s.line ? ` <span class="lb">${g.v[s.st] > s.line ? 'over' : 'under'}</span>` : ''}` : '<span class="lb">–</span>';
        return `<tr><td class="num">${esc(short(x))}</td><td class="r num">${cell(ga, sa)}</td><td class="r num">${cell(gb, sb)}</td><td>${t === 'h2h' ? 'Against each other' : t === 'team' ? 'Same game' : t === 'apart' ? 'Separate games' : ''}</td></tr>` }).join('')}</tbody></table></div></details>`;
    const combo = cb && cb.n ? `<section class="lc-combo" aria-labelledby="cmpComboH"><div class="sec-h"><h3 id="cmpComboH">Together, on the dates both played</h3><span class="lb">${cb.n} ${cb.n === 1 ? 'date' : 'dates'}${cb.n < 5 ? ' · small sample' : ''}</span></div>
        <div class="lc-combo-r"><dl class="lc-dl"><div><dt>Combined average</dt><dd class="num">${fmt(cb.avg)}</dd></div><div><dt>Over the combined line</dt><dd class="num">${cb.line == null ? '–' : cb.of ? `${cb.over} of ${cb.of}` : '–'}</dd></div></dl>
          <label class="lc-line"><span class="lb">Combined line</span><input class="inp num" type="number" step="0.5" min="0" inputmode="decimal" data-cmpline="sum" value="${cb.line ?? ''}" placeholder="none" aria-label="Combined line"></label></div>
        ${C.mode === 'sum' ? '' : bars(cb.rows.map(r => r.a + r.b), cb.line, `${A.name} plus ${B.name}, ${labA}, ${cb.n} dates`, Math.min(720, W2))}
        <details class="lc-tbl"><summary>See the dates</summary><div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col" class="r">${last(A.name)}</th><th scope="col" class="r">${last(B.name)}</th><th scope="col" class="r">Together</th><th scope="col">Game</th></tr></thead>
          <tbody>${cb.rows.map(r => `<tr><td class="num">${esc(short(r.day))}</td><td>${esc(r.opp || '')}</td><td class="r num">${fmt(r.a)}</td><td class="r num">${fmt(r.b)}</td><td class="r num"><b>${fmt(r.a + r.b)}</b></td><td>${r.t === 'h2h' ? 'Against each other' : r.t === 'team' ? 'Same game' : 'Separate games'}</td></tr>`).join('')}</tbody></table></div></details></section>`
      : cb ? `<p class="lb">${esc(A.name)} and ${esc(B.name)} have no ${esc(labA.toLowerCase())} on the same date in these games, so there is no combined line.</p>` : '';
    const opps = [nextOpp(A), nextOpp(B)];
    const statSel = (k, cur, list, label) => `<label class="lc-stat"><span class="lb">${esc(label)}</span><select class="inp" data-cmpstat="${k}">${list.map(s => `<option value="${esc(s.k)}"${s.k === cur ? ' selected' : ''}>${esc(s.l)}</option>`).join('')}</select></label>`;
    return `<div class="lc-opts">
        ${radios('Compare', MODES, C.mode, 'data-cmpmode')}
        ${C.mode === 'diff' ? statSel('a', C.stat, A.stats, `Stat for ${A.name}`) + statSel('b', C.statB, B.stats, `Stat for ${B.name}`) : statSel('a', C.stat, st, 'Stat')}
      </div>
      <div class="lc-opts">
        ${radios('Games', WINDOWS, C.win, 'data-cmpwin')}
        ${radios('Venue', VENUES, C.venue, 'data-cmpven')}
        ${opps.some(Boolean) ? `<button type="button" class="cx sm" aria-pressed="${C.vs === 'opp'}" data-cmpvs="opp">Only against tonight’s opponent</button>` : ''}
      </div>
      ${radios('Which games', presets(), C.preset, 'data-cmppre', 'cx-row')}
      ${C.vs === 'opp' ? `<p class="lb lc-note">Tonight: ${esc(A.name)} ${opps[0] ? `v ${esc(opps[0])}` : 'has no game posted'}, ${esc(B.name)} ${opps[1] ? `v ${esc(opps[1])}` : 'has no game posted'}.</p>` : ''}
      ${lead ? `<p class="lc-lead"><b>${esc(lead)}</b> <span class="lb">${esc(none ? within : scope)}.</span></p>` : ''}
      <p class="lc-sum">${sents.map(esc).join(' ')}</p>
      ${svg ? `<figure class="lc-fig"><div class="lc-cw">${svg}</div>
        <figcaption class="lc-key"><span><i class="k-p c-a" aria-hidden="true"></i>${esc(A.name)}</span><span><i class="k-p d c-b" aria-hidden="true"></i>${esc(B.name)}</span>${C.mode === 'sum' && cb?.n ? '<span><i class="k-p s c-sum" aria-hidden="true"></i>Together</span>' : ''}
          <span><i class="k-h" aria-hidden="true"></i>Filled: cleared the line</span><span><i class="k-m" aria-hidden="true"></i>Hollow: under it</span>
          <span><i class="k-ln" aria-hidden="true"></i>Line (drag the handle, or focus it and use the arrow keys)</span><span><i class="k-av" aria-hidden="true"></i>Average of these games</span><span><i class="k-sa" aria-hidden="true"></i>Season average</span><span><i class="k-pm" aria-hidden="true"></i>Posted line</span>
          <span><i class="k-bd" aria-hidden="true"></i>Both played that date</span><span><i class="k-bh" aria-hidden="true"></i>Played each other</span></figcaption>
        ${gameTable}</figure>` : `<p class="lc-none">No games match. Try “Every game”, “Home and away” or a longer window.</p>`}
      <div class="lc-cols">${tile(A, sa, 'a', labA)}${tile(B, sb, 'b', labB)}</div>
      ${combo}`;
  }
  // the combined section's own bars, newest on the right (kept for Same stat; Combined total draws it in the shared chart)
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
  // which element had focus, as a selector that finds its replacement after the redraw
  function focusKey(h) {
    const act = document.activeElement; if (!act || !h.contains(act)) return '';
    if (act.id) return '#' + CSS.escape(act.id);
    return act.getAttributeNames().filter(a => a.startsWith('data-cmp')).map(a => `[${a}="${CSS.escape(act.getAttribute(a))}"]`).join('');
  }
  function draw() {
    const h = C.host; if (!h || !document.contains(h)) return;
    const act = document.activeElement, keep = focusKey(h), caret = act?.selectionStart;
    const W = Math.round((h.querySelector('.lc-cw')?.clientWidth || h.clientWidth - 2) || 640); C.w = h.clientWidth;
    h.innerHTML = `<div class="lc">
      <div class="lc-top"><div class="seg" role="radiogroup" aria-label="Sport">${SPORTS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${C.sport === k}" class="${C.sport === k ? 'on' : ''}" tabindex="${C.sport === k ? 0 : -1}" data-cmpsport="${k}">${l}</button>`).join('')}</div>
        ${C.a || C.b ? '<button type="button" class="lk" data-cmp="swap">Swap the two</button><button type="button" class="lk" data-cmp="clear">Start again</button>' : ''}
        ${C.a?.d && C.b?.d && window.flBoards ? `<button type="button" class="bt ghost sm lc-save" data-cmp="save">${ic('save', 16)}Save to board</button>` : ''}</div>
      <div class="lc-slots${C.a?.d && C.b?.d ? ' both' : ''}">${slotHTML('a')}<span class="lc-vs" aria-hidden="true">v</span>${slotHTML('b')}</div>
      <div class="lc-res">${resultHTML(W)}</div></div>`;
    // the chart was drawn for the width the last one had; the first time, measure again and redraw at the real width
    const cw = h.querySelector('.lc-cw'); if (cw && Math.abs(cw.clientWidth - W) > 8 && !C._re) { C._re = true; draw(); C._re = false; return }
    // one short spoken line when the answer changes, from a region that survives the redraw
    let sayEl = document.getElementById('lcSay'); if (!sayEl) { sayEl = document.createElement('p'); sayEl.id = 'lcSay'; sayEl.className = 'sr-only'; sayEl.setAttribute('role', 'status'); h.after(sayEl) }
    const line = h.querySelector('.lc-sum')?.textContent.trim() || '';
    if (line && sayEl.textContent !== line) sayEl.textContent = line;
    if (keep) { const el = h.querySelector(keep); if (el) { el.focus({ preventScroll: true }); if (caret != null && el.setSelectionRange && el.type === 'search') try { el.setSelectionRange(caret, caret) } catch (e) {} } }
    // the view, for "Continue researching", once both players are in and whenever the view changes
    const it = cmpItem(); if (it && it.key !== C.noted) { C.noted = it.key; try { window.flRecent?.note(it) } catch (e) {} }
  }
  function focusSlot(k) { const h = C.host; if (!h) return; if (C[k]?.d) (h.querySelector(`[data-cmp="change"][data-k="${k}"]`))?.focus({ preventScroll: true }); else h.querySelector('#lc-' + k)?.focus({ preventScroll: true }) }
  // search a slot: tonight's players with a line in this sport first, then ESPN's player search for the sport
  const ESPN = 'https://site.api.espn.com/apis/common/v3/search', OK_LG = { nba: ['nba'], wnba: ['wnba'], nfl: ['nfl'], nhl: ['nhl'], mlb: ['mlb'] };
  let qT = 0;
  function find(k, q) {
    clearTimeout(qT); C.q[k] = q; const n = q.trim().toLowerCase();
    if (n.length < 2) { C.hits[k] = null; C.sel[k] = -1; return draw() }
    qT = setTimeout(async () => {
      const mine = [...new Map((window.flEdge?.all() || []).filter(p => p.sport === C.sport && p.name.toLowerCase().includes(n)).map(p => [p.name, { name: p.name, sub: [p.team, 'line posted today'].filter(Boolean).join(' · '), img: p.photo }])).values()].slice(0, 4);
      let es = [];
      try { const sp = SPORTS.find(s => s[0] === C.sport)[2], d = await (typeof cj === 'function' ? cj : u => fetch(u).then(r => r.json()))(`${ESPN}?query=${encodeURIComponent(q.trim())}&type=player&sport=${sp}&limit=8`);
        es = (d.items || []).filter(x => C.sport === 'soccer' || (OK_LG[C.sport] || []).includes(x.league || x.defaultLeagueSlug)).map(x => ({ name: x.displayName, sub: [x.teamRelationships?.[0]?.displayName, x.isRetired ? 'retired' : ''].filter(Boolean).join(' · '), img: x.headshot?.href || '' })) } catch (e) {}
      if (C.q[k] !== q) return;
      const seen = new Set(), all = [...mine, ...es].filter(x => x.name && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase())).slice(0, 7);
      C.hits[k] = all.length ? all : [{ name: q.trim(), sub: `Look up “${q.trim()}” in ${NAME[C.sport]}`, img: '' }]; C.sel[k] = -1; draw();
    }, 200);
  }
  function put(k, name) { C.hits[k] = null; C.sel[k] = -1; C.q[k] = ''; load(k, name) }
  function dragTo(ev) {
    const D = C.drag; if (!D) return; const svg = D.el.ownerSVGElement, rc = svg.getBoundingClientRect(), H = svg.viewBox.baseVal.height || rc.height;
    const py = (ev.clientY - rc.top) * (H / rc.height), y0 = +D.el.dataset.y0, y1 = +D.el.dataset.y1, lo = +D.el.dataset.lo, max = +D.el.dataset.max;
    const v = Math.max(lo, Math.min(max, Math.round((lo + (y0 - py) / (y0 - y1) * (max - lo)) * 2) / 2));
    if (v !== D.v) { D.v = v; setLine(D.key, v); paint(D.key, v) }
  }
  function wire(host) {
    if (host.dataset.cmpWired) return; host.dataset.cmpWired = 1;
    host.addEventListener('input', ev => { const t = ev.target;
      if (t.id === 'lc-a' || t.id === 'lc-b') return find(t.id.slice(-1), t.value);
      if (t.dataset.cmpline) { const v = t.value === '' ? null : +t.value; setLine(t.dataset.cmpline, v); clearTimeout(t._t); t._t = setTimeout(draw, 350) } });
    host.addEventListener('change', ev => { const t = ev.target; if (!t.matches('[data-cmpstat]')) return; if (t.dataset.cmpstat === 'b') C.statB = t.value; else C.stat = t.value; C.sum = null; draw() });
    host.addEventListener('keydown', ev => { const t = ev.target;
      const hd = t.closest?.('[data-cmphd]');
      if (hd) { const k = hd.dataset.cmphd, lo = +hd.dataset.lo, max = +hd.dataset.max, cur = +hd.getAttribute('aria-valuenow') || 0;
        const d = { ArrowUp: .5, ArrowRight: .5, ArrowDown: -.5, ArrowLeft: -.5, PageUp: 2.5, PageDown: -2.5 }[ev.key];
        let v = null;
        if (d != null) v = Math.max(lo, Math.min(max, (hd.classList.contains('off') ? cur : cur + d)));
        else if (ev.key === 'Home') v = lo; else if (ev.key === 'End') v = max; else return;
        ev.preventDefault(); setLine(k, v); return draw() }
      if (t.id !== 'lc-a' && t.id !== 'lc-b') return; const k = t.id.slice(-1), hs = C.hits[k] || [];
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && hs.length) { ev.preventDefault(); C.sel[k] = ev.key === 'ArrowDown' ? (C.sel[k] + 1) % hs.length : (C.sel[k] - 1 + hs.length) % hs.length; return draw() }
      if (ev.key === 'Enter') { ev.preventDefault(); const h = hs[C.sel[k] >= 0 ? C.sel[k] : 0]; if (h) put(k, h.name); else if (t.value.trim().length > 1) put(k, t.value.trim()) }
      if (ev.key === 'Escape' && hs.length) { ev.preventDefault(); ev.stopPropagation(); C.hits[k] = null; draw() } });
    // drag the line: pointer capture on the handle, live repaint while moving, one full redraw on release
    host.addEventListener('pointerdown', ev => { const hd = ev.target.closest?.('[data-cmphd]'); if (!hd || ev.button > 0) return; ev.preventDefault(); hd.focus({ preventScroll: true });
      C.drag = { key: hd.dataset.cmphd, el: hd, v: null }; try { hd.setPointerCapture(ev.pointerId) } catch (e) {} hd.classList.add('drag'); dragTo(ev) });
    host.addEventListener('pointermove', ev => { if (C.drag) dragTo(ev) });
    const up = () => { if (!C.drag) return; C.drag = null; draw() };
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up); host.addEventListener('lostpointercapture', up);
    host.addEventListener('click', ev => { const t = ev.target;
      const pk = t.closest('[data-cmppick]'); if (pk) { const [k, i] = pk.dataset.cmppick.split('|'); const h = C.hits[k]?.[+i]; return h && put(k, h.name) }
      const sp = t.closest('[data-cmpsport]'); if (sp) { if (C.sport !== sp.dataset.cmpsport) { C.sport = sp.dataset.cmpsport; C.a = C.b = null; C.stat = C.statB = ''; C.lines = {}; C.sum = null; C.hits = { a: null, b: null } } return draw() }
      const w = t.closest('[data-cmpwin]'); if (w) { C.win = +w.dataset.cmpwin; return draw() }
      const md = t.closest('[data-cmpmode]'); if (md) { C.mode = md.dataset.cmpmode; C.sum = null; pickStat(); return draw() }
      const vn = t.closest('[data-cmpven]'); if (vn) { C.venue = vn.dataset.cmpven; return draw() }
      const vs = t.closest('[data-cmpvs]'); if (vs) { C.vs = C.vs === 'opp' ? 'any' : 'opp'; return draw() }
      const pr = t.closest('[data-cmppre]'); if (pr) { C.preset = pr.dataset.cmppre; return draw() }
      const b = t.closest('[data-cmp]'); if (!b) return; const a = b.dataset.cmp, k = b.dataset.k;
      if (a === 'change') { C[k] = null; C.sum = null; draw(); return focusSlot(k) }
      if (a === 'lab') return C.api?.openPlayer({ sport: C.sport, name: C[k].d.name, stat: statOf(k), line: lineOf(k) });
      if (a === 'save') { const it = cmpItem(); return it && window.flBoards?.offer(it, b) }
      if (a === 'swap') { [C.a, C.b] = [C.b, C.a]; if (C.mode === 'diff') [C.stat, C.statB] = [C.statB, C.stat]; C.lines = Object.fromEntries(Object.entries(C.lines).map(([key, v]) => [key.replace(/^[ab]/, m => m === 'a' ? 'b' : 'a'), v])); return draw() }
      if (a === 'clear') { C.a = C.b = null; C.stat = C.statB = ''; C.lines = {}; C.sum = null; draw(); return focusSlot('a') } });
    // drag a player card (anything with data-cmpdrag) onto a slot
    host.addEventListener('dragover', ev => { const z = ev.target.closest('[data-cmpdrop]'); if (!z || !ev.dataTransfer.types.includes('application/x-fl-player')) return; ev.preventDefault(); z.classList.add('over') });
    host.addEventListener('dragleave', ev => ev.target.closest?.('[data-cmpdrop]')?.classList.remove('over'));
    host.addEventListener('drop', ev => { const z = ev.target.closest('[data-cmpdrop]'); if (!z) return; ev.preventDefault(); z.classList.remove('over');
      try { const p = JSON.parse(ev.dataTransfer.getData('application/x-fl-player')); if (p.sport && p.sport !== C.sport && NAME[p.sport]) { C.sport = p.sport; C.a = C.b = null; C.stat = '' } if (p.stat) C.stat = p.stat; put(z.dataset.cmpdrop, p.name) } catch (e) {} });
    // the chart is drawn at the width it has; a new width draws it again
    if (window.ResizeObserver) { let rT = 0; new ResizeObserver(() => { if (Math.abs(host.clientWidth - C.w) < 12 || C.drag) return; clearTimeout(rT); rT = setTimeout(draw, 120) }).observe(host) }
  }
  /* open Compare. o: { sport, name } puts one player in the first slot; a saved comparison
     { sport, a, b, stat, statB, win, preset, mode, venue, vs } reopens with both players and every choice */
  function compare(host, o = {}, api) {
    C.host = host; C.api = api; wire(host);
    if (o.sport && NAME[o.sport] && o.sport !== C.sport) { C.sport = o.sport; C.a = C.b = null; C.stat = C.statB = ''; C.lines = {} }
    if (o.a && o.b) {
      if (MODES.some(m => m[0] === o.mode)) C.mode = o.mode; else C.mode = 'same';
      if (o.stat) C.stat = o.stat; C.statB = o.statB || '';
      if (o.win != null && WINDOWS.some(w => w[0] === +o.win)) C.win = +o.win;
      C.preset = ['all', 'both', 'h2h', 'without'].includes(o.preset) ? o.preset : 'all';
      C.venue = VENUES.some(v => v[0] === o.venue) ? o.venue : 'all'; C.vs = o.vs === 'opp' ? 'opp' : 'any'; C.lines = {}; C.sum = null;
      const fresh = k => !(C[k]?.d && nm(C[k].name) === nm(o[k]));
      if (fresh('a')) load('a', o.a); if (fresh('b')) load('b', o.b);
      if (!fresh('a') && !fresh('b')) { pickStat(); draw() }
      return;
    }
    if (o.stat) C.stat = o.stat;
    if (o.name && C.a?.name !== o.name) { C.b = null; load('a', o.name) } else draw();
    if (!o.name) setTimeout(() => focusSlot(C.a ? 'b' : 'a'), 80);
  }
  // any card with data-cmpdrag='{"sport","name","stat"}' can be dragged into Compare
  document.addEventListener('dragstart', ev => { const c = ev.target.closest?.('[data-cmpdrag]'); if (!c) return; ev.dataTransfer.setData('application/x-fl-player', c.dataset.cmpdrag); ev.dataTransfer.setData('text/plain', JSON.parse(c.dataset.cmpdrag).name || ''); ev.dataTransfer.effectAllowed = 'copy' });

  /* ---------------- Trends ---------------- */
  /* Filters are the ones today's board can answer: sport and league, stat, the side of the run, how many games stand
     behind the line, home or away games only, the book that posts the line, and when the game starts. The board has no
     game dates, opponent rankings or starting roles, so there is no filter for rest days, opponent strength or role. */
  const GROUP = { nba: 'Basketball', wnba: 'Basketball', nfl: 'Football', nhl: 'Hockey', mlb: 'Baseball', soccer: 'Soccer' };
  const TIMES = [['early', 'Before 5 pm'], ['mid', '5 pm to 8 pm'], ['late', '8 pm or later']];
  const F0 = { sport: '', lg: '', stat: '', side: '', min: 0, venue: 'all', book: '', time: '', order: 'long' };
  const FKEY = 'fl.trends.filters';
  const T = { host: null, api: null, q: '', f: (() => { try { return { ...F0, ...JSON.parse(sessionStorage.getItem(FKEY) || '{}') } } catch (e) { return { ...F0 } } })(), more: false, rows: {} };
  const FLAB = { sport: 'Sport', lg: 'League', stat: 'Stat', side: 'Side', min: 'Minimum sample', venue: 'Games counted', book: 'Posted on', time: 'Game time' };
  const vgames = (p, venue) => (p.games || []).filter(g => g.v != null && (venue === 'all' || !venue || g.home === (venue === 'home')));
  function streak(p, venue) {   // how many games in a row, newest first, on the side of the line the latest one landed
    const vs = vgames(p, venue).map(g => g.v).filter(v => v !== p.line); if (!vs.length) return null;
    const over = vs[0] > p.line; let n = 0; for (const v of vs) { if ((v > p.line) !== over) break; n++ }
    return { n, over };
  }
  function shift(p, venue) {
    const vs = vgames(p, venue).map(g => g.v); if (vs.length < 12) return null;
    const a5 = mean(vs.slice(0, 5)), a20 = mean(vs.slice(0, 20));
    return a20 ? { a5, a20, pct: (a5 - a20) / Math.max(1, Math.abs(a20)) } : null;
  }
  // the market's chance of the over at exactly this line, the books' margin already out (the same reading as edge.js)
  const mOver = p => { const pr = (p.offers || []).filter(o => o.pOver != null && o.line === p.line); return pr.length ? mean(pr.map(o => o.pOver)) : null };
  const oneIn = P => P >= .67 ? 'most of the time' : P < .001 ? 'less than 1 time in 1,000' : `about 1 time in ${Math.round(1 / P).toLocaleString()}`;
  /* is the run a surprise? The chance of n in a row on that side is p^n, with p from the market's price when a book posts
     a two-sided one, else from the player's own hit rate over the games behind the line. At 10% or more the run is
     ordinary for that price; under 5% it is longer than the price expects. */
  function context(p, s, venue) {
    const side = s.over ? 'over' : 'under', m = mOver(p), mk = m == null ? null : s.over ? m : 1 - m;
    const gs = vgames(p, venue).filter(g => g.v !== p.line), hit = gs.filter(g => s.over ? g.v > p.line : g.v < p.line).length, b = gs.length ? hit / gs.length : null;
    const ref = mk != null ? 'market' : b != null && gs.length >= 8 ? 'baseline' : null;
    if (!ref) return { P: null, label: '', why: `Only ${games(gs.length)} behind this line, too few to say whether the run is unusual.`, tone: 'n' };
    const pr = ref === 'market' ? mk : b, P = Math.pow(Math.min(1, Math.max(0, pr)), s.n), what = ref === 'market' ? 'the market price' : 'their own hit rate';
    const label = P >= .1 ? `Long streak, but consistent with ${what}` : P < .05 ? `Longer than expected based on ${ref === 'market' ? 'the market' : 'their own hit rate'}` : `A little long for ${what}`;
    const base = `Baseline: ${side} in ${hit} of ${gs.length} games behind the line (${pct(b)}%).`;
    const why = ref === 'market' ? `Market: ${pct(mk)}% ${side}. A ${s.n}-game run happens ${oneIn(P)} at that price. ${base}` : `No book posts a two-sided price at this line. ${base} A ${s.n}-game run happens ${oneIn(P)} at that rate.`;
    return { P, ref, label, why, tone: P >= .1 ? 'ok' : P < .05 ? 'rare' : 'n' };
  }
  const tbucket = p => { const d = p.start ? new Date(p.start) : null; if (!d || isNaN(d)) return ''; const h = d.getHours(); return h < 17 ? 'early' : h < 20 ? 'mid' : 'late' };
  // does a pick pass every filter (side is checked on the run, not here); skip leaves one filter out, to say which one to loosen
  function passes(p, f, skip) {
    const on = k => k !== skip;
    if (on('sport') && f.sport && GROUP[p.sport] !== f.sport) return false;
    if (on('lg') && f.lg && p.sport !== f.lg) return false;
    if (on('stat') && f.stat && p.label !== f.stat) return false;
    if (on('min') && f.min && vgames(p, on('venue') ? f.venue : 'all').length < f.min) return false;
    if (on('book') && f.book && !(p.books || []).includes(f.book)) return false;
    if (on('time') && f.time && tbucket(p) !== f.time) return false;
    return true;
  }
  const uniq = xs => { const seen = new Set(); return xs.filter(x => !seen.has(x.p.sport + x.p.name) && seen.add(x.p.sport + x.p.name)) };   // one row per player in each list
  function lists(pool, f, skip) {
    const venue = skip === 'venue' ? 'all' : f.venue, pp = pool.filter(p => passes(p, f, skip));
    let runs = pp.map(p => ({ p, s: streak(p, venue) })).filter(x => x.s && x.s.n >= 4 && (skip === 'side' || !f.side || (f.side === 'over') === x.s.over)).map(x => ({ ...x, c: context(x.p, x.s, venue) }));
    runs = runs.sort((a, b) => f.order === 'rare' ? (a.c.P ?? 2) - (b.c.P ?? 2) || b.s.n - a.s.n : b.s.n - a.s.n || (a.c.P ?? 2) - (b.c.P ?? 2));
    const moves = pp.map(p => ({ p, m: shift(p, venue) })).filter(x => x.m && Math.abs(x.m.pct) >= 0.15).sort((a, b) => Math.abs(b.m.pct) - Math.abs(a.m.pct));
    return { runs: uniq(runs), up: uniq(moves.filter(x => x.m.pct > 0)), down: uniq(moves.filter(x => x.m.pct < 0)) };
  }
  const spark = vs => { if (vs.length < 2) return ''; const W = 96, H = 26, max = Math.max(...vs), min = Math.min(...vs), r = max - min || 1, o = [...vs].reverse();
    return `<svg class="tr-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${o.map((v, i) => `${(i / (o.length - 1) * (W - 4) + 2).toFixed(1)},${(H - 3 - (v - min) / r * (H - 6)).toFixed(1)}`).join(' ')}"/></svg>` };
  const trItem = (p, sub) => ({ kind: 'trend', key: `trend:${p.sport}:${p.name}:${p.k}:${p.line}`, label: `${p.name}, ${String(p.label || p.k).toLowerCase()}`, sub, photo: p.photo || '', open: { trend: { sport: p.sport, name: p.name, stat: p.k, line: p.line } } });
  function trendRow(x, note, id, sub) {
    const p = x.p, args = window.flEdge.labArgs(p); T.rows[id] = trItem(p, sub);
    const c = x.c;
    return `<li class="tr-li"><button type="button" class="tr-row" data-tropen="${esc(JSON.stringify({ ...args, mode: 'trend' }))}" data-trid="${id}" draggable="true" data-cmpdrag="${esc(JSON.stringify({ sport: p.sport, name: p.name, stat: p.k }))}">${face(p.photo, p.name)}<span class="tr-t"><b>${esc(p.name)}</b><small>${esc(`${p.label} · line ${fmt(p.line)}`)}</small></span>
      <span class="tr-r"><span class="tr-note">${note}</span>${spark((p.games || []).slice(0, 10).map(g => g.v).filter(v => v != null))}</span></button>
      ${window.flBoards ? `<button type="button" class="ib tr-save" data-trsave="${id}" aria-label="Save ${esc(p.name)}, ${esc(String(p.label).toLowerCase())}, to a board">${ic('save', 18)}</button>` : ''}
      ${c ? `<p class="tr-ctx ${c.tone}">${c.label ? `<b>${esc(c.label)}</b> ` : ''}<span>${esc(c.why)}</span></p>` : ''}</li>`;
  }
  const saveF = () => { try { sessionStorage.setItem(FKEY, JSON.stringify(T.f)) } catch (e) {} };
  const active = f => Object.keys(FLAB).filter(k => k === 'venue' ? f.venue !== 'all' : !!f[k]);
  const fText = (k, v) => k === 'min' ? `${v}+ games` : k === 'venue' ? (v === 'home' ? 'home games' : 'away games') : k === 'time' ? TIMES.find(t => t[0] === v)?.[1] : k === 'side' ? `${v} runs` : k === 'lg' ? NAME[v] : v;
  let noteT = 0;
  function trends(host, o = {}, api) {
    T.host = host; T.api = api; T.rows = {};
    if (o.filters && typeof o.filters === 'object') { T.f = { ...F0, ...o.filters }; saveF() }
    if (o.sport && NAME[o.sport] && T.oSport !== o.sport) { T.oSport = o.sport; T.f.sport = GROUP[o.sport]; T.f.lg = '' }
    const f = T.f, picks = window.flEdge ? window.flEdge.all() : [];
    const pool = picks.filter(p => !p.yes);
    // the choices each filter offers come from today's lines, so no option leads to nothing
    const inSport = pool.filter(p => !f.sport || GROUP[p.sport] === f.sport), inLg = inSport.filter(p => !f.lg || p.sport === f.lg);
    const sportsOn = [...new Set(pool.map(p => GROUP[p.sport]).filter(Boolean))], lgs = [...new Set(inSport.map(p => p.sport))];
    const statsOn = [...new Set(inLg.map(p => p.label).filter(Boolean))].sort(), booksOn = [...new Set(inLg.flatMap(p => p.books || []))].sort(), timesOn = TIMES.filter(t => inLg.some(p => tbucket(p) === t[0]));
    const L = lists(pool, f), loading = window.flEdge && !picks.length && !T.tried;
    const act = active(f), focus = (() => { const a = document.activeElement; if (!a || !host.contains(a)) return ''; if (a.id) return '#' + CSS.escape(a.id); const n = a.getAttributeNames().find(x => x.startsWith('data-tr')); return n ? `[${n}="${CSS.escape(a.getAttribute(n))}"]` : '' })();
    // nothing left: the filter that, loosened, brings back the most runs
    const loosen = () => { let best = null; for (const k of act) { const n = lists(pool, f, k).runs.length; if (n && (!best || n > best.n)) best = { k, n } } return best };
    const sel = (k, label, opts, cur) => `<label class="tr-fl"><span class="lb">${label}</span><select class="inp" id="trf-${k}" data-trf="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    const filters = pool.length ? `<fieldset class="card tr-f"><legend class="tr-fh">Filter today’s trends</legend><div class="tr-fg">
        ${sportsOn.length > 1 ? sel('sport', 'Sport', [['', 'Every sport'], ...sportsOn.map(s => [s, s])], f.sport) : ''}
        ${lgs.length > 1 && f.sport ? sel('lg', 'League', [['', `Every ${f.sport.toLowerCase()} league`], ...lgs.map(l => [l, NAME[l]])], f.lg) : ''}
        ${sel('stat', 'Stat', [['', 'Every stat'], ...statsOn.map(s => [s, s])], f.stat)}
        ${sel('side', 'Side of the run', [['', 'Either side'], ['over', 'Over runs'], ['under', 'Under runs']], f.side)}
        ${sel('min', 'Minimum sample', [[0, 'Any sample'], [10, '10+ games'], [20, '20+ games'], [40, '40+ games']], f.min)}
        ${sel('venue', 'Games counted', [['all', 'All games'], ['home', 'Home only'], ['away', 'Away only']], f.venue)}
        ${booksOn.length > 1 ? sel('book', 'Posted on', [['', 'Any book'], ...booksOn.map(b => [b, b])], f.book) : ''}
        ${timesOn.length > 1 ? sel('time', 'Game time (your time)', [['', 'Any time'], ...timesOn], f.time) : ''}
        ${sel('order', 'Order runs by', [['long', 'Longest first'], ['rare', 'Least expected first']], f.order)}
      </div><div class="tr-fs"><p class="tr-count" role="status"><b class="num">${L.runs.length}</b> ${L.runs.length === 1 ? 'run matches' : 'runs match'} · <b class="num">${L.up.length}</b> heating up · <b class="num">${L.down.length}</b> cooling off</p>
        ${act.length ? `<button type="button" class="lk" data-trclear="all">Clear filters</button>` : ''}</div></fieldset>` : '';
    const runEmpty = () => { if (loading) return 'Reading today’s lines…'; if (!pool.length) return 'No lines are posted yet today. Check back closer to game time.'; if (!act.length) return 'Nothing stands out here on today’s lines.';
      const b = loosen(); return b ? `No runs match these filters. Loosen “${FLAB[b.k]}” (${esc(fText(b.k, f[b.k]))}) and ${b.n} ${b.n === 1 ? 'run matches' : 'runs match'}. <button type="button" class="lk" data-trclear="${b.k}">Clear ${esc(FLAB[b.k].toLowerCase())}</button>` : 'No runs match these filters. <button type="button" class="lk" data-trclear="all">Clear filters</button>' };
    const list = (title, sub, rows, note, empty, lid, extra = '') => `<section class="card tr-card" aria-labelledby="tr-${lid}"><header><h3 id="tr-${lid}">${title}</h3><p class="lb">${sub}</p></header>
      ${rows.length ? `<ul class="tr-list">${rows.map((x, i) => trendRow(x, note(x), `${lid}-${i}`, note(x).replace(/<[^>]+>/g, ''))).join('')}</ul>${extra}` : `<p class="lb tr-empty">${empty()}</p>`}</section>`;
    const runRows = T.more ? L.runs : L.runs.slice(0, 6);
    const moveEmpty = () => loading ? 'Reading today’s lines…' : act.length && pool.length ? 'No player matches these filters here. Loosen one above.' : 'Nothing stands out here on today’s lines.';
    host.innerHTML = `<div class="ltr">
      <form class="tr-ask card" data-trask><label class="lb" for="trQ">Trend for any player</label><div class="lc-in">${ic('search', 18)}<input class="inp" id="trQ" type="search" autocomplete="off" placeholder="Type a player’s name" value="${esc(T.q)}"><button class="bt sm" type="submit">Show the trend</button></div>
        <p class="lb">Or start from today’s lines below. Every trend opens that player’s games as a line, with the average and the posted line.</p></form>
      ${filters}
      <div class="g3 tr-grid">
        ${list('Longest runs', `Games in a row on one side of today’s line${f.venue !== 'all' ? `, ${f.venue} games only` : ''}, against the price`, runRows, x => `<b class="num">${x.s.n}</b> straight ${x.s.over ? 'over' : 'under'}`, runEmpty, 'runs',
          L.runs.length > 6 ? `<button type="button" class="lk tr-more" data-trmore aria-expanded="${T.more}">${T.more ? 'Show the top 6' : `Show all ${L.runs.length}`}</button>` : '')}
        ${list('Heating up', 'Last 5 games against the last 20', L.up.slice(0, 5), x => `<b class="num">${fmt(x.m.a5)}</b> <span class="lb">from ${fmt(x.m.a20)}</span>`, moveEmpty, 'up')}
        ${list('Cooling off', 'Last 5 games against the last 20', L.down.slice(0, 5), x => `<b class="num">${fmt(x.m.a5)}</b> <span class="lb">from ${fmt(x.m.a20)}</span>`, moveEmpty, 'down')}
      </div>
      <p class="lb">Counted from the games behind each posted line. The chance of a run is the price (or the hit rate) multiplied game by game, as if each game were independent. A run says what happened, not what happens next.</p></div>`;
    if (focus) host.querySelector(focus)?.focus({ preventScroll: true });
    if (!host.dataset.trWired) { host.dataset.trWired = 1;
      host.addEventListener('click', ev => {
        const sv = ev.target.closest('[data-trsave]'); if (sv) { const it = T.rows[sv.dataset.trsave]; return it && window.flBoards?.offer(it, sv) }
        const cl = ev.target.closest('[data-trclear]'); if (cl) { const k = cl.dataset.trclear; if (k === 'all') T.f = { ...F0, order: T.f.order }; else T.f[k] = F0[k]; if (k === 'sport' || k === 'all') T.f.lg = ''; saveF(); trends(host, {}, T.api); return host.querySelector('#trf-stat, #trQ')?.focus({ preventScroll: true }) }
        if (ev.target.closest('[data-trmore]')) { T.more = !T.more; return trends(host, {}, T.api) }
        const r = ev.target.closest('[data-tropen]'); if (!r) return; let a = {}; try { a = JSON.parse(r.dataset.tropen) } catch (e) {}
        try { const it = T.rows[r.dataset.trid]; if (it) window.flRecent?.note(it) } catch (e) {}
        T.api?.openPlayer(a) });
      host.addEventListener('change', ev => { const s = ev.target.closest('[data-trf]'); if (!s) return; const k = s.dataset.trf;
        T.f[k] = k === 'min' ? +s.value : s.value; if (k === 'sport') T.f.lg = ''; if (k === 'sport' || k === 'lg') { T.f.stat = ''; T.f.book = ''; T.f.time = '' }
        saveF(); trends(host, {}, T.api);
        // the chosen filters, for "Continue researching" (only once they settle, and only when some are set)
        clearTimeout(noteT); noteT = setTimeout(() => { const a = active(T.f); if (!a.length) return;
          try { window.flRecent?.note({ kind: 'filters', key: 'trends:' + JSON.stringify(T.f), label: `Trends: ${a.map(k => fText(k, T.f[k])).join(', ')}`, sub: host.querySelector('.tr-count')?.textContent.trim() || '', open: { page: 'trends', filters: { ...T.f } } }) } catch (e) {} }, 1200) });
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
  window.flLabTools = { compare, trends, add, state: C, _t: { streak, shift, summary, combined, meet, context, lists, cmpItem } };
})();
