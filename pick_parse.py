"""Reading the picks out of the pick channels' posts. Text in, cards out: no network, so every rule here is tested.

The bots post a report as several Discord messages in a row. Those are joined into one post first. In a post:
  - TRACK|v1|... lines (codex) are exact and win outright.
  - Otherwise, if the post has a FINAL CARD (or UPDATED FINAL CARD), only that card counts.
  - Otherwise the picks listed under a card heading count: "NBA PARLAY", "PLAY #2", "LADDER BET", "TODAY'S PICK",
    "QUICK CARD", "MNF Longshot ...:". Breakdowns, add-ons, backups, notes, sources and change logs are skipped.
  - "PARLAY MATH: -426 x -178 = -108" says how many legs the parlay has, so the extra numbered legs listed after it
    (an "insurance" leg) are left out.
  - Practice posts and format previews are ignored.
Each card is keyed (channel, slate date, sport, play). A later card with the same key replaces the earlier one (the 6 PM
update replaces the 11:30 card), while different plays on the same day (Play #1 and Play #2, best bet and ladder)
are separate cards.
"""
import datetime as dt
import re
import unicodedata

import discord_bot as B

MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
PRACTICE = re.compile(r"practice post|practice\b.{0,20}\bformat|format (preview|test)|testing the new look|cloud test|test post", re.I)


def fold(s):
    """Accents off ("DONČIĆ" -> "DONCIC"), curly quotes straight; dashes and symbols kept."""
    s = "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c))
    return s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("\u00a0", " ")


def text_of(m):
    parts = [m.get("content") or ""]
    for e in m.get("embeds") or []:
        if (e.get("author") or {}).get("name"):
            parts.append(e["author"]["name"])
        parts += [e.get("title") or "", e.get("description") or ""]
        for f in e.get("fields") or []:
            parts += [f.get("name") or "", f.get("value") or ""]
        if (e.get("footer") or {}).get("text"):
            parts.append(e["footer"]["text"])
    t = "\n".join(p for p in parts if p)
    t = re.sub(r"<a?:\w+:\d+>|<t:\d+(?::\w)?>|<[@#&!]+\d+>", "", t)       # custom emoji, timestamps, mentions
    t = re.sub(r"\[([^\]]+)\]\(<?https?://[^)]+>?\)", r"\1", t)             # [text](link)
    t = re.sub(r"(?m)^[ \t]*(?:#{1,3}|-#|>>>|>)[ \t]+", "", t)                # # headings, -# subtext, > quotes
    return re.sub(r"\*\*|__|~~|\|\||`|(?<![\w*])[*_](?=\S)|(?<=\S)[*_](?![\w*])", "", t)


def group_posts(msgs):
    """Messages (oldest first) joined into posts: the same author, each message within 3 minutes of the last."""
    posts = []
    for m in msgs:
        a = m.get("author") or {}
        at = B.parse_date(m.get("timestamp"))
        if not at:
            continue
        p = posts[-1] if posts else None
        if p and p["author"] == a.get("id") and (at - p["last"]).total_seconds() <= 180:
            p["text"] += "\n" + text_of(m)
            p["last"] = at
        else:
            posts.append({"id": m["id"], "author": a.get("id"), "bot": bool(a.get("bot") or m.get("webhook_id")),
                          "at": at, "last": at, "text": text_of(m)})
    return posts


def slate_date(text, posted):
    """The date the post is for: the first date in its heading, else the day it was posted (Eastern)."""
    head = fold(text[:700])
    found = []
    for m in re.finditer(r"\b(20\d\d)-(\d\d)-(\d\d)\b", head):
        found.append((m.start(), int(m[1]), int(m[2]), int(m[3])))
    for m in re.finditer(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d\d))?", head, re.I):
        found.append((m.start(), int(m[3] or posted.year), MONTHS[m[1].lower()[:3]], int(m[2])))
    for _, y, mo, d in sorted(found):
        try:
            day = dt.date(y, mo, d)
        except ValueError:
            continue
        if day.year == posted.year and abs((day - posted).days) > 300:   # "Jan 2" posted on Dec 31
            day = day.replace(year=y + (1 if day < posted else -1))
        if -1 <= (day - posted).days <= 2:
            return day
    return posted


