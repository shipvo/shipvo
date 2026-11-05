// The Browser app through a real sim server: browser_* actions on /act, BrowserError -> SimError codes,
// and /end closing the phone's Chromium contexts.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(5300, 300);
const root = mkdtempSync(join(tmpdir(), "sim-browser-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc, web, base; let held = 0;
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
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>app</title><h1>Home</h1>");
  // A website. /hold keeps a request open, so the server can see when the page that made it is gone.
  web = http.createServer((req, res) => {
    if (req.url === "/hold") { held++; res.writeHead(200, { "content-type": "text/plain" }); res.write("."); res.on("close", () => { held--; }); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>Site</title><h1>Hello web</h1><script>fetch("/hold")</script>`);
  });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${web.address().port}`;
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s. Server stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); web?.close(); rmSync(root, { recursive: true, force: true });
});
const until = async (f) => { for (let i = 0; i < 50 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };

test("browser_open returns a tree marked source web; screenshot carries the PNG in web.data", async () => {
  assert.ok((await call("/session", { session: "w1", allow_private: true })).ok);
  const r = await act("w1", { action: "browser_open", url: `${base}/` });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.web.source, "web");
  assert.match(r.screen, /Hello web/);
  const s = await act("w1", { action: "browser_screenshot" });
  assert.equal(s.ok, true, s.error);
  assert.equal(Buffer.from(s.web.data, "base64").subarray(1, 4).toString(), "PNG");
  assert.match(s.screen, /base64 chars/);
});

test("a BrowserError becomes a typed error code", async () => {
  assert.ok((await call("/session", { session: "w2", allow_private: true })).ok);
  assert.equal((await act("w2", { action: "browser_snapshot" })).code, "no_tab");
  assert.equal((await act("w2", { action: "browser_open", url: "not a url" })).code, "bad_url");
  const nope = await call("/session", { session: "w3", allow_hosts: ["example.com"] });
  assert.ok(nope.ok);
  const r = await act("w3", { action: "browser_open", url: `${base}/` });
  assert.equal(r.ok, false);
  assert.equal(r.code, "host_not_allowed");
});

test("/end closes the Browser app's context and forgets the session", async () => {
  assert.ok((await call("/session", { session: "w4", allow_private: true })).ok);
  assert.ok((await act("w4", { action: "browser_open", url: `${base}/` })).ok);
  await until(() => held > 0);
  assert.ok(held > 0, "the page should hold a request open");
  const before = held;
  assert.deepEqual(await call("/end", { session: "w4" }), { ok: true, ended: true });
  await until(() => held < before);
  assert.ok(held < before, "closing the session should close the web page");
  assert.equal((await act("w4", { action: "screen" })).code, "no_session");
  assert.deepEqual(await call("/end", { session: "w4" }), { ok: true, ended: false });
});

test("restarting a session id closes its old Browser app", async () => {
  assert.ok((await call("/session", { session: "w5", allow_private: true })).ok);
  assert.ok((await act("w5", { action: "browser_open", url: `${base}/` })).ok);
  await until(() => held > 0);
  const before = held;
  assert.ok((await call("/session", { session: "w5", allow_private: true })).ok);
  await until(() => held < before);
  assert.ok(held < before);
});
