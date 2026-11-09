"""Floodlight saved data: accounts, sessions, forecasts and settings.

Always written to the local cache folder. When DATABASE_URL is set (a free Neon Postgres database, for example),
each file is also kept in the database, because free hosts like Render wipe their disk whenever the site sleeps
or restarts. On start the database copy wins.
"""
import json
import os
import ssl
import threading
import urllib.parse
from pathlib import Path

URL = (os.environ.get("DATABASE_URL") or "").strip()
_lock = threading.Lock()
_conn = None


def _db():
    global _conn
    if _conn is None:
        import pg8000.native
        u = urllib.parse.urlparse(URL)
        params = urllib.parse.parse_qs(u.query)
        need_ssl = params.get("sslmode", ["require"])[0] != "disable"
        _conn = pg8000.native.Connection(
            user=urllib.parse.unquote(u.username or ""), password=urllib.parse.unquote(u.password or ""),
            host=u.hostname, port=u.port or 5432, database=(u.path or "/").lstrip("/") or "postgres",
            ssl_context=ssl.create_default_context() if need_ssl else None, timeout=20)
        _conn.run("CREATE TABLE IF NOT EXISTS floodlight_kv (name TEXT PRIMARY KEY, data TEXT NOT NULL, "
                  "updated TIMESTAMPTZ NOT NULL DEFAULT now())")
    return _conn


def _run(sql, **kw):
    """Run a query, reconnecting once if the database dropped the connection while the site slept."""
    global _conn
    for attempt in (1, 2):
        try:
            return _db().run(sql, **kw)
        except Exception:
            try:
                if _conn is not None:
                    _conn.close()
            except Exception:
                pass
            _conn = None
            if attempt == 2:
                raise


def enabled():
    return bool(URL)


def load(path, default):
    path = Path(path)
    if URL:
        try:
            with _lock:
                rows = _run("SELECT data FROM floodlight_kv WHERE name = :n", n=path.name)
            if rows:
                return json.loads(rows[0][0])
        except Exception as e:
            print(f"storage: couldn't read {path.name} from the database: {e}")
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save(path, data):
    path = Path(path)
    text = json.dumps(data)
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.replace(path)
    try:
        path.chmod(0o600)
    except Exception:
        pass
    if URL:
        try:
            with _lock:
                _run("INSERT INTO floodlight_kv (name, data, updated) VALUES (:n, :d, now()) "
                     "ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated = now()", n=path.name, d=text)
        except Exception as e:
            print(f"storage: couldn't save {path.name} to the database: {e}")
