"""The rules every Floodlight pick follows from publication to its result, shared by the match record (record.py) and
the prop record (propbook.py), and the copy of both records that GitHub keeps.

Lifecycle (state()): published -> locked -> started -> pending -> hit / miss / push / void / not graded, and "corrected"
when a result was changed after a re-check. The original reading is saved when a pick is published and is never
replaced; later readings are saved beside it, and the pick is graded against the original line.

Why GitHub: the server on Render often can't reach ESPN, and its disk is wiped on every deploy unless DATABASE_URL is
set. So GitHub Actions (site_grader.py, hourly) reads the server's records, grades what is due from ESPN, re-checks
yesterday's results for stat corrections, and keeps the merged records in the repo's record-data branch, encrypted with
a key made from the Discord bot token (the same secret the pick grader uses). The server takes that copy back on start
and whenever Actions sends it, so a deploy never loses a pick. merge() decides what wins: the earliest original, every
reading, and a real result over "not graded".
"""
import base64
import hashlib
import json
import os
import time
import urllib.request
import zlib

LOCK_BEFORE = 300          # a pick is locked five minutes before its start: no new readings after that
DEFINITE = ("won", "lost", "push", "void")
MIRROR = "https://raw.githubusercontent.com/eisensteinerez/floodlight/record-data/site-record.enc"
SERVER = os.environ.get("RECORD_SERVER_URL") or "https://floodlight-x9sl.onrender.com/api/grading/state"
STATUS = {"by": None, "at": 0, "server_at": 0, "mirror_at": 0, "errors": []}   # who graded last, and when


# ---------- lifecycle ----------

LABEL = {"published": "Published", "locked": "Locked", "started": "Game started", "pending": "Pending result", "won": "Hit",
         "lost": "Miss", "push": "Push", "void": "Void", "unknown": "Not graded", "corrected": "Corrected"}


def state(start, result, grade_after, corrections=None, now=None):
    """The lifecycle state of a pick. A corrected result says so; its current result is kept beside it."""
    now = now or time.time()
    if result:
        return "corrected" if corrections else result
    if now < start - LOCK_BEFORE:
        return "published"
    if now < start:
        return "locked"
    if now < start + grade_after:
        return "started"
    return "pending"


def set_result(e, result, actual="", why="", by="server", source="", calc="", now=None):
    """Put a result on a pick. A real result already there is changed only by a re-check, and the change is kept."""
    now = now or time.time()
    old = e.get("result")
    if old in DEFINITE and result != old:
        if result not in DEFINITE:
            return False            # a later "couldn't find it" never replaces a real result
        e.setdefault("corrections", []).append({"from": old, "to": result, "fromActual": e.get("actual"), "toActual": actual,
                                                "at": int(now), "by": by, "why": why[:200]})
    elif old == result and (e.get("actual") or "") == (actual or ""):
        return False
    e.update({"result": result, "actual": actual, "graded": int(now), "by": by})
    if source:
        e["source"] = source
    if calc:
        e["calc"] = calc[:240]
    if why:
        e["why"] = why[:300]
    else:
        e.pop("why", None)
    return True


# ---------- merging two copies of a record ----------

def _first_at(e):
    f = e.get("first") or {}
    return f.get("at") or e.get("made") or 1e12


def merge_entry(a, b):
    """One pick from two copies. The original comes from the copy that saw it first; readings are joined; a real result
    beats none or "not graded"; when both have a real result the copy with more corrections (the re-checked one) wins."""
    if not a:
        return dict(b)
    if not b:
        return dict(a)
    base, other = (a, b) if _first_at(a) <= _first_at(b) else (b, a)
    out = dict(base)
    reads = {}
    for r in (a.get("readings") or []) + (b.get("readings") or []):
        if isinstance(r, dict) and r.get("at"):
            reads[(r.get("at"), r.get("stage") or r.get("line"))] = r
    if reads:
        out["readings"] = sorted(reads.values(), key=lambda r: r["at"])[-24:]
    if a.get("close") or b.get("close"):
        out["close"] = max((x for x in (a.get("close"), b.get("close")) if x), key=lambda r: r.get("at", 0))
    ra, rb = a.get("result"), b.get("result")
    pick = None
    if ra in DEFINITE and rb not in DEFINITE:
        pick = a
    elif rb in DEFINITE and ra not in DEFINITE:
        pick = b
    elif ra in DEFINITE and rb in DEFINITE:
        pick = max((a, b), key=lambda x: (len(x.get("corrections") or []), -(x.get("graded") or 0)))
    elif ra or rb:
        pick = a if ra else b
    for k in ("result", "actual", "graded", "by", "source", "calc", "why", "corrections", "final", "exact", "stats", "rechecked"):
        out.pop(k, None)
        if pick is not None and k in pick:
            out[k] = pick[k]
    out["tried"] = max(a.get("tried", 0), b.get("tried", 0))
    if a.get("test") or b.get("test"):
        out["test"] = True
    return out


def merge(a, b):
    """Two copies of {key: entry} -> one."""
    a, b = a or {}, b or {}
    return {k: merge_entry(a.get(k), b.get(k)) for k in set(a) | set(b)}


# ---------- the sealed copy shared with GitHub Actions ----------

def _fernet():
    from cryptography.fernet import Fernet
    tok = os.environ.get("DISCORD_BOT_TOKEN") or ""
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"floodlight-record:" + tok.encode()).digest()))


def can_seal():
    if not os.environ.get("DISCORD_BOT_TOKEN"):
        return False
    try:
        _fernet()
        return True
    except Exception:
        return False


def seal(obj):
    return _fernet().encrypt(zlib.compress(json.dumps(obj, separators=(",", ":")).encode(), 6))


def unseal(blob):
    return json.loads(zlib.decompress(_fernet().decrypt(blob)))


def _http(url, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "floodlight", "Content-Type": "application/octet-stream"},
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def mirror():
    """GitHub's copy {"record": {...}, "props": {...}, "savedAt", "by"}, or None."""
    if not can_seal() or os.environ.get("RECORD_MIRROR", "1") == "0":
        return None
    try:
        return unseal(_http(f"{os.environ.get('RECORD_MIRROR_URL') or MIRROR}?t={int(time.time()) // 60}", timeout=20))
    except Exception:
        return None


def bundle(record, propbook, by):
    return {"record": record.snapshot(), "props": propbook.snapshot(), "savedAt": int(time.time()), "by": by}


def absorb(got, record, propbook):
    """Take another copy of both records in. Returns how many picks changed."""
    if not isinstance(got, dict):
        return 0
    return record.absorb(got.get("record")) + propbook.absorb(got.get("props"))


def status(record, propbook, storage_db):
    """What the Pick history page and anyone checking the grader can see: counts only, no picks."""
    rc, pc = record.counts(), propbook.counts()
    waiting = sum(c.get("pending", 0) for c in (rc, pc))
    graded = [e.get("graded") or 0 for e in list(record.RECORD.values()) + list(propbook.BOOK.values()) if e.get("result") and not e.get("test")]
    return {"matches": rc, "props": pc, "pending": waiting, "lastGraded": max(graded, default=0) or None,
            "lastRun": {"by": STATUS["by"], "at": STATUS["at"] or None}, "github": {"at": STATUS["mirror_at"] or None, "on": can_seal()},
            "storage": "database" if storage_db else "github" if STATUS["mirror_at"] else "disk",
            "errors": STATUS["errors"][:3], "now": int(time.time())}


def note_error(where, ex):
    STATUS["errors"] = ([{"at": int(time.time()), "where": where, "error": f"{type(ex).__name__}: {ex}"[:200]}] + STATUS["errors"])[:5]
