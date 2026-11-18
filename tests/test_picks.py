"""Pick grading tests on real posts. Run: python3 tests/test_picks.py  (or pytest)."""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import discord_bot as B      # noqa: E402
import pick_grade as G       # noqa: E402
import pick_parse as P       # noqa: E402
import pick_tracker as T     # noqa: E402
import posts                 # noqa: E402

MON, TUE = dt.date(2026, 11, 16), dt.date(2026, 11, 17)


def cards(name, kind=None, day=TUE):
    kind = kind or ("soccer" if "SOCCER" in name else "props")
    return P.cards_in({"text": getattr(posts, name)}, kind, day)


def labels(c):
    return [g["label"] for g in c["legs"]]


# ---------- reading posts ----------
def test_practice_posts_ignored():
    for n in ("INSTINCT_PROPS_MON_PREVIEW", "CLAUDE_PROPS_MON_PRACTICE", "CLAUDE_SOCCER_PRACTICE_FINAL"):
        assert cards(n, day=MON) == [], n


def test_pass_card_has_no_picks():
    assert cards("INSTINCT_SOCCER_MON_PASS", day=MON) == []


def test_instinct_soccer_final_card_only():
    cs = cards("INSTINCT_SOCCER_TUE")
    assert len(cs) == 1 and cs[0]["slate"] == TUE
    assert labels(cs[0]) == ["Hungary v NIR under 2.5", "Ukraine v Georgia under 2.5", "Denmark v Norway over 3.5", "Ireland ML"]
    assert cs[0]["legs"][3]["teams"] == ("Ireland", "Kosovo")      # the opponent comes from "Ireland ML vs Kosovo"


def test_instinct_props_final_card():
    cs = cards("INSTINCT_PROPS_TUE_1030")
    assert len(cs) == 1 and cs[0]["sport"] == "nba"
    assert labels(cs[0]) == ["Luka Doncic O27.5 Points", "Jalen Brunson O24.5 Pts + Ast", "Josh Hart O1.5 Assists",
                             "Terrence Shannon Jr. O4.5 Reb + Ast", "Ja'Kobe Walter O5.5 Points"]


def test_parlay_math_cuts_insurance_legs():
    nfl, nba = cards("INSTINCT_PROPS_MON_1130", day=MON)
    assert (nfl["sport"], len(nfl["legs"])) == ("nfl", 2)
    assert (nba["sport"], len(nba["legs"])) == ("nba", 3)
    assert labels(nba)[:2] == ["Boston Celtics ML", "Golden State Warriors ML"]


def test_headline_card_without_final():
    cs = cards("INSTINCT_PROPS_TUE_445")
    assert labels(cs[0]) == ["Jalen Brunson O17.5 Points", "Immanuel Quickley O8.5 Points", "Karl-Anthony Towns O8.5 Rebounds",
                             "Rudy Gobert O7.5 Rebounds", "Jaden McDaniels O3.5 Rebounds"]


def test_claude_props():
    assert len(cards("CLAUDE_PROPS_TUE_137")[0]["legs"]) == 4
    assert len(cards("CLAUDE_PROPS_TUE_442")[0]["legs"]) == 5
    assert len(cards("CLAUDE_PROPS_MON_1152", day=MON)[0]["legs"]) == 5


def test_soccer_quick_card_not_cut_by_value_parlay():
    cs = cards("CLAUDE_SOCCER_MON_143", day=MON)
    assert len(cs[0]["legs"]) == 6
    assert cs[0]["legs"][2]["teams"] == ("Germany", "Netherlands")


def test_soccer_final_skips_lock_and_longshot():
    cs = cards("CLAUDE_SOCCER_FINAL", day=MON)
    assert len(cs[0]["legs"]) == 6


def test_track_lines():
    cs = cards("CODEX_TUE")
    assert len(cs) == 1 and len(cs[0]["legs"]) == 5 and cs[0]["legs"][0]["event"] == "401910002"
    assert cs[0]["legs"][1]["label"] == "Cade Cunningham O5.5 Assists"


