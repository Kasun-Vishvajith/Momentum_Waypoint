import csv
import hashlib
import json
import os
import secrets
from db import ROOT
from domain import now

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 210000).hex()
    return salt + ':' + digest

def password_matches(password, encoded):
    salt, _ = encoded.split(':')
    return secrets.compare_digest(password_hash(password, salt), encoded)

def seed(db):
    if db.one('SELECT id FROM users LIMIT 1'):
        seed_drivers(db)
        return
    for table, file, key in [('outlets', 'outlets.csv', 'outlet_id'), ('vehicles', 'vehicles.csv', 'vehicle_id'), ('calendar', 'calendar.csv', 'date')]:
        with (ROOT / 'data' / file).open(encoding='utf-8-sig') as source:
            for row in csv.DictReader(source):
                db.insert(table, {('date' if table == 'calendar' else 'id'): row[key], 'data': json.dumps(row)})
    password = os.getenv('SEED_PASSWORD', 'demo123')
    for uid, username, name, role, outlet in [('store', 'store', 'K. Mendis', 'store', 'OUT002'), ('dispatch', 'dispatch', 'D. Senanayake', 'dispatcher', None), ('loader', 'loader', 'R. Fernando', 'loader', None), ('driver', 'driver', 'S. Bandara', 'driver', None)]:
        db.insert('users', {'id': uid, 'username': username, 'name': name, 'role': role, 'password_hash': password_hash(password), 'outlet_id': outlet, 'depot': 'Peliyagoda'})
    db.insert('trips', {'id': 'TR-001', 'vehicle_id': 'VEH035', 'driver_id': 'driver', 'date': '2026-06-24', 'departure': '04:30', 'status': 'Draft'})
    records = [('WP-1038','OUT001',30,240,1.9,'Chilled'), ('WP-1042','OUT002',40,320,2.4,'Chilled'), ('WP-1049','OUT003',20,160,1.3,'Chilled'), ('WP-1050','OUT015',80,280,8.5,'Ambient'), ('WP-1051','OUT021',40,8200,42,'Ambient')]
    for i, (oid, outlet, units, weight, volume, temp) in enumerate(records):
        db.insert('orders', {'id': oid, 'outlet_id': outlet, 'units': units, 'weight': weight, 'volume': volume, 'temperature': temp, 'date': '2026-06-24', 'original_date': '2026-06-24', 'status': 'Planned' if i < 3 else 'Submitted', 'note': 'Bulk replenishment; split shipment requires a revised order.' if i == 4 else '', 'deferrals': 1 if i == 3 else 0, 'created_at': '2026-06-23T09:00:00+00:00'})
        if i < 3:
            db.insert('stops', {'order_id': oid, 'trip_id': 'TR-001', 'position': i + 1, 'loaded': 15 if i == 2 else units, 'verified': 0})
    db.insert('events', {'id': secrets.token_hex(12), 'user_id': None, 'entity_id': 'TR-001', 'action': 'seeded', 'detail': 'Realistic reference-data day with a chilled van run, loading shortage, mall request, and capacity overflow.', 'created_at': now()})
    seed_drivers(db)

def seed_drivers(db):
    """Each fleet vehicle has its own driver; judge account drives VEH035."""
    db.update('users', {'vehicle_id': 'VEH035'}, 'id', 'driver')
    for row in db.all('SELECT id,data FROM vehicles'):
        if row['id'] == 'VEH035':
            continue
        uid = 'driver-' + row['id'].lower()
        if db.one('SELECT id FROM users WHERE id=?', (uid,)):
            continue
        ref = json.loads(row['data'])
        db.insert('users', {'id':uid,'username':uid,'name':'Fleet driver '+row['id'],'role':'driver','password_hash':password_hash(os.getenv('SEED_PASSWORD','demo123')),'depot':ref['depot'],'vehicle_id':row['id']})
