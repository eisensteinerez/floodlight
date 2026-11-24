"""Floodlight's entitlements service: the one place that decides what a member's plan lets them do.

Every plan check on the server goes through here, and the browser gets the answers in /api/me's plan block (plan.js
reads them as window.flPlan and window.flEntitlements). Nothing else should compare plan names or prices.

Plans come from plans.json (or the file FLOODLIGHT_PLANS_FILE names): prices, trial, grace and refund days, Group seats,
gift codes, the Free limits, the feature names, which features each plan includes, and the Free-vs-Plus comparison rows.
billing.py decides which plan a member is on today (subscription, trial, grace period, group seat, free months) and
hands that to bind(effective=...); this module turns it into yes or no.

Limits only bite once the owner turns "Apply plan limits" on (billing's enforce switch, or FLOODLIGHT_PAYWALL=1). Until
then every member keeps every feature. Group seat management is the exception: it needs a real Group plan either way.

Named checks (the server and plan.js use the same names):
  can_use_unlimited_lab      canUseUnlimitedLab        lab_unlimited
  can_use_advanced_filters   canUseAdvancedFilters     advanced_filters
  can_create_unlimited_boards canCreateUnlimitedBoards boards_unlimited
  can_use_advanced_alerts    canUseAdvancedAlerts      advanced_alerts
  can_view_provider_comparison canViewProviderComparison provider_compare
  can_view_line_history      canViewLineHistory        line_history
  can_view_full_history      canViewFullHistory        pick_history_full
  can_view_full_predictions  canViewFullPredictions    predictions_full
  can_use_full_splits        canUseFullSplits          splits_full
  can_share_cards            canShareCards             share_cards
  can_follow_unlimited       canFollowUnlimited        follows_unlimited
  can_create_group           canCreateGroup            group_manage (the buyer of a live Group plan)
"""
import json
import os
import pathlib
import secrets
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_FILE = ROOT / "plans.json"
REQUIRED_PLANS = ("free", "plus", "plus_annual", "group")   # billing.py's flows are built around these four ids
INTERVALS = (None, "month", "year")
LIMIT_NAMES = ("lab_search", "boards", "followed_players", "predictions")

CHECKS = {
    "can_use_unlimited_lab": "lab_unlimited",
    "can_use_advanced_filters": "advanced_filters",
    "can_create_unlimited_boards": "boards_unlimited",
    "can_use_advanced_alerts": "advanced_alerts",
    "can_view_provider_comparison": "provider_compare",
    "can_view_line_history": "line_history",
    "can_view_full_history": "pick_history_full",
    "can_view_full_predictions": "predictions_full",
    "can_use_full_splits": "splits_full",
    "can_share_cards": "share_cards",
    "can_follow_unlimited": "follows_unlimited",
    "can_create_group": "group_manage",
}
# features that never depend on the enforce switch: they describe what was bought, not a limit
ALWAYS_REAL = {"group_manage"}


class PlanConfigError(ValueError):
    pass


def _camel(name):
    head, *rest = name.split("_")
    return head + "".join(w.title() for w in rest)


def _money(cents):
    return f"${cents / 100:.2f}".replace(".00", "") if cents % 100 == 0 else f"${cents / 100:.2f}"


def _fill(text, ctx):
    if not isinstance(text, str):
        return text
    try:
        return text.format(**ctx)
    except (KeyError, IndexError, ValueError) as e:
        raise PlanConfigError(f"unknown placeholder in {text!r}: {e}")


