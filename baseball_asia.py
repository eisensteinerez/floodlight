"""Player data for the Asian leagues Flashscore covers without player stats.

  KBO   koreabaseball.com (Korean record tables, every player by team) and eng.koreabaseball.com (English names,
        photos, bio, season and career stats, game logs)
  NPB   Yahoo! Japan (sports navi): team batting and pitching tables (every player), player pages with photos and bio.
        npb.jp itself doesn't answer from outside Japan. Names are written in kanji; the katakana reading on each
        player page is turned into Latin letters.
  CPBL  Rebas (rebas.tw), a Taiwanese stats database. cpbl.com.tw blocks visitors from outside Taiwan. Names stay in
        Chinese, since there's no reading to romanise.

Every stat is returned under MLB StatsAPI's names (avg, homeRuns, era...) so the page can show and rank it the same way.
Teams are matched by the Flashscore team name the page passes in.
"""
import datetime
import http.cookiejar
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
CACHE = Path(__file__).with_name(".floodlight-cache") / "bsb-people.json"
_cache, _lock = {}, threading.Lock()
_people = {}          # "lg:id" -> {"en": Latin name, "photo": url}, kept on disk


def _load_people():
    global _people
    try:
        _people = json.loads(CACHE.read_text())
    except Exception:
        _people = {}


def _save_people():
    try:
        CACHE.parent.mkdir(exist_ok=True)
        tmp = CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_people, ensure_ascii=False))
        tmp.replace(CACHE)
    except Exception:
        pass


_load_people()


def _memo(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
        if len(_cache) > 800:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:200]:
                _cache.pop(k, None)
    return val


