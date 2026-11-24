"""Floodlight's one rate limiter. Every limit on the site is a named rule here, so the numbers sit in one place and every
endpoint counts the same way (a sliding window, in memory: a restart forgets the counts, which only ever lets people in).

    ratelimit.take("signup", "ip:" + addr)            # count one; False when the rule's limit is already used
    ratelimit.take("email", "m:" + email, "ip:" + addr, limit=4)   # several keys: refused if any one is full, else all count
    ratelimit.full("login_user", ident)               # look without counting (failed logins count only when they fail)
    ratelimit.clear("login_user", ident)              # a good password clears that account's failures

Keys are whatever identifies the caller for that rule (an account, an email address, an IP address). IP addresses are
only kept here, in memory, for the length of the window.
"""
import threading
import time

# name: (how many, in how many seconds)
RULES = {
    "login_user": (10, 15 * 60),     # failed passwords for one username or email
    "login_ip": (30, 15 * 60),       # failed passwords from one address, across accounts
    "twofa_ip": (20, 15 * 60),       # wrong two-step codes from one address
    "signup": (5, 3600),             # new accounts from one address
    "email": (5, 3600),              # sign-in links, resets, username reminders, confirmations, per address and per visitor
    "invite": (30, 3600),            # invites one member creates
    "share": (30, 3600),             # boards one member shares or re-shares
    "report": (12, 3600),            # "Report incorrect data" from one member or address
    "support": (5, 3600),            # Help center messages from a signed-out address
    "checkout": (20, 3600),          # checkout and billing changes one member starts
}

_hits = {}
_lock = threading.Lock()


def _recent(rule, key, now, window):
    got = [t for t in _hits.get((rule, key), ()) if now - t < window]
    if got:
        _hits[(rule, key)] = got
    else:
        _hits.pop((rule, key), None)
    return got


def _prune(now):
    if len(_hits) > 20000:
        longest = max(w for _, w in RULES.values())
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > longest]:
            _hits.pop(k, None)


def take(rule, *keys, limit=None, window=None, now=None):
    """Count one use for every key. Returns False (and counts nothing) when any key has used up its limit."""
    n, w = RULES[rule]
    n, w = limit or n, window or w
    now = now or time.time()
    keys = [k for k in keys if k]
    with _lock:
        if any(len(_recent(rule, k, now, w)) >= n for k in keys):
            return False
        for k in keys:
            _hits.setdefault((rule, k), []).append(now)
        _prune(now)
    return True


def full(rule, *keys, limit=None, window=None, now=None):
    """Has any key used up the rule's limit? Counts nothing."""
    n, w = RULES[rule]
    n, w = limit or n, window or w
    now = now or time.time()
    with _lock:
        return any(len(_recent(rule, k, now, w)) >= n for k in keys if k)


def note(rule, *keys, now=None):
    """Count one use without checking (a failed login is counted after it failed)."""
    now = now or time.time()
    with _lock:
        for k in keys:
            if k:
                _hits.setdefault((rule, k), []).append(now)
        _prune(now)


def clear(rule, *keys):
    with _lock:
        for k in keys:
            _hits.pop((rule, k), None)


def reset():
    """Forget every count (tests)."""
    with _lock:
        _hits.clear()
