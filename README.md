# Momentum · Waypoint

A working delivery workspace for Tech-Triathlon 2026. One shared workflow connects store requests, validated dispatcher allocation, loading verification, driver handovers, offline synchronization, and store receipt confirmation.

Built from the Momentum Designathon interface in `Waypoint-Frontend`. This monorepo contains the frontend, Python API, PostgreSQL-compatible data layer, reference CSVs, tests, and submission documentation.

## Run the complete stack

Install Docker Engine/Desktop with Compose v2. From this repository root:

```sh
docker compose up --build
```

Open **http://localhost:8000**. PostgreSQL starts first, then the app creates its schema and imports seed data automatically. No separate migrations or seed commands are required. `docker compose up` works with the included defaults even without an `.env` file. For configuration, copy `.env.example` to `.env`; never commit real secrets. Keep database passwords alphanumeric unless you explicitly URL-encode the connection string.

`docker compose down` preserves database data. Do not delete the database volume during a judge review. Seeds only run against an empty database, so restarting the stack preserves work.

## Quick local run without Docker

Python 3.12+ is enough for the SQLite development mode; no third-party packages are required:

```powershell
./start-local.ps1
```

Or on any platform:

```sh
DEMO_CLOCK=2026-06-23T15:00:00+05:30 python backend/server.py
```

The Bash assignment above is not PowerShell syntax. In PowerShell use `$env:DEMO_CLOCK='2026-06-23T15:00:00+05:30'` before running Python. Local data is stored in `var/waypoint.db`. PostgreSQL deployments require `pip install -r requirements.txt` and `DATABASE_URL`. `HOST` defaults to `0.0.0.0`; `PORT` defaults to `8000`.

## Seeded judge credentials

| Role | Username | Default password | Scope |
|---|---|---|---|
| Store manager | `store` | `demo123` | OUT002 |
| Dispatcher | `dispatch` | `demo123` | Full network |
| Loader | `loader` | `demo123` | Peliyagoda manifests |
| Driver | `driver` | `demo123` | Assigned runs |

`SEED_PASSWORD` changes the initial password for all four accounts only when seeding an empty database. Passwords use salted PBKDF2 hashes. The optional administrator from the Designathon is outside the required four-role workflow.

The fleet also has 59 additional seeded driver accounts (`driver-veh001`, etc.), each using the same configured seed password and scoped to its own vehicle. The judge's `driver` account operates `VEH035`. Selecting a vehicle automatically assigns its own driver; existing fleet driver availability is not a separate allocation constraint.

## Numbered judge walkthrough

Use separate browser profiles/incognito windows to keep multiple accounts signed in at once. A browser profile has one active login; different profiles see the same server data. The app refreshes every 15 seconds when there are no unsaved form edits; Refresh fetches changes immediately.

1. **Store (`store`)**: inspect My orders and open `WP-1042`. It is a 40-crate chilled request for OUT002. Create an additional small Ambient request for **June 24, 2026** to demonstrate genuine order creation. Keep that new request unassigned for the core walkthrough, or explicitly defer it in step 3.
2. **Dispatcher (`dispatch`)**: open Planning. The seeded `TR-001` draft already contains OUT001 → OUT002 → OUT003, uses refrigerated van `VEH035`, and departs at 04:30. Open each plan check. Save `VEH037` to demonstrate the temperature failure, or `VEH001` to demonstrate van-only access failure; restore `VEH035` afterward. An 08:00 departure demonstrates late windows; restore 04:30. Add mall order `WP-1050` to demonstrate the volume failure, then Remove it from the run.
3. **Dispatcher**: record explicit deferrals for unassigned requests with reasons and next actions. `WP-1050` has a previous deferral: explain why the selected run lacks volume and note that a later compatible run is needed. `WP-1051` is an oversized indivisible bulk request (8,200 kg / 42 m³), exceeding every vehicle: defer it with a reason requesting a revised split shipment. You can instead create another valid run for the mall request; manual allocation with validation is the chosen planning strategy.
4. **Dispatcher**: Validate run, then Publish plan. Published allocations lock. The manifest and estimated arrivals now appear for the loader and driver.
5. **Loader (`loader`, test at phone width)**: open Loading. The list is reversed for loading: OUT003 first, then OUT002, then OUT001. OUT003 initially has 15 of 20 crates. Report the five-crate shortage; the dispatcher can see it in Issues. The handoff remains blocked. Replenish the count to 20, Save count, and Verify quantity. Verify the other two orders, then Confirm loading handoff.
6. **Driver (`driver`, test at phone width)**: open My trip and Start trip. At OUT001 choose I have arrived, then Record handover. Enter 30 crates and a recipient. Draw a signature and upload a photo. If evidence cannot be captured, select unavailable evidence and explain why in notes. Save delivery.
7. **Driver offline scenario**: while online open the next stop (OUT002) and let the page load. Disconnect the browser network using developer tools, or disconnect the device. Confirm arrival, record 40 crates and recipient/evidence, and Save delivery. Sync displays Pending sync. Reload while offline to confirm the application and queued record persist. Continue to OUT003 and save its 20-crate handover offline if desired.
8. **Driver recovery**: restore connectivity. Synchronization retries automatically, or use Retry synchronization in Sync. A record is removed from the queue only after server acknowledgment. Repeated delivery uploads are idempotent. Complete any remaining stops and Confirm depot return after all records sync.
9. **Store (`store`)**: Refresh, open `WP-1042`, inspect driver evidence and separate recorded/synchronized times, then confirm 40 received crates. Alternatively confirm 39 with a discrepancy explanation to demonstrate issue creation.
10. **Dispatcher**: open Trips and Issues. Review shared progress, shortage resolution, and any receipt discrepancy. Record a resolution. Original delivered and received quantities remain intact in the database and audit history.

