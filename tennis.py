"""Floodlight tennis data.

Flashscore covers every level of the game, so it is the main source: ATP, WTA, the Grand Slams, the ATP and WTA Finals,
ATP Challengers, WTA 125s, the ITF men's and women's tours, doubles, exhibitions and team events. Its feeds need a request
header a browser page can't send, so the server reads them (the feed format and odds come from basketball.py):

  /api/tn/day?off=0&tz=3            matches for one day, grouped by tournament, with live points and server
  /api/tn/match?id=&ja=&jb=         set scores and times, serve/return stats by set, point by point, head to head
                                    (overall and by surface, with each player's recent form) and bookmaker odds
  /api/tn/odds?ids=id:ja:jb,...     bookmaker odds for many matches at once
  /api/tn/player?id=&slug=          bio, ranking, injury, match log (singles and doubles), and full stats built from
                                    the player's recent matches: serve, return, under pressure, surface splits,
                                    tiebreaks, deciding sets, by level and by round, titles and finals
  /api/tn/ranks?ids=a,b,c           world ranking of many players at once (for predictions below the top 150)
  /api/tn/tournament?path=          results and upcoming matches of one tournament
  /api/tn/search?q=                 players

ESPN's ATP and WTA rankings (points, movement, photos) are public, and the page reads them directly.
"""
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import basketball as fs

SPORT = 2   # Flashscore's id for tennis
SLAMS = ("Australian Open", "French Open", "Wimbledon", "US Open")

# level of a tournament from the first part of its "TOUR - DISCIPLINE: Name (Country), surface" heading
LEVELS = [
    (r"^ATP\b", "atp"), (r"^WTA\b", "wta"), (r"^CHALLENGER MEN", "chm"), (r"^CHALLENGER WOMEN", "chw"),
    (r"^ITF MEN", "itfm"), (r"^ITF WOMEN", "itfw"),
]
STATUS = {"3": "Finished", "4": "Postponed", "5": "Cancelled", "8": "Retired", "9": "Walkover", "36": "Interrupted", "37": "Abandoned",
          "54": "Awarded", "17": "Set 1", "18": "Set 2", "19": "Set 3", "20": "Set 4", "21": "Set 5", "46": "Break", "47": "Set 1 tiebreak", "12": "Live"}
SETS = [("BA", "BB", "DA", "DB"), ("BC", "BD", "DC", "DD"), ("BE", "BF", "DE", "DF"), ("BG", "BH", "DG", "DH"), ("BI", "BJ", "DI", "DJ")]


