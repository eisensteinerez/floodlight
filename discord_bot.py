"""Floodlight on Discord: slash commands for prop research, live scores, predictions and lineups.

The bot runs inside server.py, so it needs no second service and no always-open connection: Discord sends each
slash command to https://<your-site>/api/discord/interactions, the server answers "thinking..." at once, works it
out in the background with the same functions and caches the site uses, and then edits the reply.

  /research   a player's hit rate on a stat and line: last 5 / 10 / 20 games, this season, against one opponent
  /props      today's PrizePicks and Sleeper lines ranked by how often each player has cleared them lately
  /scores     live scores, finals and today's schedule
  /predict    the day's leans; with a team, Floodlight's full forecast for that game (lean, predicted score, chances, reasons)
  /lineup     predicted or confirmed soccer lineups (FotMob), MLB batting orders and probable pitchers, injuries
  /lab        opens Floodlight Lab, the full research screen, as a Discord Activity in the channel (lab.py, lab.html)

Optional scheduled posts: set DISCORD_WEBHOOK_URL (a channel webhook) and the bot posts a digest of top props and
predictions at DISCORD_DIGEST_HOURS (UTC, comma separated).

No Claude or other paid API is called. Everything comes from free public feeds, cached so that a busy channel
doesn't multiply requests: player game logs for an hour, prop lines and predictions for minutes.

Environment:
  DISCORD_PUBLIC_KEY      the application's public key (Developer Portal > General Information); turns the bot on
  DISCORD_APP_ID          the application id; needed to register the commands
  DISCORD_BOT_TOKEN       the bot token; with it the server registers the commands itself when they change
                          (or run python3 discord_bot.py register)
  DISCORD_GUILD_ID        optional: register the commands to one server, where they show up instantly
  DISCORD_MEMBER_ROLES    optional: role ids allowed to use the commands (server admins always can)
  DISCORD_WEBHOOK_URL     optional: channel webhook for scheduled posts
  DISCORD_DIGEST_HOURS    optional: UTC hours for scheduled posts, default "14"
  DISCORD_DIGEST_SPORTS   optional: sports in the scheduled posts, default "nba,nfl,nhl,mlb,soccer"
  DISCORD_ACTIVITY        optional: "0" makes /lab reply with a browser link instead of opening the Activity
"""
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

import teamcheck

API = "https://discord.com/api/v10"
UA = "DiscordBot (https://github.com/eisensteinerez/floodlight, 1.0)"
ESPN = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3"
SAPI = "https://statsapi.mlb.com/api/v1"
SITE = os.environ.get("FLOODLIGHT_URL") or os.environ.get("RENDER_EXTERNAL_URL") or ""
GREEN, RED, BLUE, GREY = 0x22C55E, 0xEF4444, 0x3B82F6, 0x64748B

D = {}   # from server.py: fetch, similar, fm_player, fm_matchstats, fm_lineup, odds, dfs
_cache, _lock = {}, threading.Lock()
_work = threading.BoundedSemaphore(2)   # commands worked on at once; the rest queue (keeps memory steady on a free host)


def setup(**deps):
    D.update(deps)
    if os.environ.get("DISCORD_APP_ID") and os.environ.get("DISCORD_BOT_TOKEN"):
        threading.Thread(target=_register_on_start, daemon=True, name="discord-register").start()
    if os.environ.get("DISCORD_WEBHOOK_URL"):
        threading.Thread(target=_digest_loop, daemon=True, name="discord-digest").start()


def enabled():
    return bool(os.environ.get("DISCORD_PUBLIC_KEY"))


# ---------- small helpers ----------
def memo(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
        if len(_cache) > 600:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:300]:
                _cache.pop(k, None)
    return val


def get_json(url, ttl):
    if D.get("fetch"):
        return D["fetch"](url, ttl, as_json=True)
    return memo(url, ttl, lambda: json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20)))


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def num(x):
    if x is None or x in ("", "-", "--"):
        return None
    if isinstance(x, (int, float)):
        return x
    try:
        return float(str(x).replace(",", ""))
    except ValueError:
        return None


def ssum(*xs):
    return None if any(x is None for x in xs) else sum(xs)


def wsum(pairs):
    vals = [(v, w) for v, w in pairs if v is not None]
    return round(sum(v * w for v, w in vals), 2) if vals else None


def ip_outs(ip):
    n = num(ip)
    if n is None:
        return None
    w = int(n)
    return w * 3 + round((n - w) * 10)


def parse_date(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except Exception:
        return None


def ts(d, style="t"):
    """A Discord timestamp: every reader sees it in their own time zone."""
    return f"<t:{int(d.timestamp())}:{style}>" if d else ""


def pct(x):
    return "–" if x is None else f"{round(x * 100)}%"


def fmt(v):
    if v is None:
        return "–"
    return str(int(v)) if float(v).is_integer() else f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) >= 1 else f"{v:.2f}".rstrip("0").rstrip(".")


# ---------- sports ----------
SPORTS = {"nba": "NBA", "wnba": "WNBA", "nfl": "NFL", "nhl": "NHL", "mlb": "MLB", "soccer": "Soccer"}
ESPN_PATH = {"nba": "basketball/nba", "wnba": "basketball/wnba", "nfl": "football/nfl", "nhl": "hockey/nhl", "mlb": "baseball/mlb"}
SOCCER_LEAGUES = {"eng.1": "Premier League", "esp.1": "LaLiga", "ita.1": "Serie A", "ger.1": "Bundesliga", "fra.1": "Ligue 1",
                  "uefa.champions": "Champions League", "uefa.europa": "Europa League", "usa.1": "MLS"}
STAT_SPORT = {"wnba": "nba"}   # the WNBA uses the NBA's stat list


def h(g, *keys):
    for k in keys:
        if g["raw"].get(k) is not None:
            return g["raw"][k]
    return None


def _nfl(k):
    return lambda g: g["raw"].get(k)


# key, label, getter, deep (soccer: needs FotMob's per-match stats)
STATS = {
    "nba": [
        ("pts", "Points", lambda g: h(g, "PTS")), ("reb", "Rebounds", lambda g: h(g, "REB")), ("ast", "Assists", lambda g: h(g, "AST")),
        ("pra", "Pts + Reb + Ast", lambda g: ssum(h(g, "PTS"), h(g, "REB"), h(g, "AST"))), ("pr", "Pts + Reb", lambda g: ssum(h(g, "PTS"), h(g, "REB"))),
        ("pa", "Pts + Ast", lambda g: ssum(h(g, "PTS"), h(g, "AST"))), ("ra", "Reb + Ast", lambda g: ssum(h(g, "REB"), h(g, "AST"))),
        ("fs", "Fantasy score", lambda g: None if h(g, "PTS") is None else wsum([(h(g, "PTS"), 1), (h(g, "REB"), 1.2), (h(g, "AST"), 1.5), (h(g, "BLK"), 3), (h(g, "STL"), 3), (h(g, "TO"), -1)])),
        ("3pm", "3-pointers made", lambda g: h(g, "3PM")), ("3pa", "3-pointers attempted", lambda g: h(g, "3PA")),
        ("fgm", "Field goals made", lambda g: h(g, "FGM")), ("fga", "Field goals attempted", lambda g: h(g, "FGA")),
        ("ftm", "Free throws made", lambda g: h(g, "FTM")), ("fta", "Free throws attempted", lambda g: h(g, "FTA")),
        ("stl", "Steals", lambda g: h(g, "STL")), ("blk", "Blocks", lambda g: h(g, "BLK")), ("stocks", "Blocks + steals", lambda g: ssum(h(g, "STL"), h(g, "BLK"))),
        ("to", "Turnovers", lambda g: h(g, "TO")), ("pf", "Personal fouls", lambda g: h(g, "PF")), ("min", "Minutes", lambda g: g.get("min")),
        ("dd", "Double-double", lambda g: None if h(g, "PTS") is None else int(sum(1 for x in (h(g, "PTS"), h(g, "REB"), h(g, "AST"), h(g, "STL"), h(g, "BLK")) if (x or 0) >= 10) >= 2)),
    ],
    "nfl": [
        ("pyd", "Passing yards", _nfl("passing.YDS")), ("ptd", "Passing TDs", _nfl("passing.TD")), ("pcmp", "Completions", _nfl("passing.CMP")),
        ("patt", "Pass attempts", _nfl("passing.ATT")), ("pint", "Interceptions thrown", _nfl("passing.INT")),
        ("ryd", "Rushing yards", _nfl("rushing.YDS")), ("ratt", "Rush attempts", _nfl("rushing.CAR")), ("rlng", "Longest rush", _nfl("rushing.LNG")),
        ("rec", "Receptions", _nfl("receiving.REC")), ("reyd", "Receiving yards", _nfl("receiving.YDS")), ("tgt", "Targets", _nfl("receiving.TGTS")),
        ("relng", "Longest reception", _nfl("receiving.LNG")),
        ("rryd", "Rush + rec yards", lambda g: None if (g["raw"].get("rushing.YDS") is None and g["raw"].get("receiving.YDS") is None) else (g["raw"].get("rushing.YDS") or 0) + (g["raw"].get("receiving.YDS") or 0)),
        ("pryd", "Pass + rush yards", lambda g: None if g["raw"].get("passing.YDS") is None else g["raw"]["passing.YDS"] + (g["raw"].get("rushing.YDS") or 0)),
        ("td", "Rush + rec TDs", lambda g: None if (g["raw"].get("rushing.TD") is None and g["raw"].get("receiving.TD") is None) else (g["raw"].get("rushing.TD") or 0) + (g["raw"].get("receiving.TD") or 0)),
        ("fs", "Fantasy score", lambda g: wsum([(g["raw"].get("passing.YDS"), .04), (g["raw"].get("passing.TD"), 4), (g["raw"].get("passing.INT"), -1), (g["raw"].get("rushing.YDS"), .1),
                                                (g["raw"].get("receiving.YDS"), .1), (g["raw"].get("rushing.TD"), 6), (g["raw"].get("receiving.TD"), 6), (g["raw"].get("receiving.REC"), 1), (g["raw"].get("fumbles.LST"), -1)])),
        ("kpts", "Kicking points", _nfl("kicking.PTS")), ("fgm", "Field goals made", _nfl("kicking.FGM")),
        ("tkl", "Tackles + assists", lambda g: h(g, "defensive.TOT", "defense.TOT")), ("sck", "Sacks", lambda g: h(g, "defensive.SACK", "defense.SACK")),
    ],
    "nhl": [
        ("goals", "Goals", lambda g: h(g, "G", "goals")), ("ast", "Assists", lambda g: h(g, "A", "assists")),
        ("pts", "Points", lambda g: h(g, "PTS", "points") if h(g, "PTS", "points") is not None else (None if h(g, "G") is None else h(g, "G") + (h(g, "A") or 0))),
        ("sog", "Shots on goal", lambda g: h(g, "S", "SOG", "shotsTotal")),
        ("ppp", "Power-play points", lambda g: h(g, "PPP") if h(g, "PPP") is not None else (None if h(g, "PPG") is None and h(g, "PPA") is None else (h(g, "PPG") or 0) + (h(g, "PPA") or 0))),
        ("pm", "Plus/minus", lambda g: h(g, "+/-", "plusMinus")), ("pim", "Penalty minutes", lambda g: h(g, "PIM")),
        ("toi", "Time on ice (minutes)", lambda g: h(g, "TOI/G", "TOI")),
        ("g1", "Anytime goal", lambda g: None if h(g, "G") is None else int(h(g, "G") > 0)),
        ("sv", "Saves", lambda g: h(g, "SV", "SVS", "saves") if h(g, "SV", "SVS", "saves") is not None else (None if h(g, "SA") is None or h(g, "GA") is None else h(g, "SA") - h(g, "GA"))),
        ("ga", "Goals allowed", lambda g: h(g, "GA")), ("sa", "Shots against", lambda g: h(g, "SA")),
    ],
    "mlb": [
        ("h", "Hits", lambda g: h(g, "hits")), ("tb", "Total bases", lambda g: h(g, "totalBases")), ("hr", "Home runs", lambda g: h(g, "homeRuns")),
        ("rbi", "RBIs", lambda g: h(g, "rbi")), ("r", "Runs", lambda g: h(g, "runs")), ("hrr", "Hits + runs + RBIs", lambda g: ssum(h(g, "hits"), h(g, "runs"), h(g, "rbi"))),
        ("1b", "Singles", lambda g: None if h(g, "hits") is None else h(g, "hits") - (h(g, "doubles") or 0) - (h(g, "triples") or 0) - (h(g, "homeRuns") or 0)),
        ("2b", "Doubles", lambda g: h(g, "doubles")), ("bb", "Walks", lambda g: h(g, "baseOnBalls")), ("so", "Hitter strikeouts", lambda g: h(g, "strikeOuts")),
        ("sb", "Stolen bases", lambda g: h(g, "stolenBases")),
        ("hfs", "Hitter fantasy score", lambda g: None if h(g, "hits") is None else wsum([(h(g, "hits") - (h(g, "doubles") or 0) - (h(g, "triples") or 0) - (h(g, "homeRuns") or 0), 3), (h(g, "doubles"), 5),
                                                                                         (h(g, "triples"), 8), (h(g, "homeRuns"), 10), (h(g, "runs"), 2), (h(g, "rbi"), 2), (h(g, "baseOnBalls"), 2), (h(g, "hitByPitch"), 2), (h(g, "stolenBases"), 5)])),
        ("pk", "Pitcher strikeouts", lambda g: h(g, "p_strikeOuts")),
        ("pout", "Pitching outs", lambda g: h(g, "p_outs") if h(g, "p_outs") is not None else ip_outs(h(g, "p_inningsPitched"))),
        ("pha", "Hits allowed", lambda g: h(g, "p_hits")), ("per", "Earned runs allowed", lambda g: h(g, "p_earnedRuns")),
        ("pbb", "Walks allowed", lambda g: h(g, "p_baseOnBalls")), ("pc", "Pitches thrown", lambda g: h(g, "p_numberOfPitches", "p_pitchesThrown")),
    ],
    "soccer": [
        ("goals", "Goals", lambda g: h(g, "goals")), ("assists", "Assists", lambda g: h(g, "assists")), ("ga", "Goals + assists", lambda g: ssum(h(g, "goals"), h(g, "assists"))),
        ("shots", "Shots", lambda g: (g.get("deep") or {}).get("total_shots"), 1), ("sot", "Shots on target", lambda g: (g.get("deep") or {}).get("ShotsOnTarget"), 1),
        ("passes", "Passes attempted", lambda g: (g.get("deep") or {}).get("accurate_passes_total"), 1),
        ("chances", "Shots assisted (key passes)", lambda g: (g.get("deep") or {}).get("chances_created"), 1),
        ("tackles", "Tackles", lambda g: (g.get("deep") or {}).get("matchstats.headers.tackles"), 1),
        ("clear", "Clearances", lambda g: (g.get("deep") or {}).get("clearances"), 1),
        ("fouls", "Fouls committed", lambda g: (g.get("deep") or {}).get("fouls"), 1),
        ("saves", "Goalie saves", lambda g: (g.get("deep") or {}).get("saves"), 1),
        ("cards", "Cards", lambda g: (h(g, "yellow") or 0) + (h(g, "red") or 0)), ("rating", "FotMob rating", lambda g: h(g, "rating")), ("min", "Minutes", lambda g: g.get("min")),
    ],
}
STAT = {sp: {s[0]: {"k": s[0], "l": s[1], "get": s[2], "deep": len(s) > 3} for s in rows} for sp, rows in STATS.items()}

