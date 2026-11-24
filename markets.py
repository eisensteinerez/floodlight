"""Floodlight · VerifiedMarketService: the one place that decides which player-prop markets exist right now.

Every page that shows a line (Predictions, the Lab's Prop Explorer, player profiles, Search, Parlays, the Fade List,
Standout Lines, Alerts, Home) reads it through this service: GET /api/lab/board returns only the rows it marks open,
and GET /api/markets returns the open markets, the ones taken off and why, and how each provider and schedule is doing.

A market is one provider's line for one player, statistic and number. It is open only when all of these pass:
  - the game exists on the league schedule (ESPN; for soccer, the provider's own start and opponent, both required)
  - the game is scheduled and starts in the future
  - the market is still offered and not suspended by the provider
  - the player belongs to one of the two teams (players.py did not hold the row)
  - the opponent is confirmed (the provider's opponent, if given, is the schedule's opponent)
  - the provider answered within MAX_AGE (verifiedAt is the time of that read, never the time of the request)
  - the market's date matches the event's date (start within 12 hours; a line with no start of its own only binds to a
    game in the next 36 hours, and a provider id first seen before the team's last game belongs to that game)
  - the player is not ruled out on the injury report

Statuses (STATUS): open, suspended, closed, started, expired, voided, postponed, missing_matchup, player_out,
provider_unavailable, awaiting_verification. Only open is shown on a board; every other one is listed under "Taken off
the board" with a short message (REMOVAL: "Game started", "Player ruled out", ...) and the detailed reason.

Each market keeps: internal id, provider's id, event, player, team and opponent ids, sport, league, statistic, side,
line, provider, price, event start, the user-facing time zone, status, last verified, first observed, closing line and
price, removal reason, and the last few line moves. Kept in .floodlight-cache/markets.json (and the database when
DATABASE_URL is set) for three days after the game.

evaluate() is pure (tests/test_markets.py drives it with fixed clocks); refresh() applies it to a board read and
keeps the record; monitor() feeds the owner's data-monitoring panel and alerts (health.py).
"""
import datetime as dt
import hashlib
import re
import threading
import time
import unicodedata
from pathlib import Path

import storage

STATUS = ("open", "suspended", "closed", "started", "expired", "voided", "postponed", "missing_matchup", "player_out", "provider_unavailable", "awaiting_verification")
LABEL = {"open": "Open", "suspended": "Suspended", "closed": "Closed", "started": "Started", "expired": "Expired", "voided": "Voided", "postponed": "Postponed",
         "missing_matchup": "Missing matchup", "player_out": "Player ruled out", "provider_unavailable": "Provider unavailable",
         "awaiting_verification": "Awaiting verification"}
# the short message every page shows for a market taken off the board (the detailed reason sits beside it)
REMOVAL = {"started": "Game started", "expired": "Game started", "closed": "Market closed", "suspended": "Market closed", "voided": "Market closed",
           "postponed": "Event postponed", "player_out": "Player ruled out", "missing_matchup": "Matchup could not be verified",
           "provider_unavailable": "Data source temporarily unavailable", "awaiting_verification": "Data source temporarily unavailable"}


def removal_message(status, reason=""):
    """'Provider removed the line' when the provider stopped offering it; otherwise the status's message."""
    if status == "closed" and re.search(r"no longer offers|removed", reason or "", re.I):
        return "Provider removed the line"
    return REMOVAL.get(status, "")


MAX_AGE = 90 * 60          # a line its provider has not re-read for this long is no longer verified
FRESH = 30 * 60            # within this it is "current"; between FRESH and MAX_AGE the page says "last verified"
NO_START_HORIZON = 36 * 3600   # a line with no start time of its own binds only to a game this close
TIME_SLACK = 12 * 3600     # provider start and schedule start may differ by this much (time zones, flex scheduling)
KEEP = 3 * 86400           # records are kept this long after their game
LEAGUE_TZ = "America/New_York"   # the day a market belongs to, for the record (pages show it in the viewer's zone)
SCHED_SPORTS = {"nba", "wnba", "nfl", "nhl", "mlb"}
BOOK_NAME = {"prizepicks": "PrizePicks", "sleeper": "Sleeper", "underdog": "Underdog"}
# Hot: the one rule every page uses for "running hot" (Home, the Lab's start screen, Prop Explorer's Hot tag)
HOT_L10, HOT_L5, HOT_N = .7, .6, 8

D = {"file": Path(__file__).resolve().parent / ".floodlight-cache" / "markets.json", "now": time.time, "schedule": None, "injuries": None}
S = {"markets": {}, "seen": {}, "providers": {}, "schedules": {}, "injuries": {}, "loaded": False, "saved": 0}
_lock = threading.RLock()


