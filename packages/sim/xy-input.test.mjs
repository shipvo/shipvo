// tap_xy and type_keys: coordinate input for the screenshots-only side of scripts/agent-efficiency.
import { pickPort } from "./test-port.mjs";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(9100, 300);
const root = mkdtempSync(join(tmpdir(), "sim-xy-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;

const ONE = `<!doctype html><html><head><title>fx</title></head><body style="margin:0">
<button id="ok" style="position:absolute;left:20px;top:100px;width:120px;height:50px" onclick="document.getElementById('out').textContent='ok clicked';document.getElementById('name').focus()">Go</button>
<input aria-label="Name" id="name" style="position:absolute;left:20px;top:200px"><div id="out" style="position:absolute;top:300px">none</div>
</body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

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



test("tap_xy clicks where the screenshot shows the button, and type_keys types into the focused field", async () => {
  assert.ok((await call("/session", { session: "x1" })).ok);
  const t = await act("x1", { action: "tap_xy", x: 60, y: 125 });
  assert.equal(t.ok, true); assert.equal(t.delivery, undefined);
  const k = await act("x1", { action: "type_keys", text: "Bonapriso" });
  assert.equal(k.ok, true);
  assert.match(k.screen, /ok clicked/);
  assert.match(k.screen, /Bonapriso/);
});
test("tap_xy refuses a missing coordinate", async () => {
  await call("/session", { session: "x2" });
  const r = await act("x2", { action: "tap_xy", x: "a" });
  assert.equal(r.ok, false); assert.match(r.error, /x and y/);
});
