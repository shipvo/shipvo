// open_url launch: switches to the owning app and hands it a one-shot initial URL.
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
const PORT = pickPort(9400, 300);
const root = mkdtempSync(join(tmpdir(), "sim-url-launch-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1><p id="i">initial: null</p><button id="go" onclick="linkOut('appb://item/9')">Open B</button>
<script>
let initial = null;
window.__pnDevice = {
  setInitialUrl(u) { initial = u ?? null; document.getElementById("i").textContent = "initial: " + initial; },
  getInitialURL() { return initial; },
  openUrl(u) { document.getElementById("h").textContent = "Opened " + u; return true; },
};
// A hand-written stand-in for Linking.openURL: ask the simulator whether another app owns the link.
// The @shipvo/device side of this call is covered by packages/device/test/sim-device.test.mjs.
window.linkOut = async (u) => { if (!(await window.__pnOpenLink(u))) document.getElementById("h").textContent = "Local " + u; };
</script></body></html>`;
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

const initial = async (s) => { const m = /initial: ([^\s"]+)/.exec((await act(s, { action: "screen" })).screen); return m[1] === "null" ? null : m[1]; };
const PHONE = {
  current_app: "a",
  apps: [{ id: "a", name: "A", schemes: ["appa"] }, { id: "b", name: "B", schemes: ["appb"] }, { id: "c", name: "C", schemes: ["appc"] }, { id: "d", name: "D" }],
};

// Both skins run the same server path; the loop shows the behaviour holds for
// each skin label, not that any skin-specific code exists.
for (const skin of ["android", "iphone"]) {
  test(`${skin}: open_url switches to the owning app and it gets the initial URL`, async () => {
    const s = `sw-${skin}`;
    assert.ok((await call("/session", { session: s, phone: PHONE })).ok);
    const r = await act(s, { action: "open_url", url: "appb://item/42" });
    assert.equal(r.ok, true, r.error); assert.equal(r.app, "b");
    assert.match(r.screen, /Opened appb:\/\/item\/42/);
    assert.equal(await initial(s), "appb://item/42");
  });

  test(`${skin}: a later switch_app does not see the link`, async () => {
    const s = `reg-${skin}`;
    assert.ok((await call("/session", { session: s, phone: PHONE })).ok);
    assert.equal((await act(s, { action: "open_url", url: "appc://item/5" })).ok, true);
    const sw = await act(s, { action: "switch_app", id: "d" });
    assert.equal(sw.current_app, "d");
    assert.equal(await initial(s), null);
  });

  test(`${skin}: two open_url calls leave no registered init scripts: a reload sees no link`, async () => {
    const s = `init-${skin}`;
    assert.ok((await call("/session", { session: s, phone: PHONE })).ok);
    assert.equal((await act(s, { action: "open_url", url: "appb://x" })).ok, true);
    assert.equal((await act(s, { action: "open_url", url: "appc://y" })).ok, true);
    assert.equal((await act(s, { action: "open_recents" })).ok, true);
    // kill_app reloads the page (a cold start). An init script registered by open_url would run again on that reload and hand the link back.
    const k = await act(s, { action: "kill_app" }); assert.equal(k.ok, true, JSON.stringify(k));
    assert.equal((await act(s, { action: "resume_app" })).ok, true);
    assert.equal(k.reloads >= 1, true, "the page reloaded");
    assert.equal(await initial(s), null);
  });
}

for (const skin of ["android", "iphone"]) {
  test(`${skin}: app A opens app B's scheme through the link bridge: B is current and gets the URL`, async () => {
    const s = `link-${skin}`;
    assert.ok((await call("/session", { session: s, phone: PHONE })).ok);
    const snap = (await act(s, { action: "screen" })).screen;
    const ref = /button "Open B" \[ref=(e\d+)\]/.exec(snap)?.[1];
    assert.ok(ref, snap);
    const r = await act(s, { action: "tap", ref });
    assert.equal(r.ok, true, JSON.stringify(r));
    await new Promise((x) => setTimeout(x, 800));
    const sc = await act(s, { action: "screen" });
    assert.match(sc.screen, /Opened appb:\/\/item\/9/);
    assert.equal(await initial(s), "appb://item/9");
    const apps = await act(s, { action: "switch_app", id: "d" });
    assert.equal(apps.current_app, "d");
    assert.equal(await initial(s), null);
  });
}
