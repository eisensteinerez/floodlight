"""Boxing for Floodlight (/api/box/...).

Fight nights come from TheSportsDB's free boxing calendar, read one day at a time (the free tier only lists a single
"next" event otherwise) and kept in memory so a visitor never waits on more than a handful of requests.
The tale of the tape (height, reach, stance, record, knockouts) comes from each boxer's Wikipedia infobox.

  /api/box/cards            fight nights from ten days back to five weeks ahead
  /api/box/fighter?name=    one boxer: record, measurements, photo
"""
import datetime
import re
import threading
import time
import urllib.parse

import basketball as fs   # the shared cached fetcher

TSDB = "https://www.thesportsdb.com/api/v1/json/123"
LEAGUE = 4445
WIKI = "https://en.wikipedia.org/w/api.php"
BACK, AHEAD = 10, 35
BATCH = 14            # new day requests per call: the free tier allows about 30 a minute
_days = {}            # iso date -> (fetched at, [events])
_lock = threading.Lock()


def _event(x):
    name = (x.get("strEvent") or "").strip()
    m = re.match(r"^(?:(.*?\d+):?\s+)?(.+?)\s+vs\.?\s+(.+)$", name, re.I)
    ts = x.get("strTimestamp") or ((x.get("dateEvent") or "") + "T" + (x.get("strTime") or "00:00:00"))
    return {
        "id": str(x.get("idEvent") or ""), "name": name, "series": (m.group(1) or "").strip() if m else "",
        "a": m.group(2).strip() if m else name, "b": m.group(3).strip() if m else "",
        "ts": ts[:19] + "Z" if ts and len(ts) >= 19 else "", "date": x.get("dateEvent") or "",
        "timed": bool(x.get("strTime")) and x.get("strTime") != "00:00:00",
        "venue": x.get("strVenue") or "", "city": x.get("strCity") or "", "country": x.get("strCountry") or "",
        "thumb": x.get("strThumb") or "", "poster": x.get("strPoster") or "", "status": (x.get("strStatus") or "").strip(),
        "result": (x.get("strResult") or "").strip(), "desc": (x.get("strDescriptionEN") or "").strip(),
        "postponed": (x.get("strPostponed") or "").lower() == "yes", "video": x.get("strVideo") or "",
    }


def _ttl(iso, today):
    d = datetime.date.fromisoformat(iso)
    return 600 if d == today else 6 * 3600 if d < today else 2 * 3600


def cards():
    today = datetime.datetime.utcnow().date()
    wanted = sorted((today + datetime.timedelta(days=i) for i in range(-BACK, AHEAD + 1)), key=lambda d: abs((d - today).days))
    now, left, missing = time.time(), BATCH, 0
    for d in wanted:
        iso = d.isoformat()
        with _lock:
            hit = _days.get(iso)
        if hit and now - hit[0] < _ttl(iso, today):
            continue
        if left <= 0:
            missing += 1
            continue
        left -= 1
        try:
            data = fs._get(f"{TSDB}/eventsday.php?d={iso}&l={LEAGUE}", 300, {"Referer": "https://www.thesportsdb.com/"}, as_json=True) or {}
            evs = [_event(x) for x in (data.get("events") or []) if str(x.get("idLeague") or LEAGUE) == str(LEAGUE)]
            with _lock:
                _days[iso] = (now, evs)
        except (OSError, ValueError):
            left = 0          # most likely the rate limit: stop here and let the next call carry on
            missing += 1
    seen, out = set(), []
    with _lock:
        for iso, (_, evs) in _days.items():
            for e in evs:
                if e["id"] not in seen:
                    seen.add(e["id"])
                    out.append(e)
    if not out:   # nothing yet (first call, or rate limited): the single next and last events are better than an empty page
        for path in ("eventsnextleague", "eventspastleague"):
            try:
                data = fs._get(f"{TSDB}/{path}.php?id={LEAGUE}", 900, {"Referer": "https://www.thesportsdb.com/"}, as_json=True) or {}
                for x in data.get("events") or []:
                    e = _event(x)
                    if e["id"] not in seen:
                        seen.add(e["id"])
                        out.append(e)
            except (OSError, ValueError):
                pass
    out.sort(key=lambda e: e["ts"] or e["date"])
    return {"events": out, "partial": missing > 0}


# ---------- the tale of the tape, from Wikipedia ----------

def _clean(v):
    v = re.sub(r"<!--.*?-->", "", v or "", flags=re.S)
    v = re.sub(r"<ref[^>]*/>|<ref.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\{\{(?:nowrap|small|nobr)\|([^{}]*)\}\}", r"\1", v, flags=re.I)
    v = re.sub(r"<br\s*/?>", ", ", v, flags=re.I)
    v = re.sub(r"<[^>]+>", "", v)
    return re.sub(r"\s+", " ", v).strip(" ,")


def _field(text, *keys):
    for k in keys:
        m = re.search(r"^\s*\|\s*" + re.escape(k) + r"\s*=[ \t]*(.*)$", text, re.M | re.I)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return ""


