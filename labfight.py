"""Floodlight Lab: UFC and boxing fighters, in the same shape lab.py returns for a player.

UFC   ESPN: search -> athlete profile -> the yearly scoreboards (which fights, when, against whom)
      -> each event's fightcenter (that fighter's strikes, takedowns, control time). A "game" is one fight.
Boxing  Wikipedia: the infobox (boxing.fighter) and the "Professional boxing record" table, one row per bout.
Both return {sport, name, team, photo, pos, stats:[{k,l,n}], games:[{date, opp, res, score, comp, min, v:{k: value}}]}.
"""
import datetime
import re
import urllib.parse

import discord_bot as bot
import boxing

ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
ESPN_FC = "https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/fightcenter/"
ESPN_ATH = "https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/athletes/"
ESPN_SEARCH = "https://site.web.api.espn.com/apis/common/v3/search"

UFC_STATS = {"ss": "Sig. strikes landed", "ssa": "Sig. strikes thrown", "ssp": "Sig. strike accuracy %", "ts": "Total strikes landed", "head": "Head strikes landed",
             "body": "Body strikes landed", "leg": "Leg strikes landed", "td": "Takedowns landed", "tda": "Takedowns tried", "kd": "Knockdowns", "sub": "Submission attempts",
             "ctrl": "Control time (min)", "len": "Fight length (min)", "ssm": "Sig. strikes per minute"}
BOX_STATS = {"rnd": "Rounds fought", "ko": "Won by KO/TKO", "w": "Won", "dist": "Went the distance"}


