#!/usr/bin/env python3
"""Floodlight local server.

Serves the app and fetches the two sources a browser can't reach directly:
  /api/kalshi/<path>            Kalshi public market data (read-only, no account needed)
  /api/tm/squad?team=<name>     Transfermarkt squad: photos, market values, injuries, suspensions
  /api/tm/player?name=&club=    Transfermarkt player: photo, market value, value history, contract
  /api/fm/matchstats, /api/fm/player, /api/fm/playerstats   FotMob per-match and season player stats
  /api/bb/...                   basketball from Flashscore (see basketball.py)
  /api/bsb/...                  baseball from Flashscore: NPB, KBO, CPBL, Cuba (see baseball.py)
  /api/hk/...                   hockey from Flashscore, plus the NHL stats API (see hockey.py)
  /api/tn/...                   tennis from Flashscore: ATP, WTA, Grand Slams, Challengers, ITF (see tennis.py)

Responses are cached in memory so each page is fetched at most once per cache window.
Run:  python3 server.py   then open http://localhost:8642
"""
import os
import sys

if (os.environ.get("PORT") or os.environ.get("RENDER")) and not os.environ.get("MALLOC_ARENA_MAX"):
    # Each thread would otherwise get its own memory pool, which on a 512 MB host adds up fast.
    os.environ["MALLOC_ARENA_MAX"] = "2"
    os.execv(sys.executable, [sys.executable] + sys.argv)

import datetime
import gzip
import hashlib
import hmac
import html
import json
import secrets
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import baseball
import basketball
import hockey
import tennis
import boxing
import forecaster
import dfs
import odds
import linehist
import ufcdata
import storage
import discord_bot
import lab
import record
import propbook

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
LAN = "--lan" in sys.argv          # --lan: also accept connections from phones on the same Wi-Fi
import os
PORT = int(ARGS[0]) if ARGS else int(os.environ.get("PORT", 8642))
# Hosted mode (e.g. Render): listen on all interfaces, mark cookies Secure, lock down admin settings.
HOSTED = bool(os.environ.get("PORT") or os.environ.get("RENDER"))
ADMIN = (os.environ.get("FLOODLIGHT_ADMIN") or "").strip().lower()
ADMIN_PASSWORD = os.environ.get("FLOODLIGHT_ADMIN_PASSWORD") or ""
# Members only: when hosted, people need an account the admin has approved before they see any data.
GATED = HOSTED and os.environ.get("FLOODLIGHT_OPEN", "") != "1"
ROLES = ("pending", "viewer", "research")
# What a brand-new account can do on the hosted site. "viewer" lets people create an account and get straight in to the
# games; research stays something the admin grants. Set FLOODLIGHT_SIGNUP_ROLE=pending to approve every member by hand.
SIGNUP_ROLE = os.environ.get("FLOODLIGHT_SIGNUP_ROLE", "viewer")
if SIGNUP_ROLE not in ROLES:
    SIGNUP_ROLE = "viewer"
_signups = {}   # address -> times of recent sign-ups, so one visitor can't create accounts in bulk


def signup_allowed(addr):
    now = time.time()
    recent = [t for t in _signups.get(addr, []) if now - t < 3600]
    if len(recent) >= 5:
        _signups[addr] = recent
        return False
    recent.append(now)
    _signups[addr] = recent
    if len(_signups) > 5000:
        for k in [k for k, v in _signups.items() if not v or now - v[-1] > 3600]:
            _signups.pop(k, None)
    return True
# Only these files are served to browsers; everything else (Python code, the cache folder with
# accounts and the API key) stays private.
PUBLIC_FILES = {"index.html", "recent.js", "linemove.js", "alerts.js", "share.js", "onboard.js", "manifest.webmanifest", "baseball.js", "basketball.js", "books.js", "football.js",
                "forecast.js", "hockey.js", "predfilter.js", "research.js", "tennis.js", "access.js", "record.js", "theme.css", "fx.js",
                "arena.css", "shell.js", "dates.js", "cards.js", "predict.js", "sportfx.js", "boxing.js", "home.js", "statfx.js", "ufc.js", "palette.js", "whatif.js",
                "tokens.css", "themes.css", "pages.js", "settings.js", "heat.js", "heat.css", "labskin.css", "pages.css", "guide.js", "meter.js", "edge.js", "live.js", "labpage.js", "labtools.js", "slate.js", "predictions.js", "profile.js", "fighter.js", "transfers.js", "members.js", "parlaycore.js", "parlays.js", "me.js", "matchcentre.js", "evidence.js", "history.js", "search.js",
                "stadium-wide.webp", "stadium-pitch.webp"}
ROOT = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/"
TM = "https://www.transfermarkt.com"
TMAPI = "https://tmapi-alpha.transfermarkt.technology"

_cache = {}
_lock = threading.Lock()

# Transfermarkt rate-limits busy clients, so its requests go one or two at a time with a short gap,
# and after a "too many requests" answer everything waits a few minutes instead of retrying.
_tm_gate = threading.Semaphore(2)
_tm_state = {"last": 0.0, "cool_until": 0.0}
_tm_lock = threading.Lock()


class Cooling(Exception):
    pass


def _is_tm(url):
    return "transfermarkt" in url


