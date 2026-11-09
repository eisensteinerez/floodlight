"""Floodlight basketball data from Flashscore's public feeds.

ESPN covers the NBA, WNBA, NCAA men and women and Australia's NBL with full stats, and the page reads it directly. Everything else
(EuroLeague, EuroCup, BCL, VTB, ABA, BAL, CBA, B.League, KBL, PBA, EASL, BCL Americas) comes from Flashscore,
which needs a request header a browser page can't send, so the server fetches and parses it:

  /api/bb/day?off=0&tz=3          games for one day across the covered leagues
  /api/bb/league?key=kbl          standings, results and fixtures for a league
  /api/bb/game?id=&ja=&jb=        quarter scores, team stats, player box score, head to head and bookmaker odds
  /api/bb/team?id=&slug=          roster, results and fixtures for a team
  /api/bb/player?id=&slug=        photo, bio, season averages by competition and recent games
  /api/bb/find?date=&home=&away=  the Flashscore id of a game known from ESPN (for its bookmaker odds)
  /api/bb/search?q=               teams and players
"""
import datetime
import gzip
import json
import re
import threading
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
FEED = "https://global.flashscore.ninja/2/x/feed/"
SITE = "https://www.flashscore.com"
ODDS = "https://global.ds.lsapp.eu/odds/pq_graphql"
SEARCH = "https://s.livesport.services/api/v2/search/"
IMG = "https://static.flashscore.com/res/image/data/"
FSIGN = "SW9D1eZo"

# league key -> how to find it in Flashscore: its page path and a pattern for the "COUNTRY: League" heading
LEAGUES = {
    "nba": ("/basketball/usa/nba/", r"^USA: NBA"),
    "wnba": ("/basketball/usa/wnba/", r"^USA: WNBA"),
    "cbb": ("/basketball/usa/ncaa/", r"^USA: NCAA(?! Women)"),
    "wcbb": ("/basketball/usa/ncaa-women/", r"^USA: NCAA Women"),
    "nbl": ("/basketball/australia/nbl/", r"^AUSTRALIA: NBL"),
    "euroleague": ("/basketball/europe/euroleague/", r"^EUROPE: Euroleague(?! Women)"),
    "eurocup": ("/basketball/europe/eurocup/", r"^EUROPE: Eurocup(?! Women)"),
    "bcl": ("/basketball/europe/champions-league/", r"^EUROPE: Champions League"),
    "vtb": ("/basketball/russia/vtb-united-league/", r"^RUSSIA: VTB United League"),
    "aba": ("/basketball/europe/admiralbet-aba-league/", r"^EUROPE: (AdmiralBet )?ABA League(?! 2)"),
    "bal": ("/basketball/africa/bal/", r"^AFRICA: (BAL|Basketball Africa League)"),
    "cba": ("/basketball/china/cba/", r"^CHINA: CBA"),
    "bleague": ("/basketball/japan/b-league-premier/", r"^JAPAN: B\.League (Premier|B1)"),
    "kbl": ("/basketball/south-korea/kbl/", r"^SOUTH KOREA: KBL"),
    "pba": ("/basketball/philippines/pba-governors-cup/", r"^PHILIPPINES: PBA"),
    "easl": ("/basketball/asia/easl/", r"^ASIA: EASL"),
    "bcla": ("/basketball/world/champions-league-americas/", r"^(WORLD|AMERICA|SOUTH AMERICA): (Champions League Americas|BCL Americas)"),
}
_cache = {}
_lock = threading.Lock()
_paths = {}   # league key -> latest page path seen in a day feed (the PBA renames its page every conference)


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


LIVE = {"22": "Q1", "23": "Q2", "24": "Q3", "25": "Q4", "38": "Half-time", "46": "Break", "6": "OT", "7": "OT"}


def state_of(ab, ac):
    if ab == "2":
        return "in"
    if ab == "3":
        return "post"
    return "pre"


def detail_of(ab, ac):
    if ab == "3":
        return "Final/OT" if ac in ("10", "11") else "Final"
    if ab == "2":
        return LIVE.get(ac, "Live")
    return {"4": "Postponed", "5": "Cancelled", "9": "Walkover", "8": "Abandoned", "36": "Interrupted", "37": "Abandoned"}.get(ac, "")


