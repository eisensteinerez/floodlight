"""Floodlight account security: verified email, sign-in links, password and username recovery, email changes,
two-step sign-in (an authenticator app), the list of signed-in devices, data export and the terms each member accepted.

Links sent by email carry a one-time token. Only its SHA-256 is stored (auth.json), so a copy of the file can't be used
to sign in. Tokens expire (sign-in link 15 minutes, reset 1 hour, email confirmation 3 days) and work once.

Email goes out through Resend (RESEND_API_KEY, MAIL_FROM). Without a key nothing is sent: on your own computer the link
is printed in the server log and returned to the page so the flow can be tried; on the hosted site the page says email
isn't set up and an owner can see the last messages under Account > Owner tools (they hold sign-in links, so only owners).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import struct
import threading
import time
import urllib.error
import urllib.request

import ratelimit

TERMS_VERSION = "2026-11-23"           # change this when the Terms, Privacy Policy or Subscription Terms change materially
TTL = {"verify": 3 * 86400, "magic": 15 * 60, "reset": 3600, "email_change": 86400}
EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}")
D = {}                                  # setup(): users, save, lock, storage, file, site, hosted, new_session, hash, public
_st = {}                                # {"tokens": {sha: {...}}, "outbox": [...], "recovery": {}}
_lock = threading.Lock()
_tickets = {}                           # two-step sign-in in progress: ticket -> {"user", "exp", "via"}


def setup(**kw):
    D.update(kw)
    got = D["storage"].load(D["file"], {})
    _st.clear()
    _st.update(got if isinstance(got, dict) else {})
    for k, v in (("tokens", {}), ("outbox", [])):
        if not isinstance(_st.get(k), type(v)):
            _st[k] = v


def state_blob():
    return _st


def absorb_state(got):
    if isinstance(got, dict) and got:
        _st.update(got)
        _save()


def _save():
    now = time.time()
    for k in [k for k, v in _st["tokens"].items() if v.get("exp", 0) < now - 86400]:
        _st["tokens"].pop(k, None)
    D["storage"].save(D["file"], _st)


def _sha(t):
    return hashlib.sha256(t.encode()).hexdigest()


def norm_email(e):
    e = str(e or "").strip()
    return e.lower() if EMAIL_RE.fullmatch(e) else ""


def mask(e):
    name, _, dom = (e or "").partition("@")
    return (name[:2] + "•" * max(1, len(name) - 2) + "@" + dom) if dom else ""


# ---------- sending email ----------

def mail_ready():
    return bool(os.environ.get("RESEND_API_KEY"))


def send(to, subject, text):
    """Send one email. Returns True when a provider accepted it."""
    if not to:
        return False
    html = "<div style=\"font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:520px\">" + "".join(
        f"<p>{_link(line)}</p>" for line in text.strip().split("\n\n")) + "<p style=\"color:#666;font-size:13px\">Floodlight · sports research, not betting advice.</p></div>"
    with _lock:
        _st["outbox"].insert(0, {"at": int(time.time()), "to": to, "subject": subject, "text": text[:4000]})
        del _st["outbox"][30:]
        _save()
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print(f"mail (not sent, no RESEND_API_KEY) to {to}: {subject}\n{text}")
        return False
    body = json.dumps({"from": os.environ.get("MAIL_FROM") or "Floodlight <onboarding@resend.dev>", "to": [to], "subject": subject,
                       "text": text + "\n\nFloodlight · sports research, not betting advice.", "html": html}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": "floodlight"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except (urllib.error.URLError, OSError) as e:
        print(f"mail: couldn't send '{subject}' ({type(e).__name__}: {getattr(e, 'code', '')})")
        return False


def _link(line):
    import html as h
    out = h.escape(line).replace("\n", "<br>")
    return re.sub(r"(https?://[^\s<]+)", r'<a href="\1">\1</a>', out)


def allowed(*keys, per_hour=5):
    """Rate limit for anything that sends email: at most per_hour for each address and each visitor (ratelimit.py)."""
    return ratelimit.take("email", *keys, limit=per_hour)


# ---------- one-time tokens ----------

def make_token(kind, user_key, email="", extra=None):
    t = secrets.token_urlsafe(32)
    with _lock:
        for k in [k for k, v in _st["tokens"].items() if v.get("user") == user_key and v.get("kind") == kind]:
            _st["tokens"].pop(k, None)        # a new link replaces the last one of the same kind
        _st["tokens"][_sha(t)] = {"kind": kind, "user": user_key, "email": email, "exp": time.time() + TTL[kind], **(extra or {})}
        _save()
    return t


def take_token(kind, token, peek=False):
    rec = _st["tokens"].get(_sha(str(token or "")))
    if not rec or rec.get("kind") != kind or rec.get("exp", 0) < time.time():
        return None
    if not peek:
        with _lock:
            _st["tokens"].pop(_sha(str(token)), None)
            _save()
    return rec


def _dev(link):
    """On your own computer with no email provider, the page gets the link so the flow can be tried."""
    return {} if D["hosted"]() or mail_ready() else {"devLink": link}


def _url(path):
    return D["site"]() + path


# ---------- finding accounts ----------

def by_email(email, verified_only=False):
    e = norm_email(email)
    if not e:
        return []
    hits = [u for u in D["users"].values() if (u.get("email") or "").lower() == e]
    ver = [u for u in hits if u.get("email_verified")]
    return ver if (ver or verified_only) else hits


def find_login(ident):
    """A username, or an email address when exactly one account (preferably confirmed) uses it."""
    ident = str(ident or "").strip()
    u = D["users"].get(ident.lower())
    if u:
        return u
    hits = by_email(ident)
    return hits[0] if len(hits) == 1 else None


def email_taken(email, me=None):
    return any(u is not me for u in by_email(email, verified_only=True))


def _claim(u, email):
    """An address now confirmed for u: unconfirmed claims of it on other accounts are dropped."""
    for o in D["users"].values():
        if o is not u and (o.get("email") or "").lower() == email and not o.get("email_verified"):
            o["email"] = ""


# ---------- email confirmation ----------

def send_verify(u):
    e = norm_email(u.get("email"))
    if not e:
        return 400, {"error": "Add an email address first."}
    if u.get("email_verified"):
        return 200, {"ok": True, "already": True}
    if not allowed("v:" + u["username"].lower(), per_hour=4):
        return 429, {"error": "We just sent one. Check your inbox (and spam) or try again in an hour."}
    t = make_token("verify", u["username"].lower(), e)
    link = _url(f"/#/auth/verify/{t}")
    send(e, "Confirm your Floodlight email", f"Hi {D['display'](u)},\n\nConfirm this is your email address so you can recover your account and receive receipts:\n\n{link}\n\nThe link works for 3 days. If you didn't create a Floodlight account, ignore this email.")
    return 200, {"ok": True, "sent": mail_ready(), "to": mask(e), **_dev(link)}


def verify(token):
    rec = take_token("verify", token) or take_token("email_change", token)
    if not rec:
        return 400, {"error": "This link has expired or was already used. Send a new one from Account."}
    u = D["users"].get(rec["user"])
    if not u:
        return 404, {"error": "That account no longer exists."}
    with D["lock"]:
        old = u.get("email") or ""
        if rec["kind"] == "email_change" and email_taken(rec["email"], u):
            return 409, {"error": "Another account already uses that email."}
        u["email"] = rec["email"]
        u["email_verified"] = True
        u["email_verified_at"] = int(time.time())
        _claim(u, rec["email"])
        D["save"]()
    if rec["kind"] == "email_change" and old and old.lower() != rec["email"]:
        send(old, "Your Floodlight email was changed", f"The email on Floodlight account @{u['username']} was changed to {mask(rec['email'])}. If this wasn't you, reset your password and contact support.")
    return 200, {"ok": True, "email": rec["email"], "username": u["username"]}


def change_email(u, email, password):
    e = norm_email(email)
    if not e:
        return 400, {"error": "That doesn't look like an email address."}
    if not D["check_password"](u, password):
        return 401, {"error": "That password isn't right."}
    if e == (u.get("email") or "").lower() and u.get("email_verified"):
        return 200, {"ok": True, "already": True}
    if email_taken(e, u):
        return 409, {"error": "Another account already uses that email."}
    if not allowed("e:" + u["username"].lower(), per_hour=4):
        return 429, {"error": "Too many changes. Try again in an hour."}
    if not u.get("email") or not u.get("email_verified"):
        with D["lock"]:                     # no confirmed address yet: take the new one now, unconfirmed, and confirm it
            u["email"], u["email_verified"] = e, False
            D["save"]()
        return send_verify(u)
    t = make_token("email_change", u["username"].lower(), e)
    link = _url(f"/#/auth/verify/{t}")
    send(e, "Confirm your new Floodlight email", f"Confirm {e} as the new email for Floodlight account @{u['username']}:\n\n{link}\n\nUntil you do, your old address stays on the account.")
    return 200, {"ok": True, "pending": mask(e), "sent": mail_ready(), **_dev(link)}


# ---------- sign-in links, resets and username reminders ----------

def magic_request(email, addr):
    """Always the same answer, so the form can't be used to find out who has an account."""
    e = norm_email(email)
    answer = {"ok": True, "message": "If an account uses that email, a sign-in link is on its way. It works for 15 minutes."}
    if not e:
        return 400, {"error": "Enter the email address on your account."}
    if not allowed("m:" + e, "ip:" + addr):
        return 429, {"error": "Too many emails asked for. Try again in an hour."}
    dev = {}
    for u in by_email(e)[:3]:
        t = make_token("magic", u["username"].lower(), e)
        link = _url(f"/#/auth/magic/{t}")
        send(e, "Your Floodlight sign-in link", f"Sign in to Floodlight as @{u['username']}:\n\n{link}\n\nThe link works once, for 15 minutes. If you didn't ask for it, ignore this email.")
        dev = _dev(link)
    return 200, {**answer, **dev}


