"""Grades the picks posted in the server's pick channels and keeps each channel's record.

Every night at 12:30 AM Eastern the bot reads yesterday's posts in each pick channel (codex-props, claude-props,
instinct-props, codex-soccer, claude-soccer, instinct-soccer, cafe-picks, parlay-predictor, ez-picks), pulls out the
picks, grades them from ESPN box scores and results, and posts the results and each channel's record in
#verified-records. At 8:00 AM it checks again, grades anything that wasn't final yet (late games, stat corrections)
and posts an update only if something changed.

What it understands, from the card in each post:
  - TRACK|v1|... lines (exact; the codex cards already post these)
  - player props: "Luka Doncic OVER 27.5 pts", "Jalen Brunson O17.5 Pts", "Josh Hart 5+ Reb+Ast",
    "Karl-Anthony Towns: 8+ rebounds YES", "DERRICK HENRY OVER 39.5 RUSH YDS" (NBA, WNBA, NFL)
  - soccer: "Germany ML", "Iceland -1.5", "Hungary-NIR UNDER 2.5", "X vs Y – X NOT to score", "X vs Y – Draw",
    "X vs Y – Correct score 0-0", team totals and both teams to score
  - NBA/NFL moneylines and spreads: "Chiefs ML", "Knicks -3.5"
A card with two or more legs that is posted as a parlay also gets a parlay result. Picks posted only as images
(ez-picks screenshots) can't be read without paid AI, so they're skipped and the post says so.

Free: it runs inside the existing server and only calls ESPN and Discord. No AI.

Settings (all optional):
  DISCORD_TRACK_CHANNELS   channel names or IDs to grade (default: the nine above, found by name)
  DISCORD_RECORDS_CHANNEL  where results go (default: the channel named verified-records)
  DISCORD_TRACK_TIMES      Eastern times to run (default "00:30,08:00")

Try it on your computer with the bot token set:  python3 pick_tracker.py try 2026-11-17   (prints, posts nothing)
"""
import datetime as dt
import json
import os
import re
import sys
import threading
import time
from pathlib import Path

import discord_bot as B
import storage

DEFAULT_CHANNELS = ["codex-props", "claude-props", "instinct-props", "codex-soccer", "claude-soccer", "instinct-soccer",
                    "cafe-picks", "parlay-predictor", "ez-picks"]
EPOCH_MS = 1420070400000
D = {}
STATE = {"cards": {}, "posted": {}, "images": {}, "channels": {}, "dest": None}
_lock = threading.RLock()

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:          # no time-zone data: Eastern standard time
    ET = dt.timezone(dt.timedelta(hours=-5))


def now_et():
    return dt.datetime.now(ET)


# ---------- Discord ----------
def api(method, path, payload=None):
    return B.discord(method, path, payload, token=os.environ.get("DISCORD_BOT_TOKEN"))


def snowflake(t):
    return str((int(t.timestamp() * 1000) - EPOCH_MS) << 22)


def guild_channels():
    gid = os.environ.get("DISCORD_GUILD_ID")
    return [c for c in api("GET", f"/guilds/{gid}/channels") or [] if c.get("type") in (0, 5)] if gid else []


def bare(name):
    return re.sub(r"[^a-z0-9-]", "", (name or "").lower()).strip("-")


def resolve_channels():
    want = [x.strip() for x in re.split(r"[,\n]+", os.environ.get("DISCORD_TRACK_CHANNELS", "")) if x.strip()] or DEFAULT_CHANNELS
    chans = guild_channels()
    out = []
    for w in want:
        c = next((c for c in chans if c["id"] == w or bare(c["name"]) == bare(w) or bare(c["name"]).endswith(bare(w))), None)
        if c:
            out.append({"id": c["id"], "name": bare(c["name"]) or c["name"]})
    rec = os.environ.get("DISCORD_RECORDS_CHANNEL") or "verified-records"
    dest = next((c["id"] for c in chans if c["id"] == rec or bare(c["name"]).endswith(bare(rec))), None)
    return out, dest


def messages(cid, start, end):
    """Messages in a channel posted between two times, oldest first."""
    out, after = [], snowflake(start)
    for _ in range(10):
        page = api("GET", f"/channels/{cid}/messages?limit=100&after={after}") or []
        if not page:
            break
        page.sort(key=lambda m: int(m["id"]))
        for m in page:
            t = B.parse_date(m.get("timestamp"))
            if t and t < end:
                out.append(m)
        after = page[-1]["id"]
        if len(page) < 100 or (B.parse_date(page[-1].get("timestamp")) or end) >= end:
            break
    return out


