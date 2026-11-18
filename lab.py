"""Floodlight Lab: the research screen that opens inside Discord (a Discord Activity) or in a browser.

/lab in Discord checks the member's role like the other commands, leaves a short-lived "ticket" for that channel and
answers with LAUNCH_ACTIVITY. Discord then opens https://<app id>.discordsays.com/ in the channel, which its proxy
forwards to this server's root with ?frame_id=...&channel_id=... in the address; server.py serves lab.html for that.
The page swaps the channel's ticket for a signed pass (12 hours) and sends it with every /api/lab/ request, so the
Activity works without a site login. The browser link /lab posts carries the same kind of pass in its address.

All the numbers come from discord_bot.py's loaders (ESPN, MLB StatsAPI, FotMob, PrizePicks and Sleeper), cached the
same way, so the Lab costs nothing to run and calls no paid API.

  GET /lab                         the page (also served at / when Discord opens the Activity)
  GET /api/lab/session             ?channel_id=&instance_id= (Activity) or ?t= (browser link) -> {token, player, sport}
  GET /api/lab/player              ?sport=&name=   a player's games with every stat, their posted lines and summary numbers
  GET /api/lab/team                ?sport=&name=   a team's results (scores, totals, margins), next game and its lines, season stats, roster
  GET /api/lab/board               ?sport=         today's posted lines ranked by recent hit rate
  GET /api/lab/img                 ?u=             player photos through this server (Discord's Activity sandbox blocks other hosts)
"""
import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

import discord_bot as bot
import labfight   # UFC and boxing fighters in the same shape as a player

PASS_HOURS = 12
TICKET_MIN = 15
IMG_HOSTS = ("fonts.gstatic.com", "a.espncdn.com", "img.mlbstatic.com", "www.mlbstatic.com", "images.fotmob.com", "img.a.transfermarkt.technology", "secure.espncdn.com", "upload.wikimedia.org")

_tickets, _instances, _imgs = {}, {}, {}
_lock = threading.Lock()


def _key():
    s = os.environ.get("DISCORD_BOT_TOKEN") or os.environ.get("DISCORD_PUBLIC_KEY") or "floodlight-lab-local"
    return hashlib.sha256(("lab:" + s).encode()).digest()


def make_pass(who="", hours=PASS_HOURS):
    body = base64.urlsafe_b64encode(json.dumps({"u": who, "x": int(time.time() + hours * 3600)}).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:18]).decode().rstrip("=")
    return f"{body}.{sig}"


def check_pass(tok):
    try:
        body, sig = str(tok or "").split(".")
        want = base64.urlsafe_b64encode(hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:18]).decode().rstrip("=")
        if not hmac.compare_digest(sig, want):
            return False
        return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))).get("x", 0) > time.time()
    except Exception:
        return False


def ticket(channel_id, opts, user=""):
    """/lab was used in this channel by a member: the Activity that opens there in the next minutes may get a pass."""
    with _lock:
        now = time.time()
        for k in [k for k, v in _tickets.items() if now - v["at"] > TICKET_MIN * 60]:
            _tickets.pop(k, None)
        _tickets[str(channel_id)] = {"at": now, "player": (opts.get("player") or "").strip(), "team": (opts.get("team") or "").strip(),
                                     "sport": opts.get("sport") or "", "user": user}


def session(q, signed_in=False):
    """-> (status, obj)"""
    if not q.get("t") and not q.get("channel_id"):   # opened straight in a browser: a site login is enough
        if signed_in:
            return 200, {"token": make_pass("site"), "player": q.get("player") or "", "team": q.get("team") or "", "sport": q.get("sport") or ""}
        return 403, {"error": "Type /lab in the Floodlight Discord to open the Lab, or log in to Floodlight first.", "need": "lab"}
    if q.get("t"):
        if not check_pass(q["t"]):
            return 403, {"error": "This Lab link has expired. Use /lab in Discord for a new one."}
        return 200, {"token": q["t"], "player": q.get("player") or "", "team": q.get("team") or "", "sport": q.get("sport") or ""}
    ch, inst = str(q.get("channel_id") or ""), str(q.get("instance_id") or "")
    with _lock:
        now = time.time()
        if inst and inst in _instances and now - _instances[inst]["at"] < PASS_HOURS * 3600:
            t = _instances[inst]
        else:
            t = _tickets.get(ch)
            if not t or now - t["at"] > TICKET_MIN * 60:
                return 403, {"error": "Type /lab in the channel to open the Lab.", "need": "lab"}
            if inst:
                _instances[inst] = t
                if len(_instances) > 500:
                    for k in sorted(_instances, key=lambda k: _instances[k]["at"])[:250]:
                        _instances.pop(k, None)
    return 200, {"token": make_pass(t.get("user") or ""), "player": t.get("player") or "", "team": t.get("team") or "", "sport": t.get("sport") or ""}


