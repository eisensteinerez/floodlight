"""Running Floodlight on Vercel.

Vercel runs the server only while it answers a request: there are no background loops, the folder is read-only
except /tmp, and several copies can run at once. This module covers what the loops did on Render:

  GET  /api/cron/tick       one pass of the schedule: the track record, the pick-channel backup, the daily digest and
                            the forecasts that are due. Something has to call it every few minutes (Vercel's free
                            timer only runs once a day; see the README).
  POST /api/cron/forecast   a forecast someone asked for with "Update now", in its own request
  POST /api/discord/finish  the second half of a slow Discord command (Discord only waits 3 seconds for an answer)

The two POSTs are requests the server sends to itself, signed with a key only it knows.
"""
import hashlib
import hmac
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

import storage

ON = bool(os.environ.get("VERCEL"))
TIME_LIMIT = 290            # seconds a request may run (vercel.json maxDuration is 300)
_state = {"registered": False}


def site():
    url = os.environ.get("FLOODLIGHT_URL") or ""
    if not url and os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
        url = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]
    return url.rstrip("/")


def _key():
    s = os.environ.get("CRON_SECRET") or os.environ.get("DISCORD_BOT_TOKEN") or os.environ.get("FLOODLIGHT_ADMIN_PASSWORD") or ""
    return hashlib.sha256(("floodlight-internal:" + s).encode()).digest()


def sign(body):
    return hmac.new(_key(), body, hashlib.sha256).hexdigest()


def read_signed(body, sig):
    """The job a signed request carries, or None if the signature is wrong or it's more than two minutes old."""
    if not sig or not hmac.compare_digest(sign(body), sig):
        return None
    try:
        job = json.loads(body)
    except ValueError:
        return None
    return job if isinstance(job, dict) and job.get("exp", 0) > time.time() else None


def spawn(path, job):
    """Start `path` on this server as its own request and don't wait for it to finish."""
    body = json.dumps(dict(job, exp=time.time() + 120)).encode()
    req = urllib.request.Request(site() + path, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "X-Floodlight-Sig": sign(body)})
    try:
        urllib.request.urlopen(req, timeout=1.2).read()
    except (socket.timeout, TimeoutError):
        pass   # expected: the request is on its way and runs by itself
    except urllib.error.URLError as e:
        if not isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)):
            print(f"serverless: couldn't start {path}: {e}", file=sys.stderr)
    except Exception as e:
        print(f"serverless: couldn't start {path}: {type(e).__name__}: {e}", file=sys.stderr)


def cron_allowed(headers, q):
    secret = os.environ.get("CRON_SECRET") or ""
    if not secret:
        return True
    given = (headers.get("Authorization") or "").removeprefix("Bearer ").strip() or q.get("key") or ""
    return hmac.compare_digest(given, secret)


def tick():
    """One pass of everything the background loops did on Render. Runs in one copy of the server at a time."""
    import discord_bot
    import forecaster
    import record
    start = time.time()
    if not storage.try_lock("tick"):
        return {"ok": True, "busy": "another pass is running"}
    out = {}
    try:
        def step(name, fn):
            try:
                out[name] = fn()
            except Exception as e:
                out[name] = f"error: {type(e).__name__}: {e}"[:300]
                print(f"tick: {name} failed: {e}", file=sys.stderr)

        if discord_bot.enabled() and os.environ.get("DISCORD_APP_ID") and os.environ.get("DISCORD_BOT_TOKEN") and not _state["registered"]:
            _state["registered"] = True
            step("commands", lambda: (discord_bot.register(only_if_changed=True), "checked")[1])
        step("record", lambda: record.tick() or "ok")
        if os.environ.get("DISCORD_BOT_TOKEN"):
            import pick_tracker

            def picks():
                pick_tracker.reload()
                if not pick_tracker.due_slots(pick_tracker.SERVER_DELAY, window=300):
                    return "nothing due"
                pick_tracker.scheduled(pick_tracker.SERVER_DELAY, window=300)
                return "ran"
            step("picks", picks)
        step("digest", lambda: "posted" if discord_bot.digest_once() else "nothing due")
        step("forecasts", lambda: forecaster.tick(start + TIME_LIMIT))
    finally:
        storage.unlock("tick")
    out["seconds"] = round(time.time() - start, 1)
    return {"ok": True, **out}
