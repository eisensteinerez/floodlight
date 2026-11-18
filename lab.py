"""Floodlight Lab: the research screen that opens inside Discord (a Discord Activity) or in a browser.

/lab in Discord checks the member's role like the other commands, leaves a short-lived "ticket" for that channel and
answers with LAUNCH_ACTIVITY. Discord then opens https://<app id>.discordsays.com/ in the channel, which its proxy
forwards to this server's root with ?frame_id=...&channel_id=... in the address; server.py serves lab.html for that.
The page swaps the channel's ticket for a signed pass (12 hours) and sends it with every /api/lab/ request, so the
Activity works without a site login. The browser link /lab posts carries the same kind of pass in its address.

All the numbers come from discord_bot.py's loaders (ESPN, MLB StatsAPI, FotMob, PrizePicks and Sleeper), cached the
same way, so the Lab costs nothing to run and calls no paid API.

  GET /lab                         the page (also served at / when Discord opens the Activity)
  GET /api/lab/session             ?channel_id=&instance_id= (Activity) or ?t= (browser link) -> {token, player, sport}
  GET /api/lab/player              ?sport=&name=   a player's games with every stat, their posted lines and summary numbers
  GET /api/lab/board               ?sport=         today's posted lines ranked by recent hit rate
  GET /api/lab/img                 ?u=             player photos through this server (Discord's Activity sandbox blocks other hosts)
"""
import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

import discord_bot as bot

PASS_HOURS = 12
TICKET_MIN = 15
IMG_HOSTS = ("a.espncdn.com", "img.mlbstatic.com", "images.fotmob.com", "img.a.transfermarkt.technology", "secure.espncdn.com")

_tickets, _instances, _imgs = {}, {}, {}
_lock = threading.Lock()


def _key():
    s = os.environ.get("DISCORD_BOT_TOKEN") or os.environ.get("DISCORD_PUBLIC_KEY") or "floodlight-lab-local"
    return hashlib.sha256(("lab:" + s).encode()).digest()


def make_pass(who="", hours=PASS_HOURS):
    body = base64.urlsafe_b64encode(json.dumps({"u": who, "x": int(time.time() + hours * 3600)}).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:18]).decode().rstrip("=")
    return f"{body}.{sig}"


def check_pass(tok):
    try:
        body, sig = str(tok or "").split(".")
        want = base64.urlsafe_b64encode(hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:18]).decode().rstrip("=")
        if not hmac.compare_digest(sig, want):
            return False
        return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))).get("x", 0) > time.time()
    except Exception:
        return False


def ticket(channel_id, opts, user=""):
    """/lab was used in this channel by a member: the Activity that opens there in the next minutes may get a pass."""
    with _lock:
        now = time.time()
        for k in [k for k, v in _tickets.items() if now - v["at"] > TICKET_MIN * 60]:
            _tickets.pop(k, None)
        _tickets[str(channel_id)] = {"at": now, "player": (opts.get("player") or "").strip(), "sport": opts.get("sport") or "", "user": user}


def session(q, signed_in=False):
    """-> (status, obj)"""
    if not q.get("t") and not q.get("channel_id"):   # opened straight in a browser: a site login is enough
        if signed_in:
            return 200, {"token": make_pass("site"), "player": q.get("player") or "", "sport": q.get("sport") or ""}
        return 403, {"error": "Type /lab in the Floodlight Discord to open the Lab, or log in to Floodlight first.", "need": "lab"}
    if q.get("t"):
        if not check_pass(q["t"]):
            return 403, {"error": "This Lab link has expired. Use /lab in Discord for a new one."}
        return 200, {"token": q["t"], "player": q.get("player") or "", "sport": q.get("sport") or ""}
    ch, inst = str(q.get("channel_id") or ""), str(q.get("instance_id") or "")
    with _lock:
        now = time.time()
        if inst and inst in _instances and now - _instances[inst]["at"] < PASS_HOURS * 3600:
            t = _instances[inst]
        else:
            t = _tickets.get(ch)
            if not t or now - t["at"] > TICKET_MIN * 60:
                return 403, {"error": "Type /lab in the channel to open the Lab.", "need": "lab"}
            if inst:
                _instances[inst] = t
                if len(_instances) > 500:
                    for k in sorted(_instances, key=lambda k: _instances[k]["at"])[:250]:
                        _instances.pop(k, None)
    return 200, {"token": make_pass(t.get("user") or ""), "player": t.get("player") or "", "sport": t.get("sport") or ""}


def browser_link(opts, user=""):
    site = bot.SITE.rstrip("/")
    if not site:
        return ""
    q = {"t": make_pass(user)}
    if opts.get("player"):
        q["player"] = opts["player"]
    if opts.get("sport"):
        q["sport"] = opts["sport"]
    return f"{site}/lab?{urllib.parse.urlencode(q)}"