def browser_link(opts, user=""):
    site = bot.SITE.rstrip("/")
    if not site:
        return ""
    q = {"t": make_pass(user)}
    for k in ("player", "team"):
        if opts.get(k):
            q[k] = opts[k]
    if opts.get("sport"):
        q["sport"] = opts["sport"]
    return f"{site}/lab?{urllib.parse.urlencode(q)}"


def img_url(u):
    return f"/api/lab/img?u={urllib.parse.quote(u, safe='')}" if u else ""


def img(u):
    """-> (status, content_type, bytes)"""
    p = urllib.parse.urlparse(u or "")
    if p.scheme != "https" or p.hostname not in IMG_HOSTS:
        return 400, "text/plain", b"not allowed"
    with _lock:
        hit = _imgs.get(u)
    if hit:
        return 200, hit[0], hit[1]
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=12) as r:
            ct, data = r.headers.get("Content-Type") or "image/png", r.read(2_000_000)
    except Exception:
        return 404, "text/plain", b""
    if not (ct.startswith("image/") or (p.hostname == "fonts.gstatic.com" and "font" in ct)):
        return 404, "text/plain", b""
    with _lock:
        _imgs[u] = (ct, data)
        if len(_imgs) > 150:
            for k in list(_imgs)[:75]:
                _imgs.pop(k, None)
    return 200, ct, data


FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400..700&family=Geist+Mono:wght@400..700&display=swap"
# the display and reading faces, declared the same way theme.css declares them
FONT_FACES = """@font-face{font-family:"FL Slant";font-style:normal;font-weight:100 900;font-stretch:62% 70%;font-display:swap;src:url(https://fonts.gstatic.com/s/archivo/v25/k3kSo8UDI-1M0wlSfdzYLGHE.woff2) format("woff2")}
@font-face{font-family:"Manrope";font-style:normal;font-weight:400 800;font-display:swap;src:url(https://fonts.gstatic.com/s/manrope/v23/xn7gYHE41ni1AdIRggexSg.woff2) format("woff2")}
"""
_fonts = {}