# names PrizePicks, Sleeper and people use for a stat -> our key (research.js RS_ALIAS)
ALIAS = {
    "soccer": {"shots": "shots", "shotsontarget": "sot", "sot": "sot", "goals": "goals", "anytimegoal": "goals", "goal": "goals", "assists": "assists", "goalassist": "ga",
               "goalsassists": "ga", "passesattempted": "passes", "passes": "passes", "shotsassisted": "chances", "keypasses": "chances", "tackles": "tackles",
               "clearances": "clear", "foulscommitted": "fouls", "fouls": "fouls", "goaliesaves": "saves", "saves": "saves", "cards": "cards", "minutes": "min"},
    "nba": {"points": "pts", "pts": "pts", "rebounds": "reb", "reb": "reb", "rebs": "reb", "assists": "ast", "ast": "ast", "asts": "ast", "ptsrebsasts": "pra", "ptsrebast": "pra",
            "pra": "pra", "pointsreboundsassists": "pra", "ptsrebs": "pr", "ptsreb": "pr", "pr": "pr", "pointsrebounds": "pr", "ptsasts": "pa", "ptsast": "pa", "pa": "pa",
            "pointsassists": "pa", "rebsasts": "ra", "rebast": "ra", "ra": "ra", "reboundsassists": "ra", "fantasyscore": "fs", "fantasy": "fs", "3ptmade": "3pm", "threesmade": "3pm",
            "threes": "3pm", "3pm": "3pm", "3pointersmade": "3pm", "threepointersmade": "3pm", "3ptattempted": "3pa", "3pa": "3pa", "threepointersattempted": "3pa",
            "fgmade": "fgm", "fieldgoalsmade": "fgm", "fgattempted": "fga", "fieldgoalsattempted": "fga", "freethrowsmade": "ftm", "ftm": "ftm", "freethrowsattempted": "fta",
            "steals": "stl", "stl": "stl", "blockedshots": "blk", "blocks": "blk", "blk": "blk", "blksstls": "stocks", "blkstl": "stocks", "blockssteals": "stocks",
            "stealsblocks": "stocks", "stocks": "stocks", "turnovers": "to", "to": "to", "doubledouble": "dd", "personalfouls": "pf", "minutes": "min"},
    "nfl": {"passyards": "pyd", "passingyards": "pyd", "passyds": "pyd", "passtds": "ptd", "passingtds": "ptd", "passingtouchdowns": "ptd", "passcompletions": "pcmp",
            "completions": "pcmp", "passattempts": "patt", "passingattempts": "patt", "int": "pint", "intsthrown": "pint", "interceptionsthrown": "pint", "interceptions": "pint",
            "rushyards": "ryd", "rushingyards": "ryd", "rushattempts": "ratt", "rushingattempts": "ratt", "longestrush": "rlng", "receptions": "rec", "receivingyards": "reyd",
            "recyards": "reyd", "rectargets": "tgt", "targets": "tgt", "longestreception": "relng", "rushrecyds": "rryd", "rushrecyards": "rryd", "rushingreceivingyards": "rryd",
            "rushingandreceivingyards": "rryd", "passrushyds": "pryd", "passrushyards": "pryd", "rushrectds": "td", "anytimetd": "td", "anytimetouchdown": "td", "touchdowns": "td",
            "fantasyscore": "fs", "kickingpoints": "kpts", "fgmade": "fgm", "fieldgoalsmade": "fgm", "tacklesast": "tkl", "tacklesassists": "tkl", "tackles": "tkl", "sacks": "sck"},
    "nhl": {"goals": "goals", "anytimegoal": "g1", "anytimegoalscorer": "g1", "assists": "ast", "points": "pts", "shotsongoal": "sog", "shots": "sog", "sog": "sog",
            "powerplaypoints": "ppp", "plusminus": "pm", "penaltyminutes": "pim", "timeonice": "toi", "goaliesaves": "sv", "saves": "sv", "goalsallowed": "ga", "goalsagainst": "ga"},
    "mlb": {"hits": "h", "totalbases": "tb", "homeruns": "hr", "rbis": "rbi", "rbi": "rbi", "runs": "r", "hitsrunsrbis": "hrr", "hrr": "hrr", "singles": "1b", "doubles": "2b",
            "walks": "bb", "hitterstrikeouts": "so", "stolenbases": "sb", "hitterfantasyscore": "hfs", "pitcherstrikeouts": "pk", "strikeouts": "pk", "ks": "pk", "pitchingouts": "pout",
            "outs": "pout", "outsrecorded": "pout", "hitsallowed": "pha", "earnedrunsallowed": "per", "earnedruns": "per", "walksallowed": "pbb", "pitchesthrown": "pc", "pitchcount": "pc"},
}


def stat_sport(sport):
    return STAT_SPORT.get(sport, sport)


def stat_key(sport, label):
    sp = stat_sport(sport)
    k = re.sub(r"[^a-z0-9]", "", str(label or "").lower())
    if k in STAT.get(sp, {}):
        return k
    if k in ALIAS.get(sp, {}):
        return ALIAS[sp][k]
    for key, s in STAT.get(sp, {}).items():
        if re.sub(r"[^a-z0-9]", "", s["l"].lower()) == k:
            return key
    return None


# ---------- seasons ----------
def cur_season(sport):
    now = dt.datetime.now(dt.timezone.utc)
    y, m = now.year, now.month
    if sport == "nfl":
        return y if m >= 3 else y - 1
    if sport in ("nba", "nhl"):
        return y + 1 if m >= 9 else y
    return y


def season_start(sport):
    now = dt.datetime.now(dt.timezone.utc)
    y, m = now.year, now.month
    if sport == "soccer":
        return dt.datetime(y if m >= 7 else y - 1, 7, 1, tzinfo=dt.timezone.utc)
    if sport in ("nba", "nhl"):
        return dt.datetime(y if m >= 9 else y - 1, 9, 1, tzinfo=dt.timezone.utc)
    if sport == "nfl":
        return dt.datetime(y if m >= 3 else y - 1, 3, 1, tzinfo=dt.timezone.utc)
    return dt.datetime(y, 1, 1, tzinfo=dt.timezone.utc)


# ---------- finding a player and loading their games (research.js rsFindPlayer / rsLoad*) ----------
def find_player(sport, name, team=None):
    """{"id", "lg", "name", "fid"} for a name. NBA, WNBA, NFL, NHL and MLB come from the player record (players.py),
    read from the teams' rosters, so every page gets the same person and team; team (any abbreviation) settles two
    players with one name. The provider's own search is the fallback for names no roster lists."""
    if sport in ("nba", "wnba", "nfl", "nhl", "mlb"):
        import players
        if players._state.get("loaded"):
            try:
                r = players.find(sport, name, team, search=search_player)
            except Exception:
                r = None
            if r:
                return {"id": r["pid"], "lg": sport, "name": r["name"], "fid": r["fid"]}
    return search_player(sport, name)


