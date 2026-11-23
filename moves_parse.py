"""Reading ESPN's transaction sentences into one event per player per action.

ESPN's NBA and NFL transaction lists give a team and a paragraph such as
  "Placed C Cade Mays on injured reserve. Signed DB Nick Whiteside to the active roster.
   Elevated LB Owen Pappoe from the practice squad."
The old reader took the paragraph as one move, so a list of three players became one row under the first, an injured
reserve placement next to a signing became a signing, and a split in the wrong place made names like
"AK Okereke. Signed". This module:
  - splits the paragraph into sentences (without breaking on "Jr.", "D.J.", "Gs." and the like),
  - reads each sentence's action from its verb and wording (signing, practice squad, injured reserve, activation,
    elevation, waiver, release, claim, trade, extension, conversion, option, guarantee),
  - lists every player the sentence names, each with the position written before it,
  - finds the other team only when the sentence names it, and never gives an internal roster move a destination,
  - checks each name before using it (two to five name words, no verbs or contract words, no possessive),
  - keeps the paragraph and the sentence as written, so the page can always show the source,
  - drops repeats: the same player, team and kind of move within a day (ESPN sometimes lists one waiver twice).
Nothing is invented: a sentence the reader cannot place is kept as a "Roster move" with its text and low confidence.
"""
import re
import unicodedata

VERBS = ("signed", "re-signed", "resigned", "waived", "released", "placed", "activated", "elevated", "acquired", "claimed",
         "converted", "designated", "reinstated", "traded", "exercised", "declined", "guaranteed", "received", "terminated",
         "agreed", "recalled", "assigned", "suspended", "promoted", "removed", "restored", "transferred", "sent", "named",
         "hired", "fired", "extended", "re-signed")
ABBR = {"jr", "sr", "st", "gs", "fs", "cs", "dr", "mt", "no", "vs", "lbs", "dbs", "wrs", "tes", "cbs", "qbs", "rbs", "ols", "dls", "des", "dts", "ts", "ss"}
POS = {"PG", "SG", "SF", "PF", "G", "F", "C", "GF", "FC", "QB", "RB", "FB", "WR", "TE", "OL", "OT", "T", "G", "OG", "DL", "DE", "DT", "NT",
       "EDGE", "LB", "OLB", "ILB", "MLB", "DB", "CB", "S", "FS", "SS", "K", "P", "LS", "KR", "PR", "ATH"}
POS_WORDS = {"guard": "G", "forward": "F", "center": "C", "quarterback": "QB", "receiver": "WR", "linebacker": "LB", "cornerback": "CB",
             "safety": "S", "kicker": "K", "punter": "P", "tight end": "TE", "running back": "RB"}
NOT_NAME = {"Signed", "Waived", "Released", "Placed", "Activated", "Elevated", "Acquired", "Claimed", "Converted", "Designated", "Reinstated",
            "Traded", "Exercised", "Guaranteed", "Received", "Terminated", "Contract", "Practice", "Squad", "Injured", "Reserve", "Active",
            "Roster", "Draft", "Round", "Pick", "Cash", "Considerations", "The", "From", "To", "And", "For", "With", "Team", "Option", "Options"}
SUFFIX = {"Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"}
NAME_WORD = re.compile(r"^(?:[A-Z][a-z]*\.(?:[A-Z]\.)*|[A-Z]\.(?:[A-Z]\.)+|[A-Z][A-Za-z'’\-]*[a-z][A-Za-z'’\-]*|[A-Z]{2}|Mc[A-Z][a-z]+|De|La|Le|Van|Von|Da|Di|St\.|II|III|IV|V|Jr\.?|Sr\.?)$")