def magic_use(token):
    rec = take_token("magic", token)
    if not rec:
        return None, "This sign-in link has expired or was already used. Ask for a new one."
    u = D["users"].get(rec["user"])
    if not u:
        return None, "That account no longer exists."
    if (u.get("email") or "").lower() == rec["email"] and not u.get("email_verified"):
        with D["lock"]:
            u["email_verified"] = True       # the link proved the inbox
            _claim(u, rec["email"])
            D["save"]()
    return u, ""


def forgot(ident, addr):
    ident = str(ident or "").strip()
    answer = {"ok": True, "message": "If that account has an email address, a reset link is on its way. It works for an hour."}
    if not ident:
        return 400, {"error": "Enter your username or email."}
    if not allowed("f:" + ident.lower(), "ip:" + addr):
        return 429, {"error": "Too many emails asked for. Try again in an hour."}
    named = D["users"].get(ident.lower())
    targets = [named] if named else by_email(ident)[:3]
    dev = {}
    for u in targets:
        e = norm_email(u.get("email"))
        if not e:
            continue
        t = make_token("reset", u["username"].lower(), e)
        link = _url(f"/#/auth/reset/{t}")
        send(e, "Reset your Floodlight password", f"Someone asked to reset the password for Floodlight account @{u['username']}. Choose a new one here:\n\n{link}\n\nThe link works once, for an hour. If it wasn't you, ignore this email; your password stays the same.")
        dev = _dev(link)
    if named and not norm_email(named.get("email")):
        answer["noEmail"] = True             # the username exists but has no address: say how to get help
        answer["message"] = "That account has no email address, so we can't send a link. Contact support or an admin for a temporary password."
    return 200, {**answer, **dev}


