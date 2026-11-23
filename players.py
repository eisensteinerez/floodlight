"""Floodlight's one player record: the team every page shows for a player comes from here and nowhere else.

Why. Each page used to work a player's team out on its own: the search box from ESPN's search, the profile from ESPN's
athlete page, the Predictions and Lab cards from the sportsbook's abbreviation. When those disagreed, the pages
disagreed. Now there is one record per player, read from the teams' own rosters, and every page asks for it.

A record:
  fid        Floodlight's id, "<sport>:<provider id>" (nba:1966). MLB uses MLB's own ids, the rest ESPN's.
  provider   "espn" or "mlb";  pid  that provider's id
  name, sport, league, pos, photo, active, injury
  teamId, teamAbbr, teamName   the team whose roster lists them
  rosterAt   when a roster read last listed them there ("Roster verified 18 minutes ago")
  prev       the team before, when a roster read moved them: {teamId, teamAbbr, teamName, until}; kept 60 days
  books      the team each sportsbook lists them with, and when it was seen
  flags      what the checks below found, each {code, text, at}; a flag that isn't seen again for a day drops off

Checks (flag codes):
  two_teams           two rosters list the same player in one read
  profile_mismatch    a page showed a different team from the record (the page reports it, POST /api/players/seen)
  not_in_game         a prop's game doesn't involve the player's team
  prop_on_opponent    a prop lists the player with the team they are playing against
  unknown_team        a team code that doesn't match any team in the league
  crowded_team        a roster read gave a team more players than the league allows
  inactive_props      a player the roster marks out or inactive still has props posted
  providers_disagree  a sportsbook lists a different team from the roster (and it isn't a move from the last week)

A record with two_teams, providers_disagree, profile_mismatch or crowded_team, or that no roster has listed for two
days, is "checking": pages show "Team information is being verified" in place of the team, and props for it are held
back from the ranked lists. Nothing here guesses a team.

Saved in players.json through storage.py. Rosters are re-read every six hours, in the background once there is a copy.
"""
import concurrent.futures as cf
import re
import threading
import time
import unicodedata
from pathlib import Path

import storage
import teamcheck

SPORTS = ("nba", "wnba", "nfl", "nhl", "mlb")
LEAGUE = {"nba": "NBA", "wnba": "WNBA", "nfl": "NFL", "nhl": "NHL", "mlb": "MLB"}
ESPN_PATH = {"nba": "basketball/nba", "wnba": "basketball/wnba", "nfl": "football/nfl", "nhl": "hockey/nhl"}
ESPN = "https://site.api.espn.com/apis/site/v2/sports"
ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3"
SAPI = "https://statsapi.mlb.com/api/v1"
FRESH = 6 * 3600              # rosters are read again after this
STALE = 2 * 86400             # a record no roster has listed for this long is "checking"
FLAG_LIFE = 86400             # a flag not seen again for this long drops off
PREV_LIFE = 60 * 86400        # the previous team is shown this long after a move
MOVE_GRACE = 7 * 86400        # the books may still show the old team this long after a move: not a disagreement
MAX_ROSTER = {"nba": 21, "wnba": 18, "nfl": 91, "nhl": 34, "mlb": 50}   # a read with more than this is suspect
HOLD = {"two_teams", "providers_disagree", "profile_mismatch", "crowded_team"}
ROW_HOLD = {"not_in_game", "prop_on_opponent", "inactive_props"} | HOLD
FLAG_TEXT = {
    "two_teams": "Two rosters list this player on the same day.",
    "profile_mismatch": "A page showed a different team from the roster.",
    "not_in_game": "The prop's game doesn't involve the player's team.",
    "prop_on_opponent": "The prop lists the player with the team they are playing against.",
    "unknown_team": "A sportsbook used a team code that doesn't match a team in this league.",
    "crowded_team": "The roster read for this team listed more players than the league allows.",
    "inactive_props": "The roster marks this player out or inactive, but props are still posted.",
    "providers_disagree": "A sportsbook and the team roster list different teams.",
}

