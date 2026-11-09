"""Floodlight hockey data.

ESPN covers the NHL and NCAA men's and women's hockey with full stats, and the page reads it directly. This module adds:

  Flashscore (needs a request header a browser page can't send), for every other league:
  /api/hk/day?off=0&tz=3          games for one day across the covered leagues (and NHL twins for bookmaker odds)
  /api/hk/league?key=khl          standings, results and fixtures
  /api/hk/game?id=&ja=&jb=        period scores, team stats, head to head and bookmaker odds
  /api/hk/odds?ids=id:ja:jb,...   bookmaker odds for many games at once
  /api/hk/team?id=&slug=          roster, results and fixtures
  /api/hk/player?id=&slug=        photo, bio, season stats by competition and recent games
  /api/hk/find?date=&home=&away=  the Flashscore id of a game known from ESPN
  /api/hk/search?q=               teams and players

  The NHL's own stats API (no CORS headers, so the page can't call it directly):
  /api/hk/nhl?u=stats/rest/en/skater/summary&q=<query>   skater, goalie and team tables (api.nhle.com)
  /api/hk/nhl?u=web/v1/player/8478402/landing            player pages, game logs, leaders (api-web.nhle.com)

The Flashscore feed format, parsing helpers and odds come from basketball.py; only the sport id and leagues differ.
"""
import datetime
import re
import urllib.parse

import basketball as fs

SPORT = 4   # Flashscore's id for ice hockey
SEARCH = fs.SEARCH

# league key -> Flashscore page path and a pattern for the "COUNTRY: League" heading in the day feed
LEAGUES = {
    "nhl": ("/hockey/usa/nhl/", r"^USA: NHL"),
    "ahl": ("/hockey/usa/ahl/", r"^USA: AHL"),
    "echl": ("/hockey/usa/echl/", r"^USA: ECHL"),
    "pwhl": ("/hockey/usa/pwhl-women/", r"^(USA|CANADA|NORTH AMERICA|WORLD): PWHL"),
    "ohl": ("/hockey/canada/ohl/", r"^CANADA: OHL"),
    "whl": ("/hockey/canada/whl/", r"^CANADA: WHL"),
    "qmjhl": ("/hockey/canada/qmjhl/", r"^CANADA: (QMJHL|LHJMQ)"),
    "khl": ("/hockey/russia/khl/", r"^RUSSIA: KHL"),
    "shl": ("/hockey/sweden/shl/", r"^SWEDEN: SHL"),
    "allsv": ("/hockey/sweden/hockeyallsvenskan/", r"^SWEDEN: (Hockey)?Allsvenskan"),
    "liiga": ("/hockey/finland/liiga/", r"^FINLAND: Liiga"),
    "del": ("/hockey/germany/del/", r"^GERMANY: DEL(?! ?2)"),
    "nla": ("/hockey/switzerland/national-league/", r"^SWITZERLAND: National League"),
    "czech": ("/hockey/czech-republic/extraliga/", r"^CZECH REPUBLIC: (Extraliga|Tipsport extraliga)"),
    "slovak": ("/hockey/slovakia/extraliga/", r"^SLOVAKIA: (Extraliga|Tipos extraliga)"),
    "icehl": ("/hockey/austria/ice-hockey-league/", r"^AUSTRIA: (ICE Hockey League|ICEHL|win2day ICE)"),
    "norway": ("/hockey/norway/eliteserien/", r"^NORWAY: (Eliteserien|EHL)"),
    "denmark": ("/hockey/denmark/metal-ligaen/", r"^DENMARK: Metal Ligaen"),
    "magnus": ("/hockey/france/ligue-magnus/", r"^FRANCE: (Ligue Magnus|Synerglace)"),
    "eihl": ("/hockey/united-kingdom/elite-league/", r"^(UNITED KINGDOM|GREAT BRITAIN): Elite League"),
    "poland": ("/hockey/poland/polska-hokej-liga/", r"^POLAND: Polska Hokej Liga"),
    "chl": ("/hockey/europe/champions-hockey-league/", r"^EUROPE: Champions (Hockey )?League"),
    "spengler": ("/hockey/world/spengler-cup/", r"^(WORLD|EUROPE|SWITZERLAND): Spengler Cup"),
    "wch": ("/hockey/world/world-championship/", r"^WORLD: World Championship(?! (U|Women|Div))"),
    "wjc": ("/hockey/world/world-championship-u20/", r"^WORLD: World Championship U20(?! Div)"),
    "olympics": ("/hockey/world/olympic-games/", r"^WORLD: Olympic Games(?! Women)"),
}
_paths = {}

LIVE = {"14": "1st", "15": "2nd", "16": "3rd", "46": "Break", "6": "OT", "7": "Shootout", "38": "Break"}


