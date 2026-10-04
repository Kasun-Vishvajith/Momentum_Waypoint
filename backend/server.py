"""Same-origin JSON API and static web server. Run: python backend/server.py."""
import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

from db import ROOT, initialize, transaction
from domain import Problem, now, clock, minute, reference, operating, next_run, earliest_order_day, route_report
from seed import seed, password_matches

LOG = logging.getLogger('waypoint')
FRONTEND = ROOT / 'frontend'

def require_role(user, *roles):
    if user['role'] not in roles:
        raise Problem('Your role cannot perform this action.', 403)

def text(body, key, minimum=0, maximum=1000):
    value = body.get(key, '')
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise Problem(f'{key.replace("_", " ").capitalize()} must contain {minimum}–{maximum} characters.')
    return value.strip()

def number(body, key, minimum=0, maximum=100000, integer=False):
    value = body.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum or (integer and int(value) != value):
        raise Problem(f'Enter a valid {key.replace("_", " ")} between {minimum} and {maximum}.')
    return int(value) if integer else float(value)

def entity(db, table, key):
    row = db.one(f'SELECT * FROM {table} WHERE id=?', (key,))
    if not row:
        raise Problem(f'{table.rstrip("s").capitalize()} not found.', 404)
    return row

def trip_access(db, user, trip_id):
    trip = entity(db, 'trips', trip_id)
    if user['role'] == 'driver' and trip['driver_id'] != user['id']:
        raise Problem('This trip is assigned to another driver.', 403)
    if user['role'] == 'loader' and reference(db, 'vehicles', trip['vehicle_id'])['depot'] != user['depot']:
        raise Problem('This trip belongs to another depot.', 403)
    return trip

def event(db, user, key, action, detail=''):
    db.insert('events', {'id': secrets.token_hex(12), 'user_id': user['id'], 'entity_id': key, 'action': action, 'detail': detail, 'created_at': now()})

def issue(db, user, order_id, kind, note):
    db.insert('issues', {'id': 'IS-' + secrets.token_hex(5), 'order_id': order_id, 'user_id': user['id'], 'kind': kind, 'note': note, 'status': 'Open', 'created_at': now()})

def draft(db, user, trip_id, body):
    require_role(user, 'dispatcher')
    trip = trip_access(db, user, trip_id)
    if trip['status'] != 'Draft':
        raise Problem('Published allocations are locked. Create a separate run for remaining orders.', 409)
    if body.get('version') != trip['version']:
        raise Problem('This plan changed in another session. Refresh before editing.', 409)
    return trip

def bump(db, trip):
    db.update('trips', {'version': trip['version'] + 1}, 'id', trip['id'])

def snapshot(db, user):
    outlets = [json.loads(r['data']) for r in db.all('SELECT data FROM outlets ORDER BY id')]
    vehicles = [json.loads(r['data']) for r in db.all('SELECT data FROM vehicles ORDER BY id')]
    orders = db.all('SELECT * FROM orders ORDER BY original_date,id')
    trips = db.all('SELECT * FROM trips ORDER BY date,departure,id')
    stops = db.all('SELECT * FROM stops ORDER BY trip_id,position,order_id')
    deliveries = db.all('SELECT * FROM deliveries ORDER BY synced_at')
    receipts = db.all('SELECT * FROM receipts')
    issues = db.all('SELECT * FROM issues ORDER BY created_at DESC')
    events = db.all('SELECT * FROM events ORDER BY created_at DESC LIMIT 100')
    if user['role'] == 'store':
        orders = [o for o in orders if o['outlet_id'] == user['outlet_id']]
        ids = {o['id'] for o in orders}
        stops = [s for s in stops if s['order_id'] in ids]
        trip_ids = {s['trip_id'] for s in stops}
        trips = [t for t in trips if t['id'] in trip_ids]
        outlets = [o for o in outlets if o['outlet_id'] == user['outlet_id']]
    elif user['role'] in ('driver', 'loader'):
        trips = [t for t in trips if (t['driver_id'] == user['id'] if user['role'] == 'driver' else reference(db, 'vehicles', t['vehicle_id'])['depot'] == user['depot']) and t['status'] != 'Draft']
        trip_ids = {t['id'] for t in trips}
        stops = [s for s in stops if s['trip_id'] in trip_ids]
        ids = {s['order_id'] for s in stops}
        orders = [o for o in orders if o['id'] in ids]
    else:
        ids = {o['id'] for o in orders}
    deliveries = [{k:v for k,v in d.items() if k != 'payload_hash'} for d in deliveries if d['order_id'] in ids]
    receipts = [r for r in receipts if r['order_id'] in ids]
    issues = [i for i in issues if i['order_id'] in ids]
    if user['role'] != 'dispatcher':
        visible = ids | {t['id'] for t in trips}
        events = [e for e in events if e['entity_id'] in visible]
    reports = {t['id']: route_report(db, t['id']) for t in trips}
    return {'user': {k:v for k,v in user.items() if k != 'password_hash'}, 'outlets': outlets, 'vehicles': vehicles, 'orders': orders, 'trips': trips, 'stops': stops, 'deliveries': deliveries, 'receipts': receipts, 'issues': issues, 'events': events, 'reports': reports, 'drivers': db.all("SELECT id,name,vehicle_id FROM users WHERE role='driver'"), 'clock': clock().isoformat(), 'demo_clock': bool(os.getenv('DEMO_CLOCK')), 'earliest_order_day': earliest_order_day(db)}

