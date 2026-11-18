"""Vercel's entry point: every request (the site, the Lab, the API and Discord's commands) goes to server.py's Handler.
See serverless.py for how the background work runs on Vercel."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402

server.boot(loops=False)
handler = server.Handler
