// Settings: validation, rows, and the get_settings / set_setting actions against a real sim server.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";
import { settingPatch, settingRows, describeSettings, pickSettings, SettingsError } from "./settings.mjs";

test("settingPatch accepts good input; language ar sets rtl, others clear it", () => {
  assert.deepEqual(settingPatch("darkMode", true), { darkMode: true });
  assert.deepEqual(settingPatch("fontSize", "extra-large"), { fontSize: "extra-large" });
  assert.deepEqual(settingPatch("language", "ar"), { language: "ar", rtl: true });
  assert.deepEqual(settingPatch("language", "fr"), { language: "fr", rtl: false });
});

test("unknown keys and bad values are typed errors", () => {
  for (const [k, v, code] of [["volume", 1, "unknown_setting"], ["darkMode", "yes", "bad_value"], ["fontSize", "huge", "bad_value"], ["language", "de", "bad_value"], ["rtl", 1, "bad_value"]]) {
    assert.throws(() => settingPatch(k, v), (e) => e instanceof SettingsError && e.code === code, `${k}=${v}`);
  }
});

test("rows and text list every setting with defaults", () => {
  const rows = settingRows({});
  assert.deepEqual(rows.map((r) => r.key), ["darkMode", "fontSize", "boldText", "reduceMotion", "language", "rtl"]);
  assert.equal(pickSettings({ fontSize: "nope" }).fontSize, "default");
  assert.match(describeSettings({ darkMode: true }), /switch "Dark mode" \(darkMode\): on/);
});

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(6400, 200);
const root = mkdtempSync(join(tmpdir(), "sim-settings-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PAGE = `<!doctype html><html><head><title>fx</title></head><body><h1>Home</h1>
<script>
var st = { darkMode: false, fontSize: "default", boldText: false, reduceMotion: false, language: "en", rtl: false };
window.__pnDevice = { state: { platform: "android" }, settings() { return Object.assign({}, st); }, set(p) { Object.assign(st, p); }, notifications() { return []; } };
</script></body></html>`;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

before(async () => {
  const require = createRequire(import.meta.url); const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), PAGE);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start on port ${PORT}: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

test("get_settings and set_setting change the device and reject bad input without changing it", async () => {
  assert.ok((await call("/session", { session: "s" })).ok);
  const g = await act("s", { action: "get_settings" });
  assert.equal(g.ok, true); assert.equal(g.settings.darkMode, false); assert.match(g.screen, /Dark mode/);
  const a = await act("s", { action: "set_setting", key: "language", value: "ar" });
  assert.equal(a.ok, true); assert.equal(a.settings.language, "ar"); assert.equal(a.settings.rtl, true);
  const d = await act("s", { action: "set_setting", key: "darkMode", value: true });
  assert.equal(d.settings.darkMode, true);
  const u = await act("s", { action: "set_setting", key: "volume", value: 3 });
  assert.equal(u.ok, false); assert.equal(u.code, "unknown_setting");
  const b = await act("s", { action: "set_setting", key: "fontSize", value: "huge" });
  assert.equal(b.ok, false); assert.equal(b.code, "bad_value");
  assert.equal((await act("s", { action: "get_settings" })).settings.fontSize, "default");
});