def test_plays_are_separate():
    assert cards("CAFE_TUE_1")[0]["play"] == "play1"
    assert cards("CAFE_TUE_2")[0]["play"] == "play2"
    assert len(cards("CAFE_TUE_1")[0]["legs"]) == 6
    assert cards("PP_TUE_BEST")[0]["play"] == "best"
    lad = cards("PP_TUE_LADDER")[0]
    assert lad["play"] == "ladder" and len(lad["legs"]) == 6
    assert lad["legs"][5]["teams"] == ("Knicks", "Raptors")


def test_longshot_relay():
    c = cards("PP_MON", day=MON)[0]
    assert c["sport"] == "nfl" and labels(c) == ["Derrick Henry anytime TD", "Justin Herbert O174.5 Pass + rush yards",
                                                 "Zay Flowers O59.5 Receiving yards"]


def test_slate_date():
    assert P.slate_date("NATIONS LEAGUE VALUE CARD – Mon Nov 16, 2026 | 2:00 PM ET", TUE) == MON
    assert P.slate_date("@everyone DAILY LOCKS — Tue, Nov 17", TUE) == TUE
    assert P.slate_date("no date here", TUE) == TUE
    assert P.slate_date("Saturday, January 2", dt.date(2026, 12, 31)) == dt.date(2027, 1, 2)


def test_discord_markdown():
    m = {"content": "## 🏁 UPDATED FINAL CARD\n### **NBA — -115** • 1u\n1. **Luka Doncic OVER 27.5 pts** — -750\n"
                    "2. **Josh Hart** OVER 1.5 ast — -875\n-# Bet responsibly <:fire:1234>"}
    cs = P.cards_in({"text": P.text_of(m)}, "props", TUE)
    assert [g["label"] for g in cs[0]["legs"]] == ["Luka Doncic O27.5 Points", "Josh Hart O1.5 Assists"]


def test_emoji_numbers_and_medals():
    t = "NBA PARLAY\n🥇 RUDY GOBERT OVER 5.5 REBOUNDS (-1150 Kalshi)\n🥈 NIKOLA JOKIĆ OVER 5.5 ASSISTS\n🥉 GIANNIS ANTETOKOUNMPO OVER 19.5 PTS\n" \
        "4️⃣ DENI AVDIJA OVER 14.5 PTS (-733 Kalshi)\n5\u20e3 ZION WILLIAMSON OVER 14.5 PTS\n🔟 Josh Hart 5+ Reb+Ast\nNBA ADD-ONS"
    assert len(P.cards_in({"text": t}, "props", TUE)[0]["legs"]) == 6
    assert P.parse_leg("Justin Herbert (LAC) 175+ passing+rushing yards", "props")["stat"] == "pryd"


# ---------- team names ----------
def test_names():
    assert G.name_score("Ireland", "Northern Ireland") == 0
    assert G.name_score("Ireland", "Ireland U21") == 0
    assert G.name_score("NIR", "Northern Ireland") == 1
    assert G.name_score("N. Ireland", "Northern Ireland") == 1
    assert G.name_score("Bosnia", "Bosnia and Herzegovina") == 1
    assert G.name_score("Austria", "Australia") == 0
    assert G.name_score("Iceland", "Ireland") == 0
    assert G.name_score("Knicks", "New York Knicks") == 0      # (NBA uses the exact short name instead)
    assert G.name_score("Guinea", "Guinea-Bissau") == 0


# ---------- grading against fake feeds ----------
def fm_match(mid, h, a, hs, as_, utc, short="FT", finished=True):
    return {"id": mid, "home": {"name": h, "score": hs}, "away": {"name": a, "score": as_},
            "status": {"utcTime": utc, "finished": finished, "started": True, "cancelled": False, "reason": {"short": short}}}


FM_DAY = {"leagues": [{"matches": [
    fm_match(1, "Denmark", "Norway", 2, 3, "2026-11-17T19:45:00Z"),
    fm_match(2, "Hungary", "Northern Ireland", 1, 1, "2026-11-17T19:45:00Z"),
    fm_match(3, "Ireland", "Kosovo", 3, 0, "2026-11-17T19:45:00Z"),
    fm_match(4, "Ireland U21", "Finland U21", 2, 2, "2026-11-17T17:45:00Z", short="AET"),
    fm_match(5, "Ukraine", "Georgia", 1, 0, "2026-11-17T19:45:00Z"),
    fm_match(6, "Japan", "Paraguay", 1, 2, "2026-11-17T10:00:00Z"),
]}]}


