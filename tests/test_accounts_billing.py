"""Accounts, recovery, two-step sign-in, plans, the built-in test checkout and the Stripe webhook, end to end against a
real server on a spare port with its own empty data folder. No network: email is not sent (no RESEND_API_KEY), so the
server hands the links back to the page as it does on your own computer, and Stripe is not called (no STRIPE_SECRET_KEY,
so checkout is the built-in test checkout). The webhook test signs events with a test secret.
Run: python3 -m pytest tests/test_accounts_billing.py"""
import hashlib
import hmac
import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import accounts  # noqa: E402
import billing  # noqa: E402

WH_SECRET = "whsec_test_floodlight"


def _port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture(scope="module")
def server():
    data = tempfile.mkdtemp(prefix="fl-acct-")
    port = _port()
    env = {**os.environ, "FLOODLIGHT_DATA_DIR": data, "FLOODLIGHT_ADMIN": "owner", "FLOODLIGHT_ADMIN_PASSWORD": "ownerpass123",
           "STRIPE_WEBHOOK_SECRET": WH_SECRET}
    for k in ("STRIPE_SECRET_KEY", "RESEND_API_KEY", "DATABASE_URL", "PORT", "RENDER", "FLOODLIGHT_PAYWALL", "DISCORD_BOT_TOKEN"):
        env.pop(k, None)
    p = subprocess.Popen([sys.executable, "server.py", str(port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/plans", timeout=1)
            break
        except Exception:
            time.sleep(0.2)
    yield base, data
    p.terminate()
    p.wait(5)


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, path, body=None, raw=False, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone) Safari/604.1", **(headers or {})})
        try:
            with self.op.open(req, timeout=10) as r:
                b = r.read()
                return r.status, (b if raw else json.loads(b or b"{}"))
        except urllib.error.HTTPError as e:
            b = e.read()
            return e.code, (b if raw else json.loads(b or b"{}"))


def signup(base, name, email=None, **extra):
    c = Client(base)
    body = {"username": name, "password": "password123", "email": email or f"{name}@example.com", "terms": accounts.TERMS_VERSION, "adult": True, **extra}
    st, d = c.call("/api/auth/signup", body)
    return c, st, d


def token_of(link):
    return link.rsplit("/", 1)[-1]


# ---------- sign-up ----------

def test_signup_needs_email_terms_and_age(server):
    base, _ = server
    c = Client(base)
    base_body = {"username": "nobody1", "password": "password123", "terms": accounts.TERMS_VERSION, "adult": True}
    assert c.call("/api/auth/signup", base_body)[0] == 400                                   # no email
    assert c.call("/api/auth/signup", {**base_body, "email": "a@b.co", "terms": "old"})[0] == 400
    assert c.call("/api/auth/signup", {**base_body, "email": "a@b.co", "adult": False})[0] == 400


def test_signup_sends_a_verification_link_and_the_link_confirms(server):
    base, _ = server
    c, st, d = signup(base, "verifyme")
    assert st == 200 and d["user"]["email_verified"] is False and d["user"]["terms"]["ok"]
    link = d["verify"]["devLink"]
    assert "/#/auth/verify/" in link
    st, v = Client(base).call("/api/auth/verify", {"token": token_of(link)})
    assert st == 200 and v["username"] == "verifyme"
    assert c.call("/api/me")[1]["user"]["email_verified"] is True
    assert Client(base).call("/api/auth/verify", {"token": token_of(link)})[0] == 400      # works once


def test_a_confirmed_email_cannot_be_used_twice(server):
    base, _ = server
    _, st, _ = signup(base, "dupe2", email="verifyme@example.com")
    assert st == 409


# ---------- signing in ----------

def test_login_with_username_or_email(server):
    base, _ = server
    for ident in ("verifyme", "VerifyMe@example.com"):
        st, d = Client(base).call("/api/auth/login", {"username": ident, "password": "password123"})
        assert st == 200 and d["user"]["username"] == "verifyme"
    assert Client(base).call("/api/auth/login", {"username": "verifyme", "password": "wrong"})[0] == 401


def test_magic_link_signs_in_once(server):
    base, _ = server
    st, d = Client(base).call("/api/auth/magic", {"email": "verifyme@example.com"})
    assert st == 200 and "devLink" in d
    c = Client(base)
    st, d2 = c.call("/api/auth/magic/use", {"token": token_of(d["devLink"])})
    assert st == 200 and d2["user"]["username"] == "verifyme"
    assert c.call("/api/me")[1]["user"]["username"] == "verifyme"
    assert Client(base).call("/api/auth/magic/use", {"token": token_of(d["devLink"])})[0] == 400


def test_magic_link_answer_does_not_reveal_accounts(server):
    base, _ = server
    st, d = Client(base).call("/api/auth/magic", {"email": "nobody-here@example.com"})
    assert st == 200 and d["message"].startswith("If an account") and "devLink" not in d


def test_password_reset_signs_out_everywhere(server):
    base, _ = server
    c, _, _ = signup(base, "resetme")
    st, d = Client(base).call("/api/auth/forgot", {"login": "resetme"})
    assert st == 200 and "devLink" in d
    assert Client(base).call("/api/auth/reset", {"token": token_of(d["devLink"]), "password": "short"})[0] == 400
    c2 = Client(base)
    st, d2 = c2.call("/api/auth/reset", {"token": token_of(d["devLink"]), "password": "newpassword9"})
    assert st == 200 and d2["user"]["username"] == "resetme" and d2["user"]["email_verified"]
    assert c.call("/api/me")[1]["user"] is None                                              # the old session is gone
    assert Client(base).call("/api/auth/login", {"username": "resetme", "password": "newpassword9"})[0] == 200


def test_username_reminder(server):
    base, _ = server
    st, d = Client(base).call("/api/auth/username", {"email": "resetme@example.com"})
    assert st == 200 and d["devNames"] == ["resetme"]


def test_email_change_needs_confirmation_of_the_new_address(server):
    base, _ = server
    c, _, d = signup(base, "mover")
    Client(base).call("/api/auth/verify", {"token": token_of(d["verify"]["devLink"])})
    assert c.call("/api/me/email", {"email": "new@example.com", "password": "nope"})[0] == 401
    st, d = c.call("/api/me/email", {"email": "new@example.com", "password": "password123"})
    assert st == 200 and d["pending"]
    assert c.call("/api/me")[1]["user"]["email"] == "mover@example.com"                     # unchanged until confirmed
    Client(base).call("/api/auth/verify", {"token": token_of(d["devLink"])})
    me = c.call("/api/me")[1]["user"]
    assert me["email"] == "new@example.com" and me["email_verified"]


# ---------- two-step sign-in ----------

def test_two_step_sign_in(server):
    base, _ = server
    c, _, _ = signup(base, "twostep")
    st, s = c.call("/api/me/2fa/setup", {})
    secret = s["secret"].replace(" ", "")
    assert c.call("/api/me/2fa/enable", {"code": "000000"})[0] == 400
    st, e = c.call("/api/me/2fa/enable", {"code": accounts.totp(secret)})
    assert st == 200 and len(e["recovery"]) == 10
    st, d = Client(base).call("/api/auth/login", {"username": "twostep", "password": "password123"})
    assert st == 200 and d.get("need2fa") and "user" not in d
    c2 = Client(base)
    assert c2.call("/api/auth/2fa", {"ticket": d["ticket"], "code": "123456"})[0] == 401
    st, d2 = c2.call("/api/auth/2fa", {"ticket": d["ticket"], "code": e["recovery"][0]})     # a recovery code works once
    assert st == 200 and d2["user"]["twofa"]
    st, d = Client(base).call("/api/auth/login", {"username": "twostep", "password": "password123"})
    assert Client(base).call("/api/auth/2fa", {"ticket": d["ticket"], "code": e["recovery"][0]})[0] == 401


# ---------- devices, export, delete ----------

def test_sessions_list_and_sign_out_others(server):
    base, _ = server
    a, _, _ = signup(base, "devices")
    b = Client(base)
    b.call("/api/auth/login", {"username": "devices", "password": "password123"})
    st, d = a.call("/api/me/sessions")
    assert st == 200 and len(d["sessions"]) == 2 and d["sessions"][0]["current"] and "iPhone" in d["sessions"][0]["device"]
    other = [s for s in d["sessions"] if not s["current"]][0]
    st, d = a.call("/api/me/sessions/revoke", {"id": other["id"]})
    assert st == 200 and len(d["sessions"]) == 1
    assert b.call("/api/me")[1]["user"] is None


def test_export_has_the_account_and_no_secrets(server):
    base, _ = server
    c, _, _ = signup(base, "exporter")
    st, raw = c.call("/api/me/export", raw=True)
    d = json.loads(raw)
    assert st == 200 and d["account"]["username"] == "exporter"
    assert "hash" not in d["account"] and "salt" not in d["account"]


def test_delete_needs_the_password_and_removes_everything(server):
    base, _ = server
    c, _, _ = signup(base, "leaver")
    assert c.call("/api/me/delete", {"password": "nope"})[0] == 401
    assert c.call("/api/me/delete", {"password": "password123"})[0] == 200
    assert Client(base).call("/api/auth/login", {"username": "leaver", "password": "password123"})[0] == 401


def test_terms_acceptance_is_recorded(server):
    base, _ = server
    c, _, _ = signup(base, "termsy")
    assert c.call("/api/me/terms", {"version": "1999-01-01"})[0] == 400
    assert c.call("/api/me/terms", {"version": accounts.TERMS_VERSION})[0] == 200


# ---------- plans ----------

def test_plans_are_public_with_the_agreed_fields(server):
    base, _ = server
    st, d = Client(base).call("/api/plans")
    ids = [p["id"] for p in d["plans"]]
    assert ids == ["free", "plus", "plus_annual", "group"]
    plus = d["plans"][1]
    assert plus["price_cents"] == 499 and plus["interval"] == "month" and plus["trial_days"] == 7
    assert d["plans"][2]["price_cents"] == 2999 and d["plans"][3]["price_cents"] == 999


def test_checkout_needs_a_confirmed_email(server):
    base, _ = server
    c, _, _ = signup(base, "unconfirmed")
    st, d = c.call("/api/billing/checkout", {"plan": "plus"})
    assert st == 400 and d["need"] == "verify"


def _verified(base, name):
    c, _, d = signup(base, name)
    Client(base).call("/api/auth/verify", {"token": token_of(d["verify"]["devLink"])})
    return c


def test_test_checkout_trial_cancel_and_reactivate(server):
    base, _ = server
    c = _verified(base, "buyer")
    st, d = c.call("/api/billing/checkout", {"plan": "plus"})
    assert st == 200 and d["done"] and d["trial"]
    p = d["plan"]
    assert p["effective"] == "plus" and p["status"] == "trial" and p["trial_ends"] and p["payment_method"]["last4"] == "4242"
    st, d = c.call("/api/billing/cancel", {"reason": "too_expensive"})
    assert st == 200 and d["plan"]["cancel_at_period_end"] and d["plan"]["effective"] == "plus"   # lasts to the end of the trial
    st, d = c.call("/api/billing/reactivate", {})
    assert st == 200 and not d["plan"]["cancel_at_period_end"]
    st, d = c.call("/api/me/billing")
    assert st == 200 and d["invoices"] and d["invoices"][0]["amount_cents"] == 0
    st, d = c.call("/api/billing/checkout", {"plan": "plus_annual"})                    # switch plans
    assert st == 200 and d["plan"]["plan"] == "plus_annual"


def test_second_trial_is_not_offered(server):
    base, _ = server
    c = _verified(base, "trialtwice")
    c.call("/api/billing/checkout", {"plan": "plus"})
    me = c.call("/api/me")[1]["user"]
    assert me["plan"]["trial_available"] is False


def test_gift_code_buys_and_redeems_once(server):
    base, _ = server
    giver = _verified(base, "giver")
    st, d = giver.call("/api/billing/gift", {"gift": "gift_1m", "to": "friend@example.com"})
    assert st == 200 and d["code"].startswith("FL-")
    taker = _verified(base, "taker")
    st, r = taker.call("/api/billing/redeem", {"code": d["code"].lower()})
    assert st == 200 and r["plan"]["effective"] == "plus" and r["plan"]["comp_until"]
    assert _verified(base, "taker2").call("/api/billing/redeem", {"code": d["code"]})[0] == 404


def test_group_seats(server):
    base, _ = server
    boss = _verified(base, "groupboss")
    boss.call("/api/billing/checkout", {"plan": "group"})
    mate = _verified(base, "groupmate")
    assert mate.call("/api/me")[1]["user"]["plan"]["effective"] == "free"
    st, d = boss.call("/api/billing/group", {"action": "add", "who": "groupmate"})
    assert st == 200 and d["plan"]["group_members"] == ["groupmate"]
    assert mate.call("/api/me")[1]["user"]["plan"]["effective"] == "group"
    mate.call("/api/billing/group", {"action": "leave"})
    assert mate.call("/api/me")[1]["user"]["plan"]["effective"] == "free"


def _owner(base):
    c = Client(base)
    assert c.call("/api/auth/login", {"username": "owner", "password": "ownerpass123"})[0] == 200
    return c


def test_limits_only_bite_when_the_owner_turns_them_on(server):
    base, _ = server
    free = _verified(base, "freebie")
    assert free.call("/api/me")[1]["user"]["plan"]["features"]["line_history"] is True
    assert free.call("/api/me/prefs", {"boards": [{"id": i} for i in range(3)]})[0] == 200      # limits off: anything goes
    owner = _owner(base)
    assert free.call("/api/admin/billing", {"action": "enforce", "on": True})[0] == 403
    st, s = owner.call("/api/admin/billing", {"action": "enforce", "on": True})
    assert st == 200 and s["enforced"]
    me = free.call("/api/me")[1]["user"]["plan"]
    assert me["features"]["line_history"] is False and me["limits"]["lab_search"] == 5
    for i in range(5):
        assert free.call("/api/plan/use", {"what": "lab_search", "item": f"p{i}"})[0] == 200
    assert free.call("/api/plan/use", {"what": "lab_search", "item": "p0"})[0] == 200          # the same player again is free
    st, d = free.call("/api/plan/use", {"what": "lab_search", "item": "p9"})
    assert st == 402 and d["upgrade"] == "lab_unlimited"
    assert free.call("/api/me/prefs", {"boards": [{"id": i} for i in range(4)]})[0] == 402      # can't grow past the limit
    assert free.call("/api/me/prefs", {"boards": [{"id": 1}]})[0] == 200                         # shrinking is always fine
    owner.call("/api/admin/billing", {"action": "comp", "username": "freebie", "months": 1})
    assert free.call("/api/plan/use", {"what": "lab_search", "item": "p10"})[0] == 200          # free Plus from the owner
    owner.call("/api/admin/billing", {"action": "enforce", "on": False})


def test_owner_summary_counts_test_checkouts_apart(server):
    base, _ = server
    st, s = _owner(base).call("/api/admin/billing/summary")
    assert st == 200 and s["mode"] == "demo" and s["mrr_cents"] == 0 and s["demo_accounts"] >= 1


def test_pretty_paths_open_the_page(server):
    base, _ = server
    req = urllib.request.Request(base + "/pricing")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    try:
        urllib.request.build_opener(NoRedirect).open(req, timeout=5)
        assert False, "expected a redirect"
    except urllib.error.HTTPError as e:
        assert e.code == 302 and e.headers["Location"] == "/#/pricing"


# ---------- webhook ----------

def _signed(payload, secret=WH_SECRET, t=None):
    t = t or int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return {"Stripe-Signature": f"t={t},v1={sig}", "Content-Type": "application/json"}


def test_webhook_rejects_bad_signatures_and_applies_good_ones(server):
    base, _ = server
    c = _verified(base, "hooked")
    now = int(time.time())
    sub = {"id": "sub_test1", "object": "subscription", "customer": "cus_test1", "status": "active", "cancel_at_period_end": False,
           "metadata": {"username": "hooked", "plan": "plus"},
           "items": {"data": [{"id": "si_1", "current_period_end": now + 30 * 86400, "price": {"id": "price_1", "unit_amount": 499, "recurring": {"interval": "month"}, "lookup_key": "floodlight_plus_month"}}]}}
    ev = json.dumps({"id": "evt_1", "type": "customer.subscription.updated", "data": {"object": sub}}).encode()
    req = urllib.request.Request(base + "/api/billing/webhook", data=ev, headers=_signed(ev, "whsec_wrong"))
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(req, timeout=5)
    req = urllib.request.Request(base + "/api/billing/webhook", data=ev, headers=_signed(ev))
    assert json.loads(urllib.request.urlopen(req, timeout=5).read())["ok"]
    p = c.call("/api/me")[1]["user"]["plan"]
    assert p["effective"] == "plus" and p["status"] == "active" and p["provider"] == "stripe"
    req = urllib.request.Request(base + "/api/billing/webhook", data=ev, headers=_signed(ev))
    assert json.loads(urllib.request.urlopen(req, timeout=5).read()).get("duplicate")       # the same event twice is ignored
    fail = json.dumps({"id": "evt_2", "type": "invoice.payment_failed", "data": {"object": {"customer": "cus_test1", "subscription": "sub_test1"}}}).encode()
    urllib.request.urlopen(urllib.request.Request(base + "/api/billing/webhook", data=fail, headers=_signed(fail)), timeout=5)
    p = c.call("/api/me")[1]["user"]["plan"]
    assert p["status"] == "past_due" and p["grace_until"] and p["effective"] == "plus"       # still Plus during the grace period


def test_old_signatures_are_refused():
    assert not billing.verify_signature(b"{}", "t=1,v1=abc", WH_SECRET)


# ---------- plan rules without a server ----------

def test_effective_plan_rules():
    users = {}
    billing.D.update(users=users, rank=lambda u: "member", gated=True)
    now = time.time()
    u = {"username": "x", "plan": "plus", "plan_status": "canceled", "current_period_end": now + 3600}
    assert billing.effective(u, now) == "plus"                       # cancelled, but paid to the end of the period
    u["current_period_end"] = now - 10
    assert billing.effective(u, now) == "free"
    u.update(plan_status="past_due", grace_until=now - 1)
    assert billing.effective(u, now) == "free"                       # grace period over
    u.update(comp_until=now + 99)
    assert billing.effective(u, now) == "plus"


def test_totp_matches_rfc_6238():
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"                       # "12345678901234567890"
    assert accounts.totp(secret, 59, digits=8) == "94287082"
    assert accounts.totp(secret, 1111111109, digits=8) == "07081804"
