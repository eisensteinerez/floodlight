"""Plans, entitlements and the Stripe webhook, in-process (no server, no network): plans.json is checked and filled in,
every plan check goes through entitlements.py, and each webhook event is processed exactly once even when processing
fails part-way (Stripe's retry must run it again, not be dropped as a duplicate).
Run: python3 -m pytest tests/test_subscriptions.py"""
import copy
import hashlib
import hmac
import json
import os
import sys
import threading
import time

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import billing  # noqa: E402
import entitlements as E  # noqa: E402

SECRET = "whsec_unit"
RAW = json.load(open(os.path.join(ROOT, "plans.json")))


class Store:
    def __init__(self):
        self.files = {}

    def load(self, f, default):
        return copy.deepcopy(self.files.get(str(f), default))

    def save(self, f, data):
        self.files[str(f)] = copy.deepcopy(data)


@pytest.fixture
def world(monkeypatch):
    users, mails = {}, []
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("FLOODLIGHT_PAYWALL", raising=False)
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    billing.setup(users=users, save=lambda: None, lock=threading.RLock(), storage=Store(), file="billing.json",
                  rank=lambda u: (u or {}).get("rank", "member"), site=lambda: "https://fl.test", mail=lambda to, s, t: mails.append((to, s, t)),
                  mail_ready=lambda: False, durable=lambda: True, hosted=True, gated=True, terms_version=lambda: "v1")
    billing._inflight.clear()
    return users, mails


def member(users, name, **kw):
    u = {"username": name, "email": f"{name}@example.com", "email_verified": True, "created": 1, **kw}
    users[name] = u
    return u


