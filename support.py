"""Floodlight support: tickets from the Help center, incorrect-data reports from cards, and the owners' inbox.

A ticket has a number (FL-10427), a kind, the member's words, what the page attached by itself (the page, the browser
and device, and for a data report the market id, player, provider and when the line was last verified), a status
(open, answered, closed) and the conversation. Signed-out visitors can only ask about getting into their account,
billing or a general question, and must leave an email so someone can answer.
"""
import re
import secrets
import threading
import time

import ratelimit
import storage

FILE = None
_lock = threading.Lock()
T = {"seq": 10400, "tickets": []}
MAX = 5000

KINDS = {"question": "Question", "bug": "Bug report", "data": "Incorrect data", "billing": "Billing", "feature": "Feature request",
         "account": "Account recovery"}
SIGNED_OUT_KINDS = ("account", "billing", "question")
# how soon a person can expect an answer, by kind (business days)
REPLY_DAYS = {"data": 1, "billing": 1, "account": 1, "bug": 2, "question": 2, "feature": 3}
STATUS = ("open", "answered", "closed")
CTX_KEYS = {"page": 160, "title": 120, "device": 20, "browser": 60, "os": 40, "viewport": 20, "tz": 40, "theme": 30, "app": 20, "lang": 20,
            "marketId": 80, "providerMarketId": 80, "eventId": 60, "player": 80, "team": 60, "opponent": 60, "sport": 12, "league": 20,
            "stat": 40, "line": 12, "side": 8, "provider": 40, "verifiedAt": 40, "start": 40}
EMAIL = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}")


def init(path):
    global FILE
    FILE = path
    got = storage.load(path, None)
    with _lock:
        if isinstance(got, dict) and isinstance(got.get("tickets"), list):
            T["tickets"] = got["tickets"]
            T["seq"] = max(int(got.get("seq") or 10400), 10400)


def _save():
    if FILE is not None:
        storage.save(FILE, {"seq": T["seq"], "tickets": T["tickets"]})


def _text(v, n):
    return re.sub(r"[ \t]+", " ", re.sub(r"[\x00-\x08\x0b-\x1f]", "", str(v or ""))).strip()[:n]


def clean_context(raw):
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for k, n in CTX_KEYS.items():
        v = raw.get(k)
        if v is None or v == "":
            continue
        out[k] = _text(v, n)
    return out


def signed_out_allowed(addr_key, now=None):
    """At most 5 signed-out messages an hour from one network (ratelimit.py)."""
    return ratelimit.take("support", addr_key, now=now)


def public(t, staff=False):
    out = {"id": t["id"], "kind": t["kind"], "kindLabel": KINDS.get(t["kind"], "Question"), "subject": t["subject"], "status": t["status"],
           "created": t["created"], "updated": t["updated"], "replyDays": REPLY_DAYS.get(t["kind"], 2), "context": t.get("context", {}),
           "messages": [{"by": m["by"], "name": m.get("name", ""), "text": m["text"], "at": m["at"]} for m in t.get("messages", [])]}
    if staff:
        out.update({"user": t.get("user") or "", "email": t.get("email") or "", "display": t.get("display") or ""})
    elif t.get("email"):
        out["email"] = t["email"]
    return out


