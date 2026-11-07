// open_url against a real sim server and a page that stands in for the device layer:
// `__pnDevice.openUrl` returns true only when the page has a listener.
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
const root = mkdtempSync(join(tmpdir(), "sim-link-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1>
<script>
window.__seen = [];
window.__pnDevice = { log() { return []; }, capabilities() { return null; }, openUrl(u) { window.__seen.push(u); document.getElementById("h").textContent = "Opened " + u; return true; } };
</script><button onclick="document.getElementById('i').textContent = 'initial=' + (window.__pnInitialUrl ?? null)">Read initial</button><p id="i">unread</p></body></html>`;
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

const PHONE = { apps: [
  { id: "appa", name: "A", url: "fixture://a", schemes: ["appa"] }, { id: "appb", name: "B", url: "fixture://b", schemes: ["appb"] },
  { id: "appc", name: "C", url: "fixture://c", schemes: ["appc"] }, { id: "appd", name: "D", url: "fixture://d", schemes: ["appd"] }], current_app: "appa" };
async function readInitial(session) {
  const first = await act(session, { action: "screen" });
  const m = /Read initial[^\n]*\[ref=(\w+)\]/.exec(first.screen); assert.ok(m, first.screen);
  const r = await act(session, { action: "tap", ref: m[1] });
  return /initial=(\S+)/.exec(r.screen)?.[1];
}

test("A opens B's scheme: B is current and gets the URL as a link and as the initial URL", async () => {
  assert.ok((await call("/session", { session: "x", phone: PHONE })).ok);
  const r = await act("x", { action: "open_url", url: "appb://item/42" });
  assert.equal(r.ok, true, r.error); assert.equal(r.app, "appb");
  assert.match(r.screen, /Opened appb:\/\/item\/42/);
  assert.equal(await readInitial("x"), "appb://item/42");
  const dl = await act("x", { action: "device_log" }); assert.equal(dl.ok, true, JSON.stringify(dl)); const log = dl.log;
  const e = log.find((l) => l.name === "open_url");
  assert.ok(e, JSON.stringify(log)); assert.equal(e.source, "simulated"); assert.equal(e.app, "appb");
  assert.ok(log.some((l) => l.name === "switch_app" && l.app === "appb"));
});

test("a link does not follow the user: switch_app to D right after open_url sees no initial URL", async () => {
  assert.ok((await call("/session", { session: "y", phone: PHONE })).ok);
  assert.equal((await act("y", { action: "open_url", url: "appc://item/5" })).ok, true);
  assert.equal((await act("y", { action: "switch_app", id: "appd" })).ok, true);
  assert.equal(await readInitial("y"), "null");
});

test("two links in a row leave no script behind: a restart sees no initial URL", async () => {
  assert.ok((await call("/session", { session: "z", phone: PHONE })).ok);
  assert.equal((await act("z", { action: "open_url", url: "appb://item/1" })).ok, true);
  assert.equal((await act("z", { action: "open_url", url: "appc://item/2" })).ok, true);
  assert.equal(await readInitial("z"), "appc://item/2");
  const r = await act("z", { action: "restart" }); assert.equal(r.ok, true, r.error);
  assert.equal(await readInitial("z"), "null");
});

test("two links in a row, then switch_app: the next app sees no stale initial URL", async () => {
  assert.ok((await call("/session", { session: "w", phone: PHONE })).ok);
  assert.equal((await act("w", { action: "open_url", url: "appb://item/1" })).ok, true);
  assert.equal((await act("w", { action: "open_url", url: "appc://item/2" })).ok, true);
  assert.equal((await act("w", { action: "switch_app", id: "appd" })).ok, true);
  assert.equal(await readInitial("w"), "null");
});
