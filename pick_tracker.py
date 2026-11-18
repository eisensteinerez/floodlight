"""Grades the picks posted in the server's pick channels and keeps each channel's record.

Every night at 12:30 AM Eastern the bot reads yesterday's posts in each pick channel (codex-props, claude-props,
instinct-props, codex-soccer, claude-soccer, instinct-soccer, cafe-picks, parlay-predictor), pulls out the
picks, grades them from ESPN box scores and results, and posts the results and each channel's record in
#verified-records, one post per channel plus a leaderboard. At 8:00 AM it checks again and posts only what finished
since (late games).

What it understands, from the card in each post:
  - TRACK|v1|... lines (exact; the codex cards already post these)
  - player props: "Luka Doncic OVER 27.5 pts", "Jalen Brunson O17.5 Pts", "Josh Hart 5+ Reb+Ast",
    "Karl-Anthony Towns: 8+ rebounds YES", "DERRICK HENRY OVER 39.5 RUSH YDS" (NBA, WNBA, NFL)
  - soccer: "Germany ML", "Iceland -1.5", "Hungary-NIR UNDER 2.5", "X vs Y – X NOT to score", "X vs Y – Draw",
    "X vs Y – Correct score 0-0", team totals and both teams to score
  - NBA/NFL moneylines and spreads: "Chiefs ML", "Knicks -3.5"
Each card counts as one play, like a parlay: every pick hits = a win, one miss = a loss, and a push or a player who
didn't play doesn't break it. The same card posted twice in a channel (or a short headline version of a bigger card)
counts once. ez-picks is left out: its picks are screenshots.

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
                    "cafe-picks", "parlay-predictor"]
EPOCH_MS = 1420070400000
D = {}
STATE = {"cards": {}, "posted": {}, "channels": {}, "icons": {}, "dest": None}
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


def guild_id():
    """DISCORD_GUILD_ID, or the server the bot is in."""
    gid = os.environ.get("DISCORD_GUILD_ID") or STATE.get("guild")
    if not gid:
        gs = api("GET", "/users/@me/guilds") or []
        gid = STATE["guild"] = gs[0]["id"] if gs else None
    return gid


def guild_channels():
    gid = guild_id()
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
            icon = re.match(r"^([^\w\s│|]+)", c["name"])
            out.append({"id": c["id"], "name": bare(c["name"]) or c["name"], "icon": icon[1].strip() if icon else "🎯"})
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
    return [(legs, parlay)]


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
    """A card is one play: every pick has to hit. A push or void doesn't break it; one miss loses it."""
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
        STATE.setdefault("icons", {}).update({c["id"]: c["icon"] for c in chans})
    for c in chans:
        time.sleep(0.8)   # Discord allows a few reads a second
        try:
            try:
                msgs = messages(c["id"], start, end)
            except Exception as e:
                if "429" not in str(e):
                    raise
                time.sleep(5)
                msgs = messages(c["id"], start, end)
        except Exception as e:
            print(f"pick tracker: can't read #{c['name']}: {e}", file=sys.stderr)
            continue
        soccer = "soccer" in c["name"]
        for m in msgs:
            text = text_of(m)
            found = parse_message(text, soccer) if text.strip() else []
            if not found:
                continue
            at = B.parse_date(m.get("timestamp")) or end
            legs, parlay = found[0]
            cid = m["id"]
            ck = {leg_key(g) for g in legs}
            with _lock:
                if cid in STATE["cards"]:
                    continue
                near = [(k, x) for k, x in STATE["cards"].items() if x["ch"] == c["id"] and not x.get("dropped")
                        and abs((B.parse_date(x["at"]) - at).total_seconds()) < 12 * 3600]
                # no duplicates in a channel: the same card posted twice, or a short version of a bigger card
                # (a headline and its final card), counts once
                if any(ck <= {leg_key(g) for g in x["legs"]} for _, x in near):
                    continue
                for k, x in near:
                    if {leg_key(g) for g in x["legs"]} < ck and not x.get("reported"):
                        x["dropped"] = True
                STATE["cards"][cid] = {"ch": c["id"], "msg": m["id"], "at": at.isoformat(), "parlay": parlay, "legs": legs, "result": None, "reported": False}


def cards_of(pred=lambda c: True):
    with _lock:
        return sorted((c for c in STATE["cards"].values() if not c.get("dropped") and pred(c)), key=lambda c: c["at"])


def grade_all(final):
    now = dt.datetime.now(dt.timezone.utc)
    for c in cards_of(lambda c: c.get("result") is None):
        at = B.parse_date(c["at"])
        old = (now - at).total_seconds() > LOOK_BACK
        for g in c["legs"]:
            grade_leg(g, at - dt.timedelta(hours=1), final or old)
        c["result"] = card_result(c)


