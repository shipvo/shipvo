// Live: arrange_apps and set_time change what the home screen shows.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { renderFrame, statusClientScript } from "./frame.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(12400, 150);
const root = mkdtempSync(join(tmpdir(), "sim-placement-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const PHONE = { apps: [{ id: "plan", name: "Weekly planner", url: "fixture://plan" }, { id: "wknd", name: "Weekend plans", url: "fixture://wknd" }, { id: "mail", name: "Mail", url: "fixture://mail" }] };

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

test("a weekly planner shows on weekdays and weekend plans on Saturday, by the phone's clock", async () => {
  assert.ok((await call("/session", { session: "pl1", phone: PHONE })).ok);
  assert.equal((await act("pl1", { action: "arrange_apps", id: "plan", schedule: { days: ["mon", "tue", "wed", "thu", "fri"], from: "06:00", to: "20:00" } })).ok, true);
  assert.equal((await act("pl1", { action: "arrange_apps", id: "wknd", schedule: { days: ["sat", "sun"] } })).ok, true);
  const at = async (iso) => (await act("pl1", { action: "set_time", at: iso })).home;
  const mon = await at("2026-11-09T09:00:00");
  assert.match(mon, /button "Weekly planner"/); assert.doesNotMatch(mon, /button "Weekend plans"/);
  assert.match(mon, /"Weekend plans" \(wknd\): not showing now/);
  const sat = await at("2026-11-14T09:00:00");
  assert.match(sat, /button "Weekend plans"/); assert.doesNotMatch(sat, /button "Weekly planner"/);
  assert.equal((await act("pl1", { action: "switch_app", id: "plan" })).ok, true);   // not showing on Saturday, still opens by tool
});

const SPEC = (id, name) => ({ spec: "shipvo.app/v0", app: { id, name, icon: "gift" }, screens: [{ id: "home", title: name, body: [{ type: "text", text: `${name} home` }] }] });

for (const skin of ["android", "ios"]) {
  test(`${skin}: schedule_app shows an app in a window on the phone's clock (also across midnight) and clear_schedule returns to pin and hide`, async () => {
    const sid = `pl4-${skin}`;
    assert.ok((await call("/session", { session: sid, phone: PHONE, skin })).ok);
    assert.equal((await act(sid, { action: "phone_apps" })).skin, skin);
    const r = await act(sid, { action: "schedule_app", id: "mail", days: ["mon"], from: "08:00", to: "10:00" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const at = async (iso) => (await act(sid, { action: "set_time", at: iso })).home;
    assert.match(await at("2026-11-09T09:00:00"), /button "Mail"/);
    const out = await at("2026-11-09T11:00:00");
    assert.doesNotMatch(out, /button "Mail"/); assert.match(out, /"Mail" \(mail\): not showing now/);
    assert.doesNotMatch(await at("2026-11-10T09:00:00"), /button "Mail"/);   // Tuesday
    // A window across midnight belongs to the day it starts: Friday 22:00 to Saturday 06:00.
    assert.equal((await act(sid, { action: "schedule_app", id: "mail", days: ["fri"], from: "22:00", to: "06:00" })).ok, true);
    assert.match(await at("2026-11-13T23:00:00"), /button "Mail"/);
    assert.match(await at("2026-11-14T05:00:00"), /button "Mail"/);
    assert.doesNotMatch(await at("2026-11-14T07:00:00"), /button "Mail"/);
    assert.doesNotMatch(await at("2026-11-13T12:00:00"), /button "Mail"/);
    assert.equal((await act(sid, { action: "clear_schedule", id: "mail" })).ok, true);
    assert.match(await at("2026-11-09T11:00:00"), /button "Mail"/);
    await act(sid, { action: "hide_app", id: "mail" });
    assert.doesNotMatch(await at("2026-11-09T09:00:00"), /button "Mail"/);   // hide is the fallback again
    const bad = await act(sid, { action: "schedule_app", id: "mail", from: "8am", to: "09:00" });
    assert.equal(bad.ok, false); assert.equal(bad.code, "bad_placement");
    assert.equal((await act(sid, { action: "schedule_app", id: "nope", from: "08:00", to: "09:00" })).code, "not_installed");
    assert.equal((await act(sid, { action: "clear_schedule", id: "nope" })).code, "not_installed");
  });
}

test("device_log records schedule_app and clear_schedule under their own names", async () => {
  assert.ok((await call("/session", { session: "pl5", phone: PHONE })).ok);
  await act("pl5", { action: "schedule_app", id: "mail", days: ["sat"], from: "09:00", to: "10:00" });
  await act("pl5", { action: "clear_schedule", id: "mail" });
  await act("pl5", { action: "arrange_apps", id: "mail", pinned: true });
  const names = (await act("pl5", { action: "device_log" })).log.filter((e) => e.app === "mail").map((e) => e.name);
  assert.deepEqual(names, ["schedule_app", "clear_schedule", "arrange_apps"]);
});

for (const skin of ["android", "ios"]) {
  test(`${skin}: export then import keeps the schedule`, async () => {
    const from = `pl6-${skin}`, to = `pl7-${skin}`;
    assert.ok((await call("/session", { session: from, skin })).ok);
    assert.equal((await act(from, { action: "create_app", id: "plan", spec: SPEC("plan", "Planner"), style: skin, open: false })).ok, true);
    assert.equal((await act(from, { action: "schedule_app", id: "plan", days: ["mon"], from: "08:00", to: "10:00" })).ok, true);
    const ex = await act(from, { action: "export_apps" });
    assert.deepEqual(ex.apps[0].placement, { schedule: { days: ["mon"], from: "08:00", to: "10:00" } });
    assert.ok((await call("/session", { session: to, skin })).ok);
    const im = await act(to, { action: "import_apps", apps: ex.apps });
    assert.equal(im.ok, true, JSON.stringify(im));
    const at = async (iso) => (await act(to, { action: "set_time", at: iso })).home;
    assert.match(await at("2026-11-09T09:00:00"), /button "Planner"/);
    const out = await at("2026-11-09T11:00:00");
    assert.doesNotMatch(out, /button "Planner"/); assert.match(out, /"Planner" \(plan\): not showing now/);
    // An export from an app with no placement carries none, and a bad placement in an import is dropped.
    const bad = await act(to, { action: "import_apps", replace: true, apps: [{ ...ex.apps[0], placement: { schedule: { from: "8am" } } }] });
    assert.equal(bad.ok, true, JSON.stringify(bad));
    assert.match(await at("2026-11-09T11:00:00"), /button "Planner"/);
  });
}

test("pin, hide and position change the order; errors are typed; changes are in device_log", async () => {
  assert.ok((await call("/session", { session: "pl2", phone: PHONE })).ok);
  const order = (screen) => [...screen.matchAll(/button "([^"]+)"/g)].map((m) => m[1]).filter((n) => n !== "Store").join(",");
  await act("pl2", { action: "arrange_apps", id: "mail", pinned: true });
  assert.match(order((await act("pl2", { action: "arrange_apps", id: "plan", position: 0 })).home), /^Mail,Weekly planner,Weekend plans/);
  const hid = (await act("pl2", { action: "arrange_apps", id: "mail", hidden: true })).home;
  assert.doesNotMatch(hid, /button "Mail"/);
  assert.match(order(hid), /^Weekly planner,Weekend plans/);   // the pinned app is hidden, so the position order shows
  assert.equal((await act("pl2", { action: "switch_app", id: "mail" })).ok, true);   // a hidden app still opens by tool
  assert.equal((await act("pl2", { action: "arrange_apps", id: "ghost", pinned: true })).code, "not_installed");
  assert.equal((await act("pl2", { action: "arrange_apps", id: "mail", position: -3 })).code, "bad_placement");
  assert.equal((await act("pl2", { action: "set_time", at: "tomorrow-ish" })).code, "bad_time");
  assert.equal((await act("pl2", { action: "set_time", at: "2026-11-14" })).code, "bad_time");
  assert.equal((await act("pl2", { action: "set_time", at: "1" })).code, "bad_time");
  assert.equal((await act("pl2", { action: "set_time", at: "2026-11-14T09:00" })).ok, true);
  const log = (await act("pl2", { action: "device_log" })).log.filter((e) => e.name === "arrange_apps");
  assert.ok(log.length >= 3 && log[0].app === "mail");
});

for (const skin of ["android", "ios"]) {
  test(`${skin}: the frame's home screen leaves out a hidden app and puts a pinned app first`, async () => {
    const { chromium } = createRequire(import.meta.url)("playwright");
    const b = await chromium.launch();
    try {
      const p = await b.newPage({ viewport: { width: 460, height: 960 } });
      const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="<p>x</p>"></iframe>` });
      const phone = { apps: [{ id: "a", name: "Alpha" }, { id: "b", name: "Bravo", placement: { pinned: true } }, { id: "c", name: "Charlie", placement: { hidden: true } }] };
      await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin, phone)}</script>`);
      await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
      const names = await p.locator('[data-part="installed-app"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      assert.deepEqual(names, ["Bravo", "Alpha"]);
    } finally { await b.close(); }
  });
}

for (const skin of ["android", "ios"]) {
  test(`${skin}: the frame's home screen updates when a schedule starts or ends`, async () => {
    const { chromium } = createRequire(import.meta.url)("playwright");
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 460, height: 960 } });
      const p = await ctx.newPage();
      await p.clock.install({ time: new Date("2026-11-09T17:59:00") });   // Monday, one minute before the planner's window ends
      const f = renderFrame({ skin, screen: `<iframe id="app" srcdoc="<p>x</p>"></iframe>` });
      const phone = { apps: [{ id: "plan", name: "Planner", placement: { schedule: { days: ["mon"], from: "08:00", to: "18:00" } } }, { id: "mail", name: "Mail" }] };
      await p.setContent(`<style>${f.css}</style>${f.html}<script>${statusClientScript("app", skin, phone)}</script>`);
      await p.evaluate(() => window.postMessage({ type: "pn:nav", where: "home" }, "*"));
      const names = () => p.locator('[data-part="installed-app"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      assert.deepEqual(await names(), ["Planner", "Mail"]);
      await p.locator('[data-part="installed-app"]').first().focus();
      await p.clock.runFor(30000);   // 17:59:30: nothing changed, so focus stays on the icon
      assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("data-part")), "installed-app");
      await p.clock.runFor(90000);
      assert.deepEqual(await names(), ["Mail"]);
    } finally { await b.close(); }
  });
}

