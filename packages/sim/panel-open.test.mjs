// An open panel covers the app: tap, type and scroll are refused with panel_open, against a real sim server.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(6100, 300);
const root = mkdtempSync(join(tmpdir(), "sim-panel-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1>
<script>
window.__pnDevice = { state: { platform: "android" }, settings() { return {}; }, notifications() { return []; }, set() {}, dismiss() { return false; }, clearAll() {}, openNotification() { return true; } };
</script><button onclick="document.getElementById('h').textContent='Tapped'">Go</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  // A loaded CI runner can take a while to start Chromium, so wait up to 90 s and fail loudly instead of falling through.
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s. Server stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("a panel is open: tap, type and scroll fail with panel_open and nothing reaches the app", async () => {
  const first = await call("/session", { session: "p" });
  const ref = /Go[^\n]*\[ref=(\w+)\]/.exec(first.screen)?.[1]; assert.ok(ref, first.screen);
  assert.equal((await act("p", { action: "open_notifications" })).ok, true);
  for (const body of [{ action: "tap", ref }, { action: "type", ref, text: "x" }, { action: "scroll", direction: "down" }]) {
    const r = await act("p", body);
    assert.equal(r.ok, false); assert.equal(r.code, "panel_open"); assert.match(r.error, /close_panels/);
  }
  assert.equal((await act("p", { action: "screen" })).screen.includes("Tapped"), false);
  assert.equal((await act("p", { action: "close_panels" })).ok, true);
  assert.equal((await act("p", { action: "tap", ref })).ok, true);
});

test("panel actions need the app in the foreground", async () => {
  assert.ok((await call("/session", { session: "q" })).ok);
  assert.equal((await act("q", { action: "press_home" })).ok, true);
  const r = await act("q", { action: "open_notifications" });
  assert.equal(r.ok, false); assert.equal(r.code, "app_not_foreground");
});