def _read(r):
    raw = r.read()
    if r.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def fetch(url, ttl, as_json=False):
    now = time.time()
    with _lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < ttl:
            return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json" if as_json else "text/html,*/*",
                                               "Accept-Language": "en-GB,en;q=0.9"})
    if _is_tm(url):
        if time.time() < _tm_state["cool_until"]:
            raise Cooling("Transfermarkt asked us to slow down; trying again shortly")
        with _tm_gate:
            with _tm_lock:
                wait = _tm_state["last"] + 0.6 - time.time()
                _tm_state["last"] = max(time.time(), _tm_state["last"] + 0.6)
            if wait > 0:
                time.sleep(wait)
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    body = _read(r)
            except urllib.error.HTTPError as e:
                if e.code in (429, 403):
                    _tm_state["cool_until"] = time.time() + 180
                raise
    else:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = _read(r)
    data = json.loads(body) if as_json else body
    with _lock:
        _cache[url] = (now, data)
        if len(_cache) > 2000:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:500]:
                _cache.pop(k, None)
    return data


# ---------- photo index (saved to disk, so a player's photo is looked up once) ----------

CACHE_DIR = ROOT / ".floodlight-cache"
PHOTO_FILE = CACHE_DIR / "photos.json"
_photos = {}
_photo_lock = threading.Lock()
_photo_dirty = {"n": 0}
try:
    _photos = json.loads(PHOTO_FILE.read_text())
except Exception:
    _photos = {}


def remember_photo(name, club, url):
    if not name or not url or "default" in url:
        return
    key = norm(name)
    with _photo_lock:
        entry = _photos.setdefault(key, {})
        if entry.get(norm(club or "")) != url:
            entry[norm(club or "")] = url
            _photo_dirty["n"] += 1
        if _photo_dirty["n"] >= 25:
            save_photos()


def save_photos():
    try:
        CACHE_DIR.mkdir(exist_ok=True)
        PHOTO_FILE.write_text(json.dumps(_photos))
        _photo_dirty["n"] = 0
    except Exception:
        pass


def known_photo(name, club=""):
    entry = _photos.get(norm(name))
    if not entry:
        return None
    if club:
        for c, url in entry.items():
            if c and (c == norm(club) or c in norm(club) or norm(club) in c):
                return url
    urls = set(entry.values())
    return next(iter(urls)) if len(urls) == 1 or not club else next(iter(entry.values()))


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\b(fc|cf|afc|sc|ac|club|de|cd|ud|sk|fk|bk|ss|as|calcio|football|futbol|1\.)\b", " ", s)
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def similar(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0
    if a == b:
        return 1
    if a in b or b in a:
        return 0.85
    ta, tb = set(a.split()), set(b.split())
    return len(ta & tb) / max(len(ta | tb), 1)


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def money(text):
    """'€60.00m' -> 60000000"""
    m = re.match(r"€\s*([\d.,]+)\s*(bn|m|k|Th\.)?", (text or "").strip())
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    return int(n * {"bn": 1e9, "m": 1e6, "k": 1e3, "Th.": 1e3}.get(m.group(2) or "", 1))


# ---------- Transfermarkt ----------

def tm_search(query):
    page = fetch(f"{TM}/schnellsuche/ergebnis/schnellsuche?query={urllib.parse.quote(query)}", 86400)
    clubs = [{"name": html.unescape(n), "slug": s, "id": i}
             for n, s, i in re.findall(r'title="([^"]+)" href="/([^"/]+)/startseite/verein/(\d+)"', page)]
    for c in clubs:
        c["crest"] = f"https://img.a.transfermarkt.technology/wappen/head/{c['id']}.png"
    players = []
    for row in re.split(r'<tr class="(?:odd|even)">', page)[1:]:
        m = re.search(r'title="([^"]+)" href="/([^"/]+)/profil/spieler/(\d+)"', row)
        if not m or any(p["id"] == m.group(3) for p in players):
            continue
        photo = re.search(r'src="(https://img\.a\.transfermarkt\.technology/portrait/[^"]+)"', row)
        club = re.search(r'<a title="([^"]+)" href="/[^"/]+/startseite/verein/\d+"', row)
        url = photo.group(1).replace("/small/", "/big/") if photo else ""
        players.append({"name": html.unescape(m.group(1)), "slug": m.group(2), "id": m.group(3),
                        "club": html.unescape(club.group(1)) if club else "",
                        "photo": "" if "default" in url else url})
        remember_photo(players[-1]["name"], players[-1]["club"], players[-1]["photo"])
    return clubs, players


def find_club(team):
    clubs, _ = tm_search(team)
    clubs = [c for c in clubs if not re.search(r"\b(U\d{2}|II|B|Youth|Reserves?|Women|Fem)\b", c["name"])] or clubs
    best = max(clubs, key=lambda c: similar(team, c["name"]), default=None)
    return best if best and similar(team, best["name"]) >= 0.3 else (clubs[0] if clubs else None)


def status_of(cell):
    for title, cls in re.findall(r'<span title="([^"]+)" class="([^"]+)"', cell):
        t = html.unescape(title)
        if "verletzt" in cls:
            return {"kind": "injured", "text": t}
        if "suspension" in cls or "gesperrt" in cls or "rote-karte" in cls:
            return {"kind": "suspended", "text": t}
        if "ausfall" in cls or "abwesend" in cls:
            return {"kind": "absent", "text": t}
    return None


def tm_squad(team):
    club = find_club(team)
    if not club:
        return {"error": "club not found"}
    page = fetch(f"{TM}/{club['slug']}/kader/verein/{club['id']}/plus/1", 3600)
    total = re.search(r'data-header__market-value-wrapper">\s*(?:<span[^>]*>)?([^<]+)<span[^>]*>([^<]+)</span>\s*<span[^>]*>([^<]+)', page)
    rows = re.split(r'<tr class="(?:odd|even)">', page)[1:]
    players = []
    for row in rows:
        pid = re.search(r'/profil/spieler/(\d+)"', row)
        if not pid:
            continue
        name = re.search(r'/profil/spieler/\d+">\s*([^<]+)', row)
        photo = re.search(r'data-src="(https://img\.a\.transfermarkt\.technology/portrait/[^"]+)"', row)
        pos = re.search(r'</tr>\s*<tr>\s*<td>\s*([^<]+?)\s*</td>', row)
        num = re.search(r'rn_nummer>([^<]*)<', row)
        dob = re.search(r'<td class="zentriert">(\d{2}/\d{2}/\d{4}) \((\d+)\)</td>', row)
        nats = re.findall(r'flagge/verysmall/\d+\.png[^"]*" title="([^"]+)"', row)
        val = re.search(r'<td class="rechts hauptlink"><a[^>]*>([^<]+)</a>\s*(?:<span title="([^"]*)" class="icons_sprite ([a-z]+)-arrow)?', row)
        value_text = val.group(1).strip() if val else ""
        prev_text = (val.group(2) or "").replace("Previous market value: ", "") if val else ""
        trend = {"green": "up", "red": "down"}.get(val.group(3) if val else "", "same")
        players.append({
            "tmId": pid.group(1),
            "name": html.unescape(name.group(1).strip()) if name else "",
            "number": (num.group(1).strip() if num else "").replace("-", ""),
            "position": html.unescape(pos.group(1)) if pos else "",
            "photo": photo.group(1).replace("/medium/", "/big/") if photo else "",
            "age": int(dob.group(2)) if dob else None,
            "nationality": [html.unescape(n) for n in nats],
            "value": money(value_text), "valueText": value_text,
            "previousText": prev_text, "previous": money(prev_text), "trend": trend,
            "status": status_of(row),
        })
        remember_photo(players[-1]["name"], club["name"], players[-1]["photo"])
    total_text = "".join(strip(x) for x in total.groups()) if total else ""
    return {"club": club, "url": f"{TM}/{club['slug']}/kader/verein/{club['id']}", "totalText": total_text,
            "players": players, "fetched": int(time.time())}


def tm_player(name, club=""):
    _, players = tm_search(name)
    if not players:
        return {"error": "player not found"}
    best = max(players, key=lambda p: similar(name, p["name"]) * 2 + (similar(club, p["club"]) if club else 0))
    pid = best["id"]
    data = fetch(f"{TMAPI}/player/{pid}", 3600, as_json=True).get("data", {})
    hist = []
    try:
        h = fetch(f"{TMAPI}/player/{pid}/market-value-history", 3600, as_json=True).get("data", {}).get("history", [])
        for x in h:
            mv = x.get("marketValue") or {}
            hist.append({"date": x.get("determined") or mv.get("determined") or "", "value": mv.get("value"), "clubId": x.get("clubId"), "age": x.get("age")})
    except Exception:
        pass
    if not hist:
        try:
            g = fetch(f"{TM}/ceapi/marketValueDevelopment/graph/{pid}", 3600, as_json=True)
            hist = [{"date": time.strftime("%Y-%m-%d", time.gmtime(p["x"] / 1000)), "value": p["y"], "club": p.get("verein")} for p in g.get("list", [])]
        except Exception:
            pass
    mv = data.get("marketValueDetails") or {}
    attrs = data.get("attributes") or {}
    return {
        "tmId": pid, "name": data.get("name") or best["name"], "url": TM + (data.get("relativeUrl") or f"/x/profil/spieler/{pid}"),
        "photo": data.get("portraitUrl") or "", "current": mv.get("current"), "previous": mv.get("previous"),
        "highest": mv.get("highest"), "delta": mv.get("delta"),
        "contractUntil": attrs.get("contractUntil"), "foot": (attrs.get("preferredFoot") or {}).get("name"),
        "height": attrs.get("height"), "formerClubs": attrs.get("formerClubsNote"),
        "history": [x for x in hist if x.get("value")], "fetched": int(time.time()),
    }


# ---------- Transfermarkt transfers ----------

def transfer_rows(section, with_age=True):
    out = []
    for row in re.split(r'<tr class="(?:odd|even)">', section)[1:]:
        pid = re.search(r'/profil/spieler/(\d+)"', row)
        if not pid:
            continue
        name = re.search(r'<a title="([^"]+)" href="/[^"]+/profil/spieler/\d+"', row)
        photo = re.search(r'data-src="(https://img\.a\.transfermarkt\.technology/portrait/[^"]+)"', row)
        pos = re.search(r'</tr>\s*<tr>\s*<td>\s*([^<]+?)\s*</td>', row)
        age = re.search(r'<td class="zentriert">(\d{1,2})</td>', row)
        nats = re.findall(r'flagge/verysmall/\d+\.png[^"]*" title="([^"]+)" alt="[^"]*" class="flaggenrahmen"', row)
        club = re.search(r'<a title="([^"]+)" href="/[^"/]+/startseite/verein/(\d+)', row)
        league = re.search(r'href="/[^"/]+/transfers/wettbewerb/[^"]+">([^<]+)</a>', row)
        fees = re.findall(r'<td class="rechts hauptlink">(.*?)</td>', row, re.S)
        fee = strip(fees[-1]) if fees else ""
        out.append({
            "tmId": pid.group(1), "name": html.unescape(name.group(1)) if name else "",
            "photo": photo.group(1) if photo else "", "position": html.unescape(pos.group(1)) if pos else "",
            "age": int(age.group(1)) if age and with_age else None, "nationality": list(dict.fromkeys(html.unescape(n) for n in nats))[:2],
            "club": html.unescape(club.group(1)) if club else "Without club", "clubId": club.group(2) if club else None,
            "league": html.unescape(league.group(1)) if league else "", "fee": fee, "feeValue": money(fee),
        })
    return out


def tm_club_transfers(team, season):
    club = find_club(team)
    if not club:
        return {"error": "club not found"}
    page = fetch(f"{TM}/{club['slug']}/transfers/verein/{club['id']}/saison_id/{season}", 6 * 3600)
    pos = lambda word: (re.search(r"<h2[^>]*>\s*(?:<[^>]+>\s*)*" + word, page) or re.search(">\s*" + word + "\s*<", page))
    a, d = [(m.start() if m else -1) for m in (pos("Arrivals"), pos("Departures"))]
    end = page.find("transfer-record__", d if d > 0 else 0)
    arrivals = transfer_rows(page[a:d]) if a > 0 and d > a else []
    departures = transfer_rows(page[d:end if end > d else None]) if d > 0 else []
    tot = lambda k: (re.search(k + r'.*?transfer-record__total[^>]*>(.*?)</td>', page, re.S) or [None, ""])[1]
    return {"club": club, "season": int(season), "arrivals": arrivals, "departures": departures,
            "spent": strip(tot("Expenditure")), "income": strip(tot("Income")), "balance": strip(tot("Overall balance")),
            "url": f"{TM}/{club['slug']}/transfers/verein/{club['id']}/saison_id/{season}"}


def tm_top_transfers(season, page_no):
    page = fetch(f"{TM}/transfers/transferrekorde/statistik/top/plus/0/galerie/0/page/{page_no}?saison_id={season}", 12 * 3600)
    rows = transfer_rows(page[page.find('<table class="items">'):], with_age=False)
    return {"season": int(season), "page": int(page_no), "transfers": rows}


def feed_club(block):
    """One club cell of a transfer list: name, id, and the league or country line under it."""
    link = re.search(r'<a title="([^"]+)" href="/[^"/]+/startseite/verein/(\d+)', block)
    if link:
        name, cid = html.unescape(link.group(1)), link.group(2)
    else:
        m = re.search(r'<td class="hauptlink">\s*([^<]+?)\s*</td>', block)
        name, cid = (html.unescape(m.group(1)) if m else ""), None
    half = len(name) // 2
    if len(name) % 2 == 0 and name[:half] == name[half:]:
        name = name[:half]  # "Without ClubWithout Club"
    league = re.search(r'href="/[^"/]+/transfers/wettbewerb/[^"]+">([^<]+)</a>', block)
    country = re.search(r'title="([^"]+)" alt="[^"]*" class="flaggenrahmen"', block)
    return {"name": name, "id": cid, "league": html.unescape(league.group(1)) if league else "",
            "country": html.unescape(country.group(1)) if country else ""}


def feed_rows(page, day=None):
    out = []
    for row in re.split(r'<tr class="(?:odd|even)">', page)[1:]:
        pid = re.search(r'title="([^"]+)" href="/[^"/]+/profil/spieler/(\d+)"', row)
        if not pid:
            continue
        blocks = row.split('<table class="inline-table">')
        photo = re.search(r'(?:src|data-src)="(https://img\.a\.transfermarkt\.technology/portrait/[^"]+)"', row)
        pos = re.search(r'</tr>\s*<tr>\s*<td>\s*([^<]+?)\s*</td>', blocks[1] if len(blocks) > 1 else row)
        age = re.search(r'</table>\s*</td><td class="zentriert">(\d{1,2})</td>', row)
        first_end = row.find('</table>')  # nationality flags sit between the player cell and the first club cell
        nats = re.findall(r'flagge/verysmall/\d+\.png[^"]*" title="([^"]+)" alt="[^"]*" class="flaggenrahmen"', row[first_end:row.find('<table class="inline-table">', first_end)])
        date = re.search(r'<td class="zentriert">(\d{2})/(\d{2})/(\d{4})</td>', row)
        mv = re.findall(r'<td class="rechts">([^<]*)</td>', row)
        fee = re.findall(r'<td class="rechts hauptlink">(.*?)</td>', row, re.S)
        tid = re.search(r'transfer_id/(\d+)', row)
        fee_text = strip(fee[-1]) if fee else ""
        url = photo.group(1).replace("/medium/", "/big/").replace("/small/", "/big/") if photo else ""
        out.append({
            "id": tid.group(1) if tid else pid.group(2) + (day or ""),
            "tmId": pid.group(2), "name": html.unescape(pid.group(1)), "photo": "" if "default" in url else url,
            "position": html.unescape(pos.group(1)) if pos else "", "age": int(age.group(1)) if age else None,
            "nationality": list(dict.fromkeys(html.unescape(n) for n in nats))[:2],
            "from": feed_club(blocks[2]) if len(blocks) > 2 else {}, "to": feed_club(blocks[3]) if len(blocks) > 3 else {},
            "date": f"{date.group(3)}-{date.group(2)}-{date.group(1)}" if date else (day or ""),
            "marketValue": mv[-1].strip() if mv else "", "marketValueValue": money(mv[-1]) if mv else None,
            "fee": fee_text, "feeValue": money(fee_text),
        })
        remember_photo(out[-1]["name"], out[-1]["to"].get("name"), out[-1]["photo"])
    return out


def tm_feed(kind, day, page_no):
    if kind == "day":
        url = f"{TM}/transfers/transfertagedetail/statistik/top/land_id_ab//land_id_zu//leihe//datum/{day}/plus/1/galerie/0/page/{page_no}"
        ttl = 600 if day >= time.strftime("%Y-%m-%d", time.gmtime(time.time() - 3 * 86400)) else 7 * 86400
    else:
        url = f"{TM}/transfers/neuestetransfers/statistik/plus/plus/1/galerie/0/wettbewerb_id/alle/land_id//minMarktwert/0/maxMarktwert/500.000.000/page/{page_no}"
        ttl = 120  # the latest-transfers list is re-read at most every two minutes
    page = fetch(url, ttl)
    pages = max([int(n) for n in re.findall(r'/page/(\d+)', page)] + [page_no])
    return {"kind": kind, "day": day, "page": page_no, "pages": pages, "transfers": feed_rows(page, day if kind == "day" else None),
            "fetched": int(time.time())}


def tm_text(x):
    """Transfermarkt sometimes puts markup in a field ("Loan fee:<br /><i>€3.50m</i>"); keep only the words."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip() if isinstance(x, str) else x


def tm_player_transfers(name, club=""):
    _, players = tm_search(name)
    if not players:
        return {"error": "player not found"}
    best = max(players, key=lambda p: similar(name, p["name"]) * 2 + (similar(club, p["club"]) if club else 0))
    d = fetch(f"{TM}/ceapi/transferHistory/list/{best['id']}", 6 * 3600, as_json=True)
    rows = []
    for t in d.get("transfers", []):
        cid = lambda side: (re.search(r"/verein/(\d+)", t.get(side, {}).get("href") or "") or [None, None])[1]
        rows.append({"date": t.get("dateUnformatted") or t.get("date"), "season": t.get("season"),
                     "from": t.get("from", {}).get("clubName"), "fromId": cid("from"),
                     "to": t.get("to", {}).get("clubName"), "toId": cid("to"),
                     "marketValue": t.get("marketValue"), "fee": tm_text(t.get("fee")), "upcoming": bool(t.get("upcoming"))})
    return {"tmId": best["id"], "transfers": rows, "total": d.get("formattedFeeSum")}


# ---------- FotMob predicted lineups ----------

FM = "https://www.fotmob.com"


def fm_find_match(date, home, away):
    """The FotMob match closest to (date, home, away), looking a day either side for timezone drift."""
    best, score = None, 0
    for day in (date, (datetime_shift(date, -1)), (datetime_shift(date, 1))):
        data = fetch(f"{FM}/api/data/matches?date={day}", 600, as_json=True) or {}
        for lg in data.get("leagues", []):
            for m in lg.get("matches", []):
                h, a = m.get("home", {}), m.get("away", {})
                s = max(similar(home, h.get("longName") or h.get("name")), similar(home, h.get("name"))) + \
                    max(similar(away, a.get("longName") or a.get("name")), similar(away, a.get("name")))
                if s > score:
                    best, score = m, s
        if score >= 1.6:
            break
    return best if best and score >= 1.1 else None


def fm_lineup(date, home, away):
    best = fm_find_match(date, home, away)
    if not best:
        return {"error": "match not found on FotMob"}
    page = fetch(f"{FM}/match/{best['id']}", 600)
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
    if not m:
        return {"error": "no lineup data"}
    lu = (json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("content") or {}).get("lineup") or {}

    def team(t):
        if not t:
            return None
        pl = lambda p: {"id": p.get("id"), "name": p.get("name"), "last": p.get("lastName"), "number": p.get("shirtNumber"), "age": p.get("age"),
                        "country": p.get("countryName"), "value": p.get("marketValue"),
                        "x": (p.get("horizontalLayout") or {}).get("x"), "y": (p.get("horizontalLayout") or {}).get("y")}
        return {"name": t.get("name"), "formation": t.get("formation"), "coach": (t.get("coach") or {}).get("name"),
                "starters": [pl(p) for p in t.get("starters") or []], "subs": [pl(p) for p in t.get("subs") or []],
                "unavailable": [{"name": p.get("name"), "type": (p.get("unavailability") or {}).get("type"),
                                 "expectedReturn": (p.get("unavailability") or {}).get("expectedReturn")}
                                for p in t.get("unavailable") or []]}
    return {"type": lu.get("lineupType"), "source": lu.get("source"), "home": team(lu.get("homeTeam")),
            "away": team(lu.get("awayTeam")), "url": f"{FM}/match/{best['id']}", "fetched": int(time.time())}


def datetime_shift(ymd, days):
    t = time.mktime(time.strptime(ymd, "%Y%m%d")) + days * 86400 + 3600
    return time.strftime("%Y%m%d", time.localtime(t))


FM_IMG = "https://images.fotmob.com/image_resources"


def fm_suggest(term):
    data = fetch(f"{FM}/api/data/search/suggest?term={urllib.parse.quote(term)}&lang=en", 86400, as_json=True) or []
    return [x for g in data for x in g.get("suggestions", [])]


def fm_player_photo(name, club=""):
    """FotMob head-and-shoulders cut-out for a player, matched on name (and club when given)."""
    best, score = None, 0
    for x in fm_suggest(name):
        if x.get("type") != "player" or x.get("isCoach"):
            continue
        sc = similar(name, x.get("name")) * 2 + (similar(club, x.get("teamName")) if club else 0)
        if sc > score:
            best, score = x, sc
    if best and similar(name, best.get("name")) >= 0.5:
        return f"{FM_IMG}/playerimages/{best['id']}.png"
    return ""


def fm_player_value(name, club=""):
    """Market value from FotMob's squad list, for when Transfermarkt refuses us."""
    teams = []
    if club:
        teams.append(club)
    for x in fm_suggest(name):
        if x.get("type") == "player" and not x.get("isCoach") and similar(name, x.get("name")) >= 0.5 and x.get("teamName"):
            teams.append(x["teamName"])
    seen = set()
    for t in teams:
        if norm(t) in seen:
            continue
        seen.add(norm(t))
        try:
            team = fm_team(t)
        except Exception:
            continue
        best = max(team.get("squad") or [], key=lambda m: similar(name, m.get("name")), default=None)
        if best and similar(name, best.get("name")) >= 0.5 and best.get("value"):
            return {"tmId": f"fm{best['fmId']}", "source": "FotMob", "name": best.get("name"),
                    "url": f"{FM}/players/{best['fmId']}", "photo": best.get("photo") or "",
                    "current": {"value": best["value"], "determined": ""}, "history": [], "fetched": int(time.time())}
    return None


def fm_team_id(name):
    best, score = None, 0
    for x in fm_suggest(name):
        if x.get("type") != "team":
            continue
        sc = similar(name, x.get("name"))
        if sc > score:
            best, score = x, sc
    return best["id"] if best and score >= 0.5 else None


def tm_photo(name, club=""):
    """Best head-and-shoulders portrait: one we've already seen, then FotMob, then Transfermarkt."""
    hit = known_photo(name, club)
    if hit:
        return hit
    try:
        url = fm_player_photo(name, club)
        if url:
            remember_photo(name, club, url)
            return url
    except Exception:
        pass
    if time.time() < _tm_state["cool_until"]:
        raise Cooling("cooling down")
    _, players = tm_search(name)
    if not players:
        return ""
    best = max(players, key=lambda p: similar(name, p["name"]) * 2 + (similar(club, p["club"]) if club else 0))
    return best["photo"] if similar(name, best["name"]) >= 0.5 else ""


def tm_crest(team):
    try:
        tid = fm_team_id(team)
        if tid:
            return f"{FM_IMG}/logo/teamlogo/{tid}.png"
    except Exception:
        pass
    club = find_club(team)
    return club and f"https://img.a.transfermarkt.technology/wappen/head/{club['id']}.png"


# ---------- FotMob squads and league leaders (fills gaps in ESPN, e.g. the Israeli league) ----------

FM_LEAGUES = {"isr.1": 127, "eng.1": 47, "esp.1": 87, "ger.1": 54, "ita.1": 55, "fra.1": 53, "por.1": 61, "ned.1": 57,
              "sco.1": 64, "tur.1": 71, "eng.2": 48, "usa.1": 130, "mex.1": 230, "bra.1": 268, "arg.1": 112, "ksa.1": 536,
              "uefa.champions": 42, "uefa.europa": 73, "uefa.europa.conf": 10216}
GROUPS = {"keepers": "G", "defenders": "D", "midfielders": "M", "attackers": "F"}


def fm_score(txt):
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", txt or "")
    return [int(m.group(1)), int(m.group(2))] if m else None


def fm_fixture(x):
    """One FotMob fixture in a compact shape the app understands."""
    st = x.get("status") or {}
    h, a = x.get("home") or {}, x.get("away") or {}
    score = fm_score(st.get("scoreStr"))
    if score is None and (st.get("started") or st.get("finished")) and h.get("score") is not None:
        score = [h.get("score"), a.get("score")]
    team = lambda t: {"id": str(t.get("id")), "name": t.get("name"), "short": t.get("shortName") or t.get("name"),
                      "logo": f"{FM_IMG}/logo/teamlogo/{t.get('id')}.png"}
    return {"id": str(x.get("id")), "round": x.get("round") or x.get("roundName"), "utc": st.get("utcTime"),
            "home": team(h), "away": team(a), "score": score, "started": bool(st.get("started")),
            "finished": bool(st.get("finished")), "cancelled": bool(st.get("cancelled")),
            "live": ((st.get("liveTime") or {}).get("short") if isinstance(st.get("liveTime"), dict) else None),
            "reason": ((st.get("reason") or {}).get("short") if isinstance(st.get("reason"), dict) else None),
            "tbd": bool(st.get("matchDateTbd"))}


def fm_league_fixtures(lid, season=""):
    """Every match of one league season (season like 2024/2025, or 2025 for calendar-year leagues); empty = the current one."""
    q = f"&season={urllib.parse.quote(season)}" if season else ""
    d = fetch(f"{FM}/api/data/leagues?id={lid}{q}", 6 * 3600 if season else 600, as_json=True) or {}
    fx = (d.get("fixtures") or {}).get("allMatches") or (d.get("matches") or {}).get("allMatches") or []
    return {"id": lid, "season": season, "fixtures": [fm_fixture(x) for x in fx], "fetched": int(time.time())}


def fm_league(lid):
    d = fetch(f"{FM}/api/data/leagues?id={lid}", 60, as_json=True) or {}
    tbl = ((d.get("table") or [{}])[0].get("data") or {})
    rows = ((tbl.get("table") or {}).get("all")) or []
    legend = tbl.get("legend") or []
    return {"id": lid, "name": (d.get("details") or {}).get("name"), "logo": f"{FM_IMG}/logo/leaguelogo/{lid}.png",
            "season": (d.get("details") or {}).get("selectedSeason"),
            "table": [{"rank": r.get("idx"), "id": str(r.get("id")), "name": r.get("name"), "short": r.get("shortName"),
                       "played": r.get("played"), "wins": r.get("wins"), "draws": r.get("draws"), "losses": r.get("losses"),
                       "goals": r.get("scoresStr"), "gd": r.get("goalConDiff"), "pts": r.get("pts"), "color": r.get("qualColor"),
                       "logo": f"{FM_IMG}/logo/teamlogo/{r.get('id')}.png"} for r in rows],
            "legend": [{"title": x.get("title"), "color": x.get("color")} for x in legend],
            "fixtures": [fm_fixture(x) for x in (d.get("fixtures") or {}).get("allMatches") or []], "fetched": int(time.time())}


def fm_match(mid):
    page = fetch(f"{FM}/match/{mid}", 30, as_json=False)
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
    if not m:
        return {"error": "match not found"}
    pp = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    hd, gen, c = pp.get("header") or {}, pp.get("general") or {}, pp.get("content") or {}
    st = hd.get("status") or {}
    teams = [{"id": str(t.get("id")), "name": t.get("name"), "score": t.get("score"), "logo": f"{FM_IMG}/logo/teamlogo/{t.get('id')}.png"} for t in hd.get("teams") or []]
    evs = []
    for e in ((c.get("matchFacts") or {}).get("events") or {}).get("events") or []:
        sw = e.get("swap") or []
        evs.append({"type": e.get("type"), "time": e.get("time"), "added": e.get("overloadTime"), "isHome": e.get("isHome"),
                    "player": e.get("nameStr") or (e.get("player") or {}).get("name"), "assist": e.get("assistStr"),
                    "card": e.get("card"), "ownGoal": e.get("ownGoal"), "penalty": e.get("goalDescription") or e.get("isPenalty"),
                    "in": sw[0].get("name") if len(sw) > 0 else None, "out": sw[1].get("name") if len(sw) > 1 else None,
                    "homeScore": e.get("homeScore"), "awayScore": e.get("awayScore")})
    groups = []
    for g in (((c.get("stats") or {}).get("Periods") or {}).get("All") or {}).get("stats") or []:
        rows = [{"title": x.get("title"), "key": x.get("key"), "home": (x.get("stats") or [None, None])[0], "away": (x.get("stats") or [None, None])[1]}
                for x in g.get("stats") or [] if x.get("type") != "title" and x.get("stats")]
        if rows:
            groups.append({"title": g.get("title"), "rows": rows})
    info = (c.get("matchFacts") or {}).get("infoBox") or {}
    venue = ((info.get("Stadium") or {}).get("name")) if isinstance(info.get("Stadium"), dict) else None
    lu = c.get("lineup") or {}
    pl = lambda p: {"id": p.get("id"), "name": p.get("name"), "last": p.get("lastName"), "number": p.get("shirtNumber"), "age": p.get("age"),
                    "country": p.get("countryName"), "value": p.get("marketValue"),
                    "x": (p.get("horizontalLayout") or {}).get("x"), "y": (p.get("horizontalLayout") or {}).get("y")}
    team_lu = lambda t: t and {"name": t.get("name"), "formation": t.get("formation"), "coach": (t.get("coach") or {}).get("name"),
                               "starters": [pl(p) for p in t.get("starters") or []], "subs": [pl(p) for p in t.get("subs") or []],
                               "unavailable": [{"name": p.get("name"), "type": (p.get("unavailability") or {}).get("type"),
                                                "expectedReturn": (p.get("unavailability") or {}).get("expectedReturn")} for p in t.get("unavailable") or []]}
    return {"id": str(mid), "league": {"id": gen.get("leagueId"), "name": gen.get("leagueName")}, "round": gen.get("matchRound"),
            "utc": st.get("utcTime"), "started": bool(st.get("started")), "finished": bool(st.get("finished")),
            "cancelled": bool(st.get("cancelled")), "live": (st.get("liveTime") or {}).get("short") if isinstance(st.get("liveTime"), dict) else None,
            "reason": (st.get("reason") or {}).get("short") if isinstance(st.get("reason"), dict) else None,
            "teams": teams, "colors": ((gen.get("teamColors") or {}).get("darkMode") or {}), "events": evs, "stats": groups,
            "venue": venue, "referee": ((info.get("Referee") or {}).get("text")) if isinstance(info.get("Referee"), dict) else None,
            "attendance": info.get("Attendance"),
            "lineup": {"type": lu.get("lineupType"), "home": team_lu(lu.get("homeTeam")), "away": team_lu(lu.get("awayTeam"))},
            "url": f"{FM}/match/{mid}", "fetched": int(time.time())}


def fm_team(name, tid=None):
    tid = tid or fm_team_id(name)
    if not tid:
        return {"error": "team not found on FotMob"}
    d = fetch(f"{FM}/api/data/teams?id={tid}", 600, as_json=True) or {}
    squad, coach = [], None
    for grp in (d.get("squad") or {}).get("squad") or []:
        g = GROUPS.get(grp.get("title"))
        for m in grp.get("members") or []:
            if grp.get("title") == "coach":
                coach = m.get("name")
                continue
            inj = m.get("injury") or None
            photo = f"{FM_IMG}/playerimages/{m['id']}.png"
            remember_photo(m.get("name"), (d.get("details") or {}).get("name"), photo)
            squad.append({"fmId": m.get("id"), "name": m.get("name"), "number": m.get("shirtNumber"), "group": g,
                          "position": m.get("positionIdsDesc") or (m.get("role") or {}).get("fallback"),
                          "country": m.get("cname"), "age": m.get("age"), "height": m.get("height"),
                          "value": m.get("transferValue"), "goals": m.get("goals"), "assists": m.get("assists"),
                          "yellow": m.get("ycards"), "red": m.get("rcards"), "rating": (m.get("rating") or {}).get("num") if isinstance(m.get("rating"), dict) else m.get("rating"),
                          "injury": {"text": inj.get("expectedReturn") or inj.get("injuryType") or "Injured"} if isinstance(inj, dict) else ({"text": "Injured"} if inj else None),
                          "photo": photo})
    det = d.get("details") or {}
    fixtures = []
    for x in ((d.get("fixtures") or {}).get("allFixtures") or {}).get("fixtures") or []:
        f = fm_fixture(x)
        f["tournament"] = (x.get("tournament") or {}).get("name")
        f["leagueId"] = (x.get("tournament") or {}).get("leagueId")
        if x.get("home", {}).get("score") is not None and (x.get("status") or {}).get("finished"):
            f["score"] = [x["home"]["score"], x["away"]["score"]]
        fixtures.append(f)
    return {"id": str(tid), "name": det.get("name") or name, "crest": f"{FM_IMG}/logo/teamlogo/{tid}.png", "coach": coach,
            "squad": squad, "fixtures": fixtures, "leagueId": (d.get("fixtures") or {}).get("primaryTournamentId"),
            "url": f"{FM}/teams/{tid}/squad", "fetched": int(time.time())}


def fm_leaders(slug, name=""):
    lid = FM_LEAGUES.get(slug)
    if not lid and name:
        lid = next((x["id"] for x in fm_suggest(name) if x.get("type") == "league"), None)
    if not lid:
        return {"error": "league not found on FotMob"}
    d = fetch(f"{FM}/api/data/leagues?id={lid}", 3600, as_json=True) or {}
    out = {}
    for cat in (d.get("stats") or {}).get("players") or []:
        key = {"goals": "goals", "goal_assist": "assists"}.get(cat.get("name"))
        if not key:
            continue
        rows = cat.get("topThree") or []
        try:
            full = fetch(cat["fetchAllUrl"], 3600, as_json=True)
            rows = (full.get("TopLists") or [{}])[0].get("StatList") or rows
        except Exception:
            pass
        out[key] = [{"fmId": r.get("ParticiantId") or r.get("id"), "name": r.get("ParticipantName") or r.get("name"),
                     "team": r.get("TeamName") or r.get("teamName"), "teamId": r.get("TeamId") or r.get("teamId"),
                     "value": r.get("StatValue") if r.get("StatValue") is not None else r.get("value"),
                     "matches": r.get("MatchesPlayed"), "photo": f"{FM_IMG}/playerimages/{r.get('ParticiantId') or r.get('id')}.png"}
                    for r in rows[:30]]
        for r in out[key]:
            remember_photo(r["name"], r["team"], r["photo"])
    return {"league": lid, "name": (d.get("details") or {}).get("name"), **out}


# ---------- FotMob player stats (per match, profile, season) ----------

STAT_GROUPS = {"top_stats": "top", "attack": "attack", "defense": "defense", "duels": "duels", "physical_metrics": "physical"}
STAT_KEYS = {   # the rows the player card shows; missing ones come back as 0
    "top": ["rating_title", "minutes_played", "goals", "assists", "expected_goals", "expected_goals_on_target_variant",
            "expected_assists", "total_shots", "ShotsOnTarget", "ShotsOffTarget", "blocked_shots", "accurate_passes",
            "chances_created", "big_chance_created_team_title"],
    "attack": ["touches", "touches_opp_box", "dribbles_succeeded", "accurate_crosses", "long_balls_accurate",
               "passes_into_final_third", "big_chance_missed_title", "dispossessed"],
    "defense": ["matchstats.headers.tackles", "interceptions", "recoveries", "clearances", "shot_blocks", "dribbled_past"],
    "duels": ["ground_duels_won", "aerials_won", "was_fouled", "fouls"],
    "physical": ["physical_metrics_distance_covered", "physical_metrics_topspeed", "physical_metrics_number_of_sprints"]}
GK_KEYS = {"top": ["rating_title", "minutes_played", "saves", "goals_conceded", "expected_goals_on_target_faced", "goals_prevented",
                   "saves_inside_box", "keeper_diving_save", "punches", "keeper_high_claim", "keeper_sweeper", "player_throws",
                   "accurate_passes", "long_balls_accurate", "touches", "recoveries", "clearances"],
           "physical": ["physical_metrics_distance_covered", "physical_metrics_topspeed", "physical_metrics_number_of_sprints"]}
SHOT_KEYS = ("eventType", "x", "y", "min", "minAdded", "isOnTarget", "isBlocked", "expectedGoals", "expectedGoalsOnTarget",
             "shotType", "situation", "isOwnGoal", "isFromInsideBox", "onGoalShot", "blockedX", "blockedY", "teamColor",
             "matchId", "matchDate", "homeTeamName", "awayTeamName", "homeScore", "awayScore", "period")


def fm_shot(x):
    return {k: x.get(k) for k in SHOT_KEYS if x.get(k) is not None}


def fm_flat_stats(p):
    """FotMob's nested stat groups as {group: {key: value | [value, total]}}, plus a key → title map."""
    out, titles = {}, {}
    for g in p.get("stats") or []:
        grp = STAT_GROUPS.get(g.get("key"))
        if not grp:
            continue
        for title, row in (g.get("stats") or {}).items():
            key, st = row.get("key"), row.get("stat") or {}
            if not key or st.get("type") == "boolean":
                continue
            v = st.get("value") or 0
            v = round(v, 2) if isinstance(v, float) else v
            out.setdefault(grp, {})[key] = [v, st.get("total") or 0] if "total" in st else v
            titles[key] = title
    want = GK_KEYS if p.get("isGoalkeeper") else STAT_KEYS
    for grp, keys in want.items():
        for k in keys:
            out.setdefault(grp, {}).setdefault(k, 0)
    return out, titles


def fm_matchstats(mid=None, date=None, home="", away=""):
    if not mid:
        best = fm_find_match(date, home, away)
        if not best:
            return {"error": "match not found on FotMob"}
        mid = best["id"]
    d = fetch(f"{FM}/api/data/matchDetails?matchId={mid}", 60, as_json=True) or {}
    st = (d.get("header") or {}).get("status") or {}
    finished = bool(st.get("finished") or (d.get("general") or {}).get("finished"))
    if finished:   # a finished match won't change: keep it for a day
        with _lock:
            k = f"{FM}/api/data/matchDetails?matchId={mid}"
            if k in _cache:
                _cache[k] = (time.time() + 86400 - 60, _cache[k][1])
    c = d.get("content") or {}
    heat, template = {}, None
    if c.get("heatmapUrl"):
        try:
            hm = fetch(FM + c["heatmapUrl"], 86400 if finished else 60, as_json=True) or {}
            heat, template = hm.get("players") or {}, hm.get("template")
        except Exception:
            pass
    # the page draws these itself, so pass numbers and a template that is plain SVG, never FotMob's markup as-is
    if template and (re.search(r"<script|<foreign|\bon\w+\s*=|href|javascript:|<style|url\((?!#)", template, re.I) or "{{circles__placeholder}}" not in template):
        template = None
    lu = c.get("lineup") or {}
    pos = {}
    for side in ("homeTeam", "awayTeam"):
        t = lu.get(side) or {}
        for p in (t.get("starters") or []) + (t.get("subs") or []):
            pos[str(p.get("id"))] = {"positionId": p.get("positionId"), "rating": (p.get("performance") or {}).get("rating"),
                                     "number": p.get("shirtNumber"), "side": "home" if side == "homeTeam" else "away"}
    players = []
    titles = {}
    for pid, p in (c.get("playerStats") or {}).items():
        stats, t = fm_flat_stats(p)
        titles.update(t)
        extra = pos.get(str(pid), {})
        rating = extra.get("rating") or (stats.get("top") or {}).get("rating_title") or None
        players.append({"id": p.get("id"), "name": p.get("name"), "optaId": p.get("optaId"), "teamId": p.get("teamId"),
                        "team": p.get("teamName"), "side": extra.get("side"), "number": p.get("shirtNumber") or extra.get("number"),
                        "isGoalkeeper": bool(p.get("isGoalkeeper")), "position": p.get("usualPosition"),
                        "positionId": extra.get("positionId"), "rating": rating,
                        "minutes": (stats.get("top") or {}).get("minutes_played") or 0, "stats": stats,
                        "shotmap": [fm_shot(x) for x in p.get("shotmap") or []],
                        "heatmap": [[float(a), float(b), float(c)] for a, b, c in re.findall(
                            r'cx="([\d.]+)"\s+cy="([\d.]+)"\s+r="([\d.]+)"', heat.get(f"p{p.get('optaId')}") or "")]})
    hd = d.get("header") or {}
    return {"id": str(mid), "started": bool(st.get("started")), "finished": finished,
            "teams": [{"id": t.get("id"), "name": t.get("name"), "score": t.get("score")} for t in hd.get("teams") or []],
            "players": players, "titles": titles, "heatmapTemplate": template, "url": f"{FM}/match/{mid}", "fetched": int(time.time())}


def fm_find_player(name, club=""):
    best, score = None, 0
    for x in fm_suggest(name):
        if x.get("type") != "player" or x.get("isCoach"):
            continue
        sc = similar(name, x.get("name")) * 2 + (similar(club, x.get("teamName")) if club else 0)
        if sc > score:
            best, score = x, sc
    return best["id"] if best and similar(name, best.get("name")) >= 0.5 else None


def fm_season_stats(s):
    """playerStats / firstSeasonStats trimmed to groups, the shotmap and the season touch points."""
    if not s:
        return None
    row = lambda x: {"title": x.get("title"), "key": x.get("localizedTitleId"), "value": x.get("statValue"),
                     "format": x.get("statFormat"), "per90": x.get("per90"), "pct": x.get("percentileRank"),
                     "pct90": x.get("percentileRankPer90")}
    return {"top": [row(x) for x in (s.get("topStatCard") or {}).get("items") or []],
            "groups": [{"title": g.get("title"), "key": g.get("localizedTitleId"), "items": [row(x) for x in g.get("items") or []]}
                       for g in (s.get("statsSection") or {}).get("items") or []],
            "shotmap": [fm_shot(x) for x in s.get("shotmap") or []],
            "keeperShotmap": [fm_shot(x) for x in s.get("keeperShotmap") or []],
            "heatmap": [[x.get("x"), x.get("y")] for x in (s.get("heatmap") or {}).get("coordinates") or []]}


def fm_player(pid=None, name="", club=""):
    pid = pid or fm_find_player(name, club)
    if not pid:
        return {"error": "player not found on FotMob"}
    d = fetch(f"{FM}/api/data/playerData?id={pid}", 6 * 3600, as_json=True) or {}
    if not d.get("id"):
        return {"error": "player not found on FotMob"}
    info = {}
    for x in d.get("playerInformation") or []:
        v = x.get("value") or {}
        info[x.get("translationKey") or x.get("title")] = {"title": x.get("title"), "value": v.get("numberValue") if v.get("numberValue") is not None else (v.get("dateValue") or v.get("fallback")),
                                                           "text": v.get("fallback"), "countryCode": x.get("countryCode")}
    pd = d.get("positionDescription") or {}
    team = d.get("primaryTeam") or {}
    ml = d.get("mainLeague") or {}
    rec = [{"id": m.get("id"), "utc": (m.get("matchDate") or {}).get("utcTime"), "league": m.get("leagueName"), "leagueId": m.get("leagueId"),
            "team": m.get("teamName"), "teamId": m.get("teamId"), "opponent": m.get("opponentTeamName"), "opponentId": m.get("opponentTeamId"),
            "home": m.get("isHomeTeam"), "score": [m.get("homeScore"), m.get("awayScore")], "minutes": m.get("minutesPlayed"),
            "goals": m.get("goals"), "assists": m.get("assists"), "yellow": m.get("yellowCards"), "red": m.get("redCards"),
            "rating": (m.get("ratingProps") or {}).get("rating"), "top": (m.get("ratingProps") or {}).get("isTopRating"),
            "motm": m.get("playerOfTheMatch"), "bench": m.get("onBench"), "played": m.get("playedInMatch")}
           for m in d.get("recentMatches") or []]
    career = {}
    for kind, v in ((d.get("careerHistory") or {}).get("careerItems") or {}).items():
        career[kind] = {"teams": [{"team": t.get("team"), "teamId": t.get("teamId"), "start": t.get("startDate"), "end": t.get("endDate"),
                                   "active": t.get("active"), "apps": t.get("appearances"), "goals": t.get("goals"),
                                   "assists": t.get("assists"), "transfer": (t.get("transferType") or {}).get("text") if isinstance(t.get("transferType"), dict) else t.get("transferType")} for t in (v or {}).get("teamEntries") or []],
                        "seasons": [{"season": x.get("seasonName"), "team": x.get("team"), "teamId": x.get("teamId"), "apps": x.get("appearances"),
                                     "goals": x.get("goals"), "assists": x.get("assists"), "rating": (x.get("rating") or {}).get("rating"),
                                     "comps": [{"league": c.get("leagueName"), "leagueId": c.get("leagueId"), "apps": c.get("appearances"),
                                                "goals": c.get("goals"), "assists": c.get("assists"), "rating": (c.get("rating") or {}).get("rating")}
                                               for c in x.get("tournamentStats") or []]}
                                    for x in (v or {}).get("seasonEntries") or []]}
    inj = d.get("injuryInformation")
    return {"id": d.get("id"), "name": d.get("name"), "photo": f"{FM_IMG}/playerimages/{d.get('id')}.png", "birthDate": (d.get("birthDate") or {}).get("utcTime"),
            "team": {"id": team.get("teamId"), "name": team.get("teamName"), "onLoan": team.get("onLoan"),
                     "crest": team.get("teamId") and f"{FM_IMG}/logo/teamlogo/{team.get('teamId')}.png"},
            "info": info, "contractEnd": (d.get("contractEnd") or {}).get("utcTime") if isinstance(d.get("contractEnd"), dict) else d.get("contractEnd"),
            "positions": [{"label": (p.get("strPos") or {}).get("label"), "short": (p.get("strPosShort") or {}).get("label"),
                           "main": p.get("isMainPosition"), "count": p.get("occurences"), "x": (p.get("pitchPositionData") or {}).get("right"),
                           "y": (p.get("pitchPositionData") or {}).get("top")} for p in pd.get("positions") or []],
            "primaryPosition": (pd.get("primaryPosition") or {}).get("label"),
            "injury": inj if isinstance(inj, dict) else None,
            "traits": {"title": (d.get("traits") or {}).get("title"), "items": [{"key": x.get("key"), "title": x.get("title"), "value": x.get("value")}
                                                                                for x in (d.get("traits") or {}).get("items") or []]} if d.get("traits") else None,
            "mainLeague": {"id": ml.get("leagueId"), "name": ml.get("leagueName"), "season": ml.get("season"),
                           "stats": [{"title": x.get("title"), "key": x.get("localizedTitleId"), "value": x.get("value")} for x in ml.get("stats") or []]},
            "recent": rec, "career": career,
            "values": [{"date": v.get("date"), "value": v.get("value"), "low": v.get("lowerBound"), "high": v.get("upperBound"), "team": v.get("teamName")}
                       for v in (d.get("marketValues") or {}).get("values") or []],
            "trophies": [{"team": t.get("teamName"), "items": [{"league": x.get("leagueName"), "won": x.get("seasonsWon") or [], "runnerUp": x.get("seasonsRunnerUp") or []}
                                                               for x in t.get("tournaments") or []]} for t in (d.get("trophies") or {}).get("playerTrophies") or []],
            "statSeasons": [{"season": x.get("seasonName"), "tournaments": [{"name": t.get("name"), "id": t.get("tournamentId"), "entryId": t.get("entryId"),
                                                                              "deep": t.get("hasDeepStats")} for t in x.get("tournaments") or []]}
                            for x in d.get("statSeasons") or []],
            "season": fm_season_stats(d.get("firstSeasonStats")),
            "isGoalkeeper": (pd.get("primaryPosition") or {}).get("key") == "keeper" or any((p.get("strPosShort") or {}).get("label") == "GK" and p.get("isMainPosition") for p in pd.get("positions") or []),
            "url": f"{FM}/players/{d.get('id')}", "fetched": int(time.time())}


def fm_playerstats(pid, entry):
    d = fetch(f"{FM}/api/data/playerStats?playerId={pid}&seasonId={entry}&isFirstSeason=false", 6 * 3600, as_json=True) or {}
    return {**(fm_season_stats(d) or {}), "id": pid, "entryId": entry}


# ---------- HTTP ----------

# ---------- accounts (stored on this computer only) ----------

USERS_FILE = CACHE_DIR / "users.json"
SESSIONS_FILE = CACHE_DIR / "sessions.json"
_acct_lock = threading.Lock()
SESSION_DAYS = 30
PREF_KEYS = {"favTeams": list, "favPlayers": list, "favLeagues": list, "picks": list, "color": str, "bio": str, "display": str, "theme": str,
             "boards": list, "slips": list, "favSports": list, "tz": str, "follows": list, "favThemes": list,
             "homeOff": list, "homeOrder": list, "watch": list}   # Home: the sections a member has hidden, and the games on their watchlist   # saved Lab boards, saved prediction slips, favorite sports, time zone


_users = storage.load(USERS_FILE, {})
_sessions = storage.load(SESSIONS_FILE, {})
_failures = {}


def _save_accounts():
    storage.save(USERS_FILE, _users)
    storage.save(SESSIONS_FILE, _sessions)


# ---------- what members picked (the community split on a prediction) ----------

VOTES_FILE = CACHE_DIR / "votes.json"
# Awards and honours. No data provider the site uses carries them, so this file starts empty and only an admin adds to
# it, one entry at a time, each with the page it was checked against. Nothing is ever filled in by the code.
# ---------- Transfer window: league moves and key dates ----------
# Moves come from the leagues' own public transaction lists: ESPN for the NBA and NFL (a team and a sentence per
# move), MLB's stats API for baseball (player, both teams and a type code). Nothing public lists the college transfer
# portal, so the college leagues have no moves source yet. Key dates are never guessed: an admin enters them.
MOVE_SRC = {"nba": ("espn", "basketball/nba"), "nfl": ("espn", "football/nfl"), "mlb": ("mlb", ""), "cbb": ("", ""), "cfb": ("", "")}
MOVE_LEAGUES = tuple(MOVE_SRC) + ("soccer",)

def _espn_moves(path):
    out = []
    for page in (1, 2, 3):
        d = fetch(f"https://site.api.espn.com/apis/site/v2/sports/{path}/transactions?limit=100&page={page}", 600, as_json=True)
        for t in d.get("transactions") or []:
            tm, text = t.get("team") or {}, str(t.get("description") or "").strip()
            if not text or not t.get("date"):
                continue
            logo = tm.get("logo") or next((l.get("href") for l in tm.get("logos") or [] if l.get("href")), "")
            out.append({"id": f"{tm.get('id', '')}:{t['date']}:{len(out)}", "date": t["date"], "text": text[:600],
                        "team": {"id": str(tm.get("id") or ""), "name": tm.get("displayName") or tm.get("name") or "", "abbr": tm.get("abbreviation") or "",
                                 "short": tm.get("shortDisplayName") or tm.get("name") or "", "logo": logo, "color": tm.get("color") or ""}})
        if page >= int(d.get("pageCount") or 1) or len(out) >= 250:
            break
    return out

def _mlb_moves(days=21):
    end = datetime.date.today()
    d = fetch(f"https://statsapi.mlb.com/api/v1/transactions?sportId=1&startDate={end - datetime.timedelta(days=days)}&endDate={end}", 600, as_json=True)
    side = lambda x: {"id": str(x.get("id") or ""), "name": x.get("name") or ""} if x and x.get("id") else None
    out = []
    for t in d.get("transactions") or []:
        text = str(t.get("description") or "").strip()
        if not text or not (t.get("date") or t.get("effectiveDate")):
            continue
        person = t.get("person") or {}
        out.append({"id": str(t.get("id") or len(out)), "date": t.get("date") or t.get("effectiveDate"), "text": text[:600], "code": t.get("typeCode") or "", "kind": t.get("typeDesc") or "",
                    "player": {"id": str(person.get("id") or ""), "name": person.get("fullName") or ""} if person.get("id") else None,
                    "from": side(t.get("fromTeam")), "to": side(t.get("toTeam"))})
    out.sort(key=lambda m: m["date"], reverse=True)
    return out[:600]

def _espn_teams(path):
    """The league's teams, so a sentence that names another team ("from Dallas") can be matched to it."""
    try:
        d = fetch(f"https://site.api.espn.com/apis/site/v2/sports/{path}/teams", 86400, as_json=True) or {}
    except Exception:
        return []
    out = []
    for lgx in (d.get("sports") or [{}])[0].get("leagues") or []:
        for x in lgx.get("teams") or []:
            t = x.get("team") or {}
            logo = next((l.get("href") for l in t.get("logos") or [] if l.get("href")), "")
            out.append({"id": str(t.get("id") or ""), "name": t.get("displayName") or "", "location": t.get("location") or "", "nickname": t.get("name") or "",
                        "abbr": t.get("abbreviation") or "", "short": t.get("shortDisplayName") or t.get("name") or "", "logo": logo, "color": t.get("color") or ""})
    return out

SOURCE_LINK = {"nba": "https://www.espn.com/nba/transactions", "nfl": "https://www.espn.com/nfl/transactions", "mlb": "https://www.mlb.com/transactions"}

def league_moves(lg):
    src, path = MOVE_SRC[lg]
    if not src:
        return {"league": lg, "source": "", "moves": []}
    try:
        if src == "espn":
            import moves_parse
            rows = _espn_moves(path)
            # one event per player per sentence, read on the server (moves_parse.py); the raw rows stay for older pages
            out = {"league": lg, "source": "ESPN", "status": "Official", "link": SOURCE_LINK.get(lg, ""), "moves": rows}
            try:
                out["events"] = [moves_parse.public(e) for e in moves_parse.events(lg, rows, _espn_teams(path))]
            except Exception as e:   # the page falls back to reading the raw rows itself
                print("moves_parse failed:", lg, repr(e))
            return out
        return {"league": lg, "source": "MLB", "status": "Official", "link": SOURCE_LINK.get(lg, ""), "moves": _mlb_moves()}
    except Exception as e:
        print(f"moves {lg}: {e}", file=sys.stderr)
        return {"league": lg, "source": "ESPN" if src == "espn" else "MLB", "moves": [], "error": "The moves list did not answer. It will be tried again shortly."}

MOVE_DATES_FILE = CACHE_DIR / "transfer_dates.json"
_move_dates = storage.load(MOVE_DATES_FILE, [])   # [{id, league, label, start, end, by, at}]  (end is empty for a single day such as a trade deadline)

def move_dates_action(body, user):
    op = body.get("op")
    with _acct_lock:
        if op == "remove":
            before = len(_move_dates)
            _move_dates[:] = [d for d in _move_dates if d.get("id") != body.get("id")]
            if len(_move_dates) == before:
                return 404, {"error": "That date is already gone."}
            storage.save(MOVE_DATES_FILE, _move_dates)
            return 200, {"ok": True, "dates": _move_dates}
        if op != "add":
            return 400, {"error": "Unknown action."}
        lg, label = str(body.get("league") or ""), re.sub(r"\s+", " ", str(body.get("label") or "")).strip()[:40]
        start, end = str(body.get("start") or ""), str(body.get("end") or "")
        if lg not in MOVE_LEAGUES or not label:
            return 400, {"error": "Choose the league and say what the date is."}
        day = r"20\d\d-\d\d-\d\d"
        if not re.fullmatch(day, start) or (end and not re.fullmatch(day, end)):
            return 400, {"error": "Pick the date from the calendar."}
        if end and end < start:
            return 400, {"error": "The closing date is before the opening date."}
        if len(_move_dates) >= 400:
            return 400, {"error": "The dates list is full. Remove old dates first."}
        _move_dates.append({"id": secrets.token_hex(6), "league": lg, "label": label, "start": start, "end": end, "by": user["username"], "at": int(time.time())})
        storage.save(MOVE_DATES_FILE, _move_dates)
        return 200, {"ok": True, "dates": _move_dates}

AWARDS_FILE = CACHE_DIR / "awards.json"
AWARD_SPORTS = ("nba", "wnba", "cbb", "nfl", "cfb", "mlb", "nhl", "soccer", "tennis", "ufc", "boxing")
_awards = storage.load(AWARDS_FILE, [])   # [{id, sport, athlete, name, award, season, detail, source, by, at}]
if not isinstance(_awards, list):
    _awards = []


def awards_for(sport, athlete):
    with _acct_lock:
        return [dict(a) for a in _awards if a.get("sport") == sport and str(a.get("athlete")) == str(athlete)]


def awards_action(body, user):
    op = body.get("op")
    with _acct_lock:
        if op == "remove":
            before = len(_awards)
            _awards[:] = [a for a in _awards if a.get("id") != body.get("id")]
            if len(_awards) == before:
                return 404, {"error": "That award entry is already gone."}
            storage.save(AWARDS_FILE, _awards)
            return 200, {"ok": True}
        if op != "add":
            return 400, {"error": "Unknown action."}
        sport, athlete, award = str(body.get("sport") or ""), str(body.get("athlete") or ""), str(body.get("award") or "")
        season, source = str(body.get("season") or "").strip(), str(body.get("source") or "").strip()
        if sport not in AWARD_SPORTS or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,40}", athlete) or not re.fullmatch(r"[a-z0-9-]{2,40}", award):
            return 400, {"error": "Pick the athlete and the award again."}
        if not re.fullmatch(r"(19|20)\d\d(-\d\d)?", season):
            return 400, {"error": "Write the season as a year, like 2025, or 2024-25."}
        if not re.fullmatch(r"https?://[^\s<>\"']{4,300}", source):
            return 400, {"error": "Add a link to the page that shows this award, starting with http."}
        if any(a["sport"] == sport and str(a["athlete"]) == athlete and a["award"] == award and a["season"] == season and (a.get("detail") or "") == str(body.get("detail") or "").strip()[:60] for a in _awards):
            return 409, {"error": "That award and season is already listed."}
        if len(_awards) >= 20000:
            return 400, {"error": "The awards file is full."}
        entry = {"id": secrets.token_hex(6), "sport": sport, "athlete": athlete, "name": str(body.get("name") or "")[:80], "award": award, "season": season,
                 "detail": str(body.get("detail") or "").strip()[:60], "source": source, "by": user["username"], "at": int(time.time())}
        _awards.append(entry)
        storage.save(AWARDS_FILE, _awards)
        return 200, {"ok": True, "entry": entry}


_votes = storage.load(VOTES_FILE, {})   # game key ("soccer:12345") -> {username: "home" | "draw" | "away"}
VOTE_KEY = re.compile(r"[a-z]{2,12}:[A-Za-z0-9._-]{1,40}")
VOTE_MAX_GAMES = 4000


def vote_split(key):
    out = {"home": 0, "draw": 0, "away": 0}
    for pick in (_votes.get(key) or {}).values():
        if pick in out:
            out[pick] += 1
    out["n"] = sum(out.values())
    return out


def cast_vote(user, body):
    key, pick = str(body.get("key") or ""), str(body.get("pick") or "")
    if not VOTE_KEY.fullmatch(key) or pick not in ("", "home", "draw", "away"):
        return 400, {"error": "Bad pick."}
    with _acct_lock:
        game = _votes.setdefault(key, {})
        if pick:
            game[user["username"].lower()] = pick
        else:
            game.pop(user["username"].lower(), None)
        if not game:
            _votes.pop(key, None)
        while len(_votes) > VOTE_MAX_GAMES:   # oldest games first; a dict keeps the order they were added
            _votes.pop(next(iter(_votes)))
        storage.save(VOTES_FILE, _votes)
        return 200, {"ok": True, "split": vote_split(key)}


# ---------- members: roles, services and who can use what ----------
# A member is an Owner, an Admin or a Member, and is active or paused. Every member has every service unless an admin
# switched one off for them: only those exceptions are stored (u["off"]), so a service added to SERVICES later is on
# for everyone without touching the accounts. Owners and admins always have every service.
SERVICES = (("live", "Live scores", "Scores, match centre, lineups"), ("lab", "The Lab", "Players, teams, props, boards"),
            ("predictions", "Predictions", "Edge board, slips, track record"), ("transfers", "Transfer window", "Moves, key dates, the soccer market"),
            ("profiles", "Profiles and awards", "Players, fighters, honors"), ("alerts", "Alerts", "Follow teams and players"))
SERVICE_KEYS = tuple(k for k, _, _ in SERVICES)
SERVICE_NAME = {k: n for k, n, _ in SERVICES}
MEMBERS_FILE = CACHE_DIR / "members.json"
_mstate = storage.load(MEMBERS_FILE, {})   # {"policy": {"allNew": bool, "start": [service]}, "invites": [...], "log": [...], "feedback": [...]}
for _k, _v in (("policy", {"allNew": True, "start": list(SERVICE_KEYS)}), ("invites", []), ("log", []), ("feedback", [])):
    if not isinstance(_mstate.get(_k), type(_v)):
        _mstate[_k] = _v


def _save_members():
    storage.save(MEMBERS_FILE, _mstate)


def log_activity(by, what):
    _mstate["log"].insert(0, {"at": int(time.time()), "by": by, "what": str(what)[:300]})
    del _mstate["log"][500:]


def rank_of(u):
    """owner, admin or member. The account named in FLOODLIGHT_ADMIN is always an owner."""
    if not u:
        return None
    if ADMIN and u["username"].lower() == ADMIN:
        return "owner"
    return u.get("rank") if u.get("rank") in ("owner", "admin") else "member"


def is_paused(u):
    return u.get("status") == "paused"


def off_of(u):
    return [k for k in (u.get("off") or []) if k in SERVICE_KEYS]


def has(u, service):
    """Can this member use this service? No row means yes."""
    if not u:
        return not GATED            # on your own computer nobody has to log in
    if rank_of(u) in ("owner", "admin"):
        return True
    if GATED and is_paused(u):
        return False
    return service not in off_of(u)


def role_of(u):
    """The older four names, still used across the code: admin (owners and admins), research (has the Lab), viewer, pending (paused)."""
    if not u:
        return None
    if rank_of(u) in ("owner", "admin"):
        return "admin"
    if GATED and is_paused(u):
        return "pending"
    return "research" if has(u, "lab") else "viewer"


def can_view(u):
    return not GATED or role_of(u) in ("viewer", "research", "admin")


def can_research(u):
    return has(u, "lab")


def service_for(path):
    """Which service an API path belongs to, for the paths this server answers itself."""
    if path in ("/api/awards", "/api/tm/player", "/api/fm/player", "/api/fm/playerstats", "/api/box/fighter"):
        return "profiles"
    if path.startswith(("/api/tm/transfers/", "/api/transfers/")):
        return "transfers"
    if path in ("/api/forecast/list", "/api/record", "/api/props/record", "/api/props/seen", "/api/parlays") or path.startswith("/api/picks/"):
        return "predictions"
    if path.startswith(("/api/dfs/", "/api/forecast/")):
        return "lab"
    if path.startswith(("/api/fm/", "/api/odds/", "/api/bb/", "/api/hk/", "/api/bsb/", "/api/tn/", "/api/box/", "/api/tm/squad")):
        return "live"
    return None


def touch(u):
    """Remember when a member was last here, to the nearest quarter of an hour."""
    now = int(time.time())
    if now - int(u.get("seen") or 0) > 900:
        with _acct_lock:
            u["seen"] = now
            _save_accounts()


def _start_off():
    pol = _mstate["policy"]
    return [] if pol.get("allNew", True) else [k for k in SERVICE_KEYS if k not in (pol.get("start") or [])]


def _new_user(username, password, role, display=None, prefs=None, rank="member", email=""):
    salt = secrets.token_hex(16)
    paused = role == "pending"
    return {"username": username, "salt": salt, "hash": _hash(password, salt), "created": int(time.time()),
            "role": "pending" if paused else "research", "rank": rank if rank in ("owner", "admin") else "member",
            "status": "paused" if paused else "active", "off": _start_off(), "email": email,
            "prefs": clean_prefs(prefs or {}, {"display": (display or username).strip()[:40]})}


def migrate_members():
    """One time: the old roles (pending, viewer, research) become Member, active or paused, with every service."""
    todo = [u for u in _users.values() if "status" not in u]
    if not todo:
        return
    had_lab, gained, waiting = [], [], []
    with _acct_lock:
        for u in todo:
            old = u.get("role")
            u["status"], u["off"] = ("active" if old in ("viewer", "research") or (ADMIN and u["username"].lower() == ADMIN) else "paused"), []
            u.setdefault("rank", "member")
            (had_lab if old == "research" else gained if old == "viewer" else waiting).append(u["username"])
        names = lambda xs: f"{len(xs)}" + ((" (" + ", ".join(xs[:60]) + (" and more" if len(xs) > 60 else "") + ")") if xs else "")
        log_activity("Floodlight", f"Moved {len(todo)} accounts to the new access model. Already had everything: {len(had_lab)}. "
                     f"Had games only and now have every service: {names(gained)}. Waiting for approval, kept paused: {names(waiting)}.")
        _save_accounts()
        _save_members()


RETIRED_COLORS = {"#8e5cf6": "#A0522D"}   # avatar colours the picker no longer offers, and what replaces each


def retire_colors():
    """Move anyone still on a retired avatar colour to its replacement."""
    with _acct_lock:
        hit = [u for u in _users.values() if str((u.get("prefs") or {}).get("color") or "").lower() in RETIRED_COLORS]
        for u in hit:
            u["prefs"]["color"] = RETIRED_COLORS[u["prefs"]["color"].lower()]
        if hit:
            _save_accounts()


def ensure_admin():
    """Recreate the admin account from FLOODLIGHT_ADMIN_PASSWORD if it's missing, so you can always log in."""
    if not (ADMIN and ADMIN_PASSWORD) or ADMIN in _users or not re.fullmatch(r"[a-z0-9_.]{3,20}", ADMIN):
        return
    with _acct_lock:
        _users[ADMIN] = _new_user(ADMIN, ADMIN_PASSWORD, "admin", rank="owner")
        _save_accounts()
    print(f"Created the admin account '{ADMIN}'")


def admin_list():
    rows = [{"username": u["username"], "display": u.get("prefs", {}).get("display") or u["username"],
             "role": role_of(u), "created": u.get("created", 0)} for u in _users.values()]
    order = {"pending": 0, "admin": 1, "research": 2, "viewer": 3}
    return sorted(rows, key=lambda r: (order.get(r["role"], 9), -r["created"]))


def members_view(actor):
    now = time.time()
    _mstate["invites"][:] = [i for i in _mstate["invites"] if i.get("exp", 0) > now - 30 * 86400]
    rows = [{"username": u["username"], "display": u.get("prefs", {}).get("display") or u["username"], "email": u.get("email") or "",
             "color": u.get("prefs", {}).get("color") or "", "photo": u.get("prefs", {}).get("photo") or 0, "rank": rank_of(u), "status": "paused" if is_paused(u) else "active",
             "off": [] if rank_of(u) != "member" else off_of(u), "created": u.get("created", 0), "seen": u.get("seen", 0),
             "fixed": bool(ADMIN and u["username"].lower() == ADMIN)} for u in _users.values()]
    order = {"owner": 0, "admin": 1, "member": 2}
    rows.sort(key=lambda r: (order[r["rank"]], r["display"].lower()))
    return {"members": rows, "invites": [{**i, "expired": i.get("exp", 0) < now} for i in _mstate["invites"]], "policy": _mstate["policy"],
            "services": [list(x) for x in SERVICES], "log": _mstate["log"][:120], "feedback": _mstate["feedback"][:60],
            "me": {"username": actor["username"], "rank": rank_of(actor)}, "gated": GATED}


def _owners():
    return [u for u in _users.values() if rank_of(u) == "owner"]


def members_action(body, actor):
    """Everything the Members page can change. Each change is written to the activity log."""
    op, me, mine = body.get("op"), actor["username"], rank_of(actor)
    name = lambda u: u.get("prefs", {}).get("display") or u["username"]
    keys = body.get("usernames") if isinstance(body.get("usernames"), list) else [body.get("username")]
    keys = [str(k or "").strip().lower() for k in keys if k][:200]
    with _acct_lock:
        if op == "policy":
            if mine != "owner":
                return 403, {"error": "Only an owner can change what new members get."}
            start = [k for k in (body.get("start") or []) if k in SERVICE_KEYS]
            _mstate["policy"] = {"allNew": bool(body.get("allNew")), "start": start if not body.get("allNew") else list(SERVICE_KEYS)}
            log_activity(me, "New members get every service" if body.get("allNew") else
                         "New members start with: " + (", ".join(SERVICE_NAME[k] for k in start) or "no services"))
        elif op == "invite":
            email, rank = str(body.get("email") or "").strip().lower()[:120], body.get("rank") if body.get("rank") in ("admin", "member") else "member"
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                return 400, {"error": "Enter the person's email address."}
            if any(i["email"] == email and i.get("exp", 0) > time.time() for i in _mstate["invites"]):
                return 409, {"error": "That address already has an invite. Use Resend to get its link again."}
            if any((u.get("email") or "").lower() == email for u in _users.values()):
                return 409, {"error": "Someone with that address is already a member."}
            if len(_mstate["invites"]) >= 300:
                return 400, {"error": "There are too many open invites. Remove some first."}
            _mstate["invites"].insert(0, {"id": secrets.token_hex(5), "token": secrets.token_urlsafe(18), "email": email, "rank": rank, "by": me,
                                          "at": int(time.time()), "exp": int(time.time()) + 14 * 86400})
            log_activity(me, f"Invited {email} as {'an admin' if rank == 'admin' else 'a member'}")
        elif op in ("reinvite", "uninvite"):
            inv = next((i for i in _mstate["invites"] if i["id"] == body.get("id")), None)
            if not inv:
                return 404, {"error": "That invite is gone."}
            if op == "uninvite":
                _mstate["invites"].remove(inv)
                log_activity(me, f"Cancelled the invite for {inv['email']}")
            else:
                inv.update(token=secrets.token_urlsafe(18), at=int(time.time()), exp=int(time.time()) + 14 * 86400)
                log_activity(me, f"Made a new invite link for {inv['email']}")
        elif op == "add":
            username, password = str(body.get("username") or "").strip(), str(body.get("password") or "")
            rank = body.get("rank") if body.get("rank") in ("admin", "member") else "member"
            if not re.fullmatch(r"[A-Za-z0-9_.]{3,20}", username):
                return 400, {"error": "Usernames are 3–20 letters, numbers, dots or underscores."}
            if len(password) < 8:
                return 400, {"error": "Use a password of at least 8 characters."}
            if username.lower() in _users:
                return 409, {"error": "That username is taken."}
            _users[username.lower()] = _new_user(username, password, "research", rank=rank)
            log_activity(me, f"Added {username} as {'an admin' if rank == 'admin' else 'a member'}")
        elif op == "feedback-clear":
            _mstate["feedback"][:] = [f for f in _mstate["feedback"] if f.get("id") != body.get("id")]
        else:
            targets = [_users[k] for k in keys if k in _users]
            if not targets:
                return 404, {"error": "No member with that username."}
            for u in targets:
                r, who = rank_of(u), name(u)
                if op in ("pause", "remove", "rank", "password") and u["username"].lower() == me.lower():
                    return 400, {"error": "You can't do that to your own account here."}
                if r == "owner" and mine != "owner":
                    return 403, {"error": f"{who} is an owner. Admins can't change or remove owners."}
                if ADMIN and u["username"].lower() == ADMIN and op in ("pause", "remove", "rank", "password"):
                    return 400, {"error": f"{who} is the site owner's account and can't be changed here."}
            if op == "rank":
                rank = body.get("rank")
                if rank not in ("owner", "admin", "member"):
                    return 400, {"error": "Pick Owner, Admin or Member."}
                if mine != "owner" and (rank == "owner"):
                    return 403, {"error": "Only an owner can make someone an owner."}
                losing = [u for u in targets if rank_of(u) == "owner" and rank != "owner"]
                if losing and len(_owners()) - len(losing) < 1:
                    return 400, {"error": "There must always be at least one owner."}
                for u in targets:
                    u["rank"] = rank
                    log_activity(me, f"Made {name(u)} {'an owner' if rank == 'owner' else 'an admin' if rank == 'admin' else 'a member'}")
            elif op in ("pause", "resume"):
                for u in targets:
                    if op == "pause" and rank_of(u) == "owner":
                        return 400, {"error": "An owner can't be paused."}
                    u["status"], u["role"] = ("paused", "pending") if op == "pause" else ("active", "research")
                    if op == "pause":
                        for t in [t for t, v in _sessions.items() if v["user"] == u["username"].lower()]:
                            _sessions.pop(t, None)
                    log_activity(me, f"{'Paused' if op == 'pause' else 'Resumed'} {name(u)}")
            elif op == "services":
                off = [k for k in (body.get("off") or []) if k in SERVICE_KEYS]
                for u in targets:
                    if rank_of(u) != "member":
                        return 400, {"error": f"{name(u)} is {'an owner' if rank_of(u) == 'owner' else 'an admin'} and always has every service."}
                    before = set(off_of(u))
                    u["off"] = off
                    for k in SERVICE_KEYS:
                        if (k in off) != (k in before):
                            log_activity(me, f"Switched {'off' if k in off else 'on'} {SERVICE_NAME[k]} for {name(u)}")
            elif op == "reset":
                for u in targets:
                    if off_of(u):
                        u["off"] = []
                        log_activity(me, f"Reset {name(u)} to all services")
            elif op == "password":   # the member forgot it: a temporary one the admin passes on
                u = targets[0]
                temp = "-".join(secrets.token_hex(2) for _ in range(3))
                u["salt"] = secrets.token_hex(16)
                u["hash"] = _hash(temp, u["salt"])
                for t in [t for t, v in _sessions.items() if v["user"] == u["username"].lower()]:
                    _sessions.pop(t, None)
                log_activity(me, f"Gave {name(u)} a temporary password")
                _save_accounts()
                _save_members()
                return 200, {**members_view(actor), "password": temp, "for": u["username"]}
            elif op == "remove":
                losing = [u for u in targets if rank_of(u) == "owner"]
                if losing and len(_owners()) - len(losing) < 1:
                    return 400, {"error": "There must always be at least one owner."}
                for u in targets:
                    k = u["username"].lower()
                    _users.pop(k, None)
                    if _parlays.pop(k, None) is not None:
                        storage.save(PARLAYS_FILE, _parlays)
                    for t in [t for t, v in _sessions.items() if v["user"] == k]:
                        _sessions.pop(t, None)
                    log_activity(me, f"Removed {name(u)}")
            else:
                return 400, {"error": "Unknown action."}
        _save_accounts()
        _save_members()
    return 200, members_view(actor)


def admin_action(path, body, actor):
    """The older member endpoints, kept working on top of the new ones."""
    op = {"/api/admin/add": "add", "/api/admin/password": "password", "/api/admin/remove": "remove"}.get(path)
    if path == "/api/admin/set":
        op = "pause" if body.get("role") == "pending" else "resume"
    if not op:
        return 404, {"error": "unknown endpoint"}
    status, out = members_action({**body, "op": op, "rank": "member"}, actor)
    return (status, out) if status != 200 else (200, {"users": admin_list(), **({"password": out["password"]} if "password" in out else {})})


def invite_for(token):
    now = time.time()
    return next((i for i in _mstate["invites"] if token and hmac.compare_digest(i.get("token", ""), token) and i.get("exp", 0) > now), None)


# ---------- member photos: a small square picture per member, initials where there is none ----------
# The page resizes the picture to at most 256 pixels a side before it is sent. The server checks it is really a JPEG,
# PNG or WebP of that size and under 48 KB, and keeps it in avatars.json (and the database copy when one is set, so it
# survives a restart). The member's prefs carry the time it was set, which the page adds to the picture's address.
AVATARS_FILE = CACHE_DIR / "avatars.json"
_avatars = storage.load(AVATARS_FILE, {})   # {username lower: {"type", "data" (base64), "at"}}
AVATAR_MAX_BYTES, AVATAR_MAX_PX = 48_000, 256


def _img_size(b):
    """(media type, width, height) read from the file's own header, or None when it is not a JPEG, PNG or WebP."""
    import struct
    if b[:8] == b"\x89PNG\r\n\x1a\n" and len(b) >= 24:
        w, h = struct.unpack(">II", b[16:24])
        return "image/png", w, h
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP" and len(b) >= 30:
        kind = b[12:16]
        if kind == b"VP8X":
            return "image/webp", 1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little")
        if kind == b"VP8 ":
            return "image/webp", int.from_bytes(b[26:28], "little") & 0x3FFF, int.from_bytes(b[28:30], "little") & 0x3FFF
        if kind == b"VP8L":
            bits = int.from_bytes(b[21:25], "little")
            return "image/webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        return None
    if b[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xFF:
                i += 1
                continue
            m = b[i + 1]
            if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                i += 2
                continue
            seg = int.from_bytes(b[i + 2:i + 4], "big")
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", b[i + 5:i + 9])
                return "image/jpeg", w, h
            i += 2 + seg
    return None


def set_avatar(user, body):
    import base64
    key = user["username"].lower()
    if body.get("remove"):
        _avatars.pop(key, None)
        storage.save(AVATARS_FILE, _avatars)
        with _acct_lock:
            user.setdefault("prefs", {}).pop("photo", None)
            _save_accounts()
        return 200, {"user": public_user(user)}
    m = re.fullmatch(r"data:(image/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)", str(body.get("data") or ""))
    if not m:
        return 400, {"error": "Send a JPEG, PNG or WebP picture."}
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception:
        return 400, {"error": "That picture could not be read."}
    if len(raw) > AVATAR_MAX_BYTES:
        return 413, {"error": "That picture is too large. Try a smaller one."}
    size = _img_size(raw)
    if not size or size[0] != m.group(1):
        return 400, {"error": "That file is not a JPEG, PNG or WebP picture."}
    if not (0 < size[1] <= AVATAR_MAX_PX and 0 < size[2] <= AVATAR_MAX_PX):
        return 400, {"error": f"Pictures are kept at {AVATAR_MAX_PX} pixels or smaller a side."}
    at = int(time.time())
    _avatars[key] = {"type": size[0], "data": base64.b64encode(raw).decode(), "at": at}
    storage.save(AVATARS_FILE, _avatars)
    with _acct_lock:
        user.setdefault("prefs", {})["photo"] = at
        _save_accounts()
    return 200, {"user": public_user(user)}


# ---------- parlays: what a member is tracking, and their record ----------
PARLAYS_FILE = CACHE_DIR / "parlays.json"
_parlays = storage.load(PARLAYS_FILE, {})   # {username: [parlay, ...]} newest first
PARLAY_MAX, PARLAY_LEGS = 300, 12
LEG_TYPES = ("prop", "win", "draw", "total", "spread")
LEG_TEXT = ("id", "type", "sport", "lg", "path", "eid", "game", "gameKey", "home", "away", "homeAbbr", "awayAbbr", "side", "team", "player", "opp",
            "k", "label", "text", "short", "photo", "logo", "book")
LEG_NUM = ("start", "line", "ours0", "market0", "mu", "sd", "m0", "t0")
LEG_RESULTS = ("hit", "miss", "push", "void")


def _num(v, lo=-1e7, hi=1e14):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
        return None
    return v


def _leg_clean(raw):
    """A leg as the page sent it, cut down to the fields a leg has. None when it isn't a leg."""
    if not isinstance(raw, dict) or raw.get("type") not in LEG_TYPES:
        return None
    leg = {k: str(raw[k])[:160] for k in LEG_TEXT if isinstance(raw.get(k), (str, int, float)) and not isinstance(raw.get(k), bool) and str(raw[k]) != ""}
    for k in LEG_NUM:
        v = _num(raw.get(k))
        if v is not None:
            leg[k] = v
    if raw.get("yes") is True:
        leg["yes"] = True
    if not leg.get("id") or not leg.get("text") or _num(leg.get("start")) is None:
        return None
    return leg


def _parlay_status(legs):
    """Lost as soon as one leg misses. Won when every leg is settled and none missed; a parlay of only pushes and voids is a push."""
    res = [l.get("res") for l in legs]
    if "miss" in res:
        return "lost"
    if any(r is None for r in res):
        return "open"
    return "won" if "hit" in res else "push"


def parlays_of(user):
    return _parlays.get(user["username"].lower(), [])


def parlays_action(body, user):
    op, now = body.get("op"), time.time()
    key = user["username"].lower()
    with _acct_lock:
        mine = _parlays.setdefault(key, [])
        cur = next((p for p in mine if p.get("id") == str(body.get("id") or "")), None)
        if op == "add":
            legs = [l for l in (_leg_clean(x) for x in (body.get("legs") if isinstance(body.get("legs"), list) else [])[:PARLAY_LEGS]) if l]
            if not legs:
                return 400, {"error": "Add at least one pick first."}
            if len({l["id"] for l in legs}) != len(legs):
                return 400, {"error": "The same pick is in this parlay twice."}
            late = next((l for l in legs if l["start"] / 1000 < now - 120), None)
            if late:   # a parlay is locked in before its games start, so the record can't be written after the fact
                return 400, {"error": f"{late.get('game') or late['text']} has already started. Take that pick out and save again."}
            if len(mine) >= PARLAY_MAX:
                return 400, {"error": f"You can keep {PARLAY_MAX} parlays. Delete an old one first."}
            p = {"id": "p" + secrets.token_hex(6), "at": int(now * 1000), "name": re.sub(r"\s+", " ", str(body.get("name") or "")).strip()[:80],
                 "legs": legs, "status": "open"}
            for k, lo, hi in (("odds", -100000, 1000000), ("stake", 0, 1e6), ("ours0", 0, 1), ("market0", 0, 1)):
                v = _num(body.get(k), lo, hi)
                if v is not None and not (k == "odds" and -100 < v < 100):
                    p[k] = v
            mine.insert(0, p)
            cur = p
        elif not cur:
            return 404, {"error": "That parlay is not on your account any more."}
        elif op == "delete":
            mine.remove(cur)
        elif op == "edit":   # the name, the odds you got and your stake can be changed; the picks can't
            if "name" in body:
                cur["name"] = re.sub(r"\s+", " ", str(body.get("name") or "")).strip()[:80]
            for k, lo, hi in (("odds", -100000, 1000000), ("stake", 0, 1e6)):
                if k in body:
                    v = _num(body.get(k), lo, hi)
                    if v is None or (k == "odds" and -100 < v < 100):
                        cur.pop(k, None)
                    else:
                        cur[k] = v
        elif op == "result":   # a leg's result, sent by the page once its game says so
            by = {l["id"]: l for l in cur["legs"]}
            for r in (body.get("legs") if isinstance(body.get("legs"), list) else [])[:PARLAY_LEGS]:
                leg = by.get(str(r.get("id") or "")) if isinstance(r, dict) else None
                if not leg or leg.get("res") or r.get("res") not in LEG_RESULTS or leg["start"] / 1000 > now:   # nothing settles before its game starts, or twice
                    continue
                leg["res"] = r["res"]
                v = r.get("final")
                if _num(v) is not None:
                    leg["final"] = v
                elif isinstance(v, str):
                    leg["final"] = v[:40]
            was = cur.get("status")
            cur["status"] = _parlay_status(cur["legs"])
            if cur["status"] != "open" and was == "open":
                cur["settled"] = int(now * 1000)
        else:
            return 400, {"error": "Unknown action."}
        storage.save(PARLAYS_FILE, _parlays)
        return 200, {"ok": True, "parlay": None if op == "delete" else cur, "parlays": mine}


def add_feedback(body, user):
    text = re.sub(r"\s+", " ", str(body.get("text") or "")).strip()[:1000]
    if len(text) < 3:
        return 400, {"error": "Write a few words first."}
    with _acct_lock:
        _mstate["feedback"].insert(0, {"id": secrets.token_hex(5), "at": int(time.time()), "by": user["username"] if user else "",
                                       "text": text, "page": str(body.get("page") or "")[:120], "theme": str(body.get("theme") or "")[:30]})
        del _mstate["feedback"][300:]
        _save_members()
    return 200, {"ok": True}


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def public_user(u):
    return {"username": u["username"], "display": u.get("prefs", {}).get("display") or u["username"],
            "created": u["created"], "prefs": u.get("prefs", {}), "role": role_of(u), "rank": rank_of(u),
            "status": "paused" if is_paused(u) else "active", "services": {k: has(u, k) for k in SERVICE_KEYS}}


def clean_prefs(raw, old):
    prefs = dict(old)
    for k, typ in PREF_KEYS.items():
        if k in raw and isinstance(raw[k], typ):
            v = raw[k]
            if typ is list:
                v = [x for x in v if (isinstance(x, dict) and k != "favThemes") or (k in ("favSports", "favThemes", "homeOff", "homeOrder") and isinstance(x, str) and len(x) <= 24)][:200]
            else:
                v = v.strip()[:280 if k == "bio" else 40]
                if k == "color":
                    v = RETIRED_COLORS.get(v.lower(), v)
            prefs[k] = v
    return prefs


def signup(body):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not re.fullmatch(r"[A-Za-z0-9_.]{3,20}", username):
        return 400, {"error": "Usernames are 3–20 letters, numbers, dots or underscores."}
    if len(password) < 8:
        return 400, {"error": "Use a password of at least 8 characters."}
    key = username.lower()
    with _acct_lock:
        if key in _users:
            return 409, {"error": "That username is taken. Try another."}
        inv = invite_for(str(body.get("invite") or ""))
        _users[key] = _new_user(username, password, "research" if key == ADMIN or inv else SIGNUP_ROLE, body.get("display"), body.get("prefs"),
                                rank="owner" if key == ADMIN else inv["rank"] if inv else "member", email=inv["email"] if inv else "")
        if inv:
            _mstate["invites"].remove(inv)
            log_activity(username, f"Joined from the invite sent to {inv['email']}")
            _save_members()
        token = new_session(key)
        _save_accounts()
    return 200, {"user": public_user(_users[key]), "_token": token}


def login(body):
    key = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    fails = _failures.get(key, [0, 0])
    if fails[0] >= 5 and time.time() - fails[1] < 60:
        return 429, {"error": "Too many attempts. Wait a minute and try again."}
    u = _users.get(key)
    if not u or not hmac.compare_digest(_hash(password, u["salt"]), u["hash"]):
        _failures[key] = [fails[0] + 1, time.time()]
        return 401, {"error": "That username and password don't match."}
    _failures.pop(key, None)
    with _acct_lock:
        token = new_session(key)
        _save_accounts()
    return 200, {"user": public_user(u), "_token": token}


def new_session(key):
    token = secrets.token_urlsafe(32)
    now = time.time()
    for t in [t for t, v in _sessions.items() if v["exp"] < now]:
        _sessions.pop(t, None)
    _sessions[token] = {"user": key, "exp": now + SESSION_DAYS * 86400}
    return token


def session_user(cookie_header):
    m = re.search(r"(?:^|;\s*)fl_session=([A-Za-z0-9_-]+)", cookie_header or "")
    if not m:
        return None, None
    sess = _sessions.get(m.group(1))
    if not sess or sess["exp"] < time.time():
        return None, None
    return m.group(1), _users.get(sess["user"])


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")  # always pick up a new version of the app
        super().end_headers()

    def wants_gzip(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "")

    def send_json(self, obj, status=200, max_age=0):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", f"max-age={max_age}")
        if len(body) > 1024 and self.wants_gzip():   # data travels four to eight times smaller
            body = gzip.compress(body, 1)   # the quickest setting: nearly the same size for a third of the work
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, url):
        if not url:
            self.send_response(404)
            self.send_header("Cache-Control", "max-age=86400")
            self.send_header("Content-Length", "0")
            return self.end_headers()
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Cache-Control", "max-age=86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def temporary_miss(self):
        self.send_response(503)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def session_cookie(self, token, clear=False):
        if clear:
            return "fl_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" + ("; Secure" if HOSTED else "")
        return f"fl_session={token}; Path=/; Max-Age={SESSION_DAYS * 86400}; HttpOnly; SameSite=Strict" + ("; Secure" if HOSTED else "")

    def send_auth(self, status, obj, cookie=None):
        token = obj.pop("_token", None)
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        if token or cookie:
            self.send_header("Set-Cookie", cookie or self.session_cookie(token))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def lab(self, u, q):
        if not u.path.startswith("/api/"):   # the page; Discord opens the Activity at / with frame_id and instance_id
            body = (ROOT / "lab.html").read_bytes().replace(b"__DISCORD_APP_ID__", (os.environ.get("DISCORD_APP_ID") or "").encode())
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        _, user = session_user(self.headers.get("Cookie"))
        q["_pass"] = self.headers.get("X-Lab-Pass") or ""
        board = u.path == "/api/lab/board"   # Predictions and Home read the board too
        ok = (has(user, "lab") or (board and has(user, "predictions"))) if user else not GATED
        if user and not ok and u.path not in ("/api/lab/img", "/api/lab/fonts.css", "/api/lab/session"):
            svc = "predictions" if board and has(user, "lab") else "lab"
            return self.send_json({"error": f"Your account doesn't include {SERVICE_NAME[svc]}. Ask your admin for access.", "service": svc}, 403)
        status, obj = lab.handle(u.path[len("/api/lab/"):], q, signed_in=ok)
        if isinstance(obj, tuple):
            ct, data = obj
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_header("Cache-Control", "max-age=86400")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        return self.send_json(obj, status)

    def do_HEAD(self):
        rel = urllib.parse.unquote(urllib.parse.urlparse(self.path).path).lstrip("/") or "index.html"
        if rel not in PUBLIC_FILES and not re.fullmatch(r"icons/[A-Za-z0-9_-]+\.png", rel):
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/picks/state":   # GitHub Actions hands over the pick record (encrypted with the bot token)
            length = int(self.headers.get("Content-Length") or 0)
            if length > 16_000_000:
                return self.send_json({"error": "too large"}, 413)
            import pick_tracker
            ok = pick_tracker.accept_blob(self.rfile.read(length))
            return self.send_json({"ok": ok}, 200 if ok else 409)
        if u.path == "/api/discord/interactions":   # Discord slash commands (discord_bot.py); signed by Discord, not a member login
            length = int(self.headers.get("Content-Length") or 0)
            if not discord_bot.enabled() or length > 64_000:
                return self.send_json({"error": "the Discord bot isn't set up"}, 404)
            status, obj = discord_bot.handle(self.rfile.read(length), self.headers)
            return self.send_json(obj, status)
        # JSON only: a plain form on another site can't send this content type, which blocks cross-site posts
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self.send_auth(415, {"error": "Send JSON."})
        length = int(self.headers.get("Content-Length") or 0)
        if length > 64_000:
            return self.send_auth(413, {"error": "Too large."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self.send_auth(400, {"error": "Bad JSON."})
        if u.path == "/api/auth/signup":
            addr = (self.headers.get("X-Forwarded-For") or self.client_address[0] or "").split(",")[0].strip()
            if GATED and not signup_allowed(addr):
                return self.send_auth(429, {"error": "Too many new accounts from here. Try again in an hour."})
            return self.send_auth(*signup(body))
        if u.path == "/api/auth/login":
            return self.send_auth(*login(body))
        token, user = session_user(self.headers.get("Cookie"))
        if u.path.startswith("/api/admin/"):
            if role_of(user) != "admin":
                return self.send_auth(403, {"error": "Only the admin can manage members."})
            if u.path == "/api/admin/awards":
                return self.send_auth(*awards_action(body, user))
            if u.path == "/api/admin/transfers/dates":
                return self.send_auth(*move_dates_action(body, user))
            if u.path == "/api/admin/members":
                return self.send_auth(*members_action(body, user))
            return self.send_auth(*admin_action(u.path, body, user))
        if u.path == "/api/feedback":   # a note from the Help page, kept for the admins to read
            if GATED and not user:
                return self.send_auth(401, {"error": "Log in first."})
            return self.send_auth(*add_feedback(body, user))
        if u.path == "/api/props/seen":   # the props the Predictions page showed, locked in for grading (propbook.py)
            if GATED and not (user and has(user, "predictions")):
                return self.send_auth(200, {"ok": True, "added": 0})
            items = body.get("props") if isinstance(body.get("props"), list) else []
            return self.send_auth(200, {"ok": True, "added": propbook.seen(items)})
        if u.path == "/api/forecast/track":
            if not can_research(user):
                return self.send_auth(200, {"ok": True, "added": 0})
            items = body.get("matches") if isinstance(body.get("matches"), list) else []
            n = forecaster.track(items, research=bool(user), source="account" if user else "app")
            return self.send_auth(200, {"ok": True, "added": n})
        if u.path == "/api/auth/logout":
            with _acct_lock:
                _sessions.pop(token, None)
                _save_accounts()
            return self.send_auth(200, {"ok": True}, cookie=self.session_cookie("", clear=True))
        if not user:
            return self.send_auth(401, {"error": "Log in first."})
        if u.path == "/api/picks/vote":
            if not can_view(user):
                return self.send_auth(403, {"error": "Your account is paused or waiting for an admin to switch it on."})
            if not has(user, "predictions"):
                return self.send_auth(403, {"error": "Your account doesn't include Predictions. Ask your admin for access.", "service": "predictions"})
            return self.send_auth(*cast_vote(user, body))
        if u.path == "/api/parlays":
            if not can_view(user):
                return self.send_auth(403, {"error": "Your account is paused or waiting for an admin to switch it on."})
            if not has(user, "predictions"):
                return self.send_auth(403, {"error": "Your account doesn't include Predictions. Ask your admin for access.", "service": "predictions"})
            return self.send_auth(*parlays_action(body, user))
        if u.path == "/api/me/photo":   # set or remove the member's own photo (set_avatar)
            return self.send_auth(*set_avatar(user, body))
        if u.path == "/api/me/prefs":
            if "follows" in body and not has(user, "alerts"):
                return self.send_auth(403, {"error": "Your account doesn't include Alerts. Ask your admin for access.", "service": "alerts"})
            with _acct_lock:
                user["prefs"] = clean_prefs(body, user.get("prefs", {}))
                _save_accounts()
            return self.send_auth(200, {"user": public_user(user)})
        if u.path == "/api/forecast/settings":
            if HOSTED and user["username"].lower() != ADMIN:
                return self.send_auth(403, {"error": "Only the site owner can change these settings."})
            return self.send_auth(*forecaster.update_settings(body))
        if u.path == "/api/forecast/run":
            if not can_research(user):
                return self.send_auth(403, {"error": "Your account doesn't include the Lab. Ask your admin for access.", "service": "lab"})
            key = str(body.get("key") or "")
            if not forecaster.request_now(key):
                return self.send_auth(404, {"error": "That match isn't tracked yet."})
            return self.send_auth(200, {"ok": True})
        if u.path == "/api/me/delete":
            if not hmac.compare_digest(_hash(body.get("password") or "", user["salt"]), user["hash"]):
                return self.send_auth(401, {"error": "That password isn't right."})
            with _acct_lock:
                _users.pop(user["username"].lower(), None)
                if _parlays.pop(user["username"].lower(), None) is not None:
                    storage.save(PARLAYS_FILE, _parlays)
                for t in [t for t, v in _sessions.items() if v["user"] == user["username"].lower()]:
                    _sessions.pop(t, None)
                _save_accounts()
            return self.send_auth(200, {"ok": True}, cookie=self.session_cookie("", clear=True))
        return self.send_auth(404, {"error": "unknown endpoint"})

    def do_GET(self):
        if self.path.startswith("/api/") and not self.path.startswith(("/api/me", "/api/version")):
            with _api_gate:
                return self._do_GET()
        return self._do_GET()

    def _do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if u.path == "/api/picks/state":
            import pick_tracker
            data = pick_tracker.state_blob()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if u.path.startswith("/api/lab/") or u.path == "/lab" or (u.path == "/" and "frame_id" in q and "instance_id" in q):
            return self.lab(u, q)   # Floodlight Lab (lab.py): Discord members get in with a pass, not a site login
        if u.path.startswith("/api/") and u.path not in ("/api/version", "/api/me", "/api/admin/users", "/api/admin/members", "/api/invite"):
            _, user = session_user(self.headers.get("Cookie"))
            if GATED and not user:
                return self.send_json({"error": "Log in to use Floodlight."}, 401)
            if GATED and not can_view(user):
                return self.send_json({"error": "Your account is paused or waiting for an admin to switch it on."}, 403)
            svc = service_for(u.path)   # a service switched off for this member is refused here, not just hidden in the page
            if svc and user and not has(user, svc):
                return self.send_json({"error": f"Your account doesn't include {SERVICE_NAME[svc]}. Ask your admin for access.", "service": svc}, 403)
            if user:
                touch(user)
        if u.path == "/api/picks/split":
            keys = [k for k in (q.get("keys") or "").split(",") if VOTE_KEY.fullmatch(k)][:60]
            with _acct_lock:
                return self.send_json({"splits": {k: vote_split(k) for k in keys}})
        try:
            if u.path.startswith("/api/kalshi/"):
                path = u.path[len("/api/kalshi/"):]
                if not re.fullmatch(r"(events|markets|series)(/[A-Za-z0-9._-]+)?", path):
                    return self.send_json({"error": "not allowed"}, 400)
                return self.send_json(fetch(KALSHI + path + ("?" + u.query if u.query else ""), 15, as_json=True))
            if u.path.startswith("/api/bsb/"):   # baseball outside MLB StatsAPI (baseball.py)
                try:
                    status, obj, age = baseball.handle(u.path[len("/api/bsb/"):], q)
                except OSError:   # HTTP errors, refused connections and timeouts
                    status, obj, age = 502, {"error": "source unavailable"}, 0
                return self.send_json(obj, status, max_age=age)
            if u.path.startswith("/api/bb/"):   # basketball outside ESPN (basketball.py)
                try:
                    status, obj, age = basketball.handle(u.path[len("/api/bb/"):], q)
                except OSError:   # HTTP errors, refused connections and timeouts
                    status, obj, age = 502, {"error": "source unavailable"}, 0
                return self.send_json(obj, status, max_age=age)
            if u.path.startswith("/api/hk/"):   # hockey outside ESPN, and the NHL stats API (hockey.py)
                try:
                    status, obj, age = hockey.handle(u.path[len("/api/hk/"):], q)
                except (OSError, ValueError):   # HTTP errors, refused connections, timeouts, bad JSON
                    status, obj, age = 502, {"error": "source unavailable"}, 0
                return self.send_json(obj, status, max_age=age)
            if u.path.startswith("/api/box/"):   # boxing (boxing.py)
                try:
                    status, obj, age = boxing.handle(u.path[len("/api/box/"):], q)
                except (OSError, ValueError):
                    status, obj, age = 502, {"error": "source unavailable"}, 0
                return self.send_json(obj, status, max_age=age)
            if u.path.startswith("/api/tn/"):   # tennis (tennis.py)
                try:
                    status, obj, age = tennis.handle(u.path[len("/api/tn/"):], q)
                except (OSError, ValueError):
                    status, obj, age = 502, {"error": "source unavailable"}, 0
                return self.send_json(obj, status, max_age=age)
            if u.path.startswith("/api/dfs/"):   # PrizePicks and Sleeper pick'em lines (dfs.py)
                try:
                    status, obj, age = dfs.handle(u.path[len("/api/dfs/"):], q)
                except OSError:
                    status, obj, age = 502, {"error": "source unavailable"}, 0
                return self.send_json(obj, status, max_age=age)
            if u.path == "/api/version":   # lets an open page notice that the app was updated
                return self.send_json({"v": int((ROOT / "index.html").stat().st_mtime)})
            if u.path == "/api/me":
                _, user = session_user(self.headers.get("Cookie"))
                return self.send_auth(200, {"user": public_user(user) if user else None, "gated": GATED})
            if u.path == "/api/parlays":   # the member's own tracked parlays
                _, user = session_user(self.headers.get("Cookie"))
                return self.send_auth(200, {"parlays": parlays_of(user) if user else [], "signedIn": bool(user)})
            if u.path == "/api/admin/users":
                _, user = session_user(self.headers.get("Cookie"))
                if role_of(user) != "admin":
                    return self.send_json({"error": "Only the admin can manage members."}, 403)
                return self.send_auth(200, {"users": admin_list()})
            if u.path == "/api/admin/members":
                _, user = session_user(self.headers.get("Cookie"))
                if role_of(user) != "admin":
                    return self.send_json({"error": "Only owners and admins can manage members."}, 403)
                return self.send_auth(200, members_view(user))
            if u.path == "/api/invite":   # what an invite link says, for the person opening it
                inv = invite_for(q.get("token", ""))
                return self.send_auth(200, {"ok": True, "email": inv["email"], "rank": inv["rank"], "by": inv["by"]}) if inv else self.send_auth(404, {"error": "This invite link has expired or was already used. Ask for a new one."})
            if u.path == "/api/transfers/moves":   # one league's latest moves, from the league's own transaction list
                if q.get("league") not in MOVE_SRC:
                    return self.send_json({"error": "bad request"}, 400)
                return self.send_auth(200, league_moves(q["league"]))
            if u.path == "/api/transfers/dates":   # key dates an admin has entered (trade deadline, free agency, portal and transfer windows)
                return self.send_auth(200, {"dates": _move_dates})
            if u.path == "/api/awards":   # an athlete's awards, as entered by an admin (empty until then)
                if q.get("sport") not in AWARD_SPORTS or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,40}", q.get("id", "")):
                    return self.send_json({"error": "bad request"}, 400)
                return self.send_auth(200, {"awards": awards_for(q["sport"], q["id"])})
            if u.path == "/api/record":   # Floodlight's own graded predictions (record.py)
                return self.send_json({"entries": record.entries(), "summary": record.summary(), "now": int(time.time())}, max_age=60)
            if u.path == "/api/props/record":   # every prop the Predictions page showed, locked before the start and graded (propbook.py)
                return self.send_json({"entries": propbook.entries(since=time.time() - 120 * 86400), "now": int(time.time())}, max_age=60)
            if u.path == "/api/forecast/get":
                keys = [k for k in q.get("keys", "").split(",") if re.fullmatch(r"(soccer|football):[A-Za-z0-9_-]{1,24}", k)][:40]
                return self.send_auth(200, {"forecasts": {k: forecaster.view(k) for k in keys}, "settings": forecaster.settings_view()})
            if u.path == "/api/forecast/list":   # every tracked match with its latest forecast (read-only)
                return self.send_auth(200, {"matches": forecaster.upcoming(), "now": int(time.time())})
            if u.path == "/api/ufc/rankings":   # the official UFC rankings, read from ufc.com (ufcdata.py)
                return self.send_json(ufcdata.rankings(), max_age=900)
            if u.path == "/api/ufc/events":   # the UFC's own list of upcoming events
                return self.send_json(ufcdata.events(), max_age=600)
            if u.path == "/api/odds/board":
                if q.get("sport") not in ("soccer", "football", "basketball", "baseball") or not re.fullmatch(r"[A-Za-z0-9_.]{1,20}", q.get("lg", "")):
                    return self.send_json({"error": "bad request"}, 400)
                if q.get("kx") and not re.fullmatch(r"[A-Z0-9]{2,20}", q["kx"]):
                    return self.send_json({"error": "bad kx"}, 400)
                if q.get("espn") and not re.fullmatch(r"(soccer|football|basketball|baseball)/[a-z0-9_.-]{1,30}", q["espn"]):
                    return self.send_json({"error": "bad espn"}, 400)
                if q.get("id") and not re.fullmatch(r"\d{1,12}", q["id"]):
                    q.pop("id")
                b = odds.board(q)
                return self.send_json({**b, "value": odds.value_picks(b)})
            if u.path == "/api/avatar":   # a member's photo (set_avatar); the address carries the time it was set, so it caches for a day
                a = _avatars.get(str(q.get("u") or "").lower())
                if not a:
                    return self.send_json({"error": "no photo"}, 404)
                import base64
                data = base64.b64decode(a["data"])
                self.send_response(200)
                self.send_header("Content-Type", a["type"])
                self.send_header("Cache-Control", "private, max-age=86400")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                return self.wfile.write(data)
            if u.path == "/api/odds/history":   # every kept price reading for a game (linehist.py), same inputs as the board
                if q.get("sport") not in ("soccer", "football", "basketball", "baseball") or not re.fullmatch(r"[A-Za-z0-9_.]{1,20}", q.get("lg", "")):
                    return self.send_json({"error": "bad request"}, 400)
                return self.send_json(linehist.history(q))
            if u.path == "/api/tm/search":
                clubs, players = tm_search(q.get("q", ""))
                return self.send_json({"clubs": clubs[:10], "players": players[:12]}, max_age=3600)
            if u.path == "/api/img/player":
                try:
                    return self.redirect(tm_photo(q.get("name", ""), q.get("club", "")))
                except (Cooling, urllib.error.HTTPError, urllib.error.URLError):
                    return self.temporary_miss()
            if u.path == "/api/img/team":
                try:
                    return self.redirect(tm_crest(q.get("name", "")))
                except (Cooling, urllib.error.HTTPError, urllib.error.URLError):
                    return self.temporary_miss()
            if u.path == "/api/tm/squad":
                return self.send_json(tm_squad(q.get("team", "")), max_age=600)
            if u.path == "/api/tm/player":
                name, club = q.get("name", ""), q.get("club", "")
                try:
                    r = tm_player(name, club)
                except Exception:
                    r = None
                if not r or r.get("error") or not r.get("current"):
                    r = fm_player_value(name, club) or r or {"error": "no market value found"}
                return self.send_json(r, max_age=600)
            if u.path == "/api/tm/transfers/club":
                return self.send_json(tm_club_transfers(q.get("team", ""), int(q.get("season", "2026"))), max_age=3600)
            if u.path == "/api/tm/transfers/top":
                return self.send_json(tm_top_transfers(int(q.get("season", "2026")), int(q.get("page", "1"))), max_age=3600)
            if u.path == "/api/tm/transfers/feed":
                kind = "day" if q.get("kind") == "day" else "latest"
                day = q.get("day", "")
                if kind == "day" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                    return self.send_json({"error": "day must be YYYY-MM-DD"}, 400)
                return self.send_json(tm_feed(kind, day, max(1, min(200, int(q.get("page", "1"))))))
            if u.path == "/api/tm/transfers/player":
                return self.send_json(tm_player_transfers(q.get("name", ""), q.get("club", "")), max_age=3600)
            if u.path == "/api/fm/team":
                tid = q.get("id") if re.fullmatch(r"\d{1,9}", q.get("id", "")) else None
                return self.send_json(fm_team(q.get("name", ""), tid), max_age=300)
            if u.path == "/api/fm/league":
                if not re.fullmatch(r"\d{1,7}", q.get("id", "")):
                    return self.send_json({"error": "id must be a FotMob league id"}, 400)
                return self.send_json(fm_league(int(q["id"])))
            if u.path == "/api/fm/leaguefixtures":
                if not re.fullmatch(r"\d{1,7}", q.get("id", "")) or not re.fullmatch(r"(\d{4}(/\d{4})?)?", q.get("season", "")):
                    return self.send_json({"error": "need a FotMob league id and a season like 2024/2025"}, 400)
                return self.send_json(fm_league_fixtures(int(q["id"]), q.get("season", "")), max_age=3600)
            if u.path == "/api/fm/match":
                if not re.fullmatch(r"\d{1,12}", q.get("id", "")):
                    return self.send_json({"error": "id must be a FotMob match id"}, 400)
                return self.send_json(fm_match(q["id"]))
            if u.path == "/api/fm/leaders":
                return self.send_json(fm_leaders(q.get("slug", ""), q.get("name", "")), max_age=600)
            if u.path == "/api/fm/matchstats":
                if re.fullmatch(r"\d{1,12}", q.get("id", "")):
                    return self.send_json(fm_matchstats(mid=q["id"]), max_age=30)
                if not re.fullmatch(r"\d{8}", q.get("date", "")):
                    return self.send_json({"error": "need id or date=YYYYMMDD with home and away"}, 400)
                return self.send_json(fm_matchstats(date=q["date"], home=q.get("home", ""), away=q.get("away", "")), max_age=30)
            if u.path == "/api/fm/player":
                pid = q.get("id") if re.fullmatch(r"\d{1,10}", q.get("id", "")) else None
                if not pid and not q.get("name"):
                    return self.send_json({"error": "need id or name"}, 400)
                return self.send_json(fm_player(pid, q.get("name", ""), q.get("club", "")), max_age=600)
            if u.path == "/api/fm/playerstats":
                if not re.fullmatch(r"\d{1,10}", q.get("id", "")) or not re.fullmatch(r"\d{1,2}-\d{1,2}", q.get("season", "")):
                    return self.send_json({"error": "need id and season (entryId like 0-1)"}, 400)
                return self.send_json(fm_playerstats(q["id"], q["season"]), max_age=600)
            if u.path == "/api/fm/lineup":
                if not re.fullmatch(r"\d{8}", q.get("date", "")):
                    return self.send_json({"error": "date must be YYYYMMDD"}, 400)
                return self.send_json(fm_lineup(q["date"], q.get("home", ""), q.get("away", "")), max_age=300)
        except Cooling as e:
            return self.send_json({"error": "busy", "detail": str(e)}, 503)
        except urllib.error.HTTPError as e:
            return self.send_json({"error": f"upstream {e.code}"}, 502)
        except Exception as e:  # network trouble or a page layout change
            return self.send_json({"error": str(e)[:200]}, 502)
        if u.path.startswith("/api/"):
            return self.send_json({"error": "unknown endpoint"}, 404)
        rel = urllib.parse.unquote(u.path).lstrip("/") or "index.html"
        if rel not in PUBLIC_FILES and not re.fullmatch(r"icons/[A-Za-z0-9_-]+\.png", rel):
            self.send_error(404)
            return
        if rel.endswith((".html", ".js", ".css", ".webmanifest")):
            return self.send_static(rel)
        return super().do_GET()

    def send_static(self, rel):
        """The app's own files, compressed once and kept in memory. A browser that already has the current
        version gets a short "not modified" answer instead of the file."""
        path = ROOT / rel
        try:
            st = path.stat()
        except OSError:
            return self.send_error(404)
        stamp = (st.st_mtime_ns, st.st_size)
        with _static_lock:
            hit = _static.get(rel)
            if not hit or hit[3] != stamp:
                raw = path.read_bytes()
                # the tag follows the file's contents, so a new deploy only re-sends the files that really changed
                hit = _static[rel] = ('"' + hashlib.sha1(raw).hexdigest()[:16] + '"', raw, gzip.compress(raw, 9), stamp)
        tag = hit[0]
        if self.headers.get("If-None-Match") == tag:
            self.send_response(304)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "no-cache")
            return self.end_headers()
        zipped = self.wants_gzip()
        body = hit[2] if zipped else hit[1]
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(path)) + ("; charset=utf-8" if not rel.endswith(".webmanifest") else ""))
        self.send_header("ETag", tag)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Vary", "Accept-Encoding")
        if zipped:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


_static = {}
_static_lock = threading.Lock()


# ---------- memory guard ----------
# Free hosts give the server 512 MB. The page caches below can grow past that on a busy day, and the host then
# restarts the server (visitors see "502 Bad Gateway"). This empties the caches before that happens.
MEM_LIMIT_MB = int(os.environ.get("FLOODLIGHT_MEM_MB") or (280 if HOSTED else 0))
# At most this many data requests are worked on at once; the rest wait their turn, which keeps memory steady.
_api_gate = threading.BoundedSemaphore(int(os.environ.get("FLOODLIGHT_API_THREADS") or (6 if HOSTED else 64)))


def _rss_mb():
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except Exception:
        pass
    return 0


def _memory_guard():
    import gc
    while True:
        time.sleep(3)
        used = _rss_mb()
        if used < MEM_LIMIT_MB:
            continue
        for mod in (sys.modules[__name__], baseball, basketball, dfs, discord_bot, sys.modules.get("baseball_asia"), sys.modules.get("baseball_banana")):
            c = getattr(mod, "_cache", None)
            if isinstance(c, dict):
                c.clear()
        tennis._rank_cache.clear()
        gc.collect()
        print(f"memory guard: {used:.0f} MB in use, cleared caches, now {_rss_mb():.0f} MB")


if __name__ == "__main__":
    import atexit
    atexit.register(save_photos)
    linehist.setup(CACHE_DIR, al=odds._al, similar=similar)
    atexit.register(linehist.flush)
    odds.setup(fetch=fetch, similar=similar, on_board=linehist.record)
    ufcdata.setup(fetch=fetch, cache_dir=CACHE_DIR)
    ensure_admin()
    migrate_members()
    retire_colors()
    if MEM_LIMIT_MB:
        threading.Thread(target=_memory_guard, daemon=True, name="memory-guard").start()
    forecaster.setup(odds=odds, fetch=fetch, similar=similar, tm_squad=tm_squad, fm_team=fm_team, fm_league=fm_league,
                     users=lambda: _users, cache_dir=CACHE_DIR)
    record.setup(fetch=fetch, fm_matchstats=fm_matchstats, forecaster=forecaster, cache_dir=CACHE_DIR)
    import pick_grade   # the Discord pick grader grades the site's props too
    pick_grade.D["fetch"] = fetch
    propbook.setup(cache_dir=CACHE_DIR, board=lab.board, grade=pick_grade.grade_prop, mlb=propbook.mlb_grade(discord_bot))
    if discord_bot.enabled():
        discord_bot.setup(fetch=fetch, similar=similar, fm_player=fm_player, fm_matchstats=fm_matchstats, fm_lineup=fm_lineup,
                          odds=odds, dfs=dfs, record=record, forecaster=forecaster, fm_team=fm_team, cache_dir=CACHE_DIR)
        import pick_tracker
        pick_tracker.setup(similar=similar, fetch=fetch, cache_dir=CACHE_DIR)
        print("Discord bot: listening at /api/discord/interactions")
    else:   # the Lab (lab.py) reads players through the bot's loaders even without the bot
        discord_bot.D.update(fetch=fetch, similar=similar, fm_player=fm_player, fm_matchstats=fm_matchstats, fm_lineup=fm_lineup, odds=odds, dfs=dfs, fm_team=fm_team)
    print(f"Floodlight running at http://localhost:{PORT}")
    if LAN:
        import socket
        try:
            s_ = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s_.connect(("10.255.255.255", 1)); ip = s_.getsockname()[0]; s_.close()
        except Exception:
            ip = "your-mac's-ip"
        host = socket.gethostname().split(".")[0]
        print(f"On your phone (same Wi-Fi): http://{ip}:{PORT}   or   http://{host}.local:{PORT}")
        print("Anyone on this Wi-Fi can open it while it runs. Use it on your home network only.")
    # The page asks for ~25 scripts and a dozen data feeds at once; the default listen backlog of 5 dropped some of
    # them (a script that never arrives leaves half the page undefined). Give the queue room.
    ThreadingHTTPServer.request_queue_size = 256
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer(("0.0.0.0" if (LAN or HOSTED) else "127.0.0.1", PORT), Handler).serve_forever()