def event(r, league=None):
    hq = [r.get(k) for k in ("BA", "BC", "BE", "BG", "BI", "BK") if r.get(k) not in (None, "")]
    aq = [r.get(k) for k in ("BB", "BD", "BF", "BH", "BJ", "BL") if r.get(k) not in (None, "")]
    side = lambda n, fn, ab, pid, jid, slug, logo, sc, q: {
        "id": pid or "", "name": n or fn or "", "full": fn or n or "", "abbr": ab or (n or "")[:3].upper(), "pid": jid or "",
        "slug": slug or "", "logo": img(logo.split("|")[0]) if logo else "", "score": sc if sc not in (None, "") else "", "lines": q}
    ab, ac = r.get("AB"), r.get("AC")
    r = {k: (v if not (isinstance(v, str) and v.startswith("{")) else "") for k, v in r.items()}   # unresolved placeholders
    return {"id": r.get("AA"), "src": "fs", "lg": league, "ts": num(r.get("AD")) or 0, "state": state_of(ab, ac), "detail": detail_of(ab, ac),
            "round": r.get("ER", ""),
            "home": side(r.get("CX") or r.get("AE"), r.get("FH") or r.get("AE"), r.get("WM"), r.get("PX"), r.get("JA"), r.get("WU"), r.get("OA"), r.get("AG"), hq),
            "away": side(r.get("AF"), r.get("FK") or r.get("AF"), r.get("WN"), r.get("PY"), r.get("JB"), r.get("WV"), r.get("OB"), r.get("AH"), aq)}


def league_of(heading, path):
    for k, (p, pat) in LEAGUES.items():
        if re.search(pat, heading or "") or (path and path.rstrip("/") == p.rstrip("/")):
            if re.search(r"Women", heading or "") and k not in ("wnba", "wcbb"):
                continue
            return k
    return None


def parse_list(text, only=None):
    """A day or league feed: league headings (ZA) followed by their games (AA)."""
    out, cur, meta = {}, None, {}
    for r in records(text):
        if "ZA" in r:
            cur = league_of(r["ZA"], r.get("ZL"))
            if cur and r.get("ZL") and cur != "nba":
                _paths[cur] = r["ZL"]
            if cur:
                meta[cur] = {"name": r["ZA"].split(": ", 1)[-1], "area": r.get("ZY", ""), "logo": img(r.get("OAJ")), "tid": r.get("ZEE"), "stage": r.get("ZC"), "path": r.get("ZL")}
        elif "AA" in r and cur and (not only or cur == only):
            out.setdefault(cur, []).append(event(r, cur))
    return out, meta


def day(off, tz):
    off, tz = max(-7, min(7, int(off))), max(-12, min(14, int(tz)))
    text = feed(f"f_3_{off}_{tz}_en_1", 20 if off == 0 else 300)
    games, meta = parse_list(text)
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
    groups, cur, names = [], None, []
    for r in records(text):
        if "TZ" in r or "TZS" in r:
            continue
        if r.get("TE"):
            names.append(r["TE"])
        if "TN" in r:
            if cur is None or (r.get("TR") == "1" and cur["rows"]):   # the rank starts again at 1 in each group
                cur = {"name": names[len(groups)] if len(groups) < len(names) else "", "rows": []}
                groups.append(cur)
            pf, pa = (r.get("TG", "0:0").split(":") + ["0"])[:2]
            cur["rows"].append({"rank": num(r.get("TR")), "id": r.get("TI"), "name": r["TN"], "slug": (r.get("TIU", "").strip("/").split("/") + [""])[1] if r.get("TIU") else "",
                                "gp": num(r.get("TM")) or 0, "w": num(r.get("TW")) or 0, "l": num(r.get("TL")) or 0, "pf": num(pf) or 0, "pa": num(pa) or 0,
                                "pct": r.get("PC", ""), "zone": r.get("TU", ""), "zoneColor": r.get("TUC", ""), "form": []})
        elif "LMU" in r and cur and cur["rows"] and r.get("LMU") in ("w", "l"):
            cur["rows"][-1]["form"].append(r["LMU"].upper())
    seen = set()
    for g in groups:   # the feed repeats the table once per sub-tab (overall, home, away); keep the first
        key = tuple(x["id"] for x in g["rows"])
        g["dup"] = key in seen
        seen.add(key)
    out = [g for g in groups if not g["dup"] and g["rows"]]
    if len(out) > 1:
        for i, g in enumerate(out):
            g["name"] = g["name"] or f"Group {i + 1}"
    return out


