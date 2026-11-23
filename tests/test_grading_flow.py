"""The completion test for Pick history: a pick is published, locked, its game starts and finishes, and it lands in the
right place on its own, with nobody touching it. Also: the original is never replaced, a failed lookup is retried
instead of being called "not graded", a re-check that changes a result is kept as a correction, the server's and
GitHub's copies merge without losing anything, and test picks never reach the real record.
Run: python3 -m pytest tests/test_grading_flow.py"""
import os
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import gradebook as GB  # noqa: E402
import propbook as PB  # noqa: E402
import record as R  # noqa: E402

NOW = 1_795_000_000
START = NOW + 3 * 3600
BOARD = {"nba": {"rows": [{"player": "Jalen Brunson", "k": "pts", "line": 26.5, "offers": [{"book": "prizepicks", "line": 26.5}, {"book": "prizepicks", "line": 27.5}]}]}}


def books(grade):
    PB.BOOK.clear()
    PB.setup(cache_dir=tempfile.mkdtemp(), board=lambda s: BOARD.get(s, {"rows": []}), grade=grade, mlb=lambda g, s: (None, ""), loop=False)


def prop(**kw):
    p = {"sport": "nba", "player": "Jalen Brunson", "team": "NY", "opp": "BOS", "k": "pts", "label": "Points", "line": 26.5, "side": "over",
         "ours": 0.64, "market": 0.52, "start": START, "books": ["prizepicks"], "conf": "medium"}
    p.update(kw)
    return p


def test_a_prop_goes_from_published_to_a_hit_on_its_own():
    answers = {"v": ("won", "31")}
    books(lambda g, s: answers["v"])
    assert PB.seen([prop()], now=NOW) == 1
    e = list(PB.BOOK.values())[0]
    st = lambda t: PB.entries(now=t)[0]["state"]
    assert st(NOW) == "published"
    PB.seen([prop(line=27.5, ours=0.58, market=0.5)], now=NOW + 3600)          # the line moved: saved beside the original
    assert e["line"] == 26.5 and e["first"]["ours"] == 0.64 and len(e["readings"]) == 2
    assert PB.seen([prop(ours=0.99)], now=START - 120) == 0                    # inside the lock: nothing changes
    assert e["close"]["line"] == 27.5
    assert st(START - 120) == "locked"
    assert st(START + 600) == "started"
    assert st(START + 4 * 3600) == "pending"
    PB.grade_pending(now=START + 4 * 3600)                                       # the loop runs: nobody presses anything
    r = PB.entries(receipts=True, now=START + 4 * 3600)[0]
    assert r["state"] == "won" and r["result"] == "won" and r["actual"] == "31"
    assert "line of 26.5" in r["calc"] and "hit" in r["calc"]                    # graded on the original line, not 27.5
    assert r["by"] == "server" and r["source"] and r["first"]["line"] == 26.5
    answers["v"] = ("lost", "25")                                                # a stat correction the next day
    PB.recheck(now=START + 30 * 3600)
    r = PB.entries(receipts=True, now=START + 30 * 3600)[0]
    assert r["state"] == "corrected" and r["result"] == "lost"
    assert r["corrections"][0]["from"] == "won" and r["corrections"][0]["to"] == "lost"


def test_a_failed_lookup_is_tried_again_not_marked_not_graded():
    books(lambda g, s: ("unknown", "no game log from ESPN"))
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 4 * 3600)
    e = list(PB.BOOK.values())[0]
    assert not e.get("result") and e.get("tried")
    PB.grade_pending(now=START + 6 * 86400)                                      # five days on, it says so
    assert e["result"] == "unknown" and "five days" in e["why"]


def test_a_dnp_is_void_and_a_real_result_is_never_replaced_by_not_found():
    books(lambda g, s: ("void", "DNP"))
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 4 * 3600)
    e = list(PB.BOOK.values())[0]
    assert e["result"] == "void"
    assert GB.set_result(e, "unknown", "", "lookup failed") is False and e["result"] == "void"


def test_github_and_server_copies_merge():
    books(lambda g, s: (None, ""))
    PB.seen([prop()], now=NOW)
    server = PB.snapshot()
    gh = {k: dict(v) for k, v in server.items()}
    for v in gh.values():
        GB.set_result(v, "won", "30", by="github", source="ESPN", now=START + 4 * 3600)
    PB.seen([prop(line=27.5)], now=NOW + 3600)                                    # the server kept reading after GitHub's copy
    PB.absorb(gh)
    e = list(PB.BOOK.values())[0]
    assert e["result"] == "won" and e["by"] == "github" and len(e["readings"]) == 2 and e["first"]["line"] == 26.5
    later = {k: dict(v, first=dict(v["first"], at=NOW + 50, line=30.5)) for k, v in PB.snapshot().items()}
    PB.absorb(later)                                                              # a copy with a later "original" loses
    assert list(PB.BOOK.values())[0]["first"]["line"] == 26.5