def text_of(m):
    parts = [m.get("content") or ""]
    for e in m.get("embeds") or []:
        parts += [e.get("title") or "", e.get("description") or ""]
        for f in e.get("fields") or []:
            parts += [f.get("name") or "", f.get("value") or ""]
    t = "\n".join(p for p in parts if p)
    return re.sub(r"[*_`~]|<a?:\w+:\d+>|\|\|", "", t)


# ---------- reading picks out of a post ----------
STOP = re.compile(r"^\W*(add-?ons?\b|nba add-ons|nfl add-ons|safest|best value|strongest|math\b|parlay:|longshot|lock:|"
                  r"pp shortlist|no boost|sources?\b|couldn.?t verify|how (to|the)|notes|calibrated|singles:|price math)", re.I)
SECTION_END = re.compile(r"^\W*(nba |nfl |soccer )?add-ons\b|^\W*how to place|^\W*longshot", re.I)
EXTRA_ALIAS = {"rushyds": "ryd", "recyds": "reyd", "recyard": "reyd", "rushyd": "ryd", "passyd": "pyd", "receivingyds": "reyd",
               "rushingyds": "ryd", "passingyds": "pyd", "rushatt": "ratt", "rushattempt": "ratt", "boards": "reb", "rebound": "reb",
               "point": "pts", "assist": "ast", "ptsrebsasts": "pra", "pointsreboundsandassists": "pra", "reboundsandassists": "ra",
               "pointsandrebounds": "pr", "pointsandassists": "pa", "rebsasts": "ra", "pr": "pr", "threes": "3pm", "3s": "3pm",
               "3ptm": "3pm", "3pointers": "3pm", "reception": "rec", "recs": "rec", "rushrecyds": "rryd", "passtd": "ptd", "stls": "stl", "blks": "blk"}
PROP = re.compile(
    r"^(?:[#A]?\d{1,2}[.):]?\s*[—–-]?\s*|leg \d+\s*[—–-]\s*)?"
    r"(?P<name>[A-Za-zÀ-ÿ'’.\- ]{4,40}?)\s*(?:\([^)]{1,20}\))?\s*[:—–-]?\s*"
    r"(?:(?P<side>over|under|more|less|o|u)\s*(?P<line>\d+(?:\.\d+)?)|(?P<plus>\d+(?:\.\d+)?)\+)\s*"
    r"(?P<stat>[A-Za-z][A-Za-z+&./ ]{0,28}?)\s*(?=\(|—|–| - |\byes\b|\bno\b|\||•|,|$)(?P<yn>yes|no)?", re.I)
BAD_NAME = re.compile(r"^(over|under|nba|nfl|parlay|play|leg|the|total|game|team|hit|in|avg|averages|l\d+|last)\b", re.I)


def stat_key(sport, s):
    k = re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "").replace(" and ", ""))
    k = re.sub(r"(s)$", "", k) if k not in B.ALIAS.get(sport, {}) and k not in EXTRA_ALIAS else k
    for cand in (k, k + "s"):
        if cand in B.ALIAS.get(sport, {}):
            return B.ALIAS[sport][cand]
        if cand in EXTRA_ALIAS and EXTRA_ALIAS[cand] in B.STAT.get(sport, {}):
            return EXTRA_ALIAS[cand]
    return None


def clean_line(l):
    l = re.sub(r"^[^\w#(]+", "", l.strip())
    l = re.sub(r"^(?:#?\d{1,2}[.)]|[#A]\d{1,2}\s*[—–-])\s+", "", l)
    return re.sub(r"\s+", " ", l)


def parse_prop(l, soccer):
    m = PROP.match(l)
    if not m:
        return None
    name = m["name"].strip(" -—–:").strip()
    if len(name.split()) < 2 or BAD_NAME.match(name) or re.search(r"\bvs?\b|\bml\b", name, re.I):
        return None
    stat = m["stat"].strip()
    sport = None
    for sp in (("soccer",) if soccer else ("nba", "nfl")):
        k = stat_key(sp, stat)
        if k:
            sport = sp
            break
    if not sport:
        return None
    if m["plus"]:
        line, side = float(m["plus"]) - 0.5, "over"
    else:
        line = float(m["line"])
        side = "under" if m["side"].lower() in ("under", "u", "less") else "over"
    if (m["yn"] or "").lower() == "no":
        side = "under" if side == "over" else "over"
    if name.isupper():
        name = name.title()
    return {"t": "prop", "sport": sport, "player": name, "stat": k, "side": side, "line": line,
            "label": f"{name} {'O' if side == 'over' else 'U'}{B.fmt(line)} {B.STAT[sport][k]['l']}"}


