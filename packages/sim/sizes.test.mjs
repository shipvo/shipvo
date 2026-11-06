// The `sizes` action returns the rendered size of each ref on the screen, keyed by the same ref the tree shows.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { refOf } from "./ref-stability.cases.mjs";

const ONE = `<!doctype html><html><body><button style="width:20px;height:20px;padding:0">Tiny</button><button style="width:60px;height:60px;padding:0">Big</button><a href="two.html">Go two</a><button onclick="location.reload()">Reload</button></body></html>`;
const TWO = `<!doctype html><html><body><button style="width:30px;height:40px;padding:0">Small</button></body></html>`;

const here = dirname(fileURLToPath(import.meta.url));
// Own port range: another test file used 4900-5199 and a clash made this test talk to the wrong server.
const PORT = pickPort(6500, 300);
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
  writeFileSync(join(dist, "index.html"), ONE); writeFileSync(join(dist, "two.html"), TWO);
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

test("sizes returns the rendered width and height for each ref", async () => {
  const screen = await open("sizes");
  const r = await act("sizes", { action: "sizes" });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.sizes[refOf(screen, 'button "Tiny"')], [20, 20]);
  assert.deepEqual(r.sizes[refOf(screen, 'button "Big"')], [60, 60]);
});

test("sizes keys equal the refs in the tree after a page load", async () => {
  await open("sizes-nav");
  const first = await act("sizes-nav", { action: "screen" });
  await act("sizes-nav", { action: "tap", ref: refOf(first.screen, 'button "Reload"') });
  const second = await act("sizes-nav", { action: "screen" });
  const ref = refOf(second.screen, 'button "Tiny"');
  const r = await act("sizes-nav", { action: "sizes" });
  assert.deepEqual(r.sizes[ref], [20, 20]);
});

test("sizes keys equal the refs after navigating to another page", async () => {
  await open("sizes-two");
  const first = await act("sizes-two", { action: "screen" });
  await act("sizes-two", { action: "tap", ref: refOf(first.screen, 'link "Go two"') });
  const second = await act("sizes-two", { action: "screen" });
  const r = await act("sizes-two", { action: "sizes" });
  assert.deepEqual(r.sizes[refOf(second.screen, 'button "Small"')], [30, 40]);
});
