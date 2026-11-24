"""Prediction receipts and grading (Erez's final pass, item 10, and required tests 10 and 11).

A receipt is written once, when a pick is published, with everything known about it then. Later readings, a moved
line, injury news, a merge with GitHub's copy and a re-grade never change it, and its fingerprint shows if anyone did.
Grading saves the result, the player's stat or the final score, the closing line and price, the time and the source.
Voided and postponed games are kept on the list but never counted as hits or misses.
Run: python3 -m pytest tests/test_receipts.py"""
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import gradebook as GB  # noqa: E402
import propbook as PB  # noqa: E402
import record as R  # noqa: E402
from test_grading_flow import NOW, START, books, matches, prop, summary  # noqa: E402

FULL = dict(event="401772938", playerId="nfl:4429084", teamId="13", oppId="22", league="nfl", marketId="prizepicks:pts:26.5",
            provider="PrizePicks", sedge=6, lo=0.55, hi=0.7, sources=["ESPN game log", "PrizePicks line"], injury="Questionable",
            lineup="Lineup not announced", verifiedAt=(NOW - 60) * 1000)


def one():
    return list(PB.BOOK.values())[0]


def test_a_published_prop_saves_a_full_receipt():
    books(lambda g, s: (None, ""))
    assert PB.seen([prop(**FULL)], now=NOW) == 1
    r = one()["receipt"]
    assert r["id"] == one()["key"] and r["publishedAt"] == NOW and r["start"] == START and r["event"] == "401772938"
    assert r["player"] == "Jalen Brunson" and r["playerId"] == "nfl:4429084" and r["teamId"] == "13" and r["oppId"] == "22"
    assert r["matchup"] == "NY vs BOS" and r["market"] == "Points" and r["marketId"] == "prizepicks:pts:26.5"
    assert r["line"] == 26.5 and r["side"] == "over" and r["provider"] == "PrizePicks"
    assert r["modelProb"] == 0.64 and r["marketProb"] == 0.52 and r["rawEdge"] == 12 and r["supportedEdge"] == 6
    assert r["confidence"] == "medium" and r["confRange"] == [0.55, 0.7] and r["sources"] == ["ESPN game log", "PrizePicks line"]
    assert r["injury"] == "Questionable" and r["lineup"] == "Lineup not announced" and r["verifiedAt"] == NOW - 60
    assert GB.receipt_ok(r)


def test_a_receipt_keeps_the_evidence_grade_sample_size_and_provider_market_id():
    books(lambda g, s: (None, ""))
    PB.seen([prop(**dict(FULL, grade="B", n=18, providerMarketId="pp-889120"))], now=NOW)
    r = one()["receipt"]
    assert r["evidence"] == "B" and r["sample"] == 18 and r["providerMarketId"] == "pp-889120" and GB.receipt_ok(r)
    r["evidence"] = "A"                                                                # a better grade written in later
    assert GB.receipt_ok(r) is False


def test_a_made_up_evidence_grade_is_not_saved():
    books(lambda g, s: (None, ""))
    PB.seen([prop(**dict(FULL, grade="A+", n=9999))], now=NOW)
    r = one()["receipt"]
    assert r["evidence"] is None and r["sample"] is None and GB.receipt_ok(r)


def test_a_receipt_written_before_the_evidence_fields_still_checks_out():
    old = GB.receipt(id="k1", publishedAt=NOW, player="Jalen Brunson", line=26.5, side="over")
    assert "evidence" not in old and GB.receipt_ok(old)
    old["line"] = 27.5
    assert GB.receipt_ok(old) is False


def test_later_data_never_rewrites_the_receipt():
    books(lambda g, s: ("won", "31"))
    PB.seen([prop(**FULL)], now=NOW)
    before = copy.deepcopy(one()["receipt"])
    PB.seen([prop(**dict(FULL, injury="Out", sedge=-4), line=27.5, ours=0.4, market=0.6)], now=NOW + 3600)   # line moved, injury news
    assert one()["receipt"] == before and one()["close"]["line"] == 27.5
    other = {k: dict(v, receipt=dict(v["receipt"], line=99, sha="x"), first=dict(v["first"], at=NOW + 50)) for k, v in PB.BOOK.items()}
    PB.absorb(other)                                                                  # a later copy with a different receipt
    assert one()["receipt"] == before
    PB.grade_pending(now=START + 4 * 3600)
    PB.recheck(now=START + 30 * 3600)
    assert one()["receipt"] == before and GB.receipt_ok(one()["receipt"])