TEAM = r"[A-Z][A-Za-zÀ-ÿ'’.&\- ]{1,28}?"


def parse_team_bet(l, soccer):
    l = re.sub(r"\s*[|•—–]\s*[+-]\d{3,4}\b.*$|\s+[|•]\s+.*$", "", l).strip()
    l = re.sub(r"\s+[+-]\d{3,4}(\s.*)?$", "", l).strip()
    l = re.sub(r"\s*\((?!team total|win by)[^)]*\)\s*$", "", l)
    m = re.match(rf"^(?P<a>{TEAM})\s+(?:vs\.?|v)\s+(?P<b>{TEAM})\s*[–—:-]\s*(?P<bet>.+)$", l)
    teams = None
    if m:
        teams, l = (m["a"].strip(), m["b"].strip()), m["bet"].strip()
    else:
        m = re.match(rf"^(?P<a>{TEAM})\s*-\s*(?P<b>{TEAM})\s+(?P<bet>(?:over|under|draw|btts|both).*)$", l, re.I)
        if m:
            teams, l = (m["a"].strip(), m["b"].strip()), m["bet"].strip()
    sport = "soccer" if soccer else None
    if re.match(r"^draw\b", l, re.I) and teams:
        return {"t": "draw", "sport": sport, "teams": teams, "label": f"{teams[0]} v {teams[1]} draw"}
    m = re.match(r"^correct score\s*(\d+)\s*[-–]\s*(\d+)", l, re.I)
    if m and teams:
        return {"t": "cs", "sport": sport, "teams": teams, "score": [int(m[1]), int(m[2])], "label": f"{teams[0]} v {teams[1]} {m[1]}-{m[2]}"}
    m = re.match(r"^(?:both teams to score|btts)\s*(yes|no)?", l, re.I)
    if m and teams:
        yes = (m[1] or "yes").lower() == "yes"
        return {"t": "btts", "sport": sport, "teams": teams, "yes": yes, "label": f"{teams[0]} v {teams[1]} BTTS {'yes' if yes else 'no'}"}
    m = re.match(r"^(over|under|o|u)\s*(\d+(?:\.\d+)?)\b", l, re.I)
    if m and teams:
        side = "over" if m[1].lower().startswith("o") else "under"
        return {"t": "total", "sport": sport, "teams": teams, "side": side, "line": float(m[2]), "label": f"{teams[0]} v {teams[1]} {side} {m[2]}"}
    m = re.match(rf"^(?P<t>{TEAM})\s+(?:(?P<no>not) to score|to score)(?:.*?(?:o|u)(?P<n>\d+\.\d))?", l, re.I)
    if m:
        t = m["t"].strip()
        side = "under" if m["no"] else "over"
        return {"t": "tt", "sport": sport, "team": t, "teams": teams, "side": side, "line": float(m["n"] or 0.5),
                "label": f"{t} {'not ' if side == 'under' else ''}to score"}
    m = re.match(rf"^(?P<t>{TEAM})\s+(?:ml|moneyline|to win|win)\b", l, re.I)
    if m:
        return {"t": "ml", "sport": sport, "team": m["t"].strip(), "teams": teams, "label": f"{m['t'].strip()} ML"}
    m = re.match(rf"^(?P<t>{TEAM})\s+(?P<n>[+-]\d+(?:\.\d)?)\b(?!\d)", l)
    if m and abs(float(m["n"])) < 40 and not re.match(r"^[+-]\d{3}", m["n"]):
        return {"t": "spread", "sport": sport, "team": m["t"].strip(), "teams": teams, "line": float(m["n"]), "label": f"{m['t'].strip()} {m['n']}"}
    return None