def search_player(sport, name):
    """The provider's own search: ESPN's (MLB's for baseball). Fuzzy, and it knows nothing about teams."""
    def go():
        if sport == "soccer":
            return {"name": name}
        if sport == "mlb":
            d = get_json(f"{SAPI}/people/search?names={urllib.parse.quote(name)}&sportIds=1", 86400)
            # active players first, and among them the exact name (a search for "Will Smith" finds more than one)
            people = sorted(d.get("people") or [], key=lambda x: (not x.get("active"), norm(x.get("fullName")) != norm(name)))
            return {"id": people[0]["id"], "name": people[0].get("fullName")} if people else None
        espn_sport = ESPN_PATH[sport].split("/")[0]
        d = get_json(f"{ESPN_WEB}/search?query={urllib.parse.quote(name)}&type=player&sport={espn_sport}&limit=6", 86400)
        ok = ["nba", "wnba"] if sport in ("nba", "wnba") else [sport]
        if sport == "wnba":
            ok = ["wnba", "nba"]
        lg = lambda x: x.get("league") or x.get("defaultLeagueSlug")
        items = [x for x in d.get("items") or [] if lg(x) in ok]
        # an NBA player is used for a WNBA name only when the name is exactly theirs
        if sport == "wnba":
            items = [x for x in items if lg(x) == "wnba" or norm(x.get("displayName")) == norm(name)]
        # this league first, then the exact name: ESPN's search is fuzzy, and its first hit can be someone else
        items.sort(key=lambda x: (lg(x) != sport, norm(x.get("displayName")) != norm(name)))
        x = items[0] if items else None
        return {"id": x["id"], "lg": x.get("league") or x.get("defaultLeagueSlug"), "name": x.get("displayName")} if x else None
    try:
        return memo(("find", sport, norm(name)), 86400, go)
    except Exception:
        return None


def espn_season(path, pid, y):
    try:
        g = get_json(f"{ESPN_WEB}/sports/{path}/athletes/{pid}/gamelog?season={y}", 3600)
    except Exception:
        return []
    return espn_season_from(g)


def espn_season_from(g):
    """An ESPN gamelog response as a list of games."""
    if not g or not g.get("seasonTypes"):
        return []
    labels, cats, out = g.get("labels") or [], g.get("categories") or [], []
    col, i = {}, 0
    if len(cats) > 1:
        for c in cats:
            for _ in range(c.get("count") or 0):
                if i < len(labels):
                    col[i] = str(c.get("name") or "").lower() + "." + labels[i]
                i += 1
    for st in g["seasonTypes"]:
        name = st.get("displayName") or ""
        if re.search(r"pre", name, re.I) and not re.search(r"post", name, re.I):
            continue
        comp = "Playoffs" if re.search(r"post|playoff", name, re.I) else "Regular season"
        for c in st.get("categories") or []:
            for x in c.get("events") or []:
                m = (g.get("events") or {}).get(x.get("eventId")) or {}
                raw = {}
                for j, v in enumerate(x.get("stats") or []):
                    lab = labels[j] if j < len(labels) else str(j)
                    k = col.get(j, lab)
                    if isinstance(v, str) and re.fullmatch(r"\d+[-/]\d+", v):
                        a, b = map(int, re.split(r"[-/]", v))
                        s = "3P" if lab == "3PT" else lab
                        raw.setdefault(s + "M", a)
                        raw.setdefault(s + "A", b)
                        if j in col:
                            cat = col[j].split(".")[0]
                            raw[f"{cat}.{s}M"], raw[f"{cat}.{s}A"] = a, b
                        continue
                    if isinstance(v, str) and re.fullmatch(r"\d+:\d\d", v):
                        a, b = v.split(":")
                        n = int(a) + int(b) / 60
                    else:
                        n = num(v)
                    raw.setdefault(k, n)
                    raw.setdefault(lab, n)
                d = parse_date(m.get("gameDate"))
                if not d:
                    continue
                opp = m.get("opponent") or {}
                sc = re.search(r"(\d+)\D+(\d+)", str(m.get("score") or ""))
                out.append({"id": str(x.get("eventId")), "date": d, "opp": opp.get("displayName") or opp.get("abbreviation") or "", "oppAbbr": opp.get("abbreviation") or "",
                            "home": None if not m.get("atVs") else m.get("atVs") != "@", "comp": comp, "res": m.get("gameResult") or "",
                            "score": f"{sc.group(1)}-{sc.group(2)}" if sc else "", "min": raw.get("MIN", raw.get("TOI/G", raw.get("TOI"))), "raw": raw})
    return out


def mlb_season(pid, y):
    try:
        d = get_json(f"{SAPI}/people/{pid}/stats?stats=gameLog&group=hitting,pitching&season={y}&sportId=1", 3600)
    except Exception:
        return []
    games = {}
    for st in d.get("stats") or []:
        pit = "pitch" in ((st.get("group") or {}).get("displayName") or "").lower()
        for s in st.get("splits") or []:
            k = str((s.get("game") or {}).get("gamePk") or (s.get("date", "") + str((s.get("opponent") or {}).get("id"))))
            g = games.get(k) or {"id": k, "date": parse_date(s.get("date", "") + "T12:00:00+00:00"), "opp": (s.get("opponent") or {}).get("name") or "",
                                 "oppAbbr": "", "home": s.get("isHome"), "comp": "Postseason" if s.get("gameType") in ("F", "D", "L", "W") else "Regular season",
                                 "res": "W" if s.get("isWin") is True else "L" if s.get("isWin") is False else "", "score": "", "min": None, "raw": {}}
            for kk, v in (s.get("stat") or {}).items():
                n = v if kk == "inningsPitched" else num(v)
                if n is not None:
                    g["raw"][("p_" if pit else "") + kk] = n
            games[k] = g
    return [g for g in games.values() if g["date"]]


def soccer_player(name):
    d = D["fm_player"](None, name, "")
    if not d or d.get("error"):
        raise LookupError(f"Couldn't find {name} on FotMob.")
    games = []
    for m in d.get("recent") or []:
        if m.get("played") is False or (m.get("bench") and not m.get("minutes")):
            continue
        if m.get("minutes") is not None and not m["minutes"]:
            continue
        hs, as_ = (m.get("score") or [None, None])[:2] if isinstance(m.get("score"), list) else (None, None)
        us, them = (hs, as_) if m.get("home") else (as_, hs)
        games.append({"id": str(m.get("id")), "date": parse_date(m.get("utc")), "opp": html.unescape(m.get("opponent") or ""), "oppAbbr": "", "home": bool(m.get("home")),
                      "comp": m.get("league") or "", "res": "" if us is None else "W" if us > them else "L" if us < them else "D",
                      "score": "" if us is None else f"{us}-{them}", "min": m.get("minutes"),
                      "raw": {"goals": m.get("goals") or 0, "assists": m.get("assists") or 0, "yellow": m.get("yellow") or 0, "red": m.get("red") or 0, "rating": num(m.get("rating"))}})
    games = sorted([g for g in games if g["date"]], key=lambda g: g["date"], reverse=True)
    return {"sport": "soccer", "id": str(d.get("id")), "name": d.get("name"), "team": (d.get("team") or {}).get("name") or "", "photo": d.get("photo"), "games": games}


def soccer_deep(p, n=10):
    """FotMob per-match stats (shots, passes, tackles...) for the last n matches."""
    def one(g):
        if "deep" in g:
            return
        try:
            m = memo(("fmstats", g["id"]), 6 * 3600, lambda: D["fm_matchstats"](mid=g["id"]))
            for pl in m.get("players") or []:
                if str(pl.get("id")) == p["id"]:
                    f = {}
                    for grp in (pl.get("stats") or {}).values():
                        for k, v in (grp or {}).items():
                            if isinstance(v, list):
                                f[k], f[k + "_total"] = num(v[0]) if v else None, num(v[1]) if len(v) > 1 else None
                            else:
                                f[k] = num(v)
                    g["deep"] = f
                    return
            g["deep"] = None
        except Exception:
            g["deep"] = None
    with cf.ThreadPoolExecutor(3) as ex:
        list(ex.map(one, p["games"][:n]))


def load_player(sport, name, team=None):
    """A player's games, newest first: {sport, id, fid, name, team, teamAbbr, photo, games: [{date, opp, home, raw...}]}.
    The team is the player record's (players.py) when there is one; team is a hint for two players with one name."""
    hint = team   # go() below sets its own `team` (the one it reads), so the hint gets a name of its own

    def go():
        if sport == "soccer":
            return soccer_player(name)
        o = find_player(sport, name, hint)
        if not o:
            raise LookupError(f"Couldn't find a {SPORTS[sport]} player called {name}.")
        if sport == "mlb":
            y = dt.datetime.now(dt.timezone.utc).year
            games = mlb_season(o["id"], y) + mlb_season(o["id"], y - 1)
            photo = f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{o['id']}/headshot/67/current"
            team, abbr = "", ""
            try:
                ct = (get_json(f"{SAPI}/people/{o['id']}?hydrate=currentTeam", 86400).get("people") or [{}])[0].get("currentTeam") or {}
                team = ct.get("name") or ""
                abbr = next((t.get("abbreviation") or "" for t in get_json(f"{SAPI}/teams?sportId=1", 86400).get("teams") or [] if t.get("id") == ct.get("id")), "")
            except Exception:
                pass
        else:
            lg = o.get("lg") or sport
            path = f"{ESPN_PATH[sport].split('/')[0]}/{lg}"
            y = cur_season(sport)
            games = espn_season(path, o["id"], y) + espn_season(path, o["id"], y - 1)
            photo = f"https://a.espncdn.com/i/headshots/{lg}/players/full/{o['id']}.png"
            team, abbr = "", ""
            try:
                t = (get_json(f"{ESPN_WEB}/sports/{path}/athletes/{o['id']}", 86400).get("athlete") or {}).get("team") or {}
                team, abbr = t.get("displayName") or "", t.get("abbreviation") or ""
            except Exception:
                pass
        seen, uniq = set(), []
        for g in sorted(games, key=lambda g: g["date"], reverse=True):
            if g["id"] not in seen:
                seen.add(g["id"])
                uniq.append(g)
        if not uniq:
            raise LookupError(f"No recent games found for {o.get('name') or name}.")
        fid = o.get("fid") or (f"{sport}:{o['id']}" if sport in ("nba", "wnba", "nfl", "nhl", "mlb") else None)
        if fid:   # the team every page shows is the player record's, never this page's own reading
            import players
            rec = players.get(fid) if players._state.get("loaded") else None
            if rec:
                team, abbr = rec.get("teamName") or team, rec.get("teamAbbr") or abbr
                photo = rec.get("photo") or photo
        return {"sport": sport, "id": str(o["id"]), "fid": fid, "name": o.get("name") or name, "team": team, "teamAbbr": abbr, "photo": photo, "games": uniq}
    import teamcheck as _tc
    return memo(("player", sport, norm(name), _tc.canon(sport, hint) or ""), 3600, go)


