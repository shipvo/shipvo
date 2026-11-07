// GET / on the sim redirects to the app page at /app/.
import { pickPort } from "./test-port.mjs";
import test, { before, after } from "node:test";
import { pickPort } from "./test-port.mjs";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(8900, 300);
const root = mkdtempSync(join(tmpdir(), "sim-root-"));
const dist = join(root, "dist");
let proc;
function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>x</title>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", dist], { stdio: "ignore", cwd: here });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/app/`); up = true; } catch { if (proc.exitCode !== null) throw new Error("sim exited"); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error("sim did not start");
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  rmSync(root, { recursive: true, force: true });
});

test("GET / redirects to /app/", async () => {
  const r = await fetch(`http://localhost:${PORT}/`, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/app/");
});

test("following the redirect returns the app page", async () => {
  const r = await fetch(`http://localhost:${PORT}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>/);
});
