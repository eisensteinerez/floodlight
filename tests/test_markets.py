"""The verified market service (markets.py): Erez's acceptance tests before selling (item 1).

  1. A prop disappears when its game starts.
  2. Yesterday's cached prop cannot become today's prop.
  3. A player cannot appear against the wrong opponent.
  4. An unavailable provider cannot appear "verified seconds ago".
  5. A ruled-out player is immediately removed.
  6. Predictions and Prop Explorer show the same active lines (both read lab.board, which is refresh()'s output).
  7. Home's "Hot right now" agrees with Prop Explorer (one rule, decided on the server).
  8. Changing time zones does not move a market onto the wrong day.
Plus the stored fields every market must carry. The browser half is tests/markets_feed.test.js.
Run: python3 -m pytest tests/test_markets.py"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import markets as M  # noqa: E402

H = 3600
NOW = 1795453200          # 2026-11-23 17:00 UTC, Monday 12:00 PM in New York


def team(id_, abbr, name, short):
    return {"id": id_, "abbreviation": abbr, "displayName": name, "shortDisplayName": short}


DAL, PHI, NYG, WSH, CLE, PIT = (team("6", "DAL", "Dallas Cowboys", "Cowboys"), team("21", "PHI", "Philadelphia Eagles", "Eagles"),
                                team("19", "NYG", "New York Giants", "Giants"), team("28", "WSH", "Washington Commanders", "Commanders"),
                                team("5", "CLE", "Cleveland Browns", "Browns"), team("23", "PIT", "Pittsburgh Steelers", "Steelers"))


def ev(id_, start, home, away, state="pre", name=""):
    return {"id": id_, "date": M.iso(start), "competitions": [{"status": {"type": {"state": state, "completed": state == "post", "name": name}},
                                                              "competitors": [{"homeAway": "home", "team": home}, {"homeAway": "away", "team": away}]}]}


def sched(*evs):
    return {"ok": True, "at": NOW, "events": M.events_from({"events": list(evs)}, "nfl")}


def row(player="Jalen Hurts", team_="PHI", opp="NYG", start=NOW + 3 * H, books=(("prizepicks", "pp1"), ("sleeper", "sl1")), line=225.5, l10=.8, l5=.8, n=10, **kw):
    offers = []
    for b, mid in books:
        o = {"book": b, "line": line, "kind": "standard", "mid": f"{b}:{mid}", "status": "pre_game" if b == "prizepicks" else "active"}
        if b == "prizepicks":
            o.update(start=M.iso(start) if start else None, opp=opp)
        else:
            o.update(pOver=.52)
        offers.append(o)
    r = {"player": player, "team": team_, "opp": opp if any(b == "prizepicks" for b, _ in books) else "", "k": "py", "label": "Pass yards", "line": line, "side": "over",
         "l5": l5, "l10": l10, "l20": .7, "n": n, "fid": f"nfl:{player.lower().replace(' ', '')}", "offers": offers, "hold": False}
    r.update(kw)
    return r


def fresh(tmp=None):
    M.S.update(markets={}, seen={}, providers={}, schedules={}, injuries={}, loaded=True, saved=1e18)   # saved far ahead: no disk writes
    M.D["file"] = os.path.join(tmp or tempfile.mkdtemp(), "markets.json")


TODAY = sched(ev("401", NOW + 3 * H, PHI, NYG), ev("402", NOW + 3 * 24 * H, DAL, WSH))
NOINJ = {"ok": True, "players": {}}


def run(rows, now=NOW, schedule=TODAY, injuries=NOINJ, fetched=None, errors=None):
    return M.refresh("nfl", rows, fetched=fetched if fetched is not None else now - 120, errors=errors, schedule=schedule, injuries=injuries, now=now)


# ---------- every market carries the required fields ----------
def test_an_open_market_carries_every_required_field():
    fresh()
    v = run([row()])
    assert len(v["rows"]) == 1 and not v["removed"]
    r = v["rows"][0]
    assert r["status"] == "open" and r["eventId"] == "401" and r["opp"] == "NYG" and r["oppId"] == "19" and r["teamId"] == "21"
    assert r["start"] == M.iso(NOW + 3 * H) and r["verifiedAt"] == NOW - 120 and r["firstSeen"] == NOW
    m = M.get(r["mid"])
    for k in ("id", "providerMarketId", "eventId", "playerId", "teamId", "oppId", "sport", "league", "stat", "side", "line", "provider", "price", "start", "tz",
              "status", "verifiedAt", "firstSeen", "closingLine", "removalReason", "openLine"):
        assert k in m, k
    assert m["providerMarketId"] == "prizepicks:pp1" and m["provider"] == "prizepicks" and m["eventDay"] == "2026-11-23"
    assert set(M.STATUS) == {"open", "suspended", "closed", "started", "expired", "voided", "missing_matchup", "player_out", "provider_unavailable", "awaiting_verification"}


# ---------- 1. a prop disappears when its game starts ----------
def test_a_prop_disappears_when_its_game_starts():
    fresh()
    assert run([row()])["rows"]
    later = run([row()], now=NOW + 3 * H + 60, schedule=sched(ev("401", NOW + 3 * H, PHI, NYG, "in")))
    assert not later["rows"]
    assert later["removed"][0]["status"] == "started"
    # the record keeps the closing line from the last open reading
    m = next(x for x in M.snapshot("nfl") if x["provider"] == "prizepicks")
    assert m["status"] == "started" and m["closingLine"] == 225.5


def test_a_line_the_provider_still_lists_after_the_start_is_not_shown_even_if_the_schedule_is_late():
    fresh()
    v = run([row(start=NOW - 60)], schedule=sched(ev("401", NOW - 60, PHI, NYG, "pre")))
    assert not v["rows"] and v["removed"][0]["status"] == "started"


def test_a_market_missing_from_the_next_read_after_the_start_is_filed_started():
    fresh()
    run([row()])
    run([], now=NOW + 4 * H, schedule=sched(ev("401", NOW + 3 * H, PHI, NYG, "in")))
    assert {m["status"] for m in M.snapshot("nfl")} == {"started"}


# ---------- 2. yesterday's cached prop cannot become today's ----------
def test_a_line_with_no_start_does_not_jump_to_a_game_days_away():
    """The Joe Milton case: a Sleeper line with no start time for a team whose next game is Thursday."""
    fresh()
    v = run([row(player="Joe Milton", team_="DAL", opp="", books=(("sleeper", "jm1"),))])
    assert not v["rows"]
    assert v["removed"][0]["status"] == "missing_matchup"


def test_a_provider_line_first_seen_before_the_teams_last_game_belongs_to_that_game():
    fresh()
    sunday = NOW - 24 * H
    # Sunday: the Sleeper line was first seen for Sunday's game
    run([row(player="Joe Milton", team_="DAL", opp="", books=(("sleeper", "jm1"),))], now=sunday - 6 * H, fetched=sunday - 6 * H - 60,
        schedule=sched(ev("400", sunday, DAL, WSH)))
    # Monday: Sunday's game is over, the same line is still listed, and a Dallas game is now within a day and a half
    mon = sched(ev("400", sunday, DAL, WSH, "post"), ev("402", NOW + 30 * H, DAL, NYG))
    v = run([row(player="Joe Milton", team_="DAL", opp="", books=(("sleeper", "jm1"),))], schedule=mon)
    assert not v["rows"]
    assert v["removed"][0]["status"] == "expired"


def test_a_line_whose_only_game_is_over_is_never_today():
    fresh()
    v = run([row(start=None, books=(("sleeper", "s9"),))], schedule=sched(ev("401", NOW - 20 * H, PHI, NYG, "post")))
    assert not v["rows"] and v["removed"][0]["status"] in ("closed", "expired")


# ---------- 3. never against the wrong opponent ----------
def test_a_player_cannot_appear_against_the_wrong_opponent():
    fresh()
    v = run([row(opp="DAL")])
    assert not v["rows"]
    assert v["removed"][0]["status"] == "missing_matchup" and "opponent" in v["removed"][0]["reason"]


def test_a_player_whose_team_has_no_game_is_missing_a_matchup():
    fresh()
    v = run([row(player="Myles Garrett", team_="CLE", opp="PIT")])
    assert not v["rows"] and v["removed"][0]["status"] == "missing_matchup"


def test_a_player_whose_team_is_being_checked_waits():
    fresh()
    v = run([row(hold=True)])
    assert not v["rows"] and v["removed"][0]["status"] == "awaiting_verification"


# ---------- 4. an unavailable provider is never "verified seconds ago" ----------
def test_verified_time_is_the_providers_read_not_the_request():
    fresh()
    v = run([row()], fetched=NOW - 600)
    assert v["rows"][0]["verifiedAt"] == NOW - 600


def test_an_unavailable_provider_keeps_its_old_time_and_its_lines_leave_the_board():
    fresh()
    run([row()], fetched=NOW - 60)
    # 20 minutes later PrizePicks fails; only Sleeper's line comes back
    later = run([row(books=(("sleeper", "sl1"),), opp="")], now=NOW + 1200, fetched=NOW + 1150, errors={"prizepicks": "HTTPError 403"})
    pp = next(m for m in M.snapshot("nfl") if m["provider"] == "prizepicks")
    assert pp["status"] == "provider_unavailable" and pp["verifiedAt"] == NOW - 60
    assert later["providers"]["prizepicks"]["ok"] is False and later["providers"]["prizepicks"]["at"] == NOW - 60
    assert all(o["book"] == "sleeper" for r in later["rows"] for o in r["offers"])


def test_a_line_not_reverified_for_90_minutes_awaits_verification():
    fresh()
    v = run([row()], fetched=NOW - M.MAX_AGE - 60)
    assert not v["rows"] and v["removed"][0]["status"] == "awaiting_verification"


def test_a_suspended_line_is_not_shown():
    fresh()
    r = row(books=(("prizepicks", "pp1"),))
    r["offers"][0]["status"] = "suspended"
    v = run([r])
    assert not v["rows"] and v["removed"][0]["status"] == "suspended"


# ---------- 5. a ruled-out player is removed at once ----------
def test_a_ruled_out_player_is_removed_immediately():
    fresh()
    assert run([row()])["rows"]
    v = run([row()], injuries={"ok": True, "players": {"jalen hurts": {"status": "Out", "lv": "out"}}})
    assert not v["rows"] and v["removed"][0]["status"] == "player_out"
    assert M.injury_level("Out") == "out" and M.injury_level("Questionable") == "questionable" and M.injury_level("Active") == "active"


def test_a_questionable_player_stays_open():
    fresh()
    assert run([row()], injuries={"ok": True, "players": {"jalen hurts": {"status": "Questionable", "lv": "questionable"}}})["rows"]


# ---------- 6. one feed for every page ----------
def test_predictions_and_prop_explorer_get_the_same_active_lines():
    """Both pages read /api/lab/board (Predictions through edge.js, Prop Explorer in lab.html) and /api/markets returns
    the same rows: the same input gives the same open set, and no page reads the books any other way."""
    fresh()
    rows = [row(), row(player="Saquon Barkley", line=95.5), row(player="Joe Milton", team_="DAL", opp="", books=(("sleeper", "jm1"),)), row(player="X", opp="DAL")]
    a = run([dict(r) for r in rows])
    b = run([dict(r) for r in rows])
    assert [r["mid"] for r in a["rows"]] == [r["mid"] for r in b["rows"]] == [r["mid"] for r in a["rows"] if r["status"] == "open"]
    assert {r["player"] for r in a["rows"]} == {"Jalen Hurts", "Saquon Barkley"}
    src = {f: open(os.path.join(os.path.dirname(HERE), f)).read() for f in ("predictions.js", "labpage.js", "parlays.js", "home.js", "search.js", "profile.js", "labtools.js", "alerts.js", "lab.html")}
    for f, text in src.items():   # nobody reads the pick'em apps' raw lines for a board
        assert "/api/dfs/lines" not in text, f


# ---------- 7. hot agrees everywhere ----------
def test_hot_is_decided_once_on_the_server():
    fresh()
    v = run([row(l10=.8, l5=.8, n=10), row(player="Saquon Barkley", l10=.6, l5=.6), row(player="DeVonta Smith", l10=.9, l5=.4)])
    hot = {r["player"] for r in v["rows"] if r["hot"]}
    assert hot == {"Jalen Hurts"}
    assert not M.is_hot({"l10": .9, "l5": .8, "n": 5})   # too few games


# ---------- 8. time zones never move a market onto the wrong day ----------
def test_a_late_game_is_the_same_market_in_every_time_zone():
    fresh()
    late = NOW + 11 * H + 30 * 60    # 11:30 PM in New York = Tuesday 06:30 in Tel Aviv
    v = run([row(start=late)], schedule=sched(ev("401", late, PHI, NYG)))
    r = v["rows"][0]
    assert r["eventDay"] == "2026-11-23" and r["start"] == M.iso(late)
    assert M.day_key(late, "America/New_York") == "2026-11-23" and M.day_key(late, "Asia/Jerusalem") == "2026-11-24"
    # the provider's time written with an offset is the same instant
    o = row(start=late)
    o["offers"][0]["start"] = "2026-11-23T23:30:00-05:00"
    assert run([o], schedule=sched(ev("401", late, PHI, NYG)))["rows"]


def test_a_provider_date_a_day_off_the_schedule_is_not_matched():
    fresh()
    v = run([row(start=NOW + 3 * H + 24 * H)], schedule=sched(ev("401", NOW + 3 * H, PHI, NYG)))
    assert not v["rows"] and v["removed"][0]["status"] == "missing_matchup"


# ---------- soccer: no league schedule, so the provider's start and opponent are both required ----------
def test_soccer_needs_the_providers_start_and_opponent():
    fresh()
    ok = M.refresh("soccer", [row(player="Bukayo Saka", team_="ARS", opp="CHE")], fetched=NOW - 60, schedule=None, injuries=None, now=NOW)
    assert ok["rows"] and ok["rows"][0]["matchup"] == "provider"
    no = M.refresh("soccer", [row(player="Cole Palmer", team_="CHE", opp="", books=(("sleeper", "cp"),))], fetched=NOW - 60, schedule=None, injuries=None, now=NOW)
    assert not no["rows"] and no["removed"][0]["status"] == "missing_matchup"


# ---------- the owner's data monitoring ----------
def test_monitor_counts_problems():
    fresh()
    run([row(), row(player="X", opp="DAL")])
    run([row(books=(("sleeper", "sl1"),), opp="")], now=NOW + 600, errors={"prizepicks": "HTTPError 403"})
    rep = M.monitor(now=NOW + 600)
    by = {c["key"]: c["n"] for c in rep["checks"]}
    assert by["providers"] == 1 and by["no_event"] >= 1


def test_a_provider_id_reposted_with_a_new_number_is_a_new_posting():
    fresh()
    sunday = NOW - 24 * H
    run([row(player="Joe Milton", team_="DAL", opp="", books=(("sleeper", "jm1"),))], now=sunday - 6 * H, fetched=sunday - 6 * H - 60, schedule=sched(ev("400", sunday, DAL, WSH)))
    mon = sched(ev("400", sunday, DAL, WSH, "post"), ev("402", NOW + 30 * H, DAL, NYG))
    v = run([row(player="Joe Milton", team_="DAL", opp="", books=(("sleeper", "jm1"),), line=180.5)], schedule=mon)
    assert v["rows"] and v["rows"][0]["eventId"] == "402"


def test_the_public_summary_counts_open_and_removed_markets_and_names_providers():
    fresh()
    run([row(), row(player="Saquon Barkley", start=NOW - H, books=(("prizepicks", "pp9"),))], errors={"sleeper": "timed out"})
    s = M.summary(now=NOW)
    nfl = next(x for x in s["sports"] if x["sport"] == "nfl")
    assert nfl["open"] == 1                          # Hurts on PrizePicks; his Sleeper line waits for Sleeper to answer
    assert nfl["removed"] == {M.LABEL["started"]: 1, M.LABEL["provider_unavailable"]: 1}
    names = {p["name"]: p["ok"] for p in nfl["providers"]}
    assert names["PrizePicks"] is True and names["Sleeper"] is False
