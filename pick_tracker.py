"""Grades the picks posted in the server's pick channels and keeps each channel's record, with no one checking it.

At 12:30 AM Eastern the bot reads the last two days of posts in each pick channel (codex-props, claude-props,
instinct-props, codex-soccer, claude-soccer, instinct-soccer, cafe-picks, parlay-predictor), grades every pick from
the real results and posts each channel's finished plays and record in #verified-records, plus a leaderboard. At
8:00 AM it grades everything again from fresh numbers: late games get posted, and if a result changed it posts the
correction.

How plays are counted:
  - props channels: a card is one play, like a parlay. Every pick hits = a win, one miss = a loss; a push or a player
    who didn't play doesn't break it.
  - soccer channels: every pick is its own play (4 picks that all hit = 4-0).
  - a later card for the same day and play replaces the earlier one (the 6 PM update replaces the 11:30 card), while
    separate plays (Play #1 and Play #2, a best bet and a ladder) count separately. Practice posts are ignored.
  - a pick that can't be verified for certain (a name that matches two games, a game that can't be found) is shown
    as "couldn't verify" and its card stays out of the record, instead of being guessed.
Reading posts: pick_parse.py. Grading: pick_grade.py (ESPN for NBA/NFL, FotMob then ESPN for soccer). Free: no AI.

Settings (all optional):
  DISCORD_TRACK_CHANNELS   channel names or IDs to grade (default: the eight above, found by name)
  DISCORD_RECORDS_CHANNEL  where results go (default: the channel named verified-records)
  DISCORD_TRACK_TIMES      Eastern times to run (default "00:30,08:00")

Try it with the bot token set:  python3 pick_tracker.py try [hours]   (prints, posts nothing, saves nothing)
"""
import datetime as dt
import os
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path

import discord_bot as B
import pick_grade as G
import pick_parse as P
import storage

DEFAULT_CHANNELS = ["codex-props", "claude-props", "instinct-props", "codex-soccer", "claude-soccer", "instinct-soccer",
                    "cafe-picks", "parlay-predictor"]
EPOCH_MS = 1420070400000
VERSION = 5
LOOK_BACK_H = 48          # posts read each run
REGRADE_DAYS = 3          # cards re-graded each run (the double check)
KEEP_DAYS = 3650          # cards kept in the record (all of them: the all-time record is the whole history)
D = {}
STATE = {"v": VERSION, "cards": {}, "posted": {}, "channels": {}, "icons": {}, "dest": None}
_lock = threading.RLock()
ET = G.ET


def now_et():
    return dt.datetime.now(ET)


# ---------- Discord ----------
def api(method, path, payload=None):
    return B.discord(method, path, payload, token=os.environ.get("DISCORD_BOT_TOKEN"))


def snowflake(t):
    return str((int(t.timestamp() * 1000) - EPOCH_MS) << 22)


def guild_id():
    """DISCORD_GUILD_ID, or the server the bot is in."""
    gid = os.environ.get("DISCORD_GUILD_ID") or STATE.get("guild")
    if not gid:
        gs = api("GET", "/users/@me/guilds") or []
        gid = STATE["guild"] = gs[0]["id"] if gs else None
    return gid


def guild_channels():
    gid = guild_id()
    return [c for c in api("GET", f"/guilds/{gid}/channels") or [] if c.get("type") in (0, 5)] if gid else []


def bare(name):
    return re.sub(r"[^a-z0-9-]", "", (name or "").lower()).strip("-")


def resolve_channels():
    want = [x.strip() for x in re.split(r"[,\n]+", os.environ.get("DISCORD_TRACK_CHANNELS", "")) if x.strip()] or DEFAULT_CHANNELS
    chans = guild_channels()
    out = []
    for w in want:
        c = next((c for c in chans if c["id"] == w or bare(c["name"]) == bare(w) or bare(c["name"]).endswith(bare(w))), None)
        if c:
            icon = re.match(r"^([^\w\s│|]+)", c["name"])
            out.append({"id": c["id"], "name": bare(c["name"]) or c["name"], "icon": icon[1].strip() if icon else "🎯"})
    rec = os.environ.get("DISCORD_RECORDS_CHANNEL") or "verified-records"
    dest = next((c["id"] for c in chans if c["id"] == rec or bare(c["name"]).endswith(bare(rec))), None)
    return out, dest


def messages(cid, start, end, pages=10):
    """Messages in a channel posted between two times, oldest first (100 a page)."""
    out, after = [], snowflake(start) if start else "0"
    for k in range(pages):
        if k:
            time.sleep(0.4)   # a long history: stay well under Discord's read limit
        page = api("GET", f"/channels/{cid}/messages?limit=100&after={after}") or []
        if not page:
            break
        page.sort(key=lambda m: int(m["id"]))
        for m in page:
            t = B.parse_date(m.get("timestamp"))
            if t and t < end:
                out.append(m)
        after = page[-1]["id"]
        if len(page) < 100 or (B.parse_date(page[-1].get("timestamp")) or end) >= end:
            break
    return out