# what each kind of move is called, which filter group it sits in, and whether the player changes team
KINDS = {
    "sign": ("Signing", "sign", True), "re_sign": ("Re-signed", "sign", False), "two_way": ("Two-way signing", "sign", True),
    "extension": ("Extension", "ext", False), "ps_sign": ("Practice squad signing", "ps", True), "promote": ("Promoted to the active roster", "ps", False),
    "elevate": ("Elevated for the game", "ps", False), "ps_release": ("Released from the practice squad", "waiver", True),
    "waive": ("Waived", "waiver", True), "release": ("Released", "waiver", True), "claim": ("Waiver claim", "sign", True),
    "ir": ("Injured reserve", "ir", False), "ps_ir": ("Practice squad injured list", "ir", False), "return_ir": ("Designated to return", "ir", False),
    "activate": ("Activated", "ir", False), "suspend": ("Suspended list", "ir", False), "pup": ("Physically unable to perform list", "ir", False),
    "trade": ("Trade", "trade", True), "convert": ("Contract converted", "other", False), "option": ("Option exercised", "other", False),
    "guarantee": ("Contract guaranteed", "other", False), "exemption": ("Practice exemption", "other", False), "other": ("Roster move", "other", False),
}
LEAVES = {"waive", "release", "ps_release"}   # one family when de-duplicating ("Released X" and "Waived X" on the same day)


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", " ", s.lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# ---------- sentences ----------
def sentences(text):
    """Split a paragraph at full stops that end a sentence, not at "Jr.", initials or "Gs."."""
    t = re.sub(r"\.{2,}", ".", re.sub(r"\s+", " ", str(text or "")).strip())
    out, start = [], 0
    for m in re.finditer(r"\.\s+(?=[A-Z])", t):
        before = t[start:m.start()]
        word = (re.findall(r"([A-Za-z'’\-]+|[A-Z])$", before) or [""])[0]
        nxt = (re.match(r"[A-Za-z\-]+", t[m.end():]) or [""])[0].lower()
        if nxt in VERBS or (len(word) > 1 and word.lower() not in ABBR and not re.fullmatch(r"(?:[A-Z]\.?)+", word)):
            out.append(t[start:m.start() + 1].strip()); start = m.end()
    if t[start:].strip():
        out.append(t[start:].strip())
    return [s for s in out if len(s) > 3]


# ---------- names ----------
def clean_name(words):
    """A name, or None when the words do not look like one."""
    ws = [w.strip(",;:") for w in words if w.strip(",;:")]
    while ws and ws[-1].endswith((".", "'", "’")) and ws[-1] not in SUFFIX and not re.fullmatch(r"(?:[A-Z]\.)+", ws[-1]):
        ws[-1] = ws[-1].rstrip(".'’")
    if ws and re.search(r"['’]s$", ws[-1]):
        ws[-1] = re.sub(r"['’]s$", "", ws[-1])
    if not 2 <= len(ws) <= 5 or any(w in NOT_NAME for w in ws) or not all(NAME_WORD.match(w) for w in ws):
        return None
    if ws[0] in SUFFIX or not re.match(r"[A-Z]", ws[0]):
        return None
    if ws[-1] in ("Jr", "Sr"):
        ws[-1] += "."
    return " ".join(ws)


def players_in(span, with_from=False):
    """Every player in a list such as "Gs Nolan Hickman, Trevor Keels and F Chris Livington": [(pos, name)].
    With with_from, also the team each came from when the list says so ("X from Philadelphia's practice squad"): [(pos, name, team words)]."""
    span = re.sub(r"\b(?:the )?(?:contract|contracts) of\b", " ", span)
    for word, ab in POS_WORDS.items():
        span = re.sub(rf"\b{word}s?\b", ab, span, flags=re.I)
    span = re.sub(r"['’]s (?:full |rookie |two-way )?(?:contract|contracts|salary)\b.*$", "", span)
    out, pos = [], ""
    for chunk in re.split(r",\s*|\s+and\s+|\s*&\s*", span):
        came = re.search(r"\[\[(.+?)\]\]", chunk)
        chunk = re.sub(r"\s*\[\[.+?\]\]", "", chunk)
        words = chunk.split()
        while words and (words[0].rstrip(".s") in POS or words[0].rstrip(".") in POS or words[0].lower() in ("free-agent", "free", "agent", "rookie", "veteran")):
            w = words.pop(0)
            if w.lower() in ("free-agent", "free", "agent", "rookie", "veteran"):
                continue
            pos = w.rstrip(".")
            pos = pos[:-1] if pos.endswith("s") and pos[:-1] in POS else pos
        # stop at the first word that is not part of the name ("Kevin Porter Jr. to a contract")
        name_words = []
        for w in words:
            if w[:1].islower() and w not in ("van", "de", "da", "la", "le", "von", "di"):
                break
            name_words.append(w)
        n = clean_name(name_words)
        if n:
            out.append((pos, n, came.group(1) if came else "") if with_from else (pos, n))
    return out


