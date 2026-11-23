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

Every later reading is also kept in "readings" (the prop's line-movement history). Readings stop five minutes before
the start (gradebook.LOCK_BEFORE), and the pick is always graded on the first reading's line and side.

Saved in propbook.json through storage.py, and copied to GitHub by site_grader.py, which also grades from there when
the server can't reach ESPN (gradebook.py). A lookup that failed ("no game log from ESPN") is tried again until the
five days are up instead of being marked "not graded" on the first miss.
"""
import datetime as dt
import re
import threading
import time
from pathlib import Path

import gradebook
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
    if not name or not re.fullmatch(r"[a-z0-9_]{1,16}", k) or line is None or ours is None or side is None or not start \
            or start - gradebook.LOCK_BEFORE <= now:
        return None
    books = sorted({b for b in p.get("books") or [] if b in BOOKS})
    return {"sport": p["sport"], "player": name, "team": str(p.get("team") or "")[:40], "opp": str(p.get("opp") or "")[:40], "k": k,
            "label": label or k, "line": line, "side": side, "yes": bool(p.get("yes")), "ours": round(ours, 3),
            "market": None if market is None else round(market, 3), "conf": str(p.get("conf") or "")[:12], "start": int(start), "books": books,
            "price": int(p["price"]) if isinstance(p.get("price"), int) and not isinstance(p.get("price"), bool) and 100 <= abs(p["price"]) <= 5000 else None,
            "proj": _num(p.get("proj"), -1000, 100000), "hit": _num(p.get("hit"), 0, 1), "n": int(p["n"]) if isinstance(p.get("n"), int) and 0 < p["n"] < 400 else None,
            **_extra(p)}


def _ident(v, n=40):
    v = str(v or "").strip()[:n]
    return v if v and re.fullmatch(r"[A-Za-z0-9:._\- ]+", v) else None


def _text(v, n=60):
    v = re.sub(r"\s+", " ", str(v or "")).strip()[:n]
    return v or None


def _extra(p):
    """The optional receipt fields the page knows about a prop (ids, supported edge, confidence range, injury and lineup)."""
    lo, hi = _num(p.get("lo"), 0, 1), _num(p.get("hi"), 0, 1)
    va = _num(p.get("verifiedAt"), 0, 1e13)
    return {"event": _ident(p.get("event")), "playerId": _ident(p.get("playerId")), "teamId": _ident(p.get("teamId")), "oppId": _ident(p.get("oppId")),
            "league": _ident(p.get("league"), 12), "marketId": _ident(p.get("marketId"), 60), "provider": _text(p.get("provider"), 40),
            "sedge": None if _num(p.get("sedge"), -100, 100) is None else round(p["sedge"]),
            "range": [round(lo, 3), round(hi, 3)] if lo is not None and hi is not None and lo <= hi else None,
            "sources": [s for s in (_text(x, 40) for x in (p.get("sources") or [])[:8] if isinstance(p.get("sources"), list)) if s] or None,
            "injury": _text(p.get("injury")), "lineup": _text(p.get("lineup")),
            "verifiedAt": None if va is None else int(va / 1000 if va > 1e11 else va)}


BOOK_NAME = {"prizepicks": "PrizePicks", "sleeper": "Sleeper", "underdog": "Underdog"}


def make_receipt(key, p, read, backfilled=False):
    """The prop as it was published, frozen (gradebook.receipt)."""
    books = read.get("books") or p.get("books") or []
    team, opp = p.get("team") or "", p.get("opp") or ""
    return gradebook.receipt(
        id=key, publishedAt=read.get("at"), event=p.get("event"), start=p.get("start"), league=p.get("league") or p.get("sport"),
        player=p.get("player"), playerId=p.get("playerId"), team=team or None, teamId=p.get("teamId"), opp=opp or None, oppId=p.get("oppId"),
        matchup=f"{team} vs {opp}" if team and opp else None, market=p.get("label"), marketId=p.get("marketId") or p.get("k"),
        line=read.get("line", p.get("line")), side=read.get("side", p.get("side")), provider=p.get("provider") or ", ".join(BOOK_NAME.get(b, b) for b in books) or None,
        price=read.get("price"), modelProb=read.get("ours"), marketProb=read.get("market"), rawEdge=read.get("edge"),
        supportedEdge=p.get("sedge"), confidence=p.get("conf") or None, confRange=p.get("range"),
        sources=p.get("sources") or ([BOOK_NAME.get(b, b) + " line" for b in books] + ["Floodlight Lab model"]),
        injury=p.get("injury"), lineup=p.get("lineup"), verifiedAt=p.get("verifiedAt"), backfilled=backfilled)


def ensure_receipt(e):
    """A prop saved before receipts existed gets one made from its first reading, which was never changed, marked as such."""
    if isinstance(e.get("receipt"), dict) or not e.get("first"):
        return False
    return gradebook.keep_receipt(e, make_receipt(e["key"], e, e["first"], backfilled=True))


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
        read = {"line": p["line"], "side": p["side"], "ours": p["ours"], "market": p["market"], "edge": edge, "at": int(now), "books": p["books"],
                "price": p["price"], "proj": p["proj"], "hit": p["hit"], "n": p["n"]}
        read = {a: b for a, b in read.items() if b is not None or a in ("market", "edge")}
        with _lock:
            e = BOOK.get(key)
            if not e:
                BOOK[key] = {"key": key, **{x: p[x] for x in ("sport", "player", "team", "opp", "k", "label", "line", "side", "yes", "conf", "start")},
                             "first": read, "close": read, "readings": [read], "receipt": make_receipt(key, p, read)}
                if p.get("event"):
                    BOOK[key]["event"] = p["event"]
                new += 1
            elif not e.get("result") and now < e["start"] - gradebook.LOCK_BEFORE:
                e["close"] = read
                rs = e.setdefault("readings", [e["first"]])
                last = rs[-1] if rs else {}
                moved = any(last.get(x) != read.get(x) for x in ("line", "side", "market"))
                if moved or now - last.get("at", 0) >= 900:   # a reading is kept when something moved, or every 15 minutes
                    rs.append(read)
                    del rs[:-24]
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

RETRY = ("no game log", "player not found", "didn't answer", "did not answer", "timed out")   # a lookup failed: try again later
SOURCE = {"mlb": "MLB Stats API game log"}


def _calc(e, res, shown):
    over = e["side"] == "over"
    if res in ("won", "lost", "push") and shown:
        what = f"{e['player']} had {shown} {str(e.get('label') or e['k']).lower()}"
        if e.get("yes"):
            return f"{what}. The pick was {'Yes' if over else 'No'}, so it is a {'hit' if res == 'won' else 'miss'}."
        rel = "landed on" if res == "push" else ("beat" if (res == "won") == over else "fell short of") if over else ("stayed under" if res == "won" else "went over")
        return f"{what} against a line of {e['line']:g} ({'over' if over else 'under'}): {rel} the line, so it is a {'push' if res == 'push' else 'hit' if res == 'won' else 'miss'}."
    if res == "void":
        return "He did not play in that game, so the pick is void and not counted."
    return ""


def grade_one(e, now=None, by="server", give_up=True):
    now = now or time.time()
    if e["sport"] == "soccer":
        gradebook.set_result(e, "unknown", "", "Soccer player props aren't graded yet", by=by, now=now)
        return True
    slate = dt.date.fromisoformat(game_day(e["start"]))
    g = {"t": "prop", "sport": e["sport"], "player": e["player"], "stat": e["k"], "line": e["line"], "side": e["side"], "slate": slate.isoformat()}
    try:
        res, shown = (D["mlb"] if e["sport"] == "mlb" else D["grade"])(g, slate)
    except Exception as ex:
        print("propbook grade:", e["key"], type(ex).__name__, ex)
        gradebook.note_error("propbook", ex)
        res, shown = None, ""
    failed = res == "unknown" and any(w in str(shown).lower() for w in RETRY)
    src = SOURCE.get(e["sport"], "ESPN game log and box score")
    if res and not failed:
        return gradebook.set_result(e, res, shown if res != "unknown" else "", (g.get("why") or (shown if res == "unknown" else ""))[:300],
                                    by=by, source=src, calc=_calc(e, res, shown), now=now, closing=e.get("close"))
    if give_up and now - e["start"] > GIVE_UP and not e.get("result"):
        return gradebook.set_result(e, "unknown", "", f"No result found within five days{f' ({shown})' if shown else ''}", by=by, now=now)
    e["tried"] = now
    return False


def grade_pending(now=None, limit=30, by="server", give_up=True):
    now = now or time.time()
    with _lock:
        todo = sorted([e for e in BOOK.values() if not e.get("result") and now - e["start"] > GRADE_AFTER.get(e["sport"], 3.5 * 3600)
                       and now - e.get("tried", 0) > 1800 and not e.get("test")], key=lambda e: e["start"])[:limit]
    n = 0
    for e in todo:
        n += bool(grade_one(e, now, by=by, give_up=give_up))
        with _lock:
            _state["dirty"] = True
    return n


def recheck(now=None, limit=30, by="server"):
    """A day after grading, grade once more in case the box score was corrected; a change goes in the correction history."""
    now = now or time.time()
    with _lock:
        todo = [e for e in BOOK.values() if e.get("result") in ("won", "lost", "push") and not e.get("rechecked") and not e.get("test")
                and 20 * 3600 < now - (e.get("graded") or now) < 4 * 86400][:limit]
    for e in todo:
        grade_one(e, now, by=by, give_up=False)
        with _lock:
            e["rechecked"] = int(now)
            _state["dirty"] = True


def _loop():
    time.sleep(90)
    while True:
        try:
            if grade_pending():
                gradebook.STATUS.update({"by": "server", "at": int(time.time())})
            recheck()
            if _state["dirty"]:
                _save()
        except Exception as ex:
            print("propbook:", ex)
        time.sleep(600)


def flush():
    if _state["dirty"]:
        _save()


# ---------- what the page reads ----------

def entries(limit=2000, since=None, receipts=False, tests=False, now=None):
    now = now or time.time()
    with _lock:
        rows = sorted((e for e in BOOK.values() if (not since or e["start"] >= since) and (tests or not e.get("test"))),
                      key=lambda e: e["start"], reverse=True)[:limit]
        out = []
        for e in rows:
            f = e.get("first") or {}
            r = {"state": gradebook.state(e["start"], e.get("result"), GRADE_AFTER.get(e["sport"], 3.5 * 3600), e.get("corrections"), now),
                 "made": f.get("at"), "graded": e.get("graded"), "by": e.get("by"), "corrected": bool(e.get("corrections"))}
            if receipts:
                if ensure_receipt(e):
                    _state["dirty"] = True
                rc = e.get("receipt")
                r.update({"first": f, "close": e.get("close"), "readings": e.get("readings") or [f], "source": e.get("source"), "calc": e.get("calc"),
                          "corrections": e.get("corrections") or [], "receipt": rc, "receiptOk": gradebook.receipt_ok(rc), "grading": gradebook.grading(e)})
            if e.get("test"):
                r["test"] = True
            out.append({**r, "key": e["key"], "sport": e["sport"], "player": e["player"], "team": e.get("team"), "opp": e.get("opp"), "k": e["k"],
                        "label": e["label"], "line": e["line"], "side": e["side"], "yes": e.get("yes"), "conf": e.get("conf"), "start": e["start"],
                        "ours": f.get("ours"), "market": f.get("market"), "edge": f.get("edge"), "books": f.get("books") or [],
                        "result": e.get("result"), "actual": e.get("actual"), "why": e.get("why"), "clv": clv(e),
                        "sedge": (e.get("receipt") or {}).get("supportedEdge"), "event": e.get("event")})
        return out


def counts(now=None):
    now = now or time.time()
    out = {}
    with _lock:
        for e in BOOK.values():
            if e.get("test"):
                continue
            st = gradebook.state(e["start"], e.get("result"), GRADE_AFTER.get(e["sport"], 3.5 * 3600), e.get("corrections"), now)
            out[st] = out.get(st, 0) + 1
    return out


def moves(sport, player, k, start=None):
    """Every reading kept for one player's stat, newest prop first: the prop's line-movement history."""
    p, out = norm(player), []
    with _lock:
        for e in BOOK.values():
            if e["sport"] == sport and norm(e["player"]) == p and e["k"] == k and not e.get("test") and (not start or abs(e["start"] - start) < 86400):
                out.append({"start": e["start"], "line": e["line"], "side": e["side"], "label": e["label"], "result": e.get("result"),
                            "readings": [{x: r.get(x) for x in ("at", "line", "side", "ours", "market", "edge", "books")} for r in (e.get("readings") or [e.get("first") or {}])]})
    return sorted(out, key=lambda x: x["start"], reverse=True)[:10]


# ---------- the copy GitHub keeps (gradebook.py) ----------

def snapshot():
    with _lock:
        return {k: dict(v) for k, v in BOOK.items()}


def absorb(other):
    if not isinstance(other, dict):
        return 0
    with _lock:
        before = {k: (v.get("result"), len(v.get("readings") or [])) for k, v in BOOK.items()}
        merged = gradebook.merge(BOOK, {k: v for k, v in other.items() if isinstance(v, dict) and v.get("start")})
        BOOK.clear()
        BOOK.update(merged)
        changed = sum(1 for k, v in BOOK.items() if before.get(k) != (v.get("result"), len(v.get("readings") or [])))
        if changed:
            _state["dirty"] = True
        return changed


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
