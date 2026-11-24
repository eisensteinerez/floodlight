"""Floodlight's own usage numbers, for the owner dashboard. Self-hosted: no outside service, no third-party script.

What is kept, and what is not:
- The browser sends a few named events (POST /api/t): a Lab search, a player opened, a board saved, the upgrade page
  seen. No cookies, IP addresses or user agents are stored. Only the device class (phone, tablet, desktop) travels
  with a slow-page report.
- A visitor who is not signed in is a random id made in their own browser, stored here only as a salted hash.
- Raw events are never stored. What is kept: daily counts per event, the day's most viewed players and sports, each
  account's active days and the first time it reached each step of the journey, weekly counts per account (for the
  member's own weekly recap and the referral activity check) and cancellation reasons with an optional note.
- Browsers with Global Privacy Control or Do Not Track on, and anyone who switched usage statistics off, send nothing
  (the browser side, analytics.js, checks this before sending).
- Daily counts older than 400 days and visitor journeys older than 120 days that never became an account are dropped.
"""
import hashlib
import re
import secrets
import threading
import time
from datetime import datetime, timezone

import storage

FILE = None   # set by init()
_lock = threading.Lock()
S = {"salt": "", "days": {}, "actors": {}, "users": {}, "cancel": []}
_dirty = {"n": 0, "saved": 0.0}

# events the browser may send, and the journey step each one marks the first time it happens
EVENTS = {"landing_view", "landing_cta", "page", "search", "player_open", "prediction_follow", "board_save", "alert_create",
          "card_create", "onboarding_done", "upgrade_view", "trial_start", "subscribe", "renew", "cancel", "share",
          "invite_copy", "help_search", "ticket_create", "slow_page", "signup", "session"}
STEP_OF = {"landing_view": "landing", "signup": "signup", "onboarding_done": "onboarding", "search": "first_search",
           "player_open": "player_open", "prediction_follow": "prediction_follow", "board_save": "board_save",
           "upgrade_view": "upgrade_view", "trial_start": "trial_start", "subscribe": "subscribe", "renew": "renew", "cancel": "cancel"}
# the customer journey, in order, with the words the dashboard uses
FUNNEL = (("landing", "Saw the landing page"), ("signup", "Created an account"), ("onboarding", "Finished onboarding"),
          ("first_search", "First search"), ("player_open", "Opened a player"), ("prediction_follow", "Followed a prediction"),
          ("board_save", "Saved a board"), ("upgrade_view", "Saw the upgrade page"), ("trial_start", "Started a trial"),
          ("subscribe", "Subscribed"), ("renew", "Renewed"))
USEFUL = ("first_search", "player_open", "prediction_follow", "board_save")   # "time to first useful action"
CANCEL_REASONS = {"too_expensive": "Too expensive", "inaccurate_data": "Data was inaccurate", "not_used_enough": "Did not use it enough",
                  "missing_sport": "Missing sport or provider", "hard_to_understand": "Difficult to understand",
                  "technical": "Technical problems", "other": "Other"}
FEATURE_OF = {"search": "The Lab", "player_open": "Player profiles", "prediction_follow": "Predictions", "board_save": "Saved boards",
              "alert_create": "Alerts", "card_create": "Prediction Cards", "share": "Sharing"}
SPORTS = {"nfl", "nba", "wnba", "mlb", "nhl", "soccer", "tennis", "ufc", "boxing", "cbb", "cfb", "golf"}
DEVICES = {"phone", "tablet", "desktop"}
_rate = {}   # actor -> [day, events today]: one browser can't flood the counts


def init(path):
    global FILE
    FILE = path
    got = storage.load(path, None)
    with _lock:
        if isinstance(got, dict):
            for k in S:
                if k in got and isinstance(got[k], type(S[k])):
                    S[k] = got[k]
        if not S["salt"]:
            S["salt"] = secrets.token_hex(16)
            _dirty["n"] += 1


