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
import forecaster
import dfs
import odds
import storage

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
# Only these files are served to browsers; everything else (Python code, the cache folder with
# accounts and the API key) stays private.
PUBLIC_FILES = {"index.html", "manifest.webmanifest", "baseball.js", "basketball.js", "books.js", "football.js",
                "forecast.js", "hockey.js", "predfilter.js", "research.js", "tennis.js", "access.js"}
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
PREF_KEYS = {"favTeams": list, "favPlayers": list, "favLeagues": list, "picks": list, "color": str, "bio": str, "display": str}


_users = storage.load(USERS_FILE, {})
_sessions = storage.load(SESSIONS_FILE, {})
_failures = {}


def _save_accounts():
    storage.save(USERS_FILE, _users)
    storage.save(SESSIONS_FILE, _sessions)


def role_of(u):
    """admin, research (everything), viewer (games only) or pending (waiting for the admin)."""
    if not u:
        return None
    if ADMIN and u["username"].lower() == ADMIN:
        return "admin"
    if not GATED:
        return "research"   # running on your own computer: every account can use everything
    return u.get("role") if u.get("role") in ROLES else "pending"


def can_view(u):
    return not GATED or role_of(u) in ("viewer", "research", "admin")


def can_research(u):
    return not GATED or role_of(u) in ("research", "admin")


def _new_user(username, password, role, display=None, prefs=None):
    salt = secrets.token_hex(16)
    return {"username": username, "salt": salt, "hash": _hash(password, salt), "created": int(time.time()), "role": role,
            "prefs": clean_prefs(prefs or {}, {"display": (display or username).strip()[:40]})}


def ensure_admin():
    """Recreate the admin account from FLOODLIGHT_ADMIN_PASSWORD if it's missing, so you can always log in."""
    if not (ADMIN and ADMIN_PASSWORD) or ADMIN in _users or not re.fullmatch(r"[a-z0-9_.]{3,20}", ADMIN):
        return
    with _acct_lock:
        _users[ADMIN] = _new_user(ADMIN, ADMIN_PASSWORD, "admin")
        _save_accounts()
    print(f"Created the admin account '{ADMIN}'")


def admin_list():
    rows = [{"username": u["username"], "display": u.get("prefs", {}).get("display") or u["username"],
             "role": role_of(u), "created": u.get("created", 0)} for u in _users.values()]
    order = {"pending": 0, "admin": 1, "research": 2, "viewer": 3}
    return sorted(rows, key=lambda r: (order.get(r["role"], 9), -r["created"]))


def admin_action(path, body):
    key = str(body.get("username") or "").strip().lower()
    if path == "/api/admin/add":
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        role = body.get("role") if body.get("role") in ("viewer", "research") else "viewer"
        if not re.fullmatch(r"[A-Za-z0-9_.]{3,20}", username):
            return 400, {"error": "Usernames are 3–20 letters, numbers, dots or underscores."}
        if len(password) < 8:
            return 400, {"error": "Use a password of at least 8 characters."}
        with _acct_lock:
            if key in _users:
                return 409, {"error": "That username is taken."}
            _users[key] = _new_user(username, password, role)
            _save_accounts()
        return 200, {"users": admin_list()}
    u = _users.get(key)
    if not u:
        return 404, {"error": "No member with that username."}
    if role_of(u) == "admin":
        return 400, {"error": "You can't change the admin account here."}
    with _acct_lock:
        if path == "/api/admin/set":
            if body.get("role") not in ROLES:
                return 400, {"error": "Pick viewer, research or pending."}
            u["role"] = body["role"]
        elif path == "/api/admin/remove":
            _users.pop(key, None)
            for t in [t for t, v in _sessions.items() if v["user"] == key]:
                _sessions.pop(t, None)
        else:
            return 404, {"error": "unknown endpoint"}
        _save_accounts()
    return 200, {"users": admin_list()}


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def public_user(u):
    return {"username": u["username"], "display": u.get("prefs", {}).get("display") or u["username"],
            "created": u["created"], "prefs": u.get("prefs", {}), "role": role_of(u)}