# ---------- reading the channels ----------
def is_soccer(ch):
    return "soccer" in (STATE["channels"].get(ch) or "")


def add_posts(ch, posts):
    """Cards from a channel's posts into STATE. A card already reported keeps the picks it was graded on."""
    soccer = is_soccer(ch)
    for p in posts:
        if not p["bot"]:
            continue
        for i, c in enumerate(P.cards_in(p, "soccer" if soccer else "props", p["at"].astimezone(ET).date())):
            cid = f"{p['id']}:{i}"
            with _lock:
                old = STATE["cards"].get(cid)
                if old and old.get("reported"):
                    continue
                STATE["cards"][cid] = {"id": cid, "ch": ch, "post": p["id"], "at": p["at"].isoformat(), "slate": c["slate"].isoformat(),
                                       "sport": c["sport"], "play": c["play"], "single": soccer, "legs": c["legs"],
                                       "extras": c.get("extras") or [], "title": c.get("title") or "",
                                       "result": None, "superseded": False, "reported": None}


def supersede():
    """One card per (channel, date, sport, play): the latest. The same picks posted twice count once."""
    with _lock:
        groups = {}
        for c in STATE["cards"].values():
            groups.setdefault((c["ch"], c["slate"], c["sport"], c["play"]), []).append(c)
        for cs in groups.values():
            cs.sort(key=lambda c: (bool(c.get("reported")), c["at"]), reverse=True)   # a reported card stands
            for i, c in enumerate(cs):
                c["superseded"] = i > 0
        seen = {}
        for c in sorted(STATE["cards"].values(), key=lambda c: (bool(c.get("reported")), c["at"]), reverse=True):
            if c["superseded"]:
                continue
            k = (c["ch"], c["slate"], frozenset(P.leg_key(g) for g in c["legs"]))
            if k in seen:
                c["superseded"] = True
            seen[k] = True


def collect(hours=LOOK_BACK_H):
    """Read the pick channels' posts from the last `hours` (None: from each channel's first post)."""
    chans, dest = resolve_channels()
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(hours=hours) if hours else None
    pages = 10 if hours else 1000
    with _lock:
        STATE["dest"] = dest
        STATE["channels"] = {c["id"]: c["name"] for c in chans}
        STATE.setdefault("icons", {}).update({c["id"]: c["icon"] for c in chans})
    read_errors = []
    for c in chans:
        time.sleep(0.8)   # Discord allows a few reads a second
        try:
            try:
                msgs = messages(c["id"], start, end, pages)
            except Exception as e:
                if "429" not in str(e):
                    raise
                time.sleep(5)
                msgs = messages(c["id"], start, end, pages)
        except Exception as e:
            print(f"pick tracker: can't read #{c['name']}: {e}", file=sys.stderr)
            read_errors.append(c["name"])
            continue
        add_posts(c["id"], P.group_posts(msgs))
    STATE["readErrors"] = read_errors
    supersede()


# ---------- grading ----------
def live_cards():
    return [c for c in STATE["cards"].values() if not c.get("superseded")]


def grade_all():
    """Grade every card from the last few days from scratch: the 8 AM run double-checks the 12:30 AM one."""
    cut = (G.now().astimezone(ET).date() - dt.timedelta(days=REGRADE_DAYS)).isoformat()
    for c in live_cards():
        if c["slate"] < cut and c.get("result") is not None and all(g.get("result") is not None for g in c["legs"]):
            continue
        slate = dt.date.fromisoformat(c["slate"])
        for g in c["legs"] + (c.get("extras") or []):
            G.grade_leg(g, slate)
        c["result"] = G.card_result(c["legs"])


def card_day(c):
    """The day a card is recapped on: the day its last game was played (a Saturday post for Sunday's NFL games is
    Sunday's), else its slate date."""
    return max([g["game_day"] for g in c["legs"] if g.get("game_day")] + [c["slate"]])


def settled(c):
    if c["single"]:
        return all(g.get("result") is not None for g in c["legs"])
    return c.get("result") is not None


def plays(c):
    """The card's plays: [(result, label)]. A soccer pick is its own play; a props card is one."""
    if c["single"]:
        return [(g.get("result"), g["label"]) for g in c["legs"]]
    return [(c.get("result"), c["id"])]


def snapshot(c):
    return {"result": c.get("result"), "legs": [g.get("result") for g in c["legs"]]}


# ---------- the record ----------
def stats(cards):
    """W-L over plays (props card or soccer pick), win rate, streak, and individual picks hit."""
    seq = []
    for c in sorted(cards, key=lambda c: (c["slate"], c["at"])):
        if settled(c):
            seq += [r for r, _ in plays(c) if r in ("won", "lost")]
    w = seq.count("won")
    streak, kind = 0, None
    for r in reversed(seq):
        kind = kind or r
        if r != kind:
            break
        streak += 1
    lw = sum(g.get("result") == "won" for c in cards if settled(c) for g in c["legs"])
    ll = sum(g.get("result") == "lost" for c in cards if settled(c) for g in c["legs"])
    return {"won": w, "lost": len(seq) - w, "n": len(seq), "pct": w / len(seq) if seq else None,
            "streak": f"{'W' if kind == 'won' else 'L'}{streak}" if kind else "–", "lw": lw, "ll": ll}


