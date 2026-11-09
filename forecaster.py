"""Floodlight forecaster: writes match predictions on a schedule, even while the app is closed.

Each tracked match gets three forecasts:
  morning   7:00 on match day for soccer, 9:00 for American football (local time on this Mac)
  hour      1 hour before kick-off (soccer lineups usually confirmed; NFL inactives about to drop)
  final     30 minutes before kick-off

Each forecast gathers the latest data: the betting market (DraftKings lines via ESPN), ESPN's matchup
predictor for football, standings split by home and away, recent form, head-to-head history,
injuries, quarterback status, predicted or confirmed lineups and coaches. It runs a statistical model,
and if the owner saved an Anthropic API key, it asks Claude to research the latest news on the web and
give its own forecast. The two are blended.

Which matches are tracked:
  - matches of teams followed in any account, and saved picks
  - matches in leagues starred in any account, plus every NFL game and ranked FBS games (model only)
  - any match opened in the app (sent by the page)
"""
import datetime
import json
import os
import math
import re
import threading
import time
import urllib.parse
from pathlib import Path

import storage

ESPN = "https://site.api.espn.com/apis/site/v2/sports"
ESPN2 = "https://site.api.espn.com/apis/v2/sports"
FM = "https://www.fotmob.com"
MODEL = "claude-opus-5-5"

MORNING_HOUR = {"soccer": 7, "football": 9}
STAGE_LABEL = {"week": "A week before", "days3": "3 days before", "morning": "Morning", "hour": "1 hour before", "final": "30 min before", "now": "On request"}
# football leagues: ESPN path, standings group, home-field points, spread of results, league points per team
FB = {
    "nfl": {"path": "nfl", "group": None, "hfa": 1.8, "sd": 13.5, "ppg": 22.5, "qb": 6.0},
    "fbs": {"path": "college-football", "group": 80, "hfa": 2.8, "sd": 16.0, "ppg": 28.0, "qb": 6.5},
    "fcs": {"path": "college-football", "group": 81, "hfa": 2.8, "sd": 16.0, "ppg": 27.0, "qb": 6.5},
    "d2": {"path": "college-football", "group": 57, "hfa": 2.8, "sd": 17.0, "ppg": 28.0, "qb": 6.5},
    "d3": {"path": "college-football", "group": 58, "hfa": 2.8, "sd": 17.0, "ppg": 28.0, "qb": 6.5},
    "ufl": {"path": "ufl", "group": None, "hfa": 2.0, "sd": 14.0, "ppg": 20.0, "qb": 5.5},
}
FB_NAMES = {"nfl": "NFL", "fbs": "College football (FBS)", "fcs": "College football (FCS)", "d2": "NCAA Division II", "d3": "NCAA Division III", "ufl": "UFL"}
# points a missing starter costs, by position (quarterbacks use the league value above)
POS_PTS = {"RB": .4, "WR": .6, "TE": .4, "OT": .6, "T": .6, "G": .4, "OG": .4, "C": .5, "OL": .5, "DE": .6, "DT": .5, "DL": .5,
           "EDGE": .6, "LB": .4, "OLB": .5, "ILB": .4, "MLB": .4, "CB": .6, "S": .4, "FS": .4, "SS": .4, "K": .5, "PK": .5, "P": .2}

D = {}           # helpers from server.py: fetch, similar, tm_squad, fm_league, users, cache_dir
_lock = threading.RLock()
_jobs = []
_state = {"running": None, "last_discover": 0.0}


# ---------- storage ----------

def _path(name):
    return Path(D["cache_dir"]) / name


def _load(name, default):
    return storage.load(_path(name), default)


def _save(name, data):
    storage.save(_path(name), data)


TRACKED, FORECASTS, CONFIG = {}, {}, {}


def setup(**deps):
    D.update(deps)
    TRACKED.update(_load("tracked.json", {}))
    FORECASTS.update(_load("forecasts.json", {}))
    CONFIG.update(_load("config.json", {}))
    if os.environ.get("ANTHROPIC_API_KEY") and not CONFIG.get("key"):
        CONFIG["key"] = os.environ["ANTHROPIC_API_KEY"].strip()
    threading.Thread(target=_scheduler, daemon=True, name="forecast-scheduler").start()
    threading.Thread(target=_worker, daemon=True, name="forecast-worker").start()


def _persist():
    with _lock:
        _save("tracked.json", TRACKED)
        _save("forecasts.json", FORECASTS)


def _save_config():
    with _lock:
        _save("config.json", CONFIG)


# ---------- times ----------

def parse_time(s):
    if isinstance(s, (int, float)):
        return float(s) / (1000 if s > 1e11 else 1)
    s = str(s or "").strip().replace("Z", "+00:00")
    if re.fullmatch(r".*T\d\d:\d\d\+00:00", s):
        s = s.replace("+00:00", ":00+00:00")
    return datetime.datetime.fromisoformat(s).timestamp()


def plan(m):
    """The forecast times for a match: [(stage, unix time)]."""
    ko = m["ko"]
    local = datetime.datetime.fromtimestamp(ko)
    morning = local.replace(hour=MORNING_HOUR[m["sport"]], minute=0, second=0, microsecond=0).timestamp()
    out = [("week", ko - 7 * 86400), ("days3", ko - 3 * 86400)]
    if morning < ko - 3600 - 600:          # an early kick-off just gets the two late updates
        out.append(("morning", morning))
    out += [("hour", ko - 3600), ("final", ko - 1800)]
    return out


# ---------- tracking ----------

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,24}")
LG_RE = re.compile(r"[A-Za-z0-9_.]{1,20}")


def track(items, research=False, source="app"):
    added = 0
    now = time.time()
    with _lock:
        for it in (items or [])[:80]:
            try:
                sport = it.get("sport")
                mid, lg = str(it.get("id") or ""), str(it.get("lg") or "")
                if sport not in ("soccer", "football") or not ID_RE.fullmatch(mid) or not LG_RE.fullmatch(lg):
                    continue
                if sport == "football" and lg not in FB:
                    continue
                ko = parse_time(it.get("date"))
                if not (now - 6 * 3600 < ko < now + 10 * 86400):
                    continue
                key = f"{sport}:{mid}"
                m = TRACKED.get(key) or {"sport": sport, "id": mid, "added": now, "sources": []}
                m.update({"lg": lg, "ko": ko, "src": it.get("src") if it.get("src") in ("espn", "fm") else m.get("src", "espn"),
                          "home": str(it.get("home") or m.get("home") or "")[:60], "away": str(it.get("away") or m.get("away") or "")[:60]})
                if it.get("fmId") and re.fullmatch(r"\d{1,12}", str(it["fmId"])):
                    m["fmId"] = str(it["fmId"])
                if research:
                    m["research"] = True
                if source not in m["sources"]:
                    m["sources"].append(source)
                if key not in TRACKED:
                    added += 1
                TRACKED[key] = m
            except Exception:
                continue
        # forget matches that finished more than two days ago, forecasts after two weeks
        for k in [k for k, m in TRACKED.items() if m["ko"] < now - 2 * 86400]:
            TRACKED.pop(k, None)
        for k in [k for k, f in FORECASTS.items() if f.get("ko", now) < now - 14 * 86400]:
            FORECASTS.pop(k, None)
        if len(TRACKED) > 600:
            for k in sorted(TRACKED, key=lambda k: TRACKED[k]["ko"])[:len(TRACKED) - 600]:
                TRACKED.pop(k, None)
    if added:
        _persist()
    return added


