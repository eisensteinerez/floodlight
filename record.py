"""Floodlight's track record: every forecast the server made, logged at kick-off and graded when the match ends.

The forecaster (forecaster.py) writes predictions for tracked matches up to 30 minutes before kick-off. Once a match
kicks off, the last forecast made before kick-off is copied here and locked, so the record can't be edited after the
fact. When the final score is in (ESPN for ESPN matches and American football, FotMob for FotMob-only leagues), the
pick is graded: won, lost, push (an American football tie) or void (postponed, or no result after four days).

Saved in record.json through storage.py, so it survives restarts when DATABASE_URL is set.
"""
import threading
import time
from pathlib import Path

import storage

ESPN = "https://site.api.espn.com/apis/site/v2/sports"
FB_PATH = {"nfl": "nfl", "fbs": "college-football", "fcs": "college-football", "d2": "college-football",
           "d3": "college-football", "ufl": "ufl"}
KEEP = 3000                 # entries kept, newest first
GRADE_AFTER = 2 * 3600      # a soccer match is usually over two hours after kick-off
GIVE_UP = 4 * 86400

D = {}                      # fetch, fm_matchstats, forecaster, cache_dir
RECORD = {}
_lock = threading.RLock()
_state = {"dirty": False}


def _path():
    return Path(D["cache_dir"]) / "record.json"


def setup(loops=True, **deps):
    D.update(deps)
    D["serverless"] = not loops
    RECORD.update(storage.load(_path(), {}))
    _state["at"] = time.time()
    if loops:
        threading.Thread(target=_loop, daemon=True, name="record").start()


def refresh(max_age=60):
    """Vercel: re-read the record saved by whichever copy of the server ran the last pass."""
    if not (D.get("serverless") and storage.enabled()) or time.time() - _state.get("at", 0) < max_age:
        return
    got = storage.load(_path(), None)
    with _lock:
        if isinstance(got, dict):
            RECORD.clear()
            RECORD.update(got)
        _state["at"] = time.time()


def tick():
    """One pass for Vercel's timer: log the matches that kicked off and grade the finished ones."""
    refresh(0)
    D["forecaster"].refresh(0)
    log_kickoffs()
    grade_pending()
    if _state["dirty"]:
        _save()


def _save():
    with _lock:
        if len(RECORD) > KEEP:
            for k in sorted(RECORD, key=lambda k: RECORD[k]["ko"])[:len(RECORD) - KEEP]:
                RECORD.pop(k, None)
        storage.save(_path(), RECORD)
        _state["dirty"] = False


# ---------- logging at kick-off ----------

def log_kickoffs(now=None):
    """Copy the last pre-kick-off forecast of every match that has started into the record."""
    fc = D["forecaster"]
    now = now or time.time()
    with fc._lock:
        items = [(k, dict(fc.TRACKED.get(k) or {}), f) for k, f in fc.FORECASTS.items()]
    for key, m, f in items:
        if key in RECORD or not m:
            continue
        ko = m.get("ko") or f.get("ko")
        if not ko or ko > now:
            continue
        snaps = [s for s in f.get("snaps") or [] if s.get("at", 0) < ko and s.get("pick")]
        if not snaps:
            continue
        s = snaps[-1]
        e = {"key": key, "sport": m["sport"], "lg": m.get("lg"), "id": m["id"], "src": m.get("src") or "espn",
             "fmId": m.get("fmId"), "ko": ko, "home": s.get("home") or m.get("home"), "away": s.get("away") or m.get("away"),
             "pick": s["pick"], "top": round(s.get("top") or 0, 3), "conf": s.get("conf"), "stage": s.get("stage"),
             "score": s.get("score"), "made": s.get("at"), "probs": {k: round(v, 3) for k, v in (s.get("final") or {}).items()},
             "market": None, "research": bool(s.get("ai") and not (s.get("ai") or {}).get("error"))}
        mk = s.get("market")
        if isinstance(mk, dict) and all(isinstance(mk.get(k), (int, float)) for k in ("home", "away")):
            e["market"] = {k: round(mk[k], 3) for k in ("home", "draw", "away") if isinstance(mk.get(k), (int, float))}
        with _lock:
            RECORD[key] = e
            _state["dirty"] = True


