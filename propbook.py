"""Floodlight's record of player props: every prop the Predictions page shows before its game is locked in here and
graded when the game is over, so the page can say how its props did, good or bad.

How a prop gets in. The edge board is worked out in the browser (edge.js and meter.js), so the Predictions page sends
the props it shows (POST /api/props/seen). The server keeps one entry per player, stat and game day:
  - "first": the reading the first time the prop was shown (our chance, the market's chance, the edge, the books).
    It is locked: later readings never change it, and nothing is accepted once the game has started.
  - "close": the last reading before the start, at whatever line was posted then. Comparing it with "first" is the
    closing-line check: did the line, or the market's price at the same line, move the way the pick said?
A prop is accepted only if the server's own board for that sport lists the same player, stat and line, so a page can't
add props that were never posted.

Grading uses pick_grade.py (the Discord pick grader): the player's ESPN game log for NBA, WNBA, NFL and NHL, and MLB's
own game log for baseball. Results: won, lost, push (landed on the line), void (didn't play, or postponed) and unknown
(the game couldn't be found for certain), with the number he put up. Soccer props aren't graded yet and say so.

Saved in propbook.json through storage.py.
"""
import datetime as dt
import re
import threading
import time
from pathlib import Path

import storage

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:
    ET = dt.timezone(dt.timedelta(hours=-5))

SPORTS = ("nba", "wnba", "nfl", "nhl", "mlb", "soccer")
BOOKS = ("prizepicks", "sleeper", "underdog")
KEEP = 6000
GRADE_AFTER = {"nfl": 4.5 * 3600, "mlb": 4 * 3600}     # from the start; others 3.5 hours
GIVE_UP = 5 * 86400

D = {}            # cache_dir, board(sport) -> the Lab board, grade(g, slate) -> (result, shown), mlb(g, slate)
BOOK = {}
_lock = threading.RLock()
_state = {"dirty": False}


def _path():
    return Path(D["cache_dir"]) / "propbook.json"


def setup(**deps):
    D.update(deps)
    BOOK.update(storage.load(_path(), {}))
    if deps.get("loop", True):
        threading.Thread(target=_loop, daemon=True, name="propbook").start()


def _save():
    with _lock:
        if len(BOOK) > KEEP:
            for k in sorted(BOOK, key=lambda k: BOOK[k].get("start") or 0)[:len(BOOK) - KEEP]:
                BOOK.pop(k, None)
        storage.save(_path(), dict(BOOK))
        _state["dirty"] = False


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s+", " ", str(s or "").lower())).strip()


