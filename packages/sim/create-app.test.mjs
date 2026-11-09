// create_app: validate a spec, install it on the phone, open it through the shared renderer, tap a button.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { createApps, createSpecApp, AppsError } from "./apps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const today = JSON.parse(readFileSync(join(here, "../spec/test/fixtures/render-today.json"), "utf8"));
const shop = JSON.parse(readFileSync(join(here, "../../templates/shop/app.json"), "utf8"));

test("createSpecApp installs a valid spec and stores it with the entry", () => {
  const st = createApps();
  createSpecApp(st, shop);
  assert.equal(st.installed_apps.length, 1);
  assert.equal(st.installed_apps[0].id, "shop");
  assert.deepEqual(st.installed_apps[0].spec, shop);
  assert.equal(st.log.at(-1).name, "create_app");
});

test("createSpecApp returns the validator issues and installs nothing for a bad spec", () => {
  const st = createApps();
  assert.throws(() => createSpecApp(st, { spec: "shipvo.app/v0", app: { id: "x" } }), (e) => e instanceof AppsError && e.code === "invalid_spec" && e.issues.length > 0 && e.issues.every((i) => i.path !== undefined && i.message));
  assert.equal(st.installed_apps.length, 0);
  assert.equal(st.log.length, 0);
});

test("createSpecApp fails with already_installed for a used id", () => {
  const st = createApps();
  createSpecApp(st, shop);
  assert.throws(() => createSpecApp(st, shop), (e) => e.code === "already_installed");
  assert.equal(st.installed_apps.length, 1);
});

const PORT = pickPort(6500, 300);
const root = mkdtempSync(join(tmpdir(), "sim-create-app-"));
const dist = join(root, "dist");
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>host</title><h1>Host</h1>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start on port ${PORT}. stderr: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

for (const skin of ["android", "ios"]) {
  test(`create_app installs, opens and runs a button on the ${skin} frame`, async () => {
    const sid = `ca-${skin}`;
    const s = await call("/session", { session: sid, skin });
    assert.ok(s.ok, JSON.stringify(s));

    const bad = await act(sid, { action: "create_app", spec: { spec: "shipvo.app/v0", app: { id: "broken", name: "Broken" } } });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "invalid_spec");
    assert.ok(Array.isArray(bad.issues) && bad.issues.length > 0 && bad.issues[0].path !== undefined && bad.issues[0].message);

    const made = await act(sid, { action: "create_app", spec: today });
    assert.ok(made.ok, JSON.stringify(made));
    assert.ok(made.installed_apps.some((a) => a.id === "today"), "listed as installed");
    assert.equal(made.installed_apps.length, 1, "the broken spec installed nothing");

    const again = await act(sid, { action: "create_app", spec: today });
    assert.equal(again.code, "already_installed");

    const opened = await act(sid, { action: "switch_app", id: "today" });
    assert.ok(opened.ok, JSON.stringify(opened));
    assert.match(opened.screen, /Revenue today/);
    const ref = /button "Details" \[ref=(e\d+)\]/.exec(opened.screen)?.[1] ?? /\[ref=(e\d+)\][^\n]*button "Details"/.exec(opened.screen)?.[1];
    assert.ok(ref, `Details button in:\n${opened.screen}`);

    const tapped = await act(sid, { action: "tap", ref });
    assert.ok(tapped.ok, JSON.stringify(tapped));
    assert.match(tapped.screen, /Revenue so far today/);

    const log = await act(sid, { action: "device_log" });
    assert.ok(log.log.some((l) => l.name === "create_app" && l.app === "today"));
  });
}
