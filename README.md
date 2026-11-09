# Floodlight

Live scores, odds and predictions for football, basketball, baseball, hockey and tennis.

## Run on your computer

    python3 server.py        # then open http://localhost:8642

## Hosting (free, on Render)

`render.yaml` sets up one free Render web service that serves both the site and its `/api/` backend.

Environment variables (set in the Render dashboard):

- `FLOODLIGHT_ADMIN` – your Floodlight username. Only this account can change the AI research settings.
- `ANTHROPIC_API_KEY` – optional, turns on AI research forecasts (paid by usage on your Anthropic account).

Free-tier limits: the service sleeps after 15 minutes without visitors and takes about a minute to wake up,
and its disk is wiped on every restart or redeploy, so accounts and saved forecasts reset then.
