"""Small SQL adapter: PostgreSQL in Compose, SQLite for dependency-free local runs."""
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = threading.RLock()
SCHEMA = '''
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, outlet_id TEXT, depot TEXT, vehicle_id TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outlets (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar (date TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL REFERENCES vehicles(id), driver_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, departure TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, distance_km REAL NOT NULL DEFAULT 0, fuel_l REAL NOT NULL DEFAULT 0, return_min REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL REFERENCES outlets(id), units INTEGER NOT NULL CHECK(units > 0), weight REAL NOT NULL CHECK(weight > 0), volume REAL NOT NULL CHECK(volume > 0), temperature TEXT NOT NULL, date TEXT NOT NULL, original_date TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', deferrals INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stops (order_id TEXT PRIMARY KEY REFERENCES orders(id), trip_id TEXT NOT NULL REFERENCES trips(id), position INTEGER NOT NULL, loaded INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, eta TEXT NOT NULL DEFAULT '', arrived_at TEXT);
CREATE TABLE IF NOT EXISTS deliveries (order_id TEXT PRIMARY KEY REFERENCES orders(id), client_id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), quantity INTEGER NOT NULL, recipient TEXT NOT NULL, reason TEXT NOT NULL, notes TEXT NOT NULL, signature TEXT NOT NULL, photo TEXT NOT NULL, evidence_unavailable INTEGER NOT NULL, recorded_at TEXT NOT NULL, synced_at TEXT NOT NULL, payload_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (order_id TEXT PRIMARY KEY REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id), quantity INTEGER NOT NULL, note TEXT NOT NULL, confirmed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), entity_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_stops_trip ON stops(trip_id);
CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(date, status);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_day ON trips(vehicle_id, date);
'''

class DB:
    def __init__(self):
        url = os.getenv('DATABASE_URL', '')
        self.postgres = url.startswith('postgres')
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row
            self.conn = psycopg.connect(url, row_factory=dict_row, connect_timeout=10, prepare_threshold=None)
        else:
            path = Path(os.getenv('SQLITE_PATH', str(ROOT / 'var' / 'waypoint.db')))
            path.parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(path, timeout=30)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute('PRAGMA foreign_keys=ON')
            self.conn.execute('PRAGMA journal_mode=WAL')

    def execute(self, sql, args=()):
        return self.conn.execute(sql.replace('?', '%s') if self.postgres else sql, args)

    def one(self, sql, args=()):
        row = self.execute(sql, args).fetchone()
        return dict(row) if row else None

    def all(self, sql, args=()):
        return [dict(row) for row in self.execute(sql, args).fetchall()]

    def insert(self, table, values):
        fields = list(values)
        self.execute(f"INSERT INTO {table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", tuple(values[k] for k in fields))

    def update(self, table, values, key, value):
        self.execute(f"UPDATE {table} SET {','.join(k+'=?' for k in values)} WHERE {key}=?", (*values.values(), value))

@contextmanager
def transaction():
    # Serialize mutations across threads and PostgreSQL replicas; prevents capacity races.
    with LOCK:
        db = DB()
        try:
            if db.postgres:
                db.execute('SELECT pg_advisory_xact_lock(902026)')
            else:
                db.execute('BEGIN IMMEDIATE')
            yield db
            db.conn.commit()
        except Exception:
            db.conn.rollback()
            raise
        finally:
            db.conn.close()

def initialize():
    with transaction() as db:
        for statement in SCHEMA.split(';'):
            if statement.strip():
                db.execute(statement)
        columns = db.all("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'") if db.postgres else db.all('PRAGMA table_info(users)')
        if 'vehicle_id' not in [c.get('column_name', c.get('name')) for c in columns]:
            db.execute('ALTER TABLE users ADD COLUMN vehicle_id TEXT')