def fonts_css():
    """Google's font sheet with the font files pointed at this server, so the Lab's type also loads inside Discord."""
    if not _fonts.get("css"):
        try:
            req = urllib.request.Request(FONTS, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"})
            css = urllib.request.urlopen(req, timeout=10).read().decode()
            # the Latin files are enough; the other scripts would only add requests
            blocks = re.findall(r"/\* ([a-z-]+) \*/\s*(@font-face\s*{[^}]*})", css)
            keep = [b for name, b in blocks if name == "latin"] or [b for _, b in blocks]
            css = "\n".join(keep) if keep else css
            css = FONT_FACES + css
            _fonts["css"] = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", lambda m: f"url({img_url(m.group(1))})", css)
        except Exception:
            return re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", lambda m: f"url({img_url(m.group(1))})", FONT_FACES)
    return _fonts["css"]


def _extras(sport, p, name):
    """The team crest (it lights the player card) and position, best effort."""
    out = {"crest": "", "pos": ""}
    try:
        if sport == "soccer":
            d = bot.D["fm_player"](None, name, "") or {}
            tid = (d.get("team") or {}).get("id")
            out["crest"] = f"https://images.fotmob.com/image_resources/logo/teamlogo/{tid}.png" if tid else ""
            out["pos"] = d.get("position") or ""
        elif sport == "mlb":
            d = (bot.get_json(f"{bot.SAPI}/people/{p['id']}?hydrate=currentTeam", 86400).get("people") or [{}])[0]
            tid = (d.get("currentTeam") or {}).get("id")
            out["crest"] = f"https://www.mlbstatic.com/team-logos/{tid}.svg" if tid else ""
            out["pos"] = (d.get("primaryPosition") or {}).get("abbreviation") or ""
        else:
            o = bot.find_player(sport, name) or {}
            path = f"{bot.ESPN_PATH[sport].split('/')[0]}/{o.get('lg') or sport}"
            a = bot.get_json(f"{bot.ESPN_WEB}/sports/{path}/athletes/{p['id']}", 86400).get("athlete") or {}
            t = a.get("team") or {}
            out["crest"] = ((t.get("logos") or [{}])[0]).get("href") or ""
            out["pos"] = (a.get("position") or {}).get("abbreviation") or ""
            out["num"] = a.get("displayJersey") or ""
    except Exception:
        pass
    return out


# ---------- the data ----------
def _r(v, d=2):
    return None if v is None else round(v, d) if isinstance(v, float) else v


def _deeper(sport, p):
    """Two more seasons behind the two the bot loads, so the Lab can go back 100+ games. Cached by the bot's fetcher."""
    try:
        if sport == "mlb":
            y = time.gmtime().tm_year
            more = bot.mlb_season(p["id"], y - 2) + bot.mlb_season(p["id"], y - 3)
        else:
            o = bot.find_player(sport, p["name"]) or {}
            path = f"{bot.ESPN_PATH[sport].split('/')[0]}/{o.get('lg') or sport}"
            y = bot.cur_season(sport)
            more = bot.espn_season(path, p["id"], y - 2) + bot.espn_season(path, p["id"], y - 3)
    except Exception:
        return p
    seen = {g["id"] for g in p["games"]}
    games = p["games"] + [g for g in more if g["id"] not in seen]
    return {**p, "games": sorted(games, key=lambda g: g["date"], reverse=True)}


def player(sport, name, stat=""):
    if sport not in bot.SPORTS:
        raise LookupError("Pick a sport.")
    if not (name or "").strip():
        raise LookupError("Type a player's name.")
    p = bot.load_player(sport, name.strip())
    if sport == "soccer":
        bot.soccer_deep(p, 20)
    else:
        p = _deeper(sport, p)
    sp = bot.stat_sport(sport)
    defs = bot.STAT[sp]
    games = []
    for g in p["games"][:400]:
        v = {}
        for k, sd in defs.items():
            try:
                x = sd["get"](g)
            except Exception:
                x = None
            if x is not None:
                v[k] = _r(x)
        if v:
            games.append({"id": g["id"], "date": g["date"].isoformat(), "opp": g["opp"], "oppAbbr": g.get("oppAbbr") or "", "home": g["home"],
                          "comp": g.get("comp") or "", "res": g.get("res") or "", "score": g.get("score") or "", "min": _r(g.get("min"), 1), "v": v})
    stats = [{"k": k, "l": sd["l"], "n": sum(1 for g in games if k in g["v"])} for k, sd in defs.items()]
    stats = [s for s in stats if s["n"]]
    lines = []
    try:
        n = bot.norm(p["name"])
        for x in bot.dfs_lines(sport).get("lines") or []:
            if bot.norm(x.get("player")) == n:
                k = bot.stat_key(sport, x.get("stat"))
                if k:
                    lines.append({"k": k, "line": x["line"], "book": x.get("book"), "kind": x.get("kind") or "standard", "pOver": x.get("pOver"),
                                  "opp": x.get("opp") or "", "start": x.get("start") or ""})
    except Exception:
        pass
    ex = _extras(sport, p, name.strip())
    nxt = next(({"opp": x["opp"], "date": x["start"], "home": None} for x in lines if x.get("opp")), None)
    return {"sport": sport, "sportLabel": bot.SPORTS[sport], "name": p["name"], "team": p.get("team") or "", "photo": img_url(p.get("photo")),
            "crest": img_url(ex.get("crest")), "pos": " · ".join(x for x in (ex.get("num") and "#" + ex["num"], ex.get("pos")) if x), "next": nxt,
            "want": bot.stat_key(sport, stat) if stat else None,
            "seasonStart": bot.season_start(sport).isoformat(), "stats": stats, "games": games, "lines": lines, "at": int(time.time())}


def board(sport, count=24):
    if sport not in bot.SPORTS:
        raise LookupError("Pick a sport.")
    b = bot.memo(("labboard", sport), 900, lambda: bot.props_board(sport, None, count))
    rows = [{"player": r["player"], "team": r.get("team") or "", "opp": r.get("opp") or "", "k": r["k"], "label": r["label"], "line": r["line"],
             "side": r["side"], "l5": r["l5"]["pct"], "l10": r["l10"]["pct"], "l20": r["l20"]["pct"], "avg": _r(r["avg"]),
             "books": sorted({x["book"] for x in r["offers"]})} for r in b["rows"]]
    return {"sport": sport, "rows": rows, "checked": b["lines"], "errors": b["errors"]}


# ---------- teams ----------
UNIT = {"nba": "points", "wnba": "points", "nfl": "points", "nhl": "goals", "mlb": "runs", "soccer": "goals"}


def _team_stats(unit):
    U = unit.title()
    return [{"k": "pf", "l": f"Team {unit}"}, {"k": "pa", "l": f"{U} allowed"}, {"k": "tot", "l": f"Game total ({unit})"},
            {"k": "mar", "l": "Margin (vs spread)"}, {"k": "win", "l": "Win"}, {"k": "btts", "l": "Both teams score"}, {"k": "cs", "l": "Clean sheet / shutout"}]


def _game(gid, date, opp, opp_abbr, home, us, them, comp=""):
    us, them = bot.num(us), bot.num(them)
    if us is None or them is None or not date:
        return None
    v = {"pf": us, "pa": them, "tot": us + them, "mar": us - them, "win": 1 if us > them else 0, "btts": int(us > 0 and them > 0), "cs": int(them == 0)}
    return {"id": str(gid), "date": date.isoformat(), "opp": opp or "", "oppAbbr": opp_abbr or "", "home": home, "comp": comp,
            "res": "W" if us > them else "L" if us < them else "D", "score": f"{bot.fmt(us)}-{bot.fmt(them)}", "min": None, "v": v}


def _pick(cands, name):
    """cands: [(id, [names...], extra)] -> best match by name"""
    n = bot.norm(name)
    best, sc = None, 0
    for c in cands:
        for alias in c[1]:
            a = bot.norm(alias)
            if not a:
                continue
            s = 3 if a == n else 2 if (n in a.split() or a in n.split()) else 1.5 if (n in a or a in n) else 0
            if s > sc:
                best, sc = c, s
    return best


def _espn_team(sport, name):
    path = bot.ESPN_PATH[sport]
    d = bot.get_json(f"{bot.ESPN}/{path}/teams", 86400)
    teams = [x.get("team") or {} for lg in (d.get("sports") or [{}])[0].get("leagues") or [] for x in lg.get("teams") or []]
    c = _pick([(t.get("id"), [t.get("displayName"), t.get("shortDisplayName"), t.get("nickname"), t.get("name"), t.get("abbreviation"), t.get("location")], t) for t in teams], name)
    if not c:
        raise LookupError(f"Couldn't find a {bot.SPORTS[sport]} team called {name}.")
    t, tid = c[2], c[0]
    logo = ((t.get("logos") or [{}])[0]).get("href") or ""
    info = {}
    try:
        info = bot.get_json(f"{bot.ESPN}/{path}/teams/{tid}", 3600).get("team") or {}
    except Exception:
        pass
    y = bot.cur_season(sport)
    games, upcoming = [], []
    for yr in (y, y - 1):
        try:
            sch = bot.get_json(f"{bot.ESPN}/{path}/teams/{tid}/schedule?season={yr}", 1800)
        except Exception:
            continue
        for ev in sch.get("events") or []:
            c0 = (ev.get("competitions") or [{}])[0]
            cs = c0.get("competitors") or []
            us = next((x for x in cs if str(x.get("id")) == str(tid)), None)
            them = next((x for x in cs if x is not us), None)
            if not us or not them:
                continue
            st = ((c0.get("status") or {}).get("type") or {})
            sc = lambda x: (x.get("score") or {}).get("value") if isinstance(x.get("score"), dict) else x.get("score")
            ot = them.get("team") or {}
            if st.get("completed"):
                g = _game(ev.get("id"), bot.parse_date(ev.get("date")), ot.get("displayName"), ot.get("abbreviation"), us.get("homeAway") == "home",
                          sc(us), sc(them), (ev.get("seasonType") or {}).get("name") or "")
                if g:
                    games.append(g)
            elif st.get("state") == "pre":
                upcoming.append({"date": ev.get("date"), "opp": ot.get("displayName") or "", "home": us.get("homeAway") == "home"})
    roster = []
    try:
        r = bot.get_json(f"{bot.ESPN}/{path}/teams/{tid}/roster", 6 * 3600)
        ath = r.get("athletes") or []
        flat = [a for grp in ath for a in (grp.get("items") or [])] if ath and "items" in ath[0] else ath
        for a in flat:
            roster.append({"name": a.get("displayName") or a.get("fullName") or "", "pos": (a.get("position") or {}).get("abbreviation") or "",
                           "num": a.get("jersey") or "", "photo": img_url((a.get("headshot") or {}).get("href") or ""),
                           "out": ((a.get("injuries") or [{}])[0] or {}).get("status") or ""})
    except Exception:
        pass
    stats = []
    try:
        sd = bot.get_json(f"{bot.ESPN}/{path}/teams/{tid}/statistics", 6 * 3600)
        cats = ((sd.get("results") or {}).get("stats") or {}).get("categories") or []
        for cat in cats:
            for x in cat.get("stats") or []:
                if x.get("displayValue") in (None, "", "0", "0.0"):
                    continue
                stats.append({"cat": cat.get("displayName") or cat.get("name") or "", "l": x.get("displayName") or x.get("name"), "v": x.get("displayValue"),
                              "pg": x.get("perGameDisplayValue") or "", "rank": x.get("rankDisplayValue") or ""})
    except Exception:
        pass
    rec = ((info.get("record") or {}).get("items") or [{}])[0].get("summary") or ""
    return {"id": str(tid), "name": t.get("displayName") or name, "abbr": t.get("abbreviation") or "", "logo": img_url(logo), "record": rec,
            "standing": info.get("standingSummary") or "", "games": games, "upcoming": upcoming, "roster": roster, "seasonStats": stats[:80]}


def _mlb_team(name):
    d = bot.get_json(f"{bot.SAPI}/teams?sportId=1", 86400)
    c = _pick([(t.get("id"), [t.get("name"), t.get("teamName"), t.get("abbreviation"), t.get("locationName"), t.get("clubName")], t) for t in d.get("teams") or []], name)
    if not c:
        raise LookupError(f"Couldn't find an MLB team called {name}.")
    t, tid = c[2], c[0]
    y = dt_now().year
    games, upcoming, w, l = [], [], 0, 0
    for yr in (y, y - 1):
        try:
            sch = bot.get_json(f"{bot.SAPI}/schedule?sportId=1&teamId={tid}&season={yr}&gameType=R,F,D,L,W", 1800)
        except Exception:
            continue
        for day in sch.get("dates") or []:
            for g in day.get("games") or []:
                home = str(g["teams"]["home"]["team"]["id"]) == str(tid)
                us, them = (g["teams"]["home"], g["teams"]["away"]) if home else (g["teams"]["away"], g["teams"]["home"])
                if (g.get("status") or {}).get("abstractGameState") == "Final":
                    x = _game(g.get("gamePk"), bot.parse_date(g.get("gameDate")), them["team"].get("name"), "", home, us.get("score"), them.get("score"),
                              "Postseason" if g.get("gameType") in ("F", "D", "L", "W") else "Regular season")
                    if x:
                        games.append(x)
                elif (g.get("status") or {}).get("abstractGameState") == "Preview":
                    upcoming.append({"date": g.get("gameDate"), "opp": them["team"].get("name") or "", "home": home})
    roster = []
    try:
        for r in bot.get_json(f"{bot.SAPI}/teams/{tid}/roster?rosterType=active", 6 * 3600).get("roster") or []:
            pid = (r.get("person") or {}).get("id")
            roster.append({"name": (r.get("person") or {}).get("fullName") or "", "pos": (r.get("position") or {}).get("abbreviation") or "", "num": r.get("jerseyNumber") or "",
                           "photo": img_url(f"https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/{pid}/headshot/67/current") if pid else "", "out": ""})
    except Exception:
        pass
    stats = []
    try:
        sd = bot.get_json(f"{bot.SAPI}/teams/{tid}/stats?stats=season&group=hitting,pitching&season={y}", 6 * 3600)
        for grp in sd.get("stats") or []:
            cat = ((grp.get("group") or {}).get("displayName") or "").title()
            st = ((grp.get("splits") or [{}])[0] or {}).get("stat") or {}
            for k in ("avg", "obp", "slg", "ops", "runs", "homeRuns", "hits", "strikeOuts", "baseOnBalls", "stolenBases", "era", "whip", "saves", "strikeoutsPer9Inn", "walksPer9Inn"):
                if st.get(k) not in (None, ""):
                    stats.append({"cat": cat, "l": re_label(k), "v": str(st[k]), "pg": "", "rank": ""})
    except Exception:
        pass
    return {"id": str(tid), "name": t.get("name") or name, "abbr": t.get("abbreviation") or "", "logo": img_url(f"https://www.mlbstatic.com/team-logos/{tid}.svg"),
            "record": "", "standing": "", "games": games, "upcoming": upcoming, "roster": roster, "seasonStats": stats}


def re_label(k):
    import re as _re
    return {"avg": "Batting average", "obp": "On-base %", "slg": "Slugging %", "ops": "OPS", "era": "ERA", "whip": "WHIP"}.get(k) or _re.sub(r"([A-Z0-9]+)", r" \1", k).capitalize()


def dt_now():
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc)


