// root_mount sessions: an app with a router that reads the address (expo-router) sees its own routes, not the /app/ prefix
// the simulator serves it under. Reloads and deep links of an app screen come back to the app.
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
const PORT = pickPort(13100, 150);   // own port range
const root = mkdtempSync(join(tmpdir(), "sim-rootmount-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc;

// A tiny app with a router: it shows the path it was started at, and a button that moves to /feed/1 as a router does.
const APP = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<h1 id="route"></h1><button onclick="history.pushState(null,'','/feed/1');show()">Open post</button>
<script>function show(){document.getElementById('route').textContent='route '+location.pathname}show()</script></body></html>`;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const urlOf = async (session) => (await call("/sessions", {})).sessions.find((s) => s.session === session).url;

function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not install Chromium for playwright");
}

before(async () => {
  ensureChromium();
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), APP);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/app/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("without root_mount the app sees the /app/ address, as before", async () => {
  const r = await call("/session", { session: "plain" });
  assert.ok(r.ok, r.error);
  assert.match(r.screen, /route \/app\//);
});

test("with root_mount the app starts at its own root route", async () => {
  const r = await call("/session", { session: "router", root_mount: true });
  assert.ok(r.ok, r.error);
  assert.match(r.screen, /route \/"?\s*\[|route \/$|heading "route \/"/m);
  assert.doesNotMatch(r.screen, /route \/app/);
  assert.equal(await urlOf("router"), `http://localhost:${PORT}/`);
});

test("a restart on a deep screen comes back to that screen of the app", async () => {
  assert.ok((await call("/session", { session: "deep", root_mount: true })).ok);
  const tree = (await act("deep", { action: "screen" })).screen;
  const tap = await act("deep", { action: "tap", ref: /button "Open post"[^\n]*\[ref=(\w+)\]/.exec(tree)[1] });
  assert.match(tap.screen, /route \/feed\/1/);
  const again = await act("deep", { action: "restart" });
  assert.ok(again.ok, again.error);
  assert.match(again.screen, /route \/feed\/1/);
  assert.equal(await urlOf("deep"), `http://localhost:${PORT}/feed/1`);
});

test("a page load of an unknown address goes to the app; other requests for it are still not found", async () => {
  const nav = await fetch(`http://localhost:${PORT}/feed/7?tab=new`, { redirect: "manual", headers: { "sec-fetch-dest": "document" } });
  assert.equal(nav.status, 302);
  assert.equal(nav.headers.get("location"), "/app/feed/7?tab=new");
  const data = await fetch(`http://localhost:${PORT}/feed/7`, { redirect: "manual" });
  assert.equal(data.status, 404);
});
