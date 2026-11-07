// Issue #1153. shipvo.dev/demos/chess/ shows an Android phone and an iOS phone, and one autoplay move
// updates the move list. Serves the built site files and drives them in Chromium with Playwright
// (taken from apps/chess). Without Playwright the browser part is skipped, unless CI=true.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, ["build.mjs"], { cwd: site, stdio: "ignore" });
const pub = join(site, "public"), dir = join(pub, "demos/chess");

// Static checks: the files exist, the page is light, and the links resolve.
const html = readFileSync(join(dir, "index.html"), "utf8");
for (const f of ["phone-android.html", "phone-ios.html", "demo.js", "engine.js", "clock.js", "app/index.html"]) assert.ok(existsSync(join(dir, f)), `missing demos/chess/${f}`);
assert.match(html, /data-src="\/demos\/chess\/phone-android\.html"/);
assert.match(html, /data-src="\/demos\/chess\/phone-ios\.html"/);
assert.doesNotMatch(html, /<iframe[^>]* src=/, "phones must load lazily (data-src), not with src");
assert.ok(Buffer.byteLength(html) < 20_000, "the page HTML stays small");
for (const w of ["get_board", "legal_moves", "move", "@shipvo/mcp", "docs/demos/chess.md"]) assert.ok(html.includes(w), `page does not mention ${w}`);
assert.match(readFileSync(join(site, "pages/index.html"), "utf8"), /href="\/demos\/chess\/"/, "homepage links to the demo");
assert.match(readFileSync(join(pub, "llms.txt"), "utf8"), /https:\/\/shipvo\.dev\/demos\/chess\//, "llms.txt links to the demo");
const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
assert.ok(size(dir) < 2_000_000, "the demo files stay under 2 MB");
console.log("chess demo: static files ok");

let chromium;
try { ({ chromium } = createRequire(join(site, "../../apps/chess/package.json"))("playwright")); } catch {}
if (!chromium) { if (process.env.CI) { console.error("chess demo: Playwright not found"); process.exit(1); } console.log("chess demo: no Playwright, browser check skipped"); process.exit(0); }

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
  await page.goto(`${base}/demos/chess/?delay=150`);
  const android = page.frameLocator("#cd-phone-white").frameLocator("#app");
  const ios = page.frameLocator("#cd-phone-black").frameLocator("#app");
  // Both phones render, in their own frames.
  await android.getByTestId("board").waitFor({ timeout: 30_000 });
  await ios.getByTestId("board").waitFor({ timeout: 30_000 });
  assert.equal(await page.locator("#cd-phone-white").contentFrame().locator('[data-platform="android"]').count(), 1);
  assert.equal(await page.locator("#cd-phone-black").contentFrame().locator('[data-platform="ios"]').count(), 1);
  // One autoplay move updates the move list, and shows on the other phone.
  await page.locator("#cd-moves li").first().waitFor({ timeout: 30_000 });
  assert.match(await page.locator("#cd-moves li").first().textContent(), /^1\. e2e4/);
  await ios.getByLabel("white pawn on e4").waitFor({ timeout: 10_000 });
  // "Play against it": the visitor taps white, the code answers for black.
  await page.locator("#cd-mode").click();
  await android.getByTestId("board").waitFor({ timeout: 30_000 });
  await ios.getByTestId("board").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /Your move/.test(document.getElementById("cd-status").textContent), null, { timeout: 30_000 });
  await android.getByTestId("square-e2").click();
  await android.getByTestId("square-e4").click();
  await page.waitForFunction(() => document.querySelectorAll("#cd-moves li").length === 1 && /^1\. e2e4 \S+/.test(document.querySelector("#cd-moves li").textContent), null, { timeout: 30_000 });
  assert.deepEqual(errors, []);
  // 375 px does not scroll sideways.
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll at 375 px");
  console.log("chess demo: both phones render, autoplay move and a played move update the move list");
} finally { await browser.close(); server.close(); }
