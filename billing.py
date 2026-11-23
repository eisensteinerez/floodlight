"""Floodlight plans and payments: Free, Plus (monthly or yearly) and Group, the limits each plan has, and Stripe.

Who has what
  effective(u) is the plan a member is on right now: owners and admins are always on Plus; then a live subscription
  (trial, active, or past due inside the grace period, or cancelled but paid to the end of the period); then a group
  seat on someone else's Group plan; then a free month from a gift code, a referral credit or the owner; else Free.
  allows(u, feature) and use(u, "lab_search") are what the rest of the site asks. Limits only bite once the owner turns
  "Apply plan limits" on (or FLOODLIGHT_PAYWALL=1); until then every member keeps every feature.

Payments
  With STRIPE_SECRET_KEY set, checkout goes through Stripe Checkout (cards, Apple Pay and Google Pay, promotion codes,
  free trials), card changes through a Stripe setup page, and Stripe's webhook (STRIPE_WEBHOOK_SECRET) keeps each
  account in step. A key starting sk_live_ is refused until FLOODLIGHT_BILLING_LIVE=1 is also set, so the site cannot
  take real money by accident. Without a key the site runs a built-in test checkout that charges nothing; on the hosted
  site only owners and admins can use it, so nobody gets Plus by pressing a test button.

The account fields (on each user in users.json, so they survive a deploy with the accounts):
  plan            free | plus | plus_annual | group (what was bought; effective() decides what it is worth today)
  plan_status     trial | active | past_due | canceled | incomplete
  trial_started, trial_ends, paid_since, canceled_at, current_period_end, cancel_at_period_end, grace_until
  price_cents, interval (month | year), provider (stripe | demo), customer_id, subscription_id
  payment_method  {brand, last4, exp, wallet}
  invoices        [{id, number, at, amount_cents, currency, status, url, pdf}] newest first (demo and cached Stripe)
  group_of        the username whose Group plan this member is on; group_members on the buyer
  comp_until      a free Plus period (gift code, referral credit or owner grant)
  ref_credit_months  free months earned from referrals, spent with "Use a free month"
  trialed         True once any trial was started (one free trial per account)
"""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import analytics   # the owner dashboard's journey counts (analytics.py)
except Exception:   # pragma: no cover
    analytics = None

API = "https://api.stripe.com/v1"
DAY = 86400
TRIAL_DAYS = 7
GRACE_DAYS = 7
GROUP_SEATS = 5            # the buyer and four others

PLANS = [
    {"id": "free", "name": "Free", "price_cents": 0, "interval": None, "trial_days": 0,
     "blurb": "Live scores and a taste of the Lab.",
     "features": ["Live scores for every sport", "Player profiles (basic stats)", "5 Lab searches a day", "Last-10 hit rates",
                  "1 saved board", "Follow up to 3 players", "Game start and final-score alerts", "Prediction record summary"]},
    {"id": "plus", "name": "Plus", "price_cents": 499, "interval": "month", "trial_days": TRIAL_DAYS,
     "blurb": "The full Lab, Predictions and alerts.",
     "features": ["Unlimited Lab searches", "Last 5, 10, 20, season, home/away and opponent splits", "Every prediction, with the evidence",
                  "Provider comparison and line movement", "Unlimited saved boards", "Unlimited follows and advanced alerts",
                  "Full Pick History", "Shareable research cards"]},
    {"id": "plus_annual", "name": "Plus, yearly", "price_cents": 2999, "interval": "year", "trial_days": TRIAL_DAYS,
     "blurb": "Plus for a year at about half the monthly price.",
     "features": ["Everything in Plus", "Billed once a year", "Works out to $2.50 a month"]},
    {"id": "group", "name": "Group", "price_cents": 999, "interval": "month", "trial_days": TRIAL_DAYS,
     "blurb": "Plus for five people, plus private competitions.",
     "features": ["Plus for you and up to 4 others", "Private competitions for your group (no real money)", "One bill, managed by you"]},
]
PLAN = {p["id"]: p for p in PLANS}
PAID = ("plus", "plus_annual", "group")
GIFTS = {"gift_1m": {"months": 1, "price_cents": 499, "name": "Floodlight Plus, 1 month (gift)"},
         "gift_12m": {"months": 12, "price_cents": 2999, "name": "Floodlight Plus, 12 months (gift)"}}

# What Free cannot do. Everything not listed is open to everyone.
FEATURES = {
    "lab_unlimited": "Unlimited Lab searches",
    "boards_unlimited": "More than one saved board",
    "advanced_filters": "Advanced Lab filters",
    "splits_full": "Last 5, 20, season, home/away and opponent splits",
    "provider_compare": "Provider comparison",
    "line_history": "Line movement and line history",
    "advanced_alerts": "Line, injury and edge alerts",
    "pick_history_full": "Full Pick History",
    "share_cards": "Shareable research cards",
    "predictions_full": "Every prediction with its evidence",
    "follows_unlimited": "Following more than 3 players",
}
FREE_LIMITS = {"lab_search": 5, "boards": 1, "followed_players": 3, "predictions": 3}

STATUS_MAP = {"trialing": "trial", "active": "active", "past_due": "past_due", "unpaid": "past_due", "canceled": "canceled",
              "incomplete": "incomplete", "incomplete_expired": "canceled", "paused": "canceled"}
# Floodlight's cancellation reasons and the nearest Stripe feedback value
REASONS = {"too_expensive": "too_expensive", "inaccurate_data": "low_quality", "not_used_enough": "unused", "missing_sport": "missing_features",
           "hard_to_understand": "too_complex", "technical": "other", "other": "other"}

D = {}                     # set by setup(): users, save, lock, file, storage, rank, site, mail, durable
_state = {}                # {"enforce": bool, "events": [ids], "log": [...], "gifts": {code: {...}}, "usage": {user: {"day", counts}}, "webhook_at": 0}
_slock = threading.Lock()
_prices = {}               # plan id -> Stripe price id, found once


# ---------- setup and saving ----------