def detail_of(ab, ac):
    if ab == "3":
        return "Final/OT" if ac == "10" else "Final/SO" if ac == "11" else "Final"
    if ab == "2":
        return LIVE.get(ac, "Live")
    return {"4": "Postponed", "5": "Cancelled", "9": "Walkover", "8": "Abandoned", "36": "Interrupted", "37": "Abandoned"}.get(ac, "")


def event(r, league=None):
    e = fs.event(r, league)
    e["detail"] = detail_of(r.get("AB"), r.get("AC"))
    e["ot"] = r.get("AC") in ("10", "11")
    return e


def league_of(heading, path):
    for k, (p, pat) in LEAGUES.items():
        if re.search(pat, heading or "") or (path and path.rstrip("/") == p.rstrip("/")):
            if re.search(r"Women", heading or "") and k != "pwhl":
                continue
            return k
    return None


def parse_list(text, only=None):
    out, cur, meta = {}, None, {}
    for r in fs.records(text):
        if "ZA" in r:
            cur = league_of(r["ZA"], r.get("ZL"))
            if cur and r.get("ZL") and cur != "nhl":
                _paths[cur] = r["ZL"]
            if cur:
                meta[cur] = {"name": r["ZA"].split(": ", 1)[-1], "area": r.get("ZY", ""), "logo": fs.img(r.get("OAJ")), "tid": r.get("ZEE"), "stage": r.get("ZC"), "path": r.get("ZL")}
        elif "AA" in r and cur and (not only or cur == only):
            out.setdefault(cur, []).append(event(r, cur))
    return out, meta


def day(off, tz):
    off, tz = max(-7, min(7, int(off))), max(-12, min(14, int(tz)))
    games, meta = parse_list(fs.feed(f"f_{SPORT}_{off}_{tz}_en_1", 20 if off == 0 else 300))
    return {"games": games, "meta": meta}


def standings(tid, stage, ttl=300):
    """Hockey tables: wins, overtime wins and losses, losses, goals and points (keys vary a little by league)."""
    if not tid or not stage:
        return []
    try:
        text = fs.feed(f"to_{tid}_{stage}_1", ttl)
    except Exception:
        return []
    groups, cur, names = [], None, []
    for r in fs.records(text):
        if "TZ" in r or "TZS" in r:
            continue
        if r.get("TE"):
            names.append(r["TE"])
        if "TN" in r:
            if cur is None or (r.get("TR") == "1" and cur["rows"]):
                cur = {"name": names[len(groups)] if len(groups) < len(names) else "", "rows": []}
                groups.append(cur)
            gf, ga = (r.get("TG", "0:0").split(":") + ["0"])[:2]
            n = lambda k: fs.num(r.get(k)) or 0
            cur["rows"].append({"rank": fs.num(r.get("TR")), "id": r.get("TI"), "name": r["TN"],
                                "slug": (r.get("TIU", "").strip("/").split("/") + [""])[1] if r.get("TIU") else "",
                                "gp": n("TM"), "w": n("TW"), "otw": n("TWO") or n("TWOT"), "otl": n("TLO") or n("TLOT"), "l": n("TL"), "d": n("TD"),
                                "gf": fs.num(gf) or 0, "ga": fs.num(ga) or 0, "pts": n("TP"), "zone": r.get("TU", ""), "zoneColor": r.get("TUC", ""), "form": []})
        elif "LMU" in r and cur and cur["rows"] and r.get("LMU") in ("w", "l", "d", "wo", "lo"):
            cur["rows"][-1]["form"].append({"w": "W", "l": "L", "d": "D", "wo": "W", "lo": "L"}[r["LMU"]])
    seen, out = set(), []
    for g in groups:
        key = tuple(x["id"] for x in g["rows"])
        if key in seen or not g["rows"]:
            continue
        seen.add(key)
        out.append(g)
    if len(out) > 1:
        for i, g in enumerate(out):
            g["name"] = g["name"] or f"Group {i + 1}"
    return out


def league(key):
    if key not in LEAGUES:
        return {"error": "unknown league"}
    path = _paths.get(key) or LEAGUES[key][0]
    res = fs._get(fs.SITE + path + "results/", 300)
    try:
        fix = fs._get(fs.SITE + path + "fixtures/", 600)
    except OSError:
        fix = ""
    results, meta = parse_list(fs._initial(res, "results"))
    fixtures, meta2 = parse_list(fs._initial(fix, "fixtures"))
    m = {**meta2, **meta}
    lm = m.get(key) or next(iter(m.values()), {})
    tid = re.search(r'tournament_id\s*=\s*"(\w+)"', res)
    stage = re.search(r'"tournamentStage"\s*:\s*"(\w+)"', res)
    season = re.search(r"<title>[^<]*?(\d{4}(?:/\d{4})?)", res)
    flat = lambda d: [e for v in d.values() for e in v]
    return {"key": key, "name": lm.get("name", key), "area": lm.get("area", ""), "logo": lm.get("logo", ""), "season": season.group(1) if season else "",
            "standings": standings(tid.group(1) if tid else lm.get("tid"), stage.group(1) if stage else lm.get("stage")),
            "results": sorted(flat(results), key=lambda e: -e["ts"]), "fixtures": sorted(flat(fixtures), key=lambda e: e["ts"])}


