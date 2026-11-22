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


# ---------- Nov 20-22: the posts the old reader got wrong ----------
FRI, SAT, SUN = dt.date(2026, 11, 20), dt.date(2026, 11, 21), dt.date(2026, 11, 22)


def read(name, day):
    return P.cards_in({"text": P.text_of({"content": getattr(posts, name)})}, "props", day)


def test_extra_legs_are_not_part_of_the_card():
    c, = read("CAFE_FRI", FRI)
    assert labels(c) == ["Anthony Davis O15.5 Points", "Kyshawn George O9.5 Points", "Norman Powell O15.5 Points",
                         "Pascal Siakam O14.5 Points", "Jarrett Allen O5.5 Rebounds"]
    assert [g["label"] for g in c["extras"]] == ["Jamal Murray O14.5 Points", "Alperen Sengun O5.5 Rebounds",
                                                 "Jalen Johnson O5.5 Rebounds", "Kevin Huerter O7.5 Points"]


def test_sunday_menu_posted_saturday_is_for_sunday():
    cs = read("CAFE_SAT_NFL", SAT)
    assert [(c["play"], c["sport"], c["slate"], len(c["legs"])) for c in cs] == [
        ("play1", "nfl", SUN, 6), ("play2", "nfl", SUN, 5), ("play3", "nfl", SUN, 3)]
    assert [g["label"] for g in cs[0]["extras"]] == ["Amon-Ra St. Brown O39.5 Receiving yards", "Tetairoa McMillan O24.5 Receiving yards"]


def test_n_leg_parlay_heading_is_a_card():
    c, = read("CAFE_SAT_NBA", SAT)
    assert len(c["legs"]) == 6 and c["legs"][5]["label"] == "Karl-Anthony Towns O7.5 Rebounds"


def test_add_ons_are_kept_as_extras():
    c, = read("LOCKS_SAT", SAT)
    assert c["slate"] == SAT and len(c["legs"]) == 5
    assert [g["label"] for g in c["extras"]] == ["LaMelo Ball O11.5 Points", "Jaden McDaniels O9.5 Points"]


def test_each_leg_keeps_its_own_day():
    c, = read("PP_SAT_TD", SAT)
    assert [g.get("slate") for g in c["legs"]] == ["2026-11-22", "2026-11-22", "2026-11-23"]
    assert c["extras"] == []


def test_every_play_in_a_post_is_read():
    cs = read("PP_SUN_WEEK11", SUN)
    got = [(c["play"].split("|")[0], len(c["legs"])) for c in cs]
    assert got == [("single:prop", 1), ("single:prop", 1), ("leg:2-leg", 2), ("single:prop", 1), ("leg:4-leg bears/saints parlay", 4),
                   ("leg:5-leg steelers/eagles parlay", 5), ("single:spread", 1), ("single:spread", 1), ("leg:4-leg ml parlay", 4)], got
    assert all(c["sport"] == "nfl" for c in cs)
    assert [g["label"] for g in cs[5]["legs"]][:2] == ["Freiermuth O4.5 Receptions", "Metcalf O14.5 Receiving yards"]
    assert cs[5]["legs"][0]["hint"] == ["Steelers", "Eagles"] and cs[5]["legs"][0]["alt"] == "reyd"
    assert labels(cs[6]) == ["Bears 1Q -2.5"] and labels(cs[8]) == ["PIT ML", "DET ML", "JAC ML", "SF ML"]


# ---------- grading props, and the story of a miss ----------
import espn_fake as F      # noqa: E402


def espn(f):
    def go():
        G.D.update(fetch=F.fetch, now=F.now_after_weekend)
        B.D["fetch"] = F.fetch
        B._cache.clear()
        try:
            f()
        finally:
            G.D.pop("fetch", None)
            G.D.pop("now", None)
            B.D.pop("fetch", None)
    go.__name__ = f.__name__
    return go


def prop(text, sport_day=SAT, sport=None, loose=False):
    g = P.parse_leg(text, "props", sport, loose)
    G.grade_leg(g, sport_day)
    return g


@espn
def test_a_miss_says_how_he_played():
    g = prop("LaMelo Ball 13+ Points")
    assert (g["result"], g["actual"]) == ("lost", "12")
    assert g["why"].startswith("1 short · played 32 min (usually 33) · on the floor in all 4 quarters"), g["why"]
    assert "5 in the 1st half, 7 in the 2nd" in g["why"]


@espn
def test_a_player_who_left_hurt_is_flagged():
    g = prop("Deni Avdija 15+ Points")
    assert g["result"] == "lost"
    assert "not seen after the 2nd quarter (3:12 left)" in g["why"], g["why"]
    assert "sprained left ankle" in g["why"] and "injury report: Day-To-Day (left ankle sprain)" in g["why"], g["why"]
    assert "6 in the 1st half, 0 in the 2nd" in g["why"]
    assert {"injury", "left"} <= set(g["flags"])