def setup(**kw):
    D.update(kw)
    got = D["storage"].load(D["file"], {})
    _state.clear()
    _state.update(got if isinstance(got, dict) else {})
    for k, v in (("enforce", False), ("events", []), ("log", []), ("gifts", {}), ("usage", {}), ("webhook_at", 0)):
        if not isinstance(_state.get(k), type(v)):
            _state[k] = v


def _save_state():
    D["storage"].save(D["file"], _state)


def state_blob():
    return _state


def absorb_state(got):
    if isinstance(got, dict) and got:
        _state.update(got)
        _save_state()


def _save_users():
    D["save"]()


def log(what, user="", **extra):
    with _slock:
        _state["log"].insert(0, {"at": int(time.time()), "user": user, "what": str(what)[:300], **extra})
        del _state["log"][400:]
        _save_state()


# ---------- mode ----------

def key():
    return (os.environ.get("STRIPE_SECRET_KEY") or "").strip()


def mode():
    """demo: built-in test checkout (no Stripe key); test: Stripe test mode; live: Stripe live mode."""
    k = key()
    if not k:
        return "demo"
    return "live" if "_live_" in k else "test"


def live_allowed():
    return os.environ.get("FLOODLIGHT_BILLING_LIVE") == "1" and D.get("durable", lambda: False)()


def enforced():
    return os.environ.get("FLOODLIGHT_PAYWALL") == "1" or bool(_state.get("enforce"))


def can_checkout(u):
    """(ok, why) for starting a checkout."""
    m = mode()
    if m == "live" and not live_allowed():
        return False, "Paid plans aren't on sale yet. Plus features stay free while Floodlight is in beta."
    if m == "demo" and D.get("hosted") and D["rank"](u) not in ("owner", "admin"):
        return False, "Paid plans aren't on sale yet. Plus features stay free while Floodlight is in beta."
    return True, ""


# ---------- who has what ----------

def _now():
    return time.time()


def _sub_live(u, now=None):
    """Is this member's own subscription giving them its plan right now?"""
    now = now or _now()
    st, plan = u.get("plan_status"), u.get("plan")
    if plan not in PAID:
        return False
    end = float(u.get("current_period_end") or 0)
    if st == "trial":
        return float(u.get("trial_ends") or end or 0) > now
    if st == "active":
        return not end or end > now - DAY        # a day of slack while a renewal is being confirmed
    if st == "past_due":
        return float(u.get("grace_until") or 0) > now
    if st == "canceled":
        return end > now                         # paid to the end of the period
    return False


def effective(u, now=None):
    """The plan id a member is on right now: free, plus, plus_annual or group."""
    if not u:
        return "free"
    now = now or _now()
    if D["rank"](u) in ("owner", "admin"):
        return u.get("plan") if _sub_live(u, now) else "plus"
    if u.get("provider") == "demo":
        _demo_renew(u, now)
    if _sub_live(u, now):
        return u["plan"]
    owner = D["users"].get(str(u.get("group_of") or ""))
    if owner and owner.get("plan") == "group" and _sub_live(owner, now) and u["username"].lower() in (owner.get("group_members") or []):
        return "group"
    if float(u.get("comp_until") or 0) > now:
        return "plus"
    return "free"


def paid(u):
    return effective(u) in PAID


def allows(u, feature):
    """Can this member use a Plus feature? Everyone can while limits are off, and on your own computer without an account."""
    if not enforced() or feature not in FEATURES:
        return True
    if not u:
        return not D.get("gated")
    return paid(u)


def limit(u, name):
    """A Free limit (None = no limit)."""
    if not enforced() or paid(u):
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
    rec = _state["usage"].get(u["username"].lower()) if u else None
    if not rec or rec.get("day") != _today(u):
        return 0
    return len(rec.get(what) or [])


def use(u, what, item=""):
    """Count one use of a limited thing (a Lab search). The same item again on the same day is free.
    Returns (ok, left) where left is None when there is no limit."""
    lim = limit(u, what) if u else None
    if not u:
        return True, None
    k, day = u["username"].lower(), _today(u)
    item = str(item or "").strip().lower()[:80] or secrets.token_hex(4)
    with _slock:
        rec = _state["usage"].get(k)
        if not rec or rec.get("day") != day:
            rec = _state["usage"][k] = {"day": day}
        seen = rec.setdefault(what, [])
        if item in seen:
            return True, (None if lim is None else max(0, lim - len(seen)))
        if lim is not None and len(seen) >= lim:
            return False, 0
        seen.append(item)
        if len(_state["usage"]) > 20000:
            for kk in [kk for kk, v in _state["usage"].items() if v.get("day") != day]:
                _state["usage"].pop(kk, None)
        _save_state()
    return True, (None if lim is None else max(0, lim - len(seen)))


def check_list_growth(u, name, old, new):
    """A saved list (boards, followed players) may not grow past the Free limit. Existing items are never removed."""
    lim = limit(u, name)
    if lim is None or len(new) <= max(lim, len(old)):
        return None
    what = {"boards": "saved board", "followed_players": "followed players"}.get(name, name)
    return f"Free includes {lim} {what}{'s' if lim != 1 and name == 'boards' else ''}. Upgrade to Plus for unlimited."


# ---------- what the browser sees ----------

