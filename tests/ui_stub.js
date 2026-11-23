// Stand-in ESPN and outside feeds for the browser tests (tests/ui_a11y.test.js). Everything outside localhost is answered here,
// so the tests run without the network and always see the same games: a live NBA game, an upcoming NBA game, a final, two NFL
// games and a live NHL game, plus one NBA player (LeBron James, 1966).
const now = Date.now(), H = 36e5;
const team = (id, name, short, abbr, color) => ({ id, displayName: name, shortDisplayName: short, abbreviation: abbr, color, logo: '' });
const T = {
  lal: team('13', 'Los Angeles Lakers', 'Lakers', 'LAL', '552583'), bos: team('2', 'Boston Celtics', 'Celtics', 'BOS', '007A33'),
  min: team('16', 'Minnesota Timberwolves', 'Timberwolves', 'MIN', '0C2340'), mem: team('29', 'Memphis Grizzlies', 'Grizzlies', 'MEM', '5D76A9'),
  den: team('7', 'Denver Nuggets', 'Nuggets', 'DEN', '0E2240'), phx: team('21', 'Phoenix Suns', 'Suns', 'PHX', '1D1160'),
  phi: team('21', 'Philadelphia Eagles', 'Eagles', 'PHI', '004C54'), lv: team('13', 'Las Vegas Raiders', 'Raiders', 'LV', '000000'),
  kc: team('12', 'Kansas City Chiefs', 'Chiefs', 'KC', 'E31837'), buf: team('2', 'Buffalo Bills', 'Bills', 'BUF', '00338D'),
  nyr: team('13', 'New York Rangers', 'Rangers', 'NYR', '0038A8'), bosb: team('1', 'Boston Bruins', 'Bruins', 'BOS', 'FFB81C'),
};
const comp = (id, a, b, state, sa, sb, t, detail, extra = {}) => ({ id, date: new Date(t).toISOString(), name: `${a.displayName} at ${b.displayName}`,
  competitions: [{ id, date: new Date(t).toISOString(), venue: { fullName: 'Stand-in Arena' }, broadcasts: extra.tv ? [{ market: 'national', names: extra.tv }] : [],
    competitors: [{ homeAway: 'home', team: b, score: state === 'pre' ? '' : String(sb), records: [{ summary: '10-5' }], winner: state === 'post' && sb > sa },
                  { homeAway: 'away', team: a, score: state === 'pre' ? '' : String(sa), records: [{ summary: '9-6' }], winner: state === 'post' && sa > sb }],
    status: { type: { state, completed: state === 'post', shortDetail: detail, detail, description: state === 'in' ? 'In Progress' : state === 'post' ? 'Final' : 'Scheduled' } } }] });
