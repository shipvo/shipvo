// Live: the Capacitor sample's built web directory opens in the simulator on both skins, with stable refs and a tap flow.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, "..", "..", "apps", "capacitor-sample");
const PORT = pickPort(6400, 300);
const state = mkdtempSync(join(tmpdir(), "sim-cap-"));
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const refOf = (screen, label) => new RegExp(`${label}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen)?.[1];

function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  const b = spawnSync(process.execPath, ["scripts/copy-assets.mjs"], { cwd: sample, encoding: "utf8" });
  assert.equal(b.status, 0, b.stderr);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", state, "--dist", join(sample, "www"), "--app", "capacitor-sample"], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start on port ${PORT}. stderr: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(state, { recursive: true, force: true });
});

for (const skin of ["android", "ios"]) {
  test(`capacitor sample on the ${skin} skin: refs are stable and a tap flow passes`, async () => {
    const s = await call("/session", { session: skin, skin });
    assert.ok(s.ok, JSON.stringify(s));
    const first = await act(skin, { action: "screen" });
    assert.match(first.screen, /Items/);
    const again = await act(skin, { action: "screen" });
    assert.equal(refOf(again.screen, "Show release number"), refOf(first.screen, "Show release number"), "refs stay the same on an unchanged screen");
    const ref = refOf(first.screen, "Show release number");
    assert.ok(ref, first.screen);
    const r = await act(skin, { action: "tap", ref });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.screen, /Release: embedded build/);
  });
}