# ---------- maths (research.js rsRate) ----------
def rate(games, get, line, side):
    hit = push = n = 0
    vals = []
    for g in games:
        v = get(g)
        if v is None:
            continue
        n += 1
        vals.append(v)
        if v == line:
            push += 1
        elif (v > line) if side == "over" else (v < line):
            hit += 1
    dec = n - push
    s = sorted(vals)
    med = None if not s else s[len(s) // 2] if len(s) % 2 else (s[len(s) // 2 - 1] + s[len(s) // 2]) / 2
    return {"n": n, "hit": hit, "push": push, "pct": hit / dec if dec else None, "avg": sum(vals) / len(vals) if vals else None, "med": med}


def judge(games, get, line, side, opp=None):
    """The Lab meter (lab.html judge): the estimated chance this side of the line comes in. A recency-weighted hit rate,
    pulled toward 50% on small samples, blended with where the weighted average and spread sit against the line."""
    import math
    use = [g for g in games[:60] if get(g) is not None]
    vs = [float(get(g)) for g in use]
    n = len(vs)
    if n < 3:
        return None
    w = [0.5 ** (i / 10) for i in range(n)]
    W = sum(w)
    neff = W * W / sum(x * x for x in w)
    ho = sum(x for v, x in zip(vs, w) if v > line)
    hd = sum(x for v, x in zip(vs, w) if v != line)
    emp = (ho + 1.5) / (hd + 3)
    base = sum(v * x for v, x in zip(vs, w)) / W
    mu = base
    if opp:
        no = norm(opp)
        h2h = [v for g, v in zip(use, vs) if no and (no in norm(g["opp"]) or no == norm(g.get("oppAbbr")))]
        if len(h2h) >= 2:
            mu += min(.3, len(h2h) * .08) * (sum(h2h) / len(h2h) - base)
    var = sum(x * (v - base) ** 2 for v, x in zip(vs, w)) / W * (neff / (neff - 1) if neff > 1.5 else 1)
    sd = math.sqrt(var * (1 + 1 / neff)) or .5
    low = all(v == int(v) for v in vs) and min(vs) >= 0 and base < 6 and var <= max(base, .2) * 1.6

    def pois_cdf(k, lam):
        t = math.exp(-lam)
        s = 0
        for i in range(int(k) + 1):
            s += t
            t *= lam / (i + 1)
        return min(1, s)
    if set(vs) <= {0.0, 1.0} and line == .5:
        model = emp
        fair = None
    elif low:
        lam = max(.05, mu)
        model = 1 - pois_cdf(math.floor(line), lam)
        fair = .5
        while fair < 60 and 1 - pois_cdf(math.floor(fair), lam) > .5:
            fair += 1
    else:
        model = 1 - .5 * (1 + math.erf((line - mu) / sd / math.sqrt(2)))
        fair = math.floor(mu) + .5
    we = .5 if n >= 20 else .42 if n >= 10 else .3
    p_over = max(.02, min(.98, we * emp + (1 - we) * model))
    over = side == "over"
    return {"p": p_over if over else 1 - p_over, "emp": emp if over else 1 - emp, "model": model if over else 1 - model, "mu": mu, "sd": sd, "n": n,
            "fair": fair, "conf": "High" if n >= 20 and neff >= 10 else "Medium" if n >= 10 else "Low"}


def american(p):
    if p is None or p <= 0 or p >= 1:
        return "–"
    return f"-{round(100 * p / (1 - p))}" if p >= .5 else f"+{round(100 * (1 - p) / p)}"


def default_line(games, get):
    vals = [v for v in (get(g) for g in games[:10]) if v is not None]
    if not vals:
        return 0.5
    return max(0.5, round(sum(vals) / len(vals)) - 0.5)


# ---------- posted lines (dfs.py) ----------
def dfs_lines(sport):
    return memo(("dfs", sport), 300, lambda: D["dfs"].lines(sport))


def posted_lines(sport, name, key):
    out = []
    n = norm(name)
    for x in dfs_lines(sport).get("lines") or []:
        if norm(x.get("player")) == n and stat_key(sport, x.get("stat")) == key:
            out.append(x)
    return out


def book_txt(x):
    b = {"prizepicks": "PrizePicks", "sleeper": "Sleeper"}.get(x.get("book"), x.get("book"))
    extra = f" ({x['kind']})" if x.get("kind") and x.get("kind") != "standard" else ""
    if x.get("pOver") is not None:
        extra += f" · {pct(x['pOver'])} over"
    return f"{b} {fmt(x['line'])}{extra}"


# ---------- /research ----------
def cmd_research(o):
    sport = o.get("sport") or "nba"
    player, label, side = o.get("player") or "", o.get("stat") or "", o.get("side") or "over"
    key = stat_key(sport, label)
    if not key:
        return err(f"I don't know the stat \"{label}\" for {SPORTS[sport]}. Try one of: " + ", ".join(s["l"] for s in STAT[stat_sport(sport)].values()))
    sd = STAT[stat_sport(sport)][key]
    p = load_player(sport, player)
    if sd["deep"]:
        soccer_deep(p, 20)
    games = [g for g in p["games"] if sd["get"](g) is not None]
    if not games:
        return err(f"{p['name']} has no {sd['l'].lower()} numbers in their recent games.")
    posted = []
    try:
        posted = posted_lines(sport, p["name"], key)
    except Exception:
        pass
    line = o.get("line")
    line_from = ""
    if line is None:
        std = next((x for x in posted if x.get("book") == "prizepicks" and x.get("kind") in (None, "standard")), None) or (posted[0] if posted else None)
        if std:
            line, line_from = std["line"], " (posted line)"
        else:
            line, line_from = default_line(games, sd["get"]), " (near their recent average)"
    line = float(line)
    start = season_start(sport)
    ranges = [("Last 5", games[:5]), ("Last 10", games[:10]), ("Last 20", games[:20]), ("This season", [g for g in games if g["date"] >= start]), ("Both seasons", games)]
    opp = o.get("opponent")
    if opp:
        no = norm(opp)
        vs = [g for g in games if no and (no in norm(g["opp"]) or no == norm(g.get("oppAbbr")))]
        ranges.append((f"vs {opp}", vs))
    fields = []
    for lab, gs in ranges:
        r = rate(gs, sd["get"], line, side)
        if not r["n"]:
            continue
        fields.append({"name": lab, "value": f"**{pct(r['pct'])}** · {r['hit']}/{r['n'] - r['push']}" + (f" ({r['push']} push)" if r["push"] else "") + f"\navg {fmt(r['avg'])} · med {fmt(r['med'])}", "inline": True})
    l10 = rate(games[:10], sd["get"], line, side)
    J = judge(games, sd["get"], line, side, opp)
    hit = lambda v: None if v == line else ((v > line) if side == "over" else (v < line))
    log = []
    for g in games[:10]:
        v = sd["get"](g)
        mark = "➖" if hit(v) is None else "✅" if hit(v) else "❌"
        d = v - line
        log.append(f"{mark} `{fmt(v):>5}` `{'+' if d > 0 else '−' if d < 0 else ' '}{fmt(abs(round(d, 2))):<4}` {g['date'].strftime('%b %d')} {'vs' if g['home'] else '@' if g['home'] is False else 'v'} {g['opp']}")
    strip = "".join("⬜" if hit(sd["get"](g)) is None else "🟩" if hit(sd["get"](g)) else "🟥" for g in reversed(games[:20]))
    head = f"## {side.title()} {fmt(line)} {sd['l']}\n" + (f"-# {line_from.strip(' ()').capitalize()}\n" if line_from else "")
    read = ""
    color = BLUE
    if J:
        pr = J["p"]
        gap = abs(pr - .5)
        agree = (J["emp"] > .5) == (J["model"] > .5)
        strength = 0 if gap < .06 else 2 if gap >= .16 and agree and J["conf"] != "Low" else 1
        lean_side = side if pr > .5 else ("under" if side == "over" else "over")
        lean = "No clear lean" if not strength else f"{'Strong' if strength == 2 else 'Slight'} lean {lean_side}"
        bar = "▰" * round(pr * 12) + "▱" * (12 - round(pr * 12))
        read = f"### 🧪 Lab meter: {round(pr * 100)}%  {bar}\n**{lean}** · {J['conf'].lower()} confidence ({J['n']} games)\n"
        bits = [f"Fair price **{american(pr)}**", f"Projection **{fmt(round(J['mu'], 1))}**"] + ([f"Fair line **{fmt(J['fair'])}**"] if J.get("fair") is not None else [])
        bp = next((x["pOver"] for x in posted if x.get("pOver") is not None and x.get("line") == line), None)
        if bp is not None:
            imp = bp if side == "over" else 1 - bp
            edge = pr - imp
            verdict = "loves this line" if edge >= .08 else "likes this line" if edge >= .035 else "fairly priced" if edge > -.035 else "dislikes this line" if edge > -.08 else "hates this line"
            bits.append(f"Books {pct(imp)}, edge **{'+' if edge >= 0 else '−'}{abs(round(edge * 100))}** ({verdict})")
        read += " · ".join(bits) + "\n"
        if not agree:
            read += f"-# Mixed signals: recent hit rate says {pct(J['emp'])}, the average and spread say {pct(J['model'])}.\n"
        color = GREEN if pr >= .57 else RED if pr <= .43 else BLUE
    else:
        color = GREEN if (l10["pct"] or 0) >= .6 else RED if l10["pct"] is not None and l10["pct"] <= .4 else BLUE
    vals = sorted(sd["get"](g) for g in games[:20])
    q = lambda f: vals[min(len(vals) - 1, int(round((len(vals) - 1) * f)))]
    prof = f"**Floor {fmt(q(.1))} · Median {fmt(q(.5))} · Ceiling {fmt(q(.9))}**  (last {len(vals)})\n" if len(vals) >= 5 else ""
    desc = (head + read + (f"Posted: {' · '.join(book_txt(x) for x in posted[:6])}\n" if posted else "")
            + f"\n**Last {min(20, len(games))}, oldest to newest**\n{strip}\n" + prof + "\n**Last 10 games**  `value` `vs line`\n" + "\n".join(log))
    return {"embeds": [{"title": f"{p['name']} · {sd['l']}", "description": desc[:4000], "color": color, "fields": fields[:25],
                        "thumbnail": {"url": p["photo"]} if p.get("photo") else None,
                        "footer": {"text": f"{SPORTS[sport]}{' · ' + p['team'] if p.get('team') else ''} · Floodlight research · /lab player:{p['name']} for the full screen · history, not a forecast"}}]}


# ---------- /props: today's lines ranked by hit rate ----------
def props_board(sport, stat=None, count=10, deepen=None):
    key = stat_key(sport, stat) if stat else None
    if stat and not key:
        raise LookupError(f"I don't know the stat \"{stat}\" for {SPORTS[sport]}.")
    d = dfs_lines(sport)
    rows = {}
    for x in d.get("lines") or []:
        k = stat_key(sport, x.get("stat"))
        # yes/no stats like a double-double crowd the top with 100% unders; leave them out unless asked for
        if not k or (key and k != key) or STAT[stat_sport(sport)][k]["deep"] or (not key and k in ("dd", "g1")):
            continue
        r = rows.setdefault((norm(x["player"]), k), {"player": x["player"], "team": x.get("team"), "opp": x.get("opp"), "k": k, "offers": []})
        r["offers"].append(x)
    for r in rows.values():
        std = next((x for x in r["offers"] if x["book"] == "prizepicks" and x.get("kind") in (None, "standard")), None)
        if std:
            r["line"] = std["line"]
        else:
            cnt = {}
            for x in r["offers"]:
                cnt[x["line"]] = cnt.get(x["line"], 0) + 1
            r["line"] = max(cnt, key=cnt.get)
    # the players with the most lines first: the ones people are actually betting
    players = {}
    for r in rows.values():
        players.setdefault(norm(r["player"]), []).append(r)
    order = sorted(players, key=lambda n: -len(players[n]))[:40 if key else 30]

    def analyse(n):
        try:
            p = load_player(sport, players[n][0]["player"], players[n][0].get("team"))
            if deepen and len(p["games"]) < 60:   # the Lab reads up to 60 games back; fetch the older seasons it would
                p = deepen(sport, p)
        except Exception:
            return
        for r in players[n]:
            sd = STAT[stat_sport(sport)][r["k"]]
            gs = [g for g in p["games"] if sd["get"](g) is not None]
            if len(gs) < 5:
                continue
            o5, o10, o20 = (rate(gs[:k], sd["get"], r["line"], "over") for k in (5, 10, 20))
            u10 = rate(gs[:10], sd["get"], r["line"], "under")
            side, best = ("over", o10) if (o10["pct"] or 0) >= (u10["pct"] or 0) else ("under", u10)
            r.update(side=side, l10=best, l5=o5 if side == "over" else rate(gs[:5], sd["get"], r["line"], "under"),
                     l20=o20 if side == "over" else rate(gs[:20], sd["get"], r["line"], "under"), avg=o10["avg"], label=sd["l"],
                     recent=[(sd["get"](g), g.get("home"), g.get("min"), g.get("opp") or "", g.get("oppAbbr") or "",
                             g["date"].isoformat() if hasattr(g.get("date"), "isoformat") else "") for g in gs[:60]], photo=p.get("photo"),
                     # does the book's team match the team of the player whose games these are?
                     found_team=p.get("team") or "", found_abbr=p.get("teamAbbr") or "", team_ok=teamcheck.same(sport, r.get("team"), p.get("teamAbbr")),
                     fid=p.get("fid"))

    with cf.ThreadPoolExecutor(4) as ex:
        list(ex.map(analyse, order))
    done = [r for n in order for r in players[n] if r.get("l10") and r["l10"]["pct"] is not None]
    done.sort(key=lambda r: (-(r["l10"]["pct"]), -(r["l20"]["pct"] or 0), -(r["l5"]["pct"] or 0)))
    return {"rows": done[:count], "errors": d.get("errors") or {}, "lines": len(rows), "fetched": d.get("fetched")}


def cmd_props(o):
    sport = o.get("sport") or "nba"
    count = max(3, min(20, int(o.get("count") or 10)))
    b = memo(("props", sport, norm(o.get("stat")), count), 900, lambda: props_board(sport, o.get("stat"), count))
    if not b["rows"]:
        why = " ".join(f"{k} didn't answer ({v[:60]})." for k, v in b["errors"].items())
        return err(f"No {SPORTS[sport]} prop lines to rank right now. {why}".strip())
    lines = []
    for i, r in enumerate(b["rows"], 1):
        lines.append(f"**{i}. {r['player']}** {r['side']} {fmt(r['line'])} {r['label'].lower()}" + (f" · {r['opp']}" if r.get("opp") else "") +
                     f"\n  L5 {pct(r['l5']['pct'])} · **L10 {pct(r['l10']['pct'])}** · L20 {pct(r['l20']['pct'])} · avg {fmt(r['avg'])}")
    return {"embeds": [{"title": f"Top {SPORTS[sport]} props by hit rate" + (f" · {o['stat']}" if o.get("stat") else ""),
                        "description": "\n".join(lines)[:4000], "color": GREEN,
                        "footer": {"text": f"PrizePicks and Sleeper lines ({b['lines']} checked) · past results, not a guarantee · Floodlight research"}}]}


# ---------- scoreboards ----------
def scoreboard(sport, lg=None, day=None):
    path = f"soccer/{lg}" if sport == "soccer" else ESPN_PATH[sport]
    q = f"?dates={day}" if day else ""
    return get_json(f"{ESPN}/{path}/scoreboard{q}", 60)


def events(sport, lg=None, day=None):
    leagues = [lg] if lg else list(SOCCER_LEAGUES)[:6] if sport == "soccer" else [None]
    out = []
    def one(l):
        try:
            return l, scoreboard(sport, l, day)
        except Exception:
            return l, {}
    with cf.ThreadPoolExecutor(4) as ex:
        for l, d in ex.map(one, leagues):
            for e in d.get("events") or []:
                c = (e.get("competitions") or [{}])[0]
                teams = {t.get("homeAway"): t for t in c.get("competitors") or []}
                hm, aw = teams.get("home") or {}, teams.get("away") or {}
                st = (e.get("status") or c.get("status") or {}).get("type") or {}
                out.append({"id": e.get("id"), "lg": l or sport, "lgName": SOCCER_LEAGUES.get(l, SPORTS[sport]), "date": parse_date(e.get("date")),
                            "state": st.get("state"), "detail": st.get("shortDetail") or st.get("detail") or "",
                            "home": team_of(hm), "away": team_of(aw), "odds": (c.get("odds") or [None])[0], "raw": e})
    return sorted(out, key=lambda e: (e["date"] or dt.datetime.max.replace(tzinfo=dt.timezone.utc)))


def team_of(t):
    tm = t.get("team") or {}
    return {"id": str(tm.get("id") or ""), "name": tm.get("displayName") or tm.get("name") or "", "short": tm.get("shortDisplayName") or tm.get("name") or "",
            "abbr": tm.get("abbreviation") or "", "score": t.get("score"), "winner": t.get("winner")}


def game_line(e):
    hm, aw = e["home"], e["away"]
    if e["state"] == "pre":
        return f"{ts(e['date'])} {aw['abbr'] or aw['short']} @ {hm['abbr'] or hm['short']}"
    live = e["state"] == "in"
    return f"{'🔴 ' if live else ''}{aw['abbr'] or aw['short']} **{aw['score']}** – **{hm['score']}** {hm['abbr'] or hm['short']} · {e['detail']}"


def cmd_scores(o):
    sport, lg = o.get("sport") or "nba", o.get("league")
    if sport == "soccer" and lg and lg not in SOCCER_LEAGUES and not re.fullmatch(r"[a-z]{3}\.\d|[a-z]+\.[a-z_.]+", lg):
        return err("Soccer leagues look like eng.1, esp.1, ita.1, ger.1, fra.1, uefa.champions or usa.1.")
    evs = events(sport, lg)
    if not evs:
        return err(f"No {SPORTS[sport]} games today.")
    groups = [("Live", [e for e in evs if e["state"] == "in"]), ("Final", [e for e in evs if e["state"] == "post"]), ("Upcoming", [e for e in evs if e["state"] == "pre"])]
    fields = []
    for lab, es in groups:
        if not es:
            continue
        txt = ""
        for e in es:
            row = (f"*{e['lgName']}* " if sport == "soccer" else "") + game_line(e) + "\n"
            if len(txt) + len(row) > 1000:
                txt += "…"
                break
            txt += row
        fields.append({"name": lab, "value": txt})
    live = any(e["state"] == "in" for e in evs)
    return {"embeds": [{"title": f"{SPORTS[sport]} scores" + (f" · {SOCCER_LEAGUES.get(lg, lg)}" if lg else ""), "color": RED if live else BLUE, "fields": fields,
                        "footer": {"text": "ESPN · times in your time zone · Floodlight"}}]}


# ---------- predictions ----------
def am_p(x):
    x = num(str(x).replace("EVEN", "100").replace("+", "")) if x is not None else None
    if x is None or x == 0:
        return None
    return 100 / (x + 100) if x > 0 else -x / (-x + 100)


def market(e):
    """Win chances from the moneyline ESPN shows (DraftKings), margin removed."""
    od = e.get("odds") or {}
    def ml(side):
        t = od.get(f"{side}TeamOdds") or {}
        if t.get("moneyLine") is not None:
            return am_p(t["moneyLine"])
        m = (od.get("moneyline") or {}).get(side) or {}
        return am_p(((m.get("close") or m.get("open") or {}).get("odds")))
    ph, pa = ml("home"), ml("away")
    pd = am_p((od.get("drawOdds") or {}).get("moneyLine")) if od.get("drawOdds") else None
    if ph is None or pa is None:
        return None
    tot = ph + pa + (pd or 0)
    return {"home": ph / tot, "away": pa / tot, "draw": pd / tot if pd else None, "details": od.get("details") or "", "ou": od.get("overUnder"), "book": (od.get("provider") or {}).get("name") or "DraftKings"}


def find_game(sport, team, lg=None):
    nt = norm(team)
    today = dt.datetime.now(dt.timezone.utc)
    for add in range(0, 8 if sport in ("nfl", "soccer") else 4):
        day = (today + dt.timedelta(days=add)).strftime("%Y%m%d")
        for e in events(sport, lg, day if add else None):
            if e["state"] == "post":
                continue
            for side in ("home", "away"):
                t = e[side]
                if nt and (nt in norm(t["name"]) or nt == norm(t["abbr"]) or norm(t["short"]) == nt):
                    return e
    return None


BOARD_SPORT = {"nba": "basketball", "wnba": "basketball", "nfl": "football", "mlb": "baseball", "soccer": "soccer"}


def game_board(sport, e):
    """Every book's price for one game (odds.py), cached ten minutes so repeated asks don't hit the books again."""
    if sport not in BOARD_SPORT:
        return None
    odds = D["odds"]
    lg = e["lg"] if sport == "soccer" else sport
    if sport in ("soccer", "nfl"):
        q = odds.query_for(BOARD_SPORT[sport], lg, e["id"], e["home"]["name"], e["away"]["name"], e["date"].isoformat())
    else:
        q = {"sport": BOARD_SPORT[sport], "lg": lg, "id": e["id"] if sport in ("nba", "wnba") else "", "home": e["home"]["name"], "away": e["away"]["name"],
             "date": e["date"].isoformat(), "kx": "", "espn": f"basketball/{lg}" if sport in ("nba", "wnba") else ""}
    return memo(("board", sport, e["id"]), 600, lambda: (lambda b: {**b, "value": odds.value_picks(b)})(odds.board(q)))


MODEL_LG = {"nfl": "nfl", "nba": "nba", "wnba": "wnba"}     # sports the forecaster models (soccer by league slug)


def forecast_for(sport, e):
    """Floodlight's own forecast for one game (the site's forecaster: stats model + betting market, no paid AI)."""
    fc = D.get("forecaster")
    lg = e["lg"] if sport == "soccer" else MODEL_LG.get(sport)
    if not fc or not lg or not e.get("date"):
        return None, []
    return memo(("fc", sport, e["id"]), 600, lambda: fc.predict_now("soccer" if sport == "soccer" else "football", lg, e["id"], e["date"].isoformat(),
                                                                     e["home"]["name"], e["away"]["name"]))


def forecast_embed(sport, e, snap, plan):
    hm, aw = e["home"], e["away"]
    name = {"home": hm["name"], "away": aw["name"], "draw": "Draw"}
    pick, top, conf = snap["pick"], snap["top"], snap.get("conf") or ""
    fin = snap["final"]
    soccer = sport == "soccer"
    sh, sa = snap["score"]
    lines = [f"{ts(e['date'], 'F')} · {snap.get('league') or e['lgName']}", ""]
    lines.append(f"## {'🟰 Lean: Draw' if pick == 'draw' else '✅ Lean: ' + name[pick]} · {pct(top)}")
    lines.append(f"**{conf}** · predicted score **{hm['name']} {sh} – {sa} {aw['name']}**")
    lines.append(" · ".join(f"{name[k]} {pct(fin.get(k))}" for k in ("home", "draw", "away") if fin.get(k) is not None))
    fields = []
    if soccer:
        xg = snap.get("xg") or [None, None]
        likely = ", ".join(f"{i}-{j} ({pct(p)})" for i, j, p in (snap.get("likely") or [])[:3])
        fields.append({"name": "Goals", "value": f"Expected goals {hm['short']} {xg[0]} · {aw['short']} {xg[1]}\nOver 2.5 {pct(snap.get('o25'))} · Both score {pct(snap.get('btts'))}"
                       + (f"\nMost likely: {likely}" if likely else ""), "inline": False})
        lu = snap.get("lineup") or {}
        kind = {"standard": "Confirmed lineups", "confirmed": "Confirmed lineups", "predicted": "Predicted lineups"}.get(lu.get("type"))
        if kind:
            fields.append({"name": kind + " used", "value": " · ".join(
                f"{n}: {round(x['strength'] * 100)}% of best XI" for n, x in ((hm["short"], lu.get("home") or {}), (aw["short"], lu.get("away") or {})) if x.get("strength") is not None) or "In the model", "inline": False})
    else:
        mg = snap.get("margin") or 0
        fav = hm["name"] if mg >= 0 else aw["name"]
        fields.append({"name": "Spread and total", "value": f"{fav} by {abs(mg):.1f} · total {snap.get('total'):.1f}"
                       + (f"\nMarket: {snap['market']['details']}" + (f", O/U {fmt(num(snap['market']['total']))}" if snap['market'].get('total') else "")
                          if (snap.get("market") or {}).get("details") else ""), "inline": False})
    why = "\n".join("• " + r for r in (snap.get("reasons") or [])[:8])
    if why:
        fields.append({"name": "Why", "value": why[:1020], "inline": False})
    if plan:
        fields.append({"name": "Updates", "value": " · ".join(f"{'✓' if p['done'] else '○'} {p['label']}" + ("" if p["done"] else f" <t:{int(p['at'])}:R>")
                                                             for p in plan if p["done"] or p["at"] > time.time())[:1000], "inline": False})
    upd = int(snap.get("at") or time.time())
    return {"title": f"{aw['name']} @ {hm['name']}", "description": "\n".join(lines)[:4000], "color": GREEN if conf == "Strong" else BLUE, "fields": fields,
            "footer": {"text": "Floodlight forecast · stats model + betting market · free, no AI usage"}, "timestamp": dt.datetime.fromtimestamp(upd, dt.timezone.utc).isoformat()}


def projected(e, m):
    """A projected score from the spread and total, e.g. "NY 116-111 TOR"."""
    if not m.get("ou") or not m.get("details"):
        return None
    mt = re.match(r"\s*(\S+)\s+([+-]?[\d.]+)", m["details"])
    if not mt:
        return None
    tot, sp = num(m["ou"]), abs(num(mt.group(2)))
    hm, aw = e["home"], e["away"]
    fav_home = mt.group(1).upper() == (hm["abbr"] or "").upper()
    if not fav_home and mt.group(1).upper() != (aw["abbr"] or "").upper():
        return None
    hs, as_ = (tot + sp) / 2, (tot - sp) / 2
    if not fav_home:
        hs, as_ = as_, hs
    r = (lambda x: round(x)) if tot > 20 else (lambda x: round(x, 1))
    return f"{aw['abbr']} {r(as_)}-{r(hs)} {hm['abbr']}"


def cmd_predict(o):
    sport, team = o.get("sport") or "nba", o.get("team")
    if team:
        e = find_game(sport, team)
        if not e:
            return err(f"No upcoming {SPORTS[sport]} game found for {team} in the next few days.")
        hm, aw = e["home"], e["away"]
        snap = None
        if e["state"] == "pre":
            try:
                snap, plan = forecast_for(sport, e)
            except Exception as ex:
                print(f"/predict forecast failed: {type(ex).__name__}: {ex}")
        if snap:
            emb = forecast_embed(sport, e, snap, plan)
            try:
                b = game_board(sport, e)
            except Exception:
                b = None
            vals = (b or {}).get("value") or []
            if vals:
                emb["fields"].insert(len(emb["fields"]) - (1 if plan else 0), {"name": "Value bets (best price beats the consensus)", "value": "\n".join(
                    f"{label_of(v, hm, aw)} · {am_txt(v['price'])} at {v['book']} · edge {round(v['ev'] * 100)}%" for v in vals[:4])[:1000], "inline": False})
            return {"embeds": [emb]}
        m = market(e)
        desc = [f"{ts(e['date'], 'F')} · {e['lgName']}"]
        if m:
            desc.append(f"**{aw['name']}** {pct(m['away'])}" + (f" · Draw {pct(m['draw'])}" if m.get("draw") else "") + f" · **{hm['name']}** {pct(m['home'])}")
            if m["details"] or m["ou"]:
                desc.append(f"{m['details']}{' · O/U ' + fmt(num(m['ou'])) if m['ou'] else ''} ({m['book']})")
        fields = []
        try:
            b = game_board(sport, e)
        except Exception:
            b = None
        if b:
            fair = (b.get("ml") or {}).get("fair") or {}
            if fair:
                fields.append({"name": "Consensus (all books)", "value": " · ".join(f"{(hm['short'] if k == 'home' else aw['short'] if k == 'away' else 'Draw')} {pct(v)}" for k, v in fair.items() if v is not None) or "–", "inline": False})
            best = {k: v for k, v in ((b.get("ml") or {}).get("best") or {}).items() if v}
            if best:
                fields.append({"name": "Best moneyline", "value": "\n".join(f"{(hm['short'] if k == 'home' else aw['short'] if k == 'away' else 'Draw')}: {am_txt(v['price'])} at {v['book']}" for k, v in best.items() if v) or "–", "inline": True})
            tots = b.get("totals") or []
            if tots:
                t = max(tots, key=lambda t: len(t["offers"]))
                fields.append({"name": f"Total {fmt(t['line'])}", "value": f"Over {pct((t.get('fair') or {}).get('over'))} · Under {pct((t.get('fair') or {}).get('under'))}", "inline": True})
            vals = b.get("value") or []
            if vals:
                fields.append({"name": "Value bets (best price beats the consensus)", "value": "\n".join(
                    f"{label_of(v, hm, aw)} · {am_txt(v['price'])} at {v['book']} · edge {round(v['ev'] * 100)}%" for v in vals[:6])[:1000], "inline": False})
        if not m and not fields:
            desc.append("No prices posted for this game yet.")
        return {"embeds": [{"title": f"{aw['name']} @ {hm['name']}", "description": "\n".join(desc), "color": BLUE, "fields": fields,
                            "footer": {"text": "Market-implied chances, margin removed · Floodlight predictions"}}]}
    evs = [e for e in events(sport) if e["state"] != "post"]
    if not evs and sport != "soccer":
        tomorrow = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).strftime("%Y%m%d")
        evs = [e for e in events(sport, None, tomorrow) if e["state"] != "post"]
    rows = []
    for e in evs:
        m = market(e)
        if not m:
            continue
        side = max(("home", "away", "draw"), key=lambda k: m.get(k) or 0)
        pick = "Draw" if side == "draw" else e[side]["name"]
        proj = projected(e, m)
        rows.append((m[side], f"{'🔴 ' if e['state'] == 'in' else ''}{ts(e['date'])} {e['away']['abbr'] or e['away']['short']} @ {e['home']['abbr'] or e['home']['short']} → **{pick} {pct(m[side])}**"
                              + (f" · proj {proj}" if proj else "")
                              + (f" · {m['details']}" if m["details"] else "") + (f" · O/U {fmt(num(m['ou']))}" if m["ou"] else "")))
    if not rows:
        return err(f"No {SPORTS[sport]} games with prices posted right now.")
    rows.sort(key=lambda r: -r[0])
    return {"embeds": [{"title": f"{SPORTS[sport]} predictions", "description": "\n".join(r[1] for r in rows[:20])[:4000], "color": BLUE,
                        "footer": {"text": "Lean from the betting market, projected score from the spread and total · /predict team:<name> for the full forecast · Floodlight"}}]}


