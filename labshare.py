"""Floodlight Lab: read-only board links, and how often a line is researched or followed.

Read-only boards: a member shares a saved board and gets a link (/#/board/<id>). The link shows a copy of the board
as it was when it was last shared: its name, notes and the lines in it, the owner's display name and when it was
shared. Sharing the same board again updates the copy behind the same link; stopping sharing removes it. Nobody but
the owner can change it, and opening the link needs no account.

Popularity: Prop Explorer can sort by "Most followed" and "Most researched". Each signed-in member (or browser, for
guests) counts once per line per day. Only the last two days are kept, so the counts describe today's board.

Saved to .floodlight-cache/lab_share.json (and the database copy when DATABASE_URL is set, see storage.py).
"""
import re
import secrets
import threading
import time
from pathlib import Path

import storage

MAX_SHARED = 4000          # shared boards kept in all
MAX_PER_OWNER = 40
MAX_ITEMS = 60
KEEP_POP = 2 * 86400
ID = re.compile(r"[A-Za-z0-9_-]{8,16}")
KEY = re.compile(r"[a-z]{2,8}\|[^|]{1,60}\|[a-z0-9_]{1,16}")   # sport|player|stat

_lock = threading.Lock()
_file = None
_d = {"boards": {}, "pop": {}}
_dirty = {"at": 0}


def setup(cache_dir):
    global _file, _d
    _file = Path(cache_dir) / "lab_share.json"
    data = storage.load(_file, {})
    if isinstance(data, dict):
        _d = {"boards": data.get("boards") or {}, "pop": data.get("pop") or {}}


def _save(force=False):
    if not _file:
        return
    now = time.time()
    if not force and now - _dirty["at"] < 30:
        _dirty["pending"] = True
        return
    _dirty["at"] = now
    _dirty["pending"] = False
    storage.save(_file, _d)


def flush():
    if _dirty.get("pending"):
        _save(force=True)


def _s(v, n):
    return str(v or "")[:n]


def _item(x):
    if not isinstance(x, dict):
        return None
    keep = {"kind": 24, "key": 200, "label": 120, "sub": 140, "photo": 400, "view": 16, "sport": 12, "name": 80, "k": 16, "side": 8}
    out = {k: _s(x.get(k), n) for k, n in keep.items() if x.get(k) not in (None, "")}
    for k in ("line", "at", "start"):
        if isinstance(x.get(k), (int, float)):
            out[k] = x[k]
    return out if out.get("label") or out.get("name") else None


def share(owner, display, board):
    """Share a board (or update the copy behind its link). -> (status, body)"""
    if not isinstance(board, dict) or not _s(board.get("name"), 40).strip():
        return 400, {"error": "That board has no name."}
    items = [i for i in (_item(x) for x in (board.get("items") or [])[:MAX_ITEMS]) if i]
    notes = [_s(n.get("label"), 280) for n in (board.get("items") or []) if isinstance(n, dict) and n.get("kind") == "note"][:20]
    bid = _s(board.get("id"), 40)
    with _lock:
        mine = [k for k, v in _d["boards"].items() if v.get("owner") == owner]
        sid = next((k for k in mine if _d["boards"][k].get("board") == bid), None)
        if not sid:
            if len(mine) >= MAX_PER_OWNER:
                return 400, {"error": f"You can share up to {MAX_PER_OWNER} boards. Stop sharing one first."}
            sid = secrets.token_urlsafe(8)[:11]
        _d["boards"][sid] = {"owner": owner, "by": _s(display, 40) or owner, "board": bid, "name": _s(board.get("name"), 40).strip(),
                             "items": [i for i in items if i.get("kind") != "note"], "notes": notes, "at": int(time.time())}
        if len(_d["boards"]) > MAX_SHARED:
            for k in sorted(_d["boards"], key=lambda k: _d["boards"][k]["at"])[:len(_d["boards"]) - MAX_SHARED]:
                del _d["boards"][k]
        _save()
    return 200, {"id": sid, "at": _d["boards"][sid]["at"]}


def unshare(owner, sid):
    with _lock:
        b = _d["boards"].get(sid)
        if not b or b.get("owner") != owner:
            return 404, {"error": "That link is not one of yours."}
        del _d["boards"][sid]
        _save()
    return 200, {"ok": True}


def shared(sid):
    if not ID.fullmatch(sid or ""):
        return 404, {"error": "That board link is not valid."}
    with _lock:
        b = _d["boards"].get(sid)
        if not b:
            return 404, {"error": "This board is no longer shared."}
        return 200, {k: b[k] for k in ("by", "name", "items", "notes", "at")}


def count(key, kind, who):
    """One member (or browser) researching or following a line, counted once a day."""
    if kind not in ("research", "follow") or not KEY.fullmatch(key or "") or not who:
        return False
    day = time.strftime("%Y-%m-%d", time.gmtime())
    with _lock:
        e = _d["pop"].setdefault(key, {"t": 0})
        seen = e.setdefault(kind, {})
        tag = f"{day}:{who}"
        if tag in seen:
            return False
        seen[tag] = int(time.time())
        e["t"] = int(time.time())
        cut = time.time() - KEEP_POP
        for k in [k for k, v in _d["pop"].items() if v.get("t", 0) < cut]:
            del _d["pop"][k]
        _save()
    return True


def popular():
    cut = time.time() - 86400
    out = {"researched": {}, "followed": {}}
    with _lock:
        for key, e in _d["pop"].items():
            for kind, name in (("research", "researched"), ("follow", "followed")):
                n = sum(1 for t in (e.get(kind) or {}).values() if t >= cut)
                if n:
                    out[name][key] = n
    return out