def save(force=False):
    """Written at most once a minute (and on demand), so a busy page doesn't rewrite the file on every click."""
    if FILE is None:
        return
    now = time.time()
    with _lock:
        if not _dirty["n"] or (not force and now - _dirty["saved"] < 60):
            return
        _dirty["n"], _dirty["saved"] = 0, now
        _prune(now)
        snap = {k: S[k] for k in S}
        storage.save(FILE, snap)


def day_key(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).strftime("%Y-%m-%d")


def day_num(ts=None):
    return int((ts if ts is not None else time.time()) // 86400)


def week_key(ts=None):
    d = datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).isocalendar()
    return f"{d[0]}-W{d[1]:02d}"


def hash_id(raw):
    raw = re.sub(r"[^A-Za-z0-9_-]", "", str(raw or ""))[:64]
    if len(raw) < 8:
        return ""
    return hashlib.sha256((S["salt"] + raw).encode()).hexdigest()[:20]


def _clean(v, n=60):
    return re.sub(r"[\x00-\x1f<>]", "", str(v or "")).strip()[:n]


def _day(ts):
    k = day_key(ts)
    d = S["days"].get(k)
    if d is None:
        d = S["days"][k] = {"ev": {}, "players": {}, "sports": {}, "pages": {}, "slow": {}, "empty": 0, "failed": 0, "actors": 0}
    return d


def _bump(dct, key, n=1, cap=300):
    if key in dct or len(dct) < cap:
        dct[key] = dct.get(key, 0) + n


def _user(name):
    u = S["users"].get(name)
    if u is None:
        u = S["users"][name] = {"days": [], "steps": {}, "vids": [], "week": {}}
    return u


def _mark_day(u, ts):
    dn = day_num(ts)
    if not u["days"] or u["days"][-1] != dn:
        if dn not in u["days"][-40:]:
            u["days"].append(dn)
            u["days"] = sorted(set(u["days"]))[-400:]


def active(username, ts=None):
    """A signed-in member did something today (server.touch calls this)."""
    if not username:
        return
    with _lock:
        _mark_day(_user(username.lower()), ts or time.time())
        _dirty["n"] += 1


def _record(name, props, user=None, aid="", ts=None):
    ts = ts or time.time()
    d = _day(ts)
    d["ev"][name] = d["ev"].get(name, 0) + 1
    props = props if isinstance(props, dict) else {}
    sport = _clean(props.get("sport"), 12).lower()
    if sport in SPORTS:
        _bump(d["sports"], sport)
    if name == "player_open":
        p = _clean(props.get("player"), 60)
        if p:
            _bump(d["players"], (sport + ":" if sport in SPORTS else "") + p)
    if name == "search":
        if props.get("empty"):
            d["empty"] += 1
        if props.get("failed"):
            d["failed"] += 1
    if name == "page":
        pg = _clean(props.get("name"), 24).lower()
        if re.fullmatch(r"[a-z-]{1,24}", pg or ""):
            _bump(d["pages"], pg, cap=80)
    if name == "slow_page":
        pg = _clean(props.get("name") or "home", 24).lower()
        dev = props.get("device") if props.get("device") in DEVICES else "desktop"
        if re.fullmatch(r"[a-z-]{1,24}", pg):
            _bump(d["slow"], f"{pg}|{dev}", cap=80)
    if name == "cancel":
        reason = props.get("reason") if props.get("reason") in CANCEL_REASONS else "other"
        S["cancel"].insert(0, {"at": int(ts), "reason": reason, "plan": _clean(props.get("plan"), 20), "note": _clean(props.get("note"), 300)})
        del S["cancel"][2000:]
    step = STEP_OF.get(name)
    if user:
        u = _user(user.lower())
        _mark_day(u, ts)
        if step and step not in u["steps"]:
            u["steps"][step] = int(ts)
        if aid:
            if aid not in u["vids"]:
                u["vids"] = (u["vids"] + [aid])[-5:]
            a = S["actors"].get(aid)
            if a is not None and not a.get("user"):
                a["user"] = user.lower()
                for k, t in a.get("steps", {}).items():   # what this browser did before signing up joins the account
                    if k not in u["steps"] or t < u["steps"][k]:
                        u["steps"][k] = t
        wk = u["week"].setdefault(week_key(ts), {})
        wk[name] = wk.get(name, 0) + 1
        if len(u["week"]) > 14:
            for k in sorted(u["week"])[:-14]:
                u["week"].pop(k, None)
    elif aid:
        a = S["actors"].get(aid)
        if a is None:
            if len(S["actors"]) > 50000:
                return
            a = S["actors"][aid] = {"first": int(ts), "steps": {}}
            d["actors"] += 1
        if step and step not in a["steps"]:
            a["steps"][step] = int(ts)
        a["last"] = int(ts)


