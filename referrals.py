"""Floodlight referrals: a member's invite link and code, who joined through it, and the reward.

The reward: three friends who really use Floodlight earn the member one month of Plus (at most 12 a year).
A friend only counts once one of these is true:
- they paid for a plan (a verified payment), or
- their account is at least two days old, they came back on 3 different days and did at least 5 research actions
  (Lab searches or players opened), and nothing about the sign-up looks like the member making their own accounts.
Signs of that (the friend then counts only after a verified payment):
- the same browser as the member (the random browser id analytics keeps, hashed),
- the same network as the member (a salted hash of the address's first three parts, never the address itself),
- more than five sign-ups through one link inside a day (everyone past the fifth).
A member can't use their own code, and a friend can be claimed only once, within two days of creating their account.
"""
import hashlib
import secrets
import threading
import time

import storage

FILE = None
_lock = threading.Lock()
R = {"salt": "", "codes": {}, "refs": {}, "nets": {}}   # codes: code -> username; refs: friend -> record; nets: username -> [net hashes]
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PER_REWARD = 3
MAX_MONTHS_YEAR = 12
MIN_DAYS, MIN_ACTIONS, MIN_AGE = 3, 5, 2 * 86400
CLAIM_WINDOW = 2 * 86400
BURST = 5


def init(path):
    global FILE
    FILE = path
    got = storage.load(path, None)
    with _lock:
        if isinstance(got, dict):
            for k in R:
                if isinstance(got.get(k), type(R[k])):
                    R[k] = got[k]
        if not R["salt"]:
            R["salt"] = secrets.token_hex(16)


def _save():
    if FILE is not None:
        storage.save(FILE, R)


def net_hash(addr):
    """The first three parts of an IPv4 address (or the first four of IPv6), salted and hashed. Never the address."""
    addr = (addr or "").strip()
    if not addr:
        return ""
    parts = addr.split(".") if "." in addr else addr.split(":")
    prefix = ".".join(parts[:3]) if "." in addr else ":".join(parts[:4])
    return hashlib.sha256((R["salt"] + prefix).encode()).hexdigest()[:16]


def code_for(username, addr=""):
    key = username.lower()
    with _lock:
        code = next((c for c, u in R["codes"].items() if u == key), None)
        changed = False
        if not code:
            while True:
                code = "".join(secrets.choice(ALPHABET) for _ in range(7))
                if code not in R["codes"]:
                    break
            R["codes"][code] = key
            changed = True
        nh = net_hash(addr)
        if nh and nh not in R["nets"].get(key, []):
            R["nets"][key] = (R["nets"].get(key, []) + [nh])[-5:]
            changed = True
        if changed:
            _save()
    return code


def owner_of(code):
    return R["codes"].get(str(code or "").strip().upper())


def claim(friend, code, created, addr="", friend_vids=(), referrer_vids=(), now=None):
    """A new account says which link brought it. Returns (ok, message)."""
    now = now or time.time()
    friend = friend.lower()
    with _lock:
        by = R["codes"].get(str(code or "").strip().upper())
        if not by:
            return False, "That invite code isn't valid."
        if by == friend:
            return False, "You can't use your own invite code."
        if friend in R["refs"]:
            return False, "This account already has an invite on record."
        if now - created > CLAIM_WINDOW:
            return False, "Invite codes can only be added in the first two days after joining."
        flags = []
        if set(friend_vids) & set(referrer_vids):
            flags.append("same_device")
        nh = net_hash(addr)
        if nh and nh in R["nets"].get(by, []):
            flags.append("same_network")
        recent = [r for r in R["refs"].values() if r["by"] == by and now - r["at"] < 86400]
        if len(recent) >= BURST:
            flags.append("burst")
        R["refs"][friend] = {"by": by, "at": int(now), "flags": flags, "qualified": 0, "via": ""}
        if nh:
            R["nets"][friend] = (R["nets"].get(friend, []) + [nh])[-5:]
        _save()
    return True, "Invite added."


