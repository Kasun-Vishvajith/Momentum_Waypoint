/* Run with Node + Playwright. Uses an isolated fixture and never resets your app DB. */
const fs = require("fs"),
  path = require("path"),
  assert = require("assert"),
  { spawn } = require("child_process");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const fixture = path.join(out, "browser-" + Date.now() + ".db");
const port = process.env.BROWSER_TEST_PORT || "8011",
  base = "http://127.0.0.1:" + port;
const log = fs.openSync(path.join(out, "browser-server.log"), "w");
const server = spawn(
  process.env.PYTHON_BINARY || "python",
  ["backend/server.py"],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: "",
      SQLITE_PATH: fixture,
      PORT: port,
      HOST: "127.0.0.1",
      DEMO_CLOCK: "2026-06-23T15:00:00+05:30",
    },
    stdio: ["ignore", log, log],
  },
);
const errors = [],
  checks = [];
let browser;
async function untilReady() {
  for (let i = 0; i < 400; i++) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Test server did not start.");
}
async function login(page, username) {
  await page.goto(base);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("demo123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
  });
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    body: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.body <= dimensions.width + 1,
    label + " overflows: " + JSON.stringify(dimensions),
  );
  checks.push(label + " width OK");
}
async function action(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForFunction(() => typeof busy !== "undefined" && !busy);
}
async function record(page, count, recipient) {
  await page.locator("#delivered").fill(String(count));
  await page.locator("#recipient").fill(recipient);
  await page
    .locator("#delivery-notes")
    .fill(
      "Camera unavailable on test device; receiver confirmed the counted crates.",
    );
  await page.locator("#evidence-unavailable").check();
  await page
    .getByRole("button", { name: "Save delivery", exact: true })
    .click();
  await page.waitForFunction(() => !busy);
}
(async () => {
  try {
    await untilReady();
    browser = await playwright.chromium.launch({
      headless: true,
      channel: process.env.BROWSER_CHANNEL || "msedge",
    });
    const desktop = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
    const dispatch = await desktop.newPage(),
      loader = await mobile.newPage();
    for (const page of [dispatch, loader]) {
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
    }
    await dispatch.goto(base);
    await dispatch.locator("#username").waitFor();
    await screenshot(dispatch, "01-login-desktop");
    await login(dispatch, "dispatch");
    await dispatch.goto(base + "/#/planning");
    await dispatch
      .getByRole("heading", { name: "Planning", exact: true })
      .waitFor();
    await noOverflow(dispatch, "Desktop planning");
    await screenshot(dispatch, "02-planning-desktop");
    await dispatch.locator("#plan-vehicle").selectOption("VEH037");
    await dispatch
      .getByRole("button", { name: "Save run settings", exact: true })
      .click();
    await dispatch.waitForFunction(() => !busy);
    assert(
      await dispatch
        .getByRole("button", { name: "Publish plan", exact: true })
        .isDisabled(),
    );
    checks.push("Invalid temperature blocks publication");
    await dispatch.locator("#plan-vehicle").selectOption("VEH035");
    await dispatch
      .getByRole("button", { name: "Save run settings", exact: true })
      .click();
    await dispatch.waitForFunction(() => !busy);
    await action(dispatch, "Publish plan");
    await dispatch.getByText("Published", { exact: true }).first().waitFor();
    checks.push("Dispatcher publishes shared run");
    await login(loader, "loader");
    await loader
      .getByRole("heading", { name: "Loading workspace", exact: true })
      .waitFor();
    await noOverflow(loader, "Phone loader");
    await screenshot(loader, "03-loading-shortage-phone");
    assert(
      await loader
        .getByRole("button", { name: "Confirm loading handoff", exact: true })
        .isDisabled(),
    );
    await loader.locator(".shortage-form button[type=submit]").click();
    await loader.waitForFunction(() => !busy);
    await loader.locator("#loaded-WP-1049").fill("20");
    await loader
      .locator('.load-form[data-id="WP-1049"] button[type=submit]')
      .click();
    await loader.waitForFunction(() => !busy);
    for (const id of ["WP-1049", "WP-1042", "WP-1038"]) {
      await loader.locator(`[data-action="verify"][data-id="${id}"]`).click();
      await loader.waitForFunction(() => !busy);
    }
    await action(loader, "Confirm loading handoff");
    checks.push("Shortage reconciled and loader releases run");
    await action(loader, "Sign out");
    await login(loader, "driver");
    const driver = loader;
    await action(driver, "Start trip");
    await action(driver, "I have arrived");
    await driver
      .getByRole("link", { name: "Record handover", exact: true })
      .click();
    await driver.locator("#delivery-form").waitFor();
    await noOverflow(driver, "Phone delivery");
    // Exercise genuine raster photo upload and pointer signature capture at the first stop.
    const photoPage = await desktop.newPage();
    await photoPage.setContent(
      '<html><body style="margin:0;background:#e5e7eb"><p>Competition test delivery evidence</p></body></html>',
    );
    await photoPage.screenshot({ path: path.join(out, "test-evidence.png") });
    await photoPage.close();
    await driver
      .locator("#photo-input")
      .setInputFiles(path.join(out, "test-evidence.png"));
    await driver.locator("#photo-preview img").waitFor();
    await driver.locator("#signature-pad").scrollIntoViewIfNeeded();
    const bounds = await driver.locator("#signature-pad").boundingBox();
    await driver.mouse.move(bounds.x + 20, bounds.y + 70);
    await driver.mouse.down();
    await driver.mouse.move(bounds.x + 90, bounds.y + 35, { steps: 8 });
    await driver.mouse.move(bounds.x + 150, bounds.y + 90, { steps: 8 });
    await driver.mouse.up();
    assert(
      await driver.evaluate(() => signature.startsWith("data:image/png")),
      "Pointer signature must be captured before submitting.",
    );
    await driver.locator("#recipient").fill("OUT001 receiving lead");
    await screenshot(driver, "04-driver-evidence-phone");
    await driver
      .getByRole("button", { name: "Save delivery", exact: true })
      .click();
    await driver.waitForFunction(() => !busy);
    await driver
      .getByRole("heading", { name: "My trip", exact: true })
      .waitFor();
    checks.push("Signature and photo stored in server handover");
    await driver
      .getByRole("link", { name: "Record handover", exact: true })
      .click();
    await driver.locator("#delivery-form").waitFor();
    await driver.evaluate(() => navigator.serviceWorker.ready);
    await driver.waitForFunction(() => !!navigator.serviceWorker.controller);
    await mobile.setOffline(true);
    await record(driver, 40, "K. Mendis");
    await driver
      .getByRole("heading", { name: "Device & sync", exact: true })
      .waitFor();
    await driver.getByText("Pending sync", { exact: true }).waitFor();
    await screenshot(driver, "05-offline-queue-phone");
    await driver.reload();
    await driver
      .getByRole("heading", { name: "Device & sync", exact: true })
      .waitFor();
    assert(await driver.getByText("Pending sync", { exact: true }).isVisible());
    checks.push("Offline reload retains shell, manifest, and queued handover");
    await driver.goto(base + "/#/my-trip");
    await driver
      .getByRole("link", { name: "Record handover", exact: true })
      .click();
    await driver.locator("#delivery-form").waitFor();
    await record(driver, 20, "OUT003 receiving lead");
    await mobile.setOffline(false);
    await driver.waitForFunction(() => D && queue.length === 0 && online, {
      timeout: 25000,
    });
    await screenshot(driver, "06-sync-recovery-phone");
    checks.push(
      "Reconnection synchronizes sequential offline handovers exactly once",
    );
    await driver.goto(base + "/#/my-trip");
    await action(driver, "Confirm depot return");
    const storeContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      store = await storeContext.newPage();
    store.on("pageerror", (e) => errors.push(e.message));
    await login(store, "store");
    await store.goto(base + "/#/order/WP-1042");
    await store.locator("#receipt-form").waitFor();
    await store.locator("#received").fill("39");
    await store
      .locator("#receipt-note")
      .fill("One crate missing at receiving count.");
    await store
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await store.waitForFunction(() => !busy);
    await screenshot(store, "07-store-receipt-desktop");
    checks.push("Store confirms separate receipt and records discrepancy");
    await dispatch.goto(base + "/#/issues");
    await action(dispatch, "Refresh");
    await dispatch
      .getByRole("heading", { name: "Receipt discrepancy", exact: true })
      .waitFor();
    await dispatch
      .locator(".resolve-form textarea")
      .fill("Replacement delivery arranged and store informed.");
    await dispatch.locator(".resolve-form button[type=submit]").click();
    await dispatch.waitForFunction(() => !busy);
    await screenshot(dispatch, "08-dispatch-resolution-desktop");
    checks.push("Dispatcher resolves discrepancy with audit history");
    const state = await dispatch.evaluate(
      async () => await (await fetch("/api/state")).json(),
    );
    assert.equal(state.deliveries.length, 3);
    assert.equal(state.receipts[0].quantity, 39);
    assert(
      state.deliveries
        .find((d) => d.order_id === "WP-1038")
        .signature.startsWith("data:image/png"),
    );
    assert(
      state.deliveries
        .find((d) => d.order_id === "WP-1038")
        .photo.startsWith("data:image/jpeg"),
    );
    assert.equal(state.trips[0].status, "Completed");
    assert.equal(errors.length, 0, "Browser errors: " + errors.join("; "));
    fs.writeFileSync(
      path.join(out, "browser-report.json"),
      JSON.stringify({ passed: true, checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
  } catch (error) {
    console.error(error);
    fs.writeFileSync(
      path.join(out, "browser-report.json"),
      JSON.stringify(
        { passed: false, checks, errors, failure: error.message },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.closeSync(log);
  }
})();