def event(name, props=None, user=None, vid="", ts=None):
    """Record one event. user is a username (signed in) or None; vid is the browser's random id (hashed here)."""
    if name not in EVENTS:
        return False
    with _lock:
        aid = hash_id(vid) if vid else ""
        key = user or aid or "?"
        today = day_num(ts)
        r = _rate.get(key)
        if not r or r[0] != today:
            r = _rate[key] = [today, 0]
            if len(_rate) > 20000:
                _rate.clear()
                _rate[key] = r
        if r[1] >= 3000:
            return False
        r[1] += 1
        _record(name, props, user=user, aid=aid, ts=ts)
        _dirty["n"] += 1
    return True


def batch(items, user=None, vid=""):
    n = 0
    for it in (items if isinstance(items, list) else [])[:30]:
        if isinstance(it, dict) and event(str(it.get("e") or ""), it.get("p"), user=user, vid=vid):
            n += 1
    return n


def _prune(now):
    cut = day_key(now - 400 * 86400)
    for k in [k for k in S["days"] if k < cut]:
        S["days"].pop(k, None)
    old = now - 120 * 86400
    for k in [k for k, a in S["actors"].items() if not a.get("user") and a.get("last", a.get("first", 0)) < old]:
        S["actors"].pop(k, None)


# ---------- what the owner dashboard reads ----------

def _sum_days(n, now):
    keys = {day_key(now - i * 86400) for i in range(n)}
    out = {"ev": {}, "players": {}, "sports": {}, "pages": {}, "slow": {}, "empty": 0, "failed": 0, "actors": 0}
    for k in keys:
        d = S["days"].get(k)
        if not d:
            continue
        for part in ("ev", "players", "sports", "pages", "slow"):
            for kk, v in d.get(part, {}).items():
                out[part][kk] = out[part].get(kk, 0) + v
        for part in ("empty", "failed", "actors"):
            out[part] += d.get(part, 0)
    return out