def view(u):
    """The plan block sent with /api/me."""
    eff = effective(u)
    p = PLAN.get(u.get("plan") or "free") or PLAN["free"]
    now = _now()
    out = {"plan": u.get("plan") or "free", "effective": eff, "name": PLAN[eff]["name"], "paid": eff in PAID, "enforced": enforced(),
           "status": u.get("plan_status") or ("active" if eff != "free" else "free"), "mode": mode(),
           "price_cents": u.get("price_cents") if u.get("price_cents") is not None else p["price_cents"], "interval": u.get("interval") or p["interval"],
           "renews": int(u.get("current_period_end") or 0) or None, "trial_ends": int(u.get("trial_ends") or 0) or None,
           "cancel_at_period_end": bool(u.get("cancel_at_period_end")), "grace_until": int(u.get("grace_until") or 0) or None,
           "payment_method": u.get("payment_method") or None, "provider": u.get("provider") or None,
           "comp_until": int(u.get("comp_until") or 0) if float(u.get("comp_until") or 0) > now else None,
           "ref_credit_months": int(u.get("ref_credit_months") or 0), "trial_available": not u.get("trialed"),
           "group_of": u.get("group_of") or None, "group_members": u.get("group_members") or [] if u.get("plan") == "group" else [],
           "limits": {k: limit(u, k) for k in FREE_LIMITS}, "used": {"lab_search": usage(u, "lab_search")},
           "features": {f: allows(u, f) for f in FEATURES}, "staff": D["rank"](u) in ("owner", "admin")}
    can, why = can_checkout(u)
    out["checkout"] = {"ok": can, "why": why}
    return out


def plans_public():
    """GET /api/plans: the plans, for the pricing page and the landing page."""
    m = mode()
    return {"plans": [{k: p[k] for k in ("id", "name", "price_cents", "interval", "trial_days", "features", "blurb")} for p in PLANS],
            "currency": "usd", "mode": m, "on_sale": m == "test" or (m == "live" and live_allowed()), "trial_days": TRIAL_DAYS,
            "grace_days": GRACE_DAYS, "group_seats": GROUP_SEATS, "free_limits": FREE_LIMITS, "features": FEATURES,
            "enforced": enforced(), "gifts": [{"id": k, **v} for k, v in GIFTS.items()]}


# ---------- Stripe ----------

def _flat(obj, prefix=""):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out += _flat(v, f"{prefix}[{k}]" if prefix else str(k))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            out += _flat(v, f"{prefix}[{i}]")
    elif obj is None:
        pass
    elif isinstance(obj, bool):
        out.append((prefix, "true" if obj else "false"))
    else:
        out.append((prefix, str(obj)))
    return out


class StripeError(Exception):
    pass


def stripe(method, path, params=None, idem=None):
    """One call to Stripe's API. Raises StripeError with Stripe's own message."""
    k = key()
    if not k:
        raise StripeError("Stripe isn't set up.")
    q = urllib.parse.urlencode(_flat(params or {}))
    url = API + path + (("?" + q) if q and method == "GET" else "")
    data = q.encode() if method in ("POST", "DELETE") and q else (b"" if method == "POST" else None)
    headers = {"Authorization": "Bearer " + k, "User-Agent": "floodlight"}
    if method == "POST":
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        if idem:
            headers["Idempotency-Key"] = idem
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message")
        except Exception:
            msg = None
        raise StripeError(msg or f"Stripe answered {e.code}.")
    except (OSError, ValueError) as e:
        raise StripeError(f"Couldn't reach Stripe ({type(e).__name__}).")


LOOKUP = {"plus": "floodlight_plus_month", "plus_annual": "floodlight_plus_year", "group": "floodlight_group_month"}
PRICE_ENV = {"plus": "STRIPE_PRICE_PLUS", "plus_annual": "STRIPE_PRICE_PLUS_ANNUAL", "group": "STRIPE_PRICE_GROUP"}


def price_id(plan):
    """The Stripe price for a plan: from the environment, else by lookup key; in test mode it is created when missing."""
    if os.environ.get(PRICE_ENV[plan]):
        return os.environ[PRICE_ENV[plan]]
    if plan in _prices:
        return _prices[plan]
    got = stripe("GET", "/prices", {"lookup_keys": [LOOKUP[plan]], "active": True, "limit": 1}).get("data") or []
    if got:
        _prices[plan] = got[0]["id"]
        return _prices[plan]
    if mode() != "test":
        raise StripeError(f"No Stripe price for {PLAN[plan]['name']}. Add {PRICE_ENV[plan]} on Render.")
    p = PLAN[plan]
    prod = stripe("POST", "/products", {"name": "Floodlight " + p["name"], "metadata": {"plan": plan}}, idem="fl-prod-" + plan)
    price = stripe("POST", "/prices", {"product": prod["id"], "currency": "usd", "unit_amount": p["price_cents"],
                                       "recurring": {"interval": p["interval"]}, "lookup_key": LOOKUP[plan], "metadata": {"plan": plan}},
                   idem="fl-price-" + plan)
    _prices[plan] = price["id"]
    return price["id"]


def _plan_of_price(price):
    if not isinstance(price, dict):
        return None
    lk = price.get("lookup_key") or ""
    for plan, k in LOOKUP.items():
        if lk == k or os.environ.get(PRICE_ENV[plan]) == price.get("id"):
            return plan
    return (price.get("metadata") or {}).get("plan") if (price.get("metadata") or {}).get("plan") in PAID else None


def _card(pm):
    if not isinstance(pm, dict):
        return None
    c = pm.get("card") or {}
    if not c:
        return {"brand": pm.get("type") or "payment method", "last4": "", "exp": "", "wallet": ""}
    return {"brand": c.get("brand") or "card", "last4": c.get("last4") or "", "exp": f"{c.get('exp_month', 0):02d}/{str(c.get('exp_year', ''))[-2:]}",
            "wallet": ((c.get("wallet") or {}).get("type") or "")}


def _journey(u, old_status, what=None, **props):
    """Count trial_start, subscribe, renew and cancel for the owner dashboard, once per change of state."""
    if not analytics:
        return
    st = u.get("plan_status")
    name = what or ("trial_start" if st == "trial" and old_status != "trial" else
                    "subscribe" if st == "active" and old_status not in ("active", "past_due") else None)
    if name:
        try:
            analytics.event(name, {"plan": u.get("plan"), **props}, user=u.get("username"))
        except Exception:
            pass