def num(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def parse_heading(za, zl=""):
    """'ATP - SINGLES: Paris (France), hard (indoor)' -> level, discipline, name, country, surface, indoor"""
    tour, _, rest = (za or "").partition(": ")
    level = next((k for pat, k in LEVELS if re.search(pat, tour)), "other")
    disc = "D" if "DOUBLES" in tour else "X" if "MIXED" in tour else "S"
    head, surf = rest, ""
    m = re.match(r"^(.*), ((?:hard|clay|grass|carpet)[^,]*)$", rest, re.I)
    if m:
        head, surf = m.group(1), m.group(2)
    c = re.search(r"\(([^)]*)\)", head)
    country = c.group(1) if c else ""
    name = re.sub(r"\s+", " ", re.sub(r"\s*\([^)]*\)", "", head)).strip()
    qual = bool(re.search(r"Qualif", name))
    stage = "Qualifying" if qual else "Play-offs" if "Play Offs" in name else "Groups" if re.search(r"Finals\b", name) and "Play Offs" not in name and level in ("atp", "wta") else ""
    name = re.sub(r" - (Play Offs|Qualification)$", "", name)
    indoor = "indoor" in surf
    surface = next((s for s in ("hard", "clay", "grass", "carpet") if s in surf.lower()), "")
    slam = level in ("atp", "wta") and any(name.startswith(s) for s in SLAMS)
    if tour.startswith(("BOYS", "GIRLS")):
        level = "junior"
    return {"tour": tour, "level": "slam" if slam else level, "tourLevel": level, "disc": disc, "name": name, "country": country, "surface": surface,
            "indoor": indoor, "slam": slam, "qual": qual, "stage": stage, "path": zl or "", "heading": za}


def side(r, home):
    k = (lambda a, b: r.get(a if home else b))
    names = (k("AE", "AF") or "")
    ids = (k("PX", "PY") or "")
    photos = [fs.img(p) for p in (k("OA", "OB") or "").split(";") if p]
    slugs = [k("WU", "WV") or ""]
    sets, tbs = [], []
    for hg, ag, ht, at in SETS:
        g = r.get(hg if home else ag)
        if g in (None, ""):
            break
        sets.append(num(g))
        t = r.get(ht if home else at)
        tbs.append(num(t))
    players = [{"name": n.strip(), "id": (ids.split("/") + [""] * 2)[i], "photo": photos[i] if i < len(photos) else ""}
               for i, n in enumerate(names.split("/")) if n.strip()]
    if players:
        players[0]["slug"] = slugs[0]
    return {"name": names, "short": k("WM", "WN") or "", "id": ids, "pid": k("JA", "JB") or "", "slug": slugs[0], "country": k("FU", "FV") or "",
            "photo": photos[0] if photos else "", "players": players, "sets": num(k("AG", "AH")), "games": sets, "tb": tbs,
            "point": k("WA", "WB") or "", "serving": r.get("WC") == ("1" if home else "2")}


def event(r, tn=None):
    ab, ac = r.get("AB"), r.get("AC")
    r = {k: (v if not (isinstance(v, str) and v.startswith("{")) else "") for k, v in r.items()}
    state = "in" if ab == "2" else "post" if ab == "3" else "pre"
    detail = STATUS.get(ac, "Live" if state == "in" else "")
    if state == "post" and ac == "3":
        detail = "Final"
    return {"id": r.get("AA"), "ts": num(r.get("AD")) or 0, "end": num(r.get("AO")) or 0, "state": state, "detail": detail, "code": ac or "",
            "round": r.get("ER", ""), "winner": "home" if r.get("AS") == "1" else "away" if r.get("AS") == "2" else "",
            "note": r.get("AM", ""), "tn": tn, "home": side(r, True), "away": side(r, False)}


def parse_list(text):
    """Day, tournament and player feeds: tournament headings (ZA) followed by their matches (AA)."""
    tours, matches, cur = {}, [], None
    for r in fs.records(text):
        if "ZA" in r:
            cur = r.get("ZEE") or r["ZA"]
            if cur not in tours:
                tours[cur] = {**parse_heading(r["ZA"], r.get("ZL")), "id": cur, "stageId": r.get("ZC", ""), "logo": fs.img(r.get("OAJ"))}
        elif "AA" in r and cur:
            matches.append(event(r, cur))
    return tours, matches


def day(off, tz):
    off, tz = max(-7, min(7, int(off))), max(-12, min(14, int(tz)))
    tours, matches = parse_list(fs.feed(f"f_{SPORT}_{off}_{tz}_en_1", 20 if off == 0 else 300))
    return {"tours": tours, "matches": matches}


def initial(page, name):
    m = re.search(r"initialFeeds\[[\"']%s[\"']\]\s*=\s*\{\s*data:\s*`(.*?)`" % re.escape(name), page, re.S)
    return m.group(1) if m else ""


def tournament(path):
    if not re.fullmatch(r"/tennis/[a-z0-9-]+/[a-z0-9-]+/", path or ""):
        return {"error": "bad path"}
    page = fs._get(fs.SITE + path, 300)
    t1, res = parse_list(initial(page, "summary-results"))
    t2, fix = parse_list(initial(page, "summary-fixtures"))
    tours = {**t2, **t1}
    title = re.search(r"<title>([^<]+)</title>", page)
    return {"path": path, "tours": tours, "info": next(iter(tours.values()), {}), "title": fs._text(title.group(1)) if title else "",
            "results": sorted(res, key=lambda e: -e["ts"]), "fixtures": sorted(fix, key=lambda e: e["ts"])}


# ---------- one match ----------
def _pct_parts(s):
    """'74% (28/38)' -> (28, 38); '0/1' -> (0, 1); '5' -> (5, None)"""
    m = re.search(r"(\d+)\s*/\s*(\d+)", s or "")
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(-?\d+(?:\.\d+)?)", s or "")
    return (float(m.group(1)) if "." in m.group(1) else int(m.group(1)), None) if m else (None, None)


def summary(text):
    sets, info = [], {}
    for r in fs.records(text):
        if "AC" in r and "IG" in r:
            multi = r.get("_multi", {})
            hg, ag = multi.get("IG", [r["IG"]]), multi.get("IH", [r.get("IH", "")])
            dur = next((r[k] for k in ("RC", "RD", "RE", "RF", "RG") if k in r), "")
            sets.append({"set": r["AC"], "home": hg[0], "away": ag[0], "tbHome": hg[1] if len(hg) > 1 else "", "tbAway": ag[1] if len(ag) > 1 else "", "time": dur})
        if "RB" in r:
            info["time"] = r["RB"]
        if r.get("TVB"):
            info["tv"] = r["TVB"]
    return sets, info


def point_by_point(text):
    """df_mh: game by game, who served, who won, breaks and the points of each game."""
    out, cur = [], None
    for r in fs.records(text):
        if "HB" in r:
            cur = {"name": r["HB"].replace("Point by point - ", ""), "tb": r["HB"].startswith("Tiebreak"), "games": []}
            out.append(cur)
        elif "HC" in r and cur is not None:
            pts = [p.strip() for p in (r.get("HL") or "").split(",") if p.strip()]
            cur["games"].append({"h": num(r.get("HC")), "a": num(r.get("HE")), "server": num(r.get("HG")), "won": num(r.get("HK")),
                                 "lost": bool(r.get("HH")) and r.get("HG") != r.get("HK"), "tbH": num(r.get("HD")), "tbA": num(r.get("HF")),
                                 "points": [{"s": p.split("|")[0].strip(), "bp": "|B" in p, "sp": "|S" in p, "mp": "|M" in p} for p in pts]})
        elif "HN" in r and out:
            out[-1]["now"] = r.get("HO", "")
    return [s for s in out if s["games"]]


def match(eid, ja="", jb=""):
    def safe(f):
        try:
            return f()
        except Exception:
            return None
    jobs = {"sui": lambda: summary(fs.feed(f"df_sui_1_{eid}", 20)), "st": lambda: fs.team_stats(fs.feed(f"df_st_1_{eid}", 20)),
            "mh": lambda: point_by_point(fs.feed(f"df_mh_1_{eid}", 20)), "hh": lambda: h2h(fs.feed(f"df_hh_1_{eid}", 3600)),
            "odds": lambda: odds(eid, ja, jb)}
    with ThreadPoolExecutor(5) as ex:
        res = dict(zip(jobs, ex.map(lambda f: safe(f), jobs.values())))
    sets, info = res["sui"] or ([], {})
    return {"id": eid, "sets": sets, "info": info, "stats": res["st"] or [], "pbp": res["mh"] or [], "h2h": res["hh"] or [], "odds": res["odds"] or {"books": []}}


def h2h(text):
    """Sections per surface tab: each player's recent matches and their meetings."""
    out, tab, cur = [], None, None
    for r in fs.records(text):
        if "KA" in r:
            tab = {"surface": r["KA"], "sections": []}
            out.append(tab)
        elif "KB" in r and tab is not None:
            cur = {"title": r["KB"], "games": []}
            tab["sections"].append(cur)
        elif "KP" in r and cur is not None:
            hs, as_ = r.get("KU", ""), r.get("KT", "")
            cur["games"].append({"id": r["KP"], "ts": num(r.get("KC")) or 0, "tn": r.get("KF", ""), "surface": r.get("KD", ""), "code": r.get("AC", ""),
                                 "home": r.get("KJ", "").lstrip("*"), "away": r.get("KK", "").lstrip("*"), "hid": r.get("UQ", ""), "aid": r.get("UO", ""),
                                 "hslug": r.get("UE", ""), "aslug": r.get("UG", ""), "hs": hs, "as": as_, "res": r.get("WIS", ""), "side": r.get("KS", ""),
                                 "hflag": fs.img(r.get("EC")), "aflag": fs.img(r.get("ED"))})
    return out


# ---------- players ----------
_rank_cache, _rank_lock = {}, threading.Lock()


def profile(pid):
    """The short participant record: 'id|Sinner J.|Italy|photo|2|98|/player/sinner-jannik/id|men|Jannik Sinner|ATP: 2.|997920000|…'"""
    now = time.time()
    with _rank_lock:
        hit = _rank_cache.get(pid)
        if hit and now - hit[0] < 6 * 3600:
            return hit[1]
    out = {}
    try:
        m = re.search(r"PR÷([^¬]*)", fs.feed(f"pl_0_{pid}_1", 6 * 3600))
        if m:
            f = m.group(1).split("|") + [""] * 12
            rk = re.match(r"\s*(\w+)\s*:\s*(\d+)", f[9])
            out = {"id": f[0], "short": f[1], "country": f[2], "photo": fs.img(f[3]) if f[3] else "", "url": f[6], "gender": f[7], "name": f[8] or f[1],
                   "tour": rk.group(1) if rk else "", "rank": int(rk.group(2)) if rk else None, "born": num(f[10]), "countryId": f[5] if f[5].isdigit() else ""}
    except Exception:
        out = {}
    with _rank_lock:
        _rank_cache[pid] = (now, out)
    return out


def ranks(spec):
    ids = [x for x in (spec or "").split(",") if re.fullmatch(r"[A-Za-z0-9]{6,12}", x)][:120]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(profile, ids))
    return {i: {"rank": r.get("rank"), "tour": r.get("tour"), "photo": r.get("photo")} for i, r in zip(ids, res) if r}