def parse_track(l):
    f = l.split("|")
    if len(f) < 12 or f[0] != "TRACK":
        return None
    sport = {"nba": "nba", "wnba": "wnba", "nfl": "nfl"}.get(f[4].lower())
    if not sport:
        return None
    k = stat_key(B.stat_sport(sport), f[9])
    if not k:
        return None
    side, line = f[10].lower(), float(f[11])
    if side in ("yes", "no"):
        side, line = ("over" if side == "yes" else "under"), line - 0.5
    return {"t": "prop", "sport": sport, "player": f[8], "stat": k, "side": "under" if side.startswith("u") else "over", "line": line,
            "event": f[14] if len(f) > 14 and f[14].isdigit() else None,
            "label": f"{f[8]} {'O' if side.startswith('o') else 'U'}{B.fmt(line)} {B.STAT[B.stat_sport(sport)][k]['l']}"}


def leg_key(g):
    if g["t"] == "prop":
        return f"prop|{B.norm(g['player'])}|{g['stat']}|{g['side']}|{g['line']}"
    return "|".join(str(x) for x in (g["t"], B.norm(g.get("team") or ""), *[B.norm(t) for t in (g.get("teams") or ())], g.get("side"), g.get("line"), g.get("yes"), g.get("score")))


def parse_message(text, soccer):
    """A post's cards: [(legs, is_parlay)], empty when the post isn't a card."""
    if re.search(r"^TRACK\|", text, re.M):
        legs = [g for g in (parse_track(l.strip()) for l in text.splitlines()) if g]
        return [(legs, False)] if legs else []
    i = re.search(r"(UPDATED )?FINAL CARD", text, re.I)
    head = re.search(r"DAILY LOCKS|PARLAY\s*[—–-]\s*[+-]\d|PARLAY CAFE|PLAY #\d|LADDER DAY|VALUE PARLAY|New TheParlayCafe post", text, re.I)
    if not i and (not head or re.search(r"BREAKDOWN", text[:200], re.I)):
        return []
    body = text[i.end():] if i else text
    legs, numbered = [], {}
    for raw in body.splitlines():
        l = clean_line(raw)
        if not l:
            continue
        if SECTION_END.search(l):
            break
        if STOP.search(l):
            continue
        n = re.match(r"^\W*(\d{1,2})[.)]\s+\S", raw)
        g = parse_prop(l, soccer) or parse_team_bet(l, soccer)
        if not g and n:   # a numbered pick we can't grade: kept, so a parlay is never called won without it
            g = {"t": "raw", "label": re.sub(r"\s*[—–]\s*[+-]\d{3,4}.*$", "", l)[:80], "result": "unknown"}
        if g:
            legs.append(g)
            if n:
                numbered[int(n[1])] = g
    if not legs:
        return []
    parlay = len(legs) > 1 and bool(re.search(r"PARLAY\s*[—–-]\s*[+-]\d|\d+\s*legs|LADDER DAY|PLAY #\d|Math:|=\s*[+-]\d{3}|VALUE PARLAY", text, re.I)) \
        and not re.search(r"no qualifying", text, re.I)
    cards = [(legs, parlay)]
    ref = re.search(r"Parlay:\s*((?:\d+\s*\+\s*)+\d+)", text, re.I)   # "Parlay: 1 + 3 + 4"
    if ref:
        sub = [numbered[int(x)] for x in re.findall(r"\d+", ref[1]) if int(x) in numbered]
        if len(sub) > 1:
            cards.append(([dict(g) for g in sub], True))
    return cards


# ---------- grading ----------
RUN = {"id": "0"}
LOOK_BACK = 4 * 86400        # a pick still not graded after four days is void


def player_value(g, after, final):
    """The stat in the player's first game after the post (or the TRACK line's game)."""
    sport = g["sport"]
    o = B.find_player(sport, g["player"])
    if not o:
        return ("void", None) if final else (None, None)
    path = f"{B.ESPN_PATH[sport].split('/')[0]}/{o.get('lg') or sport}"
    y = B.cur_season(sport)
    games = []
    for yy in (y, y - 1):
        try:
            got = B.get_json(f"{B.ESPN_WEB}/sports/{path}/athletes/{o['id']}/gamelog?season={yy}&r={RUN['id']}", 600)
        except Exception:
            got = None
        games += B.espn_season_from(got) if got else []
        if games:
            break
    games.sort(key=lambda x: x["date"])
    for x in games:
        if (g.get("event") and x["id"] == g["event"]) or (not g.get("event") and after <= x["date"] <= after + dt.timedelta(days=3)):
            v = B.STAT[B.stat_sport(sport)][g["stat"]]["get"](x)
            return ("final", v) if v is not None else ("void", None)
    return ("void", None) if final else (None, None)