def pct(x):
    return "–" if x is None else f"{round(x * 100)}%"


def wl(s):
    return f"{s['won']}-{s['lost']}"


MARK = {"won": "✅", "lost": "❌", "push": "➖", "void": "⚪", "unknown": "❔", None: "⏳"}
TAG = {"won": "✅ **CASHED**", "lost": "❌ **MISSED**", "void": "⚪ **VOID**", "unknown": "❔ **COULDN'T VERIFY**", None: "⏳ **WAITING**"}


def leg_line(g, extra=False):
    a = g.get("actual") or ""
    r = g.get("result")
    label = g["label"]
    if g.get("player_full") and B.norm(g["player_full"]) != B.norm(g.get("player") or ""):
        label += f" ({g['player_full']})"
    line = f"{MARK[r]} {label}" + (f" — **{a}**" if a and r in ("won", "lost", "push") else f" — {a}" if a else "")
    why = g.get("why")
    if why and r in ("lost", "void", "push", "unknown"):
        hurt = "injury" in (g.get("flags") or []) and r == "lost" and "🚑" not in why
        line += f"\n-# ↳ {'🚑 ' if hurt else ''}{why}"
    return line


def play_name(c):
    p = c["play"]
    if p.startswith("play"):
        return f"Play #{p[4:]}"
    if p.startswith("leg:"):
        return re.sub(r"\b(\w)", lambda m: m[1].upper(), p[4:]).replace("-Leg", "-leg")
    if p.startswith("single:"):
        return "Single"
    return {"main": "", "best": "Best bet", "ladder": "Ladder", "longshot": "Longshot"}.get(p, "")


def verdict(c):
    """One line on why a card lost: the leg(s) that sank it, by how much, and whether that player got hurt or left
    early. Legs voided for a DNP are named too, since they drop off the card."""
    lost = [g for g in c["legs"] if g.get("result") == "lost"]
    dnp = [g for g in c["legs"] if g.get("result") == "void"]
    bits = []
    for g in lost:
        if g.get("t") != "prop":
            bits.append(f"{g['label']}")
            continue
        who = g.get("player_full") or g.get("player") or g["label"]
        fl = set(g.get("flags") or [])
        how = " 🚑 got hurt and" if "injury" in fl and "left" in fl else " left early and" if "left" in fl else ""
        first = (g.get("why") or "").split(" · ")[0]
        gap = f" ({first})" if first.endswith(("short", "too many")) else ""
        bits.append(f"{who}{how} missed{gap}")
    if dnp:
        bits.append(", ".join(g.get("player_full") or g.get("player") or g["label"] for g in dnp) +
                    " didn't play, so that leg drops off")
    if not bits:
        return ""
    return "-# " + ("Lost on: " if lost else "") + " · ".join(bits)


def card_block(c, correction=None, late=False):
    when = B.parse_date(c["at"]).astimezone(ET)
    posted = f"posted {when:%a} {when.strftime('%I:%M %p').lstrip('0')}"
    name = play_name(c)
    play = f"{name} · " if name else ""
    if c["single"]:
        s = stats([c])
        head = f"**{wl(s)}** · {play}{len(c['legs'])} pick{'s' * (len(c['legs']) != 1)} · {posted}"
    else:
        hits = sum(g.get("result") == "won" for g in c["legs"])
        decided = sum(g.get("result") in ("won", "lost") for g in c["legs"])
        size = "single" if len(c["legs"]) == 1 else f"{len(c['legs'])}-leg card"
        head = f"{TAG[c.get('result')]} · {play if name != 'Single' else ''}{size} · {hits}/{decided} hit · {posted}"
    if late:
        head += " · finished late"
    if correction:
        head = f"🔁 **Corrected** (was {correction}) · " + head
    lines = [head] + [leg_line(g) for g in c["legs"]]
    v = verdict(c) if not c["single"] else ""
    if v:
        lines.append(v)
    ex = c.get("extras") or []
    if ex:
        hit = sum(g.get("result") == "won" for g in ex)
        lines.append(f"*Also in the post, not part of the card ({hit}/{len(ex)} hit):*")
        lines += [leg_line(g) for g in ex]
    return "\n".join(lines)


def short_block(c):
    when = B.parse_date(c["at"]).astimezone(ET)
    res = wl(stats([c])) if c["single"] else {"won": "✅", "lost": "❌", "void": "⚪", "unknown": "❔", None: "⏳"}[c.get("result")]
    legs = ", ".join(f"{MARK[g.get('result')]}{g['label']}" for g in c["legs"])
    return f"**{res}** {card_day(c)[5:]} {play_name(c) or 'card'} ({when:%a} {when.strftime('%I:%M%p').lstrip('0').lower()}): {legs}"