# ---------- small helpers ----------
def _n(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def _pname(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r" (jr|sr|ii|iii|iv)$", "", re.sub(r"\s+", " ", s).strip())


def ts(v):
    """An ISO time, epoch seconds or epoch milliseconds -> epoch seconds (float), or None."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v) / 1000 if v > 1e11 else float(v)
    try:
        t = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return (t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)).timestamp()
    except ValueError:
        return None


def day_key(t, tz=LEAGUE_TZ):
    """The calendar day an epoch second falls on in a time zone: '2026-11-23'."""
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.fromtimestamp(t, ZoneInfo(tz)).strftime("%Y-%m-%d")
    except Exception:
        return dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def market_id(sport, book, provider_id, player, k, line, side=""):
    """The internal id: stable for one provider market. With no provider id it is built from the player, statistic and
    line, so a moved line without an id is a new market and the old one closes."""
    base = f"{sport}|{book}|{provider_id}" if provider_id else f"{sport}|{book}|{_pname(player)}|{k}|{line}|{side}"
    return "mk_" + hashlib.sha1(base.encode()).hexdigest()[:16]


# ---------- the schedule ----------
def _team(c):
    t = (c or {}).get("team") or {}
    names = {_n(x) for x in (t.get("abbreviation"), t.get("displayName"), t.get("shortDisplayName"), t.get("name"), t.get("location"), t.get("nickname")) if x}
    return {"id": str(t.get("id") or ""), "abbr": t.get("abbreviation") or "", "name": t.get("shortDisplayName") or t.get("name") or t.get("displayName") or "",
            "names": names, "home": (c or {}).get("homeAway") == "home"}


def ev_status(e):
    st = ((e.get("competitions") or [{}])[0].get("status") or e.get("status") or {}).get("type") or {}
    txt = f"{st.get('name') or ''} {st.get('description') or ''} {st.get('detail') or ''}"
    if re.search(r"cancel|forfeit", txt, re.I):
        return "cancelled"
    if re.search(r"postpon|suspend", txt, re.I):
        return "postponed"
    return "live" if st.get("state") == "in" else "final" if st.get("state") == "post" or st.get("completed") else "scheduled"


def events_from(scoreboard, league=""):
    """ESPN scoreboard JSON -> [{id, start, status, league, teams: [team, team]}]."""
    out = []
    for e in (scoreboard or {}).get("events") or []:
        comp = (e.get("competitions") or [{}])[0]
        cs = comp.get("competitors") or []
        if len(cs) != 2:
            continue
        out.append({"id": str(e.get("id") or comp.get("id") or ""), "start": ts(e.get("date") or comp.get("date")), "status": ev_status(e),
                    "league": league, "teams": [_team(c) for c in cs]})
    return out


def find_event(team_names, events, start, now):
    """The game a market belongs to: one the player's team is in, closest to the provider's start (or, with no start,
    the next one still to play). Returns (event, me, opponent) or (None, None, None)."""
    mine = {_n(x) for x in team_names if x}
    if not mine:
        return None, None, None
    hits = []
    for e in events or []:
        me = next((t for t in e["teams"] if t["names"] & mine), None)
        if me:
            hits.append((e, me, next(t for t in e["teams"] if t is not me)))
    if not hits:
        return None, None, None
    if start:
        return min(hits, key=lambda h: abs((h[0]["start"] or 0) - start))
    ahead = sorted((h for h in hits if h[0]["status"] == "scheduled" and (h[0]["start"] or 0) > now), key=lambda h: h[0]["start"])
    return ahead[0] if ahead else max(hits, key=lambda h: h[0]["start"] or 0)


def last_started(team_names, events, now):
    """When the team's most recent game that has begun started (live or final), or None."""
    mine = {_n(x) for x in team_names if x}
    ts_ = [e["start"] for e in events or [] if e["start"] and e["start"] <= now and e["status"] in ("live", "final") and any(t["names"] & mine for t in e["teams"])]
    return max(ts_) if ts_ else None


def implied(o, side):
    """The market's own chance for the side, with the margin taken out (pOver is the no-vig over chance); None when the
    provider posts no two-sided price (pick'em apps), so nothing is made up."""
    p = (o or {}).get("pOver")
    if p is None:
        return None
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    return round(p if side != "under" else 1 - p, 4)


def _availability(r, v):
    """The player's availability as the injury report gives it, in words: its status, 'Not on the injury report', or
    'Injury report not checked' when the report did not load (never assumed fine)."""
    st = (v or {}).get("injury") or r.get("injury")
    if st and st.get("status"):
        return st["status"]
    if (v or {}).get("status") == "player_out":
        return "Out"
    return "Not on the injury report" if r.get("injuryChecked") else "Injury report not checked"


def _dedupe(rows):
    """Duplicate provider rows normalized: one row per player (name spelled any way), statistic, line and side, with
    every provider's offer merged and the same provider market id kept once."""
    out, by = [], {}
    for r in rows:
        k = (_pname(r.get("player")), r.get("k"), r.get("line"), r.get("side"))
        if k not in by:
            by[k] = dict(r, offers=list(r.get("offers") or []))
            out.append(by[k])
            continue
        have = {(o.get("book"), o.get("mid") or "", o.get("line")) for o in by[k]["offers"]}
        for o in r.get("offers") or []:
            if (o.get("book"), o.get("mid") or "", o.get("line")) not in have:
                by[k]["offers"].append(o)
    return out


# ---------- one row: is it open? ----------
def _verdict(status, reason, **kw):
    return dict(status=status, label=LABEL[status], reason=reason, **kw)


def evaluate(row, ctx):
    """row: a board row (lab.board shape before filtering) with offers. ctx: {now, sport, schedule: {ok, events} | None,
    injuries: {ok, players: {name: {status, lv}}} | None, providers: {book: {ok, at, error}}, seen: {providerId: {first,
    event}}}. Returns the row verdict (status, reason, event, me, opp) and one verdict per offer."""
    now, sport = ctx["now"], ctx.get("sport") or row.get("sport") or ""
    offers = row.get("offers") or []
    pstart = next((ts(o.get("start")) for o in offers if o.get("start")), None) or ts(row.get("start"))
    sched = ctx.get("schedule")
    names = [row.get("team"), row.get("bookTeam"), row.get("teamName")]
    ev = me = op = None

    def done(v):
        per = {}
        for o in offers:
            b = o.get("book") or ""
            pv = (ctx.get("providers") or {}).get(b) or {}
            at = ts(o.get("at")) or pv.get("at")
            if v["status"] != "open":
                per[id(o)] = v
            elif str(o.get("status") or "").lower() not in ("", "pre_game", "active", "open"):
                per[id(o)] = _verdict("suspended", f"{BOOK_NAME.get(b, b)} has suspended this line")
            elif not pv.get("ok", True) and (not at or now - at > FRESH):
                # the provider's latest read failed: an older reading is never passed off as current
                per[id(o)] = _verdict("provider_unavailable", f"{BOOK_NAME.get(b, b)} did not answer" + (f"; last verified {_clock(at)}" if at else ""))
            elif not at or now - at > MAX_AGE:
                per[id(o)] = _verdict("awaiting_verification", f"{BOOK_NAME.get(b, b)} has not re-checked this line since {_clock(at)}" if at else "Not verified by the provider yet")
            else:
                pid = o.get("mid") or ""
                seen = (ctx.get("seen") or {}).get(pid) if pid else None
                if seen and seen.get("line") is not None and seen.get("line") != o.get("line"):
                    seen = None   # the provider re-posted this id with a new number: a new posting
                last = last_started(names, (sched or {}).get("events"), now) if sched and sched.get("ok") else None
                if seen and ev and seen.get("event") and seen["event"] != ev["id"]:
                    per[id(o)] = _verdict("expired", "The provider still lists a line it posted for an earlier game")
                elif seen and last and seen.get("first") and seen["first"] < last and (not ev or ev["start"] > last):
                    per[id(o)] = _verdict("expired", "Posted before the team's last game, so it belonged to that game")
                else:
                    per[id(o)] = dict(v, verifiedAt=at)
        # the row is open when its main line is open at some provider
        main = [per[id(o)] for o in offers if o.get("line") == row.get("line")] or list(per.values())
        good = [x for x in main if x["status"] == "open"]
        if good:
            rv = dict(v, verifiedAt=max(x.get("verifiedAt") or 0 for x in good))
        else:
            order = ["player_out", "started", "expired", "postponed", "voided", "closed", "suspended", "provider_unavailable", "missing_matchup", "awaiting_verification"]
            rv = sorted(main or [v], key=lambda x: order.index(x["status"]) if x["status"] in order else 99)[0] if main else v
        return rv, per, ev, me, op

    # the provider's own state for the line
    if row.get("hold"):
        return done(_verdict("awaiting_verification", "The player's team is being checked"))
    if pstart and pstart <= now:
        return done(_verdict("started", "The game has started", start=pstart))
    # the injury report
    inj = (ctx.get("injuries") or {}).get("players") or {}
    st = inj.get(_pname(row.get("player")))
    if st and st.get("lv") == "out":
        return done(_verdict("player_out", f"{row.get('player')} is listed out" + (f" ({st.get('status')})" if st.get("status") else ""), injury=st))
    # the event
    if sport in SCHED_SPORTS:
        if not sched or not sched.get("ok"):
            return done(_verdict("awaiting_verification", "The league schedule did not load, so the matchup can't be confirmed"))
        ev, me, op = find_event(names, sched.get("events"), pstart, now)
        if not ev:
            return done(_verdict("missing_matchup", f"No {row.get('teamName') or row.get('team') or 'team'} game on the league schedule"))
        if ev["status"] == "postponed":
            return done(_verdict("postponed", "The game was postponed"))
        if ev["status"] == "cancelled":
            return done(_verdict("voided", "The game was cancelled"))
        if ev["status"] == "live":
            return done(_verdict("started", "The game has started"))
        if ev["status"] == "final":
            return done(_verdict("expired" if pstart else "closed", "The game is over" if pstart else "Its game is over, but the provider still lists the line"))
        if not ev["start"] or ev["start"] <= now:
            return done(_verdict("started", "The game has started"))
        if pstart and abs(ev["start"] - pstart) > TIME_SLACK:
            return done(_verdict("missing_matchup", "The provider's start time doesn't match the league schedule"))
        if pstart and day_key(pstart) != day_key(ev["start"]) and abs(ev["start"] - pstart) > 3 * 3600:
            return done(_verdict("missing_matchup", "The provider's date doesn't match the game's date"))
        if not pstart and ev["start"] - now > NO_START_HORIZON:
            return done(_verdict("missing_matchup", f"No start time from the provider, and the next {me['name'] or 'team'} game is more than a day and a half away"))
        popp = row.get("opp") or next((o.get("opp") for o in offers if o.get("opp")), "")
        if popp and _n(popp) not in op["names"] and not any(_n(popp) in n or n in _n(popp) for n in op["names"] if len(n) > 2):
            return done(_verdict("missing_matchup", f"The provider lists {popp} as the opponent; the schedule says {op['name']}"))
        return done(_verdict("open", "", start=ev["start"]))
    # no single schedule (soccer): the provider's own start and opponent are both required
    if not pstart:
        return done(_verdict("missing_matchup", "Game time not confirmed"))
    popp = row.get("opp") or next((o.get("opp") for o in offers if o.get("opp")), "")
    if not popp:
        return done(_verdict("missing_matchup", "Opponent not confirmed"))
    ev = {"id": "", "start": pstart, "status": "scheduled", "league": sport, "teams": []}
    me = {"id": "", "abbr": row.get("team") or "", "name": row.get("teamName") or row.get("team") or "", "names": set(), "home": None}
    op = {"id": "", "abbr": popp, "name": popp, "names": {_n(popp)}, "home": None}
    return done(_verdict("open", "", start=pstart, provider_only=True))


def _clock(t):
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.fromtimestamp(t, ZoneInfo(LEAGUE_TZ)).strftime("%-I:%M %p ET")
    except Exception:
        return iso(t) or "?"


def is_hot(row):
    """The one "running hot" rule: the side the board ranks came in at least 7 of the last 10 (8+ games), and 3 of 5."""
    l10, l5, n = row.get("l10"), row.get("l5"), row.get("n") or 0
    return l10 is not None and l5 is not None and n >= HOT_N and l10 >= HOT_L10 and l5 >= HOT_L5


# ---------- the record ----------
def _load():
    if S["loaded"]:
        return
    with _lock:
        if S["loaded"]:
            return
        saved = storage.load(D["file"], {}) or {}
        S["markets"] = saved.get("markets") or {}
        S["seen"] = saved.get("seen") or {}
        S["loaded"] = True


def save(force=False):
    now = D["now"]()
    if not force and now - S["saved"] < 60:
        return
    with _lock:
        cut = now - KEEP
        for k in [k for k, m in S["markets"].items() if (m.get("start") or m.get("lastSeen") or 0) < cut and (m.get("lastSeen") or 0) < cut]:
            S["markets"].pop(k, None)
        for k in [k for k, x in S["seen"].items() if (x.get("last") or 0) < cut]:
            S["seen"].pop(k, None)
        data = {"markets": S["markets"], "seen": S["seen"]}
        S["saved"] = now
    try:
        storage.save(D["file"], data)
    except Exception as e:
        print(f"markets: couldn't save: {e}")


def setup(**deps):
    D.update({k: v for k, v in deps.items() if v is not None})
    S["loaded"] = False
    _load()


def _schedule(sport):
    if sport not in SCHED_SPORTS or not D.get("schedule"):
        return None
    try:
        evs = D["schedule"](sport)
        v = {"ok": True, "at": D["now"](), "events": evs, "error": ""}
    except Exception as e:
        old = S["schedules"].get(sport) or {}
        v = {"ok": bool(old.get("ok")) and D["now"]() - (old.get("at") or 0) < 3600, "at": old.get("at"), "events": old.get("events") or [], "error": f"{type(e).__name__}: {e}"[:160]}
    S["schedules"][sport] = v
    return v


def _injuries(sport):
    if not D.get("injuries"):
        return None
    try:
        v = {"ok": True, "at": D["now"](), "players": D["injuries"](sport) or {}}
    except Exception as e:
        old = S["injuries"].get(sport) or {}
        v = {"ok": False, "at": old.get("at"), "players": old.get("players") or {}, "error": f"{type(e).__name__}: {e}"[:160]}
    S["injuries"][sport] = v
    return v


def refresh(sport, rows, fetched=None, errors=None, tz=LEAGUE_TZ, schedule=None, injuries=None, now=None, sweep=True):
    """Check every row of a board read. Returns {rows: open rows with their market fields, removed: [...], counts,
    providers, schedule}. The record is updated: first observed, last verified, closing line, status and reason."""
    _load()
    now = now if now is not None else D["now"]()
    errors = errors or {}
    fetched = ts(fetched) or None
    sched = schedule if schedule is not None else _schedule(sport)
    inj = injuries if injuries is not None else _injuries(sport)
    books = {o.get("book") for r in rows for o in r.get("offers") or [] if o.get("book")} | set(errors) | {"prizepicks", "sleeper"}
    with _lock:
        provs = {}
        for b in books:
            key = f"{sport}:{b}"
            old = S["providers"].get(key) or {}
            ok = b not in errors
            at = fetched if ok and fetched else old.get("at")
            provs[b] = S["providers"][key] = {"ok": ok, "at": at, "error": errors.get(b, ""), "checked": now}
        ctx = {"now": now, "sport": sport, "schedule": sched, "injuries": inj, "providers": provs, "seen": S["seen"]}
        out, removed, live_ids = [], [], set()
        injp = (inj or {}).get("players") or {}
        for r in _dedupe(rows):
            rv, per, ev, me, op = evaluate(r, ctx)
            r = dict(r, injury=injp.get(_pname(r.get("player"))) if inj and inj.get("ok") else None, injuryChecked=bool(inj and inj.get("ok")))
            offers = []
            for o in r.get("offers") or []:
                v = per.get(id(o)) or rv
                mid = market_id(sport, o.get("book") or "", o.get("mid") or "", r.get("player"), r.get("k"), o.get("line"), r.get("side") if not o.get("mid") else "")
                live_ids.add(mid)
                rec = _keep(mid, sport, r, o, v, ev, me, op, now, tz)
                if v["status"] == "open":
                    offers.append(dict(o, marketId=mid, verifiedAt=rec["verifiedAt"]))
            main = next((x for x in offers if x.get("line") == r.get("line") and x.get("book") == "prizepicks"), None) or next((x for x in offers if x.get("line") == r.get("line")), None)
            if rv["status"] == "open" and main:
                rec = S["markets"][main["marketId"]]
                out.append(dict(r, offers=offers, books=sorted({x["book"] for x in offers}), **_row_fields(rec, rv, me, op, ev, now, r)))
            else:
                mid = market_id(sport, (r.get("offers") or [{}])[0].get("book") or "", (r.get("offers") or [{}])[0].get("mid") or "", r.get("player"), r.get("k"), r.get("line"), r.get("side"))
                removed.append({"mid": mid, "player": r.get("player"), "team": r.get("team"), "opp": (op or {}).get("abbr") or r.get("opp") or "", "k": r.get("k"), "label": r.get("label"),
                                "line": r.get("line"), "side": r.get("side"), "books": sorted({o.get("book") for o in r.get("offers") or [] if o.get("book")}),
                                "status": rv["status"] if rv["status"] != "open" else "awaiting_verification", "statusLabel": LABEL[rv["status"] if rv["status"] != "open" else "awaiting_verification"],
                                "reason": rv["reason"] or "No provider has this line open", "start": iso((ev or {}).get("start") or rv.get("start")), "eventId": (ev or {}).get("id") or "",
                                "verifiedAt": int(rv.get("verifiedAt") or 0) or None, "message": removal_message(rv["status"] if rv["status"] != "open" else "awaiting_verification", rv["reason"]),
                                "eventStatus": (ev or {}).get("status") or ""})
        # markets on record that this read no longer has (only a full board read can say a line is gone)
        answered = {b for b, p in provs.items() if p["ok"]}
        for mid, m in S["markets"].items():
            if not sweep or m.get("sport") != sport or mid in live_ids or m.get("status") not in ("open", "suspended", "awaiting_verification", "provider_unavailable"):
                continue
            start = m.get("start")
            if start and start <= now:
                _close(m, "started", "The game has started", now)
            elif m.get("provider") not in answered:
                _close(m, "provider_unavailable", f"{BOOK_NAME.get(m.get('provider'), m.get('provider'))} did not answer; last verified {_clock(m['verifiedAt'])}" if m.get("verifiedAt") else "The provider did not answer", now)
            else:
                _close(m, "closed", "The provider no longer offers this line", now)
        # the markets the record took off since, for the page's "Taken off the board" (not already in removed)
        have = {x["mid"] for x in removed}
        for mid, m in S["markets"].items():
            if sweep and m.get("sport") == sport and m.get("status") != "open" and mid not in live_ids and mid not in have and now - (m.get("removedAt") or 0) < 12 * 3600:
                removed.append({"mid": mid, "player": m.get("player"), "team": m.get("team"), "opp": m.get("oppAbbr") or "", "k": m.get("stat"), "label": m.get("statLabel"),
                                "line": m.get("line"), "side": m.get("side"), "books": [m.get("provider")], "status": m["status"], "statusLabel": LABEL.get(m["status"], m["status"]),
                                "reason": m.get("removalReason") or "", "start": iso(m.get("start")), "eventId": m.get("eventId") or "", "verifiedAt": int(m.get("verifiedAt") or 0) or None,
                                "message": m.get("removalMessage") or removal_message(m["status"], m.get("removalReason")), "eventStatus": m.get("eventStatus") or ""})
    save()
    counts = {}
    for x in removed:
        counts[x["status"]] = counts.get(x["status"], 0) + 1
    counts["open"] = len(out)
    return {"rows": out, "removed": removed, "counts": counts,
            "providers": {b: {"ok": p["ok"], "at": int(p["at"]) if p.get("at") else None, "error": p.get("error") or ""} for b, p in provs.items()},
            "schedule": None if sched is None else {"ok": bool(sched.get("ok")), "at": int(sched["at"]) if sched.get("at") else None, "error": sched.get("error") or "", "games": len(sched.get("events") or [])},
            "injuries": None if inj is None else {"ok": bool(inj.get("ok")), "at": int(inj["at"]) if inj.get("at") else None}}


def _close(m, status, reason, now):
    if m.get("status") == status:
        return
    m["status"], m["removalReason"], m["removedAt"] = status, reason, int(now)
    m["removalMessage"] = removal_message(status, reason)
    m["expiresAt"] = int(now) if not m.get("expiresAt") or m["expiresAt"] > now else m["expiresAt"]
    if status in ("started", "expired") and m.get("closingLine") is None:
        m["closingLine"], m["closingPrice"] = m.get("line"), m.get("price")


def _keep(mid, sport, r, o, v, ev, me, op, now, tz):
    m = S["markets"].get(mid)
    pid = o.get("mid") or ""
    first = m is None
    if first:
        m = S["markets"][mid] = {"id": mid, "providerMarketId": pid, "sport": sport, "league": (ev or {}).get("league") or sport, "provider": o.get("book") or "",
                                 "player": r.get("player"), "playerId": r.get("fid") or "", "stat": r.get("k"), "statLabel": r.get("label"),
                                 "side": r.get("side"), "line": o.get("line"), "openLine": o.get("line"), "firstSeen": int(now), "moves": []}
    elif o.get("line") != m.get("line") and m.get("line") is not None:
        m["moves"] = (m.get("moves") or [])[-9:] + [{"from": m["line"], "to": o.get("line"), "at": int(now)}]
        m["lineFrom"], m["lineAt"] = m["line"], int(now)
    m.update(line=o.get("line"), price={"pOver": o.get("pOver"), "overMult": o.get("overMult"), "underMult": o.get("underMult")} if any(o.get(k) is not None for k in ("pOver", "overMult", "underMult")) else None,
             kind=o.get("kind") or "standard", team=(me or {}).get("abbr") or r.get("team") or "", teamId=(me or {}).get("id") or "", oppAbbr=(op or {}).get("abbr") or r.get("opp") or "",
             oppId=(op or {}).get("id") or "", eventId=(ev or {}).get("id") or m.get("eventId") or "", start=(ev or {}).get("start") or v.get("start") or m.get("start"),
             tz=tz, lastSeen=int(now), teamName=(me or {}).get("name") or r.get("teamName") or m.get("teamName") or "", oppName=(op or {}).get("name") or m.get("oppName") or r.get("opp") or "",
             eventStatus=(ev or {}).get("status") or m.get("eventStatus") or "", availability=_availability(r, v), impliedProb=implied(o, r.get("side")))
    if m.get("start"):
        m["eventDay"] = day_key(m["start"])
        m["startLabel"] = _clock(m["start"])   # the league's own time (ET); every page shows the viewer's time from start
    if v["status"] == "open":
        m["verifiedAt"] = int(v.get("verifiedAt") or now)
        m["status"], m["removalReason"], m["removedAt"], m["removalMessage"] = "open", "", None, ""
        # open until whichever comes first: the start, or the moment the provider's read is too old to call verified
        m["expiresAt"] = int(min(x for x in (m.get("start"), m["verifiedAt"] + MAX_AGE) if x))
        m["closingLine"], m["closingPrice"] = m["line"], m.get("price")   # the last line seen open before the start
    else:
        _close(m, v["status"], v["reason"], now)
    if pid:
        s = S["seen"].get(pid)
        # a provider id that comes back with a new number is a new posting for a new game: its binding starts again
        if not s or (s.get("line") is not None and s.get("line") != o.get("line")):
            S["seen"][pid] = {"first": int(now), "event": m["eventId"] if v["status"] == "open" else "", "last": int(now), "line": o.get("line")}
        else:
            s["last"] = int(now)
            if v["status"] == "open" and not s.get("event"):
                s["event"] = m["eventId"]
    return m


def _row_fields(rec, rv, me, op, ev, now, r):
    return {"mid": rec["id"], "marketId": rec["id"], "providerMarketId": rec.get("providerMarketId") or "", "eventId": rec.get("eventId") or "", "teamId": rec.get("teamId") or "",
            "oppId": rec.get("oppId") or "", "playerId": rec.get("playerId") or "", "league": rec.get("league") or "", "status": "open", "statusLabel": LABEL["open"],
            "verifiedAt": int(rv.get("verifiedAt") or rec.get("verifiedAt") or 0), "firstSeen": rec.get("firstSeen"), "closingLine": rec.get("closingLine"), "openLine": rec.get("openLine"),
            "lineFrom": rec.get("lineFrom"), "lineAt": rec.get("lineAt"), "start": iso(rec.get("start")), "eventDay": rec.get("eventDay"), "tz": rec.get("tz"),
            "opp": (op or {}).get("abbr") or r.get("opp") or "", "oppName": (op or {}).get("name") or r.get("opp") or "", "home": (me or {}).get("home"),
            "matchup": "provider" if rv.get("provider_only") else "schedule", "hot": is_hot(r),
            "teamName": rec.get("teamName") or r.get("teamName") or "", "eventStatus": rec.get("eventStatus") or "scheduled", "availability": rec.get("availability") or "",
            "expiresAt": rec.get("expiresAt"), "startLabel": rec.get("startLabel") or "", "impliedProb": rec.get("impliedProb"), "closingPrice": rec.get("closingPrice"),
            "provider": rec.get("provider") or ""}


def check_lines(sport, player, team, fid, lines, fetched=None, errors=None):
    """A player's posted lines (the Lab's player screen, profiles) through the same checks as the board: only open
    ones come back, each with its market id and verified time."""
    rows = {}
    for x in lines:
        r = rows.setdefault(x.get("k"), {"player": player, "team": x.get("team") or team, "fid": fid, "k": x.get("k"), "label": x.get("k"), "line": x.get("line"),
                                         "side": "over", "opp": x.get("opp") or "", "offers": []})
        r["offers"].append({"book": x.get("book"), "line": x.get("line"), "kind": x.get("kind"), "pOver": x.get("pOver"), "mid": x.get("mid") or "",
                            "status": x.get("status") or "", "start": x.get("start") or None, "opp": x.get("opp") or ""})
    for r in rows.values():   # the main line: PrizePicks' standard one, else the most common
        std = next((o for o in r["offers"] if o["book"] == "prizepicks" and o.get("kind") in (None, "standard")), None)
        if std:
            r["line"] = std["line"]
    v = refresh(sport, list(rows.values()), fetched=fetched, errors=errors, sweep=False)
    out = []
    for r in v["rows"]:
        for o in r["offers"]:
            out.append({"k": r["k"], "line": o["line"], "book": o.get("book"), "kind": o.get("kind") or "standard", "pOver": o.get("pOver"), "opp": r.get("opp") or "",
                        "oppName": r.get("oppName") or "", "start": r.get("start") or "", "team": r.get("team") or "", "marketId": o.get("marketId"),
                        "verifiedAt": o.get("verifiedAt"), "eventId": r.get("eventId") or "", "status": "open"})
    return out, v["removed"]


# ---------- reading ----------
def snapshot(sport=None, status=None):
    _load()
    with _lock:
        ms = [dict(m, statusLabel=LABEL.get(m.get("status"), m.get("status"))) for m in S["markets"].values() if (not sport or m.get("sport") == sport) and (not status or m.get("status") == status)]
    return sorted(ms, key=lambda m: (m.get("start") or 0, m.get("player") or ""))


def get(mid):
    _load()
    m = S["markets"].get(mid)
    return dict(m, statusLabel=LABEL.get(m.get("status"), m.get("status"))) if m else None


def monitor(now=None):
    """What the owner's data-monitoring panel shows: provider failures, stale markets, markets with no event id,
    player/team mismatches, duplicate markets, start times that don't match the schedule (time zone mapping)."""
    _load()
    now = now if now is not None else D["now"]()
    with _lock:
        ms = list(S["markets"].values())
        provs = {k: dict(v) for k, v in S["providers"].items()}
        scheds = {k: {"ok": v.get("ok"), "at": v.get("at"), "error": v.get("error") or ""} for k, v in S["schedules"].items()}
    open_ = [m for m in ms if m.get("status") == "open" and (m.get("start") or 0) > now]
    stale = [m for m in open_ if now - (m.get("verifiedAt") or 0) > FRESH]
    no_event = [m for m in ms if m.get("status") == "missing_matchup" and now - (m.get("removedAt") or 0) < 86400]
    tzbad = [m for m in no_event if "start time" in (m.get("removalReason") or "") or "date" in (m.get("removalReason") or "")]
    mismatch = [m for m in ms if m.get("status") == "awaiting_verification" and "team" in (m.get("removalReason") or "") and now - (m.get("removedAt") or 0) < 86400]
    seen, dup = {}, []
    for m in open_:
        k = (m.get("sport"), m.get("provider"), _pname(m.get("player")), m.get("stat"), m.get("line"), m.get("side"))
        if k in seen:
            dup.append(m)
        seen[k] = m
    failed = [{"key": k, "error": v.get("error") or "", "at": v.get("at")} for k, v in provs.items() if not v.get("ok")]
    sched_bad = [{"key": k, "error": v["error"], "at": v["at"]} for k, v in scheds.items() if not v.get("ok")]
    pick = lambda xs: [{"mid": m.get("id"), "sport": m.get("sport"), "player": m.get("player"), "stat": m.get("statLabel") or m.get("stat"), "line": m.get("line"),
                        "provider": m.get("provider"), "reason": m.get("removalReason") or "", "verifiedAt": m.get("verifiedAt"), "start": m.get("start")} for m in xs[:25]]
    return {"at": int(now), "open": len(open_),
            "checks": [
                {"key": "providers", "label": "Provider failures", "n": len(failed), "items": failed},
                {"key": "schedules", "label": "Schedule failures", "n": len(sched_bad), "items": sched_bad},
                {"key": "stale", "label": "Stale markets (not re-verified in 30 minutes)", "n": len(stale), "items": pick(stale)},
                {"key": "no_event", "label": "Markets missing an event", "n": len(no_event), "items": pick(no_event)},
                {"key": "mismatch", "label": "Player/team mismatches", "n": len(mismatch), "items": pick(mismatch)},
                {"key": "timezone", "label": "Start times that don't match the schedule", "n": len(tzbad), "items": pick(tzbad)},
                {"key": "duplicates", "label": "Duplicate markets", "n": len(dup), "items": pick(dup)},
            ]}


PROVIDER_NAME = {"prizepicks": "PrizePicks", "sleeper": "Sleeper", "underdog": "Underdog", "kalshi": "Kalshi"}


def summary(now=None):
    """The public view for the Trust and Data Center page: per sport, how many markets are open and verified, how
    many were taken off in the last day and why, each provider's last good read, and the schedule read. No market
    is re-read for it."""
    _load()
    now = now if now is not None else D["now"]()
    with _lock:
        ms = list(S["markets"].values())
        provs = {k: dict(v) for k, v in S["providers"].items()}
        scheds = {k: {"ok": v.get("ok"), "at": v.get("at")} for k, v in S["schedules"].items()}
    out = {}
    for m in ms:
        sp = m.get("sport") or ""
        x = out.setdefault(sp, {"sport": sp, "open": 0, "removed": {}, "lastVerified": None, "providers": [], "schedule": None})
        if m.get("status") == "open" and (m.get("start") or 0) > now:
            x["open"] += 1
            x["lastVerified"] = max(x["lastVerified"] or 0, m.get("verifiedAt") or 0) or None
        elif m.get("status") != "open" and now - (m.get("removedAt") or 0) < 86400:
            lab = LABEL.get(m.get("status"), m.get("status"))
            x["removed"][lab] = x["removed"].get(lab, 0) + 1
    for k, v in provs.items():
        sp, _, b = k.partition(":")
        x = out.setdefault(sp, {"sport": sp, "open": 0, "removed": {}, "lastVerified": None, "providers": [], "schedule": None})
        x["providers"].append({"key": b, "name": PROVIDER_NAME.get(b, b.title()), "ok": bool(v.get("ok")), "at": v.get("at"), "checked": v.get("checked")})
    for sp, v in scheds.items():
        if sp in out:
            out[sp]["schedule"] = v
    for x in out.values():
        x["providers"].sort(key=lambda p: p["name"])
    return {"at": int(now), "maxAge": MAX_AGE, "fresh": FRESH, "sports": sorted(out.values(), key=lambda x: x["sport"])}


# ---------- the live feeds (wired by server.py) ----------
def espn_schedule(get_json, espn_base, paths):
    """A schedule reader for setup(): ESPN scoreboards from three days back to eight days ahead, in one request."""
    def read(sport):
        now = D["now"]()
        a, b = day_key(now - 3 * 86400).replace("-", ""), day_key(now + 8 * 86400).replace("-", "")
        d = get_json(f"{espn_base}/{paths[sport]}/scoreboard?dates={a}-{b}&limit=500", 300)
        return events_from(d, sport)
    return read


def espn_injuries(get_json, espn_base, paths, level):
    def read(sport):
        if sport not in paths:
            return {}
        d = get_json(f"{espn_base}/{paths[sport]}/injuries", 600)
        out = {}
        for t in d.get("injuries") or []:
            for x in t.get("injuries") or []:
                a = x.get("athlete") or {}
                name = a.get("displayName") or a.get("fullName")
                if name:
                    s = x.get("status") or (x.get("type") or {}).get("description") or ""
                    out[_pname(name)] = {"status": s, "lv": level(s)}
        return out
    return read


def injury_level(s):
    """The same scale as injuries.js level(): out, doubtful, questionable, dtd, probable, active."""
    t = str(s or "").lower()
    if re.search(r"out|injured reserve|\bir\b|injured list|\bil\b|suspen|inactive|pup|non-football", t):
        return "out"
    if re.match(r"^\s*(active|available)\b", t):
        return "active"
    if "doubt" in t:
        return "doubtful"
    if re.search(r"question|game.?time", t):
        return "questionable"
    if re.search(r"day.?to.?day|\bdtd\b", t):
        return "dtd"
    if "probable" in t:
        return "probable"
    return "dtd"
