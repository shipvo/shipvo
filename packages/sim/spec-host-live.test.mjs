// Live: create_app starts a spec app on the phone. The app has an icon, opens, shows its labelled controls, and
// taps, typing and choices change it. Android and iOS skins.
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
const PORT = pickPort(11000, 150);
const root = mkdtempSync(join(tmpdir(), "sim-spec-host-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

// A small tracker: a list of gifts and a form that adds one.
const GIFTS = {
  spec: "shipvo.app/v0",
  app: { id: "gifts", name: "Gift Tracker", icon: "gift", description: "Gift ideas for the holidays." },
  data: { gifts: { source: "collection", fields: { id: "text", name: "text" }, seed: [{ id: "g1", name: "Scarf" }] } },
  actions: {
    add_gift: {
      description: "Add a gift idea.",
      input: { name: { type: "text" } },
      do: [{ insert: "gifts", value: { id: "{{ 'g' + string(count(gifts) + 1) }}", name: "{{ input.name }}" } }, { toast: "Gift added" }],
    },
  },
  screens: [{ id: "home", title: "Gifts", body: [
    { type: "list", label: "Gift ideas", from: "{{ gifts }}", item: { title: "{{ item.name }}" }, empty: { message: "No gifts yet" } },
    { type: "form", label: "Add a gift", fields: [{ name: "name", type: "text", label: "Gift name", required: true, maxLength: 100 }], submit: { label: "Add", action: "add_gift" } },
  ] }],
};

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

for (const style of ["android", "ios"]) {
  test(`${style}: create_app installs a spec app that opens and can be used`, async () => {
    const sid = `sp-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    const r = await act(sid, { action: "create_app", id: "gifts", spec: GIFTS, style });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.current_app, "gifts");
    assert.equal(r.installed_apps.find((a) => a.id === "gifts").kind, "spec");
    assert.match(r.screen, /Gift ideas/);
    assert.match(r.screen, /Scarf/);
    // type into the form and submit: the list changes
    const ref = (text, role) => new RegExp(`${role} "${text}" \\[ref=([\\w]+)\\]`).exec(r.screen)?.[1];
    const typed = await act(sid, { action: "type", ref: ref("Gift name", "textbox"), text: "Mug" });
    assert.equal(typed.ok, true, JSON.stringify(typed));
    const added = await act(sid, { action: "tap", ref: ref("Add", "button") });
    assert.equal(added.ok, true, JSON.stringify(added));
    const screen = (await act(sid, { action: "screen" })).screen;
    assert.match(screen, /Mug/);
    const log = (await act(sid, { action: "device_log" })).log.find((e) => e.name === "create_app");
    assert.equal(log.source, "real");
  });
}

test("a spec with problems is refused with the path of each one, and nothing is installed", async () => {
  assert.ok((await call("/session", { session: "sp-bad" })).ok);
  const r = await act("sp-bad", { action: "create_app", id: "oops", spec: { spec: "0", app: { id: "oops" }, screens: [] } });
  assert.equal(r.ok, false);
  assert.equal(r.code, "invalid_spec");
  assert.match(r.error, /\//);
  const sw = await act("sp-bad", { action: "switch_app", id: "oops" });
  assert.equal(sw.code, "not_installed");
});

test("create_app twice with the same id says already_installed", async () => {
  assert.ok((await call("/session", { session: "sp-dup" })).ok);
  assert.equal((await act("sp-dup", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const r = await act("sp-dup", { action: "create_app", id: "gifts", spec: GIFTS });
  assert.equal(r.code, "already_installed");
});

test("run_app_action changes the app's data and the open screen shows it; a bad input says why", async () => {
  assert.ok((await call("/session", { session: "sp-act" })).ok);
  assert.equal((await act("sp-act", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const r = await act("sp-act", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Kite" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.screen, /Kite/);
  const bad = await act("sp-act", { action: "app_action", id: "gifts", action_name: "no_such", input: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "action_failed");
  const none = await act("sp-act", { action: "app_action", id: "ghost", action_name: "x" });
  assert.equal(none.code, "not_installed");
});

test("update_app is a new version: entered data stays, the screen changes, a bad spec changes nothing", async () => {
  assert.ok((await call("/session", { session: "sp-up" })).ok);
  assert.equal((await act("sp-up", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  await act("sp-up", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Kite" } });
  // the new version renames the list and adds a heading
  const v2 = structuredClone(GIFTS);
  v2.screens[0].body[0].label = "Ideas for the holidays";
  v2.screens[0].title = "Holiday gifts";
  const r = await act("sp-up", { action: "update_app", id: "gifts", spec: v2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.version, 2);
  assert.match(r.screen, /Ideas for the holidays/);
  assert.match(r.screen, /Kite/);   // the gift added in version 1 is still there
  assert.equal(r.installed_apps.find((a) => a.id === "gifts").version, "2");
  const bad = await act("sp-up", { action: "update_app", id: "gifts", spec: { spec: "shipvo.app/v0", screens: [] } });
  assert.equal(bad.ok, false); assert.equal(bad.code, "invalid_spec");
  const screen = (await act("sp-up", { action: "screen" })).screen;
  assert.match(screen, /Ideas for the holidays/);   // still version 2
  const none = await act("sp-up", { action: "update_app", id: "ghost", spec: v2 });
  assert.equal(none.code, "not_installed");
  const log = (await act("sp-up", { action: "device_log" })).log.filter((e) => e.name === "update_app");
  assert.deepEqual(log.map((e) => [e.from, e.version, e.source]), [["1", "2", "real"]]);
});

test("uninstall stops the app: actions say not_installed and a new create starts with fresh data", async () => {
  assert.ok((await call("/session", { session: "sp-un" })).ok);
  assert.equal((await act("sp-un", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  assert.equal((await act("sp-un", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Kite" } })).ok, true);
  assert.equal((await act("sp-un", { action: "uninstall_app", id: "gifts" })).ok, true);
  assert.equal((await act("sp-un", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Drum" } })).code, "not_installed");
  assert.equal((await fetch(`http://localhost:${PORT}/spec/sp-un/gifts/`)).status, 404);
  const again = await act("sp-un", { action: "create_app", id: "gifts", spec: GIFTS });
  assert.equal(again.ok, true);
  assert.doesNotMatch(again.screen, /Kite/);
  assert.match(again.screen, /Scarf/);
  const dup = await act("sp-un", { action: "create_app", id: "gifts", spec: GIFTS });
  assert.match(dup.error, /uninstall_app/);
});

test("the control endpoint answers 400 for bad JSON and 413 for a huge body", async () => {
  assert.ok((await call("/session", { session: "sp-op" })).ok);
  assert.equal((await act("sp-op", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const url = `http://localhost:${PORT}/spec/sp-op/gifts/op`;
  assert.equal((await fetch(url, { method: "POST", body: "{nope" })).status, 400);
  assert.equal((await fetch(url, { method: "POST", body: "x".repeat(70000) })).status, 413);
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 200);
});

test("update_app keeps a setting the person changed", async () => {
  assert.ok((await call("/session", { session: "sp-st" })).ok);
  const base = structuredClone(GIFTS);
  base.state = { alerts: { type: "bool", default: false } };
  base.screens[0].body.push({ type: "toggle", label: "Gift alerts", bind: "state.alerts" });
  assert.equal((await act("sp-st", { action: "create_app", id: "gifts", spec: base })).ok, true);
  const op = await fetch(`http://localhost:${PORT}/spec/sp-st/gifts/op`, { method: "POST", body: JSON.stringify({ op: "toggle", label: "Gift alerts" }) });
  assert.equal(op.status, 200);
  const v2 = structuredClone(base); v2.screens[0].title = "Holiday gifts";
  const r = await act("sp-st", { action: "update_app", id: "gifts", spec: v2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.screen, /switch "Gift alerts" \[checked\]/);
});
