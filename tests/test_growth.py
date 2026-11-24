"""Usage numbers, support tickets, referrals and the owner dashboard (Erez's plan items 11, 14, 15 and 20).

- analytics: only allowed events count, nothing identifying is kept, a visitor's pre-sign-up steps join their account,
  the funnel, retention, time to first useful action and cancellation reasons come out right.
- support: signed-out visitors can only ask about access, billing or a question and must leave an email; a data report
  keeps the market details; members see only their own tickets; staff answers mark a ticket answered.
- referrals: a friend counts after real use or a payment; same browser, same network or a burst of sign-ups only count
  after a payment; three counted friends earn one month; your own code is refused.
- ownerstats: money numbers stay out until paid plans write plan fields, then MRR, ARR, churn and trial-to-paid add up.
Run: python3 -m pytest tests/test_growth.py"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import analytics as A  # noqa: E402
import ownerstats as O  # noqa: E402
import referrals as R  # noqa: E402
import ratelimit  # noqa: E402
import support as SP  # noqa: E402

DAY = 86400
NOW = 1_795_000_000   # a fixed moment, a Tuesday in November 2026


def fresh(tmp):
    A.S.update({"salt": "", "days": {}, "actors": {}, "users": {}, "cancel": []})
    A._rate.clear()
    A.init(os.path.join(tmp, "analytics.json"))
    R.R.update({"salt": "", "codes": {}, "refs": {}, "nets": {}})
    R.init(os.path.join(tmp, "referrals.json"))
    SP.T.update({"seq": 10400, "tickets": []})
    ratelimit.reset()
    SP.init(os.path.join(tmp, "support.json"))


def setup_function(_):
    os.environ.pop("DATABASE_URL", None)
    fresh(tempfile.mkdtemp())


# ---------- analytics ----------

def test_only_allowed_events_count_and_no_raw_ids_are_kept():
    assert A.event("search", {"kind": "lab"}, vid="a" * 24, ts=NOW)
    assert not A.event("steal_cookies", {}, vid="a" * 24, ts=NOW)
    day = A.S["days"][A.day_key(NOW)]
    assert day["ev"] == {"search": 1}
    assert "a" * 24 not in str(A.S["actors"])          # only a salted hash of the browser id
    assert all(len(k) == 20 for k in A.S["actors"])


def test_a_visitors_landing_visit_joins_their_account():
    vid = "b" * 24
    A.event("landing_view", {}, vid=vid, ts=NOW - 600)
    A.event("signup", {}, user="dana", ts=NOW - 300)
    A.event("search", {"kind": "lab"}, user="dana", vid=vid, ts=NOW - 60)
    steps = A.S["users"]["dana"]["steps"]
    assert steps["landing"] == NOW - 600 and steps["signup"] == NOW - 300 and steps["first_search"] == NOW - 60
    f = A.funnel(30, now=NOW)
    counts = {s["step"]: s["count"] for s in f["steps"]}
    assert f["journeys"] == 1 and counts["landing"] == 1 and counts["signup"] == 1 and counts["first_search"] == 1
    assert A.first_useful_minutes() == 4.0


def test_empty_and_failed_searches_players_and_slow_pages_are_counted():
    A.event("search", {"empty": True}, user="dana", ts=NOW)
    A.event("search", {"failed": True}, user="dana", ts=NOW)
    A.event("player_open", {"sport": "nba", "player": "Sample Guard"}, user="dana", ts=NOW)
    A.event("slow_page", {"name": "lab", "device": "phone", "ms": 4100}, user="dana", ts=NOW)
    u = A.usage(7, now=NOW)
    assert (u["searches"], u["searchEmpty"], u["searchFailed"], u["playersOpened"]) == (2, 1, 1, 1)
    assert u["topPlayers"] == [["nba:Sample Guard", 1]] and u["topSports"] == [["nba", 1]]
    assert u["slowPages"] == [{"page": "lab", "device": "phone", "count": 1}]


def test_retention_counts_only_accounts_old_enough():
    A.active("old", NOW - 40 * DAY)
    A.active("old", NOW - 39 * DAY)          # came back the next day
    A.active("old", NOW - 32 * DAY)          # and in days 7 to 13
    A.active("new", NOW)
    r = A.retention({"old": NOW - 40 * DAY, "new": NOW}, now=NOW)
    assert r["d1"] == {"cohort": 1, "returned": 1, "rate": 100.0}
    assert r["d7"]["returned"] == 1 and r["d30"]["returned"] == 0 and r["d30"]["cohort"] == 1


def test_cancellation_reasons_are_tallied_and_unknown_ones_become_other():
    A.event("cancel", {"reason": "too_expensive", "note": "too much for me"}, user="a", ts=NOW)
    A.event("cancel", {"reason": "made_up"}, user="b", ts=NOW)
    c = A.cancel_reasons(90, now=NOW)
    tally = {r["reason"]: r["count"] for r in c["reasons"]}
    assert c["total"] == 2 and tally["too_expensive"] == 1 and tally["other"] == 1
    assert c["notes"][0]["note"] == "too much for me"


def test_one_browser_cannot_flood_the_counts():
    for _ in range(3005):
        A.event("page", {"name": "home"}, vid="c" * 24, ts=NOW)
    assert A.S["days"][A.day_key(NOW)]["ev"]["page"] == 3000


def test_saving_writes_a_file_that_loads_back():
    A.event("search", {}, user="dana", ts=NOW)
    A.save(force=True)
    kept = dict(A.S)
    A.S.update({"salt": "", "days": {}, "actors": {}, "users": {}, "cancel": []})
    A.init(A.FILE)
    assert A.S["users"]["dana"]["steps"] == kept["users"]["dana"]["steps"]


# ---------- support ----------

def test_signed_out_visitors_need_an_email_and_a_safe_kind():
    assert SP.create({"kind": "bug", "text": "the page is broken somewhere", "email": "a@b.co"})[0] == 401
    assert SP.create({"kind": "account", "text": "I forgot my password, user dana"})[0] == 400
    status, out = SP.create({"kind": "account", "text": "I forgot my password, user dana", "email": "dana@example.com"})
    assert status == 200 and out["ticket"]["id"].startswith("FL-") and out["ticket"]["replyDays"] == 1


def test_a_data_report_keeps_the_market_and_device_details():
    ctx = {"marketId": "pp:123", "player": "Sample Guard", "provider": "PrizePicks", "verifiedAt": "2026-11-23T18:00:00Z",
           "browser": "Chrome 131", "device": "phone", "page": "/#/predictions", "evil": "<script>"}
    status, out = SP.create({"kind": "data", "text": "Wrong opponent on this line", "context": ctx}, user="dana", display="Dana")
    t = out["ticket"]
    assert status == 200 and t["context"]["marketId"] == "pp:123" and t["context"]["provider"] == "PrizePicks"
    assert "evil" not in t["context"] and t["subject"].startswith("Sample Guard")


def test_members_see_only_their_tickets_and_staff_answers_mark_them_answered():
    _, a = SP.create({"kind": "question", "text": "How do boards work exactly?"}, user="dana")
    SP.create({"kind": "question", "text": "Someone else's question here"}, user="eli")
    assert [t["id"] for t in SP.mine("dana")] == [a["ticket"]["id"]]
    status, out = SP.staff_action({"id": a["ticket"]["id"], "action": "reply", "text": "Open the Lab, then Boards."}, "Erez")
    assert status == 200 and out["ticket"]["status"] == "answered"
    status, out = SP.member_reply("dana", {"id": a["ticket"]["id"], "text": "Thanks, one more thing"})
    assert out["ticket"]["status"] == "open" and len(out["ticket"]["messages"]) == 3
    assert SP.member_reply("eli", {"id": a["ticket"]["id"], "text": "not mine"})[0] == 404


def test_the_robot_field_is_quietly_ignored_and_signed_out_rate_is_limited():
    before = len(SP.T["tickets"])
    assert SP.create({"kind": "question", "text": "buy cheap things now", "email": "x@y.co", "website": "spam.example"})[0] == 200
    assert len(SP.T["tickets"]) == before
    assert all(SP.signed_out_allowed("net1", now=NOW) for _ in range(5)) and not SP.signed_out_allowed("net1", now=NOW)


# ---------- referrals ----------

def users_with(*names, age_days=10, **extra):
    return {n: {"username": n, "created": NOW - age_days * DAY, "prefs": {"display": n.title()}, **extra} for n in names}


def active_member(n, days=3, actions=5):
    def act(name):
        if name != n:
            return {"days": [], "week": {}, "vids": []}
        return {"days": list(range(days)), "week": {"2026-W47": {"search": actions}}, "vids": []}
    return act


def test_your_own_code_and_late_claims_are_refused():
    code = R.code_for("erez")
    assert R.claim("erez", code, NOW - DAY, now=NOW) == (False, "You can't use your own invite code.")
    assert not R.claim("dana", code, NOW - 3 * DAY, now=NOW)[0]
    assert R.claim("dana", code, NOW - DAY, now=NOW)[0]
    assert not R.claim("dana", code, NOW - DAY, now=NOW)[0]   # only once


def test_a_friend_counts_after_real_use_and_three_earn_a_month():
    code = R.code_for("erez")
    users = users_with("erez", "a", "b", "c")
    for f in ("a", "b", "c"):
        assert R.claim(f, code, NOW - DAY, now=NOW - DAY + 60)[0]
    lazy = lambda name: {"days": [1], "week": {}, "vids": []}   # noqa: E731
    assert R.evaluate(users, lazy, now=NOW) == []
    busy = lambda name: {"days": [1, 2, 3], "week": {"w": {"search": 3, "player_open": 2}}, "vids": []}   # noqa: E731
    assert R.evaluate(users, busy, now=NOW) == ["erez"]
    assert users["erez"]["ref_credit_months"] == 1 and users["erez"]["ref_months_earned"] == 1
    assert R.evaluate(users, busy, now=NOW) == []                 # not paid twice
    s = R.summary("erez", users, busy, now=NOW)
    assert s["counting"] == 3 and s["monthsEarned"] == 1 and s["toNext"] == 3


def test_same_browser_or_network_only_counts_after_a_payment():
    code = R.code_for("erez", addr="203.0.113.7")
    users = users_with("erez", "sock", "twin")
    assert R.claim("sock", code, NOW - DAY, addr="203.0.113.99", now=NOW)[0]          # same /24 network
    assert R.claim("twin", code, NOW - DAY, friend_vids=["v1"], referrer_vids=["v1"], now=NOW)[0]
    assert R.R["refs"]["sock"]["flags"] == ["same_network"] and R.R["refs"]["twin"]["flags"] == ["same_device"]
    busy = lambda name: {"days": [1, 2, 3, 4], "week": {"w": {"search": 9}}, "vids": []}   # noqa: E731
    R.evaluate(users, busy, now=NOW)
    assert not R.R["refs"]["sock"]["qualified"]
    users["sock"].update(plan="plus", plan_status="active")
    R.evaluate(users, busy, now=NOW)
    assert R.R["refs"]["sock"]["via"] == "payment"
    assert "203.0.113" not in str(R.R)                             # the network is stored only as a hash


def test_a_burst_of_signups_through_one_link_is_held_back():
    code = R.code_for("erez")
    for i in range(7):
        R.claim(f"f{i}", code, NOW - 60, now=NOW + i)
    flagged = [f for f, r in R.R["refs"].items() if "burst" in r["flags"]]
    assert flagged == ["f5", "f6"]


# ---------- the owner dashboard ----------

def test_money_stays_out_until_paid_plans_write_plan_fields():
    users = users_with("a", "b")
    b = O.business(users, now=NOW)
    assert b["billing"] is False and "money" not in b and b["users"]["total"] == 2


def test_mrr_arr_churn_and_trial_to_paid():
    users = users_with("m", "y", "t", "c", "f")
    users["m"].update(plan="plus", plan_status="active", price_cents=499, interval="month", trial_started=NOW - 20 * DAY, paid_since=NOW - 13 * DAY)
    users["y"].update(plan="plus_annual", plan_status="active", price_cents=2999, interval="year")
    users["t"].update(plan="plus", plan_status="trial", trial_started=NOW - DAY)
    users["c"].update(plan="plus", plan_status="canceled", canceled_at=NOW - 5 * DAY, trial_started=NOW - 40 * DAY)
    users["f"].update(plan="free")
    m = O.business(users, now=NOW)["money"]
    assert m["paid"] == 2 and m["trial"] == 1 and m["cancellations30"] == 1
    assert m["mrr"] == round(4.99 + 29.99 / 12, 2) and m["arr"] == round((4.99 + 29.99 / 12) * 12, 2)
    assert m["churn"] == round(1 / 3 * 100, 1)
    assert m["trialToPaid"] == 50.0          # of two finished trials, one became paid
    assert m["conversion"] == 40.0 and m["arppu"] == round((4.99 + 29.99 / 12) / 2, 2)


def test_product_counts_boards_follows_and_parlays():
    users = users_with("a")
    users["a"]["prefs"].update(boards=[{"n": 1}, {"n": 2}], follows=[{"x": 1}])
    p = O.product(users, {"a": [{}, {}, {}]}, days=7)
    assert p["saved"] == {"boards": 2, "follows": 1, "slips": 0, "cards": 3}
    assert len(p["usage"]["series"]) == 7


# ---------- the journey's conversion rates, feature gates and revenue per active member (PR: onboarding and growth) ----------

def test_conversion_rates_follow_each_journey_from_its_first_step():
    # one visitor sees the landing page, opens sign-up and makes an account; another only sees the landing page
    A.event("landing_view", {}, vid="c" * 24, ts=NOW - 900)
    A.event("signup_start", {}, vid="c" * 24, ts=NOW - 800)
    A.event("signup", {}, user="ana", ts=NOW - 700)
    A.event("session", {}, user="ana", vid="c" * 24, ts=NOW - 650)
    A.event("landing_view", {}, vid="d" * 24, ts=NOW - 600)
    # a member saw the upgrade page, then started a trial; another saw it and left
    A.event("upgrade_view", {}, user="ana", ts=NOW - 500)
    A.event("trial_start", {}, user="ana", ts=NOW - 400)
    A.event("signup", {}, user="ben", ts=NOW - 300)
    A.event("upgrade_view", {}, user="ben", ts=NOW - 200)
    r = A.funnel(30, now=NOW)["rates"]
    assert r["landing"] == {"of": 2, "n": 1, "rate": 50.0}
    assert r["signup"] == {"of": 1, "n": 1, "rate": 100.0}
    assert r["upgrade"] == {"of": 2, "n": 1, "rate": 50.0}
    steps = [s["step"] for s in A.funnel(30, now=NOW)["steps"]]
    assert steps.index("landing") < steps.index("signup_start") < steps.index("signup")


def test_no_rate_before_anyone_reaches_the_first_step():
    r = A.funnel(30, now=NOW)["rates"]
    assert all(v["rate"] is None and v["of"] == 0 for v in r.values())


def test_feature_gates_count_by_feature_and_ignore_junk():
    for f in ("advanced_filters", "advanced_filters", "line_history", "<script>", ""):
        A.event("gate", {"feature": f}, user="ana", ts=NOW - 60)
    u = A.usage(7, now=NOW)
    assert u["gates"] == 5                       # every encounter is an event
    assert dict(u["topGates"]) == {"advanced_filters": 2, "line_history": 1}   # only real feature keys are named


def test_onboarding_finish_and_skip_are_counted_apart():
    A.event("signup", {}, user="ana", ts=NOW - 900)
    A.event("onboarding_done", {"step": 6}, user="ana", ts=NOW - 600)
    A.event("signup", {}, user="ben", ts=NOW - 500)
    A.event("onboarding_skip", {"step": 1}, user="ben", ts=NOW - 400)
    rate = A.onboarding_rate()
    assert rate == {"signedUp": 2, "finished": 1, "rate": 50.0}
    assert A.usage(7, now=NOW)["onboardingSkipped"] == 1


def test_revenue_per_active_member_uses_accounts_active_in_30_days():
    users = users_with("m", "f", "old")
    users["m"].update(plan="plus", plan_status="active", price_cents=499, interval="month", seen=NOW - DAY)
    users["f"].update(plan="free", seen=NOW - 2 * DAY)
    users["old"].update(created=NOW - 90 * DAY, seen=NOW - 60 * DAY)
    m = O.business(users, now=NOW)["money"]
    assert m["arpu"] == round(4.99 / 2, 2) and m["arppu"] == 4.99
    assert dict(m["byPlan"]) == {"plus": 1}