# ---------- teams ----------
class Teams:
    """Find a team the sentence names, from the league's team list: full name, then city, then nickname."""

    def __init__(self, teams):
        self.teams = [t for t in teams or [] if t.get("name")]
        self.full = sorted(((norm(t["name"]), t) for t in self.teams), key=lambda x: -len(x[0]))
        city, nick = {}, {}
        for t in self.teams:
            for k, d in ((norm(t.get("location")), city), (norm(t.get("nickname")), nick), (norm(t.get("short")), nick)):
                if k:
                    d.setdefault(k, []).append(t)
        self.city = {k: v[0] for k, v in city.items() if len({x["id"] for x in v}) == 1}
        self.nick = {k: v[0] for k, v in nick.items() if len({x["id"] for x in v}) == 1}

    def find(self, text):
        k = " " + norm(text) + " "
        for n, t in self.full:
            if n and f" {n} " in k:
                return t
        for d in (self.nick, self.city):
            for n in sorted(d, key=len, reverse=True):
                if f" {n} " in k:
                    return d[n]
        return None


# ---------- one sentence ----------
CONTRACT = re.compile(r"\bto (?:a |an )?((?:[a-z0-9\-]+ ){0,4}?(?:contract extension|extension|contract|deal))\b", re.I)


def contract_of(s):
    m = CONTRACT.search(s)
    if not m:
        return ""
    c = re.sub(r"\btwpo\b", "two", m.group(1).lower())
    c = re.sub(r"\bcontrac\b", "contract", c)
    return c[0].upper() + c[1:] if c and c not in ("contract", "a contract") else ""


NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
WORD_NUM = {v: k for k, v in NUM_WORDS.items()}
DEAL = re.compile(r"\b(?:to|on|for) (?:a|an)\s+((?:[^.;]|(?<=\d)\.(?=\d))*?\b(?:contracts? extensions?|extensions?|contracts?|deals?))\b", re.I)
MONEY = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion)|[mMkK]\b)?")