def _box(eid):
    try:
        st = fs.team_stats(fs.feed(f"df_st_1_{eid}", 86400))
    except Exception:
        return None
    return next((p for p in st if p["period"] == "Match"), None)


def _round_rank(rnd):
    r = (rnd or "").lower()
    if "qualification" in r or r.startswith("qual"):
        return "Qualifying"
    if "final" in r and not any(x in r for x in ("semi", "quarter", "1/")):
        return "Final"
    if "semi" in r:
        return "Semi-final"
    if "quarter" in r:
        return "Quarter-final"
    if "group" in r or "round robin" in r:
        return "Round robin"
    return "Early rounds"


STAT_KEYS = {   # Flashscore label -> our key; counted from the player's side ("a/b" pairs are summed)
    "Aces": "aces", "Double Faults": "df", "1st serve percentage": "first", "1st serve points won": "firstWon", "2nd serve points won": "secondWon",
    "Break Points Saved": "bpSaved", "1st return points won": "ret1", "2nd return points won": "ret2", "Break Points Converted": "bpConv",
    "Service Points Won": "svPts", "Return Points Won": "retPts", "Total Points Won": "totPts", "Service games won": "svGames",
    "Return games won": "retGames", "Total games won": "totGames", "Match points saved": "mpSaved",
}


