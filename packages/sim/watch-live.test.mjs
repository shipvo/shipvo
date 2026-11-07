// The /watch page and its socket against a real sim server: live sessions, steps, view-only until "control" is sent,
// and the step and change-line helpers. The app page is a stand-in with the device hooks.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { describeStep, changeLine } from "./watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(9700, 300);
const root = mkdtempSync(join(tmpdir(), "sim-watch-")); const dist = join(root, "dist");
let proc, web, base;
const APP = `<!doctype html><title>app</title><h1 id=h>Home</h1><script>
// Like @shipvo/device on the web: a web page goes to the Browser app, anything else to the app.
window.__pnDevice = { log: () => [], capabilities: () => null, openUrl(u) {
  if (/^https?:/.test(u) && window.__pnOpenBrowser) { window.__pnOpenBrowser(u); return true; }
  document.getElementById("h").textContent = "App got " + u; return true; } };
</script>`;
const WEB = `<!doctype html><title>Shop</title><body style="margin:0"><button id=b style="position:absolute;left:20px;top:20px;width:200px;height:100px" onclick="document.title='tapped'">Tap me</button>
<input id=i aria-label="Name" style="position:absolute;left:20px;top:200px;width:200px;height:40px">
<a id=l href="tide://item/3" style="position:absolute;left:20px;top:300px;display:block;width:200px;height:60px">Open the app</a>
<div style="height:3000px"></div>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const castRunning = async (id) => (await call("/sessions", {})).sessions.find((s) => s.session === id)?.streaming === true;
const until = async (f, ms = 15000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)); } };
const appText = async (s) => (await act(s, { action: "screen" })).screen;

function connect() {
  const ws = new WebSocket(`ws://localhost:${PORT}/watch/ws`);
  const msgs = []; ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return { ws, msgs, opened, send: (m) => ws.send(JSON.stringify(m)) };
}

before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), APP);
  web = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(WEB); });
  await new Promise((r) => web.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${web.address().port}/`;
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; if (process.env.SIM_DEBUG) process.stderr.write(d); });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error("sim did not start");
});
after(async () => {
  web?.close();
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});


test("/watch serves the page with both skins", async () => {
  const a = await (await fetch(`http://localhost:${PORT}/watch`)).text();
  const i = await (await fetch(`http://localhost:${PORT}/watch?skin=ios`)).text();
  assert.match(a, /Watch the agent/); assert.match(a, /data-part="takeover"/);
  assert.notEqual(a.length, i.length);
  assert.match(a, /@media \(max-width:760px\)/); assert.match(a, /aria-live="polite"/);
  assert.match(a, /aria-label="Live sessions"/); assert.match(a, /aria-label="Steps"/);
});

test("step words and the change line", () => {
  assert.equal(describeStep("tap", { ref: "e3" }, '- button "Add to cart" [ref=e3]'), 'tap "Add to cart"');
  assert.equal(describeStep("set_device", { device: { payment: "decline" } }), "set_device payment=decline");
  assert.equal(changeLine('- heading "Cart"\n- button "Pay" [ref=e1]', '- heading "Cart"\n- text "Added"'), "1 added, 1 removed: text \"Added\"");
  assert.equal(changeLine("- a", "- a"), "screen unchanged");
  assert.equal(describeStep("tap", { ref: "e9" }, '- button "Pay" [ref=e1]'), "tap e9");
  assert.equal(describeStep("type", { text: "x".repeat(100) }), `type "${"x".repeat(60)}" into the field`);
  assert.ok(changeLine("- a", "- " + "y".repeat(200)).length < 120);
  assert.equal(changeLine(null, "- a"), "");
});

test("a viewer gets frames and the agent's tap; with no viewer no screencast runs", async () => {
  await call("/session", { session: "w" });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await castRunning("w"), false);   // nobody watches yet
  const c = connect(); await c.opened;
  const list = await until(() => c.msgs.find((m) => m.type === "sessions"));
  assert.ok(list.sessions.some((s) => s.session === "w" && s.skin === "android"));
  c.send({ type: "select", session: "w" });
  await until(() => c.msgs.find((m) => m.type === "frame" && m.session === "w"));
  assert.equal(await castRunning("w"), true);
  const snap = (await act("w", { action: "screen" })).screen;
  const ref = /\[ref=(\w+)\]/.exec(snap)?.[1];
  assert.ok(ref, snap);
  await act("w", { action: "tap", ref });
  const step = await until(() => c.msgs.find((m) => m.type === "step" && /^tap/.test(m.text)));
  assert.equal(step.ok, true);
  // view only: a tap before "Take over" does nothing
  c.send({ type: "tap", x: 60, y: 60 });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(c.msgs.some((m) => m.type === "step" && m.text === "you: tap"), false);
  // taking over: a tap from the viewer reaches the page
  c.send({ type: "control", on: true });
  c.send({ type: "tap", x: 60, y: 60 });
  await until(() => c.msgs.find((m) => m.type === "step" && m.text === "you: tap"));
  c.ws.close();
  await until(async () => !(await castRunning("w")));   // the last viewer left: the screencast stops
});

test("the watch socket refuses a foreign Origin", async () => {
  const q = await new Promise((res) => { const r = http.request({ port: PORT, path: "/watch/ws", headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "x3JJHMbDL1EzLkh9GBhXDw==", "sec-websocket-version": "13", origin: "http://evil.test" } }); r.on("response", (x) => res(x.statusCode)); r.on("upgrade", () => res(101)); r.end(); });
  assert.equal(q, 403);
});
