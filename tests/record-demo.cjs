/* Record the real local workflow; each chapter aligns to docs/VIDEO_NARRATION.json. */
const fs = require("fs"),
  path = require("path"),
  { spawn } = require("child_process");
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "submission");
const scenes = JSON.parse(
  fs.readFileSync(path.join(out, "durations.json"), "utf8"),
);
const fixture = path.join(out, "recording-" + Date.now() + ".db"),
  base = "http://127.0.0.1:8012";
const server = spawn(
  process.env.PYTHON_BINARY || "python",
  ["backend/server.py"],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: "",
      SQLITE_PATH: fixture,
      PORT: "8012",
      HOST: "127.0.0.1",
      DEMO_CLOCK: "2026-06-23T15:00:00+05:30",
    },
    stdio: "ignore",
  },
);
let browser, page, context, start, duration;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready() {
  for (let i = 0; i < 400; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("Recording fixture did not start.");
}
async function at(fraction) {
  if (process.env.RECORD_FAST === "1") return;
  await sleep(Math.max(0, start + duration * fraction * 1000 - Date.now()));
}
async function scene(id, mobile, fn) {
  if (process.env.RECORD_CHAPTER && process.env.RECORD_CHAPTER !== id) return;
  const item = scenes.find((s) => s.id === id);
  duration = item.seconds + 2;
  console.log("Recording " + id + " (" + Math.round(duration) + " seconds)");
  context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    recordVideo: {
      dir: out,
      size: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    },
  });
  page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  start = Date.now();
  await fn();
  await at(1);
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(out, id + ".webm"));
  await video.delete();
  console.log("Recorded " + id);
}
async function login(user) {
  await page.goto(base);
  await page.locator("#username").fill(user);
  await page.locator("#password").fill("demo123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function act(label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForFunction(() => !busy);
}
async function submit(selector) {
  await page.locator(selector + " button[type=submit]").click();
  await page.waitForFunction(() => !busy);
}
async function handover(count, name) {
  await page.locator("#delivered").fill(String(count));
  await page.locator("#recipient").fill(name);
  await page
    .locator("#delivery-notes")
    .fill(
      "Evidence unavailable: camera could not be used at this receiving point. Receiver confirmed the quantity.",
    );
  await page.locator("#evidence-unavailable").check();
  await submit("#delivery-form");
}
function architecture() {
  const code = fs
    .readFileSync(path.join(root, "backend/server.py"), "utf8")
    .split("\n")
    .slice(106, 123)
    .join("\n")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><html><head><style>body{margin:0;background:#f4f7fc;color:#172554;font:18px Arial;padding:44px}h1{font-size:36px;margin:0 0 12px}p{color:#536580;line-height:1.6}h2{font-size:23px}.flow{display:flex;gap:18px;align-items:center;margin:28px 0}.box{background:white;padding:24px;border:1px solid #d8e2f0;border-radius:12px;flex:1}.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:25px}pre{background:#172554;color:#e0eaff;font:12px monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;border-radius:12px;overflow:auto;line-height:1.55}li{margin:15px 0;line-height:1.45}.check{color:#15803d}small{font-size:14px;color:#536580}</style></head><body><h1>Waypoint · code & architecture</h1><p>The Vercel adapter and Docker service use the same API, SQL schema, and domain commands.</p><div class="flow"><div class="box"><strong>Four role workspaces</strong><p>Store · Dispatcher · Loader · Driver</p></div><span>→</span><div class="box"><strong>Python API</strong><p>Role checks · workflow commands · planning validation</p></div><span>→</span><div class="box"><strong>PostgreSQL</strong><p>Orders · trips · stops · evidence · receipts · audit</p></div></div><div class="columns"><section><h2>Offline lifecycle</h2><ol><li>Service worker caches the application shell.</li><li>IndexedDB persists manifests, drafts, and handovers.</li><li>Each handover has a unique client ID and payload hash.</li><li>The queue removes a record only after server acknowledgment.</li></ol><h2 class="check">Verified</h2><p>12 integration tests, real browser offline reload/reconnect, PostgreSQL workflow, and complete Docker Compose startup.</p><small>Source: backend/server.py · backend/domain.py · api/index.py<br>Documentation: docs/ARCHITECTURE.md · docs/DATA_MODEL.md</small></section><section><h2>Actual API evidence validation</h2><pre>${code}</pre></section></div></body></html>`;
}
(async () => {
  try {
    await ready();
    browser = await pw.chromium.launch({
      headless: true,
      channel: process.env.BROWSER_CHANNEL || "msedge",
    });
    await scene("01-store", false, async () => {
      await login("store");
      await at(0.2);
      await page.goto(base + "/#/order/WP-1042");
      await at(0.45);
      await page.goto(base + "/#/create");
      await page.locator("#units").fill("5");
      await page.locator("#weight").fill("40");
      await page.locator("#volume").fill("0.3");
      await page
        .locator("#order-note")
        .fill("Ambient demonstration request for the next operating run.");
      await at(0.7);
      await submit("#order-form");
      await page
        .getByRole("heading", { name: "My orders", exact: true })
        .waitFor();
    });
    await scene("02-planning", false, async () => {
      await login("dispatch");
      await page.goto(base + "/#/planning");
      await at(0.15);
      await page.locator("#plan-vehicle").selectOption("VEH037");
      await submit("#trip-settings");
      await page.locator(".validation-list").scrollIntoViewIfNeeded();
      await at(0.3);
      await page.locator("#plan-vehicle").selectOption("VEH035");
      await submit("#trip-settings");
      await at(0.4);
      await page.locator('[data-action="assign"][data-id="WP-1050"]').click();
      await page.waitForFunction(() => !busy);
      await page.locator(".validation-list").scrollIntoViewIfNeeded();
      await at(0.48);
      await page.locator('[data-action="unassign"][data-id="WP-1050"]').click();
      await page.waitForFunction(() => !busy);
      await at(0.58);
      while (await page.locator(".defer-form").count()) {
        const form = page.locator(".defer-form").first();
        await form
          .locator("input")
          .fill(
            "Selected run lacks compatible capacity. Review a later run or revise the bulk request into split shipments.",
          );
        await form.locator("button[type=submit]").click();
        await page.waitForFunction(() => !busy);
      }
      await at(0.75);
      await act("Validate run");
      await act("Publish plan");
      await page.locator(".main").scrollIntoViewIfNeeded();
    });
    await scene("03-loading", true, async () => {
      await login("loader");
      await at(0.2);
      await submit(".shortage-form");
      await at(0.4);
      await page.locator("#loaded-WP-1049").fill("20");
      await submit('.load-form[data-id="WP-1049"]');
      await at(0.55);
      for (const id of ["WP-1049", "WP-1042", "WP-1038"]) {
        await page.locator(`[data-action="verify"][data-id="${id}"]`).click();
        await page.waitForFunction(() => !busy);
        await sleep(1000);
      }
      await at(0.82);
      await act("Confirm loading handoff");
    });
    await scene("04-driver", true, async () => {
      await login("driver");
      await at(0.06);
      await act("Start trip");
      await act("I have arrived");
      await page
        .getByRole("link", { name: "Record handover", exact: true })
        .click();
      await page.locator("#delivery-form").waitFor();
      await page.locator("#recipient").fill("OUT001 receiving lead");
      await page.locator("#photo-input").setInputFiles(path.join(root, "test-results", "test-evidence.png"));
      await page.locator("#photo-preview img").waitFor();
      await at(0.18);
      await page.locator("#signature-pad").scrollIntoViewIfNeeded();
      const b = await page.locator("#signature-pad").boundingBox();
      await page.mouse.move(b.x + 20, b.y + 70);
      await page.mouse.down();
      await page.mouse.move(b.x + 90, b.y + 35, { steps: 8 });
      await page.mouse.move(b.x + 150, b.y + 90, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => signature.startsWith("data:image/png") && photo.startsWith("data:image/"));
      await at(0.35);
      await submit("#delivery-form");
      await page.getByRole("heading", { name: "My trip", exact: true }).waitFor();
      await page.goto(base + "/#/my-trip");
      await page
        .getByRole("link", { name: "Record handover", exact: true })
        .click();
      await page.locator("#delivery-form").waitFor();
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await at(0.48);
      await context.setOffline(true);
      await handover(40, "K. Mendis");
      await page.getByRole("heading", { name: "Device & sync", exact: true }).waitFor();
      await at(0.63);
      await page.reload();
      await page
        .getByRole("heading", { name: "Device & sync", exact: true })
        .waitFor();
      await at(0.75);
      await context.setOffline(false);
      await page.waitForFunction(() => D && queue.length === 0 && online, {
        timeout: 25000,
      });
      await at(0.86);
      await page.goto(base + "/#/my-trip");
      await page
        .getByRole("link", { name: "Record handover", exact: true })
        .click();
      await page.locator("#delivery-form").waitFor();
      await handover(20, "OUT003 receiving lead");
      await page.goto(base + "/#/my-trip");
      await page
        .getByRole("heading", { name: "My trip", exact: true })
        .waitFor();
      await at(0.94);
      await act("Confirm depot return");
    });
    await scene("05-receipt", false, async () => {
      await login("store");
      await page.goto(base + "/#/order/WP-1042");
      await page.locator("#receipt-form").waitFor();
      await at(0.22);
      await page.locator("#received").fill("39");
      await page
        .locator("#receipt-note")
        .fill("One crate missing at the receiving count.");
      await at(0.4);
      await submit("#receipt-form");
      await at(0.52);
      await act("Sign out");
      await login("dispatch");
      await page.goto(base + "/#/issues");
      await at(0.7);
      await page
        .locator(".resolve-form textarea")
        .fill(
          "Replacement delivery arranged. Store receiving lead informed; original quantities retained.",
        );
      await submit(".resolve-form");
    });
    await scene("06-architecture", false, async () => {
      await page.setContent(architecture());
    });
    console.log("All six real workflow chapters recorded.");
  } catch (error) {
    if (page) {
      console.error(await page.locator("body").innerText());
      await page.screenshot({path:path.join(out,"recording-error.png")});
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})();

