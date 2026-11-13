// read_share and receive_share against a real sim server and a page that stands in for the device layer.
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
const PORT = pickPort(9100, 300);
const root = mkdtempSync(join(tmpdir(), "sim-share-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1>
<script>
window.__pnDevice = {
  receiveShare(p) { document.getElementById("h").textContent = "Got " + (p.message ?? "") + " " + (p.url ?? ""); return !!p.url; },
  reset() {},
};
</script><button onclick="window.__pnShareRecorded({ message: 'hi', url: 'https://x.dev/a', sourceApp: 'App A', at: 1 })">Share</button></body></html>`;
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

const tapShare = async (id) => {
  const first = await call("/session", { session: id });
  const m = /Share[^\n]*\[ref=(\w+)\]/.exec(first.screen);
  assert.ok(m, first.screen);
  assert.ok((await act(id, { action: "tap", ref: m[1] })).ok);
};

test("read_share returns the app's share once, then null", async () => {
  await tapShare("a");
  const r = await act("a", { action: "read_share" });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.share, { message: "hi", url: "https://x.dev/a", sourceApp: "App A", at: 1 });
  assert.equal((await act("a", { action: "read_share" })).share, null);
});

test("read_share with clear:false keeps the share", async () => {
  await tapShare("b");
  assert.equal((await act("b", { action: "read_share", clear: false })).share.message, "hi");
  assert.equal((await act("b", { action: "read_share" })).share.message, "hi");
  assert.equal((await act("b", { action: "read_share" })).share, null);
});

test("the share survives an app switch", async () => {
  await tapShare("c");
  assert.ok((await act("c", { action: "press_home" })).ok);
  assert.equal((await act("c", { action: "read_share" })).share?.url, "https://x.dev/a");
});

test("receive_share reaches the app", async () => {
  assert.ok((await call("/session", { session: "d" })).ok);
  const r = await act("d", { action: "receive_share", message: "look", url: "https://x.dev/c" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.handled, true);
  assert.match((await act("d", { action: "screen" })).screen, /Got look https:\/\/x\.dev\/c/);
});

test("receive_share with neither message nor url, or a non-string, is a typed error", async () => {
  assert.ok((await call("/session", { session: "e" })).ok);
  for (const [body, code] of [[{}, "empty_share"], [{ message: "" }, "empty_share"], [{ url: 5 }, "bad_share"], [{ message: {} }, "bad_share"]]) {
    const r = await act("e", { action: "receive_share", ...body });
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
  }
});

test("device_reset clears the share", async () => {
  await tapShare("f");
  assert.ok((await act("f", { action: "device_reset" })).ok);
  assert.equal((await act("f", { action: "read_share" })).share, null);
});