# ---------- one line -> one pick ----------
STAT_EXTRA = {"rushyds": "ryd", "rushyd": "ryd", "rushingyds": "ryd", "recyds": "reyd", "recyard": "reyd", "receivingyds": "reyd",
              "receivingyard": "reyd", "passyd": "pyd", "passingyds": "pyd", "passingyard": "pyd", "rushatt": "ratt", "rushattempt": "ratt",
              "carries": "ratt", "boards": "reb", "rebound": "reb", "point": "pts", "assist": "ast", "ptsrebsasts": "pra", "ptsrebast": "pra",
              "pointsreboundsandassists": "pra", "pointsreboundsassists": "pra", "reboundsandassists": "ra", "reboundsassists": "ra",
              "rebsasts": "ra", "pointsandrebounds": "pr", "pointsrebounds": "pr", "ptsrebs": "pr", "pointsandassists": "pa",
              "pointsassists": "pa", "ptsasts": "pa", "threes": "3pm", "3s": "3pm", "3ptm": "3pm", "3pointers": "3pm", "reception": "rec",
              "recs": "rec", "catches": "rec", "rushrecyds": "rryd", "passingrushing": "pryd", "passrush": "pryd", "passingrushingyds": "pryd",
              "passrushyds": "pryd", "passingandrushing": "pryd", "passingandrushingyards": "pryd", "passingrushingyards": "pryd",
              "passingrushingyard": "pryd", "passrushyard": "pryd", "passingrushyds": "pryd", "rushingreceivingyards": "rryd", "rushingreceiving": "rryd",
              "rushingandreceiving": "rryd", "passtd": "ptd", "stls": "stl", "blks": "blk", "td": "td", "tds": "td",
              "shotsontarget": "sot", "sot": "sot", "shot": "shots"}
PROP = re.compile(
    r"^(?P<name>[A-Za-z][A-Za-z'’.\- ]{2,40}?)\s*(?:\([^)]{1,24}\))?\s*[:—–-]?\s*"
    r"(?:(?P<side>over|under|more|less|o|u)\s*(?P<line>\d+(?:\.\d+)?)|(?P<plus>\d+(?:\.\d+)?)\+)\s*"
    r"(?P<stat>[A-Za-z0-9][A-Za-z0-9+&./ ]{0,30}?)\s*(?=\(|—|–| - |\byes\b|\bno\b|\||•|·|,|;|$)(?P<yn>yes|no)?", re.I)
ANYTIME = re.compile(r"^(?P<name>[A-Za-z][A-Za-z'’.\- ]{2,40}?)\s*(?:\([^)]{1,24}\))?\s*[:—–-]?\s*(?:anytime|to score an?y?time)\s+(?P<what>td|touchdown|goal|goalscorer|scorer)\b", re.I)
BAD_NAME = re.compile(r"^(over|under|nba|nfl|wnba|parlay|play|leg|legs|the|total|game|team|hit|hits|in|avg|averages|l\d+|last|form|season|"
                      r"streak|line|usage|odds|confidence|matchup|why|risk|note|needs|only|just|safest|best|math|singles|lock|"
                      r"value|longshot|add|backup|market|kalshi|fanduel|draftkings|book|units?)\b", re.I)


def stat_key(sport, s):
    k = re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "").replace(" and ", ""))
    alias, stats = B.ALIAS.get(B.stat_sport(sport), {}), B.STAT.get(B.stat_sport(sport), {})
    for cand in (k, k.rstrip("s"), k + "s"):
        if cand in stats:
            return cand
        if cand in alias:
            return alias[cand]
        if cand in STAT_EXTRA and STAT_EXTRA[cand] in stats:
            return STAT_EXTRA[cand]
    return None


