// Live: POST /session with build_url opens an uploaded build, for an Android and an iOS session.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(10400, 300);
const root = mkdtempSync(join(tmpdir(), "sim-build-url-"));
let proc, host, hostPort, closedPort;
const page = (t) => `<!doctype html><html><head><title>b</title></head><body><h1>${t}</h1><script src="app.js"></script></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const url = (id) => `http://127.0.0.1:${hostPort}/files/${id}/`;

before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  host = http.createServer((req, res) => {
    if (req.url === "/files/mine/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page("My uploaded build")); }
    if (req.url === "/files/mine/app.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end("document.title='loaded'"); }
    if (req.url === "/files/big/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page("x".repeat(5000))); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => host.listen(0, "127.0.0.1", r)); hostPort = host.address().port;
  const tmp = http.createServer(); await new Promise((r) => tmp.listen(0, "127.0.0.1", r)); closedPort = tmp.address().port; tmp.close();
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", join(root, "none"), "--build-hosts", "127.0.0.1"], { stdio: ["ignore", "ignore", "pipe"], cwd: here, env: { ...process.env, PN_BUILD_MAX_BYTES: "2000" } });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start within 90 s. ${err}`);
});
after(async () => {
  host?.close();
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});
const listed = async () => (await call("/sessions", {})).sessions.map((s) => s.session);

for (const skin of ["android", "ios"]) {
  test(`build_url opens the uploaded build on an ${skin} session and the reply has build`, async () => {
    const r = await call("/session", { session: `ok-${skin}`, app: "myapp", skin, build_url: url("mine") });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.build, "mine");
    assert.equal(r.app, "myapp");
    assert.match(r.screen, /My uploaded build/);
    assert.ok((await listed()).includes(`ok-${skin}`));
  });
}

test("a session without build_url has no build in the reply", async () => {
  const r = await call("/session", { session: "plain", phone: { apps: [] } });
  if (r.ok) assert.equal(r.build, undefined);
});

for (const [name, u, code] of [
  ["an unreachable build_url", `http://127.0.0.1:${0}/files/mine/`, "build_unreachable"],
  ["a missing build", null, "build_unreachable"],
  ["an oversize build", null, "build_too_large"],
  ["a host that is not allowed", "http://example.com/files/mine/", "build_url_not_allowed"],
  ["a malformed build_url", "not a url", "bad_build_url"],
]) {
  test(`${name} returns a typed error and leaves no session`, async () => {
    const bu = name.startsWith("an unreachable") ? `http://127.0.0.1:${closedPort}/files/mine/` : name.startsWith("a missing") ? url("gone") : name.startsWith("an oversize") ? url("big") : u;
    const sid = `bad-${code}-${name.length}`;
    const r = await call("/session", { session: sid, app: "myapp", build_url: bu });
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
    assert.ok(!(await listed()).includes(sid));
  });
}
