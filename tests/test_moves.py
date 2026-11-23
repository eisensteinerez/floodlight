"""Transfer window reader tests on real ESPN transaction sentences (NBA and NFL, July to November 2026).
Run: python3 tests/test_moves.py  (or pytest)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import moves_parse as M  # noqa: E402

TEAMS = [
    ("1", "Los Angeles Lakers", "Los Angeles", "Lakers", "LAL"), ("2", "Chicago Bulls", "Chicago", "Bulls", "CHI"),
    ("3", "Charlotte Hornets", "Charlotte", "Hornets", "CHA"), ("4", "Dallas Mavericks", "Dallas", "Mavericks", "DAL"),
    ("5", "Oklahoma City Thunder", "Oklahoma City", "Thunder", "OKC"), ("6", "Atlanta Hawks", "Atlanta", "Hawks", "ATL"),
    ("7", "Cleveland Cavaliers", "Cleveland", "Cavaliers", "CLE"), ("8", "Sacramento Kings", "Sacramento", "Kings", "SAC"),
    ("9", "Phoenix Suns", "Phoenix", "Suns", "PHX"), ("10", "Houston Rockets", "Houston", "Rockets", "HOU"),
    ("11", "Washington Wizards", "Washington", "Wizards", "WSH"), ("12", "New York Knicks", "New York", "Knicks", "NY"),
    ("13", "Utah Jazz", "Utah", "Jazz", "UTAH"), ("14", "Minnesota Timberwolves", "Minnesota", "Timberwolves", "MIN"),
]
NFL = [
    ("21", "Dallas Cowboys", "Dallas", "Cowboys", "DAL"), ("22", "Philadelphia Eagles", "Philadelphia", "Eagles", "PHI"),
    ("23", "Indianapolis Colts", "Indianapolis", "Colts", "IND"), ("24", "San Francisco 49ers", "San Francisco", "49ers", "SF"),
    ("25", "Los Angeles Chargers", "Los Angeles", "Chargers", "LAC"), ("26", "Los Angeles Rams", "Los Angeles", "Rams", "LAR"),
    ("27", "Denver Broncos", "Denver", "Broncos", "DEN"), ("28", "Minnesota Vikings", "Minnesota", "Vikings", "MIN"),
    ("29", "Las Vegas Raiders", "Las Vegas", "Raiders", "LV"), ("30", "New York Giants", "New York", "Giants", "NYG"),
    ("31", "Detroit Lions", "Detroit", "Lions", "DET"), ("32", "Green Bay Packers", "Green Bay", "Packers", "GB"),
    ("33", "Miami Dolphins", "Miami", "Dolphins", "MIA"), ("34", "Kansas City Chiefs", "Kansas City", "Chiefs", "KC"),
]
tl = lambda rows: [{"id": i, "name": n, "location": l, "nickname": k, "abbr": a} for i, n, l, k, a in rows]


def run(lg, rows, teams):
    by = {t["abbr"]: t for t in tl(teams)}
    return M.events(lg, [{"date": d, "team": by[ab], "text": tx} for d, ab, tx in rows], tl(teams))


def names(evs, kind=None, team=None):
    return [e["player"]["name"] for e in evs if e.get("player") and (kind is None or e["kind"] == kind) and (team is None or e["team"]["abbr"] == team)]


def test_sentences_split_at_the_right_full_stops():
    assert M.sentences("Waived F AK Okereke. Signed C Lawson Lovering to a two-way contract.") == ["Waived F AK Okereke.", "Signed C Lawson Lovering to a two-way contract."]
    assert M.sentences("Waived Gs. Jarkel Joiner and Latrell Wrightsell.") == ["Waived Gs. Jarkel Joiner and Latrell Wrightsell."]
    assert M.sentences("Signed G Kevin McCullar Jr. to a two-way contract.") == ["Signed G Kevin McCullar Jr. to a two-way contract."]
    assert M.sentences("Terminated the contract of WR Odell Beckham Jr. Released G C.J. Hanson.") == ["Terminated the contract of WR Odell Beckham Jr.", "Released G C.J. Hanson."]
    assert M.sentences("Elevated RB Nate Carter and C Pete Nygra from the practice squad..") == ["Elevated RB Nate Carter and C Pete Nygra from the practice squad."]


def test_the_names_the_review_found_broken():
    evs = run("nba", [("2026-10-28", "LAL", "Waived F AK Okereke. Signed C Lawson Lovering to a two-way contract."),
                      ("2026-11-15", "CLE", "Guaranteed SG Mario Hezonja's full contract salary.")], TEAMS)
    assert names(evs, "waive") == ["AK Okereke"]
    assert names(evs, "two_way") == ["Lawson Lovering"]
    assert names(evs, "guarantee") == ["Mario Hezonja"]
    nfl = run("nfl", [("2026-11-21", "SF", "Waived WR Brandon Cooks. Activated DT CJ West off injured reserve."),
                      ("2026-11-20", "IND", "Released QB Daniel Jones. Released LS Jacob Bobenmoyer. Waived QB Daniel Jones.")], NFL)
    assert names(nfl, "waive", "SF") == ["Brandon Cooks"] and names(nfl, "activate") == ["CJ West"]
    # released and then waived the same day is one move, with the second sentence kept beside it
    assert sorted(names(nfl, team="IND")) == ["Daniel Jones", "Jacob Bobenmoyer"]
    dj = next(e for e in nfl if e["player"]["name"] == "Daniel Jones")
    assert dj["kind"] == "release" and dj["also"] == ["Waived QB Daniel Jones."]
    for e in evs + nfl:
        assert "." not in e["player"]["name"].replace("Jr.", "").replace("C.J.", "") and "'s" not in e["player"]["name"]


def test_every_player_in_a_list_is_its_own_move():
    evs = run("nba", [("2026-10-17", "WSH", "Waived Gs Nolan Hickman, Trevor Keels, Alondes Williams and F Chris Livington.")], TEAMS)
    assert [(e["player"]["pos"], e["player"]["name"]) for e in evs] == [("G", "Nolan Hickman"), ("G", "Trevor Keels"), ("G", "Alondes Williams"), ("F", "Chris Livington")]
    assert len({e["id"] for e in evs}) == 4 and all(e["text"].startswith("Waived Gs") for e in evs)


def test_injured_reserve_is_not_a_signing_and_internal_moves_have_no_destination():
    nfl = run("nfl", [("2026-11-21", "DET", "Placed C Cade Mays on injured reserve. Signed DB Nick Whiteside to the active roster. Elevated LB Owen Pappoe from the practice squad."),
                      ("2026-11-18", "MIA", "Signed DE Max Llewellyn from the practice squad to the active roster. Signed P Jack Browning to the practice squad."),
                      ("2026-11-19", "LAR", "Placed WR Puka Nacua on the reserve/suspended list."),
                      ("2026-11-19", "IND", "Designated LB Swayze Bozeman to return from injured reserve.")], NFL)
    kinds = {e["player"]["name"]: e["kind"] for e in nfl}
    assert kinds == {"Cade Mays": "ir", "Nick Whiteside": "sign", "Owen Pappoe": "elevate", "Max Llewellyn": "promote", "Jack Browning": "ps_sign",
                     "Puka Nacua": "suspend", "Swayze Bozeman": "return_ir"}
    for e in nfl:
        if not M.KINDS[e["kind"]][2]:
            assert e["other"] is None


def test_other_teams_only_when_the_sentence_names_them():
    nfl = run("nfl", [("2026-11-18", "PHI", "Claimed T Ajani Cornelius off waivers from Dallas."),
                      ("2026-11-16", "NYG", "Signed WR Xavier Gipson from Philadelphia's practice squad and DB Tavierre Thomas from Minnesota's practice squad to the active roster.")], NFL)
    other = {e["player"]["name"]: (e["other"] or {}).get("name") for e in nfl}
    assert other == {"Ajani Cornelius": "Dallas Cowboys", "Xavier Gipson": "Philadelphia Eagles", "Tavierre Thomas": "Minnesota Vikings"}
    for e in nfl:
        assert e["other"]["id"] != e["team"]["id"]


def test_trades_both_sides_one_move():
    evs = run("nba", [("2026-09-27", "CHA", "Acquired G Rob Dillingham from Chicago Bulls for G Buddy Hield."),
                      ("2026-09-27", "CHI", "Acquired G Buddy Hield from Charlotte in exchange for G Rob Dillingham.")], TEAMS)
    trades = [e for e in evs if e["kind"] == "trade"]
    assert len(trades) == 1
    t = trades[0]
    assert [p["name"] for p in t["players_in"]] == ["Rob Dillingham"] and [p["name"] for p in t["players_out"]] == ["Buddy Hield"]
    assert t["other"]["name"] == "Chicago Bulls" and t["side"]["team"]["abbr"] == "CHI"


def test_three_team_trade_and_picks():
    evs = run("nba", [("2026-07-19", "ATL", "Acquired G Ryan Nembhard from Dallas and G Luguentz Dort from Oklahoma City in a three-team trade that sent F Zaccharie Risacher to Dallas. "
                                            "Dallas received draft consideration from Atlanta, while Oklahoma City received draft considerations from Atlanta and Dallas.")], TEAMS)
    assert len(evs) == 1
    t = evs[0]
    assert [p["name"] for p in t["players_in"]] == ["Ryan Nembhard", "Luguentz Dort"] and [p["name"] for p in t["players_out"]] == ["Zaccharie Risacher"]
    assert [o["abbr"] for o in t["others"]] == ["DAL", "OKC"] and t["three_team"]
    assert t["notes"] and t["notes"][0].startswith("Dallas received")
    nfl = run("nfl", [("2026-11-10", "DEN", "Acquired LB Daiyan Henley from the Los Angeles Chargers for a 2027 fourth-round draft pick and a 2028 fifth-round draft pick. Waived DB Sean Fresch.")], NFL)
    t = next(e for e in nfl if e["kind"] == "trade")
    assert t["other"]["abbr"] == "LAC" and [p["name"] for p in t["players_in"]] == ["Daiyan Henley"] and len(t["assets_out"]) == 2 and not t["players_out"]
    assert names(nfl, "waive") == ["Sean Fresch"]


def test_contract_words_and_conversions():
    evs = run("nba", [("2026-10-19", "PHX", "Signed F Oso Ighodaro to a multiyear contract extension. Claimed F Drew Timme off waivers. Converted C Duop Reath's contract to a two-way contract. Waived F CJ Huntley and G Koby Brea."),
                      ("2026-11-01", "CHA", "Exercised the third-year team options on Fs Kon Knueppel and Liam McNeeley."),
                      ("2026-10-17", "UTAH", "Converted the contract of F Harrison Ingram to a twpo-way contract.")], TEAMS)
    k = {e["player"]["name"]: (e["kind"], e["contract"]) for e in evs}
    assert k["Oso Ighodaro"] == ("extension", "Multiyear contract extension")
    assert k["Drew Timme"][0] == "claim" and k["Duop Reath"] == ("convert", "Two-way contract") and k["Harrison Ingram"] == ("convert", "Two-way contract")
    assert k["Kon Knueppel"][0] == k["Liam McNeeley"][0] == "option"
    assert k["CJ Huntley"][0] == k["Koby Brea"][0] == "waive"


def test_repeats_across_a_day_are_dropped_but_not_weeks_apart():
    nfl = run("nfl", [("2026-11-19", "GB", "Waived RB Pierre Strong Jr."), ("2026-11-20", "GB", "Waived RB Pierre Strong.")], NFL)
    assert len(nfl) == 1 and nfl[0]["player"]["name"] == "Pierre Strong Jr."
    nba = run("nba", [("2026-11-05", "CLE", "Waived F Riley Minix."), ("2026-11-18", "CLE", "Waived F Riley Minix.")], TEAMS)
    assert len(nba) == 2


def test_a_sentence_with_no_readable_player_is_kept_with_low_confidence():
    evs = run("nba", [("2026-08-20", "WSH", "Received draft considerations from LA Clippers.")], TEAMS)
    assert len(evs) == 1 and evs[0]["player"] is None and evs[0]["sentence"].startswith("Received")



def test_contract_terms_only_what_the_sentence_says():
    t = M.contract_terms
    assert t("Signed G Kevin Porter Jr. to a 10-day contract.")["summary"] == "10-day contract"
    assert t("Signed F A Smith to a rest-of-season contract.")["length"] == "rest-of-season"
    assert t("Signed G A Smith to a contract for the rest of the season.")["summary"] == "Rest-of-season contract"
    two = t("Signed QB Joe Flacco to a two-year, $10 million contract.")
    assert two == {"summary": "Two-year contract, $10 million", "length": "two-year", "money": "$10 million", "type": "", "text": "two-year, $10 million contract"}
    assert t("Signed G A Smith to a 3-year, $4.5M contract.")["summary"] == "Three-year contract, $4.5 million"
    assert t("Agreed to terms with WR A Smith on a one-year deal.")["summary"] == "One-year contract"
    assert t("Signed F Oso Ighodaro to a multiyear contract extension.")["summary"] == "Multiyear contract extension"
    assert t("Signed QB A Smith to a four-year contract extension worth $120 million.")["money"] == "$120 million"
    assert t("Converted C Duop Reath's contract to a two-way contract.")["type"] == "two-way"
    assert t("Converted the contract of F Harrison Ingram to a twpo-way contract.")["summary"] == "Two-way contract"
    assert t("Seattle Mariners signed free agent RHP John Doe to a minor league contract.")["summary"] == "Minor league contract"
    assert t("Signed RB A Smith to a reserve/future contract.")["summary"] == "Reserve/future contract"
    # nothing stated, nothing returned: no placeholder, and an injured list is not a contract
    for s in ("Signed WR A Smith to a contract.", "Signed DB Nick Whiteside to the active roster.", "Placed RHP A Smith on the 10-day injured list.",
              "Exercised the third-year team options on Fs Kon Knueppel and Liam McNeeley.", "Waived F AK Okereke."):
        assert t(s) == {}, s


def test_events_carry_terms_to_the_page():
    evs = run("nba", [("2026-11-02", "NY", "Signed G Malcolm Brogdon to a 10-day contract. Waived F Pacome Dadiet.")], TEAMS)
    pub = {e["player"]["name"]: M.public(e) for e in evs}
    assert pub["Malcolm Brogdon"]["terms"]["summary"] == "10-day contract" and "terms" not in pub["Pacome Dadiet"]


def test_activated_and_claimed_are_their_own_kinds():
    nfl = run("nfl", [("2026-11-21", "DEN", "Activated S P.J. Locke off injured reserve. Claimed S Devon Key off waivers from Minnesota. Activated LB Justin Strnad from the practice squad.")], NFL)
    k = {e["player"]["name"]: e["kind"] for e in nfl}
    assert k == {"P.J. Locke": "activate", "Devon Key": "claim", "Justin Strnad": "promote"}
    assert next(e for e in nfl if e["kind"] == "claim")["other"]["abbr"] == "MIN"

if __name__ == "__main__":
    fails = 0
    for n, f in list(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print("ok  ", n)
            except AssertionError as e:
                fails += 1; print("FAIL", n, e)
    sys.exit(1 if fails else 0)
