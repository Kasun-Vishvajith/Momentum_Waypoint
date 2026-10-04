"""Deterministic allocation validation using the supplied operating reference tables."""
import csv
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / 'data'
TRAVEL = {r['district']: r for r in csv.DictReader((DATA / 'district_travel.csv').open(encoding='utf-8-sig'))}
SERVICE = {(r['brand'], r['dock_type']): float(r['service_allowance_min']) for r in csv.DictReader((DATA / 'service_allowance.csv').open(encoding='utf-8-sig'))}
SLT = timezone(timedelta(hours=5, minutes=30))

class Problem(Exception):
    def __init__(self, message, status=400, details=None):
        self.message, self.status, self.details = message, status, details

def now():
    return datetime.now(timezone.utc).isoformat()

def clock():
    # Optional fixed demo clock is displayed in the UI; unset uses the actual SLT clock.
    import os
    fixed = os.getenv('DEMO_CLOCK', '')
    return datetime.fromisoformat(fixed).astimezone(SLT) if fixed else datetime.now(SLT)

def minute(value):
    try:
        h, m = map(int, value.split(':'))
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError()
        return h * 60 + m
    except (ValueError, AttributeError):
        raise Problem('Enter a valid time in HH:MM format.')

def hhmm(value):
    value = math.ceil(value)
    return f'{value // 60:02d}:{value % 60:02d}'

def reference(db, table, key):
    row = db.one(f'SELECT data FROM {table} WHERE id=?', (key,))
    if not row:
        raise Problem(f'Unknown {table.rstrip("s")}: {key}', 404)
    return json.loads(row['data'])

def operating(db, day):
    try:
        parsed = date.fromisoformat(day)
    except (ValueError, TypeError):
        raise Problem('Enter a valid delivery date.')
    row = db.one('SELECT data FROM calendar WHERE date=?', (day,))
    # calendar.csv is authoritative inside its coverage; Mon-Sat outside it.
    return bool(int(json.loads(row['data'])['is_operating'])) if row else parsed.weekday() < 6

def next_run(db, day):
    current = date.fromisoformat(day)
    for _ in range(370):
        current += timedelta(days=1)
        if operating(db, current.isoformat()):
            return current.isoformat()
    raise Problem('No next operating date could be found.')

def earliest_order_day(db):
    current = clock()
    day = next_run(db, current.date().isoformat())
    return next_run(db, day) if current.hour >= 16 else day