def test_the_sealed_copy_round_trips():
    os.environ["DISCORD_BOT_TOKEN"] = "test-token"
    try:
        books(lambda g, s: (None, ""))
        PB.seen([prop()], now=NOW)
        R.RECORD.clear()
        blob = GB.seal(GB.bundle(R, PB, "server"))
        got = GB.unseal(blob)
        assert got["props"] and got["by"] == "server"
        PB.BOOK.clear()
        assert GB.absorb(got, R, PB) == 1 and len(PB.BOOK) == 1
    finally:
        os.environ.pop("DISCORD_BOT_TOKEN", None)


def test_test_picks_stay_out_of_the_record():
    books(lambda g, s: ("won", "30"))
    PB.seen([prop()], now=NOW)
    list(PB.BOOK.values())[0]["test"] = True
    assert PB.entries(now=NOW) == [] and PB.counts(now=NOW) == {}
    assert len(PB.entries(now=NOW, tests=True)) == 1


# ---------- match forecasts ----------

class FakeForecaster:
    _lock = threading.RLock()

    def __init__(self, ko):
        self.TRACKED = {"football:401": {"sport": "football", "lg": "nfl", "id": "401", "ko": ko, "home": "Jets", "away": "Bills"}}
        self.FORECASTS = {"football:401": {"ko": ko, "snaps": [
            {"at": ko - 7 * 86400, "stage": "week", "pick": "home", "top": 0.55, "final": {"home": 0.55, "away": 0.45}, "market": {"home": 0.5, "away": 0.5}},
            {"at": ko - 1800, "stage": "final", "pick": "away", "top": 0.58, "final": {"home": 0.42, "away": 0.58}, "market": {"home": 0.45, "away": 0.55}, "conf": "medium"}]}}


def summary(state="post", name="STATUS_FINAL", home=17, away=24):
    return {"header": {"competitions": [{"status": {"type": {"state": state, "name": name, "completed": state == "post"}},
                                         "competitors": [{"homeAway": "home", "score": str(home)}, {"homeAway": "away", "score": str(away)}]}]}}


def matches(answer):
    R.RECORD.clear()
    R.setup(fetch=lambda url, ttl, as_json=False: answer["v"], fm_matchstats=lambda **k: None, forecaster=FakeForecaster(START),
            cache_dir=tempfile.mkdtemp(), loop=False)


def test_a_match_forecast_is_locked_at_kickoff_and_graded():
    answer = {"v": summary(state="in")}
    matches(answer)
    assert R.upcoming(now=NOW)[0]["state"] == "published"
    R.log_kickoffs(now=START + 60)
    e = R.RECORD["football:401"]
    assert e["pick"] == "away" and e["first"]["pick"] == "home" and len(e["readings"]) == 2   # the change of mind is kept
    R.grade_pending(now=START + 3 * 3600)
    assert not e.get("result")                                                    # still being played
    answer["v"] = summary()
    R.grade_pending(now=START + 4 * 3600)
    r = R.entries(receipts=True, now=START + 4 * 3600)[0]
    assert r["result"] == "won" and r["state"] == "won" and "Bills" in r["calc"] and r["source"] == "ESPN game summary"


def test_a_match_with_no_final_is_not_graded_not_void():
    answer = {"v": {}}
    matches(answer)
    R.log_kickoffs(now=START + 60)
    R.grade_pending(now=START + 5 * 86400)
    assert R.RECORD["football:401"]["result"] == "unknown"
    answer["v"] = summary(state="post", name="STATUS_POSTPONED")
    matches(answer)
    R.log_kickoffs(now=START + 60)
    R.grade_pending(now=START + 3 * 3600)
    assert R.RECORD["football:401"]["result"] == "void"


def test_the_hourly_github_run_grades_the_servers_picks_and_sends_them_back(monkeypatch, tmp_path):
    """site_grader.py as the workflow runs it, with the server and ESPN faked."""
    os.environ["DISCORD_BOT_TOKEN"] = "test-token"
    try:
        import site_grader as SG
        books(lambda g, s: (None, ""))
        PB.seen([prop()], now=NOW)                                                # the server locked a prop
        R.RECORD.clear()
        server_blob = GB.seal(GB.bundle(R, PB, "server"))
        sent = []
        monkeypatch.setattr(GB, "_http", lambda url, data=None, timeout=60: sent.append(data) or b"" if data is not None else server_blob)
        monkeypatch.setattr(SG, "DATA", tmp_path)
        monkeypatch.setattr(SG, "FILE", tmp_path / "site-record.enc")
        SG.setup()
        monkeypatch.setattr(PB, "D", dict(PB.D, grade=lambda g, s: ("won", "33")))
        assert SG.load() == (True, False)
        assert SG.grade(now=START + 4 * 3600) == 1
        SG.save(1)
        back = GB.unseal(sent[0])
        e = list(back["props"].values())[0]
        assert e["result"] == "won" and e["by"] == "github" and back["gradedAt"]
        assert (tmp_path / "site-record.enc").exists()
        PB.BOOK.clear()                                                           # the server restarts with an empty disk
        GB.absorb(GB.unseal((tmp_path / "site-record.enc").read_bytes()), R, PB)
        assert list(PB.BOOK.values())[0]["result"] == "won"
    finally:
        os.environ.pop("DISCORD_BOT_TOKEN", None)
