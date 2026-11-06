// Live: bad phone.json and private app URLs. (copied setup from open-url.test.mjs)
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
const PORT = pickPort(6100, 300);
const root = mkdtempSync(join(tmpdir(), "sim-apps-live-"));
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
  writeFileSync(join(root, "phone.json"), "{ not json");
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist, "--phone", join(root, "phone.json")], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
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


test("a phone.json with a syntax error fails /session with bad_profile", async () => {
  const r = await call("/session", { session: "bad" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "bad_profile");
});

test("an explicit phone for a session can still start, and a private app url is refused without navigating", async () => {
  const phone = { apps: [{ id: "evil", name: "Evil", url: "http://169.254.169.254/latest/" }, { id: "ok", name: "Ok", url: "fixture://ok" }] };
  const s = await call("/session", { session: "p", phone });
  assert.ok(s.ok, JSON.stringify(s));
  const r = await act("p", { action: "switch_app", id: "evil" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "host_not_allowed");
  const after = await act("p", { action: "screen" });
  assert.doesNotMatch(after.screen ?? "", /169\.254/);
  const ok = await act("p", { action: "switch_app", id: "ok" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.current_app, "ok");
});
