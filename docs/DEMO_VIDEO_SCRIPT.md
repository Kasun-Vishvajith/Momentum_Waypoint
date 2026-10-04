# Hackathon video script — target 6 minutes 45 seconds

The reproducible narrated local draft uses `docs/VIDEO_NARRATION.json` and `tests/record-demo.cjs` and targets 7 minutes 34 seconds. Review it and upload it as unlisted; the shorter outline below is an alternative for a team-recorded video.

Record the actual running application at a readable desktop size; show the loader and driver at phone width. Upload the narrated result to YouTube as **unlisted**. A script is not a submitted video.

| Time | Screen and narration |
|---|---|
| 0:00–0:25 | Introduce Momentum's Waypoint: one shared delivery workspace connecting all four roles, based on the Day 5 submission. Show the public URL. |
| 0:25–0:55 | Store My orders and WP-1042. Show request creation, weight/volume/handling, cutoff eligibility, and planned receipt checkpoint. Explain the June calendar fixture and visible demo clock briefly. |
| 0:55–2:10 | Dispatcher Planning. Show the three Fresh outlets, the refrigerated van, route ordering, separate capacity checks, and an incompatible vehicle failure. Restore the valid plan. Show a documented oversized-order deferral and the previous-deferral warning. Validate and publish. |
| 2:10–3:05 | Loader at phone width. Show reverse loading order, five missing crates, shortage report, blocked handoff, replenishment, quantity verification, and manifest release. |
| 3:05–4:30 | Driver at phone width. Start trip and record a stop. Capture recipient/signature/photo or explained unavailable evidence. Disconnect the browser network at the next stop, save a real handover, open Sync, reload offline, then reconnect and demonstrate acknowledgment without a duplicate. |
| 4:30–5:15 | Store receives synchronized WP-1042 handover. Show evidence and separate recorded/synced times. Confirm receipt, optionally with a discrepancy. Dispatcher reviews/resolves the resulting issue without altering the original quantities. |
| 5:15–6:20 | Show docs/ARCHITECTURE.md and DATA_MODEL.md. Explain same-origin browser/API/PostgreSQL, server role checks, transactional plan validation, hashed sessions, device queue and idempotent uploads. Show compose.yaml and the test results. |
| 6:20–6:45 | Explain transparent travel assumptions and AI assistance. State the public URL, source repository, credentials, and that the deployment stays live for review. |

Capture only working behavior. Do not say GPS, live traffic, ML predictions, all-stack Docker verification, or cloud deployment is complete unless you have demonstrated it. Keep staging/reset work outside the video; use a fresh disposable database to make the recording repeatable.