def career_stats(matches, pid):
    """Aggregate the per-match serve and return stats of finished singles matches (from the player's side)."""
    done = [m for m in matches if m["state"] == "post" and m["code"] not in ("9", "5") and m["disc"] == "S"][:25]
    with ThreadPoolExecutor(6) as ex:
        boxes = list(ex.map(lambda m: _box(m["id"]), done))
    tot, n = {}, 0
    per = []
    for m, box in zip(done, boxes):
        if not box:
            continue
        me = "home" if pid in (m["home"]["id"] or "").split("/") else "away"
        row = {"id": m["id"]}
        for g in box["groups"]:
            for r in g["rows"]:
                k = STAT_KEYS.get(r["label"])
                if not k:
                    continue
                a, b = _pct_parts(r[me])
                if k == "first":   # only a percentage; rebuilt below from the points
                    continue
                t = tot.setdefault(k, [0, 0])
                if a is not None:
                    t[0] += a
                if b is not None:
                    t[1] += b
                row[k] = [a, b]
        # 1st serves in = 1st serve points played; serve points = all serve points
        if "firstWon" in row and "svPts" in row and row["firstWon"][1] is not None and row["svPts"][1]:
            t = tot.setdefault("first", [0, 0])
            t[0] += row["firstWon"][1]
            t[1] += row["svPts"][1]
        n += 1
        per.append(row)
    return {"matches": n, "totals": tot, "per": per}


