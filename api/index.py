"""Vercel Python Function adapter for the same tested application API."""
import os
import sys
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from server import Handler, setup

_ready = False
_startup = threading.Lock()

class handler(Handler):
    def prepare(self):
        global _ready
        if not _ready:
            with _startup:
                if not _ready:
                    # Serverless local files are ephemeral. Never fall back to SQLite here.
                    if not os.getenv('DATABASE_URL'):
                        os.environ['DATABASE_URL'] = os.getenv('POSTGRES_URL', '')
                    if not os.getenv('DATABASE_URL', '').startswith('postgres'):
                        self.send_json(503, {'error': 'Connect a PostgreSQL database and set DATABASE_URL in Vercel, then redeploy.'})
                        return False
                    os.environ.setdefault('COOKIE_SECURE', 'true')
                    os.environ.setdefault('DEMO_CLOCK', '2026-06-23T15:00:00+05:30')
                    setup()
                    _ready = True
        query = parse_qs(urlsplit(self.path).query)
        if 'route' in query:
            self.path = '/api/' + query['route'][0].lstrip('/')
        return True

    def do_GET(self):
        try:
            if self.prepare():
                super().do_GET()
        except Exception:
            self.send_json(503, {'error': 'The database is unavailable. Check the Vercel PostgreSQL connection and retry.'})

    def do_POST(self):
        try:
            if self.prepare():
                super().do_POST()
        except Exception:
            self.send_json(503, {'error': 'The database is unavailable. Saved driver records remain on this device; retry later.'})
