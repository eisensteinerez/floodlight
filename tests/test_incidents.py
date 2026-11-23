"""Public incidents on the Trust and Data Center page (health.incidents): two failures in a row open an outage, the
next good answer resolves it, and a single blip is never listed. Run: python3 -m pytest tests/test_incidents.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import health  # noqa: E402

T0 = 1795453200


def clock(monkeypatch):
    t = {"now": T0}
    monkeypatch.setitem(health.D, "now", lambda: t["now"])
    monkeypatch.setitem(health.S, "feeds", {})
    monkeypatch.setitem(health.S, "incidents", [])
    return t


def test_two_failures_open_an_outage_and_a_good_answer_resolves_it(monkeypatch):
    t = clock(monkeypatch)
    health.ok("props", "nfl")
    t["now"] += 60; health.fail("props", "nfl", "HTTP Error 503: Service Unavailable")
    t["now"] += 900; health.fail("props", "nfl", "HTTP Error 503: Service Unavailable")
    i = health.incidents()
    assert [x["label"] for x in i["open"]] == ["Player props"] and i["open"][0]["from"] == T0 + 60 and not i["resolved"]
    t["now"] += 900; health.ok("props", "nfl")
    i = health.incidents()
    assert not i["open"] and len(i["resolved"]) == 1
    r = i["resolved"][0]
    assert (r["from"], r["to"], r["name"], r["err"]) == (T0 + 60, T0 + 1860, "NFL", "answered with error 503")


def test_a_single_blip_is_not_an_incident(monkeypatch):
    t = clock(monkeypatch)
    health.ok("scores", "nba")
    t["now"] += 60; health.fail("scores", "nba", "timed out")
    t["now"] += 60; health.ok("scores", "nba")
    assert health.incidents() == {"open": [], "resolved": []}


def test_old_incidents_drop_off_after_thirty_days(monkeypatch):
    t = clock(monkeypatch)
    for _ in range(2):
        health.fail("injuries", "nfl", "timed out")
    health.ok("injuries", "nfl")
    t["now"] += 31 * 86400
    assert health.incidents()["resolved"] == []
    assert "incidents" in health.status()