def stats(cards):
    """W-L counting each card as one play, plus streak and the individual picks."""
    done = [c for c in cards if c.get("result") in ("won", "lost")]
    w = sum(c["result"] == "won" for c in done)
    streak, kind = 0, None
    for c in reversed(done):
        kind = kind or c["result"]
        if c["result"] != kind:
            break
        streak += 1
    legs = {}
    for c in cards:
        for g in c["legs"]:
            if g.get("result") in ("won", "lost"):
                legs[leg_key(g) + c["at"][:10]] = g["result"]
    lw = sum(r == "won" for r in legs.values())
    return {"won": w, "lost": len(done) - w, "n": len(done), "pct": w / len(done) if done else None,
            "streak": f"{'W' if kind == 'won' else 'L'}{streak}" if kind else "–", "lw": lw, "ll": len(legs) - lw,
            "pending": sum(1 for c in cards if c.get("result") is None)}


def pct(x):
    return "–" if x is None else f"{round(x * 100)}%"


def wl(s):
    return f"{s['won']}-{s['lost']}"


MARK = {"won": "✅", "lost": "❌", "push": "➖", "void": "⚪", "unknown": "❔", None: "⏳"}


def settled(c):
    return c.get("result") is not None


def board_block(by_ch):
    """The leaderboard as a lined-up table."""
    rows = [(STATE["channels"].get(ch, ch), stats(cs)) for ch, cs in by_ch.items()]
    rows = [r for r in rows if r[1]["n"]]
    rows.sort(key=lambda x: (-(x[1]["pct"] or 0), -x[1]["won"], x[1]["lost"]))
    if not rows:
        return ""
    w = max(len(n) for n, _ in rows)
    medal = ["🥇", "🥈", "🥉"]
    lines = [f"{'':3}{'CHANNEL'.ljust(w)}  {'W-L':>6}  {'WIN%':>4}  STRK"]
    for i, (n, s) in enumerate(rows):
        lines.append(f"{str(i + 1) + '.':3}{n.ljust(w)}  {wl(s):>6}  {pct(s['pct']):>4}  {s['streak']}")
    top = " ".join(f"{medal[i]} #{n}" for i, (n, _) in enumerate(rows[:3]))
    return top + "\n```\n" + "\n".join(lines) + "\n```"


def channel_report(ch, new, everything, update=False):
    """One channel's post: each finished card as one play, then today's and all-time records."""
    name, icon = STATE["channels"].get(ch, ch), STATE.get("icons", {}).get(ch, "🎯")
    today, alltime = stats(new), stats(everything)
    blocks = []
    for c in new:
        when = B.parse_date(c["at"]).astimezone(ET)
        res = c["result"]
        tag = {"won": "✅ **CASHED**", "lost": "❌ **MISSED**", "void": "⚪ **VOID**", "unknown": "❔ **CAN'T CONFIRM**"}.get(res, "⏳")
        hits = sum(g.get("result") == "won" for g in c["legs"])
        decided = sum(g.get("result") in ("won", "lost") for g in c["legs"])
        head = f"{tag} · {len(c['legs'])}-pick card · {hits}/{decided} hit · posted {when:%a} {when.strftime('%I:%M %p').lstrip('0')}"
        legs = [f"{MARK[g.get('result')]} {g['label']}" + (f" — **{g['actual']}**" if g.get("actual") else "") for g in c["legs"]]
        blocks.append(head + "\n" + "\n".join(legs))
    desc = "\n\n".join(blocks)
    if len(desc) > 3500:
        desc = desc[:3500] + "\n…"
    won = today["won"] >= today["lost"] and today["n"]
    color = B.GREY if not today["n"] else B.GREEN if won else B.RED
    return {"author": {"name": f"{icon}  {name.upper().replace('-', ' ')}"},
            "title": ("Updated results" if update else "Results") + f" · {wl(today)} today",
            "color": color, "description": desc,
            "fields": [{"name": "All-time", "value": f"**{wl(alltime)}**", "inline": True},
                       {"name": "Win rate", "value": f"**{pct(alltime['pct'])}**", "inline": True},
                       {"name": "Streak", "value": f"**{alltime['streak']}**", "inline": True},
                       {"name": "Picks hit", "value": f"{alltime['lw']}-{alltime['ll']}", "inline": True}],
            "footer": {"text": "Every card counts as one play: all picks hit = win, one miss = loss · pushes and DNPs don't break it"}}