def card_sport(c):
    """NBA, NFL, WNBA or Mixed, from the card's picks."""
    sp = {(g.get("sport") or c.get("sport") or "").lower() for g in c["legs"]} - {""}
    return sp.pop().upper() if len(sp) == 1 else "Mixed" if sp else (c.get("sport") or "").upper() or "Other"


def sport_records(cards):
    """{"NBA": stats, "NFL": stats, ...} for a props channel: the sub-records, NBA and NFL first."""
    by = {}
    for c in cards:
        by.setdefault(card_sport(c), []).append(c)
    order = ["NBA", "NFL", "WNBA", "Mixed"]
    return {k: stats(by[k]) for k in sorted(by, key=lambda k: order.index(k) if k in order else 9) if stats(by[k])["n"]}


def outcome_of(snap, c):
    """What a correction is about: a props card's result, or a soccer post's picks. A late leg that doesn't change
    the card (a pending pick on a card that already lost) isn't a correction."""
    return tuple(snap["legs"]) if c["single"] else snap["result"]


def recap_day():
    """The slate a run recaps: at 12:30 AM and 8 AM that is the day before."""
    return (now_et() - dt.timedelta(hours=9)).date().isoformat()


def chunks(blocks, size=3900, sep="\n\n"):
    out, cur = [], ""
    for b in blocks:
        if len(b) > size:
            b = b[:size - 2] + "\n…"
        if cur and len(cur) + len(sep) + len(b) > size:
            out.append(cur)
            cur = ""
        cur = f"{cur}{sep}{b}" if cur else b
    return out + ([cur] if cur else [])


def channel_report(ch, new, fixed, everything, update=False, late=()):
    """One channel's recap of the day: that day's cards, the day's record, then the all-time record (props channels
    also by sport). A list of embeds: long nights are split so nothing is cut off."""
    name, icon = STATE["channels"].get(ch, ch), STATE.get("icons", {}).get(ch, "🎯")
    soccer = is_soccer(ch)
    today, alltime = stats(new + list(late) + [c for c, _ in fixed]), stats(everything)
    blocks = [card_block(c) for c in new] + [card_block(c, late=True) for c in late] + [card_block(c, was) for c, was in fixed]
    parts = chunks(blocks) or ["–"]
    color = B.GREY if not today["n"] else B.GREEN if today["won"] >= today["lost"] else B.RED
    unit = "picks" if soccer else "cards"
    fields = [{"name": "Today", "value": f"**{wl(today)}** {unit}", "inline": True},
              {"name": "All-time", "value": f"**{wl(alltime)}** · {pct(alltime['pct'])}", "inline": True},
              {"name": "Streak", "value": f"**{alltime['streak']}**", "inline": True}]
    if not soccer:
        subs = sport_records(everything)
        if subs:
            fields.append({"name": "All-time by sport", "value": " · ".join(f"{k} **{wl(v)}** ({pct(v['pct'])})" for k, v in subs.items()), "inline": False})
    out = []
    for i, desc in enumerate(parts):
        e = {"color": color, "description": desc}
        if i == 0:
            e["author"] = {"name": f"{icon}  {name.upper().replace('-', ' ')}"}
            e["title"] = ("Updated results" if update else "Results") + f" · {wl(today)} {unit}"
        if i == len(parts) - 1:
            e["fields"] = fields
            e["footer"] = {"text": "Every pick counts on its own" if soccer else
                           "A card is one play: all picks hit = win, one miss = loss · pushes and DNPs don't break it · "
                           "extras and add-ons are shown, not counted"}
        out.append(e)
    return out


def board_block(by_ch):
    """The all-time chart: every channel's record, in channel order (they all play differently, so no ranking)."""
    props, soccer = [], []
    for ch in STATE["channels"]:
        cs = by_ch.get(ch) or []
        st = stats(cs)
        if not st["n"]:
            continue
        name = STATE["channels"][ch]
        (soccer if is_soccer(ch) else props).append((name, st, None if is_soccer(ch) else sport_records(cs)))
    out = []
    if props:
        w = max(len(n) for n, _, _ in props)
        sub = lambda subs, k: wl(subs[k]) if k in subs else "–"
        lines = [f"{'CHANNEL'.ljust(w)}  {'ALL':>6} {'WIN%':>4}  {'NBA':>5}  {'NFL':>5}"]
        lines += [f"{n.ljust(w)}  {wl(s):>6} {pct(s['pct']):>4}  {sub(subs, 'NBA'):>5}  {sub(subs, 'NFL'):>5}" for n, s, subs in props]
        out.append("**Props** (each card is one play)\n```\n" + "\n".join(lines) + "\n```")
    if soccer:
        w = max(len(n) for n, _, _ in soccer)
        lines = [f"{'CHANNEL'.ljust(w)}  {'ALL':>6} {'WIN%':>4}"]
        lines += [f"{n.ljust(w)}  {wl(s):>6} {pct(s['pct']):>4}" for n, s, _ in soccer]
        out.append("**Soccer** (each pick is one play)\n```\n" + "\n".join(lines) + "\n```")
    return "\n".join(out)


