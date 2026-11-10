// Live: /phone renders the frame for a session. Its Store and home screen share the session's installed apps with the MCP actions:
// Install tapped in the page shows in device_log, and install_app from the tools draws its icon. Android and iOS.
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
const PORT = pickPort(12200, 100);
const root = mkdtempSync(join(tmpdir(), "sim-phone-page-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc, browser;
const base = `http://localhost:${PORT}`;
const call = async (path, body) => (await fetch(base + path, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(base + "/"); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start: ${err}`);
});
after(async () => {
  await browser?.close();
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("phone_apps reads the phone's apps and Store without changing the device log", async () => {
  assert.ok((await call("/session", { session: "pa-read" })).ok);
  const r = await act("pa-read", { action: "phone_apps" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.installed_apps, []);
  assert.ok(r.store.length >= 1);
  assert.equal((await act("pa-read", { action: "device_log" })).log.length, 0);
  assert.equal((await act("nope", { action: "phone_apps" })).ok, false);
});

for (const skin of ["android", "ios"]) {
  test(`${skin}: the frame page shares the session's installed apps with the tools`, async () => {
    const sid = `pa-${skin}`;
    assert.ok((await call("/session", { session: sid, skin })).ok);
    const page = await browser.newPage({ viewport: { width: 520, height: 1000 } });
    try {
      await page.goto(`${base}/phone?session=${sid}`);
      assert.equal(await page.locator(`[data-part="phone-body"]`).getAttribute("data-skin"), skin);
      // tap Store, then Install on the first app
      await page.getByRole("button", { name: "Store" }).click();
      const first = (await act(sid, { action: "phone_apps" })).store[0];
      await page.getByRole("button", { name: `Install ${first.name}` }).click();
      await page.locator(`[data-part="installed-app"][data-app="${first.id}"]`).waitFor();
      let log = (await act(sid, { action: "device_log" })).log;
      assert.ok(log.some((e) => e.name === "install_app" && e.app === first.id), JSON.stringify(log));
      assert.equal((await act(sid, { action: "phone_apps" })).installed_apps[0].id, first.id);
      // an install from the tools draws its icon on the page
      const second = (await act(sid, { action: "phone_apps" })).store[1];
      assert.equal((await act(sid, { action: "install_app", id: second.id })).ok, true);
      await page.locator(`[data-part="installed-app"][data-app="${second.id}"]`).waitFor();
      // the Store now shows it as installed
      await page.getByText("Installed", { exact: true }).first().waitFor();
      // tapping an icon opens the app on the session
      await page.getByRole("button", { name: "Close" }).click();
      await page.locator(`[data-part="installed-app"][data-app="${second.id}"]`).click();
      await page.getByText(`${second.name} is open`).waitFor();
      assert.equal((await act(sid, { action: "phone_apps" })).current_app, second.id);
    } finally { await page.close(); }
  });
}

for (const skin of ["android", "ios"]) {
  test(`${skin}: the frame page shows the icons of the phone's clock and of pinned and hidden apps`, async () => {
    const sid = `pc-${skin}`;
    assert.ok((await call("/session", { session: sid, skin })).ok);
    const store = (await act(sid, { action: "phone_apps" })).store;
    for (const a of store.slice(0, 3)) assert.equal((await act(sid, { action: "install_app", id: a.id })).ok, true);
    const [a, b, c] = store.slice(0, 3);
    assert.equal((await act(sid, { action: "arrange_apps", id: a.id, schedule: { days: ["sat", "sun"], from: "09:00", to: "23:00" } })).ok, true);
    assert.equal((await act(sid, { action: "pin_app", id: c.id, pinned: true })).ok, true);
    assert.equal((await act(sid, { action: "hide_app", id: b.id })).ok, true);
    const page = await browser.newPage({ viewport: { width: 520, height: 1000 } });
    try {
      await page.goto(`${base}/phone?session=${sid}`);
      const ids = () => page.locator('[data-part="installed-app"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-app")));
      await act(sid, { action: "set_time", at: "2026-11-14T10:00:00" });   // Saturday
      await page.waitForFunction((n) => document.querySelectorAll('[data-part="installed-app"]').length === n, 2);
      assert.deepEqual(await ids(), [c.id, a.id]);   // pinned first, hidden b gone, a showing on Saturday
      await act(sid, { action: "set_time", at: "2026-11-09T10:00:00" });   // Monday
      await page.waitForFunction((n) => document.querySelectorAll('[data-part="installed-app"]').length === n, 1);
      assert.deepEqual(await ids(), [c.id]);
    } finally { await page.close(); }
  });
}

test("the frame page says so for a session that does not exist", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/phone?session=missing`);
    await page.getByText("No such session").waitFor();
  } finally { await page.close(); }
});
