/* Floodlight · prop research (in the spirit of Pickfinder)
   Pick a player, a stat and a line, and see how often they have cleared it: last 5 / 10 / 20 games, this season,
   their whole career, against one opponent, home or away. A bar for every game against the line, splits and the
   game log. "Today's player props" ranks every player line from PrizePicks, Sleeper and the sportsbooks by hit rate,
   and "Team props" puts each game's moneyline, spread and total next to how often the teams have covered them.
   Soccer comes from FotMob (through the local server), NBA/WNBA and NFL from ESPN, MLB from MLB StatsAPI,
   pick'em lines from /api/dfs (dfs.py) and sportsbook prices from /api/odds/board (odds.py). */
S.rs = { open: false, sport: store.get('fl.rsSport', 'soccer'), tab: 'player', p: null, loading: false, err: null,
  stat: null, line: null, side: 'over', range: 'l10', venue: 'all', comp: 'all', season: 'all', minMin: 0, res: 'all', opp: '',
  q: '', hits: [], recent: store.get('fl.rsRecent', []), board: null, bmk: 'all', bsort: 'l10', bq: '', team: null, dfs: {} };
const RS_SPORTS = [['soccer', 'Soccer'], ['nba', 'Basketball'], ['nfl', 'Football'], ['mlb', 'Baseball'], ['nhl', 'Hockey'], ['tennis', 'Tennis']];
// ESPN covers basketball, football and hockey the same way
const RS_ESPN = { nba: 'basketball', nfl: 'football', nhl: 'hockey' };
const rsDefLg = sport => sport === 'nfl' ? 'nfl' : sport === 'nhl' ? 'nhl' : 'nba';
const rsH = (g, ...ks) => { for (const k of ks) if (g.raw[k] != null) return g.raw[k]; return null };
// SIL holds single quotes, so it can't sit inside an inline onerror string
window.rsNoImg = img => { img.onerror = null; img.src = SIL };
const rsSum = (...xs) => xs.some(x => x == null) ? null : xs.reduce((a, b) => a + b, 0);
const rsNum = x => { if (x == null || x === '' || x === '-' || x === '--') return null; const n = parseFloat(String(x).replace(/,/g, '')); return isNaN(n) ? null : n };
const rsW = pairs => { let t = 0, any = false; for (const [v, w] of pairs) if (v != null) { t += v * w; any = true } return any ? Math.round(t * 100) / 100 : null };
const rsOut = ip => { const n = rsNum(ip); if (n == null) return null; const w = Math.trunc(n); return w * 3 + Math.round((n - w) * 10) };

/* ---------- stats each sport can be researched on (PrizePicks / Sleeper style) ---------- */
// get(g) reads one game; deep = needs per-game detail (FotMob match stats for soccer, ESPN box score + plays for the NBA)
const RS_STATS = {
  soccer: [
    { k: 'shots', l: 'Shots', deep: 1, get: g => g.deep?.total_shots },
    { k: 'sot', l: 'Shots on target', deep: 1, get: g => g.deep?.ShotsOnTarget },
    { k: 'goals', l: 'Goals', get: g => g.raw.goals },
    { k: 'assists', l: 'Assists', get: g => g.raw.assists },
    { k: 'ga', l: 'Goals + assists', get: g => rsSum(g.raw.goals, g.raw.assists) },
    { k: 'passes', l: 'Passes attempted', deep: 1, get: g => g.deep?.accurate_passes_total },
    { k: 'accp', l: 'Accurate passes', deep: 1, get: g => g.deep?.accurate_passes },
    { k: 'chances', l: 'Shots assisted (key passes)', deep: 1, get: g => g.deep?.chances_created },
    { k: 'tackles', l: 'Tackles', deep: 1, get: g => g.deep?.['matchstats.headers.tackles'] },
    { k: 'clear', l: 'Clearances', deep: 1, get: g => g.deep?.clearances },
    { k: 'int', l: 'Interceptions', deep: 1, get: g => g.deep?.interceptions },
    { k: 'fouls', l: 'Fouls committed', deep: 1, get: g => g.deep?.fouls },
    { k: 'fouled', l: 'Times fouled', deep: 1, get: g => g.deep?.was_fouled },
    { k: 'crosses', l: 'Crosses', deep: 1, get: g => g.deep?.accurate_crosses_total },
    { k: 'dribblesA', l: 'Attempted dribbles', deep: 1, get: g => g.deep?.dribbles_succeeded_total },
    { k: 'dribbles', l: 'Successful dribbles', deep: 1, get: g => g.deep?.dribbles_succeeded },
    { k: 'aerials', l: 'Aerials won', deep: 1, get: g => g.deep?.aerials_won },
    { k: 'touches', l: 'Touches', deep: 1, get: g => g.deep?.touches },
    { k: 'xg', l: 'xG', deep: 1, dec: 2, step: .1, get: g => g.deep?.expected_goals },
    { k: 'xa', l: 'xA', deep: 1, dec: 2, step: .1, get: g => g.deep?.expected_assists },
    { k: 'offsides', l: 'Offsides', deep: 1, get: g => g.deep ? (g.deep.Offsides ?? 0) : undefined },
    { k: 'saves', l: 'Goalie saves', deep: 1, gk: 1, get: g => g.deep?.saves },
    { k: 'conceded', l: 'Goals allowed', deep: 1, gk: 1, get: g => g.deep?.goals_conceded },
    { k: 'cards', l: 'Cards', get: g => rsSum(g.raw.yellow || 0, g.raw.red || 0) },
    { k: 'rating', l: 'FotMob rating', dec: 1, step: .1, get: g => g.raw.rating },
    { k: 'min', l: 'Minutes', get: g => g.min },
  ],
  nba: [
    { k: 'pts', l: 'Points', get: g => g.raw.PTS }, { k: 'reb', l: 'Rebounds', get: g => g.raw.REB }, { k: 'ast', l: 'Assists', get: g => g.raw.AST },
    { k: 'pra', l: 'Pts + Reb + Ast', get: g => rsSum(g.raw.PTS, g.raw.REB, g.raw.AST) }, { k: 'pr', l: 'Pts + Reb', get: g => rsSum(g.raw.PTS, g.raw.REB) },
    { k: 'pa', l: 'Pts + Ast', get: g => rsSum(g.raw.PTS, g.raw.AST) }, { k: 'ra', l: 'Reb + Ast', get: g => rsSum(g.raw.REB, g.raw.AST) },
    { k: 'fs', l: 'Fantasy score', dec: 1, get: g => g.raw.PTS == null ? null : rsW([[g.raw.PTS, 1], [g.raw.REB, 1.2], [g.raw.AST, 1.5], [g.raw.BLK, 3], [g.raw.STL, 3], [g.raw.TO, -1]]) },
    { k: '3pm', l: '3-pointers made', get: g => g.raw['3PM'] }, { k: '3pa', l: '3-pointers attempted', get: g => g.raw['3PA'] },
    { k: '2pm', l: '2-pointers made', get: g => g.raw.FGM == null ? null : g.raw.FGM - (g.raw['3PM'] || 0) },
    { k: '2pa', l: '2-pointers attempted', get: g => g.raw.FGA == null ? null : g.raw.FGA - (g.raw['3PA'] || 0) },
    { k: 'fgm', l: 'Field goals made', get: g => g.raw.FGM }, { k: 'fga', l: 'Field goals attempted', get: g => g.raw.FGA },
    { k: 'ftm', l: 'Free throws made', get: g => g.raw.FTM }, { k: 'fta', l: 'Free throws attempted', get: g => g.raw.FTA },
    { k: 'stl', l: 'Steals', get: g => g.raw.STL }, { k: 'blk', l: 'Blocks', get: g => g.raw.BLK }, { k: 'stocks', l: 'Blocks + steals', get: g => rsSum(g.raw.STL, g.raw.BLK) },
    { k: 'to', l: 'Turnovers', get: g => g.raw.TO },
    { k: 'oreb', l: 'Offensive rebounds', deep: 1, get: g => g.deep?.oreb }, { k: 'dreb', l: 'Defensive rebounds', deep: 1, get: g => g.deep?.dreb },
    { k: 'dunks', l: 'Dunks', deep: 1, get: g => g.deep?.dunks },
    { k: 'dd', l: 'Double-double', yes: 1, get: g => g.raw.PTS == null ? null : +([g.raw.PTS, g.raw.REB, g.raw.AST, g.raw.STL, g.raw.BLK].filter(x => x >= 10).length >= 2) },
    { k: 'td3', l: 'Triple-double', yes: 1, get: g => g.raw.PTS == null ? null : +([g.raw.PTS, g.raw.REB, g.raw.AST, g.raw.STL, g.raw.BLK].filter(x => x >= 10).length >= 3) },
    { k: 'pf', l: 'Personal fouls', get: g => g.raw.PF }, { k: 'min', l: 'Minutes', get: g => g.min },
  ],
  nfl: [
    { k: 'pyd', l: 'Passing yards', get: g => g.raw['passing.YDS'] }, { k: 'ptd', l: 'Passing TDs', get: g => g.raw['passing.TD'] },
    { k: 'pcmp', l: 'Completions', get: g => g.raw['passing.CMP'] }, { k: 'patt', l: 'Pass attempts', get: g => g.raw['passing.ATT'] },
    { k: 'pint', l: 'Interceptions thrown', get: g => g.raw['passing.INT'] }, { k: 'plng', l: 'Longest completion', get: g => g.raw['passing.LNG'] },
    { k: 'ryd', l: 'Rushing yards', get: g => g.raw['rushing.YDS'] }, { k: 'ratt', l: 'Rush attempts', get: g => g.raw['rushing.CAR'] },
    { k: 'rlng', l: 'Longest rush', get: g => g.raw['rushing.LNG'] },
    { k: 'ypc', l: 'Yards per carry', dec: 1, step: .1, get: g => g.raw['rushing.AVG'] },
    { k: 'rtg', l: 'Passer rating', dec: 1, step: 1, get: g => g.raw['passing.RTG'] }, { k: 'qbr', l: 'QBR', dec: 1, step: 1, get: g => g.raw['passing.QBR'] },
    { k: 'cpct', l: 'Completion %', dec: 1, step: 1, get: g => g.raw['passing.CMP%'] },
    { k: 'streak', l: 'Most completions in a row', deep: 1, get: g => g.deep?.streak },
    { k: 'ypr', l: 'Yards per reception', dec: 1, step: .1, get: g => g.raw['receiving.AVG'] },
    { k: 'rec', l: 'Receptions', get: g => g.raw['receiving.REC'] }, { k: 'reyd', l: 'Receiving yards', get: g => g.raw['receiving.YDS'] },
    { k: 'tgt', l: 'Targets', get: g => g.raw['receiving.TGTS'] }, { k: 'relng', l: 'Longest reception', get: g => g.raw['receiving.LNG'] },
    { k: 'rryd', l: 'Rush + rec yards', get: g => (g.raw['rushing.YDS'] ?? g.raw['receiving.YDS']) == null ? null : (g.raw['rushing.YDS'] || 0) + (g.raw['receiving.YDS'] || 0) },
    { k: 'pryd', l: 'Pass + rush yards', get: g => g.raw['passing.YDS'] == null ? null : g.raw['passing.YDS'] + (g.raw['rushing.YDS'] || 0) },
    { k: 'td', l: 'Rush + rec TDs', get: g => (g.raw['rushing.TD'] ?? g.raw['receiving.TD']) == null ? null : (g.raw['rushing.TD'] || 0) + (g.raw['receiving.TD'] || 0) },
    { k: 'fs', l: 'Fantasy score', dec: 1, get: g => rsW([[g.raw['passing.YDS'], .04], [g.raw['passing.TD'], 4], [g.raw['passing.INT'], -1], [g.raw['rushing.YDS'], .1], [g.raw['receiving.YDS'], .1],
      [g.raw['rushing.TD'], 6], [g.raw['receiving.TD'], 6], [g.raw['receiving.REC'], 1], [g.raw['fumbles.LST'], -1]]) },
    { k: 'kpts', l: 'Kicking points', get: g => g.raw['kicking.PTS'] }, { k: 'fgm', l: 'Field goals made', get: g => g.raw['kicking.FGM'] },
    { k: 'xpm', l: 'Extra points made', get: g => g.raw['kicking.XPM'] },
    { k: 'tkl', l: 'Tackles + assists', get: g => g.raw['defensive.TOT'] ?? g.raw['defense.TOT'] }, { k: 'solo', l: 'Solo tackles', get: g => g.raw['defensive.SOLO'] ?? g.raw['defense.SOLO'] },
    { k: 'sck', l: 'Sacks', dec: 1, get: g => g.raw['defensive.SACK'] ?? g.raw['defense.SACK'] }, { k: 'dint', l: 'Interceptions', get: g => g.raw['defensive.INT'] ?? g.raw['interceptions.INT'] },
  ],
  nhl: [
    { k: 'goals', l: 'Goals', get: g => rsH(g, 'G', 'goals') }, { k: 'ast', l: 'Assists', get: g => rsH(g, 'A', 'assists') },
    { k: 'pts', l: 'Points', get: g => rsH(g, 'PTS', 'points') ?? ((rsH(g, 'G') ?? null) == null ? null : rsH(g, 'G') + (rsH(g, 'A') || 0)) },
    { k: 'sog', l: 'Shots on goal', get: g => rsH(g, 'S', 'SOG', 'shotsTotal') },
    { k: 'ppp', l: 'Power-play points', get: g => rsH(g, 'PPP') ?? (rsH(g, 'PPG') == null && rsH(g, 'PPA') == null ? null : (rsH(g, 'PPG') || 0) + (rsH(g, 'PPA') || 0)) },
    { k: 'ppg', l: 'Power-play goals', get: g => rsH(g, 'PPG') }, { k: 'pm', l: 'Plus/minus', neg: 1, get: g => rsH(g, '+/-', 'plusMinus') },
    { k: 'pim', l: 'Penalty minutes', get: g => rsH(g, 'PIM') }, { k: 'toi', l: 'Time on ice (minutes)', dec: 1, step: 1, get: g => rsH(g, 'TOI/G', 'TOI') },
    { k: 'hits', l: 'Hits', deep: 1, get: g => g.deep?.hits }, { k: 'blk', l: 'Blocked shots', deep: 1, get: g => g.deep?.blockedShots },
    { k: 'sogblk', l: 'Shots + blocked shots', deep: 1, get: g => rsH(g, 'S', 'SOG') == null || g.deep?.blockedShots == null ? null : rsH(g, 'S', 'SOG') + g.deep.blockedShots },
    { k: 'fow', l: 'Faceoffs won', deep: 1, get: g => g.deep?.faceoffsWon }, { k: 'tk', l: 'Takeaways', deep: 1, get: g => g.deep?.takeaways },
    { k: 'gv', l: 'Giveaways', deep: 1, get: g => g.deep?.giveaways },
    { k: 'g1', l: 'Anytime goal', yes: 1, get: g => rsH(g, 'G') == null ? null : +(rsH(g, 'G') > 0) },
    { k: 'fs', l: 'Fantasy score', dec: 1, get: g => rsH(g, 'G') == null ? null : rsW([[rsH(g, 'G'), 8], [rsH(g, 'A'), 5], [rsH(g, 'S', 'SOG'), 1.5], [g.deep?.blockedShots, 1.5]]) },
    { k: 'sv', l: 'Saves', gk: 1, get: g => rsH(g, 'SV', 'SVS', 'saves') ?? (rsH(g, 'SA') != null && rsH(g, 'GA') != null ? rsH(g, 'SA') - rsH(g, 'GA') : null) },
    { k: 'ga', l: 'Goals allowed', gk: 1, get: g => rsH(g, 'GA') }, { k: 'sa', l: 'Shots against', gk: 1, get: g => rsH(g, 'SA') },
    { k: 'svp', l: 'Save %', gk: 1, dec: 3, step: .01, get: g => { const v = rsH(g, 'SV%'); return v == null ? null : v > 1 ? v / 100 : v } },
    { k: 'so', l: 'Shutout', gk: 1, yes: 1, get: g => rsH(g, 'GA') == null ? null : +(rsH(g, 'GA') === 0) }],
  tennis: [
    { k: 'tg', l: 'Total games', get: g => g.raw.tg }, { k: 'gw', l: 'Games won', get: g => g.raw.gw }, { k: 'gl', l: 'Games lost', get: g => g.raw.gl },
    { k: 'gm', l: 'Game margin (handicap)', neg: 1, get: g => g.raw.gw == null ? null : g.raw.gw - g.raw.gl },
    { k: 'ts', l: 'Total sets', get: g => g.raw.ts }, { k: 'sw', l: 'Sets won', get: g => g.raw.sw }, { k: 'win', l: 'Win', yes: 1, get: g => g.raw.win },
    { k: 's1g', l: '1st-set total games', get: g => g.raw.s1g }, { k: 's1w', l: '1st-set games won', get: g => g.raw.s1w }, { k: 's1win', l: 'Won the 1st set', yes: 1, get: g => g.raw.s1win },
    { k: 'tb', l: 'Tiebreaks played', get: g => g.raw.tb }, { k: 'tb1', l: 'At least one tiebreak', yes: 1, get: g => g.raw.tb == null ? null : +(g.raw.tb > 0) },
    { k: 'aces', l: 'Aces', deep: 1, get: g => g.deep?.aces }, { k: 'df', l: 'Double faults', deep: 1, get: g => g.deep?.df },
    { k: 'bpw', l: 'Break points won', deep: 1, get: g => g.deep?.bpConv }, { k: 'bpf', l: 'Break points faced', deep: 1, get: g => g.deep?.bpFaced },
    { k: 'p1', l: '1st serve %', deep: 1, dec: 1, step: 1, get: g => g.deep?.first }, { k: 'sp', l: 'Service points won', deep: 1, get: g => g.deep?.svPts },
    { k: 'rp', l: 'Return points won', deep: 1, get: g => g.deep?.retPts }, { k: 'tp', l: 'Total points won', deep: 1, get: g => g.deep?.totPts },
    { k: 'fs', l: 'Fantasy score', dec: 1, get: g => g.raw.gw == null ? null : rsW([[g.raw.gw, 1], [g.raw.gl, -1], [g.raw.sw, 3], [g.raw.ts - g.raw.sw, -3], [g.raw.win, 6], [g.deep?.aces, .5], [g.deep?.df, -.5]]) }],
  mlb: [
    { k: 'h', l: 'Hits', get: g => g.raw.hits }, { k: 'tb', l: 'Total bases', get: g => g.raw.totalBases }, { k: 'hr', l: 'Home runs', get: g => g.raw.homeRuns },
    { k: 'rbi', l: 'RBIs', get: g => g.raw.rbi }, { k: 'r', l: 'Runs', get: g => g.raw.runs }, { k: 'hrr', l: 'Hits + runs + RBIs', get: g => rsSum(g.raw.hits, g.raw.runs, g.raw.rbi) },
    { k: '1b', l: 'Singles', get: g => g.raw.hits == null ? null : g.raw.hits - (g.raw.doubles || 0) - (g.raw.triples || 0) - (g.raw.homeRuns || 0) },
    { k: '2b', l: 'Doubles', get: g => g.raw.doubles }, { k: '3b', l: 'Triples', get: g => g.raw.triples },
    { k: 'bb', l: 'Walks', get: g => g.raw.baseOnBalls }, { k: 'so', l: 'Hitter strikeouts', get: g => g.raw.strikeOuts }, { k: 'sb', l: 'Stolen bases', get: g => g.raw.stolenBases },
    { k: 'hfs', l: 'Hitter fantasy score', get: g => g.raw.hits == null ? null : rsW([[g.raw.hits - (g.raw.doubles || 0) - (g.raw.triples || 0) - (g.raw.homeRuns || 0), 3], [g.raw.doubles, 5], [g.raw.triples, 8],
      [g.raw.homeRuns, 10], [g.raw.runs, 2], [g.raw.rbi, 2], [g.raw.baseOnBalls, 2], [g.raw.hitByPitch, 2], [g.raw.stolenBases, 5]]) },
    { k: 'pk', l: 'Pitcher strikeouts', get: g => g.raw.p_strikeOuts }, { k: 'pout', l: 'Pitching outs', get: g => g.raw.p_outs ?? rsOut(g.raw.p_inningsPitched) },
    { k: 'pha', l: 'Hits allowed', get: g => g.raw.p_hits }, { k: 'per', l: 'Earned runs allowed', get: g => g.raw.p_earnedRuns },
    { k: 'pbb', l: 'Walks allowed', get: g => g.raw.p_baseOnBalls }, { k: 'pc', l: 'Pitches thrown', get: g => g.raw.p_numberOfPitches ?? g.raw.p_pitchesThrown },
    { k: 'pfs', l: 'Pitcher fantasy score', get: g => g.raw.p_strikeOuts == null ? null : (() => { const outs = g.raw.p_outs ?? rsOut(g.raw.p_inningsPitched) ?? 0, er = g.raw.p_earnedRuns || 0;
      return (g.raw.p_wins || 0) * 6 + (outs >= 18 && er <= 3 ? 4 : 0) - er * 3 + g.raw.p_strikeOuts * 3 + outs })() },
  ],
};
const rsStatDef = (sport, k) => RS_STATS[sport].find(s => s.k === k);
// team research: the same screen, a team's games instead of a player's. deep = needs that game's box score
const rsQ = (g, n, o) => { const q = (o ? g.deep?.o : g.deep)?.q; return q && q.length >= n ? q.slice(0, n).reduce((a, b) => a + (b || 0), 0) : null };
const RS_TEAM_BASE = (pts, sport) => [
  { k: 'pf', l: `${pts} scored`, get: g => g.raw.pf }, { k: 'pa', l: `${pts} allowed`, get: g => g.raw.pa },
  { k: 'tot', l: `Total ${pts.toLowerCase()} (both teams)`, get: g => rsSum(g.raw.pf, g.raw.pa) },
  { k: 'margin', l: sport === 'soccer' ? 'Goal margin (handicap)' : sport === 'mlb' ? 'Run margin (run line)' : 'Winning margin (spread)', neg: 1, get: g => g.raw.pf == null || g.raw.pa == null ? null : g.raw.pf - g.raw.pa },
  { k: 'win', l: 'Win', yes: 1, get: g => g.raw.pf == null || g.raw.pa == null ? null : +(g.raw.pf > g.raw.pa) }];