def _open(url, data=None, opener=None, headers=None):
    h = {"User-Agent": UA, "Accept": "text/html,application/json,*/*", "Accept-Language": "en-GB,en;q=0.9", "Referer": url}
    h.update(headers or {})
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers=h)
    with (opener or urllib.request.build_opener()).open(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def _get(url, ttl=3600, as_json=False):
    return _memo(url, ttl, lambda: (json.loads if as_json else str)(_open(url)))


def _txt(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).replace("&nbsp;", " ").replace("&amp;", "&").strip()


def tables(page):
    """Every table as a list of rows; each row is a list of (text, raw html) cells."""
    out = []
    for tb in re.findall(r"<table[^>]*>(.*?)</table>", page, re.S):
        rows = []
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            cells = [(_txt(c), c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
            if cells:
                rows.append(cells)
        out.append(rows)
    return out


def _f(x):
    try:
        return float(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _i(x):
    v = _f(x)
    return int(v) if v is not None else None


def rate(x, d=3):
    """.308 style for averages, 2.33 style for ERA and WHIP."""
    v = _f(x)
    if v is None:
        return None
    s = f"{v:.{d}f}"
    return s[1:] if d == 3 and s.startswith("0.") else s


def ip_from(x):
    """'46 1/3' or '46.1' or 139 outs -> '46.1' (StatsAPI style)."""
    s = str(x or "").strip()
    m = re.fullmatch(r"(\d+)\s+(\d)/3", s)
    if m:
        return f"{m.group(1)}.{m.group(2)}"
    m = re.fullmatch(r"(\d)/3", s)
    if m:
        return f"0.{m.group(1)}"
    return s if re.fullmatch(r"\d+(\.\d)?", s) else None


def ip_outs(s):
    v = ip_from(s)
    if not v:
        return 0
    w, _, f = v.partition(".")
    return int(w) * 3 + int(f or 0)


def _derive(s, group):
    """Fill the rates a source leaves out, from the counts."""
    g = lambda k: s.get(k) or 0
    if group == "hitting":
        ab, pa = g("atBats"), g("plateAppearances")
        if ab and "avg" not in s:
            s["avg"] = rate(g("hits") / ab)
        if "totalBases" not in s and ab:
            s["totalBases"] = g("hits") + g("doubles") + 2 * g("triples") + 3 * g("homeRuns")
        if ab and "slg" not in s:
            s["slg"] = rate(g("totalBases") / ab)
        den = ab + g("baseOnBalls") + g("hitByPitch") + g("sacFlies")
        if den and "obp" not in s:
            s["obp"] = rate((g("hits") + g("baseOnBalls") + g("hitByPitch")) / den)
        if "ops" not in s and s.get("obp") and s.get("slg"):
            s["ops"] = rate(_f(s["obp"]) + _f(s["slg"]))
        if pa and not s.get("plateAppearances"):
            s["plateAppearances"] = pa
    else:
        outs = ip_outs(s.get("inningsPitched"))
        ip = outs / 3
        if ip:
            s.setdefault("era", rate(9 * g("earnedRuns") / ip, 2))
            s.setdefault("whip", rate((g("hits") + g("baseOnBalls")) / ip, 2))
            s.setdefault("strikeoutsPer9Inn", rate(9 * g("strikeOuts") / ip, 2))
            s.setdefault("walksPer9Inn", rate(9 * g("baseOnBalls") / ip, 2))
            s.setdefault("hitsPer9Inn", rate(9 * g("hits") / ip, 2))
            s.setdefault("homeRunsPer9", rate(9 * g("homeRuns") / ip, 2))
        if g("baseOnBalls"):
            s.setdefault("strikeoutWalkRatio", rate(g("strikeOuts") / g("baseOnBalls"), 2))
        if g("wins") + g("losses"):
            s.setdefault("winPercentage", rate(g("wins") / (g("wins") + g("losses"))))
    return {k: v for k, v in s.items() if v is not None}


def _put(s, key, val, kind="int"):
    if val in (None, "", "-"):
        return
    if kind == "int":
        v = _i(val)
    elif kind == "ip":
        v = ip_from(val)
    elif kind == "era":
        v = rate(val, 2)
    else:
        v = rate(val)
    if v is not None:
        s[key] = v


# column label (any source) -> (StatsAPI key, kind)
HIT = {"G": ("gamesPlayed", "int"), "試 合": ("gamesPlayed", "int"), "PA": ("plateAppearances", "int"), "打 席": ("plateAppearances", "int"),
       "AB": ("atBats", "int"), "打 数": ("atBats", "int"), "R": ("runs", "int"), "得 点": ("runs", "int"), "H": ("hits", "int"), "安 打": ("hits", "int"),
       "2B": ("doubles", "int"), "二塁打": ("doubles", "int"), "3B": ("triples", "int"), "3R": ("triples", "int"), "三塁打": ("triples", "int"),
       "HR": ("homeRuns", "int"), "本塁打": ("homeRuns", "int"), "TB": ("totalBases", "int"), "塁 打": ("totalBases", "int"), "RBI": ("rbi", "int"), "打 点": ("rbi", "int"),
       "SB": ("stolenBases", "int"), "盗 塁": ("stolenBases", "int"), "CS": ("caughtStealing", "int"), "盗塁死": ("caughtStealing", "int"),
       "SAC": ("sacBunts", "int"), "犠 打": ("sacBunts", "int"), "SF": ("sacFlies", "int"), "犠 飛": ("sacFlies", "int"), "BB": ("baseOnBalls", "int"), "四 球": ("baseOnBalls", "int"),
       "IBB": ("intentionalWalks", "int"), "HBP": ("hitByPitch", "int"), "死 球": ("hitByPitch", "int"), "SO": ("strikeOuts", "int"), "三 振": ("strikeOuts", "int"),
       "GDP": ("groundIntoDoublePlay", "int"), "GIDP": ("groundIntoDoublePlay", "int"), "併殺打": ("groundIntoDoublePlay", "int"),
       "AVG": ("avg", "rate"), "打 率": ("avg", "rate"), "SLG": ("slg", "rate"), "長打率": ("slg", "rate"), "OBP": ("obp", "rate"), "出塁率": ("obp", "rate"),
       "OPS": ("ops", "rate"), "ＯＰＳ": ("ops", "rate"), "RISP": ("risp", "rate"), "得点圏": ("risp", "rate"), "E": ("errors", "int"), "失 策": ("errors", "int")}
PIT = {"G": ("gamesPlayed", "int"), "登 板": ("gamesPlayed", "int"), "先 発": ("gamesStarted", "int"), "GS": ("gamesStarted", "int"), "CG": ("completeGames", "int"), "完 投": ("completeGames", "int"),
       "SHO": ("shutouts", "int"), "完 封": ("shutouts", "int"), "QS": ("qualityStarts", "int"), "Ｑ Ｓ": ("qualityStarts", "int"), "W": ("wins", "int"), "勝 利": ("wins", "int"),
       "L": ("losses", "int"), "敗 戦": ("losses", "int"), "SV": ("saves", "int"), "セーブ": ("saves", "int"), "HLD": ("holds", "int"), "ホールド": ("holds", "int"),
       "BSV": ("blownSaves", "int"), "BS": ("blownSaves", "int"), "WPCT": ("winPercentage", "rate"), "勝 率": ("winPercentage", "rate"),
       "TBF": ("battersFaced", "int"), "PA": ("battersFaced", "int"), "NP": ("numberOfPitches", "int"), "IP": ("inningsPitched", "ip"), "投球回": ("inningsPitched", "ip"),
       "H": ("hits", "int"), "被安打": ("hits", "int"), "2B": ("doubles", "int"), "3B": ("triples", "int"), "HR": ("homeRuns", "int"), "被本塁打": ("homeRuns", "int"),
       "SAC": ("sacBunts", "int"), "SF": ("sacFlies", "int"), "BB": ("baseOnBalls", "int"), "与四球": ("baseOnBalls", "int"), "IBB": ("intentionalWalks", "int"),
       "HBP": ("hitByPitch", "int"), "与死球": ("hitByPitch", "int"), "SO": ("strikeOuts", "int"), "K": ("strikeOuts", "int"), "奪三振": ("strikeOuts", "int"),
       "WP": ("wildPitches", "int"), "暴 投": ("wildPitches", "int"), "BK": ("balks", "int"), "ボーク": ("balks", "int"), "R": ("runs", "int"), "失 点": ("runs", "int"),
       "ER": ("earnedRuns", "int"), "自責点": ("earnedRuns", "int"), "ERA": ("era", "era"), "防御率": ("era", "era"), "WHIP": ("whip", "era"), "ＷＨＩＰ": ("whip", "era"),
       "AVG": ("avg", "rate"), "OAVG": ("avg", "rate"), "被打率": ("avg", "rate"), "奪三振率": ("strikeoutsPer9Inn", "era"), "Ｋ／ＢＢ": ("strikeoutWalkRatio", "era")}


HIT = {k.replace(" ", ""): v for k, v in HIT.items()}
PIT = {k.replace(" ", ""): v for k, v in PIT.items()}


def stat_from(labels, values, group):
    s, m = {}, HIT if group == "hitting" else PIT
    for lab, val in zip(labels, values):
        lab = lab.replace(" ", "").replace("\u3000", "")
        if lab in m:
            key, kind = m[lab]
            _put(s, key, val, kind)
    return s


# ---------- romanisation ----------
KANA = {}
for row, cons in [("アイウエオ", ""), ("カキクケコ", "k"), ("サシスセソ", "s"), ("タチツテト", "t"), ("ナニヌネノ", "n"), ("ハヒフヘホ", "h"), ("マミムメモ", "m"),
                  ("ヤ ユ ヨ", "y"), ("ラリルレロ", "r"), ("ワ   ヲ", "w"), ("ガギグゲゴ", "g"), ("ザジズゼゾ", "z"), ("ダヂヅデド", "d"), ("バビブベボ", "b"), ("パピプペポ", "p")]:
    for ch, v in zip(row, "aiueo"):
        if ch != " ":
            KANA[ch] = cons + v
KANA.update({"シ": "shi", "チ": "chi", "ツ": "tsu", "フ": "fu", "ジ": "ji", "ヂ": "ji", "ヅ": "zu", "ヲ": "o", "ン": "n", "ヴ": "vu"})
SMALL = {"ャ": "ya", "ュ": "yu", "ョ": "yo", "ァ": "a", "ィ": "i", "ゥ": "u", "ェ": "e", "ォ": "o"}


def kana_to_latin(s):
    s = "".join(chr(ord(c) + 96) if "ぁ" <= c <= "ゖ" else c for c in s)   # hiragana -> katakana
    out, i = "", 0
    while i < len(s):
        c = s[i]
        nxt = s[i + 1] if i + 1 < len(s) else ""
        if c == "ッ":
            r = KANA.get(nxt, "")
            out += ("t" if r.startswith("ch") else r[:1]) if r else ""
        elif c == "ー":
            pass
        elif nxt in SMALL and c in KANA:
            base, sm = KANA[c], SMALL[nxt]
            if sm.startswith("y"):
                out += base[:-1] + sm[1:] if base in ("shi", "chi", "ji") else base[:-1] + sm
            else:
                out += base[:-1] + sm
            i += 1
        else:
            out += KANA.get(c, c)
        i += 1
    out = re.sub(r"ou(?=[^aeiou]|$)", "o", out)   # long vowels: Satou -> Sato, Yuuki -> Yuki
    out = re.sub(r"uu", "u", out)
    out = re.sub(r"oo", "o", out)
    return out


def japanese_name(reading):
    """'サトウ テルアキ' (family given) -> 'Teruaki Sato'."""
    parts = [kana_to_latin(p).capitalize() for p in re.split(r"[\s　・]+", reading.strip()) if p]
    return " ".join(parts[1:] + parts[:1]) if len(parts) > 1 else (parts[0] if parts else "")


HANGUL_L = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"]
HANGUL_V = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
HANGUL_T = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]
SURNAME = {"김": "Kim", "이": "Lee", "박": "Park", "최": "Choi", "정": "Jung", "강": "Kang", "조": "Cho", "윤": "Yoon", "장": "Jang", "임": "Lim", "한": "Han", "오": "Oh",
           "서": "Seo", "신": "Shin", "권": "Kwon", "황": "Hwang", "안": "Ahn", "송": "Song", "류": "Ryu", "유": "Yoo", "홍": "Hong", "전": "Jeon", "고": "Ko", "문": "Moon",
           "양": "Yang", "손": "Son", "배": "Bae", "백": "Baek", "허": "Heo", "노": "Noh", "남": "Nam", "심": "Shim", "하": "Ha", "곽": "Kwak", "성": "Sung", "차": "Cha",
           "주": "Joo", "우": "Woo", "구": "Koo", "민": "Min", "나": "Na", "진": "Jin", "지": "Ji", "엄": "Um", "채": "Chae", "원": "Won", "천": "Cheon", "방": "Bang",
           "공": "Kong", "현": "Hyun", "함": "Ham", "변": "Byun", "염": "Yeom", "여": "Yeo", "추": "Choo", "도": "Do", "소": "So", "석": "Seok", "선": "Sun", "설": "Seol",
           "마": "Ma", "길": "Gil", "연": "Yeon", "위": "Wi", "표": "Pyo", "명": "Myung", "기": "Ki", "반": "Ban", "왕": "Wang", "금": "Geum", "옥": "Ok", "육": "Yuk",
           "인": "In", "맹": "Maeng", "제": "Je", "모": "Mo", "탁": "Tak", "국": "Kook", "어": "Eo", "은": "Eun", "편": "Pyeon", "용": "Yong", "예": "Ye", "경": "Kyung", "봉": "Bong"}


def hangul_syl(c, first):
    n = ord(c) - 0xAC00
    if not 0 <= n < 11172:
        return c
    l, v, t = n // 588, (n % 588) // 28, n % 28
    lead = HANGUL_L[l]
    if first:
        lead = {"g": "g", "d": "d", "b": "b", "r": "r", "j": "j"}.get(lead, lead)
    return lead + HANGUL_V[v] + HANGUL_T[t]


def korean_name(s):
    """'김도영' -> 'Kim Do-yeong'. Foreign players' Hangul names come out phonetic, so English names from the KBO's
    English site replace them when known."""
    s = (s or "").strip()
    if not s or not re.search(r"[가-힣]", s):
        return s
    if len(s) <= 4 and s[0] in SURNAME:
        given = "-".join(hangul_syl(c, True) for c in s[1:])
        return f"{SURNAME[s[0]]} {given.capitalize()}" if given else SURNAME[s[0]]
    return "".join(hangul_syl(c, i == 0) for i, c in enumerate(s)).capitalize()


# ---------- background enrichment: English names and photos ----------
_queue, _qset, _qlock = [], set(), threading.Lock()


def _want(lg, pid, fn):
    k = f"{lg}:{pid}"
    with _qlock:
        if k in _people or k in _qset:
            return
        _qset.add(k)
        _queue.append((k, fn))


def _worker():
    dirty = 0
    while True:
        with _qlock:
            job = _queue.pop(0) if _queue else None
        if not job:
            if dirty:
                _save_people()
                dirty = 0
            time.sleep(2)
            continue
        k, fn = job
        try:
            info = fn()
            if info:
                _people[k] = info
                dirty += 1
                if dirty >= 25:
                    _save_people()
                    dirty = 0
        except Exception:
            pass
        with _qlock:
            _qset.discard(k)
        time.sleep(.1)


for _n in range(4):   # four lookups at a time; the first full pass takes a few minutes, then it is kept on disk
    threading.Thread(target=_worker, daemon=True).start()


def person(lg, pid):
    return _people.get(f"{lg}:{pid}") or {}


# ---------- KBO ----------
KBO_TEAMS = {"KT": ["kt wiz", "kt "], "SS": ["samsung"], "HT": ["kia"], "LG": ["lg twins", "lg "], "OB": ["doosan"], "SK": ["ssg", "sk wyverns"], "LT": ["lotte"],
             "NC": ["nc dinos", "nc "], "HH": ["hanwha"], "WO": ["kiwoom", "heroes"]}
KBO_TEAM_EN = {"삼성": "Samsung", "롯데": "Lotte", "한화": "Hanwha", "키움": "Kiwoom", "두산": "Doosan", "KIA": "KIA", "KT": "KT", "LG": "LG", "NC": "NC", "SSG": "SSG"}
KBO_REC = "https://www.koreabaseball.com/Record/Player/"
KBO_ENG = "https://eng.koreabaseball.com/Teams/"
KBO_PHOTO = "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/{y}/{id}.jpg"
PRE = "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$"


def _form(p):
    d = dict(re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', p))
    for name, body in re.findall(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', p, re.S):
        m = re.search(r'<option selected="selected" value="([^"]*)"', body)
        d[name] = m.group(1) if m else ""
    return d


def _kbo_rows(page):
    rows = []
    for tb in tables(page):
        if not tb or "선수명" not in [c[0] for c in tb[0]]:
            continue
        head = [c[0] for c in tb[0]]
        for r in tb[1:]:
            pid = re.search(r"playerId=(\d+)", "".join(c[1] for c in r))
            if pid:
                rows.append((pid.group(1), dict(zip(head, [c[0] for c in r]))))
    return rows


def kbo_table(kind, team="", season=None):
    """One KBO record table (e.g. 'HitterBasic/Basic1'), regular season, every page, optionally for one team."""
    season = season or datetime.date.today().year

    def run():
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        url = KBO_REC + kind + ".aspx"
        p = _open(url, opener=op)
        d = _form(p)
        d[PRE + "ddlSeason$ddlSeason"], d[PRE + "ddlSeries$ddlSeries"], d["__EVENTTARGET"] = str(season), "0", PRE + "ddlSeries$ddlSeries"
        p = _open(url, d, op)
        if team:
            d = _form(p)
            d[PRE + "ddlTeam$ddlTeam"], d["__EVENTTARGET"] = team, PRE + "ddlTeam$ddlTeam"
            p = _open(url, d, op)
        rows = _kbo_rows(p)
        for n in range(2, 8):
            if f"ucPager$btnNo{n}" not in p:
                break
            d = _form(p)
            d["__EVENTTARGET"] = PRE + f"ucPager$btnNo{n}"
            page = _open(url, d, op)
            rows += _kbo_rows(page)
        return rows
    return _memo(f"kbo|{kind}|{team}|{season}", 6 * 3600, run)


def _kbo_merge(group, team="", season=None):
    kinds = ["HitterBasic/Basic1", "HitterBasic/Basic2"] if group == "hitting" else ["PitcherBasic/Basic1", "PitcherBasic/Basic2"]
    out = {}
    with ThreadPoolExecutor(2) as ex:
        res = list(ex.map(lambda k: kbo_table(k, team, season), kinds))
    for rows in res:
        for pid, r in rows:
            p = out.setdefault(pid, {"id": pid, "local": r.get("선수명", ""), "teamName": KBO_TEAM_EN.get(r.get("팀명", ""), r.get("팀명", "")), "s": {}})
            labels = [k for k in r if k not in ("순위", "선수명", "팀명")]
            p["s"].update(stat_from(labels, [r[k] for k in labels], group))
    for p in out.values():
        p["s"] = _derive(p["s"], group)
        info = person("kbo", p["id"])
        p["name"] = info.get("en") or korean_name(p["local"])
        p["photo"] = KBO_PHOTO.format(y=season or datetime.date.today().year, id=p["id"])
        _want("kbo", p["id"], lambda pid=p["id"], g=group: _kbo_eng_name(pid, g))
    return list(out.values())


def _kbo_eng(pid, group):
    kind = "PlayerInfoPitcher" if group == "pitching" else "PlayerInfoHitter"
    return _get(f"{KBO_ENG}{kind}/Summary.aspx?pcode={pid}", 6 * 3600)


def _kbo_eng_name(pid, group):
    m = re.search(r"Name\s*</strong>\s*:\s*([^<]+)|Name\s*:\s*([^<\n]+)", _txt_keep(_kbo_eng(pid, group)))
    nm = (m.group(1) or m.group(2)).strip() if m else ""
    return {"en": _title_name(nm)} if nm else None


def _txt_keep(page):
    return re.sub(r"<(?!/?strong)[^>]+>", " ", page)


def _title_name(nm):
    """'KIM Do Yeong' -> 'Kim Do-yeong'; 'REYES Victor' -> 'Victor Reyes'."""
    parts = nm.split()
    if not parts:
        return nm
    fam = parts[0].capitalize() if parts[0].isupper() else parts[0]
    rest = parts[1:]
    if len(rest) == 2 and all(len(x) <= 6 for x in rest) and re.fullmatch(r"[A-Za-z]+", "".join(rest)) and fam in SURNAME.values():
        return f"{fam} {rest[0].capitalize()}-{rest[1].lower()}"
    if fam in SURNAME.values():
        return " ".join([fam] + [x.capitalize() for x in rest])
    return " ".join([x.capitalize() if x.isupper() else x for x in rest] + [fam])


def kbo_player(pid, group):
    page = _kbo_eng(pid, group)
    if "Name" not in page or ("2026" not in page and "Season Stats" not in page and group == "hitting"):
        pass
    t = _txt(page)
    def bio(lab):
        m = re.search(lab + r"\s*:\s*(.+?)\s+(?:Position|No|Salary|Born|Debut|HT/WT|Transaction|Summary)\s*:", t + " Summary :")
        return m.group(1).strip() if m else ""
    name = _title_name(bio("Name"))
    tbs = tables(page)
    season, career, recent = {}, [], []
    for tb in tbs:
        if not tb:
            continue
        head = [c[0] for c in tb[0]]
        if head[:1] == ["TEAM"] and len(tb) > 1:
            season.update(stat_from(head[1:], [c[0] for c in tb[1][1:]], group))
            season["_team"] = tb[1][0][0]
        elif head[:1] == ["YEAR"]:
            for r in tb[1:]:
                vals = [c[0] for c in r]
                if not re.fullmatch(r"\d{4}", vals[0]):
                    continue
                s = stat_from(head[2:], vals[2:], group)
                if group == "pitching" and "IP" in head:   # the career table gives innings as outs
                    o = _i(vals[head.index("IP")])
                    if o is not None:
                        s["inningsPitched"] = f"{o // 3}.{o % 3}"
                career.append({"season": vals[0], "team": vals[1], "stat": _derive(s, group)})
        elif head[:1] == ["DATE"]:
            for r in tb[1:]:
                vals = [c[0] for c in r]
                recent.append({"date": vals[0], "opp": vals[1], "stat": stat_from(head[2:], vals[2:], group)})
    for tb in tbs:   # the second half of the season table (BB, SO, OBP... for hitters; SAC, SF, BB... for pitchers)
        if tb and len(tb) > 1 and tb[0][0][0] in ("BB", "SAC"):
            season.update(stat_from([c[0] for c in tb[0]], [c[0] for c in tb[1]], group))
    team = season.pop("_team", "")
    yr = datetime.date.today().year
    info = {"id": pid, "name": name or person("kbo", pid).get("en") or pid, "team": team, "position": bio("Position"), "number": bio("No"), "born": bio("Born"),
            "htwt": bio("HT/WT"), "debut": bio("Debut"), "salary": bio("Salary"), "photo": KBO_PHOTO.format(y=yr, id=pid)}
    if name:
        _people[f"kbo:{pid}"] = {**person("kbo", pid), "en": name}
    log = kbo_log(pid, group)
    return {"bio": info, "group": group, "season": _derive(season, group) if season else None, "career": career, "log": log or recent}


def kbo_log(pid, group):
    kind = "PlayerInfoPitcher" if group == "pitching" else "PlayerInfoHitter"
    try:
        page = _get(f"{KBO_ENG}{kind}/GameLogs.aspx?pcode={pid}", 3 * 3600)
    except Exception:
        return []
    out, yr = [], datetime.date.today().year
    for tb in tables(page):
        if not tb or len(tb[0]) < 3 or tb[0][1][0] != "OPP":
            continue
        head = [c[0] for c in tb[0]]
        for r in tb[1:]:
            vals = [c[0] for c in r]
            m = re.fullmatch(r"(\d{2})\.(\d{2})", vals[0])
            if not m:
                continue
            s = stat_from(head[2:], vals[2:], group)
            if group == "pitching" and "RES" in head:
                res = vals[head.index("RES")]
                s["decision"] = res
            out.append({"date": f"{yr}-{m.group(1)}-{m.group(2)}", "opp": vals[1], "stat": s})
    return out


# ---------- NPB (Yahoo! Japan) ----------
YH = "https://baseball.yahoo.co.jp/npb/"
NPB_TEAMS = {1: ["giants", "yomiuri"], 2: ["swallows", "yakult"], 3: ["baystars", "yokohama"], 4: ["chunichi", "dragons"], 5: ["hanshin", "tigers"], 6: ["carp", "hiroshima"],
             7: ["seibu", "lions"], 8: ["fighters", "nippon ham", "nippon-ham", "hokkaido"], 9: ["marines", "lotte"], 11: ["orix", "buffaloes"], 12: ["hawks", "softbank", "fukuoka"],
             376: ["eagles", "rakuten"]}
NPB_POS = {"投": "P", "捕": "C", "一": "1B", "二": "2B", "三": "3B", "遊": "SS", "外": "OF", "左": "LF", "中": "CF", "右": "RF", "指": "DH", "内": "IF"}


def _npb_team_table(tid, group):
    page = _get(f"{YH}teams/{tid}/{'battingstats' if group == 'hitting' else 'pitchingstats'}", 3 * 3600)
    out = []
    for tb in tables(page):
        if not tb:
            continue
        head = [c[0] for c in tb[0]]
        if "選手名" not in head:
            continue
        for r in tb[1:]:
            pid = re.search(r"/npb/player/(\d+)/", "".join(c[1] for c in r))
            if not pid:
                continue
            vals = [c[0] for c in r]
            row = dict(zip(head, vals))
            labels = [h for h in head if h not in ("位置", "背番号", "選手名")]
            s = stat_from(labels, [row[h] for h in labels], group)
            out.append({"id": pid.group(1), "local": row.get("選手名", ""), "number": row.get("背番号", ""), "pos": NPB_POS.get(row.get("位置", ""), "P" if group == "pitching" else ""),
                        "team": tid, "s": _derive(s, group)})
    return out


def _npb_reading(pid):
    page = _get(f"{YH}player/{pid}/top", 24 * 3600)
    m = re.search(r"（([ァ-ヶー・\s　]+)）", page)
    return {"en": japanese_name(m.group(1))} if m else None


def _npb_name(p):
    info = person("npb", p["id"])
    if re.fullmatch(r"[ァ-ヶー・\s]+", p["local"] or ""):   # foreign players are written in katakana already
        return info.get("en") or " ".join(kana_to_latin(w).capitalize() for w in re.split(r"[・\s]+", p["local"]) if w)
    _want("npb", p["id"], lambda pid=p["id"]: _npb_reading(pid))
    return info.get("en") or p["local"]


def npb_group(group, tid=None):
    tids = [tid] if tid else list(NPB_TEAMS)
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda t: _safe(lambda: _npb_team_table(t, group)) or [], tids))
    out = [p for r in res for p in r]
    for p in out:
        p["name"] = _npb_name(p)
        p["photo"] = f"https://sports-baseball.west.edge.storage-yahoo.jp/npb/images/player/portrait/{p['team']}/{p['id']}.jpg"
    return out


JP_TEAM = {"巨人": "Giants", "ヤクルト": "Swallows", "DeNA": "BayStars", "中日": "Dragons", "阪神": "Tigers", "広島": "Carp", "西武": "Lions", "日本ハム": "Fighters",
           "ロッテ": "Marines", "オリックス": "Buffaloes", "ソフトバンク": "Hawks", "楽天": "Eagles"}
JP_FIELD = {"投": "P", "捕": "C", "一": "1B", "二": "2B", "三": "3B", "遊": "SS", "左": "LF", "中": "CF", "右": "RF", "左中": "LCF", "右中": "RCF"}


def _jp_tag(t):
    for a, b in (("日本シリーズ", "Japan Series"), ("CSパ・ファイナルステージ", "PL Climax Series final"), ("CSセ・ファイナルステージ", "CL Climax Series final"),
                 ("CSパ・ファーストステージ", "PL Climax Series 1st stage"), ("CSセ・ファーストステージ", "CL Climax Series 1st stage"), ("パ・リーグ", "Pacific League"),
                 ("セ・リーグ", "Central League"), ("交流戦", "Interleague")):
        t = t.replace(a, b)
    return t


def _jp_ab(x):
    """One plate appearance in Yahoo's shorthand, e.g. 右安 -> single to RF, 空三振 -> K swinging."""
    x = x.strip().translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    fixed = {"空三振": "K swinging", "見三振": "K looking", "三振": "K", "四球": "BB", "死球": "HBP", "敬遠": "IBB", "打撃妨": "interference"}
    if x in fixed:
        return fixed[x]
    m = re.fullmatch(r"(左中|右中|投|捕|一|二|三|遊|左|中|右)(.+)", x)
    if not m:
        return x
    f, r = JP_FIELD[m.group(1)], m.group(2)
    kinds = {"安": "single", "2": "double", "3": "triple", "本": "HR", "ゴ": "groundout", "飛": "flyout", "直": "lineout", "邪飛": "foul out", "併": "double play",
             "ゴロ": "groundout", "失": "error", "犠": "sacrifice", "犠飛": "sac fly", "野選": "fielder's choice", "併打": "double play"}
    return f"{kinds.get(r, r)} to {f}" if r in kinds else x


JP_POS = {"投手": "Pitcher", "捕手": "Catcher", "内野手": "Infielder", "外野手": "Outfielder"}


def _jp_date(s):
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日(?:（(\d+)歳）)?", s or "")
    if not m:
        return s
    d = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return d.strftime("%-d %b %Y") + (f" (age {m.group(4)})" if m.group(4) else "")


def _jp_bt(s):
    hand = {"右": "right", "左": "left", "両": "both"}
    m = re.match(r"(.)投(.)打", s or "")
    return f"Throws {hand.get(m.group(1), m.group(1))}, bats {hand.get(m.group(2), m.group(2))}" if m else s


def _jp_draft(s):
    m = re.match(r"(\d{4})年（(.+?)）", s or "")
    if not m:
        return s
    r = m.group(2)
    n = re.match(r"(\d+)位", r)
    return f"{m.group(1)}, round {n.group(1)}" if n else f"{m.group(1)} ({r.replace('育成', 'development ').replace('位', '')})"


def npb_player(pid):
    page = _get(f"{YH}player/{pid}/top", 3 * 3600)
    t = _txt(page)
    reading = re.search(r"（([ァ-ヶー・\s　]+)）", page)
    local = re.search(r'bb-profile__name[^>]*>\s*<h1[^>]*>([^<]+)', page) or re.search(r"<title>([^（(|<-]+)", page)
    team = re.search(r'/npb/teams/(\d+)/', page[page.find("bb-profile"):] if "bb-profile" in page else page)
    def row(lab):
        m = re.search(lab + r"\s+(.+?)\s{1,3}(?=出身地|生年月日|身長|体重|血液型|投打|ドラフト年|プロ通算年|経歴|主な獲得タイトル|$)", t)
        return m.group(1).strip() if m else ""
    num = re.search(r"bb-profile__number[^>]*>\s*(\d+)", page)
    pos = re.search(r"bb-profile__position[^>]*>\s*([^<]+)", page)
    tbs = tables(page)
    group = "pitching" if pos and "投手" in pos.group(1) else "hitting"
    season, log = {}, []
    for tb in tbs:
        if not tb or not tb[0]:
            continue
        head = [c[0] for c in tb[0]]
        if head[0] in ("打率", "防御率") and len(tb) >= 2:
            g = "pitching" if head[0] == "防御率" else "hitting"
            if g == group:
                season.update(stat_from(head, [c[0] for c in tb[1]], g))
                if len(tb) >= 4:
                    season.update(stat_from([c[0] for c in tb[2]], [c[0] for c in tb[3]], g))
        elif head[0] == "日付" and not log:
            for r in tb[1:]:
                vals = [c[0] for c in r]
                d = re.match(r"(\d+)/(\d+)", vals[0])
                if not d:
                    continue
                s = stat_from(head[2:], vals[2:], group)
                if group == "hitting" and "打席結果" in head:
                    s["summary"] = ", ".join(_jp_ab(x) for x in re.split(r"[、,]", vals[head.index("打席結果")]) if x.strip())
                log.append({"date": f"{datetime.date.today().year}-{int(d.group(1)):02d}-{int(d.group(2)):02d}", "opp": JP_TEAM.get(vals[1], vals[1]),
                            "tag": _jp_tag(re.sub(r"^\d+/\d+\s*", "", vals[0])), "stat": s})
    en = japanese_name(reading.group(1)) if reading else ""
    ph = re.search(r"/player/portrait/(\d+)/" + pid + r"\.jpg", page)
    tid = ph.group(1) if ph else (team.group(1) if team else "")
    if tid.isdigit():
        trow = next((x for x in _safe(lambda: _npb_team_table(int(tid), group)) or [] if x["id"] == pid), None)
        if trow:
            season = trow["s"]
    if en:
        _people[f"npb:{pid}"] = {**person("npb", pid), "en": en}
    photo = re.search(r'(https://sports-baseball[^"]+/player/portrait/\d+/' + pid + r'\.jpg)', page)
    return {"bio": {"id": pid, "name": en or (local.group(1).strip() if local else pid), "local": local.group(1).strip() if local else "", "number": num.group(1) if num else "",
                    "position": JP_POS.get(pos.group(1).strip(), pos.group(1).strip()) if pos else "", "born": _jp_date(row("生年月日（満年齢）") or row("生年月日")), "birthplace": row("出身地"),
                    "height": row("身長").replace("cm", " cm"), "weight": row("体重").replace("kg", " kg"), "bt": _jp_bt(row("投打")), "draft": _jp_draft(row("ドラフト年（順位）")),
                    "years": row("プロ通算年").replace("年", " seasons"), "photo": photo.group(1) if photo else ""},
            "group": group, "season": _derive(season, group) if season else None, "career": [], "log": log, "team": tid}


# ---------- CPBL (Rebas) ----------
RB = "https://www.rebas.tw/api/"
CPBL_TEAMS = {"中信兄弟": ["brothers", "chinatrust"], "味全龍": ["wei chuan", "dragons"], "統一7-ELEVEn獅": ["uni", "lions", "president"], "樂天桃猿": ["rakuten", "monkeys"],
              "富邦悍將": ["fubon", "guardians"], "台鋼雄鷹": ["tsg", "hawks", "taiwan steel"]}
CPBL_EN = {"中信兄弟": "CTBC Brothers", "味全龍": "Wei Chuan Dragons", "統一7-ELEVEn獅": "Uni-President Lions", "樂天桃猿": "Rakuten Monkeys", "富邦悍將": "Fubon Guardians", "台鋼雄鷹": "TSG Hawks"}
RB_HIT = {"games": ("gamesPlayed", "int"), "PA": ("plateAppearances", "int"), "AB": ("atBats", "int"), "R": ("runs", "int"), "H": ("hits", "int"), "Double": ("doubles", "int"),
          "Triple": ("triples", "int"), "HR": ("homeRuns", "int"), "RBI": ("rbi", "int"), "SB": ("stolenBases", "int"), "CS": ("caughtStealing", "int"), "BB": ("baseOnBalls", "int"),
          "IBB": ("intentionalWalks", "int"), "HBP": ("hitByPitch", "int"), "SO": ("strikeOuts", "int"), "SH": ("sacBunts", "int"), "SF": ("sacFlies", "int"),
          "GIDP": ("groundIntoDoublePlay", "int"), "AVG": ("avg", "rate"), "OBP": ("obp", "rate"), "SLG": ("slg", "rate"), "OPS": ("ops", "rate"), "BABIP": ("babip", "rate"),
          "OPSplus": ("opsPlus", "int"), "wOBA": ("woba", "rate"), "ISO": ("iso", "rate"), "WPA": ("wpa", "era")}
RB_PIT = {"games": ("gamesPlayed", "int"), "SP": ("gamesStarted", "int"), "R_W": ("wins", "int"), "R_L": ("losses", "int"), "R_SV": ("saves", "int"), "R_H": ("holds", "int"),
          "R_BS": ("blownSaves", "int"), "BF": ("battersFaced", "int"), "NP": ("numberOfPitches", "int"), "H": ("hits", "int"), "Double": ("doubles", "int"), "Triple": ("triples", "int"),
          "HR": ("homeRuns", "int"), "BB": ("baseOnBalls", "int"), "IBB": ("intentionalWalks", "int"), "HBP": ("hitByPitch", "int"), "SO": ("strikeOuts", "int"), "R": ("runs", "int"),
          "ER": ("earnedRuns", "int"), "ERA": ("era", "era"), "WHIP": ("whip", "era"), "GIDP": ("groundIntoDoublePlay", "int"), "SB": ("stolenBases", "int"), "WP": ("wildPitches", "int"),
          "BK": ("balks", "int"), "FIP": ("fip", "era"), "Kp": ("kPct", "era"), "BBp": ("bbPct", "era")}


def _rb_stat(d, group):
    s = {}
    for k, (key, kind) in (RB_HIT if group == "hitting" else RB_PIT).items():
        if k in d:
            _put(s, key, d[k], kind)
    if group == "pitching" and d.get("IPOut") is not None:
        o = int(d["IPOut"])
        s["inningsPitched"] = f"{o // 3}.{o % 3}"
    return _derive(s, group)


def cpbl_season(year=None):
    def run():
        seasons = _get(RB + "leagues/CPBL", 6 * 3600, True)["data"]["seasons"]
        regular = [s for s in seasons if s.get("type") == "LEAGUE_MATCHES"]
        regular.sort(key=lambda s: -int(s.get("year") or 0))
        if year:
            regular = [s for s in regular if int(s.get("year") or 0) == int(year)] or regular
        return regular[0]["uniqid"] if regular else None
    return _memo(f"cpbl-season|{year}", 6 * 3600, run)


def cpbl_teams(sid):
    d = _get(f"{RB}seasons/{sid}/teams", 6 * 3600, True)["data"]
    return [{"stid": t["uniqid"], "id": t["origin"]["uniqid"], "local": t["origin"]["name"], "name": CPBL_EN.get(t["origin"]["name"], t["origin"]["name"]), "logo": t["origin"].get("icon_url", "")} for t in d]


def cpbl_group(group, team_local=None, year=None):
    sid = cpbl_season(year)
    if not sid:
        return []
    teams = [t for t in cpbl_teams(sid) if not team_local or t["local"] == team_local]
    out = []
    for t in teams:
        d = _get(f"{RB}formal/seasons/{sid}/teams/{t['stid']}/players", 3 * 3600, True)
        d = d.get("data", d)
        for x in d.get("batters" if group == "hitting" else "pitchers", []):
            p = x.get("player") or {}
            pid = p.get("uniqid")
            if not pid:
                continue
            info = person("cpbl", pid)
            _want("cpbl", pid, lambda pid=pid: _cpbl_photo(pid))
            out.append({"id": pid, "name": p.get("name", ""), "local": p.get("name", ""), "number": p.get("number", ""), "team": t["name"], "pos": "P" if group == "pitching" else "",
                        "photo": info.get("photo", ""), "s": _rb_stat(x, group)})
    return out


def _cpbl_bio(pid):
    d = _get(f"{RB}formal/search/players?uniqid={pid}", 24 * 3600, True)
    return d[0] if isinstance(d, list) and d else {}


def _cpbl_photo(pid):
    b = _cpbl_bio(pid)
    return {"photo": "https://usermedia.rebas.tw" + b["avatar_path"] + "_m" if b.get("avatar_path") else ""}


def cpbl_player(pid, group):
    b = _cpbl_bio(pid)
    stats = _get(f"{RB}formal/players/{pid}/season_stats", 3 * 3600, True).get("data", [])
    regular = [x for x in stats if x.get("league_uniqid") == "CPBL" and x.get("season_type") == "LEAGUE_MATCHES"]
    pit = any(x.get("pitching") for x in regular) and not any((x.get("batting") or {}).get("standard", {}).get("PA") for x in regular[:1])
    group = group or ("pitching" if pit or b.get("first_position") == "P" else "hitting")
    key = "batting" if group == "hitting" else "pitching"
    career = []
    for x in regular:
        blk = x.get(key) or {}
        merged = {**(blk.get("advanced") or {}), **(blk.get("standard") or {})}
        if merged:
            career.append({"season": str(x.get("season_year")), "team": CPBL_EN.get(x.get("team"), x.get("team")), "teamLocal": x.get("team"), "stat": _rb_stat(merged, group), "sid": x.get("season_uniqid")})
    career.sort(key=lambda c: c["season"], reverse=True)
    season = career[0]["stat"] if career and career[0]["season"] == str(datetime.date.today().year) else None
    log = []
    if career:
        try:
            teams = {t["id"]: t["name"] for t in cpbl_teams(career[0]["sid"])}
            for g in _get(f"{RB}formal/players/{pid}/seasons/{career[0]['sid']}/logs", 3 * 3600, True).get("data", []):
                blk = g.get(key) or {}
                if blk:
                    log.append({"date": g.get("date", ""), "opp": teams.get(g.get("opponent_uniqid"), g.get("opponent_abbr", "")), "stat": _rb_stat(blk, group)})
        except Exception:
            log = []
    exp = (b.get("experiences") or [{}])[0]
    photo = "https://usermedia.rebas.tw" + b["avatar_path"] + "_m" if b.get("avatar_path") else ""
    return {"bio": {"id": pid, "name": b.get("name", pid), "local": b.get("name", ""), "number": exp.get("number", ""), "team": CPBL_EN.get(exp.get("team", ""), exp.get("team", "")),
                    "position": b.get("first_position", ""), "born": (b.get("birthday") or "")[:10], "height": (b.get("height") or "") + (" cm" if b.get("height") else ""),
                    "weight": (b.get("weight") or "") + (" kg" if b.get("weight") else ""), "bt": f"{b.get('b_hand') or '?'}/{b.get('p_hand') or '?'}", "photo": photo},
            "group": group, "season": season, "career": career, "log": [x for x in log if x["date"]]}


# ---------- dispatch ----------
def _safe(f):
    try:
        return f()
    except Exception:
        return None


def team_key(lg, name):
    n = " " + (name or "").lower() + " "
    table = {"kbo": KBO_TEAMS, "npb": NPB_TEAMS, "cpbl": CPBL_TEAMS}.get(lg, {})
    for k, words in table.items():
        if any(w in n for w in words):
            return k
    return None


def roster(lg, name):
    k = team_key(lg, name)
    if k is None:
        return {"error": "unknown team"}
    if lg == "kbo":
        hit, pit = _kbo_merge("hitting", k), _kbo_merge("pitching", k)
    elif lg == "npb":
        hit, pit = npb_group("hitting", k), npb_group("pitching", k)
    else:
        hit, pit = cpbl_group("hitting", k), cpbl_group("pitching", k)
    return {"team": k, "hitting": hit, "pitching": pit}


def pool(lg, group):
    if lg == "kbo":   # every team's table, so relievers and part-timers are in the comparison too
        def run():
            with ThreadPoolExecutor(4) as ex:
                return [p for r in ex.map(lambda t: _safe(lambda: _kbo_merge(group, t)) or [], KBO_TEAMS) for p in r]
        return _memo(f"pool|kbo|{group}", 6 * 3600, run)
    if lg == "npb":
        return _memo(f"pool|npb|{group}", 3 * 3600, lambda: npb_group(group))
    return _memo(f"pool|cpbl|{group}", 3 * 3600, lambda: cpbl_group(group))


def player(lg, pid, group):
    if lg == "kbo":
        return kbo_player(pid, group or "hitting")
    if lg == "npb":
        return npb_player(pid)
    return cpbl_player(pid, group)


def _prewarm():
    """Build the league pools in the background once the server starts, so the first player page is quick."""
    time.sleep(5)
    for lg in ("npb", "cpbl", "kbo"):
        for g in ("hitting", "pitching"):
            _safe(lambda: pool(lg, g))


threading.Thread(target=_prewarm, daemon=True).start()


def _fresh(lg, players):
    """Names looked up in the background since a list was cached replace the provisional ones."""
    for p in players:
        en = person(lg, p["id"]).get("en")
        if en:
            p["name"] = en
        ph = person(lg, p["id"]).get("photo")
        if ph and not p.get("photo"):
            p["photo"] = ph
    return players


def handle(path, q):
    lg = q.get("lg", "")
    if lg not in ("kbo", "npb", "cpbl"):
        return 400, {"error": "bad league"}, 0
    group = q.get("group") if q.get("group") in ("hitting", "pitching") else ""
    if path == "roster":
        r = roster(lg, q.get("team", "")[:60])
        for g in ("hitting", "pitching"):
            _fresh(lg, r.get(g, []))
        return 200, r, 600
    if path == "pool":
        return 200, {"players": _fresh(lg, pool(lg, group or "hitting"))}, 600
    if path == "player":
        pid = q.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9]{3,12}", pid):
            return 400, {"error": "bad id"}, 0
        return 200, player(lg, pid, group), 1800
    return 404, {"error": "not found"}, 0
