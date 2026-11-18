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
from pathlib import Path

import discord_bot as B
import pick_grade as G
import pick_parse as P
import storage

DEFAULT_CHANNELS = ["codex-props", "claude-props", "instinct-props", "codex-soccer", "claude-soccer", "instinct-soccer",
                    "cafe-picks", "parlay-predictor"]
EPOCH_MS = 1420070400000
VERSION = 4
LOOK_BACK_H = 48          # posts read each run
REGRADE_DAYS = 3          # cards re-graded each run (the double check)
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


def messages(cid, start, end):
    """Messages in a channel posted between two times, oldest first."""
    out, after = [], snowflake(start)
    for _ in range(10):
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
    chans, dest = resolve_channels()
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(hours=hours)
    with _lock:
        STATE["dest"] = dest
        STATE["channels"] = {c["id"]: c["name"] for c in chans}
        STATE.setdefault("icons", {}).update({c["id"]: c["icon"] for c in chans})
    read_errors = []
    for c in chans:
        time.sleep(0.8)   # Discord allows a few reads a second
        try:
            try:
                msgs = messages(c["id"], start, end)
            except Exception as e:
                if "429" not in str(e):
                    raise
                time.sleep(5)
                msgs = messages(c["id"], start, end)
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
        for g in c["legs"]:
            G.grade_leg(g, slate)
        c["result"] = G.card_result(c["legs"])


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


def leg_line(g):
    a = g.get("actual") or ""
    return f"{MARK[g.get('result')]} {g['label']}" + (f" — **{a}**" if a and g.get("result") in ("won", "lost", "push") else f" — {a}" if a else "")


def card_block(c, correction=None):
    when = B.parse_date(c["at"]).astimezone(ET)
    posted = f"posted {when:%a} {when.strftime('%I:%M %p').lstrip('0')}"
    play = {"main": "", "best": "Best bet · ", "ladder": "Ladder · ", "longshot": "Longshot · "}.get(c["play"], "")
    if c["play"].startswith("play"):
        play = f"Play #{c['play'][4:]} · "
    if c["single"]:
        s = stats([c])
        head = f"**{wl(s)}** · {play}{len(c['legs'])} pick{'s' * (len(c['legs']) != 1)} · {posted}"
    else:
        hits = sum(g.get("result") == "won" for g in c["legs"])
        decided = sum(g.get("result") in ("won", "lost") for g in c["legs"])
        head = f"{TAG[c.get('result')]} · {play}{len(c['legs'])}-leg card · {hits}/{decided} hit · {posted}"
    if correction:
        head = f"🔁 **Corrected** (was {correction}) · " + head
    return head + "\n" + "\n".join(leg_line(g) for g in c["legs"])


def short_block(c):
    when = B.parse_date(c["at"]).astimezone(ET)
    res = wl(stats([c])) if c["single"] else {"won": "✅", "lost": "❌", "void": "⚪", "unknown": "❔", None: "⏳"}[c.get("result")]
    legs = ", ".join(f"{MARK[g.get('result')]}{g['label']}" for g in c["legs"])
    return f"**{res}** {c['slate'][5:]} {c['play']} ({when:%a} {when.strftime('%I:%M%p').lstrip('0').lower()}): {legs}"


def channel_report(ch, new, fixed, everything, update=False):
    name, icon = STATE["channels"].get(ch, ch), STATE.get("icons", {}).get(ch, "🎯")
    today, alltime = stats(new + [c for c, _ in fixed]), stats(everything)
    blocks = [card_block(c) for c in new] + [card_block(c, was) for c, was in fixed]
    desc = "\n\n".join(blocks)
    if len(desc) > 3900:
        desc = desc[:3900] + "\n…"
    color = B.GREY if not today["n"] else B.GREEN if today["won"] >= today["lost"] else B.RED
    soccer = is_soccer(ch)
    return {"author": {"name": f"{icon}  {name.upper().replace('-', ' ')}"},
            "title": ("Updated results" if update else "Results") + f" · {wl(today)} " + ("picks" if soccer else "cards"),
            "color": color, "description": desc,
            "fields": [{"name": "All-time", "value": f"**{wl(alltime)}**", "inline": True},
                       {"name": "Win rate", "value": f"**{pct(alltime['pct'])}**", "inline": True},
                       {"name": "Streak", "value": f"**{alltime['streak']}**", "inline": True},
                       {"name": "Picks hit", "value": f"{alltime['lw']}-{alltime['ll']}", "inline": True}],
            "footer": {"text": "Every pick counts on its own" if soccer else
                       "A card is one play: all picks hit = win, one miss = loss · pushes and DNPs don't break it"}}


def board_block(by_ch):
    rows = [(STATE["channels"].get(ch, ch), stats(cs), is_soccer(ch)) for ch, cs in by_ch.items()]
    rows = [r for r in rows if r[1]["n"]]
    rows.sort(key=lambda x: (-(x[1]["pct"] or 0), -x[1]["won"], x[1]["lost"]))
    if not rows:
        return ""
    w = max(len(n) for n, _, _ in rows)
    medal = ["🥇", "🥈", "🥉"]
    lines = [f"{'':3}{'CHANNEL'.ljust(w)}  {'W-L':>7}  {'WIN%':>4}  STRK"]
    for i, (n, s, _) in enumerate(rows):
        lines.append(f"{str(i + 1) + '.':3}{n.ljust(w)}  {wl(s):>7}  {pct(s['pct']):>4}  {s['streak']}")
    top = " ".join(f"{medal[i]} #{n}" for i, (n, _, _) in enumerate(rows[:3]))
    return top + "\n```\n" + "\n".join(lines) + "\n```"