def evidence(body, key):
    value = text(body, key, 0, 1500000)
    if value:
        match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', value)
        if not match:
            raise Problem(f'{key.capitalize()} must be a PNG, JPEG, or WebP image.')
        try:
            raw = base64.b64decode(match[2], validate=True)
            valid = raw.startswith(b'\x89PNG\r\n\x1a\n') if match[1] == 'png' else raw.startswith(b'\xff\xd8\xff') if match[1] == 'jpeg' else raw.startswith(b'RIFF') and raw[8:12] == b'WEBP'
            if not valid or len(raw) > 1000000:
                raise ValueError()
        except (ValueError, TypeError):
            raise Problem(f'{key.capitalize()} is invalid or larger than 1 MB.')
    return value

def command(db, user, path, body):
    if path == '/api/orders':
        require_role(user, 'store')
        day = text(body, 'date', 10, 10)
        if day < earliest_order_day(db) or not operating(db, day):
            raise Problem(f'Choose an operating date on or after {earliest_order_day(db)}. Orders after 4 PM move to the following run.')
        temp = text(body, 'temperature', 1, 20)
        if temp not in ('Ambient','Chilled','Frozen'):
            raise Problem('Choose Ambient, Chilled, or Frozen handling.')
        if reference(db, 'outlets', user['outlet_id'])['brand'] != 'Fresh' and temp != 'Ambient':
            raise Problem('Only Fresh outlets place chilled or frozen orders.')
        oid = 'WP-' + secrets.token_hex(4).upper()
        db.insert('orders', {'id': oid, 'outlet_id': user['outlet_id'], 'units': number(body,'units',1,10000,True), 'weight': number(body,'weight',0.01), 'volume': number(body,'volume',0.01,10000), 'temperature': temp, 'date': day, 'original_date': day, 'status':'Submitted', 'note':text(body,'note'), 'created_at':now()})
        event(db,user,oid,'Order submitted',day)
        return {'id':oid}
    if path == '/api/trips':
        require_role(user,'dispatcher')
        vehicle_id = text(body,'vehicle_id',1,20)
        reference(db,'vehicles',vehicle_id)
        day = text(body,'date',10,10)
        if not operating(db,day):
            raise Problem('Vehicles operate only on operating dates.')
        departure = text(body,'departure',5,5)
        minute(departure)
        assigned_driver = db.one("SELECT id FROM users WHERE role='driver' AND vehicle_id=?", (vehicle_id,))
        if not assigned_driver:
            raise Problem('This vehicle has no assigned driver.',409)
        driver_id = assigned_driver['id']
        tid = 'TR-' + secrets.token_hex(3).upper()
        db.insert('trips',{'id':tid,'vehicle_id':vehicle_id,'driver_id':driver_id,'date':day,'departure':departure,'status':'Draft'})
        event(db,user,tid,'Trip created',vehicle_id)
        return {'id':tid}
    match = re.fullmatch(r'/api/trips/([^/]+)/(settings|assign|unassign|reorder|validate|publish|load|release|depart|arrive|return)',path)
    if match:
        tid, action = match.groups()
        trip = trip_access(db,user,tid)
        if action in ('settings','assign','unassign','reorder','publish'):
            trip = draft(db,user,tid,body)
        if action == 'settings':
            vid = text(body,'vehicle_id',1,20)
            reference(db,'vehicles',vid)
            departure = text(body,'departure',5,5)
            minute(departure)
            assigned_driver = db.one("SELECT id FROM users WHERE role='driver' AND vehicle_id=?", (vid,))
            if not assigned_driver:
                raise Problem('This vehicle has no assigned driver.',409)
            db.update('trips',{'vehicle_id':vid,'departure':departure,'driver_id':assigned_driver['id']},'id',tid)
            bump(db,trip)
        elif action == 'assign':
            oid = text(body,'order_id',1,40)
            order = entity(db,'orders',oid)
            if order['date'] != trip['date'] or order['status'] != 'Submitted' or db.one('SELECT order_id FROM stops WHERE order_id=?',(oid,)):
                raise Problem('Only unassigned submitted orders for this date can be added.',409)
            count = db.one('SELECT COALESCE(MAX(position),0) AS n FROM stops WHERE trip_id=?',(tid,))['n']
            db.insert('stops',{'order_id':oid,'trip_id':tid,'position':count+1,'loaded':order['units']})
            db.update('orders',{'status':'Planned'},'id',oid)
            bump(db,trip)
        elif action == 'unassign':
            oid = text(body,'order_id',1,40)
            if not db.one('SELECT order_id FROM stops WHERE trip_id=? AND order_id=?',(tid,oid)):
                raise Problem('Order is not on this run.',404)
            db.execute('DELETE FROM stops WHERE order_id=?',(oid,))
            db.update('orders',{'status':'Submitted'},'id',oid)
            bump(db,trip)
        elif action == 'reorder':
            ids = body.get('order_ids')
            existing = [s['order_id'] for s in db.all('SELECT order_id FROM stops WHERE trip_id=?',(tid,))]
            if not isinstance(ids,list) or not all(isinstance(i,str) for i in ids) or len(ids)!=len(set(ids)) or set(ids)!=set(existing):
                raise Problem('Include every stop exactly once.')
            for i,oid in enumerate(ids):
                db.update('stops',{'position':i+1},'order_id',oid)
            bump(db,trip)
        elif action == 'validate':
            require_role(user,'dispatcher')
            return route_report(db,tid)
        elif action == 'publish':
            report = route_report(db,tid)
            if not report['valid']:
                raise Problem('This run cannot be published. Resolve the failed plan checks.',409,report)
            db.update('trips',{'status':'Published','distance_km':report['distance_km'],'fuel_l':report['fuel_l'],'return_min':report['return_min'],'version':trip['version']+1},'id',tid)
            for stop in report['schedule']:
                db.update('stops',{'eta':stop['eta']},'order_id',stop['order_id'])
        elif action == 'load':
            require_role(user,'loader')
            if trip['status'] != 'Published':
                raise Problem('Loading is available only before the handoff.',409)
            oid = text(body,'order_id',1,40)
            stop = db.one('SELECT * FROM stops WHERE order_id=? AND trip_id=?',(oid,tid))
            if not stop:
                raise Problem('Order is not on this manifest.',404)
            order = entity(db,'orders',oid)
            count = number(body,'loaded',0,order['units'],True)
            verified = body.get('verified') is True
            if verified and count != order['units']:
                raise Problem('Replenish the shortage before verifying this order.',409)
            db.update('stops',{'loaded':count,'verified':int(verified)},'order_id',oid)
        elif action == 'release':
            require_role(user,'loader')
            if trip['status'] != 'Published':
                raise Problem('This trip is not awaiting loading.',409)
            checks = db.all('SELECT s.*,o.units FROM stops s JOIN orders o ON o.id=s.order_id WHERE trip_id=?',(tid,))
            if not checks or not all(s['verified'] and s['loaded']==s['units'] for s in checks):
                raise Problem('Every quantity must match and be verified before departure.',409)
            db.update('trips',{'status':'Loaded'},'id',tid)
            for s in checks:
                db.update('orders',{'status':'Loaded'},'id',s['order_id'])
            db.execute("UPDATE issues SET status='Resolved',resolution='Replenished and verified before departure.' WHERE kind='Loading shortage' AND order_id IN (SELECT order_id FROM stops WHERE trip_id=?)",(tid,))
        elif action == 'depart':
            require_role(user,'driver')
            if trip['status'] != 'Loaded':
                raise Problem('The loader must release this trip before departure.',409)
            db.update('trips',{'status':'On road'},'id',tid)
            db.execute("UPDATE orders SET status='On road' WHERE id IN (SELECT order_id FROM stops WHERE trip_id=?)",(tid,))
        elif action == 'arrive':
            require_role(user,'driver')
            oid = text(body,'order_id',1,40)
            pending = db.one('SELECT s.* FROM stops s LEFT JOIN deliveries d ON d.order_id=s.order_id WHERE s.trip_id=? AND d.order_id IS NULL ORDER BY s.position LIMIT 1',(tid,))
            if trip['status'] != 'On road' or not pending or pending['order_id'] != oid:
                raise Problem('Record arrival at the next undelivered stop.',409)
            db.update('stops',{'arrived_at':now()},'order_id',oid)
        elif action == 'return':
            require_role(user,'driver')
            pending = db.one('SELECT s.order_id FROM stops s LEFT JOIN deliveries d ON s.order_id=d.order_id WHERE s.trip_id=? AND d.order_id IS NULL',(tid,))
            if trip['status'] != 'On road' or pending:
                raise Problem('Record and sync every handover before returning the trip.',409)
            db.update('trips',{'status':'Completed'},'id',tid)
        event(db,user,tid,action.capitalize(),text(body,'order_id',0,40))
        return {'ok':True}
    match = re.fullmatch(r'/api/orders/([^/]+)/(defer|reopen|delivery|receipt|issue)',path)
    if match:
        oid,action = match.groups()
        order = entity(db,'orders',oid)
        if user['role']=='store' and order['outlet_id']!=user['outlet_id']:
            raise Problem('This order belongs to another outlet.',403)
        stop = db.one('SELECT * FROM stops WHERE order_id=?',(oid,))
        if action=='defer':
            require_role(user,'dispatcher')
            if order['status'] not in ('Submitted','Planned'):
                raise Problem('Only unpublished orders can be deferred.',409)
            if stop:
                trip = draft(db,user,stop['trip_id'],body)
                db.execute('DELETE FROM stops WHERE order_id=?',(oid,))
                bump(db,trip)
            reason = text(body,'reason',8,1000)
            revised = next_run(db,order['date'])
            db.update('orders',{'status':'Deferred','date':revised,'note':reason,'deferrals':order['deferrals']+1},'id',oid)
        elif action=='reopen':
            require_role(user,'dispatcher')
            if order['status']!='Deferred':
                raise Problem('This order is not deferred.',409)
            db.update('orders',{'status':'Submitted'},'id',oid)
        elif action=='delivery':
            require_role(user,'driver')
            if not stop:
                raise Problem('Order is not assigned to a trip.',409)
            trip = trip_access(db,user,stop['trip_id'])
            client_id = text(body,'client_id',16,80)
            digest = hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            existing = db.one('SELECT * FROM deliveries WHERE client_id=? OR order_id=?',(client_id,oid))
            if existing:
                if existing['client_id']==client_id and existing['order_id']==oid and existing['payload_hash']==digest:
                    return {'ok':True,'duplicate':True,'order_id':oid}
                raise Problem('A different delivery already exists for this order. Keep the saved record and ask the dispatcher to review it.',409)
            pending = db.one('SELECT s.order_id FROM stops s LEFT JOIN deliveries d ON d.order_id=s.order_id WHERE trip_id=? AND d.order_id IS NULL ORDER BY s.position LIMIT 1',(trip['id'],))
            if trip['status']!='On road' or not pending or pending['order_id']!=oid or not stop['verified']:
                raise Problem('Deliver the next stop after the verified loading handoff and departure.',409)
            qty = number(body,'quantity',0,stop['loaded'],True)
            recipient = text(body,'recipient',2,100)
            notes, reason = text(body,'notes'), text(body,'reason',0,100)
            if qty!=stop['loaded'] and len(reason)<3:
                raise Problem('Give a reason for a partial or refused delivery.')
            signature,photo = evidence(body,'signature'),evidence(body,'photo')
            unavailable = body.get('evidence_unavailable') is True
            if (not signature or not photo) and not unavailable:
                raise Problem('Capture a signature and photo, or explain unavailable evidence.')
            if unavailable and len(notes)<8:
                raise Problem('Explain why delivery evidence is unavailable.')
            recorded = text(body,'recorded_at',10,50)
            try:
                parsed = datetime.fromisoformat(recorded.replace('Z','+00:00'))
                if not parsed.tzinfo or parsed > datetime.now(timezone.utc)+timedelta(minutes=5):
                    raise ValueError()
            except ValueError:
                raise Problem('The delivery timestamp is invalid. Check the device clock.')
            db.insert('deliveries',{'order_id':oid,'client_id':client_id,'user_id':user['id'],'quantity':qty,'recipient':recipient,'reason':reason,'notes':notes,'signature':signature,'photo':photo,'evidence_unavailable':int(unavailable),'recorded_at':recorded,'synced_at':now(),'payload_hash':digest})
            db.update('orders',{'status':'Awaiting receipt'},'id',oid)
            if not stop['arrived_at']:
                db.update('stops',{'arrived_at':recorded},'order_id',oid)
            if reason:
                issue(db,user,oid,'Delivery exception',reason+': '+notes)
        elif action=='receipt':
            require_role(user,'store')
            delivery = db.one('SELECT * FROM deliveries WHERE order_id=?',(oid,))
            if not delivery or order['status']!='Awaiting receipt':
                raise Problem('A synchronized driver handover is required before confirming receipt.',409)
            qty = number(body,'quantity',0,order['units'],True)
            note = text(body,'note')
            if qty!=delivery['quantity'] and len(note)<5:
                raise Problem('Explain the difference from the driver-recorded quantity.')
            db.insert('receipts',{'order_id':oid,'user_id':user['id'],'quantity':qty,'note':note,'confirmed_at':now()})
            db.update('orders',{'status':'Receipt confirmed' if qty==delivery['quantity'] else 'Receipt issue'},'id',oid)
            if qty!=delivery['quantity']:
                issue(db,user,oid,'Receipt discrepancy',note)
        elif action=='issue':
            require_role(user,'store','loader','driver')
            if user['role'] in ('driver','loader'):
                if not stop:
                    raise Problem('This order is not in your workspace.',403)
                trip_access(db,user,stop['trip_id'])
            kind = 'Loading shortage' if user['role']=='loader' else 'Operational issue'
            issue(db,user,oid,kind,text(body,'note',5,1000))
        event(db,user,oid,action.capitalize(),text(body,'reason',0,1000) if action=='defer' else '')
        return {'ok':True}
    match = re.fullmatch(r'/api/issues/([^/]+)/resolve',path)
    if match:
        require_role(user,'dispatcher')
        record = entity(db,'issues',match[1])
        if record['status']!='Open':
            raise Problem('This issue is already resolved.',409)
        resolution = text(body,'resolution',8,1000)
        db.update('issues',{'status':'Resolved','resolution':resolution},'id',record['id'])
        # Receipt quantities remain factual; resolving an issue does not rewrite them.
        event(db,user,record['order_id'],'Issue resolved',resolution)
        return {'ok':True}
    raise Problem('API action not found.',404)

