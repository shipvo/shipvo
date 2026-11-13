import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { createLifecycle, lock, unlock, restart, assertUnlocked, setLockMethod } from "./lifecycle.mjs";
import { renderFrame, statusClientScript } from "./frame.mjs";

test("a PIN is needed to unlock, restart keeps the phone locked, and the PIN is never logged", () => {
  const st = createLifecycle();
  assert.throws(() => setLockMethod(st, { method: "pin", pin: "12" }), { code: "bad_pin" });
  assert.throws(() => setLockMethod(st, { method: "face" }), { code: "bad_method" });
  setLockMethod(st, { method: "pin", pin: "2468" });
  lock(st);
  assert.throws(() => unlock(st), { code: "pin_required" });
  assert.throws(() => unlock(st, { pin: "0000" }), { code: "wrong_pin" });
  assert.equal(st.failed, 1); assert.equal(st.locked, true);
  restart(st); assert.equal(st.locked, true);
  unlock(st, { pin: "2468" }); assert.equal(st.locked, false); assert.equal(st.failed, 0);
  assert.throws(() => setLockMethod(st, { method: "none" }), { code: "wrong_pin" });
  setLockMethod(st, { method: "none", current: "2468" });
  lock(st); unlock(st); assert.equal(st.locked, false);
  assert.ok(!JSON.stringify(st.log).includes("2468"));
});

test("lock, unlock and restart change state and log as simulated", () => {
  const st = createLifecycle();
  lock(st); assert.equal(st.locked, true);
  assert.throws(() => lock(st), { code: "already_locked" });
  assert.throws(() => assertUnlocked(st), { code: "phone_locked" });
  unlock(st); assert.equal(st.locked, false);
  assert.throws(() => unlock(st), { code: "not_locked" });
  lock(st); restart(st);
  assert.equal(st.locked, false); assert.equal(st.reloads, 2);
  assert.deepEqual(st.log.map((e) => e.name), ["lock", "unlock", "lock", "restart"]);
  assert.ok(st.log.every((e) => e.source === "simulated"));
});

