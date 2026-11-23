"""Administrator grade corrections (Erez's item 2): a wrong grade can be corrected, the receipt is never touched, every
change is kept in the pick's correction history, automatic re-grading never undoes an administrator's correction, and
GitHub's copy can't bring the old grade back. Run: python3 -m pytest tests/test_grade_corrections.py"""
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import pytest  # noqa: E402

import gradebook as GB  # noqa: E402

NOW = 1795453200


def pick():
    e = {"key": "nfl:jalenhurts:py:225.5", "sport": "nfl", "player": "Jalen Hurts", "label": "Pass yards", "line": 225.5, "side": "over", "start": NOW - 86400,
         "first": {"at": NOW - 90000, "ours": .62, "line": 225.5}}
    e["receipt"] = GB.receipt(id=e["key"], publishedAt=NOW - 90000, line=225.5, side="over", modelProb=.62, supportedEdge=6)
    GB.set_result(e, "lost", actual="219", by="server", source="ESPN game log", now=NOW - 80000, closing={"line": 226.5, "price": None, "at": NOW - 86700})
    return e


def test_an_admin_corrects_a_grade_and_the_history_keeps_both():
    e = pick()
    rc = copy.deepcopy(e["receipt"])
    c = GB.correct(e, "won", actual="231", why="ESPN's box score missed a 12-yard completion", by="Erez", now=NOW)
    assert c["from"] == "lost" and c["to"] == "won" and c["fromActual"] == "219" and c["toActual"] == "231" and c["admin"]
    assert e["result"] == "won" and e["actual"] == "231" and e["source"] == "Administrator correction" and e["adminLock"]
    assert e["receipt"] == rc and GB.receipt_ok(e["receipt"])          # the published receipt is untouched
    assert e["closing"]["line"] == 226.5                                 # so is the closing line saved at grading
    assert GB.state(e["start"], e["result"], 3600, e.get("corrections"), NOW) == "corrected"


def test_a_correction_needs_a_reason_and_a_real_grade():
    e = pick()
    with pytest.raises(ValueError):
        GB.correct(e, "won", why="")
    with pytest.raises(ValueError):
        GB.correct(e, "maybe", why="because the stat was wrong")
    assert GB.correct(e, "lost", actual="219", why="checked again, it was right") is None   # nothing changed, nothing logged


def test_automatic_regrading_never_undoes_an_admin_correction():
    e = pick()
    GB.correct(e, "won", actual="231", why="box score corrected by the league", by="Erez", now=NOW)
    assert GB.set_result(e, "lost", actual="219", by="github", why="re-check", now=NOW + 3600) is False
    assert GB.set_result(e, "lost", actual="219", by="server", now=NOW + 3600) is False
    assert e["result"] == "won" and len(e["corrections"]) == 1


def test_an_admin_can_correct_again_and_both_changes_are_kept():
    e = pick()
    GB.correct(e, "won", actual="231", why="box score corrected by the league", by="Erez", now=NOW)
    GB.correct(e, "push", actual="225.5", why="the league's final number lands on the line", by="Erez", now=NOW + 60)
    assert [c["to"] for c in e["corrections"]] == ["won", "push"] and e["result"] == "push"


def test_githubs_older_copy_cannot_bring_the_old_grade_back():
    server, github = pick(), pick()
    GB.set_result(github, "lost", actual="219", by="github", why="re-checked", now=NOW - 1000)   # GitHub re-checked: same grade
    GB.correct(server, "won", actual="231", why="box score corrected by the league", by="Erez", now=NOW)
    for a, b in ((server, github), (github, server)):
        m = GB.merge_entry(a, b)
        assert m["result"] == "won" and m["adminLock"] and m["corrections"][-1]["admin"]
