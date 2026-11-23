"""Player-team checks and team season stats. Run: python3 -m pytest tests/test_teamcheck.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import teamcheck as T  # noqa: E402


def test_book_and_espn_abbreviations_agree():
    assert T.same("nba", "NYK", "NY") is True
    assert T.same("nba", "GSW", "GS") is True
    assert T.same("nhl", "TBL", "TB") is True
    assert T.same("nfl", "JAC", "JAX") is True
    assert T.same("mlb", "AZ", "ARI") is True
    assert T.same("mlb", "CWS", "CHW") is True


def test_two_known_teams_disagree():
    assert T.same("nba", "NYK", "BOS") is False
    assert "BOS" not in T.note("nba", "NYK", "BOS", "Boston Celtics") and "Boston Celtics" in T.note("nba", "NYK", "BOS", "Boston Celtics")
    assert "MLB has them" in T.note("mlb", "NYY", "BOS", "Boston Red Sox", "MLB")


def test_unknown_is_never_a_mismatch():
    assert T.same("nba", "XYZ", "NY") is None
    assert T.same("nba", "", "NY") is None
    assert T.same("soccer", "ARS", "CHE") is None
    assert T.note("nba", "XYZ", "NY", "New York Knicks") == ""


def test_find_player_prefers_this_league_and_the_exact_name(monkeypatch):
    import discord_bot as B
    items = [{"id": 1, "displayName": "Jalen Williams Jr.", "league": "nba"}, {"id": 2, "displayName": "Jalen Williams", "league": "nba"},
             {"id": 3, "displayName": "Jalen Williams", "league": "wnba"}]
    monkeypatch.setattr(B, "get_json", lambda url, ttl=0: {"items": items})
    monkeypatch.setattr(B, "memo", lambda key, ttl, fn: fn())
    assert B.find_player("nba", "Jalen Williams")["id"] == 2
    items[:] = [{"id": 9, "displayName": "Someone Else", "league": "nba"}]
    assert B.find_player("wnba", "Jalen Williams") is None          # an NBA player with another name is never used for WNBA


def test_mlb_people_search_prefers_active_exact_name(monkeypatch):
    import discord_bot as B
    people = [{"id": 1, "fullName": "Will Smithson", "active": True}, {"id": 2, "fullName": "Will Smith", "active": True}, {"id": 3, "fullName": "Will Smith", "active": False}]
    monkeypatch.setattr(B, "get_json", lambda url, ttl=0: {"people": people})
    monkeypatch.setattr(B, "memo", lambda key, ttl, fn: fn())
    assert B.find_player("mlb", "Will Smith")["id"] == 2


def test_team_stats_kept_once_with_honest_labels():
    import lab
    sd = {"season": {"year": 2026, "displayName": "2025-26"}, "results": {"stats": {"categories": [
        {"displayName": "Offense", "stats": [{"displayName": "Points", "displayValue": "1,382", "perGameDisplayValue": "115.2", "rankDisplayValue": "4th"},
                                              {"displayName": "Points Per Game", "displayValue": "115.2", "perGameDisplayValue": "115.2"},
                                              {"displayName": "Games Played", "displayValue": "12", "perGameDisplayValue": "1"},
                                              {"displayName": "Field Goal %", "displayValue": "47.5", "perGameDisplayValue": "0.5"}]},
        {"displayName": "Defense", "stats": [{"displayName": "Games Played", "displayValue": "12"}, {"displayName": "Steals", "displayValue": "0"}]}]}}}
    rows, season = lab._espn_team_stats(sd)
    by = {r["l"]: r for r in rows}
    assert season == "2025-26"
    assert [r["l"] for r in rows].count("Games Played") == 1 and "Steals" not in by
    assert by["Points"]["v"] == "1,382" and by["Points"]["pg"] == "115.2"
    assert by["Points Per Game"]["pg"] == "" and by["Field Goal %"]["pg"] == "" and by["Games Played"]["pg"] == ""


def test_mlb_pitching_runs_are_allowed():
    import lab
    labels = dict(lab.MLB_STATS["Pitching"])
    assert labels["runs"] == "Runs allowed" and labels["strikeoutsPer9Inn"] == "Strikeouts per 9 innings"
