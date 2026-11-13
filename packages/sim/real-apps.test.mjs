// Things real apps do that the simulator must cope with: a build made with a base path, a script that does not load,
// and an app that never lets the network go quiet.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(13300, 150);   // own port range
const root = mkdtempSync(join(tmpdir(), "sim-realapps-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc;

// Built as Expo builds with experiments.baseUrl "/static": the bundle is asked for under /static. It also names a script
// that does not exist, and it polls its own server for ever.
const INDEX = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<h1 id="state">not started</h1>
<script src="/static/_expo/static/js/web/app.js" defer></script>
<script src="/static/_expo/static/js/web/missing.js" defer></script></body></html>`;
const BUNDLE = `document.getElementById("state").textContent = "app started"; setInterval(() => { fetch("/static/_expo/static/js/web/app.js?poll=" + Date.now()).catch(() => {}); }, 150);`;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();

function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not install Chromium for playwright");
}

before(async () => {
  ensureChromium();
  mkdirSync(join(dist, "_expo", "static", "js", "web"), { recursive: true });
  writeFileSync(join(dist, "index.html"), INDEX); writeFileSync(join(dist, "_expo", "static", "js", "web", "app.js"), BUNDLE);
  writeFileSync(join(root, "secret.txt"), "outside the build");
  mkdirSync(join(dist, "assets"), { recursive: true }); writeFileSync(join(dist, "assets", "logo file.txt"), "a build file");
  try { symlinkSync(join(root, "secret.txt"), join(dist, "assets", "link.txt")); } catch { /* no links on this system: that case is skipped */ }
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here, env: { ...process.env, SHIPVO_SIM_NET_QUIET_MS: "1500" } });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/app/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("a build made with a base path gets its files under that path, and nothing outside the build", async () => {
  const ok = await fetch(`http://localhost:${PORT}/static/_expo/static/js/web/app.js`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /app started/);
  assert.equal((await fetch(`http://localhost:${PORT}/static/_expo/static/js/web/nope.js`)).status, 404);
  assert.equal((await fetch(`http://localhost:${PORT}/static/..%2Fsecret.txt`)).status, 404);
  assert.equal((await fetch(`http://localhost:${PORT}/other/_expo/static/js/web/app.js`)).status, 404, "only the build's own base path is served");
});

test("no address reads a file outside the build folder", async () => {
  const get = async (path) => { const r = await fetch(`http://localhost:${PORT}${path}`); return { status: r.status, body: await r.text() }; };
  for (const path of [
    "/_expo/..%2F..%2Fsecret.txt", "/assets/..%2F..%2Fsecret.txt", "/_expo/%2e%2e%2f%2e%2e%2fsecret.txt", "/assets/..%5C..%5Csecret.txt",
    "/assets/%2e%2e/%2e%2e/secret.txt", "/static/_expo/..%2F..%2F..%2Fsecret.txt", "/app/..%2Fsecret.txt", "/assets/%E0%A4%A",
  ]) {
    const r = await get(path);
    assert.doesNotMatch(r.body, /outside the build/, `${path} returned a file from outside the build`);
  }
  assert.equal((await get("/_expo/..%2F..%2Fsecret.txt")).status, 404);
  if (existsSync(join(dist, "assets", "link.txt"))) assert.doesNotMatch((await get("/assets/link.txt")).body, /outside the build/, "a link inside the build must not lead out of it");
});

test("build files are still served, with spaces and other escaped characters in their names", async () => {
  const r = await fetch(`http://localhost:${PORT}/assets/logo%20file.txt`);
  assert.equal(r.status, 200); assert.equal(await r.text(), "a build file");
  assert.equal((await fetch(`http://localhost:${PORT}/_expo/static/js/web/app.js`)).status, 200);
  assert.match(await (await fetch(`http://localhost:${PORT}/app/any/screen`)).text(), /not started/, "an unknown path under /app/ is the app");
});

test("an app that keeps the network busy still opens, and it has run", async () => {
  const t0 = Date.now();
  const r = await call("/session", { session: "busy" });
  assert.ok(r.ok, r.error);
  assert.match(r.screen, /app started/);
  assert.ok(Date.now() - t0 < 20_000, `opening took ${Date.now() - t0} ms`);
});

test("a script that does not load is in the session's errors", async () => {
  assert.ok((await call("/session", { session: "errs" })).ok);
  const r = await call("/act", { session: "errs", action: "errors" });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.errors.filter((e) => /script did not load/.test(e)), ["a script did not load (404): /static/_expo/static/js/web/missing.js"]);
});