def _player_side(m, pid):
    for s in ("home", "away"):
        if pid in (m[s]["id"] or "").split("/"):
            return s
    return None


def splits(matches, pid):
    """Wins and losses by surface, level, round, year, set count, tiebreaks and deciding sets, plus titles and finals."""
    out = {"surface": {}, "level": {}, "year": {}, "indoor": {}}
    tb = [0, 0]
    deciding = [0, 0]
    after1 = {"won1": [0, 0], "lost1": [0, 0]}
    sets = [0, 0]
    streak, form = None, []
    for m in sorted(matches, key=lambda m: -m["ts"]):
        if m["state"] != "post" or m["disc"] != "S" or m["code"] in ("5",):
            continue
        me = _player_side(m, pid)
        if not me:
            continue
        op = "away" if me == "home" else "home"
        won = m["winner"] == me
        add = lambda d, k: d.setdefault(k, [0, 0]).__setitem__(0 if won else 1, d.setdefault(k, [0, 0])[0 if won else 1] + 1)
        add(out["surface"], (m.get("surface") or "other").title())
        add(out["level"], m.get("levelName") or m.get("level") or "Other")
        add(out["year"], time.strftime("%Y", time.gmtime(m["ts"])))
        add(out["indoor"], "Indoor" if m.get("indoor") else "Outdoor")
        form.append("W" if won else "L")
        if m["code"] == "9":
            continue
        sw, sl = m[me]["sets"] or 0, m[op]["sets"] or 0
        sets[0] += sw
        sets[1] += sl
        for i, (g1, g2) in enumerate(zip(m[me]["games"], m[op]["games"])):
            if g1 is not None and g2 is not None and {g1, g2} in ({7, 6}, {6, 7}) or (m[me]["tb"][i] is not None and i < len(m[op]["tb"]) and m[op]["tb"][i] is not None):
                tb[0 if (g1 or 0) > (g2 or 0) else 1] += 1
        if sw + sl == (5 if max(sw, sl) == 3 else 3) and min(sw, sl) == max(sw, sl) - 1:
            deciding[0 if won else 1] += 1
        if m[me]["games"] and m[op]["games"]:
            k = "won1" if (m[me]["games"][0] or 0) > (m[op]["games"][0] or 0) else "lost1"
            after1[k][0 if won else 1] += 1
    return {**out, "tiebreaks": tb, "deciding": deciding, "afterSet1": after1, "sets": sets, "form": form[:10]}


LEVEL_NAMES = {"slam": "Grand Slam", "atp": "ATP Tour", "wta": "WTA Tour", "chm": "Challenger", "chw": "WTA 125", "itfm": "ITF", "itfw": "ITF", "junior": "Juniors", "other": "Other"}


def _decorate(tours, matches):
    for m in matches:
        t = tours.get(m["tn"]) or {}
        m.update({"surface": t.get("surface", ""), "indoor": t.get("indoor", False), "level": t.get("level", "other"), "levelName": LEVEL_NAMES.get(t.get("level"), "Other"),
                  "disc": t.get("disc", "S"), "tnName": t.get("name", ""), "tnPath": t.get("path", ""), "qual": t.get("qual", False), "stageName": t.get("stage", "")})
    return matches