def apply_subscription(u, sub, quiet=False):
    """Copy a Stripe subscription onto the account."""
    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    price = item.get("price") or {}
    plan = (sub.get("metadata") or {}).get("plan") if (sub.get("metadata") or {}).get("plan") in PAID else _plan_of_price(price)
    old = (u.get("plan"), u.get("plan_status"))
    st = STATUS_MAP.get(sub.get("status"), "canceled")
    u.update({"provider": "stripe", "subscription_id": sub.get("id"), "customer_id": sub.get("customer") if isinstance(sub.get("customer"), str) else (sub.get("customer") or {}).get("id"),
              "plan": plan or u.get("plan") or "plus", "plan_status": st,
              "current_period_end": int(sub.get("current_period_end") or item.get("current_period_end") or 0),
              "cancel_at_period_end": bool(sub.get("cancel_at_period_end")), "price_cents": price.get("unit_amount"),
              "interval": (price.get("recurring") or {}).get("interval")})
    if sub.get("trial_start"):
        u["trial_started"] = int(sub["trial_start"])
        u["trialed"] = True
    if sub.get("trial_end"):
        u["trial_ends"] = int(sub["trial_end"])
    if st == "active" and not u.get("paid_since"):
        u["paid_since"] = int(time.time())
    if st == "canceled":
        u["canceled_at"] = int(sub.get("canceled_at") or sub.get("ended_at") or time.time())
    elif sub.get("cancel_at_period_end"):
        u["canceled_at"] = int(sub.get("canceled_at") or time.time())
    else:
        u.pop("canceled_at", None)
    if st != "past_due":
        u.pop("grace_until", None)
    elif not u.get("grace_until"):
        u["grace_until"] = int(time.time() + GRACE_DAYS * DAY)
    pm = sub.get("default_payment_method")
    if isinstance(pm, dict):
        u["payment_method"] = _card(pm)
    _journey(u, old[1])
    if not quiet and old != (u.get("plan"), u.get("plan_status")):
        log(f"{PLAN.get(u['plan'], {}).get('name', u['plan'])}: {old[1] or 'none'} → {st}", u["username"])


def _sub_fetch(sid):
    return stripe("GET", f"/subscriptions/{sid}", {"expand": ["default_payment_method", "items.data.price"]})


def refresh(u):
    """Re-read the member's subscription and invoices from Stripe (the billing page does this on open)."""
    if u.get("provider") != "stripe" or not key():
        return
    if u.get("subscription_id"):
        apply_subscription(u, _sub_fetch(u["subscription_id"]))
        if not u.get("payment_method") and u.get("customer_id"):
            cus = stripe("GET", f"/customers/{u['customer_id']}", {"expand": ["invoice_settings.default_payment_method"]})
            pm = (cus.get("invoice_settings") or {}).get("default_payment_method")
            if isinstance(pm, dict):
                u["payment_method"] = _card(pm)
    if u.get("customer_id"):
        inv = stripe("GET", "/invoices", {"customer": u["customer_id"], "limit": 24}).get("data") or []
        u["invoices"] = [{"id": i.get("id"), "number": i.get("number") or "", "at": int(i.get("created") or 0),
                          "amount_cents": int(i.get("amount_paid") if i.get("status") == "paid" else i.get("total") or 0),
                          "currency": i.get("currency") or "usd", "status": i.get("status") or "",
                          "url": i.get("hosted_invoice_url") or "", "pdf": i.get("invoice_pdf") or "",
                          "what": ((((i.get("lines") or {}).get("data") or [{}])[0]).get("description") or "")[:120]} for i in inv]
    _save_users()


def _ensure_customer(u):
    if u.get("customer_id"):
        return u["customer_id"]
    cus = stripe("POST", "/customers", {"email": u.get("email") or None, "name": (u.get("prefs") or {}).get("display") or u["username"],
                                        "metadata": {"username": u["username"].lower()}}, idem="fl-cus-" + u["username"].lower() + "-" + str(u.get("created", 0)))
    u["customer_id"] = cus["id"]
    _save_users()
    return cus["id"]


# ---------- the built-in test checkout ----------

def _demo_invoice(u, cents, what):
    inv = {"id": "demo_" + secrets.token_hex(6), "number": f"TEST-{int(time.time()) % 1000000:06d}", "at": int(time.time()), "amount_cents": int(cents),
           "currency": "usd", "status": "paid", "url": "", "pdf": "", "what": what, "demo": True}
    u.setdefault("invoices", []).insert(0, inv)
    del u["invoices"][36:]


def _demo_renew(u, now):
    """A test subscription renews by itself when its period ends, as Stripe's would."""
    end = float(u.get("current_period_end") or 0)
    if u.get("plan") not in PAID or not end or end > now or u.get("plan_status") not in ("trial", "active"):
        return
    if u.get("cancel_at_period_end"):
        u.update({"plan_status": "canceled", "canceled_at": u.get("canceled_at") or int(end)})
        return
    p = PLAN[u["plan"]]
    step = (365 if p["interval"] == "year" else 30) * DAY
    while end <= now:
        end += step
        _demo_invoice(u, p["price_cents"], f"{p['name']} renewal (test)")
    was = u.get("plan_status")
    if was == "trial" and not u.get("paid_since"):
        u["paid_since"] = int(u.get("trial_ends") or now)
    u.update({"plan_status": "active", "current_period_end": int(end)})
    _journey(u, was, None if was == "trial" else "renew")


def _demo_start(u, plan, trial):
    p, now, was = PLAN[plan], int(time.time()), u.get("plan_status")
    step = (365 if p["interval"] == "year" else 30) * DAY
    u.update({"provider": "demo", "plan": plan, "price_cents": p["price_cents"], "interval": p["interval"], "cancel_at_period_end": False,
              "payment_method": {"brand": "visa", "last4": "4242", "exp": "12/34", "wallet": "", "test": True}})
    u.pop("canceled_at", None)
    u.pop("grace_until", None)
    if trial:
        u.update({"plan_status": "trial", "trial_started": now, "trial_ends": now + TRIAL_DAYS * DAY, "current_period_end": now + TRIAL_DAYS * DAY, "trialed": True})
        _demo_invoice(u, 0, f"{p['name']} free trial, {TRIAL_DAYS} days (test)")
    else:
        u.update({"plan_status": "active", "paid_since": u.get("paid_since") or now, "current_period_end": now + step})
        _demo_invoice(u, p["price_cents"], f"{p['name']} (test)")
    _journey(u, was)