def league(key):
    if key not in LEAGUES:
        return {"error": "unknown league"}
    path = _paths.get(key) or LEAGUES[key][0]
    res = _get(SITE + path + "results/", 300)
    try:
        fix = _get(SITE + path + "fixtures/", 600)
    except OSError:
        fix = ""
    results, meta = parse_list(_initial(res, "results"))
    fixtures, meta2 = parse_list(_initial(fix, "fixtures"))
    m = {**meta2, **meta}
    lm = m.get(key) or next(iter(m.values()), {})
    tid = re.search(r'tournament_id\s*=\s*"(\w+)"', res)
    stage = re.search(r'"tournamentStage"\s*:\s*"(\w+)"', res)
    season = re.search(r"<title>[^<]*?(\d{4}(?:/\d{4})?)", res)
    flat = lambda d: [e for v in d.values() for e in v]
    return {"key": key, "name": lm.get("name", key), "area": lm.get("area", ""), "logo": lm.get("logo", ""), "season": season.group(1) if season else "",
            "standings": standings(tid.group(1) if tid else lm.get("tid"), stage.group(1) if stage else lm.get("stage")),
            "results": sorted(flat(results), key=lambda e: -e["ts"]), "fixtures": sorted(flat(fixtures), key=lambda e: e["ts"])}


def team_stats(text):
    periods, cur, grp = [], None, ""
    for r in records(text):
        if "SE" in r:
            cur = {"period": r["SE"], "groups": []}
            periods.append(cur)
        if "SF" in r and cur is not None:
            grp = {"name": r["SF"], "rows": []}
            cur["groups"].append(grp)
        if "SG" in r and cur is not None and grp:
            grp["rows"].append({"label": r["SG"], "home": r.get("SH", ""), "away": r.get("SI", "")})
    return periods


def box_score(text):
    tabs, cur, cols = [], None, []
    for r in records(text):
        if "PA" in r:
            cur = {"name": r["PA"], "cols": [], "players": []}
            cols = cur["cols"]
            tabs.append(cur)
        elif "PF" in r and cur is not None:
            if r["PF"] != "Player":
                cols.append({"key": r["PF"], "label": r.get("PG", r["PF"]), "type": r.get("PH", "num")})
        elif "PJ" in r and cur is not None:
            url = r.get("PK", "").strip("/").split("/")
            vals = (r.get("PC") or "").split("|")
            cur["players"].append({"name": r["PJ"], "slug": url[1] if len(url) > 2 else "", "id": url[2] if len(url) > 2 else "", "country": r.get("PL", ""),
                                   "team": r.get("PN", ""), "stats": {c["key"]: (vals[i] if i < len(vals) and vals[i] != "-" else "") for i, c in enumerate(cols)}})
    return tabs


def summary(text):
    q, info = [], {}
    for r in records(text):
        if "AC" in r and "IG" in r:
            q.append({"period": r["AC"], "home": r.get("IG", ""), "away": r.get("IH", "")})
        multi = r.get("_multi", {})
        tl, vl = multi.get("MIT", [r["MIT"]] if "MIT" in r else []), multi.get("MIV", [r["MIV"]] if "MIV" in r else [])
        for k, v in zip(tl, vl):
            if k == "REF":
                info.setdefault("refs", []).append(v)
            elif k in ("VEN", "TWN", "ATT", "CAP"):
                info[{"VEN": "venue", "TWN": "city", "ATT": "attendance", "CAP": "capacity"}[k]] = v
    return q, info


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


# US books first; many games outside the NBA are only priced by European or Asian books, so fall back by region
ODDS_REGIONS = [("US", "USNY", ""), ("GB", "GB", "UK"), ("KR", "KR", "Asia"), ("RU", "RU", "Russia"), ("PH", "PH", "Philippines")]