def test_an_edited_receipt_is_detected():
    books(lambda g, s: (None, ""))
    PB.seen([prop()], now=NOW)
    one()["receipt"]["line"] = 25.5
    assert PB.entries(receipts=True, now=NOW)[0]["receiptOk"] is False


def test_a_prop_saved_before_receipts_gets_one_from_its_first_reading():
    books(lambda g, s: (None, ""))
    PB.seen([prop()], now=NOW)
    one().pop("receipt")
    PB.seen([prop(line=27.5)], now=NOW + 3600)
    r = PB.entries(receipts=True, now=NOW + 3600)[0]["receipt"]
    assert r["backfilled"] and r["line"] == 26.5 and r["publishedAt"] == NOW and GB.receipt_ok(r)


# ---------- required test 10: pick grading after a final result ----------

def test_10_a_prop_is_graded_after_the_final_with_every_grading_field():
    books(lambda g, s: ("won", "31"))
    PB.seen([prop(**FULL)], now=NOW)
    PB.seen([prop(line=27.5, ours=0.6, market=0.55)], now=NOW + 3600)                  # the closing line
    assert PB.grade_pending(now=START + 60) == 0                                     # not before the game is over
    assert PB.entries(receipts=True, now=START + 60)[0]["grading"] is None
    PB.grade_pending(now=START + 4 * 3600)
    g = PB.entries(receipts=True, now=START + 4 * 3600)[0]["grading"]
    assert g["result"] == "won" and g["stat"] == "31" and g["closeLine"] == 27.5 and g["closeMarket"] == 0.55
    assert g["gradedAt"] == START + 4 * 3600 and g["source"] == "ESPN game log and box score" and g["by"] == "server"


def test_10_a_regrade_keeps_the_first_closing_line():
    answers = {"v": ("won", "31")}
    books(lambda g, s: answers["v"])
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 4 * 3600)
    closing = dict(one()["closing"])
    one()["close"] = dict(one()["close"], line=40)
    answers["v"] = ("lost", "25")
    PB.recheck(now=START + 30 * 3600)
    assert one()["closing"] == closing and one()["result"] == "lost"


def test_10_a_match_is_graded_after_the_final_with_a_receipt_and_closing_price():
    answer = {"v": summary()}
    matches(answer)
    R.log_kickoffs(now=START + 60)
    R.grade_pending(now=START + 4 * 3600)
    e = R.entries(receipts=True, now=START + 4 * 3600)[0]
    rc, g = e["receipt"], e["grading"]
    assert rc["side"] == "home" and rc["modelProb"] == 0.55 and rc["marketProb"] == 0.5 and rc["rawEdge"] == 5   # the first forecast
    assert rc["event"] == "401" and rc["matchup"] == "Jets vs Bills" and e["receiptOk"]
    assert g["result"] == "won" and g["stat"] == "away" and g["closeMarket"] == 0.55 and g["source"] == "ESPN game summary"


# ---------- required test 11: voided and postponed games ----------

def test_11_a_player_who_did_not_play_is_void_and_not_counted():
    books(lambda g, s: ("void", "DNP"))
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 4 * 3600)
    e = PB.entries(receipts=True, now=START + 4 * 3600)[0]
    assert e["result"] == "void" and e["state"] == "void" and e["grading"]["result"] == "void"
    assert "not counted" in e["calc"]


def test_11_a_postponed_match_is_void_and_a_missing_final_is_not():
    answer = {"v": summary(state="post", name="STATUS_POSTPONED")}
    matches(answer)
    R.log_kickoffs(now=START + 60)
    R.grade_pending(now=START + 3 * 3600)
    e = R.entries(receipts=True, now=START + 3 * 3600)[0]
    assert e["result"] == "void" and e["grading"]["result"] == "void" and "not played" in e["calc"]
    answer["v"] = {}
    matches(answer)
    R.log_kickoffs(now=START + 60)
    R.grade_pending(now=START + 5 * 86400)
    assert R.RECORD["football:401"]["result"] == "unknown"                          # never a void without a postponement


def test_11_a_void_never_becomes_a_hit_or_miss_without_a_logged_correction():
    answers = {"v": ("void", "DNP")}
    books(lambda g, s: answers["v"])
    PB.seen([prop()], now=NOW)
    PB.grade_pending(now=START + 4 * 3600)
    answers["v"] = ("unknown", "no game log")
    PB.recheck(now=START + 30 * 3600)
    assert one()["result"] == "void"