LOOKAHEAD_H = 8 * 24 + 12       # far enough ahead for the week-before forecast


def _events_within(events, hours=LOOKAHEAD_H):
    now = time.time()
    for ev in events or []:
        try:
            ko = parse_time(ev.get("date"))
        except Exception:
            continue
        comp = (ev.get("competitions") or [{}])[0]
        state = ((comp.get("status") or ev.get("status") or {}).get("type") or {}).get("state")
        if now - 3600 < ko < now + hours * 3600 and state in (None, "pre"):
            yield ev, comp, ko


def _names(comp):
    side = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    nm = lambda c: ((c or {}).get("team") or {}).get("displayName") or ""
    return nm(side.get("home")), nm(side.get("away"))


def discover():
    """Find the next eight days of matches for followed teams, picks, starred leagues, the NFL and ranked FBS teams."""
    fetch = D["fetch"]
    _state["last_discover"] = time.time()
    found = []                                  # (items, research, source)
    soccer_teams, fb_teams, leagues = set(), set(), set()
    for u in (D["users"]() or {}).values():
        p = u.get("prefs") or {}
        for f in p.get("favTeams") or []:
            if f.get("sport") == "football" and f.get("lg") in FB and f.get("tid"):
                fb_teams.add((f["lg"], str(f["tid"])))
            elif f.get("lg") and f.get("id") and not str(f["id"]).startswith("fm"):
                soccer_teams.add((str(f["lg"]), str(f["id"])))
        for pk in p.get("picks") or []:
            if pk.get("id") and pk.get("slug") and pk.get("date"):
                found.append(([{"sport": "soccer", "id": pk["id"], "lg": pk["slug"], "date": pk["date"], "src": pk.get("src"),
                                "fmId": pk.get("fmId"), "home": pk.get("home"), "away": pk.get("away")}], True, "pick"))
        for l in p.get("favLeagues") or []:
            slug = l if isinstance(l, str) else (l.get("slug") or l.get("id") if isinstance(l, dict) else None)
            if isinstance(slug, str) and re.fullmatch(r"[a-z]{2,4}\.[a-z0-9_]{1,12}", slug):
                leagues.add(slug)
    for lg, tid in list(soccer_teams)[:40]:
        try:
            d = fetch(f"{ESPN}/soccer/{lg}/teams/{tid}/schedule?fixture=true", 1800, as_json=True)
            for ev, comp, ko in _events_within(d.get("events")):
                h, a = _names(comp)
                slug = ((ev.get("league") or {}).get("slug")) or lg
                found.append(([{"sport": "soccer", "id": ev["id"], "lg": slug, "date": ev["date"], "home": h, "away": a}], True, "team"))
        except Exception:
            pass
    for lg, tid in list(fb_teams)[:40]:
        try:
            d = fetch(f"{ESPN}/football/{FB[lg]['path']}/teams/{tid}/schedule", 1800, as_json=True)
            for ev, comp, ko in _events_within(d.get("events")):
                h, a = _names(comp)
                found.append(([{"sport": "football", "id": ev["id"], "lg": lg, "date": ev["date"], "home": h, "away": a}], True, "team"))
        except Exception:
            pass
    today = datetime.date.today()
    for slug in list(leagues)[:12]:
        for day in (today + datetime.timedelta(days=i) for i in range(9)):
            try:
                d = fetch(f"{ESPN}/soccer/{slug}/scoreboard?dates={day:%Y%m%d}", 1800, as_json=True)
                for ev, comp, ko in _events_within(d.get("events")):
                    h, a = _names(comp)
                    found.append(([{"sport": "soccer", "id": ev["id"], "lg": slug, "date": ev["date"], "home": h, "away": a}], False, "league"))
            except Exception:
                pass
    for lg, ranked_only in (("nfl", False), ("fbs", True)):
        try:
            q = f"?groups={FB[lg]['group']}&limit=300" if FB[lg]["group"] else ""
            d = fetch(f"{ESPN}/football/{FB[lg]['path']}/scoreboard{q}", 1800, as_json=True)
            evs = list(d.get("events") or [])
            wk = (d.get("week") or {}).get("number")
            st = ((d.get("season") or {}).get("type"))
            if wk:                                   # next week's games too, for the week-before forecast
                sep = "&" if q else "?"
                try:
                    evs += fetch(f"{ESPN}/football/{FB[lg]['path']}/scoreboard{q}{sep}week={wk + 1}" + (f"&seasontype={st}" if st else ""), 3600, as_json=True).get("events") or []
                except Exception:
                    pass
            for ev, comp, ko in _events_within(evs):
                ranks = [((c.get("curatedRank") or {}).get("current") or 99) for c in comp.get("competitors") or []]
                if ranked_only and min(ranks or [99]) > 25:
                    continue
                h, a = _names(comp)
                found.append(([{"sport": "football", "id": ev["id"], "lg": lg, "date": ev["date"], "home": h, "away": a}], False, "auto"))
        except Exception:
            pass
    for items, research, source in found:
        track(items, research=research, source=source)


# ---------- scheduling ----------

def _scheduler():
    time.sleep(15)
    while True:
        try:
            if time.time() - _state["last_discover"] > 3 * 3600:
                discover()
            now = time.time()
            with _lock:
                for key, m in TRACKED.items():
                    if m.get("over") or now > m["ko"]:
                        continue
                    snaps = FORECASTS.get(key, {}).get("snaps", [])
                    done = {s["stage"] for s in snaps} | set(FORECASTS.get(key, {}).get("skipped", []))
                    due = [st for st, t in plan(m) if t <= now and st not in done]
                    if not due:
                        continue
                    # if the server was off, earlier stages are skipped and only the latest due one runs
                    stage = due[-1]
                    if len(due) > 1:
                        FORECASTS.setdefault(key, {"ko": m["ko"], "snaps": []}).setdefault("skipped", []).extend(due[:-1])
                    if (key, stage) not in _jobs and _state["running"] != (key, stage):
                        _jobs.append((key, stage))
        except Exception as e:
            print("forecast scheduler:", e)
        time.sleep(30)


def _worker():
    while True:
        job = None
        with _lock:
            if _jobs:
                # the match kicking off soonest goes first
                _jobs.sort(key=lambda j: TRACKED.get(j[0], {}).get("ko", 0))
                job = _jobs.pop(0)
                _state["running"] = job
        if not job:
            time.sleep(2)
            continue
        try:
            run(*job)
        except Exception as e:
            print("forecast failed", job, e)
            with _lock:
                f = FORECASTS.setdefault(job[0], {"ko": TRACKED.get(job[0], {}).get("ko", time.time()), "snaps": []})
                f["error"] = str(e)[:200]
        finally:
            _state["running"] = None
            _persist()


def request_now(key):
    with _lock:
        if key not in TRACKED:
            return False
        if (key, "now") not in _jobs:
            _jobs.insert(0, (key, "now"))
    return True