# ---------- actions the member takes ----------

def checkout(u, plan, site):
    """Start buying a plan. Returns (status, body) with a url to open, or done=True for the built-in test checkout."""
    if plan not in PAID:
        return 400, {"error": "Pick a plan."}
    ok, why = can_checkout(u)
    if not ok:
        return 403, {"error": why}
    if not u.get("email"):
        return 400, {"error": "Add your email address first, so we can send receipts.", "need": "email"}
    if not u.get("email_verified"):
        return 400, {"error": "Confirm your email address first. We sent you a link; you can send it again from Account.", "need": "verify"}
    if _sub_live(u) and u.get("plan_status") != "canceled":
        if u.get("plan") == plan:
            return 409, {"error": f"You're already on {PLAN[plan]['name']}."}
        return change_plan(u, plan)
    trial = not u.get("trialed")
    if mode() == "demo":
        with D["lock"]:
            _demo_start(u, plan, trial)
            _save_users()
        log(f"Test checkout: {PLAN[plan]['name']}{' trial' if trial else ''}", u["username"], plan=plan, provider="demo")
        return 200, {"done": True, "trial": trial, "plan": view(u)}
    try:
        cus = _ensure_customer(u)
        params = {"mode": "subscription", "customer": cus, "client_reference_id": u["username"].lower(),
                  "line_items": [{"price": price_id(plan), "quantity": 1}], "allow_promotion_codes": True,
                  "success_url": site + "/#/account/billing?checkout=done&session={CHECKOUT_SESSION_ID}",
                  "cancel_url": site + "/#/pricing?checkout=cancelled", "metadata": {"username": u["username"].lower(), "plan": plan, "kind": "subscription"},
                  "subscription_data": {"metadata": {"username": u["username"].lower(), "plan": plan}}}
        if trial:
            params["subscription_data"]["trial_period_days"] = TRIAL_DAYS
        s = stripe("POST", "/checkout/sessions", params)
    except StripeError as e:
        return 502, {"error": str(e)}
    log(f"Checkout opened: {PLAN[plan]['name']}", u["username"], plan=plan)
    return 200, {"url": s.get("url"), "trial": trial}


def change_plan(u, plan):
    """Switch between Plus monthly, Plus yearly and Group on a live subscription (prorated by Stripe)."""
    if u.get("provider") == "demo":
        with D["lock"]:
            p = PLAN[plan]
            u.update({"plan": plan, "price_cents": p["price_cents"], "interval": p["interval"]})
            _demo_invoice(u, 0, f"Switched to {p['name']} (test)")
            _save_users()
        log(f"Switched to {PLAN[plan]['name']} (test)", u["username"])
        return 200, {"done": True, "plan": view(u)}
    try:
        sub = _sub_fetch(u["subscription_id"])
        item = ((sub.get("items") or {}).get("data") or [{}])[0]
        sub = stripe("POST", f"/subscriptions/{u['subscription_id']}", {"items": [{"id": item.get("id"), "price": price_id(plan)}],
                                                                       "metadata": {"plan": plan}, "proration_behavior": "create_prorations",
                                                                       "expand": ["default_payment_method"]})
        with D["lock"]:
            apply_subscription(u, sub)
            _save_users()
    except StripeError as e:
        return 502, {"error": str(e)}
    return 200, {"done": True, "plan": view(u)}


def sync_checkout(u, session_id):
    """Called when the member comes back from Stripe Checkout, so the page is right even before the webhook lands."""
    if not key() or not session_id:
        return 200, {"plan": view(u)}
    try:
        s = stripe("GET", f"/checkout/sessions/{session_id}", {"expand": ["subscription", "subscription.default_payment_method", "setup_intent.payment_method"]})
    except StripeError as e:
        return 502, {"error": str(e)}
    if (s.get("metadata") or {}).get("username") not in (u["username"].lower(), None) and s.get("client_reference_id") != u["username"].lower():
        return 403, {"error": "That checkout belongs to another account."}
    _handle_session(s, u)
    return 200, {"plan": view(u)}


def _handle_session(s, u=None):
    """A finished Checkout session: a subscription, a card change or a gift."""
    meta = s.get("metadata") or {}
    u = u or D["users"].get(meta.get("username") or s.get("client_reference_id") or "")
    kind = meta.get("kind") or ("setup" if s.get("mode") == "setup" else "subscription")
    if kind == "gift":
        if s.get("payment_status") == "paid":
            make_gift(meta.get("gift"), buyer=meta.get("username") or "", to=meta.get("to") or "", ref=s.get("id"), email=(s.get("customer_details") or {}).get("email"))
        return
    if not u:
        return
    with D["lock"]:
        if kind == "setup":
            si = s.get("setup_intent") or {}
            if isinstance(si, str):
                si = stripe("GET", f"/setup_intents/{si}", {"expand": ["payment_method"]})
            pm = si.get("payment_method")
            pm_id = pm.get("id") if isinstance(pm, dict) else pm
            if pm_id and u.get("customer_id"):
                stripe("POST", f"/customers/{u['customer_id']}", {"invoice_settings": {"default_payment_method": pm_id}})
                if u.get("subscription_id"):
                    stripe("POST", f"/subscriptions/{u['subscription_id']}", {"default_payment_method": pm_id})
                pm = pm if isinstance(pm, dict) else stripe("GET", f"/payment_methods/{pm_id}")
                u["payment_method"] = _card(pm)
                log("Payment method updated", u["username"])
        else:
            sub = s.get("subscription")
            if isinstance(sub, str):
                sub = _sub_fetch(sub)
            if isinstance(sub, dict):
                if isinstance(s.get("customer"), str):
                    u["customer_id"] = s["customer"]
                apply_subscription(u, sub)
        _save_users()


