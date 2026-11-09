"""Floodlight odds board: one game's lines and player props from several books, side by side.

  Kalshi        game lines and NFL player props (passing, rushing and receiving yards, receptions, TDs)
  FanDuel       game lines and every player prop it posts (public sportsbook API, Ohio market)
  DraftKings    moneyline, spread and total, through ESPN's odds feed (DraftKings blocks direct access)
  Polymarket    moneyline, spreads, totals and corners

Fanatics blocks outside apps, so it isn't included. Every price is kept as American odds plus the implied
chance, so the page can show the best price for each bet and flag prices that beat the consensus.
"""
import datetime
import json
import re
import time
import urllib.parse

D = {}   # fetch, similar from server.py
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/"
FD = "https://sbapi.oh.sportsbook.fanduel.com/api/"
FD_AK = "FhMFpcPWXMeyZxOx"
PM = "https://gamma-api.polymarket.com/"
ESPN = "https://site.api.espn.com/apis/site/v2/sports"
PM_SERIES = {"nfl": 12185, "fbs": 12756, "eng.1": 10188, "esp.1": 10193, "ger.1": 10194, "fra.1": 10195, "ita.1": 10203,
             "uefa.champions": 10204, "usa.1": 10189}
KX_SOCCER = {'eng.1': 'EPL', 'esp.1': 'LALIGA', 'ger.1': 'BUNDESLIGA', 'ita.1': 'SERIEA', 'fra.1': 'LIGUE1', 'por.1': 'LIGAPORTUGAL', 'ned.1': 'EREDIVISIE',
             'sco.1': 'SCOTTISHPREM', 'tur.1': 'SUPERLIG', 'eng.2': 'EFLCHAMPIONSHIP', 'uefa.champions': 'UCL', 'uefa.europa': 'UEL', 'uefa.europa.conf': 'UECL',
             'eng.fa': 'FACUP', 'eng.league_cup': 'EFLCUP', 'usa.1': 'MLS', 'mex.1': 'LIGAMX', 'bra.1': 'BRASILEIRO', 'ksa.1': 'SAUDIPL', 'isr.1': 'ISRPL', 'arg.1': 'ARGPREMDIV'}
KX_FOOTBALL = {"nfl": "NFL", "fbs": "NCAAF", "fcs": "NCAAFCS", "d3": "NCAAFD3", "ufl": "UFL"}
FB_PATH = {"nfl": "football/nfl", "fbs": "football/college-football", "fcs": "football/college-football", "d2": "football/college-football",
           "d3": "football/college-football", "ufl": "football/ufl"}


def query_for(sport, lg, eid, home, away, date):
    """The board's inputs for a match the forecaster knows about."""
    return {"sport": sport, "lg": lg, "id": eid, "home": home, "away": away, "date": date,
            "kx": KX_SOCCER.get(lg) if sport == "soccer" else KX_FOOTBALL.get(lg),
            "espn": f"soccer/{lg}" if sport == "soccer" else FB_PATH.get(lg)}


FD_PAGES = {"nfl": "page=CUSTOM&customPageId=nfl", "fbs": "page=CUSTOM&customPageId=ncaaf", "fcs": "page=CUSTOM&customPageId=ncaaf",
            "soccer": "page=SPORT&eventTypeId=1", "nba": "page=CUSTOM&customPageId=nba", "wnba": "page=CUSTOM&customPageId=wnba",
            "mlb": "page=CUSTOM&customPageId=mlb"}
KALSHI_PROPS = {"nfl": [("KXNFLPASSYDS", "pass_yds"), ("KXNFLRSHYDS", "rush_yds"), ("KXNFLRECYDS", "rec_yds"),
                        ("KXNFLREC", "receptions"), ("KXNFLPASSTDS", "pass_td"), ("KXNFLTD", "anytime_td")]}
