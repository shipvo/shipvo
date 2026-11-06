// The Browser app against a real sim server: frames stream, input reaches a local page, Linking.openURL opens the
// Browser app, and a web link to the app's scheme reaches the app. The app page is a stand-in with the device hooks.
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
import { renderBrowserApp } from "./browser-app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(5300, 300);
const root = mkdtempSync(join(tmpdir(), "sim-ba-")); const dist = join(root, "dist");
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
const until = async (f, ms = 15000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)); } };
const appText = async (s) => (await act(s, { action: "screen" })).screen;

function connect(session) {
  const ws = new WebSocket(`ws://localhost:${PORT}/browser/ws?session=${session}`);
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

test("frames arrive, and taps, typing and swipes reach the page", async () => {
  await call("/session", { session: "f" });
  const c = connect("f"); await c.opened;
  assert.equal((await act("f", { action: "browser_open", url: base, allow_private: true })).ok, true);
  const frame = await until(() => c.msgs.find((m) => m.type === "frame"));
  assert.ok(frame.data.length > 200); assert.ok(frame.width > 0);
  assert.equal(Buffer.from(frame.data, "base64")[0], 0xff);   // a JPEG
  c.send({ type: "tap", x: 60, y: 60 });
  await until(async () => /tapped/.test((await act("f", { action: "browser_snapshot" })).title));
  c.send({ type: "tap", x: 60, y: 220 }); await new Promise((r) => setTimeout(r, 300));
  c.send({ type: "text", text: "Ada" });
  await until(async () => /textbox "Name"[^\n]*Ada/.test((await act("f", { action: "browser_snapshot" })).tree));
  c.send({ type: "swipe", x1: 200, y1: 600, x2: 200, y2: 200 });
  await until(async () => (await act("f", { action: "browser_scroll", dy: 0 })).ok && true);
  const state = await until(() => c.msgs.find((m) => m.type === "state"));
  assert.equal(state.tabs.length, 1);
  c.ws.close();
});

test("Linking.openURL from the app opens the Browser app, and the private-host guard still applies", async () => {
  await call("/session", { session: "o" });
  const c = connect("o"); await c.opened;
  await act("o", { action: "browser_open", url: "about:blank", allow_hosts: ["127.0.0.1"] });
  assert.equal((await act("o", { action: "open_url", url: base })).ok, true);   // what Linking.openURL(url) does
  await until(() => c.msgs.find((m) => m.type === "browser" && m.url === base));
  assert.equal((await act("o", { action: "browser_snapshot" })).title, "Shop");
  assert.match(JSON.stringify((await act("o", { action: "device_log" })).log), /browser_navigation/);
  assert.doesNotMatch(await appText("o"), /App got/);   // the app did not get the web link
  assert.equal((await act("o", { action: "open_url", url: "http://10.1.2.3/" })).ok, true);
  assert.match(JSON.stringify((await act("o", { action: "device_log" })).log), /host_not_allowed/);   // the guard still applies
});

test("a deep link on a web page opens the app", async () => {
  await call("/session", { session: "d" });
  const c = connect("d"); await c.opened;
  await act("d", { action: "browser_open", url: base, allow_private: true });
  const snap = await act("d", { action: "browser_snapshot" });
  const ref = /link "Open the app" \[ref=(\w+)\]/.exec(snap.tree)?.[1]; assert.ok(ref, snap.tree);
  await act("d", { action: "browser_click", ref });
  await until(() => c.msgs.find((m) => m.type === "app" && m.url === "tide://item/3"));
  assert.match(await appText("d"), /App got tide:\/\/item\/3/);
  assert.match(JSON.stringify((await act("d", { action: "device_log" })).log), /deep_link/);
});

test("tabs can be listed and closed, and wait_for sees text", async () => {
  await call("/session", { session: "t" });
  await act("t", { action: "browser_open", url: base, allow_private: true });
  const c = connect("t"); await c.opened; c.send({ type: "newtab" });
  const two = await until(async () => { const r = await act("t", { action: "browser_tabs" }); return r.tabs.length === 2 && r; });
  assert.equal(two.source, "web");
  assert.equal((await act("t", { action: "browser_close_tab", index: 1 })).tabs.length, 1);
  assert.equal((await act("t", { action: "browser_close_tab", index: 5 })).code, "no_tab");
  assert.equal((await act("t", { action: "browser_wait_for", text: "Tap me", timeout_ms: 1000 })).ok, true);
  assert.equal((await act("t", { action: "browser_wait_for", text: "never here", timeout_ms: 300 })).code, "timeout");
  assert.equal((await act("t", { action: "browser_scroll", dy: 500 })).ok, true);
  c.ws.close();
});

test("the socket refuses a foreign Origin and an unknown session", async () => {
  const bad = (url, headers) => new Promise((res) => { const q = http.request({ port: PORT, path: url, headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "x3JJHMbDL1EzLkh9GBhXDw==", "sec-websocket-version": "13", ...headers } }); q.on("response", (r) => res(r.statusCode)); q.on("upgrade", () => res(101)); q.end(); });
  assert.equal(await bad("/browser/ws?session=d", { origin: "http://evil.test" }), 403);
  assert.equal(await bad("/browser/ws?session=nope", {}), 404);
});

test("both skins render the controls", () => {
  for (const skin of ["android", "ios"]) {
    const { html } = renderBrowserApp(skin);
    for (const p of ["back", "forward", "reload", "address", "tabs"]) assert.match(html, new RegExp(`data-part="${p}"`), `${skin} ${p}`);
  }
  assert.match(renderBrowserApp("ios").html, /class="ba-bottom"/); assert.doesNotMatch(renderBrowserApp("android").html, /ba-bottom/);
});
