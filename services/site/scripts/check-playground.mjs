// Issue #1240. shipvo.dev/playground/ shows one phone with an Android/iOS switch, dark mode, large text and
// right-to-left text, and a feature sidebar with deep links (/playground/#ota). Builds the site, serves it, drives it in Chromium.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, ["build.mjs"], { cwd: site, stdio: "ignore" });
const pub = join(site, "public");
const html = readFileSync(join(pub, "playground/index.html"), "utf8");
for (const f of ["playground.js", "phone-android.html", "phone-ios.html", "app.html"]) assert.ok(existsSync(join(pub, "playground", f)), `missing playground/${f}`);
for (const id of ["ota", "device", "agent", "many"]) assert.ok(html.includes(`href="#${id}"`), `sidebar lacks #${id}`);
assert.doesNotMatch(html, /<iframe[^>]* src=/, "the phone loads from script, not with src");
assert.match(html, /href="\/playground\/"/, "nav links to the playground");
assert.match(readFileSync(join(site, "pages/index.html"), "utf8"), /href="\/playground\/"/, "homepage links to the playground");
assert.match(readFileSync(join(pub, "llms.txt"), "utf8"), /https:\/\/shipvo\.dev\/playground\//, "llms.txt links to the playground");
console.log("playground: static files ok");

let chromium;
try { ({ chromium } = createRequire(join(site, "../../apps/chess/package.json"))("playwright")); } catch {}
if (!chromium) { if (process.env.CI) { console.error("playground: Playwright not found"); process.exit(1); } console.log("playground: no Playwright, browser check skipped"); process.exit(0); }

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(pub, p);
  if (!f.startsWith(pub) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end("no"); }
  res.setHeader("content-type", (types[extname(f)] || "application/octet-stream") + "; charset=utf-8");
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/playground/#ota`);
  assert.equal(await page.locator("#pg-panel").getAttribute("data-feature"), "ota", "deep link opens the OTA panel");
  assert.equal(await page.locator('#pg-side a[aria-current="true"]').getAttribute("data-feature"), "ota");
  const phone = page.frameLocator("#pg-phone"), app = phone.frameLocator("#app");
  await app.getByRole("button", { name: "Add Spinning rod to cart" }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator("#pg-phone").contentFrame().locator('[data-platform="android"]').count(), 1);
  // OTA walkthrough on the Android frame, then on the iOS frame: the four steps change the sample app.
  const run = JSON.parse(readFileSync(join(pub, "playground/ota-run.json"), "utf8"));
  assert.equal(run.maxBoots, Number(readFileSync(join(site, "../../packages/runtime/ios/BundleSelector.swift"), "utf8").match(/static let maxBoots = (\d+)/)[1]), "threshold comes from the runtime code");
  assert.equal(run.signature.valid, true); assert.equal(run.signature.tamperedValid, false);
  async function walkOta(platform) {
    const version = app.getByTestId("version");
    await version.waitFor({ timeout: 30_000 });
    assert.match(await version.textContent(), /Version 1/);
    const step = (id) => page.locator(`#pg-panel [data-step="${id}"]`);
    assert.equal(await step("stage").isDisabled(), true, "steps run in order");
    const status = page.getByTestId("ota-status");
    assert.equal(await status.getAttribute("aria-live"), "polite");
    assert.equal(await page.getByTestId("ota-log").getAttribute("role"), "log");
    assert.match(await status.textContent(), /Next: Publish update/);
    await step("pub").click();
    assert.match(await status.textContent(), /Next: Stage to 10%/);
    await app.getByText("Version 2").waitFor({ timeout: 10_000 });
    assert.match(await page.getByTestId("ota-log").textContent(), /Signature check: valid \(Ed25519/);
    await step("stage").click();
    assert.match(await page.getByTestId("ota-log").textContent(), new RegExp(`${run.stages[0].cohorts} of ${run.stages[0].of} cohorts`));
    await step("widen").click();
    await step("crash").click();
    assert.match(await page.getByTestId("ota-log").textContent(), new RegExp(`allows ${run.maxBoots} crashing starts`));
    assert.match(await version.textContent(), /Version 2/, "still version 2 before the threshold is used");
    await step("rollback").click();
    await app.getByText("Version 1").waitFor({ timeout: 10_000 });
    assert.match(await page.getByTestId("ota-log").textContent(), /crash_loop_revert/);
    assert.ok(await page.locator("#pg-phone").contentFrame().locator(`[data-platform="${platform}"]`).count() === 1);
  }
  await walkOta("android");
  await page.locator("#pg-ios").click();
  await page.locator('#pg-panel [data-step="reset"]').click();
  await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
  await walkOta("ios");
  await page.locator("#pg-android").click();
  await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
  // The sidebar changes the panel and the hash.
  await page.locator('#pg-side a[data-feature="device"]').click();
  await page.waitForFunction(() => document.getElementById("pg-panel").getAttribute("data-feature") === "device");
  assert.match(page.url(), /#device$/);
  // iOS switch.
  await page.locator("#pg-ios").click();
  await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator("#pg-phone").contentFrame().locator('[data-platform="ios"]').count(), 1);
  assert.equal(await page.locator("#pg-ios").getAttribute("aria-pressed"), "true");
  // Dark mode, large text and RTL reach the app inside the phone.
  await page.locator("#pg-dark").click(); await page.locator("#pg-large").click(); await page.locator("#pg-rtl").click();
  const root = app.locator("html");
  await page.waitForFunction(() => {
    const d = document.getElementById("pg-phone").contentDocument.getElementById("app").contentDocument.documentElement;
    return d.hasAttribute("data-dark") && d.hasAttribute("data-large") && d.dir === "rtl";
  }, null, { timeout: 10_000 });
  assert.equal(await root.getAttribute("dir"), "rtl");
  // The app still works: tapping Add updates the cart.
  await app.getByRole("button", { name: "Add Tackle box to cart" }).click();
  assert.match(await app.getByTestId("cart").textContent(), /1 item/);
  // Preferences survive an Android/iOS switch.
  await page.locator("#pg-android").click();
  await page.waitForFunction(() => {
    const d = document.getElementById("pg-phone").contentDocument.getElementById("app")?.contentDocument?.documentElement;
    return d && d.hasAttribute("data-dark") && d.dir === "rtl";
  }, null, { timeout: 30_000 });
  // Device panel: every control changes visible text in the app, on both phones.
  await page.goto(`${base}/playground/#device`);
  assert.equal(await page.locator("#pg-panel").getAttribute("data-feature"), "device", "deep link opens the device panel");
  const cases = [
    ["location", "Lisbon", /Location: Lisbon/], ["location", "Tokyo", /Location: Tokyo/],
    ["camera", "harbour", /Camera: sample photo, harbour/], ["camera", "denied", /Camera: permission denied/],
    ["biometrics", "accepted", /Biometrics: success/], ["biometrics", "rejected", /Biometrics: failed/], ["biometrics", "unavailable", /Biometrics: unavailable/],
    ["payment", "approved", /Payment: approved/], ["payment", "declined", /Payment: declined/], ["payment", "timeout", /Payment: timeout/],
    ["airplane", "on", /Airplane mode: on/], ["airplane", "off", /Airplane mode: off/],
  ];
  for (const skin of ["android", "ios"]) {
    await page.locator(`#pg-${skin}`).click();
    await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
    for (const [kind, value, re] of cases) {
      const b = page.locator(`#pg-panel button[data-kind="${kind}"][data-value="${value}"]`);
      assert.ok((await b.boundingBox()).height >= 44, `${kind} ${value} tap target`);
      await b.click();
      await app.getByTestId(kind).filter({ hasText: re }).waitFor({ timeout: 5000 });
    }
    await page.locator('#pg-panel button[data-kind="notification"]').click();
    await app.getByTestId("notification").filter({ hasText: /Notification 1/ }).waitFor({ timeout: 5000 });
  }
  // The choice survives an Android/iOS switch: set payment, switch phone, read it back.
  await page.locator('#pg-panel button[data-kind="payment"][data-value="declined"]').click();
  await app.getByTestId("payment").filter({ hasText: /Payment: declined/ }).waitFor({ timeout: 5000 });
  await page.locator("#pg-android").click();
  await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
  await app.getByTestId("payment").filter({ hasText: /Payment: declined/ }).waitFor({ timeout: 5000 });
  // Agent panel: console tools and Lumi, on both phones.
  for (const skin of ["android", "ios"]) {
    await page.goto(`${base}/playground/?platform=${skin}#agent`);
    assert.equal(await page.locator("#pg-panel").getAttribute("data-feature"), "agent", "deep link opens the agent panel");
    await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
    const runTool = async (tool, args = {}) => {
      await page.locator("#pg-tool").selectOption(tool);
      for (const [k, v] of Object.entries(args)) await page.locator(`#pg-args input[data-arg="${k}"]`).fill(v);
      await page.locator("#pg-run").click();
      await page.waitForFunction((t) => document.getElementById("pg-out").textContent !== t, await page.locator("#pg-out").textContent(), { timeout: 20_000 });
      return JSON.parse(await page.locator("#pg-out").textContent());
    };
    const scr = await runTool("screen");
    assert.ok(scr.elements.some((e) => e.ref === "e1" && e.name === "Add Spinning rod to cart"), `${skin}: screen lists the labelled elements`);
    const after = await runTool("tap", { ref: "e1" });
    assert.match(after.text[0], /1 item/);
    assert.match(await app.getByTestId("cart").textContent(), /Cart: 1 item/, `${skin}: tap adds to the cart`);
    const typed = await runTool("type", { ref: "e4", text: "Leave at the door" });
    assert.equal(typed.value, "Leave at the door");
    assert.equal(await app.getByTestId("note-field").inputValue(), "Leave at the door");
    assert.ok(Array.isArray((await runTool("device_log")).entries));
    // Lumi adds three items with three tap captions (reload for a fresh cart).
    await page.reload();
    await app.getByRole("button", { name: "Add Tackle box to cart" }).waitFor({ timeout: 30_000 });
    await page.locator("#pg-lumi").click();
    await page.locator('#pg-lumi[data-done="true"]').waitFor({ timeout: 15_000 });
    assert.equal(await page.locator("#pg-captions li").filter({ hasText: /taps/ }).count(), 3, `${skin}: three tap captions`);
    assert.match(await app.getByTestId("cart").textContent(), /Cart: 3 items/, `${skin}: Lumi adds three items`);
  }
  // Many phones: count and mix render frames without a reload.
  await page.goto(`${base}/playground/#many`);
  assert.equal(await page.locator("#pg-panel").getAttribute("data-feature"), "many", "deep link opens the many phones panel");
  for (const id of ["pg-many-count", "pg-many-mix"]) assert.equal(await page.locator(`#${id}`).count(), 1, `${id} exists`);
  assert.ok((await page.locator("#pg-many-count").boundingBox()).height >= 44 && (await page.locator("#pg-many-mix").boundingBox()).height >= 44, "many controls are 44 px");
  const frames = (p) => page.locator(`#pg-many-grid iframe[data-platform="${p}"]`).count();
  await page.evaluate(() => { window.__same = true; });
  await page.locator("#pg-many-count").fill("6");
  await page.locator("#pg-many-mix").selectOption("both");
  assert.equal(await frames("android"), 3); assert.equal(await frames("ios"), 3);
  await page.locator("#pg-many-mix").selectOption("ios");
  assert.equal(await frames("ios"), 6); assert.equal(await frames("android"), 0);
  await page.locator("#pg-many-count").fill("12");
  await page.locator("#pg-many-mix").selectOption("android");
  assert.equal(await frames("android"), 12);
  assert.equal(await page.evaluate(() => window.__same), true, "no page reload");
  await page.locator("#pg-many-count").fill("6");
  await page.locator("#pg-many-mix").selectOption("both");
  await page.locator('#pg-many-grid iframe[data-platform="ios"]').first().contentFrame().locator('[data-platform="ios"]').waitFor({ timeout: 30_000 });
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "many phones: no sideways scroll at 375 px");
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll at 375 px");
  // Device panel open at 375 px: all 15 buttons keep 44 px targets and the page does not scroll sideways.
  await page.evaluate(() => { location.hash = "#device"; });
  await page.waitForFunction(() => document.getElementById("pg-panel").getAttribute("data-feature") === "device");
  const small = await page.locator("#pg-panel button[data-kind]");
  const count = await small.count();
  assert.ok(count >= 15, "device panel has its buttons");
  for (let i = 0; i < count; i++) assert.ok((await small.nth(i).boundingBox()).height >= 44, `button ${i} tap target at 375 px`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "device panel: no sideways scroll at 375 px");
  console.log("playground: platform switch, dark, large text, RTL and deep links work");
} finally { await browser.close(); server.close(); }
