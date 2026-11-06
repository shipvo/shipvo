import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { createLifecycle } from "./lifecycle.mjs";

test("state machine: lock, unlock, typed errors, guard, restart", () => {
  const l = createLifecycle();
  assert.throws(() => l.unlock(), { code: "not_locked" });
  l.lock(); assert.equal(l.locked, true);
  assert.throws(() => l.lock(), { code: "already_locked" });
  assert.throws(() => l.guard("tap"), { code: "locked" });
  l.guard("screen"); l.guard("restart");
  l.restart(); assert.equal(l.locked, false); assert.equal(l.restarts, 1);
  l.guard("tap");
  l.volumeStep("up"); l.volumeStep("down");
  assert.ok(l.log().every((e) => e.source === "simulated"));
  assert.deepEqual(l.log().map((e) => e.kind), ["lock", "restart", "volume_up", "volume_down"]);
});

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(5300, 200);
const root = mkdtempSync(join(tmpdir(), "sim-life-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
// Counts loads in localStorage (kept across a reload) and shows a note typed by the user.
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1>Home</h1><div id="loads"></div>
<script>
const n = Number(localStorage.getItem("loads") || 0) + 1; localStorage.setItem("loads", n);
document.getElementById("loads").textContent = "Loads: " + n + " Saved: " + (localStorage.getItem("note") || "none");
</script><button onclick="localStorage.setItem('note','kept');this.textContent='Saved note'">Save note</button><button id="b2" onclick="document.querySelector('h1').textContent='Detail'">Open detail</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const ref = (screen, text) => new RegExp(`${text}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen)?.[1];

before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("lock then unlock returns to the same screen", async () => {
  const first = await call("/session", { session: "l1" });
  const open = ref(first.screen, "Open detail");
  assert.ok((await act("l1", { action: "tap", ref: open })).ok);
  const before_ = (await act("l1", { action: "screen" })).screen;
  assert.match(before_, /Detail/);
  const locked = await act("l1", { action: "lock" });
  assert.equal(locked.ok, true, locked.error);
  assert.match(locked.screen, /Swipe up to unlock/);
  assert.doesNotMatch(locked.screen, /Detail|Open detail/);
  const blocked = await act("l1", { action: "tap", ref: "e1" });
  assert.equal(blocked.ok, false); assert.equal(blocked.code, "locked"); assert.equal(blocked.delivery, "not_delivered");
  assert.equal((await act("l1", { action: "lock" })).code, "already_locked");
  const un = await act("l1", { action: "unlock" });
  assert.equal(un.ok, true, un.error);
  assert.doesNotMatch(un.screen, /Swipe up/);
  assert.match(un.screen, /Detail/);
  assert.equal((await act("l1", { action: "unlock" })).code, "not_locked");
});

test("restart reloads the app (cold start) and storage survives", async () => {
  const first = await call("/session", { session: "r1" });
  assert.match(first.screen, /Loads: 1 Saved: none/);
  assert.ok((await act("r1", { action: "tap", ref: ref(first.screen, "Save note") })).ok);
  const r = await act("r1", { action: "restart" });
  assert.equal(r.ok, true, r.error);
  assert.match(r.screen, /Loads: 2 Saved: kept/);
  assert.doesNotMatch(r.screen, /Saved note/);
  // restart also leaves the lock screen
  await act("r1", { action: "lock" });
  const r2 = await act("r1", { action: "restart" });
  assert.match(r2.screen, /Loads: 3 Saved: kept/); assert.doesNotMatch(r2.screen, /Swipe up/);
});

test("device_log lists lock, unlock and restart as simulated", async () => {
  await call("/session", { session: "g1" });
  await act("g1", { action: "lock" }); await act("g1", { action: "unlock" }); await act("g1", { action: "restart" });
  const { log } = await act("g1", { action: "device_log" });
  const mine = log.filter((e) => ["lock", "unlock", "restart"].includes(e.kind));
  assert.deepEqual(mine.map((e) => e.kind), ["lock", "unlock", "restart"]);
  assert.ok(mine.every((e) => e.source === "simulated"));
});

test("actions on an unknown session: no_session", async () => {
  for (const action of ["lock", "unlock", "restart"]) assert.equal((await act("nobody", { action })).code, "no_session");
});
