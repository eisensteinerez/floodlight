"""GitHub Actions: grade Floodlight's own picks (match forecasts and player props) and keep a copy of the record.

Run by .github/workflows/grade-site.yml every hour. The server on Render often can't reach ESPN and its disk is wiped
on each deploy, so this job:
  1. reads the server's record (/api/grading/state) and GitHub's saved copy (the record-data branch), and merges them
     (gradebook.merge: the earliest original wins, readings are joined, a real result beats "not graded");
  2. grades every pick that is due from ESPN (match finals from the game summary; props from the player's game log,
     MLB's own log for baseball), and re-checks results graded a day ago in case a stat was corrected;
  3. saves the merged record to data/site-record.enc (the workflow pushes it to record-data) and sends it to the server.
Picks from FotMob-only soccer leagues are left to the server, which can read FotMob.

Encrypted with a key made from DISCORD_BOT_TOKEN (the secret the pick grader already uses), so the public repo shows
nothing. Free: no AI, no paid service.

  python3 site_grader.py run      grade and save (what the workflow runs)
  python3 site_grader.py show     print the merged record's counts without grading or saving
  python3 site_grader.py send     send the saved copy to the server again (after a deploy, once the new server is up)
"""
import os
import sys
import tempfile
import time
from pathlib import Path

import discord_bot as B
import gradebook
import pick_grade
import propbook
import record

DATA = Path(os.environ.get("RECORD_DATA_DIR") or "data")
FILE = DATA / "site-record.enc"


def fetch(url, ttl, as_json=False):
    if as_json:
        return B.get_json(url, ttl)
    import urllib.request
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def setup():
    tmp = tempfile.mkdtemp()
    record.RECORD.clear()
    propbook.BOOK.clear()
    record.setup(fetch=fetch, fm_matchstats=lambda **k: None, forecaster=None, cache_dir=tmp, loop=False)
    propbook.setup(cache_dir=tmp, board=lambda s: None, grade=pick_grade.grade_prop, mlb=propbook.mlb_grade(B), loop=False)


def load():
    """Both copies merged into record.RECORD and propbook.BOOK. Returns (from_server, from_github) as booleans."""
    saved, live = None, None
    if FILE.exists():
        try:
            saved = gradebook.unseal(FILE.read_bytes())
        except Exception as e:
            print(f"site grader: couldn't open the saved copy ({type(e).__name__}); starting from the server's")
    try:
        live = gradebook.unseal(gradebook._http(gradebook.SERVER, timeout=90))
    except Exception as e:
        print(f"site grader: couldn't read the server's record ({type(e).__name__}: {e})")
    for got in (saved, live):
        gradebook.absorb(got, record, propbook)
    return bool(live), bool(saved)


def grade(now=None):
    now = now or time.time()
    n = 0
    for _ in range(6):     # a busy night has more than one batch due
        got = record.grade_pending(now=now, limit=60, by="github", give_up=True) + propbook.grade_pending(now=now, limit=80, by="github", give_up=True)
        n += got
        if not got:
            break
    record.recheck(now=now, limit=80, by="github")
    propbook.recheck(now=now, limit=120, by="github")
    return n


def save(n):
    DATA.mkdir(exist_ok=True)
    b = gradebook.bundle(record, propbook, "github")
    b["gradedAt"] = int(time.time())
    blob = gradebook.seal(b)
    FILE.write_bytes(blob)
    try:
        gradebook._http(gradebook.SERVER, blob, timeout=90)
        print("site grader: sent the record to the server")
    except Exception as e:
        print(f"site grader: couldn't send the record to the server ({type(e).__name__}: {e}); it takes GitHub's copy on its next start")


def counts():
    rc, pc = record.counts(), propbook.counts()
    return f"matches {dict(sorted(rc.items()))} · props {dict(sorted(pc.items()))}"


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if not gradebook.can_seal():
        print("Add the DISCORD_BOT_TOKEN secret to the repository (Settings > Secrets and variables > Actions) to grade the site here.")
        sys.exit(0)
    if cmd == "send":
        if not FILE.exists():
            sys.exit(0)
        for i in range(4):
            try:
                gradebook._http(gradebook.SERVER, FILE.read_bytes(), timeout=90)
                print("site grader: sent the saved record to the server")
                break
            except Exception as e:
                print(f"site grader: the server didn't take the record ({type(e).__name__}: {e}); trying again in a minute")
                time.sleep(60)
        sys.exit(0)
    setup()
    srv, gh = load()
    print(f"site grader: server copy {'read' if srv else 'missing'}, GitHub copy {'read' if gh else 'missing'} · {counts()}")
    if cmd == "show":
        sys.exit(0)
    n = grade()
    print(f"site grader: {n} picks graded · {counts()}")
    for where, msg in [(e["where"], e["error"]) for e in gradebook.STATUS["errors"]]:
        print(f"  error in {where}: {msg}")
    if srv or gh or n:
        save(n)
