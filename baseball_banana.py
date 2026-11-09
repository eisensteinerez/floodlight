"""Banana Ball (Savannah Bananas and the Banana Ball Championship League) from the league's own stats site
(bananaball.com/stats, served by banana-stats-pages-seven.vercel.app; images from stats.bananaball.com).

Banana Ball scores by points: each inning won is worth one point, so the standings and the score shown are points,
with runs alongside.

  /api/bsb/banana/seasons                       every season (World Tour, BBCL playoffs, all-star games...)
  /api/bsb/banana/games?from=YYYY-MM-DD&to=...  games in a date range
  /api/bsb/banana/standings?season=             table for a season (the current World Tour by default)
  /api/bsb/banana/players?season=&group=        every player's hitting or pitching line, in MLB StatsAPI's names
"""
import datetime
import json
import re
import threading
import time
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
API = "https://banana-stats-pages-seven.vercel.app/api/"
ASSET = "https://stats.bananaball.com/assets/"
_cache, _lock = {}, threading.Lock()


def _get(path, ttl):
    now = time.time()
    with _lock:
        hit = _cache.get(path)
        if hit and now - hit[0] < ttl:
            return hit[1]
    req = urllib.request.Request(API + path, headers={"User-Agent": UA, "Accept": "application/json", "Referer": "https://bananaball.com/"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    with _lock:
        _cache[path] = (now, data)
        if len(_cache) > 400:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:100]:
                _cache.pop(k, None)
    return data


def img(a):
    return ASSET + a if a else ""


def seasons():
    return [{"id": s["id"], "year": s.get("year"), "name": s.get("description", ""), "type": s.get("type"), "current": bool(s.get("isCurrent")), "games": len(s.get("Games") or [])}
            for s in _get("directus-items/seasons", 3600)]


def main_season():
    """The current World Tour (the regular season), else the newest regular season."""
    ss = seasons()
    reg = [s for s in ss if s["type"] == "regular"]
    reg.sort(key=lambda s: (s["current"], s["year"] or 0, s["games"]), reverse=True)
    return reg[0]["id"] if reg else (ss[0]["id"] if ss else None)


def _side(t):
    return {"id": t.get("id", ""), "name": t.get("name", ""), "abbr": t.get("abbreviation", ""), "logo": img(t.get("logo")), "points": t.get("points"), "runs": t.get("runs"),
            "hits": t.get("hits"), "trick": t.get("trick_plays"),
            "sp": _pitcher(t.get("starting_pitcher")), "wp": _pitcher(t.get("winning_pitcher")), "lp": _pitcher(t.get("losing_pitcher"))}


def _pitcher(p):
    if not p:
        return None
    return {"id": p.get("id"), "name": f"{p.get('first_name', '')} {p.get('last_name', '')}".strip(), "photo": img(p.get("image")), "ip": p.get("innings_pitched"), "era": p.get("era")}


def _game(g):
    st = g.get("status") or ""
    return {"id": g["id"], "date": g.get("date"), "time": g.get("time"), "tz": g.get("venue_timezone") or "America/New_York", "season": g.get("season_id"),
            "state": "post" if st == "final" else "in" if st in ("live", "in_progress", "active") else "pre", "status": st,
            "inning": g.get("current_inning"), "half": g.get("current_half"), "home": _side(g.get("home_team") or {}), "away": _side(g.get("away_team") or {})}


def games(d_from, d_to):
    """The source returns at most 25 games per call, so long ranges are split until each piece fits."""
    a = datetime.date.fromisoformat(d_from)
    b = datetime.date.fromisoformat(d_to)
    out = {}

    def grab(x, y):
        lst = _get(f"stats/games?dateFrom={x.isoformat()}&dateTo={y.isoformat()}", 120 if y >= datetime.date.today() - datetime.timedelta(days=1) else 3600)
        if len(lst) >= 25 and x < y:
            mid = x + (y - x) / 2
            grab(x, mid)
            grab(mid + datetime.timedelta(days=1), y)
            return
        for g in lst:
            out[g["id"]] = _game(g)
    grab(a, b)
    return sorted(out.values(), key=lambda g: (g["date"] or "", g["time"] or ""))


def standings(season=None):
    season = season or main_season()
    d = _get(f"directus-items/standings?season={season}", 600)
    rows = [{"id": r["team_id"], "name": r["team_name"], "abbr": r.get("team_abbreviation", ""), "logo": img(r.get("team_logo")), "color": r.get("team_color", ""),
             "w": r.get("wins", 0), "l": r.get("losses", 0), "t": r.get("ties", 0), "gp": r.get("games_played", 0), "pct": r.get("win_pct"),
             "rs": r.get("points_scored", 0), "ra": r.get("points_allowed", 0), "gb": r.get("games_back"), "trick": r.get("trick_plays", 0), "streak": r.get("streak", ""),
             "home": _rec(r.get("home_record")), "away": _rec(r.get("away_record")), "l10": _rec(r.get("last_10"))} for r in d.get("standings", [])]
    return {"season": d.get("season", {}), "rows": rows}


def _rec(r):
    return f"{r.get('wins', 0)}-{r.get('losses', 0)}" if r else ""


def _f3(x):
    try:
        s = f"{float(x):.3f}"
        return s[1:] if s.startswith("0.") else s
    except (TypeError, ValueError):
        return None


def _f2(x):
    try:
        return f"{float(x):.2f}"
    except (TypeError, ValueError):
        return None


def _ip(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    w = int(v)
    return f"{w}.{round((v - w) * 10)}"


def _player(x, group):
    if group == "hitting":
        s = {"gamesPlayed": x.get("games_played"), "plateAppearances": x.get("total_plate_appearances"), "atBats": x.get("at_bats"), "runs": x.get("runs"), "hits": x.get("hits"),
             "doubles": x.get("doubles"), "triples": x.get("triples"), "homeRuns": x.get("home_runs"), "rbi": x.get("runs_batted_in"), "strikeOuts": x.get("strikeouts"),
             "stolenBases": x.get("stolen_bases"), "caughtStealing": x.get("caught_stealing"), "sacFlies": x.get("sacrifice_flies"), "sacBunts": x.get("sacrifice_hits"),
             "hitByPitch": x.get("hit_by_pitch"), "groundIntoDoublePlay": x.get("ground_into_double_play"), "totalBases": x.get("total_bases"), "numberOfPitches": x.get("pitches_seen"),
             "avg": _f3(x.get("batting_average")), "obp": _f3(x.get("on_base_percentage")), "slg": _f3(x.get("slugging_percentage")), "ops": _f3(x.get("on_base_plus_slugging")),
             "babip": _f3(x.get("batting_average_on_balls_in_play")), "walkOffs": x.get("walk_offs"), "ballFourSprints": x.get("ball_four_sprints"), "goldenBatters": x.get("golden_batters"),
             "showdownWalkOffs": x.get("showdown_walk_offs"), "foulOutsToFans": x.get("foul_outs_to_fans_batter"), "errors": x.get("errors")}
    else:
        s = {"gamesPlayed": x.get("games_pitched"), "gamesStarted": x.get("games_started"), "wins": x.get("wins"), "losses": x.get("losses"), "saves": x.get("saves"),
             "inningsPitched": _ip(x.get("innings_pitched")), "era": _f2(x.get("earned_run_average")), "hits": x.get("hits_allowed"), "earnedRuns": x.get("earned_runs"),
             "runs": x.get("runs_allowed"), "homeRuns": x.get("home_runs_allowed"), "strikeOuts": x.get("pitcher_strikeouts"), "hitByPitch": x.get("pitcher_hit_by_pitch"),
             "battersFaced": x.get("batters_faced"), "numberOfPitches": x.get("pitches_thrown"), "wildPitches": x.get("wild_pitches"), "completeGames": x.get("complete_games"),
             "shutouts": x.get("shutouts"), "pitchesPerInning": _f2(x.get("pitches_per_inning")), "sprintsAllowed": x.get("sprints_allowed"), "walkOffsAllowed": x.get("walk_offs_allowed"),
             "fip": _f2(x.get("expected_fip"))}
        try:
            ip = float(x.get("innings_pitched") or 0)
            ipf = int(ip) + round((ip - int(ip)) * 10) / 3
            if ipf:
                s["whip"] = _f2(((x.get("hits_allowed") or 0) + (x.get("sprints_allowed") or 0)) / ipf)
                s["strikeoutsPer9Inn"] = _f2(9 * (x.get("pitcher_strikeouts") or 0) / ipf)
                s["hitsPer9Inn"] = _f2(9 * (x.get("hits_allowed") or 0) / ipf)
        except (TypeError, ValueError):
            pass
    team = x.get("current_team") or x.get("team") or {}
    pos = (x.get("primary_position") or {}).get("value", "")
    return {"id": x["id"], "name": f"{x.get('first_name', '')} {x.get('last_name', '')}".strip(), "number": x.get("jersey_number"), "pos": "P" if pos in ("SP", "RP", "P") else pos,
            "posLabel": (x.get("primary_position") or {}).get("label", ""), "photo": img(x.get("image")), "team": team.get("name", ""), "teamId": team.get("id", ""),
            "teamLogo": img(team.get("logo")), "s": {k: v for k, v in s.items() if v is not None}}


def players(season=None, group="hitting"):
    season = season or main_season()
    raw, off = [], 0
    while off < 1000:   # pages of 100
        d = _get(f"stats/players_stats?category=players&subCategory={group}&season={season}&pool=all-players&sort=-hits&limit=100&offset={off}", 900)
        raw += d.get("data", [])
        off += 100
        if len(d.get("data", [])) < 100 or off >= (d.get("total") or 0):
            break
    rows = [_player(x, group) for x in raw]
    if group == "pitching":
        rows = [r for r in rows if r["s"].get("gamesPlayed")]
    return rows


def handle(path, q):
    ok = lambda s: bool(re.fullmatch(r"[0-9a-f-]{36}", s or ""))
    season = q.get("season") if ok(q.get("season")) else None
    if path == "seasons":
        return 200, {"seasons": seasons(), "main": main_season()}, 600
    if path == "games":
        try:
            a, b = datetime.date.fromisoformat(q.get("from", "")), datetime.date.fromisoformat(q.get("to", ""))
        except ValueError:
            return 400, {"error": "bad dates"}, 0
        if (b - a).days > 400 or b < a:
            return 400, {"error": "range too long"}, 0
        return 200, {"games": games(a.isoformat(), b.isoformat())}, 60
    if path == "standings":
        return 200, standings(season), 300
    if path == "players":
        return 200, {"players": players(season, q.get("group") if q.get("group") in ("hitting", "pitching") else "hitting")}, 600
    return 404, {"error": "not found"}, 0