def odds(eid, ja="", jb=""):
    for geo, sub, tag in ODDS_REGIONS:
        r = _odds_geo(eid, ja, jb, geo, sub)
        if r["books"]:
            r["region"] = tag
            return r
    return {"books": [], "region": ""}


def _odds_geo(eid, ja, jb, geo, sub):
    q = urllib.parse.urlencode({"_hash": "oce", "eventId": eid, "projectId": 2, "geoIpCode": geo, "geoIpSubdivisionCode": sub})
    try:
        d = _get(f"{ODDS}?{q}", 60, as_json=True)["data"]["findOddsByEventId"]
    except Exception:
        return {"books": []}
    if not d:
        return {"books": []}
    names = {b["bookmaker"]["id"]: b["bookmaker"]["name"] for b in (d.get("settings") or {}).get("bookmakers", [])}
    books = {}
    for o in d.get("odds") or []:
        bt, sc, items = o.get("bettingType"), o.get("bettingScope"), o.get("odds") or []
        if sc not in ("FULL_TIME", "FULL_TIME_OVER_TIME"):
            continue
        b = books.setdefault(o.get("bookmakerId"), {"id": o.get("bookmakerId"), "name": names.get(o.get("bookmakerId"), "Book"), "spread": [], "total": []})
        act = [x for x in items if x.get("active", True)] or items
        if bt == "HOME_AWAY" and (sc == "FULL_TIME_OVER_TIME" or not b.get("ml")):   # some books price regulation time only
            h = next((x for x in act if x.get("eventParticipantId") == ja), act[0] if act else None)
            a = next((x for x in act if x.get("eventParticipantId") == jb), act[1] if len(act) > 1 else None)
            if h and a:
                b["ml"] = {"home": float(h["value"]), "away": float(a["value"]), "home0": float(h.get("opening") or 0) or None, "away0": float(a.get("opening") or 0) or None}
        elif bt == "OVER_UNDER" and sc == "FULL_TIME_OVER_TIME":
            lines = {}
            for x in act:
                ln = (x.get("handicap") or {}).get("value")
                if ln is not None:
                    lines.setdefault(ln, {})[(x.get("selection") or "").lower()] = float(x["value"])
            b["total"] = sorted([{"line": float(k), **v} for k, v in lines.items() if "over" in v and "under" in v], key=lambda x: x["line"])
        elif bt == "ASIAN_HANDICAP" and sc == "FULL_TIME_OVER_TIME":
            lines = {}
            for x in act:
                ln = (x.get("handicap") or {}).get("value")
                if ln is None:
                    continue
                who = "home" if x.get("eventParticipantId") == ja else "away" if x.get("eventParticipantId") == jb else None
                if who:
                    key = float(ln) if who == "home" else -float(ln)
                    lines.setdefault(key, {})[who] = float(x["value"])
            b["spread"] = sorted([{"line": k, **v} for k, v in lines.items() if "home" in v and "away" in v], key=lambda x: abs((1 / x["home"]) - (1 / x["away"])))
    return {"books": [b for b in books.values() if b.get("ml") or b["spread"] or b["total"]]}


def odds_many(spec):
    """Odds for many games at once (the game list): spec is "id:ja:jb,id:ja:jb". Returns each game's books."""
    from concurrent.futures import ThreadPoolExecutor
    items = []
    for part in spec.split(",")[:80]:
        bits = (part.split(":") + ["", ""])[:3]
        if all(re.fullmatch(r"[A-Za-z0-9]{0,12}", x) for x in bits) and bits[0]:
            items.append(bits)
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda it: odds(*it), items))
    return {it[0]: r for it, r in zip(items, res)}


def game(eid, ja="", jb=""):
    def safe(f, *a):
        try:
            return f(*a)
        except Exception:
            return None
    q, info = safe(lambda: summary(feed(f"df_sui_1_{eid}", 30))) or ([], {})
    return {"id": eid, "quarters": q, "info": info, "stats": safe(lambda: team_stats(feed(f"df_st_1_{eid}", 30))) or [],
            "box": safe(lambda: box_score(feed(f"df_psn_1_{eid}", 30))) or [], "h2h": safe(lambda: h2h(feed(f"df_hh_1_{eid}", 3600))) or [],
            "odds": safe(odds, eid, ja, jb) or {"books": []}}


