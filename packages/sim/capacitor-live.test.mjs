// Live: the Capacitor sample's built web directory opens in the simulator on the Android and iOS skins.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, "..", "..", "apps", "capacitor-sample");
const www = join(sample, "www");
const PORT = pickPort(10400, 300);
const root = mkdtempSync(join(tmpdir(), "sim-capacitor-"));
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const refOf = (screen, name) => new RegExp(`${name}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen)?.[1];

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  // Build the sample's web directory (the same step `pnpm --filter capacitor-sample build` ends with).
  const b = spawnSync(process.execPath, ["scripts/copy-assets.mjs"], { cwd: sample, encoding: "utf8" });
  if (b.status !== 0) throw new Error(`could not build apps/capacitor-sample: ${b.stderr}`);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", www], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start on port ${PORT}: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

for (const skin of ["android", "ios"]) {
  test(`Capacitor sample opens, has stable refs and a tap flow passes on the ${skin} skin`, async () => {
    const s = await call("/session", { session: skin, skin });
    assert.ok(s.ok, JSON.stringify(s));
    assert.match(s.screen, /Items/);
    const first = await act(skin, { action: "screen" });
    const again = await act(skin, { action: "screen" });
    const ref = refOf(first.screen, 'button "Show release number"');
    assert.ok(ref, first.screen);
    assert.equal(refOf(again.screen, 'button "Show release number"'), ref, "ref is stable between snapshots");
    const r = await act(skin, { action: "tap", ref });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match((await act(skin, { action: "screen" })).screen, /embedded build|Release|release/i);
    const item = refOf((await act(skin, { action: "screen" })).screen, "button \"(?!Show|Check)[^\"]+\"");
    const t = await act(skin, { action: "tap", ref: item });
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.match((await act(skin, { action: "screen" })).screen, /button "Back"/);
  });
}
