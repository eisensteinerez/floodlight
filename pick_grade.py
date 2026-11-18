"""Grading picks against real results. Nothing is guessed: a pick is graded only when its game is found for certain.

  - NBA/NFL player props: the player's ESPN game log, the game on the card's date (or the TRACK line's game id).
    A player with no game that day is a DNP (void) only once the day is over, so a late game is never voided early.
  - NBA/NFL moneylines, spreads, totals: ESPN's scoreboard for the card's date.
  - Soccer: FotMob's results for the card's date (ESPN's as a backup), graded on the 90-minute score.
Team names are matched strictly: "Ireland" is never "Northern Ireland" or "Ireland U21", and when two matches fit a
pick equally well it isn't graded at all. A pick that can't be found is marked unknown ("couldn't verify") instead of
being called won or lost, and its card stays out of the record.
"""
import datetime as dt
import difflib
import re
import sys

import discord_bot as B
import pick_parse as P

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:
    ET = dt.timezone(dt.timedelta(hours=-5))

FM = "https://www.fotmob.com"
D = {}                       # fetch(url, ttl, as_json=True), now() for tests
RUN = {"id": "0"}


def now():
    return D["now"]() if D.get("now") else dt.datetime.now(dt.timezone.utc)


def window(slate):
    """A card's games: from midnight Eastern on its date to 6 AM the next morning (late West Coast tips)."""
    start = dt.datetime(slate.year, slate.month, slate.day, tzinfo=ET)
    return start.astimezone(dt.timezone.utc), (start + dt.timedelta(hours=30)).astimezone(dt.timezone.utc)


def day_over(slate, extra=0):
    return now() > window(slate)[1] + dt.timedelta(hours=extra)


def get(url, ttl=300):
    if D.get("fetch"):
        return D["fetch"](url, ttl, as_json=True)
    return B.get_json(url, ttl)


# ---------- team names ----------
ALIASES = {"nir": "northern ireland", "n ireland": "northern ireland", "ni": "northern ireland", "roi": "ireland",
           "republic of ireland": "ireland", "rep of ireland": "ireland", "bih": "bosnia and herzegovina", "bosnia": "bosnia and herzegovina",
           "bosnia herzegovina": "bosnia and herzegovina", "usa": "united states", "usmnt": "united states", "us": "united states",
           "korea republic": "south korea", "republic of korea": "south korea", "turkiye": "turkey", "czechia": "czech republic",
           "ivory coast": "cote d ivoire", "uae": "united arab emirates", "man utd": "manchester united", "man united": "manchester united",
           "man city": "manchester city", "psg": "paris saint germain", "paris sg": "paris saint germain", "spurs": "tottenham hotspur",
           "wolves": "wolverhampton wanderers", "atleti": "atletico madrid", "inter milan": "inter", "internazionale": "inter",
           "macedonia": "north macedonia", "fyr macedonia": "north macedonia", "holland": "netherlands", "england u21": "england u21"}
DROP = {"fc", "cf", "afc", "sc", "fk", "sk", "cd", "the", "club"}
# words that make a different team: "Ireland" isn't "Northern Ireland", "Germany" isn't "Germany U21"
QUAL = {"north", "northern", "south", "southern", "east", "eastern", "west", "western", "new", "central", "equatorial", "bissau",
        "dr", "u17", "u18", "u19", "u20", "u21", "u22", "u23", "women", "womens", "w", "ii", "b", "reserves", "youth", "olympic"}


def canon(s):
    n = B.norm(P.fold(s).replace("&", " and "))
    n = ALIASES.get(n, n)
    return " ".join(t for t in n.split() if t not in DROP)