def am_txt(p):
    a = (p or {}).get("am")
    return "–" if a is None else f"+{a}" if a > 0 else str(a)


def label_of(v, hm, aw):
    if v["type"] == "ml":
        return {"home": hm["short"], "away": aw["short"], "draw": "Draw"}.get(v["label"], v["label"]) + " to win"
    return v["label"]


# ---------- /lineup ----------
def cmd_lineup(o):
    sport, team = o.get("sport") or "soccer", o.get("team") or ""
    if sport == "soccer":
        return soccer_lineup(team)
    if sport == "mlb":
        return mlb_lineup(team)
    e = find_game(sport, team)
    if not e:
        return err(f"No upcoming {SPORTS[sport]} game found for {team}.")
    d = get_json(f"{ESPN}/{ESPN_PATH[sport]}/summary?event={e['id']}", 600)
    fields = []
    for t in d.get("injuries") or []:
        name = (t.get("team") or {}).get("displayName") or ""
        rows = [f"{(i.get('athlete') or {}).get('displayName', '?')} · {i.get('status') or (i.get('type') or {}).get('description') or ''}" for i in t.get("injuries") or []]
        if rows:
            fields.append({"name": f"{name} injuries", "value": "\n".join(rows)[:1000], "inline": True})
    return {"embeds": [{"title": f"{e['away']['name']} @ {e['home']['name']}", "description": f"{ts(e['date'], 'F')}\n" + ("" if fields else "No injuries listed."),
                        "color": BLUE, "fields": fields, "footer": {"text": "ESPN injury report · Floodlight"}}]}


