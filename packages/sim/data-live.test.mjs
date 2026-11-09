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

test("the phone's log records a background fetch that failed", async () => {
  assert.ok((await call("/session", { session: "dl4" })).ok);
  serve(200, [{ id: "1", name: "Concert A", price: "40" }]);
  const made4 = await act("dl4", { action: "create_app", id: "prices", spec: { ...PRICES, data: { prices: { ...PRICES.data.prices, cache: "1s" } } } });
  assert.equal(made4.ok, true); assert.match(made4.screen, /Concert A/);
  serve(503, "down");
  const before = (await act("dl4", { action: "device_log" })).log.filter((e) => e.name === "data_refresh").length;
  const deadline = Date.now() + 45_000;
  let hit;
  while (!hit && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    hit = (await act("dl4", { action: "device_log" })).log.filter((e) => e.name === "data_refresh").slice(before).find((e) => e.errors?.includes("prices"));
  }
  assert.ok(hit, "the 30 s check should log the failed fetch");
  assert.match((await act("dl4", { action: "screen" })).screen, /Concert A/);
});
