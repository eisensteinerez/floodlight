"""Floodlight pick'em lines: PrizePicks and Sleeper player props for a whole league at once.

  /api/dfs/lines?sport=nba|wnba|nfl|mlb|nhl|soccer|cfb|cbb|tennis

PrizePicks posts a line per player and stat (standard, plus easier "goblin" and harder "demon" lines) at fixed
payouts, so it has no odds. Sleeper posts a line with a payout multiplier for each side; the two multipliers give
the chance Sleeper puts on the over. Both are unofficial public feeds that can change or block outside apps, so
each source fails on its own and the reason is passed to the page. The last result per source is written to
.floodlight-cache/dfs-status.json to make problems easy to see.
"""
import gzip
import json
import re
import threading
import time
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PP_LEAGUES = {"nba": 7, "wnba": 3, "nfl": 9, "mlb": 2, "nhl": 8, "soccer": 82, "cfb": 15, "cbb": 20, "tennis": 5}
SLEEPER_SPORT = {"nba": "nba", "wnba": "wnba", "nfl": "nfl", "mlb": "mlb", "nhl": "nhl", "soccer": "soccer", "cfb": "cfb", "cbb": "cbb", "tennis": "tennis"}
STATUS = Path(__file__).resolve().parent / ".floodlight-cache" / "dfs-status.json"
_cache, _lock, _status = {}, threading.Lock(), {}


def _get(url, ttl, headers=None):
    now = time.time()
    with _lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < ttl:
            return hit[1]
    h = {"User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=20) as r:
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
    data = json.loads(body)
    with _lock:
        _cache[url] = (now, data)
    return data


def _note(source, sport, ok, detail):
    _status[f"{source}:{sport}"] = {"ok": ok, "detail": str(detail)[:300], "at": time.strftime("%Y-%m-%d %H:%M:%S")}
    try:
        STATUS.parent.mkdir(exist_ok=True)
        STATUS.write_text(json.dumps(_status, indent=1))
    except OSError:
        pass


def prizepicks(sport):
    lid = PP_LEAGUES.get(sport)
    if not lid:
        return []
    d = _get(f"https://api.prizepicks.com/projections?league_id={lid}&per_page=1000&single_stat=true&game_mode=pickem", 120,
             {"Origin": "https://app.prizepicks.com", "Referer": "https://app.prizepicks.com/"})
    people = {}
    for x in d.get("included") or []:
        if x.get("type") in ("new_player", "player"):
            a = x.get("attributes") or {}
            people[str(x.get("id"))] = {"name": a.get("display_name") or a.get("name"), "team": a.get("team") or a.get("team_name"),
                                        "pos": a.get("position"), "img": a.get("image_url")}
    out = []
    for p in d.get("data") or []:
        a = p.get("attributes") or {}
        rel = ((p.get("relationships") or {}).get("new_player") or {}).get("data") or {}
        who = people.get(str(rel.get("id"))) or {}
        if not who.get("name") or a.get("line_score") is None or a.get("status") not in (None, "pre_game"):
            continue
        out.append({"book": "prizepicks", "player": who["name"], "team": who.get("team"), "pos": who.get("pos"), "stat": a.get("stat_type") or "",
                    "line": float(a["line_score"]), "kind": a.get("odds_type") or "standard", "start": a.get("start_time"),
                    "opp": a.get("description"), "img": who.get("img")})
    return out


def _sleeper_players(sport):
    for url in (f"https://api.sleeper.app/v1/players/{sport}", f"https://api.sleeper.app/players/{sport}"):
        try:
            d = _get(url, 12 * 3600)
            if isinstance(d, dict) and d:
                return d
        except Exception:
            continue
    return {}


def sleeper(sport):
    sp = SLEEPER_SPORT.get(sport)
    if not sp:
        return []
    d = _get("https://api.sleeper.app/lines/available?dynamic=true&include_preseason=true&eg=15.control", 120,
             {"Origin": "https://sleeper.com", "Referer": "https://sleeper.com/"})
    rows = d if isinstance(d, list) else d.get("lines") or d.get("data") or []
    rows = [x for x in rows if (x.get("sport") or "").lower() == sp and (x.get("subject_type") or "player") == "player" and x.get("status", "active") == "active"]
    players = _sleeper_players(sp) if rows else {}
    out = []
    for x in rows:
        p = players.get(str(x.get("subject_id"))) or {}
        name = p.get("full_name") or " ".join(filter(None, (p.get("first_name"), p.get("last_name"))))
        if not name:
            continue
        sides = {}
        for o in x.get("options") or []:
            k = (o.get("outcome") or "").lower()
            try:
                sides.setdefault(o.get("outcome_value"), {})[k] = float(o.get("payout_multiplier"))
            except (TypeError, ValueError):
                continue
        for line, s in sides.items():
            if line is None or "over" not in s and "under" not in s:
                continue
            row = {"book": "sleeper", "player": name, "team": p.get("team"), "pos": p.get("position"), "stat": x.get("wager_type") or x.get("market_type") or "",
                   "line": float(line), "overMult": s.get("over"), "underMult": s.get("under")}
            if s.get("over") and s.get("under"):
                io, iu = 1 / s["over"], 1 / s["under"]
                row["pOver"] = round(io / (io + iu), 3)
            out.append(row)
    return out


def lines(sport):
    res, errors = [], {}
    for name, fn in (("prizepicks", prizepicks), ("sleeper", sleeper)):
        try:
            got = fn(sport)
            res += got
            _note(name, sport, True, f"{len(got)} lines")
        except Exception as e:
            errors[name] = f"{type(e).__name__}: {e}"[:160]
            _note(name, sport, False, errors[name])
    return {"sport": sport, "lines": res, "errors": errors, "fetched": int(time.time())}


def handle(path, q):
    if path == "lines":
        sport = q.get("sport", "")
        if sport not in PP_LEAGUES:
            return 400, {"error": "unknown sport"}, 0
        return 200, lines(sport), 60
    return 404, {"error": "unknown endpoint"}, 0
