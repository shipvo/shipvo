// Every tap, type, scroll and back says delivered or not_delivered (with a reason), and can wait for an expected result.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 5000 + Math.floor(Math.random() * 300);
const root = mkdtempSync(join(tmpdir(), "sim-delivery-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;

const ONE = `<!doctype html><html><head><title>fx</title></head><body>
<button id="ok" onclick="document.getElementById('out').textContent='ok clicked'">Go</button>
<button disabled>Locked</button>
<button aria-disabled="true">Soft locked</button>
<button onclick="document.getElementById('ok').textContent='Went'">Swap</button>
<button id="under" style="position:relative">Under cover</button>
<div style="position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,.1)" id="shield" hidden></div>
<button onclick="document.getElementById('shield').hidden=false">Cover it</button>
<input aria-label="Name" />
<button onclick="setTimeout(()=>{document.getElementById('out').textContent='Later'},700)">Slow</button>
<button onclick="let n=0;const t=setInterval(()=>{document.getElementById('out').textContent='tick '+(++n);if(n>5)clearInterval(t)},150)">Tick</button>
<div id="out">none</div></body></html>`;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const refOf = (screen, label) => { const m = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen); assert.ok(m, `no ref for ${label} in\n${screen}`); return m[1]; };
const open = async (id) => { const r = await call("/session", { session: id }); assert.ok(r.ok, r.error); return r.screen; };

// The `test` CI job does not install a browser, so fetch Chromium when it is missing.
function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not install Chromium for playwright");
}

before(async () => {
  ensureChromium();
  const { mkdirSync } = await import("node:fs"); mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), ONE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  // A loaded CI runner can take a while to start Chromium, so wait up to 90 s and fail loudly instead of falling through.
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});


test("tap: delivered, with safe_to_retry false", async () => {
  const s = await open("d1");
  const r = await act("d1", { action: "tap", ref: refOf(s, 'button "Go"') });
  assert.equal(r.delivery, "delivered"); assert.equal(r.safe_to_retry, false);
  assert.match(r.screen, /ok clicked/);
});
test("stale_ref: not delivered, safe to retry", async () => {
  const s = await open("d2");
  const ref = refOf(s, 'button "Go"');
  await act("d2", { action: "tap", ref: refOf(s, 'button "Swap"') });   // the button's text changes: its old ref is stale
  const r = await act("d2", { action: "tap", ref });
  assert.deepEqual([r.delivery, r.reason, r.safe_to_retry, r.code], ["not_delivered", "stale_ref", true, "stale_ref"]);
});
test("disabled: not delivered, safe to retry", async () => {
  const s = await open("d3");
  const r = await act("d3", { action: "tap", ref: refOf(s, 'button "Locked"') });
  assert.deepEqual([r.ok, r.delivery, r.reason, r.safe_to_retry], [false, "not_delivered", "disabled", true]);
});
test("not_visible: a back with no Back button", async () => {
  await open("d4");
  const b = await act("d4", { action: "back" });
  assert.deepEqual([b.delivery, b.reason, b.safe_to_retry], ["not_delivered", "not_visible", true]);
});
test("covered: another element sits on top", async () => {
  const s = await open("d5");
  const go = refOf(s, 'button "Go"');
  const cover = await act("d5", { action: "tap", ref: refOf(s, 'button "Cover it"') });
  assert.equal(cover.delivery, "delivered");
  const r = await act("d5", { action: "tap", ref: go });
  assert.deepEqual([r.delivery, r.reason, r.safe_to_retry], ["not_delivered", "covered", true]);
});
test("type: reads the field back", async () => {
  const s = await open("d6");
  const r = await act("d6", { action: "type", ref: refOf(s, 'textbox "Name"'), text: "Ana" });
  assert.equal(r.delivery, "delivered"); assert.equal(r.value, "Ana");
});
test("wait_for: a text that appears is matched and timed", async () => {
  const s = await open("d7");
  const r = await act("d7", { action: "tap", ref: refOf(s, 'button "Slow"'), wait_for: { text: "Later", timeout_ms: 5000 } });
  assert.equal(r.delivery, "delivered"); assert.equal(r.wait_for.matched, true);
  assert.ok(r.wait_for.waited_ms >= 500 && r.wait_for.waited_ms < 4000, String(r.wait_for.waited_ms));
});
test("wait_for: a text that never appears times out, and the tap still counts as delivered", async () => {
  const s = await open("d8");
  const r = await act("d8", { action: "tap", ref: refOf(s, 'button "Go"'), wait_for: { text: "Never shown", timeout_ms: 600 } });
  assert.equal(r.delivery, "delivered"); assert.equal(r.wait_for.matched, false);
  assert.ok(r.wait_for.waited_ms >= 600);
});
test("wait_for: gone, and role + name", async () => {
  const s = await open("d9");
  const r = await act("d9", { action: "tap", ref: refOf(s, 'button "Go"'), wait_for: { text: "Never shown", gone: true } });
  assert.equal(r.wait_for.matched, true);
  const q = await act("d9", { action: "tap", ref: refOf(s, 'button "Go"'), wait_for: { role: "button", name: "Locked" } });
  assert.equal(q.wait_for.matched, true);
});
test("settle: returns after the screen stops changing", async () => {
  const s = await open("d10");
  const r = await act("d10", { action: "tap", ref: refOf(s, 'button "Tick"'), settle: true });
  assert.equal(r.settled, true); assert.match(r.screen, /tick 6/);
});
