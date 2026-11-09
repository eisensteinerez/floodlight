"""Floodlight baseball data from Flashscore's public feeds.

MLB StatsAPI covers MLB, the minors, the winter leagues, the Mexican League and the WBC with full stats, and the page
reads it directly. Japan (NPB), Korea (KBO), Taiwan (CPBL) and Cuba's Serie Nacional come from Flashscore, which needs
a request header a browser page can't send, so the server fetches and parses it:

  /api/bsb/day?off=0&tz=3          games for one day across the covered leagues
  /api/bsb/league?key=kbo          standings, results and fixtures for a league
  /api/bsb/game?id=&ja=&jb=        inning scores, team stats, lineups, head to head and bookmaker odds
  /api/bsb/team?id=&slug=          results, fixtures and the players seen in its recent lineups
  /api/bsb/find?date=&home=&away=  the Flashscore id of a game known from MLB StatsAPI (for its bookmaker odds)
  /api/bsb/odds?id=&ja=&jb=        bookmaker odds only
  /api/bsb/banana/...              Banana Ball schedule, standings and player stats (baseball_banana.py)
  /api/bsb/x/roster|pool|player     KBO, NPB and CPBL rosters, player pages and league stat pools (baseball_asia.py)
"""
import datetime
import gzip
import json
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

import baseball_asia
import baseball_banana

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
FEED = "https://global.flashscore.ninja/2/x/feed/"
SITE = "https://www.flashscore.com"
ODDS = "https://global.ds.lsapp.eu/odds/pq_graphql"
IMG = "https://static.flashscore.com/res/image/data/"
FSIGN = "SW9D1eZo"
SPORT = 6   # Flashscore's id for baseball

# league key -> its Flashscore page path and a pattern for the "COUNTRY: League" heading
LEAGUES = {
    "npb": ("/baseball/japan/npb/", r"^JAPAN: NPB"),
    "kbo": ("/baseball/south-korea/kbo/", r"^SOUTH KOREA: KBO"),
    "cpbl": ("/baseball/taiwan/cpbl/", r"^TAIWAN: CPBL"),
    "cuba": ("/baseball/cuba/serie-nacional/", r"^CUBA: Serie Nacional"),
}
_cache = {}
_lock = threading.Lock()


def _get(url, ttl, headers=None, as_json=False):
    now = time.time()
    with _lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < ttl:
            return hit[1]
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-GB,en;q=0.9", "Referer": SITE + "/"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=20) as r:
        raw = r.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    body = raw.decode("utf-8", "replace")
    data = json.loads(body) if as_json else body
    with _lock:
        _cache[url] = (now, data)
        if len(_cache) > 1500:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:400]:
                _cache.pop(k, None)
    return data


def feed(name, ttl=30):
    return _get(FEED + name, ttl, {"x-fsign": FSIGN})


def records(text):
    """Flashscore feeds are records split by ~, fields by ¬, key÷value. Repeated keys within a record keep a list."""
    out = []
    for rec in text.split("~"):
        d = {}
        for f in rec.split("¬"):
            if "÷" in f:
                k, v = f.split("÷", 1)
                if k in d:
                    d.setdefault("_multi", {}).setdefault(k, [d[k]]).append(v)
                else:
                    d[k] = v
        if d:
            out.append(d)
    return out


def img(p):
    return IMG + p if p and not p.startswith("http") else (p or "")


