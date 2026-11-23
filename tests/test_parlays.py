"""Parlay ops on the server: what a leg may carry, picks that can't all hit, and the closing-price window.
Run: python3 -m pytest tests/test_parlays.py -q"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
_argv, sys.argv = sys.argv, [sys.argv[0]]   # server.py reads a port from the command line when it is imported
import server as S   # noqa: E402
sys.argv = _argv

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def no_disk(monkeypatch):
    monkeypatch.setattr(S.storage, "save", lambda *a, **k: None)   # nothing is written to the real cache folder, only while these tests run


USER = {"username": "tester"}
H = 3600 * 1000


def fresh():
    S._parlays.clear()


def leg(id_, typ="win", start=None, **kw):
    base = {"id": id_, "type": typ, "text": id_, "lg": "nfl", "start": start if start is not None else (time.time() * 1000 + 3 * H), "gameKey": "nfl:401"}
    base.update(kw)
    return base


def add(*legs, **body):
    return S.parlays_action({"op": "add", "legs": list(legs), **body}, USER)


def test_new_fields_are_whitelisted_and_typed():
    fresh()
    code, d = add(leg("total:o", "total", side="over", line=49.0, posted=47.5, edited=True, rAt=1.7e12, mAt=1.7e12, msrc="ESPN BET",
                      close=0.6, closeAt=1, res="hit", evil="<script>", ours0=0.5),
                  warn="  Strongly   related: a and b. ", edited=True, lo0=0.2, hi0=0.3, close=1)
    assert code == 200
    p = d["parlay"]
    l = p["legs"][0]
    assert l["edited"] is True and l["posted"] == 47.5 and l["msrc"] == "ESPN BET" and l["rAt"] == 1.7e12
    assert "close" not in l and "closeAt" not in l and "res" not in l and "evil" not in l   # never taken from "add"
    assert p["warn"] == "Strongly related: a and b." and p["edited"] is True and p["lo0"] == 0.2 and p["hi0"] == 0.3 and p["v"] == 2
    assert "close" not in p


def test_bad_types_are_dropped():
    fresh()
    code, d = add(leg("w", edited="yes", posted="47.5", rAt=True), warn=12, lo0=2, hi0=-1, edited="true")
    assert code == 200
    l, p = d["parlay"]["legs"][0], d["parlay"]
    assert "edited" not in l and "posted" not in l and "rAt" not in l
    assert "warn" not in p and "lo0" not in p and "hi0" not in p and "edited" not in p


def test_warning_is_cut_to_length():
    fresh()
    code, d = add(leg("w"), warn="x" * 999)
    assert code == 200 and len(d["parlay"]["warn"]) == 240


def test_impossible_combinations_are_refused():
    fresh()
    cases = [
        (leg("win:h", side="home"), leg("win:a", side="away")),                                             # both teams to win
        (leg("win:h", side="home"), leg("draw", "draw", side="home")),                                      # a winner and a draw
        (leg("sp:h", "spread", side="home", line=-3.5), leg("sp:a", "spread", side="away", line=3.5)),      # both sides of a spread
        (leg("sp:h1", "spread", side="home", line=-3.5), leg("sp:h2", "spread", side="home", line=-6.5)),   # one side at two lines
        (leg("sp:h", "spread", side="home", line=-3.5), leg("win:a", side="away")),                         # favourite covers, the other team wins
        (leg("t:o", "total", side="over", line=47.5), leg("t:u", "total", side="under", line=47.5)),         # total over and under one line
        (leg("p:o", "prop", player="Patrick Mahomes", k="pyd", side="over", line=274.5, gameKey="nfl:KC|BUF"),
         leg("p:u", "prop", player="Patrick Mahomes", k="pyd", side="under", line=274.5, gameKey="nfl:BUF|KC")),   # over and under one player line
        (leg("p:o", "prop", player="Patrick Mahomes", k="pyd", side="over", line=280.5), leg("p:u", "prop", player="Patrick Mahomes", k="pyd", side="under", line=260.5)),
        (leg("w1", side="home"), leg("w2", side="home")),                                                   # the same pick under two ids
    ]
    for a, b in cases:
        code, d = add(a, b)
        assert code == 400, (a["id"], b["id"], d)
        assert d["error"]
    assert S._parlays.get("tester") == []


def test_possible_combinations_are_kept():
    fresh()
    for a, b in [
        (leg("win:h", side="home"), leg("t:o", "total", side="over", line=47.5)),
        (leg("p:o", "prop", player="Patrick Mahomes", k="pyd", side="over", line=250.5), leg("p:u", "prop", player="Patrick Mahomes", k="pyd", side="under", line=299.5)),   # a gap both can land in
        (leg("sp:a", "spread", side="away", line=3.5), leg("win:h", side="home")),   # the favourite wins by less than 3.5
        (leg("win:h", side="home"), leg("win:x", side="away", gameKey="nfl:402")),  # two games
    ]:
        code, d = add(a, b)
        assert code == 200, (a["id"], b["id"], d)


def test_started_games_are_refused():
    fresh()
    code, d = add(leg("w", start=time.time() * 1000 - 10 * 60 * 1000))
    assert code == 400 and "started" in d["error"]


def _parlay_with_start(start_ms):
    fresh()
    code, d = add(leg("w", start=start_ms))
    assert code == 200
    return d["parlay"]["id"]


def _close(pid, value=0.58, id_="w"):
    return S.parlays_action({"op": "close", "id": pid, "legs": [{"id": id_, "close": value}]}, USER)


def _leg_of(pid):
    return next(p for p in S._parlays["tester"] if p["id"] == pid)["legs"][0]


def test_close_is_taken_inside_its_window_and_once(monkeypatch):
    start = time.time() * 1000 + 3 * H
    pid = _parlay_with_start(start)
    real = time.time
    monkeypatch.setattr(S.time, "time", lambda: start / 1000 - 31 * 60)   # 31 minutes before the start: too early
    _close(pid)
    assert "close" not in _leg_of(pid)
    monkeypatch.setattr(S.time, "time", lambda: start / 1000 - 10 * 60)   # 10 minutes before: taken
    code, d = _close(pid, 0.58)
    assert code == 200 and _leg_of(pid)["close"] == 0.58 and _leg_of(pid)["closeAt"]
    _close(pid, 0.7)                                                       # only once
    assert _leg_of(pid)["close"] == 0.58
    monkeypatch.setattr(S.time, "time", real)


def test_close_after_the_window_is_refused(monkeypatch):
    start = time.time() * 1000 + 3 * H
    pid = _parlay_with_start(start)
    monkeypatch.setattr(S.time, "time", lambda: start / 1000 + 6 * 60)    # 6 minutes after the start
    _close(pid)
    assert "close" not in _leg_of(pid)
    monkeypatch.setattr(S.time, "time", lambda: start / 1000 + 4 * 60)    # 4 minutes after: still inside
    _close(pid, 0.41)
    assert _leg_of(pid)["close"] == 0.41


def test_close_values_are_checked(monkeypatch):
    start = time.time() * 1000 + 3 * H
    pid = _parlay_with_start(start)
    monkeypatch.setattr(S.time, "time", lambda: start / 1000 - 60)
    for bad in (0, 1, 1.5, -0.2, "0.5", True, None):
        _close(pid, bad)
        assert "close" not in _leg_of(pid), bad
    _close(pid, 0.5, id_="nope")
    assert "close" not in _leg_of(pid)


def test_result_still_waits_for_the_start():
    fresh()
    code, d = add(leg("w"))
    pid = d["parlay"]["id"]
    S.parlays_action({"op": "result", "id": pid, "legs": [{"id": "w", "res": "hit"}]}, USER)
    assert "res" not in _leg_of(pid)


def test_old_parlays_without_new_fields_still_edit():
    fresh()
    S._parlays["tester"] = [{"id": "pold", "at": 1, "name": "", "status": "open", "legs": [{"id": "w", "type": "win", "text": "w", "start": 1}]}]
    code, d = S.parlays_action({"op": "edit", "id": "pold", "odds": 250}, USER)
    assert code == 200 and d["parlay"]["odds"] == 250
    code, d = S.parlays_action({"op": "close", "id": "pold", "legs": [{"id": "w", "close": 0.5}]}, USER)   # long past its window
    assert code == 200 and "close" not in d["parlay"]["legs"][0]
