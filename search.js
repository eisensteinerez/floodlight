/* Floodlight · the search box in the header, across every sport.
   One query looks everywhere: players and teams from ESPN's site search (every sport at once), MLB's own people search for
   baseball (the baseball pages use MLB ids), Floodlight's own Flashscore and tennis lookups, the leagues the site covers,
   today's games on the Live Hub, and the Lab. The sport you are on only moves its results up the list; it never hides
   another sport. Results stay open while you switch sport, Enter always opens the top result (or re-runs the search),
   arrow keys move, Esc closes, and the clear button empties the box. With nothing typed it shows your recent searches,
   recent picks and your teams. Results come in groups: Players (team, position, next game), Teams, Games, Leagues and
   Research (Lab, current props, trends, compare). Opening one closes the results, leaves Home or a page, gives the
   destination its own address (#/go/…, so Back and shared links work), moves focus to its heading, empties the box and
   shows "Back to results". Typos ("Leborn"), team abbreviations ("LAL"), nicknames, prop questions, matchups and
   markets ("NBA assists") all lead somewhere. Cmd/Ctrl+K opens it from anywhere. */
(() => {
  const box = $('sres'), input = $('q'), label = input?.closest('label.search');
  if (!box || !input) return;
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const SPORT = { soccer: 'Soccer', football: 'Football', basketball: 'Basketball', baseball: 'Baseball', hockey: 'Hockey', tennis: 'Tennis', ufc: 'UFC', boxing: 'Boxing' };
  const ESPN_SPORT = { soccer: 'soccer', football: 'football', basketball: 'basketball', hockey: 'hockey', mma: 'ufc' };
  const PRO = new Set(['nba', 'wnba', 'nfl', 'nhl', 'mlb', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'usa.1', 'uefa.champions', 'ufc']);
  const shot = (sport, id) => `https://a.espncdn.com/i/headshots/${sport}/players/full/${id}.png`;
  // short names people type that ESPN's search does not know
  const ALIAS = { lbj: 'lebron james', kd: 'kevin durant', cp3: 'chris paul', sga: 'shai gilgeous alexander', ad: 'anthony davis', cmc: 'christian mccaffrey',
    jjettas: 'justin jefferson', ja: 'ja morant', kat: 'karl anthony towns', pg13: 'paul george', dame: 'damian lillard', bron: 'lebron james',
    epl: 'premier league', prem: 'premier league', ucl: 'champions league', uel: 'europa league', laliga: 'laliga', 'la liga': 'laliga', seriea: 'serie a',
    ncaaf: 'college fbs', cfb: 'college fbs', ncaab: 'college cbb', cbb: 'college cbb', wcbb: 'college wcbb', mls: 'mls' };
  // team abbreviations people type ("LAL", "KC", "NYR"): each names one or more real teams, searched by full name.
  // The same letters can mean teams in two sports (BOS, KC); every one is listed and the row says which sport.
  const ABBR = {};
  for (const [lg, list] of Object.entries({
    nba: 'ATL Atlanta Hawks|BOS Boston Celtics|BKN Brooklyn Nets|CHA Charlotte Hornets|CHI Chicago Bulls|CLE Cleveland Cavaliers|DAL Dallas Mavericks|DEN Denver Nuggets|DET Detroit Pistons|GSW Golden State Warriors|HOU Houston Rockets|IND Indiana Pacers|LAC LA Clippers|LAL Los Angeles Lakers|MEM Memphis Grizzlies|MIA Miami Heat|MIL Milwaukee Bucks|MIN Minnesota Timberwolves|NOP New Orleans Pelicans|NYK New York Knicks|OKC Oklahoma City Thunder|ORL Orlando Magic|PHI Philadelphia 76ers|PHX Phoenix Suns|POR Portland Trail Blazers|SAC Sacramento Kings|SAS San Antonio Spurs|TOR Toronto Raptors|UTA Utah Jazz|WAS Washington Wizards',
    nfl: 'ARI Arizona Cardinals|ATL Atlanta Falcons|BAL Baltimore Ravens|BUF Buffalo Bills|CAR Carolina Panthers|CHI Chicago Bears|CIN Cincinnati Bengals|CLE Cleveland Browns|DAL Dallas Cowboys|DEN Denver Broncos|DET Detroit Lions|GB Green Bay Packers|HOU Houston Texans|IND Indianapolis Colts|JAX Jacksonville Jaguars|KC Kansas City Chiefs|LV Las Vegas Raiders|LAC Los Angeles Chargers|LAR Los Angeles Rams|MIA Miami Dolphins|MIN Minnesota Vikings|NE New England Patriots|NO New Orleans Saints|NYG New York Giants|NYJ New York Jets|PHI Philadelphia Eagles|PIT Pittsburgh Steelers|SF San Francisco 49ers|SEA Seattle Seahawks|TB Tampa Bay Buccaneers|TEN Tennessee Titans|WSH Washington Commanders',
    nhl: 'ANA Anaheim Ducks|BOS Boston Bruins|BUF Buffalo Sabres|CGY Calgary Flames|CAR Carolina Hurricanes|CHI Chicago Blackhawks|COL Colorado Avalanche|CBJ Columbus Blue Jackets|DAL Dallas Stars|DET Detroit Red Wings|EDM Edmonton Oilers|FLA Florida Panthers|LAK Los Angeles Kings|MIN Minnesota Wild|MTL Montreal Canadiens|NSH Nashville Predators|NJD New Jersey Devils|NYI New York Islanders|NYR New York Rangers|OTT Ottawa Senators|PHI Philadelphia Flyers|PIT Pittsburgh Penguins|SJS San Jose Sharks|SEA Seattle Kraken|STL St. Louis Blues|TBL Tampa Bay Lightning|TOR Toronto Maple Leafs|UTA Utah Mammoth|VAN Vancouver Canucks|VGK Vegas Golden Knights|WSH Washington Capitals|WPG Winnipeg Jets',
    mlb: 'ARI Arizona Diamondbacks|ATL Atlanta Braves|BAL Baltimore Orioles|BOS Boston Red Sox|CHC Chicago Cubs|CWS Chicago White Sox|CIN Cincinnati Reds|CLE Cleveland Guardians|COL Colorado Rockies|DET Detroit Tigers|HOU Houston Astros|KC Kansas City Royals|LAA Los Angeles Angels|LAD Los Angeles Dodgers|MIA Miami Marlins|MIL Milwaukee Brewers|MIN Minnesota Twins|NYM New York Mets|NYY New York Yankees|ATH Athletics|PHI Philadelphia Phillies|PIT Pittsburgh Pirates|SD San Diego Padres|SF San Francisco Giants|SEA Seattle Mariners|STL St. Louis Cardinals|TB Tampa Bay Rays|TEX Texas Rangers|TOR Toronto Blue Jays|WSH Washington Nationals' }))
    for (const t of list.split('|')) { const [ab, ...n] = t.split(' '); (ABBR[ab.toLowerCase()] ||= []).push({ lg, name: n.join(' ') }) }
  // nicknames and short names people use for players, on top of ALIAS
  Object.assign(ALIAS, { bron: 'lebron james', 'king james': 'lebron james', steph: 'stephen curry', chef: 'stephen curry', joker: 'nikola jokic', 'greek freak': 'giannis antetokounmpo', giannis: 'giannis antetokounmpo',
    wemby: 'victor wembanyama', 'ant man': 'anthony edwards', luka: 'luka doncic', jokic: 'nikola jokic', ovi: 'alex ovechkin', 'the great one': 'wayne gretzky', 'mcjesus': 'connor mcdavid', sid: 'sidney crosby',
    ohtani: 'shohei ohtani', judge: 'aaron judge', cr7: 'cristiano ronaldo', messi: 'lionel messi', mbappe: 'kylian mbappe', haaland: 'erling haaland', 'the bills': 'buffalo bills', 'man u': 'manchester united', 'man utd': 'manchester united', 'man city': 'manchester city', barca: 'barcelona', psg: 'paris saint germain', bayern: 'bayern munich' });
  const G = { seq: 0, q: '', res: null, open: false, keepT: 0, recent: store.get('fl.searchRecent', []), recentQ: store.get('fl.searchRecentQ', []), last: null, from: null };

  /* ---------- natural language: "lebron points over 25.5", "mahomes passing yards", "lakers v celtics" ---------- */
  const STATS = [
    [/\b(points rebounds assists|pts reb ast|pra)\b/, { nba: 'pra', wnba: 'pra' }, 'points + rebounds + assists'],
    [/\b(passing yards|pass yds|pass yards|passing)\b/, { nfl: 'pyd' }, 'passing yards'],
    [/\b(rushing yards|rush yds|rush yards|rushing)\b/, { nfl: 'ryd' }, 'rushing yards'],
    [/\b(receiving yards|rec yds|receiving)\b/, { nfl: 'reyd' }, 'receiving yards'],
    [/\b(receptions|catches)\b/, { nfl: 'rec' }, 'receptions'],
    [/\b(touchdowns?|tds?)\b/, { nfl: 'td' }, 'touchdowns'],
    [/\b(shots on target|sot)\b/, { soccer: 'sot' }, 'shots on target'],
    [/\b(shots on goal|sog)\b/, { nhl: 'sog' }, 'shots on goal'],
    [/\b(rebounds?|reb|boards)\b/, { nba: 'reb', wnba: 'reb' }, 'rebounds'],
    [/\b(assists?|ast|dimes)\b/, { nba: 'ast', wnba: 'ast', nhl: 'ast', soccer: 'assists' }, 'assists'],
    [/\b(threes|3s|3pm|three pointers|3 pointers)\b/, { nba: '3pm', wnba: '3pm' }, 'threes'],
    [/\b(home runs?|hrs?|homers?)\b/, { mlb: 'hr' }, 'home runs'],
    [/\b(total bases|tb)\b/, { mlb: 'tb' }, 'total bases'],
    [/\b(strikeouts|ks)\b/, { mlb: 'pk' }, 'strikeouts'],
    [/\b(rbis?)\b/, { mlb: 'rbi' }, 'RBIs'],
    [/\b(hits)\b/, { mlb: 'h' }, 'hits'],
    [/\b(goals?)\b/, { nhl: 'goals', soccer: 'goals' }, 'goals'],
    [/\b(shots)\b/, { soccer: 'shots', nhl: 'sog' }, 'shots'],
    [/\b(points|pts)\b/, { nba: 'pts', wnba: 'pts', nhl: 'pts' }, 'points'],
  ];
  const FILLER = /\b(show me|how (is|are|has|have|many|much)|what (is|are)|does|do|will|can|stats?|statistics|tonight|today|this season|lately|recently|recent|last \d+ games?|last \d+|games?|in his|in her|his|her|their|the|for|of|player|prop|props|line|vs\.?|versus|against|v)\b/g;
  function parse(raw) {
    let s = ' ' + norm(raw) + ' ', stat = null, side = null, line = null, label = '';
    const ou = /\b(over|under|o|u)\s*(\d+(?:\.\d+)?)/.exec(norm(raw).replace(/(\d) (\d)/g, '$1.$2')) || /\b(over|under)\b/.exec(norm(raw));
    if (ou) { side = /^o/.test(ou[1]) ? 'over' : 'under'; if (ou[2] != null) line = +ou[2] }
    for (const [re, map, l] of STATS) if (re.test(s)) { stat = map; label = l; s = s.replace(re, ' '); break }
    s = s.replace(/\b(over|under|o|u)\s*\d+(\.\d+)?\b/g, ' ').replace(/\b\d+(\.\d+)?\b/g, ' ');
    const vs = /\s(?:vs\.?|versus|v|at|@)\s/.test(' ' + norm(raw).replace('@', ' @ ') + ' ') ? norm(raw).replace('@', ' at ').split(/\s(?:vs|versus|v|at)\s/) : null;
    // a plain query goes to the search as typed (apostrophes and accents matter there); a prop question loses its stat words first
    const name = (stat || side) ? s.replace(FILLER, ' ').replace(/\s+/g, ' ').trim() : String(raw).trim();
    return { name: ALIAS[norm(name)] || name, stat, side, line, label, vs: vs && vs.length === 2 && vs.every(x => x.trim().length > 1) ? vs.map(x => x.trim()) : null };
  }

  /* ---------- sources ---------- */
  const espn = (q, type, limit) => cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&type=${type}&limit=${limit}`).then(d => d.items || []);
  function fromEspn(x, i) {
    const sp = ESPN_SPORT[x.sport]; if (!sp) return null;
    const slug = x.league || x.defaultLeagueSlug || '', team = x.type === 'team', tr = x.teamRelationships?.[0]?.displayName || '';
    const it = { sp, kind: team ? 'team' : 'player', id: String(x.id), title: x.displayName, rank: i, active: x.isActive !== false, retired: !!x.isRetired, lgKey: slug };
    if (sp === 'soccer') {
      Object.assign(it, team ? { attrs: { team: x.id, lg: slug }, img: x.logos?.[0]?.href || '' } : { attrs: { player: x.id }, img: shot('soccer', x.id), face: 1 });
      it.lg = LG[slug]?.name || tr.match(/\(([^)]+)\)$/)?.[1] || ''; it.team = tr.replace(/\s*\(.*\)$/, '');
      if (!team && /friendly|super_cup|\.cup|_cup/.test(slug) && it.lg) it.lgKey = '';
    } else if (sp === 'football') {
      const lg = slug === 'nfl' ? 'nfl' : /college/.test(slug) ? 'fbs' : slug === 'ufl' ? 'ufl' : null; if (!lg) return null;
      it.attrs = team ? { fbteam: x.id, fbl: lg } : { fbplayer: x.id, fbl: lg }; it.lg = FBL[lg]?.name; it.lgKey = lg;
      it.img = team ? x.logos?.[0]?.href || '' : x.headshot?.href || shot(lg === 'nfl' ? 'nfl' : 'college-football', x.id); it.face = !team;
    } else if (sp === 'basketball') {
      const lg = { nba: 'nba', wnba: 'wnba', nbl: 'nbl', 'mens-college-basketball': 'cbb', 'womens-college-basketball': 'wcbb' }[slug]; if (!lg) return null;
      it.attrs = team ? { bbteam: x.id, bbl: lg } : { bbplayer: x.id, bbl: lg }; it.lg = BBL[lg]?.short || BBL[lg]?.name; it.lgKey = lg;
      it.img = team ? x.logos?.[0]?.href || '' : x.headshot?.href || (typeof bbShot === 'function' ? bbShot(x.id, lg) : ''); it.face = !team;
    } else if (sp === 'hockey') {
      const l = typeof HK_LEAGUES !== 'undefined' && HK_LEAGUES.find(l => l.path && l.path === slug); if (!l) return null;
      it.attrs = team ? { hkteam: x.id, hkl: l.key } : { hkplayer: x.id, hkl: l.key }; it.lg = l.short || l.name; it.lgKey = l.key;
      it.img = team ? x.logos?.[0]?.href || '' : x.headshot?.href || shot(l.path, x.id); it.face = !team;
    } else if (sp === 'ufc') {
      if (team) return null;
      it.kind = 'fighter'; it.attrs = { ufcfighter: x.id }; it.lg = 'UFC'; it.lgKey = 'ufc'; it.img = x.headshot?.href || shot('mma', x.id); it.face = 1;
    }
    // a player row reads "team · position · league"; a team row names its sport too, so the Rangers in hockey and baseball differ
    if (!team) { it.team = it.team ?? tr; it.pos = x.position?.abbreviation || x.position?.displayName || '' }
    it.sub = team ? [it.lg, SPORT[sp]].filter((v, i, a) => v && a.indexOf(v) === i).join(' · ') : [it.team, it.pos, it.lg || SPORT[sp]].filter(Boolean).join(' · ');
    // the team shown is the player record's (players.js), never the search's own guess
    if (!team && window.flPlayers) { it.reg = window.flPlayers.fid(it.lgKey, x.id); it.regTeam = String(x.teamRelationships?.[0]?.id || x.teamRelationships?.[0]?.core?.id || '') }
    return it;
  }
  async function espnAll(q) {
    const [P, T] = await Promise.all([espn(q, 'player', 24).catch(() => []), espn(q, 'team', 14).catch(() => [])]);
    return [...P.map(fromEspn), ...T.map(fromEspn)].filter(Boolean);
  }
  // baseball pages use MLB's own ids, so baseball comes from MLB's people search and team list, not ESPN
  let bsTeams = null;
  async function baseball(q) {
    if (typeof SA === 'undefined') return [];
    bsTeams ||= cj(`${SA}/teams?sportIds=${BS_SPORTS}&season=${bsYear()}`).then(d => d.teams || []).catch(() => { bsTeams = null; return [] });
    const ql = norm(q);
    const [teams, people] = await Promise.all([bsTeams, cj(`${SA}/people/search?names=${encodeURIComponent(q)}&sportIds=${BS_SPORTS}&hydrate=currentTeam`).catch(() => ({}))]);
    const lgOf = t => t && BS_LEAGUES.find(l => l.src === 'sa' && l.sport === t.sport?.id && (!l.league || l.league === t.league?.id));
    const T = (teams || []).filter(t => norm(`${t.name} ${t.abbreviation || ''} ${t.teamName || ''}`).includes(ql)).map(t => ({ t, l: lgOf(t) })).filter(x => x.l).slice(0, 6)
      .map(({ t, l }, i) => ({ sp: 'baseball', kind: 'team', id: String(t.id), title: t.name, sub: `${l.name} · Baseball`, lg: l.name, lgKey: l.key, rank: i + 4, img: bsLogo(t.id), attrs: { bsteam: t.id, bsl: l.key } }));
    const P = (people.people || []).sort((a, b) => !!b.currentTeam - !!a.currentTeam || !!b.active - !!a.active).slice(0, 10).map((p, i) => { const t = p.currentTeam, l = lgOf(t);
      return { sp: 'baseball', kind: 'player', id: String(p.id), title: p.fullName, team: t?.name || '', sub: [t?.name, p.primaryPosition?.abbreviation, l?.name].filter(Boolean).join(' · ') || 'Free agent or retired', lg: l?.name, lgKey: l?.key || '', rank: i, active: !!p.active, retired: !p.active && !t,
        img: bsShot(p.id, !t || t.sport?.id === 1), face: 1, attrs: { bsplayer: p.id, bsl: l?.key || 'mlb', bsfrom: 1 },
        reg: t && t.sport?.id === 1 && window.flPlayers ? window.flPlayers.fid('mlb', p.id) : '', regTeam: t ? String(t.id) : '' } });
    return [...P, ...T];
  }
  // Floodlight's own lookups: Flashscore basketball and hockey (Europe, Asia, juniors) and tennis
  async function own(q) {
    if (S.serverOK === false || q.length < 3) return [];
    const enc = encodeURIComponent(q);
    const [bb, hk, tn] = await Promise.all([getJSON(`/api/bb/search?q=${enc}`).catch(() => null), getJSON(`/api/hk/search?q=${enc}`).catch(() => null), getJSON(`/api/tn/search?q=${enc}`).catch(() => null)]);
    const out = [];
    (bb?.teams || []).slice(0, 4).forEach((x, i) => out.push({ sp: 'basketball', kind: 'team', id: 'fs' + x.id, title: x.name, sub: x.country || 'Basketball', rank: 10 + i, img: x.img, attrs: { bbteam: x.id, bbslug: x.slug, bbl: 'fsany' } }));
    (bb?.players || []).slice(0, 4).forEach((x, i) => out.push({ sp: 'basketball', kind: 'player', id: 'fs' + x.id, title: x.name, sub: x.team || x.country || 'Basketball', rank: 12 + i, img: x.img, face: 1, fs: 1, attrs: { bbfsplayer: x.id, bbslug: x.slug, bbl: 'fsany' } }));
    (hk?.teams || []).slice(0, 4).forEach((x, i) => out.push({ sp: 'hockey', kind: 'team', id: 'fs' + x.id, title: x.name, sub: x.country || 'Hockey', rank: 10 + i, img: x.img, attrs: { hkteam: x.id, hkslug: x.slug, hkl: 'khl', hkany: 1 } }));
    (hk?.players || []).slice(0, 4).forEach((x, i) => out.push({ sp: 'hockey', kind: 'player', id: 'fs' + x.id, title: x.name, sub: x.team || x.country || 'Hockey', rank: 12 + i, img: x.img, face: 1, fs: 1, attrs: { hkfsplayer: x.id, hkslug: x.slug, hkl: 'khl' } }));
    (tn?.players || []).slice(0, 6).forEach((x, i) => out.push({ sp: 'tennis', kind: 'player', id: 'tn' + x.id, title: x.name, sub: ['Tennis', x.country, x.gender].filter(Boolean).join(' · '), rank: i + 2, img: x.img, face: 1, attrs: { tnplayer: x.id, tnslug: x.slug } }));
    return out;
  }
  // the leagues Floodlight covers, matched on name, short name, area and the usual abbreviations
  function leagues(q) {
    const qn = norm(ALIAS[norm(q)] || q), w = qn.split(' ').filter(Boolean); if (!w.length) return [];
    const all = [
      ...(typeof LEAGUES !== 'undefined' ? LEAGUES : []).map(l => ({ sp: 'soccer', key: l.slug, name: l.name, area: l.area, attrs: { gsleague: l.slug } })),
      ...(typeof FB_LEAGUES !== 'undefined' ? FB_LEAGUES : []).map(l => ({ sp: 'football', key: l.key, name: l.name, area: l.area, k: l.kx, attrs: { fblg: l.key } })),
      ...(typeof BB_LEAGUES !== 'undefined' ? BB_LEAGUES : []).map(l => ({ sp: 'basketball', key: l.key, name: l.name, area: l.area, k: `${l.short || ''} ${l.kx || ''}`, attrs: { bblg: l.key } })),
      ...(typeof HK_LEAGUES !== 'undefined' ? HK_LEAGUES : []).map(l => ({ sp: 'hockey', key: l.key, name: l.name, area: l.area, k: l.short, attrs: { hklg: l.key } })),
      ...(typeof BS_LEAGUES !== 'undefined' ? BS_LEAGUES : []).map(l => ({ sp: 'baseball', key: l.key, name: l.name, area: l.area, k: l.kx, attrs: { bslg: l.key } })),
      { sp: 'ufc', key: 'ufc', name: 'UFC', area: 'Events and fighters', attrs: { sport: 'ufc' } }, { sp: 'boxing', key: 'boxing', name: 'Boxing', area: 'Fight nights', attrs: { sport: 'boxing' } },
      { sp: 'tennis', key: 'atp', name: 'Tennis: ATP and WTA', area: 'Tours, Slams and rankings', k: 'atp wta grand slam', attrs: { sport: 'tennis' } },
    ];
    return all.map(l => { const hay = norm(`${l.name} ${l.k || ''} ${l.key} ${l.area || ''} ${SPORT[l.sp]}`), nm = norm(l.name);
      if (!w.every(x => hay.split(' ').some(h => h.startsWith(x)))) return null;
      return { sp: l.sp, kind: 'league', id: l.sp + ':' + l.key, title: l.name, sub: [SPORT[l.sp], l.area].filter(Boolean).join(' · '), lgKey: l.key, attrs: l.attrs, rank: nm === qn ? -20 : nm.startsWith(qn) ? -8 : 4 } })
      .filter(Boolean);
  }
  // today's games on the Live Hub: "lakers", "lakers v celtics", "chiefs at bills"
  function games(q, vs) {
    const G2 = window.flHub?.games?.() || []; if (!G2.length) return [];
    const words = s => norm(s).split(' ').filter(Boolean), hit = (t, s) => words(s).every(x => norm(`${t.full} ${t.name} ${t.abbr || ''}`).split(' ').some(h => h.startsWith(x)));
    const w = words(q);
    return G2.filter(g => vs ? (hit(g.a, vs[0]) && hit(g.b, vs[1])) || (hit(g.a, vs[1]) && hit(g.b, vs[0]))
      : w.every(x => norm(`${g.a.full} ${g.a.name} ${g.a.abbr || ''} ${g.b.full} ${g.b.name} ${g.b.abbr || ''} ${g.short}`).split(' ').some(h => h.startsWith(x))))
      .slice(0, 6).map((g, i) => ({ sp: g.sport, kind: 'game', id: 'g' + g.key, g, title: `${g.a.name} ${g.state === 'pre' ? 'v' : `${g.a.score}–${g.b.score}`} ${g.b.name}`, live: g.state === 'in',
        sub: [g.short, g.state === 'in' ? `Live${g.clock ? ', ' + g.clock : ''}` : g.state === 'pre' ? g.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Final'].filter(Boolean).join(' · '), rank: i - (g.state === 'in' ? 2 : 0) }));
  }
  // typo tolerance: when nothing matches, look again with a shorter query and keep only the close names
  function close(a, b) {
    a = norm(a); b = norm(b); if (!a || !b) return 0;
    const grams = s => { const g = new Set(); s = ` ${s} `; for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3)); return g };
    const A = grams(a); let best = 0;
    for (const part of [b, ...b.split(' ')]) { const B = grams(part); let n = 0; A.forEach(x => B.has(x) && n++); best = Math.max(best, 2 * n / (A.size + B.size)) }
    // swapped or doubled letters ("Leborn", "Mahommes") barely share trigrams; an edit distance catches them
    for (const qa of [a, ...a.split(' ')]) for (const part of [b, ...b.split(' ')]) if (qa.length >= 4 && part.length >= 4) best = Math.max(best, (1 - edits(qa, part) / Math.max(qa.length, part.length)) * (qa === a ? 1 : .9));
    return best;
  }
  function edits(a, b) {   // Damerau-Levenshtein (adjacent swaps count as one)
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) { const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c); if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1) }
    return d[a.length][b.length];
  }

  // names to correct a typo against: what you searched and follow, today's teams, and the best-known names in each sport
  const STARS = 'LeBron James|Stephen Curry|Kevin Durant|Giannis Antetokounmpo|Nikola Jokic|Luka Doncic|Joel Embiid|Jayson Tatum|Shai Gilgeous-Alexander|Anthony Edwards|Victor Wembanyama|Devin Booker|Jalen Brunson|Donovan Mitchell|Kawhi Leonard|Anthony Davis|Ja Morant|Tyrese Haliburton|Damian Lillard|Jimmy Butler|Kyrie Irving|Trae Young|Paolo Banchero|Cade Cunningham|Zion Williamson|Jaylen Brown|Domantas Sabonis|Karl-Anthony Towns|Bam Adebayo|Cooper Flagg|Caitlin Clark|A\'ja Wilson|Patrick Mahomes|Josh Allen|Lamar Jackson|Joe Burrow|Jalen Hurts|Justin Herbert|Christian McCaffrey|Saquon Barkley|Derrick Henry|Justin Jefferson|Ja\'Marr Chase|Tyreek Hill|CeeDee Lamb|Travis Kelce|Amon-Ra St. Brown|Puka Nacua|Bijan Robinson|Jahmyr Gibbs|Micah Parsons|Jayden Daniels|Caleb Williams|Brock Purdy|Dak Prescott|Shohei Ohtani|Aaron Judge|Mookie Betts|Juan Soto|Bobby Witt Jr.|Freddie Freeman|Vladimir Guerrero Jr.|Gunnar Henderson|Paul Skenes|Tarik Skubal|Elly De La Cruz|Connor McDavid|Leon Draisaitl|Nathan MacKinnon|Auston Matthews|Sidney Crosby|Alex Ovechkin|Nikita Kucherov|Cale Makar|David Pastrnak|Kirill Kaprizov|Connor Bedard|Kylian Mbappe|Erling Haaland|Lionel Messi|Cristiano Ronaldo|Mohamed Salah|Vinicius Junior|Jude Bellingham|Harry Kane|Bukayo Saka|Lamine Yamal|Cole Palmer|Florian Wirtz|Jamal Musiala|Robert Lewandowski|Carlos Alcaraz|Jannik Sinner|Novak Djokovic|Aryna Sabalenka|Iga Swiatek|Coco Gauff|Jon Jones|Ilia Topuria|Islam Makhachev|Alex Pereira|Tom Aspinall|Lakers|Celtics|Warriors|Knicks|Bucks|Nuggets|Thunder|Cavaliers|Mavericks|Timberwolves|Chiefs|Eagles|Cowboys|Bills|Ravens|49ers|Packers|Lions|Steelers|Yankees|Dodgers|Red Sox|Mets|Cubs|Maple Leafs|Oilers|Rangers|Bruins|Arsenal|Liverpool|Manchester United|Manchester City|Chelsea|Tottenham|Real Madrid|Barcelona|Bayern Munich|Juventus|Inter Milan|Paris Saint-Germain'.split('|');
  const known = () => [...new Set([...G.recent.map(r => r.title), ...(S.fav || []).map(f => f.name), ...(window.flHub?.games?.() || []).flatMap(g => [g.a.full, g.b.full]), ...STARS].filter(Boolean))];

  /* ---------- ranking: the sport you are on is a preference, never a filter ---------- */
  function score(it, qn) {
    const t = norm(it.title), words = qn.split(' ').filter(Boolean);
    let s = 40 - (it.rank || 0) * 2;
    if (t === qn) s += 50; else if (t.startsWith(qn)) s += 26; else if (words.every(x => t.split(' ').some(h => h.startsWith(x)))) s += 16; else if (t.includes(qn)) s += 6;
    if (it.sp === S.sport) s += window.flHub?.on?.() ? 6 : 18;   // on a sport's page its results come first; on Home only a nudge
    if (it.sp === 'soccer' && it.kind === 'team' && it.lgKey && !LG[it.lgKey]) s -= 8;   // a league Floodlight does not list
    if ((store.get('fl.favSports', []) || []).includes(it.sp)) s += 6;
    if (PRO.has(it.lgKey)) s += 12; else if (/^(fbs|fcs|cbb|wcbb|ncaam|ncaaw)$/.test(it.lgKey || '')) s -= 4;
    if (it.retired) s -= 10; else if (it.active === false) s -= 4;
    if (it.live) s += 8;
    if (G.recent.some(r => r.key === key(it))) s += 10;
    return s;
  }
  const key = it => `${it.sp}:${it.kind}:${it.id}`;
  function dedupe(list) { const seen = new Set(); return list.filter(it => { const k = it.kind === 'team' && it.sp === 'basketball' ? `bb:team:${norm(it.title)}` : key(it); if (seen.has(k)) return false; seen.add(k); return true }) }

  async function query(raw, onUpdate) {
    const nl = parse(raw), q = nl.name || norm(raw);
    if (q.length < 2 && !nl.vs) return null;
    const res = { raw, q, nl, players: [], teams: [], leagues: leagues(q), games: games(q, nl.vs), lab: [], fuzzy: '', pending: 3 };
    const merge = list => {
      for (const it of list) (it.kind === 'team' ? res.teams : it.kind === 'league' ? res.leagues : res.players).push(it);
      const qn = norm(q);
      for (const k of ['players', 'teams', 'leagues', 'games']) res[k] = dedupe(res[k]).map(it => (it.s = score(it, qn), it)).sort((a, b) => b.s - a.s);
      res.lab = labRows(res);
    };
    merge([]);
    const step = p => p.then(list => { res.pending--; merge(list || []); onUpdate?.(res) }, () => { res.pending--; onUpdate?.(res) });
    const local = ufcLocal(q);
    if (local.length) merge(local);
    // "lakers v celtics": both teams, as well as the game
    const teamsOf = side => espnAll(side).then(l => l.filter(it => it.kind === 'team'));
    // "LAL", "KC": the real teams those letters stand for, found by their full names
    const ab = !nl.vs && ABBR[norm(q).replace(/\s/g, '')];
    if (ab) { res.pending++; step(Promise.all(ab.map(t => espnAll(t.name).then(l => l.filter(it => it.kind === 'team' && norm(it.title) === norm(t.name)).map(it => (it.rank = -6, it))).catch(() => [])))
      .then(a => { const got = a.flat(); res.abbr = ab; return got })) }
    await Promise.all(nl.vs ? [step(Promise.all(nl.vs.map(teamsOf)).then(a => a.flat())), step(Promise.resolve([])), step(Promise.resolve([]))] : [step(espnAll(q)), step(baseball(q)), step(own(q))]);
    while (res.pending > 0) await new Promise(r => setTimeout(r, 60));
    // nothing whose name starts with what was typed: likely a typo ("Leborn"), so look for the closest known name
    const qw = norm(q).split(' ').filter(Boolean), named = it => qw.every(w => norm(it.title).split(' ').some(h => h.startsWith(w)));
    if (!nl.vs && ![...res.players, ...res.teams, ...res.leagues, ...res.games].some(named) && norm(q).length >= 4) {
      // ESPN only matches whole words, so a typo finds nothing: find the closest known name and search that instead
      const best = known().map(n => [n, Math.max(close(q, n), ...n.split(' ').map(w => close(q, w) * .92))]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= .5) { const more = await espnAll(best[0]).catch(() => []); if (more.length) { res.fuzzy = best[0]; more.forEach(it => { if (norm(it.title) === norm(best[0])) it.rank = -10 }); merge(more) } }
      onUpdate?.(res);
    }
    return res;
  }
  // UFC fighters and boxing cards already on the page
  function ufcLocal(q) {
    const qn = norm(q), out = [];
    if (typeof ufcAll === 'function') { const seen = new Set();
      for (const e of ufcAll()) for (const b of e.bouts || []) for (const f of [b.a, b.b]) { if (!f?.id || seen.has(f.id) || !norm(f.name).includes(qn)) continue; seen.add(f.id);
        out.push({ sp: 'ufc', kind: 'fighter', id: String(f.id), title: f.name, sub: ['UFC', f.rec].filter(Boolean).join(' · '), lgKey: 'ufc', rank: 1, img: shot('mma', f.id), face: 1, attrs: { ufcfighter: f.id } }) } }
    for (const e of S.bx?.cards || []) if (norm(`${e.a} ${e.b} ${e.name}`).includes(qn)) out.push({ sp: 'boxing', kind: 'game', id: 'bx' + e.id, title: `${e.a} v ${e.b}`, sub: 'Boxing', rank: 3, attrs: { bxfight: e.id } });
    return out.slice(0, 10);
  }
  // the Lab: a prop question first when the query reads like one, then the top player, then the question as typed
  const LAB_SPORT = it => it.sp === 'basketball' ? ({ nba: 'nba', wnba: 'wnba' }[it.lgKey]) : it.sp === 'football' ? (it.lgKey === 'nfl' ? 'nfl' : null) : it.sp === 'hockey' ? (it.lgKey === 'nhl' ? 'nhl' : null)
    : it.sp === 'baseball' ? (it.lgKey === 'mlb' || !it.lgKey ? 'mlb' : null) : it.sp === 'soccer' ? 'soccer' : it.sp === 'ufc' ? 'ufc' : null;
  // a league named with a stat ("NBA assists", "NFL rushing yards"): today's board for that market
  const MARKET_LG = { nba: 'nba', wnba: 'wnba', nfl: 'nfl', nhl: 'nhl', mlb: 'mlb', 'premier league': 'soccer', epl: 'soccer', soccer: 'soccer', basketball: 'nba', football: 'nfl', hockey: 'nhl', baseball: 'mlb' };
  function labRows(res) {
    const rows = [], top = res.players.find(p => LAB_SPORT(p)), nl = res.nl;
    const mk = MARKET_LG[norm(res.q)] || MARKET_LG[norm(ALIAS[norm(res.q)] || '')];
    if (mk && nl.stat) rows.push({ sp: '', kind: 'lab', id: 'labm', title: `Today’s ${mk.toUpperCase() === 'SOCCER' ? 'soccer' : mk.toUpperCase()} ${nl.label} props`, sub: 'Every posted line, ranked by recent hit rate', lab: { sport: mk, tab: 'board', stat: nl.stat[mk] || '' } });
    if (top) { const sp = LAB_SPORT(top), stat = nl.stat?.[sp];
      if ((nl.stat || nl.side) && (stat || !nl.stat)) rows.push({ sp: top.sp, kind: 'lab', id: 'labq', title: `${top.title}: ${stat ? nl.label : 'props'}${nl.side ? ` ${nl.side}` : ''}${nl.line != null ? ` ${nl.line}` : ''}`, sub: 'Game log, hit rate and projection', lab: { sport: sp, name: top.title, kind: 'player', stat: stat || '', line: nl.line ?? undefined, side: nl.side || undefined } });
      rows.push({ sp: top.sp, kind: 'lab', id: 'labp', title: `Open ${top.title} in the Lab`, sub: 'Every stat, game log and split', lab: { sport: sp, name: top.title, kind: 'player' } });
      rows.push({ sp: top.sp, kind: 'lab', id: 'labprops', title: `View ${top.title}’s current props`, sub: 'Today’s posted lines and how often each one cleared', lab: { sport: sp, name: top.title, kind: 'player', stat: stat || '' } });
      rows.push({ sp: top.sp, kind: 'lab', id: 'labtrend', title: `View ${top.title}’s trends`, sub: 'Recent games as a trend line, with the average', lab: { sport: sp, name: top.title, kind: 'player', stat: stat || '', mode: 'trend' } });
      if (window.flLab?.compare) rows.push({ sp: top.sp, kind: 'lab', id: 'labcmp', title: `Compare ${top.title} with another player`, sub: 'Two game logs side by side on one line', cmp: { sport: sp, name: top.title } });
    }
    const team = res.teams.find(t => LAB_SPORT(t) && t.sp !== 'baseball');
    if (team) rows.push({ sp: team.sp, kind: 'lab', id: 'labt', title: `Open ${team.title} in the Lab`, sub: 'Team markets, splits and game log', lab: { sport: LAB_SPORT(team), name: team.title, kind: 'team' } });
    rows.push({ sp: '', kind: 'lab', id: 'labask', title: `Ask the Lab: “${res.raw.trim()}”`, sub: 'The Lab reads the whole question', lab: { q: res.raw.trim() } });
    return rows;
  }

  /* ---------- opening a result ---------- */
  const DEST = { player: 'Profile', fighter: 'Profile', team: 'Team page', league: 'League', game: 'Match centre', lab: 'Lab' };
  function remember(it) {
    if (it.kind === 'lab' && (it.id === 'labask' || it.cmp)) return;
    const r = { key: key(it), sp: it.sp, kind: it.kind, lgKey: it.lgKey || '', fs: it.fs ? 1 : 0, id: it.id, title: it.title, sub: it.sub, img: it.img || '', face: it.face ? 1 : 0, attrs: it.attrs, lab: it.lab, at: Date.now() };
    if (it.kind === 'game') return;   // today's games change; the recent list keeps the lasting things
    G.recent = [r, ...G.recent.filter(x => x.key !== r.key)].slice(0, 8); store.set('fl.searchRecent', G.recent);
  }
  /* Opening a result: close the results, leave Home or any page, open the destination, give it its own address,
     put focus on its heading, empty the box (the query lives on only in recent searches) and offer a way back. */
  function leave() {
    try { window.flPages?.current?.() && window.flPages.hide() } catch (e) {}
    try { window.flHub?.on?.() && window.flHub.hide() } catch (e) {}
  }
  const addr = it => { const a = it.attrs || {}, q = new URLSearchParams({ k: it.kind, sp: it.sp || '', id: it.id, t: it.title || '' });
    for (const [k, v] of Object.entries(a)) q.set('a.' + k, v);
    if (it.kind === 'game' && it.g) q.set('g', `${it.g.sport}|${it.g.lg || ''}|${it.g.id}`);
    return '#/go/' + q };
  function fromAddr(h) {
    const q = new URLSearchParams(h.replace(/^#\/go\/?/, '')), attrs = {};
    for (const [k, v] of q) if (k.startsWith('a.')) attrs[k.slice(2)] = v;
    const g = q.get('g'), [sport, lg, id] = (g || '').split('|');
    return { kind: q.get('k'), sp: q.get('sp'), id: q.get('id'), title: q.get('t'), attrs, gref: g ? { sport, lg, id } : null };
  }
  // the destination's heading, once it has drawn: the sheet's title, a page's h1, or the match centre's title
  function focusHeading(kind) {
    const pick = () => {
      const cands = kind === 'lab' ? ['#pg-lab h1', '#labWsH', '#pg-lab h2'] : kind === 'game' ? ['#gxTitle', '#sheet h1', '#sheet h2', '#sheet .pfh-name'] : ['#sheet .pfh-name', '#sheet h1', '#sheet h2', '#sheet h3'];
      for (const c of cands) { const el = document.querySelector(c); if (el && (el.offsetParent !== null || el.classList.contains('sr-only')) && el.textContent.trim() && (!/^Loading/.test(el.textContent.trim()) || late)) return el }
      return null;
    };
    let n = 0, late = false; const t = setInterval(() => { late = n > 30; const el = pick(); if (el || ++n > 40) { clearInterval(t); if (!el) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: false }) } }, 150);
  }
  function rememberQuery(raw) { raw = String(raw || '').trim(); if (raw.length < 2) return; G.recentQ = [raw, ...G.recentQ.filter(x => norm(x) !== norm(raw))].slice(0, 6); store.set('fl.searchRecentQ', G.recentQ) }
  function reset() {   // the box is emptied once a result opens; the count and query do not follow you to the next page
    G.last = G.res && G.q ? { raw: G.q, res: G.res } : G.last; rememberQuery(G.q);
    ++G.seq; G.res = null; G.q = ''; input.value = ''; S.q = ''; clear.hidden = true; box.innerHTML = ''; live.textContent = ''; rows = [];
    document.querySelector('.top')?.classList.remove('search-open'); document.getElementById('tbSearch')?.setAttribute('aria-expanded', 'false');
  }
  function go(it, o = {}) {
    if (!o.replay) { remember(it); G.from = { hub: !!window.flHub?.on?.(), page: window.flPages?.current?.() || null } }
    hide(true); if (!o.replay) reset();
    if (it.kind === 'lab') {
      if (it.cmp) window.flLab?.compare?.(it.cmp); else if (window.flLab?.open) window.flLab.open(it.lab); else document.querySelector('[data-shell="lab"]')?.click();
      backBar(); return focusHeading('lab');
    }
    // a game opens in the match centre over the page you are on, the same as from Home and Live
    if (it.kind === 'game' && (it.g || it.gref) && window.flMC?.open(it.g || it.gref, document.body)) {
      const want = addr(it); if (!o.replay && location.hash !== want) { history.pushState({ flGo: 1 }, '', want); atGo = true }
      backBar(); return focusHeading('game');
    }
    leave();
    if (it.kind === 'game' && (it.g || it.gref)) { window.flHub?.open(it.g || it.gref) }
    else {
      const a = it.attrs || {};
      if (a.sport) { (document.querySelector(`.tbs[data-sport="${a.sport}"]`) || document.querySelector(`[data-sport="${a.sport}"]`))?.click(); backBar(); return }
      if (it.sp && it.sp !== S.sport && typeof setSport === 'function') setSport(it.sp);
      if (a.gsleague) { if (typeof openLeague === 'function') openLeague(a.gsleague, true) }
      else {
        // the sport pages listen for clicks on these data attributes; a short-lived button outside the results reuses them as they are
        const b = document.createElement('button'); b.type = 'button'; b.hidden = true;
        for (const [k, v] of Object.entries(a)) b.dataset[k] = v;
        document.body.appendChild(b); b.click(); b.remove();
      }
    }
    const want = addr(it);
    if (!o.replay && location.hash !== want) { history.pushState({ flGo: 1 }, '', want); atGo = true }
    backBar(); focusHeading(it.kind);
  }
  // "Back to results": a small bar under the header after a result opens, until you move on
  function backBar() {
    document.getElementById('gsBack')?.remove();
    if (!G.last) return;
    const b = document.createElement('div'); b.id = 'gsBack'; b.className = 'gs-back';
    b.innerHTML = `<button type="button" class="gs-back-go"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Back to results for “${esc(G.last.raw)}”</button><button type="button" class="gs-back-x" aria-label="Dismiss back to results">${'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'}</button>`;
    document.body.appendChild(b);
    b.querySelector('.gs-back-go').addEventListener('click', () => { const l = G.last; b.remove(); if (!l) return;
      if (matchMedia('(max-width:820px)').matches) { document.querySelector('.top')?.classList.add('search-open'); document.getElementById('tbSearch')?.setAttribute('aria-expanded', 'true') }
      input.value = l.raw; G.q = l.raw; G.res = l.res; clear.hidden = false; input.focus(); draw(l.res) });
    b.querySelector('.gs-back-x').addEventListener('click', () => { b.remove(); G.last = null });
    clearTimeout(G.backT); G.backT = setTimeout(() => document.getElementById('gsBack')?.remove(), 120000);
  }
  // moving on somewhere else retires the bar
  document.addEventListener('click', ev => { if (!ev.target.closest?.('[data-shell],[data-page],button[data-sport],.rail button') || box.contains(ev.target)) return;
    document.getElementById('gsBack')?.remove(); if (atGo) { history.replaceState(null, '', location.pathname + location.search); atGo = false } }, true);
  // the address a result gave: Back closes what it opened and returns to where you were; a shared link opens it again
  let atGo = location.hash.startsWith('#/go/');
  addEventListener('popstate', () => {
    const was = atGo; atGo = location.hash.startsWith('#/go/');
    if (atGo) return replay();
    if (!was) return;
    try { if (S.stack?.length && typeof closeSheet === 'function') closeSheet(true) } catch (e) {}
    try { if (document.documentElement.classList.contains('gx-on')) window.flMC?.close() } catch (e) {}
    const f = G.from; G.from = null;
    if (!location.hash && (f?.hub || !f) && window.flHub && !window.flPages?.current?.()) window.flHub.show();
  });
  function replay() { const it = fromAddr(location.hash); if (it.kind) go(it, { replay: true }) }
  if (location.hash.startsWith('#/go/')) { let n = 0; const t = setInterval(() => { if (++n > 50 || (it => it.kind !== 'game' || window.flHub?.at?.())(fromAddr(location.hash))) { clearInterval(t); replay() } }, 200) }
  // closing what a result opened goes back a step in history, so the address matches the screen again
  if (typeof closeSheet === 'function') { const _close = closeSheet; window.closeSheet = closeSheet = function (quiet) { const r = _close.apply(this, arguments); if (!quiet && location.hash.startsWith('#/go/') && history.state?.flGo) history.back(); else if (!quiet && location.hash.startsWith('#/go/')) { history.replaceState(null, '', location.pathname + location.search); atGo = false } return r } }
  // the match centre closed (its X, Esc or the backdrop) after a result opened it: step back, and land on "Back to results"
  new MutationObserver(() => { const on = document.documentElement.classList.contains('gx-on');
    if (!on && G.gx && atGo) { G.gx = false; if (history.state?.flGo) history.back(); else { history.replaceState(null, '', location.pathname + location.search); atGo = false } setTimeout(() => document.querySelector('#gsBack .gs-back-go')?.focus(), 0) }
    G.gx = on && location.hash.startsWith('#/go/') }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  if (typeof goBack === 'function') { const _back = goBack; window.goBack = goBack = function () { const r = _back.apply(this, arguments); if (!S.stack.length && location.hash.startsWith('#/go/')) { if (history.state?.flGo) history.back(); else { history.replaceState(null, '', location.pathname + location.search); atGo = false } } return r } }
  function follow(it, btn) {
    const sp = it.sp, a = it.attrs || {};
    const entry = sp === 'soccer' ? { id: it.id, name: it.title, logo: it.img, lg: a.lg || '' }
      : { id: `${{ football: 'fb', basketball: 'bb', hockey: 'hk', baseball: 'bs' }[sp]}-${a.fbl || a.bbl || a.hkl || a.bsl}-${String(it.id).replace(/^fs/, '')}`, tid: String(it.id).replace(/^fs/, ''), sport: sp, lg: a.fbl || a.bbl || a.hkl || a.bsl, slug: a.bbslug || a.hkslug || '', name: it.title, logo: it.img || '' };
    const on = S.fav.some(f => f.id === entry.id);
    S.fav = on ? S.fav.filter(f => f.id !== entry.id) : [...S.fav, entry];
    typeof savePrefs === 'function' && savePrefs();
    btn.setAttribute('aria-pressed', String(!on)); btn.textContent = on ? 'Follow' : 'Following';
    say(on ? `Stopped following ${it.title}` : `Following ${it.title}`);
  }
  const followed = it => { const a = it.attrs || {}; return it.sp === 'soccer' ? S.fav.some(f => !f.sport && String(f.id) === String(it.id)) : S.fav.some(f => f.sport === it.sp && String(f.tid) === String(it.id).replace(/^fs/, '') && f.lg === (a.fbl || a.bbl || a.hkl || a.bsl)) };

  /* ---------- drawing ---------- */
  let rows = [];
  const ph = it => it.img ? `<img class="${it.face ? 'face' : ''}" src="${esc(it.img)}" alt="" width="${it.face ? 34 : 28}" height="${it.face ? 42 : 28}" loading="lazy" onerror="this.onerror=null;this.src=${it.face ? 'SIL' : `'data:image/gif;base64,R0lGODlhAQABAAAAACw='`}">`
    : `<span class="gs-ic" aria-hidden="true">${window.flShell?.ic ? window.flShell.ic(it.kind === 'lab' ? 'research' : it.kind === 'league' ? (it.sp || 'live') : it.sp || 'live', 18) : ''}</span>`;
  function row(it, first) {
    const i = rows.push(it) - 1, canLab = (it.kind === 'player' || it.kind === 'fighter') && LAB_SPORT(it) && !it.fs, canFollow = it.kind === 'team' && it.sp !== 'tennis';
    return `<li class="gs-row${it.live ? ' live' : ''}"><button type="button" class="sr gs-go" data-gs="${i}" id="gs${i}">${ph(it)}
      <span class="gs-t"><strong>${esc(it.title)}</strong><small>${it.reg ? `<span data-flreg="${esc(it.reg)}" data-flreg-show="sub" data-flreg-shown="${esc(it.regTeam || '')}" data-flreg-where="search">${esc(it.sub || '')}</span>` : esc(it.sub || '')}</small>${it.next ? `<small class="gs-next">${esc(it.next)}</small>` : ''}</span>
      <span class="gs-dest">${it.live ? '<i class="gs-dot" aria-hidden="true"></i>Live' : esc(DEST[it.kind] || '')}${first ? '<kbd aria-hidden="true">↵</kbd>' : ''}</span></button>
      ${canLab || canFollow ? `<span class="gs-acts">${canLab ? `<button type="button" class="gs-act" data-gsact="lab" data-gs="${i}" aria-label="Open ${esc(it.title)} in the Lab">Lab</button>` : ''}${canLab && window.flLab?.compare ? `<button type="button" class="gs-act" data-gsact="compare" data-gs="${i}" aria-label="Compare ${esc(it.title)} with another player">Compare</button>` : ''}${canFollow ? `<button type="button" class="gs-act" data-gsact="follow" data-gs="${i}" aria-pressed="${followed(it)}" aria-label="Follow ${esc(it.title)}">${followed(it) ? 'Following' : 'Follow'}</button>` : ''}</span>` : ''}</li>`;
  }
  const group = (title, list, firstSet) => list.length ? `<div class="gs-g" role="group" aria-label="${esc(title)}"><div class="sr-h">${esc(title)}</div><ul>${list.map((it, j) => row(it, firstSet && j === 0)).join('')}</ul></div>` : '';
  // the next game for a player's or team's side, from today's Live Hub list
  function nextGame(it) {
    const name = norm(it.kind === 'team' ? it.title : it.team || ''); if (!name) return '';
    const g = (window.flHub?.games?.() || []).filter(g => g.state !== 'post' && g.sport === it.sp && [g.a, g.b].some(t => norm(t.full || t.name) === name)).sort((a, b) => a.date - b.date)[0];
    if (!g) return '';
    const opp = norm(g.a.full || g.a.name) === name ? g.b : g.a;
    return g.state === 'in' ? `Live now v ${opp.name}` : `Next: v ${opp.name}, ${g.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  }
  function draw(res) {
    rows = [];
    if (!res) return drawEmpty();
    for (const it of [...res.players, ...res.teams]) if (it.next == null) it.next = nextGame(it);
    const labFirst = res.lab.length > 1 && (res.nl.stat || res.nl.side);
    // the order Erez asked for: players, teams, games, then leagues and research; a prop question puts research first, a matchup its games
    const order = labFirst ? ['lab', 'players', 'teams', 'games', 'leagues'] : res.games.length && res.nl.vs ? ['games', 'teams', 'players', 'leagues', 'lab']
      : (res.teams[0]?.s || 0) > (res.players[0]?.s || 0) + 8 ? ['teams', 'players', 'games', 'leagues', 'lab'] : (res.leagues[0]?.s || 0) > Math.max(res.players[0]?.s || 0, res.teams[0]?.s || 0) ? ['leagues', 'teams', 'players', 'games', 'lab'] : ['players', 'teams', 'games', 'leagues', 'lab'];
    const caps = { players: 6, teams: 6, leagues: 4, games: 5, lab: 6 }, names = { players: 'Players', teams: 'Teams', leagues: 'Leagues', games: 'Games', lab: 'Research' };
    const nothing = !res.players.length && !res.teams.length && !res.leagues.length && !res.games.length;
    const n = res.players.length + res.teams.length + res.leagues.length + res.games.length;
    let h = '', first = true;
    if (res.fuzzy) h += `<p class="gs-note" role="note">No exact match for “${esc(res.raw.trim())}”. Showing results for <b>${esc(res.fuzzy)}</b>.</p>`;
    if (res.abbr && !res.teams.length && !res.pending) h += `<p class="gs-note">${esc(res.raw.trim().toUpperCase())} can mean ${res.abbr.map(t => `${esc(t.name)} (${t.lg.toUpperCase()})`).join(', ')}. Their pages did not load; try the full name.</p>`;
    for (const k of order) { const list = res[k].slice(0, caps[k]); if (k === 'lab' && nothing && res.pending) continue; h += group(names[k], list, first && list.length); if (list.length) first = false }
    if (nothing && !res.pending && !res.fuzzy) h = `<div class="gs-none"><b>Nothing matches “${esc(res.raw.trim())}”</b><p>Check the spelling, try a last name (“Mahomes”), a team’s city or short name (“LAL”), or a league (“Premier League”). The Lab can also read the whole question.</p></div>` + h;
    if (res.pending) h += `<p class="gs-note gs-wait" aria-hidden="true">Searching every sport…</p>`;
    box.innerHTML = h; show();
    if (!res.pending) say(nothing ? `No results for ${res.raw.trim()}` : `${n} result${n === 1 ? '' : 's'}. Use the arrow keys to move through them.`);
  }
  function drawEmpty() {
    rows = [];
    const rec = G.recent.slice(0, 6), mine = (S.fav || []).slice(0, 6).map(f => favItem(f)).filter(Boolean);
    let h = '';
    if (G.recentQ.length) h += `<div class="gs-g" role="group" aria-label="Recent searches"><div class="sr-h gs-hrow">Recent searches<button type="button" class="gs-link" data-gsclear="q">Clear</button></div><div class="gs-chips">${G.recentQ.map(t => `<button type="button" class="chip gs-chip" data-gstry="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
    if (rec.length) h += `<div class="gs-g" role="group" aria-label="Recent"><div class="sr-h gs-hrow">Recent<button type="button" class="gs-link" data-gsclear="recent">Clear</button></div><ul>${rec.map(it => row(it)).join('')}</ul></div>`;
    if (mine.length) h += group('Your teams', mine);
    h += `<div class="gs-g gs-try"><div class="sr-h">Try</div><div class="gs-chips">${['LeBron James', 'Chiefs', 'Premier League', 'Mahomes passing yards', 'Lakers v Celtics', 'McDavid'].map(t => `<button type="button" class="chip gs-chip" data-gstry="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <p class="gs-note">Search players, teams, leagues and today’s games in every sport. <kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd> opens it from anywhere.</p></div>`;
    box.innerHTML = h; show();
  }
  function favItem(f) {
    if (!f?.name) return null;
    if (!f.sport) return { sp: 'soccer', kind: 'team', id: String(f.id), title: f.name, sub: LG[f.lg]?.name || 'Soccer', img: f.logo, attrs: { team: f.id, lg: f.lg || '' } };
    const a = { football: { fbteam: f.tid, fbl: f.lg }, basketball: f.slug && BBL[f.lg]?.src === 'fs' ? { bbteam: f.tid, bbl: f.lg, bbslug: f.slug } : { bbteam: f.tid, bbl: f.lg }, hockey: { hkteam: f.tid, hkl: f.lg, hkslug: f.slug || '' }, baseball: { bsteam: f.tid, bsl: f.lg, bsslug: f.slug || '' } }[f.sport];
    return a ? { sp: f.sport, kind: 'team', id: String(f.tid), title: f.name, sub: SPORT[f.sport], img: f.logo, attrs: a } : null;
  }
  const live = Object.assign(document.createElement('div'), { className: 'sr-only', id: 'gsLive' }); live.setAttribute('aria-live', 'polite'); document.body.appendChild(live);
  function say(t) { live.textContent = ''; setTimeout(() => { live.textContent = t }, 30) }
  function show() { box.hidden = false; G.open = true; input.setAttribute('aria-expanded', 'true'); label?.classList.add('gs-on') }
  function hide(really) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); label?.classList.remove('gs-on'); if (really !== false) G.open = false }

  async function run(raw, now) {
    const seq = ++G.seq; G.q = raw; clear.hidden = !raw;
    if (!raw.trim()) { G.res = null; if (document.activeElement === input || now) drawEmpty(); return }
    if (norm(parse(raw).name || raw).length < 2 && !parse(raw).vs) { box.innerHTML = '<p class="gs-note">Keep typing: two letters or more.</p>'; show(); return }
    const res = await query(raw, r => { if (seq === G.seq) { G.res = r; draw(r) } });
    if (seq === G.seq && res) { G.res = res; draw(res) }
  }

  /* ---------- the box itself ---------- */
  box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Search results');
  input.placeholder = 'Search players, teams, leagues and games';
  input.setAttribute('aria-label', 'Search players, teams, leagues and games in every sport');
  input.setAttribute('enterkeyhint', 'search'); input.spellcheck = false;
  const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'gs-clear'; clear.hidden = !input.value; clear.setAttribute('aria-label', 'Clear search');
  clear.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  input.insertAdjacentElement('afterend', clear);
  clear.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); input.value = ''; S.q = ''; clear.hidden = true; typeof render === 'function' && render(); input.focus(); run('', true) });

  // replace the per-sport searches the sport files installed
  window.searchAll = searchAll = function (q) { return run(q) };
  window.hideResults = hideResults = function () { hide() };

  // keys: our handler runs first (capture on the document) so the older single-sport handlers do not also act
  document.addEventListener('keydown', ev => {
    const inBox = ev.target === input, inRes = box.contains(ev.target);
    if (!inBox && !inRes) return;
    const gos = [...box.querySelectorAll('.gs-go,.gs-chip')], i = gos.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopImmediatePropagation(); if (box.hidden) return run(input.value, true); (gos[i + 1] || gos[0])?.focus() }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopImmediatePropagation(); (i > 0 ? gos[i - 1] : input).focus() }
    else if (ev.key === 'Escape') { ev.stopImmediatePropagation(); if (!box.hidden) { ev.preventDefault(); hide() } input.focus() }
    else if (ev.key === 'ArrowRight' && inRes && ev.target.classList.contains('gs-go')) { const a = ev.target.parentElement.querySelector('.gs-act'); if (a) { ev.preventDefault(); a.focus() } }
    else if (ev.key === 'ArrowLeft' && inRes && ev.target.classList.contains('gs-act')) { ev.preventDefault(); ev.target.closest('.gs-row').querySelector('.gs-go').focus() }
    else if (ev.key === 'Enter' && inBox) {
      ev.preventDefault(); ev.stopImmediatePropagation(); try { clearTimeout(qT) } catch (e) {}
      const fresh = G.res && G.res.raw === input.value && !box.hidden;
      if (fresh && rows.length && box.querySelector('.gs-go')) return go(rows[+box.querySelector('.gs-go').dataset.gs]);
      S.q = input.value; run(input.value, true);
    }
  }, true);
  input.addEventListener('focus', () => { if (!input.value.trim()) drawEmpty(); else if (G.res && G.res.raw === input.value) draw(G.res); else run(input.value, true) });
  input.addEventListener('input', () => { clear.hidden = !input.value; if (!input.value) run('', true) });
  box.addEventListener('click', ev => {
    const t = ev.target.closest('[data-gs],[data-gstry],[data-gsclear]'); if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    if (t.dataset.gstry != null) { input.value = t.dataset.gstry; input.focus(); return run(input.value, true) }
    if (t.dataset.gsclear === 'q') { G.recentQ = []; store.set('fl.searchRecentQ', []); drawEmpty(); return input.focus() }
    if (t.dataset.gsclear) { G.recent = []; store.set('fl.searchRecent', []); drawEmpty(); return input.focus() }
    const it = rows[+t.dataset.gs]; if (!it) return;
    const a = t.dataset.gsact;
    if (a === 'follow') return follow(it, t);
    if (a === 'lab') return go({ ...it, kind: 'lab', id: 'lab:' + it.id, lab: { sport: LAB_SPORT(it), name: it.title, kind: 'player' } });
    if (a === 'compare') return go({ ...it, kind: 'lab', id: 'cmp:' + it.id, cmp: { sport: LAB_SPORT(it), name: it.title } });
    go(it);
  });
  // switching sport keeps the results open (and re-ranks them for the new sport)
  document.addEventListener('click', ev => { if (G.open && input.value.trim() && ev.target.closest?.('[data-sport]') && !box.contains(ev.target)) G.keepT = Date.now() }, true);
  document.addEventListener('click', () => { if (G.keepT && Date.now() - G.keepT < 800) { G.keepT = 0; setTimeout(() => { if (G.res) draw(G.res); else run(input.value, true); document.querySelector('.top')?.classList.add('search-open') }, 0) } });
  // a sport switched from anywhere re-ranks open results
  if (typeof setSport === 'function') { const _set = setSport; window.setSport = setSport = function (sp) { const r = _set.apply(this, arguments); if (G.res && !box.hidden) setTimeout(() => draw(G.res), 0); return r } }
  // Home's game list feeds the "Games today" section; make sure it is loading
  input.addEventListener('focus', () => { try { window.flHub?.games?.().length || window.flHub?.load?.() } catch (e) {} }, { once: true });

  // Cmd/Ctrl + K opens this search from anywhere (on phones it fills the screen); pressed again it closes
  function openSearch() {
    try { window.flShell?.closeMenu?.() } catch (e) {}
    const top = document.querySelector('.top'); if (matchMedia('(max-width:1100px)').matches) { top?.classList.add('search-open'); document.getElementById('tbSearch')?.setAttribute('aria-expanded', 'true') }
    input.focus(); input.select(); if (input.value.trim()) run(input.value, true); else drawEmpty();
  }
  document.addEventListener('keydown', ev => {
    if (!((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k')) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (document.activeElement === input && !box.hidden) { hide(); input.blur(); document.querySelector('.top')?.classList.remove('search-open') } else openSearch();
  }, true);
  window.flSearch = { query, go, parse, recent: () => G.recent, open: openSearch };
})();