def name_score(a, b):
    """1 for the same team, 0.9 for a shorter form of it ("Bosnia" / "Bosnia and Herzegovina"), else 0."""
    ca, cb = canon(a), canon(b)
    if not ca or not cb:
        return 0
    if ca == cb:
        return 1.0
    ta, tb = set(ca.split()), set(cb.split())
    if (ta ^ tb) & QUAL:
        return 0
    if (ta <= tb or tb <= ta) and max((len(t) for t in ta & tb), default=0) >= 4:
        return 0.9
    r = difflib.SequenceMatcher(None, ca, cb).ratio()
    return r if r >= 0.9 and len(ca) >= 5 and ca[0] == cb[0] else 0


def find_match(leg, matches):
    """The one match a pick is about, with the side each named team is on. (match, sides) or (None, why)."""
    teams = [t for t in (leg.get("teams") or [leg.get("team")]) if t]
    if not teams:
        return None, "no team"
    cands = []
    for m in matches:
        total, sides = 0, {}
        for t in teams:
            sh = max((name_score(t, x) for x in m["hn"]), default=0)
            sa = max((name_score(t, x) for x in m["an"]), default=0)
            s, side = (sh, "home") if sh >= sa else (sa, "away")
            if s < 0.85 or side in sides.values():
                break
            total += s
            sides[t] = side
        else:
            cands.append((total / len(teams), m, sides))
    if not cands:
        return None, "not found"
    cands.sort(key=lambda c: -c[0])
    if len(cands) > 1 and cands[1][0] >= cands[0][0] - 0.01 and cands[1][1]["id"] != cands[0][1]["id"]:
        return None, "two matches fit"
    return cands[0][1], cands[0][2]


# ---------- soccer results ----------
def fm_matches(slate):
    lo, hi = window(slate)
    out = {}
    for d in (slate - dt.timedelta(days=1), slate, slate + dt.timedelta(days=1)):
        try:
            data = get(f"{FM}/api/data/matches?date={d:%Y%m%d}", 300) or {}
        except Exception as e:
            print(f"pick grade: FotMob {d}: {e}", file=sys.stderr)
            continue
        for lg in data.get("leagues") or []:
            for m in lg.get("matches") or []:
                st = m.get("status") or {}
                ko = B.parse_date(st.get("utcTime"))
                if not ko or not lo <= ko < hi:
                    continue
                h, a = m.get("home") or {}, m.get("away") or {}
                short = ((st.get("reason") or {}).get("short") or "").lower()
                state = "void" if st.get("cancelled") or short in ("pp", "canc", "abd", "postp", "susp") else \
                    "post" if st.get("finished") else "live" if st.get("started") else "pre"
                out[str(m.get("id"))] = {"src": "fm", "id": str(m.get("id")), "ko": ko, "state": state,
                                         "hn": [x for x in (h.get("name"), h.get("longName")) if x],
                                         "an": [x for x in (a.get("name"), a.get("longName")) if x],
                                         "home": h.get("name"), "away": a.get("name"), "hs": h.get("score"), "as": a.get("score"),
                                         "reg": short not in ("aet", "pen", "ap", "aw")}
    return list(out.values())


def espn_soccer(slate):
    lo, hi = window(slate)
    out = {}
    for d in (slate, slate + dt.timedelta(days=1)):
        try:
            sb = get(f"{B.ESPN}/soccer/all/scoreboard?dates={d:%Y%m%d}&r={RUN['id']}", 300) or {}
        except Exception as e:
            print(f"pick grade: ESPN soccer {d}: {e}", file=sys.stderr)
            continue
        for e in sb.get("events") or []:
            m = espn_event(e, lo, hi)
            if m:
                out[m["id"]] = m
    return list(out.values())