def _soccer_team(name):
    if not bot.D.get("fm_team"):
        raise LookupError("Soccer teams aren't available right now.")
    d = bot.D["fm_team"](name)
    if not d or d.get("error"):
        raise LookupError(f"Couldn't find {name} on FotMob.")
    tid, games, upcoming = str(d.get("id")), [], []
    for f in d.get("fixtures") or []:
        home = str((f.get("home") or {}).get("id")) == tid
        opp = (f.get("away") if home else f.get("home")) or {}
        if f.get("finished") and f.get("score"):
            g = _game(f.get("id"), bot.parse_date(f.get("utc")), opp.get("name"), (opp.get("short") or "")[:3], home,
                      f["score"][0 if home else 1], f["score"][1 if home else 0], f.get("tournament") or "")
            if g:
                games.append(g)
        elif not f.get("started") and not f.get("cancelled"):
            upcoming.append({"date": f.get("utc"), "opp": opp.get("name") or "", "home": home, "comp": f.get("tournament") or ""})
    roster = [{"name": m.get("name") or "", "pos": m.get("position") or m.get("group") or "", "num": m.get("number") or "", "photo": img_url(m.get("photo")),
               "out": (m.get("injury") or {}).get("text") or "", "g": m.get("goals"), "a": m.get("assists")} for m in d.get("squad") or []]
    return {"id": tid, "name": d.get("name") or name, "abbr": "", "logo": img_url(d.get("crest")), "record": "", "standing": d.get("coach") and f"Coach: {d['coach']}" or "",
            "games": games, "upcoming": upcoming, "roster": roster, "seasonStats": []}