@espn
def test_dnp_gives_the_reason():
    g = prop("Ja Morant 20+ Points")
    assert (g["result"], g["actual"]) == ("void", "DNP")
    assert g["why"] == "didn't play: left hamstring" and "injury" in g["flags"]


@espn
def test_no_team_game_is_not_a_dnp():
    g = prop("Nobody Atall 10+ Points")
    assert g["result"] == "unknown" and "no game" in g["actual"]


@espn
def test_nfl_card_posted_saturday_grades_sundays_game():
    g = prop("Chris Godwin 40+ Rec Yds", SAT)
    assert (g["result"], g["actual"]) == ("lost", "31")
    assert "hurt in the 2nd quarter, 6:40 and didn't come back" in g["why"], g["why"]
    assert "31 in the 1st half, 0 in the 2nd" in g["why"] and "knee injury" in g["why"]


@espn
def test_bare_last_name_uses_the_cards_teams():
    g = P.parse_leg("Warren 50+ Rush+Rec", "props", "nfl", loose=True)
    g["hint"] = ["Steelers", "Eagles"]
    G.grade_leg(g, SUN)
    assert (g["result"], g["actual"], g["player_full"]) == ("won", "63", "Jaylen Warren")
    g = P.parse_leg("Warren 50+ Rush+Rec", "props", "nfl", loose=True)       # no teams to go by: two Warrens played
    G.grade_leg(g, SUN)
    assert g["result"] == "unknown" and "2 players named Warren" in g["actual"]


@espn
def test_catches_or_yards():
    g = P.parse_leg("Godwin 5+ Rec", "props", "nfl", loose=True)
    G.grade_leg(g, SUN)
    assert g["result"] == "unknown" and "catches (3) or yards (31)" in g["actual"]


@espn
def test_first_quarter_spread():
    g = P.parse_leg("Bears 1Q -2.5 — -130 (BetRivers) • 0.5u", "props", "nfl")
    G.grade_leg(g, SUN)
    assert (g["result"], g["actual"]) == ("won", "1Q: CHI 10-3 NO")
    g = P.parse_leg("Bears 1H -6.5", "props", "nfl")
    G.grade_leg(g, SAT)                       # posted Saturday night: Sunday's game
    assert (g["result"], g["actual"]) == ("won", "1H: CHI 17-6 NO")


def clocked(f):
    """Restores the tracker's clock after a test that sets it."""
    def go():
        real = T.now_et
        try:
            f()
        finally:
            T.now_et = real
    go.__name__ = f.__name__
    return go


def _card(cid, ch, slate, legs, at="2026-11-22T18:00:00+00:00", play="main", extras=()):
    return {"id": cid, "ch": ch, "post": cid.split(":")[0], "at": at, "slate": slate, "sport": "nba", "play": play,
            "single": False, "legs": legs, "extras": list(extras), "title": "", "result": None, "superseded": False,
            "reported": None}


def _leg(label, result, actual="", **k):
    return dict({"t": "prop", "label": label, "player": label.split(" ")[0], "result": result, "actual": actual}, **k)


@clocked
def test_nightly_post_explains_misses_and_shows_extras():
    T.STATE.update(cards={}, channels={"c": "instinct-props"}, icons={}, before={}, rebuild=False)
    hurt = _leg("Avdija 20+ Points", "lost", "9", player_full="Deni Avdija", flags=["injury", "left"],
                why="11 short · 🚑 hurt in the 2nd quarter and didn't come back")
    c = _card("1:0", "c", "2026-11-22", [_leg("Ball 10+ Points", "won", "12"), hurt],
              extras=[_leg("Morant 15+ Points", "void", "DNP", why="didn't play: left hamstring")])
    c["result"] = "lost"
    T.STATE["cards"]["1:0"] = c
    T.now_et = lambda: dt.datetime(2026, 11, 23, 0, 30, tzinfo=T.ET)
    msgs = T.report()
    text = "\n".join(e.get("description", "") for _, e, _ in msgs)
    assert "Deni Avdija 🚑 got hurt and missed (11 short)" in text, text
    assert "↳ 11 short · 🚑 hurt in the 2nd quarter" in text
    assert "Also in the post, not part of the card (0/1 hit)" in text and "left hamstring" in text
    assert T.stats([c])["lost"] == 1          # the extra doesn't count