def _check(r, user, activity, now):
    """Does this friend count yet? Returns how ('payment' or 'activity') or ''."""
    if not user:
        return ""
    if user.get("plan_status") == "active" and (user.get("plan") or "free") != "free":
        return "payment"
    if r["flags"]:
        return ""
    if now - int(user.get("created") or now) < MIN_AGE:
        return ""
    days = len(set(activity.get("days", [])))
    actions = sum(w.get("search", 0) + w.get("player_open", 0) for w in activity.get("week", {}).values())
    if days >= MIN_DAYS and actions >= MIN_ACTIONS:
        return "activity"
    return ""


def evaluate(users, activity_of, now=None):
    """Mark friends who now count, and add earned Plus months to each member. users: {key: account};
    activity_of(username) -> analytics.member(). Returns the members whose reward grew."""
    now = now or time.time()
    grew = []
    with _lock:
        changed = False
        for friend, r in R["refs"].items():
            if r["qualified"]:
                continue
            how = _check(r, users.get(friend), activity_of(friend), now)
            if how:
                r["qualified"], r["via"], changed = int(now), how, True
        year = now - 365 * 86400
        for by in {r["by"] for r in R["refs"].values()}:
            u = users.get(by)
            if not u:
                continue
            q = [r for r in R["refs"].values() if r["by"] == by and r["qualified"]]
            old = sum(1 for r in q if r["qualified"] < year)
            earned = old // PER_REWARD + min((len(q) - old) // PER_REWARD, MAX_MONTHS_YEAR)
            had = int(u.get("ref_months_earned") or 0)
            if earned > had:
                u["ref_months_earned"] = earned
                u["ref_credit_months"] = int(u.get("ref_credit_months") or 0) + (earned - had)
                grew.append(by)
                changed = True
        if changed:
            _save()
    return grew


FLAG_WORDS = {"same_device": "Joined from your browser", "same_network": "Joined from your network", "burst": "One of many sign-ups in a day"}


def summary(username, users, activity_of, now=None):
    """What the Invite friends page shows the member."""
    now = now or time.time()
    key = username.lower()
    with _lock:
        mine = [(f, dict(r)) for f, r in R["refs"].items() if r["by"] == key]
    rows = []
    for f, r in sorted(mine, key=lambda x: -x[1]["at"]):
        u = users.get(f) or {}
        act = activity_of(f)
        days = len(set(act.get("days", [])))
        actions = sum(w.get("search", 0) + w.get("player_open", 0) for w in act.get("week", {}).values())
        rows.append({"name": (u.get("prefs") or {}).get("display") or u.get("username") or "A member", "joined": r["at"],
                     "counts": bool(r["qualified"]), "via": r["via"], "days": min(days, MIN_DAYS), "actions": min(actions, MIN_ACTIONS),
                     "flags": [FLAG_WORDS[x] for x in r["flags"] if x in FLAG_WORDS]})
    u = users.get(key) or {}
    q = sum(1 for _, r in mine if r["qualified"])
    return {"joined": len(mine), "counting": q, "toNext": PER_REWARD - q % PER_REWARD, "perReward": PER_REWARD,
            "monthsEarned": int(u.get("ref_months_earned") or 0), "monthsWaiting": int(u.get("ref_credit_months") or 0),
            "rule": {"days": MIN_DAYS, "actions": MIN_ACTIONS, "ageDays": MIN_AGE // 86400, "maxYear": MAX_MONTHS_YEAR},
            "friends": rows[:100], "referredBy": bool(R["refs"].get(key))}


def stats():
    with _lock:
        refs = list(R["refs"].values())
    return {"codes": len(R["codes"]), "joined": len(refs), "counting": sum(1 for r in refs if r["qualified"]),
            "flagged": sum(1 for r in refs if r["flags"] and not r["qualified"])}


def forget(username):
    """Account deletion: the member's invite code, the record of who invited them and their network hashes go. Friends
    they invited keep their accounts; the reward record that pointed at the deleted member is dropped."""
    me = str(username or "").lower()
    with _lock:
        for c in [c for c, u in R["codes"].items() if u == me]:
            R["codes"].pop(c, None)
        R["refs"].pop(me, None)
        for f in [f for f, r in R["refs"].items() if r.get("by") == me]:
            R["refs"].pop(f, None)
        R["nets"].pop(me, None)
        _save()