def create(body, user=None, display=""):
    """Returns (status, payload). user is the member's username, or None when signed out."""
    kind = str(body.get("kind") or "question")
    if kind not in KINDS:
        kind = "question"
    if body.get("website"):   # a field people never see; only form-filling robots type into it
        return 200, {"ok": True, "ticket": {"id": "FL-0", "status": "open", "replyDays": 2}}
    if not user and kind not in SIGNED_OUT_KINDS:
        return 401, {"error": "Sign in to send this kind of report, so we can follow up with you."}
    subject = _text(body.get("subject"), 120)
    text = _text(body.get("text"), 4000)
    email = _text(body.get("email"), 254)
    if email and not EMAIL.fullmatch(email):
        return 400, {"error": "That email address doesn't look right. Check it and try again.", "field": "email"}
    if not user and not email:
        return 400, {"error": "Add an email address so we can answer you.", "field": "email"}
    if len(text) < 10:
        return 400, {"error": "Describe what happened in a sentence or two (at least 10 characters).", "field": "text"}
    ctx = clean_context(body.get("context"))
    if not subject:
        subject = (f"{ctx.get('player') or 'A market'} · {ctx.get('stat') or 'line'}" if kind == "data" and ctx.get("player")
                   else text.split(".")[0][:80])
    now = int(time.time())
    with _lock:
        T["seq"] += 1 + secrets.randbelow(3)
        t = {"id": f"FL-{T['seq']}", "kind": kind, "subject": subject, "status": "open", "created": now, "updated": now,
             "user": (user or "").lower(), "display": _text(display, 40), "email": email, "context": ctx,
             "messages": [{"by": "member", "name": _text(display, 40) or "You", "text": text, "at": now}]}
        T["tickets"].insert(0, t)
        del T["tickets"][MAX:]
        _save()
    return 200, {"ok": True, "ticket": public(t)}


def mine(user):
    key = (user or "").lower()
    with _lock:
        return [public(t) for t in T["tickets"] if key and t.get("user") == key][:100]


def _find(tid):
    for t in T["tickets"]:
        if t["id"] == tid:
            return t
    return None


def member_reply(user, body, display=""):
    with _lock:
        t = _find(str(body.get("id") or ""))
        if not t or t.get("user") != (user or "").lower():
            return 404, {"error": "That ticket isn't on your account."}
        text = _text(body.get("text"), 4000)
        if len(text) < 2:
            return 400, {"error": "Write a reply first."}
        now = int(time.time())
        t["messages"].append({"by": "member", "name": _text(display, 40) or "You", "text": text, "at": now})
        del t["messages"][:-60]
        t["status"], t["updated"] = "open", now
        _save()
        return 200, {"ok": True, "ticket": public(t)}


def staff_list(status=None):
    with _lock:
        rows = [public(t, staff=True) for t in T["tickets"] if not status or t["status"] == status]
        counts = {s: sum(1 for t in T["tickets"] if t["status"] == s) for s in STATUS}
        by_kind = {k: sum(1 for t in T["tickets"] if t["kind"] == k and t["status"] != "closed") for k in KINDS}
        overdue = 0
        now = time.time()
        for t in T["tickets"]:
            if t["status"] == "open" and now - t["created"] > REPLY_DAYS.get(t["kind"], 2) * 86400 * 1.4:   # business days, roughly
                overdue += 1
    return {"tickets": rows[:300], "counts": counts, "byKind": by_kind, "overdue": overdue, "kinds": KINDS}


def staff_action(body, staff_name):
    with _lock:
        t = _find(str(body.get("id") or ""))
        if not t:
            return 404, {"error": "That ticket wasn't found."}
        now = int(time.time())
        action = body.get("action")
        if action == "reply":
            text = _text(body.get("text"), 4000)
            if len(text) < 2:
                return 400, {"error": "Write a reply first."}
            t["messages"].append({"by": "staff", "name": _text(staff_name, 40) or "Floodlight", "text": text, "at": now})
            del t["messages"][:-60]
            t["status"] = "answered"
        elif action == "status" and body.get("status") in STATUS:
            t["status"] = body["status"]
        else:
            return 400, {"error": "Unknown action."}
        t["updated"] = now
        _save()
        return 200, {"ok": True, "ticket": public(t, staff=True)}


def forget(user):
    """Account deletion: the member's tickets go (they hold their name, email and messages)."""
    key = str(user or "").lower()
    with _lock:
        before = len(T["tickets"])
        T["tickets"] = [t for t in T["tickets"] if t.get("user") != key]
        changed = len(T["tickets"]) != before
    if changed:
        _save()
