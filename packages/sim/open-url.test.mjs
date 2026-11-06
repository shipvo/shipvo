// open_url against a real sim server and a page that stands in for the device layer:
// `__pnDevice.openUrl` returns true only when the page has a listener.
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
const PORT = pickPort(5700, 300);
const root = mkdtempSync(join(tmpdir(), "sim-url-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1>
<script>
let listening = false;
window.__pnDevice = { openUrl(u) { if (!listening) return false; document.getElementById("h").textContent = "Opened " + u; return true; } };
</script><button onclick="listening = true">Start listening</button></body></html>`;
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
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  // A loaded CI runner can take a while to start Chromium, so wait up to 90 s and fail loudly instead of falling through.
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s. Server stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("no listener: no_url_listener, and the page did not change", async () => {
  assert.ok((await call("/session", { session: "a" })).ok);
  const r = await act("a", { action: "open_url", url: "myapp://item/3" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "no_url_listener");
  assert.doesNotMatch(r.screen, /Opened/);
});

test("with a listener: ok, and the app saw the URL", async () => {
  const first = await call("/session", { session: "b" });
  const m = /Start listening[^\n]*\[ref=(\w+)\]/.exec(first.screen);
  assert.ok(m, first.screen);
  assert.ok((await act("b", { action: "tap", ref: m[1] })).ok);
  const r = await act("b", { action: "open_url", url: "myapp://item/3" });
  assert.equal(r.ok, true, r.error);
  assert.match(r.screen, /Opened myapp:\/\/item\/3/);
});

const PHONE = { apps: [{ id: "shop", name: "Shop", schemes: ["myapp", "tel:"] }, { id: "notes", name: "Notes" }] };
test("resolves a declared scheme to its app, and gives typed errors", async () => {
  assert.ok((await call("/session", { session: "d", phone: PHONE })).ok);
  for (const [url, app] of [["myapp://item/42", "shop"], ["MYAPP:item/3", "shop"], ["tel:+15550100", "shop"]]) {
    const r = await act("d", { action: "open_url", url });
    assert.equal(r.ok, true, r.error); assert.equal(r.app, app);
  }
  const none = await act("d", { action: "open_url", url: "other://x" });
  assert.equal(none.ok, false); assert.equal(none.code, "no_handler");
  const bad = await act("d", { action: "open_url", url: "item/42" });
  assert.equal(bad.ok, false); assert.equal(bad.code, "invalid_url");
});

test("act for an unknown session: no_session", async () => {
  const r = await act("nobody", { action: "screen" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "no_session");
  assert.match(r.error, /no session 'nobody'/);
});

test("empty or missing url: bad_url", async () => {
  assert.ok((await call("/session", { session: "c" })).ok);
  for (const body of [{ action: "open_url" }, { action: "open_url", url: "" }, { action: "open_url", url: 5 }]) {
    const r = await act("c", body);
    assert.equal(r.ok, false);
    assert.equal(r.code, "bad_url");
  }
});

test("answers GET / without waiting for Chromium, and exits with a message if Chromium cannot start", async () => {
  const port = PORT + 400;
  const p = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(port), "--dir", join(root, "bad"), "--dist", dist, "--chromium", join(root, "no-such-chromium")], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; p.stderr.on("data", (d) => { err += d; });
  const exited = new Promise((r) => p.once("exit", (code) => r(code)));
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 30_000))]);
  if (code === "timeout") p.kill("SIGKILL");
  assert.equal(code, 1, err);
  assert.match(err, /could not launch Chromium/);
});

test("listens before Chromium has started", async () => {
  const port = PORT + 500;
  // A launcher that never finishes: the port must still open.
  const hang = join(root, "hang.sh"); writeFileSync(hang, "#!/bin/sh\nexec sleep 60\n", { mode: 0o755 });
  const p = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(port), "--dir", join(root, "slow"), "--dist", dist, "--chromium", hang], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { await fetch(`http://localhost:${port}/`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(up, "GET / should be answered while Chromium is still starting");
  } finally { p.kill("SIGKILL"); p.stderr.destroy(); }
});