@clocked
def test_saturday_nfl_card_is_posted_with_sunday():
    T.STATE.update(cards={}, channels={"c": "instinct-props"}, icons={}, before={}, rebuild=False)
    c = _card("2:0", "c", "2026-11-21", [_leg("Godwin 50+ Rec Yds", "won", "61", game_day="2026-11-22")])
    c["result"] = "won"
    T.STATE["cards"]["2:0"] = c
    T.now_et = lambda: dt.datetime(2026, 11, 22, 0, 30, tzinfo=T.ET)    # Saturday's recap: not yet
    T.report()
    assert not c["reported"]
    T.now_et = lambda: dt.datetime(2026, 11, 23, 0, 30, tzinfo=T.ET)    # Sunday's recap
    assert any("2:0" in ids for _, _, ids in T.report())


@clocked
def test_a_late_card_is_still_posted():
    T.STATE.update(cards={}, channels={"c": "instinct-props"}, icons={}, before={}, rebuild=False)
    c = _card("3:0", "c", "2026-11-20", [_leg("Ball 10+ Points", "won", "12")])
    c["result"] = "won"
    T.STATE["cards"]["3:0"] = c
    T.now_et = lambda: dt.datetime(2026, 11, 23, 0, 30, tzinfo=T.ET)
    msgs = T.report()
    assert any("3:0" in ids for _, _, ids in msgs) and "finished late" in msgs[0][1]["description"]


@clocked
def test_long_nights_are_split_under_discords_limits():
    T.STATE.update(cards={}, channels={"c": "instinct-props"}, icons={}, before={}, rebuild=False)
    for i in range(40):
        legs = [_leg(f"Player{i}x{k} 25+ Points", "lost", "3", why="22 short · played 12 min (usually 30) · " + "x" * 60)
                for k in range(4)]
        c = _card(f"{i}:0", "c", "2026-11-22", legs, at=f"2026-11-22T{10 + i // 4:02d}:{i % 4 * 10:02d}:00+00:00")
        c["result"] = "lost"
        T.STATE["cards"][c["id"]] = c
    T.now_et = lambda: dt.datetime(2026, 11, 23, 0, 30, tzinfo=T.ET)
    msgs = T.report()
    assert len(msgs) > 3
    for content, e, _ in msgs:
        size = len(content) + sum(len(str(e.get(k) or "")) for k in ("title", "description", "footer", "author", "fields"))
        assert len(e.get("description", "")) <= 4096 and size < 6000, size
    posted = "\n".join(e.get("description", "") for _, e, _ in msgs)
    assert all(f"Player{i}x0" in posted for i in range(40))        # nothing cut off


@clocked
def test_rebuild_lists_changed_results():
    T.STATE.update(cards={}, channels={"c": "cafe-picks"}, icons={}, rebuild=True, before={"5|main": "void"})
    c = _card("5:0", "c", "2026-11-20", [_leg("Ball 10+ Points", "won", "12")])
    c["result"] = "won"
    T.STATE["cards"]["5:0"] = c
    T.now_et = lambda: dt.datetime(2026, 11, 23, 0, 30, tzinfo=T.ET)
    msgs = T.report()
    re_ = [e for _, e, _ in msgs if "RE-CHECKED" in e.get("title", "")]
    assert re_ and "✅ win (was void)" in re_[0]["description"], msgs
    assert c["reported"]                     # an older day is counted, not posted again card by card


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


def test_record_round_trip_on_github(tmp_path, monkeypatch):
    import pick_tracker as T
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "t0ken")
    monkeypatch.setitem(T.D, "data_dir", str(tmp_path))
    sent = []
    monkeypatch.setattr(T, "push", sent.append)
    monkeypatch.setattr(T, "from_server", lambda: None)
    T.STATE["posted"]["2026-11-18 00:30"] = 1
    T.save()
    blob = (tmp_path / T.DATA_FILE).read_bytes()
    assert b"posted" not in blob                      # encrypted: the public branch doesn't show the record
    T.STATE["posted"].clear()
    T.reload()
    assert "2026-11-18 00:30" in T.STATE["posted"]
    assert sent and T.unseal(sent[0])["posted"]                 # the server got the same record

    # the server's copy wins when it is newer (the server posted a set time GitHub's timer missed)
    newer = dict(T.STATE, posted={"2026-11-18 08:00": 2}, savedAt=T.STATE["savedAt"] + 60)
    monkeypatch.setattr(T, "from_server", lambda: newer)
    T.reload()
    assert "2026-11-18 08:00" in T.STATE["posted"]
    monkeypatch.delitem(T.D, "data_dir")


def test_server_accepts_only_newer_sealed_records(monkeypatch):
    import pick_tracker as T
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "t0ken")
    T.STATE["savedAt"] = 100
    assert not T.accept_blob(b"not a record")
    assert not T.accept_blob(T.seal({"savedAt": 50, "posted": {}}))
    assert T.accept_blob(T.seal({"savedAt": 150, "posted": {"x": 1}})) and T.STATE["posted"] == {"x": 1}
    forged = T.seal({"savedAt": 999})
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "other")               # made without the bot token: refused
    assert not T.accept_blob(forged)