def report(update=False):
    """[(content, embed)] to post: one message per channel with newly finished cards, then the leaderboard."""
    cards = cards_of()
    new = [c for c in cards if not c["reported"] and settled(c)]
    if not new:
        return []
    out = []
    d = now_et() - dt.timedelta(hours=9)
    by_new = {}
    for c in new:
        by_new.setdefault(c["ch"], []).append(c)
    for ch in STATE["channels"]:
        if ch in by_new:
            out.append(("", channel_report(ch, by_new[ch], [c for c in cards if c["ch"] == ch and settled(c)], update)))
    by_all = {}
    for c in cards:
        if settled(c):
            by_all.setdefault(c["ch"], []).append(c)
    waiting = sum(1 for c in cards if not settled(c))
    lb = board_block(by_all)
    out.append(("", {"title": "🏆 LEADERBOARD · ALL-TIME", "color": B.BLUE, "description": lb or "–",
                     "footer": {"text": "Cards W-L · graded from ESPN box scores and results" + (f" · {waiting} card(s) still waiting on a final" if waiting else "")}}))
    head = f"📊 **{'UPDATED RESULTS' if update else 'NIGHTLY RESULTS'} — {d:%A, %B} {d.day}**"
    out[0] = (head, out[0][1])
    return out


def post(dest, msgs):
    """Post the results; False (and nothing marked as reported) if Discord refused."""
    if not dest:
        STATE["postError"] = "There's no #verified-records channel."
        return False
    try:
        for content, embed in msgs:
            api("POST", f"/channels/{dest}/messages", {"content": content, "embeds": [embed], "allowed_mentions": {"parse": []}})
            time.sleep(0.6)
    except Exception as e:
        STATE["postError"] = ("The bot isn't allowed to post in #verified-records. Give the Floodlight role Send Messages and Embed Links there."
                              if "403" in str(e) else f"Posting the results failed: {e}")
        print(f"pick tracker: {STATE['postError']}", file=sys.stderr)
        return False
    STATE.pop("postError", None)
    return True


def run(final=False, dry=False):
    """Read new cards, grade everything pending, post what finished. Returns the messages."""
    RUN["id"] = str(int(time.time()) // 300)
    collect()
    grade_all(final)
    msgs = report(update=final)
    if msgs and not dry and post(STATE.get("dest"), msgs):
        with _lock:
            for c in STATE["cards"].values():
                if settled(c):
                    c["reported"] = True
    with _lock:   # keep four months
        cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=120)).isoformat()
        for k in [k for k, c in STATE["cards"].items() if c["at"] < cut]:
            STATE["cards"].pop(k, None)
    if not dry:
        save()
    return msgs


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
    if os.environ.get("DISCORD_BOT_TOKEN"):
        threading.Thread(target=_loop, daemon=True, name="pick-tracker").start()


# ---------- commands ----------
def cmd_leaderboard(o):
    days = int(o.get("days") or 0)
    cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat() if days else ""
    by = {}
    for c in cards_of(lambda c: c["at"] >= cut and settled(c)):
        by.setdefault(c["ch"], []).append(c)
    lb = board_block(by)
    if not lb:
        return {"embeds": [{"title": "🏆 Leaderboard", "color": B.BLUE,
                            "description": "Nothing graded yet. Cards are graded every night at 12:30 AM ET and checked again at 8 AM."}]}
    return {"embeds": [{"title": "🏆 LEADERBOARD · " + (f"LAST {days} DAYS" if days else "ALL-TIME"), "color": B.BLUE, "description": lb,
                        "footer": {"text": "Each card is one play: all picks hit = win · graded from ESPN"}}]}


def cmd_check(o):
    """/checkpicks: the nightly run, on demand."""
    msgs = run(final=False)
    cards = cards_of()
    per = {}
    for c in cards:
        per[c["ch"]] = per.get(c["ch"], 0) + 1
    waiting = sum(1 for c in cards if not settled(c))
    lines = [f"{STATE.get('icons', {}).get(cid, '🎯')} #{n}: {per.get(cid, 0)} card(s)" for cid, n in STATE["channels"].items()]
    return {"embeds": [{"title": "Pick check done", "color": B.BLUE, "description": "\n".join(lines) or "No pick channels found.",
                        "footer": {"text": (STATE.get("postError") or ("Posted finished results in #verified-records" if msgs else "Nothing new finished yet"))
                                   + (f" · {waiting} card(s) still waiting on a final" if waiting else "")}}]}


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "try":   # read, grade and print; posts nothing, saves nothing
        hours = int(sys.argv[2]) if len(sys.argv) > 2 else 36
        RUN["id"] = str(int(time.time()))
        collect(hours)
        grade_all(final=False)
        for c in cards_of():
            print(f"\n#{STATE['channels'].get(c['ch'])} {c['at'][:16]} -> {c['result']}")
            for g in c["legs"]:
                print(f"   {MARK[g.get('result')]} {g['label']} {g.get('actual') or ''}")
        for content, e in report():
            print("\n" + content + "\n## " + (e.get("author") or {}).get("name", "") + " " + e["title"] + "\n" + (e.get("description") or ""))
    else:
        print(__doc__)
