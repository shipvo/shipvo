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

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4900 + Math.floor(Math.random() * 300);
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
  for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
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

test("empty or missing url: bad_url", async () => {
  assert.ok((await call("/session", { session: "c" })).ok);
  for (const body of [{ action: "open_url" }, { action: "open_url", url: "" }, { action: "open_url", url: 5 }]) {
    const r = await act("c", body);
    assert.equal(r.ok, false);
    assert.equal(r.code, "bad_url");
  }
});
