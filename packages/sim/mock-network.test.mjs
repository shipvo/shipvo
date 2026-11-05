// mock_network against a real sim server and a page that fetches from a local HTTP server.
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
const PORT = 5300 + Math.floor(Math.random() * 300);
const root = mkdtempSync(join(tmpdir(), "sim-mock-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc, api, apiUrl;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Idle</h1>
<script>
window.go = async () => {
  const t = Date.now();
  try { const r = await fetch(window.__api + "/items"); const b = await r.text(); document.getElementById("h").textContent = "Got " + r.status + " " + b + " in " + (Date.now() - t); }
  catch (e) { document.getElementById("h").textContent = "Failed " + e; }
};
window.post = async () => {
  try { const r = await fetch(window.__api + "/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) }); document.getElementById("h").textContent = "Got " + r.status + " " + await r.text(); }
  catch (e) { document.getElementById("h").textContent = "Failed " + e; }
};
</script><button onclick="go()">Load</button><button onclick="post()">Save</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const tapLoad = async (s, label = "Load") => {
  const first = await act(s, { action: "screen" });
  const m = new RegExp(label + "[^\\n]*\\[ref=(\\w+)\\]").exec(first.screen); assert.ok(m, first.screen);
  await act(s, { action: "tap", ref: m[1] });
  for (let i = 0; i < 40; i++) { const r = await act(s, { action: "screen" }); if (/Got|Failed/.test(r.screen)) return r.screen; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("page never finished");
};
function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  api = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }); res.end("real"); });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), PAGE.replace("<script>", `<script>window.__api = ${JSON.stringify(apiUrl)};`));
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start on port ${PORT}. stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); api?.close(); rmSync(root, { recursive: true, force: true });
});

test("unmatched requests pass through; a matching rule returns the mocked 500; clear restores", async () => {
  assert.ok((await call("/session", { session: "m" })).ok);
  assert.match(await tapLoad("m"), /Got 200 real/);
  let r = await act("m", { action: "mock_network", rules: [{ url: { regex: "/items$" }, method: "get", response: { status: 500, body: { error: "boom" } } }, { url: "http://nowhere.invalid/x", response: { status: 200 } }] });
  assert.equal(r.ok, true, r.error);
  assert.match(await tapLoad("m"), /Got 500 \{\\?"error\\?":\\?"boom\\?"\}/);
  r = await act("m", { action: "mock_network", rules: [{ url: `${apiUrl}/items`, method: "POST", response: { status: 500 } }] });
  assert.match(await tapLoad("m"), /Got 200 real/, "a different method is not matched");
  assert.ok((await act("m", { action: "clear_network_mocks" })).ok);
  assert.match(await tapLoad("m"), /Got 200 real/);
});

test("a mocked cross-origin JSON POST gets past the CORS preflight", async () => {
  assert.ok((await call("/session", { session: "p" })).ok);
  const r = await act("p", { action: "mock_network", rules: [{ url: `${apiUrl}/items`, method: "POST", response: { status: 500, body: { error: "boom" } } }] });
  assert.equal(r.ok, true, r.error);
  assert.match(await tapLoad("p", "Save"), /Got 500 /);
});

test("delayMs delays the response", async () => {
  assert.ok((await call("/session", { session: "d" })).ok);
  await act("d", { action: "mock_network", rules: [{ url: `${apiUrl}/items`, response: { status: 200, body: "slow", delayMs: 1200 } }] });
  const screen = await tapLoad("d");
  const m = /Got 200 slow in (\d+)/.exec(screen); assert.ok(m, screen);
  assert.ok(Number(m[1]) >= 1100, `took ${m[1]} ms`);
});

test("a bad rule is mock_invalid", async () => {
  assert.ok((await call("/session", { session: "i" })).ok);
  for (const rules of [null, [{ response: { status: 200 } }], [{ url: "http://a", response: { status: 7 } }], [{ url: { regex: "(" }, response: { status: 200 } }]]) {
    const r = await act("i", { action: "mock_network", rules });
    assert.equal(r.ok, false);
    assert.equal(r.code, "mock_invalid");
  }
});
