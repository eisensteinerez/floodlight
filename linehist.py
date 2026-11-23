"""Floodlight line movement: book prices over time.

odds.board() hands every fresh board it reads to record(). We keep a reading for a game when any price or line moved,
or when 15 minutes have passed since the last kept reading, so a game whose prices sit still does not fill the file.
Each reading holds, per book: the price for each side to win, the main spread (the one most books post) and the main
total. Readings older than 14 days are dropped, each game keeps its newest 400, and at most 3000 games are kept.

Saved to .floodlight-cache/line_history.json, and to the database copy when one is set (storage.py). Writes are
batched: at most one save a minute.

Nothing here is a forecast. It is only what the books posted, and when we read it.
"""
import datetime
import re
import threading
import time
from pathlib import Path

import storage

KEEP_DAYS = 14
PER_GAME = 400
MAX_GAMES = 3000
STILL_GAP = 15 * 60   # keep an unchanged reading this often, so the chart shows how long a price held
SAVE_GAP = 60

D = {}
_lock = threading.Lock()
_hist = {}            # key -> {"sport", "lg", "home", "away", "ko", "pts": [reading, ...]}
_file = None
_dirty = False
_saved_at = 0.0


def setup(cache_dir, al=None, similar=None):
    global _file, _hist
    _file = Path(cache_dir) / "line_history.json"
    _hist = storage.load(_file, {}) or {}
    D.update(al=al, similar=similar)
    _prune(time.time())


def _norm(s):
    s = D["al"](s) if D.get("al") else (s or "").lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _day(s):
    """A start time as the page (ISO text) or the forecaster (seconds) gives it."""
    if isinstance(s, (int, float)) or re.fullmatch(r"\d{9,11}(\.\d+)?", str(s or "")):
        return float(s)
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _find(q):
    """The game's key. Pages and the forecaster can name a team differently ("Man City", "Manchester City"), so when
    the exact key is new, a game of the same sport, league and day whose two names match well enough is the same game."""
    k = key_of(q)
    if k in _hist or not D.get("similar"):
        return k
    sport, lg, _, _, day = k.split("|")
    best, score = k, 1.6
    for k2, g in _hist.items():
        p = k2.split("|")
        if p[0] != sport or p[1] != lg or p[4] != day:
            continue
        sc = D["similar"](q.get("home") or "", g.get("home") or "") + D["similar"](q.get("away") or "", g.get("away") or "")
        if sc >= score:
            best, score = k2, sc
    return best


def key_of(q):
    """One key per game, from the same inputs the odds board takes (sport, league, the two teams, the start day)."""
    ts = _day(q.get("date"))
    day = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%d") if ts else ""
    return "|".join([str(q.get("sport") or ""), str(q.get("lg") or ""), _norm(q.get("home")), _norm(q.get("away")), day])


def _main(xs):
    """The spread or total most books post (closest to even when tied)."""
    xs = [x for x in xs or [] if x.get("offers")]
    if not xs:
        return None
    k0 = "home" if "homeLine" in xs[0] else "over"
    return sorted(xs, key=lambda x: (-len(x["offers"]), abs((x.get("fair") or {}).get(k0, .5) - .5)))[0]


def _px(p):
    return [p["p"], p.get("am")] if isinstance(p, dict) and p.get("p") is not None else None


def snapshot(b):
    """The part of a board worth keeping: each book's price to win, and the main spread and total with each book's price."""
    ml = {}
    for o in (b.get("ml") or {}).get("offers") or []:
        row = {k: _px(o.get(k)) for k in ("home", "draw", "away") if _px(o.get(k))}
        if row:
            ml[o["book"]] = row
    out = {"ml": ml}
    sp = _main(b.get("spreads"))
    if sp:
        out["sp"] = {"line": sp["homeLine"], "books": {o["book"]: _px(o.get("home")) for o in sp["offers"] if _px(o.get("home"))}}
    tt = _main(b.get("totals"))
    if tt:
        out["tot"] = {"line": tt["line"], "books": {o["book"]: _px(o.get("over")) for o in tt["offers"] if _px(o.get("over"))}}
    return out if ml or sp or tt else None


def record(q, b):
    """Called with every fresh board odds.board() reads."""
    global _dirty
    try:
        s = snapshot(b)
    except Exception as e:
        print(f"line history: couldn't read a board: {e}")
        return
    if not s or not _file:
        return
    now = time.time()
    with _lock:
        k = _find(q)
        g = _hist.get(k)
        if not g:
            g = _hist[k] = {"sport": q.get("sport"), "lg": q.get("lg"), "home": q.get("home"), "away": q.get("away"), "ko": _day(q.get("date")), "pts": []}
        last = g["pts"][-1] if g["pts"] else None
        same = last and {x: last.get(x) for x in ("ml", "sp", "tot")} == {x: s.get(x) for x in ("ml", "sp", "tot")}
        if same and now - last["t"] < STILL_GAP:
            return
        g["pts"].append({"t": int(now), **s})
        del g["pts"][:-PER_GAME]
        _dirty = True
    _maybe_save(now)


def _prune(now):
    cut = now - KEEP_DAYS * 86400
    with _lock:
        for k in list(_hist):
            g = _hist[k]
            g["pts"] = [p for p in g.get("pts") or [] if p.get("t", 0) >= cut]
            if not g["pts"]:
                _hist.pop(k)
        if len(_hist) > MAX_GAMES:
            for k in sorted(_hist, key=lambda k: _hist[k]["pts"][-1]["t"])[:len(_hist) - MAX_GAMES]:
                _hist.pop(k)


_save_lock = threading.Lock()


def _write(data):
    with _save_lock:   # one writer at a time: storage.save goes through a single temporary file
        try:
            storage.save(_file, data)
        except Exception as e:
            print(f"line history: couldn't save: {e}")


def _maybe_save(now, force=False):
    global _dirty, _saved_at
    if not _dirty or (not force and now - _saved_at < SAVE_GAP):
        return
    _saved_at = now
    _prune(now)
    with _lock:
        data = {k: {**g, "pts": list(g["pts"])} for k, g in _hist.items()}
        _dirty = False
    if force:
        _write(data)
    else:
        threading.Thread(target=_write, args=(data,), daemon=True, name="line-history-save").start()


def flush():
    """On shutdown: write what is not saved yet, and wait for it."""
    _maybe_save(time.time(), force=True)


def history(q):
    """Every kept reading for a game, oldest first, and how long we have been reading it."""
    _maybe_save(time.time())
    with _lock:
        g = _hist.get(_find(q))
        pts = list(g["pts"]) if g else []
    return {"readings": pts, "count": len(pts), "first": pts[0]["t"] if pts else None, "last": pts[-1]["t"] if pts else None,
            "keepDays": KEEP_DAYS, "stillGap": STILL_GAP}
