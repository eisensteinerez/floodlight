"""Floodlight private competitions: friend groups that pick winners and player outcomes for virtual points.

No money is involved anywhere: there are no stakes, no entry fees and no prizes, only points on a leaderboard.

A member creates a group (a name and an invite code), friends join with the invite link, and each member picks
- the winner of a game (soccer can also be a draw), or
- the over or under on a player line (from the same verified market feed every page reads).
A pick can be changed or removed until its game starts; from then on it is locked and everyone in the group can see it.
Before the start, other members' picks are hidden, so nobody copies.

Grading runs on the server: a game's winner from ESPN's final, a player line from the same box-score grader the pick
record uses (propbook's grader). Points: a correct winner 10, plus 5 when the winner was the underdog on ESPN's own
moneyline; a correct player outcome 10; a push or a void 0. Leaderboards are this week (Monday to Sunday, UTC) and
the season (everything since the group began).
"""
import json
import re
import secrets
import threading
import time
from pathlib import Path

import storage

ROOT = Path(__file__).resolve().parent
PATH = ROOT / ".floodlight-cache" / "groups.json"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/"
# league key -> ESPN path, the same leagues Home reads
PATHS = {"nfl": "football/nfl", "fbs": "football/college-football", "nba": "basketball/nba", "cbb": "basketball/mens-college-basketball",
         "wnba": "basketball/wnba", "nhl": "hockey/nhl", "mlb": "baseball/mlb", "soccer": "soccer/all"}
PROP_SPORTS = {"nba", "wnba", "nfl", "nhl", "mlb"}
POINTS_WIN, POINTS_UPSET, POINTS_PROP = 10, 5, 10
MAX_GROUPS, MAX_MEMBERS, MAX_PICKS_WEEK = 20, 50, 300
GRADE_AFTER = 2.5 * 3600       # a game is usually over this long after its start
GIVE_UP = 5 * 86400            # with no result after five days the pick is void

_lock = threading.Lock()
D = {"groups": {}, "picks": {}}
DEPS = {}
_state = {"dirty": False, "saved": 0.0}


def setup(fetch=None, grade=None, grade_mlb=None, loop=True):
    """fetch(url, ttl, as_json=True) -> dict; grade / grade_mlb: propbook's player-line graders, (g, slate) -> (result, shown)."""
    DEPS.update(fetch=fetch, grade=grade, grade_mlb=grade_mlb)
    D.update(storage.load(PATH, {"groups": {}, "picks": {}}))
    D.setdefault("groups", {})
    D.setdefault("picks", {})
    if loop:
        threading.Thread(target=_loop, daemon=True, name="groups").start()


def _save(force=False):
    _state["dirty"] = True
    if force or time.time() - _state["saved"] > 20:
        try:
            storage.save(PATH, D)
            _state.update(dirty=False, saved=time.time())
        except Exception as e:
            print("groups: couldn't save:", e)


