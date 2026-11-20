"""Floodlight · UFC rankings and upcoming events, read from the UFC's own site.

ESPN's MMA rankings feed falls weeks behind and sometimes names the wrong champion, so the site reads the official
rankings page (ufc.com/rankings) and the official events list (ufc.com/events) here, on the server, where the browser
can't (no cross-site access). Both are plain HTML. The parsers look for the parts that carry meaning (division
headings, athlete links, the word "Champion", rank cells, event links and their timestamps) rather than a fixed
layout, so a change of styling on ufc.com does not break them. The last good copy is kept on disk and served when
ufc.com can't be reached; the page then says how old it is.
"""
import datetime
import html
import json
import re
import threading
import time
import unicodedata

D = {}   # fetch and the cache folder, from server.py
RANK_URL = "https://www.ufc.com/rankings"
EVENTS_URL = "https://www.ufc.com/events"
RANK_TTL, EVENTS_TTL = 3 * 3600, 1800
_lock = threading.Lock()
_mem = {}


def setup(**deps):
    D.update(deps)


def _text(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return " ".join(html.unescape(s).split())


def name_key(s):
    """The same fighter under any spelling: accents dropped, punctuation and suffixes gone, word order ignored."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", s.replace("'", "")).split() if w not in ("jr", "sr", "ii", "iii")]
    return " ".join(sorted(words))


def _athlete(chunk):
    m = re.search(r'<a[^>]+href="(?:https?://www\.ufc\.com)?/athlete/([a-z0-9-]+)"[^>]*>(.*?)</a>', chunk, re.S)
    if not m:
        return None
    name = _text(m.group(2))
    return {"name": name, "slug": m.group(1), "key": name_key(name)} if name else None


def _change(t):
    t = t.lower()
    m = re.search(r"(increased|decreased)\s+by\s+(\d+)", t)
    if m:
        return int(m.group(2)) * (1 if m.group(1) == "increased" else -1)
    return "new" if re.fullmatch(r"\s*(nr|new)\s*", t) else 0


def parse_rankings(page):
    """Every division in page order: {name, kind: p4p|division, women, champ: [..], list: [{rank, name, slug, key, change}]}."""
    # the page has a second, "meta" set of rankings further down; only the official one is read
    meta = re.search(r"meta\s+rankings", page, re.I)
    heads = [m for m in re.finditer(r"<h4[^>]*>(.*?)</h4>", page, re.S) if not meta or m.start() < meta.start()]
    out = []
    for i, h in enumerate(heads):
        title = _text(h.group(1))
        if not title or len(title) > 60:
            continue
        end = heads[i + 1].start() if i + 1 < len(heads) else (meta.start() if meta else len(page))
        block = page[h.end():end]
        p4p = "pound" in title.lower()
        div = {"name": re.sub(r"\s*top rank\s*$", "", title, flags=re.I), "kind": "p4p" if p4p else "division", "women": title.lower().startswith("women"),
               "champ": [], "list": []}
        # the lead athlete sits under the heading: the champion in a division, number one in a pound-for-pound list
        tbody = re.search(r"<tbody", block)
        lead_part = block[:tbody.start()] if tbody else block
        for m in re.finditer(r"<h5[^>]*>(.*?)</h5>(.*?)(?=<h5|$)", lead_part, re.S):
            a = _athlete(m.group(1))
            if not a:
                continue
            label = _text(" ".join(re.findall(r"<h6[^>]*>(.*?)</h6>", m.group(2), re.S)))
            if p4p:
                div["list"].append({**a, "rank": 1, "change": 0})
            elif "champion" in label.lower() or not label:
                div["champ"].append({**a, "interim": "interim" in label.lower()})
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", block[tbody.start():] if tbody else "", re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
            a = next((x for x in (_athlete(c) for c in cells) if x), None)
            if not a or not cells:
                continue
            rank_txt = _text(cells[0])
            if re.search(r"interim|\bic\b", rank_txt, re.I):   # an interim champion listed in the table
                div["champ"].append({**a, "interim": True})
                continue
            m = re.search(r"\d+", rank_txt)
            if not m:
                continue
            div["list"].append({**a, "rank": int(m.group(0)), "change": _change(_text(cells[-1]) if len(cells) > 2 else "")})
        if div["champ"] or div["list"]:
            out.append(div)
    return out


def _updated(page):
    m = re.search(r"last\s+updated[^A-Za-z]*(?:<[^>]+>\s*)*([A-Z][a-z]+day,?\s+[A-Z][a-z]{2,8}\.?\s+\d{1,2})", page, re.I | re.S)
    return m.group(1).strip() if m else ""


EVENT_TZ = {"EST": -5, "EDT": -4, "CST": -6, "CDT": -5, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7, "GMT": 0, "UTC": 0, "BST": 1}
MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}


def _when(text, now):
    """'Sat, Nov 21 / 1:00 PM EST' with no year: the next such date on or after about a month ago."""
    m = re.search(r"([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2})\s*/\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*([A-Z]{2,4})?", text)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    mon, day, hh, mm = MONTHS[m.group(1).lower()], int(m.group(2)), int(m.group(3)) % 12, int(m.group(4))
    hh += 12 if m.group(5) == "PM" else 0
    tz = datetime.timezone(datetime.timedelta(hours=EVENT_TZ.get(m.group(6) or "EST", -5)))
    base = datetime.datetime.fromtimestamp(now, tz)
    for y in (base.year - 1, base.year, base.year + 1):
        try:
            t = datetime.datetime(y, mon, day, hh, mm, tzinfo=tz).timestamp()
        except ValueError:
            continue
        if t > now - 40 * 86400:
            return int(t)
    return None


def _event_name(slug, headline):
    m = re.fullmatch(r"ufc-(\d+)", slug)
    if m:
        return f"UFC {m.group(1)}"
    if "fight-night" in slug:
        return "UFC Fight Night"
    return " ".join(w.upper() if w == "ufc" else w.capitalize() for w in re.sub(r"-\d{2}-\d{4}$", "", slug).split("-")) or "UFC"


def parse_events(page, now=None):
    """The upcoming events, soonest first: {slug, name, headline, ts, prelims, venue, city, url}."""
    now = now or time.time()
    past = re.search(r'id="events-list-past"|>\s*Past\s*<', page)
    upcoming = page[:past.start()] if past else page
    up_at = re.search(r'id="events-list-upcoming"', upcoming)
    if up_at:
        upcoming = upcoming[up_at.start():]
    out, seen = [], set()
    heads = list(re.finditer(r"<h3[^>]*>\s*<a[^>]+href=\"(?:https?://www\.ufc\.com)?/event/([a-z0-9-]+)\"[^>]*>(.*?)</a>\s*</h3>", upcoming, re.S))
    for i, h in enumerate(heads):
        slug = h.group(1)
        if slug in seen:
            continue
        seen.add(slug)
        card = upcoming[h.start():heads[i + 1].start() if i + 1 < len(heads) else len(upcoming)]
        m = re.search(r'data-main-card-timestamp="(\d{9,11})"', card) or re.search(r'data-timestamp="(\d{9,11})"', card)
        ts = int(m.group(1)) if m else _when(_text(card), now)   # without a timestamp, the printed date and time
        pre = re.search(r'data-prelims-card-timestamp="(\d{9,11})"', card)
        venue = re.search(r"<h5[^>]*>(.*?)</h5>", card, re.S)
        loc = [_text(x) for x in re.findall(r'<span class="(?:locality|administrative-area|country)"[^>]*>(.*?)</span>', card, re.S)]
        headline = _text(h.group(2))
        if ts is None or ts < now - 12 * 3600:
            continue
        out.append({"slug": slug, "name": _event_name(slug, headline), "headline": headline, "ts": ts, "prelims": int(pre.group(1)) if pre else None,
                    "venue": _text(venue.group(1)) if venue else "", "city": ", ".join(x for x in loc if x), "url": f"https://www.ufc.com/event/{slug}"})
    out.sort(key=lambda e: e["ts"])
    return out


def _cached(key, ttl, build):
    """Fresh copy within ttl; otherwise rebuild, and on failure serve the last good copy (memory, then disk) marked stale."""
    now = time.time()
    with _lock:
        hit = _mem.get(key)
    if hit and now - hit["at"] < ttl:
        return hit
    path = D["cache_dir"] / f"ufc-{key}.json"
    try:
        data = build()
        if not data:
            raise ValueError("nothing found on the page")
        hit = {"at": int(now), "data": data, "stale": False}
        with _lock:
            _mem[key] = hit
        try:
            path.write_text(json.dumps(hit))
        except OSError:
            pass
        return hit
    except Exception as e:   # noqa: BLE001 — any failure falls back to the last good copy
        old = hit
        if not old:
            try:
                old = json.loads(path.read_text())
            except (OSError, ValueError):
                old = None
        if old:
            old = {**old, "stale": True}
            with _lock:
                _mem[key] = {**old, "at": now - ttl + 600}   # try ufc.com again in ten minutes
            return old
        miss = {"at": int(now), "data": None, "stale": True, "error": str(e)[:120]}
        with _lock:
            _mem[key] = {**miss, "at": now - ttl + 600}   # nothing to show: don't ask ufc.com again for ten minutes
        return miss


def rankings():
    def build():
        page = D["fetch"](RANK_URL, 600)
        divs = parse_rankings(page)
        return {"divisions": divs, "updated": _updated(page)} if len([d for d in divs if d["kind"] == "division"]) >= 6 else None
    r = _cached("rankings", RANK_TTL, build)
    return {"source": "ufc.com", "url": RANK_URL, "at": r["at"], "stale": r.get("stale", False), **(r["data"] or {"divisions": [], "updated": ""})}


def events():
    def build():
        return parse_events(D["fetch"](EVENTS_URL, 600))
    r = _cached("events", EVENTS_TTL, build)
    now = time.time()
    return {"source": "ufc.com", "url": EVENTS_URL, "at": r["at"], "stale": r.get("stale", False), "events": [e for e in (r["data"] or []) if e["ts"] > now - 12 * 3600]}