def clean_line(l):
    l = re.sub(r"[0-9#*]\ufe0f?\u20e3|\U0001F51F", " ", fold(l))       # keycap numbers 1️⃣ ... 🔟
    l = re.sub(r"[\ufe0e\ufe0f\u200b-\u200d\u2060]", "", l).strip()
    l = re.sub(r"^[^\w#(+-]+", "", l)
    l = re.sub(r"^(?:(?:#|leg\s*)?\d{1,2}\s*[.):]\s*|#\d{1,2}\s*[—–-]?\s*|leg\s*\d{1,2}\s*[—–:-]\s*)", "", l, flags=re.I)
    l = re.sub(r"^(?:lock|best value|value|safest)\s*:\s*", "", l, flags=re.I)
    return re.sub(r"\s+", " ", l).strip()


def strip_price(l):
    """Drop the odds, book, units and notes after a pick."""
    l = re.sub(r"\s*\((?:kalshi|fanduel|fd|draftkings|dk|bet365|fanatics|pick finder|polymarket|prizepicks)[^)]*\)", "", l, flags=re.I)
    l = re.sub(r"\s*\(\d+\+\)", "", l)                                     # "O7.5 Rebounds (8+)"
    l = re.sub(r"\s*(?:\||•|·)\s.*$", "", l)                                 # " | -175 DK • 1U", " · Kalshi 79c"
    l = re.sub(r"\s*[—–]\s*[+-]?\s*\d{2,5}\b.*$", "", l)                     # " — -750 (...)"
    l = re.sub(r"\s+-\s+[+-]\d{3,5}\b.*$", "", l)                            # " - -115 (Bet365)"
    l = re.sub(r"\s+[+-]\d{3,5}\b(?!\.).*$", "", l)                          # " -186 (Kalshi) ..."
    l = re.sub(r"\s+-\s+(?:hit|avg|\d+/\d+|\d+ of|averag|l\d|season|he |she ).*$", "", l, flags=re.I)   # " - hit 35 of last 36"
    return l.strip(" -—–:,")


def parse_prop(l, sports):
    m = ANYTIME.match(l)
    if m:
        name = m["name"].strip(" -—–:")
        for sp in sports:
            k = "td" if sp == "nfl" and m["what"].lower().startswith(("td", "touch")) else "goals" if sp == "soccer" and m["what"].lower().startswith("goal") else None
            if k and k in B.STAT.get(B.stat_sport(sp), {}):
                return prop_leg(sp, name, k, "over", 0.5)
        return None
    m = PROP.match(l)
    if not m:
        return None
    name = m["name"].strip(" -—–:").strip()
    if len(name.split()) < 2 and not (sports == ("soccer",) and len(name) >= 4):
        return None
    if BAD_NAME.match(name) or re.search(r"\b(vs?|ml|@)\b|\d", name, re.I):
        return None
    stat = re.sub(r"\b(points?|pts)\s*(?:\+|&|and)\s*(rebounds?|rebs?)\s*(?:\+|&|and)\s*(assists?|asts?)\b", "pra", m["stat"].strip(), flags=re.I)
    stat = re.sub(r"\b(total|alt|line|ladder|in|yes|no)\b", "", stat, flags=re.I).strip()
    for sp in sports:
        k = stat_key(sp, stat)
        if k:
            break
    else:
        return None
    if m["plus"]:
        line, side = float(m["plus"]) - 0.5, "over"
    else:
        line = float(m["line"])
        side = "under" if m["side"].lower() in ("under", "u", "less") else "over"
    if (m["yn"] or "").lower() == "no":
        side = "under" if side == "over" else "over"
    return prop_leg(sp, tidy(name), k, side, line)


