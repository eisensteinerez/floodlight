"""Floodlight's data health: is each outside source answering, and is it fresh?

Every request the server makes goes through server.fetch, which tells this module what it asked for and whether it
worked (classify() maps a URL to a feed and a sport). The pages read GET /api/health for the Data status panel:

  feed        scores, schedules, rosters, props, prices, injuries, transfers, gamelogs
  state       live (fresh), delayed (older than the feed's normal refresh), partial (some sports or sources failed),
              unavailable (the last tries failed and nothing fresh is in hand), or unknown (not asked yet)

The watcher (a background thread, every ten minutes) reads the main scoreboards itself and alerts the site owner when:
  - a league in season has no games in the coming week
  - the player-team mismatch rate rises above 8 percent of the players checked
  - grading stops: props or forecasts older than a day still wait for a grade
  - a source that worked has not answered for three times its normal refresh
  - many players lose their headshots (pages report broken photos)
  - the same two teams appear twice on one day (duplicate games)
  - a game's start time moves by more than three hours without being postponed
  - a live game is still "in progress" eight hours after it started

Alerts are kept (GET /api/admin/alerts for admins) and, when FLOODLIGHT_ALERT_CHANNEL (a Discord channel id) or
FLOODLIGHT_OWNER_DISCORD_ID is set with DISCORD_BOT_TOKEN, sent to Discord. The same alert is sent at most once every
six hours. Nothing here changes what a page shows; it only says how fresh it is.
"""
import datetime as dt
import os
import re
import threading
import time
from pathlib import Path

import storage

FEEDS = {   # feed: (label, normal refresh in seconds)
    "scores": ("Scores", 120),
    "schedules": ("Schedules", 1800),
    "rosters": ("Rosters", 12 * 3600),
    "props": ("Player props", 1800),
    "prices": ("Sportsbook prices", 1800),
    "injuries": ("Injury reports", 6 * 3600),
    "transfers": ("Transfers", 24 * 3600),
    "gamelogs": ("Player game logs", 6 * 3600),
}
SPORT_NAME = {"nba": "NBA", "wnba": "WNBA", "nfl": "NFL", "nhl": "NHL", "mlb": "MLB", "cfb": "College football", "cbb": "College basketball",
              "soccer": "Soccer", "tennis": "Tennis", "ufc": "UFC", "all": "All sports"}
D = {"file": Path(__file__).resolve().parent / ".floodlight-cache" / "health.json", "now": time.time, "send": None,
     "propbook": None, "record": None, "players": None, "fetch": None}
S = {"feeds": {}, "alerts": [], "sent": {}, "starts": {}, "photos": {}, "incidents": []}
_lock = threading.RLock()


def setup(**deps):
    D.update({k: v for k, v in deps.items() if v is not None})
    with _lock:
        saved = storage.load(D["file"], {}) or {}
        for k in ("alerts", "sent", "starts", "incidents"):
            S[k] = saved.get(k) or S[k]
    if deps.get("loop", True):
        threading.Thread(target=_loop, daemon=True, name="health").start()


def _now():
    return D["now"]()


def save():
    with _lock:
        storage.save(D["file"], {"alerts": S["alerts"][-200:], "sent": S["sent"], "starts": dict(list(S["starts"].items())[-3000:]),
                                 "incidents": S["incidents"][-100:]})


# ---------- what each request was ----------
SPORT_IN_URL = [(r"basketball/nba|/nba\b|league=nba", "nba"), (r"basketball/wnba|wnba", "wnba"), (r"football/nfl|/nfl\b", "nfl"),
                (r"college-football", "cfb"), (r"mens-college-basketball|college-basketball", "cbb"), (r"hockey/nhl|nhle|/nhl\b", "nhl"),
                (r"baseball/mlb|statsapi\.mlb|/mlb\b", "mlb"), (r"soccer|fotmob", "soccer"), (r"tennis", "tennis"), (r"mma|ufc", "ufc")]