const RS_TEAM = {
  soccer: [...RS_TEAM_BASE('Goals', 'soccer'),
    { k: 'btts', l: 'Both teams score', yes: 1, get: g => g.raw.pf == null ? null : +(g.raw.pf > 0 && g.raw.pa > 0) }, { k: 'cs', l: 'Clean sheet', yes: 1, get: g => g.raw.pa == null ? null : +(g.raw.pa === 0) },
    { k: 'shots', l: 'Shots', deep: 1, get: g => g.deep?.total_shots }, { k: 'sot', l: 'Shots on target', deep: 1, get: g => g.deep?.ShotsOnTarget },
    { k: 'shotsA', l: 'Shots allowed', deep: 1, get: g => g.deep?.o?.total_shots }, { k: 'corners', l: 'Corners', deep: 1, get: g => g.deep?.corners },
    { k: 'tcorners', l: 'Total corners (both teams)', deep: 1, get: g => g.deep ? rsSum(g.deep.corners, g.deep.o?.corners) : undefined },
    { k: 'xg', l: 'xG', deep: 1, dec: 2, step: .1, get: g => g.deep?.expected_goals }, { k: 'xga', l: 'xG allowed', deep: 1, dec: 2, step: .1, get: g => g.deep?.o?.expected_goals },
    { k: 'poss', l: 'Possession %', deep: 1, step: 1, get: g => g.deep?.BallPossesion }, { k: 'fouls', l: 'Fouls', deep: 1, get: g => g.deep?.fouls },
    { k: 'cards', l: 'Yellow cards', deep: 1, get: g => g.deep?.yellow_cards }],
  nfl: [...RS_TEAM_BASE('Points', 'nfl'),
    { k: 'yds', l: 'Total yards', deep: 1, get: g => g.deep?.totalYards }, { k: 'ryd', l: 'Rushing yards', deep: 1, get: g => g.deep?.rushingYards },
    { k: 'pyd', l: 'Passing yards', deep: 1, get: g => g.deep?.netPassingYards }, { k: 'ydsA', l: 'Total yards allowed', deep: 1, get: g => g.deep?.o?.totalYards },
    { k: 'rydA', l: 'Rushing yards allowed', deep: 1, get: g => g.deep?.o?.rushingYards }, { k: 'pydA', l: 'Passing yards allowed', deep: 1, get: g => g.deep?.o?.netPassingYards },
    { k: 'fd', l: 'First downs', deep: 1, get: g => g.deep?.firstDowns }, { k: 'to', l: 'Turnovers', deep: 1, get: g => g.deep?.turnovers },
    { k: 'tak', l: 'Takeaways', deep: 1, get: g => g.deep?.o?.turnovers }, { k: 'sacks', l: 'Sacks (by the defense)', deep: 1, get: g => g.deep?.o?.sacks },
    { k: 'q1', l: '1st-quarter points', deep: 1, get: g => rsQ(g, 1) }, { k: 'h1', l: '1st-half points', deep: 1, get: g => rsQ(g, 2) },
    { k: 'h1t', l: '1st-half total (both teams)', deep: 1, get: g => rsSum(rsQ(g, 2), rsQ(g, 2, 1)) }],
  nba: [...RS_TEAM_BASE('Points', 'nba'),
    { k: 'reb', l: 'Rebounds', deep: 1, get: g => g.deep?.totalRebounds }, { k: 'ast', l: 'Assists', deep: 1, get: g => g.deep?.assists },
    { k: '3pm', l: '3-pointers made', deep: 1, get: g => g.deep?.threePointFieldGoalsMade }, { k: '3pa', l: '3-pointers attempted', deep: 1, get: g => g.deep?.threePointFieldGoalsAttempted },
    { k: 'fgm', l: 'Field goals made', deep: 1, get: g => g.deep?.fieldGoalsMade }, { k: 'fga', l: 'Field goals attempted', deep: 1, get: g => g.deep?.fieldGoalsAttempted },
    { k: 'ftm', l: 'Free throws made', deep: 1, get: g => g.deep?.freeThrowsMade }, { k: 'to', l: 'Turnovers', deep: 1, get: g => g.deep?.turnovers ?? g.deep?.totalTurnovers },
    { k: 'stl', l: 'Steals', deep: 1, get: g => g.deep?.steals }, { k: 'blk', l: 'Blocks', deep: 1, get: g => g.deep?.blocks },
    { k: 'paint', l: 'Points in the paint', deep: 1, get: g => g.deep?.pointsInPaint }, { k: 'fbp', l: 'Fast-break points', deep: 1, get: g => g.deep?.fastBreakPoints },
    { k: 'q1', l: '1st-quarter points', deep: 1, get: g => rsQ(g, 1) }, { k: 'h1', l: '1st-half points', deep: 1, get: g => rsQ(g, 2) },
    { k: 'q1t', l: '1st-quarter total (both teams)', deep: 1, get: g => rsSum(rsQ(g, 1), rsQ(g, 1, 1)) }, { k: 'h1t', l: '1st-half total (both teams)', deep: 1, get: g => rsSum(rsQ(g, 2), rsQ(g, 2, 1)) }],
  nhl: [...RS_TEAM_BASE('Goals', 'nhl'),
    { k: 'shots', l: 'Shots on goal', deep: 1, get: g => g.deep?.shotsTotal ?? g.deep?.shots }, { k: 'shotsA', l: 'Shots allowed', deep: 1, get: g => g.deep?.o?.shotsTotal ?? g.deep?.o?.shots },
    { k: 'ppg', l: 'Power-play goals', deep: 1, get: g => g.deep?.powerPlayGoals }, { k: 'hits', l: 'Hits', deep: 1, get: g => g.deep?.hits },
    { k: 'blk', l: 'Blocked shots', deep: 1, get: g => g.deep?.blockedShots }, { k: 'pim', l: 'Penalty minutes', deep: 1, get: g => g.deep?.penaltyMinutes },
    { k: 'fow', l: 'Faceoffs won', deep: 1, get: g => g.deep?.faceoffsWon },
    { k: 'q1', l: '1st-period goals', deep: 1, get: g => rsQ(g, 1) }, { k: 'q1t', l: '1st-period total (both teams)', deep: 1, get: g => rsSum(rsQ(g, 1), rsQ(g, 1, 1)) },
    { k: 'ot', l: 'Went to overtime', yes: 1, deep: 1, get: g => g.deep?.q ? +(g.deep.q.length > 3) : null }],
  mlb: [...RS_TEAM_BASE('Runs', 'mlb'),
    { k: 'hits', l: 'Hits', get: g => g.raw.hits }, { k: 'hitsA', l: 'Hits allowed', get: g => g.raw.hitsA }, { k: 'err', l: 'Errors', get: g => g.raw.errors },
    { k: 'f5', l: 'First 5 innings runs', get: g => g.raw.f5 }, { k: 'f5t', l: 'First 5 innings total (both teams)', get: g => rsSum(g.raw.f5, g.raw.f5a) },
    { k: 'yrfi', l: 'Run in the 1st inning (YRFI)', yes: 1, get: g => g.raw.first == null ? null : +(g.raw.first > 0) }],
};
const rsDef = (p, k) => (p?.kind === 'team' ? RS_TEAM[p.sport] : RS_STATS[p?.sport] || []).find(s => s.k === k);
// stats this player actually has numbers for (a goalkeeper gets saves, a QB passing, a pitcher pitching)
function rsStatsFor(p){
  if (!p?.games) return [];
  if (p.kind === 'team') return RS_TEAM[p.sport].filter(s => s.deep && !p.fs || p.games.some(g => s.get(g) != null));
  if (p.fs) return RS_STATS.nba.filter(s => (s.deep ? p.games.some(g => g.deep?.[s.k] != null) : p.games.some(g => s.get(g) != null)));
  if (p.sport === 'soccer') return RS_STATS.soccer.filter(s => p.gk ? !['goals', 'assists', 'ga', 'shots', 'sot', 'xg', 'xa', 'chances', 'dribbles', 'dribblesA', 'offsides', 'crosses'].includes(s.k) : !s.gk);
  if (p.sport === 'nba') return RS_STATS.nba;
  if (p.sport === 'tennis') return RS_STATS.tennis.filter(s => s.deep || p.games.some(g => s.get(g) != null));
  if (p.sport === 'nhl') { const gk = p.games.some(g => rsH(g, 'SA', 'SV%') != null); return RS_STATS.nhl.filter(s => gk ? s.gk : !s.gk && (s.deep || p.games.some(g => s.get(g) != null))) }
  return RS_STATS[p.sport].filter(s => p.games.some(g => { const v = s.get(g); return v != null && v !== 0 }));
}
// names PrizePicks, Sleeper and the books use for a stat -> our key
const RS_ALIAS = {
  soccer: { shots: 'shots', shotsontarget: 'sot', sot: 'sot', goals: 'goals', anytimegoal: 'goals', goal: 'goals', assists: 'assists', goalassist: 'ga', goalsassists: 'ga',
    passesattempted: 'passes', passes: 'passes', shotsassisted: 'chances', keypasses: 'chances', tackles: 'tackles', clearances: 'clear', interceptions: 'int',
    foulscommitted: 'fouls', fouls: 'fouls', crosses: 'crosses', attempteddribbles: 'dribblesA', dribbles: 'dribblesA', goaliesaves: 'saves', saves: 'saves', goalsallowed: 'conceded', offsides: 'offsides' },
  nba: { points: 'pts', pts: 'pts', rebounds: 'reb', reb: 'reb', assists: 'ast', ast: 'ast', ptsrebsasts: 'pra', ptsrebast: 'pra', pra: 'pra', pointsreboundsassists: 'pra',
    ptsrebs: 'pr', ptsreb: 'pr', pr: 'pr', pointsrebounds: 'pr', ptsasts: 'pa', ptsast: 'pa', pa: 'pa', pointsassists: 'pa', rebsasts: 'ra', rebast: 'ra', ra: 'ra', reboundsassists: 'ra',
    fantasyscore: 'fs', '3ptmade': '3pm', threesmade: '3pm', threes: '3pm', '3pointersmade': '3pm', threepointersmade: '3pm', '3ptattempted': '3pa', threepointersattempted: '3pa', threesattempted: '3pa',
    twopointersmade: '2pm', twopointersattempted: '2pa', fgmade: 'fgm', fieldgoalsmade: 'fgm', fgattempted: 'fga', fieldgoalsattempted: 'fga', freethrowsmade: 'ftm', freethrowsattempted: 'fta',
    steals: 'stl', blockedshots: 'blk', blocks: 'blk', blksstls: 'stocks', blkstl: 'stocks', blockssteals: 'stocks', stealsblocks: 'stocks', turnovers: 'to',
    offensiverebounds: 'oreb', defensiverebounds: 'dreb', dunks: 'dunks', doubledouble: 'dd', doubledoubles: 'dd', tripledouble: 'td3', personalfouls: 'pf', minutes: 'min' },
  nfl: { passyards: 'pyd', passingyards: 'pyd', passyds: 'pyd', passtds: 'ptd', passingtds: 'ptd', passingtouchdowns: 'ptd', passcompletions: 'pcmp', completions: 'pcmp', passattempts: 'patt', passingattempts: 'patt',
    int: 'pint', intsthrown: 'pint', interceptionsthrown: 'pint', interceptions: 'pint', rushyards: 'ryd', rushingyards: 'ryd', rushattempts: 'ratt', rushingattempts: 'ratt', longestrush: 'rlng',
    receptions: 'rec', receivingyards: 'reyd', recyards: 'reyd', rectargets: 'tgt', targets: 'tgt', longestreception: 'relng', rushrecyds: 'rryd', rushrecyards: 'rryd', rushingreceivingyards: 'rryd', rushingandreceivingyards: 'rryd',
    passrushyds: 'pryd', passrushyards: 'pryd', rushrectds: 'td', anytimetd: 'td', anytimetouchdown: 'td', fantasyscore: 'fs', kickingpoints: 'kpts', fgmade: 'fgm', fieldgoalsmade: 'fgm',
    tacklesast: 'tkl', tacklesassists: 'tkl', tackles: 'tkl', sacks: 'sck', solotackles: 'solo', yardspercarry: 'ypc', passerrating: 'rtg' },
  nhl: { goals: 'goals', anytimegoal: 'g1', anytimegoalscorer: 'g1', assists: 'ast', points: 'pts', shotsongoal: 'sog', shots: 'sog', sog: 'sog', powerplaypoints: 'ppp', powerplaygoals: 'ppg',
    plusminus: 'pm', penaltyminutes: 'pim', timeonice: 'toi', hits: 'hits', blockedshots: 'blk', blocks: 'blk', faceoffswon: 'fow', fantasyscore: 'fs', goaliesaves: 'sv', saves: 'sv',
    goalsallowed: 'ga', goalsagainst: 'ga', shutout: 'so', shotsblocks: 'sogblk' },
  tennis: { totalgames: 'tg', games: 'tg', totalgameswon: 'gw', gameswon: 'gw', gameslost: 'gl', aces: 'aces', doublefaults: 'df', breakpointswon: 'bpw', totalsets: 'ts', setswon: 'sw',
    '1stsetgames': 's1g', firstsetgames: 's1g', '1stsettotalgames': 's1g', '1stsetgameswon': 's1w', tiebreaks: 'tb', fantasyscore: 'fs' },
  mlb: { hits: 'h', totalbases: 'tb', homeruns: 'hr', rbis: 'rbi', rbi: 'rbi', runs: 'r', hitsrunsrbis: 'hrr', hrr: 'hrr', singles: '1b', doubles: '2b', triples: '3b', walks: 'bb', hitterstrikeouts: 'so',
    stolenbases: 'sb', hitterfantasyscore: 'hfs', pitcherstrikeouts: 'pk', strikeouts: 'pk', pitchingouts: 'pout', outs: 'pout', outsrecorded: 'pout', hitsallowed: 'pha', earnedrunsallowed: 'per', earnedruns: 'per',
    walksallowed: 'pbb', pitchesthrown: 'pc', pitchcount: 'pc', pitcherfantasyscore: 'pfs' },
};
const rsStatKey = (sport, label) => RS_ALIAS[sport]?.[String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '')] || null;

/* ---------- seasons ---------- */
const rsSeasonStart = sport => { const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  if (sport === 'soccer') return new Date(m >= 6 ? y : y - 1, 6, 1);
  if (sport === 'nba' || sport === 'nhl') return new Date(m >= 8 ? y : y - 1, 8, 1);
  if (sport === 'nfl') return new Date(m >= 2 ? y : y - 1, 2, 1);
  return new Date(y, 0, 1) };
function rsSeasonOf(sport, d){
  const y = d.getFullYear(), m = d.getMonth(), two = n => String(n % 100).padStart(2, '0');
  if (sport === 'soccer') return m >= 6 ? `${y}/${two(y + 1)}` : `${y - 1}/${two(y)}`;
  if (sport === 'nba' || sport === 'nhl') return m >= 8 ? `${y}-${two(y + 1)}` : `${y - 1}-${two(y)}`;
  if (sport === 'nfl') return String(m >= 2 ? y : y - 1);
  return String(y);
}
const rsCurSeason = sport => { const y = new Date().getFullYear(), m = new Date().getMonth(); return sport === 'nfl' ? (m >= 2 ? y : y - 1) : sport === 'nba' || sport === 'nhl' ? (m >= 8 ? y + 1 : y) : y };
function rsResult(us, them){ return us == null || them == null ? '' : us > them ? 'W' : us < them ? 'L' : 'D' }
function rsAddGames(p, games){
  const have = new Set(p.games.map(g => g.id));
  for (const g of games) if (!have.has(g.id)) { g.season = rsSeasonOf(p.sport, g.date); p.games.push(g); have.add(g.id) }
  p.games.sort((a, b) => b.date - a.date);
}