def espn_event(e, lo, hi):
    ko = B.parse_date(e.get("date"))
    if not ko or not lo <= ko < hi:
        return None
    comp = (e.get("competitions") or [{}])[0]
    st = (comp.get("status") or e.get("status") or {}).get("type") or {}
    name = (st.get("name") or "").upper()
    state = "void" if any(w in name for w in ("POSTPONED", "CANCELED", "CANCELLED", "ABANDONED", "SUSPENDED", "FORFEIT")) else \
        {"post": "post", "in": "live"}.get(st.get("state"), "pre")
    if state == "post" and st.get("completed") is False:
        state = "void"
    side = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    def names(c):
        t = (c or {}).get("team") or {}
        return [x for x in (t.get("displayName"), t.get("shortDisplayName"), t.get("name"), t.get("location")) if x], t.get("abbreviation")
    hn, hab = names(side.get("home"))
    an, aab = names(side.get("away"))
    def sc(c):
        try:
            return int(float((c or {}).get("score")))
        except (TypeError, ValueError):
            return None
    detail = (st.get("detail") or st.get("shortDetail") or "").upper()
    return {"src": "espn", "id": str(e.get("id")), "ko": ko, "state": state, "hn": hn, "an": an, "hab": hab, "aab": aab,
            "home": (hab or (hn or [""])[0]), "away": (aab or (an or [""])[0]), "hs": sc(side.get("home")), "as": sc(side.get("away")),
            "reg": not re.search(r"\bAET\b|PEN|EXTRA|\bET\b|SO\b", detail)}


def fm_regulation(mid):
    """The 90-minute score of a match that went to extra time."""
    d = get(f"{FM}/api/data/matchDetails?matchId={mid}", 3600) or {}
    ev = (((d.get("content") or {}).get("matchFacts") or {}).get("events") or {}).get("events") or []
    h = a = 0
    for x in ev:
        if x.get("type") == "Goal" and (x.get("time") or 999) <= 90:
            if x.get("isHome"):
                h += 1
            else:
                a += 1
    return (h, a) if ev else None


def outcome(g, m, sides):
    """won / lost / push for a team bet, from the match's (90-minute) score."""
    hs, as_ = m["hs"], m["as"]
    if hs is None or as_ is None:
        return None, ""
    if not m.get("reg", True):
        reg = fm_regulation(m["id"]) if m["src"] == "fm" else None
        if not reg:
            return "unknown", f"{m['home']} {hs}-{as_} {m['away']} (after extra time)"
        hs, as_ = reg
    sc = {"home": hs, "away": as_}
    other = lambda s: "away" if s == "home" else "home"
    shown = f"{m['home']} {hs}-{as_} {m['away']}"
    t = g["t"]
    side = sides.get(g.get("team")) if g.get("team") else None
    if t == "ml":
        return ("won" if sc[side] > sc[other(side)] else "lost"), shown
    if t == "spread":
        v = sc[side] - sc[other(side)] + g["line"]
        return ("won" if v > 0 else "push" if v == 0 else "lost"), shown
    if t == "draw":
        return ("won" if hs == as_ else "lost"), shown
    if t == "cs":
        first = sides.get(g["teams"][0], "home")
        want = g["score"] if first == "home" else g["score"][::-1]
        return ("won" if [hs, as_] == want else "lost"), shown
    if t == "btts":
        return ("won" if (hs > 0 and as_ > 0) == g["yes"] else "lost"), shown
    if t in ("total", "tt"):
        v = hs + as_ if t == "total" else sc[side]
        if v == g["line"]:
            return "push", shown
        return ("won" if (v > g["line"]) == (g["side"] == "over") else "lost"), shown
    return "unknown", shown