def recheck_block(cards):
    """After a rebuild: the cards whose result changed with the new reader and grader, and how many it read for the
    first time, so the records' changes are out in the open. A list of lines."""
    before = STATE.get("before") or {}
    lines, first = [], 0
    for c in sorted(cards, key=lambda c: c["at"]):
        if c["single"] or not settled(c) or c.get("result") in (None, "unknown"):
            continue
        key = f"{c['post']}|{c['play']}"
        if key not in before:
            first += 1
            continue
        was = before[key]
        if was == c.get("result"):
            continue
        name = STATE["channels"].get(c["ch"], "?")
        tag = {"won": "✅ win", "lost": "❌ loss", "void": "⚪ void"}.get(c["result"], c["result"])
        prev = {"won": "win", "lost": "loss", "void": "void", "unknown": "couldn't verify"}.get(was, str(was))
        lines.append(f"**#{name}** {card_day(c)[5:]} {play_name(c) or 'card'}: {tag} (was {prev})")
    head = [f"{len(lines)} result(s) changed." if lines else "No earlier result changed."]
    if first:
        head.append(f"{first} card(s) were read for the first time (posts the old verifier missed or never graded); "
                    "they're in the records below.")
    return head + lines


def report(update=False):
    """[(content, embed, card ids)]: one post per channel with that day's finished plays (and any change to them),
    then the all-time chart. Cards that finish a day or two late (an NFL card posted Saturday, a Monday night leg) are
    posted when they finish; anything older than that is only counted."""
    cards = live_cards()
    day = recap_day()
    oldest = (dt.date.fromisoformat(day) - dt.timedelta(days=REGRADE_DAYS)).isoformat()
    rebuild = STATE.get("rebuild")
    with _lock:   # older days: never posted again, only counted
        for c in cards:
            if card_day(c) < (day if rebuild else oldest) and settled(c) and not c.get("reported"):
                c["reported"] = snapshot(c)
    mine = [c for c in cards if card_day(c) == day]
    new = [c for c in mine if settled(c) and not c.get("reported")]
    late = [c for c in cards if oldest <= card_day(c) < day and settled(c) and not c.get("reported")]
    fixed = []
    for c in mine:
        r = c.get("reported")
        if r and settled(c) and outcome_of(snapshot(c), c) != outcome_of(r, c):
            was = r["result"] if not c["single"] else "-".join(str(r["legs"].count(x)) for x in ("won", "lost"))
            fixed.append((c, TAG.get(was, was).replace("*", "") if not c["single"] else was))
    recheck = recheck_block(cards) if rebuild else []
    if not new and not fixed and not late and not recheck:
        return []
    out = []
    for ch in STATE["channels"]:
        n = [c for c in new if c["ch"] == ch]
        lt = [c for c in late if c["ch"] == ch]
        f = [x for x in fixed if x[0]["ch"] == ch]
        if n or f or lt:
            embeds = channel_report(ch, sorted(n, key=lambda c: c["at"]), f, [c for c in cards if c["ch"] == ch], update,
                                    sorted(lt, key=lambda c: c["at"]))
            ids = [c["id"] for c in n] + [c["id"] for c in lt] + [c["id"] for c, _ in f]
            for k, e in enumerate(embeds):
                out.append(("", e, ids if k == len(embeds) - 1 else []))
    if recheck:
        first = min(c["at"] for c in cards)[:10] if cards else day
        parts = chunks(["\n".join(recheck[:2]) + "\n"] + recheck[2:], 3800, "\n")
        for k, desc in enumerate(parts):
            e = {"color": B.BLUE, "description": desc}
            if k == 0:
                e["title"] = "🔁 WHOLE HISTORY RE-CHECKED"
            if k == len(parts) - 1:
                e["footer"] = {"text": f"Every post since {first} was read again and graded from ESPN and FotMob: every play, leg "
                                       "counts, extras kept apart, the right game day. The all-time records below are the result."}
            out.append(("", e, []))
    by_all = {}
    for c in cards:
        by_all.setdefault(c["ch"], []).append(c)
    waiting = sum(1 for c in mine if not settled(c))
    out.append(("", {"title": "📈 ALL-TIME RECORDS", "color": B.BLUE, "description": board_block(by_all) or "–",
                     "footer": {"text": "ESPN & FotMob results" + (f" · {waiting} card(s) from today still waiting on a final" if waiting else "")}}, []))
    d = dt.date.fromisoformat(day)
    out[0] = (f"📊 **{'UPDATED RESULTS' if update else 'NIGHTLY RESULTS'} — {d:%A, %B} {d.day}**",) + out[0][1:]
    return out


