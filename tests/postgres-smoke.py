"""Run only against a new disposable PostgreSQL database ending in _test."""
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
url=os.getenv('TEST_DATABASE_URL','')
if not url or not urlsplit(url).path.endswith('_test'):
    raise SystemExit('Set TEST_DATABASE_URL to a fresh disposable PostgreSQL database named *_test.')
os.environ['DATABASE_URL']=url
os.environ['DEMO_CLOCK']='2026-06-23T15:00:00+05:30'
from db import initialize,transaction
from seed import seed
from server import command,snapshot
initialize()
with transaction() as db:
    if db.one('SELECT id FROM users LIMIT 1'):
        raise SystemExit('Use an empty disposable test database; this script does not reset existing data.')
    seed(db)
    users={u['id']:u for u in db.all('SELECT * FROM users')}
def act(user,path,body=None):
    with transaction() as db:return command(db,users[user],path,body or {})
act('dispatch','/api/trips/TR-001/publish',{'version':1})
for oid,count in [('WP-1038',30),('WP-1042',40),('WP-1049',20)]:
    act('loader','/api/trips/TR-001/load',{'order_id':oid,'loaded':count,'verified':True})
act('loader','/api/trips/TR-001/release')
act('driver','/api/trips/TR-001/depart')
for oid,count in [('WP-1038',30),('WP-1042',40),('WP-1049',20)]:
    payload={'client_id':'postgres-test-'+oid,'quantity':count,'recipient':'Receiving lead','reason':'','notes':'Camera unavailable on test device.','signature':'','photo':'','evidence_unavailable':True,'recorded_at':datetime.now(timezone.utc).isoformat()}
    act('driver',f'/api/orders/{oid}/delivery',payload)
    assert act('driver',f'/api/orders/{oid}/delivery',payload)['duplicate']
act('store','/api/orders/WP-1042/receipt',{'quantity':40,'note':''})
act('driver','/api/trips/TR-001/return')
with transaction() as db:
    state=snapshot(db,users['dispatch'])
    assert len(state['deliveries'])==3
    assert state['trips'][0]['status']=='Completed'
    assert state['receipts'][0]['quantity']==40
print('PostgreSQL seed, publication, four-role handoff, idempotency, and receipt passed.')