def game(eid, ja="", jb=""):
    def safe(f, *a):
        try:
            return f(*a)
        except Exception:
            return None
    q, info = safe(lambda: fs.summary(fs.feed(f"df_sui_1_{eid}", 30))) or ([], {})
    return {"id": eid, "periods": q, "info": info, "stats": safe(lambda: fs.team_stats(fs.feed(f"df_st_1_{eid}", 30))) or [],
            "box": safe(lambda: fs.box_score(fs.feed(f"df_psn_1_{eid}", 30))) or [], "h2h": safe(lambda: fs.h2h(fs.feed(f"df_hh_1_{eid}", 3600))) or [],
            "odds": safe(fs.odds, eid, ja, jb) or {"books": []}}


def team_events(tid, tz=0):
    names = {}
    for page in (0, 1):
        try:
            for m in re.finditer(r"LV÷(\{[A-Z]+-[A-Z]+-\d+\})_([^¬]*)", fs.feed(f"pl_{tz}_{tid}_{page}", 3600)):
                names[m.group(1)] = m.group(2)
        except Exception:
            pass
    text = re.sub(r"\{[A-Z]+-[A-Z]+-\d+\}", lambda m: names.get(m.group(0), ""), fs.feed(f"pe_1_{tz}_{tid}_x", 120))
    out, cur, lname = [], None, ""
    for r in fs.records(text):
        if "ZA" in r:
            cur, lname = league_of(r["ZA"], r.get("ZL")), r["ZA"].split(": ", 1)[-1]
        elif "AA" in r:
            e = event(r, cur)
            e["lgName"] = lname
            out.append(e)
    return out


def team(tid, slug):
    sq = fs._get(f"{fs.SITE}/team/{slug}/{tid}/squad/", 3600)
    name = re.search(r'<div class="heading__name">([^<]+)', sq)
    logo = re.search(r'<img[^>]+class="[^"]*heading__logo[^"]*"[^>]+src="([^"]+)"|heading__logo[^>]*style="background-image: url\(([^)]+)\)', sq)
    venue = re.search(r'(?:Stadium|Arena):</span>\s*([^<]+)<span>\(([^)]*)\)', sq)
    roster, group = [], ""
    for chunk in re.split(r'(<div class="lineupTable__title">[^<]*</div>|<div class="lineupTable__row">)', sq)[1:]:
        t = re.match(r'<div class="lineupTable__title">([^<]*)</div>', chunk)
        if t:
            group = fs._text(t.group(1))
            continue
        a = re.search(r'href="/player/([^/]+)/([^/]+)/"[^>]*>\s*([^<]+?)\s*</a>', chunk)
        if not a:
            continue
        jersey = re.search(r'lineupTable__cell--jersey">\s*([^<]*?)\s*<', chunk)
        age = re.search(r'lineupTable__cell--age">\s*([^<]*?)\s*<', chunk)
        flag = re.search(r'flag fl_\d+" title="([^"]+)"', chunk)
        out = re.search(r'title="([^"]*(?:Injur|Out|Absen|Suspen)[^"]*)"', chunk)
        roster.append({"slug": a.group(1), "id": a.group(2), "name": a.group(3), "group": group, "jersey": jersey.group(1) if jersey else "",
                       "age": age.group(1) if age else "", "country": flag.group(1) if flag else "", "out": out.group(1) if out else ""})
    try:
        evs = team_events(tid)
    except Exception:
        evs = []
    seen = []
    for e in evs:
        if e["lg"] and e["lg"] not in seen:
            seen.append(e["lg"])
    return {"id": tid, "slug": slug, "name": fs._text(name.group(1)) if name else slug.replace("-", " ").title(),
            "logo": (logo.group(1) or logo.group(2)) if logo else "", "venue": fs._text(venue.group(1)) if venue else "", "city": venue.group(2) if venue else "",
            "roster": roster, "results": sorted([e for e in evs if e["state"] == "post"], key=lambda e: -e["ts"]),
            "fixtures": sorted([e for e in evs if e["state"] != "post"], key=lambda e: e["ts"]), "leagues": seen}


