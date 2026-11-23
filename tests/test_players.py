"""The one player record (players.py), its checks, the correction log and data health.
Run: python3 -m pytest tests/test_players.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import pytest  # noqa: E402

import corrections  # noqa: E402
import health  # noqa: E402
import players as P  # noqa: E402

E = P.ESPN
NBA_TEAMS = {"sports": [{"leagues": [{"teams": [{"team": {"id": "20", "abbreviation": "PHI", "displayName": "Philadelphia 76ers"}},
                                                 {"team": {"id": "13", "abbreviation": "LAL", "displayName": "Los Angeles Lakers"}},
                                                 {"team": {"id": "2", "abbreviation": "BOS", "displayName": "Boston Celtics"}}]}]}]}


def ath(i, name, pos="F", inj=None):
    return {"id": i, "fullName": name, "position": {"abbreviation": pos}, "headshot": {"href": f"https://x/{i}.png"},
            "injuries": [{"status": inj}] if inj else [], "status": {"type": "active"}}


class Fake:
    def __init__(self):
        self.rosters = {"20": [ath("1966", "LeBron James"), ath("3917376", "Jaylen Brown"), ath("3059318", "Joel Embiid", "C", "Out")],
                        "13": [ath("3945274", "Luka Doncic", "G")], "2": [ath("4065648", "Jayson Tatum")]}
        self.calls = []

    def __call__(self, url, ttl, as_json=True):
        self.calls.append(url)
        if url == f"{E}/basketball/nba/teams":
            return NBA_TEAMS
        for tid, rows in self.rosters.items():
            if url == f"{E}/basketball/nba/teams/{tid}/roster":
                if rows is None:
                    raise OSError("timed out")
                return {"athletes": rows}
        if url == f"{E}/football/nfl/teams":
            return {"sports": [{"leagues": [{"teams": [{"team": {"id": "12", "abbreviation": "KC", "displayName": "Kansas City Chiefs"}}]}]}]}
        if url == f"{E}/football/nfl/teams/12/roster":   # the NFL groups its roster by unit
            return {"athletes": [{"position": "offense", "items": [ath("3139477", "Patrick Mahomes", "QB")]}, {"position": "defense", "items": [ath("1", "Chris Jones", "DT")]}]}
        if url == f"{P.SAPI}/teams?sportId=1":
            return {"teams": [{"id": 147, "abbreviation": "NYY", "name": "New York Yankees"}]}
        if url.startswith(f"{P.SAPI}/teams/147/roster?rosterType=40Man"):
            return {"roster": [{"person": {"id": 592450, "fullName": "Aaron Judge"}, "position": {"abbreviation": "RF"}, "status": {"code": "A"}}]}
        if "athletes/999" in url:
            return {"athlete": {"id": "999", "displayName": "Free Agent Guy", "team": {}, "position": {"abbreviation": "G"}}}
        raise OSError(f"not faked: {url}")


@pytest.fixture
def reg(tmp_path, monkeypatch):
    f = Fake()
    clock = {"t": 1_800_000_000.0}
    monkeypatch.setattr(P.storage, "URL", "")
    P.setup(fetch=f, file=tmp_path / "players.json", now=lambda: clock["t"])
    P.D["health"] = None
    return f, clock


def test_roster_read_builds_one_record_per_player(reg):
    f, clock = reg
    rep = P.read_rosters("nba")
    assert rep["ok"] and rep["read"] == 3
    r = P.get("nba:1966")
    assert (r["name"], r["teamAbbr"], r["teamName"], r["teamId"], r["pos"]) == ("LeBron James", "PHI", "Philadelphia 76ers", "20", "F")
    assert r["rosterAt"] == clock["t"] and r["provider"] == "espn" and r["photo"]
    v = P.view(r)
    assert v["status"] == "verified" and v["league"] == "NBA"
    assert P.get("nba:3059318")["active"] is False   # "Out" on the injury report


def test_grouped_nfl_and_mlb_rosters(reg):
    P.read_rosters("nfl")
    P.read_rosters("mlb")
    assert P.get("nfl:3139477")["teamName"] == "Kansas City Chiefs"
    assert P.get("nfl:1")["pos"] == "DT"
    j = P.get("mlb:592450")
    assert (j["teamAbbr"], j["provider"], j["active"]) == ("NYY", "mlb", True)


def test_a_move_keeps_the_previous_team(reg):
    f, clock = reg
    P.read_rosters("nba")
    f.rosters["20"] = [x for x in f.rosters["20"] if x["id"] != "1966"]
    f.rosters["13"].append(ath("1966", "LeBron James"))
    clock["t"] += 7 * 3600
    rep = P.read_rosters("nba")
    r = P.get("nba:1966")
    assert r["teamAbbr"] == "LAL" and r["prev"]["teamAbbr"] == "PHI" and rep["moved"]
    # the books still listing the old team in the week after a move is not a disagreement
    codes, note = P.check_row("nba", r, "prizepicks", "PHI", "BOS")
    assert "providers_disagree" not in codes and "Moved from Philadelphia 76ers" in note


def test_two_rosters_one_player_is_flagged_and_held(reg):
    f, _ = reg
    f.rosters["2"].append(ath("1966", "LeBron James"))
    rep = P.read_rosters("nba")
    r = P.get("nba:1966")
    assert "LeBron James" in rep["two"]
    assert P.status(r)[0] == "checking"
    assert any(x["code"] == "two_teams" for x in P.view(r)["flags"])


def test_crowded_roster_read_is_flagged(reg, monkeypatch):
    f, _ = reg
    monkeypatch.setitem(P.MAX_ROSTER, "nba", 2)
    rep = P.read_rosters("nba")
    assert rep["crowded"] == ["PHI"]
    assert P.status(P.get("nba:1966"))[0] == "checking"
    assert P.status(P.get("nba:3945274"))[0] == "verified"


def test_failed_team_reads_keep_the_records(reg):
    f, clock = reg
    P.read_rosters("nba")
    f.rosters["20"] = None
    clock["t"] += 7 * 3600
    rep = P.read_rosters("nba")
    assert rep["failed"] == ["PHI"]
    r = P.get("nba:1966")
    assert r["teamAbbr"] == "PHI" and r["rosterAt"] < clock["t"]   # still there, not re-verified
    clock["t"] += 3 * 86400
    assert P.status(r)[0] == "checking"   # no roster has listed him for two days


def test_find_by_name_and_team_hint(reg):
    f, _ = reg
    f.rosters["2"].append(ath("777", "Jaylen Brown"))   # a second Jaylen Brown on another team
    P.read_rosters("nba")
    assert P.find("nba", "Jaylen Brown", "BOS")["pid"] == "777"
    assert P.find("nba", "Jaylen Brown", "PHI")["pid"] == "3917376"
    assert P.find("nba", "luka dončić")["pid"] == "3945274"   # accents and case
    assert P.find("nba", "Nobody Here") is None
    # a name no roster lists comes from the provider's search and the player's own page, unverified
    r = P.find("nba", "Free Agent Guy", search=lambda s, n: {"id": "999"})
    assert r["fid"] == "nba:999" and P.status(r)[0] == "checking"


def test_row_checks(reg):
    P.read_rosters("nba")
    lbj = P.get("nba:1966")
    assert P.check_row("nba", lbj, "prizepicks", "PHI", "BOS") == ([], "")
    codes, note = P.check_row("nba", lbj, "sleeper", "LAL", "BOS")
    assert "providers_disagree" in codes and "not_in_game" in codes and "Sleeper lists LAL" in note
    codes, _ = P.check_row("nba", lbj, "prizepicks", "BOS", "PHI")
    assert "prop_on_opponent" in codes
    codes, _ = P.check_row("nba", lbj, "prizepicks", "XYZ", "BOS")
    assert "unknown_team" in codes
    codes, _ = P.check_row("nba", P.get("nba:3059318"), "prizepicks", "PHI", "BOS")
    assert "inactive_props" in codes
    # flags clear once the books agree again
    P.check_row("nba", lbj, "prizepicks", "PHI", "BOS")
    assert P.status(lbj)[0] == "verified"


def test_board_wide_check_flags_many_players_on_one_team(reg):
    f, _ = reg
    P.read_rosters("nba")
    rows = [(P.get("nba:1966"), "LAL"), (P.get("nba:3917376"), "BOS"), (P.get("nba:3059318"), "MIA")]
    assert P.check_board("nba", rows) == ["PHI"]
    assert P.status(P.get("nba:1966"))[0] == "checking"


def test_a_page_showing_another_team_is_flagged(reg):
    P.read_rosters("nba")
    assert P.seen("nba:1966", "20", "profile") is True
    assert P.seen("nba:1966", "13", "profile") is False
    assert P.status(P.get("nba:1966"))[0] == "checking"
    assert P.seen("nba:1966", "20", "profile") is True
    assert P.status(P.get("nba:1966"))[0] == "verified"


def test_records_survive_a_restart(reg, tmp_path):
    f, clock = reg
    P.read_rosters("nba")
    P.setup(fetch=f, file=tmp_path / "players.json", now=lambda: clock["t"])
    assert P.get("nba:1966", False)["teamName"] == "Philadelphia 76ers"
    assert P.find("nba", "LeBron James")["fid"] == "nba:1966"


def test_find_player_uses_the_record(reg, monkeypatch):
    import discord_bot as B
    P.read_rosters("nba")
    monkeypatch.setattr(B, "search_player", lambda s, n: pytest.fail("the roster has him"))
    assert B.find_player("nba", "LeBron James") == {"id": "1966", "lg": "nba", "name": "LeBron James", "fid": "nba:1966"}


def test_load_player_runs_with_a_team_hint(reg, monkeypatch):
    """The real load_player, end to end: the team hint reaches find_player and the record's team comes back.
    (A team hint shadowed by load_player's own `team` once made every Lab search and prop board fail.)"""
    import datetime as dt
    import discord_bot as B
    P.read_rosters("nba")
    B._cache.clear()
    seen = {}
    real_find = B.find_player

    def find(s, n, t=None):
        seen.setdefault("hint", t)
        return real_find(s, n, t)
    monkeypatch.setattr(B, "find_player", find)
    monkeypatch.setattr(B, "espn_season", lambda path, pid, y: [{"id": f"{y}-{i}", "date": dt.datetime(y, 11, 1 + i, tzinfo=dt.timezone.utc), "opp": "BOS"} for i in range(6)])
    monkeypatch.setattr(B, "get_json", lambda url, ttl: {"athlete": {"team": {"displayName": "Los Angeles Lakers", "abbreviation": "LAL"}}})
    for hint in ("PHI", None):
        B._cache.clear()
        p = B.load_player("nba", "LeBron James", hint)
        assert p["fid"] == "nba:1966" and p["teamAbbr"] == "PHI" and p["team"] == "Philadelphia 76ers" and len(p["games"]) == 12
    assert seen["hint"] == "PHI"


# ---------- corrections ----------
def test_wrong_team_on_a_shown_prop_is_corrected_once(reg, tmp_path, monkeypatch):
    f, clock = reg
    P.read_rosters("nba")
    corrections.setup(file=tmp_path / "corrections.json", now=lambda: clock["t"])
    props = [{"sport": "nba", "player": "LeBron James", "team": "LAL", "start": clock["t"] - 3600},
             {"sport": "nba", "player": "LeBron James", "team": "LAL", "start": clock["t"] - 7200},
             {"sport": "nba", "player": "Luka Doncic", "team": "LAL", "start": clock["t"] - 3600}]
    new = corrections.scan(props, P, now=clock["t"])
    assert len(new) == 1
    e = new[0]
    assert e["before"] == "LAL" and e["after"] == "PHI" and e["affected"] == "2 predictions" and e["source"] == "automatic"
    assert "LeBron James was shown with LAL" in e["text"] and "Philadelphia 76ers" in e["text"] and "Grades were not changed" in e["text"]
    assert corrections.scan(props, P, now=clock["t"]) == []   # once
    assert corrections.entries()[0]["id"] == e["id"]
    assert corrections.remove(e["id"]) and corrections.entries() == []


def test_admin_correction_needs_text(tmp_path):
    corrections.setup(file=tmp_path / "c.json")
    with pytest.raises(ValueError):
        corrections.add("", "")
    assert corrections.add("NFL schedule", "Week 12 times were an hour off; fixed.")["source"] == "admin"


# ---------- data health ----------
def test_classify_urls():
    assert health.classify("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80") == ("schedules", "cfb")
    assert health.classify("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/20/roster") == ("rosters", "nba")
    assert health.classify("https://api.prizepicks.com/projections?league_id=7")[0] == "props"
    assert health.classify("https://api.elections.kalshi.com/trade-api/v2/markets")[0] == "prices"
    assert health.classify("https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/1/gamelog") == ("gamelogs", "nhl")
    assert health.classify("https://example.com/whatever") == (None, None)


def test_feed_states(tmp_path):
    t = {"t": 1_800_000_000.0}
    health.D.update(now=lambda: t["t"], file=tmp_path / "h.json")
    health.S["feeds"].clear()
    health.ok("props", "nba", n=40)
    health.ok("props", "nfl")
    assert {f["feed"]: f["state"] for f in health.status()["feeds"]}["props"] == "live"
    t["t"] += 60
    health.fail("props", "nfl", err="timed out")
    assert {f["feed"]: f["state"] for f in health.status()["feeds"]}["props"] == "partial"
    t["t"] += 4000
    health.fail("props", "nba", err="x")
    health.fail("props", "nba", err="x")
    health.fail("props", "nfl", err="x")
    st = {f["feed"]: f for f in health.status()["feeds"]}["props"]
    assert st["state"] == "unavailable" and {s["sport"]: s["state"] for s in st["sports"]} == {"nba": "unavailable", "nfl": "unavailable"}
    assert {f["feed"]: f["state"] for f in health.status()["feeds"]}["transfers"] == "unknown"


def test_watch_alerts(tmp_path):
    t = {"t": 1_795_000_000.0}   # November: NBA, NHL, NFL and college football are in season
    sent = []
    sb = {"football/nfl": {"events": []}}

    def fetch(url, ttl, as_json=True):
        for k, v in sb.items():
            if k in url:
                return v
        def ev(i, a, b, start, state="pre"):
            return {"id": i, "shortName": f"{a} @ {b}", "date": start, "status": {"type": {"state": state, "name": "STATUS_SCHEDULED"}},
                    "competitions": [{"competitors": [{"team": {"id": a}}, {"team": {"id": b}}]}]}
        return {"events": [ev("1", "13", "2", "2026-11-17T00:30Z"), ev("2", "13", "2", "2026-11-17T01:30Z"), ev("3", "5", "6", "2026-11-16T00:00Z", "in")]}
    health.setup(fetch=fetch, file=tmp_path / "h.json", now=lambda: t["t"], send=sent.append, players=None, propbook=None, loop=False)
    health.S.update(sent={}, alerts=[], starts={})
    raised = health.watch(now=t["t"])
    assert "zero:nfl" in raised and "dup" in raised and "stuck" in raised
    assert any("NFL returned no games" in s for s in sent)
    n = len(sent)
    health.watch(now=t["t"] + 600)   # the same alerts are not sent again within six hours
    assert len(sent) == n


# ---------- the Lab board takes the team from the record ----------
def test_lab_board_rows_use_the_record(reg, monkeypatch, tmp_path):
    import lab
    import discord_bot as B
    P.read_rosters("nba")
    rows = [{"player": "LeBron James", "team": "PHI", "opp": "BOS", "k": "pts", "label": "Points", "line": 24.5, "side": "over", "fid": "nba:1966",
             "l5": {"pct": .6}, "l10": {"pct": .6, "n": 10, "hit": 6}, "l20": {"pct": .55}, "avg": 25.1, "offers": [{"book": "prizepicks", "line": 24.5}], "recent": []},
            {"player": "Jaylen Brown", "team": "BOS", "opp": "NYK", "k": "pts", "label": "Points", "line": 22.5, "side": "over", "fid": "nba:3917376",
             "l5": {"pct": .6}, "l10": {"pct": .6, "n": 10, "hit": 6}, "l20": {"pct": .55}, "avg": 23.0, "offers": [{"book": "sleeper", "line": 22.5}], "recent": []}]
    monkeypatch.setattr(B, "memo", lambda key, ttl, fn: fn())
    monkeypatch.setattr(B, "props_board", lambda *a, **k: {"rows": rows, "lines": 2, "errors": {}})
    lbj, jb = lab.board_rows("nba", {"rows": rows})
    assert (lbj["team"], lbj["teamName"], lbj["teamStatus"], lbj["hold"], lbj["fid"]) == ("PHI", "Philadelphia 76ers", "verified", False, "nba:1966")
    assert jb["team"] == "PHI" and jb["bookTeam"] == "BOS" and jb["hold"] is True
    assert "providers_disagree" in jb["flags"] and "not_in_game" in jb["flags"] and "Sleeper lists BOS" in jb["teamNote"]
    assert jb["opp"] == "NY"   # both sides in ESPN's codes, so one game has one key
    # through the verified market service: with no league schedule to check against nothing is open, and the held row
    # waits for the team check (markets.py)
    import markets
    monkeypatch.setattr(markets, "D", dict(markets.D, schedule=None, injuries=None, file=tmp_path / "markets.json"))
    monkeypatch.setattr(markets, "S", dict(markets.S, markets={}, seen={}, providers={}, schedules={}, injuries={}, loaded=True))
    b = lab.board("nba")
    assert not b["rows"] and b["verified"] and {x["player"]: x["status"] for x in b["removed"]} == {"LeBron James": "awaiting_verification", "Jaylen Brown": "awaiting_verification"}


def test_lab_player_carries_the_record(reg, monkeypatch):
    import lab
    import discord_bot as B
    P.read_rosters("nba")
    monkeypatch.setattr(B, "load_player", lambda s, n, t=None: {"sport": s, "id": "1966", "fid": "nba:1966", "name": "LeBron James", "team": "Philadelphia 76ers", "teamAbbr": "PHI", "photo": "", "games": []})
    monkeypatch.setattr(lab, "_deeper", lambda s, p: p)
    monkeypatch.setattr(lab, "_extras", lambda s, p, n: {"crest": "https://x/lal.png"})
    monkeypatch.setattr(B, "dfs_lines", lambda s: {"lines": []})
    d = lab.player("nba", "LeBron James")
    assert d["registry"]["teamName"] == "Philadelphia 76ers" and d["registry"]["status"] == "verified" and d["fid"] == "nba:1966"
    import urllib.parse
    assert "/nba/500/phi.png" in urllib.parse.unquote(d["crest"])   # the record's team crest, not the player page's
