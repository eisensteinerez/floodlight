"""A small fake ESPN for the grading tests: player search, game logs, team schedules and game summaries, shaped like
ESPN's real answers (the summary below is cut down from MEM @ MIN on Nov 21, 2026, LaMelo Ball's 12 points)."""
import datetime as dt

NBA_LABELS = ["MIN", "FG", "FG%", "3PT", "3P%", "FT", "FT%", "REB", "AST", "BLK", "STL", "PF", "TO", "PTS"]


def nba_row(mins, pts, reb, ast):
    return [str(mins), "5-10", "50.0", "1-4", "25.0", "1-2", "50.0", str(reb), str(ast), "1", "1", "2", "3", str(pts)]


def gamelog(games, labels=NBA_LABELS, cats=None):
    """games: [(event_id, iso date, team_id, opp_id, opp_name, row or None, result)]"""
    events, rows = {}, []
    for eid, date, tid, oid, oname, row, res in games:
        events[eid] = {"gameDate": date, "atVs": "vs", "homeTeamId": tid, "awayTeamId": oid, "gameResult": res,
                       "score": "104-95", "opponent": {"id": oid, "displayName": oname, "abbreviation": oname[:3].upper()}}
        if row is not None:
            rows.append({"eventId": eid, "stats": row})
    return {"labels": labels, "categories": cats or [], "events": events,
            "seasonTypes": [{"displayName": "2026-27 Regular Season", "categories": [{"events": rows}]}]}


def schedule(games):
    """games: [(event_id, iso date, completed, [team names])]"""
    return {"events": [{"id": eid, "date": date, "competitions": [{
        "status": {"type": {"completed": done, "state": "post" if done else "pre", "name": "STATUS_FINAL" if done else "STATUS_SCHEDULED"}},
        "competitors": [{"team": {"displayName": n, "shortDisplayName": n.split()[-1]}} for n in names]}]} for eid, date, done, names in games]}


def play(n, clock, text, ids, scoring=False, value=0, typ=""):
    return {"type": {"text": typ}, "text": text, "period": {"number": n}, "clock": {"displayValue": clock}, "scoringPlay": scoring,
            "scoreValue": value, "participants": [{"athlete": {"id": i}} for i in ids]}


BALL = "4432816"
# LaMelo Ball, MEM @ MIN, Nov 21 2026: 12 points (5 in the 2nd quarter, 7 in the 3rd), 32 minutes, all four quarters
BALL_SUMMARY = {
    "boxscore": {"players": [{"team": {"id": "16", "abbreviation": "MIN"}, "statistics": [{
        "keys": ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
                 "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks", "offensiveRebounds",
                 "defensiveRebounds", "fouls", "plusMinus"],
        "athletes": [{"athlete": {"id": BALL, "displayName": "LaMelo Ball"}, "starter": True, "didNotPlay": False,
                      "reason": "COACH'S DECISION", "stats": ["32", "12", "5-10", "1-4", "1-2", "5", "7", "3", "1", "1", "0", "5", "4", "+12"]}]}]}]},
    "plays": [
        play(1, "10:42", "LaMelo Ball misses 24-foot three point pullup jump shot", [BALL]),
        play(1, "4:39", "Terrence Shannon Jr. enters the game for LaMelo Ball", ["4432847", BALL], typ="Substitution"),
        play(2, "8:29", "LaMelo Ball enters the game for Trey Lyles", [BALL, "3136196"], typ="Substitution"),
        play(2, "7:54", "LaMelo Ball defensive rebound", [BALL], typ="Defensive Rebound"),
        play(2, "6:09", "LaMelo Ball makes 9-foot driving floating jump shot (Rudy Gobert assists)", [BALL, "3032976"], True, 2),
        play(2, "4:07", "LaMelo Ball makes 14-foot pullup jump shot", [BALL], True, 2),
        play(2, "45.9", "LaMelo Ball makes free throw 1 of 2", [BALL], True, 1),
        play(2, "3:54", "LaMelo Ball defensive rebound", [BALL], typ="Defensive Rebound"),
        play(2, "0.8", "LaMelo Ball defensive rebound", [BALL], typ="Defensive Rebound"),
        play(3, "10:04", "LaMelo Ball makes 12-foot pullup jump shot", [BALL], True, 2),
        play(3, "9:35", "LaMelo Ball makes 8-foot driving floating jump shot", [BALL], True, 2),
        play(3, "6:03", "LaMelo Ball makes 25-foot three pointer", [BALL], True, 3),
        play(3, "5:15", "LaMelo Ball defensive rebound", [BALL], typ="Defensive Rebound"),
        play(3, "4:12", "Bones Hyland enters the game for LaMelo Ball", ["4592492", BALL], typ="Substitution"),
        play(4, "7:58", "LaMelo Ball enters the game for Bones Hyland", [BALL, "4592492"], typ="Substitution"),
        play(4, "1:56", "Cedric Coward lost ball turnover (LaMelo Ball steals)", ["4903027", BALL]),
        play(4, "1.0", "LaMelo Ball defensive rebound", [BALL], typ="Defensive Rebound"),
        play(4, "0.0", "End of Game", [], typ="End Game"),
    ],
    "injuries": [],
    "article": {"story": "Jonathan Kuminga scored 16 points, Terrence Shannon Jr. added 15 and LaMelo Ball had 12 as Minnesota "
                         "shot a season-high 58% from the field."},
}