def num(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


# inning-by-inning runs in the list feeds: home in BA, BC, BE..., away in BB, BD, BF...
H_INN = ["BA", "BC", "BE", "BG", "BI", "BK", "BM", "BO", "BQ"]
A_INN = ["BB", "BD", "BF", "BH", "BJ", "BL", "BN", "BP", "BR"]


def state_of(ab):
    return "in" if ab == "2" else "post" if ab == "3" else "pre"


def detail_of(ab, ac, r):
    if ab == "3":
        return "Final"
    if ab == "2":
        n = len([k for k in H_INN + A_INN if r.get(k) not in (None, "")])
        inn = max(1, (n + 1) // 2)
        half = "Top" if n % 2 == 1 else "Bot"
        return f"{half} {inn}" if n else "Live"
    return {"4": "Postponed", "5": "Cancelled", "8": "Abandoned", "36": "Interrupted", "37": "Abandoned"}.get(ac, "")


def event(r, league=None):
    side = lambda n, fn, ab, pid, jid, slug, logo, sc, inn, hits, errs: {
        "id": pid or "", "name": n or fn or "", "full": fn or n or "", "abbr": ab or (n or "")[:3].upper(), "pid": jid or "",
        "slug": slug or "", "logo": img(logo.split("|")[0]) if logo else "", "score": sc if sc not in (None, "") else "",
        "lines": [r.get(k) for k in inn if r.get(k) not in (None, "")], "hits": hits or "", "errors": errs or ""}
    ab, ac = r.get("AB"), r.get("AC")
    return {"id": r.get("AA"), "src": "fs", "lg": league, "ts": num(r.get("AD")) or 0, "state": state_of(ab), "detail": detail_of(ab, ac, r),
            "round": r.get("ER", ""), "note": r.get("AM", ""),
            "home": side(r.get("CX") or r.get("AE"), r.get("FH") or r.get("AE"), r.get("WM"), r.get("PX"), r.get("JA"), r.get("WU"), r.get("OA"), r.get("AG"), H_INN, r.get("WF"), r.get("WH")),
            "away": side(r.get("AF"), r.get("FK") or r.get("AF"), r.get("WN"), r.get("PY"), r.get("JB"), r.get("WV"), r.get("OB"), r.get("AH"), A_INN, r.get("WG"), r.get("WI"))}


def league_of(heading, path):
    for k, (p, pat) in LEAGUES.items():
        if re.search(pat, heading or "") or (path and path.rstrip("/") == p.rstrip("/")):
            if re.search(r"Women", heading or ""):
                continue
            return k
    return None


def parse_list(text, only=None, everything=False):
    """A day or league feed: league headings (ZA) followed by their games (AA)."""
    out, cur, meta, head = {}, None, {}, ""
    for r in records(text):
        if "ZA" in r:
            head = r["ZA"]
            cur = league_of(head, r.get("ZL")) or (head if everything else None)
            if cur:
                meta[cur] = {"name": head.split(": ", 1)[-1], "area": r.get("ZY", ""), "logo": img(r.get("OAJ")), "tid": r.get("ZEE"), "stage": r.get("ZC"), "path": r.get("ZL")}
        elif "AA" in r and cur and (not only or cur == only):
            out.setdefault(cur, []).append(event(r, cur))
    return out, meta


def day(off, tz):
    off, tz = max(-7, min(7, int(off))), max(-12, min(14, int(tz)))
    games, meta = parse_list(feed(f"f_{SPORT}_{off}_{tz}_en_1", 20 if off == 0 else 300))
    return {"games": games, "meta": meta}


def _initial(page, name):
    m = re.search(r"initialFeeds\['%s'\]\s*=\s*\{\s*data:\s*`(.*?)`" % name, page, re.S)
    return m.group(1) if m else ""


def standings(tid, stage, ttl=300):
    if not tid or not stage:
        return []
    try:
        text = feed(f"to_{tid}_{stage}_1", ttl)
    except Exception:
        return []
    groups, cur = [], None
    for r in records(text):
        if "TZ" in r or "TZS" in r:
            continue
        if "TA" in r and r.get("TA"):
            cur = {"name": r["TA"], "rows": []}
            groups.append(cur)
        if "TN" in r:
            if cur is None:
                cur = {"name": "", "rows": []}
                groups.append(cur)
            rf, ra = (r.get("TG", "0:0").split(":") + ["0"])[:2]
            cur["rows"].append({"rank": num(r.get("TR")), "id": r.get("TI"), "name": r["TN"], "slug": (r.get("TIU", "").strip("/").split("/") + [""])[1] if r.get("TIU") else "",
                                "gp": num(r.get("TM")) or 0, "w": num(r.get("TW")) or 0, "l": num(r.get("TL")) or 0, "t": num(r.get("TDR")) or 0,
                                "rs": num(rf) or 0, "ra": num(ra) or 0, "pct": r.get("PC", ""), "gb": r.get("TAP", ""), "zone": r.get("TU", ""), "zoneColor": r.get("TUC", ""), "form": []})
        elif "LMU" in r and cur and cur["rows"] and r.get("LMU") in ("w", "l", "d"):
            cur["rows"][-1]["form"].append(r["LMU"].upper())
    seen = set()
    for g in groups:   # the feed repeats the table once per sub-tab (overall, home, away); keep the first
        key = tuple(x["id"] for x in g["rows"])
        g["dup"] = key in seen
        seen.add(key)
    return [g for g in groups if not g["dup"] and g["rows"]]


def _season_stages(page):
    """The regular-season table: Flashscore's standings page lists each season's tournament and stage ids."""
    m = re.search(r'"season_list":\[\{"id":0,"name":"[^"]*","pathname":"\\?/standings\\?/(\w+)\\?/(\w+)\\?/"', page)
    return (m.group(1), m.group(2)) if m else (None, None)


def league(key):
    if key not in LEAGUES:
        return {"error": "unknown league"}
    path = LEAGUES[key][0]
    res = _get(SITE + path + "results/", 300)
    fix = _get(SITE + path + "fixtures/", 600)
    results, meta = parse_list(_initial(res, "results"))
    fixtures, meta2 = parse_list(_initial(fix, "fixtures"))
    m = {**meta2, **meta}
    lm = m.get(key) or next(iter(m.values()), {})
    try:
        tid, stage = _season_stages(_get(SITE + path + "standings/", 900))
    except Exception:
        tid, stage = None, None
    season = re.search(r"<title>[^<]*?(\d{4}(?:/\d{4})?)", res)
    flat = lambda d: [e for v in d.values() for e in v]
    table = standings(tid, stage) if tid else []
    if not table:   # in the playoffs the current stage has no table: fall back to the page's own ids
        t2 = re.search(r'tournament_id\s*=\s*"(\w+)"', res)
        s2 = re.search(r'"tournamentStage"\s*:\s*"(\w+)"', res)
        table = standings(t2.group(1) if t2 else lm.get("tid"), s2.group(1) if s2 else lm.get("stage"))
    return {"key": key, "name": lm.get("name", key), "area": lm.get("area", ""), "logo": lm.get("logo", ""), "season": season.group(1) if season else "",
            "standings": table, "results": sorted(flat(results), key=lambda e: -e["ts"]), "fixtures": sorted(flat(fixtures), key=lambda e: e["ts"])}


def team_stats(text):
    periods, cur, grp = [], None, None
    for r in records(text):
        if "SE" in r:
            cur = {"period": r["SE"], "rows": []}
            periods.append(cur)
        if "SG" in r and cur is not None:
            cur["rows"].append({"label": r["SG"], "home": r.get("SH", ""), "away": r.get("SI", "")})
    return periods


def summary(text):
    inn, tot, info = [], {}, {}
    for r in records(text):
        if "AC" in r and ("IG" in r or "IH" in r):
            inn.append({"period": r["AC"], "home": r.get("IG", ""), "away": r.get("IH", "")})
        if "WF" in r or "WG" in r:
            tot = {"homeHits": r.get("WF", ""), "awayHits": r.get("WG", ""), "homeErrors": r.get("WH", ""), "awayErrors": r.get("WI", "")}
        multi = r.get("_multi", {})
        tl, vl = multi.get("MIT", [r["MIT"]] if "MIT" in r else []), multi.get("MIV", [r["MIV"]] if "MIV" in r else [])
        for k, v in zip(tl, vl):
            if k in ("VEN", "TWN", "ATT", "CAP", "REF"):
                info[{"VEN": "venue", "TWN": "city", "ATT": "attendance", "CAP": "capacity", "REF": "umpire"}[k]] = v
    return inn, tot, info


def lineups(text):
    """Batters and pitchers for each side (LC 1 = home, 2 = away). Pitchers carry their decision, e.g. (W, 1-0)."""
    out = {"home": {"batters": [], "pitchers": [], "coach": ""}, "away": {"batters": [], "pitchers": [], "coach": ""}}
    grp, side = "batters", None
    for r in records(text):
        if "LB" in r:
            grp = "pitchers" if re.search(r"pitch", r["LB"], re.I) else "coach" if re.search(r"coach|manager", r["LB"], re.I) else "batters"
        if "LC" in r:
            side = "home" if r["LC"] == "1" else "away"
        if "LI" in r and side:
            p = {"id": r.get("LP", ""), "name": r["LI"], "last": r.get("LN", ""), "jersey": r.get("LJ", ""), "country": r.get("LQ", ""),
                 "dec": r.get("LT", ""), "sub": r.get("LG") == "2" and grp != "coach"}
            if grp == "coach":
                out[side]["coach"] = r["LI"]
            else:
                out[side][grp].append(p)
    return out


def h2h(text):
    out, cur, tabs = [], None, 0
    for r in records(text):
        if "KA" in r:
            tabs += 1
            if tabs > 1:   # later tabs repeat the same games split into home and away
                break
        if "KB" in r:
            cur = {"title": r["KB"], "games": []}
            out.append(cur)
        elif "KP" in r and cur is not None:
            cur["games"].append({"id": r["KP"], "ts": num(r.get("KC")) or 0, "lg": r.get("KF", ""), "home": r.get("KJ", "").lstrip("*"), "away": r.get("KK", "").lstrip("*"),
                                 "hid": r.get("UQ", ""), "aid": r.get("UO", ""), "hs": r.get("KU", ""), "as": r.get("KT", ""), "res": r.get("WIS", ""),
                                 "hlogo": img(r.get("EC")), "alogo": img(r.get("ED"))})
    return out


def odds(eid, ja="", jb=""):
    """Bookmaker prices (decimal odds) for the moneyline, run line and total, from Flashscore's odds service."""
    q = urllib.parse.urlencode({"_hash": "oce", "eventId": eid, "projectId": 2, "geoIpCode": "US", "geoIpSubdivisionCode": "USNY"})
    try:
        d = _get(f"{ODDS}?{q}", 60, as_json=True)["data"]["findOddsByEventId"]
    except Exception:
        return {"books": []}
    if not d:
        return {"books": []}
    names = {b["bookmaker"]["id"]: b["bookmaker"]["name"] for b in (d.get("settings") or {}).get("bookmakers", [])}
    books = {}
    rank = {"FULL_TIME_OVER_TIME": 2, "FULL_TIME": 1}
    for o in sorted(d.get("odds") or [], key=lambda o: rank.get(o.get("bettingScope"), 0)):   # extra-innings markets win when both exist
        bt, sc, items = o.get("bettingType"), o.get("bettingScope"), o.get("odds") or []
        if sc not in rank:
            continue
        b = books.setdefault(o.get("bookmakerId"), {"id": o.get("bookmakerId"), "name": names.get(o.get("bookmakerId"), "Book"), "spread": [], "total": []})
        act = [x for x in items if x.get("active", True)] or items
        if bt == "HOME_AWAY":
            h = next((x for x in act if x.get("eventParticipantId") == ja), act[0] if act else None)
            a = next((x for x in act if x.get("eventParticipantId") == jb), act[1] if len(act) > 1 else None)
            if h and a:
                b["ml"] = {"home": float(h["value"]), "away": float(a["value"]), "home0": float(h.get("opening") or 0) or None, "away0": float(a.get("opening") or 0) or None}
        elif bt == "OVER_UNDER":
            lines = {}
            for x in act:
                ln = (x.get("handicap") or {}).get("value")
                if ln is not None:
                    lines.setdefault(ln, {})[(x.get("selection") or "").lower()] = float(x["value"])
            got = sorted([{"line": float(k), **v} for k, v in lines.items() if "over" in v and "under" in v], key=lambda x: x["line"])
            if got:
                b["total"] = got
        elif bt == "ASIAN_HANDICAP":
            lines = {}
            for x in act:
                ln = (x.get("handicap") or {}).get("value")
                if ln is None:
                    continue
                who = "home" if x.get("eventParticipantId") == ja else "away" if x.get("eventParticipantId") == jb else None
                if who:
                    key = float(ln) if who == "home" else -float(ln)
                    lines.setdefault(key, {})[who] = float(x["value"])
            got = sorted([{"line": k, **v} for k, v in lines.items() if "home" in v and "away" in v], key=lambda x: abs((1 / x["home"]) - (1 / x["away"])))
            if got:
                b["spread"] = got
    return {"books": [b for b in books.values() if b.get("ml") or b["spread"] or b["total"]]}


def game(eid, ja="", jb=""):
    def safe(f, *a):
        try:
            return f(*a)
        except Exception:
            return None
    inn, tot, info = safe(lambda: summary(feed(f"df_sui_1_{eid}", 30))) or ([], {}, {})
    return {"id": eid, "innings": inn, "totals": tot, "info": info, "stats": safe(lambda: team_stats(feed(f"df_st_1_{eid}", 30))) or [],
            "lineups": safe(lambda: lineups(feed(f"df_li_1_{eid}", 60))), "h2h": safe(lambda: h2h(feed(f"df_hh_1_{eid}", 3600))) or [],
            "odds": safe(odds, eid, ja, jb) or {"books": []}}


def team_events(tid, tz=0):
    """Every recent and upcoming game of a team. League names in this feed are placeholders resolved by the profile feed."""
    names = {}
    for m in re.finditer(r"LV÷(\{[A-Z-]+-\w+\})_([^¬]*)", feed(f"pl_{tz}_{tid}_0", 3600)):
        names[m.group(1)] = m.group(2)
    text = re.sub(r"\{[A-Z-]+-\w+\}", lambda m: names.get(m.group(0), ""), feed(f"pe_1_{tz}_{tid}_x", 120))
    out, cur, lname = [], None, ""
    for r in records(text):
        if "ZA" in r:
            cur, lname = league_of(r["ZA"], r.get("ZL")), r["ZA"].split(": ", 1)[-1]
        elif "AA" in r:
            e = event(r, cur)
            e["lgName"] = lname
            out.append(e)
    return out


def team(tid, slug):
    evs = team_events(tid)
    done = sorted([e for e in evs if e["state"] == "post"], key=lambda e: -e["ts"])
    me = next((e[s] for e in evs for s in ("home", "away") if e[s]["id"] == tid), None)
    # Flashscore has no baseball squads, so the roster is everyone in this team's last few lineups
    roster, seen, coach = [], {}, ""
    for e in done[:6]:
        side = "home" if e["home"]["id"] == tid else "away"
        try:
            lu = lineups(feed(f"df_li_1_{e['id']}", 3600))
        except Exception:
            continue
        for grp in ("batters", "pitchers"):
            for p in lu[side][grp]:
                if p["id"] in seen:
                    seen[p["id"]]["games"] += 1
                    if grp == "pitchers":
                        seen[p["id"]]["role"] = "P" if seen[p["id"]]["role"] == "P" else "P/B"
                    continue
                seen[p["id"]] = {**p, "role": "P" if grp == "pitchers" else "B", "games": 1, "last": e["ts"]}
                roster.append(seen[p["id"]])
        coach = coach or lu[side]["coach"]
    return {"id": tid, "slug": slug, "name": me["full"] if me else slug.replace("-", " ").title(), "logo": me["logo"] if me else "", "coach": coach,
            "roster": roster, "results": done, "fixtures": sorted([e for e in evs if e["state"] != "post"], key=lambda e: e["ts"]),
            "leagues": sorted({e["lg"] for e in evs if e["lg"]})}


def _norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", s)


def _sim(a, b):
    A, B = set(_norm(a).split()), set(_norm(b).split())
    if not A or not B:
        return 0
    if _norm(a).strip() in _norm(b) or _norm(b).strip() in _norm(a):
        return .85
    return len(A & B) / len(A | B)


def find(date, home, away, tz=0):
    """A game from another source (MLB StatsAPI) matched to its Flashscore id, so the page can show bookmaker odds."""
    try:
        target = datetime.datetime.strptime(date, "%Y%m%d").date()
    except ValueError:
        return {}
    off = (target - datetime.datetime.utcnow().date()).days
    if abs(off) > 7:
        return {}
    games, _ = parse_list(feed(f"f_{SPORT}_{off}_{tz}_en_1", 120), everything=True)
    best, score = None, 0
    for lst in games.values():
        for e in lst:
            s = max(_sim(e["home"]["full"], home) + _sim(e["away"]["full"], away), _sim(e["home"]["full"], away) + _sim(e["away"]["full"], home))
            if s > score:
                best, score = e, s
    return {"id": best["id"], "ja": best["home"]["pid"], "jb": best["away"]["pid"], "home": best["home"]["full"], "away": best["away"]["full"],
            "swapped": _sim(best["home"]["full"], away) > _sim(best["home"]["full"], home)} if best and score >= 1 else {}


def handle(path, q):
    """Returns (status, payload, max_age) for an /api/bsb/ request."""
    ok_id = lambda s: bool(re.fullmatch(r"[A-Za-z0-9]{6,12}", s or ""))
    ok_slug = lambda s: bool(re.fullmatch(r"[a-z0-9-]{1,80}", s or ""))
    pid = lambda k: q.get(k, "") if ok_id(q.get(k)) else ""
    if path.startswith("banana/"):   # Banana Ball from its league stats site (baseball_banana.py)
        return baseball_banana.handle(path[len("banana/"):], q)
    if path.startswith("x/"):   # rosters and player stats for KBO, NPB and CPBL (baseball_asia.py)
        return baseball_asia.handle(path[2:], q)
    if path == "day":
        return 200, day(q.get("off", "0"), q.get("tz", "0")), 15
    if path == "league":
        return 200, league(q.get("key", "")), 120
    if path == "game":
        if not ok_id(q.get("id")):
            return 400, {"error": "bad id"}, 0
        return 200, game(q["id"], pid("ja"), pid("jb")), 15
    if path == "odds":
        if not ok_id(q.get("id")):
            return 400, {"error": "bad id"}, 0
        return 200, odds(q["id"], pid("ja"), pid("jb")), 30
    if path == "team":
        if not ok_id(q.get("id")) or not ok_slug(q.get("slug")):
            return 400, {"error": "bad team"}, 0
        return 200, team(q["id"], q["slug"]), 300
    if path == "find":
        if not re.fullmatch(r"\d{8}", q.get("date", "")):
            return 400, {"error": "bad date"}, 0
        return 200, find(q["date"], q.get("home", "")[:60], q.get("away", "")[:60], int(q.get("tz", "0") or 0)), 300
    return 404, {"error": "not found"}, 0