def _env(page, var):
    j = page.find(var + " = ")
    if j < 0:
        return None
    try:
        return json.JSONDecoder().raw_decode(page[j + len(var) + 3:])[0]
    except Exception:
        return None


def _text(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def team_events(tid, tz=0):
    """Every recent and upcoming game of a team (all competitions). League names in this feed are placeholders
    like {EL-TC-186253}, resolved by the team's profile feed."""
    names = {}
    for page in (0, 1):   # page 0 names the competitions, page 1 the opponents
        try:
            for m in re.finditer(r"LV÷(\{[A-Z]+-[A-Z]+-\d+\})_([^¬]*)", feed(f"pl_{tz}_{tid}_{page}", 3600)):
                names[m.group(1)] = m.group(2)
        except Exception:
            pass
    text = re.sub(r"\{[A-Z]+-[A-Z]+-\d+\}", lambda m: names.get(m.group(0), ""), feed(f"pe_1_{tz}_{tid}_x", 120))
    out = []
    cur, lname = None, ""
    for r in records(text):
        if "ZA" in r:
            cur, lname = league_of(r["ZA"], r.get("ZL")), r["ZA"].split(": ", 1)[-1]
        elif "AA" in r:
            e = event(r, cur)
            e["lgName"] = lname
            out.append(e)
    return out


def team(tid, slug):
    base = f"{SITE}/team/{slug}/{tid}/"
    sq = _get(base + "squad/", 3600)
    name = re.search(r'<div class="heading__name">([^<]+)', sq)
    logo = re.search(r'<img[^>]+class="[^"]*heading__logo[^"]*"[^>]+src="([^"]+)"|heading__logo[^>]*style="background-image: url\(([^)]+)\)', sq)
    venue = re.search(r'Stadium:</span>\s*([^<]+)<span>\(([^)]*)\)', sq)
    roster = []
    for row in re.split(r'<div class="lineupTable__row">', sq)[1:]:
        a = re.search(r'href="/player/([^/]+)/([^/]+)/"[^>]*>\s*([^<]+?)\s*</a>', row)
        if not a:
            continue
        jersey = re.search(r'lineupTable__cell--jersey">\s*([^<]*?)\s*<', row)
        age = re.search(r'lineupTable__cell--age">\s*([^<]*?)\s*<', row)
        flag = re.search(r'flag fl_\d+" title="([^"]+)"', row)
        out = re.search(r'title="([^"]*(?:Injur|Out|Absen|Suspen)[^"]*)"', row)
        roster.append({"slug": a.group(1), "id": a.group(2), "name": a.group(3), "jersey": jersey.group(1) if jersey else "", "age": age.group(1) if age else "",
                       "country": flag.group(1) if flag else "", "out": out.group(1) if out else ""})
    try:
        evs = team_events(tid)
    except Exception:
        evs = []
    seen = []
    for e in evs:
        if e["lg"] and e["lg"] not in seen:
            seen.append(e["lg"])
    return {"id": tid, "slug": slug, "name": _text(name.group(1)) if name else slug.replace("-", " ").title(),
            "logo": (logo.group(1) or logo.group(2)) if logo else "", "venue": _text(venue.group(1)) if venue else "", "city": venue.group(2) if venue else "",
            "roster": roster, "results": sorted([e for e in evs if e["state"] == "post"], key=lambda e: -e["ts"]),
            "fixtures": sorted([e for e in evs if e["state"] != "post"], key=lambda e: e["ts"]), "leagues": seen}


def player(pid, slug):
    page = _get(f"{SITE}/player/{slug}/{pid}/", 3600)
    env = _env(page, "window.playerProfilePageEnvironment") or {}
    i = page.find("playerHeader__wrapper")
    head = page[i:i + 6000] if i >= 0 else ""
    imgs = re.findall(r'<img[^>]+src="(https://static\.flashscore\.com/res/image/data/[^"]+)"[^>]*alt="([^"]*)"', page[max(0, i - 3000):i + 6000])
    name = re.search(r'<h2[^>]*>([^<]+)</h2>', head) or re.search(r'<title>([^<(|-]+)', page)
    t = _text(head)
    pos = re.search(r'class="playerTeam"><span[^>]*>([^<]+)<', head)
    age = re.search(r"Age\s*:\s*(\d+)\s*\(([\d.]+)\)", t)
    height = re.search(r"Height\s*:\s*([\d.]+ ?cm)", t)
    weight = re.search(r"Weight\s*:\s*([\d.]+ ?kg)", t)
    flag = re.search(r'data-testid="wcl-flagImage"[^>]*src="/res/image/country_flags/(\w+)\.png"', page[max(0, i - 3000):i + 6000])
    tm = re.search(r'href="/team/([^/]+)/([^/]+)/"', head)
    career = []
    for tab in env.get("careerTables") or []:
        for s in tab.get("seasons") or []:
            if not s.get("season_name"):
                continue
            career.append({"type": tab.get("table_id"), "season": s.get("season_name"), "comp": s.get("tournament_name"), "compUrl": s.get("tournament_url", ""),
                           "team": s.get("team_name"), "teamId": (s.get("url", "").strip("/").split("/") + ["", "", ""])[2], "teamSlug": (s.get("url", "").strip("/").split("/") + ["", ""])[1],
                           "logo": s.get("logo", ""), "gp": s.get("matches_played"), "min": s.get("minutes_played"), "pts": s.get("points"), "reb": s.get("rebounds"),
                           "ast": s.get("assists"), "stl": s.get("steals"), "blk": s.get("blocks")})
    last = []
    for m in (env.get("lastMatchesData") or {}).get("lastMatches") or []:
        st = {v.get("type"): v.get("value") for v in (m.get("stats") or {}).values()}
        last.append({"id": m.get("eventEncodedId"), "date": m.get("eventStartTime"), "home": m.get("homeParticipantName"), "away": m.get("awayParticipantName"),
                     "hs": m.get("homeScore"), "as": m.get("awayScore"), "homeWin": m.get("homeWin"), "awayWin": m.get("awayWin"),
                     "hlogo": img(m.get("homeParticipantLogoUrl")), "alogo": img(m.get("awayParticipantLogoUrl")),
                     "lg": m.get("tournamentTitle") or m.get("tournamentName") or "", "absent": m.get("absenceTypeText") or "", "stats": st})
    photo = next((u for u, alt in imgs if name and alt.strip() == _text(name.group(1))), "")
    if "nophoto" in photo or "no-photo" in photo:
        photo = ""
    return {"id": pid, "slug": slug, "name": _text(name.group(1)) if name else slug.replace("-", " ").title(), "photo": photo,
            "position": pos.group(1).strip() if pos else "", "age": age.group(1) if age else "", "born": age.group(2) if age else "",
            "height": height.group(1) if height else "", "weight": weight.group(1) if weight else "", "flag": flag.group(1) if flag else "",
            "teamSlug": tm.group(1) if tm else "", "teamId": tm.group(2) if tm else "",
            "teamName": next((alt for u, alt in imgs if name and alt.strip() != _text(name.group(1))), ""),
            "career": career, "last": last}


def _norm(s):
    s = re.sub(r"[^a-z0-9 ]", "", (s or "").lower())
    return re.sub(r"\b(the|bc|kk|fc|cb|club|basket|basketball)\b", "", s).strip()


def find(date, home, away, tz=0):
    """Match an ESPN game (date YYYYMMDD in the viewer's time zone, team names) to a Flashscore event."""
    try:
        d = datetime.date(int(date[:4]), int(date[4:6]), int(date[6:8]))
    except ValueError:
        return {}
    off = (d - datetime.date.today()).days
    if abs(off) > 7:
        return {}
    h, a = _norm(home), _norm(away)
    best = None
    for o in {off, off - 1, off + 1} & set(range(-7, 8)):
        for evs in day(o, tz)["games"].values():
            for e in evs:
                hh, aa = _norm(e["home"]["full"]), _norm(e["away"]["full"])
                score = sum(1 for x, y in ((h, hh), (a, aa)) if x and y and (x in y or y in x or x.split()[-1] == y.split()[-1]))
                if score == 2 and (best is None or o == off):
                    best = e
    return best or {}


def search(q):
    if len(q) < 2:
        return {"teams": [], "players": []}
    url = SEARCH + "?" + urllib.parse.urlencode({"q": q, "lang-id": 1, "type-ids": "2,3,4", "project-type-id": 1, "project-id": 2, "sport-ids": 3})
    try:
        rows = _get(url, 3600, as_json=True)
    except Exception:
        return {"teams": [], "players": []}
    teams, players = [], []
    for r in rows or []:
        pic = img(next((i["path"] for i in r.get("images") or []), ""))
        item = {"id": r.get("id"), "slug": r.get("url"), "name": r.get("name"), "img": pic, "country": (r.get("defaultCountry") or {}).get("name", ""),
                "team": ((r.get("teams") or [{}])[0] or {}).get("name", "")}
        ptype = [x.get("name") for x in r.get("participantTypes") or []]
        if (r.get("type") or {}).get("id") == 1:
            continue
        (players if "Player" in ptype or (r.get("type") or {}).get("id") in (3, 4) else teams).append(item)
    return {"teams": teams[:8], "players": players[:10]}


# ---------- league-wide player stats, built from every finished game's box score ----------
BOX_DIR = None
_leaders = {}
_leaders_lock = threading.Lock()
STAT_KEYS = ["PTS", "REB", "AST", "ST", "BS", "TO", "PF", "OR", "DR", "FGM", "FGA", "2PM", "2PA", "3PM", "3PA", "FTM", "FTA", "+/-"]


def _box_cached(eid):
    """A finished game's box score never changes, so it is kept on disk."""
    global BOX_DIR
    if BOX_DIR is None:
        from pathlib import Path
        BOX_DIR = Path(__file__).resolve().parent / ".floodlight-cache" / "bb-box"
        BOX_DIR.mkdir(parents=True, exist_ok=True)
    f = BOX_DIR / f"{eid}.json"
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    tabs = box_score(feed(f"df_psn_1_{eid}", 3600))
    tab = next((t for t in tabs if t["name"] == "Overall"), tabs[0] if tabs else None)
    players = tab["players"] if tab else []
    f.write_text(json.dumps(players))
    return players


def _minutes(x):
    try:
        m, s = (str(x).split(":") + ["0"])[:2]
        return int(m) + int(s) / 60
    except ValueError:
        return 0.0


def leaders(key):
    """Every player's season totals and per-game averages in a Flashscore league, from its finished games."""
    with _leaders_lock:
        hit = _leaders.get(key)
        if hit and time.time() - hit["at"] < 900:
            return hit["data"]
    L = league(key)
    games = [e for e in L.get("results", []) if e["state"] == "post"]
    from concurrent.futures import ThreadPoolExecutor

    def one(e):
        try:
            return e, _box_cached(e["id"])
        except Exception:
            return e, None
    with ThreadPoolExecutor(8) as ex:
        boxes = list(ex.map(one, games))
    abbr_team = {}
    for e in games:
        for side in ("home", "away"):
            t = e[side]
            abbr_team.setdefault((e["id"], (t["abbr"] or "").upper()), t)
    players, used = {}, 0
    for e, box in boxes:
        if not box:
            continue
        used += 1
        for p in box:
            mins = _minutes(p["stats"].get("MIN"))
            if not p.get("id") or mins <= 0:
                continue
            t = abbr_team.get((e["id"], (p.get("team") or "").upper())) or {}
            r = players.setdefault(p["id"], {"id": p["id"], "slug": p["slug"], "name": p["name"], "country": p.get("country", ""), "gp": 0, "min": 0.0,
                                             "tot": {k: 0 for k in STAT_KEYS}, "team": "", "teamId": "", "teamLogo": "", "last": 0})
            r["gp"] += 1
            r["min"] += mins
            line = {}
            for k in STAT_KEYS:
                try:
                    line[k] = int(p["stats"].get(k) or 0)
                except ValueError:
                    line[k] = 0
            for m, a in (("FGM", "FGA"), ("2PM", "2PA"), ("3PM", "3PA"), ("FTM", "FTA")):
                if line[m] > line[a]:   # some feeds leave out or shift a column; drop that pair rather than count it wrong
                    line[m] = line[a] = 0
            for k in STAT_KEYS:
                r["tot"][k] += line[k]
            if e["ts"] >= r["last"]:   # the team of the player's latest game
                r["last"], r["team"], r["teamId"], r["teamLogo"] = e["ts"], t.get("name", ""), t.get("id", ""), t.get("logo", "")
    out = []
    for r in players.values():
        g, T = r["gp"], r["tot"]
        if not T["FGM"] and (T["2PM"] or T["3PM"]):
            T["FGM"], T["FGA"] = T["2PM"] + T["3PM"], T["2PA"] + T["3PA"]
        reb = T["REB"] or T["OR"] + T["DR"]
        avg = {"PTS": T["PTS"] / g, "REB": reb / g, "AST": T["AST"] / g, "STL": T["ST"] / g, "BLK": T["BS"] / g, "TO": T["TO"] / g, "PF": T["PF"] / g,
               "OREB": T["OR"] / g, "DREB": T["DR"] / g, "3PM": T["3PM"] / g, "FGA": T["FGA"] / g, "FTA": T["FTA"] / g, "MIN": r["min"] / g, "PM": T["+/-"] / g,
               "FG%": 100 * T["FGM"] / T["FGA"] if T["FGA"] else None, "3P%": 100 * T["3PM"] / T["3PA"] if T["3PA"] else None,
               "FT%": 100 * T["FTM"] / T["FTA"] if T["FTA"] else None,
               "TS%": 100 * T["PTS"] / (2 * (T["FGA"] + .44 * T["FTA"])) if T["FGA"] + T["FTA"] else None,
               "EFF": (T["PTS"] + reb + T["AST"] + T["ST"] + T["BS"] - (T["FGA"] - T["FGM"]) - (T["FTA"] - T["FTM"]) - T["TO"]) / g}
        out.append({k: r[k] for k in ("id", "slug", "name", "country", "gp", "team", "teamId", "teamLogo")} |
                   {"avg": {k: (round(v, 2) if v is not None else None) for k, v in avg.items()}, "tot": {**T, "REB": reb, "MIN": round(r["min"])}})
    data = {"key": key, "name": L.get("name"), "season": L.get("season"), "games": used, "listed": len(games), "players": out}
    with _leaders_lock:
        _leaders[key] = {"at": time.time(), "data": data}
    return data


def handle(path, q):
    """Returns (status, payload, max_age) for an /api/bb/ request."""
    ok_id = lambda s: bool(re.fullmatch(r"[A-Za-z0-9]{6,12}", s or ""))
    ok_slug = lambda s: bool(re.fullmatch(r"[a-z0-9-]{1,80}", s or ""))
    if path == "day":
        return 200, day(q.get("off", "0"), q.get("tz", "0")), 15
    if path == "league":
        return 200, league(q.get("key", "")), 120
    if path == "game":
        if not ok_id(q.get("id")):
            return 400, {"error": "bad id"}, 0
        return 200, game(q["id"], q.get("ja", "") if ok_id(q.get("ja")) else "", q.get("jb", "") if ok_id(q.get("jb")) else ""), 15
    if path == "team":
        if not ok_id(q.get("id")) or not ok_slug(q.get("slug")):
            return 400, {"error": "bad team"}, 0
        return 200, team(q["id"], q["slug"]), 300
    if path == "player":
        if not ok_id(q.get("id")) or not ok_slug(q.get("slug")):
            return 400, {"error": "bad player"}, 0
        return 200, player(q["id"], q["slug"]), 600
    if path == "find":
        if not re.fullmatch(r"\d{8}", q.get("date", "")):
            return 400, {"error": "bad date"}, 0
        return 200, find(q["date"], q.get("home", "")[:60], q.get("away", "")[:60], int(q.get("tz", "0") or 0)), 300
    if path == "leaders":
        if q.get("key") not in LEAGUES:
            return 400, {"error": "bad league"}, 0
        return 200, leaders(q["key"]), 300
    if path == "odds":
        return 200, odds_many(q.get("ids", "")), 30
    if path == "search":
        return 200, search(q.get("q", "")[:60]), 3600
    return 404, {"error": "not found"}, 0