## Design continuity and significant departures

- Preserved Waypoint's submitted visual language, role-specific navigation, Request → Plan → Load → Deliver → Sync → Receive → Resolve journey, reverse loading order, evidence capture, and separate driver/store checkpoints.
- Replaced local simulated accounts and operational state with server-enforced roles, shared SQL data, auditable transitions, HttpOnly sessions, and database transactions.
- Replaced simulated offline toggles with a service worker, IndexedDB queue/drafts, real network recovery, and server-enforced idempotency. Planning, loading, and receipt confirmation require connectivity; driver arrival and handover capture work offline.
- Expanded planning beyond the fixed three-stop prototype: any compatible orders can be assigned, reordered, removed, or deferred; multiple runs can be created. Capacity, depot, access, windows, return timing, daily route count, driver overlap, and weekly fuel are checked again transactionally at publication.
- Seeded **June 24, 2026** rather than the prototype's September date because the supplied calendar ends June 28. A clearly displayed configurable fixed clock makes order-cutoff demonstrations repeatable. Unset `DEMO_CLOCK` to use actual Sri Lanka time. Outside calendar coverage, Monday–Saturday is the documented fallback; unknown public holidays are not inferred.
- No invented precise coordinates, GPS, telephone contacts, live traffic, or trained ML. See [planning assumptions](docs/PLANNING.md). A large request is treated as indivisible; splitting requires a revised order. Datathon predictions remain outside Hackathon scope.
- The optional local administrator and mock capacity charts are omitted. Four required roles, operational audit, and constraint enforcement take priority.

## Configuration and deployment

See [deployment instructions](docs/DEPLOYMENT.md). **Vercel + PostgreSQL through its Marketplace** is the primary deployment path, using `vercel.json` and `api/index.py`. Serverless mode requires a persistent PostgreSQL connection and refuses ephemeral SQLite. `render.yaml` remains an optional alternative. A host with Docker can also run the same Compose stack behind an HTTPS proxy. Set `COOKIE_SECURE=true` for public HTTPS. Offline caching requires HTTPS or localhost. Deploy the API and database alongside the frontend.

This repository does not claim a deployment URL or YouTube video until those external artifacts exist. Complete [the submission checklist](docs/SUBMISSION.md) before submitting the competition form.

## Validation

```sh
python -m unittest discover -s tests -v
node --check frontend/app.js
node --check frontend/sw.js
```

The integration tests run against a disposable SQLite database and cover four-role handoffs, role boundaries, plan constraints, loading gates, discrepancies, stale planning versions, delivery idempotency, cutoff, and persistence. Set `TEST_DATABASE_URL` to a **fresh disposable PostgreSQL database named `*_test`** and run `python tests/postgres-smoke.py` for the PostgreSQL four-role workflow and idempotency check. `.github/workflows/verify.yml` runs the tests, PostgreSQL smoke workflow, and the complete Docker Compose stack in GitHub Actions. Browser verification scripts live under `tests/` and require Playwright; `BROWSER_CHANNEL` defaults to installed Microsoft Edge.

## Project map

```text
backend/       API, authentication, SQL adapter, seed, planning validation
api/           Vercel Python Function entry point
frontend/      Responsive application, service worker, IndexedDB persistence
data/          Five supplied CSVs, preserved from the Designathon reference data
docs/          Architecture, data model, AI disclosure, deployment, video script
tests/         Workflow/constraint integration tests and browser verification
compose.yaml   Complete application + PostgreSQL stack
.env.example   Configuration reference
render.yaml    Public hosting blueprint
vercel.json    Vercel functions and static routing
```

Health endpoint: `/api/health`. Seed data and service/distance calculations are synthetic competition data. The four judge passwords are intentionally shared demonstration credentials; do not use this fixture for real business operations without changing account provisioning and operational policies.
