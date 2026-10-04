"use strict";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  box: "m3 7 9-4 9 4-9 4Zm0 0v10l9 4 9-4V7M12 11v10",
  route:
    "M6 5a2 2 0 1 0 0 .01M18 19a2 2 0 1 0 0 .01M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7",
  truck:
    "M2 5h13v12H2Zm13 5h4l3 4v3h-7M7 18a2 2 0 1 0 0 .01M18 18a2 2 0 1 0 0 .01",
  check: "m5 12 4 4L19 6",
  alert: "m12 3 10 18H2Zm0 6v5m0 3v.1",
  plus: "M12 5v14M5 12h14",
  sync: "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
  help: "M9 8a3 3 0 1 1 5 3l-2 2m0 4v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  store: "M3 10v11h18V10M2 10l2-7h16l2 7M2 10h20M9 21v-7h6v7",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1",
  logout: "M9 3H3v18h6m5-14 5 5-5 5M7 12h12",
  back: "M20 12H4m6-6-6 6 6 6",
};
const icon = (n) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[n] || paths.box}"/></svg>`;
const badge = (s, c = "") => `<span class="badge ${c}">${esc(s)}</span>`;
const tone = (s) =>
  /confirmed|Completed|Resolved|Loaded/i.test(s)
    ? "green"
    : /issue|shortage/i.test(s)
      ? "red"
      : /Deferred|Awaiting|device|Published/i.test(s)
        ? "amber"
        : "blue";
const button = (label, action, id = "", cls = "", disabled = false, i = "") =>
  `<button type="button" class="btn ${cls}" data-action="${action}" data-id="${esc(id)}" ${disabled ? "disabled" : ""}>${i ? icon(i) : ""}${esc(label)}</button>`;
const link = (label, path, cls = "btn", i = "") =>
  `<a class="${cls}" href="#/${path}">${i ? icon(i) : ""}${esc(label)}</a>`;
const notice = (message, c = "blue") =>
  `<div class="notice ${c}">${icon(c === "red" ? "alert" : "help")}<div>${message}</div></div>`;
const pair = (label, value) =>
  `<div class="summary-pair"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const header = (title, subtitle, actions = "") =>
  `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
const empty = (title, message) =>
  `<div class="empty">${icon("box")}<h2>${esc(title)}</h2><p>${esc(message)}</p></div>`;
const roleNames = {
  store: "Store manager",
  dispatcher: "Dispatcher",
  loader: "Bay loader",
  driver: "Driver",
};
const nav = {
  store: [
    ["orders", "box", "My orders"],
    ["outlet", "store", "My outlet"],
  ],
  dispatcher: [
    ["overview", "home", "Overview"],
    ["planning", "route", "Planning"],
    ["trips", "truck", "Trips"],
    ["issues", "alert", "Issues"],
  ],
  loader: [
    ["loading", "box", "Loading"],
    ["history", "list", "History"],
  ],
  driver: [
    ["my-trip", "route", "My trip"],
    ["sync", "sync", "Sync"],
    ["history", "list", "History"],
  ],
};
let D = null,
  queue = [],
  online = navigator.onLine,
  busy = false,
  dirty = false,
  selectedTrip = "",
  planningDay = "2026-06-24",
  signature = "",
  photo = "",
  drawn = false,
  toastTimer;