/* ---------- loading a player ---------- */
// soccer: FotMob's last ~70 matches for goals, assists, cards, minutes and rating, plus career totals by season
async function rsLoadSoccer(o){
  const q = o.fmId ? `id=${o.fmId}` : `name=${encodeURIComponent(o.name)}&club=${encodeURIComponent(o.team || '')}`;
  const d = await getJSON(`/api/fm/player?${q}`);
  if (!d || d.error) throw new Error(d?.error || 'not found');
  const games = (d.recent || []).filter(m => m.played !== false && !(m.bench && !m.minutes)).map(m => {
    const [hs, as] = m.score || [], us = m.home ? hs : as, them = m.home ? as : hs;
    return { id: String(m.id), date: new Date(m.utc), opp: m.opponent, oppId: String(m.opponentId || ''), oppLogo: m.opponentId ? `${FM_IMGS}/logo/teamlogo/${m.opponentId}.png` : '',
      home: !!m.home, comp: m.league || '', res: rsResult(us, them), score: hs != null ? `${us}–${them}` : '', min: m.minutes ?? null, team: m.team,
      raw: { goals: m.goals || 0, assists: m.assists || 0, yellow: m.yellow || 0, red: m.red || 0, rating: rsNum(m.rating) } };
  }).filter(g => g.min == null || g.min > 0);
  const p = { sport: 'soccer', key: 'soccer:' + d.id, id: String(d.id), name: d.name, team: d.team?.name || '', teamId: d.team?.id, photo: d.photo, crest: d.team?.crest,
    pos: d.primaryPosition || d.positions?.find(x => x.main)?.label || '', gk: !!d.isGoalkeeper, games: [], career: d.career?.senior?.seasons || [], natCareer: Object.entries(d.career || {}).find(([k]) => /national/i.test(k))?.[1]?.seasons || [] };
  rsAddGames(p, games);
  return p;
}
// FotMob per-match player stats (shots, passes, tackles...); one request serves every player in that match
const rsMatch = new Map();
function rsMatchStats(mid){
  if (!rsMatch.has(mid)) rsMatch.set(mid, getJSON(`/api/fm/matchstats?id=${mid}`).then(d => {
    const out = {};
    for (const p of d.players || []) { const f = {}; for (const grp of Object.values(p.stats || {})) for (const [k, v] of Object.entries(grp)) { if (Array.isArray(v)) { f[k] = rsNum(v[0]); f[k + '_total'] = rsNum(v[1]) } else f[k] = rsNum(v) } f._team = String(p.teamId ?? ''); out[String(p.id)] = f }
    return out }).catch(err => { rsMatch.delete(mid); throw err }));
  return rsMatch.get(mid);
}
// ESPN NBA box score + play-by-play: offensive / defensive rebounds and made dunks for everyone in the game
const rsBox = new Map();
function rsNbaBox(eid, lg){
  const k = lg + eid;
  if (!rsBox.has(k)) rsBox.set(k, cj(`https://site.api.espn.com/apis/site/v2/sports/basketball/${lg}/summary?event=${eid}`).then(d => {
    const out = {};
    for (const t of d.boxscore?.players || []) for (const st of t.statistics || []) {
      const keys = st.keys || st.names || [], labels = st.labels || [];
      const at = (key, lab) => { const i = keys.findIndex(x => x === key); return i >= 0 ? i : labels.indexOf(lab) };
      const iO = at('offensiveRebounds', 'OREB'), iD = at('defensiveRebounds', 'DREB');
      for (const a of st.athletes || []) { if (!a.athlete?.id || !a.stats?.length) continue; out[a.athlete.id] = { oreb: iO >= 0 ? rsNum(a.stats[iO]) : null, dreb: iD >= 0 ? rsNum(a.stats[iD]) : null, dunks: d.plays ? 0 : null } }
    }
    for (const pl of d.plays || []) {
      if (!pl.scoringPlay || !/dunk/i.test(pl.type?.text || pl.text || '')) continue;
      const id = pl.participants?.[0]?.athlete?.id; if (id && out[id]) out[id].dunks++;
    }
    return out }).catch(err => { rsBox.delete(k); throw err }));
  return rsBox.get(k);
}
// ESPN NFL play-by-play: each passer's longest run of completions without a miss (sacks and spikes aside)
const rsNfl = new Map();
function rsNflPlays(eid, lg){
  const k = lg + eid;
  if (!rsNfl.has(k)) rsNfl.set(k, cj(`https://site.api.espn.com/apis/site/v2/sports/football/${lg}/summary?event=${eid}`).then(d => {
    const cur = {}, best = {};
    for (const pl of (d.drives?.previous || []).flatMap(dr => dr.plays || [])) {
      const t = pl.type?.text || '', id = (pl.participants || []).find(x => x.type === 'passer')?.athlete?.id; if (!id) continue;
      if (/pass(ing)? (reception|touchdown|completion)/i.test(t)) { cur[id] = (cur[id] || 0) + 1; best[id] = Math.max(best[id] || 0, cur[id]) }
      else if (/incompletion|interception/i.test(t)) { cur[id] = 0; best[id] ??= 0 }
    }
    return Object.fromEntries(Object.entries(best).map(([id, n]) => [id, { streak: n }])) }).catch(err => { rsNfl.delete(k); throw err }));
  return rsNfl.get(k);
}
// a team's box-score numbers for one game, and the opponent's under .o
const rsTB = new Map();
function rsTeamBox(p, g){
  const k = p.sport + g.id;
  if (!rsTB.has(k)) rsTB.set(k, (p.sport === 'soccer' ? getJSON(`/api/fm/match?id=${g.id}`).then(d => {
      const side = {}; for (const [i, t] of (d.teams || []).entries()) side[String(t.id)] = i ? 'away' : 'home';
      const f = { home: {}, away: {} };
      for (const grp of d.stats || []) for (const row of grp.rows || []) for (const sd of ['home', 'away']) if (row.key && f[sd][row.key] === undefined) f[sd][row.key] = rsNum(row[sd]);
      return Object.fromEntries(Object.entries(side).map(([id, sd]) => [id, f[sd]])) })
    : cj(`https://site.api.espn.com/apis/site/v2/sports/${p.path}/summary?event=${g.id}`).then(d => {
      const out = {};
      for (const t of d.boxscore?.teams || []) { const f = {};
        for (const x of t.statistics || []) { const v = String(x.displayValue ?? ''), names = String(x.name || '').split('-');
          if (/^\d+-\d+$/.test(v) && names.length === 2) { const [a, b] = v.split('-').map(Number); f[names[0]] = a; f[names[1]] = b } else f[x.name] = rsNum(v) }
        if (f.sacksYardsLost == null && /^\d+-\d+$/.test(String((t.statistics || []).find(x => x.name === 'sacksYardsLost')?.displayValue))) f.sacks = +String(t.statistics.find(x => x.name === 'sacksYardsLost').displayValue).split('-')[0];
        if (f.sacks == null && f.sacksYardsLost != null) f.sacks = f.sacksYardsLost;
        out[String(t.team?.id)] = f }
      for (const c of d.header?.competitions?.[0]?.competitors || []) { const f = out[String(c.id)] ||= {}; f.q = (c.linescores || []).map(x => rsNum(x.displayValue ?? x.value)) }
      return out })).catch(err => { rsTB.delete(k); throw err }));
  return rsTB.get(k).then(m => { const mine = m[String(p.id)]; if (!mine) return null; const o = Object.entries(m).find(([id]) => id !== String(p.id))?.[1]; return { ...mine, o } });
}
const RS_NHL_LAB = { BS: 'blockedShots', HT: 'hits', TK: 'takeaways', GV: 'giveaways', FW: 'faceoffsWon', FL: 'faceoffsLost', SHFT: 'shifts' };
const rsNhl = new Map();
function rsNhlBox(eid, lg){
  const k = lg + eid;
  if (!rsNhl.has(k)) rsNhl.set(k, cj(`https://site.api.espn.com/apis/site/v2/sports/hockey/${lg}/summary?event=${eid}`).then(d => {
    const out = {};
    for (const t of d.boxscore?.players || []) for (const st of t.statistics || []) {
      const keys = st.keys || st.names || [], labels = st.labels || [];
      for (const a of st.athletes || []) { if (!a.athlete?.id || !a.stats?.length) continue; const f = out[a.athlete.id] ||= {};
        a.stats.forEach((v, i) => { const key = keys[i] || RS_NHL_LAB[labels[i]] || labels[i]; if (key) f[key] = /^\d+:\d\d$/.test(v) ? (([x, y]) => +x + +y / 60)(v.split(':')) : rsNum(v);
          const alt = RS_NHL_LAB[labels[i]]; if (alt && f[alt] == null) f[alt] = f[key] }) }
    }
    return out }).catch(err => { rsNhl.delete(k); throw err }));
  return rsNhl.get(k);
}
// fill g.deep for the newest `limit` games, a few at a time
async function rsLoadDeep(p, limit, onStep){
  const todo = p.games.slice(0, limit).filter(g => g.deep === undefined); let i = 0;
  const one = p.sport === 'tennis' ? g => rsTnMatch(g) : p.kind === 'team' ? g => rsTeamBox(p, g) : p.sport === 'soccer' ? g => rsMatchStats(g.id).then(m => m[p.id] || null)
    : p.sport === 'nfl' ? g => rsNflPlays(g.id, p.lg || 'nfl').then(m => m[p.id] || null) : p.sport === 'nhl' ? g => rsNhlBox(g.id, p.lg || 'nhl').then(m => m[p.id] || null)
    : g => rsNbaBox(g.id, p.lg || 'nba').then(m => m[p.id] || null);
  const worker = async () => { while (i < todo.length) { const g = todo[i++]; try { g.deep = await one(g) } catch { g.deep = null } onStep?.() } };
  await Promise.all([worker(), worker(), worker()]);
}