def img_url(u):
    return f"/api/lab/img?u={urllib.parse.quote(u, safe='')}" if u else ""


def img(u):
    """-> (status, content_type, bytes)"""
    p = urllib.parse.urlparse(u or "")
    if p.scheme != "https" or p.hostname not in IMG_HOSTS:
        return 400, "text/plain", b"not allowed"
    with _lock:
        hit = _imgs.get(u)
    if hit:
        return 200, hit[0], hit[1]
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=12) as r:
            ct, data = r.headers.get("Content-Type") or "image/png", r.read(2_000_000)
    except Exception:
        return 404, "text/plain", b""
    if not ct.startswith("image/"):
        return 404, "text/plain", b""
    with _lock:
        _imgs[u] = (ct, data)
        if len(_imgs) > 150:
            for k in list(_imgs)[:75]:
                _imgs.pop(k, None)
    return 200, ct, data


# ---------- the data ----------
def _r(v, d=2):
    return None if v is None else round(v, d) if isinstance(v, float) else v


def player(sport, name):
    if sport not in bot.SPORTS:
        raise LookupError("Pick a sport.")
    if not (name or "").strip():
        raise LookupError("Type a player's name.")
    p = bot.load_player(sport, name.strip())
    if sport == "soccer":
        bot.soccer_deep(p, 20)
    sp = bot.stat_sport(sport)
    defs = bot.STAT[sp]
    games = []
    for g in p["games"][:82]:
        v = {}
        for k, sd in defs.items():
            try:
                x = sd["get"](g)
            except Exception:
                x = None
            if x is not None:
                v[k] = _r(x)
        if v:
            games.append({"id": g["id"], "date": g["date"].isoformat(), "opp": g["opp"], "oppAbbr": g.get("oppAbbr") or "", "home": g["home"],
                          "comp": g.get("comp") or "", "res": g.get("res") or "", "score": g.get("score") or "", "min": _r(g.get("min"), 1), "v": v})
    stats = [{"k": k, "l": sd["l"], "n": sum(1 for g in games if k in g["v"])} for k, sd in defs.items()]
    stats = [s for s in stats if s["n"]]
    lines = []
    try:
        n = bot.norm(p["name"])
        for x in bot.dfs_lines(sport).get("lines") or []:
            if bot.norm(x.get("player")) == n:
                k = bot.stat_key(sport, x.get("stat"))
                if k:
                    lines.append({"k": k, "line": x["line"], "book": x.get("book"), "kind": x.get("kind") or "standard", "pOver": x.get("pOver"),
                                  "opp": x.get("opp") or "", "start": x.get("start") or ""})
    except Exception:
        pass
    return {"sport": sport, "sportLabel": bot.SPORTS[sport], "name": p["name"], "team": p.get("team") or "", "photo": img_url(p.get("photo")),
            "seasonStart": bot.season_start(sport).isoformat(), "stats": stats, "games": games, "lines": lines, "at": int(time.time())}


def board(sport, count=24):
    if sport not in bot.SPORTS:
        raise LookupError("Pick a sport.")
    b = bot.memo(("labboard", sport), 900, lambda: bot.props_board(sport, None, count))
    rows = [{"player": r["player"], "team": r.get("team") or "", "opp": r.get("opp") or "", "k": r["k"], "label": r["label"], "line": r["line"],
             "side": r["side"], "l5": r["l5"]["pct"], "l10": r["l10"]["pct"], "l20": r["l20"]["pct"], "avg": _r(r["avg"]),
             "books": sorted({x["book"] for x in r["offers"]})} for r in b["rows"]]
    return {"sport": sport, "rows": rows, "checked": b["lines"], "errors": b["errors"]}


def handle(path, q, signed_in=False):
    """GET /api/lab/<path> -> (status, obj or (content_type, bytes))"""
    if path == "img":
        st, ct, data = img(q.get("u"))
        return st, (ct, data)
    if path == "session":
        return session(q, signed_in)
    if not signed_in and not check_pass(q.get("_pass")):
        return 401, {"error": "Your Lab pass expired. Type /lab in Discord again.", "need": "lab"}
    try:
        if path == "player":
            return 200, player(q.get("sport") or "nba", q.get("name") or "")
        if path == "board":
            return 200, board(q.get("sport") or "nba")
    except LookupError as e:
        return 404, {"error": str(e)}
    except Exception as e:
        print(f"lab: /{path} failed: {type(e).__name__}: {e}")
        return 502, {"error": "A data source didn't answer. Try again in a minute."}
    return 404, {"error": "unknown"}