test("the frame draws power, volume, lock, boot and menu parts", () => {
  for (const skin of ["android", "ios"]) {
    const { html } = renderFrame({ skin });
    for (const p of ["power-button", "volume-up-button", "volume-down-button", "lock-screen", "boot-screen", "off-screen", "unlock-button", "volume-overlay", "power-menu"]) assert.ok(html.includes(`data-part="${p}"`), `${skin} ${p}`);
    assert.match(html, /Restart/); assert.match(html, /Power off/);
  }
  assert.match(statusClientScript(), /power-button/);
});

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(7000, 300);
const root = mkdtempSync(join(tmpdir(), "sim-life-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1>Home</h1>
<script>
const n = Number(localStorage.getItem("loads") || 0) + 1; localStorage.setItem("loads", String(n));
window.addEventListener("DOMContentLoaded", () => { document.body.append("loads:" + n + " saved:" + (localStorage.getItem("keep") || "none")); });
</script><button onclick="localStorage.setItem('keep','yes');this.textContent='Saved'">Save</button></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
// The page adds its text on DOMContentLoaded, so on a slow runner the first read can come before it. Read again until the text shows.
async function screenWith(session, re) {
  let r;
  for (let i = 0; i < 25; i++) { r = await act(session, { action: "screen" }); if (re.test(r.screen)) return r; await new Promise((x) => setTimeout(x, 200)); }
  return r;
}

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start on port ${PORT}. stderr: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("lock then unlock returns to the same screen; input while locked is a typed error", async () => {
  assert.ok((await call("/session", { session: "l" })).ok);
  const before_ = (await act("l", { action: "screen" })).screen;
  const l = await act("l", { action: "lock" }); assert.ok(l.ok); assert.equal(l.locked, true);
  const t = await act("l", { action: "tap", ref: "e1" }); assert.equal(t.ok, false); assert.equal(t.code, "phone_locked");
  assert.equal((await act("l", { action: "lock" })).code, "already_locked");
  const u = await act("l", { action: "unlock" }); assert.ok(u.ok);
  assert.equal(u.screen, before_);
  assert.equal((await act("l", { action: "unlock" })).code, "not_locked");
});

test("restart cold-starts the app (reload counter up) and storage survives", async () => {
  assert.ok((await call("/session", { session: "r" })).ok);
  const first = await screenWith("r", /loads:1/); assert.match(first.screen, /loads:1 saved:none/);
  assert.ok((await act("r", { action: "tap", ref: "e3" })).ok);
  const r = await act("r", { action: "restart" });
  assert.ok(r.ok); assert.equal(r.reloads, 2);
  assert.match(r.screen, /loads:2 saved:yes/);
  const log = (await act("r", { action: "device_log" })).log;
  assert.deepEqual(log.filter((e) => e.source === "simulated").map((e) => e.name), ["restart"]);
});

// Navigation: the app records every visibilitychange it hears, which is what AppState reads on react-native-web.
test("home, resume, recents and kill give the app the right AppState events", async () => {
  assert.ok((await call("/session", { session: "n" })).ok);
  await screenWith("n", /loads:1/);
  const h = await act("n", { action: "press_home" });
  assert.ok(h.ok); assert.equal(h.appState, "background"); assert.match(h.screen, /Home screen/);
  const blocked = await act("n", { action: "tap", ref: "e3" }); assert.equal(blocked.code, "app_not_foreground");
  assert.equal((await act("n", { action: "kill_app" })).code, "recents_not_open");
  const r = await act("n", { action: "resume_app" }); assert.ok(r.ok); assert.equal(r.appState, "active");
  assert.equal((await act("n", { action: "resume_app" })).code, "app_in_foreground");
  assert.ok((await act("n", { action: "open_recents" })).ok);
  const k = await act("n", { action: "kill_app" }); assert.ok(k.ok); assert.equal(k.reloads, 2);
  const back = await act("n", { action: "resume_app" }); assert.ok(back.ok);
  assert.match((await screenWith("n", /loads:2/)).screen, /loads:2/);
});

test("the page sees background then active (document.visibilityState) in order", async () => {
  const PAGE2 = `<!doctype html><html><body><h1>Seen</h1><p id="s">seen:</p><script>const seen=[];document.addEventListener("visibilitychange",()=>{seen.push(document.visibilityState);document.getElementById("s").textContent="seen:"+seen.join(",")})</script></body></html>`;
  writeFileSync(join(dist, "index.html"), PAGE2);
  try {
    assert.ok((await call("/session", { session: "v" })).ok);
    await act("v", { action: "press_home" }); await act("v", { action: "resume_app" });
    await act("v", { action: "open_recents" });
    const last = await act("v", { action: "resume_app" });
    assert.match(last.screen, /seen:hidden,visible,hidden,visible/);
  } finally { writeFileSync(join(dist, "index.html"), PAGE); }
});

test("while away, open_url and open_notification are blocked too, and a screenshot shows the home screen and switcher", async () => {
  const { readFileSync } = await import("node:fs");
  assert.ok((await call("/session", { session: "a" })).ok);
  const shot = async () => { const r = await act("a", { action: "screenshot" }); assert.ok(r.ok); return readFileSync(r.path); };
  const appShot = await shot();
  await act("a", { action: "press_home" });
  assert.equal((await act("a", { action: "open_url", url: "myapp://x" })).code, "app_not_foreground");
  assert.equal((await act("a", { action: "open_notification", id: "n1" })).code, "app_not_foreground");
  const homeShot = await shot();
  assert.notDeepEqual(homeShot, appShot, "home screen shot differs from the app");
  await act("a", { action: "open_recents" });
  const recentsShot = await shot();
  assert.notDeepEqual(recentsShot, homeShot, "switcher shot differs from the home screen");
  const r = await act("a", { action: "resume_app" });
  assert.doesNotMatch(r.screen, /Home screen/);
  assert.deepEqual(await shot(), appShot, "the overlay is removed after the shot");
});

test("after kill_app the reloaded app is hidden until resumed", async () => {
  const PAGE3 = `<!doctype html><html><body><h1>Boot</h1><p id="s">now:</p><script>const seen=[];function put(){document.getElementById("s").textContent="now:"+document.visibilityState+" seen:"+seen.join(",")}document.addEventListener("visibilitychange",()=>{seen.push(document.visibilityState);put()});addEventListener("DOMContentLoaded",put)</script></body></html>`;
  writeFileSync(join(dist, "index.html"), PAGE3);
  try {
    assert.ok((await call("/session", { session: "k" })).ok);
    await act("k", { action: "open_recents" });
    const k = await act("k", { action: "kill_app" });
    assert.ok(k.ok);
    const r = await act("k", { action: "resume_app" });
    assert.match(r.screen, /now:visible seen:hidden,visible/);
  } finally { writeFileSync(join(dist, "index.html"), PAGE); }
});