def parse(raw):
    """Check a plans.json document and return it with every placeholder filled. Raises PlanConfigError."""
    if not isinstance(raw, dict):
        raise PlanConfigError("plans.json must be an object")
    out = {"currency": str(raw.get("currency") or "usd").lower()}
    for k, lo, hi in (("trial_days", 0, 90), ("grace_days", 0, 60), ("refund_days", 0, 90), ("group_seats", 2, 50)):
        v = raw.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise PlanConfigError(f"{k} must be a whole number from {lo} to {hi}")
        out[k] = v
    lim = raw.get("free_limits") or {}
    if set(lim) != set(LIMIT_NAMES) or not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in lim.values()):
        raise PlanConfigError(f"free_limits needs whole numbers for {', '.join(LIMIT_NAMES)}")
    out["free_limits"] = dict(lim)
    feats = raw.get("features") or {}
    if not isinstance(feats, dict) or not feats or not set(CHECKS.values()) <= set(feats):
        raise PlanConfigError("features must name every feature the entitlement checks use: " + ", ".join(sorted(CHECKS.values())))
    ctx = {**lim, "trial_days": out["trial_days"], "grace_days": out["grace_days"], "refund_days": out["refund_days"],
           "seats": out["group_seats"], "others": out["group_seats"] - 1}
    out["features"] = {k: _fill(v, ctx) for k, v in feats.items()}
    plans, seen = [], set()
    for p in raw.get("plans") or []:
        pid = p.get("id")
        if not isinstance(pid, str) or pid in seen:
            raise PlanConfigError(f"plan id {pid!r} is missing or used twice")
        seen.add(pid)
        cents = p.get("price_cents")
        if not isinstance(cents, int) or isinstance(cents, bool) or cents < 0 or (pid == "free") != (cents == 0):
            raise PlanConfigError(f"{pid}: price_cents must be 0 for free and above 0 for a paid plan")
        if p.get("interval") not in INTERVALS or (pid == "free") != (p.get("interval") is None):
            raise PlanConfigError(f"{pid}: interval must be month or year (none for free)")
        ent = p.get("entitlements") or []
        if not isinstance(ent, list) or not set(ent) <= set(feats):
            raise PlanConfigError(f"{pid}: entitlements name features that aren't in features")
        pctx = {**ctx, "price": _money(cents), "per_month": _money(round(cents / 12)) if p.get("interval") == "year" else _money(cents)}
        plans.append({"id": pid, "name": str(p.get("name") or pid), "price_cents": cents, "interval": p.get("interval"),
                      "trial_days": 0 if pid == "free" else int(p.get("trial_days", out["trial_days"])),
                      "blurb": _fill(p.get("blurb") or "", pctx), "summary": _fill(p.get("summary") or "", pctx),
                      "features": [_fill(f, pctx) for f in p.get("features") or []], "entitlements": list(ent),
                      "limits": bool(p.get("limits")), "recommended": bool(p.get("recommended"))})
    missing = [x for x in REQUIRED_PLANS if x not in seen]
    if missing:
        raise PlanConfigError("plans.json is missing the plan(s): " + ", ".join(missing))
    out["plans"] = plans
    gifts = {}
    for g in raw.get("gifts") or []:
        if not isinstance(g.get("months"), int) or not isinstance(g.get("price_cents"), int) or g["months"] < 1 or g["price_cents"] < 1:
            raise PlanConfigError(f"gift {g.get('id')!r} needs months and price_cents")
        gifts[str(g["id"])] = {"months": g["months"], "price_cents": g["price_cents"], "name": str(g.get("name") or g["id"])}
    out["gifts"] = gifts
    out["compare"] = [[_fill(c, ctx) for c in row] for row in raw.get("compare") or [] if isinstance(row, list) and len(row) == 3]
    return out


def load(path=None):
    """Read the plan file. A broken override falls back to the repository's plans.json, loudly."""
    path = pathlib.Path(path or os.environ.get("FLOODLIGHT_PLANS_FILE") or DEFAULT_FILE)
    try:
        return parse(json.loads(path.read_text()))
    except (OSError, ValueError) as e:
        if path != DEFAULT_FILE:
            print(f"entitlements: {path} can't be used ({e}); using {DEFAULT_FILE.name}")
            return parse(json.loads(DEFAULT_FILE.read_text()))
        raise


CONFIG = load()
PLANS = CONFIG["plans"]
PLAN = {p["id"]: p for p in PLANS}
PAID = tuple(p["id"] for p in PLANS if p["price_cents"] > 0)
FEATURES = CONFIG["features"]
FREE_LIMITS = CONFIG["free_limits"]
GIFTS = CONFIG["gifts"]
TRIAL_DAYS, GRACE_DAYS, REFUND_DAYS, GROUP_SEATS = CONFIG["trial_days"], CONFIG["grace_days"], CONFIG["refund_days"], CONFIG["group_seats"]

# set by bind() from billing.setup(): which plan a member is on now, whether limits are on, where usage is kept
_h = {"effective": lambda u: "free", "enforced": lambda: False, "gated": False, "buyer": lambda u: False,
      "state": {"usage": {}}, "save": lambda: None, "lock": threading.Lock()}


def bind(**kw):
    _h.update(kw)
    _h["state"].setdefault("usage", {})


def plan_features(plan_id):
    return set((PLAN.get(plan_id) or PLAN["free"])["entitlements"])


def enforced():
    return bool(_h["enforced"]())