def tidy(name):
    """"JADEN McDANIELS" -> "Jaden Mcdaniels": shouted names read normally (ESPN's search ignores case)."""
    letters = [c for c in name if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        return " ".join(w if len(w) <= 2 and w.isupper() else w.title() for w in name.split())
    return name


def prop_leg(sport, name, k, side, line):
    lab = B.STAT[B.stat_sport(sport)][k]["l"]
    label = f"{name} anytime TD" if k == "td" and line == 0.5 else f"{name} {'O' if side == 'over' else 'U'}{B.fmt(line)} {lab}"
    return {"t": "prop", "sport": sport, "player": name, "stat": k, "side": side, "line": line, "label": label}


TEAM = r"[A-Z][A-Za-z0-9'’.&\- ]{1,30}?"


def parse_team_bet(l, sport):
    l = re.sub(r"\s*\((?!team total|win by)[^)]*\)\s*$", "", l).strip()
    l = re.sub(r"\s+(points|pts|goals|total points|total goals|total)\s*$", "", l, flags=re.I)
    teams = None
    m = re.match(rf"^(?P<a>{TEAM})\s+(?:vs\.?|v\.?|@|at)\s+(?P<b>{TEAM})\s*(?:[–—:]|\s-)\s*(?P<bet>.+)$", l)
    if m:
        teams, l = (m["a"].strip(), m["b"].strip()), m["bet"].strip()
    else:
        m = re.match(rf"^(?P<a>{TEAM})\s*-\s*(?P<b>{TEAM})\s+(?P<bet>(?:over|under|o\d|u\d|draw|btts|both).*)$", l, re.I)
        if m:
            teams, l = (m["a"].strip(), m["b"].strip()), m["bet"].strip()
    m = re.match(rf"^(?P<t>{TEAM})\s+(?:ml|moneyline|to win)\s+(?:vs\.?|v\.?|@|at)\s+(?P<o>{TEAM})\s*$", l)
    if m:
        t = m["t"].strip()
        return {"t": "ml", "sport": sport, "team": t, "teams": (t, m["o"].strip()), "label": f"{t} ML"}
    if re.match(r"^draw\b", l, re.I) and teams:
        return {"t": "draw", "sport": sport, "teams": teams, "label": f"{teams[0]} v {teams[1]} draw"}
    m = re.match(r"^correct score\s*(\d+)\s*[-–]\s*(\d+)", l, re.I)
    if m and teams:
        return {"t": "cs", "sport": sport, "teams": teams, "score": [int(m[1]), int(m[2])], "label": f"{teams[0]} v {teams[1]} {m[1]}-{m[2]}"}
    m = re.match(r"^(?:both teams to score|btts)\s*(yes|no)?", l, re.I)
    if m and teams:
        yes = (m[1] or "yes").lower() == "yes"
        return {"t": "btts", "sport": sport, "teams": teams, "yes": yes, "label": f"{teams[0]} v {teams[1]} BTTS {'yes' if yes else 'no'}"}
    m = re.match(r"^(over|under|o|u)\s*(\d+(?:\.\d+)?)\s*(?:total|points|pts|goals)?\s*(?:points|pts|goals)?\s*$", l, re.I)
    if m:
        side = "over" if m[1].lower().startswith("o") else "under"
        lab = f"{teams[0]} v {teams[1]} {side} {m[2]}" if teams else f"{side.title()} {m[2]}"
        return {"t": "total", "sport": sport, "teams": teams, "side": side, "line": float(m[2]), "label": lab}
    m = re.match(rf"^(?P<t>{TEAM})\s+(?:(?P<no>not) to score|to score)(?:.*?(?:o|u)(?P<n>\d+\.\d))?", l, re.I)
    if m:
        t = m["t"].strip()
        side = "under" if m["no"] else "over"
        return {"t": "tt", "sport": sport, "team": t, "teams": teams, "side": side, "line": float(m["n"] or 0.5),
                "label": f"{t} {'not ' if side == 'under' else ''}to score"}
    m = re.match(rf"^(?P<t>{TEAM})\s+(?:ml|moneyline|to win|win)\s*$", l, re.I)
    if m:
        t = tidy(m["t"].strip())
        return {"t": "ml", "sport": sport, "team": t, "teams": teams, "label": f"{t} ML"}
    m = re.match(rf"^(?P<t>{TEAM})\s+(?P<n>[+-]\d+(?:\.\d)?)(?:\s*\(win by \d\+?\))?\s*$", l)
    if m and abs(float(m["n"])) < 40:
        return {"t": "spread", "sport": sport, "team": m["t"].strip(), "teams": teams, "line": float(m["n"]), "label": f"{m['t'].strip()} {m['n']}"}
    return None


def parse_leg(raw, kind):
    """One line -> a pick, or None. kind is "soccer" or "props"."""
    l = strip_price(clean_line(raw))
    if not l or len(l) > 120:
        return None
    if kind == "soccer":
        return parse_team_bet(l, "soccer") or parse_prop(l, ("soccer",))
    return parse_prop(l, ("nba", "nfl")) or parse_team_bet(l, None)


def parse_track(l):
    f = l.strip().split("|")
    if len(f) < 12 or f[0] != "TRACK":
        return None
    sport = {"nba": "nba", "wnba": "wnba", "nfl": "nfl"}.get(f[4].lower())
    k = stat_key(sport, f[9]) if sport else None
    if not k:
        return {"t": "raw", "label": " ".join(f[8:12]), "result": "unknown"}
    side, line = f[10].lower(), float(f[11])
    if side in ("yes", "no"):
        side, line = ("over" if side == "yes" else "under"), line - 0.5
    g = prop_leg(sport, f[8], k, "under" if side.startswith("u") else "over", line)
    if len(f) > 14 and f[14].isdigit():
        g["event"] = f[14]
    return g, f[2], sport, f[3]


def leg_key(g):
    if g["t"] == "prop":
        return f"prop|{B.norm(g['player'])}|{g['stat']}|{g['side']}|{g['line']}"
    return "|".join(str(x) for x in (g["t"], B.norm(g.get("team") or ""), *[B.norm(t) for t in (g.get("teams") or ())],
                                     g.get("side"), g.get("line"), g.get("yes"), g.get("score")))


# ---------- a post -> cards ----------
STOP = re.compile(r"^\W*(?:(?:nba|nfl|wnba|soccer)\s+)?(?:add-?ons?|backup legs?|board notes|sources?|couldn.?t verify|how to place|how the ladder|"
                  r"full change log|changes since|\d+:\d\d\s*[ap]m update.{0,4}full change|tout desk|price check|early results|match outlooks?|"
                  r"lineups?\b|lineup update|prop research|player-prop|confirmed-starter|prizepicks|pp shortlist|value parlay|optional .*parlay|"
                  r"longshot|full breakdowns?|(?:nba|nfl)?\s*breakdowns?|leg-by-leg|updated pick breakdowns|predictions \+|why (?:these|we|i)|"
                  r"updated match forecasts|parlay\s*:|singles?\s*:|strongest|safest|best value\s*:|math\s*:|parlay math|notes from|upside|"
                  r"no boost|bet responsibly|a second play|full-slate|why only|these are|calibrated|staked-card|early ranked|"
                  r"no qualifying|no additional|dropped|added|still good|line moves?|injury (?:wire|note)|the overnight|what changed|"
                  r"exact scores|main four|completed matches|ranked forecasts)", re.I)
TITLE = re.compile(r"^\W*(?:daily locks|parlay cafe|parlay predictor|nations league|value card|new theparlaycafe|parlay ?predictor -)", re.I)


def header(l, kind):
    """A card heading: (play, sport) or None."""
    s = fold(l).strip()
    low = re.sub(r"^[^\w#]+", "", s).lower()
    if re.match(r"(updated\s+)?final card", low):
        return ("final", None)
    if re.match(r"optional|value parlay", low):
        return None
    m = re.match(r"play\s*#\s*(\d+)", low) or re.search(r"\bplay\s*#\s*(\d+)\s*[-—–:(]", low)
    if m:
        return (f"play{m[1]}", None)
    if re.match(r"ladder (bet|day)", low) or re.search(r"\bladder day \d", low):
        return ("ladder", None)
    if re.match(r"today'?s pick\b(?!s)|best bet\b", low):
        return ("best", None)
    if re.match(r"(updated\s+)?quick card|today'?s picks", low):
        return ("main", "soccer" if kind == "soccer" else None)
    m = re.match(r"(nba|nfl|wnba)\s+parlay\b(?!\s*math)", low) or re.match(r"(nba|nfl|wnba)?\s*parlay\s*[—–-]\s*[+-]\d", low)
    if m:
        return ("main", m[1])
    if kind != "soccer" and re.search(r"\blongshot\b", low) and s.rstrip().endswith(":"):
        return ("longshot", None)
    return None


def sport_line(l):
    """A sport heading inside a final card: "NFL — -117 (best book ...)", "NBA — -115 • 1u"."""
    m = re.match(r"^\W*(nba|nfl|wnba)\s*(?:[—–-]\s*[+-]?\d|parlay|$)", fold(l).strip(), re.I)
    return m[1].lower() if m else None


def leg_count(l):
    """How many legs a "PARLAY MATH: -426 x -178 = -108" line multiplies."""
    m = re.search(r"((?:[+-]\d{2,5}\s*(?:\([\d.]+\))?\s*[×x*]\s*)+[+-]\d{2,5}\s*(?:\([\d.]+\))?)\s*=", fold(l).replace("×", "x"))
    return len(re.findall(r"[+-]\d{2,5}", m[1])) if m else None


def sections(text, kind):
    """The post's card sections: [{"play", "sport", "final", "legs", "n"}]."""
    out, cur = [], None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        h = header(line, kind)
        if h:
            play, sport = h
            final = play == "final"
            if final or not (cur and cur["final"]):
                cur = {"play": "main" if final else play, "sport": sport, "final": final, "legs": [], "n": None, "on": True}
                out.append(cur)
            elif cur and cur["final"]:          # "PLAY #1 - 6 legs" inside a final card names its play
                cur["play"] = play if play != "main" else cur["play"]
                cur["sport"] = sport or cur["sport"]
            # a heading line can carry the first pick: "Play #2: 5 legs ..." doesn't, "LOCK: X" isn't a heading
            continue
        if not cur:
            continue
        sp = sport_line(line)
        if sp:
            if cur["final"] and cur["legs"]:      # a second sport in the same final card is a second card
                cur = {"play": cur["play"], "sport": sp, "final": True, "legs": [], "n": None, "on": True}
                out.append(cur)
            else:
                cur["sport"] = sp
            cur["on"] = True
            n = leg_count(line)
            if n and kind != "soccer":
                cur["n"] = n
            continue
        n = leg_count(line)
        if n:
            # the parlay's own math says how many legs it has (soccer picks are singles: never cut)
            if cur["on"] and kind != "soccer" and (not cur["final"] or cur["n"] is None):
                cur["n"] = n
            continue
        if re.match(r"^\W*no (nfl|nba|wnba) (games|slate)", line, re.I):
            continue
        if cur["final"] and re.match(r"^\W*(lock|best value|safest pick|strongest view)\s*:", line, re.I):
            continue                              # repeats a pick on the card
        if STOP.match(line):
            cur["on"] = False
            continue
        if TITLE.match(line) or not cur["on"]:
            continue
        g = parse_leg(line, kind)
        if g:
            if leg_key(g) not in {leg_key(x) for x in cur["legs"]}:
                cur["legs"].append(g)
        elif cur["final"] and re.match(r"^\W*\d{1,2}[.)]\s+\S", line):
            # a numbered pick on a final card that can't be read: kept, so the card is never called won without it
            cur["legs"].append({"t": "raw", "label": strip_price(clean_line(line))[:80], "result": "unknown"})
    for s in out:
        if s["n"] and 0 < s["n"] < len(s["legs"]):
            s["legs"] = s["legs"][:s["n"]]
    return [s for s in out if s["legs"]]


def borrow_teams(legs, text):
    """A total with no teams on the final card ("OVER 187.5 total points") takes them from the same line earlier in the post."""
    for g in legs:
        if g["t"] == "total" and not g.get("teams"):
            n = B.fmt(g["line"])
            m = re.search(rf"^\W*({TEAM})\s+(?:vs\.?|v\.?|@|at|-)\s+({TEAM})\s*(?:[–—:-]\s*)?(?:over|under|o|u)\s*{re.escape(n)}\b", fold(text), re.M | re.I)
            if m:
                g["teams"] = (m[1].strip(), m[2].strip())
                g["label"] = f"{g['teams'][0]} v {g['teams'][1]} {g['side']} {n}"
        elif g["t"] in ("ml", "spread", "tt") and not g.get("teams"):
            # "Ireland ML" on the final card, "Ireland ML vs Kosovo" earlier: the opponent pins down the match
            t = re.escape(g["team"])
            m = re.search(rf"\b{t}\s+(?:ml\s+|moneyline\s+)?(?:vs\.?|v\.?|@|-)\s+({TEAM})(?=\s*(?:[|•·(—–,:]|-\s|\s[+-]?\d|\s(?:ml|over|under|draw|btts)\b|$))", fold(text), re.M | re.I) \
                or re.search(rf"^\W*(?:\d+[.)]\s*)?({TEAM})\s+(?:vs\.?|v\.?|@|-)\s+{t}\b", fold(text), re.M | re.I)
            if m and B.norm(m[1]) != B.norm(g["team"]) and not re.search(r"\d", m[1]):
                g["teams"] = (g["team"], m[1].strip()) if B.norm(m[0]).startswith(B.norm(g["team"])) else (m[1].strip(), g["team"])
    return legs


def cards_in(post, kind, posted_et):
    """A post's cards: [{"play", "sport", "slate", "legs"}]. Empty for practice posts and posts with no card."""
    text = post["text"]
    if PRACTICE.search(text[:400]):
        return []
    tracks = [parse_track(l) for l in text.splitlines() if l.strip().startswith("TRACK|")]
    tracks = [t for t in tracks if t]
    if tracks:
        cards = {}
        for t in tracks:
            if isinstance(t, dict):
                continue
            g, play, sport, day = t
            try:
                slate = dt.date.fromisoformat(day)
            except ValueError:
                slate = slate_date(text, posted_et)
            c = cards.setdefault((play, sport), {"play": play, "sport": sport, "slate": slate, "legs": []})
            c["legs"].append(g)
        return list(cards.values())
    slate = slate_date(text, posted_et)
    secs = sections(text, kind)
    if any(s["final"] for s in secs):
        plays = {s["play"] for s in secs if not s["final"]} - {"main"}
        secs = [s for s in secs if s["final"]]
        if len(plays) == 1:                       # "TODAY'S PICK" ... FINAL CARD: the final card is that play
            for s in secs:
                if s["play"] == "main":
                    s["play"] = next(iter(plays))
    out = []
    for s in secs:
        legs = borrow_teams(s["legs"], text)
        sport = "soccer" if kind == "soccer" else s["sport"] or next((g["sport"] for g in legs if g.get("sport")), None) or "nba"
        for g in legs:
            if g["t"] != "prop" and g["t"] != "raw" and not g.get("sport"):
                g["sport"] = sport
        out.append({"play": s["play"], "sport": sport, "slate": slate, "legs": legs})
    return out