def _pages(pid, country, n=3, tz=0):
    """The player's results, newest first, about 40 matches a page across singles, doubles and exhibitions."""
    def one(i):
        try:
            return parse_list(fs.feed(f"pr_{SPORT}_{country}_{pid}_{i}_{tz}_en_1", 1800 if i == 0 else 6 * 3600))
        except Exception:
            return {}, []
    with ThreadPoolExecutor(n) as ex:
        parts = list(ex.map(one, range(n)))
    tours, matches, seen = {}, [], set()
    for t, ms in parts:
        tours.update(t)
        for m in ms:
            if m["id"] not in seen:
                seen.add(m["id"])
                matches.append(m)
    return tours, matches


def titles_of(matches, pid):
    """Flashscore's player feeds carry no round names, so a title is a finished event whose last match the player won,
    with the field down to the last two (the event's final day), outside round-robin group stages and exhibitions."""
    by, runs = {}, {}
    for m in matches:
        if m["disc"] == "S" and m["level"] not in ("other", "junior") and m["state"] == "post" and not m.get("qual"):
            by.setdefault(m["tn"], []).append(m)
    for tn, ms in by.items():   # the same tournament id comes back every year: split it into editions
        ms.sort(key=lambda m: m["ts"])
        ed = 0
        for i, m in enumerate(ms):
            if i and m["ts"] - ms[i - 1]["ts"] > 20 * 86400:
                ed += 1
            runs.setdefault((tn, ed), []).append(m)
    by = runs
    out = []
    now = time.time()
    for tn, ms in by.items():
        ms.sort(key=lambda m: m["ts"])
        last = ms[-1]
        me = _player_side(last, pid)
        if not me or last["winner"] != me or now - last["ts"] < 86400 or ("Finals" in last.get("heading", "") and "Play Offs" not in last.get("heading", "")):
            continue
        if len(ms) < 3 and last["level"] not in ("slam", "atp", "wta"):   # a qualifier or lucky loser's partial run is not a title
            continue
        op = "away" if me == "home" else "home"
        out.append({"tn": last["tnName"], "ts": last["ts"], "level": last["levelName"], "surface": last["surface"], "opp": last[op]["name"], "wins": len(ms)})
    return sorted(out, key=lambda x: -x["ts"])


def player(pid, slug):
    base = f"{fs.SITE}/player/{slug}/{pid}/"
    prof = profile(pid)
    with ThreadPoolExecutor(3) as ex:
        fp = ex.submit(lambda: fs._get(base + "results/", 1800))
        ff = ex.submit(lambda: fs._get(base + "fixtures/", 1800))
        pages = ex.submit(lambda: _pages(pid, prof.get("countryId") or "", 3) if prof.get("countryId") else ({}, []))
        try:
            page = fp.result()
        except Exception:
            page = ""
        try:
            fix = ff.result()
        except Exception:
            fix = ""
        tours, matches = pages.result()
    head = page[page.find('class="heading"'):][:6000] if 'class="heading"' in page else ""
    name = re.search(r'class="heading__name">([^<]+)<', head)
    photo = re.search(r'class="heading__logo[^"]*" src="([^"]+)"', head)
    rank = re.search(r'participant-detail-rank">.*?>(\w+)</a>\s*:\s*(\d+)', head, re.S)
    born = re.search(r"getAge\((-?\d+)\)", head)
    absent = re.search(r'heading__absence.*?<title>([^<]+)</title>', head, re.S)
    flag = re.search(r'breadcrumb__flag flag fl_(\d+)"></span><span class="breadcrumb__text">([^<]+)<', page)
    if not matches:   # the results page itself carries the latest dozen matches of each discipline
        for k in ("s", "d", "m"):
            t, ms = parse_list(initial(page, f"summary-results_{k}"))
            tours.update(t)
            matches += ms
    for m in matches:
        m["heading"] = (tours.get(m["tn"]) or {}).get("heading", "")
    ft, fm = parse_list(initial(fix, "summary-fixtures") or initial(fix, "summary-fixtures_s"))
    tours.update(ft)
    _decorate(tours, matches)
    _decorate(tours, fm)
    matches.sort(key=lambda m: -m["ts"])
    sp = splits(matches, pid)
    sp["titles"] = titles_of(matches, pid)
    return {"id": pid, "slug": slug, "name": fs._text(name.group(1)) if name else prof.get("name") or slug.replace("-", " ").title(),
            "photo": photo.group(1) if photo else prof.get("photo", ""), "tour": rank.group(1) if rank else prof.get("tour", ""),
            "rank": int(rank.group(2)) if rank else prof.get("rank"), "born": int(born.group(1)) if born else prof.get("born"),
            "injury": absent.group(1).strip() if absent else "", "country": flag.group(2) if flag else prof.get("country", ""),
            "gender": prof.get("gender", ""), "matches": matches, "upcoming": sorted(fm, key=lambda m: m["ts"]),
            "stats": career_stats(matches, pid), "splits": sp}