def contract_terms(s):
    """What one sentence says about the contract, and nothing it does not: {"summary", "length", "money", "type", "text"}.
    Only the words of a contract phrase count ("to a two-year, $10 million contract", "on a one-year deal",
    "to a 10-day contract", "to a rest-of-season contract", "worth $120 million"), so "the 10-day injured list"
    is not a contract. An empty dict when the sentence says nothing about the deal."""
    s = re.sub(r"\btwpo\b", "two", str(s or ""), flags=re.I)
    m = DEAL.search(s)
    if not m:
        return {}
    phrase, low = m.group(1), m.group(1).lower()
    length = ""
    y = re.search(r"\b(\d{1,2}|" + "|".join(NUM_WORDS) + r")[- ]years?\b", low)
    d = re.search(r"\b(\d{1,2}|ten)[- ]day\b", low)
    if y:
        n = int(y.group(1)) if y.group(1).isdigit() else NUM_WORDS[y.group(1)]
        length = f"{WORD_NUM.get(n, n)}-year" if n > 0 else ""
    elif d:
        length = "10-day" if d.group(1) == "ten" else f"{int(d.group(1))}-day"
    elif re.search(r"rest[- ]of[- ](?:the[- ])?season", low) or re.search(r"\bfor the rest of the season\b", s, re.I):
        length = "rest-of-season"
    elif re.search(r"\bmulti-?year\b", low):
        length = "multiyear"
    kind = ("two-way" if re.search(r"\btwo[- ]way\b", low) else "Exhibit 10" if re.search(r"\bexhibit[- ]10\b", low)
            else "minor league" if re.search(r"\bminor[- ]league\b", low) else "reserve/future" if re.search(r"reserve/futures?", low)
            else "non-guaranteed" if re.search(r"\bnon-?guaranteed\b", low) else "")
    ext = bool(re.search(r"\bextension", low))
    money = MONEY.search(phrase) or re.search(r"\bworth (?:up to )?(" + MONEY.pattern + ")", s)
    money = (money.group(1) if money and money.re is not MONEY else money.group(0) if money else "").strip()
    money = re.sub(r"\s*([mM])$", " million", re.sub(r"\s*([kK])$", " thousand", money)) if money else ""
    if not (length or kind or ext or money):
        return {}
    noun = "contract extension" if ext else "contract"
    summary = " ".join(x for x in (length, kind, noun) if x)
    summary = summary[0].upper() + summary[1:]
    return {"summary": summary + (f", {money}" if money else ""), "length": length, "money": money, "type": kind or ("extension" if ext else ""), "text": phrase}


def classify(s):
    """(kind, the words that name the players, the words after them) for one sentence."""
    low = s.lower()
    verb = re.match(r"([A-Za-z\-]+)", s)
    v = verb.group(1).lower() if verb else ""
    rest = s[len(v):].strip()
    if v in ("signed", "re-signed", "resigned", "agreed"):
        rest = re.sub(r"^to terms with\s+", "", rest, flags=re.I)
        if "practice squad" in low and re.search(r"from (?:the |[A-Z][\w. ]+['’]s )?practice squad", s):
            other = re.search(r"from ([A-Z][\w. ]+?)['’]s practice squad", s)
            kind = "sign" if other else "promote"
        elif re.search(r"\bto the practice squad\b", low):
            kind = "ps_sign"
        elif "extension" in low:
            kind = "extension"
        elif v != "signed":
            kind = "re_sign"
        elif "two-way" in low or "two way" in low:
            kind = "two_way"
        else:
            kind = "sign"
    elif v == "waived":
        kind = "waive"
    elif v == "released" or v == "terminated":
        kind = "ps_release" if "from the practice squad" in low and "injured" not in low else "release"
        rest = re.sub(r"^the contract of\s+", "", rest, flags=re.I)
    elif v == "placed":
        kind = "ps_ir" if "practice squad injured" in low else "suspend" if "suspended" in low else "pup" if "physically unable" in low or "pup" in low else "ir" if "injured" in low or "reserve" in low else "other"
    elif v in ("activated", "reinstated", "restored"):
        kind = "promote" if "from the practice squad" in low and "injured" not in low else "activate"
    elif v == "designated":
        kind = "return_ir" if "return" in low else "release" if "assignment" in low else "other"
    elif v == "elevated":
        kind = "elevate"
    elif v == "claimed":
        kind = "claim"
    elif v in ("acquired", "traded", "received", "sent"):
        kind = "trade"
    elif v == "converted":
        kind = "convert"
        rest = re.sub(r"^the contract of\s+", "", rest, flags=re.I)
    elif v in ("exercised", "declined"):
        kind = "option"
        rest = re.split(r"\boptions? on\b", rest, maxsplit=1)[-1]
    elif v == "guaranteed":
        kind = "guarantee"
    elif v == "received" or "exemption" in low:
        kind = "exemption"
        rest = re.split(r"\bfor\b", rest, maxsplit=1)[-1]
    else:
        kind = "other"
    if "exemption" in low:
        kind, rest = "exemption", re.split(r"\bfor\b", rest, maxsplit=1)[-1]
    # the player list ends where the sentence turns to where they went or why
    stop = re.search(r"\s(?:to (?:a|an|the|two|his|their|return)\b|to two-way|from\b|off\b|on (?:the |injured|a )|for\b|in exchange\b|in a\b|with\b|pending\b|after\b|as\b|,? who\b|\()", " " + rest)
    names = rest[:stop.start() - 1] if stop else rest
    return kind, names.strip(" ."), rest[len(names):].strip()