def deliver(ev):
    payload = json.dumps(ev).encode()
    t = int(time.time())
    sig = hmac.new(SECRET.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return billing.webhook(payload, f"t={t},v1={sig}")


def sub_obj(sid, cus, user, status="active", plan="plus", **kw):
    now = int(time.time())
    return {"id": sid, "object": "subscription", "customer": cus, "status": status, "cancel_at_period_end": False,
            "metadata": {"username": user, "plan": plan},
            "items": {"data": [{"id": "si_" + sid, "current_period_end": now + 30 * 86400,
                                "price": {"id": "price_x", "unit_amount": 499, "recurring": {"interval": "month"}, "lookup_key": "floodlight_plus_month_499usd"}}]}, **kw}


# ---------- plans.json ----------

def test_plans_file_is_filled_in_from_one_place():
    assert E.PLAN["plus"]["price_cents"] == 499 and E.PLAN["plus_annual"]["price_cents"] == 2999 and E.PLAN["group"]["price_cents"] == 999
    assert "5 Lab searches a day" in E.PLAN["free"]["features"]
    assert "Works out to $2.50 a month" in E.PLAN["plus_annual"]["features"]
    assert "Plus for you and up to 4 others" in E.PLAN["group"]["features"]
    assert E.CONFIG["compare"][1] == ["Lab searches", "5 a day", "Unlimited"]
    assert E.PAID == ("plus", "plus_annual", "group") and billing.PAID == E.PAID


def test_changing_a_price_or_limit_only_needs_the_file():
    raw = copy.deepcopy(RAW)
    raw["plans"][1]["price_cents"] = 599
    raw["free_limits"]["lab_search"] = 3
    cfg = E.parse(raw)
    plus = next(p for p in cfg["plans"] if p["id"] == "plus")
    free = next(p for p in cfg["plans"] if p["id"] == "free")
    assert plus["price_cents"] == 599 and "3 Lab searches a day" in free["features"] and cfg["compare"][1][1] == "3 a day"


@pytest.mark.parametrize("break_it, why", [
    (lambda r: r["plans"].pop(3), "missing the plan"),
    (lambda r: r["plans"][1].update(price_cents=0), "price_cents"),
    (lambda r: r["plans"][1].update(interval="week"), "interval"),
    (lambda r: r["plans"][1]["entitlements"].append("teleport"), "entitlements"),
    (lambda r: r["plans"][0]["features"].append("{nonsense}"), "placeholder"),
    (lambda r: r["free_limits"].pop("boards"), "free_limits"),
    (lambda r: r.update(trial_days=-1), "trial_days"),
    (lambda r: r["features"].pop("lab_unlimited"), "features"),
])
def test_a_broken_plans_file_is_refused(break_it, why):
    raw = copy.deepcopy(RAW)
    break_it(raw)
    with pytest.raises(E.PlanConfigError, match=why):
        E.parse(raw)


def test_a_broken_override_file_falls_back_to_the_repository_copy(tmp_path):
    bad = tmp_path / "plans.json"
    bad.write_text("{not json")
    assert E.load(bad)["plans"][1]["id"] == "plus"


def test_stripe_lookup_key_carries_the_price_so_a_new_price_is_a_new_stripe_price():
    assert billing.lookup_key("plus") == "floodlight_plus_month_499usd"
    assert billing._plan_of_price({"lookup_key": "floodlight_plus_month_499usd"}) == "plus"
    assert billing._plan_of_price({"lookup_key": "floodlight_plus_month"}) == "plus"          # prices made before this change
    assert billing._plan_of_price({"lookup_key": "floodlight_plus_year_2999usd"}) == "plus_annual"


# ---------- entitlements ----------

def test_everyone_has_everything_until_limits_are_on(world):
    users, _ = world
    u = member(users, "free1")
    assert E.can_use_unlimited_lab(u) and E.can_create_unlimited_boards(u) and E.limit(u, "boards") is None
    billing.set_enforce(True)
    assert not E.can_use_unlimited_lab(u) and not E.can_view_provider_comparison(u) and E.limit(u, "boards") == 1
    assert E.check_list_growth(u, "boards", [1], [1, 2]) == "Free includes 1 saved board. Upgrade to Plus for unlimited."
    assert E.check_list_growth(u, "boards", [1, 2, 3], [1, 2, 3]) is None          # nothing already saved is ever taken away
    u.update(comp_until=time.time() + 86400)
    assert E.can_use_unlimited_lab(u) and E.limit(u, "boards") is None
    billing.set_enforce(False)


def test_the_view_has_the_named_checks_the_browser_uses(world):
    users, _ = world
    v = billing.view(member(users, "v1"))
    for name in ("canUseUnlimitedLab", "canUseAdvancedFilters", "canCreateUnlimitedBoards", "canUseAdvancedAlerts",
                 "canViewProviderComparison", "canViewFullHistory", "canCreateGroup"):
        assert name in v["can"]
    assert v["names"]["lab_unlimited"] == "Unlimited Lab searches" and v["free_summary"].startswith("Live scores, 5 Lab searches")
    assert v["yearly_saving_pct"] == 50 and v["group_seats"] == 5


def test_only_the_buyer_of_a_live_group_plan_can_manage_seats(world):
    users, _ = world
    now = time.time()
    buyer = member(users, "buyer", plan="group", plan_status="active", current_period_end=now + 86400)
    seat = member(users, "seat", group_of="buyer")
    buyer["group_members"] = ["seat"]
    plus = member(users, "plusone", plan="plus", plan_status="active", current_period_end=now + 86400)
    assert E.can_create_group(buyer) and not E.can_create_group(seat) and not E.can_create_group(plus)
    assert billing.effective(seat) == "group"
    assert billing.group(seat, "add", "plusone")[0] == 403
    buyer["plan_status"], buyer["current_period_end"] = "canceled", now - 10
    assert not E.can_create_group(buyer)


def test_free_lab_searches_count_once_per_player_per_day(world):
    users, _ = world
    u = member(users, "searcher")
    billing.set_enforce(True)
    for i in range(5):
        assert E.use(u, "lab_search", f"p{i}")[0]
    assert E.use(u, "lab_search", "p0") == (True, 0)                 # the same player again is free
    assert E.use(u, "lab_search", "p9") == (False, 0)
    billing.set_enforce(False)


# ---------- webhooks ----------

def test_a_failed_event_is_processed_again_on_retry_not_dropped(world, monkeypatch):
    users, _ = world
    member(users, "retry")
    ev = {"id": "evt_retry", "type": "customer.subscription.created", "data": {"object": sub_obj("sub_r", "cus_r", "retry")}}
    real = billing._on_subscription
    calls = {"n": 0}

    def flaky(typ, obj):
        calls["n"] += 1
        if calls["n"] == 1:
            raise billing.StripeError("Couldn't reach Stripe (URLError).")
        return real(typ, obj)
    monkeypatch.setattr(billing, "_on_subscription", flaky)
    assert deliver(ev)[0] == 500 and users["retry"].get("plan_status") is None
    assert deliver(ev) == (200, {"ok": True}) and users["retry"]["plan_status"] == "active"
    assert deliver(ev)[1].get("duplicate") and calls["n"] == 2


def test_a_second_delivery_while_the_first_runs_is_told_to_retry(world):
    users, _ = world
    member(users, "busy")
    billing._inflight.add("evt_busy")
    st, _ = deliver({"id": "evt_busy", "type": "customer.subscription.updated", "data": {"object": sub_obj("sub_b", "cus_b", "busy")}})
    assert st == 409 and "evt_busy" not in billing._state["events"]


def test_trial_ending_sends_one_reminder_with_the_date_and_price(world):
    users, mails = world
    member(users, "trialer")
    end = int(time.time()) + 3 * 86400
    sub = sub_obj("sub_t", "cus_t", "trialer", status="trialing", trial_start=end - 7 * 86400, trial_end=end)
    deliver({"id": "evt_t1", "type": "customer.subscription.trial_will_end", "data": {"object": sub}})
    deliver({"id": "evt_t1", "type": "customer.subscription.trial_will_end", "data": {"object": sub}})
    reminders = [m for m in mails if "trial ends soon" in m[1]]
    assert len(reminders) == 1 and "$4.99" in reminders[0][2] and time.strftime("%B", time.gmtime(end)) in reminders[0][2]
    assert users["trialer"]["plan_status"] == "trial"


def test_no_trial_reminder_after_cancelling(world):
    users, mails = world
    member(users, "quitter")
    end = int(time.time()) + 3 * 86400
    sub = sub_obj("sub_q", "cus_q", "quitter", status="trialing", trial_end=end, cancel_at_period_end=True)
    deliver({"id": "evt_q", "type": "customer.subscription.trial_will_end", "data": {"object": sub}})
    assert not [m for m in mails if "trial ends soon" in m[1]]


def test_cancelled_subscription_ends_the_plan(world):
    users, mails = world
    member(users, "ender")
    deliver({"id": "evt_e1", "type": "customer.subscription.created", "data": {"object": sub_obj("sub_e", "cus_e", "ender")}})
    gone = sub_obj("sub_e", "cus_e", "ender", status="canceled", canceled_at=int(time.time()))
    gone["items"]["data"][0]["current_period_end"] = int(time.time()) - 5
    deliver({"id": "evt_e2", "type": "customer.subscription.deleted", "data": {"object": gone}})
    assert billing.effective(users["ender"]) == "free" and any("has ended" in m[1] for m in mails)


def test_payment_failed_then_paid(world):
    users, mails = world
    member(users, "late", customer_id="cus_l", subscription_id="sub_l", provider="stripe", plan="plus", plan_status="active", current_period_end=time.time() + 86400)
    deliver({"id": "evt_l1", "type": "invoice.payment_failed", "data": {"object": {"customer": "cus_l", "subscription": "sub_l"}}})
    u = users["late"]
    assert u["plan_status"] == "past_due" and u["grace_until"] > time.time() and billing.effective(u) == "plus"
    assert any("didn't go through" in m[1] for m in mails)
    deliver({"id": "evt_l2", "type": "invoice.paid", "data": {"object": {"customer": "cus_l", "subscription": "sub_l", "amount_paid": 499, "billing_reason": "subscription_cycle"}}})
    assert u["plan_status"] == "active" and "grace_until" not in u
    assert billing.summary()["failed_payments_30d"] == 1


def test_a_past_due_plan_lapses_after_the_grace_period(world):
    users, _ = world
    u = member(users, "lapsed", plan="plus", plan_status="past_due", grace_until=time.time() - 1, provider="stripe")
    assert billing.effective(u) == "free"


def test_refunds_are_recorded_once_and_mark_the_receipt(world):
    users, _ = world
    u = member(users, "refundee", customer_id="cus_rf", provider="stripe", plan="plus", plan_status="active", current_period_end=time.time() + 86400,
               invoices=[{"id": "in_1", "amount_cents": 499, "status": "paid"}])
    charge = {"id": "ch_1", "object": "charge", "customer": "cus_rf", "invoice": "in_1", "amount_refunded": 200, "currency": "usd"}
    deliver({"id": "evt_rf1", "type": "charge.refunded", "data": {"object": charge}})
    assert u["refunds"][0]["amount_cents"] == 200 and u["invoices"][0]["status"] == "partly refunded"
    deliver({"id": "evt_rf2", "type": "charge.refunded", "data": {"object": {**charge, "amount_refunded": 499}}})
    assert len(u["refunds"]) == 1 and u["refunds"][0]["amount_cents"] == 499 and u["invoices"][0]["status"] == "refunded"
    s = billing.summary()
    assert s["refunds_30d"] == 1 and s["refunded_cents_30d"] == 499
    assert billing.effective(u) == "plus"                    # the plan only ends if Stripe also cancels it


def test_disputes_flag_the_account_until_closed(world):
    users, _ = world
    u = member(users, "disputer", customer_id="cus_d", provider="stripe")
    dp = {"id": "dp_1", "object": "dispute", "charge": {"id": "ch_d", "customer": "cus_d"}, "amount": 499, "reason": "fraudulent", "status": "needs_response"}
    deliver({"id": "evt_d1", "type": "charge.dispute.created", "data": {"object": dp}})
    assert u["dispute_open"] and billing.view(u)["dispute"] and billing.summary()["disputes_open"] == 1
    deliver({"id": "evt_d2", "type": "charge.dispute.closed", "data": {"object": {**dp, "status": "won"}}})
    assert not u["dispute_open"] and len(u["disputes"]) == 1


def test_events_without_an_id_or_signature_are_refused(world):
    assert billing.webhook(b"{}", "t=1,v1=nope")[0] == 400
    assert deliver({"type": "invoice.paid", "data": {"object": {}}})[0] == 400