def _pair(s):
    m = re.match(r"\s*(\d+)\s*/\s*(\d+)", str(s or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def _secs(s):
    m = re.match(r"\s*(\d+):(\d+)", str(s or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _find_ufc(name):
    q = urllib.parse.urlencode({"query": name, "type": "player", "sport": "mma", "limit": 8})
    items = (bot.get_json(f"{ESPN_SEARCH}?{q}", 86400) or {}).get("items") or []
    n = bot.norm(name)
    items = [x for x in items if "mma" in str(x.get("sport") or x.get("defaultLeagueSlug") or x.get("league") or "mma")]
    if not items:
        raise LookupError(f"Couldn't find a UFC fighter called {name}.")
    best = next((x for x in items if bot.norm(x.get("displayName")) == n), items[0])
    return str(best.get("id"))


def ufc(name):
    aid = _find_ufc(name)
    a = (bot.get_json(ESPN_ATH + aid, 86400) or {}).get("athlete") or {}
    ss = {s.get("name"): s.get("displayValue") for s in (a.get("statsSummary") or {}).get("statistics") or []}
    now = datetime.date.today()
    fights = []
    for y in range(now.year, now.year - 7, -1):
        try:
            d = bot.get_json(f"{ESPN_SITE}?dates={y}", 900 if y == now.year else 7 * 86400) or {}
        except Exception:
            continue
        for ev in d.get("events") or []:
            for c in ev.get("competitions") or []:
                ids = [str((x.get("athlete") or {}).get("id") or x.get("id")) for x in c.get("competitors") or []]
                if aid in ids:
                    fights.append((ev, c))
        if len(fights) >= 14:
            break
    fights.sort(key=lambda x: x[1].get("date") or x[0].get("date") or "", reverse=True)
    games, nxt = [], None
    for ev, c in fights[:14]:
        st = (c.get("status") or {}).get("type") or {}
        me = next((x for x in c.get("competitors") or [] if str((x.get("athlete") or {}).get("id") or x.get("id")) == aid), {})
        op = next((x for x in c.get("competitors") or [] if x is not me), {})
        opn = (op.get("athlete") or {}).get("displayName") or ""
        if st.get("state") != "post":
            nxt = nxt or {"opp": opn, "date": c.get("date") or ev.get("date"), "home": None}
            continue
        # this fighter's numbers for the night, from the event's fightcenter
        stats, how, rnd, clock = {}, "", (c.get("status") or {}).get("period") or 0, (c.get("status") or {}).get("displayClock") or ""
        try:
            fc = bot.get_json(f"{ESPN_FC}{ev['id']}?region=us&lang=en", 7 * 86400) or {}
            for card in (fc.get("cards") or {}).values():
                for k in card.get("competitions") or []:
                    if str(k.get("id")) == str(c.get("id")):
                        x = next((y for y in k.get("competitors") or [] if str((y.get("athlete") or {}).get("id")) == aid), {})
                        stats = {s.get("name"): s.get("displayValue") for s in x.get("stats") or []}
                        r = (k.get("status") or {}).get("result") or {}
                        how = r.get("displayName") or ""
                        rnd = (k.get("status") or {}).get("period") or rnd
                        clock = (k.get("status") or {}).get("displayClock") or clock
        except Exception:
            pass
        v = {}
        ss_l, ss_a = _pair(stats.get("sigStrikes"))
        if ss_l is not None:
            v["ss"], v["ssa"] = ss_l, ss_a
            if ss_a:
                v["ssp"] = round(ss_l / ss_a * 100)
        for k, src in (("ts", "totalStrikes"), ("head", "headStrikes"), ("body", "bodyStrikes"), ("leg", "legStrikes")):
            n_, _ = _pair(stats.get(src))
            if n_ is not None:
                v[k] = n_
        td, tda = _pair(stats.get("takedowns"))
        if td is not None:
            v["td"], v["tda"] = td, tda
        for k, src in (("kd", "knockDowns"), ("sub", "submissions")):
            if stats.get(src) not in (None, ""):
                v[k] = bot.num(stats.get(src))
        ctrl = _secs(stats.get("timeInControl"))
        if ctrl is not None:
            v["ctrl"] = round(ctrl / 60, 1)
        el = _secs(clock)
        length = round(((rnd or 1) - 1) * 5 + (el / 60 if el is not None else 5), 1)
        v["len"] = length
        if ss_l is not None and length:
            v["ssm"] = round(ss_l / length, 2)
        res = "W" if me.get("winner") else "L" if op.get("winner") else "D"
        games.append({"id": str(c.get("id")), "date": (c.get("date") or ev.get("date") or "")[:10], "opp": opn, "oppAbbr": "", "home": None, "comp": ev.get("name") or "",
                      "res": res, "score": f"{how} R{rnd} {clock}".strip(), "min": length, "v": {k: x for k, x in v.items() if x is not None}})
    stats = [{"k": k, "l": l, "n": sum(1 for g in games if k in g["v"])} for k, l in UFC_STATS.items()]
    return {"kind": "player", "sport": "ufc", "sportLabel": "UFC", "name": a.get("displayName") or name, "team": (a.get("weightClass") or {}).get("text") or "",
            "photo": (a.get("headshot") or {}).get("href") or f"https://a.espncdn.com/i/headshots/mma/players/full/{aid}.png", "crest": "",
            "pos": " · ".join(x for x in (ss.get("wins-losses-draws"), a.get("nickname") and f"“{a['nickname']}”") if x), "next": nxt, "want": None,
            "seasonStart": f"{now.year}-01-01", "stats": [s for s in stats if s["n"]], "games": games, "lines": []}


# ---------- boxing ----------
def _record_rows(text):
    """The 'Professional boxing record' wikitable: one dict per bout, newest first."""
    m = re.search(r"==\s*Professional (?:boxing )?record\s*==(.*?)(?:\n==[^=]|\Z)", text, re.S | re.I)
    if not m:
        return []
    out = []
    for row in re.split(r"\n\|-", m.group(1))[1:]:
        cells = []
        for c in re.split(r"\|\||\n\|", row):
            if not c.strip() or c.strip().startswith("!"):
                continue
            c = re.sub(r"<[^>]+>|'''?", "", c)
            c = re.sub(r"\{\{(?:small|nowrap|sort|dts|abbr|flagicon)\|([^}|]*)[^}]*\}\}", r"\1", c)
            cells.append(re.sub(r"\{\{[^{}]*\}\}", "", c).strip())
        cells = [re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", c) for c in cells]
        cells = [re.sub(r"^[a-z-]+=\"[^\"]*\"\s*\|", "", c).strip() for c in cells]
        if len(cells) < 7 or not re.match(r"^\d+$", cells[0]):
            continue
        out.append({"n": int(cells[0]), "res": cells[1], "rec": cells[2], "opp": cells[3], "type": cells[4], "rnd": cells[5], "date": cells[6], "where": cells[7] if len(cells) > 7 else "", "note": cells[8] if len(cells) > 8 else ""})
    return sorted(out, key=lambda r: -r["n"])


def box(name):
    f = boxing.fighter(name)
    if not f.get("found"):
        raise LookupError(f"Couldn't find a boxer called {name} on Wikipedia.")
    qs = urllib.parse.urlencode({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": 1, "format": "json", "formatversion": 2, "titles": f["title"]})
    d = boxing.fs._get(f"{boxing.WIKI}?{qs}", 86400, {"Referer": "https://en.wikipedia.org/", "Accept": "application/json"}, as_json=True) or {}
    p = ((d.get("query") or {}).get("pages") or [{}])[0]
    text = (p.get("revisions") or [{}])[0].get("slots", {}).get("main", {}).get("content", "")
    games = []
    for r in _record_rows(text)[:40]:
        w = 1 if r["res"].lower().startswith("win") else 0
        rnd = re.match(r"(\d+)", r["rnd"] or "")
        stop = bool(re.search(r"\b(T?KO|RTD|DQ)\b", r["type"]))
        dt = None
        for fmt in ("%Y-%m-%d", "%d %b %Y", "%b %d, %Y", "%d %B %Y", "%B %d, %Y"):
            try:
                dt = datetime.datetime.strptime(re.sub(r"\s+", " ", r["date"]).strip(), fmt).date()
                break
            except ValueError:
                pass
        v = {"w": w, "ko": 1 if (w and stop) else 0, "dist": 0 if stop else 1}
        if rnd:
            v["rnd"] = int(rnd.group(1))
        games.append({"id": f"b{r['n']}", "date": dt.isoformat() if dt else "", "opp": r["opp"], "oppAbbr": "", "home": None, "comp": r["note"][:60],
                      "res": "W" if w else "L" if r["res"].lower().startswith("loss") else "D", "score": f"{r['type']} {r['rnd']}".strip(), "min": v.get("rnd", 0) * 3, "v": v})
    games = [g for g in games if g["date"]]
    stats = [{"k": k, "l": l, "n": sum(1 for g in games if k in g["v"])} for k, l in BOX_STATS.items()]
    rec = f"{f.get('wins') or 0}-{f.get('losses') or 0}" + (f"-{f['draws']}" if f.get("draws") else "")
    return {"kind": "player", "sport": "boxing", "sportLabel": "Boxing", "name": f["name"], "team": f.get("division") if "{{" not in (f.get("division") or "") else "",
            "photo": f.get("photo") or "", "crest": "", "pos": " · ".join(x for x in (rec, f.get("ko") is not None and f"{f['ko']} KOs") if x), "next": None, "want": None,
            "seasonStart": f"{datetime.date.today().year}-01-01", "stats": [s for s in stats if s["n"]], "games": games, "lines": []}
