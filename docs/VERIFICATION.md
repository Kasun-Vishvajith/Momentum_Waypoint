# Verification report

Verified on October 4, 2026 using the bundled Python runtime and Playwright with installed Microsoft Edge.

## Local integration tests — passed

12 tests cover:

- Full dispatcher → loader → driver → store workflow and depot return.
- Delivery retry/idempotency and rejection of conflicting records.
- Store receipt discrepancies and factual quantities retained after resolution.
- Shared datasets: 120 outlets, 60 vehicles, 16 refrigerated vehicles.
- Temperature, vehicle access, home depot, window, and volume failures blocking publication.
- Weekly fuel reservations, two-run daily maximum, and vehicle turnaround.
- Role/outlet boundaries and server-side loading release gates.
- 4 PM cutoff, operating-day rollover, and explicit deferrals retaining original dates.
- Stale draft versions, invalid sequence rollback, raster evidence validation.
- HttpOnly/SameSite cookies, unauthenticated requests, CSRF header rejection.
- Restart/startup seed preserves existing operational records.

JavaScript syntax checks passed for the application and service worker.

## Browser walkthrough — passed

Automated browser checks completed the actual interface using separate browser contexts:

- Desktop dispatcher at 1440 × 1000; phone loader/driver at 390 × 844.
- Temperature violation disables Publish; restoring the compatible van allows publication.
- Loader shortage blocks handoff; replenishment and all quantity verifications release it.
- Genuine pointer-drawn signature and uploaded raster photo reach the server.
- Real browser network disconnection; handover saves to IndexedDB.
- Offline page reload retains the application shell, manifest, and queued record.
- Two sequential offline handovers synchronize on reconnection without duplicates.
- Store records its separate receipt and creates a discrepancy.
- Dispatcher resolves the issue; trip reaches Completed and three handovers remain unique.
- No JavaScript page errors; tested desktop and phone layouts have no horizontal overflow.

The reproducible test is `tests/browser-check.cjs`. Screenshots and machine-readable report are generated under ignored `test-results/`; they are local verification evidence, not application seed data.

## Checks requiring external infrastructure

Docker Desktop and a PostgreSQL service are not installed locally, so local runs use SQLite. **GitHub Actions passed** the PostgreSQL seed/four-role/idempotency workflow, Compose configuration validation, complete `docker compose up --build -d --wait`, and HTTP health check. [Verified run](https://github.com/Kasun-Vishvajith/Momentum_Waypoint/actions/runs/37182626297), implementation commit `8cb496a`.

Public deployment, HTTPS-origin offline behavior, hosting persistence/restarts, and the narrated YouTube video must be verified against their actual external artifacts. See `docs/SUBMISSION.md` for status and links. No public hosting or video completion is claimed solely from local verification.