AVDIJA = "4683021"
# a made-up night: Avdija scores 6 in 14 minutes, last seen in the 2nd quarter, and the recap says he left hurt
AVDIJA_SUMMARY = {
    "boxscore": {"players": [{"team": {"id": "22", "abbreviation": "POR"}, "statistics": [{
        "keys": ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
                 "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists"],
        "athletes": [{"athlete": {"id": AVDIJA, "displayName": "Deni Avdija"}, "starter": True, "didNotPlay": False,
                      "reason": "", "stats": ["14", "6", "3-5", "0-1", "0-0", "2", "1"]}]}]}]},
    "plays": [
        play(1, "11:20", "Deni Avdija makes two point shot", [AVDIJA], True, 2),
        play(1, "6:02", "Deni Avdija makes driving layup", [AVDIJA], True, 2),
        play(2, "5:30", "Deni Avdija makes 10-foot jumper", [AVDIJA], True, 2),
        play(2, "3:12", "Deni Avdija defensive rebound", [AVDIJA], typ="Defensive Rebound"),
        play(4, "0.0", "End of Game", [], typ="End Game"),
    ],
    "injuries": [{"injuries": [{"athlete": {"id": AVDIJA, "displayName": "Deni Avdija"}, "status": "Day-To-Day",
                                "details": {"type": "Ankle", "side": "Left", "detail": "Sprain"}}]}],
    "article": {"story": "Portland lost Deni Avdija to a sprained left ankle late in the second quarter. Avdija did not return."},
}

MORANT = "4279888"
MORANT_SUMMARY = {"boxscore": {"players": [{"team": {"id": "22", "abbreviation": "POR"}, "statistics": [{
    "keys": ["minutes", "points"], "athletes": [{"athlete": {"id": MORANT, "displayName": "Ja Morant"}, "starter": False,
                                                 "didNotPlay": True, "reason": "LEFT HAMSTRING", "stats": []}]}]}]},
    "plays": [], "injuries": []}

GODWIN = "3116165"
# NFL: Sunday Nov 22. Godwin is hurt in the 2nd quarter with 3 catches for 31 yards, and doesn't come back.
NFL_LABELS = ["REC", "TGTS", "YDS", "AVG", "TD", "LNG", "CAR", "YDS", "AVG", "TD", "LNG", "FUM", "LST"]
NFL_CATS = [{"name": "receiving", "count": 6}, {"name": "rushing", "count": 5}, {"name": "fumbles", "count": 2}]
GODWIN_SUMMARY = {
    "boxscore": {"players": []},
    "drives": {"previous": [{"plays": [
        {"text": "(Shotgun) B.Mayfield pass short right to C.Godwin to TB 35 for 12 yards (B.Branch).", "period": {"number": 1}, "clock": {"displayValue": "9:10"}},
        {"text": "B.Mayfield pass short middle to C.Godwin to DET 40 for 11 yards (A.Anzalone).", "period": {"number": 1}, "clock": {"displayValue": "4:02"}},
        {"text": "B.Mayfield pass deep left to C.Godwin to DET 32 for 8 yards (K.Joseph). TB-C.Godwin was injured during the play.",
         "period": {"number": 2}, "clock": {"displayValue": "6:40"}},
        {"text": "B.Mayfield pass incomplete short left to E.Egbuka.", "period": {"number": 4}, "clock": {"displayValue": "2:00"}},
    ]}]},
    "injuries": [],
    "article": {"story": "Tampa Bay lost Chris Godwin to a knee injury in the second quarter."},
}

SAT, SUN = "2026-11-21T00:30:00Z", "2026-11-22T00:30:00Z"