LABELS = {"pass_yds": "Passing yards", "rush_yds": "Rushing yards", "rec_yds": "Receiving yards", "receptions": "Receptions",
          "pass_td": "Passing TDs", "pass_att": "Pass attempts", "pass_cmp": "Completions", "rush_att": "Rushing attempts",
          "rush_rec_yds": "Rushing + receiving yards", "anytime_td": "Anytime touchdown", "anytime_goal": "Anytime goal",
          "shots": "Shots", "sot": "Shots on target", "assists": "Assists", "passes": "Passes", "tackles": "Tackles",
          "int": "Interceptions thrown", "longest_rec": "Longest reception", "longest_rush": "Longest rush", "sacks": "Sacks",
          "points": "Points", "rebounds": "Rebounds", "pra": "Pts + Reb + Ast", "pr": "Pts + Reb", "pa": "Pts + Ast", "ra": "Reb + Ast",
          "threes": "3-pointers made", "steals": "Steals", "blocks": "Blocks", "hits": "Hits", "total_bases": "Total bases",
          "hrr": "Hits + runs + RBIs", "rbi": "RBIs", "runs": "Runs", "home_runs": "Home runs", "strikeouts": "Strikeouts",
          "outs": "Outs recorded", "earned_runs": "Earned runs", "hits_allowed": "Hits allowed", "walks": "Walks", "stolen_bases": "Stolen bases"}
FD_CAT = [(r"pts \+ reb \+ ast|points \+ rebounds \+ assists", "pra"), (r"pts \+ reb|points \+ rebounds", "pr"),
          (r"pts \+ ast|points \+ assists", "pa"), (r"reb \+ ast|rebounds \+ assists", "ra"), (r"made threes|three point|3-pt|threes", "threes"),
          (r"hits \+ runs \+ rbi|h\+r\+rbi", "hrr"), (r"hits allowed", "hits_allowed"), (r"earned runs", "earned_runs"),
          (r"outs recorded|pitching outs", "outs"), (r"total bases", "total_bases"), (r"home runs?", "home_runs"), (r"stolen bases?", "stolen_bases"),
          (r"passing yd|passing yards|pass yds", "pass_yds"), (r"rushing \+ receiving|rush \+ rec", "rush_rec_yds"),
          (r"rushing yd|rushing yards|rush yds", "rush_yds"), (r"receiving yd|receiving yards|rec yds", "rec_yds"),
          (r"receptions", "receptions"), (r"passing td|passing touchdown", "pass_td"), (r"pass(ing)? attempts", "pass_att"),
          (r"completions", "pass_cmp"), (r"rush(ing)? attempts", "rush_att"), (r"shots on target", "sot"), (r"^shots|total shots", "shots"),
          (r"assists", "assists"), (r"passes", "passes"), (r"tackles", "tackles"), (r"interceptions", "int"),
          (r"longest reception", "longest_rec"), (r"longest rush", "longest_rush"), (r"sacks", "sacks"),
          (r"^points|total points", "points"), (r"rebounds", "rebounds"), (r"steals", "steals"), (r"blocks", "blocks"),
          (r"strikeouts", "strikeouts"), (r"^hits|hits recorded", "hits"), (r"rbis?\b", "rbi"), (r"^runs|runs scored", "runs"), (r"walks", "walks")]


def setup(**deps):
    D.update(deps)


# ---------- prices ----------

def from_p(p):
    if not p or p <= 0.005 or p >= 0.995:
        return None
    return {"am": round(-100 * p / (1 - p)) if p >= .5 else round(100 * (1 - p) / p), "p": round(p, 4)}


def from_am(am):
    try:
        am = float(am)
    except (TypeError, ValueError):
        return None
    if not am:
        return None
    return {"am": int(am), "p": round(100 / (am + 100) if am > 0 else -am / (-am + 100), 4)}


def decimal(x):
    am = x["am"]
    return 1 + (am / 100 if am > 0 else 100 / -am)


def kx_price(m):
    b, a, l = (float(m.get(k) or 0) for k in ("yes_bid_dollars", "yes_ask_dollars", "last_price_dollars"))
    return (b + a) / 2 if b > 0 and a > 0 else l or b or a or 0