def reset(token, password):
    if len(password or "") < 8:
        return 400, {"error": "Use a password of at least 8 characters."}
    rec = take_token("reset", token, peek=True)
    if not rec:
        return 400, {"error": "This reset link has expired or was already used. Ask for a new one."}
    u = D["users"].get(rec["user"])
    if not u:
        return 404, {"error": "That account no longer exists."}
    take_token("reset", token)
    with D["lock"]:
        D["set_password"](u, password)
        if (u.get("email") or "").lower() == rec["email"]:
            u["email_verified"] = True
        D["drop_sessions"](u["username"].lower())
        D["save"]()
    if u.get("email"):
        send(u["email"], "Your Floodlight password was changed", f"The password for @{u['username']} was just changed and every device was signed out. If this wasn't you, contact support now.")
    return 200, {"ok": True, "user": u}


def remind_username(email, addr):
    e = norm_email(email)
    if not e:
        return 400, {"error": "Enter the email address on your account."}
    if not allowed("r:" + e, "ip:" + addr):
        return 429, {"error": "Too many emails asked for. Try again in an hour."}
    names = [u["username"] for u in by_email(e)]
    if names:
        send(e, "Your Floodlight username", "The Floodlight account" + ("s" if len(names) > 1 else "") + " for this email: " + ", ".join("@" + n for n in names) +
             f".\n\nSign in at {_url('/')}")
    return 200, {"ok": True, "message": "If an account uses that email, we've sent its username there.", **({"devNames": names} if _dev("x") else {})}


# ---------- two-step sign-in (TOTP, RFC 6238) ----------