def _next_event(sport, t, nxt):
    """The scoreboard entry for the team's next game that hasn't started (a game in progress has no pre-game lines)."""
    import datetime as _dt
    want = bot.norm(t["name"])
    when = bot.parse_date(nxt.get("date"))
    today = dt_now()
    for add in range(0, 9):
        d = today + _dt.timedelta(days=add)
        if when and d.date() > when.date() + _dt.timedelta(days=1):
            break
        for e in bot.events(sport, None, d.strftime("%Y%m%d")):
            if e["state"] != "pre":
                continue
            for side in ("home", "away"):
                if (sport != "soccer" and e[side]["id"] == t["id"]) or bot.norm(e[side]["name"]) == want:
                    return e
    return bot.find_game(sport, t["name"])


def team(sport, name):
    if sport not in bot.SPORTS:
        raise LookupError("Pick a sport.")
    if not (name or "").strip():
        raise LookupError("Type a team's name.")
    name = name.strip()

    def go():
        return _soccer_team(name) if sport == "soccer" else _mlb_team(name) if sport == "mlb" else _espn_team(sport, name)
    t = bot.memo(("labteam", sport, bot.norm(name)), 1800, go)
    games = sorted(t["games"], key=lambda g: g["date"], reverse=True)[:82]
    if not games:
        raise LookupError(f"No finished games found for {t['name']}.")
    unit = UNIT[sport]
    keys = ["pf", "pa", "tot", "mar", "win"] + (["btts", "cs"] if sport in ("soccer", "nhl") else ["cs"] if sport == "mlb" else [])
    stats = [dict(s, n=len(games)) for s in _team_stats(unit) if s["k"] in keys]
    up = sorted([u for u in t["upcoming"] if u.get("date")], key=lambda u: u["date"])
    nxt = up[0] if up else None
    lines = []
    if nxt:
        try:
            e = _next_event(sport, t, nxt)
            if e:
                home = bot.norm(e["home"]["name"]) == bot.norm(t["name"]) or e["home"]["id"] == t["id"]
                od, book = e.get("odds") or {}, ((e.get("odds") or {}).get("provider") or {}).get("name") or "DraftKings"
                sp = bot.num(od.get("spread"))
                if sp is not None:   # ESPN's spread is the home side's; covering means margin > -our spread
                    ours = sp if home else -sp
                    lines.append({"k": "mar", "line": -ours, "book": book, "kind": f"spread {'+' if ours > 0 else ''}{bot.fmt(ours)}", "pOver": None, "opp": nxt["opp"]})
                if bot.num(od.get("overUnder")) is not None:
                    lines.append({"k": "tot", "line": bot.num(od["overUnder"]), "book": book, "kind": "total", "pOver": None, "opp": nxt["opp"]})
                m = bot.market(e)
                if m:
                    lines.append({"k": "win", "line": 0.5, "book": book, "kind": "moneyline", "pOver": m["home" if home else "away"], "opp": nxt["opp"]})
                nxt["details"] = od.get("details") or ""
        except Exception:
            pass
    start = bot.season_start(sport)
    return {"kind": "team", "sport": sport, "sportLabel": bot.SPORTS[sport], "name": t["name"], "team": t.get("standing") or "", "photo": t["logo"], "abbr": t["abbr"],
            "record": t["record"], "unit": unit, "seasonStart": start.isoformat(), "stats": stats, "games": games, "lines": lines, "next": nxt,
            "roster": t["roster"][:60], "seasonStats": t["seasonStats"], "at": int(time.time())}


