"""Prop record tests: what gets locked in, the closing-line check and grading. Run: python3 -m pytest tests/test_propbook.py"""
import datetime as dt
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import propbook as PB  # noqa: E402

NOW = 1_795_000_000
START = NOW + 3 * 3600
BOARD = {"nba": {"rows": [{"player": "Jalen Brunson", "k": "pts", "line": 26.5, "offers": [{"book": "prizepicks", "line": 26.5}, {"book": "sleeper", "line": 27.5}]}]}}


def fresh(grade=None):
    PB.BOOK.clear()
    PB.setup(cache_dir=tempfile.mkdtemp(), board=lambda s: BOARD.get(s, {"rows": []}), grade=grade or (lambda g, s: (None, "")), mlb=lambda g, s: (None, ""), loop=False)


def prop(**kw):
    p = {"sport": "nba", "player": "Jalen Brunson", "k": "pts", "label": "Points", "line": 26.5, "side": "over", "ours": 0.61, "market": 0.52,
         "start": START, "books": ["prizepicks"], "conf": "medium"}
    p.update(kw)
    return p


def test_only_posted_lines_before_the_start_are_kept():
    fresh()
    assert PB.seen([prop(), prop(line=30.5), prop(player="Nobody Real"), prop(start=NOW - 60), prop(ours=1.4), prop(side="sideways")], now=NOW) == 1
    e = list(PB.BOOK.values())[0]
    assert e["first"]["edge"] == 9 and e["first"]["books"] == ["prizepicks"]


def test_the_first_reading_is_locked_and_the_close_follows():
    fresh()
    PB.seen([prop()], now=NOW)
    PB.seen([prop(line=27.5, ours=0.55, market=0.5)], now=NOW + 3600)     # line moved up: good for an over
    PB.seen([prop(ours=0.9)], now=START + 60)                             # after the start: ignored
    e = list(PB.BOOK.values())[0]
    assert e["first"]["ours"] == 0.61 and e["line"] == 26.5
    assert e["close"]["line"] == 27.5
    assert PB.clv(e)["beat"] is True


def test_closing_price_at_the_same_line():
    fresh()
    PB.seen([prop()], now=NOW)
    PB.seen([prop(side="under", market=0.55)], now=NOW + 1800)           # the board flipped sides: 45% for the over now
    assert PB.clv(list(PB.BOOK.values())[0])["beat"] is False
    fresh()
    PB.seen([prop()], now=NOW)
    assert PB.clv(list(PB.BOOK.values())[0])["beat"] is None             # nothing later to compare with


def test_grading_and_give_up():
    calls = []

    def grade(g, slate):
        calls.append((g["player"], g["stat"], g["line"], g["side"], slate))
        return "won", "31"
    fresh(grade)
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 3600)                                     # too early
    assert not calls
    PB.grade_pending(now=START + 4 * 3600)
    e = list(PB.BOOK.values())[0]
    assert e["result"] == "won" and e["actual"] == "31" and calls[0][4] == dt.date.fromisoformat(PB.game_day(START))
    fresh()
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 6 * 86400)
    assert list(PB.BOOK.values())[0]["result"] == "unknown"


def test_soccer_is_marked_not_graded():
    BOARD["soccer"] = {"rows": [{"player": "Bukayo Saka", "k": "shots", "line": 2.5, "offers": [{"book": "prizepicks", "line": 2.5}]}]}
    fresh()
    PB.seen([prop(sport="soccer", player="Bukayo Saka", k="shots", line=2.5)], now=NOW)
    PB.grade_pending(now=START + 4 * 3600)
    e = list(PB.BOOK.values())[0]
    assert e["result"] == "unknown" and "Soccer" in e["why"]


def test_mlb_grader_reads_the_day():
    class B:
        STAT = {"mlb": {"h": {"get": lambda x: x["raw"].get("hits")}}}
        stat_sport = staticmethod(lambda s: s)
        fmt = staticmethod(lambda v: str(int(v)))
        find_player = staticmethod(lambda sp, n: {"id": 1, "name": n})
        mlb_season = staticmethod(lambda pid, y: [{"date": dt.datetime(2026, 9, 3, 12, tzinfo=dt.timezone.utc), "raw": {"hits": 2}}])
    go = PB.mlb_grade(B)
    assert go({"player": "A", "stat": "h", "line": 1.5, "side": "over"}, dt.date(2026, 9, 3)) == ("won", "2")
    assert go({"player": "A", "stat": "h", "line": 2, "side": "over"}, dt.date(2026, 9, 3)) == ("push", "2")
    assert go({"player": "A", "stat": "h", "line": 1.5, "side": "over"}, dt.date(2026, 9, 4))[0] == "void"   # long over, no game: didn't play