def classify(url):
    """(feed, sport) for a URL the server fetches, or (None, None) when it isn't one of the tracked feeds."""
    u = str(url).lower()
    sport = next((s for pat, s in SPORT_IN_URL if re.search(pat, u)), "all")
    if "transfermarkt" in u or "/transactions" in u:
        return "transfers", sport
    if "prizepicks" in u or "sleeper.app" in u or "underdog" in u:
        return "props", sport
    if "kalshi" in u or "the-odds-api" in u or "draftkings" in u or "fanduel" in u or "/odds" in u:
        return "prices", sport
    if "injur" in u:
        return "injuries", sport
    if "/roster" in u:
        return "rosters", sport
    if "gamelog" in u or "stats=gamelog" in u:
        return "gamelogs", sport
    if "/scoreboard" in u or "/schedule" in u or "fixtures" in u:
        return "schedules", sport
    if "/summary" in u or "/live" in u or "matchdetails" in u:
        return "scores", sport
    return None, None


def _rec(feed, sport):
    return S["feeds"].setdefault(feed, {}).setdefault(sport or "all", {"ok": None, "fail": None, "err": "", "n": None, "fails": 0, "okAt": None})


def ok(feed, sport="all", err="", n=None):
    if feed not in FEEDS:
        return
    with _lock:
        r = _rec(feed, sport)
        if r.get("down"):   # an outage just ended: it goes into the public incident list
            S["incidents"].append({"feed": feed, "label": FEEDS[feed][0], "sport": sport or "all", "name": SPORT_NAME.get(sport, str(sport).upper()),
                                   "from": r["down"], "to": _now(), "err": plain(r.get("err") or "")})
            S["incidents"] = S["incidents"][-100:]
        r.update(ok=_now(), okAt=_now(), fails=0, n=n if n is not None else r.get("n"), err=err or "", down=None, firstFail=None)


def fail(feed, sport="all", err="", n=None):
    if feed not in FEEDS:
        return
    with _lock:
        r = _rec(feed, sport)
        r.update(fail=_now(), err=str(err)[:160], fails=(r.get("fails") or 0) + 1, firstFail=r.get("firstFail") or _now())
        if r["fails"] >= 2 and not r.get("down"):   # two failures in a row count as an outage
            r["down"] = r["firstFail"]


def plain(err):
    """An error as a person would say it."""
    e = str(err or "")
    m = re.search(r"HTTP Error (\d{3})|\b(4\d\d|5\d\d)\b", e)
    if "timed out" in e.lower() or "timeout" in e.lower():
        return "timed out"
    if m and "HTTP" in e:
        return f"answered with error {m.group(1) or m.group(2)}"
    if "urlopen error" in e or "URLError" in e or "Connection" in e:
        return "couldn't connect"
    if "readable" in e or "JSON" in e:
        return "sent an answer that couldn't be read"
    return e[:80]


def saw(url, good, err=""):
    err = plain(err) if not good else ""
    feed, sport = classify(url)
    if feed:
        (ok if good else fail)(feed, sport, err=err if not good else "")


def state_of(feed, r, now=None):
    now = now or _now()
    every = FEEDS[feed][1]
    if not r or (r.get("ok") is None and r.get("fail") is None):
        return "unknown"
    if r.get("ok") is None or (r.get("fail") and r["fail"] > r["ok"] and r.get("fails", 0) >= 2 and now - r["ok"] > every):
        return "unavailable"
    if now - r["ok"] > every * 2:
        return "delayed"
    if r.get("fail") and r["fail"] > r["ok"]:
        return "partial"
    return "live"


def status():
    """The Data status panel: one line per feed, with each sport under it."""
    now = _now()
    out = []
    with _lock:
        for feed, (label, every) in FEEDS.items():
            by = S["feeds"].get(feed) or {}
            sports = []
            for sp, r in sorted(by.items()):
                sports.append({"sport": sp, "name": SPORT_NAME.get(sp, sp.upper()), "state": state_of(feed, r, now), "at": r.get("ok"),
                               "failAt": r.get("fail"), "err": r.get("err") or "", "n": r.get("n")})
            states = {s["state"] for s in sports} - {"unknown"}
            st = ("unknown" if not states else "live" if states == {"live"} else "unavailable" if states == {"unavailable"}
                  else "delayed" if states <= {"live", "delayed"} and "delayed" in states and len(states) == 1 else "partial")
            last = max((s["at"] or 0 for s in sports), default=0) or None
            out.append({"feed": feed, "label": label, "every": every, "state": st, "at": last, "sports": sports})
    return {"now": now, "feeds": out, "incidents": incidents(now=now)}


