// set_network_mocks against a real sim server and a tiny local HTTP backend the page calls with fetch.
import { pickPort } from "./test-port.mjs";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(7900, 300);
const root = mkdtempSync(join(tmpdir(), "sim-mock-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc, backend, backendUrl;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Idle</h1>
<script>
window.go = async (path, init) => {
  const t = Date.now();
  try { const r = await fetch(window.BACKEND + path, init); const x = await r.text(); document.getElementById("h").textContent = "Got " + r.status + " " + x + " in " + (Date.now() - t); }
  catch (e) { document.getElementById("h").textContent = "Failed " + e; }
};
</script>
<button onclick="go('/items')">Load items</button><button onclick="go('/other')">Load other</button><button onclick="go('/items', { method: 'POST' })">Post items</button></body></html>`;
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
  backend = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }); res.end("real"); });
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
// Tap a button, then wait until the heading shows a result.
async function press(session, name) {
  const s = (await act(session, { action: "screen" })).screen;
  await act(session, { action: "tap", ref: ref(s, name) });
  for (let i = 0; i < 40; i++) {
    const r = await act(session, { action: "screen" });
    if (/Got |Failed /.test(r.screen)) return /(?:Got|Failed)[^\n"]*/.exec(r.screen)[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail("no result on the page");
}

test("a rule makes fetch return the stubbed status and body; unmatched requests pass through; clear restores", async () => {
  assert.ok((await call("/session", { session: "m" })).ok);
  const set = await act("m", { action: "set_network_mocks", rules: [{ url: `${backendUrl}/items`, method: "GET", response: { status: 503, body: "stubbed", headers: {} } }] });
  assert.equal(set.ok, true, set.error);
  assert.match(await press("m", "Load items"), /Got 503 stubbed/);
  assert.match(await press("m", "Load other"), /Got 200 real/, "unmatched URL is not changed");
  assert.match(await press("m", "Post items"), /Got 200 real/, "unmatched method is not changed");
  assert.equal((await act("m", { action: "set_network_mocks", rules: [] })).ok, true);
  assert.match(await press("m", "Load items"), /Got 200 real/);
});

test("a regex rule works, and delayMs delays the response", async () => {
  assert.ok((await call("/session", { session: "d" })).ok);
  const rules = [{ urlRegex: { source: "/ite.s$", flags: "i" }, response: { status: 201, body: "slow", delayMs: 700 } }];
  assert.equal((await act("d", { action: "set_network_mocks", rules })).ok, true);
  const out = await press("d", "Load items");
  assert.match(out, /Got 201 slow/);
  assert.ok(Number(/in (\d+)/.exec(out)[1]) >= 650, out);
});

test("a bad rule answers mock_invalid and keeps the old rules", async () => {
  assert.ok((await call("/session", { session: "e" })).ok);
  for (const rules of [[{ url: "", response: { status: 200, body: "" } }], [{ url: "/x", response: { status: 99, body: "" } }], [{ url: "/x", response: { status: 200 } }], "nope"]) {
    const r = await act("e", { action: "set_network_mocks", rules });
    assert.equal(r.ok, false);
    assert.equal(r.code, "mock_invalid");
  }
});
