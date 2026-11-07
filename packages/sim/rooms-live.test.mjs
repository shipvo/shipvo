// Shared rooms against a real sim server: sessions opened with the same room share one mock backend.
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
const PORT = pickPort(10000, 300);
const root = mkdtempSync(join(tmpdir(), "sim-rooms-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>Shop</title></head><body><h1>Shop</h1>
<script>window.order = (n) => fetch(window.__PN_SIM__.baseUrl + "/o/tide", { method: "POST", body: JSON.stringify({ order: { id: n } }) });</script>
<button onclick="order('A1')">Pay</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const orders = async (s) => (await (await fetch(`http://localhost:${PORT}/s/${s}/orders`)).json()).orders;
const pay = async (session) => { const r = await call("/act", { session, action: "screen" }); const ref = /button "Pay" \[ref=(\w+)\]/.exec(r.screen)[1]; await call("/act", { session, action: "tap", ref }); await new Promise((r) => setTimeout(r, 300)); };
before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error("sim did not start");
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("two sessions in one room share orders; a session without a room does not", async () => {
  const o = await call("/session", { session: "a", room: "r1" }); assert.equal(o.ok, true, JSON.stringify(o));
  assert.equal((await call("/session", { session: "b", room: "r1" })).ok, true);
  assert.equal((await call("/session", { session: "c" })).ok, true);
  await pay("a");
  assert.deepEqual(await orders("~r1"), [{ id: "A1" }]);   // what b's order endpoint lists
  assert.deepEqual(await orders("c"), []);
  const list = (await call("/sessions", {})).sessions;
  assert.deepEqual(list.filter((s) => s.room === "r1").map((s) => s.session).sort(), ["a", "b"]);
  assert.equal(list.find((s) => s.session === "a").title, "Shop");
  assert.equal(list.find((s) => s.session === "c").room, null);
});

test("the room ends with its last session", async () => {
  await call("/end", { session: "a" });
  assert.deepEqual(await orders("~r1"), [{ id: "A1" }]);   // b is still in the room
  await call("/end", { session: "b" });
  assert.equal((await fetch(`http://localhost:${PORT}/s/~r1/orders`)).status, 404);
  assert.deepEqual((await call("/sessions", {})).sessions.map((s) => s.session), ["c"]);
  await call("/session", { session: "d", room: "r1" });   // a new room starts empty
  assert.deepEqual(await orders("~r1"), []);
});

test("a bad room name is refused", async () => {
  const r = await call("/session", { session: "e", room: "a/b" });
  assert.equal(r.ok, false); assert.equal(r.code, "bad_room");
});

test("a failed open leaves no member in the room and no backend file", async () => {
  const r = await call("/session", { session: "f", room: "r2", phone: "not json" });   // fails after the room is joined
  assert.equal(r.ok, false); assert.equal(r.code, "bad_profile");
  assert.equal((await fetch(`http://localhost:${PORT}/s/~r2/orders`)).status, 404);
  await call("/session", { session: "g", room: "r2" });   // the room starts empty, not with old orders
  assert.deepEqual(await orders("~r2"), []);
  await call("/end", { session: "g" });
  assert.equal((await fetch(`http://localhost:${PORT}/s/~r2/orders`)).status, 404);
});