# ---------- small maths ----------

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def phi_inv(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    lo, hi = -6.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if phi(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def american_to_p(ml):
    try:
        ml = float(ml)
    except (TypeError, ValueError):
        return None
    if ml == 0:
        return None
    return 100 / (ml + 100) if ml > 0 else -ml / (-ml + 100)


def devig(*ps):
    if any(p is None for p in ps):
        return None
    s = sum(ps)
    return [p / s for p in ps] if s else None


def pois(k, lam):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def num(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


# ---------- data gathering ----------

def _standings_espn(sport_path, group=None, ttl=900):
    url = f"{ESPN2}/{sport_path}/standings" + (f"?group={group}" if group else "")
    d = D["fetch"](url, ttl, as_json=True) or {}
    rows = {}
    for g in (d.get("children") or [d]):
        for x in ((g.get("standings") or {}).get("entries") or []):
            st = {}
            for s in x.get("stats") or []:
                for k in (s.get("name"), s.get("type"), s.get("abbreviation")):
                    if k:
                        st[k] = s
            v = lambda n: num((st.get(n) or {}).get("value"))
            dv = lambda *ns: next(((st.get(n) or {}).get("displayValue") for n in ns if st.get(n)), "")
            rows[str((x.get("team") or {}).get("id"))] = {
                "name": (x.get("team") or {}).get("displayName"), "gp": v("gamesPlayed") or (v("wins") + v("losses") + v("ties")),
                "w": v("wins"), "d": v("ties"), "l": v("losses"), "gf": v("pointsFor"), "ga": v("pointsAgainst"),
                "pts": v("points"), "rank": v("rank") or None, "group": g.get("name"),
                "home": dv("Home", "home"), "road": dv("Road", "road", "Away", "away"), "streak": dv("streak"),
            }
    return rows


def _last_five(summ):
    out = {}
    for t in summ.get("lastFiveGames") or []:
        tid = str((t.get("team") or {}).get("id"))
        games = []
        for e in t.get("events") or []:
            mine_home = str(e.get("homeTeamId")) == tid
            gf, ga = num(e.get("homeTeamScore" if mine_home else "awayTeamScore")), num(e.get("awayTeamScore" if mine_home else "homeTeamScore"))
            games.append({"date": (e.get("gameDate") or "")[:10], "where": "home" if mine_home else "away",
                          "opp": (e.get("opponent") or {}).get("displayName"), "gf": gf, "ga": ga, "res": e.get("gameResult"),
                          "comp": e.get("competitionName") or ""})
        games.sort(key=lambda g: g["date"], reverse=True)
        out[tid] = games
    return out


def _form_score(games):
    """Recent results weighted toward the latest: 0 (all lost) .. 1 (all won), plus average goal difference."""
    if not games:
        return None, 0.0
    w = [.30, .24, .19, .15, .12]
    tot = pts = gd = 0.0
    for g, wt in zip(games[:5], w):
        res = g.get("res") or ("W" if g["gf"] > g["ga"] else "L" if g["gf"] < g["ga"] else "D")
        pts += wt * {"W": 1, "D": .4, "T": .5}.get(res, 0)
        gd += wt * (g["gf"] - g["ga"])
        tot += wt
    return pts / tot, gd / tot


def _venue_split(fetch, sport, lg, tid, ttl=3600):
    """Goals for and against at home and away this season, from the team's schedule."""
    try:
        d = fetch(f"{ESPN}/{sport}/{lg}/teams/{tid}/schedule", ttl, as_json=True)
    except Exception:
        return None
    sp = {"home": [0, 0, 0], "away": [0, 0, 0]}
    for ev in d.get("events") or []:
        comp = (ev.get("competitions") or [{}])[0]
        if not ((comp.get("status") or {}).get("type") or {}).get("completed"):
            continue
        me = next((c for c in comp.get("competitors") or [] if str((c.get("team") or {}).get("id")) == str(tid)), None)
        op = next((c for c in comp.get("competitors") or [] if c is not me), None)
        if not me or not op:
            continue
        sc = lambda c: num(c.get("score", {}).get("value") if isinstance(c.get("score"), dict) else c.get("score"))
        s = sp[me.get("homeAway") or "home"]
        s[0] += 1
        s[1] += sc(me)
        s[2] += sc(op)
    return sp


def _fotmob(date_iso, home, away, fm_id=None):
    """FotMob match page: lineups (predicted or confirmed), coaches, unavailable players and head-to-head."""
    fetch, similar = D["fetch"], D["similar"]
    mid = fm_id
    if not mid:
        best, score = None, 0
        day0 = datetime.datetime.fromtimestamp(parse_time(date_iso))
        for dd in (0, -1, 1):
            day = (day0 + datetime.timedelta(days=dd)).strftime("%Y%m%d")
            try:
                data = fetch(f"{FM}/api/data/matches?date={day}", 900, as_json=True) or {}
            except Exception:
                continue
            for lg in data.get("leagues", []):
                for m in lg.get("matches", []):
                    h, a = m.get("home", {}), m.get("away", {})
                    s = max(similar(home, h.get("longName") or h.get("name")), similar(home, h.get("name"))) + \
                        max(similar(away, a.get("longName") or a.get("name")), similar(away, a.get("name")))
                    if s > score:
                        best, score = m, s
            if score >= 1.6:
                break
        if not best or score < 1.1:
            return None
        mid = best["id"]
    page = fetch(f"{FM}/match/{mid}", 300)
    mm = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
    if not mm:
        return None
    c = (json.loads(mm.group(1)).get("props", {}).get("pageProps", {}).get("content") or {})
    lu = c.get("lineup") or {}

    def team(t):
        if not t:
            return None
        return {"name": t.get("name"), "formation": t.get("formation"), "coach": (t.get("coach") or {}).get("name"),
                "starters": [{"name": p.get("name"), "value": p.get("marketValue")} for p in t.get("starters") or []],
                "unavailable": [{"name": p.get("name"), "type": (p.get("unavailability") or {}).get("type"),
                                 "back": (p.get("unavailability") or {}).get("expectedReturn")} for p in t.get("unavailable") or []]}
    h2h = c.get("h2h") or {}
    games = []
    for g in (h2h.get("matches") or [])[:8]:
        st = g.get("status") or {}
        if not st.get("finished"):
            continue
        games.append({"date": ((g.get("time") or {}).get("utcTime") or "")[:10], "home": (g.get("home") or {}).get("name"),
                      "away": (g.get("away") or {}).get("name"), "score": st.get("scoreStr"), "comp": (g.get("league") or {}).get("name")})
    return {"id": str(mid), "type": lu.get("lineupType"), "home": team(lu.get("homeTeam")), "away": team(lu.get("awayTeam")),
            "h2h": {"summary": h2h.get("summary"), "games": games}, "url": f"{FM}/match/{mid}"}


def _squad_values(team):
    """Squad with market values and injuries: FotMob first, Transfermarkt as a fallback."""
    try:
        t = D["fm_team"](team)
        sq = [{"tmId": str(p.get("fmId")), "name": p.get("name") or "", "value": p.get("value") or 0,
               "status": ({"text": p["injury"] if isinstance(p["injury"], str) else (p["injury"].get("type") or "Injured") if isinstance(p["injury"], dict) else "Injured"}
                          if p.get("injury") else None)} for p in (t.get("squad") or []) if p.get("group") != "coach"]
        if sum(p["value"] for p in sq):
            return sq
    except Exception:
        pass
    try:
        sq = D["tm_squad"](team)
        return sq.get("players") or [] if not sq.get("error") else []
    except Exception:
        return []


def _xi_strength(starters, squad, similar):
    """Share of the strongest eleven's market value that is starting (1.0 = full strength)."""
    vals = sorted((p.get("value") or 0 for p in squad), reverse=True)
    full = sum(vals[:11])
    if not full or not starters:
        return None, []
    median = vals[len(vals) // 2] if vals else 0
    used, xi = set(), 0
    for s in starters:
        best = max(squad, key=lambda p: similar(p["name"], s["name"]), default=None)
        if best and similar(best["name"], s["name"]) >= .6:
            used.add(best["tmId"])
            xi += best.get("value") or median
        else:
            xi += s.get("value") or median
    cut = vals[10] if len(vals) > 10 else 0
    missing = [{"name": p["name"], "why": (p.get("status") or {}).get("text") or "not in the starting XI"}
               for p in sorted(squad, key=lambda p: -(p.get("value") or 0)) if p["tmId"] not in used and (p.get("value") or 0) >= cut][:4]
    return min(1.08, xi / full), missing


def _absent_share(squad, unavailable, similar):
    """Without a lineup: share of the best eleven's value that is injured or suspended."""
    vals = sorted((p.get("value") or 0 for p in squad), reverse=True)
    full = sum(vals[:11])
    if not full:
        return None, []
    out = [p for p in squad if p.get("status")]
    for u in unavailable or []:
        best = max(squad, key=lambda p: similar(p["name"], u["name"] or ""), default=None)
        if best and similar(best["name"], u["name"] or "") >= .6 and best not in out:
            out.append(best)
    top = set(id(p) for p in sorted(squad, key=lambda p: -(p.get("value") or 0))[:14])
    lost = sum(p.get("value") or 0 for p in out if id(p) in top)
    return min(.45, lost / full), [{"name": p["name"], "why": (p.get("status") or {}).get("text") or "unavailable"} for p in out if id(p) in top][:5]


def _pick_market(summ):
    pc = (summ.get("pickcenter") or summ.get("odds") or [None])[0] or {}
    return pc


# ---------- soccer ----------

def gather_soccer(m):
    fetch, similar = D["fetch"], D["similar"]
    d = {"sport": "soccer", "lg": m["lg"], "id": m["id"]}
    if m.get("src") == "fm":
        fm = _fotmob(None, m["home"], m["away"], m.get("fmId")) if m.get("fmId") else None
        d.update({"home": {"name": m["home"], "id": None}, "away": {"name": m["away"], "id": None}, "state": "pre", "fm": fm})
        try:
            table = D["fm_league"](127 if m["lg"] == "isr.1" else 0).get("table") or []
            rows = {}
            for r in table:
                gf, ga = (str(r.get("goals") or "0-0").split("-") + ["0"])[:2]
                rows[r["name"]] = {"gp": r.get("played") or 0, "w": r.get("wins"), "d": r.get("draws"), "l": r.get("losses"),
                                   "gf": num(gf), "ga": num(ga), "pts": r.get("pts"), "rank": r.get("rank")}
            d["table"] = rows
            pickrow = lambda n: max(rows.items(), key=lambda kv: similar(kv[0], n), default=(None, None))[1]
            d["home"]["row"], d["away"]["row"] = pickrow(m["home"]), pickrow(m["away"])
        except Exception:
            d["table"] = {}
        return d
    summ = fetch(f"{ESPN}/soccer/{m['lg']}/summary?event={m['id']}", 120, as_json=True)
    comp = ((summ.get("header") or {}).get("competitions") or [{}])[0]
    st = ((comp.get("status") or {}).get("type") or {})
    d["state"] = st.get("state") or "pre"
    d["status"] = st.get("detail") or ""
    sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    for k in ("home", "away"):
        t = (sides.get(k) or {}).get("team") or {}
        d[k] = {"name": t.get("displayName") or m.get(k), "id": str(t.get("id") or "")}
    d["kickoff"] = comp.get("date")
    d["venue"] = (((summ.get("gameInfo") or {}).get("venue") or {}).get("fullName"))
    d["league"] = ((summ.get("header") or {}).get("league") or {}).get("name") or m["lg"]
    pc = _pick_market(summ)
    probs = devig(american_to_p((pc.get("homeTeamOdds") or {}).get("moneyLine")), american_to_p((pc.get("drawOdds") or {}).get("moneyLine")),
                  american_to_p((pc.get("awayTeamOdds") or {}).get("moneyLine")))
    d["market"] = {"home": probs[0], "draw": probs[1], "away": probs[2], "ou": pc.get("overUnder"), "overOdds": pc.get("overOdds"),
                   "underOdds": pc.get("underOdds"), "book": (pc.get("provider") or {}).get("name") or "Sportsbook"} if probs else None
    d["form"] = _last_five(summ)
    ser = (summ.get("seasonseries") or [{}])[0] if summ.get("seasonseries") else {}
    d["series"] = ser.get("summary")
    try:
        d["table"] = _standings_espn(f"soccer/{m['lg']}")
    except Exception:
        d["table"] = {}
    for k in ("home", "away"):
        d[k]["row"] = d["table"].get(d[k]["id"])
        d[k]["venue"] = _venue_split(fetch, "soccer", m["lg"], d[k]["id"])
    try:
        d["fm"] = _fotmob(comp.get("date") or m["ko"], d["home"]["name"], d["away"]["name"])
    except Exception:
        d["fm"] = None
    return d


def model_soccer(d):
    similar = D["similar"]
    rows = [r for r in (d.get("table") or {}).values() if r.get("gp")]
    gp_sum = sum(r["gp"] for r in rows)
    mu = sum(r["gf"] for r in rows) / gp_sum if gp_sum else 1.35
    K = 5
    H, A = d["home"].get("row") or {}, d["away"].get("row") or {}
    rate = lambda r, k, base: ((r.get(k) or 0) + base * K) / ((r.get("gp") or 0) + K) / base
    att_h, def_h, att_a, def_a = rate(H, "gf", mu), rate(H, "ga", mu), rate(A, "gf", mu), rate(A, "ga", mu)
    home_mu, away_mu = mu * 1.12, mu * 0.88       # leagues average roughly a quarter of a goal of home advantage
    vh, va = d["home"].get("venue"), d["away"].get("venue")
    split_used = False
    if vh and va and vh["home"][0] >= 2 and va["away"][0] >= 2:
        n, gf, ga = vh["home"]
        att_h = .6 * att_h + .4 * (gf + home_mu * K) / (n + K) / home_mu
        def_h = .6 * def_h + .4 * (ga + away_mu * K) / (n + K) / away_mu
        n, gf, ga = va["away"]
        att_a = .6 * att_a + .4 * (gf + away_mu * K) / (n + K) / away_mu
        def_a = .6 * def_a + .4 * (ga + home_mu * K) / (n + K) / home_mu
        split_used = True
    lh, la = home_mu * att_h * def_a, away_mu * att_a * def_h
    notes = []
    fh, gdh = _form_score((d.get("form") or {}).get(d["home"]["id"]))
    fa, gda = _form_score((d.get("form") or {}).get(d["away"]["id"]))
    if fh is not None:
        lh *= 1 + .12 * (fh - .5)
        la *= 1 - .05 * (fh - .5)
    if fa is not None:
        la *= 1 + .12 * (fa - .5)
        lh *= 1 - .05 * (fa - .5)
    fm = d.get("fm") or {}
    lineup = {"type": fm.get("type"), "home": None, "away": None}
    for k in ("home", "away"):
        squad = _squad_values(d[k]["name"])
        t = fm.get(k) or {}
        r, miss = (None, [])
        if squad and t.get("starters") and fm.get("type") in ("standard", "confirmed", "predicted"):
            r, miss = _xi_strength(t["starters"], squad, similar)
        if r is None and squad:
            share, miss = _absent_share(squad, t.get("unavailable"), similar)
            r = None if share is None else 1 - share
        lineup[k] = {"strength": r, "missing": miss, "coach": t.get("coach"), "formation": t.get("formation"),
                     "unavailable": [u["name"] for u in t.get("unavailable") or []][:8],
                     "starters": [s["name"] for s in t.get("starters") or []] if fm.get("type") in ("standard", "confirmed", "predicted") else []}
    rh, ra = (lineup["home"] or {}).get("strength"), (lineup["away"] or {}).get("strength")
    if rh is not None:
        lh *= max(.78, min(1.03, 1 - .35 * (1 - rh)))
        la *= 1 + .15 * max(0, 1 - rh)
    if ra is not None:
        la *= max(.78, min(1.03, 1 - .35 * (1 - ra)))
        lh *= 1 + .15 * max(0, 1 - ra)
    # head-to-head carries a little weight: styles that suit one side tend to repeat
    hh = (fm.get("h2h") or {})
    s = hh.get("summary")
    if isinstance(s, list) and len(s) == 3 and sum(s) >= 3:
        hw, dr, aw = s     # FotMob lists it from the home side's point of view
        tilt = (hw - aw) / sum(s)
        lh *= 1 + .04 * tilt
        la *= 1 - .04 * tilt
    lh, la = max(.2, min(lh, 4.2)), max(.15, min(la, 4.0))
    # Poisson goals with the Dixon-Coles correction, which fixes the plain model's shortage of 0-0 and 1-1 draws
    rho = -0.08
    ph = pd = pa = o25 = btts = 0.0
    scores = []
    for i in range(9):
        for j in range(9):
            p = pois(i, lh) * pois(j, la)
            if i == 0 and j == 0:
                p *= 1 - lh * la * rho
            elif i == 0 and j == 1:
                p *= 1 + lh * rho
            elif i == 1 and j == 0:
                p *= 1 + la * rho
            elif i == 1 and j == 1:
                p *= 1 - rho
            if i > j:
                ph += p
            elif i == j:
                pd += p
            else:
                pa += p
            if i + j > 2:
                o25 += p
            if i and j:
                btts += p
            scores.append((i, j, p))
    t = ph + pd + pa
    model = {"home": ph / t, "draw": pd / t, "away": pa / t}
    scores.sort(key=lambda x: -x[2])
    mk = d.get("market")
    blend = {k: .6 * mk[k] + .4 * model[k] for k in model} if mk else dict(model)
    return {"model": model, "blend": blend, "xg": [round(lh, 2), round(la, 2)], "o25": o25 / t, "btts": btts / t,
            "likely": [[i, j, round(p / t, 3)] for i, j, p in scores[:4]], "scores": scores, "mu": mu, "form": [fh, fa],
            "lineup": lineup, "split": split_used, "notes": notes}


def soccer_reasons(d, M):
    hn, an = d["home"]["name"], d["away"]["name"]
    out = []
    H, A = d["home"].get("row") or {}, d["away"].get("row") or {}
    if H.get("gp") and A.get("gp"):
        out.append(f"Table: {hn} {int(H['w'])}-{int(H['d'])}-{int(H['l'])} ({H['gf']:.0f} scored, {H['ga']:.0f} conceded), "
                   f"{an} {int(A['w'])}-{int(A['d'])}-{int(A['l'])} ({A['gf']:.0f}, {A['ga']:.0f}).")
    vh, va = d["home"].get("venue"), d["away"].get("venue")
    if M["split"]:
        out.append(f"{hn} at home: {vh['home'][1] / vh['home'][0]:.1f} scored, {vh['home'][2] / vh['home'][0]:.1f} conceded a game. "
                   f"{an} away: {va['away'][1] / va['away'][0]:.1f} scored, {va['away'][2] / va['away'][0]:.1f} conceded.")
    form = d.get("form") or {}
    f = lambda tid: "".join((g.get("res") or "?")[0] for g in (form.get(tid) or [])[:5])
    if form:
        out.append(f"Last five (latest first): {hn} {f(d['home']['id']) or '–'}, {an} {f(d['away']['id']) or '–'}.")
    lu = M["lineup"]
    for k, n in (("home", hn), ("away", an)):
        x = lu.get(k) or {}
        bits = []
        if x.get("strength") is not None:
            bits.append(f"{round(x['strength'] * 100)}% of their strongest eleven")
        if x.get("missing"):
            bits.append("without " + ", ".join(mm["name"] for mm in x["missing"][:3]))
        if x.get("coach"):
            bits.append(f"coach {x['coach']}")
        if bits:
            out.append(f"{n}: " + "; ".join(bits) + ".")
    hh = (d.get("fm") or {}).get("h2h") or {}
    if isinstance(hh.get("summary"), list) and sum(hh["summary"]) :
        hw, dr, aw = hh["summary"]
        out.append(f"Head-to-head (recent meetings): {hn} {hw} wins, {dr} draws, {an} {aw} wins.")
    elif d.get("series"):
        out.append(f"Head-to-head: {d['series']}.")
    out.append(f"Expected goals: {hn} {M['xg'][0]:.2f}, {an} {M['xg'][1]:.2f}.")
    if d.get("market"):
        mk = d["market"]
        out.append(f"{mk['book']} prices (margin removed): {hn} {mk['home']:.0%}, draw {mk['draw']:.0%}, {an} {mk['away']:.0%}"
                   + (f"; total line {mk['ou']}." if mk.get("ou") else "."))
    return out


# ---------- football ----------

def gather_football(m):
    fetch = D["fetch"]
    L = FB[m["lg"]]
    summ = fetch(f"{ESPN}/football/{L['path']}/summary?event={m['id']}", 120, as_json=True)
    comp = ((summ.get("header") or {}).get("competitions") or [{}])[0]
    st = ((comp.get("status") or {}).get("type") or {})
    d = {"sport": "football", "lg": m["lg"], "id": m["id"], "league": FB_NAMES.get(m["lg"]), "state": st.get("state") or "pre", "status": st.get("detail") or "",
         "neutral": bool(comp.get("neutralSite")), "kickoff": comp.get("date")}
    sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    for k in ("home", "away"):
        c = sides.get(k) or {}
        t = c.get("team") or {}
        rec = next((r.get("summary") for r in c.get("record") or [] if r.get("type") in ("total", None)), None)
        d[k] = {"name": t.get("displayName") or m.get(k), "id": str(t.get("id") or ""), "rank": (c.get("rank") or (c.get("curatedRank") or {}).get("current")),
                "record": rec}
    gi = summ.get("gameInfo") or {}
    d["venue"] = (gi.get("venue") or {}).get("fullName")
    w = gi.get("weather") or {}
    d["weather"] = ", ".join(x for x in (w.get("displayValue"), f"{w['temperature']}°F" if w.get("temperature") else None) if x) or None
    pc = _pick_market(summ)
    if pc:
        hml, aml = (pc.get("homeTeamOdds") or {}).get("moneyLine"), (pc.get("awayTeamOdds") or {}).get("moneyLine")
        probs = devig(american_to_p(hml), american_to_p(aml))
        spread = pc.get("spread")
        home_fav = (pc.get("homeTeamOdds") or {}).get("favorite")
        away_fav = (pc.get("awayTeamOdds") or {}).get("favorite")
        hm = None                                    # expected home margin implied by the spread
        if spread is not None:
            if home_fav is True or away_fav is False:
                hm = abs(num(spread))
            elif away_fav is True or home_fav is False:
                hm = -abs(num(spread))
            else:                                    # fall back to the text, e.g. "SEA -3"
                abbr = str(((sides.get("home") or {}).get("team") or {}).get("abbreviation") or "")
                mt = re.match(r"(\S+)\s+-([\d.]+)", str(pc.get("details") or ""))
                if mt:
                    hm = num(mt.group(2)) * (1 if mt.group(1) == abbr else -1)
        d["market"] = {"pH": probs[0] if probs else None, "margin": hm, "total": num(pc.get("overUnder"), None) if pc.get("overUnder") else None,
                       "details": pc.get("details"), "book": (pc.get("provider") or {}).get("name") or "Sportsbook"}
    else:
        d["market"] = None
    pr = summ.get("predictor") or {}
    hp = num((pr.get("homeTeam") or {}).get("gameProjection"), None)
    d["fpi"] = hp / 100 if hp else None
    inj = {}
    for t in summ.get("injuries") or []:
        side = "home" if str((t.get("team") or {}).get("id")) == d["home"]["id"] else "away"
        inj[side] = [{"name": (x.get("athlete") or {}).get("displayName"), "id": str((x.get("athlete") or {}).get("id")),
                      "pos": ((x.get("athlete") or {}).get("position") or {}).get("abbreviation"), "status": x.get("status"),
                      "date": (x.get("date") or "")[:10], "detail": (x.get("details") or {}).get("type") or ""} for x in t.get("injuries") or []]
    d["injuries"] = inj
    # the starting quarterback = each side's passing leader this season
    qbs = {}
    for t in summ.get("leaders") or []:
        side = "home" if str((t.get("team") or {}).get("id")) == d["home"]["id"] else "away"
        for cat in t.get("leaders") or []:
            if cat.get("name") in ("passingYards", "passing"):
                a = ((cat.get("leaders") or [{}])[0].get("athlete") or {})
                qbs[side] = {"name": a.get("displayName"), "id": str(a.get("id"))}
    d["qb"] = qbs
    d["leaders"] = {}
    for t in summ.get("leaders") or []:
        side = "home" if str((t.get("team") or {}).get("id")) == d["home"]["id"] else "away"
        d["leaders"][side] = {cat.get("displayName") or cat.get("name"): f"{((cat.get('leaders') or [{}])[0].get('athlete') or {}).get('displayName')}: {(cat.get('leaders') or [{}])[0].get('displayValue')}"
                              for cat in t.get("leaders") or [] if cat.get("leaders")}
    d["form"] = _last_five(summ)
    ats = {}
    for t in summ.get("againstTheSpread") or []:
        side = "home" if str((t.get("team") or {}).get("id")) == d["home"]["id"] else "away"
        ats[side] = [r.get("result") or r.get("description") for r in (t.get("records") or [])][:3]
    d["ats"] = ats
    try:
        d["table"] = _standings_espn(f"football/{L['path']}", L["group"])
    except Exception:
        d["table"] = {}
    for k in ("home", "away"):
        d[k]["row"] = d["table"].get(d[k]["id"])
    return d


def _recent(date_s, days=21):
    try:
        return (datetime.date.today() - datetime.date.fromisoformat(date_s)).days <= days
    except Exception:
        return True


def model_football(d):
    L = FB[d["lg"]]
    H, A = d["home"].get("row") or {}, d["away"].get("row") or {}
    K = 2.0
    net = lambda r: ((r.get("gf") or 0) - (r.get("ga") or 0)) / ((r.get("gp") or 0) + K)
    off = lambda r: ((r.get("gf") or 0) + L["ppg"] * K) / ((r.get("gp") or 0) + K)
    dfn = lambda r: ((r.get("ga") or 0) + L["ppg"] * K) / ((r.get("gp") or 0) + K)
    hfa = 0 if d.get("neutral") else L["hfa"]
    margin = .6 * (net(H) - net(A)) + hfa
    f5 = d.get("form") or {}
    avgm = lambda g: sum(x["gf"] - x["ga"] for x in g[:5]) / len(g[:5]) if g else 0
    margin += .12 * (avgm(f5.get(d["home"]["id"]) or []) - avgm(f5.get(d["away"]["id"]) or []))
    if L["path"] == "college-football" and min(H.get("gp") or 0, A.get("gp") or 0) < 3:
        rk = lambda r: (26 - r) * .3 if r and r <= 25 else 0
        margin += rk(d["home"].get("rank")) - rk(d["away"].get("rank"))
    # injuries: the quarterback matters most; others by position, counting news from the last three weeks
    hits, qb_out = {"home": 0.0, "away": 0.0}, {}
    for side in ("home", "away"):
        qb = (d.get("qb") or {}).get(side) or {}
        for x in (d.get("injuries") or {}).get(side) or []:
            s = (x.get("status") or "").lower()
            w = 1 if s in ("out", "injured reserve", "suspension") else .75 if s == "doubtful" else .15 if s == "questionable" else 0
            if not w or (s == "injured reserve" and not _recent(x.get("date"))):
                continue
            if x.get("pos") == "QB" and qb.get("id") and x.get("id") == qb.get("id"):
                hits[side] += L["qb"] * w
                qb_out[side] = {"name": x["name"], "status": x["status"]}
            elif x.get("pos") != "QB":
                hits[side] += POS_PTS.get(x.get("pos") or "", .3) * w
        hits[side] = min(hits[side], L["qb"] + 4)
    margin += -hits["home"] + hits["away"]
    total = (off(H) + dfn(A)) / 2 + (off(A) + dfn(H)) / 2
    model = {"margin": margin, "pH": phi(margin / L["sd"]), "total": total}
    parts, mk, fpi = [], d.get("market") or {}, d.get("fpi")
    if mk.get("margin") is not None or mk.get("pH") is not None:
        mm = mk["margin"] if mk.get("margin") is not None else L["sd"] * phi_inv(mk["pH"])
        mp = mk["pH"] if mk.get("pH") is not None else phi(mm / L["sd"])
        parts.append((.55, mm, mp))
    if fpi:
        parts.append((.25, L["sd"] * phi_inv(fpi), fpi))
    parts.append((.20 if parts else 1.0, margin, model["pH"]))
    wsum = sum(w for w, _, _ in parts)
    bm = sum(w * m_ for w, m_, _ in parts) / wsum
    bp = sum(w * p for w, _, p in parts) / wsum
    bt = .6 * mk["total"] + .4 * total if mk.get("total") else total
    return {"model": model, "blend": {"home": bp, "away": 1 - bp}, "margin": bm, "total": bt, "hits": hits, "qbOut": qb_out,
            "hfa": hfa, "weights": [round(w / wsum, 2) for w, _, _ in parts]}


def football_reasons(d, M):
    hn, an = d["home"]["name"], d["away"]["name"]
    out = []
    H, A = d["home"].get("row") or {}, d["away"].get("row") or {}
    if H.get("gp") and A.get("gp"):
        out.append(f"{hn} {int(H['w'])}-{int(H['l'])}: {H['gf'] / H['gp']:.1f} points scored and {H['ga'] / H['gp']:.1f} allowed a game. "
                   f"{an} {int(A['w'])}-{int(A['l'])}: {A['gf'] / A['gp']:.1f} and {A['ga'] / A['gp']:.1f}.")
        if H.get("home") or A.get("road"):
            out.append(f"{hn} at home {H.get('home') or '–'}; {an} on the road {A.get('road') or '–'}.")
    f5 = d.get("form") or {}
    f = lambda tid: "".join((g.get("res") or "?")[0] for g in (f5.get(tid) or [])[:5])
    if f5:
        out.append(f"Last five (latest first): {hn} {f(d['home']['id']) or '–'}, {an} {f(d['away']['id']) or '–'}.")
    for side, n in (("home", hn), ("away", an)):
        qb = (d.get("qb") or {}).get(side)
        if M["qbOut"].get(side):
            st_ = M['qbOut'][side]['status'].lower()
            out.append(f"{n} quarterback {M['qbOut'][side]['name']} is listed {st_}. A starting QB is worth about {FB[d['lg']]['qb']:.0f} points"
                       + (", so the model takes a small share of that for the risk he sits." if st_ == "questionable" else ", and the model takes that off."))
        elif qb:
            out.append(f"{n} quarterback: {qb['name']}, no injury designation.")
    if M["hits"]["home"] or M["hits"]["away"]:
        out.append(f"Injury cost (model points): {hn} {M['hits']['home']:.1f}, {an} {M['hits']['away']:.1f}.")
    out.append("Neutral site." if d.get("neutral") else f"Home field is worth about {M['hfa']} points to {hn}.")
    if d.get("weather"):
        out.append(f"Weather: {d['weather']}.")
    mk = d.get("market") or {}
    if mk.get("details"):
        out.append(f"{mk['book']} line: {mk['details']}" + (f", total {mk['total']}." if mk.get("total") else "."))
    if d.get("fpi"):
        out.append(f"ESPN's matchup predictor gives {hn} {d['fpi']:.0%}.")
    m = M["model"]
    out.append(f"Points model alone: {hn if m['margin'] >= 0 else an} by {abs(m['margin']):.1f}, total {m['total']:.1f}.")
    return out


# ---------- Claude research ----------

def _dossier(d, M):
    """A compact version of everything gathered, for the research prompt."""
    keep = {k: d.get(k) for k in ("sport", "lg", "league", "kickoff", "venue", "neutral", "weather", "market", "fpi", "qb", "leaders", "series", "ats", "status")}
    if d.get("props"):
        keep["player_props"] = d["props"][:30]          # consensus lines across books: [player, stat, line, chance of over (no vig)]
    for k in ("home", "away"):
        x = dict(d[k])
        x.pop("venue", None)
        keep[k] = x
    keep["recent_form"] = {("home" if tid == d["home"]["id"] else "away"): g[:5] for tid, g in (d.get("form") or {}).items()}
    if d["sport"] == "soccer":
        fm = d.get("fm") or {}
        keep["lineups"] = M["lineup"]
        keep["head_to_head"] = fm.get("h2h")
        keep["venue_splits"] = {"home_team_at_home": (d["home"].get("venue") or {}).get("home"), "away_team_away": (d["away"].get("venue") or {}).get("away"),
                                "format": "[games, goals for, goals against]"}
        keep["model"] = {"probabilities": M["model"], "expected_goals": M["xg"], "over_2_5": round(M["o25"], 3)}
    else:
        keep["injuries"] = d.get("injuries")
        keep["model"] = {"home_win": round(M["model"]["pH"], 3), "home_margin": round(M["model"]["margin"], 1), "total": round(M["model"]["total"], 1)}
    return json.dumps(keep, default=str)[:14000]


def _prompt(m, d, M, stage, prev):
    hn, an = d["home"]["name"], d["away"]["name"]
    when = {"week": "a week-ahead", "days3": "a three-days-ahead", "morning": "the morning of the match", "hour": "one hour before kick-off",
            "final": "30 minutes before kick-off", "now": "an on-demand update"}[stage]
    soccer = d["sport"] == "soccer"
    focus = ("confirmed starting lineups (usually out about an hour before), late fitness news, the manager's selection and tactics"
             if soccer else "the inactives list (out about 90 minutes before NFL kick-off), quarterback status, late injury news, weather and line movement")
    shape = ('{"probabilities":{"home":0.0,"draw":0.0,"away":0.0},"score":"2-1","expected_goals":{"home":0.0,"away":0.0},'
             if soccer else '{"probabilities":{"home":0.0,"away":0.0},"home_margin":0.0,"total":0.0,"score":"24-20",')
    prev_txt = ""
    if prev and prev.get("ai"):
        prev_txt = f"\nYour earlier forecast ({STAGE_LABEL.get(prev['stage'], prev['stage'])}): {json.dumps({k: prev['ai'].get(k) for k in ('probabilities', 'score', 'summary')})}\nSay what changed since then, if anything."
    return f"""Today is {datetime.date.today().isoformat()}. You are writing {when} forecast for {hn} (home) vs {an} (away), {d.get('league') or d['lg']}, kick-off {d.get('kickoff')}.
{'Neutral site.' if d.get('neutral') else ''}

Data already gathered (JSON): {_dossier(d, M)}

Search the web for the latest credible reporting (official team sites, ESPN, The Athletic, BBC Sport, Sky Sports, AP, Reuters, beat reporters, reputable local outlets), focusing on {focus}.
Weigh everything that realistically matters: injuries and who replaces whom, lineups, coaches and their tactical matchups or recent changes, each team's attack and defense, home and away form, schedule and rest, travel, motivation (table position, rivalry, cup priorities), head-to-head history, weather, and the betting market, which is usually well informed.
Be realistic and calibrated: avoid overconfidence, don't overreact to small samples, and move away from the market only with a concrete reason.{prev_txt}

This is analysis for a fan, not betting advice. Don't recommend bets or stakes.
Reply with one JSON object only:
{shape}"confidence":"low|medium|high","summary":"3-5 sentences","factors":["most important first"],"risks":["what could make this wrong"],"lineups":"starting lineups or expected lineups, one line per team","injuries":"key absences, one line","coaches":"coaching and tactical notes, one line","changed":"what changed since the last update, or empty","props":[{{"player":"","market":"e.g. Receiving yards","pick":"e.g. Over 54.5","why":"one sentence"}}]}}
"props": up to 3 player props from the list above that you think are mispriced given usage, matchup, injuries and recent form; leave it empty if none stand out."""


def research(m, d, M, stage, prev):
    try:
        import anthropic
    except ImportError:
        return {"error": "The anthropic package isn't installed. Run: python3 -m pip install --user \"anthropic<1\""}
    client = anthropic.Anthropic(api_key=CONFIG["key"], timeout=240, max_retries=2)
    messages = [{"role": "user", "content": _prompt(m, d, M, stage, prev)}]
    sources, msg = [], None
    try:
        for _ in range(5):
            msg = client.beta.messages.create(
                model=MODEL, max_tokens=12000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                output_config={"effort": "medium"},
                tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 8 if stage in ("morning", "now") else 5}],
                messages=messages)
            for b in msg.content:
                if b.type == "web_search_tool_result" and isinstance(b.content, list):
                    for r in b.content:
                        url = getattr(r, "url", None)
                        if url and not any(s["url"] == url for s in sources):
                            sources.append({"title": getattr(r, "title", "") or url, "url": url})
            if msg.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": msg.content})
    except anthropic.AuthenticationError:
        CONFIG["keyError"] = "Anthropic rejected the saved API key. Save a new key to turn research back on."
        _save_config()
        return {"error": CONFIG["keyError"]}
    except anthropic.PermissionDeniedError:
        return {"error": "This API key can't use web search. Turn it on for your organization in the Anthropic Console."}
    except anthropic.RateLimitError:
        return {"error": "Anthropic rate limit reached; the next update will try again."}
    except anthropic.APIConnectionError:
        return {"error": "Couldn't reach the Anthropic API."}
    except anthropic.APIStatusError as e:
        return {"error": f"Anthropic API error {e.status_code}."}
    if msg is None:
        return {"error": "No answer from Claude."}
    if msg.stop_reason == "refusal":
        return {"error": "Claude declined this request."}
    text = "".join(b.text for b in msg.content if b.type == "text")
    mm = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    raw = mm.group(1) if mm else text[text.find("{"): text.rfind("}") + 1]
    try:
        r = json.loads(raw)
    except Exception:
        return {"error": "Claude's answer came back in an unexpected format."}
    probs = r.get("probabilities") or {}
    keys = ("home", "draw", "away") if d["sport"] == "soccer" else ("home", "away")
    vals = [min(.98, max(.01, num(probs.get(k), 0))) for k in keys]
    if sum(vals) < .5:
        return {"error": "Claude's answer had no usable probabilities."}
    r["probabilities"] = {k: v / sum(vals) for k, v in zip(keys, vals)}
    r["sources"] = (r.get("sources") or []) + sources
    r["sources"] = [s for s in r["sources"] if isinstance(s, dict) and s.get("url")][:10]
    return r


def _research_allowed(m):
    if not CONFIG.get("key") or not CONFIG.get("enabled") or CONFIG.get("keyError"):
        return False
    if not m.get("research") and CONFIG.get("scope") != "all":
        return False
    day = datetime.date.today().isoformat()
    used = (CONFIG.get("usage") or {}).get(day, 0)
    return used < int(CONFIG.get("cap") or 20)


def _count_use():
    day = datetime.date.today().isoformat()
    CONFIG["usage"] = {day: (CONFIG.get("usage") or {}).get(day, 0) + 1}
    _save_config()


# ---------- one forecast ----------

def run(key, stage):
    m = TRACKED.get(key)
    if not m:
        return
    d = gather_soccer(m) if m["sport"] == "soccer" else gather_football(m)
    if d.get("state") and d["state"] != "pre":
        m["over"] = True                     # started, finished or postponed: nothing more to forecast
        return
    board = None
    if D.get("odds"):
        try:
            board = D["odds"].board(D["odds"].query_for(m["sport"], m["lg"], m["id"], d["home"]["name"], d["away"]["name"], d.get("kickoff") or m["ko"]))
        except Exception:
            board = None
    if board:
        d["props"] = [[p["player"], p["label"], p.get("line"), round((p.get("fair") or {}).get("over") or (p.get("fair") or {}).get("yes") or 0, 3)]
                      for p in board.get("props") or [] if (p.get("fair") or {})][:60]
    M = model_soccer(d) if m["sport"] == "soccer" else model_football(d)
    f = FORECASTS.setdefault(key, {"ko": m["ko"], "snaps": []})
    prev = f["snaps"][-1] if f["snaps"] else None
    ai = None
    if _research_allowed(m):
        _count_use()
        ai = research(m, d, M, stage, prev)
    final = dict(M["blend"])
    if ai and not ai.get("error"):
        final = {k: .5 * final[k] + .5 * ai["probabilities"].get(k, final[k]) for k in final}
        s = sum(final.values())
        final = {k: v / s for k, v in final.items()}
    pick = max(final, key=final.get)
    top = final[pick]
    snap = {"stage": stage, "at": time.time(), "final": final, "pick": pick, "top": top, "blend": M["blend"],
            "model": M["model"] if m["sport"] == "football" else M["model"], "market": d.get("market"),
            "home": d["home"]["name"], "away": d["away"]["name"], "ai": ai,
            "value": D["odds"].value_picks(board) if board else [], "books": [b_["name"] for b_ in (board or {}).get("books") or []]}
    if m["sport"] == "soccer":
        snap["conf"] = "Strong" if top >= .6 else "Lean" if top >= .45 else "Toss-up"
        want = (lambda i, j: i > j) if pick == "home" else (lambda i, j: j > i) if pick == "away" else (lambda i, j: i == j)
        best = next(((i, j) for i, j, _ in M["scores"] if want(i, j)), M["scores"][0][:2])
        snap.update({"score": [best[0], best[1]], "xg": M["xg"], "o25": M["o25"], "btts": M["btts"], "likely": M["likely"],
                     "lineup": {"type": M["lineup"]["type"], **{k: M["lineup"][k] for k in ("home", "away")}},
                     "h2h": ((d.get("fm") or {}).get("h2h") or {}).get("summary"), "reasons": soccer_reasons(d, M)})
    else:
        L = FB[d["lg"]]
        margin, total = M["margin"], M["total"]
        if ai and not ai.get("error"):
            if ai.get("home_margin") is not None:
                margin = .5 * margin + .5 * num(ai["home_margin"], margin)
            if ai.get("total"):
                total = .5 * total + .5 * num(ai["total"], total)
        # keep the shown margin consistent with the shown win chance
        margin = .5 * margin + .5 * L["sd"] * phi_inv(final["home"])
        snap["conf"] = "Strong" if top >= .72 else "Lean" if top >= .58 else "Toss-up"
        snap.update({"margin": round(margin, 1), "total": round(total, 1),
                     "score": [max(0, round((total + margin) / 2)), max(0, round((total - margin) / 2))],
                     "fpi": d.get("fpi"), "qbOut": M["qbOut"], "qb": d.get("qb"), "weather": d.get("weather"),
                     "reasons": football_reasons(d, M)})
    with _lock:
        f["snaps"] = [s for s in f["snaps"] if s["stage"] != stage] + [snap]
        f["snaps"].sort(key=lambda s: s["at"])
        f["ko"] = m["ko"]
        f.pop("error", None)


# ---------- what the app reads ----------

def view(key):
    m = TRACKED.get(key)
    f = FORECASTS.get(key) or {}
    out = {"tracked": bool(m), "snaps": f.get("snaps", []), "error": f.get("error")}
    if m:
        done = {s["stage"] for s in out["snaps"]}
        out["plan"] = [{"stage": st, "at": t, "done": st in done, "skipped": st in f.get("skipped", [])} for st, t in plan(m)]
        out["research"] = bool(CONFIG.get("key") and CONFIG.get("enabled") and not CONFIG.get("keyError") and (m.get("research") or CONFIG.get("scope") == "all"))
        out["running"] = _state["running"] is not None and _state["running"][0] == key
        out["queued"] = any(j[0] == key for j in _jobs)
    return out


def settings_view():
    day = datetime.date.today().isoformat()
    return {"hasKey": bool(CONFIG.get("key")), "enabled": bool(CONFIG.get("enabled")), "scope": CONFIG.get("scope") or "watched",
            "cap": int(CONFIG.get("cap") or 20), "used": (CONFIG.get("usage") or {}).get(day, 0), "keyError": CONFIG.get("keyError"),
            "tracked": len(TRACKED), "morning": MORNING_HOUR}


def update_settings(body):
    if body.get("clearKey"):
        CONFIG.pop("key", None)
        CONFIG.pop("keyError", None)
        CONFIG["enabled"] = False
    k = body.get("key")
    if isinstance(k, str) and k.strip():
        k = k.strip()
        if not re.fullmatch(r"sk-ant-[A-Za-z0-9_-]{20,200}", k):
            return 400, {"error": "That doesn't look like an Anthropic API key (it starts with sk-ant-)."}
        CONFIG["key"] = k
        CONFIG.pop("keyError", None)
        CONFIG["enabled"] = True
    if isinstance(body.get("enabled"), bool):
        CONFIG["enabled"] = body["enabled"] and bool(CONFIG.get("key"))
    if body.get("scope") in ("watched", "all"):
        CONFIG["scope"] = body["scope"]
    if isinstance(body.get("cap"), int) and 0 <= body["cap"] <= 200:
        CONFIG["cap"] = body["cap"]
    _save_config()
    return 200, settings_view()