let dbPromise;
function storage() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("waypoint-live", 1);
      req.onupgradeneeded = () => {
        for (const name of ["cache", "queue", "drafts"])
          req.result.createObjectStore(name, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(
          new Error(
            "Device storage is unavailable. Enable browser storage before recording offline deliveries.",
          ),
        );
    });
  return dbPromise;
}
async function dbOperation(store, method, value) {
  const db = await storage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      store,
      method === "get" || method === "getAll" ? "readonly" : "readwrite",
    );
    const req = tx.objectStore(store)[method](value);
    let result;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(
        new Error(
          "Device storage could not save your record. Free storage and retry.",
        ),
      );
    tx.onerror = () =>
      reject(
        new Error(
          "Device storage could not save your record. Free storage and retry.",
        ),
      );
  });
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 6000);
}
async function api(path, body) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", "X-Requested-With": "Waypoint" }
        : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      signal: controller.signal,
    });
    online = true;
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || "Request failed.");
      error.status = response.status;
      error.details = result.details;
      throw error;
    }
    return result;
  } catch (error) {
    if (!error.status) {
      online = false;
      const network = new Error(
        "Connection unavailable. Saved deliveries stay on this device; reconnect and retry.",
      );
      network.network = true;
      throw network;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function accept(data) {
  D = data;
  localStorage.setItem("waypoint-last-user", data.user.id);
  await dbOperation("cache", "put", { id: data.user.id, data });
  await loadQueue();
}
async function loadQueue() {
  queue = (await dbOperation("queue", "getAll"))
    .filter((q) => q.user_id === D?.user.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
async function refresh(renderAfter = true) {
  if (!D) return;
  try {
    await accept(await api("/api/state"));
  } catch (error) {
    if (error.status === 401) {
      toast(error.message);
      D = null;
    } else if (!error.network) throw error;
  }
  if (renderAfter && !dirty) render();
}
const outlet = (id) => D.outlets.find((o) => o.outlet_id === id);
const vehicle = (id) => D.vehicles.find((v) => v.vehicle_id === id);
const order = (id) => D.orders.find((o) => o.id === id);
const trip = (id) => D.trips.find((t) => t.id === id);
const stop = (id) => D.stops.find((s) => s.order_id === id);
const tripStops = (id) =>
  D.stops
    .filter((s) => s.trip_id === id)
    .sort((a, b) => a.position - b.position);
const delivery = (id) => D.deliveries.find((d) => d.order_id === id);
const pending = (id) => queue.find((q) => q.order_id === id);
const shownStatus = (o) => (pending(o.id) ? "Saved on device" : o.status);
const outletName = (id) => {
  const o = outlet(id);
  return o ? `${o.brand} ${o.district} · ${id}` : id;
};
const dayLabel = (day) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(day + "T12:00:00Z"));
const stamp = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(new Date(iso));
function activeTrip() {
  if (!trip(selectedTrip))
    selectedTrip =
      D.trips.find((t) => t.status !== "Completed")?.id || D.trips[0]?.id || "";
  return trip(selectedTrip);
}
function tripPicker() {
  return D.trips.length
    ? `<div class="field trip-select"><label for="trip-picker">Run</label><select id="trip-picker">${D.trips.map((t) => `<option value="${t.id}" ${t.id === activeTrip()?.id ? "selected" : ""}>${t.id} · ${dayLabel(t.date)} · ${t.vehicle_id} · ${t.status}</option>`).join("")}</select></div>`
    : "";
}
function meta(o) {
  const r = outlet(o.outlet_id);
  return `<div class="order-meta"><span>${o.units} crates</span><span>${o.weight} kg</span><span>${o.volume} m³</span><span>${esc(o.temperature)}</span></div><details><summary>Handling and references</summary>${pair("Order", o.id)}${pair("Depot", r.depot)}${pair("Receiving window", r.window_open_time + "–" + r.window_close_time + " SLT")}${pair("Access", r.parking_constraint.replaceAll("_", " "))}${pair("Unloading", r.dock_type.replaceAll("_", " "))}</details>`;
}
function loginView() {
  return `<main class="login" id="main"><section class="login-left"><a class="brand" href="#"><img src="assets/mark.svg" alt="">Waypoint</a><h1>Good to have you here.</h1><p>One place to plan, deliver, and keep everyone informed.</p><form id="login-form"><div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="40"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200"></div><p class="form-error" id="login-error" role="alert"></p><button class="btn primary" type="submit">Sign in ${icon("arrow")}</button></form><details open><summary>Judge accounts</summary><p class="small">Choose an account to fill the username. Default seeded password: <strong>demo123</strong>.</p><div class="demo-accounts">${[
    ["store", "Store"],
    ["dispatch", "Dispatcher"],
    ["loader", "Loader"],
    ["driver", "Driver"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" data-action="fill" data-id="${id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><p class="small">Changes are shared between accounts and devices. Sign in online once to prepare this device for offline delivery.</p></details></section><section class="login-art"><h2>Less chasing.<br>More certainty.</h2><img src="assets/route-art.svg" alt="Connected delivery checkpoints and a van"><p>From the first order to the final receipt, your team knows what comes next.</p><div class="trip-stages"><span>Plan clearly</span><span>Deliver confidently</span><span>Close the loop</span></div></section></main>`;
}
function render() {
  if (!D) {
    $("#app").innerHTML = loginView();
    return;
  }
  const route = (
      location.hash.replace(/^#\/?/, "") || nav[D.user.role][0][0]
    ).split("/"),
    page = route[0],
    id = route[1];
  const permitted = [
    ...nav[D.user.role].map((n) => n[0]),
    "guide",
    ...(D.user.role === "store" ? ["create", "order"] : []),
    ...(D.user.role === "dispatcher" ? ["new-trip"] : []),
    ...(D.user.role === "driver" ? ["delivery"] : []),
  ];
  if (!permitted.includes(page)) {
    location.hash = "#/" + nav[D.user.role][0][0];
    return;
  }
  const views = {
    orders: ordersView,
    outlet: outletView,
    create: createView,
    order: () => detailView(id),
    overview: overviewView,
    planning: planningView,
    trips: tripsView,
    issues: issuesView,
    "new-trip": newTripView,
    loading: loadingView,
    "my-trip": driverView,
    delivery: () => deliveryView(id),
    sync: syncView,
    history: historyView,
    guide: guideView,
  };
  const active = ["order", "create"].includes(page)
    ? "orders"
    : page === "delivery"
      ? "my-trip"
      : page;
  const navigation = [...nav[D.user.role], ["guide", "help", "Guide"]];
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#/${nav[D.user.role][0][0]}"><img src="assets/mark.svg" alt="">Waypoint</a><div class="role-label">${esc(roleNames[D.user.role])}</div><nav class="nav" aria-label="Main navigation">${navigation.map(([r, i, l]) => `<a href="#/${r}" class="${active === r ? "active" : ""}" ${active === r ? 'aria-current="page"' : ""}>${icon(i)}${l}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="profile"><span class="avatar">${esc(D.user.name[0])}</span><div><strong>${esc(D.user.name)}</strong><p class="small">${esc(D.user.outlet_id || D.user.depot)}</p></div></div>${button("Sign out", "logout", "", "text", "", "logout")}</div></aside><div class="shell"><header class="topbar"><div class="context">${icon(D.user.role === "store" ? "store" : "route")}<span>${esc(roleNames[D.user.role])}<span class="desktop-only"> / ${esc(D.user.outlet_id || D.user.depot)}</span></span></div><div class="topbar-right"><span class="live-status ${online ? "" : "offline"}">${online ? "Connected" : "Offline"}${queue.length ? " · " + queue.length + " pending" : ""}</span>${button("Refresh", "refresh", "", "small", false, "sync")}${button("Sign out", "logout", "", "small mobile-only", false)}</div></header><main class="main" id="main" tabindex="-1">${!online ? `<div class="offline-banner">${notice("You are viewing the last saved workspace. Driver handovers can be saved here and synced when the connection returns.", "amber")}</div>` : ""}${views[page]()}<footer class="bottom-note"><span>Waypoint · Every handoff, connected</span><span>${D.demo_clock ? "Walkthrough clock: " : "SLT: "}${esc(stamp(D.clock))}${D.demo_clock ? " · fixed demo time" : ""}</span></footer></main></div><nav class="bottomnav" aria-label="Mobile navigation">${navigation.map(([r, i, l]) => `<a href="#/${r}" class="${active === r ? "active" : ""}" ${active === r ? 'aria-current="page"' : ""}>${icon(i)}<span>${l}</span></a>`).join("")}</nav>`;
  if (page === "delivery") bindCapture(id);
  if (page === "new-trip")
    $("#new-driver").value =
      D.drivers.find((d) => d.vehicle_id === $("#new-vehicle").value)?.id || "";
}
function ordersView() {
  const awaiting = D.orders.filter(
    (o) => o.status === "Awaiting receipt",
  ).length;
  return (
    header(
      "My orders",
      "Your next delivery, without the guesswork.",
      link("Create order", "create", "btn primary", "plus"),
    ) +
    `<div class="operational-strip"><div class="stat-block"><strong>${D.orders.length}</strong><span>Orders</span></div><div class="stat-block"><strong>${awaiting}</strong><span>Receipts to review</span></div><div class="stat-block"><strong>${D.orders.filter((o) => o.status === "Deferred").length}</strong><span>Deferred</span></div></div><section class="panel">${D.orders.length ? D.orders.map((o) => `<article class="order-card"><div class="row-between"><div><h2>${esc(o.temperature)} replenishment</h2><p>${esc(o.id)} · ${dayLabel(o.date)}</p></div>${badge(shownStatus(o), tone(shownStatus(o)))}</div><div class="order-meta"><span>${o.units} crates</span><span>${stop(o.id)?.eta ? "Expected " + stop(o.id).eta + " SLT" : "Awaiting published arrival"}</span></div>${o.status === "Deferred" ? notice(esc(o.note) + "<p>Revised date: " + dayLabel(o.date) + "</p>", "amber") : ""}<div class="actions">${link(o.status === "Awaiting receipt" ? "Review receipt" : "View order", "order/" + o.id, "btn small", "arrow")}</div></article>`).join("") : empty("No orders yet", "Create your first replenishment request.")}</section>`
  );
}
function createView() {
  return (
    header(
      "Create an order",
      "Confirm your replenishment request before the 4 PM cutoff.",
      link("Back to orders", "orders", "btn text", "back"),
    ) +
    `<div class="grid two"><form id="order-form" class="panel pad"><h2>${esc(outletName(D.user.outlet_id))}</h2><p class="confirmation-note">Earliest eligible date: ${dayLabel(D.earliest_order_day)}. After-cutoff requests wait for the following operating run.</p><div class="field"><label for="order-date">Delivery date</label><input id="order-date" name="date" type="date" min="${D.earliest_order_day}" value="${D.earliest_order_day}" required></div><div class="field"><label for="handling">Handling</label><select id="handling" name="temperature"><option>Ambient</option><option>Chilled</option><option>Frozen</option></select></div><div class="field"><label for="units">Crates / handling units</label><input id="units" name="units" type="number" min="1" max="10000" step="1" required></div><div class="field"><label for="weight">Total weight, kg</label><input id="weight" name="weight" type="number" min="0.01" max="100000" step="0.01" required></div><div class="field"><label for="volume">Total volume, m³</label><input id="volume" name="volume" type="number" min="0.01" max="10000" step="0.01" required></div><div class="field"><label for="order-note">Handling notes</label><textarea id="order-note" name="note" maxlength="1000"></textarea></div><p class="form-error" role="alert"></p><button class="btn primary" type="submit" ${!online ? "disabled" : ""}>Submit order</button></form><aside class="panel pad"><h2>A clear request</h2><p>Weight and volume both matter. Chilled and frozen requests require refrigerated capacity. The dispatcher will publish an expected arrival or explain a deferral.</p>${meta({ id: "New request", outlet_id: D.user.outlet_id, units: 0, weight: 0, volume: 0, temperature: "To be selected" })}</aside></div>`
  );
}
function detailView(id) {
  const o = order(id);
  if (!o) return empty("Order unavailable", "Return to your orders.");
  const d = delivery(id),
    r = D.receipts.find((r) => r.order_id === id),
    s = stop(id),
    t = s ? trip(s.trip_id) : null;
  return (
    header(
      "Order " + id,
      outletName(o.outlet_id),
      link("Back to orders", "orders", "btn text", "back"),
    ) +
    `<div class="grid two"><section class="panel pad order-detail"><div class="row-between"><h2>${o.temperature} replenishment</h2>${badge(o.status, tone(o.status))}</div>${meta(o)}${pair("Requested date", dayLabel(o.original_date))}${pair("Delivery date", dayLabel(o.date))}${pair("Expected arrival", s?.eta ? s.eta + " SLT" : "Not published")}${o.note ? notice(esc(o.note), o.status === "Deferred" ? "amber" : "blue") : ""}<div class="flow-line">${["Requested", ...(s ? ["Planned"] : []), ...(t && ["Loaded", "On road", "Completed"].includes(t.status) ? ["Loaded"] : []), ...(d ? ["Delivered", "Synced"] : []), ...(r ? ["Receipt recorded"] : [])].map((x) => `<span>${x}</span>`).join("")}</div>${d ? `<h2>Driver handover</h2>${pair("Delivered", d.quantity + " crates")}${pair("Recipient", d.recipient)}${pair("Recorded", stamp(d.recorded_at))}${pair("Synchronized", stamp(d.synced_at))}<p class="note-wrap">${esc(d.reason)} ${esc(d.notes)}</p>${d.signature || d.photo ? `<details><summary>Proof of delivery</summary><div class="evidence-pair">${d.signature ? `<img src="${esc(d.signature)}" alt="Recipient signature">` : ""}${d.photo ? `<img src="${esc(d.photo)}" alt="Delivery photograph">` : ""}</div></details>` : notice("Evidence unavailable: " + esc(d.notes), "amber")}` : ""}${r ? `<div class="divider"></div><h2>Store receipt</h2>${pair("Received", r.quantity + " crates")}<p>${esc(r.note)}</p>` : ""}</section><aside class="stack">${o.status === "Awaiting receipt" && d ? `<form id="receipt-form" data-id="${id}" class="panel pad"><h2>Confirm what arrived</h2><p>The driver recorded ${d.quantity} crates. Confirm your own received count.</p><div class="field"><label for="received">Received crates</label><input id="received" name="quantity" type="number" min="0" max="${o.units}" step="1" value="${d.quantity}" required></div><div class="field"><label for="receipt-note">Discrepancy or receiving notes</label><textarea id="receipt-note" name="note" maxlength="1000" placeholder="Explain any difference from the driver's count."></textarea></div><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Confirm receipt</button></form>` : `<section class="panel pad"><h2>Receipt checkpoint</h2><p>${r ? "Your received quantity is recorded. Discrepancies remain visible for dispatcher review." : "Receipt confirmation becomes available after the driver synchronizes the handover."}</p></section>`}<form id="issue-form" data-id="${id}" class="panel pad"><h2>Report an issue</h2><div class="field"><label for="issue-note">What needs attention?</label><textarea id="issue-note" name="note" required minlength="5" maxlength="1000"></textarea></div><p class="form-error" role="alert"></p><button class="btn" type="submit">Send to dispatcher</button></form></aside></div>`
  );
}
function outletView() {
  const r = outlet(D.user.outlet_id);
  return (
    header("My outlet", "Receiving details used in delivery planning.") +
    `<section class="panel pad"><h2>${esc(outletName(r.outlet_id))}</h2>${pair("Depot", r.depot)}${pair("Window", r.window_open_time + "–" + r.window_close_time + " SLT")}${pair("Access", r.parking_constraint.replaceAll("_", " "))}${pair("Unloading", r.dock_type.replaceAll("_", " "))}${pair("Mall access", r.mall_window || "Not applicable")}<p class="confirmation-note">Outlet reference details come from the supplied competition dataset.</p></section>`
  );
}
function overviewView() {
  const unresolved = D.issues.filter((i) => i.status === "Open"),
    backlog = D.orders.filter((o) =>
      ["Submitted", "Deferred"].includes(o.status),
    );
  return (
    header(
      "Today’s handoffs",
      "Plan clearly. Keep every decision and exception visible.",
      link("Open planning", "planning", "btn primary", "route"),
    ) +
    `<div class="operational-strip"><div class="stat-block"><strong>${backlog.length}</strong><span>Orders awaiting allocation</span></div><div class="stat-block"><strong>${D.trips.filter((t) => t.status === "On road").length}</strong><span>Runs on the road</span></div><div class="stat-block"><strong>${unresolved.length}</strong><span>Open issues</span></div><div class="stat-block"><strong>${D.vehicles.length}</strong><span>Vehicles in the shared fleet</span></div></div><div class="grid equal"><section class="panel"><div class="panel-head"><h2>Runs and progress</h2></div>${D.trips.length ? D.trips.map((t) => `<div class="list-row"><span class="number">${icon("truck")}</span><div class="grow"><h3>${t.id} · ${t.vehicle_id}</h3><p>${dayLabel(t.date)} · ${tripStops(t.id).length} stops · ${t.departure} SLT</p></div>${badge(t.status, tone(t.status))}</div>`).join("") : empty("No runs yet", "Create a run in Planning.")}</section><section class="panel"><div class="panel-head"><h2>Recent handoffs</h2></div><ol class="event-list">${D.events
      .slice(0, 12)
      .map(
        (e) =>
          `<li><strong>${esc(e.action)}</strong><p>${esc(e.entity_id)} ${esc(e.detail)}</p><time>${stamp(e.created_at)} SLT</time></li>`,
      )
      .join("")}</ol></section></div>`
  );
}
function planningView() {
  const t = activeTrip(),
    report = t ? D.reports[t.id] : null;
  const backlog = D.orders.filter(
    (o) =>
      ["Submitted", "Deferred"].includes(o.status) && o.date === planningDay,
  );
  return (
    header(
      "Planning",
      "Allocate confirmed orders. Validate the full run before publishing.",
      link("Create run", "new-trip", "btn primary", "plus"),
    ) +
    `<div class="search-bar">${tripPicker()}<div class="field dispatch-day"><label for="planning-day">Queue date</label><input id="planning-day" type="date" value="${planningDay}"></div></div><div class="planning-layout"><div class="stack"><section class="panel"><div class="panel-head"><h2>Confirmed queue</h2>${badge(backlog.length + " requests")}</div>${backlog.length ? backlog.map((o) => `<article class="order-card"><div class="row-between"><h3>${esc(outletName(o.outlet_id))}</h3>${badge(o.status, tone(o.status))}</div>${meta(o)}${o.deferrals ? notice(`${o.deferrals} previous deferral${o.deferrals === 1 ? "" : "s"}. Consider the service impact before deferring again.`, "amber") : ""}${o.note ? `<p class="note-wrap">${esc(o.note)}</p>` : ""}<div class="actions">${o.status === "Deferred" ? button("Reopen for this run", "reopen", o.id, "small", !online) : button("Add to selected run", "assign", o.id, "small", !online || !t || t.status !== "Draft" || t.date !== o.date, "plus")}</div>${o.status === "Submitted" ? `<form id="defer-${o.id}" class="defer-form defer-box" data-id="${o.id}"><label for="reason-${o.id}" class="small">Deferral reason and next action</label><input id="reason-${o.id}" name="reason" required minlength="8" maxlength="1000" placeholder="Explain the constraint and next action"><p class="form-error" role="alert"></p><button class="btn small" type="submit" ${!online ? "disabled" : ""}>Record deferral</button></form>` : ""}</article>`).join("") : empty("Queue is clear for this date", "Select another date, or review the selected run.")}</section>${
      t
        ? `<section class="panel"><div class="panel-head"><h2>Stop sequence</h2>${badge(tripStops(t.id).length + " stops")}</div>${
            tripStops(t.id).length
              ? tripStops(t.id)
                  .map((s, i) => {
                    const o = order(s.order_id),
                      eta = report.schedule.find(
                        (x) => x.order_id === o.id,
                      )?.eta;
                    return `<article class="order-card"><div class="stop-header"><span class="number">${i + 1}</span><div class="grow"><h3>${esc(outletName(o.outlet_id))}</h3><p>${o.units} crates · estimated ${eta || "—"} SLT</p>${badge(o.status, tone(o.status))}</div></div>${t.status === "Draft" ? `<div class="actions">${button("Move up", "move-up", o.id, "small", i === 0 || !online)}${button("Move down", "move-down", o.id, "small", i === tripStops(t.id).length - 1 || !online)}${button("Remove", "unassign", o.id, "text small", !online)}</div>` : ""}</article>`;
                  })
                  .join("")
              : empty("No stops on this run", "Add orders from the queue.")
          }</section>`
        : ""
    }</div><aside class="stack">${t ? `<section class="panel pad"><div class="route-title"><h2>${t.id}</h2>${badge(t.status, tone(t.status))}</div><form id="trip-settings" data-id="${t.id}" class="route-form" style="margin-top:20px"><div class="field full"><label for="plan-vehicle">Vehicle</label><select id="plan-vehicle" name="vehicle_id" ${t.status !== "Draft" ? "disabled" : ""}>${D.vehicles.map((v) => `<option value="${v.vehicle_id}" ${v.vehicle_id === t.vehicle_id ? "selected" : ""}>${v.vehicle_id} · ${v.temp === "reefer" ? "Refrigerated" : "Ambient"} ${v.type} · ${v.depot}</option>`).join("")}</select></div><div class="field"><label for="departure">Departure, SLT</label><input id="departure" name="departure" type="time" value="${t.departure}" required ${t.status !== "Draft" ? "disabled" : ""}></div><div class="field"><label>Delivery day</label><p>${dayLabel(t.date)}</p></div><p class="form-error full" role="alert"></p>${t.status === "Draft" ? `<button class="btn full" type="submit" ${!online ? "disabled" : ""}>Save run settings</button>` : ""}</form><div class="route-summary"><div><strong>${report.weight} kg</strong><span class="small">${vehicle(t.vehicle_id).weight_cap_kg} kg limit</span></div><div><strong>${report.volume} m³</strong><span class="small">${vehicle(t.vehicle_id).volume_cap_m3} m³ limit</span></div></div>${pair("Estimated round trip", report.distance_km + " km")}${pair("Fuel reservation", report.fuel_l.toFixed(2) + " L")}${pair("Estimated depot return", report.return_time + " SLT")}<p class="sr-hint">District travel estimates, service allowances, and ${report.travel_factor === 1.2 ? "a 20% monsoon buffer" : "free-flow travel"} support validation. These are estimates, not live traffic.</p></section><section class="panel"><div class="panel-head"><h2>Plan checks</h2>${badge(report.valid ? "Passed" : "Blocked", report.valid ? "green" : "red")}</div><div class="validation-list">${report.checks.map((c) => `<div class="validation-row ${c.ok ? "pass" : "fail"}">${icon(c.ok ? "check" : "alert")}<div><strong>${esc(c.name)}</strong><p>${esc(c.detail)}</p></div></div>`).join("")}</div><div class="pad">${button("Validate run", "validate", t.id, "", !online, "check")} ${t.status === "Draft" ? button("Publish plan", "publish", t.id, "primary", !report.valid || !online, "arrow") : ""}<p class="confirmation-note">Publishing locks allocations and sends the manifest to the loader. Unassigned requests remain visible until allocated or explicitly deferred.</p></div></section>` : empty("Select or create a run", "Your full plan checks will appear here.")}</aside></div>`
  );
}
function newTripView() {
  return (
    header(
      "Create a run",
      "One vehicle, one driver, and an explicit delivery sequence.",
      link("Back to planning", "planning", "btn text", "back"),
    ) +
    `<form id="new-trip-form" class="panel pad" style="max-width:650px"><div class="field"><label for="new-date">Delivery day</label><input id="new-date" type="date" name="date" value="${planningDay}" required></div><div class="field"><label for="new-vehicle">Vehicle</label><select id="new-vehicle" name="vehicle_id">${D.vehicles.map((v) => `<option value="${v.vehicle_id}">${v.vehicle_id} · ${v.temp} ${v.type} · ${v.depot}</option>`).join("")}</select></div><div class="field"><label for="new-driver">Vehicle driver</label><select id="new-driver" name="driver_id" disabled>${D.drivers.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} · ${esc(d.vehicle_id)}</option>`).join("")}</select></div><div class="field"><label for="new-departure">Departure, SLT</label><input id="new-departure" name="departure" type="time" value="09:00" required></div><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Create run</button></form>`
  );
}
function tripsView() {
  return (
    header(
      "Trips",
      "Published manifests and delivery progress.",
      link("Create run", "new-trip", "btn primary", "plus"),
    ) +
    `<div class="stack">${
      D.trips.length
        ? D.trips
            .map(
              (t) =>
                `<section class="panel run-card"><div class="row-between"><h2>${t.id} · ${t.vehicle_id}</h2>${badge(t.status, tone(t.status))}</div><p>${dayLabel(t.date)} · departure ${t.departure} SLT · ${vehicle(t.vehicle_id).depot}</p>${tripStops(
                  t.id,
                )
                  .map(
                    (s) =>
                      `<div class="list-row"><span class="number">${s.position}</span><div class="grow"><h3>${esc(outletName(order(s.order_id).outlet_id))}</h3><p>${s.order_id} · ${s.eta || "ETA pending"} SLT</p></div>${badge(shownStatus(order(s.order_id)), tone(shownStatus(order(s.order_id))))}</div>`,
                  )
                  .join(
                    "",
                  )}<div class="actions">${button("Open run", "select-run", t.id, "small", false, "route")}</div></section>`,
            )
            .join("")
        : empty("No trips", "Create your first run in Planning.")
    }</div>`
  );
}
function issuesView() {
  return (
    header(
      "Issues & resolutions",
      "Keep the facts. Record what changed and who was informed.",
    ) +
    `<section class="panel">${D.issues.length ? D.issues.map((i) => `<article class="issue-row"><div class="row-between"><h2>${esc(i.kind)}</h2>${badge(i.status, tone(i.status))}</div><p>${esc(i.order_id)} · ${stamp(i.created_at)} SLT</p><p class="note-wrap">${esc(i.note)}</p>${i.status === "Open" ? `<form class="resolve-form" data-id="${i.id}"><div class="field"><label for="resolve-${i.id}">Resolution</label><textarea id="resolve-${i.id}" name="resolution" required minlength="8" maxlength="1000" placeholder="Explain the action taken and next steps."></textarea></div><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Resolve issue</button></form>` : `<p class="confirmation-note note-wrap">Resolution: ${esc(i.resolution)}</p>`}</article>`).join("") : empty("No issues reported", "Loading, delivery, and receipt exceptions will appear here.")}</section>`
  );
}
function loadingView() {
  const t = activeTrip();
  if (!t)
    return (
      header("Loading", "A stable checklist for the dock.") +
      empty(
        "No published manifest",
        "The dispatcher must publish a run before loading can begin.",
      )
    );
  const ss = tripStops(t.id).slice().reverse(),
    ready = ss.every((s) => s.loaded === order(s.order_id).units && s.verified);
  return (
    header(
      "Loading workspace",
      "Load in reverse stop order. Reconcile every count before handoff.",
    ) +
    tripPicker() +
    notice(
      t.status === "Published"
        ? "Verify the physical count for every stop. A shortage blocks departure."
        : "This manifest has been released; loading quantities are locked.",
      t.status === "Published" ? "blue" : "green",
    ) +
    `<div class="stack" style="margin-top:20px">${ss
      .map((s, i) => {
        const o = order(s.order_id);
        return `<section class="panel pad"><div class="stop-header"><span class="number">${i + 1}</span><div class="grow"><h2>${esc(outletName(o.outlet_id))}</h2><p>Delivery stop ${s.position} · load ${i === 0 ? "first" : "next"} · ${esc(o.id)}</p></div>${badge(s.verified ? "Verified" : s.loaded !== o.units ? "Shortage" : "To verify", s.verified ? "green" : s.loaded !== o.units ? "red" : "amber")}</div>${meta(o)}${pair("Required", o.units + " crates")}<form class="load-form load-count" data-id="${o.id}" data-trip="${t.id}"><div class="field"><label for="loaded-${o.id}">Physical count</label><input id="loaded-${o.id}" name="loaded" type="number" min="0" max="${o.units}" step="1" value="${s.loaded}" required ${t.status !== "Published" ? "disabled" : ""}></div><button class="btn" type="submit" ${t.status !== "Published" || !online ? "disabled" : ""}>Save count</button><p class="form-error" role="alert"></p></form><div class="actions" style="margin-top:15px">${button(s.verified ? "Verified" : "Verify quantity", "verify", o.id, "primary", s.verified || s.loaded !== o.units || t.status !== "Published" || !online, "check")}</div>${s.loaded !== o.units && t.status === "Published" ? `<form class="shortage-form" data-id="${o.id}" style="margin-top:18px"><div class="field"><label for="shortage-${o.id}">Shortage or damage note</label><textarea id="shortage-${o.id}" name="note" required minlength="5" maxlength="1000">${o.units - s.loaded} crates missing; please replenish before departure.</textarea></div><p class="form-error" role="alert"></p><button class="btn" type="submit">Report to dispatcher</button></form>` : ""}</section>`;
      })
      .join(
        "",
      )}<section class="panel pad"><h2>Loading handoff</h2><p>${ready ? "Every count is verified. The driver can receive the manifest." : "Replenish shortages, save matching counts, then verify every stop."}</p><div class="actions" style="margin-top:18px">${button("Confirm loading handoff", "release", t.id, "primary", !ready || t.status !== "Published" || !online, "arrow")}</div></section></div>`
  );
}
function driverView() {
  const t = activeTrip();
  if (!t)
    return (
      header("My trip", "Use this workspace while safely stopped.") +
      empty(
        "No assigned trip",
        "A published run will appear after dispatcher allocation.",
      )
    );
  const ss = tripStops(t.id),
    next = ss.find((s) => !delivery(s.order_id) && !pending(s.order_id));
  return (
    header("My trip", "Your next checkpoint, while safely stopped.") +
    tripPicker() +
    `<section class="panel pad"><div class="row-between"><h2>${t.id} · ${t.vehicle_id}</h2>${badge(t.status, tone(t.status))}</div>${pair("Home depot", vehicle(t.vehicle_id).depot)}${pair("Departure", t.departure + " SLT")}${pair("Delivery day", dayLabel(t.date))}${t.status === "Published" ? notice("The loader is reconciling the manifest. Departure becomes available after verification.", "amber") : ""}${t.status === "Loaded" ? button("Start trip", "depart", t.id, "primary", !online, "arrow") : ""}${t.status === "On road" && next ? `<div class="divider"></div><h2>Next: ${esc(outletName(order(next.order_id).outlet_id))}</h2><p>${order(next.order_id).units} crates · expected ${next.eta} SLT</p><div class="actions" style="margin-top:18px">${button(next.arrived_at ? "Arrival recorded" : "I have arrived", "arrive", next.order_id, "", !!next.arrived_at, "check")}${link("Record handover", "delivery/" + next.order_id, "btn primary", "arrow")}</div><p class="confirmation-note">Confirm arrival and capture evidence while stopped. Offline records stay on this device until synchronization succeeds.</p>` : ""}${t.status === "On road" && !next ? `<div class="divider"></div>${notice(queue.length ? "All handovers are recorded locally. Sync the pending records before completing your depot return." : "Every handover is synchronized. Confirm your return to the depot.", queue.length ? "amber" : "green")}<div class="actions" style="margin-top:18px">${queue.length ? link("Open sync", "sync", "btn primary", "sync") : button("Confirm depot return", "return", t.id, "primary", !online, "check")}</div>` : ""}</section><section class="panel" style="margin-top:22px"><div class="panel-head"><h2>Delivery sequence</h2></div>${ss.map((s) => `<article class="order-card"><div class="stop-header"><span class="number">${s.position}</span><div class="grow"><h3>${esc(outletName(order(s.order_id).outlet_id))}</h3><p>${s.eta} SLT · ${order(s.order_id).units} crates</p></div>${badge(shownStatus(order(s.order_id)), tone(shownStatus(order(s.order_id))))}</div></article>`).join("")}</section>`
  );
}
function deliveryView(id) {
  const o = order(id),
    s = stop(id);
  if (
    !o ||
    !s ||
    trip(s.trip_id)?.status !== "On road" ||
    delivery(id) ||
    pending(id)
  )
    return empty(
      "Handover unavailable",
      "Choose the next undelivered stop from My trip.",
    );
  return (
    header(
      "Record delivery",
      outletName(o.outlet_id),
      link("Back to trip", "my-trip", "btn text", "back"),
    ) +
    `<form id="delivery-form" data-id="${id}"><div class="grid two"><section class="panel pad"><h2>Actual handover</h2><p>${o.units} crates were verified at loading.</p><div class="field"><label for="delivered">Crates handed over</label><input id="delivered" name="quantity" type="number" min="0" max="${s.loaded}" step="1" value="${s.loaded}" required></div><div class="field"><label for="delivery-reason">Reason for a partial or refused delivery</label><select id="delivery-reason" name="reason"><option value="">Full delivery / no issue</option><option>Outlet refused delivery</option><option>Goods damaged in transit</option><option>Receiving team unavailable</option><option>Quantity shortfall</option><option>Other delivery issue</option></select></div><div class="field"><label for="recipient">Recipient / contact person</label><input id="recipient" name="recipient" required minlength="2" maxlength="100" autocomplete="name"></div><div class="field"><label for="delivery-notes">Delivery notes</label><textarea id="delivery-notes" name="notes" maxlength="1000"></textarea></div><h2>Proof of delivery</h2><div class="field" style="margin-top:18px"><label for="signature-pad">Recipient signature</label><canvas id="signature-pad" class="signature" aria-label="Recipient signature drawing area"></canvas><div class="capture-tools">${button("Clear signature", "clear-signature", "", "small")}</div><small>If drawing is not possible, record the reason using the evidence checkbox below.</small></div><div class="field"><label for="photo-input">Delivery photograph</label><input id="photo-input" type="file" accept="image/png,image/jpeg,image/webp" capture="environment"><small>PNG, JPEG, or WebP. Large photos are resized on this device before saving.</small><div id="photo-preview" class="photo-preview"></div></div><label class="check"><input name="evidence_unavailable" id="evidence-unavailable" type="checkbox"><span>Some evidence is unavailable. Explain why in delivery notes.</span></label></section><aside class="panel pad sticky"><h2>Handover summary</h2>${meta(o)}${pair("ETA", s.eta + " SLT")}${notice("The store confirms receipt separately after this handover is synchronized. Your record is saved on this device before upload.")}<p class="form-error" role="alert"></p><button class="btn primary" type="submit" style="width:100%;margin-top:18px">Save delivery</button>${button("Save draft on device", "save-draft", id, "text")}<p class="confirmation-note">Device drafts and pending records contain delivery evidence. Sync before signing out or clearing browser storage.</p></aside></div></form>`
  );
}
function syncView() {
  return (
    header(
      "Device & sync",
      "Saved handovers stay here until the server confirms them.",
      button(
        "Retry synchronization",
        "sync",
        "",
        "primary",
        !queue.length || !online,
        "sync",
      ),
    ) +
    notice(
      queue.length
        ? `<strong>${queue.length} delivery record${queue.length === 1 ? "" : "s"} pending.</strong><p>${online ? "Reconnect checks passed. Retry sync to send these handovers." : "Continue your route while offline, then reconnect to synchronize."}</p>`
        : "<strong>All recorded deliveries are synchronized.</strong><p>Store receipt confirmation is a separate checkpoint.</p>",
      queue.length ? "amber" : "green",
    ) +
    `<section class="panel" style="margin-top:22px">${queue.length ? queue.map((q) => `<article class="queue-item"><div class="row-between"><h2>${esc(outletName(order(q.order_id)?.outlet_id || q.order_id))}</h2>${badge(q.error ? "Retry needed" : "Pending sync", q.error ? "red" : "amber")}</div><p>${esc(q.order_id)} · ${q.payload.quantity} crates · ${esc(q.payload.recipient)}</p><p class="small">Recorded ${stamp(q.created_at)} SLT · ${q.payload.photo ? "photo saved" : "photo unavailable"} · ${q.payload.signature ? "signature saved" : "signature unavailable"}</p>${q.error ? `<p class="form-error">${esc(q.error)}</p>` : ""}</article>`).join("") : empty("Nothing waiting to upload", "Each acknowledged record is removed from the device queue. Repeated uploads cannot create a second handover.")}</section><div style="margin-top:20px">${link("Continue my trip", "my-trip", "btn", "arrow")}</div>`
  );
}
function historyView() {
  const done = D.orders.filter((o) => delivery(o.id));
  return (
    header(
      D.user.role === "loader" ? "Manifest history" : "Delivery history",
      "Recorded handovers and receipt outcomes.",
    ) +
    `<section class="panel">${done.length ? done.map((o) => `<article class="order-card"><div class="row-between"><h2>${esc(outletName(o.outlet_id))}</h2>${badge(o.status, tone(o.status))}</div><p>${esc(o.id)} · ${delivery(o.id).quantity} crates delivered · ${stamp(delivery(o.id).synced_at)} SLT</p></article>`).join("") : empty("No synchronized deliveries yet", "Completed handovers will appear here.")}</section>`
  );
}
function guideView() {
  return (
    header(
      "A quick guide",
      "One shared delivery story, with clear responsibilities.",
    ) +
    `<section class="panel pad workspace-guide"><h2>Complete the delivery journey</h2><ol><li><strong>Store:</strong> submit a request with its total weight, volume, handling, and delivery date. Next-day orders close at 4 PM SLT.</li><li><strong>Dispatcher:</strong> assign requests to a run, adjust stop order, resolve failed constraints, and publish. Record a reason for each deferral.</li><li><strong>Loader:</strong> load in reverse delivery order, report shortages, replenish the physical count, and verify every quantity before releasing the manifest.</li><li><strong>Driver:</strong> start the released trip, record each handover while safely stopped, and capture recipient, quantity, signature, and photograph.</li><li><strong>Offline driver:</strong> records save to device storage first. Reconnect to synchronize. If an upload fails, keep the queue and retry from Sync.</li><li><strong>Store:</strong> review the synchronized driver handover and confirm the actual received count. A discrepancy becomes a dispatcher issue.</li></ol><h2>Before heading offline</h2><p>Sign in online, open your assigned trip, and wait for the workspace to load. This caches the application and your manifest. Only driver arrivals, drafts, and handovers work offline; planning and shared confirmations require a connection.</p><h2>Planning assumptions</h2><p>District travel and service allowances come from the supplied CSV files. Travel uses a documented 20% buffer on monsoon dates and conservative depot-via-depot legs between districts. These are transparent estimates, not GPS or predictive ML. Weekly fuel includes published reservations.</p><h2>Review fixture</h2><p>The seeded June 24 run uses a refrigerated van for three Fresh Colombo outlets. OUT003 begins with a five-crate shortage. A mall order needs another run, and the oversized bulk request requires a documented deferral or revised split order. The fixed walkthrough clock is shown in the footer when enabled.</p></section>`
  );
}
async function bindCapture(id) {
  signature = "";
  photo = "";
  drawn = false;
  const canvas = $("#signature-pad"),
    rect = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = 160 * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#233b52";
  let drawing = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...pos(e));
    dirty = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drawing) {
      ctx.lineTo(...pos(e));
      ctx.stroke();
      drawn = true;
    }
  });
  const finish = () => {
    drawing = false;
    if (drawn) signature = canvas.toDataURL("image/png");
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  try {
    const draft = await dbOperation("drafts", "get", D.user.id + ":" + id);
    if (draft && $("#delivery-form")?.dataset.id === id) {
      for (const [k, v] of Object.entries(draft.fields)) {
        const input = $("#delivery-form").elements.namedItem(k);
        if (input) {
          if (input.type === "checkbox") input.checked = v;
          else input.value = v;
        }
      }
      signature = draft.signature;
      photo = draft.photo;
      if (signature) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, 160);
        img.src = signature;
        drawn = true;
      }
      if (photo)
        $("#photo-preview").innerHTML =
          `<img src="${esc(photo)}" alt="Saved delivery evidence">`;
    }
  } catch (error) {
    toast(error.message);
  }
}
function fields(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function deliveryPayload(form) {
  const values = fields(form);
  return {
    quantity: Number(values.quantity),
    recipient: values.recipient.trim(),
    reason: values.reason,
    notes: values.notes.trim(),
    signature,
    photo,
    evidence_unavailable: form.elements.evidence_unavailable.checked,
  };
}
async function syncQueue() {
  if (!D || D.user.role !== "driver" || !queue.length) return;
  for (const q of [...queue]) {
    try {
      await api(
        "/api/orders/" + encodeURIComponent(q.order_id) + "/delivery",
        q.payload,
      );
      await dbOperation("queue", "delete", q.id);
    } catch (error) {
      q.error = error.message;
      await dbOperation("queue", "put", q);
      if (error.status === 401)
        toast("Sign in as the same driver to sync these saved handovers.");
      break;
    }
  }
  await loadQueue();
  await refresh(false);
  if (!queue.length)
    toast("Handovers synchronized. Store receipt review is now available.");
  else
    toast(
      "Some handovers are still on this device. Review Sync for the next action.",
    );
}
async function saveDelivery(form) {
  const payload = deliveryPayload(form),
    o = order(form.dataset.id);
  if (
    !Number.isInteger(payload.quantity) ||
    payload.quantity < 0 ||
    payload.quantity > o.units
  )
    throw new Error(
      "Enter a whole crate count between zero and the loaded quantity.",
    );
  if (payload.quantity !== o.units && !payload.reason)
    throw new Error("Choose a reason for this partial or refused delivery.");
  if ((!signature || !photo) && !payload.evidence_unavailable)
    throw new Error(
      "Capture a signature and photo, or explain unavailable evidence.",
    );
  if (payload.evidence_unavailable && payload.notes.length < 8)
    throw new Error("Explain why evidence is unavailable in delivery notes.");
  payload.client_id = crypto.randomUUID();
  payload.recorded_at = new Date().toISOString();
  const q = {
    id: payload.client_id,
    order_id: o.id,
    user_id: D.user.id,
    payload,
    created_at: payload.recorded_at,
    error: "",
  };
  await dbOperation("queue", "put", q);
  await loadQueue();
  await dbOperation("drafts", "delete", D.user.id + ":" + o.id);
  dirty = false;
  if (online) await syncQueue();
  location.hash = "#/" + (queue.length ? "sync" : "my-trip");
  render();
  toast(
    queue.length
      ? "Delivery saved on this device. Pending synchronization."
      : "Delivery synchronized. The store can review its receipt.",
  );
}
async function runCommand(path, body = {}) {
  if (!online)
    throw new Error(
      "This shared action needs a connection. Reconnect and retry.",
    );
  const result = await api(path, body);
  dirty = false;
  await refresh(false);
  return result;
}
async function action(name, id) {
  const t = activeTrip();
  switch (name) {
    case "fill":
      $("#username").value = id;
      $("#password").value = "demo123";
      $("#username").focus();
      return;
    case "logout":
      if (queue.length)
        throw new Error(
          "Synchronize your pending deliveries before signing out.",
        );
      if (
        dirty &&
        !confirm("Leave unsaved changes? Saved drafts remain on this device.")
      )
        return;
      await api("/api/logout", {});
      localStorage.removeItem("waypoint-last-user");
      D = null;
      dirty = false;
      selectedTrip = "";
      location.hash = "";
      break;
    case "refresh":
      if (dirty && !confirm("Refresh and discard unsaved form edits?")) return;
      dirty = false;
      await refresh(false);
      break;
    case "select-run":
      selectedTrip = id;
      planningDay = trip(id).date;
      location.hash = "#/planning";
      break;
    case "assign":
      await runCommand(`/api/trips/${t.id}/assign`, {
        order_id: id,
        version: t.version,
      });
      toast("Added to the run. Review the updated plan checks.");
      break;
    case "unassign":
      await runCommand(`/api/trips/${t.id}/unassign`, {
        order_id: id,
        version: t.version,
      });
      break;
    case "move-up":
    case "move-down": {
      const ids = tripStops(t.id).map((s) => s.order_id),
        i = ids.indexOf(id),
        j = i + (name === "move-up" ? -1 : 1);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await runCommand(`/api/trips/${t.id}/reorder`, {
        order_ids: ids,
        version: t.version,
      });
      break;
    }
    case "validate": {
      const report = await runCommand(`/api/trips/${id}/validate`);
      toast(
        report.valid
          ? "All run checks passed. Review and publish."
          : "Plan blocked. Review the failed checks.",
      );
      break;
    }
    case "publish":
      if (!confirm("Publish this plan and lock its allocations for loading?"))
        return;
      await runCommand(`/api/trips/${id}/publish`, {
        version: trip(id).version,
      });
      toast("Published. The loader can now verify the manifest.");
      break;
    case "reopen":
      await runCommand(`/api/orders/${id}/reopen`);
      break;
    case "verify": {
      const s = stop(id);
      await runCommand(`/api/trips/${s.trip_id}/load`, {
        order_id: id,
        loaded: s.loaded,
        verified: true,
      });
      toast("Quantity verified.");
      break;
    }
    case "release":
      if (!confirm("Release this verified manifest to the driver?")) return;
      await runCommand(`/api/trips/${id}/release`);
      toast("Manifest released. The driver can start the trip.");
      break;
    case "depart":
      await runCommand(`/api/trips/${id}/depart`);
      toast("Trip started. Record deliveries while safely stopped.");
      break;
    case "arrive": {
      const s = stop(id);
      if (online) {
        try {
          await runCommand(`/api/trips/${s.trip_id}/arrive`, { order_id: id });
        } catch (error) {
          if (!error.network) throw error;
        }
      }
      if (!online) {
        s.arrived_at = new Date().toISOString();
        await dbOperation("cache", "put", { id: D.user.id, data: D });
      }
      toast(
        online
          ? "Arrival recorded."
          : "Arrival saved locally; the handover will reconcile it.",
      );
      break;
    }
    case "return":
      await runCommand(`/api/trips/${id}/return`);
      toast("Depot return confirmed.");
      break;
    case "clear-signature": {
      const c = $("#signature-pad");
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
      signature = "";
      drawn = false;
      dirty = true;
      return;
    }
    case "save-draft": {
      const f = $("#delivery-form");
      await dbOperation("drafts", "put", {
        id: D.user.id + ":" + id,
        fields: {
          ...fields(f),
          evidence_unavailable: f.elements.evidence_unavailable.checked,
        },
        signature,
        photo,
      });
      dirty = false;
      toast("Draft saved on this device.");
      return;
    }
    case "sync":
      await syncQueue();
      break;
    default:
      return;
  }
  render();
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled || busy) return;
  busy = true;
  el.disabled = true;
  try {
    await action(el.dataset.action, el.dataset.id);
  } catch (error) {
    toast(error.message);
  } finally {
    busy = false;
    if (el.isConnected) el.disabled = false;
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault();
  if (busy) return;
  busy = true;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  const errorBox = form.querySelector(".form-error");
  if (errorBox) errorBox.textContent = "";
  try {
    const v = fields(form),
      id = form.dataset.id;
    if (form.id === "login-form") {
      await accept(await api("/api/login", v));
      dirty = false;
      selectedTrip = "";
      location.hash = "#/" + nav[D.user.role][0][0];
    } else if (form.id === "order-form") {
      await runCommand("/api/orders", {
        ...v,
        units: Number(v.units),
        weight: Number(v.weight),
        volume: Number(v.volume),
      });
      location.hash = "#/orders";
      toast("Order submitted to the shared queue.");
    } else if (form.id === "receipt-form") {
      await runCommand(`/api/orders/${id}/receipt`, {
        quantity: Number(v.quantity),
        note: v.note,
      });
      toast("Receipt recorded. Any discrepancy is visible to the dispatcher.");
    } else if (
      form.id === "issue-form" ||
      form.classList.contains("shortage-form")
    ) {
      await runCommand(`/api/orders/${id}/issue`, { note: v.note });
      toast("Issue sent to the dispatcher.");
    } else if (form.classList.contains("defer-form")) {
      const s = stop(id);
      await runCommand(`/api/orders/${id}/defer`, {
        reason: v.reason,
        ...(s ? { version: trip(s.trip_id).version } : {}),
      });
      toast(
        "Deferral recorded. The next operating date is visible to the store.",
      );
    } else if (form.id === "trip-settings") {
      await runCommand(`/api/trips/${id}/settings`, {
        ...v,
        version: trip(id).version,
      });
      toast("Run settings saved.");
    } else if (form.id === "new-trip-form") {
      const result = await runCommand("/api/trips", v);
      selectedTrip = result.id;
      planningDay = v.date;
      location.hash = "#/planning";
    } else if (form.classList.contains("load-form")) {
      await runCommand(`/api/trips/${form.dataset.trip}/load`, {
        order_id: id,
        loaded: Number(v.loaded),
        verified: false,
      });
      toast("Physical count saved. Verify it when the quantity matches.");
    } else if (form.classList.contains("resolve-form")) {
      await runCommand(`/api/issues/${id}/resolve`, v);
      toast(
        "Resolution recorded; the original quantities remain in the audit history.",
      );
    } else if (form.id === "delivery-form") {
      await saveDelivery(form);
      return;
    }
    render();
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else toast(error.message);
  } finally {
    busy = false;
    if (submit?.isConnected) submit.disabled = false;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.closest("form") && e.target.closest("form").id !== "login-form")
    dirty = true;
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "trip-picker") {
    if (dirty && !confirm("Change runs and discard unsaved edits?")) {
      e.target.value = selectedTrip;
      return;
    }
    selectedTrip = e.target.value;
    planningDay = trip(selectedTrip).date;
    dirty = false;
    render();
  }
  if (e.target.id === "planning-day") {
    planningDay = e.target.value;
    render();
  }
  if (e.target.id === "new-vehicle") {
    $("#new-driver").value =
      D.drivers.find((d) => d.vehicle_id === e.target.value)?.id || "";
  }
  if (e.target.id === "photo-input") {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 15000000
      )
        throw new Error("Choose a PNG, JPEG, or WebP photograph under 15 MB.");
      const bitmap = await createImageBitmap(file),
        scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height)),
        c = document.createElement("canvas");
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      photo = c.toDataURL("image/jpeg", 0.75);
      if (photo.length > 1500000)
        throw new Error(
          "This photo is still too large. Choose a smaller image.",
        );
      $("#photo-preview").innerHTML =
        `<img src="${esc(photo)}" alt="Selected delivery photograph">`;
      dirty = true;
    } catch (error) {
      photo = "";
      e.target.value = "";
      toast(error.message);
    }
  }
});
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && dirty) {
    if (
      !confirm("Leave unsaved changes? Use Save draft to keep a delivery form.")
    )
      e.preventDefault();
    else dirty = false;
  }
});
window.addEventListener("hashchange", () => {
  dirty = false;
  render();
  window.scrollTo(0, 0);
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("offline", () => {
  online = false;
  if (!dirty) render();
  else
    toast(
      "Connection lost. You can still save this driver handover on the device.",
    );
});
window.addEventListener("online", async () => {
  online = true;
  if (busy) return;
  busy = true;
  try {
    if (D) {
      await refresh(false);
      await syncQueue();
      if (!dirty) render();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    busy = false;
  }
});
async function boot() {
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() =>
        toast(
          "Offline application caching is unavailable. Use HTTPS or localhost.",
        ),
      );
  try {
    await storage();
    try {
      await accept(await api("/api/state"));
    } catch (error) {
      if (error.network) {
        const uid = localStorage.getItem("waypoint-last-user"),
          saved = uid ? await dbOperation("cache", "get", uid) : null;
        if (saved) {
          D = saved.data;
          await loadQueue();
        }
      } else if (error.status !== 401) throw error;
    }
    render();
    if (D && online && queue.length) {
      await syncQueue();
      render();
    }
  } catch (error) {
    $("#app").innerHTML = loginView();
    toast(error.message);
  }
  setInterval(async () => {
    if (D && !dirty && !busy && navigator.onLine) {
      busy = true;
      try {
        await refresh();
      } catch (error) {
        toast(error.message);
      } finally {
        busy = false;
      }
    }
  }, 15000);
}
boot();
