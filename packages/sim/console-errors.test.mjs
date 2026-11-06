// The `console_errors` action returns console.error output once, then clears it. Failed resource loads are left out.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const ONE = `<!doctype html><html><body><button onclick="console.error('boom '+1)">Log</button><img src="/missing.png" alt="gone"></body></html>`;
const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(4900, 300);
const root = mkdtempSync(join(tmpdir(), "sim-sizes-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
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

test("console_errors returns console.error output, then clears it", async () => {
  const screen = await open("ce");
  const ref = screen.match(/button "Log" \[ref=(\w+)\]/)[1];
  await act("ce", { action: "tap", ref });
  const first = await act("ce", { action: "console_errors" });
  assert.ok(first.ok, first.error);
  assert.deepEqual(first.errors, ["boom 1"]);
  const second = await act("ce", { action: "console_errors" });
  assert.deepEqual(second.errors, []);
});

test("console_errors leaves out failed resource loads such as a 404 image", async () => {
  await open("ce404");
  await new Promise((r) => setTimeout(r, 500));
  const r = await act("ce404", { action: "console_errors" });
  assert.deepEqual(r.errors, []);
});
