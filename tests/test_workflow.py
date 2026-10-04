import copy
import hashlib
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from db import initialize, transaction
from domain import Problem, earliest_order_day, next_run, route_report
from seed import seed, password_matches
from server import Handler, command, snapshot
from http.server import ThreadingHTTPServer

class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline=tempfile.TemporaryDirectory()
        cls.fixture=Path(cls.baseline.name)/'fixture.db'
        original={k:os.environ.get(k) for k in ['SQLITE_PATH','DATABASE_URL']}
        try:
            os.environ['SQLITE_PATH']=str(cls.fixture)
            os.environ['DATABASE_URL']=''
            initialize()
            with transaction() as db:seed(db)
        finally:
            for key,value in original.items():
                if value is None:os.environ.pop(key,None)
                else:os.environ[key]=value

    @classmethod
    def tearDownClass(cls):
        cls.baseline.cleanup()

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.original={k:os.environ.get(k) for k in ['SQLITE_PATH','DATABASE_URL','DEMO_CLOCK']}
        os.environ['SQLITE_PATH']=str(Path(self.tmp.name)/'test.db')
        os.environ['DATABASE_URL']=''
        os.environ['DEMO_CLOCK']='2026-06-23T15:00:00+05:30'
        shutil.copyfile(self.fixture,Path(os.environ['SQLITE_PATH']))
        initialize()
        with transaction() as db:
            seed(db)
            self.users={u['id']:u for u in db.all('SELECT * FROM users')}

    def tearDown(self):
        for key,value in self.original.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value
        self.tmp.cleanup()

    def run_action(self,user,path,body=None):
        with transaction() as db:return command(db,self.users[user],path,body or {})

    def state(self,user='dispatch'):
        with transaction() as db:return snapshot(db,self.users[user])

    def publish(self):
        self.run_action('dispatch','/api/trips/TR-001/publish',{'version':1})

    def road_ready(self):
        self.publish()
        for oid,count in [('WP-1038',30),('WP-1042',40),('WP-1049',20)]:
            self.run_action('loader','/api/trips/TR-001/load',{'order_id':oid,'loaded':count,'verified':True})
        self.run_action('loader','/api/trips/TR-001/release')
        self.run_action('driver','/api/trips/TR-001/depart')

    def handover(self,oid,count,client=None):
        body={'client_id':client or 'test-'+oid+'-delivery-uuid','quantity':count,'recipient':'Receiving lead','reason':'','notes':'Camera unavailable on test device.','signature':'','photo':'','evidence_unavailable':True,'recorded_at':datetime.now(timezone.utc).isoformat()}
        return body,self.run_action('driver',f'/api/orders/{oid}/delivery',body)

    def test_four_role_workflow_duplicate_and_receipt_discrepancy(self):
        self.road_ready()
        first,_=self.handover('WP-1038',30)
        payload,_=self.handover('WP-1042',40)
        _,_=self.handover('WP-1049',20)
        duplicate=self.run_action('driver','/api/orders/WP-1042/delivery',payload)
        self.assertTrue(duplicate['duplicate'])
        with self.assertRaises(Problem):
            self.run_action('driver','/api/orders/WP-1042/delivery',{**payload,'quantity':39,'reason':'Shortfall'})
        self.run_action('store','/api/orders/WP-1042/receipt',{'quantity':39,'note':'One crate missing at receipt.'})
        state=self.state()
        self.assertEqual(next(o for o in state['orders'] if o['id']=='WP-1042')['status'],'Receipt issue')
        record=next(i for i in state['issues'] if i['kind']=='Receipt discrepancy')
        self.run_action('dispatch',f"/api/issues/{record['id']}/resolve",{'resolution':'Replacement crate scheduled and receiving lead informed.'})
        self.run_action('driver','/api/trips/TR-001/return')
        state=self.state()
        self.assertEqual(state['trips'][0]['status'],'Completed')
        self.assertEqual(next(r for r in state['receipts'] if r['order_id']=='WP-1042')['quantity'],39)
        self.assertEqual(len(state['deliveries']),3)

    def test_seed_datasets_and_valid_route(self):
        state=self.state()
        self.assertEqual(len(state['outlets']),120)
        self.assertEqual(len(state['vehicles']),60)
        self.assertEqual(sum(v['temp']=='reefer' for v in state['vehicles']),16)
        self.assertTrue(state['reports']['TR-001']['valid'])
        self.assertGreater(state['reports']['TR-001']['distance_km'],0)
        with transaction() as db:
            self.assertTrue(password_matches('demo123',self.users['store']['password_hash']))
            self.assertNotEqual(self.users['store']['password_hash'],'demo123')
            count=db.one('SELECT COUNT(*) AS n FROM orders')['n'];seed(db)
            self.assertEqual(db.one('SELECT COUNT(*) AS n FROM orders')['n'],count)

    def test_temperature_access_depot_and_windows_block_publication(self):
        for changes,failed in [({'vehicle_id':'VEH037'},'Temperature'),({'vehicle_id':'VEH001'},'Outlet access'),({'vehicle_id':'VEH057'},'Home depot'),({'departure':'08:00'},'Delivery windows')]:
            with self.subTest(failed=failed):
                with transaction() as db:
                    db.update('trips',{'vehicle_id':'VEH035','departure':'04:30',**changes},'id','TR-001')
                    report=route_report(db,'TR-001')
                    self.assertFalse(next(c for c in report['checks'] if c['name']==failed)['ok'])
                with self.assertRaises(Problem):self.run_action('dispatch','/api/trips/TR-001/publish',{'version':1})
        self.assertEqual(self.state()['trips'][0]['status'],'Draft')

    def test_volume_overflow_and_stale_plan_conflict(self):
        self.run_action('dispatch','/api/trips/TR-001/assign',{'order_id':'WP-1050','version':1})
        report=self.state()['reports']['TR-001']
        self.assertFalse(next(c for c in report['checks'] if c['name']=='Volume capacity')['ok'])
        with self.assertRaises(Problem):self.run_action('dispatch','/api/trips/TR-001/publish',{'version':2})
        with self.assertRaises(Problem):self.run_action('dispatch','/api/trips/TR-001/unassign',{'order_id':'WP-1050','version':1})
        self.run_action('dispatch','/api/trips/TR-001/unassign',{'order_id':'WP-1050','version':2})
        self.assertTrue(self.state()['reports']['TR-001']['valid'])

    def test_loading_gate_and_locked_manifest(self):
        self.publish()
        with self.assertRaises(Problem):self.run_action('loader','/api/trips/TR-001/release')
        with self.assertRaises(Problem):self.run_action('driver','/api/trips/TR-001/depart')
        with self.assertRaises(Problem):self.run_action('loader','/api/trips/TR-001/load',{'order_id':'WP-1049','loaded':15,'verified':True})
        with self.assertRaises(Problem):self.run_action('dispatch','/api/trips/TR-001/settings',{'version':2,'vehicle_id':'VEH037','departure':'04:30'})
        self.run_action('loader','/api/orders/WP-1049/issue',{'note':'Five crates missing from loading bay.'})
        self.assertEqual(self.state()['issues'][0]['kind'],'Loading shortage')

    def test_role_boundaries_and_store_scope(self):
        for user,path,body in [('store','/api/trips/TR-001/publish',{'version':1}),('driver','/api/trips/TR-001/release',{}),('loader','/api/orders/WP-1042/receipt',{'quantity':40,'note':''}),('store','/api/orders/WP-1038/issue',{'note':'Unauthorized outlet record.'})]:
            with self.subTest(user=user,path=path):
                with self.assertRaises(Problem) as raised:self.run_action(user,path,body)
                self.assertEqual(raised.exception.status,403)
        self.assertTrue(all(o['outlet_id']=='OUT002' for o in self.state('store')['orders']))
        self.assertEqual(self.state('driver')['orders'],[])

    def test_order_cutoff_calendar_and_deferral(self):
        with transaction() as db:
            self.assertEqual(earliest_order_day(db),'2026-06-24')
            self.assertEqual(next_run(db,'2026-06-27'),'2026-06-29')
        os.environ['DEMO_CLOCK']='2026-06-23T16:00:00+05:30'
        with transaction() as db:self.assertEqual(earliest_order_day(db),'2026-06-25')
        with self.assertRaises(Problem):self.run_action('store','/api/orders',{'date':'2026-06-24','temperature':'Ambient','units':1,'weight':8,'volume':0.1,'note':''})
        created=self.run_action('store','/api/orders',{'date':'2026-06-25','temperature':'Ambient','units':1,'weight':8,'volume':0.1,'note':''})
        self.assertTrue(created['id'].startswith('WP-'))
        self.run_action('dispatch','/api/orders/WP-1051/defer',{'reason':'Exceeds every vehicle. Request revised split shipment.'})
        o=next(o for o in self.state()['orders'] if o['id']=='WP-1051')
        self.assertEqual((o['date'],o['original_date'],o['status']),('2026-06-25','2026-06-24','Deferred'))

    def test_daily_routes_fuel_and_vehicle_turnaround(self):
        self.publish()
        for oid,departure in [('WP-1050','04:30'),('WP-1051','09:00')]:
            created=self.run_action('dispatch','/api/trips',{'vehicle_id':'VEH035','driver_id':'driver','date':'2026-06-24','departure':departure})
            tid=created['id'];self.run_action('dispatch',f'/api/trips/{tid}/assign',{'order_id':oid,'version':1})
            if departure=='04:30':
                self.assertFalse(next(c for c in self.state()['reports'][tid]['checks'] if c['name']=='Vehicle turnaround')['ok'])
            with transaction() as db:db.update('trips',{'status':'Published','return_min':750,'fuel_l':400},'id',tid)
        with transaction() as db:
            report=route_report(db,'TR-001')
            self.assertFalse(next(c for c in report['checks'] if c['name']=='Two routes per day')['ok'])
            self.assertFalse(next(c for c in report['checks'] if c['name']=='Weekly fuel quota')['ok'])

    def test_delivery_sequence_evidence_validation_and_receipt_gate(self):
        self.road_ready()
        with self.assertRaises(Problem):self.handover('WP-1042',40)
        with self.assertRaises(Problem):self.run_action('store','/api/orders/WP-1042/receipt',{'quantity':40,'note':''})
        body={'client_id':'test-evidence-invalid-000','quantity':30,'recipient':'Receiving lead','reason':'','notes':'','signature':'javascript:alert(1)','photo':'','evidence_unavailable':False,'recorded_at':datetime.now(timezone.utc).isoformat()}
        with self.assertRaises(Problem):self.run_action('driver','/api/orders/WP-1038/delivery',body)
        self.assertEqual(self.state()['deliveries'],[])

    def test_transactions_rollback_invalid_assignment(self):
        with self.assertRaises(Problem):self.run_action('dispatch','/api/trips/TR-001/reorder',{'version':1,'order_ids':['WP-1038','WP-1038','WP-1049']})
        self.assertEqual(self.state()['trips'][0]['version'],1)

    def test_http_auth_csrf_cookie_and_persistence(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.login_attempts={}
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        try:
            with self.assertRaises(urllib.error.HTTPError) as exc:opener.open(base+'/api/state')
            self.assertEqual(exc.exception.code,401)
            payload=json.dumps({'username':'dispatch','password':'demo123'}).encode()
            req=urllib.request.Request(base+'/api/login',data=payload,headers={'Content-Type':'application/json','X-Requested-With':'Waypoint'})
            with opener.open(req) as response:
                self.assertIn('HttpOnly',response.headers['Set-Cookie']);self.assertIn('SameSite=Strict',response.headers['Set-Cookie'])
            with opener.open(base+'/api/state') as response:self.assertEqual(json.load(response)['user']['role'],'dispatcher')
            req=urllib.request.Request(base+'/api/trips/TR-001/publish',data=b'{"version":1}',headers={'Content-Type':'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as exc:opener.open(req)
            self.assertEqual(exc.exception.code,403)
            self.publish()
            with opener.open(base+'/api/state') as response:self.assertEqual(json.load(response)['trips'][0]['status'],'Published')
            initialize()
            with transaction() as db:seed(db)
            self.assertEqual(self.state()['trips'][0]['status'],'Published')
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