def read(lg, row, teams):
    """Events from one ESPN row: {date, text, team}. One event per player per sentence; trades one per sentence."""
    team, text = row.get("team") or {}, row.get("text") or ""
    out = []
    for i, s in enumerate(sentences(text)):
        marked = re.sub(r" from (?:the )?([A-Z][\w.]*(?: [A-Z][\w.]*)*)['’]s practice squad", r" [[\1]]", s)
        kind, names, after = classify(marked)
        if "[[" in marked and kind == "promote":
            kind = "sign"
        if kind == "other" and out and not players_in(names):
            out[-1].setdefault("notes", []).append(s); continue
        label, group, moves = KINDS[kind]
        ev = {"lg": lg, "date": row.get("date"), "team": team, "kind": kind, "label": label, "group": group, "sentence": s, "text": text,
              "contract": contract_of(s) if kind in ("sign", "re_sign", "two_way", "extension", "convert") else "", "other": None, "conf": "high", "checks": []}
        if kind == "trade":
            ev.update(_trade(s, team, teams))
            out.append({**ev, "player": ev["players_in"][0] if ev["players_in"] else (ev["players_out"][0] if ev["players_out"] else None), "n": i})
            continue
        ps = players_in(names, with_from=True)
        # the other team, only when the sentence names it ("off waivers from Dallas", "from Philadelphia's practice squad")
        other = None
        if kind == "claim":
            m = re.search(r"off waivers from (?:the )?([A-Z][\w.' ]+?)(?:\.|$)", s)
            other = teams.find(m.group(1)) if m else None
        if not ps:
            ev["conf"] = "low"; ev["checks"].append("No player name could be read from this sentence.")
            out.append({**ev, "player": None, "n": i})
            continue
        for pos, name, came in ps:
            o = teams.find(came) if came else other
            if o and str(o.get("id")) == str(team.get("id")):
                o = None
            if came and not o:
                ev["checks"].append(f"“{came}” is not a team in this league's list.")
            out.append({**ev, "other": o, "came": came or "", "player": {"name": name, "pos": pos}, "n": i})
    return out


ASSET = re.compile(r"\b(\d{4} (?:first|second|third|fourth|fifth|sixth|seventh)-round (?:draft )?picks?|(?:a |an )?(?:\d{4} )?(?:first|second|third|fourth|fifth|sixth|seventh)-round (?:draft )?picks?|draft considerations?|cash considerations?|draft consideration)\b", re.I)