def cancel(u, reason="", note=""):
    """Cancel at the end of the paid period (or the trial). Nothing more is charged; the plan lasts until then."""
    if u.get("plan") not in PAID or not _sub_live(u):
        return 400, {"error": "There's no active plan to cancel."}
    if u.get("group_of") and u.get("plan") != "group":
        return 400, {"error": "Your Plus comes from a group. Ask its owner, or leave the group."}
    reason = reason if reason in REASONS else "other"
    note = str(note or "")[:500]
    if u.get("provider") == "stripe":
        try:
            sub = stripe("POST", f"/subscriptions/{u['subscription_id']}", {"cancel_at_period_end": True,
                                                                           "cancellation_details": {"feedback": REASONS[reason], "comment": note or None},
                                                                           "expand": ["default_payment_method"]})
        except StripeError as e:
            return 502, {"error": str(e)}
        with D["lock"]:
            apply_subscription(u, sub, quiet=True)
    with D["lock"]:
        u.update({"cancel_at_period_end": True, "canceled_at": int(time.time()), "cancel_reason": reason, "cancel_note": note})
        _save_users()
    log(f"Cancelled {PLAN[u['plan']]['name']} ({reason})", u["username"], reason=reason, note=note)
    _journey(u, u.get("plan_status"), "cancel", reason=reason)
    return 200, {"ok": True, "plan": view(u)}


def reactivate(u):
    """Undo a cancellation while the period is still running."""
    if not u.get("cancel_at_period_end") or not _sub_live(u):
        return 400, {"error": "There's nothing to reactivate. Pick a plan on the pricing page instead."}
    if u.get("provider") == "stripe":
        try:
            sub = stripe("POST", f"/subscriptions/{u['subscription_id']}", {"cancel_at_period_end": False, "expand": ["default_payment_method"]})
        except StripeError as e:
            return 502, {"error": str(e)}
        with D["lock"]:
            apply_subscription(u, sub, quiet=True)
    with D["lock"]:
        u["cancel_at_period_end"] = False
        if u.get("plan_status") == "canceled":
            u["plan_status"] = "active"
        for k in ("canceled_at", "cancel_reason", "cancel_note"):
            u.pop(k, None)
        _save_users()
    log(f"Reactivated {PLAN[u['plan']]['name']}", u["username"])
    return 200, {"ok": True, "plan": view(u)}


def update_card(u, site):
    """A Stripe page to add a new card; it becomes the default for the subscription."""
    if u.get("provider") == "demo":
        return 200, {"done": True, "note": "Test mode: the test card stays on file. Nothing is charged."}
    if not u.get("customer_id"):
        return 400, {"error": "There's no billing account yet."}
    try:
        s = stripe("POST", "/checkout/sessions", {"mode": "setup", "customer": u["customer_id"], "currency": "usd",
                                                  "success_url": site + "/#/account/billing?card=done&session={CHECKOUT_SESSION_ID}",
                                                  "cancel_url": site + "/#/account/billing", "metadata": {"username": u["username"].lower(), "kind": "setup"}})
    except StripeError as e:
        return 502, {"error": str(e)}
    return 200, {"url": s.get("url")}


def restore(u):
    """Find a subscription bought with this account's email (after an account was recreated, for example) and link it."""
    if not u.get("email") or not u.get("email_verified"):
        return 400, {"error": "Confirm your email address first. A purchase is found by the email it was made with."}
    if not key():
        return 200, {"found": False, "message": "Test mode: there's nothing to restore."}
    try:
        best = None
        for cus in stripe("GET", "/customers", {"email": u["email"], "limit": 10}).get("data") or []:
            for sub in stripe("GET", "/subscriptions", {"customer": cus["id"], "status": "all", "limit": 10, "expand": ["data.default_payment_method"]}).get("data") or []:
                rank = {"active": 3, "trialing": 3, "past_due": 2}.get(sub.get("status"), 0)
                if rank and (not best or rank > best[0]):
                    best = (rank, cus, sub)
    except StripeError as e:
        return 502, {"error": str(e)}
    if not best:
        return 200, {"found": False, "message": f"No active plan was bought with {u['email']}. If you used another email, contact support."}
    _, cus, sub = best
    owner = (sub.get("metadata") or {}).get("username") or ""
    other = D["users"].get(owner)
    if other and other is not u and other.get("subscription_id") == sub["id"]:
        return 409, {"error": "That plan is linked to another Floodlight account. Contact support to move it."}
    with D["lock"]:
        u["customer_id"] = cus["id"]
        apply_subscription(u, sub)
        _save_users()
    try:
        stripe("POST", f"/subscriptions/{sub['id']}", {"metadata": {"username": u["username"].lower()}})
    except StripeError:
        pass
    log("Purchase restored", u["username"])
    return 200, {"found": True, "plan": view(u)}


# ---------- gifts, credits and owner grants ----------

def _code():
    abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "FL-" + "".join(secrets.choice(abc) for _ in range(4)) + "-" + "".join(secrets.choice(abc) for _ in range(4))


def make_gift(gift, buyer="", to="", ref="", email=""):
    g = GIFTS.get(gift)
    if not g:
        return None
    with _slock:
        for c, v in _state["gifts"].items():
            if ref and v.get("ref") == ref:
                return c                              # the webhook and the return page both report the same purchase
        c = _code()
        _state["gifts"][c] = {"months": g["months"], "buyer": buyer, "to": to, "ref": ref, "at": int(time.time()), "used_by": None, "used_at": None}
        _save_state()
    log(f"Gift bought: {g['name']}", buyer, code=c)
    mail = D.get("mail")
    if mail:
        for addr in {a for a in (email, to) if a}:
            mail(addr, "Your Floodlight Plus gift code",
                 f"Here is a gift code for {g['months']} month{'s' if g['months'] > 1 else ''} of Floodlight Plus:\n\n    {c}\n\n"
                 f"Redeem it in Floodlight under Account > Plan and billing > Redeem a code.\n")
    return c