def fake_fetch(url, ttl, as_json=True):
    if "fotmob.com/api/data/matches" in url:
        return FM_DAY if "date=20261117" in url else {"leagues": []}
    if "matchDetails" in url:
        return {"content": {"matchFacts": {"events": {"events": [
            {"type": "Goal", "time": 30, "isHome": True}, {"type": "Goal", "time": 95, "isHome": False}]}}}}
    return {}


def with_feeds(f):
    def go():
        G.D.update(fetch=fake_fetch, now=lambda: dt.datetime(2026, 11, 18, 13, 0, tzinfo=dt.timezone.utc))
        try:
            f()
        finally:
            G.D.pop("fetch", None)
            G.D.pop("now", None)
    go.__name__ = f.__name__
    return go


@with_feeds
def test_instinct_soccer_goes_4_0():
    c = cards("INSTINCT_SOCCER_TUE")[0]
    for g in c["legs"]:
        G.grade_leg(g, TUE)
    assert [g["result"] for g in c["legs"]] == ["won", "won", "won", "won"], [(g["label"], g["result"], g["actual"]) for g in c["legs"]]
    assert c["legs"][3]["actual"] == "Ireland 3-0 Kosovo"


@with_feeds
def test_single_team_never_matches_a_lookalike():
    g = P.parse_leg("Ireland ML | +100 DK", "soccer")
    G.grade_leg(g, TUE)
    assert g["result"] == "won" and "Kosovo" in g["actual"]


@with_feeds
def test_missing_match_is_unknown_not_lost():
    g = P.parse_leg("Brazil ML -300", "soccer")
    G.grade_leg(g, TUE)
    assert g["result"] == "unknown"


@with_feeds
def test_extra_time_uses_90_minutes():
    g = P.parse_leg("Ireland U21 vs Finland U21 – Draw +200", "soccer")
    G.grade_leg(g, TUE)
    assert g["result"] == "lost" and g["actual"].startswith("Ireland U21 1-0")


def test_card_result():
    leg = lambda r: {"result": r}
    assert G.card_result([leg("won"), leg("lost"), leg(None)]) == "lost"
    assert G.card_result([leg("won"), leg(None)]) is None
    assert G.card_result([leg("won"), leg("void"), leg("push")]) == "won"
    assert G.card_result([leg("won"), leg("unknown")]) == "unknown"


def test_update_replaces_earlier_card_but_plays_stay_separate():
    T.STATE.update(cards={}, channels={"c": "instinct-props", "k": "cafe-picks"})
    at = lambda h: dt.datetime(2026, 11, 17, h, 0, tzinfo=dt.timezone.utc)
    T.add_posts("c", [{"id": "1", "bot": True, "at": at(15), "text": posts.INSTINCT_PROPS_TUE_1030},
                      {"id": "2", "bot": True, "at": at(21), "text": posts.INSTINCT_PROPS_TUE_445}])
    T.add_posts("k", [{"id": "3", "bot": True, "at": at(19), "text": posts.CAFE_TUE_1},
                      {"id": "4", "bot": True, "at": at(21), "text": posts.CAFE_TUE_2}])
    T.supersede()
    live = sorted(c["id"] for c in T.live_cards())
    assert live == ["2:0", "3:0", "4:0"], live


def test_soccer_counts_each_pick():
    T.STATE.update(cards={}, channels={"s": "instinct-soccer"})
    T.add_posts("s", [{"id": "9", "bot": True, "at": dt.datetime(2026, 11, 17, 19, tzinfo=dt.timezone.utc), "text": posts.INSTINCT_SOCCER_TUE}])
    c = T.live_cards()[0]
    for g, r in zip(c["legs"], ["won", "won", "won", "lost"]):
        g["result"] = r
    s = T.stats([c])
    assert (s["won"], s["lost"]) == (3, 1)


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f()
                print("ok  ", n)
            except Exception as e:
                fails += 1
                print("FAIL", n, type(e).__name__, e)
    sys.exit(1 if fails else 0)