const BOARD = {
  'basketball/nba': [comp('401001', T.lal, T.bos, 'in', 88, 90, now - H, 'Q4 4:12', { tv: ['ESPN'] }), comp('401002', T.min, T.mem, 'pre', 0, 0, now + 2 * H, '7:30 PM', { tv: ['TNT'] }),
    comp('401003', T.den, T.phx, 'post', 110, 101, now - 4 * H, 'Final')],
  'football/nfl': [comp('402001', T.lv, T.phi, 'pre', 0, 0, now + 3 * H, '1:00 PM', { tv: ['FOX'] }), comp('402002', T.buf, T.kc, 'in', 17, 20, now - 2 * H, '3rd 8:01', { tv: ['CBS'] })],
  'hockey/nhl': [comp('403001', T.nyr, T.bosb, 'in', 2, 2, now - H, '3rd 5:00', { tv: ['ESPN+'] })],
};
const summary = (sport, id) => {
  const ev = Object.values(BOARD).flat().find(e => e.id === id); if (!ev) return null;
  const c = ev.competitions[0];
  const plays = c.status.type.state === 'pre' ? [] : [
    { id: '1', text: 'Jump ball', period: { number: 1 }, clock: { displayValue: '12:00' }, homeScore: 0, awayScore: 0, type: { text: 'Jumpball' } },
    { id: '2', text: 'LeBron James makes 2-foot layup', period: { number: 1 }, clock: { displayValue: '11:30' }, homeScore: 0, awayScore: 2, scoringPlay: true, team: { id: c.competitors[1].team.id } },
    { id: '3', text: 'Jayson Tatum makes three', period: { number: 1 }, clock: { displayValue: '11:00' }, homeScore: 3, awayScore: 2, scoringPlay: true, team: { id: c.competitors[0].team.id } },
    { id: '4', text: 'End of 1st quarter', period: { number: 1 }, clock: { displayValue: '0:00' }, homeScore: 30, awayScore: 28, type: { text: 'End Period' } },
    { id: '5', text: 'Austin Reaves makes jumper', period: { number: 4 }, clock: { displayValue: '4:12' }, homeScore: 90, awayScore: 88, scoringPlay: true, team: { id: c.competitors[1].team.id } }];
  return { header: { league: { slug: 'nba' }, competitions: [{ date: c.date, status: c.status, competitors: c.competitors.map(x => ({ ...x, linescores: c.status.type.state === 'pre' ? [] : [{ displayValue: '30' }, { displayValue: '20' }, { displayValue: '22' }, { displayValue: '18' }] })) }] },
    plays, broadcasts: [], gameInfo: { venue: { fullName: 'Stand-in Arena' }, attendance: 18000 },
    lastFiveGames: c.competitors.map(x => ({ team: { id: x.team.id }, events: [1, 2, 3, 4, 5].map(i => ({ gameResult: i % 2 ? 'W' : 'L', opponent: { abbreviation: 'OPP' }, score: '101-99', atVs: 'vs', gameDate: new Date(now - i * 864e5).toISOString() })) })),
    leaders: c.competitors.map(x => ({ team: { id: x.team.id }, leaders: [{ displayName: 'Points', leaders: [{ athlete: { displayName: 'Star Player' }, displayValue: '28' }] }] })),
    boxscore: { teams: c.competitors.map(x => ({ team: { id: x.team.id }, statistics: [{ name: 'fg', label: 'FG%', displayValue: '48.1' }, { name: 'reb', label: 'Rebounds', displayValue: '40' }] })) } };
};
const athlete = { athlete: { id: '1966', displayName: 'LeBron James', firstName: 'LeBron', lastName: 'James', jersey: '23', position: { abbreviation: 'F', displayName: 'Forward' },
  team: { id: '13', displayName: 'Los Angeles Lakers', abbreviation: 'LAL', color: '552583' }, headshot: { href: '' }, displayHeight: "6' 9\"", displayWeight: '250 lbs', age: 41, status: { name: 'Active' } } };
const stats = { categories: [{ name: 'averages', labels: ['GP', 'MIN', 'PTS', 'REB', 'AST'], names: ['gamesPlayed', 'avgMinutes', 'avgPoints', 'avgRebounds', 'avgAssists'],
  statistics: [2024, 2025, 2026].map(y => ({ season: { year: y, displayName: `${y - 1}-${String(y).slice(2)}` }, stats: ['70', '35.1', String(24 + y % 3), '7.5', '8.1'] })) }] };
function handle(url) {
  const u = new URL(url), p = u.pathname;
  let m;
  if ((m = /sports\/([a-z-]+\/[a-z.\-_]+)\/scoreboard/.exec(p))) return { events: BOARD[m[1]] || [], leagues: [{ abbreviation: m[1].split('/')[1].toUpperCase() }] };
  if ((m = /sports\/([a-z-]+)\/([a-z.\-_]+)\/summary/.exec(p))) return summary(m[1], u.searchParams.get('event')) || 404;
  if (/athletes\/\d+\/stats/.test(p)) return stats;
  if (/athletes\/\d+\/(gamelog|splits|overview)/.test(p)) return {};
  if (/athletes\/\d+$/.test(p)) return athlete;
  if (/rankings/.test(p)) return { rankings: [] };
  if (/\.(png|jpg|webp|svg)$/.test(p) || /image|logo|headshot/.test(u.host + p)) return 'img';
  return {};
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
async function stub(ctx) {
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, r => { const x = handle(r.request().url());
    if (x === 404) return r.fulfill({ status: 404, body: '{}' });
    if (x === 'img') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(x) }) });
}
module.exports = { stub, BOARD };
