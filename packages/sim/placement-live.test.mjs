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
const PORT = pickPort(11150, 150);
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
  assert.equal((await act("pl1", { action: "switch_app", id: "plan" })).ok, true);   // hidden apps still open by tool
});

test("pin, hide and position change the order; errors are typed; changes are in device_log", async () => {
  assert.ok((await call("/session", { session: "pl2", phone: PHONE })).ok);
  const order = (screen) => [...screen.matchAll(/button "([^"]+)"/g)].map((m) => m[1]).filter((n) => n !== "Store").join(",");
  await act("pl2", { action: "arrange_apps", id: "mail", pinned: true });
  assert.match(order((await act("pl2", { action: "arrange_apps", id: "plan", position: 0 })).home), /^Mail,Weekly planner,Weekend plans/);
  await act("pl2", { action: "arrange_apps", id: "mail", hidden: true });
  assert.doesNotMatch((await act("pl2", { action: "arrange_apps", id: "mail", hidden: true })).home, /button "Mail"/);
  assert.equal((await act("pl2", { action: "arrange_apps", id: "ghost", pinned: true })).code, "not_installed");
  assert.equal((await act("pl2", { action: "arrange_apps", id: "mail", position: -3 })).code, "bad_placement");
  assert.equal((await act("pl2", { action: "set_time", at: "tomorrow-ish" })).code, "bad_time");
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

test("arrange_apps and set_time return the open screen when an app is in front, and the home text as home", async () => {
  assert.ok((await call("/session", { session: "pl3", phone: PHONE })).ok);
  const r = await act("pl3", { action: "arrange_apps", id: "mail", pinned: true });
  assert.match(r.screen, /heading "Home"/);
  assert.match(r.home, /^Home screen\nInstalled apps\n- button "Mail"/);
});
