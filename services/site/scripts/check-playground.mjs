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
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll at 375 px");
  console.log("playground: platform switch, dark, large text, RTL and deep links work");
} finally { await browser.close(); server.close(); }