def soccer_lineup(team):
    nt = norm(team)
    best = None
    today = dt.datetime.now(dt.timezone.utc)
    for add in range(0, 8 if sport in ("nfl", "soccer") else 4):
        day = (today + dt.timedelta(days=add)).strftime("%Y%m%d")
        try:
            data = get_json(f"https://www.fotmob.com/api/data/matches?date={day}", 600) or {}
        except Exception:
            continue
        for lg in data.get("leagues") or []:
            for m in lg.get("matches") or []:
                if (m.get("status") or {}).get("finished"):
                    continue
                for side in ("home", "away"):
                    t = m.get(side) or {}
                    names = norm(t.get("longName")) + " " + norm(t.get("name"))
                    # "Arsenal" means the men's team; women's and youth sides only when asked for by name
                    other = re.search(r"\b(w|women|u\d\d|ii|b)\b", names) and not re.search(r"\b(w|women|u\d\d|ii|b)\b", nt)
                    if nt and nt in names and not other:
                        best = (day, m, lg.get("name"))
                        break
                if best:
                    break
            if best:
                break
        if best:
            break
    if not best:
        return err(f"No upcoming soccer match found for {team} in the next few days.")
    day, m, lgname = best
    hn, an = (m.get("home") or {}).get("name"), (m.get("away") or {}).get("name")
    lu = D["fm_lineup"](day, hn, an)
    if lu.get("error") or not lu.get("home"):
        return err(f"{hn} vs {an}: no lineup published yet. FotMob usually posts a predicted one a day or two before kick-off.")
    label = {"predicted": "Predicted lineups", "standard": "Confirmed lineups", "confirmed": "Confirmed lineups", "lastStarting11": "Last starting XI (predictions not out yet)"}.get(lu.get("type"), "Lineups")
    fields = []
    for side in ("home", "away"):
        t = lu[side]
        xi = ", ".join(p.get("last") or p.get("name") or "?" for p in t.get("starters") or [])
        out = "; ".join(f"{u['name']} ({u.get('type') or 'out'})" for u in t.get("unavailable") or [])
        fields.append({"name": f"{t.get('name')} · {t.get('formation') or ''}", "value": (xi or "–")[:900] + (f"\n**Out:** {out}"[:120] if out else ""), "inline": False})
    start = parse_date((m.get("status") or {}).get("utcTime"))
    return {"embeds": [{"title": f"{hn} vs {an}", "url": lu.get("url"), "description": f"**{label}** · {lgname}" + (f" · {ts(start, 'F')}" if start else ""),
                        "color": GREEN, "fields": fields, "footer": {"text": "FotMob · Floodlight lineups"}}]}


