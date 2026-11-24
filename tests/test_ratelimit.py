"""The shared rate limiter (ratelimit.py): sliding windows per key, several keys counted together or not at all.
Run: python3 -m pytest tests/test_ratelimit.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ratelimit  # noqa: E402


def test_rate_limits_count_per_key_and_forget_after_the_window():
    ratelimit.reset()
    now = 1_000_000.0
    assert all(ratelimit.take("signup", "ip:a", now=now) for _ in range(5))
    assert not ratelimit.take("signup", "ip:a", now=now) and ratelimit.take("signup", "ip:b", now=now)
    assert ratelimit.take("signup", "ip:a", now=now + 3601)


def test_several_keys_count_together_or_not_at_all():
    ratelimit.reset()
    for _ in range(3):
        assert ratelimit.take("email", "m:x@y.co", "ip:1", limit=3)
    assert not ratelimit.take("email", "m:other@y.co", "ip:1", limit=3)    # the visitor is full
    assert ratelimit.take("email", "m:other@y.co", "ip:2", limit=3)        # and the refused try counted nothing


def test_failed_logins_lock_and_a_good_password_clears():
    ratelimit.reset()
    for _ in range(10):
        ratelimit.note("login_user", "u:bob")
    assert ratelimit.full("login_user", "u:bob") and not ratelimit.full("login_user", "u:amy")
    ratelimit.clear("login_user", "u:bob")
    assert not ratelimit.full("login_user", "u:bob")
