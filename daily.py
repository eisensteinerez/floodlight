"""Floodlight · "Most researched today": an anonymous count of how many members opened each player in the Lab today.

The browser sends one tick per player, per device, per day (daily.js). Only the player's name, sport and the count
are kept, never who looked, and only for the last three days. Saved now and then so a restart keeps today's count.
"""
import re
import threading
import time
from pathlib import Path

import storage

PATH = Path(__file__).resolve().parent / ".floodlight-cache" / "research_counts.json"
SPORTS = {"nba", "wnba", "nfl", "nhl", "mlb", "soccer", "cbb", "cfb", "fbs", "tennis", "ufc", "boxing"}
_lock = threading.Lock()
D = {}
_state = {"saved": 0.0, "loaded": False}


def _day(t=None):
    return time.strftime("%Y-%m-%d", time.gmtime((t or time.time()) - 5 * 3600))   # the US sports day


def _load():
    if not _state["loaded"]:
        D.update(storage.load(PATH, {}))
        _state["loaded"] = True


def seen(name, sport):
    name = re.sub(r"\s+", " ", str(name or "")).strip()[:60]
    sport = str(sport or "").lower()[:8]
    if len(name) < 2 or sport not in SPORTS or not re.fullmatch(r"[\w .'\-]+", name):
        return False
    with _lock:
        _load()
        day = _day()
        for k in [k for k in D if k < _day(time.time() - 3 * 86400)]:
            D.pop(k, None)
        row = D.setdefault(day, {})
        key = f"{sport}|{name}"
        if key not in row and len(row) >= 5000:
            return False
        row[key] = row.get(key, 0) + 1
        if time.time() - _state["saved"] > 60:
            try:
                storage.save(PATH, D)
                _state["saved"] = time.time()
            except Exception as e:
                print("daily: couldn't save:", e)
    return True


def top(n=10, sport=""):
    with _lock:
        _load()
        row = D.get(_day(), {})
        out = [{"sport": k.split("|", 1)[0], "name": k.split("|", 1)[1], "n": v} for k, v in row.items() if not sport or k.startswith(sport + "|")]
    return sorted(out, key=lambda x: (-x["n"], x["name"]))[:n]