def player(pid, slug):
    """Like basketball.player, but keeps every stat column the career table has (goals, assists, points, saves...)."""
    p = fs.player(pid, slug)
    page = fs._get(f"{fs.SITE}/player/{slug}/{pid}/", 3600)
    env = fs._env(page, "window.playerProfilePageEnvironment") or {}
    career = []
    for tab in env.get("careerTables") or []:
        for s in tab.get("seasons") or []:
            if not s.get("season_name"):
                continue
            url = (s.get("url", "").strip("/").split("/") + ["", "", ""])
            stats = {k: v for k, v in s.items() if isinstance(v, (int, float, str)) and k not in ("season_name", "tournament_name", "tournament_url", "team_name", "url", "logo", "season_id", "team_id", "tournament_id")}
            career.append({"type": tab.get("table_id"), "season": s.get("season_name"), "comp": s.get("tournament_name"), "team": s.get("team_name"),
                           "teamId": url[2], "teamSlug": url[1], "logo": s.get("logo", ""), "stats": stats})
    p["career"] = career
    return p


def find(date, home, away, tz=0):
    try:
        d = datetime.date(int(date[:4]), int(date[4:6]), int(date[6:8]))
    except ValueError:
        return {}
    off = (d - datetime.date.today()).days
    if abs(off) > 7:
        return {}
    norm = lambda s: re.sub(r"\b(the|hc|hk|ec|ehc|sc|club|hockey)\b", "", re.sub(r"[^a-z0-9 ]", "", (s or "").lower())).strip()
    h, a = norm(home), norm(away)
    best = None
    for o in {off, off - 1, off + 1} & set(range(-7, 8)):
        for evs in day(o, tz)["games"].values():
            for e in evs:
                hh, aa = norm(e["home"]["full"]), norm(e["away"]["full"])
                score = sum(1 for x, y in ((h, hh), (a, aa)) if x and y and (x in y or y in x or x.split()[-1] == y.split()[-1]))
                if score == 2 and (best is None or o == off):
                    best = e
    return best or {}


def search(q):
    if len(q) < 2:
        return {"teams": [], "players": []}
    url = SEARCH + "?" + urllib.parse.urlencode({"q": q, "lang-id": 1, "type-ids": "2,3,4", "project-type-id": 1, "project-id": 2, "sport-ids": SPORT})
    try:
        rows = fs._get(url, 3600, as_json=True)
    except Exception:
        return {"teams": [], "players": []}
    teams, players = [], []
    for r in rows or []:
        if (r.get("type") or {}).get("id") == 1:
            continue
        pic = fs.img(next((i["path"] for i in r.get("images") or []), ""))
        item = {"id": r.get("id"), "slug": r.get("url"), "name": r.get("name"), "img": pic, "country": (r.get("defaultCountry") or {}).get("name", ""),
                "team": ((r.get("teams") or [{}])[0] or {}).get("name", "")}
        ptype = [x.get("name") for x in r.get("participantTypes") or []]
        (players if "Player" in ptype or (r.get("type") or {}).get("id") in (3, 4) else teams).append(item)
    return {"teams": teams[:8], "players": players[:10]}


NHL_HOSTS = {"web/": "https://api-web.nhle.com/", "stats/": "https://api.nhle.com/stats/"}
NHL_OK = re.compile(r"(web/v1/[A-Za-z0-9/_.-]{1,120}|stats/rest/en/(skater|goalie|team)/[a-zA-Z]{1,30})")


def nhl(u, query):
    """Read-only pass-through to the NHL's public stats APIs, for the paths above."""
    if not NHL_OK.fullmatch(u or "") or ".." in u or len(query or "") > 600 or re.search(r"[\r\n]", query or ""):
        return 400, {"error": "not allowed"}, 0
    host = next(h for p, h in NHL_HOSTS.items() if u.startswith(p))
    qs = urllib.parse.urlencode(urllib.parse.parse_qsl(query or ""), quote_via=urllib.parse.quote)
    url = host + u.split("/", 1)[1] + ("?" + qs if qs else "")
    ttl = 30 if "/score" in u or "/gamecenter/" in u else 600
    return 200, fs._get(url, ttl, {"Accept": "application/json", "Referer": "https://www.nhl.com/", "Origin": "https://www.nhl.com"}, as_json=True), min(ttl, 120)


def handle(path, q):
    """Returns (status, payload, max_age) for an /api/hk/ request."""
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
    if path == "odds":
        return 200, fs.odds_many(q.get("ids", "")), 30
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
    if path == "search":
        return 200, search(q.get("q", "")[:60]), 3600
    if path == "nhl":
        return nhl(q.get("u", ""), q.get("q", ""))
    return 404, {"error": "not found"}, 0
