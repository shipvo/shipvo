// share_to against a real sim server and a page that stands in for the device layer.
// The page calls `__pnShare` like `Share.share` does; `__pnDevice.receiveShare` shows what arrived.
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
const PORT = pickPort(8800, 100);
const root = mkdtempSync(join(tmpdir(), "sim-share-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1>
<script>
window.__pnDevice = {
  receiveShare(p) { document.getElementById("h").textContent = "Got " + p.message + " | " + p.url; return true; },
  set(d) { if (d.clipboard !== undefined) document.getElementById("h").textContent = "Clip " + d.clipboard; },
  setInitialUrl() {}, log() { return []; }, capabilities() { return null; },
};
</script><button onclick="__pnShare({ message: 'hello', url: 'https://x.dev/a' })">Share</button></body></html>`;
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

const PHONE = { apps: [{ id: "shop", name: "Shop" }, { id: "notes", name: "Notes" }] };
const shareBtn = (r) => /Share[^\n]*\[ref=(\w+)\]/.exec(r.screen)[1];

test("app A shares, share_to delivers message and url to app B", async () => {
  const first = await call("/session", { session: "a", phone: PHONE });
  assert.ok((await act("a", { action: "tap", ref: shareBtn(first) })).ok);
  const r = await act("a", { action: "share_to", app_id: "notes" });
  assert.equal(r.ok, true, r.error); assert.equal(r.app, "notes");
  assert.match(r.screen, /Got hello \| https:\/\/x\.dev\/a/);
  const again = await act("a", { action: "share_to", app_id: "notes" });
  assert.equal(again.code, "no_share_sheet");   // delivered, so nothing is pending
  const log = (await act("a", { action: "device_log" })).log.filter((e) => e.name === "share_to");
  assert.deepEqual(log.map((e) => [e.app, e.source]), [["notes", "simulated"]]);
});

test("nothing pending: no_share_sheet; unknown app: no_such_app", async () => {
  const first = await call("/session", { session: "b", phone: PHONE });
  assert.equal((await act("b", { action: "share_to", app_id: "notes" })).code, "no_share_sheet");
  assert.ok((await act("b", { action: "tap", ref: shareBtn(first) })).ok);
  const r = await act("b", { action: "share_to", app_id: "ghost" });
  assert.equal(r.ok, false); assert.equal(r.code, "no_such_app");
  assert.equal((await act("b", { action: "share_to", app_id: "shop" })).ok, true);   // still pending after the failed call
});

test("copy fills the clipboard", async () => {
  const first = await call("/session", { session: "c", phone: PHONE });
  assert.ok((await act("c", { action: "tap", ref: shareBtn(first) })).ok);
  const r = await act("c", { action: "share_to", app_id: "copy" });
  assert.equal(r.ok, true, r.error); assert.match(r.screen, /Clip hello\s+https:\/\/x\.dev\/a/);
});
