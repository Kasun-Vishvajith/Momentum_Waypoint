# Planning and allocation

The chosen strategy is **manual allocation with transactionally enforced validation**, permitted by the Hackathon brief. Dispatchers can create multiple runs, select any supplied vehicle and driver, assign/remove eligible orders, reorder stops, inspect every validation failure, and publish only a valid allocation. Unassigned and deferred requests remain explicit in the queue.

## Checks at publication

1. Both total weight and volume fit the vehicle independently.
2. Chilled/frozen goods use a refrigerated vehicle; ambient goods may also use it.
3. Every assigned outlet matches the vehicle home depot; van-only outlets use vans.
4. Every order belongs to the trip's operating date. The plan contains at least one stop.
5. Stop estimates satisfy outlet receiving windows; Fresh arrival is no later than its closing window and 8 AM. Mall unloading must also finish before fixed access closes.
6. The vehicle returns to its home depot the same day. The next published run must not overlap its occupied interval.
7. At most two published routes use a vehicle on a day. No assigned driver is scheduled for overlapping runs.
8. This run's fuel plus all other published/completed reservations for the ISO week fits the weekly quota.

Drafts can contain violations to let the dispatcher explore alternatives. Validation is shown immediately in snapshots, but every check is recomputed under the database transaction when Publish is pressed. A successful earlier validation never overrides a later failed publication check.

## Transparent travel assumptions

- Same-district movement uses `district_travel.csv` inter-stop distance/time; depot legs use the supplied district-depot values.
- Cross-district movement is conservatively estimated via the vehicle's home depot because precise outlet coordinates and a district-to-district matrix are not supplied. This can reject routes that would be feasible with richer data; no geometric optimality is claimed.
- Service time uses the supplied brand/dock-type allowance. No trained service-time prediction is used.
- Monsoon calendar dates apply a documented **20% travel-time buffer**. This is a chosen safety margin, not an observed or trained forecast.
- Vehicles may wait for a receiving window to open. The return estimate includes travel, waiting, and service time.
- Fuel is distance divided by supplied km/L; quota reservation starts with the seeded system's published routes. Prior real-world consumption is outside this synthetic fixture.
- `calendar.csv` is authoritative where present. Outside its range, Monday–Saturday is the explicit fallback; holiday closures outside supplied coverage are unknown.

## Demand exceeding capacity

The fixture includes a mall order that cannot fit the selected chilled van alongside the morning run and an 8,200 kg / 42 m³ bulk order exceeding the maximum individual vehicle limits. Orders are indivisible in this implementation; the dispatcher must explain a deferral or request a revised split shipment. The queue keeps previous deferral counts visible, maintains original date, and advances deferred requests to the next operating run. The application permits another compatible mall run rather than pretending every unassigned order must be deferred.

An operational deployment would add split-order handling, real weekly opening balances, verified travel matrices, and richer driver provisioning. Datathon models could replace deterministic service/travel assumptions later without changing the handoff workflow.
