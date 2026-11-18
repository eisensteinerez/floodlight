"""Live check of /predict (needs the internet): python3 tests/predict_live.py nba:Knicks soccer:Arsenal nfl:Eagles
Prints each embed's text. Posts nothing; nothing is saved outside a temporary folder."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402
import discord_bot as B  # noqa: E402
import forecaster  # noqa: E402

tmp = tempfile.mkdtemp()
server.odds.setup(fetch=server.fetch, similar=server.similar)
forecaster.D.update(odds=server.odds, fetch=server.fetch, similar=server.similar, tm_squad=server.tm_squad, fm_team=server.fm_team,
                    fm_league=server.fm_league, users=lambda: {}, cache_dir=tmp)
B.D.update(fetch=server.fetch, similar=server.similar, odds=server.odds, forecaster=forecaster, cache_dir=tmp)

for arg in sys.argv[1:] or ["nba:Knicks"]:
    sport, _, team = arg.partition(":")
    out = B.cmd_predict({"sport": sport, "team": team or None})
    for e in out.get("embeds") or [out]:
        print(f"\n===== /predict {arg}")
        print(e.get("title", ""))
        print(e.get("description", out.get("content", "")))
        for f in e.get("fields") or []:
            print(f"-- {f['name']}\n{f['value']}")
        print(f"[{(e.get('footer') or {}).get('text', '')}]")
