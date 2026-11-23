"""Read-only board links and line popularity (labshare.py). Run: python3 tests/test_labshare.py"""
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import labshare  # noqa: E402

labshare.setup(tempfile.mkdtemp())
board = {"id": "b1", "name": "Tonight’s NBA", "items": [{"kind": "player", "key": "player:nba:A:pts", "label": "Alpha", "sub": "Over 20.5 points", "line": 20.5},
                                                     {"kind": "note", "key": "note:1", "label": "Fade if minutes are capped"}, "junk"]}
st, out = labshare.share("erez", "Erez", board)
assert st == 200 and len(out["id"]) >= 8, out
sid = out["id"]
st, b = labshare.shared(sid)
assert st == 200 and b["name"] == "Tonight’s NBA" and b["by"] == "Erez" and len(b["items"]) == 1 and b["notes"] == ["Fade if minutes are capped"], b
assert "owner" not in b, "the owner's username is never in the public copy"
# sharing the same board again updates the same link
st, again = labshare.share("erez", "Erez", {**board, "name": "Tonight’s NBA props"})
assert again["id"] == sid and labshare.shared(sid)[1]["name"] == "Tonight’s NBA props"
# only the owner can stop sharing; then the link says so
assert labshare.unshare("someone", sid)[0] == 404
assert labshare.unshare("erez", sid)[0] == 200
assert labshare.shared(sid) == (404, {"error": "This board is no longer shared."})
assert labshare.shared("../../etc")[0] == 404
assert labshare.share("erez", "Erez", {"name": "  "})[0] == 400
# popularity: once per member per line per day
k = "nba|Alpha Player|pts"
assert labshare.count(k, "research", "u:erez") is True
assert labshare.count(k, "research", "u:erez") is False
assert labshare.count(k, "research", "g:abc") is True
assert labshare.count(k, "follow", "u:erez") is True
assert labshare.count("bad key", "research", "u:erez") is False
assert labshare.count(k, "like", "u:erez") is False
p = labshare.popular()
assert p["researched"][k] == 2 and p["followed"][k] == 1, p
print("labshare: all checks passed")
