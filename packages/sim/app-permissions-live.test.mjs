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
// The page flips the switch before the server has applied the change, so poll until the ping gives the expected answer.
const pingUntil = async (sid, id, ok) => {
  let last;
  for (let i = 0; i < 50; i++) { last = await ping(sid, id); if (last.ok === ok) return last; await new Promise((r) => setTimeout(r, 100)); }
  return last;
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

  test(`${style}: the Settings switch in the phone page changes what the app may do`, async () => {
    const sid = `ps-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "remind", spec: REMIND, style, permissions: { notifications: false } })).ok, true);
    assert.equal((await ping(sid, "remind")).code, "permission_denied");
    const { chromium } = createRequire(import.meta.url)("playwright");
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      await page.goto(`http://localhost:${PORT}/phone?session=${sid}&skin=${style}`);
      await page.click('[data-part="settings-icon"]');
      const sw = page.locator('[data-part="perm-switch"][data-app="remind"][data-perm="notifications"]');
      await sw.waitFor();
      assert.equal(await sw.getAttribute("aria-checked"), "false");
      await sw.click();
      await page.waitForFunction(() => document.querySelector('[data-part="perm-switch"][data-perm="notifications"]')?.getAttribute("aria-checked") === "true");
      assert.equal((await pingUntil(sid, "remind", true)).ok, true);
      await sw.click();
      await page.waitForFunction(() => document.querySelector('[data-part="perm-switch"][data-perm="notifications"]')?.getAttribute("aria-checked") === "false");
      const again = await pingUntil(sid, "remind", false);
      assert.equal(again.ok, false); assert.equal(again.code, "permission_denied");
    } finally { await b.close(); }
  });

  test(`${style}: an updated spec gets answers for new permissions and loses dropped ones`, async () => {
    const sid = `pu-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    await act(sid, { action: "create_app", id: "remind", spec: REMIND, style, permissions: { camera: false } });
    const next = { ...REMIND, permissions: { device: ["notifications", "location"] } };
    const up = await act(sid, { action: "update_app", id: "remind", spec: next });
    assert.equal(up.ok, true, JSON.stringify(up));
    assert.deepEqual(up.installed_apps.find((a) => a.id === "remind").permissions, { notifications: true, location: true });
    const set = await act(sid, { action: "set_app_permission", id: "remind", permission: "location", allowed: false });
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal((await act(sid, { action: "set_app_permission", id: "remind", permission: "camera", allowed: true })).code, "not_declared");
  });

  test(`${style}: answers survive a saved profile and a new session`, async () => {
    const sid = `pr-${style}`, next = `pn-${style}`;
    for (const x of [sid, next]) assert.ok((await call("/session", { session: x })).ok);
    await act(sid, { action: "create_app", id: "remind", spec: REMIND, style });
    const r = await act(sid, { action: "set_app_permission", id: "remind", permission: "camera", allowed: false });
    assert.equal(r.ok, true, JSON.stringify(r));
    const saved = JSON.parse(JSON.stringify(r.profile));
    await call("/end", { session: next });
    assert.ok((await call("/session", { session: next, phone: saved })).ok);
    const apps = await act(next, { action: "phone_apps" });
    assert.deepEqual(apps.installed_apps.find((a) => a.id === "remind").permissions, { notifications: true, camera: false });
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

// The embedded frame (statusClientScript) with a session id sends the switch to the server and redraws from its reply.
for (const style of ["android", "ios"]) {
  test(`${style}: an embedded frame posts set_app_permission and shows what the server answers`, async () => {
    const { chromium } = createRequire(import.meta.url)("playwright");
    const { renderFrame, statusClientScript } = await import("./frame.mjs");
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      const posts = [];
      let apps = [{ id: "remind", name: "Remind Me", permissions: { notifications: false } }];
      await page.route("**/phone/apps*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, installed_apps: apps }) }));
      await page.route("**/act", (r) => { const body = JSON.parse(r.request().postData()); posts.push(body); if (body.allowed === true && posts.length === 2) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "no" }) }); apps = [{ ...apps[0], permissions: { notifications: body.allowed } }]; r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, installed_apps: apps }) }); });
      const f = renderFrame({ skin: style, screen: `<iframe id="app" srcdoc="&lt;p&gt;hi&lt;/p&gt;"></iframe>` });
      const html = `<!doctype html><script>window.__shipvoSession="s1"</script><style>${f.css}</style>${f.html}<script>${statusClientScript("app", style, { apps: [] })}</script>`;
      await page.route("http://sim.test/", (r) => r.fulfill({ contentType: "text/html", body: html }));
      await page.goto("http://sim.test/");
      await page.evaluate(() => document.querySelector('[data-part="settings-icon"]').click());
      const sw = '[data-part="perm-switch"][data-perm="notifications"]';
      await page.waitForSelector(sw, { state: "attached" });
      await page.evaluate((s) => document.querySelector(s).click(), sw);
      await page.waitForFunction((s) => document.querySelector(s).getAttribute("aria-checked") === "true", sw);
      assert.deepEqual(posts[0], { session: "s1", action: "set_app_permission", id: "remind", permission: "notifications", allowed: true });
      await page.evaluate((s) => document.querySelector(s).click(), sw);   // turn it off again: server accepts
      await page.waitForFunction((s) => document.querySelector(s).getAttribute("aria-checked") === "false", sw);
      assert.equal(posts.length, 2);
    } finally { await b.close(); }
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: permission_log records install answers, blocks, Settings changes, uses and uninstall`, async () => {
    const sid = `pl-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "remind", spec: REMIND, style, permissions: { notifications: false } })).ok, true);
    assert.equal((await ping(sid, "remind")).code, "permission_denied");
    assert.equal((await act(sid, { action: "set_app_permission", id: "remind", permission: "notifications", allowed: true })).ok, true);
    assert.equal((await act(sid, { action: "app_action", id: "remind", action_name: "ping", input: {}, agent: "claude-ai" })).ok, true);
    const log = await act(sid, { action: "permission_log", app: "remind" });
    assert.equal(log.ok, true, JSON.stringify(log).slice(0, 300));
    assert.deepEqual(log.entries.map((e) => [e.permission, e.event, e.by]), [
      ["notifications", "denied", "install"], ["camera", "granted", "install"],
      ["notifications", "blocked", "ping"],
      ["notifications", "granted", "settings"],
      ["notifications", "used", "ping"],
    ]);
    assert.equal(log.entries.at(-1).caller, "claude");
    assert.deepEqual((await act(sid, { action: "permission_log", event: "blocked" })).entries.map((e) => e.app), ["remind"]);
    assert.equal((await act(sid, { action: "permission_log", event: "maybe" })).code, "bad_event");
    assert.equal((await act(sid, { action: "uninstall_app", id: "remind" })).ok, true);
    const gone = (await act(sid, { action: "permission_log", app: "remind", event: "removed" })).entries;
    assert.deepEqual(gone.map((e) => [e.permission, e.by]).sort(), [["camera", "uninstall"], ["notifications", "uninstall"]]);
  });
}