def fetch(url, ttl, as_json=True):
    if "/search?" in url:
        q = url.split("query=")[1].split("&")[0].lower()
        if "warren" in q:
            return {"items": [{"id": "1", "displayName": "Jaylen Warren", "league": "nfl"},
                              {"id": "2", "displayName": "Zavier Warren", "league": "nfl"}]}
        known = {"lamelo": (BALL, "LaMelo Ball", "nba"), "avdija": (AVDIJA, "Deni Avdija", "nba"), "morant": (MORANT, "Ja Morant", "nba"),
                 "godwin": (GODWIN, "Chris Godwin Jr.", "nfl"), "nobody": ("9", "Nobody Atall", "nba")}
        for k, (i, n, lg) in known.items():
            if k in q:
                return {"items": [{"id": i, "displayName": n, "league": lg}]}
        return {"items": []}
    if "/gamelog" in url:
        if f"/athletes/{BALL}/" in url:
            return gamelog([("E0", "2026-11-19T00:00:00Z", "16", "5", "Detroit Pistons", nba_row(33, 18, 4, 6), "W"),
                            ("E1", "2026-11-17T00:00:00Z", "16", "6", "Utah Jazz", nba_row(34, 22, 5, 9), "W"),
                            ("E2", "2026-11-15T00:00:00Z", "16", "7", "Phoenix Suns", nba_row(32, 17, 3, 8), "L"),
                            ("401910026", "2026-11-22T01:00:00Z", "16", "29", "Memphis Grizzlies", nba_row(32, 12, 5, 7), "W")])
        if f"/athletes/{AVDIJA}/" in url:
            return gamelog([("A1", "2026-11-19T00:00:00Z", "22", "5", "Detroit Pistons", nba_row(35, 25, 7, 5), "W"),
                            ("A2", "2026-11-17T00:00:00Z", "22", "6", "Utah Jazz", nba_row(36, 24, 6, 4), "W"),
                            ("A3", "2026-11-15T00:00:00Z", "22", "7", "Phoenix Suns", nba_row(34, 22, 8, 6), "L"),
                            ("401910024", "2026-11-22T00:30:00Z", "22", "18", "New York Knicks", nba_row(14, 6, 2, 1), "L")])
        if f"/athletes/{MORANT}/" in url:      # out with a hamstring: no line for the Knicks game
            return gamelog([("M1", "2026-11-12T00:00:00Z", "22", "5", "Detroit Pistons", nba_row(30, 20, 4, 7), "W")])
        if "/athletes/9/" in url:            # his team has no game that night
            return gamelog([("N1", "2026-11-12T00:00:00Z", "30", "5", "Detroit Pistons", nba_row(20, 8, 2, 1), "W")])
        if f"/athletes/{GODWIN}/" in url:
            row = ["3", "5", "31", "10.3", "0", "12", "0", "0", "0", "0", "0", "0", "0"]
            return gamelog([("G1", "2026-11-16T18:00:00Z", "27", "1", "Atlanta Falcons", ["5", "7", "60", "12", "0", "20", "0", "0", "0", "0", "0", "0", "0"], "W"),
                            ("401873072", "2026-11-22T18:00:00Z", "27", "8", "Detroit Lions", row, "L")], NFL_LABELS, NFL_CATS)
        if "/athletes/1/" in url:
            return gamelog([("401873050", "2026-11-22T18:00:00Z", "23", "21", "Philadelphia Eagles",
                             ["2", "3", "15", "7", "0", "9", "12", "48", "4", "0", "11", "0", "0"], "W")], NFL_LABELS, NFL_CATS)
        if "/athletes/2/" in url:
            return gamelog([("401873060", "2026-11-22T18:00:00Z", "11", "12", "Chiefs",
                             ["1", "1", "4", "4", "0", "4", "0", "0", "0", "0", "0", "0", "0"], "W")], NFL_LABELS, NFL_CATS)
        return {}
    if "/schedule" in url:
        if "/teams/16/" in url:
            return schedule([("401910026", "2026-11-22T01:00:00Z", True, ["Minnesota Timberwolves", "Memphis Grizzlies"])])
        if "/teams/22/" in url:
            return schedule([("401910024", "2026-11-22T00:30:00Z", True, ["New York Knicks", "Portland Trail Blazers"])])
        if "/teams/30/" in url:
            return schedule([("X9", "2026-11-25T00:30:00Z", False, ["Charlotte Hornets", "Miami Heat"])])
        if "/teams/27/" in url:
            return schedule([("401873072", "2026-11-22T18:00:00Z", True, ["Detroit Lions", "Tampa Bay Buccaneers"])])
        if "/teams/23/" in url:
            return schedule([("401873050", "2026-11-22T18:00:00Z", True, ["Pittsburgh Steelers", "Philadelphia Eagles"])])
        if "/teams/11/" in url:
            return schedule([("401873060", "2026-11-22T18:00:00Z", True, ["Kansas City Chiefs", "Indianapolis Colts"])])
        return {"events": []}
    if "/summary?event=401910026" in url:
        return BALL_SUMMARY
    if "/summary?event=401910024" in url:
        return {**AVDIJA_SUMMARY, "boxscore": {"players": AVDIJA_SUMMARY["boxscore"]["players"] + MORANT_SUMMARY["boxscore"]["players"]}}
    if "/summary?event=401873072" in url:
        return GODWIN_SUMMARY
    if "football/nfl/scoreboard" in url and "dates=20261122" in url:
        return {"events": [{"id": "401873090", "date": "2026-11-22T18:00:00Z", "competitions": [{
            "status": {"type": {"state": "post", "completed": True, "name": "STATUS_FINAL"}},
            "competitors": [
                {"homeAway": "home", "score": "24", "linescores": [{"value": 10}, {"value": 7}, {"value": 0}, {"value": 7}],
                 "team": {"displayName": "Chicago Bears", "shortDisplayName": "Bears", "abbreviation": "CHI"}},
                {"homeAway": "away", "score": "13", "linescores": [{"value": 3}, {"value": 3}, {"value": 7}, {"value": 0}],
                 "team": {"displayName": "New Orleans Saints", "shortDisplayName": "Saints", "abbreviation": "NO"}}]}]}]}
    return {}


def now_after_weekend():
    return dt.datetime(2026, 11, 23, 13, 0, tzinfo=dt.timezone.utc)
