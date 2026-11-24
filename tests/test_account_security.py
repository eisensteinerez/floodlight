"""Account security end to end against a real server on a spare port with its own data folder: scrypt password hashes
(and the upgrade of an old PBKDF2 hash at the next sign-in), failed-login limits, rate limits on data reports and board
sharing, and an account deletion that also takes down the member's shared board links and email links.
Run: python3 -m pytest tests/test_account_security.py"""
import hashlib
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.request

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_accounts_billing import Client, ROOT, _port, signup, token_of  # noqa: E402


def _legacy(name, password):
    salt = secrets.token_hex(16)
    return {"username": name, "salt": salt, "hash": hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex(),
            "created": int(time.time()) - 86400, "role": "research", "rank": "member", "status": "active", "off": [], "email": f"{name}@example.com",
            "email_verified": True, "terms": {"version": "2026-11-23", "at": 1}, "prefs": {"display": name}}


@pytest.fixture(scope="module")
def server():
    data = tempfile.mkdtemp(prefix="fl-sec-")
    with open(os.path.join(data, "users.json"), "w") as f:
        json.dump({"oldtimer": _legacy("oldtimer", "oldpassword1")}, f)
    port = _port()
    env = {**os.environ, "FLOODLIGHT_DATA_DIR": data, "FLOODLIGHT_ADMIN": "owner", "FLOODLIGHT_ADMIN_PASSWORD": "ownerpass123"}
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


def users_file(data):
    with open(os.path.join(data, "users.json")) as f:
        return json.load(f)


def test_new_passwords_are_scrypt_hashes(server):
    base, data = server
    signup(base, "fresh1")
    u = users_file(data)["fresh1"]
    assert u["algo"] == "scrypt" and len(u["hash"]) == 64 and "password123" not in json.dumps(u)


def test_an_old_pbkdf2_hash_still_signs_in_and_is_upgraded(server):
    base, data = server
    c = Client(base)
    assert c.call("/api/auth/login", {"username": "oldtimer", "password": "oldpassword1"})[0] == 200
    u = users_file(data)["oldtimer"]
    assert u["algo"] == "scrypt"
    c2 = Client(base)
    assert c2.call("/api/auth/login", {"username": "oldtimer", "password": "oldpassword1"})[0] == 200     # the new hash works
    assert Client(base).call("/api/auth/login", {"username": "oldtimer", "password": "wrong-one"})[0] == 401


def test_failed_logins_are_limited_per_account(server):
    base, _ = server
    signup(base, "victim")
    c = Client(base)
    for _ in range(10):
        assert c.call("/api/auth/login", {"username": "victim", "password": "guess-guess"})[0] == 401
    st, d = c.call("/api/auth/login", {"username": "victim", "password": "password123"})
    assert st == 429 and "Forgot password" in d["error"]
    assert Client(base).call("/api/auth/login", {"username": "fresh1", "password": "password123"})[0] == 200   # others unaffected


def test_data_reports_are_rate_limited(server):
    base, _ = server
    c, _, _ = signup(base, "reporter")
    codes = [c.call("/api/data-report", {"text": f"Wrong line number {i}", "marketId": f"m{i}"})[0] for i in range(13)]
    assert codes[:12] == [200] * 12 and codes[12] == 429


def test_deleting_an_account_takes_down_its_shared_boards_and_links(server):
    base, data = server
    c, _, d = signup(base, "leaver")
    st, sh = c.call("/api/boards/share", {"board": {"id": "b1", "name": "Tonight", "items": [{"kind": "line", "label": "Player over 20.5"}]}})
    assert st == 200
    assert Client(base).call(f"/api/boards/shared?id={sh['id']}")[0] == 200
    exp = c.call("/api/me/export")[1]
    assert exp["shared_board_links"][0]["id"] == sh["id"] and "competitions" in exp and "support_tickets" in exp
    assert "algo" not in exp["account"] and "hash" not in exp["account"]
    assert c.call("/api/me/delete", {"password": "password123"})[0] == 200
    assert Client(base).call(f"/api/boards/shared?id={sh['id']}")[0] == 404
    assert "leaver" not in users_file(data)
    link = d["verify"].get("devLink")                     # the email confirmation link sent at sign-up no longer works
    assert link and Client(base).call("/api/auth/verify", {"token": token_of(link)})[0] == 400