test("every home screen answer follows the phone's clock, and the screenshot shows the same icons", async () => {
  assert.ok((await call("/session", { session: "pl9", phone: PHONE })).ok);
  assert.equal((await act("pl9", { action: "arrange_apps", id: "wknd", schedule: { days: ["sat", "sun"], from: "09:00", to: "23:00" } })).ok, true);
  assert.equal((await act("pl9", { action: "arrange_apps", id: "plan", schedule: { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" } })).ok, true);
  await act("pl9", { action: "press_home" });
  const shot = async () => { await act("pl9", { action: "press_home" }); const r = await act("pl9", { action: "screenshot", inline: true }); assert.ok(r.data, JSON.stringify(r)); return r.data; };
  await act("pl9", { action: "set_time", at: "2026-11-14T10:00:00" });   // Saturday
  const satPin = (await act("pl9", { action: "pin_app", id: "mail", pinned: true })).screen;
  assert.match(satPin, /button "Weekend plans"/); assert.doesNotMatch(satPin, /button "Weekly planner"/);
  const satShot = await shot();
  await act("pl9", { action: "set_time", at: "2026-11-09T10:00:00" });   // Monday
  const monHide = (await act("pl9", { action: "hide_app", id: "mail" })).screen;
  assert.match(monHide, /button "Weekly planner"/); assert.doesNotMatch(monHide, /button "Weekend plans"/);
  assert.notEqual(await shot(), satShot);
});

test("arrange_apps and set_time return the open screen when an app is in front, and the home text as home", async () => {
  assert.ok((await call("/session", { session: "pl3", phone: PHONE })).ok);
  const r = await act("pl3", { action: "arrange_apps", id: "mail", pinned: true });
  assert.match(r.screen, /heading "Home"/);
  assert.match(r.home, /^Home screen\nInstalled apps\n- button "Mail"/);
});