def mlb_lineup(team):
    nt = norm(team)
    today = dt.datetime.now(dt.timezone.utc)
    for add in range(0, 3):
        day = (today + dt.timedelta(days=add)).strftime("%Y-%m-%d")
        d = get_json(f"{SAPI}/schedule?sportId=1&date={day}&hydrate=lineups,probablePitcher,team", 300)
        for dd in d.get("dates") or []:
            for g in dd.get("games") or []:
                tm = g.get("teams") or {}
                names = [norm((tm.get(s) or {}).get("team", {}).get("name")) for s in ("home", "away")]
                if not any(nt and nt in n for n in names) or (g.get("status") or {}).get("abstractGameState") == "Final":
                    continue
                fields = []
                for s, key in (("away", "awayPlayers"), ("home", "homePlayers")):
                    t = tm.get(s) or {}
                    pp = (t.get("probablePitcher") or {}).get("fullName") or "TBD"
                    order = [p.get("fullName") for p in (g.get("lineups") or {}).get(key) or []]
                    fields.append({"name": (t.get("team") or {}).get("name", s), "value": f"**SP:** {pp}\n" + ("\n".join(f"{i}. {n}" for i, n in enumerate(order, 1)) if order else "Batting order not posted yet."), "inline": True})
                return {"embeds": [{"title": f"{tm['away']['team']['name']} @ {tm['home']['team']['name']}", "description": ts(parse_date(g.get("gameDate")), "F"),
                                    "color": GREEN, "fields": fields, "footer": {"text": "MLB StatsAPI · Floodlight lineups"}}]}
    return err(f"No upcoming MLB game found for {team}.")


# ---------- /help ----------
def cmd_help(o):
    return {"embeds": [{"title": "Floodlight bot", "color": BLUE, "url": SITE or None, "description": "\n".join([
        "`/research` a player's hit rate on any stat and line: last 5 / 10 / 20 games, this season, vs an opponent. Leave the line empty to use today's PrizePicks line.",
        "`/lab` opens **Floodlight Lab** right in the channel: any player or team, every stat, hit rates at any line, trends, splits and the full game log.",
        "`/props` today's PrizePicks and Sleeper lines ranked by recent hit rate.",
        "`/scores` live scores, finals and today's schedule.",
        "`/predict` the day's leans with a projected score. Add a team for Floodlight's full forecast: lean, predicted score, chances, the reasons, value bets.",
        "`/lineup` predicted or confirmed soccer lineups, MLB batting orders and probable pitchers, injury reports.",
        "`/record` Floodlight's own prediction record: W-L, hit rate, streak and the latest results.",
        "`/leaderboard` each pick channel's record (props: a card is one play; soccer: every pick counts). Results post in #verified-records at 12:30 AM ET, re-checked at 8 AM.",
        "", "Hit rates are past results, not guarantees. Bet responsibly."])}]}


# ---------- /record ----------
def cmd_record(o):
    rec = D.get("record")
    if not rec:
        raise LookupError("The record isn't available on this server.")
    sport = o.get("sport") if o.get("sport") in ("soccer", "football") else None
    days = int(o.get("days") or 0)
    since = time.time() - days * 86400 if days else None
    s = rec.summary(sport, since)
    if not s["won"] and not s["lost"]:
        return {"embeds": [{"title": "Floodlight's record", "color": BLUE, "description": "No graded predictions yet. Picks are logged at kick-off and graded at full time."
                            + (f" {s['pending']} waiting on a result." if s["pending"] else "")}]}
    st = s["streak"] or {}
    mark = {"won": "✅", "lost": "❌"}
    lines = []
    for e in s["last"] or []:
        side = "Draw" if e["pick"] == "draw" else e[e["pick"]]
        lines.append(f"{mark.get(e['result'], '•')} {e['home']} {e['final'][0]}-{e['final'][1]} {e['away']} · picked **{side}** ({round((e['top'] or 0) * 100)}%)")
    scope = ("Soccer" if sport == "soccer" else "American football" if sport == "football" else "All sports") + (f", last {days} days" if days else ", all time")
    return {"embeds": [{"title": "Floodlight's record", "url": (SITE + "/#record") if SITE else None, "color": GREEN if (s["rate"] or 0) >= .5 else RED,
                        "description": scope, "fields": [
                            {"name": "Record", "value": f"**{s['won']}-{s['lost']}**", "inline": True},
                            {"name": "Hit rate", "value": f"**{round(s['rate'] * 100)}%**", "inline": True},
                            {"name": "Streak", "value": f"{'W' if st.get('kind') == 'won' else 'L'}{st.get('n', 0)}", "inline": True},
                            {"name": "Latest results", "value": "\n".join(lines)[:1000] or "–", "inline": False}],
                        "footer": {"text": f"Logged at kick-off, graded at full time · {s['pending']} pending · Past results, not guarantees"}}]}


def cmd_leaderboard(o):
    import pick_tracker
    return pick_tracker.cmd_leaderboard(o)


def cmd_checkpicks(o):
    import pick_tracker
    return pick_tracker.cmd_check(o)


COMMANDS = {"research": cmd_research, "props": cmd_props, "scores": cmd_scores, "predict": cmd_predict, "lineup": cmd_lineup, "record": cmd_record,
            "leaderboard": cmd_leaderboard, "checkpicks": cmd_checkpicks, "help": cmd_help}


def err(msg):
    return {"embeds": [{"description": msg[:4000], "color": GREY}]}


def clean(msg):
    """Drop empty embed parts: Discord rejects null thumbnails and urls."""
    for e in msg.get("embeds") or []:
        for k in [k for k, v in e.items() if v in (None, "", [])]:
            e.pop(k)
    return msg


def run(name, opts):
    fn = COMMANDS.get(name)
    if not fn:
        return err("Unknown command.")
    try:
        with _work:
            return clean(fn(opts))
    except LookupError as e:
        return err(str(e))
    except Exception as e:
        print(f"discord: /{name} failed: {type(e).__name__}: {e}", file=sys.stderr)
        return err("A data source didn't answer. Try again in a minute.")


# ---------- talking to Discord ----------
def verify(body, sig, stamp):
    key = os.environ.get("DISCORD_PUBLIC_KEY", "")
    if not key or not sig or not stamp:
        return False
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(key)).verify(bytes.fromhex(sig), stamp.encode() + body)
        return True
    except Exception:
        return False


_blocked = {}


def discord(method, path, payload=None, token=None):
    headers = {"User-Agent": UA, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bot {token}"
    data = json.dumps(payload).encode() if payload is not None else None
    # While Cloudflare is blocking this server's address (error 1015), every extra call keeps the block alive: stay quiet until it lifts.
    if time.time() < _blocked.get("until", 0):
        raise urllib.error.HTTPError(path, 429, "Discord is rate limiting this server (waiting it out)", None, None)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(path if path.startswith("http") else API + path, data=data, method=method, headers=headers), timeout=20) as r:
                body = r.read()
                _blocked["n"] = 0
                return json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                raw = e.read()
                try:
                    info = json.loads(raw)
                    wait = float(info.get("retry_after", 2))
                except Exception:
                    # not JSON: Cloudflare is limiting this server's address. Retrying only extends it, so stop and back off.
                    _blocked["n"] = _blocked.get("n", 0) + 1
                    pause = min(1800, 240 * _blocked["n"])
                    _blocked["until"] = time.time() + pause
                    print(f"discord: Cloudflare is limiting this server ({raw[:40]!r}) on {method} {path.split('?')[0][:60]}; no Discord calls for {pause}s", file=sys.stderr)
                    raise
                print(f"discord: rate limited on {method} {path.split('?')[0][:60]} (wait {wait}s, global={info.get('global')}, "
                      f"{'json' if info else raw[:80]!r})", file=sys.stderr)
                time.sleep(min(30, wait + 0.5))
                continue
            raise


def options(data):
    out = {}
    for o in data.get("options") or []:
        if o.get("type") in (1, 2):   # subcommands, in case they are added later
            out.update(options(o))
        else:
            out[o["name"]] = o.get("value")
    return out


def handle(body, headers):
    """POST /api/discord/interactions -> (status, response dict)."""
    if not verify(body, headers.get("X-Signature-Ed25519"), headers.get("X-Signature-Timestamp")):
        return 401, {"error": "bad signature"}
    it = json.loads(body or b"{}")
    t = it.get("type")
    if t == 1:   # Discord checking the endpoint
        return 200, {"type": 1}
    data = it.get("data") or {}
    if t == 4:   # autocomplete for the stat box
        return 200, {"type": 8, "data": {"choices": autocomplete(data)}}
    if t != 2:
        return 200, {"type": 4, "data": {"content": "Not supported.", "flags": 64}}
    name, opts = data.get("name"), options(data)
    if name != "help" and not is_member(it):
        return 200, {"type": 4, "data": {"flags": 64, "content": "Floodlight's commands are for members. Ask a server admin for the member role."}}
    if name == "help":
        return 200, {"type": 4, "data": clean(cmd_help(opts))}
    if name == "lab" or data.get("type") == 4:   # /lab, or the Activity launcher's entry-point command: open the Lab
        return lab_launch(it, opts)
    if name == "checkpicks":
        try:
            admin = int((it.get("member") or {}).get("permissions") or 0) & 0x8
        except ValueError:
            admin = 0
        if not admin:
            return 200, {"type": 4, "data": {"flags": 64, "content": "Only server admins can run the pick check."}}

    # A quick answer goes back in this very response, which needs no call out to Discord (and so works even while Discord
    # is rate limiting this server). A slow one shows "Floodlight is thinking..." and is edited in when ready.
    box, quick, late = {}, threading.Event(), threading.Event()

    def work():
        box["msg"] = run(name, opts)
        quick.set()
        late.wait(1)
        if not box.get("late"):
            return
        for wait in (0, 20, 60, 150, 300):   # the reply can be edited in for 15 minutes; keep trying through a rate limit
            time.sleep(wait)
            try:
                discord("PATCH", f"/webhooks/{it['application_id']}/{it['token']}/messages/@original", box["msg"])
                return
            except Exception as e:
                print(f"discord: couldn't send the reply: {e}", file=sys.stderr)
    threading.Thread(target=work, daemon=True, name=f"discord-{name}").start()
    if quick.wait(2.2):
        late.set()
        return 200, {"type": 4, "data": box["msg"]}
    box["late"] = True
    late.set()
    return 200, {"type": 5}


