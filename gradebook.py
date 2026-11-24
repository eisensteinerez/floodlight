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


def set_result(e, result, actual="", why="", by="server", source="", calc="", now=None, closing=None):
    """Put a result on a pick. A real result already there is changed only by a re-check, and the change is kept.
    closing: the last line and price before the start, saved with the first grade and not changed by a re-check."""
    now = now or time.time()
    if e.get("adminLock") and not str(by or "").startswith("admin"):
        return False                # an administrator's correction is final: automatic re-checks never undo it
    if isinstance(closing, dict) and not e.get("closing"):
        e["closing"] = {k: closing.get(k) for k in ("line", "side", "market", "price", "at")}
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


RESULTS = ("won", "lost", "push", "void")


def correct(e, result, actual="", why="", by="admin", now=None):
    """An administrator corrects a grade. The receipt is never touched; the old and new result, the stat, who and why
    are added to the pick's correction history, and the pick is locked against automatic re-grading. Returns the
    correction, or None when nothing changed."""
    now = now or time.time()
    if result not in RESULTS:
        raise ValueError("A grade is hit, miss, push or void.")
    why = str(why or "").strip()
    if len(why) < 8:
        raise ValueError("Say why the grade is wrong (a few words, shown in the public correction log).")
    old, old_actual = e.get("result"), e.get("actual")
    if old == result and (old_actual or "") == (actual or ""):
        return None
    c = {"from": old or None, "to": result, "fromActual": old_actual, "toActual": actual or old_actual or "", "at": int(now), "by": f"admin:{by}"[:60],
         "why": why[:200], "admin": True}
    e.setdefault("corrections", []).append(c)
    e.update({"result": result, "actual": actual or old_actual or "", "graded": int(now), "by": f"admin:{by}"[:60], "source": "Administrator correction", "adminLock": True})
    e.pop("why", None)
    return c


# ---------- the receipt: what was published, frozen ----------
# A receipt is written once, when a pick is first published, and never changed afterwards: later readings, line moves,
# injury news and re-grades are kept beside it. Its "sha" is a fingerprint of everything in it, so a receipt that was
# edited after the fact no longer matches (receipt_ok). Fields the publisher did not know are saved as None.

RECEIPT_FIELDS = ("id", "publishedAt", "event", "start", "league", "player", "playerId", "team", "teamId", "opp", "oppId",
                  "matchup", "market", "marketId", "line", "side", "pick", "provider", "price", "modelProb", "marketProb",
                  "rawEdge", "supportedEdge", "confidence", "confRange", "sources", "injury", "lineup", "verifiedAt")


# added later (evidence grade, sample size, the provider's own market id): part of the fingerprint only for a receipt
# that carries them, so a receipt published before they existed still checks out unchanged
RECEIPT_EXTRA = ("evidence", "sample", "providerMarketId")


def _fingerprint(r):
    body = {k: r.get(k) for k in RECEIPT_FIELDS}
    body.update({k: r[k] for k in RECEIPT_EXTRA if k in r})
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()[:24]


def receipt(**fields):
    r = {k: fields.get(k) for k in RECEIPT_FIELDS}
    r.update({k: fields.get(k) for k in RECEIPT_EXTRA if k in fields})
    if fields.get("backfilled"):
        r["backfilled"] = True   # made later from the original first reading, for a pick published before receipts existed
    r["sha"] = _fingerprint(r)
    return r


def receipt_ok(r):
    return isinstance(r, dict) and r.get("sha") == _fingerprint(r)


def keep_receipt(e, r):
    """Put a receipt on a pick only if it has none: an existing receipt is never replaced."""
    if not isinstance(e.get("receipt"), dict):
        e["receipt"] = r
        return True
    return False


def grading(e):
    """What was saved when the pick was graded: result, the stat or score, the closing line and price, when and from where."""
    if not e.get("result"):
        return None
    c = e.get("closing") or {}
    return {"result": e.get("result"), "stat": e.get("actual") or None, "closeLine": c.get("line"), "closePrice": c.get("price"),
            "closeMarket": c.get("market"), "gradedAt": e.get("graded"), "source": e.get("source") or None, "by": e.get("by"),
            "corrected": bool(e.get("corrections"))}


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
    if not isinstance(out.get("receipt"), dict) and isinstance(other.get("receipt"), dict):
        out["receipt"] = other["receipt"]   # the earliest copy's receipt wins; a copy with none takes the other's
    if not out.get("closing") and other.get("closing"):
        out["closing"] = other["closing"]
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
        # an administrator's correction wins, then the copy re-checked more often
        pick = max((a, b), key=lambda x: (bool(x.get("adminLock")), len(x.get("corrections") or []), -(x.get("graded") or 0)))
    elif ra or rb:
        pick = a if ra else b
    for k in ("result", "actual", "graded", "by", "source", "calc", "why", "corrections", "final", "exact", "stats", "rechecked", "adminLock"):
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
