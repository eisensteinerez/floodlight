"""Floodlight's track record: every forecast the server made, logged at kick-off and graded when the match ends.

The forecaster (forecaster.py) writes predictions for tracked matches up to 30 minutes before kick-off. Once a match
kicks off, the last forecast made before kick-off is copied here and locked, so the record can't be edited after the
fact. When the final score is in (ESPN for ESPN matches and American football, FotMob for FotMob-only leagues), the
pick is graded: won, lost, push (an American football tie) or void (postponed, or no result after four days).

Saved in record.json through storage.py, so it survives restarts when DATABASE_URL is set, and copied to GitHub by
site_grader.py (gradebook.py), which also grades from there when the server can't reach ESPN.

Each entry keeps every forecast made before kick-off ("readings", the first one is the original) beside the one that is
graded (the last before kick-off), so a change of mind is shown, not hidden. A match with no final score after four
days is "not graded" (unknown), never a void: only a postponed or cancelled match is void.
"""
import threading
import time
from pathlib import Path

import gradebook
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


def setup(**deps):
    D.update(deps)
    RECORD.update(storage.load(_path(), {}))
    if deps.get("loop", True):
        threading.Thread(target=_loop, daemon=True, name="record").start()


def _save():
    with _lock:
        if len(RECORD) > KEEP:
            for k in sorted(RECORD, key=lambda k: RECORD[k]["ko"])[:len(RECORD) - KEEP]:
                RECORD.pop(k, None)
        storage.save(_path(), RECORD)
        _state["dirty"] = False


# ---------- logging at kick-off ----------

def _reading(s):
    """One forecast as it was made: what we picked, our chance, the market's chance and what the update was."""
    mk = s.get("market") if isinstance(s.get("market"), dict) else {}
    return {"at": int(s.get("at") or 0), "stage": s.get("stage"), "pick": s.get("pick"), "top": round(s.get("top") or 0, 3),
            "probs": {k: round(v, 3) for k, v in (s.get("final") or {}).items() if isinstance(v, (int, float))},
            "market": {k: round(mk[k], 3) for k in ("home", "draw", "away") if isinstance(mk.get(k), (int, float))} or None,
            "conf": s.get("conf"), "score": s.get("score")}


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
        reads = [_reading(x) for x in snaps]
        e = {"key": key, "sport": m["sport"], "lg": m.get("lg"), "id": m["id"], "src": m.get("src") or "espn",
             "fmId": m.get("fmId"), "ko": ko, "home": s.get("home") or m.get("home"), "away": s.get("away") or m.get("away"),
             "pick": s["pick"], "top": round(s.get("top") or 0, 3), "conf": s.get("conf"), "stage": s.get("stage"),
             "score": s.get("score"), "made": s.get("at"), "probs": {k: round(v, 3) for k, v in (s.get("final") or {}).items()},
             "market": None, "research": bool(s.get("ai") and not (s.get("ai") or {}).get("error")),
             "first": reads[0], "readings": reads, "locked": int(ko), "why_pick": [str(r)[:160] for r in (s.get("reasons") or [])[:6]]}
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


def grade(e, status, sc, by="server", now=None):
    src = "FotMob match page" if e.get("src") == "fm" else "ESPN game summary"
    if status == "void":
        return gradebook.set_result(e, "void", "", "Postponed or cancelled", by=by, source=src, calc="The match was not played, so the pick is void", now=now)
    hs, as_ = sc
    actual = "home" if hs > as_ else "away" if as_ > hs else "draw"
    if e["sport"] == "football" and actual == "draw":
        result = "push"
    else:
        result = "won" if actual == e["pick"] else "lost"
    side = {"home": e.get("home"), "away": e.get("away"), "draw": "a draw"}
    calc = f"Final {e.get('home')} {hs}, {e.get('away')} {as_}: {side.get(actual) if actual == 'draw' else str(side.get(actual)) + ' won'}. " \
           f"We picked {side.get(e['pick']) if e['pick'] == 'draw' else str(side.get(e['pick'])) + ' to win'}, so it is a " \
           f"{ {'won': 'hit', 'lost': 'miss', 'push': 'push (a tie)'}[result] }."
    changed = gradebook.set_result(e, result, actual, "", by=by, source=src, calc=calc, now=now)
    e.update({"final": [hs, as_], "exact": bool(e.get("score") and list(e["score"]) == [hs, as_])})
    return changed


def grade_pending(now=None, limit=25, by="server", give_up=True):
    now = now or time.time()
    with _lock:
        todo = sorted([e for e in RECORD.values() if e.get("result") in (None, "unknown") and now - e["ko"] > GRADE_AFTER
                       and now - e.get("tried", 0) > 900 and not (e.get("result") == "unknown" and now - e["ko"] > GIVE_UP)],
                      key=lambda e: e["ko"])[:limit]
    n = 0
    for e in todo:
        try:
            status, sc = (_fm_final if e.get("src") == "fm" else _espn_final)(e)
        except Exception as ex:
            gradebook.note_error("record", ex)
            status, sc = None, None
        with _lock:
            if status:
                n += bool(grade(e, status, sc, by=by, now=now))
            elif give_up and now - e["ko"] > GIVE_UP and not e.get("result") and not (by == "github" and e.get("src") == "fm"):
                gradebook.set_result(e, "unknown", "", "No final score found within four days", by=by, now=now)
            else:
                e["tried"] = now
            _state["dirty"] = True
    return n