def lab_launch(it, opts):
    """Leave a ticket for this channel, open the Lab as an Activity, and follow up (only to the caller) with a browser link."""
    import lab
    who = ((it.get("member") or {}).get("user") or it.get("user") or {}).get("id") or ""
    lab.ticket(it.get("channel_id") or (it.get("channel") or {}).get("id"), opts, who)
    link = lab.browser_link(opts, who)
    if os.environ.get("DISCORD_ACTIVITY", "1") == "0":   # Activities turned off for the app: just the link
        if not link:
            return 200, {"type": 4, "data": {"flags": 64, "content": "The Lab needs FLOODLIGHT_URL set on the server."}}
        return 200, {"type": 4, "data": {"flags": 64, "content": "**Floodlight Lab** is ready.", "components": [
            {"type": 1, "components": [{"type": 2, "style": 5, "label": "Open the Lab", "url": link}]}]}}

    def follow():
        if not link:
            return
        time.sleep(1.5)
        try:
            discord("POST", f"/webhooks/{it['application_id']}/{it['token']}", {"flags": 64, "content": "The Lab is opening in this channel. Prefer a full browser window?",
                    "components": [{"type": 1, "components": [{"type": 2, "style": 5, "label": "Open the Lab in your browser", "url": link}]}]})
        except Exception as e:
            print(f"discord: lab link follow-up failed: {e}", file=sys.stderr)
    threading.Thread(target=follow, daemon=True, name="discord-lab").start()
    return 200, {"type": 12}   # LAUNCH_ACTIVITY


def is_member(it):
    """DISCORD_MEMBER_ROLES (role ids, comma separated) limits the commands to people with one of those roles.
    Server admins always get in; with the variable unset, everyone does."""
    want = set(re.findall(r"\d{5,25}", os.environ.get("DISCORD_MEMBER_ROLES", "")))
    if not want:
        return True
    m = it.get("member") or {}
    try:
        if int(m.get("permissions") or 0) & 0x8:   # Administrator
            return True
    except ValueError:
        pass
    return bool(want & set(m.get("roles") or []))


def autocomplete(data):
    opts = {o["name"]: o for o in data.get("options") or []}
    sport = (opts.get("sport") or {}).get("value") or ("soccer" if data.get("name") == "lineup" else "nba")
    typed = norm(next((o.get("value") for o in opts.values() if o.get("focused")), ""))
    rows = list(STAT.get(stat_sport(sport), {}).values())
    hits = [s for s in rows if not typed or typed in norm(s["l"]) or typed == s["k"]]
    return [{"name": s["l"], "value": s["k"]} for s in hits[:25]]


# ---------- scheduled posts ----------
def digest(sport):
    out = []
    for fn, opts in ((cmd_props, {"sport": sport, "count": 8}), (cmd_predict, {"sport": sport})):
        msg = run(fn.__name__[4:], opts)
        if msg["embeds"] and msg["embeds"][0].get("color") != GREY:
            out += msg["embeds"]
    return out


def _digest_loop():
    hours = {int(x) for x in re.findall(r"\d+", os.environ.get("DISCORD_DIGEST_HOURS", "14")) if int(x) < 24}
    sports = [s for s in re.split(r"[,\s]+", os.environ.get("DISCORD_DIGEST_SPORTS", "nba,nfl,nhl,mlb,soccer").lower()) if s in SPORTS]
    mark = D.get("cache_dir") and (D["cache_dir"] / "discord-digest.txt")
    while True:
        time.sleep(60)
        now = dt.datetime.now(dt.timezone.utc)
        slot = now.strftime("%Y-%m-%d %H")
        if now.hour not in hours:
            continue
        try:
            if mark and mark.exists() and mark.read_text().strip() == slot:
                continue
            if mark:
                mark.parent.mkdir(exist_ok=True)
                mark.write_text(slot)
        except OSError:
            pass
        for sp in sports:
            embeds = digest(sp)
            if not embeds:
                continue   # a sport out of season posts nothing
            try:
                discord("POST", os.environ["DISCORD_WEBHOOK_URL"], {"username": "Floodlight", "content": f"**{SPORTS[sp]} daily digest**", "embeds": embeds[:10]})
            except Exception as e:
                print(f"discord: digest post failed: {e}", file=sys.stderr)


# ---------- registering the slash commands (run once, and again after changing them) ----------
SPORT_CHOICES = [{"name": v, "value": k} for k, v in SPORTS.items()]


def command_defs():
    sport = lambda req=False, desc="Sport (default NBA)": {"type": 3, "name": "sport", "description": desc, "required": req, "choices": SPORT_CHOICES}
    return [
        {"name": "research", "description": "A player's hit rate on a stat and line over their recent games", "options": [
            {"type": 3, "name": "player", "description": "Player name, e.g. Jayson Tatum", "required": True},
            {"type": 3, "name": "stat", "description": "Stat, e.g. Points or Pts + Reb + Ast", "required": True, "autocomplete": True},
            {"type": 10, "name": "line", "description": "The line, e.g. 24.5 (default: today's PrizePicks line)"},
            sport(),
            {"type": 3, "name": "side", "description": "Over or under (default over)", "choices": [{"name": "Over", "value": "over"}, {"name": "Under", "value": "under"}]},
            {"type": 3, "name": "opponent", "description": "Also show the hit rate against this team"}]},
        {"name": "props", "description": "Today's PrizePicks and Sleeper lines ranked by recent hit rate", "options": [
            sport(True, "Sport"), {"type": 3, "name": "stat", "description": "Only this stat", "autocomplete": True},
            {"type": 4, "name": "count", "description": "How many (default 10)", "min_value": 3, "max_value": 20}]},
        {"name": "scores", "description": "Live scores, finals and today's schedule", "options": [
            sport(True, "Sport"), {"type": 3, "name": "league", "description": "Soccer league code, e.g. eng.1, esp.1, uefa.champions"}]},
        {"name": "predict", "description": "Floodlight's forecast: lean, predicted score and why; add a team for one game in detail", "options": [
            sport(True, "Sport"), {"type": 3, "name": "team", "description": "One team's next game: lean, score, chances and reasons"}]},
        {"name": "lineup", "description": "Predicted or confirmed lineups, probable pitchers and injuries", "options": [
            {"type": 3, "name": "team", "description": "Team name, e.g. Arsenal or Yankees", "required": True}, sport(False, "Sport (default soccer)")]},
        {"name": "record", "description": "Floodlight's prediction record: W-L, hit rate, streak and latest results", "options": [
            {"type": 3, "name": "sport", "description": "Only this sport", "choices": [{"name": "Soccer", "value": "soccer"}, {"name": "American football", "value": "football"}]},
            {"type": 4, "name": "days", "description": "Only the last N days", "min_value": 1, "max_value": 365}]},
        {"name": "leaderboard", "description": "Each pick channel's W-L record (props cards as one play, soccer picks one by one)", "options": [
            {"type": 4, "name": "days", "description": "Only the last N days", "min_value": 1, "max_value": 365}]},
        {"name": "checkpicks", "description": "Admins: grade the pick channels now and show every card (post:True also posts results)", "default_member_permissions": "8",
         "options": [{"type": 5, "name": "post", "description": "Also post finished results in #verified-records", "required": False}]},
        {"name": "lab", "description": "Open Floodlight Lab: a full research screen for any player, right here in Discord", "options": [
            {"type": 3, "name": "player", "description": "Open straight to this player, e.g. Jayson Tatum"},
            {"type": 3, "name": "team", "description": "Or open straight to this team, e.g. Celtics or Arsenal"}, sport(False, "Sport (default NBA)")]},
        {"name": "help", "description": "What the Floodlight bot can do"},
    ]


def register(only_if_changed=False):
    app, token, guild = os.environ.get("DISCORD_APP_ID"), os.environ.get("DISCORD_BOT_TOKEN"), os.environ.get("DISCORD_GUILD_ID")
    if not app or not token:
        sys.exit("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN first (Discord Developer Portal > your app).")
    path = f"/applications/{app}/guilds/{guild}/commands" if guild else f"/applications/{app}/commands"
    want = command_defs()
    try:
        have = discord("GET", path, token=token) or []
    except Exception:
        have = None
    # Turning on Activities gives the app an "entry point" command (the Activity launcher's button). Discord refuses a
    # bulk update that leaves it out, so keep it, and have it come to this server so the launcher checks roles too.
    entry = lab_entry_point(app, token, have if not guild else None)
    if entry and not guild:
        want = want + [entry]
    if only_if_changed and have is not None:
        shape = lambda cs: sorted(json.dumps({"n": c["name"], "d": c["description"], "o": [(o["name"], o.get("type")) for o in c.get("options") or []]}) for c in cs if c.get("type", 1) != 4)
        if shape(have) == shape(want):
            return
    got = discord("PUT", path, want, token=token)
    print(f"Discord bot: registered {len(got)} commands {'in server ' + guild if guild else 'globally (can take up to an hour to appear)'}: " + ", ".join("/" + c["name"] for c in got))


def lab_entry_point(app, token, have=None):
    """The app's Activity entry-point command (global, type 4), set to be handled here (handler 1). None without Activities."""
    try:
        if have is None:
            have = discord("GET", f"/applications/{app}/commands", token=token) or []
        e = next((c for c in have if c.get("type") == 4), None)
        if not e:
            return None
        desc = "Open Floodlight Lab, the player research screen"
        if e.get("handler") != 1 or e.get("description") != desc:
            e = discord("PATCH", f"/applications/{app}/commands/{e['id']}", {"handler": 1, "description": desc}, token=token) or e
        return {k: e[k] for k in ("id", "name", "type", "description", "handler", "integration_types", "contexts") if e.get(k) is not None}
    except Exception as ex:
        print(f"Discord bot: couldn't check the Activity entry point: {ex}", file=sys.stderr)
        return None


def _register_on_start():
    try:
        register(only_if_changed=True)
    except Exception as e:
        print(f"Discord bot: couldn't register the commands: {e}", file=sys.stderr)


if __name__ == "__main__":
    if sys.argv[1:2] == ["register"]:
        register()
    elif sys.argv[1:2] == ["try"]:   # python3 discord_bot.py try research player="Jayson Tatum" stat=pts
        args, sys.argv = sys.argv[2:], sys.argv[:1]
        import server   # the same data functions the site uses
        setup(fetch=server.fetch, similar=server.similar, fm_player=server.fm_player, fm_matchstats=server.fm_matchstats,
              fm_lineup=server.fm_lineup, odds=server.odds, dfs=server.dfs)
        server.odds.setup(fetch=server.fetch, similar=server.similar)
        opts = dict(a.split("=", 1) for a in args[1:])
        if "line" in opts:
            opts["line"] = float(opts["line"])
        print(json.dumps(run(args[0], opts), indent=1, default=str))
    else:
        print(__doc__)