def allows(u, feature):
    """May this member use a feature? While limits are off everyone may (except features that describe a purchase)."""
    if feature not in FEATURES:
        return True
    if feature in ALWAYS_REAL:
        return bool(u) and feature in plan_features(_h["effective"](u)) and bool(_h["buyer"](u))
    if not enforced():
        return True
    if not u:
        return not _h["gated"]
    return feature in plan_features(_h["effective"](u))


def limit(u, name):
    """A plan limit (None = no limit). Only plans marked "limits" (Free) have them, and only while limits are on."""
    if not enforced() or not (PLAN.get(_h["effective"](u)) or PLAN["free"])["limits"]:
        return None
    return FREE_LIMITS.get(name)


def _today(u):
    tz = ((u or {}).get("prefs") or {}).get("tz") or ""
    try:
        from zoneinfo import ZoneInfo
        import datetime
        return datetime.datetime.now(ZoneInfo(tz) if tz else datetime.timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return time.strftime("%Y-%m-%d", time.gmtime())


def usage(u, what):
    rec = _h["state"]["usage"].get(u["username"].lower()) if u else None
    if not rec or rec.get("day") != _today(u):
        return 0
    return len(rec.get(what) or [])


def use(u, what, item=""):
    """Count one use of a limited thing (a Lab search). The same item again on the same day is free.
    Returns (ok, left) where left is None when there is no limit."""
    if not u:
        return True, None
    lim = limit(u, what)
    k, day = u["username"].lower(), _today(u)
    item = str(item or "").strip().lower()[:80] or secrets.token_hex(4)
    st = _h["state"]["usage"]
    with _h["lock"]:
        rec = st.get(k)
        if not rec or rec.get("day") != day:
            rec = st[k] = {"day": day}
        seen = rec.setdefault(what, [])
        if item in seen:
            return True, (None if lim is None else max(0, lim - len(seen)))
        if lim is not None and len(seen) >= lim:
            return False, 0
        seen.append(item)
        if len(st) > 20000:
            for kk in [kk for kk, v in st.items() if v.get("day") != day]:
                st.pop(kk, None)
        _h["save"]()
    return True, (None if lim is None else max(0, lim - len(seen)))


def forget(u):
    with _h["lock"]:
        _h["state"]["usage"].pop(u["username"].lower(), None)
        _h["save"]()


def check_list_growth(u, name, old, new):
    """A saved list (boards, followed players) may not grow past the Free limit. Existing items are never removed."""
    lim = limit(u, name)
    if lim is None or len(new) <= max(lim, len(old)):
        return None
    what = {"boards": "saved board", "followed_players": "followed player"}.get(name, name)
    return f"Free includes {lim} {what}{'' if lim == 1 else 's'}. Upgrade to Plus for unlimited."


def upgrade_message(feature):
    """What a 402 says, so every gate words it the same way."""
    if feature == "lab_unlimited":
        n = FREE_LIMITS["lab_search"]
        return f"You've used today's {n} free Lab search{'' if n == 1 else 'es'}. Plus has no daily limit."
    return f"{FEATURES.get(feature, 'This')} is part of Plus."


def view(u):
    """The entitlement half of /api/me's plan block."""
    feats = {f: allows(u, f) for f in FEATURES}
    return {"features": feats, "can": {_camel(fn): feats[f] for fn, f in CHECKS.items()}, "names": FEATURES,
            "limits": {k: limit(u, k) for k in FREE_LIMITS}, "used": {"lab_search": usage(u, "lab_search") if u else 0},
            "free_summary": PLAN["free"]["summary"], "group_seats": GROUP_SEATS,
            "yearly_saving_pct": round((1 - PLAN["plus_annual"]["price_cents"] / (PLAN["plus"]["price_cents"] * 12)) * 100)}


def public():
    """The plan catalogue for GET /api/plans."""
    keep = ("id", "name", "price_cents", "interval", "trial_days", "features", "blurb", "summary", "recommended", "entitlements")
    return {"plans": [{k: p[k] for k in keep} for p in PLANS], "currency": CONFIG["currency"], "trial_days": TRIAL_DAYS,
            "grace_days": GRACE_DAYS, "refund_days": REFUND_DAYS, "group_seats": GROUP_SEATS, "free_limits": FREE_LIMITS,
            "features": FEATURES, "compare": CONFIG["compare"], "gifts": [{"id": k, **v} for k, v in GIFTS.items()]}


def _make_check(feature):
    def check(u):
        return allows(u, feature)
    check.__doc__ = f"May this member use {FEATURES[feature]}?"
    return check


for _fn, _f in CHECKS.items():
    globals()[_fn] = _make_check(_f)