def _top(dct, n=10):
    return [[k, v] for k, v in sorted(dct.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def usage(days=30, now=None):
    now = now or time.time()
    with _lock:
        s = _sum_days(days, now)
        series = []
        for i in range(days - 1, -1, -1):
            k = day_key(now - i * 86400)
            d = S["days"].get(k) or {}
            series.append({"day": k, "searches": d.get("ev", {}).get("search", 0), "players": d.get("ev", {}).get("player_open", 0)})
    ev = s["ev"]
    slow = [{"page": k.split("|")[0], "device": k.split("|")[1], "count": v} for k, v in _top(s["slow"], 8)]
    return {"days": days, "searches": ev.get("search", 0), "searchEmpty": s["empty"], "searchFailed": s["failed"],
            "playersOpened": ev.get("player_open", 0), "boardsSaved": ev.get("board_save", 0), "predictionsFollowed": ev.get("prediction_follow", 0),
            "alertsCreated": ev.get("alert_create", 0), "cardsCreated": ev.get("card_create", 0), "shares": ev.get("share", 0),
            "upgradeViews": ev.get("upgrade_view", 0), "landingViews": ev.get("landing_view", 0), "tickets": ev.get("ticket_create", 0),
            "topPlayers": _top(s["players"], 10), "topSports": _top(s["sports"], 10), "topPages": _top(s["pages"], 10),
            "slowPages": slow, "series": series}


def funnel(days=30, now=None):
    """People who reached each step, among those whose journey started in the window. A journey is an account (with
    whatever its browser did before signing up) or a browser that never made one."""
    now = now or time.time()
    since = now - days * 86400
    counts = {k: 0 for k, _ in FUNNEL}
    started = 0
    with _lock:
        journeys = [u["steps"] for u in S["users"].values() if u.get("steps")]
        journeys += [a["steps"] for a in S["actors"].values() if not a.get("user") and a.get("steps")]
        for st in journeys:
            if min(st.values()) < since:
                continue
            started += 1
            for k in counts:
                if k in st:
                    counts[k] += 1
    rows, prev = [], None
    for k, label in FUNNEL:
        n = counts[k]
        rows.append({"step": k, "label": label, "count": n,
                     "fromPrev": round(n / prev * 100, 1) if prev else None})
        prev = n if n else prev
    return {"days": days, "journeys": started, "steps": rows}


def retention(created, now=None):
    """created: {username: account created (unix time)}. Day 1: came back the next day. Day 7: came back in days
    7 to 13. Day 30: came back in days 30 to 36. Only accounts old enough for that day count."""
    now = now or time.time()
    today = day_num(now)
    out = {}
    with _lock:
        for label, lo, hi in (("d1", 1, 1), ("d7", 7, 13), ("d30", 30, 36)):
            base = kept = 0
            for name, c in created.items():
                start = day_num(c)
                if start + lo > today:
                    continue
                base += 1
                days = set((S["users"].get(name.lower()) or {}).get("days", []))
                if any(start + i in days for i in range(lo, hi + 1)):
                    kept += 1
            out[label] = {"cohort": base, "returned": kept, "rate": round(kept / base * 100, 1) if base else None}
    return out


def first_useful_minutes():
    """Median minutes from creating an account to the first search, player, follow or saved board."""
    vals = []
    with _lock:
        for u in S["users"].values():
            st = u.get("steps", {})
            if "signup" in st:
                after = [st[k] for k in USEFUL if k in st and st[k] >= st["signup"]]
                if after:
                    vals.append((min(after) - st["signup"]) / 60)
    if not vals:
        return None
    vals.sort()
    m = len(vals) // 2
    return round(vals[m] if len(vals) % 2 else (vals[m - 1] + vals[m]) / 2, 1)


def onboarding_rate():
    with _lock:
        signed = [u for u in S["users"].values() if "signup" in u.get("steps", {})]
        done = [u for u in signed if "onboarding" in u["steps"]]
    return {"signedUp": len(signed), "finished": len(done), "rate": round(len(done) / len(signed) * 100, 1) if signed else None}


def paid_feature(paid_users):
    """The feature paying members use most, from their weekly counts."""
    tally = {}
    with _lock:
        for name in paid_users:
            for wk in (S["users"].get(name.lower()) or {}).get("week", {}).values():
                for ev, n in wk.items():
                    f = FEATURE_OF.get(ev)
                    if f:
                        tally[f] = tally.get(f, 0) + n
    return _top(tally, 6)


def cancel_reasons(days=90, now=None):
    now = now or time.time()
    since = now - days * 86400
    with _lock:
        rows = [c for c in S["cancel"] if c["at"] >= since]
    tally = {k: 0 for k in CANCEL_REASONS}
    for c in rows:
        tally[c["reason"]] = tally.get(c["reason"], 0) + 1
    return {"days": days, "total": len(rows), "reasons": [{"reason": k, "label": CANCEL_REASONS[k], "count": v} for k, v in tally.items()],
            "notes": [{"at": c["at"], "label": CANCEL_REASONS.get(c["reason"], "Other"), "note": c["note"]} for c in rows if c.get("note")][:20]}


def member(username):
    """One member's own numbers: active days, and research and follow counts by week (for the weekly recap and referrals)."""
    with _lock:
        u = S["users"].get((username or "").lower()) or {}
        return {"days": list(u.get("days", [])), "week": {k: dict(v) for k, v in u.get("week", {}).items()}, "vids": list(u.get("vids", [])),
                "steps": dict(u.get("steps", {}))}


def forget(username):
    """Account deletion: the member's own journey and active days go. Daily totals have no names in them and stay."""
    with _lock:
        if S["users"].pop((username or "").lower(), None) is not None:
            _dirty["n"] += 1
    save(True)
