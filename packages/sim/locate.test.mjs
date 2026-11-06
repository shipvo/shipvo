// locate: centre and size of an element as 0..1 of the viewport, against the real sim server.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4900 + Math.floor(Math.random() * 300);
const root = mkdtempSync(join(tmpdir(), "sim-locate-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
// Viewport is 393x851. The button is 100x50 with its top-left at (100, 200): centre (150, 225).
const PAGE = `<!doctype html><html><head><title>fx</title></head><body style="margin:0">
<button style="position:absolute;left:100px;top:200px;width:100px;height:50px">Go</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start within 90 s: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("locate: known element gives centre and size", async () => {
  const s = await call("/session", { session: "l1" }); assert.ok(s.ok, s.error);
  const ref = /button "Go"[^\n]*\[ref=(\w+)\]/.exec(s.screen)?.[1]; assert.ok(ref, s.screen);
  const r = await call("/act", { session: "l1", action: "locate", ref });
  assert.equal(r.ok, true);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
  near(r.locate.x, 150 / 393); near(r.locate.y, 225 / 851); near(r.locate.w, 100 / 393); near(r.locate.h, 50 / 851);
});
test("locate: unknown element is a typed not_found and nothing is clicked", async () => {
  await call("/session", { session: "l2" });
  const r = await call("/act", { session: "l2", action: "locate", ref: "e999" });
  assert.equal(r.ok, false); assert.equal(r.code, "not_found"); assert.equal(r.locate, undefined);
});
