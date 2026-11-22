"""What happened to a player in the game a pick was graded on, from ESPN's game summary: minutes against his usual
minutes, which quarters he played, his numbers half by half, whether he left hurt (and if he came back), and why he
didn't play. Used by pick_grade.py to explain every miss and every DNP. Facts only: if ESPN doesn't say it, it
isn't said.

    NBA: box score minutes and DNP reasons, play-by-play (every play names its players by id: points, rebounds,
         assists and threes per quarter, the last quarter and clock he was seen), the injury report, the recap.
    NFL: box score, play-by-play text ("LAC-D.Jackson was injured during the play", "has returned to the game";
         catches, receiving and rushing yards per quarter), the injury report, the recap.
"""
import re

import discord_bot as B
import pick_parse as P

INJURY_WORDS = re.compile(r"injur|left the game|did not return|didn.t return|exited|hurt|sprain|strain|ankle|knee|hamstring|"
                          r"groin|calf|concussion|foot|back spasms|shoulder|wrist|hip|illness|ejected|limped|helped off|carted",
                          re.I)
ORD = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}


def period_name(n, sport):
    if n > 4:
        return "overtime" if n == 5 else f"{n - 4}OT"
    return f"{ORD[n]} quarter"


def last_name(name):
    """"Chris Godwin Jr." -> "Godwin"."""
    words = [w for w in P.fold(name).split() if not re.fullmatch(r"(jr|sr|ii|iii|iv|v)\.?", w, re.I)]
    return words[-1] if words else ""


def recap_lines(summary, name):
    """Sentences of ESPN's game story that mention the player and an injury, an exit or an ejection."""
    story = re.sub(r"<[^>]+>", " ", ((summary.get("article") or {}).get("story") or ""))
    last = last_name(name)
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", story)):
        if re.search(rf"\b{re.escape(last)}\b", P.fold(sent), re.I) and INJURY_WORDS.search(sent):
            out.append(sent.strip()[:180])
    return out[:2]


def injury_status(summary, aid, name):
    """The injury report after the game: "Day-To-Day (ankle)", or None."""
    for team in summary.get("injuries") or []:
        for x in team.get("injuries") or []:
            a = x.get("athlete") or {}
            if str(a.get("id")) == str(aid) or B.norm(a.get("displayName") or "") == B.norm(name):
                d = x.get("details") or {}
                what = " ".join(v for v in (d.get("side") if d.get("side") not in (None, "Not Specified") else None, d.get("type"),
                                             d.get("detail") if d.get("detail") not in (None, "Not Specified") else None) if v)
                return f"{x.get('status') or 'listed'}" + (f" ({what.lower()})" if what else "")
    return None


def box_row(summary, aid, name):
    """The player's box score row: {"min", "starter", "dnp", "reason", "team", "stats": {key: value}} or None."""
    for team in (summary.get("boxscore") or {}).get("players") or []:
        for cat in team.get("statistics") or []:
            keys = cat.get("keys") or []
            for a in cat.get("athletes") or []:
                ath = a.get("athlete") or {}
                if str(ath.get("id")) == str(aid) or B.norm(ath.get("displayName") or "") == B.norm(name):
                    stats = dict(zip(keys, a.get("stats") or []))
                    return {"min": B.num(stats.get("minutes")), "starter": a.get("starter"), "dnp": a.get("didNotPlay"),
                            "reason": a.get("reason") or "", "ejected": a.get("ejected"), "team": (team.get("team") or {}).get("abbreviation"),
                            "stats": stats}
    return None


# ---------- NBA ----------
def nba_periods(plays, aid):
    """{period: {"pts", "reb", "ast", "3pm", "seen"}} from the play-by-play, and where he was last seen."""
    per, last = {}, None
    aid = str(aid)
    for p in plays:
        ids = [str((x.get("athlete") or {}).get("id")) for x in p.get("participants") or []]
        if aid not in ids:
            continue
        n = (p.get("period") or {}).get("number") or 0
        d = per.setdefault(n, {"pts": 0, "reb": 0, "ast": 0, "3pm": 0, "seen": 0})
        d["seen"] += 1
        text = p.get("text") or ""
        typ = ((p.get("type") or {}).get("text") or "").lower()
        sub_out = "substitution" in typ and len(ids) > 1 and ids[1] == aid
        if not sub_out:
            last = (n, (p.get("clock") or {}).get("displayValue") or "")
        else:
            last = (n, (p.get("clock") or {}).get("displayValue") or "", "out")
        if p.get("scoringPlay") and ids[0] == aid:
            d["pts"] += p.get("scoreValue") or 0
            if (p.get("scoreValue") or 0) == 3:
                d["3pm"] += 1
        elif p.get("scoringPlay") and len(ids) > 1 and ids[1] == aid and "assist" in text.lower():
            d["ast"] += 1
        if "rebound" in typ and ids[0] == aid:
            d["reb"] += 1
    return per, last