def gift_checkout(u, gift, to, site):
    g = GIFTS.get(gift)
    if not g:
        return 400, {"error": "Pick a gift."}
    ok, why = can_checkout(u)
    if not ok:
        return 403, {"error": why}
    if not u.get("email_verified"):
        return 400, {"error": "Confirm your email address first, so we can send you the gift code.", "need": "verify"}
    to = str(to or "").strip()[:120]
    if mode() == "demo":
        c = make_gift(gift, buyer=u["username"].lower(), to=to, ref="demo_" + secrets.token_hex(6), email=u.get("email"))
        with D["lock"]:
            _demo_invoice(u, g["price_cents"], g["name"] + " (test)")
            _save_users()
        return 200, {"done": True, "code": c}
    try:
        s = stripe("POST", "/checkout/sessions", {"mode": "payment", "customer": _ensure_customer(u),
                                                  "line_items": [{"quantity": 1, "price_data": {"currency": "usd", "unit_amount": g["price_cents"], "product_data": {"name": g["name"]}}}],
                                                  "success_url": site + "/#/account/billing?gift=done&session={CHECKOUT_SESSION_ID}",
                                                  "cancel_url": site + "/#/pricing", "allow_promotion_codes": True,
                                                  "metadata": {"username": u["username"].lower(), "kind": "gift", "gift": gift, "to": to}})
    except StripeError as e:
        return 502, {"error": str(e)}
    return 200, {"url": s.get("url")}


def gift_of_session(u, session_id):
    with _slock:
        for c, v in _state["gifts"].items():
            if v.get("ref") == session_id and v.get("buyer") == u["username"].lower():
                return c
    return None


def _extend(u, months):
    base = max(time.time(), float(u.get("comp_until") or 0))
    u["comp_until"] = int(base + months * 30 * DAY)


def redeem(u, code):
    code = str(code or "").strip().upper()
    with _slock:
        g = _state["gifts"].get(code)
        if not g or g.get("used_by"):
            return 404, {"error": "That code isn't valid or was already used."}
        g.update({"used_by": u["username"].lower(), "used_at": int(time.time())})
        _save_state()
    with D["lock"]:
        _extend(u, g["months"])
        _save_users()
    log(f"Gift code redeemed ({g['months']} months)", u["username"], code=code)
    return 200, {"ok": True, "months": g["months"], "plan": view(u)}


def use_credit(u):
    n = int(u.get("ref_credit_months") or 0)
    if n < 1:
        return 400, {"error": "You have no free months to use."}
    with D["lock"]:
        u["ref_credit_months"] = n - 1
        _extend(u, 1)
        _save_users()
    log("Referral month used", u["username"])
    return 200, {"ok": True, "plan": view(u)}


# ---------- Group seats ----------

def group(u, action, who):
    """The Group plan's buyer adds or removes up to four members; a member can leave."""
    users = D["users"]
    me = u["username"].lower()
    if action == "leave":
        owner = users.get(str(u.get("group_of") or ""))
        with D["lock"]:
            if owner:
                owner["group_members"] = [m for m in owner.get("group_members") or [] if m != me]
            u.pop("group_of", None)
            _save_users()
        return 200, {"ok": True, "plan": view(u)}
    if u.get("plan") != "group" or not _sub_live(u):
        return 403, {"error": "Only the person who bought a Group plan can manage its seats."}
    who = str(who or "").strip().lower()
    target = users.get(who) or next((x for x in users.values() if (x.get("email") or "").lower() == who and x.get("email_verified")), None)
    if not target:
        return 404, {"error": "No Floodlight account has that username or confirmed email. Ask them to create one first."}
    tk = target["username"].lower()
    members = list(u.get("group_members") or [])
    with D["lock"]:
        if action == "add":
            if tk == me or tk in members:
                return 409, {"error": "They're already in your group."}
            if len(members) >= GROUP_SEATS - 1:
                return 409, {"error": f"A Group plan has {GROUP_SEATS} seats including yours. Remove someone first."}
            if target.get("group_of") and target.get("group_of") != me:
                return 409, {"error": "They're already in another group."}
            members.append(tk)
            target["group_of"] = me
        elif action == "remove":
            members = [m for m in members if m != tk]
            if target.get("group_of") == me:
                target.pop("group_of", None)
        else:
            return 400, {"error": "Unknown action."}
        u["group_members"] = members
        _save_users()
    log(f"Group {action}: {tk}", u["username"])
    return 200, {"ok": True, "plan": view(u)}


def comp(actor, target, months):
    """Owner grant: free Plus for a member (founding members, testers). months=0 removes it."""
    with D["lock"]:
        if months <= 0:
            target.pop("comp_until", None)
        else:
            _extend(target, months)
        _save_users()
    log(f"Plus granted by {actor['username']} for {months} months" if months > 0 else f"Free Plus removed by {actor['username']}", target["username"])
    return 200, {"ok": True}


# ---------- webhook ----------

def verify_signature(payload, header, secret, tolerance=300, now=None):
    """Stripe-Signature: t=<time>,v1=<hex hmac of "t.payload">."""
    if not secret or not header:
        return False
    parts = {}
    for kv in header.split(","):
        k, _, v = kv.partition("=")
        parts.setdefault(k.strip(), []).append(v.strip())
    try:
        t = int(parts.get("t", ["0"])[0])
    except ValueError:
        return False
    if abs((now or time.time()) - t) > tolerance:
        return False
    want = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(want, sig) for sig in parts.get("v1", []))


def _user_for(obj):
    meta = obj.get("metadata") or {}
    users = D["users"]
    if meta.get("username") in users:
        return users[meta["username"]]
    cus = obj.get("customer") if isinstance(obj.get("customer"), str) else (obj.get("customer") or {}).get("id")
    sid = obj.get("subscription") if isinstance(obj.get("subscription"), str) else obj.get("id")
    for u in users.values():
        if (cus and u.get("customer_id") == cus) or (sid and u.get("subscription_id") == sid):
            return u
    return None


