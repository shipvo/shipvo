// tap, type and scroll say delivered or not_delivered, with a reason when nothing reached the app.
import { pickPort } from "./test-port.mjs";
import test, { before, after } from "node:test";
import { pickPort } from "./test-port.mjs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(4300, 300);
const root = mkdtempSync(join(tmpdir(), "sim-refs-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;

// One page: a button, a disabled button, a hidden button, a button under an overlay, a text field and a button that re-renders.
const ONE = `<!doctype html><html><head><title>fx</title></head><body>
<button id="ok" onclick="document.getElementById('out').textContent='ok clicked'">Go</button>
<button id="dis" disabled>Off</button>
<button id="hid" style="position:fixed;left:-500px;top:10px">Tiny</button>
<button id="cov" style="position:absolute;top:300px;left:10px;width:100px;height:40px">Under</button>
<div style="position:absolute;top:290px;left:0;width:300px;height:60px;background:#fff" aria-hidden="true"></div>
<input aria-label="Name" id="name"><div id="out">none</div>
<button id="swap" onclick="document.getElementById('ok').remove()">Swap</button>
</body></html>`;
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


const NOT = (r, reason) => { assert.equal(r.ok, false); assert.equal(r.delivery, "not_delivered"); assert.equal(r.reason, reason); assert.equal(r.safe_to_retry, true); };

test("tap: delivered", async () => {
  const ref = refOf(await open("d0"), 'button "Go"');
  const r = await act("d0", { action: "tap", ref });
  assert.equal(r.ok, true); assert.equal(r.delivery, "delivered");
});
test("tap: not_delivered stale_ref", async () => {
  const s = await open("d1");
  const ref = refOf(s, 'button "Go"'); const swap = refOf(s, 'button "Swap"');
  assert.equal((await act("d1", { action: "tap", ref: swap })).delivery, "delivered");
  NOT(await act("d1", { action: "tap", ref }), "stale_ref");
});
test("tap: not_delivered disabled", async () => {
  const ref = refOf(await open("d2"), 'button "Off"');
  NOT(await act("d2", { action: "tap", ref }), "disabled");
});
test("tap: not_delivered covered", async () => {
  const ref = refOf(await open("d3"), 'button "Under"');
  NOT(await act("d3", { action: "tap", ref }), "covered");
});
test("tap: not_delivered not_visible", async () => {
  // In the tree, but parked outside the window.
  const s4 = await open("d4");
  const ref = refOf(s4, 'button "Tiny"');
  NOT(await act("d4", { action: "tap", ref }), "not_visible");
});
test("type: returns the value the field holds", async () => {
  const ref = refOf(await open("d5"), "textbox");
  const r = await act("d5", { action: "type", ref, text: "Ana" });
  assert.equal(r.delivery, "delivered"); assert.equal(r.value, "Ana");
});
test("scroll: a stale ref is not_delivered", async () => {
  NOT(await act("d5", { action: "scroll", direction: "down", ref: "p99e1" }), "stale_ref");
});
