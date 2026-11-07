// set_network_profile against a real sim server: offline rejects, mock rules still win, the change is logged.
import test, { before, after } from "node:test";
import { pickPort } from "./test-port.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(9300, 300);
const root = mkdtempSync(join(tmpdir(), "sim-prof-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc, backend, backendUrl;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Idle</h1>
<script>
window.go = async (path) => {
  try { const r = await fetch(window.BACKEND + path); const x = await r.text(); document.getElementById("h").textContent = "Got " + r.status + " " + x.slice(0, 20); }
  catch (e) { document.getElementById("h").textContent = "Failed " + e; }
};
</script>
<button onclick="go('/items')">Load items</button><button onclick="go('/other')">Load other</button><button onclick="go('/big')">Load big</button></body></html>`;
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
  backend = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }); res.end(req.url === "/big" ? "x".repeat(10000) : "real"); });
  await new Promise((r) => backend.listen(0, "127.0.0.1", r));
  backendUrl = `http://127.0.0.1:${backend.address().port}`;
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE.replace("</head>", `<script>window.BACKEND=${JSON.stringify(backendUrl)}</script></head>`));
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start within 90 s. stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); backend?.close(); rmSync(root, { recursive: true, force: true });
});

const ref = (screen, name) => { const m = new RegExp(`${name}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen); assert.ok(m, screen); return m[1]; };
async function press(session, name, tries = 40) {
  const s = (await act(session, { action: "screen" })).screen;
  await act(session, { action: "tap", ref: ref(s, name) });
  for (let i = 0; i < tries; i++) {
    const r = await act(session, { action: "screen" });
    if (/Got |Failed /.test(r.screen)) return /(?:Got|Failed)[^\n"]*/.exec(r.screen)[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("no result on the page: " + (await act(session, { action: "screen" })).screen);
}
const netLog = async (session) => (await act(session, { action: "device_log" })).log.filter((e) => e.name === "network_profile");

test("offline rejects fetches; back to online they succeed", async () => {
  assert.ok((await call("/session", { session: "a" })).ok);
  assert.match(await press("a", "Load items"), /Got 200 real/, "default is online");
  assert.equal((await act("a", { action: "set_network_profile", profile: "offline" })).ok, true);
  assert.match(await press("a", "Load items"), /Failed/);
  assert.equal((await act("a", { action: "set_network_profile", profile: "online" })).ok, true);
  assert.match(await press("a", "Load items"), /Got 200 real/);
});

test("changing the profile adds one device_log entry marked simulated", async () => {
  assert.ok((await call("/session", { session: "b" })).ok);
  assert.equal((await netLog("b")).length, 0);
  await act("b", { action: "set_network_profile", profile: "3g" });
  const log = await netLog("b");
  assert.equal(log.length, 1);
  assert.equal(log[0].source, "simulated");
  assert.equal(log[0].profile, "3g");
});

test("a mockNetwork rule still answers under offline", async () => {
  assert.ok((await call("/session", { session: "c" })).ok);
  await act("c", { action: "set_network_mocks", rules: [{ url: `${backendUrl}/items`, response: { status: 200, body: "mocked" } }] });
  await act("c", { action: "set_network_profile", profile: "offline" });
  assert.match(await press("c", "Load items"), /Got 200 mocked/);
  assert.match(await press("c", "Load other"), /Failed/);
});

test("a bad profile name answers unknown_profile and changes nothing", async () => {
  assert.ok((await call("/session", { session: "d" })).ok);
  const r = await act("d", { action: "set_network_profile", profile: "5g" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "unknown_profile");
  assert.equal((await netLog("d")).length, 0);
});

test("2g applies the bandwidth limit to the response and still returns the real body", async () => {
  assert.ok((await call("/session", { session: "e" })).ok);
  await act("e", { action: "set_network_profile", profile: "2g" });
  // 10,000 bytes at 50 kbps is 1,600 ms of transfer on top of 800 ms latency. Latency alone is 800 ms.
  const t0 = Date.now();
  assert.match(await press("e", "Load big", 100), /Got 200 x{20}/);
  assert.ok(Date.now() - t0 >= 2000, `took ${Date.now() - t0} ms`);
  await act("e", { action: "set_network_profile", profile: "online" });
  assert.match(await press("e", "Load items"), /Got 200 real/);
  await act("e", { action: "set_network_profile", profile: "2g" });
  assert.match(await press("e", "Load items"), /Got 200 real/);
});
