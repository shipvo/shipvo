// Live: a spec app with live data shows it on start, refresh_app fetches it again and the open screen follows.
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
const PORT = pickPort(11300, 150);
const root = mkdtempSync(join(tmpdir(), "sim-data-live-"));
const dist = join(root, "dist"), dir = join(root, "state"), fixture = join(root, "fetch.json");
const URL_ = "https://api.example.test/prices";
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const serve = (status, body) => writeFileSync(fixture, JSON.stringify({ [URL_]: { status, body } }));
const PRICES = {
  spec: "shipvo.app/v0",
  app: { id: "prices", name: "Price Watch", icon: "chart", description: "Prices that update by themselves." },
  permissions: { network: ["api.example.test"] },
  data: { prices: { source: "http", get: URL_, cache: "10m", fields: { id: "text", name: "text", price: "text" } } },
  screens: [{ id: "home", title: "Prices", body: [{ type: "list", label: "Latest prices", from: "{{ prices }}", item: { title: "{{ item.name }}", trailing: "{{ item.price }}" }, empty: { message: "No prices yet" } }] }],
};

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
  serve(200, [{ id: "1", name: "Concert A", price: "40" }]);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { env: { ...process.env, PN_SPEC_FETCH_FIXTURE: fixture }, stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("live data shows when the app opens and follows refresh_app; a failed fetch keeps the last data", async () => {
  assert.ok((await call("/session", { session: "dl1" })).ok);
  const made = await act("dl1", { action: "create_app", id: "prices", spec: PRICES });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.match(made.screen, /Concert A/);
  assert.match(made.screen, /40/);
  serve(200, [{ id: "1", name: "Concert A", price: "55" }, { id: "2", name: "Concert B", price: "30" }]);
  const r = await act("dl1", { action: "refresh_app", id: "prices" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.updated, ["prices"]);
  assert.match(r.screen, /Concert B/); assert.match(r.screen, /55/);
  serve(503, "down");
  const bad = await act("dl1", { action: "refresh_app", id: "prices" });
  assert.equal(bad.ok, true);
  assert.deepEqual(bad.updated, []);
  assert.equal(bad.errors[0].source, "prices");
  assert.equal(bad.sources[0].ok, false);
  assert.match((await act("dl1", { action: "screen" })).screen, /Concert B/);   // last good data still shown
  const log = (await act("dl1", { action: "device_log" })).log.filter((e) => e.name === "data_refresh");
  assert.equal(log.length, 2); assert.equal(log[0].source, "real");
});

test("refresh_app on an app that is not running says not_installed", async () => {
  assert.ok((await call("/session", { session: "dl2" })).ok);
  assert.equal((await act("dl2", { action: "refresh_app", id: "ghost" })).code, "not_installed");
});

test("app_activity lists versions with what changed, sources and events; not_installed for others", async () => {
  assert.ok((await call("/session", { session: "dl3" })).ok);
  assert.equal((await act("dl3", { action: "create_app", id: "prices", spec: PRICES })).ok, true);
  const v2 = { ...PRICES, screens: [...PRICES.screens, { id: "about", title: "About", body: [{ type: "text", value: "Price Watch" }] }] };
  assert.equal((await act("dl3", { action: "update_app", id: "prices", spec: v2 })).ok, true);
  await act("dl3", { action: "refresh_app", id: "prices" });
  const r = await act("dl3", { action: "app_activity" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.apps.length, 1);
  const a = r.apps[0];
  assert.equal(a.id, "prices"); assert.equal(a.version, 2);
  assert.match(a.history[0].changes[0], /^created: 1 screens, 0 actions, 1 data sources$/);
  assert.deepEqual(a.history[1].changes, ["added screen 'about'"]);
  assert.equal(a.sources[0].name, "prices"); assert.equal(typeof a.sources[0].last_at, "number");
  assert.deepEqual(a.events.map((e) => e.name).filter((n) => n !== "data_refresh"), ["create_app", "update_app"]);
  assert.deepEqual(a.events.find((e) => e.name === "update_app").changes, ["added screen 'about'"]);
  assert.equal((await act("dl3", { action: "app_activity", id: "prices", limit: 1 })).apps[0].events.length, 1);
  assert.equal((await act("dl3", { action: "app_activity", id: "ghost" })).code, "not_installed");
});

const GIFTS = {
  spec: "shipvo.app/v0",
  app: { id: "gifts", name: "Gift Ideas", icon: "gift", description: "Gifts to buy." },
  data: { gifts: { source: "collection", fields: { id: "text", name: "text" } } },
  actions: { add: { description: "Add a gift.", input: { name: { type: "text" } }, do: [{ insert: "gifts", value: { id: "{{ 'g' + string(count(gifts) + 1) }}", name: "{{ input.name }}" } }] } },
  screens: [{ id: "home", title: "Gifts", body: [{ type: "list", label: "Gift list", from: "{{ gifts }}", item: { title: "{{ item.name }}" }, empty: { message: "No gifts yet" } }] }],
};

test("export_phone then import_phone on a new phone restores apps, data, versions and layout", async () => {
  assert.ok((await call("/session", { session: "ex1" })).ok);
  assert.equal((await act("ex1", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  assert.equal((await act("ex1", { action: "app_action", id: "gifts", action_name: "add", input: { name: "Scarf" } })).ok, true);
  await act("ex1", { action: "update_app", id: "gifts", spec: { ...GIFTS, app: { ...GIFTS.app, description: "Changed" } } });
  await act("ex1", { action: "arrange_apps", id: "gifts", pinned: true });
  await act("ex1", { action: "install_app", id: "shop" }).catch(() => {});
  const out = await act("ex1", { action: "export_phone" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.phone.format, "shipvo.phone/v0");
  const g = out.phone.apps.find((a) => a.id === "gifts");
  assert.equal(g.kind, "spec"); assert.deepEqual(g.data.gifts.map((r) => r.name), ["Scarf"]); assert.equal(g.placement.pinned, true);
  assert.equal(g.history.length, 2);
  const text = JSON.stringify(out.phone);
  assert.ok(!/api\.example\.test.*"last_at"/.test(text));

  assert.ok((await call("/session", { session: "ex2" })).ok);
  const back = await act("ex2", { action: "import_phone", phone: JSON.parse(text) });
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.ok(back.imported.includes("gifts")); assert.deepEqual(back.failed, []);
  const act2 = (await act("ex2", { action: "app_activity", id: "gifts" })).apps[0];
  assert.equal(act2.version, 2); assert.equal(act2.history.length, 2);
  assert.deepEqual((await act("ex2", { action: "export_phone" })).phone.apps.find((a) => a.id === "gifts").data.gifts.map((r) => r.name), ["Scarf"]);
  await act("ex2", { action: "switch_app", id: "gifts" });
  assert.match((await act("ex2", { action: "screen" })).screen, /Scarf/);
  const again = await act("ex2", { action: "import_phone", phone: JSON.parse(text) });
  assert.ok(again.skipped.some((x) => x.id === "gifts" && x.reason === "already_installed"));
});

test("import_phone refuses a bad export and reports an app whose spec is invalid", async () => {
  assert.ok((await call("/session", { session: "ex3" })).ok);
  assert.equal((await act("ex3", { action: "import_phone", phone: { nope: 1 } })).code, "bad_export");
  const r = await act("ex3", { action: "import_phone", phone: { format: "shipvo.phone/v0", apps: [{ id: "broken", kind: "spec", spec: { spec: "shipvo.app/v0", screens: [] } }, { id: "Bad Id", kind: "spec" }] } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.imported, []);
  assert.equal(r.failed[0].id, "broken"); assert.equal(r.failed[0].reason, "invalid_spec"); assert.ok(r.failed[0].errors.length);
  assert.equal(r.failed[1].reason, "bad_app_id");
});