D = {"fetch": None, "file": Path(__file__).resolve().parent / ".floodlight-cache" / "players.json", "now": time.time}
DB = {"players": {}, "teams": {}, "read": {}, "errors": {}}
_lock = threading.RLock()
_reading = {}                 # sport -> True while a roster read runs
_names = {}                   # (sport, normalised name) -> [fid]
_state = {"loaded": False, "dirty": False}


def setup(**deps):
    """deps: fetch(url, ttl, as_json=True), file (Path), now (for tests)."""
    D.update({k: v for k, v in deps.items() if v is not None})
    with _lock:
        DB.clear()
        DB.update({"players": {}, "teams": {}, "read": {}, "errors": {}})
        DB.update(storage.load(D["file"], {}) or {})
        for k in ("players", "teams", "read", "errors"):
            DB.setdefault(k, {})
        _reindex()
        _state["loaded"] = True


def _now():
    return D["now"]()


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def _bare(s):
    """A name without Jr., Sr., II, III: books and rosters don't always agree on those."""
    return re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", norm(s))


def _reindex():
    _names.clear()
    for fid, r in DB["players"].items():
        for n in {norm(r.get("name")), _bare(r.get("name"))}:
            _names.setdefault((r["sport"], n), []).append(fid)


def _get(url, ttl):
    if not D["fetch"]:
        raise RuntimeError("no fetch")
    return D["fetch"](url, ttl, as_json=True)


def save():
    with _lock:
        storage.save(D["file"], DB)
        _state["dirty"] = False


# ---------- reading the rosters ----------
def _teams(sport):
    """[{id, abbr, name}] for the league."""
    if sport == "mlb":
        d = _get(f"{SAPI}/teams?sportId=1", 86400)
        return [{"id": str(t["id"]), "abbr": t.get("abbreviation") or "", "name": t.get("name") or ""} for t in d.get("teams") or [] if t.get("id")]
    d = _get(f"{ESPN}/{ESPN_PATH[sport]}/teams", 86400)
    out = []
    for lg in ((d.get("sports") or [{}])[0].get("leagues") or []):
        for x in lg.get("teams") or []:
            t = x.get("team") or x
            if t.get("id"):
                out.append({"id": str(t["id"]), "abbr": t.get("abbreviation") or "", "name": t.get("displayName") or t.get("name") or ""})
    return out


def _photo(sport, pid):
    if sport == "mlb":
        return (f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/"
                f"{pid}/headshot/67/current")
    return f"https://a.espncdn.com/i/headshots/{sport}/players/full/{pid}.png"


OUT = re.compile(r"^(out|injured reserve|ir|suspended|inactive|d\d+|60-day|10-day|15-day|il|day-to-day-out)", re.I)


def _roster(sport, team):
    """The players a team's roster lists: [{pid, name, pos, photo, active, injury}]."""
    if sport == "mlb":
        d = {}
        for kind in ("40Man", "active"):   # the 40-man list in the off-season, the active list if that one is empty
            try:
                d = _get(f"{SAPI}/teams/{team['id']}/roster?rosterType={kind}", FRESH)
            except Exception:
                d = {}
            if d.get("roster"):
                break
        out = []
        for x in d.get("roster") or []:
            p = x.get("person") or {}
            if not p.get("id"):
                continue
            st = x.get("status") or {}
            code = str(st.get("code") or "A")
            out.append({"pid": str(p["id"]), "name": p.get("fullName") or "", "pos": (x.get("position") or {}).get("abbreviation") or "",
                        "photo": _photo("mlb", p["id"]), "active": code == "A", "injury": "" if code == "A" else st.get("description") or code})
        return out
    d = _get(f"{ESPN}/{ESPN_PATH[sport]}/teams/{team['id']}/roster", FRESH)
    items = []
    for a in d.get("athletes") or []:
        items.extend(a["items"] if isinstance(a, dict) and isinstance(a.get("items"), list) else [a])   # NFL and NHL group by unit
    out = []
    for a in items:
        if not isinstance(a, dict) or not a.get("id"):
            continue
        inj = next((str(i.get("status") or "") for i in a.get("injuries") or [] if i.get("status")), "")
        st = a.get("status") or {}
        st = (st.get("type") or st.get("name") or "") if isinstance(st, dict) else str(st)
        active = str(st or "active").lower() in ("active", "") and not OUT.match(inj or "")
        out.append({"pid": str(a["id"]), "name": a.get("fullName") or a.get("displayName") or "", "pos": (a.get("position") or {}).get("abbreviation") or "",
                    "photo": (a.get("headshot") or {}).get("href") or _photo(sport, a["id"]), "active": active, "injury": inj})
    return out