def _trade(s, team, teams):
    """Who came in and who went out in one trade sentence, and the other team (or teams)."""
    low = s.lower()
    others, ins, outs, a_in, a_out = [], [], [], [], []
    assets = lambda x: [a.strip() for a in ASSET.findall(x or "")]
    strip = lambda x: ASSET.sub(" ", x or "")
    def side(words):
        t = teams.find(words) if words else None
        if t and str(t.get("id")) != str(team.get("id")) and all(str(o.get("id")) != str(t.get("id")) for o in others):
            others.append(t)
        return t
    if low.startswith("traded"):
        m = re.match(r"Traded (.+?) to (?:the )?(.+?)(?: (?:for|in exchange for) (.+?))?\.?$", s)
        if m:
            side(m.group(2)); outs += players_in(strip(m.group(1))); a_out += assets(m.group(1)); ins += players_in(strip(m.group(3) or "")); a_in += assets(m.group(3))
    else:
        body = re.sub(r"^(?:Acquired|Received)\s+", "", s).rstrip(".")
        body = re.sub(r",? pending (?:a )?physical,?", "", body)
        parts = re.split(r" (?:in exchange for|for) ", body, maxsplit=1)
        head, tail = parts[0], parts[1] if len(parts) > 1 else ""
        sent = re.search(r"that sent (.+?) to (?:the )?([A-Z][\w. ]+?)(?:\.|$|,)", head)
        if sent:
            outs += players_in(strip(sent.group(1))); side(sent.group(2)); head = head[:sent.start()]
        head = re.sub(r" in a (?:three|four)-team trade.*$", "", head)
        for got, frm in re.findall(r"(.+?) from (?:the )?([A-Z][\w.]*(?: [A-Z][\w.]*)*)(?:\s+and\s+|,\s*|$)", head):
            side(frm); ins += players_in(strip(got)); a_in += assets(got)
        if not re.search(r" from ", head):
            ins += players_in(strip(head)); a_in += assets(head)
        outs += players_in(strip(tail)); a_out += assets(tail)
    as_p = lambda ps: [{"name": n, "pos": p} for p, n in ps]
    return {"players_in": as_p(ins), "players_out": as_p(outs), "assets_in": a_in, "assets_out": a_out, "other": others[0] if others else None,
            "others": others, "three_team": "three-team" in low or len(others) > 1}


# ---------- a whole league ----------
def events(lg, rows, team_list):
    teams = Teams(team_list)
    evs = []
    for r in rows:
        evs.extend(read(lg, r, teams))
    # drop repeats: same player, same team, same family of move, within a day
    seen, out = {}, []
    for e in sorted(evs, key=lambda e: (e["date"] or "", e.get("n", 0))):
        p = e.get("player")
        if e["kind"] == "trade" or not p:
            out.append(e); continue
        fam = "leave" if e["kind"] in LEAVES else e["kind"]
        k = (norm(p["name"]), str((e["team"] or {}).get("id")), fam)
        prev = seen.get(k)
        if prev and abs(_day(e["date"]) - _day(prev["date"])) <= 1:
            prev.setdefault("also", []).append(e["sentence"]); continue
        seen[k] = e; out.append(e)
    # join the two sides of a trade: same day (or the next), each names the other team
    trades = [e for e in out if e["kind"] == "trade"]
    for e in trades:
        if e.get("joined"):
            continue
        for f in trades:
            if f is e or f.get("joined") or abs(_day(e["date"]) - _day(f["date"])) > 1:
                continue
            if e.get("other") and f.get("other") and str(e["other"].get("id")) == str(f["team"].get("id")) and str(f["other"].get("id")) == str(e["team"].get("id")):
                f["joined"] = True; e["side"] = f
                break
    out = [e for e in out if not e.get("joined")]
    for i, e in enumerate(out):
        e["id"] = f"{lg}:{e['date'][:10] if e.get('date') else ''}:{(e['team'] or {}).get('id', '')}:{e['kind']}:{norm((e.get('player') or {}).get('name')) or i}:{e.get('n', 0)}"
    out.sort(key=lambda e: e["date"] or "", reverse=True)
    return out


def _day(d):
    m = re.match(r"(\d{4})-(\d\d)-(\d\d)", str(d or ""))
    if not m:
        return 0
    import datetime
    return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).toordinal()


def public(e):
    """The event as the page gets it."""
    side = e.get("side")
    keep = {k: e.get(k) for k in ("id", "lg", "date", "team", "kind", "label", "group", "sentence", "text", "contract", "other", "conf", "checks", "player", "notes")}
    if e["kind"] != "trade":
        terms = contract_terms(e.get("sentence"))
        if terms:
            keep["terms"] = terms
    if e["kind"] == "trade":
        keep.update({k: e.get(k) for k in ("players_in", "players_out", "assets_in", "assets_out", "three_team", "others")})
        if side:
            keep["side"] = {k: side.get(k) for k in ("team", "sentence", "players_in", "players_out", "assets_in", "assets_out")}
    if e.get("also"):
        keep["also"] = e["also"]
    return keep
