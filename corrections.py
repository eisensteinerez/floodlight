"""Floodlight's correction log: when something the site showed turns out to be wrong, it says so in public.

An entry: {id, at, sport, subject, text, before, after, affected, source ("automatic" or "admin"), by}.

Automatic entries come from scan(): a prop the Predictions page locked in (propbook) carried the team the sportsbook
listed. If the player record (players.py) has the player verified on a different team, the card showed the wrong team,
and an entry says which player, what was shown, what is right, and what that changed. One entry per player and wrong
team, however many props carried it. Grades are not changed by a team fix: props are graded from the player's own game
log, and the entry says that.

Admins add or remove entries by hand (POST /api/admin/corrections). Everyone reads GET /api/corrections.
Saved in corrections.json through storage.py.
"""
import secrets
import threading
import time
from pathlib import Path

import storage
import teamcheck

D = {"file": Path(__file__).resolve().parent / ".floodlight-cache" / "corrections.json", "now": time.time}
LOG = {"entries": [], "keys": []}
_lock = threading.RLock()


def setup(**deps):
    D.update({k: v for k, v in deps.items() if v is not None})
    with _lock:
        saved = storage.load(D["file"], {}) or {}
        LOG["entries"] = saved.get("entries") or []
        LOG["keys"] = saved.get("keys") or []


def _save():
    storage.save(D["file"], {"entries": LOG["entries"][-500:], "keys": LOG["keys"][-3000:]})


def entries(limit=100):
    with _lock:
        return sorted(LOG["entries"], key=lambda e: -e["at"])[:limit]


def add(subject, text, sport="", before="", after="", affected="", source="admin", by="", key=None, at=None):
    subject, text = str(subject or "").strip()[:120], str(text or "").strip()[:600]
    if not subject or not text:
        raise ValueError("A correction needs a subject and what was corrected.")
    with _lock:
        if key and key in LOG["keys"]:
            return None
        e = {"id": secrets.token_hex(5), "at": int(at or D["now"]()), "sport": str(sport or "")[:12], "subject": subject, "text": text,
             "before": str(before or "")[:80], "after": str(after or "")[:80], "affected": str(affected or "")[:200], "source": source, "by": str(by or "")[:60]}
        LOG["entries"].append(e)
        if key:
            LOG["keys"].append(key)
        _save()
        return e


def remove(cid):
    with _lock:
        n = len(LOG["entries"])
        LOG["entries"] = [e for e in LOG["entries"] if e["id"] != cid]
        if len(LOG["entries"]) != n:
            _save()
            return True
    return False


def _day(ts):
    return time.strftime("%B %-d", time.gmtime(ts - 5 * 3600))


def scan(props, players, now=None, days=14):
    """Look at the props shown in the last `days` days against the player records. Returns the new entries."""
    now = now or D["now"]()
    by = {}
    for p in props:
        if p.get("sport") not in players.SPORTS or not p.get("team") or (p.get("start") or 0) < now - days * 86400:
            continue
        rec = players.find(p["sport"], p["player"], p.get("team")) if players._state.get("loaded") else None
        if not rec or players.status(rec)[0] != "verified":
            continue
        shown = teamcheck.canon(p["sport"], p["team"])
        if not shown or shown == rec.get("teamAbbr"):
            continue
        by.setdefault((rec["fid"], shown), []).append((p, rec))
    new = []
    for (fid, shown), hits in by.items():
        p, rec = hits[0]
        first = min(h[0]["start"] for h in hits)
        prev = rec.get("prev") or {}
        lag = prev.get("teamAbbr") == shown
        why = (f"The sportsbooks still listed {shown} after the move to {rec.get('teamName')}, and the card used the books' team."
               if lag else f"The card used the sportsbook's team code, which didn't match the roster.")
        n = len(hits)
        e = add(f"{rec.get('name')}: team corrected",
                f"{rec.get('name')} was shown with {shown} on {_day(first)}. The roster has {rec.get('teamName')}. {why} "
                f"Cards now take the team from the player record. Grades were not changed: props are graded from the player's own game log.",
                sport=p["sport"], before=shown, after=rec.get("teamAbbr") or "", affected=f"{n} prediction{'s' if n != 1 else ''}",
                source="automatic", key=f"team:{fid}:{shown}", at=now)
        if e:
            new.append(e)
    return new