def report(update=False):
    """[(content, embed)]: one post per channel with newly finished plays and corrections, then the leaderboard."""
    cards = live_cards()
    new = [c for c in cards if settled(c) and not c.get("reported")]
    fixed = []
    for c in cards:
        r = c.get("reported")
        if r and settled(c) and snapshot(c) != r:
            was = r["result"] if not c["single"] else "-".join(str(r["legs"].count(x)) for x in ("won", "lost"))
            fixed.append((c, TAG.get(was, was).replace("*", "") if not c["single"] else was))
    if not new and not fixed:
        return []
    out = []
    for ch in STATE["channels"]:
        n = [c for c in new if c["ch"] == ch]
        f = [x for x in fixed if x[0]["ch"] == ch]
        if n or f:
            out.append(("", channel_report(ch, sorted(n, key=lambda c: c["at"]), f, [c for c in cards if c["ch"] == ch], update),
                        [c["id"] for c in n] + [c["id"] for c, _ in f]))
    by_all = {}
    for c in cards:
        by_all.setdefault(c["ch"], []).append(c)
    waiting = sum(1 for c in cards if not settled(c))
    out.append(("", {"title": "🏆 LEADERBOARD · ALL-TIME", "color": B.BLUE, "description": board_block(by_all) or "–",
                     "footer": {"text": "Props: each card is one play · Soccer: each pick is one play · ESPN & FotMob results"
                                + (f" · {waiting} card(s) still waiting on a final" if waiting else "")}}, []))
    d = now_et() - dt.timedelta(hours=9)
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


def run(final=False, dry=False, hours=LOOK_BACK_H):
    """Read, grade, post what finished (and any correction). Returns the messages."""
    G.RUN["id"] = str(int(time.time()) // 300)
    collect(hours)
    grade_all()
    msgs = report(update=final)
    if msgs and not dry:
        sent = set(post(STATE.get("dest"), msgs))
        with _lock:
            for c in live_cards():
                if c["id"] in sent:
                    c["reported"] = snapshot(c)
    with _lock:   # keep four months
        cut = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=120)).isoformat()
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
        if D.get("cache_dir"):
            storage.save(_path(), STATE)


def times():
    out = []
    for x in re.split(r"[,\s]+", os.environ.get("DISCORD_TRACK_TIMES", "00:30,08:00")):
        m = re.fullmatch(r"(\d{1,2}):(\d\d)", x.strip())
        if m:
            out.append((int(m[1]), int(m[2])))
    return out or [(0, 30), (8, 0)]


def _loop():
    time.sleep(60)
    while True:
        try:
            t = now_et()
            for i, (hh, mm) in enumerate(times()):
                at = t.replace(hour=hh, minute=mm, second=0, microsecond=0)
                slot = f"{t.date()} {hh:02d}:{mm:02d}"
                # once, inside the hour after the set time (the server may be waking up at the exact minute)
                if at <= t < at + dt.timedelta(hours=1) and slot not in STATE["posted"]:
                    STATE["posted"][slot] = int(time.time())
                    for k in sorted(STATE["posted"])[:-60]:
                        STATE["posted"].pop(k, None)
                    save()
                    run(final=i > 0)
        except Exception as e:
            print(f"pick tracker: {type(e).__name__}: {e}", file=sys.stderr)
        time.sleep(60)


def setup(**deps):
    D.update(deps)
    if deps.get("fetch"):
        G.D["fetch"] = deps["fetch"]
    if D.get("cache_dir"):
        got = storage.load(_path(), {})
        if isinstance(got, dict):
            STATE.update(got)
    if STATE.get("v", 0) < VERSION:
        # the card reader and grader were rebuilt: start the record over from the posts (nothing older was right)
        STATE["cards"] = {}
        STATE["v"] = VERSION
    if os.environ.get("DISCORD_BOT_TOKEN"):
        threading.Thread(target=_loop, daemon=True, name="pick-tracker").start()


# ---------- commands ----------
def cmd_leaderboard(o):
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
    return {"embeds": [{"title": "🏆 LEADERBOARD · " + (f"LAST {days} DAYS" if days else "ALL-TIME"), "color": B.BLUE, "description": lb,
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
    if len(sys.argv) >= 2 and sys.argv[1] == "try":   # read, grade and print; posts nothing, saves nothing
        h = int(sys.argv[2]) if len(sys.argv) > 2 else LOOK_BACK_H
        run(dry=True, hours=h)
        for c in sorted(live_cards(), key=lambda c: c["at"]):
            print(f"\n#{STATE['channels'].get(c['ch'])} {c['slate']} {c['play']} -> {c['result']}")
            for g in c["legs"]:
                print("   " + leg_line(g))
    else:
        print(__doc__)