// one ESPN game-log season (NBA, WNBA, NFL)
async function rsEspnSeason(path, id, y){
  const g = await cj(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${id}/gamelog?season=${y}`).catch(() => null);
  if (!g?.seasonTypes) return [];
  const labels = g.labels || [], cats = g.categories || [], out = [];
  const colKey = []; let i = 0;   // "passing.YDS" when the log has several stat groups, else just "PTS"
  if (cats.length > 1) for (const c of cats) for (let n = 0; n < (c.count || 0); n++, i++) colKey[i] = String(c.name || '').toLowerCase() + '.' + labels[i];
  for (const st of g.seasonTypes) {
    const type = /post|playoff/i.test(st.displayName) ? 'Playoffs' : /pre/i.test(st.displayName) ? 'Preseason' : /play-in/i.test(st.displayName) ? 'Play-in' : 'Regular season';
    if (type === 'Preseason') continue;
    for (const c of st.categories || []) for (const x of c.events || []) {
      const m = g.events?.[x.eventId] || {}, raw = {};
      (x.stats || []).forEach((v, j) => {
        const lab = labels[j], k = colKey[j] || lab;
        if (/^\d+[-/]\d+$/.test(v)) {   // "8-17": made and attempted
          const [a, b] = v.split(/[-/]/).map(Number), s = lab === '3PT' ? '3P' : lab;
          raw[s + 'M'] ??= a; raw[s + 'A'] ??= b; if (colKey[j]) { const cat = colKey[j].split('.')[0]; raw[`${cat}.${s}M`] = a; raw[`${cat}.${s}A`] = b }
          return }
        const n = /^\d+:\d\d$/.test(v) ? (([a, b]) => +a + +b / 60)(v.split(':')) : rsNum(v); if (raw[k] === undefined) raw[k] = n; if (raw[lab] === undefined) raw[lab] = n;
      });
      const sc = String(m.score || '').match(/(\d+)\D+(\d+)/);
      out.push({ id: String(x.eventId), date: new Date(m.gameDate), opp: m.opponent?.displayName || m.opponent?.abbreviation || '', oppAbbr: m.opponent?.abbreviation,
        oppId: String(m.opponent?.id || ''), oppLogo: m.opponent?.logo || '', home: m.atVs ? m.atVs !== '@' : null, comp: type, res: m.gameResult || '',
        score: sc ? `${sc[1]}–${sc[2]}` : '', min: raw.MIN ?? (raw['TOI/G'] ?? raw.TOI) ?? null, week: m.week, raw });
    }
  }
  return out.filter(g => !isNaN(g.date));
}
async function rsLoadEspn(o){
  const nfl = o.sport === 'nfl', cur = rsCurSeason(o.sport), lg = o.lg || rsDefLg(o.sport);
  const path = `${RS_ESPN[o.sport]}/${lg}`;
  const [bio, a, b] = await Promise.all([cj(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${o.id}`).catch(() => null), rsEspnSeason(path, o.id, cur), rsEspnSeason(path, o.id, cur - 1)]);
  const at = bio?.athlete;
  if (!at && !a.length && !b.length) throw new Error('not found');
  const p = { sport: o.sport, key: `${o.sport}:${o.id}`, id: String(o.id), lg, path, name: at?.displayName || o.name, team: at?.team?.displayName || o.team || '', teamId: String(at?.team?.id || ''),
    photo: at?.headshot?.href || `https://a.espncdn.com/i/headshots/${nfl ? 'nfl' : o.sport === 'nhl' ? 'nhl' : lg === 'wnba' ? 'wnba' : 'nba'}/players/full/${o.id}.png`, crest: at?.team?.logos?.[0]?.href,
    pos: at?.position?.displayName || '', games: [], from: cur - 1, years: rsNum(at?.experience?.years) };
  rsAddGames(p, [...a, ...b]);
  return p;
}
// MLB StatsAPI game logs, hitting and pitching
const SAPI = 'https://statsapi.mlb.com/api/v1';
async function rsMlbSeason(id, yr, sid = 1){
  const d = await cj(`${SAPI}/people/${id}/stats?stats=gameLog&group=hitting,pitching&season=${yr}&sportId=${sid}`).catch(() => null), games = new Map();
  for (const st of d?.stats || []) {
    const pit = /pitch/i.test(st.group?.displayName || '');
    for (const s of st.splits || []) {
      const k = String(s.game?.gamePk || s.date + s.opponent?.id);
      const g = games.get(k) || { id: k, date: new Date(s.date + 'T12:00:00'), opp: s.opponent?.name || '', oppId: String(s.opponent?.id || ''),
        oppLogo: s.opponent?.id ? `https://www.mlbstatic.com/team-logos/${s.opponent.id}.svg` : '', home: s.isHome, comp: /^[FDLW]$/.test(s.gameType) ? 'Postseason' : 'Regular season',
        res: s.isWin === true ? 'W' : s.isWin === false ? 'L' : '', score: '', min: null, raw: {} };
      for (const [kk, v] of Object.entries(s.stat || {})) { const n = kk === 'inningsPitched' ? v : rsNum(v); if (n != null) g.raw[(pit ? 'p_' : '') + kk] = n }
      games.set(k, g);
    }
  }
  return [...games.values()];
}
async function rsLoadMlb(o){
  const y = new Date().getFullYear();
  let sid = o.sportId || 1;
  let [bio, a, b] = await Promise.all([cj(`${SAPI}/people/${o.id}?hydrate=currentTeam`).catch(() => null), rsMlbSeason(o.id, y, sid), rsMlbSeason(o.id, y - 1, sid)]);
  // a minor leaguer: try AAA, AA, High-A, Single-A
  for (const s of [11, 12, 13, 14]) { if (a.length || b.length) break; [a, b] = await Promise.all([rsMlbSeason(o.id, y, s), rsMlbSeason(o.id, y - 1, s)]); sid = s }
  const pp = bio?.people?.[0];
  if (!pp && !a.length && !b.length) throw new Error('not found');
  const p = { sport: 'mlb', key: 'mlb:' + o.id, id: String(o.id), name: pp?.fullName || o.name, team: pp?.currentTeam?.name || o.team || '', teamId: String(pp?.currentTeam?.id || ''),
    photo: `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${o.id}/headshot/67/current`,
    crest: pp?.currentTeam?.id ? `https://www.mlbstatic.com/team-logos/${pp.currentTeam.id}.svg` : '', pos: pp?.primaryPosition?.name || '',
    games: [], from: y - 1, sportId: sid, debut: sid === 1 && pp?.mlbDebutDate ? +pp.mlbDebutDate.slice(0, 4) : null };
  rsAddGames(p, [...a, ...b]);
  return p;
}
// teams: ESPN schedules (NBA, WNBA, college, NFL), StatsAPI schedules with line scores (MLB), FotMob fixtures (soccer)
async function rsEspnTeamSeason(path, id, y){
  const d = await cj(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${id}/schedule?season=${y}`).catch(() => null);
  return (d?.events || []).filter(ev => ev.competitions?.[0]?.status?.type?.completed).map(ev => {
    const c = ev.competitions[0], cs = c.competitors || [], us = cs.find(x => String(x.id) === String(id)), them = cs.find(x => x !== us); if (!us || !them) return null;
    const sc = x => rsNum(x?.score?.value ?? x?.score?.displayValue ?? x?.score), pf = sc(us), pa = sc(them), ot = them.team || {};
    return { id: String(ev.id), date: new Date(ev.date), opp: ot.displayName || ot.shortDisplayName || '', oppAbbr: ot.abbreviation, oppId: String(ot.id || them.id || ''),
      oppLogo: ot.logos?.[0]?.href || ot.logo || '', home: us.homeAway === 'home', comp: /post/i.test(ev.seasonType?.name || '') ? 'Playoffs' : 'Regular season', res: rsResult(pf, pa),
      score: `${pf}–${pa}`, min: null, week: ev.week?.number, raw: { pf, pa } } }).filter(Boolean);
}
async function rsMlbTeamSeason(id, y, sid = 1){
  const d = await cj(`${SAPI}/schedule?sportId=${sid}&teamId=${id}&season=${y}&gameType=R,F,D,L,W&hydrate=linescore,team`).catch(() => null);
  return (d?.dates || []).flatMap(x => x.games || []).filter(g => g.status?.abstractGameState === 'Final').map(g => {
    const home = String(g.teams.home.team.id) === String(id), me = home ? 'home' : 'away', op = home ? 'away' : 'home', us = g.teams[me], them = g.teams[op], ls = g.linescore || {}, inn = ls.innings || [];
    const first5 = sd => inn.length >= 5 ? inn.slice(0, 5).reduce((a, i) => a + (i[sd]?.runs || 0), 0) : null;
    return { id: String(g.gamePk), date: new Date(g.gameDate), opp: them.team.name, oppAbbr: them.team.abbreviation, oppId: String(them.team.id), oppLogo: `https://www.mlbstatic.com/team-logos/${them.team.id}.svg`,
      home, comp: g.gameType === 'R' ? 'Regular season' : 'Postseason', res: rsResult(us.score, them.score), score: `${us.score}–${them.score}`, min: null,
      raw: { pf: us.score, pa: them.score, hits: ls.teams?.[me]?.hits, hitsA: ls.teams?.[op]?.hits, errors: ls.teams?.[me]?.errors, f5: first5(me), f5a: first5(op),
        first: inn[0] ? (inn[0].home?.runs || 0) + (inn[0].away?.runs || 0) : null } } });
}
async function rsLoadTeam(o){
  const sport = o.sport, base = { sport, kind: 'team', games: [], pos: 'Team' };
  if (o.fsTeam) {
    const d = await getJSON(`/api/bb/team?id=${encodeURIComponent(o.fsTeam)}&slug=${encodeURIComponent(o.tslug || '')}`);
    if (!d || d.error) throw new Error('not found');
    const p = { ...base, sport: 'nba', fs: true, key: 'nba:fsteam' + o.fsTeam, id: 'fst' + o.fsTeam, fsTeam: String(o.fsTeam), name: d.name, team: d.name, photo: d.logo || o.photo || '', pos: 'Flashscore', careerDone: true };
    rsAddGames(p, (d.results || []).map(e => { const home = String(e.home?.id) === String(o.fsTeam), us = home ? e.home : e.away, them = home ? e.away : e.home, pf = rsNum(us?.score), pa = rsNum(them?.score);
      if (pf == null || pa == null) return null;
      return { id: 'fs' + e.id, date: new Date(e.ts * 1000), opp: them.full || them.name, oppId: String(them.id || ''), oppLogo: them.logo || '', home, comp: e.lgName || '', res: rsResult(pf, pa), score: `${pf}–${pa}`, min: null,
        raw: { pf, pa }, deep: { q: (us.lines || []).map(rsNum), o: { q: (them.lines || []).map(rsNum) } } } }).filter(Boolean));
    return p;
  }
  if (sport === 'soccer') {
    const d = await getJSON(`/api/fm/team?${o.fmId || /^\d+$/.test(o.id || '') ? 'id=' + (o.fmId || o.id) + '&' : ''}name=${encodeURIComponent(o.name || '')}`);
    if (!d || d.error) throw new Error('not found');
    const p = { ...base, key: 'soccer:team:' + d.id, id: String(d.id), name: d.name, team: d.name, photo: d.crest, crest: '', careerDone: true };
    rsAddGames(p, (d.fixtures || []).filter(f => f.finished && f.score).map(f => { const home = String(f.home?.id) === String(d.id), them = home ? f.away : f.home, pf = f.score[home ? 0 : 1], pa = f.score[home ? 1 : 0];
      return { id: String(f.id), date: new Date(f.utc), opp: them?.name || '', oppId: String(them?.id || ''), oppLogo: them?.logo || '', home, comp: f.tournament || '', res: rsResult(pf, pa), score: `${pf}–${pa}`, min: null, raw: { pf, pa } } }));
    return p;
  }
  const cur = rsCurSeason(sport);
  if (sport === 'mlb') {
    const [t, a, b] = await Promise.all([cj(`${SAPI}/teams/${o.id}`).catch(() => null), rsMlbTeamSeason(o.id, cur), rsMlbTeamSeason(o.id, cur - 1)]);
    const tm = t?.teams?.[0];
    const p = { ...base, key: 'mlb:team:' + o.id, id: String(o.id), name: tm?.name || o.name, team: tm?.name || o.name, photo: `https://www.mlbstatic.com/team-logos/${o.id}.svg`, from: cur - 1 };
    rsAddGames(p, [...a, ...b]); if (!p.games.length && !tm) throw new Error('not found'); return p;
  }
  const lg = o.lg || rsDefLg(sport), path = `${RS_ESPN[sport]}/${lg}`;
  const [t, a, b] = await Promise.all([cj(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${o.id}`).catch(() => null), rsEspnTeamSeason(path, o.id, cur), rsEspnTeamSeason(path, o.id, cur - 1)]);
  const tm = t?.team;
  const p = { ...base, key: `${sport}:team:${o.id}`, id: String(o.id), lg, path, name: tm?.displayName || o.name, team: tm?.displayName || o.name, photo: tm?.logos?.[0]?.href || o.photo || '',
    pos: tm?.record?.items?.[0]?.summary ? `Record ${tm.record.items[0].summary}` : 'Team', from: cur - 1 };
  rsAddGames(p, [...a, ...b]); if (!p.games.length && !tm) throw new Error('not found'); return p;
}
// Flashscore basketball players (EuroLeague, EuroCup, Spain, Turkey, Israel...): their recent games with box-score lines
const rsFsKey = k => { k = String(k).toLowerCase();
  return /^points?$/.test(k) ? 'PTS' : /offensive-rebound/.test(k) ? 'OREB' : /defensive-rebound/.test(k) ? 'DREB' : /rebound/.test(k) ? 'REB' : /^assists?$/.test(k) ? 'AST'
    : /^steals?$/.test(k) ? 'STL' : /^blocks?$|blocked-shots/.test(k) ? 'BLK' : /turnover/.test(k) ? 'TO' : /minutes/.test(k) ? 'MIN' : /foul/.test(k) ? 'PF'
    : /(3|three)-?point.*made/.test(k) ? '3PM' : /(3|three)-?point.*att/.test(k) ? '3PA' : /(2|two)-?point.*made/.test(k) ? '2PM' : /(2|two)-?point.*att/.test(k) ? '2PA'
    : /field-goals?-made/.test(k) ? 'FGM' : /field-goals?-att/.test(k) ? 'FGA' : /free-throws?-made/.test(k) ? 'FTM' : /free-throws?-att/.test(k) ? 'FTA' : null };
async function rsLoadFs(o){
  const d = await getJSON(`/api/bb/player?id=${encodeURIComponent(o.fsId)}&slug=${encodeURIComponent(o.slug)}`);
  if (!d || d.error) throw new Error('not found');
  const games = (d.last || []).filter(m => !m.absent && m.stats && Object.keys(m.stats).length).map(m => {
    const home = rsSameTeam(m.home, d.teamName), raw = {};
    for (const [k, v] of Object.entries(m.stats)) { const kk = rsFsKey(k); if (!kk) continue; raw[kk] = kk === 'MIN' ? (([a, b]) => +a + (+b || 0) / 60)(String(v).split(':')) : rsNum(v) }
    if (raw.FGM == null && raw['2PM'] != null) { raw.FGM = raw['2PM'] + (raw['3PM'] || 0); raw.FGA = (raw['2PA'] || 0) + (raw['3PA'] || 0) }
    const hs = rsNum(m.hs), as = rsNum(m.as), pf = home ? hs : as, pa = home ? as : hs, date = new Date(typeof m.date === 'number' ? m.date * 1000 : m.date);
    return { id: 'fs' + m.id, date, opp: home ? m.away : m.home, oppLogo: home ? m.alogo : m.hlogo, home, comp: m.lg || '', res: rsResult(pf, pa), score: hs != null ? `${pf}–${pa}` : '',
      min: raw.MIN != null ? Math.round(raw.MIN) : null, raw, deep: { oreb: raw.OREB ?? null, dreb: raw.DREB ?? null, dunks: null } } });
  const p = { sport: 'nba', fs: true, key: 'nba:fs' + o.fsId, id: 'fs' + o.fsId, fsId: String(o.fsId), fsTeam: d.teamId ? { id: d.teamId, slug: d.teamSlug } : null, lg: 'fs', name: d.name, team: d.teamName || '', photo: d.photo || '', pos: [d.position, 'Flashscore'].filter(Boolean).join(' · '), games: [] };
  rsAddGames(p, games);
  return p;
}
// run fn over items, n at a time
async function rsPool(items, n, fn){
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x) } catch {} } }));
}
// FotMob's player page lists only the latest matches. Every other match comes from the match pages: this season from
// the team's fixtures (all competitions), then every competition of every season of the career, most important first:
// Champions League, the league, other European cups, national team, then domestic cups and the rest
const rsCompTier = (c, nat, main) => { const n = String(c.league || '').toLowerCase(), id = +c.leagueId;
  if (nat) return 3;
  if (id === 42 || /^(uefa )?champions league$/.test(n)) return 0;
  if (c === main) return 1;
  if (id === 73 || id === 10216 || /^(uefa )?(europa|europa conference|conference) league$|uefa super cup|club world cup/.test(n)) return 2;
  return 4 };
const RS_TIER = ['Champions League', 'league', 'European cups', 'national team', 'cups and other competitions'];
async function rsSoccerFill(p, onStep){
  const have = new Set(p.games.map(g => g.id)), live = () => S.rs.open && (S.rs.p === p || S.rs.combo?.some(c => c.p === p));
  let fails = 0;
  const add = (f, tid, comp) => rsMatchStats(f.id).then(m => { fails = 0;
    const st = m[p.id], id = String(f.id); if (!st || !(st.minutes_played > 0) || have.has(id)) return; have.add(id);
    const home = String(f.home?.id) === String(tid), them = home ? f.away : f.home, us = f.score?.[home ? 0 : 1], op = f.score?.[home ? 1 : 0];
    rsAddGames(p, [{ id, date: new Date(f.utc), opp: them?.name || '', oppId: String(them?.id || ''), oppLogo: them?.logo || '', home, comp: comp || f.tournament || '', res: rsResult(us, op),
      score: us != null ? `${us}–${op}` : '', min: st.minutes_played, raw: { goals: st.goals || 0, assists: st.assists || 0, yellow: null, red: null, rating: st.rating_title ?? null }, deep: st }]);
    p.fillN = (p.fillN || 0) + 1; if (p.fillN % 4 === 0) onStep?.() }, err => { fails++; throw err });
  const done = f => f.finished && f.score && !have.has(String(f.id));
  if (p.teamId && !p.fillCur) {
    p.careerAt = 'this season'; onStep?.();
    const t = await getJSON(`/api/fm/team?id=${p.teamId}`).catch(() => null);
    await rsPool((t?.fixtures || []).filter(done).sort((a, b) => new Date(b.utc) - new Date(a.utc)), 3, f => live() && add(f, p.teamId));
    if (!live()) return false;
    p.fillCur = true; onStep?.();
  }
  // one job per competition per season
  const cur = [...new Set((p.career || []).map(x => x.season).filter(Boolean))][0], jobs = [];
  for (const [list, nat] of [[p.career || [], false], [p.natCareer || [], true]]) for (const e of list) {
    if (!e.teamId || !e.season || !nat && e.season === cur) continue;
    const comps = (e.comps || []).filter(c => c.leagueId && c.apps > 0);
    const main = comps.filter(c => !/cup|copa|coupe|pokal|coppa|ta[çc]a|trophy|shield|super|champions|europa|conference|play-?off|qualif/i.test(c.league || '')).sort((a, b) => b.apps - a.apps)[0];
    for (const c of comps) jobs.push({ c, e, nat, tier: rsCompTier(c, nat, main), yr: Math.max(...(e.season.match(/\d{4}/g) || [0]).map(Number)) });
  }
  jobs.sort((a, b) => a.tier - b.tier || b.yr - a.yr);
  p.fillJobs ??= 0;
  for (; p.fillJobs < jobs.length; p.fillJobs++) {
    if (!live()) return false;
    if (fails > 10) break;   // FotMob is turning requests away: stop for now
    const { c, e, tier } = jobs[p.fillJobs], sn = e.season;
    p.careerAt = `${RS_TIER[tier]}: ${c.league} ${sn}`; onStep?.();
    const yrs = (sn.match(/\d{4}/g) || []).map(Number), lo = Math.min(...yrs) - (yrs.length === 1 ? 1 : 0), hi = Math.max(...yrs);
    const d = await getJSON(`/api/fm/leaguefixtures?id=${c.leagueId}&season=${encodeURIComponent(sn)}`).catch(() => null);
    const fx = (d?.fixtures || []).filter(f => { const y = new Date(f.utc).getFullYear(); return done(f) && y >= lo && y <= hi && (String(f.home?.id) === String(e.teamId) || String(f.away?.id) === String(e.teamId)) });
    await rsPool(fx.sort((a, b) => new Date(b.utc) - new Date(a.utc)), 3, f => live() && add(f, e.teamId, c.league));
  }
  return true;
}
// Flashscore's player page lists about 10 games; the team's results and each game's box score give the rest
const rsFsBoxKey = { OR: 'OREB', DR: 'DREB', ST: 'STL', BS: 'BLK' };
async function rsFsFill(p, onStep){
  if (!p.fsTeam?.id) return;
  const t = await getJSON(`/api/bb/team?id=${encodeURIComponent(p.fsTeam.id)}&slug=${encodeURIComponent(p.fsTeam.slug || '')}`).catch(() => null);
  const have = new Set(p.games.map(g => g.id));
  const todo = (t?.results || []).filter(e => e.state === 'post' && !have.has('fs' + e.id)).slice(0, 45);
  let n = 0;
  await rsPool(todo, 3, async e => {
    const d = await getJSON(`/api/bb/game?id=${encodeURIComponent(e.id)}`), tab = (d.box || []).find(x => x.name === 'Overall') || d.box?.[0];
    const pl = tab?.players?.find(x => String(x.id) === p.fsId) || tab?.players?.find(x => normName(x.name) === normName(p.name)); if (!pl) return;
    const raw = {};
    for (const [k, v] of Object.entries(pl.stats || {})) { if (v === '' || v == null) continue; const kk = rsFsBoxKey[k] || k; raw[kk] = kk === 'MIN' ? (([a, b]) => +a + (+b || 0) / 60)(String(v).split(':')) : rsNum(v) }
    if (!raw.MIN && raw.PTS == null) return;
    if (raw.FGM == null && raw['2PM'] != null) { raw.FGM = raw['2PM'] + (raw['3PM'] || 0); raw.FGA = (raw['2PA'] || 0) + (raw['3PA'] || 0) }
    const home = String(e.home?.id) === String(p.fsTeam.id), us = rsNum((home ? e.home : e.away)?.score), op = rsNum((home ? e.away : e.home)?.score), them = home ? e.away : e.home;
    rsAddGames(p, [{ id: 'fs' + e.id, date: new Date(e.ts * 1000), opp: them?.full || them?.name || '', oppId: String(them?.id || ''), oppLogo: them?.logo || '', home, comp: e.lgName || '', res: rsResult(us, op),
      score: us != null ? `${us}–${op}` : '', min: raw.MIN != null ? Math.round(raw.MIN) : null, raw, deep: { oreb: raw.OREB ?? null, dreb: raw.DREB ?? null, dunks: null } }]);
    if (++n % 4 === 0) onStep?.();
  });
}
// the rest of the career, one season at a time going back, after the first two seasons are on screen (teams: 8 seasons)
async function rsLoadCareer(p, onStep){
  if (p.kind !== 'team' && (p.sport === 'soccer' || p.fs) && !p.careerDone && !p.careerLoading) {
    p.careerLoading = true; onStep?.();
    let fin = true;
    try { fin = await (p.fs ? rsFsFill(p, onStep) : rsSoccerFill(p, onStep)) !== false } finally { p.careerLoading = false; p.careerDone = fin; onStep?.() }
    return;
  }
  if (p.sport === 'soccer' || p.fs || p.careerDone || p.careerLoading) return;
  p.careerLoading = true; let empty = 0;
  const stop = p.kind === 'team' ? p.from - 8 : p.sport === 'mlb' ? (p.debut || p.from - 25) : p.years ? p.from - p.years : p.from - 25;
  for (let y = p.from - 1; y >= stop && empty < 2; y--) {
    const gs = p.kind === 'team' ? await (p.sport === 'mlb' ? rsMlbTeamSeason(p.id, y) : rsEspnTeamSeason(p.path, p.id, y))
      : p.sport === 'mlb' ? await rsMlbSeason(p.id, y, p.sportId) : await rsEspnSeason(p.path, p.id, y);
    if (gs.length) { empty = 0; rsAddGames(p, gs) } else empty++;
    p.careerAt = y; onStep?.();
  }
  p.careerLoading = false; p.careerDone = true; onStep?.();
}
const RS_TN_STAT = { 'Aces': 'aces', 'Double Faults': 'df', 'Break Points Converted': 'bpConv', 'Break Points Saved': 'bpSaved', 'Service Points Won': 'svPts', 'Return Points Won': 'retPts',
  'Total Points Won': 'totPts', '1st serve points won': 'firstWon', 'Service games won': 'svGames', '1st serve percentage': 'firstPct' };
// one match's stats from the player's side: counts, with the "a/b" totals kept for percentages
function rsTnDeep(row){
  const f = {}, pair = k => row[k] || [];
  for (const k of Object.values(RS_TN_STAT)) if (row[k]) f[k] = row[k][0];
  if (pair('bpSaved')[1] != null) f.bpFaced = pair('bpSaved')[1];
  if (pair('firstWon')[1] != null && pair('svPts')[1]) f.first = Math.round(pair('firstWon')[1] / pair('svPts')[1] * 1000) / 10;
  else if (row.firstPct?.[0] != null) f.first = row.firstPct[0];
  return f;
}
const rsTnPart = s => { const m = String(s || '').match(/(\d+)\s*\/\s*(\d+)/); if (m) return [+m[1], +m[2]]; const n = String(s || '').match(/-?\d+(\.\d+)?/); return n ? [+n[0], null] : [null, null] };
const rsTnM = new Map();
function rsTnMatch(g){
  if (!rsTnM.has(g.tnid)) rsTnM.set(g.tnid, getJSON(`/api/tn/match?id=${encodeURIComponent(g.tnid)}`).catch(err => { rsTnM.delete(g.tnid); throw err }));
  return rsTnM.get(g.tnid).then(d => { const per = (d.stats || []).find(x => x.period === 'Match'); if (!per) return null;
    const row = {}; for (const grp of per.groups || []) for (const r of grp.rows || []) { const k = RS_TN_STAT[r.label]; if (k) row[k] = rsTnPart(r[g.side]) }
    return rsTnDeep(row) });
}
const rsSurf = (s, indoor) => { const x = String(s || '').toLowerCase(); const b = /clay/.test(x) ? 'Clay' : /grass/.test(x) ? 'Grass' : /carpet/.test(x) ? 'Carpet' : /hard/.test(x) ? 'Hard' : 'Other';
  return b === 'Hard' && (indoor || /indoor/.test(x)) ? 'Hard (indoor)' : b };
// the tennis screen's ESPN ranking photos, when it has loaded them
function rsTnPhoto(d){
  try { if (typeof tnEspnOf !== 'function' || !S.tn?.espn) return ''; const tour = /wta|women/i.test(`${d.tour} ${d.gender}`) ? 'wta' : 'atp';
    return tnEspnOf(d.name, tour)?.photo || '' } catch { return '' }
}
async function rsLoadTennis(o){
  const d = await getJSON(`/api/tn/player?id=${encodeURIComponent(o.tnId)}&slug=${encodeURIComponent(o.slug || '')}`);
  if (!d || d.error || !d.matches) throw new Error('not found');
  const per = new Map((d.stats?.per || []).map(r => [r.id, r])), pid = String(o.tnId);
  const games = d.matches.filter(m => m.state === 'post' && (m.disc || 'S') === 'S' && !['9', '5', '8'].includes(String(m.code))).map(m => {
    const side = String(m.home?.id || '').split('/').includes(pid) ? 'home' : String(m.away?.id || '').split('/').includes(pid) ? 'away' : null; if (!side) return null;
    const me = m[side], op = m[side === 'home' ? 'away' : 'home'], mg = me.games || [], og = op.games || [];
    const gw = mg.reduce((a, b) => a + (b || 0), 0), gl = og.reduce((a, b) => a + (b || 0), 0);
    const tb = mg.filter((x, i) => (me.tb?.[i] != null || op.tb?.[i] != null) || (x === 7 && og[i] === 6) || (x === 6 && og[i] === 7)).length;
    const raw = { gw, gl, tg: gw + gl, sw: me.sets, ts: me.sets != null && op.sets != null ? me.sets + op.sets : null, win: m.winner ? +(m.winner === side) : null,
      s1g: mg[0] != null ? mg[0] + og[0] : null, s1w: mg[0] ?? null, s1win: mg[0] != null && mg[0] !== og[0] ? +(mg[0] > og[0]) : null, tb };
    const row = per.get(m.id);
    return { id: 'tn' + m.id, tnid: m.id, side, date: new Date(m.ts * 1000), opp: op.name || '', oppId: String(op.id || ''), oppLogo: op.photo || '', home: null,
      comp: rsSurf(m.surface, m.indoor), level: m.levelName || '', tn: [m.tnName, m.round].filter(Boolean).join(' · '), res: raw.win == null ? '' : raw.win ? 'W' : 'L',
      score: mg.map((x, i) => `${x}-${og[i]}`).join(' '), min: null, raw, deep: row ? rsTnDeep(row) : undefined } }).filter(Boolean);
  const p = { sport: 'tennis', key: 'tennis:' + pid, id: pid, tnId: pid, slug: o.slug, name: d.name, team: [d.country, d.rank ? `${d.tour || ''} #${d.rank}`.trim() : ''].filter(Boolean).join(' · '),
    photo: rsTnPhoto(d) || d.photo || o.photo || '', pos: d.injury ? `Out: ${d.injury}` : '', games: [], careerDone: true };
  rsAddGames(p, games);
  return p;
}
const rsCache = new Map();
function rsLoad(o){
  let k = `${o.sport}:${o.id || o.fmId || normName(o.name)}`;
  if (o.kind === 'team') k = `${o.sport}:team:${o.fmId || o.id || normName(o.name)}`;
  if (o.fsId) k = `${o.sport}:fs${o.fsId}`;
  if (o.fsTeam) k = `${o.sport}:fsteam${o.fsTeam}`;
  if (o.tnId) k = `tennis:${o.tnId}`;
  if (!rsCache.has(k)) rsCache.set(k, (o.kind === 'team' ? rsLoadTeam(o) : o.fsId ? rsLoadFs(o) : o.sport === 'tennis' ? rsLoadTennis(o) : o.sport === 'soccer' ? rsLoadSoccer(o) : o.sport === 'mlb' ? rsLoadMlb(o) : rsLoadEspn(o)).catch(err => { rsCache.delete(k); throw err }));
  return rsCache.get(k);
}
// a player from a prop list, by name: ESPN / StatsAPI search for the id first
const rsIds = new Map();
function rsFindPlayer(sport, name, team){
  const k = sport + '|' + normName(name);
  if (rsIds.has(k)) return rsIds.get(k);
  let pr;
  if (sport === 'soccer') pr = Promise.resolve({ name, team });
  else if (sport === 'tennis') pr = getJSON(`/api/tn/search?q=${encodeURIComponent(name)}`).then(d => { const L = d.players || [], n = normName(name);
    const x = L.find(x => normName(x.name) === n) || L.find(x => normName(x.name).includes(n.split(' ').pop())) || L[0]; return x ? { tnId: x.id, slug: x.slug, name: x.name, photo: x.img } : null });
  else if (sport === 'mlb') pr = cj(`${SAPI}/people/search?names=${encodeURIComponent(name)}&sportIds=1`).then(d => { const x = (d.people || []).sort((a, b) => !!b.active - !!a.active)[0]; return x ? { id: x.id, name: x.fullName } : null });
  else pr = cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&type=player&sport=${RS_ESPN[sport]}&limit=6`)
    .then(d => { const ok = sport === 'nfl' ? ['nfl'] : sport === 'nhl' ? ['nhl'] : ['nba', 'wnba']; const x = (d.items || []).find(x => ok.includes(x.league || x.defaultLeagueSlug)); return x ? { id: x.id, lg: x.league || x.defaultLeagueSlug, name: x.displayName } : null });
  pr = pr.catch(() => null); rsIds.set(k, pr); return pr;
}

/* ---------- maths ---------- */
const rsMedian = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 };
const rsAvg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
// over: value above the line hits; under: below. Landing on a whole-number line is a push and doesn't count either way.
function rsRate(games, def, line, side){
  let hit = 0, push = 0, n = 0; const vals = [];
  for (const g of games) { const v = def.get(g); if (v == null) continue; n++; vals.push(v);
    if (v === line) push++; else if (side === 'over' ? v > line : v < line) hit++ }
  const dec = n - push;
  return { n, hit, push, pct: dec ? hit / dec : null, avg: rsAvg(vals), med: rsMedian(vals) };
}
function rsDefaultLine(p, def){
  if (def.yes) return .5;
  const vals = p.games.slice(0, 10).map(def.get).filter(v => v != null);
  const step = def.step || .5, a = rsAvg(vals);
  if (a == null) return step === .5 ? .5 : 6.5;
  if (step < .5) return Math.round(a * 10) / 10;
  if (step === 1) return Math.round(a);
  return def.neg ? Math.round(a) - .5 : Math.max(.5, Math.round(a) - .5);
}

/* ---------- combos: two or more players (or stats) added up game by game ---------- */
// the same game for another player: the same event, the same NFL week, or the same day
function rsSameGame(q, g, sport){
  return q.games.find(x => x.id === g.id) || q.games.find(x => sport === 'nfl' && x.week != null && g.week != null ? x.season === g.season && x.week === g.week && x.comp === g.comp
    : Math.abs(x.date - g.date) < 20 * 36e5);
}
function rsComboView(p, def){
  const legs = [{ p, def }, ...S.rs.combo.map(c => ({ p: c.p, def: rsDef(c.p, c.k) }))].filter(l => l.def);
  const games = p.games.map(g => { let sum = 0;
    for (const [i, L] of legs.entries()) { const x = i === 0 || L.p === p ? g : rsSameGame(L.p, g, p.sport), v = x && L.def.get(x); if (v == null) return null; sum += v }
    return { ...g, combo: Math.round(sum * 100) / 100 } }).filter(Boolean);
  const short = n => n.split(' ').slice(-1)[0];
  return { p: { ...p, games }, def: { k: 'combo', l: legs.map(L => `${legs.some(x => x.p !== L.p) ? short(L.p.name) + ' ' : ''}${L.def.l.toLowerCase()}`).join(' + '), get: g => g.combo, dec: legs.some(L => L.def.dec) ? 1 : 0 } };
}
function rsComboLine(){
  const r = S.rs, p = r.p, def = rsDef(p, r.stat); if (!def) return rsRender();
  const v = rsComboView(p, def); r.line = rsDefaultLine(v.p, v.def); rsRender();
  // per-game detail for any leg that needs it
  for (const L of [{ p, k: r.stat }, ...r.combo]) { const d = rsDef(L.p, L.k); if (d?.deep && L.p.games.slice(0, 20).some(g => g.deep === undefined)) rsLoadDeep(L.p, 20, rsSoon).then(() => { if (S.rs.combo.length) { const v2 = rsComboView(S.rs.p, rsDef(S.rs.p, S.rs.stat)); S.rs.line = rsDefaultLine(v2.p, v2.def) } rsRender() }) }
}
function rsComboHTML(p, def){
  const r = S.rs; if (p.kind === 'team' || p.fs) return '';
  const opts = (q, cur) => rsStatsFor(q).map(s => `<option value="${s.k}" ${s.k === cur ? 'selected' : ''}>${esc(s.l)}</option>`).join('');
  return `<div class="rs-combo"><span class="rs-cl">Combo</span>
    ${r.combo.length ? `<span class="rs-leg"><b>${esc(p.name)}</b> ${esc(def.l)}</span>` : ''}
    ${r.combo.map((c, i) => `<span class="rs-leg">+ <img src="${esc(c.p.photo || SIL)}" alt="" onerror="rsNoImg(this)"><b>${esc(c.p.name)}</b><select data-rscombo="${i}" aria-label="Stat for ${esc(c.p.name)}">${opts(c.p, c.k)}</select><button data-rs="rmleg" data-i="${i}" aria-label="Remove ${esc(c.p.name)} from the combo">✕</button></span>`).join('')}
    <button class="qf" data-rs="addleg">+ Add a player</button><button class="qf" data-rs="addstat">+ Add another of ${esc(p.name.split(' ').slice(-1)[0])}'s stats</button>
    ${r.combo.length ? '<button class="linkbtn" data-rs="clearcombo">Clear combo</button>' : ''}
    ${r.comboAdd ? `<div class="rs-search rs-csearch"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rsCq" type="search" placeholder="Player to add, e.g. Saquon Barkley" autocomplete="off" value="${esc(r.cq || '')}" aria-label="Player to add to the combo"></label><div class="rs-hits" id="rsCHits" hidden></div></div>` : ''}</div>`;
}
// games after the venue / competition / season / minutes / result filters (opponent is its own tile)
function rsFiltered(p){
  const r = S.rs;
  return p.games.filter(g => (r.venue === 'all' || (r.venue === 'home') === !!g.home) && (r.comp === 'all' || g.comp === r.comp) && (r.season === 'all' || g.season === r.season)
    && (!r.minMin || (g.min ?? 0) >= r.minMin) && (r.res === 'all' || g.res === r.res));
}
const rsSameOpp = (g, o) => o && (g.oppId === o || normName(g.opp) === normName(o));
function rsRangeGames(p, games, range){
  if (range === 'l5') return games.slice(0, 5);
  if (range === 'l10') return games.slice(0, 10);
  if (range === 'l20') return games.slice(0, 20);
  if (range === 'season') { const s = rsSeasonStart(p.sport), cur = games.filter(g => g.date >= s); if (cur.length || p.games.some(g => g.date >= s)) return cur;
    const prev = new Date(s); prev.setFullYear(s.getFullYear() - 1); return games.filter(g => g.date >= prev && g.date < s) }
  if (range === 'h2h') return games.filter(g => rsSameOpp(g, S.rs.opp));
  return games;
}
// fixtures the app already loaded, per sport
const rsTeamNorm = t => normName(t).replace(/\b(fc|cf|afc|sc|ac)\b/g, '').trim();
const rsSameTeam = (a, b) => { a = rsTeamNorm(a); b = rsTeamNorm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)) };
function rsEvents(sport){
  if (sport === 'soccer') return [...(S.events?.values?.() || [])];
  if (sport === 'nfl') return Object.values(S.fb?.data || {}).flatMap(d => d.events || []).filter(e => e.lg === 'nfl');
  if (sport === 'nhl') return [...(S.hk?.games?.values?.() || [])].filter(e => e.src === 'espn' && e.lg === 'nhl');
  if (sport === 'tennis') return [];
  if (sport === 'nba') return [...(S.bb?.games?.values?.() || [])].filter(e => e.src === 'espn' && /^(nba|wnba)$/.test(e.lg));
  const out = [], walk = (x, depth) => { if (!x || depth > 3 || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) if (y?.src === 'sa' && y.home && y.away && y.date) out.push(y); else walk(y, depth + 1) } else for (const v of Object.values(x)) walk(v, depth + 1) };
  walk(S.bsb?.data, 0); return out.filter(e => e.lg === 'mlb');
}
function rsNextOpp(p){
  const e = rsEvents(p.sport).filter(e => e?.state !== 'post' && e?.home && e?.away && (rsSameTeam(e.home.full || e.home.name, p.team) || rsSameTeam(e.away.full || e.away.name, p.team))).sort((a, b) => a.date - b.date)[0];
  if (!e) return null;
  const home = rsSameTeam(e.home.full || e.home.name, p.team), them = home ? e.away : e.home;
  return { name: them.full || them.name, id: String(them.fmId || them.id || '').replace(/^fm/, ''), home, date: e.date, logo: them.logo, e };
}

/* ---------- lines from PrizePicks, Sleeper and the sportsbooks ---------- */
const RS_BOOK = { prizepicks: 'PrizePicks', sleeper: 'Sleeper', fanduel: 'FanDuel', draftkings: 'DraftKings', kalshi: 'Kalshi', polymarket: 'Polymarket' };
const RS_BK = { prizepicks: 'PP', sleeper: 'SL', fanduel: 'FD', draftkings: 'DK', kalshi: 'KX', polymarket: 'PM' };
function rsDfsLoad(sport, force){
  const r = S.rs, have = r.dfs[sport];
  if (have && !force && (have.loading || Date.now() - have.at < 120000)) return have.req || Promise.resolve();
  const d = r.dfs[sport] = { loading: true, at: Date.now(), lines: [], errors: {} };
  d.req = getJSON(`/api/dfs/lines?sport=${sport}`).then(x => { d.lines = x.lines || []; d.errors = x.errors || {} })
    .catch(() => { d.errors = { server: 'old' } }).finally(() => { d.loading = false; if (S.rs.open) rsRender() });
  return d.req;
}
// the books' cat names (odds.py) in words our alias table knows
const RS_CAT = { anytime_goal: 'goals', anytime_td: 'anytimetd', pass_yds: 'passyards', rush_yds: 'rushyards', rec_yds: 'receivingyards', rush_rec_yds: 'rushrecyards', pass_td: 'passtds',
  pass_att: 'passattempts', pass_cmp: 'completions', rush_att: 'rushattempts', longest_rec: 'longestreception', longest_rush: 'longestrush', int: 'intsthrown', hrr: 'hrr', home_runs: 'homeruns',
  total_bases: 'totalbases', hits_allowed: 'hitsallowed', earned_runs: 'earnedruns', stolen_bases: 'stolenbases', strikeouts: 'pitcherstrikeouts', threes: 'threes', outs: 'pitchingouts' };
// sportsbook props from the odds boards the app has loaded: [{e, player, stat, offers:[{book, line, over, under, pOver}]}]
function rsBookProps(sport){
  const out = [];
  for (const e of rsEvents(sport)) {
    const d = S.books?.get(rsBkKey(sport, e)); if (!d?.props) continue;
    for (const pr of d.props) {
      const stat = rsStatKey(sport, RS_CAT[pr.cat] || pr.label || pr.cat) || rsStatKey(sport, pr.cat); if (!stat) continue;
      const offers = pr.offers.map(o => pr.kind === 'yes' ? { book: o.book, line: .5, over: o.yes, pOver: o.yes?.p }
        : { book: o.book, line: o.line, over: o.over, under: o.under, pOver: o.over?.p && o.under?.p ? o.over.p / (o.over.p + o.under.p) : o.over?.p });
      out.push({ e, player: pr.player, stat, offers });
    }
  }
  return out;
}
// every posted line for this player and stat
function rsLinesFor(sport, name, key){
  const n = normName(name), out = [];
  for (const x of S.rs.dfs[sport]?.lines || []) if (normName(x.player) === n && rsStatKey(sport, x.stat) === key)
    out.push({ book: x.book, line: x.line, kind: x.kind, overMult: x.overMult, underMult: x.underMult, pOver: x.pOver });
  for (const row of rsBookProps(sport)) if (normName(row.player) === n && row.stat === key) out.push(...row.offers);
  const order = Object.keys(RS_BOOK);
  return out.sort((a, b) => order.indexOf(a.book) - order.indexOf(b.book));
}
// a team's posted lines for its next game: the total and its spread (as a winning margin)
function rsTeamLines(p, key){
  const e = p.next?.e; if (!e) return [];
  const d = S.books?.get(rsBkKey(p.sport, e)); if (!d) return [];
  const home = p.next.home, out = [];
  if (key === 'tot') for (const t of d.totals || []) for (const o of t.offers) out.push({ book: o.book, line: t.line, over: o.over, under: o.under, pOver: o.over?.p && o.under?.p ? o.over.p / (o.over.p + o.under.p) : null });
  if (key === 'margin') for (const sp of d.spreads || []) for (const o of sp.offers) { const mine = home ? o.home : o.away, theirs = home ? o.away : o.home;
    out.push({ book: o.book, line: home ? -sp.homeLine : sp.homeLine, over: mine, under: theirs, pOver: mine?.p && theirs?.p ? mine.p / (mine.p + theirs.p) : null }) }
  return out;
}
const rsAm = x => x?.am == null ? '' : x.am > 0 ? '+' + x.am : '−' + Math.abs(x.am);
function rsLineChip(o, cur){
  const price = o.book === 'sleeper' ? (o.overMult ? `×${o.overMult}` : '') : o.book === 'prizepicks' ? (o.kind && o.kind !== 'standard' ? o.kind : '') : rsAm(o.over);
  return `<button class="rs-lchip${o.line === cur ? ' on' : ''}" data-rs="setline" data-to="${o.line}" title="${esc(`${RS_BOOK[o.book] || o.book}: ${o.line}${o.pOver != null ? ` · ${Math.round(o.pOver * 100)}% chance of the over` : ''}`)}"><b>${esc(RS_BK[o.book] || o.book)}</b> ${rsLineTxt(o.line)}${price ? ` <small>${esc(price)}</small>` : ''}</button>`;
}
// the books' chance of the over at this line (Sleeper's two multipliers or a sportsbook's two prices, margin removed)
function rsBookPct(offers, line){
  const ps = offers.filter(o => o.line === line && o.pOver != null).map(o => o.pOver);
  return ps.length ? rsAvg(ps) : null;
}

/* ---------- opening ---------- */
function rsEl(){
  let el = $('rs');
  if (!el) { el = document.createElement('section'); el.id = 'rs'; el.className = 'rs'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Prop research'); document.body.appendChild(el) }
  return el;
}
function openResearch(o = {}){
  const r = S.rs; r.open = true; if (o.sport) { r.sport = o.sport; store.set('fl.rsSport', r.sport) }
  if (o.tab) r.tab = o.tab;
  const el = rsEl(); el.hidden = false; document.documentElement.classList.add('rs-lock');
  hideResults?.(); rsDfsLoad(r.sport);
  if (o.id || o.fmId || o.name) rsPick(o); else rsRender();
  el.scrollTop = 0; setTimeout(() => (el.querySelector('#rsQ') || el.querySelector('.rs-x'))?.focus(), 30);
}
function closeResearch(){ S.rs.open = false; const el = $('rs'); if (el) el.hidden = true; document.documentElement.classList.remove('rs-lock'); $('rsBtn')?.focus() }
window.openResearch = openResearch;

let rsPickSeq = 0, rsRT = 0, rsRQ = null;
// re-render at most a few times a second while things stream in
const rsSoon = () => { if (rsRQ) return; const wait = Math.max(0, 300 - (Date.now() - rsRT)); rsRQ = setTimeout(() => { rsRQ = null; rsRT = Date.now(); rsRender() }, wait) };
async function rsPick(o){
  const r = S.rs, seq = ++rsPickSeq; r.tab = 'player'; r.loading = true; r.err = null; r.hits = []; r.q = ''; r.logAll = false; r.combo = []; r.comboAdd = false;
  if (o.sport) r.sport = o.sport;
  r.p = { sport: r.sport, name: o.name || '', team: o.team || '', photo: o.photo || '', games: [] }; rsRender();
  try {
    const p = await rsLoad({ ...o, sport: r.sport });
    if (seq !== rsPickSeq) return;   // picked someone else meanwhile
    r.p = p; r.loading = false;
    r.venue = 'all'; r.comp = 'all'; r.season = 'all'; r.minMin = 0; r.res = 'all'; r.range = 'l10';
    const nx = rsNextOpp(p); p.next = nx;
    if (p.kind === 'team' && nx?.e) rsBookLoad(p.sport, nx.e).then(() => { if (S.rs.p !== p) return; if (/^(tot|margin)$/.test(S.rs.stat) && !S.rs.combo.length) rsSetStat(S.rs.stat); else rsRender() });
    r.opp = nx ? (p.games.find(g => rsSameOpp(g, nx.id) || normName(g.opp) === normName(nx.name))?.oppId || nx.id || nx.name) : '';
    const stats = rsStatsFor(p);
    const want = o.stat && stats.find(s => s.k === o.stat) ? o.stat : stats.find(s => s.k === r.stat) ? r.stat : stats[0]?.k;
    rsSetStat(want, o.line);
    r.recent = [{ sport: p.sport, id: p.fs ? undefined : p.id, tnId: p.tnId, fsId: o.fsId, slug: o.slug, fsTeam: o.fsTeam, tslug: o.tslug, kind: p.kind, lg: p.lg, sportId: p.sportId, name: p.name, team: p.team, photo: p.photo },
      ...r.recent.filter(x => !(x.sport === p.sport && String(x.id) === p.id && (x.kind || '') === (p.kind || '')) && !(p.fs && String(x.fsId) === String(o.fsId)))].slice(0, 10);
    store.set('fl.rsRecent', r.recent);
    rsLoadCareer(p, () => S.rs.p === p && rsSoon());
  } catch { if (seq !== rsPickSeq) return; r.loading = false; r.err = `Couldn't load ${o.name || (o.kind === 'team' ? 'that team' : 'that player')}'s games.` }
  rsRender();
}
function rsSetStat(k, line){
  const r = S.rs, p = r.p; if (!p?.games) return;
  const def = rsDef(p, k) || rsStatsFor(p)[0]; if (!def) return;
  r.stat = def.k;
  // a posted line beats our guess: PrizePicks standard first, then whatever else is posted
  const posted = line == null ? (p.kind === 'team' ? rsTeamLines(p, def.k) : rsLinesFor(p.sport, p.name, def.k)) : [];
  const pick = posted.find(o => o.book === 'prizepicks' && (!o.kind || o.kind === 'standard')) || posted[0];
  const go = () => { r.line = line != null ? +line : pick ? pick.line : rsDefaultLine(p, def); rsRender() };
  if (r.combo.length) return rsComboLine();
  if (def.deep && p.games.slice(0, 20).some(g => g.deep === undefined)) {
    r.deepLoading = true; go();
    rsLoadDeep(p, 20, rsSoon).then(() => { r.deepLoading = false; if (line == null && !pick && S.rs.stat === def.k) r.line = rsDefaultLine(p, def); rsRender() });
  } else go();
}

/* ---------- search ---------- */
let rsSeq = 0;
const RS_BROWSE = {
  soccer: [['eng.1', 'Premier League'], ['esp.1', 'LaLiga'], ['ita.1', 'Serie A'], ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'], ['usa.1', 'MLS'], ['eng.2', 'Championship'], ['ned.1', 'Eredivisie'],
    ['por.1', 'Portugal'], ['sco.1', 'Scotland'], ['bel.1', 'Belgium'], ['tur.1', 'Turkey'], ['mex.1', 'Liga MX'], ['bra.1', 'Brazil'], ['arg.1', 'Argentina'], ['ksa.1', 'Saudi Pro League'],
    ['uefa.champions', 'Champions League'], ['eng.w.1', "Women's Super League"], ['usa.nwsl', 'NWSL']],
  nba: [['nba', 'NBA'], ['wnba', 'WNBA'], ['mens-college-basketball', "Men's college"], ['womens-college-basketball', "Women's college"], ['fs:euroleague', 'EuroLeague'], ['fs:eurocup', 'EuroCup'],
    ['fs:bcl', 'Champions League'], ['fs:aba', 'ABA League'], ['fs:vtb', 'VTB'], ['fs:nbl', 'NBL Australia'], ['fs:cba', 'CBA China'], ['fs:bleague', 'B.League'], ['fs:kbl', 'KBL']],
  nfl: [['nfl', 'NFL'], ['college-football', 'College football'], ['ufl', 'UFL']],
  mlb: [['mlb', 'MLB']], nhl: [['nhl', 'NHL']] };
async function rsBrowseLoad(lg){
  const r = S.rs, sport = r.sport, b = r.browse = { open: true, sport, lg, list: [], loading: true, q: r.browse?.sport === sport ? r.browse.q || '' : '' }; rsRender();
  try {
    if (sport === 'mlb') b.list = (await (rsMlbTeams ||= cj(`${SAPI}/teams?sportId=1`).then(d => d.teams || []).catch(() => []))).map(t => ({ kind: 'team', id: t.id, name: t.name, photo: `https://www.mlbstatic.com/team-logos/${t.id}.svg` }));
    else if (lg.startsWith('fs:')) { const d = await getJSON(`/api/bb/league?key=${lg.slice(3)}`);
      b.list = (d.standings || []).flatMap(g => g.rows || []).filter((x, i, a) => x.id && a.findIndex(y => y.id === x.id) === i).map(x => ({ kind: 'team', fsTeam: x.id, tslug: x.slug, name: x.name, photo: '' })) }
    else { const path = sport === 'soccer' ? `soccer/${lg}` : `${RS_ESPN[sport]}/${lg}`;
      const d = await cj(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=1000`);
      b.list = (d.sports?.[0]?.leagues?.[0]?.teams || []).map(x => x.team).filter(Boolean).map(t => sport === 'soccer' ? { kind: 'team', name: t.displayName, photo: t.logos?.[0]?.href || '' }
        : { kind: 'team', id: t.id, lg, name: t.displayName, photo: t.logos?.[0]?.href || '' }) }
    b.list.sort((a, c) => a.name.localeCompare(c.name));
  } catch { b.err = true }
  b.loading = false; if (S.rs.browse === b) rsRender();
}
function rsBrowseHTML(){
  const r = S.rs, b = r.browse; if (!b?.open || b.sport !== r.sport) return '';
  const q = normName(b.q || ''), list = b.list.filter(x => !q || normName(x.name).includes(q));
  return `<div class="rs-browse"><div class="rs-stats" role="group" aria-label="League">${RS_BROWSE[r.sport].map(([k, l]) => `<button class="qf" data-rs="blg" data-to="${k}" aria-pressed="${b.lg === k}">${esc(l)}</button>`).join('')}</div>
    ${b.list.length > 12 ? `<label class="search rs-bf"><input id="rsBf" type="search" placeholder="Filter ${b.list.length} teams" value="${esc(b.q || '')}" aria-label="Filter teams" autocomplete="off"></label>` : ''}
    ${b.loading ? '<div class="skel" style="height:140px"></div>' : b.err || !b.list.length ? `<div class="note">Couldn't load that league's teams. Try searching instead.</div>`
      : `<div class="rs-tgrid">${list.slice(0, 500).map(x => `<button class="rs-hit" data-rs="bteam" data-i="${b.list.indexOf(x)}"><img src="${esc(x.photo || SIL)}" alt="" onerror="rsNoImg(this)" style="border-radius:6px;object-fit:contain"><span><b>${esc(x.name)}</b></span></button>`).join('') || '<div class="rs-none">No team matches that.</div>'}</div>`}</div>`;
}
const RS_LEAGUES = { nba: { nba: 'NBA', wnba: 'WNBA', 'mens-college-basketball': "Men's college", 'womens-college-basketball': "Women's college" },
  nfl: { nfl: 'NFL', 'college-football': 'College football', ufl: 'UFL' }, nhl: { nhl: 'NHL', 'mens-college-hockey': "Men's college hockey" } };
let rsMlbTeams;
async function rsSearch(q, combo){
  const r = S.rs, seq = ++rsSeq; q = q.trim();
  const put = h => { if (combo) r.chits = h; else r.hits = h; rsPaintHits() };
  if (q.length < 2) return put([]);
  const E = (sp, ty) => cj(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&type=${ty}&sport=${sp}&limit=10`).then(d => d.items || []).catch(() => []);
  const lgOf = x => x.league || x.defaultLeagueSlug || '';
  let P = [], T = [];
  if (r.sport === 'tennis') { const d = await getJSON(`/api/tn/search?q=${encodeURIComponent(q)}`).catch(() => null);
    P = (d?.players || []).map(x => ({ tnId: x.id, slug: x.slug, name: x.name, team: [x.country, x.gender].filter(Boolean).join(' · '), photo: x.img || '' })) }
  else if (r.sport === 'soccer') { const [a, b] = await Promise.all([E('soccer', 'player'), combo ? [] : E('soccer', 'team')]);
    P = a.map(x => ({ name: x.displayName, team: x.teamRelationships?.[0]?.displayName || '', photo: x.headshot?.href || '' }));
    T = b.map(x => ({ kind: 'team', name: x.displayName, team: x.location && x.league ? '' : '', photo: x.logos?.[0]?.href || '' })) }
  else if (RS_ESPN[r.sport]) { const sp = RS_ESPN[r.sport], L = RS_LEAGUES[r.sport];
    const [a, b, f] = await Promise.all([E(sp, 'player'), combo ? [] : E(sp, 'team'), r.sport === 'nba' ? getJSON(`/api/bb/search?q=${encodeURIComponent(q)}`).catch(() => null) : null]);
    P = a.filter(x => L[lgOf(x)]).map(x => ({ id: x.id, lg: lgOf(x), name: x.displayName, team: [x.teamRelationships?.[0]?.displayName, L[lgOf(x)]].filter(Boolean).join(' · '), photo: x.headshot?.href || '' }));
    if (f?.teams?.length && !combo) T.push(...f.teams.filter(x => !b.some(y => normName(y.displayName) === normName(x.name))).slice(0, 5).map(x => ({ kind: 'team', fsTeam: x.id, tslug: x.slug, name: x.name, team: [x.country, 'Flashscore'].filter(Boolean).join(' · '), photo: x.img || '' })));
    if (f?.players?.length) P.push(...f.players.filter(x => !P.some(y => normName(y.name) === normName(x.name))).slice(0, 6).map(x => ({ fsId: x.id, slug: x.slug, name: x.name, team: [x.team || x.country, 'Flashscore'].filter(Boolean).join(' · '), photo: x.img || '' })));
    T = [...b.filter(x => L[lgOf(x)]).map(x => ({ kind: 'team', id: x.id, lg: lgOf(x), name: x.displayName, team: L[lgOf(x)], photo: x.logos?.[0]?.href || '' })), ...T] }
  else {
    rsMlbTeams ||= cj(`${SAPI}/teams?sportId=1`).then(d => d.teams || []).catch(() => []);
    const [ppl, teams] = await Promise.all([cj(`${SAPI}/people/search?names=${encodeURIComponent(q)}&sportIds=1,11,12,13,14&hydrate=currentTeam`).catch(() => ({})), rsMlbTeams]);
    P = (ppl.people || []).sort((a, b) => !!b.active - !!a.active).slice(0, 10).map(p => ({ id: p.id, name: p.fullName, team: [p.primaryPosition?.abbreviation, p.currentTeam?.name].filter(Boolean).join(' · '), photo: `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${p.id}/headshot/67/current` }));
    const ql = q.toLowerCase(); if (!combo) T = teams.filter(t => `${t.name} ${t.abbreviation}`.toLowerCase().includes(ql)).slice(0, 5).map(t => ({ kind: 'team', id: t.id, name: t.name, team: 'MLB', photo: `https://www.mlbstatic.com/team-logos/${t.id}.svg` })) }
  if (seq !== rsSeq) return;
  put(P.length || T.length ? [...(T.length ? [{ head: 'Teams' }, ...T] : []), ...(P.length && T.length ? [{ head: 'Players' }] : []), ...P] : [{ none: true }]);
}
function rsPaintHits(){
  for (const [id, h, act] of [['rsHits', S.rs.hits, 'pick'], ['rsCHits', S.rs.chits || [], 'cpick']]) {
    const box = $(id); if (!box) continue;
    box.hidden = !h.length;
    box.innerHTML = h[0]?.none ? `<div class="rs-none">Nothing in ${esc(rsSportName(S.rs.sport).toLowerCase())} matches that.</div>`
      : h.map((x, i) => x.head ? `<div class="rs-hh">${esc(x.head)}</div>` : `<button class="rs-hit" data-rs="${act}" data-i="${i}"><img src="${esc(x.photo || SIL)}" alt="" onerror="rsNoImg(this)"${x.kind === 'team' ? ' style="border-radius:6px;object-fit:contain"' : ''}><span><b>${esc(x.name)}</b><small>${esc(x.team || '')}</small></span></button>`).join('');
  }
}

/* ---------- rendering ---------- */
const rsPctCls = p => p == null ? '' : p >= .7 ? 'hi' : p >= .55 ? 'ok' : p <= .3 ? 'lo' : p <= .45 ? 'meh' : 'mid';
const rsPctTxt = p => p == null ? '–' : Math.round(p * 100) + '%';
const rsFmt = (v, def) => v == null ? '–' : def?.dec ? (+v).toFixed(def.dec) : Number.isInteger(v) ? String(v) : (+v).toFixed(1);
const rsLineTxt = l => (Math.round(l * 10) / 10).toString();
const rsSportName = s => RS_SPORTS.find(x => x[0] === s)[1];
const rsScreen = s => ({ nba: 'Basketball', nfl: 'Football', mlb: 'Baseball', soccer: 'Soccer', nhl: 'Hockey', tennis: 'Tennis' })[s];
function rsRender(){
  const el = rsEl(); if (!S.rs.open) return;
  const r = S.rs, keepY = el.scrollTop, act = document.activeElement?.id;
  el.innerHTML = `<div class="rs-in">
    <div class="rs-top"><button class="rs-x" data-rs="close" aria-label="Close research">‹ Back</button><h2>Research</h2>
      <div class="seg rs-sp" role="tablist" aria-label="Sport">${RS_SPORTS.map(([k, l]) => `<button role="tab" data-rs="sport" data-to="${k}" aria-selected="${r.sport === k}" class="${r.sport === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="rs-tabs" role="tablist">${[['player', 'Player research'], ['board', "Today's player props"], ['team', 'Team props']].map(([k, l]) => `<button role="tab" data-rs="tab" data-to="${k}" aria-selected="${r.tab === k}">${l}</button>`).join('')}</div>
    ${r.tab === 'board' ? rsBoardHTML() : r.tab === 'team' ? rsTeamHTML() : rsPlayerHTML()}
    <p class="srcnote rs-rg">Hit rates describe the past, not the next game. Bet only what you can afford to lose.</p></div>`;
  el.scrollTop = keepY;
  for (const id of ['rsQ', 'rsBq', 'rsCq', 'rsBf']) if (act === id && $(id)) { const q = $(id); q.focus(); q.setSelectionRange(q.value.length, q.value.length) }
  rsPaintHits();
}
function rsSearchHTML(){
  const r = S.rs, ph = { soccer: 'Search a player or team, e.g. Saka or Arsenal', nba: 'Search a player or team: NBA, WNBA, college, EuroLeague…', nfl: 'Search a player or team: NFL, college, UFL', mlb: 'Search a player or team: MLB or the minors', nhl: 'Search an NHL player, goalie or team', tennis: 'Search a tennis player: ATP, WTA, Challengers, ITF' }[r.sport];
  const rec = r.recent.filter(x => x.sport === r.sport);
  return `<div class="rs-search"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="rsQ" type="search" placeholder="${esc(ph)}" autocomplete="off" value="${esc(r.q)}" aria-label="${esc(ph)}"></label><div class="rs-hits" id="rsHits" hidden></div></div>
    ${!RS_BROWSE[r.sport] ? '' : `<button class="linkbtn rs-bbtn" data-rs="browse" aria-expanded="${!!(r.browse?.open && r.browse.sport === r.sport)}">${r.browse?.open && r.browse.sport === r.sport ? 'Hide team list' : 'Browse all teams by league'}</button>`}${rsBrowseHTML()}
    ${rec.length ? `<div class="rs-recent"><span>Recent</span>${rec.map(x => `<button class="qf" data-rs="recent" data-i="${r.recent.indexOf(x)}"><img src="${esc(x.photo || SIL)}" alt="" onerror="rsNoImg(this)">${esc(x.name)}</button>`).join('')}</div>` : ''}`;
}
function rsPlayerHTML(){
  const r = S.rs; let p = r.p;
  let h = rsSearchHTML();
  if (!p || p.sport !== r.sport) return h + `<div class="rs-empty"><strong>Research any player prop</strong>Search a player, pick a stat and a line, and see how often they have gone over it: the last 5, 10 and 20 games, this season, their whole career, at home or away and against the next opponent. PrizePicks, Sleeper and sportsbook lines show up next to the line box when they're posted. Search a team to research its points, totals, spreads and yards the same way, or use Combo to add two players together (say two running backs' rushing yards). Or open <button class="linkbtn" data-rs="tab" data-to="board">Today's player props</button> to rank every line by hit rate.</div>`;
  if (r.err) return h + `<div class="note">${esc(r.err)}</div>`;
  const head = `<div class="rs-ph${p.kind === 'team' ? ' team' : ''}"><img class="face" src="${esc(p.photo || SIL)}" alt="" onerror="rsNoImg(this)"><div><h3>${esc(p.name)}</h3><p>${p.crest ? `<img src="${esc(p.crest)}" alt="" onerror="this.remove()">` : ''}${esc([p.team, p.pos].filter(Boolean).join(' · '))}</p>
    ${p.next ? `<p class="rs-next">Next: ${p.next.home ? 'vs' : '@'} <b>${esc(p.next.name)}</b> · ${esc(fmtDate(p.next.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</p>` : ''}</div></div>`;
  if (r.loading) return h + head + `<div class="skel" style="height:320px;margin-top:14px"></div>`;
  if (!p.games.length) return h + head + `<div class="note">No games logged for this ${p.kind === 'team' ? 'team' : 'player'}.</div>`;
  const stats = rsStatsFor(p), def0 = rsDef(p, r.stat) || stats[0], P0 = p;
  let def = def0;
  if (r.combo.length) ({ p, def } = rsComboView(P0, def0));
  const step = def.step || (def.yes ? 1 : def.k === 'min' || /yd|lng|kpts|pc$/.test(def.k) || def.k === 'combo' && /yard/.test(def.l) ? 1 : .5);
  const all = rsFiltered(p), deepWait = (def0.deep || r.combo.length) && r.deepLoading;
  const pool = def.deep ? all.filter(g => g.deep !== undefined) : all;
  const cN = c => p.games.filter(g => g.comp === c).length, cT = c => /^(uefa )?champions league$/i.test(c) ? 0 : /europa|conference/i.test(c) ? 2 : 1;
  const comps = [...new Set(p.games.map(g => g.comp).filter(Boolean))].sort((a, b) => p.sport === 'soccer' ? cT(a) - cT(b) || cN(b) - cN(a) : 0), seasons = [...new Set(p.games.map(g => g.season))];
  const opps = [...new Map(p.games.map(g => [g.oppId || g.opp, g])).values()].sort((a, b) => a.opp.localeCompare(b.opp));
  const oppName = r.opp ? (p.games.find(g => rsSameOpp(g, r.opp))?.opp || p.next?.name || r.opp) : '';
  const hasMin = p.games.some(g => g.min != null);
  const minOpts = p.sport === 'soccer' ? [0, 45, 60, 75] : p.sport === 'nba' ? [0, 15, 20, 25, 30] : p.sport === 'nhl' && !p.kind ? [0, 10, 14, 18, 22] : [];
  const posted = def.k === 'combo' ? [] : p.kind === 'team' ? rsTeamLines(p, def.k) : rsLinesFor(p.sport, p.name, def.k), bookPct = rsBookPct(posted, r.line);
  const yesNo = (o, n) => def.yes ? (r.side === 'over' ? 'Yes' : 'No') : (r.side === 'over' ? o : n);
  const tiles = [['l5', 'L5'], ['l10', 'L10'], ['l20', 'L20'], ['season', p.games.some(g => g.date >= rsSeasonStart(p.sport)) ? 'Season' : 'Last season'],
    ['h2h', oppName ? 'vs ' + (p.games.find(g => rsSameOpp(g, r.opp))?.oppAbbr || oppName) : 'H2H'], ['all', p.sport === 'soccer' ? 'All' : 'Career']].map(([k, l]) => {
    const R = rsRate(rsRangeGames(p, pool, k), def, r.line, r.side);
    return `<button class="rs-tile ${rsPctCls(R.pct)}" data-rs="range" data-to="${k}" aria-pressed="${r.range === k}"><span>${esc(l)}</span><b class="num">${rsPctTxt(R.pct)}</b><small>${R.n ? `${R.hit}/${R.n - R.push}${R.push ? ` · ${R.push} push` : ''}` : k === 'h2h' && !r.opp ? (p.sport === 'tennis' ? 'pick an opponent' : 'pick a team') : 'no games'}</small></button>` }).join('');
  const shown = rsRangeGames(p, pool, r.range).filter(g => def.get(g) != null);
  const R = rsRate(shown, def, r.line, r.side);
  const dfs = r.dfs[p.sport];
  const careerNote = p.sport === 'tennis' ? `${p.games.length} singles matches since ${p.games[p.games.length - 1]?.date.getFullYear() || ''} (walkovers and retirements left out)` : p.kind === 'team' ? (p.sport === 'soccer' ? `This season's ${p.games.length} finished matches` : p.careerLoading ? `Loading older seasons… back to ${p.careerAt || p.from}` : `${p.games.length} games since ${p.games[p.games.length - 1]?.date.getFullYear() || ''}`)
    : p.fs ? (p.careerLoading ? `Adding the rest of this season from box scores… ${p.games.length} games so far` : `${p.games.length} games with box scores, from Flashscore`)
    : p.sport === 'soccer' ? (p.careerLoading ? `Loading the whole career, most important first… ${p.games.length} matches so far${p.careerAt ? ` · now ${p.careerAt}` : ''}` : `${p.games.length} matches since ${p.games[p.games.length - 1]?.date.getFullYear() || ''} across ${new Set(p.games.map(g => g.comp)).size} competitions; pick one under Competition. Career totals by season are further down.`)
    : p.careerLoading ? `Loading the rest of the career… back to ${p.careerAt || p.from}` : `${p.games.length} games since ${p.games[p.games.length - 1]?.date.getFullYear() || ''} (whole career)`;
  h += head + `<div class="rs-stats" role="group" aria-label="Stat">${stats.map(s => `<button class="qf" data-rs="stat" data-to="${s.k}" aria-pressed="${s.k === def0.k}">${esc(s.l)}</button>`).join('')}</div>
    ${rsComboHTML(P0, def0)}
    <div class="rs-line">${def.yes ? '' : `<div class="rs-lc"><span>Line</span><button class="icon-btn" data-rs="line" data-to="${-step}" aria-label="Lower the line">−</button><input id="rsLine" type="number" inputmode="decimal" step="${step}" value="${rsLineTxt(r.line)}" aria-label="Line"><button class="icon-btn" data-rs="line" data-to="${step}" aria-label="Raise the line">+</button></div>`}
      <div class="seg rs-ou" role="group" aria-label="Over or under"><button data-rs="side" data-to="over" aria-pressed="${r.side === 'over'}" class="${r.side === 'over' ? 'on' : ''}">${def.yes ? 'Yes' : 'Over'}</button><button data-rs="side" data-to="under" aria-pressed="${r.side === 'under'}" class="${r.side === 'under' ? 'on' : ''}">${def.yes ? 'No' : 'Under'}</button></div>
      ${posted.length ? `<div class="rs-lines" aria-label="Posted lines">${posted.map(o => rsLineChip(o, r.line)).join('')}</div>` : dfs?.loading ? '<span class="rs-wait">Looking for posted lines…</span>' : ''}
      <p class="rs-sum">${esc(yesNo('Over', 'Under'))} ${def.yes ? '' : rsLineTxt(r.line) + ' '}${esc(def.l.toLowerCase())}: <b>${R.n ? `${R.hit} of ${R.n - R.push}` : 'no games'}</b>${R.avg != null && !def.yes ? ` · average <b class="num">${rsFmt(R.avg, { dec: def.dec || 1 })}</b> · median <b class="num">${rsFmt(R.med, def)}</b>` : ''}${bookPct != null ? ` · books give the ${esc(yesNo('over', 'under'))} <b class="num">${rsPctTxt(r.side === 'over' ? bookPct : 1 - bookPct)}</b>` : ''}</p></div>
    <div class="rs-tiles">${tiles}</div>
    ${deepWait ? `<p class="rs-wait">Loading per-game detail… ${p.games.slice(0, 20).filter(g => g.deep !== undefined).length}/${Math.min(20, p.games.length)} games</p>` : ''}
    ${rsChart(shown, def, r.line, r.side)}
    <p class="rs-wait">${esc(careerNote)}${def.deep ? ' · this stat needs per-game detail, so it covers the last 20 games' : ''}</p>
    <div class="rs-filters">
      ${p.sport === 'tennis' ? '' : `<label><span>Venue</span><select data-rsf="venue"><option value="all">Home and away</option><option value="home" ${r.venue === 'home' ? 'selected' : ''}>Home only</option><option value="away" ${r.venue === 'away' ? 'selected' : ''}>Away only</option></select></label>`}
      ${seasons.length > 1 ? `<label><span>Season</span><select data-rsf="season"><option value="all">All seasons</option>${seasons.map(s => `<option ${r.season === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
      ${comps.length > 1 ? `<label><span>${p.sport === 'soccer' ? 'Competition' : p.sport === 'tennis' ? 'Surface' : 'Games'}</span><select data-rsf="comp"><option value="all">All ${p.sport === 'soccer' ? 'competitions' : p.sport === 'tennis' ? 'surfaces' : 'games'}</option>${comps.map(c => `<option ${r.comp === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
      ${hasMin && minOpts.length ? `<label><span>Minutes</span><select data-rsf="minMin">${minOpts.map(m => `<option value="${m}" ${r.minMin === m ? 'selected' : ''}>${m ? `${m}+ minutes` : 'Any minutes'}</option>`).join('')}</select></label>` : ''}
      <label><span>Result</span><select data-rsf="res"><option value="all">Any result</option><option value="W" ${r.res === 'W' ? 'selected' : ''}>Wins</option>${p.sport === 'soccer' ? `<option value="D" ${r.res === 'D' ? 'selected' : ''}>Draws</option>` : ''}<option value="L" ${r.res === 'L' ? 'selected' : ''}>Losses</option></select></label>
      <label><span>Opponent (H2H)</span><select data-rsf="opp"><option value="">None</option>${p.next && !opps.some(g => rsSameOpp(g, r.opp)) && r.opp ? `<option value="${esc(r.opp)}" selected>${esc(p.next.name)} (next)</option>` : ''}${opps.map(g => `<option value="${esc(g.oppId || g.opp)}" ${rsSameOpp(g, r.opp) ? 'selected' : ''}>${esc(g.opp)}${p.next && rsSameOpp(g, r.opp) ? ' (next)' : ''}</option>`).join('')}</select></label>
    </div>
    ${rsSplits(p, def)}${p.sport === 'soccer' && p.kind !== 'team' ? rsSoccerCareer(p) : ''}${rsLog(shown, def)}`;
  return h;
}
function rsChart(games, def, line, side){
  if (!games.length) return `<div class="note">No games match these filters.</div>`;
  const gs = games.slice(0, 40).reverse();   // oldest on the left
  const vals = gs.map(def.get), max = Math.max(line * 1.25, ...vals, 1) || 1;
  const pct = v => Math.max(0, Math.min(100, v / max * 100));
  return `<div class="rs-chart" role="img" aria-label="${esc(`${def.l} in each of the last ${gs.length} games against a line of ${rsLineTxt(line)}`)}">
    ${games.length > 40 ? '<p class="rs-wait" style="margin:-14px 0 8px">The chart shows the newest 40; the table below has them all.</p>' : ''}
    <div class="rs-bars" style="--n:${gs.length}">${gs.map((g, i) => { const v = vals[i], cls = v === line ? 'push' : (side === 'over' ? v > line : v < line) ? 'hit' : 'miss';
      return `<div class="rs-b ${cls}" title="${esc(`${fmtDate(g.date, { day: 'numeric', month: 'short', year: 'numeric' })} ${g.home === false ? '@' : 'vs'} ${g.opp}: ${rsFmt(v, def)}`)}"><em class="num">${rsFmt(v, def)}</em><i style="height:${Math.max(v ? 3 : 1.5, pct(v))}%"></i>
        <span class="rs-bl">${g.oppLogo ? `<img src="${esc(g.oppLogo)}" alt="" onerror="this.remove()">` : ''}${esc((g.oppAbbr || g.opp || '').slice(0, 3))}<small>${esc(fmtDate(g.date, { day: 'numeric', month: 'numeric' }))}</small></span></div>` }).join('')}
      <div class="rs-ln" style="bottom:${pct(line)}%"><span>${def.yes ? 'Yes' : rsLineTxt(line)}</span></div></div></div>`;
}
function rsSplits(p, def){
  const r = S.rs, base = p.games.filter(g => (r.comp === 'all' || g.comp === r.comp) && (!r.minMin || (g.min ?? 0) >= r.minMin) && (!def.deep || g.deep !== undefined) && def.get(g) != null);
  const rows = [['All games', () => true], ['Home', g => g.home === true], ['Away', g => g.home === false], ['Wins', g => g.res === 'W'], ...(p.sport === 'soccer' ? [['Draws', g => g.res === 'D']] : []), ['Losses', g => g.res === 'L']];
  if (r.comp === 'all') for (const c of [...new Set(p.games.map(g => g.comp).filter(Boolean))]) rows.push([c, g => g.comp === c]);
  if (p.sport === 'tennis') for (const l of [...new Set(p.games.map(g => g.level).filter(Boolean))]) rows.push([l, g => g.level === l]);
  if (!def.deep) for (const s of [...new Set(p.games.map(g => g.season))]) rows.push([`Season ${s}`, g => g.season === s]);
  const body = rows.map(([l, f]) => { const R = rsRate(base.filter(f), def, r.line, r.side); if (!R.n) return '';
    return `<tr><td class="rs-tl">${esc(l)}</td><td>${R.n}</td><td>${rsFmt(R.avg, { dec: def.dec || 1 })}</td><td>${rsFmt(R.med, def)}</td><td><span class="rs-pc ${rsPctCls(R.pct)}">${rsPctTxt(R.pct)}</span> <small>${R.hit}/${R.n - R.push}</small></td></tr>` }).join('');
  return `<div class="sub-h"><h5>Splits</h5><small>${def.deep ? 'Last 20 games with per-game detail' : p.sport === 'soccer' ? 'Last ' + p.games.length + ' matches' : 'Whole career loaded so far'}</small></div><div class="tbl-wrap"><table class="ctable rs-t"><thead><tr><th style="text-align:left">Split</th><th>GP</th><th>Avg</th><th>Med</th><th>${def.yes ? (r.side === 'over' ? 'Yes' : 'No') : `${r.side === 'over' ? 'Over' : 'Under'} ${rsLineTxt(r.line)}`}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
// FotMob only lists ~70 matches one by one, so the soccer career is season totals
function rsSoccerCareer(p){
  if (!p.career?.length) return '';
  const f = (a, n) => a != null && n ? (a / n).toFixed(2) : '–';
  return `<div class="sub-h"><h5>Career by season</h5><small>Club seasons, all competitions</small></div><div class="tbl-wrap"><table class="ctable rs-t"><thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Team</th><th>Apps</th><th>Goals</th><th>Per game</th><th>Assists</th><th>Per game</th><th>Rating</th></tr></thead><tbody>
    ${p.career.map(s => `<tr><td class="rs-tl">${esc(s.season)}</td><td class="rs-tl">${esc(s.team || '')}</td><td>${s.apps ?? '–'}</td><td>${s.goals ?? '–'}</td><td>${f(s.goals, s.apps)}</td><td>${s.assists ?? '–'}</td><td>${f(s.assists, s.apps)}</td><td>${s.rating ? (+s.rating).toFixed(2) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
}
function rsLog(games, def){
  const r = S.rs, list = games.slice(0, r.logAll ? 9999 : 60), mins = games.some(g => g.min != null);
  return `<div class="sub-h"><h5>Game log</h5><small>${games.length} game${games.length === 1 ? '' : 's'}</small></div><div class="tbl-wrap"><table class="ctable rs-t"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Opponent</th><th>Result</th>${mins ? '<th>Min</th>' : ''}<th>${esc(def.l)}</th><th></th></tr></thead><tbody>
    ${list.map(g => { const v = def.get(g), cls = v === r.line ? 'push' : (r.side === 'over' ? v > r.line : v < r.line) ? 'hit' : 'miss';
      return `<tr><td class="rs-tl">${esc(fmtDate(g.date, { day: 'numeric', month: 'short', year: '2-digit' }))}</td><td class="rs-tl">${g.home === false ? '@ ' : g.home ? 'vs ' : ''}${g.oppLogo ? `<img src="${esc(g.oppLogo)}" alt="" onerror="this.remove()">` : ''}${esc(g.opp)}<small class="rs-comp">${esc(g.tn ? `${g.tn} · ${g.comp}` : g.comp)}</small></td>
        <td>${g.res ? `<span class="res ${g.res}">${g.res}</span>` : ''} ${esc(g.score)}</td>${mins ? `<td>${g.min ?? ''}</td>` : ''}<td><b class="num">${def.yes ? (v ? 'Yes' : 'No') : rsFmt(v, def)}</b></td><td><span class="rs-dot ${cls}" aria-label="${cls}">${cls === 'hit' ? '✓' : cls === 'push' ? '=' : '✗'}</span></td></tr>` }).join('')}</tbody></table></div>
    ${games.length > list.length ? `<button class="btn ghost" data-rs="logall" style="margin-top:10px">Show all ${games.length} games</button>` : ''}`;
}

/* ---------- sportsbook boards for the games the app has loaded ---------- */
const rsBkKey = (sport, e) => sport === 'soccer' || sport === 'nfl' ? bkKey(e) : `${sport}:${e.id}`;
function rsBoardEvents(sport){
  const soon = Date.now() + (sport === 'nfl' ? 8 : 2) * 864e5;
  return rsEvents(sport).filter(e => e.state === 'pre' && e.date <= soon && e.src !== 'tsdb').filter((e, i, a) => a.findIndex(x => x.id === e.id) === i).sort((a, b) => a.date - b.date).slice(0, 16);
}
function rsBookLoad(sport, e){
  if (sport === 'soccer' || sport === 'nfl') return bkLoad(e) || Promise.resolve();
  if (sport === 'nhl' || sport === 'tennis') return Promise.resolve();
  const k = rsBkKey(sport, e), have = S.books.get(k); if (have && Date.now() - have.at < 30000) return Promise.resolve();
  const q = new URLSearchParams({ sport: sport === 'nba' ? 'basketball' : 'baseball', lg: e.lg, id: sport === 'nba' && /^\d+$/.test(e.id) ? e.id : '', home: e.home.full || e.home.name, away: e.away.full || e.away.name,
    date: e.date.toISOString(), kx: '', espn: sport === 'nba' ? `basketball/${e.lg}` : '' });
  return getJSON(`/api/odds/board?${q}`).then(d => { d.at = Date.now(); S.books.set(k, d) }).catch(() => {});
}

/* ---------- today's player props ---------- */
async function rsBoardLoad(force){
  const r = S.rs, sport = r.sport, b = r.board = { sport, loading: true, rows: [], events: rsBoardEvents(sport), done: 0 };
  rsRender();
  await Promise.all([rsDfsLoad(sport, force), ...b.events.map(e => rsBookLoad(sport, e).catch(() => {}).then(() => { b.done++; if (S.rs.board === b) rsSoon() }))]);
  // one row per player and stat, with every source's line on it
  const rows = new Map(), add = (player, team, stat, o, extra) => { const k = normName(player) + '|' + stat; let row = rows.get(k);
    if (!row) rows.set(k, row = { player, team, stat, offers: [], st: 'wait' }); row.offers.push(o); if (!row.team && team) row.team = team; Object.assign(row, extra) };
  for (const x of r.dfs[sport]?.lines || []) { const stat = rsStatKey(sport, x.stat); if (stat) add(x.player, x.team, stat, { book: x.book, line: x.line, kind: x.kind, overMult: x.overMult, underMult: x.underMult, pOver: x.pOver }, x.opp ? { opp: x.opp } : {}) }
  for (const pr of rsBookProps(sport)) for (const o of pr.offers) add(pr.player, '', pr.stat, o, { e: pr.e });
  for (const row of rows.values()) {
    const std = row.offers.find(o => o.book === 'prizepicks' && (!o.kind || o.kind === 'standard'));
    const count = new Map(); for (const o of row.offers) count.set(o.line, (count.get(o.line) || 0) + 1);
    row.line = std ? std.line : [...count].sort((a, c) => c[1] - a[1])[0][0]; row.pct = rsBookPct(row.offers, row.line);
  }
  b.rows = [...rows.values()];
  b.loading = false; rsRender();
  rsBoardAnalyse(b);
}
function rsBoardVisible(b){
  const r = S.rs, q = normName(r.bq);
  return b.rows.filter(x => (r.bmk === 'all' || x.stat === r.bmk) && (!q || normName(x.player).includes(q) || normName(x.team || '').includes(q)));
}
// hit rates for the rows on screen, three players at a time; one load per player serves all their stats
async function rsBoardAnalyse(b){
  if (b.running) return; b.running = true;
  const worker = async () => { for (;;) {
    if (S.rs.board !== b) return;
    const row = rsBoardVisible(b).slice(0, 80).find(x => x.st === 'wait'); if (!row) return;
    row.st = 'load';
    try {
      const o = await rsFindPlayer(b.sport, row.player, row.team); if (!o) throw 0;
      const p = await rsLoad({ ...o, sport: b.sport }), def = rsStatDef(b.sport, row.stat);
      row.p = p;
      if (def.deep && b.sport === 'soccer') await rsLoadDeep(p, 10);
      if (def.deep && b.sport !== 'soccer') { row.st = 'deep'; continue }
      const gs = p.games.filter(g => def.get(g) != null), R = n => rsRate(gs.slice(0, n), def, row.line, 'over');
      Object.assign(row, { l5: R(5), l10: R(10), l20: R(20), avg: rsAvg(gs.slice(0, 10).map(def.get)), st: 'ok' });
    } catch { row.st = 'err' }
    if (S.rs.open && S.rs.tab === 'board') rsSoon() } };
  await Promise.all([worker(), worker(), worker()]);
  b.running = false; if (S.rs.open && S.rs.tab === 'board') rsRender();
}
function rsDfsNote(sport){
  const e = S.rs.dfs[sport]?.errors || {};
  if (e.server) return 'PrizePicks and Sleeper need the updated server: stop it and run python3 server.py again.';
  return Object.entries(e).map(([k, v]) => `${RS_BOOK[k] || k} didn't answer (${v}).`).join(' ');
}
function rsBoardHTML(){
  const r = S.rs, b = r.board?.sport === r.sport ? r.board : null, G = r.sport === 'soccer' ? 'matches' : 'games';
  if (!b) { const n = rsBoardEvents(r.sport).length;
    return `<div class="rs-empty"><strong>Rank today's ${esc(rsSportName(r.sport))} props by hit rate</strong>Pulls every player line from PrizePicks and Sleeper${n ? `, plus FanDuel, DraftKings, Kalshi and Polymarket props for the next ${n} ${G} Floodlight has loaded,` : ''} then checks each player's last 5, 10 and 20 games against the line.
      ${n ? '' : `<br><small>Sportsbook props come from the fixtures Floodlight has loaded; open the ${rsScreen(r.sport)} screen once to add them.</small>`}
      <div style="margin-top:14px"><button class="btn" data-rs="board">Load props</button></div></div>` }
  if (b.loading) return `<p class="rs-wait">Loading lines… ${b.done}/${b.events.length} ${G}${r.dfs[r.sport]?.loading ? ' · PrizePicks and Sleeper' : ''}</p><div class="skel" style="height:260px"></div>`;
  const note = rsDfsNote(r.sport);
  if (!b.rows.length) return `<div class="note">No player lines posted yet. ${esc(note)} <button class="linkbtn" data-rs="board">Try again</button></div>`;
  const mk = [...new Set(b.rows.map(x => x.stat))].map(k => [k, rsStatDef(r.sport, k)?.l || k]);
  const sortKey = { l5: x => x.l5?.pct, l10: x => x.l10?.pct, l20: x => x.l20?.pct, avg: x => x.avg == null ? null : x.avg - x.line, book: x => x.pct }[r.bsort];
  const vis = rsBoardVisible(b), rows = vis.slice().sort((a, c) => (sortKey(c) ?? -9) - (sortKey(a) ?? -9));
  const todo = vis.slice(0, 80), done = todo.filter(x => x.st !== 'wait' && x.st !== 'load').length;
  const th = (k, l) => `<th><button class="rs-sort" data-rs="bsort" data-to="${k}" aria-pressed="${r.bsort === k}">${l}${r.bsort === k ? ' ▾' : ''}</button></th>`;
  return `<div class="rs-bbar"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="rsBq" type="search" placeholder="Filter by player or team" value="${esc(r.bq)}" aria-label="Filter by player or team"></label></div>
    <div class="rs-stats" role="group" aria-label="Market"><button class="qf" data-rs="bmk" data-to="all" aria-pressed="${r.bmk === 'all'}">All markets · ${b.rows.length}</button>${mk.map(([k, l]) => `<button class="qf" data-rs="bmk" data-to="${k}" aria-pressed="${r.bmk === k}">${esc(l)}</button>`).join('')}</div>
    <p class="rs-wait">${done < todo.length ? `Checking hit rates… ${done}/${todo.length}` : `${vis.length} props`} · hit rates are for the over at the PrizePicks line (or the most common line) · <button class="linkbtn" data-rs="board">Refresh</button>${note ? ` · ${esc(note)}` : ''}</p>
    <div class="tbl-wrap"><table class="ctable rs-t rs-board"><thead><tr><th style="text-align:left">Player</th><th style="text-align:left">Prop</th><th style="text-align:left">Lines</th>${th('book', 'Books %')}${th('l5', 'L5')}${th('l10', 'L10')}${th('l20', 'L20')}${th('avg', 'Avg L10')}</tr></thead><tbody>
    ${rows.slice(0, 200).map(x => { const i = b.rows.indexOf(x), c = R => R ? `<span class="rs-pc ${rsPctCls(R.pct)}">${rsPctTxt(R.pct)}</span>` : x.st === 'err' ? '–' : x.st === 'deep' ? '<small>tap</small>' : '<span class="rs-dots">···</span>';
      const sub = x.e ? `${x.e.home.name} v ${x.e.away.name} · ${fmtDate(x.e.date, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : [x.team, x.opp ? 'vs ' + x.opp : ''].filter(Boolean).join(' · ');
      return `<tr data-rs="brow" data-i="${i}" tabindex="0"><td class="rs-tl"><b>${esc(x.p?.name || x.player)}</b><small class="rs-comp">${esc(sub)}</small></td>
        <td class="rs-tl">${esc(rsLineTxt(x.line))} ${esc(rsStatDef(r.sport, x.stat)?.l || x.stat)}</td><td class="rs-tl rs-lns">${x.offers.slice(0, 6).map(o => `<span class="rs-lchip sm${o.line === x.line ? ' on' : ''}"><b>${esc(RS_BK[o.book] || o.book)}</b> ${rsLineTxt(o.line)}${o.book === 'sleeper' && o.overMult ? ` <small>×${o.overMult}</small>` : o.over?.am != null ? ` <small>${rsAm(o.over)}</small>` : o.kind && o.kind !== 'standard' ? ` <small>${esc(o.kind)}</small>` : ''}</span>`).join('')}</td>
        <td>${x.pct != null ? `<span class="rs-pc ${rsPctCls(x.pct)}">${rsPctTxt(x.pct)}</span>` : '–'}</td><td>${c(x.l5)}</td><td>${c(x.l10)}</td><td>${c(x.l20)}</td>
        <td class="num">${x.avg != null ? x.avg.toFixed(1) : x.st === 'err' ? '<small>not found</small>' : ''}</td></tr>` }).join('')}</tbody></table></div>
    <p class="srcnote">PP = PrizePicks (goblin and demon are its easier and harder lines), SL = Sleeper (×payout on the over), FD = FanDuel, DK = DraftKings, KX = Kalshi, PM = Polymarket. "Books %" is the chance the books give the over, with their margin taken out. Fanatics blocks outside apps, so it isn't included. Tap a prop to open the full research.</p>`;
}

/* ---------- team props: moneyline, spread and total against each team's recent results ---------- */
const rsTeamRes = new Map();
// a team's finished games, newest first: [{for, against, home, date}]
function rsTeamResults(sport, e, side){
  const t = e[side], k = sport + '|' + (t.fmId || t.id || t.full || t.name);
  if (rsTeamRes.has(k)) return rsTeamRes.get(k);
  let pr;
  if (sport === 'soccer') pr = getJSON(`/api/fm/team?${t.fmId ? 'id=' + t.fmId + '&' : ''}name=${encodeURIComponent(t.full || t.name)}`).then(d => (d.fixtures || []).filter(f => f.finished && f.score).map(f => {
    const home = String(f.home?.id) === String(d.id); return { for: f.score[home ? 0 : 1], against: f.score[home ? 1 : 0], home, date: new Date(f.utc) } }));
  else if (sport === 'mlb') { const y = new Date().getFullYear();
    pr = Promise.all([y, y - 1].map(yr => cj(`${SAPI}/schedule?sportId=1&teamId=${t.id}&season=${yr}&gameType=R,F,D,L,W`).catch(() => ({})))).then(ds => ds.flatMap(d => (d.dates || []).flatMap(x => x.games || []))
      .filter(g => g.status?.abstractGameState === 'Final').map(g => { const home = String(g.teams.home.team.id) === String(t.id), us = home ? g.teams.home : g.teams.away, them = home ? g.teams.away : g.teams.home;
        return { for: us.score, against: them.score, home, date: new Date(g.gameDate) } })) }
  else { const path = sport === 'nfl' ? 'football/nfl' : sport === 'nhl' ? 'hockey/nhl' : `basketball/${e.lg || 'nba'}`, cur = rsCurSeason(sport);
    pr = Promise.all([cur, cur - 1].map(y => cj(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${t.id}/schedule?season=${y}`).catch(() => ({})))).then(ds => ds.flatMap(d => d.events || [])
      .filter(ev => ev.competitions?.[0]?.status?.type?.completed).map(ev => { const c = ev.competitions[0].competitors || [], us = c.find(x => String(x.id) === String(t.id)), them = c.find(x => x !== us);
        const sc = x => rsNum(x?.score?.value ?? x?.score?.displayValue ?? x?.score); return us && them ? { for: sc(us), against: sc(them), home: us.homeAway === 'home', date: new Date(ev.date) } : null }).filter(Boolean)) }
  pr = pr.then(xs => xs.filter(x => x.for != null && x.against != null).sort((a, b) => b.date - a.date)).catch(() => []);
  rsTeamRes.set(k, pr); return pr;
}
async function rsTeamLoad(){
  const r = S.rs, sport = r.sport, t = r.team = { sport, loading: true, events: rsBoardEvents(sport), res: {} };
  rsRender();
  await Promise.all(t.events.map(async e => { await rsBookLoad(sport, e).catch(() => {}); const [h, a] = await Promise.all([rsTeamResults(sport, e, 'home'), rsTeamResults(sport, e, 'away')]); t.res[e.id] = { h, a }; if (S.rs.team === t) rsSoon() }));
  t.loading = false; rsRender();
}
function rsTeamHTML(){
  const r = S.rs, t = r.team?.sport === r.sport ? r.team : null, n = rsBoardEvents(r.sport).length;
  if (!t) return `<div class="rs-empty"><strong>Team props: moneyline, spread and total</strong>${n ? `The best moneyline, spread and total for the next ${n} ${r.sport === 'soccer' ? 'matches' : 'games'}, next to how often each team has won, covered that spread and gone over that total in its last 10 games.` : `No upcoming games are loaded yet. Open the ${rsScreen(r.sport)} screen once so Floodlight loads the fixtures, then come back.`}
    ${n ? `<div style="margin-top:14px"><button class="btn" data-rs="teamload">Load team props</button></div>` : ''}</div>`;
  if (t.loading && !Object.keys(t.res).length) return `<p class="rs-wait">Loading lines and team results…</p><div class="skel" style="height:260px"></div>`;
  const val = x => x.am > 0 ? x.am : 1e4 / -x.am;
  const best = (offers, k) => (offers || []).filter(o => o[k]?.am != null).sort((a, b) => val(b[k]) - val(a[k]))[0];
  const nearEven = (list, k) => list?.length ? list.slice().sort((a, b) => Math.min(...a.offers.map(o => Math.abs((o[k]?.p ?? .5) - .5))) - Math.min(...b.offers.map(o => Math.abs((o[k]?.p ?? .5) - .5))))[0] : null;
  const rate = (xs, f) => { const L = xs.slice(0, 10); if (!L.length) return '–'; const h = L.filter(f).length; return `<span class="rs-pc ${rsPctCls(h / L.length)}">${h}/${L.length}</span>` };
  const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const pr = (o, k) => o ? `<b class="num">${rsAm(o[k])}</b> <small>${esc(RS_BK[o.book] || o.book)}</small>` : '–';
  const rows = t.events.map(e => {
    const d = S.books.get(rsBkKey(r.sport, e)), R = t.res[e.id] || { h: [], a: [] };
    const sp = nearEven(d?.spreads, 'home'), to = nearEven(d?.totals, 'over'), ml = d?.ml?.offers || [];
    const team = (side, res) => { const hl = sp ? (side === 'home' ? sp.homeLine : -sp.homeLine) : null;
      return `<div class="rs-tm"><img src="${esc(e[side].logo || '')}" alt="" onerror="this.remove()"><b><button class="linkbtn" data-rs="tpick" data-e="${esc(e.id)}" data-side="${side}" title="Research ${esc(e[side].full || e[side].name)}">${esc(e[side].name)}</button></b>
      <span>Moneyline ${pr(best(ml, side), side)}</span><span>Won L10 ${rate(res, x => x.for > x.against)}</span>
      ${sp ? `<span>${r.sport === 'soccer' ? 'Handicap' : 'Spread'} ${sgn(hl)} ${pr(best(sp.offers, side), side)} · covered L10 ${rate(res, x => x.for - x.against + hl > 0)}</span>` : ''}
      ${to ? `<span>Their games over ${to.line} L10 ${rate(res, x => x.for + x.against > to.line)}</span>` : ''}</div>` };
    return `<div class="rs-game"><div class="rs-gh"><span>${esc(fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</span>
        ${to ? `<span>Total ${to.line}: over ${pr(best(to.offers, 'over'), 'over')} · under ${pr(best(to.offers, 'under'), 'under')}${to.fair?.over != null ? ` · books ${rsPctTxt(to.fair.over)} over` : ''}</span>` : ''}${best(ml, 'draw') ? `<span>Draw ${pr(best(ml, 'draw'), 'draw')}</span>` : ''}</div>
      ${team('away', R.a)}${team('home', R.h)}${!d || d.error || (!ml.length && !sp && !to) ? '<p class="rs-wait">No odds posted for this game yet.</p>' : ''}</div>`;
  }).join('');
  return `<p class="rs-wait">${t.loading ? 'Still loading some games… · ' : ''}Best price across the books for each side · L10 = that team's last 10 finished games · <button class="linkbtn" data-rs="teamload">Refresh</button></p>${rows || '<div class="note">No upcoming games.</div>'}`;
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-rs]'); if (!t) return;
  if (!t.closest('#rs') && !['open', 'pp'].includes(t.dataset.rs)) return;
  ev.preventDefault(); ev.stopPropagation();
  const r = S.rs, a = t.dataset.rs, to = t.dataset.to;
  if (a === 'open') return openResearch();
  if (a === 'pp') return openResearch({ sport: t.dataset.sport, name: t.dataset.name, stat: t.dataset.stat, line: t.dataset.line != null ? +t.dataset.line : undefined });
  if (a === 'close') return closeResearch();
  if (a === 'sport') { r.sport = to; store.set('fl.rsSport', to); r.hits = []; r.q = ''; r.bmk = 'all'; rsDfsLoad(to); return rsRender() }
  if (a === 'tab') { r.tab = to; return rsRender() }
  if (a === 'pick') { const x = r.hits[+t.dataset.i]; r.hits = []; return x && rsPick({ ...x, sport: r.sport }) }
  if (a === 'cpick') { const x = r.chits?.[+t.dataset.i]; r.chits = []; r.comboAdd = false; r.cq = ''; if (!x) return rsRender();
    const main = r.p; rsRender();
    return rsLoad({ ...x, sport: r.sport }).then(q => { if (S.rs.p !== main) return; rsLoadCareer(q, rsSoon); const k = rsDef(q, r.stat) ? r.stat : rsStatsFor(q)[0]?.k; r.combo.push({ p: q, k }); rsComboLine() })
      .catch(() => toast(`Couldn't load ${x.name}`)) }
  if (a === 'addleg') { r.comboAdd = !r.comboAdd; rsRender(); return setTimeout(() => $('rsCq')?.focus(), 20) }
  if (a === 'addstat') { const k = rsStatsFor(r.p).find(s => s.k !== r.stat && !r.combo.some(c => c.p === r.p && c.k === s.k))?.k; if (k) r.combo.push({ p: r.p, k }); return rsComboLine() }
  if (a === 'rmleg') { r.combo.splice(+t.dataset.i, 1); return r.combo.length ? rsComboLine() : rsSetStat(r.stat) }
  if (a === 'clearcombo') { r.combo = []; return rsSetStat(r.stat) }
  if (a === 'browse') { if (r.browse?.open && r.browse.sport === r.sport) { r.browse.open = false; return rsRender() } return rsBrowseLoad(r.browse?.sport === r.sport ? r.browse.lg : RS_BROWSE[r.sport][0][0]) }
  if (a === 'blg') return rsBrowseLoad(to);
  if (a === 'bteam') { const x = r.browse?.list[+t.dataset.i]; if (!x) return; r.browse.open = false; return rsPick({ ...x, sport: r.sport }) }
  if (a === 'tpick') { const e = r.team?.events.find(x => String(x.id) === t.dataset.e), side = t.dataset.side; if (!e) return;
    const tm = e[side]; return rsPick({ kind: 'team', sport: r.sport, id: r.sport === 'soccer' ? (tm.fmId || '') : String(tm.id), fmId: tm.fmId, lg: e.lg, name: tm.full || tm.name, photo: tm.logo }) }
  if (a === 'recent') { const x = r.recent[+t.dataset.i]; return x && rsPick({ ...x, fmId: x.sport === 'soccer' && x.kind !== 'team' ? x.id : undefined }) }
  if (a === 'stat') return rsSetStat(to);
  if (a === 'line') { r.line = Math.round((r.line + +to) * 10) / 10; if (r.p?.kind !== 'team') r.line = Math.max(0, r.line); return rsRender() }
  if (a === 'setline') { r.line = +to; return rsRender() }
  if (a === 'side') { r.side = to; return rsRender() }
  if (a === 'range') { r.range = to; rsRender(); if (to === 'h2h' && !r.opp) $('rs').querySelector('[data-rsf="opp"]')?.focus(); return }
  if (a === 'logall') { r.logAll = true; return rsRender() }
  if (a === 'board') return rsBoardLoad(true);
  if (a === 'teamload') return rsTeamLoad();
  if (a === 'bmk') { r.bmk = to; rsRender(); return r.board && rsBoardAnalyse(r.board) }
  if (a === 'bsort') { r.bsort = to; return rsRender() }
  if (a === 'brow') { const x = r.board?.rows[+t.dataset.i]; if (!x) return;
    const go = o => rsPick({ ...o, sport: r.sport, stat: x.stat, line: x.line }).then(() => { $('rs').scrollTop = 0 });
    if (x.p) { rsCache.set(`${r.sport}:${x.p.id}`, Promise.resolve(x.p)); return go({ id: x.p.id, fmId: r.sport === 'soccer' ? x.p.id : undefined, lg: x.p.lg, name: x.p.name }) }
    return rsFindPlayer(r.sport, x.player, x.team).then(o => go(o || { name: x.player })) }
});
document.addEventListener('keydown', ev => {
  if (!S.rs.open) return;
  if (ev.key === 'Escape') { if (S.rs.hits.length || S.rs.chits?.length) { S.rs.hits = []; S.rs.chits = []; return rsPaintHits() } if (S.rs.comboAdd) { S.rs.comboAdd = false; return rsRender() } return closeResearch() }
  if (ev.key === 'Enter' && ev.target.matches?.('tr[data-rs="brow"]')) ev.target.click();
});
let rsT, rsBT;
document.addEventListener('input', ev => {
  if (ev.target.id === 'rsQ') { S.rs.q = ev.target.value; clearTimeout(rsT); rsT = setTimeout(() => rsSearch(S.rs.q), 220) }
  if (ev.target.id === 'rsBf' && S.rs.browse) { S.rs.browse.q = ev.target.value; return rsRender() }
  if (ev.target.id === 'rsCq') { S.rs.cq = ev.target.value; clearTimeout(rsT); rsT = setTimeout(() => rsSearch(S.rs.cq, true), 220) }
  if (ev.target.id === 'rsBq') { S.rs.bq = ev.target.value; clearTimeout(rsBT); rsBT = setTimeout(() => { rsRender(); S.rs.board && rsBoardAnalyse(S.rs.board) }, 250) }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'rsLine') { const v = parseFloat(t.value); if (!isNaN(v) && (v >= 0 || S.rs.p?.kind === 'team')) S.rs.line = v; return rsRender() }
  if (t.dataset?.rscombo != null) { const c = S.rs.combo[+t.dataset.rscombo]; if (c) { c.k = t.value; rsComboLine() } return }
  const f = t.dataset?.rsf; if (!f || !t.closest('#rs')) return;
  S.rs[f] = f === 'minMin' ? +t.value : t.value;
  if (f === 'opp' && t.value) S.rs.range = 'h2h';
  rsRender();
});

/* ---------- entry point in the header ---------- */
(function rsMount(){
  const host = document.querySelector('.top-in .prefwrap'); if (!host || $('rsBtn')) return;
  host.insertAdjacentHTML('beforebegin', `<button class="rs-open" id="rsBtn" data-rs="open" aria-label="Prop research: hit rates for any player"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg><span>Research</span></button>`);
})();

document.head.insertAdjacentHTML('beforeend', `<style>
.rs-open{display:flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font:700 13px/1 var(--f-body);color:var(--fg);flex:none}
.rs-open:hover{border-color:var(--fg)}.rs-open svg{width:17px;height:17px;color:var(--accent)}
@media (max-width:900px){.rs-open span{display:none}.rs-open{width:36px;padding:0;justify-content:center}}
html.rs-lock,html.rs-lock body{overflow:hidden}
.rs{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;overscroll-behavior:contain;padding-top:env(safe-area-inset-top,0px)}
.rs-in{max-width:1120px;margin:0 auto;padding:12px max(16px,env(safe-area-inset-left,0px)) calc(40px + env(safe-area-inset-bottom,0px))}
.rs-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:4px 0 10px}
.rs-top h2{margin:0;font:900 28px/1 var(--f-display);text-transform:uppercase;letter-spacing:.02em;flex:1}
.rs-x{font:700 14px/1 var(--f-body);color:var(--fg);padding:9px 12px 9px 6px;border-radius:999px}
.rs-x:hover{background:var(--surface)}
.rs-top .seg,.rs-ou{margin:0}.rs-sp button{padding:7px 14px}.rs-ou button{padding:9px 16px}
.rs-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:14px;overflow-x:auto;scrollbar-width:none}
.rs-tabs button{padding:10px 14px;font:700 13.5px/1 var(--f-body);color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.rs-tabs button[aria-selected="true"]{color:var(--fg);border-color:var(--accent)}
.rs-search{position:relative;max-width:560px}.rs-search .search,.rs-bbar .search{display:block;position:relative;max-width:none;margin:0}
.rs-bbar{max-width:420px;margin-bottom:10px}
.rs-hits{position:absolute;left:0;right:0;top:42px;z-index:5;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);max-height:380px;overflow:auto;padding:4px}
.rs-hit{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;text-align:left}
.rs-hit:hover,.rs-hit:focus-visible{background:var(--surface-2)}
.rs-hit img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
.rs-hit b{display:block;font-size:14px}.rs-hit small{color:var(--muted);font-size:12px}
.rs-none{padding:14px;color:var(--muted)}
.rs-recent{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px}
.rs-recent>span{font:600 10px/1 var(--f-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-right:4px}
.rs-recent .qf{display:inline-flex;align-items:center;gap:6px;padding-left:4px}
.rs-recent img{width:22px;height:22px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
.rs-empty{margin-top:18px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px;color:var(--muted);line-height:1.55}
.rs-empty strong{display:block;color:var(--fg);font:800 20px/1.2 var(--f-display);text-transform:uppercase;letter-spacing:.02em;margin-bottom:6px}
.rs-ph{display:flex;gap:14px;align-items:center;margin:18px 0 12px}
.rs-ph .face{width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--surface-2);border:1px solid var(--line);flex:none}
.rs-ph h3{margin:0;font:900 28px/1.05 var(--f-display);text-transform:uppercase;letter-spacing:.01em}
.rs-ph p{margin:4px 0 0;color:var(--muted);font-size:13px;display:flex;align-items:center;gap:6px}
.rs-ph p img{width:18px;height:18px;object-fit:contain}
.rs-next b{color:var(--fg)}
.rs-stats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 0 8px}
.rs-stats .qf{flex:none}
.rs-line{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:6px 0 12px}
.rs-lc{display:flex;align-items:center;gap:6px}
.rs-lc>span{font:600 10px/1 var(--f-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.rs-lc .icon-btn{font:700 18px/1 var(--f-body);color:var(--fg)}
.rs-lc input{width:72px;height:36px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--fg);text-align:center;font:800 18px/1 var(--f-display)}
.rs-lines{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.rs-lchip{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font:600 12.5px/1 var(--f-body);color:var(--fg);white-space:nowrap}
.rs-lchip b{font:800 10px/1 var(--f-mono);letter-spacing:.06em;color:var(--muted)}.rs-lchip small{color:var(--muted);font-size:11px}
.rs-lchip.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.rs-lchip.sm{height:24px;padding:0 7px;font-size:11.5px;margin:1px 3px 1px 0}
button.rs-lchip:hover{border-color:var(--fg)}
.rs-t td.rs-lns{white-space:normal;min-width:180px;max-width:320px}
.rs-sum{margin:0;color:var(--muted);font-size:13px;flex-basis:100%}.rs-sum b{color:var(--fg)}
.rs-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
@media (max-width:640px){.rs-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
.rs-tile{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:10px 8px;text-align:center;display:flex;flex-direction:column;gap:3px;min-width:0}
.rs-tile span{font:600 10px/1.2 var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-tile b{font:800 26px/1 var(--f-display)}
.rs-tile small{color:var(--muted);font-size:11px}
.rs-tile[aria-pressed="true"]{border-color:var(--fg);box-shadow:inset 0 0 0 1px var(--fg)}
.rs-tile.hi b,.rs-pc.hi{color:var(--win)}.rs-tile.ok b,.rs-pc.ok{color:color-mix(in oklab,var(--win) 70%,var(--fg))}
.rs-tile.lo b,.rs-pc.lo{color:var(--loss)}.rs-tile.meh b,.rs-pc.meh{color:color-mix(in oklab,var(--loss) 70%,var(--fg))}
.rs-tile.hi{background:color-mix(in oklab,var(--win) 9%,var(--surface))}.rs-tile.lo{background:color-mix(in oklab,var(--loss) 8%,var(--surface))}
.rs-pc{font-weight:800}
.rs-wait{color:var(--muted);font-size:12.5px;margin:10px 0}
.rs-chart{margin:14px 0 6px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:26px 12px 8px}
.rs-bars{position:relative;height:210px;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:clamp(2px,1vw,8px);align-items:end;margin-bottom:38px}
.rs-b{position:relative;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}
.rs-b i{display:block;width:100%;max-width:38px;border-radius:6px 6px 2px 2px;background:var(--loss)}
.rs-b.hit i{background:var(--win)}.rs-b.push i{background:var(--draw)}
.rs-b em{font:700 11px/1 var(--f-body);font-style:normal;margin-bottom:3px;color:var(--fg)}
.rs-bl{position:absolute;top:100%;margin-top:5px;display:flex;flex-direction:column;align-items:center;gap:2px;font:600 9.5px/1 var(--f-mono);color:var(--muted);white-space:nowrap}
.rs-bl img{width:16px;height:16px;object-fit:contain}.rs-bl small{font-size:9px}
.rs-bars[style*="--n:2"] .rs-bl small,.rs-bars[style*="--n:3"] .rs-bl small{display:none}
.rs-ln{position:absolute;left:0;right:0;border-top:2px dashed var(--fg);opacity:.75;pointer-events:none}
.rs-ln span{position:absolute;right:0;top:-20px;background:var(--fg);color:var(--bg);font:800 11px/1 var(--f-body);padding:3px 6px;border-radius:6px}
.rs-filters{display:flex;flex-wrap:wrap;gap:8px 14px;margin:14px 0 4px}
.rs-filters label{display:flex;flex-direction:column;gap:4px;font:600 10px/1 var(--f-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.rs-filters select{height:34px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:500 13px/1 var(--f-body);padding:0 8px;letter-spacing:0;text-transform:none;max-width:220px}
.rs-t td,.rs-t th{white-space:nowrap}.rs-t td.rs-tl,.rs-t th:first-child{text-align:left}.rs-t td.rs-tl img{width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:5px}
.rs-comp{display:block;color:var(--muted);font-size:11px;font-weight:400}
.rs-dot{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;font:800 11px/1 var(--f-body);color:#fff;background:var(--loss)}
.rs-dot.hit{background:var(--win)}.rs-dot.push{background:var(--draw)}
.rs-board tbody tr{cursor:pointer}.rs-board tbody tr:hover td{background:var(--surface-2)}
.rs-sort{font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit}
.rs-sort[aria-pressed="true"]{color:var(--fg)}
.rs-dots{color:var(--muted);animation:pulse 1s infinite}
.rs-game{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-bottom:10px}
.rs-gh{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted);margin-bottom:8px}.rs-gh b{color:var(--fg)}
.rs-tm{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:8px 0;border-top:1px solid var(--line);font-size:13px}
.rs-tm img{width:22px;height:22px;object-fit:contain}.rs-tm>b{min-width:130px;font-size:14px}.rs-tm small{color:var(--muted)}
.rs-rg{margin-top:24px}
.rs-bbtn{display:inline-block;margin:8px 0 2px;font-size:13px}
.rs-browse{margin:6px 0 10px}.rs-bf{display:block;max-width:360px;margin:4px 0 8px}
.rs-tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px;max-height:380px;overflow:auto;padding:4px;border:1px solid var(--line, rgba(127,127,127,.2));border-radius:12px;background:var(--surface)}
.rs-hh{font:600 10px/1 var(--f-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);padding:10px 10px 4px}
.rs-ph.team .face{border-radius:12px;object-fit:contain;padding:6px;background:var(--surface)}
.rs-combo{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:2px 0 10px}
.rs-cl{font:600 10px/1 var(--f-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.rs-combo .qf{min-height:30px;font-size:12px;padding:0 11px}
.rs-leg{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 10px;border-radius:999px;background:var(--surface);border:1px solid var(--accent);font-size:12.5px}
.rs-leg img{width:22px;height:22px;border-radius:50%;object-fit:cover}
.rs-leg select{border:0;background:transparent;color:var(--fg);font:600 12.5px/1 var(--f-body);max-width:170px}
.rs-leg button{width:22px;height:22px;border-radius:50%;color:var(--muted)}.rs-leg button:hover{background:var(--surface-2);color:var(--fg)}
.rs-csearch{flex-basis:100%;max-width:420px}
@media (max-width:520px){.rs-ph h3{font-size:23px}.rs-ph .face{width:58px;height:58px}.rs-tile b{font-size:22px}.rs-bars{height:170px}.rs-b em{font-size:9.5px}}
</style>`);
