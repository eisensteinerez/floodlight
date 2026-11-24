"""The owner dashboard's business and product numbers, worked out from the accounts, the usage counts (analytics.py),
support (support.py) and referrals (referrals.py). Read-only: nothing here changes an account.

Money numbers come from fields the billing code keeps on each account: plan, plan_status (trial, active, past_due,
canceled), trial_started, paid_since, canceled_at, price_cents and interval (month or year). Until paid plans are on,
no account has them and the dashboard says so instead of showing zeros as if they were results.
"""
import time

import analytics

DAY = 86400
PAID_STATES = ("active", "past_due")


def _monthly_cents(u):
    p = int(u.get("price_cents") or 0)
    return p / 12 if u.get("interval") == "year" else p


def business(users, now=None):
    now = now or time.time()
    us = list(users.values())
    total = len(us)
    seen = [int(u.get("seen") or u.get("created") or 0) for u in us]
    dau = sum(1 for s in seen if now - s < DAY)
    wau = sum(1 for s in seen if now - s < 7 * DAY)
    mau = sum(1 for s in seen if now - s < 30 * DAY)
    new7 = sum(1 for u in us if now - int(u.get("created") or 0) < 7 * DAY)
    new30 = sum(1 for u in us if now - int(u.get("created") or 0) < 30 * DAY)
    billing = any(u.get("plan_status") or u.get("plan") for u in us)
    paid = [u for u in us if u.get("plan_status") in PAID_STATES and (u.get("plan") or "free") != "free"]
    trial = [u for u in us if u.get("plan_status") == "trial"]
    canceled30 = [u for u in us if u.get("canceled_at") and now - int(u["canceled_at"]) < 30 * DAY]
    mrr = sum(_monthly_cents(u) for u in paid if u.get("plan_status") == "active") / 100
    tried = [u for u in us if u.get("trial_started")]
    tried_done = [u for u in tried if u.get("plan_status") != "trial"]
    converted = [u for u in tried_done if u.get("paid_since") and int(u["paid_since"]) >= int(u["trial_started"])]
    start_paid = len(paid) + len(canceled30)
    refunds = [r for u in us for r in u.get("refunds") or [] if now - int(r.get("at") or 0) < 30 * DAY]
    out = {"users": {"total": total, "dau": dau, "wau": wau, "mau": mau, "new7": new7, "new30": new30},
           "billing": billing}
    if billing:
        out["money"] = {
            "paid": len(paid), "trial": len(trial), "pastDue": sum(1 for u in paid if u.get("plan_status") == "past_due"),
            "cancellations30": len(canceled30), "mrr": round(mrr, 2), "arr": round(mrr * 12, 2),
            "conversion": round(len(paid) / total * 100, 1) if total else None,
            "trialToPaid": round(len(converted) / len(tried_done) * 100, 1) if tried_done else None,
            "churn": round(len(canceled30) / start_paid * 100, 1) if start_paid else None,
            "arppu": round(mrr / len(paid), 2) if paid else None,
            "byPlan": _by_plan(paid + trial),
            "failedPayments30": sum(1 for u in us if now - float(u.get("payment_failed_at") or 0) < 30 * DAY),
            "refunds30": len(refunds), "refunded30": round(sum(int(r.get("amount_cents") or 0) for r in refunds) / 100, 2),
            "disputesOpen": sum(1 for u in us if u.get("dispute_open"))}
    return out


def _by_plan(us):
    tally = {}
    for u in us:
        k = (u.get("plan") or "free") + ("_trial" if u.get("plan_status") == "trial" else "")
        tally[k] = tally.get(k, 0) + 1
    return sorted(tally.items(), key=lambda kv: -kv[1])


def product(users, parlays, days=30):
    """Counts across accounts (boards, follows, alerts, parlays) plus the usage events of the last `days` days."""
    us = list(users.values())
    boards = sum(len((u.get("prefs") or {}).get("boards") or []) for u in us)
    follows = sum(len((u.get("prefs") or {}).get("follows") or []) for u in us)
    slips = sum(len((u.get("prefs") or {}).get("slips") or []) for u in us)
    cards = sum(len(v or []) for v in (parlays or {}).values())
    return {"saved": {"boards": boards, "follows": follows, "slips": slips, "cards": cards}, "usage": analytics.usage(days)}


def growth(users, days=30):
    created = {k: int(u.get("created") or 0) for k, u in users.items()}
    paid = [k for k, u in users.items() if u.get("plan_status") in PAID_STATES]
    return {"funnel": analytics.funnel(days), "retention": analytics.retention(created), "firstUseful": analytics.first_useful_minutes(),
            "onboarding": analytics.onboarding_rate(), "paidFeature": analytics.paid_feature(paid), "cancel": analytics.cancel_reasons(90)}
