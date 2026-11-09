# Floodlight

Live scores, odds and predictions for football, basketball, baseball, hockey and tennis.

## Run on your computer

    python3 server.py        # then open http://localhost:8642

## Hosting (free, on Render)

`render.yaml` sets up one free Render web service that serves both the site and its `/api/` backend.

The hosted site is members only. People ask for an account on the login screen, and the admin approves them
from the **Members** button, choosing "Games only" or "Games + research" (prop research and AI forecasts).

Environment variables (set in the Render dashboard):

- `FLOODLIGHT_ADMIN` – the admin's username.
- `FLOODLIGHT_ADMIN_PASSWORD` – the admin's password. The admin account is created from these on start.
- `DATABASE_URL` – a free Neon Postgres connection string (https://neon.tech). Keeps members, sessions and
  forecasts when Render's disk is wiped.
- `FLOODLIGHT_OPEN=1` – optional, turns members-only off.
- `ANTHROPIC_API_KEY` – optional, turns on AI research forecasts (paid by usage on your Anthropic account).

Free-tier limits: the service sleeps after 15 minutes without visitors and takes about a minute to wake up,
and its disk is wiped whenever it sleeps or redeploys. Without `DATABASE_URL`, members and forecasts reset then.