class Handler(BaseHTTPRequestHandler):
    server_version = 'Waypoint'
    def log_message(self, format, *args):
        LOG.info('%s %s',self.address_string(),format % args)

    def send_json(self,status,data,cookie=None):
        raw = json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.security_headers()
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def security_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")

    def session(self,db):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie',''))
        except Exception:
            raise Problem('Sign in to continue.',401)
        token = cookie.get('waypoint_session')
        if not token:
            raise Problem('Sign in to continue.',401)
        row = db.one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?',(hashlib.sha256(token.value.encode()).hexdigest(),now()))
        if not row:
            raise Problem('Your session expired. Sign in again; saved deliveries remain on this device.',401)
        return row

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path == '/api/health':
                with transaction() as db:
                    db.one('SELECT id FROM users LIMIT 1')
                return self.send_json(200,{'status':'ok'})
            if path == '/api/state':
                with transaction() as db:
                    data = snapshot(db,self.session(db))
                return self.send_json(200,data)
            if path.startswith('/api/'):
                raise Problem('API endpoint not found.',404)
            relative = unquote(path).lstrip('/') or 'index.html'
            file = (FRONTEND/relative).resolve()
            if not file.is_relative_to(FRONTEND.resolve()) or not file.is_file():
                raise Problem('File not found.',404)
            raw = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type',mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
            self.send_header('Cache-Control','no-cache')
            self.security_headers()
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except Problem as exc:
            self.send_json(exc.status,{'error':exc.message})
        except Exception:
            LOG.exception('Request failed')
            self.send_json(500,{'error':'The server could not complete this request. Your saved records are unchanged; retry.'})

    def do_POST(self):
        try:
            # Custom header cannot be set by an HTML cross-origin form; no CORS is enabled.
            if self.headers.get('X-Requested-With')!='Waypoint':
                raise Problem('Request must originate from the Waypoint application.',403)
            origin = self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host'):
                raise Problem('Cross-origin request rejected.',403)
            try:
                length = int(self.headers.get('Content-Length','0'))
            except ValueError:
                raise Problem('Invalid request size.',400)
            if not 0 < length <= 3500000:
                raise Problem('Request is empty or too large.',413)
            try:
                body = json.loads(self.rfile.read(length))
            except (ValueError,UnicodeDecodeError):
                raise Problem('Request must contain valid JSON.')
            if not isinstance(body,dict):
                raise Problem('Request must be a JSON object.')
            path = urlsplit(self.path).path
            cookie = None
            with transaction() as db:
                if path == '/api/login':
                    # Per-process throttling; also keep the service behind a host's proxy.
                    key = self.client_address[0]
                    attempts = self.server.login_attempts.setdefault(key,[])
                    attempts[:] = [t for t in attempts if t > time.time()-60]
                    if len(attempts)>=15:
                        raise Problem('Too many sign-in attempts. Wait one minute and try again.',429)
                    attempts.append(time.time())
                    user = db.one('SELECT * FROM users WHERE username=?',(text(body,'username',1,40).lower(),))
                    password = text(body,'password',1,200)
                    if not user or not password_matches(password,user['password_hash']):
                        raise Problem('The username or password does not match an account.',401)
                    token = secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<?',(now(),))
                    db.insert('sessions',{'token_hash':hashlib.sha256(token.encode()).hexdigest(),'user_id':user['id'],'expires':(datetime.now(timezone.utc)+timedelta(days=7)).isoformat()})
                    secure = '; Secure' if os.getenv('COOKIE_SECURE','false').lower()=='true' else ''
                    cookie = f'waypoint_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800{secure}'
                    data = snapshot(db,user)
                elif path == '/api/logout':
                    user = self.session(db)
                    parsed = SimpleCookie(self.headers.get('Cookie',''))
                    db.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(parsed['waypoint_session'].value.encode()).hexdigest(),))
                    cookie = 'waypoint_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
                    data = {'ok':True}
                else:
                    data = command(db,self.session(db),path,body)
            self.send_json(200,data,cookie)
        except Problem as exc:
            self.send_json(exc.status,{'error':exc.message,'details':exc.details})
        except Exception:
            LOG.exception('Action failed')
            self.send_json(500,{'error':'The action could not be saved. Refresh and retry; local delivery records remain available.'})

def setup():
    initialize()
    with transaction() as db:
        seed(db)

def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    setup()
    server = ThreadingHTTPServer((os.getenv('HOST','0.0.0.0'),int(os.getenv('PORT','8000'))),Handler)
    server.login_attempts = {}
    LOG.info('Waypoint listening on port %s',server.server_port)
    server.serve_forever()

if __name__=='__main__':
    main()