def read_rosters(sport):
    """Read every roster in the league once and bring the records up to date. Returns a short report."""
    now = _now()
    try:
        teams = _teams(sport)
    except Exception as e:
        with _lock:
            DB["errors"][sport] = {"at": now, "error": str(e)[:160]}
        _health("rosters", sport, False, str(e))
        return {"sport": sport, "ok": False, "error": str(e)[:160]}
    got, failed = {}, []

    def one(t):
        try:
            return t, _roster(sport, t)
        except Exception:
            return t, None
    with cf.ThreadPoolExecutor(4) as ex:
        for t, rows in ex.map(one, teams):
            if rows is None:
                failed.append(t["abbr"])
            else:
                got[t["id"]] = (t, rows)
    report = {"sport": sport, "ok": bool(got), "teams": len(teams), "read": len(got), "failed": failed, "moved": [], "two": [], "crowded": []}
    if not got:
        _health("rosters", sport, False, "no roster answered")
        return report
    seen = {}
    for tid, (t, rows) in got.items():
        if len(rows) > MAX_ROSTER[sport]:
            report["crowded"].append(t["abbr"])
        for r in rows:
            seen.setdefault(r["pid"], []).append((t, r))
    with _lock:
        DB["teams"][sport] = {tid: {"abbr": t["abbr"], "name": t["name"], "n": len(rows), "at": now} for tid, (t, rows) in got.items()}
        players = DB["players"]
        for pid, hits in seen.items():
            fid = f"{sport}:{pid}"
            rec = players.get(fid)
            teams_here = {t["id"] for t, _ in hits}
            # listed by two teams: keep the team the record already had if it is one of them, and flag it either way
            t, r = next(((t, r) for t, r in hits if rec and t["id"] == rec.get("teamId")), hits[0])
            if rec is None:
                rec = players[fid] = {"fid": fid, "provider": "mlb" if sport == "mlb" else "espn", "pid": pid, "sport": sport, "league": LEAGUE[sport],
                                      "prev": None, "books": {}, "flags": []}
            elif rec.get("teamId") and rec["teamId"] != t["id"] and rec.get("rosterAt"):
                rec["prev"] = {"teamId": rec["teamId"], "teamAbbr": rec.get("teamAbbr") or "", "teamName": rec.get("teamName") or "", "until": now}
                report["moved"].append(f"{r['name']}: {rec.get('teamAbbr')} to {t['abbr']}")
            rec.update(name=r["name"] or rec.get("name") or "", pos=r["pos"], photo=r["photo"], active=r["active"], injury=r["injury"],
                       teamId=t["id"], teamAbbr=teamcheck.canon(sport, t["abbr"]) or t["abbr"], teamName=t["name"], rosterAt=now, source="roster")
            _flag(rec, "two_teams", len(teams_here) > 1, " and ".join(sorted(x["name"] for x, _ in hits)) if len(teams_here) > 1 else "")
            _flag(rec, "crowded_team", t["abbr"] in report["crowded"], f"{t['name']} roster read listed {len(got[t['id']][1])} players")
            if len(teams_here) > 1:
                report["two"].append(r["name"])
        DB["read"][sport] = now
        DB["errors"].pop(sport, None)
        _reindex()
    save()
    _health("rosters", sport, len(failed) <= len(teams) // 4, f"{len(failed)} of {len(teams)} rosters didn't answer" if failed else "", n=len(seen))
    return report


def ensure(sport, wait=True):
    """Rosters read within FRESH. With no copy at all, read now (wait); otherwise read in the background."""
    if sport not in SPORTS:
        return
    with _lock:
        last = DB["read"].get(sport) or 0
        if _now() - last < FRESH or _reading.get(sport):
            return
        _reading[sport] = True

    def go():
        try:
            read_rosters(sport)
        finally:
            _reading.pop(sport, None)
    if wait and not last:
        go()
    else:
        threading.Thread(target=go, daemon=True, name=f"rosters-{sport}").start()


# ---------- flags ----------
def _flag(rec, code, on, detail=""):
    now = _now()
    flags = [f for f in rec.get("flags") or [] if f["code"] != code and now - f.get("at", 0) < FLAG_LIFE]
    if on:
        flags.append({"code": code, "text": FLAG_TEXT[code] + (f" {detail}" if detail else ""), "at": now})
    rec["flags"] = flags
    _state["dirty"] = True


def _live_flags(rec):
    now = _now()
    return [f for f in rec.get("flags") or [] if now - f.get("at", 0) < FLAG_LIFE]


def status(rec):
    """"verified", "checking" or "unknown" (no record), and why."""
    if not rec:
        return "unknown", "No roster lists this player yet."
    hold = [f for f in _live_flags(rec) if f["code"] in HOLD]
    if hold:
        return "checking", hold[0]["text"]
    if not rec.get("rosterAt"):
        return "checking", "Not on a roster we have read yet; the team comes from the player's own page."
    if _now() - rec["rosterAt"] > STALE:
        return "checking", "The roster hasn't been read for two days."
    return "verified", ""


def view(rec):
    """The record as the pages get it."""
    if not rec:
        return None
    st, why = status(rec)
    prev = rec.get("prev")
    if prev and _now() - (prev.get("until") or 0) > PREV_LIFE:
        prev = None
    return {"fid": rec["fid"], "provider": rec.get("provider"), "pid": rec.get("pid"), "name": rec.get("name"), "sport": rec["sport"], "league": rec.get("league") or LEAGUE.get(rec["sport"]),
            "teamId": rec.get("teamId") or "", "teamAbbr": rec.get("teamAbbr") or "", "teamName": rec.get("teamName") or "", "pos": rec.get("pos") or "",
            "photo": rec.get("photo") or "", "active": rec.get("active", True), "injury": rec.get("injury") or "", "rosterAt": rec.get("rosterAt"),
            "checkedAt": rec.get("checkedAt") or rec.get("rosterAt"), "prev": prev, "status": st, "why": why,
            "flags": [{"code": f["code"], "text": f["text"], "at": f["at"]} for f in _live_flags(rec)]}


# ---------- finding a record ----------
def get(fid, fetch_missing=True):
    sport = str(fid).split(":")[0]
    with _lock:
        rec = DB["players"].get(fid)
    if rec or not fetch_missing or sport not in SPORTS:
        return rec
    return _from_player_page(sport, str(fid).split(":", 1)[1])


def _from_player_page(sport, pid):
    """A record for a player no roster we read lists (a free agent, a two-way player): from their own page."""
    now = _now()
    try:
        if sport == "mlb":
            p = (_get(f"{SAPI}/people/{pid}?hydrate=currentTeam", 86400).get("people") or [{}])[0]
            if not p.get("id"):
                return None
            t = p.get("currentTeam") or {}
            abbr = next((x["abbr"] for x in _teams("mlb") if x["id"] == str(t.get("id"))), "")
            rec = {"name": p.get("fullName") or "", "pos": (p.get("primaryPosition") or {}).get("abbreviation") or "", "photo": _photo("mlb", pid),
                   "active": bool(p.get("active")), "injury": "", "teamId": str(t.get("id") or ""), "teamAbbr": abbr, "teamName": t.get("name") or ""}
        else:
            a = _get(f"{ESPN_WEB}/sports/{ESPN_PATH[sport]}/athletes/{pid}", 86400).get("athlete") or {}
            if not a.get("id"):
                return None
            t = a.get("team") or {}
            st = a.get("status") or {}
            rec = {"name": a.get("displayName") or a.get("fullName") or "", "pos": (a.get("position") or {}).get("abbreviation") or "",
                   "photo": (a.get("headshot") or {}).get("href") or _photo(sport, pid), "active": a.get("active", True) is not False and str(st.get("type") or "active") == "active",
                   "injury": next((str(i.get("status") or "") for i in a.get("injuries") or [] if i.get("status")), ""),
                   "teamId": str(t.get("id") or ""), "teamAbbr": teamcheck.canon(sport, t.get("abbreviation")) or t.get("abbreviation") or "", "teamName": t.get("displayName") or ""}
    except Exception:
        return None
    fid = f"{sport}:{pid}"
    with _lock:
        cur = DB["players"].get(fid)
        if cur:
            return cur
        rec.update(fid=fid, provider="mlb" if sport == "mlb" else "espn", pid=str(pid), sport=sport, league=LEAGUE[sport], prev=None, books={}, flags=[],
                   rosterAt=None, checkedAt=now, source="player page")
        DB["players"][fid] = rec
        _reindex()
        _state["dirty"] = True
    return rec


def find(sport, name, team=None, search=None, wait=True):
    """The record for a name. team (any abbreviation) settles two players with one name. search(sport, name) is the
    fallback when no roster lists the name: it returns {"id"} from the provider's own search."""
    if sport not in SPORTS or not name:
        return None
    ensure(sport, wait)
    want = teamcheck.canon(sport, team) if team else None
    with _lock:
        fids = _names.get((sport, norm(name))) or _names.get((sport, _bare(name))) or []
        cands = [DB["players"][f] for f in fids if f in DB["players"]]
    if cands:
        cands.sort(key=lambda r: (want is not None and r.get("teamAbbr") != want and (r.get("prev") or {}).get("teamAbbr") != want,
                                  not r.get("rosterAt"), not r.get("active", True)))
        return cands[0]
    if search:
        try:
            o = search(sport, name)
        except Exception:
            o = None
        if o and o.get("id"):
            return get(f"{sport}:{o['id']}")
    return None


# ---------- checks on a prop row ----------
def check_row(sport, rec, book, book_team, book_opp, now=None):
    """Flags for one prop: the record against what a sportsbook posted. Returns (codes on the row, note for the page)."""
    if sport not in SPORTS or not rec:
        return [], ""
    now = now or _now()
    mine = rec.get("teamAbbr") or ""
    bt, bo = teamcheck.canon(sport, book_team), teamcheck.canon(sport, book_opp)
    prev = rec.get("prev") or {}
    moved_from_book = bool(bt and prev.get("teamAbbr") == bt and now - (prev.get("until") or 0) < MOVE_GRACE)
    codes, notes = [], []
    with _lock:
        if book_team:
            rec.setdefault("books", {})[book] = {"abbr": str(book_team).upper(), "at": now}
        unknown = bool(book_team and not bt) or bool(book_opp and not bo)
        _flag(rec, "unknown_team", unknown, f"({', '.join(x for x in (book_team, book_opp) if x and not teamcheck.canon(sport, x))})" if unknown else "")
        disagree = bool(bt and mine and bt != mine and not moved_from_book)
        _flag(rec, "providers_disagree", disagree, f"{book.title()} lists {str(book_team).upper()}; the roster has {rec.get('teamName') or mine}." if disagree else "")
        on_opp = bool(bo and mine and bo == mine)
        _flag(rec, "prop_on_opponent", on_opp, f"{book.title()} lists the game as {str(book_team).upper()} v {str(book_opp).upper()}." if on_opp else "")
        off = bool(mine and bt and bo and mine not in (bt, bo) and not moved_from_book)
        _flag(rec, "not_in_game", off, f"The game is {str(book_team).upper()} v {str(book_opp).upper()}; {rec.get('name')} plays for {rec.get('teamName') or mine}." if off else "")
        inactive = rec.get("active") is False or bool(OUT.match(rec.get("injury") or ""))
        _flag(rec, "inactive_props", inactive, f"Roster status: {rec.get('injury') or 'inactive'}." if inactive else "")
        for f in _live_flags(rec):
            if f["code"] in ROW_HOLD or f["code"] == "unknown_team":
                codes.append(f["code"])
                notes.append(f["text"])
    if moved_from_book:
        notes.append(f"Moved from {prev.get('teamName') or prev.get('teamAbbr')} to {rec.get('teamName')}; the books still list {str(book_team).upper()}.")
    return sorted(set(codes)), " ".join(dict.fromkeys(notes))


def check_board(sport, rows):
    """Board-wide check: several players whose books' teams differ, all put on one roster team, is a sign of a bad
    roster read rather than real moves. Flags each of them. rows: [(rec, book_team)]."""
    by = {}
    for rec, bt in rows:
        b = teamcheck.canon(sport, bt)
        if rec and b and rec.get("teamAbbr") and b != rec["teamAbbr"]:
            by.setdefault(rec["teamAbbr"], []).append(rec)
    hit = {t: rs for t, rs in by.items() if len({r["fid"] for r in rs}) >= 3}
    with _lock:
        for t, rs in hit.items():
            for r in rs:
                _flag(r, "crowded_team", True, f"{len(rs)} players the books list elsewhere are all on the {t} roster read.")
    return sorted(hit)


def seen(fid, team_id, where, now=None):
    """A page reports the team it showed. A different team from the record flags it. Returns True when they agree."""
    rec = get(fid, fetch_missing=False)
    if not rec or not team_id:
        return None
    ok = str(team_id) == str(rec.get("teamId"))
    with _lock:
        if not ok:
            _flag(rec, "profile_mismatch", True, f"The {where} showed team {team_id}; the roster has {rec.get('teamName')}.")
        elif any(f["code"] == "profile_mismatch" for f in rec.get("flags") or []):
            _flag(rec, "profile_mismatch", False)
    return ok


# ---------- for the data-health panel ----------
def health():
    now = _now()
    with _lock:
        recs = list(DB["players"].values())
        out = {}
        for sp in SPORTS:
            rs = [r for r in recs if r["sport"] == sp]
            checking = sum(1 for r in rs if status(r)[0] == "checking")
            out[sp] = {"read": DB["read"].get(sp), "players": len(rs), "checking": checking, "teams": len(DB["teams"].get(sp) or {}),
                       "error": (DB["errors"].get(sp) or {}).get("error"), "noPhoto": sum(1 for r in rs if not r.get("photo"))}
        return {"now": now, "sports": out}


def flagged(limit=200):
    with _lock:
        rs = [view(r) for r in DB["players"].values() if _live_flags(r)]
    return sorted(rs, key=lambda r: -max(f["at"] for f in r["flags"]))[:limit]


def _health(feed, sport, ok, err="", n=None):
    h = D.get("health")
    if h:
        try:
            (h.ok if ok else h.fail)(feed, sport, err=err, n=n)
        except Exception:
            pass


def flush():
    if _state["dirty"]:
        save()