def search(q):
    if len(q) < 2:
        return {"players": []}
    url = fs.SEARCH + "?" + urllib.parse.urlencode({"q": q, "lang-id": 1, "type-ids": "2,3,4", "project-type-id": 1, "project-id": 2, "sport-ids": SPORT})
    try:
        rows = fs._get(url, 3600, as_json=True)
    except Exception:
        return {"players": []}
    out = []
    for r in rows or []:
        if (r.get("sport") or {}).get("id") != SPORT:
            continue
        pic = fs.img(next((i["path"] for i in r.get("images") or [] if i.get("variantTypeId") == 15), next((i["path"] for i in r.get("images") or []), "")))
        nm = r.get("name") or ""
        parts = nm.split(" ")
        out.append({"id": r.get("id"), "slug": r.get("url"), "name": " ".join(parts[1:] + parts[:1]) if len(parts) > 1 else nm, "img": pic,
                    "country": (r.get("defaultCountry") or {}).get("name", ""), "gender": (r.get("gender") or {}).get("name", "")})
    return {"players": out[:12]}


def odds(eid, ja="", jb=""):
    """Match-winner prices. Tennis is priced almost everywhere, so two regions are enough (US books, then UK and European)."""
    for geo, sub, tag in (("US", "USNY", ""), ("GB", "GB", "UK")):
        r = fs._odds_geo(eid, ja, jb, geo, sub)
        if r["books"]:
            r["region"] = tag
            return r
    return {"books": [], "region": ""}


def odds_many(spec):
    items = []
    for part in (spec or "").split(",")[:60]:
        bits = (part.split(":") + ["", ""])[:3]
        if bits[0] and all(re.fullmatch(r"[A-Za-z0-9]{0,12}", x) for x in bits):
            items.append(bits)
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda it: odds(*it), items))
    return {it[0]: r for it, r in zip(items, res)}


def handle(path, q):
    """Returns (status, payload, max_age) for an /api/tn/ request."""
    ok_id = lambda s: bool(re.fullmatch(r"[A-Za-z0-9]{6,12}", s or ""))
    ok_slug = lambda s: bool(re.fullmatch(r"[a-z0-9-]{1,80}", s or ""))
    if path == "day":
        return 200, day(q.get("off", "0"), q.get("tz", "0")), 10
    if path == "match":
        if not ok_id(q.get("id")):
            return 400, {"error": "bad id"}, 0
        return 200, match(q["id"], q.get("ja", "") if ok_id(q.get("ja")) else "", q.get("jb", "") if ok_id(q.get("jb")) else ""), 10
    if path == "odds":
        return 200, odds_many(q.get("ids", "")), 30
    if path == "player":
        if not ok_id(q.get("id")) or not ok_slug(q.get("slug")):
            return 400, {"error": "bad player"}, 0
        return 200, player(q["id"], q["slug"]), 600
    if path == "ranks":
        return 200, ranks(q.get("ids", "")), 3600
    if path == "tournament":
        return 200, tournament(q.get("path", "")), 120
    if path == "search":
        return 200, search(q.get("q", "")[:60]), 3600
    return 404, {"error": "not found"}, 0