def handle(path, q, signed_in=False):
    """GET /api/lab/<path> -> (status, obj or (content_type, bytes))"""
    if path == "img":
        st, ct, data = img(q.get("u"))
        return st, (ct, data)
    if path == "fonts.css":
        return 200, ("text/css; charset=utf-8", fonts_css().encode())
    if path == "session":
        return session(q, signed_in)
    if not signed_in and not check_pass(q.get("_pass")):
        return 401, {"error": "Your Lab pass expired. Type /lab in Discord again.", "need": "lab"}
    try:
        sp = q.get("sport") or "nba"
        if sp in ("ufc", "boxing"):   # fighters: one fight is one game
            if path == "player":
                d = labfight.ufc(q.get("name") or "") if sp == "ufc" else labfight.box(q.get("name") or "")
                d["photo"] = img_url(d.get("photo"))
                return 200, d
            if path == "team":
                raise LookupError("Fight sports have fighters, not teams. Search a fighter on the Player tab.")
            if path == "board":
                return 200, {"sport": sp, "rows": [], "checked": 0, "errors": [], "note": "Sportsbooks don't post player props for fights. Search a fighter to see every fight, stat by stat."}
        if path == "player":
            return 200, player(sp, q.get("name") or "", q.get("stat") or "")
        if path == "team":
            return 200, team(sp, q.get("name") or "")
        if path == "board":
            return 200, board(sp)
    except LookupError as e:
        return 404, {"error": str(e)}
    except Exception as e:
        print(f"lab: /{path} failed: {type(e).__name__}: {e}")
        return 502, {"error": "A data source didn't answer. Try again in a minute."}
    return 404, {"error": "unknown"}