# ---------- grading ----------

def _espn_final(e):
    path = f"soccer/{e['lg']}" if e["sport"] == "soccer" else f"football/{FB_PATH.get(e['lg'], 'nfl')}"
    summ = D["fetch"](f"{ESPN}/{path}/summary?event={e['id']}", 600, as_json=True) or {}
    comp = ((summ.get("header") or {}).get("competitions") or [{}])[0]
    st = (comp.get("status") or {}).get("type") or {}
    name = (st.get("name") or "").upper()
    if any(w in name for w in ("POSTPONED", "CANCELED", "CANCELLED", "ABANDONED", "SUSPENDED")):
        return "void", None
    if st.get("state") != "post" or not st.get("completed", True):
        return None, None
    sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    try:
        return "final", (int(float((sides.get("home") or {}).get("score"))), int(float((sides.get("away") or {}).get("score"))))
    except (TypeError, ValueError):
        return None, None


def _fm_final(e):
    if not e.get("fmId"):
        return None, None
    d = D["fm_matchstats"](mid=e["fmId"]) or {}
    if not d.get("finished"):
        return None, None
    t = d.get("teams") or []
    try:
        return "final", (int(t[0]["score"]), int(t[1]["score"]))
    except (IndexError, KeyError, TypeError, ValueError):
        return None, None


def grade(e, status, sc):
    if status == "void":
        e.update({"result": "void", "graded": time.time()})
        return
    hs, as_ = sc
    actual = "home" if hs > as_ else "away" if as_ > hs else "draw"
    if e["sport"] == "football" and actual == "draw":
        result = "push"
    else:
        result = "won" if actual == e["pick"] else "lost"
    e.update({"result": result, "final": [hs, as_], "actual": actual, "graded": time.time(),
              "exact": bool(e.get("score") and list(e["score"]) == [hs, as_])})


def grade_pending(now=None, limit=25):
    now = now or time.time()
    with _lock:
        todo = sorted([e for e in RECORD.values() if not e.get("result") and now - e["ko"] > GRADE_AFTER and now - e.get("tried", 0) > 900],
                      key=lambda e: e["ko"])[:limit]
    for e in todo:
        try:
            status, sc = (_fm_final if e.get("src") == "fm" else _espn_final)(e)
        except Exception:
            status, sc = None, None
        with _lock:
            if status:
                grade(e, status, sc)
            elif now - e["ko"] > GIVE_UP:
                e.update({"result": "void", "graded": now})
            else:
                e["tried"] = now
            _state["dirty"] = True


def _loop():
    time.sleep(40)
    while True:
        try:
            log_kickoffs()
            grade_pending()
            if _state["dirty"]:
                _save()
        except Exception as ex:
            print("record:", ex)
        time.sleep(300)


# ---------- what the app and the bot read ----------

PUBLIC = ("key", "sport", "lg", "id", "ko", "home", "away", "pick", "top", "conf", "stage", "score", "probs", "market",
          "research", "result", "final", "actual", "exact")


def entries(limit=1500):
    refresh()
    with _lock:
        rows = sorted(RECORD.values(), key=lambda e: e["ko"], reverse=True)[:limit]
        return [{k: e.get(k) for k in PUBLIC} for e in rows]


def summary(sport=None, since=None):
    refresh()
    """W-L, hit rate and current streak over graded picks, newest first."""
    with _lock:
        rows = sorted((e for e in RECORD.values() if e.get("result") in ("won", "lost") and (not sport or e["sport"] == sport)
                       and (not since or e["ko"] >= since)), key=lambda e: e["ko"], reverse=True)
        pending = sum(1 for e in RECORD.values() if not e.get("result") and (not sport or e["sport"] == sport))
    w = sum(1 for e in rows if e["result"] == "won")
    streak, kind = 0, None
    for e in rows:
        if kind is None:
            kind = e["result"]
        if e["result"] != kind:
            break
        streak += 1
    return {"won": w, "lost": len(rows) - w, "rate": round(w / len(rows), 3) if rows else None, "pending": pending,
            "streak": {"kind": kind, "n": streak} if kind else None, "last": rows[:5] and [{k: e.get(k) for k in PUBLIC} for e in rows[:5]]}
