"""Private competitions and "most researched today". Run: python3 -m pytest tests/test_groups.py"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import daily   # noqa: E402
import groups  # noqa: E402

ANN = {"username": "ann", "prefs": {"display": "Ann"}}
BOB = {"username": "bob", "prefs": {"display": "Bob"}}
CAT = {"username": "cat", "prefs": {"display": "Cat"}}


def fresh(tmp_path, fetch=None, grade=None):
    groups.PATH = tmp_path / "groups.json"
    groups.D.clear()
    groups.D.update({"groups": {}, "picks": {}})
    groups.DEPS.clear()
    groups.DEPS.update(fetch=fetch, grade=grade, grade_mlb=None)


def winner(start, choice="a", event="401"):
    return {"kind": "winner", "lg": "nba", "sport": "basketball", "event": event, "start": start * 1000, "choice": choice,
            "a": {"id": "13", "name": "Lakers"}, "b": {"id": "2", "name": "Celtics"}}


def make(tmp_path):
    fresh(tmp_path)
    st, out = groups.post("/api/groups/create", {"name": "Friday crew"}, ANN)
    assert st == 200
    g = out["group"]
    assert groups.post("/api/groups/join", {"code": g["code"].lower()}, BOB)[0] == 200
    return g


def test_create_join_and_owner_rules(tmp_path):
    g = make(tmp_path)
    assert groups.post("/api/groups/create", {"name": "x"}, ANN)[0] == 400          # name too short
    st, out = groups.get("/api/groups/preview", {"code": g["code"]}, CAT)
    assert st == 200 and out["group"]["members"] == 2 and not out["group"]["in"]
    assert groups.post("/api/groups/rename", {"id": g["id"], "name": "New"}, BOB)[0] == 403   # only the owner
    assert groups.post("/api/groups/leave", {"id": g["id"]}, ANN)[0] == 400                    # owner with members
    old = g["code"]
    st, out = groups.post("/api/groups/code", {"id": g["id"]}, ANN)
    assert st == 200 and out["group"]["code"] != old
    assert groups.post("/api/groups/join", {"code": old}, CAT)[0] == 404                       # the old link stops working
    assert groups.get("/api/groups/get", {"id": g["id"]}, CAT)[0] == 404                       # not a member


def test_pick_rules_and_privacy(tmp_path):
    g = make(tmp_path)
    now = time.time()
    assert groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now - 60)}, BOB)[0] == 400      # started
    assert groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 20 * 86400)}, BOB)[0] == 400  # too far ahead
    assert groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 3600, "draw")}, BOB)[0] == 400  # no draws in the NBA
    bad = winner(now + 3600)
    bad["event"] = "../x"
    assert groups.post("/api/groups/pick", {"id": g["id"], "pick": bad}, BOB)[0] == 400
    assert groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 3600)}, BOB)[0] == 200
    # picking the same game again replaces the pick instead of adding one
    assert groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 3600, "b")}, BOB)[0] == 200
    assert len(groups.D["picks"][g["id"]]) == 1
    # Ann can't see Bob's pick before the game starts
    st, out = groups.get("/api/groups/get", {"id": g["id"]}, ANN)
    txt = str(out)
    assert st == 200 and "'choice': 'b'" not in txt


def test_grading_points_and_upset(tmp_path):
    summary = {"header": {"competitions": [{"status": {"type": {"state": "post"}}, "competitors": [
        {"team": {"id": "13", "displayName": "Los Angeles Lakers"}, "score": "110", "winner": True, "homeAway": "away"},
        {"team": {"id": "2", "displayName": "Boston Celtics"}, "score": "104", "winner": False, "homeAway": "home"}]}]},
        "pickcenter": [{"awayTeamOdds": {"moneyLine": 180}, "homeTeamOdds": {"moneyLine": -220}}]}
    g = make(tmp_path)
    groups.DEPS["fetch"] = lambda url, ttl, as_json=True: summary
    now = time.time()
    groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 3600, "a")}, BOB)
    groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 3600, "b")}, ANN)
    groups.grade_due(now + 4 * 3600)
    ps = {p["user"]: p for p in groups.D["picks"][g["id"]]}
    assert ps["bob"]["result"] == "won" and ps["bob"]["upset"] and ps["bob"]["pts"] == groups.POINTS_WIN + groups.POINTS_UPSET
    assert ps["ann"]["result"] == "lost" and ps["ann"]["pts"] == 0
    st, out = groups.get("/api/groups/get", {"id": g["id"]}, ANN)
    season = out["group"].get("season") or out["group"].get("boards", {}).get("season")
    assert season[0]["name"] == "Bob" and season[0]["rank"] == 1


def test_unfinished_pick_goes_void_after_five_days(tmp_path):
    g = make(tmp_path)
    groups.DEPS["fetch"] = lambda url, ttl, as_json=True: {"header": {"competitions": [{"status": {"type": {"state": "in"}}}]}}
    now = time.time()
    groups.post("/api/groups/pick", {"id": g["id"], "pick": winner(now + 3600)}, BOB)
    groups.grade_due(now + 4 * 3600)
    assert not groups.D["picks"][g["id"]][0].get("result")
    groups.grade_due(now + 6 * 86400)
    assert groups.D["picks"][g["id"]][0]["result"] == "void"


def test_research_counts(tmp_path):
    daily.PATH = tmp_path / "rc.json"
    daily.D.clear()
    daily._state.update(loaded=True, saved=time.time())
    assert daily.seen("LeBron James", "nba") and daily.seen("LeBron James", "nba") and daily.seen("Jalen Brunson", "nba")
    assert not daily.seen("<script>", "nba") and not daily.seen("LeBron James", "xyz")
    top = daily.top(5)
    assert top[0] == {"sport": "nba", "name": "LeBron James", "n": 2} and len(top) == 2
