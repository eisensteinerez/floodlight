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
import pick_story as S

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
           "jac": "jax", "was": "wsh", "lvr": "lv", "nwe": "ne", "kan": "kc", "gnb": "gb", "tam": "tb", "sfo": "sf", "nor": "no",
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
    def lines(c):
        out = []
        for x in (c or {}).get("linescores") or []:
            try:
                out.append(int(float(x.get("value", x.get("displayValue")))))
            except (TypeError, ValueError):
                return []
        return out
    return {"src": "espn", "hl": lines(side.get("home")), "al": lines(side.get("away")), "id": str(e.get("id")), "ko": ko, "state": state, "hn": hn, "an": an, "hab": hab, "aab": aab,
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
    if g.get("period"):
        # "Bears 1Q -2.5", "Bears 1H -6.5": the score of that quarter or half, from the line score
        idx = {"1q": [0], "2q": [1], "3q": [2], "4q": [3], "1h": [0, 1], "2h": None}[g["period"]]
        hl, al = m.get("hl") or [], m.get("al") or []
        if len(hl) < 4 or len(al) < 4:
            return "unknown", f"{m['home']} {hs}-{as_} {m['away']} (no quarter scores)"
        pick = idx if idx is not None else list(range(2, len(hl)))
        hs, as_ = sum(hl[i] for i in pick), sum(al[i] for i in pick)
        sides = dict(sides)
        shown = f"{g['period'].upper()}: {m['home']} {hs}-{as_} {m['away']}"
        return outcome_from(g, hs, as_, sides, shown)
    if not m.get("reg", True):
        reg = fm_regulation(m["id"]) if m["src"] == "fm" else None
        if not reg:
            return "unknown", f"{m['home']} {hs}-{as_} {m['away']} (after extra time)"
        hs, as_ = reg
    return outcome_from(g, hs, as_, sides, f"{m['home']} {hs}-{as_} {m['away']}")


def outcome_from(g, hs, as_, sides, shown):
    sc = {"home": hs, "away": as_}
    other = lambda s: "away" if s == "home" else "home"
    t = g["t"]
    side = sides.get(g.get("team")) if g.get("team") else None
    if t == "ml":
        if sc[side] == sc[other(side)] and g.get("sport") != "soccer":
            return "push", shown        # an NFL tie, or a level quarter: the books refund it
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
        def us(sl, sp=sport):
            lo, hi = window(sl)
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
    # an NFL card posted on Saturday ("-150 Ladder Day 1") is for Sunday's games: look ahead to Monday night
    days = [slate + dt.timedelta(days=i) for i in range(5 if sport == "nfl" and not g.get("day_fixed") else 1)]
    for src, day in [(src, d) for src in sources for d in days]:
        matches = src(day)
        m, sides = find_match(g, matches)
        if not m and sides == "not found" and day != days[-1]:
            continue
        if m:
            g["game_day"] = m["ko"].astimezone(ET).date().isoformat()
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
def gamelog(sport, o):
    """(games, raw responses) for a player, this season (or last season when this one has nothing)."""
    path = f"{B.ESPN_PATH[sport].split('/')[0]}/{o.get('lg') or sport}"
    y = B.cur_season(sport)
    games, raws = [], []
    for yy in (y, y - 1):
        try:
            got = get(f"{B.ESPN_WEB}/sports/{path}/athletes/{o['id']}/gamelog?season={yy}&r={RUN['id']}", 300)
        except Exception:
            got = None
        if got:
            raws.append(got)
            games += B.espn_season_from(got)
        if games:
            break
    return games, raws


def team_of(sport, o, raws):
    """The player's team id: from his most recent game in the log, else from his ESPN profile."""
    best = None
    for raw in raws:
        for ev in (raw.get("events") or {}).values():
            d = B.parse_date(ev.get("gameDate"))
            tid = ev.get("awayTeamId") if ev.get("atVs") == "@" else ev.get("homeTeamId")
            if d and tid and (not best or d > best[0]):
                best = (d, str(tid))
    if best:
        return best[1]
    try:
        a = get(f"{B.ESPN_WEB}/sports/{B.ESPN_PATH[sport].split('/')[0]}/{o.get('lg') or sport}/athletes/{o['id']}", 86400) or {}
        t = (a.get("athlete") or {}).get("team") or {}
        return str(t["id"]) if t.get("id") else None
    except Exception:
        return None


def team_game(sport, tid, lo, hi):
    """The team's first game between two times: {"id", "date", "state", "names"} or None (None too if ESPN fails)."""
    try:
        sch = get(f"{B.ESPN}/{B.ESPN_PATH[sport]}/teams/{tid}/schedule?r={RUN['id']}", 600) or {}
    except Exception:
        return None
    for e in sorted(sch.get("events") or [], key=lambda e: e.get("date") or ""):
        d = B.parse_date(e.get("date"))
        if not d or not lo <= d < hi:
            continue
        comp = (e.get("competitions") or [{}])[0]
        st = (comp.get("status") or {}).get("type") or {}
        name = (st.get("name") or "").upper()
        state = "void" if any(w in name for w in ("POSTPONED", "CANCELED", "CANCELLED", "SUSPENDED")) else \
            "post" if st.get("completed") or st.get("state") == "post" else st.get("state") or "pre"
        names = []
        for c in comp.get("competitors") or []:
            t = c.get("team") or {}
            names += [x for x in (t.get("displayName"), t.get("shortDisplayName"), t.get("nickname"), t.get("abbreviation")) if x]
        return {"id": str(e.get("id")), "date": d, "state": state, "names": names}
    return {}


def summary(sport, event_id):
    try:
        return get(f"{B.ESPN}/{B.ESPN_PATH[sport]}/summary?event={event_id}&r={RUN['id']}", 1800) or {}
    except Exception:
        return {}


def candidates(sport, name):
    """Every ESPN player a bare last name could be ("Warren"): [{"id", "lg", "name"}]."""
    espn_sport = B.ESPN_PATH[sport].split("/")[0]
    try:
        d = get(f"{B.ESPN_WEB}/search?query={B.urllib.parse.quote(name)}&type=player&sport={espn_sport}&limit=10", 86400) or {}
    except Exception:
        return []
    ok = ("nba", "wnba") if sport in ("nba", "wnba") else (sport,)
    out = []
    for x in d.get("items") or []:
        lg = x.get("league") or x.get("defaultLeagueSlug")
        if lg in ok and B.norm(S.last_name(x.get("displayName") or "")) == B.norm(S.last_name(name)):
            out.append({"id": x["id"], "lg": lg, "name": x.get("displayName")})
    return out


def prop_window(sport, slate, fixed):
    """The games a prop can be about: that night (to 6 AM), or for an NFL card with no day of its own, through Monday
    night (a Saturday post is for Sunday)."""
    lo, hi = window(slate)
    if sport == "nfl" and not fixed:
        hi = lo + dt.timedelta(days=4, hours=6)
    return lo, hi


def value_of(sport, stat, x):
    return B.STAT[B.stat_sport(sport)][stat]["get"](x)


def result_of(g, v):
    return "push" if v == g["line"] else "won" if (v > g["line"]) == (g["side"] == "over") else "lost"


def grade_prop(g, slate):
    """(result, shown). Also sets g["why"]: what happened in his game when the pick missed or he didn't play."""
    sport = g["sport"]
    g.pop("why", None)
    if sport == "soccer":
        return ("unknown", "soccer player props aren't graded yet") if day_over(slate, 1) else (None, "")
    fixed = bool(g.get("slate"))
    lo, hi = prop_window(sport, slate, fixed)
    late = now() > hi + dt.timedelta(hours=1)
    # who: the full name ESPN finds, or for a bare last name, the one player of that name who fits
    if g.get("loose"):
        found = []
        for c in candidates(sport, g["player"])[:4]:
            games, raws = gamelog(sport, c)
            tid = team_of(sport, c, raws)
            tg = team_game(sport, tid, lo, hi) if tid else None
            if g.get("hint") and tg:
                if not any(name_score(h, n) >= 0.85 for h in g["hint"] for n in tg.get("names") or []):
                    continue
            elif not tg:
                continue
            found.append((c, games, raws, tid, tg))
        if len(found) != 1:
            settled_all = len(found) > 1 and all(f[4].get("state") == "post" for f in found)
            if not late and not settled_all:
                return None, ""
            return "unknown", ("no player named " if not found else f"{len(found)} players named ") + g["player"] + " fit"
        o, games, raws, tid, tg = found[0]
        g["player_full"] = o.get("name")
    else:
        o = B.find_player(sport, P.fold(g["player"]))
        if not o:
            return ("unknown", "player not found") if late else (None, "")
        if B.norm(P.fold(o.get("name") or "")) and name_score_player(g["player"], o.get("name")) < 0.6:
            return "unknown", f"ESPN found {o.get('name')}"
        games, raws = gamelog(sport, o)
        tid = team_of(sport, o, raws)
        tg = team_game(sport, tid, lo, hi) if tid else None
    if not games and not raws:   # ESPN didn't answer: never call that a DNP
        return ("unknown", "no game log from ESPN") if late else (None, "")
    games = sorted(games, key=lambda x: x["date"])
    # which game: the TRACK line's game id, else his team's game in the window, else his first game in it
    want = g.get("event") or (tg or {}).get("id")
    x = next((x for x in games if want and x["id"] == want), None)
    if not x and not want:
        x = next((x for x in games if lo <= x["date"] < hi), None)
    if tg is not None and not tg and not x:
        # his team has no game in the window at all: that's not a DNP, the pick is about a game we can't find
        return ("unknown", "his team had no game that day") if late else (None, "")
    if tg and tg.get("state") == "void":
        return "void", "game postponed"
    when = (x or {}).get("date") or (tg or {}).get("date")
    if when:
        g["game_day"] = when.astimezone(ET).date().isoformat()
    if x and x.get("res") and value_of(sport, g["stat"], x) is not None:
        v = value_of(sport, g["stat"], x)
        res = result_of(g, v)
        shown = B.fmt(v)
        if g.get("alt"):
            v2 = value_of(sport, g["alt"], x)
            r2 = result_of(g, v2) if v2 is not None else None
            if r2 != res:
                return "unknown", f"\"Rec\" could be catches ({B.fmt(v)}) or yards ({B.fmt(v2) if v2 is not None else '?'})"
        if res in ("lost", "push") or (res == "won" and g.get("explain_wins")):
            explain(g, sport, x["id"], o, v, games, x, res)
        return res, shown
    if x and not x.get("res"):
        return None, ""                    # his game isn't over
    if x and x.get("res"):                 # in the log for that game, but with no numbers: he didn't play
        explain(g, sport, x["id"], o, None, games, x, "void")
        return "void", "DNP"
    # no line for him in his team's finished game: a DNP. ESPN's log can trail the final buzzer, so wait a little.
    if tg and tg.get("state") == "post":
        if now() < tg["date"] + dt.timedelta(hours=5 if sport == "nfl" else 4):
            return None, ""
        explain(g, sport, tg["id"], o, None, games, None, "void")
        return "void", "DNP"
    if tg and tg.get("state") in ("pre", "in"):
        return None, ""
    # no team schedule to go by (ESPN didn't answer): the old rule, a DNP only once the window is well over
    if x is None and late and tg is None:
        return "void", "DNP"
    return None, ""


def explain(g, sport, event_id, o, v, games, x, res):
    """g["why"]: the story of his game, for a miss, a push or a DNP."""
    try:
        sm = summary(sport, event_id)
        prior = [y for y in games if not x or y["date"] < x["date"]][-10:]
        mins = [y.get("min") for y in prior if y.get("min")]
        usual = sum(mins) / len(mins) if len(mins) >= 3 else None
        notes, flags = S.story(sport, sm, o["id"], o.get("name") or g["player"], g, v, usual)
        if res == "lost":
            gap = S.miss_by(g, v)
            if gap:
                notes.insert(0, gap)
        g["why"] = " · ".join(notes)
        g["flags"] = sorted(flags)
    except Exception as e:
        print(f"pick grade: story for {g.get('label')}: {type(e).__name__}: {e}", file=sys.stderr)


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
    if g.get("slate"):            # "(CIN @ WAS, Mon)": the pick names its own day
        slate = dt.date.fromisoformat(g["slate"])
        g["day_fixed"] = True
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