def send(dest, payload):
    """POST a message, waiting out Discord's rate limit (it allows about five messages per five seconds)."""
    for attempt in range(4):
        try:
            return api("POST", f"/channels/{dest}/messages", payload)
        except Exception as e:
            if "429" not in str(e) or attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def post(dest, msgs):
    """Post the results. Returns the ids of the cards whose message went out (only those are marked as reported)."""
    if not dest:
        STATE["postError"] = "There's no #verified-records channel."
        return []
    done = []
    try:
        for content, embed, ids in msgs:
            send(dest, {"content": content, "embeds": [embed], "allowed_mentions": {"parse": []}})
            done += ids
            time.sleep(1.5)
    except Exception as e:
        STATE["postError"] = ("The bot isn't allowed to post in #verified-records. Give the Floodlight role Send Messages and Embed Links there."
                              if "403" in str(e) else f"Posting the results failed: {e}")
        print(f"pick tracker: {STATE['postError']}", file=sys.stderr)
        return done
    STATE.pop("postError", None)
    return done


def run(final=False, dry=False, hours=LOOK_BACK_H, fresh=True):
    """Read, grade, post what finished (and any correction). Returns the messages."""
    G.RUN["id"] = str(int(time.time()) // 300)
    if fresh:
        reload()
    rebuild = STATE.get("rebuild")
    collect(None if rebuild else hours)   # a rebuild reads every channel from its first post
    grade_all()
    msgs = report(update=final)
    if msgs and not dry:
        sent = set(post(STATE.get("dest"), msgs))
        with _lock:
            for c in live_cards():
                if c["id"] in sent:
                    c["reported"] = snapshot(c)
            if rebuild and msgs and not STATE.get("postError"):
                STATE.pop("rebuild", None)
                STATE.pop("before", None)
    with _lock:   # keep four months
        cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=KEEP_DAYS)).isoformat()
        for k in [k for k, c in STATE["cards"].items() if c["at"] < cut]:
            STATE["cards"].pop(k, None)
    if not dry:
        save()
    return msgs


# ---------- schedule ----------
def _path():
    return Path(D["cache_dir"]) / "pick-tracker.json"


def save():
    with _lock:
        STATE["savedAt"] = time.time()
        if D.get("data_dir"):
            blob = seal({k: v for k, v in STATE.items() if not k.startswith("_")})
            (Path(D["data_dir"]) / DATA_FILE).write_bytes(blob)
            push(blob)
        elif D.get("cache_dir"):
            storage.save(_path(), STATE)


def times():
    out = []
    for x in re.split(r"[,\s]+", os.environ.get("DISCORD_TRACK_TIMES", "00:30,08:00")):
        m = re.fullmatch(r"(\d{1,2}):(\d\d)", x.strip())
        if m:
            out.append((int(m[1]), int(m[2])))
    return out or [(0, 30), (8, 0)]


def due_slots(delay=0, window=120):
    """The set times due now and not done yet: [(index, slot)]. Each runs inside `window` minutes from its time plus
    `delay`."""
    t = now_et()
    out = []
    for i, (hh, mm) in enumerate(times()):
        at = t.replace(hour=hh, minute=mm, second=0, microsecond=0) + dt.timedelta(minutes=delay)
        slot = f"{t.date()} {hh:02d}:{mm:02d}"
        if at <= t < at + dt.timedelta(minutes=window) and slot not in STATE["posted"]:
            out.append((i, slot))
    return out


def scheduled(delay=0, runner="server", window=120):
    """Run whatever set time is due. A run that fails (Discord or a data source down) is tried again on the next call."""
    reload()
    for i, slot in due_slots(delay, window):
        tried = STATE.setdefault("tries", {}).get(slot, 0)
        if time.time() - tried < 540:
            continue
        STATE["tries"][slot] = time.time()
        try:
            run(final=i > 0, fresh=False)
            ok = not STATE.get("postError")
        except Exception as e:
            print(f"pick tracker: run at {slot} failed: {type(e).__name__}: {e}", file=sys.stderr)
            ok = False
        if ok:
            STATE["posted"][slot] = int(time.time())
            STATE["ranBy"] = {"who": runner, "at": int(time.time())}
        for k in sorted(STATE["posted"])[:-60]:
            STATE["posted"].pop(k, None)
        for k in sorted(STATE.setdefault("tries", {}))[:-10]:
            STATE["tries"].pop(k, None)
        save()
        print(f"pick tracker: {slot} {'done' if ok else 'will retry'} ({runner})")


SERVER_DELAY = 40     # minutes the server leaves GitHub Actions to post a set time before posting it itself


def _loop():
    """The server's own schedule, the backup for GitHub Actions: GitHub's timer is best-effort (it can run late or
    skip), so if a set time hasn't been posted 40 minutes after it's due, the server posts it. Both share one record,
    so nothing is posted twice."""
    time.sleep(60)
    n = 0
    while True:
        try:
            if due_slots(SERVER_DELAY):
                scheduled(SERVER_DELAY)
        except Exception as e:
            print(f"pick tracker: {type(e).__name__}: {e}", file=sys.stderr)
        if n % 10 == 0:
            _stay_awake()
        n += 1
        time.sleep(60)