def route_report(db, trip_id):
    trip = db.one('SELECT * FROM trips WHERE id=?', (trip_id,))
    if not trip:
        raise Problem('Trip not found.', 404)
    vehicle = reference(db, 'vehicles', trip['vehicle_id'])
    rows = db.all('SELECT o.*,s.position FROM stops s JOIN orders o ON o.id=s.order_id WHERE s.trip_id=? ORDER BY s.position,o.id', (trip_id,))
    checks = []
    def check(name, ok, detail):
        checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    weight, volume = sum(o['weight'] for o in rows), sum(o['volume'] for o in rows)
    check('Weight capacity', weight <= float(vehicle['weight_cap_kg']), f"{weight:g} / {vehicle['weight_cap_kg']} kg")
    check('Volume capacity', volume <= float(vehicle['volume_cap_m3']), f"{volume:g} / {vehicle['volume_cap_m3']} m³")
    check('Operating date', operating(db, trip['date']), trip['date'])
    check('Orders and dates', bool(rows) and all(o['date'] == trip['date'] and o['status'] != 'Deferred' for o in rows), 'At least one order; all orders belong to this operating date.')
    check('Temperature', vehicle['temp'] == 'reefer' or all(o['temperature'] == 'Ambient' for o in rows), 'Chilled and frozen goods require a refrigerated vehicle.')
    outlets = [reference(db, 'outlets', o['outlet_id']) for o in rows]
    check('Home depot', all(o['depot'] == vehicle['depot'] for o in outlets), f"Vehicle starts and returns to {vehicle['depot']}.")
    assigned_driver = db.one('SELECT vehicle_id FROM users WHERE id=?', (trip['driver_id'],))
    check('Assigned vehicle driver', assigned_driver and assigned_driver['vehicle_id'] == trip['vehicle_id'], 'Each fleet vehicle uses its own assigned driver.')
    check('Outlet access', vehicle['type'] == 'van' or all(o['parking_constraint'] != 'van_only' for o in outlets), 'Van-only outlets cannot be assigned to trucks.')
    # District travel is an approximation, not a GPS or traffic prediction. Cross-district
    # legs use a conservative depot-via-depot distance, explicitly documented.
    minutes = minute(trip['departure'])
    distance, schedule, previous = 0., [], None
    calendar = db.one('SELECT data FROM calendar WHERE date=?', (trip['date'],))
    monsoon = bool(calendar and int(json.loads(calendar['data'])['monsoon']))
    factor = 1.2 if monsoon else 1.
    windows_ok = True
    for order, outlet in zip(rows, outlets):
        travel = TRAVEL[outlet['district']]
        if previous is None:
            leg_km, leg_min = float(travel['depot_to_district_km']), float(travel['depot_to_district_freeflow_min'])
        elif previous['district'] == outlet['district']:
            leg_km, leg_min = float(travel['inter_stop_km']), float(travel['inter_stop_freeflow_min'])
        else:
            prev_travel = TRAVEL[previous['district']]
            leg_km = float(prev_travel['depot_to_district_km']) + float(travel['depot_to_district_km'])
            leg_min = float(prev_travel['depot_to_district_freeflow_min']) + float(travel['depot_to_district_freeflow_min'])
        distance += leg_km
        minutes += math.ceil(leg_min * factor)
        minutes = max(minutes, minute(outlet['window_open_time']))
        close = minute(outlet['window_close_time'])
        if outlet['brand'] == 'Fresh':
            close = min(close, 480)
        if outlet['mall_window']:
            mall_open, mall_close = outlet['mall_window'].split('-')
            minutes = max(minutes, minute(mall_open))
            close = min(close, minute(mall_close))
        allowance = SERVICE[(outlet['brand'], outlet['dock_type'])]
        # For malls, unloading must also finish before the access window closes.
        fits = minutes <= close and (not outlet['mall_window'] or minutes + allowance <= close)
        windows_ok &= fits
        schedule.append({'order_id': order['id'], 'outlet_id': order['outlet_id'], 'eta': hhmm(minutes), 'service_min': allowance, 'window': outlet['window_open_time'] + '–' + outlet['window_close_time'], 'ok': fits})
        minutes += allowance
        previous = outlet
    if previous:
        travel = TRAVEL[previous['district']]
        distance += float(travel['depot_to_district_km'])
        minutes += math.ceil(float(travel['depot_to_district_freeflow_min']) * factor)
    check('Delivery windows', windows_ok, 'Estimated arrivals respect outlet windows; mall unloading finishes within access windows.')
    check('Same-day return', minutes < 1440, 'Every run returns to its home depot before midnight.')
    fuel = distance / float(vehicle['km_per_l'])
    monday = date.fromisoformat(trip['date']) - timedelta(days=date.fromisoformat(trip['date']).weekday())
    sunday = monday + timedelta(days=6)
    siblings = db.all("SELECT * FROM trips WHERE vehicle_id=? AND id<>? AND status<>'Draft' AND date>=? AND date<=?", (trip['vehicle_id'], trip_id, monday.isoformat(), sunday.isoformat()))
    reserved = sum(t['fuel_l'] for t in siblings)
    check('Weekly fuel quota', reserved + fuel <= float(vehicle['weekly_fuel_quota_l']), f"{reserved + fuel:.2f} / {vehicle['weekly_fuel_quota_l']} L, including published runs this week.")
    daily = [t for t in siblings if t['date'] == trip['date']]
    check('Two routes per day', len(daily) < 2, f'{len(daily) + 1} planned routes for this vehicle on this date.')
    check('Vehicle turnaround', all(minutes <= minute(t['departure']) or minute(trip['departure']) >= t['return_min'] for t in daily), 'The vehicle must return before its next run departs.')
    driver_trips = db.all("SELECT * FROM trips WHERE driver_id=? AND date=? AND id<>? AND status<>'Draft'", (trip['driver_id'], trip['date'], trip_id))
    check('Driver turnaround', all(minutes <= minute(t['departure']) or minute(trip['departure']) >= t['return_min'] for t in driver_trips), 'This driver cannot operate overlapping trips.')
    return {'valid': all(c['ok'] for c in checks), 'checks': checks, 'schedule': schedule, 'weight': weight, 'volume': volume, 'distance_km': round(distance, 2), 'fuel_l': round(fuel, 3), 'return_min': minutes, 'return_time': hhmm(minutes), 'travel_factor': factor}