def _text(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _week_start(t):
    """Monday 00:00 UTC of the week holding t."""
    day = int(t // 86400)
    return (day - (day + 3) % 7) * 86400    # 1970-01-01 was a Thursday


def _uname(user):
    return user["username"].lower()


def _display(user):
    return (user.get("prefs") or {}).get("display") or user["username"]


# ---------- reading ----------

def _board(gid, since=0):
    pts = {}
    g = D["groups"].get(gid) or {}
    for u, m in g.get("members", {}).items():
        pts[u] = {"user": u, "name": m.get("name") or u, "points": 0, "hits": 0, "misses": 0, "pending": 0, "upsets": 0}
    for p in D["picks"].get(gid, []):
        if p["start"] < since or p["user"] not in pts:
            continue
        row = pts[p["user"]]
        if p.get("result") in ("won", "lost"):
            row["hits" if p["result"] == "won" else "misses"] += 1
            row["points"] += p.get("pts") or 0
            row["upsets"] += 1 if p.get("upset") and p["result"] == "won" else 0
        elif not p.get("result"):
            row["pending"] += 1
    out = sorted(pts.values(), key=lambda r: (-r["points"], -r["hits"], r["misses"], r["name"].lower()))
    rank, last = 0, None
    for i, r in enumerate(out):
        key = (r["points"], r["hits"], r["misses"])
        if key != last:
            rank, last = i + 1, key
        r["rank"] = rank
    return out


def _pick_view(p, me, now):
    mine, locked = p["user"] == me, p["start"] <= now
    v = {k: p.get(k) for k in ("id", "user", "kind", "sport", "lg", "event", "a", "b", "start", "label", "line", "k", "player", "result", "pts", "upset", "actual", "made")}
    v["locked"] = locked
    v["mine"] = mine
    if mine or locked:
        v["choice"] = p.get("choice")
    return v


def _group_view(g, me, now, full=False):
    v = {"id": g["id"], "name": g["name"], "owner": g["owner"], "created": g["created"], "isOwner": g["owner"] == me,
         "members": len(g["members"])}
    week = _board(g["id"], _week_start(now))
    mine = next((r for r in week if r["user"] == me), None)
    v["weekRank"] = mine["rank"] if mine else None
    v["weekPoints"] = mine["points"] if mine else 0
    if full:
        v["code"] = g["code"]
        v["memberList"] = [{"user": u, "name": m.get("name") or u, "joined": m.get("joined")} for u, m in g["members"].items()]
        v["week"] = week
        v["season"] = _board(g["id"], 0)
        picks = D["picks"].get(g["id"], [])
        # mine in full; others only once their game has started (then they are locked and fair to show)
        v["picks"] = [_pick_view(p, me, now) for p in sorted(picks, key=lambda p: -p["start"]) if p["user"] == me or p["start"] <= now][:400]
        v["weekStart"] = _week_start(now)
    return v


def get(path, q, user):
    """GET /api/groups[...] -> (status, body)."""
    now = time.time()
    me = _uname(user)
    with _lock:
        if path == "/api/groups":
            mine = [g for g in D["groups"].values() if me in g["members"]]
            return 200, {"groups": [_group_view(g, me, now) for g in sorted(mine, key=lambda g: g["name"].lower())]}
        if path == "/api/groups/get":
            g = D["groups"].get(str(q.get("id") or ""))
            if not g or me not in g["members"]:
                return 404, {"error": "That group doesn't exist, or you aren't in it."}
            return 200, {"group": _group_view(g, me, now, full=True)}
        if path == "/api/groups/preview":
            code = str(q.get("code") or "").upper()
            g = next((g for g in D["groups"].values() if g["code"] == code), None)
            if not g:
                return 404, {"error": "This invite link doesn't work any more. Ask for a new one."}
            return 200, {"group": {"id": g["id"], "name": g["name"], "members": len(g["members"]), "in": me in g["members"],
                                   "owner": (g["members"].get(g["owner"]) or {}).get("name") or g["owner"]}}
    return 404, {"error": "Not found."}


# ---------- changing ----------

def _new_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"     # no 0/O or 1/I to misread
    while True:
        c = "".join(secrets.choice(alphabet) for _ in range(8))
        if not any(g["code"] == c for g in D["groups"].values()):
            return c


def _clean_pick(raw, now):
    kind = raw.get("kind")
    lg = str(raw.get("lg") or "")
    start = raw.get("start")
    try:
        start = float(start) / (1000 if float(start) > 1e11 else 1)
    except (TypeError, ValueError):
        return None, "That pick has no start time."
    if start <= now + 30:
        return None, "That game has already started, so it can't be picked."
    if start > now + 14 * 86400:
        return None, "Picks open two weeks before a game."
    base = {"kind": kind, "lg": lg, "start": start, "sport": _text(raw.get("sport"), 16), "event": _text(raw.get("event"), 24)}
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,24}", base["event"]):
        return None, "That game isn't recognised."
    if kind == "winner":
        if lg not in PATHS:
            return None, "Winner picks are open for the NFL, college football, NBA, WNBA, college basketball, NHL, MLB and soccer."
        a, b = raw.get("a") or {}, raw.get("b") or {}
        base["a"] = {"id": _text(a.get("id"), 12), "name": _text(a.get("name"), 40)}
        base["b"] = {"id": _text(b.get("id"), 12), "name": _text(b.get("name"), 40)}
        choice = str(raw.get("choice") or "")
        if choice not in ("a", "b") and not (choice == "draw" and lg == "soccer"):
            return None, "Pick one of the two teams" + (", or a draw." if lg == "soccer" else ".")
        if not base["a"]["name"] or not base["b"]["name"]:
            return None, "That game is missing a team."
        base["choice"] = choice
        base["label"] = f"{base['a']['name']} v {base['b']['name']}"
        base["key"] = f"w:{lg}:{base['event']}"
        return base, None
    if kind == "player":
        if lg not in PROP_SPORTS:
            return None, "Player picks are open for the NBA, WNBA, NFL, NHL and MLB."
        try:
            line = float(raw.get("line"))
        except (TypeError, ValueError):
            return None, "That player line has no number."
        choice = str(raw.get("choice") or "")
        if choice not in ("over", "under"):
            return None, "Pick over or under."
        base.update(player=_text(raw.get("player"), 60), k=_text(raw.get("k"), 16), line=line, choice=choice,
                    label=_text(raw.get("label"), 40), a={"name": _text(raw.get("team"), 40)}, b={"name": _text(raw.get("opp"), 40)})
        if not base["player"] or not re.fullmatch(r"[a-z0-9_]{1,16}", base["k"]):
            return None, "That player line isn't recognised."
        base["key"] = f"p:{lg}:{base['event']}:{_text(base['player'], 60).lower()}:{base['k']}"
        return base, None
    return None, "Choose a game winner or a player line."


def post(path, body, user):
    """POST /api/groups/... -> (status, body)."""
    now = time.time()
    me = _uname(user)
    act = path.rsplit("/", 1)[-1]
    with _lock:
        if act == "create":
            name = _text(body.get("name"), 40)
            if len(name) < 2:
                return 400, {"error": "Give the group a name of at least two characters."}
            if sum(1 for g in D["groups"].values() if g["owner"] == me) >= MAX_GROUPS:
                return 400, {"error": f"You can run {MAX_GROUPS} groups. Delete one first."}
            gid = "g" + secrets.token_hex(6)
            D["groups"][gid] = {"id": gid, "name": name, "owner": me, "code": _new_code(), "created": int(now * 1000),
                                "members": {me: {"name": _display(user), "joined": int(now * 1000)}}}
            D["picks"][gid] = []
            _save(True)
            return 200, {"group": _group_view(D["groups"][gid], me, now, full=True)}
        if act == "join":
            code = str(body.get("code") or "").upper()
            g = next((g for g in D["groups"].values() if g["code"] == code), None)
            if not g:
                return 404, {"error": "This invite link doesn't work any more. Ask for a new one."}
            if me not in g["members"]:
                if len(g["members"]) >= MAX_MEMBERS:
                    return 400, {"error": f"This group is full ({MAX_MEMBERS} members)."}
                g["members"][me] = {"name": _display(user), "joined": int(now * 1000)}
                _save(True)
            return 200, {"group": _group_view(g, me, now, full=True)}
        g = D["groups"].get(str(body.get("id") or ""))
        if not g or me not in g["members"]:
            return 404, {"error": "That group doesn't exist, or you aren't in it."}
        owner = g["owner"] == me
        if act == "leave":
            if owner and len(g["members"]) > 1:
                return 400, {"error": "You run this group. Delete it, or remove the other members first."}
            g["members"].pop(me, None)
            D["picks"][g["id"]] = [p for p in D["picks"].get(g["id"], []) if p["user"] != me]
            if not g["members"]:
                D["groups"].pop(g["id"], None)
                D["picks"].pop(g["id"], None)
            _save(True)
            return 200, {"ok": True}
        if act in ("rename", "remove", "delete", "code") and not owner:
            return 403, {"error": "Only the person who made the group can do that."}
        if act == "rename":
            name = _text(body.get("name"), 40)
            if len(name) < 2:
                return 400, {"error": "Give the group a name of at least two characters."}
            g["name"] = name
        elif act == "remove":
            who = str(body.get("user") or "").lower()
            if who == me or who not in g["members"]:
                return 400, {"error": "That member isn't in the group."}
            g["members"].pop(who)
            D["picks"][g["id"]] = [p for p in D["picks"].get(g["id"], []) if p["user"] != who]
        elif act == "delete":
            D["groups"].pop(g["id"], None)
            D["picks"].pop(g["id"], None)
            _save(True)
            return 200, {"ok": True}
        elif act == "code":
            g["code"] = _new_code()
        elif act == "pick":
            p, err = _clean_pick(body.get("pick") if isinstance(body.get("pick"), dict) else {}, now)
            if err:
                return 400, {"error": err}
            picks = D["picks"].setdefault(g["id"], [])
            old = next((x for x in picks if x["user"] == me and x["key"] == p["key"]), None)
            if old and old["start"] <= now:
                return 400, {"error": "That pick is locked: the game has started."}
            wk = _week_start(now)
            if not old and sum(1 for x in picks if x["user"] == me and x["made"] / 1000 >= wk) >= MAX_PICKS_WEEK:
                return 400, {"error": f"You've made {MAX_PICKS_WEEK} picks in this group this week."}
            if old:
                picks.remove(old)
            p.update(id="k" + secrets.token_hex(5), user=me, made=int(now * 1000))
            picks.append(p)
        elif act == "unpick":
            picks = D["picks"].get(g["id"], [])
            p = next((x for x in picks if x["id"] == str(body.get("pid") or "") and x["user"] == me), None)
            if not p:
                return 404, {"error": "That pick isn't there."}
            if p["start"] <= now:
                return 400, {"error": "That pick is locked: the game has started."}
            picks.remove(p)
        else:
            return 404, {"error": "Not found."}
        _save(True)
        return 200, {"group": _group_view(g, me, now, full=True)}


# ---------- grading ----------

def _ml_chance(o):
    try:
        n = float(o)
    except (TypeError, ValueError):
        return None
    if not n:
        return None
    return -n / (-n + 100) if n < 0 else 100 / (n + 100)


def _grade_winner(p):
    fetch = DEPS.get("fetch")
    if not fetch:
        return None
    d = fetch(f"{ESPN}{PATHS[p['lg']]}/summary?event={p['event']}", 300, as_json=True) or {}
    comp = ((d.get("header") or {}).get("competitions") or [{}])[0]
    st = (comp.get("status") or {}).get("type") or {}
    if st.get("state") != "post":
        if re.search(r"postpon|cancel", str(st.get("description") or ""), re.I):
            return {"result": "void", "actual": st.get("description")}
        return None
    cs = comp.get("competitors") or []
    side = {"a": p["a"], "b": p["b"]}

    def find(t):
        return next((c for c in cs if str((c.get("team") or {}).get("id") or "") == t.get("id")), None) or \
            next((c for c in cs if (t.get("name") or "").lower() in str((c.get("team") or {}).get("displayName") or "").lower()), None)
    ca, cb = find(side["a"]), find(side["b"])
    if not ca or not cb:
        return {"result": "void", "actual": "teams not found in the final"}
    sa, sb = str(ca.get("score") or ""), str(cb.get("score") or "")
    winner = "a" if ca.get("winner") else "b" if cb.get("winner") else "draw" if sa and sa == sb else None
    if winner is None:
        return None
    res = "won" if winner == p["choice"] else "lost"
    upset = False
    if res == "won" and p["choice"] in ("a", "b"):
        # underdog on ESPN's own moneyline (the pick center the summary carries), when it has one
        pc = (d.get("pickcenter") or [{}])[0]
        mine = ca if p["choice"] == "a" else cb
        home = mine.get("homeAway") == "home"
        ml = (pc.get("homeTeamOdds") if home else pc.get("awayTeamOdds")) or {}
        ch = _ml_chance(ml.get("moneyLine"))
        upset = ch is not None and ch < 0.45
    return {"result": res, "actual": f"{side['a']['name']} {sa}–{sb} {side['b']['name']}", "upset": upset}


def _grade_player(p):
    import datetime as dt
    fn = DEPS.get("grade_mlb") if p["lg"] == "mlb" else DEPS.get("grade")
    if not fn:
        return None
    slate = dt.datetime.fromtimestamp(p["start"] - 5 * 3600, dt.timezone.utc).date()   # US game day
    g = {"t": "prop", "sport": p["lg"], "player": p["player"], "stat": p["k"], "line": p["line"], "side": p["choice"], "slate": slate.isoformat()}
    res, shown = fn(g, slate)
    if res in ("won", "lost", "push", "void"):
        return {"result": res, "actual": str(shown or "")[:60]}
    return None


def grade_due(now=None, limit=40):
    now = now or time.time()
    with _lock:
        due = [p for ps in D["picks"].values() for p in ps if not p.get("result") and now - p["start"] > GRADE_AFTER][:limit]
    changed = False
    for p in due:
        try:
            out = _grade_winner(p) if p["kind"] == "winner" else _grade_player(p)
        except Exception as e:
            print("groups: grading", p.get("key"), type(e).__name__, e)
            out = None
        if not out and now - p["start"] > GIVE_UP:
            out = {"result": "void", "actual": "no result found within five days"}
        if out:
            with _lock:
                p.update(out)
                p["pts"] = (POINTS_WIN + (POINTS_UPSET if out.get("upset") else 0) if p["kind"] == "winner" else POINTS_PROP) if out["result"] == "won" else 0
                p["graded"] = int(now * 1000)
            changed = True
    if changed:
        with _lock:
            _save(True)
    return len(due)


def _loop():
    time.sleep(60)
    while True:
        try:
            grade_due()
            if _state["dirty"]:
                with _lock:
                    _save(True)
        except Exception as e:
            print("groups loop:", e)
        time.sleep(600)