def _stay_awake():
    """Render's free plan puts the server to sleep after 15 minutes without visitors, and a sleeping server can't post
    the results. GitHub's 5-minute keep-awake timer turned out to run only a couple of times a day, so the server
    visits its own public address every 10 minutes (Render counts that as a visitor). Free, and needs no setup."""
    url = os.environ.get("RENDER_EXTERNAL_URL")
    if not url:
        return
    try:
        urllib.request.urlopen(url.rstrip("/") + "/api/version", timeout=30).read()
    except Exception as e:
        print(f"pick tracker: stay-awake ping failed: {e}", file=sys.stderr)


# ---------- the record, shared with GitHub Actions ----------
# GitHub Actions does the grading first (Discord often blocks Render's shared address) and keeps the record in the
# repo's pick-data branch, encrypted with a key made from the bot token so the public repo doesn't show the picks. It
# also sends each saved record to the server (/api/picks/state) and starts from the server's copy when that is newer,
# so whichever of the two posted last, the other knows. The newest record (savedAt) always wins.
MIRROR = "https://raw.githubusercontent.com/eisensteinerez/floodlight/pick-data/pick-tracker.enc"
SERVER = os.environ.get("PICKS_SERVER_URL") or "https://floodlight-x9sl.onrender.com/api/picks/state"
DATA_FILE = "pick-tracker.enc"


def _fernet():
    import base64
    import hashlib
    from cryptography.fernet import Fernet
    tok = os.environ.get("DISCORD_BOT_TOKEN") or ""
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"floodlight-picks:" + tok.encode()).digest()))


def seal(state):
    import json
    return _fernet().encrypt(json.dumps(state).encode())


def unseal(blob):
    import json
    return json.loads(_fernet().decrypt(blob))


def mirror():
    """GitHub's copy of the record, or None."""
    if os.environ.get("PICKS_MIRROR", "1") == "0":
        return None
    try:
        import urllib.request
        url = os.environ.get("PICKS_MIRROR_URL") or MIRROR
        with urllib.request.urlopen(urllib.request.Request(f"{url}?t={int(time.time()) // 60}", headers={"User-Agent": "floodlight"}), timeout=15) as r:
            return unseal(r.read())
    except Exception:
        return None


def _http(url, data=None, timeout=60):
    import urllib.request
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "floodlight", "Content-Type": "application/octet-stream"},
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def push(blob):
    """GitHub Actions: hand the saved record to the server."""
    try:
        _http(SERVER, blob)
    except Exception as e:
        print(f"pick tracker: couldn't send the record to the server ({type(e).__name__}: {e})")


def from_server():
    try:
        return unseal(_http(SERVER, timeout=90))       # the free server may need a minute to wake
    except Exception as e:
        print(f"pick tracker: couldn't read the server's record ({type(e).__name__})")
        return None


def state_blob():
    """GET /api/picks/state: the server's record, encrypted."""
    with _lock:
        return seal({k: v for k, v in STATE.items() if not k.startswith("_")})


def accept_blob(blob):
    """POST /api/picks/state from GitHub Actions: kept if it decrypts (so it was made with the bot token) and is newer."""
    try:
        got = unseal(blob)
    except Exception:
        return False
    if not isinstance(got, dict) or got.get("savedAt", 0) < STATE.get("savedAt", 0):
        return False
    with _lock:
        STATE.clear()
        STATE.update(got)
        if D.get("cache_dir"):
            storage.save(_path(), STATE)
    return True


def _newest(*states):
    states = [x for x in states if isinstance(x, dict) and x]
    return max(states, key=lambda x: x.get("savedAt", 0), default={})


def github_runs(st=None):
    st = st if st is not None else STATE
    rb = st.get("ranBy") or {}
    return rb.get("who") == "github" and time.time() - rb.get("at", 0) < 3 * 86400


def reload():
    """The saved state, fresh. On GitHub it's the pick-data file; on the server, GitHub's copy when GitHub is running
    the grading, else the server's own."""
    got = None
    if D.get("data_dir"):
        f = Path(D["data_dir"]) / DATA_FILE
        got = _newest(unseal(f.read_bytes()) if f.exists() else {}, None if D.get("reset") else from_server())
    elif D.get("cache_dir"):
        got = _newest(dict(STATE), storage.load(_path(), {}), mirror())
    if isinstance(got, dict) and got:
        with _lock:
            STATE.clear()
            STATE.update({"v": VERSION, "cards": {}, "posted": {}, "channels": {}, "icons": {}, "dest": None})
            STATE.update(got)
    if STATE.get("v", 0) < VERSION or D.pop("history", False):
        # the card reader and grader were rebuilt (or a history re-check was asked for): read every post since each
        # channel began and grade it from scratch. What each card was called before is kept, so the first post can say
        # which results changed.
        if not STATE.get("rebuild"):
            STATE["before"] = {f"{c.get('post')}|{c.get('play')}": c.get("result") for c in (STATE.get("cards") or {}).values()
                               if c.get("reported") and not c.get("superseded")}
        STATE["cards"] = {}
        STATE["rebuild"] = True
        STATE["v"] = VERSION


def setup(**deps):
    D.update(deps)
    if deps.get("fetch"):
        G.D["fetch"] = deps["fetch"]
    reload()
    if os.environ.get("DISCORD_BOT_TOKEN"):
        threading.Thread(target=_loop, daemon=True, name="pick-tracker").start()


