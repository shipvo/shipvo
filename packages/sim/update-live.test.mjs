// Live: OTA updates against a real sim server and a stub control plane. Release 1 is the local app; release 2 is served signed.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { makeKey, signedPointer, stubControlPlane } from "./update-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(9600, 300);
const root = mkdtempSync(join(tmpdir(), "sim-update-live-"));
const dist = join(root, "dist"); const dir = join(root, "state");
const key = makeKey();
const page = (title, body = "") => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
const V1 = page("Release 1");
const V2 = page("Release 2");
const BAD = page("Release 3", "<script>throw new Error('boot crash')</script>");
const state = { pointer: null, files: {} };
let proc, cp;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const publish = (n, html, over) => { state.pointer = signedPointer(key, n, html, over); state.files[`r${n}/index.html`] = html; };

function ensureChromium() {
  const pw = createRequire(import.meta.url)("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  cp = await stubControlPlane(state);
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), V1);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist, "--update-url", cp.url, "--update-key", key.publicB64], { stdio: ["ignore", "ignore", "pipe"], cwd: root });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start within 90 s. Server stderr: ${err || "(empty)"}`);
});
after(async () => {
  cp?.close();
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("check goes to ready, apply restarts and the new bundle runs, with a banner and a simulated log", async () => {
  assert.ok((await call("/session", { session: "a" })).ok);
  assert.equal((await act("a", { action: "get_update_state" })).update.state, "idle");
  assert.equal((await act("a", { action: "apply_update" })).code, "not_ready");
  publish(2, V2);
  const c = await act("a", { action: "check_for_update" });
  assert.deepEqual([c.ok, c.update.state, c.update.pending_release], [true, "ready", 2]);
  assert.match(c.screen, /Simulated: update ready: release 2/); assert.match(c.screen, /Release 1/);
  const a = await act("a", { action: "apply_update" });
  assert.equal(a.update.state, "applied"); assert.equal(a.update.release, 2);
  assert.match(a.screen, /Release 2/); assert.match(a.screen, /Simulated: update applied: release 2/);
  const log = (await act("a", { action: "device_log" })).log.filter((l) => l.name === "update_state");
  assert.deepEqual(log.map((l) => l.state), ["checking", "downloading", "ready", "applied"]);
  assert.ok(log.every((l) => l.source === "simulated"));
  assert.equal((await act("a", { action: "check_for_update" })).code, "no_update");
});

test("a bad signature ends idle with verify_failed and is never applied", async () => {
  await call("/session", { session: "b" });
  publish(2, V2); state.pointer.release = 9;
  const c = await act("b", { action: "check_for_update" });
  assert.deepEqual([c.update.state, c.update.reason], ["idle", "verify_failed"]);
  assert.equal((await act("b", { action: "apply_update" })).code, "not_ready");
  assert.match((await act("b", { action: "screen" })).screen, /Release 1/);
});

test("a release that throws on boot reverts after 3 boots with crash_loop", async () => {
  await call("/session", { session: "c" });
  publish(3, BAD);
  assert.equal((await act("c", { action: "check_for_update" })).update.state, "ready");
  const a = await act("c", { action: "apply_update" });           // boot 1
  assert.equal(a.update.state, "applied"); assert.match(a.screen, /Release 3/);
  assert.equal((await act("c", { action: "restart" })).ok, true);  // boot 2
  assert.equal((await act("c", { action: "get_update_state" })).update.state, "applied");
  const r = await act("c", { action: "restart" });                 // boot 3
  const u = (await act("c", { action: "get_update_state" })).update;
  assert.deepEqual([u.state, u.reason, u.release, u.blocked], ["reverted", "crash_loop", "local", [3]]);
  assert.match(r.screen, /Release 1/); assert.match(r.screen, /Simulated: update reverted/);
  assert.equal((await act("c", { action: "check_for_update" })).code, "no_update");
});