def team_events(sport, after):
    days = sorted({(after + dt.timedelta(days=i)).astimezone(ET).date() for i in range(3)})
    out = []
    for sp in ([sport] if sport else ["nba", "nfl"]):
        path = "soccer/all" if sp == "soccer" else B.ESPN_PATH[sp]
        for d in days:
            try:
                sb = B.get_json(f"{B.ESPN}/{path}/scoreboard?dates={d:%Y%m%d}&r={RUN['id']}", 600) or {}
            except Exception:
                continue
            for e in sb.get("events") or []:
                ko = B.parse_date(e.get("date"))
                if ko and ko >= after:
                    out.append(e)
    seen, uniq = set(), []
    for e in sorted(out, key=lambda e: e.get("date") or ""):
        if e.get("id") not in seen:
            seen.add(e.get("id"))
            uniq.append(e)
    return uniq


def team_match(t, comp):
    tm = comp.get("team") or {}
    names = [tm.get(k) or "" for k in ("displayName", "shortDisplayName", "name", "location", "abbreviation")]
    n = B.norm(t)
    if any(n and n == B.norm(x) for x in names):
        return 1.0
    sim = D.get("similar") or (lambda a, b: 1.0 if B.norm(a) == B.norm(b) else 0.0)
    return max(sim(t, x) for x in names if x) if any(names) else 0


def find_event(g, evs):
    want = list(g.get("teams") or [g.get("team")])
    best, score = None, 0
    for e in evs:   # soonest first, so a later match of the same teams never wins a tie
        cs = ((e.get("competitions") or [{}])[0]).get("competitors") or []
        s = sum(max((team_match(t, c) for c in cs), default=0) for t in want if t) / max(1, len(want))
        if s > score + 0.01:
            best, score = e, s
    return best if score >= 0.8 else None


def grade_team(g, after, final):
    e = find_event(g, team_events(g.get("sport"), after))
    if not e:
        return ("void", None) if final else (None, None)
    comp = (e.get("competitions") or [{}])[0]
    st = (comp.get("status") or e.get("status") or {}).get("type") or {}
    if any(w in (st.get("name") or "").upper() for w in ("POSTPONED", "CANCELED", "CANCELLED", "ABANDONED")):
        return "void", None
    if st.get("state") != "post":
        return ("void", None) if final and st.get("state") == "pre" else (None, None)
    cs = comp.get("competitors") or []
    try:
        sc = {c.get("homeAway"): int(float(c.get("score"))) for c in cs}
    except (TypeError, ValueError):
        return None, None
    who = lambda t: max(cs, key=lambda c: team_match(t, c)).get("homeAway")
    other = lambda side: "away" if side == "home" else "home"
    hs, as_ = sc.get("home", 0), sc.get("away", 0)
    names = {c.get("homeAway"): ((c.get("team") or {}).get("abbreviation") or (c.get("team") or {}).get("shortDisplayName") or "") for c in cs}
    shown = f"{names.get('home')} {hs}-{as_} {names.get('away')}".strip()
    t = g["t"]
    if t == "ml":
        s = who(g["team"])
        return ("won" if sc[s] > sc[other(s)] else "lost"), shown
    if t == "spread":
        s = who(g["team"])
        m = sc[s] - sc[other(s)] + g["line"]
        return ("won" if m > 0 else "push" if m == 0 else "lost"), shown
    if t == "draw":
        return ("won" if hs == as_ else "lost"), shown
    if t == "cs":
        want = g["score"] if who(g["teams"][0]) == "home" else g["score"][::-1]
        return ("won" if [hs, as_] == want else "lost"), shown
    if t == "btts":
        return ("won" if (hs > 0 and as_ > 0) == g["yes"] else "lost"), shown
    if t in ("total", "tt"):
        v = hs + as_ if t == "total" else sc[who(g["team"])]
        if v == g["line"]:
            return "push", shown
        return ("won" if (v > g["line"]) == (g["side"] == "over") else "lost"), shown
    return None, None