def totp(secret, t=None, step=30, digits=6):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    h = hmac.new(key, struct.pack(">Q", int((t or time.time()) // step)), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 10 ** digits).zfill(digits)


def totp_ok(u, code, secret=None):
    """A 6-digit code from the app (one step of clock drift either way), never the same code twice; or a recovery code."""
    code = re.sub(r"[\s-]", "", str(code or ""))
    secret = secret or (u.get("twofa") or {}).get("secret")
    if not secret:
        return False
    if re.fullmatch(r"\d{6}", code):
        now = time.time()
        for drift in (0, -1, 1):
            step = int(now // 30) + drift
            if hmac.compare_digest(totp(secret, step * 30), code):
                tf = u.get("twofa") or {}
                if tf.get("last") and step <= tf["last"]:
                    return False
                if u.get("twofa"):
                    u["twofa"]["last"] = step
                return True
        return False
    if re.fullmatch(r"[A-Za-z0-9]{10}", code):
        h = _sha(code.lower())
        rc = (u.get("twofa") or {}).get("recovery") or []
        if h in rc:
            rc.remove(h)
            return True
    return False


def twofa_setup(u):
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    with D["lock"]:
        u["twofa_pending"] = {"secret": secret, "exp": time.time() + 900}
        D["save"]()
    label = f"Floodlight:{u['username']}"
    return 200, {"secret": " ".join(secret[i:i + 4] for i in range(0, len(secret), 4)),
                 "uri": f"otpauth://totp/{label}?secret={secret}&issuer=Floodlight&digits=6&period=30"}


def twofa_enable(u, code):
    p = u.get("twofa_pending") or {}
    if not p or p.get("exp", 0) < time.time():
        return 400, {"error": "Start again: the setup key expired."}
    if not totp_ok({}, code, p["secret"]):
        return 400, {"error": "That code didn't match. Check the time on your phone and try the newest code."}
    codes = [secrets.token_hex(5) for _ in range(10)]
    with D["lock"]:
        u["twofa"] = {"secret": p["secret"], "on": int(time.time()), "recovery": [_sha(c) for c in codes]}
        u.pop("twofa_pending", None)
        D["save"]()
    if u.get("email"):
        send(u["email"], "Two-step sign-in is on", f"Two-step sign-in was turned on for @{u['username']}. You'll need your authenticator app (or a recovery code) to sign in.")
    return 200, {"ok": True, "recovery": codes}


def twofa_disable(u, password, code):
    if not D["check_password"](u, password):
        return 401, {"error": "That password isn't right."}
    if not totp_ok(u, code):
        return 400, {"error": "That code didn't match."}
    with D["lock"]:
        u.pop("twofa", None)
        D["save"]()
    if u.get("email"):
        send(u["email"], "Two-step sign-in is off", f"Two-step sign-in was turned off for @{u['username']}. If this wasn't you, reset your password now.")
    return 200, {"ok": True}


def ticket(u, via):
    t = secrets.token_urlsafe(24)
    now = time.time()
    for k in [k for k, v in _tickets.items() if v["exp"] < now]:
        _tickets.pop(k, None)
    _tickets[t] = {"user": u["username"].lower(), "exp": now + 300, "via": via, "tries": 0}
    return t


def ticket_use(t, code):
    rec = _tickets.get(str(t or ""))
    if not rec or rec["exp"] < time.time():
        return None, "That took too long. Sign in again."
    rec["tries"] += 1
    if rec["tries"] > 5:
        _tickets.pop(t, None)
        return None, "Too many wrong codes. Sign in again."
    u = D["users"].get(rec["user"])
    if not u:
        return None, "That account no longer exists."
    with D["lock"]:
        ok = totp_ok(u, code)
        if ok:
            D["save"]()
    if not ok:
        return None, "That code didn't match. Use the newest code from your app, or a recovery code."
    _tickets.pop(t, None)
    return u, ""


# ---------- signed-in devices ----------

def device_label(ua):
    ua = ua or ""
    os_ = next((n for k, n in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Mac OS", "Mac"), ("Windows", "Windows"),
                               ("CrOS", "Chromebook"), ("Linux", "Linux")) if k in ua), "Unknown device")
    br = next((n for k, n in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("CriOS", "Chrome"), ("Chrome/", "Chrome"),
                              ("Safari/", "Safari"), ("Discord", "Discord")) if k in ua), "Browser")
    return f"{br} on {os_}"


def sid(token):
    return _sha("sess:" + token)[:16]


def sessions_of(sessions, key, current):
    out = []
    now = time.time()
    for t, s in sessions.items():
        if s.get("user") == key and s.get("exp", 0) > now:
            out.append({"id": sid(t), "device": s.get("device") or "Unknown device", "created": int(s.get("created") or (s["exp"] - 30 * 86400)),
                        "seen": int(s.get("seen") or s.get("created") or 0), "where": s.get("where") or "", "current": t == current, "via": s.get("via") or "password"})
    return sorted(out, key=lambda x: (not x["current"], -x["seen"]))


# ---------- terms ----------

def terms_ok(u):
    return (u.get("terms") or {}).get("version") == TERMS_VERSION


def accept_terms(u, version):
    if version != TERMS_VERSION:
        return 400, {"error": "The terms changed again. Reload the page."}
    with D["lock"]:
        hist = (u.get("terms_history") or [])[-20:]
        u["terms"] = {"version": TERMS_VERSION, "at": int(time.time())}
        hist.append(u["terms"])
        u["terms_history"] = hist
        D["save"]()
    return 200, {"ok": True}


def forget(key):
    """Account deletion: unused email links and two-step sign-ins in progress for the account go."""
    with _lock:
        for k in [k for k, v in _st["tokens"].items() if v.get("user") == key]:
            _st["tokens"].pop(k, None)
        _save()
    for t in [t for t, v in _tickets.items() if v.get("user") == key]:
        _tickets.pop(t, None)
