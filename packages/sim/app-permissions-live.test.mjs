// Live: per-app device permissions. A denied permission gives permission_denied; an allowed one works; answers survive
// export/import and the Settings toggle. Android and iOS skins.
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
const PORT = pickPort(12100, 100);
const root = mkdtempSync(join(tmpdir(), "sim-perms-"));
const dist = join(root, "dist"), dir = join(root, "state");
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
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

const REMIND = {
  spec: "shipvo.app/v0",
  app: { id: "remind", name: "Remind Me" },
  permissions: { device: ["notifications", "camera"] },
  state: { n: { type: "number", default: 0 } },
  actions: { ping: { do: [{ notify: { title: "Hello" } }, { set: "state.n", value: 1 }] } },
  screens: [{ id: "home", title: "Home", body: [{ type: "text", value: "Hi" }] }],
};
const ping = (sid, id) => act(sid, { action: "app_action", id, action_name: "ping", input: {} });

for (const style of ["android", "ios"]) {
  test(`${style}: a denied permission gives permission_denied, an allowed one works, and Settings can change it`, async () => {
    const sid = `pm-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    const r = await act(sid, { action: "create_app", id: "remind", spec: REMIND, style, permissions: { notifications: false } });
    assert.equal(r.ok, true, JSON.stringify(r));
    // every declared permission is reported, with the person's answer
    assert.deepEqual(r.installed_apps.find((a) => a.id === "remind").permissions, { notifications: false, camera: true });
    const denied = await ping(sid, "remind");
    assert.equal(denied.ok, false); assert.equal(denied.code, "permission_denied"); assert.match(denied.error, /notifications/);
    const on = await act(sid, { action: "set_app_permission", id: "remind", permission: "notifications", allowed: true });
    assert.equal(on.ok, true, JSON.stringify(on)); assert.equal(on.permissions.notifications, true);
    assert.equal((await ping(sid, "remind")).ok, true);
    const bad = await act(sid, { action: "set_app_permission", id: "remind", permission: "contacts", allowed: true });
    assert.equal(bad.code, "not_declared");
  });

  test(`${style}: answers persist through export and import`, async () => {
    const sid = `pe-${style}`, other = `pf-${style}`;
    for (const x of [sid, other]) assert.ok((await call("/session", { session: x })).ok);
    await act(sid, { action: "create_app", id: "remind", spec: REMIND, style, permissions: { camera: false } });
    const ex = await act(sid, { action: "export_apps" });
    assert.deepEqual(ex.apps[0].permissions, { notifications: true, camera: false });
    const im = await act(other, { action: "import_apps", export: ex });
    assert.equal(im.ok, true, JSON.stringify(im));
    assert.deepEqual(im.installed_apps.find((a) => a.id === "remind").permissions, { notifications: true, camera: false });
  });
}

test("install_app returns the declared list and the stored answers", async () => {
  const sid = "pm-install";
  assert.ok((await call("/session", { session: sid })).ok);
  const r = await act(sid, { action: "install_app", id: "tidewatch", permissions: { location: false } });
  assert.deepEqual(r.declared, ["notifications", "location"], JSON.stringify(r));
  assert.deepEqual(r.permissions, { notifications: true, location: false });
  const plain = await act(sid, { action: "install_app", id: "tide" });
  assert.deepEqual(plain.declared, []);
});