def _num(v, lo=None, hi=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        return None
    return float(v)


def game_day(start):
    return dt.datetime.fromtimestamp(start, dt.timezone.utc).astimezone(ET).date().isoformat()


def _posted(sport):
    """{(player, stat): {line: books}} from the server's own board, so only real lines are kept."""
    try:
        b = D["board"](sport) or {}
    except Exception:
        return None
    out = {}
    for r in b.get("rows") or []:
        out.setdefault((norm(r.get("player")), r.get("k")), {})
        for o in r.get("offers") or []:
            if isinstance(o.get("line"), (int, float)):
                out[(norm(r.get("player")), r.get("k"))].setdefault(float(o["line"]), set()).add(o.get("book"))
        if isinstance(r.get("line"), (int, float)):
            out[(norm(r.get("player")), r.get("k"))].setdefault(float(r["line"]), set())
    return out


def _clean(p, now):
    """A prop from the page, checked, or None."""
    if not isinstance(p, dict) or p.get("sport") not in SPORTS:
        return None
    name, k, label = str(p.get("player") or "").strip()[:60], str(p.get("k") or "")[:16], str(p.get("label") or "")[:40]
    line, ours, market = _num(p.get("line"), -1000, 100000), _num(p.get("ours"), 0, 1), _num(p.get("market"), 0, 1)
    start = _num(p.get("start"), now - 86400, now + 10 * 86400)
    side = p.get("side") if p.get("side") in ("over", "under") else None
    if not name or not re.fullmatch(r"[a-z0-9_]{1,16}", k) or line is None or ours is None or side is None or not start or start <= now:
        return None
    books = sorted({b for b in p.get("books") or [] if b in BOOKS})
    return {"sport": p["sport"], "player": name, "team": str(p.get("team") or "")[:40], "opp": str(p.get("opp") or "")[:40], "k": k,
            "label": label or k, "line": line, "side": side, "yes": bool(p.get("yes")), "ours": round(ours, 3),
            "market": None if market is None else round(market, 3), "conf": str(p.get("conf") or "")[:12], "start": int(start), "books": books}


def seen(picks, now=None):
    """Lock in the props a page showed. Returns how many were new."""
    now = now or time.time()
    picks = [c for c in (_clean(p, now) for p in (picks or [])[:400]) if c]
    boards, new = {}, 0
    for p in picks:
        if p["sport"] not in boards:
            boards[p["sport"]] = _posted(p["sport"])
        posted = boards[p["sport"]]
        if posted is not None:   # no board to check against (it didn't load) means nothing is accepted
            lines = posted.get((norm(p["player"]), p["k"]))
            if not lines or p["line"] not in lines:
                continue
            p["books"] = sorted({b for b in (lines.get(p["line"]) or set()) if b in BOOKS} | set(p["books"]))
        else:
            continue
        key = f"{p['sport']}:{game_day(p['start'])}:{norm(p['player'])}:{p['k']}"
        edge = None if p["market"] is None else round((p["ours"] - p["market"]) * 100)
        read = {"line": p["line"], "side": p["side"], "ours": p["ours"], "market": p["market"], "edge": edge, "at": int(now), "books": p["books"]}
        with _lock:
            e = BOOK.get(key)
            if not e:
                BOOK[key] = {"key": key, **{x: p[x] for x in ("sport", "player", "team", "opp", "k", "label", "line", "side", "yes", "conf", "start")},
                             "first": read, "close": read}
                new += 1
            elif not e.get("result") and now < e["start"]:
                e["close"] = read
            else:
                continue
            _state["dirty"] = True
    return new


# ---------- the closing line ----------

def clv(e):
    """Did the market move toward the pick between the first reading and the last one before the start?
    -> {"beat": True/False/None, "moved": text}. A line that moved our way (up for an over, down for an under) beats
    it; at the same line, a higher market chance for our side beats it."""
    a, b = e.get("first") or {}, e.get("close") or {}
    if not a or not b or b.get("at", 0) - a.get("at", 0) < 600:
        return {"beat": None, "moved": "No later reading before the start"}
    over = e["side"] == "over"
    if b["line"] != a["line"]:
        up = b["line"] > a["line"]
        return {"beat": up == over, "moved": f"Line moved {a['line']:g} to {b['line']:g}"}
    ma = a.get("market")
    mb = b.get("market") if b.get("side") == e["side"] else (None if b.get("market") is None else 1 - b["market"])
    if ma is None or mb is None:
        return {"beat": None, "moved": "Same line, no price to compare"}
    if abs(mb - ma) < 0.005:
        return {"beat": None, "moved": "Same line, same price"}
    return {"beat": mb > ma, "moved": f"Market {round(ma * 100)}% to {round(mb * 100)}%"}


# ---------- grading ----------

def grade_one(e, now=None):
    now = now or time.time()
    if e["sport"] == "soccer":
        e.update({"result": "unknown", "actual": "", "why": "Soccer player props aren't graded yet", "graded": now})
        return
    slate = dt.date.fromisoformat(game_day(e["start"]))
    g = {"t": "prop", "sport": e["sport"], "player": e["player"], "stat": e["k"], "line": e["line"], "side": e["side"], "slate": slate.isoformat()}
    try:
        res, shown = (D["mlb"] if e["sport"] == "mlb" else D["grade"])(g, slate)
    except Exception as ex:
        print("propbook grade:", e["key"], type(ex).__name__, ex)
        res, shown = None, ""
    if res:
        e.update({"result": res, "actual": shown, "graded": now})
        if g.get("why"):
            e["why"] = g["why"][:300]
    elif now - e["start"] > GIVE_UP:
        e.update({"result": "unknown", "actual": "", "why": "No result found within five days", "graded": now})
    else:
        e["tried"] = now


def grade_pending(now=None, limit=30):
    now = now or time.time()
    with _lock:
        todo = sorted([e for e in BOOK.values() if not e.get("result") and now - e["start"] > GRADE_AFTER.get(e["sport"], 3.5 * 3600)
                       and now - e.get("tried", 0) > 1800], key=lambda e: e["start"])[:limit]
    for e in todo:
        grade_one(e, now)
        with _lock:
            _state["dirty"] = True


def _loop():
    time.sleep(90)
    while True:
        try:
            grade_pending()
            if _state["dirty"]:
                _save()
        except Exception as ex:
            print("propbook:", ex)
        time.sleep(600)


def flush():
    if _state["dirty"]:
        _save()


# ---------- what the page reads ----------

def entries(limit=2000, since=None):
    with _lock:
        rows = sorted((e for e in BOOK.values() if not since or e["start"] >= since), key=lambda e: e["start"], reverse=True)[:limit]
        out = []
        for e in rows:
            f = e.get("first") or {}
            out.append({"key": e["key"], "sport": e["sport"], "player": e["player"], "team": e.get("team"), "opp": e.get("opp"), "k": e["k"],
                        "label": e["label"], "line": e["line"], "side": e["side"], "yes": e.get("yes"), "conf": e.get("conf"), "start": e["start"],
                        "ours": f.get("ours"), "market": f.get("market"), "edge": f.get("edge"), "books": f.get("books") or [],
                        "result": e.get("result"), "actual": e.get("actual"), "why": e.get("why"), "clv": clv(e)})
        return out


# ---------- MLB: the league's own game log (the ESPN grader would look up the wrong player id) ----------

def mlb_grade(B):
    """A grade(g, slate) for baseball, using discord_bot's MLB loaders."""
    def go(g, slate):
        o = B.find_player("mlb", g["player"])
        if not o:
            return (("unknown", "player not found") if _late(slate) else (None, ""))
        games = B.mlb_season(o["id"], slate.year)
        day = [x for x in games if x["date"].date() == slate]   # MLB's log dates each game by its local day
        if not day:
            return ("void", "DNP") if _late(slate) else (None, "")
        if len(day) > 1:   # a doubleheader: the line was for one game, and the log doesn't say which
            return "unknown", "doubleheader"
        try:
            v = B.STAT[B.stat_sport("mlb")][g["stat"]]["get"](day[0])
        except Exception:
            v = None
        if v is None:
            return ("unknown", "stat not in the game log") if _late(slate) else (None, "")
        res = "push" if v == g["line"] else "won" if (v > g["line"]) == (g["side"] == "over") else "lost"
        return res, B.fmt(v)
    return go


def _late(slate):
    end = dt.datetime(slate.year, slate.month, slate.day, tzinfo=ET) + dt.timedelta(hours=36)
    return dt.datetime.now(dt.timezone.utc) > end
