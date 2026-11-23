/* Floodlight · parlays: the data and the sums behind the tracker. parlays.js draws the page, me.js reads the record.

   A parlay is a list of legs, locked in before their games start. A leg is one of:
     prop    a player over or under a line (the lines the Lab's board posts today)
     win     a team to win            draw   a soccer match to end level
     total   both teams' points over or under a line
     spread  a team with a head start or a handicap

   Where the numbers come from, and nothing else is used:
     scores and clocks   ESPN's public scoreboards, the same ones Home and Live read
     a player's count    the game's ESPN box score, read while the game is on
     live odds           /api/odds/board: what Kalshi, FanDuel, DraftKings and Polymarket post right now
     our live read       worked out here from the score, the time left and what was expected before the start.
                         It is an estimate, and the page says so: the method is in read() below.
   A leg that can't be matched to a game or a player is left waiting. It is never guessed. */
(() => {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const norm = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const num = x => { if (x == null || x === '' || x === '--' || x === '-') return null; const n = parseFloat(String(x).replace(/,/g, '')); return isNaN(n) ? null : n };
  const fmt = v => v == null ? '–' : Number.isInteger(v) ? String(v) : (+(+v).toFixed(1)).toString();

  /* ---------- leagues ----------
     per/len: periods and seconds in each. sd: how far a final margin usually lands from what was expected, in points.
     tsd: the same for the total. tot: a usual total, used only when no book posts one. pois: low scoring, counted goal by goal. */
  const LG = {
    nba: { name: 'NBA', sport: 'basketball', path: 'basketball/nba', kind: 'clock', per: 4, len: 720, sd: 12.5, tsd: 18, tot: 228, unit: 'points', board: ['basketball', 'nba', 'NBA'] },
    wnba: { name: 'WNBA', sport: 'basketball', path: 'basketball/wnba', kind: 'clock', per: 4, len: 600, sd: 11.5, tsd: 15, tot: 164, unit: 'points', board: ['basketball', 'wnba', 'WNBA'] },
    cbb: { name: 'College basketball', sport: 'basketball', path: 'basketball/mens-college-basketball', qs: '&groups=50&limit=200', kind: 'clock', per: 2, len: 1200, sd: 11, tsd: 15, tot: 146, unit: 'points' },
    nfl: { name: 'NFL', sport: 'football', path: 'football/nfl', kind: 'clock', per: 4, len: 900, sd: 13.5, tsd: 13.5, tot: 45, unit: 'points', board: ['football', 'nfl', 'NFL'] },
    cfb: { name: 'College football', sport: 'football', path: 'football/college-football', qs: '&groups=80&limit=200', kind: 'clock', per: 4, len: 900, sd: 16, tsd: 16, tot: 52, unit: 'points', board: ['football', 'fbs', 'NCAAF'] },
    nhl: { name: 'NHL', sport: 'hockey', path: 'hockey/nhl', kind: 'clock', per: 3, len: 1200, pois: true, tot: 6.1, tie: 'ot', unit: 'goals' },
    mlb: { name: 'MLB', sport: 'baseball', path: 'baseball/mlb', kind: 'innings', pois: true, tot: 8.8, tie: 'ot', unit: 'runs', board: ['baseball', 'mlb', 'MLB'] },
    soccer: { name: 'Soccer', sport: 'soccer', path: 'soccer/all', kind: 'minutes', pois: true, tot: 2.7, tie: 'draw', unit: 'goals', board: ['soccer', '', ''] },
  };
  const KX_SOCCER = { 'eng.1': 'EPL', 'esp.1': 'LALIGA', 'ger.1': 'BUNDESLIGA', 'ita.1': 'SERIEA', 'fra.1': 'LIGUE1', 'por.1': 'LIGAPORTUGAL', 'ned.1': 'EREDIVISIE', 'sco.1': 'SCOTTISHPREM', 'tur.1': 'SUPERLIG', 'eng.2': 'EFLCHAMPIONSHIP',
    'uefa.champions': 'UCL', 'uefa.europa': 'UEL', 'uefa.europa.conf': 'UECL', 'eng.fa': 'FACUP', 'eng.league_cup': 'EFLCUP', 'usa.1': 'MLS', 'mex.1': 'LIGAMX', 'bra.1': 'BRASILEIRO', 'ksa.1': 'SAUDIPL', 'arg.1': 'ARGPREMDIV' };
  // a Lab stat -> the name the odds board files the same bet under
  const BOARD_CAT = { pts: 'points', reb: 'rebounds', ast: 'assists', pra: 'pra', pr: 'pr', pa: 'pa', ra: 'ra', '3pm': 'threes', stl: 'steals', blk: 'blocks',
    pyd: 'pass_yds', ryd: 'rush_yds', reyd: 'rec_yds', rec: 'receptions', ptd: 'pass_td', patt: 'pass_att', pcmp: 'pass_cmp', ratt: 'rush_att', rryd: 'rush_rec_yds', pint: 'int',
    h: 'hits', tb: 'total_bases', hrr: 'hrr', rbi: 'rbi', r: 'runs', hr: 'home_runs', pk: 'strikeouts', shots: 'shots', sot: 'sot', assists: 'assists', passes: 'passes', tackles: 'tackles' };

  /* ---------- sums ---------- */
  const erf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + .3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x)) };
  const Phi = z => .5 * (1 + erf(z / Math.SQRT2));
  // the inverse of Phi (Acklam's approximation), for turning a chance to win into an expected margin
  function PhiInv(p) {
    p = clamp(p, 1e-6, 1 - 1e-6);
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-.007784894002430293, -.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [.007784695709041462, .3224671290700398, 2.445134137142996, 3.754408661907416];
    if (p < .02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
    if (p > 1 - .02425) return -PhiInv(1 - p);
    const q = p - .5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const pois = (lam, n = 16) => { const out = []; let t = Math.exp(-lam); for (let i = 0; i < n; i++) { out.push(t); t *= lam / (i + 1) } return out };
  // the chance a count that is at `cur` finishes above `line`, with `lam` more expected
  const poisOver = (cur, lam, line) => { const need = Math.floor(line - cur) + 1; if (need <= 0) return 1; let s = 0, t = Math.exp(-lam); for (let i = 0; i < need; i++) { s += t; t *= lam / (i + 1) } return clamp(1 - s, 0, 1) };
  // low-scoring games: every way the rest of the game can go, given each side's expected goals from here
  function grid(la, lb, fn) { const A = pois(Math.max(.0001, la)), B = pois(Math.max(.0001, lb)); let s = 0; for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) s += A[i] * B[j] * fn(i, j); return s }
  const split = (t0, m0) => { const a = clamp((t0 + m0) / 2, t0 * .12, t0 * .88); return [a, t0 - a] };
  // before the start: the margin a side is expected to win by, from its chance to win
  function marginFrom(L, p, t0) {
    if (p == null) return 0;
    if (!L.pois) return L.sd * PhiInv(clamp(p, .03, .97));
    const win = d => { const [a, b] = split(t0, d); return grid(a, b, (i, j) => i > j ? 1 : i === j && L.tie === 'ot' ? .5 : 0) };
    let lo = -t0, hi = t0; for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (win(mid) < p) lo = mid; else hi = mid } return (lo + hi) / 2;
  }
  // American odds
  const dec = am => am > 0 ? 1 + am / 100 : 1 + 100 / -am;
  const amFromP = p => p == null || p <= .003 || p >= .997 ? null : p >= .5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
  const amTxt = am => am == null ? '–' : am > 0 ? '+' + am : '−' + Math.abs(am);

  /* ---------- scoreboards ---------- */
  const etDay = d => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '') } catch { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` } };
  const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  const getJ = (url, ms = 10000) => timeout(fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }), ms);
  const api = (url, body) => fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.status = r.status; throw e } return d });
  const mlP = o => { const n = parseFloat(o); if (!isFinite(n) || !n) return null; return n < 0 ? -n / (-n + 100) : 100 / (n + 100) };
  const hex = c => c && /^[0-9a-f]{6}$/i.test(c) ? '#' + c : '';

  function game(ev, c, lg) {
    const st = c.status || ev.status || {}, ty = st.type || {}, cs = c.competitors || [];
    const side = x => { const t = x?.team || {}; return { id: String(t.id || ''), name: t.shortDisplayName || t.name || t.displayName || '', full: t.displayName || t.name || '', abbr: t.abbreviation || '', nick: t.name || '', place: t.location || '',
      logo: t.logo || t.logos?.[0]?.href || '', color: hex(t.color), score: num(x?.score?.value ?? x?.score?.displayValue ?? x?.score), winner: !!x?.winner } };
    const home = side(cs.find(x => x.homeAway === 'home') || cs[0]), away = side(cs.find(x => x.homeAway === 'away') || cs[1]);
    const o = c.odds?.[0]; let odds = null;
    if (o) {
      const h = mlP(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds), a = mlP(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds), d = mlP(o.drawOdds?.moneyLine ?? o.moneyline?.draw?.close?.odds);
      const sum = (h || 0) + (a || 0) + (d || 0), fair = h && a ? { home: h / sum, away: a / sum, draw: d ? d / sum : null } : null;   // the book's margin taken out
      // the spread, as the home team's line: minus when the home team gives points
      let sp = num(o.spread);
      if (sp != null) { const fav = o.homeTeamOdds?.favorite === true ? 'home' : o.awayTeamOdds?.favorite === true ? 'away' : (() => { const m = /^([A-Z0-9&.' -]+?)\s+[-+−]?\d/.exec(o.details || ''); return m ? (norm(m[1]) === norm(home.abbr) ? 'home' : norm(m[1]) === norm(away.abbr) ? 'away' : null) : null })();
        sp = fav === 'home' ? -Math.abs(sp) : fav === 'away' ? Math.abs(sp) : sp }
      odds = { fair, spread: sp, total: num(o.overUnder), book: o.provider?.name || '' };
    }
    const detail = ty.shortDetail || ty.detail || '';
    return { lg, eid: String(ev.id || c.id || ''), slug: ev.league?.slug || c.league?.slug || slugs.get(String(ev.id || c.id || '')) || '', league: ev.league?.abbreviation || ev.league?.name || LG[lg].name, date: new Date(c.date || ev.date), state: ty.state || 'pre',
      off: /postpon|cancel|suspend|abandon/i.test(ty.description || ty.name || '') ? (ty.description || 'Postponed') : '',
      period: st.period || 0, clock: typeof st.clock === 'number' ? st.clock : null, display: st.displayClock || '', detail, outs: c.situation?.outs ?? null, home, away, odds };
  }
  const boards = new Map();   // league|day -> { at, promise, games }
  function scoreboard(lg, day, force) {
    const L = LG[lg]; if (!L) return Promise.resolve([]);
    const k = lg + '|' + day, c = boards.get(k);
    if (c && !force && (c.promise || Date.now() - c.at < 20000)) return c.promise || Promise.resolve(c.games);
    // the one schedule request (schedule.js) when the league has a group id, so the builder lists the same games as the sport page
    const grp = /groups=(\d+)/.exec(L.qs || '')?.[1] || null;
    const promise = (window.flSched ? window.flSched.day({ path: L.path, group: grp, day }, force).then(r => r.status === 'error' ? Promise.reject(new Error(r.error)) : r.raw)
      : getJ(`${ESPN}${L.path}/scoreboard?dates=${day}${L.qs || ''}`)).then(d => (d.events || []).flatMap(ev => (ev.competitions || []).slice(0, 1).map(cp => game(ev, cp, lg))))
      .then(games => { boards.set(k, { at: Date.now(), games }); return games })
      .catch(() => { boards.set(k, { at: c?.games ? Date.now() - 12000 : 0, games: c?.games || [], failed: true }); return c?.games || [] });
    boards.set(k, { at: c?.at || 0, games: c?.games || [], promise });
    return promise;
  }
  const sameTeam = (want, t) => { const n = norm(want); if (!n || !t) return false; const names = [t.abbr, t.name, t.full, t.nick, t.place].map(norm).filter(Boolean);
    return names.includes(n) || (n.length > 3 && names.some(x => x.length > 3 && (x.endsWith(' ' + n) || n.endsWith(' ' + x) || x.startsWith(n + ' ') || n.startsWith(x + ' ')))) };
  // the game a leg belongs to: by its id when the leg has one, else by its two teams, on the day it starts (and the day either side, for late tip-offs)
  async function gameFor(leg, force) {
    const at = new Date(leg.start), days = [etDay(at), etDay(new Date(+at - 864e5)), etDay(new Date(+at + 864e5))];
    for (const d of days) {
      const games = await scoreboard(leg.lg, d, force);
      // with no id, the two teams' game nearest the pick's start time (a doubleheader has two the same day)
      const hit = leg.eid ? games.find(g => g.eid === leg.eid)
        : games.filter(g => { const a = leg.home || leg.team, b = leg.away || leg.opp; if (!a) return false;
            const ok = (x, y) => sameTeam(x, g.home) && (!y || sameTeam(y, g.away)); return (ok(a, b) || (sameTeam(a, g.away) && (!b || sameTeam(b, g.home)))) && Math.abs(g.date - at) < 10 * 36e5 })
          .sort((x, y) => Math.abs(x.date - at) - Math.abs(y.date - at))[0];
      if (hit) return hit;
      if (leg.eid && games.length && d === days[0] && Math.abs(Date.now() - at) > 6 * 864e5) break;
    }
    return null;
  }

  /* ---------- how much of the game is left: 1 before the start, 0 at the end ---------- */
  function left(L, g) {
    if (g.state === 'pre') return 1; if (g.state === 'post') return 0;
    if (L.kind === 'innings') { const inn = Math.max(1, g.period || 1), d = g.detail || '';
      const done = /^end/i.test(d) ? inn * 6 : /^mid/i.test(d) ? (inn - 1) * 6 + 3 : (inn - 1) * 6 + (/^bot/i.test(d) ? 3 : 0) + (g.outs || 0);
      return clamp(1 - done / 54, .02, 1) }
    if (L.kind === 'minutes') { const m = /^(\d+)/.exec(g.display || g.detail || ''), min = /^ht|half/i.test(g.detail || g.display || '') ? 45 : m ? +m[1] : g.clock != null ? g.clock / 60 : 45; return clamp((90 - min) / 90, .012, 1) }
    const per = Math.max(1, g.period || 1), all = L.per * L.len;
    if (per > L.per) return clamp((g.clock ?? 60) / all, .003, .05);   // overtime: a few minutes at most
    return clamp(((L.per - per) * L.len + (g.clock ?? L.len)) / all, .003, 1);
  }

  /* ---------- box scores: one player's count in one game ---------- */
  const sums = new Map();   // path|eid -> { at, promise, data }
  function summary(lg, g, force) {
    const L = LG[lg], path = L.sport === 'soccer' && g.slug ? 'soccer/' + g.slug : L.path, k = path + '|' + g.eid, c = sums.get(k);
    if (c && !force && (c.promise || Date.now() - c.at < (g.state === 'post' ? 3600e3 : 20000))) return c.promise || Promise.resolve(c.data);
    const promise = getJ(`${ESPN}${path}/summary?event=${encodeURIComponent(g.eid)}`, 12000).then(data => { sums.set(k, { at: Date.now(), data }); return data }).catch(() => { sums.set(k, { at: c?.data ? Date.now() - 10000 : 0, data: c?.data || null }); return c?.data || null });
    sums.set(k, { at: c?.at || 0, data: c?.data || null, promise });
    return promise;
  }
  // every player in the box, by name: { group: { LABEL: value } } plus soccer's named stats
  function boxPlayers(raw) {
    const out = new Map();
    const add = (ath, group, labels, stats, dnp) => { const n = norm(ath?.displayName || ath?.fullName || ath?.shortName); if (!n) return; const p = out.get(n) || { name: ath.displayName || ath.fullName, groups: {}, dnp: false };
      const row = p.groups[group] || (p.groups[group] = {}); labels.forEach((l, i) => { if (stats[i] != null && stats[i] !== '') row[String(l).toUpperCase()] = stats[i] });
      if (dnp && !stats.length) p.dnp = true; out.set(n, p) };
    for (const t of raw?.boxscore?.players || []) for (const st of t.statistics || []) {
      const group = String(st.type || st.name || 'all').toLowerCase(), labels = st.labels?.length ? st.labels : st.names || st.keys || [];
      for (const a of st.athletes || []) add(a.athlete, group, labels, a.stats || [], a.didNotPlay);
    }
    for (const r of raw?.rosters || []) for (const a of r.roster || []) {
      const st = a.stats || []; if (!a.athlete) continue;
      add(a.athlete, 'soccer', st.map(s => s.name), st.map(s => s.value ?? s.displayValue), false);
      const p = out.get(norm(a.athlete.displayName || a.athlete.fullName)); if (p) p.played = !!(a.starter || a.subbedIn || a.subbedIn?.didSub);
    }
    return out;
  }
  function findPlayer(players, name) {
    const n = norm(name); if (players.has(n)) return players.get(n);
    const parts = n.split(' '), last = parts[parts.length - 1], first = parts[0]?.[0];
    const near = [...players.entries()].filter(([k]) => { const p = k.split(' '); return p[p.length - 1] === last && p[0]?.[0] === first });
    return near.length === 1 ? near[0][1] : null;
  }
  const pair = x => { const m = /^(\d+)\s*[-/]\s*(\d+)$/.exec(String(x ?? '').trim()); return m ? [+m[1], +m[2]] : [null, null] };
  const plus = (...xs) => xs.some(x => x == null) ? null : xs.reduce((a, b) => a + b, 0);
  const plus0 = (...xs) => xs.every(x => x == null) ? null : xs.reduce((a, b) => a + (b || 0), 0);
  // each stat the box score can count, by sport. A stat that is not here has no live count, and its leg says so.
  const STAT = {
    basketball(p, k) { const r = Object.assign({}, ...Object.values(p.groups)), n = (...ls) => { for (const l of ls) { const v = num(r[l]); if (v != null) return v } return null };
      const pts = n('PTS'), reb = n('REB'), ast = n('AST'), stl = n('STL'), blk = n('BLK'), to = n('TO'), tp = pair(r['3PT'] ?? r['3PM-A']), fg = pair(r.FG ?? r['FGM-A']), ft = pair(r.FT ?? r['FTM-A']);
      return ({ pts, reb, ast, stl, blk, to, pf: n('PF'), min: n('MIN'), '3pm': tp[0], '3pa': tp[1], fgm: fg[0], fga: fg[1], ftm: ft[0], fta: ft[1], pra: plus(pts, reb, ast), pr: plus(pts, reb), pa: plus(pts, ast), ra: plus(reb, ast), stocks: plus(stl, blk),
        fs: pts == null ? null : pts + 1.2 * (reb || 0) + 1.5 * (ast || 0) + 3 * (blk || 0) + 3 * (stl || 0) - (to || 0), dd: pts == null ? null : +([pts, reb, ast, stl, blk].filter(x => (x || 0) >= 10).length >= 2) })[k] },
    football(p, k) { const G = (g, ...ls) => { const r = p.groups[g]; if (!r) return null; for (const l of ls) { const v = num(r[l]); if (v != null) return v } return null }, ca = pair(p.groups.passing?.['C/ATT']), fgk = pair(p.groups.kicking?.FG);
      const ry = G('rushing', 'YDS'), cy = G('receiving', 'YDS'), py = G('passing', 'YDS'), rt = G('rushing', 'TD'), ct = G('receiving', 'TD');
      return ({ pyd: py, ptd: G('passing', 'TD'), pcmp: ca[0], patt: ca[1], pint: G('passing', 'INT'), ryd: ry, ratt: G('rushing', 'CAR'), rlng: G('rushing', 'LONG', 'LNG'), rec: G('receiving', 'REC'), reyd: cy, tgt: G('receiving', 'TGTS'),
        relng: G('receiving', 'LONG', 'LNG'), rryd: plus0(ry, cy), pryd: py == null ? null : py + (ry || 0), td: plus0(rt, ct), kpts: G('kicking', 'PTS'), fgm: fgk[0], tkl: G('defensive', 'TOT'), sck: G('defensive', 'SACKS', 'SACK') })[k] },
    hockey(p, k) { const r = Object.assign({}, ...Object.values(p.groups)), n = (...ls) => { for (const l of ls) { const v = num(r[l]); if (v != null) return v } return null }, g = n('G'), a = n('A'), sa = n('SA'), ga = n('GA');
      const toi = (() => { const m = /^(\d+):(\d\d)$/.exec(String(r.TOI ?? '')); return m ? +m[1] + +m[2] / 60 : null })();
      return ({ goals: g, ast: a, pts: plus(g, a), sog: n('S', 'SOG'), pm: n('+/-'), pim: n('PIM'), toi, g1: g == null ? null : +(g > 0), sv: n('SV', 'SVS') ?? (sa != null && ga != null ? sa - ga : null), ga, sa })[k] },
    baseball(p, k) { const B = p.groups.batting || {}, P = p.groups.pitching || {}, b = (...ls) => { for (const l of ls) { const v = num(B[l]); if (v != null) return v } return null }, q = (...ls) => { for (const l of ls) { const v = num(P[l]); if (v != null) return v } return null };
      const h = b('H'), r = b('R'), rbi = b('RBI'), ip = P.IP != null ? String(P.IP) : null, outs = ip == null ? null : (m => m ? +m[1] * 3 + +(m[2] || 0) : null)(/^(\d+)(?:\.(\d))?$/.exec(ip));
      return ({ h, r, rbi, hr: b('HR'), bb: b('BB'), so: b('K', 'SO'), hrr: plus(h, r, rbi), pk: q('K', 'SO'), pha: q('H'), per: q('ER'), pbb: q('BB'), pout: outs, pc: q('PC', '#P') ?? pair(P['PC-ST'])[0] })[k] },
    soccer(p, k) { const r = p.groups.soccer || {}, n = l => num(r[l.toUpperCase()]), g = n('totalGoals'), a = n('goalAssists');
      return ({ goals: g, assists: a, ga: plus(g, a), shots: n('totalShots'), sot: n('shotsOnTarget'), fouls: n('foulsCommitted'), saves: n('saves'), cards: plus0(n('yellowCards'), n('redCards')) })[k] },
  };
  const hasLive = leg => { const f = STAT[LG[leg.lg]?.sport]; if (!f) return false; try { return f({ groups: {} }, leg.k) !== undefined } catch { return false } };
  // -> { v, seen } : the count so far, and whether the player is in the box at all
  function boxValue(leg, raw) {
    const L = LG[leg.lg], f = STAT[L?.sport]; if (!raw || !f) return { v: null, seen: false };
    const p = findPlayer(boxPlayers(raw), leg.player); if (!p) return { v: null, seen: false };
    let v; try { v = f(p, leg.k) } catch { v = null }
    return { v: v === undefined ? null : v, seen: true, dnp: p.dnp };
  }

  /* ---------- our live read ----------
     One method for every leg: what has happened so far is fixed, and the rest of the game is expected to go the way the
     whole game was expected to go before it started, scaled to the time left. Games with many points (basketball, football)
     use a bell curve that narrows as the clock runs down; games with few (hockey, baseball, soccer) are counted goal by goal.
     -> { p (chance this leg hits, 0 to 1, null when there is nothing to go on), state, cur, need, live } */
  function read(leg, g, box) {
    const L = LG[leg.lg]; if (!L) return { p: leg.ours0 ?? leg.market0 ?? null, state: 'wait', note: 'This league is not followed live.' };
    if (leg.res) return { p: leg.res === 'hit' ? 1 : leg.res === 'miss' ? 0 : null, state: leg.res, final: leg.final };
    const p0 = start0(leg);
    if (!g) return { p: p0, state: Date.now() < leg.start ? 'pre' : 'lost-track', note: Date.now() < leg.start ? '' : 'This game is not on the scoreboard, so the pick is waiting.' };
    if (g.off) return { p: null, state: 'void', note: g.off };
    if (g.state === 'pre') return { p: p0, state: 'pre' };
    const f = left(L, g), done = g.state === 'post', hs = g.home.score ?? 0, as = g.away.score ?? 0, T = hs + as, t0 = leg.t0 || L.tot;
    const out = (state, extra) => ({ p: state === 'hit' ? 1 : state === 'miss' ? 0 : null, state, f: 0, ...extra });
    const live = (p, extra) => ({ p: clamp(p, .005, .995), state: 'live', f, ...extra });

    if (leg.type === 'prop') {
      const cur = box?.v, over = leg.side !== 'under', lab = String(leg.label || '').toLowerCase();
      if (cur == null) {
        if (done) return { p: null, state: 'settle', note: hasLive(leg) && box && !box.seen ? 'Not in the box score. Checking the game log.' : 'Waiting for the final count.' };
        if (hasLive(leg) && L.sport === 'football' && box) return propLive(0);   // football lists a player only once he has a touch
        return { p: p0, state: 'live', f, note: hasLive(leg) ? 'Not in the box score yet.' : 'No live count for this stat. It settles after the game.' };
      }
      if (done) return out(cur === leg.line ? 'push' : (cur > leg.line) === over ? 'hit' : 'miss', { cur, final: cur });
      return propLive(cur);
      function propLive(c) {
        const mu = leg.mu ?? leg.line, w = .5 * (1 - f), rest = Math.max(0, (1 - w) * mu * f + (f < 1 ? w * (c / (1 - f)) * f : 0));
        const count = leg.yes || (Number.isInteger(leg.line * 2) && mu < 9);
        const sd = Math.max(.6, (leg.sd || Math.sqrt(Math.max(mu, 1))) * Math.sqrt(f));
        const pOver = c > leg.line ? 1 : count ? poisOver(c, rest, leg.line) : 1 - Phi((leg.line - c - rest) / sd);
        const need = leg.line - c;
        if (c > leg.line) return over ? { p: 1, state: 'live', f, cur: c, there: true, need: 0 } : { p: 0, state: 'live', f, cur: c, gone: true };
        return live(over ? pOver : 1 - pOver, { cur: c, need: over ? Math.floor(need) + 1 : null, room: over ? null : need, proj: c + rest, lab });
      }
    }
    const mine = leg.side === 'away' ? as - hs : hs - as, m0 = leg.m0 || 0, score = `${g.away.abbr || g.away.name} ${as}, ${g.home.abbr || g.home.name} ${hs}`;
    if (leg.type === 'win' || leg.type === 'draw') {
      if (done) { const level = hs === as && !(g.home.winner || g.away.winner);
        if (leg.type === 'draw') return out(level ? 'hit' : 'miss', { final: score });
        const won = L.tie === 'draw' ? mine > 0 : (leg.side === 'away' ? g.away.winner : g.home.winner) || mine > 0;
        return out(won ? 'hit' : level && L.tie !== 'draw' ? 'push' : 'miss', { final: score }) }
      if (L.pois) { const [a, b] = split(t0, m0).map(x => x * f);
        const p = leg.type === 'draw' ? grid(a, b, (i, j) => +(hs - as + i - j === 0)) : grid(a, b, (i, j) => { const d = mine + i - j; return d > 0 ? 1 : d === 0 && L.tie === 'ot' ? .5 : 0 });
        return live(p, { cur: score, margin: leg.type === 'draw' ? hs - as : mine }) }
      return live(Phi((mine + m0 * f) / (L.sd * Math.sqrt(f))), { cur: score, margin: mine });
    }
    if (leg.type === 'spread') {
      const x = mine + leg.line;
      if (done) return out(x === 0 ? 'push' : x > 0 ? 'hit' : 'miss', { final: score });
      if (L.pois) { const [a, b] = split(t0, m0).map(v => v * f);
        return live(grid(a, b, (i, j) => { const d = mine + i - j; if (d === 0 && L.tie === 'ot') return .5 * (1 + leg.line > 0) + .5 * (-1 + leg.line > 0); return +(d + leg.line > 0) }), { cur: score, margin: mine, cover: x }) }
      return live(Phi((x + m0 * f) / (L.sd * Math.sqrt(f))), { cur: score, margin: mine, cover: x });
    }
    if (leg.type === 'total') {
      const over = leg.side !== 'under';
      if (done) return out(T === leg.line ? 'push' : (T > leg.line) === over ? 'hit' : 'miss', { cur: T, final: T });
      const w = (L.pois ? .35 : .6) * (1 - f), rest = (1 - w) * t0 * f + (f < 1 ? w * (T / (1 - f)) * f : 0);
      const pOver = T > leg.line ? 1 : L.pois ? poisOver(T, rest, leg.line) : 1 - Phi((leg.line - T - rest) / (L.tsd * Math.sqrt(f)));
      if (T > leg.line) return over ? { p: 1, state: 'live', f, cur: T, there: true } : { p: 0, state: 'live', f, cur: T, gone: true };
      return live(over ? pOver : 1 - pOver, { cur: T, need: over ? Math.floor(leg.line - T) + 1 : null, room: over ? null : leg.line - T, proj: T + rest, total: true });
    }
    return { p: p0, state: 'wait' };
  }

  // a leg's chance before the start: the Lab's number, else the books', else this method run with the whole game still to play
  const FRESH = L => ({ state: 'in', home: { score: 0, abbr: '', name: '' }, away: { score: 0, abbr: '', name: '' }, period: 1, clock: L.len ?? null, display: "0'", detail: 'Top 1st', outs: 0 });
  function start0(leg) {
    if (leg.ours0 != null) return leg.ours0; if (leg.market0 != null) return leg.market0;
    const L = LG[leg.lg]; if (!L || (leg.type === 'prop' && leg.mu == null)) return null;
    try { return read({ ...leg, ours0: .5, res: undefined }, FRESH(L), leg.type === 'prop' ? { v: 0, seen: true } : null).p ?? null } catch { return null }
  }

  /* ---------- the chance every leg hits ----------
     Legs from different games are independent, so their chances multiply. Legs from one game move together, so for those
     only the limits are known. p is the plain product; lo and hi are the limits when two legs share a game. */
  function combine(legs, get) {
    const groups = new Map(); let p = 1;
    for (const l of legs) { const v = get(l); if (v == null) return null; p *= v; const k = l.gameKey || l.id; groups.set(k, [...(groups.get(k) || []), v]) }
    let lo = 1, hi = 1, linked = false;
    for (const ps of groups.values()) { if (ps.length === 1) { lo *= ps[0]; hi *= ps[0] } else { linked = true; lo *= Math.max(0, ps.reduce((a, b) => a + b, 0) - (ps.length - 1)); hi *= Math.min(...ps) } }
    return { p, lo, hi, linked };
  }

  /* ---------- how two picks relate ----------
     relate(a, b) -> { level, dir, why }
       level  'independent' | 'slight' | 'strong' | 'conflict' (the two can't both hit)
       dir    'together' (one hitting makes the other more likely) | 'against' (less likely) | null (linked, either way)
       why    one plain sentence, shown on the ticket
     It reads only what a leg knows: its game, type, side, team, player, opponent, stat (k), sport and line. Nothing is
     looked up and nothing is measured: these are rules of thumb about what kind of picks move together.

     The rules, first match wins:
       same pick twice                                   conflict
       different games                                   independent
       one player, one stat, over and under              conflict when the over's line is at or above the under's,
                                                         else strong, against (both hit only in the gap between)
       one player, one stat, one side, two lines         strong, together
       one player, two stats that overlap (points and    strong; two stats that don't overlap (points and rebounds)
         points + rebounds + assists, yards and catches) slight. Together when both ask for a big night, else against
       both teams to win                                 conflict
       a winner and a draw                               conflict
       two spreads in one game                           conflict (both sides, or one side at two lines: pick one)
       total over and under                              conflict when the over's line is at or above the under's
       a spread and a winner                             same team: strong, together. Other team: conflict when the
                                                         spread team gives points (covering means winning), else strong, against
       a draw and a spread                               conflict when the spread team gives points, strong together when it gets them
       a draw and the total                              slight: together with the under, against the over
       a winner and the total                            slight, either way
       a spread and the total                            slight: favourite with the over, or underdog with the under, together
       a player and the total                            slight: a scoring stat over goes with the game over
       a player and a winner or spread                   slight: his team's scoring over goes with his team winning (together);
                                                         with the other team winning it pulls against (a possible conflict)
       a quarterback's passing and a teammate's catching strong, together when both are overs (or both unders)
       a goalie's saves and the other team's shots       strong, together
       a pitcher's strikeouts and the other team's hits  slight, against
       two players on one team                           slight, either way: one can take the other's chances
       two players on opposite teams                     slight: scoring overs together (a fast, open game helps both)
       anything else in one game                         slight, either way */
  const STALE_MIN = 30;   // a price read longer ago than this asks to be refreshed before a parlay is locked in
  const FAM = {
    pass: new Set(['pyd', 'ptd', 'pcmp', 'patt', 'pryd']), catch: new Set(['reyd', 'rec', 'tgt', 'relng', 'rryd']),
    shots: new Set(['sog', 'sot', 'shots']), saves: new Set(['sv', 'saves']), bat: new Set(['h', 'tb', 'hrr', 'r', 'rbi', 'hr'])
  };
  // stats that overlap: one counts part of the other, or both count the same plays
  const OVERLAP = [['pts', 'pra', 'pr', 'pa', 'fs', '3pm'], ['reb', 'pra', 'pr', 'ra'], ['ast', 'pra', 'pa', 'ra'], ['pyd', 'ptd', 'pcmp', 'patt', 'pryd'], ['reyd', 'rec', 'tgt', 'rryd', 'relng'],
    ['ryd', 'ratt', 'rryd', 'pryd', 'rlng'], ['h', 'tb', 'hrr', 'hr', 'r', 'rbi'], ['goals', 'pts', 'g1', 'sog', 'ga', 'shots', 'sot'], ['pk', 'pout'], ['assists', 'ga']];
  // [helps his team win, pushes the total up] for an over. Most stats are both; these are the exceptions.
  const TILT = { football: { pint: [-1, 0], tkl: [0, 0], sck: [0, 0] }, basketball: { reb: [0, 0], stl: [0, 0], blk: [0, 0], to: [-1, 0], pf: [0, 0], min: [0, 0] },
    baseball: { pk: [1, -1], pout: [1, -1], pha: [-1, 1], per: [-1, 1], pbb: [-1, 1], pc: [0, 0], bb: [1, 0], so: [-1, 0] },
    hockey: { sv: [0, 0], ga: [-1, 1], sa: [0, 1], pim: [0, 0], toi: [0, 0], pm: [1, 0] }, soccer: { saves: [0, 0], fouls: [0, 0], cards: [0, 0] } };
  const sportOf = l => LG[l.lg]?.sport || l.sport || '';
  const tilt = l => { const t = TILT[sportOf(l)]?.[l.k] || [1, 1], s = l.side === 'under' ? -1 : 1; return [t[0] * s, t[1] * s] };
  const nameEq = (x, y) => { const a = norm(x), b = norm(y); return !!a && !!b && (a === b || (a.length > 3 && b.length > 3 && (a.endsWith(' ' + b) || b.endsWith(' ' + a)))) };
  const anyEq = (xs, ys) => xs.some(x => ys.some(y => nameEq(x, y)));
  // the names a leg's team goes by, and the other team's
  const sideNames = (l, s) => s === 'home' ? [l.home, l.homeAbbr] : [l.away, l.awayAbbr];
  const teamsOf = l => l.type === 'prop' ? [[l.team], [l.opp]].filter(x => x[0]) : [sideNames(l, 'home'), sideNames(l, 'away')].filter(x => x.some(Boolean));
  const ownTeam = l => l.type === 'prop' ? [l.team] : l.type === 'win' || l.type === 'spread' ? [l.team, ...sideNames(l, l.side)] : [];
  const otherTeam = l => l.type === 'prop' ? [l.opp] : l.type === 'win' || l.type === 'spread' ? sideNames(l, l.side === 'home' ? 'away' : 'home') : [];
  // one game: the same key, or the same league within a few hours with a team in common (a pick from the board and one from the scoreboard name the game differently)
  function sameGame(a, b) {
    if (a.gameKey && a.gameKey === b.gameKey) return true;
    if (a.lg !== b.lg || Math.abs((+a.start || 0) - (+b.start || 0)) > 6 * 36e5) return false;
    return teamsOf(a).some(x => teamsOf(b).some(y => anyEq(x.filter(Boolean), y.filter(Boolean))));
  }
  // where a player's team stands to a team pick: 'mate' (his team), 'opp' (the other team) or '' (can't tell)
  const rel = (prop, l) => { const mine = ownTeam(l).filter(Boolean), theirs = otherTeam(l).filter(Boolean);
    if (prop.team && anyEq([prop.team], mine)) return 'mate'; if (prop.team && anyEq([prop.team], theirs)) return 'opp'; if (prop.opp && anyEq([prop.opp], mine)) return 'opp'; return '' };
  const who = l => l.type === 'prop' ? String(l.player || '').split(' ').slice(-1)[0] : l.type === 'total' ? 'the total' : l.team || 'that team';
  const stat = l => String(l.label || l.k || 'stat').toLowerCase();
  const lineTxt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
  const R = (level, dir, why) => ({ level, dir, why });
  const lean = (s, yes, no, flat) => s > 0 ? R('slight', 'together', yes) : s < 0 ? R('slight', 'against', no) : R('slight', null, flat);
  const pairOf = (a, b, t1, t2) => a.type === t1 && b.type === t2 ? [a, b] : b.type === t1 && a.type === t2 ? [b, a] : null;
  const RULES = [
    [(a, b) => a.id === b.id, () => R('conflict', null, 'This is the same pick twice. Take one out.')],
    [(a, b, x) => !x.same, () => R('independent', null, 'Different games, so one result doesn’t change the other.')],
    [(a, b) => a.type === 'prop' && b.type === 'prop' && norm(a.player) === norm(b.player) && a.k === b.k, (a, b) => {
      if (a.side === b.side) return R('strong', 'together', `Both are ${who(a)}’s ${stat(a)}: if the harder line hits, the easier one does too.`);
      const o = a.side === 'under' ? b : a, u = o === a ? b : a;
      if (a.yes || o.line >= u.line) return R('conflict', null, o.line === u.line || a.yes ? `${a.player} can’t go both over and under ${a.yes ? '' : fmt(o.line) + ' '}${stat(a)} in one game. Keep one side.`
        : `${a.player} can’t go over ${fmt(o.line)} and under ${fmt(u.line)} ${stat(a)} in one game. Keep one side.`);
      return R('strong', 'against', `Both hit only if ${who(a)} lands between ${fmt(o.line)} and ${fmt(u.line)} ${stat(a)}.`) }],
    [(a, b) => a.type === 'prop' && b.type === 'prop' && norm(a.player) === norm(b.player), (a, b) => {
      const ta = tilt(a)[0] || (a.side === 'under' ? -1 : 1), tb = tilt(b)[0] || (b.side === 'under' ? -1 : 1), strong = OVERLAP.some(g => g.includes(a.k) && g.includes(b.k));
      return ta * tb > 0 ? R(strong ? 'strong' : 'slight', 'together', `Both are ${who(a)}’s numbers: a big night lifts both${strong ? ', and they count some of the same plays' : ''}.`)
        : R(strong ? 'strong' : 'slight', 'against', `These pull ${who(a)} in opposite directions: one needs a big night, the other a quiet one.`) }],
    [(a, b) => a.type === 'win' && b.type === 'win', () => R('conflict', null, 'Only one team can win this game. Keep one.')],
    [(a, b) => pairOf(a, b, 'win', 'draw'), () => R('conflict', null, 'A draw means neither team wins, so these can’t both hit. Keep one.')],
    [(a, b) => a.type === 'spread' && b.type === 'spread', (a, b) => R('conflict', null, a.side === b.side ? `${a.team} is in twice at two lines. Keep one spread for this game.` : 'These are both sides of one spread. Keep one.')],
    [(a, b) => a.type === 'total' && b.type === 'total', (a, b) => {
      if (a.side === b.side) return R('strong', 'together', 'Two lines on the same total: if the harder one hits, so does the other.');
      const o = a.side === 'under' ? b : a, u = o === a ? b : a;
      return o.line >= u.line ? R('conflict', null, `The total can’t be over ${fmt(o.line)} and under ${fmt(u.line)} at once. Keep one.`) : R('strong', 'against', `Both hit only if the total lands between ${fmt(o.line)} and ${fmt(u.line)}.`) }],
    [(a, b) => pairOf(a, b, 'spread', 'win'), (a, b) => { const [s, w] = pairOf(a, b, 'spread', 'win');
      if (s.side === w.side) return R('strong', 'together', `${w.team} winning and covering ${lineTxt(s.line)} usually go together.`);
      return s.line <= 0 ? R('conflict', null, `If ${s.team} covers ${lineTxt(s.line)}, ${s.team} wins, so ${w.team} can’t. Keep one.`)
        : R('strong', 'against', `Both hit only if ${w.team} wins by less than ${fmt(s.line)}.`) }],
    [(a, b) => pairOf(a, b, 'spread', 'draw'), (a, b) => { const [s] = pairOf(a, b, 'spread', 'draw');
      return s.line < 0 ? R('conflict', null, `A draw means ${s.team} doesn’t cover ${lineTxt(s.line)}. Keep one.`) : s.line > 0 ? R('strong', 'together', `A draw also covers ${s.team} ${lineTxt(s.line)}.`)
        : R('slight', null, `A draw makes ${s.team} ${lineTxt(s.line)} a push.`) }],
    [(a, b) => pairOf(a, b, 'draw', 'total'), (a, b) => { const [, t] = pairOf(a, b, 'draw', 'total');
      return lean(t.side === 'under' ? 1 : -1, 'Draws are more common when few goals go in.', 'A draw with plenty of goals is the less likely kind.', '') }],
    [(a, b) => pairOf(a, b, 'win', 'total'), () => R('slight', null, 'A winner and the total are only loosely linked: a high-scoring game can go either way.')],
    [(a, b) => pairOf(a, b, 'spread', 'total'), (a, b) => { const [s, t] = pairOf(a, b, 'spread', 'total'), fav = s.line < 0;
      return lean((fav ? 1 : -1) * (t.side === 'under' ? -1 : 1), fav ? `A favourite that covers has usually scored plenty, which helps the over.` : `Low-scoring games tend to stay close, which helps ${s.team} ${lineTxt(s.line)}.`,
        fav ? `A favourite that covers has usually scored plenty, which works against the under.` : `A high-scoring game tends to open up, which works against ${s.team} ${lineTxt(s.line)}.`, '') }],
    [(a, b) => pairOf(a, b, 'prop', 'total'), (a, b) => { const [p, t] = pairOf(a, b, 'prop', 'total'), s = tilt(p)[1] * (t.side === 'under' ? -1 : 1);
      return lean(s, `${who(p)}’s ${stat(p)} and the total tend to rise and fall together.`, `This needs ${who(p)} and the total to go opposite ways.`, `Same game, so they can move together a little.`) }],
    [(a, b) => pairOf(a, b, 'prop', 'draw'), (a, b) => R('slight', null, `Same game: ${who(pairOf(a, b, 'prop', 'draw')[0])}’s night and the result can move together.`)],
    [(a, b) => pairOf(a, b, 'prop', 'win') || pairOf(a, b, 'prop', 'spread'), (a, b) => { const [p, w] = pairOf(a, b, 'prop', 'win') || pairOf(a, b, 'prop', 'spread'), r = rel(p, w), t = tilt(p)[0];
      if (!r || !t) return R('slight', null, `Same game: ${who(p)}’s night and the result can move together.`);
      return r === 'mate' ? lean(t, `A big night from ${who(p)} helps ${w.team}.`, `This needs a quiet night from ${who(p)} while ${w.team} does well.`, '')
        : lean(-t, `A quiet night from ${who(p)} helps ${w.team}.`, `A big night from ${who(p)} helps the other team, so this may work against ${w.team}.`, '') }],
    [(a, b) => a.type === 'prop' && b.type === 'prop', (a, b) => {
      const mates = a.team && b.team && nameEq(a.team, b.team), foes = (a.team && b.opp && nameEq(a.team, b.opp)) || (a.opp && b.team && nameEq(a.opp, b.team)), s = (a.side === 'under' ? -1 : 1) * (b.side === 'under' ? -1 : 1);
      if (mates) { const q = FAM.pass.has(a.k) ? a : FAM.pass.has(b.k) ? b : null, c = q && (q === a ? b : a);
        if (q && FAM.catch.has(c.k)) return s > 0 ? R('strong', 'together', `When ${who(q)} throws for more, ${who(c)} usually catches more too.`) : R('strong', 'against', `${who(q)} and ${who(c)} share the same passes, and these ask for opposite nights.`);
        return R('slight', null, `Teammates: a big night for the team helps both, but one can take the other’s chances.`) }
      if (foes) { const g = FAM.saves.has(a.k) ? a : FAM.saves.has(b.k) ? b : null, sh = g && (g === a ? b : a);
        if (g && FAM.shots.has(sh.k)) return s > 0 ? R('strong', 'together', `Shots from ${who(sh)} that don’t go in are saves for ${who(g)}.`) : R('strong', 'against', `Shots from ${who(sh)} are saves for ${who(g)}, and these ask for opposite things.`);
        const pk = a.k === 'pk' ? a : b.k === 'pk' ? b : null, bt = pk && (pk === a ? b : a);
        if (pk && FAM.bat.has(bt.k)) return lean(-s, `A quiet night for ${who(bt)} suits ${who(pk)}’s strikeouts.`, `Strikeouts for ${who(pk)} mean fewer chances for ${who(bt)}.`, '');
        return lean(tilt(a)[1] * tilt(b)[1], 'A fast, open game helps both.', 'These ask the game to go opposite ways.', 'Opponents in the same game, so they can move together a little.') }
      return R('slight', null, 'Same game, so they can move together.') }],
    [() => true, () => R('slight', null, 'Same game, so they can move together.')],
  ];
  function relate(a, b) {
    if (!a || !b) return R('independent', null, '');
    const x = { same: a.id === b.id || sameGame(a, b) };
    for (const [test, out] of RULES) if (test(a, b, x)) { const r = out(a, b, x); if (!r.why) r.why = 'Same game, so they can move together a little.'; return r }
  }
  const RANK = { independent: 0, slight: 1, strong: 2, conflict: 3 };
  // the strongest tie between one leg and the legs before it
  function strongest(leg, others) { let best = null; for (const o of others) { const r = { ...relate(leg, o), with: o }; if (!best || RANK[r.level] > RANK[best.level]) best = r } return best }
  // a key per leg that is shared by every leg from one game, so the sums treat them together
  function linkKeys(legs) {
    const up = legs.map((_, i) => i), find = i => up[i] === i ? i : (up[i] = find(up[i]));
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) if (sameGame(legs[i], legs[j])) up[find(j)] = find(i);
    return legs.map((l, i) => 'g' + find(i));
  }

  /* ---------- the chance every leg hits, allowing for linked legs ----------
     p        the plain product of every leg's chance, as if no leg affected another
     lo, hi   a rough range once linked legs are allowed for. For each pair from one game, relate() gives a level and a
              direction, and each level stands for a loose band of how much the two could move together (a correlation):
                slight  together 0 to .15   against −.15 to 0   either way −.1 to .1
                strong  together .15 to .5  against −.5 to −.15 either way −.3 to .3
              A pair's chance both hit is p1·p2·(1 + ρ·√(q1·q2 / p1·p2)), q = 1 − p, and a game's legs multiply that factor
              over every pair (a second-order estimate). lo uses the low end of every band and hi the high end. The result
              is held inside the hard limits that hold whatever the link (Fréchet): no higher than the least likely leg from
              that game, no lower than what the legs' chances alone guarantee. A game with a conflict gives 0.
     The bands are judgement, not measurement, so the page calls this a rough range. */
  const BAND = { slight: { together: [0, .15], against: [-.15, 0], null: [-.1, .1] }, strong: { together: [.15, .5], against: [-.5, -.15], null: [-.3, .3] } };
  function estimate(legs, get) {
    const ps = legs.map(get); if (!legs.length || ps.some(v => v == null)) return null;
    const keys = linkKeys(legs), groups = new Map(); legs.forEach((l, i) => groups.set(keys[i], [...(groups.get(keys[i]) || []), i]));
    let p = 1, lo = 1, hi = 1, flo = 1, fhi = 1, linked = false, conflict = false;
    for (const idx of groups.values()) {
      const q = idx.map(i => clamp(ps[i], 1e-4, 1 - 1e-4)), ind = q.reduce((a, b) => a * b, 1); p *= ind;
      if (idx.length === 1) { lo *= ind; hi *= ind; flo *= ind; fhi *= ind; continue }
      linked = true; let fl = 1, fh = 1, bad = false;
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
        const r = relate(legs[idx[a]], legs[idx[b]]); if (r.level === 'conflict') { bad = true; continue }
        const band = BAND[r.level]?.[r.dir ?? 'null']; if (!band) continue;
        const k = Math.sqrt((1 - q[a]) * (1 - q[b]) / (q[a] * q[b])); fl *= Math.max(0, 1 + band[0] * k); fh *= 1 + band[1] * k;
      }
      const gLo = Math.max(0, q.reduce((s, v) => s + v, 0) - (q.length - 1)), gHi = Math.min(...q);
      if (bad) { conflict = true; lo = hi = flo = fhi = 0; continue }
      lo *= clamp(ind * fl, gLo, gHi); hi *= clamp(ind * fh, gLo, gHi); flo *= gLo; fhi *= gHi;
    }
    if (conflict) { lo = hi = flo = fhi = 0 }
    return { p, lo: Math.min(lo, hi), hi: Math.max(lo, hi), flo, fhi, linked, conflict };
  }

  /* ---------- correlation, as a slip says it ----------
     correlation(legs) -> { label, rank, pairs, kinds, modeled, head, text }
       label    null (nothing linked) | 'Low' | 'Moderate' | 'Strong' | 'Conflicting'
       pairs    every linked pair: { a, b, label, kind, why }
       kinds    what links them, in words: same player, same team, same game, opposing outcomes, statistics that depend
                on each other, several overs or unders on one quarterback
       modeled  true when the adjusted range (estimate) is a fair answer; false when the link is too strong for the rules
                of thumb to put a number on, or two picks can't both hit
     Built on relate(): conflict is Conflicting, strong is Strong, slight is Moderate for the same player or the same
     team and Low for anything else in one game. Two or more same-direction legs on one quarterback's passing are Strong. */
  const CORR = [null, 'Low', 'Moderate', 'Strong', 'Conflicting'];
  const KIND = { player: 'the same player', team: 'the same team', game: 'the same game', opposed: 'opposing outcomes', depend: 'statistics that depend on each other', qb: 'several overs or unders on one quarterback' };
  const QB = new Set(['pyd', 'ptd', 'pcmp', 'patt', 'pint', 'pryd', 'plng']);
  function correlation(legs) {
    const pairs = [], kinds = new Set(); let rank = 0;
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i], b = legs[j], r = relate(a, b); if (!r || r.level === 'independent') continue;
      const samePlayer = a.type === 'prop' && b.type === 'prop' && !!norm(a.player) && norm(a.player) === norm(b.player);
      const sameTeam = !samePlayer && ((a.type === 'prop' && b.type === 'prop' && a.team && b.team && nameEq(a.team, b.team)) || (a.type === 'prop' && b.type !== 'prop' && rel(a, b) === 'mate') || (b.type === 'prop' && a.type !== 'prop' && rel(b, a) === 'mate'));
      const kind = r.level === 'conflict' || (r.dir === 'against' && r.level === 'strong') ? 'opposed' : samePlayer ? (r.level === 'strong' ? 'depend' : 'player') : r.level === 'strong' && sameTeam ? 'depend' : sameTeam ? 'team' : r.level === 'strong' ? 'depend' : 'game';
      const k = r.level === 'conflict' ? 4 : r.level === 'strong' ? 3 : samePlayer || sameTeam ? 2 : 1;
      kinds.add(kind); if (samePlayer) kinds.add('player'); if (sameTeam) kinds.add('team');
      pairs.push({ a, b, label: CORR[k], kind, why: r.why }); rank = Math.max(rank, k);
    }
    // several same-direction legs on one quarterback's passing: they rise and fall with the same throws
    const qbs = new Map(); for (const l of legs) if (l.type === 'prop' && QB.has(l.k) && l.player) { const key = norm(l.player) + '|' + l.side; qbs.set(key, [...(qbs.get(key) || []), l]) }
    let qb = null; for (const xs of qbs.values()) if (xs.length >= 2) { qb = xs; kinds.add('qb'); rank = Math.max(rank, 3) }
    const label = CORR[rank], modeled = rank <= 2, top = pairs.slice().sort((x, y) => CORR.indexOf(y.label) - CORR.indexOf(x.label))[0];
    const named = [...kinds].filter(k => k !== 'game' || kinds.size === 1).map(k => KIND[k]);
    const list = named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1] : named[0] || '';
    const qbTxt = qb ? `${qb.length} ${qb[0].side === 'under' ? 'unders' : 'overs'} on ${qb[0].player}’s passing` : '';
    const head = !label ? '' : label === 'Conflicting' ? 'These picks can’t all hit' : `${label} correlation`;
    const text = !label ? '' : label === 'Conflicting' ? `${top?.why || 'Two of these picks contradict each other.'} Remove one to see a combined chance.`
      : label === 'Strong' ? `These picks are strongly correlated${qbTxt ? ` (${qbTxt})` : list ? ` (${list})` : ''}. Their combined probability cannot be calculated by simply multiplying them, and Floodlight can’t model the link accurately, so it shows only the limits.`
      : label === 'Moderate' ? `These picks are moderately correlated (${list}). The combined chance allows for that as a range, not one exact number.`
      : 'Some picks share a game, so they are slightly linked. The combined chance allows for that as a range.';
    return { label, rank, pairs, kinds: [...kinds], modeled, head, text, qb };
  }
  /* The combined chance a slip shows, and how honest it can be:
       independent  no links: the chances multiplied
       adjusted     Low or Moderate links: estimate()'s rough range, with the plain product beside it
       limits       Strong links: no single number, only the hard limits (no higher than the least likely linked pick)
       conflict     two picks can't both hit: 0% */
  function slipChance(legs, get) {
    if (!legs.length) return null;
    const e = estimate(legs, get); if (!e) return null;
    const c = correlation(legs);
    if (e.conflict || c.label === 'Conflicting') return { kind: 'conflict', p: 0, lo: 0, hi: 0, corr: c };
    if (c.label === 'Strong') return { kind: 'limits', p: e.p, lo: e.flo, hi: e.fhi, corr: c };
    if (e.linked || c.label) return { kind: 'adjusted', p: e.p, lo: e.lo, hi: e.hi, corr: c };
    return { kind: 'independent', p: e.p, lo: e.p, hi: e.p, corr: c };
  }

  /* ---------- what is wrong with each pick in a draft, and when its market closes ----------
     legIssues(legs, now, outOf) -> Map(id -> [{ kind, why, blocks }])
       started   the game has begun: the market is closed and the pick can't go in (blocks)
       conflict  it can't hit alongside an earlier pick: the later one is the one to take out (blocks)
       out       outOf(leg) found the player listed Out: if he doesn't play the pick is void, so it can't go in (blocks)
       soon      the game starts within 30 minutes: lock in before then (a warning only) */
  const SOON_MIN = 30;
  function legIssues(legs, now = Date.now(), outOf = () => null) {
    const m = new Map(legs.map(l => [l.id, []])), mins = t => Math.max(1, Math.round((t - now) / 60000));
    for (const l of legs) {
      if (l.start <= now) m.get(l.id).push({ kind: 'started', blocks: true, why: 'Already started, so its market is closed. Take it out to lock in the rest.' });
      else if (l.start - now <= SOON_MIN * 60000) m.get(l.id).push({ kind: 'soon', blocks: false, why: `Starts in ${mins(l.start)} min. Lock in before then or it can’t go in.` });
      const o = l.start > now ? outOf(l) : null;
      if (o) m.get(l.id).push({ kind: 'out', blocks: true, why: `${l.player || 'The player'} is listed ${o.status || 'Out'}${o.what ? ` (${o.what})` : ''}. If he doesn’t play the pick is void, so it can’t go in.` });
    }
    for (let j = 1; j < legs.length; j++) for (let i = 0; i < j; i++) { const r = relate(legs[i], legs[j]); if (r.level === 'conflict') { m.get(legs[j].id).push({ kind: 'conflict', blocks: true, why: `Can’t hit alongside ${legs[i].short || legs[i].text}. ${r.why}` }); break } }
    return m;
  }
  /* Why a combined chance changed, in one sentence. before / after: { p, legs: [{ id, name, v }] }, v the pick's own
     chance (or 1 once it has hit or will be void, 0 once it has missed). Names the picks that came or went and the ones
     whose own chance moved most, biggest first. Returns '' when the whole-number percentage did not change. */
  function explainChange(before, after) {
    if (!before || !after || before.p == null || after.p == null) return '';
    const a = Math.round(before.p * 100), b = Math.round(after.p * 100); if (a === b) return '';
    const was = new Map(before.legs.map(l => [l.id, l])), now = new Map(after.legs.map(l => [l.id, l])), bits = [];
    const added = after.legs.filter(l => !was.has(l.id)), gone = before.legs.filter(l => !now.has(l.id));
    if (added.length) bits.push(`${added.map(l => l.name).join(' and ')} ${added.length === 1 ? 'was' : 'were'} added`);
    if (gone.length) bits.push(`${gone.map(l => l.name).join(' and ')} ${gone.length === 1 ? 'was' : 'were'} taken out`);
    const moved = after.legs.filter(l => was.has(l.id) && l.v != null && was.get(l.id).v != null && Math.round(l.v * 100) !== Math.round(was.get(l.id).v * 100))
      .sort((x, y) => Math.abs(y.v - was.get(y.id).v) - Math.abs(x.v - was.get(x.id).v)).slice(0, 2);
    for (const l of moved) { const v0 = was.get(l.id).v;
      bits.push(l.why ? `${l.name} ${l.why}` : `${l.name} went from ${Math.round(v0 * 100)}% to ${Math.round(l.v * 100)}%`) }
    return `${b > a ? 'Up' : 'Down'} from ${a}% to ${b}%${bits.length ? ': ' + bits.join('; ') : ''}.`;
  }

  /* ---------- what stops a parlay being locked in ----------
     -> [{ kind: 'conflict' | 'started' | 'stale', ids, why }]. Every rule says what it found and what to do. */
  const priceAge = l => l.rAt ?? l.mAt ?? null;
  function blockers(legs, now = Date.now()) {
    const out = [];
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) { const r = relate(legs[i], legs[j]); if (r.level === 'conflict') out.push({ kind: 'conflict', ids: [legs[i].id, legs[j].id], why: r.why, a: legs[i], b: legs[j] }) }
    for (const l of legs) if (l.start < now) out.push({ kind: 'started', ids: [l.id], why: `${l.game || l.text} has started. Take it out to lock in the rest.` });
    const old = legs.filter(l => l.start >= now && (priceAge(l) == null || now - priceAge(l) > STALE_MIN * 60000));
    if (old.length) out.push({ kind: 'stale', ids: old.map(l => l.id), why: `${old.length === legs.length && old.length > 1 ? 'The prices for these picks were' : old.length === 1 ? `The price for ${old[0].short || old[0].text} was` : `The prices for ${old.length} picks were`} read more than ${STALE_MIN} minutes ago. Refresh them before you lock in.` });
    return out;
  }

  /* ---------- the closing price ----------
     A leg's closing chance is the books' price (margin taken out) read in the last minutes before its start, while the page
     is open. It can be written once, between 30 minutes before the start and 5 minutes after; the server holds the same window. */
  const CLOSE_BEFORE = 30 * 60000, CLOSE_AFTER = 5 * 60000;
  const closeOpen = (l, now = Date.now()) => now >= l.start - CLOSE_BEFORE && now <= l.start + CLOSE_AFTER;
  // -> { p } once read, else { state: 'later' | 'due' | 'none' | 'missed' | 'old' }
  function closeOf(p, l, now = Date.now()) {
    if (l.close != null) return { p: l.close };
    if (!p.v) return { state: 'old' };
    if (!LG[l.lg]?.board) return { state: 'none' };
    return now < l.start - CLOSE_BEFORE ? { state: 'later' } : closeOpen(l, now) ? { state: 'due' } : { state: 'missed' };
  }
  async function closeLegs(p, rows) {
    rows = rows.filter(r => { const l = p.legs.find(x => x.id === r.id); return l && l.close == null && r.close > 0 && r.close < 1 && closeOpen(l) });
    if (!rows.length) return;
    if (p.local || !me()) { for (const r of rows) { const l = p.legs.find(x => x.id === r.id); l.close = +r.close.toFixed(4); l.closeAt = Date.now() } }
    else await send(p, { op: 'close', legs: rows.map(r => ({ id: r.id, close: +r.close.toFixed(4) })) }).catch(() => {});
    changed();
  }

  /* ---------- live odds: what the books post right now for one leg ---------- */
  const oddsCache = new Map(), slugs = new Map();   // game -> { at, promise, data }; soccer game -> its league
  function oddsBoard(leg, g, force) {
    const L = LG[leg.lg], b = L?.board; if (!b || !g) return Promise.resolve(null);
    if (window.flAccess && !window.flAccess.has('live')) return Promise.resolve(null);
    const k = leg.lg + '|' + g.eid, c = oddsCache.get(k);
    if (c && !force && (c.promise || Date.now() - c.at < (g.state === 'in' ? 45000 : 5 * 60000))) return c.promise || Promise.resolve(c.data);   // live prices move; before the start, every few minutes is plenty
    if (L.sport === 'soccer' && !g.slug) {   // the all-competitions scoreboard does not name the league; the game's own summary does
      const p = summary(leg.lg, g).then(s => { g.slug = slugs.get(g.eid) || s?.header?.league?.slug || ''; if (g.slug) slugs.set(g.eid, g.slug); oddsCache.delete(k); return g.slug ? oddsBoard(leg, g, force) : null });
      oddsCache.set(k, { at: 0, data: null, promise: p }); return p;
    }
    const slug = L.sport === 'soccer' ? g.slug : b[1]; if (!slug) return Promise.resolve(null);
    const q = new URLSearchParams({ sport: b[0], lg: slug, id: /^\d+$/.test(g.eid) ? g.eid : '', home: g.home.full || g.home.name, away: g.away.full || g.away.name, date: g.date.toISOString(),
      kx: L.sport === 'soccer' ? (KX_SOCCER[slug] || '') : b[2], espn: `${L.sport === 'soccer' ? 'soccer/' + slug : L.path}` });
    const promise = api('/api/odds/board?' + q).then(data => { oddsCache.set(k, { at: Date.now(), data }); return data }).catch(() => { oddsCache.set(k, { at: Date.now() - 20000, data: c?.data || null }); return c?.data || null });
    oddsCache.set(k, { at: c?.at || 0, data: c?.data || null, promise });
    return promise;
  }
  const bookName = b => ({ kalshi: 'Kalshi', fanduel: 'FanDuel', draftkings: 'DraftKings', polymarket: 'Polymarket' })[b] || b || '';
  // -> { p (the books' chance with their margin taken out), price (the best American price), book, line (when the books' line differs) } or null
  function marketNow(leg, d) {
    if (!d) return null;
    const pack = (fair, best, extra) => fair == null && !best ? null : { p: fair ?? null, price: best?.price?.am ?? null, book: bookName(best?.book), n: best?.n || 0, ...extra };
    if (leg.type === 'win' || leg.type === 'draw') { const k = leg.type === 'draw' ? 'draw' : leg.side; return pack(d.ml?.fair?.[k], d.ml?.best?.[k]) }
    if (leg.type === 'total') { const rows = d.totals || []; const t = rows.find(x => x.line === leg.line); const k = leg.side === 'under' ? 'under' : 'over';
      if (t) return pack(t.fair?.[k], t.best?.[k]);
      const main = rows.filter(x => x.fair?.over != null).sort((a, b) => Math.abs(a.fair.over - .5) - Math.abs(b.fair.over - .5))[0]; return main ? { p: null, price: null, book: '', other: main.line } : null }
    if (leg.type === 'spread') { const hl = leg.side === 'home' ? leg.line : -leg.line, rows = d.spreads || [], s = rows.find(x => x.homeLine === hl);
      if (s) return pack(s.fair?.[leg.side], s.best?.[leg.side]);
      const main = rows.filter(x => x.fair?.home != null).sort((a, b) => Math.abs(a.fair.home - .5) - Math.abs(b.fair.home - .5))[0]; return main ? { p: null, price: null, book: '', other: leg.side === 'home' ? main.homeLine : -main.homeLine } : null }
    if (leg.type === 'prop') { const cat = BOARD_CAT[leg.k]; if (!cat) return null; const n = norm(leg.player), row = (d.props || []).find(r => r.cat === cat && norm(r.player) === n); if (!row) return null;
      if (row.kind === 'yes') return leg.yes ? pack(leg.side === 'under' ? (row.fair?.yes != null ? 1 - row.fair.yes : null) : row.fair?.yes, leg.side === 'under' ? null : row.best?.yes) : null;
      const k = leg.side === 'under' ? 'under' : 'over';
      if (row.line === leg.line) return pack(row.fair?.[k], row.best?.[k]);
      return { p: null, price: null, book: '', other: row.line } }
    return null;
  }

  /* ---------- turning a pick or a game into a leg ---------- */
  const lgOf = sport => sport === 'cfb' ? 'cfb' : LG[sport] ? sport : null;
  // a pick from the Predictions board (edge.js or a match forecast). side: take the other side of a prop
  function fromPick(p, side) {
    if (p.type === 'prop') { const lg = lgOf(p.sport); if (!lg || !p.start) return null; const s = side || p.side, flip = s !== p.side, over = s === 'over';
      const text = p.yes ? `${p.label}: ${over ? 'Yes' : 'No'}` : `${over ? 'Over' : 'Under'} ${fmt(p.line)} ${String(p.label).toLowerCase()}`;
      return { id: `prop:${lg}:${p.name}:${p.k}:${p.line}:${s}`, type: 'prop', lg, sport: p.sport, player: p.name, team: p.team || '', opp: p.opp || '', photo: p.photo || '', k: p.k, label: p.label, line: p.line, side: s, ...(p.yes ? { yes: true } : {}),
        start: +p.start, game: p.game || '', gameKey: p.gameKey || `${lg}:${p.name}`, text: `${p.name}: ${text}`, short: `${p.name.split(' ').slice(-1)[0]} ${text.toLowerCase()}`,
        rAt: p.at || Date.now(), ours0: flip ? 1 - p.ours : p.ours, ...(p.market != null ? { market0: flip ? 1 - p.market : p.market, msrc: [...new Set((p.offers || []).filter(o => o.pOver != null && o.line === p.line).map(o => ({ prizepicks: 'PrizePicks', sleeper: 'Sleeper', underdog: 'Underdog' })[o.book] || o.book))].join(' and ') || 'the apps', mAt: p.at || Date.now() } : {}), ...(p.mu != null ? { mu: p.mu } : p.avg != null ? { mu: p.avg } : {}), ...(p.sd ? { sd: p.sd } : {}) } }
    if (p.type === 'match' && p.m) { const m = p.m, lg = m.sport === 'soccer' ? 'soccer' : m.lg === 'nfl' ? 'nfl' : 'cfb', L = LG[lg], draw = m.pick === 'draw';
      const leg = { id: `${draw ? 'draw' : 'win'}:${lg}:${m.key}:${m.pick}`, type: draw ? 'draw' : 'win', lg, sport: lg, home: m.home, away: m.away, side: draw ? 'home' : m.pick, team: draw ? '' : m[m.pick], start: m.ko * 1000,
        game: `${m.home} v ${m.away}`, gameKey: 'match:' + m.key, text: draw ? `${m.home} v ${m.away}: draw` : `${m[m.pick]} to win`, short: draw ? `${m.home} v ${m.away} draw` : `${m[m.pick]} to win`, ours0: p.ours, ...(p.market != null ? { market0: p.market } : {}) };
      if ((m.src || 'espn') === 'espn' && /^\d+$/.test(String(m.id || ''))) { leg.eid = String(m.id); leg.gameKey = `${lg}:${leg.eid}` }   // the same key a pick made from the scoreboard gets, so two picks on one game are seen as linked
      const ph = m.probs?.home ?? m.market?.home; leg.t0 = L.tot;
      leg.m0 = draw ? marginFrom(L, ph ?? null, L.tot) : marginFrom(L, p.ours, L.tot);   // a draw is read from the home side's expected margin
      return leg }
    return null;
  }
  // a leg on a game from the scoreboard. kind: win | draw | total | spread; side: home | away | over | under; line for totals and spreads (the side's own line)
  function fromGame(g, kind, side, line) {
    const L = LG[g.lg], o = g.odds || {}, fair = o.fair || {}, vs = `${g.away.name} at ${g.home.name}`, base = { lg: g.lg, sport: g.lg, eid: g.eid, home: g.home.full || g.home.name, away: g.away.full || g.away.name, homeAbbr: g.home.abbr, awayAbbr: g.away.abbr,
      start: +g.date, game: L.sport === 'soccer' ? `${g.home.name} v ${g.away.name}` : vs, gameKey: `${g.lg}:${g.eid}`, t0: o.total || L.tot, msrc: o.book || 'ESPN scoreboard', mAt: g.readAt || Date.now(), rAt: g.readAt || Date.now() };
    // the line the book posted for this side, and whether the member moved away from it (a line with none posted is the member's own)
    const posted = kind === 'total' ? o.total ?? null : kind === 'spread' && o.spread != null ? (side === 'home' ? o.spread : -o.spread) : null, own = { ...(posted != null ? { posted } : {}), ...(posted == null || posted !== line ? { edited: true } : {}) };
    const team = side === 'away' ? g.away : g.home, mHome = o.spread != null && !L.pois ? -o.spread : marginFrom(L, fair.home != null ? (L.tie === 'draw' ? fair.home : fair.home / (fair.home + fair.away)) : null, o.total || L.tot);
    if (kind === 'win') return { ...base, id: `win:${g.lg}:${g.eid}:${side}`, type: 'win', side, team: team.name, logo: team.logo, text: `${team.name} to win`, short: `${team.abbr || team.name} to win`, m0: side === 'away' ? -mHome : mHome, ...(fair[side] != null ? { market0: fair[side] } : {}) };
    if (kind === 'draw') return { ...base, id: `draw:${g.lg}:${g.eid}`, type: 'draw', side: 'home', text: `${g.home.name} v ${g.away.name}: draw`, short: `${g.home.abbr} v ${g.away.abbr} draw`, m0: mHome, ...(fair.draw != null ? { market0: fair.draw } : {}) };
    if (kind === 'total') return { ...base, id: `total:${g.lg}:${g.eid}:${side}:${line}`, type: 'total', side, line, ...own, text: `${base.game}: ${side === 'under' ? 'under' : 'over'} ${fmt(line)} ${L.unit}`, short: `${g.away.abbr || g.away.name}/${g.home.abbr || g.home.name} ${side === 'under' ? 'under' : 'over'} ${fmt(line)}` };
    if (kind === 'spread') return { ...base, id: `spread:${g.lg}:${g.eid}:${side}:${line}`, type: 'spread', side, line, ...own, team: team.name, logo: team.logo, text: `${team.name} ${line > 0 ? '+' : line < 0 ? '−' : ''}${fmt(Math.abs(line))}`, short: `${team.abbr || team.name} ${line > 0 ? '+' : line < 0 ? '−' : ''}${fmt(Math.abs(line))}`, m0: side === 'away' ? -mHome : mHome };
    return null;
  }

  /* ---------- the member's parlays ---------- */
  const P = { list: (v => Array.isArray(v) ? v.filter(p => p && p.local && Array.isArray(p.legs)) : [])(store.get('fl.parlays', [])), loaded: false, signedIn: false };
  const me = () => window.S?.me || null;
  const changed = () => { store.set('fl.parlays', P.list.filter(p => p.local)); document.dispatchEvent(new CustomEvent('fl:parlays')) };
  const statusOf = legs => { const r = legs.map(l => l.res); return r.includes('miss') ? 'lost' : r.some(x => !x) ? 'open' : r.includes('hit') ? 'won' : 'push' };
  async function load() {
    P.error = '';
    if (!me()) { const had = P.list.length; P.list = P.list.filter(p => p.local); P.signedIn = false; P.loaded = true; if (had !== P.list.length) changed(); return P.list }
    try { const d = await api('/api/parlays'); P.signedIn = !!d.signedIn;
      if (d.signedIn) { const local = P.list.filter(p => p.local); P.list = [...(d.parlays || []), ...local]; P.loaded = true; changed(); pushLocal() } else P.loaded = true;
    } catch (e) { P.loaded = true; P.error = e.message }
    return P.list;
  }
  // parlays made before signing in move to the account while none of their games has started
  async function pushLocal() {
    for (const p of P.list.filter(x => x.local && x.status === 'open' && x.legs.every(l => l.start > Date.now()))) {
      try { const d = await api('/api/parlays', { op: 'add', name: p.name, legs: p.legs, odds: p.odds, stake: p.stake, ours0: p.ours0, market0: p.market0, lo0: p.lo0, hi0: p.hi0, warn: p.warn, edited: p.edited }); P.list = [...d.parlays, ...P.list.filter(x => x.local && x.id !== p.id)]; changed() } catch {}
    }
  }
  async function add(draft) {
    const legs = draft.legs || []; if (!legs.length) throw new Error('Add at least one pick first.');
    const late = legs.find(l => l.start < Date.now() - 120000); if (late) throw new Error(`${late.game || late.text} has already started. Take that pick out and save again.`);
    const clash = blockers(legs).find(b => b.kind === 'conflict'); if (clash) throw new Error(clash.why);
    // what the member saw when locking in, kept for the history: the range, the relationship warning and whether a line was moved
    const est = estimate(legs, start0), warn = String(draft.warn || '').slice(0, 240), edited = legs.some(l => l.edited);
    const body = { op: 'add', name: draft.name || '', legs, odds: draft.odds ?? null, stake: draft.stake ?? null, ours0: combine(legs, start0)?.p ?? null, market0: combine(legs, l => l.market0)?.p ?? null,
      ...(est?.linked ? { lo0: +est.lo.toFixed(4), hi0: +est.hi.toFixed(4) } : {}), ...(warn ? { warn } : {}), ...(edited ? { edited: true } : {}) };
    if (me()) { const d = await api('/api/parlays', body); P.list = [...d.parlays, ...P.list.filter(p => p.local)]; changed(); return d.parlay }
    const p = { id: 'l' + Date.now().toString(36), at: Date.now(), v: 2, name: body.name, legs: legs.map(l => { const c = { ...l }; delete c.close; delete c.closeAt; delete c.res; return c }), status: 'open', local: true, ...(body.odds != null ? { odds: body.odds } : {}), ...(body.stake != null ? { stake: body.stake } : {}),
      ...(body.ours0 != null ? { ours0: body.ours0 } : {}), ...(body.market0 != null ? { market0: body.market0 } : {}), ...(body.lo0 != null ? { lo0: body.lo0, hi0: body.hi0 } : {}), ...(warn ? { warn } : {}), ...(edited ? { edited: true } : {}) };
    P.list.unshift(p); changed(); return p;
  }
  async function send(p, body) {
    if (p.local || !me()) return null;
    const d = await api('/api/parlays', { ...body, id: p.id }); P.list = [...d.parlays, ...P.list.filter(x => x.local)]; return d.parlay;
  }
  async function remove(id) { const p = P.list.find(x => x.id === id); if (!p) return; if (p.local || !me()) P.list = P.list.filter(x => x.id !== id); else await send(p, { op: 'delete' }); changed() }
  async function edit(id, patch) { const p = P.list.find(x => x.id === id); if (!p) return;
    if (p.local || !me()) { for (const k of ['name', 'odds', 'stake']) if (k in patch) { if (patch[k] == null || patch[k] === '') delete p[k]; else p[k] = patch[k] } } else await send(p, { op: 'edit', ...patch }); changed() }
  // write down the legs that have just been decided
  async function settle(p, results) {
    if (!results.length) return;
    if (p.local || !me()) { for (const r of results) { const l = p.legs.find(x => x.id === r.id); if (l && l.start <= Date.now()) { l.res = r.res; if (r.final != null) l.final = r.final } }
      const was = p.status; p.status = statusOf(p.legs); if (p.status !== 'open' && was === 'open') p.settled = Date.now() }
    else await send(p, { op: 'result', legs: results }).catch(() => {});
    changed();
  }
  // a prop whose count the box score can't give: the Lab's own game log for that player, the game on that day
  const logs = new Map();
  async function fromLog(leg) {
    const k = leg.lg + '|' + leg.player; if (!logs.has(k)) logs.set(k, api(`/api/lab/player?sport=${encodeURIComponent(leg.sport || leg.lg)}&name=${encodeURIComponent(leg.player)}`).catch(e => ({ error: e.message })));
    const d = await logs.get(k); if (!d || d.error || !Array.isArray(d.games)) { setTimeout(() => logs.delete(k), 60000); return { v: null, unknown: true } }
    const day = etDay(new Date(leg.start)), g = d.games.find(x => { const t = new Date(x.date); return etDay(t) === day || Math.abs(t - leg.start) < 18 * 36e5 });
    if (!g) return { v: null, none: true };
    return { v: g.v?.[leg.k] ?? null, none: g.v?.[leg.k] == null };
  }

  /* ---------- the record ---------- */
  // what a parlay paid, in units of its stake. The price is the odds the member typed; without them, the fair price of the
  // market's chance when it was saved (est: true); without that either, the parlay counts toward the record but not the units.
  function priceOf(p) { if (p.odds != null) return { dec: dec(p.odds), am: p.odds, est: false }; if (p.market0 != null && p.market0 > .003) return { dec: 1 / p.market0, am: amFromP(p.market0), est: true }; return null }
  function stats(list) {
    const all = (list || P.list).filter(p => p.status && p.status !== 'open').sort((a, b) => (a.settled || a.at) - (b.settled || b.at));
    const won = all.filter(p => p.status === 'won'), lost = all.filter(p => p.status === 'lost'), push = all.filter(p => p.status === 'push'), decided = [...won, ...lost].length;
    let run = 0, kind = '', best = 0, cur = 0; for (const p of all) { if (p.status === 'push') continue; if (p.status === kind) run++; else { kind = p.status; run = 1 } if (p.status === 'won') { cur++; best = Math.max(best, cur) } else cur = 0 }
    const legs = (list || P.list).flatMap(p => p.legs.map(l => ({ ...l, n: p.legs.length }))).filter(l => l.res === 'hit' || l.res === 'miss');
    const tally = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (k == null) continue; const t = m.get(k) || { k, hit: 0, n: 0 }; t.n++; if (r.res === 'hit' || r.status === 'won') t.hit++; m.set(k, t) } return [...m.values()].sort((a, b) => b.n - a.n) };
    let units = 0, staked = 0, net = 0; const series = [];
    for (const p of all) { const pr = priceOf(p), st = p.stake ?? 1; let u = null;
      if (pr && p.status !== 'push') { u = p.status === 'won' ? st * (pr.dec - 1) : -st; units += u; staked += st }
      net += p.status === 'won' ? 1 : p.status === 'lost' ? -1 : 0;
      series.push({ id: p.id, t: p.settled || p.at, status: p.status, name: p.name, n: p.legs.length, u, units, net, est: !!pr?.est }) }
    const priced = series.filter(s => s.u != null).length;
    // the closing line: did the books' chance for a pick rise (a better price was locked in) or fall after it was locked in
    const clvLegs = (list || P.list).flatMap(p => p.legs).filter(l => l.close != null && l.market0 != null && l.res !== 'void'), clvBeat = clvLegs.filter(l => l.close - l.market0 > .005).length;
    return { n: all.length, won: won.length, lost: lost.length, push: push.length, open: (list || P.list).filter(p => p.status === 'open').length, rate: decided ? won.length / decided : null,
      streak: decided ? { n: run, kind } : null, best, legHit: legs.filter(l => l.res === 'hit').length, legN: legs.length, legRate: legs.length ? legs.filter(l => l.res === 'hit').length / legs.length : null,
      byLeague: tally(legs, l => LG[l.lg]?.name || l.lg), byType: tally(legs, l => ({ prop: 'Player props', win: 'To win', draw: 'Draws', total: 'Totals', spread: 'Spreads' })[l.type]),
      bySize: tally(all.filter(p => p.status !== 'push'), p => p.legs.length === 1 ? 'Singles' : p.legs.length <= 3 ? `${p.legs.length} picks` : p.legs.length <= 5 ? '4 to 5 picks' : '6 or more picks'),
      units: priced ? units : null, staked, roi: staked ? units / staked : null, priced, est: series.some(s => s.est && s.u != null), series, last: all.slice(-10), clvN: clvLegs.length, clvBeat };
  }

  window.flParlay = { LG, list: () => P.list, state: P, load, add, remove, edit, settle, stats, relate, strongest, sameGame, linkKeys, estimate, correlation, slipChance, legIssues, explainChange, blockers, STALE_MIN, closeOf, closeOpen, closeLegs, priceOf, statusOf, scoreboard, gameFor, summary, boxValue, hasLive, read, start0, left, combine, oddsBoard, marketNow, fromPick, fromGame, fromLog,
    etDay, fmt, dec, amFromP, amTxt, marginFrom, norm };
  document.addEventListener('fl:me', () => { load() });
})();