def clean_prefs(raw, old):
    prefs = dict(old)
    for k, typ in PREF_KEYS.items():
        if k in raw and isinstance(raw[k], typ):
            v = raw[k]
            if typ is list:
                v = [x for x in v if isinstance(x, dict)][:200]
            else:
                v = v.strip()[:280 if k == "bio" else 40]
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
        _users[key] = _new_user(username, password, "admin" if key == ADMIN else "pending",
                                body.get("display"), body.get("prefs"))
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

    def send_json(self, obj, status=200, max_age=0):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", f"max-age={max_age}")
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

    def do_HEAD(self):
        rel = urllib.parse.unquote(urllib.parse.urlparse(self.path).path).lstrip("/") or "index.html"
        if rel not in PUBLIC_FILES and not re.fullmatch(r"icons/[A-Za-z0-9_-]+\.png", rel):
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
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
            return self.send_auth(*signup(body))
        if u.path == "/api/auth/login":
            return self.send_auth(*login(body))
        token, user = session_user(self.headers.get("Cookie"))
        if u.path.startswith("/api/admin/"):
            if role_of(user) != "admin":
                return self.send_auth(403, {"error": "Only the admin can manage members."})
            return self.send_auth(*admin_action(u.path, body))
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
        if u.path == "/api/me/prefs":
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
                return self.send_auth(403, {"error": "Your account doesn't include research."})
            key = str(body.get("key") or "")
            if not forecaster.request_now(key):
                return self.send_auth(404, {"error": "That match isn't tracked yet."})
            return self.send_auth(200, {"ok": True})
        if u.path == "/api/me/delete":
            if not hmac.compare_digest(_hash(body.get("password") or "", user["salt"]), user["hash"]):
                return self.send_auth(401, {"error": "That password isn't right."})
            with _acct_lock:
                _users.pop(user["username"].lower(), None)
                for t in [t for t, v in _sessions.items() if v["user"] == user["username"].lower()]:
                    _sessions.pop(t, None)
                _save_accounts()
            return self.send_auth(200, {"ok": True}, cookie=self.session_cookie("", clear=True))
        return self.send_auth(404, {"error": "unknown endpoint"})

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if GATED and u.path.startswith("/api/") and u.path not in ("/api/version", "/api/me", "/api/admin/users"):
            _, user = session_user(self.headers.get("Cookie"))
            if not user:
                return self.send_json({"error": "Log in to use Floodlight."}, 401)
            if not can_view(user):
                return self.send_json({"error": "Your account is waiting for the admin to approve it."}, 403)
            if u.path.startswith(("/api/dfs/", "/api/forecast/")) and not can_research(user):
                return self.send_json({"error": "Your account doesn't include research."}, 403)
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
            if u.path == "/api/admin/users":
                _, user = session_user(self.headers.get("Cookie"))
                if role_of(user) != "admin":
                    return self.send_json({"error": "Only the admin can manage members."}, 403)
                return self.send_auth(200, {"users": admin_list()})
            if u.path == "/api/forecast/get":
                keys = [k for k in q.get("keys", "").split(",") if re.fullmatch(r"(soccer|football):[A-Za-z0-9_-]{1,24}", k)][:40]
                return self.send_auth(200, {"forecasts": {k: forecaster.view(k) for k in keys}, "settings": forecaster.settings_view()})
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
        return super().do_GET()


if __name__ == "__main__":
    import atexit
    atexit.register(save_photos)
    odds.setup(fetch=fetch, similar=similar)
    ensure_admin()
    forecaster.setup(odds=odds, fetch=fetch, similar=similar, tm_squad=tm_squad, fm_team=fm_team, fm_league=fm_league,
                     users=lambda: _users, cache_dir=CACHE_DIR)
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
    ThreadingHTTPServer(("0.0.0.0" if (LAN or HOSTED) else "127.0.0.1", PORT), Handler).serve_forever()
