// /watch against a real sim server: frames for a session, no screencast without a viewer, view only, Origin check.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { watchPage } from "./watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(10300, 100);
const root = mkdtempSync(join(tmpdir(), "sim-watch-")); const dist = join(root, "dist");
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const until = async (f, ms = 15000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)); } };
const list = async () => (await call("/sessions", {})).sessions;
function connect(query = "", headers) {
  const ws = new WebSocket(`ws://localhost:${PORT}/watch/ws${query}`, headers ? { headers } : undefined);
  const msgs = []; ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("refused")); });
  return { ws, msgs, opened };
}

before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), `<!doctype html><title>app</title><h1>Home</h1><script>setInterval(()=>{document.title=String(Date.now())},50)</script>`);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error("sim did not start");
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("the page is drawn in the Android and the iOS frame", () => {
  assert.match(watchPage("android"), /data-skin="android"/);
  assert.match(watchPage("ios"), /data-skin="ios"/);
});

test("GET /watch serves the page", async () => {
  const r = await fetch(`http://localhost:${PORT}/watch?skin=ios`);
  assert.equal(r.status, 200); assert.match(await r.text(), /data-skin="ios"/);
});

test("no viewer, no screencast; a viewer gets frames and follows the newest session, then it stops", async () => {
  await call("/session", { session: "a", skin: "android" });
  assert.equal((await list())[0].streaming, false);
  const v = connect(); await v.opened;
  const first = await until(() => v.msgs.find((m) => m.type === "frame"));
  assert.equal(Buffer.from(first.data, "base64")[0], 0xff); assert.ok(first.width > 0);
  assert.equal((await list()).find((s) => s.session === "a").streaming, true);
  // a new session: the viewer follows it
  await call("/session", { session: "b", skin: "ios" });
  const sw = await until(() => v.msgs.find((m) => m.type === "sessions" && m.current === "b"));
  assert.equal(sw.sessions.find((s) => s.session === "b").skin, "ios");
  await until(() => v.msgs.slice(v.msgs.indexOf(sw)).some((m) => m.type === "frame"));
  const ss = await list();
  assert.equal(ss.find((s) => s.session === "b").streaming, true);
  assert.equal(ss.find((s) => s.session === "a").streaming, false);
  v.ws.send(JSON.stringify({ type: "tap", x: 5, y: 5 }));   // input is ignored
  v.ws.close();
  await until(async () => (await list()).every((s) => s.streaming === false));
});

test("a viewer that picked a session stays on it", async () => {
  const v = connect("?session=a"); await v.opened;
  await until(() => v.msgs.find((m) => m.type === "frame"));
  await call("/session", { session: "c" });
  const m = await until(() => v.msgs.filter((x) => x.type === "sessions").find((x) => x.sessions.some((s) => s.session === "c")));
  assert.equal(m.current, "a"); assert.equal(m.following, false);
  v.ws.close();
});

test("a wrong Origin is refused, the same origin is accepted", async () => {
  await assert.rejects(connect("", { origin: "http://evil.example" }).opened, /refused/);
  const ok = connect("", { origin: `http://localhost:${PORT}` }); await ok.opened; ok.ws.close();
});

test("a tap through /act is a step on /watch; input is ignored until Take over is on", async () => {
  await call("/session", { session: "t", skin: "android" });
  const v = connect("?session=t"); await v.opened;
  await until(() => v.msgs.find((m) => m.type === "frame"));
  await call("/act", { session: "t", action: "tap_xy", x: 5, y: 5 });
  await call("/act", { session: "t", action: "set_device", device: { network: "offline" } });
  const st = await until(() => v.msgs.filter((m) => m.type === "step" && m.step.by === "agent"));
  await until(() => v.msgs.filter((m) => m.type === "step").length >= 2);
  assert.match(v.msgs.filter((m) => m.type === "step")[1].step.text, /^set_device/);
  assert.match(v.msgs.filter((m) => m.type === "step")[1].step.change, /Screen/);
  // control off: ignored
  v.ws.send(JSON.stringify({ type: "text", text: "x" }));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(v.msgs.some((m) => m.type === "step" && m.step.by === "you"), false);
  // control on: acted on and shown
  v.ws.send(JSON.stringify({ type: "control", on: true }));
  v.ws.send(JSON.stringify({ type: "text", text: "x" }));
  const mine = await until(() => v.msgs.find((m) => m.type === "step" && m.step.by === "you"));
  assert.match(mine.step.text, /typed/);
  v.ws.close();
});

test("switching to another session sends that session's history, without the old session's steps", async () => {
  await call("/session", { session: "ha", skin: "android" });
  const v = connect(); await v.opened;
  await until(() => v.msgs.find((m) => m.type === "history"));
  await call("/act", { session: "ha", action: "set_device", device: { network: "offline" } });
  await until(() => v.msgs.find((m) => m.type === "step" && m.step.text.startsWith("set_device")));
  const before = v.msgs.length;
  await call("/session", { session: "hb", skin: "android" });
  const h = await until(() => v.msgs.slice(before).find((m) => m.type === "history"));
  assert.deepEqual(h.steps, []);
  v.ws.close();
});

test("Take over: swipe and key are acted on, bad coordinates give an error", async () => {
  await call("/session", { session: "ti", skin: "android" });
  const v = connect("?session=ti"); await v.opened;
  await until(() => v.msgs.find((m) => m.type === "frame"));
  v.ws.send(JSON.stringify({ type: "control", on: true }));
  v.ws.send(JSON.stringify({ type: "swipe", x1: 5, y1: 50, x2: 5, y2: 5 }));
  v.ws.send(JSON.stringify({ type: "key", key: "Enter" }));
  v.ws.send(JSON.stringify({ type: "tap", x: "a", y: 1 }));
  await until(() => v.msgs.filter((m) => m.type === "step" && m.step.by === "you").length >= 2);
  const mine = v.msgs.filter((m) => m.type === "step" && m.step.by === "you").map((m) => m.step.text);
  assert.ok(mine.includes("You scrolled") && mine.includes("You pressed Enter"));
  const err = await until(() => v.msgs.find((m) => m.type === "error"));
  assert.match(err.message, /numbers/);
  v.ws.close();
});

test("the page has a separate status line for input errors and describes Take over", () => {
  const html = watchPage("android");
  assert.match(html, /role="status" data-part="input-error"/);
  assert.match(html, /aria-describedby="take-over-help"/);
  assert.match(html, /\.w-view:focus-visible/);
});

test("the page clears the input error on history, your next step, toggle and reconnect, and has a light error colour in dark mode", () => {
  const html = watchPage("android");
  assert.match(html, /function clearErr\(\)/);
  assert.match(html, /ws\.onopen=function\(\)\{clearSteps\(\);clearErr\(\)/);
  assert.match(html, /m\.type==="history"\)\{clearSteps\(\);clearErr\(\)/);
  assert.match(html, /m\.step\.by==="you"\)clearErr\(\)/);
  assert.match(html, /take\.onchange=function\(\)\{clearErr\(\)/);
  assert.match(html, /prefers-color-scheme:dark[^`]*\.w-err\{color:#f2b8b5\}/);
});
