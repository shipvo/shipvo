// Share.share opens a sheet in the app page that lists the other installed apps plus Copy; share_to picks one.
// The page runs the real device layer (bundled from packages/device) on a real sim server.
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
const require = createRequire(import.meta.url);
const PORT = pickPort(12000, 300);
const root = mkdtempSync(join(tmpdir(), "sim-share-"));
const dist = join(root, "dist"); const dir = join(root, "state");
let proc;
const PHONE = { apps: [{ id: "notes", name: "Notes", url: "fixture:notes" }, { id: "inbox", name: "Inbox", url: "fixture:inbox" }], current_app: "notes" };
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });
const ref = (screen, label) => { const m = new RegExp(`${label}[^\\n]*\\[ref=(\\w+)\\]`).exec(screen); assert.ok(m, `${label} not in:\n${screen}`); return m[1]; };

function ensureChromium() {
  const pw = require("playwright");
  if (existsSync(pw.chromium.executablePath())) return;
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
}
before(async () => {
  ensureChromium();
  const esbuild = require("esbuild");
  const stub = join(root, "rn.js"); mkdirSync(root, { recursive: true }); writeFileSync(stub, "export const Platform={}, Share={}, Linking={}, Appearance={}, PixelRatio={}, AccessibilityInfo={}, I18nManager={}, Dimensions={};");
  const entry = join(root, "entry.ts");
  writeFileSync(entry, `import { Share, onShare, device } from ${JSON.stringify(join(here, "../device/src/index.web.ts"))};
onShare((p) => { document.getElementById("got").textContent = "Got " + p.message + " " + p.url; });
document.getElementById("share").onclick = () => { Share.share({ message: "Look at this", url: "https://example.com/p/1" }); };
document.getElementById("clip").onclick = async () => { document.getElementById("got").textContent = "Clip " + JSON.stringify(await device.clipboard.get()); };`);
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", alias: { "react-native": stub }, logLevel: "silent" });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>fx</title></head><body><h1>Notes</h1><p id="got"></p><button id="share">Share it</button><button id="clip">Read clip</button><script>${out.outputFiles[0].text.replace(/<\/script/g, "<\\/script")}</script></body></html>`);
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start within 90 s. Server stderr: ${err || "(empty)"}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

for (const skin of ["android", "ios"]) {
  test(`${skin}: app A shares, the sheet lists app B and Copy, share_to delivers to B`, async () => {
    const s = `share-${skin}`;
    assert.ok((await call("/session", { session: s, phone: PHONE, skin })).ok);
    await act(s, { action: "set_device", device: { platform: skin } });
    const first = await act(s, { action: "screen" });
    const r = await act(s, { action: "tap", ref: ref(first.screen, "Share it") });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.screen, /dialog "Share sheet"/);
    assert.match(r.screen, /Share to Inbox/);
    assert.doesNotMatch(r.screen, /Share to Notes/);
    assert.match(r.screen, /button "Copy"/);
    const d = await act(s, { action: "share_to", app_id: "inbox" });
    assert.ok(d.ok, JSON.stringify(d));
    assert.equal(d.app, "inbox");
    assert.match(d.screen, /Got Look at this https:\/\/example\.com\/p\/1/);
    assert.doesNotMatch(d.screen, /Share sheet/);
    const log = (await act(s, { action: "device_log" }));
    const text = JSON.stringify(log);
    assert.match(text, /"share"/); assert.match(text, /share_received/);
  });
}

test("share_to with no sheet open returns no_share_sheet", async () => {
  assert.ok((await call("/session", { session: "none", phone: PHONE })).ok);
  const r = await act("none", { action: "share_to", app_id: "inbox" });
  assert.equal(r.ok, false); assert.equal(r.code, "no_share_sheet");
});

test("share_to for an app the sheet does not list returns not_share_target and leaves the sheet open", async () => {
  assert.ok((await call("/session", { session: "unk", phone: PHONE })).ok);
  const first = await act("unk", { action: "screen" });
  await act("unk", { action: "tap", ref: ref(first.screen, "Share it") });
  const r = await act("unk", { action: "share_to", app_id: "nope" });
  assert.equal(r.code, "not_share_target");
  assert.match((await act("unk", { action: "screen" })).screen, /Share sheet/);
});

test("Copy puts message and url on the clipboard and closes the sheet", async () => {
  assert.ok((await call("/session", { session: "copy", phone: PHONE, skin: "android" })).ok);
  const first = await act("copy", { action: "screen" });
  const r = await act("copy", { action: "tap", ref: ref(first.screen, "Share it") });
  assert.match(r.screen, /Share sheet/);
  const c = await act("copy", { action: "tap", ref: ref(r.screen, "Copy") });
  assert.ok(c.ok, JSON.stringify(c));
  assert.doesNotMatch((await act("copy", { action: "screen" })).screen, /Share sheet/);
  const after = await act("copy", { action: "tap", ref: ref((await act("copy", { action: "screen" })).screen, "Read clip") });
  assert.match(after.screen, /Clip "Look at this\\nhttps:\/\/example\.com\/p\/1"/);
});

test("Cancel closes the sheet without touching the clipboard", async () => {
  assert.ok((await call("/session", { session: "cancel", phone: PHONE, skin: "android" })).ok);
  const first = await act("cancel", { action: "screen" });
  const r = await act("cancel", { action: "tap", ref: ref(first.screen, "Share it") });
  assert.match(r.screen, /Share sheet/);
  await act("cancel", { action: "tap", ref: ref(r.screen, "Cancel") });
  const s = await act("cancel", { action: "screen" });
  assert.doesNotMatch(s.screen, /Share sheet/);
  const after = await act("cancel", { action: "tap", ref: ref(s.screen, "Read clip") });
  assert.doesNotMatch(after.screen, /example\.com\/p\/1/);
});