def grade_leg(g, after, final):
    if g.get("result"):
        return False
    try:
        if g["t"] == "prop":
            status, v = player_value(g, after, final)
            if status == "final":
                g.update({"result": "push" if v == g["line"] else "won" if (v > g["line"]) == (g["side"] == "over") else "lost", "actual": B.fmt(v)})
                return True
            if status == "void":
                g.update({"result": "void", "actual": "DNP"})
                return True
            return False
        res, shown = grade_team(g, after, final)
        if res:
            g.update({"result": res, "actual": shown or ""})
            return True
    except Exception as e:
        print(f"pick tracker: couldn't grade {g.get('label')}: {type(e).__name__}: {e}", file=sys.stderr)
    return False


def card_result(c):
    rs = [g.get("result") for g in c["legs"]]
    if any(r == "lost" for r in rs):
        return "lost"
    if any(r is None for r in rs):
        return None
    if any(r == "unknown" for r in rs):
        return "unknown"
    return "won" if any(r == "won" for r in rs) else "void"


# ---------- reading the channels and grading ----------
def collect(hours=36):
    """Add new cards from the pick channels (posts from the last day and a half)."""
    chans, dest = resolve_channels()
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(hours=hours)
    with _lock:
        STATE["dest"] = dest
        STATE["channels"] = {c["id"]: c["name"] for c in chans}
    for c in chans:
        try:
            msgs = messages(c["id"], start, end)
        except Exception as e:
            print(f"pick tracker: can't read #{c['name']}: {e}", file=sys.stderr)
            continue
        soccer = "soccer" in c["name"]
        for m in msgs:
            text = text_of(m)
            at = B.parse_date(m.get("timestamp")) or end
            imgs = [a for a in m.get("attachments") or [] if (a.get("content_type") or "").startswith("image")]
            found = parse_message(text, soccer) if text.strip() else []
            with _lock:
                if not found and imgs:
                    STATE["images"].setdefault(c["id"], {})[m["id"]] = at.isoformat()
                recent = [x for x in STATE["cards"].values() if x["ch"] == c["id"] and abs((B.parse_date(x["at"]) - at).total_seconds()) < 86400]
                for n, (legs, parlay) in enumerate(found):
                    cid = f"{m['id']}:{n}"
                    if cid in STATE["cards"]:
                        continue
                    ck = sorted(leg_key(g) for g in legs)
                    if any(sorted(leg_key(g) for g in x["legs"]) == ck for x in recent):
                        continue   # the same card posted twice (a headline and its final card)
                    seen = {leg_key(g) for x in recent for g in x["legs"]}
                    for g in legs:
                        g["dup"] = leg_key(g) in seen   # repeated in a later card: one result in the record
                        seen.add(leg_key(g))
                    card = {"ch": c["id"], "msg": m["id"], "at": at.isoformat(), "parlay": parlay, "legs": legs, "result": None, "reported": False}
                    STATE["cards"][cid] = card
                    recent.append(card)


def grade_all(final):
    now = dt.datetime.now(dt.timezone.utc)
    with _lock:
        todo = [c for c in STATE["cards"].values() if c.get("result") is None]
    for c in todo:
        at = B.parse_date(c["at"])
        old = (now - at).total_seconds() > LOOK_BACK
        for g in c["legs"]:
            grade_leg(g, at - dt.timedelta(hours=1), final or old)
        c["result"] = card_result(c)


def tally(cards):
    t = {"won": 0, "lost": 0, "push": 0, "void": 0, "pending": 0, "pw": 0, "pl": 0}
    for c in cards:
        for g in c["legs"]:
            if g.get("dup") or g.get("result") == "unknown":
                continue
            t[g.get("result") or "pending"] += 1
        if c["parlay"]:
            t["pw"] += c.get("result") == "won"
            t["pl"] += c.get("result") == "lost"
    return t


def rec_txt(t):
    s = f"{t['won']}-{t['lost']}" + (f"-{t['push']}" if t["push"] else "")
    n = t["won"] + t["lost"]
    return s + (f" ({round(t['won'] / n * 100)}%)" if n else "")


MARK = {"won": "✅", "lost": "❌", "push": "➖", "void": "⚪", "unknown": "❔", None: "⏳"}


def settled(c):
    return all(g.get("result") for g in c["legs"])