def _length_cm(raw):
    """Centimetres from the many ways an infobox writes a height or reach."""
    if not raw:
        return None
    r = raw.replace("&nbsp;", " ")
    m = re.search(r"\{\{\s*(?:convert|cvt)\s*\|\s*(\d+)\s*\|\s*ft\s*(?:\|\s*([\d.]+)\s*\|\s*in)?", r, re.I)
    if m:
        return round(int(m.group(1)) * 30.48 + float(m.group(2) or 0) * 2.54)
    m = re.search(r"\{\{\s*height\s*\|(.*?)\}\}", r, re.I)
    if m:
        p = dict(re.findall(r"(ft|in|cm|m)\s*=\s*([\d.]+)", m.group(1)))
        if "cm" in p:
            return round(float(p["cm"]))
        if "m" in p:
            return round(float(p["m"]) * 100)
        if "ft" in p:
            return round(float(p["ft"]) * 30.48 + float(p.get("in", 0)) * 2.54)
    m = re.search(r"\{\{\s*(?:convert|cvt)\s*\|\s*([\d.]+)\s*\|\s*(cm|in|m)\b", r, re.I)
    if m:
        v, u = float(m.group(1)), m.group(2).lower()
        return round(v if u == "cm" else v * 2.54 if u == "in" else v * 100)
    m = re.search(r"(\d)\s*(?:ft|')\s*(\d{1,2}(?:\.\d)?)?", r)
    if m:
        return round(int(m.group(1)) * 30.48 + float(m.group(2) or 0) * 2.54)
    m = re.search(r"(\d\.\d+)\s*m\b", r)
    if m:
        return round(float(m.group(1)) * 100)
    m = re.search(r"(\d{2})(\s*[+ ]\s*1/2|½)?\s*in\b", r)
    if m:
        return round((int(m.group(1)) + (.5 if m.group(2) else 0)) * 2.54)
    m = re.search(r"([\d.]+)\s*cm", r)
    if m:
        return round(float(m.group(1)))
    m = re.search(r"([\d.]+)\s*in\b", r)
    if m:
        return round(float(m.group(1)) * 2.54)
    return None


def _int(raw):
    m = re.search(r"\d+", _clean(raw))
    return int(m.group()) if m else None


def _page(title):
    qs = urllib.parse.urlencode({"action": "query", "prop": "revisions|pageimages", "rvprop": "content", "rvsection": 0, "rvslots": "main", "redirects": 1,
                                 "piprop": "thumbnail", "pithumbsize": 500, "format": "json", "formatversion": 2, "titles": title})
    d = fs._get(f"{WIKI}?{qs}", 86400, {"Referer": "https://en.wikipedia.org/", "Accept": "application/json"}, as_json=True) or {}
    p = ((d.get("query") or {}).get("pages") or [{}])[0]
    if p.get("missing") or not p.get("revisions"):
        return None
    text = p["revisions"][0].get("slots", {}).get("main", {}).get("content", "")
    return {"title": p.get("title", title), "text": text, "photo": (p.get("thumbnail") or {}).get("source", "")}


def fighter(name):
    name = re.sub(r"\s+", " ", name or "").strip()
    page = None
    for title in (name, f"{name} (boxer)"):
        try:
            p = _page(title)
        except (OSError, ValueError):
            p = None
        if p and re.search(r"\{\{\s*Infobox\s+(boxer|martial artist|sportsperson)", p["text"], re.I):
            page = p
            break
    if not page:
        return {"name": name, "found": False}
    t = page["text"]
    born = None
    m = re.search(r"\{\{\s*birth[ _-]date(?: and age)?\s*\|([^}]*)\}\}", _field(t, "birth_date"), re.I)
    if m:
        nums = [int(x) for x in re.findall(r"(?<![=\w])\d+(?!\w)", m.group(1))][:3]
        if len(nums) == 3:
            try:
                born = datetime.date(*nums)
            except ValueError:
                born = None
    today = datetime.date.today()
    wins, ko, losses, draws, total = (_int(_field(t, k)) for k in ("wins", "KO", "losses", "draws", "total"))
    return {
        "name": _clean(_field(t, "name", "realname")) or page["title"].split(" (")[0], "found": True, "title": page["title"],
        "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_")), "photo": page["photo"],
        "nickname": _clean(_field(t, "nickname", "other_names")).split(",")[0].strip('"“” '), "nationality": _clean(_field(t, "nationality")),
        "birthplace": _clean(re.sub(r"\{\{[^{}]*\}\}", "", _field(t, "birth_place"))), "stance": _clean(_field(t, "style", "stance")),
        "division": ", ".join(re.findall(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", _field(t, "weight", "weight_class")))[:120] or _clean(re.sub(r"\{\{[^{}]*\}\}", "", _field(t, "weight", "weight_class"))),
        "height": _length_cm(_field(t, "height")), "reach": _length_cm(_field(t, "reach")),
        "born": born.isoformat() if born else "", "age": (today.year - born.year - ((today.month, today.day) < (born.month, born.day))) if born else None,
        "wins": wins, "ko": ko, "losses": losses, "draws": draws, "total": total,
    }


def handle(path, q):
    """Returns (status, payload, max_age) for an /api/box/ request."""
    if path == "cards":
        return 200, cards(), 120
    if path == "fighter":
        name = q.get("name", "")
        if not re.fullmatch(r"[^\x00-\x1f<>{}\[\]|#]{2,60}", name):
            return 400, {"error": "bad name"}, 0
        return 200, fighter(name), 3600
    return 404, {"error": "not found"}, 0