def webhook(payload, header):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET") or ""
    if not verify_signature(payload, header, secret):
        return 400, {"error": "bad signature"}
    try:
        ev = json.loads(payload)
    except ValueError:
        return 400, {"error": "bad json"}
    eid, typ, obj = ev.get("id"), ev.get("type") or "", (ev.get("data") or {}).get("object") or {}
    with _slock:
        if eid in _state["events"]:
            return 200, {"ok": True, "duplicate": True}
        _state["events"].append(eid)
        del _state["events"][:-500]
        _state["webhook_at"] = int(time.time())
        _save_state()
    try:
        if typ == "checkout.session.completed":
            _handle_session(obj)
        elif typ.startswith("customer.subscription."):
            u = _user_for(obj)
            if u:
                sub = _sub_fetch(obj["id"]) if key() else obj
                with D["lock"]:
                    apply_subscription(u, sub)
                    _save_users()
        elif typ in ("invoice.paid", "invoice.payment_succeeded"):
            u = _user_for(obj)
            if u:
                with D["lock"]:
                    u.pop("grace_until", None)
                    if u.get("plan_status") == "past_due":
                        u["plan_status"] = "active"
                    if obj.get("billing_reason") == "subscription_cycle" and int(obj.get("amount_paid") or 0) > 0:
                        log("Renewed", u["username"], amount_cents=obj.get("amount_paid"))
                        _journey(u, u.get("plan_status"), "renew")
                        u["renewed_at"] = int(time.time())
                    if not u.get("paid_since") and int(obj.get("amount_paid") or 0) > 0:
                        u["paid_since"] = int(time.time())
                    _save_users()
        elif typ == "invoice.payment_failed":
            u = _user_for(obj)
            if u:
                with D["lock"]:
                    u["plan_status"] = "past_due"
                    u["grace_until"] = int(u.get("grace_until") or time.time() + GRACE_DAYS * DAY)
                    _save_users()
                log("Payment failed", u["username"])
                mail = D.get("mail")
                if mail and u.get("email"):
                    mail(u["email"], "Your Floodlight payment didn't go through",
                         f"We couldn't charge your card for Floodlight Plus. Your plan stays on for {GRACE_DAYS} days while Stripe tries again.\n\n"
                         f"Update your card under Account > Plan and billing: {D['site']()}/#/account/billing\n")
    except StripeError as e:
        print(f"billing: webhook {typ} couldn't reach Stripe: {e}")
        return 500, {"error": "try again"}
    return 200, {"ok": True}


# ---------- owner view ----------

def summary():
    """Business numbers for the owner: test checkouts are counted apart so they never inflate revenue."""
    users = list(D["users"].values())
    now = _now()
    counted = [u for u in users if u.get("provider") in ("stripe",)]
    demo = [u for u in users if u.get("provider") == "demo"]
    by = {"free": 0, "plus": 0, "plus_annual": 0, "group": 0}
    for u in users:
        by[effective(u, now)] = by.get(effective(u, now), 0) + 1

    def mrr(group):
        cents = 0
        for u in group:
            if u.get("plan") in PAID and u.get("plan_status") in ("active", "past_due") and _sub_live(u, now):
                p = int(u.get("price_cents") or PLAN[u["plan"]]["price_cents"])
                cents += p / 12 if (u.get("interval") or PLAN[u["plan"]]["interval"]) == "year" else p
        return int(round(cents))
    trials = sum(1 for u in counted if u.get("plan_status") == "trial" and _sub_live(u, now))
    paying = sum(1 for u in counted if u.get("plan_status") in ("active", "past_due") and _sub_live(u, now))
    cancels = [x for x in _state["log"] if x["what"].startswith("Cancelled") and now - x["at"] < 30 * DAY]
    reasons = {}
    for x in cancels:
        reasons[x.get("reason") or "other"] = reasons.get(x.get("reason") or "other", 0) + 1
    m = mrr(counted)
    return {"mode": mode(), "live_allowed": live_allowed(), "enforced": enforced(), "env_enforced": os.environ.get("FLOODLIGHT_PAYWALL") == "1",
            "durable": bool(D.get("durable", lambda: False)()), "webhook": bool(os.environ.get("STRIPE_WEBHOOK_SECRET")), "webhook_at": _state.get("webhook_at") or None,
            "webhook_url": D["site"]() + "/api/billing/webhook", "mail": bool(D.get("mail_ready", lambda: False)()),
            "users": len(users), "by_plan": by, "trials": trials, "paying": paying, "past_due": sum(1 for u in counted if u.get("plan_status") == "past_due"),
            "mrr_cents": m, "arr_cents": m * 12, "cancels_30d": len(cancels), "cancel_reasons": reasons,
            "comped": sum(1 for u in users if float(u.get("comp_until") or 0) > now), "demo_accounts": len(demo), "demo_mrr_cents": mrr(demo),
            "gifts": {"sold": len(_state["gifts"]), "redeemed": sum(1 for g in _state["gifts"].values() if g.get("used_by"))},
            "log": _state["log"][:80]}


def set_enforce(on):
    with _slock:
        _state["enforce"] = bool(on)
        _save_state()
    log("Plan limits " + ("on" if on else "off"))


def forget(u):
    """Account deletion: stop billing at once and remove the member from any group."""
    if u.get("provider") == "stripe" and u.get("subscription_id") and _sub_live(u):
        try:
            stripe("DELETE", f"/subscriptions/{u['subscription_id']}")
        except StripeError as e:
            print(f"billing: couldn't cancel {u['username']}'s subscription on delete: {e}")
    me = u["username"].lower()
    for other in D["users"].values():
        if me in (other.get("group_members") or []):
            other["group_members"] = [m for m in other["group_members"] if m != me]
        if other.get("group_of") == me:
            other.pop("group_of", None)
    with _slock:
        _state["usage"].pop(me, None)
        _save_state()


def export(u):
    keys = ("plan", "plan_status", "trial_started", "trial_ends", "paid_since", "canceled_at", "current_period_end", "cancel_at_period_end",
            "price_cents", "interval", "provider", "payment_method", "invoices", "group_of", "group_members", "comp_until", "ref_credit_months", "cancel_reason")
    return {k: u.get(k) for k in keys if u.get(k) is not None}