def leaderboard(cards_by_ch):
    rows = [(STATE["channels"].get(ch, ch), tally(cs)) for ch, cs in cards_by_ch.items()]
    rows = [r for r in rows if r[1]["won"] + r[1]["lost"]]
    rows.sort(key=lambda x: (-(x[1]["won"] / max(1, x[1]["won"] + x[1]["lost"])), -x[1]["won"]))
    return "\n".join(f"**{i}.** #{n} — **{rec_txt(t)}**" + (f" · parlays {t['pw']}-{t['pl']}" if t["pw"] + t["pl"] else "")
                     for i, (n, t) in enumerate(rows, 1))


def report(update=False):
    """Results for every card that has finished since the last post, one embed per channel, plus the leaderboard."""
    with _lock:
        cards = sorted(STATE["cards"].values(), key=lambda c: c["at"])
        new = [c for c in cards if not c["reported"] and settled(c)]
        waiting = [c for c in cards if not settled(c)]
        images = {ch: len(v) for ch, v in STATE["images"].items() if v}
    by_ch = {}
    for c in new:
        by_ch.setdefault(c["ch"], []).append(c)
    embeds = []
    for ch, cs in by_ch.items():
        name = STATE["channels"].get(ch, ch)
        t = tally(cs)
        allc = [c for c in cards if c["ch"] == ch and settled(c)]
        at = tally(allc)
        lines = []
        for c in cs:
            if len(cs) > 1 or c["parlay"]:
                when = B.parse_date(c["at"]).astimezone(ET)
                lines.append(f"**{'Parlay' if c['parlay'] else 'Card'}** · {when:%a} {when.strftime('%I:%M %p').lstrip('0')}" + (f" {MARK[c['result']]}" if c["parlay"] else ""))
            for g in c["legs"]:
                if g.get("dup") and not c["parlay"]:
                    continue
                lines.append(f"{MARK[g.get('result')]} {g['label']}" + (f" · **{g['actual']}**" if g.get("actual") else ""))
        n = t["won"] + t["lost"]
        desc = "\n".join(lines)
        embeds.append({"title": f"#{name} · {rec_txt(t)}" + (f" · parlays {t['pw']}-{t['pl']}" if t["pw"] + t["pl"] else ""),
                       "color": B.GREY if not n else B.GREEN if t["won"] >= t["lost"] else B.RED,
                       "description": desc[:3900] + ("\n…" if len(desc) > 3900 else ""),
                       "footer": {"text": f"All-time: {rec_txt(at)}" + (f" · parlays {at['pw']}-{at['pl']}" if at["pw"] + at["pl"] else "")}})
    if not embeds:
        return None, []
    allby = {}
    for c in cards:
        if settled(c):
            allby.setdefault(c["ch"], []).append(c)
    lb = leaderboard(allby)
    notes = []
    if waiting:
        notes.append(f"⏳ {sum(1 for c in waiting for g in c['legs'] if not g.get('result') and not g.get('dup'))} pick(s) still waiting on a final — checked again at 8 AM and next night")
    for ch, n in images.items():
        notes.append(f"🖼️ #{STATE['channels'].get(ch, ch)}: {n} image post(s) can't be read automatically")
    embeds.append({"title": "🏆 All-time leaderboard", "color": B.BLUE, "description": (lb or "–") + ("\n\n" + "\n".join(notes) if notes else ""),
                   "footer": {"text": "Legs W-L · a pick repeated in a later card counts once · graded from ESPN box scores"}})
    d = now_et() - dt.timedelta(hours=9)
    return f"📊 {'Updated results' if update else 'Results'} — {d:%a %b} {d.day}", embeds


def post(dest, title, embeds):
    if not dest or not embeds:
        return
    for i in range(0, len(embeds), 10):
        api("POST", f"/channels/{dest}/messages", {"content": title if i == 0 else "", "embeds": embeds[i:i + 10], "allowed_mentions": {"parse": []}})


def run(final=False, dry=False):
    """Read new cards, grade everything pending, post what finished. Returns (title, embeds)."""
    RUN["id"] = str(int(time.time()) // 300)
    collect()
    grade_all(final)
    title, embeds = report(update=final)
    if embeds and not dry:
        post(STATE.get("dest"), title, embeds)
        with _lock:
            for c in STATE["cards"].values():
                if settled(c):
                    c["reported"] = True
            STATE["images"] = {}
    with _lock:   # keep four months
        cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=120)).isoformat()
        for k in [k for k, c in STATE["cards"].items() if c["at"] < cut]:
            STATE["cards"].pop(k, None)
    if not dry:
        save()
    return title, embeds


