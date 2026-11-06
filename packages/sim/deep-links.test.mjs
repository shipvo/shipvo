// Deep links between installed apps, against a real sim server. Two fixture apps share one stand-in page that records URLs.
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
const PORT = pickPort(6000, 300);
const root = mkdtempSync(join(tmpdir(), "sim-url-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1 id="h">Home</h1>
<script>
window.__pnDevice = { log() { return []; }, capabilities() { return null; }, openUrl(u) { document.getElementById("h").textContent = "Got " + u; return true; } };
const go = (u) => window.__pnOpenApp(u).then((r) => { if (r !== true) document.getElementById("h").textContent = "Refused " + r.code; });
</script>
<button onclick="go('appb://item/7')">Open B</button><button onclick="go('nope://x')">Open nowhere</button><button onclick="go('junk')">Open junk</button></body></html>`;
const phone = { apps: [
  { id: "a", name: "App A", url: "fixture://a", schemes: ["appa"] },
  { id: "b", name: "App B", url: "fixture://b", schemes: ["appb", "bee://"] },
], current_app: "a" };
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


const tapButton = async (id, label) => {
  const m = new RegExp(`${label}[^\\n]*\\[ref=(\\w+)\\]`).exec((await act(id, { action: "screen" })).screen);
  assert.ok(m, label); return act(id, { action: "tap", ref: m[1] });
};
for (const platform of ["android", "ios"]) {
  test(`${platform}: app A opens app B's scheme from MCP, B becomes current and gets the URL`, async () => {
    const id = `x-${platform}`;
    assert.ok((await call("/session", { session: id, phone, device: { platform } })).ok);
    const out = await act(id, { action: "open_url", url: "appb://item/42" });
    assert.equal(out.ok, true, out.error);
    assert.match(out.screen, /Got appb:\/\/item\/42/);
    assert.equal((await act(id, { action: "switch_app", id: "b" })).current_app, "b");
    const log = (await act(id, { action: "device_log" })).log;
    assert.ok(log.some((e) => e.name === "open_url" && e.app === "b" && e.source === "simulated"));
  });
  test(`${platform}: Linking.openURL inside app A switches to B; refusals are typed`, async () => {
    const id = `y-${platform}`;
    assert.ok((await call("/session", { session: id, phone, device: { platform } })).ok);
    await tapButton(id, "Open B");
    const st = await act(id, { action: "switch_app", id: "b" });   // already current: no change
    assert.equal(st.current_app, "b");
    assert.match((await act(id, { action: "screen" })).screen, /Got appb:\/\/item\/7/);
    await tapButton(id, "Open nowhere");
    assert.match((await act(id, { action: "screen" })).screen, /Refused no_handler/);
    await tapButton(id, "Open junk");
    assert.match((await act(id, { action: "screen" })).screen, /Refused invalid_url/);
  });
}

test("no_handler and invalid_url from MCP", async () => {
  assert.ok((await call("/session", { session: "y", phone })).ok);
  assert.equal((await act("y", { action: "open_url", url: "nope://x" })).code, "no_handler");
  for (const url of ["not a url", "item/42", "", 5]) assert.equal((await act("y", { action: "open_url", url })).code, "invalid_url", String(url));
  assert.equal((await act("y", { action: "device_log" })).log.some((e) => e.name === "open_url"), false);
});
