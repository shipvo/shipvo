// Live: install_app fetches the app's published bundle, keeps its sha256 and size, and logs source "real".
// A stub control plane serves /w/<app>/releases.json and the release page. Fixture installs stay "simulated".
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(11450, 150), CP_PORT = pickPort(11600, 150);
const root = mkdtempSync(join(tmpdir(), "sim-install-real-"));
const dist = join(root, "dist"), dir = join(root, "state");
const BUNDLE = "<!doctype html><html><head><title>Notes</title></head><body><h1>Pocket Notes r4</h1></body></html>";
let proc, cp, hits = 0, gone = false;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  cp = http.createServer((req, res) => {
    if (req.url.startsWith("/w/")) hits++;
    if (gone) { res.writeHead(404); return res.end("gone"); }
    if (req.url === "/w/notes/releases.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ latest: 4 })); }
    if (req.url === "/w/notes/r4/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(BUNDLE); }
    res.writeHead(404); res.end("no");
  });
  await new Promise((r) => cp.listen(CP_PORT, "127.0.0.1", r));
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { env: { ...process.env, PN_CONTROL: `http://localhost:${CP_PORT}` }, stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); cp?.close(); rmSync(root, { recursive: true, force: true });
});

test("installing a marketplace app fetches its bundle and logs a real install with the sha256", async () => {
  assert.ok((await call("/session", { session: "r1" })).ok);
  const catalog = [{ id: "notes", name: "Pocket Notes", url: "app://notes@r4", version: "r4" }];
  const r = await act("r1", { action: "install_app", id: "notes", catalog });
  assert.equal(r.ok, true, JSON.stringify(r));
  const want = createHash("sha256").update(BUNDLE).digest("hex");
  assert.equal(r.installed_apps.find((a) => a.id === "notes").sha256, want);
  const log = (await act("r1", { action: "device_log" })).log.filter((e) => e.name === "install_app");
  assert.equal(log.length, 1);
  assert.equal(log[0].source, "real");
  assert.equal(log[0].sha256, want);
  assert.equal(log[0].bytes, Buffer.byteLength(BUNDLE));
});

test("an app whose bundle cannot be fetched is not installed", async () => {
  assert.ok((await call("/session", { session: "r2" })).ok);
  const r = await act("r2", { action: "install_app", id: "ghost", catalog: [{ id: "ghost", name: "Ghost", url: "app://ghost@r1", version: "r1" }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "store_app_unreachable");
  const apps = await act("r2", { action: "switch_app", id: "ghost" });
  assert.equal(apps.code, "not_installed");
});

test("a fixture install stays simulated", async () => {
  assert.ok((await call("/session", { session: "r3" })).ok);
  const r = await act("r3", { action: "install_app", id: "weather" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = (await act("r3", { action: "device_log" })).log.find((x) => x.name === "install_app");
  assert.equal(e.source, "simulated");
});


test("installing an app twice says already_installed without fetching the bundle again", async () => {
  assert.ok((await call("/session", { session: "r5" })).ok);
  const catalog = [{ id: "notes", name: "Pocket Notes", url: "app://notes@r4", version: "r4" }];
  assert.equal((await act("r5", { action: "install_app", id: "notes", catalog })).ok, true);
  hits = 0; gone = true;   // the bundle is no longer served
  const r = await act("r5", { action: "install_app", id: "notes", catalog });
  gone = false;
  assert.equal(r.ok, false);
  assert.equal(r.code, "already_installed");
  assert.equal(hits, 0);
});
