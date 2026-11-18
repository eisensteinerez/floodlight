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

## Discord bot

`discord_bot.py` puts Floodlight's research, scores, predictions and lineups in Discord as slash commands:

- `/research player stat [line] [sport] [side] [opponent]` – hit rate over the last 5 / 10 / 20 games, this season and
  against one team. Without a line it uses today's PrizePicks line (or one near the player's average).
- `/props sport [stat] [count]` – today's PrizePicks and Sleeper lines ranked by recent hit rate.
- `/scores sport [league]` – live scores, finals and today's schedule.
- `/predict sport [team]` – win chances from the betting market; with a team, every book's price and the value bets.
- `/lineup team [sport]` – FotMob predicted or confirmed soccer lineups, MLB batting orders and probable pitchers,
  and injury reports for the NBA, WNBA, NFL and NHL.
- `/record [sport] [days]` – Floodlight's own prediction record (see below).
- `/leaderboard [days]` – each pick channel's graded record (see "Pick channel grading").
- `/checkpicks` – admins only: run the pick grading now.
- `/help`

It runs inside `server.py` on the same free Render service, so there's nothing extra to host. Discord sends each
command to `https://<your-site>/api/discord/interactions`; the server answers "thinking..." right away and edits in
the result. It never calls Claude or any paid API, and it caches what it fetches (game logs for an hour, the props
ranking for 15 minutes, game prices for 10 minutes) so a busy channel doesn't multiply requests.

### Setting it up

1. Go to https://discord.com/developers/applications, click **New Application** and name it Floodlight.
2. On **General Information**, copy the **Application ID** and the **Public Key**.
3. On **Bot**, click **Reset Token** and copy the token. Turn **Public Bot** off so only you can add it to servers.
4. In the Render dashboard, open the floodlight service, then **Environment**, and add
   `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID` and `DISCORD_BOT_TOKEN`. Save, and let it redeploy.
5. Back in the Developer Portal, on **General Information**, set **Interactions Endpoint URL** to
   `https://<your-site>.onrender.com/api/discord/interactions` and save. Discord checks the address right then, so
   the site has to be awake (open it in a browser first).
6. The server registers the slash commands by itself when it starts (only when they changed). Global commands can
   take up to an hour to show up; add `DISCORD_GUILD_ID` with your server's id to have them appear there at once
   (Discord settings > Advanced > Developer Mode, then right-click the server > Copy Server ID).
7. Add the bot to your server: **OAuth2 > URL Generator**, tick `applications.commands` and `bot`, open the link it
   makes and pick your server.

Members only (optional): set `DISCORD_MEMBER_ROLES` to one or more role ids (comma separated) and only people with
one of those roles can use the commands. Server admins always can, and `/help` stays open to everyone. To copy a role
id, turn on Developer Mode (Discord settings > Advanced), then Server Settings > Roles > right-click the role > Copy Role ID.

Scheduled posts (optional): in your Discord channel, **Edit Channel > Integrations > Webhooks > New Webhook**, copy its
URL into `DISCORD_WEBHOOK_URL`. Every day at the hours in `DISCORD_DIGEST_HOURS` (UTC, comma separated, default 14)
the bot posts the top props and predictions for the sports in `DISCORD_DIGEST_SPORTS` (default `nba,nfl,nhl,mlb,soccer`;
sports out of season post nothing).

Keep it awake: Render's free plan sleeps after 15 minutes without visitors, and Discord gives up on a command after
3 seconds, so the first command after a nap fails. A free monitor such as https://cron-job.org or UptimeRobot that
opens `https://<your-site>.onrender.com/api/version` every 10 minutes keeps it awake. The free plan's 750 hours a
month cover one service running all the time.

Try a command without Discord: `python3 discord_bot.py try research player="Jayson Tatum" stat=pts`.

## Track record

`record.py` locks in each tracked match's last forecast at kick-off and grades it at full time (ESPN results, or
FotMob for FotMob-only leagues). Predictions › Track record shows the W-L, hit rate, streaks, a 30-day chart,
results by confidence, sport and league, the full history with filters, your own picks next to Floodlight's, and a
shareable record card image. It's saved in `record.json` (and in the database when `DATABASE_URL` is set). Link
straight to it with `/#record`.

## Pick channel grading

`pick_tracker.py` grades the cards posted in the server's pick channels (codex-props, claude-props, instinct-props,
codex-soccer, claude-soccer, instinct-soccer, cafe-picks, parlay-predictor; ez-picks is left out because its picks are
screenshots). It's built to run with nobody checking it:

- **Counting.** In the props channels a card is one play, like a parlay: every pick hits = a win, one miss = a loss,
  and a push or a player who didn't play doesn't break it (4-0-1 is a win). In the soccer channels every pick is its
  own play (four picks that all hit = 4-0).
- **Reading cards** (`pick_parse.py`). Posts split over several messages are joined. TRACK lines win; otherwise the
  FINAL CARD; otherwise the picks under a card heading (NBA PARLAY, PLAY #2, LADDER BET, TODAY'S PICK, QUICK CARD).
  Breakdowns, add-ons, backups, tout notes and change logs are skipped, the parlay math line trims "insurance" legs,
  and practice posts and format previews are ignored. A later card for the same day and play replaces the earlier one
  (the 6 PM update replaces the 11:30 card); separate plays (Play #1 and Play #2, a best bet and a ladder) both count.
- **Grading** (`pick_grade.py`). NBA/NFL props from the player's ESPN game log for the card's date; NBA/NFL team bets
  from ESPN's scoreboard; soccer from FotMob's results (ESPN as backup) on the 90-minute score. Team names match
  strictly: "Ireland" is never "Northern Ireland" or "Ireland U21", and a pick two games could fit isn't graded.
- **Never guessing.** A pick that can't be verified for certain is shown as "couldn't verify" and its card stays out
  of the record. A player is called a DNP only after the day is over.

At 12:30 AM Eastern it reads the last two days of posts, grades them and posts in #verified-records: one post per
channel (every card with each pick's result, today's record, all-time record, win rate, streak and picks hit) and a
leaderboard. At 8:00 AM it grades everything again from fresh numbers: it posts what finished since, and if a result
changed it posts the correction. No AI, no paid APIs. Tests on real posts: `python3 tests/test_picks.py`.

It needs **Message Content Intent** turned on (Discord Developer Portal › your app › Bot › Privileged Gateway Intents)
so the bot can read the posts. Optional settings: `DISCORD_TRACK_CHANNELS`, `DISCORD_RECORDS_CHANNEL`,
`DISCORD_TRACK_TIMES` (default `00:30,08:00`). Try it locally with the bot token set: `python3 pick_tracker.py try`.