def _day(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def _kx_day(ticker):
    m = re.search(r"-(\d{2})([A-Z]{3})(\d{2})", ticker or "")
    return datetime.datetime(2000 + int(m.group(1)), MON[m.group(2)], int(m.group(3)), 12, tzinfo=datetime.timezone.utc).timestamp() if m else None


ALIASES = [(r"\bnottm\b", "nottingham"), (r"\b(m|borussia )?gladbach\b", "monchengladbach"), (r"\bm[oö]nchengladbach\b", "monchengladbach"),
           (r"\bleverkusen\b", "bayer leverkusen"), (r"\bwolves\b", "wolverhampton"), (r"\bbrighton\b", "brighton hove albion"), (r"\bman utd\b", "manchester united"), (r"\bman city\b", "manchester city"), (r"\bspurs\b", "tottenham"),
           (r"\bwolves\b", "wolverhampton"), (r"\bsheff\b", "sheffield"), (r"\bqpr\b", "queens park rangers"), (r"\bpsg\b", "paris saint germain"),
           (r"\bath(letic)? bilbao\b", "athletic club"), (r"\batl(etico)? madrid\b", "atletico madrid"), (r"\binter\b", "internazionale")]


def _al(s):
    s = re.sub(r"[´`’']", "", (s or "").lower())
    for pat, rep in ALIASES:
        s = re.sub(pat, rep, s)
    return s


def _match(home, away, a, b):
    """How well a pair of names (either order) matches the two teams."""
    sim = lambda x, y: D["similar"](_al(x), _al(y))
    return max(sim(home, a) + sim(away, b), sim(home, b) + sim(away, a))


def _side(home, away, label):
    sim = lambda x, y: D["similar"](_al(x), _al(y))
    h, a = sim(home, label), sim(away, label)
    return "home" if h > a and h >= .4 else "away" if a > h and a >= .4 else None


def _pname(s):
    return re.sub(r"[^a-z ]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (s or "").lower())).strip()


# ---------- Kalshi ----------

def kalshi(kx, sport_lg, g):
    out = {"book": "kalshi", "name": "Kalshi", "kind": "exchange", "url": "https://kalshi.com/sports"}
    if not kx:
        return None
    ko = g["ko"]

    def find(series):
        d = D["fetch"](f"{KALSHI}events?series_ticker={series}&status=open&with_nested_markets=true&limit=200", 20, as_json=True)
        best, score = None, 0
        for ev in d.get("events") or []:
            kd = _kx_day(ev.get("event_ticker"))
            if kd and abs(kd - ko) > 1.6 * 86400:
                continue
            parts = re.split(r" vs\.? | v | at ", (ev.get("title") or "").split(":")[0])
            if len(parts) < 2:
                continue
            s = _match(g["home"], g["away"], parts[0], parts[1])
            if s > score:
                best, score = ev, s
        return best if score >= 1.1 else None

    try:
        ev = find(f"KX{kx}GAME")
        if ev:
            ml = {}
            for m in ev.get("markets") or []:
                lbl = m.get("yes_sub_title") or ""
                side = "draw" if re.fullmatch(r"(tie|draw)", lbl, re.I) else _side(g["home"], g["away"], re.sub(r" wins?$", "", lbl, flags=re.I))
                if side and from_p(kx_price(m)):
                    ml[side] = from_p(kx_price(m))
            if ml:
                out["ml"] = ml
        ev = find(f"KX{kx}SPREAD")
        if ev:
            out["spread"] = [{"side": s, "line": -float(m["floor_strike"]), "price": from_p(kx_price(m))}
                             for m in ev.get("markets") or [] if m.get("floor_strike")
                             for s in [_side(g["home"], g["away"], re.sub(r" wins? by.*$", "", m.get("yes_sub_title") or "", flags=re.I))] if s and from_p(kx_price(m))]
        ev = find(f"KX{kx}TOTAL")
        if ev:
            out["total"] = [{"line": float(m["floor_strike"]), "over": from_p(kx_price(m)), "under": from_p(1 - kx_price(m))}
                            for m in ev.get("markets") or [] if m.get("floor_strike") and from_p(kx_price(m))]
    except Exception as e:
        out["error"] = str(e)[:120]
    props = []
    for series, cat in KALSHI_PROPS.get(sport_lg, []):
        try:
            ev = find(series)
        except Exception:
            continue
        if not ev:
            continue
        ladders = {}
        for m in ev.get("markets") or []:
            mm = re.match(r"(.+?):\s*(\d+)\+", m.get("yes_sub_title") or "")
            p = kx_price(m)
            if not mm or not from_p(p):
                continue
            ladders.setdefault(mm.group(1).strip(), []).append({"line": int(mm.group(2)) - .5, "over": from_p(p), "under": from_p(1 - p)})
        for player, rungs in ladders.items():
            rungs.sort(key=lambda r: r["line"])
            if cat == "anytime_td":
                r = next((x for x in rungs if x["line"] == .5), None)
                if r:
                    props.append({"cat": cat, "player": player, "kind": "yes", "yes": r["over"]})
                continue
            props.append({"cat": cat, "player": player, "kind": "ou", "ladder": rungs})
    if props:
        out["props"] = props
    return out if any(k in out for k in ("ml", "spread", "total", "props")) else None


# ---------- FanDuel ----------

def _fd_runner(r):
    o = ((r.get("winRunnerOdds") or {}).get("americanDisplayOdds") or {}).get("americanOddsInt")
    return from_am(o) if r.get("runnerStatus", "ACTIVE") == "ACTIVE" else None


def fanduel(lg, g):
    page = FD_PAGES.get(lg) or (FD_PAGES["soccer"] if g["sport"] == "soccer" else None)
    if not page:
        return None
    out = {"book": "fanduel", "name": "FanDuel", "kind": "sportsbook", "url": "https://sportsbook.fanduel.com"}
    d = D["fetch"](f"{FD}content-managed-page?{page}&_ak={FD_AK}&timezone=America%2FNew_York", 300, as_json=True)
    best, score = None, 0
    for e in ((d.get("attachments") or {}).get("events") or {}).values():
        parts = re.split(r" @ | v | vs\.? ", e.get("name") or "")
        t = _day(e.get("openDate"))
        if len(parts) != 2 or not t or abs(t - g["ko"]) > 1.5 * 86400:
            continue
        s = _match(g["home"], g["away"], parts[1], parts[0])
        if s > score:
            best, score = e, s
    if not best or score < 1.1:
        return None
    eid = best["eventId"]
    out["url"] = f"https://sportsbook.fanduel.com/event/{eid}"
    first = D["fetch"](f"{FD}event-page?_ak={FD_AK}&eventId={eid}&tab=", 60, as_json=True)
    pages = [first]
    tabs = [v.get("title") or "" for v in ((first.get("layout") or {}).get("tabs") or {}).values()]
    for t in tabs:
        if re.search(r"prop|scorer|shots|player|goalscorer", t, re.I) and not re.search(r"team|quarter|parlay|d/st", t, re.I):
            slug = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
            try:
                pages.append(D["fetch"](f"{FD}event-page?_ak={FD_AK}&eventId={eid}&tab={slug}", 60, as_json=True))
            except Exception:
                pass
    markets = {}
    for pg in pages:
        markets.update((pg.get("attachments") or {}).get("markets") or {})
    props = {}
    for m in markets.values():
        mt, name, runners = m.get("marketType") or "", m.get("marketName") or "", m.get("runners") or []
        if m.get("marketStatus") not in (None, "OPEN"):
            continue
        if mt in ("MONEY_LINE", "WIN-DRAW-WIN", "MATCH_ODDS"):
            ml = {}
            for r in runners:
                side = "draw" if re.fullmatch(r"(draw|tie)", r.get("runnerName") or "", re.I) else _side(g["home"], g["away"], r.get("runnerName"))
                if side and _fd_runner(r):
                    ml[side] = _fd_runner(r)
            if len(ml) >= 2:
                out["ml"] = ml
        elif mt == "MATCH_HANDICAP_(2-WAY)" or mt == "ASIAN_HANDICAP":
            out.setdefault("spread", [])
            for r in runners:
                side = _side(g["home"], g["away"], re.sub(r"\s*\(.*\)$", "", r.get("runnerName") or ""))
                if side and _fd_runner(r):
                    out["spread"].append({"side": side, "line": float(r.get("handicap") or 0), "price": _fd_runner(r)})
        elif mt in ("TOTAL_POINTS_(OVER/UNDER)",) or re.fullmatch(r"OVER_UNDER_\d+", mt):
            ou = {}
            line = None
            for r in runners:
                nm = r.get("runnerName") or ""
                line = float(r.get("handicap") or 0) or line or (float(re.search(r"[\d.]+", nm).group()) if re.search(r"[\d.]+", nm) else None)
                k = "over" if nm.lower().startswith("over") else "under" if nm.lower().startswith("under") else None
                if k and _fd_runner(r):
                    ou[k] = _fd_runner(r)
            if line and ou.get("over"):
                out.setdefault("total", []).append({"line": line, **ou})
        elif mt.startswith("PLAYER_") and "_ALT_" not in mt and len(runners) == 2 and " - " in name:
            player, label = name.split(" - ", 1)
            cat = next((c for pat, c in FD_CAT if re.search(pat, label, re.I)), re.sub(r"[^a-z0-9]+", "_", label.lower()))
            ou = {}
            line = None
            for r in runners:
                nm = (r.get("runnerName") or "").lower()
                line = float(r.get("handicap") or 0) or line
                k = "over" if nm.endswith("over") else "under" if nm.endswith("under") else None
                if k and _fd_runner(r):
                    ou[k] = _fd_runner(r)
            if line and ou.get("over"):
                props[(cat, player)] = {"cat": cat, "label": label, "player": player.strip(), "kind": "ou", "line": line, **ou}
        elif re.fullmatch(r"ANY_TIME_TOUCHDOWN_SCORER|ANYTIME_GOALSCORER|ANY_TIME_GOALSCORER|PLAYER_TO_SCORE|TO_SCORE_ANYTIME", mt):
            cat = "anytime_td" if "TOUCHDOWN" in mt else "anytime_goal"
            for r in runners:
                if _fd_runner(r) and r.get("runnerName") and not re.search(r"no (touchdown|goal)", r["runnerName"], re.I):
                    props[(cat, r["runnerName"])] = {"cat": cat, "player": r["runnerName"], "kind": "yes", "yes": _fd_runner(r)}
        elif re.fullmatch(r"(PLAYER_)?TO_HAVE_(\d)\+_SHOTS(_ON_TARGET)?", mt):
            n = int(re.search(r"(\d)\+", mt).group(1))
            cat = "sot" if "TARGET" in mt else "shots"
            for r in runners:
                if _fd_runner(r):
                    props[(cat, r["runnerName"])] = {"cat": cat, "player": r["runnerName"], "kind": "ou", "line": n - .5, "over": _fd_runner(r)}
    if props:
        out["props"] = list(props.values())
    return out if any(k in out for k in ("ml", "spread", "total", "props")) else None


# ---------- DraftKings (through ESPN) ----------

def draftkings(espn_path, eid, g):
    if not espn_path or not eid:
        return None
    s = D["fetch"](f"{ESPN}/{espn_path}/summary?event={eid}", 60, as_json=True)
    pc = next((x for x in s.get("pickcenter") or [] if "draftkings" in ((x.get("provider") or {}).get("name") or "").lower()), None)
    if not pc:
        return None
    h, a = pc.get("homeTeamOdds") or {}, pc.get("awayTeamOdds") or {}
    out = {"book": "draftkings", "name": "DraftKings", "kind": "sportsbook", "url": "https://sportsbook.draftkings.com", "via": "ESPN"}
    ml = {k: from_am(v) for k, v in (("home", h.get("moneyLine")), ("away", a.get("moneyLine")), ("draw", (pc.get("drawOdds") or {}).get("moneyLine"))) if from_am(v)}
    if ml:
        out["ml"] = ml
    sp = pc.get("spread")
    if sp is not None and g["sport"] in ("football", "basketball", "baseball"):
        hf = h.get("favorite")
        hl = -abs(float(sp)) if hf else abs(float(sp))
        out["spread"] = [x for x in ({"side": "home", "line": hl, "price": from_am(h.get("spreadOdds"))},
                                     {"side": "away", "line": -hl, "price": from_am(a.get("spreadOdds"))}) if x["price"]]
    if pc.get("overUnder"):
        out["total"] = [{"line": float(pc["overUnder"]), "over": from_am(pc.get("overOdds")), "under": from_am(pc.get("underOdds"))}]
    return out


# ---------- Polymarket ----------

def polymarket(lg, g):
    sid = PM_SERIES.get(lg)
    if not sid:
        return None
    d = D["fetch"](f"{PM}events?series_id={sid}&closed=false&limit=300", 60, as_json=True) or []
    out = {"book": "polymarket", "name": "Polymarket", "kind": "exchange", "url": "https://polymarket.com/sports"}
    found = False
    for ev in d:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", ev.get("slug") or "")
        if not m or abs(datetime.datetime.fromisoformat(m.group(1) + "T12:00:00+00:00").timestamp() - g["ko"]) > 1.6 * 86400:
            continue
        parts = re.split(r" vs\.? ", re.sub(r"\s*-\s*.*$", "", ev.get("title") or ""))
        if len(parts) != 2 or _match(g["home"], g["away"], parts[0], parts[1]) < 1.1:
            continue
        found = True
        if "player-props" in (ev.get("slug") or ""):
            _pm_props(ev, out)
            continue
        out["url"] = f"https://polymarket.com/event/{ev.get('slug')}"
        for mk in ev.get("markets") or []:
            if mk.get("closed"):
                continue
            try:
                outs, prices = json.loads(mk.get("outcomes") or "[]"), _pm_prices(mk)
            except Exception:
                continue
            t, q = mk.get("sportsMarketType") or "", mk.get("question") or ""
            if t == "moneyline":
                if outs[:2] != ["Yes", "No"]:
                    for o, p in zip(outs, prices):
                        side = _side(g["home"], g["away"], o)
                        if side and from_p(p):
                            out.setdefault("ml", {})[side] = from_p(p)
                else:
                    side = "draw" if re.search(r"draw", q, re.I) else _side(g["home"], g["away"], re.sub(r"^will |\s+win.*$", "", q, flags=re.I))
                    if side and from_p(prices[0]):
                        out.setdefault("ml", {})[side] = from_p(prices[0])
            elif t == "spreads" and mk.get("line") is not None and g["sport"] == "football":
                for o, p in zip(outs, prices):
                    side = _side(g["home"], g["away"], o)
                    if side and from_p(p):
                        first = outs.index(o) == 0
                        out.setdefault("spread", []).append({"side": side, "line": float(mk["line"]) * (1 if first else -1), "price": from_p(p)})
            elif t in ("totals", "total_corners") and mk.get("line") is not None and from_p(prices[0]):
                key = "total" if t == "totals" else "corners"
                out.setdefault(key, []).append({"line": float(mk["line"]), "over": from_p(prices[0]), "under": from_p(prices[1]) if len(prices) > 1 else None})
    return out if found and any(k in out for k in ("ml", "spread", "total", "corners", "props")) else None


def _pm_prices(mk):
    """Mid of the best bid and ask when the book is tight, otherwise the last quoted prices."""
    prices = [float(x) for x in json.loads(mk.get("outcomePrices") or "[]")]
    bid, ask = mk.get("bestBid"), mk.get("bestAsk")
    if bid is not None and ask is not None and 0 < float(ask) - float(bid) <= .1 and len(prices) == 2:
        mid = (float(bid) + float(ask)) / 2
        prices = [mid, 1 - mid]
    return prices


PM_PROPS = {"passing_yards": "pass_yds", "rushing_yards": "rush_yds", "receiving_yards": "rec_yds", "receptions": "receptions",
            "passing_touchdowns": "pass_td", "passing_attempts": "pass_att", "passing_completions": "pass_cmp",
            "longest_reception": "longest_rec", "anytime_touchdowns": "anytime_td", "anytime_goalscorer": "anytime_goal",
            "shots_on_target": "sot", "shots": "shots"}


def _pm_props(ev, out):
    ladders = {}
    for mk in ev.get("markets") or []:
        cat = PM_PROPS.get(mk.get("sportsMarketType") or "")
        if not cat or mk.get("closed"):
            continue
        bid, ask = mk.get("bestBid"), mk.get("bestAsk")
        if bid is None or ask is None or float(ask) - float(bid) > .12:      # skip markets nobody is really trading
            continue
        p = (float(bid) + float(ask)) / 2
        player = (mk.get("question") or "").split(":")[0].strip()
        if not from_p(p) or not player:
            continue
        if cat in ("anytime_td", "anytime_goal"):
            out.setdefault("props", []).append({"cat": cat, "player": player, "kind": "yes", "yes": from_p(p)})
        elif mk.get("line") is not None:
            ladders.setdefault((cat, player), []).append({"line": float(mk["line"]), "over": from_p(p), "under": from_p(1 - p)})
    for (cat, player), rungs in ladders.items():
        out.setdefault("props", []).append({"cat": cat, "player": player, "kind": "ou", "ladder": sorted(rungs, key=lambda r: r["line"])})


# ---------- the board ----------

def _consensus(offers, keys, skip=None):
    """Average no-vig chance across books for one bet, optionally leaving one book out."""
    fair = {k: [] for k in keys}
    for o in offers:
        if o["book"] == skip:
            continue
        ps = [o.get(k) for k in keys]
        if len(keys) > 1 and all(ps):
            s = sum(p["p"] for p in ps)
            for k, p in zip(keys, ps):
                fair[k].append(p["p"] / s)
        elif ps[0]:
            # one-sided price: exchanges are close to fair; a sportsbook's price carries roughly 6% margin
            fair[keys[0]].append(ps[0]["p"] if o.get("exchange") else ps[0]["p"] * .94)
    return {k: sum(v) / len(v) for k, v in fair.items() if v}


def _best(offers, k, keys):
    """The best price for one outcome, and its expected value against the other books' consensus."""
    cands = [o for o in offers if o.get(k)]
    if not cands:
        return None
    o = max(cands, key=lambda c: decimal(c[k]))
    others = _consensus(offers, keys, skip=o["book"])
    ev = others[k] * decimal(o[k]) - 1 if others.get(k) and len([c for c in offers if c["book"] != o["book"]]) >= 1 else None
    return {"book": o["book"], "price": o[k], "ev": round(ev, 4) if ev is not None else None, "n": len(cands)}


def _interp(ladder, line):
    """Chance of going over any line, read off an exchange's ladder of thresholds (kept non-increasing)."""
    pts, run = [], 1.0
    for r in sorted(ladder, key=lambda r: r["line"]):
        run = min(run, r["over"]["p"])
        pts.append((r["line"], run))
    if not pts or not (pts[0][0] <= line <= pts[-1][0]):
        return None
    for (l0, p0), (l1, p1) in zip(pts, pts[1:] + [pts[-1]]):
        if l0 <= line <= l1:
            return p0 if l1 == l0 else p0 + (p1 - p0) * (line - l0) / (l1 - l0)
    return None


_boards = {}


def board(q):
    key = json.dumps([q.get(k) for k in ("sport", "lg", "id", "home", "away", "kx", "espn")])
    hit = _boards.get(key)
    if hit and time.time() - hit[0] < (5 if hit[1].get("errors") else 20):
        return hit[1]
    out = _board(q)
    _boards[key] = (time.time(), out)
    if len(_boards) > 200:
        for k in sorted(_boards, key=lambda k: _boards[k][0])[:100]:
            _boards.pop(k, None)
    return out


def _board(q):
    g = {"sport": q.get("sport"), "home": q.get("home", ""), "away": q.get("away", ""), "ko": _day(q.get("date")) or time.time()}
    lg = q.get("lg", "")
    jobs = [("kalshi", lambda: kalshi(q.get("kx"), lg, g)), ("fanduel", lambda: fanduel(lg, g)),
            ("draftkings", lambda: draftkings(q.get("espn"), q.get("id"), g)), ("polymarket", lambda: polymarket(lg, g))]
    books, errors = [], {}
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(4) as ex:
        futs = {name: ex.submit(fn) for name, fn in jobs}
        for name, f in futs.items():
            try:
                r = f.result(timeout=45)
                if r:
                    books.append(r)
            except Exception as e:
                errors[name] = str(e)[:120]
    exch = {b["book"] for b in books if b["kind"] == "exchange"}
    # moneyline
    keys = ["home", "draw", "away"] if g["sport"] == "soccer" else ["home", "away"]
    ml_offers = [{"book": b["book"], "exchange": b["book"] in exch, **b["ml"]} for b in books if b.get("ml")]
    ml_fair = _consensus(ml_offers, keys)
    ml = {"offers": ml_offers, "fair": ml_fair, "best": {k: _best(ml_offers, k, keys) for k in keys}}
    # totals: compare at each book's main line and at lines more than one book shares
    tot = []
    for b in books:
        for t in b.get("total") or []:
            tot.append({"book": b["book"], "exchange": b["book"] in exch, **t})
    by_line = {}
    for t in tot:
        by_line.setdefault(t["line"], []).append(t)
    totals = []
    for line, offers in sorted(by_line.items()):
        fair = _consensus(offers, ["over", "under"])
        totals.append({"line": line, "offers": offers, "fair": fair, "best": {k: _best(offers, k, ["over", "under"]) for k in ("over", "under")}})
    # spreads, keyed by the home team's line
    sp = {}
    for b in books:
        for s in b.get("spread") or []:
            hl = s["line"] if s["side"] == "home" else -s["line"]
            o = sp.setdefault(hl, {}).setdefault(b["book"], {"book": b["book"], "exchange": b["book"] in exch})
            o[s["side"]] = s["price"]
    spreads = []
    for hl, offs in sorted(sp.items()):
        offers = list(offs.values())
        fair = _consensus(offers, ["home", "away"])
        spreads.append({"homeLine": hl, "offers": offers, "fair": fair, "best": {k: _best(offers, k, ["home", "away"]) for k in ("home", "away")}})
    corners = []
    for b in books:
        for c in b.get("corners") or []:
            corners.append({"book": b["book"], **c})
    # player props: one row per player and stat, every book's price at the line most books use
    rows = {}
    for b in books:
        for p in b.get("props") or []:
            key = (p["cat"], _pname(p["player"]))
            r = rows.setdefault(key, {"cat": p["cat"], "label": LABELS.get(p["cat"], p.get("label") or p["cat"]), "player": p["player"], "kind": p["kind"], "offers": []})
            r["offers"].append({"book": b["book"], "exchange": b["book"] in exch, **p})
    props = []
    for r in rows.values():
        if r["kind"] == "yes":
            offers = [{"book": o["book"], "exchange": o["exchange"], "yes": o["yes"]} for o in r["offers"]]
            ex = [o["yes"]["p"] for o in offers if o["exchange"]]
            fair = {"yes": sum(ex) / len(ex)} if ex else {}
            props.append({**r, "offers": offers, "fair": _consensus(offers, ["yes"]), "best": {"yes": _best(offers, "yes", ["yes"])}})
            continue
        lines = [o["line"] for o in r["offers"] if o.get("line")]
        main = max(set(lines), key=lines.count) if lines else None
        offers = []
        for o in r["offers"]:
            if o.get("ladder"):
                # price the exchange at the sportsbooks' line when its ladder covers it, else show its nearest-to-even rung
                pi = _interp(o["ladder"], main) if main is not None else None
                if pi is not None and from_p(pi):
                    offers.append({"book": o["book"], "exchange": True, "line": main, "over": from_p(pi), "under": from_p(1 - pi), "ladder": o["ladder"],
                                   "interp": not any(x["line"] == main for x in o["ladder"])})
                else:
                    rung = min(o["ladder"], key=lambda x: abs(x["over"]["p"] - .5))
                    offers.append({"book": o["book"], "exchange": True, "line": rung["line"], "over": rung["over"], "under": rung["under"], "ladder": o["ladder"]})
            else:
                offers.append({k: o.get(k) for k in ("book", "exchange", "line", "over", "under")})
        line = main if main is not None else offers[0]["line"]
        same = [o for o in offers if o["line"] == line]
        fair = _consensus(same, ["over", "under"])
        props.append({**r, "line": line, "offers": offers, "fair": fair, "best": {k: _best(same, k, ["over", "under"]) for k in ("over", "under")}})
    order = list(LABELS)
    props.sort(key=lambda p: (order.index(p["cat"]) if p["cat"] in order else 99, p["player"]))
    return {"books": [{k: b.get(k) for k in ("book", "name", "kind", "url", "via")} for b in books], "ml": ml, "spreads": spreads,
            "totals": totals, "corners": corners, "props": props, "errors": errors,
            "missing": [{"name": "Fanatics", "why": "Fanatics blocks outside apps from reading its odds."}] +
                       ([{"name": "DraftKings props", "why": "DraftKings blocks direct access; only its main lines come through ESPN."}] if True else []),
            "fetched": int(time.time())}


def value_picks(b, limit=6):
    """Bets where the best available price beats the other books' consensus. Needs at least three prices,
    including a sportsbook, and skips long shots, where thin markets disagree the most."""
    out = []
    def ok(offers, best):
        return best and best.get("ev") is not None and best["price"]["p"] >= .2 and len(offers) >= 3 and any(not o.get("exchange") for o in offers)
    for p in b.get("props") or []:
        same = [o for o in p["offers"] if p["kind"] == "yes" or o.get("line") == p.get("line")]
        for k, best in (p.get("best") or {}).items():
            if ok(same, best) and best["ev"] >= .03:
                out.append({"type": "prop", "label": f"{p['player']} {'to score' if p['kind'] == 'yes' else ('over' if k == 'over' else 'under') + ' ' + str(p['line'])} · {p['label']}",
                            "book": best["book"], "price": best["price"], "ev": best["ev"], "fair": p["fair"].get(k)})
    for k, best in (b.get("ml", {}).get("best") or {}).items():
        if ok(b["ml"]["offers"], best) and best["ev"] >= .02:
            out.append({"type": "ml", "label": k, "book": best["book"], "price": best["price"], "ev": best["ev"], "fair": b["ml"]["fair"].get(k)})
    for t in b.get("totals") or []:
        for k, best in (t.get("best") or {}).items():
            if ok(t["offers"], best) and best["ev"] >= .03:
                out.append({"type": "total", "label": f"{k.title()} {t['line']}", "book": best["book"], "price": best["price"], "ev": best["ev"], "fair": t["fair"].get(k)})
    out.sort(key=lambda x: -x["ev"])
    return out[:limit]
