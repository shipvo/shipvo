// Issue #1239 (shell slice). /playground/ is built, linked from the Product menu and the homepage, and its core logic works.
// With Playwright, the page opens in Chromium: the Android/iOS switch swaps the phone, the toggles set aria-pressed and the link, and #ota opens its panel.
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

const core = await import(join(pub, "playground/core.js"));
assert.equal(core.featureFromHash("#ota"), "ota");
assert.equal(core.featureFromHash("#nope"), "app");
assert.equal(core.featureFromHash(""), "app");
for (const id of ["device", "ota", "agent", "phones"]) assert.equal(core.featureFromHash("#" + id), id);
const all = { platform: "ios", dark: true, large: true, rtl: true };
assert.equal(core.searchFromSettings(all), "?platform=ios&dark=1&large=1&rtl=1");
assert.deepEqual(core.settingsFromSearch(core.searchFromSettings(all)), all);
assert.equal(core.searchFromSettings(core.DEFAULTS), "");
assert.deepEqual(core.settingsFromSearch("?platform=bogus&dark=yes"), core.DEFAULTS);
assert.deepEqual(core.appStyle(all), { dir: "rtl", colorScheme: "dark", zoom: "1.3" });
assert.deepEqual(core.appStyle(core.DEFAULTS), { dir: "ltr", colorScheme: "light", zoom: "1" });
assert.equal(core.phoneSrc("ios"), "/demos/chess/phone-ios.html");
assert.equal(core.phoneSrc("android"), "/demos/chess/phone-android.html");

const html = readFileSync(join(pub, "playground/index.html"), "utf8");
for (const f of core.FEATURES) {
  assert.ok(html.includes(`href="#${f.id}"`), `sidebar link #${f.id}`);
  assert.ok(html.includes(`id="pg-panel-${f.id}"`), `panel ${f.id}`);
}
assert.ok(html.includes('data-platform="android"') && html.includes('data-platform="ios"'), "Android and iOS buttons");
assert.doesNotMatch(html, /<iframe[^>]* src=/, "the phone loads from script");
assert.match(readFileSync(join(site, "pages/index.html"), "utf8"), /href="\/playground\/"/, "homepage links to the playground");
assert.match(readFileSync(join(site, "shell.mjs"), "utf8"), /"\/playground\/"/, "Product menu links to the playground");
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
const SLOW = 90_000;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/playground/#ota`);
  assert.equal(await page.locator("#pg-panel-ota").isVisible(), true, "#ota opens the OTA panel");
  assert.equal(await page.locator("#pg-panel-app").isVisible(), false);
  await page.locator('[data-feature="device"]').click();
  await page.locator("#pg-panel-device").waitFor({ state: "visible" });
  const phone = page.frameLocator("#pg-phone");
  await phone.locator('[data-platform="android"]').waitFor({ state: "attached", timeout: SLOW });
  await page.locator('[data-platform="ios"]').click();
  await phone.locator('[data-platform="ios"]').waitFor({ state: "attached", timeout: SLOW });
  assert.match(page.url(), /platform=ios/);
  assert.equal(await page.locator('[data-platform="ios"]').getAttribute("aria-pressed"), "true");
  await page.locator("#pg-dark").click(); await page.locator("#pg-large").click(); await page.locator("#pg-rtl").click();
  assert.match(page.url(), /dark=1&large=1&rtl=1/);
  const app = phone.frameLocator("#app");
  await app.locator("html").waitFor({ state: "attached", timeout: SLOW });
  await page.waitForFunction(() => { const d = document.getElementById("pg-phone").contentWindow.frames[0]?.document; return d && d.documentElement.dir === "rtl" && d.documentElement.style.colorScheme === "dark" && d.body.style.zoom === "1.3"; }, null, { timeout: SLOW });
  // A shared link restores the setup.
  await page.goto(`${base}/playground/?platform=ios&rtl=1#agent`);
  assert.equal(await page.locator("#pg-panel-agent").isVisible(), true);
  assert.equal(await page.locator("#pg-rtl").getAttribute("aria-pressed"), "true");
  await page.frameLocator("#pg-phone").locator('[data-platform="ios"]').waitFor({ state: "attached", timeout: SLOW });
  assert.deepEqual(errors, []);
  console.log("playground: browser check ok");
} finally { await browser.close(); server.close(); }