# ---------- schedule ----------
def _path():
    return Path(D["cache_dir"]) / "pick-tracker.json"


def save():
    with _lock:
        if D.get("cache_dir"):
            storage.save(_path(), STATE)


def times():
    out = []
    for x in re.split(r"[,\s]+", os.environ.get("DISCORD_TRACK_TIMES", "00:30,08:00")):
        m = re.fullmatch(r"(\d{1,2}):(\d\d)", x.strip())
        if m:
            out.append((int(m[1]), int(m[2])))
    return out or [(0, 30), (8, 0)]


def _loop():
    time.sleep(60)
    while True:
        try:
            t = now_et()
            for i, (hh, mm) in enumerate(times()):
                at = t.replace(hour=hh, minute=mm, second=0, microsecond=0)
                slot = f"{t.date()} {hh:02d}:{mm:02d}"
                # once, inside the hour after the set time (the server may be waking up at the exact minute)
                if at <= t < at + dt.timedelta(hours=1) and slot not in STATE["posted"]:
                    STATE["posted"][slot] = int(time.time())
                    for k in sorted(STATE["posted"])[:-60]:
                        STATE["posted"].pop(k, None)
                    save()
                    run(final=i > 0)
        except Exception as e:
            print(f"pick tracker: {type(e).__name__}: {e}", file=sys.stderr)
        time.sleep(60)


def setup(**deps):
    D.update(deps)
    if D.get("cache_dir"):
        got = storage.load(_path(), {})
        if isinstance(got, dict):
            STATE.update(got)
    if os.environ.get("DISCORD_BOT_TOKEN") and os.environ.get("DISCORD_GUILD_ID"):
        threading.Thread(target=_loop, daemon=True, name="pick-tracker").start()


# ---------- /leaderboard ----------
def cmd_leaderboard(o):
    days = int(o.get("days") or 0)
    cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat() if days else ""
    by = {}
    with _lock:
        for c in STATE["cards"].values():
            if c["at"] >= cut and settled(c):
                by.setdefault(c["ch"], []).append(c)
    lb = leaderboard(by)
    if not lb:
        return {"embeds": [{"title": "Pick channel leaderboard", "color": B.BLUE,
                            "description": "Nothing graded yet. Picks are graded every night at 12:30 AM ET and checked again at 8 AM."}]}
    return {"embeds": [{"title": "🏆 Pick channel leaderboard", "color": B.BLUE, "description": lb,
                        "footer": {"text": (f"Last {days} days" if days else "All time") + " · legs W-L, a repeated pick counts once · graded from ESPN"}}]}


def cmd_check(o):
    """/checkpicks: the nightly run, on demand."""
    title, embeds = run(final=False)
    with _lock:
        cards = list(STATE["cards"].values())
        chans = dict(STATE["channels"])
    waiting = sum(1 for c in cards for g in c["legs"] if not g.get("result") and not g.get("dup"))
    per = {}
    for c in cards:
        per[c["ch"]] = per.get(c["ch"], 0) + 1
    lines = [f"#{n}: {per.get(cid, 0)} card(s) found" for cid, n in chans.items()]
    return {"embeds": [{"title": "Pick check done", "color": B.BLUE, "description": "\n".join(lines) or "No pick channels found.",
                        "footer": {"text": ("Posted finished results in #verified-records" if embeds else "Nothing new finished yet")
                                   + (f" · {waiting} pick(s) still waiting on a final" if waiting else "")}}]}


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "try":   # read, grade and print; posts nothing, saves nothing
        hours = int(sys.argv[2]) if len(sys.argv) > 2 else 36
        RUN["id"] = str(int(time.time()))
        collect(hours)
        grade_all(final=False)
        for c in sorted(STATE["cards"].values(), key=lambda c: c["at"]):
            print(f"\n#{STATE['channels'].get(c['ch'])} {c['at'][:16]} {'PARLAY' if c['parlay'] else 'card'} -> {c['result']}")
            for g in c["legs"]:
                print(f"   {MARK[g.get('result')]} {g['label']}{' (repeat)' if g.get('dup') else ''} {g.get('actual') or ''}")
        title, embeds = report()
        print("\n" + (title or "nothing finished yet"))
        for e in embeds:
            print("\n## " + e["title"] + "\n" + (e.get("description") or "") + "\n" + (e.get("footer") or {}).get("text", ""))
    else:
        print(__doc__)