NBA_PARTS = {"pts": ["pts"], "reb": ["reb"], "ast": ["ast"], "3pm": ["3pm"], "pra": ["pts", "reb", "ast"], "pr": ["pts", "reb"],
             "pa": ["pts", "ast"], "ra": ["reb", "ast"]}


def nba_story(summary, aid, name, g, value, usual_min):
    notes, flags = [], set()
    row = box_row(summary, aid, name)
    plays = summary.get("plays") or []
    last_period = max([(p.get("period") or {}).get("number") or 0 for p in plays] or [4])
    if row and (row["dnp"] or not row["min"]):
        reason = (row["reason"] or "").strip()
        notes.append("didn't play" + (f": {reason.lower()}" if reason else ""))
        flags.add("dnp")
        if reason and reason.upper() not in ("COACH'S DECISION", "DND", "NWT"):
            flags.add("injury")
        return notes, flags
    per, last = nba_periods(plays, aid)
    mins = row["min"] if row else None
    if mins is not None:
        usual = f" (usually {round(usual_min)})" if usual_min else ""
        notes.append(f"played {round(mins)} min{usual}")
    if per:
        played = sorted(n for n in per if n)
        gone_early = last and last[0] < min(last_period, 4) and (len(last) == 3 or last[0] < last_period)
        short = mins is not None and usual_min and mins < 0.7 * usual_min
        if gone_early and (short or last[0] <= 2):
            notes.append(f"⚠️ not seen after the {period_name(last[0], 'nba')} ({last[1]} left)")
            flags.add("left")
        elif short:
            notes.append(f"⚠️ fewer minutes than usual")
            flags.add("short")
        elif len(played) >= min(last_period, 4):
            notes.append(f"on the floor in all {min(last_period, 4)} quarters")
        parts = NBA_PARTS.get(g.get("stat"))
        if parts:
            box = row["stats"] if row else {}
            sums = {k: sum(per[n][k] for n in per) for k in ("pts", "reb", "ast", "3pm")}
            check = {"pts": B.num(box.get("points")), "reb": B.num(box.get("rebounds")), "ast": B.num(box.get("assists")),
                     "3pm": B.num(str(box.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted", "")).split("-")[0] or None)}
            if all(check.get(k) is None or sums[k] == check[k] for k in parts):
                h1 = sum(per[n][k] for n in per if n <= 2 for k in parts)
                h2 = sum(per[n][k] for n in per if n >= 3 for k in parts)
                notes.append(f"{h1} in the 1st half, {h2} in the 2nd")
    for line in recap_lines(summary, name):
        notes.append(f"recap: \"{line}\"")
        flags.add("injury" if re.search(r"injur|sprain|strain|ankle|knee|hamstring|concussion|did not return|didn.t return|left the game", line, re.I) else "recap")
    st = injury_status(summary, aid, name)
    if st:
        notes.append(f"injury report: {st}")
        flags.add("injury")
    if row and row.get("ejected"):
        notes.append("ejected")
        flags.add("left")
    return notes, flags


# ---------- NFL ----------
def nfl_abbr(name):
    """"Amon-Ra St. Brown" -> "A.St. Brown", "Chris Godwin Jr." -> "C.Godwin": how ESPN's play-by-play names him."""
    parts = [w for w in P.fold(name).replace(".", ". ").split() if not re.fullmatch(r"(jr|sr|ii|iii|iv|v)\.?", w, re.I)]
    if len(parts) < 2:
        return None
    first, rest = parts[0], " ".join(parts[1:]).replace(". ", ".").replace(" .", ".")
    rest = re.sub(r"\bSt\.(?=\S)", "St. ", rest)
    return f"{first[0]}.{rest}"


def nfl_plays(summary):
    out = []
    for d in (summary.get("drives") or {}).get("previous") or []:
        out += d.get("plays") or []
    return out


def nfl_story(summary, aid, name, g, value):
    notes, flags = [], set()
    ab = nfl_abbr(name)
    plays = nfl_plays(summary)
    row = box_row(summary, aid, name)
    if not ab or not plays:
        return notes, flags
    pat = re.compile(rf"(?<![A-Za-z.]){re.escape(ab)}\b")
    seen, hurt, back = {}, None, None
    rec = {}
    for p in plays:
        text = P.fold(p.get("text") or "")
        if not pat.search(text):
            continue
        n = (p.get("period") or {}).get("number") or 0
        clock = (p.get("clock") or {}).get("displayValue") or ""
        seen[n] = seen.get(n, 0) + 1
        if re.search(rf"{re.escape(ab)}\s+was injured", text):
            hurt = (n, clock)
        if re.search(rf"{re.escape(ab)}\s+has returned", text):
            back = (n, clock)
        if re.search(r"no play|nullified", text, re.I):
            continue
        d = rec.setdefault(n, {"rec": 0, "reyd": 0, "ryd": 0})
        m = re.search(rf"pass(?: \w+){{0,3}} to {re.escape(ab)}\b[^.]*?(?:for (-?\d+) yards?|for no gain)", text)
        if m and "incomplete" not in text[:m.start() + 40].lower():
            d["rec"] += 1
            d["reyd"] += int(m[1] or 0)
        m = re.search(rf"(?:^|\.\s+|\)\s+){re.escape(ab)} (?:left|right|up|scrambles|kneels|middle)[^.]*?(?:for (-?\d+) yards?|for no gain)", text)
        if m:
            d["ryd"] += int(m[1] or 0)
    if hurt:
        when = f"{period_name(hurt[0], 'nfl')}, {hurt[1]}"
        if back:
            notes.append(f"⚠️ hurt in the {when}, came back in the {period_name(back[0], 'nfl')}")
            flags.add("injury")
        else:
            notes.append(f"🚑 hurt in the {when} and didn't come back")
            flags.update({"injury", "left"})
    if seen:
        last = max(seen)
        if not hurt and last <= 2 and max((p.get("period") or {}).get("number") or 0 for p in plays) >= 4:
            notes.append(f"⚠️ not in a play after the {period_name(last, 'nfl')}")
            flags.add("left")
    key = g.get("stat")
    parts = {"rec": ["rec"], "reyd": ["reyd"], "ryd": ["ryd"], "rryd": ["reyd", "ryd"]}.get(key)
    if parts and rec:
        total = sum(rec[n][k] for n in rec for k in parts)
        if value is not None and total == value:
            h1 = sum(rec[n][k] for n in rec if n <= 2 for k in parts)
            notes.append(f"{h1} in the 1st half, {total - h1} in the 2nd")
    for line in recap_lines(summary, name):
        notes.append(f"recap: \"{line}\"")
        flags.add("injury" if INJURY_WORDS.search(line) else "recap")
    st = injury_status(summary, aid, name)
    if st:
        notes.append(f"injury report: {st}")
        flags.add("injury")
    return notes, flags


def miss_by(g, value):
    """"missed by 1" / "1 too many": how far a lost prop was from hitting."""
    if value is None:
        return None
    import math
    line = g["line"]
    if g["side"] == "over":
        gap = math.floor(line) + 1 - value
        return f"{B.fmt(gap)} short" if gap > 0 else None
    gap = value - (math.ceil(line) - 1)
    return f"{B.fmt(gap)} too many" if gap > 0 else None


def story(sport, summary, aid, name, g, value, usual_min=None):
    """(notes, flags) about the player's game. flags: dnp, injury, left, short, recap."""
    if not summary:
        return [], set()
    try:
        if sport in ("nba", "wnba"):
            return nba_story(summary, aid, name, g, value, usual_min)
        if sport == "nfl":
            return nfl_story(summary, aid, name, g, value)
    except Exception as e:      # an odd summary never breaks the grading
        return [f"(couldn't read the play-by-play: {type(e).__name__})"], set()
    return [], set()
