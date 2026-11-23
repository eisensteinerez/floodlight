"""Does a sportsbook's team for a player agree with the team ESPN (or MLB) has him on?

The props boards come from PrizePicks and Sleeper, which give a player's name and a team abbreviation. Floodlight then
looks the player up by name on ESPN (MLB for baseball) to read their games. If the lookup found a different person with
the same name, or one side hasn't caught up with a trade, the two teams disagree, and the hit rates would describe
someone else. same() says True (agree), False (two different known teams) or None (can't tell, so say nothing).

Abbreviations differ between the books and ESPN (NYK and NY, GSW and GS, TBL and TB), so both sides are mapped to
ESPN's abbreviation first. An abbreviation that isn't a known team is "can't tell", never a mismatch.
"""

TEAMS = {
    "nba": "ATL BOS BKN CHA CHI CLE DAL DEN DET GS HOU IND LAC LAL MEM MIA MIL MIN NO NY OKC ORL PHI PHX POR SAC SA TOR UTAH WSH",
    "wnba": "ATL CHI CON DAL GS IND LV LA MIN NY PHX POR SEA TOR WSH",
    "nfl": "ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WSH",
    "nhl": "ANA BOS BUF CGY CAR CHI COL CBJ DAL DET EDM FLA LA MIN MTL NSH NJ NYI NYR OTT PHI PIT SJ SEA STL TB TOR UTAH VAN VGK WSH WPG",
    "mlb": "ARI ATH ATL BAL BOS CHC CHW CIN CLE COL DET HOU KC LAA LAD MIA MIL MIN NYM NYY PHI PIT SD SEA SF STL TB TEX TOR WSH",
}
TEAMS = {k: set(v.split()) for k, v in TEAMS.items()}

ALIAS = {
    "nba": {"BRK": "BKN", "BKLYN": "BKN", "CHO": "CHA", "GSW": "GS", "NOP": "NO", "NOR": "NO", "NYK": "NY", "PHO": "PHX", "SAS": "SA",
            "UTA": "UTAH", "WAS": "WSH"},
    "wnba": {"LVA": "LV", "LAS": "LA", "NYL": "NY", "WAS": "WSH", "CONN": "CON", "GSV": "GS", "GSW": "GS", "PHO": "PHX", "TOR": "TOR"},
    "nfl": {"JAC": "JAX", "WAS": "WSH", "LA": "LAR", "LVR": "LV", "OAK": "LV", "KAN": "KC", "GNB": "GB", "NWE": "NE", "NOR": "NO", "SFO": "SF",
            "TAM": "TB", "ARZ": "ARI", "HST": "HOU", "BLT": "BAL", "CLV": "CLE"},
    "nhl": {"LAK": "LA", "NJD": "NJ", "SJS": "SJ", "TBL": "TB", "UTA": "UTAH", "MON": "MTL", "WAS": "WSH", "VEG": "VGK", "NAS": "NSH",
            "CLB": "CBJ", "CLS": "CBJ", "CAL": "CGY", "WIN": "WPG", "WPJ": "WPG"},
    "mlb": {"AZ": "ARI", "OAK": "ATH", "CWS": "CHW", "KCR": "KC", "SDP": "SD", "SFG": "SF", "TBR": "TB", "WSN": "WSH", "WAS": "WSH",
            "ANA": "LAA", "LA": "LAD"},
}


def canon(sport, abbr):
    """ESPN's abbreviation for a team, or None if it isn't one we know."""
    a = str(abbr or "").strip().upper()
    if not a or sport not in TEAMS:
        return None
    a = ALIAS[sport].get(a, a)
    return a if a in TEAMS[sport] else None


def same(sport, book, espn):
    """True, False, or None (can't tell)."""
    b, e = canon(sport, book), canon(sport, espn)
    if not b or not e:
        return None
    return b == e


def note(sport, book, espn_abbr, espn_name, src="ESPN"):
    """A line for the page when the two disagree, or ''."""
    if same(sport, book, espn_abbr) is False:
        return (f"The books list this player with {str(book).upper()}, but {src} has them on {espn_name or espn_abbr}. "
                "The numbers may belong to another player with the same name, so check before using this line.")
    return ""