def grade_team_leg(g, slate):
    """(result, shown). result None = not finished yet."""
    sport = g.get("sport") or "nba"
    if sport == "soccer":
        sources = (fm_matches, espn_soccer)
    else:
        lo, hi = window(slate)
        def us(sl, sp=sport):
            out = []
            for d in (sl, sl + dt.timedelta(days=1)):
                try:
                    sb = get(f"{B.ESPN}/{B.ESPN_PATH[sp]}/scoreboard?dates={d:%Y%m%d}&r={RUN['id']}", 300) or {}
                except Exception as e:
                    print(f"pick grade: ESPN {sp} {d}: {e}", file=sys.stderr)
                    continue
                for e in sb.get("events") or []:
                    m = espn_event(e, lo, hi)
                    if m:
                        m["hn"] += [m["hab"]] if m.get("hab") else []
                        m["an"] += [m["aab"]] if m.get("aab") else []
                        out.append(m)
            return out
        sources = (us,)
    why = "not found"
    for src in sources:
        matches = src(slate)
        m, sides = find_match(g, matches)
        if m:
            if m["state"] == "void":
                return "void", f"{m['home']} v {m['away']} postponed"
            if m["state"] != "post":
                return (None, "") if not day_over(slate, 48) else ("void", "never finished")
            return outcome(g, m, sides)
        why = sides
    if day_over(slate, 1):          # the day is over and the match is nowhere: don't guess
        return "unknown", f"couldn't find the match ({why})"
    return None, ""


# ---------- player props ----------
def grade_prop(g, slate):
    sport = g["sport"]
    if sport == "soccer":
        return ("unknown", "soccer player props aren't graded yet") if day_over(slate, 1) else (None, "")
    o = B.find_player(sport, P.fold(g["player"]))
    if not o:
        return ("unknown", "player not found") if day_over(slate, 1) else (None, "")
    if B.norm(P.fold(o.get("name") or "")) and name_score_player(g["player"], o.get("name")) < 0.6:
        return "unknown", f"ESPN found {o.get('name')}"
    path = f"{B.ESPN_PATH[sport].split('/')[0]}/{o.get('lg') or sport}"
    y = B.cur_season(sport)
    games, read = [], False
    for yy in (y, y - 1):
        try:
            got = get(f"{B.ESPN_WEB}/sports/{path}/athletes/{o['id']}/gamelog?season={yy}&r={RUN['id']}", 300)
            read = read or bool(got)
        except Exception:
            got = None
        games += B.espn_season_from(got) if got else []
        if games:
            break
    if not games:   # ESPN didn't answer (or has no games for him): never call that a DNP
        return ("unknown", "no game log from ESPN") if day_over(slate, 1) and read else (None, "")
    lo, hi = window(slate)
    for x in sorted(games, key=lambda x: x["date"]):
        if (g.get("event") and x["id"] == g["event"]) or (not g.get("event") and lo <= x["date"] < hi):
            if not x.get("res"):          # no W/L yet: the game isn't over
                return None, ""
            v = B.STAT[B.stat_sport(sport)][g["stat"]]["get"](x)
            if v is None:
                return "void", "DNP"
            res = "push" if v == g["line"] else "won" if (v > g["line"]) == (g["side"] == "over") else "lost"
            return res, B.fmt(v)
    # no game that day: a DNP once the day is over (ESPN's log can trail the final buzzer, so wait a few hours)
    return ("void", "DNP") if day_over(slate, 1) else (None, "")


def name_score_player(a, b):
    ta, tb = B.norm(P.fold(a)).split(), B.norm(P.fold(b)).split()
    if not ta or not tb:
        return 0
    if ta[-1] == tb[-1] or ta == tb:
        return 1
    return difflib.SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio()


def grade_leg(g, slate):
    """Sets g["result"] and g["actual"]. Always re-grades (the 8 AM check uses fresh numbers)."""
    if g["t"] == "raw":
        g["result"], g["actual"] = "unknown", ""
        return
    try:
        res, shown = grade_prop(g, slate) if g["t"] == "prop" else grade_team_leg(g, slate)
    except Exception as e:
        print(f"pick grade: {g.get('label')}: {type(e).__name__}: {e}", file=sys.stderr)
        res, shown = None, ""
    g["result"], g["actual"] = res, shown


def card_result(legs):
    """A props card is one play: every pick has to hit. A push or DNP doesn't break it; one miss loses it."""
    rs = [g.get("result") for g in legs]
    if "lost" in rs:
        return "lost"
    if None in rs:
        return None
    if "unknown" in rs:
        return "unknown"
    return "won" if "won" in rs else "void"