def recheck(now=None, limit=25, by="server"):
    """Look at yesterday's results once more, a day after grading, in case the score was corrected. A change is kept
    in the pick's correction history, never written over silently."""
    now = now or time.time()
    with _lock:
        todo = [e for e in RECORD.values() if e.get("result") in ("won", "lost", "push") and not e.get("rechecked")
                and 20 * 3600 < now - (e.get("graded") or now) < 4 * 86400][:limit]
    for e in todo:
        try:
            status, sc = (_fm_final if e.get("src") == "fm" else _espn_final)(e)
        except Exception:
            continue
        with _lock:
            if status:
                grade(e, status, sc, by=by, now=now)
                e["rechecked"] = int(now)
                _state["dirty"] = True


def _loop():
    time.sleep(40)
    while True:
        try:
            log_kickoffs()
            if grade_pending():
                gradebook.STATUS.update({"by": "server", "at": int(time.time())})
            recheck()
            if _state["dirty"]:
                _save()
        except Exception as ex:
            print("record:", ex)
        time.sleep(300)


# ---------- what the app and the bot read ----------

PUBLIC = ("key", "sport", "lg", "id", "ko", "home", "away", "pick", "top", "conf", "stage", "score", "probs", "market",
          "research", "result", "final", "actual", "exact")
RECEIPT = ("made", "first", "readings", "locked", "graded", "by", "source", "calc", "why", "corrections", "why_pick")


def entries(limit=1500, receipts=False, tests=False, now=None):
    now = now or time.time()
    with _lock:
        rows = sorted((e for e in RECORD.values() if tests or not e.get("test")), key=lambda e: e["ko"], reverse=True)[:limit]
        out = []
        for e in rows:
            r = {k: e.get(k) for k in PUBLIC + (RECEIPT if receipts else ())}
            r["state"] = gradebook.state(e["ko"], e.get("result"), GRADE_AFTER, e.get("corrections"), now)
            if e.get("test"):
                r["test"] = True
            out.append(r)
        return out


def upcoming(now=None):
    """Forecasts already published for matches that haven't kicked off: they are graded once locked at kick-off."""
    now = now or time.time()
    fc = D.get("forecaster")
    if not fc:
        return []
    with fc._lock:
        items = [(k, dict(fc.TRACKED.get(k) or {}), [dict(s) for s in (f.get("snaps") or []) if s.get("pick")]) for k, f in fc.FORECASTS.items()]
    out = []
    for key, m, snaps in items:
        ko = m.get("ko")
        if not m or not snaps or not ko or ko <= now or key in RECORD:
            continue
        s, first = snaps[-1], snaps[0]
        mk = s.get("market") if isinstance(s.get("market"), dict) else {}
        out.append({"key": key, "sport": m.get("sport"), "lg": m.get("lg"), "ko": ko, "home": s.get("home") or m.get("home"),
                    "away": s.get("away") or m.get("away"), "pick": s["pick"], "top": round(s.get("top") or 0, 3), "conf": s.get("conf"),
                    "market": {k: round(mk[k], 3) for k in ("home", "draw", "away") if isinstance(mk.get(k), (int, float))} or None,
                    "made": first.get("at"), "updates": len(snaps), "state": gradebook.state(ko, None, GRADE_AFTER, None, now)})
    return sorted(out, key=lambda e: e["ko"])[:200]


def counts(now=None):
    """How many real (not test) entries are in each lifecycle state, for the grading status."""
    now = now or time.time()
    out = {}
    with _lock:
        for e in RECORD.values():
            if e.get("test"):
                continue
            st = gradebook.state(e["ko"], e.get("result"), GRADE_AFTER, e.get("corrections"), now)
            out[st] = out.get(st, 0) + 1
    return out


# ---------- the copy GitHub keeps (gradebook.py) ----------

def snapshot():
    with _lock:
        return {k: dict(v) for k, v in RECORD.items()}


def absorb(other):
    """Merge another copy of the record in (GitHub's, or the server's when this runs on GitHub)."""
    if not isinstance(other, dict):
        return 0
    with _lock:
        before = {k: (v.get("result"), len(v.get("readings") or [])) for k, v in RECORD.items()}
        merged = gradebook.merge(RECORD, {k: v for k, v in other.items() if isinstance(v, dict) and v.get("ko")})
        RECORD.clear()
        RECORD.update(merged)
        changed = sum(1 for k, v in RECORD.items() if before.get(k) != (v.get("result"), len(v.get("readings") or [])))
        if changed:
            _state["dirty"] = True
        return changed


def summary(sport=None, since=None):
    """W-L, hit rate and current streak over graded picks, newest first."""
    with _lock:
        rows = sorted((e for e in RECORD.values() if e.get("result") in ("won", "lost") and not e.get("test") and (not sport or e["sport"] == sport)
                       and (not since or e["ko"] >= since)), key=lambda e: e["ko"], reverse=True)
        pending = sum(1 for e in RECORD.values() if not e.get("result") and not e.get("test") and (not sport or e["sport"] == sport))
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