def incidents(days=30, now=None):
    """Outages of a source: the ones still going ("open") and the ones resolved in the last `days` days, newest first.
    An outage starts at the first of two or more failures in a row and ends at the next good answer."""
    now = now or _now()
    with _lock:
        live = [{"feed": f, "label": FEEDS[f][0], "sport": sp, "name": SPORT_NAME.get(sp, sp.upper()), "from": r["down"], "to": None, "err": plain(r.get("err") or "")}
                for f, by in S["feeds"].items() if f in FEEDS for sp, r in by.items() if r.get("down")]
        done = [dict(i) for i in S["incidents"] if i["to"] >= now - days * 86400]
    return {"open": sorted(live, key=lambda i: -i["from"]), "resolved": sorted(done, key=lambda i: -i["to"])[:30]}


# ---------- pages report what they see ----------
def page_report(kind, key, now=None):
    """A page saw a broken headshot (kind "photo", key the player id). Counted per hour."""
    now = now or _now()
    if kind != "photo" or not key:
        return
    with _lock:
        hour = int(now // 3600)
        S["photos"] = {h: v for h, v in S["photos"].items() if h >= hour - 1}
        S["photos"].setdefault(hour, set()).add(str(key)[:40])


# ---------- the watcher ----------
SEASONS = {   # league: (ESPN path, months in season)
    "nba": ("basketball/nba", {10, 11, 12, 1, 2, 3, 4, 5, 6}),
    "nhl": ("hockey/nhl", {10, 11, 12, 1, 2, 3, 4, 5, 6}),
    "nfl": ("football/nfl", {9, 10, 11, 12, 1}),
    "cfb": ("football/college-football", {9, 10, 11, 12}),
    "mlb": ("baseball/mlb", {4, 5, 6, 7, 8, 9}),
    "wnba": ("basketball/wnba", {5, 6, 7, 8, 9}),
}
ESPN = "https://site.api.espn.com/apis/site/v2/sports"


def alert(key, text, now=None):
    """Keep an alert and send it to the owner, at most once every six hours per key."""
    now = now or _now()
    with _lock:
        if now - (S["sent"].get(key) or 0) < 6 * 3600:
            return False
        S["sent"][key] = now
        S["alerts"].append({"key": key, "text": text, "at": now})
        S["alerts"] = S["alerts"][-200:]
    send = D.get("send")
    if send:
        try:
            send(text)
        except Exception as e:
            print(f"health: couldn't send the alert: {e}")
    print(f"health alert: {text}")
    save()
    return True


def check_games(lg, events, now=None):
    """The checks one scoreboard answer allows: duplicates, moved start times, stuck live games."""
    now = now or _now()
    seen, found = {}, []
    for e in events:
        c = (e.get("competitions") or [{}])[0]
        teams = tuple(sorted(str((t.get("team") or {}).get("id") or "") for t in c.get("competitors") or []))
        st = ((e.get("status") or c.get("status") or {}).get("type") or {})
        try:
            start = dt.datetime.fromisoformat(str(e.get("date")).replace("Z", "+00:00")).timestamp()
        except Exception:
            continue
        day = time.strftime("%Y-%m-%d", time.gmtime(start - 5 * 3600))
        if all(teams) and len(teams) == 2:
            k = (day, teams)
            if k in seen and seen[k] != e.get("id"):
                found.append(("dup", f"{lg.upper()}: the same two teams appear twice on {day} ({e.get('name') or e.get('shortName') or e.get('id')})."))
            seen[k] = e.get("id")
        key = f"{lg}:{e.get('id')}"
        with _lock:
            was = S["starts"].get(key)
            S["starts"][key] = start
        postponed = re.search(r"postpon|delay|cancel|suspend", str(st.get("name") or st.get("description") or ""), re.I)
        if was and abs(start - was) > 3 * 3600 and not postponed:
            found.append(("moved", f"{lg.upper()}: {e.get('shortName') or e.get('name')} moved from {time.strftime('%b %d %H:%M UTC', time.gmtime(was))} "
                                   f"to {time.strftime('%b %d %H:%M UTC', time.gmtime(start))} without a postponement."))
        if st.get("state") == "in" and now - start > 8 * 3600:
            found.append(("stuck", f"{lg.upper()}: {e.get('shortName') or e.get('name')} is still shown as live {int((now - start) // 3600)} hours after it started."))
    return found


def watch(now=None):
    """One pass of the owner checks. Returns the alerts raised."""
    now = now or _now()
    raised = []
    fetch = D.get("fetch")
    month = time.gmtime(now).tm_mon
    if fetch:
        for lg, (path, months) in SEASONS.items():
            if month not in months:
                continue
            start = time.strftime("%Y%m%d", time.gmtime(now))
            end = time.strftime("%Y%m%d", time.gmtime(now + 7 * 86400))
            q = f"dates={start}-{end}&limit=400" + ("&groups=80" if lg == "cfb" else "")
            try:
                d = fetch(f"{ESPN}/{path}/scoreboard?{q}", 900, as_json=True)
            except Exception:
                continue
            evs = d.get("events") or []
            if not evs:
                if alert(f"zero:{lg}", f"{SPORT_NAME[lg]} returned no games for the next seven days, in season. The schedule feed may be broken."):
                    raised.append(f"zero:{lg}")
            for kind, text in check_games(lg, evs, now):
                if alert(f"{kind}:{lg}:{hash(text) % 10000}", text):
                    raised.append(kind)
    pl = D.get("players")
    if pl:
        try:
            h = pl.health()
            for sp, x in h["sports"].items():
                if x["players"] >= 50 and x["checking"] / x["players"] > .08:
                    if alert(f"mismatch:{sp}", f"{SPORT_NAME.get(sp, sp)}: {x['checking']} of {x['players']} players are being re-checked for their team "
                                               f"({round(100 * x['checking'] / x['players'])}%). Look at Data status for the list."):
                        raised.append(f"mismatch:{sp}")
        except Exception:
            pass
    pb = D.get("propbook")
    if pb:
        try:
            waiting = [e for e in pb() if e.get("result") in (None, "", "pending") and (e.get("start") or now) < now - 30 * 3600]
            if len(waiting) >= 5:
                if alert("grading:props", f"Grading looks stopped: {len(waiting)} props that started more than 30 hours ago still have no grade."):
                    raised.append("grading:props")
        except Exception:
            pass
    with _lock:
        for feed, by in S["feeds"].items():
            for sp, r in by.items():
                every = FEEDS[feed][1]
                if r.get("okAt") and now - r["okAt"] > max(3 * every, 1800) and r.get("fails", 0) >= 3:
                    raised.append(f"stale:{feed}:{sp}")
        stale = [k for k in raised if k.startswith("stale:")]
        hour = int(now // 3600)
        broken = len(S["photos"].get(hour, set()) | S["photos"].get(hour - 1, set()))
    for k in stale:
        _, feed, sp = k.split(":")
        alert(k, f"{FEEDS[feed][0]} ({SPORT_NAME.get(sp, sp)}) hasn't refreshed for "
                 f"{int((now - S['feeds'][feed][sp]['okAt']) // 60)} minutes. Last error: {S['feeds'][feed][sp].get('err') or 'none given'}.")
    if broken >= 25:
        if alert("photos", f"{broken} different player headshots failed to load in the last two hours. The headshot source may have changed."):
            raised.append("photos")
    return raised


def alerts(limit=50):
    with _lock:
        return list(reversed(S["alerts"][-limit:]))


def _loop():
    time.sleep(90)
    while True:
        try:
            watch()
        except Exception as e:
            print(f"health: watch failed: {e}")
        time.sleep(600)


def discord_sender(api):
    """A send(text) for alert(): a channel if FLOODLIGHT_ALERT_CHANNEL is set, else a direct message to the owner."""
    chan, owner = os.environ.get("FLOODLIGHT_ALERT_CHANNEL"), os.environ.get("FLOODLIGHT_OWNER_DISCORD_ID")
    if not os.environ.get("DISCORD_BOT_TOKEN") or not (chan or owner):
        return None
    box = {"dm": None}

    def send(text):
        dest = chan
        if not dest:
            if not box["dm"]:
                box["dm"] = (api("POST", "/users/@me/channels", {"recipient_id": owner}) or {}).get("id")
            dest = box["dm"]
        if dest:
            api("POST", f"/channels/{dest}/messages", {"content": f"⚠️ Floodlight data check: {text}"[:1900], "allowed_mentions": {"parse": []}})
    return send
