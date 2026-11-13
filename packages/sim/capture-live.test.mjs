// The simulator's framed captures, end to end: screenshot with frame: true, fit_frame sessions, record_start and record_stop.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { capturePage, contentSize } from "./capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(12800, 150);   // own port range, so this file never talks to another test's server
const root = mkdtempSync(join(tmpdir(), "sim-capture-"));
const dist = join(root, "dist"), dir = join(root, "state");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
let proc;

const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
/** Width and height from a PNG header. */
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

function ensureChromium() {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not install Chromium for playwright");
}

before(async () => {
  ensureChromium();
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button onclick="this.textContent='Tapped'">Tap me</button></body></html>`);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start listening on port ${PORT} within 90 s: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

for (const skin of ["android", "ios"]) {
  test(`${skin}: a fit_frame session screenshots as the whole phone at the frame's size, and plain screenshots stay the app only`, async () => {
    const id = `cap-${skin}`;
    assert.ok((await call("/session", { session: id, skin, fit_frame: true })).ok);
    const c = contentSize(skin), phone = capturePage({ skin, ...c });
    const plain = await act(id, { action: "screenshot" });
    assert.deepEqual(pngSize(plain.path), [c.width * 2, c.height * 2]);
    const framed = await act(id, { action: "screenshot", frame: true });
    assert.ok(framed.ok, framed.error);
    assert.deepEqual(pngSize(framed.path), [phone.width * 2, phone.height * 2]);
    assert.match(framed.screen, /Tap me/);
  });
}

test("a session without fit_frame keeps its size and can still be framed", async () => {
  assert.ok((await call("/session", { session: "cap-plain", skin: "ios" })).ok);
  const phone = capturePage({ skin: "ios", width: 393, height: 851 });
  const framed = await act("cap-plain", { action: "screenshot", frame: true });
  assert.deepEqual(pngSize(framed.path), [phone.width * 2, phone.height * 2]);
});

test("a session started as a phone model is that phone: its screen, pixel ratio, user agent and platform", async () => {
  const opened = await call("/session", { session: "cap-model", model: "iphone 16 pro" });
  assert.ok(opened.ok, opened.error);
  assert.equal(opened.model, "iPhone 16 Pro"); assert.equal(opened.skin, "ios");
  const list = (await call("/sessions", {})).sessions.find((s) => s.session === "cap-model");
  assert.equal(list.model, "iPhone 16 Pro"); assert.equal(list.skin, "ios");
  const plain = await act("cap-model", { action: "screenshot" });
  assert.deepEqual(pngSize(plain.path), [402 * 3, (874 - 54 - 34) * 3], "the app area at the phone's own pixel ratio");
  const phone = capturePage({ skin: "ios", width: 402, height: 874 - 54 - 34 });
  assert.deepEqual(pngSize((await act("cap-model", { action: "screenshot", frame: true })).path), [phone.width * 2, phone.height * 2]);
  const android = await call("/session", { session: "cap-pixel", model: "Pixel 8" });
  assert.equal(android.skin, "android");
});

test("an unknown phone model is refused with the list of models, and leaves no session", async () => {
  const r = await call("/session", { session: "cap-nokia", model: "Nokia 3310" });
  assert.equal(r.ok, false); assert.equal(r.code, "bad_model");
  assert.match(r.error, /Pixel 8/); assert.match(r.error, /iPhone 16/);
  const list = (await call("/sessions", {})).sessions;
  assert.equal(list.some((s) => s.session === "cap-nokia"), false);
});

test("record_start then record_stop saves an MP4 of the framed phone in the session folder", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async () => {
  assert.ok((await call("/session", { session: "cap-rec", skin: "android", fit_frame: true })).ok);
  const started = await act("cap-rec", { action: "record_start" });
  assert.ok(started.ok, started.error); assert.equal(started.recording, true);
  assert.equal((await act("cap-rec", { action: "record_start" })).code, "recording_active");
  const tap = await act("cap-rec", { action: "tap", ref: /\[ref=(e\d+)\]/.exec(started.screen)[1] });
  assert.match(tap.screen, /Tapped/);
  await act("cap-rec", { action: "screenshot", frame: true });   // a screenshot during a recording does not break either
  await new Promise((r) => setTimeout(r, 600));
  const video = await act("cap-rec", { action: "record_stop" });
  assert.ok(video.ok, video.error);
  assert.equal(video.path, started.path);
  assert.ok(video.path.startsWith(dir) && video.path.endsWith(".mp4"));
  assert.ok(statSync(video.path).size > 1000);
  assert.ok(video.frames >= 2 && video.duration_s >= 0.6, JSON.stringify(video));
  assert.equal(existsSync(video.path.replace(/\.mp4$/, ".frames")), false);
  assert.equal((await act("cap-rec", { action: "record_stop" })).code, "no_recording");
});