# ---------- commands ----------
def cmd_leaderboard(o):
    reload()
    days = int(o.get("days") or 0)
    cut = (now_et().date() - dt.timedelta(days=days)).isoformat() if days else ""
    by = {}
    for c in live_cards():
        if c["slate"] >= cut:
            by.setdefault(c["ch"], []).append(c)
    lb = board_block(by)
    if not lb:
        return {"embeds": [{"title": "🏆 Leaderboard", "color": B.BLUE,
                            "description": "Nothing graded yet. Picks are graded every night at 12:30 AM ET and checked again at 8 AM."}]}
    return {"embeds": [{"title": "📈 RECORDS · " + (f"LAST {days} DAYS" if days else "ALL-TIME"), "color": B.BLUE, "description": lb,
                        "footer": {"text": "Props: each card is one play · Soccer: each pick is one play"}}]}


def cmd_check(o):
    """/checkpicks: read and grade now. Shows every card it found and how each pick graded; posts only with post:True."""
    go = bool(o.get("post"))
    msgs = run(final=False, dry=not go)
    cards = live_cards()
    embeds = []
    for cid, n in STATE["channels"].items():
        cs = sorted((c for c in cards if c["ch"] == cid), key=lambda c: c["at"])
        icon = STATE.get("icons", {}).get(cid, "🎯")
        body = "\n".join(short_block(c) for c in cs) or "No cards in the last two days."
        if len(body) > 640:      # Discord allows 6,000 characters across a message's embeds
            body = body[:640] + "…"
        embeds.append({"author": {"name": f"{icon}  #{n}"}, "description": body, "color": B.BLUE})
    errs = STATE.get("readErrors") or []
    if go:
        foot = STATE.get("postError") or ("Posted finished results in #verified-records" if msgs else "Nothing new finished yet")
    else:
        foot = "Preview only, nothing posted. Results post on their own at 12:30 AM and 8 AM ET (or run /checkpicks post:True)."
    if errs:
        foot += " · couldn't read " + ", ".join("#" + e for e in errs)
    embeds = embeds[:9] or [{"description": "No pick channels found.", "color": B.BLUE}]
    embeds.append({"title": "Pick check done", "color": B.BLUE, "description": foot})
    return {"embeds": embeds}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd in ("scheduled", "now"):   # GitHub Actions: .github/workflows/grade-picks.yml
        if not os.environ.get("DISCORD_BOT_TOKEN"):
            print("Add the DISCORD_BOT_TOKEN secret to the repository (Settings > Secrets and variables > Actions) to run the grading here.")
            sys.exit(0)
        D["data_dir"] = os.environ.get("PICKS_DATA_DIR") or "data"
        D["reset"] = os.environ.get("PICKS_RESET") == "true"
        D["history"] = os.environ.get("PICKS_HISTORY") == "true"   # re-read every post since each channel began
        Path(D["data_dir"]).mkdir(exist_ok=True)
        if cmd == "now":
            msgs = run(final=False)
            print(f"posted {len(msgs)} message(s)" + (f" · {STATE['postError']}" if STATE.get("postError") else ""))
        else:
            scheduled(runner="github", window=SERVER_DELAY - 5)   # after that the server takes the set time
        STATE["ranBy"] = {"who": "github", "at": int(time.time())}
        save()
    elif cmd == "delete":   # take down the bot's own posts in the results channel: delete <message id> ...
        D["data_dir"] = os.environ.get("PICKS_DATA_DIR") or "data"
        reload()
        dest = STATE.get("dest")
        for mid in re.findall(r"\d{15,22}", " ".join(sys.argv[2:])):
            try:
                api("DELETE", f"/channels/{dest}/messages/{mid}")
                print(f"deleted {mid}")
            except Exception as e:
                print(f"couldn't delete {mid}: {e}")
    elif cmd == "try":   # read, grade and print; posts nothing, saves nothing
        h = int(sys.argv[2]) if len(sys.argv) > 2 else LOOK_BACK_H
        run(dry=True, hours=h)
        for c in sorted(live_cards(), key=lambda c: c["at"]):
            print(f"\n#{STATE['channels'].get(c['ch'])} {c['slate']} {c['play']} -> {c['result']}")
            for g in c["legs"]:
                print("   " + leg_line(g).replace("\n", "\n   "))
            for g in c.get("extras") or []:
                print("   [extra] " + leg_line(g).replace("\n", "\n   "))
        print("\n\n========== what the next post would look like (as if nothing was posted yet) ==========")
        for c in live_cards():
            c["reported"] = None
        for content, e, _ in report():
            print("\n" + (content or ""))
            print((e.get("author") or {}).get("name", ""), "|", e.get("title", ""))
            print(e.get("description", ""))
            for f in e.get("fields") or []:
                print(f"  [{f['name']}] {f['value']}")
            print(f"  ({(e.get('footer') or {}).get('text', '')})")
    else:
        print(__doc__)
